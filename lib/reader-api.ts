// Route authenticated reading, recovery, and generation operations within each reader's library.
import {events} from '../db/schema.ts';
import type {Services} from './services.ts';
import {z} from 'zod';
import {ReaderRepository} from './reader-repository.ts';
import {advanceStory} from './reader-engine.ts';
import {suggestionRequestSchema} from './reader-suggestions.ts';
import {ReaderError,selectionSchema,view} from './reader-model.ts';
import {sourceSearchUrl} from './reader-source.ts';
import {readerMaxFrames} from './reader-limits.ts';
import type {Document} from './reader-model.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=z.string().uuid();
async function body(req:Request,maxLength=4096){const s=await req.text();if(s.length>maxLength)throw new ReaderError(413,'请求太长了');try{return JSON.parse(s);}catch{throw new ReaderError(400,'请求格式不正确');}}
export function createReaderApi(services:Services){
const provider=services.generation;
async function requireProvider(){const status=await provider.status();if(!status.configured)throw new ReaderError(503,status.message||'即时生成服务还未接通，请检查服务配置。');}
return async function readerApi(req:Request,path:string[]):Promise<Response>{
 try{
  if(path.join('/')==='status'&&req.method==='GET')return json(await provider.status());
  const uid=services.ownerId;if(!uid)throw new ReaderError(401,'请先登录，再开启属于你的故事。');
  const url=new URL(req.url);if(req.method!=='GET'){const origin=req.headers.get('origin');if(origin&&origin!==url.origin)throw new ReaderError(403,'不允许跨站请求');}
  if(!services.database)throw new ReaderError(503,'书架暂时不可用');
  const repo=new ReaderRepository(services.database);
  if(path.join('/')==='deletions'&&req.method==='GET')return json(await repo.deletions(uid));
  if(path[0]==='library'&&path.length===2&&req.method==='DELETE'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.remove(id,uid));}
  if(path[0]==='library'&&path.length===3&&path[2]==='restore'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.restore(id,uid));}
  if(path.join('/')==='suggestions'&&req.method==='POST'){
   await requireProvider();
   const {excludeTitles,excludeSources,...selection}=suggestionRequestSchema.parse(await body(req,1048576));
   if(req.headers.get('accept')==='application/x-ndjson'){
    const abort=new AbortController(),encoder=new TextEncoder();
    const stream=new ReadableStream<Uint8Array>({
     start(controller){
      const send=(event:unknown)=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
      send({type:'progress',progress:{completed:0,total:1,completedChars:0,totalChars:0,stage:'reading'}});
      void provider.suggestions(selection,excludeTitles,undefined,{signal:abort.signal,onProgress:progress=>send({type:'progress',progress})},excludeSources)
       .then(batch=>send({type:'result',batch}))
       .catch(error=>{if(!abort.signal.aborted)send({type:'error',error:error instanceof ReaderError?error.message:provider.safeError(error)});})
       .finally(()=>{if(!abort.signal.aborted)controller.close();});
     },
     cancel(){abort.abort();},
    });
    return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
   }
   try{return json(await provider.suggestions(selection,excludeTitles,undefined,undefined,excludeSources));}catch(error){if(error instanceof ReaderError)throw error;throw new ReaderError(502,provider.safeError(error));}
  }
  if(path[0]==='sessions'&&path.length===1){
   if(req.method==='GET')return json((await repo.list(uid)).map(view));
   if(req.method==='POST'){await requireProvider();const b=z.object({requestId:uuid,selection:selectionSchema}).parse(await body(req,32768));return json(view(await repo.create(b.requestId,uid,b.selection)),201);}
  }
  if(path[0]==='sessions'&&path[1]){
   const id=uuid.parse(path[1]);
   if(path.length===2&&req.method==='GET')return json(services.production?await services.production.snapshot(uid,id):view(await repo.get(id,uid)));
   if(path[2]==='production'&&path.length===3){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    if(req.method==='POST'){
     await requireProvider();const b=z.object({viewerId:uuid,page:z.number().int().min(0).max(readerMaxFrames-1),retry:z.boolean().default(false)}).strict().parse(await body(req));
     return json(await services.production.request(uid,id,b.viewerId,b.page,b.retry),202);
    }
    if(req.method==='DELETE'){
     const b=z.object({viewerId:uuid}).strict().parse(await body(req));await services.production.leave(uid,id,b.viewerId);return json({ok:true});
    }
   }
   if(path[2]==='source'&&path.length===3&&['GET','POST'].includes(req.method)){
    const row=await repo.get(id,uid),selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
    if(!doc.plan)throw new ReaderError(409,'故事还在编排，稍后即可查看原文。');
    const searchUrl=sourceSearchUrl(selection,doc.plan);
    if(doc.original)return json({source:doc.original,message:'',searchUrl});
    if(req.method==='GET')return json({source:null,message:row.error||'这篇旧故事还没有保存原文，可以补全后继续阅读。',searchUrl});
    if(row.state==='running')throw new ReaderError(409,'故事正在生成，请稍后再补全原文。');
    if(!services.media)throw new ReaderError(503,'原文存储暂时不可用');
    const result=await provider.generator().original(selection,doc.plan,id);
    if(result.source)await repo.saveOriginal(row,result.source);
    return json(result);
   }
   if(path[2]==='events'&&req.method==='POST'){const row=await repo.get(id,uid);const b=z.object({id:z.string().max(200),visitor:uuid,session:uuid,storyId:uuid,kind:z.enum(['start','page','complete','next','save','audio','feedback_positive','feedback_negative']),page:z.number().int().min(0).max(readerMaxFrames-1).nullable(),mode:z.enum(['manual','audio']),cohort:z.enum(['internal','pilot'])}).parse(await body(req));const current=view(row);if(b.storyId!==id||(b.page!==null&&!current.story?.pages[b.page]?.image))throw new ReaderError(400,'这幅画面还没有展开');await services.db.insert(events).values({...b,createdAt:new Date().toISOString()}).onConflictDoNothing();return json({ok:true});}
   if(path[2]==='progress'&&req.method==='POST'){const b=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),saved:z.boolean()}).parse(await body(req));return json(view(await repo.progress(id,uid,b.page,b.saved)));}
   if(path[2]==='frame-count'&&path.length===3&&req.method==='POST'){const b=z.object({count:z.number().int().min(1).max(readerMaxFrames)}).strict().parse(await body(req));return json(view(await repo.confirmFrameCount(id,uid,b.count)));}
   if(path[2]==='advance'&&req.method==='POST'){await requireProvider();const b=z.object({throughPage:z.number().int().min(0).max(readerMaxFrames-1),retry:z.boolean().default(false)}).parse(await body(req));const result=services.production&&await services.production.managed(uid,id)?await services.production.advance(uid,id,b.throughPage,b.retry):await advanceStory(repo,provider.generator(),uid,id,b.throughPage,b.retry);return json(result,result.state==='running'?202:200);}
  }
  if(path[0]==='media'&&path[1]&&path[2]&&path.length===3&&req.method==='GET'){
   const id=uuid.parse(path[1]);await repo.get(id,uid);const file=/^(0|[1-9][0-9]?)\.(png|jpg|webp|wav)$/.exec(path[2]);if(!file||Number(file[1])>=readerMaxFrames)throw new ReaderError(404,'画面不存在');const object=await services.media?.get(`reader/${id}/${path[2]}`);if(!object)throw new ReaderError(404,'这幅还没有生成');const headers=new Headers({'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});headers.set('Content-Type',object.contentType);return new Response(object.body,{headers});
  }
  if(path[0]==='media'&&path[1]&&path[2]==='artifacts'&&path.length===4&&req.method==='GET'){
   const id=uuid.parse(path[1]);await repo.get(id,uid);
   const file=/^(0|[1-9][0-9]?)-[a-f0-9]{64}\.(png|jpg|webp)$/.exec(path[3]);
   if(!file||Number(file[1])>=readerMaxFrames)throw new ReaderError(404,'画面不存在');
   const asset=await services.media?.get(`reader/${id}/artifacts/${path[3]}`);if(!asset)throw new ReaderError(404,'这幅还没有生成');
   return new Response(asset.body,{headers:{'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Type':asset.contentType}});
  }
  throw new ReaderError(404,'找不到这个故事入口');
 }catch(error){if(error instanceof ReaderError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:'请选择有效的书籍、主题与页数'},400);return json({error:'故事暂时无法打开，请稍后再试。'},500);}
}

}
