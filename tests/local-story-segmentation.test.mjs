import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryCandidates,layoutStoryStarts,partitionStoryUnits,reconcileBoundaryReviews,semanticBoundaryWindows,validateBoundaryDecisions,validateSemanticStarts} from '../server/local-story-segmentation.ts';

const unitsOf=(...texts)=>texts.map((text,index)=>({id:`u${index+1}`,text}));

test('排版候选由语义确认，保留完整且连续的原文',()=>{
 const units=unitsOf('湯禱於桑林翦其','爪髮自以為犧牲','於是大雨即至','呂望釣於渭陽');
 const starts=layoutStoryStarts(units,['卷八',units[0].text,units[1].text,'　'+units[2].text,units[3].text,'卷八']);
 assert.deepEqual(starts,['u1','u2','u4']);
 const sections=[{id:'example',units,layoutStarts:starts}];
 const candidates=boundaryCandidates(sections);
 assert.deepEqual(candidates.map(({id,layout})=>[id,layout]),[['u2','start'],['u3','continue'],['u4','start']]);
 const reviewed=validateBoundaryDecisions(candidates,{u2:0,u3:0,u4:1});
 const [{groups}]=partitionStoryUnits(sections,reviewed);
 assert.deepEqual(groups.map(group=>group.map(unit=>unit.id)),[['u1','u2','u3'],['u4']]);
 assert.deepEqual(groups.flat(),units);
});

test('排版信号不改变语义扫描覆盖范围',()=>{
 const units=unitsOf('甲为郡守','乃修桥以利民','乙夜遇故友');
 assert.equal(layoutStoryStarts(units,['甲为郡守','乃修桥','乙夜遇故友']),undefined);
 const unstructured=[{id:'other',units}];
 const candidates=boundaryCandidates(unstructured);
 assert.deepEqual(candidates.map(({layout})=>layout),['unknown','unknown']);
 const decisions=validateBoundaryDecisions(candidates,{u2:0,u3:1});
 assert.deepEqual(partitionStoryUnits(unstructured,decisions)[0].groups,[units.slice(0,2),units.slice(2)]);
 const hinted=[{...unstructured[0],layoutStarts:['u1']}];
 assert.deepEqual(boundaryCandidates(hinted).map(({id,layout})=>[id,layout]),[['u2','continue'],['u3','continue']]);
});

test('拒绝丢失、虚构和无效的边界回执',()=>{
 const candidates=boundaryCandidates([{id:'example',units:unitsOf('甲来','乙走','丙至')}]);
 for(const value of [{u2:1},{u2:1,u9:0},{u2:'1',u3:0},{u2:1,u3:0,u9:1}])assert.throws(()=>validateBoundaryDecisions(candidates,value));
});

test('语义窗口有邻文，每个待判行只属于一个窗口',()=>{
 const units=unitsOf('第一条起因','第一条行动','第一条结局','第二条起因','第二条结局');
 const windows=semanticBoundaryWindows([{id:'example',units,layoutStarts:['u1','u2']}],2,100);
 assert.deepEqual(windows.map(({ids})=>ids),[['u2'],['u3','u4'],['u5']]);
 assert.match(windows[1].before,/第一条行动/);
 assert.match(windows[1].after,/第二条结局/);
 assert.deepEqual([...validateSemanticStarts(windows[1].ids,['u4'])],[['u3',false],['u4',true]]);
 assert.throws(()=>validateSemanticStarts(windows[1].ids,['u2']));
 assert.throws(()=>validateSemanticStarts(windows[1].ids,['u4','u4']));
});

test('局部复核不能仅凭已断开的语法把连续事件再次切开',()=>{
 const units=unitsOf('甲欲告其','母之所在','乙与客相遇');
 const candidates=boundaryCandidates([{id:'example',units,layoutStarts:['u1','u2','u3']}]);
 const initial=new Map([['u2',false],['u3',false]]);
 const review=new Map([['u2',true],['u3',true]]);
 assert.deepEqual([...reconcileBoundaryReviews(initial,candidates,review)],[['u2',false],['u3',true]]);
});
