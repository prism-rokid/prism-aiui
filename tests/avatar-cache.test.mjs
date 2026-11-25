import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedAvatar } from '../lib/prism-avatar-cache.js';

test('头像并发下载一次，切换不会串图，重新打开按完整 URL 读取持久缓存', async (t) => {
  const entries = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value)
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  let finish;
  const request = t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  const view = () => ({ data: {}, setData(patch) { Object.assign(this.data, patch); } });
  const page = view(), widget = view();
  const avatar = { src: 'https://example.test/icon.png?v=1', isPng: true };
  assert.equal(cachedAvatar(page, 'icon', avatar).src, '');
  cachedAvatar(widget, 'icon', avatar);
  cachedAvatar(widget, 'icon', null);
  assert.equal(request.mock.callCount(), 1);
  finish(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  await new Promise(resolve => setImmediate(resolve));
  const expected = { src: 'data:image/png;base64,AQID', isPng: true };
  assert.deepEqual(page.data.icon, expected);
  assert.equal(widget.data.icon, undefined);
  assert.deepEqual(cachedAvatar(view(), 'icon', avatar), expected);
  assert.equal(request.mock.callCount(), 1);
  cachedAvatar(page, 'icon', { ...avatar, src: avatar.src.replace('v=1', 'v=2') });
  assert.equal(request.mock.callCount(), 2);
  finish(new Response('unavailable', { status: 503 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.icon.src, avatar.src.replace('v=1', 'v=2'));
});
