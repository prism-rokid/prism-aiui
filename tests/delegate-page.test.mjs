// Delegate page smoke: evaluate pages/delegate/index.js with device imports
// stubbed, then drive applyPhase and the reply watcher through every branch.
// Guards against free-identifier ReferenceErrors and step-machine regressions
// that pure-runner unit tests cannot see and that previously only surfaced on
// device. Node exposes navigator.language (usually en-US), so the pack is
// pinned via an injected zh-CN navigator.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initI18n, t, buildTextMap } from '../lib/prism-i18n.js';
import { truncateDisplayText } from '../lib/widget-data.js';

const ZH_NAVIGATOR = { language: 'zh-CN', languages: ['zh-CN'] };

function makeStubs() {
  const watch = { handlers: null };
  const stubs = {
    wx: { getStorageSync: () => '', setStorageSync: () => {}, navigateTo: () => {} },
    createPrismApi: () => ({}),
    PRODUCTION_API_BASE_URL: 'https://ai-cloud.rokid.com/prism/api',
    readableError: () => 'error',
    resolveAccountCredential: async () => ({ accountToken: 't' }),
    LOCAL_DEBUG_AUTH: { baseUrl: '', accountToken: '' },
    createDelegateRunner: () => ({ run: async () => {} }),
    findNewConversation: async () => ({ conversationId: 'c-9', title: '新会话', updatedAt: 1 }),
    watchAgentReply: (api, config) => {
      watch.handlers = config;
      return { stop() {} };
    },
    truncateDisplayText,
    initI18n,
    t,
    buildTextMap
  };
  stubs.watch = watch;
  return stubs;
}

async function loadPageConfig(stubs) {
  const source = (await readFile(new URL('../pages/delegate/index.js', import.meta.url), 'utf8'))
    .replace(/^import\s+.*;\s*$/gm, '')
    .replace('export default {', 'const pageConfig = {');
  const names = Object.keys(stubs);
  const factory = new Function(...names, `${source}\nreturn pageConfig;`);
  return factory(...names.map((name) => stubs[name]));
}

function makeContext(page) {
  const ctx = {
    data: JSON.parse(JSON.stringify(page.data)),
    _destroyed: false,
    _stepIndex: 0,
    _phase: '',
    _aiText: '',
    _replyText: '',
    _delegateTarget: null,
    _replySinceTs: 0,
    setData(patch) { Object.assign(this.data, patch); }
  };
  return Object.assign(ctx, page);
}

test('delegate card walks the five-step design state machine', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const stubs = makeStubs();
  const page = await loadPageConfig(stubs);
  const ctx = makeContext(page);

  ctx.applyPhase('understanding', {});
  assert.equal(ctx.data.stepTitle, t('delegate.understanding'));
  assert.equal(ctx.data.indicators.length, 5);
  assert.equal(ctx.data.indicators[0].className, 'delegate-ind-dot-active');

  ctx.applyPhase('stream', { text: '已选择 CodeX 的最近会话。{"conversation_id":"c-1"}' });
  assert.equal(ctx.data.stepContent.includes('…'), true, 'AI 分析只展示可读前导句');

  ctx.applyPhase('matching', { agent: 'Codex' });
  ctx.applyPhase('sending', { agent: 'Codex' });
  assert.equal(ctx.data.stepTitle, t('delegate.sending'));
  assert.equal(ctx.data.stepContent.includes('CodeX'), true, 'AI 分析文本在发送步持续展示');

  ctx.applyPhase('done', {
    agent: 'Codex', conversationTitle: '整理桌面', isNewConversation: false,
    hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1'
  });
  assert.equal(ctx._stepIndex, 3);
  assert.equal(ctx.data.stepTitle, t('delegate.agentReplying'));

  // 等待 startReplyWatch 的异步链路挂上 watcher 后驱动回复。
  await new Promise((resolve) => setTimeout(resolve, 0));
  const handlers = stubs.watch.handlers;
  assert.equal(handlers.conversationId, 'c-1', '已有会话直接复用');
  handlers.onText('你好，我是 Codex！');
  assert.equal(ctx.data.stepContent, '你好，我是 Codex！');

  handlers.onCompleted('你好，我是 Codex！👋');
  assert.equal(ctx._stepIndex, 4);
  assert.equal(ctx.data.stepTitle, t('delegate.agentReplied'));
  assert.deepEqual(
    ctx.data.indicators.map((item) => item.className),
    ['delegate-ind-dot-done', 'delegate-ind-dot-done', 'delegate-ind-dot-done', 'delegate-ind-dot-done', 'delegate-ind-dot-done'],
    '全部完成后指示器全勾'
  );
});

test('delegate card resolves a new conversation for draft deliveries', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const stubs = makeStubs();
  const page = await loadPageConfig(stubs);
  const ctx = makeContext(page);

  ctx.applyPhase('done', {
    agent: 'Codex', conversationTitle: '', isNewConversation: true,
    hostId: 'host-a', pluginId: 'codex', conversationId: ''
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stubs.watch.handlers.conversationId, 'c-9', '草稿路径轮询出新会话');
  assert.equal(ctx._delegateTarget.conversationId, 'c-9');
});

test('delegate card error branch reports reason and freezes the indicator', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const stubs = makeStubs();
  const page = await loadPageConfig(stubs);
  const ctx = makeContext(page);

  ctx.applyPhase('matching', { agent: 'Codex' });
  ctx.applyPhase('error', {
    code: 'sendFailed', message: 'NETWORK',
    hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1'
  });

  assert.equal(ctx.data.stepTitle, t('delegate.failed'));
  assert.equal(ctx.data.stepContent.includes('NETWORK'), true);
  assert.equal(ctx.data.indicators[1].className, 'delegate-ind-dot-active', '指示器停在出错步骤');
  assert.deepEqual(ctx._delegateTarget, { hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1' });

  ctx.applyPhase('error', { code: 'noAgents' });
  assert.equal(ctx.data.stepContent, t('delegate.noAgents'));
});
