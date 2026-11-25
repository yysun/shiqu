import test from 'node:test';
import assert from 'node:assert/strict';
import {productionFixture, until} from '../../../../tests/fixtures/production.mjs';
import {completedStory} from '../../../../tests/fixtures/production-dag-story.mjs';

const landscape = id => `sessions/${id}/landscape`;

async function startPrint(f, id) {
  const route = landscape(id);
  const {startToken} = await f.json(route);
  return f.json(route, 'POST', {startToken});
}

async function revise(f, id, changes) {
  const route = `sessions/${id}/revisions`;
  const {token} = await f.json(route);
  const child = crypto.randomUUID();
  await f.json(route, 'POST', {requestId: child, token, changes});
  if ((await f.read(child)).lifecycle.continuation) {
    await f.json(`sessions/${child}/production-control`, 'POST', {action: 'continue'});
  }
  return child;
}

async function settle(f) {
  for (let i = 0; i < 4; i++) {
    await f.app.services.production.tick();
    await f.app.services.production.queue.settle();
  }
}

test('C033 deleting the visible revision stops new landscape sends for that story', async t => {
  const f = await productionFixture(t);
  const {id} = await completedStory(f, {length: 4});
  await startPrint(f, id);
  await until(() => f.control.calls.length === 1);
  const child = await revise(f, id, {acceptancePrompt: '核对画面动作。'});
  await until(async () => (await f.read(child)).state === 'completed');
  assert.deepEqual((await f.json('library/shelf')).map(item => item.id), [child]);
  assert.equal((await f.json(landscape(child))).earlier[0].storyId, id);
  await f.json('library/' + child, 'DELETE');
  assert.equal((await f.json('library/shelf')).length, 0);
  f.control.hold = false;
  f.control.calls[0].resolve();
  await settle(f);
  assert.deepEqual(f.control.calls.filter(call => call.landscape).map(call => call.page + 1), [1]);
});

test('C034 a reader can recover or replace a print whose saved model is unavailable', async t => {
  const f = await productionFixture(t);
  const first = {provider: 'codex', models: {text: 'A', image: 'image-A'}};
  const second = {provider: 'codex', models: {text: 'B', image: 'image-B'}};
  let current = first;
  let firstAvailable = true;
  f.options.production = {snapshots: {
    current: () => current,
    provider: key => key.models.image === first.models.image && !firstAvailable ? null : f.generation,
  }};
  await f.restart();
  f.control.hold = true;
  const {id} = await completedStory(f, {length: 4});
  const route = landscape(id);
  const print = await startPrint(f, id);
  await until(() => f.control.calls.length === 1);
  await f.json(route, 'POST', {control: 'pause', printId: print.printId});
  current = second;
  firstAvailable = false;
  f.control.hold = false;
  f.control.calls[0].resolve();
  await settle(f);
  assert.equal((await f.json(route)).service, 'snapshot-unavailable');
  const blocked = await f.json(route);
  let resumed;
  if (blocked.modelToken) {
    await f.json(route, 'POST', {modelToken: blocked.modelToken});
    resumed = await f.request(route, 'POST', {control: 'resume', printId: print.printId});
    assert.equal(resumed.status, 202);
    await settle(f);
  } else {
    resumed = await f.request(route, 'POST', {control: 'resume', printId: print.printId});
    const session = await f.read(id);
    if (session.lifecycle.actions.some(action => action.event === 'apply-model')) {
      await f.json(`sessions/${id}/production-control`, 'POST', {action: 'apply-model'});
    }
  }
  await f.restart();
  await settle(f);
  const status = await f.json(route);
  t.diagnostic(JSON.stringify({resume: resumed.status, service: status.service, ready: status.ready, controlAction: status.controlAction}));
  assert.ok(status.ready === 4 || status.startToken || status.retryToken, 'Blocked print needs a working recovery or replacement action');
});

test('C035 a control from an earlier print leaves portrait production in the new revision active', async t => {
  const f = await productionFixture(t);
  const {id} = await completedStory(f, {length: 4});
  f.control.hold = false;
  const original = await startPrint(f, id);
  await until(async () => (await f.json(landscape(id))).state === 'completed');
  f.control.hold = true;
  const child = await revise(f, id, {artStyle: 'watercolor'});
  await until(() => f.control.calls.some(call => !call.landscape && !call.done));
  assert.equal((await f.json(landscape(child))).printId, undefined);
  const response = await f.request(landscape(child), 'POST', {control: 'pause', printId: original.printId});
  assert.deepEqual([response.status, (await f.read(child)).lifecycle.control], [409, 'active']);
});
