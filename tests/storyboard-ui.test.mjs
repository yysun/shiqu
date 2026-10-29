// Render actual reader controls to verify batch progress and the 80-frame input limit without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('reader renders saved directory, batch range, honest progress and 80-frame controls',async()=>{
 const bundle=await build({stdin:{contents:"export {default as Status} from './client/ui/StoryGenerationStatus.tsx';export {default as Count} from './client/ui/StoryFrameCount.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const {Status,Count}=compiled.exports,session={id:'render',selection:{length:45},state:'running',productionState:'running',ready:0,story:null,error:null,stage:'正在编排第 21–40 幅分镜',awaitingFrameCount:false,frameRecommendation:null,generationProgress:{sourceReady:true,frameCountConfirmed:true,frameCount:45,phase:'plan',startedAt:Date.now(),attempt:1,storyboardFrames:20,storyboardBatch:{first:21,last:40}}};
 const status=renderToStaticMarkup(createElement(Status,{session,busy:false,error:'',onRetry(){},onBack(){}}));
 assert.match(status,/已保存 20 \/ 45 幅分镜/);assert.match(status,/分镜目录已保存/);assert.match(status,/当前编排第 21–40 幅/);
 assert.match(status,/<progress aria-label="当前阶段进行中"><\/progress>/);assert.doesNotMatch(status,/<progress[^>]*value=/);
 const count=renderToStaticMarkup(createElement(Count,{recommendation:{count:80,reason:'展开关键动作与转折。'},disabled:false,onConfirm(){}}));
 assert.equal((count.match(/max="80"/g)||[]).length,2);assert.match(count,/生成 80 幅/);
});
