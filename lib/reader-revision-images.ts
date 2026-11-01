// Decide which saved artwork a revision can reuse. Free of schema imports so that views can report it.
import type {Plan,Selection} from './reader-model.ts';
import type {FrameRecommendation} from './reader-frame-recommendation.ts';
export type RevisionBase={selection:Selection;plan:Plan|null;images:string[];frameRecommendation?:FrameRecommendation;savedFrameCount?:number};
export type RevisionRedraw={previewed:number;actual:number;reason:'first-lost'|'first-changed'|'lost'|'review'};
export function reusableRevisionImages(base:RevisionBase,selection:Selection,plan:Plan){
 const previous=base.plan;if(!previous)return plan.pages.map(()=> '');
 const stable=base.selection.artStyle===selection.artStyle&&base.selection.productionPrompt===selection.productionPrompt&&previous.characters===plan.characters;
 const anchor=stable&&!!base.images[0]&&previous.pages[0]?.prompt===plan.pages[0]?.prompt;
 return plan.pages.map((page,index)=>anchor&&previous.pages[index]?.prompt===page.prompt?base.images[index]||'':'');
}
// Report redraws beyond the submitted preview. The first frame is every other frame's reference.
export function revisionRedraw(revision:{base:RevisionBase;previewedRedraw?:number;lostPages?:number[]},selection:Selection,plan:Plan):RevisionRedraw|undefined{
 const previewed=revision.previewedRedraw;if(previewed===undefined)return undefined;
 const actual=plan.pages.length-reusableRevisionImages(revision.base,selection,plan).filter(Boolean).length;
 if(actual<=previewed)return undefined;
 const lost=revision.lostPages||[];
 return {previewed,actual,reason:lost.includes(0)?'first-lost':revision.base.plan?.pages[0]?.prompt!==plan.pages[0]?.prompt?'first-changed':lost.length?'lost':'review'};
}
