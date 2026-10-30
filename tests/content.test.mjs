// Validate saved-story publication and media rules with synthetic records, independent of bundled content.
import test from 'node:test';
import assert from 'node:assert/strict';
import {storySchema,publishErrors,pageSchema} from '../lib/validation.ts';
import {makeStory} from './fixtures/story.mjs';
test('synthetic saved stories pass publication review without a bundled demo',()=>{const s=makeStory();assert.equal(s.pages.length,10);assert.deepEqual(publishErrors(s),[]);storySchema.parse(s);});
test('publication refuses missing sources, unreviewed content and missing pictures',()=>{const s=makeStory();assert.ok(publishErrors({...s,sourceText:''}).length);assert.ok(publishErrors({...s,checks:{source:true,plot:false,visual:true}}).length);assert.ok(publishErrors({...s,pages:s.pages.map((p,i)=>i? p:{...p,image:''})}).length);});
test('media schema prevents external fetches and executable URL injection',()=>{for(const image of ['javascript:alert(1)','https://evil.example/a.png','/api/media/../admin','/art/x.svg?q=x'])assert.equal(pageSchema.safeParse({caption:'a',prompt:'b',image,audio:''}).success,false);});

test('story editing needs no accounting metadata and ignores retired billing fields',()=>{
 const story=makeStory();
 const parsed=storySchema.parse(story);
 assert.equal('actualCost' in parsed,false);assert.equal('currency' in parsed,false);
 assert.deepEqual(storySchema.parse({...story,actualCost:'retired value',currency:'USD'}),parsed);
});
