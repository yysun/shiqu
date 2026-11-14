// Persist stable reading boundaries and token counts, sharing original text across themes.
// Manifests contain references only; hydration verifies exhaustive, ordered unit coverage.
// Explicit chapter selections use the full request budget to preserve their shared main event.
import {z} from 'zod';
import {localRangeSchema,localScanJson,localCardsJson,localReadingPrompt,legacyLocalScanJson,legacyLocalReadingPrompt} from '../lib/reader-local-contract.ts';
import type {WholeBookInput} from '../lib/reader-local-contract.ts';
import type {LocalBook,LocalSection,LocalUnit} from './local-books.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import {readingTokens,requestTokens,wholeInputTokens,chapterInputTokens} from './story-token-budget.ts';
type Row={section:LocalSection;unit:LocalUnit};
const blockSchema=z.object({ranges:z.array(localRangeSchema).min(1),tokens:z.number().int().min(1)});
export const manifestSchema=z.object({mode:z.enum(['whole','chapters']),blocks:z.array(blockSchema).min(1)});
export type ReadingManifest=z.infer<typeof manifestSchema>;
export type ReadingBlock={text:string;visible:Set<string>;chars:number;chapters:string[]};
export type ReadingLimits={whole:number;chapter:number};
export const defaultReadingLimits={whole:wholeInputTokens,chapter:chapterInputTokens};
export const legacyReadingLimits={whole:400000,chapter:50000};
function render(rows:Row[]){let previous='';return rows.map(({section,unit})=>{const heading=previous!==section.id?`篇章 ${section.id}：${section.title}\n`:section.sourceBreaks?.has(unit.id)?'【另一个已选原文段落】\n':'';previous=section.id;return heading+`[${unit.id}]\n${unit.text}`;}).join('\n\n');}
function ranges(rows:Row[]){const result:z.infer<typeof localRangeSchema>[]=[];for(const {section,unit} of rows){const last=result.at(-1);if(last?.sectionId===section.id&&!section.sourceBreaks?.has(unit.id))last.lastUnit=unit.id;else result.push({sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id});}return result;}
export function hydrateReadingPlan(book:LocalBook,manifest:ReadingManifest):ReadingBlock[]{
 const expected=book.sections.flatMap(s=>s.units.map(u=>u.id)),seen:string[]=[];
 const blocks=manifest.blocks.map(block=>{
  const rows:Row[]=[];
  for(const range of block.ranges){const section=book.sections.find(s=>s.id===range.sectionId);if(!section)throw Error('Unknown reading chapter');const first=section.units.findIndex(u=>u.id===range.firstUnit),last=section.units.findIndex(u=>u.id===range.lastUnit);if(first<0||last<first)throw Error('Invalid reading boundary');rows.push(...section.units.slice(first,last+1).map(unit=>({section,unit})));}
  const ids=rows.map(r=>r.unit.id);seen.push(...ids);
  return {text:manifest.mode==='whole'?book.input.text:render(rows),visible:new Set(ids),chars:rows.reduce((n,r)=>n+Array.from(r.unit.text.replace(/\s/gu,'')).length,0),chapters:[...new Set(rows.map(r=>r.section.title))]};
 });
 if(JSON.stringify(seen)!==JSON.stringify(expected)||manifest.mode==='whole'&&blocks.length!==1)throw Error('Reading manifest does not cover original');
 return blocks;
}
type ReadingPurpose='scan'|'catalog'|'cards';
function planningInput(book:LocalBook,purpose:ReadingPurpose,selectedChapters:boolean,targetStoryTitle?:string):WholeBookInput{
 if(purpose==='cards')return {...book.input,purpose:'cards'};
 return {...book.input,purpose:selectedChapters||targetStoryTitle?'catalog':purpose,scan:{maxStories:selectedChapters||targetStoryTitle?1:5,excludedSources:[],pendingEvents:[],contextText:'',...(targetStoryTitle?{targetStoryTitle}:selectedChapters?{chapterStoryLevel:'main' as const}:{})}};
}
export function buildReadingPlan(book:LocalBook,provider:string,limits=defaultReadingLimits,selectedChapters=false,targetStoryTitle?:string,purpose:ReadingPurpose='scan'):ReadingManifest{
 const input=planningInput(book,purpose,selectedChapters,targetStoryTitle),theme=purpose==='cards'?'原典故事':'题'.repeat(100);
 const all=book.sections.flatMap(section=>section.units.map(unit=>({section,unit})));
 const total=requestTokens(input,theme,[],provider);
 if(selectedChapters?total<=limits.whole:book.sections.length<=2&&total<=Math.min(limits.whole,limits.chapter))return {mode:'whole',blocks:[{ranges:ranges(all),tokens:total}]};
 const blocks:z.infer<typeof blockSchema>[]=[];let rows:Row[]=[];
 const measured=(target:Row[])=>purpose==='cards'?requestTokens({...input,text:render(target)},theme,[],provider):readingTokens(render(target),provider);
 const flush=()=>{if(rows.length){const tokens=measured(rows);if(tokens>limits.chapter)throw Error('Reading block exceeded budget');blocks.push({ranges:ranges(rows),tokens});rows=[];}};
 for(const section of book.sections){
  const sectionRows=section.units.map(unit=>({section,unit})),tokens=measured(sectionRows);
  if(tokens<=limits.chapter){const combined=[...rows,...sectionRows];if(rows.length&&measured(combined)>limits.chapter)flush();rows.push(...sectionRows);}
  else {flush();for(const row of sectionRows){if(measured([row])>limits.chapter)throw Error('Single source unit exceeds reading budget');if(rows.length&&measured([...rows,row])>limits.chapter)flush();rows.push(row);}}
 }
 flush();return {mode:'chapters',blocks};
}
export function readingPlanKey(book:LocalBook,provider:string,limits=defaultReadingLimits,selectedChapters=false,targetStoryTitle?:string,purpose:ReadingPurpose='scan'){
 if(purpose==='cards')return discoveryHash(['reading-plan-cards-v1',book.id,book.edition,discoveryHash(book.input.text),provider,limits,localReadingPrompt(planningInput(book,purpose,selectedChapters,targetStoryTitle)),localCardsJson]);
 return discoveryHash(['reading-plan-v4',book.id,book.edition,discoveryHash(book.input.text),provider,limits,localReadingPrompt({...book.input,purpose:'scan'}),localScanJson,...(selectedChapters||targetStoryTitle?['selected-chapters-v1',selectedChapters,localReadingPrompt({...book.input,purpose:'catalog',scan:{maxStories:1,excludedSources:[],pendingEvents:[],contextText:'',...(targetStoryTitle?{targetStoryTitle}:{chapterStoryLevel:'main' as const})}})]:[])]);
}
export function legacyReadingPlanKey(book:LocalBook,provider:string,limits=legacyReadingLimits){return discoveryHash(['reading-plan-v2',book.id,book.edition,discoveryHash(book.input.text),provider,limits,legacyLocalReadingPrompt({...book.input,purpose:'scan'}),legacyLocalScanJson]);}
export async function readingPlan(book:LocalBook,provider:string,cache:StoryDiscoveryCache,limits=defaultReadingLimits,selectedChapters=false,targetStoryTitle?:string,purpose:ReadingPurpose='scan'){
 const key=`${readingPlanKey(book,provider,limits,selectedChapters,targetStoryTitle,purpose)}/blocks`;
 let manifest=await cache.read(key,manifestSchema,value=>{hydrateReadingPlan(book,value);return true;});
 if(!manifest){manifest=buildReadingPlan(book,provider,limits,selectedChapters,targetStoryTitle,purpose);await cache.write(key,manifest);}
 return {key,manifest,blocks:hydrateReadingPlan(book,manifest)};
}
