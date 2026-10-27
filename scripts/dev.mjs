// Initialize the local sample database and run the framework with hot reload.
// Development data stays in this checkout; the runtime image uses its own /data volume.
import './tool-env.mjs';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.SHIQU_DATA_DIR = path.resolve(process.env.SHIQU_DATA_DIR || '.data/dev');
mkdirSync(process.env.SHIQU_DATA_DIR, {recursive: true});

const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const common = ['--local', '--config', 'wrangler.json', '--persist-to', process.env.SHIQU_DATA_DIR];
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', ...common],
  ['d1', 'execute', 'DB', ...common, '--file', 'docker/seed.sql'],
]) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    env: {...process.env, CI: 'true'}, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Keep the framework in this process so Ctrl+C stops the full dev server.
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), 'dev',
  '--hostname', '127.0.0.1', '--port', '3000', ...process.argv.slice(2)];
await import(cli.href);
