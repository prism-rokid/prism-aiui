import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildWidgetSummary,
  conversationCounts,
  formatUsageReset,
  mergeConversationSnapshot,
  nextUsageCandidate,
  normalizeEpochMilliseconds,
  selectedUsageCandidate,
  shouldRotateUsageCandidates,
  truncateDisplayText,
  usageCandidates,
  usageRows
} from '../lib/widget-data.js';

const plugin = (id, usage = {}) => ({
  host_id: 'host-a',
  plugin_id: id,
  display_name: id,
  agent_usage: usage
});

test('只接受有效的 5h 和 7d 用量窗口，并计算剩余比例', () => {
  const candidates = usageCandidates([
    plugin('codex', {
      five_hour: { used_percent: 48, window_minutes: 300, resets_at: 1_786_000_000 },
      weekly: { used_percent: 52, window_minutes: 10080, resets_at: 1_786_000_000_000 }
    }),
    plugin('invalid', { five_hour: { used_percent: 10, window_minutes: 10080, resets_at: 1 } })
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].fiveHour.resetsAt, 1_786_000_000_000);
  assert.deepEqual(usageRows(candidates[0]).map((item) => item.percentLabel), ['52%', '48%']);
});

test('用量轮播保持当前 Agent，并在当前项消失后回退', () => {
  const candidates = usageCandidates([
    plugin('codex', { five_hour: { used_percent: 1, window_minutes: 300, resets_at: 1 } }),
    plugin('claude', { weekly: { used_percent: 2, window_minutes: 10080, resets_at: 1 } })
  ]);
  assert.equal(selectedUsageCandidate(candidates, 'host-a::claude').displayName, 'claude');
  assert.equal(nextUsageCandidate(candidates, 'host-a::claude').displayName, 'codex');
  assert.equal(selectedUsageCandidate(candidates, 'missing').displayName, 'codex');
  assert.equal(shouldRotateUsageCandidates(candidates), true);
  assert.equal(shouldRotateUsageCandidates([candidates[0]]), false);
});

test('重置时间兼容秒和毫秒时间戳', () => {
  const date = new Date(2026, 8, 6, 10, 11, 0).getTime();
  assert.equal(normalizeEpochMilliseconds(Math.floor(date / 1000)), date);
  assert.equal(formatUsageReset(date, 'five-hour'), '10:11');
  assert.equal(formatUsageReset(date, 'weekly'), '9/6 10:11');
});

test('汇总跨 Agent 会话：工作中优先、未读次之、最近会话补位', () => {
  const records = [
    { agent: { host_id: 'h1', plugin_id: 'codex' }, items: [
      { conversation_id: 'a', title: '正在整理项目文档', status: 'running', unread: true, updated_at: 2 },
      { conversation_id: 'b', title: '同步会议纪要', status: 'idle', unread: true, updated_at: 1 }
    ] },
    { agent: { host_id: 'h2', plugin_id: 'claude' }, items: [
      { conversation_id: 'c', title: '生成数据周报', status: 'waiting_approval', unread: false, updated_at: 3 },
      { conversation_id: 'd', title: '最安静的旧会话', status: 'idle', unread: false, updated_at: 0 }
    ] }
  ];
  const summary = buildWidgetSummary(records);
  assert.equal(summary.workingCount, 2);
  assert.equal(summary.unreadCount, 2);
  assert.equal(summary.totalCount, 4);
  assert.deepEqual(summary.items.map((item) => [item.title, item.marker]), [
    ['生成数据周报', 'running'],
    ['正在整理项目文档', 'running'],
    ['同步会议纪要', 'unread'],
    ['最安静的旧会话', 'recent']
  ]);
});

test('计数视图与汇总视图的 working/unread 数量一致', () => {
  const records = [
    { agent: { host_id: 'h1', plugin_id: 'codex' }, items: [
      { conversation_id: 'a', status: 'running', unread: true, updated_at: 2 },
      { conversation_id: 'b', status: 'idle', unread: true, updated_at: 1 }
    ] },
    { agent: { host_id: 'h1', plugin_id: 'codex' }, items: [
      { conversation_id: 'a', status: 'waiting_approval', unread: true, updated_at: 9 }
    ] }
  ];
  const counts = conversationCounts(records);
  const summary = buildWidgetSummary(records);
  assert.deepEqual(counts, { workingCount: summary.workingCount, unreadCount: summary.unreadCount });
  assert.deepEqual(counts, { workingCount: 1, unreadCount: 2 });
  assert.deepEqual(conversationCounts([]), { workingCount: 0, unreadCount: 0 });
});

test('会话缓存只在服务器给出可替换快照时同时采纳内容与签名', () => {
  const previous = { signature: 'sig-1', items: [{ conversation_id: 'old' }] };

  const pending = mergeConversationSnapshot(
    { changed: true, signature: 'sig-2', items: [], source: 'presence_cache_pending' }, previous);
  assert.equal(pending.adopted, false);
  assert.equal(pending.signature, 'sig-1', 'pending 响应不得推进签名，否则后续轮询永远 changed:false');
  assert.deepEqual(pending.items, previous.items);

  const unchanged = mergeConversationSnapshot({ changed: false, signature: 'sig-1' }, previous);
  assert.equal(unchanged.adopted, false);
  assert.equal(unchanged.signature, 'sig-1');

  const adopted = mergeConversationSnapshot(
    { changed: true, signature: 'sig-2', items: [{ conversation_id: 'new' }], source: 'presence_cache' }, previous);
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.signature, 'sig-2');
  assert.deepEqual(adopted.items, [{ conversation_id: 'new' }]);
});

test('标题按中英文显示宽度安全截断', () => {
  assert.equal(truncateDisplayText('abcdefghijklmnop', 10), 'abcdefg...');
  assert.equal(truncateDisplayText('同步会议纪要和项目文档', 10), '同步会...');
});

test('Widget 注册声明两个 1x1 小组件且结构符合 SFC 约束', async () => {
  const appJson = await readFile(new URL('../app.json', import.meta.url), 'utf8');
  const config = JSON.parse(appJson);
  assert.deepEqual(config.widgets.map((widget) => ({ path: widget.path, family: widget.family })), [
    { path: 'widgets/prism-usage/index', family: '1x1' },
    { path: 'widgets/prism-conversations/index', family: '1x1' }
  ]);
  for (const widget of config.widgets) {
    assert.ok(widget.displayName, `${widget.path} 需要 displayName`);
    assert.ok(widget.description, `${widget.path} 需要 description`);
  }
  for (const name of ['widgets/prism-usage/index.ink', 'widgets/prism-conversations/index.ink']) {
    const widget = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    const defMatch = widget.match(/<script type="application\/json" def>([\s\S]*?)<\/script>/);
    assert.ok(defMatch, `${name} 缺少 def 配置`);
    assert.deepEqual(JSON.parse(defMatch[1]), { widget: { family: '1x1' } });
    assert.match(widget, /<widget>/);
    assert.match(widget, /onAttach\s*\(\)/);
    assert.match(widget, /onDetach\s*\(\)/);
    assert.match(widget, /onDestroy\s*\(\)/);
    assert.doesNotMatch(widget, /<page>|onLoad\s*\(|onUnload\s*\(|100vh/);
    assert.doesNotMatch(widget, /<button\b|bindtap=|onKeyDown\s*\(/);
    assert.match(widget, /createWidgetRuntime/);
    assert.doesNotMatch(widget, /clearInterval\(this\._pollTimer\)/, '轮询定时器归 runtime 管，组件只管装饰定时器');
    assert.match(widget, /initI18n|t\('/);
  }
  const usage = await readFile(new URL('../widgets/prism-usage/index.ink', import.meta.url), 'utf8');
  assert.match(usage, /usageRows/);
  assert.match(usage, /widget-reset\.svg/);
  assert.match(usage, /class="summary-count">\{\{workingCount\}\}/);
  const conversations = await readFile(new URL('../widgets/prism-conversations/index.ink', import.meta.url), 'utf8');
  assert.match(conversations, /buildWidgetSummary/);
  assert.match(conversations, /RUNNING_STATUS_SYMBOLS/);
  assert.match(conversations, /'✦', '✧'/);
});
