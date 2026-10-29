import test from 'node:test';
import assert from 'node:assert/strict';
import {storySchema,publishErrors,pageSchema} from '../lib/validation.ts';
import {seedStory} from '../lib/content.ts';
import {existsSync} from 'node:fs';
test('the existing Dongguo sample has thirty media files and passes publication review',()=>{const s=seedStory();assert.equal(s.pages.length,30);assert.deepEqual(publishErrors(s),[]);assert.equal(s.actualCost,null);storySchema.parse(s);for(const p of s.pages)assert.ok(existsSync('public'+p.image));});
test('publication refuses missing sources, unreviewed content and missing pictures',()=>{const s=seedStory();assert.ok(publishErrors({...s,sourceText:''}).length);assert.ok(publishErrors({...s,checks:{source:true,plot:false,visual:true}}).length);assert.ok(publishErrors({...s,pages:s.pages.map((p,i)=>i? p:{...p,image:''})}).length);});
test('media schema prevents external fetches and executable URL injection',()=>{for(const image of ['javascript:alert(1)','https://evil.example/a.png','/api/media/../admin','/art/x.svg?q=x'])assert.equal(pageSchema.safeParse({caption:'a',prompt:'b',image,audio:''}).success,false);});
