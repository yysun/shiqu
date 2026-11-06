// 桌面载荷携带同版本技能与正式CLI入口；固定Node运行时另行复制。
// 导出依赖通过可单独验证的复制器处理，不在测试中运行桌面准备。
import {copyRuntimePackage,copyRuntimeAssets} from './desktop-runtime-packages.mjs';
import {build} from 'esbuild';
import {mkdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildAgentCli(sourceRoot,target){return build({entryPoints:[path.join(sourceRoot,'server/agent-cli.ts')],outfile:path.join(target,'dist/server/agent-cli.js'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',metafile:true});}
export async function buildDesktopEntries(sourceRoot,target,entry='server/desktop.ts'){
 const output=await build({entryPoints:[path.join(sourceRoot,entry)],outfile:path.join(target,'dist/server/desktop.js'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',metafile:true});
 const cli=await buildAgentCli(sourceRoot,target);
 return [...new Set(Object.values({...output.metafile.outputs,...cli.metafile.outputs}).flatMap(file=>file.imports.filter(item=>item.external&&!item.path.startsWith('node:')).map(item=>item.path.startsWith('@')?item.path.split('/').slice(0,2).join('/'):item.path.split('/')[0])))];
}
export async function stageDesktopResources(entry='server/desktop.ts',target=path.join(root,'desktop/resources/runtime')){
 await rm(target,{recursive:true,force:true});await mkdir(path.join(target,'dist/server'),{recursive:true});
 const dependencies=await buildDesktopEntries(root,target,entry);
 for(const dependency of dependencies)await copyRuntimePackage(dependency,root,target);
 await copyRuntimeAssets(root,target);
 await writeFile(path.join(target,'package.json'),JSON.stringify({name:'shiqu-desktop-runtime',version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,private:true,type:'module',engines:{node:'>=24 <25'}},null,2)+'\n');
 await writeFile(path.join(target,'payload.json'),JSON.stringify({edition:'standard',nodeBundled:true,dependencies},null,2)+'\n');
 // 固定白名单禁止复制源码目录、环境文件或用户书库。
 return {target,dependencies};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).some(value=>value.startsWith('--')))throw Error('Unknown desktop resource option');
 const entry=process.argv[2]||'server/desktop.ts';
 await stat(path.join(root,entry));
 const result=await stageDesktopResources(entry);console.log('Desktop application payload prepared ('+result.dependencies.length+' production entry packages).');
}
