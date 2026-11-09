// Keep partially restored reading history hidden until the home library is ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {makeStory} from './fixtures/story.mjs';
import {recentShelfHeroes} from '../lib/reader-home.ts';

const bundle=await build({entryPoints:['client/ui/RecentStories.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const RecentStories=compiled.exports.default;
const fixture=makeStory(),story={id:fixture.id,title:fixture.title,theme:fixture.theme,bookId:fixture.bookId,frameCount:fixture.pages.length,cover:fixture.pages[0].image,resumePage:2,resumeImage:fixture.pages[2].image};
const items=recentShelfHeroes([story],story.id,[{storyId:story.id,page:2}]);
const render=(loading,rows=items)=>renderToStaticMarkup(createElement(RecentStories,{items:rows,loading,bookName:()=> '聊斋志异',onOpen(){}}));

test('loading hides both cached story cards and the first-use empty state',()=>{
 for(const rows of [items,[]]){
  const html=render(true,rows);
  assert.match(html,/role="status" aria-busy="true"/);
  assert.match(html,/正在打开故事…/);
  assert.doesNotMatch(html,/继续阅读|把下一篇故事留在这里|<img/);
 }
});

test('settled history shows the resume card or the first-use empty state',()=>{
 const html=render(false);
 assert.match(html,new RegExp(story.title));
 assert.match(html,/继续阅读 · 3/);
 assert.doesNotMatch(html,/正在打开故事…/);
 const empty=render(false,[]);
 assert.match(empty,/把下一篇故事留在这里/);
 assert.doesNotMatch(empty,/正在打开故事…/);
});

test('a story read to its last frame offers a restart instead of resuming',()=>{
 const last=story.frameCount-1,finished=recentShelfHeroes([story],story.id,[{storyId:story.id,page:last}]);
 const html=renderToStaticMarkup(createElement(RecentStories,{items:finished,loading:false,bookName:()=> '聊斋志异',onOpen(){}}));
 assert.match(html,new RegExp(`aria-label="重读${story.title}"`));
 assert.match(html,new RegExp(`已读完 · 重读 · ${story.frameCount} 幅`));
 assert.doesNotMatch(html,/继续阅读/);
});

// 用真实组件的事件与观察器回调验证缩放，不依赖浏览器的滚动吸附实现。
test('resize keeps the selected story before observer delivery and after remount',()=>{
 const effects=[],refs=[];
 const harness={exports:{}};
 let cursor=0;
 const require=createRequire(import.meta.url);
 new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?{...require(name),useRef:value=>refs[cursor++]??(refs[cursor-1]={current:value}),useLayoutEffect:effect=>effects.push(effect)}:require(name),harness,harness.exports);
 const Component=harness.exports.default;
 const rows=[...items,{...items[0],story:{...story,id:'second-story'}}];
 let selected='second-story',resize;
 const oldObserver=globalThis.ResizeObserver;
 globalThis.ResizeObserver=class{constructor(callback){resize=callback;}observe(){}disconnect(){}};
 try{
  function mount(){
   cursor=0;refs.length=0;effects.length=0;
   const tree=Component({items:rows,loading:false,bookName:()=>'',onOpen(){},activeStoryId:selected,onActiveStoryChange:id=>{selected=id;}});
   const track=tree.props.children[0];
   const el={clientWidth:400,scrollLeft:0,style:{},scrollTo({left}){this.scrollLeft=left;}};
   track.props.ref.current=el;
   effects.forEach(effect=>effect());
   return {track,el};
  }
  let {track,el}=mount();
  assert.equal(el.scrollLeft,400);
  el.clientWidth=700;
  track.props.onScroll({currentTarget:el});
  assert.equal(selected,'second-story');assert.equal(el.scrollLeft,700);
  el.clientWidth=320;resize();
  assert.equal(el.scrollLeft,320);
  track.props.onScroll({currentTarget:el});
  assert.equal(selected,'second-story');
  ({track,el}=mount());
  assert.equal(el.scrollLeft,400);
  el.scrollLeft=0;track.props.onScroll({currentTarget:el});
  assert.equal(selected,story.id);
 }finally{globalThis.ResizeObserver=oldObserver;}
});
