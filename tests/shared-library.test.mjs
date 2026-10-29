// Separate desktop/development database connections must see one shelf and one paid queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/app.ts';
import {desktopAccess} from '../server/desktop-access.ts';
import {productionFixture,until,selection} from './fixtures/production.mjs';

test('direct desktop and development share stories/media/progress and exclude duplicate generation',async t=>{
 const f=await productionFixture(t),desktop=createApplication(f.options);f.coordinators.push(desktop.services.production);t.after(()=>desktop.close());
 const gate=desktopAccess(desktop.handle,{hosts:['localhost']});
 async function request(suffix,method='GET',body){
  const response=await gate.handle(new Request('http://localhost/api/reader/'+suffix,{method,headers:{Origin:'http://localhost','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));assert.ok(response.ok,`${suffix}:${response.status}`);return response.json();
 }
 assert.equal((await gate.handle(new Request('http://localhost/api/reader/sessions'))).status,200);
 const id=await f.create(),devViewer=crypto.randomUUID(),desktopViewer=crypto.randomUUID();
 assert.ok((await request('sessions')).some(row=>row.id===id));
 await Promise.all([f.demand(id,devViewer),request(`sessions/${id}/production`,'POST',{viewerId:desktopViewer,page:0})]);
 await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(call=>call.page===2).resolve();await until(async()=>!!(await request(`sessions/${id}`)).story.pages[2].image);
 assert.ok((await f.read(id)).story.pages[2].image);
 await f.leave(id,devViewer);f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await request(`sessions/${id}`)).ready===7);assert.equal(f.control.plans.length,1);assert.equal(f.control.calls.length,7);assert.ok(f.control.maxActive<=3);
 await request(`sessions/${id}/progress`,'POST',{page:2,saved:true});assert.equal((await f.read(id)).page,2);assert.equal((await f.read(id)).saved,true);
 const current=await request(`sessions/${id}`),media=await gate.handle(new Request('http://localhost'+current.story.pages[2].image));assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');
 await f.app.close();await request(`sessions/${id}/production`,'POST',{viewerId:desktopViewer,page:1});await until(async()=>(await request(`sessions/${id}`)).state==='completed');assert.equal(f.control.calls.length,8);
 const newId=crypto.randomUUID();await request('sessions','POST',{requestId:newId,selection});assert.ok((await request('sessions')).some(row=>row.id===newId));
 await desktop.close();
});
