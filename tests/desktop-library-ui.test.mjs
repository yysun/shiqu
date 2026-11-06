// 桌面书架：传入 onSelect 时封面与标题按钮改为选择，底部“继续阅读/重读”与制作行仍直接打开；
// 选中的故事被筛掉时清除选中；不传 onSelect 时标记不变。详情面板的每个操作调用对应处理函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const load=async contents=>{const bundle=await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'cjs',packages:'external'});const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);return compiled.exports;};
const {default:Shelf}=await load("export {default} from './client/ui/ReaderShelf.tsx';");
const noop=()=>{};
const story=(id,title)=>({id,bookId:'honglou',title,theme:'爱情与错过',pages:Array.from({length:3},()=>({image:'/saved.png'}))});
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
 assert.doesNotMatch(html,/选择《|data-story-id|is-selected|aria-pressed="(?:true|false)" class="yu-shelf-card/);
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
 assert.deepEqual(kept.props.ids.split('\n'),['a','b']);
 const filtered=guard(Shelf(props({selectedId:'a',onSelect:noop,query:'黛玉'})));
 assert.deepEqual(filtered.props.ids.split('\n'),['b'],'the filtered view no longer contains the selection');
 const deleted=guard(Shelf(props({selectedId:'a',onSelect:noop,stories:[story('b','黛玉葬花')]})));
 assert.ok(!deleted.props.ids.split('\n').includes('a'));
 // 守卫的效果：选中项不在列表中时调用 onSelect(null)
 const html=renderToStaticMarkup(createElement(Shelf,props({selectedId:'a',onSelect:noop,query:'黛玉'})));assert.doesNotMatch(html,/is-selected/);
});

// 详情面板用最小 hook 替身直接调用，得到元素树后点击真实按钮
const mini={name:'mini-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mini'}));b.onLoad({filter:/.*/,namespace:'mini'},()=>({loader:'js',contents:'export function useRef(v){return {current:v};}export function useEffect(){}export function useState(v){return [v,()=>{}];}'}));}};
const detailBundle=await build({stdin:{contents:"export {default} from './client/ui/ShelfStoryDetail.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'cjs',packages:'external',plugins:[mini]});
const detailModule={exports:{}};new Function('require','module','exports',detailBundle.outputFiles[0].text)(createRequire(import.meta.url),detailModule,detailModule.exports);
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
test('every detail action calls its handler',()=>{
 const calls=[];const record=name=>(...args)=>calls.push([name,...args]);
 const detailProps={story:story('a','宝玉探病'),meta:['红楼梦','爱情与错过','国漫'],page:0,saved:false,open:true,drawerForm:true,onClose:record('close'),onRead:record('read'),onWorkflow:record('workflow'),downloads:createElement('span',null,'downloads'),exportStatus:'',onFavorite:record('favorite'),favoriteBusy:false,onRename:record('rename'),onPublication:record('publication'),onDelete:record('delete')};
 const tree=detailModule.exports.default(detailProps);
 const button=label=>find(tree,node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label))[0];
 for(const label of ['阅读','制作流程','收藏','修改故事名','署名与转载','删除故事','关闭详情'])button(label).props.onClick();
 assert.deepEqual(calls,[['read',false],['workflow'],['favorite'],['rename'],['publication'],['delete'],['close']]);
 assert.equal(text(find(tree,node=>node.type==='section')[0]).includes('downloads'),true,'downloads are rendered');
 // 在抽屉里按 Escape 关闭
 find(tree,node=>node.type==='aside')[0].props.onKeyDown({key:'Escape',stopPropagation:noop});assert.equal(calls.at(-1)[0],'close');
 // 已读完时主按钮为“重读”并从头开始；停靠形式没有关闭按钮，Escape 不关闭
 calls.length=0;const docked=detailModule.exports.default({...detailProps,page:2,drawerForm:false});
 find(docked,node=>node.type==='button'&&text(node).includes('重读'))[0].props.onClick();assert.deepEqual(calls,[['read',true]]);
 assert.equal(find(docked,node=>node.props?.['aria-label']==='关闭详情').length,0);
 find(docked,node=>node.type==='aside')[0].props.onKeyDown({key:'Escape',stopPropagation:noop});assert.equal(calls.length,1);
});
