// 逐篇核对原来按章制卡的古籍。订阅模型只读编号原文，确认过的候选可从离线回执接续合并。
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {z} from 'zod/v4';
import {localSourceKey} from '../lib/reader-local-contract.ts';
import {CodexError,createCodexRunner} from '../server/codex-runner.ts';
import {LocalBooks} from '../server/local-books.ts';
import {sourceUnitIds} from '../server/local-source-ranges.ts';
import {storyCardsSchema,storySearchKey} from '../server/local-story-search.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const catalogBooks=['史记','三国演义','水浒传','西游记','红楼梦','儒林外史'];
const defaultModel='gpt-6.1-sol';
const discoveryInstructions=`逐一通读每个 target 的编号原文，补目录中能独立选用的具体事件。已有整篇卡时逐段查找一个人因一件事采取行动并得到直接结果的故事。保留其中彼此独立的事件，不用整篇、整个人物一生或跨多场战事的总主线代替。例如《项羽本纪》可分别收录巨鹿破釜沉舟、鸿门宴和乌江自刎；在提供原文确能独立支持时才收录。总主线与事件可以共享背景。同一场事件的改名、缩写、放大版只留一张。已有篇内卡表示已收录事件。没有整篇卡且全章只讲一个独立完整事件时可以引用全章。
每个 target 都要返回。通读完且判断清楚时 status 写 checked，有关键证据缺失或尚有未核范围时写 incomplete 并说明。确无独立故事可以填空数组。起因、行动和自然结果都要由所给正文支持。不把未完事件、人物列表、考论、年表或注家异说当故事。开端必须落在该 target，结局可以在紧接的下一章。引用包含必要起因与收束的最小合理范围。书目附注从提供材料中移除，原文编号保持不变。只根据所给原文，不使用记忆，不联网。标题简体用常见故事名或准确概括，梗概用简体写实际因果，不抄回目。firstUnit 和 lastUnit 逐字复制编号。cause 和 outcome 各逐字摘录一处正文短语，保留繁体字。只返回指定 JSON。`;
const reviewInstructions='你是独立复核古籍故事卡的编辑。逐一对照提供的可引用原文，审查提议标题与梗概是否确有独立起因、行动、结果及对应范围，有无补写、异说当正文或截断事件。比较同批重叠候选和既有篇内卡。同事件只保留一项，已有优先，其次保留范围完整者，等同则保留编号最小者；不同事件可以共享原文。不要凭记忆校正。能直接使用答 accepted；重复、证据不足、范围有缺或内容失实答 rejected，给短理由。每个编号必须答复一次。';
const candidateSchema=z.strictObject({
 title:z.string().trim().min(2).max(100),summary:z.string().trim().min(12).max(260),
 firstUnit:z.string().min(1),lastUnit:z.string().min(1),
 cause:z.string().min(4).max(100),outcome:z.string().min(4).max(100),
});
const chapterSchema=z.strictObject({section:z.string(),status:z.enum(['checked','incomplete']),cards:z.array(candidateSchema),note:z.string()});
const extractionSchema=z.strictObject({chapters:z.array(chapterSchema)});
const reviewSchema=z.strictObject({reviews:z.array(z.strictObject({
 id:z.string(),verdict:z.enum(['accepted','rejected']),reason:z.string(),
}))});
const checkpointSchema=z.strictObject({
 fingerprint:z.string(),batch:z.string(),edition:z.string(),section:z.string(),status:chapterSchema.shape.status,note:z.string(),model:z.string(),
 known:z.array(z.string()),cards:z.array(candidateSchema),
 rejected:z.array(z.strictObject({title:z.string(),reason:z.string()})),
});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bodyText=text=>text.replace(/〈[^〉]*〉/gu,'');
const normalizeEvidence=text=>bodyText(text).replace(/[\s\p{P}]/gu,'');
const chapterText=section=>section.units.reduce((total,unit)=>total+bodyText(unit.text).length+unit.id.length+4,0);
const fingerprint=(book,model)=>hash([book.edition,model,discoveryInstructions,reviewInstructions,z.toJSONSchema(extractionSchema),z.toJSONSchema(reviewSchema)]);
const cardRange=(book,card)=>({...card.source,edition:book.edition});
const overlaps=(a,b)=>a.some(unit=>b.includes(unit));
const episodeId=(section,candidate)=>section+'-episode-'+hash([candidate.firstUnit,candidate.lastUnit]).slice(0,12);

async function json(filename){
 try{return JSON.parse(await readFile(filename,'utf8'));}
 catch(error){if(error?.code==='ENOENT')return null;throw error;}
}
async function cachedJson(filename){
 try{return await json(filename);}
 catch(error){if(error instanceof SyntaxError)return null;throw error;}
}
async function save(filename,value){
 const staged=filename+'.'+process.pid+'.tmp';
 await writeFile(staged,value,'utf8');
 await rename(staged,filename);
}

function qualify(books,book,whole,units,sectionId,candidate,available){
 const first=units.get(candidate.firstUnit),last=units.get(candidate.lastUnit);
 if(!first||!last||first.section.id!==sectionId||last.number<first.number||last.number>first.number+1||
    first.number===last.number&&first.index>last.index)throw Error('首末编号、所属章节或章序不符');
 const cross=first.number!==last.number,firstEnd=cross?first.section.units.at(-1).id:candidate.lastUnit;
 const source={edition:book.edition,sectionId,firstUnit:candidate.firstUnit,lastUnit:firstEnd,
  ...(cross?{continuations:[{sectionId:last.section.id,firstUnit:last.section.units[0].id,lastUnit:candidate.lastUnit}]}:{})};
 if(available&&sourceUnitIds(book,source).some(unit=>!available.has(unit)))throw Error('出处超出本次所给原文');
 const id=episodeId(sectionId,candidate),originalWhole=whole.get(sectionId);
 if(originalWhole&&originalWhole.id!==id&&!cross&&first.index===0&&last.index===first.section.units.length-1)throw Error('与整篇卡范围相同');
 const {text}=books.resolve(book,source),original=normalizeEvidence(text);
 const cause=normalizeEvidence(candidate.cause),outcome=normalizeEvidence(candidate.outcome);
 if(cause.length<4||outcome.length<4||cause===outcome||!original.includes(cause)||!original.includes(outcome))throw Error('正文中的起因或结果摘录无法核对');
 const {edition:_,...range}=source;void _;
 return {text,range:sourceUnitIds(book,source),card:{id,
  title:candidate.title,summary:candidate.summary,source:range}};
}

function context(book,group){
 const sections=new Map(group.map(({id,units})=>[id,units]));
 for(const chapter of group){
  const following=book.sections[chapter.number+1];
  if(!following||sections.has(following.id))continue;
  if(group.length===1){sections.set(following.id,following.units);continue;}
  let length=0;
  sections.set(following.id,following.units.filter(unit=>{length+=unit.text.length+unit.id.length;return length-unit.text.length-unit.id.length<3800;}));
 }
 return [...sections].map(([id,units])=>({id,units:units.map(({id,text})=>[id,bodyText(text)])}));
}

async function scanBook(target,books,runner,model,directory,workers,recheck){
 const {book,chapters,whole,units,base}=target;
 const cacheKey=fingerprint(book,model);
 const episodes=base.cards.filter(card=>card.id!==whole.get(card.source.sectionId)?.id)
  .map(card=>({card,range:sourceUnitIds(book,cardRange(book,card))}));
 await mkdir(directory,{recursive:true});
 const pending=[];
 for(const chapter of chapters){
  const filename=join(directory,chapter.id+'.json');
  const saved=checkpointSchema.safeParse(await cachedJson(filename));
  if(!recheck&&saved.success&&saved.data.status==='checked'&&saved.data.fingerprint===cacheKey&&saved.data.edition===book.edition&&saved.data.section===chapter.id)continue;
  pending.push(chapter);
 }
 const groups=[];
 let batch=[],length=0;
 for(const chapter of pending){
  const count=chapterText(chapter);
  if(batch.length&&(length+count>72000||batch.length===14)){groups.push(batch);batch=[];length=0;}
  batch.push(chapter);length+=count;
 }
 if(batch.length)groups.push(batch);
 async function submit(instructions,prompt,schema){
  const response=await runner.run({model,reasoningEffort:'low',timeoutMs:240000,instructions,prompt:JSON.stringify(prompt),schema:z.toJSONSchema(schema)});
  return schema.parse(JSON.parse(response.text));
 }
 async function scan(group){
  const originals=context(book,group);
  const wanted=new Set(group.map(chapter=>chapter.id));
  const available=new Set(originals.flatMap(({units})=>units.map(([id])=>id)));
  const names=group.map(chapter=>({id:chapter.id,title:chapter.title,wholeTitle:whole.get(chapter.id)?.title||null,
   episodes:episodes.filter(({card})=>card.source.sectionId===chapter.id).map(({card})=>card)}));
  const batchKey=hash([cacheKey,names,originals.map(({id,units})=>[id,units.length])]);
  const filename=join(directory,'batch-'+batchKey+'.json');
  const cached=extractionSchema.safeParse(await cachedJson(filename));
  const validRows=rows=>new Set(rows.map(row=>row.section)).size===rows.length&&rows.every(row=>wanted.has(row.section));
  const usableCache=cached.success&&cached.data.chapters.length===group.length&&validRows(cached.data.chapters);
  let extracted=cached;
  if(recheck||!usableCache){
   extracted={data:await submit(discoveryInstructions,{book:book.title,targets:names,originals},extractionSchema)};
   if(!validRows(extracted.data.chapters))throw Error('模型回执包含重复或未分配的篇章');
  }
  const bySection=new Map(),qualified=[];
  for(const row of extracted.data.chapters){
   const state={fingerprint:cacheKey,batch:batchKey,edition:book.edition,section:row.section,status:row.status,note:row.note,model,known:new Set(),cards:[],rejected:[]};
   bySection.set(row.section,state);
   for(const candidate of row.cards){
    try{
     const {text,range}=qualify(books,book,whole,units,row.section,candidate,available);
     const neighbors=episodes.filter(item=>overlaps(range,item.range)).map(item=>item.card);
     neighbors.forEach(card=>state.known.add(card.id));
     qualified.push({id:String(qualified.length+1),text,range,candidate,state,neighbors});
    }catch(error){
     if(error.message!=='与整篇卡范围相同')state.status='incomplete';
     state.rejected.push({title:candidate.title,reason:error.message});
    }
   }
  }
  if(bySection.size===group.length&&[...bySection.values()].every(row=>row.status==='checked')){
   if(recheck||!usableCache)await save(filename,JSON.stringify(extracted.data));
  }else if(usableCache){
   await unlink(filename).catch(error=>{if(error?.code!=='ENOENT')throw error;});
  }
  for(let offset=0;offset<qualified.length;){
   let last=offset,length=0;
   while(last<qualified.length&&(last===offset||length+qualified[last].text.length<=60000)&&last-offset<30)length+=qualified[last++].text.length;
   const chunk=qualified.slice(offset,last);offset=last;
   const {reviews}=await submit(reviewInstructions,chunk.map(({id,text,range,candidate,neighbors})=>({
    id,text,candidate,existing:neighbors,
    related:qualified.filter(other=>other.id!==id&&overlaps(range,other.range)).map(({id,candidate})=>({id,candidate})),
   })),reviewSchema);
   const judgments=new Map(reviews.map(review=>[review.id,review]));
   if(reviews.length!==chunk.length||judgments.size!==chunk.length||chunk.some(({id})=>!judgments.has(id)))throw Error('复核未返回每条候选的结论');
   for(const {id,candidate,state} of chunk){
    const decision=judgments.get(id);
    if(decision.verdict==='accepted')state.cards.push(candidate);
    else state.rejected.push({title:candidate.title,reason:decision.reason});
   }
  }
  for(const [section,state] of bySection)
   await save(join(directory,section+'.json'),JSON.stringify(checkpointSchema.parse({...state,known:[...state.known]})));
  return group.filter(chapter=>!bySection.has(chapter.id));
 }
 const queue=groups.slice();
 let fatal;
 async function worker(){
  while(queue.length&&!fatal){
   const group=queue.shift();
   try{
    const missing=await scan(group);
    if(missing.length===group.length)throw Error('模型省略了本批要求核对的篇章');
    for(const chapter of missing)queue.push([chapter]);
    console.log(JSON.stringify({book:book.id,received:group.length-missing.length,first:group[0].id,last:group.at(-1).id}));
   }catch(error){
    if(error instanceof CodexError&&!['TIMEOUT','OUTPUT_LIMIT'].includes(error.message)){fatal=error;return;}
    if(group.length>1){
     const middle=Math.ceil(group.length/2);
     queue.push(group.slice(0,middle),group.slice(middle));
    }else console.error(JSON.stringify({book:book.id,pending:group[0].id,error:String(error.message).slice(0,260)}));
   }
  }
 }
 await Promise.all(Array.from({length:Math.min(workers,groups.length)},worker));
 if(fatal)throw fatal;
}

async function reportBook(target,books,directory,apply){
 const {book,chapters,whole,units,base,filename}=target;
 const key=card=>localSourceKey({...card.source,edition:book.edition});
 const existing=new Map(base.cards.map(card=>[key(card),card.title]));
 const names=new Set(base.cards.map(card=>card.source.sectionId+'\0'+storySearchKey(card.title)));
 const ids=new Set(base.cards.map(card=>card.id));
 const receipts=new Map(),batchForCard=new Map(),additions=new Map(),pending=[],overlapReview=[],sameRangeAlternates=[];
 let checked=0,withAdditions=0,rejected=0,duplicates=0,added=0;
 for(const chapter of chapters){
  const result=checkpointSchema.safeParse(await cachedJson(join(directory,chapter.id+'.json')));
  if(!result.success||result.data.edition!==book.edition||result.data.section!==chapter.id||
    result.data.fingerprint!==fingerprint(book,result.data.model))continue;
  receipts.set(chapter.id,result.data);
  for(const candidate of result.data.cards)batchForCard.set(episodeId(chapter.id,candidate),result.data.batch);
 }
 const episodes=base.cards.filter(card=>card.id!==whole.get(card.source.sectionId)?.id)
  .map(card=>({id:card.id,range:sourceUnitIds(book,cardRange(book,card)),batch:batchForCard.get(card.id)}));
 for(const chapter of chapters){
  const result=receipts.get(chapter.id);
  if(!result){pending.push(chapter.id);continue;}
  let complete=result.status==='checked';
  rejected+=result.rejected.length;
  const cards=[];
  for(const candidate of result.cards){
   let output;
   try{output=qualify(books,book,whole,units,chapter.id,candidate);}
   catch(error){throw Error(chapter.id+' 的保存候选已无法核对：'+error.message);}
   const {card:record,range}=output;
   const citation=key(record),titleKey=chapter.id+'\0'+storySearchKey(record.title);
   if(existing.has(citation)||names.has(titleKey)||ids.has(record.id)){
    const retained=existing.get(citation);
    if(retained&&storySearchKey(retained)!==storySearchKey(record.title))
     sameRangeAlternates.push({section:chapter.id,source:record.source,retained,candidate:record.title});
    duplicates++;continue;
   }
   const conflict=episodes.find(episode=>episode.batch!==result.batch&&!result.known.includes(episode.id)&&overlaps(range,episode.range));
   if(conflict){complete=false;overlapReview.push({section:chapter.id,title:record.title,with:conflict.id});continue;}
   existing.set(citation,record.title);names.add(titleKey);ids.add(record.id);cards.push(record);
   episodes.push({id:record.id,range,batch:result.batch});
  }
  if(complete)checked++;else pending.push(chapter.id);
  if(cards.length){withAdditions++;additions.set(chapter.id,cards);added+=cards.length;}
 }
 if(apply&&added){
  const originalCards=base.cards;
  const lastBySection=new Map(originalCards.map((card,index)=>[card.source.sectionId,index]));
  const cards=originalCards.flatMap((card,index)=>lastBySection.get(card.source.sectionId)===index?[card,...(additions.get(card.source.sectionId)||[])]:[card]);
  for(const [section,newCards] of additions)if(!lastBySection.has(section))cards.push(...newCards);
  storyCardsSchema.parse({...base,cards});
  for(const card of cards)sourceUnitIds(book,{...card.source,edition:book.edition});
  const old=new Set(originalCards);
  if(!cards.filter(card=>old.has(card)).every((card,index)=>originalCards[index]===card))throw Error('整篇卡位置或内容变化');
  const lockFile=filename+'.sweep.lock';
  const lock=await open(lockFile,'wx').catch(error=>{
   if(error?.code==='EEXIST')throw Error(book.id+' 的目录合并已加锁，请先核对正在运行的任务');
   throw error;
  });
  try{
   await lock.writeFile(String(process.pid)+'\n');
   const latest=await json(filename);
   if(hash(latest)!==hash(base))throw Error(book.id+' 的故事卡目录已更新，请重新运行');
   const {cards:_,...header}=base;void _;
   await save(filename,JSON.stringify(header).slice(0,-1)+',"cards":[\n'+cards.map(card=>JSON.stringify(card)).join(',\n')+'\n]}\n');
  }finally{
   await lock.close();
   await unlink(lockFile);
  }
 }
 console.log(JSON.stringify({book:book.id,scope:chapters.length,checked,pending,withAdditions,added,rejected,duplicates,overlapReview,sameRangeAlternates,applied:apply}));
 return pending.length;
}

async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{
  book:{type:'string',multiple:true},section:{type:'string',multiple:true},
  'work-dir':{type:'string'},'catalog-dir':{type:'string'},model:{type:'string',default:defaultModel},workers:{type:'string',default:'4'},
  recheck:{type:'boolean'},
 }});
 const [mode]=positionals,workers=Number(values.workers);
 if(positionals.length!==1||!['inventory','scan','report','apply'].includes(mode)||mode!=='inventory'&&(!values['work-dir']||!isAbsolute(values['work-dir']))||
    values['catalog-dir']&&!isAbsolute(values['catalog-dir'])||values.recheck&&mode!=='scan'||!Number.isInteger(workers)||workers<1||workers>8||values.book?.some(book=>!catalogBooks.includes(book)))
  throw Error('用法：pnpm exec node scripts/build-chapter-story-cards.mjs inventory|scan|report|apply [--book 书名] [--section 章节编号] [--work-dir 绝对路径] [--catalog-dir 绝对路径] [--recheck] [--workers 1–8]');
 const books=new LocalBooks(root);
 const runner=mode==='scan'?createCodexRunner({CODEX_MODEL:values.model}):null;
 const selected=new Set(values.section||[]),matched=new Set();
 const targets=[];
 let pending=0;
 for(const id of new Set(values.book||catalogBooks)){
  const book=await books.book({bookId:id});
  const filename=join(values['catalog-dir']||join(root,'data/library/story-cards'),encodeURIComponent(id)+'.json');
  const base=await json(filename);storyCardsSchema.parse(base);
  if(base.bookId!==book.id||base.edition!==book.edition)throw Error(id+' 故事卡书名或原文版次不符');
  const units=new Map(),whole=new Map(),chapters=[];
  for(const [number,section] of book.sections.entries()){
   section.units.forEach((unit,index)=>units.set(unit.id,{section,number,index}));
   const card=base.cards.find(({source})=>source.sectionId===section.id&&!source.continuations&&
    source.firstUnit===section.units[0]?.id&&source.lastUnit===section.units.at(-1)?.id);
   if(card)whole.set(section.id,card);
   if(!selected.size||selected.has(section.id)){chapters.push({...section,number});matched.add(section.id);}
  }
  targets.push({book,filename,base,units,whole,chapters});
 }
 if(matched.size<selected.size)throw Error('存在无法在所选书籍定位的章节');
 if(runner){const state=await runner.status();if(!state.configured)throw Error('Codex 订阅无法使用：'+state.reason);}
 for(const target of targets){
  const {book,chapters,base,whole}=target,id=book.id;
  if(mode==='inventory'){
   console.log(JSON.stringify({book:id,scope:chapters.length,wholeCards:chapters.filter(section=>whole.has(section.id)).length,base:base.cards.length,
    withoutWholeCard:chapters.filter(section=>!whole.has(section.id)).map(({id,title})=>({id,title}))}));
  }else{
   const directory=join(values['work-dir'],encodeURIComponent(id));
   if(runner)await scanBook(target,books,runner,values.model,directory,workers,values.recheck);
   pending+=await reportBook(target,books,directory,mode==='apply');
  }
 }
 if(pending)process.exitCode=1;
}

await main();
