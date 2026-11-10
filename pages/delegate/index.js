// 委托卡片（高卡形态）：卡片内展示详细进度——三个步骤、AI 流式回复、
// 逐条日志，内容变化时自动滚动到底；在 _blank 全屏态提供「进入对话」，
// 通过 setSelection 把远程选中切到被委托的会话后 navigateTo 面板对话页。
// 原生 Agent Session Card 能力可用时状态同步到原生卡（当前运行时不可用，
// 自动回退到页内 UI）。文案与类名全部在 JS 预计算，WXML 只做简单绑定。

import wx from 'wx';
import { createPrismApi, PRODUCTION_API_BASE_URL, readableError } from '../../lib/prism-api.js';
import { resolveAccountCredential } from '../../lib/prism-device-auth.js';
import { LOCAL_DEBUG_AUTH } from '../../lib/prism-local-token.js';
import { createDelegateRunner } from '../../lib/prism-delegate.js';
import { truncateDisplayText } from '../../lib/widget-data.js';
import { initI18n, t, buildTextMap } from '../../lib/prism-i18n.js';

const PHASE_STEP = { understanding: 0, matching: 1, sending: 2 };
const REQUEST_TITLE_UNITS = 40;
const STREAM_DISPLAY_UNITS = 120;
// 结尾锚点双 id 交替：scroll-into-view 值不变不会重新滚动，内容增长时
// 交替锚点强制滚动条一直贴住底部。
const END_ANCHORS = ['delegate-end-a', 'delegate-end-b'];

function buildSteps(stepIndex) {
  return ['understanding', 'matching', 'sending'].map((phase, index) => ({
    label: t(`delegate.${phase}`),
    className: index < stepIndex ? 'delegate-dot-done' : (index === stepIndex ? 'delegate-dot-active' : ''),
    labelClassName: index <= stepIndex ? 'delegate-step-label-active' : ''
  }));
}

// AI 流式文本只展示可读前导句：JSON 决策段以第一个 '{' 截断。
function streamForDisplay(rawText) {
  const text = String(rawText || '');
  const brace = text.indexOf('{');
  const readable = brace >= 0 ? text.slice(0, brace) : text;
  const trimmed = truncateDisplayText(readable.replace(/\s+$/, ''), STREAM_DISPLAY_UNITS);
  return brace >= 0 ? `${trimmed} …` : trimmed;
}

export default {
  data: {
    text: {},
    requestText: '',
    steps: [],
    logs: [],
    streamText: '',
    streamVisible: false,
    scrollAnchorId: 'delegate-end-a',
    endAnchorId: END_ANCHORS[0],
    enterVisible: false,
    enterClassName: 'delegate-enter'
  },

  async onLoad(query) {
    initI18n({ wx });
    this._destroyed = false;
    this._logSeq = 0;
    this._anchorFlip = false;
    this._delegateTarget = null;
    this._phase = '';
    const requestText = String(query && query.request || '').trim();
    this.setData({
      text: buildTextMap(),
      requestText: truncateDisplayText(requestText, REQUEST_TITLE_UNITS),
      steps: buildSteps(PHASE_STEP.understanding)
    });
    if (!requestText) {
      this.applyPhase('error', { code: 'missingRequest' });
      return;
    }

    try {
      this._api = await this.createApi();
    } catch (error) {
      this.applyPhase('error', { code: 'authFailed', message: readableError(error) });
      return;
    }
    this._model = await this.resolveModel();
    this._runner = createDelegateRunner({
      api: this._api,
      model: this._model,
      log: (event, payload) => console.log('[PrismDelegate]', JSON.stringify({ event, ...payload }))
    });
    this._runner.run(requestText, (phase, detail) => this.applyPhase(phase, detail));
  },

  onUnload() {
    this._destroyed = true;
  },

  // _current 卡片容器 / _blank 全屏承载切换时由宿主回调。
  onTargetChanged(target) {
    if (this._destroyed) return;
    this.setData({ target });
    this.updateEnterVisible();
  },

  async createApi() {
    const apiBaseUrl = LOCAL_DEBUG_AUTH.baseUrl || PRODUCTION_API_BASE_URL;
    const { accountToken } = await resolveAccountCredential();
    return createPrismApi(wx, { baseUrl: apiBaseUrl, accountToken });
  },

  // 与 prism-device-auth 的 import('open') 相同模式：能力模块动态解析，
  // 缺失时保持 null，调度器自动走规则降级。
  async resolveModel() {
    try {
      const { LanguageModel } = await import('language-model');
      return LanguageModel;
    } catch (error) {
      console.warn('[PrismDelegate] language-model unavailable', error && error.message || error);
      return null;
    }
  },

  appendLog(text, className = '') {
    if (this._destroyed) return;
    this._logSeq += 1;
    const logs = this.data.logs.concat([{ id: `log-${this._logSeq}`, text, className }]);
    this.setData({ logs, ...this.scrollToEnd() });
  },

  // 每次内容变化都把结尾锚点换到另一个 id，让 scroll-into-view 重新生效。
  scrollToEnd() {
    this._anchorFlip = !this._anchorFlip;
    const endAnchorId = END_ANCHORS[this._anchorFlip ? 1 : 0];
    return { endAnchorId, scrollAnchorId: endAnchorId };
  },

  statusFor(phase, detail = {}) {
    if (phase === 'done') {
      const conversationLabel = detail.isNewConversation || !detail.conversationTitle
        ? t('delegate.newConversation')
        : detail.conversationTitle;
      return t('delegate.done', { agent: detail.agent || '', conversation: conversationLabel });
    }
    if (phase === 'error') {
      if (detail.code === 'noAgents') return t('delegate.noAgents');
      if (detail.code === 'missingRequest') return t('delegate.missingRequest');
      if (detail.code === 'authFailed') return detail.message || t('delegate.failed');
      return `${t('delegate.failed')}（${detail.message || ''}）`;
    }
    return t(`delegate.${phase}`);
  },

  applyPhase(phase, detail = {}) {
    if (this._destroyed) return;
    if (phase === 'stream') {
      this.setData({
        streamVisible: true,
        streamText: streamForDisplay(detail.text),
        ...this.scrollToEnd()
      });
      return;
    }

    const isFinal = phase === 'done' || phase === 'error';
    const status = statusFor(phase, detail);
    if (isFinal && detail.hostId) {
      this._delegateTarget = {
        hostId: detail.hostId,
        pluginId: detail.pluginId,
        conversationId: detail.conversationId || ''
      };
    }

    if (phase === 'done') {
      this.appendLog(`✓ ${status}`, 'delegate-log-done');
      this._phase = phase;
      this.updateEnterVisible();
      return;
    }
    if (phase === 'error') {
      this.appendLog(`✕ ${status}`, 'delegate-log-error');
      this._phase = phase;
      this.updateEnterVisible();
      return;
    }

    const stepIndex = PHASE_STEP[phase] || 0;
    this.setData({ steps: buildSteps(stepIndex) });
    if (this._phase !== phase) {
      this._phase = phase;
      this.appendLog(status);
    }
  },

  updateEnterVisible() {
    const enterVisible = this.data.target === '_blank'
      && Boolean(this._delegateTarget)
      && (this._phase === 'done' || this._phase === 'error');
    const patch = { enterVisible, enterClassName: 'delegate-enter' };
    if (enterVisible !== this.data.enterVisible) this.setData(patch);
  },

  // 全屏态「进入对话」：把远程选中切到被委托的会话，再进入面板。
  // 面板启动时读取云端选中，即落在该智能体的对话页。
  async openConversation() {
    const target = this._delegateTarget;
    if (!target || this._opening) return;
    this._opening = true;
    this.setData({ enterClassName: 'delegate-enter delegate-enter-active' });
    try {
      await this._api.setSelection({
        selected_host_id: target.hostId,
        selected_plugin_id: target.pluginId,
        selected_conversation_id: target.conversationId || '',
        activate_desktop: false
      });
    } catch (error) {
      console.warn('[PrismDelegate] setSelection failed', error && error.message || error);
    }
    wx.navigateTo({ url: '/pages/index/index' });
    this._opening = false;
  }
};
