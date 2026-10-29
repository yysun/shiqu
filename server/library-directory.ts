// Development follows the native shelf without reading desktop credentials. An explicit
// directory wins; broken saved settings fail instead of silently creating another empty shelf.
import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
type Options={variables?:Record<string,string|undefined>;platform?:NodeJS.Platform;home?:string};
export function developmentLibraryDirectory({variables=process.env,platform=process.platform,home=homedir()}:Options={}){
 const paths=platform==='win32'?path.win32:path;
 if(variables.SHIQU_DATA_DIR?.trim())return paths.resolve(variables.SHIQU_DATA_DIR.trim());
 const base=platform==='darwin'?paths.join(home,'Library','Application Support'):platform==='win32'?(variables.APPDATA||paths.join(home,'AppData','Roaming')):(variables.XDG_DATA_HOME||paths.join(home,'.local','share'));
 const configBase=platform==='linux'?(variables.XDG_CONFIG_HOME||paths.join(home,'.config')):base;
 const filename=paths.join(configBase,'com.shiqu.desktop','desktop.sqlite');
 if(!existsSync(filename))return paths.join(base,'com.shiqu.desktop','library');
 let database:DatabaseSync|undefined;
 try{
  database=new DatabaseSync(filename,{readOnly:true});
  const row=database.prepare('SELECT value FROM desktop_settings WHERE id=1').get() as {value:string}|undefined;
  if(!row)throw Error('MISSING_SETTINGS');
  const saved=JSON.parse(row.value) as {dataDirectory?:unknown};
  if(typeof saved.dataDirectory!=='string'||!paths.isAbsolute(saved.dataDirectory))throw Error('INVALID_LIBRARY_DIRECTORY');
  return paths.normalize(saved.dataDirectory);
 }catch{throw Error('无法读取桌面书库设置；请修复设置或通过 SHIQU_DATA_DIR 指定书库。');}
 finally{database?.close();}
}
