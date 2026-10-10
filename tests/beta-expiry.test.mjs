import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePageConfig, readPageBundle } from './helpers/page-loader.mjs';
import { BETA_EXPIRY_AT, isBetaExpired } from '../lib/prism-expiry.js';

function createPageInstance(config) {
  const page = Object.create(config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function setData(patch) {
    Object.assign(this.data, patch);
  };
  return page;
}

function withFakeNow(now, fn) {
  const original = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = original;
  }
}

async function createExpiredPage() {
  // Pin zh-CN through wx-backed storage: onLoad re-runs initI18n({ wx }) and
  // would otherwise follow the host environment's navigator language.
  const config = await evaluatePageConfig({
    getStorageSync: () => 'zh-CN',
    setStorageSync() {}
  });
  const page = createPageInstance(config);
  withFakeNow(BETA_EXPIRY_AT, () => page.onLoad());
  return page;
}

test('the beta deadline flips at local midnight on 2027-01-01', () => {
  const boundary = new Date(BETA_EXPIRY_AT);
  assert.equal(boundary.getFullYear(), 2027);
  assert.equal(boundary.getMonth(), 0);
  assert.equal(boundary.getDate(), 1);
  assert.equal(boundary.getHours(), 0);

  assert.equal(isBetaExpired(BETA_EXPIRY_AT - 1), false, 'still usable the night before');
  assert.equal(isBetaExpired(BETA_EXPIRY_AT), true, 'expired exactly at the boundary');
  assert.equal(isBetaExpired(BETA_EXPIRY_AT + 1), true);
  assert.equal(isBetaExpired(NaN), false, 'a broken clock must never brick the page');
});

test('an expired launch shows the notice and skips every feature boot', async () => {
  const page = await createExpiredPage();

  assert.equal(page.data.betaExpired, true);
  assert.equal(page.data.text.boot.betaExpiredTitle, '内测时间已结束');
  assert.equal(page.data.text.boot.betaExpiredHint, '请前往智能体商店安装正式版本');

  // No configuration promise, API client, recognition session, or timer is
  // ever created: nothing beyond the notice can run or reach the network.
  assert.equal(page._configurationPromise, undefined);
  assert.equal(page._api, undefined);
  assert.equal(page._recognition, undefined);
  assert.equal(page._pollTimer, undefined);
  assert.equal(page._inboxTimeTimer, undefined);
  assert.equal(page._statusDotPulseTimer, undefined);

  // Lifecycle hooks must stay safe against the uninitialized fields.
  page.onHide();
  page.onUnload();
});

test('input events are neutralized while expired', async () => {
  const page = await createExpiredPage();

  // Backspace keeps the host default (exit) instead of being swallowed.
  let prevented = false;
  page.onKeyUp({ code: 'Backspace', preventDefault() { prevented = true; } });
  assert.equal(prevented, false);

  // Arrows never move chat focus.
  const focusBefore = page.data.chatFocusIndex;
  page.onKeyDown({ code: 'ArrowDown' });
  page.onKeyUp({ code: 'ArrowDown', preventDefault() {} });
  assert.equal(page.data.chatFocusIndex, focusBefore);

  // Voice wakeup never reaches the recognition pipeline.
  let starts = 0;
  page.startVoiceInput = () => { starts += 1; };
  page.onVoiceWakeup({ preventDefault() {} });
  assert.equal(starts, 0);
});

test('before the deadline the page boots normally', async () => {
  const config = await evaluatePageConfig();
  const page = createPageInstance(config);
  assert.equal(page.data.betaExpired, false, 'data contract starts unexpired');

  withFakeNow(BETA_EXPIRY_AT - 1, () => page.onLoad());
  assert.equal(page.data.betaExpired, false);
  assert.ok(page._configurationPromise, 'configuration hydration still runs');
  assert.equal(page._inboxTimeTimer !== undefined, true);

  page.onUnload();
});

test('the expiry notice covers every feature layer in the template', async () => {
  const bundle = await readPageBundle();

  assert.match(bundle, /class="prism-beta-expired" ink:if="\{\{betaExpired\}\}"/);
  assert.match(bundle, /\{\{text\.boot\.betaExpiredTitle\}\}/);
  assert.match(bundle, /\{\{text\.boot\.betaExpiredHint\}\}/);
  assert.match(bundle, /\.prism-beta-expired\s*\{[^}]*z-index:\s*40/s, 'sits above the z-index 30 loading overlay');
  assert.match(bundle, /\.prism-beta-expired\s*\{[^}]*background-color:\s*var\(--color-background\)/s, 'fully hides the UI beneath it');
});
