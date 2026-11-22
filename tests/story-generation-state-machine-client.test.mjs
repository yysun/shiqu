// Exercise explicit recovery through the real hook/client/REST/queue, including a legacy reader
// whose viewer lease disappeared before the first image. Mock only React scheduling and transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {productionFixture,until} from './fixtures/production.mjs';

test('an explicit first-image retry renews reader demand after restart without another authorization',async t=>{
 const f=await productionFixture(t),id=await f.create(3),viewer=crypto.randomUUID();await f.demand(id,viewer);await until(()=>f.control.calls.length===1);f.control.calls[0].reject(Error('controlled first-image failure'));await until(async()=>(await f.read(id)).state==='failed');await f.leave(id,viewer);await f.restart();f.control.hold=true;
 const bundle=await build({stdin:{contents:"export {useStoryGeneration} from './client/ui/useStoryGeneration.ts';export {beginRender,flushEffects,cleanupEffects} from 'react';export {setTransport} from 'generation-transport';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'hook-scheduler',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'generation'}));b.onResolve({filter:/^(\.\/shared|generation-transport)$/},()=>({path:'transport',namespace:'generation'}));
  b.onLoad({filter:/.*/,namespace:'generation'},({path})=>({loader:'js',contents:path==='transport'?`let transport;export const setTransport=value=>transport=value;export const request=(...args)=>transport(...args);export const randomId=()=>crypto.randomUUID();`:`
   const cells=[],effects=[];let cursor=0;export function beginRender(){cursor=0;}
   export function useState(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return [cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value;}];}
   export function useRef(initial){const i=cursor++;return cells[i]??={current:initial};}
   export function useEffect(fn,deps){const i=cursor++,old=cells[i];if(!old||deps.some((d,n)=>d!==old.deps[n])){effects.push(()=>{old?.cleanup?.();cells[i]={deps,cleanup:fn()};});}}
   export function flushEffects(){while(effects.length)effects.shift()();}export function cleanupEffects(){for(const cell of cells)cell?.cleanup?.();}
  `}));
 }}]});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const {useStoryGeneration,beginRender,flushEffects,cleanupEffects,setTransport}=compiled.exports,calls=[];
 setTransport(async(path,method,body)=>{calls.push({path,method,body});return f.json(path.replace(/^reader\//,''),method,body);});
 // Location writes are best effort in this path; expose a harmless local history object.
 const history=globalThis.history;globalThis.history={replaceState(){}};t.after(()=>{cleanupEffects();if(history===undefined)delete globalThis.history;else globalThis.history=history;});
 const render=()=>{beginRender();const hook=useStoryGeneration(0,{onStory(){},onProgress(){}});flushEffects();return hook;};
 let hook=render();await hook.retrySession(id);hook=render();await until(()=>f.control.calls.length===2);
 assert.equal(calls.filter(c=>c.path.endsWith('/recover')).length,1);assert.ok(calls.some(c=>c.path.endsWith('/production')&&c.method==='POST'&&c.body.retry===false));
 f.control.hold=false;f.control.calls[1].resolve();await until(async()=>(await f.read(id)).state==='completed');assert.equal(f.control.calls.length,4);hook.leave();render();
});
