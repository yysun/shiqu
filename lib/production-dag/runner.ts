// 制作 DAG 的执行层（纯函数，不调用模型、不读写数据库）：由故事内容建立引擎状态，决定本轮调用，
// 为调用准备契约输入，并把结果写回 dag。服务端按 work() 派发任务、按 inputsFor() 调用 dagGenerator，
// 再用 apply() 在会话锁下保存；apply 先核对派发时的硬输入，输入已变的迟到结果直接丢弃。
// 无需调用的步骤（采用已有原文、已核对的梗概与准备建议，按绘图输入复用旧图，同步验收条目）由 settle() 完成。
// 提纲重新生成时画幅取得新身份；结构修订按合并沿用第一幅、拆分第一段沿用原身份的规则改写顺序。
// 自动修订由审片问题驱动：问题按画幅归属，画面类问题做画面修订，其余做叙事修订，需要重排的做结构修订；
// 手改、额度用尽、修订无变化或要求无法判断时不再派发，由 attention() 报告「需读者处理」。
import type {Document,Selection} from '../reader-model.ts';
import {productionRequirement,styleOf} from './requests.ts';
import {castFrom} from './frames.ts';
import {preparationCandidate,preparationPending} from '../reader-preparation.ts';
import {preparesSelectedStory} from '../reader-frame-recommendation.ts';
import {storyBriefVerified} from '../reader-story-brief.ts';
import {evaluate,instanceId,reusable,complete,type Instance,type Fault,type Product,type VersionState} from './engine.ts';
import {nodeSpec} from './registry.ts';
import {withReviewSkip} from './review-skip.ts';
import {fingerprint} from './fingerprint.ts';
import {callGroups,type CallGroup} from './schedule.ts';
import {acknowledgedChecks,reviewStage,newRepairBudget,canRepair,liveSuggestions,verdictNodes,type Suggestion} from './review.ts';
import {structuralLoss} from './hand-edits.ts';
import {acceptanceItems,type Outline,type Scene,type Visual,type Character,type ReviewOutcome} from './calls.ts';
import {rootProducts,versionState,endingChoice,type DagDocument,type DagIssue,type DagFrame} from './document.ts';
import type {FrameCountReport,ReviewIssue} from '../reader-review.ts';

export type DagStory={
 id:string;doc:Document;selection:Selection;dag:DagDocument;
 /** 制作已确认（准备阶段结束）。 */
 confirmed:boolean;
 faults:Fault[];
 /** 本书星标的参考图；缺省时由各幅按原规则选择本篇首幅。 */
 refSource?:string;
};

/** 一项待派发的工作：一次调用及其产出的实例（派发时的硬输入随实例记录）。 */
export type Work=CallGroup&{issues?:DagIssue[]};

const visualCategories=new Set(['composition','style','action']);
const frameNodes=new Set(['scene','visual','frameImage','landscape','redrawNote']);

/**
 * 验收条目随验收要求同步：条目身份由文字决定，已有登记按身份保留。转换得到的整体旧条目在验收要求文字不变时保留，
 * 连同其结论与放行；文字改变后才按条目拆分，重新登记并审片。
 */
export function syncItems(dag:DagDocument,selection:Selection):DagDocument{
 const legacy=dag.items.length===1&&dag.items[0].legacy?dag.items[0]:undefined;
 if(legacy&&legacy.text.trim()===(selection.acceptancePrompt??'').trim())return dag;
 const previous=new Map(dag.items.map(i=>[i.id,i]));
 const items=acceptanceItems(selection.acceptancePrompt).map(i=>previous.get(i.id)??i);
 return JSON.stringify(items)===JSON.stringify(dag.items)?dag:{...dag,items};
}

export function stateOf(story:DagStory,{includeReviewSkip=true}={}):VersionState{
 const reprepare=!!story.dag.repreparing;
 const preparing=reprepare||preparationPending(story.doc)||story.doc.intake?.phase==='confirming';
 const seed=preparing?{generation:story.dag.preparationGeneration??story.doc.intake?.generation,production:productionRequirement(story.selection),detail:story.selection.narrativeDetail}:undefined;
 const roots=rootProducts(story.selection,story.dag,{notes:story.doc.reviewNotes,refSource:story.refSource,seed});
 // 横图局部失败也须读者明确重试，查看作品或重建队列不能自动重新购买。
 const landscapeFaults=story.dag.order.flatMap((key):Fault[]=>story.dag.frames[key]?.landscape===''&&story.dag.frames[key].landscapeError?
  [{id:`landscape:${key}`,node:'landscape',key,state:'pending',optional:true}]:[]);
 const state=versionState(story.dag,roots,{confirmed:story.confirmed,faults:[...story.faults,...landscapeFaults],reprepare,skipFrameCheck:typeof story.selection.length==='number'});
 if(state.landscapes?.some(key=>story.dag.frames[key].landscapeInputHash)){
  const evaluation=evaluate(state);
  state.landscapes=state.landscapes.filter(key=>{
   const binding=story.dag.frames[key].landscapeInputHash;
   const hard=binding?evaluation.instance('landscape',key).hard:undefined;
   return !hard||fingerprint(hard)===binding;
  });
 }
 return includeReviewSkip?withReviewSkip(state,story.dag):state;
}

const clone=(dag:DagDocument):DagDocument=>structuredClone(dag);
const sameInputs=(a:Record<string,string>|undefined,b:Record<string,string>|undefined)=>
 !!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>a[k]===b[k]);
function record(dag:DagDocument,inst:Pick<Instance,'id'|'hard'|'check'>,content:unknown,extra:Partial<Product>={}){
 dag.products[inst.id]={hash:fingerprint(content),inputs:inst.hard!,...(inst.check&&Object.keys(inst.check).length?{checks:inst.check}:{}),...extra};
}
const frame=(dag:DagDocument,id:string):DagFrame=>dag.frames[id]??(dag.frames[id]={scene:'',visual:''});
const framePosition=(dag:DagDocument,id:string)=>dag.order.indexOf(id);

/** 画面描述的调用：只因画风变化而失效、其余硬输入不变时做换画风转换，否则重新生成。 */
export function callFor(state:VersionState){
 return (instance:Instance)=>{
  const call=nodeSpec(instance.node).call!;
  if(instance.node!=='visual')return call;
  const product=state.products[instance.id];
  if(!product||!instance.hard||product.handEdited)return call;
  const changed=Object.keys(instance.hard).filter(k=>product.inputs[k]!==instance.hard![k]);
  return changed.length===1&&changed[0]==='style'?'restyle':call;
 };
}

/**
 * 无需调用模型的步骤：采用已核原文与已保存的准备结果、按绘图输入复用旧图、同步验收条目。
 * 返回新的 dag；没有变化时返回原对象。
 */
export function settle(story:DagStory):DagDocument{
 let dag=syncItems(story.dag,story.selection);
 // 采用已保存的出处和准备结果，包括升级前的确认草稿。选择改变时会清除旧的准备内容。
 const adopt=(node:string,content:unknown)=>{
  if(content===undefined||content===null)return;
  const inst=evaluate(stateOf({...story,dag})).instance(node);
  if(!inst.hard||inst.status==='valid'&&dag.products[inst.id]?.hash===fingerprint(content))return;
  dag=dag===story.dag?clone(dag):dag;record(dag,inst,content);
 };
 // 记录当前画风设置，换画风转换据此取得旧画风。
 const current=styleOf(story.selection),key=fingerprint(current);
 if(!dag.styles?.[key]){dag=dag===story.dag?clone(dag):dag;dag.styles={...dag.styles,[key]:current};}
 adopt('source',story.doc.original);
 // 准备阶段已对照原文核对的故事梗概作为梗概产物采用，不再付费重写；读者手改过的梗概不被覆盖。
 const productionReq=productionRequirement(story.selection);
 const preparedScope=story.doc.summaryProductionPrompt,previousScope=dag.products['brief:']?.inputs.productionReq;
 const sameScope=preparedScope===undefined?previousScope===undefined||previousScope===fingerprint(productionReq):preparedScope===productionReq;
 const verified=sameScope&&storyBriefVerified(story.doc.original)?story.doc.original?.storyBrief?.summary:undefined;
 if(verified&&!dag.products['brief:']?.handEdited&&(dag.brief===undefined||dag.brief===verified)){
  if(dag.brief===undefined){dag=dag===story.dag?clone(dag):dag;dag.brief=verified;}
  adopt('brief',verified);
 }
 if(!story.confirmed&&story.doc.frameRecommendation){
  adopt('suggestions',{requirements:story.doc.setupRequirements?.suggestions??null,frames:story.doc.frameRecommendation});
 }
 // 复用：硬输入与某份旧图完全一致时直接沿用，不要求画幅身份相同。
 for(const node of ['frameImage','landscape'] as const){
  const state=stateOf({...story,dag,faults:story.faults.filter(fault=>!fault.imageLoss)});
  const pool=Object.entries(dag.products).filter(([id,p])=>id.startsWith(node+':')&&p.readable!==false);
  for(const inst of evaluate(state).all().filter(i=>i.node===node&&i.ready&&i.hard)){
   if(node==='frameImage'&&inst.key===dag.cover?.frame)continue;
   const match=reusable(pool.map(([,p])=>p),inst.hard!);
   if(!match)continue;
   const [sourceId]=pool.find(([,p])=>p===match)!;
   const url=node==='frameImage'?dag.frames[sourceId.slice(node.length+1)]?.image:dag.frames[sourceId.slice(node.length+1)]?.landscape;
   if(!url)continue;
   dag=dag===story.dag?clone(dag):dag;
   frame(dag,inst.key)[node==='frameImage'?'image':'landscape']=url;
   dag.products[inst.id]={...match,inputs:inst.hard!,...(inst.check&&Object.keys(inst.check).length?{checks:inst.check}:{})};
  }
 }
 // 读者指定的首幅原图：该幅的输入就绪时记为成图产物（输入指纹按当前画风与画面描述），之后其余画幅以它为参考。
 if(dag.cover){
  const {frame:key}=dag.cover,image=dag.frames[key]?.image;
  const inst=image&&dag.order.includes(key)?evaluate(stateOf({...story,dag})).instance('frameImage',key):undefined;
  if(!inst)dag={...(dag===story.dag?clone(dag):dag),cover:undefined};
  else if(inst.ready&&inst.hard){
   dag=dag===story.dag?clone(dag):dag;
   record(dag,inst,image);
   delete dag.cover;
  }
  if(dag.cover===undefined&&'cover'in dag)delete dag.cover;
 }
 return dag;
}

/** 本轮可派发的工作：引擎的可运行实例按调用合批，叙事分镜批次按顺序逐批进行，其后是自动修订。 */
export function work(story:DagStory):Work[]{
 if(story.doc.reselection)return [];
 const state=stateOf(story);
 const groups=callGroups(state,callFor(state));
 if(story.dag.repreparing)return groups.filter(item=>item.call==='prepareSuggestions'||item.call==='drawLandscape');
 if(!story.confirmed){
  if(!preparationPending(story.doc)||story.doc.frameRecommendation)return [];
  const candidate=preparationCandidate(story.doc),source=story.doc.original;
  const needsArt=source&&candidate?.source&&!candidate.artRecommendation&&!story.dag.preparedArt&&!preparesSelectedStory(story.selection,source);
  return groups.filter(item=>item.call==='verifySource'||item.call==='prepareSuggestions').map(item=>
   needsArt&&item.call==='prepareSuggestions'?{...item,call:'prepareArt'}:item);
 }
 const production=groups.filter(g=>!['prepareSuggestions','search'].includes(g.call));
 // 后一批叙事分镜以前一批的配文为来源，须等前一批完成。
 const firstScene=production.find(g=>g.call==='sceneBatch');
 const result:Work[]=production.filter(g=>g.call!=='sceneBatch'||g===firstScene);
 if(firstScene&&framePosition(story.dag,firstScene.instances[0].key)>0){
  const before=story.dag.order.slice(0,framePosition(story.dag,firstScene.instances[0].key));
  if(before.some(id=>evaluate(state).instance('scene',id).status!=='valid'))return result.filter(g=>g!==firstScene);
 }
 return [...result,...repairWork(story,state)];
}

export type Attention={target:string;reason:'hand-edited'|'limit'|'unchanged'|'requirements'|'unrepairable'};

function failing(state:VersionState){
 const ev=evaluate(state);
 const verdicts=[...verdictNodes].flatMap(node=>ev.all().filter(i=>i.node===node));
 if(verdicts.some(i=>i.status!=='valid'))return null;
 return verdicts.filter(i=>{const p=state.products[i.id];return p?.outcome==='fail'&&!p.overridden;});
}

/** 自动修订的计划：只在全部结论有效且有未放行的失败时进行。 */
function repairPlan(story:DagStory,state:VersionState):{work:Work[];attention:Attention[]}{
 const ev=evaluate(state),dag=story.dag,attention:Attention[]=[],out:Work[]=[];
 const budget=dag.repairs??newRepairBudget();
 const check=ev.instance('frameCheck'),checkProduct=state.products[check.id];
 if(check.status==='valid'&&checkProduct?.outcome==='fail'&&!checkProduct.overridden){
  const issues=(dag.issues??[]).filter(i=>i.target===check.id);
  if(!canRepair(budget))attention.push({target:check.id,reason:'limit'});
  else if(!issues.length||issues.some(i=>i.stalled))attention.push({target:check.id,reason:issues.length?'unchanged':'unrepairable'});
  else out.push({call:'structureRepair',instances:[check],issues});
  return {work:out,attention};
 }
 const failed=failing(state);
 if(!failed?.length)return {work:out,attention};
 const targets=new Set(failed.map(i=>i.id));
 const issues=(dag.issues??[]).filter(i=>targets.has(i.target));
 for(const inst of failed){
  if(state.products[inst.id]?.outcome==='fail'&&dag.verdicts?.[inst.id]?.requirements)attention.push({target:inst.id,reason:'requirements'});
  else if(!issues.some(i=>i.target===inst.id))attention.push({target:inst.id,reason:'unrepairable'});
 }
 const open=issues.filter(i=>!i.stalled&&!attention.some(a=>a.target===i.target));
 for(const i of issues.filter(i=>i.stalled))attention.push({target:i.target,reason:'unchanged'});
 if(!open.length)return {work:out,attention};
 if(!canRepair(budget)){for(const i of open)attention.push({target:i.target,reason:'limit'});return {work:out,attention};}
 const replan=open.filter(i=>i.requiresReplan);
 // 结构修订以叙事结论为栅栏：其硬输入含画幅顺序，派发后顺序改变的结果作废。
 if(replan.length)return {work:[{call:'structureRepair',instances:[ev.instance('narrativeVerdict')],issues:replan}],attention};
 const scenes=new Map<string,DagIssue[]>(),visuals=new Map<string,DagIssue[]>(),ending:DagIssue[]=[];
 for(const issue of open){
  if(issue.page===0){ending.push(issue);continue;}
  const id=dag.order[issue.page-1];if(!id){attention.push({target:issue.target,reason:'unrepairable'});continue;}
  const into=visualCategories.has(issue.category)?visuals:scenes;
  into.set(id,[...(into.get(id)??[]),issue]);
 }
 const take=(node:'scene'|'visual',call:string,map:Map<string,DagIssue[]>)=>{
  const instances:Instance[]=[];const list:DagIssue[]=[];
  for(const [id,found] of map){
   const inst=ev.instance(node,id);
   if(state.products[inst.id]?.handEdited){for(const i of found)attention.push({target:i.target,reason:'hand-edited'});continue;}
   instances.push(inst);list.push(...found);
  }
  for(let i=0;i<instances.length;i+=20)out.push({call,instances:instances.slice(i,i+20),issues:list.filter(x=>instances.slice(i,i+20).some(inst=>dag.order[x.page-1]===inst.key))});
 };
 take('scene','sceneRepair',scenes);take('visual','visualRepair',visuals);
 if(ending.length){
  const inst=ev.instance('ending');
  if(dag.ending?.confirmed||state.products[inst.id]?.handEdited)for(const i of ending)attention.push({target:i.target,reason:'hand-edited'});
  else out.push({call:'endingRepair',instances:[inst],issues:ending});
 }
 return {work:out,attention};
}
function repairWork(story:DagStory,state:VersionState){return repairPlan(story,state).work;}

/** 「需读者处理」的结论：审片未通过且不再自动修订的原因。 */
export function attention(story:DagStory):Attention[]{
 return repairPlan(story,stateOf(story)).attention;
}
export {complete};

// 调用请求与绘图输入由 requests.ts 按声明的输入构建。
export {requestFor,drawInput} from './requests.ts';

// ——— 写回结果 ———

/** 派发时记录的实例与当前实例的硬输入不同：结果属于旧输入，丢弃。 */
export function stale(story:DagStory,item:Work):boolean{
 const ev=evaluate(stateOf(story));
 return item.instances.some(i=>!sameInputs(ev.instance(i.node,i.key).hard,i.hard));
}

export type ApplyOptions={newId:()=>string};

/** 把一次调用的结果写回 dag；输入已变时返回 null。 */
export function apply(story:DagStory,item:Work,value:unknown,options:ApplyOptions):DagDocument|null{
 if(item.instances.length&&stale(story,item))return null;
 const dag=clone(story.dag),one=item.instances[0];
 switch(item.call){
  case 'verifySource':record(dag,one,value);break;
  case 'prepareArt':dag.preparedArt=true;break;
  case 'prepareSuggestions':record(dag,one,value);break;
  case 'prepareBrief':dag.brief=value as string;record(dag,one,value);break;
  case 'characters':{
   const list=value as Character[];
   dag.characters=list.map(c=>({id:c.id,name:c.name,aliases:c.aliases,text:c.text}));
   for(const id of dag.order)cast(dag,frame(dag,id));
   record(dag,one,list,{parts:Object.fromEntries(list.map(c=>[c.id,fingerprint(c)]))});break;
  }
  case 'outline':{
   const next=value as Outline,changed=dag.products[one.id]?.hash!==fingerprint(next)||dag.order.length!==next.beats.length;
   dag.outline=next;record(dag,one,next);
   if(changed)replanFrames(dag,next.beats.length,options.newId);
   break;
  }
  case 'sceneBatch':case 'sceneRepair':{
   const scenes=value as Scene[];
   if(item.call==='sceneRepair'&&unchanged(dag,item,scenes.map(s=>s.caption),id=>dag.frames[id].scene))return markStalled(dag,item);
   item.instances.forEach((inst,i)=>{const f=frame(dag,inst.key);f.scene=scenes[i].caption;f.people=scenes[i].people;cast(dag,f);record(dag,inst,scenes[i].caption);});
   if(item.call==='sceneRepair')spendRepair(dag,item);
   break;
  }
  case 'visual':case 'restyle':case 'visualRepair':{
   const visuals=value as Visual[];
   if(item.call==='visualRepair'&&unchanged(dag,item,visuals.map(v=>v.prompt),id=>dag.frames[id].visual))return markStalled(dag,item);
   item.instances.forEach((inst,i)=>{const f=frame(dag,inst.key);f.visual=visuals[i].prompt;f.drawnNames=visuals[i].drawn;cast(dag,f);record(dag,inst,{prompt:visuals[i].prompt,drawn:visuals[i].drawn});});
   if(item.call==='visualRepair')spendRepair(dag,item);
   break;
  }
  case 'ending':{
   const next=value as {title:string;candidates:string[]};
   dag.ending={...dag.ending,title:next.title,candidates:next.candidates,chosen:next.candidates.includes(dag.ending?.chosen??'')?dag.ending!.chosen:undefined};
   record(dag,one,next);break;
  }
  case 'endingRepair':{
   const reflection=value as string,before=dag.ending?.chosen??dag.ending?.candidates[0];
   if(reflection===before)return markStalled(dag,item);
   const candidates=(dag.ending?.candidates??[]).map(c=>c===before?reflection:c);
   dag.ending={...dag.ending!,candidates:candidates.includes(reflection)?candidates:[reflection,...candidates.slice(1)],chosen:reflection};
   record(dag,one,{title:dag.ending.title,candidates:dag.ending.candidates});spendRepair(dag,item);break;
  }
  case 'frameCheck':{
   const report=value as FrameCountReport;
   dag.frameCheck=report;
   const pass=report.frameCountReview.decision==='keep';
   record(dag,one,report,{outcome:pass?'pass':'fail'});
   dag.issues=[...(dag.issues??[]).filter(i=>i.target!==one.id),...(pass?[]:report.issues.map(i=>({...i,requiresReplan:true,target:one.id})))];
   break;
  }
  case 'registerItems':{
   for(const r of value as {id:string;scope:'story'|'frame';evidence:import('./registry.ts').Evidence[]}[]){
    const inst=item.instances.find(i=>i.key===r.id);if(!inst)continue;
    dag.items=dag.items.map(i=>i.id===r.id?{...i,scope:r.scope,evidence:r.evidence}:i);
    record(dag,inst,{scope:r.scope,evidence:r.evidence},{scope:r.scope,evidence:r.evidence});
   }
   break;
  }
  case 'review':applyReview(story,dag,item,value as ReviewOutcome);break;
  case 'structureRepair':{
   const result=applyStructureRepair(story,dag,item,value as {from:number;to:number;scenes:Scene[]}[],options.newId);
   if(!result)return markStalled(dag,item);
   break;
  }
  case 'draw':case 'drawLandscape':{
   const url=value as string,f=frame(dag,one.key);
   if(item.call==='draw')f.image=url;else{f.landscape=url;delete f.landscapeError;delete f.landscapeInputHash;}
   record(dag,one,url);break;
  }
  default:throw Error(`DAG_CALL_UNKNOWN: ${item.call}`);
 }
 return dag;
}

/**
 * 候选人物与入画人物：模型返回名字，按人物设定的名字与别名匹配为条目。人物设定在叙事分镜之后才生成时，
 * 保存人物设定时按已存的名字重新匹配；没有名字记录的旧画幅保持原样（视为全部人物）。
 */
function cast(dag:DagDocument,f:DagFrame){
 if(f.people)f.candidates=castFrom([f.scene,...f.people].join(' '),dag.characters);
 if(f.drawnNames)f.drawn=castFrom(f.drawnNames.join(' '),dag.characters);
}

/** 提纲改变后重新编排：全部画幅取得新身份；仍有图的旧画幅只保留图片以供按输入复用。 */
function replanFrames(dag:DagDocument,count:number,newId:()=>string){
 const old=dag.order;
 dag.order=Array.from({length:count},newId);
 for(const id of old){
  const image=dag.frames[id]?.image;
  for(const node of frameNodes)if(node!=='frameImage'||!image)delete dag.products[instanceId(node,id)];
  for(const node of verdictNodes)delete dag.products[instanceId(node,id)];
  if(image)dag.frames[id]={scene:'',visual:'',image};else delete dag.frames[id];
 }
 for(const id of dag.order)dag.frames[id]={scene:'',visual:''};
 dag.issues=[];
}

function unchanged(dag:DagDocument,item:Work,next:string[],current:(id:string)=>string){
 return item.instances.every((inst,i)=>current(inst.key)===next[i]);
}
function markStalled(dag:DagDocument,item:Work):DagDocument{
 const targets=new Set((item.issues??[]).map(i=>JSON.stringify([i.target,i.page,i.problem])));
 dag.issues=(dag.issues??[]).map(i=>targets.has(JSON.stringify([i.target,i.page,i.problem]))?{...i,stalled:true}:i);
 return dag;
}
function spendRepair(dag:DagDocument,item:Work){
 const budget=dag.repairs??newRepairBudget();
 dag.repairs={...budget,used:budget.used+1};
 const done=new Set((item.issues??[]).map(i=>JSON.stringify([i.target,i.page,i.problem])));
 dag.issues=(dag.issues??[]).filter(i=>!done.has(JSON.stringify([i.target,i.page,i.problem])));
}

function applyReview(story:DagStory,dag:DagDocument,item:Work,outcome:ReviewOutcome){
 const allowed=new Map(item.instances.map(i=>[i.id,i]));
 const verdicts={...dag.verdicts};
 const failedItems=outcome.judgements.filter(j=>j.outcome==='fail'&&j.id.startsWith('itemVerdict:')).map(j=>j.id);
 if(outcome.endingChoice&&dag.ending&&!dag.ending.confirmed)dag.ending={...dag.ending,chosen:outcome.endingChoice};
 for(const j of outcome.judgements){
  const inst=allowed.get(j.id);if(!inst)continue;
  verdicts[j.id]={outcome:j.outcome,...(j.detail?{detail:j.detail}:{}),...(j.requirements?{requirements:true}:{})};
  const parts=inst.node==='narrativeVerdict'?{endingChoice:fingerprint(endingChoice(dag.ending)??null)}:undefined;
  record(dag,inst,[j.outcome,j.detail??''],{outcome:j.outcome,...(parts?{parts}:{})});
 }
 dag.verdicts=verdicts;
 // 问题按结论归属：画幅问题归本幅逐幅结论；本幅不在本次范围时归本次失败的验收条目；结语与重排问题归叙事结论。
 const targetOf=(issue:ReviewIssue):string|undefined=>{
  if(issue.page===0||issue.requiresReplan)return allowed.has('narrativeVerdict:')?'narrativeVerdict:':failedItems[0];
  const id=dag.order[issue.page-1],own=id&&`frameVerdict:${id}`;
  return own&&allowed.has(own)?own:failedItems[0];
 };
 const kept=(dag.issues??[]).filter(i=>!allowed.has(i.target));
 const fresh=outcome.issues.flatMap(issue=>{const target=targetOf(issue);return target&&verdicts[target]?.outcome==='fail'?[{...issue,target}]:[];});
 dag.issues=[...kept,...fresh];
 const state=stateOf({...story,dag});
 const suggestions:Suggestion[]=outcome.suggestions.map(s=>({target:s.id,targetHash:state.products[s.id]?.hash,detail:s.detail??''}));
 dag.suggestions=[...liveSuggestions(state,dag.suggestions??[]),...suggestions];
 const passed=outcome.judgements.filter(j=>j.outcome==='pass'&&allowed.has(j.id)).map(j=>j.id);
 for(const {id,checks} of acknowledgedChecks(state,passed))dag.products[id]={...dag.products[id],checks};
}

/** 结构修订：按幅号替换段落；替换段的第一幅沿用原身份并重写，其余新身份。手改画幅会被改写时不提交。 */
function applyStructureRepair(story:DagStory,dag:DagDocument,item:Work,edits:{from:number;to:number;scenes:Scene[]}[],newId:()=>string):DagDocument|null{
 const old=dag.order,next:string[]=[],rewritten:string[]=[],deleted:string[]=[],created:string[]=[];
 const content=new Map<string,Scene>();
 let cursor=1;
 const sorted=[...edits].sort((a,b)=>a.from-b.from);
 for(const edit of sorted){
  while(cursor<edit.from&&cursor<=old.length)next.push(old[cursor++-1]);
  const range=old.slice(edit.from-1,Math.max(edit.from-1,edit.to));
  edit.scenes.forEach((scene,i)=>{
   const id=i===0&&range[0]?range[0]:newId();
   if(i===0&&range[0])rewritten.push(id);else created.push(id);
   content.set(id,scene);next.push(id);
  });
  for(const id of range.slice(edit.scenes.length?1:0))deleted.push(id);
  cursor=Math.max(cursor,edit.to+1);
 }
 while(cursor<=old.length)next.push(old[cursor++-1]);
 if(!next.length)return null;
 if(structuralLoss(stateOf(story),{deleted,rewritten}).length)return null;
 if(!created.length&&!deleted.length&&rewritten.every(id=>{
  const before=dag.frames[id],after=content.get(id)!;
  return before.scene===after.caption&&fingerprint(before.people??[])===fingerprint(after.people);
 }))return null;
 // 自动幅数的结构修订要重新核对叙事空间，幅数不变的重分配也一样。
 if(story.selection.length==='auto')delete dag.products['frameCheck:'];
 dag.order=next;
 for(const id of deleted){delete dag.frames[id];for(const node of [...frameNodes,...verdictNodes])delete dag.products[instanceId(node,id)];}
 const state=stateOf({...story,dag});
 for(const [id,scene] of content){
  const f=frame(dag,id);f.scene=scene.caption;f.people=scene.people;f.visual='';delete f.drawn;delete f.drawnNames;delete f.redrawNote;cast(dag,f);
  delete dag.products[instanceId('visual',id)];delete dag.products[instanceId('redrawNote',id)];
  const inst=evaluate(state).instance('scene',id);
  record(dag,{id:inst.id,hard:inst.hard,check:inst.check},scene.caption);
 }
 spendRepair(dag,item);
 dag.issues=(dag.issues??[]).filter(i=>!i.requiresReplan&&i.target!=='frameCheck:');
 return dag;
}

/** 放行幅数审核时沿用旧版的一次性绘图授权，绑定当前分镜和结语的输入。 */
export function overrideReview(story:DagStory,targets:string[]):DagDocument|null{
 const dag=clone(story.dag);
 for(const target of targets)if(dag.products[target])dag.products[target]={...dag.products[target],overridden:true};
 if(!targets.includes('frameCheck:'))return dag;
 const state=stateOf({...story,dag});
 for(const {node,key} of evaluate(state).all().filter(instance=>verdictNodes.some(node=>node===instance.node))){
  const instance=evaluate(state).instance(node,key);
  if(instance.status==='valid')continue;
  if(!instance.hard||!instance.check)return null;
  const parts=node==='narrativeVerdict'?{endingChoice:fingerprint(endingChoice(dag.ending)??null)}:undefined;
  record(dag,instance,[instance.id,'override'],{outcome:'fail',overridden:true,...(parts?{parts}:{})});
 }
 return dag;
}

/** 本次工作的阶段标记（审片第一或第二阶段），用于任务身份与界面。 */
export function stageOf(story:DagStory,inst:Instance){return reviewStage(stateOf(story),inst);}

/** 整篇完成。 */
export function finished(story:DagStory){return complete(stateOf(story));}
