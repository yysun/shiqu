// 制作 DAG 执行层的替身：合法的生成结果、驱动 work → requestFor → apply 到没有工作，供执行层与请求测试共用。
import {settle,work,requestFor,apply} from '../../lib/production-dag/runner.ts';
import {emptyDag} from '../../lib/production-dag/document.ts';

export const original={title:'管晏列传',text:'管仲夷吾者，颍上人也。少时常与鲍叔牙游，鲍叔知其贤。',url:'https://example.test/guanyan',kind:'passage',provider:'local',retrievedAt:'2026-01-01'};
export const selection=(over={})=>({bookId:'shiji',theme:'友情',storyTitle:'管鲍之交',artStyle:'ink-pencil',productionPrompt:'写清选择与后果',acceptancePrompt:'',narrativeDetail:'balanced',length:12,...over});
let ids=0;
export const people=[{id:'c1',name:'管仲',aliases:['夷吾'],text:'齐国人，青年时清贫。'},{id:'c2',name:'鲍叔牙',aliases:['鲍叔'],text:'管仲好友，宽厚。'}];

export function story(over={}){
 ids=0;
 return {id:'s1',doc:{plan:null,images:[],audio:[],usage:[],original},selection:selection(over),dag:emptyDag(),confirmed:true,faults:[],refSource:'/api/reader/media/book/ref.png'};
}

/** 替身生成器：按方法返回合法结果；review 可按 verdict 身份给出失败。 */
export function replies({fail=()=>null,frameCheck=()=>'keep',repairSame=false}={}){
 return (method,args)=>{
  switch(method){
   case 'prepareBrief':return '管仲与鲍叔牙少时相知。';
   case 'characters':return people;
   case 'outline':return {title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:Array.from({length:typeof args.settings.length==='number'?args.settings.length:12},(_,i)=>`节点${i+1}`)};
   case 'storyboard':{
    // 合批分镜：首批同时给出提纲和缺少的人物设定，各批给出本批配文与画面描述。
    const outline=args.outline?undefined:{title:'管鲍之交',summary:'梗概',sourceReference:'史记',adaptationNote:'按原文',beats:Array.from({length:typeof args.settings.length==='number'?args.settings.length:12},(_,i)=>`节点${i+1}`)};
    const count=outline?Math.min(args.count,outline.beats.length):args.count;
    return {...(outline?{outline}:{}),...(args.characters===undefined?{characters:people}:{}),
     pages:Array.from({length:count},(_,i)=>({caption:`第${args.first+i}幅：管仲与鲍叔牙同行的配文。`,prompt:`第${args.first+i}幅画面：两位少年并肩走在乡间小路上，中景，${args.style.artStyle}。`,drawn:['管仲']}))};
   }
   case 'sceneBatch':return Array.from({length:args.count},(_,i)=>({caption:`第${args.first+i}幅：管仲与鲍叔牙同行的配文。`}));
   case 'sceneRepair':return args.frames.map(f=>({caption:repairSame?f.caption:`修订后的第${f.index+1}幅配文。`}));
   case 'visual':case 'restyle':return args.frames.map(f=>({prompt:`第${f.index+1}幅画面：两位少年并肩走在乡间小路上，中景，${args.style.artStyle}。`,drawn:['管仲']}));
   case 'visualRepair':return args.frames.map(f=>({prompt:repairSame?f.prompt:`修订后的第${f.index+1}幅画面：管仲独坐灯下，中景，暖光。`,drawn:['管仲']}));
   case 'ending':return {title:'管鲍之交',candidates:['知己难得。','知人善任。','贫富不移。']};
   case 'endingRepair':return '知己之交，贵在相知。';
   case 'frameCheck':{
    const decision=frameCheck(args.captions.length);
    return decision==='keep'?{frameCountReview:{decision,proposedCount:args.captions.length,reason:'合适'},requirements:[],issues:[],coverage:[]}
     :{frameCountReview:{decision,proposedCount:args.captions.length+1,reason:'缺一段'},requirements:[{page:2}],issues:[{page:2,category:'progression',problem:'缺少分金一段',instruction:'在第 2 幅后补一幅分金',requiresReplan:true}],coverage:[]};
   }
   case 'structureRepair':return [{from:3,to:2,scenes:[{caption:'新增的分金一幅配文。'}]}];
   case 'review':{
    const judgements=[],issues=[],storyIssues=[];
    for(const page of args.allowed.pages){
     const id=`frameVerdict:${args.frames[page-1].id}`,failure=fail(id);
     judgements.push({id,outcome:failure?'fail':'pass',...(failure?{detail:failure.problem}:{})});
     if(failure)(failure.requiresReplan?storyIssues:issues).push({page,...failure});
    }
    if(args.allowed.narrative)judgements.push({id:'narrativeVerdict:',outcome:storyIssues.length?'fail':'pass'});
    return {judgements,...(args.allowed.narrative&&!args.confirmedEnding?{endingChoice:args.candidates[0]}:{}),issues,storyIssues};
   }
   default:throw Error('unexpected '+method);
  }
 };
}

export const newId=()=>`n${++ids}`;
/** 驱动到没有工作；返回每次调用的记录。draw 与 drawLandscape 返回按画幅与轮次区分的图片地址。 */
export function drive(s,reply,{max=80,between}={}){
 const log=[];
 for(let round=0;round<max;round++){
  s.dag=settle(s);
  const items=work(s);
  if(!items.length)return log;
  for(const item of items){
   const value=item.call==='draw'?`/api/reader/media/${s.id}/${s.dag.order.indexOf(item.instances[0].key)}.png`:(()=>{const {method,args}=requestFor(s,item);return reply(method,args,item);})();
   between?.(s,item);
   const next=apply(s,item,value,{newId});
   log.push({call:item.call,ids:item.instances.map(i=>i.key),applied:!!next});
   if(next)s.dag=next;
  }
 }
 throw Error('runner did not settle');
}
export const calls=(log,name)=>log.filter(l=>l.call===name&&l.applied).length;

