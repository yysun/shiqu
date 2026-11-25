// Save creation intent before extraction, and serialize each explicit choice independently of queue progress.
// Continuation and setting drafts preserve the chosen story; title changes reset only unselected intake.
// Changing discovery conditions updates the same task, fencing obsolete searches without starting a new one.
// An explicit query keeps the original scope and controls, and never bypasses a production lock.
import {decodeDocument} from '../lib/production-dag/document.ts';
import type {RequirementsSetup} from '../lib/reader-requirements.ts';
import {editRequirements,requirementEdits,requirementsForReselection,suggestedSettings} from '../lib/reader-requirements.ts';
import {normalizeProductionPrompt} from '../lib/reader-prompts.ts';
import {combinedOriginal,directBookChoice,selectedChapterScope} from './local-book-contents.ts';
import type {LocalBooks} from './local-books.ts';
import {localBookId} from './local-books.ts';
import {createHash} from 'node:crypto';
import {emptyDocument,selectionSchema,ReaderError} from '../lib/reader-model.ts';
import type {Document,Selection,SessionRow} from '../lib/reader-model.ts';
import {effectiveIntakePhase,intakeDraftToken,intakeSearch} from '../lib/reader-intake.ts';
import type {IntakeAction,IntakeSearch,ReselectionDraft} from '../lib/reader-intake.ts';
import type {ReaderRepository,SyncStatements} from '../lib/reader-repository.ts';
import {writeStory} from './production-records.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import {maxSuggestionBatches} from '../lib/reader-suggestions.ts';
import {artStyleSettings,sameArtDirection} from '../lib/reader-styles.ts';
import {invalidateStoryBrief,storyBriefVerified} from '../lib/reader-story-brief.ts';
import {commandReceipt,recordNoop} from './reader-commands.ts';
import {authorizeSetup,type SetupState} from '../lib/production-lifecycle.ts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const currentStory=`NOT ${supersededSql()} AND NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=stories.id AND user_id=stories.user_id)`;
async function intakeSelection(input:Selection,books?:LocalBooks){
 if(input.discovery?.mode==='title'){
  if(input.source)throw new ReaderError(400,'请填写目标标题并选择章节范围，不要同时直接选择另一篇故事。');
  if(!books||!await books.book(input))throw new ReaderError(400,'按标题提取需要可核对原文的本地书籍，请选择书库中的书。');
 }
 if(input.source&&input.discoverySources)throw new ReaderError(400,'请选择章节提取或直接故事，不能混用。');
 if((input.source||input.discoverySources)&&!books)throw new ReaderError(503,'本地书库暂不可用');
 const combine=input.discovery?.mode==='auto'&&input.discovery.combine;
 if(combine&&(!input.discoverySources||input.discoverySources.length<2))throw new ReaderError(400,'请选择至少两段原文。');
 if(input.sourceCard&&!input.source)throw new ReaderError(400,'故事卡缺少原文出处。');
 const local=input.discoverySources?await books!.book(input):null;
 if(input.discoverySources&&!local)throw new ReaderError(400,'章节提取只支持本地书库。');
 const scope=local?await selectedChapterScope(books!,local,input.discoverySources!,combine):null;
 const original=combine&&local&&scope?combinedOriginal(books!,local,scope):undefined;
 const choice=original?.localSource?{original,entry:{title:'待拟标题',excerpt:'故事梗概准备中',source:original.localSource}}
  :input.source?await directBookChoice(books!,input):null;
 const selection=selectionSchema.parse({...input,storyTitle:choice?.entry.title,source:choice?.entry.source,discoverySources:scope?.discoverySources,length:'auto',narrativeDetail:input.narrativeDetail||'balanced'});
 if(selection.bookId==='other'&&!selection.customBook?.trim())throw new ReaderError(400,'请先填写书名或 URL。');
 return {selection,choice};
}
// 直接选中的原文和已有简介可以在制作建议生成前显示。
function selectSourceCard(doc:Document,choice:NonNullable<Awaited<ReturnType<typeof intakeSelection>>['choice']>,round:number){
 doc.original=choice.original;
 Object.assign(doc.intake!,{phase:'preparing',search:{round,state:'idle'},selected:{batch:0,index:0},
  batches:[{stories:[{title:choice.entry.title,description:choice.entry.excerpt,source:choice.entry.source,sourceLabel:choice.original.title.slice(0,150)}],note:''}],
 });
}
export async function createIntake(repo:ReaderRepository,id:string,uid:string,input:Selection,books?:LocalBooks,replacement?:{
 draft:ReselectionDraft;setup:RequirementsSetup;beforeInsert:(db:SyncStatements)=>void;
}){
 const {selection,choice}=await intakeSelection(input,books);
 const edited=requirementEdits({...selection,productionPrompt:normalizeProductionPrompt(selection.productionPrompt,selection.theme)});
 const creationHash=hash(selection),doc:Document={...emptyDocument(),setupRequirements:replacement?.setup??{edited},intake:{phase:'choosing',generation:0,creationHash,batches:[],briefRequired:true,search:{round:0,state:'idle'}}};
 if(input.discovery&&!choice&&!replacement){doc.intake!.phase='discovering';doc.intake!.search={round:1,state:'searching',cycleId:id};}
 if(choice)selectSourceCard(doc,choice,0);
 if(selection.artStylePrompt||replacement)doc.intake!.manualArt=true;
 if(replacement)doc.reselection=replacement.draft;
 const row=await repo.create(id,uid,selection,doc,replacement?.beforeInsert);
 if((decodeDocument(row)).intake?.creationHash!==creationHash)throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;
}
// Manual search stands outside selection generations; automatic continuation must still be unselected at write time.
async function requestSearch(repo:ReaderRepository,row:SessionRow,search:IntakeSearch,requestId:string,fingerprint:string,automatic=false){
 const next:IntakeSearch={round:search.round+1,state:'searching',requestId,commandHash:fingerprint,cycleId:automatic?(search.cycleId||hash([row.id,search.round])):requestId};
 const changed={meta:{changes:writeStory(repo.db,row.id,row.user_id,`UPDATE stories SET document=json_set(document,'$.intake.search',json(?),'$.intake.phase',CASE WHEN json_type(document,'$.intake.selected')='object' THEN json_extract(document,'$.intake.phase') ELSE 'discovering' END),updated_at=?
  WHERE id=? AND user_id=? AND COALESCE(json_extract(document,'$.intake.search.round'),0)=? AND json_extract(document,'$.intake.phase')!='confirmed'${automatic?" AND json_type(document,'$.intake.selected') IS NOT 'object' AND json_extract(document,'$.intake.phase')='choosing' AND json_extract(document,'$.intake.search.state')='idle'":''} AND ${currentStory}`,[JSON.stringify(next),new Date().toISOString(),row.id,row.user_id,search.round])}};
 // A command that lost the CAS was accepted as a no-op; later replay cannot start a new round.
 if(!changed.meta.changes)await recordNoop(repo.db,row.user_id,row.id,requestId,'setup',fingerprint);
 return repo.get(row.id,row.user_id);
}
export function setupState(doc:Document,selection:Selection,superseded:boolean):SetupState{
 const intake=doc.intake,chosen=intake?.selected;
 const requiresBrief=intake?.briefRequired||chosen&&intake.batches[chosen.batch]?.stories[chosen.index]?.storyBrief||doc.original?.storyBrief;
 return {phase:effectiveIntakePhase(doc,selection),superseded,replacement:!!doc.reselection,confirmed:!!doc.plan,
  generationCurrent:true,draftCurrent:true,selected:!!chosen,
  candidateExists:intake?.batches.some(batch=>batch.stories.length>0)??false,search:intake?intakeSearch(intake):{state:'idle'},
  sameSearch:false,automatic:false,hasCandidates:!!intake?.batches.at(-1)?.stories.length,
  searchLimit:(intake?.batches.length??0)>=maxSuggestionBatches,combined:selection.discovery?.mode==='auto'&&!!selection.discovery.combine,
  preparationReady:!!doc.original&&!!doc.frameRecommendation,briefReady:!requiresBrief||storyBriefVerified(doc.original)};
}
export async function changeIntake(repo:ReaderRepository,id:string,uid:string,action:IntakeAction,books?:LocalBooks,attempt=0):Promise<SessionRow>{
 const row=await repo.get(id,uid),doc=decodeDocument(row),selection=selectionSchema.parse(JSON.parse(row.selection));
 const fingerprint=hash(action),receipt=await commandReceipt(repo.db,uid,action.requestId,fingerprint);
 if(receipt){if(receipt.action!=='setup'||receipt.session_id!==id)throw new ReaderError(409,'这个操作编号已用于其他内容。');return row;}
 const savedIntake=doc.intake,phase=effectiveIntakePhase(doc,selection);
 if(action.action!=='more'&&savedIntake?.lastAction?.id===action.requestId){
  if(savedIntake.lastAction.hash!==fingerprint)throw new ReaderError(409,'此操作编号已用于其他内容。');
  return row;
 }
 const styling=artStyleSettings(savedIntake?.draft??selection,'settings' in action?action.settings??{}:{});
 const search=savedIntake?intakeSearch(savedIntake):{round:0,state:'idle' as const};
 const candidate=action.action==='choose'?savedIntake?.batches[action.batch]?.stories[action.index]:undefined;
 let draftCurrent=true;
 if(savedIntake&&(action.action==='draft'||action.action==='recommend'||action.action==='confirm')){
  const current=intakeDraftToken(savedIntake.draft,doc.setupRequirements?.edited);
  const {suggestions,overrides}=doc.setupRequirements||{};
  const advice=doc.frameRecommendation?.requirements??suggestions;
  // 兼容旧客户端提交未修改的系统建议，同时保护已保存的草稿。
  const userDraft=!!savedIntake.draft&&(!!savedIntake.draftEdited||!advice||intakeDraftToken(suggestedSettings(selection,advice,overrides))!==intakeDraftToken(savedIntake.draft));
  const legacyToken=intakeDraftToken(savedIntake.draft?{...savedIntake.draft,acceptancePrompt:savedIntake.draft.acceptancePrompt??selection.acceptancePrompt??''}:undefined);
  const requested=intakeDraftToken({...action.settings,...styling,acceptancePrompt:action.settings.acceptancePrompt??savedIntake.draft?.acceptancePrompt??selection.acceptancePrompt??'',length:action.action==='recommend'?savedIntake.draft?.length??'auto':action.settings.length});
  draftCurrent=action.draftToken!==undefined?action.draftToken===current:!userDraft||requested===legacyToken;
 }
 const decision=authorizeSetup(action.action,{
  ...setupState(doc,selection,await repo.superseded(id,uid)),
  generationCurrent:savedIntake?.generation===action.generation,draftCurrent,candidateExists:!!candidate,
  sameSearch:search.requestId===action.requestId,automatic:action.action==='more'&&!!action.automatic,
 });
 if(decision.effect==='reject')throw new ReaderError(decision.status,decision.message);
 if(decision.effect==='noop'){await recordNoop(repo.db,uid,id,action.requestId,'setup',fingerprint);return row;}
 if(action.action==='more')return requestSearch(repo,row,search,action.requestId,fingerprint,action.automatic);
 const intake=savedIntake!;
 intake.phase=phase!;
 if(action.action==='conditions'){
  const requested=action.conditions.discovery;
  const discovery=action.conditions.source
   ?action.conditions.sourceCard&&requested?.mode==='auto'&&requested.themeInput?{mode:'auto' as const,themeInput:requested.themeInput}:undefined
   :requested||{mode:'auto' as const};
  const {selection:next,choice}=await intakeSelection(selectionSchema.parse({...selection,...action.conditions,customBook:action.conditions.customBook,discoverySources:action.conditions.discoverySources,discovery,storyTitle:undefined,source:action.conditions.source,sourceCard:action.conditions.sourceCard}),books);
  const conditions=(value:Selection)=>JSON.stringify([value.bookId,value.customBook,value.theme,value.source,value.sourceCard,value.discoverySources,value.productionPrompt]);
  if(!action.conditions.discovery&&conditions(next)===conditions(selection)){await recordNoop(repo.db,uid,id,action.requestId,'setup',fingerprint);return row;}
  // Search rounds fence late extraction results; generations fence stale candidate selections.
  const round=intakeSearch(intake).round+1;
  intake.phase=action.conditions.discovery?'discovering':'choosing';intake.generation++;intake.batches=[];
  delete intake.indexedCandidates;
  intake.search=action.conditions.discovery?{round,state:'searching',cycleId:action.requestId}:{round,state:'idle'};intake.lastAction={id:action.requestId,hash:fingerprint};
  delete intake.selected;delete intake.draft;delete intake.draftEdited;delete doc.original;delete doc.dag;delete doc.frameRecommendation;doc.frameCountConfirmed=false;
  doc.setupRequirements={edited:editRequirements(selection,doc.setupRequirements,next)};
  if(choice)selectSourceCard(doc,choice,round);
  const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,production_complete=0,updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND ${currentStory}`,[JSON.stringify(next),null,new Date().toISOString(),id,uid,row.document,row.selection],{value:doc,parameter:1})}};
  if(!result.meta.changes){if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);throw new ReaderError(409,'提取条件已更新，请重新打开后继续。');}
  return repo.get(id,uid);
 }
 if(action.action==='search'){
  if(action.title&&!localBookId(selection))throw new ReaderError(400,'按标题提取需要可核对原文的本地书籍。');
  const themeInput=selection.discovery?.mode==='auto'?selection.discovery.themeInput:undefined;
  const discovery=action.title?{mode:'title' as const,title:action.title}:{mode:'auto' as const,themeInput},search=intakeSearch(intake);
  if(search.state==='searching'&&JSON.stringify(selection.discovery)===JSON.stringify(discovery)){
   await recordNoop(repo.db,uid,id,action.requestId,'setup',fingerprint);return row;
  }
  // The new round fences old paid results; the generation also fences stale candidate choices.
  selection.discovery=discovery;delete selection.storyTitle;delete selection.source;delete selection.sourceCard;selection.length='auto';
  intake.phase='discovering';intake.generation++;intake.batches=[];
  delete intake.indexedCandidates;
  intake.search={round:search.round+1,state:'searching',requestId:action.requestId,commandHash:fingerprint,cycleId:action.requestId};
  delete doc.original;delete doc.dag;delete doc.frameRecommendation;doc.frameCountConfirmed=false;
  const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,production_complete=0,updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND ${currentStory}`,[JSON.stringify(selection),null,new Date().toISOString(),id,uid,row.document,row.selection],{value:doc,parameter:1})}};
  if(!result.meta.changes){if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);throw new ReaderError(409,'查找条件已更新，请重新打开后继续。');}
  return repo.get(id,uid);
 }
 const manual=(settings:ReturnType<typeof artStyleSettings>)=>!sameArtDirection(settings,selection)||!!intake.manualArt;
 const previous=intake.draft??selection;
 const withSavedAcceptance=<T extends {acceptancePrompt?:string}>(settings:T)=>settings.acceptancePrompt===undefined&&previous.acceptancePrompt!==undefined?
  {...settings,acceptancePrompt:previous.acceptancePrompt}:settings;
 if(action.action==='draft'){
  // 旧客户端提交全表单时，准备建议出现前显式提供的空值也视为编辑。
  const explicit=action.requirementsEdited??(!intake.draft?{productionPrompt:true as const,...(action.settings.acceptancePrompt===undefined?{}:{acceptancePrompt:true as const})}:undefined);
  const setup={edited:editRequirements(previous,doc.setupRequirements,action.settings,explicit)};
  // 同时保存草稿和动作回执；后台仍持有原来的工作锁和输入世代。
  const saved={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET document=json_set(document,'$.intake.draft',json(?),'$.intake.draftEdited',json('true'),'$.intake.manualArt',json(?),'$.intake.lastAction',json(?),'$.setupRequirements',json(?)),updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND ${currentStory}`,[JSON.stringify({...withSavedAcceptance(action.settings),...styling}),JSON.stringify(manual(styling)),JSON.stringify({id:action.requestId,hash:fingerprint}),JSON.stringify(setup),new Date().toISOString(),id,uid,row.document,row.selection])}};
  if(!saved.meta.changes){
   if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);
   throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');
  }
  return repo.get(id,uid);
 }
 if(action.action==='choose'){
  const choice=candidate!;
  if(intake.selected?.batch===action.batch&&intake.selected.index===action.index&&['preparing','confirming'].includes(intake.phase)){
   await recordNoop(repo.db,uid,id,action.requestId,'setup',fingerprint);return row;
  }
  const settings=action.settings?withSavedAcceptance(action.settings):intake.draft;
  const nextStyle=artStyleSettings(selection,settings||{});
  if(intake.selected&&action.settings?.artStylePrompt===undefined)nextStyle.artStylePrompt=undefined;
  if(settings){intake.manualArt=manual(nextStyle);Object.assign(selection,settings,nextStyle);}
  else if(intake.selected)delete selection.artStylePrompt;
  const edited=editRequirements(previous,doc.setupRequirements,settings??{},action.requirementsEdited);
  const reset=requirementsForReselection(selection,{edited});
  Object.assign(selection,reset.selection);doc.setupRequirements=reset.setup;
  selection.storyTitle=choice.title;selection.source=choice.source;delete selection.sourceCard;
  if(!intake.manualArt&&choice.artRecommendation)selection.artStyle=choice.artRecommendation.artStyle;
  intake.selected={batch:action.batch,index:action.index};intake.phase='preparing';
  intake.search={...intakeSearch(intake),state:'idle',error:null};
  delete doc.original;delete doc.dag;delete doc.frameRecommendation;doc.frameCountConfirmed=false;selection.length='auto';
 }else{
  const settings=withSavedAcceptance(action.settings),requirementsChanged=settings.productionPrompt!==selection.productionPrompt;
  const preservedAdvice=action.action==='confirm'&&requirementsChanged?(doc.frameRecommendation?.requirements??doc.setupRequirements?.suggestions):undefined;
  doc.setupRequirements={edited:editRequirements(previous,doc.setupRequirements,settings,action.requirementsEdited),...(preservedAdvice?{suggestions:preservedAdvice}:{})};
  intake.manualArt=manual(styling);Object.assign(selection,settings,styling);
  if(action.action==='recommend'){
   if(requirementsChanged)invalidateStoryBrief(doc);
   intake.draft={...settings,...styling,length:'auto'};intake.draftEdited=true;delete doc.frameRecommendation;doc.frameCountConfirmed=false;intake.phase='preparing';selection.length='auto';
  }
  else{
   if(requirementsChanged)invalidateStoryBrief(doc);
   doc.frameCountConfirmed=true;intake.phase='confirmed';
   // Results could no longer be chosen. A call in flight stops at its end and saves its reading position.
   intake.search={...intakeSearch(intake),state:'idle',error:null};
  }
 }
 if(action.action!=='recommend'){delete intake.draft;delete intake.draftEdited;}
 intake.generation++;intake.lastAction={id:action.requestId,hash:fingerprint};
 const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,production_complete=0,updated_at=?${action.action==='confirm'?",generation_control='active'":''}
  WHERE id=? AND user_id=? AND document=? AND selection=? AND ${currentStory}`,[JSON.stringify(selection),null,new Date().toISOString(),id,uid,row.document,row.selection],{value:doc,parameter:1})}};
 if(!result.meta.changes){
  const current=await repo.get(id,uid),saved=(decodeDocument(current)).intake;
  if(saved?.lastAction?.id===action.requestId&&saved.lastAction.hash===fingerprint)return current;
  // 重读以容纳同一世代的后台进度；草稿操作会重新校验提交时的指纹。
  if(saved?.generation===action.generation&&attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);
  throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');
 }
 return repo.get(id,uid);
}
