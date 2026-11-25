// 核对制作规范与节点、调用配置，并验证每个历史验收编号在 Test Manager 中仍有可寻址的归宿。
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

test('all 59 DAG scenarios resolve to managed cases or an explicit historical decision', () => {
 const suite = readFileSync(new URL('../.tests/story-lifecycle/SUITE.md', import.meta.url), 'utf8');
 const cases = readFileSync(new URL('../.tests/story-lifecycle/CASES.md', import.meta.url), 'utf8');
 const managed = new Map();
 for (const section of cases.split(/^## STORY-LIFECYCLE-C/m).slice(1)) {
  const id = section.match(/^(\d{3}) — /)?.[1];
  const anchor = section.match(/^<a id="case-c(\d{3})"><\/a>$/m)?.[1];
  if (!anchor) continue;
  assert.equal(anchor, id, 'case anchor must belong to its heading');
  assert.ok(!managed.has(id), `duplicate case anchor C${id}`);
  managed.set(id, section);
 }
 assert.ok(spec.includes('](../.tests/story-lifecycle/SUITE.md#制作-dag-验收索引)'), 'spec must route to the managed catalog');
 const table = suite.split(/^## 制作 DAG 验收索引$/m)[1]?.split(/^## /m)[0];
 assert.ok(table, 'missing DAG acceptance index');
 const numbers = [];
 const retired = new Set([32, 39, 44, 45, 46, 51, 53, 54]);
 for (const row of table.split('\n').filter(line => line.startsWith('| ')).slice(2)) {
  const [, number, title, status, refs] = row.split('|').map(cell => cell.trim());
  const target = number.match(/^<a id="dag-(\d+)"><\/a>(\d+)$/);
  assert.ok(target && target[1] === target[2], `bad scenario anchor: ${number}`);
  const id = Number(target[1]);
  numbers.push(id);
  assert.ok(title, `missing title for DAG ${id}`);
  if (retired.has(id) || id === 27) {
   assert.equal(status, retired.has(id) ? '已删除' : '不提供');
   assert.ok(refs.includes('[旧核查](') && refs.includes(status === '已删除' ? '[取消依据](' : '[现行场景矩阵]('), `missing disposition for DAG ${id}`);
   continue;
  }
  assert.ok(['现行', '部分入口待核', '待复验'].includes(status), `unknown disposition for DAG ${id}`);
  const links = [...refs.matchAll(/\[C(\d{3})\]\(([^)]+)\)/g)];
  assert.ok(links.length, `missing managed case for DAG ${id}`);
  for (const [index, [, caseId, href]] of links.entries()) {
   assert.equal(href, `CASES.md#case-c${caseId}`);
   const section = managed.get(caseId);
   assert.ok(section, `unknown managed case C${caseId} for DAG ${id}`);
   assert.doesNotMatch(section, /^- State: RETIRED$/m, `retired case referenced by DAG ${id}`);
   if (index === 0) {
    const risk = section.match(/^- Requirement \/ Risk: .*?DAG(?: 场景)? ([\d、, ]+)/m)?.[1] ?? '';
    assert.ok(risk.split(/[^\d]+/).includes(String(id)), `primary case C${caseId} does not cover DAG ${id}`);
   }
  }
 }
 assert.deepEqual(numbers, Array.from({length: 59}, (_, index) => index + 1), 'expected each legacy DAG number once in order');
});

test('the project runner prompt includes every branch and its evidence requirements', () => {
 const template = readFileSync(new URL('../.tests/RUNNER_PROMPT.md', import.meta.url), 'utf8');
 for (const field of ['Preconditions', 'Test Data', 'Expected Outcome', 'Negative Assertions', 'Evidence Required']) {
  const projection = template.match(new RegExp(`{{\\s*${field}\\s*(?:\\|\\s*(\\w+)\\s*)?}}`));
  assert.ok(projection && projection[1] !== 'first', `runner must include all lines of ${field}`);
 }
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
