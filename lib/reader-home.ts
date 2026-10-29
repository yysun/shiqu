// Merge reading positions by time; server snapshots separately own persisted favorite flags.
import type {Story} from './content';
import {DEMO_STORY_ID} from './demo-dongguo.ts';

export type ReadingProgress={storyId:string;page:number;saved?:number;updatedAt?:string|null};
export function mergeReadingProgress(...groups:ReadingProgress[][]){
 const rows=new Map<string,ReadingProgress>();
 for(const group of groups)for(const row of group){const old=rows.get(row.storyId);if(!old||(Date.parse(row.updatedAt||'')||0)>(Date.parse(old.updatedAt||'')||0))rows.set(row.storyId,row);}
 return [...rows.values()].sort((a,b)=>(Date.parse(b.updatedAt||'')||0)-(Date.parse(a.updatedAt||'')||0));
}
export function reconcileReadingProgress(current:ReadingProgress[],authoritative:ReadingProgress[]){
 const favorites=new Map(authoritative.filter(row=>row.saved!==undefined).map(row=>[row.storyId,row.saved]));
 return mergeReadingProgress(current,authoritative).map(row=>favorites.has(row.storyId)?{...row,saved:favorites.get(row.storyId)}:row);
}
export function recentHeroes(stories:Story[],lastReadId:string,progress:ReadingProgress[],limit=10){
 const rows=mergeReadingProgress(progress);
 if(lastReadId&&!rows.some(row=>row.storyId===lastReadId))rows.unshift({storyId:lastReadId,page:0});
 const items=rows.flatMap(row=>{
  const story=stories.find(story=>story.id===row.storyId&&story.pages.some(page=>page.image));if(!story)return [];
  const page=Math.max(0,Math.min(row.page,story.pages.length-1));
  return [{story,page,recent:true,image:story.pages[page]?.image||story.pages.find(page=>page.image)?.image||''}];
 }).slice(0,Math.max(0,limit));
 if(items.length)return items;
 const sample=stories.find(story=>story.id===DEMO_STORY_ID&&story.pages.some(page=>page.image));
 return sample?[{story:sample,page:0,recent:false,image:sample.pages[0].image}]:[];
}
// Kept for callers expecting one card.
export function recentHero(stories:Story[],lastReadId:string,progress:ReadingProgress[]){
 const ordered=lastReadId?[...progress.filter(row=>row.storyId===lastReadId),...progress.filter(row=>row.storyId!==lastReadId)]:progress;
 return recentHeroes(stories,lastReadId,ordered,1)[0]||null;
}
