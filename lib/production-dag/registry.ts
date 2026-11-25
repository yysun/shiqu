// 制作 DAG 的声明式配置：节点目录与调用契约逐行对应 .docs/story-production-dag.md。
// 引擎只读本文件推导有效性、就绪与任务身份；新增或修改节点只改这里，并同步规范表格。
// specRow 与规范表格首列精确对应，一行可对应多项；没有表格行的派生节点标为 null。
// 逐幅调用按 batch 合批以减少调用数；同批其他实例只作来源（@batch），不参与有效性。
import {readerStoryboardBatchSize} from '../reader-limits.ts';

/** 文字逐幅工作与分镜合批共用每批上限。 */
const frameBatch=readerStoryboardBatchSize;

/** 产物粒度：story 每版一份；frame 按画幅身份。 */
export type Granularity='story'|'frame';

/**
 * 输入引用。`节点` 读同一版本的故事级产物；`节点@self` 读同一画幅；
 * `@window` 读本幅与相邻两幅；`@all` 按顺序读全部画幅；`characters@drawn` 只读本幅入画人物；
 * `order` 是画幅身份序列；`reference` 是本幅实际参考图。
 */
export type InputRef=string;

/** 执行门槛：制作确认后可按任务要求等待梗概、人物设定、幅数核对或审片。 */
export type Gate='preparing'|'confirmed'|'brief'|'characters'|'review'|'approved';

export type NodeSpec={
 label:string;
 specRow:string|null;
 per:Granularity;
 /** 读者输入、确认快照或派生值，不由模型调用产生。 */
 kind:'root'|'model'|'derived'|'annotation';
 hard:InputRef[];
 check?:InputRef[];
 /** 产生本节点的调用，对应 calls 的键；测试核对两者互相引用一致。 */
 call?:string;
 gate?:Gate;
 required:boolean;
 editable?:boolean;
 /** 失效后重做也须等核对输入就绪，例如画幅图片等新首幅完成后再以它为参考。 */
 rerunWaitsForCheck?:boolean;
};

export const nodes={
 selection:{label:'选定范围与出处版次',specRow:null,per:'story',kind:'root',hard:[],required:true},
 seed:{label:'改编重点',specRow:null,per:'story',kind:'root',hard:[],required:false},
 source:{label:'已核原文与出处',specRow:'已核原文与出处',per:'story',kind:'model',hard:['selection'],call:'verifySource',required:true},
 brief:{label:'事实梗概',specRow:'事实梗概',per:'story',kind:'model',hard:['source','productionReq'],call:'prepareBrief',required:true,editable:true},
 suggestions:{label:'两项要求建议、幅数与画风建议',specRow:'两项要求建议、幅数与画风建议',per:'story',kind:'model',hard:['source','seed'],call:'prepareSuggestions',gate:'preparing',required:false},
 productionReq:{label:'制作要求',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 acceptanceReq:{label:'验收要求',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 settings:{label:'叙事详略与幅数策略',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 style:{label:'画风',specRow:'制作要求、验收要求、叙事详略与幅数策略、画风',per:'story',kind:'root',hard:[],required:true,editable:true},
 modelSnapshot:{label:'图片快照',specRow:'图片快照',per:'story',kind:'root',hard:[],required:true},
 renderer:{label:'绘图参数',specRow:'绘图参数',per:'story',kind:'root',hard:[],required:true,editable:true},
 outline:{label:'全篇提纲',specRow:'全篇提纲',per:'story',kind:'model',hard:['source','productionReq','settings'],call:'outline',gate:'brief',required:true},
 characters:{label:'人物设定',specRow:'人物设定',per:'story',kind:'model',hard:['source','productionReq'],call:'characters',gate:'confirmed',required:true,editable:true},
 scene:{label:'叙事分镜',specRow:'叙事分镜',per:'frame',kind:'model',hard:['outline','source','productionReq'],call:'sceneBatch',gate:'brief',required:true,editable:true},
 visual:{label:'画面描述',specRow:'画面描述',per:'frame',kind:'model',hard:['outline','productionReq','style'],check:['scene@self'],call:'visual',gate:'characters',required:true,editable:true,rerunWaitsForCheck:true},
 ending:{label:'标题与结语候选',specRow:'标题与结语候选',per:'story',kind:'model',hard:['source','outline','order'],check:['scene@all'],call:'ending',gate:'confirmed',required:true,editable:true},
 frameCheck:{label:'幅数与结构核对',specRow:'幅数与结构核对',per:'story',kind:'model',hard:['source','outline','order','productionReq','settings','notes'],check:['scene@all'],call:'frameCheck',gate:'confirmed',required:true},
 notes:{label:'审核意见',specRow:'审核意见',per:'story',kind:'root',hard:[],required:false,editable:true},
 frameVerdict:{label:'逐幅审片结论',specRow:'逐幅审片结论',per:'frame',kind:'model',hard:['source','productionReq','style','notes','scene@window','visual@window','characters@drawn'],call:'review',gate:'review',required:true},
 endingConfirmed:{label:'读者确认的标题与结语',specRow:null,per:'story',kind:'root',hard:[],required:false,editable:true},
 narrativeVerdict:{label:'全篇审片结论',specRow:'全篇审片结论',per:'story',kind:'model',hard:['source','brief','productionReq','acceptanceReq','outline','order','ending','endingConfirmed','notes','scene@all','visual@all','style','frameCheck'],call:'review',gate:'review',required:true},
 override:{label:'明确放行',specRow:'明确放行',per:'story',kind:'annotation',hard:[],required:false},
 redrawNote:{label:'重绘说明',specRow:'重绘说明',per:'frame',kind:'root',hard:[],required:false,editable:true},
 refSource:{label:'书籍参考图或旧版画面',specRow:null,per:'story',kind:'root',hard:[],required:false},
 reference:{label:'参考图',specRow:'参考图',per:'frame',kind:'derived',hard:[],required:false},
 frameImage:{label:'画幅图片',specRow:'画幅图片',per:'frame',kind:'model',hard:['visual@self','characters@drawn','style','renderer','redrawNote@self'],check:['reference'],call:'draw',gate:'approved',required:true,rerunWaitsForCheck:true},
 complete:{label:'完整作品',specRow:'完整作品',per:'story',kind:'derived',hard:[],required:false},
} satisfies Record<string,NodeSpec>;

export type NodeId=keyof typeof nodes;
export const nodeSpec=(id:string):NodeSpec=>{
 const spec=(nodes as Record<string,NodeSpec>)[id];
 if(!spec)throw Error(`UNKNOWN_DAG_NODE: ${id}`);
 return spec;
};

export type CallSpec={
 label:string;
 specRow:string;
 produces:string[];
 bound:InputRef[];
 check?:InputRef[];
 sources?:string[];
 context?:string[];
 /**
  * 同一次调用最多处理的实例数，例如逐幅调用每批 20 幅；all 表示每轮一次审片。
  * 未设置的调用每个实例单独调用（故事级产物每版只有一个实例；绘图每次一幅）。
  */
 batch?:number|'all';
};

export const calls={
 search:{label:'查找候选',specRow:'查找候选',produces:[],bound:['query'],sources:['savedCandidates']},
 verifySource:{label:'原文核对',specRow:'原文核对',produces:['source'],bound:['selection']},
 prepareBrief:{label:'准备梗概',specRow:'准备梗概',produces:['brief'],bound:['source','productionReq']},
 prepareArt:{label:'准备候选画风',specRow:'准备候选画风',produces:['suggestions'],bound:['source','seed']},
 prepareSuggestions:{label:'准备建议',specRow:'准备建议',produces:['suggestions'],bound:['source','seed']},
 characters:{label:'人物设定',specRow:'人物设定',produces:['characters'],bound:['source','productionReq']},
 outline:{label:'编排提纲',specRow:'编排提纲',produces:['outline'],bound:['source','productionReq','settings']},
 storyboard:{label:'编排文字分镜批次',specRow:'编排文字分镜批次',produces:['outline','characters','scene','visual'],bound:['source','productionReq','settings','style'],sources:['outline','characters','scene@batchDone'],batch:frameBatch},
 sceneBatch:{label:'编排叙事分镜批次',specRow:'编排叙事分镜批次',produces:['scene'],bound:['outline','source','productionReq'],sources:['scene@batchDone'],batch:frameBatch},
 visual:{label:'生成画面描述',specRow:'生成画面描述',produces:['visual'],bound:['outline','productionReq','style'],check:['scene@self'],sources:['scene@batch','characters'],batch:frameBatch},
 restyle:{label:'换画风转换',specRow:'换画风转换',produces:['visual'],bound:['outline','productionReq','style'],check:['scene@self'],sources:['visual@previous','style@previous','scene@batch','characters'],batch:frameBatch},
 sceneRepair:{label:'叙事修订',specRow:'叙事修订',produces:['scene'],bound:['outline','source','productionReq'],sources:['scene@self','scene@neighbors','issues','notes','scene@batch'],batch:frameBatch},
 sceneReset:{label:'重新生成配文',specRow:'重新生成配文',produces:['scene'],bound:['outline','source','productionReq'],sources:['scene@self','scene@neighbors','issues','notes'],batch:frameBatch},
 visualRepair:{label:'画面修订',specRow:'画面修订',produces:['visual'],bound:['outline','productionReq','style'],check:['scene@self'],sources:['visual@self','characters@drawn','issues','notes','scene@batch','characters'],batch:frameBatch},
 structureRepair:{label:'结构修订',specRow:'结构修订',produces:['scene'],bound:['outline','source','productionReq','settings'],sources:['scene@all','issues','notes','frameCheck']},
 ending:{label:'拟定标题与结语',specRow:'拟定标题与结语',produces:['ending'],bound:['source','outline','order'],check:['scene@all']},
 endingRepair:{label:'结语修订',specRow:'结语修订',produces:['ending'],bound:['source','outline','order'],check:['scene@all'],sources:['ending','endingChoice','issues','notes']},
 frameCheck:{label:'幅数与结构核对',specRow:'幅数与结构核对',produces:['frameCheck'],bound:['source','outline','order','productionReq','settings','notes'],check:['scene@all']},
 review:{label:'审片（批量）',specRow:'审片（批量）',produces:['frameVerdict','narrativeVerdict'],bound:['verdict@inputs'],context:['scene@all','visual@all','verdict@valid'],batch:'all'},
 draw:{label:'绘图',specRow:'绘图',produces:['frameImage'],bound:['visual@self','characters@drawn','style','renderer','redrawNote@self'],check:['reference']},
 drawLandscape:{label:'横图绘制',specRow:'横图绘制',produces:[],bound:['frameImage@self','visual@self','characters@drawn','style','renderer']},
} satisfies Record<string,CallSpec>;

export type CallId=keyof typeof calls;
