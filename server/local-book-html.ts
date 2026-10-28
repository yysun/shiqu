// Read archived HTML without executing scripts. Keep source glyphs, annotation roles and table layout.
// Layout labels are explicit metadata; unknown text-bearing images fail instead of silently losing a character.
import {parseDocument} from 'htmlparser2';
type AnyNode=ReturnType<typeof parseDocument>|ReturnType<typeof parseDocument>['children'][number];
type Element=Extract<AnyNode,{name:string;attribs:Record<string,string>}>;
import {localLines,chapterNumber} from './local-book-parsers.ts';
import type {LocalSection} from './local-books.ts';
export type HtmlOriginal={file:string;sha256:string;sourceUrl:string;pageTitle?:string;requestedTitle?:string;revision?:string;chapterId?:string;bookVersion?:number;paragraphCount?:number};
type Block={text:string;narrative:boolean};
export type TableCell={column:number;rowspan:number;colspan:number;header:boolean;text:string};
export type SourceTable={rows:TableCell[][]};
const classes=(node:AnyNode)=>'attribs' in node?(node.attribs.class||'').split(/\s+/):[];
const element=(node:AnyNode):node is Element=>'attribs' in node;
const children=(node:AnyNode):AnyNode[]=>'children' in node?node.children:[];
const walk=(node:AnyNode):AnyNode[]=>[node,...children(node).flatMap(walk)];
const plain=(node:AnyNode):string=>node.type==='text'?node.data:children(node).map(plain).join('');
function skipped(node:AnyNode){
 if(!element(node))return false;
 return ['script','style','nav','footer','figure'].includes(node.name)||['headerContainer','toc','textquality'].includes(node.attribs.id)||classes(node).some(c=>['licenseContainer','noprint','ws-noexport','ws-header','header','ws-footer','mw-editsection','printfooter','reflist','references','mw-references-wrap','reference','thumb'].includes(c));
}
function text(node:AnyNode):string{
 if(skipped(node))return '';
 if(node.type==='text')return node.data;
 if(element(node)&&node.name==='img')throw Error('Unresolved inline glyph image');
 if(element(node)&&node.name==='br')return '\n';
 return children(node).map(text).join('');
}
function bodyRoot(html:string){
 const roots=walk(parseDocument(html)).filter(node=>classes(node).includes('mw-parser-output'));
 // Quality banners can contain an earlier empty parser-output; only the full content container is read.
 const root=roots.sort((a,b)=>plain(b).length-plain(a).length)[0];if(!root||plain(root).length<200)throw Error('Missing Wiki body');return root;
}
export function wikiIdentity(html:string){
 const title=html.match(/"wgTitle":("(?:\\.|[^"\\])*")/),revision=html.match(/"wgRevisionId":(\d+)/),redirect=html.match(/"wgRedirectedFrom":("(?:\\.|[^"\\])*")/);
 if(!title||!revision)throw Error('Missing Wiki identity');
 return {title:JSON.parse(title[1]) as string,revision:revision[1],redirect:redirect?JSON.parse(redirect[1]) as string:undefined};
}
// Every cell is serialized at its original anchor; covered slots remain defined by rowspan/colspan.
// Empty anchor cells are retained, so removing a blank never shifts a later column.
function readTable(table:Element):SourceTable{
 const rows:TableCell[][]=[],occupied:number[]=[];
 const tableRows=walk(table).filter((node):node is Element=>element(node)&&node.name==='tr'&&nearestTable(node)===table);
 for(const [rowIndex,row] of tableRows.entries()){
  const cells:TableCell[]=[];let column=0;
  for(const node of children(row).filter((n):n is Element=>element(n)&&['td','th'].includes(n.name))){
   while((occupied[column]||0)>rowIndex)column++;
   const span=(key:string)=>{const raw=node.attribs[key]||'1';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>1000)throw Error('Invalid table span');return Number(raw);};
   const rowspan=span('rowspan'),colspan=span('colspan');
   for(let c=column;c<column+colspan;c++){if((occupied[c]||0)>rowIndex)throw Error('Overlapping cells');occupied[c]=rowIndex+rowspan;}
   cells.push({column:column+1,rowspan,colspan,header:node.name==='th',text:text(node).trim()});column+=colspan;
  }
  if(!cells.length)throw Error('Empty table row structure');rows.push(cells);
 }
 if(!rows.length||occupied.some(end=>end>rows.length))throw Error('Incomplete table');return {rows};
}
function nearestTable(node:AnyNode){for(let p=node.parent;p;p=p.parent)if(element(p)&&p.name==='table')return p;}
export function readWikiBody(html:string){
 const root=bodyRoot(html),blocks:Block[]=[],tables:SourceTable[]=[];let pending='';
 const flush=(narrative=true)=>{if(pending.trim())blocks.push({text:pending.trim(),narrative:narrative&&/[。！？!?，；：]/.test(pending)});pending='';};
 function visit(node:AnyNode){
  if(skipped(node))return;
  if(element(node)&&node.name==='table'){
   flush();const table=readTable(node);tables.push(table);
   for(const [index,cells] of table.rows.entries()){
    const label=`〔表格版式：表${tables.length} 行${index+1}；列号为原表列，空内容保留，跨行跨列为占位关系〕`;
    const body=cells.map(cell=>`〔列${cell.column} 跨行${cell.rowspan} 跨列${cell.colspan}${cell.header?' 表头':''}〕${cell.text}`).join(' ');
    blocks.push({text:label,narrative:false},{text:body,narrative:index>0&&cells.some(c=>!c.header&&/[。！？!?，；：]/.test(c.text))});
   }return;
  }
  if(element(node)&&/^h[1-6]$/.test(node.name)){flush();pending=text(node);flush(false);return;}
  if(element(node)&&['p','dd','dt','li','pre','blockquote'].includes(node.name)){
   flush();pending=text(node);flush();return;
  }
  if(node.type==='text')pending+=node.data;
  else if(element(node)&&node.name==='br')pending+='\n';
  else if(element(node)&&node.name==='img')throw Error('Unresolved source image');
  else for(const child of children(node))visit(child);
 }
 for(const child of children(root))visit(child);flush();
 if(blocks.reduce((sum,b)=>sum+b.text.length,0)<200)throw Error('Empty Wiki body');return {blocks,tables};
}
const shanhaiTitles=['南山經','西山經','北山經','東山經','中山經','海外南經','海外西經','海外北經','海外東經','海內南經','海內西經','海內北經','海內東經','大荒東經','大荒南經','大荒西經','大荒北經','海內經'];
const shijiTables=['三代世表','十二諸侯年表','六國年表','秦楚之際月表','漢興以來諸侯王年表','高祖功臣侯者年表','惠景閒侯者年表','建元以來侯者年表','建元以來王子侯者年表','漢興以來將相名臣年表'];
function section(prefix:string,number:number,title:string,url:string,blocks:Block[]):LocalSection{
 const id=`${prefix}-${String(number).padStart(3,'0')}`;
 return {id,title,url,units:blocks.flatMap(block=>localLines(block.text).map(value=>({text:value,narrative:block.narrative&&/[。！？!?，；：]/.test(value),unreadable:block.text.includes('□')}))).map((unit,index)=>({...unit,id:`${id}-${String(index+1).padStart(3,'0')}`}))};
}
export function parseWikiOriginal(id:string,number:number,html:string,item:HtmlOriginal):LocalSection|null{
 const identity=wikiIdentity(html),expected=id==='山海经'?(number===-1?'山海經':`山海經/${number===0?'郭璞序':shanhaiTitles[number-1]}`):(number===-1?'史記三家註':`史記三家註/${number===18||number===19?shijiTables[number-13]:`卷${String(number).padStart(3,'0')}`}`);
 const requested=id==='史记'&&number>0?`史記三家註/卷${String(number).padStart(3,'0')}`:expected;
 const url=new URL(item.sourceUrl);
 if(identity.title!==expected||item.pageTitle!==expected||item.requestedTitle!==requested||identity.revision!==item.revision||identity.redirect!==(expected===requested?undefined:requested)||url.origin!=='https://zh.wikisource.org'||url.pathname!=='/w/index.php'||url.searchParams.get('title')!==expected||url.searchParams.get('oldid')!==identity.revision)throw Error('Wiki chapter identity mismatch');
 if(number<=0)return null;
 const parsed=readWikiBody(html);if(id==='史记'&&number>=13&&number<=22&&!parsed.tables.length)throw Error('Missing Shiji table data');
 const heading=walk(bodyRoot(html)).find(node=>element(node)&&node.name==='h2'&&!skipped(node));
 const title=id==='山海经'?shanhaiTitles[number-1]:number>=13&&number<=22?shijiTables[number-13]:heading?text(heading).trim().replace(/第[一二三四五六七八九十百]+$/,''):'';
 if(!title)throw Error('Missing source chapter heading');return section(id==='山海经'?'shanhai':'shiji',number,title,item.sourceUrl,parsed.blocks);
}

// The public SSR data retains source variants and small text that the rendered article normalizes/omits.
// Parse JSON only, never evaluate the assignment. Glyph images stay archived; no variant is guessed.
export function readShidianData(html:string){
 const scripts=walk(parseDocument(html)).filter((node):node is Element=>element(node)&&node.name==='script');
 const source=scripts.map(plain).filter(value=>/^\s*window\._ROUTER_DATA\s*=/.test(value));
 if(source.length!==1)throw Error('Missing Shidian SSR');
 const data=JSON.parse(source[0].replace(/^\s*window\._ROUTER_DATA\s*=\s*/,'').replace(/;\s*$/,''));
 return data.loaderData?.['__session/(lang$)/book/$'];
}
export function parseShidianOriginal(number:number,html:string,item:HtmlOriginal){
 const data=readShidianData(html),info=data?.bookInfo,catalog=info?.catalog?.chapters,paragraphs=data?.paragraphList;
 if(info?.bookId!=='JINANLIB02203'||info.bookName!=='酉陽雜俎'||info.version!==6||item.bookVersion!==6||!Array.isArray(catalog)||catalog.length!==30||!Array.isArray(paragraphs))throw Error('Shidian book identity mismatch');
 const chapter=catalog[number-1],name=chapter?.chapterName?.map((n:{content:string})=>n.content).join('');
 const url=`https://www.shidianguji.com/zh/book/JINANLIB02203/chapter/${chapter?.chapterId}`;
 const label=typeof name==='string'?name.replace(/^酉陽雜俎/,'').replace('卷第','卷'):'';
 if(typeof name!=='string'||name!==item.pageTitle||!/^((?:續集)?卷)[一二三四五六七八九十]+$/.test(label)||label.startsWith('續集')!==(number>20)||chapterNumber(label.replace(/^(?:續集)?卷/,''))!==(number>20?number-20:number)||chapter?.chapterId!==item.chapterId||data.ssrChapterId!==item.chapterId||url!==item.sourceUrl||paragraphs.length!==chapter.paragraphCount||paragraphs.length!==item.paragraphCount||!paragraphs.length||catalog.some((c:{subChapters:unknown[]})=>!Array.isArray(c.subChapters)||c.subChapters.length))throw Error('Shidian chapter identity mismatch');
 const glyphSources=new Map<string,string>(),glyphIds:string[]=[],blocks:Block[]=[],seen=new Set();
 for(const [index,paragraph] of paragraphs.entries()){
  if(paragraph.chapterId!==item.chapterId||paragraph.volumeId!==chapter.volumeId||paragraph.volumeVersion!==chapter.volumeVersion||paragraph.inChapterOrder!==index+1||paragraph.paragraphType!==1||paragraph.contentEncryptType!==0||typeof paragraph.content!=='string'||seen.has(paragraph.paragraphId)||!paragraph.paragraphId)throw Error('Invalid Shidian paragraph');seen.add(paragraph.paragraphId);
  const lines=JSON.parse(paragraph.content).lines;if(!Array.isArray(lines)||!lines.length)throw Error('Missing paragraph lines');
  let body='',small=false;
  for(const line of lines){
   if(![1,2,3].includes(line.lineType)||typeof line.content!=='string'||line.marginNoteIdList?.length)throw Error('Unknown source line');
   if(line.lineType===3&&(line.content||line.charPic))throw Error('Unknown page marker');
   if(line.lineType===2&&!small){body+='〔版式：小字〕';small=true;}else if(line.lineType!==2&&small){body+='〔小字止〕';small=false;}
   if(line.charPic){
    const pic=line.charPic;if(!/^\d+$/.test(pic.charPicId)||typeof pic.unicode!=='string'||pic.unicode.trim()||line.content||typeof pic.url!=='string'||new URL(pic.url).protocol!=='https:')throw Error('Unknown glyph image');
    const url=new URL(pic.url);if(!url.hostname.endsWith('.byteimg.com')||(glyphSources.has(pic.charPicId)&&glyphSources.get(pic.charPicId)!==url.pathname))throw Error('Inconsistent glyph source');glyphSources.set(pic.charPicId,url.pathname);glyphIds.push(pic.charPicId);body+=`□〔原件字形图：${pic.charPicId}〕`;
   }else body+=line.content;
  }
  if(small)body+='〔小字止〕';
  const sourceText=lines.map((line:{content:string})=>line.content).join('').replace(/\s/g,'');
  // This pinned transcription puts the volume title, attribution and category in its opening paragraphs.
  // Volume one starts with a prose preface, then its printed contents list (paragraphs 2–50).
  // Keep those original glyphs as non-narrative layout material, never as a story receipt.
  const openingHeading=number===1?index>0&&index<50:index<(number===27?4:[4,28].includes(number)?2:3);
  const volumeOrAttribution=sourceText.length<100&&/^(?:[酉西]?陽[雜雑維]俎(?:[續讀]集)?卷|唐臨淄[段叚]成式柯古撰)/.test(sourceText);
  if(body.trim())blocks.push({text:body,narrative:!openingHeading&&!volumeOrAttribution&&/[。！？!?，；：]/.test(body)});
 }
 return {section:section('youyang',number,name,item.sourceUrl,blocks),glyphIds,glyphSources};
}
