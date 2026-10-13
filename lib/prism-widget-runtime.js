// Shared boot/poll core for the Prism desktop widgets. Both widgets walk the
// same path (i18n -> beta-expiry gate -> device credential -> polling loop),
// so it lives here once; each widget only renders the snapshots it receives.
//
// Snapshot shape delivered to onSnapshot:
//   { status: 'loading' | 'ready' | 'error' | 'expired', errorText,
//     plugins, records: [{ agent, items }] }

import { createPrismApi } from './prism-api.js';
import { resolveAccountCredential } from './prism-device-auth.js';
import { PRISM_DEBUG_AUTH } from './prism-debug-config.js';
import { LOCAL_DEBUG_AUTH } from './prism-local-token.js';
import { mergeConversationSnapshot } from './widget-data.js';
import { initI18n, t } from './prism-i18n.js';
import { isBetaExpired } from './prism-expiry.js';

export const WIDGET_POLL_INTERVAL_MS = 3000;
export const WIDGET_FULL_REFRESH_INTERVAL_MS = 60000;

export function createWidgetRuntime(wx, options = {}) {
  const pollIntervalMs = options.pollIntervalMs || WIDGET_POLL_INTERVAL_MS;
  const fullRefreshIntervalMs = options.fullRefreshIntervalMs || WIDGET_FULL_REFRESH_INTERVAL_MS;

  const state = {
    destroyed: false,
    attached: false,
    expired: false,
    plugins: [],
    pluginSignature: '',
    conversationCache: new Map(),
    refreshing: false,
    loadedOnce: false,
    pollTimer: null,
    api: null,
    lastFullRefreshAt: 0
  };

  let latestSnapshot = null;
  let snapshotDelivered = true;

  function emit(snapshot) {
    latestSnapshot = snapshot;
    if (state.destroyed) return;
    if (!state.attached) {
      snapshotDelivered = false;
      return;
    }
    snapshotDelivered = true;
    try {
      if (typeof options.onSnapshot === 'function') options.onSnapshot(snapshot);
    } catch (error) {
      console.warn('[PrismWidget] snapshot handler failed', error && error.message || error);
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    refresh();
    state.pollTimer = setInterval(() => refresh(), pollIntervalMs);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function refresh() {
    if (!state.api || state.refreshing) return;
    state.refreshing = true;
    try {
      // Belt-and-braces against signature edge cases: once per minute drop the
      // known signatures so any client/server desync self-heals within one
      // cycle even if the conditional requests keep reporting "unchanged".
      const forceFull = Date.now() - state.lastFullRefreshAt >= fullRefreshIntervalMs;
      if (forceFull) state.lastFullRefreshAt = Date.now();

      const pluginResponse = await state.api.getHostPlugins(forceFull ? '' : state.pluginSignature);
      if (pluginResponse.changed !== false || !state.plugins.length) {
        state.plugins = Array.isArray(pluginResponse.items) ? pluginResponse.items : [];
      }
      state.pluginSignature = pluginResponse.signature || state.pluginSignature;

      const availableAgents = state.plugins.filter((agent) => agent && agent.connected && agent.available);
      const availableKeys = new Set(availableAgents.map((agent) => `${agent.host_id}::${agent.plugin_id}`));
      for (const key of state.conversationCache.keys()) {
        if (!availableKeys.has(key)) state.conversationCache.delete(key);
      }

      const indexes = await Promise.allSettled(availableAgents.map(async (agent) => {
        const key = `${agent.host_id}::${agent.plugin_id}`;
        const previous = state.conversationCache.get(key) || { signature: '', items: [] };
        const response = await state.api.getConversationIndex(
          agent.host_id,
          agent.plugin_id,
          forceFull ? '' : previous.signature
        );
        return { key, response, previous };
      }));
      for (const result of indexes) {
        if (result.status !== 'fulfilled') continue;
        const { key, response, previous } = result.value;
        state.conversationCache.set(key, mergeConversationSnapshot(response, previous));
      }

      state.loadedOnce = true;
      emit({
        status: 'ready',
        errorText: '',
        plugins: state.plugins,
        records: availableAgents.map((agent) => {
          const cache = state.conversationCache.get(`${agent.host_id}::${agent.plugin_id}`) || { items: [] };
          return { agent, items: cache.items };
        })
      });
    } catch (error) {
      console.warn('[PrismWidget] refresh failed', error && error.message || error);
      if (!state.loadedOnce) emit({ status: 'error', errorText: t('widget.syncFailed') });
    } finally {
      state.refreshing = false;
    }
  }

  return {
    create() {
      initI18n({ wx });
      state.lastFullRefreshAt = Date.now();

      // Beta deadline: once passed, the widget stops syncing and only reports
      // the expiry. No credential request, API client, or polling is created.
      if (isBetaExpired()) {
        state.expired = true;
        emit({ status: 'expired', errorText: t('boot.betaExpiredTitle') });
        this._configurationPromise = Promise.resolve(false);
        console.log('[PrismWidget]', JSON.stringify({ event: 'config.beta_expired' }));
        return;
      }

      if (options.api) {
        // Test/injection hook: run the polling loop against a caller-provided
        // client instead of the device-credential bootstrap.
        state.api = options.api;
        this._configurationPromise = Promise.resolve(true);
        return;
      }

      // The packaged default gateway wins unless a debug build injected a
      // relay target at pack time (lib/prism-local-token.js).
      const apiBaseUrl = LOCAL_DEBUG_AUTH.baseUrl || PRISM_DEBUG_AUTH.baseUrl;
      if (apiBaseUrl) {
        this._configurationPromise = resolveAccountCredential()
          .then(({ accountToken, summary: tokenSummary }) => {
            if (state.destroyed) return false;
            state.api = createPrismApi(wx, {
              baseUrl: apiBaseUrl,
              accountToken
            });
            console.log('[PrismWidget]', JSON.stringify({ event: 'config.auth_succeeded', ...tokenSummary }));
            if (state.attached) startPolling();
            return true;
          })
          .catch((error) => {
            if (state.destroyed) return false;
            emit({ status: 'error', errorText: t('boot.deviceAuthFailed') });
            console.log('[PrismWidget]', JSON.stringify({
              event: 'config.auth_failed',
              code: error && error.code || '',
              errorName: error && error.name || 'Error'
            }));
            return false;
          });
      } else {
        emit({ status: 'error', errorText: t('api.error.baseUrlMissing') });
        this._configurationPromise = Promise.resolve(false);
      }
    },

    attach() {
      state.attached = true;
      if (latestSnapshot && !snapshotDelivered) emit(latestSnapshot);
      // No polling while the beta has ended.
      if (state.expired) return;
      if (state.api) startPolling();
    },

    detach() {
      state.attached = false;
      stopPolling();
    },

    destroy() {
      state.destroyed = true;
      state.attached = false;
      stopPolling();
    },

    refresh
  };
}
