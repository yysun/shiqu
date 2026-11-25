// 配置与规范双向核对：节点目录与调用契约的每一行都在配置中出现，配置不引用规范之外的行。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nodes,calls} from '../lib/production-dag/registry.ts';

const spec=readFileSync(new URL('../.docs/story-production-dag.md',import.meta.url),'utf8');
function firstColumn(heading,document=spec){
 const start=document.indexOf(`\n${heading}\n`);
 assert.ok(start>=0,`missing section ${heading}`);
 const section=document.slice(start+heading.length+2);
 const end=section.search(/\n## /);
 return (end<0?section:section.slice(0,end)).split('\n').filter(l=>l.startsWith('| ')&&!l.startsWith('| ---')).slice(1).map(l=>l.split('|')[1].trim());
}
// 主图中没有表格行的门槛与派生节点。
const unlisted=['selection','seed','endingConfirmed','refSource'];

test('every node catalog row maps to configuration and no configuration invents a row',()=>{
 const rows=new Set(firstColumn('## 节点目录'));
 const used=new Set(Object.values(nodes).map(n=>n.specRow).filter(Boolean));
 assert.deepEqual([...rows].filter(r=>!used.has(r)),[],'rows without configuration');
 assert.deepEqual([...used].filter(r=>!rows.has(r)),[],'configuration rows missing from the spec');
 assert.deepEqual(Object.entries(nodes).filter(([,n])=>n.specRow===null).map(([id])=>id).sort(),[...unlisted].sort());
});

test('every call contract row maps to exactly one call',()=>{
 const rows=firstColumn('## 调用契约');
 const used=Object.values(calls).map(c=>c.specRow);
 assert.deepEqual([...rows].sort(),[...used].sort());
});

test('nodes and calls reference each other consistently',()=>{
 for(const [id,node] of Object.entries(nodes)){
  if(node.kind==='model'){
   assert.ok(node.call&&calls[node.call],`${id} has no call`);
   assert.ok(calls[node.call].produces.includes(id),`${node.call} does not produce ${id}`);
  }else assert.equal(node.call,undefined,`${id} is not model-produced`);
 }
 for(const [id,call] of Object.entries(calls))for(const produced of call.produces)assert.ok(nodes[produced],`${id} produces unknown ${produced}`);
});

test('every model node\'s hard and check inputs match the call that produces it',()=>{
 for(const [id,node] of Object.entries(nodes)){
  if(node.kind!=='model'||node.call==='review')continue;
  const call=calls[node.call];
  assert.deepEqual([...call.bound].sort(),[...node.hard].sort(),`${id} hard inputs differ from ${node.call}`);
  assert.deepEqual([...(call.check||[])].sort(),[...(node.check||[])].sort(),`${id} check inputs differ from ${node.call}`);
 }
});

test('input references only name known nodes or selectors',()=>{
 const special=new Set(['order','reference']);
 const refs=[...Object.values(nodes).flatMap(n=>[...n.hard,...(n.check||[])])];
 for(const ref of refs){
  const name=ref.split('@')[0];
  assert.ok(nodes[name]||special.has(name),`unknown input ${ref}`);
 }
});

test('every numbered specification scenario has exactly one individual acceptance case',()=>{
 const scenarios=spec.slice(spec.indexOf('## 实现后的验收场景'));
 const expected=[...scenarios.matchAll(/^(\d+)\. /gm)].map(([,number])=>number);
 const audit=readFileSync(new URL('../.docs/tests/test-data-driven-production-dag.md',import.meta.url),'utf8');
 assert.ok(expected.length>0);
 assert.deepEqual(firstColumn('## 逐场景路径与验收',audit),expected);
});

test('declared dependencies and gates have no cycle outside specific frame references',()=>{
 const gates={preparing:[],confirmed:[],brief:['brief'],characters:['characters'],review:['frameCheck','ending','scene','visual'],approved:['frameCheck','frameVerdict','narrativeVerdict']};
 const aliases={order:[],reference:['refSource']};
 const visited=new Set(),visiting=new Set();
 function visit(key){
  if(visited.has(key))return;
  assert.ok(!visiting.has(key),`cycle: ${[...visiting,key].join(' → ')}`);
  visiting.add(key);
  const node=nodes[key];
  const refs=[...node.hard,...(node.check??[])];
  const edges=refs.flatMap(ref=>{const name=ref.split('@')[0];return aliases[name]??[name];});
  edges.push(...(gates[node.gate]??[]));
  for(const dependency of edges)visit(dependency);
  visiting.delete(key);
  visited.add(key);
 }
 // 同节点的首幅引用按画幅实例展开，由执行层首幅及后续画幅的测试验证。
 for(const key of Object.keys(nodes))visit(key);
});
