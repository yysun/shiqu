// 桌面视图由 Reader 现有的状态标志推导，不另存导航状态；手机与桌面读取同一组标志，跨档切换无需转换。
// 优先级：新建 → 工作区（含分区）→ 阅读（含侧栏）→ 标签页。工作区分区按固定顺序取第一个已设置的标志。
// docked 与 dockedWorkflow：右栏阅读或故事设置保持书架标签页；编辑、原文等分区仍进入工作区。

export type WorkspaceSection='flow'|'edit'|'script'|'history'|'source';
export type DesktopFlags={
 configure:boolean;panelOpen:boolean;revisionTab:string|null;script:boolean;reviewHistoryId:string|null;
 source:boolean;sceneList:boolean;story:boolean;docked?:boolean;dockedWorkflow?:boolean;tab:string;
};
export type DesktopView=
 |{kind:'create'}
 |{kind:'workspace';section:WorkspaceSection}
 |{kind:'reader';panel:'scenes'|'source'|null}
 |{kind:'tab';tab:string};
export type TopItem='discover'|'shelf'|'me'|'create';

export const workspaceActive=(f:DesktopFlags)=>f.panelOpen||!!f.revisionTab||f.script||!!f.reviewHistoryId;

export function workspaceSection(f:DesktopFlags):WorkspaceSection{
 if(f.revisionTab)return 'edit';
 if(f.script)return 'script';
 if(f.reviewHistoryId)return 'history';
 if(f.source)return 'source';
 return 'flow';
}

export function desktopView(f:DesktopFlags):DesktopView{
 if(f.configure)return {kind:'create'};
 if(workspaceActive(f)){
  const section=workspaceSection(f);
  if(f.dockedWorkflow&&section==='flow')return {kind:'tab',tab:f.tab};
  return {kind:'workspace',section};
 }
 if(f.story&&!f.docked)return {kind:'reader',panel:f.sceneList?'scenes':f.source?'source':null};
 return {kind:'tab',tab:f.tab};
}

// 顶栏高亮：标签页对应其标签，新建页对应“新建故事”，工作区与阅读不高亮。
export function activeTopItem(view:DesktopView):TopItem|null{
 if(view.kind==='create')return 'create';
 if(view.kind==='tab')return view.tab==='shelf'||view.tab==='me'?view.tab:'discover';
 return null;
}

// 顶栏离开当前视图的步骤，按顺序执行：关闭新建 → 离开工作区 → 回到首页。
export type ExitStep='closeCreate'|'leaveWorkspace'|'home';
export function exitSteps(f:DesktopFlags):ExitStep[]{
 const steps:ExitStep[]=[];
 if(f.configure)steps.push('closeCreate');
 if(workspaceActive(f))steps.push('leaveWorkspace');
 if(f.story)steps.push('home');
 return steps;
}

// 点击当前已高亮的顶栏项不做任何事（新建页上再点“新建故事”保留草稿）。
export function topBarSteps(f:DesktopFlags,target:TopItem):ExitStep[]|null{
 return activeTopItem(desktopView(f))===target?null:exitSteps(f);
}

// 工作区分区标签：只显示今天有入口的分区。制作流程总在；修改故事需要可修订的版本；分镜剧本需要分镜；
// 审核记录需要已确认制作的会话；原文需要已打开的故事或已核对的原文。
export function workspaceSections(entry:{revisable:boolean;script:boolean;history:boolean;source:boolean}):WorkspaceSection[]{
 return ['flow',...(entry.revisable?['edit' as const]:[]),...(entry.script?['script' as const]:[]),...(entry.history?['history' as const]:[]),...(entry.source?['source' as const]:[])];
}
