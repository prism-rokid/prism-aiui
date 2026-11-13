import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from '../lib/voice-input.js';
import { setLocale } from '../lib/prism-i18n.js';

setLocale('zh-CN', { persist: false });

const OPUS_MIME = 'audio/ogg;codecs=opus';
const flush = () => new Promise((resolve) => setImmediate(resolve));
// Ogg identification and comment pages returned by the glasses' native recorder.
const opusHeader = () => Uint8Array.from(Buffer.from(
  '4f67675300020000000000000000014b4e49000000004900358a01134f7075734865616401013801803e0000000000'
  + '4f67675300000000000000000000014b4e4901000000b7e8f47701134f7075735461677303000000496e6b00000000', 'hex'
)).buffer;

function fixture() {
  const calls = [];
  const sessions = [];
  const recorder = {
    async start(options) { calls.push(['start', options]); },
    async stop() { calls.push(['stop']); recorder.stopHandler(); },
    onFrameRecorded(handler) { recorder.frameHandler = handler; },
    onHeader(handler) { recorder.headerHandler = handler; },
    onStop(handler) { recorder.stopHandler = handler; },
    onError(handler) { recorder.errorHandler = handler; }
  };
  class Session {
    static async getCapabilities() {
      return { interimResults: true, audioFormats: [{ mimeType: 'audio/pcm' }, { mimeType: OPUS_MIME, sampleRates: [48000], channelCounts: [1] }] };
    }
    constructor(options) {
      this.options = options;
      this.writer = {
        write: async (frame) => calls.push(['write', frame]),
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

test('streams the native Ogg header, silence, and stop-time frames unchanged into Opus ASR', async () => {
  const f = fixture();
  await f.voice.start();
  assert.deepEqual(f.sessions[0].options, { lang: 'zh-CN', interimResults: true, audio: { mimeType: OPUS_MIME } });
  assert.deepEqual(f.calls[0], ['start', { sampleRate: 16000, numberOfChannels: 1, format: 'opus', frameSize: 250 }]);

  const header = opusHeader();
  const frame = Uint8Array.of(1, 2, 3).buffer;
  const tail = Uint8Array.of(4, 5).buffer;
  f.recorder.headerHandler('opus', header);
  f.recorder.headerHandler('opus', header);
  f.recorder.frameHandler({ frameBuffer: frame, voiceActive: false });
  const expectedHeader = header.slice(0);
  const expectedFrame = frame.slice(0);
  new Uint8Array(header).fill(0);
  new Uint8Array(frame).fill(0);
  const stop = f.recorder.stop;
  f.recorder.stop = () => {
    f.recorder.frameHandler({ frameBuffer: tail, isLastFrame: false });
    return stop();
  };
  f.voice.stop();
  await flush();

  assert.deepEqual(f.calls.filter(([kind]) => kind === 'write'), [
    ['write', expectedHeader], ['write', expectedFrame], ['write', tail]
  ]);
  assert.deepEqual(f.calls.at(-1), ['close']);
  assert.equal(f.calls.filter(([kind]) => kind === 'stop').length, 1);
  f.sessions[0].onend();
});

test('a PCM-only host reports the firmware requirement without opening the mic or ASR', async () => {
  const f = fixture();
  f.Session.getCapabilities = async () => ({ audioFormats: [{ mimeType: 'audio/pcm', sampleRates: [16000] }] });
  const errors = [];
  f.voice.onerror = (event) => errors.push(event.message);
  await f.voice.start();
  assert.deepEqual(errors, ['当前眼镜系统不支持 Opus 语音识别，请更新眼镜系统']);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sessions, []);
});

test('audio arriving without a valid Opus header is never sent to ASR', async () => {
  const f = fixture();
  const errors = [];
  f.voice.onerror = (event) => errors.push(event.message);
  await f.voice.start();
  f.recorder.frameHandler({ frameBuffer: new ArrayBuffer(4) });
  await flush();
  assert.deepEqual(errors, ['录音未提供有效的 Ogg/Opus 文件头']);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['start', 'abort', 'stop']);
});

test('stopping while probing the host cannot start a late recording', async () => {
  const f = fixture();
  let resolveCapabilities;
  f.Session.getCapabilities = () => new Promise((resolve) => { resolveCapabilities = resolve; });
  let ended = 0;
  f.voice.onend = () => ended++;

  const starting = f.voice.start();
  f.voice.stop();
  resolveCapabilities({ audioFormats: [{ mimeType: OPUS_MIME }] });
  await starting;

  assert.equal(ended, 1);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.sessions, []);
});

test('cancel and restart waits for the previous native recorder to stop', async () => {
  const f = fixture();
  let results = 0;
  f.voice.onresult = () => results++;
  await f.voice.start();
  const oldSession = f.sessions[0];
  const oldFrame = f.recorder.frameHandler;
  let release;
  f.recorder.stop = () => new Promise((resolve) => { release = resolve; });
  f.voice.abort();
  const started = f.voice.start();
  await flush();
  assert.equal(f.sessions.length, 1);
  release();
  await started;

  oldFrame({ frameBuffer: new ArrayBuffer(5) });
  oldSession.onresult({}); oldSession.onend(); oldSession.onerror({ message: 'late error' });
  await flush();
  assert.equal(results, 0);
  assert.equal(f.calls.some(([kind]) => kind === 'write'), false);
  f.sessions[1].onresult({});
  assert.equal(results, 1);
  f.sessions[1].onend();
});

test('blocked Opus upload releases the mic and aborts the ASR stream', async () => {
  const f = fixture();
  const errors = [];
  f.voice.onerror = (event) => errors.push(event.message);
  await f.voice.start();
  let release;
  f.sessions[0].writer.write = () => new Promise((resolve) => { release = resolve; });
  f.recorder.headerHandler('opus', opusHeader());
  await flush();
  for (let i = 0; i < 40; i++) f.recorder.frameHandler({ frameBuffer: new ArrayBuffer(3200) });
  await flush();
  assert.deepEqual(errors, ['语音上传阻塞，请检查眼镜网络后重试']);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['start', 'abort', 'stop']);
  release();
  await flush();
});
