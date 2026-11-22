// Save creation intent before extraction, and serialize each explicit choice independently of queue progress.
// Continuation and setting drafts preserve the chosen story; title changes reset only unselected intake.
// Changing discovery conditions updates the same task, fencing obsolete searches without starting a new one.
// An explicit query keeps the original scope and controls, and never bypasses a production lock.
import type {RequirementsSetup} from '../lib/reader-requirements.ts';
import {requirementsForReselection,suggestedSettings} from '../lib/reader-requirements.ts';
import {combinedOriginal,directBookChoice,selectedChapterScope} from './local-book-contents.ts';
import type {LocalBooks} from './local-books.ts';
import {localBookId} from './local-books.ts';
import {createHash} from 'node:crypto';
import {emptyDocument,selectionSchema,ReaderError} from '../lib/reader-model.ts';
import type {Document,Selection,SessionRow} from '../lib/reader-model.ts';
import {effectiveIntakePhase,intakeDraftToken,intakeSearch} from '../lib/reader-intake.ts';
import type {IntakeAction,IntakeSearch,ReselectionDraft} from '../lib/reader-intake.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {writeStory} from './production-records.ts';
import {supersededSql} from '../lib/reader-repository.ts';
import {maxSuggestionBatches} from '../lib/reader-suggestions.ts';
import {artStyleSettings,sameArtDirection} from '../lib/reader-styles.ts';
import {invalidateStoryBrief,storyBriefVerified} from '../lib/reader-story-brief.ts';
import {commandReceipt,recordNoop} from './reader-commands.ts';
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
export async function createIntake(repo:ReaderRepository,id:string,uid:string,input:Selection,books?:LocalBooks,reselection?:ReselectionDraft,setupRequirements?:RequirementsSetup){
 const {selection,choice}=await intakeSelection(input,books);
 const creationHash=hash(selection),doc:Document={...emptyDocument(),intake:{phase:'choosing',generation:0,creationHash,batches:[],briefRequired:true,search:{round:0,state:'idle'}}};
 if(input.discovery&&!choice&&!reselection){doc.intake!.phase='discovering';doc.intake!.search={round:1,state:'searching',cycleId:id};}
 if(choice)selectSourceCard(doc,choice,0);
 if(setupRequirements)doc.setupRequirements=setupRequirements;
 if(selection.artStylePrompt||reselection)doc.intake!.manualArt=true;
 if(reselection)doc.reselection=reselection;
 const row=await repo.create(id,uid,selection,doc);
 if((JSON.parse(row.document) as Document).intake?.creationHash!==creationHash)throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;
}
// Manual search stands outside selection generations; automatic continuation must still be unselected at write time.
async function requestSearch(repo:ReaderRepository,row:SessionRow,doc:Document,requestId:string,fingerprint:string,automatic=false){
 const intake=doc.intake!,search=intakeSearch(intake);
 if(automatic&&(intake.selected||intake.phase!=='choosing'||search.state!=='idle'||!intake.batches.at(-1)?.stories.length)||search.state==='searching'||search.state==='idle'&&search.requestId===requestId){await recordNoop(repo.db,row.user_id,row.id,requestId,'setup',fingerprint);return row;}
 if(doc.plan||intake.phase==='confirmed')throw new ReaderError(409,'制作已确认；需要调整时请创建修订版本。');
 if(intake.batches.length>=maxSuggestionBatches)throw new ReaderError(400,'已保存40批候选，请回看选择，或新建其他书籍与主题。');
 const next:IntakeSearch={round:search.round+1,state:'searching',requestId,commandHash:fingerprint,cycleId:automatic?(search.cycleId||hash([row.id,search.round])):requestId};
 const changed={meta:{changes:writeStory(repo.db,row.id,row.user_id,`UPDATE stories SET document=json_set(document,'$.intake.search',json(?),'$.intake.phase',CASE WHEN json_type(document,'$.intake.selected')='object' THEN json_extract(document,'$.intake.phase') ELSE 'discovering' END),updated_at=?
  WHERE id=? AND user_id=? AND COALESCE(json_extract(document,'$.intake.search.round'),0)=? AND json_extract(document,'$.intake.phase')!='confirmed'${automatic?" AND json_type(document,'$.intake.selected') IS NOT 'object' AND json_extract(document,'$.intake.phase')='choosing' AND json_extract(document,'$.intake.search.state')='idle'":''} AND ${currentStory}`,[JSON.stringify(next),new Date().toISOString(),row.id,row.user_id,search.round])}};
 // A command that lost the CAS was accepted as a no-op; later replay cannot start a new round.
 if(!changed.meta.changes)await recordNoop(repo.db,row.user_id,row.id,requestId,'setup',fingerprint);
 return repo.get(row.id,row.user_id);
}
export async function changeIntake(repo:ReaderRepository,id:string,uid:string,action:IntakeAction,books?:LocalBooks,attempt=0):Promise<SessionRow>{
 const row=await repo.get(id,uid),doc=JSON.parse(row.document) as Document,intake=doc.intake,selection=selectionSchema.parse(JSON.parse(row.selection));
 const fingerprint=hash(action),receipt=await commandReceipt(repo.db,uid,action.requestId,fingerprint);
 if(receipt){if(receipt.action!=='setup'||receipt.session_id!==id)throw new ReaderError(409,'这个操作编号已用于其他内容。');return row;}
 // 重选草稿可以换选材条件；原文和候选须经替换提交后才进入制作。
 if(doc.reselection&&!['more','search','conditions'].includes(action.action))throw new ReaderError(409,'请在替换选题窗口提交选择；草稿不能开始制作。');
 if(!intake)throw new ReaderError(409,'这篇故事使用旧制作流程，请继续原来的步骤。');
 intake.phase=effectiveIntakePhase(doc,selection)!;
 if(action.action!=='more'&&intake.lastAction?.id===action.requestId){if(intake.lastAction.hash!==fingerprint)throw new ReaderError(409,'此操作编号已用于其他内容。');return row;}
 if(await repo.superseded(id,uid))throw new ReaderError(409,'这篇故事已被替换，请打开书架当前版本。');
 if(action.action==='more'){
  if(intake.selected&&selection.discovery?.mode==='auto'&&selection.discovery.combine)throw new ReaderError(409,'原文已选定，请继续准备故事。');
  return requestSearch(repo,row,doc,action.requestId,fingerprint,action.automatic);
 }
 if(intake.generation!==action.generation)throw new ReaderError(409,'制作内容已由另一次操作更新，请重新打开后继续。');
 if(doc.plan||intake.phase==='confirmed')throw new ReaderError(409,'制作已确认；需要调整时请创建修订版本。');
 if(action.action==='conditions'){
  const stagedReplacement=doc.reselection&&intake.phase==='preparing';
  if(!stagedReplacement&&(intake.selected||!['discovering','choosing'].includes(intake.phase)))throw new ReaderError(409,'这篇故事已经选定，不能修改提取条件。');
  if(row.state==='running'&&row.lock_until>Date.now())throw new ReaderError(409,'当前任务正在保存，请稍后再修改提取条件。');
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
  if(doc.reselection&&next.productionPrompt!==selection.productionPrompt){
   doc.setupRequirements={...doc.setupRequirements,overrides:{...doc.setupRequirements?.overrides,productionPrompt:next.productionPrompt}};
  }
  if(choice)selectSourceCard(doc,choice,round);
  const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,state='idle',error=NULL,lock_token=NULL,lock_until=0,step_key=NULL,step_attempts=0,updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND ${currentStory}`,[JSON.stringify(next),JSON.stringify(doc),new Date().toISOString(),id,uid,row.document,row.selection,row.state])}};
  if(!result.meta.changes){if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);throw new ReaderError(409,'提取条件已更新，请重新打开后继续。');}
  return repo.get(id,uid);
 }
 if(action.action==='search'){
  if(intake.selected||!['discovering','choosing'].includes(intake.phase))throw new ReaderError(409,'这篇故事已经选定，请在重选草稿中修改提取标题。');
  if(row.state==='running'&&row.lock_until>Date.now())throw new ReaderError(409,'当前任务正在保存，请稍后再修改提取标题。');
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
  const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,state='idle',error=NULL,lock_token=NULL,lock_until=0,step_key=NULL,step_attempts=0,updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND ${currentStory}`,[JSON.stringify(selection),JSON.stringify(doc),new Date().toISOString(),id,uid,row.document,row.selection,row.state])}};
  if(!result.meta.changes){if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);throw new ReaderError(409,'查找条件已更新，请重新打开后继续。');}
  return repo.get(id,uid);
 }
 const manual=(settings:ReturnType<typeof artStyleSettings>)=>!sameArtDirection(settings,selection)||!!intake.manualArt;
 const styling=artStyleSettings(intake.draft??selection,action.settings??{});
 if(action.action==='draft'||action.action==='recommend'||action.action==='confirm'){
  const current=intakeDraftToken(intake.draft);
  const {suggestions,overrides}=doc.setupRequirements||{};
  // 旧客户端仍可编辑系统原样建议；历史草稿与新写入的草稿同样要避免覆盖。
  const userDraft=!!intake.draft&&(!!intake.draftEdited||!suggestions||intakeDraftToken(suggestedSettings(selection,suggestions,overrides))!==current);
  const legacyToken=intakeDraftToken(intake.draft?{...intake.draft,acceptancePrompt:intake.draft.acceptancePrompt??selection.acceptancePrompt??''}:undefined);
  const requested=intakeDraftToken({...action.settings,...styling,acceptancePrompt:action.settings.acceptancePrompt??selection.acceptancePrompt??'',length:action.action==='recommend'?intake.draft?.length??'auto':action.settings.length});
  if(action.draftToken!==undefined?action.draftToken!==current:userDraft&&requested!==legacyToken)
   throw new ReaderError(409,'另一台设备更新了制作内容。请查看最新草稿后再操作。');
 }
 if(action.action==='draft'){
  // 同时保存草稿和动作回执；后台仍持有原来的工作锁和输入世代。
  if(!['preparing','confirming'].includes(intake.phase))throw new ReaderError(409,'请先选择故事。');
  const saved={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET document=json_set(document,'$.intake.draft',json(?),'$.intake.draftEdited',json('true'),'$.intake.manualArt',json(?),'$.intake.lastAction',json(?)),updated_at=?
   WHERE id=? AND user_id=? AND document=? AND selection=? AND ${currentStory}`,[JSON.stringify({...action.settings,...styling}),JSON.stringify(manual(styling)),JSON.stringify({id:action.requestId,hash:fingerprint}),new Date().toISOString(),id,uid,row.document,row.selection])}};
  if(!saved.meta.changes){
   if(attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);
   throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');
  }
  return repo.get(id,uid);
 }
 // The lock of a service that died cannot be released by a story that will not run again.
 if(row.state==='running'&&row.lock_until>Date.now())throw new ReaderError(409,'当前任务正在保存，请稍后再修改选择。');
 if(action.action==='choose'){
  const candidate=intake.batches[action.batch]?.stories[action.index];if(!candidate)throw new ReaderError(400,'请选择已保存的候选故事。');
  if(intake.selected?.batch===action.batch&&intake.selected.index===action.index&&['preparing','confirming'].includes(intake.phase))return row;
  const settings=action.settings||intake.draft;
  const nextStyle=artStyleSettings(selection,settings||{});
  if(intake.selected&&action.settings?.artStylePrompt===undefined)nextStyle.artStylePrompt=undefined;
  if(settings){intake.manualArt=manual(nextStyle);Object.assign(selection,settings,nextStyle);}
  else if(intake.selected)delete selection.artStylePrompt;
  const reset=requirementsForReselection(selection,doc.setupRequirements);
  Object.assign(selection,reset.selection);doc.setupRequirements=reset.setup;
  selection.storyTitle=candidate.title;selection.source=candidate.source;delete selection.sourceCard;
  if(!intake.manualArt&&candidate.artRecommendation)selection.artStyle=candidate.artRecommendation.artStyle;
  intake.selected={batch:action.batch,index:action.index};intake.phase='preparing';
  intake.search={...intakeSearch(intake),state:'idle',error:null};
  delete doc.original;delete doc.dag;delete doc.frameRecommendation;doc.frameCountConfirmed=false;selection.length='auto';
 }else{
  if(!intake.selected||intake.phase!=='confirming')throw new ReaderError(409,'请先选择故事并等待制作建议保存。');
  const requirementsChanged=action.settings.productionPrompt!==selection.productionPrompt;
  intake.manualArt=manual(styling);Object.assign(selection,action.settings,styling);
  if(action.action==='recommend'){
   if(requirementsChanged)invalidateStoryBrief(doc);
   intake.draft={...action.settings,...styling,length:'auto'};intake.draftEdited=true;delete doc.frameRecommendation;doc.frameCountConfirmed=false;intake.phase='preparing';selection.length='auto';
  }
  else{
   if(!doc.original||!doc.frameRecommendation)throw new ReaderError(409,'原文和制作建议尚未保存。');
   const chosen=intake.batches[intake.selected.batch]?.stories[intake.selected.index];
   if((intake.briefRequired||chosen?.storyBrief||doc.original.storyBrief)&&!storyBriefVerified(doc.original))throw new ReaderError(409,'故事摘要尚未对照原文核对，请重新准备制作。');
   if(requirementsChanged)invalidateStoryBrief(doc);
   doc.frameCountConfirmed=true;intake.phase='confirmed';
   // Results could no longer be chosen. A call in flight stops at its end and saves its reading position.
   intake.search={...intakeSearch(intake),state:'idle',error:null};
  }
 }
 if(action.action!=='recommend'){delete intake.draft;delete intake.draftEdited;}
 intake.generation++;intake.lastAction={id:action.requestId,hash:fingerprint};
 const result={meta:{changes:writeStory(repo.db,id,uid,`UPDATE stories SET selection=?,document=?,state='idle',error=NULL,lock_token=NULL,lock_until=0,step_key=NULL,step_attempts=0,updated_at=?${action.action==='confirm'?",generation_mode='background',generation_control='active'":''}
  WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND ${currentStory}`,[JSON.stringify(selection),JSON.stringify(doc),new Date().toISOString(),id,uid,row.document,row.selection,row.state])}};
 if(!result.meta.changes){
  const current=await repo.get(id,uid),saved=(JSON.parse(current.document) as Document).intake;
  if(saved?.lastAction?.id===action.requestId&&saved.lastAction.hash===fingerprint)return current;
  // 重读以容纳同一世代的后台进度；草稿操作会重新校验提交时的指纹。
  if(saved?.generation===action.generation&&attempt<3)return changeIntake(repo,id,uid,action,books,attempt+1);
  throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');
 }
 return repo.get(id,uid);
}
