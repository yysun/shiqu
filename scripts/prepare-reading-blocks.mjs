// Precompute reusable reading boundaries locally without credentials or model requests.
import path from 'node:path';
import {LocalBooks} from '../server/local-books.ts';
import {readerBooks} from '../lib/reader-books.ts';
import {StoryDiscoveryCache} from '../server/story-discovery-cache.ts';
import {FileMedia} from '../server/media.ts';
import {readingPlan} from '../server/story-reading-inputs.ts';
const root=process.cwd(),provider=process.env.SHIQU_AI_PROVIDER?.trim()||'gemini';
if(!['codex','gemini'].includes(provider))throw Error('SHIQU_AI_PROVIDER must be codex or gemini');
const data=path.resolve(process.env.SHIQU_DATA_DIR||'.data/dev');
const cache=new StoryDiscoveryCache(new FileMedia(path.join(data,'media'))),books=new LocalBooks(root);
for(const entry of readerBooks){
 const book=await books.book({bookId:entry.id,customBook:''});
 if(!book)throw Error('Missing local book '+entry.id);
 const plan=await readingPlan(book,provider,cache);
 console.log(JSON.stringify({book:book.title,provider,blocks:plan.blocks.length,mode:plan.manifest.mode,tokens:plan.manifest.blocks.map(block=>block.tokens),manifest:plan.key}));
}
