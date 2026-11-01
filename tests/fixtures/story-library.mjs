// Tiny citation-valid books and isolated fake inference for extraction/matching lifecycle tests.
import {LocalBooks} from '../../server/local-books.ts';
import {discoverLocalStories} from '../../server/local-story-discovery.ts';
import {StoryDiscoveryCache} from '../../server/story-discovery-cache.ts';
import {localSourceKey} from '../../lib/reader-local-contract.ts';
export const memory=()=>{const values=new Map();return {values,get:async key=>{const bytes=values.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},put:async(key,bytes)=>{values.set(key,new Uint8Array(bytes));}};};
export const selection={bookId:'zhuangzi',theme:'勇气',artStyle:'ink-pencil',length:'auto',voice:false,productionPrompt:''};
export function libraryFixture(store=memory()){
 const units=[{id:'u1',text:'渔夫将搁浅的乌龟送回水中。后来洪水袭来，乌龟把落水的渔夫驮回岸边。',narrative:true},{id:'u2',text:'勇士面对山中的猛虎仍向前行。他保护了村民，最终击退猛虎，平安返回村庄。',narrative:true}];
 const book={id:'zhuangzi',title:'测试原典',edition:'a'.repeat(64),url:'https://example.org/book',provider:'受控本地原文',sections:[{id:'s1',title:'第一章',units}],input:{title:'测试原典',edition:'a'.repeat(64),text:'篇章 s1：第一章\n'+units.map(u=>'['+u.id+']\n'+u.text).join('\n\n')}};
 const stories=units.map((unit,i)=>({title:i?'勇士护民':'乌龟报恩',description:i?'面对猛虎，他作出自己的选择。':'渔夫与乌龟的一次相遇。',summary:i?'勇士为保护村民面对猛虎，最终击退猛虎平安返回。':'渔夫先救乌龟，后来乌龟在洪水中救回渔夫。',source:{edition:book.edition,sectionId:'s1',firstUnit:unit.id,lastUnit:unit.id}}));
 const books=new LocalBooks(process.cwd());books.book=async()=>book;
 const calls={catalog:[],matches:[]},control={model:'mock',effort:'medium',decide:(theme,story)=>theme==='勇气'?(story.summary.includes('勇士')?'yes':'no'):theme==='知恩图报'?(story.summary.includes('乌龟')?'yes':'no'):'yes'};
 const provider={status:async()=>({configured:true,provider:'codex',models:{text:control.model,image:'mock'},voiceEnabled:false,taskReasoningEfforts:{suggest:control.effort}}),safeError:()=> '受控模型错误',generator:()=>({}),
  async suggestions(s,excluded,input){
   calls.catalog.push({selection:s,excluded,input});
   const seen=new Set(input.scan.excludedSources.map(localSourceKey)),available=stories.filter(story=>input.text.includes('['+story.source.firstUnit+']')&&!seen.has(localSourceKey(story.source)));
   return {stories:available.slice(0,input.scan.maxStories),note:'',scan:{blockComplete:available.length<input.scan.maxStories,pendingEvents:[],resolvedEventIds:[]}};
  },
  async matchStories(theme,entries){calls.matches.push({theme,stories:structuredClone(entries)});return {matches:entries.map(story=>({id:story.id,verdict:control.decide(theme,story)}))};},
 };
 const cache=new StoryDiscoveryCache(store);
 const run=(theme=selection.theme,seen=[],observer)=>discoverLocalStories(provider,books,cache,book,{...selection,theme},[],observer,seen);
 return {book,books,stories,store,cache,provider,calls,control,run};
}
