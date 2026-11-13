// Maintenance resolves only the library location, never provider setup or credentials, and never starts work.
import {restoreAndUpgradeLibrary} from './library-upgrade.ts';
import path from 'node:path';
import {readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {createLibraryBackup,verifyLibraryBackup,containsPath} from './library-backup.ts';
import {diagnosticReport} from './diagnostics.ts';
import {ownDesktopData} from './desktop-owner.ts';
import {savedDesktopLibraryDirectory,desktopLibraryPaths} from './library-directory.ts';
import type {CliOptions} from './cli-options.ts';

export async function maintainLibrary(root:string,options:CliOptions){
 if(!options.backup&&!options.restore&&!options.verifyBackup&&!options.diagnostics)return false;
 if(options.verifyBackup){const manifest=verifyLibraryBackup(path.resolve(options.verifyBackup));console.log(`备份完整：${manifest.files.length} 个文件。`);return true;}
 const explicit=options.dataDirectory||process.env.SHIQU_DATA_DIR?.trim();
 const directory=path.resolve(explicit||savedDesktopLibraryDirectory()||desktopLibraryPaths().library);
 const output=options.backup||options.diagnostics||options.restore&&directory;
 if(output)for(const served of ['public','dist/client'])if(containsPath(path.join(root,served),path.resolve(output)))throw Error('维护输出不能放在应用静态发布目录。');
 const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
 if(options.restore){
  if(!options.dataDirectory)throw Error('恢复必须使用 --data-dir 明确指定不存在的新书库目录。');
  restoreAndUpgradeLibrary(path.resolve(options.restore),directory,root);console.log('书库已恢复到：'+directory+'；尚未启动服务。');return true;
 }
 if(options.diagnostics){
  const target=path.resolve(options.diagnostics);
  if(containsPath(directory,target))throw Error('诊断输出必须位于书库之外。');
  writeFileSync(target,JSON.stringify(diagnosticReport(directory,version),null,2)+'\n',{flag:'wx',mode:0o600});console.log('脱敏诊断已保存：'+target);return true;
 }
 if(!existsSync(directory)||!lstatSync(directory).isDirectory())throw Error('书库不存在，未创建空书库。');
 const release=await ownDesktopData(directory);
 try{const manifest=createLibraryBackup(directory,path.resolve(options.backup!),version,root);console.log(`书库备份已校验：${path.resolve(options.backup!)}（${manifest.files.length} 个文件）。`);}finally{await release();}
 return true;
}
