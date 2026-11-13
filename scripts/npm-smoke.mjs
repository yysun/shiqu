// Install the real release outside the checkout and exercise its HTTP, assets, persistence, and exit behavior.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {get} from 'node:http';
import {cp,lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {productionFixture,selection} from '../tests/fixtures/production.mjs';
import {libraryFixture} from '../tests/fixtures/story-library.mjs';
import {withLocalBooks} from '../server/local-generation.ts';
import {executeHeadless} from '../server/headless-cli.ts';
import os from 'node:os';
import {SystemSettingsStore} from '../server/system-settings.ts';
import {emptyPublication} from '../lib/story-publication.ts';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.versions.node.split('.')[0], '24', 'Run npm smoke checks with Node 24.');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageName = source.publishConfig.name;
const args = process.argv.slice(2).filter(value=>value !== '--');
const requested = args.find(value=>value !== '--offline');
const archive = requested ? path.resolve(requested) : path.join(root, 'outputs/npm', packageName.replace(/^@/, '').replace('/', '-') + '-' + source.version + '.tgz');
await lstat(archive);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiqu installed npm '));
const installation = path.join(temporary, 'installation'), cwd = path.join(temporary, 'unrelated working directory'), home = path.join(temporary, 'user home');
let child, logs = '';
async function files(directory, prefix = '', installed = false) {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    // pnpm may create dependency bin shims inside the installed package; they are not tarball files.
    if (installed && !prefix && name === 'node_modules') continue;
    const relative = prefix ? prefix + '/' + name : name, filename = path.join(directory, name), info = await lstat(filename);
    assert.ok(!info.isSymbolicLink(), 'Unexpected payload symlink: ' + relative);
    if (info.isDirectory()) entries.push(...await files(filename, relative, installed));
    else entries.push([relative, createHash('sha256').update(await readFile(filename)).digest('hex')]);
  }
  return entries;
}
function pnpm(arguments_) {
  const executable = process.env.npm_execpath;
  assert.ok(executable, 'Run with pnpm npm:smoke.');
  const javascript = /\.[cm]?js$/.test(executable);
  const result = spawnSync(javascript ? process.execPath : executable, [...(javascript ? [executable] : []), ...arguments_], {cwd:temporary, stdio:'inherit'});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Isolated pnpm installation failed.');
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve=>server.close(resolve)); return port;
}
const runtimeEnv = {
  PATH:[path.dirname(process.execPath), ...(process.platform === 'win32' ? [path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')] : ['/usr/bin','/bin'])].join(path.delimiter),
  HOME:home, USERPROFILE:home, LOCALAPPDATA:path.join(home, 'local'), APPDATA:path.join(home, 'roaming'),
  XDG_DATA_HOME:path.join(home, 'xdg'), SYSTEMROOT:process.env.SYSTEMROOT || '', SHIQU_AI_PROVIDER:'readonly',
};
function command(bin, parameters) {
  return spawnSync(process.execPath, [bin, ...parameters], {cwd, env:runtimeEnv, encoding:'utf8', timeout:10000});
}
async function start(bin, parameters, env = {}) {
  logs = '';
  child = spawn(process.execPath, [bin, ...parameters], {cwd, env:{...runtimeEnv, ...env}, stdio:['ignore','pipe','pipe']});
  const running = child;
  await new Promise((resolve, reject)=>{
    const timer = setTimeout(()=>reject(Error('Installed CLI did not start: ' + logs)), 15000);
    const ready = data=>{logs += data; if (/拾趣: http:\/\//.test(logs)) { clearTimeout(timer); resolve(); }};
    running.stdout.on('data', ready); running.stderr.on('data', data=>{logs += data;});
    running.once('error', error=>{clearTimeout(timer); reject(error);});
    running.once('exit', code=>{clearTimeout(timer); reject(Error(`Installed CLI exited (${code}): ${logs}`));});
  });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const running = child, exited = once(running, 'exit'); running.kill('SIGTERM');
  const timer = setTimeout(()=>running.kill('SIGKILL'), 10000);
  try {
    const [code, signal] = await exited;
    // Windows child.kill terminates directly; the following restart still verifies SQLite recovery.
    if (process.platform !== 'win32' || signal !== 'SIGTERM') assert.equal(code, 0, `Unclean exit (${signal}): ${logs}`);
  }
  finally { clearTimeout(timer); }
}
async function request(url, options = {}) { return fetch(url, {...options, signal:AbortSignal.timeout(5000)}); }

try {
  const listed = spawnSync('tar', ['-tzf', archive], {encoding:'utf8', maxBuffer:4 * 1024 * 1024});
  if (listed.error) throw listed.error;
  assert.equal(listed.status, 0, listed.stderr);
  const packedFiles = listed.stdout.trim().split('\n').filter(file=>!file.endsWith('/')).map(file=>{
    assert.ok(file.startsWith('package/') && !file.split('/').includes('..'), 'Unsafe tarball entry: ' + file);
    return file.slice('package/'.length);
  }).sort();
  for (const directory of [installation, cwd, home]) await mkdir(directory, {recursive:true});
  await writeFile(path.join(installation, 'package.json'), JSON.stringify({private:true, type:'module', packageManager:source.packageManager}));
  pnpm(['--dir', installation, 'add', '--prod', '--ignore-scripts', '--fetch-retries=0', ...(args.includes('--offline') ? ['--offline'] : []), archive]);
  const installed = await realpath(path.join(installation, 'node_modules', ...packageName.split('/')));
  assert.ok(!installed.startsWith(root), 'Must install outside the checkout.');
  const payload = await files(installed, '', true), manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(payload.map(([file])=>file).sort(), packedFiles, 'Inspect the tarball itself, excluding installer-created dependency shims.');
  assert.equal(manifest.name, packageName); assert.equal(manifest.version, source.version); assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.engines, source.engines); assert.equal(manifest.bin.shiqu, 'bin/shiqu.mjs');
  assert.equal(manifest.scripts, undefined); assert.equal(manifest.devDependencies, undefined);
  for (const [file] of payload) {
    assert.ok(['package.json','README.md','LICENSE','NOTICE','.env.example','bin/shiqu.mjs','dist/server/cli.js','docker/seed.sql'].includes(file) || /^(dist\/client|data\/library|data\/export-fonts|skills\/shiqu)\//.test(file) || /^drizzle\/[^/]+\.sql$/.test(file), 'File outside publication allowlist: ' + file);
    assert.ok(file === '.env.example' || !file.split('/').some(part=>part.startsWith('.')), 'Unexpected hidden file: ' + file);
    assert.ok(!/\.(sqlite(?:-wal|-shm)?|map|pem|tgz)$/.test(file), 'Unexpected private/build file: ' + file);
  }
  const library = await files(path.join(root,'data/library'));
  assert.deepEqual(payload.filter(([file])=>file.startsWith('data/library/')).map(([file,hash])=>[file.slice('data/library/'.length),hash]), library);
  const catalog = JSON.parse(await readFile(path.join(installed,'data/library/catalog.json'),'utf8'));
  assert.equal(catalog.books.length, 24);
  for (const file of ['LICENSE','NOTICE','docker/seed.sql']) assert.deepEqual(await readFile(path.join(installed,file)), await readFile(path.join(root,file)));
  for (const file of (await readdir(path.join(root,'drizzle'))).filter(name=>name.endsWith('.sql'))) assert.deepEqual(await readFile(path.join(installed,'drizzle',file)), await readFile(path.join(root,'drizzle',file)));
  const bin = path.join(installed, manifest.bin.shiqu);
  const tokenizer = spawnSync(process.execPath, ['--input-type=module','-e', "import {get_encoding} from 'tiktoken'; const encoder=get_encoding('cl100k_base'); if(!encoder.encode('拾趣').length)throw Error('Tokenizer failed'); encoder.free();"], {cwd:installed, env:runtimeEnv, encoding:'utf8', timeout:10000});
  assert.equal(tokenizer.status, 0, 'Installed tokenizer WASM: ' + tokenizer.stderr);
  assert.ok((await readFile(bin,'utf8')).startsWith('#!/usr/bin/env node\n'));
  const shim = path.join(installation,'node_modules/.bin', process.platform === 'win32' ? 'shiqu.cmd' : 'shiqu');
  await lstat(shim);
  if (process.platform !== 'win32') {
    const result = spawnSync(shim, ['--version'], {cwd, env:runtimeEnv, encoding:'utf8', timeout:10000});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), source.version);
  }
  assert.equal(command(bin, ['--version']).stdout.trim(), source.version);
  assert.match(command(bin, ['--help']).stdout, /Usage: shiqu/);
  assert.equal(command(bin, ['--version','--config=absent.env']).stdout.trim(), source.version);
  assert.match(command(bin, ['--help','--config=absent.env']).stdout, /Usage: shiqu/);
  for (const parameters of [['--unknown'],['--port'],['--port=0'],['--config=absent.env']]) {
    const result = command(bin, parameters); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /shiqu:/);
  }
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual(await readdir(cwd), []);
  // Exercise the installed bundle, not source wrappers, with a completed story from the production dispatcher.
  function receipt(parameters){const result=command(bin,parameters);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);const saved=JSON.parse(result.stdout);assert.equal(saved.ok,true);return saved.data;}
  assert.ok(receipt(['help','--json']).commands.length>10);
  const searchDirectory=path.join(temporary,'unused search library');
  const found=receipt(['books','search','种梨','聊斋志异','--limit','1','--data-dir',searchDirectory]);
  assert.match(found.results[0]?.excerpt||'',/梨/);
  await assert.rejects(lstat(searchDirectory),{code:'ENOENT'});
  const skill=command(bin,['skill','show']);assert.equal(skill.status,0,skill.stderr);assert.equal(skill.stdout,await readFile(path.join(installed,'skills/shiqu/SKILL.md'),'utf8'));
  const skillInstall=receipt(['skill','install','--scope','project']);assert.equal(await readFile(skillInstall.path,'utf8'),skill.stdout);await rm(path.join(cwd,'.agents'),{recursive:true});const globalSkill=receipt(['skill','install','--scope','global']);assert.equal(globalSkill.path,path.join(home,'.agents/skills/shiqu/SKILL.md'));assert.equal(await readFile(globalSkill.path,'utf8'),skill.stdout);assert.equal(receipt(['skill','install','--scope','global']).unchanged,true);
  const headless=path.join(temporary,'headless library');assert.deepEqual(receipt(['stories','list','--data-dir',headless]),[]);await lstat(path.join(headless,'shiqu.sqlite'));receipt(['init','--data-dir',headless]);
  const fixture=await productionFixture();
  try{
    await fixture.stop();fixture.control.hold=false;const local=libraryFixture();
    fixture.control.beforeText=async(kind)=>kind==='recommend'?{storySummary:local.stories[0].summary,storyMatchReason:'原文支持。'}:undefined;
    const context={generation:withLocalBooks(fixture.generation,local.books,fixture.media),localBooks:local.books,variables:{}};
    const call=(parameters,input)=>executeHeadless(root,[...parameters,'--data-dir',fixture.dataDirectory],{...context,input:input||{}});
    const created=await call(['stories','create','--no-intake'],{...selection,length:3,source:local.stories[0].source,storyTitle:local.stories[0].title});
    assert.equal((await call(['run',created.session.id,'--timeout','20'])).reason,'completed');
    await rm(headless,{recursive:true});await cp(fixture.dataDirectory,headless,{recursive:true});
    receipt(['stories','get',created.session.id,'--data-dir',headless]);
    receipt(['preview',created.session.id,'--data-dir',headless,'--output',path.join(temporary,'preview.html')]);
    for(const format of ['zip','pdf','png']){const result=receipt(['export',created.session.id,'--data-dir',headless,'--format',format,'--allow-unsigned','--output',path.join(temporary,'story.'+format)]);assert.ok(result.bytes>100);}
    const backup=path.join(temporary,'headless backup');receipt(['backup',backup,'--data-dir',headless]);receipt(['verify-backup',backup]);receipt(['restore',backup,'--data-dir',path.join(temporary,'restored library')]);
    receipt(['diagnostics','--data-dir',headless,'--output',path.join(temporary,'diagnostics.json')]);
  }finally{await fixture.stop();await rm(fixture.root,{recursive:true,force:true});}
  console.log('Installed headless init/production-state/read/preview/native ZIP-PDF-PNG/backup/restore/diagnostics/skill passed.');
  // An unrelated .env must never be discovered implicitly. Explicit flags beat the selected env file.
  await writeFile(path.join(cwd,'.env'), 'SHIQU_AI_PROVIDER=invalid\n');
  await writeFile(path.join(cwd,'selected.env'), 'PORT=1\nSHIQU_DATA_DIR=env library\nSHIQU_BIND_IP=invalid-host\n');
  const port = await freePort(), origin = 'http://127.0.0.1:' + port;
  const parameters = ['--config','selected.env','--port',String(port),'--host','127.0.0.1','--data-dir','../saved library'];
  await start(bin, parameters);
  assert.ok(logs.includes(path.join(temporary,'saved library')));
  const response = await request(origin), html = await response.text(); assert.equal(response.status, 200); assert.match(html, /<html/);
  const asset = html.match(/(?:src|href)="(\/assets\/[^" ]+\.js)"/)?.[1]; assert.ok(asset, 'Built reader JS must be referenced.');
  assert.equal((await request(origin + asset)).status, 200);
  for (const endpoint of ['/api/reader/sessions','/api/reader/deletions']) assert.deepEqual(await (await request(origin + endpoint)).json(), []);
  assert.equal((await (await request(origin + '/api/reader/status')).json()).configured, false);
  const foreignHostStatus = await new Promise((resolve, reject)=>{
    const request = get(origin, {headers:{Host:'foreign.example'}}, response=>{response.resume();resolve(response.statusCode);});
    request.setTimeout(5000, ()=>request.destroy(Error('Foreign Host check timed out.')));
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await request(origin + '/api/reader/sessions', {method:'POST',headers:{Origin:'https://foreign.example'}})).status, 403);
  assert.equal((await request(origin + '/api/reader/sessions', {method:'POST'})).status, 403);
  // A non-inference write through the current API must survive restarting the installed release.
  const publication = {...emptyPublication, author:'Survives npm cache cleanup'};
  const savedDefaults = await request(origin + '/api/reader/publication-defaults', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({publication,expected:null})});
  assert.equal(savedDefaults.status, 200);
  await stop(); await start(bin, parameters);
  assert.deepEqual((await (await request(origin + '/api/reader/publication-defaults')).json()).publication, publication);
  assert.deepEqual(await (await request(origin + '/api/reader/sessions')).json(), []);
  await stop();
  // Env-file settings are used when no flag overrides them; shell variables still win over the file.
  await start(bin, ['--config','selected.env'], {PORT:String(port), SHIQU_BIND_IP:'127.0.0.1'});
  assert.ok(logs.includes(path.join(cwd,'env library'))); assert.equal((await request(origin)).status, 200); await stop();
  await rm(path.join(cwd,'env library'), {recursive:true, force:true});
  await start(bin, ['--port',String(port),'--host','0.0.0.0','--data-dir','../saved library']);
  assert.ok(logs.includes('拾趣: ' + origin), 'Wildcard binds must print an allowed loopback URL.');
  assert.equal((await request(origin)).status, 200); await stop();
  // Fresh non-interactive use must ask for an explicit directory, not silently create a shelf.
  const fresh = command(bin, ['--port',String(port)]);
  assert.equal(fresh.status,1);assert.match(fresh.stderr,/--data-dir/);
  const base = process.platform === 'darwin' ? path.join(home,'Library/Application Support')
    : process.platform === 'win32' ? path.join(home,'roaming') : path.join(home,'xdg');
  const defaultData = path.join(base,'com.shiqu.desktop/library');
  const configBase = process.platform === 'linux' ? path.join(home,'.config') : base;
  const settingsDirectory = path.join(configBase,'com.shiqu.desktop');
  await mkdir(settingsDirectory,{recursive:true});
  const sharedSettings = new SystemSettingsStore(path.join(settingsDirectory,'desktop.sqlite'),defaultData);
  sharedSettings.save({dataDirectory:defaultData,libraryConfigured:true,provider:'readonly',providerConfigured:true});sharedSettings.close();
  await start(bin, ['--port',String(port)]);
  assert.ok(logs.includes(defaultData));await lstat(path.join(defaultData,'shiqu.sqlite'));await stop();
  assert.deepEqual((await readdir(cwd)).sort(), ['.env','selected.env']);
  assert.deepEqual(await files(installed, '', true), payload, 'Installed runtime files must remain immutable.');
  console.log(`npm smoke passed: ${manifest.name}@${manifest.version}; ${payload.length} files; all 24 books; isolated install, HTTP, access, persistence, restart, configuration, and shutdown.`);
} finally {
  try { await stop(); } finally { await rm(temporary, {recursive:true, force:true}); }
}
