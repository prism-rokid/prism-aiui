// Catalog and state sync methods: bootstrap, host plugin/conversation
// application, selection persistence, polling, and inbox catalog rebuilding.

import { trace, errorDetails, isConversationMissingError } from './prism-trace.js';
import { buildListProgressSegments } from './prism-chat-model.js';
import { applyInboxGroupLayout, buildInboxItems, decorateInbox, inboxScrollTopForFocus, statusDotClass, STATUS_DOT_PULSE_CLASSES } from './prism-inbox-model.js';
import { relativeTimeLabel } from './prism-labels.js';
import { iconPath } from './prism-icons.js';
import { chatLayoutClass, MENU_CLASS_VISIBLE } from './prism-surfaces.js';
import { t } from './prism-i18n.js';

export const syncMethods = {

  async bootstrap() {
    if (!this._api || this.data.loading) {
      trace('bootstrap.skipped', { hasApi: Boolean(this._api), loading: this.data.loading });
      return;
    }
    const startedAt = Date.now();
    trace('bootstrap.start');
    this.setData({ loading: true });
    this.syncLoadingVisuals();
    try {
      await this._api.getMe();
      trace('bootstrap.me.loaded');
      const results = await Promise.all([this._api.getHostPlugins(), this._api.getSelection()]);
      const pluginsResponse = results[0] || {};
      const selection = results[1] || {};
      const plugins = this.applyHostPlugins(pluginsResponse);
      let hostId = selection.selected_host_id || '';
      let pluginId = selection.selected_plugin_id || '';
      const selectionValid = plugins.some((plugin) => plugin.host_id === hostId && plugin.plugin_id === pluginId);
      if (!selectionValid) {
        const firstAvailable = plugins.find((plugin) => plugin.connected && plugin.available) || plugins[0];
        hostId = firstAvailable ? firstAvailable.host_id : '';
        pluginId = firstAvailable ? firstAvailable.plugin_id : '';
      }
      trace('bootstrap.catalog.loaded', {
        pluginCount: plugins.length,
        selectedHostId: hostId,
        selectedPluginId: pluginId,
        selectedConversationId: selection.selected_conversation_id || ''
      });
      if (hostId && pluginId) {
        await this.loadPlugin(hostId, pluginId, selection.selected_conversation_id || '');
        await this.refreshInboxCatalog();
        // The inbox is the home surface: every launch lands there, with the
        // first unread conversation focused for a single tap to enter. The
        // guide stays up when the landing plugin is unreachable (loadPlugin
        // flips `connected` off in that case).
        trace('bootstrap.inbox.home');
        this.setConnectionGuide(!this.data.connected);
        this.setData({
          surface: 'inbox',
          menuVisible: true,
          menuClass: MENU_CLASS_VISIBLE,
          chatClass: chatLayoutClass(this.data.planVisible, true, true)
        });
        this.rebuildInbox();
      } else {
        trace('bootstrap.no_plugins');
        this.setData({ connected: false, hostLabel: t('sync.noAgentAvailable') });
        this.setConnectionGuide(true);
      }
    } catch (error) {
      trace('bootstrap.error', { durationMs: Date.now() - startedAt, ...errorDetails(error) });
      this.handleNetworkError(error);
    } finally {
      this.setData({ loading: false });
      this.syncLoadingVisuals();
      this.startPolling();
      trace('bootstrap.complete', { durationMs: Date.now() - startedAt });
    }
  },

  applyHostPlugins(response) {
    this.ensureRuntimeState();
    if (response.changed === false && this.data.agents.length) {
      trace('plugins.apply.unchanged', { count: this.data.agents.length });
      return this.data.agents;
    }
    const previousSignature = this.data.agentsSignature;
    const selectedHostId = this.data.selectedHostId;
    const selectedPluginId = this.data.selectedPluginId;
    const agents = (response.items || []).map((plugin, index) => ({
      ...plugin,
      uid: `${plugin.host_id}::${plugin.plugin_id}`,
      icon: iconPath(plugin),
      unread: plugin.status === 'waiting_approval',
      selected: plugin.host_id === selectedHostId && plugin.plugin_id === selectedPluginId,
      index
    }));
    if (this._inboxCatalog) {
      const liveUids = new Set(agents.map((agent) => agent.uid));
      for (const uid of this._inboxCatalog.keys()) {
        if (!liveUids.has(uid)) this._inboxCatalog.delete(uid);
      }
    }
    this.setData({
      agents,
      agentsSignature: response.signature || this.data.agentsSignature
    });
    const selectedAgent = agents.find((plugin) => plugin.host_id === selectedHostId && plugin.plugin_id === selectedPluginId);
    if (selectedAgent) this.setData({
      connected: Boolean(selectedAgent.connected && selectedAgent.available)
    });
    if (selectedAgent && !(selectedAgent.connected && selectedAgent.available) && this.data.connected) {
      this.setData({ connected: false });
      this.showToast(t('sync.offline'), 10);
    }
    trace('plugins.apply.complete', {
      count: agents.length,
      selectedHostId,
      selectedPluginId,
      signatureChanged: Boolean(response.signature && response.signature !== previousSignature)
    });
    return agents;
  },

  async loadPlugin(hostId, pluginId, preferredConversationId = '') {
    const startedAt = Date.now();
    trace('plugin.load.start', { hostId, pluginId, preferredConversationId });
    const plugin = this.data.agents.find((item) => item.host_id === hostId && item.plugin_id === pluginId);
    if (!plugin) {
      trace('plugin.load.missing', { hostId, pluginId });
      return;
    }
    this.closeConversationStream();
    this.setData({
      selectedHostId: hostId,
      selectedPluginId: pluginId,
      currentAgentName: plugin.display_name || plugin.plugin_id || 'Agent',
      currentAgentIcon: plugin.icon,
      hostLabel: plugin.host_alias || plugin.host_id || t('sync.remoteComputer'),
      connected: Boolean(plugin.connected && plugin.available),
      selectedConversationId: '',
      conversationsSignature: '',
      visibleChatItems: [],
      chatTopSpacerStyle: 'height: 0px;',
      chatProgressSegments: [],
      chatFocusIndex: 0,
      chatFocusId: '',
      chatScrollIntoView: '',
      messagesLoaded: false,
      messagesLoading: false,
      approvalActions: [],
      isRunning: false,
      taskId: ''
    });
    this.syncLoadingVisuals();
    this._serverMessageMap = new Map();
    this._serverMessageSeq = 0;
    this._messages = [];
    this._chatItems = [];
    this._chatAnchors = [];
    this._chatAnchorItemIndexes = [];
    this._chatLoadedStartIndex = 0;
    this._chatFocusItemIndex = 0;
    this._conversations = [];
    this._modelOptions = [];
    this._reasoningOptions = [];
    this._permissionOptions = [];
    this._detailActions = [];
    this._detailOptionsSignature = '';
    this._approval = null;
    this._approvalSignature = '';
    this.applyHostSelectionStyles();
    if (!(plugin.connected && plugin.available)) {
      trace('plugin.load.unavailable', {
        hostId,
        pluginId,
        connected: Boolean(plugin.connected),
        available: Boolean(plugin.available),
        unavailableCode: plugin.unavailable_code || ''
      });
      // The cloud API answered but the desktop side is not reachable. Keep the
      // connection guide up instead of leaving a blank inbox; polling clears
      // it once the agent reports available again.
      this.setConnectionGuide(true);
      this.showToast(t('sync.agentUnavailableRetry'), 8);
    }
    const response = await this._api.getConversationIndex(hostId, pluginId);
    const conversations = this.applyConversations(response);
    let conversationId = preferredConversationId || plugin.selected_conversation_id || '';
    if (conversationId && !conversations.some((item) => item.conversation_id === conversationId)) {
      // The persisted selection points at a conversation the plugin no longer
      // reports (for example the plugin is unavailable and its index is empty).
      // Drop it instead of selecting an id the server will reject.
      trace('plugin.load.stale_conversation', {
        hostId, pluginId, conversationId, conversationCount: conversations.length
      });
      conversationId = '';
    }
    if (!conversationId && conversations.length) conversationId = conversations[0].conversation_id;
    trace('plugin.load.conversations', { hostId, pluginId, conversationCount: conversations.length, conversationId });
    if (conversationId) await this.selectConversationById(conversationId);
    else await this.persistSelection(false);
    trace('plugin.load.complete', { hostId, pluginId, conversationId, durationMs: Date.now() - startedAt });
  },

  applyHostSelectionStyles() {
    const agents = this.data.agents.map((plugin) => ({
      ...plugin,
      selected: plugin.host_id === this.data.selectedHostId && plugin.plugin_id === this.data.selectedPluginId
    }));
    this.setData({ agents });
    trace('plugins.selection_styles.applied', { selectedHostId: this.data.selectedHostId, selectedPluginId: this.data.selectedPluginId, count: agents.length });
  },

  applyConversations(response) {
    this.ensureRuntimeState();
    if (response.changed === false && this._conversations.length) {
      trace('conversations.apply.unchanged', { count: this._conversations.length });
      return this._conversations;
    }
    const selectedId = this.data.selectedConversationId;
    const conversations = (response.items || []).map((conversation, index) => ({
      ...conversation,
      selected: conversation.conversation_id === selectedId,
      unread: Boolean(conversation.unread),
      running: conversation.status === 'running',
      index
    }));
    this._conversations = conversations;
    this.setData({ conversationsSignature: response.signature || this.data.conversationsSignature });
    trace('conversations.apply.complete', {
      count: conversations.length,
      selectedConversationId: selectedId,
      hasSignature: Boolean(response.signature)
    });
    return conversations;
  },

  applyConversationSelectionStyles() {
    this.ensureRuntimeState();
    const conversations = this._conversations.map((conversation) => ({
      ...conversation,
      selected: conversation.conversation_id === this.data.selectedConversationId
    }));
    this._conversations = conversations;
    trace('conversations.selection_styles.applied', { selectedConversationId: this.data.selectedConversationId, count: conversations.length });
  },

  async selectConversationById(conversationId, options = {}) {
    this._chatScrollRequest = null;
    const startedAt = Date.now();
    trace('conversation.select.start', {
      conversationId,
      previousConversationId: this.data.selectedConversationId
    });
    this.closeConversationStream();
    this._serverMessageMap = new Map();
    this._serverMessageSeq = 0;
    // The draft flow discovers the conversation it just created; dropping the
    // optimistic message there would blank the user's just-sent bubble while
    // the desktop agent is still picking the conversation up.
    const keptPendingMessages = options.keepPendingMessages
      ? this._messages.filter((message) => String(message.id || '').indexOf('pending-') === 0)
      : [];
    this.setData({
      selectedConversationId: conversationId,
      messagesLoaded: false,
      messagesLoading: true,
      visibleChatItems: [],
      chatTopSpacerStyle: 'height: 0px;',
      chatProgressSegments: [],
      chatFocusIndex: 0,
      chatFocusId: '',
      chatScrollIntoView: '',
      // Entering a conversation anchors at the top of the loaded range so
      // reading (and arrow paging) runs top-down; the bottom is only followed
      // again once the user pages down to the newest message or sends.
      atBottom: false,
      approvalActions: [],
      approvalText: t('approval.requestDefault'),
      isRunning: false,
      taskId: ''
    });
    this.syncLoadingVisuals();
    this._messages = [];
    this._chatItems = [];
    this._chatAnchors = [];
    this._chatAnchorItemIndexes = [];
    this._chatLoadedStartIndex = 0;
    this._chatFocusItemIndex = 0;
    this._approval = null;
    this._approvalSignature = '';
    if (keptPendingMessages.length) this.applyMessages(keptPendingMessages, true);
    this.applyConversationSelectionStyles();
    // The stream carries an explicit conversation_id, so it can start while
    // the remote selection state is being persisted. This removes one full
    // request round trip from time-to-first-frame.
    const persistence = this.persistSelection(true);
    this.openConversationStream();
    if (!this.data.messagesLoaded) this.scheduleConversationLoadingFallback(conversationId);
    this._api.markRead(this.data.selectedHostId, this.data.selectedPluginId, conversationId)
      .then(() => this.clearInboxUnread(conversationId))
      .catch((error) => {
        trace('conversation.mark_read.error', { conversationId, ...errorDetails(error) });
      });
    const persisted = await persistence;
    if (this.data.selectedConversationId !== conversationId) {
      trace('conversation.select.superseded', { conversationId, durationMs: Date.now() - startedAt });
      return;
    }
    if (persisted && persisted.rejectedConversation) {
      // Server rejected this conversation (it vanished between listing and
      // selecting). Stop the speculative stream, clear the local selection,
      // and repair the stored one.
      trace('conversation.select.missing', { conversationId });
      this.closeConversationStream();
      this.clearConversationLoadingFallback();
      this.setData({ selectedConversationId: '', messagesLoading: false });
      this.syncLoadingVisuals();
      this.applyConversationSelectionStyles();
      await this.persistSelection(false);
      this.showToast(t('sync.conversationGone'), 5);
      trace('conversation.select.complete', { conversationId, durationMs: Date.now() - startedAt, cleared: true });
      return;
    }
    trace('conversation.select.complete', { conversationId, durationMs: Date.now() - startedAt });
  },

  async persistSelection(activateDesktop = false) {
    if (!this._api || !this.data.selectedHostId || !this.data.selectedPluginId) {
      trace('selection.persist.skipped', {
        hasApi: Boolean(this._api),
        selectedHostId: this.data.selectedHostId,
        selectedPluginId: this.data.selectedPluginId
      });
      return;
    }
    const startedAt = Date.now();
    trace('selection.persist.start', {
      hostId: this.data.selectedHostId,
      pluginId: this.data.selectedPluginId,
      conversationId: this.data.selectedConversationId || '',
      activateDesktop
    });
    try {
      await this._api.setSelection({
        selected_host_id: this.data.selectedHostId,
        selected_plugin_id: this.data.selectedPluginId,
        selected_conversation_id: this.data.selectedConversationId || '',
        activate_desktop: Boolean(activateDesktop && this.data.selectedConversationId)
      });
      trace('selection.persist.success', { durationMs: Date.now() - startedAt });
      return { ok: true, rejectedConversation: false };
    } catch (error) {
      trace('selection.persist.error', { durationMs: Date.now() - startedAt, ...errorDetails(error) });
      this.handleNetworkError(error, false);
      return { ok: false, rejectedConversation: isConversationMissingError(error) };
    }
  },

  startPolling() {
    this.stopPolling();
    const interval = Math.max(1500, Number(this.data.pollInterval || 3000));
    trace('poll.start', { interval });
    this._pollTimer = setInterval(async () => {
      if (!this._api || this.data.loading || this.data.listening || this._pollInFlight) {
        trace('poll.tick.skipped', {
          hasApi: Boolean(this._api),
          loading: this.data.loading,
          listening: this.data.listening
        });
        return;
      }
      this._pollInFlight = true;
      try {
        trace('poll.tick.start', { tick: this._agentPollTick + 1, surface: this.data.surface });
        if (!this._convStream && this.data.selectedHostId && this.data.selectedPluginId && this.data.selectedConversationId) {
          this.openConversationStream();
        }
        this._agentPollTick += 1;
        if (this._agentPollTick % 4 === 0) {
          await this.refreshCatalog();
        }
        trace('poll.tick.complete', { tick: this._agentPollTick });
      } finally {
        this._pollInFlight = false;
      }
    }, interval);
  },

  async refreshCatalog() {
    trace('poll.catalog.start', { tick: this._agentPollTick });
    try {
      const plugins = await this._api.getHostPlugins(this.data.agentsSignature);
      this.applyHostPlugins(plugins);
      if (this.data.agents.some((item) => item.connected && item.available)) this.setConnectionGuide(false);
      const selectedAgent = this.data.agents.find((item) =>
        item.host_id === this.data.selectedHostId && item.plugin_id === this.data.selectedPluginId);
      if (selectedAgent && selectedAgent.connected && selectedAgent.available) {
        const conversations = await this._api.getConversationIndex(
          this.data.selectedHostId, this.data.selectedPluginId, this.data.conversationsSignature);
        const updatedConversations = this.applyConversations(conversations);
        if (!this.data.selectedConversationId && updatedConversations.length) {
          await this.selectConversationById(updatedConversations[0].conversation_id);
        }
      }
      await this.refreshInboxCatalog();
      trace('poll.catalog.complete', {
        tick: this._agentPollTick,
        pluginCount: this.data.agents.length,
        conversationCount: this._conversations.length
      });
    } catch (error) {
      trace('poll.catalog.error', { tick: this._agentPollTick, ...errorDetails(error) });
      this.handleNetworkError(error);
    }
  },

  async refreshInboxCatalog() {
    this.ensureRuntimeState();
    if (!this._api) return;
    if (!this._inboxCatalog) this._inboxCatalog = new Map();
    const selectedUid = `${this.data.selectedHostId}::${this.data.selectedPluginId}`;
    const jobs = [];
    for (const agent of this.data.agents) {
      if (!(agent.connected && agent.available)) continue;
      if (agent.uid === selectedUid && this.data.selectedHostId && this.data.selectedPluginId) {
        // The selected agent's index is refreshed by applyConversations; reuse
        // it here instead of issuing a second request for the same data. A
        // plugin switch can temporarily leave that active index empty while
        // the presence cache warms up, so retain the last usable inbox data.
        const previous = this._inboxCatalog.get(agent.uid) || { signature: '', items: [] };
        const selectedItems = Array.isArray(this._conversations) ? this._conversations : [];
        if (selectedItems.length || !(previous.items || []).length) {
          this._inboxCatalog.set(agent.uid, {
            signature: this.data.conversationsSignature || previous.signature,
            items: selectedItems
          });
        } else {
          trace('inbox.catalog.selected_cache_retained', { uid: agent.uid, count: previous.items.length });
        }
        continue;
      }
      const entry = this._inboxCatalog.get(agent.uid);
      jobs.push({
        agent,
        request: this._api.getConversationIndex(agent.host_id, agent.plugin_id, entry && entry.signature || '')
      });
    }
    if (jobs.length) {
      const results = await Promise.allSettled(jobs.map((job) => job.request));
      results.forEach((result, index) => {
        const job = jobs[index];
        if (result.status !== 'fulfilled') {
          trace('inbox.catalog.error', { uid: job.agent.uid, ...errorDetails(result.reason) });
          return;
        }
        const response = result.value || {};
        const previous = this._inboxCatalog.get(job.agent.uid) || { signature: '', items: [] };
        let items = response.items || [];
        const retained = !items.length && (previous.items || []).length
          && (response.changed === false || response.source === 'presence_cache_pending');
        if (retained) {
          // Per the API contract the server returns an empty list while the
          // snapshot is not ready; keep the last known items. The previous
          // signature must be kept too: adopting the response signature for
          // content we did not take would make later conditional requests
          // report "unchanged" and pin the stale inbox forever.
          items = previous.items;
        }
        this._inboxCatalog.set(job.agent.uid, {
          signature: retained ? previous.signature : (response.signature || previous.signature),
          items
        });
      });
    }
    this.rebuildInbox();
    trace('inbox.catalog.refreshed', { agents: this.data.agents.length, fetched: jobs.length });
  },

  rebuildInbox(preferredItemId = '') {
    const catalog = this._inboxCatalog || new Map();
    const rawItems = buildInboxItems(catalog, this.data.agents, Date.now(), this._statusDotPulsePhase || 0);
    let focusIndex = -1;
    if (this.data.surface === 'inbox' && rawItems.length) {
      const previousItem = this.data.inboxItems[this.data.focusIndex] || {};
      const firstUnread = rawItems.find((item) => item.unread) || rawItems[0];
      const targetId = preferredItemId || previousItem.id || firstUnread.id;
      focusIndex = rawItems.findIndex((item) => item.id === targetId);
      if (focusIndex < 0) focusIndex = 0;
    }
    const inboxItems = decorateInbox(rawItems, focusIndex);
    const patch = {
      inboxItems,
      inboxProgressSegments: buildListProgressSegments(inboxItems, focusIndex, 'inbox')
    };
    if (focusIndex >= 0) {
      patch.focusIndex = focusIndex;
      patch.inboxFocusId = rawItems[focusIndex].anchorId;
      patch.inboxScrollTop = inboxScrollTopForFocus(
        rawItems,
        focusIndex,
        this.data.inboxScrollTop,
        this.data.inboxViewportHeight
      );
    }
    this.setData(patch);
    trace('inbox.rebuild', { count: rawItems.length, focusIndex, unread: rawItems.filter((item) => item.unread).length });
    return rawItems;
  },

  clearInboxUnread(conversationId) {
    if (!this._inboxCatalog || !conversationId) return;
    let changed = false;
    for (const [uid, entry] of this._inboxCatalog) {
      const items = entry.items || [];
      if (!items.some((item) => item.conversation_id === conversationId && item.unread)) continue;
      this._inboxCatalog.set(uid, {
        ...entry,
        items: items.map((item) => item.conversation_id === conversationId ? { ...item, unread: false } : item)
      });
      changed = true;
    }
    if (changed) {
      trace('inbox.unread.cleared', { conversationId });
      this.rebuildInbox();
    }
  },

  stopPolling() {
    const wasActive = Boolean(this._pollTimer);
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (wasActive) trace('poll.stop');
  },

  refreshInboxTimeLabels() {
    if (!this.data.inboxItems.length) return;
    const now = Date.now();
    // Relative labels and day-group membership both drift as the clock moves,
    // so the periodic refresh re-runs the group layout (labels + offsets).
    this.setData({
      inboxItems: applyInboxGroupLayout(this.data.inboxItems.map((item) => ({
        ...item,
        timeLabel: relativeTimeLabel(item.updated_at, now)
      })), now)
    });
  },

  refreshStatusDotPulse() {
    if (this.data.surface !== 'inbox') return;
    const items = this.data.inboxItems;
    if (!items.some((item) => item.running)) return;
    this._statusDotPulsePhase = ((Number(this._statusDotPulsePhase) || 0) + 1) % STATUS_DOT_PULSE_CLASSES.length;
    this.setData({
      inboxItems: items.map((item) => item.running
        ? { ...item, statusDotClass: statusDotClass(item, this._statusDotPulsePhase) }
        : item)
    });
  },

  async goToInbox() {
    this._chatScrollRequest = null;
    trace('inbox.panel.open.request', { count: this.data.inboxItems.length, fromSurface: this.data.surface });
    this.clearConversationLoadingFallback();
    // Returning home must be immediate. Preserve the last known list and
    // refresh in the background; blocking on a slow Agent made the whole
    // application appear blank.
    this.setData({
      surface: 'inbox',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      inboxLoading: false,
      chatClass: chatLayoutClass(this.data.planVisible, true, true)
    });
    this.rebuildInbox();
    this.syncLoadingVisuals();
    try {
      await this.refreshInboxCatalog();
    } catch (error) {
      // Keep any already-cached items usable when a refresh is unavailable.
      trace('inbox.panel.open.refresh_error', errorDetails(error));
    }
    const firstUnread = this.data.inboxItems.find((item) => item.unread);
    const inboxItems = this.rebuildInbox(firstUnread ? firstUnread.id : '');
    if (this.data.surface === 'inbox' && !inboxItems.length) {
      trace('inbox.panel.open.empty');
      this.showToast(t('inbox.noRecentMessages'), 5);
    }
    const focused = inboxItems[this.data.focusIndex] || {};
    trace('inbox.panel.open.complete', {
      focusIndex: this.data.focusIndex,
      itemId: focused.id || '',
      unread: Boolean(focused.unread)
    });
  },
};
