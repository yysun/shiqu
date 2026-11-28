// Route the current story workflow and retain reads for previously saved uploaded media.
import {createReaderApi} from './reader-api.ts';
import type {Services} from './services.ts';

export function createApi(services:Services){
 const readerApi=createReaderApi(services);
 const json=(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
 return async function api(req:Request,path:string[],cli=false):Promise<Response>{
  if(path[0]==='reader')return readerApi(req,path.slice(1),cli);
  if(path[0]!=='media'||path.length!==2||req.method!=='GET')return json('接口不存在',404);
  if(!/^[a-zA-Z0-9._-]+$/.test(path[1]))return json('无效文件名',400);
  try{
   const asset=await services.media.get(path[1]);
   if(!asset)return json('文件不存在',404);
   return new Response(asset.body,{headers:{'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Type':asset.contentType}});
  }catch{
   return json('文件暂时无法读取，请稍后重试。',500);
  }
 };
}
