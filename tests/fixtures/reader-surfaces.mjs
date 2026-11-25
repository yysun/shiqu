// 在 Node 中渲染读者实际看到的操作界面（故事设置的制作流程、书架行与卡片），供出口测试读取可用的操作。
// 只渲染静态标记，不执行点击；测试按操作名称调用对应的正式接口。
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),root=process.cwd();
const compiled=build({stdin:{contents:`
 import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
 import StoryGenerationControl from './client/ui/StoryGenerationControl.tsx';import StoryRetry from './client/ui/StoryRetry.tsx';
 import StoryGenerationStatus from './client/ui/StoryGenerationStatus.tsx';import ReaderShelf from './client/ui/ReaderShelf.tsx';
 const noop=()=>{},async=async()=>{};
 export const controls=session=>renderToStaticMarkup(createElement('div',null,
  createElement(StoryGenerationControl,{session,busy:false,onControl:async,link:true}),
  createElement(StoryRetry,{session,busy:false,onRetry:noop,display:'actions',link:true})));
 export const settings=(session,showLandscape)=>renderToStaticMarkup(createElement(StoryGenerationStatus,{session,busy:false,controlBusy:false,error:'',onControl:async,onRetry:noop,onBack:noop,hideBack:true,showSummary:false,showLandscape}));
 export const shelf=sessions=>{
  const stories=sessions.filter(s=>s.story?.cover).map(s=>({id:s.id,title:s.story.title||'',bookId:s.selection?.bookId||'',theme:s.selection?.theme||'',artStyleLabel:'',revision:s.story.revision,cover:s.story.cover,resumeImage:'',resumePage:0,frameCount:s.story.frameCount||0}));
  return renderToStaticMarkup(createElement(ReaderShelf,{onControl:async,onLandscapeControl:noop,controlBusy:'',stories,pending:sessions.filter(s=>!s.story?.cover),sessions,progress:[],loading:false,refreshing:false,onRefresh:noop,error:'',
   tab:'all',onTab:noop,query:'',onQuery:noop,grouping:'none',onGrouping:noop,bookName:()=>'',onOpen:noop,onResume:noop,onRetry:noop,onDelete:noop,onFavorite:noop,favoriteBusy:'',onCreate:noop,onDiscover:noop}));
 };
`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},
 plugins:[{name:'root-alias',setup(b){b.onResolve({filter:/^@\//},args=>{
  const base=path.join(root,args.path.slice(2));
  for(const candidate of [base,base+'.ts',base+'.tsx',path.join(base,'index.ts')]){try{return {path:require.resolve(candidate)};}catch{/* 继续尝试 */}}
  return {path:base};
 });}}]});

let renderers;
export async function surfaces(){
 if(renderers)return renderers;
 const bundle=await compiled,module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
 return renderers=module.exports;
}

const decode=text=>text.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").trim();
/** 标记中所有可用（未禁用）的操作名称。 */
export function enabledActions(markup){
 const actions=[];
 for(const match of markup.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)){
  const [,,attributes,body]=match;
  if(/\bdisabled\b|aria-disabled="true"/.test(attributes))continue;
  const label=decode(body)||(attributes.match(/aria-label="([^"]*)"/)?.[1]??'');
  if(label)actions.push(label);
 }
 return actions;
}
/** 书架上某篇故事所在行或卡片的标记。 */
export function shelfEntry(markup,id){
 const start=markup.indexOf(`data-story-id="${id}"`);
 if(start<0)return '';
 const next=markup.indexOf('data-story-id="',start+1);
 return markup.slice(start,next<0?undefined:next);
}
