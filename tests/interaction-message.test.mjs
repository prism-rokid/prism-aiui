import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMessage,buildChatItems} from '../lib/prism-chat-model.js';
import {setLocale} from '../lib/prism-i18n.js';
setLocale('zh-CN',{persist:false});
const wrap=(tag,value)=>`<${tag}>\n${JSON.stringify(value)}\n</${tag}>`;
test('native question reply shows question and answer without transport identifiers; raw record preserved',()=>{
 const content=wrap('send_user_message_question_reply',[{questionItemId:'["request_user_input_async","call_secret",0]',question:'今晚想吃什么？',answer:'麻婆豆腐。'}]);
 const m=normalizeMessage({id:'reply',role:'user',content},0);const [item]=buildChatItems([m]);
 assert.equal(m.content,content);assert.equal(item.interactionTitle,'问题回复');assert.equal(item.content,'问题：今晚想吃什么？\n回答：麻婆豆腐。');assert.doesNotMatch(item.content,/call_secret|questionItemId|send_user_message|[{}]/);
});
test('approval envelopes show localized decisions and hide internal IDs',()=>{
 const m=normalizeMessage({role:'user',content:wrap('approval_response',{decision:'approved',request_id:'internal'})},0);
 assert.equal(m.displayContent,'已批准');assert.equal(m.interactionTitle,'审批回复');
});
test('malformed native reply never falls back to raw JSON',()=>{
 const m=normalizeMessage({role:'user',content:'<send_user_message_question_reply>{broken</send_user_message_question_reply>'},0);assert.equal(m.displayContent,'已记录回复');
});
test('multiple question replies remain readable and empty replies show skipped',()=>{
 const m=normalizeMessage({role:'user',content:wrap('send_user_message_question_reply',[{question:'A',answer:'x'},{question:'B',answer:''}])},0);assert.equal(m.displayContent,'问题：A\n回答：x\n问题：B\n回答：已跳过');
});
test('ordinary source code, prose and assistant examples are preserved',()=>{
 for(const content of ['{"answer":"hello"}','示例：<send_user_message_question_reply>[]</send_user_message_question_reply>','```xml\n<send_user_message_question_reply>[]</send_user_message_question_reply>\n```'])assert.equal(normalizeMessage({role:'user',content},0).interactionTitle,'');
 const m=normalizeMessage({role:'assistant',content:wrap('send_user_message_question_reply',[])},0);assert.equal(m.interactionTitle,'');
});
