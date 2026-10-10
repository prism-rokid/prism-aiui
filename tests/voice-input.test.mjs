import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from '../lib/voice-input.js';
import { setLocale } from '../lib/prism-i18n.js';

// Pin zh-CN so the ASR lang assertion is independent of navigator.language.
setLocale('zh-CN', { persist: false });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const calls = [];
  const sessions = [];
  const recorder = {
    async start(options) { calls.push(['start', options]); },
    async stop() { calls.push(['stop']); if (recorder.stopHandler) recorder.stopHandler(); },
    onFrameRecorded(handler) { recorder.frameHandler = handler; },
    onStop(handler) { recorder.stopHandler = handler; },
    onError(handler) { recorder.errorHandler = handler; }
  };
  class Session {
    static async getCapabilities() {
      return { interimResults: true, audioFormats: [{ mimeType: 'audio/pcm', sampleRates: [16000], channelCounts: [1], sampleFormats: ['s16'] }] };
    }
    constructor(options) {
      this.options = options;
      this.writer = {
        write: async (frame) => calls.push(['write', frame.byteLength]),
        close: async () => calls.push(['close']),
        abort: async () => calls.push(['abort'])
      };
      this.audio = { getWriter: () => this.writer };
      sessions.push(this);
    }
  }
  const voice = createVoiceInput({ wx: { media: { getRecorderManager: () => recorder } }, SpeechRecognitionSession: Session });
  return { voice, calls, sessions, recorder, Session };
}

test('native recorder streams 16kHz mono PCM frames into the latest ASR session', async () => {
  const f = fixture();
  let started = 0;
  f.voice.onstart = () => started++;
  await f.voice.start();
  assert.deepEqual(f.sessions[0].options, {
    lang: 'zh-CN', interimResults: true,
    audio: { mimeType: 'audio/pcm', sampleRate: 16000, channelCount: 1, sampleFormat: 's16' }
  });
  assert.deepEqual(f.calls[0], ['start', { sampleRate: 16000, numberOfChannels: 1, format: 'pcm', frameSize: 250 }]);
  assert.equal(started, 1);
  f.recorder.frameHandler({ frameBuffer: new ArrayBuffer(8) });
  await flush();
  assert.deepEqual(f.calls[1], ['write', 8]);
});

test('stopping waits for native recorder frames before closing the ASR writer', async () => {
  const f = fixture();
  await f.voice.start();
  f.recorder.frameHandler({ frameBuffer: new ArrayBuffer(4) });
  f.voice.stop();
  await flush();
  assert.deepEqual(f.calls.map(([kind]) => kind), ['start', 'stop', 'write', 'close']);
  assert.equal(f.calls.filter(([kind]) => kind === 'stop').length, 1);
});

test('old native callbacks cannot affect a session after cancel and restart', async () => {
  const f = fixture();
  let results = 0;
  f.voice.onresult = () => results++;
  await f.voice.start();
  const old = f.sessions[0];
  const oldFrame = f.recorder.frameHandler;
  f.voice.abort();
  await f.voice.start();
  oldFrame({ frameBuffer: new ArrayBuffer(5) });
  old.onresult({}); old.onend(); old.onerror({ message: 'late error' });
  await flush();
  assert.equal(results, 0);
  assert.equal(f.calls.some(([kind, size]) => kind === 'write' && size === 5), false);
  f.sessions[1].onresult({});
  assert.equal(results, 1);
});

test('unsupported PCM capabilities report a useful error instead of opening the recorder', async () => {
  const f = fixture();
  f.Session.getCapabilities = async () => ({ audioFormats: [{ mimeType: 'audio/wav' }] });
  const errors = [];
  f.voice.onerror = (event) => errors.push(event.message);
  await f.voice.start();
  assert.deepEqual(errors, ['当前设备不支持 16kHz PCM 语音识别']);
  assert.equal(f.calls.length, 0);
});
