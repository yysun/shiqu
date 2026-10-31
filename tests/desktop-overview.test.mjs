// Overview counts must reflect generated-record checkpoints; browser links and native permissions remain scoped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {overviewSummary,overviewStoryState} from '../desktop/library-summary.ts';
import {localReaderUrl} from '../desktop/reader-url.ts';
import {defaultSystemSettings} from '../lib/system-settings.ts';

const record=(id,values={})=>({id,title:id,book:'庄子',theme:'人情冷暖',artStyle:'ink-wash',state:'idle',saved:0,page:0,ready:0,total:0,updatedAt:'2026-10-31',jobs:0,queued:0,running:0,failed:0,succeeded:0,...values});
test('overview partitions generated records by actionable checkpoint before active/completed and keeps recent SQL order',()=>{
 const stories=[
  record('completed',{state:'completed',saved:1}),
  record('choice',{state:'running',queued:1,production:{intakePhase:'choosing'}}),
  record('confirm',{state:'completed',production:{intakePhase:'confirming'}}),
  record('count',{state:'running',production:{phase:'frame-count',frameCountConfirmed:false}}),
  record('active',{running:1}),record('queued',{queued:1,saved:1}),
  record('failed',{state:'completed',failed:1}),record('idle'),
 ];
 const before=structuredClone(stories),stats=overviewSummary(stories);
 assert.deepEqual([stats.completed,stats.active,stats.attention,stats.saved],[1,2,5,2]);
 assert.equal(stats.completed+stats.active+stats.attention,stories.length);
 assert.deepEqual(stats.recent.map(row=>row.id),['completed','choice','confirm','count']);
 assert.deepEqual(stats.actionable.map(row=>row.id),['failed','choice','confirm']);assert.deepEqual(stories,before);
 assert.equal(overviewStoryState(stories[1]).label,'待选故事');assert.equal(overviewStoryState(stories[2]).label,'待制作确认');assert.equal(overviewStoryState(stories[3]).label,'待确认画幅');
 assert.equal(overviewStoryState(record('failed-state',{state:'failed',running:1})).kind,'attention');
 assert.equal(overviewStoryState(record('still-running',{state:'completed',running:1})).kind,'active');
 assert.deepEqual(overviewSummary([]),{completed:0,active:0,attention:0,saved:0,recent:[],actionable:[]});
});

test('preview browser opens only a distinct local reader root without credentials, query or fragment',()=>{
 const consoleUrl='http://127.0.0.1:1420/';
 assert.equal(localReaderUrl('http://127.0.0.1:3000',consoleUrl),'http://127.0.0.1:3000/');
 for(const value of [undefined,'','/','javascript:alert(1)','file:///tmp/reader.html','https://example.com','http://10.0.0.2:3000','http://localhost:3000','https://127.0.0.1:3000','http://user:secret@127.0.0.1:3000','http://127.0.0.1:3000/read','http://127.0.0.1:3000/?','http://127.0.0.1:3000/#','http://127.0.0.1:1420/'])assert.equal(localReaderUrl(value,consoleUrl),null,value);
});

test('overview renders honest loading and service states, browser-only reading, and saved configuration labels',async()=>{
 const bundle=await build({stdin:{contents:"export {OverviewPane} from './desktop/OverviewPane.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const props={native:true,state:'loading',busy:'',configured:true,settings:{...defaultSystemSettings('/test/library'),provider:'readonly',providerConfigured:true},previewUrl:null,onLaunch(){},onQueue(){},onSettings(){}};
 const render=changes=>renderToStaticMarkup(createElement(compiled.exports.OverviewPane,{...props,...changes}));
 const loading=render({});assert.match(loading,/正在读取服务状态/);assert.match(loading,/正在打开本机书库/);assert.equal((loading.match(/<strong>—<\/strong>/g)||[]).length,4);assert.doesNotMatch(loading,/<iframe/);assert.match(loading,/本机生成记录/);assert.match(loading,/已保存 · 只读模式/);
 const unavailable=render({state:'unavailable'});assert.match(unavailable,/服务状态暂不可用/);assert.match(unavailable,/disabled=""/);
 assert.match(render({state:'stopped'}),/启动并打开拾趣/);assert.match(render({state:'running'}),/打开拾趣/);assert.match(render({configured:false}),/完成设置/);
 const preview=render({native:false,state:'preview',previewUrl:'http://127.0.0.1:3010/'});assert.match(preview,/<a[^>]+href="http:\/\/127\.0\.0\.1:3010\/"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);assert.match(preview,/桌面开发预览/);assert.match(preview,/在桌面应用中查看或修改/);
 assert.match(render({native:false,state:'preview'}),/预览未连接阅读端/);assert.doesNotMatch(render({native:false,state:'preview'}),/href=/);
});

test('native console no longer grants loopback frame access or remote capabilities',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 assert.doesNotMatch(config.app.security.csp,/frame-src|127\.0\.0\.1/);
 assert.match(config.app.security.csp,/connect-src ipc: http:\/\/ipc.localhost/);
 const capability=JSON.parse(readFileSync('src-tauri/capabilities/main.json','utf8'));
 assert.equal(capability.remote,undefined);assert.deepEqual(capability.windows,['main']);assert.deepEqual(capability.permissions,['core:default']);
});
