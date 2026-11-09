// 委托卡片：把用户请求原文交给端上语言模型理解，分派给远程智能体并发
// 送。卡片只占两行（标题+状态/进度点一行，请求摘要或结果一行），充分节
// 省对话流屏幕空间；boot 路径与桌面 Widget 一致（i18n → 设备认证 →
// Prism API），LanguageModel 由运行时动态解析后注入调度器。文案与类名全
// 部在 JS 预计算，WXML 只做简单绑定。

import wx from 'wx';
import { createPrismApi, PRODUCTION_API_BASE_URL, readableError } from '../../lib/prism-api.js';
import { resolveAccountCredential } from '../../lib/prism-device-auth.js';
import { LOCAL_DEBUG_AUTH } from '../../lib/prism-local-token.js';
import { createDelegateRunner } from '../../lib/prism-delegate.js';
import { truncateDisplayText } from '../../lib/widget-data.js';
import { initI18n, t, buildTextMap } from '../../lib/prism-i18n.js';

const PHASE_STEP = { understanding: 0, matching: 1, sending: 2 };
const REQUEST_TITLE_UNITS = 40;
const RESULT_TITLE_UNITS = 40;

function buildDots(stepIndex) {
  return [0, 1, 2].map((index) => ({
    className: index < stepIndex ? 'delegate-dot-done' : (index === stepIndex ? 'delegate-dot-active' : '')
  }));
}

export default {
  data: {
    text: {},
    requestText: '',
    requestClassName: 'delegate-request',
    statusVisible: true,
    dotsVisible: true,
    dots: [],
    statusText: ''
  },

  async onLoad(query) {
    initI18n({ wx });
    this._destroyed = false;
    const requestText = String(query && query.request || '').trim();
    this.setData({
      text: buildTextMap(),
      requestText: truncateDisplayText(requestText, REQUEST_TITLE_UNITS),
      dots: buildDots(PHASE_STEP.understanding),
      statusText: t('delegate.understanding')
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

  applyPhase(phase, detail = {}) {
    if (this._destroyed) return;
    if (phase === 'done') {
      const conversationLabel = detail.isNewConversation || !detail.conversationTitle
        ? t('delegate.newConversation')
        : detail.conversationTitle;
      this.setData({
        statusVisible: false,
        dotsVisible: false,
        requestText: truncateDisplayText(
          `✓ ${t('delegate.done', { agent: detail.agent || '', conversation: conversationLabel })}`,
          RESULT_TITLE_UNITS
        ),
        requestClassName: 'delegate-request delegate-request-done'
      });
      return;
    }
    if (phase === 'error') {
      const reason = detail.code === 'noAgents' ? t('delegate.noAgents')
        : detail.code === 'missingRequest' ? t('delegate.missingRequest')
        : detail.code === 'authFailed' ? (detail.message || t('delegate.failed'))
        : t('delegate.failed');
      this.setData({
        statusVisible: false,
        dotsVisible: false,
        requestText: truncateDisplayText(`✕ ${reason}`, RESULT_TITLE_UNITS),
        requestClassName: 'delegate-request delegate-request-error'
      });
      return;
    }
    const stepIndex = PHASE_STEP[phase] || 0;
    this.setData({
      statusVisible: true,
      dotsVisible: true,
      dots: buildDots(stepIndex),
      statusText: t(`delegate.${phase}`)
    });
  }
};
