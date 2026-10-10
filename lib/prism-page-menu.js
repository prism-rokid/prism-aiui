// Menu, focus, and panel methods: menu building/open/close/back, focus
// movement across surfaces, the settings/control panels, and the approval
// panel with its activation dispatch.

import { trace, errorDetails, inputTrace, performanceTimestamp, performanceTrace } from './prism-trace.js';
import { decorate, decorateMenu, buildListProgressSegments } from './prism-chat-model.js';
import { inboxScrollTopForFocus } from './prism-inbox-model.js';
import { controlOptionItems, compactDisplayText } from './prism-labels.js';
import { menuButton } from './prism-icons.js';
import { chatLayoutClass, MENU_CLASS_VISIBLE, MENU_CLASS_HIDDEN } from './prism-surfaces.js';
import { t } from './prism-i18n.js';

// Panel titles for the controls surface; unmapped scopes keep their raw id.
const CONTROL_TITLE_KEYS = {
  modelReasoning: 'controls.title.modelReasoning',
  reasoning: 'controls.title.reasoning',
  permission: 'controls.title.permission',
  actions: 'controls.title.actions'
};

export function createMenuMethods({ readableError }) {
  return {

  rebuildMenu(resetFocus = false) {
    // The menu never offers a 新消息 button: the inbox is the home surface,
    // reachable through the back key.
    const buttons = [];
    if (this.data.surface === 'quick') {
      // Single-tap quick menu on the conversation page. 停止任务 only exists
      // while the agent is working; the menu itself is dismissed by 隐藏菜单.
      if (this.data.isRunning) buttons.push(menuButton('stop', t('menu.stopTask')));
      buttons.push(menuButton('hideMenu', t('menu.hideMenu')));
      buttons.push(menuButton('voice', t('menu.voiceInput')));
    } else if (this.data.surface === 'voice') {
      // While recording, the menu carries only the stop affordance; a single
      // tap stops the recording.
      buttons.push(menuButton('stopVoice', t('menu.doneSpeaking')));
    } else if (this.data.failedDraft) {
      buttons.push(menuButton('retry', t('menu.retry')));
      buttons.push(menuButton('voice', t('menu.voiceInput')));
    } else if (this._approval && this.data.approvalActions.length) {
      buttons.push(menuButton('approval', t('menu.approve')));
    } else if (this.data.isRunning) {
      buttons.push(menuButton('stop', t('menu.stop')));
    }
    else if (this.data.draftText) {
      buttons.push(menuButton('send', t('menu.send')));
      buttons.push(menuButton('voice', t('menu.voiceInput')));
      buttons.push(menuButton('undo', t('menu.undoInput')));
      if (this.data.restoredDraft) buttons.push(menuButton('redo', t('menu.restore')));
    } else if (this.data.restoredDraft) {
      buttons.push(menuButton('redo', t('menu.restore')));
      buttons.push(menuButton('voice', t('menu.voiceInput')));
    } else {
      buttons.push(menuButton('voice', t('menu.voiceInput')));
    }
    let focusIndex = Math.min(this.data.focusIndex, Math.max(0, buttons.length - 1));
    if (resetFocus) {
      if (this.data.surface === 'quick' && this.data.isRunning) {
        // Opening the quick menu mid-run prioritizes 停止任务.
        focusIndex = 0;
      } else {
        const voiceIndex = buttons.findIndex((item) => item.id === 'voice');
        focusIndex = voiceIndex >= 0 ? voiceIndex : 0;
      }
    }
    const menuSignature = `${this.data.surface}:${focusIndex}:${buttons.map((item) => item.id).join('|')}`;
    if (menuSignature === this._menuSignature) return;
    this._menuSignature = menuSignature;
    // The visible menu list owns the focus ring on the menu surface and on
    // the voice surface, where the focused ⏹ 停止 button must render labeled.
    const menuFocusIndex = this.data.surface === 'menu' || this.data.surface === 'voice' || this.data.surface === 'quick'
      ? focusIndex
      : -1;
    this.setData({ focusIndex, menuButtons: decorateMenu(buttons, menuFocusIndex) });
    trace('menu.rebuild', { surface: this.data.surface, focusIndex, actions: buttons.map((item) => item.id).join(',') });
  },

  openMenu() {
    trace('menu.open', { fromSurface: this.data.surface, previousFocusIndex: this.data.focusIndex });
    this.setData({
      surface: 'menu',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      previousFocusIndex: this.data.focusIndex,
      chatClass: chatLayoutClass(this.data.planVisible, false, true)
    });
    this.rebuildMenu(true);
    this.syncLoadingVisuals();
  },

  // The conversation page's single-tap menu: 停止任务 (while running),
  // 隐藏菜单, 语音输入. It rides the same bottom menu chrome as the action
  // menu but keeps its own surface so contextual menu flows stay untouched.
  openQuickMenu() {
    trace('menu.quick.open', { fromSurface: this.data.surface, isRunning: this.data.isRunning });
    this.setData({
      surface: 'quick',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      previousFocusIndex: this.data.focusIndex,
      chatClass: chatLayoutClass(this.data.planVisible, false, true)
    });
    this.rebuildMenu(true);
    this.syncLoadingVisuals();
  },

  closeMenu() {
    trace('menu.close', { fromSurface: this.data.surface, listening: this.data.listening });
    const recognitionStartCancelled = this.cancelPendingRecognitionStart('menu_closed');
    if (!recognitionStartCancelled && this.data.listening && this._recognition) {
      this._recognition.abort();
    }
    this._draftHistory = [];
    this._draftFuture = [];
    this._voiceBaseDraft = '';
    this._lastSessionTranscript = '';
    this.setData({
      surface: 'main',
      menuVisible: false,
      menuClass: MENU_CLASS_HIDDEN,
      focusIndex: this.data.previousFocusIndex || 0,
      listening: false,
      recognizing: false,
      draftText: '',
      restoredDraft: '',
      voiceHint: '',
      chatClass: chatLayoutClass(this.data.planVisible)
    });
    this.rebuildMenu();
    this.syncLoadingVisuals();
  },

  backOneLevel() {
    trace('navigation.back_one_level', { surface: this.data.surface });
    if (this.data.surface === 'menu' || this.data.surface === 'quick') {
      this.closeMenu();
      return;
    }
    if (this.data.surface === 'voice') {
      const recognitionStartCancelled = this.cancelPendingRecognitionStart('navigate_back');
      if (!recognitionStartCancelled && this._recognition) this._recognition.abort();
      this.setData({ listening: false, recognizing: false, draftText: this._voiceBaseDraft || '', voiceHint: '' });
    }
    this.openMenu();
  },

  moveMenuFocus(direction) {
    const count = this.data.menuButtons.length;
    if (!count) {
      trace('menu.focus.skipped', { direction, reason: 'empty' });
      return;
    }
    const previousIndex = this.data.focusIndex;
    const focusIndex = (previousIndex + direction + count) % count;
    this.setData({ focusIndex, menuButtons: decorateMenu(this.data.menuButtons, focusIndex) });
    trace('menu.focus.move', {
      direction,
      previousIndex,
      focusIndex,
      action: this.data.menuButtons[focusIndex] && this.data.menuButtons[focusIndex].id || ''
    });
  },

  moveSurfaceFocus(direction) {
    const performanceStartedAt = performanceTimestamp();
    const configuration = {
      menu: { key: 'menuButtons', className: 'prism-menu-button' },
      quick: { key: 'menuButtons', className: 'prism-menu-button' },
      voice: { key: 'menuButtons', className: 'prism-menu-button' },
      inbox: { key: 'inboxItems', className: 'prism-inbox-choice' },
      controls: { key: 'controlItems', className: 'prism-control-choice' },
      approval: { key: 'approvalActions', className: 'prism-menu-button' }
    }[this.data.surface];
    if (!configuration) {
      performanceTrace('focus.skipped', { surface: this.data.surface, direction, reason: 'unsupported_surface' });
      return false;
    }
    const items = this.data[configuration.key] || [];
    if (!items.length) {
      performanceTrace('focus.skipped', { surface: this.data.surface, direction, reason: 'empty', itemKey: configuration.key });
      return false;
    }
    const previousFocusIndex = this.data.focusIndex;
    const focusIndex = (previousFocusIndex + direction + items.length) % items.length;
    const patch = { focusIndex };
    if (configuration.key === 'inboxItems') {
      const focusedItem = items[focusIndex] || {};
      patch.inboxFocusId = focusedItem.anchorId || '';
      patch.inboxScrollTop = inboxScrollTopForFocus(
        items,
        focusIndex,
        this.data.inboxScrollTop,
        this.data.inboxViewportHeight
      );
    }
    // Apply preview bindings before the repeated collection. Ink can warn
    // while diffing an ink:for list; the focused label must still update in
    // the same key event without waiting for activation.
    patch[configuration.key] = configuration.key === 'menuButtons'
      ? decorateMenu(items, focusIndex)
      : decorate(items, focusIndex, configuration.className);
    if (configuration.key === 'inboxItems') {
      patch.inboxProgressSegments = buildListProgressSegments(patch.inboxItems, focusIndex, 'inbox');
    }
    const setDataStartedAt = performanceTimestamp();
    this.setData(patch);
    const completedAt = performanceTimestamp();
    performanceTrace('focus.commit', {
      surface: this.data.surface,
      direction,
      itemKey: configuration.key,
      itemCount: items.length,
      previousFocusIndex,
      focusIndex,
      inboxScrollTop: patch.inboxScrollTop,
      setDataMs: Number((completedAt - setDataStartedAt).toFixed(3)),
      totalMs: Number((completedAt - performanceStartedAt).toFixed(3))
    });
    this.scheduleInputPerformanceProbes('focus', {
      expectedSurface: this.data.surface,
      expectedFocusIndex: focusIndex,
      expectedInboxScrollTop: patch.inboxScrollTop
    });
    inputTrace('focus.move', null, this.data.surface, `index=${focusIndex}`);
    return true;
  },

  openControls(scope) {
    trace('controls.panel.open.request', { scope, selectedConversationId: this.data.selectedConversationId });
    if (!this.data.selectedConversationId) {
      trace('controls.panel.open.unavailable', { scope, reason: 'no_conversation' });
      this.showToast(t('controls.noSession'), 5);
      return;
    }
    let items = [];
    if (scope === 'model') items = controlOptionItems(this._modelOptions, 'model.switch', this.data.currentModelId);
    if (scope === 'reasoning') items = controlOptionItems(this._reasoningOptions, 'reasoning.switch', this.data.currentReasoningId);
    if (scope === 'modelReasoning') {
      items = controlOptionItems(this._modelOptions, 'model.switch', this.data.currentModelId)
        .map((item) => ({ ...item, label: t('controls.modelPrefix', { label: item.label }) }));
      items = items.concat(controlOptionItems(this._reasoningOptions, 'reasoning.switch', this.data.currentReasoningId)
        .map((item) => ({ ...item, label: t('controls.reasoningPrefix', { label: item.label }) })));
    }
    if (scope === 'permission') items = controlOptionItems(this._permissionOptions, 'permission.switch', this.data.currentPermissionId);
    if (scope === 'actions') {
      items = (this._detailActions || []).map((item) => ({
        ...item,
        id: item.id || item.action_id || '',
        label: item.label || item.title || item.id || '',
        action: item.id || item.action_id || '',
        target: item.target && typeof item.target === 'object' ? item.target : {},
        name: item.name || ''
      })).filter((item) => item.id && item.available !== false && item.action !== 'rename');
    }
    items = items.map((item) => ({
      ...item,
      selected: Boolean(item.selected) || item.action === 'model.switch' && item.id === this.data.currentModelId
        || item.action === 'reasoning.switch' && item.id === this.data.currentReasoningId
        || item.action === 'permission.switch' && item.id === this.data.currentPermissionId
    }));
    if (!items.length) {
      trace('controls.panel.open.unavailable', { scope, reason: 'empty' });
      this.showToast(t('controls.noSettings'), 5);
      return;
    }
    let focusIndex = items.findIndex((item) => item.selected);
    if (focusIndex < 0) focusIndex = 0;
    const titleKey = CONTROL_TITLE_KEYS[scope];
    this.setData({
      surface: 'controls',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      controlScope: scope,
      controlTitle: titleKey ? t(titleKey) : scope,
      focusIndex,
      controlItems: decorate(items, focusIndex, 'prism-control-choice'),
      chatClass: chatLayoutClass(this.data.planVisible, false, true)
    });
    trace('controls.panel.open.complete', { scope, focusIndex, itemCount: items.length });
  },

  openModel(event) {
    inputTrace('tap.topbar.model', event, this.data.surface);
    this.openControls('modelReasoning');
  },

  openReasoning(event) {
    inputTrace('tap.topbar.reasoning', event, this.data.surface);
    this.openControls('reasoning');
  },

  openPermission(event) {
    inputTrace('tap.topbar.permission', event, this.data.surface);
    this.openControls('permission');
  },

  openActions(event) {
    inputTrace('tap.topbar.actions', event, this.data.surface);
    this.openControls('actions');
  },

  handleLocationTap(event) {
    inputTrace('tap.topbar.location', event, this.data.surface);
  },

  // The approval panel is shown both from the menu's 审批 entry and on its own
  // whenever a request arrives while the conversation is on screen. Auto
  // opening only interrupts plain conversation reading and its light menus;
  // voice recording, the settings dialog, and the inbox keep their flow and
  // still reach 审批 through the menu.
  presentApprovalPanel() {
    const fromSurface = this.data.surface;
    if (fromSurface !== 'main' && fromSurface !== 'menu' && fromSurface !== 'quick' && fromSurface !== 'approval') {
      trace('approval.panel.auto_open.skipped', { fromSurface });
      return;
    }
    trace('approval.panel.present', { fromSurface, actionCount: (this.data.approvalActions || []).length });
    this.setData({
      surface: 'approval',
      menuVisible: true,
      menuClass: MENU_CLASS_VISIBLE,
      focusIndex: 0,
      approvalActions: decorate(this.data.approvalActions, 0, 'prism-menu-button'),
      chatClass: chatLayoutClass(this.data.planVisible, false, true)
    });
    this.syncLoadingVisuals();
  },

  async resolveApprovalAction(action) {
    const approval = this._approval || {};
    const requestId = approval.approval_request_id || approval.id || '';
    const actionId = action && action.id || '';
    if (!requestId || !actionId) {
      trace('approval.resolve.skipped', { actionId, reason: 'missing_request_or_action' });
      this.showToast(t('approval.unavailable'), 5);
      return;
    }
    const startedAt = Date.now();
    trace('approval.resolve.start', { actionId, requestId, conversationId: this.data.selectedConversationId });
    try {
      await this._api.resolveApproval(
        this.data.selectedHostId,
        this.data.selectedPluginId,
        this.data.selectedConversationId,
        requestId,
        actionId,
        { task_id: this.data.taskId, input: action.input || '' }
      );
      this.setData({ surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN });
      this.showToast(t('approval.submitted'), 5);
      trace('approval.resolve.success', { actionId, durationMs: Date.now() - startedAt });
    } catch (error) {
      trace('approval.resolve.error', { actionId, durationMs: Date.now() - startedAt, ...errorDetails(error) });
      this.showToast(t('approval.failed', { error: compactDisplayText(readableError(error), 12) }), 7);
    }
  },

  async activateMenuAction(action) {
    trace('menu.action.activate', { action, focusIndex: this.data.focusIndex });
    if (action === 'voice') this.startVoiceInput({ ignoreInitialStop: true });
    if (action === 'stopVoice') this.stopVoiceInput();
    if (action === 'hideMenu') this.closeMenu();
    if (action === 'inbox') await this.goToInbox();
    if (action === 'send' || action === 'retry') await this.sendDraft();
    if (action === 'stop') await this.interruptRun();
    if (action === 'undo') this.undoDraft();
    if (action === 'redo') this.redoDraft();
    if (action === 'approval') this.presentApprovalPanel();
  },

  async activateFocused() {
    const index = this.data.focusIndex;
    trace('focus.activate', { surface: this.data.surface, index });
    if (this.data.surface === 'menu' || this.data.surface === 'quick') {
      const item = this.data.menuButtons[index];
      trace('focus.activate.menu', { index, action: item && item.id || '', found: Boolean(item) });
      if (item) await this.activateMenuAction(item.id);
      return;
    }
    if (this.data.surface === 'voice') {
      trace('focus.activate.voice');
      if (this._ignoreNextVoiceStop) {
        this._ignoreNextVoiceStop = false;
        trace('voice.input.stop.ignored', { reason: 'start_activation_tail' });
        return;
      }
      this.stopVoiceInput();
      return;
    }
    if (this.data.surface === 'inbox') {
      const item = this.data.inboxItems[index];
      if (!item) {
        trace('focus.activate.inbox.missing', { index });
        return;
      }
      trace('focus.activate.inbox', { index, hostId: item.host_id, pluginId: item.plugin_id, conversationId: item.conversation_id });
      try {
        // Keep the conversation screen mounted throughout the selection and
        // initial stream load, preventing a completed loading state from
        // flashing the inbox between the two renders.
        this.setData({ surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN, chatClass: chatLayoutClass(this.data.planVisible) });
        if (item.host_id !== this.data.selectedHostId || item.plugin_id !== this.data.selectedPluginId) {
          await this.loadPlugin(item.host_id, item.plugin_id, item.conversation_id);
        } else {
          await this.selectConversationById(item.conversation_id);
        }
      } catch (error) {
        trace('focus.activate.inbox.error', { index, ...errorDetails(error) });
        this.handleNetworkError(error);
        this.setData({ messagesLoading: false });
        this.syncLoadingVisuals();
        this.goToInbox();
      }
      return;
    }
    if (this.data.surface === 'controls') {
      const item = this.data.controlItems[index];
      if (!item) {
        trace('focus.activate.control.missing', { index });
        return;
      }
      const startedAt = Date.now();
      trace('focus.activate.control', { index, action: item.action, target: item.target || {} });
      try {
        await this._api.control(
          this.data.selectedHostId,
          this.data.selectedPluginId,
          this.data.selectedConversationId,
          item.action,
          item.target || {},
          item.name || '',
          this.data.taskId
        );
        this.setData({ surface: 'main', menuVisible: false, menuClass: MENU_CLASS_HIDDEN });
        this.showToast(t('controls.submitted'), 4);
        trace('focus.activate.control.success', { action: item.action, durationMs: Date.now() - startedAt });
      } catch (error) {
        trace('focus.activate.control.error', { action: item.action, durationMs: Date.now() - startedAt, ...errorDetails(error) });
        this.showToast(t('controls.submitFailed', { error: compactDisplayText(readableError(error), 12) }), 6);
      }
      return;
    }
    if (this.data.surface === 'approval') {
      const item = this.data.approvalActions[index];
      trace('focus.activate.approval', { index, actionId: item && item.id || '', found: Boolean(item) });
      if (item) await this.resolveApprovalAction(item);
    }
  },
  };
}
