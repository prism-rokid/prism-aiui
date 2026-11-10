// 委托卡片（设计稿形态）：左上 Prism logo + 标题，右上五步指示器
// （✓ 完成 / 圆环当前 / 实心待处理，短线相连），下方当前步骤标题 +
// 50% 透明度内容。内容来源：前三步是调度器的 AI 流式分析文本，第四步
// 起监视被委托会话的状态流，实时展示 Agent 流式回复，回复完成后进入
// 第五步。委托受理（或失败已定位目标）后进入面板对话页：宿主会吞掉
// 对话流卡片的点击用于展开全屏，页面拿不到该事件，因此在展开瞬间
// （onTargetChanged('_blank')）直接 navigateTo 面板，全屏卡片只是一
// 闪而过的中转；全屏态下页面能收到点击，作为兜底入口。文案与类名全
// 部在 JS 预计算，WXML 只做简单绑定。

import wx from 'wx';
import { createPrismApi, PRODUCTION_API_BASE_URL, readableError } from '../../lib/prism-api.js';
import { resolveAccountCredential } from '../../lib/prism-device-auth.js';
import { LOCAL_DEBUG_AUTH } from '../../lib/prism-local-token.js';
import { createDelegateRunner } from '../../lib/prism-delegate.js';
import { findNewConversation, watchAgentReply } from '../../lib/prism-delegate-watch.js';
import { truncateDisplayText } from '../../lib/widget-data.js';
import { initI18n, t, buildTextMap } from '../../lib/prism-i18n.js';

const STEP_KEYS = ['understanding', 'matching', 'sending', 'agentReplying', 'agentReplied'];
const AI_DISPLAY_UNITS = 96;
const REPLY_DISPLAY_UNITS = 110;

// AI 流式文本只展示可读前导句：JSON 决策段以第一个 '{' 截断。
function aiForDisplay(rawText) {
  const text = String(rawText || '');
  const brace = text.indexOf('{');
  const readable = brace >= 0 ? text.slice(0, brace) : text;
  const trimmed = truncateDisplayText(readable.replace(/\s+$/, ''), AI_DISPLAY_UNITS);
  return brace >= 0 ? `${trimmed} …` : trimmed;
}

export default {
  data: {
    text: {},
    indicators: [],
    stepTitle: '',
    stepContent: ''
  },

  async onLoad(query) {
    initI18n({ wx });
    this._destroyed = false;
    this._stepIndex = 0;
    this._phase = '';
    this._aiText = '';
    this._replyText = '';
    this._delegateTarget = null;
    this._replySinceTs = 0;
    const requestText = String(query && query.request || '').trim();
    this.setData({
      text: buildTextMap(),
      indicators: this.buildIndicators(0),
      stepTitle: t('delegate.understanding'),
      stepContent: ''
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
    if (this._watcher && typeof this._watcher.stop === 'function') this._watcher.stop();
  },

  // 宿主展开全屏的瞬间：委托已受理（或失败已定位目标）就直接进入面
  // 板对话页，让「点卡片 → 对话页」一步到位，没有全屏中转页。
  onTargetChanged(target) {
    if (this._destroyed) return;
    if (target === '_blank' && this.canEnter()) {
      console.log('[PrismDelegate]', JSON.stringify({ event: 'target.blank.enter' }));
      this.openConversation();
    }
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

  buildIndicators(stepIndex) {
    // 全部步骤完成（最后一步已到达）时，五个点全部进入 check 完成态。
    const allDone = stepIndex >= STEP_KEYS.length - 1;
    return STEP_KEYS.map((key, index) => {
      const done = allDone || index < stepIndex;
      const active = !allDone && index === stepIndex;
      return {
        done,
        className: done ? 'delegate-ind-dot-done' : (active ? 'delegate-ind-dot-active' : 'delegate-ind-dot-pending'),
        lineClassName: index > 0 && (allDone || index <= stepIndex) ? 'delegate-ind-line-done' : ''
      };
    });
  },

  applyPhase(phase, detail = {}) {
    if (this._destroyed) return;
    if (phase === 'stream') {
      this._aiText = aiForDisplay(detail.text);
      if (this._stepIndex <= 2) this.setData({ stepContent: this._aiText });
      return;
    }

    if (phase === 'understanding' || phase === 'matching' || phase === 'sending') {
      const stepIndex = phase === 'understanding' ? 0 : (phase === 'matching' ? 1 : 2);
      this._stepIndex = stepIndex;
      this._phase = phase;
      this.setData({
        indicators: this.buildIndicators(stepIndex),
        stepTitle: t(`delegate.${phase}`),
        stepContent: this._aiText
      });
      return;
    }

    if (phase === 'done') {
      this._delegateTarget = {
        hostId: detail.hostId,
        pluginId: detail.pluginId,
        conversationId: detail.conversationId || ''
      };
      // 发送已受理：进入第四步并开始盯 Agent 回复。留 30 秒余量覆盖
      // 委托消息刚落地、卡片侧才挂流的窗口。
      this._replySinceTs = Date.now() - 30000;
      this.enterStep(3, t('delegate.agentReplying'), '');
      void this.startReplyWatch();
      return;
    }

    if (phase === 'error') {
      if (detail.hostId) {
        this._delegateTarget = {
          hostId: detail.hostId,
          pluginId: detail.pluginId,
          conversationId: detail.conversationId || ''
        };
      }
      this._phase = 'error';
      const reason = detail.code === 'noAgents' ? t('delegate.noAgents')
        : detail.code === 'missingRequest' ? t('delegate.missingRequest')
        : detail.code === 'authFailed' ? (detail.message || t('delegate.failed'))
        : (detail.message || t('delegate.failed'));
      this.setData({
        indicators: this.buildIndicators(this._stepIndex),
        stepTitle: t('delegate.failed'),
        stepContent: truncateDisplayText(reason, AI_DISPLAY_UNITS)
      });
    }
  },

  enterStep(stepIndex, title, content) {
    this._stepIndex = stepIndex;
    this._phase = STEP_KEYS[stepIndex] || this._phase;
    this.setData({
      indicators: this.buildIndicators(stepIndex),
      stepTitle: title,
      stepContent: content
    });
  },

  // 第四步：找到被委托会话并挂流，Agent 回复实时进内容区；回复完成
  // （或空闲/总超时兜底）进入第五步。
  async startReplyWatch() {
    const target = this._delegateTarget;
    if (!target || this._destroyed) return;
    try {
      let conversationId = target.conversationId;
      if (!conversationId) {
        const found = await findNewConversation(this._api, {
          hostId: target.hostId,
          pluginId: target.pluginId,
          sinceTs: this._replySinceTs,
          isAborted: () => this._destroyed
        });
        if (!found) {
          this.enterStep(4, t('delegate.agentReplied'), '');
          return;
        }
        conversationId = found.conversationId;
        target.conversationId = conversationId;
      }
      if (this._destroyed) return;
      this._watcher = watchAgentReply(this._api, {
        hostId: target.hostId,
        pluginId: target.pluginId,
        conversationId,
        minCreatedAt: this._replySinceTs,
        onText: (text) => {
          if (this._destroyed || this._stepIndex < 3) return;
          this._replyText = truncateDisplayText(String(text || ''), REPLY_DISPLAY_UNITS);
          this.setData({ stepContent: this._replyText });
        },
        onCompleted: (text) => {
          if (this._destroyed) return;
          this._replyText = truncateDisplayText(String(text || ''), REPLY_DISPLAY_UNITS);
          this.enterStep(4, t('delegate.agentReplied'), this._replyText);
        },
        onError: (message) => {
          if (this._destroyed) return;
          console.warn('[PrismDelegate] reply watch failed', message);
        },
        isAborted: () => this._destroyed
      });
    } catch (error) {
      console.warn('[PrismDelegate] reply watch setup failed', error && error.message || error);
    }
  },

  // 全屏态兜底入口：全屏卡片能收到页面点击，点击任意处进入对话页。
  // 对话流卡片态的点击被宿主用于展开，到不了页面。
  onCardTap() {
    const ready = this.canEnter();
    console.log('[PrismDelegate]', JSON.stringify({ event: 'card.tap', ready }));
    if (this._destroyed || !ready) return;
    this.openConversation();
  },

  canEnter() {
    return Boolean(this._delegateTarget)
      && (this._phase === 'done' || this._phase === 'error' || this._stepIndex >= 3);
  },

  // 把远程选中切到被委托的会话，再进入面板；面板启动时读取云端选中，
  // 即落在该智能体的对话页。
  async openConversation() {
    const target = this._delegateTarget;
    if (!target || this._opening) return;
    this._opening = true;
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
