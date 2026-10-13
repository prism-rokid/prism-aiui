import wx from 'wx';
import { createVoiceInput } from '../../lib/voice-input.js';
import { createPrismApi, createStreamId, readableError, PRODUCTION_API_BASE_URL } from '../../lib/prism-api.js';
import { resolveAccountCredential } from '../../lib/prism-device-auth.js';
import { LOCAL_DEBUG_AUTH } from '../../lib/prism-local-token.js';
import { renderFrame } from '../../lib/logo-scan.js';
import { trace } from '../../lib/prism-trace.js';
import { CHAT_BOTTOM_ANCHOR_IDS, chatTopSpacerStyle, buildChatProgressSegments, INITIAL_CHAT_ITEMS, INITIAL_CHAT_LAYOUT, INITIAL_CHAT_ANCHORS, INITIAL_CHAT_FOCUS_INDEX, INITIAL_CHAT_LOADED_START_INDEX, INITIAL_CHAT_LOADED_PROGRESS_INDEX, buildInitialChatState } from '../../lib/prism-chat-model.js';
import { initI18n, t, buildTextMap } from '../../lib/prism-i18n.js';
import { LIST_DEFAULT_VIEWPORT_HEIGHT, STATUS_DOT_PULSE_INTERVAL_MS } from '../../lib/prism-inbox-model.js';
import { MENU_CLASS_HIDDEN } from '../../lib/prism-surfaces.js';
import { createTouchpadGestureState } from '../../lib/prism-gesture.js';
import { createBootMethods } from '../../lib/prism-page-boot.js';
import { syncMethods } from '../../lib/prism-page-sync.js';
import { createStreamMethods } from '../../lib/prism-page-stream.js';
import { createMenuMethods } from '../../lib/prism-page-menu.js';
import { createVoiceMethods } from '../../lib/prism-page-voice.js';
import { inputMethods } from '../../lib/prism-page-input.js';

// The page is assembled from method groups; see lib/prism-page-*.js. This
// file owns the data contract, lifecycle wiring, and configuration hydration.

const bootMethods = createBootMethods({ wx, renderFrame, readableError });
const streamMethods = createStreamMethods({ createStreamId, readableError });
const menuMethods = createMenuMethods({ readableError });
const voiceMethods = createVoiceMethods({ wx, createVoiceInput, readableError });

export default {
  ...bootMethods,
  ...syncMethods,
  ...streamMethods,
  ...menuMethods,
  ...voiceMethods,
  ...inputMethods,

  data: {
    apiBaseUrl: '',
    pollInterval: 3000,
    connected: false,
    configured: false,
    connectionGuideVisible: false,
    loading: false,
    inboxLoading: false,
    surface: 'inbox',
    menuVisible: false,
    menuClass: MENU_CLASS_HIDDEN,
    chatClass: 'prism-main-chat prism-main-chat-thread-picker',
    focusIndex: 0,
    previousFocusIndex: 0,
    menuButtons: [],
    agents: [],
    agentsSignature: '',
    inboxItems: [],
    inboxProgressSegments: [],
    inboxFocusId: '',
    inboxScrollTop: 0,
    inboxViewportHeight: LIST_DEFAULT_VIEWPORT_HEIGHT,
    controlItems: [],
    controlScope: '',
    currentModelId: '',
    currentReasoningId: '',
    currentPermissionId: '',
    selectedHostId: '',
    selectedPluginId: '',
    selectedConversationId: '',
    currentAgentName: 'Agent',
    currentAgentIcon: '',
    hostLabel: '未连接',
    threadTitle: 'Prism 棱镜面板',
    threadTitleDisplay: 'Prism 棱镜面板',
    // Populated with buildTextMap() in onLoad; WXML binds text.* for every
    // locale-dependent label.
    text: {},
    cwd: '',
    contextLabel: '',
    contextVisible: false,
    modelLabel: '--',
    reasoningLabel: '--',
    permissionLabel: '--',
    visibleChatItems: INITIAL_CHAT_ITEMS.slice(INITIAL_CHAT_LOADED_START_INDEX),
    chatTopSpacerStyle: chatTopSpacerStyle(
      INITIAL_CHAT_ITEMS,
      INITIAL_CHAT_LOADED_START_INDEX,
      INITIAL_CHAT_LAYOUT.itemOffsets
    ),
    chatProgressSegments: buildChatProgressSegments(
      INITIAL_CHAT_ANCHORS,
      INITIAL_CHAT_FOCUS_INDEX,
      INITIAL_CHAT_LOADED_PROGRESS_INDEX
    ),
    messagesLoaded: false,
    messagesLoading: false,
    lastMessageId: 'message-welcome',
    unreadCount: 0,
    atBottom: true,
    chatFocusIndex: INITIAL_CHAT_FOCUS_INDEX,
    chatFocusId: INITIAL_CHAT_ANCHORS[INITIAL_CHAT_FOCUS_INDEX] || '',
    // A top spacer preserves one continuous coordinate space while history is
    // progressively mounted as the user approaches the loaded range. Scrolling
    // itself is anchor-based: the native view resolves each anchor node's real
    // position, so estimated heights only size the spacer and progress bar.
    chatScrollIntoView: CHAT_BOTTOM_ANCHOR_IDS[0],
    chatScrollRevision: 0,
    isRunning: false,
    runSummary: '',
    taskId: '',
    lastRunError: '',
    approvalActions: [],
    approvalText: 'Agent 请求批准操作',
    primaryAction: 'send',
    planVisible: false,
    planText: '',
    draftText: '',
    restoredDraft: '',
    failedDraft: '',
    listening: false,
    recognizing: false,
    voiceHint: '',
    toastVisible: false,
    toastText: '',
    toastBaseText: '',
    toastCount: 0,
    toastSeconds: 0,
    exitPending: false
  },

  onLoad() {
    // Build marker: grep this tag in logcat to confirm which build the page
    // instance is actually serving.
    console.log('[PrismAIUI]', JSON.stringify({ event: 'build.tag', tag: '20261013-realdevice-debug' }));
    trace('page.load.start', { surface: this.data.surface });
    wx.setBackgroundColor({ backgroundColor: '#000000' });
    // Locale first: every later label read (welcome message, menu, hints)
    // must resolve against the finalized language.
    initI18n({ wx });
    // The welcome message is translated, so the boot state is rebuilt here
    // (after initI18n) instead of freezing the module-level zh-CN constants.
    const initialChatState = buildInitialChatState();
    this.setData({
      text: buildTextMap(),
      threadTitle: t('common.appName'),
      threadTitleDisplay: t('common.appName'),
      hostLabel: t('common.notConnected'),
      approvalText: t('approval.requestDefault'),
      visibleChatItems: initialChatState.chatItems.slice(initialChatState.chatLoadedStartIndex),
      chatTopSpacerStyle: chatTopSpacerStyle(
        initialChatState.chatItems,
        initialChatState.chatLoadedStartIndex,
        initialChatState.chatItemOffsets
      ),
      chatProgressSegments: buildChatProgressSegments(
        initialChatState.chatAnchors,
        initialChatState.chatFocusIndex,
        initialChatState.chatLoadedProgressIndex
      ),
      chatFocusIndex: initialChatState.chatFocusIndex,
      chatFocusId: initialChatState.chatAnchors[initialChatState.chatFocusIndex] || '',
      lastMessageId: 'message-welcome'
    });
    this._pageActive = true;
    this._api = null;
    this._pollTimer = null;
    this._pollInFlight = false;
    this._inboxTimeTimer = null;
    this._statusDotPulseTimer = null;
    this._statusDotPulsePhase = 0;
    this._toastTimer = null;
    this._arrowDownCode = '';
    this._arrowDownAt = 0;
    this._arrowDownPerfAt = 0;
    this._lastArrowPerfAt = 0;
    this._performanceProbeSequence = 0;
    this._gesture = createTouchpadGestureState();
    this._exitConfirmTimer = null;
    this._agentPollTick = 0;
    this._everConnected = false;
    this._recognition = null;
    this._recognitionStartTimer = null;
    this._recognitionFailed = false;
    this._recognitionActive = false;
    this._lastKeyEventAt = 0;
    this._loadingLogoTimer = null;
    this._loadingLogoCtx = null;
    this._convStream = null;
    this._streamWatchdog = null;
    this._streamReconnectTimer = null;
    this._emptyConversationSettleTimer = null;
    this._conversationLoadingTimer = null;
    this._lastFrameAt = 0;
    this._unavailableToastAt = 0;
    this._serverMessageMap = new Map();
    this._serverMessageSeq = 0;
    this._messages = initialChatState.messages;
    this._chatItems = initialChatState.chatItems;
    this._chatAnchors = initialChatState.chatAnchors;
    this._chatAnchorItemIndexes = initialChatState.chatAnchorItemIndexes;
    this._chatItemHeights = initialChatState.chatItemHeights;
    this._chatItemOffsets = initialChatState.chatItemOffsets;
    this._chatContentHeight = initialChatState.chatContentHeight;
    this._chatLayoutItems = initialChatState.chatItems;
    this._chatLoadedStartIndex = initialChatState.chatLoadedStartIndex;
    this._chatFocusItemIndex = initialChatState.chatFocusItemIndex;
    this._chatBottomAnchorPhase = 0;
    this._conversations = [];
    this._modelOptions = [];
    this._reasoningOptions = [];
    this._permissionOptions = [];
    this._detailActions = [];
    this._detailOptionsSignature = '';
    this._approval = null;
    this._approvalSignature = '';
    this._inboxCatalog = new Map();
    this._draftHistory = [];
    this._draftFuture = [];
    this._voiceBaseDraft = '';
    this._lastSessionTranscript = '';
    this._loaderSpinTimer = null;
    this._loaderSpinPhase = 0;
    this._loaderSpinCtx = null;
    this._configurationPromise = this.hydrateConfiguration();
    this.setupRecognition();
    this._inboxTimeTimer = setInterval(() => this.refreshInboxTimeLabels(), 30000);
    this._statusDotPulseTimer = setInterval(() => this.refreshStatusDotPulse(), STATUS_DOT_PULSE_INTERVAL_MS);
    this.rebuildMenu();
    this._configurationPromise.then(() => {
      if (this._pageActive === false) return;
      if (this.data.configured) {
        trace('page.load.bootstrap');
        this.bootstrap();
      } else {
        trace('page.load.not_configured');
        this.setConnectionGuide(true);
        this.showToast(this.data.apiBaseUrl ? t('boot.deviceAuthFailed') : t('api.error.baseUrlMissing'), 6);
      }
      trace('page.load.ready', { configured: this.data.configured, pollInterval: this.data.pollInterval });
    });
  },

  onUnload() {
    this._chatScrollRequest = null;
    this._pageActive = false;
    trace('page.unload.start', {
      surface: this.data.surface,
      selectedHostId: this.data.selectedHostId,
      selectedPluginId: this.data.selectedPluginId,
      selectedConversationId: this.data.selectedConversationId
    });
    this.closeConversationStream();
    this.stopPolling();
    this.stopLoadingLogo();
    this.stopLoaderSpin();
    this.clearConversationLoadingFallback();
    if (this._inboxTimeTimer) clearInterval(this._inboxTimeTimer);
    if (this._statusDotPulseTimer) clearInterval(this._statusDotPulseTimer);
    if (this._toastTimer) clearInterval(this._toastTimer);
    if (this._gesture && this._gesture.longPressTimer) clearTimeout(this._gesture.longPressTimer);
    if (this._exitConfirmTimer) clearTimeout(this._exitConfirmTimer);
    const recognitionStartCancelled = this.cancelPendingRecognitionStart('page_unload');
    if (!recognitionStartCancelled && this._recognition && this.data.listening) this._recognition.abort();
    trace('page.unload.complete');
  },

  onShow() {
    this.syncLoadingVisuals();
  },

  onHide() {
    this.cancelPendingRecognitionStart('page_hidden');
    if (this._recognition) this._recognition.abort();
    this._recognitionActive = false;
    this.setData({ listening: false, recognizing: false, voiceHint: '' });
    if (this.data.surface === 'voice') this.openMenu();
    this.stopLoadingLogo();
    this.stopLoaderSpin();
  },

  hydrateConfiguration() {
    trace('config.hydrate.start');
    const pollInterval = Number(this.data.pollInterval) || 3000;
    this._clientInstanceId = createStreamId('client');
    this.setData({ pollInterval, configured: false });
    // The credential comes from the device credential flow; a real-device
    // debug build falls back to the pack-time injection
    // (lib/prism-local-token.js). Production builds see neither.
    const apiBaseUrl = LOCAL_DEBUG_AUTH.baseUrl || PRODUCTION_API_BASE_URL;
    this.setData({ apiBaseUrl, configured: false });
    if (!apiBaseUrl) {
      trace('config.hydrate.complete', {
        configured: false,
        tokenConfigured: false,
        pollInterval,
        clientInstanceId: this._clientInstanceId
      });
      return Promise.resolve(false);
    }
    return resolveAccountCredential()
      .then(({ accountToken, summary: tokenSummary }) => {
        if (this._pageActive === false) return false;
        this._api = createPrismApi(wx, {
          baseUrl: apiBaseUrl,
          accountToken
        });
        this.setData({ configured: true });
        trace('config.hydrate.complete', {
          configured: true,
          tokenConfigured: true,
          ...tokenSummary,
          pollInterval,
          clientInstanceId: this._clientInstanceId
        });
        return true;
      })
      .catch((error) => {
        if (this._pageActive === false) return false;
        trace('config.auth_failed', {
          configured: false,
          tokenConfigured: false,
          code: error && error.code || '',
          errorName: error && error.name || 'Error'
        });
        this.setData({ configured: false });
        return false;
      });
  },
};
