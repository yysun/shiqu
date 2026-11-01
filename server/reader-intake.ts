// Save creation intent before extraction, and serialize each explicit choice independently of queue progress.
// Search and setting drafts use targeted writes: neither replaces the selection or a running step's lock.
import {directBookChoice} from './local-book-contents.ts';
import type {LocalBooks} from './local-books.ts';
import {createHash} from 'node:crypto';
import {emptyDocument,selectionSchema,ReaderError} from '../lib/reader-model.ts';
import type {Document,Selection,SessionRow} from '../lib/reader-model.ts';
import {effectiveIntakePhase,intakeSearch} from '../lib/reader-intake.ts';
import type {IntakeAction,IntakeSearch} from '../lib/reader-intake.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {maxSuggestionBatches} from '../lib/reader-suggestions.ts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const visible='NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=reader_sessions.id AND user_id=reader_sessions.user_id)';
export async function createIntake(repo:ReaderRepository,id:string,uid:string,input:Selection,books?:LocalBooks){
 if(input.source&&!books)throw new ReaderError(503,'本地书库暂不可用');
 const choice=input.source?await directBookChoice(books!,input):null;
 const selection=selectionSchema.parse({...input,storyTitle:choice?.entry.title,source:choice?.entry.source,length:'auto',narrativeDetail:input.narrativeDetail||'balanced'});
 if(selection.bookId==='other'&&!selection.customBook?.trim())throw new ReaderError(400,'请先填写书名或 URL。');
 const creationHash=hash(selection),now=new Date().toISOString(),doc:Document={...emptyDocument(),intake:{phase:'discovering',generation:0,creationHash,batches:[],search:{round:1,state:'searching'}}};
 if(choice){doc.original=choice.original;doc.intake!.phase='preparing';doc.intake!.search={round:0,state:'idle'};doc.intake!.selected={batch:0,index:0};doc.intake!.batches=[{stories:[{title:choice.entry.title,description:choice.entry.excerpt,source:choice.entry.source,sourceLabel:choice.original.title.slice(0,150)}],note:''}];}
 await repo.db.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,generation_control,state,step_attempts,lock_until,page,saved,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',0,0,0,0,?,?) ON CONFLICT(id) DO NOTHING")
  .bind(id,uid,JSON.stringify(selection),JSON.stringify(doc),now,now).run();
 const row=await repo.get(id,uid);
 if((JSON.parse(row.document) as Document).intake?.creationHash!==creationHash)throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;
}
// Search stands outside the selection's generation, so another device's choice never rejects it.
async function requestSearch(repo:ReaderRepository,row:SessionRow,doc:Document,requestId:string){
 const intake=doc.intake!,search=intakeSearch(intake);
 if(search.state==='searching'||search.state==='idle'&&search.requestId===requestId)return row;
 if(doc.plan||intake.phase==='confirmed')throw new ReaderError(409,'制作已确认；需要调整时请创建修订版本。');
 if(intake.batches.length>=maxSuggestionBatches)throw new ReaderError(400,'已保存40批候选，请回看选择，或新建其他书籍与主题。');
 const next:IntakeSearch={round:search.round+1,state:'searching',requestId};
 await repo.db.prepare(`UPDATE reader_sessions SET document=json_set(document,'$.intake.search',json(?),'$.intake.phase',CASE WHEN json_type(document,'$.intake.selected')='object' THEN json_extract(document,'$.intake.phase') ELSE 'discovering' END),updated_at=?
  WHERE id=? AND user_id=? AND COALESCE(json_extract(document,'$.intake.search.round'),0)=? AND json_extract(document,'$.intake.phase')!='confirmed' AND ${visible}`)
  .bind(JSON.stringify(next),new Date().toISOString(),row.id,row.user_id,search.round).run();
 // A lost race means another request started the same search.
 return repo.get(row.id,row.user_id);
}
export async function changeIntake(repo:ReaderRepository,id:string,uid:string,action:IntakeAction,attempt=0):Promise<SessionRow>{
 const row=await repo.get(id,uid),doc=JSON.parse(row.document) as Document,intake=doc.intake,selection=selectionSchema.parse(JSON.parse(row.selection));
 if(!intake)throw new ReaderError(409,'这篇故事使用旧制作流程，请继续原来的步骤。');
 intake.phase=effectiveIntakePhase(doc,selection)!;
 if(action.action==='more')return requestSearch(repo,row,doc,action.requestId);
 const fingerprint=hash(action);
 if(intake.lastAction?.id===action.requestId){if(intake.lastAction.hash!==fingerprint)throw new ReaderError(409,'此操作编号已用于其他内容。');return row;}
 if(intake.generation!==action.generation)throw new ReaderError(409,'制作内容已由另一次操作更新，请重新打开后继续。');
 if(doc.plan||intake.phase==='confirmed')throw new ReaderError(409,'制作已确认；需要调整时请创建修订版本。');
 const manual=(artStyle:Selection['artStyle'])=>artStyle!==selection.artStyle||!!intake.manualArt;
 if(action.action==='draft'){
  // The running step keeps its lock and its input version; confirming applies these settings.
  if(!['preparing','confirming'].includes(intake.phase))throw new ReaderError(409,'请先选择故事。');
  await repo.db.prepare(`UPDATE reader_sessions SET document=json_set(document,'$.intake.draft',json(?),'$.intake.manualArt',json(?)),updated_at=? WHERE id=? AND user_id=? AND json_extract(document,'$.intake.generation')=? AND json_extract(document,'$.intake.phase')!='confirmed' AND ${visible}`)
   .bind(JSON.stringify(action.settings),JSON.stringify(manual(action.settings.artStyle)),new Date().toISOString(),id,uid,action.generation).run();
  return repo.get(id,uid);
 }
 // The lock of a service that died cannot be released by a story that will not run again.
 if(row.state==='running'&&row.lock_until>Date.now())throw new ReaderError(409,'当前任务正在保存，请稍后再修改选择。');
 if(action.action==='choose'){
  const candidate=intake.batches[action.batch]?.stories[action.index];if(!candidate)throw new ReaderError(400,'请选择已保存的候选故事。');
  if(intake.selected?.batch===action.batch&&intake.selected.index===action.index&&['preparing','confirming'].includes(intake.phase))return row;
  if(action.settings){intake.manualArt=manual(action.settings.artStyle);Object.assign(selection,action.settings);}
  selection.storyTitle=candidate.title;selection.source=candidate.source;
  if(!intake.manualArt&&candidate.artRecommendation)selection.artStyle=candidate.artRecommendation.artStyle;
  intake.selected={batch:action.batch,index:action.index};intake.phase='preparing';
  delete doc.original;delete doc.frameRecommendation;doc.frameCountConfirmed=false;selection.length='auto';
 }else{
  if(!intake.selected||intake.phase!=='confirming')throw new ReaderError(409,'请先选择故事并等待制作建议保存。');
  intake.manualArt=manual(action.settings.artStyle);Object.assign(selection,action.settings);
  if(action.action==='recommend'){delete doc.frameRecommendation;doc.frameCountConfirmed=false;intake.phase='preparing';selection.length='auto';}
  else{
   if(!doc.original||!doc.frameRecommendation)throw new ReaderError(409,'原文和制作建议尚未保存。');
   doc.frameCountConfirmed=true;intake.phase='confirmed';
   // Results could no longer be chosen. A call in flight stops at its end and saves its reading position.
   intake.search={...intakeSearch(intake),state:'idle',error:null};
  }
 }
 delete intake.draft;
 intake.generation++;intake.lastAction={id:action.requestId,hash:fingerprint};
 const result=await repo.db.prepare(`UPDATE reader_sessions SET selection=?,document=?,state='idle',error=NULL,lock_token=NULL,lock_until=0,step_key=NULL,step_attempts=0,updated_at=?${action.action==='confirm'?",generation_mode='background',generation_control='active'":''}
  WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND ${visible}`)
  .bind(JSON.stringify(selection),JSON.stringify(doc),new Date().toISOString(),id,uid,row.document,row.selection,row.state).run();
 if(!result.meta.changes){
  const current=await repo.get(id,uid),saved=(JSON.parse(current.document) as Document).intake;
  if(saved?.lastAction?.id===action.requestId&&saved.lastAction.hash===fingerprint)return current;
  // Search results and drafts land without a new generation, and they do not conflict with this choice.
  if(saved?.generation===action.generation&&attempt<3)return changeIntake(repo,id,uid,action,attempt+1);
  throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');
 }
 return repo.get(id,uid);
}
