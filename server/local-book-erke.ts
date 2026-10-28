// Read each pinned Erke TXT volume, retaining all dialogue, verse and original glyphs.
// Only the duplicated display heading is collapsed; source bytes and body are never corrected.
import {chapterNumber,localLines} from './local-book-parsers.ts';
import type {LocalSection} from './local-books.ts';
export function parseErkeVolume(raw:string,number:number,url:string):LocalSection{
 const text=raw.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 const heading=text.match(/^卷(?:之)?([一二三四五六七八九十]+) ([^\n]+)\n/);
 if(!heading||chapterNumber(heading[1])!==number)throw Error('Erke volume heading mismatch');
 const body=text.slice(heading[0].length).trim();
 if(!body)throw Error('Erke empty volume');
 if(number===40){
  const folds=[...body.matchAll(/第([一二三四五六七八九]+)折/g)].map(match=>chapterNumber(match[1]));
  if(folds.length!==9||folds.some((value,index)=>value!==index+1)||!body.endsWith('合编成妆点《闹元宵》。'))throw Error('Erke final play incomplete');
 }
 const sectionId=`erke-${String(number).padStart(3,'0')}`;
 const title=heading[0].trim().replace(/(宋公明闹元宵杂剧)\1$/,'$1')+(number===40?'（杂剧）':'');
 return {id:sectionId,title,url,units:localLines(body).map((text,index)=>({id:`${sectionId}-${String(index+1).padStart(3,'0')}`,text}))};
}
