// 验证阅读手势、书架导航与阅读进度、收藏状态的合并规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {decodePDFRawStream,PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream} from 'pdf-lib';
import {newWheelGesture,wheelPageDirection,wheelBackAtStart,wheelBackFromEnding,listenForEndingTouchSwipe,swipePageDirection,readerAtStart,readerCaptionOpacity} from '../lib/reader-navigation.ts';

test('the ending scrolls back to the final frame only from its top edge',()=>{
 const input=(y,time)=>({x:0,y,mode:0,time,height:800});
 const atTop=newWheelGesture();
 assert.equal(wheelBackAtStart(atTop,input(-30,0),true),0);
 assert.equal(wheelBackAtStart(atTop,input(-40,10),true),-1);
 assert.equal(wheelBackAtStart(atTop,input(-80,20),true),0,'inertia in the same gesture does not turn again');
 const coasting=newWheelGesture();
 assert.equal(wheelBackAtStart(coasting,input(-120,0),false),0,'scrolling the conclusion stays native');
 assert.equal(wheelBackAtStart(coasting,input(-120,50),true),0,'inertia reaching the top does not turn');
 assert.equal(wheelBackAtStart(coasting,input(-120,400),true),-1,'a new upward scroll at the top turns back');
 const down=newWheelGesture();
 assert.equal(wheelBackAtStart(down,input(120,0),true),0,'scrolling down never turns');
 const arrivingAfterTurn=newWheelGesture();
 assert.equal(wheelPageDirection(arrivingAfterTurn,input(70,0)),1);
 assert.equal(wheelPageDirection(arrivingAfterTurn,input(10,16)),0);
 assert.equal(wheelBackAtStart(arrivingAfterTurn,input(-30,32),false),0);
 assert.equal(wheelBackAtStart(arrivingAfterTurn,input(-70,48),true),0,'acceleration during an edge approach stays in the same gesture');
 assert.equal(wheelBackAtStart(arrivingAfterTurn,input(-70,400),true),-1);
});
test('a short right swipe leaves the ending on the final frame and absorbs its horizontal momentum',()=>{
 const gesture=newWheelGesture();
 const move=(time,x,atEnding,y=0)=>wheelBackFromEnding(gesture,{x,y,mode:0,time,height:800},atEnding);
 assert.equal(move(0,90,false),'native','a swipe from the last image enters the ending normally');
 assert.equal(move(30,-90,true),'hold','recoil from entering the ending cannot return immediately');
 assert.equal(move(400,-35,true),'hold');
 assert.equal(move(420,-30,true),'previous','the gesture threshold is independent of page width');
 assert.equal(move(440,-400,false),'hold','a large tail cannot skip the final image');
 assert.equal(move(455,0,false,100),'native','vertical scrolling keeps its own handling');
 assert.equal(move(470,20,false),'hold','the same swipe can rebound after turning');
 assert.equal(move(800,-90,false),'native','after the swipe settles, normal paging resumes');
});
test('ending touch swipes use the actual release position when Safari omits touch movement',()=>{
 const reader=new EventTarget(),offsets=[];
 let turns=0;
 const unlisten=listenForEndingTouchSwipe(reader,distance=>offsets.push(distance),()=>turns++);
 const point=(clientX,clientY)=>({identifier:1,clientX,clientY});
 const emit=(type,details)=>{
  const event=Object.assign(new Event(type,{cancelable:true}),details);
  reader.dispatchEvent(event);
  return event.defaultPrevented;
 };
 const start=()=>emit('touchstart',{touches:[point(40,55)]});
 const touchEnd=(x,y)=>emit('touchend',{changedTouches:[point(x,y)]});
 const pointerUp=(x,y)=>emit('pointerup',{pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
 start();touchEnd(40,55);pointerUp(260,55);
 assert.equal(turns,1,'a release farther right still turns when touchend repeats the start');
 start();touchEnd(40,55);pointerUp(40,55);
 assert.equal(turns,1,'taps do not turn');
 start();
 assert.equal(emit('touchmove',{touches:[point(44,80)]}),false,'vertical swipes stay native');
 touchEnd(120,90);pointerUp(120,90);
 assert.equal(turns,1,'a vertical scroll cannot turn by drifting sideways');
 start();
 assert.equal(emit('touchmove',{touches:[point(102,62)]}),true);
 assert.equal(touchEnd(120,62),true);
 pointerUp(120,62);
 assert.equal(turns,2,'touchend and pointerup together turn only once');
 assert.deepEqual(offsets,[62,0]);
 unlisten();
 start();pointerUp(260,55);
 assert.equal(turns,2,'the handler is removed when the ending closes');
});
test('a backward swipe must start with the first frame selected and centered to leave the reader',()=>{
 const gesture=newWheelGesture();
 const move=(time,page,left,x=-80)=>wheelBackAtStart(gesture,{x,y:0,mode:0,time,height:800},readerAtStart(page,left));
 assert.equal(move(0,1,400),0);
 assert.equal(move(25,1,0),0,'the filmstrip has reached the start but the first frame is not selected yet');
 assert.equal(move(50,0,0),0,'momentum continues after the first frame snaps into place');
 assert.equal(move(400,0,0),-1,'a fresh swipe from the centered first frame leaves the reader');
 assert.equal(readerAtStart(0,100),false,'swiping while the first frame moves into place stays in the reader');
 assert.equal(readerAtStart(0,0.5),true,'fractional alignment at the first frame counts as centered');
});
test('the caption fades with frame displacement and recovers as the frame re-centers',()=>{
 for(const width of [400,800])for(const direction of [-1,1]){
  const offsets=[0,.125,.25,.5,.75,.25,0];
  assert.deepEqual(offsets.map(offset=>readerCaptionOpacity(offset*width*direction,width)),[1,.75,.5,0,0,.5,1]);
 }
 assert.equal(readerCaptionOpacity(0,0),1);
});
import {defaultProductionDirection,defaultProductionPrompt,normalizeProductionPrompt,promptAfterThemeChange,directStorySettings} from '../lib/reader-prompts.ts';

test('a new trackpad flick turns again while the previous flick is still coasting',()=>{
 const gesture=newWheelGesture();
 const move=(time,y)=>wheelPageDirection(gesture,{time,x:0,y,mode:0,height:800});
 assert.equal(move(0,30),0);assert.equal(move(16,40),1);
 assert.equal(move(32,55),0,'the same flick keeps accelerating without a second turn');
 for(const [time,y] of [[48,40],[64,28],[80,18],[96,10]])assert.equal(move(time,y),0,'inertia decays without turning');
 assert.equal(move(112,45),0,'a new flick starts a new gesture');assert.equal(move(128,40),1);
 for(const [time,y] of [[144,30],[160,20],[176,12],[192,8],[208,5],[224,3]])assert.equal(move(time,y),0);
 assert.equal(move(240,-40),0);assert.equal(move(256,-30),-1,'a reversed flick during the tail turns back');
});
test('trackpad rebound cannot reverse or skip a page within the same gesture',()=>{
 const gesture=newWheelGesture();
 const move=(time,x,y=0)=>wheelPageDirection(gesture,{time,x,y,mode:0,height:800});
 assert.equal(move(0,20),0);assert.equal(move(30,50),1);
 for(let time=100;time<=1000;time+=100)assert.equal(move(time,time%200===0?-75:80),0);
 assert.equal(move(1400,-65),-1);
});
test('a single accelerated rebound cannot reverse a page turn after decay',()=>{
 const gesture=newWheelGesture();
 const move=(time,y)=>wheelPageDirection(gesture,{time,x:0,y,mode:0,height:800});
 assert.equal(move(0,70),1);
 assert.equal(move(16,30),0);
 assert.equal(move(32,10),0);
 assert.equal(move(48,-70),0);
 assert.equal(move(64,10),0,'movement returning to the original direction clears the reversal');
 assert.equal(move(80,3),0);
 assert.equal(move(96,-70),0);
 assert.equal(move(112,-35),-1,'a continuing reversal turns back');
});
test('mouse wheel units and small movements are handled consistently',()=>{
 const gesture=newWheelGesture();
 assert.equal(wheelPageDirection(gesture,{time:0,x:0,y:3,mode:1,height:800}),1);
 assert.equal(wheelPageDirection(gesture,{time:500,x:0,y:10,mode:0,height:800}),0);
 assert.equal(wheelPageDirection(gesture,{time:520,x:0,y:20,mode:0,height:800}),0);
 assert.equal(wheelPageDirection(gesture,{time:540,x:0,y:30,mode:0,height:800}),1);
 assert.equal(wheelPageDirection(gesture,{time:1000,x:0,y:-1,mode:2,height:800}),-1);
});
test('trackpad direction follows accumulated movement instead of initial cross-axis jitter',()=>{
 for(const axis of ['x','y'])for(const direction of [-1,1]){
  const gesture=newWheelGesture();
  const move=(time,main,cross)=>wheelPageDirection(gesture,{time,x:axis==='x'?main:cross,y:axis==='y'?main:cross,mode:0,height:800});
  assert.equal(move(0,direction*2,3),0);
  assert.equal(move(16,direction*30,1),0);
  assert.equal(move(32,direction*35,1),direction);
 }
});
test('a separate quick flick is accepted after idle without an additional cooldown',()=>{
 const gesture=newWheelGesture();
 const move=(time,x)=>wheelPageDirection(gesture,{time,x,y:0,mode:0,height:800});
 assert.equal(move(0,65),1);
 assert.equal(move(16,5),0);
 assert.equal(move(300,-65),-1);
 assert.equal(move(316,-10),0);
});
test('ambiguous diagonal wheel movement waits for a clear direction',()=>{
 const gesture=newWheelGesture();
 assert.equal(wheelPageDirection(gesture,{time:0,x:65,y:65,mode:0,height:800}),0);
 assert.equal(wheelPageDirection(gesture,{time:16,x:40,y:0,mode:0,height:800}),1);
});
test('themes share source-faithful production defaults while reader-written requirements remain intact',()=>{
 const original=defaultProductionPrompt('给我一个反转');
 assert.equal(original,defaultProductionPrompt('爱情与错过'));
 assert.equal(original,defaultProductionPrompt('成年人重新开始'));
 assert.equal(original,defaultProductionPrompt('忠于原文'));
 assert.equal(promptAfterThemeChange(original,'给我一个反转','爱情与错过'),defaultProductionPrompt('爱情与错过'));
 assert.equal(promptAfterThemeChange('旁白更克制，结尾不要提问。','给我一个反转','爱情与错过'),'旁白更克制，结尾不要提问。');
 assert.doesNotMatch(original,/成年人重新开始|开头制造一个可信的预期/);
 const shared=defaultProductionDirection.slice('按原文自身的事件、人物与因果展开，不额外套入主题或要求反转。'.length);
 const old='开头制造一个可信的预期，中段埋下细节，结尾用有因果依据的反转改变读者对人物的判断，不靠突然出现的新信息。'+shared;
 assert.equal(normalizeProductionPrompt(old,'给我一个反转'),original);
 assert.equal(promptAfterThemeChange(old,'给我一个反转','爱情与错过'),original);
 assert.equal(normalizeProductionPrompt('围绕“成年人重新开始”展开，让主题从人物行动、关系与处境中自然显现。'+shared,'成年人重新开始'),original);
 assert.equal(normalizeProductionPrompt(old+'但保留原文对白。','给我一个反转'),old+'但保留原文对白。');
});


import {freshSuggestions,suggestionKey,suggestionRequestSchema} from '../lib/reader-suggestions.ts';
import {assertPdfReady,createStoryPdf,imposeStoryLetterPdf,pdfFilename,wrapPdfText} from '../lib/reader-pdf.ts';
import {makeStory} from './fixtures/story.mjs';
test('batch history isolates book, custom source and theme without splitting on style or length',()=>{
 assert.equal(suggestionKey('liaozhai','irrelevant','反转'),suggestionKey('liaozhai',undefined,' 反转 '));
 assert.notEqual(suggestionKey('other','书一','反转'),suggestionKey('other','书二','反转'));
 assert.notEqual(suggestionKey('liaozhai',undefined,'反转'),suggestionKey('liaozhai',undefined,'善意'));
 assert.equal(freshSuggestions({stories:[{title:'《庄周梦蝶》',description:'重复'}],note:''},['庄周梦蝶']).stories.length,0);
 assert.throws(()=>suggestionRequestSchema.parse({bookId:'liaozhai',theme:'反转',length:10,excludeTitles:Array(201).fill('旧故事')}));
});
test('PDF refuses incomplete stories and wraps Chinese, newlines and long links without losing content',()=>{
 const story=makeStory();assert.doesNotThrow(()=>assertPdfReady(story));
 assert.throws(()=>assertPdfReady({...story,pages:[{...story.pages[0],image:''}]}),/全部|所有/);
 const text='他有一车梨，道士只想讨一个。';const lines=wrapPdfText(text,6,s=>Array.from(s).length);
 assert.equal(lines.join(''),text);assert.ok(lines.every(line=>Array.from(line).length<=6));assert.ok(lines.every(line=>!/[，。]/.test(line[0])));
 assert.deepEqual(wrapPdfText('前一行\n后一行',10,s=>s.length),['前一行','后一行']);
 const long='https://example.com/'+('path'.repeat(100));assert.equal(wrapPdfText(long,30,s=>s.length).join(''),long);
 assert.equal(pdfFilename('故事/名字?'),'故事名字-拾趣.pdf');
});

test('print PDF requires complete landscape artwork and prints without cropping',async()=>{
 const story=makeStory(2),portrait=story.pages.map(page=>page.image),landscape=['/landscape-1.png','/landscape-2.png'];
 story.sourceUrl='https://a.test/'+encodeURIComponent('子不语')+'%2F';
 story.publication={...story.publication,workUrl:'https://b.test/'+encodeURIComponent('待尤郎')+'/%E9'};
 const jpeg=new Blob([await createCanvas(2,2).encode('jpeg')],{type:'image/jpeg'});
 async function render(layout,images,coverIndex){
  const reads=[],draws=[],textDraws=[];
  const context={fillRect(){},fillText:(text,x,y,width)=>textDraws.push({text,x,y,width,imagesDrawn:draws.length}),clearRect(){},measureText:text=>({width:text.length*32}),
   drawImage:(...args)=>draws.push(args),createLinearGradient:()=>({addColorStop(){}})};
  const runtime={ready:async()=>{},canvas:()=>({getContext:()=>context,toBlob:done=>done(jpeg)}),
   read:async (url,index)=>{reads.push([url,index]);return url;},
   image:async(url,draw)=>{const wide=landscape.includes(url);return draw({value:url,width:wide?30:20,height:wide?20:30});}};
  return {reads,draws,textDraws,pdf:await PDFDocument.load(await createStoryPdf(story,undefined,runtime,layout,images,coverIndex))};
 }
 await assert.rejects(render('landscape',[landscape[0],portrait[1]]),/第 2 幅横图/);
 const complete=await render('landscape',landscape);
 assert.deepEqual(complete.reads,landscape.map((url,index)=>[url,index]));
 assert.deepEqual(complete.draws.map(draw=>draw[0]),[landscape[0],...landscape]);
 for(const draw of complete.draws){
  assert.equal(draw.length,5);
  assert.equal(draw[3]/draw[4],1.5);
 }
 const [,coverX,coverY,coverWidth,coverHeight]=complete.draws[0];
 assert.deepEqual([coverX,coverWidth],[75,1950]);
 const coverTitle=complete.textDraws.find(draw=>draw.text===story.title&&draw.imagesDrawn===1);
 assert.ok(coverTitle.x>=coverX&&coverTitle.y>=coverY&&coverTitle.y<coverY+coverHeight);
 for(const [index,scene] of story.pages.entries()){
  const [,x,y,width,height]=complete.draws[index+1];
  const caption=complete.textDraws.find(draw=>draw.text===`${index+1}. ${scene.caption}`&&draw.imagesDrawn===index+2);
  assert.deepEqual([caption.x,caption.y,caption.width],[x,y+height+28,width]);
 }
 assert.equal(complete.pdf.getPageCount(),5);
 assert.deepEqual(complete.pdf.getPage(2).getTrimBox(),{x:9,y:9,width:504,height:360});
 assert.deepEqual(complete.pdf.getPage(2).getBleedBox(),{x:0,y:0,width:522,height:378});
 const backText=complete.textDraws.map(draw=>draw.text).join('');
 assert.ok(backText.includes('出处链接：https://a.test/子不语%2F'));
 assert.ok(backText.includes('作品链接：https://b.test/待尤郎/%E9'));
 for(const layout of ['landscape','letter']){
  await assert.rejects(render(layout),/横版插图未完成.*0 \/ 2 幅.*第 1、2 幅/);
  await assert.rejects(render(layout,[landscape[0],'']),/横版插图未完成.*1 \/ 2 幅.*第 2 幅/);
 }
 const selectedLandscape=await render('landscape',landscape,1);
 assert.deepEqual(selectedLandscape.reads,[[landscape[1],1],[landscape[0],0]]);
 assert.deepEqual(selectedLandscape.draws.map(draw=>draw[0]),[landscape[1],...landscape]);
 assert.equal(selectedLandscape.pdf.getPageCount(),5);
 await assert.rejects(render('landscape',landscape,2),/请选择有效的封面画幅/);
 for(const result of [complete,selectedLandscape]){
  assert.deepEqual(result.textDraws.map(draw=>draw.text).filter(text=>/^\d+\. /.test(text)),story.pages.map((scene,index)=>`${index+1}. ${scene.caption}`));
  assert.deepEqual(result.textDraws.map(draw=>draw.text).filter(text=>/^\d+ \/ \d+$/.test(text)),['1 / 2','2 / 2']);
 }
 const reading=await render('portrait',landscape);
 assert.deepEqual(reading.reads,portrait.map((url,index)=>[url,index]));
 assert.ok(reading.textDraws.some(({text})=>text==='01 / 2'));
 assert.deepEqual(reading.pdf.getPage(0).getSize(),{width:360,height:540});
 assert.deepEqual(story.pages.map(page=>page.image),portrait);
 const letter=await render('letter',landscape,1);
 assert.deepEqual(letter.reads,selectedLandscape.reads);
 assert.deepEqual(letter.draws,selectedLandscape.draws);
 assert.equal(letter.pdf.getPageCount(),4);
 assert.equal(pdfFilename(story.title,'letter'),`${story.title}-拾趣-Letter双面.pdf`);
});

test('Letter PDF matches odd and even frames across halves, with separate covers and continuation pages',async()=>{
 const source=await PDFDocument.create();
 source.setTitle('测试故事');
 for(let index=1;index<=9;index++){
  const page=source.addPage([522,378]);
  page.setTrimBox(9,9,504,360);
  page.drawRectangle({x:100+index,y:0,width:1,height:1});
 }
 const pdf=await PDFDocument.load(await imposeStoryLetterPdf(source,[2,3,5,6,7]));
 const preferences=pdf.catalog.getOrCreateViewerPreferences();
 assert.equal(pdf.getTitle(),'测试故事');
 assert.equal(preferences.getDuplex(),'DuplexFlipLongEdge');
 assert.equal(preferences.getPrintScaling(),'None');
 const decode=stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString();
 const placements=pdf.getPages().map(page=>{
  assert.deepEqual(page.getSize(),{width:612,height:792});
  const streams=page.node.lookupMaybe(PDFName.of('Contents'),PDFArray);
  if(!streams)return [];
  const content=decode(streams.lookup(0,PDFRawStream));
  const forms=page.node.Resources().lookup(PDFName.of('XObject'),PDFDict);
  return [...content.matchAll(/1 0 0 1 54 (414|18) cm\n[\s\S]*?\n\/(EmbeddedPdfPage-[^ ]+) Do/g)].map(([,y,name])=>{
   const form=forms.lookup(PDFName.of(name),PDFRawStream);
   const [,index]=decode(form).match(/1 0 0 1 (10\d) 0 cm/);
   return [Number(index)-100,Number(y)];
  });
 });
 assert.deepEqual(placements,[
  [[1,414]],[[2,414],[9,18]],
  [[3,414],[6,18]],[[4,414],[7,18]],
  [[8,414]],[],[[5,414]],[],
 ]);
});


import {recentHero} from '../lib/reader-home.ts';
test('home hero resumes the last viewed story and stays empty for new or missing history',()=>{
 const sample=makeStory(),last={...sample,id:'generated-2',title:'最后看的故事'};
 const hero=recentHero([sample,last],last.id,[{storyId:sample.id,page:1},{storyId:last.id,page:4}]);
 assert.equal(hero.story.id,last.id);assert.equal(hero.page,4);assert.equal(hero.image,last.pages[4].image);assert.equal(hero.recent,true);
 assert.equal(recentHero([sample,last],'',[]),null);
 assert.equal(recentHero([sample,last],'deleted-story',[]),null);
 assert.equal(recentHero([],last.id,[]),null);
 assert.equal(recentHero([sample,last],last.id,[{storyId:last.id,page:99}]).page,sample.pages.length-1);
});


test('touch swipes turn only left and right, ignoring vertical swipes, taps and ambiguous diagonals',()=>{
 assert.equal(swipePageDirection(-80,10),1);assert.equal(swipePageDirection(80,-10),-1);
 assert.equal(swipePageDirection(10,-80),0);assert.equal(swipePageDirection(-10,80),0);
 assert.equal(swipePageDirection(30,10),0);assert.equal(swipePageDirection(80,78),0);
});

import {recentHeroes,mergeReadingProgress} from '../lib/reader-home.ts';
test('recent carousel keeps ten distinct readable stories, newest reading first, and resumes each page',()=>{
 const sample=makeStory(),stories=Array.from({length:12},(_,i)=>({...sample,id:'s'+i}));
 const progress=stories.map((s,i)=>({storyId:s.id,page:i%10,updatedAt:new Date(1700000000000+i*1000).toISOString()}));
 const items=recentHeroes(stories,'s0',[...progress,progress[0],{storyId:'deleted',page:0,updatedAt:'2099-01-01'}]);
 assert.equal(items.length,10);assert.equal(new Set(items.map(h=>h.story.id)).size,10);assert.equal(items[0].story.id,'s11');assert.equal(items[0].page,1);assert.equal(items[9].story.id,'s2');
 assert.equal(recentHeroes(stories.filter(s=>s.id!=='s11'),'s11',progress)[0].story.id,'s10');
 assert.deepEqual(recentHeroes([],sample.id,progress),[]);
 assert.equal(recentHeroes([sample],'',[]).length,0);
 const merged=mergeReadingProgress([{storyId:'s0',page:1,updatedAt:'2026-10-20'}],[{storyId:'s0',page:5,updatedAt:'2026-10-27'}]);assert.equal(merged[0].page,5);
});

import {reconcileReadingProgress} from '../lib/reader-home.ts';
test('server favorite resets replace newer browser flags without discarding the latest reading position',()=>{
 const cached=[{storyId:'generated',page:7,saved:1,updatedAt:'2026-10-29T12:00:00Z'}];
 const server=[{storyId:'generated',page:3,saved:0,updatedAt:'2026-10-28T12:00:00Z'}];
 const [row]=reconcileReadingProgress(cached,server);
 assert.deepEqual(row,{...cached[0],saved:0});
 assert.equal(reconcileReadingProgress(cached,[{...server[0],saved:1}])[0].saved,1);
 assert.equal(reconcileReadingProgress(cached,[{storyId:'other',page:0,saved:0}]).find(row=>row.storyId==='generated').saved,1);
});
test('published and generated progress hydration reconcile favorite flags regardless of response order',()=>{
 const local=[{storyId:'generated',page:7,saved:1,updatedAt:'2026-10-29'},{storyId:'published',page:3,saved:1,updatedAt:'2026-10-29'}];
 const generated=[{storyId:'generated',page:1,saved:0,updatedAt:'2026-10-28'}],published=[{storyId:'published',page:0,saved:0,updatedAt:'2026-10-28'}];
 for(const groups of [[generated,published],[published,generated]]){
  let authoritative=[],visible=local;
  for(const group of groups){authoritative=reconcileReadingProgress(authoritative,group);visible=reconcileReadingProgress(visible,authoritative);}
  assert.ok(visible.every(row=>row.saved===0));
  assert.equal(visible.find(row=>row.storyId==='generated').page,7);
  assert.equal(visible.find(row=>row.storyId==='published').page,3);
 }
});

test('direct source selection drops inherited theme directions and preserves authored production requirements',()=>{
 const direct=directStorySettings(defaultProductionPrompt('给我一个反转'),'给我一个反转');
 assert.equal(direct.theme,'原典故事');assert.equal(direct.productionPrompt,'');assert.doesNotMatch(direct.productionPrompt,/开头制造一个可信的预期/);
 assert.equal(directStorySettings('','').productionPrompt,direct.productionPrompt);
 assert.equal(directStorySettings('保持克制，保留原文结局。','其他').productionPrompt,'保持克制，保留原文结局。');
});

test('browser exporters read the saved image even when offline reading has an older copy at the same URL',async t=>{
 const {browserExportRuntime}=await import('../lib/story-export-runtime.ts');
 const {runInNewContext}=await import('node:vm'),{readFile}=await import('node:fs/promises');
 const location=new URL('http://reader.test'),image='/api/reader/media/book/1.png',handlers={};
 const response=value=>new Response(value,{headers:{'Content-Type':'image/png'}});
 const cache={match:async()=>response('offline copy')};
 runInNewContext(await readFile('public/sw.js','utf8'),{
  self:{addEventListener:(name,action)=>{handlers[name]=action;}},location,URL,caches:{open:async()=>cache},fetch:async()=>response('saved image'),
 });
 globalThis.location=location;t.after(()=>{delete globalThis.location;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const request=new Request(url,options);let handled;
  handlers.fetch({request,respondWith:result=>{handled=result;}});
  return handled??response('saved image');
 });
 assert.equal(await(await fetch(new URL(image,location))).text(),'offline copy');
 assert.equal(await(await browserExportRuntime().read(image,0)).text(),'saved image');
});
