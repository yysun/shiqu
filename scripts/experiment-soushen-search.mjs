// 在每本书的独立 SQLite 中制备白话检索索引；原文范围沿用拾趣的版本和行号。
import {lstat,mkdir,readFile,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {parseArgs} from 'node:util';
import {Converter} from 'opencc-js';
import {discoveryThemePresets} from '../lib/reader-prompts.ts';
import {rankStoryCardText,storyEmbeddingModel,storyEmbeddingQuery,storySearchKey} from '../server/local-story-search.ts';
import {groundedStoryEvents,storyEventsSchema,storyEventStatuses,storyEventText} from '../server/local-story-events.ts';
import {createCodexRunner} from '../server/codex-runner.ts';
import {LocalBooks} from '../server/local-books.ts';
import {indexBookContents} from '../server/local-book-contents.ts';
import {sourceParts} from '../server/local-source-ranges.ts';
import {boundaryCandidates,layoutStoryStarts,partitionStoryUnits,reconcileBoundaryReviews,semanticBoundaryWindows,validateBoundaryDecisions,validateSemanticStarts} from '../server/local-story-segmentation.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const chatModel='qwen3.5:latest';
const vectorModel=storyEmbeddingModel;
const host='http://127.0.0.1:11434';
const simplified=Converter({from:'t',to:'cn'});
const instruction='你是古文编目员。将各编号原文分别改写为一两句现代简体中文，约35至75字。先写起因，再写关键行动和结果；复杂情节可超过字数。涉及多人时，为每个关键行动写明谁做了什么、对谁做，保留委托、转折、否定和未遂。只复述原文事件，原文没有的信息不补；不用其他版本。不要加评论、寓意或真实性判断；神异情节照录为事件。输出一个 JSON 对象，键为原编号，值为白话摘要字符串。';
const cardVersion=4;
const passageVersion='unit-windows-v1';
const wholeChapterBooks=new Set(['战国策','喻世明言']);
const catalogStoryBooks=new Set(['liaozhai','shishuo','子不语',...wholeChapterBooks]);
const longContextBooks=new Set(['战国策','zhuangzi','列子','子不语','阅微草堂笔记','喻世明言']);
const shortStoryHeading=/^[\p{Script=Han}0-9]{1,12}$/u;

async function request(path,body,timeoutMs=body===undefined?10000:240000){
 const response=await fetch(host+path,body===undefined?{signal:AbortSignal.timeout(timeoutMs)}:{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),
 });
 if(!response.ok)throw Error(`${path} HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
 return response.json();
}

async function modelDigests(names=[chatModel,vectorModel]){
 const {models}=await request('/api/tags');
 return Object.fromEntries(names.map(name=>{
  const model=models.find(item=>item.name===name);
  if(!model?.digest)throw Error(`本机 Ollama 缺少 ${name}`);
  return [name,model.digest];
 }));
}

const boundaryPrompt='独立判断「后」的第一行是不是新条目。先把「前」最后一行与「后」第一行连读：前行若在修饰语、动词、介词或领属词后尚未说完，后行补足它，就必须为 0；同一事件的行动、结果或补注延续也为 0。只有前一条已结束且后一行开启可独立的事件或条目，才为 1。单独的人物品评、事实或议论即使很短，也可以自成一条。人物相同不代表事件相同，人物变化也不代表事件结束。不要从编号推测边界。只输出 JSON 对象，按原编号给整数 0 或 1，不改写原文。';
async function reviewBoundaries(db,candidates,edition,modelDigest,generate){
 const decisions=new Map();
 const load=db.prepare('SELECT decisions FROM boundary_reviews WHERE fingerprint=?');
 const save=db.prepare('INSERT OR IGNORE INTO boundary_reviews VALUES (?,?)');
 for(let offset=0;offset<candidates.length;offset+=8){
  const batch=candidates.slice(offset,offset+8);
  const key=createHash('sha256').update(JSON.stringify([edition,modelDigest,boundaryPrompt,batch])).digest('hex');
  const cached=load.get(key);
  let value;
  if(cached)value=JSON.parse(cached.decisions);
  else{
   const input=Object.fromEntries(batch.map(({before,after},i)=>[String(i+1),{前:before,后:after}]));
   const keys=Object.keys(input);
   const format={type:'object',additionalProperties:false,required:keys,
    properties:Object.fromEntries(keys.map(key=>[key,{type:'integer',enum:[0,1]}]))};
   const answer=await generate(boundaryPrompt,JSON.stringify(input),format,keys.length*16+80);
   if(Object.keys(answer).length!==keys.length||keys.some(key=>!Object.hasOwn(answer,key)))throw Error('模型返回的边界编号与输入不一致');
   value=Object.fromEntries(batch.map(({id},index)=>[id,answer[String(index+1)]]));
  }
  for(const [id,decision] of validateBoundaryDecisions(batch,value))decisions.set(id,decision);
  if(!cached)save.run(key,JSON.stringify(value));
  console.error(`已核对 ${offset+batch.length}/${candidates.length} 个边界${cached?'（复用）':''}`);
 }
 return decisions;
}

const semanticBoundaryPrompt='通读这段连续古文，找出新的独立条目从哪一行开始。延续同一事件、同一句、原因行动结果或补注的行都不是起点。多个独立事件即使人物相同也可另起；没有结束的事件不要截断。编号只是定位。前后邻文仅供判断，不可选为起点。只输出 JSON 对象 {"starts":[起始行编号]}，只从可选编号中选择，无起点用空数组。';
async function readSemanticBoundaries(db,sections,edition,modelDigest,generate){
 const windows=semanticBoundaryWindows(sections),decisions=new Map();
 const load=db.prepare('SELECT decisions FROM boundary_reviews WHERE fingerprint=?');
 const save=db.prepare('INSERT OR IGNORE INTO boundary_reviews VALUES (?,?)');
 for(const [index,window] of windows.entries()){
  const key=createHash('sha256').update(JSON.stringify([edition,modelDigest,semanticBoundaryPrompt,window])).digest('hex');
  const cached=load.get(key);
  let starts;
  if(cached)starts=JSON.parse(cached.decisions);
  else{
   const choices=window.units.flatMap(({id},i)=>window.ids.includes(id)?[i+1]:[]);
   const format={type:'object',additionalProperties:false,required:['starts'],properties:{
    starts:{type:'array',items:{type:'integer',enum:choices}},
   }};
   const input={前文:window.before,原文:window.units.map(({text},i)=>[i+1,text]),后文:window.after,可选编号:choices};
   const answer=await generate(semanticBoundaryPrompt,JSON.stringify(input),format,choices.length*5+70);
   if(!Array.isArray(answer.starts)||answer.starts.some(i=>!choices.includes(i)))throw Error('模型返回了窗口之外的边界编号');
   starts=answer.starts.map(i=>window.units[i-1].id);
  }
  for(const [id,decision] of validateSemanticStarts(window.ids,starts))decisions.set(id,decision);
  if(!cached)save.run(key,JSON.stringify(starts));
  console.error(`已读 ${index+1}/${windows.length} 个原文窗口${cached?'（复用）':''}`);
 }
 return decisions;
}

// CHANT 和 TLS 的分节编号是排版提示，只有逐段与本地原文对齐时才采用。
function editorialStoryStarts(units,raw){
 const heading=/^\*\* \d+ .+$/m.exec(raw);
 if(!heading)return undefined;
 const blocks=raw.slice(heading.index+heading[0].length).split(/^# src: (?:ZHUANG|Liezi) (\d+\.\d+\.\d+)[^\n]*$/gmi);
 if(blocks.length===1)return undefined;
 const paragraphs=[],starts=[units[0].id];
 for(let index=0;index<blocks.length;index+=2){
  const text=blocks[index].replace(/^#.*$/gm,'').replace(/<pb:[^>]+>|¶/g,'');
  const parts=text.split(/\n\s*\n/).map(part=>part.split('\n').map(line=>line.trim()).join('')).filter(Boolean);
  if(parts.length&&paragraphs.length&&blocks[index-1]?.endsWith('.1')&&units[paragraphs.length])
   starts.push(units[paragraphs.length].id);
  paragraphs.push(...parts);
 }
 return paragraphs.length===units.length&&paragraphs.every((text,index)=>text===units[index].text)?starts:undefined;
}

async function segmentBook(db,bookId,modelDigest,{sectionFilter,generate=chatObject}={}){
 const books=new LocalBooks(root),book=await books.book({bookId});
 if(!book)throw Error('找不到本地书籍 '+bookId);
 const {books:catalog}=JSON.parse(await readFile(resolve(root,'data/library/catalog.json'),'utf8'));
 const catalogEntry=catalog.find(entry=>entry.id===book.id);
 const sections=[];
 for(const [index,section] of book.sections.entries()){
  if(sectionFilter&&sectionFilter!==section.id&&sectionFilter!==section.title)continue;
  let layoutStarts=book.id==='阅微草堂笔记'?section.units.map(unit=>unit.id):undefined;
  if(catalogEntry?.format==='kanripo-text'&&section.url){
   const file=new URL(section.url).pathname.split('/').at(-1);
   if(catalogEntry.originalFiles?.some(original=>original.file===file)){
    const raw=await readFile(resolve(root,'data/library',catalogEntry.originalFile,file),'utf8');
    const lines=raw.split(/\r?\n/).filter(line=>!line.startsWith('#'))
     .map(line=>line.replace(/<pb:[^>]+>|¶/g,'')).filter(line=>line.trim());
    layoutStarts=editorialStoryStarts(section.units,raw)??layoutStoryStarts(section.units,lines);
   }
  }
  sections.push({...section,layoutStarts,volume:index+1});
 }
 if(!sections.length)throw Error('找不到指定篇章 '+sectionFilter);
 const candidates=boundaryCandidates(sections);
 const initial=await readSemanticBoundaries(db,sections,book.edition,modelDigest,generate);
 if(initial.size!==candidates.length)throw Error('语义窗口未覆盖全部原文边界');
 const conflicts=candidates.filter(({id,layout,openClause})=>
  layout==='unknown'||initial.get(id)!==(layout==='start')||(openClause&&initial.get(id)));
 const reviewed=await reviewBoundaries(db,conflicts,book.edition,modelDigest,generate);
 const decisions=reconcileBoundaryReviews(initial,conflicts,reviewed);
 // 阅微的完整原版段落各自成则；相邻主题相似也不合并。
 if(book.id==='阅微草堂笔记')for(const {id,before,layout} of candidates){
  if(layout==='start'&&/[。！？][」』）”’]*$/u.test(before.trim()))decisions.set(id,true);
 }
 const partitions=partitionStoryUnits(sections,decisions);
 const entries=[];
 const save=db.prepare(`INSERT OR REPLACE INTO boundary_plans
  (book_id,edition,section_id,strategy,model_digest,ranges) VALUES (?,?,?,?,?,?)`);
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const [index,partition] of partitions.entries()){
   const section=sections[index],ranges=[];
   for(const units of partition.groups){
    const source={edition:book.edition,sectionId:section.id,firstUnit:units[0].id,lastUnit:units.at(-1).id};
    const text=units.map(unit=>unit.text).join('');
    const entry={id:source.firstUnit,volume:section.volume,label:section.title,url:section.url||book.url,
     source:JSON.stringify(source),text,units,blocked:null};
    try{books.resolve(book,source);}catch(error){entry.blocked=error.message;}
    entries.push(entry);
    ranges.push({source,blocked:entry.blocked});
   }
   save.run(book.id,book.edition,section.id,'semantic',modelDigest,JSON.stringify(ranges));
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {entries,edition:book.edition,candidates:candidates.length,reviewedConflicts:conflicts.length,joins:candidates.filter(({id,layout})=>layout==='start'&&decisions.get(id)===false).map(({id})=>id)};
}

function normalize(vector){
 if(!Array.isArray(vector)||!vector.length||vector.some(value=>!Number.isFinite(value)))throw Error('向量格式无效');
 const norm=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));
 if(!norm)throw Error('收到零向量');
 return Float32Array.from(vector,value=>value/norm);
}

async function embed(texts,query=false,truncate=false){
 const input=query?texts.map(storyEmbeddingQuery):texts;
 const {embeddings}=await request('/api/embed',{model:vectorModel,input,truncate,keep_alive:'10m',
  options:{num_ctx:longContextBooks.has(indexedBookId)?4096:2048}});
 if(embeddings?.length!==texts.length)throw Error('向量条数不符');
 return embeddings.map(normalize);
}

async function codexJsonGenerator(model){
 const runner=createCodexRunner({...process.env,CODEX_MODEL:model});
 const status=await runner.status();
 if(!status.configured)throw Error(status.reason||'请先登录 Codex 订阅');
 return async (system,user,schema)=>{
  const result=await runner.run({model,reasoningEffort:'low',instructions:system,prompt:user,schema});
  return JSON.parse(result.text);
 };
}

async function cardGenerator(model,identity){
 const codex=model.startsWith('gpt-');
 const deepseek=model==='deepseek-flash';
 const digests=await modelDigests(codex||deepseek?[vectorModel]:[vectorModel,model]);
 if(identity.digests?.[vectorModel]!==digests[vectorModel])throw Error('故事卡必须使用原索引的向量模型');
 if(codex)return codexJsonGenerator(model);
 if(deepseek){
  const key=process.env.DEEPSEEK_API_KEY?.trim();
  if(!key)throw Error('请通过 DEEPSEEK_API_KEY 配置 DeepSeek');
  return async (system,user,_schema,maxTokens)=>{
   const response=await fetch('https://api.deepseek.com/chat/completions',{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    redirect:'error',signal:AbortSignal.timeout(90000),
    body:JSON.stringify({model,thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:maxTokens,
     messages:[{role:'system',content:system+' JSON 格式示例：{"1":"这里是第一篇的摘要"}。'},{role:'user',content:user}]}),
   });
   if(!response.ok){await response.body?.cancel();throw Error('DeepSeek API HTTP '+response.status);}
   const {choices}=await response.json(),result=choices?.[0];
   if(result?.finish_reason!=='stop')throw Error('DeepSeek 摘要没有完整返回');
   return JSON.parse(result.message.content);
  };
 }
 return (system,user,schema,maxTokens)=>chatObject(system,user,schema,maxTokens,model);
}

async function cards(rows,generate){
 const keys=rows.map((_,index)=>String(index+1));
 const format={type:'object',additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(key=>[key,{type:'string'}]))};
 const input=Object.fromEntries(keys.map((key,index)=>{
  const {text,label}=rows[index];
  return [key,indexedBookId==='喻世明言'?{篇名:simplified(label),原文:simplified(text)}:simplified(text)];
 }));
 const output=await generate(cardInstruction,
  '要输出 '+rows.length+' 张，JSON 必须包含全部编号 '+keys.join('、')+'。原文：'+JSON.stringify(input),
  format,rows.length*125+50);
 const parsed=keys.flatMap((key,index)=>{
  const value=output[key];
  if(typeof value!=='string')return [];
  const summary=simplified(value.trim());
  if(summary.length<8||summary.length>(indexedBookId==='喻世明言'?420:230))return [];
  const title=Array.from(summary.split(/[，。！？；：]/u,1)[0]).slice(0,22).join('');
  if(!title)return [];
  return [{id:rows[index].id,title,summary}];
 });
 if(!parsed.length)throw Error('模型结果缺少有效故事卡：'+JSON.stringify(output).slice(0,240));
 return parsed;
}

function stats(db){
 return db.prepare(`SELECT volume, count(*) AS entries, count(title) AS cards, count(vector) AS searchable,
  count(raw_vector) AS rawIndexed,count(COALESCE(vector,raw_vector)) AS available,count(blocked) AS blocked FROM entries GROUP BY volume ORDER BY volume`).all();
}

function total(rows){
 return rows.reduce((sum,row)=>{
  for(const key of Object.keys(sum))sum[key]+=row[key];
  return sum;
 },{entries:0,cards:0,searchable:0,rawIndexed:0,available:0,blocked:0});
}

// 子不语的独立篇名已是本地原文单元，范围从篇名到下一篇前。
function namedStoryEntries(books,book,volume){
 return book.sections.flatMap((section,index)=>{
  if(volume!==undefined&&volume!==index+1)return [];
  const starts=section.units.flatMap((unit,i)=>shortStoryHeading.test(unit.text)?[i]:[]);
  if(starts[0]!==0)throw Error('未找到卷首篇名 '+section.id);
  return starts.map((first,i)=>{
   const units=section.units.slice(first,starts[i+1]),id=units[0].id;
   const source={edition:book.edition,sectionId:section.id,firstUnit:id,lastUnit:units.at(-1).id};
   let blocked=null;
   try{books.resolve(book,source);}catch(error){blocked=error.message;}
   return {id,volume:index+1,label:section.title,url:section.url||book.url,source:JSON.stringify(source),
    text:units.map(unit=>unit.text).join(''),units,blocked};
  });
 });
}

// 复用正式故事目录；以整篇或整卷制卡时仍核对完整原文范围。
function catalogEntries(book,volume){
 const books=new LocalBooks(root);
 if(book.id==='子不语')return namedStoryEntries(books,book,volume);
 const chapterIsStory=wholeChapterBooks.has(book.id);
 const volumes=new Map(book.sections.map((section,index)=>[section.id,index+1]));
 const sectionsByUnit=new Map(book.id==='shishuo'?book.sections.flatMap(section=>section.units.map(unit=>[unit.id,section.id])):[]);
 return indexBookContents(books,book).entries.flatMap(entry=>{
  const sectionId=entry.source?.sectionId??sectionsByUnit.get(entry.id);
  const entryVolume=volumes.get(sectionId);
  if((entry.kind!=='story'&&!chapterIsStory)||!sectionId||(volume!==undefined&&entryVolume!==volume))return [];
  const source=entry.source??{edition:book.edition,sectionId,firstUnit:entry.id,lastUnit:entry.id};
  const {section,units}=sourceParts(book,source)[0];
  let blocked=null;
  if(!entry.source||chapterIsStory){
   try{books.resolve(book,source);}catch(error){blocked=error.message;}
  }
  return [{id:entry.id,volume:entryVolume,label:section.title,url:section.url||book.url,
   source:JSON.stringify(source),text:units.map(unit=>unit.text).join(''),units,blocked}];
 });
}

async function build(db,{volume,boundaryModel}={}){
 const digests=await modelDigests();
 const edition=selectedBook.edition;
 const boundaryDigest=boundaryModel?`codex:${boundaryModel}:low`:digests[chatModel];
 const identity=JSON.stringify({edition,digests,prompt:createHash('sha256').update(cardInstruction).digest('hex'),version:cardVersion,
  ...(boundaryModel?{boundaryModel:boundaryDigest}:{})});
 db.prepare("INSERT OR IGNORE INTO metadata VALUES ('identity',?)").run(identity);
 const existing=db.prepare("SELECT value FROM metadata WHERE key='identity'").get();
 if(existing.value!==identity)throw Error('此索引的原文、模型或制卡契约有变更。请使用独立工作树重建索引。');
 const entries=catalogStoryBooks.has(indexedBookId)?catalogEntries(selectedBook,volume):
  (await segmentBook(db,indexedBookId,boundaryDigest,{
   sectionFilter:volume===undefined?undefined:selectedBook.sections[volume-1].id,
   generate:boundaryModel?await codexJsonGenerator(boundaryModel):chatObject,
  })).entries;
 if(!entries.length)throw Error('没有找到可索引的原文篇目');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare("INSERT OR IGNORE INTO metadata VALUES ('indexed_book',?)").run(indexedBookId);
  const remove=db.prepare('DELETE FROM entries WHERE id=?');
  const activeIds=new Set(entries.map(row=>row.id));
  const previous=db.prepare('SELECT id FROM entries WHERE ? IS NULL OR volume=?').all(volume??null,volume??null);
  for(const {id} of previous)if(!activeIds.has(id))remove.run(id);
  const upsert=db.prepare(`INSERT INTO entries(id,volume,label,url,source,text,blocked) VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET source=excluded.source,text=excluded.text,blocked=excluded.blocked,
   title=NULL,summary=NULL,vector=NULL,raw_vector=NULL
   WHERE entries.source IS NOT excluded.source OR entries.text IS NOT excluded.text OR entries.blocked IS NOT excluded.blocked`);
  for(const row of entries)upsert.run(row.id,row.volume,row.label,row.url,row.source,row.text,row.blocked);
  const oldPassages=db.prepare("SELECT value FROM metadata WHERE key='passage_version'").get();
  if(oldPassages?.value!==passageVersion){
   db.exec('DELETE FROM passages');
   db.prepare("INSERT OR REPLACE INTO metadata VALUES ('passage_version',?)").run(passageVersion);
  }
  const stale=db.prepare('DELETE FROM passages WHERE story_id=? AND source_range<>?');
  const addPassage=db.prepare(`INSERT OR IGNORE INTO passages(story_id,first_unit,last_unit,source_range,text) VALUES (?,?,?,?,?)`);
  for(const row of entries){
   stale.run(row.id,row.source);
   if(row.blocked||row.units.length<5)continue;
   const width=4,step=2;
   for(let offset=0;offset<row.units.length-width+step;offset+=step){
    const part=row.units.slice(offset,offset+width);
    addPassage.run(row.id,part[0].id,part.at(-1).id,row.source,part.map(unit=>unit.text).join(''));
   }
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 console.log('已核对条目和原文范围',JSON.stringify(total(stats(db))));
 const rows=db.prepare('SELECT id,text FROM entries WHERE raw_vector IS NULL AND blocked IS NULL AND (? IS NULL OR volume=?) ORDER BY id').all(volume??null,volume??null);
 const save=db.prepare('UPDATE entries SET raw_vector=? WHERE id=?');
 for(let offset=0;offset<rows.length;offset+=24){
  const batch=rows.slice(offset,offset+24);
  // 长话本的开头向量只用于补充召回，完整情节由摘要和覆盖全卷的片段向量检索。
  const vectors=await embed(batch.map(row=>row.text),false,indexedBookId==='liaozhai'||indexedBookId==='喻世明言');
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [index,row] of batch.entries())save.run(new Uint8Array(vectors[index].buffer),row.id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(`已写入 ${offset+batch.length}/${rows.length} 条原文向量`);
 }
 const passages=db.prepare('SELECT story_id,first_unit,passages.text FROM passages JOIN entries ON entries.id=passages.story_id WHERE passages.vector IS NULL AND (? IS NULL OR entries.volume=?) ORDER BY story_id,first_unit').all(volume??null,volume??null);
 const savePassage=db.prepare('UPDATE passages SET vector=? WHERE story_id=? AND first_unit=? AND vector IS NULL');
 for(let offset=0;offset<passages.length;offset+=32){
  const batch=passages.slice(offset,offset+32),vectors=await embed(batch.map(row=>row.text),false,indexedBookId==='liaozhai');
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [index,row] of batch.entries())savePassage.run(new Uint8Array(vectors[index].buffer),row.story_id,row.first_unit);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(`已写入 ${offset+batch.length}/${passages.length} 段事件向量`);
 }
 console.log(JSON.stringify({...total(stats(db)),passages:db.prepare('SELECT count(vector) AS count FROM passages').get().count}));
}

// 复用已经制备的原文范围，只补缺卡。摘要生成模型可换，向量模型必须和现有索引一致。
async function buildCards(db,{pilot=false,model=chatModel,volume,ids=[],defaultBatch=8}={}){
 const identity=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value||'null');
 if(!identity?.edition)throw Error('请先用 build --raw 制备原文索引');
 const eligible=db.prepare('SELECT id,volume,source,text,label,vector IS NOT NULL AS hasCard,raw_vector IS NOT NULL AS hasRaw FROM entries WHERE blocked IS NULL ORDER BY volume<>11,volume,id').all();
 const selected=ids.length?eligible.filter(row=>ids.includes(row.id)):volume===undefined?eligible:eligible.filter(row=>row.volume===volume);
 if(!selected.length||ids.some(id=>!selected.some(row=>row.id===id)))throw Error('找不到指定卷或条目，或原文未通过出处校验');
 if(pilot){
  const cases=await evaluationCases();
  const priority=new Set(cases.map(item=>item.expected));
  for(const row of selected){if(priority.size>=30)break;priority.add(row.id);}
  selected.splice(0,selected.length,...selected.filter(row=>priority.has(row.id)));
 }
 const pending=selected.filter(row=>!row.hasCard);
 console.log(JSON.stringify({model,selected:selected.length,skipped:selected.length-pending.length,pending:pending.length}));
 if(!pending.length)return;
 if(pending.some(row=>!row.hasRaw))throw Error('所选条目尚未完成原文索引，请先运行 build --raw');
 const generate=await cardGenerator(model,identity);
 const titles=indexedBookId==='子不语'
  ?new Map(selectedBook.sections.flatMap(section=>section.units.filter(unit=>shortStoryHeading.test(unit.text)).map(unit=>[unit.id,unit.text])))
  :indexedBookId==='liaozhai'||wholeChapterBooks.has(indexedBookId)
   ?new Map(indexBookContents(new LocalBooks(root),selectedBook).entries.map(entry=>[entry.id,entry.title])):new Map();
 const statement=db.prepare(`UPDATE entries SET title=?,summary=?,vector=?
  WHERE id=? AND source=? AND text=? AND vector IS NULL AND raw_vector IS NOT NULL AND blocked IS NULL`);
 const hasCard=db.prepare('SELECT 1 FROM entries WHERE id=? AND source=? AND text=? AND vector IS NOT NULL');
 const byId=new Map(pending.map(row=>[row.id,row]));
 const remaining=pending.length;
 if(indexedBookId==='喻世明言')defaultBatch=1;
 else if(indexedBookId==='子不语'||indexedBookId==='阅微草堂笔记')defaultBatch=12;
 let batchSize=defaultBatch,done=0;
 while(pending.length){
  const batch=pending.slice(0,batchSize);
  if(indexedBookId==='liaozhai'&&!model.startsWith('gpt-')){
   let characters=0;
   const overflow=batch.findIndex((row,index)=>(characters+=row.text.length)>5200&&index>0);
   if(overflow>0)batch.length=overflow;
  }
  const start=performance.now();
  try{
   const result=await cards(batch,generate);
   const vectors=await embed(result.map(card=>card.summary));
   let written=0;
   db.exec('BEGIN IMMEDIATE');
   try{
    for(const [index,card] of result.entries()){
     const {id,source,text}=byId.get(card.id);
     const {changes}=statement.run(titles.get(id)||card.title,card.summary,new Uint8Array(vectors[index].buffer),id,source,text);
     if(!changes&&!hasCard.get(id,source,text))throw Error('原文范围已变更 '+id);
     written+=changes;
    }
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const ids=new Set(result.map(card=>card.id));
   pending.splice(0,batch.length,...batch.filter(row=>!ids.has(row.id)));
   done+=result.length;
   console.log(`已处理 ${done}/${remaining} 张，本批写入 ${written} 张，${((performance.now()-start)/1000).toFixed(1)} 秒，${batch[0].id}`);
   batchSize=result.length===batch.length?defaultBatch:Math.max(1,Math.floor(batch.length/2));
  }catch(error){
   if(batch.length===1)throw new Error(`条目 ${batch[0].id} 可从断点重跑`,{cause:error});
   batchSize=Math.max(1,Math.floor(batch.length/2));
   console.warn(`批次 ${batch[0].id} 失败，缩小为 ${batchSize} 条重试：${error.message}`);
  }
 }
 console.log(JSON.stringify(total(stats(db))));
}

async function search(db,queries,limit=5,raw=false,withPassages=false,cardsOnly=false){
 const identity=db.prepare("SELECT value FROM metadata WHERE key='identity'").get();
 if(!identity)throw Error('数据库还没有建立索引');
 const expected=JSON.parse(identity.value).digests[vectorModel];
 const {models}=await request('/api/tags');
 if(models.find(item=>item.name===vectorModel)?.digest!==expected)throw Error('当前向量模型与索引版本不同');
 const rows=db.prepare(`SELECT id,label,url,source,text,title,summary,raw_vector,vector FROM entries
  WHERE ${raw?'raw_vector':'COALESCE(vector,raw_vector)'} IS NOT NULL
  ${cardsOnly?'AND title IS NOT NULL AND summary IS NOT NULL':''}`).all()
  .map(({raw_vector,vector,...row})=>({
   ...row,title:row.title||Array.from(row.text).slice(0,16).join(''),
   originalVector:raw_vector&&new Float32Array(raw_vector.slice().buffer),
   cardVector:!raw&&vector&&new Float32Array(vector.slice().buffer),
  }));
 if(!rows.length)throw Error('数据库中没有可搜索的向量');
 const byStory=new Map();
 if(withPassages){
  const version=db.prepare("SELECT value FROM metadata WHERE key='passage_version'").get()?.value;
  if(version!==passageVersion||db.prepare('SELECT 1 FROM passages WHERE vector IS NULL LIMIT 1').get()||
   db.prepare('SELECT 1 FROM entries WHERE raw_vector IS NULL AND blocked IS NULL LIMIT 1').get())throw Error('事件索引未就绪，请运行 build --raw');
  for(const row of db.prepare('SELECT story_id,vector FROM passages WHERE vector IS NOT NULL').all()){
   const passages=byStory.get(row.story_id)||[];
   passages.push(new Float32Array(row.vector.slice().buffer));
   byStory.set(row.story_id,passages);
  }
 }
 const queriesVectors=await embed(queries,true);
 return queries.map((query,index)=>{
  const needle=queriesVectors[index];
  const similarity=vector=>{
   if(!vector)return -Infinity;
   if(vector.length!==needle.length)throw Error('向量维度不符');
   let score=0;
   for(let i=0;i<vector.length;i++)score+=vector[i]*needle[i];
   return score;
  };
  const hits=rows.map(({originalVector,cardVector,...row})=>{
   const originalScore=similarity(originalVector),cardScore=similarity(cardVector);
   let score=Math.max(originalScore,cardScore),representation=cardScore>originalScore?'story-card':'original';
   for(const passage of byStory.get(row.id)||[]){
    const passageScore=similarity(passage);
    if(passageScore>score){score=passageScore;representation='passage';}
   }
   return {...row,source:JSON.parse(row.source),score,representation};
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
  return {query,searchable:rows.length,hits};
 });
}

// 对照模式只给共享排名函数传轻量卡文本。
function searchCardText(db,queries,limit){
 const rows=db.prepare('SELECT id,label,url,source,title,summary FROM entries WHERE blocked IS NULL AND title IS NOT NULL AND summary IS NOT NULL').all()
  .map(row=>({id:row.id,card:row,title:storySearchKey(row.title),summary:storySearchKey(row.summary)}));
 return queries.map(query=>{
  const phrase=storySearchKey(listQuery(query)?listTopic(query):query);
  const hits=rankStoryCardText(rows,phrase,limit).map(({row:{card},score,representation})=>({
   ...card,source:JSON.parse(card.source),score,representation,
  }));
  return {query,searchable:rows.length,hits};
 });
}

// 短主题的扩写只增加一条语义召回路，原查询始终独立保留。
async function expandLightQueries(results){
 const expansions=results.map(()=>[]);
 const pending=results.flatMap(({query,hits},index)=>{
  const phrase=storySearchKey(listTopic(query));
  return phrase&&Array.from(phrase).length<=12&&hits[0]?.representation!=='title-exact'?[{index,query}]:[];
 });
 const system='你是古籍故事检索的查询改写器。把每条短主题或短情节改写成一至两句能够在故事梗概中直接观察到的现代中文行动描述，每句6至45字。保留否定、未遂、先后、因果和主体等所有条件。主题宽泛时，第一句只写主题成立所必需的事实，第二句换说法并保持同样的成立条件。不要加上原查询没有的角色身份、动机细节、障碍、手段、伴随场景或成败结局。明显是篇名、人名或无法可靠展开时给空数组。不回答用户，也不生成示例故事。只输出JSON，键为输入编号，值为描述字符串数组。';
 for(let offset=0;offset<pending.length;offset+=4){
  const batch=pending.slice(offset,offset+4);
  const queries=Object.fromEntries(batch.map(({index,query})=>[String(index+1),query]));
  const schema=jsonObject(Object.fromEntries(Object.keys(queries).map(key=>[key,{type:'array',maxItems:2,items:{type:'string'}}])));
  try{
   const output=await chatObject(system,JSON.stringify(queries),schema,batch.length*150+60,chatModel,15000);
   for(const {index,query} of batch){
    const proposed=output[String(index+1)];
    if(!Array.isArray(proposed))continue;
    const seen=new Set([storySearchKey(query),storySearchKey(listTopic(query))]);
    for(const value of proposed.slice(0,2)){
     if(typeof value!=='string')continue;
     const text=value.trim(),length=Array.from(text).length,key=storySearchKey(text);
     if(!key||length<6||length>45||seen.has(key))continue;
     seen.add(key);
     expansions[index].push(text);
    }
   }
  }catch(error){
   console.warn(`查询展开失败，继续使用原查询检索：${error.name==='TimeoutError'?'超时':error.message}`);
  }
 }
 return expansions;
}

async function searchLightCards(db,queries,limit=5,{textOnly=false,expand=true}={}){
 if(textOnly)return searchCardText(db,queries,limit);
 const lexical=searchCardText(db,queries,42);
 const expansions=expand?await expandLightQueries(lexical):queries.map(()=>[]);
 const semantic=await search(db,[...new Set([...queries,...expansions.flat()])],42,false,false,true);
 const byQuery=new Map(semantic.map(({query,hits})=>[query,hits]));
 return lexical.map((result,index)=>{
  const merged=new Map();
  const add=(hit,channel,rank,weight=1)=>{
   const {id,title,summary,source,label,url,representation}=hit;
   const entry=merged.get(id)||{id,title,summary,source,label,url,score:0,textRank:null,vectorRank:null,expandedRank:null};
   entry[channel+'Rank']=rank;
   entry[channel+'Match']=representation;
   entry.score+=weight/(20+rank);
   merged.set(id,entry);
  };
  result.hits.forEach((hit,i)=>add(hit,'text',i+1));
  byQuery.get(result.query).forEach((hit,i)=>add(hit,'vector',i+1));
  const bestExpanded=new Map();
  for(const query of expansions[index])byQuery.get(query).forEach((hit,i)=>{
   const rank=i+1;
   if(rank<(bestExpanded.get(hit.id)?.rank??Infinity))bestExpanded.set(hit.id,{hit,rank});
  });
  // 两条扩写可能同义，每篇只取其最佳扩写排名，防止重复加权。
  const expansionCandidates=[];
  for(const {hit,rank} of [...bestExpanded.values()].sort((a,b)=>a.rank-b.rank||a.hit.id.localeCompare(b.hit.id))){
   if(merged.has(hit.id))add(hit,'expanded',rank,0.2);
   else if(rank<=5&&expansionCandidates.length<3){
    const {id,title,summary,source,label,url}=hit;
    expansionCandidates.push({id,title,summary,source,label,url,expandedRank:rank});
   }
  }
  const exact=entry=>Number(entry.textMatch==='title-exact');
  const hits=[...merged.values()].sort((a,b)=>exact(b)-exact(a)||b.score-a.score||a.id.localeCompare(b.id))
   .slice(0,limit).map(entry=>({...entry,representation:['text','vector','expanded'].filter(channel=>entry[channel+'Rank']).join('+')}));
  return {...result,expansions:expansions[index],hits,expansionCandidates};
 });
}

// 列举类查询先扩大召回，再逐篇核对行动和原文证据。
const listQuery=query=>/^(?:请|帮我|请帮我)?\s*(?:列(?:一[下列]|出|举)|举(?:几|一[些个])|找(?:出)?(?:一些|所有|几篇|几个|几则))/u.test(query)||
 /有哪(?:些|几)|哪(?:些|几).*故事/u.test(query);
function listTopic(query){
 const topic=query.replace(/^(?:请|帮我|请帮我)?\s*(?:列一下|列出|列举|列一列|举几个|找一些|找出所有|找几篇|有哪些)\s*/u,'')
  .replace(/(?:相关|有关|的)?(?:故事|情节|例子)(?:都)?(?:有哪些|有哪几篇)?[？?。！!\s]*$/u,'').trim();
 return topic||query;
}
const queryPlanFormat={type:'object',additionalProperties:false,required:['intent','anchors'],properties:{
 intent:{type:'string'},anchors:{type:'array',items:{type:'string'},maxItems:10},
}};
const evidenceText=value=>value.normalize('NFKC').replace(/[\p{P}\s]/gu,'');
async function chatObject(system,user,format,maxTokens,model=chatModel,timeoutMs){
 const result=await request('/api/chat',{
  model,format,think:false,stream:false,keep_alive:'10m',
  options:{temperature:0.1,presence_penalty:0,num_ctx:8192,num_predict:maxTokens},
  messages:[{role:'system',content:system},{role:'user',content:user}],
 },timeoutMs);
 const value=JSON.parse(result.message.content.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('模型没有返回 JSON 对象');
 return value;
}

async function listCandidates(db,query){
 const topic=listTopic(query);
 const plan=await chatObject('将用户列举故事的请求改写为便于检索古籍的计划。只输出 JSON：{"intent":"用一句白话具体说明读者要找的情节，保留原条件","anchors":["词语"]}。anchors 写至多10个实际可能出现在古文中的短词或惯用表达，要覆盖古今异词和行动的语境；可用单字，但优先两至四字。不要写故事名、人名或已经知道的答案，不增加原问题没有的限制。',query,queryPlanFormat,300);
 const intent=typeof plan.intent==='string'&&plan.intent.trim()?plan.intent.trim():topic;
 const anchors=[...new Set([topic,...(Array.isArray(plan.anchors)?plan.anchors:[])].filter(value=>typeof value==='string')
  .map(value=>simplified(value.trim())).filter(value=>/^[\p{Script=Han}]{1,10}$/u.test(value)))].slice(0,11);
 const lanes=await search(db,[...new Set([query,topic,intent])],45,false,true);
 const lexical=db.prepare('SELECT id,label,url,source,text,title,summary FROM entries WHERE raw_vector IS NOT NULL').all()
  .map(row=>{
   const text=simplified(row.text);
   const weight=anchors.reduce((total,term)=>total+(text.includes(term)?term.length**2:0),0);
   return {row,weight};
  }).filter(item=>item.weight).sort((a,b)=>b.weight-a.weight||a.row.id.localeCompare(b.row.id)).slice(0,18);
 const merged=new Map();
 function add(row,rank,weight){
  const hit=merged.get(row.id);
  if(hit){hit.rrf+=weight/(20+rank);return;}
  merged.set(row.id,{...row,title:row.title||Array.from(row.text).slice(0,16).join(''),rrf:weight/(20+rank)});
 }
 for(const lane of lanes)lane.hits.forEach((hit,index)=>add(hit,index+1,1));
 lexical.forEach(({row},index)=>add({...row,source:JSON.parse(row.source),representation:'lexical'},index+1,1.35));
 const ranked=[...merged.values()].sort((a,b)=>b.rrf-a.rrf||a.id.localeCompare(b.id));
 const reserved=new Set(lexical.slice(0,12).map(({row})=>row.id));
 for(const row of ranked){if(reserved.size===42)break;reserved.add(row.id);}
 return {query,intent,anchors,searchable:lanes[0].searchable,candidates:ranked.filter(row=>reserved.has(row.id))};
}

async function judgeBatch(query,intent,candidates){
 const keys=candidates.map((_,index)=>String(index+1));
 const rows=candidates.map((row,index)=>[keys[index],simplified(row.text)]);
 const format={type:'object',additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(key=>[key,{type:'string'}]))};
 const prompt='逐条判断古籍原文是否明确满足用户要求，返回 JSON 对象，键为每个原编号。符合时，直接从该条输入复制一段能证明命中的连续原文，约6至60字，值只写原文。若不符合、信息不足或只是背景、头衔、偶然结果，值写空字符串。用户在找某种行动或目的时，原文必须记载有人为该目的实际采取行动；如用户未要求成功，行动未成功也可。故事包含多个事件时，只要其中一个确实满足即可。切勿把标题或别条内容当成本条证据。只输出 JSON。';
 const result=await chatObject(prompt,JSON.stringify({query,intent,原文:Object.fromEntries(rows)}),format,candidates.length*115+100);
 const hits=[],unverified=[];
 for(const [index,[key,text]] of rows.entries()){
  const value=result[key];
  const candidate=candidates[index];
  if(typeof value!=='string'){unverified.push(candidate);continue;}
  const evidence=evidenceText(value.trim());
  if(!evidence||['无','不符合','没有','无关'].includes(evidence))continue;
  if(evidence.length<5||!evidenceText(text).includes(evidence)){unverified.push(candidate);continue;}
  hits.push({...candidate,evidence});
 }
 return {hits,unverified};
}

async function verifyList(query,intent,candidates){
 let result;
 try{result=await judgeBatch(query,intent,candidates);}
 catch(error){
  if(!(error instanceof SyntaxError)&&error.message!=='模型没有返回 JSON 对象')throw error;
  result={hits:[],unverified:candidates};
 }
 if(candidates.length===1)return result;
 const remaining=[];
 for(const candidate of result.unverified){
  const retry=await verifyList(query,intent,[candidate]);
  result.hits.push(...retry.hits);
  remaining.push(...retry.unverified);
 }
 return {hits:result.hits,unverified:remaining};
}

// 逐条检查摘录是否真的证明检索条件，避免把相反的行动当成相近情节。
async function verifyEvidence(query,hits){
 const retained=[],unverified=[];
 for(let offset=0;offset<hits.length;offset+=10){
  const batch=hits.slice(offset,offset+10),keys=batch.map((_,index)=>String(index+1));
  const format={type:'object',additionalProperties:false,required:keys,
   properties:Object.fromEntries(keys.map(key=>[key,{type:'integer',enum:[0,1]}]))};
  const input=Object.fromEntries(batch.map(({evidence},index)=>[keys[index],evidence]));
  const verdicts=await chatObject('检查每段原文证据能否证明用户要找的情节。1 表示证据足以支持，0 表示证据不足。查询指定行动目的时，证据必须支持该目的和实际行为。仅出现相似环境、偶然结果、人物头衔，或目的相反（制止、逃避某事与主动促成该事不同），都给 0。不要从记忆补充信息。只输出按原编号给 0 或 1 的 JSON 对象。',JSON.stringify({query,证据:input}),format,keys.length*10+60);
  for(const [index,hit] of batch.entries()){
   const verdict=verdicts[keys[index]];
   if(verdict===1)retained.push(hit);
   else if(verdict!==0)unverified.push(hit.id);
  }
 }
 return {retained,unverified};
}

async function listStories(db,query,candidatesOnly=false){
 const {candidates,...result}=await listCandidates(db,query);
 if(candidatesOnly)return {...result,hits:candidates.map(({id,title,representation})=>({id,title,representation}))};
 const hits=[],unverified=[];
 for(let offset=0;offset<candidates.length;offset+=10){
  const review=await verifyList(query,result.intent,candidates.slice(offset,offset+10));
  hits.push(...review.hits);
  unverified.push(...review.unverified.map(row=>row.id));
 }
 const checked=await verifyEvidence(query,hits);
 unverified.push(...checked.unverified);
 return {...result,reviewed:candidates.length-unverified.length,unverified,
  hits:checked.retained.sort((a,b)=>b.rrf-a.rrf||a.id.localeCompare(b.id))};
}

// 一篇一张事件卡，原文或制卡契约变化时才重做。
const eventPrompt=`你是古文编目员。读完每篇原文，提取一至四条最有检索价值的事实。用现代简体白话解释文言。先检查原文中的人物对话及因果转折，再提取事件。优先记录被打断的过程、差一点实现的状态和实际后果，略去年龄、出身等背景。片段按原文顺序有重叠，相邻句要连读。
actor 是行动者或经历者，action 是行动或经历，object 是对象；缺失留空。purpose 是角色的目的，outcome 是原文实际结果。计划、险些发生、被打断、失败和成功必须说清楚。若某人的行动使另一人原本将实现的状态中断，必须另列后者的事件，并用白话说明本来会怎样、被什么打断。祈求、预期和随后的实际现象也应分开记录。status 必须为发生、成功、失败、未遂、计划、不明之一。topic 写宽泛概念，terms 写一至六个读者自然使用的白话词或短语，包含恰当的口语近义词。未遂的事实不能用已经发生的标签。evidence 写一至三个原文片段编号，证据由程序按编号取回。
每个事件必须有下列全部键。terms 必须是字符串数组，evidence 必须是数字数组。输出形状示例（内容与输入无关）：{"1":[{"topic":"赶车","actor":"旅客","action":"赶往车站","object":"末班车","purpose":"搭上末班车","outcome":"抵达时末班车已经开走","status":"失败","terms":["赶车","没赶上车"],"evidence":[2,3]}]}。只依据所给原文，找不到有效事件用空数组，只输出 JSON。`;
const eventReviewPrompt=`你是文言文审校。初稿仅供排重，必须回到原文。优先逐条分析「语法线索」中的动作字。垂或将作副词时是即将，紧随其后的字是要发生的动作。例如「病卒垂愈」是病人即将康复，谓语是愈。必须用动作字原义和上下文写清是谁即将做什么。若随后被阻断，另记该事件，说明实际阻断原因。其次补行动之后实际发生、能独立检索的现象。只补初稿未独立记录的事实。找不到遗漏用空数组，每篇最多补两条。用现代简体白话，不猜测原文之外的信息。
事件必须包含全部字段：{"events":[{"topic":"主题","actor":"行动者","action":"行动","object":"对象","purpose":"目的","outcome":"结果","status":"未遂","terms":["读者会输入的检索词","口语近义词"],"evidence":[2,3]}]}。缺失的角色、目的或结果可填空字符串。status 只能是发生、成功、失败、未遂、计划、不明之一。evidence 是支持该事实的原文片段编号数组，不复制文字。只输出 JSON。`;
const jsonObject=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const jsonText=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
const eventFormat=(anchors,maxItems=4)=>({type:'array',maxItems,items:jsonObject({
 topic:jsonText(24,1),actor:jsonText(32),action:jsonText(60,1),object:jsonText(40),purpose:jsonText(60),outcome:jsonText(80),
 status:{type:'string',enum:storyEventStatuses},terms:{type:'array',minItems:1,maxItems:6,items:jsonText(20,1)},
 evidence:{type:'array',minItems:1,maxItems:3,items:{type:'integer',enum:anchors.map((_,i)=>i+1)}},
})});
function eventEvidenceUnits(text){
 const chars=Array.from(text),parts=[];
 for(let i=0;i<chars.length;i+=26){
  parts.push(chars.slice(i,i+48).join(''));
  if(i+48>=chars.length)break;
 }
 return parts;
}
function eventGrammarCues(parts){
 return [...new Map(parts.flatMap((part,index)=>[...part.matchAll(/([垂將将欲幾几未])([\p{Script=Han}])/gu)]
  .map(match=>[match[0],{片段:index+1,词:match[0],动作字:match[2]}]))).values()].slice(0,12);
}
async function buildEvents(db,ids,{reviewOnly=false,codexReview=false}={}){
 const identity=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value||'null');
 const digests=await modelDigests();
 if(identity?.digests?.[vectorModel]!==digests[vectorModel])throw Error('必须先准备同一向量模型的故事索引');
 const source=db.prepare('SELECT id,source,text FROM entries WHERE blocked IS NULL ORDER BY id').all();
 const byId=new Map(source.map(row=>[row.id,row]));
 if(ids.some(id=>!byId.has(id)))throw Error('指定条目不存在或原文未通过校验');
 const selected=ids.length?[...new Set(ids)].map(id=>byId.get(id)):source;
 const reviewer=codexReview?createCodexRunner({}):undefined;
 const status=reviewer&&await reviewer.status();
 if(status&&!status.configured)throw Error('Codex 审校需要已登录的 ChatGPT 订阅');
 const fingerprint=({source,text})=>createHash('sha256').update(JSON.stringify([source,text,eventPrompt,eventReviewPrompt,digests,status?.model||null])).digest('hex');
 const prior=db.prepare('SELECT fingerprint,source_range,events FROM event_cards WHERE story_id=?');
 const rows=selected.filter(row=>prior.get(row.id)?.fingerprint!==fingerprint(row));
 const write=db.prepare(`INSERT OR REPLACE INTO event_cards(story_id,source_range,fingerprint,events,vectors,dimensions) VALUES (?,?,?,?,?,?)`);
 let written=0,failures=[];
 for(let offset=0;offset<rows.length;offset+=2){
  const batch=rows.slice(offset,offset+2);
  try{
   const anchors=batch.map(row=>eventEvidenceUnits(row.text));
   const input=Object.fromEntries(anchors.map((parts,i)=>[String(i+1),parts.map((text,j)=>[j+1,text])]));
   const format=jsonObject(Object.fromEntries(anchors.map((parts,i)=>[String(i+1),eventFormat(parts)])));
   const result=reviewOnly?undefined:await chatObject(eventPrompt,JSON.stringify(input),format,batch.length*950+100);
   const drafted=batch.flatMap((row,i)=>{
    const key=String(i+1),saved=prior.get(row.id);
    const existing=saved?.source_range===row.source?groundedStoryEvents(JSON.parse(saved.events),row.text,storySearchKey):undefined;
    const events=(result&&groundedStoryEvents(result[key],row.text,storySearchKey,anchors[i]))||existing;
    if(events)return [{row,key,events,anchors:anchors[i]}];
    failures.push(row.id);console.error(`事件回执未通过原文编号校验 ${row.id}`);return [];
   });
   if(!drafted.length)continue;
   for(const {row,key,events:initial,anchors} of drafted){
    const reviewInput={原文:input[key],语法线索:eventGrammarCues(anchors),初稿:initial.map(storyEventText)};
    const schema=jsonObject({events:eventFormat(anchors,2)}),prompt=JSON.stringify(reviewInput);
    const review=reviewer?JSON.parse((await reviewer.run({instructions:eventReviewPrompt,prompt,schema,reasoningEffort:'low'})).text):
     await chatObject(eventReviewPrompt,prompt,schema,600);
    const additions=groundedStoryEvents(review.events,row.text,storySearchKey,anchors);
    if(!additions){failures.push(row.id);console.error(`事件复核未通过原文编号校验 ${row.id}`);continue;}
    const events=[...new Map([...additions,...initial].map(event=>[storySearchKey(storyEventText(event)),event])).values()].slice(0,6);
    const vectors=events.length?await embed(events.map(storyEventText)):[];
    const dimensions=vectors[0]?.length||0,packed=new Float32Array(dimensions*vectors.length);
    for(const [j,vector] of vectors.entries()){
     if(vector.length!==dimensions)throw Error('事件向量维度不符');
     packed.set(vector,j*dimensions);
    }
    write.run(row.id,row.source,fingerprint(row),JSON.stringify(events),new Uint8Array(packed.buffer),dimensions);
    written++;
   }
  }catch(error){
   for(const row of batch)if(prior.get(row.id)?.fingerprint!==fingerprint(row))failures.push(row.id);
   console.error(String(error.message).slice(0,180));
  }
  console.error(`已写入 ${written}/${rows.length} 张事件卡`);
 }
 console.log(JSON.stringify({selected:selected.length,generated:written,reused:selected.length-rows.length,failed:[...new Set(failures)]}));
 if(failures.length)process.exitCode=1;
}

// 参考查询离线制备，与故事索引使用同一模型。运行时仅查表。
async function buildReferences(db,extra=[]){
 const identity=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value||'null');
 const digest=identity?.digests?.[vectorModel];
 if(!digest||digest!==(await modelDigests([vectorModel]))[vectorModel])throw Error('必须先准备同一向量模型的故事索引');
 const topics=[...discoveryThemePresets,'爱情','复仇','报恩','升仙','求雨','卖鬼赚钱'];
 const eventTerms=db.prepare(`SELECT c.events FROM event_cards c JOIN entries e ON e.id=c.story_id AND e.source=c.source_range WHERE e.blocked IS NULL`).all()
  .flatMap(row=>storyEventsSchema.parse(JSON.parse(row.events)).flatMap(event=>[event.topic,...event.terms]));
 const queries=new Map();
 for(const query of [...topics,...db.prepare('SELECT DISTINCT title FROM entries WHERE title IS NOT NULL ORDER BY title').all().map(row=>row.title),...eventTerms,...extra]){
  const key=storySearchKey(query);
  if(key&&!queries.has(key))queries.set(key,query);
 }
 const rows=[...queries],vectors=[];
 for(let offset=0;offset<rows.length;offset+=24)vectors.push(...await embed(rows.slice(offset,offset+24).map(([,query])=>query),true));
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare("INSERT OR IGNORE INTO metadata VALUES ('indexed_book',?)").run(indexedBookId);
  db.exec('DELETE FROM query_vectors');
  const write=db.prepare('INSERT INTO query_vectors VALUES (?,?,?,?)');
  for(const [i,[key,query]] of rows.entries())write.run(key,query,digest,new Uint8Array(vectors[i].buffer));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 console.log(JSON.stringify({referenceQueries:rows.length,model:vectorModel}));
}

const evaluationCases=async()=>JSON.parse(await readFile(new URL('../data/evals/story-discovery/soushen-search-queries.json',import.meta.url),'utf8'));
const [mode='stats',...args]=process.argv.slice(2);
const usage='用法：node scripts/experiment-soushen-search.mjs build [--pilot|--raw] [--volume 卷号] [--boundary-model Codex模型] | cards [--model 模型] [--volume 卷号 | 条目编号...] | events [--review] [--codex-review] [条目编号...] | refs [额外查询...] | stats | eval [--raw|--light-cards [--no-expand]|--text-only] | search [--light-cards [--no-expand]|--text-only] <白话问题> | list|candidates <白话问题> | segment <书名> [篇章]。各命令可用 --book <本地书名>，为该书使用独立的制备文件。';
if(mode==='--help'||args.includes('--help')){
 console.log(usage);
 process.exit(0);
}
const bookFlag=args.indexOf('--book');
const bookName=bookFlag<0?'搜神记':args[bookFlag+1];
if(!bookName||bookName.startsWith('--')||bookFlag>=0&&args.lastIndexOf('--book')!==bookFlag)throw Error('--book 需要一个本地书名');
if(bookFlag>=0)args.splice(bookFlag,2);
const selectedBook=await new LocalBooks(root).book({bookId:bookName});
if(!selectedBook)throw Error('找不到本地书籍 '+bookName);
const indexedBookId=selectedBook.id;
const bookCardInstructions={
 shishuo:'保留原文的委托关系。例如“甲使人题字”应写成“甲让人题字”。原文只写拆毁时，结局写到拆毁为止。提交前逐则核对谁下令、谁执行、结局是否有原文依据。',
 战国策:'区分眼前的游说行动与说客引用的故事。用短句保留寓言中的关键动作和结果，例如谁借谁的威势、谁因此逃走。核对施事与受事，保留游说的实际结果。',
 阅微草堂笔记:'区分转述的异闻、当事人亲见和作者事后评论。只写原文交代的结果，保留原文的疑问、推测或未证实之处。',
 喻世明言:'每个输入包含篇名和全卷原文。先找篇名所指的主角及主事件，摘要只写与该主线有因果关系的行动。引子常先完整讲另一个人物的故事，即使相似也全部略去。用约120至190字交代人物关系、关键转折及结局，核对行动顺序及数量（如总数、余数和实际分到的数量）。',
};
const cardInstruction=bookCardInstructions[indexedBookId]?instruction+' '+bookCardInstructions[indexedBookId]:instruction;
const dbPath=bookFlag<0?resolve(root,'.data/soushen-search.sqlite'):resolve(root,'.data/story-index-build',encodeURIComponent(indexedBookId)+'.sqlite');
if(mode==='eval'&&indexedBookId!=='搜神记')throw Error('现有评测题只适用于搜神记');
const textOnly=args.includes('--text-only'),lightCards=args.includes('--light-cards')||textOnly;
const expand=!args.includes('--no-expand');
const queryArgs=['search','eval'].includes(mode)?args.filter(arg=>!['--text-only','--light-cards','--no-expand'].includes(arg)):args;
if(!expand&&(!['search','eval'].includes(mode)||!args.includes('--light-cards')))
 throw Error('--no-expand 只能与 --light-cards 一起使用');
if(['search','eval'].includes(mode)&&lightCards&&(args.includes('--raw')||textOnly&&args.includes('--light-cards')))
 throw Error('每次只能选择一种检索模式');
let buildOptions;
if(mode==='build'){
 const {values}=parseArgs({args,options:{raw:{type:'boolean'},pilot:{type:'boolean'},volume:{type:'string'},'boundary-model':{type:'string'}}});
 const volume=values.volume===undefined?undefined:Number(values.volume);
 if(volume!==undefined&&(!/^[0-9]+$/.test(values.volume)||!Number.isSafeInteger(volume)||volume<1||volume>selectedBook.sections.length))throw Error('--volume 必须是本书有效的卷号');
 const boundaryModel=values['boundary-model'];
 if(boundaryModel!==undefined&&(!/^gpt-[a-zA-Z0-9._-]{1,96}$/.test(boundaryModel)||catalogStoryBooks.has(indexedBookId)))
  throw Error('--boundary-model 只适用于语义切分，须指定 Codex 的 gpt-* 模型');
 buildOptions={volume,raw:values.raw,pilot:values.pilot,boundaryModel};
}
let cardOptions;
if(mode==='cards'){
 const {values,positionals}=parseArgs({args,allowPositionals:true,options:{model:{type:'string',default:chatModel},volume:{type:'string'}}});
 const volume=values.volume===undefined?undefined:Number(values.volume);
 if(volume!==undefined&&(!/^[0-9]+$/.test(values.volume)||!Number.isSafeInteger(volume)||volume<1||positionals.length))
  throw Error('--volume 需要正整数，且不能与条目编号同时指定');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(values.model))throw Error('模型名称无效');
 cardOptions={model:values.model,volume,ids:[...new Set(positionals)]};
}
if(!['build','cards','stats','search','list','candidates','eval','segment','refs','events'].includes(mode)||['search','list','candidates'].includes(mode)&&!queryArgs.join(' ').trim()){
 console.error(usage);
 process.exit(2);
}
// 实验只能打开当前工作树内专用的 SQLite 文件；验证旧文件后才允许打开写连接。
async function openSearchDatabase(write){
 const directory=dirname(dbPath);
 if(write)await mkdir(directory,{recursive:true});
 if(await realpath(directory)!==directory)throw Error('实验数据库目录不能指向其他位置');
 let info;
 try{info=await lstat(dbPath);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(info){
  if(!info.isFile()||info.nlink!==1)throw Error('实验数据库必须是单独的普通文件');
  const existing=new DatabaseSync(dbPath,{readOnly:true});
  try{
   existing.exec('PRAGMA busy_timeout=5000');
   const tables=existing.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   if(tables.some(({name})=>!['metadata','entries','passages','boundary_reviews','boundary_plans','query_vectors','event_cards'].includes(name)))throw Error('该文件不是拾趣离线故事索引');
  }finally{existing.close();}
 }
 return new DatabaseSync(dbPath,{readOnly:!write});
}
const write=['build','cards','segment','refs','events'].includes(mode);
const db=await openSearchDatabase(write);
try{
 if(write){
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS entries(
   id TEXT PRIMARY KEY,volume INTEGER NOT NULL,label TEXT NOT NULL,url TEXT NOT NULL,source TEXT NOT NULL,text TEXT NOT NULL,
   blocked TEXT,title TEXT,summary TEXT,vector BLOB,raw_vector BLOB,
   CHECK ((title IS NULL AND summary IS NULL AND vector IS NULL) OR (title IS NOT NULL AND summary IS NOT NULL AND vector IS NOT NULL)),
   CHECK (blocked IS NULL OR (vector IS NULL AND raw_vector IS NULL))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS passages(
   story_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
   first_unit TEXT NOT NULL,last_unit TEXT NOT NULL,source_range TEXT NOT NULL,text TEXT NOT NULL,vector BLOB,
   PRIMARY KEY(story_id,first_unit)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS boundary_reviews(fingerprint TEXT PRIMARY KEY,decisions TEXT NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS boundary_plans(
   book_id TEXT NOT NULL,edition TEXT NOT NULL,section_id TEXT NOT NULL,strategy TEXT NOT NULL,
   model_digest TEXT NOT NULL,ranges TEXT NOT NULL,PRIMARY KEY(book_id,edition,section_id,strategy)
  ) STRICT;`);
  db.exec(`CREATE TABLE IF NOT EXISTS query_vectors(
   key TEXT PRIMARY KEY,query TEXT NOT NULL,model_digest TEXT NOT NULL,vector BLOB NOT NULL) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS event_cards(
   story_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,source_range TEXT NOT NULL,fingerprint TEXT NOT NULL,
   events TEXT NOT NULL,vectors BLOB NOT NULL,dimensions INTEGER NOT NULL CHECK(dimensions>=0)) STRICT`);
  if(mode==='events')await buildEvents(db,args.filter(arg=>!['--review','--codex-review'].includes(arg)),
   {reviewOnly:args.includes('--review'),codexReview:args.includes('--codex-review')});
  else if(mode==='refs')await buildReferences(db,args);
  else if(mode==='cards')await buildCards(db,cardOptions);
  else if(mode==='build'){
   await build(db,buildOptions);
   if(!buildOptions.raw)await buildCards(db,{pilot:buildOptions.pilot,volume:buildOptions.volume,defaultBatch:10});
  }
  else{
   const [bookId,sectionFilter]=args.filter(arg=>arg!=='--all');
   if(!bookId)throw Error('请指定本地书名');
   if(bookFlag>=0&&(await new LocalBooks(root).book({bookId}))?.id!==indexedBookId)throw Error('切分的书籍必须与 --book 一致');
   const digests=await modelDigests([chatModel]);
   const result=await segmentBook(db,bookId,digests[chatModel],{sectionFilter});
   console.log(JSON.stringify({...result,entries:result.entries.map(({id,label,source,blocked})=>({id,label,source:JSON.parse(source),blocked}))},null,2));
  }
 }else if(mode==='stats'){
  const rows=stats(db);
  const blocked=db.prepare('SELECT id,label,blocked FROM entries WHERE blocked IS NOT NULL ORDER BY id').all();
  console.log(JSON.stringify({dbPath,total:total(rows),volumes:rows,blocked,integrity:db.prepare('PRAGMA quick_check').get().quick_check},null,2));
 }else if(['search','list','candidates'].includes(mode)){
  const query=queryArgs.join(' ').trim();
  const result=mode==='search'&&lightCards?(await searchLightCards(db,[query],5,{textOnly,expand}))[0]:
   mode!=='search'||listQuery(query)?await listStories(db,query,mode==='candidates'):(await search(db,[query]))[0];
  console.log(JSON.stringify(result,null,2));
 }else{
  const cases=await evaluationCases();
  const queries=cases.map(item=>item.query);
  const results=lightCards?await searchLightCards(db,queries,10,{textOnly,expand}):await search(db,queries,10,args.includes('--raw'));
  const output=results.map(({query,searchable,hits,expansions},index)=>{
   const expected=cases[index].expected;
   const rank=hits.findIndex(hit=>hit.id===expected)+1;
   return {query,searchable,expected,rank:rank||null,...(expansions?{expansions}:{}),top:hits.slice(0,3).map(({id,title,score,representation})=>({id,title,score,representation}))};
  });
  console.log(JSON.stringify({top1:output.filter(item=>item.rank===1).length,top5:output.filter(item=>item.rank&&item.rank<=5).length,
   top10:output.filter(item=>item.rank).length,queries:output},null,2));
 }
}finally{db.close();}
