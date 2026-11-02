import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePageConfig } from './helpers/page-loader.mjs';

async function page() {
  const config = await evaluatePageConfig();
  const p = Object.create(config);
  p.data = JSON.parse(JSON.stringify(config.data));
  p.setData = patch => Object.assign(p.data, patch);
  return p;
}

test('voice stop guard expires instead of swallowing the first deliberate stop', async () => {
  const p = await page();
  let stops = 0;
  p._recognition = { start() {}, stop() { stops++; } };
  p.data.surface = 'quick';
  p.startVoiceInput({ ignoreInitialStop: true });
  assert.ok(p._voiceStopGuardUntil > Date.now());
  await p.activateFocused(); // Duplicate activation from the starting gesture.
  assert.equal(stops, 0);
  p._voiceStopGuardUntil = Date.now() - 1;
  await p.activateFocused();
  assert.equal(stops, 1);
});

test('loaded conversations wait before draining instead of repeating the initial 500ms probe', async () => {
  const p = await page();
  let closes = 0;
  p._api = { openConversationStream: () => ({ abort() {} }), closeStateStream: async () => { closes++; } };
  Object.assign(p.data, { selectedHostId: 'h', selectedPluginId: 'p', selectedConversationId: 'c', messagesLoaded: true });
  p.openConversationStream();
  try {
    await new Promise(resolve => setTimeout(resolve, 580));
    assert.equal(closes, 0);
    assert.equal(p._convStream.draining, false);
  } finally { p.closeConversationStream(); }
});

test('hiding stops background polling and streams; showing resumes once', async () => {
  const p = await page();
  let stops = 0, closes = 0, starts = 0, opens = 0;
  p.stopPolling = () => stops++;
  p.closeConversationStream = () => closes++;
  p.startPolling = () => starts++;
  p.openConversationStream = () => opens++;
  p._api = {};
  p.data.configured = true;
  p.data.selectedConversationId = 'c';
  p.onHide();
  assert.equal(p._pageHidden, true);
  assert.equal(stops, 1);
  assert.equal(closes, 1);
  p.onShow();
  p.onShow();
  assert.equal(starts, 1);
  assert.equal(opens, 1);
});

test('done speaking shows processing before invoking the native stop and ignores repeated taps', async () => {
  const p = await page();
  p.data.surface = 'voice';
  p.data.listening = true;
  p._recognitionActive = true;
  let stops = 0;
  p._recognition = { stop() {
    assert.equal(p.data.recognizing, true, 'feedback is set synchronously before stopping');
    assert.equal(p.data.voiceHint, '正在识别');
    stops++;
  } };
  p.stopVoiceInput();
  p.handleMenuTap({ currentTarget: { dataset: { index: 0 } } });
  p.stopVoiceInput();
  assert.equal(stops, 1);
  const { readFile } = await import('node:fs/promises');
  const template = await readFile(new URL('../pages/index/index.wxml', import.meta.url), 'utf8');
  assert.match(template, /lottie-view ink:if="{{recognizing}}"[^>]*voice-processing.json/);
});
