import assert from 'node:assert/strict';
import test from 'node:test';

import { createDelegateRunner } from '../lib/prism-delegate.js';
import { findNewConversation } from '../lib/prism-delegate-watch.js';

const codex = { host_id: 'work', plugin_id: 'codex', connected: true, available: true };
const claude = { ...codex, plugin_id: 'claudecode' };
const apiDirectory = '/repos/rokid-prism-api';
const panelDirectory = '/repos/rokid-prism-panel';
const apiThread = { conversation_id: 'api-old', cwd: apiDirectory, title: '更新接口', updated_at: 1 };
const panelThread = { conversation_id: 'panel-old', cwd: panelDirectory, title: '调整页面布局', updated_at: 2 };

async function run(request, { agents = [codex], index = () => [panelThread, apiThread], model, startError } = {}) {
  const writes = [];
  const events = [];
  const api = {
    getHostPlugins: async () => ({ items: agents }),
    getConversationIndex: async (host, plugin) => ({ items: index(host, plugin) }),
    openDraft: async (...args) => {
      writes.push(['open', ...args]);
      return { draft_id: 'draft' };
    },
    startDraft: async (...args) => {
      writes.push(['start', ...args]);
      if (startError) throw startError;
      return { conversation_id: 'new-chat' };
    },
    sendMessage: async (...args) => { writes.push(['send', ...args]); }
  };
  await createDelegateRunner({
    getApi: async () => api,
    getModel: async () => model ? {
      create: async () => ({ prompt: async (raw) => JSON.stringify(model(JSON.parse(raw))), destroy() {} })
    } : null
  }).run(request, (phase, detail) => events.push({ phase, detail }));
  return { writes, terminal: events.at(-1) };
}

test('the model receives the unfiltered catalog, and its new action ignores any conversation ID', async () => {
  const request = '让 Codex 在 rokid-prism-api 项目里新开一个会话，检查接口';
  let context;
  const { writes, terminal } = await run(request, {
    model: (prompt) => {
      context = prompt;
      const project = prompt.projects.find((item) => item.directory === apiDirectory);
      return {
        action: 'new', project_key: project.project_key, conversation_id: 'api-old',
        agent_key: 'work::codex', message: '检查接口'
      };
    }
  });
  assert.equal(context.request, request);
  assert.deepEqual(context.projects.map((item) => item.directory), [panelDirectory, apiDirectory]);
  assert.deepEqual(context.conversations.map((item) => item.conversation_id), ['panel-old', 'api-old']);
  assert.deepEqual(writes[0], ['open', 'work', 'codex', { cwd: apiDirectory }]);
  assert.equal(writes[1][0], 'start');
  assert.equal(writes[1][4].cwd, apiDirectory);
  assert.equal(writes[1][4].content, '检查接口');
  assert.equal(writes.length, 2);
  assert.equal(terminal.phase, 'done');
  assert.equal(terminal.detail.conversationId, 'new-chat');
});

test('model unavailable or missing an action does not fall back to a write', async () => {
  const request = '在「/repos/rokid-prism-api」项目里开个新会话';
  for (const model of [
    undefined,
    () => ({ conversation_id: 'api-old', agent_key: 'work::codex' }),
    () => ({ action: 'new_in_default_directory', agent_key: 'work::codex' })
  ]) {
    const { writes, terminal } = await run(request, { model });
    assert.deepEqual(writes, []);
    assert.equal(terminal.detail.code, 'intentUnavailable');
  }
});

test('the model can match a semantic project description to a catalog key and create there', async () => {
  const { writes } = await run('用棱镜处理一下手机控制台的布局', {
    index: () => [panelThread, apiThread, {
      conversation_id: 'projectless', cwd: '/Users/me/Documents/Codex/2026-11-11/task', updated_at: 3
    }],
    model: (prompt) => {
      const project = prompt.projects.find((item) => item.directory === panelDirectory);
      assert.deepEqual(prompt.projects.map((item) => item.directory), [panelDirectory, apiDirectory]);
      assert.equal(prompt.conversations[0].project_key, '');
      assert.equal(prompt.conversations[1].project_key, project.project_key);
      return { action: 'new', project_key: project.project_key, agent_key: 'work::codex' };
    }
  });
  assert.deepEqual(writes.map((item) => item[0]), ['open', 'start']);
  assert.equal(writes[0][3].cwd, panelDirectory);
});

test('the model can disambiguate identical directories by host and agent', async () => {
  const other = { ...claude, host_id: 'home', host_alias: '家里电脑' };
  const { writes } = await run('用家里电脑上的 Claude Code 给接口项目开个新会话', {
    agents: [codex, other],
    index: () => [apiThread],
    model: (prompt) => {
      const agent = prompt.agents.find((item) => item.host === '家里电脑');
      const project = prompt.projects.find((item) => item.agent_keys.includes(agent.agent_key));
      return { action: 'new', project_key: project.project_key, agent_key: agent.agent_key };
    }
  });
  assert.deepEqual(writes[0], ['open', 'home', 'claudecode', { cwd: apiDirectory }]);
});

test('ambiguous, unavailable and invalid model targets cause no write', async () => {
  const cases = [
    ['在 rokid-prism-api 项目里新开会话', {
      index: () => [apiThread, { ...apiThread, cwd: '/other/rokid-prism-api' }],
      model: () => ({ action: 'projectAmbiguous' })
    }, 'projectAmbiguous'],
    ['在 not-a-known-repo 项目里新开会话', {
      model: () => ({ action: 'projectUnavailable' })
    }, 'projectUnavailable'],
    ['帮我在项目里处理接口', {
      model: () => ({ action: 'new', project_key: 'made-up', agent_key: 'work::codex' })
    }, 'projectUnavailable'],
    ['开个新会话', {
      model: () => ({ action: 'new', agent_key: 'work::codex' })
    }, 'projectUnavailable']
  ];
  for (const [request, options, error] of cases) {
    const { writes, terminal } = await run(request, options);
    assert.deepEqual(writes, [], request);
    assert.equal(terminal.detail.code, error, request);
  }
});

test('a normal request reuses only a conversation in the named project', async () => {
  const { writes } = await run('在 rokid-prism-api 项目里修复新建会话功能', {
    model: (prompt) => {
      const project = prompt.projects.find((item) => item.directory === apiDirectory);
      return {
        action: 'reuse', project_key: project.project_key,
        conversation_id: 'api-old', agent_key: 'work::codex'
      };
    }
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 4), ['send', 'work', 'codex', 'api-old']);
});

test('a model-selected conversation must belong to both the selected project and agent', async () => {
  const mismatches = [
    { conversation_id: 'panel-old', agent_key: 'work::codex' },
    { conversation_id: 'api-old', agent_key: 'work::claudecode' }
  ];
  for (const mismatch of mismatches) {
    const { writes, terminal } = await run('继续上次的接口任务', {
      agents: [codex, claude],
      index: (_host, plugin) => plugin === codex.plugin_id
        ? [panelThread, apiThread] : [{ ...apiThread, conversation_id: 'claude-api' }],
      model: (prompt) => {
        const project = prompt.projects.find((item) => item.directory === apiDirectory);
        return { action: 'reuse', project_key: project.project_key, ...mismatch };
      }
    });
    assert.deepEqual(writes, []);
    assert.equal(terminal.detail.code, 'intentUnavailable');
  }
});

test('draft discovery excludes known threads and other directories', async () => {
  const found = await findNewConversation({
    getConversationIndex: async () => ({ items: [
      { ...apiThread, updated_at: 10 },
      { ...panelThread, updated_at: 9 },
      { conversation_id: 'api-new', cwd: apiDirectory, updated_at: 8 }
    ] })
  }, { cwd: apiDirectory, knownConversationIds: ['api-old'], sinceTs: 5 });
  assert.equal(found, 'api-new');
});

test('a Codex receipt error checks fresh conversation history without resending or guessing', async () => {
  const { writes, terminal } = await run('让 Codex 新开会话检查接口', {
    model: (prompt) => ({
      action: 'new', agent_key: 'work::codex', message: '检查接口',
      project_key: prompt.projects.find((item) => item.directory === apiDirectory).project_key
    }),
    startError: new Error('codex could not verify the draft first message: marker not found in Codex thread/read history')
  });
  assert.deepEqual(writes.map((item) => item[0]), ['open', 'start']);
  assert.equal(terminal.phase, 'verifying');
  assert.equal(terminal.detail.submission.messageId, writes[1][4].message_id);

  const { startedAt } = terminal.detail.submission;
  const checked = [];
  const closed = [];
  const api = {
    getConversationIndex: async () => ({ items: [
      { ...apiThread, updated_at: startedAt + 10 },
      { ...panelThread, conversation_id: 'other-project', updated_at: startedAt + 9 },
      { ...apiThread, conversation_id: 'unrelated', updated_at: startedAt + 8 },
      { ...apiThread, conversation_id: 'confirmed', updated_at: startedAt + 7 }
    ] }),
    openConversationStream({ conversationId, onFrame, onClose }) {
      checked.push(conversationId);
      onFrame({ type: 'conversation.messages.turn', turn: { messages: [{
        role: 'user', id: 'native-message', created_at: startedAt,
        content: conversationId === 'confirmed' ? '检查接口' : '另一项任务'
      }] } });
      onClose();
      return { abort() {} };
    },
    closeStateStream: async (id) => { closed.push(id); }
  };
  assert.equal(await findNewConversation(api, { ...terminal.detail, sinceTs: startedAt }), 'confirmed');
  assert.deepEqual(checked, ['unrelated', 'confirmed']);
  assert.equal(closed.length, 2);
  assert.equal(await findNewConversation(api, {
    ...terminal.detail, submission: { ...terminal.detail.submission, message: '不存在的消息' },
    sinceTs: startedAt, timeoutMs: 20, pollMs: 20
  }), null);
});
