// Merge reading positions by time; server snapshots separately own persisted favorite flags.
import type {Story} from './content';
import type {ShelfStory} from './reader-shelf.ts';

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
function recentCards<T extends {id:string}>(stories:T[],lastReadId:string,progress:ReadingProgress[],limit:number,preview:(story:T,page:number)=>{page:number;image:string}){
 const rows=mergeReadingProgress(progress),byId=new Map(stories.map(story=>[story.id,story]));
 if(lastReadId&&!rows.some(row=>row.storyId===lastReadId))rows.unshift({storyId:lastReadId,page:0});
 return rows.flatMap(row=>{
  const story=byId.get(row.storyId);if(!story)return [];
  const {page,image}=preview(story,row.page);
  return image?[{story,page,recent:true,image}]:[];
 }).slice(0,Math.max(0,limit));
}
export function recentHeroes(stories:Story[],lastReadId:string,progress:ReadingProgress[],limit=10){
 return recentCards(stories,lastReadId,progress,limit,(story,index)=>{
  const page=Math.max(0,Math.min(index,story.pages.length-1));
  return {page,image:story.pages[page]?.image||story.pages.find(frame=>frame.image)?.image||''};
 });
}
export function recentShelfHeroes(stories:ShelfStory[],lastReadId:string,progress:ReadingProgress[],limit=10){
 return recentCards(stories,lastReadId,progress,limit,(story,index)=>{
  const page=Math.max(0,Math.min(index,story.frameCount-1));
  return {page,image:page===story.resumePage?story.resumeImage:story.cover||story.resumeImage};
 });
}
// Kept for callers expecting one card.
export function recentHero(stories:Story[],lastReadId:string,progress:ReadingProgress[]){
 const ordered=lastReadId?[...progress.filter(row=>row.storyId===lastReadId),...progress.filter(row=>row.storyId!==lastReadId)]:progress;
 return recentHeroes(stories,lastReadId,ordered,1)[0]||null;
}
