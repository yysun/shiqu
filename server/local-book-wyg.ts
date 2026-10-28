// Parse the pinned Kanripo WYG transcription without adding punctuation or changing glyphs.
// Layout identifies the volume contents list and narrative; only narrative can validate a receipt.
import {chapterNumber} from './local-book-parsers.ts';
import type {LocalSection} from './local-books.ts';
export function parseWygVolume(raw:string,number:number,url:string):LocalSection{
 const juan=raw.match(/^#\+PROPERTY: JUAN [卷巻]([^\r\n]+)$/m);
 if(!/^#\+PROPERTY: ID KR3l0118\s*$/m.test(raw)||!/^#\+PROPERTY: BASEEDITION WYG\s*$/m.test(raw)||!juan||chapterNumber(juan[1])!==number)throw Error('WYG volume metadata mismatch');
 const lines=raw.replace(/\r\n/g,'\n').split('\n').filter(line=>!line.startsWith('#')&&!/^<pb:KR3l0118_WYG_\d+-\d+[ab]>¶$/.test(line)).map(line=>line.replace(/¶$/,''));
 const titles=lines.flatMap((line,index)=>{const match=line.match(/^\u3000[太大]平廣記[卷巻]([〇零一二三四五六七八九十百千]+)(?:\u3000.*)?$/);return match?[{index,number:chapterNumber(match[1])}]:[];});
 if(titles.length!==2||titles.some(title=>title.number!==number))throw Error('WYG opening/closing volume mismatch');
 const first=lines.findIndex(line=>/^\u3000{4}[^\s]/u.test(line)),last=titles[1].index;
 if(first<=titles[0].index||first>=last||lines.slice(last+1).some(line=>line.trim()))throw Error('WYG body boundary mismatch');
 const sectionId=`taiping-${String(number).padStart(3,'0')}`;
 const units=lines.slice(first,last).filter(line=>line.trim()).map((line,index)=>({id:`${sectionId}-${String(index+1).padStart(3,'0')}`,text:line.trim(),narrative:!/^\u3000{2,}/u.test(line)&&[...line.matchAll(/\p{Script=Han}/gu)].length>=12}));
 if(!units.some(unit=>unit.narrative)||units.some(unit=>/[¶<>#]/u.test(unit.text)))throw Error('WYG narrative missing or malformed');
 return {id:sectionId,title:juan[0].replace(/^.*JUAN /,'')+'（文渊阁本）',units,url};
}
