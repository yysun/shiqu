// 调用契约：用哨兵值证明每个调用的指令与载荷不含契约外的输入；场景 41、52、56、57。
import test from 'node:test';
import assert from 'node:assert/strict';
import {dagGenerator,framePrompt,acceptanceItems} from '../lib/production-dag/calls.ts';

const STYLE='哨兵画风请勿出现',REQ='哨兵制作要求请勿出现',CAPTION='哨兵配文请勿出现于图',VISUAL='哨兵画面描述请勿出现',NOTES='哨兵审核意见请勿出现';
const original={title:'管晏列传',text:'管仲夷吾者，颍上人也。少时常与鲍叔牙游，鲍叔知其贤。',url:'https://example.test/guanyan',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
const source={original,book:'史记',chosenStory:'管鲍之交',variationSeed:'story-1'};
const style={artStyle:'ink-pencil',artStylePrompt:STYLE};
const outline={title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:['少时同游','鲍叔知贤']};
const people=[{id:'c1',name:'管仲',aliases:['夷吾'],text:'齐国人，青年时清贫。'},{id:'c2',name:'鲍叔牙',aliases:['鲍叔'],text:'管仲好友，宽厚。'}];

function recorder(reply){
 const calls=[];
 const call=async(task,instructions,payload,schema)=>{calls.push({task,text:instructions+'\n'+JSON.stringify(payload)});return {value:reply(schema,payload),model:'fake',requestId:null,usage:null};};
 return {calls,gen:dagGenerator(call)};
}
const without=(text,...sentinels)=>{for(const s of sentinels)assert.ok(!text.includes(s),`unexpected ${s}`);};
const contains=(text,...sentinels)=>{for(const s of sentinels)assert.ok(text.includes(s),`missing ${s}`);};

test('outline, characters and storyboard text never see the style; image descriptions do',async()=>{
 const {calls,gen}=recorder((schema,payload)=>{
  if(schema.properties.beats)return {title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:['少时同游','鲍叔知贤']};
  if(schema.properties.characters)return {characters:[{name:'管仲',aliases:['夷吾'],text:'齐国人，青年时清贫。'}]};
  if(schema.properties.pages)return {pages:payload.batch?[{caption:'管仲与鲍叔牙少时同游。',people:['管仲','鲍叔']},{caption:'鲍叔深知管仲之贤。',people:['鲍叔']}]:[]};
  return {frames:payload.frames.map(f=>({number:f.number,prompt:'两位少年并肩走在乡间小路上，中景，晨光从左侧照来，远处是低矮的土墙与柳树。',drawn:['管仲','鲍叔牙']}))};
 });
 await gen.outline({source,productionPrompt:REQ,settings:{narrativeDetail:'balanced',length:2}});
 await gen.characters({source,productionPrompt:REQ});
 const scenes=await gen.sceneBatch({source,outline,productionPrompt:REQ,first:1,previous:[]});
 // 调用返回模型给出的人物名字；名字到人物条目的匹配在保存时进行（见执行层测试）。
 assert.deepEqual(scenes.value.map(s=>s.people),[['管仲','鲍叔'],['鲍叔']]);
 const visual=await gen.visual({outline,productionPrompt:REQ,style,frames:[{index:0,caption:'管仲与鲍叔牙少时同游。',candidates:people}]});
 assert.deepEqual(visual.value[0].drawn,['管仲','鲍叔牙']);
 for(const c of calls.slice(0,3)){without(c.text,STYLE);contains(c.text,REQ);}
 contains(calls[3].text,STYLE,REQ,'artDirection 只用于画面表现。');
 contains(calls[0].text,'建立或更新空间认识','同一场所先交代必要布局');
 contains(calls[3].text,'具体可见的地标、物件或空间边界','同一地点改变视点');
 without(calls[0].text,'保留规定元数据与characters');
 contains(calls[2].text,'previousCaptions');
 without(calls[2].text,'previousPages');
});

test('batched frame calls return one result per frame, matched by frame number; a missing frame fails the batch',async()=>{
 const reply=(schema,payload)=>schema.properties.frames.items.properties.caption
  ?{frames:[...payload.frames].reverse().map(f=>({number:f.number,caption:`第${f.number}幅修订后的配文。`,people:['鲍叔']}))}
  :{frames:[...payload.frames].reverse().map(f=>({number:f.number,prompt:`第${f.number}幅：两位少年并肩走在乡间小路上，中景，晨光从左侧照来。`,drawn:f.number===1?['管仲','鲍叔牙']:['鲍叔']}))};
 const {calls,gen}=recorder(reply);
 const frames=[{index:0,caption:'管仲与鲍叔牙少时同游。',candidates:people},{index:1,caption:'鲍叔深知管仲之贤。',candidates:[people[1]]}];
 const visual=await gen.visual({outline,productionPrompt:REQ,style,frames});
 assert.deepEqual(visual.value.map(v=>v.drawn),[['管仲','鲍叔牙'],['鲍叔']]);
 assert.ok(visual.value[0].prompt.startsWith('第1幅'));
 const issues=[{page:1,category:'progression',problem:'动作不清',instruction:'补足动作',requiresReplan:false}];
 const repaired=await gen.visualRepair({outline,productionPrompt:REQ,style,frames:frames.map(f=>({...f,prompt:VISUAL,drawn:f.candidates,issues})),notes:NOTES});
 assert.deepEqual(repaired.value.map(v=>v.prompt.slice(0,3)),['第1幅','第2幅']);
 const scenes=await gen.sceneRepair({source,outline,productionPrompt:REQ,frames:frames.map(f=>({index:f.index,caption:f.caption,neighbors:{},issues}))});
 assert.deepEqual(scenes.value.map(s=>s.caption),['第1幅修订后的配文。','第2幅修订后的配文。']);
 // 画面描述与画面修订读画风；叙事修订不读画风与画面描述。
 contains(calls[0].text,STYLE,REQ);contains(calls[1].text,STYLE,VISUAL,NOTES);
 contains(calls[1].text,'具体可见的地标、物件或空间边界');
 without(calls[2].text,STYLE,VISUAL,'具体可见的地标、物件或空间边界');
 await assert.rejects(gen.visual({outline,productionPrompt:REQ,style,frames:[]}),/PLAN_LENGTH/);
 const short=recorder(()=>({frames:[{number:1,prompt:'两位少年并肩走在乡间小路上，中景，晨光从左侧照来。',drawn:[]},{number:1,prompt:'两位少年并肩走在乡间小路上，中景，晨光从左侧照来。',drawn:[]}]}));
 await assert.rejects(short.gen.visual({outline,productionPrompt:REQ,style,frames}),/INVALID_OUTPUT/);
});

test('restyle retains the post-release art and story constraints with one output shape',async()=>{
 const {calls,gen}=recorder(()=>({frames:[{number:1,prompt:'清晨两位少年并肩走在乡间小路上，中景，远处可见低矮的土墙。',drawn:['管仲']}]}));
 await gen.restyle({outline,productionPrompt:REQ,style,previousStyle:{artStyle:'ink-pencil',artStylePrompt:'旧画风'},frames:[{index:0,caption:CAPTION,candidates:people,previousPrompt:VISUAL}]});
 contains(calls[0].text,'不要把新画风附加在旧画风指令后面','保留原有可见细节','只返回 {frames:[{number,prompt,drawn}]}',STYLE,'旧画风',VISUAL);
 contains(calls[0].text,'保留相应地标、路径、边界、人物站位和遮挡');
 without(calls[0].text,'只返回 scenePrompts');
});

test('the summary reads the verified source and production scope; endings read captions without either scope preferences or image descriptions',async()=>{
 const {calls,gen}=recorder(schema=>schema.properties.summary?{summary:'管仲与鲍叔牙少时相知。'}:schema.properties.candidates?{title:'管鲍之交',candidates:['一','二','三']}:{reflection:'知己难得。'});
 await gen.prepareBrief({source,productionPrompt:REQ});
 await gen.ending({source,outline,captions:[CAPTION,'第二幅配文八个字以上']});
 await gen.endingRepair({source,outline,captions:[CAPTION],reflection:'旧结语',issues:[],notes:NOTES});
 contains(calls[0].text,REQ,'摘要不续述范围外的事件');without(calls[0].text,STYLE,CAPTION,VISUAL);
 without(calls[1].text,STYLE,REQ,VISUAL);contains(calls[1].text,CAPTION);
 without(calls[2].text,STYLE,REQ,VISUAL);contains(calls[2].text,NOTES);
});

test('a combined-source synopsis respects the scoped requirement and preserves separate source events',async()=>{
 const {calls,gen}=recorder(()=>({summary:'两段原文分别交代了各自的缘起和结果。'}));
 const combined={...source,original:{...original,localParts:[
  {sectionId:'first',title:'第一段',text:'管仲与鲍叔少时同游。'},
  {sectionId:'second',title:'第二段',text:'管仲与鲍叔各自离开。'},
 ]}};
 await gen.prepareBrief({source:combined,productionPrompt:REQ});
 contains(calls[0].text,'"combineSelectedOriginals":true','读者未进一步限定范围','不虚构事件之间的因果和人物关系',REQ);
});

test('the frame-count check reads captions and requirements but no image descriptions or style',async()=>{
 const {calls,gen}=recorder(()=>({frameCountReview:{decision:'keep',proposedCount:2,reason:'幅数合适'},requirements:[]}));
 await gen.frameCheck({source,outline,productionPrompt:REQ,settings:{narrativeDetail:'balanced',length:'auto'},captions:[CAPTION,'第二幅配文八个字以上']});
 without(calls[0].text,STYLE,VISUAL);contains(calls[0].text,REQ,CAPTION);
});

test('item registration reads only the item texts and returns stable identities',async()=>{
 const items=acceptanceItems('结尾才揭示身份\n每幅都有动作');
 assert.deepEqual(acceptanceItems('结尾才揭示身份\n每幅都有动作'),items);
 const {calls,gen}=recorder(()=>({items:[{index:1,scope:'story',evidence:['scenes','order']},{index:2,scope:'frame',evidence:[]}]}));
 const result=await gen.registerItems({items});
 assert.deepEqual(result.value.map(r=>[r.id,r.scope,r.evidence]),[[items[0].id,'story',['scenes','order']],[items[1].id,'frame',[]]]);
 without(calls[0].text,STYLE,REQ,CAPTION,VISUAL);
});

test('scenario 52: review discards judgements and issues outside the allowlist',async()=>{
 const frames=Array.from({length:3},(_,i)=>({id:`f${i+1}`,caption:`第${i+1}幅配文八个字以上`,prompt:`第${i+1}幅画面描述二十个字以上的内容，人物站立在庭院中央。`}));
 const {calls,gen}=recorder(()=>({
  issues:[{page:2,category:'progression',problem:'动作不清',instruction:'补足动作',requiresReplan:false},{page:3,category:'progression',problem:'服饰不一致',instruction:'统一服饰',requiresReplan:true}],
  titleReview:{title:'管鲍之交',reason:'准确'},
  coverage:[{quote:'管仲夷吾者',task:'交代人物',pages:[1],assessment:'adequate',reason:'已交代',issuePage:0}],
  acceptanceResults:[{criterion:1,status:'passed',pages:[0],evidence:'结尾揭示'}],
 }));
 const result=await gen.review({source,brief:'梗概',outline,title:'管鲍之交',productionPrompt:REQ,acceptancePrompt:'结尾才揭示身份',style,characters:people,frames,chosenEnding:'知己难得。',notes:NOTES,allowed:{pages:[1,2],criteria:[],narrative:true},itemIds:{1:'i-x'}});
 assert.deepEqual(result.value.judgements.map(j=>[j.id,j.outcome]),[['frameVerdict:f1','pass'],['frameVerdict:f2','fail'],['narrativeVerdict:','pass']]);
 assert.deepEqual(result.value.issues.map(issue=>issue.page),[2]);
 assert.ok(!Object.hasOwn(result.value,'suggestions'));
 contains(calls[0].text,STYLE,REQ,NOTES,'优先核对点名的段落、幅号或结语');
 contains(calls[0].text,'可见的环境线索或空间关系会造成具体误读','用category=composition、requiresReplan=false','近景、留白与沿用布局可以通过');
});

test('scenario 57: drawing and landscape prompts carry no caption or production requirements',()=>{
 const drawn=[people[0]];
 for(const layout of ['portrait','landscape']){
  const prompt=framePrompt({visual:VISUAL,redrawNote:'调暗背景',drawn,style,index:0,reference:true,layout});
  contains(prompt,VISUAL,'调暗背景','管仲',STYLE,'Compose every page as a finished lianhuanhua illustration','The quoted art direction guides visual style only.');
  contains(prompt,'Keep the landmarks, routes, boundaries and positions',layout==='portrait'?'story-critical ground, paths and spatial depth':'Keep the established spatial relationships');
  without(prompt,REQ,CAPTION,'鲍叔牙');
 }
});

test('provider failures classify into fault kinds: content blocks and service faults never auto-retry',async()=>{
 const {errorCode,serviceLevel,autoRetryable}=await import('../lib/production-dag/errors.ts');
 assert.equal(errorCode(Object.assign(new Error('CONTENT_BLOCKED'),{status:400})),'CONTENT_BLOCKED');
 assert.equal(errorCode({message:'Your request was rejected by the moderation system',status:400}),'CONTENT_BLOCKED');
 assert.equal(errorCode({message:'KEY_REQUIRED',status:401}),'SERVICE_AUTH');
 assert.equal(errorCode({message:'CLAUDE_LOGIN_REQUIRED'}),'SERVICE_AUTH');
 assert.equal(errorCode({message:'quota',status:429}),'RATE_LIMITED');
 assert.equal(errorCode({name:'AbortError',message:'aborted'}),'TIMEOUT');
 assert.equal(errorCode(new Error('INVALID_OUTPUT')),'GENERIC');
 assert.ok(serviceLevel('SERVICE_AUTH')&&serviceLevel('RATE_LIMITED')&&!serviceLevel('CONTENT_BLOCKED'));
 assert.ok(autoRetryable('TIMEOUT')&&!autoRetryable('CONTENT_BLOCKED'));
});

test('review answers are checked against the requested verdicts: a missing item fails, an unknown frame-scope item needs the reader',async()=>{
 const frames=Array.from({length:3},(_,i)=>({id:`f${i+1}`,caption:`第${i+1}幅配文八个字以上`,prompt:`第${i+1}幅画面描述二十个字以上的内容，人物站立在庭院中央。`}));
 const base={source,brief:'梗概',outline,title:'管鲍之交',productionPrompt:REQ,acceptancePrompt:'每幅人物衣冠合乎时代\n结尾才揭示身份',style,characters:people,frames,notes:undefined,itemIds:{2:'i-end'},frameCriteria:[1]};
 const reply=results=>()=>({issues:[],titleReview:{title:'管鲍之交',reason:'准确'},coverage:[{quote:'管仲夷吾者',task:'交代人物',pages:[1],assessment:'adequate',reason:'已交代',issuePage:0}],acceptanceResults:results});
 const unknown=recorder(reply([{criterion:1,status:'unknown',pages:[2],evidence:'文字分镜无法判断冠服年代'},{criterion:2,status:'passed',pages:[3],evidence:'结尾揭示'}]));
 const result=await unknown.gen.review({...base,allowed:{pages:[1,2,3],criteria:[2],narrative:false}});
 const second=result.value.judgements.find(j=>j.id==='frameVerdict:f2');
 assert.equal(second.outcome,'fail');
 assert.equal(second.requirements,true);
 assert.equal(result.value.judgements.find(j=>j.id==='frameVerdict:f1').outcome,'pass');
 const missing=recorder(reply([{criterion:1,status:'passed',pages:[1],evidence:'合乎时代'}]));
 // 报告结构已要求每条验收条目恰好一条结果；缺少时调用失败并按故障重试，不会把结论当作通过。
 await assert.rejects(missing.gen.review({...base,allowed:{pages:[1,2,3],criteria:[2],narrative:false}}));
});

test('a stage answers only the items it asks for, and the omission note lists only what was left out',async()=>{
 const frames=Array.from({length:3},(_,i)=>({id:`f${i+1}`,caption:`第${i+1}幅配文八个字以上`,prompt:`第${i+1}幅画面描述二十个字以上的内容，人物站立在庭院中央。`}));
 const reply=results=>()=>({issues:[],titleReview:{title:'管鲍之交',reason:'准确'},coverage:[{quote:'管仲夷吾者',task:'交代人物',pages:[1],assessment:'adequate',reason:'已交代',issuePage:0}],acceptanceResults:results});
 // 第一阶段：逐幅结论与逐幅条目 1，依据结语的条目 2 留到第二阶段；只答条目 1 即可。
 const first=recorder(reply([{criterion:1,status:'passed',pages:[1],evidence:'合乎时代'}]));
 const result=await first.gen.review({source,productionPrompt:REQ,acceptancePrompt:'每幅人物衣冠合乎时代\n结尾才揭示身份',style,characters:people,frames,itemIds:{2:'i-end'},frameCriteria:[1],allowed:{pages:[1,2,3],criteria:[],narrative:false}});
 assert.ok(result.value.judgements.every(j=>j.outcome==='pass'));
 assert.match(first.calls[0].text,/acceptanceResults 须覆盖编号 1/);
 // 第二阶段：只有依据标题与结语的条目；标题与结语已提供，不应说明为未提供。
 const second=recorder(reply([{criterion:1,status:'passed',pages:[3],evidence:'结尾揭示'}]));
 await second.gen.review({source,title:'管鲍之交',chosenEnding:'知己难得。',acceptancePrompt:'结尾才揭示身份',frames,itemIds:{1:'i-end'},allowed:{pages:[],criteria:[1],narrative:false}});
 assert.ok(!/不依据[^。]*标题与结语/.test(second.calls[0].text));
 assert.match(second.calls[0].text,/不依据[^。]*提纲/);
});

test('a scoped review keeps an out-of-scope frame finding out of the verdicts of the frames in scope',async()=>{
 const frames=Array.from({length:3},(_,i)=>({id:`f${i+1}`,caption:`第${i+1}幅配文八个字以上`,prompt:`第${i+1}幅画面描述二十个字以上的内容，人物站立在庭院中央。`}));
 const base={source,brief:'梗概',outline,title:'管鲍之交',productionPrompt:REQ,acceptancePrompt:'每幅人物衣冠合乎时代',style,characters:people,frames,notes:undefined,itemIds:{},frameCriteria:[1]};
 const reply=()=>({issues:[],titleReview:{title:'管鲍之交',reason:'准确'},coverage:[{quote:'管仲夷吾者',task:'交代人物',pages:[1],assessment:'adequate',reason:'已交代',issuePage:0}],acceptanceResults:[{criterion:1,status:'unknown',pages:[3],evidence:'第三幅文字无法判断冠服'}]});
 const scoped=await recorder(reply).gen.review({...base,allowed:{pages:[1,2],criteria:[],narrative:false}});
 assert.ok(scoped.value.judgements.every(j=>j.outcome==='pass'),'the findings on frame 3 do not fail frames 1 and 2');
 assert.deepEqual(scoped.value.judgements.map(j=>j.id),['frameVerdict:f1','frameVerdict:f2']);
 assert.deepEqual(scoped.value.issues,[]);
});

test('structural repairs reject overlaps, out-of-range edits and invalid frame counts',async()=>{
 const page={caption:'甲放下礼物，留下足够空间让乙回应。',people:[]};
 const input={source,outline,productionPrompt:REQ,settings:{length:'auto',narrativeDetail:'balanced'},captions:['第一幅的正文','第二幅的正文'],issues:[]};
 for(const edits of [
  [{from:1,to:2,pages:[page]},{from:2,to:2,pages:[page]}],
  [{from:4,to:3,pages:[page]}],
  [{from:1,to:2,pages:[]}],
 ]){
  const {gen}=recorder(()=>({edits}));
  await assert.rejects(gen.structureRepair(input));
 }
 const {gen}=recorder(()=>({edits:[{from:81,to:80,pages:[page]}]}));
 await assert.rejects(gen.structureRepair({...input,captions:Array(80).fill('这一幅的原有配文。')}),/STRUCTURAL_FRAME_LIMIT/);
});
