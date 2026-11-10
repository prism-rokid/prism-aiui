import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateConversations,
  availableAgentsFrom,
  buildDelegateUserPrompt,
  createDelegateRunner,
  normalizeDecision,
  parseDelegateDecision,
  ruleFallbackDecision
} from '../lib/prism-delegate.js';

const agent = (pluginId, extra = {}) => ({
  host_id: 'host-a',
  plugin_id: pluginId,
  display_name: pluginId,
  connected: true,
  available: true,
  ...extra
});

const conversation = (id, pluginId, title, updatedAt, status = 'idle') => ({
  conversation_id: id,
  title,
  status,
  updated_at: updatedAt,
  unread: false
});

function mockApi({ plugins, itemsByPlugin = {}, sends = [] } = {}) {
  return {
    sends,
    getHostPlugins: async () => ({ items: plugins }),
    getConversationIndex: async (_hostId, pluginId) => ({ items: itemsByPlugin[pluginId] || [] }),
    sendMessage: async (hostId, pluginId, conversationId, payload) => {
      sends.push({ kind: 'send', hostId, pluginId, conversationId, payload });
    },
    openDraft: async () => ({ draft_id: 'draft-1' }),
    startDraft: async (hostId, pluginId, draftId, payload) => {
      sends.push({ kind: 'start', hostId, pluginId, draftId, payload });
    }
  };
}

function mockModel(outputs, { streaming = false, chunks = 3 } = {}) {
  const queue = [...outputs];
  const calls = { created: 0, prompts: [], deltas: [], destroyed: 0 };
  const model = {
    calls,
    availability: async () => 'available',
    create: async () => {
      calls.created += 1;
      const session = {
        prompt: async (input) => {
          calls.prompts.push(input);
          const next = queue.shift();
          if (next instanceof Error) throw next;
          return next;
        },
        destroy: () => { calls.destroyed += 1; }
      };
      if (streaming) {
        session.promptStreaming = (input) => {
          calls.prompts.push(input);
          const next = queue.shift();
          const pieces = next instanceof Error ? [] : splitChunks(next, chunks);
          let index = 0;
          return {
            read: async () => {
              if (next instanceof Error && index === 0) {
                index += 1;
                throw next;
              }
              if (index < pieces.length) {
                const value = pieces[index];
                index += 1;
                return { done: false, value };
              }
              return { done: true, value: undefined };
            }
          };
        };
      }
      return session;
    }
  };
  return model;
}

function splitChunks(text, pieces) {
  const source = String(text || '');
  if (!source) return [];
  const size = Math.max(1, Math.ceil(source.length / pieces));
  const out = [];
  for (let index = 0; index < source.length; index += size) {
    out.push(source.slice(index, index + size));
  }
  return out;
}

function collectPhases(runner, requestText) {
  const events = [];
  return runner.run(requestText, (phase, detail) => events.push({ phase, detail }))
    .then(() => events);
}

const PLUGINS = [agent('codex'), agent('claude-code')];
// mockApi 按真实签名以 plugin_id 取会话；直接调用 aggregateConversations 时需换成 host::plugin 键。
const CONV_ITEMS = {
  codex: [conversation('c-1', 'codex', '整理桌面', 2000), conversation('c-2', 'codex', '旧任务', 1000)],
  'claude-code': [conversation('c-3', 'claude-code', 'Claude 会话', 1500)]
};
const CONV_ITEMS_BY_KEY = {
  'host-a::codex': CONV_ITEMS.codex,
  'host-a::claude-code': CONV_ITEMS['claude-code']
};

test('只保留已连接且可用的 Agent，并按更新时间倒序展平会话', () => {
  const agents = availableAgentsFrom([
    agent('codex'),
    agent('offline', { connected: false }),
    agent('busy', { available: false })
  ]);
  assert.deepEqual(agents.map((item) => item.plugin_id), ['codex']);

  const conversations = aggregateConversations(agents, CONV_ITEMS_BY_KEY);
  assert.deepEqual(conversations.map((item) => item.conversationId), ['c-1', 'c-2']);
  assert.equal(conversations[0].agentKey, 'host-a::codex');
});

test('用户提示词包含请求原文、Agent 键与截断后的会话列表', () => {
  const agents = availableAgentsFrom(PLUGINS);
  const conversations = aggregateConversations(agents, CONV_ITEMS_BY_KEY);
  const prompt = buildDelegateUserPrompt('清空回收站', agents, conversations);
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.request, '清空回收站');
  assert.deepEqual(parsed.agents.map((item) => item.agent_key), ['host-a::codex', 'host-a::claude-code']);
  assert.equal(parsed.conversations.length, 3);
  assert.equal(parsed.conversations[0].conversation_id, 'c-1');
});

test('解析模型输出：裸 JSON、围栏包裹、前后闲话均可，非法输出返回 null', () => {
  const decision = parseDelegateDecision('好的，结果如下：\n```json\n{"conversation_id":"c-1","agent_key":"host-a::codex","message":"请清空回收站","reason":"点名"}\n```\n以上。');
  assert.equal(decision.conversationId, 'c-1');
  assert.equal(decision.message, '请清空回收站');

  const fenced = parseDelegateDecision('{"conversation_id":"","agent_key":"host-a::codex","message":"m"}');
  assert.equal(fenced.agentKey, 'host-a::codex');

  assert.equal(parseDelegateDecision('完全不是 JSON'), null);
  assert.equal(parseDelegateDecision('[]'), null);
  assert.equal(parseDelegateDecision('{"message": "缺 id 但可降级"}').message, '缺 id 但可降级');
});

test('白名单校验：会话命中时以其归属 Agent 为准，幻觉 id 整体回退 null', () => {
  const agents = availableAgentsFrom(PLUGINS);
  const conversations = aggregateConversations(agents, CONV_ITEMS_BY_KEY);

  const viaConversation = normalizeDecision(
    { conversationId: 'c-3', agentKey: 'host-a::codex', message: 'm', reason: '' },
    agents, conversations, '原文'
  );
  assert.equal(viaConversation.agent.plugin_id, 'claude-code');

  const viaAgent = normalizeDecision(
    { conversationId: '', agentKey: 'host-a::codex', message: '', reason: '' },
    agents, conversations, '原文兜底'
  );
  assert.equal(viaAgent.agent.plugin_id, 'codex');
  assert.equal(viaAgent.conversation, null);
  assert.equal(viaAgent.message, '原文兜底');

  assert.equal(normalizeDecision(
    { conversationId: 'hallucinated', agentKey: 'host-x::ghost', message: 'm', reason: '' },
    agents, conversations, '原文'
  ), null);
});

test('规则降级：点名别名命中对应 Agent，未点名落到第一个可用 Agent', () => {
  const agents = availableAgentsFrom(PLUGINS);
  const conversations = aggregateConversations(agents, CONV_ITEMS_BY_KEY);

  const named = ruleFallbackDecision('让CodeX清空回收站', agents, conversations);
  assert.equal(named.agent.plugin_id, 'codex');
  assert.equal(named.message, '让CodeX清空回收站');
  assert.equal(named.conversation.conversationId, 'c-1');

  const unnamed = ruleFallbackDecision('帮我把桌面整理一下', agents, conversations);
  assert.equal(unnamed.agent.plugin_id, 'codex');
  assert.equal(unnamed.reason, 'default');

  assert.equal(ruleFallbackDecision('随便', [], []), null);
});

test('完整链路（模型可用）：按模型决策复用会话并发送改写消息', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  const model = mockModel(['{"conversation_id":"c-1","agent_key":"host-a::codex","message":"请把桌面上的文件夹放到回收站","reason":"点名 CodeX"}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '用棱镜把桌面上的文件夹放到回收站');

  assert.deepEqual(events.map((event) => event.phase), ['understanding', 'stream', 'matching', 'sending', 'done']);
  assert.equal(events[4].detail.agent, 'codex');
  assert.equal(events[4].detail.conversationTitle, '整理桌面');
  assert.equal(events[4].detail.isNewConversation, false);
  assert.equal(events[4].detail.conversationId, 'c-1');
  assert.equal(model.calls.destroyed, 1);

  assert.equal(api.sends.length, 1);
  assert.equal(api.sends[0].kind, 'send');
  assert.equal(api.sends[0].conversationId, 'c-1');
  assert.equal(api.sends[0].payload.content, '请把桌面上的文件夹放到回收站');
  assert.match(api.sends[0].payload.message_id, /^delegate-/);
});

test('完整链路（新会话）：模型只给 Agent 时走草稿新建', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: { codex: [], 'claude-code': CONV_ITEMS['claude-code'] } });
  const model = mockModel(['{"conversation_id":"","agent_key":"host-a::codex","message":"请清空回收站","reason":"点名"}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX清空回收站');

  assert.equal(events.at(-1).phase, 'done');
  assert.equal(events.at(-1).detail.isNewConversation, true);
  assert.equal(api.sends.length, 1);
  assert.equal(api.sends[0].kind, 'start');
  assert.equal(api.sends[0].draftId, 'draft-1');
  assert.equal(api.sends[0].payload.content, '请清空回收站');
});

test('模型不可用或输出非法时降级为规则匹配，消息用请求原文', async () => {
  for (const model of [null, mockModel(['不是 JSON', '还是不是 JSON'])]) {
    const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
    const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX清空回收站');
    assert.equal(events.at(-1).phase, 'done');
    assert.equal(api.sends[0].conversationId, 'c-1');
    assert.equal(api.sends[0].payload.content, '让CodeX清空回收站');
  }
});

test('模型输出幻觉 id 时整体回退规则匹配', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  const model = mockModel(['{"conversation_id":"ghost","agent_key":"host-x::ghost","message":"m","reason":""}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX清空回收站');
  assert.equal(events.at(-1).phase, 'done');
  assert.equal(api.sends[0].conversationId, 'c-1');
  assert.equal(api.sends[0].payload.content, '让CodeX清空回收站');
});

test('流式模型：增量回调累计文本，可读前导句 + JSON 尾部均可解析，done 携带会话定位', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  const reply = '已选择 CodeX 的最近会话，语义相关。\n{"conversation_id":"c-1","agent_key":"host-a::codex","message":"请整理桌面","reason":"点名"}';
  const model = mockModel([reply], { streaming: true });
  const events = await collectPhases(createDelegateRunner({ api, model }), '用棱镜整理桌面文件');

  assert.deepEqual(events.map((event) => event.phase), ['understanding', 'stream', 'stream', 'stream', 'matching', 'sending', 'done']);
  assert.equal(events[1].detail.text.length > 0, true);
  assert.ok(events[2].detail.text.length > events[1].detail.text.length, 'deltas accumulate');

  assert.equal(events[6].detail.agent, 'codex');
  assert.equal(events[6].detail.hostId, 'host-a');
  assert.equal(events[6].detail.pluginId, 'codex');
  assert.equal(events[6].detail.conversationId, 'c-1');
  assert.equal(events[6].detail.conversationTitle, '整理桌面');
  assert.equal(api.sends[0].payload.content, '请整理桌面');
});

test('不支持流式的会话退回一次性 prompt，行为不变', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  const model = mockModel(['{"conversation_id":"c-1","agent_key":"host-a::codex","message":"m","reason":""}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX整理桌面');
  assert.equal(events.at(-1).phase, 'done');
  assert.equal(events.at(-1).detail.conversationId, 'c-1');
  assert.equal(events.filter((event) => event.phase === 'stream').length, 1, 'single non-streaming delta');
});

test('发送失败时 error 明细同样携带目标定位，全屏仍可进入', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  api.sendMessage = async () => { throw new Error('NETWORK'); };
  const model = mockModel(['{"conversation_id":"c-1","agent_key":"host-a::codex","message":"m","reason":""}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX整理桌面');
  assert.equal(events.at(-1).phase, 'error');
  assert.equal(events.at(-1).detail.hostId, 'host-a');
  assert.equal(events.at(-1).detail.pluginId, 'codex');
  assert.equal(events.at(-1).detail.conversationId, 'c-1');
});

test('云端 202 但 accepted:false 时如实报 sendFailed，不误报已委托', async () => {
  const api = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  api.sendMessage = async () => ({ request_id: 'r1', accepted: false, error_message: 'composer not ready' });
  const model = mockModel(['{"conversation_id":"c-1","agent_key":"host-a::codex","message":"m","reason":""}']);
  const events = await collectPhases(createDelegateRunner({ api, model }), '让CodeX清空回收站');
  assert.deepEqual(events.map((event) => event.phase), ['understanding', 'stream', 'matching', 'sending', 'error']);
  assert.equal(events[4].detail.code, 'sendFailed');
  assert.match(events[4].detail.message, /composer not ready/);
});

test('没有可用 Agent 或发送失败时进入 error，且不重复发送', async () => {
  const emptyApi = mockApi({ plugins: [agent('offline', { connected: false })] });
  const emptyEvents = await collectPhases(createDelegateRunner({ api: emptyApi, model: null }), '随便');
  assert.deepEqual(emptyEvents.map((event) => event.phase), ['understanding', 'error']);
  assert.equal(emptyEvents[1].detail.code, 'noAgents');

  let attempts = 0;
  const failingApi = mockApi({ plugins: PLUGINS, itemsByPlugin: CONV_ITEMS });
  failingApi.sendMessage = async () => {
    attempts += 1;
    throw new Error('NETWORK');
  };
  const failEvents = await collectPhases(createDelegateRunner({ api: failingApi, model: null }), '让CodeX清空回收站');
  assert.deepEqual(failEvents.map((event) => event.phase), ['understanding', 'matching', 'sending', 'error']);
  assert.equal(failEvents[3].detail.code, 'sendFailed');
  assert.equal(attempts, 1);
});
