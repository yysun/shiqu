// 调用请求只由声明的输入构建：登记表 calls 为每个调用声明绑定、核对、来源与上下文输入，
// 读取器只交出这些输入的值，读取未声明的输入直接抛错。引擎按同一份声明计算并记录指纹，
// 因此登记表、指纹与发出的请求只有一份输入定义。审片的绑定输入是本次允许结论各自的硬输入之并，
// 允许清单之外的画幅只提供叙事与画面上下文。
import type {Selection} from '../reader-model.ts';
import {readerBooks} from '../reader-books.ts';
import {normalizeProductionPrompt} from '../reader-prompts.ts';
import type {ReviewIssue} from '../reader-review.ts';
import {calls,nodeSpec,type CallSpec} from './registry.ts';
import {instanceId,type Instance} from './engine.ts';
import {framePrompt,type SourceInput,type StyleInput,type Character,type Outline,type ReviewInput} from './calls.ts';
import {type DagDocument,type DagIssue} from './document.ts';
import type {DagStory,Work} from './runner.ts';

type RequestInputs=Omit<Work,'instances'>&{instances:Pick<Instance,'key'|'node'>[]};

export function bookLabel(selection:Selection){
 return ((selection.bookId==='other'?selection.customBook:readerBooks.find(b=>b.id===selection.bookId)?.title||selection.bookId)||'').trim();
}
export const styleOf=(selection:Selection):StyleInput=>({artStyle:selection.artStyle,artStylePrompt:selection.artStylePrompt??null});
/** 制作要求的实际值：按主题规范化后的文字；根输入指纹按同一值计算。 */
export const productionRequirement=(selection:Selection)=>normalizeProductionPrompt(selection.productionPrompt||'',selection.theme||'');

const characters=(dag:DagDocument):Character[]=>dag.characters.map(c=>({id:c.id,name:c.name,aliases:c.aliases??[],text:c.text}));
const pick=(dag:DagDocument,ids:string[]=[])=>(characters(dag)).filter(c=>ids.includes(c.id));
const at=(dag:DagDocument,key:string)=>dag.order.indexOf(key);
const stripTarget=({target:_t,stalled:_s,...issue}:DagIssue):ReviewIssue=>{void _t;void _s;return issue;};

/** 输入引用到实际值；与引擎 resolve() 的引用一一对应。 */
function value(story:DagStory,item:RequestInputs,ref:string,key:string):unknown{
 const {dag,doc,selection}=story,frame=dag.frames[key];
 switch(ref){
  case 'source':if(!doc.original)throw Error('DAG_SOURCE_MISSING');return {original:doc.original,book:bookLabel(selection),chosenStory:selection.storyTitle,theme:selection.theme,variationSeed:story.id} satisfies SourceInput;
  case 'brief':return dag.brief;
  case 'productionReq':return productionRequirement(selection);
  case 'acceptanceReq':return story.selection.acceptancePrompt??'';
  case 'settings':return {narrativeDetail:selection.narrativeDetail||'balanced',length:selection.length};
  case 'style':return styleOf(selection);
  case 'notes':return doc.reviewNotes||undefined;
  case 'frameCheck':return dag.frameCheck;
  case 'outline':if(!dag.outline)throw Error('DAG_OUTLINE_MISSING');return dag.outline;
  case 'order':return dag.order;
  case 'renderer':return dag.renderer;
  case 'characters':return characters(dag);
  case 'characters@drawn':return pick(dag,frame?.drawn);
  case 'scene@self':return frame?.scene??'';
  case 'scene@all':return dag.order.map(id=>dag.frames[id]?.scene??'');
  case 'scene@neighbors':return {before:dag.frames[dag.order[at(dag,key)-1]]?.scene,after:dag.frames[dag.order[at(dag,key)+1]]?.scene};
  case 'scene@batchDone':return dag.order.slice(0,at(dag,key)).map(id=>dag.frames[id]?.scene??'');
  case 'visual@self':case 'visual@previous':return frame?.visual??'';
  case 'visual@all':return dag.order.map(id=>dag.frames[id]?.visual??'');
  case 'style@previous':{const recorded=dag.products[instanceId('visual',key)]?.inputs.style;return dag.styles?.[recorded??'']??styleOf(selection);}
  case 'ending':return dag.ending;
  case 'endingChoice':{const ending=dag.ending;return ending?.confirmed??(ending?{title:ending.selectedTitle??ending.title,ending:ending.chosen??ending.candidates[0]}:undefined);}
  case 'endingConfirmed':return dag.ending?.confirmed;
  case 'redrawNote@self':return frame?.redrawNote;
  case 'frameImage@self':return frame?.image;
  case 'reference':return story.refSource||(at(dag,key)>0?dag.frames[dag.order[0]]?.image:undefined);
  case 'issues':return (item.issues??[]).filter(i=>!key||dag.order[i.page-1]===key).map(stripTarget);
  default:throw Error(`DAG_INPUT_UNKNOWN: ${ref}`);
 }
}

/** 本次工作声明的输入；审片为允许结论各自的硬输入与上下文之并。 */
export function declaredInputs(_story:DagStory,item:RequestInputs):Set<string>{
 const spec=(calls as Record<string,CallSpec>)[item.call];
 if(!spec)throw Error(`DAG_CALL_UNKNOWN: ${item.call}`);
 const refs=new Set([...spec.bound,...(spec.check||[]),...(spec.sources||[]),...(spec.context||[])]);
 if(item.call==='review'){
  refs.delete('verdict@inputs');
  for(const inst of item.instances){
   const node=nodeSpec(inst.node);
   for(const ref of [...node.hard,...(node.check||[])])refs.add(ref);
  }
 }
 return refs;
}

export type Reader={has(ref:string):boolean;get<T=unknown>(ref:string,key?:string):T};

/**
 * 读取器：只交出声明的输入。按画幅或条目的引用（@self、@drawn 等）只能读本次工作的实例；
 * @window 与 @all 的声明允许读对应画幅；同批其他实例按 @batch 声明作为来源可读。
 */
export function reader(story:DagStory,item:RequestInputs):Reader{
 const declared=declaredInputs(story,item);
 const keys=new Set(item.instances.map(i=>i.key));
 const window=new Set<string>();
 for(const key of keys){const i=at(story.dag,key);for(const k of [story.dag.order[i-1],key,story.dag.order[i+1]])if(k)window.add(k);}
 const allowed=(ref:string)=>{
  if(declared.has(ref))return true;
  const [name,selector]=ref.split('@');
  // 按画幅的值由 @window 或 @all 的声明覆盖；@neighbors、@batchDone、@previous 只按原名声明。
  return selector==='self'&&(declared.has(`${name}@window`)||declared.has(`${name}@all`));
 };
 return {
  has:ref=>declared.has(ref),
  get<T>(ref:string,key=''):T{
   if(!allowed(ref))throw Error(`DAG_UNDECLARED_INPUT: ${item.call} reads ${ref}`);
   const selector=ref.split('@')[1];
   if(['self','drawn','neighbors','batchDone','previous'].includes(selector??'')||ref==='reference'||ref==='item@self'){
    const inScope=keys.has(key)||declared.has(`${ref.split('@')[0]}@window`)&&window.has(key)||declared.has(`${ref.split('@')[0]}@all`);
    if(!inScope)throw Error(`DAG_UNDECLARED_INPUT: ${item.call} reads ${ref} of ${key}`);
   }
   return value(story,item,ref,key) as T;
  },
 };
}

export type CallInput={method:string;args:unknown};
type Builder=(read:Reader,story:DagStory,item:Work)=>unknown;

const keysOf=(item:Work)=>item.instances.map(i=>i.key);
const visualFrame=(read:Reader,story:DagStory,key:string)=>({index:at(story.dag,key),caption:read.get<string>('scene@self',key)});

const builders:Record<string,Builder>={
 prepareBrief:read=>({source:read.get('source'),productionPrompt:read.get('productionReq')}),
 characters:read=>({source:read.get('source'),productionPrompt:read.get('productionReq')}),
 outline:read=>({source:read.get('source'),productionPrompt:read.get('productionReq'),settings:read.get('settings')}),
 sceneBatch:(read,story,item)=>{
  const first=keysOf(item)[0];
  return {source:read.get('source'),outline:read.get('outline'),productionPrompt:read.get('productionReq'),first:at(story.dag,first)+1,count:item.instances.length,previous:read.get('scene@batchDone',first)};
 },
 visual:(read,story,item)=>({outline:read.get('outline'),productionPrompt:read.get('productionReq'),style:read.get('style'),characters:read.get('characters'),frames:keysOf(item).map(k=>visualFrame(read,story,k))}),
 restyle:(read,story,item)=>({outline:read.get('outline'),productionPrompt:read.get('productionReq'),style:read.get('style'),characters:read.get('characters'),previousStyle:read.get('style@previous',keysOf(item)[0]),
  frames:keysOf(item).map(k=>({...visualFrame(read,story,k),previousPrompt:read.get<string>('visual@previous',k)}))}),
 sceneRepair:(read,story,item)=>({source:read.get('source'),outline:read.get('outline'),productionPrompt:read.get('productionReq'),notes:read.get('notes'),
  frames:keysOf(item).map(k=>({index:at(story.dag,k),caption:read.get<string>('scene@self',k),neighbors:read.get('scene@neighbors',k),issues:read.get('issues',k)}))}),
 visualRepair:(read,story,item)=>({outline:read.get('outline'),productionPrompt:read.get('productionReq'),style:read.get('style'),characters:read.get('characters'),notes:read.get('notes'),
  frames:keysOf(item).map(k=>({...visualFrame(read,story,k),prompt:read.get<string>('visual@self',k),drawn:read.get<Character[]>('characters@drawn',k),issues:read.get('issues',k)}))}),
 structureRepair:(read,_story,item)=>{
  const report=item.instances[0].node==='frameCheck'?read.get<import('../reader-review.ts').FrameCountReport>('frameCheck'):undefined;
  return {source:read.get('source'),outline:read.get('outline'),productionPrompt:read.get('productionReq'),settings:read.get('settings'),captions:read.get('scene@all'),issues:read.get('issues'),notes:read.get('notes'),
   ...(report?{frameCountContext:{frameCountReview:report.frameCountReview,requirements:report.requirements}}:{})};
 },
 ending:read=>({source:read.get('source'),outline:read.get('outline'),captions:read.get('scene@all')}),
 endingRepair:read=>{
  const ending=read.get<DagDocument['ending']>('ending');
  return {source:read.get('source'),outline:read.get('outline'),captions:read.get('scene@all'),reflection:read.get<{ending:string}|undefined>('endingChoice')?.ending??ending?.candidates[0]??'',issues:read.get('issues'),notes:read.get('notes')};
 },
 frameCheck:read=>({source:read.get('source'),outline:read.get('outline'),productionPrompt:read.get('productionReq'),settings:read.get('settings'),captions:read.get('scene@all'),notes:read.get('notes')}),
 review:reviewArgs,
};

/** 审片参数：全篇叙事分镜与画面描述是上下文；其余只在某个允许结论绑定时提供。 */
function reviewArgs(read:Reader,story:DagStory,item:Work):ReviewInput{
 const {dag}=story;
 const allowed=new Set(item.instances.map(i=>i.id));
 const captions=read.get<string[]>('scene@all'),prompts=read.get<string[]>('visual@all');
 const ending=read.has('ending')?read.get<DagDocument['ending']>('ending'):undefined;
 const outline=read.has('outline')?read.get<Outline>('outline'):undefined;
 const drawnOf=(ids:string[])=>[...new Map(ids.flatMap(id=>read.get<Character[]>('characters@drawn',id)).map(c=>[c.id,c])).values()];
 const frameKeys=item.instances.filter(i=>i.node==='frameVerdict').map(i=>i.key);
 const cast=read.has('characters')?read.get<Character[]>('characters'):read.has('characters@drawn')?drawnOf(frameKeys):undefined;
 const confirmed=read.has('endingConfirmed')?read.get<{title:string;ending:string}|undefined>('endingConfirmed'):undefined;
 return {
  source:read.get('source'),
  ...(read.has('brief')?{brief:read.get<string>('brief')}:{}),
  ...(outline?{outline}:{}),
  ...(ending?{title:ending.title,candidates:ending.candidates}:{}),
  ...(confirmed?{confirmedEnding:confirmed}:{}),
  ...(read.has('productionReq')?{productionPrompt:read.get<string>('productionReq')}:{}),
  ...(read.has('acceptanceReq')?{acceptancePrompt:read.get<string>('acceptanceReq')}:{}),
  ...(read.has('frameCheck')?{frameCheck:read.get<DagDocument['frameCheck']>('frameCheck')}:{}),
  ...(read.has('style')?{style:read.get<StyleInput>('style')}:{}),
  ...(cast?{characters:cast}:{}),
  notes:read.get<string|undefined>('notes'),
  frames:dag.order.map((id,i)=>({id,caption:captions[i],prompt:prompts[i]})),
  allowed:{
   pages:dag.order.map((id,i)=>allowed.has(`frameVerdict:${id}`)?i+1:0).filter(Boolean),
   narrative:allowed.has('narrativeVerdict:'),
  },
 };
}

/** 为一项文字工作准备 dagGenerator 的方法与参数。 */
export function requestFor(story:DagStory,item:Work):CallInput{
 const build=builders[item.call];
 if(!build)throw Error(`DAG_CALL_NOT_TEXT: ${item.call}`);
 return {method:item.call,args:build(reader(story,item),story,item)};
}

/** 绘图与横图的输入：同样经读取器，只读本幅画面描述、入画人物设定、画风、重绘说明与参考图。 */
export function drawInput(story:DagStory,item:RequestInputs){
 const read=reader(story,item),key=item.instances[0].key,index=at(story.dag,key),landscape=item.call==='drawLandscape';
 const style=read.get<StyleInput>('style');
 const reference=landscape?read.get<string|undefined>('frameImage@self',key):read.get<string|undefined>('reference',key);
 const prompt=framePrompt({visual:read.get<string>('visual@self',key),redrawNote:landscape?undefined:read.get<string|undefined>('redrawNote@self',key),drawn:read.get<Character[]>('characters@drawn',key),style,index,reference:!!reference,layout:landscape?'landscape':'portrait'});
 return {index,prompt,reference:reference||'',style,layout:landscape?'landscape' as const:'portrait' as const};
}

export type {Instance};
