// 正常服务启动成功后准备用户技能；帮助、维护与独立命令不隐式安装。
import {inspectLibrary} from './library-schema.ts';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {SystemSettingsStore} from './system-settings.ts';
import {desktopLibraryPaths} from './library-directory.ts';
import {configureProvider,cliProviderConfiguration,providerReady} from './cli-setup.ts';
import {parseCliOptions, cliConfiguration} from './cli-options.ts';
import {maintainLibrary} from './library-maintenance.ts';
import {routeHeadless} from './headless-cli.ts';
import {ensureAgentSkill,agentSkillMessage} from './agent-skill.ts';

const help = `Usage: shiqu [options]

Start 拾趣 and open the printed URL in your browser. Requires Node 24.

No subcommand starts the browser service. For serverless agent commands and JSON input examples:
  shiqu help --json
  shiqu init --data-dir <directory>
  shiqu stories list --data-dir <directory>
  shiqu run <story-id> --until reviewed --timeout 900

  --port <number>       HTTP port (PORT, default: 3000)
  --host <address>      Bind address (SHIQU_BIND_IP, default: 0.0.0.0)
  --data-dir <path>     Persistent library (SHIQU_DATA_DIR, saved desktop library, otherwise ask)
  --config <env-file>   Load this env file; existing environment variables take precedence
  --configure          Select/edit the shared saved provider, then exit
  --reset-providers    Clear saved provider profiles/keys, reopen setup in a terminal
  --backup <new-dir>    Back up a stopped library with verified file hashes
  --verify-backup <dir> Verify a backup without starting or migrating it
  --restore <dir>       Restore backup to a new, explicit --data-dir; never start it
  --diagnostics <file>  Export bounded, redacted diagnostic metadata to a new JSON file
  -h, --help           Show help
  -v, --version        Show version

Relative paths use the directory you launched from. No .env file is loaded automatically.
LAN access and phone QR codes are enabled by default; use the same trusted Wi-Fi.
Connected devices share the library. Use --host 127.0.0.1 for local-only access.
Saved provider settings are shared with the desktop app. First use asks for setup.
A successful normal launch prepares the bundled user skill. Use skill auto-install off to opt out.
SHIQU_SKILL_AUTO_INSTALL=off skips startup installation; existing update consent is preserved.
Environment/config overrides apply to this invocation only and are never saved automatically.
`;

export async function runCli(root:string, args = process.argv.slice(2)) {
  const start=async(options:Parameters<typeof import('./start.ts').startServer>[0])=>{const {startServer}=await import('./start.ts');const server=await startServer(options);console.log(agentSkillMessage(await ensureAgentSkill(root)));return server;};
  if(await routeHeadless(root,args))return;
  const options = parseCliOptions(args);
  if (options.help) { console.log(help); return; }
  if (options.version) { console.log(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version); return; }
  if(await maintainLibrary(root,options))return;
  if (options.envFile) {
    const variables = parseEnv(await readFile(path.resolve(options.envFile), 'utf8'));
    for (const [key, value] of Object.entries(variables)) if (!(key in process.env)) process.env[key] = value;
  }
  const locations=desktopLibraryPaths();
  if(options.resetProviders||options.configure){
    const store=new SystemSettingsStore(locations.settings,locations.library);
    try{
      if(options.resetProviders){
        store.resetProviders();
        if(!process.stdin.isTTY||!process.stdout.isTTY){console.log('已重置服务配置；运行 --configure 重新设置。');return;}
      }
      await configureProvider(store);console.log('服务配置已保存。');return;
    }finally{store.close();}
  }
  const library=await cliConfiguration(options);
  inspectLibrary(library.SHIQU_DATA_DIR!);
  if((options.dataDirectory||process.env.SHIQU_DATA_DIR)&&process.env.SHIQU_AI_PROVIDER&&providerReady(library)){
    return start({root,variables:library,localAccess:true,settingsOverrides:{...library},explicitSettingsBypass:true});
  }
  const store=new SystemSettingsStore(locations.settings,locations.library);
  let variables:Record<string,string|undefined>;
  try{if(!options.port&&!process.env.PORT)library.PORT=String(store.settings().port);variables=await cliProviderConfiguration(store,library);}finally{store.close();}
  return start({root,variables,localAccess:true,settingsOverrides:{...library}});
}
