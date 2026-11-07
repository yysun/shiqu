// Overview counts must reflect generated-record checkpoints; browser links and native permissions remain scoped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {savedProvider} from '../desktop/console-state.ts';
import {localReaderUrl} from '../desktop/reader-url.ts';
import {defaultSystemSettings} from '../lib/system-settings.ts';

test('preview browser opens only a distinct local reader root without credentials, query or fragment',()=>{
 const consoleUrl='http://127.0.0.1:1420/';
 assert.equal(localReaderUrl('http://127.0.0.1:3000',consoleUrl),'http://127.0.0.1:3000/');
 for(const value of [undefined,'','/','javascript:alert(1)','file:///tmp/reader.html','https://example.com','http://10.0.0.2:3000','http://localhost:3000','https://127.0.0.1:3000','http://user:secret@127.0.0.1:3000','http://127.0.0.1:3000/read','http://127.0.0.1:3000/?','http://127.0.0.1:3000/#','http://127.0.0.1:1420/'])assert.equal(localReaderUrl(value,consoleUrl),null,value);
});

test('native console no longer grants loopback frame access or remote capabilities',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 assert.doesNotMatch(config.app.security.csp,/frame-src|127\.0\.0\.1/);
 assert.match(config.app.security.csp,/connect-src ipc: http:\/\/ipc.localhost/);
 const capability=JSON.parse(readFileSync('src-tauri/capabilities/main.json','utf8'));
 assert.equal(capability.remote,undefined);assert.deepEqual(capability.windows,['main']);assert.deepEqual(capability.permissions,['core:default']);
});

test('console renders lifecycle controls, saved/runtime summaries and safe upgrade backup without story controls',async()=>{
 const {ServiceCard}=await import('../desktop/ServiceCard.tsx');
 const settings=defaultSystemSettings('/isolated/library'),props={native:true,state:'stopped',status:{running:false,phoneUrls:[]},provider:savedProvider(settings),busy:'',nodeError:'',onStart(){},onStop(){},onRestart(){},onOpen(){},onSettings(){},previewUrl:null};
 const render=patch=>renderToStaticMarkup(createElement(ServiceCard,{...props,...patch}));
 assert.match(render({status:{running:true,phoneUrls:[],agentSkill:{status:'installed',message:'拾趣技能：已安装，可在 AI 助手中使用 $shiqu'}}}),/拾趣技能：已安装/);
 assert.match(render({}),/未配置生成服务/);assert.match(render({}),/启动服务/);assert.match(render({}),/已保存配置/);
 assert.doesNotMatch(render({}),/type="password"|生成队列|书架故事|role="tab/);
 assert.match(render({state:'upgrading',status:{running:false,backup:'/isolated/verified-backup'}}),/正在升级书库/);
 assert.match(render({state:'running',status:{running:true,restartRequired:true},provider:{provider:'openai',models:{text:'running-text',image:'running-image'}}}),/当前运行.*OpenAI API/);
 assert.match(render({state:'running',status:{running:true,restartRequired:true}}),/待重启生效/);
 assert.match(render({provider:savedProvider({...settings,provider:'readonly'})}),/只读/);
});

test('stopped provider summary requires both active API keys even when providerConfigured remains true',()=>{
 const settings={...defaultSystemSettings('/isolated/library'),providerConfigured:true};
 assert.equal(savedProvider(settings,{gemini:false,openai:true}).configured,false);
 assert.equal(savedProvider(settings,{gemini:true,openai:false}).configured,true);
 assert.equal(savedProvider({...settings,imageProvider:'openai'},{gemini:true,openai:false}).configured,false);
 assert.equal(savedProvider({...settings,imageProvider:'openai'},{gemini:true,openai:true}).configured,true);
 assert.equal(savedProvider({...settings,provider:'codex'}).configured,true);
});
