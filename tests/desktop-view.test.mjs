// 桌面视图推导：优先级、工作区分区顺序、原文与侧栏、顶栏离开步骤及点击当前项不生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopView,workspaceSection,activeTopItem,exitSteps,topBarSteps} from '../lib/desktop-view.ts';

const base={configure:false,panelOpen:false,revisionTab:null,script:false,reviewHistoryId:null,source:false,sceneList:false,story:false,tab:'discover'};
const view=flags=>desktopView({...base,...flags});

test('precedence: create, then workspace, then reader, then tab',()=>{
 assert.deepEqual(view({configure:true,panelOpen:true,story:true}),{kind:'create'});
 assert.deepEqual(view({panelOpen:true,story:true}),{kind:'workspace',section:'flow'});
 assert.deepEqual(view({story:true}),{kind:'reader',panel:null});
 assert.deepEqual(view({tab:'shelf'}),{kind:'tab',tab:'shelf'});
});

test('workspace sections follow a total order; the first set flag wins',()=>{
 const all={panelOpen:true,revisionTab:'script',script:true,reviewHistoryId:'h',source:true};
 assert.equal(workspaceSection({...base,...all}),'edit');
 assert.equal(workspaceSection({...base,...all,revisionTab:null}),'script');
 assert.equal(workspaceSection({...base,...all,revisionTab:null,script:false}),'history');
 assert.equal(workspaceSection({...base,...all,revisionTab:null,script:false,reviewHistoryId:null}),'source');
 assert.equal(workspaceSection({...base,panelOpen:true}),'flow');
 // 任一工作区标志即可激活工作区，无需面板标志
 for(const flags of [{revisionTab:'requirements'},{script:true},{reviewHistoryId:'h'}])assert.equal(view(flags).kind,'workspace');
});

test('source alone selects the reader side panel; inside the workspace it is a section',()=>{
 assert.deepEqual(view({story:true,source:true}),{kind:'reader',panel:'source'});
 assert.deepEqual(view({story:true,sceneList:true}),{kind:'reader',panel:'scenes'});
 assert.deepEqual(view({source:true}),{kind:'tab',tab:'discover'});
 // 阅读时直接打开故事设置而不先关侧栏，会落到“原文”分区；因此桌面阅读先关闭侧栏
 assert.deepEqual(view({story:true,source:true,panelOpen:true}),{kind:'workspace',section:'source'});
 assert.deepEqual(view({story:true,panelOpen:true}),{kind:'workspace',section:'flow'});
});

test('top bar highlights tabs and create only',()=>{
 assert.equal(activeTopItem(view({tab:'me'})),'me');
 assert.equal(activeTopItem(view({tab:'shelf'})),'shelf');
 assert.equal(activeTopItem(view({})),'discover');
 assert.equal(activeTopItem(view({configure:true})),'create');
 assert.equal(activeTopItem(view({panelOpen:true})),null);
 assert.equal(activeTopItem(view({story:true})),null);
});

test('exitToShell leaves every open view in order',()=>{
 assert.deepEqual(exitSteps({...base,configure:true}),['closeCreate']);
 assert.deepEqual(exitSteps({...base,panelOpen:true}),['leaveWorkspace']);
 // 在工作区上打开新建：两层都要离开，否则关闭新建后工作区会回来
 assert.deepEqual(exitSteps({...base,configure:true,panelOpen:true}),['closeCreate','leaveWorkspace']);
 // 从阅读进入的工作区上打开新建：还要回到首页
 assert.deepEqual(exitSteps({...base,configure:true,panelOpen:true,story:true}),['closeCreate','leaveWorkspace','home']);
 assert.deepEqual(exitSteps({...base,story:true}),['home']);
 assert.deepEqual(exitSteps({...base,revisionTab:'script',story:true}),['leaveWorkspace','home']);
 assert.deepEqual(exitSteps(base),[]);
});

test('clicking the active top-bar item does nothing',()=>{
 assert.equal(topBarSteps({...base,configure:true},'create'),null);
 assert.equal(topBarSteps({...base,tab:'shelf'},'shelf'),null);
 assert.deepEqual(topBarSteps({...base,configure:true},'shelf'),['closeCreate']);
 assert.deepEqual(topBarSteps({...base,panelOpen:true},'create'),['leaveWorkspace']);
});
