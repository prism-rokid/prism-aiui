// Key, touchpad, and scroll methods: arrow paging over the virtualized chat,
// the touchpad press state machine, tap dispatch, and the page-level event
// entry points (onKeyDown/onKeyUp/onVoiceWakeup).

import { trace, inputTrace, scrollTrace, performanceTimestamp, performanceTrace, INPUT_DIAGNOSTICS_ENABLED } from './prism-trace.js';
import { buildChatProgressSegments, chatLoadedProgressAnchorIndex, chatTopSpacerStyle, earlierChatStartIndex, CHAT_LOAD_AHEAD_ANCHORS, CHAT_LOAD_CHUNK_HEIGHT, CHAT_BOTTOM_ANCHOR_IDS } from './prism-chat-model.js';
import { createTouchpadGestureState, isConfirmKey, LONG_PRESS_MENU_MS, STALE_PRESS_MS, TOUCHPAD_DUPLICATE_WINDOW_MS, ARROW_KEYUP_FALLBACK_WINDOW_MS } from './prism-gesture.js';

export const inputMethods = {

  scheduleInputPerformanceProbes(kind, snapshot = {}) {
    if (!INPUT_DIAGNOSTICS_ENABLED) return;
    const probeId = Number(this._performanceProbeSequence || 0) + 1;
    this._performanceProbeSequence = probeId;
    for (const delayMs of [0, 160]) {
      const scheduledAt = performanceTimestamp();
      setTimeout(() => {
        const firedAt = performanceTimestamp();
        performanceTrace('input.probe', {
          probeId,
          kind,
          delayMs,
          timerLagMs: Number(Math.max(0, firedAt - scheduledAt - delayMs).toFixed(3)),
          surface: this.data.surface,
          focusIndex: this.data.focusIndex,
          chatScrollIntoView: this.data.chatScrollIntoView,
          inboxScrollTop: this.data.inboxScrollTop,
          chatScrollRevision: this.data.chatScrollRevision,
          visibleChatItemCount: (this.data.visibleChatItems || []).length,
          ...snapshot
        });
      }, delayMs);
    }
  },

  nextChatBottomAnchorId() {
    const phase = Number(this._chatBottomAnchorPhase) || 0;
    this._chatBottomAnchorPhase = phase ^ 1;
    return CHAT_BOTTOM_ANCHOR_IDS[phase];
  },

  getChatScrollEntity() {
    if (typeof this.querySelector !== 'function') return null;
    const entity = this.querySelector('.prism-main-chatbox');
    return entity && typeof entity.scrollTo === 'function'
      && Number.isFinite(entity.clientHeight) && entity.clientHeight > 0
      && Number.isFinite(entity.scrollHeight) && Number.isFinite(entity.scrollTop)
      ? entity : null;
  },

  scrollChatViewport(direction) {
    const entity = this.getChatScrollEntity();
    if (!entity || this._chatLoadedStartIndex > 0) return false;
    const conversationId = this.data.selectedConversationId;
    const pending = this._chatScrollRequest;
    const base = pending && pending.conversationId === conversationId
      ? pending.top : entity.scrollTop;
    const maximum = Math.max(0, entity.scrollHeight - entity.clientHeight);
    const top = Math.max(0, Math.min(maximum, base + direction * entity.clientHeight * 0.8));
    const request = { top, conversationId };
    this._chatScrollRequest = request;
    // Disable anchor commands while the native animation owns the viewport.
    // Do not follow incoming messages until the animation actually reaches bottom.
    this.setData({ chatScrollIntoView: '', atBottom: false });
    const settle = () => {
      if (this._chatScrollRequest !== request) return;
      this._chatScrollRequest = null;
      if (this._pageActive === false || this.data.surface !== 'main'
        || this.data.selectedConversationId !== conversationId) return;
      const current = this.getChatScrollEntity();
      if (!current || current.entityId !== entity.entityId) return;
      const range = Math.max(0, current.scrollHeight - current.clientHeight);
      const atBottom = range - current.scrollTop <= 2;
      const anchors = this._chatAnchors || [];
      const focusIndex = Math.min(Math.max(0, anchors.length - 1),
        Math.round((range ? current.scrollTop / range : 1) * Math.max(0, anchors.length - 1)));
      this.setData({
        atBottom,
        unreadCount: atBottom ? 0 : this.data.unreadCount,
        chatFocusIndex: focusIndex,
        chatFocusId: anchors[focusIndex] || '',
        chatProgressSegments: buildChatProgressSegments(anchors, focusIndex, 0)
      });
    };
    try {
      // Interrupted animations also settle from measured position, never the target.
      Promise.resolve(entity.scrollTo({ top, behavior: 'smooth' })).then(settle, settle);
    } catch (error) {
      this._chatScrollRequest = null;
      return false;
    }
    return true;
  },

  markScrolling(direction, event) {
    const performanceStartedAt = performanceTimestamp();
    this.ensureRuntimeState();
    if (this.scrollChatViewport(direction)) return;
    const anchors = this._chatAnchors || [];
    const anchorItemIndexes = Array.isArray(this._chatAnchorItemIndexes) ? this._chatAnchorItemIndexes : [];
    const chatItems = this._chatItems || [];
    const chatItemHeights = Array.isArray(this._chatItemHeights) ? this._chatItemHeights : null;
    const maximumFocusIndex = Math.max(0, anchors.length - 1);
    const wasAtBottom = Boolean(this.data.atBottom);
    const previousFocusIndex = Math.max(0, Math.min(maximumFocusIndex, Number(this.data.chatFocusIndex) || 0));
    let focusIndex = previousFocusIndex;
    let atBottom = wasAtBottom;
    if (direction < 0) {
      atBottom = false;
      focusIndex = wasAtBottom ? maximumFocusIndex : Math.max(0, previousFocusIndex - 1);
    } else if (!wasAtBottom) {
      if (previousFocusIndex >= maximumFocusIndex) atBottom = true;
      else focusIndex = previousFocusIndex + 1;
    }
    const previousLoadedStartIndex = Math.max(
      0,
      Math.min(chatItems.length, Number(this._chatLoadedStartIndex) || 0)
    );
    const previousLoadedProgressIndex = chatLoadedProgressAnchorIndex(anchorItemIndexes, previousLoadedStartIndex);
    const targetItemIndex = anchorItemIndexes[focusIndex] || 0;
    // The focus anchor must exist in the mounted range for scroll-into-view to
    // resolve it, so an unmounted target forces a history chunk load too.
    const targetUnmounted = targetItemIndex < previousLoadedStartIndex;
    const shouldLoadEarlier = direction < 0
      && previousLoadedStartIndex > 0
      && (targetUnmounted || focusIndex <= previousLoadedProgressIndex + CHAT_LOAD_AHEAD_ANCHORS);
    const loadedStartIndex = shouldLoadEarlier
      ? earlierChatStartIndex(
        chatItems,
        Math.min(previousLoadedStartIndex, targetItemIndex + 1),
        CHAT_LOAD_CHUNK_HEIGHT,
        chatItemHeights
      )
      : previousLoadedStartIndex;
    const loadedProgressIndex = chatLoadedProgressAnchorIndex(anchorItemIndexes, loadedStartIndex);
    const chatFocusId = anchors[focusIndex] || '';
    const boundary = wasAtBottom === atBottom
      && previousFocusIndex === focusIndex
      && previousLoadedStartIndex === loadedStartIndex;
    const revision = Number(this.data.chatScrollRevision || 0) + 1;
    if (INPUT_DIAGNOSTICS_ENABLED) {
      inputTrace(
        'chat.scroll',
        event,
        this.data.surface,
        `from=${previousFocusIndex} to=${focusIndex} focus=${chatFocusId} atBottom=${atBottom} boundary=${boundary}`
      );
      trace('chat.scroll', {
        direction,
        previousFocusIndex,
        nextFocusIndex: focusIndex,
        anchorCount: anchors.length,
        wasAtBottom,
        nextAtBottom: atBottom,
        previousLoadedStartIndex,
        loadedStartIndex,
        loadedEarlier: shouldLoadEarlier,
        previousProgressIndex: previousLoadedProgressIndex,
        nextProgressIndex: loadedProgressIndex,
        focusId: chatFocusId,
        boundary
      });
      scrollTrace('continuous.request', {
        code: event && event.code || '',
        direction,
        surface: this.data.surface,
        previousFocusIndex,
        nextFocusIndex: focusIndex,
        anchorCount: anchors.length,
        wasAtBottom,
        nextAtBottom: atBottom,
        previousLoadedStartIndex,
        loadedStartIndex,
        loadedEarlier: shouldLoadEarlier,
        previousProgressIndex: previousLoadedProgressIndex,
        nextProgressIndex: loadedProgressIndex,
        focusId: chatFocusId,
        boundary,
        revision
      });
    }
    if (boundary) {
      performanceTrace('chat.scroll.commit', {
        code: event && event.code || '',
        eventType: event && event.type || '',
        direction,
        boundary: true,
        focusIndex,
        atBottom,
        revision,
        totalMs: Number((performanceTimestamp() - performanceStartedAt).toFixed(3))
      });
      return;
    }
    const patch = {
      chatFocusIndex: focusIndex,
      chatFocusId,
      chatScrollIntoView: atBottom ? this.nextChatBottomAnchorId() : chatFocusId,
      chatScrollRevision: revision,
      atBottom,
      unreadCount: atBottom ? 0 : this.data.unreadCount,
      chatProgressSegments: buildChatProgressSegments(anchors, focusIndex, loadedProgressIndex)
    };
    if (loadedStartIndex !== previousLoadedStartIndex) {
      this._chatLoadedStartIndex = loadedStartIndex;
      patch.visibleChatItems = chatItems.slice(loadedStartIndex);
      patch.chatTopSpacerStyle = chatTopSpacerStyle(chatItems, loadedStartIndex, this._chatItemOffsets);
    }
    this._chatFocusItemIndex = anchorItemIndexes[focusIndex] || 0;
    const setDataStartedAt = performanceTimestamp();
    this.setData(patch);
    const completedAt = performanceTimestamp();
    performanceTrace('chat.scroll.commit', {
      code: event && event.code || '',
      eventType: event && event.type || '',
      direction,
      previousFocusIndex,
      nextFocusIndex: focusIndex,
      focusId: chatFocusId,
      focusIndexChanged: previousFocusIndex !== focusIndex,
      atBottom,
      maximumFocusIndex,
      loadedEarlier: shouldLoadEarlier,
      previousLoadedStartIndex,
      loadedStartIndex,
      visibleChatItemCount: (this.data.visibleChatItems || []).length,
      setDataMs: Number((completedAt - setDataStartedAt).toFixed(3)),
      totalMs: Number((completedAt - performanceStartedAt).toFixed(3)),
      revision
    });
    this.scheduleInputPerformanceProbes('chat-scroll', {
      expectedFocusId: chatFocusId,
      expectedFocusIndex: focusIndex,
      expectedRevision: revision,
      expectedLoadedStartIndex: loadedStartIndex
    });
  },

  handleArrowStep(event, sourcePhase) {
    const performanceStartedAt = performanceTimestamp();
    const direction = event.code === 'ArrowDown' ? 1 : -1;
    // ArrowUp/ArrowDown are the API's navigation events and only navigate.
    // They do cancel a pending long press (a scrolling finger is not
    // holding), but they never reclassify the press as a swipe.
    const gesture = this.touchpadGesture();
    if (gesture.phase === 'pressing') {
      this.clearLongPressTimer(gesture);
    }
    if (this.data.surface !== 'main' && this.data.surface !== 'voice') {
      inputTrace('arrow.focus', event, this.data.surface, `direction=${direction > 0 ? 'next' : 'previous'} source=${sourcePhase}`);
      trace('interaction.arrow.focus', { code: event.code, surface: this.data.surface, sourcePhase });
      const handled = this.moveSurfaceFocus(direction);
      performanceTrace('arrow.dispatch', {
        code: event.code,
        eventType: event.type || '',
        surface: this.data.surface,
        sourcePhase,
        direction,
        handled,
        durationMs: Number((performanceTimestamp() - performanceStartedAt).toFixed(3))
      });
      return;
    }
    if (this.data.surface === 'main') {
      inputTrace('arrow.chat', event, this.data.surface, `direction=${direction > 0 ? 'down' : 'up'} mode=anchor-paging source=${sourcePhase}`);
      trace('interaction.arrow.chat', { code: event.code, intercepted: true, mode: 'anchor-paging', sourcePhase });
      this.markScrolling(direction, event);
      performanceTrace('arrow.dispatch', {
        code: event.code,
        eventType: event.type || '',
        surface: this.data.surface,
        sourcePhase,
        direction,
        handled: true,
        durationMs: Number((performanceTimestamp() - performanceStartedAt).toFixed(3))
      });
      return;
    }
    performanceTrace('arrow.dispatch', {
      code: event.code,
      eventType: event.type || '',
      surface: this.data.surface,
      sourcePhase,
      direction,
      handled: false,
      durationMs: Number((performanceTimestamp() - performanceStartedAt).toFixed(3))
    });
  },

  onKeyDown(event) {
    inputTrace('key.down', event, this.data.surface);
    trace('interaction.key.down', { code: event.code || '', surface: this.data.surface });
    this._lastKeyEventAt = Date.now();
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      const receivedAt = performanceTimestamp();
      performanceTrace('arrow.keydown.received', {
        code: event.code,
        eventType: event.type || '',
        surface: this.data.surface,
        sincePreviousArrowMs: this._lastArrowPerfAt
          ? Number((receivedAt - this._lastArrowPerfAt).toFixed(3))
          : -1,
        focusIndex: this.data.focusIndex,
        chatScrollIntoView: this.data.chatScrollIntoView,
        inboxScrollTop: this.data.inboxScrollTop,
        visibleChatItemCount: (this.data.visibleChatItems || []).length
      });
      this._lastArrowPerfAt = receivedAt;
      this._arrowDownCode = event.code;
      this._arrowDownAt = Date.now();
      this._arrowDownPerfAt = receivedAt;
      this.handleArrowStep(event, 'keydown');
      return;
    }
    if (isConfirmKey(event.code)) {
      this.beginTouchpadPress(event);
    }
  },

  onKeyUp(event) {
    inputTrace('key.up', event, this.data.surface);
    trace('interaction.key.up', { code: event.code || '', surface: this.data.surface, toastVisible: this.data.toastVisible });
    this._lastKeyEventAt = Date.now();
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      const receivedAt = performanceTimestamp();
      event.preventDefault();
      const now = Date.now();
      const handledOnKeyDown = this._arrowDownCode === event.code
        && now - this._arrowDownAt <= ARROW_KEYUP_FALLBACK_WINDOW_MS;
      this._arrowDownCode = '';
      this._arrowDownAt = 0;
      const keydownToKeyupMs = this._arrowDownPerfAt
        ? Number((receivedAt - this._arrowDownPerfAt).toFixed(3))
        : -1;
      this._arrowDownPerfAt = 0;
      performanceTrace('arrow.keyup.received', {
        code: event.code,
        eventType: event.type || '',
        surface: this.data.surface,
        handledOnKeyDown,
        keydownToKeyupMs,
        focusIndex: this.data.focusIndex,
        chatScrollIntoView: this.data.chatScrollIntoView,
        inboxScrollTop: this.data.inboxScrollTop
      });
      if (handledOnKeyDown) {
        inputTrace('arrow.release_intercepted', event, this.data.surface, 'handledOn=keydown');
        return;
      }
      this.handleArrowStep(event, 'keyup-fallback');
      return;
    }
    if (event.code === 'Backspace') {
      trace('back.received', { surface: this.data.surface, exitPending: this.data.exitPending, toastVisible: this.data.toastVisible });
      if (this.data.toastVisible) {
        event.preventDefault();
        inputTrace('back.dismiss_toast', event, this.data.surface);
        trace('interaction.back.toast', { intercepted: true });
        this.dismissToast();
        return;
      }
      // On confirmation, let the host perform its documented Backspace
      // default action. Preventing this event would swallow the native exit.
      if (this.data.surface === 'inbox' && this.data.exitPending) {
        this.cancelExitConfirmation();
        trace('back.exit.default_allowed');
        return;
      }
      event.preventDefault();
      if (this.data.surface === 'main') {
        // The inbox is home: back from a conversation returns there instead of
        // exiting the app.
        inputTrace('back.inbox_home', event, this.data.surface);
        trace('interaction.back.inbox_home', { intercepted: true });
        this.goToInbox();
        return;
      }
      if (this.data.surface === 'inbox') {
          inputTrace('back.request_exit_confirmation', event, this.data.surface);
          trace('interaction.back.confirm', { intercepted: true });
          this.requestExitConfirmation();
        return;
      }
      inputTrace('back.previous_level', event, this.data.surface);
      trace('interaction.back.level', { intercepted: true, surface: this.data.surface });
      this.backOneLevel();
      return;
    }
    if (isConfirmKey(event.code)) {
      event.preventDefault();
      this.endTouchpadPress(event);
      return;
    }
  },

  onVoiceWakeup(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const keyword = event ? (event.keyword || event.name || 'unknown') : 'unknown';
    trace('voice.wakeup.received', { keyword, surface: this.data.surface });

    if (this.data.surface === 'menu' || (this.data.menuVisible && this.data.surface !== 'voice')) {
      const gesture = this.touchpadGesture();
      this.clearLongPressTimer(gesture);
      if (gesture.phase === 'pressing') gesture.consumed = true;
      this.closeMenu();
      return;
    }

    if (this.data.surface !== 'main' && this.data.surface !== 'voice') return;
    if (this.data.listening || this.data.recognizing) return;
    // A wake is a complete input event; capture must not wait for a keyup.
    // Consume the release of a press already in progress without stopping ASR.
    const gesture = this.touchpadGesture();
    this.clearLongPressTimer(gesture);
    if (gesture.phase === 'pressing') gesture.consumed = true;
    this.startVoiceInput({ fromVoiceWakeup: true });
  },

  touchpadGesture() {
    if (!this._gesture) this._gesture = createTouchpadGestureState();
    return this._gesture;
  },

  clearLongPressTimer(gesture = this.touchpadGesture()) {
    if (!gesture.longPressTimer) return;
    clearTimeout(gesture.longPressTimer);
    gesture.longPressTimer = null;
  },

  beginTouchpadPress(event) {
    const now = Date.now();
    const gesture = this.touchpadGesture();
    // A press the host never released (holds are kept off the key events)
    // goes stale and must not swallow every following touch.
    if ((gesture.phase === 'pressing' && now - (gesture.startAt || 0) <= STALE_PRESS_MS)
      || now < gesture.suppressUntil) {
      inputTrace('touchpad.down_ignored', event, this.data.surface, 'duplicate=true');
      return;
    }
    this.clearLongPressTimer(gesture);
    const session = createTouchpadGestureState();
    session.phase = 'pressing';
    session.startSurface = this.data.surface;
    session.startAt = now;
    this._gesture = session;
    inputTrace('touchpad.press', event, session.startSurface);
    session.longPressTimer = setTimeout(() => {
      session.longPressTimer = null;
      if (this._gesture !== session || session.phase !== 'pressing') return;
      const startSurface = session.startSurface;
      // Long press is a no-op while recording: an accidental hold must
      // neither close the stop menu nor abort the running recognition.
      if (startSurface === 'voice') {
        inputTrace('long_press.ignored', event, startSurface, 'recording');
        trace('interaction.long_press.ignored', { startSurface });
        return;
      }
      session.longPressFired = true;
      inputTrace('long_press.trigger', event, startSurface, `heldMs=${Date.now() - session.startAt}`);
      trace('interaction.long_press.trigger', { heldMs: Date.now() - session.startAt, startSurface });
      if (startSurface === 'main') this.startVoiceInput();
      else this.closeMenu();
    }, LONG_PRESS_MENU_MS);
  },

  endTouchpadPress(event) {
    const now = Date.now();
    const gesture = this.touchpadGesture();
    const pressing = gesture.phase === 'pressing';
    if (!pressing && now < gesture.suppressUntil) {
      inputTrace('touchpad.release_ignored', event, this.data.surface, 'duplicate=true');
      return;
    }
    this.clearLongPressTimer(gesture);
    // A release without a matching press (firmware quirk) resolves as an
    // immediate tap on the current surface.
    const startSurface = pressing ? gesture.startSurface : this.data.surface;
    const held = pressing ? now - gesture.startAt : 0;
    const consumed = pressing && gesture.consumed;
    const longPressFired = gesture.longPressFired;
    inputTrace('touchpad.release', event, startSurface, `heldMs=${held} longPress=${longPressFired} consumed=${consumed}`);
    trace('interaction.touchpad.release', { code: event.code, heldMs: held, triggered: longPressFired, consumed, startSurface });
    // Reset the press session before resolving so action handlers observe a
    // settled gesture state.
    gesture.phase = 'idle';
    gesture.startSurface = this.data.surface;
    gesture.startAt = 0;
    gesture.consumed = false;
    gesture.longPressFired = false;
    gesture.suppressUntil = now + TOUCHPAD_DUPLICATE_WINDOW_MS;
    if (longPressFired || held >= LONG_PRESS_MENU_MS) {
      if (!longPressFired) {
        // The timer never fired (for example a stalled event loop); honor the
        // hold duration now so the gesture still lands. Recording stays
        // untouched: a hold there is a no-op, not a close or a stop.
        if (startSurface === 'main') this.startVoiceInput();
        else if (startSurface !== 'voice') this.closeMenu();
      } else if (startSurface === 'main' && this.data.surface === 'voice' && this.data.listening) {
        // startVoiceInput deferred the ASR start while the finger was down.
        trace('voice.input.start.scheduled', { delayMs: 0, context: 'long_press_release' });
        this.scheduleRecognitionStart('long_press_release');
      }
    } else if (consumed) {
      // An out-of-band interaction (voice wakeup) already consumed this
      // press; its release must not resolve as a tap on top of it.
      inputTrace('touchpad.release_consumed', event, startSurface);
      trace('interaction.touchpad.release_consumed', { code: event.code, startSurface });
    } else {
      this.handleSurfaceTap(startSurface, now, event);
    }
  },

  // Taps resolve immediately on every surface: the conversation page opens
  // the quick menu, everything else activates the focused item. Returning to
  // the inbox is the Backspace key's job (routed per surface in onKeyUp), so
  // no tap ever waits out a double-tap window.
  handleSurfaceTap(surface, now, event) {
    if (surface === 'main') {
      inputTrace('touchpad.quick_menu', event, surface);
      trace('interaction.touchpad.quick_menu', { surface });
      this.openQuickMenu();
      return;
    }
    inputTrace('touchpad.activate', event, surface, `index=${this.data.focusIndex}`);
    this.activateFocused();
  },

  handleToastTap(event) {
    inputTrace('tap.toast', event, this.data.surface);
    this.dismissToast();
  },

  handleInteraction(event) {
    inputTrace('tap.root', event, this.data.surface);
    trace('interaction.tap.root', { surface: this.data.surface, exitPending: this.data.exitPending });
  },

  handleMenuTap(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index || 0);
    inputTrace('tap.menu_button', event, this.data.surface, `index=${index}`);
    trace('interaction.tap.menu', { index, action: this.data.menuButtons[index] && this.data.menuButtons[index].id || '' });
    this.setData({ focusIndex: index });
    const item = this.data.menuButtons[index];
    if (item) this.activateMenuAction(item.id);
  },

  handleInboxTap(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index || 0);
    inputTrace('tap.inbox_button', event, this.data.surface, `index=${index}`);
    const item = this.data.inboxItems[index];
    trace('interaction.tap.inbox', {
      index,
      conversationId: item && item.conversation_id || '',
      hostId: item && item.host_id || ''
    });
    this.setData({ focusIndex: index });
    this.activateFocused();
  },

  handleControlTap(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index || 0);
    inputTrace('tap.control_button', event, this.data.surface, `index=${index}`);
    trace('interaction.tap.control', { index, action: this.data.controlItems[index] && this.data.controlItems[index].action || '' });
    this.setData({ focusIndex: index });
    this.activateFocused();
  },

  handleApprovalTap(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index || 0);
    inputTrace('tap.approval_button', event, this.data.surface, `index=${index}`);
    trace('interaction.tap.approval', { index, actionId: this.data.approvalActions[index] && this.data.approvalActions[index].id || '' });
    this.setData({ focusIndex: index });
    this.activateFocused();
  },
};
