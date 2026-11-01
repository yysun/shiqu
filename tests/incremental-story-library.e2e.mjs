// Service E2E: real REST handlers, durable queue, SQLite and files with citation-valid controlled inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,until} from './fixtures/production.mjs';
import {libraryFixture,selection} from './fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';

async function fixture(t){
 const f=await productionFixture(t),library=libraryFixture();f.control.hold=false;
 f.generation.suggestions=(...args)=>library.provider.suggestions(...args);
 f.generation.matchStories=(...args)=>library.provider.matchStories(...args);
 async function restart(){f.options.generation=withLocalBooks(f.generation,library.books,f.media);await f.restart();f.app.services.localBooks=library.books;}
 await restart();return {f,library,restart};
}
async function create(f,theme){
 const saved=await f.json('sessions','POST',{requestId:crypto.randomUUID(),intake:true,selection:{...selection,theme,narrativeDetail:'balanced'}});
 await f.demand(saved.id,crypto.randomUUID());await until(async()=>(await f.read(saved.id)).intake.phase==='choosing');return f.read(saved.id);
}

test('cold theme discovery retains rejected stories; restart and new themes reuse them; production receives originals',async t=>{
 const {f,library,restart}=await fixture(t),first=await create(f,'勇气');
 assert.deepEqual(first.intake.batches[0].stories.map(story=>story.title),['勇士护民']);assert.equal(library.calls.catalog.length,2);
 assert.ok(library.calls.catalog.every(call=>call.selection.theme===''&&call.input.purpose==='catalog'));
 const chosen=await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:0,action:'choose',batch:0,index:0});assert.equal(chosen.intake.search.state,'idle');
 await until(async()=>(await f.read(first.id)).intake.phase==='confirming');
 const prepared=await f.read(first.id),original=(await f.json(`sessions/${first.id}/source`)).source;
 assert.equal(original.localSource.firstUnit,'u2');assert.match(original.text,/勇士面对山中的猛虎/);assert.ok(original.chapterContext.text.includes(library.book.sections[0].units[1].text));
 assert.equal(f.control.plans.length,0);assert.equal(f.control.calls.length,0);
 const advice=f.control.recommendations[0].verifiedOriginal;assert.equal(advice.text,original.text);assert.notEqual(advice.text,library.stories[1].summary);assert.equal(advice.summary,undefined);
 await f.json(`sessions/${first.id}/setup`,'POST',{requestId:crypto.randomUUID(),generation:prepared.intake.generation,action:'confirm',settings:{artStyle:'ink-pencil',productionPrompt:'保留明确行动。',narrativeDetail:'balanced',length:2}});
 await until(async()=>(await f.read(first.id)).state==='completed');assert.equal(f.control.calls.length,2);
 for(const payload of f.control.plans){assert.equal(payload.verifiedOriginal.text,original.text);assert.equal(payload.verifiedOriginal.summary,undefined);assert.ok(payload.verifiedOriginal.chapterContext);}
 const extracted=library.calls.catalog.length;await restart();
 const other=await create(f,'知恩图报');assert.equal(other.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.catalog.length,extracted);
 const matched=library.calls.matches.length;await restart();const again=await create(f,'知恩图报');assert.equal(again.intake.batches[0].stories[0].title,'乌龟报恩');assert.equal(library.calls.matches.length,matched);assert.equal(library.calls.catalog.length,extracted);
});

test('REST uncertainty retains the neutral library and retries only the original review',async t=>{
 const {f,library}=await fixture(t);library.control.decide=()=> 'review';
 const failed=await f.request('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(failed.status,502);assert.match((await failed.json()).error,/仍无法确认主题/);
 assert.equal(library.calls.catalog.length,1);assert.equal(library.calls.matches.length,2);assert.ok(library.calls.matches[1].stories[0].text.includes('渔夫'));
 library.control.decide=(_theme,story)=>{assert.ok(story.text);return 'yes';};
 const result=await f.json('suggestions','POST',{...selection,theme:'需要核对'});assert.equal(result.stories[0].title,'乌龟报恩');assert.equal(library.calls.matches.length,3);assert.equal(library.calls.catalog.length,1);
});

test('two streaming theme requests share extraction; one reader can leave while another receives its story',async t=>{
 const {f,library}=await fixture(t),base=library.provider.suggestions;let release,started=false;
 library.provider.suggestions=async(...args)=>{started=true;await new Promise(resolve=>release=resolve);return base(...args);};
 const first=new AbortController(),second=new AbortController();
 const send=(theme,signal)=>f.app.handle(new Request('http://localhost/api/reader/suggestions',{method:'POST',signal,headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...selection,theme})}));
 const a=await send('主题甲',first.signal),b=await send('主题乙',second.signal),reader=a.body.getReader(),two=b.text();
 await until(()=>started&&release);await reader.cancel();release();
 const events=(await two).trim().split('\n').map(JSON.parse),result=events.find(event=>event.type==='result');
 assert.equal(result.batch.stories[0].title,'乌龟报恩');assert.equal(library.calls.catalog.length,1);assert.equal(library.calls.matches.filter(call=>call.theme==='主题甲').length,0);assert.equal(library.calls.matches.filter(call=>call.theme==='主题乙').length,1);
});
