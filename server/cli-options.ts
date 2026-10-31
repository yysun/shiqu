// Resolve CLI inputs without loading unrelated env files or changing the caller directory.
// --config avoids Node's own --env-file option being consumed before the executable can validate it.
import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync,readFileSync} from 'node:fs';
import {SystemSettingsStore} from './system-settings.ts';
import {createInterface} from 'node:readline/promises';
import {desktopLibraryPaths,savedDesktopLibraryDirectory} from './library-directory.ts';
import type {LibraryLocationOptions} from './library-directory.ts';

export type CliOptions = {configure?:boolean;resetProviders?:boolean;help?:boolean;version?:boolean;port?:string;host?:string;dataDirectory?:string;envFile?:string};
const flags:Record<string,keyof CliOptions> = {'--port':'port','--host':'host','--data-dir':'dataDirectory','--config':'envFile'};

export function parseCliOptions(args:string[]):CliOptions {
  const options:CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if(argument==='--configure'){options.configure=true;continue;}
    if(argument==='--reset-providers'){options.resetProviders=true;continue;}
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
  if(options.configure&&options.resetProviders)throw Error('Use --configure or --reset-providers separately.');
  return options;
}

export async function askLibraryDirectory(suggestion:string){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('未找到已保存的书库目录；请在交互终端启动，或使用 --data-dir <目录> / SHIQU_DATA_DIR 指定书库。');
  const terminal=createInterface({input:process.stdin,output:process.stdout}),abort=new AbortController();
  terminal.once('SIGINT',()=>abort.abort());
  terminal.once('close',()=>abort.abort());
  try{return await terminal.question(`未找到已保存的书库。请输入要使用或创建的目录（回车使用 ${suggestion}）：`,{signal:abort.signal});}
  catch{throw Error('已取消选择书库。');}
  finally{terminal.close();}
}

type CliContext=LibraryLocationOptions&{ask?:(suggestion:string)=>Promise<string>};
export async function cliConfiguration(options:CliOptions,context:CliContext={}) {
  const {variables=process.env,platform=process.platform,home=homedir(),cwd=process.cwd(),ask=askLibraryDirectory}=context;
  const paths=platform==='win32'?path.win32:path,locations=desktopLibraryPaths({variables,platform,home});
  const explicit=options.dataDirectory??variables.SHIQU_DATA_DIR?.trim();
  let directory=explicit?paths.resolve(cwd,explicit):savedDesktopLibraryDirectory({variables,platform,home});
  if(!directory&&existsSync(locations.cliSelection)){
    try{
      const saved=JSON.parse(readFileSync(locations.cliSelection,'utf8')) as {dataDirectory?:unknown};
      if(typeof saved.dataDirectory!=='string'||!paths.isAbsolute(saved.dataDirectory))throw Error();
      directory=paths.normalize(saved.dataDirectory);
      const store=new SystemSettingsStore(locations.settings,locations.library);
      try{store.save({dataDirectory:directory,libraryConfigured:true});}finally{store.close();}
    }catch{throw Error('无法读取 CLI 书库设置；请修复 cli-library.json，或使用 --data-dir 指定书库。');}
  }
  if(!directory&&existsSync(paths.join(locations.library,'shiqu.sqlite')))directory=locations.library;
  if(!directory){
    const answer=(await ask(locations.library)).trim();
    const selected=answer==='~'?home:/^~[/\\]/.test(answer)?paths.join(home,answer.slice(2)):answer;
    directory=selected?paths.resolve(cwd,selected):locations.library;
    const store=new SystemSettingsStore(locations.settings,locations.library);
    try{store.save({dataDirectory:directory,libraryConfigured:true});}finally{store.close();}
  }
  return {...variables,
    PORT:options.port??variables.PORT??'3000',
    SHIQU_BIND_IP:options.host??variables.SHIQU_BIND_IP??'127.0.0.1',
    SHIQU_DATA_DIR:directory,
  };
}
