// Apply one evidenced erratum to the pinned Gutenberg transcription without rewriting its bytes.
// The derived edition invalidates discovery receipts; saved historical originals remain untouched.
import {createHash} from 'node:crypto';
import type {LocalSection} from './local-books.ts';

export const shishuoOriginalEdition='ca4497d57f79e61caf20db769be2159528b1808d36bd1400e4f4714ccf960cab';
export const shishuoCorrectionUrl='https://zh.wikisource.org/w/index.php?title=世說新語/捷悟&oldid=1500322';
export function correctShishuo(id:string,edition:string,sections:LocalSection[]){
 if(id!=='shishuo')return edition;
 if(edition!==shishuoOriginalEdition)throw Error('Unreviewed Shishuo transcription');
 const unit=sections.find(section=>section.id==='shishuo-11')?.units.find(unit=>unit.id==='shishuo-11-003');
 if(!unit||unit.text.split('外孫臼」八字').length!==2||unit.text.split('臼，受辛也').length!==2||unit.text.includes('齏'))throw Error('Shishuo erratum context changed');
 unit.text=unit.text.replace('外孫臼」八字','外孫齏臼」八字').replace('臼，受辛也','齏臼，受辛也');
 unit.url=shishuoCorrectionUrl;
 unit.provider='维基文库 revision 1500322（仅校补两处“齏”字，其余保留 Gutenberg 底本）';
 return createHash('sha256').update(JSON.stringify([edition,unit.id,unit.text,unit.url])).digest('hex');
}
