// Verify reader origin isolation and stopped/running rendering without launching a native app.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readerFrameUrl,desktopReaderSource} from '../desktop/reader-frame.ts';

test('embedded reader admits only a separate loopback root origin',()=>{
 for(const shell of ['http://127.0.0.1:1420/','tauri://localhost/','http://tauri.localhost/']){
  assert.equal(readerFrameUrl('http://127.0.0.1:3000',shell),'http://127.0.0.1:3000/');
  assert.equal(readerFrameUrl('http://127.0.0.1:43210/',shell),'http://127.0.0.1:43210/');
  for(const value of [undefined,'','/','file:///tmp/reader.html','javascript:alert(1)','https://127.0.0.1:3000','http://localhost:3000','http://10.0.0.2:3000','https://example.com','http://127.0.0.1.evil.example:3000','http://user:secret@127.0.0.1:3000','http://127.0.0.1:3000/read','http://127.0.0.1:3000/?a=b','http://127.0.0.1:3000/#key','http://127.0.0.1:3000/?','http://127.0.0.1:3000/#'])assert.equal(readerFrameUrl(value,shell),null,value);
 }
 assert.equal(readerFrameUrl('http://127.0.0.1:1420','http://127.0.0.1:1420/'),null);
 assert.equal(readerFrameUrl('http://127.0.0.1:3000','invalid-shell'),null);
});

test('native status gates the reader and cannot fall back to a development address',()=>{
 const props={native:true,running:false,url:'http://127.0.0.1:3000',previewUrl:'http://127.0.0.1:3010',shellUrl:'tauri://localhost/'};
 assert.equal(desktopReaderSource(props),null);
 assert.equal(desktopReaderSource({...props,running:true}),'http://127.0.0.1:3000/');
 assert.equal(desktopReaderSource({...props,running:true,url:undefined}),null);
 assert.equal(desktopReaderSource({...props,running:true,url:'https://example.com'}),null);
 assert.equal(desktopReaderSource({...props,native:false}),'http://127.0.0.1:3010/');
 assert.equal(desktopReaderSource({...props,native:false,previewUrl:undefined}),null);
});

test('reader panel explains unavailable states and renders a narrowly sandboxed frame only while running',async()=>{
 const bundle=await build({stdin:{contents:"export {ReaderPane} from './desktop/ReaderPane.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
 const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
 const render=props=>renderToStaticMarkup(createElement(compiled.exports.ReaderPane,{native:true,running:false,url:'http://127.0.0.1:3000',shellUrl:'tauri://localhost/',...props}));
 const stopped=render({});assert.doesNotMatch(stopped,/<iframe/);assert.match(stopped,/先启动故事服务/);assert.match(stopped,/#desktop-service-toggle/);
 const running=render({running:true});assert.match(running,/<iframe[^>]+title="拾趣阅读与创作"/);assert.match(running,/src="http:\/\/127\.0\.0\.1:3000\/"/);assert.match(running,/sandbox="allow-scripts allow-same-origin allow-downloads"/);assert.match(running,/重新加载阅读端/);assert.match(running,/referrerPolicy="no-referrer"/);
 const invalid=render({running:true,url:'http://evil.example'});assert.doesNotMatch(invalid,/<iframe/);assert.match(invalid,/阅读地址不可用/);
 const preview=render({native:false});assert.doesNotMatch(preview,/<iframe/);assert.match(preview,/VITE_DESKTOP_READER_URL/);
 assert.match(render({native:false,previewUrl:'http://127.0.0.1:1420',shellUrl:'http://127.0.0.1:1420/'}),/预览地址不可用/);
});

test('native shell permits only loopback frames and grants no remote capabilities',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 const directives=Object.fromEntries(config.app.security.csp.split(';').map(value=>value.trim().split(/\s+/)).map(([key,...values])=>[key,values]));
 assert.deepEqual(directives['frame-src'],['http://127.0.0.1:*']);
 assert.deepEqual(directives['connect-src'],['ipc:','http://ipc.localhost']);
 const capability=JSON.parse(readFileSync('src-tauri/capabilities/main.json','utf8'));
 assert.equal(capability.remote,undefined);assert.deepEqual(capability.windows,['main']);assert.deepEqual(capability.permissions,['core:default']);
});
