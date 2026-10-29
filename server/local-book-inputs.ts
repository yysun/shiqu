// Exhaustively package consecutive original units; this is bounded reading, not retrieval.
import type {LocalBook,LocalUnit,LocalSection} from './local-books.ts';
import type {WholeBookInput} from '../lib/reader-local-contract.ts';
export type ReadingInput={input:WholeBookInput;visible:Set<string>};
export function bookInputs(book:LocalBook,maxChars=100000):ReadingInput[]{
 const all=book.sections.flatMap(section=>section.units.map(unit=>({section,unit})));
 if(book.input.text.length<=maxChars)return [{input:book.input,visible:new Set(all.map(x=>x.unit.id))}];
 const result:ReadingInput[]=[];let rows:{section:LocalSection;unit:LocalUnit}[]=[],size=0;
 function render(items:typeof rows){let previous='';return items.map(({section,unit})=>{const heading=previous===section.id?'':`篇章 ${section.id}：${section.title}\n`;previous=section.id;return heading+`[${unit.id}]\n${unit.text}`;}).join('\n\n');}
 function flush(){const text=render(rows);if(text.length>maxChars)throw Error('Local input exceeded bound');result.push({input:{title:book.title,edition:book.edition,text},visible:new Set(rows.map(x=>x.unit.id))});}
 for(const section of book.sections){
  const sectionRows=section.units.map(unit=>({section,unit})),sectionSize=render(sectionRows).length;
  if(rows.length&&sectionSize<=maxChars-5000&&size+sectionSize+2>maxChars-5000){flush();rows=[];size=0;}
  for(const row of sectionRows){
   const heading=rows.at(-1)?.section.id===section.id?'':`篇章 ${section.id}：${section.title}\n`;
   let length=row.unit.text.length+row.unit.id.length+heading.length+5;
   if(length>maxChars-5000)throw Error('Local unit exceeded bound');
   if(rows.length&&size+length>maxChars-5000){
    flush();rows=rows.filter(x=>x.section.id===section.id).slice(-2);
    // Retain only context that fits alongside this complete unit under smaller index budgets.
    while(rows.length&&render([...rows,row]).length>maxChars-5000)rows.shift();
    size=render(rows).length;length=row.unit.text.length+row.unit.id.length+(rows.length?0:heading.length)+5;
   }
   rows.push(row);size+=length;
  }
 }if(rows.length)flush();
 return result;
}
