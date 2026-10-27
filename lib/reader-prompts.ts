const themeDirections:Record<string,string>={
 '给我一个反转':'开头制造一个可信的预期，中段埋下细节，结尾用有因果依据的反转改变读者对人物的判断，不靠突然出现的新信息。',
 '人情冷暖':'通过人物在利益、困境与日常往来中的选择，表现人情的温度与反差，让细微行动胜过直白评价。',
 '放下执念':'让人物因执念陷入困境，再通过一次具体遭遇看见另一种可能；转变要自然，保留放下之前的挣扎。',
 '聪明与糊涂':'安排自以为聪明与看似糊涂的对照，让行动的结果揭示真正的智慧；幽默克制，不把人物写成傻子。',
 '善意与误解':'从一场可以理解的误会展开，让善意在行动中逐渐显露；解开误会时留下复杂而温暖的人情余味。',
 '命运与选择':'围绕一次关键选择展开，呈现选择的代价与意料之外的结果，让命运感来自人物行动与环境的交织。',
 '欲望与代价':'让一个小小的欲望逐步放大，展示每一步看似合理的选择如何累积成代价，结局有铺垫而不简单说教。',
 '勇气与成长':'从人物的犹豫与弱点出发，通过一次需要付出代价的行动表现成长，保留不完美与真实的恐惧。',
 '爱情与错过':'用相遇、犹疑与错过的具体细节表现感情，克制煽情，让未说出口的话和选择留下余味。',
 '幽默与讽刺':'用人物言行与实际结果的反差制造幽默，讽刺落在处境与人性上；节奏轻快，避免堆砌现代网络笑话。',
 '因果与报应':'围绕人物行为与后果铺设清晰因果，让结果出人意料又能回看出伏笔，避免把复杂人性简单分成善恶。',
};
export function defaultProductionPrompt(theme:string){
 const topic=theme.trim();
 const direction=themeDirections[topic]||(topic&&topic!=='其他'?`围绕“${topic}”展开，安排具体冲突、人物选择与前后反差，让主题从情节中自然显现。`:'以人物选择与前后反差展开一个有余味的古典短故事。');
 return direction+'保留原典核心人物与事件，旁白简练、画面有变化，结尾留一个值得回味的问题，不直接讲大道理。';
}
export function promptAfterThemeChange(current:string,previousTheme:string,nextTheme:string){
 return !current.trim()||current===defaultProductionPrompt(previousTheme)?defaultProductionPrompt(nextTheme):current;
}
