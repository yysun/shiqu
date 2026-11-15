// Sum recorded execution intervals per checkpoint, merging overlaps from parallel image jobs.
// Missing historical timestamps remain unknown; queueing and pause gaps never become work time.
import type {Selection} from './reader-model.ts';

export function productionTimingScope(selection:Selection,search=false){
 const {bookId,customBook,discoverySources,theme,discovery,storyTitle,source}=selection;
 return JSON.stringify(search?{bookId,customBook,discoverySources,theme,discovery}:{bookId,customBook,storyTitle,source});
}

export function productionStageDurations(jobs:{payload:string;kind:string}[],selection:Selection){
 const intervals:Record<string,[number,number][]>={};
 for(const job of jobs){
  const payload=JSON.parse(job.payload) as {stepKey?:string;timingStage?:string;timingScope?:string;timings?:{startedAt:number;finishedAt:number}[]};
  // 旧版把画风转换记在分镜下，读取时把这段耗时归入绘图。
  const stage=job.kind==='script'&&payload.stepKey?.startsWith('restyle:')?'image':payload.timingStage;
  if(!stage||!['source','count','plan','review','repair','recheck','image'].includes(stage)||payload.timingScope!==productionTimingScope(selection,job.kind==='discover')||!Array.isArray(payload.timings))continue;
  for(const timing of payload.timings){
   if(!timing||!Number.isFinite(timing.startedAt)||!Number.isFinite(timing.finishedAt)||timing.finishedAt<timing.startedAt)continue;
   (intervals[stage]||=[]).push([timing.startedAt,timing.finishedAt]);
  }
 }
 return Object.fromEntries(Object.entries(intervals).map(([stage,ranges])=>{
  ranges.sort((a,b)=>a[0]-b[0]);
  let total=0,[start,end]=ranges[0];
  for(const [nextStart,nextEnd] of ranges.slice(1)){
   if(nextStart<=end)end=Math.max(end,nextEnd);
   else{total+=end-start;start=nextStart;end=nextEnd;}
  }
  return [stage,Math.floor((total+end-start)/1000)];
 }));
}
