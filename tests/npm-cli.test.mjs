// Check public CLI inputs and platform data paths without touching a user's real library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runCli} from '../server/cli.ts';
import {parseCliOptions, cliConfiguration} from '../server/cli-options.ts';

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

test('CLI flags override environment and relative data paths use the launch directory', () => {
  const variables = {PORT:'3200', SHIQU_BIND_IP:'0.0.0.0', SHIQU_DATA_DIR:'env shelf', GEMINI_API_KEY:'preserved'};
  const context = {variables, platform:'linux', home:'/home/reader', cwd:'/launch folder'};
  const configured = cliConfiguration(parseCliOptions(['--port=3300','--host=127.0.0.1','--data-dir=../saved shelf']), context);
  assert.equal(configured.PORT, '3300'); assert.equal(configured.SHIQU_BIND_IP, '127.0.0.1');
  assert.equal(configured.SHIQU_DATA_DIR, '/saved shelf'); assert.equal(configured.GEMINI_API_KEY, 'preserved');
  assert.equal(variables.SHIQU_DATA_DIR, 'env shelf');
  assert.equal(cliConfiguration({}, context).SHIQU_DATA_DIR, '/launch folder/env shelf');
});

test('CLI default library stays outside working directories and npm caches on every platform', () => {
  const config = (platform, home, variables = {}, cwd = '/unrelated') => cliConfiguration({}, {platform, home, variables, cwd});
  const linux = config('linux', '/home/reader');
  assert.equal(linux.PORT, '3000'); assert.equal(linux.SHIQU_BIND_IP, '127.0.0.1');
  assert.equal(linux.SHIQU_DATA_DIR, '/home/reader/.local/share/shiqu/library');
  assert.equal(config('linux','/home/reader',{XDG_DATA_HOME:'/data'}).SHIQU_DATA_DIR, '/data/shiqu/library');
  assert.equal(config('linux','/home/reader',{XDG_DATA_HOME:'relative'}).SHIQU_DATA_DIR, linux.SHIQU_DATA_DIR);
  assert.equal(config('darwin','/Users/reader').SHIQU_DATA_DIR, '/Users/reader/Library/Application Support/shiqu/library');
  assert.equal(config('win32','C:\\Users\\reader',{LOCALAPPDATA:'D:\\Local'},'C:\\launch').SHIQU_DATA_DIR, 'D:\\Local\\shiqu\\library');
  assert.equal(config('win32','C:\\Users\\reader',{},'C:\\launch').SHIQU_DATA_DIR, 'C:\\Users\\reader\\AppData\\Local\\shiqu\\library');
  assert.equal(cliConfiguration({dataDirectory:'..\\shelf'}, {platform:'win32',home:'C:\\Users\\reader',cwd:'C:\\launch',variables:{}}).SHIQU_DATA_DIR, 'C:\\shelf');
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
    assert.deepEqual(await readdir(directory), []);
    const root = path.resolve(import.meta.dirname, '..');
    await runCli(root, ['-v','--config',path.join(directory,'missing.env')]);
    assert.equal(output[1], JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version);
    assert.deepEqual(await readdir(directory), []);
  } finally { console.log = log; }
});
