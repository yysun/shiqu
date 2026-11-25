// Verify outbound size support and preserve all valid native images without resolution gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {imageDimensions,imageRequestSize,matchesLandscapeImageRatio} from '../lib/reader-image-dimensions.ts';
import {createReaderProvider} from '../server/generation.ts';
import {imageBytes,png,jpeg} from './fixtures/images.mjs';
import {productionFixture,makePlan,until,turn,selection} from './fixtures/production.mjs';
import {owner} from './fixtures/book-reference.mjs';
import {emptyDag} from '../lib/production-dag/document.ts';
import {flowProvider} from './fixtures/test-tier.mjs';

const zhuangzi={title:'齐物论',text:'昔者庄周梦为胡蝶，栩栩然胡蝶也，自喻适志与！不知周也。俄然觉，则蘧蘧然周也。不知周之梦为胡蝶与，胡蝶之梦为周与？',url:'https://example.test/zhuangzi',kind:'passage',provider:'fixture',retrievedAt:'2026-11-01'};
/** 一篇已确认、尚未制作的 DAG 故事（原文已核对，不经准备流程）。 */
async function confirmedStory(f,length=4){
 const id=crypto.randomUUID(),now=new Date().toISOString(),doc={plan:null,images:[],audio:[],usage:[],original:zhuangzi,dag:emptyDag()};
 await f.app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'active',0,?,?)").bind(id,owner,JSON.stringify({...selection,length}),JSON.stringify(doc),now,now).run();
 return id;
}
const formats=[['portrait.png','image/png','.png'],['portrait.jpg','image/jpeg','.jpg'],['portrait-progressive.jpg','image/jpeg','.jpg'],['portrait.webp','image/webp','.webp'],['portrait-lossy.webp','image/webp','.webp'],['portrait-alpha.webp','image/webp','.webp']];
const nativeImages=['square.png','landscape.png','small.png','rotated.png','rotated.jpg','rotated.webp','legacy-2-3.png','native.png','gemini.png','codex-native.png','codex-requested.png'];
test('image metadata reads formats and EXIF rotation without imposing resolution or ratio limits',()=>{
 for(const [name] of formats){
  const bytes=imageBytes(name),padded=new Uint8Array(bytes.length+8);padded.set(bytes,4);
  assert.deepEqual(imageDimensions(padded.subarray(4,-4)),{width:1152,height:2048},name);
  for(const end of [0,8,12,20,bytes.length-1])assert.equal(imageDimensions(bytes.subarray(0,end)),null,`${name} truncated at ${end}`);
 }
 for(const name of nativeImages)assert.ok(imageDimensions(imageBytes(name)),name);
 for(const suffix of ['png','jpg','webp'])assert.deepEqual(imageDimensions(imageBytes('rotated.'+suffix)),{width:2048,height:1152});
 const malformed=new Uint8Array(png);malformed.set([255,255,255,255],8);assert.equal(imageDimensions(malformed),null);
 const zero=new Uint8Array(png);zero.fill(0,16,20);assert.equal(imageDimensions(zero),null);
});

test('outbound sizes follow official custom-size constraints without a default-size minimum',()=>{
 assert.deepEqual(imageRequestSize(),{size:'864x1536',width:864,height:1536});
 assert.deepEqual(imageRequestSize('720x1280'),{size:'720x1280',width:720,height:1280});
 assert.deepEqual(imageRequestSize(' 1440x2560 '),{size:'1440x2560',width:1440,height:2560});
 assert.deepEqual(imageRequestSize('2160x3840'),{size:'2160x3840',width:2160,height:3840});
 for(const size of ['900x1600','576x1024','2304x4096','auto','1024x1536','1280x1920','1024x1024','1536x1024','768x1152','1024x1365','0x0','1e3x1500','864x1536 injected','999999999x1499999998'])assert.equal(imageRequestSize(size),null,size);
});

test('landscape accepts the native 3:2 ratio and provider rounding',()=>{
 for(const [width,height] of [[1536,1024],[1248,832],[1264,848]])assert.equal(matchesLandscapeImageRatio({width,height}),true);
 for(const [width,height] of [[768,1376],[1376,768],[1024,1024],[0,0]])assert.equal(matchesLandscapeImageRatio({width,height}),false);
});

function controlledProvider(name){
 const stored=new Map(),calls=[];
 const control={bytes:png,mime:'image/png'};
 const media={async get(key){const bytes=stored.get(key)?.bytes;return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async put(key,bytes,options){stored.set(key,{bytes:new Uint8Array(bytes),...options});}};
 const runner={async status(){return {configured:true};},async run(job){calls.push(job);return {image:Buffer.from(control.bytes).toString('base64'),text:'',model:'controlled',requestId:'controlled',usage:null};}};
 const transport=async(url,options)=>{
  calls.push(JSON.parse(options.body));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:control.mime,data:Buffer.from(control.bytes).toString('base64')}}]}}]});
 };
 const provider=createReaderProvider({SHIQU_AI_PROVIDER:name,GEMINI_API_KEY:'controlled'},media,transport,runner);
 return {provider,generator:provider.generator(),stored,calls,control};
}
for(const name of ['codex','gemini']){
 test(`${name}: landscape sends this page's portrait and caption, validates ratio, and preserves the native bytes`,async()=>{
  const f=controlledProvider(name),plan=makePlan(8),artifact='a'.repeat(64),page=2;
  const {value:reference}=await f.generator.image(plan,page,'test','');
  const landscape=new Uint8Array(createCanvas(1264,848).toBuffer('image/png'));
  const generate=source=>f.generator.image(plan,page,'test',source,undefined,'',artifact,'landscape');
  await assert.rejects(generate(''),/INVALID_ANCHOR/);
  assert.equal(f.calls.length,1);
  await assert.rejects(generate(reference),/INVALID_LANDSCAPE_RATIO/);
  assert.equal(f.stored.size,1);
  f.control.bytes=landscape;
  const result=await generate(reference);
  const request=f.calls.at(-1),parts=request.contents?.[0].parts;
  if(name==='gemini')assert.deepEqual(request.generationConfig.imageConfig,{aspectRatio:'3:2',imageSize:'1K'});
  const supplied=name==='codex'?request.image.bytes:new Uint8Array(Buffer.from(parts[0].inlineData.data,'base64'));
  assert.deepEqual(supplied,png);
  const prompt=name==='codex'?request.prompt:parts[1].text;
  assert.match(prompt,/3:2 landscape/);
  assert.ok(prompt.includes(JSON.stringify(plan.pages[page].caption)));
  assert.ok(prompt.includes(JSON.stringify(plan.pages[page].prompt)));
  assert.doesNotMatch(prompt,/9:16 portrait canvas|bottom quieter/);
  assert.equal(result.value,`/api/reader/media/test/artifacts/${page}-${artifact}.png`);
  assert.deepEqual(f.stored.get(`reader/test/artifacts/${page}-${artifact}.png`).bytes,landscape);
  assert.deepEqual(f.stored.get(`reader/test/${page}.png`).bytes,png);
 });

 test(`${name}: request 9:16 but save every valid native size and ratio without transforming bytes`,async()=>{
  const f=controlledProvider(name),plan=makePlan(8);
  for(const [file,mime,extension] of [...formats,...nativeImages.map(file=>[file,file.endsWith('.jpg')?'image/jpeg':file.endsWith('.webp')?'image/webp':'image/png',file.endsWith('.jpg')?'.jpg':file.endsWith('.webp')?'.webp':'.png'])]){
   f.control.bytes=imageBytes(file);f.control.mime=mime;
   const result=await f.generator.image(plan,0,'test','');assert.ok(result.value.endsWith(extension));
   const saved=f.stored.get('reader/test/0'+extension);assert.equal(saved.contentType,mime);assert.deepEqual(saved.bytes,f.control.bytes);
  }
  const before=[...f.stored.entries()];f.control.bytes=png.subarray(0,24);f.control.mime='image/png';
  await assert.rejects(f.generator.image(plan,0,'test',''),/INVALID_IMAGE|INVALID_MEDIA/);assert.deepEqual([...f.stored.entries()],before);
  const request=f.calls[0],prompt=name==='codex'?request.prompt:request.contents[0].parts[0].text;
  assert.match(prompt,/9:16 portrait canvas/);assert.match(prompt,/864 x 1536/);
  if(name==='gemini')assert.deepEqual(request.generationConfig.imageConfig,{aspectRatio:'9:16',imageSize:'1K'});
 });

 test(`${name}: only corrupt media fails the drawing; explicit retry draws it again and keeps completed work`,flowProvider(name),async t=>{
  // 制作 DAG：首幅绘图返回损坏的图片时，故障落在该画幅，故事不完成；读者恢复后重画，其余画幅照常完成。
  const f=await productionFixture(t,name),id=await confirmedStory(f,4);
  f.app.services.production.wake();
  await until(()=>f.control.calls.length===1);
  f.control.calls[0].bytes=Buffer.from(png.subarray(0,24)).toString('base64');f.control.calls[0].resolve();
  await until(async()=>(await f.read(id)).faults?.length>0);
  let session=await f.read(id);assert.notEqual(session.state,'completed');assert.ok(session.story.pages.every(page=>!page.image));
  const fault=session.faults.find(item=>item.state==='pending');assert.ok(fault);
  for(let i=0;i<10;i++){f.app.services.production.wake();await turn();}
  assert.equal(f.control.calls.length,1,'nothing is paid again before the reader asks');
  f.control.hold=false;
  await f.json(`sessions/${id}/recover`,'POST',{requestId:crypto.randomUUID(),faultId:fault.id});
  await until(async()=>(await f.read(id)).state==='completed',20000);
  session=await f.read(id);assert.equal(session.story.pages.filter(page=>page.image).length,4);assert.equal(f.control.calls.filter(call=>call.page===0).length,2);
 });
}
