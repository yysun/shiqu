// 在隔离工作区对每个标签提交运行快速发布冒烟；CI 负责原生测试与安装包冒烟。
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(args,options={}){
 const result=spawnSync('git',args,{encoding:'utf8',...options});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||'Git command failed.');
 return result.stdout.trim();
}
function pnpm(args,cwd,env,capture=false){
 // Only fixed command arguments reach the Windows command shell required by pnpm.cmd.
 const result=spawnSync('pnpm',args,{cwd,env,shell:process.platform==='win32',encoding:'utf8',stdio:capture?'pipe':'inherit'});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||`pnpm ${args.join(' ')} failed; push stopped.`);
 return result.stdout?.trim();
}
try{
 const commits=new Set();
 for(const line of readFileSync(0,'utf8').trim().split('\n')){
  const [,oid,remoteRef]=line.trim().split(/\s+/);
  if(!remoteRef?.startsWith('refs/tags/v')||/^0+$/.test(oid))continue;
  commits.add(git(['rev-parse','--verify',`${oid}^{commit}`]));
 }
 if(commits.size){
  const env={...process.env};
  // Hook-local Git variables must not redirect nested test repositories into this checkout.
  for(const name of git(['rev-parse','--local-env-vars']).split('\n'))delete env[name];
  for(const commit of commits){
   const temporary=mkdtempSync(path.join(os.tmpdir(),'shiqu-release-check-')),checkout=path.join(temporary,'checkout');
   let added=false;
   try{
    git(['worktree','add','--quiet','--detach',checkout,commit],{env});added=true;
    const pinned=readFileSync(path.join(checkout,'.nvmrc'),'utf8').trim();
    if(process.versions.node!==pinned)throw Error(`Release checks require Node ${pinned}; run nvm use before pushing.`);
    const manifest=JSON.parse(readFileSync(path.join(checkout,'package.json'),'utf8'));
    const expected=manifest.packageManager?.match(/^pnpm@([^+]+)/)?.[1];
    if(!expected||pnpm(['--version'],checkout,env,true)!==expected)throw Error(`Use ${manifest.packageManager} before pushing.`);
    console.log(`Checking release commit ${commit} in an isolated checkout.`);
    pnpm(['install','--frozen-lockfile'],checkout,env);
    pnpm(['run','release:check'],checkout,env);
   }finally{
    if(added)git(['worktree','remove','--force',checkout],{env});
    rmSync(temporary,{recursive:true,force:true});
   }
  }
 }
}catch(error){
 console.error(`Release pre-push check failed: ${error.message}`);
 process.exitCode=1;
}
