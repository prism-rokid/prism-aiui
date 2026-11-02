import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceVadGate } from '../lib/voice-vad-gate.js';
const frame = (value, size = 3200) => new Uint8Array(size).fill(value).buffer;
test('silence keeps only 300ms, speech replays pre-roll and first false boundary', () => {
  const gate = createVoiceVadGate();
  for (let i = 1; i <= 5; i++) assert.deepEqual(gate.push(frame(i), false), []);
  const sent = gate.push(frame(6), true);
  assert.equal(sent[0].byteLength, 9600);
  assert.deepEqual([0, 3200, 6400].map(i => new Uint8Array(sent[0])[i]), [3, 4, 5]);
  assert.equal(new Uint8Array(sent[1])[0], 6);
  assert.equal(gate.push(frame(7), false).length, 1);
  assert.equal(gate.push(frame(8), false).length, 0);
});
test('unknown flushes pre-roll and keeps passing false frames', () => {
  const gate = createVoiceVadGate();
  gate.push(frame(1), false);
  assert.equal(gate.push(frame(2), undefined).length, 2);
  assert.equal(gate.push(frame(3), false).length, 1);
});
test('pre-roll owns a copy of native memory and clear discards it', () => {
  const gate = createVoiceVadGate();
  const native = frame(4);
  gate.push(native, false);
  new Uint8Array(native).fill(9);
  assert.equal(new Uint8Array(gate.push(frame(5), true)[0])[0], 4);
  gate.push(frame(6), false);
  gate.push(frame(7), false);
  gate.clear();
  assert.equal(gate.push(frame(8), true).length, 1);
});
