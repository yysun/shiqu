// Resolve verified originals and canonical Wikisource chapters without inventing source text.
import {Parser} from 'htmlparser2';
import {Converter} from 'opencc-js';
import {pearSource,sourceUrl as pearUrl} from './content.ts';
import type {Selection} from './reader-model.ts';
import type {OriginalSource,SourceResult,SourceFailure,SourceHint} from './reader-source-types.ts';
import {verifiedPassages} from './reader-verified-passages.ts';

const simplified=Converter({from:'t',to:'cn'}),traditional=Converter({from:'cn',to:'t'});
const names:Record<string,string>={liaozhai:'聊斋志异',shishuo:'世说新语',zhuangzi:'庄子'};
const normalize=(text:string)=>simplified(text).replace(/[\s《》〈〉「」『』“”‘’·•‧/（）()，,。:：]/g,'');
const api='https://zh.wikisource.org/w/api.php';
class SourceFetchError extends Error{code:SourceFailure['code'];status?:number;constructor(code:SourceFailure['code'],status?:number){super(code);this.code=code;this.status=status;}}
function numberedChapter(book:string,citation:string){
 const format=book==='西游记'?{unit:'回',width:3}:book==='儒林外史'?{unit:'回',width:2}:book==='搜神记'?{unit:'卷',width:2}:null;
 if(!format)return '';
 const number='[〇零一二三四五六七八九十百千两\\d]+';
 const match=citation.match(new RegExp(`第(${number})${format.unit}`))||(format.unit==='卷'?citation.match(new RegExp(`卷(${number})`)):null);
 if(!match)return '';
 const value=match[1];let total=0,current=0;
 if(/^\d+$/.test(value))total=Number(value);
 else for(const char of value){const digit='零一二三四五六七八九'.indexOf(char==='〇'?'零':char==='两'?'二':char);if(digit>=0)current=digit;else{const unit=char==='十'?10:char==='百'?100:1000;total+=(current||1)*unit;current=0;}}
 if(!/^\d+$/.test(value))total+=current;
 return total>0&&total<=1000?`第${String(total).padStart(format.width,'0')}${format.unit}`:'';
}
export function sourceQuery(selection:Selection,plan:SourceHint){
 const custom=selection.customBook?.trim()||'';
 const reference=simplified(plan.sourceReference);
 const bracket=reference.match(/《([^》]+)》/)?.[1]||'';
 const book=names[selection.bookId]||(selection.bookId==='other'?(custom.startsWith('http')?bracket.split(/[·•‧/]/)[0]:custom):selection.bookId);
 const inBrackets=bracket.split(/[·•‧/]/).slice(1).join('/');
 const tail=reference.replace(/^.*?》/,'').replace(/[（(].*$/,'').replace(/^\s*第[一二三四五六七八九十百零〇\d]+则.*$/,'').trim();
 const chapter=(inBrackets||tail||selection.storyTitle||'').replace(/^\s*[·•‧/]/,'').trim().slice(0,80);
 const bookName=simplified(book).replace(/[《》]/g,'').trim();
 return {book:bookName,chapter:numberedChapter(bookName,reference)||chapter};
}
export function sourceSearchUrl(selection:Selection,plan:SourceHint){const {book,chapter}=sourceQuery(selection,plan);return 'https://zh.wikisource.org/w/index.php?'+new URLSearchParams({search:`${book} ${chapter}`});}

// Verified public-domain passages also keep common reads available if the source service is down.
// Cao E passage: https://zh.wikisource.org/w/index.php?title=世說新語/捷悟&oldid=1500322 (item 3, excluding commentary).
const caoText='魏武尝过曹娥碑下，杨修从，碑背上见题作“黄绢幼妇，外孙齑臼”八字。魏武谓修曰：“解不？”答曰：“解。”魏武曰：“卿未可言，待我思之。”行三十里，魏武乃曰：“吾已得。”令修别记所知。修曰：“黄绢，色丝也，于字为绝。幼妇，少女也，于字为妙。外孙，女子也，于字为好。齑臼，受辛也，于字为辞。所谓‘绝妙好辞’也。”魏武亦记之，与修同，乃叹曰：“我才不及卿，乃觉三十里。”';
export function verifiedPassage(selection:Selection,plan:SourceHint):OriginalSource|null{
 const {book}=sourceQuery(selection,plan),clues=normalize([plan.sourceReference,selection.storyTitle||'',plan.adaptationNote||'',...(plan.pages||[]).map(p=>p.caption)].join(' '));
 if(book==='世说新语'&&clues.includes('曹娥碑')&&(/杨修|杨脩/.test(clues)||clues.includes('绝妙好辞')))return {title:'《世说新语·捷悟》· 曹娥碑',text:caoText,url:'https://zh.wikisource.org/zh-hans/世說新語/捷悟',kind:'passage',provider:'维基文库',retrievedAt:new Date().toISOString()};
 if(book==='聊斋志异'&&normalize(plan.sourceReference).includes('种梨'))return {title:'《聊斋志异·种梨》',text:pearSource,url:pearUrl,kind:'passage',provider:'识典古籍',retrievedAt:new Date().toISOString()};
 const known=verifiedPassages.find(p=>p.book===book&&p.clues.every(clue=>clues.includes(clue)));
 if(known)return {title:known.title,text:known.text,url:known.url,kind:'passage',provider:'维基文库',retrievedAt:new Date().toISOString()};
 return null;
}
export function originalBlocks(html:string):{tag:string;text:string}[]{
 const blocks:{tag:string;text:string}[]=[],stack:{tag:string;skip:boolean;capture:boolean}[]=[];
 let current:{tag:string;text:string}|null=null;
 const flush=()=>{if(current){const text=current.text.replace(/[\t\r ]+/g,' ').replace(/\n+/g,'\n').trim();if(text.length>=2)blocks.push({tag:current.tag,text});current=null;}};
 const parser=new Parser({
  onopentag(tag,attrs){
   const skip=!!stack.at(-1)?.skip||['script','style','table','nav','footer','sup'].includes(tag)||/(^|\s)(?:noprint|navbox|mw-editsection|sistersitebox|licenseContainer|ws-noexport)(?:\s|$)/.test(attrs.class||'');
   const capture=!skip&&['p','li','h2','h3','h4'].includes(tag);
   if(capture){flush();current={tag,text:''};}else if(tag==='br'&&current&&!skip)current.text+='\n';
   stack.push({tag,skip,capture});
  },
  ontext(text){if(current&&!stack.at(-1)?.skip)current.text+=text;},
  onclosetag(){const closing=stack.pop();if(closing?.capture)flush();},
 },{decodeEntities:true});parser.end(html);flush();return blocks;
}
function belongs(title:string,book:string){const root=simplified(title).split('/')[0].replace(/[（(].*$/,'');return normalize(root)===normalize(book);}
function extract(title:string,html:string,book:string,chapter:string){
 if(!belongs(title,book)||!chapter)return '';
 const blocks=originalBlocks(html),target=normalize(chapter).replace(/篇$/,'');
 const heading=blocks.findIndex(b=>/^h/.test(b.tag)&&normalize(b.text).replace(/篇$/,'')===target);
 const section=heading>=0?blocks.slice(heading+1,blocks.findIndex((b,i)=>i>heading&&/^h/.test(b.tag))===-1?undefined:blocks.findIndex((b,i)=>i>heading&&/^h/.test(b.tag))):blocks;
 const titleMatches=simplified(title).split('/').slice(1).some(part=>normalize(part).replace(/篇$/,'')===target);
 if(!titleMatches&&heading<0)return '';
 return section.filter(b=>['p','li'].includes(b.tag)&&b.text.length>=15).map(b=>b.text).join('\n\n').slice(0,24000);
}
async function wiki(params:Record<string,string>,transport:typeof fetch){
 const url=new URL(api);url.search=new URLSearchParams({format:'json',formatversion:'2',...params}).toString();
 // Inspect redirects without following them outside the fixed source host.
 const response=await transport(url.href,{headers:{'Accept':'application/json','User-Agent':'ShiquClassics/1.0'},signal:AbortSignal.timeout(10000),redirect:'manual'});
 if(!response.ok)throw new SourceFetchError('SOURCE_HTTP_ERROR',response.status);
 const text=await response.text();if(text.length>2_000_000)throw new SourceFetchError('SOURCE_INVALID_RESPONSE');
 try{return JSON.parse(text);}catch{throw new SourceFetchError('SOURCE_INVALID_RESPONSE');}
}
export async function lookupOriginal(selection:Selection,plan:SourceHint,transport:typeof fetch=fetch):Promise<SourceResult>{
 const searchUrl=sourceSearchUrl(selection,plan),known=verifiedPassage(selection,plan);
 if(known)return {source:known,message:'',searchUrl};
 const {book,chapter}=sourceQuery(selection,plan);
 if(!book||!chapter||book.length>60||/https?:/.test(book))return {source:null,message:'暂未找到可核对的原文，可以通过出处检索继续查找。',searchUrl};
 const make=(parsed:{title:string;text:string;revid?:number})=>{
  const text=extract(parsed.title,parsed.text,book,chapter);if(text.length<30)return null;
  return {title:simplified(parsed.title).replaceAll('/',' · '),text:simplified(text),url:'https://zh.wikisource.org/zh-hans/'+encodeURIComponent(parsed.title).replaceAll('%2F','/'),kind:'chapter' as const,provider:'维基文库',retrievedAt:new Date().toISOString()};
 };
 try{
  const direct=await wiki({action:'parse',page:traditional(`${book}/${chapter}`),prop:'text|revid',variant:'zh-hans',redirects:'1'},transport);
  let source=direct.parse?make(direct.parse):null;
  if(!source){
   const result=await wiki({action:'query',list:'search',srsearch:`${book} ${chapter}`,srnamespace:'0',srlimit:'5',srprop:''},transport);
   const candidates=(result.query?.search||[]).filter((p:{title:string})=>belongs(p.title,book)).slice(0,2);
   for(const candidate of candidates){const parsed=await wiki({action:'parse',pageid:String(candidate.pageid),prop:'text|revid',variant:'zh-hans'},transport);source=parsed.parse?make(parsed.parse):null;if(source)break;}
  }
  return {source,message:source?'':'暂未找到与这篇故事对应的原典章节，可以通过出处检索继续查找。',searchUrl};
 }catch(error){
  const failure:SourceFailure=error instanceof SourceFetchError?{code:error.code,...(error.status?{status:error.status}:{})}:{code:error instanceof Error&&/timeout|abort/i.test(error.name)?'SOURCE_TIMEOUT':'SOURCE_NETWORK_ERROR'};
  console.error('reader_source_lookup_failed',JSON.stringify(failure));
  return {source:null,message:'原文来源暂时无法连接，请稍后重试，或打开出处检索。',searchUrl,failure};
 }
}
