// 用真实修订组件检查关闭保护与保存预览。合并只模拟 React 状态和对话框 DOM，重新编排走正式修订接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement,isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {revisionImpact} from '../lib/reader-revision.ts';
import {makePlan,productionFixture,selection} from './fixtures/production.mjs';
import {completedStory,saved} from './fixtures/production-dag-story.mjs';

const compiled=build({stdin:{contents:`
 export {default as StoryScript} from './client/ui/StoryScript.tsx';
 export {default as StorySheet} from './client/ui/StorySheet.tsx';
 export {StoryRevisionActions} from './client/ui/StoryRevisionEditor.tsx';
 export {DISCARD_PROMPT} from './client/ui/historySteps.ts';
`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const require=createRequire(import.meta.url);
async function components(react=require('react')){
 const bundle=await compiled,module={exports:{}};
 new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),module,module.exports);
 return module.exports;
}
function elements(node){
 if(Array.isArray(node))return node.flatMap(elements);
 if(!isValidElement(node))return [];
 return [node,...elements(node.props.children)];
}

test('closing before 预览合并 confirms edits to either field and keeps them when declined',async t=>{
 let cells,cursor;
 const react={...require('react'),useEffect(){},useState(initial){
  const index=cursor++;
  if(!(index in cells))cells[index]=initial;
  return [cells[index],next=>{cells[index]=typeof next==='function'?next(cells[index]):next;}];
 },useRef(initial){
  const index=cursor++;
  return cells[index]??={current:initial};
 }};
 const {StoryScript,StorySheet,DISCARD_PROMPT}=await components(react);
 const render=(state,component,props)=>{cells=state;cursor=0;return component(props);};
 const scriptState=[],sheetState=[],plan=makePlan(3);
 const base={selection,plan,images:[]},changes={};
 const editor={base,changes,impact:revisionImpact(base,changes),setChanges:()=>assert.fail('no preview or save should occur')};
 const script=()=>render(scriptState,StoryScript,{story:{title:plan.title},editor});
 const scriptNodes=()=>elements(script());
 scriptNodes().find(node=>node.props.children==='选择').props.onClick();
 for(const number of [1,2])scriptNodes().find(node=>node.props.number===number).props.onSelect();
 scriptNodes().find(node=>node.type==='button'&&node.props.children==='合并').props.onClick();

 let closed=0,discard=false;
 const confirmations=[];
 globalThis.window={confirm:message=>{confirmations.push(message);return discard;}};
 t.after(()=>{delete globalThis.window;});
 function attemptClose(method){
  const content=script(),sheet=render(sheetState,StorySheet,{title:'分镜剧本',children:content,onClose:()=>closed++});
  sheet.props.ref.current={querySelector:selector=>elements(content).find(node=>selector==='[data-dirty="true"]'&&node.props['data-dirty']==='true')};
  if(method==='escape')sheet.props.onCancel({preventDefault(){}});
  else elements(sheet).find(node=>node.props['aria-label']==='关闭').props.onClick();
 }
 const inputs=()=>scriptNodes().filter(node=>node.type==='textarea');
 attemptClose('button');
 assert.equal(closed,1,'opening the merge form without typing does not prompt');
 assert.deepEqual(confirmations,[]);
 for(const [index,method] of [[0,'button'],[1,'escape']]){
  const {value,onChange}=inputs()[index].props,edited=value+' 手动补充。';
  onChange({target:{value:edited}});
  attemptClose(method);
  assert.equal(closed,1,'declining discard leaves the sheet open');
  assert.equal(inputs()[index].props.value,edited);
  assert.equal(confirmations.at(-1),DISCARD_PROMPT);
  inputs()[index].props.onChange({target:{value}});
 }
 assert.deepEqual(confirmations,[DISCARD_PROMPT,DISCARD_PROMPT]);
 attemptClose('button');
 assert.equal(closed,2,'restoring the original fields clears the guard');
 inputs()[0].props.onChange({target:{value:'尚未预览的新旁白。'}});
 discard=true;
 attemptClose('button');
 assert.equal(closed,3,'accepting discard closes the sheet without applying the merge');
 assert.equal(confirmations.length,3);
});

test('replanning a partially drawn story warns about saved drawings and leaves the new count pending',async t=>{
 const {StoryRevisionActions}=await components();
 const f=await productionFixture(t),{id}=await completedStory(f);
 const doc=await saved(f,id);
 for(const page of [2,4]){
  const key=doc.dag.order[page-1];
  delete doc.dag.frames[key].image;
  delete doc.dag.products['frameImage:'+key];
  doc.images[page-1]='';
 }
 await f.app.services.database.prepare("UPDATE stories SET document=?,production_complete=0,generation_control='paused' WHERE id=?").bind(JSON.stringify(doc),id).run();
 const route=`sessions/${id}/revisions`,base=await f.json(route);
 const changes={narrativeDetail:'detailed',length:'auto'};
 const preview=await f.json(route+'/preview','POST',{token:base.token,changes});
 assert.deepEqual(base.images.flatMap((image,index)=>image?[index+1]:[]),[1,3,5,6]);
 assert.deepEqual(preview.redrawPages,[1,2,3,4,5,6]);

 const editor={base,changes,preview,impact:{...revisionImpact(base,changes),estimated:true}};
 const markup=renderToStaticMarkup(createElement(StoryRevisionActions,{editor}));
 assert.match(markup,/原有 4 幅图将失效。新版幅数待编排，最终绘制幅数以编排和审核结果为准。/);
 assert.doesNotMatch(markup,/原有 6 幅图|继续后将重绘第/);
});
