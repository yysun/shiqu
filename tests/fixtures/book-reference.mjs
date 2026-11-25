// Seed owned, paused image checkpoints without inference so reference tests can isolate paid dispatch.
import {makePlan,selection} from './production.mjs';
import {png} from './images.mjs';
export const owner='docker-local-owner';
export async function savedStory(f,{id=crypto.randomUUID(),bookId='红楼梦',customBook,bytes=png,page=0,ownerId=owner,image}={}){
 const ext=bytes[0]===255?'jpg':'png';
 const url=image??`/api/reader/media/${id}/${page}.${ext}`,doc={plan:makePlan(2),images:[],audio:[],usage:[]};doc.images[page]=url;
 const now=new Date().toISOString();
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'paused',0,?,?)").bind(id,ownerId,JSON.stringify({...selection,bookId,...(customBook?{customBook}:{})}),JSON.stringify(doc),now,now).run();
 if(!image)await f.app.services.media.put(`reader/${id}/${page}.${ext}`,bytes,{contentType:ext==='jpg'?'image/jpeg':'image/png'});
 return {id,url,doc};
}
export const star=(f,id,page=0)=>f.json(`library/${id}/reference`,'POST',{page,starred:true});
export const unstar=(f,id,reference)=>f.json(`library/${id}/reference`,'POST',{page:reference.page,starred:false,token:reference.token});
