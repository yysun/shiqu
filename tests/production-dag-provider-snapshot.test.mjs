// 图片快照与当前文字设置分别验证，调用提供方时不访问网络。
import test from 'node:test';
import assert from 'node:assert/strict';
import {currentSnapshot,snapshotVariables,providerForSnapshot} from '../server/provider-snapshot.ts';
import {FileMedia} from '../server/media.ts';

const media=new FileMedia('/unused-snapshot-test');
const confirmedWith={SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-key',GEMINI_TEXT_MODEL:'text-at-confirmation',GEMINI_IMAGE_MODEL:'image-at-confirmation',SHIQU_REASONING_PLAN:'high'};

test('only the selected drawing provider and its model are saved',()=>{
 const snapshot=currentSnapshot({...confirmedWith,SHIQU_IMAGE_PROVIDER:'openai',OPENAI_IMAGE_MODEL:'drawing-model',OPENAI_API_KEY:'drawing-key'});
 assert.deepEqual(snapshot,{provider:'openai',models:{image:'drawing-model'}});
});

test('image settings stay fixed while unrelated global text variables and credentials stay current',()=>{
 const snapshot=currentSnapshot(confirmedWith);
 const now={...confirmedWith,GEMINI_API_KEY:'rotated-key',GEMINI_TEXT_MODEL:'newer-text',GEMINI_IMAGE_MODEL:'newer-image',SHIQU_REASONING_PLAN:'low'};
 const merged=snapshotVariables(snapshot,now);
 assert.equal(merged.GEMINI_TEXT_MODEL,'newer-text');
 assert.equal(merged.GEMINI_IMAGE_MODEL,'image-at-confirmation');
 assert.equal(merged.SHIQU_REASONING_PLAN,'low');
 assert.equal(merged.GEMINI_API_KEY,'rotated-key');
});

test('only drawing credentials determine whether an image snapshot is available',()=>{
 const openai=currentSnapshot({SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:'k',OPENAI_IMAGE_MODEL:'drawing-model'});
 assert.deepEqual(providerForSnapshot(openai,{SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'k'},media),{available:false,reason:'snapshot-unavailable'});
 assert.equal(providerForSnapshot(openai,{SHIQU_AI_PROVIDER:'gemini',OPENAI_API_KEY:'k2'},media).available,true);
 const textOnly=currentSnapshot({SHIQU_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'k'});
 assert.equal(providerForSnapshot(textOnly,{DEEPSEEK_API_KEY:'k'},media).available,false);
});

test('Codex drawing keeps its selected invocation model or omits it for the local default',()=>{
 const snapshot=currentSnapshot({SHIQU_AI_PROVIDER:'codex'});
 assert.deepEqual(snapshot,{provider:'codex',models:{image:null}});
 const merged=snapshotVariables(snapshot,{SHIQU_AI_PROVIDER:'gemini',CODEX_MODEL:'set-later-globally'});
 assert.equal(merged.CODEX_MODEL,undefined);
 assert.equal(merged.SHIQU_AI_PROVIDER,'codex');
 const configured=currentSnapshot({...confirmedWith,SHIQU_IMAGE_PROVIDER:'codex',CODEX_MODEL:'drawing-invocation-model'});
 assert.equal(configured.models.image,'drawing-invocation-model');
});

test('format 3 snapshots supply their recorded image side without restoring text options',()=>{
 const legacy={provider:'gemini',imageProvider:'openai',models:{text:'old-text',image:'old-drawing'},taskReasoningEfforts:{plan:'high'}};
 const merged=snapshotVariables(legacy,{GEMINI_TEXT_MODEL:'current-text',SHIQU_REASONING_PLAN:'low'});
 assert.equal(merged.SHIQU_AI_PROVIDER,'openai');
 assert.equal(merged.OPENAI_IMAGE_MODEL,'old-drawing');
 assert.equal(merged.GEMINI_TEXT_MODEL,'current-text');
 assert.equal(merged.SHIQU_REASONING_PLAN,'low');
});
