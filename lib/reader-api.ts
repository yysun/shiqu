// Route authenticated reading, recovery, and generation operations within each reader's library.
import {getDb} from '@/db';
import {events} from '@/db/schema';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ReaderRepository} from './reader-repository.ts';
import {advanceStory} from './reader-engine.ts';
import {suggestionRequestSchema} from './reader-suggestions.ts';
import {ReaderError,selectionSchema,view} from './reader-model.ts';
import {configuredModels,makeGenerator,suggestStories,safeGeminiError} from './reader-gemini.ts';
import {sourceSearchUrl} from './reader-source.ts';
import {saveStoryOriginal} from './reader-source-storage.ts';
import type {Document} from './reader-model.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=z.string().uuid();
async function body(req:Request,maxLength=4096){const s=await req.text();if(s.length>maxLength)throw new ReaderError(413,'请求太长了');try{return JSON.parse(s);}catch{throw new ReaderError(400,'请求格式不正确');}}
export async function readerApi(req:Request,path:string[]):Promise<Response>{
 try{
  const vars=env as unknown as Record<string,string>,key=vars.GEMINI_API_KEY,models=configuredModels(vars);
  const ready=!!(key&&env.DB&&env.BUCKET);
  if(path.join('/')==='status'&&req.method==='GET')return json({configured:ready,provider:'gemini',models,voiceEnabled:false});
  const uid=req.headers.get('oai-authenticated-user-id')||(import.meta.env.DEV?'local-preview':'');if(!uid)throw new ReaderError(401,'请先登录，再开启属于你的故事。');
  const url=new URL(req.url);if(req.method!=='GET'){const origin=req.headers.get('origin');if(origin&&origin!==url.origin)throw new ReaderError(403,'不允许跨站请求');}
  if(!env.DB)throw new ReaderError(503,'书架暂时不可用');
  const repo=new ReaderRepository(env.DB);
  if(path.join('/')==='deletions'&&req.method==='GET')return json(await repo.deletions(uid));
  if(path[0]==='library'&&path.length===2&&req.method==='DELETE'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.remove(id,uid));}
  if(path[0]==='library'&&path.length===3&&path[2]==='restore'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.restore(id,uid));}
  if(path.join('/')==='suggestions'&&req.method==='POST'){
   if(!ready)throw new ReaderError(503,'AI 选题服务还未接通。你的输入已保留，接通后即可列出故事标题。');
   const {excludeTitles,...selection}=suggestionRequestSchema.parse(await body(req,28000));
   try{return json(await suggestStories(key,selection,models,fetch,excludeTitles));}catch(error){throw new ReaderError(502,safeGeminiError(error));}
  }
  if(path[0]==='sessions'&&path.length===1){
   if(req.method==='GET')return json((await repo.list(uid)).map(view));
   if(req.method==='POST'){if(!ready)throw new ReaderError(503,'即时生成服务还未接通，你的选择已保留。');const b=z.object({requestId:uuid,selection:selectionSchema}).parse(await body(req));return json(view(await repo.create(b.requestId,uid,b.selection)),201);}
  }
  if(path[0]==='sessions'&&path[1]){
   const id=uuid.parse(path[1]);
   if(path.length===2&&req.method==='GET')return json(view(await repo.get(id,uid)));
   if(path[2]==='source'&&path.length===3&&['GET','POST'].includes(req.method)){
    const row=await repo.get(id,uid),selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
    if(!doc.plan)throw new ReaderError(409,'故事还在编排，稍后即可查看原文。');
    const searchUrl=sourceSearchUrl(selection,doc.plan);
    if(doc.original)return json({source:doc.original,message:'',searchUrl});
    if(req.method==='GET')return json({source:null,message:row.error||'这篇旧故事还没有保存原文，可以补全后继续阅读。',searchUrl});
    if(row.state==='running')throw new ReaderError(409,'故事正在生成，请稍后再补全原文。');
    if(!env.BUCKET)throw new ReaderError(503,'原文存储暂时不可用');
    const result=await saveStoryOriginal(env.BUCKET,selection,doc.plan,id);
    if(result.source)await repo.saveOriginal(row,result.source);
    return json(result);
   }
   if(path[2]==='events'&&req.method==='POST'){const row=await repo.get(id,uid);const b=z.object({id:z.string().max(200),visitor:uuid,session:uuid,storyId:uuid,kind:z.enum(['start','page','complete','next','save','audio','feedback_positive','feedback_negative']),page:z.number().int().min(0).max(11).nullable(),mode:z.enum(['manual','audio']),cohort:z.enum(['internal','pilot'])}).parse(await body(req));const current=view(row);if(b.storyId!==id||(b.page!==null&&!current.story?.pages[b.page]?.image))throw new ReaderError(400,'这幅画面还没有展开');await getDb().insert(events).values({...b,createdAt:new Date().toISOString()}).onConflictDoNothing();return json({ok:true});}
   if(path[2]==='progress'&&req.method==='POST'){const b=z.object({page:z.number().int().min(0).max(11),saved:z.boolean()}).parse(await body(req));return json(view(await repo.progress(id,uid,b.page,b.saved)));}
   if(path[2]==='advance'&&req.method==='POST'){if(!ready)throw new ReaderError(503,'即时生成服务暂时不可用');const b=z.object({throughPage:z.number().int().min(0).max(11),retry:z.boolean().default(false)}).parse(await body(req));const result=await advanceStory(repo,makeGenerator(key,env.BUCKET!,models),uid,id,b.throughPage,b.retry);return json(result,result.state==='running'?202:200);}
  }
  if(path[0]==='media'&&path[1]&&path[2]&&path.length===3&&req.method==='GET'){
   const id=uuid.parse(path[1]);await repo.get(id,uid);if(!/^(?:[0-9]|1[01])\.(png|jpg|webp|wav)$/.test(path[2]))throw new ReaderError(404,'画面不存在');const object=await env.BUCKET?.get(`reader/${id}/${path[2]}`);if(!object)throw new ReaderError(404,'这幅还没有生成');const headers=new Headers({'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});object.writeHttpMetadata(headers);return new Response(object.body,{headers});
  }
  throw new ReaderError(404,'找不到这个故事入口');
 }catch(error){if(error instanceof ReaderError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:'请选择有效的书籍、主题与页数'},400);return json({error:'故事暂时无法打开，请稍后再试。'},500);}
}
