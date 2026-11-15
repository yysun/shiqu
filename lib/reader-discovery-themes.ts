// 预设短标题用于显示和保存；完整定义只在选篇时使用。
import type {Selection} from './reader-model.ts';

const definitions={
 '情节反转':'原文先让人物或读者对身份、动机或事态形成可信的预期，随后以可回查的行动或线索推翻这项预期。',
 '人情冷暖':'人物得势、落难或有求于人时，身边人的帮助、疏远或态度反差显出人情的厚薄。',
 '放下执念':'人物因坚持某个愿望、判断或承诺陷入困境，后来因具体遭遇改变选择，放下原先所求。',
 '智愚反差':'人物自以为聪明却误判局势，或看似糊涂却抓住要害，行动的结果显出判断与表象的落差。',
 '善意遭误解':'人物出于好意采取行动，却被旁人误读动机，误会影响了双方关系或接下来的行动。',
 '困境抉择':'人物受身份、承诺或时局所限，仍作出一个影响结局的选择。',
 '欲望的代价':'人物为求得某样东西而采取行动，也因此失去某样对自己有价值的东西。',
 '鼓起勇气':'人物面对恐惧或压力作出有风险的行动，并因此改变了对自己、他人或责任的认识与做法。',
 '错过的爱情':'两人的情意推动故事，迟疑、分离、承诺或处境使相爱的人错过相守或错失表达与选择的机会。',
 '世事可笑':'人物的言行、身份或所守的规矩与事情的结果形成荒唐反差，照出一种人情或世风。',
 '因果报应':'人物先前的善行、恶行或欺瞒通过可辨认的因果引来回报或惩罚，结局与先前行为有清楚的联系。',
 '信义的考验':'人物曾受恩、立约或被托付，在利益或危险面前践行承诺、背弃信任，或因他人背弃而改变行动。',
 '复仇':'人物为自己或他人先前受到的伤害采取行动，意在追究或报复加害者，报复的过程或后果推动故事。',
 '真假难辨':'有人冒认身份、编造证据或设计骗局以影响他人的判断。识破或受骗造成具体后果。',
 '权力争夺':'人物在官场、家族或阵营间为获取、制衡或保住权力而谋划，拉拢、试探或布局改变了各方处境。',
} as const;
// 旧标题仍解析为完整定义，0.13 已使用的宽主题保留原口径。
const retainedDefinitions=new Map<string,string>([
 ['给我一个反转',definitions.情节反转],
 ['聪明与糊涂',definitions.智愚反差],
 ['善意与误解',definitions.善意遭误解],
 ['命运与选择',definitions.困境抉择],
 ['欲望与代价',definitions.欲望的代价],
 ['勇气与成长',definitions.鼓起勇气],
 ['爱情与错过',definitions.错过的爱情],
 ['幽默与讽刺',definitions.世事可笑],
 ['因果与报应',definitions.因果报应],
 ['爱与缘分','两人的情意推动关键情节，两人的选择或各自的处境促成相知、相守、负心或错过。'],
 ['善意的处境','人物的善举招来猜疑、被人利用，或使自己面对两难，故事写出人物如何应对或这份善意带来的后果。'],
 ['执念与放下','人物长期坚持某个愿望、判断或承诺，这份执念让他陷入困境、付出代价，或在具体遭遇后终于放下。'],
]);
export const discoveryThemePresets:readonly string[]=Object.keys(definitions);

export function discoveryThemeDefinition({theme,discovery}:Pick<Selection,'theme'|'discovery'>){
 if(discovery?.mode==='auto'&&!discovery.plot&&discovery.themeInput==='preset')
  return Object.hasOwn(definitions,theme)?definitions[theme as keyof typeof definitions]:retainedDefinitions.get(theme);
}

export function discoveryThemeQuery(selection:Pick<Selection,'theme'|'discovery'>){
 return discoveryThemeDefinition(selection)??selection.theme;
}


// 直接选择的故事卡仍保留主题来源；队列提取后选中的候选不带 sourceCard。
export function isDirectSourceSelection({source,sourceCard,discovery,discoverySources}:Pick<Selection,'source'|'sourceCard'|'discovery'|'discoverySources'>){
 return !!source&&!discoverySources?.length&&(!discovery||!!sourceCard&&discovery.mode==='auto'&&!!discovery.themeInput&&
  !discovery.combine&&!discovery.plot&&!discovery.scanOnly&&!discovery.vectorFirst);
}
