// 保持局域网开发可用，同时禁止通过 Vite 文件路径读取私有书库。
import path from 'node:path';
import {existsSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {normalizePath,isFileServingAllowed} from 'vite';
import {providerSettingsPath,providerSettingsProofHeader} from '../lib/provider-settings.ts';
import {providerSettingsNetworkAccess} from '../server/provider-settings-access.ts';
// Vite 将局域网请求转为回环代理；必须在代理前校验原始套接字与接口 Host。
export function protectLocalProviderSettings(proxyToken){
 if(!proxyToken)throw Error('Local provider settings require private proxy proof');
 return {name:'shiqu-local-provider-settings',configureServer(server){
  const networkAccess=providerSettingsNetworkAccess([server.config.server.port]);
  server.middlewares.use((request,response,next)=>{
   if(new URL(request.url||'/', 'http://localhost').pathname===providerSettingsPath){
    if(!networkAccess(request.socket.remoteAddress,request.headers.host||'')){
     response.statusCode=403;response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify({error:'请使用本机或可信局域网地址打开生成服务设置。'}));return;
    }
    request.headers[providerSettingsProofHeader]=proxyToken;
   }
   next();
  });
 }};
}
// Local development opts into a checkout-owned shelf; an unknown mode must never open a shared one.
export function developmentArguments(args,variables=process.env,cwd=process.cwd()){
 const remaining=[...args],local=remaining[0]==='local';if(local)remaining.shift();
 let port=3000;
 while(remaining.length){const option=remaining.shift();if(option!=='--port'||!remaining.length)throw Error('Usage: pnpm dev [local] [--port <port>]');port=Number(remaining.shift());}
 const apiPort=Number(variables.SHIQU_API_PORT||3002);
 for(const [name,value] of [['--port',port],['SHIQU_API_PORT',apiPort]])if(!Number.isInteger(value)||value<1||value>65535)throw Error(`Invalid ${name}`);
 if(apiPort===port)throw Error('SHIQU_API_PORT must differ from the Vite port');
 return {local,port,apiPort,...(local?{library:path.resolve(cwd,'.data/dev-local')}:{})};
}
function canonical(filename){
 let parent=path.resolve(filename),suffix=[];
 while(!existsSync(parent)){suffix.unshift(path.basename(parent));const next=path.dirname(parent);if(next===parent)break;parent=next;}
 return path.join(realpathSync(parent),...suffix);
}
function inside(file,directory){const relative=path.relative(directory,file);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
export function protectDevelopmentLibrary(library){
 return {name:'shiqu-protect-public-library',configResolved(config){
  if(!config.publicDir)return;
  const shelf=canonical(library),publicDirectory=canonical(config.publicDir);
  const publicConfig={...config,server:{...config.server,fs:{...config.server.fs,allow:[...config.server.fs.allow.map(canonical),publicDirectory]}}};
  if(inside(shelf,publicDirectory)||inside(publicDirectory,shelf))throw Error('Story library must be outside Vite publicDir');
  if(!existsSync(config.publicDir))return;
  // Vite public files bypass fs.deny. Refuse private files and aliases before serving starts.
  const seen=new Set();
  function inspect(directory){
   const resolved=canonical(directory);if(seen.has(resolved))return;seen.add(resolved);
   if(inside(resolved,shelf))throw Error('Vite publicDir contains a story-library alias');
   for(const entry of readdirSync(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name),actual=canonical(filename),info=lstatSync(filename);
    if(info.isDirectory()||info.isSymbolicLink()&&lstatSync(actual).isDirectory())inspect(actual);
    else if(!isFileServingAllowed(publicConfig,normalizePath(actual)))throw Error('Vite publicDir contains a private runtime file');
   }
  }
  inspect(config.publicDir);
 }};
}
export function developmentServerOptions({port,apiPort,library}){
 const directory=normalizePath(path.resolve(library)).replace(/[()[\]{}!*?+@|]/g,'\\$&');
 return {host:'0.0.0.0',port,strictPort:true,
  fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.data/**','**/backups/**','**/*-backups/**','**/*.{sqlite,sqlite-wal,sqlite-shm,db,db-wal,db-shm}','**/media/**','**/reader-cache/**','**/.desktop*',directory,directory+'/**']},
  proxy:{'/art':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false},'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false},'/desktop':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:false}},
 };
}
