// 桌面内置 Node 的命令入口；所有行为复用正式 CLI，不启动原生窗口或另一套生产流程。
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {runCli} from './cli.ts';
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 try{await runCli(root);}catch{process.stderr.write('拾趣 CLI 执行失败，请检查当前版本帮助与运行环境。\n');process.exitCode=1;}
}
