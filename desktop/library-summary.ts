// Classify only the latest visible generated records returned by the existing desktop summary.
import type {ProductionCheckpoint} from '../lib/production-stages';

export type StorySummary={id:string;title:string;book:string;theme:string;artStyle:string;state:string;saved:number;page:number;ready:number;total:number;updatedAt:string;jobs:number;queued:number;running:number;failed:number;succeeded:number;production?:ProductionCheckpoint};
export type LibrarySummary={stories:StorySummary[]};
export type ServiceState='loading'|'unavailable'|'stopped'|'running'|'preview';
export function overviewStoryState(story:StorySummary):{kind:'completed'|'active'|'attention';label:string}{
 if(story.failed>0||story.state==='failed')return {kind:'attention',label:'需要重试'};
 if(story.production?.intakePhase==='choosing')return {kind:'attention',label:'待选故事'};
 if(story.production?.intakePhase==='confirming')return {kind:'attention',label:'待制作确认'};
 if(story.production?.phase==='frame-count'&&!story.production.frameCountConfirmed)return {kind:'attention',label:'待确认画幅'};
 if(story.running>0||story.queued>0||story.state==='running')return {kind:'active',label:story.running>0||story.state==='running'?'正在生成':'等待生成'};
 if(story.state==='completed')return {kind:'completed',label:'已完成'};
 return {kind:'attention',label:'待继续'};
}
export function overviewSummary(stories:StorySummary[]){
 const counts={completed:0,active:0,attention:0,saved:0};
 for(const story of stories){counts[overviewStoryState(story).kind]++;if(story.saved)counts.saved++;}
 return {...counts,recent:stories.slice(0,4),actionable:stories.filter(story=>overviewStoryState(story).kind==='attention').sort((a,b)=>Number(b.failed>0||b.state==='failed')-Number(a.failed>0||a.state==='failed')).slice(0,3)};
}
