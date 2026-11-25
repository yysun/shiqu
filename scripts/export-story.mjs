// Export named stories with the production Node renderer and the running app's read-only API.
// Preserve signed artwork in ZIP inputs; validate current revisions and public archives before replacement.
import assert from 'node:assert/strict';
import {copyFile,lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {sha256Hex as digest} from '../lib/story-webp-metadata.ts';
import {zipFilename} from '../lib/reader-zip-content.ts';
import {savedJSON,publicStoryZip} from '../lib/public-story-zip.mjs';
export {publicStoryZip} from '../lib/public-story-zip.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const collection=path.resolve(project,'../awesome-shiqu');


async function collectionCheck(bytes){
 const parser=path.join(collection,'site/assets/story-archive.mjs');
 try{await lstat(parser);}catch(error){if(error.code==='ENOENT')return;throw error;}
 const {parseStoryArchive}=await import(pathToFileURL(parser).href);
 await parseStoryArchive(bytes,{id:'yysun--export-check',author:'yysun',publishedAt:new Date().toISOString().slice(0,10)});
}

export async function exportStory(input,{output,outputDirectory=path.join(collection,'works/yysun'),resolveCurrentId}={}){
 const {bytes,story}=publicStoryZip(new Uint8Array(await readFile(input)));
 await collectionCheck(bytes);
 await mkdir(output?path.dirname(path.resolve(output)):outputDirectory,{recursive:true});
 let target=output?path.resolve(output):path.join(outputDirectory,zipFilename(story.title));
 if(!output){
  const matches=[];
  for(const name of await readdir(outputDirectory)){
   if(!name.endsWith('.zip'))continue;
   const filename=path.join(outputDirectory,name),saved=savedJSON(new Uint8Array(await readFile(filename)));
   if(saved.id===story.id||resolveCurrentId&&await resolveCurrentId(saved.id)===story.id)matches.push(filename);
  }
  assert(matches.length<=1,'输出目录已有同一作品的多个 ZIP，请先清理重复文件。');
  if(matches.length)target=matches[0];
 }
 let existing;
 try{assert((await lstat(target)).isFile(),'输出路径必须是普通文件。');existing=await readFile(target);}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing&&!output){
  const id=savedJSON(new Uint8Array(existing)).id;
  assert(id===story.id||resolveCurrentId&&await resolveCurrentId(id)===story.id,'同名 ZIP 属于另一作品，请用 --output 明确指定输出路径。');
 }
 const temporary=target+'.tmp',backup=await mkdtemp(path.join(tmpdir(),'shiqu-export-'));
 let replaced=false,wroteTemporary=false;
 try{
  await writeFile(temporary,bytes,{flag:'wx'});wroteTemporary=true;
  if(existing)await copyFile(target,path.join(backup,'previous.zip'));
  await rename(temporary,target);replaced=true;
  const saved=await readFile(target);assert(digest(saved)===digest(bytes),'保存后的 ZIP 与导出内容不符。');
  await collectionCheck(saved);
 }catch(error){
  if(replaced){if(existing){await copyFile(path.join(backup,'previous.zip'),temporary);await rename(temporary,target);}else await rm(target);}
  throw error;
 }finally{if(wroteTemporary)await rm(temporary,{force:true});await rm(backup,{recursive:true,force:true});}
 return {path:target,title:story.title,pages:story.pages.length,bytes:bytes.length,sha256:digest(bytes)};
}

function matchExportSession(sessions,name){
 const matches=sessions.filter(session=>!session.superseded&&(session.id===name||(session.title??session.story?.title)===name||(session.sourceTitle??session.selection?.storyTitle)===name));
 assert(matches.length,`书架没有找到：${name}`);
 assert(matches.length===1,`同名故事不止一篇，请指定作品 ID：${matches.map(session=>session.id).join('、')}`);
 return matches[0];
}
export function selectExportSession(sessions,name){
 const session=matchExportSession(sessions,name),pages=session.story?.pages;
 assert(pages?.length,'这篇故事尚未保存分镜。');
 const missing=pages.flatMap((page,index)=>page.image?[]:[index+1]);
 assert(!missing.length,`缺少第 ${missing.join('、')} 幅图片；请完成当前版本，不导出旧版。`);
 return session;
}

export async function exportNamedStory(name,{appUrl='http://localhost:3000',onProgress=()=>{},...options}={}){
 const base=new URL(appUrl);assert(['http:','https:'].includes(base.protocol),'应用地址必须使用 http 或 https。');
 const app={handle:request=>{const url=new URL(request.url);return fetch(new URL(url.pathname+url.search,base),{redirect:'error',signal:AbortSignal.timeout(30000)});}};
 async function api(route,optional=false){
  const response=await app.handle(new Request('http://shiqu.local/api/reader/'+route));
  if(optional&&response.status===404)return null;
  assert(response.ok,`无法读取拾趣 ${route}：HTTP ${response.status}。请确认应用地址及访问权限。`);
  return response.json();
 }
 const id=/^[0-9a-f-]{36}$/i.test(name)?name:matchExportSession(await api('sessions?view=export'),name).id;
 const session=await api(`sessions/${id}/export`);
 selectExportSession([session],session.id);
 onProgress(`已选择：${session.story.title} · 版本 ${session.story.revision} · ${session.story.pages.length} 幅`);
 const temporary=await mkdtemp(path.join(tmpdir(),'shiqu-native-export-'));
 try{
  const {exportLocalStory}=await import('../server/story-export.ts');
  const input=path.join(temporary,'story.zip');
  onProgress('正在通过 Node 生成公开 ZIP…');
  await exportLocalStory(project,app,session,{format:'zip',output:input});
  const data=savedJSON(new Uint8Array(await readFile(input)));
  assert(data.id===session.id&&data.revision===session.story.revision,'导出文件不是所选的当前版本。');
  assert((await api(`sessions/${session.id}/export`)).id===session.id,'导出期间书架已切换到新版，请重新导出。');
  const currentIds=new Map();
  async function resolveCurrentId(id){
   if(!currentIds.has(id)){
    const current=/^[0-9a-f-]{36}$/i.test(id)?await api(`sessions/${id}/export`,true):null;
    currentIds.set(id,current?.id);
   }
   return currentIds.get(id);
  }
  onProgress('正在验证并保存公开 ZIP…');
  return await exportStory(input,{...options,resolveCurrentId});
 }finally{await rm(temporary,{recursive:true,force:true});}
}

async function main(){
 const {values,positionals}=parseArgs({options:{output:{type:'string'},url:{type:'string',default:'http://localhost:3000'},help:{type:'boolean',short:'h'}},allowPositionals:true});
 if(values.help){
  console.log('用法：pnpm export:story <故事名、作品ID或已下载的.zip> [--url http://localhost:3000] [--output 输出.zip]\n故事名/ID：从运行中的应用读取当前版本，使用生产 Node 导出器生成公开 ZIP；无需浏览器或 Playwright。\nZIP 文件：直接转换现有下载，保留图片字节。默认保存到 ../awesome-shiqu/works/yysun，并沿用同作品的已有文件名。');return;
 }
 assert(positionals.length===1,'请提供一个故事名、作品 ID 或已下载的 ZIP；详见 pnpm export:story --help。');
 const input=positionals[0],options={output:values.output};
 const result=/\.zip$/i.test(input)?await exportStory(input,options):await exportNamedStory(input,{...options,appUrl:values.url,onProgress:console.log});
 console.log(`已导出：${result.path}\n${result.pages} 幅，${(result.bytes/1024/1024).toFixed(2)} MiB\nSHA-256：${result.sha256}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
