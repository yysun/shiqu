// 验证导入书命令通过应用 API 保护结构审阅与替换步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeHeadless} from '../server/headless-cli.ts';

test('CLI imports a draft, saves structure, confirms, replaces and removes through the application API',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'shiqu-import-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));const library=path.join(root,'library'),source=path.join(root,'book.txt'),structureFile=path.join(root,'structure.json');
 const text=(ending='庄周梦蝶后继续思考。')=>`第一章 梦蝶\n庄周在梦中化为蝴蝶，自在飞翔。朋友认真倾听他的经历，并追问梦醒后的真实感受。\n第二章 醒来\n${ending}他没有急着下结论，而是继续追索人与万物变化的缘由。`;
 await writeFile(source,text());
 const imported=await executeHeadless(process.cwd(),['books','import',source,'--title','本地测试书','--source-note','测试原始出处','--license','允许本地改编','--accept-rights','--data-dir',library],{variables:{}});
 assert.equal(imported.status,'structuring');assert.equal(imported.sources,1);assert.equal(imported.chapters,2);
 const preview=await executeHeadless(process.cwd(),['books','structure',imported.id,'--data-dir',library],{variables:{}});assert.equal(preview.chapters.length,2);
 await writeFile(structureFile,JSON.stringify({chapters:preview.manifest.structure.chapters}));
 await executeHeadless(process.cwd(),['books','structure',imported.id,'--input',structureFile,'--data-dir',library],{variables:{}});
 const confirmed=await executeHeadless(process.cwd(),['books','confirm',imported.id,'--data-dir',library],{variables:{}});assert.equal(confirmed.status,'ready');
 const listing=await executeHeadless(process.cwd(),['books','imported','--data-dir',library],{variables:{}});assert.equal(listing.books[0].id,imported.id);
 await writeFile(source,text('庄周醒来后发现梦境无法简单判定，决定继续追问。'));
 const staged=await executeHeadless(process.cwd(),['books','reimport',imported.id,source,'--accept-rights','--data-dir',library],{variables:{}});assert.equal(staged.status,'review-required');assert.equal(staged.id,imported.id);assert.ok(staged.draftId);assert.equal((await executeHeadless(process.cwd(),['books','imported','--data-dir',library],{variables:{}})).books[0].edition,confirmed.edition);
 const replacementPreview=await executeHeadless(process.cwd(),['books','structure',staged.draftId,'--data-dir',library],{variables:{}});await writeFile(structureFile,JSON.stringify({chapters:replacementPreview.manifest.structure.chapters}));
 await assert.rejects(executeHeadless(process.cwd(),['books','reimport',imported.id,'--draft-id',staged.draftId,'--data-dir',library],{variables:{}}),error=>error.code==='STRUCTURE_REVIEW_REQUIRED');
 const replaced=await executeHeadless(process.cwd(),['books','reimport',imported.id,'--draft-id',staged.draftId,'--input',structureFile,'--data-dir',library],{variables:{}});assert.equal(replaced.id,imported.id);assert.notEqual(replaced.edition,confirmed.edition);
 await assert.rejects(executeHeadless(process.cwd(),['books','remove',imported.id,'--data-dir',library],{variables:{}}),error=>error.code==='CONFIRMATION_REQUIRED');
 const removed=await executeHeadless(process.cwd(),['books','remove',imported.id,'--yes','--data-dir',library],{variables:{}});assert.equal(removed.deleted,true);assert.deepEqual((await executeHeadless(process.cwd(),['books','imported','--data-dir',library],{variables:{}})).books,[]);
 await assert.rejects(readFile(path.join(library,'books',imported.id,'manifest.json')),{code:'ENOENT'});
});
