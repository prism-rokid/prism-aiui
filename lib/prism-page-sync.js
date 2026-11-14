// Catalog and state sync methods: bootstrap, host plugin/conversation
// application, selection persistence, polling, and inbox catalog rebuilding.

import { trace, errorDetails, isConversationMissingError } from './prism-trace.js';
import { buildInboxItems, buildInboxView, refreshInboxLabels, statusDotClass, STATUS_DOT_PULSE_CLASSES } from './prism-inbox-model.js';
import { iconPath } from './prism-icons.js';
import { chatLayoutClass, MENU_CLASS_VISIBLE, MENU_CLASS_HIDDEN } from './prism-surfaces.js';
import { t } from './prism-i18n.js';

export const syncMethods = {

  async bootstrap() {
    if (!this._api || this._bootstrapping) {
      trace('bootstrap.skipped', { hasApi: Boolean(this._api), loading: this.data.loading });
      return;
    }
    const startedAt = Date.now();
    this._bootstrapping = true;
    trace('bootstrap.start');
    this.setData({ loading: true });
    this.syncLoadingVisuals();
    try {
      const pluginsResponse = await this._api.getHostPlugins();
      if (this._pageActive === false) return;
      const plugins = this.applyHostPlugins(pluginsResponse || {});
      const available = plugins.filter((plugin) => plugin.connected && plugin.available);
      const deepLink = this._deepLink;
      this._deepLink = null;
      let target = deepLink && available.find((plugin) =>
        (!deepLink.hostId || deepLink.hostId === plugin.host_id)
        && (!deepLink.pluginId || deepLink.pluginId === plugin.plugin_id)
        && ((deepLink.hostId && deepLink.pluginId) || plugin.selected_conversation_id === deepLink.conversationId));
      trace('bootstrap.catalog.loaded', {
        pluginCount: plugins.length,
        availableCount: available.length
      });
      this.setConnectionGuide(!available.length);
      if (!available.length) {
        if (!plugins.length) this.setData({ hostLabel: t('sync.noAgentAvailable') });
        return;
      }
      // A normal launch is read-only. Each index can make the inbox usable
      // while slower Agents are still responding. A deep link waits only for
      // its target index before opening the conversation.
      await this.refreshInboxCatalog(async (agent) => {
        if (target) {
          if (agent.uid !== target.uid) return;
          target = null;
          const entry = this._inboxCatalog.get(agent.uid);
          if (entry && entry.items.some((item) => item.conversation_id === deepLink.conversationId)) {
            trace('bootstrap.deeplink.chat', { durationMs: Date.now() - startedAt });
            await this.openInboxConversation(agent.host_id, agent.plugin_id, deepLink.conversationId);
            if (this._pageActive !== false && this.data.surface === 'main'
              && this.data.selectedHostId === agent.host_id && this.data.selectedPluginId === agent.plugin_id
              && !this.data.selectedConversationId) this.revealStartupInbox(startedAt);
            return;
          }
        }
        if (this.data.loading && this.data.inboxItems.length) this.revealStartupInbox(startedAt);
      });
      if (this._pageActive !== false && this.data.loading) this.revealStartupInbox(startedAt);
    } catch (error) {
      trace('bootstrap.error', { durationMs: Date.now() - startedAt, ...errorDetails(error) });
      if (this._pageActive !== false) this.handleNetworkError(error);
    } finally {
      this._bootstrapping = false;
      if (this._pageActive !== false) {
        if (this.data.loading) this.setData({ loading: false });
        this.syncLoadingVisuals();
        this.startPolling();
      }
      trace('bootstrap.complete', { durationMs: Date.now() - startedAt });
    }
  },

  revealStartupInbox(startedAt) {
    this.setData({
      loading: false,
      surface: 'inbox',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      chatClass: chatLayoutClass(this.data.planVisible, true, true)
    });
    this.syncLoadingVisuals();
    trace('bootstrap.inbox.home', { durationMs: Date.now() - startedAt, itemCount: this.data.inboxItems.length });
  },

  openInboxConversation(hostId, pluginId, conversationId) {
    this._inboxEntry = null;
    this.setData({
      loading: false,
      surface: 'main',
      inboxMotion: false,
      menuVisible: false,
      menuClass: MENU_CLASS_HIDDEN,
      chatClass: chatLayoutClass(this.data.planVisible)
    });
    if (hostId === this.data.selectedHostId && pluginId === this.data.selectedPluginId) {
      return this.selectConversationById(conversationId);
    }
    return this.loadPlugin(hostId, pluginId, conversationId);
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
    if (this.resetQuestionState) this.resetQuestionState();
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
    const cached = this._inboxCatalog && this._inboxCatalog.get(plugin.uid);
    const response = cached && preferredConversationId && plugin.connected && plugin.available
      && cached.items.some((item) => item.conversation_id === preferredConversationId)
      ? cached
      : await this._api.getConversationIndex(hostId, pluginId);
    if (this._pageActive === false || this.data.selectedHostId !== hostId || this.data.selectedPluginId !== pluginId) return;
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
    if (this.resetQuestionState) this.resetQuestionState();
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
    if (this._pageHidden) return;
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
      this.setConnectionGuide(!this.data.agents.some((item) => item.connected && item.available));
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

  async refreshInboxCatalog(onProgress) {
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
      jobs.push(this.refreshInboxAgent(agent).then(() => {
        if (onProgress && this._pageActive !== false) {
          this.rebuildInbox();
          return onProgress(agent);
        }
      }));
    }
    await Promise.all(jobs);
    if (this._pageActive === false) return;
    if (!onProgress || !jobs.length) this.rebuildInbox();
    trace('inbox.catalog.refreshed', { agents: this.data.agents.length, fetched: jobs.length });
  },

  refreshInboxAgent(agent) {
    if (!this._inboxCatalogRequests) this._inboxCatalogRequests = new Map();
    const { uid, host_id: hostId, plugin_id: pluginId } = agent;
    const pending = this._inboxCatalogRequests.get(uid);
    if (pending) return pending;
    const previous = this._inboxCatalog.get(uid);
    const startedAt = Date.now();
    const request = this._api.getConversationIndex(hostId, pluginId, previous && previous.signature || '')
      .then((result) => {
        if (this._pageActive === false || this._inboxCatalog.get(uid) !== previous
          || !this.data.agents.some((item) => item.uid === uid)) return;
        const response = result || {};
        const items = response.items || [];
        // Keep both the items and their signature while the server's snapshot
        // is pending, so the next conditional fetch can still update them.
        if (items.length || !(previous && previous.items.length)
          || (response.changed !== false && response.source !== 'presence_cache_pending')) {
          this._inboxCatalog.set(uid, { items, signature: response.signature || (previous && previous.signature) || '' });
        }
        trace('inbox.catalog.agent.loaded', { uid, count: items.length, durationMs: Date.now() - startedAt });
      })
      .catch((error) => trace('inbox.catalog.error', { uid, ...errorDetails(error) }))
      .finally(() => this._inboxCatalogRequests.delete(uid));
    this._inboxCatalogRequests.set(uid, request);
    return request;
  },

  rebuildInbox({ preferUnread = false } = {}) {
    const catalog = this._inboxCatalog || new Map();
    const items = buildInboxItems(catalog, this.data.agents, Date.now(), this._statusDotPulsePhase || 0);
    const targetId = this.data.inboxFocusedItem?.id;
    let focusIndex = preferUnread ? items.findIndex((item) => item.unread) : -1;
    if (focusIndex < 0) focusIndex = items.findIndex((item) => item.id === targetId);
    if (focusIndex < 0) {
      focusIndex = targetId && items.length ? 0 : items.findIndex((item) => item.unread);
      if (focusIndex < 0 && items.length) focusIndex = 0;
    }
    // Metadata-only updates leave an in-flight transition alone. A change in
    // card positions caused by the catalog takes effect without a slide.
    const oldItems = this.data.inboxItems;
    const samePositions = items[focusIndex]?.id === targetId && items.length === oldItems.length
      && items.every((item, index) => item.id === oldItems[index].id);
    const inInbox = this.data.surface === 'inbox';
    const patch = buildInboxView(items, focusIndex, inInbox && samePositions && this.data.inboxMotion);
    if (inInbox) patch.focusIndex = Math.max(0, focusIndex);
    this.setData(patch);
    trace('inbox.rebuild', { count: items.length, focusIndex, unread: items.filter((item) => item.unread).length });
    return items;
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
    const inboxItems = refreshInboxLabels(this.data.inboxItems, Date.now());
    this.setData({
      inboxItems,
      inboxFocusedItem: inboxItems.find((item) => item.id === this.data.inboxFocusedItem?.id) || null
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
    // Only this entry may apply the unread preference when its refresh ends.
    // A manual card switch cancels that preference.
    const entry = { manuallySelected: false };
    this._inboxEntry = entry;
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
    this.rebuildInbox({ preferUnread: true });
    this.syncLoadingVisuals();
    try {
      await this.refreshInboxCatalog();
    } catch (error) {
      // Keep any already-cached items usable when a refresh is unavailable.
      trace('inbox.panel.open.refresh_error', errorDetails(error));
    }
    if (this._inboxEntry !== entry) return;
    this._inboxEntry = null;
    if (this._pageActive === false || this.data.surface !== 'inbox') return;
    if (!entry.manuallySelected) this.rebuildInbox({ preferUnread: true });
    const inboxItems = this.data.inboxItems;
    if (!inboxItems.length) {
      trace('inbox.panel.open.empty');
      this.showToast(t('inbox.noRecentMessages'), 5);
    }
    const focused = this.data.inboxFocusedItem || {};
    trace('inbox.panel.open.complete', {
      focusIndex: this.data.focusIndex,
      itemId: focused.id || '',
      unread: Boolean(focused.unread)
    });
  },
};
