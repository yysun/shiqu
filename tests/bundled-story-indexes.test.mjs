// 旧索引文件仍可导入核对故事卡，但旧向量不参与新版召回。
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

const root=process.cwd();
test('旧官方向量安装已停用，旧用户索引只用于故事卡文字检索',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'shiqu legacy vectors-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const home=path.join(directory,'library'),source=path.join(directory,'legacy.sqlite'),bookId='liaozhai';
 const env={...process.env,HOME:directory,USERPROFILE:directory,LOCALAPPDATA:path.join(directory,'local')};
 const cli=(...args)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',
  "import {executeHeadless} from './server/headless-cli.ts'; console.log(JSON.stringify(await executeHeadless(process.cwd(),process.argv.slice(1))));",
  ...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const {cards}=JSON.parse(await readFile(path.join(root,'data/library/story-cards/liaozhai.json'),'utf8'));
 const pear=cards.find(card=>card.title==='種梨');assert.ok(pear);
 const query='𐍈𐍉𐍊𐍋𐍌';
 const db=new DatabaseSync(source);
 try{
  db.exec('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id TEXT,source TEXT,text TEXT,title TEXT,summary TEXT,raw_vector BLOB,vector BLOB,blocked TEXT); CREATE TABLE query_vectors(key TEXT,model_digest TEXT,vector BLOB);');
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('indexed_book',bookId);
  db.prepare('INSERT INTO metadata VALUES (?,?)').run('identity',JSON.stringify({edition:JSON.parse(await readFile(path.join(root,'data/library/story-cards/liaozhai.json'),'utf8')).edition,digests:{'qwen3-embedding:0.6b':'legacy'}}));
  const vector=new Uint8Array(Float32Array.from([1,0]).buffer);
  db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?,NULL)').run(pear.id,JSON.stringify({...pear.source,edition:JSON.parse(await readFile(path.join(root,'data/library/story-cards/liaozhai.json'),'utf8')).edition}),'旧故事卡文字内容',pear.title,pear.summary,vector,vector);
  db.prepare('INSERT INTO query_vectors VALUES (?,?,?)').run(query,'legacy',vector);
 }finally{db.close();}
 assert.throws(()=>cli('books','index-install',bookId,source),/Official vector packs are no longer supported/);
 cli('books','index-import',bookId,source,'--data-dir',home);
 assert.deepEqual(cli('books','search',query,bookId,'--limit','1','--data-dir',home).results,[]);
 assert.match(cli('books','search','种梨',bookId,'--limit','1','--data-dir',home).results[0]?.excerpt||'',/梨/);
});
