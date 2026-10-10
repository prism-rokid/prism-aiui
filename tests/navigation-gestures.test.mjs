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

const conversations = [
  { conversation_id: 'conv-a', title: '线程A', cwd: '/tmp/project', updated_at: 100, status: 'idle' }
];

function seedInboxState(page) {
  page._api = createFakeApi();
  page.data.selectedHostId = 'h1';
  page.data.selectedPluginId = 'p1';
  page.data.agents = [{
    uid: 'h1::p1',
    host_id: 'h1',
    plugin_id: 'p1',
    icon: '',
    connected: true,
    available: true
  }];
  page._conversations = conversations.map((item, index) => ({ ...item, index }));
  page._inboxCatalog = new Map([['h1::p1', { signature: '', items: page._conversations }]]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the inbox is the home surface and the agent/thread panels no longer exist', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  assert.equal(config.data.surface, 'inbox', 'app opens on the inbox');
  assert.doesNotMatch(pageSource, /prism-agent-panel/);
  assert.doesNotMatch(pageSource, /prism-thread-panel/);
  assert.doesNotMatch(pageSource, /surface === 'agents'/);
  assert.doesNotMatch(pageSource, /surface === 'threads'/);
});

test('bootstrap always lands on the inbox, with or without unread conversations', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  page._api = {
    getMe: async () => ({}),
    getHostPlugins: async () => ({
      items: [{ host_id: 'h1', plugin_id: 'p1', display_name: 'Agent', status: 'idle', connected: true, available: true }]
    }),
    getSelection: async () => ({ selected_host_id: 'h1', selected_plugin_id: 'p1', selected_conversation_id: '' }),
    getConversationIndex: async () => ({ items: conversations, signature: 's1' }),
    setSelection: async () => ({}),
    markRead: async () => ({}),
    closeStateStream: async () => ({}),
    openConversationStream: () => ({ abort() {} })
  };

  await page.bootstrap();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.surface, 'inbox', 'bootstrap lands on the inbox unconditionally');
  assert.equal(page.data.menuVisible, true);
  assert.equal(page.data.inboxItems.length, 1, 'conversation shows up in the inbox');
  assert.equal(page.data.inboxItems[0].conversation_id, 'conv-a');

  page.stopPolling();
  page.stopLoaderSpin();
  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('back from the conversation page keeps cached inbox items visible during refresh', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.agents.push({
    uid: 'h2::p2',
    host_id: 'h2',
    plugin_id: 'p2',
    icon: '',
    connected: true,
    available: true
  });
  page._inboxCatalog.set('h2::p2', {
    signature: 'cached-h2',
    items: [{ conversation_id: 'conv-b', title: '线程B', cwd: '/tmp/project-b', updated_at: 200, status: 'idle' }]
  });
  let resolveRefresh;
  page._api.getConversationIndex = (hostId) => hostId === 'h2'
    ? new Promise((resolve) => { resolveRefresh = resolve; })
    : Promise.resolve({ items: conversations, signature: 'sig' });
  page.data.surface = 'main';
  page.data.menuVisible = false;
  page.rebuildInbox();

  // Going home is the back key's job now; the touchpad never composes a double tap.
  page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  assert.equal(page.data.surface, 'inbox', 'back switches to the inbox immediately');
  assert.equal(page.data.menuVisible, true, 'cached inbox is usable during refresh');
  assert.equal(page.data.inboxLoading, false, 'returning home never enables a blocking loading overlay');
  assert.deepEqual(page.data.inboxItems.map((item) => item.conversation_id), ['conv-b', 'conv-a']);
  resolveRefresh({
    items: [{ conversation_id: 'conv-b', title: '线程B（刷新）', cwd: '/tmp/project-b', updated_at: 300, status: 'idle' }],
    signature: 'fresh-h2'
  });
  // The back key does not hand back goToInbox's promise; a macrotask lets the
  // background refresh continuation settle.
  await sleep(30);
  assert.equal(page.data.inboxLoading, false);
  assert.equal(page.data.menuVisible, true, 'inbox list is revealed after the refresh');
  assert.equal(page.data.inboxItems[0].label, '线程B（刷新）', 'background response refreshes the visible cache');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('a single tap on the inbox activates the focused conversation immediately', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'inbox';
  page.data.menuVisible = true;
  page.rebuildInbox();

  page.handleSurfaceTap('inbox', Date.now());
  assert.equal(page.data.surface, 'main', 'activation enters the conversation without waiting for a double tap');
  assert.equal(page.data.selectedConversationId, 'conv-a');

  page.stopLoaderSpin();
  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('inbox touchpad taps never request, cancel, or confirm app exit', async () => {
  const pageSource = await readPageBundle();
  let exitCalls = 0;
  const config = await evaluatePageConfig({
    exitMiniProgram() {
      exitCalls += 1;
    }
  });
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'inbox';
  page.data.menuVisible = true;

  page.activateFocused = () => {};
  page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  assert.equal(page.data.exitPending, true, 'only Backspace starts confirmation');

  const first = Date.now();
  page.handleSurfaceTap('inbox', first);
  page.handleSurfaceTap('inbox', first + 120);
  assert.equal(page.data.exitPending, true, 'touchpad taps leave the confirmation unchanged');
  assert.equal(exitCalls, 0, 'touchpad taps never exit the app');

  page.onKeyUp({ code: 'Backspace', preventDefault() { assert.fail('confirmation must allow native exit'); } });
  assert.equal(exitCalls, 0, 'confirmation uses native Backspace, not the wx exit API');
  assert.equal(page.data.exitPending, false);
});

function pressArrow(page, code = 'ArrowDown') {
  const step = { code, preventDefault() {} };
  page.onKeyDown(step);
  page.onKeyUp(step);
}

test('arrow steps move inbox focus without activating anything', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page._inboxCatalog.get('h1::p1').items.push({
    conversation_id: 'conv-b',
    title: '线程B',
    cwd: '/tmp/project-b',
    updated_at: Date.now() + 5000,
    status: 'idle'
  });
  page.data.surface = 'inbox';
  page.data.menuVisible = true;
  page.rebuildInbox();
  assert.equal(page.data.inboxItems.length, 2);

  pressArrow(page);

  assert.equal(page.data.focusIndex, 1, 'the arrow step moved focus');
  assert.equal(page.data.surface, 'inbox', 'arrow navigation never enters an item by itself');
  assert.equal(page.data.selectedConversationId, '', 'no conversation was entered');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('arrow steps never open the quick menu and never block the following tap', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';
  page.data.menuVisible = false;

  pressArrow(page);
  pressArrow(page, 'ArrowUp');
  assert.equal(page.data.surface, 'main', 'arrow navigation is never a tap');

  // The regression this guards: a tap right after arrow steps used to be
  // swallowed by the swipe-tap guard. It must activate immediately now.
  const press = { code: 'Enter', preventDefault() {} };
  page.onKeyDown(press);
  page.onKeyUp(press);
  assert.equal(page.data.surface, 'quick', 'the tap after arrows opens the quick menu with no guard window');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('arrow steps on the menu move focus without activating the focused action', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  page.data.surface = 'menu';
  page.data.menuVisible = true;
  page.rebuildMenu();
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['voice'],
    'the idle menu offers only voice input');

  pressArrow(page);

  assert.equal(page.data.focusIndex, 0, 'the arrow step stays on the single voice entry');
  assert.equal(page.data.surface, 'menu', 'arrow navigation never activates the focused action');
  assert.equal(page.data.listening, false, 'voice input never starts from an arrow step');
});

test('a tap right after arrow navigation activates immediately', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page._inboxCatalog.get('h1::p1').items.push({
    conversation_id: 'conv-b',
    title: '线程B',
    cwd: '/tmp/project-b',
    updated_at: Date.now() + 5000,
    status: 'idle'
  });
  page.data.surface = 'inbox';
  page.data.menuVisible = true;
  page.rebuildInbox();

  pressArrow(page);
  assert.equal(page.data.focusIndex, 1, 'the arrow step moved focus first');
  const press = { code: 'Enter', preventDefault() {} };
  page.onKeyDown(press);
  page.onKeyUp(press);
  assert.equal(page.data.surface, 'main', 'the tap right after arrows activates normally');
  assert.equal(page.data.selectedConversationId, 'conv-a', 'the arrow-focused item is entered');

  page.stopLoaderSpin();
  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('back from the conversation returns home; back on the inbox follows the exit confirmation flow', async () => {
  const pageSource = await readPageBundle();
  let exitCalls = 0;
  const config = await evaluatePageConfig({
    exitMiniProgram() {
      exitCalls += 1;
    }
  });
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';
  page.data.menuVisible = false;

  page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  assert.equal(page.data.surface, 'inbox', 'back from a conversation goes to the inbox');

  page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  assert.equal(page.data.exitPending, true, 'first back on the inbox requests exit confirmation');
  page.onKeyUp({ code: 'Backspace', preventDefault() { assert.fail('confirmation must allow native exit'); } });
  assert.equal(exitCalls, 0, 'second back delegates to the host default');

  await sleep(10);
  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('a long press on the conversation page enters voice input with a stop menu', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  let recognitionStarts = 0;
  let recognitionStops = 0;
  page._recognition = {
    start() {
      recognitionStarts += 1;
    },
    stop() {
      recognitionStops += 1;
    },
    abort() {}
  };
  page.data.surface = 'main';
  page.data.menuVisible = false;

  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  await sleep(680);
  assert.equal(page.data.surface, 'voice', 'holding the touchpad enters voice input');
  assert.equal(page.data.listening, true);
  assert.equal(page.data.menuVisible, true, 'the menu opens with the stop affordance');
  assert.equal(page.data.menuButtons.length, 1);
  assert.equal(page.data.menuButtons[0].id, 'stopVoice', 'the recording menu offers the stop action');
  assert.equal(page.data.menuButtons[0].label, '说完了');
  assert.equal(page.data.menuButtons[0].showLabel, true, 'the focused stop button renders its label');
  assert.equal(recognitionStarts, 0, 'ASR must not start while the finger is still down');

  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  assert.equal(page.data.surface, 'voice', 'release after the long press takes no extra action');
  await sleep(80);
  assert.equal(recognitionStarts, 1, 'recognition starts only after the release settles');

  // Wait past the duplicate-suppression window, then a single tap stops.
  await sleep(140);
  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  assert.equal(recognitionStops, 1, 'a single tap on the stop menu stops the recording');
  assert.equal(page.data.recognizing, true, 'stopping hands over to the recognition end phase');
});

test('stopping the recording opens the send menu, and swiping there never activates', async () => {
  const pageSource = await readPageBundle();
  // Scripted recognition drives the page's real onresult/onend handlers.
  class ScriptedRecognition {
    constructor() { ScriptedRecognition.instance = this; }
    start() { if (this.onstart) this.onstart(); }
    stop() { queueMicrotask(() => this.onend && this.onend()); }
    abort() {}
  }
  const config = await evaluatePageConfig({}, ScriptedRecognition);
  const page = createPageInstance(config);
  page.setupRecognition();
  let sendCalls = 0;
  page.data.surface = 'main';
  page.data.menuVisible = false;

  // Long press enters voice input; releasing the hold starts the ASR session
  // and the transcript arrives mid-recording.
  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  await sleep(680);
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  assert.equal(page.data.surface, 'voice');
  assert.equal(page.data.listening, true);
  ScriptedRecognition.instance.onresult({ results: [[{ transcript: '帮我看下构建日志' }]] });
  assert.equal(page.data.draftText, '帮我看下构建日志');

  // Arrow steps during recording only navigate: they never stop the ASR.
  pressArrow(page);
  assert.equal(page.data.surface, 'voice', 'arrow navigation must not stop the recording');
  assert.equal(page.data.listening, true);

  // A single tap stops; the recognition end phase lands on the send menu.
  await sleep(140);
  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  await sleep(30);
  assert.equal(page.data.surface, 'menu', 'stopping lands on the send menu');
  assert.equal(page.data.menuVisible, true);
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['send', 'voice', 'undo'],
    'the send menu offers 发送 / 语音输入 / 撤销输入');
  assert.equal(page.data.menuButtons[1].label, '语音输入');
  assert.equal(page.data.menuButtons[1].showLabel, true, '语音输入 is focused and labeled after stopping');
  assert.equal(page.data.focusIndex, 1);
  assert.equal(page.data.listening, false);
  assert.equal(page.data.recognizing, false);

  // Arrow steps inside the send menu move focus without ever firing the option.
  page.sendDraft = async () => { sendCalls += 1; };
  pressArrow(page);
  assert.equal(page.data.focusIndex, 2, 'the arrow step moved focus from 语音输入 to 撤销输入');
  assert.equal(page.data.surface, 'menu', 'arrow navigation must not activate the focused option');
  assert.equal(sendCalls, 0, 'send never fired from an arrow step');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('voice wakeup starts capture immediately even during a press and does not restart it', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let starts = 0;
  let stops = 0;
  page._recognition = { start() { starts += 1; }, stop() { stops += 1; }, abort() {} };
  page.data.surface = 'main';
  page.onKeyDown({ code: 'Enter' });
  page.onVoiceWakeup({ keyword: 'leqi' });
  assert.equal(page.data.surface, 'voice');
  assert.equal(page.data.listening, true);
  assert.equal(starts, 1);
  page.onVoiceWakeup({ keyword: 'leqi' });
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  assert.equal(page.data.menuButtons[0].id, 'stopVoice');
});

test('voice wakeup activates across keywords, ignores inbox, and closes menu when expanded', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let starts = 0;
  page._recognition = { start() { starts += 1; }, stop() {}, abort() {} };
  // Inactive surface (inbox) ignores voice wakeup
  page.data.surface = 'inbox';
  page.onVoiceWakeup({ keyword: 'leqi' });
  assert.equal(page.data.surface, 'inbox');
  assert.equal(starts, 0);

  // Menu surface closes on voice wakeup
  page.openMenu();
  assert.equal(page.data.surface, 'menu');
  assert.equal(page.data.menuVisible, true);
  page.onVoiceWakeup({ keyword: 'leqi' });
  assert.equal(page.data.surface, 'main');
  assert.equal(page.data.menuVisible, false);
  assert.equal(starts, 0);

  // Main surface activates voice input
  page.data.surface = 'main';
  page.onVoiceWakeup({ keyword: 'other' });
  assert.equal(starts, 1);
});

test('tapping stop on a voice session that never started resolves directly into the menu', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  let starts = 0;
  let stops = 0;
  page._recognition = {
    start() { starts += 1; },
    stop() { stops += 1; },
    abort() {}
  };
  // A voice session whose recognition never actually began (no active
  // session, no pending start). A stop tap must land on the menu instead of
  // waiting for an end event that will never arrive.
  page.data.surface = 'voice';
  page.data.listening = true;
  page._recognitionActive = false;

  const press = { code: 'Enter', preventDefault() {} };
  page.onKeyDown(press);
  page.onKeyUp(press);
  await sleep(80);

  assert.equal(page.data.surface, 'menu', 'the stop resolves the session into the menu');
  assert.equal(page.data.listening, false);
  assert.equal(starts, 0, 'no ASR start races in after the stop');
  assert.equal(stops, 0, 'stop is never called on a session that never started');
});

test('a hold during recording changes nothing: the menu stays and ASR keeps running', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  let recognitionStarts = 0;
  let recognitionStops = 0;
  let recognitionAborts = 0;
  page._recognition = {
    start() { recognitionStarts += 1; },
    stop() { recognitionStops += 1; },
    abort() { recognitionAborts += 1; }
  };
  page.data.surface = 'main';
  page.data.menuVisible = false;

  // Long press enters voice; ASR starts after the release settles.
  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  await sleep(680);
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  await sleep(80);
  assert.equal(recognitionStarts, 1);
  assert.equal(page.data.listening, true);

  // Holding past the long-press window during recording is a no-op: no stop,
  // no abort, no navigation, and the stop menu stays exactly as it was.
  await sleep(140);
  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  await sleep(680);
  assert.equal(page.data.surface, 'voice', 'the hold must not navigate away');
  assert.equal(page.data.listening, true, 'the hold must not end the recording');
  assert.equal(recognitionStops, 0);
  assert.equal(recognitionAborts, 0);
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['stopVoice'], 'the stop menu stays');
  assert.equal(page.data.toastVisible, false, 'no 没有听清 toast from an accidental hold');
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  assert.equal(page.data.listening, true, 'the release resolves as a long-press no-op, not a tap stop');
  assert.equal(recognitionStops, 0);

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('going back during recording navigates once; the recognition end stays silent', async () => {
  const pageSource = await readPageBundle();
  class ScriptedRecognition {
    constructor() { ScriptedRecognition.instance = this; }
    start() { if (this.onstart) this.onstart(); }
    stop() { queueMicrotask(() => this.onend && this.onend()); }
    abort() { queueMicrotask(() => this.onend && this.onend()); }
  }
  const config = await evaluatePageConfig({}, ScriptedRecognition);
  const page = createPageInstance(config);
  page.setupRecognition();
  page.data.surface = 'main';
  page.data.menuVisible = false;

  page.onKeyDown({ code: 'Enter', preventDefault() {} });
  await sleep(680);
  page.onKeyUp({ code: 'Enter', preventDefault() {} });
  await sleep(80);
  assert.equal(page.data.listening, true, 'recording is running');

  // Back during recording aborts ASR and opens the menu; the recognition end
  // must not hijack the navigation or toast 没有听清.
  page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  await sleep(30);
  assert.equal(page.data.surface, 'menu', 'back lands on the menu and stays there');
  assert.equal(page.data.menuVisible, true);
  assert.equal(page.data.listening, false);
  assert.equal(page.data.toastVisible, false, 'no 没有听清 toast from the aborted recognition');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('menu buttons never offer the removed agent and thread pages', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);

  const states = [
    { failedDraft: 'failed text' },
    { isRunning: true },
    { draftText: 'hello' },
    { draftText: 'hello', restoredDraft: 'old' },
    { restoredDraft: 'old' },
    {}
  ];
  for (const state of states) {
    Object.assign(page.data, {
      failedDraft: '',
      isRunning: false,
      draftText: '',
      restoredDraft: ''
    }, state);
    page._approval = null;
    page._menuSignature = '';
    page.rebuildMenu();
    const ids = page.data.menuButtons.map((button) => button.id);
    assert.ok(!ids.includes('agents'), `agents button must not appear for state ${JSON.stringify(state)}`);
    assert.ok(!ids.includes('threads'), `threads button must not appear for state ${JSON.stringify(state)}`);
  }

  Object.assign(page.data, { failedDraft: '', isRunning: false, draftText: '', restoredDraft: '' });
  page._approval = { actions: [{ id: 'a1', label: '允许' }] };
  page.data.approvalActions = [{ id: 'a1', label: '允许' }];
  page._menuSignature = '';
  page.rebuildMenu();
  const ids = page.data.menuButtons.map((button) => button.id);
  assert.deepEqual(ids, ['approval'], 'the approval menu carries only the approval action');

  // The menu never offers a 新消息 button in any state.
  assert.ok(!ids.includes('inbox'), 'the inbox button must never appear in the menu');

  // While recording, the menu carries only the stop affordance.
  Object.assign(page.data, { surface: 'voice', listening: true, recognizing: false });
  page._menuSignature = '';
  page.rebuildMenu();
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['stopVoice'],
    'the recording menu offers exactly the stop action');
  assert.equal(page.data.menuButtons[0].showLabel, true, 'the focused stop button renders its label');
});

test('a single tap on the conversation page opens the quick menu immediately', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';

  page.handleSurfaceTap('main', Date.now());
  assert.equal(page.data.surface, 'quick', 'the tap opens the quick menu without waiting');
  assert.equal(page.data.menuVisible, true);
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['hideMenu', 'voice'],
    'the idle quick menu hides 停止任务');
  assert.equal(page.data.focusIndex, 1, '语音输入 is focused on the idle quick menu');

  await page.activateMenuAction('hideMenu');
  assert.equal(page.data.surface, 'main', '隐藏菜单 returns to the conversation');
  assert.equal(page.data.menuVisible, false);
});

test('while the agent is working the quick menu leads with 停止任务', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';
  page.data.isRunning = true;

  page.handleSurfaceTap('main', Date.now());
  assert.equal(page.data.surface, 'quick');
  assert.deepEqual(page.data.menuButtons.map((button) => button.id), ['stop', 'hideMenu', 'voice'],
    'the running quick menu carries 停止任务 first');
  assert.equal(page.data.focusIndex, 0, '停止任务 is focused first while running');
  assert.equal(page.data.menuButtons[0].showLabel, true, 'the focused stop task renders its label');
});

test('rapid taps no longer compose a double tap: the second tap acts on the quick menu', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';

  const now = Date.now();
  page.handleSurfaceTap('main', now);
  assert.equal(page.data.surface, 'quick', 'the first tap opens the quick menu');
  // The second release lands on the quick surface and activates its focused
  // item (语音输入); without a recognition backend this only toasts.
  page.handleSurfaceTap('quick', now + 120);
  assert.equal(page.data.surface, 'quick', 'no double-tap escape to the inbox happens');
  await sleep(450);
  assert.equal(page.data.surface, 'quick', 'no delayed tap resolution fires afterwards');
});

test('back on the conversation page returns to the inbox home', async () => {
  const pageSource = await readPageBundle();
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  seedInboxState(page);
  page.data.surface = 'main';

  await page.onKeyUp({ code: 'Backspace', preventDefault() {} });
  assert.equal(page.data.surface, 'inbox', 'Backspace goes home');
  await sleep(450);
  assert.equal(page.data.surface, 'inbox', 'staying home: no pending tap timers exist anymore');

  page.clearConversationLoadingFallback();
  page.closeConversationStream();
});

test('the conversation tip advertises the single-tap quick menu', async () => {
  const pageSource = await readPageBundle();
  assert.match(pageSource, /长按语音输入 \/ 单击展开菜单/);
});
