// Delegate page smoke: evaluate pages/delegate/index.js with device imports
// stubbed, then drive applyPhase through every branch. Guards against free-
// identifier ReferenceErrors (e.g. a bare statusFor() call) that unit tests
// of the pure runner cannot see and that previously only surfaced on device.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initI18n, t, buildTextMap } from '../lib/prism-i18n.js';
import { truncateDisplayText } from '../lib/widget-data.js';

const STUBS = {
  wx: { getStorageSync: () => '', setStorageSync: () => {}, navigateTo: () => {} },
  createPrismApi: () => ({}),
  PRODUCTION_API_BASE_URL: 'https://ai-cloud.rokid.com/prism/api',
  readableError: () => 'error',
  resolveAccountCredential: async () => ({ accountToken: 't' }),
  LOCAL_DEBUG_AUTH: { baseUrl: '', accountToken: '' },
  createDelegateRunner: () => ({ run: async () => {} }),
  truncateDisplayText,
  initI18n,
  t,
  buildTextMap
};

async function loadPageConfig() {
  const source = (await readFile(new URL('../pages/delegate/index.js', import.meta.url), 'utf8'))
    .replace(/^import\s+.*;\s*$/gm, '')
    .replace('export default {', 'const pageConfig = {');
  const names = Object.keys(STUBS);
  const factory = new Function(...names, `${source}\nreturn pageConfig;`);
  return factory(...names.map((name) => STUBS[name]));
}

function makeContext(page) {
  const ctx = {
    data: JSON.parse(JSON.stringify(page.data)),
    _destroyed: false,
    _logSeq: 0,
    _anchorFlip: false,
    _phase: '',
    _delegateTarget: null,
    setData(patch) { Object.assign(this.data, patch); }
  };
  return Object.assign(ctx, page);
}

// Node exposes navigator.language (usually en-US), so pin the pack the same
// way the main-page tests pin it — via an injected navigator.
const ZH_NAVIGATOR = { language: 'zh-CN', languages: ['zh-CN'] };

test('delegate page drives every applyPhase branch without reference errors', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const page = await loadPageConfig();
  const ctx = makeContext(page);

  ctx.applyPhase('understanding', {});
  ctx.applyPhase('stream', { text: '已选择 CodeX 的最近会话。{"conversation_id":"c-1"}' });
  ctx.applyPhase('matching', { agent: 'Codex' });
  ctx.applyPhase('sending', { agent: 'Codex' });
  ctx.applyPhase('done', {
    agent: 'Codex', conversationTitle: '整理桌面', isNewConversation: false,
    hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1'
  });

  assert.equal(ctx.data.streamVisible, true);
  assert.equal(ctx.data.streamText.includes('…'), true, 'JSON tail is trimmed');
  assert.equal(ctx.data.logs.at(-1).text.includes('已委托给 Codex'), true);
  assert.deepEqual(ctx._delegateTarget, { hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1' });
  assert.equal(ctx.data.steps.every((step) => step.className === 'delegate-dot-done'), true);
});

test('delegate page error branch reports reason and keeps target for entry', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const page = await loadPageConfig();
  const ctx = makeContext(page);

  ctx.applyPhase('error', {
    code: 'sendFailed', message: 'NETWORK',
    hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1'
  });

  assert.equal(ctx.data.logs.at(-1).text.includes('委托失败'), true);
  assert.equal(ctx.data.logs.at(-1).text.includes('NETWORK'), true);
  assert.deepEqual(ctx._delegateTarget, { hostId: 'host-a', pluginId: 'codex', conversationId: 'c-1' });
});

test('delegate page maps distinct error codes onto dedicated copy', async () => {
  initI18n({ navigator: ZH_NAVIGATOR });
  const page = await loadPageConfig();
  const ctx = makeContext(page);

  ctx.applyPhase('error', { code: 'noAgents' });
  assert.equal(ctx.data.logs.at(-1).text, `✕ ${t('delegate.noAgents')}`);

  ctx.applyPhase('error', { code: 'missingRequest' });
  assert.equal(ctx.data.logs.at(-1).text, `✕ ${t('delegate.missingRequest')}`);
});
