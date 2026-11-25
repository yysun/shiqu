// 制作 DAG 修订类测试共用的故事夹具：已完成、已确认的 DAG 故事直接写入隔离书库，修订走正式接口。
// 与 tests/production-dag-scenarios.test.mjs 中的同名辅助函数一致，供修订、版本、署名等测试复用。
import assert from 'node:assert/strict';
import {until} from './production.mjs';
import {story,replies,drive} from './production-dag-runner.mjs';
import {owner} from './book-reference.mjs';
import {png} from './images.mjs';
import {decodeDocument,projectDocument,emptyDag} from '../../lib/production-dag/document.ts';
import {selection} from './production-data.mjs';
import {referenceImageKey} from '../../lib/reader-image-assets.ts';

/** 一篇已完成、审片通过的 DAG 故事，图片文件写入隔离书库。 */
export async function completedStory(f,{length=6,selection:over={},extra={}}={}){
 const id=crypto.randomUUID(),s=story({length,...over});s.id=id;
 drive(s,replies());
 for(const key of s.dag.order)await f.media.put(referenceImageKey(id,s.dag.frames[key].image),png,{contentType:'image/png'});
 const doc={...s.doc,dag:s.dag,...projectDocument(s.dag,null),...extra},now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'active',1,?,?)")
  .bind(id,owner,JSON.stringify(s.selection),JSON.stringify(doc),now,now).run();
 return {id,dag:s.dag};
}
export const saved=async(f,id)=>decodeDocument(await f.app.services.database.prepare('SELECT * FROM story_rows WHERE id=?').bind(id).first());
export const savedSelection=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT selection FROM stories WHERE id=?').bind(id).first()).selection);

export const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事。 */
export async function confirmedStory(f,length=4,prepared={},over={}){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag(),...prepared};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'active',0,?,?)")
  .bind(id,owner,JSON.stringify({...selection,length,...over}),JSON.stringify(doc),now,now).run();
 return id;
}

/** 保存一次修订并继续制作到完成；返回新版文档。 */
export async function revise(f,id,changes,{expectContinue=true,paused=false}={}){
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:typeof changes==='function'?changes(snapshot):changes,...(paused?{paused:true}:{})});
 if(expectContinue){
  assert.equal((await saved(f,child)).dag.continuation?.reason,'revision-saved');
  await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 }
 await until(async()=>(await f.read(child)).state==='completed',20000);
 return {child,doc:await saved(f,child)};
}
export const snapshotOf=(f,id)=>f.json(`sessions/${id}/revisions`);
