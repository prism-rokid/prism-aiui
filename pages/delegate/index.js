// 委托卡片：把用户请求原文交给端上语言模型理解，分派给远程智能体并发
// 送。状态展示走宿主原生 Agent Session Card（sendCard/updateCard，参考
// diagnostic.agentsessioncards）：Ink 页面本身零渲染、只作为执行体，完成
// 后 window.close()，对话流里只留下紧凑的原生卡片。原生卡片能力不可用
// 时回退为页面内的两行紧凑 UI。

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

function statusFor(phase, detail = {}) {
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
    return t('delegate.failed');
  }
  return t(`delegate.${phase}`);
}

export default {
  data: {
    text: {},
    fallbackVisible: false,
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
      this.enterFallback();
      this.applyPhase('error', { code: 'missingRequest' });
      return;
    }

    // 原生 Agent Session Card：先发一张初始状态卡，之后每阶段 update。
    this._nativeCard = null;
    try {
      const conversation = getApp().getAgent().conversation;
      this._nativeCard = await conversation.sendCard({
        title: t('delegate.title'),
        description: t('delegate.understanding')
      });
      console.log('[PrismDelegate]', JSON.stringify({ event: 'native_card.sent', id: this._nativeCard.id }));
    } catch (error) {
      console.warn('[PrismDelegate] native card unavailable', error && error.name, error && error.message);
      this.enterFallback();
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

  enterFallback() {
    if (this._destroyed) return;
    this.setData({ fallbackVisible: true });
  },

  applyPhase(phase, detail = {}) {
    if (this._destroyed) return;
    const isFinal = phase === 'done' || phase === 'error';
    const status = statusFor(phase, detail);

    if (this._nativeCard) {
      // 原生卡片承载全部状态；页面自身零渲染。
      this._nativeCard.update({
        title: t('delegate.title'),
        description: isFinal ? status : `${status} · ${this.data.requestText}`
      }).then(
        () => {
          if (!isFinal) return;
          console.log('[PrismDelegate]', JSON.stringify({ event: 'native_card.final', phase }));
          try { window.close(); } catch (error) { this.enterFallback(); }
        },
        (error) => {
          console.warn('[PrismDelegate] native card update failed', error && error.name, error && error.message);
          this.enterFallback();
          this.renderFallback(phase, detail, status, isFinal);
        }
      );
      return;
    }

    this.renderFallback(phase, detail, status, isFinal);
  },

  renderFallback(phase, detail, status, isFinal) {
    if (this._destroyed) return;
    this.enterFallback();
    if (isFinal) {
      this.setData({
        statusVisible: false,
        dotsVisible: false,
        requestText: truncateDisplayText(
          `${phase === 'done' ? '✓' : '✕'} ${status}`,
          RESULT_TITLE_UNITS
        ),
        requestClassName: `delegate-request ${phase === 'done' ? 'delegate-request-done' : 'delegate-request-error'}`
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
