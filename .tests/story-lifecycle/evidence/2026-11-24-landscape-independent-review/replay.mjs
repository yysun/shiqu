import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const fromRoot = file => import(pathToFileURL(resolve(file)).href);
const {productionFixture, until} = await fromRoot('tests/fixtures/production.mjs');
const {completedStory, saved, savedSelection} = await fromRoot('tests/fixtures/production-dag-story.mjs');
const {evaluate} = await fromRoot('lib/production-dag/engine.ts');
const {stateOf} = await fromRoot('lib/production-dag/runner.ts');
const {readableLandscapeImage, readableImage} = await fromRoot('server/reader-image-health.ts');
const {referenceImageKey} = await fromRoot('lib/reader-image-assets.ts');
const {createStoryPdf} = await fromRoot('lib/reader-pdf.ts');
const {nativeExportRuntime} = await fromRoot('server/story-export.ts');
const {createCanvas} = createRequire(resolve('package.json'))('@napi-rs/canvas');

async function settle(f) {
  for (let i = 0; i < 10; i++) {
    await f.app.services.production.tick();
    await f.app.services.production.queue.settle();
  }
}
async function revise(f, id, changes) {
  const route = 'sessions/' + id + '/revisions';
  const {token} = await f.json(route);
  const child = crypto.randomUUID();
  await f.json(route, 'POST', {requestId: child, token, changes});
  if ((await f.read(child)).lifecycle.continuation) {
    await f.json('sessions/' + child + '/production-control', 'POST', {action: 'continue'});
  }
  return child;
}
const landscapeRoute = id => 'sessions/' + id + '/landscape';
async function startLandscapes(f, id) {
  const route = landscapeRoute(id);
  const {startToken} = await f.json(route);
  await f.json(route, 'POST', {startToken});
}
function landscapeView(s) {
  return {state: s.state, ready: s.ready, total: s.total, failed: s.failed, retry: !!s.retryToken};
}
async function styleRevision(f) {
  f.control.hold = false;
  const id = await f.create(4);
  await until(async () => (await f.read(id)).state === 'completed');
  await startLandscapes(f, id);
  await until(async () => (await f.json(landscapeRoute(id))).ready === 4);
  await settle(f);
  const parent = await saved(f, id);
  const count = f.control.calls.length;
  const canvas = createCanvas(96, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'blue';
  ctx.fillRect(0, 0, 96, 64);
  f.control.beforeImage = call => {
    f.control.hold = call.landscape;
    if (call.landscape) call.bytes = canvas.toBuffer('image/png').toString('base64');
  };
  try {
    const child = await revise(f, id, {artStyle: 'watercolor'});
    await until(async () => (await f.read(child)).state === 'completed', 20000);
    await f.app.services.production.tick();
    const session = await f.read(child);
    const status = await f.json(landscapeRoute(child));
    const doc = await saved(f, child);
    const selection = await savedSelection(f, child);
    const evaluation = evaluate(stateOf({id: child, doc, dag: doc.dag, selection, confirmed: true, faults: []}));
    const validity = doc.dag.order.map(key => evaluation.instance('landscape', key)?.status ?? 'unrequested');
    async function bytes(story, url) {
      const file = await f.media.get(referenceImageKey(story, url));
      return Buffer.from(await file.arrayBuffer());
    }
    const matchesParent = await Promise.all(status.images.map(async (url, i) => {
      if (!url) return false;
      return (await bytes(child, url)).equals(await bytes(id, parent.dag.frames[parent.dag.order[i]].landscape));
    }));
    const pdfPagesUsingOldImages = new Set();
    let pdfBytes = 0;
    if (status.state === 'completed' && status.images.length === session.story.pages.length && status.images.every(Boolean)) {
      const runtime = nativeExportRuntime(process.cwd(), f.app);
      const read = runtime.read;
      runtime.read = async (source, page) => {
        const index = status.images.indexOf(source);
        if (index >= 0 && matchesParent[index]) pdfPagesUsingOldImages.add(index + 1);
        return read(source, page);
      };
      const pdf = await createStoryPdf(session.story, () => {}, runtime, 'landscape', status.images);
      pdfBytes = pdf.length;
    }
    const waiting = f.control.calls.slice(count).filter(call => call.landscape && !call.done).map(call => call.page + 1).sort();
    return {status: landscapeView(status), validity, matchesParent, waiting, pdfBytes, pdfPagesUsingOldImages: [...pdfPagesUsingOldImages].sort()};
  } finally {
    f.control.beforeImage = null;
    f.control.hold = false;
    for (const call of f.control.calls) call.resolve();
    await settle(f);
  }
}
async function genericRecovery(f) {
  const {id} = await completedStory(f, {length: 4});
  f.control.hold = false;
  const original = f.generation.generator.bind(f.generation);
  f.generation.generator = () => {
    const gen = original();
    return {...gen, async image(...args) {
      if (args[1] === 2) throw Error('CONTENT_BLOCKED');
      return gen.image(...args);
    }};
  };
  await startLandscapes(f, id);
  await until(async () => (await f.json(landscapeRoute(id))).failed.includes(3));
  await settle(f);
  f.generation.generator = original;
  const child = await revise(f, id, {acceptancePrompt: '核对画面动作。'});
  await settle(f);
  await f.restart();
  await settle(f);
  const before = await f.json(landscapeRoute(child));
  const fault = (await f.read(child)).lifecycle.faults.find(fault => fault.scope === 'optional');
  const response = await f.request('sessions/' + child + '/recover', 'POST', {requestId: crypto.randomUUID(), faultId: fault.id});
  const reply = await response.json();
  await settle(f);
  await f.restart();
  await settle(f);
  const jobs = await f.app.services.production.queue.jobs(child, 'docker-local-owner');
  return {before: landscapeView(before), status: response.status, receipt: reply.recoveryReceipt?.status,
    afterRestart: landscapeView(await f.json(landscapeRoute(child))), activeJobs: jobs.filter(j => ['queued', 'running'].includes(j.state)).length};
}
async function offlineReceipt(f, landscape) {
  const id = landscape ? (await completedStory(f, {length: 4})).id : await f.create(2);
  const page = landscape ? 2 : 1;
  const route = landscapeRoute(id);
  const media = f.app.services.media;
  const get = media.get.bind(media);
  let missing = true;
  media.get = key => missing && key.startsWith('reader/' + id + '/artifacts/' + page + '-') ? null : get(key);
  f.control.hold = false;
  for (const call of f.control.calls) call.resolve();
  if (landscape) {
    await startLandscapes(f, id);
    await until(async () => (await f.json(route)).failed.includes(3));
  } else {
    await until(async () => (await f.read(id)).state === 'failed');
  }
  await settle(f);
  missing = false;
  const jobs = await f.app.services.production.queue.jobs(id, 'docker-local-owner');
  const receipt = jobs.map(j => JSON.parse(j.payload)).find(p => p.page === page && p.paid && p.work?.call === (landscape ? 'drawLandscape' : 'draw'));
  const blob = await get(referenceImageKey(id, receipt.paid.value));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const readable = await (landscape ? readableLandscapeImage : readableImage)(bytes);
  const originalOptions = f.options.production;
  const originalStatus = f.generation.status;
  const token = landscape && (await f.json(route)).retryToken;
  const calls = f.control.calls.length;
  f.options.production = {autoStart: false, snapshots: {current: () => undefined, provider: () => null}};
  await f.restart();
  f.generation.status = async () => ({configured: false, message: '受控未配置'});
  const session = await f.read(id);
  const action = landscape ? 'retry-landscape' : 'retry';
  const offered = session.lifecycle.actions.some(a => a.event === action);
  const fault = session.lifecycle.faults.find(fault => fault.targets.some(t => t.page === page));
  const command = () => f.request('sessions/' + id + '/recover', 'POST', {requestId: crypto.randomUUID(), faultId: fault.id});
  const response = landscape ? await f.request(route, 'POST', {retryToken: token}) : await command();
  await settle(f);
  const readiness = async () => landscape ? (await f.json(route)).ready : (await f.read(id)).ready;
  const offlineReady = await readiness();
  const total = landscape ? 4 : 2;
  f.options.production = originalOptions;
  f.generation.status = originalStatus;
  await f.restart();
  if (offlineReady !== total) {
    if (landscape) await f.json(route, 'POST', {retryToken: (await f.json(route)).retryToken});
    else await command();
  }
  await until(async () => (await readiness()) === total);
  return {readable, offered, offlineStatus: response.status, offlineReady, total, reconnectedReady: await readiness(), extraDraws: f.control.calls.length - calls};
}

const cases = [
  ['styleRevision', styleRevision, result => ({
    C029: result.status.ready === result.validity.filter(v => v === 'valid').length && !result.pdfPagesUsingOldImages.length,
    C032: !result.waiting.length,
  })],
  ['genericRecovery', genericRecovery, result => ({
    C030: result.afterRestart.ready === 4 || (result.status >= 400 && result.afterRestart.retry),
  })],
  ...[false, true].map(landscape => [landscape ? 'offlineLandscape' : 'offlinePortrait',
    f => offlineReceipt(f, landscape), r => ({C031: r.readable && r.offered && r.offlineReady === r.total && !r.extraDraws})]),
];
for (const [name, run, check] of cases) {
  const f = await productionFixture();
  try {
    const result = await run(f);
    const checks = check(result);
    console.log(JSON.stringify({name, checks, result}));
    if (Object.values(checks).includes(false)) process.exitCode = 1;
  } finally {
    await f.stop();
    await rm(f.root, {recursive: true, force: true});
  }
}
