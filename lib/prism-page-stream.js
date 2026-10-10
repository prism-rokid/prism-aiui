// Conversation state-stream methods: NDJSON stream lifecycle (open/close/
// liveness/buffered-drain/reconnect), frame dispatch, and message/detail
// application onto the chat model.

import { trace, errorDetails, scrollTrace, performanceTimestamp, performanceTrace } from './prism-trace.js';
import { normalizeMessage, buildChatItems, buildChatLayoutMetrics, chatTopSpacerStyle, retainedChatLoadedStartIndex, chatLoadedProgressAnchorIndex, retainedChatFocusIndex, buildChatProgressSegments, decorate } from './prism-chat-model.js';
import { processingLabel, compactDisplayText, approvalActionsFrom, interactiveControlValue, displayOption, compactModelLabel, compactReasoningLabel, compactPermissionLabel, compactContextLabel, optionIdentity } from './prism-labels.js';
import { chatLayoutClass, isListSurface, isMenuSurface } from './prism-surfaces.js';
import { t } from './prism-i18n.js';

const STREAM_LIVENESS_TIMEOUT_MS = 60000;
const STREAM_RECONNECT_DELAY_MS = 1500;
const STREAM_FIRST_FRAME_PROBE_MS = 500;
const STREAM_DRAIN_RETRY_MS = 500;
const STREAM_DRAIN_MAX_ATTEMPTS = 3;
const STREAM_BUFFERED_INITIAL_DRAIN_MS = 1500;
const STREAM_BUFFERED_REFRESH_MS = 20000;
const STREAM_BUFFERED_DRAIN_TIMEOUT_MS = 600000;
// A conversation snapshot with no message pages following it (an empty/new
// conversation) must still settle into the empty-chat view; without this the
// loading overlay never clears and hides every panel behind it.
const EMPTY_CONVERSATION_SETTLE_MS = 1500;

function changedPatch(current, next) {
  const patch = {};
  for (const key of Object.keys(next)) {
    if (current[key] !== next[key]) patch[key] = next[key];
  }
  return patch;
}

function valueSignature(value) {
  try {
    return JSON.stringify(value || null);
  } catch (error) {
    return '';
  }
}

export function createStreamMethods({ createStreamId, readableError }) {
  return {

  openConversationStream() {
    this.ensureRuntimeState();
    this.closeConversationStream();
    const hostId = this.data.selectedHostId;
    const pluginId = this.data.selectedPluginId;
    const conversationId = this.data.selectedConversationId;
    if (!this._api || !hostId || !pluginId || !conversationId) {
      trace('stream.open.skipped', { hostId, pluginId, conversationId });
      return;
    }
    const streamId = createStreamId('conv');
    const record = {
      hostId,
      pluginId,
      conversationId,
      streamId,
      closed: false,
      buffered: false,
      draining: false,
      drainTimer: null,
      drainFallbackTimer: null,
      drainRetryTimer: null,
      firstFrameProbeTimer: null,
      openedAt: Date.now(),
      frameCount: 0,
      firstFrameAt: 0,
      lastFrameAt: 0,
      handle: null
    };
    this._convStream = record;
    this._lastFrameAt = Date.now();
    this._unavailableToastAt = 0;
    this._streamWatchdog = setInterval(() => this.checkStreamLiveness(), 15000);
    record.firstFrameProbeTimer = setTimeout(() => {
      record.firstFrameProbeTimer = null;
      if (!this._convStream || this._convStream !== record || record.closed || record.firstFrameAt) return;
      trace('stream.first_frame_probe.expired', {
        streamId: record.streamId,
        conversationId: record.conversationId,
        timeoutMs: STREAM_FIRST_FRAME_PROBE_MS,
        elapsedMs: Date.now() - record.openedAt
      });
      this.beginConversationStreamDrain(record, 'first_frame_timeout');
    }, STREAM_FIRST_FRAME_PROBE_MS);
    record.handle = this._api.openConversationStream({
      hostId,
      pluginId,
      conversationId,
      streamId,
      clientInstanceId: this._clientInstanceId,
      onFrame: (frame) => this.handleStreamFrame(record, frame),
      onClose: (info) => this.handleStreamClosed(record, info),
      onBuffered: (info) => this.handleBufferedStream(record, info)
    });
    trace('stream.open.dispatched', {
      hostId,
      pluginId,
      conversationId,
      streamId,
      messagesLoaded: this.data.messagesLoaded,
      chatItemCount: this._chatItems.length,
      firstFrameProbeMs: STREAM_FIRST_FRAME_PROBE_MS,
      dispatchMs: Date.now() - record.openedAt
    });
  },

  closeConversationStream() {
    const record = this._convStream;
    this._convStream = null;
    this.clearEmptyConversationSettle();
    if (this._streamWatchdog) {
      clearInterval(this._streamWatchdog);
      this._streamWatchdog = null;
    }
    if (this._streamReconnectTimer) {
      clearTimeout(this._streamReconnectTimer);
      this._streamReconnectTimer = null;
    }
    if (!record) return;
    record.closed = true;
    if (record.drainTimer) clearTimeout(record.drainTimer);
    if (record.drainFallbackTimer) clearTimeout(record.drainFallbackTimer);
    if (record.drainRetryTimer) clearTimeout(record.drainRetryTimer);
    if (record.firstFrameProbeTimer) clearTimeout(record.firstFrameProbeTimer);
    let aborted = false;
    try {
      if (record.handle && typeof record.handle.abort === 'function') {
        record.handle.abort();
        aborted = true;
      }
    } catch (error) {
      trace('stream.abort.error', { streamId: record.streamId, ...errorDetails(error) });
    }
    this._api.closeStateStream(record.streamId).catch(() => {});
    trace('stream.closed_local', { streamId: record.streamId, conversationId: record.conversationId, aborted });
  },

  checkStreamLiveness() {
    const record = this._convStream;
    if (!record) return;
    const idleMs = Date.now() - this._lastFrameAt;
    trace('stream.liveness', { streamId: record.streamId, idleMs });
    if (idleMs > STREAM_LIVENESS_TIMEOUT_MS) {
      trace('stream.liveness.expired', { streamId: record.streamId, idleMs });
      this.beginConversationStreamDrain(record, 'liveness_expired');
    }
  },

  beginConversationStreamDrain(record, reason) {
    if (!this._convStream || this._convStream !== record || record.closed || record.draining) return;
    record.draining = true;
    record.drainReason = reason || 'buffered_drain';
    if (record.drainTimer) clearTimeout(record.drainTimer);
    if (record.drainRetryTimer) clearTimeout(record.drainRetryTimer);
    if (record.firstFrameProbeTimer) clearTimeout(record.firstFrameProbeTimer);
    record.drainTimer = null;
    record.drainRetryTimer = null;
    record.firstFrameProbeTimer = null;
    if (this._streamWatchdog) {
      clearInterval(this._streamWatchdog);
      this._streamWatchdog = null;
    }
    trace('stream.buffered.drain', {
      streamId: record.streamId,
      conversationId: record.conversationId,
      reason: record.drainReason
    });
    this.requestConversationStreamDrain(record, 1);
    record.drainFallbackTimer = setTimeout(() => {
      record.drainFallbackTimer = null;
      this.finishBufferedStream(record, 'drain_timeout');
    }, STREAM_BUFFERED_DRAIN_TIMEOUT_MS);
  },

  requestConversationStreamDrain(record, attempt) {
    if (!this._convStream || this._convStream !== record || record.closed || !record.draining) return;
    trace('stream.buffered.drain_request', {
      streamId: record.streamId,
      conversationId: record.conversationId,
      reason: record.drainReason || '',
      attempt
    });
    this._api.closeStateStream(record.streamId).then(() => {
      if (!this._convStream || this._convStream !== record || record.closed) return;
      trace('stream.buffered.drain_accepted', { streamId: record.streamId, attempt });
    }).catch((error) => {
      trace('stream.buffered.drain_error', { streamId: record.streamId, attempt, ...errorDetails(error) });
      if (!this._convStream || this._convStream !== record || record.closed || attempt >= STREAM_DRAIN_MAX_ATTEMPTS) return;
      record.drainRetryTimer = setTimeout(() => {
        record.drainRetryTimer = null;
        this.requestConversationStreamDrain(record, attempt + 1);
      }, STREAM_DRAIN_RETRY_MS);
    });
  },

  reopenConversationStream(record, reason) {
    if (!this._convStream || this._convStream !== record) return;
    const conversationId = record.conversationId;
    trace('stream.reopen', { streamId: record.streamId, conversationId, reason });
    this.closeConversationStream();
    if (this.data.selectedConversationId !== conversationId) return;
    if (!this._streamReconnectTimer) {
      this._streamReconnectTimer = setTimeout(() => {
        this._streamReconnectTimer = null;
        if (this.data.selectedConversationId === conversationId) this.openConversationStream();
      }, STREAM_RECONNECT_DELAY_MS);
    }
  },

  handleBufferedStream(record, info = {}) {
    if (!this._convStream || this._convStream !== record || record.closed) return;
    record.buffered = true;
    if (record.draining) {
      trace('stream.buffered.detected', {
        streamId: record.streamId,
        conversationId: record.conversationId,
        status: info.status || 0,
        delayMs: 0,
        drainReason: record.drainReason || ''
      });
      return;
    }
    if (record.drainTimer) clearTimeout(record.drainTimer);
    const delayMs = this.data.messagesLoaded
      ? STREAM_BUFFERED_REFRESH_MS
      : STREAM_BUFFERED_INITIAL_DRAIN_MS;
    trace('stream.buffered.detected', {
      streamId: record.streamId,
      conversationId: record.conversationId,
      status: info.status || 0,
      delayMs
    });
    record.drainTimer = setTimeout(() => {
      this.beginConversationStreamDrain(record, 'buffered_fetch');
    }, delayMs);
  },

  finishBufferedStream(record, reason) {
    if (!this._convStream || this._convStream !== record || record.closed) return;
    const conversationId = record.conversationId;
    record.closed = true;
    if (record.drainTimer) clearTimeout(record.drainTimer);
    if (record.drainFallbackTimer) clearTimeout(record.drainFallbackTimer);
    if (record.drainRetryTimer) clearTimeout(record.drainRetryTimer);
    if (record.firstFrameProbeTimer) clearTimeout(record.firstFrameProbeTimer);
    record.drainTimer = null;
    record.drainFallbackTimer = null;
    record.drainRetryTimer = null;
    record.firstFrameProbeTimer = null;
    this._convStream = null;
    trace('stream.buffered.drained', {
      streamId: record.streamId,
      conversationId,
      reason,
      messagesLoaded: this.data.messagesLoaded
    });
    if (this.data.selectedConversationId !== conversationId || this._streamReconnectTimer) return;
    this._streamReconnectTimer = setTimeout(() => {
      this._streamReconnectTimer = null;
      if (this.data.selectedConversationId === conversationId) this.openConversationStream();
    }, STREAM_RECONNECT_DELAY_MS);
  },

  handleStreamClosed(record, info = {}) {
    if (record.closed) return;
    trace('stream.transport_closed', {
      streamId: record.streamId,
      conversationId: record.conversationId,
      reason: info.reason || '',
      message: info.message || ''
    });
    if (record.buffered && record.draining) {
      this.finishBufferedStream(record, info.reason || 'buffered_completed');
      return;
    }
    this.reopenConversationStream(record, info.reason || 'transport_closed');
  },

  handleStreamFrame(record, frame) {
    const receivedAt = Date.now();
    if (!this._convStream || this._convStream !== record) {
      trace('stream.frame.dropped', { reason: 'inactive_record', streamId: record.streamId, type: frame && frame.type || '' });
      return;
    }
    if (!frame || !frame.type) {
      trace('stream.frame.dropped', { reason: 'missing_type', streamId: record.streamId });
      return;
    }
    if (frame.host_id && frame.host_id !== record.hostId) {
      trace('stream.frame.dropped', { reason: 'host_mismatch', streamId: record.streamId, type: frame.type });
      return;
    }
    if (frame.plugin_id && frame.plugin_id !== record.pluginId) {
      trace('stream.frame.dropped', { reason: 'plugin_mismatch', streamId: record.streamId, type: frame.type });
      return;
    }
    if (frame.conversation_id && frame.conversation_id !== record.conversationId) {
      trace('stream.frame.dropped', { reason: 'conversation_mismatch', streamId: record.streamId, type: frame.type });
      return;
    }
    if (record.firstFrameProbeTimer) {
      clearTimeout(record.firstFrameProbeTimer);
      record.firstFrameProbeTimer = null;
      trace('stream.first_frame_probe.satisfied', {
        streamId: record.streamId,
        conversationId: record.conversationId,
        type: frame.type,
        elapsedMs: receivedAt - record.openedAt
      });
    }
    if (!record.openedAt) record.openedAt = receivedAt;
    const previousFrameAt = record.lastFrameAt;
    record.frameCount = Number(record.frameCount || 0) + 1;
    record.lastFrameAt = receivedAt;
    if (!record.firstFrameAt) record.firstFrameAt = receivedAt;
    this._lastFrameAt = receivedAt;
    if (frame.type !== 'stream.heartbeat') {
      trace('stream.frame', {
        type: frame.type,
        streamId: record.streamId,
        conversationId: record.conversationId,
        frameIndex: record.frameCount,
        firstFrame: record.frameCount === 1,
        sinceOpenMs: receivedAt - record.openedAt,
        sincePreviousFrameMs: previousFrameAt ? receivedAt - previousFrameAt : 0
      });
    }
    switch (frame.type) {
      case 'conversation.snapshot':
        this.applyDetail(frame.detail || {});
        this.scheduleEmptyConversationSettle(record);
        break;
      case 'conversation.pending':
        this.clearEmptyConversationSettle();
        if (!this.data.messagesLoaded && !this._chatItems.length) {
          this.setData({ messagesLoading: true });
          this.syncLoadingVisuals();
        }
        break;
      case 'conversation.unavailable':
        this.handleConversationUnavailable(frame);
        break;
      case 'conversation.messages.page.begin':
        this.handleMessagePageBegin(frame);
        break;
      case 'conversation.messages.turn':
        this.applyMessageTurn(frame.turn || {});
        break;
      case 'conversation.messages.page.end':
        this.handleMessagePageEnd(frame);
        break;
      case 'conversation.send_failed':
        this.handleSendFailed(frame);
        break;
      case 'conversation.control_failed':
        trace('stream.control_failed', { code: frame.code || '', action: frame.action || '', message: frame.message || '' });
        this.showToast(t('stream.operationFailed', { error: compactDisplayText(frame.message || frame.code || t('stream.retryHint'), 20) }), 6);
        break;
      case 'stream.heartbeat':
        break;
      case 'stream.error':
        trace('stream.error', { code: frame.code || '', message: frame.message || '' });
        this.showToast(readableError({ code: frame.code, message: frame.message }), 6);
        if (frame.retryable !== false && !record.draining) this.reopenConversationStream(record, 'stream_error');
        break;
      case 'stream.close':
        if (record.draining) trace('stream.close.deferred', { streamId: record.streamId, conversationId: record.conversationId });
        else this.reopenConversationStream(record, 'stream_close');
        break;
      default:
        trace('stream.frame.unhandled', { type: frame.type });
        break;
    }
  },

  handleConversationUnavailable(frame) {
    this.clearConversationLoadingFallback();
    this.setData({ messagesLoading: false });
    this.syncLoadingVisuals();
    const now = Date.now();
    trace('conversation.unavailable', { code: frame.code || '', message: frame.message || '' });
    if (now - this._unavailableToastAt < 10000) return;
    this._unavailableToastAt = now;
    this.showToast(readableError({ code: frame.code, message: frame.message }), 6);
  },

  handleMessagePageBegin(frame) {
    this.clearEmptyConversationSettle();
    trace('messages.page.begin', { bodyStreamId: frame.body_stream_id || '', pageId: frame.page_id || '' });
  },

  scheduleEmptyConversationSettle(record) {
    // Only an untouched loading state can settle to empty: once any server or
    // local message exists the normal page/turn flow owns messagesLoaded.
    if (!this.data.messagesLoading || this.data.messagesLoaded) return;
    if (this._serverMessageMap.size || this._chatItems.length) return;
    this.clearEmptyConversationSettle();
    this._emptyConversationSettleTimer = setTimeout(() => {
      this._emptyConversationSettleTimer = null;
      if (!this._convStream || this._convStream !== record || record.closed) return;
      if (!this.data.messagesLoading || this.data.messagesLoaded) return;
      if (this._serverMessageMap.size || this._chatItems.length) return;
      trace('messages.empty_conversation.settled', { conversationId: record.conversationId });
      this.applyMessages([], false);
    }, EMPTY_CONVERSATION_SETTLE_MS);
  },

  clearEmptyConversationSettle() {
    if (!this._emptyConversationSettleTimer) return;
    clearTimeout(this._emptyConversationSettleTimer);
    this._emptyConversationSettleTimer = null;
  },

  applyMessageTurn(turn) {
    const messages = turn.messages || [];
    const record = this._convStream;
    trace('messages.turn.received', {
      turnId: turn.turn_id || '',
      messageCount: messages.length,
      serverMessageCountBefore: this._serverMessageMap.size,
      sinceStreamOpenMs: record ? Date.now() - record.openedAt : -1
    });
    if (!messages.length) return;
    const agentName = this.data.currentAgentName;
    let changed = false;
    for (const message of messages) {
      const normalized = normalizeMessage({
        ...message,
        authorLabel: message.role === 'assistant' ? t('chat.processedMeta', { name: agentName || 'Agent', duration: processingLabel(message) }) : ''
      }, this._serverMessageSeq);
      this._serverMessageSeq += 1;
      this._serverMessageMap.set(normalized.id, normalized);
      changed = true;
    }
    if (changed) this.applyServerMessages();
  },

  applyServerMessages() {
    this.ensureRuntimeState();
    const serverMessages = Array.from(this._serverMessageMap.values()).sort((a, b) => {
      const at = Number(a.created_at || 0);
      const bt = Number(b.created_at || 0);
      if (at !== bt) return at - bt;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    const localPending = this._messages.filter((message) => String(message.id || '').indexOf('pending-') === 0);
    const unresolvedPending = localPending.filter((pending) => !serverMessages.some((message) =>
      message.role === 'user' && message.content === pending.content && Number(message.created_at || 0) >= Number(pending.created_at || 0) - 60000
    ));
    const messages = serverMessages.concat(unresolvedPending);
    this.applyMessages(messages, true);
    if (this.data.atBottom && this.data.surface === 'main') {
      this._api.markRead(this.data.selectedHostId, this.data.selectedPluginId, this.data.selectedConversationId).catch(() => {});
    }
  },

  handleMessagePageEnd(frame) {
    this.clearConversationLoadingFallback();
    this.setData({ messagesLoading: false });
    this.syncLoadingVisuals();
    trace('messages.page.end', {
      bodyStreamId: frame.body_stream_id || '',
      pageId: frame.page_id || '',
      hasError: Boolean(frame.error),
      retryable: Boolean(frame.retryable)
    });
    if (frame.error && frame.retryable === false) {
      this.showToast(t('stream.bodyLoadFailed', { error: compactDisplayText(frame.error.message || frame.error.code || '', 16) }), 6);
    }
    if (!this._serverMessageMap.size && !this._chatItems.length) this.applyMessages([], false);
  },

  handleSendFailed(frame) {
    trace('messages.send_failed', {
      requestId: frame.request_id || '',
      messageId: frame.message_id || '',
      code: frame.code || '',
      message: frame.message || ''
    });
    let failedContent = this.data.failedDraft;
    const failedMessages = this._messages.map((message, index) => {
      if (String(message.id || '').indexOf('pending-') !== 0) return message;
      failedContent = message.content;
      return normalizeMessage({ ...message, status: 'failed' }, index);
    });
    const failedChatItems = buildChatItems(failedMessages);
    const failedChatLayout = buildChatLayoutMetrics(failedChatItems);
    const failedChatAnchors = failedChatLayout.anchors;
    const failedAtBottom = this.data.atBottom;
    const failedFocusIndex = failedAtBottom
      ? Math.max(0, failedChatAnchors.length - 1)
      : retainedChatFocusIndex(
        failedChatAnchors,
        this.data.chatFocusId,
        this._chatFocusItemIndex,
        failedChatLayout.anchorItemIndexes
      );
    const failedLoadedStartIndex = retainedChatLoadedStartIndex(
      this._chatItems,
      failedChatItems,
      this._chatLoadedStartIndex
    );
    const failedLoadedProgressIndex = chatLoadedProgressAnchorIndex(
      failedChatLayout.anchorItemIndexes,
      failedLoadedStartIndex
    );
    this._messages = failedMessages;
    this._chatItems = failedChatItems;
    this._chatAnchors = failedChatAnchors;
    this._chatAnchorItemIndexes = failedChatLayout.anchorItemIndexes;
    this._chatItemHeights = failedChatLayout.itemHeights;
    this._chatItemOffsets = failedChatLayout.itemOffsets;
    this._chatContentHeight = failedChatLayout.contentHeight;
    this._chatLayoutItems = failedChatItems;
    this._chatLoadedStartIndex = failedLoadedStartIndex;
    this._chatFocusItemIndex = failedChatLayout.anchorItemIndexes[failedFocusIndex] || 0;
    this.setData({
      visibleChatItems: failedChatItems.slice(failedLoadedStartIndex),
      chatTopSpacerStyle: chatTopSpacerStyle(failedChatItems, failedLoadedStartIndex, failedChatLayout.itemOffsets),
      chatProgressSegments: buildChatProgressSegments(failedChatAnchors, failedFocusIndex, failedLoadedProgressIndex),
      chatFocusIndex: failedFocusIndex,
      chatFocusId: failedChatAnchors[failedFocusIndex] || '',
      chatScrollIntoView: failedAtBottom ? this.nextChatBottomAnchorId() : this.data.chatScrollIntoView,
      atBottom: failedAtBottom,
      failedDraft: failedContent || this.data.failedDraft,
      isRunning: false
    });
    this.rebuildMenu();
    this.showToast(compactDisplayText(frame.message || t('stream.sendRetry'), 22), 7);
  },

  applyDetail(detail) {
    const startedAt = Date.now();
    const wasConnected = this.data.connected;
    const previousRunError = this.data.lastRunError;
    const run = detail.run || {};
    const rawApproval = detail.approval || {};
    const approvalId = rawApproval.approval_request_id || rawApproval.id || run.approval_request_id || '';
    const approval = approvalId ? { ...rawApproval, approval_request_id: approvalId } : null;
    const approvalActions = approvalActionsFrom(approval);
    const metadata = detail.metadata || {};
    const interactiveControls = detail.interactive_controls || detail.interactiveControls || [];
    const interactiveModel = interactiveControlValue(interactiveControls, 'codex.intelligence');
    const interactivePermission = interactiveControlValue(interactiveControls, 'codex.permission');
    const currentModel = displayOption(interactiveModel, detail.current_model || detail.currentModel || (metadata.model ? { id: metadata.model, label: metadata.model } : null));
    const currentReasoning = detail.current_reasoning || (metadata.reasoning_effort ? { id: metadata.reasoning_effort, label: metadata.reasoning_effort } : null);
    const permissionFallback = metadata.sandbox_policy || metadata.approval_mode || '';
    const currentPermission = displayOption(interactivePermission, detail.current_permission || detail.currentPermission || (permissionFallback ? { id: permissionFallback, label: permissionFallback } : null));
    const phaseText = run.status === 'running'
      ? run.phase && (run.phase.label || run.phase.detail) || run.preview || ''
      : '';
    const planVisible = Boolean(phaseText);
    const menuVisible = isMenuSurface(this.data.surface);
    const detailOptions = {
      modelOptions: detail.model_options || [],
      reasoningOptions: detail.reasoning_options || [],
      permissionOptions: detail.permission_options || [],
      detailActions: detail.actions || []
    };
    const detailOptionsSignature = valueSignature(detailOptions);
    if (detailOptionsSignature !== this._detailOptionsSignature) {
      this._detailOptionsSignature = detailOptionsSignature;
      this._modelOptions = detailOptions.modelOptions;
      this._reasoningOptions = detailOptions.reasoningOptions;
      this._permissionOptions = detailOptions.permissionOptions;
      this._detailActions = detailOptions.detailActions;
    }
    const approvalSignature = valueSignature(approval);
    const approvalChanged = approvalSignature !== this._approvalSignature;
    if (approvalChanged) {
      this._approvalSignature = approvalSignature;
      this._approval = approval;
    }
    const patch = changedPatch(this.data, {
      connected: detail.connected !== false,
      threadTitle: detail.title || this.data.threadTitle,
      threadTitleDisplay: compactDisplayText(detail.title || this.data.threadTitle, 30),
      cwd: detail.cwd || '',
      modelLabel: compactModelLabel(currentModel),
      reasoningLabel: compactReasoningLabel(currentReasoning),
      permissionLabel: compactPermissionLabel(currentPermission, metadata.approval_mode),
      currentModelId: optionIdentity(currentModel),
      currentReasoningId: optionIdentity(currentReasoning),
      currentPermissionId: optionIdentity(currentPermission),
      contextLabel: compactContextLabel(detail, run),
      contextVisible: Boolean(compactContextLabel(detail, run)),
      isRunning: run.status === 'running',
      runSummary: run.summary || phaseText || '',
      taskId: run.task_id || '',
      lastRunError: run.error || '',
      planVisible,
      planText: phaseText,
      chatClass: chatLayoutClass(
        planVisible,
        isListSurface(this.data.surface),
        menuVisible
      )
    });
    if (approvalChanged) {
      patch.approvalActions = decorate(approvalActions, this.data.surface === 'approval' ? this.data.focusIndex : -1, 'prism-menu-button');
      patch.approvalText = approval && (approval.description || approval.summary || approval.message) || t('approval.requestDefault');
    }
    if (Object.keys(patch).length) this.setData(patch);
    this.rebuildMenu();
    // A pending approval is time-critical: entering a conversation that waits
    // on one, or receiving one mid-conversation, pops the panel right away
    // instead of requiring the menu round trip. The signature guard makes each
    // request pop at most once, so dismissing the panel keeps it dismissed
    // until a different request arrives.
    if (approvalChanged && approval && approvalActions.length) this.presentApprovalPanel();
    if (run.error && run.error !== previousRunError) this.showToast(t('chat.replyFailed'), 7);
    if (!wasConnected && this._everConnected) this.showToast(t('chat.reconnected'), 5);
    this._everConnected = true;
    trace('detail.apply.complete', {
      conversationId: this.data.selectedConversationId,
      durationMs: Date.now() - startedAt,
      sinceStreamOpenMs: this._convStream ? Date.now() - this._convStream.openedAt : -1,
      runStatus: run.status || '',
      hasApproval: Boolean(approval),
      approvalActionCount: approvalActions.length,
      modelOptionCount: (detail.model_options || []).length,
      reasoningOptionCount: (detail.reasoning_options || []).length,
      permissionOptionCount: (detail.permission_options || []).length,
      actionCount: (detail.actions || []).length
    });
  },

  applyMessages(messages, keepScrollFocus) {
    this.clearConversationLoadingFallback();
    this.ensureRuntimeState();
    const scrollEntity = this.data.surface === 'main' && this._chatItems.length
      ? this.getChatScrollEntity() : null;
    if (scrollEntity && !this._chatScrollRequest) {
      this.data.atBottom = scrollEntity.scrollHeight - scrollEntity.clientHeight - scrollEntity.scrollTop <= 2;
    }
    const startedAt = Date.now();
    const performanceStartedAt = performanceTimestamp();
    const previousMessageCount = this._messages.length;
    const previousVisibleItemCount = (this.data.visibleChatItems || []).length;
    const lastMessage = messages[messages.length - 1];
    // A fresh conversation entry has no mounted chat yet; anchor its focus at
    // the top of the loaded range so the first visible section is the oldest
    // loaded message instead of jumping to the newest. Loaded history is not
    // "unread", so the counter also starts at zero.
    const initialChatLayout = !this._chatItems.length;
    const unreadCount = initialChatLayout || this.data.atBottom
      ? 0
      : Math.max(1, messages.length - this._messages.length);
    const chatItems = buildChatItems(messages);
    const chatLayout = buildChatLayoutMetrics(chatItems);
    const chatAnchors = chatLayout.anchors;
    const chatAnchorItemIndexes = chatLayout.anchorItemIndexes;
    const followBottom = this.data.atBottom || !keepScrollFocus;
    const atBottom = followBottom;
    // Native pixel scrolling must not enter estimated spacer-only history.
    // Keep the received range mounted so Markdown determines its real height.
    const chatLoadedStartIndex = this.getChatScrollEntity() ? 0 : retainedChatLoadedStartIndex(
      this._chatItems,
      chatItems,
      this._chatLoadedStartIndex
    );
    const loadedProgressIndex = chatLoadedProgressAnchorIndex(chatAnchorItemIndexes, chatLoadedStartIndex);
    const chatFocusIndex = followBottom
      ? Math.max(0, chatAnchors.length - 1)
      : initialChatLayout
        ? loadedProgressIndex
        : retainedChatFocusIndex(chatAnchors, this.data.chatFocusId, this._chatFocusItemIndex, chatAnchorItemIndexes);
    const chatFocusId = chatAnchors[chatFocusIndex] || '';
    scrollTrace('continuous.built', {
      conversationId: this.data.selectedConversationId,
      messageCount: messages.length,
      itemCount: chatItems.length,
      anchorCount: chatAnchors.length,
      followBottom,
      atBottom,
      initialChatLayout,
      progressSectionCount: chatAnchors.length,
      loadedStartIndex: chatLoadedStartIndex,
      loadedItemCount: Math.max(0, chatItems.length - chatLoadedStartIndex),
      previousFocusIndex: this.data.chatFocusIndex,
      previousFocusId: this.data.chatFocusId,
      nextFocusIndex: chatFocusIndex,
      nextFocusId: chatFocusId,
      anchors: chatAnchors.join('|')
    });
    this._messages = messages;
    this._chatItems = chatItems;
    this._chatAnchors = chatAnchors;
    this._chatAnchorItemIndexes = chatAnchorItemIndexes;
    this._chatItemHeights = chatLayout.itemHeights;
    this._chatItemOffsets = chatLayout.itemOffsets;
    this._chatContentHeight = chatLayout.contentHeight;
    this._chatLayoutItems = chatItems;
    this._chatLoadedStartIndex = chatLoadedStartIndex;
    this._chatFocusItemIndex = chatAnchorItemIndexes[chatFocusIndex] || 0;
    const setDataStartedAt = performanceTimestamp();
    this.setData({
      visibleChatItems: chatItems.slice(chatLoadedStartIndex),
      chatTopSpacerStyle: chatTopSpacerStyle(chatItems, chatLoadedStartIndex, chatLayout.itemOffsets),
      chatProgressSegments: buildChatProgressSegments(chatAnchors, chatFocusIndex, loadedProgressIndex),
      messagesLoaded: true,
      messagesLoading: false,
      lastMessageId: lastMessage ? lastMessage.anchorId : 'message-welcome',
      chatFocusIndex,
      chatFocusId,
      chatScrollIntoView: followBottom
        ? this.nextChatBottomAnchorId()
        : initialChatLayout ? chatFocusId : this.data.chatScrollIntoView,
      chatScrollRevision: Number(this.data.chatScrollRevision || 0) + 1,
      atBottom,
      unreadCount: atBottom ? 0 : unreadCount
    });
    const completedAt = performanceTimestamp();
    const totalPerformanceMs = completedAt - performanceStartedAt;
    if (messages.length !== previousMessageCount
      || Math.max(0, chatItems.length - chatLoadedStartIndex) !== previousVisibleItemCount
      || totalPerformanceMs >= 4) {
      performanceTrace('messages.commit', {
        messageCount: messages.length,
        previousMessageCount,
        chatItemCount: chatItems.length,
        visibleChatItemCount: Math.max(0, chatItems.length - chatLoadedStartIndex),
        previousVisibleItemCount,
        loadedStartIndex: chatLoadedStartIndex,
        followBottom,
        chatFocusId,
        setDataMs: Number((completedAt - setDataStartedAt).toFixed(3)),
        totalMs: Number(totalPerformanceMs.toFixed(3))
      });
    }
    this.syncLoadingVisuals();
    trace('messages.apply.complete', {
      serverCount: messages.length,
      unreadCount,
      focusIndex: chatFocusIndex,
      focusId: chatFocusId,
      anchorCount: chatAnchors.length,
      durationMs: Date.now() - startedAt,
      sinceStreamOpenMs: this._convStream ? Date.now() - this._convStream.openedAt : -1
    });
  },
  };
}
