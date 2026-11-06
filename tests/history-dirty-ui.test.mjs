// 未保存输入的标记：新建表单、标题查找、改名与署名表单只在输入与打开时不同后才带 data-dirty，
// 返回键与 Escape 据此询问。组件以替换后的 hooks 直接调用，读取渲染结果上的属性。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const compiled=build({stdin:{contents:"export {default as Discovery} from './client/ui/StoryDiscoveryForm.tsx';export {default as Search} from './client/ui/StoryExtractionSearch.tsx';export {default as Title} from './client/ui/StoryTitleEditor.tsx';export {default as Publication} from './client/ui/StoryPublication.tsx';export {beginRender,reset} from 'react';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},plugins:[{
 name:'dirty-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'dirty'}));
  b.onLoad({filter:/.*/,namespace:'dirty'},()=>({loader:'js',contents:`
   let cells=[];let cursor=0;export function beginRender(){cursor=0;}export function reset(){cells=[];cursor=0;}
   export function useState(initial){const index=cursor++;if(!(index in cells))cells[index]=typeof initial==='function'?initial():initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]??={current:value};}
   export function useEffect(){}
  `}));
 }
}]});
async function load(){const result=await compiled,module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports;}
function find(node,predicate){
 if(!node||typeof node!=='object')return null;
 if(predicate(node))return node;
 for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
 return null;
}
const marked=tree=>!!find(tree,node=>node.props?.['data-dirty']==='true');

test('the creation form is marked only after its choices or text change',async()=>{
 const {Discovery,beginRender,reset}=await load();reset();
 const selection={bookId:'liaozhai',theme:'原典故事',artStyle:'ink-pencil',productionPrompt:'',length:'auto',narrativeDetail:'balanced',voice:false};
 const render=()=>{beginRender();return Discovery({selection,books:[{id:'liaozhai',title:'聊斋志异'},{id:'zhuangzi',title:'庄子'}],busy:false,error:'',onBookChange(){},onSubmit:async()=>{}});};
 assert.equal(marked(render()),false,'freshly opened');
 find(render(),node=>node.type==='button'&&node.props.children==='其他').props.onClick();
 assert.equal(marked(render()),true,'a theme choice is a change');
 reset();assert.equal(marked(render()),false);
 find(render(),node=>node.type==='button'&&node.props.children==='庄子').props.onClick();
 assert.equal(marked(render()),true,'a book choice is a change');
});

test('the title search is marked while its typed title differs from the target',async()=>{
 const {Search,beginRender,reset}=await load();reset();
 const render=()=>{beginRender();return Search({sessionId:'s',title:'乌龟报恩',local:true,busy:false,hasCandidates:false,onSearch:async()=>true});};
 assert.equal(marked(render()),false);
 find(render(),node=>node.type==='input').props.onChange({target:{value:'宋公明三败高俅'}});
 assert.equal(marked(render()),true);
 find(render(),node=>node.type==='input').props.onChange({target:{value:'乌龟报恩'}});
 assert.equal(marked(render()),false,'typing the target back clears the mark');
});

test('rename and the publication editor are marked only with unsaved changes',async()=>{
 const {Title,Publication,beginRender,reset}=await load();reset();
 const title=()=>{beginRender();return Title({title:'原名',onClose(){},onSave:async()=>{}}).props.children;};
 assert.equal(marked(title()),false);
 find(title(),node=>node.type==='input').props.onChange({target:{value:'新名'}});
 assert.equal(marked(title()),true);
 reset();
 const publication=()=>{beginRender();return Publication({publication:null,onClose(){},onSave:async()=>{}}).props.children;};
 assert.equal(marked(publication()),false);
 find(publication(),node=>node.type==='input'&&node.props.placeholder?.startsWith('你的姓名')).props.onChange({target:{value:'山间读书人'}});
 assert.equal(marked(publication()),true);
});
