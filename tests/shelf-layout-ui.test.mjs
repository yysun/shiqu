// 书架分区：未成书的制作任务以紧凑行排在可阅读故事之前，需要处理的优先且始终可见；可阅读卡片同尺寸并区分已读完。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import './fixtures/tsx.mjs';

const {default:Shelf}=await import('../client/ui/ReaderShelf.tsx');
const noop=()=>{};
const story=(id,title,frames=3)=>({id,bookId:'honglou',title,theme:'爱情与错过',pages:Array.from({length:frames},()=>({image:'/saved.png'}))});
const session=(id,title,extra={})=>({id,selection:{bookId:'honglou',theme:'原典故事',artStyle:'chibi',storyTitle:title},state:'idle',error:null,ready:0,story:null,page:0,saved:false,stage:'正在编排故事',...extra});
const paused=(id,title)=>session(id,title,{generationControl:'paused'});
function render({stories=[],pending=[],progress=[],...extra}={}){
 return renderToStaticMarkup(createElement(Shelf,{stories,pending,sessions:pending,progress,loading:false,refreshing:false,error:'',tab:'recent',query:'',grouping:'none',bookName:()=> '红楼梦',controlBusy:'',favoriteBusy:'',onControl:noop,onRetry:noop,onRefresh:noop,onTab:noop,onQuery:noop,onGrouping:noop,onOpen:noop,onResume:noop,onDelete:noop,onFavorite:noop,onCreate:noop,onDiscover:noop,...extra}));
}
const rows=html=>[...html.matchAll(/<li class="yu-production-row (\w+)(?: is-selected)?"[^>]*>.*?<strong>(.*?)<\/strong>/g)].map(([,tone,title])=>`${tone}:${title}`);

test('unfinished productions come first as rows, ordered by what needs the user, each with at most one control',()=>{
 const html=render({stories:[story('read','宝玉探病')],pending:[
  paused('p','暂停的故事'),
  session('run','运行的故事',{productionState:'running'}),
  session('frames','待选画幅的故事',{awaitingFrameCount:true}),
  session('fail','失败的故事',{state:'failed',error:'绘图服务暂时不可用',retryAllowed:true}),
 ]});
 assert.ok(html.indexOf('yu-production')<html.indexOf('yu-shelf-row-readable'),'Productions precede readable stories');
 assert.deepEqual(rows(html),['needs:待选画幅的故事','failed:失败的故事','active:运行的故事','paused:暂停的故事']);
 assert.match(html,/<h2>制作中<\/h2><span>4 项<\/span><em>2 项待处理<\/em>/);
 assert.match(html,/<h2 class="yu-shelf-region-title">可阅读<span>1 篇<\/span><\/h2>/);
 const row=title=>html.slice(html.indexOf(`<strong>${title}</strong>`),html.indexOf('</li>',html.indexOf(`<strong>${title}</strong>`)));
 assert.doesNotMatch(row('待选画幅的故事'),/yu-generation-control/,'The row itself is the action for user decisions');
 assert.equal((row('失败的故事').match(/yu-generation-control/g)||[]).length,1);assert.match(row('失败的故事'),/重试生成/);
 assert.match(row('运行的故事'),/暂停生成/);assert.match(row('暂停的故事'),/恢复生成/);
 // 失败的具体错误可见；通用说明只供读屏软件朗读。
 assert.match(row('失败的故事'),/<small class="yu-production-error">绘图服务暂时不可用<\/small>/);
 assert.match(row('暂停的故事'),/<span class="sr-only">已保存的结果会保留/);
});

test('a long production list shows needs-you rows plus up to five in total, and a search shows every match',()=>{
 const pending=[...Array.from({length:7},(_,i)=>paused('p'+i,'暂停'+i)),session('frames','待选画幅',{awaitingFrameCount:true})];
 const html=render({pending});
 assert.deepEqual(rows(html),['needs:待选画幅','paused:暂停0','paused:暂停1','paused:暂停2','paused:暂停3']);
 assert.match(html,/显示全部 8 项/);
 const many=Array.from({length:6},(_,i)=>session('n'+i,'待选'+i,{awaitingFrameCount:true}));
 assert.equal(rows(render({pending:[...many,paused('p','暂停')]})).length,6,'Every needs-you row stays visible');
 const searched=render({pending,query:'暂停'});
 assert.equal(rows(searched).length,7);assert.doesNotMatch(searched,/显示全部/);
});

test('readable cards are the same size in single-story groups and show finished reading',()=>{
 const stories=[story('done','葬花',4),story('mid','初进贾府',4)];
 const progress=[{storyId:'done',page:3,saved:false},{storyId:'mid',page:1,saved:false}];
 const html=render({stories,progress,grouping:'book',bookName:s=>s.id==='done'?'红楼梦':'石头记'});
 assert.doesNotMatch(html,/yu-shelf-grid-single|yu-shelf-row-compact/);
 assert.equal((html.match(/class="yu-shelf-row yu-shelf-row-readable"/g)||[]).length,2);
 assert.match(html,/aria-label="重读《葬花》"><span class="yu-shelf-progress" aria-hidden="true"><i style="width:100%"><\/i><\/span><span class="yu-shelf-reading-meta"><span>已读完 · 4 幅<\/span><span class="yu-shelf-continue">重读/);
 assert.match(html,/<span>第 2 \/ 4 幅<\/span><span class="yu-shelf-continue">接着看/);
 assert.doesNotMatch(html,/yu-shelf-region-title/,'No region heading without productions');
 // 已读完从第一幅重读；未读完沿用原有的继续阅读调用。
 const opened=[],tree=Shelf({stories,pending:[],sessions:[],progress,loading:false,refreshing:false,error:'',tab:'recent',query:'',grouping:'none',bookName:()=> '红楼梦',controlBusy:'',favoriteBusy:'',onOpen:(...args)=>opened.push(args)});
 const button=(node,label)=>{if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props['aria-label']===label)return node;for(const child of [node.props?.children].flat(Infinity)){const found=button(child,label);if(found)return found;}};
 button(tree,'重读《葬花》').props.onClick();button(tree,'继续阅读《初进贾府》').props.onClick();
 assert.deepEqual(opened,[[stories[0],true],[stories[1]]]);
});

test('filters apply to both regions; production-only shelves explain where stories will appear',()=>{
 const pending=[{...paused('fav','收藏的草稿'),saved:true},paused('other','另一个草稿')];
 const stories=[story('read','宝玉探病')];
 const saved=render({pending,stories,tab:'saved'});
 assert.deepEqual(rows(saved),['paused:收藏的草稿']);assert.doesNotMatch(saved,/宝玉探病/);
 assert.match(saved,/找到 1 \/ 3 篇/);assert.doesNotMatch(saved,/还没有可阅读的故事/);
 assert.match(saved,/我的收藏 <span>1<\/span>/);assert.match(saved,/全部故事 <span>3<\/span>/);
 assert.match(render({pending}),/还没有可阅读的故事，完成制作后会出现在这里。/);
 assert.match(render({}),/你的故事，从这里开始/);
 assert.match(render({stories,query:'不存在'}),/还没找到这篇故事/);
});
