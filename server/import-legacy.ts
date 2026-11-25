// 合并前书库的离线导入由过渡版本 0.17.x 执行。
import {pathToFileURL} from 'node:url';
import {earlierFormatError} from './library-schema.ts';

export async function importLegacy(_sourceDirectory:string,_targetDirectory:string,_root?:string):Promise<never>{
 throw earlierFormatError();
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.error(earlierFormatError().message);
 process.exitCode=1;
}
