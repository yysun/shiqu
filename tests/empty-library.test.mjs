// Prove first-run emptiness and preserve current saved stories through the standard media API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,writeFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../server/app.ts';
import {makeStory,insertReaderStory} from './fixtures/story.mjs';
import {recentHeroes} from '../lib/reader-home.ts';
import {readerBooks} from '../lib/reader-books.ts';

async function fixture(t){
 const dataDirectory=await mkdtemp(path.join(os.tmpdir(),'shiqu-empty-'));
 t.after(()=>rm(dataDirectory,{recursive:true,force:true}));
 const options={root:process.cwd(),dataDirectory};let app=createApplication(options);
 t.after(()=>app.close());
 return {options,get app(){return app;},restart(){app.close();app=createApplication(options);}};
}
const req=(app,route,method='GET',body)=>app.handle(new Request('http://localhost'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));

test('fresh/reopened libraries contain no stories or demo artwork and expose no studio endpoints',async t=>{
 const f=await fixture(t);
 for(let n=0;n<2;n++){
  assert.deepEqual(await(await req(f.app,'/api/reader/sessions')).json(),[]);
  assert.deepEqual(await(await req(f.app,'/api/reader/deletions')).json(),[]);
  for(const route of ['/api/stories','/api/books','/api/me/progress','/api/admin/status'])assert.equal((await req(f.app,route)).status,404);
  assert.equal((await req(f.app,'/api/admin/seed','POST',{})).status,404);
  assert.deepEqual(recentHeroes([],'',[]),[]);
  await f.app.services.media.put('legacy-art/pear-1.png',Uint8Array.of(1),{contentType:'image/png'});
  for(const route of ['/art/pear-1.png','/art/dongguo-1.png'])assert.equal((await req(f.app,route)).status,404);
  f.restart();
 }
 assert.equal(readerBooks.length,26);
 for(const file of ['client/ui/Admin.tsx','lib/studio-prompts.ts','public/art/pear-1.png','public/art/dongguo-1.png','lib/demo-dongguo.ts','data/library/dongguo-demo.json'])await assert.rejects(access(file));
});

test('saved stories, progress and uploaded media survive reopen through the standard media API',async t=>{
 const f=await fixture(t),bytes=Uint8Array.from([137,80,78,71,13,10,26,10]);
 const original=await insertReaderStory(f.app,{...makeStory(30),pages:makeStory(30).pages.map(page=>({...page,image:'/api/media/uploaded.png'}))});
 await f.app.services.media.put('uploaded.png',bytes,{contentType:'image/png'});
 assert.equal((await req(f.app,'/api/reader/sessions/'+original.id+'/progress','POST',{storyId:original.id,page:29,saved:true})).status,200);
 const rows=await(await req(f.app,'/api/reader/sessions')).json();f.restart();
 assert.deepEqual(await(await req(f.app,'/api/reader/sessions')).json(),rows);
 const progress=rows.map(row=>({storyId:row.id,page:row.page}));
 const response=await req(f.app,'/api/media/uploaded.png');
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 assert.equal(recentHeroes(rows.map(row=>row.story),original.id,progress)[0].story.id,original.id);
 assert.equal(recentHeroes(rows.map(row=>row.story),'',[]).length,0);
 const secret=path.join(f.options.dataDirectory,'outside.png');await writeFile(secret,bytes);
 await symlink(secret,path.join(f.options.dataDirectory,'media/escape.png'));
 assert.notEqual((await req(f.app,'/api/media/escape.png')).status,200);
});
