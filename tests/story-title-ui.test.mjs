// Exercise the naming form's cancellation, validation, duplicate-submit lock and retryable errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {until} from './fixtures/production.mjs';

const compiled=build({stdin:{contents:"export {default as Editor} from './client/ui/StoryTitleEditor.tsx';export {beginRender} from 'react';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{
 name:'title-form-hooks',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'title'}));
  b.onLoad({filter:/.*/,namespace:'title'},()=>({loader:'js',contents:`
   const cells=[];let cursor=0;export function beginRender(){cursor=0;}
   export function useState(initial){const index=cursor++;if(!(index in cells))cells[index]=initial;return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];}
   export function useRef(value){const index=cursor++;return cells[index]??={current:value};}
   export function useEffect(){}
  `}));
 }
}]});
function find(node,predicate){
 if(!node||typeof node!=='object')return null;
 if(predicate(node))return node;
 for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
 return null;
}
test('cancel never saves; whitespace is rejected; a failed save keeps the draft and can be retried once',async()=>{
 const result=await compiled,module={exports:{}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 const {Editor,beginRender}=module.exports;
 let closed=0,release,fail=true;const names=[];
 const render=()=>{beginRender();return Editor({title:'原名',onClose:()=>closed++,onSave:async name=>{
  names.push(name);await new Promise(resolve=>release=resolve);if(fail)throw Error('保存失败，请重试。');
 }});};
 const input=()=>find(render(),node=>node.type==='input');
 const submit=()=>find(render(),node=>node.type==='form').props.onSubmit({preventDefault(){}});
 const button=()=>find(render(),node=>node.props?.type==='submit');
 assert.equal(button().props.disabled,true);
 find(render(),node=>node.type==='button'&&node.props.children==='取消').props.onClick();
 assert.equal(closed,1);assert.deepEqual(names,[]);closed=0;
 input().props.onChange({target:{value:'   '}});assert.equal(button().props.disabled,true);
 input().props.onChange({target:{value:'  新故事名  '}});assert.equal(button().props.disabled,false);
 submit();submit();assert.deepEqual(names,['新故事名']);assert.equal(render().props.busy,true);
 release();await until(()=>render().props.busy===false);
 assert.equal(find(render(),node=>node.props?.role==='alert').props.children,'保存失败，请重试。');
 assert.equal(input().props.value,'  新故事名  ');assert.equal(closed,0);
 fail=false;submit();release();await until(()=>closed===1);
 assert.deepEqual(names,['新故事名','新故事名']);
});
