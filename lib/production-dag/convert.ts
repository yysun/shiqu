// v1 文档转换为 v2：不调用模型，确定性地按位置分配画幅身份，结果可重复。
// 转换得到的产物、结论与放行标为旧规则：内容不变时支持阅读、接续与完成判定，输入变化后按新规则失效。
// 人物设定整段成为一条旧规则人物（视为全部人物入画）；验收要求整体成为一条依据叙事分镜与画面描述的旧规则条目，
// 验收要求文字不变时保留，改变后才按条目拆分重新登记（见 runner 的 syncItems）。提纲与梗概写入 dag 供后续调用读取。
import type {Document,Selection} from '../reader-model.ts';
import {evaluate,instanceKeys,instanceId,runnable,type Product,type Fault,type VersionState} from './engine.ts';
import {nodes,nodeSpec} from './registry.ts';
import {fingerprint} from './fingerprint.ts';
import {rootProducts,versionState,defaultRenderer,type DagDocument,type ModelSnapshot} from './document.ts';

export const legacyFrameId=(index:number)=>`legacy-${index+1}`;
const legacyId='legacy';

type Extra=Partial<Pick<Product,'outcome'|'overridden'|'parts'|'scope'|'evidence'|'unreviewed'>>;

export function convertDocument(doc:Document,selection:Selection,options:{confirmed:boolean;modelSnapshot?:ModelSnapshot;notes?:string}):DagDocument{
 const plan=doc.plan,pages=plan?.pages??doc.storyboard?.pages??doc.draft?.pages??[];
 const order=pages.map((_,i)=>legacyFrameId(i));
 const redraw=doc.revision?.redrawNotes as Record<string,string>|undefined;
 // 提纲与梗概写入 dag，修订、结语、幅数核对与审片读取它们；没有提纲记录的旧故事以各幅配文作节点。
 const outline=doc.storyboard?.outline?{title:doc.storyboard.outline.title,summary:doc.storyboard.outline.summary,sourceReference:doc.storyboard.outline.sourceReference,adaptationNote:doc.storyboard.outline.adaptationNote,beats:doc.storyboard.outline.beats}
  :plan?{title:plan.title,summary:plan.summary,sourceReference:plan.sourceReference,adaptationNote:plan.adaptationNote,beats:pages.map(p=>p.caption)}:undefined;
 const brief=plan?.summary??doc.original?.storyBrief?.summary;
 const dag:DagDocument={
  version:2,legacy:true,order,
  ...(outline?{outline}:{}),...(brief?{brief}:{}),
  frames:Object.fromEntries(pages.map((page,i)=>[order[i],{
   scene:page.caption,visual:page.prompt,
   ...(doc.images[i]?{image:doc.images[i]}:{}),
   ...(redraw?.[i+1]?{redrawNote:redraw[i+1]}:{}),
  }])),
  characters:(plan?.characters??doc.draft?.characters)?[{id:legacyId,name:'',text:(plan?.characters??doc.draft!.characters),legacy:true}]:[],
  items:selection.acceptancePrompt?.trim()?[{id:legacyId,text:selection.acceptancePrompt,scope:'story',evidence:['scenes','visuals'],legacy:true}]:[],
  ...(plan?{ending:{title:plan.title,candidates:doc.reflectionCandidates??[plan.reflection],chosen:plan.reflection}}:{}),
  products:{},
  ...(options.modelSnapshot?{modelSnapshot:options.modelSnapshot}:{}),
  renderer:defaultRenderer,
  ...(doc.revision?.handoff?{continuation:{revision:doc.revision.number??1,reason:'revision-saved' as const}}:{}),
 };

 const review=doc.visualReview;
 const reviewed=review?.status==='passed'||review?.status==='blocked';
 // 旧版没有审核记录、但每幅都有图：保留完成，不授权新的绘图。
 const completedWithoutReview=!review&&pages.length>0&&pages.every((_,i)=>!!doc.images[i]);
 const blockedPages=new Set(review?.status==='blocked'?review.issues.map(i=>i.page):[]);
 const verdict=(failing:boolean):Extra|undefined=>reviewed?{outcome:failing?'fail':'pass',...(review?.overridden?{overridden:true}:{})}:completedWithoutReview?{outcome:'pass',unreviewed:true}:undefined;

 // 各节点实例在 v1 中的内容；undefined 表示该产物尚未产生。
 const content=(node:string,key:string):[unknown,Extra?]|undefined=>{
  const at=order.indexOf(key);
  switch(node){
   case 'source':return doc.original?[doc.original]:undefined;
   case 'brief':return dag.brief?[dag.brief]:undefined;
   case 'suggestions':return doc.setupRequirements?.suggestions||doc.frameRecommendation?[{requirements:doc.setupRequirements?.suggestions??null,frames:doc.frameRecommendation??null}]:undefined;
   case 'outline':return dag.outline?[dag.outline]:undefined;
   case 'characters':return dag.characters.length?[dag.characters,{parts:{[legacyId]:fingerprint(dag.characters[0].text)}}]:undefined;
   case 'scene':return at>=0?[pages[at].caption]:undefined;
   case 'visual':return at>=0?[pages[at].prompt]:undefined;
   case 'ending':return dag.ending?[{title:dag.ending.title,candidates:dag.ending.candidates}]:undefined;
   case 'frameCheck':return reviewed?['legacy-frame-check',{outcome:'pass'}]:completedWithoutReview?['legacy-frame-check',{outcome:'pass',unreviewed:true}]:undefined;
   case 'itemRegistration':return key===legacyId&&dag.items.length?[dag.items[0].text,{scope:'story',evidence:['scenes','visuals']}]:undefined;
   case 'frameVerdict':{const v=verdict(blockedPages.has(at+1));return v?['legacy-verdict',v]:undefined;}
   case 'narrativeVerdict':{const v=verdict(blockedPages.has(0));return v&&plan?['legacy-verdict',{...v,parts:{endingChoice:fingerprint({title:plan.title,ending:plan.reflection})}}]:undefined;}
   case 'itemVerdict':{const v=verdict(review?.stopReason==='requirements');return v?['legacy-verdict',v]:undefined;}
   case 'frameImage':return at>=0&&doc.images[at]?[doc.images[at]]:undefined;
   default:return undefined;
  }
 };

 const roots=rootProducts(selection,dag,{notes:options.notes});
 // 按配置顺序逐个节点写入；每个实例以当前上游指纹为硬输入，因此转换结果全部有效。
 for(const node of Object.keys(nodes)){
  if(nodeSpec(node).kind!=='model')continue;
  const keys=instanceKeys(versionState(dag,roots,{confirmed:options.confirmed}),node);
  for(const key of keys){
   const found=content(node,key);
   if(!found)continue;
   const inst=evaluate(versionState(dag,roots,{confirmed:options.confirmed})).instance(node,key);
   if(!inst.hard)continue;
   dag.products[instanceId(node,key)]={hash:fingerprint(found[0]),inputs:inst.hard,...(inst.check&&Object.keys(inst.check).length?{checks:inst.check}:{}),legacy:true,...found[1]};
  }
 }
 return dag;
}

export type LegacyFault={id:string;kind:string;page:number|null;state:string};

/**
 * 未结的旧故障映射到新节点，版本记为 legacy。图片相关故障按页码（从 0 开始）映射到画幅身份；
 * 没有页码的旧文字步骤故障挂到转换后下一个可运行的节点上，即当初失败的那一步，避免继续时被静默重试。
 */
export function mapLegacyFaults(faults:LegacyFault[],state:VersionState):(Fault&{version:'legacy'})[]{
 const next=runnable(state)[0];
 return faults.filter(f=>f.state==='pending'||f.state==='recovering').flatMap(f=>{
  const base={id:f.id,state:f.state as Fault['state'],version:'legacy' as const};
  if(f.page===null||f.page===undefined)return next?[{...base,node:next.node,key:next.key}]:[];
  const key=state.order[f.page];
  if(!key)return [];
  return f.kind==='landscape-image'?[{...base,node:'landscape',key,optional:true}]:[{...base,node:'frameImage',key}];
 });
}
