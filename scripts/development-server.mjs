// 保持局域网开发可用，同时禁止通过 Vite 文件路径读取私有书库。
// 后端尚未监听（启动或首次升级书库）时，代理路径先等待后端，超时才返回 503 说明，不让 Vite 记录连接被拒。
import path from 'node:path';
import {connect} from 'node:net';
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
// 转发给后端的路径前缀；与 Vite 一样按前缀匹配。
export const developmentProxyPrefixes=['/art','/api','/desktop'];
export const backendStartingMessage='拾趣服务正在启动；书库数据库迁移时可能需要一分钟，请稍候再试。';
function backendListening(port){
 return new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
}
// 在代理之前确认后端已监听。未监听时每隔 intervalMs 重新探测，最多等待 holdMs，超时返回 503。
// 只短暂等待：浏览器对同一主机的 HTTP/1.1 连接数有限，挂起过多请求会阻塞页面资源。
// 确认后不再探测；运行中的后端断开（例如 --watch 重启）时恢复探测。
export function backendStartupGate({apiPort,prefixes=developmentProxyPrefixes,probe=backendListening,holdMs=30000,intervalMs=500,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let available=false;
 return {
  plugin:{name:'shiqu-backend-startup',configureServer(server){
   server.middlewares.use(async(request,response,next)=>{
    if(available||!prefixes.some(prefix=>(request.url||'').startsWith(prefix)))return next();
    // 浏览器放弃请求后停止等待。
    let closed=false;response.once?.('close',()=>{closed=true;});
    for(const deadline=now()+holdMs;;){
     if(available||await probe(apiPort)){available=true;return next();}
     if(closed)return;
     if(now()>=deadline)break;
     await sleep(intervalMs);
    }
    response.statusCode=503;response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.setHeader('Retry-After','2');
    response.end(JSON.stringify({error:backendStartingMessage}));
   });
  }},
  configureProxy(proxy){proxy.on('error',error=>{if(error?.code==='ECONNREFUSED')available=false;});},
 };
}
export function developmentServerOptions({port,apiPort,library,configureProxy}){
 const directory=normalizePath(path.resolve(library)).replace(/[()[\]{}!*?+@|]/g,'\\$&');
 const target={target:`http://127.0.0.1:${apiPort}`,changeOrigin:false,...(configureProxy?{configure:configureProxy}:{})};
 return {host:'0.0.0.0',port,strictPort:true,
  fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.data/**','**/backups/**','**/*-backups/**','**/*.{sqlite,sqlite-wal,sqlite-shm,db,db-wal,db-shm}','**/media/**','**/reader-cache/**','**/.desktop*',directory,directory+'/**']},
  proxy:Object.fromEntries(developmentProxyPrefixes.map(prefix=>[prefix,{...target}])),
 };
}
