// 开发内循环的相关测试反查：直接导入者、路径字面量与 manifest covers 三者取并集。
// 直接导入者指测试文件、其 tests/ 夹具或经由它们导入的前端组件（client/、desktop/）直接导入改动文件；
// 不沿 lib/、server/ 继续传递，否则共享夹具会让核心模块的相关集接近全量。完整影响面由 test:changed 与 CI 负责。
// 仅供 test:related 动态加载；构建失败的入口视为相关，绝不把无法判断当作空集。
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {loadMetadata} from './test-metadata.mjs';

const options=root=>({absWorkingDir:root,bundle:true,write:false,metafile:true,outdir:path.join(root,'.data/test-graph'),platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});
// 每个测试入口在 tests/ 内可达的文件（local）及经由 tests/ 与前端组件可达文件的直接导入；构建失败的入口记为 null。
// 使用 metafile.inputs 的导入边，不受 tree-shaking 丢弃未使用导入的影响。
export async function testImports(entries,root=process.cwd()){
 const edges=new Map(),failed=new Map();
 const collect=metafile=>{for(const [file,input] of Object.entries(metafile.inputs))edges.set(file,input.imports.filter(item=>!item.external).map(item=>item.path));};
 try{collect((await build({...options(root),entryPoints:entries})).metafile);}
 catch{
  // 删除/改名会让整体构建失败；逐个重建以确定哪些入口受影响，错误位置可能只是中间导入方。
  await Promise.all(entries.map(async entry=>{
   try{collect((await build({...options(root),entryPoints:[entry]})).metafile);}catch(error){failed.set(entry,error);}
  }));
  // 全部入口都失败通常是 esbuild 本身不可用，无法判断相关性时报错而非运行全部测试。
  if(failed.size&&failed.size===entries.length)throw Error(`无法分析测试导入，请运行 pnpm test:changed：${failed.values().next().value.message}`);
  if(failed.size)console.error(`${failed.size} 个测试无法解析导入，已视为相关：${failed.values().next().value.message.split('\n')[0]}`);
 }
 const result=new Map();
 for(const entry of entries){
  if(failed.has(entry)){result.set(entry,null);continue;}
  const local=new Set([entry]),reached=new Set([entry]),stack=[entry],imports=new Set();
  while(stack.length)for(const next of edges.get(stack.pop())??[]){
   imports.add(next);
   if(/^(?:tests|client|desktop)\//.test(next)&&!reached.has(next)){reached.add(next);stack.push(next);if(next.startsWith('tests/'))local.add(next);}
  }
  result.set(entry,{local,imports});
 }
 return result;
}
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// 按路径段边界匹配仓库相对路径及相对该源码的 ./、../ 写法，覆盖按路径读取的文件、字符串内打包和子进程入口；
// 模板字符串拼出的路径无法识别。少量多选无害。
const literal=file=>`(?<![\\w.-])${escape(file)}(?![\\w./-])`;
const relative=(input,file)=>{const rel=path.posix.relative(path.posix.dirname(input),file);return rel.startsWith('../')?rel:'./'+rel;};
const mentions=(input,files)=>new RegExp(files.flatMap(file=>[literal(file),literal(relative(input,file))]).join('|'));
export async function relatedTests(files,{root=process.cwd(),metadata=loadMetadata(root)}={}){
 const entries=metadata.tests.filter(entry=>entry.level!=='native');
 const graph=await testImports(entries.map(entry=>entry.file),root),selected=new Set(),matches=new Map();
 for(const entry of entries){
  const found=graph.get(entry.file);
  if(found===null||files.some(file=>found.imports.has(file))){selected.add(entry.file);continue;}
  // 测试自身及其夹具中出现改动路径时同样相关。
  if(entry.relatedPathLiterals!==false)for(const input of found.local){
   // 每个源码只读取并匹配一次，共享夹具被多个测试复用。
   if(!matches.has(input))matches.set(input,files.length>0&&mentions(input,files).test(await readFile(path.join(root,input),'utf8').catch(()=>'')));
   if(matches.get(input)){selected.add(entry.file);break;}
  }
 }
 for(const entry of metadata.tests)if(files.some(file=>entry.file===file||entry.covers.includes(file)))selected.add(entry.file);
 return [...selected].sort();
}
