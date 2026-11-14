// 纯测试数据与等待工具；不加载生产生成器，供不使用 productionFixture 的测试复用。
import assert from 'node:assert/strict';
import {encoded} from './images.mjs';

export {encoded};
export const selection={bookId:'zhuangzi',storyTitle:'庄周梦蝶',theme:'放下执念',length:8,voice:false,artStyle:'ink-pencil',productionPrompt:'quiet narration'};
export const makePlan=length=>({title:'庄周梦蝶',summary:'庄周梦见自己成为蝴蝶，醒后思考庄周与蝴蝶之间的区别与变化。',sourceReference:'《庄子·齐物论》庄周梦蝶',adaptationNote:'现代改编',reflection:'谁在梦中？',characters:'An adult Chinese philosopher in a plain linen robe in ancient China.',pages:Array.from({length},(_,i)=>({caption:'庄周梦见自己成为一只蝴蝶，自由自在地飞来飞去。',prompt:`An adult philosopher dreams in an ancient garden, scene ${i}.`}))});
export const makeRequirements=title=>({productionPrompt:`重点呈现《${title}》的关键行动与回应，保留原文结局，压缩无关过场。`,acceptancePrompt:`《${title}》的关键行动有对应的配文与画面描述。\n末幅交代《${title}》原文中的实际结果或真实停点。`});
export const makeReflectionCandidates=first=>[first,'醒来之后，梦中的自在仍值得回味。','梦与醒的分界，也未必是心境的分界。'];
export const turn=()=>new Promise(resolve=>setImmediate(resolve));
export async function until(predicate,timeoutMs=5000){const end=Date.now()+timeoutMs;while(!await predicate()){assert.ok(Date.now()<end,'Timed out waiting for controlled production work');await turn();}}
