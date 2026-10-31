// Share desktop paths and read only the saved library setting, never credentials.
// Broken settings fail rather than silently opening a different empty shelf.
import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
export type LibraryLocationOptions={variables?:Record<string,string|undefined>;platform?:NodeJS.Platform;home?:string;cwd?:string};
export function desktopLibraryPaths({variables=process.env,platform=process.platform,home=homedir()}:LibraryLocationOptions={}){
 const paths=platform==='win32'?path.win32:path;
 const base=platform==='darwin'?paths.join(home,'Library','Application Support'):platform==='win32'?(variables.APPDATA||paths.join(home,'AppData','Roaming')):(variables.XDG_DATA_HOME&&paths.isAbsolute(variables.XDG_DATA_HOME)?variables.XDG_DATA_HOME:paths.join(home,'.local','share'));
 const configBase=platform==='linux'?(variables.XDG_CONFIG_HOME&&paths.isAbsolute(variables.XDG_CONFIG_HOME)?variables.XDG_CONFIG_HOME:paths.join(home,'.config')):base;
 const configDirectory=paths.join(configBase,'com.shiqu.desktop');
 return {settings:paths.join(configDirectory,'desktop.sqlite'),cliSelection:paths.join(configDirectory,'cli-library.json'),library:paths.join(base,'com.shiqu.desktop','library')};
}
export function savedDesktopLibraryDirectory(options:LibraryLocationOptions={}){
 const {settings}=desktopLibraryPaths(options);
 if(!existsSync(settings))return undefined;
 const paths=(options.platform||process.platform)==='win32'?path.win32:path;
 let database:DatabaseSync|undefined;
 try{
  database=new DatabaseSync(settings,{readOnly:true});
  const row=database.prepare('SELECT value FROM desktop_settings WHERE id=1').get() as {value:string}|undefined;
  if(!row)throw Error('MISSING_SETTINGS');
  const saved=JSON.parse(row.value) as {dataDirectory?:unknown};
  if(typeof saved.dataDirectory!=='string'||!paths.isAbsolute(saved.dataDirectory))throw Error('INVALID_LIBRARY_DIRECTORY');
  return paths.normalize(saved.dataDirectory);
 }catch{throw Error('无法读取桌面书库设置；请修复设置，或通过 --data-dir / SHIQU_DATA_DIR 指定书库。');}
 finally{database?.close();}
}
export function developmentLibraryDirectory(options:LibraryLocationOptions={}){
 const variables=options.variables||process.env,paths=(options.platform||process.platform)==='win32'?path.win32:path;
 if(variables.SHIQU_DATA_DIR?.trim())return paths.resolve(options.cwd||process.cwd(),variables.SHIQU_DATA_DIR.trim());
 return savedDesktopLibraryDirectory(options)||desktopLibraryPaths(options).library;
}
