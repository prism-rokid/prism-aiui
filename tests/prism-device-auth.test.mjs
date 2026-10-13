import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  describeDeviceCredential,
  formatDeviceAccountToken,
  requestDeviceCredential,
  resolveAccountCredential
} from '../lib/prism-device-auth.js';

test('caches a device credential in memory and refreshes it after expiry', async () => {
  const realNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  let calls = 0;
  const runtimeNavigator = {
    requestDeviceToken(...args) {
      calls += 1;
      assert.equal(args.length, 0, 'Prism does not invent a nonce without a server challenge');
      return Promise.resolve({ token: `opaque-${calls}`, tokenType: ' Bearer ', expiresAt: Date.now() + 60_000 });
    }
  };

  try {
    const first = await requestDeviceCredential(runtimeNavigator);
    const second = await requestDeviceCredential(runtimeNavigator);

    assert.deepEqual(first, { token: 'opaque-1', tokenType: 'Bearer', expiresAt: 61_000 });
    assert.deepEqual(second, first);
    assert.equal(calls, 1, 'the helper should reuse a valid in-memory credential');
    assert.equal(formatDeviceAccountToken(first), 'opaque-1');

    now = 61_000;
    const refreshed = await requestDeviceCredential(runtimeNavigator);
    assert.equal(refreshed.token, 'opaque-2');
    assert.equal(calls, 2, 'an expired credential must be refreshed');
  } finally {
    Date.now = realNow;
  }
});

test('deduplicates concurrent credential requests for one Ink runtime', async () => {
  let calls = 0;
  let resolveToken;
  const runtimeNavigator = {
    requestDeviceToken() {
      calls += 1;
      return new Promise((resolve) => {
        resolveToken = resolve;
      });
    }
  };

  const firstRequest = requestDeviceCredential(runtimeNavigator);
  const secondRequest = requestDeviceCredential(runtimeNavigator);
  assert.equal(calls, 0, 'the request starts on the next microtask');
  await Promise.resolve();
  assert.equal(calls, 1);

  resolveToken({ token: 'opaque', tokenType: 'Bearer' });
  const [first, second] = await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(first, { token: 'opaque', tokenType: 'Bearer' });
  assert.deepEqual(second, first);
  assert.notEqual(first, second, 'callers receive independent credential objects');
});

test('rejects when the Ink navigator cannot provide a device token', async () => {
  await assert.rejects(
    requestDeviceCredential({}),
    (error) => error
      && error.code === 'DEVICE_TOKEN_UNAVAILABLE'
      && error.message === 'navigator.requestDeviceToken is not available in this runtime.'
  );
});

test('summarizes a credential without exposing its token', () => {
  const summary = describeDeviceCredential({ token: 'opaque-secret', tokenType: ' Bearer ' });
  assert.deepEqual(summary, { tokenType: 'Bearer', tokenLength: 13 });
  assert.equal('token' in summary, false);
});

test('keeps the legacy Prism account-token header value separate from token type', () => {
  assert.equal(
    formatDeviceAccountToken({ token: 'opaque-device-token', tokenType: 'access_token' }),
    'opaque-device-token'
  );
});

test('rejects malformed device token credentials', async () => {
  await assert.rejects(
    requestDeviceCredential({ requestDeviceToken: async () => ({ token: '', tokenType: 'Bearer' }) }),
    (error) => error && error.code === 'DEVICE_TOKEN_INVALID'
  );

  assert.throws(
    () => describeDeviceCredential({ token: 'opaque', tokenType: '' }),
    (error) => error && error.code === 'DEVICE_TOKEN_INVALID'
  );

  await assert.rejects(
    requestDeviceCredential({ requestDeviceToken: async () => ({ token: 'opaque', tokenType: 'Bearer', expiresAt: -1 }) }),
    (error) => error && error.code === 'DEVICE_TOKEN_INVALID'
  );
});

test('resolveAccountCredential prefers the device credential over the local token', async () => {
  const runtimeNavigator = {
    requestDeviceToken: async () => ({ token: 'opaque-device-token', tokenType: 'Bearer' })
  };
  const resolved = await resolveAccountCredential({ accountToken: 'local-debug-token' }, runtimeNavigator);
  assert.deepEqual(resolved, {
    accountToken: 'opaque-device-token',
    summary: { tokenType: 'Bearer', tokenLength: 19 }
  });
});

test('resolveAccountCredential falls back to the env.json token only without an Ink navigator', async () => {
  const resolved = await resolveAccountCredential({ accountToken: '  local-debug-token  ' }, {});
  assert.deepEqual(resolved, {
    accountToken: 'local-debug-token',
    summary: { tokenType: 'env.json', tokenLength: 17 }
  });
  assert.equal('token' in resolved.summary, false, 'the summary must stay safe for logs');
});

test('resolveAccountCredential falls back to the pack-time local token for debug builds', async () => {
  const injected = { baseUrl: 'https://ai-cloud-test.rokid.com/prism/api', accountToken: 'injected-token' };
  const resolved = await resolveAccountCredential({}, {}, injected);
  assert.deepEqual(resolved, {
    accountToken: 'injected-token',
    summary: { tokenType: 'local-token', tokenLength: 14 }
  });

  // The env.json token wins over the injection when both exist.
  const both = await resolveAccountCredential({ accountToken: 'env-token' }, {}, injected);
  assert.equal(both.accountToken, 'env-token');
  assert.equal(both.summary.tokenType, 'env.json');

  // Without any local credential the original device error propagates.
  const refused = { requestDeviceToken: async () => Promise.reject(new Error('NotAllowedError')) };
  await assert.rejects(
    resolveAccountCredential({}, refused, {}),
    (error) => error.message === 'NotAllowedError'
  );
});

test('pages and widgets resolve credentials through one helper; raw tokens stay inside it', async () => {
  const pageSource = await readFile(new URL('../pages/index/index.js', import.meta.url), 'utf8');
  const widgetSource = await readFile(new URL('../lib/prism-widget-runtime.js', import.meta.url), 'utf8');

  assert.match(pageSource, /resolveAccountCredential\(envConfig\)/);
  assert.match(widgetSource, /resolveAccountCredential\(\)/);
  // Token values may only be read inside prism-device-auth.js's fallback.
  assert.doesNotMatch(pageSource, /config\.accountToken|LOCAL_DEBUG_AUTH\.accountToken/);
  assert.doesNotMatch(widgetSource, /LOCAL_DEBUG_AUTH\.accountToken/);
  // Widgets never fetch the local env.json (the Ink runtime cannot).
  assert.doesNotMatch(widgetSource, /loadPrismDebugAuth|env\.json/);
  for (const source of [pageSource, widgetSource]) {
    assert.doesNotMatch(source, /tokenPreview|credential\.token/);
    assert.doesNotMatch(source, /PRISM_DEBUG_AUTH\.accessToken/);
  }
});
