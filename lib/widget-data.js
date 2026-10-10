// Shared data layer for the two home-screen widgets: merging conversation
// snapshots (prism-conversations) and building i18n-aware summaries.
import { t } from './prism-i18n.js';

const FIVE_HOUR_MINUTES = 300;
const WEEKLY_MINUTES = 10080;
const EPOCH_MILLISECONDS_THRESHOLD = 100000000000;

function numberValue(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function textValue(value, fallback = '') {
  const result = String(value || '').trim();
  return result || fallback;
}

function displayUnits(character) {
  return /[\u0000-\u00ff]/.test(character) ? 1 : 2;
}

export function truncateDisplayText(value, maxUnits = 30) {
  const source = textValue(value);
  let used = 0;
  let result = '';
  for (const character of source) {
    const units = displayUnits(character);
    if (used + units > maxUnits - 3) return `${result}...`;
    result += character;
    used += units;
  }
  return result;
}

export function normalizeEpochMilliseconds(value) {
  const epoch = numberValue(value);
  if (epoch === undefined || epoch < 0) return undefined;
  return epoch < EPOCH_MILLISECONDS_THRESHOLD ? epoch * 1000 : epoch;
}

export function usageWindow(source, expectedMinutes) {
  const window = source && typeof source === 'object' ? source : {};
  const usedPercent = numberValue(window.used_percent);
  const windowMinutes = numberValue(window.window_minutes);
  const resetsAt = normalizeEpochMilliseconds(window.resets_at);
  if (usedPercent === undefined || usedPercent < 0 || usedPercent > 100
    || windowMinutes !== expectedMinutes || resetsAt === undefined) return undefined;
  return { usedPercent, windowMinutes, resetsAt };
}

export function usageCandidates(plugins) {
  return (Array.isArray(plugins) ? plugins : []).flatMap((plugin) => {
    const source = plugin && plugin.agent_usage;
    const fiveHour = usageWindow(source && source.five_hour, FIVE_HOUR_MINUTES);
    const weekly = usageWindow(source && source.weekly, WEEKLY_MINUTES);
    if (!fiveHour && !weekly) return [];
    const hostId = textValue(plugin && plugin.host_id);
    const pluginId = textValue(plugin && plugin.plugin_id);
    return [{
      ...plugin,
      uid: `${hostId}::${pluginId}`,
      displayName: textValue(plugin && plugin.display_name, pluginId || 'Agent'),
      fiveHour,
      weekly
    }];
  });
}

export function selectedUsageCandidate(candidates, currentUid = '') {
  const items = Array.isArray(candidates) ? candidates : [];
  return items.find((item) => item.uid === currentUid) || items[0] || null;
}

export function nextUsageCandidate(candidates, currentUid = '') {
  const items = Array.isArray(candidates) ? candidates : [];
  if (!items.length) return null;
  const currentIndex = items.findIndex((item) => item.uid === currentUid);
  return items[(currentIndex + 1 + items.length) % items.length];
}

export function shouldRotateUsageCandidates(candidates) {
  return Array.isArray(candidates) && candidates.length > 1;
}

function twoDigits(value) {
  return value < 10 ? `0${value}` : String(value);
}

export function formatUsageReset(resetsAt, kind) {
  const epoch = normalizeEpochMilliseconds(resetsAt);
  if (epoch === undefined) return '--';
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) return '--';
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  return kind === 'weekly' ? `${date.getMonth() + 1}/${date.getDate()} ${time}` : time;
}

export function usageRows(candidate) {
  const build = (id, label, window) => {
    if (!window) return {
      id,
      label,
      percentLabel: '--',
      resetLabel: '--',
      trackStyle: 'width: 0%;',
      available: false
    };
    const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
    return {
      id,
      label,
      percentLabel: `${Math.round(remaining)}%`,
      resetLabel: formatUsageReset(window.resetsAt, id === '7d' ? 'weekly' : 'five-hour'),
      trackStyle: `width: ${remaining}%;`,
      available: true
    };
  };
  return [
    build('5h', '5h', candidate && candidate.fiveHour),
    build('7d', '7d', candidate && candidate.weekly)
  ];
}

function conversationId(agent, conversation, index) {
  return `${textValue(agent && agent.host_id)}::${textValue(agent && agent.plugin_id)}::${textValue(conversation && conversation.conversation_id, String(index))}`;
}

function isWorking(status) {
  return status === 'running' || status === 'waiting_approval';
}

// Folds per-agent conversation indexes into one map keyed by stable id,
// OR-merging working/unread across sources. titleUnits <= 0 skips the title
// work for count-only consumers.
function collectConversations(records, titleUnits = 30) {
  const conversations = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const agent = record && record.agent || {};
    for (const [index, conversation] of (record && record.items || []).entries()) {
      const id = conversationId(agent, conversation, index);
      const status = textValue(conversation && conversation.status);
      const next = {
        id,
        title: titleUnits > 0
          ? truncateDisplayText(conversation && conversation.title, titleUnits) || t('inbox.untitledConversation')
          : '',
        updatedAt: numberValue(conversation && conversation.updated_at) || 0,
        working: isWorking(status),
        unread: Boolean(conversation && conversation.unread)
      };
      const previous = conversations.get(id);
      conversations.set(id, previous ? {
        ...previous,
        title: next.title || previous.title,
        updatedAt: Math.max(previous.updatedAt, next.updatedAt),
        working: previous.working || next.working,
        unread: previous.unread || next.unread
      } : next);
    }
  }
  return conversations;
}

export function buildWidgetSummary(records, titleUnits = 30, maxItems = 4) {
  const all = [...collectConversations(records, titleUnits).values()];
  const sortNewest = (left, right) => right.updatedAt - left.updatedAt;
  const working = all.filter((item) => item.working).sort(sortNewest);
  const unreadOnly = all.filter((item) => item.unread && !item.working).sort(sortNewest);
  // Latest-conversation digest: working first, then unread, then the most
  // recently updated quiet conversations so the widget always shows the
  // newest activity instead of going blank when nothing runs or is unread.
  const quiet = all.filter((item) => !item.working && !item.unread).sort(sortNewest);
  const items = [...working, ...unreadOnly, ...quiet].slice(0, maxItems).map((item) => ({
    ...item,
    marker: item.working ? 'running' : (item.unread ? 'unread' : 'recent')
  }));
  return {
    workingCount: working.length,
    unreadCount: all.filter((item) => item.unread).length,
    totalCount: all.length,
    items
  };
}

// Count-only view of the conversation state for widgets that show just the
// working/unread badges.
export function conversationCounts(records) {
  let workingCount = 0;
  let unreadCount = 0;
  for (const item of collectConversations(records, 0).values()) {
    if (item.working) workingCount += 1;
    if (item.unread) unreadCount += 1;
  }
  return { workingCount, unreadCount };
}

// Merges one conversation-index response into the cached entry. The API
// contract says a warming presence cache answers with items=[] (and a
// changed:false answer means the server believes the known signature already
// matches current content). In both cases the previous items AND the previous
// signature must be kept: adopting a response signature for content we did
// not take would make every later conditional request report "unchanged" and
// pin the stale list forever.
export function mergeConversationSnapshot(response, previous) {
  const prior = previous && typeof previous === 'object'
    ? { signature: '', items: [], ...previous }
    : { signature: '', items: [] };
  if (!response || typeof response !== 'object'
    || response.changed === false || response.source === 'presence_cache_pending') {
    return { ...prior, adopted: false };
  }
  return {
    signature: response.signature || prior.signature,
    items: Array.isArray(response.items) ? response.items : prior.items,
    adopted: true
  };
}
