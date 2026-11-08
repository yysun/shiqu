// 跨布局切换保留输入：模块级保留表的保存、清除与重新初始化；创建设置在恢复后不误报远端修改，
// 而服务器保存值真正变化时仍提示；标题输入只在会话或目标标题变化时重置。
// 组件以最小 React 替身直接调用：useState 按单元格保存，useEffect 在渲染后按依赖执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const compiled=build({stdin:{contents:"export {useRetainedState,retain,clearRetained,hasRetained} from './client/ui/useRetainedState.ts';export {default as Setup} from './client/ui/StoryCreationSetup.tsx';export {default as Search} from './client/ui/StoryExtractionSearch.tsx';export {mount} from 'react';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},plugins:[{
 name:'mini-react',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mini'}));
  b.onLoad({filter:/.*/,namespace:'mini'},()=>({loader:'js',contents:`
   // 每次 mount 是一次新的挂载：单元格与已执行的依赖都重新开始
   let cells,cursor,effects,deps;
   export function mount(component,props){cells=[];deps=[];const instance={render(next=props){props=next;cursor=0;effects=[];const tree=component(props);for(const run of effects)run();cursor=0;effects=[];return component(props);},cells:()=>cells};return instance;}
   export function useState(initial){const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]??={current:value};}
   // 被打包但不在本测试中执行的子组件所需的其余导出
   export const Fragment=Symbol.for('react.fragment');export function useId(){return 'id';}export function useCallback(fn){return fn;}export function useMemo(fn){return fn();}export function memo(component){return component;}
   export function useEffect(fn,list){const index=cursor++;effects.push(()=>{if(deps[index]&&list&&list.every((v,i)=>Object.is(v,deps[index][i])))return;deps[index]=list;fn();});}
  `}));
 }
}]});
async function load(){const result=await compiled,module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports;}
// 在元素树的全部属性里查找文本
function contains(node,text,seen=new Set()){
 if(node==null||typeof node==='boolean')return false;
 if(typeof node==='string'||typeof node==='number')return String(node).includes(text);
 if(typeof node!=='object'||seen.has(node))return false;seen.add(node);
 return Object.values(node.props??node).some(value=>contains(value,text,seen));
}

test('retained values survive a remount, clear by prefix, and re-initialize from props after clearing',async()=>{
 const {useRetainedState,retain,clearRetained,hasRetained,mount}=await load();
 const Field=({initial})=>{const [value,setValue]=useRetainedState('discovery:draft',initial);return {props:{value,setValue}};};
 let field=mount(Field,{initial:'甲'}),tree=field.render();assert.equal(tree.props.value,'甲');
 tree.props.setValue('乙');assert.equal(field.render().props.value,'乙');
 // 重新挂载（布局切换）取回输入，不读初始值
 field=mount(Field,{initial:'甲'});assert.equal(field.render().props.value,'乙');
 clearRetained('discovery:');assert.equal(hasRetained('discovery:draft'),false);
 field=mount(Field,{initial:'丙'});assert.equal(field.render().props.value,'丙');
 // 未传 key 时与 useState 相同，不写入保留表
 const Plain=()=>{const [value,setValue]=useRetainedState(undefined,'x');return {props:{value,setValue}};};
 const plain=mount(Plain,{});plain.render().props.setValue('y');assert.equal(mount(Plain,{}).render().props.value,'x');
 retain(undefined,'ignored');
});

const settings={artStyle:'paper-cut',productionPrompt:'清楚的旁白。',narrativeDetail:'brief'};
const session=draft=>({id:'s1',selection:{bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'选择',artStyle:'paper-cut',productionPrompt:'清楚的旁白。',narrativeDetail:'brief',length:'auto',voice:false},state:'idle',ready:0,story:null,error:null,awaitingFrameCount:false,retryAllowed:false,generationMode:'background',generationControl:'active',
 intake:{phase:'confirming',generation:1,search:{state:'idle'},selected:{batch:0,index:0},batches:[{stories:[{title:'庄周梦蝶'}],note:''}],draft},generationProgress:{sourceReady:true,frameCountConfirmed:false,phase:'production-confirmation'}});
const props=s=>({session:s,book:'庄子',busy:false,onAction:async()=>{},retainKey:'setup:s1',progress:{busy:false,controlBusy:false,error:'',onControl:async()=>{},onRetry:()=>{},onBack:()=>{}}});
const notice='另一台设备更新了制作内容';

test('restored setup keeps unsaved edits without a remote-change notice; a real server change still raises it',async()=>{
 const {Setup,retain,clearRetained,mount}=await load();
 const saved={...settings,length:'auto'},savedKey=JSON.stringify(saved),edited={...saved,productionPrompt:'我改过的要求。'};
 // 手机上编辑未保存，切换布局后桌面重新挂载
 clearRetained('setup:');retain('setup:s1:settings',edited);retain('setup:s1:baseline',savedKey);retain('setup:s1:remote',false);
 let setup=mount(Setup,props(session(settings)));let tree=setup.render();tree=setup.render();
 assert.equal(contains(tree,notice),false,'no false notice after the layout switch');
 assert.equal(setup.cells().find(cell=>cell?.productionPrompt)?.productionPrompt,'我改过的要求。','the unsaved edit survives');
 // 布局切换期间服务器保存值真的变了：未保存的修改与之不同，按原逻辑提示
 clearRetained('setup:');retain('setup:s1:settings',edited);retain('setup:s1:baseline',savedKey);retain('setup:s1:remote',false);
 setup=mount(Setup,props(session({...settings,productionPrompt:'另一台设备保存的要求。'})));tree=setup.render();tree=setup.render();
 assert.equal(contains(tree,notice),true,'a real server change raises the notice');
 // 没有保留内容的挂载照旧：直接采用保存值，不提示
 clearRetained('setup:');setup=mount(Setup,props(session(settings)));tree=setup.render();tree=setup.render();
 assert.equal(contains(tree,notice),false);
 clearRetained('setup:');
});

test('提取页直接继续旧草稿，已开始的任务不重复提交标题',async()=>{
 const {Setup,mount}=await load();
 const draft=session(settings);
 draft.intake={...draft.intake,phase:'choosing',selected:undefined,batches:[]};
 const actions=[];
 const input={...props(draft),onAction:async command=>actions.push(command)};
 const setup=mount(Setup,input);
 const first=setup.render();
 setup.render();
 assert.deepEqual(actions,[{action:'more'}]);
 assert.equal(contains(first,'按标题提取'),false);
 assert.equal(contains(first,'正在查找…'),true);
 const running={...draft,intake:{...draft.intake,phase:'discovering',search:{state:'searching'}}};
 mount(Setup,{...input,session:running}).render();
 assert.equal(actions.length,1);
});

test('查找详情与候选共用状态栏，切换视图不发起新查找',async()=>{
 const {Setup,mount}=await load();
 const draft=session(settings);
 const batch={stories:[{title:'濠梁之辩'}],note:''};
 const intake={...draft.intake,phase:'choosing',selected:undefined,batches:[batch]};
 const actions=[];
 const input={...props(draft),retainKey:undefined,onAction:async command=>actions.push(command)};
 const snapshot=(search,more={})=>({...input,session:{...draft,intake:{...intake,search,...more}}});
 const reading={stage:'verifying',completed:1,total:2,completedChars:100,totalChars:200,currentChapters:['齐物论']};
 const running=snapshot({state:'searching'},{progress:reading});
 const picker=mount(Setup,running);
 function find(node,label){
  if(Array.isArray(node))return node.map(child=>find(child,label)).find(Boolean);
  if(!node?.props)return;
  return node.props.children===label?node:find(node.props.children,label);
 }
 let tree=picker.render();
 assert.equal(contains(tree,'正在查找… 已找到 1 篇'),true);
 assert.equal(find(tree,'继续查找').props.disabled,true);
 find(tree,'查找详情').props.onClick();tree=picker.render();
 assert.equal(contains(tree,'齐物论 · 已处理 1 / 2 篇候选 · 已处理 100 / 200 字'),true);
 assert.equal(contains(tree,'濠梁之辩'),false);
 tree=picker.render(snapshot({state:'idle'},{batches:[batch,{stories:[],note:'原文已读完。'}]}));
 assert.equal(contains(tree,'原文已读完。'),true);
 find(tree,'返回候选').props.onClick();tree=picker.render();
 assert.equal(contains(tree,'濠梁之辩'),true);
 assert.deepEqual(actions,[]);
 find(tree,'继续查找').props.onClick();
 assert.deepEqual(actions,[{action:'more'}]);
});

test('title search keeps typed input across a remount and resets only when the session or title changes',async()=>{
 const {Search,clearRetained,mount}=await load();
 const base={sessionId:'s1',title:undefined,local:true,busy:false,hasCandidates:false,onSearch:async()=>true,retainKey:'search:s1'};
 const input=tree=>contains(tree,'按标题提取');
 clearRetained('search:');
 let search=mount(Search,base);let tree=search.render();assert.equal(input(tree),true);
 // 通过元素树里的按钮触发与界面相同的 setter
 const find=(node,predicate,seen=new Set())=>{if(!node||typeof node!=='object'||seen.has(node))return null;seen.add(node);if(predicate(node))return node;for(const value of Object.values(node.props??{})){for(const child of [value].flat(Infinity)){const found=find(child,predicate,seen);if(found)return found;}}return null;};
 find(tree,node=>node.props?.children==='输入标题').props.onClick();
 tree=search.render();find(tree,node=>node.type==='input').props.onChange({target:{value:'乌龟报恩'}});
 tree=search.render();assert.equal(find(tree,node=>node.type==='input').props.value,'乌龟报恩');
 // 重新挂载：保留输入，重置效果不清空
 search=mount(Search,base);tree=search.render();tree=search.render();
 assert.equal(find(tree,node=>node.type==='input')?.props.value,'乌龟报恩');
 // 目标标题真的变了：按原逻辑重置为新标题
 search=mount(Search,{...base,title:'勇士护民'});tree=search.render();tree=search.render();
 assert.equal(find(tree,node=>node.type==='input')?.props.value,'勇士护民');
 clearRetained('search:');
});
