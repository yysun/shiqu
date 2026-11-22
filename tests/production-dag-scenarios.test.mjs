// 制作 DAG 经正式协调器的场景：在隔离的 SQLite 书库与受控提供方上运行，和应用使用同一条路径。
// 改一幅配文、保存、重启、继续：审片通过且绘图输入未变时，只重做受影响的审片，不产生任何绘图调用。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until,turn} from './fixtures/production.mjs';
import {story,replies,drive} from './fixtures/production-dag-runner.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {png} from './fixtures/images.mjs';
import {projectDocument} from '../lib/production-dag/document.ts';
import {referenceImageKey} from '../lib/reader-image-assets.ts';

/** 一篇已完成、审片通过的 DAG 故事，图片文件写入隔离书库。 */
async function completedStory(f){
 const id=crypto.randomUUID(),s=story({length:6});s.id=id;
 drive(s,replies());
 for(const key of s.dag.order)await f.media.put(referenceImageKey(id,s.dag.frames[key].image),png,{contentType:'image/png'});
 const doc={...s.doc,dag:s.dag,...projectDocument(s.dag,null)},now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_mode,generation_control,state,created_at,updated_at) VALUES(?,?,?,?,'background','active','completed',?,?)")
  .bind(id,owner,JSON.stringify(s.selection),JSON.stringify(doc),now,now).run();
 return {id,dag:s.dag};
}
const saved=async(f,id)=>JSON.parse((await f.app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(id).first()).document);
const textCalls=control=>control.plans.length+control.outlines.length+control.batches.length+control.reflections.length+control.reflectionRepairs.length+control.frameReviews.length+control.structures.length+control.repairs.length;

test('edit a caption, save, restart and continue: only the affected review runs and nothing is redrawn',async t=>{
 const f=await productionFixture(t,'codex');
 const {id,dag:before}=await completedStory(f);
 const snapshot=await f.json(`sessions/${id}/revisions`);
 const plan=structuredClone(snapshot.plan);
 plan.pages[2].caption='管仲与鲍叔牙分金时，鲍叔让管仲多拿一份。';
 const child=crypto.randomUUID();
 await f.json(`sessions/${id}/revisions`,'POST',{requestId:child,token:snapshot.token,changes:{plan}});

 // 已保存，等待继续：在点击继续之前不产生任何模型调用。
 let doc=await saved(f,child);
 assert.equal(doc.dag.continuation?.reason,'revision-saved');
 assert.equal(doc.dag.frames[doc.dag.order[2]].scene,plan.pages[2].caption);
 for(let i=0;i<20;i++){f.app.services.production.wake();await turn();}
 assert.equal(f.control.reviews.length,0);

 await f.restart();
 await f.json(`sessions/${child}/production-control`,'POST',{action:'continue'});
 await until(async()=>(await f.read(child)).state==='completed',15000);

 doc=await saved(f,child);
 assert.equal(doc.dag.continuation,undefined);
 assert.equal(f.control.reviews.length,1,'one review call for the affected verdicts');
 assert.equal(f.control.calls.length,0,'no drawing calls');
 assert.equal(textCalls(f.control),0,'no planning, repair or frame-count calls');
 // 受影响的结论：被改画幅及相邻画幅的逐幅结论（硬输入变化）与叙事结论（核对输入变化）；其余结论原样保留。
 const recorded=p=>JSON.stringify([p?.inputs,p?.checks??null]);
 const changed=Object.keys(doc.dag.products).filter(k=>/Verdict:/.test(k)&&recorded(doc.dag.products[k])!==recorded(before.products[k])).sort();
 const [, second,third,fourth]=doc.dag.order;
 assert.deepEqual(changed,[`frameVerdict:${second}`,`frameVerdict:${third}`,`frameVerdict:${fourth}`,'narrativeVerdict:'].sort());
 assert.deepEqual(doc.dag.order.map(k=>doc.dag.products[`frameImage:${k}`].hash),before.order.map(k=>before.products[`frameImage:${k}`].hash));
 assert.equal(doc.images.length,6);
 assert.ok(doc.images.every(url=>url.startsWith(`/api/reader/media/${child}/`)),'the new version owns copies of its images');
});
