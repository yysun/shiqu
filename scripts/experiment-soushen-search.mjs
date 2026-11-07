// 在独立 SQLite 中评估搜神记的全书白话检索；原文范围沿用拾趣的版本和行号。
import {lstat,mkdir,readFile,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Converter} from 'opencc-js';
import {discoveryThemePresets} from '../lib/reader-prompts.ts';
import {storyEmbeddingModel,storyEmbeddingQuery,storySearchKey} from '../server/local-story-search.ts';
import {LocalBooks} from '../server/local-books.ts';
import {boundaryCandidates,layoutStoryStarts,partitionStoryUnits,reconcileBoundaryReviews,semanticBoundaryWindows,validateBoundaryDecisions,validateSemanticStarts} from '../server/local-story-segmentation.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const dbPath=resolve(root,'.data/soushen-search.sqlite');
const chatModel='qwen3.5:latest';
const vectorModel=storyEmbeddingModel;
const host='http://127.0.0.1:11434';
const simplified=Converter({from:'t',to:'cn'});
const instruction='你是古文编目员。将各编号原文分别改写为一两句现代简体中文，约35至75字。先写起因，再写关键行动和结果；复杂情节可超过字数。涉及多人时，为每个关键行动写明谁做了什么、对谁做，保留委托、转折、否定和未遂。只复述原文事件，原文没有的信息不补；不用其他版本。不要加评论、寓意或真实性判断；神异情节照录为事件。输出一个 JSON 对象，键为原编号，值为白话摘要字符串。';
const cardVersion=4;
const passageVersion='unit-windows-v1';

async function request(path,body){
 const response=await fetch(host+path,body===undefined?{signal:AbortSignal.timeout(10000)}:{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000),
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
async function reviewBoundaries(db,candidates,edition,modelDigest){
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
   const answer=await chatObject(boundaryPrompt,JSON.stringify(input),format,keys.length*16+80);
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
async function readSemanticBoundaries(db,sections,edition,modelDigest){
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
    starts:{type:'array',items:{type:'integer',enum:choices},uniqueItems:true},
   }};
   const input={前文:window.before,原文:window.units.map(({text},i)=>[i+1,text]),后文:window.after,可选编号:choices};
   const answer=await chatObject(semanticBoundaryPrompt,JSON.stringify(input),format,choices.length*5+70);
   if(!Array.isArray(answer.starts)||answer.starts.some(i=>!choices.includes(i)))throw Error('模型返回了窗口之外的边界编号');
   starts=answer.starts.map(i=>window.units[i-1].id);
  }
  for(const [id,decision] of validateSemanticStarts(window.ids,starts))decisions.set(id,decision);
  if(!cached)save.run(key,JSON.stringify(starts));
  console.error(`已读 ${index+1}/${windows.length} 个原文窗口${cached?'（复用）':''}`);
 }
 return decisions;
}

async function segmentBook(db,bookId,modelDigest,{sectionFilter}={}){
 const books=new LocalBooks(root),book=await books.book({bookId});
 if(!book)throw Error('找不到本地书籍 '+bookId);
 const {books:catalog}=JSON.parse(await readFile(resolve(root,'data/library/catalog.json'),'utf8'));
 const catalogEntry=catalog.find(entry=>entry.id===book.id);
 const sections=[];
 for(const [index,section] of book.sections.entries()){
  if(sectionFilter&&sectionFilter!==section.id&&sectionFilter!==section.title)continue;
  let layoutStarts;
  if(catalogEntry?.format==='kanripo-text'&&section.url){
   const file=new URL(section.url).pathname.split('/').at(-1);
   if(catalogEntry.originalFiles.some(original=>original.file===file)){
    const raw=await readFile(resolve(root,'data/library',catalogEntry.originalFile,file),'utf8');
    const lines=raw.split(/\r?\n/).filter(line=>!line.startsWith('#'))
     .map(line=>line.replace(/<pb:[^>]+>|¶/g,'')).filter(line=>line.trim());
    layoutStarts=layoutStoryStarts(section.units,lines);
   }
  }
  sections.push({...section,layoutStarts,volume:index+1});
 }
 if(!sections.length)throw Error('找不到指定篇章 '+sectionFilter);
 const candidates=boundaryCandidates(sections);
 const initial=await readSemanticBoundaries(db,sections,book.edition,modelDigest);
 if(initial.size!==candidates.length)throw Error('语义窗口未覆盖全部原文边界');
 const conflicts=candidates.filter(({id,layout,openClause})=>
  layout==='unknown'||initial.get(id)!==(layout==='start')||(openClause&&initial.get(id)));
 const reviewed=await reviewBoundaries(db,conflicts,book.edition,modelDigest);
 const decisions=reconcileBoundaryReviews(initial,conflicts,reviewed);
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

async function embed(texts,query=false){
 const input=query?texts.map(storyEmbeddingQuery):texts;
 const {embeddings}=await request('/api/embed',{model:vectorModel,input,truncate:false,keep_alive:'10m',options:{num_ctx:2048}});
 if(embeddings?.length!==texts.length)throw Error('向量条数不符');
 return embeddings.map(normalize);
}

async function cards(rows){
 const keys=rows.map((_,index)=>String(index+1));
 const format={type:'object',additionalProperties:false,required:keys,properties:Object.fromEntries(keys.map(key=>[key,{type:'string'}]))};
 const input=Object.fromEntries(keys.map((key,index)=>[key,simplified(rows[index].text)]));
 const output=await chatObject(instruction,
  '要输出 '+rows.length+' 张，JSON 必须包含全部编号 '+keys.join('、')+'。原文：'+JSON.stringify(input),
  format,rows.length*125+50);
 const parsed=keys.flatMap((key,index)=>{
  const value=output[key];
  if(typeof value!=='string')return [];
  const summary=simplified(value.trim());
  if(summary.length<8||summary.length>230)return [];
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

async function build(db,{pilot,raw}){
 const digests=await modelDigests();
 const {entries,edition}=await segmentBook(db,'搜神记',digests[chatModel]);
 const identity=JSON.stringify({edition,digests,prompt:createHash('sha256').update(instruction).digest('hex'),version:cardVersion});
 const existing=db.prepare("SELECT value FROM metadata WHERE key='identity'").get();
 if(existing&&existing.value!==identity)throw Error('此索引的原文、模型或制卡契约有变更。请使用独立工作树重建索引。');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare("INSERT OR IGNORE INTO metadata VALUES ('identity',?)").run(identity);
  const remove=db.prepare('DELETE FROM entries WHERE id=?');
  const activeIds=new Set(entries.map(row=>row.id));
  for(const {id} of db.prepare('SELECT id FROM entries').all())if(!activeIds.has(id))remove.run(id);
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
 const rows=db.prepare('SELECT id,text FROM entries WHERE raw_vector IS NULL AND blocked IS NULL ORDER BY id').all();
 const save=db.prepare('UPDATE entries SET raw_vector=? WHERE id=?');
 for(let offset=0;offset<rows.length;offset+=24){
  const batch=rows.slice(offset,offset+24);
  const vectors=await embed(batch.map(row=>row.text));
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [index,row] of batch.entries())save.run(new Uint8Array(vectors[index].buffer),row.id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(`已写入 ${offset+batch.length}/${rows.length} 条原文向量`);
 }
 const passages=db.prepare('SELECT story_id,first_unit,text FROM passages WHERE vector IS NULL ORDER BY story_id,first_unit').all();
 const savePassage=db.prepare('UPDATE passages SET vector=? WHERE story_id=? AND first_unit=? AND vector IS NULL');
 for(let offset=0;offset<passages.length;offset+=32){
  const batch=passages.slice(offset,offset+32),vectors=await embed(batch.map(row=>row.text));
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [index,row] of batch.entries())savePassage.run(new Uint8Array(vectors[index].buffer),row.story_id,row.first_unit);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  console.log(`已写入 ${offset+batch.length}/${passages.length} 段事件向量`);
 }
 console.log(JSON.stringify({...total(stats(db)),passages:db.prepare('SELECT count(vector) AS count FROM passages').get().count}));
 if(raw)return;
 const statement=db.prepare('UPDATE entries SET title=?,summary=?,vector=? WHERE id=? AND vector IS NULL');
 let pending=db.prepare('SELECT id,text FROM entries WHERE vector IS NULL AND blocked IS NULL ORDER BY volume<>11,volume,id').all();
 if(pilot){
  const cases=await evaluationCases();
  const priority=new Set(cases.map(item=>item.expected));
  const ids=db.prepare('SELECT id FROM entries WHERE blocked IS NULL ORDER BY volume<>11,volume,id').all();
  for(const row of ids){if(priority.size>=30)break;priority.add(row.id);}
  pending=pending.filter(row=>priority.has(row.id));
 }
 const defaultBatch=10,remaining=pending.length;
 let batchSize=defaultBatch,done=0;
 while(pending.length){
  const batch=pending.slice(0,batchSize);
  const start=performance.now();
  try{
   const result=await cards(batch);
   if(!result.length)throw Error(`返回 0/${batch.length} 张有效故事卡`);
   const vectors=await embed(result.map(card=>card.summary));
   db.exec('BEGIN IMMEDIATE');
   try{
    for(const [index,card] of result.entries())statement.run(card.title,card.summary,new Uint8Array(vectors[index].buffer),card.id);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const ids=new Set(result.map(card=>card.id));
   pending.splice(0,batch.length,...batch.filter(row=>!ids.has(row.id)));
   done+=result.length;
   console.log(`已写入 ${done}/${remaining} 张，本批 ${result.length}/${batch.length} 张，${((performance.now()-start)/1000).toFixed(1)} 秒，${batch[0].id}`);
   batchSize=result.length===batch.length?defaultBatch:Math.max(1,Math.floor(batch.length/2));
  }catch(error){
   if(batch.length===1)throw new Error(`条目 ${batch[0].id} 可从断点重跑`,{cause:error});
   batchSize=Math.max(1,Math.floor(batch.length/2));
   console.warn(`批次 ${batch[0].id} 失败，缩小为 ${batchSize} 条重试：${error.message}`);
  }
 }
 console.log(JSON.stringify(total(stats(db))));
}

async function search(db,queries,limit=5,raw=false,withPassages=false){
 const identity=db.prepare("SELECT value FROM metadata WHERE key='identity'").get();
 if(!identity)throw Error('数据库还没有建立索引');
 const expected=JSON.parse(identity.value).digests[vectorModel];
 const {models}=await request('/api/tags');
 if(models.find(item=>item.name===vectorModel)?.digest!==expected)throw Error('当前向量模型与索引版本不同');
 const rows=db.prepare(`SELECT id,label,url,source,text,title,summary,raw_vector,vector FROM entries
  WHERE ${raw?'raw_vector':'COALESCE(vector,raw_vector)'} IS NOT NULL`).all()
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
async function chatObject(system,user,format,maxTokens){
 const result=await request('/api/chat',{
  model:chatModel,format,think:false,stream:false,keep_alive:'10m',
  options:{temperature:0.1,presence_penalty:0,num_ctx:8192,num_predict:maxTokens},
  messages:[{role:'system',content:system},{role:'user',content:user}],
 });
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

// 参考查询离线制备，与故事索引使用同一模型。运行时仅查表。
async function buildReferences(db){
 const identity=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get()?.value||'null');
 const digest=identity?.digests?.[vectorModel];
 if(!digest||digest!==(await modelDigests([vectorModel]))[vectorModel])throw Error('必须先准备同一向量模型的故事索引');
 const topics=[...discoveryThemePresets,'爱情','复仇','报恩','升仙','求雨','卖鬼赚钱'];
 const queries=new Map();
 for(const query of [...topics,...db.prepare('SELECT DISTINCT title FROM entries WHERE title IS NOT NULL ORDER BY title').all().map(row=>row.title)]){
  const key=storySearchKey(query);
  if(key&&!queries.has(key))queries.set(key,query);
 }
 const rows=[...queries],vectors=[];
 for(let offset=0;offset<rows.length;offset+=24)vectors.push(...await embed(rows.slice(offset,offset+24).map(([,query])=>query),true));
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('DELETE FROM query_vectors');
  const write=db.prepare('INSERT INTO query_vectors VALUES (?,?,?,?)');
  for(const [i,[key,query]] of rows.entries())write.run(key,query,digest,new Uint8Array(vectors[i].buffer));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 console.log(JSON.stringify({referenceQueries:rows.length,model:vectorModel}));
}

const evaluationCases=async()=>JSON.parse(await readFile(new URL('../data/evals/story-discovery/soushen-search-queries.json',import.meta.url),'utf8'));
const [mode='stats',...args]=process.argv.slice(2);
if(!['build','stats','search','list','candidates','eval','segment','refs'].includes(mode)||['search','list','candidates'].includes(mode)&&!args.join(' ').trim()){
 console.error('用法：node scripts/experiment-soushen-search.mjs build [--pilot|--raw] | refs | stats | eval [--raw] | search|list|candidates <白话问题> | segment <书名> [篇章]');
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
   const tables=existing.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   if(tables.some(({name})=>!['metadata','entries','passages','boundary_reviews','boundary_plans','query_vectors'].includes(name)))throw Error('该文件不是搜神记实验数据库');
  }finally{existing.close();}
 }
 return new DatabaseSync(dbPath,{readOnly:!write});
}
const write=['build','segment','refs'].includes(mode);
const db=await openSearchDatabase(write);
try{
 if(write){
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
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
  if(mode==='refs')await buildReferences(db);
  else if(mode==='build')await build(db,{pilot:args.includes('--pilot'),raw:args.includes('--raw')});
  else{
   const [bookId,sectionFilter]=args.filter(arg=>arg!=='--all');
   if(!bookId)throw Error('请指定本地书名');
   const digests=await modelDigests([chatModel]);
   const result=await segmentBook(db,bookId,digests[chatModel],{sectionFilter});
   console.log(JSON.stringify({...result,entries:result.entries.map(({id,label,source,blocked})=>({id,label,source:JSON.parse(source),blocked}))},null,2));
  }
 }else if(mode==='stats'){
  const rows=stats(db);
  const blocked=db.prepare('SELECT id,label,blocked FROM entries WHERE blocked IS NOT NULL ORDER BY id').all();
  console.log(JSON.stringify({dbPath,total:total(rows),volumes:rows,blocked,integrity:db.prepare('PRAGMA quick_check').get().quick_check},null,2));
 }else if(['search','list','candidates'].includes(mode)){
  const query=args.join(' ').trim();
  const result=mode!=='search'||listQuery(query)?await listStories(db,query,mode==='candidates'):(await search(db,[query]))[0];
  console.log(JSON.stringify(result,null,2));
 }else{
  const cases=await evaluationCases();
  const results=await search(db,cases.map(item=>item.query),10,args.includes('--raw'));
  const output=results.map(({query,searchable,hits},index)=>{
   const expected=cases[index].expected;
   const rank=hits.findIndex(hit=>hit.id===expected)+1;
   return {query,searchable,expected,rank:rank||null,top:hits.slice(0,3).map(({id,title,score,representation})=>({id,title,score,representation}))};
  });
  console.log(JSON.stringify({top1:output.filter(item=>item.rank===1).length,top5:output.filter(item=>item.rank&&item.rank<=5).length,
   top10:output.filter(item=>item.rank).length,queries:output},null,2));
 }
}finally{db.close();}
