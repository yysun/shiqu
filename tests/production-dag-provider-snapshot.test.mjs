// 模型快照：确认时记录的提供方与模型在之后的调用中生效；快照服务缺少凭据时不可用（场景 22 的提供方部分）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {currentSnapshot,snapshotVariables,providerForSnapshot} from '../server/provider-snapshot.ts';
import {FileMedia} from '../server/media.ts';

const media=new FileMedia('/unused-snapshot-test');
const confirmedWith={SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-key',GEMINI_TEXT_MODEL:'text-at-confirmation',GEMINI_IMAGE_MODEL:'image-at-confirmation',SHIQU_REASONING_PLAN:'high'};

test('the snapshot records provider, models and reasoning but no credentials',()=>{
 const snapshot=currentSnapshot(confirmedWith);
 assert.equal(snapshot.provider,'gemini');
 assert.deepEqual(snapshot.models,{text:'text-at-confirmation',image:'image-at-confirmation'});
 assert.equal(snapshot.taskReasoningEfforts?.plan,'high');
 assert.ok(!JSON.stringify(snapshot).includes('test-key'));
});

test('later global changes do not override the snapshot; credentials come from current settings',()=>{
 const snapshot=currentSnapshot(confirmedWith);
 const now={...confirmedWith,GEMINI_API_KEY:'rotated-key',GEMINI_TEXT_MODEL:'newer-text',GEMINI_IMAGE_MODEL:'newer-image',SHIQU_REASONING_PLAN:'low'};
 const merged=snapshotVariables(snapshot,now);
 assert.equal(merged.GEMINI_TEXT_MODEL,'text-at-confirmation');
 assert.equal(merged.GEMINI_IMAGE_MODEL,'image-at-confirmation');
 assert.equal(merged.SHIQU_REASONING_PLAN,'high');
 assert.equal(merged.GEMINI_API_KEY,'rotated-key');
 assert.equal(currentSnapshot(merged).models.text,'text-at-confirmation');
});

test('a snapshot whose service has no credentials now is reported unavailable',()=>{
 const openai=currentSnapshot({SHIQU_AI_PROVIDER:'openai',OPENAI_API_KEY:'k',OPENAI_TEXT_MODEL:'gpt-text'});
 assert.deepEqual(providerForSnapshot(openai,{SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'k'},media),{available:false,reason:'snapshot-unavailable'});
 assert.equal(providerForSnapshot(openai,{SHIQU_AI_PROVIDER:'gemini',GEMINI_API_KEY:'k',OPENAI_API_KEY:'k2'},media).available,true);
});

test('a subscription CLI without a configured model keeps its own default instead of a display label',()=>{
 const snapshot=currentSnapshot({SHIQU_AI_PROVIDER:'codex'});
 assert.equal(snapshot.models.text,null);
 const merged=snapshotVariables(snapshot,{SHIQU_AI_PROVIDER:'gemini',CODEX_MODEL:'set-later-globally'});
 assert.equal(merged.CODEX_MODEL,undefined);
 assert.equal(merged.SHIQU_AI_PROVIDER,'codex');
});
