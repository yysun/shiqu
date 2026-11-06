// Route reading, recovery and generation through the single local library.
import {productionStageDurations} from './production-timing.ts';
import {publicationSchema} from './story-publication.ts';
import {draftInstructions} from './reader-generation-contract.ts';
import {outlineDirection,batchDirection} from './reader-storyboard.ts';
import {reviewSystemPrompt,repairSystemPrompt} from './reader-review.ts';
import {acceptanceInput,acceptanceDirection,acceptanceCriteria} from './reader-acceptance.ts';
import {getArtStyle} from './reader-styles.ts';
import {promptRecord} from './reader-prompt-records.ts';
import type {StoryPromptHistory} from './reader-prompt-records.ts';
import {storyReviewHistory} from './reader-review-history.ts';
import {BookImageReferences,withBookReference} from '../server/book-image-reference.ts';
import {events} from '../db/schema.ts';
import type {Services} from './services.ts';
import {z} from 'zod';
import {ReaderRepository,latestVersionMessage} from './reader-repository.ts';
import {advanceStory} from './reader-engine.ts';
import {suggestionRequestSchema} from './reader-suggestions.ts';
import {ReaderError,readableStory,selectionSchema,displayTitleSchema,view} from './reader-model.ts';
import {sourceSearchUrl} from './reader-source.ts';
import {readerMaxFrames} from './reader-limits.ts';
import type {Document,SessionView} from './reader-model.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';
import {revisionChangesSchema} from './reader-revision.ts';
import {intakeActionSchema} from './reader-intake.ts';
import {recoveryRequestSchema} from './reader-recovery.ts';
import {bookContents} from '../server/local-book-contents.ts';
import {createIntake,changeIntake} from '../server/reader-intake.ts';
import {forkRevision,revisionSnapshot} from '../server/reader-revisions.ts';
import {openReselection,commitReselection,cancelReselection} from '../server/reader-reselection.ts';
import {replacementChoiceSchema} from './reader-reselection.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=z.string().uuid();
export function shelfView(session:SessionView):SessionView{
 if(!session.story)return session;
 const story={...session.story};delete story.original;story.sourceText='';
 return {...session,story};
}
async function body(req:Request,maxLength=4096){const s=await req.text();if(s.length>maxLength)throw new ReaderError(413,'请求太长了');try{return JSON.parse(s);}catch{throw new ReaderError(400,'请求格式不正确');}}
export function createReaderApi(services:Services){
return async function readerApi(req:Request,path:string[]):Promise<Response>{
 let provider=services.generation;
 // 只在需要提供方的请求边界取快照，普通书架读取不依赖设置库是否可用。
 async function requireProvider(){if(services.commandOnly)return;provider=provider.capture?.()||provider;const status=await provider.status();if(!status.configured)throw new ReaderError(503,status.message||'请先配置生成服务：使用本机或可信局域网地址打开 我的 → 生成服务与模型。');}
 try{
  if(path.join('/')==='status'&&req.method==='GET')return json(await (provider.capture?.()||provider).status());
  const uid=services.ownerId;
  const url=new URL(req.url);if(req.method!=='GET'){const origin=req.headers.get('origin');if(origin&&origin!==url.origin)throw new ReaderError(403,'不允许跨站请求');}
  if(!services.database)throw new ReaderError(503,'书架暂时不可用');
  const repo=new ReaderRepository(services.database);
  if(path.join('/')==='publication-defaults'){
   if(req.method==='GET')return json({publication:await repo.publicationDefaults(uid)});
   if(req.method==='POST'){
    const parsed=z.object({publication:publicationSchema,expected:publicationSchema.nullable()}).strict().safeParse(await body(req,32768));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json({publication:await repo.savePublicationDefaults(uid,parsed.data.publication,parsed.data.expected)});
   }
  }
  if(path.join('/')==='deletions'&&req.method==='GET')return json(new URL(req.url).searchParams.get('inventory')==='1'?{deletions:await repo.deletions(uid),currentStoryIds:await repo.currentStoryIds(uid),complete:true}:await repo.deletions(uid));
  if(path[0]==='library'&&path.length===2&&req.method==='DELETE'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.remove(id,uid));}
  if(path[0]==='library'&&path.length===3&&path[2]==='restore'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.restore(id,uid));}
  if(path[0]==='library'&&path.length===3&&path[2]==='reference'){
   const id=z.string().min(1).max(100).parse(path[1]),references=new BookImageReferences(services.database,services.media,uid);
   if(req.method==='GET')return json(await references.get(id));
   if(req.method==='POST'){const data=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),starred:z.boolean(),token:uuid.optional()}).strict().parse(await body(req));return json(await references.set(id,data.page,data.starred,data.token));}
  }
  if(path[0]==='library'&&path.length===3&&path[2]==='favorite'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);const b=z.object({saved:z.boolean()}).strict().parse(await body(req));return json(await repo.favorite(id,uid,b.saved));}
  if(path[0]==='books'&&path.length===3&&path[2]==='contents'&&req.method==='GET'){
   if(!services.localBooks)throw new ReaderError(503,'本地书库暂不可用');
   const query=z.string().max(200).parse(url.searchParams.get('q')||'');
   return json(await bookContents(services.localBooks,selectionSchema.parse({bookId:path[1],theme:'目录'}),query));
  }
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
  if(path.join('/')==='art-recommendation'&&req.method==='POST'){
   await requireProvider();
   const selection=selectionSchema.parse(await body(req,32768));
   if(!selection.source||!selection.storyTitle)throw new ReaderError(400,'请先选择已核对出处的故事。');
   if(!provider.recommendArt)throw new ReaderError(503,'画风推荐暂不可用，可以手动选择画风。');
   try{return json(artRecommendationSchema.parse(await provider.recommendArt(selection)));}catch(error){if(error instanceof ReaderError)throw error;throw new ReaderError(502,provider.safeError(error));}
  }
  if(path[0]==='sessions'&&path.length===1){
   // One unreadable saved story must not take the whole shelf down with it.
   if(req.method==='GET'){
    const rows=(await repo.list(uid)).filter(readableStory),completed=rows.filter(row=>row.state==='completed').map(row=>row.id);
    // Load completed timing in one owner-scoped read; shelf visits never inspect media or start work.
    const timings=completed.length?(await repo.db.prepare("SELECT session_id,kind,payload FROM production_jobs WHERE owner_id=? AND session_id IN (SELECT value FROM json_each(?)) AND json_type(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.timings')='array'").bind(uid,JSON.stringify(completed)).all<{session_id:string;kind:string;payload:string}>()).results:[];
    const bySession=new Map<string,typeof timings>();
    for(const timing of timings){const group=bySession.get(timing.session_id)||[];group.push(timing);bySession.set(timing.session_id,group);}
    return json(await Promise.all(rows.map(async row=>{
     const session=services.production&&row.state!=='completed'?await services.production.snapshot(uid,row.id):view(row);
     if(row.state==='completed')session.generationProgress={...session.generationProgress!,stageDurations:productionStageDurations(bySession.get(row.id)||[],session.selection)};
     return shelfView(session);
    })));
   }
   if(req.method==='POST'){await requireProvider();const b=z.object({requestId:uuid,selection:selectionSchema.omit({displayTitle:true}),intake:z.boolean().optional()}).parse(await body(req,32768));if((b.selection.discoverySources||b.selection.discovery?.mode==='title')&&b.intake!==true)throw new ReaderError(400,'章节或标题提取必须通过选题流程创建。');return json(view(b.intake?await createIntake(repo,b.requestId,uid,b.selection,services.localBooks):await repo.create(b.requestId,uid,b.selection)),201);}
  }
  if(path[0]==='sessions'&&path[1]){
   const id=uuid.parse(path[1]);
   if(path[2]==='review-history'&&path.length===3&&req.method==='GET')return json(storyReviewHistory(await repo.get(id,uid)));
   if(path[2]==='prompts'&&path.length===3&&req.method==='GET'){
    const row=await repo.get(id,uid),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
    const preferences={productionPrompt:selection.productionPrompt,...acceptanceInput(selection),artDirection:getArtStyle(selection.artStyle).prompt,narrativeDetail:selection.narrativeDetail||'balanced',exactPageCount:selection.length};
    const history:StoryPromptHistory={
     productionPrompt:selection.productionPrompt,acceptancePrompt:selection.acceptancePrompt||'',
     records:(doc.usage||[]).flatMap((item,index)=>item.promptRecord?[{step:item.step,model:item.model,originId:item.originId||id,index,record:item.promptRecord}]:[]),
     missingRecords:(doc.usage||[]).flatMap((item,index)=>item.promptRecord?[]:[{step:item.step,model:item.model,originId:item.originId||id,index}]),
    };
    return json({...history,criteria:acceptanceCriteria(selection.acceptancePrompt),results:doc.visualReview?.reports.at(-1)?.acceptanceResults||[],overridden:!!doc.visualReview?.overridden,previews:{production:promptRecord(draftInstructions(!!doc.original?.localSource)+'\n\n## 提纲阶段\n'+outlineDirection+'\n\n## 分批细化阶段\n'+batchDirection,preferences),acceptance:promptRecord(reviewSystemPrompt+'\n\n'+acceptanceDirection+'\n\n## 定向修订\n'+repairSystemPrompt,preferences)}});
   }
   if(path[2]==='publication'&&path.length===3&&req.method==='POST'){
    const parsed=z.object({publication:publicationSchema,expected:publicationSchema.nullable()}).strict().safeParse(await body(req,32768));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json(view(await repo.savePublication(id,uid,parsed.data.publication,parsed.data.expected)));
   }
   if(path[2]==='title'&&path.length===3&&req.method==='POST'){
    const parsed=z.object({title:displayTitleSchema}).strict().safeParse(await body(req));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json(view(await repo.rename(id,uid,parsed.data.title)));
   }
   if(path.length===2&&req.method==='GET')return json(services.production?await services.production.snapshot(uid,id):view(await repo.get(id,uid)));
   if(path[2]==='current'&&path.length===3&&req.method==='GET'){
    const row=await repo.current(id,uid);return json(services.production?await services.production.snapshot(uid,row.id):view(row));
   }
   if(path[2]==='reselection'&&path.length===3&&req.method==='POST'){
    await requireProvider();const b=z.object({requestId:uuid}).strict().parse(await body(req));
    return json(view(await openReselection(repo,id,uid,b.requestId,services.localBooks)),201);
   }
   if(path[2]==='reselection'&&path[3]&&path.length===4){
    const draftId=uuid.parse(path[3]);
    if(req.method==='POST'){
     await requireProvider();const command=replacementChoiceSchema.parse(await body(req,32768));
     const row=await commitReselection(repo,id,draftId,uid,command);services.production?.wake();
     return json(services.production?await services.production.snapshot(uid,row.id):view(row));
    }
    if(req.method==='DELETE'){
     const row=await cancelReselection(repo,id,draftId,uid);return json(view(row));
    }
   }
   if(path[2]==='recover'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const command=recoveryRequestSchema.parse(await body(req));await requireProvider();
    return json(await services.production.recover(uid,id,command),202);
   }
   if(path[2]==='image-health'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const b=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),image:z.string().min(1).max(1024)}).strict().parse(await body(req));
    return json(await services.production.checkImage(uid,id,b.page,b.image));
   }
   if(path[2]==='setup'&&path.length===3&&req.method==='POST'){await requireProvider();const action=intakeActionSchema.parse(await body(req,32768));await changeIntake(repo,id,uid,action,services.localBooks);return json(services.production?await services.production.snapshot(uid,id):view(await repo.get(id,uid)));}
   if(path[2]==='revisions'&&path.length===3){
    if(req.method==='GET')return json(await revisionSnapshot(repo,id,uid));
    if(req.method==='POST'){
     await requireProvider();
     if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
     const b=z.object({requestId:uuid,token:z.string().regex(/^[a-f0-9]{64}$/),changes:revisionChangesSchema,paused:z.boolean().default(false)}).strict().parse(await body(req,262144));
     const row=await forkRevision(repo,services.media,uid,id,b.requestId,b.token,b.changes,b.paused);
     const doc=JSON.parse(row.document) as Document;
     if(!b.paused&&!doc.revision?.handoff)services.production.wake();
     return json(doc.revision?.handoff?await services.production.control(uid,row.id,b.paused?'pause':'resume',true):await services.production.snapshot(uid,row.id),201);
    }
   }
   if(path[2]==='review-override'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const command=recoveryRequestSchema.parse(await body(req));
    await requireProvider();
    return json(await services.production.overrideReview(uid,id,command));
   }
   if(path[2]==='production-control'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const b=z.object({requestId:uuid,action:z.enum(['background','reader','pause','stop','resume'])}).strict().parse(await body(req));
    if(b.action==='background'||b.action==='resume')await requireProvider();
    return json(await services.production.control(uid,id,b.action,false,b.requestId));
   }
   if(path[2]==='production'&&path.length===3){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    if(req.method==='POST'){
     await requireProvider();const b=z.object({viewerId:uuid,page:z.number().int().min(0).max(readerMaxFrames-1),retry:z.boolean().default(false)}).strict().parse(await body(req));
     if(b.retry)throw new ReaderError(400,'重试必须提交当前故障实例与操作编号，请使用恢复入口。');
     return json(await services.production.request(uid,id,b.viewerId,b.page,b.retry),202);
    }
    if(req.method==='DELETE'){
     const b=z.object({viewerId:uuid}).strict().parse(await body(req));await services.production.leave(uid,id,b.viewerId);return json({ok:true});
    }
   }
   if(path[2]==='source'&&path.length===3&&['GET','POST'].includes(req.method)){
    const row=await repo.get(id,uid),selection=selectionSchema.parse(JSON.parse(row.selection)),doc=JSON.parse(row.document) as Document;
    if(doc.original)return json({source:doc.original,message:'',searchUrl:doc.original.url});
    if(!doc.plan)throw new ReaderError(409,'原文尚未保存，请稍后再查看。');
    const searchUrl=sourceSearchUrl(selection,doc.plan);
    if(req.method==='GET')return json({source:null,message:row.error||'这篇旧故事还没有保存原文，可以补全后继续阅读。',searchUrl});
    if(await repo.superseded(id,uid))throw new ReaderError(409,latestVersionMessage);
    if(row.state==='running')throw new ReaderError(409,'故事正在生成，请稍后再补全原文。');
    if(!services.media)throw new ReaderError(503,'原文存储暂时不可用');
    const result=await provider.generator().original(selection,doc.plan,id);
    if(result.source)await repo.saveOriginal(row,result.source);
    return json(result);
   }
   if(path[2]==='events'&&req.method==='POST'){const row=await repo.get(id,uid);const b=z.object({id:z.string().max(200),visitor:uuid,session:uuid,storyId:uuid,kind:z.enum(['start','page','complete','next','save','audio','feedback_positive','feedback_negative']),page:z.number().int().min(0).max(readerMaxFrames-1).nullable(),mode:z.enum(['manual','audio']),cohort:z.enum(['internal','pilot'])}).parse(await body(req));const current=view(row);if(b.storyId!==id||(b.page!==null&&!current.story?.pages[b.page]?.image))throw new ReaderError(400,'这幅画面还没有展开');await services.db.insert(events).values({...b,createdAt:new Date().toISOString()}).onConflictDoNothing();return json({ok:true});}
   if(path[2]==='progress'&&req.method==='POST'){const b=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),saved:z.boolean()}).parse(await body(req));return json(view(await repo.progress(id,uid,b.page,b.saved)));}
   if(path[2]==='frame-count'&&path.length===3&&req.method==='POST'){const b=z.object({count:z.union([z.number().int().min(1).max(readerMaxFrames),z.literal('auto')])}).strict().parse(await body(req));return json(view(await repo.confirmFrameCount(id,uid,b.count)));}
   if(path[2]==='advance'&&req.method==='POST'){await requireProvider();const b=z.object({throughPage:z.number().int().min(0).max(readerMaxFrames-1),retry:z.boolean().default(false)}).parse(await body(req));if(b.retry)throw new ReaderError(400,'重试必须提交当前故障实例与操作编号，请使用恢复入口。');const result=services.production?await services.production.advance(uid,id,b.throughPage,false):await advanceStory(repo,withBookReference(provider.generator(),new BookImageReferences(services.database,services.media,uid)),uid,id,b.throughPage,false);return json(result,result.state==='running'?202:200);}
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
 }catch(error){if(error instanceof Error&&error.message.includes('reader_request_id_conflict'))return json({error:'这个操作编号已用于其他内容，请重新操作。'},409);if(error instanceof ReaderError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:'请选择有效的书籍、主题与页数'},400);return json({error:'故事暂时无法打开，请稍后再试。'},500);}
}

}
