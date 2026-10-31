// Start the installed browser app with explicit assets, opt-in env loading, and persistent user data.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {parseCliOptions, cliConfiguration} from './cli-options.ts';

const help = `Usage: shiqu [options]

Start 拾趣 and open the printed URL in your browser. Requires Node 24.

  --port <number>       HTTP port (PORT, default: 3000)
  --host <address>      Bind address (SHIQU_BIND_IP, default: 127.0.0.1)
  --data-dir <path>     Persistent library (SHIQU_DATA_DIR, default: OS user-data directory)
  --config <env-file>   Load this env file; existing environment variables take precedence
  -h, --help           Show help
  -v, --version        Show version

Relative paths use the directory you launched from. No .env file is loaded automatically.
Use --host 0.0.0.0 for trusted LAN access; connected devices share the library.
For generation, set SHIQU_AI_PROVIDER=codex after codex login, or GEMINI_API_KEY.
`;

export async function runCli(root:string, args = process.argv.slice(2)) {
  const options = parseCliOptions(args);
  if (options.help) { console.log(help); return; }
  if (options.version) { console.log(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version); return; }
  if (options.envFile) {
    const variables = parseEnv(await readFile(path.resolve(options.envFile), 'utf8'));
    for (const [key, value] of Object.entries(variables)) if (!(key in process.env)) process.env[key] = value;
  }
  const {startServer} = await import('./start.ts');
  startServer({root, variables:cliConfiguration(options), localAccess:true});
}
