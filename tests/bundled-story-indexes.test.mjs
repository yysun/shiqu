// 验证正式 CLI 和读书服务共享发布索引，官方缓存与用户备份分离。
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp,lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {LocalBooks} from '../server/local-books.ts';
import {LocalStorySearch,storyEmbeddingModel,storySearchKey} from '../server/local-story-search.ts';
import {selectedChapterScope} from '../server/local-book-contents.ts';
import {createLibraryBackup,restoreLibraryBackup,verifyLibraryBackup} from '../server/library-backup.ts';
import {officialVectorFilename} from '../server/story-index-paths.ts';

const root=process.cwd(),signal=new AbortController().signal;
const selection={bookId:'liaozhai',theme:'原典故事'};
async function isolated(t){
 const directory=await mkdtemp(path.join(tmpdir(),'shiqu published search '));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return directory;
}
function isolatedNode(home){
 const env={...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:path.join(home,'local')};
 const child=(code,...args)=>execFileSync(process.execPath,['--input-type=module','-e',code,...args],{
  cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],
 });
 const cli=(...args)=>JSON.parse(child("import {executeHeadless} from './server/headless-cli.ts'; console.log(JSON.stringify(await executeHeadless(process.cwd(),process.argv.slice(1))));",...args));
 const request=(shelf,url)=>JSON.parse(child(
  "import {createApplication} from './server/app.ts'; const app=createApplication({root:process.cwd(),dataDirectory:process.argv[1],variables:{SHIQU_AI_PROVIDER:'readonly'}}); try{const response=await app.handle(new Request(process.argv[2])); console.log(JSON.stringify({status:response.status,body:await response.json()}));}finally{await app.close();}",
  shelf,url,
 ));
 return {env,child,cli,request};
}

test('新用户的正式 CLI 和 reader API 可直接使用内置故事卡',async t=>{
 const dir=await isolated(t),unused=path.join(dir,'unused'),{cli,request}=isolatedNode(dir);
 const receipt=cli('books','search','种梨','聊斋志异','--limit','1','--data-dir',unused);
 assert.match(receipt.results[0]?.excerpt||'',/梨/);
 await assert.rejects(lstat(unused),{code:'ENOENT'});
 const url='http://shiqu.local/api/reader/books/'+encodeURIComponent('搜神记')+'/contents?q='+encodeURIComponent('宋定伯');
 const response=request(path.join(dir,'shelf'),url);
 assert.equal(response.status,200);
 assert.ok(response.body.entries.some(entry=>entry.kind==='story'&&entry.title.includes('宋定伯')));
});

test('首次按范围查找和随后全书查找共用完整故事卡',async t=>{
 const dir=await isolated(t),books=new LocalBooks(root);
 const book=await books.book(selection);
 const search=new LocalStorySearch(path.join(dir,'story-search.sqlite'),{root,book:async()=>book,cache:path.join(dir,'cache')});
 const pathToCards=path.join(root,'data/library/story-cards/liaozhai.json');
 const data=JSON.parse(await readFile(pathToCards,'utf8'));
 const pear=data.cards.find(card=>card.title==='種梨');
 const other=data.cards.find(card=>card.title==='畫皮');
 assert.ok(pear&&other);
 const scope=await selectedChapterScope(books,book,[{...pear.source,edition:book.edition}]);
 assert.deepEqual((await search.lookupHits(scope.book,'种梨',signal,true)).map(hit=>hit.title),['種梨']);
 assert.equal((await search.lookupHits(book,'画皮',signal,true))[0].title,'畫皮');
 assert.ok((await search.lookupHits(scope.book,'画皮',signal,true)).every(hit=>hit.title!=='畫皮'));
});

test('从制备文件导出向量包，跨库使用，损坏时回退且手动覆盖随备份恢复',async t=>{
 const dir=await isolated(t),home=path.join(dir,'home'),release=path.join(dir,'release');
 await mkdir(home);
 const {env,child,cli,request}=isolatedNode(home);
 const cache=child("import {officialVectorDirectory} from './server/story-index-paths.ts'; process.stdout.write(officialVectorDirectory());");
 const file=path.join(dir,'prepared.sqlite'),books=new LocalBooks(root),book=await books.book(selection);
 const {cards}=JSON.parse(await readFile(path.join(root,'data/library/story-cards/liaozhai.json'),'utf8'));
 const pear=cards.find(card=>card.title==='種梨');
 const customOnly='𐍈𐍉𐍊𐍋𐍌';
 const db=new DatabaseSync(file);
 try{
  db.exec('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id TEXT,source TEXT,text TEXT,title TEXT,summary TEXT,raw_vector BLOB,vector BLOB,blocked TEXT); CREATE TABLE query_vectors(key TEXT,model_digest TEXT,vector BLOB);');
  const meta=db.prepare('INSERT INTO metadata VALUES (?,?)');
  meta.run('indexed_book',book.id);
  meta.run('identity',JSON.stringify({edition:book.edition,digests:{[storyEmbeddingModel]:'test-embedding'}}));
  const vector=new Uint8Array(Float32Array.from([1,0]).buffer);
  db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,NULL,NULL)').run(pear.id,JSON.stringify({...pear.source,edition:book.edition}),
   customOnly,pear.title,pear.summary,vector);
  db.prepare('INSERT INTO query_vectors VALUES (?,?,?)').run(storySearchKey('不存在于原文的向量查询'),'test-embedding',vector);
 }finally{db.close();}
 execFileSync(process.execPath,['scripts/prepare-story-index-release.mjs',release,file],{cwd:root,env});
 const {version}=JSON.parse(await readFile('package.json','utf8'));
 const {books:[asset]}=JSON.parse(await readFile(path.join(release,'release-assets',`shiqu-story-vectors-${version}.json`),'utf8'));
 const pack=path.join(release,'release-assets',asset.filename);
 const install=()=>cli('books','index-install','liaozhai',pack);
 assert.equal(install().entries,1);
 const installed=path.join(cache,book.edition,officialVectorFilename(book.id));
 assert.equal(install().path,installed);
 const find=(shelf,query='不存在于原文的向量查询',bookId=[])=>cli('books','search',query,...bookId,'--limit','1','--data-dir',shelf);
 for(const shelf of [home,path.join(dir,'other')])assert.match(find(shelf).results[0]?.excerpt||'',/梨/);
 assert.match(find(home,'画皮',['liaozhai']).results[0]?.excerpt||'',/王/);
 for(const name of ['list-one','list-two']){
  const listed=request(path.join(dir,name),'http://shiqu.local/api/reader/books/semantic-indexes');
  assert.deepEqual(listed.body.bookIds,['liaozhai']);
 }
 assert.throws(()=>cli('books','index-install','liaozhai',file),/索引文件不可读/);
 const badPack=path.join(dir,'bad.sqlite');
 await cp(pack,badPack);
 const corrupt=new DatabaseSync(badPack);
 try{corrupt.exec('DELETE FROM query_vectors');}finally{corrupt.close();}
 assert.throws(()=>cli('books','index-install','liaozhai',badPack),/没有可用/);
 assert.throws(()=>cli('books','index-install','shishuo',pack),/书名或原文版本/);
 assert.match(find(home).results[0]?.excerpt||'',/梨/);
 await writeFile(installed,'bad sqlite');
 assert.match(find(home,'种梨',['liaozhai']).results[0]?.excerpt||'',/梨/);
 install();
 cli('books','index-import','liaozhai',file,'--data-dir',home);
 assert.equal(find(home,customOnly,['liaozhai']).results.length,1);
 assert.equal(find(path.join(dir,'other'),customOnly,['liaozhai']).results.length,0);
 new DatabaseSync(path.join(home,'shiqu.sqlite')).close();
 const backup=path.join(dir,'backup'),restored=path.join(dir,'restored');
 const makeBackup=(source,target)=>JSON.parse(child(
  "import {createLibraryBackup} from './server/library-backup.ts'; console.log(JSON.stringify(createLibraryBackup(process.argv[1],process.argv[2])));",source,target,
 ));
 const manifest=makeBackup(home,backup);
 assert.deepEqual(manifest.files.map(item=>item.path).sort(),['shiqu.sqlite','story-indexes/liaozhai.sqlite']);
 assert.equal(verifyLibraryBackup(backup).files.length,2);
 restoreLibraryBackup(backup,restored);
 assert.equal(find(restored,customOnly,['liaozhai']).results.length,1);
 const editionDirectory=path.dirname(installed);
 for(const [index,overlapping] of [cache,editionDirectory].entries()){
  new DatabaseSync(path.join(overlapping,'shiqu.sqlite')).close();
  const nested=makeBackup(overlapping,path.join(dir,'overlap-'+index));
  assert.ok(nested.files.some(file=>file.path==='shiqu.sqlite'));
  assert.ok(nested.files.every(file=>!file.path.endsWith('liaozhai.sqlite')));
 }
});

test('书库位于源码 data 时备份排除正式卡片目录',async t=>{
 const dir=await isolated(t),data=path.join(dir,'data'),cards=path.join(data,'library/story-cards');
 await mkdir(cards,{recursive:true});
 await writeFile(path.join(cards,'liaozhai.json'),'{}');
 await writeFile(path.join(data,'library/custom.txt'),'private');
 new DatabaseSync(path.join(data,'shiqu.sqlite')).close();
 const backup=path.join(dir,'backup'),manifest=createLibraryBackup(data,backup,'test',dir);
 assert.deepEqual(manifest.files.map(file=>file.path),['library/custom.txt','shiqu.sqlite']);
});
