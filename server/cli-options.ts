// Resolve CLI configuration from the caller's directory, keeping persistent data out of npm caches.
// --config avoids Node's own --env-file option being consumed before the executable can validate it.
import path from 'node:path';
import {homedir} from 'node:os';

export type CliOptions = {help?:boolean;version?:boolean;port?:string;host?:string;dataDirectory?:string;envFile?:string};
const flags:Record<string,keyof CliOptions> = {'--port':'port','--host':'host','--data-dir':'dataDirectory','--config':'envFile'};

export function parseCliOptions(args:string[]):CliOptions {
  const options:CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--version' || argument === '-v') { options.version = true; continue; }
    const equals = argument.indexOf('='), flag = equals < 0 ? argument : argument.slice(0, equals);
    const key = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
    if (!key) throw Error(`Unknown argument: ${argument}. Use --help for options.`);
    const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
    if (!value || (equals < 0 && value.startsWith('-'))) throw Error(`${flag} requires a value.`);
    if (key === 'port' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) throw Error('--port must be between 1 and 65535.');
    (options as Record<string,string|boolean>)[key] = value;
  }
  return options;
}

export function cliConfiguration(options:CliOptions, {variables = process.env, platform = process.platform, home = homedir(), cwd = process.cwd()}:{variables?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;home?:string;cwd?:string} = {}) {
  const paths = platform === 'win32' ? path.win32 : path;
  const base = platform === 'darwin' ? paths.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? variables.LOCALAPPDATA || variables.APPDATA || paths.join(home, 'AppData', 'Local')
    : variables.XDG_DATA_HOME && paths.isAbsolute(variables.XDG_DATA_HOME) ? variables.XDG_DATA_HOME : paths.join(home, '.local', 'share');
  const dataDirectory = options.dataDirectory ?? variables.SHIQU_DATA_DIR?.trim();
  return {...variables,
    PORT: options.port ?? variables.PORT ?? '3000',
    SHIQU_BIND_IP: options.host ?? variables.SHIQU_BIND_IP ?? '127.0.0.1',
    SHIQU_DATA_DIR: dataDirectory ? paths.resolve(cwd, dataDirectory) : paths.join(base, 'shiqu', 'library'),
  };
}
