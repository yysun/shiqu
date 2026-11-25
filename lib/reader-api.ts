import {savedLandscapeImages} from '../server/landscape-print.ts';
import {createHash} from 'node:crypto';
// Route reading, recovery and generation through the single local library.
// 提示词与审校历史按引用从 prompt_records 读取全文。
import {publicationSchema} from './story-publication.ts';
import {draftInstructions} from './reader-generation-contract.ts';
import {outlineDirection,batchDirection} from './reader-storyboard.ts';
import {reviewSystemPrompt,repairSystemPrompt} from './reader-review.ts';
import {acceptanceInput,acceptanceDirection,acceptanceCriteria} from './reader-acceptance.ts';
import {getArtDirection} from './reader-styles.ts';
import {promptRecord} from './reader-prompt-records.ts';
import type {StoryPromptHistory} from './reader-prompt-records.ts';
import {storyRequirementsSchema} from './reader-requirements.ts';
import {storyReviewHistory,dagAcceptanceResults} from './reader-review-history.ts';
import {loadPromptRecords,usageRecord} from './reader-prompt-store.ts';
import {BookImageReferences} from '../server/book-image-reference.ts';
import {events} from '../db/schema.ts';
import type {Services} from './services.ts';
import {z} from 'zod';
import {ReaderRepository,latestVersionMessage} from './reader-repository.ts';
import {suggestionRequestSchema} from './reader-suggestions.ts';
import {ReaderError,readableStory,selectionSchema,displayTitleSchema,planSchema,savedStory,view} from './reader-model.ts';
import {sourceSearchUrl} from './reader-source.ts';
import {readerMaxFrames} from './reader-limits.ts';
import type {Document,SessionRow,SessionView} from './reader-model.ts';
import {artRecommendationSchema} from './reader-art-recommendation.ts';
import {checkedRevision,revisionChangesSchema} from './reader-revision.ts';
import {intakeActionSchema} from './reader-intake.ts';
import {recoveryRequestSchema,reviewOverrideSchema} from './reader-recovery.ts';
import {bookContents} from '../server/local-book-contents.ts';
import {createIntake,changeIntake} from '../server/reader-intake.ts';
import {forkRevision,previewDagRevision,revisionCoverMaxBytes,revisionSnapshot} from '../server/reader-revisions.ts';
import {openReselection,commitReselection,cancelReselection} from '../server/reader-reselection.ts';
import {replacementChoiceSchema} from './reader-reselection.ts';
import {summarizeShelfSession,type ShelfChanges} from './reader-shelf.ts';
import {readerBooks} from './reader-books.ts';
import {localSourceSchema} from './reader-local-contract.ts';
import {themeStoryId} from '../server/story-theme-matching.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const uuid=z.string().uuid();
const lifecycleMutations=new Set(['setup','reselection','recover','image-health','landscape','revisions','review-override','production-control']);
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
 async function requireProvider(){
  if(services.commandOnly)return;
  if(provider.capture){const captured=provider.capture();if(!captured)throw new ReaderError(503,'请先配置生成服务：使用本机或可信局域网地址打开「设置 → 生成服务与模型」。');provider=captured;}
  const status=await provider.status();if(!status.configured)throw new ReaderError(503,status.message||'请先配置生成服务：使用本机或可信局域网地址打开「设置 → 生成服务与模型」。');
  return status;
 }
 try{
  if(path.join('/')==='status'&&req.method==='GET')return json(await provider.status());
  const uid=services.ownerId;
  const url=new URL(req.url);if(req.method!=='GET'){const origin=req.headers.get('origin');if(origin&&origin!==url.origin)throw new ReaderError(403,'不允许跨站请求');}
  if(!services.database)throw new ReaderError(503,'书架暂时不可用');
  const repo=new ReaderRepository(services.database);
  const sessionView=(row:SessionRow)=>services.production?services.production.snapshot(uid,row.id):view(row);
  const requestRecorded=async(id:string)=>!!await repo.db.prepare(`SELECT request_id FROM reader_commands WHERE owner_id=? AND request_id=?
   UNION ALL SELECT id FROM stories WHERE user_id=? AND id=? LIMIT 1`).bind(uid,id,uid,id).first();
  if(path.join('/')==='publication-defaults'){
   if(req.method==='GET')return json({publication:await repo.publicationDefaults(uid)});
   if(req.method==='POST'){
    const parsed=z.object({publication:publicationSchema,expected:publicationSchema.nullable()}).strict().safeParse(await body(req,32768));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json({publication:await repo.savePublicationDefaults(uid,parsed.data.publication,parsed.data.expected)});
   }
  }
  if(path.join('/')==='deletions'&&req.method==='GET'){
   const rows=await repo.deletions(uid),lifecycles=services.production?.deletedLifecycles?.(uid);
   const deletions=rows.map(item=>{
    const lifecycle=lifecycles?.get(item.storyId);
    return lifecycle?{...item,lifecycle}:item;
   });
   return json(url.searchParams.get('inventory')==='1'?{deletions,currentStoryIds:await repo.currentStoryIds(uid),complete:true}:deletions);
  }
  if(path.join('/')==='library/shelf'&&['GET','POST'].includes(req.method)){
   const known=req.method==='POST'?new Map(z.array(z.tuple([uuid,z.string().max(64)])).parse(await body(req,12*1024*1024))):null;
   const sessions=services.production?await services.production.shelfSnapshots(uid):(await repo.listShelf(uid)).filter(readableStory).map(view);
   const cards=sessions.flatMap(session=>{
    const card=summarizeShelfSession(session);
    const version=createHash('sha256').update(JSON.stringify(card)).digest('hex').slice(0,24);
    const changed=known?.get(session.id)!==version;
    known?.delete(session.id);
    return changed?[{...card,version}]:[];
   });
   return json(known?{changed:cards,removed:[...known.keys()]} satisfies ShelfChanges:cards);
  }
  if(path[0]==='library'&&path.length===2&&req.method==='DELETE'){const id=z.string().min(1).max(100).parse(path[1]),removed=await repo.remove(id,uid);services.production?.referencesChanged?.();return json(removed);}
  if(path[0]==='library'&&path.length===3&&path[2]==='restore'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);return json(await repo.restore(id,uid));}
  if(path[0]==='library'&&path.length===3&&path[2]==='reference'){
   const id=z.string().min(1).max(100).parse(path[1]),references=new BookImageReferences(services.database,services.media,uid);
   if(req.method==='GET')return json(await references.get(id));
   if(req.method==='POST'){const data=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),starred:z.boolean(),token:uuid.optional()}).strict().parse(await body(req));const result=await references.set(id,data.page,data.starred,data.token);services.production?.referencesChanged?.();return json(result);}
  }
  if(path[0]==='library'&&path.length===3&&path[2]==='favorite'&&req.method==='POST'){const id=z.string().min(1).max(100).parse(path[1]);const b=z.object({saved:z.boolean()}).strict().parse(await body(req));return json(await repo.favorite(id,uid,b.saved));}
  if(path.join('/')==='books/semantic-indexes'&&req.method==='GET'){
   const books=await services.localBooks?.semanticIndexBooks()??[];
   return json({bookIds:books.map(book=>book.id),books});
  }
  if(path.join('/')==='books/embedding-settings'){
   if(!services.localBooks?.storySearch?.embeddings)throw new ReaderError(503,'本地故事卡向量库暂不可用');
   const store=services.localBooks.storySearch.embeddings;
   if(req.method==='GET'){
    const books=[];
    for(const id of store.indexedBooks()){
     const book=await services.localBooks.book(selectionSchema.parse({bookId:id,theme:'目录'}));
     if(book)books.push({book,cards:await services.localBooks.storySearch.indexableCards(book)});
    }
    const state=await store.status(books);
    return json({...state,catalog:readerBooks.map(({id,title})=>({id,title}))});
   }
   if(req.method==='POST'){
    const input=z.object({settings:z.unknown()}).strict().parse(await body(req,8192));
    try{return json({settings:store.saveSettings(input.settings)});}catch(error){throw new ReaderError(400,error instanceof Error?error.message:'Embedding 设置无效。');}
   }
  }
  if(path.join('/')==='books/embedding-test'&&req.method==='POST'){
   const store=services.localBooks?.storySearch?.embeddings;if(!store)throw new ReaderError(503,'本地故事卡向量库暂不可用');
   const input=z.object({settings:z.unknown().optional()}).strict().parse(await body(req,8192));
   try{return json(await store.test(input.settings));}catch(error){throw new ReaderError(503,error instanceof Error?error.message:'无法测试本地 Ollama。');}
  }
  if(path[0]==='books'&&path.length===3&&path[2]==='embedding-index'&&req.method==='POST'){
   if(!services.localBooks?.storySearch?.embeddings)throw new ReaderError(503,'本地故事卡向量库暂不可用');
   const store=services.localBooks.storySearch.embeddings,id=z.string().min(1).max(100).parse(path[1]);
   if(!readerBooks.some(book=>book.id===id))throw new ReaderError(400,'请选择内置书库中的一本书。');
   const book=await services.localBooks.book(selectionSchema.parse({bookId:id,theme:'目录'}));
   if(!book)throw new ReaderError(404,'本地书籍暂不可用。');
   const cards=await services.localBooks.storySearch.indexableCards(book),abort=new AbortController(),encoder=new TextEncoder();
   const cancel=()=>abort.abort();req.signal.addEventListener('abort',cancel,{once:true});
   const stream=new ReadableStream<Uint8Array>({
    start(controller){
     const send=(event:unknown)=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
     send({type:'start',total:cards.length});
     void store.build(book,cards,abort.signal,value=>send({type:'progress',...value}))
      .then(result=>send({type:'complete',...result}))
      .catch(error=>{if(!abort.signal.aborted)send({type:'error',error:error instanceof Error?error.message:'建库失败，请重试。'});})
      .finally(()=>{req.signal.removeEventListener('abort',cancel);if(!abort.signal.aborted)controller.close();});
    },
    cancel,
   });
   return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
  }
  if(path[0]==='books'&&path.length===3&&path[2]==='contents'&&req.method==='GET'){
   if(!services.localBooks)throw new ReaderError(503,'本地书库暂不可用');
   const query=z.string().max(200).parse(url.searchParams.get('q')||'');
   const view=z.enum(['chapters','stories','scope']).optional().parse(url.searchParams.get('view')??undefined);
   const limitValue=url.searchParams.get('limit'),offsetValue=url.searchParams.get('offset');
   const page=limitValue===null&&offsetValue===null?undefined:{
    limit:z.coerce.number().int().min(1).max(100).parse(limitValue??20),
    offset:z.coerce.number().int().min(0).max(1_000_000).parse(offsetValue??0),
   };
   return json(await bookContents(services.localBooks,selectionSchema.parse({bookId:path[1],theme:'目录'}),query,view,page,view==='stories'?z.string().max(40).optional().parse(url.searchParams.get('section')??undefined):undefined));
  }
  if(path[0]==='books'&&path.length===3&&path[2]==='source'&&req.method==='GET'){
   if(!services.localBooks)throw new ReaderError(503,'本地书库暂不可用');
   const book=await services.localBooks.book(selectionSchema.parse({bookId:path[1],theme:'目录'}));
   if(!book)throw new ReaderError(404,'本地书籍暂不可用');
   let source;try{source=localSourceSchema.parse(JSON.parse(url.searchParams.get('source')||''));}catch{throw new ReaderError(400,'原文出处格式无效。');}
   try{const original=services.localBooks.resolve(book,source);return json({title:original.title,text:original.text,source:original.localSource});}
   catch(error){if(error instanceof ReaderError)throw error;throw new ReaderError(400,'无法定位这段原文，请重新搜索。');}
  }
  if(path[0]==='books'&&path.length===3&&path[2]==='search'&&req.method==='GET'){
   if(!services.localBooks)throw new ReaderError(503,'本地书库暂不可用');
   const mode=z.enum(['chapter','story','theme']).parse(url.searchParams.get('mode')||''),query=z.string().trim().max(200).parse(url.searchParams.get('q')||''),sectionId=z.string().max(100).optional().parse(url.searchParams.get('section')||undefined);
   if(mode!=='chapter'&&!query)throw new ReaderError(400,'请输入要找的故事或主题。');
   const book=await services.localBooks.book(selectionSchema.parse({bookId:path[1],theme:'目录'}));if(!book)throw new ReaderError(404,'本地书籍暂不可用');
   if(sectionId&&!book.sections.some(section=>section.id===sectionId))throw new ReaderError(400,'所选章节不属于这本书。');
   const abort=new AbortController(),cancel=()=>abort.abort();req.signal.addEventListener('abort',cancel,{once:true});
   const execute=async(onProgress?:(value:unknown)=>void)=>{
    if(mode==='chapter')return {mode,results:(await bookContents(services.localBooks!,selectionSchema.parse({bookId:book.id,theme:'目录'}),query,'chapters')).entries.filter(entry=>!sectionId||entry.source?.sectionId===sectionId).map(entry=>({...entry,summary:entry.excerpt,verified:false}))};
    const cards=await services.localBooks!.storySearch?.indexableCards(book)||[];
    const normalizedQuery=query.normalize('NFKC').trim().toLowerCase();
    const exact=mode==='story'?cards.filter(card=>[card.title,...(card.aliases||[])].some(title=>title.normalize('NFKC').trim().toLowerCase()===normalizedQuery)):[];
    let hits;
    if(exact.length===1)hits=exact.map(({title,summary,source})=>({title,summary,source}));
    else hits=await services.localBooks!.storySearch?.lookupHits(book,query,abort.signal,mode==='story',50,undefined,sectionId)||[];
    const candidates=hits.flatMap(hit=>{
     if(!hit.source||sectionId&&hit.source.sectionId!==sectionId)return [];
     try{return [{...hit,source:hit.source,text:services.localBooks!.resolve(book,hit.source).text}];}catch{return []}
    }).slice(0,50);
    if(mode==='story')return {mode,results:candidates.map(({text,...hit})=>({...hit,verified:false,exact:exact.length===1}))};
    const status=await services.generation.status(),provider=services.generation;
    if(!candidates.length||!status.configured||!provider.verifyThemeStories)return {mode,verified:false,results:candidates.map(({text,...hit})=>({...hit,verified:false})),note:'候选尚未核对原文。'};
    const keyed=candidates.map(candidate=>({id:themeStoryId(candidate),title:candidate.title,text:candidate.text}));
    onProgress?.({stage:'verifying',total:keyed.length,completed:0});
    const checked=await provider.verifyThemeStories(query,keyed,{signal:abort.signal});
    const evidenceText=(text:string)=>text.replace(/[\p{P}\s]/gu,'');
    const results=checked.matches.flatMap(match=>{
     const candidate=candidates.find(item=>themeStoryId(item)===match.id);if(!candidate||match.verdict==='no'||!match.evidence.length||match.evidence.some(quote=>{const value=evidenceText(quote);return value.length<4||!evidenceText(candidate.text).includes(value);}))return [];
     return [{title:candidate.title,summary:candidate.summary,source:candidate.source,verified:true,reason:match.reason,evidence:match.evidence}];
    });
    return {mode,verified:true,checked:checked.matches.length,total:candidates.length,results,note:results.length?'已按原文核对候选。':checked.matches.length===candidates.length?'候选中没有匹配项。':'部分候选尚未完成核对。'};
   };
   if(mode!=='theme'){
    try{return json(await execute());}finally{req.signal.removeEventListener('abort',cancel);}
   }
   const encoder=new TextEncoder(),stream=new ReadableStream<Uint8Array>({start(controller){
    const send=(event:unknown)=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
    send({type:'progress',stage:'retrieving'});
    void execute(value=>send({type:'progress',stage:'verifying',progress:value})).then(result=>send({type:'result',...result})).catch(error=>{if(!abort.signal.aborted)send({type:'error',error:error instanceof Error?error.message:'主题检索暂时失败，请重试。'});}).finally(()=>{req.signal.removeEventListener('abort',cancel);if(!abort.signal.aborted)controller.close();});
   },cancel});
   return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
  }
  if(path.join('/')==='suggestions'&&req.method==='POST'){
   await requireProvider();
   const {excludeTitles,excludeSources,...selection}=suggestionRequestSchema.parse(await body(req,1048576));
   if(req.headers.get('accept')==='application/x-ndjson'){
    const abort=new AbortController(),encoder=new TextEncoder(),cancel=()=>abort.abort();
    req.signal.addEventListener('abort',cancel,{once:true});
    const stream=new ReadableStream<Uint8Array>({
     start(controller){
      const send=(event:unknown)=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
      send({type:'progress',progress:{completed:0,total:1,completedChars:0,totalChars:0,stage:'reading'}});
      void provider.suggestions(selection,excludeTitles,undefined,{signal:abort.signal,onProgress:progress=>send({type:'progress',progress})},excludeSources)
       .then(batch=>send({type:'result',batch}))
       .catch(error=>{if(!abort.signal.aborted)send({type:'error',error:error instanceof ReaderError?error.message:provider.safeError(error)});})
       .finally(()=>{req.signal.removeEventListener('abort',cancel);if(!abort.signal.aborted)controller.close();});
     },
     cancel,
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
   if(req.method==='GET'&&url.searchParams.get('view')==='export'){
    const rows=await repo.listShelf(uid);
    return json(rows.flatMap(row=>{
     try{
      const selection=JSON.parse(row.selection) as {displayTitle?:string;storyTitle?:string};
      const {plan}=JSON.parse(row.document) as Document;
      return [{id:row.id,title:selection.displayTitle||plan?.title,sourceTitle:selection.storyTitle}];
     }catch{return [];}
    }));
   }
   // One unreadable saved story must not take the whole shelf down with it.
   if(req.method==='GET'){
    const sessions=services.production?await services.production.shelfSnapshots(uid,true):(await repo.list(uid)).filter(readableStory).map(view);
    return json(sessions.map(shelfView));
   }
   if(req.method==='POST'){const b=z.object({requestId:uuid,selection:selectionSchema.omit({displayTitle:true}),intake:z.boolean().optional()}).parse(await body(req,32768));if((b.selection.discoverySources||b.selection.discovery?.mode==='title')&&b.intake!==true)throw new ReaderError(400,'章节或标题提取必须通过选题流程创建。');if(!await requestRecorded(b.requestId))await requireProvider();return json(await sessionView(b.intake?await createIntake(repo,b.requestId,uid,b.selection,services.localBooks):await repo.create(b.requestId,uid,b.selection)),201);}
  }
  if(path[0]==='sessions'&&path[1]){
   const id=uuid.parse(path[1]);
   if(path[2]==='export'&&path.length===3&&req.method==='GET'){
    const row=await repo.current(id,uid),doc=JSON.parse(row.document) as Document;
    const story=savedStory(row,selectionSchema.parse(JSON.parse(row.selection)),doc);
    const images=url.searchParams.get('layout')==='landscape'?await savedLandscapeImages(repo.db,services.media,row,doc):undefined;
    return json({id:row.id,story,images});
   }
   if(path[2]==='review-history'&&path.length===3&&req.method==='GET'){const row=await repo.get(id,uid);return json(storyReviewHistory(row,await loadPromptRecords(repo.db,(JSON.parse(row.document) as Document).usage)));}
   if(path[2]==='prompts'&&path.length===3&&req.method==='GET'){
    const row=await repo.get(id,uid),doc=JSON.parse(row.document) as Document,selection=selectionSchema.parse(JSON.parse(row.selection));
    const preferences={productionPrompt:selection.productionPrompt,...acceptanceInput(selection),artDirection:getArtDirection(selection),narrativeDetail:selection.narrativeDetail||'balanced',exactPageCount:selection.length};
    // 提示词全文按引用读取；引用的记录缺失时与未保存记录一样列为缺失。
    const stored=await loadPromptRecords(repo.db,doc.usage);
    const history:StoryPromptHistory={
     productionPrompt:selection.productionPrompt,acceptancePrompt:selection.acceptancePrompt||'',
     records:(doc.usage||[]).flatMap((item,index)=>{const record=usageRecord(item,stored);return record?[{step:item.step,model:item.model,originId:item.originId||id,index,record}]:[];}),
     missingRecords:(doc.usage||[]).flatMap((item,index)=>usageRecord(item,stored)?[]:[{step:item.step,model:item.model,originId:item.originId||id,index}]),
    };
    const suggestions=storyRequirementsSchema.safeParse(doc.setupRequirements?.suggestions);
    return json({...history,...(suggestions.success?{suggestedRequirements:suggestions.data}:{}),criteria:acceptanceCriteria(selection.acceptancePrompt),results:doc.dag?dagAcceptanceResults(doc.dag):doc.visualReview?.reports.at(-1)?.acceptanceResults||[],overridden:doc.dag?Object.values(doc.dag.products).some(product=>product.overridden):!!doc.visualReview?.overridden,previews:{production:promptRecord(draftInstructions(!!doc.original?.localSource)+'\n\n## 提纲阶段\n'+outlineDirection+'\n\n## 分批细化阶段\n'+batchDirection,preferences),acceptance:promptRecord(reviewSystemPrompt+'\n\n'+acceptanceDirection+'\n\n## 定向修订\n'+repairSystemPrompt,preferences)}});
   }
   if(path[2]==='publication'&&path.length===3&&req.method==='POST'){
    const parsed=z.object({publication:publicationSchema,expected:publicationSchema.nullable()}).strict().safeParse(await body(req,32768));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json(await sessionView(await repo.savePublication(id,uid,parsed.data.publication,parsed.data.expected)));
   }
   if(path[2]==='title'&&path.length===3&&req.method==='POST'){
    const parsed=z.object({title:displayTitleSchema}).strict().safeParse(await body(req));
    if(!parsed.success)throw new ReaderError(400,parsed.error.issues[0].message);
    return json(await sessionView(await repo.rename(id,uid,parsed.data.title)));
   }
   if(path.length===2&&req.method==='GET')return json(services.production?await services.production.snapshot(uid,id):view(await repo.get(id,uid)));
   if(path[2]==='current'&&path.length===3&&req.method==='GET'){
    const row=await repo.current(id,uid);return json(services.production?await services.production.snapshot(uid,row.id):view(row));
   }
   if(path[2]==='reselection'&&path.length===3&&req.method==='POST'){
    const b=z.object({requestId:uuid}).strict().parse(await body(req));if(!await requestRecorded(b.requestId))await requireProvider();
    return json(await sessionView(await openReselection(repo,id,uid,b.requestId,services.localBooks)),201);
   }
   if(path[2]==='reselection'&&path[3]&&path.length===4){
    const draftId=uuid.parse(path[3]);
    if(req.method==='POST'){
     const command=replacementChoiceSchema.parse(await body(req,32768));if(!await requestRecorded(command.requestId))await requireProvider();
     const row=await commitReselection(repo,id,draftId,uid,command);services.production?.wake();
     return json(services.production?await services.production.snapshot(uid,row.id):view(row));
    }
    if(req.method==='DELETE'){
     const row=await cancelReselection(repo,id,draftId,uid);return json(await sessionView(row));
    }
   }
   if(path[2]==='recover'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const command=recoveryRequestSchema.parse(await body(req));
    return json(await services.production.recover(uid,id,command,requireProvider),202);
   }
   if(path[2]==='image-health'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const b=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),image:z.string().min(1).max(1024)}).strict().parse(await body(req));
    return json(await services.production.checkImage(uid,id,b.page,b.image));
   }
   if(path[2]==='setup'&&path.length===3&&req.method==='POST'){
    const action=intakeActionSchema.parse(await body(req,32768));if(!await requestRecorded(action.requestId))await requireProvider();
    return json(await sessionView(await changeIntake(repo,id,uid,action,services.localBooks)));
   }
   if(path[2]==='landscape'&&path[3]==='sets'&&path.length===4&&req.method==='GET'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    return json(await services.production.landscapePrintSets(uid,id));
   }
   if(path[2]==='landscape'&&path.length===3&&['GET','POST'].includes(req.method)){
    const production=services.production;
    if(!production)throw new ReaderError(503,'制作队列暂不可用');
    if(req.method==='GET')return json(await production.landscapeStatus(uid,id));
    if(services.commandOnly)throw new ReaderError(409,'请在拾趣阅读器中启动横版绘图。');
    const token=z.string().regex(/^[a-f0-9]{64}$/);
    const command=z.union([z.object({startToken:token}).strict(),z.object({retryToken:token}).strict(),z.object({modelToken:token}).strict(),z.object({control:z.enum(['pause','resume']),printId:uuid.optional()}).strict()]).parse(await body(req));
    return json(await production.startLandscape(uid,id,command,async()=>{
     if(!(await requireProvider())?.models.image)throw new ReaderError(503,'请先配置支持绘图的图片服务。');
    }),202);
   }
   if(path[2]==='storyboard-summary'&&path.length===3&&req.method==='POST'){
    if(services.commandOnly)throw new ReaderError(409,'请在拾趣阅读器中生成分镜梗概。');
    const {token,plan,removedFrames}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),plan:planSchema.optional(),removedFrames:revisionChangesSchema.shape.removedFrames}).strict().parse(await body(req,262144));
    const snapshot=await revisionSnapshot(repo,id,uid);
    if(snapshot.token!==token)throw new ReaderError(409,'分镜已更新，请重新载入后再生成梗概。');
    if(!snapshot.plan)throw new ReaderError(409,'请先保存完整分镜。');
    const storyboard=removedFrames||plan&&JSON.stringify(plan)!==JSON.stringify(snapshot.plan)?checkedRevision(snapshot,{plan,removedFrames}).plan!:snapshot.plan;
    await requireProvider();
    const summarize=provider.generator().summarizeStoryboard;
    if(!summarize)throw new ReaderError(503,'当前文字生成服务暂不支持生成分镜梗概。');
    const result=await summarize(storyboard.pages).catch(error=>{throw new ReaderError(502,provider.safeError(error));});
    if((await revisionSnapshot(repo,id,uid)).token!==token)throw new ReaderError(409,'分镜已更新，请重新载入后再生成梗概。');
    return json({summary:result.value});
   }
   if(path[2]==='revisions'&&path[3]==='preview'&&path.length===4&&req.method==='POST'){
    // 保存前的预估由引擎推导，与保存使用同一套规则，不写入也不调用模型。
    const b=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),changes:revisionChangesSchema}).strict().parse(await body(req,262144));
    return json(await previewDagRevision(repo,await repo.get(id,uid),b.token,b.changes));
   }
   if(path[2]==='revisions'&&path.length===3){
    if(req.method==='GET')return json(await revisionSnapshot(repo,id,uid));
    if(req.method==='POST'){
     const production=services.production;
     if(!production)throw new ReaderError(503,'制作队列暂不可用');
     let metadata:unknown,cover:Uint8Array|undefined;
     if(req.headers.get('content-type')?.startsWith('multipart/form-data;')){
      const form=await req.formData().catch(()=>{throw new ReaderError(400,'修订文件格式不正确。');});
      const fields=form.getAll('revision'),files=form.getAll('cover');
      if(fields.length!==1||typeof fields[0]!=='string'||files.length!==1||typeof files[0]==='string'||!files[0].size||files[0].size>revisionCoverMaxBytes)throw new ReaderError(400,'请提交修订设置和一张不超过 12 MiB 的首幅图。');
      metadata=await body(new Request(req.url,{method:'POST',body:fields[0]}),262144);
      cover=new Uint8Array(await files[0].arrayBuffer());
     }else metadata=await body(req,262144);
     const b=z.object({requestId:uuid,token:z.string().regex(/^[a-f0-9]{64}$/),changes:revisionChangesSchema,paused:z.boolean().default(false),startRedraw:z.literal(true).optional()}).strict().parse(metadata);
     if(!await requestRecorded(b.requestId))await requireProvider();
     if(b.startRedraw&&services.commandOnly)throw new ReaderError(409,'请在拾趣阅读器中直接重绘，或使用命令行的继续与运行命令。');
     const row=await forkRevision(repo,services.media,uid,id,b.requestId,b.token,b.changes,b.paused,cover,b.startRedraw);
     if(!b.paused)production.wake();
     return json(await production.snapshot(uid,row.id),201);
    }
   }
   if(path[2]==='review-override'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const command=reviewOverrideSchema.parse(await body(req));
    if(command.ending===undefined&&!await requestRecorded(command.requestId))await requireProvider();
    return json(await services.production.overrideReview(uid,id,command));
   }
   if(path[2]==='production-control'&&path.length===3&&req.method==='POST'){
    if(!services.production)throw new ReaderError(503,'制作队列暂不可用');
    const b=z.object({requestId:uuid,action:z.enum(['pause','stop','resume','continue','apply-model','reprepare'])}).strict().parse(await body(req));
    if(['resume','apply-model','continue','reprepare'].includes(b.action)&&!await requestRecorded(b.requestId))await requireProvider();
    return json(await services.production.control(uid,id,b.action,b.requestId));
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
   if(path[2]==='progress'&&req.method==='POST'){const b=z.object({page:z.number().int().min(0).max(readerMaxFrames-1),saved:z.boolean()}).parse(await body(req));return json(await sessionView(await repo.progress(id,uid,b.page,b.saved)));}
   if(path[2]==='advance'&&req.method==='POST'){const b=z.object({throughPage:z.number().int().min(0).max(readerMaxFrames-1),retry:z.boolean().default(false)}).parse(await body(req));if(b.retry)throw new ReaderError(400,'重试必须提交当前故障实例与操作编号，请使用恢复入口。');if(!services.production)throw new ReaderError(503,'制作队列暂不可用');const result=await services.production.snapshot(uid,id);return json(result,result.state==='running'?202:200);}
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
 }catch(error){
  const conflict=error instanceof Error&&error.message.includes('reader_request_id_conflict');
  if(conflict||error instanceof ReaderError){
   const status=conflict?409:(error as ReaderError).status;
   const message=conflict?'这个操作编号已用于其他内容，请重新操作。':(error as ReaderError).message;
   if(status===409&&req.method!=='GET'&&path[0]==='sessions'&&lifecycleMutations.has(path[2])&&services.database){
    // 只在冲突时回读有权打开的当前版，帮助客户端刷新编辑依据和动作。
    const ownerId=services.ownerId,repo=new ReaderRepository(services.database);
    const session=await (async()=>{
     const origin=await repo.get(path[1],ownerId);
     if((JSON.parse(origin.document) as Document).reselection){
      return services.production?await services.production.snapshot(ownerId,origin.id):view(origin);
     }
     for(let attempt=0;attempt<2;attempt++){
      const current=await repo.current(origin.id,ownerId);
      const snapshot=services.production?await services.production.snapshot(ownerId,current.id):view(current);
      if(!snapshot.superseded)return snapshot;
     }
    })().catch(()=>undefined);
    if(session)return json({error:message,session},status);
   }
   return json({error:message},status);
  }
  if(error instanceof z.ZodError)return json({error:'请选择有效的书籍、主题与页数'},400);
  return json({error:'故事暂时无法打开，请稍后再试。'},500);
 }
}

}
