// Read two pinned Wiki novels, retaining source glyphs and validating every chapter identity and sequence.
// Honglou pages contain ten chapters; Yushi titles come from its archived index, never from a different edition.
import {readWikiBody,wikiIdentity} from './local-book-html.ts';
import type {HtmlOriginal} from './local-book-html.ts';
import {chapterNumber,localLines} from './local-book-parsers.ts';
import type {LocalSection} from './local-books.ts';
const honglouPages=['第一回 至第十回','第十一回 至第二十回','第二十一回 至第三十回','第三十一回 至第四十回','第四十一回 至第五十回','第五十一回 至第六十回','第六十一回 至第七十回','第七十一回 至第八十回','第八十一回 至第九十回','第九十一回 至第一百回','第一百零一回 至第一百一十回','第一百十一回 至第一百二十回'];
type Part={raw:string;item:HtmlOriginal};
export function parseWikiStories(id:string,parts:Part[]):LocalSection[]{
 const honglou=id==='红楼梦',base=honglou?'紅樓夢（程乙本）':'喻世明言',count=honglou?12:40;
 if(!['红楼梦','喻世明言'].includes(id)||parts.length!==count+1)throw Error('Wiki story collection mismatch');
 for(const [index,{raw,item}]of parts.entries()){
  const expected=index===count?base:`${base}/${honglou?honglouPages[index]:`第${String(index+1).padStart(2,'0')}卷`}`,identity=wikiIdentity(raw),url=new URL(item.sourceUrl);
  if(item.file!==(index===count?'index.html':`${String(index+1).padStart(3,'0')}.html`)||identity.title!==expected||identity.redirect||item.pageTitle!==expected||item.requestedTitle!==expected||item.revision!==identity.revision||url.origin!=='https://zh.wikisource.org'||url.pathname!=='/w/index.php'||url.searchParams.get('title')!==expected||url.searchParams.get('oldid')!==identity.revision)throw Error('Wiki story identity mismatch');
 }
 const titles=honglou?[]:readWikiBody(parts[count].raw).blocks.flatMap(block=>{
  const match=block.text.match(/^第([一二三四五六七八九十]+)卷\s+(.+)$/);return match?[{number:chapterNumber(match[1]),title:block.text}]:[];
 });
 if(!honglou&&(titles.length!==40||titles.some((t,i)=>t.number!==i+1)))throw Error('Yushi index sequence mismatch');
 const sections:LocalSection[]=[];
 for(const [page,part]of parts.slice(0,count).entries()){
  const blocks=readWikiBody(part.raw).blocks,heads=honglou?blocks.flatMap((block,index)=>{
   const match=block.text.match(/^第([一二三四五六七八九十百○〇零]+)回\s+(.+)$/);return match&&!block.narrative?[{number:chapterNumber(match[1].replace(/○/g,'〇')),index,title:block.text}]:[];
  }):[{number:page+1,index:-1,title:titles[page].title}];
  if(honglou&&(heads.length!==10||heads[0].index!==0||heads.some((h,i)=>h.number!==page*10+i+1)))throw Error('Honglou chapter sequence mismatch');
  for(const [index,head]of heads.entries()){
   const body=blocks.slice(head.index+1,heads[index+1]?.index);if(body.reduce((n,b)=>n+b.text.length,0)<200)throw Error('Incomplete Wiki story');
   const sectionId=`${honglou?'honglou':'yushi'}-${String(head.number).padStart(3,'0')}`;
   sections.push({id:sectionId,title:head.title,url:part.item.sourceUrl,units:body.flatMap(block=>localLines(block.text).map(text=>({text,narrative:block.narrative}))).map((unit,i)=>({...unit,id:`${sectionId}-${String(i+1).padStart(3,'0')}`}))});
  }
 }
 return sections;
}
