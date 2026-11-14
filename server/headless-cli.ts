// Agent-facing local commands use production Requests and a dormant/scoped coordinator, never HTTP.
// stdout is a versioned JSON receipt; only explicit run can invoke generation, all writes retain API guards.
import {restoreAndUpgradeLibrary} from './library-upgrade.ts';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {readFile,writeFile,stat,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createApplication} from './app.ts';
import {copySavedStory} from './reader-copy.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {desktopLibraryPaths,savedDesktopLibraryDirectory} from './library-directory.ts';
import {SystemSettingsStore} from './system-settings.ts';
import {effectiveProviderVariables} from './cli-setup.ts';
import {installDiagnostics} from './diagnostics.ts';
import {diagnosticReport} from './diagnostics.ts';
import {createLibraryBackup,verifyLibraryBackup,containsPath} from './library-backup.ts';
import {bundledSkill,installSkill,checkSkill,updateSkill} from './cli-skill.ts';
import {agentSkillPreference} from './agent-skill.ts';
import {stopCodexProcesses} from './codex-runner.ts';
import {stopClaudeProcesses} from './claude-runner.ts';
import {readerBooks} from '../lib/reader-books.ts';
import {artStyles,artStyleGroups} from '../lib/reader-styles.ts';
import {themes} from '../lib/content.ts';
import {emptyPublication} from '../lib/story-publication.ts';
import {selectionSchema,reviewPassed,ReaderError} from '../lib/reader-model.ts';
import type {ReaderProvider} from '../lib/reader-provider.ts';
import {LocalBooks} from './local-books.ts';
import {applicationStorySearch,installStoryIndex} from './local-story-search.ts';

const commandNames=new Set(['skill','help','init','status','catalog','books','themes','styles','stories','run','preview','export','backup','restore','verify-backup','diagnostics','config','api']);
const commands=[
 ['skill show|install|check|update|auto-install','Normal app launch prepares the user skill; skill auto-install [on|off] reads/saves the startup preference without changing auto-update. Install with explicit --scope project|global; check auto-discovers copies and caches npm latest for 24h. --refresh retries; check --auto-update on|off saves consent. update copies only this CLI bundle, never local edits or downgrades.','skill check --auto-update on'],
 ['init','Optional: create the library directory and database at --data-dir (shiqu.sqlite plus media). Does not change the saved default; library commands also initialize automatically.','init --data-dir /private/library'],
 ['status','Library integrity/counts and runtime metadata; no cloud readiness request.','status'],
 ['catalog','Books, themes and styles. books contents BOOK --query words reads local sources.','books contents zhuangzi'],
 ['books imported','List user-imported books and their status.','books imported'],
 ['books import','Import local files or URLs into a draft. Rights acceptance is required; adjust structure, then confirm.','books import ./novel.txt --title "书名" --accept-rights'],
 ['books structure','Read or save a draft chapter structure using JSON {chapters:[...]}.','books structure DRAFT_ID --input structure.json'],
 ['books confirm','Confirm a reviewed import draft and add it to the local library.','books confirm DRAFT_ID'],
 ['books cards','Estimate story-card work or run/resume it; --retry-failed retries failed chapters and Ctrl-C pauses safely.','books cards BOOK_ID --estimate'],
 ['books index','Build the configured local embedding index for an imported book.','books index BOOK_ID'],
 ['books reimport','Create a replacement draft for structure review, then replace using --draft-id and reviewed --input; unchanged unique chapter cards are preserved.','books reimport BOOK_ID ./revised.txt --accept-rights'],
 ['books remove','Delete an imported book, its story cards, embeddings and generation cache. Requires --yes.','books remove BOOK_ID --yes'],
 ['books index-import','Install one book’s offline search index in the selected library directory.','books index-import 搜神记 FILE --data-dir /private/library'],
 ['books search','Search bundled story cards or installed indexes offline. Specify the book for bundled cards. Returns ranked original excerpts and source references without inference.','books search 种梨 聊斋志异 --limit 5 --brief'],
 ['stories list|get|current','Inspect saved stories and current-family versions.','stories get STORY_ID'],
 ['stories create','Save intake intent; input is a selection or {selection,intake:true,requestId}.','stories create --input selection.json --request-id UUID'],
 ['stories setup|search|choose|confirm','Persist intake actions with explicit --generation or input.generation; inference requires run.','stories choose ID --batch 0 --index 0 --generation N'],
 ['run / stories run','Run only one current story to candidates, prepared, reviewed or completed; never resumes a pause/fault implicitly.','run ID --until reviewed --timeout 900'],
 ['stories copy','Copy saved text and review from an offline library without inference. --draft explicitly preserves unreviewed text as a paused copy without images; default requires passed review.','stories copy ID --from-data-dir SOURCE --request-id UUID'],
 ['stories copy-images','Attach source images to an existing paused text copy without inference or prompts. Safe to repeat; retains text and review.','stories copy-images TARGET_ID --from-data-dir SOURCE --input source.json'],
 ['stories edit','Save a revision using the current token. changes.redrawPages uses 1-based pages and accepts optional changes.redrawNotes for those pages. Does not generate.','stories edit ID --input revision.json --request-id UUID'],
 ['stories pause|resume|stop|retry|override','Control or explicitly recover the current fault; input faultId is required for retry/override.','stories retry ID --input recovery.json --request-id UUID'],
 ['stories rename|delete|restore|favorite|reference','Shared library actions; reference input is {page,starred,token?}.','stories rename ID --title 新标题'],
 ['stories revisions|prompts|review-history|source','Read saved production checkpoints and history.','stories review-history ID'],
 ['stories reselect|replace|cancel-reselection','Replace a choice within the same family using production draft/generation contracts.','stories replace ID DRAFT_ID --input replacement.json'],
 ['preview','Write an offline HTML preview with escaped text and embedded saved images.','preview ID --output /private/preview.html'],
 ['export','Write json|md|zip|pdf|png using shared export rules. ZIP defaults public; internal prompts require --include-prompts.','export ID --format zip --output /private/story.zip'],
 ['backup|verify-backup|restore|diagnostics','Private verified library maintenance; restore requires an explicit new --data-dir.','backup /private/new-backup'],
 ['config get|set|reset','Shared saved settings; secret replacement only in JSON input, never argv or output.','config set --input settings.json'],
 ['api METHOD reader/ROUTE','In-process allowlisted reader persistence/inspection. Direct inference is rejected; run advances production.','api GET reader/sessions'],
].map(([name,description,example])=>({name,description,example}));
export class CliCommandError extends Error{
 readonly code:string;readonly exitCode:number;readonly details?:unknown;
 constructor(code:string,message:string,exitCode=2,details?:unknown){super(message);this.code=code;this.exitCode=exitCode;this.details=details;}
}
function need(ok:unknown,code:string,message:string):asserts ok{if(!ok)throw new CliCommandError(code,message);}
const uuid=(s:string)=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const inputs={
 copy:{copyImages:false,draft:false,artStyle:'clay',note:'CLI never prompts. Default requires passed review. --draft or draft:true preserves unreviewed text and audit checkpoints as a paused independent copy, without images. Use stories copy-images only for reviewed copies in the same style.'},
 copyImages:{sourceId:'source story UUID',note:'stories copy-images TARGET_ID --from-data-dir SOURCE_LIBRARY --input source.json; TARGET_ID is the existing text copy, not a new creation request.'},
 setup:{note:'stories setup ID accepts an action; requestId defaults to a new UUID; generation is required from stories get ID. Keep both fixed for replay.',examples:[{action:'conditions',conditions:{bookId:'zhuangzi',theme:'善意与误解',productionPrompt:''}},{action:'more'},{action:'draft',settings:{artStyle:'ink-pencil',productionPrompt:'',acceptancePrompt:'',narrativeDetail:'balanced',length:'auto'}}]},
 confirm:{settings:{productionPrompt:'保留关键行动',acceptancePrompt:'人物回应落实到画面'}},
 retry:{faultId:'current fault UUID from stories get'},favorite:{saved:true},reference:{page:0,starred:true},replace:{batch:0,index:0},
 redraw:{command:'stories edit ID --input redraw.json --request-id UUID',input:{token:'from stories revisions ID',paused:true,changes:{redrawPages:[1,2],redrawNotes:{2:'调暗背景光线，保留主体的位置。'}}},note:'Completed stories only. Optional redrawNotes apply to selected 1-based pages in this revision and its retries. Preserves script, review and unselected images. Only run performs generation using its configured image provider.'},
 publication:{get:'api GET reader/publication-defaults',set:'api POST reader/publication-defaults --input publication.json',input:{publication:{...emptyPublication,author:'你的署名',watermarkFontSize:24},expected:'Use the exact publication object (or null) returned by GET.'}},
 frameCount:{command:'api POST reader/sessions/ID/frame-count --input count.json',input:{count:8}},
 config:{command:'config set --input settings.json',input:{settings:{provider:'codex',providerConfigured:true,imageProvider:'gemini'},expectedRevision:'from config get'},imageProvider:'Optional drawing provider (gemini|openai|codex); null or omitted follows provider.',key:'For API providers only: key:{provider:"openai"|"gemini",value:"secret"|null}, or a list for separate text/image providers; never pass a key in argv.'},
};
type Context={cwd?:string;home?:string;generation?:ReaderProvider;localBooks?:LocalBooks;variables?:Record<string,string|undefined>;input?:unknown;signal?:AbortSignal;skill?:{transport?:typeof fetch;now?:()=>number}};
function parse(args:string[]){return parseArgs({args,allowPositionals:true,strict:true,options:Object.fromEntries([
 ...['data-dir','from-data-dir','input','output','format','until','timeout','title','author','era','source-note','license','encoding','request-id','query','batch','index','scope','generation','auto-update','limit','draft-id'].map(k=>[k,{type:'string'}]),
 ...['json','brief','help','allow-unsigned','include-prompts','no-intake','refresh','automatic','copy-images','no-copy-images','draft','accept-rights','estimate','retry-failed','yes'].map(k=>[k,{type:'boolean'}]),
 ]) as Record<string,{type:'string'|'boolean'}>});}
async function readInput(filename?:string){
 if(!filename)return {};
 let text='';if(filename==='-'){for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>1048576)throw new CliCommandError('INPUT_TOO_LARGE','JSON input exceeds 1 MiB.');}}
 else{if((await stat(path.resolve(filename))).size>1048576)throw new CliCommandError('INPUT_TOO_LARGE','JSON input exceeds 1 MiB.');text=await readFile(path.resolve(filename),'utf8');}
 try{return JSON.parse(text);}catch{throw new CliCommandError('INVALID_JSON','Input must contain valid JSON.');}
}
const apiAllow=(method:string,route:string)=>{
 const base=route.split('?')[0];
 if(method==='GET')return /^(?:sessions(?:\/[a-f0-9-]{36}(?:\/(?:current|revisions|prompts|review-history|source))?)?|deletions|publication-defaults|books\/imported(?:\/my-[a-f0-9]{16}(?:\/(?:structure|cards(?:\/estimate)?))?)?|books\/[^/]+\/contents)$/.test(base);
 if(method==='POST')return /^(?:sessions|publication-defaults|books\/imports|books\/imported\/my-[a-f0-9]{16}\/(?:confirm|cards\/cancel|replace)|books\/my-[a-f0-9]{16}\/embedding-index|sessions\/[a-f0-9-]{36}\/(?:setup|revisions|title|publication|production-control|recover|review-override|frame-count|reselection|progress)|sessions\/[a-f0-9-]{36}\/reselection\/[a-f0-9-]{36}|library\/[^/]+\/(?:restore|favorite|reference))$/.test(base);
 if(method==='PUT')return /^books\/imported\/my-[a-f0-9]{16}\/structure$/.test(base);
 return method==='DELETE'&&/^(?:library\/[^/]+|books\/imports\/my-[a-f0-9]{16}|books\/imported\/my-[a-f0-9]{16}|sessions\/[a-f0-9-]{36}\/reselection\/[a-f0-9-]{36})$/.test(base);
};
async function api(app:ReturnType<typeof createApplication>,method:string,route:string,input?:unknown,signal?:AbortSignal){
 const response=await app.handle(new Request('http://shiqu.local/api/reader/'+route,{method,headers:{'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)}),...(signal?{signal}:{})}));
 const data=await response.json();if(!response.ok)throw new CliCommandError(response.status===409?'CONFLICT':response.status===404?'NOT_FOUND':response.status===503?'PROVIDER_UNAVAILABLE':'INVALID_REQUEST',data.error||'The production action failed.',response.status>=500?4:2,{status:response.status});return data;
}
async function streamApi(app:ReturnType<typeof createApplication>,route:string,input:unknown,signal:AbortSignal,onEvent:(value:any)=>void=()=>{}){
 const response=await app.handle(new Request('http://shiqu.local/api/reader/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}));
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new CliCommandError(response.status===409?'CONFLICT':response.status===404?'NOT_FOUND':response.status===503?'PROVIDER_UNAVAILABLE':'INVALID_REQUEST',data.error||'The production action failed.',response.status>=500?4:2,{status:response.status});}
 const reader=response.body?.getReader();if(!reader)throw new CliCommandError('EMPTY_STREAM','The local task returned no progress stream.');
 const decoder=new TextDecoder(),last:any={};let pending='';
 const accept=(line:string)=>{if(!line.trim())return;const event=JSON.parse(line);onEvent(event);Object.assign(last,event);if(event.type==='error')throw new CliCommandError('TASK_FAILED',event.error||'The local task failed.',4);if(event.type==='complete')last.progress=event.progress;};
 try{while(true){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines)accept(line);if(done){accept(pending);break;}}}finally{reader.releaseLock();}
 return last.progress||last;
}
async function uploadImportFile(app:ReturnType<typeof createApplication>,draftId:string,filename:string,encoding?:string){
 const absolute=path.resolve(filename),info=await stat(absolute);need(info.isFile()&&info.size>0&&info.size<=12*1024*1024,'INVALID_IMPORT_FILE','Each import file must be a non-empty regular file no larger than 12 MB.');
 const bytes=await readFile(absolute),extension=path.extname(filename).toLowerCase(),contentType=extension==='.epub'?'application/epub+zip':extension==='.html'||extension==='.htm'?'text/html':'text/plain';
 const response=await app.handle(new Request(`http://shiqu.local/api/reader/books/imports/${encodeURIComponent(draftId)}/files`,{method:'POST',headers:{'Content-Type':contentType,'X-File-Name':encodeURIComponent(path.basename(filename)),...(encoding&&['.txt','.html','.htm'].includes(extension)?{'X-Text-Encoding':encoding}:{})},body:new Uint8Array(bytes)}));
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new CliCommandError(response.status===413?'IMPORT_LIMIT':response.status===409?'CONFLICT':'INVALID_IMPORT_FILE',data.error||'Could not import the source file.',response.status>=500?4:2,{status:response.status});return data;
}
async function importSources(app:ReturnType<typeof createApplication>,sources:string[],metadata:any,encoding?:string){
 need(sources.length>0&&sources.length<=100,'IMPORT_SOURCE_COUNT','Provide between 1 and 100 files or URLs.');
 const urls=sources.map(source=>/^https?:\/\//i.test(source));need(urls.every(Boolean)||urls.every(value=>!value),'MIXED_IMPORT_INPUTS','Import either URLs or local files in one command.');
 const created=await api(app,'POST','books/imports',{...metadata,...(urls[0]?{urls:sources,...(encoding?{encoding}:{})}:{})});let preview=created.preview;
 try{if(!urls[0])for(const filename of sources)preview=await uploadImportFile(app,created.draft.id,filename,encoding);}
 catch(error){await api(app,'DELETE',`books/imports/${encodeURIComponent(created.draft.id)}`).catch(()=>{});throw error;}
 return {draft:created.draft,preview};
}
function outputOutside(root:string,filename:string){for(const served of ['public','dist/client'])need(!containsPath(path.join(root,served),filename),'PRIVATE_OUTPUT_REQUIRED','Output must be outside application static directories.');}
export async function executeHeadless(root:string,args:string[],context:Context={}){
 const {values:v,positionals:p}=parse(args);const command=p[0]||'help',action=p[1],id=p[2],value=(name:string)=>typeof v[name]==='string'?v[name] as string:undefined;
 need(commandNames.has(command),'UNKNOWN_COMMAND','Use help --json for available commands.');
 const appVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version||'unknown';
 if(command==='help'||v.help)return {schemaVersion:1,appVersion,default:'No subcommand starts the existing browser service.',commands,inputs,options:{'--data-dir':'Private library, otherwise saved desktop/CLI location.','--input':'JSON file or - for stdin; books reimport accepts reviewed {chapters:[...]} structure.','--query':'Query for books contents.','--limit':'Maximum results for books search (1–42, default 10).','--output':'New output path; never overwrites.','--request-id':'Stable UUID for mutation replay; retain original generation/token/faultId and input.','--generation':'Required intake generation from stories get ID for setup/search/choose/confirm.','--until':'candidates|prepared|reviewed|completed (default completed).','--timeout':'Explicit run timeout in seconds, default 900, max 86400.','--allow-unsigned':'Explicitly permit an unsigned export.','--draft':'Copy an unreviewed storyboard as a paused text draft.','--draft-id':'Identify a books reimport draft after structure review.','--brief':'Show book, indexed story title and source location for books search.','--accept-rights':'Confirm you have the right to store and use imported source material.','--retry-failed':'Retry failed imported-book card chapters.','--estimate':'Estimate imported-book story-card work.','--yes':'Confirm irreversible imported-book deletion.','--encoding':'Explicit text encoding for imported TXT files or HTML pages.','--json':'Return one JSON receipt on stdout (default).'},selectionExample:{bookId:'zhuangzi',theme:'原典故事',artStyle:'ink-pencil',narrativeDetail:'balanced'},editExample:{token:'from stories revisions ID',changes:{productionPrompt:'保留关键人物回应'}},runResults:['completed','candidates','prepared','choice','frame_count_required','already_prepared','already_selected','reviewed','paused','blocked','superseded'],execution:'Only explicit run and books cards/index perform configured generation or embedding work. Other commands save or inspect local state.'};
 if(command==='books'&&action==='index-install')throw new CliCommandError('LEGACY_VECTOR_PACK_DISABLED','Official vector packs are no longer supported. Use My → Embedding model to build a local story-card index.');
 if(command==='themes'||command==='styles'){
  return command==='themes'?themes:artStyles.map(({prompt,...style})=>style);
 }
 if(command==='skill'){
  if(action==='show')return {appVersion,text:await bundledSkill(root)};
  if(action==='auto-install'){need(!value('scope')&&!value('auto-update')&&!v.refresh&&!v.automatic&&p.length<=3&&(id===undefined||['on','off'].includes(id)),'INVALID_INPUT','Use skill auto-install [on|off] for this user.');return agentSkillPreference(id===undefined?undefined:id==='on',{home:context.home,variables:context.variables||process.env});}
  const scope=value('scope');need(scope===undefined||['project','global'].includes(scope),'SKILL_SCOPE_REQUIRED','Use --scope project|global.');
  need(['install','check','update'].includes(action),'UNKNOWN_COMMAND','Use skill show|install|check|update|auto-install.');
  need(action==='check'||value('auto-update')===undefined&&!v.refresh,'INVALID_INPUT','--auto-update and --refresh apply only to skill check.');
  need(!v.automatic||action==='update','INVALID_INPUT','--automatic applies only to skill update.');
  const preference=value('auto-update');need(preference===undefined||['on','off'].includes(preference),'INVALID_INPUT','Use --auto-update on|off.');
  const skillContext={cwd:context.cwd,home:context.home,variables:context.variables||process.env,...context.skill};
  if(action==='check')return checkSkill(root,scope,{autoUpdate:preference===undefined?undefined:preference==='on',refresh:!!v.refresh},skillContext);
  need(scope,'SKILL_SCOPE_REQUIRED','Install/update requires --scope project|global.');
  if(action==='update')return updateSkill(root,scope,skillContext,!!v.automatic);
  return {appVersion,scope,...await installSkill(root,scope==='global'?context.home||os.homedir():context.cwd)};
 }
 const input=context.input??await readInput(value('input'));need(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','JSON input must be an object.');
 const supplied=(input as any).requestId||value('request-id'),requestId=supplied||randomUUID();need(uuid(requestId),'INVALID_REQUEST_ID','requestId must be a UUID.');
 const variables=context.variables||process.env,locations=desktopLibraryPaths({variables,home:context.home});
 if(command==='config'){
  const store=new SystemSettingsStore(locations.settings,locations.library);
  try{
   if(action==='set')store.save((input as any).settings||{},(input as any).key,(input as any).expectedRevision);
   else if(action==='reset')store.resetProviders();else need(action==='get','UNKNOWN_COMMAND','Use config get|set|reset.');
   return {settings:store.settings(),revision:store.revision(),keyPresent:{gemini:!!store.key('gemini'),openai:!!store.key('openai')}};
  }finally{store.close();}
 }
 if(command==='verify-backup'){need(action,'BACKUP_PATH_REQUIRED','Specify a backup directory.');const verified=verifyLibraryBackup(path.resolve(action));return {verified:true,files:verified.files.length,createdAt:verified.createdAt};}
 const directory=path.resolve(value('data-dir')||variables.SHIQU_DATA_DIR||savedDesktopLibraryDirectory({variables,home:context.home})||locations.library);
 if(command==='catalog'&&!existsSync(path.join(directory,'shiqu.sqlite'))){
  return {books:readerBooks,themes,styles:artStyles.map(({prompt,...style})=>style),styleGroups:artStyleGroups};
 }
 // 检索只访问独立索引和随应用发布的原文，不初始化或锁定正式书库。
 if(command==='books'&&action==='index-import'){
  need(id&&p[3]&&p.length===4,'INVALID_INPUT','Use books index-import BOOK FILE.');
  need(!/^my-[a-f0-9]{16}$/.test(id),'IMPORTED_BOOK_INDEX_DISABLED','Imported books use generated local story cards; use books cards, then books index.');
  outputOutside(root,directory);
  const books=context.localBooks||new LocalBooks(root),book=await books.book(selectionSchema.parse({bookId:id,theme:'原典故事'}));
  need(book,'BOOK_NOT_FOUND','This book is unavailable in the local collection.');
  try{return await installStoryIndex(directory,book,path.resolve(context.cwd||process.cwd(),p[3]));}
  catch(error){if(error instanceof ReaderError)throw new CliCommandError('INVALID_STORY_INDEX',error.message);throw error;}
 }
 if(command==='books'&&action==='search'){
  need(p.length<=4&&value('query')===undefined,'INVALID_INPUT','Use books search QUERY [BOOK]. Quote a query containing spaces.');
  const query=id?.trim(),limit=Number(value('limit')??10);
  need(query&&query.length<=200,'QUERY_REQUIRED','Specify a query of 1 to 200 characters.');
  need(Number.isInteger(limit)&&limit>=1&&limit<=42,'INVALID_LIMIT','Use --limit between 1 and 42.');
  const books=context.localBooks||new LocalBooks(root),search=applicationStorySearch(root,directory,()=>books);
  const manual=p[3]?null:await search.indexedBooks();
  const indexed=manual;
  need(p[3]||manual||await search.hasBundledCards(),'SEARCH_INDEX_UNAVAILABLE','No readable story index.');
  const bookId=p[3]||(indexed?.length===1?indexed[0]:undefined);
  need(bookId&&bookId.length<=100,'BOOK_ID_REQUIRED','Specify a book for this index.');
  const book=await books.book(selectionSchema.parse({bookId,theme:'原典故事'}));
  need(book,'BOOK_NOT_FOUND','This book is unavailable in the local collection.');
  const ranges=await search.lookupHits(book,query,context.signal||new AbortController().signal);
  need(ranges,'SEARCH_INDEX_UNAVAILABLE','No readable story index for this book edition.');
  const results=[];
  const lines=[];
  for(const [index,{source,title}] of ranges.entries()){
   try{
    const original=books.resolve(book,source),chars=Array.from(original.text);
    results.push({rank:index+1,source,sourceLabel:original.title,sourceUrl:original.url,excerpt:chars.slice(0,320).join(''),truncated:chars.length>320});
    if(v.brief&&!v.json)lines.push(`${index+1}. ${title.replace(/\s+/gu,' ')||'无标题'} · ${original.title}`);
    if(results.length===limit)break;
   }catch(error){if(!(error instanceof ReaderError))throw error;}
  }
  if(v.brief&&!v.json){
   return {text:[`《${book.title}》 · ${query} · ${results.length} 条结果`,...lines].join('\n')+'\n'};
  }
  return {bookId:book.id,bookTitle:book.title,edition:book.edition,query,results};
 }
 if(command==='restore'){need(action&&value('data-dir'),'RESTORE_TARGET_REQUIRED','restore BACKUP requires explicit --data-dir NEW_DIRECTORY.');outputOutside(root,directory);const manifest=restoreAndUpgradeLibrary(path.resolve(action),directory,root);return {restored:true,path:directory,files:manifest.files.length,started:false};}
 if(command==='diagnostics'){
  const output=value('output')||action;need(output,'OUTPUT_REQUIRED','Specify --output NEW_FILE.');outputOutside(root,path.resolve(output));need(!containsPath(directory,path.resolve(output)),'PRIVATE_OUTPUT_REQUIRED','Diagnostic output must be outside the library.');
  await writeFile(path.resolve(output),JSON.stringify(diagnosticReport(directory,appVersion),null,2)+'\n',{flag:'wx',mode:0o600});return {path:path.resolve(output)};
 }
 // Normal commands share desktop/server automatic initialization; backup must never create an empty source.
 if(command==='backup')need(existsSync(path.join(directory,'shiqu.sqlite')),'LIBRARY_NOT_FOUND','Cannot back up a library without an existing database.');
 const release=await ownDesktopData(directory),removeDiagnostics=installDiagnostics(directory);let app:ReturnType<typeof createApplication>|undefined;
 const running=command==='run'||command==='stories'&&action==='run',cardTask=command==='books'&&action==='cards'&&!v.estimate,cardEstimate=command==='books'&&action==='cards'&&!!v.estimate,indexTask=command==='books'&&action==='index',taskSignal=cardTask||indexTask,target=command==='run'?action:id;
 const until=value('until')||'completed',timeout=Number(value('timeout')||900);let timer:ReturnType<typeof setTimeout>|undefined;
 const abort=new AbortController();let timedOut=false;
 const interrupt=()=>{app?.stopGeneration();abort.abort();void Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);};
 try{
  if(command==='backup'){need(action,'BACKUP_PATH_REQUIRED','Specify a new backup directory.');outputOutside(root,path.resolve(action));const manifest=createLibraryBackup(directory,path.resolve(action),appVersion,root);return {path:path.resolve(action),files:manifest.files.length,verified:true};}
  let effective:Record<string,string|undefined>={...variables,SHIQU_AI_PROVIDER:'readonly'};
 if((running||cardTask||cardEstimate)&&!context.generation){
   if(existsSync(locations.settings)){const store=new SystemSettingsStore(locations.settings,locations.library);try{effective=effectiveProviderVariables(store,variables);}finally{store.close();}}
   else effective={...variables,SHIQU_AI_PROVIDER:variables.SHIQU_AI_PROVIDER||'readonly'};
   need(effective.SHIQU_AI_PROVIDER!=='readonly','PROVIDER_UNAVAILABLE','Configure a provider using config set, --configure or environment variables before run.');
  }
  if(running){need(target&&uuid(target),'STORY_ID_REQUIRED','run requires a story UUID.');need(['candidates','prepared','reviewed','completed'].includes(until),'INVALID_UNTIL','Use candidates|prepared|reviewed|completed.');need(Number.isFinite(timeout)&&timeout>0&&timeout<=86400,'INVALID_TIMEOUT','Timeout must be between 0 and 86400 seconds.');}
  const transport:typeof fetch=(url,options)=>fetch(url,{...options,signal:options?.signal?AbortSignal.any([options.signal,abort.signal]):abort.signal});
  app=createApplication({root,dataDirectory:directory,variables:effective,transport,generation:context.generation,commandOnly:!running,production:{autoStart:false,targetSessionId:running?target:undefined,stopBeforeImages:running&&until!=='completed'}});
  if(running||taskSignal){process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);context.signal?.addEventListener('abort',interrupt,{once:true});if(context.signal?.aborted)interrupt();}
  if(context.localBooks)app.services.localBooks=context.localBooks;
  if(command==='init')return {initialized:true,path:directory,started:false};
  if(command==='status')return diagnosticReport(directory,appVersion);
  if(command==='books'&&(!action||action==='imported')){
   const imported=(await api(app,'GET','books/imported')).books;
   const books=[...readerBooks,...imported];
   if(action==='imported')return {books:imported};
   if(action===undefined)return {books};
  }
  if(command==='catalog'){
   const imported=(await api(app,'GET','books/imported')).books;
   return {books:[...readerBooks,...imported],themes,styles:artStyles.map(({prompt,...style})=>style),styleGroups:artStyleGroups};
  }
  if(command==='books'&&action==='contents'){need(id,'BOOK_ID_REQUIRED','Specify a book ID.');return await api(app,'GET',`books/${encodeURIComponent(id)}/contents?q=${encodeURIComponent(value('query')||'')}`);}
  if(command==='books'&&action==='import'){
   need(!!value('title'),'TITLE_REQUIRED','Use books import FILE|URL... --title TITLE --accept-rights.');need(v['accept-rights'],'RIGHTS_ACCEPTANCE_REQUIRED','Confirm the right to store and use these sources with --accept-rights.');need(p.length>=3,'IMPORT_SOURCE_REQUIRED','Provide one or more local files or HTTP(S) URLs.');
   const result=await importSources(app,p.slice(2),{title:value('title'),author:value('author'),era:value('era'),sourceNote:value('source-note'),license:value('license'),acceptRights:true},value('encoding'));
   return {id:result.draft.id,title:result.draft.title,status:'structuring',sources:result.preview?.manifest?.sources?.length||0,chapters:result.preview?.chapters?.length||0,structure:result.preview};
  }
  if(command==='books'&&action==='structure'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an import draft ID.');const route=`books/imported/${encodeURIComponent(id)}/structure`;
   return value('input')!==undefined||context.input!==undefined?await api(app,'PUT',route,input):await api(app,'GET',route);
  }
  if(command==='books'&&action==='confirm'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an import draft ID.');return await api(app,'POST',`books/imported/${encodeURIComponent(id)}/confirm`,{});
  }
  if(command==='books'&&action==='cards'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an imported book ID.');
   if(v.estimate){need(!v['retry-failed'],'INVALID_INPUT','--retry-failed applies only when running cards.');return await api(app,'GET',`books/imported/${encodeURIComponent(id)}/cards/estimate`);}
   need(value('encoding')===undefined,'INVALID_INPUT','--encoding applies only to books import.');
   try{const result=await streamApi(app,`books/imported/${encodeURIComponent(id)}/cards`,{retryFailed:!!v['retry-failed']},abort.signal,event=>{if(event.type==='progress')process.stderr.write(`\r故事卡 ${event.progress?.status||''} · ${event.progress?.chapters?.filter((chapter:any)=>chapter.status==='done').length||0}/${event.progress?.chapters?.length||0} 章`);});process.stderr.write('\n');return result;}
   catch(error){if(!abort.signal.aborted)throw error;await api(app,'POST',`books/imported/${encodeURIComponent(id)}/cards/cancel`,{});const current=await api(app,'GET',`books/imported/${encodeURIComponent(id)}/cards`);process.stderr.write('\n');return {cancelled:true,progress:current.progress};}
  }
  if(command==='books'&&action==='index'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an imported book ID.');
   try{const result=await streamApi(app,`books/${encodeURIComponent(id)}/embedding-index`,{},abort.signal,event=>{if(event.type==='progress')process.stderr.write(`\r向量索引 ${event.completed||0}/${event.total||0}`);});process.stderr.write('\n');return result;}
   catch(error){if(!abort.signal.aborted)throw error;process.stderr.write('\n');return {cancelled:true};}
  }
  if(command==='books'&&action==='remove'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an imported book ID.');need(v.yes,'CONFIRMATION_REQUIRED','Deleting the original, cards, vectors and generation cache requires --yes.');return await api(app,'DELETE',`books/imported/${encodeURIComponent(id)}`);
  }
  if(command==='books'&&action==='reimport'){
   need(id&&/^my-[a-f0-9]{16}$/.test(id),'BOOK_ID_REQUIRED','Specify an imported book ID.');
   if(value('draft-id')!==undefined){
    const draftId=value('draft-id');need(p.length===3&&draftId&&/^my-[a-f0-9]{16}$/.test(draftId),'DRAFT_ID_REQUIRED','Use books reimport BOOK_ID --draft-id DRAFT_ID --input reviewed-structure.json.');
    need(value('input')!==undefined||context.input!==undefined,'STRUCTURE_REVIEW_REQUIRED','Inspect the draft with books structure DRAFT_ID, then provide its reviewed {chapters:[...]} structure with --input.');
    await api(app,'PUT',`books/imported/${encodeURIComponent(draftId)}/structure`,input);return await api(app,'POST',`books/imported/${encodeURIComponent(id)}/replace`,{draftId});
   }
   need(p.length>=4,'IMPORT_SOURCE_REQUIRED','Use books reimport BOOK_ID FILE|URL... --accept-rights, then review the returned draft structure.');need(v['accept-rights'],'RIGHTS_ACCEPTANCE_REQUIRED','Confirm the right to store and use replacement sources with --accept-rights.');
   const current=await api(app,'GET',`books/imported/${encodeURIComponent(id)}`),metadata={title:value('title')||current.title,author:value('author')??current.author,era:value('era')??current.era,sourceNote:value('source-note')??current.sourceNote,license:value('license')??current.license,acceptRights:true};
   const result=await importSources(app,p.slice(3),metadata,value('encoding')),draftId=result.draft.id;
   if(value('input')===undefined&&context.input===undefined)return {id,title:metadata.title,status:'review-required',draftId,sources:result.preview?.manifest?.sources?.length||0,chapters:result.preview?.chapters?.length||0,structure:result.preview,message:`检查草稿：books structure ${draftId}；替换时提供已检查的结构：books reimport ${id} --draft-id ${draftId} --input reviewed-structure.json`};
   await api(app,'PUT',`books/imported/${encodeURIComponent(draftId)}/structure`,input);return await api(app,'POST',`books/imported/${encodeURIComponent(id)}/replace`,{draftId});
  }
  if(command==='api'){
   const route=(p[2]||'').replace(/^\/?(?:api\/)?reader\//,'');need(action&&apiAllow(action.toUpperCase(),route),'EXECUTION_REQUIRED','Only allowlisted non-inference reader actions are supported; use run for generation.');
   const data={...(input as any)};if(action.toUpperCase()==='POST'&&(route==='sessions'||/\/(setup|revisions|recover|review-override|reselection|production-control)$/.test(route)))data.requestId??=requestId;
   return await api(app,action.toUpperCase(),route,['GET','HEAD'].includes(action.toUpperCase())?undefined:data);
  }
  if(command==='preview'||command==='export'){
   need(action&&uuid(action),'STORY_ID_REQUIRED','Specify a story UUID.');const output=value('output');need(output,'OUTPUT_REQUIRED','Specify --output NEW_FILE.');outputOutside(root,path.resolve(output));need(!containsPath(directory,path.resolve(output)),'PRIVATE_OUTPUT_REQUIRED','Export outside the private library.');
   const current=await api(app,'GET',`sessions/${action}/current`);need(current.id===action,'SUPERSEDED_VERSION','Export the current family version.');const session=await api(app,'GET',`sessions/${action}`);const {exportLocalStory}=await import('./story-export.ts');return await exportLocalStory(root,app,session,{output,format:value('format')||'zip',preview:command==='preview',includePrompts:!!v['include-prompts'],allowUnsigned:!!v['allow-unsigned']});
  }
  if(running){
   const status=await app.services.generation.status();need(status.configured,'PROVIDER_UNAVAILABLE',status.message||'Provider is not ready.');
   const current=await api(app,'GET',`sessions/${target}/current`);const initial=await api(app,'GET',`sessions/${target}`);need(current.id===target&&!initial.superseded,'SUPERSEDED_VERSION','Use the current family version.');
   if(initial.generationControl!=='active')return {reason:'paused',session:initial};
   if(initial.state==='failed')return {reason:'blocked',session:initial};
   const boundary=(snapshot:any)=>snapshot.state==='completed'?'completed':snapshot.awaitingFrameCount?'frame_count_required':until==='prepared'&&snapshot.intake?.phase==='confirmed'?'already_prepared':until==='prepared'&&snapshot.frameRecommendation?'prepared':until==='candidates'&&snapshot.intake?.selected?'already_selected':null;
   const reached=boundary(initial);if(reached)return {reason:reached,session:initial};
   if(until==='candidates')need(initial.intake,'BOUNDARY_UNAVAILABLE','Candidates require an intake story.');
   if(until==='prepared'&&!initial.intake)need(initial.selection.narrativeDetail&&initial.selection.length!=='auto','BOUNDARY_UNAVAILABLE','This legacy story has no preparation gate; use --until reviewed or completed.');
   process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);context.signal?.addEventListener('abort',interrupt,{once:true});
   if(context.signal?.aborted)interrupt();
   timer=setTimeout(()=>{timedOut=true;interrupt();},timeout*1000);
   const viewerId=randomUUID();app.startGeneration();let snapshot=initial;
   try{
    while(!abort.signal.aborted){
     snapshot=await app.services.production!.request(app.services.ownerId,target!,viewerId,0,false);
     const intake=snapshot.intake,doc=await app.services.database.prepare('SELECT document FROM stories WHERE id=?').bind(target).first<{document:string}>(),saved=JSON.parse(doc!.document);
     const reason=snapshot.superseded?'superseded':snapshot.state==='failed'?'blocked':snapshot.generationControl!=='active'?'paused':boundary(snapshot)|| (until==='candidates'&&intake?.batches.some((batch:any)=>batch.stories.length)?'candidates':intake?.phase==='confirming'?'prepared':intake?.phase==='choosing'&&intake.search.state!=='searching'?'choice':until==='reviewed'&&saved.plan&&reviewPassed(saved)?'reviewed':null);
     if(reason)return {reason,session:snapshot};await delay(80,undefined,{signal:abort.signal}).catch(()=>{});
    }
    throw new CliCommandError(timedOut?'TIMEOUT':'INTERRUPTED',timedOut?'Run timed out; saved checkpoints are retained.':'Run interrupted; saved checkpoints are retained.',timedOut?5:130,{session:snapshot});
   }finally{await app.services.production!.leave(app.services.ownerId,target!,viewerId);}
  }
  need(command==='stories','UNKNOWN_COMMAND','Use help --json for available commands.');
  if(action==='list')return await api(app,'GET','sessions');
  if(action==='create'){
   const data=input as any,selection=selectionSchema.parse(data.selection||data);return {requestId,session:await api(app,'POST','sessions',{requestId,selection,intake:data.intake??!v['no-intake']})};
  }
  need(id&&uuid(id),'STORY_ID_REQUIRED','Specify a story UUID.');
  if(action==='copy'||action==='copy-images'){
   const source=value('from-data-dir');need(source,'SOURCE_REQUIRED','Specify --from-data-dir SOURCE_LIBRARY.');
   if(action==='copy-images'){
    need(!v.draft&&(input as any).draft===undefined,'INVALID_INPUT','--draft applies only to text copy.');
    const sourceId=(input as any).sourceId;need(typeof sourceId==='string'&&uuid(sourceId),'SOURCE_REQUIRED','Specify sourceId in JSON input.');
    const current=await api(app,'GET',`sessions/${id}`);
    try{return {session:await copySavedStory(app,root,directory,path.resolve(source),sourceId,id,current.selection.artStyle,{images:true,existing:true})};}
    catch(error){if(error instanceof ReaderError)throw new CliCommandError(error.status===409?'CONFLICT':'COPY_FAILED',error.message,error.status>=500?4:2,{storyId:id});throw error;}
   }
   const draft=(input as any).draft;
   need(draft===undefined||typeof draft==='boolean','INVALID_INPUT','draft must be a boolean.');
   need(!v.draft||draft!==false,'INVALID_INPUT','draft conflicts with --draft.');
   const copyDraft=draft??!!v.draft;
   const choice=(input as any).copyImages;
   need(choice===undefined||typeof choice==='boolean','INVALID_INPUT','copyImages must be a boolean.');
   need(!(v['copy-images']&&v['no-copy-images']),'INVALID_INPUT','Choose --copy-images or --no-copy-images.');
   const flag=v['copy-images']?true:v['no-copy-images']?false:undefined;
   need(choice===undefined||flag===undefined||choice===flag,'INVALID_INPUT','copyImages conflicts with the command-line image choice.');
   try{return {requestId,session:await copySavedStory(app,root,directory,path.resolve(source),id,requestId,(input as any).artStyle,{images:choice??flag,draft:copyDraft})};}
   catch(error){if(error instanceof ReaderError)throw new CliCommandError(error.status===409?'CONFLICT':'COPY_FAILED',error.message,error.status>=500?4:2,{requestId});throw error;}
  }
  const route=`sessions/${id}`,data={...(input as any)};
  if(['get','current','revisions','prompts','review-history','source'].includes(action))return await api(app,'GET',route+(action==='get'?'':'/'+action));
  if(action==='rename')return await api(app,'POST',route+'/title',{title:value('title')||data.title});
  if(action==='delete')return await api(app,'DELETE',`library/${id}`);
  if(['restore','favorite','reference'].includes(action))return await api(app,'POST',`library/${id}/${action}`,data);
  if(['pause','resume','stop'].includes(action))return {requestId,session:await api(app,'POST',route+'/production-control',{requestId,action})};
  if(['retry','override'].includes(action)){
   const faultId=data.faultId;
   need(faultId,'FAULT_ID_REQUIRED','Choose a current faultId from stories get.');return {requestId,session:await api(app,'POST',route+(action==='retry'?'/recover':'/review-override'),{requestId,faultId})};
  }
  if(action==='edit'){
   need(typeof data.token==='string'&&data.token,'TOKEN_REQUIRED','Read stories revisions ID and submit its token with changes.');return {requestId,session:await api(app,'POST',route+'/revisions',{requestId,token:data.token,changes:data.changes||Object.fromEntries(Object.entries(data).filter(([key])=>!['token','paused','requestId'].includes(key))),paused:data.paused??false})};
  }
  if(action==='reselect')return {requestId,session:await api(app,'POST',route+'/reselection',{requestId})};
  if(['replace','cancel-reselection'].includes(action)){need(p[3]&&uuid(p[3]),'DRAFT_ID_REQUIRED','Specify a reselection draft UUID.');return await api(app,action==='replace'?'POST':'DELETE',route+'/reselection/'+p[3],action==='replace'?{...data,requestId}:undefined);}
  if(['setup','search','choose','confirm'].includes(action)){
   const generation=data.generation??(value('generation')===undefined?undefined:Number(value('generation')));need(Number.isInteger(generation)&&generation>=0,'GENERATION_REQUIRED','Read stories get ID and retain its intake.generation for this request and replay.');
   const session=await api(app,'GET',route);const settings={artStyle:session.selection.artStyle,productionPrompt:session.selection.productionPrompt||'',acceptancePrompt:session.selection.acceptancePrompt||'',narrativeDetail:session.selection.narrativeDetail||'balanced',length:session.selection.length,...(session.intake?.draft||{})};
   const change=action==='setup'?data:action==='search'?{action:'search',title:value('title')||data.title||''}:action==='choose'?{action:'choose',batch:Number(value('batch')??data.batch??0),index:Number(value('index')??data.index??0),...(data.settings?{settings:data.settings}:{})}:{action:'confirm',settings:{...settings,...(data.settings||Object.fromEntries(Object.entries(data).filter(([key])=>!['generation','requestId'].includes(key))))}};
   return {requestId,session:await api(app,'POST',route+'/setup',{...change,requestId,generation})};
  }
  throw new CliCommandError('UNKNOWN_COMMAND','Use help --json for available commands.');
 }finally{
  if(timer)clearTimeout(timer);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);context.signal?.removeEventListener('abort',interrupt);
  try{if(app){app.stopGeneration();abort.abort();if(running)await Promise.all([stopCodexProcesses(),stopClaudeProcesses()]);await app.close();}}finally{removeDiagnostics();await release();}
 }
}
export async function routeHeadless(root:string,args:string[]){
 if(!commandNames.has(args[0])&&!(args[0]&&!args[0].startsWith('-'))&&!(args.includes('--json')&&args.includes('--help')))return false;
 const saved={log:console.log,info:console.info,warn:console.warn};
 console.log=console.info=console.warn=(...values:unknown[])=>console.error(...values);
 try{const data=await executeHeadless(root,args[0]?.startsWith('-')?['help',...args]:args);const plainText=args[0]==='skill'&&args[1]==='show'||args[0]==='books'&&args[1]==='search'&&args.includes('--brief')&&!args.includes('--help');process.stdout.write(plainText&&!args.includes('--json')?(data as {text:string}).text:JSON.stringify({schemaVersion:1,ok:true,data})+'\n');}
 catch(error){
  const known=error instanceof CliCommandError,skillCode=(error as NodeJS.ErrnoException)?.code,code=known?error.code:typeof skillCode==='string'&&/^SKILL_[A-Z_]+$/.test(skillCode)?skillCode:(error as NodeJS.ErrnoException)?.code==='EEXIST'?'TARGET_EXISTS':(error as Error)?.message==='DATA_BUSY'?'LIBRARY_BUSY':(error as Error)?.name==='ZodError'?'INVALID_INPUT':'COMMAND_FAILED';
  const message=known?error.message:code==='TARGET_EXISTS'?'Output already exists.':code==='LIBRARY_BUSY'?'Stop all services using this library and retry.':code==='INVALID_INPUT'?'Input does not match the production schema.':/^(EXPORT_|BACKUP_|SKILL_)/.test((error as Error)?.message||'')?(error as Error).message:'Command failed; check paths, provider configuration and diagnostics.';
  process.stdout.write(JSON.stringify({schemaVersion:1,ok:false,error:{code,message,...(known&&error.details?{details:error.details}:{})}})+'\n');process.exitCode=known?error.exitCode:1;
 }finally{Object.assign(console,saved);}return true;
}
