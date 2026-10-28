// Reject unresolved glyphs in the shipped Chinese corpus without correcting the original text.
// Only explicit component layouts and editorial omissions are markers; ordinary annotations and stage cues remain valid.
const damagedCodepoint=/[\uE000-\uF8FF\uFFFD□\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\u2FF0-\u2FFF]/u;
const unresolvedEntity=/&(?:amp;)*(?:KR[\w-]*|CDP[-\w]+);/iu;
const componentLayout=/【(?:字形)?(?:左[\p{Script=Han}]{1,2}右[\p{Script=Han}]{1,2}|上[\p{Script=Han}]{1,2}下[\p{Script=Han}]{1,2})】|【(?:字形|□[：:])?(?:左|上)[^】\n]{0,35}[“「"][^】\n]{0,35}(?:右|下)[^】\n]{0,35}】/u;
const editorialOmission=/[（(][^()（）\n]{0,12}(?:下有[/\s]*[脱脫]文|原缺|原[阙闕]|缺[頁页])[^()（）\n]{0,12}[）)]/u;
export function hasSourceAnomaly(text:string){
 return typeof text!=='string'||!text.isWellFormed()||damagedCodepoint.test(text)||unresolvedEntity.test(text)||componentLayout.test(text)||editorialOmission.test(text);
}
