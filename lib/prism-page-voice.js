// Voice input and draft methods: recognition session setup/scheduling,
// draft commit/undo/redo history, message sending with its optimistic chat
// layout, and run interruption.

import { trace, errorDetails } from './prism-trace.js';
import { normalizeMessage, buildChatItems, buildChatLayoutMetrics, chatTailStartIndex, CHAT_INITIAL_LOAD_HEIGHT, chatLoadedProgressAnchorIndex, retainedChatLoadedStartIndex, buildChatProgressSegments, chatTopSpacerStyle } from './prism-chat-model.js';
import { compactDisplayText } from './prism-labels.js';
import { chatLayoutClass, MENU_CLASS_VISIBLE, MENU_CLASS_HIDDEN } from './prism-surfaces.js';
import { t } from './prism-i18n.js';

const NEW_CONVERSATION_DISCOVER_TRIES = 5;
const NEW_CONVERSATION_DISCOVER_INTERVAL_MS = 1800;

export function createVoiceMethods({ wx, createVoiceInput, readableError }) {
  return {

  setupRecognition() {
    trace('voice.setup.start');
    try {
      const recognition = createVoiceInput({
        wx,
        SpeechRecognitionSession: typeof SpeechRecognitionSession === 'undefined' ? null : SpeechRecognitionSession
      });
      recognition.onstart = () => {
        if (this._pageActive === false || this.data.surface !== 'voice') return;
        trace('voice.recognition.start');
        this._recognitionFailed = false;
        this._recognitionActive = true;
        this.setData({ listening: true, recognizing: false, voiceHint: t('voice.listeningHint') });
      };
      recognition.onresult = (event) => {
        if (this._pageActive === false || this.data.surface !== 'voice') return;
        let transcript = '';
        const results = event && event.results ? event.results : [];
        for (let index = 0; index < results.length; index += 1) {
          const alternative = results[index] && results[index][0];
          if (alternative && alternative.transcript) transcript += alternative.transcript;
        }
        if (transcript) {
          this._lastSessionTranscript = transcript;
          trace('voice.recognition.result', { resultCount: results.length, transcriptLength: transcript.length });
          const base = this._voiceBaseDraft || '';
          this.setData({ draftText: base + transcript, voiceHint: this.data.recognizing ? t('voice.recognizingHint') : t('voice.listeningHint') });
        }
      };
      recognition.onerror = (event) => {
        if (this._pageActive === false) return;
        trace('voice.recognition.error', { error: event && (event.error || event.message) || 'unknown' });
        this._recognitionFailed = true;
        this._recognitionActive = false;
        const base = this._voiceBaseDraft || '';
        this.setData({ listening: false, recognizing: false, draftText: base });
        // When the user already navigated away on purpose (closing the menu,
        // going back), the recognition end must not hijack the navigation.
        if (this.data.surface !== 'voice') return;
        this.setData({ surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE });
        this.rebuildMenu(true);
        this.showToast(event.message || t('voice.inputFailed'), 5);
      };
      recognition.onend = () => {
        if (this._pageActive === false) return;
        const base = this._voiceBaseDraft || '';
        const currentText = String(this.data.draftText || '');
        const newTranscript = this._lastSessionTranscript || '';
        const hasText = Boolean(currentText.trim());
        const hasNewText = Boolean(newTranscript.trim());
        const recognitionFailed = this._recognitionFailed;
        trace('voice.recognition.end', { hasText, hasNewText, recognitionFailed, draftLength: currentText.length });
        this._recognitionFailed = false;
        this._recognitionActive = false;
        this.setData({ listening: false, recognizing: false, voiceHint: '' });

        if (hasNewText) {
          this.commitDraft(base, currentText);
        }

        // Same guard as onerror: a recognition that ends because the user
        // closed the menu or went back must not pull them into the menu.
        if (this.data.surface !== 'voice') return;
        this.setData({ surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE });
        this.rebuildMenu(true);
        if (!hasNewText && !recognitionFailed) this.showToast(t('voice.notHeard'), 5);
      };
      this._recognition = recognition;
      trace('voice.setup.complete', { supported: true });
    } catch (error) {
      this._recognition = null;
      trace('voice.setup.complete', { supported: false, ...errorDetails(error) });
    }
  },

  cancelPendingRecognitionStart(reason) {
    if (!this._recognitionStartTimer) return false;
    clearTimeout(this._recognitionStartTimer);
    this._recognitionStartTimer = null;
    trace('voice.input.start.cancelled', { reason: reason || 'cancelled' });
    return true;
  },

  scheduleRecognitionStart(context) {
    this.cancelPendingRecognitionStart('reschedule');
    // Invoke microphone acquisition in the activating input event, without a timer.
    const begin = () => {
      this._recognitionStartTimer = null;
      if (this.data.surface !== 'voice' || !this.data.listening || !this._recognition) {
        trace('voice.input.start.skipped', {
          surface: this.data.surface,
          listening: this.data.listening,
          supported: Boolean(this._recognition)
        });
        return;
      }
      try {
        this._recognition.start();
        this._recognitionActive = true;
        trace('voice.input.start.dispatched', { context });
      } catch (error) {
        this._recognitionActive = false;
        trace('voice.input.start.error', errorDetails(error));
        this.setData({ listening: false, surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE });
        this.rebuildMenu();
        this.showToast(t('voice.cannotStart'), 5);
      }
    };
    begin();
  },

  commitDraft(previousText, newText) {
    if (!this._draftHistory) this._draftHistory = [];
    if (!this._draftFuture) this._draftFuture = [];
    if (newText === previousText) return;

    const added = newText.slice(previousText.length);
    const sentenceParts = added.split(/(?<=[。！？\n])/).filter(Boolean);
    if (sentenceParts.length > 1) {
      let accumulated = previousText;
      for (let i = 0; i < sentenceParts.length - 1; i += 1) {
        this._draftHistory.push(accumulated);
        accumulated += sentenceParts[i];
      }
      this._draftHistory.push(accumulated);
    } else {
      this._draftHistory.push(previousText);
    }
    this._draftFuture = [];
    this._voiceBaseDraft = newText;
    this.setData({ restoredDraft: '' });
  },

  startVoiceInput(options = {}) {
    if (this.data.listening || this.data.recognizing) return;
    trace('voice.input.start.request', { supported: Boolean(this._recognition), draftLength: String(this.data.draftText || '').length });
    if (!this._recognition) {
      this.showToast(t('voice.unsupported'), 5);
      return;
    }
    // Switching from the “语音输入” action to the stop affordance can make
    // the action's own release land on the newly focused stop item. Consume
    // exactly that trailing activation; a later deliberate activation stops.
    this._ignoreNextVoiceStop = Boolean(options.ignoreInitialStop);
    this.cancelPendingRecognitionStart('restart');
    this._voiceBaseDraft = String(this.data.draftText || '');
    this._lastSessionTranscript = '';
    // Recording keeps the menu open with the ⏹ 停止 affordance: a single tap
    // (touchpad or the focused button) stops the recording.
    this.setData({
      surface: 'voice',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      chatClass: chatLayoutClass(this.data.planVisible, false, true),
      draftText: this._voiceBaseDraft,
      listening: true,
      recognizing: false,
      voiceHint: t('voice.listeningHint')
    });
    this.rebuildMenu(true);
    // Long-press detection runs in a timer. Acquire the microphone from the
    // actual release event instead, as required by the media capture API.
    if (!options.fromVoiceWakeup && this._gesture && this._gesture.phase === 'pressing') {
      trace('voice.input.start.deferred', { reason: 'pressing' });
      return;
    }
    trace('voice.input.start.scheduled', { delayMs: 0 });
    this.scheduleRecognitionStart('voice_input_start');
  },

  stopVoiceInput() {
    if (!this._recognition || !this.data.listening || this.data.recognizing) {
      trace('voice.input.stop.skipped', { supported: Boolean(this._recognition), listening: this.data.listening });
      return;
    }
    if (this.cancelPendingRecognitionStart('stopped_before_start')) {
      this.setData({ listening: false, recognizing: false, surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE, voiceHint: '' });
      this.rebuildMenu(true);
      return;
    }
    if (!this._recognitionActive) {
      // The recognition never actually started (its press settled without a
      // dispatched start). Resolve the stop directly instead of waiting for
      // an end event that will never arrive.
      trace('voice.input.stop.unstarted', {});
      this.setData({ listening: false, recognizing: false, voiceHint: '', surface: 'menu', menuVisible: true, menuClass: MENU_CLASS_VISIBLE });
      this.rebuildMenu(true);
      return;
    }
    trace('voice.input.stop.request', { draftLength: String(this.data.draftText || '').length });
    this.setData({ recognizing: true, voiceHint: t('voice.recognizingHint') });
    this._recognition.stop();
  },

  cancelVoiceInput() {
    trace('voice.input.cancel', { draftLength: String(this.data.draftText || '').length });
    const recognitionStartCancelled = this.cancelPendingRecognitionStart('voice_cancelled');
    if (!recognitionStartCancelled && this._recognition) this._recognition.abort();
    this._draftHistory = [];
    this._draftFuture = [];
    this._voiceBaseDraft = '';
    this._lastSessionTranscript = '';
    this.setData({ listening: false, recognizing: false, draftText: '', surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN, voiceHint: '' });
    this.rebuildMenu();
  },

  undoDraft() {
    if (!this.data.draftText && (!this._draftHistory || !this._draftHistory.length)) {
      trace('draft.undo.skipped');
      return;
    }
    if (!this._draftHistory) this._draftHistory = [];
    if (!this._draftFuture) this._draftFuture = [];

    const current = String(this.data.draftText || '');
    let previous = '';
    if (this._draftHistory.length > 0) {
      previous = this._draftHistory.pop();
    } else {
      previous = '';
    }

    this._draftFuture.push(current);
    this._voiceBaseDraft = previous;
    const nextRedoText = this._draftFuture[this._draftFuture.length - 1] || '';

    trace('draft.undo', { fromLength: current.length, toLength: previous.length, historyLeft: this._draftHistory.length });
    this.setData({
      draftText: previous,
      restoredDraft: nextRedoText
    });
    this.showToast(t('voice.undone'), 4);
    this.rebuildMenu();
  },

  redoDraft() {
    if (!this._draftFuture || !this._draftFuture.length) {
      if (this.data.restoredDraft) {
        const text = this.data.restoredDraft;
        if (!this._draftHistory) this._draftHistory = [];
        this._draftHistory.push(String(this.data.draftText || ''));
        this._voiceBaseDraft = text;
        this.setData({ draftText: text, restoredDraft: '' });
        this.showToast(t('voice.restored'), 4);
        this.rebuildMenu();
      } else {
        trace('draft.redo.skipped');
      }
      return;
    }

    if (!this._draftHistory) this._draftHistory = [];
    const current = String(this.data.draftText || '');
    const next = this._draftFuture.pop();

    this._draftHistory.push(current);
    this._voiceBaseDraft = next;
    const nextRedoText = this._draftFuture[this._draftFuture.length - 1] || '';

    trace('draft.redo', { fromLength: current.length, toLength: next.length, futureLeft: this._draftFuture.length });
    this.setData({
      draftText: next,
      restoredDraft: nextRedoText
    });
    this.showToast(t('voice.restored'), 4);
    this.rebuildMenu();
  },

  async sendDraft() {
    this.ensureRuntimeState();
    const text = String(this.data.draftText || this.data.failedDraft || '').trim();
    if (!text || !this._api || !this.data.selectedHostId || !this.data.selectedPluginId || !this.data.connected) {
      trace('message.send.skipped', {
        hasText: Boolean(text),
        textLength: text.length,
        hasApi: Boolean(this._api),
        selectedHostId: this.data.selectedHostId,
        selectedPluginId: this.data.selectedPluginId,
        connected: this.data.connected
      });
      this.showToast(this.data.connected ? t('voice.nothingToSend') : t('voice.agentUnavailable'), 5);
      return;
    }
    const startedAt = Date.now();
    const hostId = this.data.selectedHostId;
    const pluginId = this.data.selectedPluginId;
    const conversationId = this.data.selectedConversationId;
    trace('message.send.start', {
      hostId,
      pluginId,
      conversationId,
      textLength: text.length,
      mode: conversationId ? 'existing_conversation' : 'draft_start'
    });
    const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const failedIndex = this._messages.findIndex((message) => message.status === 'failed' && message.content === text);
    const optimistic = failedIndex >= 0
      ? normalizeMessage({ ...this._messages[failedIndex], status: 'sending' }, failedIndex)
      : normalizeMessage({ id: `pending-${Date.now()}`, role: 'user', content: text, status: 'sending', created_at: Date.now() }, this._messages.length);
    const optimisticMessages = failedIndex >= 0
      ? this._messages.map((message, index) => index === failedIndex ? optimistic : message)
      : [...this._messages, optimistic];
    const optimisticChatItems = buildChatItems(optimisticMessages);
    const optimisticLayout = buildChatLayoutMetrics(optimisticChatItems);
    const optimisticAnchors = optimisticLayout.anchors;
    const optimisticFocusIndex = Math.max(0, optimisticAnchors.length - 1);
    const optimisticLoadedStartIndex = chatTailStartIndex(
      optimisticChatItems,
      CHAT_INITIAL_LOAD_HEIGHT,
      optimisticLayout.itemHeights
    );
    const optimisticLoadedProgressIndex = chatLoadedProgressAnchorIndex(
      optimisticLayout.anchorItemIndexes,
      optimisticLoadedStartIndex
    );
    const knownConversationIds = new Set(this._conversations.map((item) => item.conversation_id));
    this._messages = optimisticMessages;
    this._chatItems = optimisticChatItems;
    this._chatAnchors = optimisticAnchors;
    this._chatAnchorItemIndexes = optimisticLayout.anchorItemIndexes;
    this._chatItemHeights = optimisticLayout.itemHeights;
    this._chatItemOffsets = optimisticLayout.itemOffsets;
    this._chatContentHeight = optimisticLayout.contentHeight;
    this._chatLayoutItems = optimisticChatItems;
    this._chatLoadedStartIndex = optimisticLoadedStartIndex;
    this._chatFocusItemIndex = optimisticLayout.anchorItemIndexes[optimisticFocusIndex] || 0;
    this._draftHistory = [];
    this._draftFuture = [];
    this._voiceBaseDraft = '';
    this._lastSessionTranscript = '';
    this.setData({
      visibleChatItems: optimisticChatItems.slice(optimisticLoadedStartIndex),
      chatTopSpacerStyle: chatTopSpacerStyle(
        optimisticChatItems,
        optimisticLoadedStartIndex,
        optimisticLayout.itemOffsets
      ),
      chatProgressSegments: buildChatProgressSegments(optimisticAnchors, optimisticFocusIndex, optimisticLoadedProgressIndex),
      lastMessageId: optimistic.anchorId,
      draftText: '',
      failedDraft: '',
      restoredDraft: '',
      surface: 'main',
      menuVisible: false,
      menuClass: MENU_CLASS_HIDDEN,
      isRunning: true,
      runSummary: t('chat.agentReplying'),
      unreadCount: 0,
      atBottom: true,
      chatFocusIndex: optimisticFocusIndex,
      chatFocusId: optimisticAnchors[optimisticFocusIndex] || '',
      chatScrollIntoView: this.nextChatBottomAnchorId()
    });
    this.rebuildMenu();
    try {
      if (conversationId) {
        await this._api.sendMessage(hostId, pluginId, conversationId, {
          message_id: messageId,
          content: text,
          cwd: this.data.cwd || ''
        });
      } else {
        const draft = await this._api.openDraft(hostId, pluginId, { cwd: this.data.cwd || '' });
        const draftId = draft.draft_id || draft.draftId || '';
        if (!draftId) throw new Error('DRAFT_ID_MISSING');
        await this._api.startDraft(hostId, pluginId, draftId, {
          message_id: messageId,
          content: text,
          cwd: this.data.cwd || ''
        });
        this.discoverNewConversation(knownConversationIds, 0);
      }
      trace('message.send.success', { durationMs: Date.now() - startedAt });
      this.showToast(t('voice.sent'), 4);
    } catch (error) {
      const failedMessages = this._messages.map((message, index) => message.id === optimistic.id
        ? normalizeMessage({ ...message, status: 'failed' }, index)
        : message);
      const failedChatItems = buildChatItems(failedMessages);
      const failedChatLayout = buildChatLayoutMetrics(failedChatItems);
      const failedChatAnchors = failedChatLayout.anchors;
      const failedFocusIndex = Math.max(0, failedChatAnchors.length - 1);
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
        chatTopSpacerStyle: chatTopSpacerStyle(
          failedChatItems,
          failedLoadedStartIndex,
          failedChatLayout.itemOffsets
        ),
        chatProgressSegments: buildChatProgressSegments(failedChatAnchors, failedFocusIndex, failedLoadedProgressIndex),
        chatFocusIndex: failedFocusIndex,
        chatFocusId: failedChatAnchors[failedFocusIndex] || '',
        chatScrollIntoView: this.nextChatBottomAnchorId(),
        atBottom: true,
        failedDraft: text,
        isRunning: false,
        surface: 'menu',
        menuVisible: true,
        menuClass: MENU_CLASS_VISIBLE,
        focusIndex: 0
      });
      this.rebuildMenu();
      trace('message.send.error', { durationMs: Date.now() - startedAt, ...errorDetails(error) });
      this.showToast(t('voice.sendFailed', { error: compactDisplayText(readableError(error), 14) }), 7);
    }
  },

  async discoverNewConversation(knownConversationIds, attempt) {
    if (!this._api || !this.data.selectedHostId || !this.data.selectedPluginId) return;
    if (this.data.selectedConversationId) return;
    try {
      const response = await this._api.getConversationIndex(this.data.selectedHostId, this.data.selectedPluginId);
      const conversations = this.applyConversations(response);
      const fresh = conversations.find((item) => !knownConversationIds.has(item.conversation_id));
      if (fresh) {
        trace('conversation.discover.found', { conversationId: fresh.conversation_id, attempt });
        await this.selectConversationById(fresh.conversation_id, { keepPendingMessages: true });
        return;
      }
      trace('conversation.discover.pending', { attempt, conversationCount: conversations.length });
    } catch (error) {
      trace('conversation.discover.error', { attempt, ...errorDetails(error) });
    }
    if (attempt + 1 < NEW_CONVERSATION_DISCOVER_TRIES) {
      setTimeout(() => this.discoverNewConversation(knownConversationIds, attempt + 1), NEW_CONVERSATION_DISCOVER_INTERVAL_MS);
    }
  },

  async interruptRun() {
    if (!this._api || !this.data.selectedConversationId) {
      trace('run.interrupt.skipped', { hasApi: Boolean(this._api), selectedConversationId: this.data.selectedConversationId });
      return;
    }
    const startedAt = Date.now();
    trace('run.interrupt.start', { conversationId: this.data.selectedConversationId, taskId: this.data.taskId });
    try {
      await this._api.interrupt(this.data.selectedHostId, this.data.selectedPluginId, this.data.selectedConversationId, this.data.taskId);
      this.setData({ surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN });
      this.showToast(t('voice.stopSent'), 5);
      trace('run.interrupt.success', { durationMs: Date.now() - startedAt });
    } catch (error) {
      trace('run.interrupt.error', { durationMs: Date.now() - startedAt, ...errorDetails(error) });
      this.showToast(t('voice.stopFailed', { error: compactDisplayText(readableError(error), 12) }), 7);
    }
  },
  };
}
