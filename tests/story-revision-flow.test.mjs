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
async function harness(t,{loseResponse=false,paused=false}={}){
 const f=await productionFixture(t);f.control.hold=paused;
 const id=await f.create(3);await f.demand(id);
 if(paused){await until(()=>f.control.calls.length>0);await f.json(`sessions/${id}/production-control`,'POST',{action:'pause'});}
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
 render().open('count');await until(()=>!!render().base);
 return {f,id,requests,submitted,render};
}

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
