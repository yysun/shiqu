// Stage a public CLI release from explicit assets and declared runtime imports, then pack it with pnpm.
import {build as buildClient} from 'vite';
import {build} from 'esbuild';
import {cp, chmod, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.versions.node.split('.')[0] !== '24') throw Error('Build npm releases with Node 24; see .nvmrc.');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'outputs/npm'), stage = path.join(output, 'package');
const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await rm(output, {recursive:true, force:true});
await mkdir(stage, {recursive:true});
await buildClient({root, configFile:path.join(root, 'vite.config.ts'), build:{outDir:path.join(stage, 'dist/client'), emptyOutDir:true}});
const result = await build({entryPoints:[path.join(root, 'server/cli.ts')], outfile:path.join(stage, 'dist/server/cli.js'), bundle:true, platform:'node', format:'esm', target:'node24', packages:'external', metafile:true});
const names = [...new Set(Object.values(result.metafile.outputs).flatMap(file=>file.imports.filter(item=>item.external && !item.path.startsWith('node:')).map(item=>item.path.startsWith('@') ? item.path.split('/').slice(0,2).join('/') : item.path.split('/')[0])))].sort();
const dependencies = Object.fromEntries(names.map(name=>{
  if (!source.dependencies[name]) throw Error('Undeclared production dependency: ' + name);
  return [name, source.dependencies[name]];
}));
for (const file of ['bin/shiqu.mjs','data/library','drizzle','docker/seed.sql','LICENSE','NOTICE']) {
  const target = path.join(stage, file);
  await mkdir(path.dirname(target), {recursive:true});
  await cp(path.join(root, file), target, {recursive:true});
}
await cp(path.join(root, 'npm/README.md'), path.join(stage, 'README.md'));
await cp(path.join(root, '.env.example'), path.join(stage, '.env.example'));
await chmod(path.join(stage, 'bin/shiqu.mjs'), 0o755);
const manifest = {
  name:source.publishConfig.name, version:source.version, description:source.description, license:source.license, author:source.author,
  repository:source.repository, homepage:source.homepage, bugs:source.bugs, type:'module', engines:source.engines,
  bin:{shiqu:'bin/shiqu.mjs'}, files:['bin/shiqu.mjs','dist/client','dist/server/cli.js','data/library','drizzle/*.sql','docker/seed.sql','.env.example','LICENSE','NOTICE','README.md'],
  publishConfig:{access:'public',registry:'https://registry.npmjs.org/'}, dependencies,
};
await writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
// Use the running pnpm installation, including its JS launcher on Windows.
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error('Run this script with pnpm build:npm.');
const javascript = /\.[cm]?js$/.test(pnpm);
const packed = spawnSync(javascript ? process.execPath : pnpm, [...(javascript ? [pnpm] : []), '--dir', stage, 'pack', '--pack-destination', output], {cwd:root, encoding:'utf8', maxBuffer:4 * 1024 * 1024});
if (packed.error) throw packed.error;
if (packed.status !== 0) throw Error('pnpm pack failed:\n' + packed.stderr + packed.stdout);
console.log(`npm release ready in ${output} (${names.length} runtime dependencies).`);
