// 验证制作节拍按内容修订号只读取有变化的故事：触发器覆盖任意写入，未变化的故事不读全文，变化后仍按原规则处理。
// 使用隔离的 SQLite 与受控提供方；暂停的故事不派发任何生成任务。
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,makePlan,selection} from './fixtures/production.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {ReaderProductionCoordinator,productionRevisionSql} from '../server/reader-production.ts';

const original={title:'庄周梦蝶',text:'庄周梦为胡蝶。',url:'https://example.com',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()};

// 记录每条查询返回的行，用于判断节拍是否把故事全文读入 JavaScript。
function recording(database){
 const log=[];
 const statement=(inner,sql)=>new Proxy(inner,{get(target,key){
  if(key==='bind')return(...values)=>statement(target.bind(...values),sql);
  if(key==='first')return async()=>{const row=await target.first();log.push({sql,rows:row?[row]:[]});return row;};
  if(key==='all')return async()=>{const result=await target.all();log.push({sql,rows:result.results});return result;};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 const db=new Proxy(database,{get(target,key){
  if(key==='prepare')return sql=>statement(target.prepare(sql),sql);
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 const fullReads=()=>new Set(log.flatMap(entry=>entry.rows.filter(row=>row&&typeof row==='object'&&'document' in row).map(row=>row.id)));
 return {db,log,fullReads,reset(){log.length=0;}};
}

async function library(t,count=3){
 const f=await productionFixture(t);f.app.stopGeneration();await f.app.services.production.close();
 const database=f.app.services.database,repo=new ReaderRepository(database),owner=f.app.services.ownerId,ids=[];
 for(let i=0;i<count;i++){
  const id=crypto.randomUUID();await repo.create(id,owner,selection);
  await database.prepare("UPDATE stories SET document=?,generation_control='paused' WHERE id=?").bind(JSON.stringify({plan:makePlan(3),original,images:[],audio:[],usage:[]}),id).run();
  ids.push(id);
 }
 const coordinatorFor=async()=>{
  const recorder=recording(database);
  const coordinator=new ReaderProductionCoordinator(recorder.db,f.generation,f.media,{autoStart:false});f.coordinators.push(coordinator);
  return {coordinator,recorder};
 };
 const enqueue=(coordinator,id,job)=>coordinator.queue.enqueue({id:job,sessionId:id,ownerId:owner,kind:'script',pool:'text',version:'v',dependencies:[],payload:{},priority:0});
 const rev=async id=>(await database.prepare('SELECT rev FROM story_revisions WHERE story_id=?').bind(id).first())?.rev??0;
 return {f,database,repo,owner,ids,coordinatorFor,enqueue,rev};
}

test('内容修订号覆盖插入和局部写入，状态变化或写入相同内容不改变',async t=>{
 const {database,repo,owner,ids:[id],rev}=await library(t,1);
 const fresh=crypto.randomUUID();await repo.create(fresh,owner,selection);
 assert.equal(await rev(fresh),1,'新插入的故事修订号从 1 起');
 const start=await rev(id);assert.ok(start>=2,'插入与写入计划各加一');
 await database.prepare("UPDATE stories SET document=json_set(document,'$.images[0]','x') WHERE id=?").bind(id).run();
 assert.equal(await rev(id),start+1,'不更新 updated_at 的局部写入也会改变修订号');
 await database.prepare("UPDATE stories SET state='failed',document=document,selection=selection WHERE id=?").bind(id).run();
 assert.equal(await rev(id),start+1);
 await database.prepare("UPDATE stories SET selection=json_set(selection,'$.displayTitle','新题') WHERE id=?").bind(id).run();
 assert.equal(await rev(id),start+2);
});

test('三处轻量查询都只用覆盖索引',async t=>{
 const {database}=await library(t,1);
 for(const [name,sql] of Object.entries(productionRevisionSql)){
  const statement=database.prepare('EXPLAIN QUERY PLAN '+sql);
  const plan=(await (name==='rebuild'?statement.bind('[]'):statement).all()).results.map(row=>row.detail).join(' | ');
  assert.match(plan,/s USING COVERING INDEX stories_production_scan/,name+': '+plan);
 }
});

test('未变化的故事不再读取全文；局部写入、任务数变化、指定清理和重启时按原规则处理',async t=>{
 const {database,ids:[a,b,c],owner,coordinatorFor,enqueue}=await library(t);
 const {coordinator,recorder}=await coordinatorFor();
 for(const id of [a,b,c])await enqueue(coordinator,id,'job-'+id);
 const graphs=[];coordinator.graph=async row=>{graphs.push(row.id);};
 await database.prepare('INSERT INTO production_demand(session_id,owner_id,viewer_id,page,through_page,expires_at,runtime_id) VALUES(?,?,?,?,?,?,?)')
  .bind(c,owner,'viewer',0,2,Date.now()+3600000,coordinator.runtimeId).run();

 await coordinator.tick();
 assert.deepEqual(recorder.fullReads(),new Set([a,b,c]),'首个节拍完整检查');
 assert.deepEqual(graphs,[c]);
 for(const id of [a,b,c])assert.equal((await database.prepare('SELECT state FROM stories WHERE id=?').bind(id).first()).state,'idle');

 recorder.reset();await coordinator.tick();
 assert.equal(recorder.fullReads().size,0,'内容和计数未变时不读取故事全文');
 assert.deepEqual(graphs,[c]);

 // 已记为不完整的暂停故事被局部写入补齐后，下一个节拍标记完成，其余故事仍不读取。
 await database.prepare("UPDATE stories SET document=json_set(document,'$.images',json(?)) WHERE id=?").bind(JSON.stringify(['a.png','b.png','c.png']),a).run();
 recorder.reset();await coordinator.tick();
 assert.deepEqual(recorder.fullReads(),new Set([a]));
 assert.equal((await database.prepare('SELECT state FROM stories WHERE id=?').bind(a).first()).state,'completed');

 // 只有排队任务数变化时，清理会重新读取该故事。
 await enqueue(coordinator,b,'job-extra');
 recorder.reset();await coordinator.tick();
 assert.deepEqual(recorder.fullReads(),new Set([b]));

 // 只有失败任务数变化时同样重新读取。
 await database.prepare("UPDATE production_jobs SET state='failed',error='受控失败' WHERE id=?").bind('job-extra').run();
 recorder.reset();await coordinator.tick();
 assert.deepEqual(recorder.fullReads(),new Set([b]));

 // 指定清理未变化的故事时仍执行。
 recorder.reset();await coordinator.pruneSuperseded(c);
 assert.deepEqual(recorder.fullReads(),new Set([c]));

 // 需求中的故事被局部写入后重建任务图。
 await database.prepare("UPDATE stories SET document=json_set(document,'$.images[0]','a.png') WHERE id=?").bind(c).run();
 recorder.reset();await coordinator.tick();
 assert.deepEqual(graphs,[c,c]);
 assert.ok(recorder.fullReads().has(c));

 // 已删除的故事不再重建任务图，即使内容变化。
 await database.prepare('INSERT INTO library_deletions(user_id,story_id,kind,deleted_at) VALUES(?,?,?,?)').bind(owner,c,'generated',new Date().toISOString()).run();
 await database.prepare("UPDATE stories SET document=json_set(document,'$.images[1]','b.png') WHERE id=?").bind(c).run();
 recorder.reset();await coordinator.tick();
 assert.deepEqual(graphs,[c,c]);
 await database.prepare('DELETE FROM library_deletions WHERE story_id=?').bind(c).run();

 // 新协调器（模拟重启）首个节拍重新完整检查仍在候选中的故事；已完成的 a 仍有排队任务，清理会读取它。
 const restarted=await coordinatorFor();restarted.coordinator.graph=async()=>{};
 await restarted.coordinator.tick();
 assert.deepEqual(restarted.recorder.fullReads(),new Set([a,b,c]));
 restarted.recorder.reset();await restarted.coordinator.tick();
 assert.equal(restarted.recorder.fullReads().size,0);
});
