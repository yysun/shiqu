// 桌面书架：传入 onSelect 时封面与标题按钮改为选择，底部“继续阅读/重读”与制作行仍直接打开；
// 选中状态覆盖可阅读卡片与制作行；不传 onSelect 时封面与标题直接打开。右栏组合由浏览器验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/tsx.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const {default:Shelf}=await import('../client/ui/ReaderShelf.tsx');
const noop=()=>{};
const story=(id,title)=>({id,bookId:'honglou',title,theme:'爱情与错过',frameCount:3,cover:'/saved.png'});
const session=(id,title)=>({id,selection:{bookId:'honglou',theme:'原典故事',artStyle:'chibi',storyTitle:title},state:'idle',error:null,ready:0,story:null,page:0,saved:false,stage:'正在编排故事'});
const props=extra=>({stories:[story('a','宝玉探病'),story('b','黛玉葬花')],pending:[session('p','待选题的故事')],sessions:[session('p','待选题的故事')],progress:[{storyId:'b',page:2}],loading:false,refreshing:false,error:'',tab:'recent',query:'',grouping:'none',bookName:()=>'红楼梦',controlBusy:'',favoriteBusy:'',onControl:noop,onRetry:noop,onRefresh:noop,onTab:noop,onQuery:noop,onGrouping:noop,onOpen:noop,onResume:noop,onDelete:noop,onFavorite:noop,onCreate:noop,onDiscover:noop,...extra});
// 在元素树里查找节点
function find(node,predicate,out=[]){
 if(!node||typeof node!=='object')return out;
 if(Array.isArray(node)){for(const child of node)find(child,predicate,out);return out;}
 if(predicate(node))out.push(node);
 for(const value of Object.values(node.props??{}))if(value&&typeof value==='object')find(value,predicate,out);
 return out;
}
const byLabel=(tree,label)=>find(tree,node=>node.props?.['aria-label']===label)[0];

test('without onSelect the shelf markup is unchanged: covers and titles open the story',()=>{
 const html=renderToStaticMarkup(createElement(Shelf,props({})));
 assert.match(html,/aria-label="打开《宝玉探病》"/);assert.match(html,/aria-label="阅读《宝玉探病》"/);
 assert.doesNotMatch(html,/选择《|is-selected|aria-pressed="(?:true|false)" class="yu-shelf-card/);
});

test('with onSelect, covers and titles select; the reading footer and production rows still open',()=>{
 const calls=[];
 const tree=Shelf(props({selectedId:'b',onSelect:id=>calls.push(['select',id]),onOpen:(s,restart)=>calls.push(['open',s.id,!!restart]),onResume:s=>calls.push(['resume',s.id])}));
 byLabel(tree,'选择《宝玉探病》').props.onClick();
 find(tree,node=>node.props?.['aria-label']==='选择《黛玉葬花》'&&node.props?.className?.includes('yu-shelf-card-details'))[0].props.onClick();
 byLabel(tree,'继续阅读《宝玉探病》').props.onClick();
 byLabel(tree,'重读《黛玉葬花》').props.onClick();
 find(tree,node=>node.props?.className==='yu-pending-story')[0].props.onClick();
 assert.deepEqual(calls,[['select','a'],['select','b'],['open','a',false],['open','b',true],['resume','p']]);
 const selected=find(tree,node=>node.props?.['data-story-id']==='b')[0];assert.match(selected.props.className,/is-selected/);
 assert.equal(find(tree,node=>node.props?.['aria-label']==='选择《黛玉葬花》'&&node.props?.['aria-pressed']!==undefined)[0].props['aria-pressed'],true);
});

test('the selection clears when its story is filtered out or deleted',()=>{
 const guard=tree=>find(tree,node=>typeof node.type==='function'&&node.type.name==='SelectionGuard')[0];
 const kept=guard(Shelf(props({selectedId:'a',onSelect:noop})));
 assert.deepEqual(kept.props.ids.split('\n'),['p','a','b']);
 const filtered=guard(Shelf(props({selectedId:'a',onSelect:noop,query:'黛玉'})));
 assert.deepEqual(filtered.props.ids.split('\n'),['b'],'the filtered view no longer contains the selection');
 const deleted=guard(Shelf(props({selectedId:'a',onSelect:noop,stories:[story('b','黛玉葬花')]})));
 assert.ok(!deleted.props.ids.split('\n').includes('a'));
 // 守卫的效果：选中项不在列表中时调用 onSelect(null)
 const html=renderToStaticMarkup(createElement(Shelf,props({selectedId:'a',onSelect:noop,query:'黛玉'})));assert.doesNotMatch(html,/is-selected/);
});

test('production rows retain selection while opening their workflow independently of reading',()=>{
 const resumed=[],opened=[];
 const tree=Shelf(props({selectedId:'p',onSelect:noop,onResume:s=>resumed.push(s.id),onOpen:s=>opened.push(s.id)}));
 const selected=find(tree,node=>node.props?.['data-story-id']==='p')[0];
 assert.match(selected.props.className,/is-selected/);
 const button=find(selected,node=>node.props?.className==='yu-pending-story')[0];
 assert.equal(button.props['aria-pressed'],true);button.props.onClick();
 assert.deepEqual(resumed,['p']);assert.deepEqual(opened,[]);
 const guard=find(tree,node=>typeof node.type==='function'&&node.type.name==='SelectionGuard')[0];
 assert.ok(guard.props.ids.split('\n').includes('p'));
});
