// Publish only a freshly tested, built and smoke-checked CLI tarball; consumers receive no release hooks.
import {readFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const checkout=fileURLToPath(new URL('../',import.meta.url));
function runPnpm(args,{cwd}){
 const executable=process.env.npm_execpath;
 if(!executable)throw Error('Run releases with pnpm run npm:publish.');
 const javascript=/\.[cm]?js$/.test(executable);
 return new Promise((resolve,reject)=>{
  const child=spawn(javascript?process.execPath:executable,[...(javascript?[executable]:[]),...args],{cwd,stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`pnpm ${args.slice(0,2).join(' ')} failed (${signal||code}); publication stopped.`)));
 });
}
export async function publishNpm({root=checkout,dryRun=false,run=runPnpm}={}){
 const source=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 const archive=source.publishConfig.name.replace(/^@/,'').replace('/','-')+'-'+source.version+'.tgz';
 const tarball=path.join(root,'outputs/npm',archive);
 await run(['run','npm:check'],{cwd:root});
 await run(['run','build:npm'],{cwd:root});
 if(!(await stat(tarball)).isFile())throw Error('The expected release tarball is missing; publication stopped.');
 await run(['run','npm:smoke',tarball],{cwd:root});
 await run(['publish',tarball,'--access','public',...(dryRun?['--dry-run']:[])],{cwd:root});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.some(arg=>arg!=='--dry-run'))throw Error('Usage: pnpm run npm:publish [--dry-run]');
 await publishNpm({dryRun:args.includes('--dry-run')});
}
