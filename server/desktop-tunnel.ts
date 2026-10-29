// Supervise an accountless Cloudflare helper without inheriting AI credentials or user tunnel config.
// Abort startup promptly on parent shutdown; raw helper output is parsed in bounded memory, never logged.
import {spawn} from 'node:child_process';
import {access,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class TunnelError extends Error{}
const failed=()=>new TunnelError('免费公网隧道未能连接。请检查网络与 cloudflared，或关闭互联网访问后使用局域网。');
async function executable(configured:string){
 if(configured&&!path.isAbsolute(configured))throw new TunnelError('cloudflared 路径必须是可执行文件的绝对路径。');
 const name=process.platform==='win32'?'cloudflared.exe':'cloudflared';
 const candidates=configured?[configured]:[
  ...(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(folder=>path.join(folder,name)),
  '/opt/homebrew/bin/cloudflared','/usr/local/bin/cloudflared','/usr/bin/cloudflared',
  ...(process.platform==='win32'?[path.join(process.env.LOCALAPPDATA||os.homedir(),'Microsoft/WinGet/Links',name),path.join(process.env.ProgramFiles||'C:\\Program Files','cloudflared',name)]:[]),
 ];
 for(const candidate of candidates){try{await access(candidate,constants.X_OK);return candidate;}catch{/* Try the next installed location. */}}
 throw new TunnelError('未找到 cloudflared。请先安装 Cloudflare Tunnel（macOS：brew install cloudflared），或填写其绝对路径。');
}
export async function startDesktopTunnel(target:string,configured='',options:{signal?:AbortSignal;timeoutMs?:number}={}){
 options.signal?.throwIfAborted();
 const binary=await executable(configured),folder=await mkdtemp(path.join(os.tmpdir(),'shiqu-tunnel-'));
 let stopped:Promise<void>|undefined;
 try{
  const config=path.join(folder,'config.yml');await writeFile(config,'{}\n',{mode:0o600});options.signal?.throwIfAborted();
  const environment:NodeJS.ProcessEnv={HOME:folder,USERPROFILE:folder};
  for(const key of ['PATH','SYSTEMROOT','WINDIR','TEMP','TMP'])if(process.env[key])environment[key]=process.env[key];
  const child=spawn(binary,['tunnel','--config',config,'--no-autoupdate','--url',target,'--metrics','127.0.0.1:0','--grace-period','1s'],{cwd:folder,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const closed=new Promise<void>(resolve=>{child.once('close',()=>resolve());});
  const emergency=()=>{child.kill('SIGKILL');};process.once('exit',emergency);
  function stop(){
   return stopped??=(async()=>{
    child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
    try{await closed;}finally{clearTimeout(timer);process.off('exit',emergency);await rm(folder,{recursive:true,force:true});}
   })();
  }
  const abort=()=>{void stop();};options.signal?.addEventListener('abort',abort,{once:true});
  void closed.then(()=>{options.signal?.removeEventListener('abort',abort);process.off('exit',emergency);});
  try{
   const origin=await new Promise<string>((resolve,reject)=>{
    let output='',url='',registered=false;
    const timer=setTimeout(()=>finish(failed()),options.timeoutMs??45000);
    const onAbort=()=>finish(new TunnelError('公网隧道启动已取消。'));
    function finish(error?:Error){clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);if(error)reject(error);else resolve(url);}
    const capture=(chunk:Buffer)=>{
     output=(output+chunk.toString()).slice(-16384);
     url=output.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=[\s"|]|$)/)?.[0]||url;
     registered=registered||output.includes('Registered tunnel connection');
     if(url&&registered)finish();
    };
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.once('error',()=>finish(failed()));child.once('exit',()=>finish(failed()));
    options.signal?.addEventListener('abort',onAbort,{once:true});if(options.signal?.aborted)onAbort();
   });
   if(child.exitCode!==null||child.signalCode!==null||options.signal?.aborted)throw failed();
   return {origin,closed,pid:child.pid!,stop};
  }catch(error){await stop();throw error;}
 }catch(error){await rm(folder,{recursive:true,force:true});throw error;}
}
