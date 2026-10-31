// Drive the real generation hook with an inert hook runtime to isolate asynchronous shelf membership.
// Requests and observations are controlled; historical reads must never create shelf members.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {productionFixture,selection} from './fixtures/production.mjs';
const compiled=build({stdin:{contents:"export {useStoryGeneration} from './client/ui/useStoryGeneration.ts';export {readSessions} from 'react';export {setTransport} from 'membership-transport';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
 name:'inert-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'membership'}));
  b.onResolve({filter:/^(\.\/shared|membership-transport)$/},()=>({path:'transport',namespace:'membership'}));
  b.onLoad({filter:/.*/,namespace:'membership'},({path})=>({loader:'js',contents:path==='hooks'?`
   const cells=[],states=[];let cursor=0;
   export function useState(initial){const index=cursor++;states.push(index);cells[index]=typeof initial==='function'?initial():initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]={current:value};}
   export function useEffect(){}
   export const readSessions=()=>cells[states[0]];
  `:`let transport;export const setTransport=value=>transport=value;export const request=(...args)=>transport(...args);export const randomId=()=>crypto.randomUUID();`}));
 }
}]});
async function harness(t,transport){
 const result=await compiled,module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const previous=globalThis.history;globalThis.history={replaceState(){}};t.after(()=>{if(previous===undefined)delete globalThis.history;else globalThis.history=previous;});
 const {setTransport,readSessions,useStoryGeneration}=module.exports;setTransport(transport);
 return {api:useStoryGeneration(0,{onStory(){},onProgress(){}}),readSessions,setTransport};
}
const root={id:'root',state:'idle',generationControl:'paused',generationMode:'background',page:0,saved:false,story:null};
const latest={...root,id:'latest',revision:{rootId:'root',parentId:'root',number:2}};

test('an initial history deep link does not invalidate the authoritative latest list',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const h=await harness(t,async path=>path==='reader/sessions'?pending:root);
 const loading=h.api.refreshLibrary();await h.api.resume(root.id);assert.deepEqual(h.readSessions(),[]);
 release([latest]);await loading;assert.deepEqual(h.readSessions(),[latest]);
});

test('reading history after deleting the latest card cannot resurrect the family',async t=>{
 const h=await harness(t,async path=>path==='reader/sessions'?[latest]:root);
 await h.api.refreshLibrary();h.api.remove(latest.id);await h.api.resume(root.id);assert.deepEqual(h.readSessions(),[]);
});

test('restoring a historical snapshot only admits members returned by the latest list',async t=>{
 const h=await harness(t,async path=>path==='reader/sessions'?[latest]:root);
 await h.api.refreshLibrary(root.id);assert.deepEqual(h.readSessions(),[latest]);
 await h.api.resume(root.id);assert.deepEqual(h.readSessions(),[latest]);
});

test('a blocked address update does not reject a saved story or invite another creation',async t=>{
 const f=await productionFixture(t),requests=[];
 f.generation.suggestions=async()=>({stories:[],note:''});
 const h=await harness(t,(path,method,body)=>{
  requests.push(body.requestId);return f.json(path.slice('reader/'.length),method,body);
 });
 globalThis.history.replaceState=()=>{throw new DOMException('History navigation unavailable','SecurityError');};
 const saved=await h.api.start({...selection,storyTitle:undefined,length:'auto'},true);
 assert.equal(requests.length,1);
 assert.deepEqual(h.readSessions().map(s=>s.id),[saved.id]);
 assert.deepEqual((await f.json('sessions')).map(s=>s.id),[saved.id]);
});

test('a lost creation response retries the same saved story even when address updates are blocked',async t=>{
 const f=await productionFixture(t),requests=[];
 f.generation.suggestions=async()=>({stories:[],note:''});
 const h=await harness(t,async(path,method,body)=>{
  requests.push(body.requestId);const saved=await f.json(path.slice('reader/'.length),method,body);
  if(requests.length===1)throw new TypeError('Lost response');
  return saved;
 });
 globalThis.history.replaceState=()=>{throw new DOMException('History navigation unavailable','SecurityError');};
 const input={...selection,storyTitle:undefined,length:'auto'};
 await assert.rejects(h.api.start(input,true),/Lost response/);
 const saved=await h.api.start(input,true);
 assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
 assert.deepEqual((await f.json('sessions')).map(s=>s.id),[saved.id]);
});

test('separate successful creation actions can still create independent stories',async t=>{
 const requests=[];
 const h=await harness(t,async(_path,_method,body)=>{requests.push(body.requestId);return {...root,id:body.requestId};});
 await h.api.start(selection,true);await h.api.start(selection,true);
 assert.equal(new Set(requests).size,2);assert.equal(h.readSessions().length,2);
});
