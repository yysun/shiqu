// Upgrade persisted story metadata before workers start; retain paid image receipts as their
// derived identities change. File replacements are atomic and safe to retry after SQL rollback.
import {existsSync,readdirSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync,openSync,closeSync,constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {selectionSchema} from '../lib/reader-model.ts';
import {inputVersion,productionJobId} from './production-queue.ts';

export const storySummaryMigration='0009_story_summary.sql';
type SavedRow={id:string;user_id:string;selection:string;document:string};
type ImageState={generation?:number;version:string};
function imageState(row:SavedRow):ImageState|undefined{
 let doc,selection;
 try{doc=JSON.parse(row.document);selection=selectionSchema.parse(JSON.parse(row.selection));}catch{return;}
 if(!doc.plan)return;
 const scriptVersion=inputVersion({selection,...(doc.intake?{setupGeneration:doc.intake.generation}:{})});
 return {generation:doc.intake?.generation,version:inputVersion({scriptVersion,plan:doc.plan,style:selection.artStyle,prompt:selection.productionPrompt})};
}
function renameMetadata(value:unknown):{value:unknown;changed:boolean}{
 if(Array.isArray(value)){
  const children=value.map(renameMetadata);return {value:children.map(child=>child.value),changed:children.some(child=>child.changed)};
 }
 if(!value||typeof value!=='object')return {value,changed:false};
 const children=Object.entries(value).map(([key,item])=>[key,renameMetadata(item)] as const);
 const result=Object.fromEntries(children.map(([key,child])=>[key,child.value]));
 const legacy=Object.hasOwn(result,'hook');
 if(legacy){
  if(typeof result.summary!=='string'||!result.summary.trim())result.summary=result.hook;
  delete result.hook;
 }
 return {value:result,changed:legacy||children.some(([,child])=>child.changed)};
}
function migrateMedia(directory:string){
 function visit(folder:string){
  if(!existsSync(folder))return;
  if(lstatSync(folder).isSymbolicLink())throw Error('Summary migration refuses media symlinks');
  for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const filename=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw Error('Summary migration refuses media symlinks');
   if(entry.isDirectory()){visit(filename);continue;}
   if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
   const handle=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let original:string;
   try{original=readFileSync(handle,'utf8');}finally{closeSync(handle);}
   let parsed;try{parsed=JSON.parse(original);}catch{continue;}
   const converted=renameMetadata(parsed);if(!converted.changed)continue;
   const temporary=filename+'.summary-'+randomUUID()+'.tmp';
   try{
    writeFileSync(temporary,JSON.stringify(converted.value)+'\n',{flag:'wx',mode:0o600});
    renameSync(temporary,filename);
   }finally{rmSync(temporary,{force:true});}
  }
 }
 for(const folder of ['reader','reader-cache'])visit(path.join(directory,'media',folder));
}
export function migrateStorySummary(sqlite:DatabaseSync,sql:string,directory?:string){
 const before=sqlite.prepare('SELECT id,user_id,selection,document FROM reader_sessions').all() as unknown as SavedRow[];
 const previous=new Map(before.map(row=>[row.id,imageState(row)]));
 sqlite.exec(sql);
 const targets=new Set<string>(),remapped=new Map<string,string>(),updates:{id:string;version:string;previousId:string}[]=[];
 for(const row of sqlite.prepare('SELECT id,user_id,selection,document FROM reader_sessions').all() as unknown as SavedRow[]){
  const old=previous.get(row.id),next=imageState(row);
  if(!old||!next||old.version===next.version)continue;
  const jobs=sqlite.prepare("SELECT id,kind,payload FROM production_jobs WHERE session_id=? AND owner_id=? AND version=? AND kind IN('image','image-publish')").all(row.id,row.user_id,old.version);
  for(const job of jobs){
   const payload=JSON.parse(String(job.payload));
   if(old.generation!==undefined&&payload.setupGeneration!==old.generation)continue;
   if(!Number.isInteger(payload.page)||payload.page<0)throw Error('Invalid image job in summary migration');
   const id=productionJobId(row.id,String(job.kind),next.version,String(payload.page)),previousId=String(job.id);
   if(targets.has(id)||sqlite.prepare('SELECT id FROM production_jobs WHERE id=?').get(id))throw Error('Image job identity collision in summary migration');
   targets.add(id);remapped.set(previousId,id);updates.push({id,version:next.version,previousId});
  }
 }
 for(const update of updates)sqlite.prepare('UPDATE production_jobs SET id=?,version=? WHERE id=?').run(update.id,update.version,update.previousId);
 if(remapped.size)for(const row of sqlite.prepare('SELECT id,dependencies FROM production_jobs WHERE json_valid(dependencies)').all()){
  const dependencies=JSON.parse(String(row.dependencies));if(!Array.isArray(dependencies))continue;
  const next=dependencies.map(id=>remapped.get(id)||id);
  if(next.some((id,index)=>id!==dependencies[index]))sqlite.prepare('UPDATE production_jobs SET dependencies=? WHERE id=?').run(JSON.stringify(next),row.id);
 }
 if(directory)migrateMedia(directory);
}
