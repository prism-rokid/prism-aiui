// Page boot and feedback methods: runtime-state repair, loading visuals
// (canvas logo + conversation loader spinner), the slow-load fallback timers,
// toasts, the connection guide, and exit confirmation.

import { trace, errorDetails } from './prism-trace.js';
import { buildChatItems, buildChatLayoutMetrics, chatTailStartIndex, CHAT_INITIAL_LOAD_HEIGHT } from './prism-chat-model.js';
import { t } from './prism-i18n.js';

const CONVERSATION_LOADING_TIMEOUT_MS = 8000;
const LOADING_LOGO_SIZE = 148;
const LOADING_LOGO_FPS = 30;
// WXSS has no keyframe animations; the conversation loader is redrawn by a
// timer inside a fixed Canvas node instead of transforming a native image.
const LOADER_SPIN_INTERVAL_MS = 100;
const LOADER_SPIN_STEP_DEG = 45;
const LOADER_CANVAS_SIZE = 36;
const LOADER_ARC_RADIUS = 14;
const LOADER_ARC_SPAN = Math.PI * 1.5;
const EXIT_CONFIRM_MS = 5000;

export function createBootMethods({ wx, renderFrame, readableError }) {
  return {

  ensureRuntimeState() {
    if (!Array.isArray(this._messages)) this._messages = Array.isArray(this.data.messages) ? this.data.messages : [];
    if (!Array.isArray(this._chatItems)) this._chatItems = buildChatItems(this._messages);
    if (this._chatLayoutItems !== this._chatItems) {
      const layout = buildChatLayoutMetrics(this._chatItems);
      this._chatAnchors = layout.anchors;
      this._chatAnchorItemIndexes = layout.anchorItemIndexes;
      this._chatItemHeights = layout.itemHeights;
      this._chatItemOffsets = layout.itemOffsets;
      this._chatContentHeight = layout.contentHeight;
      this._chatLayoutItems = this._chatItems;
    }
    if (!Array.isArray(this._chatAnchorItemIndexes)) this._chatAnchorItemIndexes = [];
    if (!Number.isFinite(this._chatFocusItemIndex)) this._chatFocusItemIndex = 0;
    if (!Number.isInteger(this._chatBottomAnchorPhase)) this._chatBottomAnchorPhase = 0;
    if (!Number.isFinite(this._chatLoadedStartIndex)) {
      this._chatLoadedStartIndex = chatTailStartIndex(
        this._chatItems,
        CHAT_INITIAL_LOAD_HEIGHT,
        this._chatItemHeights
      );
    }
    if (!Array.isArray(this._conversations)) this._conversations = Array.isArray(this.data.conversations) ? this.data.conversations : [];
    if (!Array.isArray(this._modelOptions)) this._modelOptions = [];
    if (!Array.isArray(this._reasoningOptions)) this._reasoningOptions = [];
    if (!Array.isArray(this._permissionOptions)) this._permissionOptions = [];
    if (!Array.isArray(this._detailActions)) this._detailActions = [];
    if (this._approval === undefined) this._approval = this.data.approval || null;
  },

  syncLoadingVisuals() {
    const startupLoading = this.data.surface === 'inbox'
      && !this.data.menuVisible
      && (this.data.loading || this.data.inboxLoading);
    const conversationLoading = this.data.surface === 'main'
      && !this.data.menuVisible
      && this.data.messagesLoading
      && !this.data.messagesLoaded;
    // The canvas logo is reserved for bootstrap. Conversation loading is
    // rendered inside the chat area so it can never cover another surface.
    if (startupLoading) {
      this.startLoadingLogo();
      this.stopLoaderSpin();
      return;
    }
    this.stopLoadingLogo();
    if (conversationLoading) this.startLoaderSpin();
    else this.stopLoaderSpin();
  },

  startLoaderSpin() {
    if (this._loaderSpinTimer) return;
    const tick = () => {
      if (!this._loaderSpinCtx && wx.createCanvasContext) {
        this._loaderSpinCtx = wx.createCanvasContext('prismConversationLoader');
      }
      const ctx = this._loaderSpinCtx;
      if (ctx) {
        const phase = Number(this._loaderSpinPhase) || 0;
        const startAngle = -Math.PI / 2 + phase * LOADER_SPIN_STEP_DEG * Math.PI / 180;
        ctx.clearRect(0, 0, LOADER_CANVAS_SIZE, LOADER_CANVAS_SIZE);
        ctx.beginPath();
        ctx.strokeStyle = '#40ff5e';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.arc(LOADER_CANVAS_SIZE / 2, LOADER_CANVAS_SIZE / 2, LOADER_ARC_RADIUS, startAngle, startAngle + LOADER_ARC_SPAN, false);
        ctx.stroke();
        if (ctx.flush) ctx.flush();
        this._loaderSpinPhase = phase + 1;
      }
      this._loaderSpinTimer = setTimeout(tick, LOADER_SPIN_INTERVAL_MS);
    };
    tick();
  },

  stopLoaderSpin() {
    if (this._loaderSpinTimer) clearTimeout(this._loaderSpinTimer);
    this._loaderSpinTimer = null;
    this._loaderSpinPhase = 0;
    // The loader canvas is conditionally mounted in the empty-chat view.
    // Reacquire its context after the next mount instead of drawing to a stale
    // native canvas node.
    this._loaderSpinCtx = null;
  },

  scheduleConversationLoadingFallback(conversationId) {
    this.clearConversationLoadingFallback();
    if (!conversationId || !this.data.messagesLoading || this.data.messagesLoaded) return;
    this._conversationLoadingTimer = setTimeout(() => {
      this._conversationLoadingTimer = null;
      this.settleConversationLoadingFallback(conversationId);
    }, CONVERSATION_LOADING_TIMEOUT_MS);
  },

  settleConversationLoadingFallback(conversationId) {
    if (this.data.selectedConversationId !== conversationId) return false;
    if (!this.data.messagesLoading || this.data.messagesLoaded) return false;
    trace('messages.initial_load.timeout', {
      conversationId,
      timeoutMs: CONVERSATION_LOADING_TIMEOUT_MS
    });
    this.applyMessages([], false);
    this.showToast(t('boot.slowLoadRetry'), 5);
    return true;
  },

  clearConversationLoadingFallback() {
    if (!this._conversationLoadingTimer) return;
    clearTimeout(this._conversationLoadingTimer);
    this._conversationLoadingTimer = null;
  },

  startLoadingLogo() {
    if (this._loadingLogoTimer || typeof renderFrame !== 'function') return;
    const tick = () => {
      if (!this._loadingLogoCtx && wx.createCanvasContext) {
        this._loadingLogoCtx = wx.createCanvasContext('prismLoadingLogo');
      }
      if (this._loadingLogoCtx) {
        renderFrame(this._loadingLogoCtx, LOADING_LOGO_SIZE, Date.now() / 1000);
        if (this._loadingLogoCtx.flush) this._loadingLogoCtx.flush();
      }
      this._loadingLogoTimer = setTimeout(tick, Math.round(1000 / LOADING_LOGO_FPS));
    };
    tick();
  },

  stopLoadingLogo() {
    if (this._loadingLogoTimer) clearTimeout(this._loadingLogoTimer);
    this._loadingLogoTimer = null;
    // The canvas is conditionally mounted with the loading overlay. Do not
    // retain its native context after unmounting it, otherwise the next mount
    // can render into the old canvas and leave a black screen.
    this._loadingLogoCtx = null;
  },

  handleNetworkError(error, show = true) {
    trace('network.error', { show, wasConnected: this.data.connected, ...errorDetails(error) });
    const wasConnected = this.data.connected;
    this.setData({ connected: false });
    // Before any agent list has landed, a failed fetch means the desktop side
    // is not reachable yet: keep the connection guide up instead of a blank
    // inbox. Once data has loaded, later errors stay as toasts only.
    if (!this.data.agents.length) this.setConnectionGuide(true);
    if (show) this.showToast(readableError(error), 10);
  },

  setConnectionGuide(visible) {
    if (this.data.connectionGuideVisible === visible) return;
    this.setData({ connectionGuideVisible: visible });
    trace('connection.guide', { visible });
  },

  showToast(text, seconds = 5) {
    trace('toast.show', { text, seconds, alreadyVisible: this.data.toastVisible });
    if (this._toastTimer) clearInterval(this._toastTimer);
    const sameToast = this.data.toastVisible && this.data.toastBaseText === text;
    const toastCount = sameToast ? this.data.toastCount + 1 : 1;
    this.setData({
      toastVisible: true,
      toastBaseText: text,
      toastCount,
      toastText: toastCount > 1 ? `${text} ×${toastCount}` : text,
      toastSeconds: seconds
    });
    this._toastTimer = setInterval(() => {
      const next = Number(this.data.toastSeconds || 0) - 1;
      if (next <= 0) this.dismissToast();
      else this.setData({ toastSeconds: next });
    }, 1000);
  },

  dismissToast() {
    trace('toast.dismiss', { text: this.data.toastBaseText, secondsRemaining: this.data.toastSeconds });
    if (this._toastTimer) clearInterval(this._toastTimer);
    this._toastTimer = null;
    this.setData({ toastVisible: false, toastText: '', toastBaseText: '', toastCount: 0, toastSeconds: 0 });
  },

  cancelExitConfirmation() {
    const wasPending = Boolean(this.data.exitPending);
    if (this._exitConfirmTimer) clearTimeout(this._exitConfirmTimer);
    this._exitConfirmTimer = null;
    if (this.data.exitPending) this.setData({ exitPending: false });
    if (wasPending) trace('exit.confirmation.cancel');
  },

  requestExitConfirmation() {
    trace('exit.confirmation.request', { timeoutMs: EXIT_CONFIRM_MS });
    this.cancelExitConfirmation();
    this.setData({ exitPending: true });
    this._exitConfirmTimer = setTimeout(() => {
      this._exitConfirmTimer = null;
      this.setData({ exitPending: false });
      trace('exit.confirmation.timeout');
    }, EXIT_CONFIRM_MS);
  },
  };
}
