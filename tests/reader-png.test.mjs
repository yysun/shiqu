// Verify contact-sheet completeness and text bounds across supported story sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedStory} from '../lib/content.ts';
import {assertPngReady,layoutStoryPng,pngFilename} from '../lib/reader-png.ts';

const measure=(text,size)=>Array.from(text).length*size;
test('PNG export requires every image and produces a safe PNG filename',()=>{
 const story=seedStory();
 assert.throws(()=>assertPngReady({...story,pages:[]}),/所有画面/);
 assert.throws(()=>assertPngReady({...story,pages:story.pages.map((p,i)=>i===4?{...p,image:''}:p)}),/所有画面/);
 assert.equal(pngFilename('故事/名字?'),'故事名字-拾趣-一页.png');
});

test('contact sheets retain all frames in reading order for 4, 8, 10, 12 and 16 pages',()=>{
 for(const count of [4,8,10,12,16]){
  const base=seedStory(),story={...base,pages:Array.from({length:count},(_,i)=>({...base.pages[i%10],caption:`第${i+1}幅：保留每一个故事细节。`}))};
  const layout=layoutStoryPng(story,measure);
  assert.equal(layout.cells.length,count);
  assert.deepEqual(layout.cells.map(cell=>cell.index),Array.from({length:count},(_,i)=>i));
  assert.equal(new Set(layout.cells.map(cell=>`${cell.x},${cell.y}`)).size,count);
  assert.ok(layout.cells.every(cell=>cell.x>=0&&cell.x+420<=layout.width&&cell.y+630<layout.footerY));
  layout.cells.forEach((cell,i)=>assert.equal(cell.caption.join(''),story.pages[i].caption));
  assert.ok(layout.height>layout.footerY+layout.reflection.length*56);
  if(count===10){assert.equal(layout.columns,5);assert.equal(new Set(layout.cells.map(cell=>cell.y)).size,2);}
 }
});

test('long titles, narration and reflections expand the layout without overlapping later rows',()=>{
 const base=seedStory();
 const story={...base,title:'很长的故事标题'.repeat(10),reflection:'留下一句值得慢慢回味的话。'.repeat(20),pages:Array.from({length:12},(_,i)=>({...base.pages[i%10],caption:i===0?'一段很长的旁白，需要完整保留而不是截断。'.repeat(20):'简短旁白。'}))};
 const layout=layoutStoryPng(story,measure);
 assert.ok(layout.title.length>1);assert.ok(layout.reflection.length>1);
 for(const cell of layout.cells){
  assert.ok(cell.caption.every(line=>measure(line,26)<=420));
  const nextRow=layout.cells.find(other=>other.y>cell.y);
  const bottom=cell.y+630+58+cell.caption.length*42;
  assert.ok(bottom<(nextRow?.y??layout.footerY));
 }
 assert.ok(layout.title.every(line=>measure(line,52)<=layout.width-72));
 assert.ok(layout.reflection.every(line=>measure(line,36)<=layout.width-72));
 assert.equal(layout.cells[0].caption.join(''),story.pages[0].caption);
 assert.equal(layout.reflection.join(''),'余味：'+story.reflection);
});
