// Separate desktop/development database connections must see one shelf and one paid queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/app.ts';
import {desktopAccess} from '../server/desktop-access.ts';
import {productionFixture,until,selection} from './fixtures/production.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {emptyDag} from '../lib/production-dag/document.ts';

const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事（原文已核对，不经准备流程）。 */
async function confirmedStory(f,length=4){
 const id=crypto.randomUUID(),now=new Date().toISOString(),doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag()};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'active',0,?,?)").bind(id,owner,JSON.stringify({...selection,length}),JSON.stringify(doc),now,now).run();
 return id;
}

test('direct desktop and development share stories/media/progress and exclude duplicate generation',async t=>{
 const f=await productionFixture(t),desktop=createApplication(f.options);f.coordinators.push(desktop.services.production);t.after(()=>desktop.close());
 const gate=desktopAccess(desktop.handle,{hosts:['localhost']});
 async function request(suffix,method='GET',body){
  const response=await gate.handle(new Request('http://localhost/api/reader/'+suffix,{method,headers:{Origin:'http://localhost','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));assert.ok(response.ok,`${suffix}:${response.status}`);return response.json();
 }
 assert.equal((await gate.handle(new Request('http://localhost/api/reader/sessions'))).status,200);
 const id=await confirmedStory(f,4),devViewer=crypto.randomUUID(),desktopViewer=crypto.randomUUID();
 assert.ok((await request('sessions')).some(row=>row.id===id));
 await Promise.all([f.demand(id,devViewer),request(`sessions/${id}/production`,'POST',{viewerId:desktopViewer,page:0})]);
 f.app.services.production.wake();desktop.services.production.wake();
 // 两个连接共用一个任务队列：首幅只有一次绘图，其余画幅等它完成后才开始。
 await until(()=>f.control.calls.length===1);assert.equal(f.control.calls[0].page,0);f.control.calls[0].resolve();await until(()=>f.control.calls.length===4);
 f.control.calls.find(call=>call.page===2).resolve();await until(async()=>!!(await request(`sessions/${id}`)).story.pages[2].image);
 assert.ok((await f.read(id)).story.pages[2].image);
 await f.leave(id,devViewer);f.control.hold=false;for(const call of f.control.calls)call.resolve();
 await until(async()=>(await request(`sessions/${id}`)).state==='completed',20000);
 assert.deepEqual(f.control.dagCalls,['brief','storyboard'],'synopsis and storyboard are each paid once across both connections');
 assert.equal(f.control.calls.length,4,'one drawing per frame');assert.ok(f.control.maxActive<=3);
 await request(`sessions/${id}/progress`,'POST',{page:2,saved:true});assert.equal((await f.read(id)).page,2);assert.equal((await f.read(id)).saved,true);
 const current=await request(`sessions/${id}`),media=await gate.handle(new Request('http://localhost'+current.story.pages[2].image));assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');
 await f.app.close();await request(`sessions/${id}/production`,'POST',{viewerId:desktopViewer,page:1});assert.equal((await request(`sessions/${id}`)).state,'completed');assert.equal(f.control.calls.length,4,'the remaining connection does not draw again');
 const newId=crypto.randomUUID();await request('sessions','POST',{requestId:newId,selection});assert.ok((await request('sessions')).some(row=>row.id===newId));
 await desktop.close();
});
