// Load replacement editions with exact manifests, upstream identities and immutable source receipts.
// Original bytes stay archived. Parsing removes source metadata/layout only and never repairs glyphs.
import path from 'node:path';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseDocument} from 'htmlparser2';
import {readWikiBody,wikiIdentity} from './local-book-html.ts';
import type {HtmlOriginal} from './local-book-html.ts';
import type {LocalSection} from './local-books.ts';
import {localLines} from './local-book-parsers.ts';
import {hasSourceAnomaly} from './local-source-quality.ts';
type Spec={prefix:string;count:number;base?:string;repo?:string;edition?:string;preface?:boolean};
export const licensedBookSpecs:Record<string,Spec>={
 liaozhai:{prefix:'liaozhai',count:12,base:'聊齋志異'},
 西游记:{prefix:'xiyou',count:101,base:'西遊記'},
 三国演义:{prefix:'sanguo',count:120,base:'三國演義'},
 水浒传:{prefix:'shuihu',count:120,base:'水滸傳 (120回本)'},
 儒林外史:{prefix:'rulin',count:56,base:'儒林外史'},
 阅微草堂笔记:{prefix:'yuewei',count:25,base:'閱微草堂筆記'},
 酉阳杂俎:{prefix:'youyang',count:30,base:'酉陽雜俎'},
 警世通言:{prefix:'jingshi',count:40,base:'警世通言'},
 醒世恒言:{prefix:'xingshi',count:40,base:'醒世恆言'},
 初刻拍案惊奇:{prefix:'chuke',count:40,base:'初刻拍案驚奇'},
 二刻拍案惊奇:{prefix:'erke',count:40,base:'二刻拍案驚奇'},
 浮生六记:{prefix:'fusheng',count:4,base:'浮生六記'},
 zhuangzi:{prefix:'zhuangzi',count:33,repo:'KR5c0126',edition:'CHANT'},
 列子:{prefix:'liezi',count:8,repo:'KR5c0124',edition:'tls'},
 搜神记:{prefix:'soushen',count:20,repo:'KR3l0099',edition:'WYG',preface:true},
 博物志:{prefix:'bowu',count:10,repo:'KR3l0123',edition:'WYG',preface:true},
 战国策:{prefix:'zhanguo',count:501,repo:'KR2e0003',edition:'tls'},
};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const chinese=(n:number):string=>n<=10?['零','一','二','三','四','五','六','七','八','九','十'][n]:`${n<20?'':chinese(Math.floor(n/10))}十${n%10?chinese(n%10):''}`;
export function replacementPage(id:string,n:number){
 const {base}=licensedBookSpecs[id];
 if(id==='西游记'){if(n===9)return `${base}/附錄`;if(n>9)n--;}
 if(id==='阅微草堂笔记'&&n===25)return `${base}/附`;
 if(id==='酉阳杂俎')return `${base}/${n>20?'續集/':''}卷${chinese(n>20?n-20:n)}`;
 if(id==='初刻拍案惊奇')return `${base}/卷${chinese(n)}`;
 if(id==='二刻拍案惊奇')return `${base}/${String(n).padStart(2,'0')}`;
 if(id==='阅微草堂笔记')return `${base}/卷${n}`;
 if(id==='浮生六记')return `${base}/卷${chinese(n)} ${['閨房記樂','閑情記趣','坎坷記愁','浪遊記快'][n-1]}`;
 return `${base}/第${String(n).padStart(['西游记','三国演义','水浒传'].includes(id)?3:2,'0')}${['西游记','三国演义','水浒传','儒林外史'].includes(id)?'回':'卷'}`;
}
function wikiLabel(raw:string,title:string){
 const doc=parseDocument(raw);
 const visit=(node:typeof doc|typeof doc.children[number]):string|undefined=>{
  if('attribs' in node&&node.name==='a'){
   const href=node.attribs.href||'';
   if(href.startsWith('/wiki/')&&decodeURIComponent(href.slice(6)).replace(/_/g,' ')===title){
    const plain=(n:typeof node|typeof doc.children[number]):string=>n.type==='text'?n.data:'children'in n?n.children.map(plain).join(''):'';
    return plain(node).trim();
   }
  }
  if('children'in node)for(const child of node.children){const label=visit(child);if(label)return label;}
 };
 const label=visit(doc);if(!label)throw Error('Missing indexed chapter link');return label;
}
function validateWiki(raw:string,item:HtmlOriginal,expected:string){
 const identity=wikiIdentity(raw),url=new URL(item.sourceUrl);
 if(identity.title!==expected||identity.redirect||item.pageTitle!==expected||item.requestedTitle!==expected||item.revision!==identity.revision||url.origin!=='https://zh.wikisource.org'||url.pathname!=='/w/index.php'||url.searchParams.get('title')!==expected||url.searchParams.get('oldid')!==identity.revision)throw Error('Replacement Wiki identity mismatch');
}
export function parseKanripoChapter(id:string,number:number,raw:string,url:string):LocalSection{
 const spec=licensedBookSpecs[id];
 if(!spec?.repo||number<1||number>spec.count||!raw.match(new RegExp(`^#\\+PROPERTY: ID ${spec.repo}\\s*$`,'m'))||!raw.match(new RegExp(`^#\\+PROPERTY: BASEEDITION ${spec.edition}\\s*$`,'m')))throw Error('Kanripo edition mismatch');
 let title:string,body:string;
 if(spec.edition==='WYG'){
  const lines=raw.replace(/\r\n/g,'\n').split('\n').filter(line=>!line.startsWith('#')).map(line=>line.replace(/<pb:[^>]+>/g,'').replace(/¶/g,''));
  const expected=`${id==='搜神记'?'搜神記':'博物志'}[卷巻]${chinese(number)}`;
  const heads=lines.flatMap((line,index)=>new RegExp(`^\\s*${expected}(?:\\s.*)?$`).test(line)?[index]:[]);
  if(heads.length!==2||lines.slice(heads[1]+1).some(line=>line.trim()))throw Error('Kanripo volume boundary mismatch');
  title=`卷${chinese(number)}`;body=lines.slice(heads[0]+1,heads[1]).join('\n');
 }else{
  const heads=[...raw.matchAll(/^\*\* (\d+) (.+)$/gm)];if(heads.length!==1||Number(heads[0][1])!==number)throw Error('Kanripo chapter sequence mismatch');
  title=heads[0][2].trim().replace(/第[一二三四五六七八九十百]+$/,'');body=raw.slice(heads[0].index!+heads[0][0].length).replace(/^#.*$/gm,'').replace(/<pb:[^>]+>/g,'').replace(/¶/g,'');
  // Upstream wraps each phrase in a line; its blank paragraphs remain the citation boundaries.
  body=body.split(/\n\s*\n/).map(part=>part.split('\n').map(line=>line.trim()).join('')).filter(Boolean).join('\n');
 }
 if(/[<>#¶]/.test(body)||!body.trim())throw Error('Malformed Kanripo narrative');
 const sectionId=`${spec.prefix}-${String(number).padStart(id==='zhuangzi'?2:3,'0')}`;
 const units=localLines(body).map((text,i)=>({id:`${sectionId}-${String(i+1).padStart(3,'0')}`,text,narrative:[...text.matchAll(/\p{Script=Han}/gu)].length>=12}));
 if(!units.some(unit=>unit.narrative))throw Error('Missing Kanripo narrative');
 return {id:sectionId,title,url,units};
}
type Entry={id:string;format?:string;originalFiles?:HtmlOriginal[];source:{url:string;sha256:string}};
export async function loadLicensedCollection(directory:string,entry:Entry){
 const spec=licensedBookSpecs[entry.id],wiki=entry.format==='licensed-wikisource';
 if(!spec||wiki!==!!spec.base||!entry.originalFiles?.length)throw Error('Unknown replacement collection');
 const expected=wiki?[...Array.from({length:spec.count},(_,i)=>`${String(i+1).padStart(3,'0')}.html`),'index.html']:[...Array.from({length:spec.count+(spec.preface?1:0)},(_,i)=>`${spec.repo}_${String(i+(spec.preface?0:1)).padStart(3,'0')}.txt`),'Readme.org'];
 if(JSON.stringify(entry.originalFiles.map(item=>item.file))!==JSON.stringify(expected)||JSON.stringify((await readdir(directory)).sort())!==JSON.stringify(expected.slice().sort()))throw Error('Replacement original manifest mismatch');
 const edition=sha(entry.originalFiles.map(item=>`${item.file}\t${item.sha256}`).join('\n'));
 if(edition!==entry.source.sha256)throw Error('Replacement collection hash mismatch');
 const parts=[];
 for(const item of entry.originalFiles){
  const file=await realpath(path.join(directory,item.file));if(!file.startsWith(directory+path.sep))throw Error('Escaped replacement file');
  const bytes=await readFile(file);if(sha(bytes)!==item.sha256)throw Error('Replacement original hash mismatch');parts.push({item,raw:bytes.toString('utf8')});
 }
 const sections:LocalSection[]=[];
 if(wiki){
  const index=parts.at(-1)!;validateWiki(index.raw,index.item,spec.base!);
  for(const [i,{item,raw}]of parts.slice(0,-1).entries()){
   const requested=replacementPage(entry.id,i+1);validateWiki(raw,item,requested);
   const label=wikiLabel(index.raw,requested),blocks=readWikiBody(raw).blocks;
   if(blocks.reduce((sum,b)=>sum+b.text.length,0)<200)throw Error('Incomplete replacement chapter');
   if(entry.id==='二刻拍案惊奇'&&i===39){
    const body=blocks.map(block=>block.text).join('').replace(/\s/g,'');
    if(JSON.stringify([...body.matchAll(/第([一二三四五六七八九]+)折/g)].map(match=>match[1]))!==JSON.stringify(['一','二','三','四','五','六','七','八','九'])||!body.endsWith('合編成妝點《鬧元宵》。'))throw Error('Incomplete Erke final play');
   }
   // The added appendix has its own ID; numbered chapters9–100 retain their chapter numbers.
   const number=entry.id==='西游记'?(i===8?0:i>8?i:i+1):i+1;
   const sectionId=`${spec.prefix}-${String(number).padStart(3,'0')}`;
   sections.push({id:sectionId,title:entry.id==='二刻拍案惊奇'&&i===39?`${label}（杂剧）`:label,url:item.sourceUrl,units:blocks.flatMap(block=>localLines(block.text).map(text=>({text,narrative:block.narrative,unreadable:hasSourceAnomaly(block.text)}))).map((unit,n)=>({...unit,id:`${sectionId}-${String(n+1).padStart(3,'0')}`}))});
  }
 }else{
  const url=new URL(entry.source.url);
  if(url.origin!=='https://github.com'||!new RegExp(`^/kanripo/${spec.repo}/tree/[a-f0-9]{40}$`).test(url.pathname))throw Error('Unpinned Kanripo collection');
  for(const {item,raw}of parts){const number=Number(item.file.match(/_(\d+)\.txt$/)?.[1]);if(number>0){const sourceUrl=`${entry.source.url.replace('/tree/','/blob/')}/${item.file}`;if(item.sourceUrl!==sourceUrl)throw Error('Kanripo citation mismatch');sections.push(parseKanripoChapter(entry.id,number,raw,sourceUrl));}}
 }
 if(sections.length!==spec.count)throw Error('Replacement chapter count mismatch');
 return {edition,sections};
}
