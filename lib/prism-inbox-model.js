// Conversation catalog and the card carousel view derived from its focus.

import { projectDisplayName, relativeTimeLabel, singleLineDisplayText } from './prism-labels.js';
import { t } from './prism-i18n.js';

const INBOX_MAX_ITEMS = 10;
const INBOX_CARD_STEP = 174;

export function inboxItemId(hostId, pluginId, conversationId) {
  return `inbox:${hostId}::${pluginId}:${conversationId}`;
}

export function activityTimestamp(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const epoch = Number(value);
  const time = Number.isNaN(epoch) ? Date.parse(value)
    : epoch < 10_000_000_000 ? epoch * 1000 : epoch;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

export function refreshInboxLabels(items, now) {
  return items.map((item) => ({
    ...item,
    timeLabel: relativeTimeLabel(item.activityAt, now)
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

export function buildInboxItems(catalog, agents, now = Date.now(), pulsePhase = 0, {
  activityById = new Map(), retainItemId = ''
} = {}) {
  const agentByUid = new Map((agents || []).map((agent) => [agent.uid, agent]));
  const pool = [];
  for (const [uid, entry] of catalog || new Map()) {
    const agent = agentByUid.get(uid);
    if (!agent) continue;
    for (const conversation of (entry && entry.items) || []) {
      const id = inboxItemId(agent.host_id, agent.plugin_id, conversation.conversation_id);
      let activity = activityById.get(id);
      if (!activity) {
        // Legacy indexes only have updated_at, which can also change on open.
        activity = {
          firstSeenAt: now,
          initialOrder: activityById.size,
          initialUpdatedAt: activityTimestamp(conversation.updated_at),
          messageAt: 0
        };
        activityById.set(id, activity);
      }
      const indexedMessageAt = activityTimestamp(conversation.last_message_at)
        || activityTimestamp(conversation.last_activity_at);
      activity.messageAt = Math.max(activity.messageAt, indexedMessageAt);
      pool.push({ id, agent, conversation, activityAt: activity.messageAt || activity.initialUpdatedAt, order: activity.initialOrder });
    }
  }
  pool.sort((a, b) => b.activityAt - a.activityAt || a.order - b.order);
  const visible = pool.slice(0, INBOX_MAX_ITEMS);
  const retained = retainItemId && pool.slice(INBOX_MAX_ITEMS).find((entry) => entry.id === retainItemId);
  if (retained) visible[INBOX_MAX_ITEMS - 1] = retained;
  const items = visible.map((entry) => {
    const unread = Boolean(entry.conversation.unread);
    const running = entry.conversation.status === 'running';
    return {
      id: entry.id,
      host_id: entry.agent.host_id,
      plugin_id: entry.agent.plugin_id,
      conversation_id: entry.conversation.conversation_id,
      label: singleLineDisplayText(entry.conversation.title || t('inbox.untitledThread'), 42),
      projectName: projectDisplayName(entry.conversation.cwd),
      avatar: entry.agent.avatar,
      unread,
      running,
      statusDotClass: statusDotClass({ unread, running }, pulsePhase),
      activityAt: entry.activityAt
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
