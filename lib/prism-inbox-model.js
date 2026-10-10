// Inbox list model: item building from the conversation catalog, day-group
// layout with pixel offsets, focus scroll math, and the running status dot.

import { projectDisplayName, relativeTimeLabel, singleLineDisplayText } from './prism-labels.js';
import { t } from './prism-i18n.js';

export const LIST_DEFAULT_VIEWPORT_HEIGHT = 208;
const INBOX_MAX_ITEMS = 10;
const INBOX_ITEM_HEIGHT = 44;
const INBOX_GROUP_HEADER_HEIGHT = 24;

function inboxItemId(hostId, pluginId, conversationId) {
  return `inbox:${hostId}::${pluginId}:${conversationId}`;
}

// Day buckets for the inbox list. "昨天" follows the same calendar-day
// convention as relativeTimeLabel: [yesterday 00:00, today 00:00).
function inboxDayGroupLabel(timestamp, now = Date.now()) {
  const time = Number(timestamp) || 0;
  if (!time) return t('inbox.earlier');
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  if (time >= dayStart.getTime()) return t('inbox.today');
  if (time >= dayStart.getTime() - 24 * 60 * 60 * 1000) return t('inbox.yesterday');
  return t('inbox.earlier');
}

// Group headers render inside the scrolled content, so each row also carries
// its pixel offset from the content top. Only the first row of a group keeps
// the group label; the focus scroll math below relies on both values instead
// of assuming one uniform row height.
export function applyInboxGroupLayout(items, now = Date.now()) {
  let contentBottom = 0;
  let currentGroup = null;
  return (items || []).map((item) => {
    const group = inboxDayGroupLabel(item.updated_at, now);
    const groupLabel = group !== currentGroup ? group : '';
    if (groupLabel) currentGroup = group;
    const offsetTop = contentBottom + (groupLabel ? INBOX_GROUP_HEADER_HEIGHT : 0);
    contentBottom = offsetTop + INBOX_ITEM_HEIGHT;
    return { ...item, groupLabel, offsetTop };
  });
}

export function statusDotClass(item, pulsePhase = 0) {
  if (item && item.running) {
    const phase = Math.abs(Number(pulsePhase) || 0) % STATUS_DOT_PULSE_CLASSES.length;
    return `prism-status-dot is-running${STATUS_DOT_PULSE_CLASSES[phase]}`;
  }
  if (item && item.unread) return 'prism-status-dot is-unread';
  return 'prism-status-dot is-empty';
}

export function buildInboxItems(catalog, agents, now = Date.now(), pulsePhase = 0) {
  const agentByUid = new Map((agents || []).map((agent) => [agent.uid, agent]));
  const pool = [];
  for (const [uid, entry] of catalog || new Map()) {
    const agent = agentByUid.get(uid);
    if (!agent) continue;
    for (const conversation of (entry && entry.items) || []) {
      pool.push({ agent, conversation, updatedAt: Number(conversation.updated_at) || 0 });
    }
  }
  pool.sort((a, b) => b.updatedAt - a.updatedAt);
  const rows = pool.slice(0, INBOX_MAX_ITEMS).map((entry, index) => {
    const unread = Boolean(entry.conversation.unread);
    const running = entry.conversation.status === 'running';
    return {
      id: inboxItemId(entry.agent.host_id, entry.agent.plugin_id, entry.conversation.conversation_id),
      kind: 'inbox',
      host_id: entry.agent.host_id,
      plugin_id: entry.agent.plugin_id,
      conversation_id: entry.conversation.conversation_id,
      label: singleLineDisplayText(entry.conversation.title || t('inbox.untitledThread'), 42),
      projectName: projectDisplayName(entry.conversation.cwd),
      icon: entry.agent.icon,
      unread,
      running,
      statusDotClass: statusDotClass({ unread, running }, pulsePhase),
      updated_at: entry.updatedAt,
      timeLabel: relativeTimeLabel(entry.updatedAt, now),
      anchorId: `inbox-option-${index}`,
      idx: index
    };
  });
  return applyInboxGroupLayout(rows, now);
}

export function decorateInbox(items, focusIndex) {
  return (items || []).map((item, index) => ({
    ...item,
    idx: index,
    className: `prism-inbox-choice${index === focusIndex ? ' is-focused' : ''}`
  }));
}

function inboxRowTop(row, index) {
  const offsetTop = Number(row && row.offsetTop);
  return Number.isFinite(offsetTop) && offsetTop > 0 ? offsetTop : index * INBOX_ITEM_HEIGHT;
}

// Every scroll position snaps to the top edge of a row (or of the group header
// that precedes it), so the first visible row is never cut in half; a partial
// row can only appear at the bottom edge. The content ends with a tail spacer
// taller than the viewport, so the native scroll view never clamps a snapped
// position near the end of the list.
export function inboxScrollTopForFocus(items, focusIndex, currentScrollTop, viewportHeight) {
  const rows = items || [];
  if (!rows.length) return 0;
  const visibleHeight = Math.max(INBOX_ITEM_HEIGHT, Number(viewportHeight) || LIST_DEFAULT_VIEWPORT_HEIGHT);
  const blockStarts = rows.map((row, index) => {
    const top = inboxRowTop(row, index);
    return row && row.groupLabel ? Math.max(0, top - INBOX_GROUP_HEADER_HEIGHT) : top;
  });
  blockStarts[0] = 0;
  const current = Math.max(0, Number(currentScrollTop) || 0);
  let blockIndex = 0;
  for (let index = 0; index < blockStarts.length; index += 1) {
    if (blockStarts[index] <= current) blockIndex = index;
  }
  const focus = Number(focusIndex);
  if (!rows[focus]) return blockStarts[blockIndex];
  if (focus < blockIndex) return blockStarts[focus];
  const itemBottom = inboxRowTop(rows[focus], focus) + INBOX_ITEM_HEIGHT;
  while (blockIndex < focus && itemBottom > blockStarts[blockIndex] + visibleHeight) blockIndex += 1;
  return blockStarts[blockIndex];
}

export const STATUS_DOT_PULSE_INTERVAL_MS = 240;
export const STATUS_DOT_PULSE_CLASSES = [
  ' is-pulse-low',
  ' is-pulse-mid',
  ' is-pulse-high',
  ' is-pulse-mid'
];
