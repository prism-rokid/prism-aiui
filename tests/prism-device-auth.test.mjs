import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  requestOpenServiceCredential,
  resolveAccountCredential
} from '../lib/prism-device-auth.js';

test('Open Service uses account.getToken without manual headers and only exposes a safe summary', async () => {
  const account = {
    async getToken(...args) {
      assert.equal(this, account);
      assert.deepEqual(args, []);
      return '  open-service-secret  ';
    }
  };
  const resolved = await resolveAccountCredential({ accountToken: 'debug-token' }, async () => ({ account }));
  assert.deepEqual(resolved, {
    accountToken: 'open-service-secret',
    summary: { tokenType: 'open-service', tokenLength: 19 }
  });
  assert.equal('token' in resolved.summary, false);
});

test('Open Service deduplicates concurrent requests and requests fresh tokens on later calls', async () => {
  let calls = 0;
  const getOpenService = async () => ({ account: {
    async getToken() { calls += 1; return `open-${calls}`; }
  } });
  const [page, widget] = await Promise.all([
    requestOpenServiceCredential(getOpenService),
    requestOpenServiceCredential(getOpenService)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(page, { token: 'open-1', tokenType: 'open-service' });
  assert.deepEqual(widget, page);
  assert.notEqual(widget, page);
  assert.equal((await requestOpenServiceCredential(getOpenService)).token, 'open-2');
});

test('Open Service rejects malformed tokens and permits a retry after failure', async () => {
  for (const token of ['', '  ', null, { token: 'not-the-documented-contract' }]) {
    await assert.rejects(
      requestOpenServiceCredential(async () => ({ account: { getToken: async () => token } })),
      { code: 'OPEN_SERVICE_TOKEN_INVALID' }
    );
  }
  let calls = 0;
  const unauthorized = new Error('Unauthorized');
  const getOpenService = async () => ({ account: { async getToken() {
    if (++calls === 1) throw unauthorized;
    return 'refreshed-token';
  } } });
  await assert.rejects(resolveAccountCredential({}, getOpenService), (error) => error === unauthorized);
  assert.equal((await resolveAccountCredential({}, getOpenService)).accountToken, 'refreshed-token');
});

test('local debug token is used only when Open Service authentication fails', async () => {
  const unavailable = async () => { throw new Error('Open Service offline'); };
  assert.deepEqual(await resolveAccountCredential({ accountToken: 'debug-token' }, unavailable), {
    accountToken: 'debug-token', summary: { tokenType: 'local-token', tokenLength: 11 }
  });
  await assert.rejects(resolveAccountCredential({}, unavailable), (error) => error.message === 'Open Service offline');
});

test('pages and widgets resolve credentials through one helper; raw tokens stay inside it', async () => {
  const pageSource = await readFile(new URL('../pages/index/index.js', import.meta.url), 'utf8');
  const widgetSource = await readFile(new URL('../lib/prism-widget-runtime.js', import.meta.url), 'utf8');
  const authSource = await readFile(new URL('../lib/prism-device-auth.js', import.meta.url), 'utf8');

  assert.match(pageSource, /resolveAccountCredential\(\)/);
  assert.match(widgetSource, /resolveAccountCredential\(\)/);
  assert.doesNotMatch(authSource, /requestDeviceToken/);
  assert.doesNotMatch(pageSource, /config\.accountToken|LOCAL_DEBUG_AUTH\.accountToken/);
  assert.doesNotMatch(widgetSource, /LOCAL_DEBUG_AUTH\.accountToken/);
  for (const source of [pageSource, widgetSource]) {
    assert.doesNotMatch(source, /tokenPreview|credential\.token/);
  }
});
