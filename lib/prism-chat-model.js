// Chat message model: normalization, chat-item building, and the estimated
// virtualized layout (heights, offsets, anchors, progress segments) used by
// the page's scroll and focus logic. Pure functions, no page state.

import { t } from './prism-i18n.js';

function buildDefaultMessages() {
  return [
    {
      id: 'welcome',
      role: 'assistant',
      type: 'text',
      content: t('chat.welcome'),
      status: '',
      created_at: 0,
      updated_at: 0
    }
  ];
}

const LONG_DISPLAY_TOKEN_UNITS = 36;

function breakLongDisplayText(value) {
  return String(value || '').split(/(\s+)/).map((token) => {
    if (!token || /^\s+$/.test(token) || visualTextUnits(token) <= LONG_DISPLAY_TOKEN_UNITS) return token;
    return token
      .replace(/([/\\?&=._:#-])/g, '$1\u200b')
      .replace(/([a-z0-9])([A-Z])/g, '$1\u200b$2');
  }).join('');
}

export function normalizeMessage(message, index) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const content = String(message.content || '');
  const id = message.id || `message-${index}`;
  const anchorToken = String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
  const anchorId = `message-${anchorToken || index}`;
  return {
    ...message,
    id,
    anchorId,
    role,
    content,
    displayContent: role === 'user' ? breakLongDisplayText(content) : content,
    statusLabel: message.status === 'sending' ? t('chat.sending') : (message.status === 'failed' ? t('chat.sendFailedStatus') : ''),
    authorLabel: role === 'assistant' ? (message.authorLabel || 'Agent') : '',
    wrapperClass: role === 'user' ? 'prism-message prism-message-user' : 'prism-message prism-message-agent'
  };
}

export function buildChatItems(messages) {
  const items = [];
  const lastMessageIndex = (messages || []).length - 1;
  const lastMessage = lastMessageIndex >= 0 ? messages[lastMessageIndex] : null;
  const latestAssistantIndex = lastMessage && lastMessage.role === 'assistant' && lastMessage.content
    ? lastMessageIndex
    : -1;
  const base = () => ({
    kind: '', anchorId: '', className: '', key: '',
    content: '', statusLabel: '', text: '', isLatestAssistant: false
  });
  for (let messageIndex = 0; messageIndex < (messages || []).length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message.role === 'user') {
      items.push({
        ...base(),
        kind: 'user',
        key: `chat-${message.id}`,
        anchorId: message.anchorId,
        className: message.wrapperClass,
        content: message.displayContent,
        statusLabel: message.statusLabel
      });
      continue;
    }
    const hasContent = Boolean(message.content);
    const nextMessage = (messages || [])[messageIndex + 1];
    // The meta line is a turn-completion marker: render it once, on the last
    // content-bearing message of a consecutive assistant run. Empty/running
    // placeholders stay silent (the bottom processing row covers them), and a
    // reply split into several message records must not show stray "已处理"
    // lines between its fragments or under the user's latest bubble.
    if (hasContent && (!nextMessage || nextMessage.role !== 'assistant')) {
      items.push({
        ...base(),
        kind: 'assistant_meta',
        key: `chat-${message.id}-meta`,
        anchorId: `${message.anchorId}-meta`,
        className: 'prism-chat-row prism-agent-meta-row',
        text: message.authorLabel
      });
    }
    if (hasContent) {
      items.push({
        ...base(),
        kind: 'assistant_markdown',
        key: `chat-${message.id}-markdown`,
        anchorId: `${message.anchorId}-markdown`,
        className: 'prism-chat-row prism-agent-markdown-row prism-agent-row-end',
        content: message.content,
        isLatestAssistant: messageIndex === latestAssistantIndex
      });
    }
  }
  return items;
}

function visualTextUnits(value) {
  let units = 0;
  for (const character of String(value || '')) {
    if (character === '\u200b') continue;
    units += /[\u0000-\u00ff]/.test(character) ? 1 : 2;
  }
  return units;
}

function wrappedLineCount(value, unitsPerLine) {
  const lines = String(value || '').split('\n');
  return lines.reduce((total, line) => total + Math.max(1, Math.ceil(visualTextUnits(line) / unitsPerLine)), 0);
}

function estimatedChatItemHeight(item) {
  if (item.kind === 'user') {
    // Text + 6.5px vertical padding + 1px border + 16px message gap.
    return wrappedLineCount(item.content, 58) * 18 + 23.5;
  }
  if (item.kind === 'assistant_meta') return 22;
  if (item.kind === 'assistant_markdown') return wrappedLineCount(item.content, 63) * 24 + 22;
  return wrappedLineCount(item.text, 74) * 18 + (String(item.className || '').indexOf('prism-agent-row-end') >= 0 ? 16 : 3);
}

function buildChatItemHeights(chatItems) {
  return (chatItems || []).map((item) => estimatedChatItemHeight(item));
}

function buildChatItemOffsets(chatItemHeights) {
  const offsets = [0];
  for (const height of chatItemHeights || []) offsets.push(offsets[offsets.length - 1] + height);
  return offsets;
}

const CHAT_VIEWPORT_ESTIMATE = 280;
const CHAT_PROGRESS_INTERVAL = 196;
export const CHAT_INITIAL_LOAD_HEIGHT = CHAT_VIEWPORT_ESTIMATE * 3;
export const CHAT_LOAD_CHUNK_HEIGHT = CHAT_VIEWPORT_ESTIMATE * 2;
// Anchor paging hands position resolution to the native scroll view, so the
// drift between estimated and rendered heights can no longer strand the view
// past the real scroll range. Two stacked bottom anchors alternate as the
// scroll-into-view target because the runtime ignores repeated identical ids.
export const CHAT_LOAD_AHEAD_ANCHORS = 1;
export const CHAT_BOTTOM_ANCHOR_IDS = ['prism-chat-bottom-a', 'prism-chat-bottom-b'];

function buildChatAnchors(chatItems, chatItemHeights = buildChatItemHeights(chatItems)) {
  const items = chatItems || [];
  if (!items.length) return [];
  const entries = [];
  let pageStartIndex = items.length - 1;
  let accumulatedHeight = chatItemHeights[pageStartIndex];
  for (let index = items.length - 2; index >= 0; index -= 1) {
    const itemHeight = chatItemHeights[index];
    if (accumulatedHeight + itemHeight > CHAT_PROGRESS_INTERVAL) {
      entries.push({ anchorId: items[pageStartIndex].anchorId, itemIndex: pageStartIndex });
      pageStartIndex = index;
      accumulatedHeight = itemHeight;
    } else {
      pageStartIndex = index;
      accumulatedHeight += itemHeight;
    }
  }
  entries.push({ anchorId: items[pageStartIndex].anchorId, itemIndex: pageStartIndex });
  return entries.reverse();
}

export function buildChatLayoutMetrics(chatItems) {
  const itemHeights = buildChatItemHeights(chatItems);
  const itemOffsets = buildChatItemOffsets(itemHeights);
  const anchorEntries = buildChatAnchors(chatItems, itemHeights);
  return {
    itemHeights,
    itemOffsets,
    anchors: anchorEntries.map((entry) => entry.anchorId),
    anchorItemIndexes: anchorEntries.map((entry) => entry.itemIndex),
    contentHeight: itemOffsets[itemOffsets.length - 1] || 0
  };
}

function chatItemOffset(chatItems, itemIndex, chatItemOffsets) {
  const items = chatItems || [];
  const endIndex = Math.max(0, Math.min(items.length, Number(itemIndex) || 0));
  if (Array.isArray(chatItemOffsets) && Number.isFinite(chatItemOffsets[endIndex])) {
    return chatItemOffsets[endIndex];
  }
  let offset = 0;
  for (let index = 0; index < endIndex; index += 1) offset += estimatedChatItemHeight(items[index]);
  return offset;
}

export function chatTailStartIndex(chatItems, targetHeight, chatItemHeights) {
  const items = chatItems || [];
  let startIndex = items.length;
  let loadedHeight = 0;
  while (startIndex > 0 && loadedHeight < targetHeight) {
    startIndex -= 1;
    loadedHeight += Array.isArray(chatItemHeights)
      ? chatItemHeights[startIndex]
      : estimatedChatItemHeight(items[startIndex]);
  }
  return startIndex;
}

export function earlierChatStartIndex(chatItems, currentStartIndex, targetHeight, chatItemHeights) {
  const items = chatItems || [];
  let startIndex = Math.max(0, Math.min(items.length, Number(currentStartIndex) || 0));
  let addedHeight = 0;
  while (startIndex > 0 && addedHeight < targetHeight) {
    startIndex -= 1;
    addedHeight += Array.isArray(chatItemHeights)
      ? chatItemHeights[startIndex]
      : estimatedChatItemHeight(items[startIndex]);
  }
  return startIndex;
}

export function chatTopSpacerStyle(chatItems, loadedStartIndex, chatItemOffsets) {
  return `height: ${chatItemOffset(chatItems, loadedStartIndex, chatItemOffsets)}px;`;
}

export function retainedChatLoadedStartIndex(previousItems, nextItems, previousStartIndex) {
  const priorItems = previousItems || [];
  const items = nextItems || [];
  const previousStart = Math.max(0, Math.min(priorItems.length, Number(previousStartIndex) || 0));
  const firstLoaded = priorItems[previousStart];
  if (firstLoaded) {
    const retainedIndex = items.findIndex((item) => item.key === firstLoaded.key);
    if (retainedIndex >= 0) return retainedIndex;
  }
  return chatTailStartIndex(items, CHAT_INITIAL_LOAD_HEIGHT);
}

export function chatLoadedProgressAnchorIndex(anchorItemIndexes, loadedStartIndex) {
  for (let index = 0; index < (anchorItemIndexes || []).length; index += 1) {
    if (anchorItemIndexes[index] >= loadedStartIndex) return index;
  }
  return Math.max(0, (anchorItemIndexes || []).length - 1);
}

function chatFocusIndexForItemIndex(anchorItemIndexes, itemIndex) {
  const indexes = anchorItemIndexes || [];
  let focusIndex = 0;
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] > itemIndex) break;
    focusIndex = index;
  }
  return focusIndex;
}

export function retainedChatFocusIndex(chatAnchors, previousFocusId, previousItemIndex, anchorItemIndexes) {
  const anchors = chatAnchors || [];
  const byId = previousFocusId ? anchors.indexOf(previousFocusId) : -1;
  if (byId >= 0) return byId;
  return chatFocusIndexForItemIndex(anchorItemIndexes, Number(previousItemIndex) || 0);
}

// Each estimated viewport section owns one equal flex segment. The active
// segment follows the continuous pixel offset without requiring DOM metrics.
export function buildChatProgressSegments(chatAnchors, focusIndex, loadedFromIndex = 0) {
  const anchors = chatAnchors || [];
  if (!anchors.length) return [];
  const currentIndex = Math.max(0, Math.min(anchors.length - 1, Number(focusIndex) || 0));
  const loadedIndex = Math.max(0, Math.min(anchors.length - 1, Number(loadedFromIndex) || 0));
  return anchors.map((anchorId, index) => ({
    id: `chat-progress-${anchorId}`,
    className: `prism-chat-progress-segment${index >= loadedIndex ? ' is-loaded' : ''}${index === currentIndex ? ' is-current' : ''}`
  }));
}

export function buildListProgressSegments(items, focusIndex, prefix) {
  const source = items || [];
  if (!source.length) return [];
  const currentIndex = Math.max(0, Math.min(source.length - 1, Number(focusIndex) || 0));
  return source.map((item, index) => ({
    id: `${prefix}-progress-${item.id || index}`,
    className: `prism-list-progress-segment${index === currentIndex ? ' is-current' : ''}`
  }));
}

export const INITIAL_MESSAGES = buildDefaultMessages().map(normalizeMessage);
export const INITIAL_CHAT_ITEMS = buildChatItems(INITIAL_MESSAGES);
export const INITIAL_CHAT_LAYOUT = buildChatLayoutMetrics(INITIAL_CHAT_ITEMS);
export const INITIAL_CHAT_ANCHORS = INITIAL_CHAT_LAYOUT.anchors;
export const INITIAL_CHAT_ANCHOR_ITEM_INDEXES = INITIAL_CHAT_LAYOUT.anchorItemIndexes;
export const INITIAL_CHAT_FOCUS_INDEX = Math.max(0, INITIAL_CHAT_ANCHORS.length - 1);
export const INITIAL_CHAT_FOCUS_ITEM_INDEX = INITIAL_CHAT_ANCHOR_ITEM_INDEXES[INITIAL_CHAT_FOCUS_INDEX] || 0;
export const INITIAL_CHAT_LOADED_START_INDEX = chatTailStartIndex(
  INITIAL_CHAT_ITEMS,
  CHAT_INITIAL_LOAD_HEIGHT,
  INITIAL_CHAT_LAYOUT.itemHeights
);
export const INITIAL_CHAT_LOADED_PROGRESS_INDEX = chatLoadedProgressAnchorIndex(
  INITIAL_CHAT_ANCHOR_ITEM_INDEXES,
  INITIAL_CHAT_LOADED_START_INDEX
);

// Locale-aware replacement for the INITIAL_* constants above: the welcome
// message is translated, so the boot state is rebuilt after initI18n() has
// resolved the locale instead of being frozen at module import time.
export function buildInitialChatState() {
  const messages = buildDefaultMessages().map(normalizeMessage);
  const chatItems = buildChatItems(messages);
  const layout = buildChatLayoutMetrics(chatItems);
  const anchors = layout.anchors;
  const anchorItemIndexes = layout.anchorItemIndexes;
  const focusIndex = Math.max(0, anchors.length - 1);
  const loadedStartIndex = chatTailStartIndex(chatItems, CHAT_INITIAL_LOAD_HEIGHT, layout.itemHeights);
  return {
    messages,
    chatItems,
    chatAnchors: anchors,
    chatAnchorItemIndexes: anchorItemIndexes,
    chatItemHeights: layout.itemHeights,
    chatItemOffsets: layout.itemOffsets,
    chatContentHeight: layout.contentHeight,
    chatLoadedStartIndex: loadedStartIndex,
    chatFocusItemIndex: anchorItemIndexes[focusIndex] || 0,
    chatFocusIndex: focusIndex,
    chatLoadedProgressIndex: chatLoadedProgressAnchorIndex(anchorItemIndexes, loadedStartIndex)
  };
}

export function decorate(items, focusIndex, baseClass) {
  return items.map((item, index) => ({
    ...item,
    idx: index,
    className: `${baseClass}${index === focusIndex ? ' is-focused' : ''}${item.selected ? ` is-selected ${baseClass}-selected` : ''}${item.disabled ? ' is-disabled' : ''}`
  }));
}

export function decorateMenu(items, focusIndex) {
  return decorate(items, focusIndex, 'prism-menu-button').map((item, index) => ({
    ...item,
    showLabel: index === focusIndex
  }));
}
