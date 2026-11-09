// Browser verification uses the real upgraded API and complete inventory; no alternate story pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {storyBrowser} from './fixtures/story-browser.mjs';
import {insertReaderStory,makeStory} from './fixtures/story.mjs';
import {png} from './fixtures/images.mjs';

test('startup inventory removes retired offline payloads and retains hidden current versions, trash and shared media',async t=>{
 const b=await storyBrowser(t,'story-storage-consolidation'),{page,f,context,url}=b;
 const story=await insertReaderStory(f.app,{...makeStory(4),title:'保留的当前故事',pages:makeStory(4).pages.map(p=>({...p,image:'/api/media/current.png'}))});
 await f.app.services.media.put('current.png',png,{contentType:'image/png'});
 const hidden=[];
 for(const kind of ['history','trash','reselection']){
  const id=crypto.randomUUID();hidden.push(id);
  await f.app.services.database.prepare(`INSERT INTO stories(id,user_id,selection,document,state,generation_control,created_at,updated_at)
   SELECT ? ,user_id,selection,json_set(document,?,json(?)),state,generation_control,created_at,updated_at FROM stories WHERE id=?`).bind(id,kind==='reselection'?'$.reselection':'$.revision',JSON.stringify(kind==='reselection'?{rootId:story.id}:{rootId:story.id,number:kind==='history'?1:2}),story.id).run();
  if(kind==='trash')await f.app.services.database.prepare("INSERT INTO library_deletions VALUES('docker-local-owner',?,'generated','date')").bind(id).run();
 }
 // Keep the visible family version selected while hiding its historical record.
 await f.app.services.database.prepare("UPDATE stories SET document=json_set(document,'$.revision',json(?)) WHERE id=?").bind(JSON.stringify({rootId:story.id,number:3}),story.id).run();
 const foreign=crypto.randomUUID();await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,state,generation_control,created_at,updated_at) SELECT ?,'other-owner',selection,document,state,generation_control,created_at,updated_at FROM stories WHERE id=?").bind(foreign,story.id).run();
 await context.addInitScript(({ids})=>{
  const entries=ids.concat('zhongli','dongguo','retired');
  localStorage.setItem('yiyu-reading',JSON.stringify(entries.map(storyId=>({storyId,page:0,updatedAt:'2099-01-01'}))));localStorage.setItem('shiqu-last-read','zhongli');
  window.cacheSetup=caches.open('yiyu-offline-v1').then(async cache=>{
   for(const id of entries)await cache.put('/offline-data/'+id,new Response(JSON.stringify({id,title:id==='zhongli'?'一车梨的秘密':id}),{headers:{'Content-Type':'application/json'}}));
   await cache.put('/api/media/shared.png',new Response('shared'));
  });
 },{ids:[story.id,...hidden,foreign]});
 let release,arrived;const pending=new Promise(resolve=>release=resolve),started=new Promise(resolve=>arrived=resolve);t.after(()=>release());
 await page.route('**/api/reader/deletions?inventory=1',async route=>{const response=await route.fetch();arrived();await pending;await route.fulfill({response});});
 const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto(url,{waitUntil:'domcontentloaded'});await started;await page.evaluate(()=>window.cacheSetup);
 await page.getByRole('button',{name:'发现',exact:true}).click();await page.getByText('正在打开故事…',{exact:true}).waitFor();release();
 await page.getByRole('button',{name:'继续阅读'+story.title,exact:true}).waitFor();
 const cache=await page.evaluate(async()=>({reading:JSON.parse(localStorage.getItem('yiyu-reading')),last:localStorage.getItem('shiqu-last-read'),keys:(await(await caches.open('yiyu-offline-v1')).keys()).map(r=>new URL(r.url).pathname)}));
 for(const id of [story.id,...hidden]){assert.ok(cache.keys.includes('/offline-data/'+id));assert.ok(cache.reading.some(row=>row.storyId===id));}
 for(const id of ['zhongli','dongguo','retired',foreign])assert.equal(cache.keys.includes('/offline-data/'+id),false);
 assert.ok(cache.keys.includes('/api/media/shared.png'));assert.notEqual(cache.last,'zhongli');
 assert.equal(requests.filter(p=>p==='/api/reader/library/shelf').length,1);
 assert.equal(await page.getByText('一车梨的秘密',{exact:true}).count(),0);
 const defaultDeletions=await(await context.request.get(url+'/api/reader/deletions')).json();assert.ok(Array.isArray(defaultDeletions));
 await b.screenshot('canonical-cache-cleanup');assert.equal(f.control.calls.length,0);
});
