// Isolated R9 measurements against either the recorded source baseline or current implementation.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const source=resolve(process.argv[2]||'.');
const {ReaderProductionCoordinator}=await import(pathToFileURL(source+'/server/reader-production.ts'));
const {ReaderRepository}=await import(pathToFileURL(source+'/lib/reader-repository.ts'));
const {view}=await import(pathToFileURL(source+'/lib/reader-model.ts'));
const {makePlan,selection}=await import('./fixtures/production.mjs');
for(const [name,count,control,blocked,stub] of [['paused',20,'paused',false,false],['active',20,'active',false,true],['blocked',21,'active',true,false],['history',20,'active',true,false]]){
 const db=new DatabaseSync(':memory:');for(const file of readdirSync(source+'/drizzle').filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(source+'/drizzle/'+file,'utf8'));
 let statements=0;
 const adapter={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){statements++;return db.prepare(sql).get(...args)||null;},async all(){statements++;return {results:db.prepare(sql).all(...args)};},async run(){statements++;return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};}};
 const provider={generator(){throw Error('No paid calls allowed');},safeError(){return 'controlled';}};
 const coordinator=new ReaderProductionCoordinator(adapter,provider,{get(){throw Error('No media reads expected');}},{tickMs:3600000});
 if(stub)coordinator.queue.pump=async()=>{};
 await coordinator.tick();
 const repo=new ReaderRepository(adapter);
 for(let i=0;i<count;i++){
  const id=`story-${i}`,row=await repo.create(id,'owner',{...selection,length:80});
  const doc={plan:makePlan(80),original:{title:'庄周梦蝶',text:'庄'.repeat(20000),url:'https://example.com',kind:'passage',provider:'fixture',retrievedAt:new Date().toISOString()},images:Array(80).fill(''),audio:[],usage:[]};
  const isBlocked=blocked&&(name!=='blocked'||i===0);
  if(isBlocked)doc.visualReview={status:'blocked',issues:[],repaired:[],reports:[],repairs:20,round:20,...(name==='history'?{history:Array.from({length:20},(_,round)=>({round,requested:Array.from({length:20},(_,i)=>i+1),changes:makePlan(20).pages.map((page,i)=>({...page,page:i+1,prompt:page.prompt+' staged correction '.repeat(30)}))}))}:{})};
  await adapter.prepare("UPDATE reader_sessions SET document=?,generation_control=?,state=? WHERE id=?").bind(JSON.stringify(doc),'active',isBlocked?'failed':'idle',row.id).run();
  await coordinator.graph(await repo.get(id,'owner'));
  await adapter.prepare('UPDATE reader_sessions SET generation_control=? WHERE id=?').bind(name==='blocked'&&i>0?'paused':control,id).run();
 }
 await coordinator.tick();const samples=[];
 for(let i=0;i<5;i++){statements=0;const start=performance.now();await coordinator.tick();samples.push({ms:performance.now()-start,statements});}
 samples.sort((a,b)=>a.ms-b.ms);const {ms,statements:n}=samples[2];
 const shelfStart=performance.now(),rows=await repo.list('owner'),shelfQueryMs=performance.now()-shelfStart;
 const shelf=rows.map(row=>{const saved=view(row);if(process.argv[3]==='trim'&&saved.story){delete saved.story.original;saved.story.sourceText='';}return saved;});
 console.log(JSON.stringify({scenario:name,ms,statements:n,minMs:samples[0].ms,maxMs:samples[4].ms,shelfQueryMs,shelfBytes:Buffer.byteLength(JSON.stringify(shelf))}));
 await coordinator.close();db.close();
}
