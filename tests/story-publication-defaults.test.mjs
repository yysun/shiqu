// Verify saved defaults, creation snapshots and per-work overrides using isolated SQLite and controlled providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture,selection,makePlan} from './fixtures/production.mjs';
import {completedStory} from './fixtures/production-dag-story.mjs';
import {ReaderRepository} from '../lib/reader-repository.ts';
import {emptyPublication,withPublicationDefaults,storyExportKey} from '../lib/story-publication.ts';
import {makeStory} from './fixtures/story.mjs';

const defaults={author:'默认制作人',workUrl:'https://example.org/works',contact:'公开联系',sourceNote:'请核对本篇来源许可。',reuse:'转载时请保留制作署名。',watermarkFontSize:32};
const save=(f,publication=defaults,expected=null)=>f.json('publication-defaults','POST',{publication,expected});
const fixture=t=>productionFixture(t,'codex',{SHIQU_AI_PROVIDER:'readonly'});

test('live export defaults preserve work overrides and invalidate unsigned or outdated cached files',()=>{
 const story={...makeStory(1),generated:true},oldKey=storyExportKey(story),output=withPublicationDefaults(story,defaults);
 assert.deepEqual(output.publication,defaults);assert.equal(story.publication,undefined);assert.notEqual(storyExportKey(output),oldKey);
 assert.equal(storyExportKey(withPublicationDefaults(story,{...defaults})),storyExportKey(output));
 assert.notEqual(storyExportKey(withPublicationDefaults(story,{...defaults,author:'新默认署名'})),storyExportKey(output));
 const custom={...story,publication:{...emptyPublication,author:'本篇署名',sourceNote:'本篇许可',watermarkFontSize:16}};
 const resolved=withPublicationDefaults(custom,defaults);assert.equal(resolved.publication.author,'本篇署名');assert.equal(resolved.publication.sourceNote,'本篇许可');assert.equal(resolved.publication.contact,defaults.contact);assert.equal(resolved.publication.watermarkFontSize,16);
 assert.equal(withPublicationDefaults(story,null),story);
 const sample=makeStory(1);assert.equal(withPublicationDefaults(sample,defaults),sample,'shared samples must not acquire a reader credit');
});

test('defaults survive restart and are copied once for both creation paths, without changing existing stories or generating',async t=>{
 const f=await fixture(t),owner=f.app.services.ownerId,repo=new ReaderRepository(f.app.services.database);
 const doc=async id=>JSON.parse((await new ReaderRepository(f.app.services.database).get(id,owner)).document);
 assert.deepEqual(await f.json('publication-defaults'),{publication:null});
 const old=await f.create(2);assert.equal((await doc(old)).publication,undefined);
 await save(f);
 const direct=await f.create(2),intake=crypto.randomUUID();
 await f.json('sessions','POST',{requestId:intake,selection,intake:true});
 assert.deepEqual((await doc(direct)).publication,defaults);
 assert.deepEqual((await doc(intake)).publication,defaults);
 assert.equal((await doc(old)).publication,undefined);
 const changed={...defaults,author:'之后的新署名'};await save(f,changed,defaults);
 await f.json('sessions','POST',{requestId:direct,selection:{...selection,length:2}});
 await f.json('sessions','POST',{requestId:intake,selection,intake:true});
 assert.deepEqual((await doc(direct)).publication,defaults);
 assert.deepEqual((await doc(intake)).publication,defaults);
 const next=await f.create(2);assert.deepEqual((await doc(next)).publication,changed);
 await repo.create(crypto.randomUUID(),'another-owner',selection);
 assert.equal(await repo.publicationDefaults('another-owner'),null);
 const other=(await repo.list('another-owner'))[0];assert.equal(JSON.parse(other.document).publication,undefined);
 await f.restart();assert.deepEqual(await f.json('publication-defaults'),{publication:changed});
 assert.deepEqual((await doc(direct)).publication,defaults);
 assert.equal(f.control.calls.length+f.control.plans.length+f.control.reviews.length,0);
});

test('a per-story override stays independent of defaults and sibling stories, including revision inheritance',async t=>{
 const f=await fixture(t),owner=f.app.services.ownerId,repo=new ReaderRepository(f.app.services.database);
 await save(f);const second=await f.create(2),{id:first}=await completedStory(f,{extra:{publication:defaults}});
 const custom={...defaults,author:'本篇制作人',watermarkFontSize:16};
 assert.deepEqual((await f.json(`sessions/${first}/publication`,'POST',{publication:custom,expected:defaults})).story.publication,custom);
 assert.deepEqual(await f.json('publication-defaults'),{publication:defaults});
 assert.deepEqual(JSON.parse((await repo.get(second,owner)).document).publication,defaults);
 const base=await f.json(`sessions/${first}/revisions`);
 const child=await f.json(`sessions/${first}/revisions`,'POST',{requestId:crypto.randomUUID(),token:base.token,changes:{artStyle:'paper-cut'},paused:true});
 assert.deepEqual(JSON.parse((await repo.get(child.id,owner)).document).publication,custom);
 await save(f,{...emptyPublication},defaults);
 assert.deepEqual(JSON.parse((await repo.get(first,owner)).document).publication,custom);
 assert.deepEqual(JSON.parse((await repo.get(second,owner)).document).publication,defaults);
 const cleared=await f.create(2);assert.deepEqual(JSON.parse((await repo.get(cleared,owner)).document).publication,emptyPublication);
});

test('default settings require valid same-owner CAS writes and remain editable without a generation provider',async t=>{
 const f=await fixture(t);f.generation.status=async()=>({configured:false});
 await save(f);
 for(const expected of [null,{...defaults,author:'过期内容'}])assert.equal((await f.request('publication-defaults','POST',{publication:{...defaults,author:'覆盖'},expected})).status,409);
 assert.equal((await f.request('publication-defaults','POST',{publication:{...defaults,workUrl:'javascript:alert(1)'},expected:defaults})).status,400);
 for(const watermarkFontSize of [11,49,12.5])assert.equal((await f.request('publication-defaults','POST',{publication:{...defaults,watermarkFontSize},expected:defaults})).status,400);
 assert.equal((await f.request('publication-defaults','POST',{publication:defaults,expected:defaults,ownerId:'other-owner'})).status,400);
 assert.equal((await f.request('publication-defaults','POST',{publication:defaults,expected:defaults},{origin:'https://other.example'})).status,403);
 const responses=await Promise.all(['甲','乙'].map(author=>f.request('publication-defaults','POST',{publication:{...defaults,author},expected:defaults})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const saved=(await f.json('publication-defaults')).publication;assert.ok(['甲','乙'].includes(saved.author));
 assert.deepEqual(await save(f,emptyPublication,saved),{publication:emptyPublication});
});
