// Reject unresolved glyphs in the shipped Chinese corpus without correcting the original text.
// Only explicit component layouts and editorial omissions are markers; ordinary annotations and stage cues remain valid.
import type {OriginalSource} from '../lib/reader-source-types.ts';
const damagedCodepoint=/[\uE000-\uF8FF\uFFFD□\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\u2FF0-\u2FFF]/u;
const unresolvedEntity=/&(?:amp;)*(?:KR[\w-]*|CDP[-\w]+);/iu;
const componentLayout=/【(?:字形)?(?:左[\p{Script=Han}]{1,2}右[\p{Script=Han}]{1,2}|上[\p{Script=Han}]{1,2}下[\p{Script=Han}]{1,2})】|【(?:字形|□[：:])?(?:左|上)[^】\n]{0,35}[“「"][^】\n]{0,35}(?:右|下)[^】\n]{0,35}】/u;
const editorialOmission=/[（(][^()（）\n]{0,12}(?:下有[/\s]*[脱脫]文|原缺|原[阙闕]|缺[頁页])[^()（）\n]{0,12}[）)]|下有[/\s]*[脱脫]文(?:[。．.]|$)/u;
export function hasSourceAnomaly(text:string){
 return typeof text!=='string'||!text.isWellFormed()||damagedCodepoint.test(text)||unresolvedEntity.test(text)||componentLayout.test(text)||editorialOmission.test(text);
}
// Two reviewed, nonessential details in pinned editions remain usable without guessing their glyphs.
// This is qualification only: neither the returned source nor the stored original is rewritten.
const reviewed=[
 {edition:'4dbe192e89b80819a769366ac0c343dbb7c143467b0d5f4989b729d9dcee734f',sectionId:'honglou-058',context:'因近日將園中分與眾婆子料理，各司各業，皆在忙時：也有修竹的，也有⿰烏刂樹的，也有栽花的，也有種豆的，',glyph:'⿰烏刂'},
 {edition:'c6aa36dc88c7db80f7d370904434fff5a6a7e324e9dbc90787372053bbc01170',sectionId:'yushi-037',context:'范道受記了，\ue853著高高的念聲「南無阿彌陀佛」，便合了眼。',glyph:'\ue853'},
];
export function hasBlockingSourceAnomaly(text:string,source?:{edition:string;sectionId:string}){
 if(typeof text!=='string')return true;
 let inspected=text;
 for(const rule of reviewed)if(source?.edition===rule.edition&&source.sectionId===rule.sectionId)inspected=inspected.replace(rule.context,rule.context.replace(rule.glyph,''));
 return hasSourceAnomaly(inspected);
}
// Historical retries use saved evidence, including the chapter identity of each continuation.
// Check the parts against the exact saved text before allowing any chapter-scoped glyph exception.
export function hasStoredSourceAnomaly(original:OriginalSource){
 const source=original.localSource;
 if(!source?.continuations?.length)return hasBlockingSourceAnomaly(original.text,source);
 const sections=[source,...source.continuations],parts=original.localParts;
 if(!parts)return hasBlockingSourceAnomaly(original.text,source);
 if(parts.length!==sections.length||parts.some((part,i)=>part.sectionId!==sections[i].sectionId||typeof part.text!=='string'||typeof part.title!=='string'||hasSourceAnomaly(part.title)))return true;
 if(parts.map(part=>`【出处：${part.title}】\n${part.text}`).join('\n\n')!==original.text)return true;
 return parts.some(part=>hasBlockingSourceAnomaly(part.text,{edition:source.edition,sectionId:part.sectionId}));
}
