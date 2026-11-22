// 提供方生成接口（StoryGenerator）与调用结果类型。准备与确认之后的全部制作由制作 DAG（lib/production-dag、server/dag-production.ts）调度；
// 已移除逐页推进的 advanceStory。
import type {Plan,Selection} from './reader-model.ts';
import type {ArtStyleId} from './reader-styles.ts';
import type {ImageLayout} from './reader-image-dimensions.ts';
import type {OriginalSource,SourceResult,SourceHint} from './reader-source-types.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
import type {ArtRecommendation} from './reader-art-recommendation.ts';
import type {PromptRecord} from './reader-prompt-records.ts';
export type Generated<T>={promptRecord?:PromptRecord;value:T;model:string;requestId:string|null;usage:unknown;reasoningEffort?:string};
export interface StoryGenerator{/** 提供方的通用文字调用；制作 DAG 按调用契约经它发出请求。 */textCall?:(task:import('./reader-reasoning.ts').ReasoningTask,instructions:string,payload:unknown,schema:unknown,maxOutputTokens:number,original?:OriginalSource)=>Promise<Generated<unknown>>;/** 核对保存的原文仍属于所选出处；不符时抛出。 */verifyOriginal?(selection:Selection,original:OriginalSource|undefined):void;summarizeStoryboard?(pages:Plan['pages']):Promise<Generated<string>>;recommendArt?(selection:Selection,original:OriginalSource):Promise<ArtRecommendation>;prepareOriginal?(selection:Selection,id:string):Promise<OriginalSource|null>;recommend?(selection:Selection,id:string,original:OriginalSource,prepareRequirements?:boolean):Promise<Generated<FrameRecommendation>>;original(selection:Selection,plan:SourceHint,id:string):Promise<SourceResult>;image(plan:Plan,page:number,id:string,reference:string,style?:ArtStyleId,productionPrompt?:string,artifactId?:string,layout?:ImageLayout,artStylePrompt?:string|null,promptOverride?:string):Promise<Generated<string>>;audio(caption:string,id:string,page:number):Promise<Generated<string>>;safeError(error:unknown):string;}
