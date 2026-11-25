// 格式 4 存储制作内容和版本引用。选择变更与引用在同一事务提交。
import {createHash} from 'node:crypto';
import {newRepairBudget} from '../lib/production-dag/review.ts';
import type {Document} from '../lib/reader-model.ts';
import type {SyncStatements} from '../lib/reader-repository.ts';
import {encodeDocument} from '../lib/production-dag/document.ts';
import {fingerprint} from '../lib/production-dag/fingerprint.ts';

/** 保留所有已保存文字和字段。只统一对象键顺序以比较存储值。 */
export function productionStorageHash(value:unknown){
 const json=JSON.stringify(value,(_key,entry)=>
  entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
 return createHash('sha256').update(json??'null').digest('hex');
}

export function insertFamilyProduct(db:SyncStatements,owner:string,root:string,target:string,inputHash:string,contentHash:string,content:unknown){
 db.run(`INSERT INTO production_products(owner_id,root_id,target,input_hash,content_hash,content)
  VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,root_id,target,input_hash,content_hash) DO NOTHING`,
  owner,root,target,inputHash,contentHash,JSON.stringify(content));
}

function canonicalPicture(db:SyncStatements,owner:string,root:string,url:string){
 const prefix='/api/reader/media/';
 if(!url.startsWith(prefix))return url;
 const alias=db.get<{target_key:string}>('SELECT target_key FROM production_media_aliases WHERE alias_key=? AND owner_id=? AND root_id=?',
  'reader/'+url.slice(prefix.length),owner,root);
 return alias?prefix+alias.target_key.slice('reader/'.length):url;
}

export function setFamilyImageReadability(db:SyncStatements,id:string,owner:string,picture:string,readable:boolean){
 const root=db.get<{root_id:string}>('SELECT root_id FROM story_revisions WHERE story_id=? AND owner_id=?',id,owner)?.root_id??id;
 const url=canonicalPicture(db,owner,root,picture);
 const {changes}=db.run(`INSERT INTO production_media_health(owner_id,root_id,url,readable) VALUES(?,?,?,?)
  ON CONFLICT(owner_id,root_id,url) DO UPDATE SET readable=excluded.readable WHERE readable<>excluded.readable`,owner,root,url,Number(readable));
 if(changes)db.run(`UPDATE story_revisions SET rev=rev+1 WHERE owner_id=? AND root_id=? AND story_id IN (
  SELECT r.session_id FROM production_product_refs r JOIN production_products p ON p.id=r.product_id AND p.owner_id=r.owner_id
  WHERE p.owner_id=? AND p.root_id=? AND p.target LIKE 'frameImage:%' AND p.content=?)`,owner,root,owner,root,JSON.stringify(url));
}

type RepairContext={now:number;attempt?:{id:string;lease_token:string|null};grant?:string;historical?:true};
export function writeStoryProducts(db:SyncStatements,id:string,owner:string,document:Document,write:(stored:string)=>number,context?:RepairContext){
 const doc=structuredClone(document);
 const dag=doc.dag;
 if(!dag){
  const changes=write(encodeDocument(doc));
  if(changes)db.run('DELETE FROM production_product_refs WHERE session_id=? AND owner_id=?',id,owner);
  return changes;
 }
 const root=doc.revision?.rootId??id,data=[];
 for(const [target,record] of Object.entries(dag.products)){
  const [node,key]=target.split(':',2),frame=dag.frames[key];
  let content:unknown=null;
  switch(node){
   case 'source':content=doc.original;delete doc.original;break;
   case 'brief':content=dag.brief;delete dag.brief;break;
   case 'suggestions':content=doc.frameRecommendation;break;
   case 'characters':content=dag.characters;dag.characters=[];break;
   case 'outline':content=dag.outline;delete dag.outline;break;
   case 'ending':
    if(dag.ending){
     const {title,candidates,...choice}=dag.ending;
     content={title,candidates};
     dag.ending={title:'',candidates:[],...choice};
    }
    break;
   case 'frameCheck':content=dag.frameCheck;delete dag.frameCheck;break;
   case 'scene':if(frame){content=frame.scene;frame.scene='';}break;
   case 'visual':if(frame){content={prompt:frame.visual,drawn:frame.drawnNames??[],recordedDrawn:frame.drawn??[]};frame.visual='';}break;
   case 'frameImage':if(frame){content=frame.image;delete frame.image;}break;
   case 'frameVerdict':case 'narrativeVerdict':
    content={verdict:dag.verdicts?.[target],issues:dag.issues?.filter(issue=>issue.target===target).map(({target:_,stalled:__,handEditedPages:___,...issue})=>{
     void _;void __;void ___;return issue;
    }),...(node==='narrativeVerdict'?{titleChoice:dag.ending?.selectedTitle,endingChoice:dag.ending?.chosen}:{})};
    if(dag.verdicts)delete dag.verdicts[target];
    break;
  }
  data.push({target,record,content:content??null});
 }
 dag.products={};
 const budget=dag.repairs;
 delete dag.repairs;
 dag.productSignature=productionStorageHash([data,budget??null]);
 const changes=write(encodeDocument(doc));
 if(!changes)return changes;
 if(budget&&context){
  const previous=db.get<{used:number;limit:number}>('SELECT used,capacity AS "limit" FROM production_repair_budgets WHERE owner_id=? AND session_id=?',
   owner,id)??newRepairBudget();
  const append=(event:string,detail:unknown,attemptId=context.attempt?.lease_token??context.grant??'repair:'+id)=>
   db.run(`INSERT INTO production_attempt_events(owner_id,session_id,job_id,attempt_id,event,recorded_at,detail)
    VALUES(?,?,?,?,?,?,?)`,owner,id,context.attempt?.id??'',attemptId,event,context.now,JSON.stringify(detail));
  if(context.historical)append('repair-imported',budget);
  else{
   if(budget.used>previous.used)append('repair-applied',{used:budget.used-previous.used});
   if(context.grant&&budget.limit>previous.limit)append('repair-granted',{limit:budget.limit,requestId:context.grant});
  }
 }
 db.run('DELETE FROM production_product_refs WHERE session_id=? AND owner_id=?',id,owner);
 for(const {target,record,content} of data){
  const inputHash=fingerprint(record.inputs);
  const picture=target.startsWith('frameImage:')&&typeof content==='string'?content:undefined;
  const body=picture?canonicalPicture(db,owner,root,picture):content;
  const contentHash=productionStorageHash(body);
  insertFamilyProduct(db,owner,root,target,inputHash,contentHash,body);
  db.run(`INSERT INTO production_product_refs(session_id,owner_id,target,product_id,record)
   SELECT ?,?,?,id,? FROM production_products WHERE owner_id=? AND root_id=? AND target=? AND input_hash=? AND content_hash=?`,
   id,owner,target,JSON.stringify({product:record,...(picture?{picture}:{})}),owner,root,target,inputHash,contentHash);
 }
 return changes;
}
