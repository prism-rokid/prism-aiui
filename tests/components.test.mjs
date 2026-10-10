import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { evaluatePageConfig, readPageBundle, pageWxmlUrl } from './helpers/page-loader.mjs';
import { setLocale, initI18n } from '../lib/prism-i18n.js';
setLocale('zh-CN', { persist: false });

function createPageInstance(config) {
  const page = Object.create(config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  page._exitConfirmTimer = null;
  page._gesture = null;
  page._tap = null;
  page._recognition = null;
  return page;
}

test('main screen pins the Rokid 480 by 352 logical canvas', async () => {
  const page = await readPageBundle();

  assert.match(page, /\.prism-viewport\s*\{[^}]*width:\s*480px[^}]*height:\s*352px[^}]*min-width:\s*480px[^}]*min-height:\s*352px[^}]*max-width:\s*480px[^}]*max-height:\s*352px[^}]*overflow:\s*hidden/s);
  assert.match(page, /\.prism-main-screen\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(page, /\.prism-loading-overlay\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s);
  assert.doesNotMatch(page, /transform:\s*scale/);
  assert.doesNotMatch(page, /@import/);
});

test('all static image references resolve to local assets', async () => {
  const page = await readPageBundle();
  const sources = [...page.matchAll(/src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((source) => !source.includes('{{'));

  await Promise.all(
    sources.map((source) => access(new URL(source, pageWxmlUrl)))
  );
});

test('manual focus rings use 60 percent borders while preserving icon feedback', async () => {
  const page = await readPageBundle();

  assert.doesNotMatch(page, /(?:^|\})\s*button\.is-focused\s*\{/m);
  assert.match(page, /\.prism-menu-button\.is-focused\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)[^}]*border-color:\s*var\(--prism-primary-60\)/s);
  assert.match(page, /\.prism-control-choice\.is-focused\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)[^}]*border-color:\s*var\(--prism-primary-60\)/s);
  assert.match(page, /\.prism-inbox-choice\.is-focused\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)[^}]*border-color:\s*var\(--prism-primary-60\)/s);
  assert.match(page, /class="prism-icon-20 prism-agent-icon" src="\{\{currentAgentIcon\}\}"/);
  assert.match(page, /class="prism-icon-20 prism-agent-icon prism-inbox-icon" src="\{\{item\.icon\}\}"/);
  assert.match(page, /\.prism-lucide-icon\s*\{[^}]*opacity:\s*1/s);
  assert.match(page, /\.prism-agent-icon\s*\{[^}]*opacity:\s*1/s);
  assert.match(page, /unread: plugin\.status === 'waiting_approval'/);
  assert.match(page, /unread: Boolean\(conversation\.unread\)/);
});

test('every authored frame and divider remains half a pixel thick', async () => {
  const page = await readPageBundle();
  const declarations = [...page.matchAll(/\bborder(?:-(?:top|right|bottom|left|width))?\s*:\s*([^;}]*)/g)]
    .filter((declaration) => declaration[1].trim() !== '0');

  assert.ok(declarations.length > 0);
  for (const declaration of declarations) {
    assert.match(declaration[1].trim(), /^0\.5px(?:\s|$)/);
  }
});

test('page section containers expose consistent 20 percent vertical dividers', async () => {
  const page = await readPageBundle();
  const selectors = [
    'prism-main-topbar', 'prism-plan', 'prism-main-chat', 'prism-main-chatbox', 'prism-loading-overlay',
    'prism-inbox-panel', 'prism-control-panel', 'prism-approval-panel',
    'prism-bottom-stack', 'prism-draft', 'prism-menu',
    'prism-bottom-tips', 'prism-toast'
  ];
  for (const selector of selectors) {
    const rule = page.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, 's'));
    assert.ok(rule, `${selector} should declare its own guide borders`);
    assert.match(rule[0], /border-top:\s*0\.5px solid var\(--prism-primary-20\)/);
    assert.match(rule[0], /border-bottom:\s*0\.5px solid var\(--prism-primary-20\)/);
    assert.doesNotMatch(rule[0], /\bborder(?:-left|-right)?\s*:/);
  }
  assert.match(page, /\.prism-draft\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)/s);
});

test('main screen uses a flexible vertical layout', async () => {
  const page = await readPageBundle();

  assert.doesNotMatch(page, /<ui-component\b/);
  assert.match(page, /class="prism-main-topbar" ink:if="\{\{surface !== 'inbox'\}\}"/);
  assert.match(page, /class="\{\{chatClass\}\}"/);
  assert.match(page, /class="prism-bottom-tips"/);
  assert.doesNotMatch(page, /prism-system-status|prism-clock|\bclock:/);
  assert.match(page, /class="prism-bottom-stack"/);
  assert.match(page, /\.prism-main-topbar\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(page, /\.prism-main-topbar\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(page, /\.prism-main-chat\s*\{[^}]*height:\s*100%[^}]*min-height:\s*1px[^}]*flex-grow:\s*1[^}]*flex-shrink:\s*1[^}]*flex-basis:\s*auto[^}]*flex-direction:\s*row/s);
  assert.match(page, /\.prism-main-chatbox\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*min-height:\s*1px[^}]*flex-grow:\s*1[^}]*flex-basis:\s*auto/s);
  assert.match(page, /\.prism-bottom-stack\s*\{[^}]*width:\s*100%[^}]*display:\s*flex[^}]*flex-shrink:\s*0[^}]*flex-direction:\s*column/s);
  assert.match(page, /\.prism-bottom-tips\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(page, /prism-main-chat-expanded/);
});

test('chat and list scrollbars are in-flow two-pixel adaptive progress thumbs', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);

  assert.match(page, /class="prism-chat-progress" aria-label="{{text.chat.ariaChatProgress}}"/);
  assert.match(page, /ink:for="\{\{chatProgressSegments\}\}" ink:key="id" class="\{\{item\.className\}\}"/);
  assert.match(page, /\.prism-chat-progress\s*\{[^}]*width:\s*2px[^}]*height:\s*100%[^}]*flex-shrink:\s*0[^}]*margin:\s*6px 0 6px 3px[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(page, /\.prism-chat-progress-segment, \.prism-list-progress-segment\s*\{[^}]*width:\s*2px[^}]*flex-grow:\s*1[^}]*flex-basis:\s*0/s);
  assert.match(page, /\.prism-chat-progress-segment\.is-loaded\s*\{[^}]*background-color:\s*var\(--prism-primary\)[^}]*opacity:\s*0\.2/s);
  assert.match(page, /\.prism-chat-progress-segment\.is-current, \.prism-list-progress-segment\.is-current\s*\{[^}]*background-color:\s*var\(--prism-primary\)[^}]*opacity:\s*0\.4/s);
  assert.match(page, /class="prism-list-progress" aria-label="{{text.chat.ariaInboxProgress}}"[\s\S]*ink:for="\{\{inboxProgressSegments\}\}"/);
  assert.match(page, /\.prism-list-layout\s*\{[^}]*height:\s*0[^}]*min-height:\s*0[^}]*display:\s*flex[^}]*flex-grow:\s*1[^}]*flex-direction:\s*row/s);
  assert.match(page, /\.prism-inbox-panel\s*\{[^}]*flex-direction:\s*column/s);

  instance.applyMessages(Array.from({ length: 18 }, (_, index) => ({
    id: `message-${index}`,
    anchorId: `message-${index}`,
    role: 'assistant',
    content: `第 ${index} 条消息 ${'内容'.repeat(42)}`,
    authorLabel: 'Agent',
    created_at: index + 1
  })), true);

  assert.equal(instance.data.chatProgressSegments.length, instance._chatAnchors.length);
  assert.equal(instance.data.chatProgressSegments.filter((item) => item.className.includes('is-current')).length, 1);
  assert.equal(instance.data.chatProgressSegments[instance.data.chatFocusIndex].className, 'prism-chat-progress-segment is-loaded is-current');
  const loadedSegmentCount = instance.data.chatProgressSegments.filter((item) => item.className.includes('is-loaded')).length;
  assert.ok(loadedSegmentCount > 0);
  assert.ok(loadedSegmentCount < instance.data.chatProgressSegments.length);
});

test('toast notifications participate in adaptive document flow', async () => {
  const page = await readPageBundle();

  assert.match(page, /\.prism-toast\s*\{[^}]*width:\s*100%[^}]*flex-shrink:\s*0/s);
  assert.match(page, /\.prism-toast\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)/s);
  assert.ok(page.indexOf('<view class="prism-toast"') < page.indexOf('<view class="prism-main-topbar"'));
  assert.doesNotMatch(page, /\.prism-toast\s*\{[^}]*(?:^|[;\n])\s*(?:position|top|bottom|left|right)\s*:/s);
});

test('main screen declares critical Ink CSS flex rows explicitly', async () => {
  const page = await readPageBundle();
  const rowSelectors = [
    'prism-main-topbar',
    'prism-main-chat',
    'prism-bottom-tips'
  ];

  for (const selector of rowSelectors) {
    assert.match(
      page,
      new RegExp(`\\.${selector}[^,{]*\\{[^}]*display:\\s*flex`, 's'),
      `${selector} should declare display:flex directly`
    );
  }
});

test('explicit page font sizes include the MasterGo conversation scale', async () => {
  const page = await readPageBundle();
  const fontSizes = [...page.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));

  // 11px exists only on the inbox meta line (project · time), one step below
  // the 14px thread title per the inbox redesign.
  assert.deepEqual([...new Set(fontSizes)].sort((a, b) => a - b), [11, 12, 13, 14, 16]);
});

test('conversation layout follows the MasterGo chatbox and bubble components', async () => {
  const page = await readPageBundle();

  assert.match(page, /\.prism-chat-content\s*\{[^}]*width:\s*100%[^}]*flex-direction:\s*column[^}]*padding:\s*var\(--spacing-sm\) var\(--spacing-md\)/s);
  assert.match(page, /\.prism-main-chatbox\s*\{[^}]*box-sizing:\s*border-box[^}]*border-top:\s*0\.5px solid var\(--prism-primary-20\)[^}]*border-bottom:\s*0\.5px solid var\(--prism-primary-20\)/s);
  assert.match(page, /\.prism-user-bubble\s*\{[^}]*width:\s*auto[^}]*max-width:\s*85%[^}]*align-self:\s*flex-end[^}]*overflow:\s*hidden/s);
  assert.match(page, /\.prism-user-bubble-frame\s*\{[^}]*width:\s*auto[^}]*max-width:\s*100%[^}]*flex-direction:\s*row/s);
  assert.match(page, /--prism-bubble-border-opacity:\s*0\.3/);
  assert.match(page, /\.prism-user-bubble-center\s*\{[^}]*flex-grow:\s*1[^}]*flex-basis:\s*auto[^}]*flex-direction:\s*column/s);
  assert.match(page, /\.prism-bubble-edge\s*\{[^}]*width:\s*100%[^}]*height:\s*1px[^}]*background-color:\s*var\(--prism-primary\)[^}]*opacity:\s*var\(--prism-bubble-border-opacity\)/s);
  assert.match(page, /\.prism-user-bubble-body\s*\{[^}]*width:\s*auto[^}]*max-width:\s*100%[^}]*flex-grow:\s*1[^}]*flex-basis:\s*auto[^}]*padding:\s*4px 6px/s);
  assert.doesNotMatch(page, /\.prism-user-bubble-body\s*\{[^}]*(?:border-top|border-bottom)/s);
  assert.equal((page.match(/class="prism-bubble-edge"/g) || []).length, 2);
  assert.match(page, /\.prism-user-copy[^}]*font-size:\s*13px[^}]*line-height:\s*18px/s);
  assert.match(page, /<streamdown[\s\S]*content="\{\{item\.content\}\}"[\s\S]*font-size="13"[\s\S]*><\/streamdown>/);
  assert.doesNotMatch(page, /streaming="/, 'the streaming cursor is removed from assistant replies');
  assert.match(page, /\.prism-streamdown\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*flex-shrink:\s*1[^}]*overflow:\s*hidden[^}]*font-size:\s*13px[^}]*line-height:\s*18px/s);
  assert.doesNotMatch(page, /renderMarkdown|assistant_block|\.md-block|\.md-line/);
  assert.doesNotMatch(page, /item\.s[0-5](?:c)?/);
  assert.doesNotMatch(page, /prism-bubble-rule/);
  for (const asset of ['left_top', 'left_mid', 'left_bottom', 'right_top', 'right_mid', 'right_bottom']) {
    assert.ok(page.includes(`assets/chat_bubble/${asset}.svg`), `${asset}.svg should remain in the adaptive user bubble`);
  }
});

test('long user links gain display-only line break opportunities', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  const content = '参考 https://github.com/jsar-project/AIUI/blob/main/samples/capabilities/pages/networking/index.js';

  instance._serverMessageMap = new Map();
  instance._serverMessageSeq = 0;
  instance._api = { markRead: async () => ({}) };
  instance.data.messages = [];
  instance.data.atBottom = false;
  instance.applyMessageTurn({
    messages: [{ id: 'long-link', role: 'user', content, created_at: 1 }]
  });

  const userItem = instance._chatItems.find((item) => item.kind === 'user');
  assert.equal(instance._messages[0].content, content, 'the API/message model keeps the original content');
  assert.match(userItem.content, /\u200b/, 'the display copy contains invisible break opportunities');
  assert.equal(userItem.content.replace(/\u200b/g, ''), content);
});

test('topbar displays compact status text without button chrome', async () => {
  const page = await readPageBundle();

  assert.match(page, /\.prism-topbar-title\s*\{[^}]*flex-grow:\s*1[^}]*flex-shrink:\s*1[^}]*flex-basis:\s*0/s);
  assert.match(page, /\.prism-thread-title\s*\{[^}]*width:\s*auto[^}]*flex-grow:\s*1[^}]*flex-shrink:\s*1[^}]*flex-basis:\s*0/s);
  assert.doesNotMatch(page, /\.prism-thread-title\s*\{[^}]*width:\s*120px/s);
  // The status pills must never shrink or wrap: a squeezed status row clips
  // the right-aligned model label down to its last glyph.
  assert.match(page, /\.prism-topbar-status\s*\{[^}]*flex-grow:\s*0[^}]*flex-shrink:\s*0[^}]*flex-basis:\s*auto/s);
  assert.doesNotMatch(page, /\.prism-topbar-status\s*\{[^}]*flex-wrap/s);
  assert.match(page, /\.prism-thread-title\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(page, /\.prism-top-status-item\s*\{[^}]*width:\s*auto[^}]*flex-grow:\s*0[^}]*flex-shrink:\s*0[^}]*flex-basis:\s*auto/s);
  assert.doesNotMatch(page, /\.prism-top-control\s*\{/);
  assert.doesNotMatch(page, /class="prism-top-control/);
  assert.doesNotMatch(page, /prism-location/);

  const statusStart = page.indexOf('<view class="prism-topbar-status">');
  const statusEnd = page.indexOf('</view>\n\n      <view class="prism-plan"', statusStart);
  const statusMarkup = page.slice(statusStart, statusEnd);
  assert.ok(statusMarkup.indexOf('prism-context-ring') < statusMarkup.indexOf('prism-model'));
  assert.ok(statusMarkup.indexOf('prism-permission') < statusMarkup.indexOf('prism-model'));
  assert.match(statusMarkup, /prism-context-ring" ink:if="\{\{contextVisible\}\}"/);
  assert.doesNotMatch(statusMarkup, /connectionClass|connectionIcon|connection\.svg/);
  assert.match(statusMarkup, /prism-model">\{\{modelLabel\}\}<\/text>/);
});

test('topbar normalizes serialized sandbox policy into a permission label', async () => {
  const page = await readPageBundle();
  const { compactPermissionLabel } = await import('../lib/prism-labels.js');

  assert.equal(compactPermissionLabel({ id: '{"type":"disabled"}' }, 'never'), '完全访问');
  assert.equal(compactPermissionLabel({ id: 'on-request', label: 'On Request' }), '请求批准');
  assert.equal(compactPermissionLabel({ id: 'on-failure' }), '替我审批');
  assert.match(page, /compactPermissionLabel\(currentPermission, metadata\.approval_mode\)/);
});

test('topbar hides context usage when the remote snapshot provides no usable value', async () => {
  const page = await readPageBundle();
  const { compactContextLabel } = await import('../lib/prism-labels.js');

  assert.equal(compactContextLabel({}, {}), '');
  assert.equal(compactContextLabel({ context: { used_tokens: 250, max_tokens: 1000 } }, {}), '25%');
  assert.match(page, /contextLabel:\s*''/);
  assert.match(page, /contextVisible: Boolean\(compactContextLabel\(detail, run\)\)/);
  assert.match(page, /\.prism-context-ring\s*\{[^}]*border-radius:\s*50%/s);
  assert.doesNotMatch(page, /connectionIcon|connectionClass|prism-connection/);
});

test('topbar prefers Codex native interactive controls for permission and model status', async () => {
  const page = await readPageBundle();
  const { interactiveControlValue, displayOption, compactModelLabel, compactPermissionLabel } = await import('../lib/prism-labels.js');

  const controls = [
    { control_id: 'codex.permission', current_value: 'Full access' },
    { control_id: 'codex.intelligence', current_value: 'GPT-5.5 High' }
  ];
  assert.equal(compactPermissionLabel(displayOption(interactiveControlValue(controls, 'codex.permission')), ''), '完全访问');
  assert.equal(compactModelLabel(displayOption(interactiveControlValue(controls, 'codex.intelligence'))), 'GPT-5.5 High');
  assert.match(page, /const interactiveControls = detail\.interactive_controls \|\| detail\.interactiveControls \|\| \[\];/);
  assert.match(page, /interactiveControlValue\(interactiveControls, 'codex\.permission'\)/);
  assert.match(page, /interactiveControlValue\(interactiveControls, 'codex\.intelligence'\)/);
  assert.match(page, /option\.display_name \|\| option\.displayName \|\| option\.label/);
});

test('all buttons size to content with a minimum wearable target', async () => {
  const page = await readPageBundle();

  assert.match(page, /button\s*\{[^}]*width:\s*auto[^}]*min-width:\s*26px[^}]*min-height:\s*26px[^}]*border:\s*0\.5px solid var\(--prism-primary-20\)/s);
  assert.match(page, /\.prism-menu-button\s*\{[^}]*border:\s*0\.5px solid var\(--prism-primary-20\)/s);
  assert.match(page, /\.prism-control-choice\s*\{[^}]*width:\s*100%/s);
});

test('inbox panel renders a grouped cross-agent list with relative time', async () => {
  const page = await readPageBundle();

  assert.match(page, /\.prism-inbox-panel\s*\{[^}]*width:\s*100%[^}]*height:\s*0[^}]*min-height:\s*0[^}]*flex-grow:\s*1[^}]*flex-basis:\s*0[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s);
  assert.match(page, /\.prism-inbox-list\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*min-height:\s*1px[^}]*flex-grow:\s*1[^}]*flex-basis:\s*auto/s);
  assert.match(page, /\.prism-inbox-list-content\s*\{[^}]*width:\s*100%[^}]*flex-direction:\s*column/s);
  assert.match(page, /\.prism-inbox-choice\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(page, /\.prism-inbox-panel\s*\{[^}]*position:/s);
  assert.match(page, /\.prism-inbox-choice\.is-focused\s*\{[^}]*background-color:\s*var\(--prism-primary-10\)[^}]*border-color:\s*var\(--prism-primary-60\)/s);
  assert.match(page, /ink:for="\{\{inboxItems\}\}" ink:key="id"/);
  assert.match(page, /bindtap="handleInboxTap"/);
  assert.match(page, /<view class="\{\{item\.statusDotClass\}\}"><\/view>[\s\S]*class="prism-icon-20 prism-agent-icon prism-inbox-icon"/);
  assert.doesNotMatch(page, /class="prism-thread-unread" ink:if="\{\{item\.unread\}\}"[\s\S]*class="prism-icon-20 prism-agent-icon prism-inbox-icon"/);
  assert.match(page, /\.prism-status-dot\s*\{[^}]*width:\s*5px[^}]*flex-shrink:\s*0[^}]*opacity:\s*0[^}]*transition-property:\s*opacity/s);
  assert.match(page, /\.prism-status-dot\.is-running\s*\{[^}]*opacity:\s*0\.35/s);
  assert.match(page, /\.prism-status-dot\.is-pulse-high\s*\{[^}]*opacity:\s*1/s);
  assert.match(page, /refreshStatusDotPulse\(\)[\s\S]*STATUS_DOT_PULSE_CLASSES/);
  assert.match(page, /class="prism-icon-20 prism-agent-icon prism-inbox-icon" src="\{\{item\.icon\}\}"/);
  assert.match(page, /class="prism-inbox-label">\{\{item\.label\}\}/);
  assert.match(page, /class="prism-inbox-project">\{\{item\.projectName\}\}/);
  assert.match(page, /class="prism-inbox-time">\{\{item\.timeLabel\}\}/);
  assert.match(page, /scroll-top="\{\{inboxScrollTop\}\}"/);
  assert.match(page, /<view class="prism-inbox-panel" ink:if="\{\{surface === 'inbox'\}\}" role="navigation">/);
  // Day grouping: one header before the first row of 今天/昨天/更早之前.
  assert.match(page, /<block ink:for="\{\{inboxItems\}\}" ink:key="id">/);
  assert.match(page, /<view ink:if="\{\{item\.groupLabel\}\}" class="prism-inbox-group">/);
  assert.match(page, /class="prism-inbox-group-label">\{\{item\.groupLabel\}\}/);
  assert.match(page, /\.prism-inbox-group\s*\{[^}]*height:\s*24px/s);
  assert.equal(page.match(/INBOX_GROUP_HEADER_HEIGHT = (\d+)/)[1], '24', 'header constant matches the CSS row height');
  // Row hierarchy: thread title stays 14px; the project/time meta line is smaller.
  assert.match(page, /\.prism-inbox-label\s*\{[^}]*font-size:\s*14px/s);
  assert.match(page, /\.prism-inbox-project\s*\{[^}]*font-size:\s*11px/s);
  assert.match(page, /\.prism-inbox-time\s*\{[^}]*font-size:\s*11px/s);
  assert.match(page, /class="prism-inbox-meta">/);
  assert.match(page, /class="prism-inbox-label">\{\{item\.label\}\}[\s\S]*?class="prism-inbox-meta">[\s\S]*?class="prism-inbox-project">[\s\S]*?class="prism-inbox-time">/s);
});

function createInboxInstance(config) {
  const instance = createPageInstance(config);
  instance._inboxCatalog = new Map();
  return instance;
}

test('inbox aggregates conversations across agents, sorts by recency, and caps at ten', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  // Anchor the clock at local noon: relative labels like "昨天" depend on the
  // day boundary, and a real run near midnight would flip the 26h fixture.
  const anchoredNow = new Date();
  anchoredNow.setHours(12, 0, 0, 0);
  const realDateNow = Date.now;
  Date.now = () => anchoredNow.getTime();
  const now = anchoredNow.getTime();
  try {
    instance.data.agents = [
      { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: '../../assets/icons/agent_icon/icon_agent_codex.svg' },
      { uid: 'host-2::claude', host_id: 'host-2', plugin_id: 'claude', icon: '../../assets/icons/agent_icon/icon_agent_claude.svg' }
    ];
    instance._inboxCatalog.set('host-1::codex', {
      signature: 'sig-1',
      items: [
        { conversation_id: 'c-old', title: '旧线程', cwd: '/workspace/old', status: 'idle', updated_at: now - 26 * 3600 * 1000, unread: false },
        { conversation_id: 'c-new', title: '新线程\n含换行', cwd: '/workspace/new', status: 'running', updated_at: now - 130 * 1000, unread: true }
      ]
    });
    instance._inboxCatalog.set('host-2::claude', {
      signature: 'sig-2',
      items: [
        { conversation_id: 'c-mid', title: '中间线程', cwd: '/workspace/mid', status: 'idle', updated_at: now - 2 * 3600 * 1000, unread: true }
      ]
    });
    instance._inboxCatalog.set('host-9::gone', {
      signature: 'sig-9',
      items: [{ conversation_id: 'c-gone', title: '已下线', cwd: '/workspace/g', status: 'idle', updated_at: now, unread: false }]
    });

    const items = instance.rebuildInbox();
    assert.deepEqual(items.map((item) => item.conversation_id), ['c-new', 'c-mid', 'c-old']);
    assert.deepEqual(items.map((item) => item.groupLabel), ['今天', '', '昨天']);
    assert.deepEqual(items.map((item) => item.offsetTop), [24, 68, 136]);
    assert.equal(items[0].id, 'inbox:host-1::codex:c-new');
    assert.equal(items[0].icon, '../../assets/icons/agent_icon/icon_agent_codex.svg');
    assert.equal(items[1].icon, '../../assets/icons/agent_icon/icon_agent_claude.svg');
    assert.equal(items[0].projectName, 'new');
    assert.equal(items[0].label, '新线程 含换行');
    assert.equal(items[0].timeLabel, '2分钟前');
    assert.equal(items[1].timeLabel, '2小时前');
    assert.equal(items[2].timeLabel, '昨天');
    assert.deepEqual(items.map((item) => item.unread), [true, true, false]);
    assert.equal(items[0].statusDotClass, 'prism-status-dot is-running is-pulse-low');
    assert.equal(items[1].statusDotClass, 'prism-status-dot is-unread');
    assert.equal(items[2].statusDotClass, 'prism-status-dot is-empty');

    const pool = [];
    for (let index = 0; index < 12; index += 1) {
      pool.push({ conversation_id: `c-${index}`, title: `线程${index}`, cwd: '/workspace/p', status: 'idle', updated_at: now - index * 60 * 1000, unread: false });
    }
    instance._inboxCatalog.set('host-1::codex', { signature: 'sig-1', items: pool });
    const capped = instance.rebuildInbox();
    assert.equal(capped.length, 10);
    assert.equal(capped[0].conversation_id, 'c-0');
    assert.equal(capped[9].conversation_id, 'c-9');
    assert.deepEqual(capped.map((item) => item.groupLabel).filter(Boolean), ['今天'], 'rows from one day share a single header');
  } finally {
    Date.now = realDateNow;
  }
});

test('inbox focus scrolling accounts for day-group headers', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const anchoredNow = new Date();
  anchoredNow.setHours(12, 0, 0, 0);
  const realDateNow = Date.now;
  Date.now = () => anchoredNow.getTime();
  const now = anchoredNow.getTime();
  try {
    instance.setData({ surface: 'inbox' });
    instance.data.agents = [
      { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: 'icon-codex' }
    ];
    instance._inboxCatalog.set('host-1::codex', {
      signature: 'sig-1',
      items: [
        { conversation_id: 'c-today-1', title: '今天一', cwd: '/p', status: 'idle', updated_at: now - 60 * 1000, unread: false },
        { conversation_id: 'c-today-2', title: '今天二', cwd: '/p', status: 'idle', updated_at: now - 2 * 60 * 1000, unread: false },
        { conversation_id: 'c-yesterday', title: '昨天一', cwd: '/p', status: 'idle', updated_at: now - 26 * 3600 * 1000, unread: false },
        { conversation_id: 'c-earlier', title: '更早一', cwd: '/p', status: 'idle', updated_at: now - 3 * 24 * 3600 * 1000, unread: false }
      ]
    });

    const items = instance.rebuildInbox('inbox:host-1::codex:c-earlier');
    assert.equal(instance.data.focusIndex, 3);
    // Content: [今天 hdr] row row [昨天 hdr] row [更早之前 hdr] row = 248px.
    assert.deepEqual(items.map((item) => item.groupLabel), ['今天', '', '昨天', '更早之前']);
    assert.deepEqual(items.map((item) => item.offsetTop), [24, 68, 136, 204]);
    // Viewport 208px: the focused bottom row ends at 248. Scrolling to 40
    // would cut the 今天二 row in half, so the list snaps to the next block
    // edge (68, the top of 今天二) and the top row stays whole.
    assert.equal(instance.data.inboxScrollTop, 68);

    // Crossing midnight re-buckets rows on the periodic time refresh: the
    // same rows relabel to 昨天/更早之前 and the offsets follow the new headers.
    Date.now = () => now + 13 * 3600 * 1000;
    instance.refreshInboxTimeLabels();
    assert.deepEqual(instance.data.inboxItems.map((item) => item.groupLabel), ['昨天', '', '更早之前', '']);
    assert.deepEqual(instance.data.inboxItems.map((item) => item.offsetTop), [24, 68, 136, 180]);
  } finally {
    Date.now = realDateNow;
  }
});

test('status dots keep their slots and pulse only for running agents', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  instance.data.surface = 'inbox';
  instance.data.inboxItems = [
    { id: 'running', running: true, unread: true, statusDotClass: 'prism-status-dot is-running is-pulse-low' },
    { id: 'idle', running: false, unread: false, statusDotClass: 'prism-status-dot is-empty' }
  ];
  instance._statusDotPulsePhase = 0;

  instance.refreshStatusDotPulse();

  assert.equal(instance.data.inboxItems[0].statusDotClass, 'prism-status-dot is-running is-pulse-mid');
  assert.equal(instance.data.inboxItems[1].statusDotClass, 'prism-status-dot is-empty');

  instance.data.surface = 'main';
  instance._statusDotPulsePhase = 0;
  instance.refreshStatusDotPulse();
  assert.equal(instance.data.inboxItems[0].statusDotClass, 'prism-status-dot is-running is-pulse-mid', 'dots only pulse while the inbox is visible');
});

test('inbox opens with focus on the first unread thread and keeps focus across rebuilds', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const now = Date.now();
  instance.data.agents = [
    { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: 'icon-codex' }
  ];
  instance._inboxCatalog.set('host-1::codex', {
    signature: 'sig-1',
    items: [
      { conversation_id: 'c-1', title: '已读', cwd: '/p', status: 'idle', updated_at: now - 60 * 1000, unread: false },
      { conversation_id: 'c-2', title: '未读', cwd: '/p', status: 'idle', updated_at: now - 120 * 1000, unread: true }
    ]
  });

  instance.setData({ surface: 'menu' });
  instance.rebuildInbox();
  assert.equal(instance.data.focusIndex, 0);
  assert.ok(instance.data.inboxItems.every((item) => !item.className.includes('is-focused')));

  await instance.goToInbox();
  assert.equal(instance.data.surface, 'inbox');
  assert.equal(instance.data.menuVisible, true);
  assert.equal(instance.data.inboxLoading, false, 'the canvas overlay clears once the catalog lands');
  assert.equal(instance.data.focusIndex, 1);
  assert.equal(instance.data.inboxItems[1].conversation_id, 'c-2');
  assert.ok(instance.data.inboxItems[1].className.includes('is-focused'));

  instance.moveSurfaceFocus(1);
  assert.equal(instance.data.focusIndex, 0);
  assert.equal(instance.data.inboxScrollTop, 0);
  instance.rebuildInbox();
  assert.equal(instance.data.focusIndex, 0);
  assert.equal(instance.data.inboxItems[0].conversation_id, 'c-1');

  instance._inboxCatalog.clear();
  const emptied = instance.rebuildInbox();
  assert.equal(emptied.length, 0);
  assert.equal(instance.data.inboxItems.length, 0);
  assert.equal(instance.data.focusIndex, 0);
});

test('inbox empty state stays on the inbox home surface and toasts', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  let toast = '';
  instance.showToast = (text) => { toast = text; };

  await instance.goToInbox();
  assert.equal(instance.data.surface, 'inbox', 'the inbox is home even when empty');
  assert.equal(instance.data.menuVisible, true);
  assert.equal(toast, '暂无最近消息');
});

test('opening inbox refreshes the catalog before rendering its list', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const now = Date.now();
  const requests = [];
  instance._api = {
    getConversationIndex(hostId, pluginId, signature) {
      requests.push({ hostId, pluginId, signature });
      return Promise.resolve({
        changed: true,
        signature: 'fresh-inbox',
        items: [{ conversation_id: 'new-1', title: '刚收到的消息', cwd: '/workspace/new', status: 'idle', updated_at: now, unread: true }]
      });
    }
  };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.agents = [
    { uid: 'host-2::claude', host_id: 'host-2', plugin_id: 'claude', icon: 'icon-claude', connected: true, available: true }
  ];

  await instance.goToInbox();

  assert.deepEqual(requests, [{ hostId: 'host-2', pluginId: 'claude', signature: '' }]);
  assert.equal(instance.data.surface, 'inbox');
  assert.equal(instance.data.inboxItems.length, 1);
  assert.equal(instance.data.inboxItems[0].conversation_id, 'new-1');
});

test('inbox activation reuses the selected agent and switches agents when needed', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const calls = { selected: [], loaded: [] };
  instance.selectConversationById = async (conversationId) => { calls.selected.push(conversationId); };
  instance.loadPlugin = async (hostId, pluginId, conversationId) => { calls.loaded.push({ hostId, pluginId, conversationId }); };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.surface = 'inbox';
  instance.data.inboxItems = [
    { id: 'inbox:host-1::codex:c-1', conversation_id: 'c-1', host_id: 'host-1', plugin_id: 'codex', label: '本地', className: '' },
    { id: 'inbox:host-2::claude:c-2', conversation_id: 'c-2', host_id: 'host-2', plugin_id: 'claude', label: '远端', className: '' }
  ];

  instance.data.focusIndex = 0;
  await instance.activateFocused();
  assert.deepEqual(calls.selected, ['c-1']);
  assert.deepEqual(calls.loaded, []);
  assert.equal(instance.data.surface, 'main');
  assert.equal(instance.data.menuClass, 'prism-menu prism-menu-hidden');

  instance.data.surface = 'inbox';
  instance.data.focusIndex = 1;
  await instance.activateFocused();
  assert.deepEqual(calls.selected, ['c-1']);
  assert.deepEqual(calls.loaded, [{ hostId: 'host-2', pluginId: 'claude', conversationId: 'c-2' }]);
  assert.equal(instance.data.surface, 'main');
});

test('inbox activation enters the conversation screen before the selection load completes', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  let resolveSelection;
  instance.selectConversationById = () => new Promise((resolve) => { resolveSelection = resolve; });
  instance.data.surface = 'inbox';
  instance.data.focusIndex = 0;
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.inboxItems = [{ conversation_id: 'inbox-1', host_id: 'host-1', plugin_id: 'codex' }];
  const inboxActivation = instance.activateFocused();
  assert.equal(instance.data.surface, 'main');
  resolveSelection();
  await inboxActivation;
});

test('marking a conversation read clears its inbox unread dot optimistically', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const now = Date.now();
  instance.data.agents = [
    { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: 'icon-codex' }
  ];
  instance._inboxCatalog.set('host-1::codex', {
    signature: 'sig-1',
    items: [
      { conversation_id: 'c-1', title: '未读', cwd: '/p', status: 'idle', updated_at: now - 60 * 1000, unread: true },
      { conversation_id: 'c-2', title: '另一个未读', cwd: '/p', status: 'idle', updated_at: now - 120 * 1000, unread: true }
    ]
  });
  instance.rebuildInbox();

  instance.clearInboxUnread('c-1');
  const items = instance.data.inboxItems;
  assert.deepEqual(items.map((item) => item.unread), [false, true]);
  assert.equal(instance._inboxCatalog.get('host-1::codex').items[0].unread, false);

  instance.clearInboxUnread('missing');
  assert.equal(instance.data.inboxItems.length, 2);
});

test('menu never offers a 新消息 button in any state', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);

  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['voice']);
  assert.deepEqual(instance.data.menuButtons.map((item) => item.label), ['语音输入']);

  instance.data.isRunning = true;
  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['stop']);

  instance.data.isRunning = false;
  instance._approval = { approval_request_id: 'a-1' };
  instance.data.approvalActions = [{ id: 'ok', label: '批准' }];
  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['approval']);

  instance._approval = null;
  instance.data.approvalActions = [];
  instance.data.failedDraft = '失败草稿';
  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['retry', 'voice']);
  assert.ok(instance.data.menuButtons[1].id === 'voice');

  instance.data.failedDraft = '';
  instance.data.restoredDraft = '恢复草稿';
  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['redo', 'voice']);

  instance.data.restoredDraft = '';
  instance.data.draftText = '输入中';
  instance.rebuildMenu();
  assert.deepEqual(instance.data.menuButtons.map((item) => item.id), ['send', 'voice', 'undo']);
  assert.equal(instance.data.menuButtons.some((item) => item.id === 'inbox'), false);
  assert.equal(instance.data.menuButtons.some((item) => item.id === 'agents'), false);
  assert.equal(instance.data.menuButtons.some((item) => item.id === 'threads'), false);
});

test('opening the menu focuses voice input by default', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);

  instance.rebuildMenu();
  instance.openMenu();
  assert.equal(instance.data.surface, 'menu');
  assert.equal(instance.data.menuButtons[instance.data.focusIndex].id, 'voice');
  assert.ok(instance.data.menuButtons[instance.data.focusIndex].className.includes('is-focused'));

  instance.openMenu(true);
  assert.equal(instance.data.menuButtons[instance.data.focusIndex].id, 'voice');

  instance.data.isRunning = true;
  instance.openMenu();
  assert.equal(instance.data.menuButtons[instance.data.focusIndex].id, 'stop');
});

test('a pending approval pops the approval panel immediately on the conversation screen', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  // Entering a conversation lands on the main surface before the snapshot
  // frame arrives; the same path covers an approval arriving mid-conversation.
  instance.data.surface = 'main';
  instance.data.menuVisible = false;
  instance.data.menuClass = 'prism-menu prism-menu-hidden';
  const approval = {
    approval_request_id: 'a-1',
    description: '允许执行命令',
    actions: [{ id: 'allow', label: '允许' }, { id: 'deny', label: '拒绝' }]
  };

  instance.applyDetail({ connected: true, run: { status: 'waiting' }, approval });

  assert.equal(instance.data.surface, 'approval');
  assert.equal(instance.data.menuVisible, true);
  assert.equal(instance.data.focusIndex, 0);
  assert.ok(instance.data.approvalActions[0].className.includes('is-focused'), 'the first action must carry the focus ring');
  assert.equal(instance.data.approvalText, '允许执行命令');

  // Dismissing the panel and receiving the same request again must not
  // re-pop it: each approval signature opens at most once.
  instance.backOneLevel();
  assert.equal(instance.data.surface, 'menu');
  instance.applyDetail({ connected: true, run: { status: 'waiting' }, approval });
  assert.equal(instance.data.surface, 'menu');

  // The menu's 审批 entry keeps working as the manual path.
  await instance.activateMenuAction('approval');
  assert.equal(instance.data.surface, 'approval');
  assert.equal(instance.data.focusIndex, 0);

  // A resolved request (no approval in the snapshot) never pops anything.
  instance.setData({ surface: 'main', menuVisible: false, menuClass: 'prism-menu prism-menu-hidden' });
  instance.applyDetail({ connected: true, run: { status: 'running' }, approval: null });
  assert.equal(instance.data.surface, 'main');

  // A different request popping in later re-opens the panel.
  instance.applyDetail({
    connected: true,
    run: { status: 'waiting' },
    approval: { approval_request_id: 'a-2', actions: [{ id: 'allow', label: '允许' }] }
  });
  assert.equal(instance.data.surface, 'approval');
});

test('an approval request never interrupts the inbox, settings, or voice recording', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  instance.data.menuVisible = true;
  instance.data.menuClass = 'prism-menu';

  for (const surface of ['inbox', 'voice', 'controls']) {
    instance.data.surface = surface;
    instance._approvalSignature = `previous-${surface}`;
    instance.applyDetail({
      connected: true,
      run: { status: 'waiting' },
      approval: { approval_request_id: `a-${surface}`, actions: [{ id: 'allow', label: '允许' }] }
    });
    assert.equal(instance.data.surface, surface, `${surface} must keep its own flow`);
    assert.equal(instance.data.menuVisible, true);
  }
});

test('inbox catalog refresh fetches other agents and keeps stale data on pending snapshots', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const now = Date.now();
  const requests = [];
  instance._api = {
    getConversationIndex(hostId, pluginId, signature) {
      requests.push({ hostId, pluginId, signature });
      if (hostId === 'host-2') {
        return Promise.resolve({ changed: true, signature: 'sig-2-new', items: [{ conversation_id: 'c-2', title: '远端', cwd: '/p', status: 'idle', updated_at: now, unread: true }] });
      }
      return Promise.resolve({ changed: false, signature: 'sig-3-new', source: 'presence_cache_pending', items: [] });
    }
  };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.selectedConversationId = 'c-1';
  instance.data.conversationsSignature = 'sig-selected';
  instance.data.conversations = [{ conversation_id: 'c-1', title: '本地', cwd: '/p', status: 'idle', updated_at: now - 1000, unread: false }];
  instance.data.agents = [
    { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: 'icon-codex', connected: true, available: true },
    { uid: 'host-2::claude', host_id: 'host-2', plugin_id: 'claude', icon: 'icon-claude', connected: true, available: true },
    { uid: 'host-3::codex', host_id: 'host-3', plugin_id: 'codex', icon: 'icon-codex', connected: true, available: true }
  ];
  instance._inboxCatalog.set('host-3::codex', {
    signature: 'sig-3-old',
    items: [{ conversation_id: 'c-3', title: '保留', cwd: '/p', status: 'idle', updated_at: now - 5000, unread: false }]
  });

  await instance.refreshInboxCatalog();
  assert.deepEqual(requests.map((request) => request.hostId), ['host-2', 'host-3']);
  assert.equal(requests[0].signature, '');
  assert.equal(requests[1].signature, 'sig-3-old');
  assert.deepEqual(instance._inboxCatalog.get('host-1::codex').items.map((item) => item.conversation_id), ['c-1']);
  assert.deepEqual(instance._inboxCatalog.get('host-2::claude').items.map((item) => item.conversation_id), ['c-2']);
  assert.deepEqual(instance._inboxCatalog.get('host-3::codex').items.map((item) => item.conversation_id), ['c-3']);
  // A pending snapshot retains the previous signature too: adopting the
  // response signature for content we did not take would make every later
  // conditional request report "unchanged" and pin the stale list forever.
  assert.equal(instance._inboxCatalog.get('host-3::codex').signature, 'sig-3-old');
  assert.deepEqual(instance.data.inboxItems.map((item) => item.conversation_id), ['c-2', 'c-1', 'c-3']);
});

test('inbox catalog keeps the selected Agent cache while its active index is temporarily empty', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createInboxInstance(config);
  const now = Date.now();
  instance._api = { getConversationIndex: async () => ({ items: [], signature: '' }) };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.agents = [
    { uid: 'host-1::codex', host_id: 'host-1', plugin_id: 'codex', icon: 'icon-codex', connected: true, available: true }
  ];
  instance._conversations = [];
  instance._inboxCatalog.set('host-1::codex', {
    signature: 'cached',
    items: [{ conversation_id: 'c-1', title: '缓存线程', cwd: '/p', status: 'idle', updated_at: now }]
  });

  await instance.refreshInboxCatalog();

  assert.deepEqual(instance._inboxCatalog.get('host-1::codex').items.map((item) => item.conversation_id), ['c-1']);
  assert.deepEqual(instance.data.inboxItems.map((item) => item.conversation_id), ['c-1']);
});

test('main page implements the touch interaction surfaces and remote API hooks', async () => {
  const page = await readPageBundle();
  const markers = [
    "surface: 'main'",
    "surface: 'voice'",
    "surface: 'inbox'",
    "surface: 'controls'",
    "surface: 'approval'",
    'createVoiceInput({',
    'getHostPlugins()',
    'getSelection()',
    'getConversationIndex(',
    'openConversationStream(',
    "case 'conversation.snapshot':",
    "case 'conversation.messages.turn':",
    'sendMessage(',
    'openDraft(',
    'startDraft(',
    'interrupt(',
    'resolveApproval(',
    'model_options',
    'approval.actions',
    'control(',
    'markRead('
  ];

  for (const marker of markers) assert.ok(page.includes(marker), `${marker} should be implemented`);
});

test('voice acquisition starts within the activating input handler', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let starts = 0;
  page._recognition = {
    start() { starts += 1; },
    stop() {},
    abort() {}
  };
  page.rebuildMenu = () => {};

  page.startVoiceInput();
  assert.equal(starts, 1, 'microphone acquisition must start in the input callback');
  assert.equal(page.data.surface, 'voice');
  assert.equal(page._recognitionStartTimer, null);

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(starts, 1);
  assert.equal(page._recognitionStartTimer, null);
  assert.doesNotMatch(source, /const RECOGNITION_START_DELAY_MS/);
  assert.match(source, /voice\.input\.start\.scheduled/);
});

test('the start activation tail cannot immediately stop the newly opened voice input', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let stops = 0;
  page._recognition = { start() {}, stop() { stops += 1; }, abort() {} };
  page._recognitionActive = true;
  page.rebuildMenu = () => {};
  await page.activateMenuAction('voice');
  page.activateFocused();
  assert.equal(stops, 0, 'the release from the start action is consumed');
  page.activateFocused();
  assert.equal(stops, 1, 'the next explicit activation stops recording');
});

test('leaving voice input aborts microphone acquisition', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let starts = 0;
  let aborts = 0;
  page._recognition = {
    start() { starts += 1; },
    stop() {},
    abort() { aborts += 1; }
  };
  page.rebuildMenu = () => {};

  page.startVoiceInput();
  page.closeMenu();
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(starts, 1);
  assert.equal(aborts, 1, 'pending microphone acquisition must be cancelled');
  assert.equal(page._recognitionStartTimer, null);
  assert.equal(page.data.surface, 'main');
});

test('Enter press/release means tap or long press; arrows are API navigation events', async () => {
  const page = await readPageBundle();
  const keyDownStart = page.indexOf('onKeyDown(event)');
  const keyDownEnd = page.indexOf('onKeyUp(event)', keyDownStart);
  const keyDownHandler = page.slice(keyDownStart, keyDownEnd);
  const keyUpStart = page.indexOf('onKeyUp(event)');
  const keyUpEnd = page.indexOf('onVoiceWakeup(event)', keyUpStart);
  const keyUpHandler = page.slice(keyUpStart, keyUpEnd);
  const pressStart = page.indexOf('beginTouchpadPress(event) {');
  const pressEnd = page.indexOf('endTouchpadPress(event) {');
  const pressHandler = page.slice(pressStart, pressEnd);
  const releaseStart = page.indexOf('endTouchpadPress(event) {');
  const releaseEnd = page.indexOf('onVoiceWakeup(event)', releaseStart);
  const releaseHandler = page.slice(releaseStart, releaseEnd);
  const arrowStart = page.indexOf('handleArrowStep(event, sourcePhase) {');
  const arrowHandler = page.slice(arrowStart, page.indexOf('onKeyDown(event)', arrowStart));
  const surfaceTapStart = page.indexOf('handleSurfaceTap(surface, now, event) {');
  const surfaceTapHandler = page.slice(surfaceTapStart, page.indexOf('handleToastTap(event) {', surfaceTapStart));
  const voiceWakeupStart = page.indexOf('onVoiceWakeup(event)');
  const voiceWakeupHandler = page.slice(voiceWakeupStart, page.indexOf('touchpadGesture()', voiceWakeupStart));

  assert.match(keyDownHandler, /this\.beginTouchpadPress\(event\)/);
  assert.match(keyDownHandler, /this\.handleArrowStep\(event, 'keydown'\)/);
  assert.match(keyUpHandler, /if \(isConfirmKey\(event\.code\)\) \{\s*event\.preventDefault\(\);\s*this\.endTouchpadPress\(event\);/);
  assert.match(pressHandler, /session\.startSurface = this\.data\.surface/);
  assert.match(pressHandler, /setTimeout\(\(\) => \{[\s\S]*session\.longPressFired = true;[\s\S]*startSurface === 'main'\) this\.startVoiceInput\(\);[\s\S]*else this\.closeMenu\(\);/);
  // A hold during recording is a no-op: no menu close, no ASR abort.
  assert.match(pressHandler, /if \(startSurface === 'voice'\) \{\s*inputTrace\('long_press\.ignored', event, startSurface, 'recording'\);/);
  assert.match(pressHandler, /LONG_PRESS_MENU_MS/);
  assert.match(pressHandler, /\(gesture\.phase === 'pressing' && now - \(gesture\.startAt \|\| 0\) <= STALE_PRESS_MS\)\s*\|\| now < gesture\.suppressUntil/);
  assert.doesNotMatch(pressHandler, /cancelExitConfirmation\(\)/);
  assert.match(page, /function isConfirmKey\(code\) \{\s*return code === 'Enter';/);
  assert.doesNotMatch(page, /GlobalHook/);
  // Arrow steps only navigate: they cancel a pending long press but never
  // reclassify the press as a swipe.
  assert.match(arrowHandler, /this\.clearLongPressTimer\(gesture\);/);
  assert.doesNotMatch(arrowHandler, /consumed|swiped/);
  assert.match(releaseHandler, /const longPressFired = gesture\.longPressFired;/);
  assert.match(releaseHandler, /longPressFired \|\| held >= LONG_PRESS_MENU_MS/);
  assert.match(releaseHandler, /else if \(startSurface !== 'voice'\) this\.closeMenu\(\);/);
  assert.match(releaseHandler, /this\.scheduleRecognitionStart\('long_press_release'\)/);
  assert.match(page, /if \(!options.fromVoiceWakeup && this\._gesture && this\._gesture\.phase === 'pressing'\)/);
  // Recognition end/error must not hijack navigation the user already made.
  assert.match(page, /if \(this\.data\.surface !== 'voice'\) return;\s*this\.setData\(\{ surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE \}\);/);
  // A consumed release (voice wake owns the press) must never reach a tap.
  assert.match(releaseHandler, /else if \(consumed\) \{(?:(?!handleSurfaceTap)[\s\S])*\} else \{/);
  assert.match(releaseHandler, /this\.handleSurfaceTap\(startSurface, now, event\);/);
  assert.match(releaseHandler, /TOUCHPAD_DUPLICATE_WINDOW_MS/);
  assert.doesNotMatch(releaseHandler, /event\.code === this\._longPressKey/);
  assert.doesNotMatch(page, /registerDebugTripleTap|TRIPLE_TAP_MENU_MS|tap\.triple/);
  // Double-tap detection is gone: taps resolve immediately and Backspace owns
  // going back, so the whole tap-chain machinery must not exist.
  assert.doesNotMatch(page, /DOUBLE_TAP_WINDOW_MS|breakTapChain|tapChain\(|singleTimer|createTapChainState/);
  // Swipe judgment is gone too: arrows are the host's own interaction events
  // and must never reclassify or swallow an Enter press/release.
  assert.doesNotMatch(page, /SWIPE_TAP_GUARD_MS|_lastSwipeAt|startsAsSwipe|gesture\.swiped|touchpad\.swipe|handleSwipeStep/);
  assert.match(surfaceTapHandler, /surface === 'main'[\s\S]*this\.openQuickMenu\(\);/);
  assert.doesNotMatch(surfaceTapHandler, /goToInbox|requestExitConfirmation\(\)|wx\.exitMiniProgram\(\)/);
  assert.match(surfaceTapHandler, /this\.activateFocused\(\);/);
  assert.match(voiceWakeupHandler, /event\.preventDefault\(\);/);
  assert.doesNotMatch(voiceWakeupHandler, /this\.openMenu\(\)|setTimeout/);
});

test('standard Enter events activate once without duplicate release firing', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  let activated = 0;
  let prevented = 0;
  const down = { type: 'keydown', code: 'Enter' };
  const up = { type: 'keyup', code: 'Enter', preventDefault() { prevented += 1; } };
  page.activateFocused = () => { activated += 1; };
  page.data.surface = 'menu';

  page.onKeyDown(down);
  page.onKeyUp(up);
  assert.equal(activated, 1, 'a short tap on the menu activates the focused item');

  page.onKeyUp(up);
  assert.equal(activated, 0 + 1, 'duplicate release must not activate a second time');

  page.touchpadGesture().suppressUntil = 0;
  page.onKeyDown(down);
  page.onKeyUp(up);
  assert.equal(activated, 2, 'a new short gesture inside the menu activates the focused item');
  assert.equal(prevented, 3, 'every touchpad release must suppress the host default action');
});

test('long touch on the conversation starts voice input using the surface captured on key down', async () => {
  const source = await readPageBundle();
  const page = createPageInstance(await evaluatePageConfig());
  page.data.surface = 'main';
  page._recognition = { start() {}, stop() {}, abort() {} };
  const pending = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback) => {
    pending.push(callback);
    return pending.length;
  };
  globalThis.clearTimeout = () => {};

  try {
    page.onKeyDown({ type: 'keydown', code: 'Enter' });
    pending.shift()();
    assert.equal(page.data.surface, 'voice', 'holding the touchpad on the conversation starts voice input');
    page.onKeyUp({ type: 'keyup', code: 'Enter', preventDefault() {} });
    // Drop the queued recognition-start timer so the next shift is the gesture timer.
    pending.length = 0;

    // Holding on the voice surface while recording is a no-op: the stop menu
    // stays and the recording continues.
    page.data.surface = 'voice';
    page.data.listening = true;
    page.touchpadGesture().suppressUntil = 0;
    page.onKeyDown({ type: 'keydown', code: 'Enter' });
    pending.shift()();
    assert.equal(page.data.surface, 'voice', 'holding during recording neither closes the menu nor stops ASR');
    assert.equal(page.data.listening, true, 'the recording keeps running');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('the recording stop menu is non-focusable so focus-driven ASR keeps running', async () => {
  const page = await readPageBundle();
  const menuStart = page.indexOf("prism-menu-hidden' : menuClass");
  const menuEnd = page.indexOf('prism-bottom-tips', menuStart);
  const menuTemplate = page.slice(menuStart, menuEnd);

  assert.match(menuTemplate, /<block ink:if="\{\{surface === 'voice'\}\}">[\s\S]*?<view ink:for="\{\{menuButtons\}\}"[^>]*bindtap="handleMenuTap">/);
  assert.doesNotMatch(menuTemplate, /<view ink:for="\{\{menuButtons\}\}"[^>]*tabindex/);
  assert.match(menuTemplate, /<block ink:else>[\s\S]*?<button ink:for="\{\{menuButtons\}\}"[^>]*tabindex="0"/);
});

test('bottom tip is static copy describing the per-surface gestures', async () => {
  const page = await readPageBundle();

  assert.match(page, /<view class="prism-bottom-tips">/);
  assert.doesNotMatch(page, /bindtap="handleMenuTipTap"/);
  assert.doesNotMatch(page, /handleMenuTipTap/);
  assert.match(page, /长按语音输入/);
  assert.match(page, /surface === 'inbox' \? text\.chat\.hintInbox/);
  assert.match(page, /单击执行当前项 · 长按关闭菜单/);
  assert.match(page, /exitPending \? text\.chat\.hintExitAgain/);
});

test('device and button interactions emit direct PrismInput diagnostics', async () => {
  const page = await readPageBundle();

  assert.match(page, /const line = `\[PrismInput\]/);
  assert.match(page, /console\.log\(line\)/);
  assert.match(page, /inputTrace\('key\.down', event/);
  assert.match(page, /inputTrace\('key\.up', event/);
  assert.match(page, /inputTrace\('long_press\.trigger', event/);
  assert.match(page, /inputTrace\('touchpad\.quick_menu', event, surface/);
  assert.match(page, /inputTrace\('touchpad\.release_ignored', event/);
  assert.match(page, /inputTrace\('touchpad\.activate', event/);
  assert.match(page, /TOUCHPAD_DUPLICATE_WINDOW_MS/);
  assert.match(page, /inputTrace\('arrow\.focus', event/);
  assert.match(page, /inputTrace\('arrow\.chat', event/);
  assert.match(page, /console\.log\('\[PrismScroll\]'/);
  assert.match(page, /performance\.now\(\)/);
  assert.match(page, /console\.log\('\[PrismPerf\]'/);
  assert.match(page, /performanceTrace\('arrow\.keydown\.received'/);
  assert.match(page, /performanceTrace\('arrow\.keyup\.received'/);
  assert.match(page, /performanceTrace\('arrow\.dispatch'/);
  assert.match(page, /performanceTrace\('focus\.commit'/);
  assert.match(page, /performanceTrace\('chat\.scroll\.commit'/);
  assert.match(page, /performanceTrace\('messages\.commit'/);
  assert.match(page, /performanceTrace\('input\.probe'/);
  assert.match(page, /scrollTrace\('continuous\.built'/);
  assert.match(page, /scrollTrace\('continuous\.request'/);
  assert.match(page, /inputTrace\('back\.(?:dismiss_toast|inbox_home|previous_level|exit_application|request_exit_confirmation)'/);
  assert.match(page, /inputTrace\('tap\.menu_button', event/);
  assert.match(page, /inputTrace\('tap\.inbox_button', event/);
  assert.match(page, /inputTrace\('tap\.control_button', event/);
  assert.doesNotMatch(page, /bindtap="handleLocationTap"/);
  assert.match(page, /bindtap="handleToastTap"/);
});

test('menu participates in the device flex layout instead of relying on an absolute overlay', async () => {
  const page = await readPageBundle();
  const menuStyleStart = page.indexOf('.prism-menu {');
  const menuStyleEnd = page.indexOf('.prism-menu-button {', menuStyleStart);
  const menuStyle = page.slice(menuStyleStart, menuStyleEnd);

  assert.match(page, /chatLayoutClass\(this\.data\.planVisible, false, true\)/);
  assert.match(menuStyle, /width:\s*auto/);
  assert.match(menuStyle, /flex-wrap:\s*nowrap/);
  assert.match(menuStyle, /margin-top:\s*var\(--spacing-sm\)/);
  assert.match(menuStyle, /padding:\s*2px var\(--spacing-sm\)/);
  assert.doesNotMatch(menuStyle, /position:\s*absolute/);
});

test('menu surfaces use navigation layers, cyclic focus, and intercepted back levels', async () => {
  const page = await readPageBundle();
  const keyUpStart = page.indexOf('onKeyUp(event)');
  const keyUpEnd = page.indexOf('onVoiceWakeup(event)', keyUpStart);
  const keyUpHandler = page.slice(keyUpStart, keyUpEnd);
  const arrowHandlerStart = page.indexOf('handleArrowStep(event, sourcePhase)');
  const arrowHandler = page.slice(arrowHandlerStart, page.indexOf('onKeyDown(event)', arrowHandlerStart));
  const backStart = keyUpHandler.indexOf("if (event.code === 'Backspace') {");
  const touchpadReleaseStart = keyUpHandler.indexOf('if (isConfirmKey(event.code)');
  const menuBackHandler = keyUpHandler.slice(backStart, touchpadReleaseStart);

  assert.match(page, /<view class="\{\{surface === 'inbox' \? 'prism-menu prism-menu-hidden' : menuClass\}\}" role="navigation">/);
  assert.doesNotMatch(page, /<view[^>]*prism-menu[^>]*ink:if/);
  assert.match(page, /\.prism-menu-hidden\s*\{[^}]*display:\s*none/s);
  assert.match(page, /openMenu\(\)[\s\S]*menuVisible:\s*true/);
  assert.match(page, /closeMenu\(\)[\s\S]*menuVisible:\s*false/);
  assert.match(page, /<view class="prism-inbox-panel" ink:if="\{\{surface === 'inbox'\}\}" role="navigation">/);
  assert.match(page, /tabindex="0"/);
  assert.doesNotMatch(page, /<card class="prism-(?:menu|agent-panel|thread-panel|control-panel|approval-panel)"/);
  const surfaceTapStart = page.indexOf('handleSurfaceTap(surface, now, event) {');
  const surfaceTapHandler = page.slice(surfaceTapStart, page.indexOf('handleToastTap(event) {', surfaceTapStart));
  assert.match(surfaceTapHandler, /surface === 'main'[\s\S]*this\.openQuickMenu\(\);/);
  assert.match(surfaceTapHandler, /this\.activateFocused\(\);/);
  assert.match(arrowHandler, /surface !== 'main' && this\.data\.surface !== 'voice'[\s\S]*this\.moveSurfaceFocus/);
  assert.match(keyUpHandler, /event\.preventDefault\(\);[\s\S]*handledOnKeyDown[\s\S]*this\.handleArrowStep\(event, 'keyup-fallback'\)/);
  assert.match(page, /\(previousIndex \+ direction \+ count\) % count/);
  assert.match(menuBackHandler, /surface === 'main'[\s\S]*this\.goToInbox\(\)/);
  assert.match(page, /\.prism-menu\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*nowrap/s);
  assert.match(page, /\.prism-menu block[^{]*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*nowrap/s);
  assert.match(page, /button\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(page, /chatLayoutClass\(this\.data\.planVisible, true, true\)/);
});

test('inbox surface conditionally mounts its surrounding chrome', async () => {
  const page = await readPageBundle();

  assert.match(page, /<view class="prism-main-topbar" ink:if="\{\{surface !== 'inbox'\}\}">/);
  assert.match(page, /<view class="\{\{surface === 'inbox' \? 'prism-menu prism-menu-hidden' : menuClass\}\}" role="navigation">/);
  assert.match(page, /<view[^>]*prism-main-topbar[^>]*ink:if/);
});

test('inactive navigation panels are unmounted', async () => {
  const page = await readPageBundle();
  const repeatedPanels = ['inbox', 'control', 'approval'];

  for (const panel of repeatedPanels) {
    assert.match(
      page,
      new RegExp(`<view[^>]*prism-${panel}-panel[^>]*ink:if`),
      `${panel} panel should not keep repeated children in the active ViewTree`
    );
  }
  assert.doesNotMatch(page, /prism-control-panel prism-layer-hidden/);
  assert.doesNotMatch(page, /prism-approval-panel prism-layer-hidden/);
});

test('menu stays mounted and can be hidden then reopened repeatedly', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);

  instance.rebuildMenu();
  instance.openMenu();
  assert.equal(instance.data.menuClass, 'prism-menu');
  assert.ok(instance.data.menuButtons.every((item) => Number.isInteger(item.idx) && item.className));

  instance.closeMenu();
  assert.equal(instance.data.menuClass, 'prism-menu prism-menu-hidden');

  instance.openMenu();
  assert.equal(instance.data.surface, 'menu');
  assert.equal(instance.data.menuVisible, true);
  assert.equal(instance.data.menuClass, 'prism-menu');
  assert.ok(instance.data.menuButtons.every((item) => Number.isInteger(item.idx) && item.className));
});

test('back hides a visible toast immediately before navigating', async () => {
  const page = await readPageBundle();
  const backStart = page.indexOf("if (event.code === 'Backspace') {");
  const backEnd = page.indexOf('if (isConfirmKey(event.code)', backStart);
  const backHandler = page.slice(backStart, backEnd);

  assert.match(backHandler, /if \(this\.data\.toastVisible\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?this\.dismissToast\(\);[\s\S]*?return;/);
  assert.ok(backHandler.indexOf('toastVisible') < backHandler.indexOf("surface === 'main'"));
});

test('main back requires a second Backspace before exiting', async () => {
  const page = await readPageBundle();
  const backStart = page.indexOf("if (event.code === 'Backspace') {");
  const backEnd = page.indexOf('if (isConfirmKey(event.code)', backStart);
  const backHandler = page.slice(backStart, backEnd);

  assert.match(backHandler, /surface === 'inbox' && this\.data\.exitPending/);
  assert.doesNotMatch(backHandler, /wx\.exitMiniProgram\(\)/);
  assert.match(backHandler, /this\.requestExitConfirmation\(\)/);
  assert.match(page, /EXIT_CONFIRM_MS = 5000/);
  assert.match(page, /bindtap="handleInteraction"/);
  assert.match(page, /exitPending \? text\.chat\.hintExitAgain/);
});

test('message loading and main chat page between section anchors via scroll-into-view', async () => {
  const page = await readPageBundle();
  const arrowHandlerStart = page.indexOf('handleArrowStep(event, sourcePhase)');
  const arrowHandler = page.slice(arrowHandlerStart, page.indexOf('onKeyDown(event)', arrowHandlerStart));
  const keyDownStart = page.indexOf('onKeyDown(event)');
  const keyDownEnd = page.indexOf('onKeyUp(event)', keyDownStart);
  const keyDownHandler = page.slice(keyDownStart, keyDownEnd);
  const keyUpStart = page.indexOf('onKeyUp(event)');
  const keyUpEnd = page.indexOf("if (event.code === 'Backspace')", keyUpStart);
  const arrows = page.slice(keyUpStart, keyUpEnd);

  assert.match(page, /messagesLoading:\s*false/);
  assert.match(page, /messagesLoading:\s*true/);
  assert.match(page, /正在加载···/);
  assert.match(page, /class="prism-loading-overlay" ink:if="\{\{surface === 'inbox' \? \(!menuVisible \? \(loading \|\| inboxLoading\) : false\) : false\}\}"/);
  assert.match(page, /class="prism-loading-logo" width="148" height="148"/);
  assert.match(page, /id="prismConversationLoader" class="prism-loading-spinner" width="36" height="36" ink:if="\{\{surface === 'main' \? \(messagesLoading \? !messagesLoaded : false\) : false\}\}"/);
  assert.match(page, /class="prism-loading-label" ink:if="\{\{loading\}\}">\{\{text\.boot\.connectingAgent\}\}<\/text>[\s\S]*text\.common\.loading/);
  assert.match(page, /CONVERSATION_LOADING_TIMEOUT_MS = 8000/);
  assert.match(page, /scheduleConversationLoadingFallback\(conversationId\)/);
  assert.match(page, /this\._convStream !== record/);
  assert.match(page, /this\._serverMessageMap\.set\(normalized\.id, normalized\.id \|\| normalized\.id\);|this\._serverMessageMap\.set\(normalized\.id,/);
  assert.match(page, /class="prism-main-chatbox"[^>]*scroll-y="true"[^>]*scroll-into-view="\{\{chatScrollIntoView\}\}"[^>]*data-scroll-revision="\{\{chatScrollRevision\}\}"/);
  assert.doesNotMatch(page, /class="prism-main-chatbox"[^>]*scroll-top=/);
  assert.match(page, /<view id="prism-chat-bottom-a" class="prism-chat-bottom-anchor"><\/view>/);
  assert.match(page, /<view id="prism-chat-bottom-b" class="prism-chat-bottom-anchor"><\/view>/);
  assert.match(page, /\.prism-chat-bottom-anchor\s*\{[^}]*width:\s*100%[^}]*height:\s*1px/s);
  assert.match(arrowHandler, /surface === 'main'[\s\S]*mode=anchor-paging[\s\S]*this\.markScrolling/);
  assert.match(keyDownHandler, /event\.code === 'ArrowUp' \|\| event\.code === 'ArrowDown'[\s\S]*this\.handleArrowStep\(event, 'keydown'\)/);
  assert.match(arrows, /event\.preventDefault\(\);[\s\S]*ARROW_KEYUP_FALLBACK_WINDOW_MS[\s\S]*arrow\.release_intercepted[\s\S]*keyup-fallback/);
  assert.match(page, /CHAT_VIEWPORT_ESTIMATE = 280/);
  assert.doesNotMatch(page, /CHAT_SCROLL_STEP/);
  assert.match(page, /CHAT_PROGRESS_INTERVAL = 196/);
  assert.match(page, /CHAT_INITIAL_LOAD_HEIGHT = CHAT_VIEWPORT_ESTIMATE \* 3/);
  assert.match(page, /CHAT_LOAD_CHUNK_HEIGHT = CHAT_VIEWPORT_ESTIMATE \* 2/);
  assert.doesNotMatch(page, /CHAT_LOAD_AHEAD = /);
  assert.match(page, /CHAT_LOAD_AHEAD_ANCHORS = 1/);
  assert.match(page, /CHAT_BOTTOM_ANCHOR_IDS = \['prism-chat-bottom-a', 'prism-chat-bottom-b'\]/);
  assert.match(page, /function buildChatLayoutMetrics\(chatItems\)/);
  assert.match(page, /anchors: anchorEntries\.map\(\(entry\) => entry\.anchorId\)/);
  assert.match(page, /anchorItemIndexes: anchorEntries\.map\(\(entry\) => entry\.itemIndex\)/);
  assert.match(page, /this\._chatItemOffsets = layout\.itemOffsets/);
  assert.match(page, /this\._chatAnchorItemIndexes = layout\.anchorItemIndexes/);
  assert.doesNotMatch(page, /function maximumChatScrollTop\(/);
  assert.doesNotMatch(page, /function chatFocusIndexForScrollTop\(/);
  assert.match(page, /function chatLoadedProgressAnchorIndex\(anchorItemIndexes, loadedStartIndex\)/);
  assert.match(page, /function retainedChatFocusIndex\(chatAnchors, previousFocusId, previousItemIndex, anchorItemIndexes\)/);
  assert.doesNotMatch(page, /function buildVisibleChatItems\(/);
  assert.match(page, /const chatItems = buildChatItems\(messages\);[\s\S]*const chatLayout = buildChatLayoutMetrics\(chatItems\);[\s\S]*const chatAnchors = chatLayout\.anchors;/);
  assert.match(page, /ink:for="\{\{visibleChatItems\}\}"/);
  assert.match(page, /class="prism-chat-top-spacer" style="\{\{chatTopSpacerStyle\}\}"/);
  assert.doesNotMatch(page, /ink:for="\{\{messages\}\}"[\s\S]*ink:for="\{\{item\.blocks\}\}"/);
  assert.match(page, /id="\{\{item\.anchorId\}\}" class="\{\{item\.className\}\}"/);
  assert.doesNotMatch(page, /CHAT_PAGE_|buildChatPageOffsets|_chatPageOffsets/);
  assert.doesNotMatch(page, /prism-system-status|updateClock|_clockTimer/);
  assert.doesNotMatch(page, /chromeVisible|_chromeTimer|prism-main-chat-expanded/);
  const scrollHandler = page.slice(page.indexOf('markScrolling(direction, event)'), page.indexOf('onKeyDown(event)', page.indexOf('markScrolling(direction, event)')));
  assert.match(scrollHandler, /maximumFocusIndex[\s\S]*wasAtBottom[\s\S]*chatScrollIntoView: atBottom \? this\.nextChatBottomAnchorId\(\) : chatFocusId/);
  assert.match(scrollHandler, /targetUnmounted[\s\S]*shouldLoadEarlier[\s\S]*CHAT_LOAD_AHEAD_ANCHORS/);
  assert.doesNotMatch(scrollHandler, /setTimeout|buildVisibleChatItems/);
  assert.doesNotMatch(scrollHandler, /estimatedChatItemHeight|estimatedChatContentHeight|visualTextUnits/);
  assert.match(scrollHandler, /this\._chatAnchorItemIndexes/);
  assert.match(scrollHandler, /this\._chatItemOffsets/);
  assert.doesNotMatch(scrollHandler, /menuVisible|chatClass|chromeVisible/);
  assert.match(page, /case 'conversation\.messages\.turn':[\s\S]*this\.applyMessageTurn\(frame\.turn \|\| \{\}\);/);
  assert.match(page, /const currentModel = displayOption\(interactiveModel, detail\.current_model \|\| detail\.currentModel/);
  const phaseExpression = page.slice(page.indexOf('const phaseText ='), page.indexOf('const planVisible ='));
  assert.match(phaseExpression, /run\.status === 'running'/);
  assert.match(phaseExpression, /run\.phase/);
  assert.doesNotMatch(phaseExpression, /run\.summary/);

  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  let prevented = 0;
  const chatItems = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((token) => ({
    key: `item-${token}`,
    anchorId: `section-${token}`,
    kind: 'assistant_markdown',
    content: '内容'
  }));
  instance.data.surface = 'main';
  instance.data.atBottom = false;
  instance.data.chatFocusIndex = 1;
  instance.data.chatFocusId = 'section-b';
  instance.data.chatScrollIntoView = 'section-b';
  instance._chatItems = chatItems;
  instance._chatLayoutItems = chatItems;
  instance._chatAnchors = chatItems.map((item) => item.anchorId);
  instance._chatAnchorItemIndexes = [0, 1, 2, 3, 4, 5, 6];
  instance._chatItemHeights = chatItems.map(() => 40);
  instance._chatItemOffsets = [0, 40, 80, 120, 160, 200, 240, 280];
  instance._chatLoadedStartIndex = 0;
  instance._chatFocusItemIndex = 1;
  instance.onKeyDown({ type: 'keydown', code: 'ArrowDown' });
  assert.equal(instance.data.chatFocusIndex, 2);
  assert.equal(instance.data.chatScrollIntoView, 'section-c');
  instance.onKeyUp({ type: 'keyup', code: 'ArrowDown', preventDefault() { prevented += 1; } });
  assert.equal(instance.data.chatFocusIndex, 2, 'keyup must not repeat a keydown scroll');
  instance.onKeyDown({ type: 'keydown', code: 'ArrowUp' });
  assert.equal(instance.data.chatFocusIndex, 1);
  assert.equal(instance.data.chatScrollIntoView, 'section-b');
  instance.onKeyUp({ type: 'keyup', code: 'ArrowUp', preventDefault() { prevented += 1; } });
  assert.equal(instance.data.chatFocusIndex, 1, 'keyup only intercepts the host default action');
  assert.equal(prevented, 2);

  instance.data.chatFocusIndex = 6;
  instance.data.chatFocusId = 'section-g';
  instance.data.chatScrollIntoView = 'section-g';
  instance.onKeyDown({ type: 'keydown', code: 'ArrowDown' });
  assert.equal(instance.data.atBottom, true, 'paging down past the last anchor lands on the bottom anchor');
  assert.equal(instance.data.chatScrollIntoView, 'prism-chat-bottom-a');
  instance.onKeyDown({ type: 'keydown', code: 'ArrowDown' });
  assert.equal(instance.data.chatScrollIntoView, 'prism-chat-bottom-a', 'down at the bottom is a boundary no-op');

  instance.onKeyDown({ type: 'keydown', code: 'ArrowUp' });
  assert.equal(instance.data.atBottom, false, 'paging up from the bottom re-enters the anchor range immediately');
  assert.equal(instance.data.chatFocusIndex, 6);
  assert.equal(instance.data.chatScrollIntoView, 'section-g');
});

test('glasses arrow keydown moves inbox focus and keyup only intercepts the host default', async () => {
  const source = await readPageBundle();
  const instance = createPageInstance(await evaluatePageConfig());
  const movements = [];
  let prevented = 0;
  instance.data.surface = 'inbox';
  instance.moveSurfaceFocus = (direction) => movements.push(direction);

  instance.onKeyDown({ type: 'keydown', code: 'ArrowUp' });
  instance.onKeyUp({ type: 'keyup', code: 'ArrowUp', preventDefault() { prevented += 1; } });
  instance.onKeyDown({ type: 'keydown', code: 'ArrowDown' });
  instance.onKeyUp({ type: 'keyup', code: 'ArrowDown', preventDefault() { prevented += 1; } });

  assert.deepEqual(movements, [-1, 1]);
  assert.equal(prevented, 2);
});

test('native scrolling uses viewport distance and ignores superseded animation results', async () => {
  const instance = createPageInstance(await evaluatePageConfig());
  instance.data.surface = 'main';
  instance._chatLoadedStartIndex = 0;
  instance._chatAnchors = ['a', 'b', 'c'];
  const calls = [];
  const entity = {
    entityId: 1, clientHeight: 200, scrollHeight: 1000, scrollTop: 0,
    scrollTo(options) { return new Promise(resolve => calls.push({ ...options, resolve })); }
  };
  instance.querySelector = () => entity;
  instance.markScrolling(1);
  instance.markScrolling(1);
  assert.deepEqual(calls.map(call => call.top), [160, 320]);
  assert.equal(calls[0].behavior, 'smooth');
  assert.equal(instance.data.chatScrollIntoView, '');
  calls[0].resolve({ interrupted: true });
  await Promise.resolve();
  assert.equal(instance._chatScrollRequest.top, 320);
  entity.scrollTop = 110;
  calls[1].resolve({ interrupted: true });
  await Promise.resolve();
  assert.equal(instance._chatScrollRequest, null);
  assert.equal(instance.data.atBottom, false);
  instance.markScrolling(1);
  assert.equal(calls[2].top, 270, 'after interruption, start from actual position');
  entity.scrollTop = 800;
  instance.data.surface = 'inbox';
  calls[2].resolve({ interrupted: false });
  await Promise.resolve();
  assert.equal(instance.data.atBottom, false, 'completion cannot update a departed conversation');
});

test('native message updates retain a reader away from bottom and mount history without spacers', async () => {
  const instance = createPageInstance(await evaluatePageConfig());
  instance.data.surface = 'main';
  instance.querySelector = () => ({
    entityId: 1, clientHeight: 200, scrollHeight: 2000, scrollTop: 100,
    scrollTo: async () => ({ interrupted: false })
  });
  const messages = Array.from({ length: 18 }, (_, index) => ({
    id: `native-${index}`, anchorId: `native-${index}`, role: 'assistant',
    content: '长回复内容'.repeat(50), created_at: index + 1
  }));
  instance.applyMessages(messages, true);
  assert.equal(instance._chatLoadedStartIndex, 0);
  assert.equal(instance.data.visibleChatItems.length, instance._chatItems.length);
  instance.data.atBottom = true;
  instance.data.chatScrollIntoView = '';
  instance.applyMessages(messages, true);
  assert.equal(instance.data.atBottom, false, 'measured position overrides stale follow state');
  assert.equal(instance.data.chatScrollIntoView, '', 'incoming content must not move the reader');
});

test('continuous chat progressively prepends history while preserving its scroll coordinate', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  const messages = Array.from({ length: 18 }, (_, index) => ({
    id: `message-${index}`,
    anchorId: `message-${index}`,
    role: 'assistant',
    content: `第 ${index} 条回复 ${'内容'.repeat(42)}`,
    authorLabel: 'Agent',
    created_at: index + 1
  }));
  instance._api = { markRead: async () => ({}) };
  instance.data.surface = 'main';
  instance.data.atBottom = true;

  instance.applyMessages(messages, true);

  const focusIndex = instance.data.chatFocusIndex;
  const initialLoadedStartIndex = instance._chatLoadedStartIndex;
  const initialLoadedCount = instance.data.visibleChatItems.length;
  const initialLoadedSegmentCount = instance.data.chatProgressSegments.filter((item) => item.className.includes('is-loaded')).length;
  assert.ok(focusIndex > 1, 'fixture should create several progress sections');
  assert.equal(instance.data.atBottom, true, 'a fresh load follows the bottom anchor');
  assert.match(instance.data.chatScrollIntoView, /^prism-chat-bottom-[ab]$/);
  assert.ok(initialLoadedStartIndex > 0);
  assert.ok(initialLoadedCount < instance._chatItems.length);
  assert.match(instance.data.chatTopSpacerStyle, /^height: [1-9][0-9]*px;$/);
  assert.ok(instance.data.visibleChatItems.some((item) => item.anchorId === instance.data.chatFocusId));

  let prevented = 0;
  for (let index = 0; index < 5; index += 1) {
    instance.onKeyUp({ code: 'ArrowUp', preventDefault() { prevented += 1; } });
  }

  assert.equal(prevented, 5);
  assert.ok(instance._chatLoadedStartIndex < initialLoadedStartIndex);
  assert.ok(instance.data.visibleChatItems.length > initialLoadedCount);
  assert.ok(
    instance.data.chatProgressSegments.filter((item) => item.className.includes('is-loaded')).length
      > initialLoadedSegmentCount
  );
});

test('liveness drain keeps buffered fetch frames valid until history is applied', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  const record = {
    hostId: 'host-1',
    pluginId: 'codex',
    conversationId: 'conv-1',
    streamId: 'stream-1',
    closed: false,
    buffered: false,
    draining: false,
    drainTimer: null,
    drainFallbackTimer: null
  };
  instance._convStream = record;
  instance._serverMessageMap = new Map();
  instance._serverMessageSeq = 0;
  let closeCalls = 0;
  instance._api = {
    markRead: async () => ({}),
    closeStateStream: async () => { closeCalls += 1; }
  };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.selectedConversationId = 'conv-1';
  instance._messages = [];
  instance._chatItems = [];
  instance._lastFrameAt = 0;

  instance.checkStreamLiveness();
  assert.equal(closeCalls, 1);
  assert.equal(instance._convStream, record, 'the timed-out stream remains current while its buffered body arrives');
  assert.equal(record.closed, false);
  assert.equal(record.draining, true);

  instance.handleBufferedStream(record, { streamId: record.streamId, status: 200 });
  assert.equal(record.buffered, true);

  instance.handleStreamFrame(record, {
    type: 'conversation.messages.turn',
    host_id: 'host-1',
    plugin_id: 'codex',
    conversation_id: 'conv-1',
    turn: { messages: [{ id: 'm-1', role: 'assistant', content: '已加载', created_at: 1 }] }
  });
  instance.handleStreamFrame(record, {
    type: 'conversation.messages.page.end',
    conversation_id: 'conv-1'
  });
  instance.handleStreamFrame(record, {
    type: 'stream.close',
    conversation_id: 'conv-1'
  });

  assert.equal(instance.data.messagesLoaded, true);
  assert.equal(instance.data.messagesLoading, false);
  assert.equal(instance._messages[0].content, '已加载');
  assert.equal(instance._convStream, record, 'a buffered stream.close frame waits until every buffered line is parsed');
  instance.handleStreamClosed(record, { reason: 'completed' });
  if (instance._streamReconnectTimer) {
    clearTimeout(instance._streamReconnectTimer);
    instance._streamReconnectTimer = null;
  }
  assert.equal(record.closed, true);
  assert.match(page, /onBuffered:\s*\(info\) => this\.handleBufferedStream\(record, info\)/);
  assert.match(page, /checkStreamLiveness\(\)[\s\S]*beginConversationStreamDrain\(record, 'liveness_expired'\)/);
  assert.match(page, /beginConversationStreamDrain\(record, reason\)[\s\S]*requestConversationStreamDrain\(record, 1\)/);
  assert.match(page, /requestConversationStreamDrain\(record, attempt\)[\s\S]*closeStateStream\(record\.streamId\)/);
  assert.match(page, /record\.draining[\s\S]*stream\.buffered\.detected/);
});

test('first-frame probe drains a buffered stream after 500ms', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  let closeCalls = 0;
  instance._api = {
    openConversationStream: () => ({ abort() {} }),
    closeStateStream: async () => { closeCalls += 1; }
  };
  instance._clientInstanceId = 'client-1';
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.selectedConversationId = 'conv-1';

  instance.openConversationStream();
  const record = instance._convStream;
  await new Promise((resolve) => setTimeout(resolve, 560));

  assert.equal(record.draining, true);
  assert.equal(record.drainReason, 'first_frame_timeout');
  assert.equal(closeCalls, 1);
  assert.equal(record.closed, false, 'draining must leave the local fetch alive to receive its buffered response');
  assert.match(page, /const STREAM_FIRST_FRAME_PROBE_MS = 500;/);
  assert.match(page, /stream\.first_frame_probe\.expired/);

  instance.closeConversationStream();
});

test('the first valid stream frame cancels the 500ms probe', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  let closeCalls = 0;
  instance._api = {
    openConversationStream: () => ({ abort() {} }),
    closeStateStream: async () => { closeCalls += 1; }
  };
  instance._clientInstanceId = 'client-1';
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.selectedConversationId = 'conv-1';

  instance.openConversationStream();
  const record = instance._convStream;
  instance.handleStreamFrame(record, {
    type: 'stream.heartbeat',
    host_id: 'host-1',
    plugin_id: 'codex',
    conversation_id: 'conv-1'
  });
  await new Promise((resolve) => setTimeout(resolve, 560));

  assert.equal(record.firstFrameProbeTimer, null);
  assert.equal(record.draining, false);
  assert.equal(closeCalls, 0);
  assert.match(page, /stream\.first_frame_probe\.satisfied/);

  instance.closeConversationStream();
});

test('current conversation stream starts before selection persistence completes', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  let resolvePersistence;
  let streamOpened = false;
  instance.closeConversationStream = () => {};
  instance.applyConversationSelectionStyles = () => {};
  instance.persistSelection = () => new Promise((resolve) => { resolvePersistence = resolve; });
  instance.openConversationStream = () => { streamOpened = true; };
  instance._api = { markRead: async () => ({}) };
  instance.data.selectedHostId = 'host-1';
  instance.data.selectedPluginId = 'codex';
  instance.data.selectedConversationId = 'conv-old';

  const selecting = instance.selectConversationById('conv-new');
  assert.equal(streamOpened, true, 'content streaming must not wait for the selection PUT');
  assert.equal(instance.data.selectedConversationId, 'conv-new');
  resolvePersistence({ ok: true, rejectedConversation: false });
  await selecting;
  instance.stopLoaderSpin();
});

test('closing a conversation aborts its local fetch before deleting the server stream', async () => {
  const page = await readPageBundle();
  const config = await evaluatePageConfig();
  const instance = createPageInstance(config);
  const actions = [];
  instance._convStream = {
    streamId: 'stream-old',
    conversationId: 'conv-old',
    closed: false,
    drainTimer: null,
    drainFallbackTimer: null,
    handle: { abort() { actions.push('abort'); } }
  };
  instance._api = {
    closeStateStream() {
      actions.push('delete');
      return Promise.resolve({});
    }
  };

  instance.closeConversationStream();
  assert.deepEqual(actions, ['abort', 'delete']);
  assert.equal(instance._convStream, null);
});

test('main page follows the current remote API snapshot contract', async () => {
  const page = await readPageBundle();
  const selectionStart = page.indexOf('async selectConversationById(conversationId, options = {})');
  const selectionEnd = page.indexOf('async persistSelection(', selectionStart);
  const selectionHandler = page.slice(selectionStart, selectionEnd);

  assert.doesNotMatch(page, /getControls\(|\/controls|getAgents\(|getDetail\(|getMessages\(/);
  assert.ok(selectionHandler.indexOf('const persistence = this.persistSelection(true)') < selectionHandler.indexOf('this.openConversationStream()'));
  assert.ok(selectionHandler.indexOf('this.openConversationStream()') < selectionHandler.indexOf('const persisted = await persistence'));
  assert.match(page, /record\.handle = this\._api\.openConversationStream/);
  assert.match(page, /record\.handle\.abort\(\)[\s\S]*closeStateStream\(record\.streamId\)/);
  assert.match(page, /modelOptions: detail\.model_options \|\| \[\]/);
  assert.match(page, /ink:for="\{\{approvalActions\}\}"/);
  assert.doesNotMatch(page, /bindtap="approve"|bindtap="reject"/);
  const detailHandler = page.slice(page.indexOf('applyDetail(detail)'), page.indexOf('applyMessages(messages', page.indexOf('applyDetail(detail)')));
  assert.doesNotMatch(detailHandler, /this\.setData\(\{ approval: null/);
  assert.match(page, /conversation\.snapshot[\s\S]*detail\.connected !== false/);
  assert.match(page, /compactContextLabel\(detail, run\)/);
  assert.match(page, /Agent 当前不可用，稍后自动重试/);
  assert.match(page, /this\._api\.markRead\(/);
});

test('main page drops persisted conversations missing from the plugin index', async () => {
  const page = await readPageBundle();
  const loadStart = page.indexOf('async loadPlugin(hostId, pluginId, preferredConversationId');
  const loadEnd = page.indexOf('async applyHostSelectionStyles()', loadStart);
  const loadHandler = page.slice(loadStart, loadEnd);

  // A persisted selection that the plugin no longer reports (for example an
  // unavailable plugin with an empty index) must not be re-selected.
  assert.match(loadHandler, /conversations\.some\(\(item\) => item\.conversation_id === conversationId\)/);
  assert.match(loadHandler, /plugin\.load\.stale_conversation/);
  // Defense in depth: a server rejection while selecting must clear the
  // selection instead of opening a stream that can never deliver content.
  assert.match(page, /isConversationMissingError\(error\)/);
  assert.match(page, /conversation\.select\.missing/);
  assert.match(page, /rejectedConversation/);
});

test('main page uses local themed SVGs for Agent avatars and menu icons', async () => {
  const api = await readFile(new URL('../lib/prism-api.js', import.meta.url), 'utf8');
  const page = await readPageBundle();

  for (const icon of ['codex', 'claudecode', 'claude', 'openclaw', 'codebuddy', 'hermesagent', 'openai']) {
    assert.match(api, new RegExp(`['\"]${icon}['\"]`));
  }
  // Avatars and menu icons resolve to bundled SVGs with the theme color baked in:
  // the remote fetch / data URL pipeline rendered black on real hardware.
  assert.match(page, /function iconPath\(agent\)\s*\{\s*return `\.\.\/\.\.\/assets\/icons\/agent_icon\/icon_agent_\$\{agentIconFor\(agent\)\}\.svg`;/s);
  assert.match(page, /function menuIconPath\(name\)\s*\{\s*return `\.\.\/\.\.\/assets\/icons\/menu_icon\/icon_menu_\$\{name\}\.svg`;/s);
  assert.doesNotMatch(page, /themedAgentSvgDataUrl|requestSvgText|refreshAgentIcons|data:image\/svg\+xml;base64/);
  assert.doesNotMatch(page, /LUCIDE_ICON_CDN_ROOT/);
  assert.doesNotMatch(page, /\.prism-agent-icon\s*\{[^}]*filter:/s);
  assert.match(page, /class="prism-icon-20 prism-agent-icon" src="\{\{currentAgentIcon\}\}"/);
  assert.match(page, /send: 'send'[\s\S]*stop: 'square'[\s\S]*stopVoice: 'square'[\s\S]*voice: 'mic'/);
  assert.match(page, /function decorateMenu[\s\S]*showLabel: index === focusIndex/);
  assert.match(page, /<image class="prism-icon-14 prism-lucide-icon" src="\{\{item\.icon\}\}" \/>[\s\S]*<text ink:if="\{\{item\.showLabel\}\}">\{\{item\.label\}\}<\/text>/);
  assert.match(page, /\.prism-menu-button\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*row[^}]*align-items:\s*center/s);
  assert.doesNotMatch(page, /assets\/icons\/folder-(?:open|closed)\.svg/);
});

test('bundled agent avatars exist with the theme green baked in', async () => {
  const { iconPath } = await import('../lib/prism-icons.js');

  for (const name of ['codex', 'claudecode', 'claude', 'openclaw', 'codebuddy', 'hermesagent', 'openai']) {
    const relative = iconPath({ plugin_id: name });
    assert.equal(relative, `../../assets/icons/agent_icon/icon_agent_${name}.svg`);
    // Relative asset paths in the page resolve against the page's directory.
    const svg = await readFile(new URL(relative, new URL('../pages/index/', import.meta.url)), 'utf8');
    assert.match(svg, /#40FF5E/i, `${name} avatar must bake the theme green`);
    assert.doesNotMatch(svg, /currentColor|1em/, `${name} avatar must not depend on inherited color or em sizing`);
    assert.match(svg, /width="20"/, `${name} avatar must carry a fixed 20px size`);
  }
});

test('bundled menu icons exist with the theme green baked in', async () => {
  const { menuIconPath } = await import('../lib/prism-icons.js');

  for (const name of ['shield-check', 'redo-2', 'rotate-ccw', 'send', 'square', 'undo-2', 'mic', 'circle']) {
    const relative = menuIconPath(name);
    assert.equal(relative, `../../assets/icons/menu_icon/icon_menu_${name}.svg`);
    const svg = await readFile(new URL(relative, new URL('../pages/index/', import.meta.url)), 'utf8');
    assert.match(svg, /#40FF5E/i, `${name} menu icon must bake the theme green`);
    assert.doesNotMatch(svg, /currentColor|1em/, `${name} menu icon must not depend on inherited color or em sizing`);
    assert.match(svg, /width="14"/, `${name} menu icon must carry a fixed 14px size`);
  }
});

test('voice input appends to existing draft, undos step-by-step, redoes step-by-step, and clears on menu exit', async () => {
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

  // 1. Initial state
  page.openMenu();
  assert.equal(page.data.surface, 'menu');
  assert.equal(page.data.draftText, '');
  assert.equal(page.data.restoredDraft, '');

  // 2. First voice input
  page.startVoiceInput();
  assert.equal(page.data.surface, 'voice');
  ScriptedRecognition.instance.onresult({ results: [[{ transcript: '帮我看下代码' }]] });
  assert.equal(page.data.draftText, '帮我看下代码');
  ScriptedRecognition.instance.onend();
  assert.equal(page.data.surface, 'menu');
  assert.equal(page.data.draftText, '帮我看下代码');
  assert.equal(page.data.restoredDraft, '');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['send', 'voice', 'undo']);
  assert.equal(page.data.focusIndex, 1, 'must focus on middle voice button, not left send button');
  assert.equal(page.data.menuButtons[1].showLabel, true);

  // 3. Second voice input: must not clear previous draft, must append
  page.startVoiceInput();
  assert.equal(page.data.surface, 'voice');
  assert.equal(page.data.draftText, '帮我看下代码', 'must not clear draft when starting voice input again');
  ScriptedRecognition.instance.onresult({ results: [[{ transcript: '顺便跑下测试' }]] });
  assert.equal(page.data.draftText, '帮我看下代码顺便跑下测试', 'must append to existing draftText');
  ScriptedRecognition.instance.onend();
  assert.equal(page.data.surface, 'menu');
  assert.equal(page.data.draftText, '帮我看下代码顺便跑下测试');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['send', 'voice', 'undo']);
  assert.equal(page.data.focusIndex, 1, 'must focus on middle voice button after second input as well');

  // 4. Step-by-step undo
  page.undoDraft();
  assert.equal(page.data.draftText, '帮我看下代码', 'first undo must revert the second voice input only');
  assert.equal(page.data.restoredDraft, '帮我看下代码顺便跑下测试');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['send', 'voice', 'undo', 'redo']);

  page.undoDraft();
  assert.equal(page.data.draftText, '', 'second undo must revert the first voice input');
  assert.equal(page.data.restoredDraft, '帮我看下代码');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['redo', 'voice']);

  // 5. Step-by-step redo
  page.redoDraft();
  assert.equal(page.data.draftText, '帮我看下代码', 'first redo must restore the first voice input');
  assert.equal(page.data.restoredDraft, '帮我看下代码顺便跑下测试');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['send', 'voice', 'undo', 'redo']);

  page.redoDraft();
  assert.equal(page.data.draftText, '帮我看下代码顺便跑下测试', 'second redo must restore the full draft');
  assert.equal(page.data.restoredDraft, '');
  assert.deepEqual(page.data.menuButtons.map((b) => b.id), ['send', 'voice', 'undo']);

  // 6. Exiting the menu clears all draft content
  page.closeMenu();
  assert.equal(page.data.surface, 'main');
  assert.equal(page.data.draftText, '', 'exiting the menu must clear the draftText');
  assert.equal(page.data.restoredDraft, '', 'exiting the menu must clear restoredDraft');
});

