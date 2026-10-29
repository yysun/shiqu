// Persist stable reading boundaries and token counts, sharing original text across themes.
// Manifests contain references only; hydration verifies exhaustive, ordered unit coverage.
import {z} from 'zod';
import {localRangeSchema,localScanJson,localReadingPrompt} from '../lib/reader-local-contract.ts';
import type {WholeBookInput} from '../lib/reader-local-contract.ts';
import type {LocalBook,LocalSection,LocalUnit} from './local-books.ts';
import {StoryDiscoveryCache,discoveryHash} from './story-discovery-cache.ts';
import {readingTokens,requestTokens,wholeInputTokens,chapterInputTokens} from './story-token-budget.ts';
type Row={section:LocalSection;unit:LocalUnit};
const blockSchema=z.object({ranges:z.array(localRangeSchema).min(1),tokens:z.number().int().min(1)});
const manifestSchema=z.object({mode:z.enum(['whole','chapters']),blocks:z.array(blockSchema).min(1)});
export type ReadingManifest=z.infer<typeof manifestSchema>;
export type ReadingBlock={text:string;visible:Set<string>;chars:number};
export type ReadingLimits={whole:number;chapter:number};
export const defaultReadingLimits={whole:wholeInputTokens,chapter:chapterInputTokens};
function render(rows:Row[]){let previous='';return rows.map(({section,unit})=>{const heading=previous===section.id?'':`篇章 ${section.id}：${section.title}\n`;previous=section.id;return heading+`[${unit.id}]\n${unit.text}`;}).join('\n\n');}
function ranges(rows:Row[]){const result:z.infer<typeof localRangeSchema>[]=[];for(const {section,unit} of rows){const last=result.at(-1);if(last?.sectionId===section.id)last.lastUnit=unit.id;else result.push({sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id});}return result;}
export function hydrateReadingPlan(book:LocalBook,manifest:ReadingManifest):ReadingBlock[]{
 const expected=book.sections.flatMap(s=>s.units.map(u=>u.id)),seen:string[]=[];
 const blocks=manifest.blocks.map(block=>{
  const rows:Row[]=[];
  for(const range of block.ranges){const section=book.sections.find(s=>s.id===range.sectionId);if(!section)throw Error('Unknown reading chapter');const first=section.units.findIndex(u=>u.id===range.firstUnit),last=section.units.findIndex(u=>u.id===range.lastUnit);if(first<0||last<first)throw Error('Invalid reading boundary');rows.push(...section.units.slice(first,last+1).map(unit=>({section,unit})));}
  const ids=rows.map(r=>r.unit.id);seen.push(...ids);
  return {text:manifest.mode==='whole'?book.input.text:render(rows),visible:new Set(ids),chars:rows.reduce((n,r)=>n+Array.from(r.unit.text.replace(/\s/gu,'')).length,0)};
 });
 if(JSON.stringify(seen)!==JSON.stringify(expected)||manifest.mode==='whole'&&blocks.length!==1)throw Error('Reading manifest does not cover original');
 return blocks;
}
export function buildReadingPlan(book:LocalBook,provider:string,limits=defaultReadingLimits):ReadingManifest{
 const input:WholeBookInput={...book.input,purpose:'scan',scan:{maxStories:5,excludedSources:[],pendingEvents:[],contextText:''}};
 const all=book.sections.flatMap(section=>section.units.map(unit=>({section,unit})));
 const total=requestTokens(input,'题'.repeat(100),[],provider);
 if(total<=limits.whole)return {mode:'whole',blocks:[{ranges:ranges(all),tokens:total}]};
 const blocks:z.infer<typeof blockSchema>[]=[];let rows:Row[]=[],size=0;
 const flush=()=>{if(rows.length){const text=render(rows),tokens=readingTokens(text,provider);if(tokens>limits.chapter)throw Error('Reading block exceeded budget');blocks.push({ranges:ranges(rows),tokens});rows=[];size=0;}};
 for(const section of book.sections){
  const sectionRows=section.units.map(unit=>({section,unit})),tokens=readingTokens(render(sectionRows),provider);
  if(tokens<=limits.chapter){if(rows.length&&size+tokens+10>limits.chapter)flush();rows.push(...sectionRows);size+=tokens+10;}
  else {flush();for(const row of sectionRows){const tokens=readingTokens(render([row]),provider)+10;if(tokens>limits.chapter)throw Error('Single source unit exceeds reading budget');if(size+tokens>limits.chapter)flush();rows.push(row);size+=tokens;}}
 }
 flush();return {mode:'chapters',blocks};
}
export function readingPlanKey(book:LocalBook,provider:string,limits=defaultReadingLimits){return discoveryHash(['reading-plan-v2',book.id,book.edition,discoveryHash(book.input.text),provider,limits,localReadingPrompt({...book.input,purpose:'scan'}),localScanJson]);}
export async function readingPlan(book:LocalBook,provider:string,cache:StoryDiscoveryCache,limits=defaultReadingLimits){
 const key=`${readingPlanKey(book,provider,limits)}/blocks`;
 let manifest=await cache.read(key,manifestSchema,value=>{hydrateReadingPlan(book,value);return true;});
 if(!manifest){manifest=buildReadingPlan(book,provider,limits);await cache.write(key,manifest);}
 return {key,manifest,blocks:hydrateReadingPlan(book,manifest)};
}
