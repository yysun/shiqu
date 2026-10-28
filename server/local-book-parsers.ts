// Parse each pinned transcription deterministically; source glyphs are never converted.
// Repeated tables of contents are excluded by selecting the final complete chapter sequence.
import {Parser} from 'htmlparser2';
import type {LocalSection} from './local-books.ts';
const numbers='[〇零一二三四五六七八九十百千两0-9]+';
const chapterNumbers='[〇零一二三四五六七八九十百千两0-9 \\t\u3000]+';
export const additionalBookSpecs:Record<string,{prefix:string;count:number;heading:RegExp;numbered?:boolean;end?:RegExp;missing?:number[]}>={
 liaozhai:{prefix:'liaozhai',count:12,heading:/^[ \t\u3000]*卷([一二三四五六七八九十]+)[ \t\u3000]+[^\n]+$/gm,numbered:true},
 西游记:{prefix:'xiyou',count:100,heading:new RegExp(`^[ \\t\u3000]*第(${chapterNumbers})回(?:[ \\t\u3000]+[^\\n]*|[ \\t]*)$`,'gm'),numbered:true},
 三国演义:{prefix:'sanguo',count:120,heading:new RegExp(`^[ \\t\u3000]*第(${chapterNumbers})回(?:[ \\t\u3000]+[^\\n]*|[ \\t]*)$`,'gm'),numbered:true},
 红楼梦:{prefix:'honglou',count:120,heading:new RegExp(`^[ \\t\u3000]*第(${chapterNumbers})回(?:[ \\t\u3000]+[^\\n]*|[ \\t]*)$`,'gm'),numbered:true},
 水浒传:{prefix:'shuihu',count:120,heading:new RegExp(`^[ \\t\u3000]*第(${chapterNumbers})回[^\\n]*$`,'gm'),numbered:true},
 儒林外史:{prefix:'rulin',count:56,heading:new RegExp(`^[ \\t\u3000]*第(${chapterNumbers})回(?:[ \\t\u3000]+[^\\n]*|[ \\t]*)$`,'gm'),numbered:true},
 山海经:{prefix:'shanhai',count:18,heading:/^[ \t\u3000]*((?:[东西南北中東]|海[外內内]|大荒)[东西南北東]?山?[經经])[ \t]*$/gm},
 列子:{prefix:'liezi',count:8,heading:new RegExp(`^[ \\t\u3000]*卷第(${numbers})[^\\n]*篇[ \\t]*$`,'gm'),numbered:true},
 搜神记:{prefix:'soushen',count:20,heading:new RegExp(`^[ \\t\u3000]*搜神记卷(${numbers})[ \\t]*$`,'gm'),numbered:true},
 阅微草堂笔记:{prefix:'yuewei',count:24,heading:/阅微草堂(?:笔记)?卷([一二三四五六七八九十]+)[^\n]*/gm,numbered:true},
 子不语:{prefix:'zibuyu',count:24,heading:new RegExp(`^[ \\t\u3000]*第(${numbers})卷[ \\t]*$`,'gm'),numbered:true},
 酉阳杂俎:{prefix:'youyang',count:44,heading:/^[ \t\u3000]*●(?:续集)?卷[^\n]+$/gm},
 博物志:{prefix:'bowu',count:10,heading:new RegExp(`^[ \\t\u3000]*博物志卷(?:之)?(${numbers})[ \\t]*$`,'gm'),numbered:true},
 喻世明言:{prefix:'yushi',count:40,heading:new RegExp(`^[ \\t\u3000]*第(${numbers})卷[^\\n]*$`,'gm'),numbered:true},
 警世通言:{prefix:'jingshi',count:40,heading:new RegExp(`^[ \\t\u3000]*警世通言第(${numbers})卷[^\\n]*$`,'gm'),numbered:true},
 醒世恒言:{prefix:'xingshi',count:40,heading:new RegExp(`^[ \\t\u3000]*第(${numbers})卷[^\\n]*$`,'gm'),numbered:true},
 初刻拍案惊奇:{prefix:'chuke',count:40,heading:new RegExp(`^[ \\t\u3000]*卷(?:之)?(${numbers})[^\\n]*$`,'gm'),numbered:true},
 史记:{prefix:'shiji',count:130,heading:/^$/gm},
 战国策:{prefix:'zhanguo',count:33,heading:new RegExp(`卷(${numbers})[ \\t\u3000]+[^\\n]*$`,'gm'),numbered:true,end:/^[ \t\u3000]*刘向书录[ \t]*$/m},
 浮生六记:{prefix:'fusheng',count:4,heading:/^[ \t\u3000]*●卷([一二三四])[^\n]+$/gm,numbered:true,end:/^[ \t\u3000]*●卷五/m},
};
export function chapterNumber(value:string){
 const digits:Record<string,number>={'〇':0,'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 value=value.replace(/\s/g,'');if(/^\d+$/.test(value))return Number(value);
 if(!/[十百千]/.test(value))return Number([...value].map(c=>digits[c]??'?').join(''));
 let result=0,current=0;for(const c of value){if(c in digits)current=digits[c];else {result+=(current||1)*({十:10,百:100,千:1000}[c]||NaN);current=0;}}return result+current;
}
// New books use original lines as citation units. Split very long lines without deleting characters.
export function localLines(text:string){
 const result:string[]=[];
 for(const line of text.split('\n').map(p=>p.trim()).filter(Boolean)){
  let part='';for(const token of line.match(/[^。！？!?；;]+[。！？!?；;]?|[。！？!?；;]/gu)||[line]){
   if(part.length+token.length>2000&&part){result.push(part);part='';}
   for(const char of token){if(part.length>=2000){result.push(part);part='';}part+=char;}
  }if(part)result.push(part);
 }
 return result;
}
export function parseAdditionalSections(id:string,text:string):LocalSection[]{
 if(id==='史记'){
  const data=JSON.parse(text) as {articles:{title:string;content:string[]}[]};
  if(!Array.isArray(data.articles)||data.articles.length!==130)throw Error('Shiji chapter count mismatch');
  const titles=new Set<string>(),bodies=new Set<string>();
  return data.articles.map((article,index)=>{
   if(typeof article.title!=='string'||!article.title.trim()||!Array.isArray(article.content)||article.content.some(p=>typeof p!=='string'))throw Error('Invalid Shiji chapter');
   const body=article.content.join('\n'),sectionId=`shiji-${String(index+1).padStart(3,'0')}`;
   if(!body.trim()||titles.has(article.title)||bodies.has(body))throw Error('Empty or duplicate Shiji chapter');titles.add(article.title);bodies.add(body);
   return {id:sectionId,title:article.title,units:localLines(body).map((text,i)=>({id:`${sectionId}-${String(i+1).padStart(3,'0')}`,text}))};
  });
 }

 const spec=additionalBookSpecs[id];if(!spec)throw Error('Unknown local book');
 if(spec.end){const matches=[...text.matchAll(new RegExp(spec.end.source,'gm'))];if(matches.length)text=text.slice(0,matches.at(-1)!.index);}
 let heads=[...text.matchAll(spec.heading)];
 if(spec.numbered){const first=heads.findLast(h=>chapterNumber(h[1])===1);if(!first)throw Error('Missing body start');heads=heads.filter(h=>h.index!>=first.index!);}
 const allHeads=heads;
 if(spec.numbered){const last=new Map<number,RegExpExecArray>();for(const h of heads)if(!spec.missing?.includes(chapterNumber(h[1])))last.set(chapterNumber(h[1]),h);heads=[...last.values()].sort((a,b)=>a.index!-b.index!);const expected=Array.from({length:spec.count},(_,i)=>i+1).filter(n=>!spec.missing?.includes(n));if(heads.some((h,i)=>chapterNumber(h[1])!==expected[i]))throw Error('Chapter sequence mismatch: '+id);}
 if(heads.length!==spec.count-(spec.missing?.length||0))throw Error(`Chapter count mismatch: ${id}: ${heads.length}/${spec.count}`);
 const sections:LocalSection[]=heads.map((heading,index)=>{
  const sectionId=`${spec.prefix}-${String(spec.numbered?chapterNumber(heading[1]):index+1).padStart(3,'0')}`;
  let title=heading[0].trim().replace(/^●/,'');
  if(id==='liaozhai')title=title.split(/\s/)[0];
  if(id==='红楼梦')title+=index>=80?'（后四十回）':'（前八十回）';
  let end=heads[index+1]?.index??text.length;
  const discarded=allHeads.find(h=>h.index!>heading.index!&&h.index!<end&&!heads.includes(h));if(discarded)end=discarded.index!;
  let body=text.slice(heading.index!+heading[0].length,end);
  if(id==='山海经')body=body.split(/^End of Project Gutenberg/m)[0];
  if(id==='子不语')body=body.split(/^-+本書完/m)[0];
  const lines=localLines(body);
  if(id==='liaozhai')lines.unshift(heading[0].trim().split(/\s+/).at(-1)!);
  if(!lines.length&&id!=='史记')throw Error('Empty chapter: '+id);
  return {id:sectionId,title,units:lines.map((text,i)=>({id:`${sectionId}-${String(i+1).padStart(3,'0')}`,text}))};
 });
 if(id==='阅微草堂笔记'){const last=sections.at(-1)!,i=last.units.findIndex(u=>u.text==='附：纪汝佶六则');if(i>=0){const units=last.units.splice(i+1);last.units.splice(i);const appendixId='yuewei-025';sections.push({id:appendixId,title:'附录：纪汝佶六则',units:units.map((u,i)=>({id:`${appendixId}-${String(i+1).padStart(3,'0')}`,text:u.text}))});}}
 return sections;
}
// Read paragraphs only inside the archived Wikisource content container, excluding site furniture.
export function supplementBody(html:string){
 const stack:{active:boolean;skip:boolean;paragraph:boolean}[]=[],paragraphs:string[]=[];let current='';
 const parser=new Parser({onopentag(tag,attrs){
  const parent=stack.at(-1),active=!!parent?.active||/(^|\s)mw-parser-output(\s|$)/.test(attrs.class||'');
  const skip=!!parent?.skip||['table','style','script','nav','footer','sup'].includes(tag)||/(?:licenseContainer|noprint|ws-noexport|mw-editsection|printfooter)/.test(attrs.class||'')||/font-size:\s*0/.test(attrs.style||'');
  const paragraph=active&&!skip&&['p','h2','h3','h4'].includes(tag);if(paragraph)current='';if(tag==='br'&&active&&!skip)current+='\n';stack.push({active,skip,paragraph});
 },ontext(text){const top=stack.at(-1);if(top?.active&&!top.skip&&stack.some(s=>s.paragraph))current+=text;},onclosetag(){const last=stack.pop();if(last?.paragraph&&current.trim()){paragraphs.push(current.trim());current='';}}},{decodeEntities:true});
 parser.end(html);if(paragraphs.join('').length<200)throw Error('Missing supplement body');return paragraphs.join('\n\n');
}
