import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  describeDeviceCredential,
  formatDeviceAccountToken,
  requestDeviceCredential
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

test('the index page and the shared widget runtime acquire runtime credentials instead of reading a configured token', async () => {
  const pageSources = await Promise.all([
    readFile(new URL('../pages/index/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/prism-widget-runtime.js', import.meta.url), 'utf8')
  ]);

  for (const page of pageSources) {
    assert.match(page, /requestDeviceCredential\(\)/);
    assert.match(page, /formatDeviceAccountToken\(credential\)/);
    assert.match(page, /describeDeviceCredential\(credential\)/);
    assert.doesNotMatch(page, /describeLocalPrismDebugAuth|env\.json/);
    assert.doesNotMatch(page, /tokenPreview|credential\.token/);
    assert.doesNotMatch(page, /authorization:\s*formatDeviceAuthorization/);
    assert.doesNotMatch(page, /PRISM_DEBUG_AUTH\.accessToken/);
  }
  // The page may load the local env.json override for the API base URL only;
  // widgets always use the packaged default and never read the local token.
  assert.doesNotMatch(pageSources[0], /config\.accountToken/);
  assert.doesNotMatch(pageSources[1], /loadPrismDebugAuth/);
});
