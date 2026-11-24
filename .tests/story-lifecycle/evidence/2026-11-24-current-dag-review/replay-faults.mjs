// 从待核对的源码根目录运行，两个用例分别创建独立的临时书库。
import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fixture = name => import(pathToFileURL(resolve('tests/fixtures', name)).href);
const {productionFixture, until} = await fixture('production.mjs');
const {confirmedStory} = await fixture('production-dag-story.mjs');

const scenarios = [
  {call: 'visual', changes: {acceptancePrompt: '另一条。'}, count: 4},
  {call: 'registerItems', changes: {artStyle: 'watercolor'}, count: 2},
];

for (const {call, changes, count} of scenarios) {
  test(`an unrelated revision preserves every failed ${call} target`, async t => {
    const f = await productionFixture(t);
    f.control.hold = false;
    f.control.beforeText = async name => {
      if (name === call) throw Error('受控步骤故障');
    };
    const id = await confirmedStory(f, 4, {}, {acceptancePrompt: '第一条要求。\n第二条要求。'});
    f.app.services.production.wake();
    await until(async () => (await f.read(id)).state === 'failed', 20000);
    const parentTargets = (await f.read(id)).lifecycle.faults.flatMap(fault => fault.targets);
    assert.equal(parentTargets.length, count);

    const route = 'sessions/' + id;
    await f.json(route + '/production-control', 'POST', {action: 'pause'});
    const {token} = await f.json(route + '/revisions');
    const preview = await f.json(route + '/revisions/preview', 'POST', {token, changes});
    const child = crypto.randomUUID();
    await f.json(route + '/revisions', 'POST', {requestId: child, token, changes});
    const childTargets = (await f.read(child)).lifecycle.faults.flatMap(fault => fault.targets);
    t.diagnostic(JSON.stringify({carriedFaults: preview.carriedFaults, parentTargets, childTargets}));
    // 先让新版通过普通继续推进，再判定目标，便于复现故障消失后被再次派发的工作。
    const calls = () => f.control.dagCalls.filter(name => name === call).length;
    const before = calls();
    f.control.beforeText = null;
    await f.json('sessions/' + child + '/production-control', 'POST', {action: 'continue'});
    for (let n = 0; n < 8; n++) {
      await f.app.services.production.tick();
      await f.app.services.production.queue.settle();
    }
    const current = await f.read(child);
    t.diagnostic(JSON.stringify({extraCalls: calls() - before, state: current.state, ready: current.ready}));
    assert.deepEqual(childTargets.map(target => target.key).sort(), parentTargets.map(target => target.key).sort());
    assert.equal(calls(), before, '普通继续不能重新派发故障目标');
  });
}
