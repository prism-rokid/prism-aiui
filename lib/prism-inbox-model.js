// Conversation catalog and the card carousel view derived from its focus.

import { projectDisplayName, relativeTimeLabel, singleLineDisplayText } from './prism-labels.js';
import { t } from './prism-i18n.js';

const INBOX_MAX_ITEMS = 10;
const INBOX_CARD_STEP = 174;

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
  dayStart.setDate(dayStart.getDate() - 1);
  if (time >= dayStart.getTime()) return t('inbox.yesterday');
  return t('inbox.earlier');
}

export function refreshInboxLabels(items, now) {
  return items.map((item) => ({
    ...item,
    groupLabel: inboxDayGroupLabel(item.updated_at, now),
    timeLabel: relativeTimeLabel(item.updated_at, now)
  }));
}

export function statusDotClass(item, pulsePhase = 0) {
  if (item && item.running) {
    const phase = Math.abs(Number(pulsePhase) || 0) % STATUS_DOT_PULSE_CLASSES.length;
    return STATUS_DOT_PULSE_CLASSES[phase];
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
  const items = pool.slice(0, INBOX_MAX_ITEMS).map((entry) => {
    const unread = Boolean(entry.conversation.unread);
    const running = entry.conversation.status === 'running';
    return {
      id: inboxItemId(entry.agent.host_id, entry.agent.plugin_id, entry.conversation.conversation_id),
      host_id: entry.agent.host_id,
      plugin_id: entry.agent.plugin_id,
      conversation_id: entry.conversation.conversation_id,
      label: singleLineDisplayText(entry.conversation.title || t('inbox.untitledThread'), 42),
      projectName: projectDisplayName(entry.conversation.cwd),
      icon: entry.agent.icon,
      unread,
      running,
      statusDotClass: statusDotClass({ unread, running }, pulsePhase),
      updated_at: entry.updatedAt
    };
  });
  return refreshInboxLabels(items, now);
}

export function buildInboxView(items, focusIndex, animate = false) {
  return {
    inboxFocusedItem: items[focusIndex] || null,
    inboxMotion: animate,
    // Keep all card nodes keyed by conversation ID so a new navigation step
    // can retarget an in-flight transition, including when direction reverses.
    inboxItems: items.map((item, index) => {
      const offset = index - focusIndex;
      const focused = offset === 0;
      return {
        ...item,
        className: `prism-inbox-choice${focused ? ' is-focused' : ''}`,
        cardStyle: `transform: translateX(${offset * INBOX_CARD_STEP}px) scale(${focused ? 1 : 0.8});`,
        tabIndex: focused ? 0 : -1
      };
    }),
    inboxProgressDots: items.map((item, index) => ({
      id: item.id,
      className: `prism-inbox-progress-dot${index === focusIndex ? ' is-current' : ''}`
    }))
  };
}

export const STATUS_DOT_PULSE_INTERVAL_MS = 240;
export const STATUS_DOT_PULSE_CLASSES = [
  'prism-status-dot is-running',
  'prism-status-dot is-running is-pulse-mid',
  'prism-status-dot is-running is-pulse-high',
  'prism-status-dot is-running is-pulse-mid'
];
