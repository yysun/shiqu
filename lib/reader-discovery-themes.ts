// 预设短标题用于显示和保存；完整定义只在选篇时使用。
import type {Selection} from './reader-model.ts';

const definitions=[
 ['人情冷暖','人物得势、落难或有求于人时，身边人的帮助、疏远或态度反差显出人情的厚薄。'],
 ['爱与缘分','两人的情意推动关键情节，两人的选择或各自的处境促成相知、相守、负心或错过。'],
 ['善意的处境','人物的善举招来猜疑、被人利用，或使自己面对两难，故事写出人物如何应对或这份善意带来的后果。'],
 ['聪明与糊涂','人物自以为聪明却误判局势，或看似糊涂却抓住要害，行动的结果显出判断与表象的落差。'],
 ['命运与选择','人物受身份、承诺或时局所限，仍作出一个影响结局的选择。'],
 ['欲望的代价','人物为求得某样东西而采取行动，也因此失去某样对自己有价值的东西。'],
 ['执念与放下','人物长期坚持某个愿望、判断或承诺，这份执念让他陷入困境、付出代价，或在具体遭遇后终于放下。'],
 ['世事可笑','人物的言行、身份或所守的规矩与事情的结果形成荒唐反差，照出一种人情或世风。'],
] as const;
export const discoveryThemePresets:readonly string[]=definitions.map(([title])=>title);

export function discoveryThemeDefinition({theme,discovery}:Pick<Selection,'theme'|'discovery'>){
 if(discovery?.mode==='auto'&&!discovery.plot&&discovery.themeInput==='preset')return definitions.find(([title])=>title===theme)?.[1];
}

export function discoveryThemeQuery(selection:Pick<Selection,'theme'|'discovery'>){
 return discoveryThemeDefinition(selection)??selection.theme;
}


// 已选出处可携带主题来源标记；标记本身不启动提取。
export function isDirectSourceSelection({source,discovery,discoverySources}:Pick<Selection,'source'|'discovery'|'discoverySources'>){
 return !!source&&!discoverySources?.length&&(!discovery||discovery.mode==='auto'&&!!discovery.themeInput&&
  !discovery.combine&&!discovery.plot&&!discovery.scanOnly&&!discovery.vectorFirst);
}
