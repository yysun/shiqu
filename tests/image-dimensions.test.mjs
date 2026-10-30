// Verify dimension policy at metadata, provider, queue and admin HTTP/storage boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {imageDimensions,validImageDimensions,imageRequestSize,geminiImageMinimum} from '../lib/reader-image-dimensions.ts';
import {createReaderProvider} from '../server/generation.ts';
import {imageBytes,png,jpeg} from './fixtures/images.mjs';
import {productionFixture,makePlan,selection,until} from './fixtures/production.mjs';
import {insertStory,makeStory} from './fixtures/story.mjs';

const formats=[['portrait.png','image/png','.png'],['portrait.jpg','image/jpeg','.jpg'],['portrait-progressive.jpg','image/jpeg','.jpg'],['portrait.webp','image/webp','.webp'],['portrait-lossy.webp','image/webp','.webp'],['portrait-alpha.webp','image/webp','.webp']];
const rejected=['square.png','landscape.png','small.png','rotated.png','rotated.jpg','rotated.webp','legacy-2-3.png'];
test('real PNG, JPEG and all WebP dimension headers work with sliced byte buffers and EXIF rotation',()=>{
 for(const [name] of formats){
  const bytes=imageBytes(name),padded=new Uint8Array(bytes.length+8);padded.set(bytes,4);
  assert.deepEqual(imageDimensions(padded.subarray(4,-4)),{width:1152,height:2048},name);
  assert.equal(validImageDimensions(bytes),true,name);
  for(const end of [0,8,12,20,bytes.length-1])assert.equal(validImageDimensions(bytes.subarray(0,end)),false,`${name} truncated at ${end}`);
 }
 for(const name of rejected)assert.equal(validImageDimensions(imageBytes(name),geminiImageMinimum),false,name);
 for(const suffix of ['png','jpg','webp'])assert.deepEqual(imageDimensions(imageBytes('rotated.'+suffix)),{width:2048,height:1152});
 for(const name of ['gemini.png','native.png']){
  assert.equal(validImageDimensions(imageBytes(name),geminiImageMinimum),true);
  assert.equal(validImageDimensions(imageBytes(name)),false);
 }
 assert.equal(validImageDimensions(imageBytes('rounding-inside.png'),geminiImageMinimum),true);
 assert.equal(validImageDimensions(imageBytes('rounding-outside.png'),geminiImageMinimum),false);
 const malformed=new Uint8Array(png);malformed.set([255,255,255,255],8);
 assert.equal(imageDimensions(malformed),null);
 const zero=new Uint8Array(png);zero.fill(0,16,20);assert.equal(validImageDimensions(zero),false);
});

test('size overrides require exact 9:16 portrait at the target or higher',()=>{
 assert.deepEqual(imageRequestSize(),{size:'1152x2048',width:1152,height:2048});
 assert.deepEqual(imageRequestSize(' 1440x2560 '),{size:'1440x2560',width:1440,height:2560});
 for(const size of ['auto','1024x1536','1280x1920','1024x1024','1536x1024','768x1152','1024x1365','0x0','1e3x1500','1152x2048 injected','999999999x1499999998'])assert.equal(imageRequestSize(size),null,size);
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
 test(`${name}: request sizing and returned dimensions are checked before replacing media`,async()=>{
  const f=controlledProvider(name),plan=makePlan(8);
  for(const [file,mime,extension] of formats){
   f.control.bytes=imageBytes(file);f.control.mime=mime;
   const result=await f.generator.image(plan,0,'test','');assert.ok(result.value.endsWith(extension));
   assert.equal(f.stored.get('reader/test/0'+extension).contentType,mime);
  }
  const before=[...f.stored.entries()];
  for(const file of rejected){
   f.control.bytes=imageBytes(file);f.control.mime=file.endsWith('.jpg')?'image/jpeg':file.endsWith('.webp')?'image/webp':'image/png';
   await assert.rejects(f.generator.image(plan,0,'test',''),error=>{
    assert.equal(error.message,'INVALID_IMAGE_DIMENSIONS');assert.match(f.provider.safeError(error),/9:16.*未保存/);return true;
   });
   assert.deepEqual([...f.stored.entries()],before);
  }
  f.control.bytes=png.subarray(0,24);f.control.mime='image/png';
  await assert.rejects(f.generator.image(plan,0,'test',''),/INVALID_IMAGE_DIMENSIONS/);assert.deepEqual([...f.stored.entries()],before);
  f.control.bytes=imageBytes('gemini.png');
  if(name==='gemini')await f.generator.image(plan,0,'native','');else await assert.rejects(f.generator.image(plan,0,'native',''),/INVALID_IMAGE_DIMENSIONS/);
  const request=f.calls[0],prompt=name==='codex'?request.prompt:request.contents[0].parts[0].text;
  assert.match(prompt,/9:16 portrait canvas/);assert.match(prompt,/1152 x 2048/);
  if(name==='gemini')assert.deepEqual(request.generationConfig.imageConfig,{aspectRatio:'9:16',imageSize:'1K'});
 });

 test(`${name}: queued dimension failure saves no image and waits for explicit retry`,async t=>{
  const f=await productionFixture(t,name),id=await f.createLegacyReader(),viewer=crypto.randomUUID();
  await f.demand(id,viewer);await until(()=>f.control.calls.length===1);
  f.control.calls[0].bytes=Buffer.from(imageBytes('square.png')).toString('base64');f.control.calls[0].resolve();
  await until(async()=>(await f.read(id)).state==='failed');
  let session=await f.read(id);assert.equal(session.ready,0);assert.match(session.error,/尺寸.*9:16/);assert.ok(session.story.pages.every(page=>!page.image));
  const jobs=await f.app.services.production.queue.jobs(id,'docker-local-owner'),failed=jobs.find(job=>job.kind==='image'&&job.state==='failed');assert.ok(failed);assert.equal(failed.result,null);
  await f.demand(id,viewer);await f.app.services.production.tick();assert.equal(f.control.calls.length,1);
  f.control.hold=false;await f.demand(id,viewer,0,true);await until(async()=>(await f.read(id)).ready===7);
  session=await f.read(id);assert.equal(session.story.pages.filter(page=>page.image).length,7);assert.equal(f.control.calls.filter(call=>call.page===0).length,2);
 });
}

async function adminFixture(t,size){
 const f=await productionFixture(t),story=await insertStory(f.app,{...makeStory(),status:'draft'}),calls=[],writes=[];
 Object.assign(f.app.services.variables,{IMAGE_API_BASE:'https://provider.example/v1',IMAGE_API_KEY:'controlled',IMAGE_MODEL:'controlled',...(size===undefined?{}:{IMAGE_SIZE:size})});
 const control={bytes:png,mime:'image/png',download:false};
 f.app.services.transport=async(url,options)=>{
  calls.push({url:String(url),body:options?.body?JSON.parse(options.body):null});
  if(String(url)==='https://images.example/result')return new Response(control.bytes,{headers:{'Content-Type':control.mime}});
  return Response.json({data:[control.download?{url:'https://images.example/result'}:{b64_json:Buffer.from(control.bytes).toString('base64')}]});
 };
 const put=f.app.services.media.put.bind(f.app.services.media);f.app.services.media.put=async(...args)=>{writes.push(args);return put(...args);};
 async function generate(){return f.app.handle(new Request('http://localhost/api/admin/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:story.id,kind:'image',page:0,requestId:crypto.randomUUID()})}));}
 async function saved(){return (await f.app.handle(new Request('http://localhost/api/admin/stories/'+story.id))).json();}
 return {...f,story,control,calls,writes,generate,saved};
}
test('admin default/override requests use 9:16, preserve actual MIME, and validate downloaded as well as inline images',async t=>{
 const f=await adminFixture(t);
 f.control.bytes=jpeg;f.control.mime='image/jpeg';
 let response=await f.generate();assert.equal(response.status,200);let result=await response.json();
 assert.match(result.story.pages[0].image,/\.jpeg$/);assert.equal(f.writes[0][2].contentType,'image/jpeg');
 assert.equal(f.calls[0].body.size,'1152x2048');assert.match(f.calls[0].body.prompt,/portrait 9:16/);assert.doesNotMatch(f.calls[0].body.prompt,/3:4/);
 f.app.services.variables.IMAGE_SIZE='1440x2560';f.control.bytes=imageBytes('large.png');f.control.mime='image/png';f.control.download=true;
 response=await f.generate();assert.equal(response.status,200);assert.equal(f.calls[1].body.size,'1440x2560');assert.equal(f.calls[2].url,'https://images.example/result');
 f.control.bytes=png;const saved=await f.saved(),count=f.writes.length;
 response=await f.generate();assert.equal(response.status,502);assert.match((await response.json()).error,/1440 × 2560/);assert.deepEqual(await f.saved(),saved);assert.equal(f.writes.length,count);
});

test('admin rejects invalid overrides before transport and preserves prior page/revision on invalid dimensions',async t=>{
 const f=await adminFixture(t,'1024x1024');let response=await f.generate();assert.equal(response.status,503);assert.match((await response.json()).error,/IMAGE_SIZE/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
 f.app.services.variables.IMAGE_SIZE='1152x2048';
 for(const file of [...rejected,'gemini.png']){
  f.control.bytes=imageBytes(file);const before=await f.saved();response=await f.generate();assert.equal(response.status,502,file);assert.match((await response.json()).error,/尺寸.*9:16/);assert.deepEqual(await f.saved(),before);assert.equal(f.writes.length,0);
 }
 const jobs=await(await f.app.handle(new Request('http://localhost/api/admin/jobs'))).json();assert.ok(jobs.every(job=>job.status==='failed'));
});
