// 官方资源路径由发布根目录或系统缓存决定，与活动书库分开。
import os from 'node:os';
import path from 'node:path';

export const storyIndexDirectory='story-indexes';
export const storyCardsPath='data/library/story-cards';
export const officialVectorFormat='shiqu-story-vectors-v1';

export function officialVectorDirectory(){
 const home=os.homedir();
 const cache=process.platform==='darwin'?path.join(home,'Library','Caches'):
  process.platform==='win32'?(process.env.LOCALAPPDATA||path.join(home,'AppData','Local')):path.join(home,'.cache');
 return path.join(cache,'com.shiqu.desktop',officialVectorFormat);
}

export const indexFilename=(bookId:string)=>encodeURIComponent(bookId)+'.sqlite';
export const officialVectorFilename=(bookId:string)=>'vectors-'+indexFilename(bookId);
