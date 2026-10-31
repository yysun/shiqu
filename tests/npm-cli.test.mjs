// Check public CLI inputs and platform data paths without touching a user's real library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runCli} from '../server/cli.ts';
import {parseCliOptions, cliConfiguration} from '../server/cli-options.ts';
import {desktopLibraryPaths} from '../server/library-directory.ts';
import {phoneUrls} from '../server/phone-access.ts';
import {startupFixture, freeStartupPort, startFixtureCli} from './fixtures/startup.mjs';

test('CLI accepts named options, equals syntax, and help/version aliases', () => {
  assert.deepEqual(parseCliOptions(['--port','3100','--host=0.0.0.0','--data-dir','../my shelf','--config=./private.env']), {
    port:'3100', host:'0.0.0.0', dataDirectory:'../my shelf', envFile:'./private.env',
  });
  assert.deepEqual(parseCliOptions(['-h']), {help:true});
  assert.deepEqual(parseCliOptions(['--version']), {version:true});
  for (const args of [['--wat'],['story'],['toString'],['--port'],['--host='],['--data-dir','--port'],['--host','-h'],['--config']]) assert.throws(()=>parseCliOptions(args));
  for (const value of ['0','65536','-1','1.5','NaN','3e3','']) assert.throws(()=>parseCliOptions(['--port='+value]), /port/);
  assert.equal(parseCliOptions(['--port=65535']).port, '65535');
});

test('CLI flags override environment and relative data paths use the launch directory', async () => {
  const variables = {PORT:'3200', SHIQU_BIND_IP:'0.0.0.0', SHIQU_DATA_DIR:'env shelf', GEMINI_API_KEY:'preserved'};
  const context = {variables, platform:'linux', home:'/home/reader', cwd:'/launch folder'};
  const configured = await cliConfiguration(parseCliOptions(['--port=3300','--host=127.0.0.1','--data-dir=../saved shelf']), context);
  assert.equal(configured.PORT, '3300'); assert.equal(configured.SHIQU_BIND_IP, '127.0.0.1');
  assert.equal(configured.SHIQU_DATA_DIR, '/saved shelf'); assert.equal(configured.GEMINI_API_KEY, 'preserved');
  assert.equal(variables.SHIQU_DATA_DIR, 'env shelf');
  assert.equal((await cliConfiguration({}, context)).SHIQU_DATA_DIR, '/launch folder/env shelf');
});

test('CLI defaults to LAN access and respects an explicit loopback environment', async () => {
  const context = {variables:{SHIQU_DATA_DIR:'shelf'}, platform:'linux', home:'/home/reader', cwd:'/launch'};
  assert.equal((await cliConfiguration({}, context)).SHIQU_BIND_IP, '0.0.0.0');
  assert.equal((await cliConfiguration({}, {...context, variables:{...context.variables, SHIQU_BIND_IP:'127.0.0.1'}})).SHIQU_BIND_IP, '127.0.0.1');
});

for (const localOnly of [false, true]) test(`CLI startup serves the reader and prints phone QR codes only for LAN access (localOnly=${localOnly})`, {timeout:20000}, async t => {
  const f = await startupFixture(t), port = await freeStartupPort();
  const run = startFixtureCli(f, ['--port',String(port),'--data-dir',path.join(f.root,'shelf'),...(localOnly ? ['--host','127.0.0.1'] : [])], {SHIQU_AI_PROVIDER:'readonly'});
  await run.ready();
  const response = await fetch(`http://127.0.0.1:${port}`, {signal:AbortSignal.timeout(5000)});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /isolated startup fixture/);
  const urls = phoneUrls(localOnly ? '127.0.0.1' : '0.0.0.0', port);
  if (urls.length) {
    assert.match(run.output(), /Scan to open 拾趣 on your phone/);
    assert.match(run.output(), /[▀▄█]/);
    for (const url of urls) assert.ok(run.output().includes(url));
    assert.equal((await fetch(urls[0]+'/api/stories', {signal:AbortSignal.timeout(5000)})).status, 200);
  } else {
    assert.doesNotMatch(run.output(), /Scan to open 拾趣 on your phone|[▀▄█]/);
  }
});

test('CLI suggestions use the desktop app-data paths on every platform', () => {
  const location = (platform, home, variables = {}) => desktopLibraryPaths({platform, home, variables});
  assert.equal(location('linux','/home/reader').library, '/home/reader/.local/share/com.shiqu.desktop/library');
  assert.equal(location('linux','/home/reader',{XDG_DATA_HOME:'/data'}).library, '/data/com.shiqu.desktop/library');
  assert.equal(location('linux','/home/reader',{XDG_DATA_HOME:'relative',XDG_CONFIG_HOME:'relative'}).library, '/home/reader/.local/share/com.shiqu.desktop/library');
  assert.equal(location('darwin','/Users/reader').library, '/Users/reader/Library/Application Support/com.shiqu.desktop/library');
  assert.equal(location('win32','C:\\Users\\reader',{APPDATA:'D:\\Roaming'}).library, 'D:\\Roaming\\com.shiqu.desktop\\library');
  assert.equal(location('win32','C:\\Users\\reader').library, 'C:\\Users\\reader\\AppData\\Roaming\\com.shiqu.desktop\\library');
});

test('help and version do not load an env file, initialize SQLite, or create a library', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shiqu cli help '));
  t.after(()=>rm(directory, {recursive:true, force:true}));
  const output = [], log = console.log;
  await assert.rejects(runCli(directory, ['--config',path.join(directory,'missing.env')]), /ENOENT/);
  console.log = message=>output.push(message);
  try {
    await runCli(directory, ['--help','--config',path.join(directory,'missing.env'),'--data-dir',directory]);
    assert.match(output[0], /Usage: shiqu/);
    assert.match(output[0], /SHIQU_BIND_IP, default: 0\.0\.0\.0/);
    assert.match(output[0], /--host 127\.0\.0\.1 for local-only access/);
    assert.deepEqual(await readdir(directory), []);
    const root = path.resolve(import.meta.dirname, '..');
    await runCli(root, ['-v','--config',path.join(directory,'missing.env')]);
    assert.equal(output[1], JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version);
    assert.deepEqual(await readdir(directory), []);
  } finally { console.log = log; }
});
