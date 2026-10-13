<script type="application/json" def>
{
  "widget": {
    "family": "1x1"
  }
}
</script>

<script setup>
import wx from 'wx';
import { agentIconFor } from '../../lib/prism-api.js';
import { createWidgetRuntime } from '../../lib/prism-widget-runtime.js';
import {
  conversationCounts,
  nextUsageCandidate,
  selectedUsageCandidate,
  shouldRotateUsageCandidates,
  usageCandidates,
  usageRows
} from '../../lib/widget-data.js';
import { t } from '../../lib/prism-i18n.js';

const CAROUSEL_INTERVAL_MS = 5000;
const DEFAULT_ICON = '../../assets/icons/agent_icon/icon_agent_openai.svg';

function iconPath(agent) {
  return `../../assets/icons/agent_icon/icon_agent_${agentIconFor(agent)}.svg`;
}

export default {
  data: {
    loading: true,
    errorText: '',
    syncingLabel: '',
    workingLabel: '',
    unreadLabel: '',
    workingCount: 0,
    unreadCount: 0,
    usageAgentUid: '',
    usageAgentName: 'Agent',
    usageAgentIcon: DEFAULT_ICON,
    usageRows: usageRows(null)
  },

  onCreate() {
    this._candidates = [];
    this._carouselTimer = null;
    this._runtime = createWidgetRuntime(wx, {
      onSnapshot: (snapshot) => this.applySnapshot(snapshot)
    });
    this.setData({
      syncingLabel: t('widget.syncing'),
      workingLabel: t('widget.working'),
      unreadLabel: t('widget.unread')
    });
    this._runtime.create();
  },

  onAttach() {
    this._runtime.attach();
    if (!this._carouselTimer) {
      this._carouselTimer = setInterval(() => this.advanceUsageAgent(), CAROUSEL_INTERVAL_MS);
    }
  },

  onDetach() {
    this._runtime.detach();
    if (this._carouselTimer) clearInterval(this._carouselTimer);
    this._carouselTimer = null;
  },

  onDestroy() {
    this._runtime.destroy();
    if (this._carouselTimer) clearInterval(this._carouselTimer);
    this._carouselTimer = null;
  },

  applySnapshot(snapshot) {
    if (snapshot.status === 'error') {
      this.setData({ loading: false, errorText: snapshot.errorText });
      return;
    }
    if (snapshot.status !== 'ready') return;
    this._candidates = usageCandidates(snapshot.plugins);
    this.applyUsageAgent(selectedUsageCandidate(this._candidates, this.data.usageAgentUid));
    const counts = conversationCounts(snapshot.records);
    this.setData({
      loading: false,
      errorText: '',
      workingCount: counts.workingCount,
      unreadCount: counts.unreadCount
    });
  },

  applyUsageAgent(candidate) {
    if (!candidate) {
      this.setData({
        usageAgentUid: '',
        usageAgentName: 'Agent',
        usageAgentIcon: DEFAULT_ICON,
        usageRows: usageRows(null)
      });
      return;
    }
    this.setData({
      usageAgentUid: candidate.uid,
      usageAgentName: candidate.displayName,
      usageAgentIcon: iconPath(candidate),
      usageRows: usageRows(candidate)
    });
  },

  advanceUsageAgent() {
    if (!shouldRotateUsageCandidates(this._candidates)) return;
    this.applyUsageAgent(nextUsageCandidate(this._candidates, this.data.usageAgentUid));
  }
};
</script>

<widget>
  <view class="widget-root">
    <text class="widget-state-label" ink:if="{{errorText}}">{{errorText}}</text>
    <text class="widget-state-label" ink:elif="{{loading}}">{{syncingLabel}}</text>
    <view class="widget-body" ink:else>
      <view class="widget-agent-heading">
        <image class="agent-icon" src="{{usageAgentIcon}}" />
        <text class="agent-name">{{usageAgentName}}</text>
      </view>
      <view class="widget-usage-list">
        <view ink:for="{{usageRows}}" ink:key="id" class="usage-row">
          <text class="usage-window-label">{{item.label}}</text>
          <text class="usage-percent">{{item.percentLabel}}</text>
          <view class="usage-track"><view class="usage-track-fill" style="{{item.trackStyle}}"></view></view>
          <view class="usage-reset-group">
            <image class="usage-reset-icon" src="../../assets/icons/widget-reset.svg" />
            <text class="usage-reset-label">{{item.resetLabel}}</text>
          </view>
        </view>
      </view>
      <view class="widget-summary">
        <view class="summary-item">
          <image class="summary-icon" src="../../assets/icons/widget-zap.svg" />
          <text class="summary-label">{{workingLabel}}</text>
          <text class="summary-count">{{workingCount}}</text>
        </view>
        <view class="summary-item">
          <image class="summary-icon" src="../../assets/icons/widget-bell.svg" />
          <text class="summary-label">{{unreadLabel}}</text>
          <text class="summary-count">{{unreadCount}}</text>
        </view>
      </view>
    </view>
  </view>
</widget>

<style>
.widget-root {
  --widget-primary: var(--color-primary);
  --widget-muted: var(--color-primary-60);
  --widget-track: var(--color-primary-40);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background-color: var(--color-background);
  color: var(--widget-primary);
  padding: 6px 8px;
}

.widget-state-label {
  font-family: sans-serif;
  font-size: 14px;
  line-height: 18px;
  color: var(--widget-muted);
  margin: auto 0;
}

.widget-body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  min-height: 0;
}

.widget-agent-heading {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  opacity: 0.6;
  min-width: 0;
}

.agent-icon { width: 25px; height: 25px; flex-shrink: 0; }

.agent-name {
  min-width: 0;
  font-family: monospace;
  font-size: 22px;
  line-height: 25px;
  color: var(--widget-primary);
}

.widget-usage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.widget-summary {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 22px;
  padding-top: 4px;
}

.summary-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
}

.summary-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.6; }

.summary-label, .summary-count {
  font-family: sans-serif;
  font-size: 17px;
  line-height: 22px;
  font-weight: 600;
}

.summary-label { color: var(--widget-muted); }
.summary-count { color: var(--widget-primary); }

.usage-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.usage-window-label, .usage-percent, .usage-reset-label {
  font-family: monospace;
  color: var(--widget-primary);
  font-size: 16px;
  line-height: 18px;
}

.usage-window-label { color: var(--widget-muted); }
.usage-percent { font-size: 20px; line-height: 21px; }

.usage-track {
  height: 4px;
  min-width: 12px;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  border-radius: var(--radius-sm);
  background-color: var(--widget-track);
}

.usage-track-fill {
  height: 4px;
  border-radius: var(--radius-sm);
  background-color: var(--widget-primary);
}

.usage-reset-icon { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.6; }
.usage-reset-group { display: flex; flex-direction: row; align-items: center; flex-shrink: 0; }

@media (max-width: 400px) {
  .agent-name { font-size: 19px; line-height: 22px; }
  .usage-window-label, .usage-reset-label { font-size: 13px; line-height: 16px; }
  .usage-percent { font-size: 17px; line-height: 18px; }
  .summary-label, .summary-count { font-size: 14px; line-height: 18px; }
  .widget-summary { gap: 16px; }
}

@media (max-height: 120px) {
  .widget-root { padding: 3px 6px; }
  .agent-icon { width: 21px; height: 21px; }
  .agent-name { font-size: 19px; line-height: 21px; }
  .widget-usage-list { gap: 6px; }
  .usage-window-label, .usage-reset-label { font-size: 13px; line-height: 15px; }
  .usage-percent { font-size: 16px; line-height: 17px; }
  .usage-track, .usage-track-fill { height: 3px; }
  .usage-reset-icon { width: 13px; height: 13px; }
  .summary-label, .summary-count { font-size: 14px; line-height: 17px; }
  .summary-icon { width: 12px; height: 12px; }
  .widget-summary { gap: 16px; padding-top: 2px; }
}
</style>
