// Resolve ordered, non-overlapping multi-chapter receipts without replacing evidence with summaries.
import {ReaderError} from '../lib/reader-model.ts';
import {localSourceSchema,sourceRanges} from '../lib/reader-local-contract.ts';
import type {LocalSourceReference} from '../lib/reader-local-contract.ts';
import type {LocalBook,LocalSection} from './local-books.ts';
import {hasBlockingSourceAnomaly,hasSourceAnomaly} from './local-source-quality.ts';
import {readingTokens,wholeInputTokens} from './story-token-budget.ts';
const invalid=()=>new ReaderError(400,'本地出处无法核对，请重新按主题选择故事。');
export function sourceParts(book:LocalBook,source:LocalSourceReference){
 const parsed=localSourceSchema.safeParse(source);if(!parsed.success||parsed.data.edition!==book.edition)throw invalid();
 let previousSection=-1,previousEnd=-1;
 return sourceRanges(parsed.data).map(range=>{
  const sectionIndex=book.sections.findIndex(s=>s.id===range.sectionId),section=book.sections[sectionIndex];
  if(!section)throw invalid();
  const first=section.units.findIndex(u=>u.id===range.firstUnit),last=section.units.findIndex(u=>u.id===range.lastUnit);
  if(first<0||last<first||sectionIndex<previousSection||sectionIndex===previousSection&&first<=previousEnd)throw invalid();
  previousSection=sectionIndex;previousEnd=last;
  return {section,sectionIndex,first,last,units:section.units.slice(first,last+1)};
 });
}
export function sourceUnitIds(book:LocalBook,source:LocalSourceReference){return sourceParts(book,source).flatMap(part=>part.units.map(u=>u.id));}
export function sourcesOverlap(book:LocalBook,a:LocalSourceReference,b:LocalSourceReference){const ids=new Set(sourceUnitIds(book,a));return sourceUnitIds(book,b).some(id=>ids.has(id));}
export function sourceCovers(book:LocalBook,a:LocalSourceReference,b:LocalSourceReference){const ids=new Set(sourceUnitIds(book,a));return sourceUnitIds(book,b).every(id=>ids.has(id));}
export function mergeSources(book:LocalBook,a:LocalSourceReference,b:LocalSourceReference):LocalSourceReference{
 const ids=new Set([...sourceUnitIds(book,a),...sourceUnitIds(book,b)]),ranges:{sectionId:string;firstUnit:string;lastUnit:string}[]=[];
 for(const section of book.sections){let range:typeof ranges[number]|undefined;
  for(const unit of section.units){if(ids.has(unit.id)){if(range)range.lastUnit=unit.id;else {range={sectionId:section.id,firstUnit:unit.id,lastUnit:unit.id};ranges.push(range);}}else range=undefined;}
 }
 const [first,...continuations]=ranges;if(!first||ranges.length>24)throw invalid();
 return {...first,...(continuations.length?{continuations}:{}),edition:book.edition};
}
export function sourceText(book:LocalBook,source:LocalSourceReference,legacyChapter=false){
 const parts=sourceParts(book,source);
 if(!legacyChapter&&book.id==='shishuo'&&(parts.length!==1||parts[0].first!==parts[0].last))throw invalid();
 for(const part of parts){
  const text=part.units.map(u=>u.text).join('\n\n'),tagged=part.units.every(u=>u.narrative!==undefined);
  if((tagged?!part.units.some(u=>u.narrative):!/[。！？!?，；：]/.test(text))||part.units.some(u=>u.unreadable)||hasBlockingSourceAnomaly(text,{...source,sectionId:part.section.id})||hasSourceAnomaly(part.section.title))throw invalid();
 }
 const text=parts.map(part=>(parts.length>1?`【出处：${part.section.title}】\n`:'')+part.units.map(u=>u.text).join('\n\n')).join('\n\n');
 if(text.length<20||text.length>2000000||readingTokens(text)>wholeInputTokens||hasSourceAnomaly(book.title))throw invalid();
 const first=parts[0],last=parts.at(-1)!,range=first.first===first.last?`第${first.first+1}${book.id==='shishuo'?'则':'段'}`:`第${first.first+1}–${first.last+1}段`;
 const title=parts.length===1?`《${book.title}·${first.section.title}》${legacyChapter?'':` · ${range}`}`:`《${book.title}·${first.section.title} → ${last.section.title}》 · ${parts.length}段原文`;
 return {text,title,section:first.section as LocalSection,parts:parts.map(part=>({sectionId:part.section.id,title:part.section.title,text:part.units.map(unit=>unit.text).join('\n\n')}))};
}
