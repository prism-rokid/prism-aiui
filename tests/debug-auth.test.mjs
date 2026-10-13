import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LOCAL_TOKEN_TEMPLATE, normalizeTarget, parsePrismIdentities, pickPreviewIdentity } from '../dev/debug.mjs';
import { LOCAL_DEBUG_AUTH } from '../lib/prism-local-token.js';

const SAMPLE_CONFIG = `prism:
    region: cn
    identities:
        dev.cn:
            host_token: ht_dev
            account:
                user_id: A0C4
                name: R星人9CvIugJV6
                access_token: eyJdev
                login_at: "2026-08-17T21:33:56+08:00"
        test.cn:
            host_token: ht_test
            account:
                account_id: D201
                name: E-测试
                access_token: eyJtest
        prod.cn:
            account:
                name: "Prod User"
                access_token: 'eyJprod'
bridge:
    enabled: true
    plugins:
        claudecode:
            mode: mod
`;

test('parsePrismIdentities extracts account tokens and names per identity', () => {
  const identities = parsePrismIdentities(SAMPLE_CONFIG);
  assert.deepEqual(identities, {
    'dev.cn': { name: 'R星人9CvIugJV6', accessToken: 'eyJdev' },
    'test.cn': { name: 'E-测试', accessToken: 'eyJtest' },
    'prod.cn': { name: 'Prod User', accessToken: 'eyJprod' }
  });
  assert.ok(!JSON.stringify(identities).includes('ht_dev'), 'host tokens must not be picked up');
});

test('parsePrismIdentities tolerates missing, empty, and foreign documents', () => {
  assert.deepEqual(parsePrismIdentities('bridge:\n    enabled: true\n'), {});
  assert.deepEqual(parsePrismIdentities(''), {});
  assert.deepEqual(parsePrismIdentities('not: [valid: yaml'), {});
  const noAccount = parsePrismIdentities('prism:\n    identities:\n        prod.cn:\n            host_token: ht_only\n');
  assert.deepEqual(noAccount, { 'prod.cn': { name: '', accessToken: '' } });
});

test('pickPreviewIdentity pairs the relay target with its login', () => {
  const identities = parsePrismIdentities(SAMPLE_CONFIG);
  assert.equal(pickPreviewIdentity(identities, 'https://ai-cloud-test.rokid.com').accessToken, 'eyJtest');
  assert.equal(pickPreviewIdentity(identities, 'https://ai-cloud.rokid.com').accessToken, 'eyJprod');

  const devOnly = { 'dev.cn': { name: 'dev', accessToken: 'eyJdev' } };
  assert.equal(pickPreviewIdentity(devOnly, 'https://ai-cloud-test.rokid.com').accessToken, 'eyJdev');

  const empty = { 'prod.cn': { name: '', accessToken: '' } };
  assert.equal(pickPreviewIdentity(empty, 'https://ai-cloud-test.rokid.com'), null);
  assert.equal(pickPreviewIdentity({}, 'https://ai-cloud-test.rokid.com'), null);
});

test('normalizeTarget resolves doc-friendly aliases and trims full URLs', () => {
  assert.equal(normalizeTarget('production'), 'https://ai-cloud.rokid.com');
  assert.equal(normalizeTarget('PROD'), 'https://ai-cloud.rokid.com');
  assert.equal(normalizeTarget('test'), 'https://ai-cloud-test.rokid.com');
  assert.equal(normalizeTarget('https://custom.example.com///'), 'https://custom.example.com');
  // The alias must still pair with the matching Prism Hub login.
  const identities = { 'prod.cn': { name: 'p', accessToken: 'eyJprod' }, 'test.cn': { name: 't', accessToken: 'eyJtest' } };
  assert.equal(pickPreviewIdentity(identities, normalizeTarget('production')).accessToken, 'eyJprod');
});

test('the checked-in local token slot is empty and matches the restore template', async () => {
  assert.equal(LOCAL_DEBUG_AUTH.baseUrl, '');
  assert.equal(LOCAL_DEBUG_AUTH.accountToken, '');

  // A crashed `npm run debug` must never leave a credential behind: the
  // restore template has to reproduce the checked-in file exactly.
  const onDisk = await readFile(new URL('../lib/prism-local-token.js', import.meta.url), 'utf8');
  assert.equal(onDisk, LOCAL_TOKEN_TEMPLATE);
});
