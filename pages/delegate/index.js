import wx from 'wx';
import { createPrismApi, PRODUCTION_API_BASE_URL, readableError } from '../../lib/prism-api.js';
import { resolveAccountCredential } from '../../lib/prism-device-auth.js';
import { LOCAL_DEBUG_AUTH } from '../../lib/prism-local-token.js';
import { createDelegateRunner } from '../../lib/prism-delegate.js';
import { findNewConversation, watchAgentReply } from '../../lib/prism-delegate-watch.js';
import { initI18n, t } from '../../lib/prism-i18n.js';

const STEP_KEYS = ['understanding', 'matching', 'sending', 'agentReplying', 'agentReplied'];
const LOCALIZED_ERRORS = ['missingRequest', 'noAgents', 'projectAmbiguous', 'projectUnavailable', 'intentUnavailable'];

function stepData(step, content) {
  const allDone = step === STEP_KEYS.length - 1;
  return {
    stepTitle: t(`delegate.${STEP_KEYS[step]}`),
    ...(content === undefined ? {} : { stepContent: content }),
    indicators: STEP_KEYS.map((_, index) => {
      const done = allDone || index < step;
      return {
        done,
        className: done ? 'delegate-ind-dot-done'
          : index === step ? 'delegate-ind-dot-active' : 'delegate-ind-dot-pending',
        lineClassName: index > 0 && (allDone || index <= step) ? 'delegate-ind-line-done' : ''
      };
    })
  };
}

export default {
  data: {
    title: '',
    indicators: [],
    stepTitle: '',
    stepContent: ''
  },

  onLoad(query) {
    initI18n({ wx });
    this._destroyed = false;
    this._delegateTarget = null;
    const requestText = String(query && query.request || '').trim();
    this.setData({ title: t('delegate.title'), ...stepData(0, '') });
    if (!requestText) {
      this.applyPhase('error', { code: 'missingRequest' });
      return;
    }

    const runner = createDelegateRunner({
      getApi: async () => {
        this._api = await this.createApi();
        return this._api;
      },
      getModel: () => this.resolveModel()
    });
    void runner.run(requestText, (phase, detail) => this.applyPhase(phase, detail));
  },

  onUnload() {
    this._destroyed = true;
    this._watcher?.stop();
  },

  // 对话流中的点击由宿主展开为全屏，页面在此接续导航。
  onTargetChanged(target) {
    if (target === '_blank') this.openConversation();
  },

  async createApi() {
    const apiBaseUrl = LOCAL_DEBUG_AUTH.baseUrl || PRODUCTION_API_BASE_URL;
    const { accountToken } = await resolveAccountCredential();
    return createPrismApi(wx, { baseUrl: apiBaseUrl, accountToken });
  },

  async resolveModel() {
    if (typeof LanguageModel !== 'undefined') return LanguageModel;
    return (await import('language-model')).LanguageModel;
  },

  applyPhase(phase, detail = {}) {
    if (this._destroyed) return;
    switch (phase) {
      case 'matching':
        this.setData(stepData(1, detail.summary || ''));
        break;
      case 'sending':
        this.setData(stepData(2));
        break;
      case 'verifying':
      case 'done': {
        const verifyDelivery = phase === 'verifying';
        if (verifyDelivery) {
          this.setData({ ...stepData(2, ''), stepTitle: t('delegate.verifying') });
        } else {
          this._delegateTarget = detail;
          this.setData(stepData(3, ''));
        }
        void this.startReplyWatch(detail, verifyDelivery);
        break;
      }
      case 'error': {
        if (detail.hostId) this._delegateTarget = detail;
        const reason = LOCALIZED_ERRORS.includes(detail.code) ? t(`delegate.${detail.code}`)
          : detail.code === 'authFailed' ? readableError(detail.error)
          : detail.message || t('delegate.failed');
        this.setData({
          stepTitle: t('delegate.failed'),
          stepContent: reason
        });
        break;
      }
    }
  },

  async startReplyWatch(target, verifyDelivery) {
    // 留出发送受理与开始监听之间的时间窗口。
    const sinceTs = (target.submission?.startedAt || Date.now()) - 30000;
    const isAborted = () => this._destroyed;
    const fallbackTitle = () => t(verifyDelivery && !target.conversationId
      ? 'delegate.unconfirmed' : 'delegate.sent');
    try {
      const conversationId = target.conversationId
        || await findNewConversation(this._api, {
          ...target, submission: verifyDelivery ? target.submission : undefined, sinceTs, isAborted
        });
      if (this._destroyed) return;
      if (!conversationId) {
        this.setData({ stepTitle: fallbackTitle(), stepContent: '' });
        return;
      }
      target.conversationId = conversationId;
      if (verifyDelivery) {
        this._delegateTarget = target;
        this.setData(stepData(3, ''));
      }
      this._watcher = watchAgentReply(this._api, {
        ...target,
        minCreatedAt: sinceTs,
        onText: (text) => {
          if (!this._destroyed) this.setData({ stepContent: text });
        },
        onCompleted: (text) => {
          if (!this._destroyed) this.setData(stepData(4, text));
        },
        onError: (message) => {
          if (!this._destroyed) this.setData({ stepTitle: t('delegate.sent') });
          console.warn('[PrismDelegate] reply watch failed', message);
        }
      });
    } catch (error) {
      if (!this._destroyed) this.setData({ stepTitle: fallbackTitle() });
      console.warn('[PrismDelegate] reply watch setup failed', error && error.message || error);
    }
  },

  openConversation() {
    const target = this._delegateTarget;
    if (this._destroyed || !target || this._opening) return;
    this._opening = true;
    const params = target.conversationId
      ? `?host=${encodeURIComponent(target.hostId)}&plugin=${encodeURIComponent(target.pluginId)}&conversation=${encodeURIComponent(target.conversationId)}`
      : '';
    wx.navigateTo({
      url: `/pages/index/index${params}`,
      complete: () => { this._opening = false; }
    });
  }
};
