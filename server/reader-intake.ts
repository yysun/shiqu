// Save creation intent before extraction, and serialize each explicit choice independently of queue progress.
import {createHash} from 'node:crypto';
import {emptyDocument,selectionSchema,ReaderError} from '../lib/reader-model.ts';
import type {Document,Selection,SessionRow} from '../lib/reader-model.ts';
import type {IntakeAction} from '../lib/reader-intake.ts';
import type {ReaderRepository} from '../lib/reader-repository.ts';
import {maxSuggestionBatches} from '../lib/reader-suggestions.ts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function createIntake(repo:ReaderRepository,id:string,uid:string,input:Selection){
 const selection=selectionSchema.parse({...input,storyTitle:undefined,source:undefined,length:'auto',narrativeDetail:input.narrativeDetail||'balanced'});
 if(selection.bookId==='other'&&!selection.customBook?.trim())throw new ReaderError(400,'请先填写书名或 URL。');
 const creationHash=hash(selection),now=new Date().toISOString(),doc:Document={...emptyDocument(),intake:{phase:'discovering',generation:0,creationHash,batches:[]}};
 await repo.db.prepare("INSERT INTO reader_sessions(id,user_id,selection,document,generation_mode,generation_control,state,step_attempts,lock_until,page,saved,created_at,updated_at) VALUES(?,?,?,?,'background','active','idle',0,0,0,0,?,?) ON CONFLICT(id) DO NOTHING")
  .bind(id,uid,JSON.stringify(selection),JSON.stringify(doc),now,now).run();
 const row=await repo.get(id,uid);
 if((JSON.parse(row.document) as Document).intake?.creationHash!==creationHash)throw new ReaderError(409,'此创建编号已用于其他内容，请重新创建。');
 return row;
}
export async function changeIntake(repo:ReaderRepository,id:string,uid:string,action:IntakeAction):Promise<SessionRow>{
 const row=await repo.get(id,uid),doc=JSON.parse(row.document) as Document,intake=doc.intake,selection=selectionSchema.parse(JSON.parse(row.selection));
 if(!intake)throw new ReaderError(409,'这篇故事使用旧制作流程，请继续原来的步骤。');
 const fingerprint=hash(action);
 if(intake.lastAction?.id===action.requestId){if(intake.lastAction.hash!==fingerprint)throw new ReaderError(409,'此操作编号已用于其他内容。');return row;}
 if(intake.generation!==action.generation)throw new ReaderError(409,'制作内容已由另一次操作更新，请重新打开后继续。');
 if(row.state==='running')throw new ReaderError(409,'当前任务正在保存，请稍后再修改选择。');
 if(doc.plan||intake.phase==='confirmed')throw new ReaderError(409,'制作已确认；需要调整时请创建修订版本。');
 if((action.action==='choose'||action.action==='more')&&action.settings){Object.assign(selection,action.settings);intake.manualArt=true;}
 if(action.action==='more'){
  if(intake.batches.length>=maxSuggestionBatches)throw new ReaderError(400,'已保存40批候选，请回看选择，或新建其他书籍与主题。');
  intake.phase='discovering';delete intake.progress;
 }else if(action.action==='choose'){
  const candidate=intake.batches[action.batch]?.stories[action.index];if(!candidate)throw new ReaderError(400,'请选择已保存的候选故事。');
  if(!action.settings&&intake.selected?.batch===action.batch&&intake.selected.index===action.index&&['preparing','confirming'].includes(intake.phase))return row;
  selection.storyTitle=candidate.title;selection.source=candidate.source;
  if(!intake.manualArt&&candidate.artRecommendation)selection.artStyle=candidate.artRecommendation.artStyle;
  intake.selected={batch:action.batch,index:action.index};intake.phase='preparing';
  delete doc.original;delete doc.frameRecommendation;doc.frameCountConfirmed=false;selection.length='auto';
 }else{
  if(!intake.selected||intake.phase!=='confirming')throw new ReaderError(409,'请先选择故事并等待制作建议保存。');
  Object.assign(selection,action.settings);intake.manualArt=true;
  if(action.action==='recommend'){delete doc.frameRecommendation;doc.frameCountConfirmed=false;intake.phase='preparing';selection.length='auto';}
  else{if(!doc.original||!doc.frameRecommendation)throw new ReaderError(409,'原文和制作建议尚未保存。');doc.frameCountConfirmed=true;intake.phase='confirmed';}
 }
 intake.generation++;intake.lastAction={id:action.requestId,hash:fingerprint};
 const result=await repo.db.prepare(`UPDATE reader_sessions SET selection=?,document=?,state='idle',error=NULL,lock_token=NULL,lock_until=0,step_key=NULL,step_attempts=0,updated_at=?${action.action==='confirm'?",generation_mode='background',generation_control='active'":''}
  WHERE id=? AND user_id=? AND document=? AND selection=? AND state=? AND NOT EXISTS(SELECT 1 FROM library_deletions WHERE story_id=reader_sessions.id AND user_id=reader_sessions.user_id)`)
  .bind(JSON.stringify(selection),JSON.stringify(doc),new Date().toISOString(),id,uid,row.document,row.selection,row.state).run();
 if(!result.meta.changes){const current=await repo.get(id,uid),saved=(JSON.parse(current.document) as Document).intake;if(saved?.lastAction?.id===action.requestId&&saved.lastAction.hash===fingerprint)return current;throw new ReaderError(409,'制作内容已更新，请重新打开后继续。');}
 return repo.get(id,uid);
}
