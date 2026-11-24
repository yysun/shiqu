// Draft discovery stays off the shelf; one current-family CAS promotes only an explicit new choice.
// Existing rows are the durable version receipts, so replay never reapplies inherited control.
import {requirementsForReselection} from '../lib/reader-requirements.ts';
import {ReaderError,selectionSchema} from '../lib/reader-model.ts';
import type {Document,SessionRow} from '../lib/reader-model.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {markStoryDeleted} from '../lib/reader-repository.ts';
import {transact,writeStory} from './production-records.ts';
import type {LocalBooks} from './local-books.ts';
import type {ReplacementChoice} from '../lib/reader-reselection.ts';
import {localSourceKey} from '../lib/reader-source-key.ts';
import {isDirectSourceSelection} from '../lib/reader-discovery-themes.ts';
import {createIntake} from './reader-intake.ts';
import {revisionBasis,replacementToken,familyEpoch,currentFamilyVersion} from './reader-revisions.ts';
import {commandFingerprint,commandReceipt} from './reader-commands.ts';
import {authorizeProductionCommand,authorizeReselectionCancel,authorizeReselectionCommit} from '../lib/production-lifecycle.ts';

function inheritedRequirements(row:SessionRow,doc:Document,intakeGeneration?:number){
 const selection=selectionSchema.parse(JSON.parse(row.selection));
 const draft=intakeGeneration===undefined?undefined:doc.intake?.draft;
 // 确认前的编辑和自动建议都在制作草稿里，已确认版本以正式设置为准。
 if(draft){
  selection.productionPrompt=draft.productionPrompt;
  selection.acceptancePrompt=draft.acceptancePrompt??selection.acceptancePrompt;
 }
 return requirementsForReselection(selection,doc.setupRequirements);
}

function inheritedRequirementsToken(inherited:ReturnType<typeof inheritedRequirements>){
 const {selection,setup:{overrides}}=inherited;
 return commandFingerprint([
  overrides?.productionPrompt??(selection.productionPrompt||null),
  overrides?.acceptancePrompt??(selection.acceptancePrompt||null),
 ]);
}

export function replacementCommitState(draft:NonNullable<Document['reselection']>,parent:SessionRow|undefined,basis:Pick<Awaited<ReturnType<typeof revisionBasis>>,'doc'|'epoch'|'intakeGeneration'>|undefined){
 return {
  basisCurrent:!!parent&&!!basis&&basis.epoch===draft.epoch&&replacementToken(parent.selection,basis.epoch,basis.intakeGeneration)===draft.baseToken,
  requirementsCurrent:!!parent&&!!basis&&(!draft.requirementsToken||draft.requirementsToken===inheritedRequirementsToken(inheritedRequirements(parent,basis.doc,basis.intakeGeneration))),
 };
}

export async function openReselection(repo:ReaderRepository,parentId:string,ownerId:string,requestId:string,books?:LocalBooks){
 const existing=await repo.db.prepare('SELECT * FROM stories WHERE id=?').bind(requestId).first<SessionRow>();
 if(existing){
  const doc=JSON.parse(existing.document) as Document;
  if(existing.user_id!==ownerId||(doc.reselection?.parentId!==parentId&&!(doc.revision?.kind==='selection'&&doc.revision.parentId===parentId)))throw new ReaderError(409,'这个操作编号已用于其他内容。');
  return repo.get(requestId,ownerId);
 }
 if(await commandReceipt(repo.db,ownerId,requestId))throw new ReaderError(409,'这个操作编号已用于其他内容。');
 const row=await repo.get(parentId,ownerId),{doc,epoch,rootId,intakeGeneration}=await revisionBasis(repo,row,true);
 const reset=inheritedRequirements(row,doc,intakeGeneration),selection=reset.selection;
 const settings={...selection,artStylePrompt:undefined,displayTitle:undefined,storyTitle:undefined,source:undefined,sourceCard:undefined};
 if(settings.discovery?.mode==='auto'&&settings.discovery.combine){
  settings.discovery=undefined;
  settings.discoverySources=undefined;
 }
 const draft={parentId,rootId,epoch,baseToken:replacementToken(row.selection,epoch,intakeGeneration),
  ...(intakeGeneration===undefined?{}:{requirementsToken:inheritedRequirementsToken(reset)})};
 return createIntake(repo,requestId,ownerId,{...settings,length:'auto'},books,{draft,setup:reset.setup,beforeInsert:db=>{
  const current=db.get<SessionRow>(`SELECT p.* FROM stories p WHERE p.id=? AND p.user_id=? AND ${currentFamilyVersion('p')}`,parentId,ownerId);
  const currentDoc=current&&JSON.parse(current.document) as Document|undefined;
  const intake=currentDoc?.intake?.phase!=='confirmed'?currentDoc?.intake:undefined;
  const basisCurrent=!!current&&replacementToken(current.selection,epoch,intake?.generation)===draft.baseToken
   &&(!draft.requirementsToken||draft.requirementsToken===inheritedRequirementsToken(inheritedRequirements(current,currentDoc!,intake?.generation)));
  const authorization=authorizeProductionCommand('open-reselection',{
   version:current?'current':'superseded',control:current?.generation_control??'active',continuation:!!currentDoc?.dag?.continuation,
   targetCurrent:basisCurrent,targetReady:!intake||!!intake.selected,stopping:false,
  });
  if(!authorization.allowed)throw new ReaderError(authorization.status,authorization.message);
 }});
}

export async function commitReselection(repo:ReaderRepository,parentId:string,draftId:string,ownerId:string,choice:ReplacementChoice,attempt=0):Promise<SessionRow>{
 const fingerprint=commandFingerprint(['replace',parentId,draftId,choice]);
 const receipt=await commandReceipt(repo.db,ownerId,choice.requestId,fingerprint);
 if(receipt){if(receipt.session_id!==parentId)throw new ReaderError(409,'操作编号冲突。');if(receipt.action==='replace'&&receipt.result_id)return repo.get(receipt.result_id,ownerId);if(receipt.action==='same-selection')return repo.current(parentId,ownerId);throw new ReaderError(409,'操作编号冲突。');}
 const row=await repo.get(draftId,ownerId),doc=JSON.parse(row.document) as Document;
 if(doc.revision?.kind==='selection'){
  if(doc.revision.parentId!==parentId||doc.revision.selectionRequest!==choice.requestId||doc.revision.requestHash!==fingerprint)throw new ReaderError(409,'这次替换已提交或操作编号冲突，请刷新当前版本。');
  return row;
 }
 const draft=doc.reselection!,intake=doc.intake!;
 const draftCurrent=draft?.parentId===parentId&&!!intake,generationCurrent=choice.generation===undefined||choice.generation===intake?.generation;
 const parent=draftCurrent&&generationCurrent?await repo.get(parentId,ownerId):undefined;
 const basis=parent&&await revisionBasis(repo,parent,true);
 const picked=intake?.batches[choice.batch]?.stories[choice.index];
 const authorization=authorizeReselectionCommit({
  draftCurrent,generationCurrent,candidateExists:!!picked,
  ...(draft?replacementCommitState(draft,parent,basis):{basisCurrent:false,requirementsCurrent:false}),
 });
 if(authorization.effect==='reject')throw new ReaderError(authorization.status,authorization.message);
 const source=parent!,current=basis!,candidate=picked!;
 const previous=selectionSchema.parse(JSON.parse(source.selection));
 const same=!!candidate.source&&!!previous.source&&localSourceKey(candidate.source)===localSourceKey(previous.source);
 if(same){
  // 等价替换的回执与草稿关闭同时提交，草稿或原版依据变化后不会关闭新内容。
  const accepted=transact(repo.db,db=>{
   const replay=db.get<{action:string;session_id:string;fingerprint:string}>('SELECT action,session_id,fingerprint FROM reader_commands WHERE owner_id=? AND request_id=?',ownerId,choice.requestId);
   if(replay){
    if(replay.action!=='same-selection'||replay.session_id!==parentId||replay.fingerprint!==fingerprint)throw new ReaderError(409,'操作编号冲突。');
    return true;
   }
   if(db.get('SELECT id FROM stories WHERE user_id=? AND id=?',ownerId,choice.requestId))throw new ReaderError(409,'操作编号冲突。');
   const savedDraft=db.get(`SELECT id FROM stories WHERE id=? AND user_id=? AND document=? AND ${currentFamilyVersion('stories')}`,draftId,ownerId,row.document);
   const savedParent=db.get(`SELECT id FROM stories WHERE id=? AND user_id=? AND document=? AND json_remove(selection,'$.displayTitle')=json_remove(?,'$.displayTitle') AND ${currentFamilyVersion('stories')}`,parentId,ownerId,source.document,source.selection);
   if(!savedDraft||!savedParent)return false;
   const now=Date.now();
   db.run("INSERT INTO reader_commands(request_id,owner_id,session_id,action,fingerprint,payload,result_id,created_at,updated_at) VALUES(?,?,?,'same-selection',?,'{}',?,?,?)",choice.requestId,ownerId,parentId,fingerprint,parentId,now,now);
   markStoryDeleted(db,draftId,ownerId,new Date(now).toISOString());
   return true;
  });
  if(!accepted){
   if(attempt<3)return commitReselection(repo,parentId,draftId,ownerId,choice,attempt+1);
   throw new ReaderError(409,'当前版本或草稿已更新，请重新核对。');
  }
  return repo.current(parentId,ownerId);
 }
 const baseline=selectionSchema.parse(JSON.parse(row.selection)),inherited=current.doc.setupRequirements?.suggestions;
 const settings={...intake.draft,...choice.settings},overrides={...doc.setupRequirements?.overrides};
 // A draft starts with inherited automatic text removed. Preserve edits to that baseline,
 // including blanks; older callers may still submit the parent's unchanged suggestions.
 for(const key of ['productionPrompt','acceptancePrompt'] as const){
  const value=settings[key];
  if(value===undefined)continue;
  if(value===inherited?.[key]){settings[key]='';delete overrides[key];}
  else if(value!==(baseline[key]||''))overrides[key]=value;
 }
 const selection=selectionSchema.parse({...baseline,...settings,storyTitle:candidate.title,source:candidate.source,length:'auto'});
 // 直接选段已保存并核对原文；普通搜索候选仍按现有流程在提交后准备。
 const combined=baseline.discovery?.mode==='auto'&&baseline.discovery.combine;
 const direct=!!doc.original&&(combined||isDirectSourceSelection(baseline))&&!!candidate.source&&!!baseline.source&&
  localSourceKey(baseline.source)===localSourceKey(candidate.source);
 doc.setupRequirements={overrides};
 delete selection.displayTitle;
 if(!intake.manualArt&&!choice.settings&&candidate.artRecommendation)selection.artStyle=candidate.artRecommendation.artStyle;
 delete doc.reselection;if(!direct)delete doc.original;
 delete doc.dag;delete doc.frameRecommendation;delete doc.storyboard;delete doc.draft;delete doc.visualReview;
 doc.plan=null;doc.images=[];doc.audio=[];doc.usage=[];doc.frameCountConfirmed=false;
 intake.phase='preparing';intake.selected={batch:choice.batch,index:choice.index};intake.generation++;
 intake.search={...(intake.search||{round:0}),state:'idle',error:null};
 delete intake.draft;delete intake.draftEdited;
 doc.revision={kind:'selection',selectionRequest:choice.requestId,parentId,rootId:draft.rootId,number:draft.epoch+1,baseToken:draft.baseToken,requestHash:fingerprint,base:{selection,plan:null,images:[]}};
 const now=new Date().toISOString(),requirementsBasis=draft.requirementsToken?source.document:null;
 const changed={meta:{changes:writeStory(repo.db,draftId,ownerId,`UPDATE stories AS d SET
  selection=?,document=json_patch(?,json_object('publication',json_extract(p.document,'$.publication'))),
  generation_mode=p.generation_mode,generation_control=p.generation_control,state='idle',error=NULL,
  step_key=NULL,step_attempts=0,lock_token=NULL,lock_until=0,page=0,saved=p.saved,last_read_at=NULL,updated_at=?
  FROM stories p WHERE d.id=? AND d.user_id=? AND d.document=? AND p.id=? AND p.user_id=?
   AND ${currentFamilyVersion('p')} AND json_remove(p.selection,'$.displayTitle')=json_remove(?,'$.displayTitle')
   AND NOT EXISTS(SELECT 1 FROM library_deletions x WHERE x.story_id=d.id AND x.user_id=d.user_id)
   AND NOT EXISTS(SELECT 1 FROM reader_commands c WHERE c.owner_id=? AND c.request_id=?)
   AND NOT EXISTS(SELECT 1 FROM stories occupied WHERE occupied.user_id=? AND occupied.id=?)
   AND (${familyEpoch.replace(' AS epoch','')})=?
   AND (? IS NULL OR json_extract(p.document,'$.intake.generation')=?)
   AND (? IS NULL OR p.document=?)`,[JSON.stringify(selection),JSON.stringify(doc),now,draftId,ownerId,row.document,parentId,ownerId,source.selection,ownerId,choice.requestId,ownerId,choice.requestId,ownerId,draft.rootId,draft.rootId,draft.epoch,current.intakeGeneration??null,current.intakeGeneration??null,requirementsBasis,requirementsBasis])}};
 if(!changed.meta.changes){
  const current=await repo.get(draftId,ownerId),saved=JSON.parse(current.document) as Document;
  if(saved.revision?.kind==='selection'||saved.reselection?.baseToken===draft.baseToken&&attempt<3)return commitReselection(repo,parentId,draftId,ownerId,choice,attempt+1);
  throw new ReaderError(409,'当前版本或草稿已更新，请重新核对。');
 }
 return repo.get(draftId,ownerId);
}

export async function cancelReselection(repo:ReaderRepository,parentId:string,draftId:string,ownerId:string){
 // 草稿归属和删除必须在同一事务核对，避免取消时删除刚提交的正式版本。
 transact(repo.db,db=>{
  const row=db.get<{document:string}>('SELECT document FROM stories WHERE id=? AND user_id=?',draftId,ownerId);
  if(!row)throw new ReaderError(404,'选题草稿不存在。');
  const doc=JSON.parse(row.document) as Document;
  const target=doc.reselection?.parentId===parentId?'draft':doc.revision?.kind==='selection'&&doc.revision.parentId===parentId?'promoted':'foreign';
  const authorization=authorizeReselectionCancel(target);
  if(authorization.effect==='reject')throw new ReaderError(authorization.status,authorization.message);
  if(authorization.effect==='apply')markStoryDeleted(db,draftId,ownerId);
 });
 return repo.current(parentId,ownerId);
}
