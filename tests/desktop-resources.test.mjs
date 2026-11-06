// 隔离复制依赖、字体与导出器，验证原生模块不能从源码目录借用；不准备桌面包。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {build} from 'esbuild';
import {makeStory} from './fixtures/story.mjs';
import {copyRuntimePackage,copyRuntimeAssets,desktopRuntimeAssets} from '../scripts/desktop-runtime-packages.mjs';
test('relocated exporter resolves its copied platform canvas and bundled verified font',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'shiqu-export-payload-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));await mkdir(path.join(root,'data'),{recursive:true});await cp('data/export-fonts',path.join(root,'data/export-fonts'),{recursive:true});
 const entry=`import {nativeExportRuntime,exportLocalStory} from ${JSON.stringify(path.join(process.cwd(),'server/story-export.ts'))};import {createCanvas} from '@napi-rs/canvas';const c=createCanvas(3,3);const bytes=await c.encode('png');const app={handle:async request=>new URL(request.url).pathname.endsWith('publication-defaults')?Response.json({publication:null}):new Response(bytes,{headers:{'Content-Type':'image/png'}})};const runtime=nativeExportRuntime(process.cwd(),app);await runtime.ready();const result=await exportLocalStory(process.cwd(),app,{state:'completed',story:${JSON.stringify(makeStory(1))}},{format:'png',output:'output.png',allowUnsigned:true});console.log(JSON.stringify({font:true,canvas:true,png:result.bytes>100,bytes:result.bytes}));`;
 const output=path.join(root,'probe.mjs'),result=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'payload-probe.mjs'},outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',metafile:true});
 const packages=[...new Set(Object.values(result.metafile.outputs).flatMap(o=>o.imports.filter(i=>i.external&&!i.path.startsWith('node:')).map(i=>i.path.startsWith('@')?i.path.split('/').slice(0,2).join('/'):i.path.split('/')[0])))];
 for(const name of packages)await copyRuntimePackage(name,process.cwd(),root);
 const child=spawn(process.execPath,[output],{cwd:root,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);const [code]=await once(child,'exit');assert.equal(code,0,stderr);assert.deepEqual({...JSON.parse(stdout),bytes:0},{font:true,canvas:true,png:true,bytes:0});assert.match(await readFile('scripts/desktop-runtime-packages.mjs','utf8'),/data\/export-fonts/);
});

