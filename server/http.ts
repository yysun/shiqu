// Adapt bounded Node HTTP requests to Fetch handlers, retaining multipart and binary media.
import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {once} from 'node:events';
const maxBody=13*1024*1024;
async function incoming(request:IncomingMessage){
 const headers=new Headers();
 for(const [key,value] of Object.entries(request.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
 const chunks:Buffer[]=[];let size=0;
 const tooLarge=()=>Object.assign(Error('Request too large'),{status:413});
 if(Number(request.headers['content-length']||0)>maxBody){request.resume();throw tooLarge();}
 await new Promise<void>((resolve,reject)=>{
  request.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBody){chunks.length=0;reject(tooLarge());}else if(size<=maxBody)chunks.push(chunk);});
  request.once('end',resolve);request.once('error',reject);request.once('aborted',()=>reject(Error('Request aborted')));
 });
 return new Request(new URL(request.url||'/',`http://${headers.get('host')||'localhost'}`),{
  method:request.method,headers,...(!['GET','HEAD'].includes(request.method||'GET')?{body:new Uint8Array(Buffer.concat(chunks))}:{}),
 });
}
async function outgoing(response:Response,target:ServerResponse){
 target.statusCode=response.status;
 response.headers.forEach((value,key)=>target.setHeader(key,value));
 target.flushHeaders();
 if(response.body){
  const reader=response.body.getReader();
  const disconnected=()=>{void reader.cancel().catch(()=>{});};
  target.once('close',disconnected);
  try{while(!target.destroyed){const {done,value}=await reader.read();if(done)break;if(!target.write(value))await Promise.race([once(target,'drain'),once(target,'close')]);}}
  finally{target.off('close',disconnected);await reader.cancel();}
 }
 target.end();
}
export function createHttpServer(handle:(request:Request)=>Promise<Response>){
 return createServer(async(req,res)=>{
  try{await outgoing(await handle(await incoming(req)),res);}
  catch(error){
   if(res.headersSent){res.destroy();return;}
   const status=(error as {status?:number}).status===413?413:400;
   res.writeHead(status,{'Content-Type':'application/json'});
   res.end(JSON.stringify({error:status===413?'请求过大':'请求格式不正确'}));
  }
 });
}
