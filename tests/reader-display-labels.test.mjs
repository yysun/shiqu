// 阅读页的生成方名称与故事卡简介去重只影响显示，不改动保存的记录。
import test from 'node:test';
import assert from 'node:assert/strict';
import {generationProviderName,generationProviderNames} from '../lib/story-publication.ts';
import {storyCardExcerpt} from '../lib/reader-contents.ts';

test('reading labels name the provider and keep unknown models as recorded',()=>{
 assert.equal(generationProviderName('codex-image-generation'),'Codex');
 assert.equal(generationProviderName('gemini-nano-banana-2.1'),'Gemini');
 assert.equal(generationProviderName('gpt-image-2.5-sunburst'),'OpenAI');
 assert.equal(generationProviderName('claude-opus-5-5'),'Claude');
 assert.equal(generationProviderName('deepseek-flash'),'DeepSeek');
 assert.equal(generationProviderName(' custom-model '),'custom-model');
 const models=[{step:'image:0',model:'codex-image-generation'},{step:'image:1',model:'codex-image-generation'},{step:'image:2',model:'gemini-nano-banana-2.1'},{step:'plan',model:'gpt-6.1-sol'}];
 assert.deepEqual(generationProviderNames(models,'image'),['Codex','Gemini']);
 assert.deepEqual(generationProviderNames(models,'text'),['OpenAI']);
 assert.deepEqual(generationProviderNames(undefined,'image'),[]);
});

test('story card excerpts drop an opening that repeats the title',()=>{
 assert.equal(storyCardExcerpt('神农为播种百谷','神农为播种百谷，挥赭鞭遍打百草。'),'挥赭鞭遍打百草。');
 assert.equal(storyCardExcerpt('種梨','鄉人貨梨於市。'),'鄉人貨梨於市。');
 assert.equal(storyCardExcerpt('一句话','一句话'),'');
 assert.equal(storyCardExcerpt('','简介'),'简介');
});
