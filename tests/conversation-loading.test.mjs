import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evaluatePageConfig, readPageBundle, pageWxmlUrl } from './helpers/page-loader.mjs';

function createPageInstance(config) {
  const page = Object.create(config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  page._recognition = null;
  page._clientInstanceId = 'client-test';
  return page;
}

function createFakeApi() {
  const api = {
    streams: [],
    setSelection: async () => ({}),
    markRead: async () => ({}),
    closeStateStream: async () => ({}),
    getConversationIndex: async () => ({ items: [], signature: 'sig' }),
    openConversationStream(streamConfig) {
      api.streams.push(streamConfig);
      return { abort() {} };
    }
  };
  return api;
}

function seedConversationState(page, api) {
  page._api = api;
  page.data.selectedHostId = 'h1';
  page.data.selectedPluginId = 'p1';
  const conversations = [
    { conversation_id: 'conv-empty', title: '新对话', cwd: '/tmp/project', updated_at: 200, status: 'idle' },
    { conversation_id: 'conv-a', title: '线程A', cwd: '/tmp/project', updated_at: 100, status: 'idle' }
  ];
  page._conversations = conversations.map((item, index) => ({ ...item, index }));
}

function overlayVisible(data) {
  return Boolean(!data.menuVisible && ((data.messagesLoading && !data.messagesLoaded) || data.loading || data.inboxLoading));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an empty conversation settles out of the loading overlay instead of hiding every panel', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);

  await page.selectConversationById('conv-empty');
  api.streams[0].onFrame({ type: 'conversation.snapshot', detail: { title: '新对话' } });
  assert.equal(overlayVisible(page.data), true, 'overlay covers the screen right after the snapshot');

  await sleep(1700);
  assert.equal(page.data.messagesLoaded, true, 'empty conversation settles as loaded');
  assert.equal(page.data.messagesLoading, false, 'empty conversation clears the loading flag');
  assert.equal(overlayVisible(page.data), false, 'loading overlay no longer blocks the UI');

  page.setData({ surface: 'inbox', menuVisible: true });
  assert.equal(overlayVisible(page.data), false, 'overlay never covers the inbox panel');

  page.stopLoaderSpin();
  page.closeConversationStream();
});

test('entering a conversation anchors focus at the top of the loaded range', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);

  await page.selectConversationById('conv-a');
  api.streams[0].onFrame({
    type: 'conversation.messages.turn',
    turn: {
      messages: Array.from({ length: 18 }, (_, index) => ({
        id: `m-${index}`,
        role: 'assistant',
        content: `第 ${index} 条回复 ${'内容'.repeat(42)}`,
        created_at: index + 1
      }))
    }
  });

  const anchors = page._chatAnchors;
  assert.ok(anchors.length > 3, 'fixture should produce several anchor sections');
  assert.equal(page.data.atBottom, false, 'entry does not follow the bottom');
  assert.equal(page.data.unreadCount, 0, 'loaded history is not counted as unread');
  assert.ok(page.data.chatFocusIndex < anchors.length - 1, 'focus is not pinned to the newest anchor');
  assert.ok(
    page._chatAnchorItemIndexes[page.data.chatFocusIndex] >= page._chatLoadedStartIndex,
    'focused anchor is inside the mounted range'
  );
  if (page.data.chatFocusIndex > 0) {
    assert.ok(
      page._chatAnchorItemIndexes[page.data.chatFocusIndex - 1] < page._chatLoadedStartIndex,
      'focus sits exactly at the top boundary of the loaded range'
    );
  }
  assert.equal(page.data.chatScrollIntoView, page.data.chatFocusId, 'view scrolls to the focused anchor');

  page.closeConversationStream();
});

test('message pages cancel the empty-conversation settle and keep loaded history', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);

  await page.selectConversationById('conv-a');
  api.streams[0].onFrame({ type: 'conversation.snapshot', detail: { title: '线程A' } });
  api.streams[0].onFrame({ type: 'conversation.messages.page.begin' });
  api.streams[0].onFrame({
    type: 'conversation.messages.turn',
    turn: { messages: [{ id: 'm1', role: 'user', content: 'hi', created_at: 1 }] }
  });
  api.streams[0].onFrame({ type: 'conversation.messages.page.end' });
  assert.equal(page.data.messagesLoaded, true, 'normal conversation loads through pages');
  assert.equal(page.data.visibleChatItems.length, 1, 'message rendered');

  await sleep(1700);
  assert.equal(page.data.visibleChatItems.length, 1, 'settle timer did not wipe loaded messages');

  page.stopLoaderSpin();
  page.closeConversationStream();
});

test('selecting a just-discovered conversation keeps the optimistic pending message', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);
  // Mirror sendDraft's optimistic message: normalizeMessage output shape.
  page._messages = [{
    id: 'pending-1',
    role: 'user',
    content: '帮我看看这个',
    status: 'sending',
    created_at: Date.now(),
    anchorId: 'message-pending-1',
    displayContent: '帮我看看这个',
    statusLabel: '发送中',
    wrapperClass: 'prism-message prism-message-user'
  }];

  await page.selectConversationById('conv-empty', { keepPendingMessages: true });
  assert.equal(page.data.visibleChatItems.length, 1, 'pending bubble retained');
  assert.equal(page.data.visibleChatItems[0].content, '帮我看看这个');
  assert.equal(page.data.messagesLoaded, true, 'kept pending message counts as loaded');
  assert.equal(overlayVisible(page.data), false, 'no loading overlay while the draft conversation warms up');

  page.stopLoaderSpin();
  page.closeConversationStream();
});

test('a plain conversation selection still resets the chat state', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);
  page._messages = [{ id: 'pending-1', role: 'user', content: '旧消息', status: 'sending', created_at: Date.now() }];

  await page.selectConversationById('conv-a');
  assert.equal(page.data.visibleChatItems.length, 0, 'default selection resets the chat');

  page.stopLoaderSpin();
  page.closeConversationStream();
});

test('bootstrap overlay is restricted to the inbox startup state', async () => {
  const pageSource = await readPageBundle();
  assert.match(
    pageSource,
    /prism-loading-overlay"\s+ink:if="\{\{surface === 'inbox' \? \(!menuVisible \? \(loading \|\| inboxLoading\) : false\) : false\}\}"/
  );
  assert.match(
    pageSource,
    /syncLoadingVisuals\(\)\s*\{/
  );
});

test('bootstrap keeps the canvas logo while conversation loading redraws a fixed canvas', async () => {
  const pageSource = await readPageBundle();
  assert.match(
    pageSource,
    /prism-loading-logo"\s+width="148"\s+height="148"/
  );
  assert.match(
    pageSource,
    /id="prismConversationLoader"\s+class="prism-loading-spinner"\s+width="36"\s+height="36"\s+ink:if="\{\{surface === 'main' \? \(messagesLoading \? !messagesLoaded : false\) : false\}\}"/
  );
  assert.match(pageSource, /startLoaderSpin\(\)\s*\{/);
  assert.match(pageSource, /wx\.createCanvasContext\('prismConversationLoader'\)/);
  assert.match(pageSource, /ctx\.arc\(LOADER_CANVAS_SIZE \/ 2, LOADER_CANVAS_SIZE \/ 2, LOADER_ARC_RADIUS/);
  assert.doesNotMatch(pageSource, /loaderSpinStyle|transform-origin:\s*center center/);
});

test('conversation loader redraws around the fixed 36px canvas center', async () => {
  const pageSource = await readPageBundle();
  const arcs = [];
  const ctx = {
    clearRect() {},
    beginPath() {},
    arc(...args) { arcs.push(args); },
    stroke() {},
    flush() {}
  };
  const config = await evaluatePageConfig({ createCanvasContext: () => ctx });
  const page = createPageInstance(config);
  page.data.surface = 'main';
  page.data.messagesLoading = true;
  page.data.messagesLoaded = false;

  page.syncLoadingVisuals();

  assert.deepEqual(arcs[0].slice(0, 3), [18, 18, 14]);
  assert.equal(arcs[0][5], false);
  page.stopLoaderSpin();
  assert.equal(page._loaderSpinCtx, null, 'conditionally mounted loader reacquires its canvas context');
});

test('a heartbeat-only conversation fails open to a usable empty chat', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  const api = createFakeApi();
  seedConversationState(page, api);

  await page.selectConversationById('conv-a');
  assert.equal(page.data.messagesLoading, true);
  assert.ok(page._conversationLoadingTimer, 'initial conversation load has a bounded deadline');

  page.clearConversationLoadingFallback();
  assert.equal(page.settleConversationLoadingFallback('conv-a'), true);
  assert.equal(page.data.messagesLoaded, true);
  assert.equal(page.data.messagesLoading, false);
  assert.equal(page.data.visibleChatItems.length, 0);
  assert.match(page.data.toastText, /后台重试/);

  page.stopLoaderSpin();
  page.closeConversationStream();
});

test('loading visuals never start a conversation spinner on the inbox surface', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  page.data.messagesLoading = true;
  page.data.messagesLoaded = false;
  page.data.surface = 'inbox';
  page.data.menuVisible = true;

  page.syncLoadingVisuals();

  assert.equal(page._loaderSpinTimer, null);
  page.stopLoaderSpin();
});

test('plugin loading clears a stale conversation loading flag before its request settles', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  page.data.messagesLoading = true;
  page.data.agents = [{
    uid: 'h2::p2',
    host_id: 'h2',
    plugin_id: 'p2',
    display_name: 'Agent 2',
    icon: '',
    connected: true,
    available: true
  }];
  page._api = {
    closeStateStream: async () => ({}),
    getConversationIndex: async () => { throw new Error('offline'); }
  };

  await assert.rejects(page.loadPlugin('h2', 'p2', 'conv-b'), /offline/);

  assert.equal(page.data.messagesLoading, false);
  page.stopLoaderSpin();
});
