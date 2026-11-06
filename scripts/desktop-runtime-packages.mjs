// 复制正式依赖及已安装的可选平台二进制；不依赖源码 checkout 的模块解析。
import {cp,mkdir,readFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
// 包可能只导出子路径；定位 package.json 不依赖一个不存在的包根入口。
async function runtimePackageDirectory(name,from){
 const require=createRequire(path.join(from,'package.json'));
 for(const base of require.resolve.paths(name)||[]){const directory=path.join(base,name);try{if(JSON.parse(await readFile(path.join(directory,'package.json'),'utf8')).name===name)return realpath(directory);}catch{}}
 throw Error('Cannot locate production package '+name);
}
export async function copyRuntimePackage(name,from,directory,ancestors=new Set()){
 const location=await runtimePackageDirectory(name,from);
 if(ancestors.has(location))return;
 const destination=path.join(directory,'node_modules',name);await mkdir(path.dirname(destination),{recursive:true});
 await cp(location,destination,{recursive:true,dereference:true,filter:source=>source===location||path.relative(location,source).split(path.sep)[0]!=='node_modules'});
 const manifest=JSON.parse(await readFile(path.join(location,'package.json'),'utf8')),chain=new Set([...ancestors,location]);
 for(const dependency of Object.keys(manifest.dependencies||{}))await copyRuntimePackage(dependency,location,destination,chain);
 for(const dependency of Object.keys(manifest.optionalDependencies||{})){let installed=false;try{await runtimePackageDirectory(dependency,location);installed=true;}catch{}if(installed)await copyRuntimePackage(dependency,location,destination,chain);}
}

// 固定资源清单供正式暂存与隔离搬迁测试共用；不复制工作目录或私有书库。
export const desktopRuntimeAssets=[['dist/client','dist/client'],['data/library','data/library'],['data/export-fonts','data/export-fonts'],['drizzle','drizzle'],['docker/seed.sql','docker/seed.sql'],['skills/shiqu','skills/shiqu']];
export async function copyRuntimeAssets(root,directory){for(const [source,destination]of desktopRuntimeAssets){await mkdir(path.dirname(path.join(directory,destination)),{recursive:true});await cp(path.join(root,source),path.join(directory,destination),{recursive:true,dereference:true});}}
