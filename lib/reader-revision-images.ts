// Decide which saved artwork a revision can reuse. Free of schema imports so that views can report it.
import {sameArtDirection} from './reader-styles.ts';
import type {Plan,Selection} from './reader-model.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
export type RevisionBase={selection:Selection;plan:Plan|null;images:string[];frameRecommendation?:FrameRecommendation;savedFrameCount?:number};
export type RevisionRedraw={previewed:number;actual:number;reason:'first-lost'|'first-changed'|'lost'|'review'};
export function reusableRevisionImages(base:RevisionBase,selection:Selection,plan:Plan,sourcePages?:(number|null)[]){
 const previous=base.plan;if(!previous)return plan.pages.map(()=> '');
 const stable=sameArtDirection(base.selection,selection)&&base.selection.productionPrompt===selection.productionPrompt&&previous.characters===plan.characters;
 if(sourcePages&&(sourcePages.length!==plan.pages.length||sourcePages.some(index=>index!==null&&(!Number.isInteger(index)||index<0||index>=previous.pages.length))||new Set(sourcePages.filter(index=>index!==null)).size!==sourcePages.filter(index=>index!==null).length))throw Error('INVALID_IMAGE_SOURCE_MAP');
 const anchor=stable&&!!base.images[0]&&previous.pages[0]?.prompt===plan.pages[0]?.prompt&&(!sourcePages||sourcePages[0]===0);
 if(!anchor)return plan.pages.map(()=> '');
 const sameOrder=previous.pages.length===plan.pages.length&&previous.pages.every((page,i)=>page.prompt===plan.pages[i].prompt);
 const used=new Set<number>();
 return plan.pages.map((page,index)=>{
  let source=sourcePages?sourcePages[index]:index===0||sameOrder?index:null;
  if(!sourcePages&&source===null){
   const matches=previous.pages.flatMap((p,i)=>p.prompt===page.prompt?[i]:[]);
   if(matches.length===1&&plan.pages.filter(p=>p.prompt===page.prompt).length===1)source=matches[0];
  }
  if(source===null||used.has(source)||previous.pages[source]?.prompt!==page.prompt)return '';
  used.add(source);return base.images[source]||'';
 });
}
// Report redraws beyond the submitted preview. The first frame is every other frame's reference.
export function revisionRedraw(revision:{base:RevisionBase;previewedRedraw?:number;actualRedraw?:number;lostPages?:number[]},selection:Selection,plan:Plan,images?:string[]):RevisionRedraw|undefined{
 const previewed=revision.previewedRedraw;if(previewed===undefined)return undefined;
 const actual=revision.actualRedraw??(plan.pages.length-(images||reusableRevisionImages(revision.base,selection,plan)).slice(0,plan.pages.length).filter(Boolean).length);
 if(actual<=previewed)return undefined;
 const lost=revision.lostPages||[];
 return {previewed,actual,reason:lost.includes(0)?'first-lost':revision.base.plan?.pages[0]?.prompt!==plan.pages[0]?.prompt?'first-changed':lost.length?'lost':'review'};
}
