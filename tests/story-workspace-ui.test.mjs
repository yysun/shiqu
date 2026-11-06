// 故事工作区：分区标签按传入的可用分区显示并标出当前分区；分镜列表选择分镜；右栏显示所选分镜的画面、
// 旁白与该幅审片问题（0 为结语）；返回与切换分区调用对应处理函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const mini={name:'mini-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mini'}));b.onLoad({filter:/.*/,namespace:'mini'},()=>({loader:'js',contents:'export function useRef(v){return {current:v};}export function useEffect(){}export function useState(v){return [v,()=>{}];}export function useSyncExternalStore(s,get,server){return server();}'}));}};
const bundle=await build({stdin:{contents:"export {default} from './client/ui/StoryWorkspace.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'cjs',packages:'external',plugins:[mini]});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const Workspace=module.exports.default;
function find(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){for(const child of node)find(child,predicate,out);return out;}if(predicate(node))out.push(node);for(const value of Object.values(node.props??{}))if(value&&typeof value==='object')find(value,predicate,out);return out;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
const story={id:'s',title:'庄周梦蝶',reflection:'梦与醒的分界。',pages:[{image:'/1.png',caption:'第一幅旁白'},{image:'',caption:'第二幅旁白'}]};
const issues=[{page:1,category:'caption',problem:'第一幅的问题',instruction:'改第一幅'},{page:0,category:'caption',problem:'结语的问题',instruction:'改结语'}];

test('tabs follow the available sections and mark the current one; back and tabs call their handlers',()=>{
 const calls=[];
 const tree=Workspace({title:'庄周梦蝶',section:'edit',sections:['flow','edit','source'],onSection:s=>calls.push(['section',s]),onBack:()=>calls.push(['back']),story,frame:1,onFrame:noop,issues,children:'中栏'});
 const tabs=find(tree,node=>node.props?.['aria-label']==='工作区分区')[0];
 assert.deepEqual(find(tabs,node=>node.type==='button').map(text),['制作流程','修改故事','原文']);
 assert.equal(find(tabs,node=>node.props?.['aria-current']==='page').map(text)[0],'修改故事');
 find(tabs,node=>node.type==='button'&&text(node)==='原文')[0].props.onClick();
 find(tree,node=>node.type==='button'&&text(node).includes('返回'))[0].props.onClick();
 assert.deepEqual(calls,[['section','source'],['back']]);
 assert.equal(text(find(tree,node=>node.type==='main')[0]),'中栏');
});

test('the frame list selects frames and the preview shows the selected frame, its caption and only its issues',()=>{
 const picked=[];
 const tree=Workspace({title:'t',section:'flow',sections:['flow'],onSection:noop,onBack:noop,story,frame:1,onFrame:n=>picked.push(n),issues,children:null});
 const frames=find(tree,node=>node.props?.['aria-label']==='分镜')[0];
 assert.deepEqual(find(frames,node=>node.type==='button').map(node=>node.props['aria-label']),['选择第 1 幅','选择第 2 幅','选择结语']);
 assert.equal(find(frames,node=>node.props?.['aria-current']==='true')[0].props['aria-label'],'选择第 1 幅');
 find(frames,node=>node.props?.['aria-label']==='选择第 2 幅')[0].props.onClick();assert.deepEqual(picked,[2]);
 const preview=find(tree,node=>node.type==='aside')[0];
 assert.equal(find(preview,node=>node.type==='img')[0].props.src,'/1.png');
 assert.match(text(preview),/第一幅旁白/);assert.match(text(preview),/第一幅的问题/);assert.doesNotMatch(text(preview),/结语的问题/);
 // 未绘制的分镜显示绘制中；结语显示结语文字与 page 0 的问题
 const pending=find(Workspace({title:'t',section:'flow',sections:['flow'],onSection:noop,onBack:noop,story,frame:2,onFrame:noop,issues,children:null}),node=>node.type==='aside')[0];
 assert.match(text(pending),/这一幅还在绘制/);assert.match(text(pending),/没有待处理的审片问题/);
 const ending=find(Workspace({title:'t',section:'flow',sections:['flow'],onSection:noop,onBack:noop,story,frame:0,onFrame:noop,issues,children:null}),node=>node.type==='aside')[0];
 assert.match(text(ending),/梦与醒的分界/);assert.match(text(ending),/结语的问题/);assert.doesNotMatch(text(ending),/第一幅的问题/);
});
function noop(){}
