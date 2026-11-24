// 阅读页的模型名称与故事卡简介去重只影响显示，不改动保存的记录。
import test from 'node:test';
import assert from 'node:assert/strict';
import {generationModelNames} from '../lib/story-publication.ts';
import {storyCardExcerpt} from '../lib/reader-contents.ts';

test('reading labels use distinct recorded image model names',()=>{
 const models=[{step:'image:0',model:'codex-image-generation'},{step:'image:1',model:'codex-image-generation'},{step:'image:2',model:' gemini-nano-banana-2.1 '},{step:'plan',model:'gpt-6.1-sol'}];
 assert.deepEqual(generationModelNames(models,'image'),['codex-image-generation','gemini-nano-banana-2.1']);
 assert.deepEqual(generationModelNames(models,'text'),['gpt-6.1-sol']);
 assert.deepEqual(generationModelNames(undefined,'image'),[]);
});

test('reading labels classify saved DAG portrait and landscape draws as image generation',()=>{
 const models=[
  {step:'dag:visual',model:'gpt-6.1-sol'},
  {step:'dag:draw',model:'codex-image-generation'},
  {step:'dag:draw',model:'codex-image-generation'},
  {step:'dag:drawLandscape',model:' gemini-nano-banana-2.1 '},
 ];
 assert.deepEqual(generationModelNames(models,'image'),['codex-image-generation','gemini-nano-banana-2.1']);
 assert.deepEqual(generationModelNames(models,'text'),['gpt-6.1-sol']);
 const mixed=[{step:'image:0',model:'legacy-image'},{step:'image:1',model:'codex-image-generation'},...models];
 assert.deepEqual(generationModelNames(mixed,'image'),['legacy-image','codex-image-generation','gemini-nano-banana-2.1']);
 assert.deepEqual(generationModelNames(mixed,'text'),['gpt-6.1-sol']);
});

test('story card excerpts drop an opening that repeats the title',()=>{
 assert.equal(storyCardExcerpt('神农为播种百谷','神农为播种百谷，挥赭鞭遍打百草。'),'挥赭鞭遍打百草。');
 assert.equal(storyCardExcerpt('種梨','鄉人貨梨於市。'),'鄉人貨梨於市。');
 assert.equal(storyCardExcerpt('一句话','一句话'),'');
 assert.equal(storyCardExcerpt('','简介'),'简介');
});
