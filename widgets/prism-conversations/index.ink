<script type="application/json" def>
{
  "widget": {
    "family": "1x1"
  }
}
</script>

<script setup>
import wx from 'wx';
import { createWidgetRuntime } from '../../lib/prism-widget-runtime.js';
import { buildWidgetSummary } from '../../lib/widget-data.js';
import { t } from '../../lib/prism-i18n.js';

const RUNNING_ICON_STEP_MS = 400;
const RUNNING_STATUS_SYMBOLS = Object.freeze(['✦', '✧']);

function titleUnitsForViewport(widget) {
  let width = widget ? Number(widget.hostWidth) : NaN;
  if (!Number.isFinite(width) || width <= 0) {
    if (!wx || typeof wx.getSystemInfoSync !== 'function') return 24;
    width = Number((wx.getSystemInfoSync() || {}).windowWidth);
  }
  if (!Number.isFinite(width)) return 24;
  // A 1x1 cell is ~233px; after the symbol column and padding ~195px remain
  // for text, which fits ~23 ASCII-width units at the 16px title font.
  return Math.max(18, Math.min(40, Math.floor(width / 10)));
}

export default {
  data: {
    loading: true,
    errorText: '',
    syncingLabel: '',
    emptyLabel: '',
    totalCount: 0,
    conversationItems: [],
    runningSymbol: RUNNING_STATUS_SYMBOLS[0]
  },

  onCreate() {
    this._runningIconTimer = null;
    this._runningSymbolIndex = 0;
    this._expiredSeen = false;
    this._runtime = createWidgetRuntime(wx, {
      onSnapshot: (snapshot) => this.applySnapshot(snapshot)
    });
    this.setData({
      syncingLabel: t('widget.syncing'),
      emptyLabel: t('widget.noConversations')
    });
    this._runtime.create();
  },

  onAttach() {
    // runtime.attach() flushes a pending expiry snapshot synchronously, so
    // _expiredSeen is already set before the symbol timer would start.
    this._runtime.attach();
    if (this._expiredSeen) return;
    if (!this._runningIconTimer) {
      this._runningIconTimer = setInterval(() => this.advanceRunningSymbol(), RUNNING_ICON_STEP_MS);
    }
  },

  onDetach() {
    this._runtime.detach();
    if (this._runningIconTimer) clearInterval(this._runningIconTimer);
    this._runningIconTimer = null;
  },

  onDestroy() {
    this._runtime.destroy();
    if (this._runningIconTimer) clearInterval(this._runningIconTimer);
    this._runningIconTimer = null;
  },

  applySnapshot(snapshot) {
    if (snapshot.status === 'expired') {
      // No decorative churn once the beta has ended.
      this._expiredSeen = true;
      if (this._runningIconTimer) clearInterval(this._runningIconTimer);
      this._runningIconTimer = null;
      this.setData({ loading: false, errorText: snapshot.errorText });
      return;
    }
    if (snapshot.status === 'error') {
      this.setData({ loading: false, errorText: snapshot.errorText });
      return;
    }
    if (snapshot.status !== 'ready') return;
    const summary = buildWidgetSummary(snapshot.records, titleUnitsForViewport(this));
    this.setData({
      loading: false,
      errorText: '',
      totalCount: summary.totalCount,
      conversationItems: summary.items
    });
  },

  advanceRunningSymbol() {
    this._runningSymbolIndex = (this._runningSymbolIndex + 1) % RUNNING_STATUS_SYMBOLS.length;
    this.setData({
      runningSymbol: RUNNING_STATUS_SYMBOLS[this._runningSymbolIndex]
    });
  }
};
</script>

<widget>
  <view class="widget-root">
    <view class="widget-conversation-list" ink:if="{{totalCount}}">
      <view ink:for="{{conversationItems}}" ink:key="id" class="conversation-row">
        <text class="row-symbol row-symbol-running" ink:if="{{item.marker === 'running'}}">{{runningSymbol}}</text>
        <text class="row-symbol row-symbol-unread" ink:elif="{{item.marker === 'unread'}}">✦</text>
        <text class="row-symbol row-symbol-recent" ink:else>·</text>
        <text class="conversation-title {{item.marker === 'recent' ? 'conversation-title-quiet' : ''}}">{{item.title}}</text>
      </view>
    </view>
    <text class="widget-state-label" ink:elif="{{loading}}">{{syncingLabel}}</text>
    <text class="widget-state-label" ink:elif="{{errorText}}">{{errorText}}</text>
    <text class="widget-state-label" ink:else>{{emptyLabel}}</text>
  </view>
</widget>

<style>
.widget-root {
  --widget-primary: var(--color-primary);
  --widget-muted: var(--color-primary-60);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background-color: var(--color-background);
  color: var(--widget-primary);
  padding: 6px 8px;
}

.widget-conversation-list {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  justify-content: flex-end;
  gap: 10px;
  min-height: 0;
  padding: 1px 0;
}

.conversation-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-symbol {
  width: 14px;
  flex-shrink: 0;
  font-family: sans-serif;
  font-size: 16px;
  line-height: 18px;
  color: var(--widget-primary);
}

.row-symbol-unread { opacity: 0.6; }
.row-symbol-recent { opacity: 0.4; }

.conversation-title {
  min-width: 0;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  font-family: sans-serif;
  font-size: 16px;
  line-height: 18px;
  font-weight: 600;
  color: var(--widget-primary);
}

.conversation-title-quiet { font-weight: 400; opacity: 0.75; }

.widget-state-label {
  font-family: sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: var(--widget-muted);
  margin: auto 0;
}

@media (max-width: 400px) {
  .conversation-title { font-size: 14px; line-height: 16px; }
}

@media (max-height: 120px) {
  .widget-root { padding: 3px 6px; }
  .widget-conversation-list { gap: 6px; }
  .conversation-title { font-size: 14px; line-height: 15px; }
  .row-symbol { width: 12px; font-size: 14px; line-height: 15px; }
}
</style>
