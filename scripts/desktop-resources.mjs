// Stage shared application resources; Standard adds Node separately and Lite explicitly removes it.
import {build} from 'esbuild';
import {cp,mkdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function stageDesktopResources(entry='server/desktop.ts',target=path.join(root,'desktop/resources/runtime'),edition='standard'){
 if(!['standard','lite'].includes(edition))throw Error('Unknown desktop edition');
 if(edition==='lite')await rm(path.join(path.dirname(target),'node'),{recursive:true,force:true});
 await rm(target,{recursive:true,force:true});await mkdir(path.join(target,'dist/server'),{recursive:true});
 const output=await build({entryPoints:[path.join(root,entry)],outfile:path.join(target,'dist/server/desktop.js'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',metafile:true});
 const dependencies=[...new Set(Object.values(output.metafile.outputs).flatMap(file=>file.imports.filter(item=>item.external&&!item.path.startsWith('node:')).map(item=>item.path.startsWith('@')?item.path.split('/').slice(0,2).join('/'):item.path.split('/')[0])))];
 async function copyPackage(name,from,directory){
  const require=createRequire(path.join(from,'package.json'));
  let location=path.dirname(require.resolve(name));
  while(true){
   try{if(JSON.parse(await readFile(path.join(location,'package.json'),'utf8')).name===name)break;}catch{}
   const parent=path.dirname(location);if(parent===location)throw Error('Cannot locate production package '+name);location=parent;
  }
  const destination=path.join(directory,'node_modules',name);
  await cp(location,destination,{recursive:true,dereference:true,filter:source=>source===location||path.relative(location,source).split(path.sep)[0]!=='node_modules'});
  const manifest=JSON.parse(await readFile(path.join(location,'package.json'),'utf8'));
  for(const dependency of Object.keys(manifest.dependencies||{}))await copyPackage(dependency,location,destination);
 }
 for(const dependency of dependencies)await copyPackage(dependency,root,target);
 for(const [source,destination] of [['dist/client','dist/client'],['data/library','data/library'],['drizzle','drizzle'],['docker/seed.sql','docker/seed.sql']]){
  await mkdir(path.dirname(path.join(target,destination)),{recursive:true});await cp(path.join(root,source),path.join(target,destination),{recursive:true,dereference:true});
 }
 await writeFile(path.join(target,'package.json'),JSON.stringify({name:'shiqu-desktop-runtime',private:true,type:'module',engines:{node:'>=24 <25'}},null,2)+'\n');
 await writeFile(path.join(target,'payload.json'),JSON.stringify({edition,nodeBundled:edition==='standard',dependencies},null,2)+'\n');
 // A fixed allowlist is deliberate: never copy a checkout, .env, .data, or writable ./data.
 return {target,dependencies};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const entry=process.argv.slice(2).find(value=>!value.startsWith('--'))||'server/desktop.ts',edition=process.argv.includes('--lite')?'lite':'standard';
 await stat(path.join(root,entry));
 const result=await stageDesktopResources(entry,undefined,edition);console.log(edition+' application payload prepared ('+result.dependencies.length+' production entry packages).');
}
