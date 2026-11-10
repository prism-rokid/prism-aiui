import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assistantReplyFromMessages,
  findNewConversation,
  isMessageComplete,
  watchAgentReply
} from '../lib/prism-delegate-watch.js';

test('assistantReplyFromMessages 取最后一条 assistant 文本，isMessageComplete 判定完成态', () => {
  const messages = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '第一版', status: 'sending' },
    { role: 'assistant', content: '你好，我是 Codex！', status: 'completed' }
  ];
  assert.equal(assistantReplyFromMessages(messages), '你好，我是 Codex！');
  assert.equal(isMessageComplete({ status: 'sending' }), false);
  assert.equal(isMessageComplete({ status: 'completed' }), true);
  assert.equal(isMessageComplete({}), true);
});

test('watchAgentReply：turn 帧推送流式文本，全部完成后回调完成并关流', async () => {
  let frames = null;
  let closed = false;
  const api = {
    openConversationStream: (config) => {
      frames = config;
      return { abort() {} };
    },
    closeStateStream: async () => { closed = true; }
  };
  const texts = [];
  let completedText = null;
  const watcher = watchAgentReply(api, {
    hostId: 'h', pluginId: 'p', conversationId: 'c',
    onText: (text) => texts.push(text),
    onCompleted: (text) => { completedText = text; }
  });

  frames.onFrame({ type: 'conversation.messages.turn', turn: { messages: [
    { role: 'user', content: '打招呼', created_at: 100 },
    { role: 'assistant', content: '你好', status: 'sending', created_at: 200 }
  ] } });
  frames.onFrame({ type: 'conversation.messages.turn', turn: { messages: [
    { role: 'assistant', content: '你好，我是 Codex！', status: 'completed', created_at: 300 }
  ] } });

  assert.deepEqual(texts, ['你好', '你好，我是 Codex！']);
  assert.equal(completedText, '你好，我是 Codex！');

  watcher.stop();
  assert.equal(closed, true);
});

test('watchAgentReply：minCreatedAt 过滤历史回复，旧消息不触发完成', () => {
  let frames = null;
  const api = {
    openConversationStream: (config) => { frames = config; return { abort() {} }; },
    closeStateStream: async () => {}
  };
  let completedText = null;
  const watcher = watchAgentReply(api, {
    hostId: 'h', pluginId: 'p', conversationId: 'c', minCreatedAt: 1000,
    onText: () => {},
    onCompleted: (text) => { completedText = text; }
  });

  frames.onFrame({ type: 'conversation.snapshot', detail: { messages: [
    { role: 'assistant', content: '上一轮的旧回复', status: 'completed', created_at: 500 }
  ] } });
  assert.equal(completedText, null);

  frames.onFrame({ type: 'conversation.messages.turn', turn: { messages: [
    { role: 'assistant', content: '本轮回复', status: 'completed', created_at: 2000 }
  ] } });
  assert.equal(completedText, '本轮回复');

  watcher.stop();
});

test('watchAgentReply：流关闭按已收文本完成', () => {
  let frames = null;
  const api = {
    openConversationStream: (config) => { frames = config; return { abort() {} }; },
    closeStateStream: async () => {}
  };
  let completedText = null;
  const watcher = watchAgentReply(api, {
    hostId: 'h', pluginId: 'p', conversationId: 'c',
    onCompleted: (text) => { completedText = text; }
  });

  frames.onFrame({ type: 'conversation.messages.turn', turn: { messages: [
    { role: 'assistant', content: '部分回复', status: 'sending', created_at: 200 }
  ] } });
  frames.onFrame({ type: 'stream.close' });
  assert.equal(completedText, '部分回复');

  watcher.stop();
});

test('findNewConversation：轮询索引直到出现 sinceTs 之后的新会话', async () => {
  let polls = 0;
  const api = {
    getConversationIndex: async () => {
      polls += 1;
      if (polls < 3) return { items: [] };
      return { items: [
        { conversation_id: 'old', title: '旧', updated_at: 100 },
        { conversation_id: 'new', title: '新会话', updated_at: 5000 }
      ] };
    }
  };
  const found = await findNewConversation(api, {
    hostId: 'h', pluginId: 'p', sinceTs: 1000, pollMs: 1, timeoutMs: 500
  });
  assert.equal(found.conversationId, 'new');
  assert.equal(found.title, '新会话');
});

test('findNewConversation：超时未出现返回 null', async () => {
  const api = { getConversationIndex: async () => ({ items: [{ conversation_id: 'old', updated_at: 1 }] }) };
  const found = await findNewConversation(api, {
    hostId: 'h', pluginId: 'p', sinceTs: 1000, pollMs: 1, timeoutMs: 30
  });
  assert.equal(found, null);
});
