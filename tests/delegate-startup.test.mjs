import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createDelegateRunner } from '../lib/prism-delegate.js';
import { watchAgentReply } from '../lib/prism-delegate-watch.js';

const agent = { host_id: 'host', plugin_id: 'codex', connected: true, available: true };
const requestText = '让 Codex 检查文档';
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const projectIndex = { items: [{ conversation_id: 'docs', cwd: '/workspace/docs' }] };
const projectModel = {
  create: async () => ({
    prompt: async (raw) => JSON.stringify({
      action: 'new', project_key: JSON.parse(raw).projects[0].project_key, agent_key: 'host::codex'
    }),
    destroy() {}
  })
};

test('delegate prepares the model during authentication and waits for the full catalog before prompting', async () => {
  let resolveAuth;
  let resolveIndex;
  let resolveModel;
  const calls = [];
  const api = {
    getHostPlugins: async () => ({ items: [agent] }),
    getConversationIndex: () => new Promise((resolve) => {
      calls.push('index');
      resolveIndex = resolve;
    }),
    sendMessage: async (_host, _plugin, conversationId, payload) => {
      calls.push('send');
      assert.equal(conversationId, 'docs');
      assert.equal(payload.content, '检查文档');
    }
  };
  const runner = createDelegateRunner({
    getApi: () => new Promise((resolve) => { resolveAuth = resolve; }),
    getModel: () => ({
      create: () => new Promise((resolve) => {
        calls.push('model.create');
        resolveModel = resolve;
      })
    })
  });

  const phases = [];
  const run = runner.run(requestText, (phase) => phases.push(phase));
  await nextTurn();
  assert.deepEqual(calls, ['model.create']);
  resolveAuth(api);
  await nextTurn();
  assert.deepEqual(calls, ['model.create', 'index']);
  resolveModel({
    prompt: async (prompt) => {
      calls.push('prompt');
      assert.equal(JSON.parse(prompt).conversations[0].conversation_id, 'docs');
      return '{"action":"reuse","conversation_id":"docs","agent_key":"host::codex","message":"检查文档"}';
    },
    destroy: () => calls.push('model.destroy')
  });
  await nextTurn();
  assert.deepEqual(calls, ['model.create', 'index']);
  resolveIndex({ items: [{ conversation_id: 'docs', title: '项目文档' }] });
  await run;
  assert.deepEqual(calls, ['model.create', 'index', 'prompt', 'model.destroy', 'send']);
  assert.deepEqual(phases, ['matching', 'sending', 'done']);
});

test('authentication failure completes before model preparation and releases a late session', async () => {
  const failure = new Error('auth failed');
  let resolveModel;
  let destroyed = 0;
  const runner = createDelegateRunner({
    getApi: async () => { throw failure; },
    getModel: () => ({ create: () => new Promise((resolve) => { resolveModel = resolve; }) })
  });
  const events = [];
  await runner.run(requestText, (phase, detail) => events.push({ phase, detail }));
  assert.deepEqual(events.at(-1), { phase: 'error', detail: { code: 'authFailed', error: failure } });
  resolveModel({ destroy: () => { destroyed += 1; } });
  await nextTurn();
  assert.equal(destroyed, 1);
});

test('delegate card renders immediately and watches the draft response ID without polling', async () => {
  const source = (await readFile(new URL('../pages/delegate/index.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '')
    .replace('export default', 'return');
  let watchedId;
  let replyCallbacks;
  let indexPolls = 0;
  let writes = 0;
  const api = {
    getHostPlugins: async () => ({ items: [agent] }),
    getConversationIndex: async () => projectIndex,
    openDraft: async () => ({ draft_id: 'draft' }),
    startDraft: async () => {
      writes += 1;
      return { accepted: true, conversation_id: 'new-conversation' };
    }
  };
  const load = new Function('wx', 'initI18n', 't', 'createDelegateRunner', 'watchAgentReply', 'findNewConversation', source);
  const page = load({}, () => {}, (key) => key, createDelegateRunner, (_api, options) => {
    watchedId = options.conversationId;
    replyCallbacks = options;
    return { stop() {} };
  }, async () => {
    indexPolls += 1;
    return null;
  });
  page.createApi = async () => api;
  page.resolveModel = async () => projectModel;
  page.setData = (patch) => Object.assign(page.data, patch);
  assert.equal(page.onLoad({ request: requestText }), undefined);
  assert.equal(page.data.stepTitle, 'delegate.understanding');
  assert.equal(page.data.indicators.length, 5);
  assert.equal(writes, 0);
  await nextTurn();
  assert.equal(page.data.stepTitle, 'delegate.agentReplying');
  assert.equal(page._delegateTarget.conversationId, 'new-conversation');
  assert.equal(watchedId, 'new-conversation');
  assert.equal(indexPolls, 0);
  assert.equal(writes, 1);
  const longReply = '桌面已整理，文件都已移动到对应的文件夹。'.repeat(8);
  replyCallbacks.onText(longReply);
  assert.equal(page.data.stepContent, longReply);
  replyCallbacks.onCompleted(longReply);
  assert.equal(page.data.stepContent, longReply);
  assert.equal(page.data.stepTitle, 'delegate.agentReplied');
});

test('legacy draft responses keep discovery and rejected responses never become done', async () => {
  for (const [response, phase] of [[{}, 'done'], [{ accepted: false, conversation_id: 'unused' }, 'error']]) {
    const api = {
      getHostPlugins: async () => ({ items: [agent] }),
      getConversationIndex: async () => projectIndex,
      openDraft: async () => ({ draft_id: 'draft' }),
      startDraft: async () => response
    };
    const events = [];
    await createDelegateRunner({ getApi: async () => api, getModel: async () => projectModel })
      .run(requestText, (event, detail) => events.push({ event, detail }));
    assert.equal(events.at(-1).event, phase);
    assert.equal(events.at(-1).detail.conversationId, '');
  }
});

test('a reply stream that times out reconnects and reads the completed reply from history', async () => {
  const closed = [];
  const completed = [];
  const opened = [];
  let resolveReply;
  const reply = new Promise((resolve) => { resolveReply = resolve; });
  const watch = watchAgentReply({
    openConversationStream({ streamId, onClose, onFrame }) {
      opened.push(streamId);
      if (opened.length === 1) onClose({ reason: 'failed', message: 'send timeout' });
      else onFrame({ type: 'conversation.messages.turn', turn: { messages: [
        { role: 'assistant', status: 'completed', content: '不客气！' },
        { role: 'assistant', status: 'completed', content: '' }
      ] } });
      return { abort() {} };
    },
    closeStateStream: async (id) => { closed.push(id); }
  }, { retryDelayMs: 0, onCompleted: (text) => { completed.push(text); resolveReply(); } });
  assert.deepEqual(completed, []);
  await reply;
  watch.stop();
  assert.equal(new Set(opened).size, 2);
  assert.deepEqual(closed, opened);
  assert.deepEqual(completed, ['不客气！']);
});

test('an empty reply stream reports a read error after retries', async () => {
  let attempts = 0;
  let completed = false;
  const error = await new Promise((resolve) => watchAgentReply({
    openConversationStream({ onClose }) {
      attempts += 1;
      onClose({ reason: 'completed' });
      return { abort() {} };
    },
    closeStateStream: async () => {}
  }, { retryDelayMs: 0, onCompleted: () => { completed = true; }, onError: resolve }));
  assert.equal(attempts, 3);
  assert.equal(completed, false);
  assert.equal(error, 'completed');
});

test('the live Codex turn displays Agent text with Ink timer argument checks', (context) => {
  const cancelTimer = globalThis.clearTimeout;
  context.mock.method(globalThis, 'clearTimeout', (timer) => {
    assert.notEqual(timer, undefined, 'Ink cannot convert undefined to a timer ID');
    cancelTimer(timer);
  });
  const startedAt = Date.now();
  const user = { role: 'user', content: '检查文档', created_at: startedAt };
  const updates = [];
  const completed = [];
  let frame;
  const watcher = watchAgentReply({
    openConversationStream({ onFrame }) {
      frame = onFrame;
      return { abort() {} };
    },
    closeStateStream: async () => {}
  }, {
    submission: { messageId: 'delegate-current', message: user.content, startedAt },
    minCreatedAt: startedAt - 30000,
    onText: (text) => updates.push(text),
    onCompleted: (text) => completed.push(text)
  });
  const turn = (id, messages) => frame({
    type: 'conversation.messages.turn', operation: 'replace', turn: { turn_id: id, messages }
  });
  try {
    turn('older', [{ ...user, content: '上一条任务' }, { role: 'assistant', content: '上一条回复' }]);
    turn('current', [user, {
      role: 'assistant', type: 'progress', status: 'running', content: '我先看目录。'
    }]);
    turn('current', [user, {
      role: 'assistant', type: 'progress', progress: { status: 'running', steps: [
        { kind: 'assistant_text', detail: '找到了两处问题。' },
        { kind: 'tool', detail: '命令输出' }
      ] }
    }]);
    assert.deepEqual(updates, ['我先看目录。', '找到了两处问题。']);
    assert.deepEqual(completed, []);
    turn('current', [user, {
      role: 'assistant', type: 'progress', status: 'completed', content: '已处理 5 秒'
    }, { role: 'assistant', type: 'text', content: '文档检查完成。' }]);
    assert.equal(updates.at(-1), '文档检查完成。');
    assert.deepEqual(completed, ['文档检查完成。']);
  } finally {
    watcher.stop();
  }
});
