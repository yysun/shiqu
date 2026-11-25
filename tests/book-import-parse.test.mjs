// 覆盖导入原文的格式、编码、EPUB 目录与安全限制。
import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8,zipSync} from 'fflate';
import {autoChapterStarts,decodeImportedText,parseImportedSource,BookImportParseError} from '../server/book-import-parse.ts';

const epub=(extra={})=>zipSync({
 'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'),
 'OEBPS/book.opf':strToU8('<package><manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>'),
 'OEBPS/chapter.xhtml':strToU8('<html><body><h1>第一章 梦蝶</h1><p>庄周梦见自己成为蝴蝶。</p><p>醒来后，他思考庄周与蝴蝶的区别。</p></body></html>'),
 ...extra,
});

test('TXT, HTML and EPUB become editable blocks while retaining detected chapter starts',()=>{
 const txt=parseImportedSource({bytes:strToU8('引子\n第一章 梦蝶\n庄周梦见蝴蝶。\n第二章 醒来\n他醒后继续思考。'),name:'book.txt'});
 assert.equal(txt.format,'txt');assert.equal(txt.encoding,'utf-8');assert.deepEqual(txt.chapters.map(({title})=>title),['第一章 梦蝶','第二章 醒来']);
 const html=parseImportedSource({bytes:strToU8('<nav>不属于正文</nav><h1>第一章</h1><p>正文一。</p><script>忽略</script><p>正文二。</p>'),name:'book.html'});
 assert.equal(html.format,'html');assert.equal(html.blocks.some(({text})=>text.includes('不属于正文')),false);assert.equal(html.blocks.some(({text})=>text.includes('忽略')),false);
 const book=parseImportedSource({bytes:epub(),name:'book.epub'});
 assert.equal(book.format,'epub');assert.ok(book.epubBytes>0);assert.equal(book.blocks[0].text,'第一章 梦蝶');assert.equal(book.chapters[0].title,'第一章 梦蝶');
});

test('EPUB package directory entries are accepted and do not count as content',()=>{
 const bytes=epub({'META-INF/':new Uint8Array(),'OEBPS/':new Uint8Array()}),book=parseImportedSource({bytes,name:'directory-entry.epub'});
 assert.equal(book.format,'epub');assert.equal(book.blocks[0].text,'第一章 梦蝶');
});

test('text decoding preserves explicit Big5 and rejects ambiguous or unsupported declarations',()=>{
 assert.equal(decodeImportedText(new Uint8Array([0xa4,0xa4,0xa4,0xe5]),'big5').text,'中文');
 assert.throws(()=>decodeImportedText(strToU8('原文'),'not-an-encoding'),error=>error instanceof BookImportParseError&&error.message==='ENCODING_INVALID');
 const starts=autoChapterStarts([{text:'短文。'},{text:'第二段。'}],3);assert.equal(starts[0].block,0);assert.equal(starts[1].block,1);
});

test('EPUB rejects encryption, unsafe member paths and inflated data over the limit',()=>{
 assert.throws(()=>parseImportedSource({bytes:epub({'META-INF/encryption.xml':strToU8('<encryption/>')}),name:'book.epub'}),error=>error instanceof BookImportParseError&&error.message==='EPUB_DRM');
 assert.throws(()=>parseImportedSource({bytes:epub({'../escape.xhtml':strToU8('escape')}),name:'book.epub'}),error=>error instanceof BookImportParseError&&error.message==='EPUB_PATH_INVALID');
});
