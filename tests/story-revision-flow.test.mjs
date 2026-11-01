// Exercise the real revision hook against controlled production: editing makes no version,
// confirmation starts work, and a lost response cannot create duplicate versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {productionFixture,until} from './fixtures/production.mjs';

const compiled=build({stdin:{contents:"export {useStoryRevision} from './client/ui/useStoryRevision.ts';export {beginRender} from 'react';export {setTransport} from 'revision-transport';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
 name:'revision-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'revision'}));
  b.onResolve({filter:/^(\.\/shared|revision-transport)$/},()=>({path:'transport',namespace:'revision'}));
  b.onLoad({filter:/.*/,namespace:'revision'},({path})=>({loader:'js',contents:path==='hooks'?`
   const cells=[];let cursor=0;
   export function beginRender(){cursor=0;}
   export function useState(initial){const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]??= {current:value};}
   export function useEffect(){}
  `:`let transport;export const setTransport=value=>transport=value;export const request=(...args)=>transport(...args);export const randomId=()=>crypto.randomUUID();`}));
 }
}]});
const reviewIssue={page:3,category:'caption',problem:'第三幅配文含混。',instruction:'明确醒来后看见的事物。'};
async function harness(t,{loseResponse=false,paused=false,blocked=false,initialTab='count',initialPage}={}){
 const f=await productionFixture(t);f.control.hold=paused;
 if(blocked)f.control.beforeText=async(kind,payload)=>kind==='review'?{issues:[reviewIssue]}:kind==='repair'?{pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))}:undefined;
 const id=await f.create(3);await f.demand(id);
 if(blocked)await until(async()=>(await f.read(id)).state==='failed');
 else if(paused){await until(()=>f.control.calls.length>0);await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});}
 else await until(async()=>(await f.read(id)).state==='completed');
 const bundle=await compiled,module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const requests=[],submitted=[];
 const {useStoryRevision,beginRender,setTransport}=module.exports;
 setTransport(async(path,method='GET',body)=>{
  if(method==='POST')requests.push(body);
  const response=await f.json(path.slice('reader/'.length),method,body);
  if(loseResponse&&method==='POST'){loseResponse=false;throw new TypeError('Lost response');}
  return response;
 });
 const render=()=>{beginRender();return useStoryRevision(id,async session=>{submitted.push(session);});};
 render().open(initialTab,initialPage);await until(()=>!!render().base);
 return {f,id,requests,submitted,render};
}

for(const passes of [true,false])test(`saving manual review corrections re-audits first and ${passes?'continues drawing on approval':'keeps drawing blocked on rejection'}`,async t=>{
 const h=await harness(t,{blocked:true,initialTab:'script',initialPage:3});
 const before=await h.f.read(h.id),plan=structuredClone(h.render().base.plan);
 plan.pages[2].caption='庄周醒来，看见窗外的花，仍记得梦中飞舞的感觉。';h.render().setChanges({plan});
 let started,release;
 const auditStarted=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
 h.f.control.beforeText=async(kind,payload)=>{
  if(kind==='review'){assert.equal(payload.plan.pages[2].caption,plan.pages[2].caption);started();await hold;return {issues:passes?[]:[reviewIssue]};}
  if(kind==='repair')return {pages:payload.requestedPages.map(page=>({page,...payload.plan.pages[page-1]}))};
 };
 t.after(()=>release());
 await h.render().submit();await auditStarted;
 assert.equal(h.requests.length,1);assert.equal(h.submitted.length,1);assert.equal(h.f.control.calls.length,0,'No images before the fresh audit completes');
 const child=h.submitted[0];assert.equal(child.generationControl,'active');assert.notEqual(child.id,h.id);assert.equal(h.render().tab,null);
 release();await until(async()=>(await h.f.read(child.id)).state===(passes?'completed':'failed'));
 const saved=await h.f.read(child.id);
 assert.equal(saved.story.pages[2].caption,plan.pages[2].caption);assert.equal(h.f.control.calls.length,passes?3:0);
 assert.equal(saved.generationProgress.reviewStatus,passes?'passed':'blocked');assert.equal(saved.generationProgress.reviewAudits,1);
 assert.equal((await h.f.read(h.id)).story.pages[2].caption,before.story.pages[2].caption,'Original stays intact');
});

test('review edit targets survive initial loading, reopening and ending selection without submitting',async t=>{
 const h=await harness(t,{initialTab:'script',initialPage:3});
 assert.equal(h.render().tab,'script');assert.equal(h.render().scriptPage,3);
 h.render().setChanges({plan:{...h.render().base.plan,reflection:'保留本次草稿。'}});
 h.render().setScriptPage(2);h.render().setTab('requirements');h.render().setTab('script');
 assert.equal(h.render().scriptPage,2);
 h.render().setTab(null);h.render().open('script',1);
 assert.equal(h.render().scriptPage,1);assert.equal(h.render().changes.plan.reflection,'保留本次草稿。');
 h.render().open('script',0);assert.equal(h.render().scriptPage,0);
 h.render().open('script');assert.equal(h.render().scriptPage,1);
 assert.equal(h.requests.length,0);assert.equal(h.submitted.length,0);
});

test('completed story count edits remain a draft until confirmation starts the new version',async t=>{
 const h=await harness(t);
 h.render().setChanges({length:5});
 h.render().setTab(null); // Finish editing and return to settings.
 assert.equal(h.requests.length,0);assert.equal(h.render().changes.length,5);
 assert.equal((await h.f.json('sessions')).length,1);
 assert.equal((await h.f.read(h.id)).state,'completed');
 await h.render().submit();
 assert.equal(h.requests.length,1);assert.notEqual(h.requests[0].paused,true);
 assert.equal(h.submitted.length,1);
 const child=h.submitted[0];assert.equal(child.generationControl,'active');
 await until(async()=>(await h.f.read(child.id)).state==='completed');
 assert.equal((await h.f.read(child.id)).story.pages.length,5);
 assert.equal((await h.f.read(h.id)).story.pages.length,3);
 assert.deepEqual(h.render().changes,{});
});

test('retrying explicit production after a lost response uses the same version',async t=>{
 const h=await harness(t,{loseResponse:true});
 h.render().setChanges({length:5});await h.render().submit();
 assert.match(h.render().error,/Lost response/);assert.equal(h.render().changes.length,5);
 await h.render().submit();
 assert.equal(h.requests.length,2);assert.equal(h.requests[0].requestId,h.requests[1].requestId);
 assert.equal(h.submitted.length,1);
 const child=h.submitted[0];assert.equal(child.generationControl,'active');
 await until(async()=>(await h.f.read(child.id)).state==='completed');
 const rows=await h.f.app.services.database.prepare("SELECT id FROM reader_sessions WHERE json_extract(document,'$.revision.parentId')=?").bind(h.id).all();
 assert.equal(rows.results.length,1);
});

test('paused edits stay stopped until resume applies them and continues generation',async t=>{
 const h=await harness(t,{paused:true});
 h.render().setChanges({length:5});h.render().setTab(null);
 assert.equal(h.requests.length,0);assert.equal((await h.f.read(h.id)).generationControl,'paused');
 assert.equal((await h.f.json('sessions')).length,1);
 await h.render().submit();
 assert.equal(h.submitted.length,1);const child=h.submitted[0];
 assert.equal(child.generationControl,'active');assert.equal(child.selection.length,5);
 h.f.control.hold=false;for(const call of h.f.control.calls)call.resolve();
 await until(async()=>(await h.f.read(child.id)).state==='completed');
 assert.equal((await h.f.read(child.id)).story.pages.length,5);
 assert.equal((await h.f.read(h.id)).generationControl,'paused');
});
