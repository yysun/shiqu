// 制作 DAG 引擎测试的替身生成器：反复取可运行实例、按调用分组产出产物，并记录调用次数。
// 只模拟模型产出，执行门槛、失效与复用全部来自正式引擎，测试据此按规范场景编号断言。
import {evaluate,instanceId} from '../../lib/production-dag/engine.ts';
import {callGroups} from '../../lib/production-dag/schedule.ts';
import {fingerprint} from '../../lib/production-dag/fingerprint.ts';
import {acknowledgedChecks} from '../../lib/production-dag/review.ts';

let counter=0;
export const root=(value,parts)=>({hash:fingerprint(value),inputs:{},...(parts?{parts}:{})});

/** 一篇已确认、尚未生成任何模型产物的故事。 */
export function story({frames=8,items=[],cast={}}={}){
 const order=Array.from({length:frames},(_,i)=>`f${i+1}`);
 const itemParts=Object.fromEntries(items.map(i=>[i.id,fingerprint(i.text||i.id)]));
 return {
  confirmed:true,order,items:items.map(i=>i.id),
  frames:Object.fromEntries(order.map(id=>[id,{candidates:cast[id]||['c1'],drawn:cast[id]||['c1']}])),
  products:{
   'selection:':root('管鲍之交'),'productionReq:':root('写清选择与后果'),'acceptanceReq:':root(items.map(i=>i.text),itemParts),
   'settings:':root('balanced'),'style:':root('ink'),'modelSnapshot:':root('m1'),'renderer:':root('9:16'),'refSource:':root(null),
  },
  faults:[],
 };
}

/**
 * 运行到没有可运行实例。options.review(id) 返回 'pass'|'fail'；options.register(key) 返回登记；
 * options.ending() 返回叙事结论选定的结语。
 * 返回每次调用的记录 {call,ids}；分组与批量上限来自正式调度分组 callGroups。
 */
export function run(state,options={}){
 const log=[];
 for(let round=0;round<200;round++){
  const groups=callGroups(state);
  if(!groups.length)return log;
  for(const {call,stage,instances} of groups){
   const name=stage?`${call}#${stage}`:call;
   log.push({call:name,ids:instances.map(x=>x.id)});
   for(const inst of instances)state.products[inst.id]=produce(state,inst,options);
   if(stage){
    const passed=instances.map(x=>x.id).filter(id=>state.products[id].outcome==='pass');
    for(const {id,checks} of acknowledgedChecks(state,passed))state.products[id]={...state.products[id],checks};
   }
  }
 }
 throw Error('DAG_SIMULATION_DID_NOT_SETTLE');
}

function produce(state,inst,options){
 const previous=state.products[inst.id];
 const product={hash:fingerprint([inst.id,++counter]),inputs:inst.hard,checks:inst.check};
 if(inst.node==='characters')product.parts={c1:fingerprint('c1'),c2:fingerprint('c2'),c3:fingerprint('c3')};
 if(inst.node==='frameCheck')product.outcome='pass';
 if(['frameVerdict','narrativeVerdict','itemVerdict'].includes(inst.node))product.outcome=options.review?.(inst.id)??'pass';
 if(inst.node==='narrativeVerdict')product.parts={endingChoice:fingerprint(options.ending?.()??'结语一')};
 if(inst.node==='itemRegistration')Object.assign(product,options.register?.(inst.key)??{scope:'story',evidence:['scenes']});
 if(previous?.handEdited&&options.keepHandEdits)product.handEdited=true;
 return product;
}

/** 读者手改：新内容、按当前输入保存，并标为手改。 */
export function handEdit(state,node,key){
 const inst=evaluate(state).instance(node,key);
 state.products[instanceId(node,key)]={hash:fingerprint([node,key,'手改',++counter]),inputs:inst.hard,checks:inst.check,handEdited:true};
}

/** 指定重绘：同样输入下产生新内容。 */
export function redraw(state,key){
 const inst=evaluate(state).instance('frameImage',key);
 state.products[instanceId('frameImage',key)]={hash:fingerprint(['image',key,++counter]),inputs:inst.hard,checks:inst.check};
}

export const count=(log,call)=>log.filter(l=>l.call===call||l.call.startsWith(call+'#')).length;
/** 某调用产出的实例总数（批量调用一次可产出多幅）。 */
export const produced=(log,call)=>log.filter(l=>l.call===call||l.call.startsWith(call+'#')).reduce((n,l)=>n+l.ids.length,0);
export const clone=state=>structuredClone(state);
