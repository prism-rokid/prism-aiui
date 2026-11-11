// Prefer Opus when the ASR host supports it; otherwise use PCM.

import { trace } from './prism-trace.js';
import { createVoiceVadGate } from './voice-vad-gate.js';
import { t, speechLang } from './prism-i18n.js';
const OPUS_MIME = 'audio/ogg;codecs=opus';
const PCM_AUDIO = { mimeType: 'audio/pcm', sampleRate: 16000, channelCount: 1, sampleFormat: 's16' };

function accepts(value, expected) {
  return !Array.isArray(value) || value.length === 0 || value.includes(expected);
}

function supportsPcm(capabilities) {
  return Array.isArray(capabilities && capabilities.audioFormats)
    && capabilities.audioFormats.some((format) => String(format.mimeType || '').toLowerCase() === PCM_AUDIO.mimeType
      && accepts(format.sampleRates, PCM_AUDIO.sampleRate)
      && accepts(format.channelCounts, PCM_AUDIO.channelCount)
      && accepts(format.sampleFormats, PCM_AUDIO.sampleFormat));
}

export function createVoiceInput({ wx, SpeechRecognitionSession } = {}) {
  let current = null;
  let recorder = null;
  const api = { start, stop, abort };
  const live = (run) => current === run;
  const abortWriter = (run) => {
    try { if (run.writer) Promise.resolve(run.writer.abort()).catch(() => {}); } catch (_) {}
  };
  const finish = (run, error) => {
    if (!live(run)) return;
    trace('voice.transport.end', { reason: error && error.message || 'complete', elapsedMs: Date.now() - run.createdAt,
      capturedBytes: run.capturedBytes, writtenBytes: run.writtenBytes, pendingBytes: run.pendingBytes, queuePeakBytes: run.queuePeakBytes || 0,
      vadTrue: run.vadTrue, vadFalse: run.vadFalse, vadUnknown: run.vadUnknown, writerStarted: Boolean(run.writerStarted) });
    current = null;
    clearTimeout(run.timer);
    run.gate.clear();
    if (run.started && !run.recorderStopped) {
      try { Promise.resolve(recorder.stop()).catch(() => {}); } catch (_) {}
    }
    if (error) {
      abortWriter(run);
      if (api.onerror) api.onerror({ error: error.name || 'recognition-failed', message: error.message || String(error) });
    }
    if (api.onend) api.onend();
  };

  async function start() {
    if (current) return;
    const run = { queue: Promise.resolve(), stopping: false, started: false, gate: createVoiceVadGate(), pendingBytes: 0, createdAt: Date.now(), capturedBytes: 0, writtenBytes: 0, vadTrue: 0, vadFalse: 0, vadUnknown: 0 };
    current = run;
    run.timer = setTimeout(() => finish(run, new Error(t('voice.error.startTimeout'))), 15000);
    try {
      if (!SpeechRecognitionSession) throw new Error(t('voice.error.sessionUnsupported'));
      recorder = wx && wx.media && wx.media.getRecorderManager && wx.media.getRecorderManager();
      if (!recorder) throw new Error(t('voice.error.recorderUnsupported'));
      const capabilities = await SpeechRecognitionSession.getCapabilities();
      if (!live(run)) return;
      const opus = Array.isArray(capabilities.audioFormats) && capabilities.audioFormats.some((format) => String(format.mimeType || '').toLowerCase().replace(/\s/g, '') === OPUS_MIME);
      trace('voice.transport.format', { available: (capabilities.audioFormats || []).map((format) => format.mimeType), selected: opus ? OPUS_MIME : PCM_AUDIO.mimeType });
      if (!opus && !supportsPcm(capabilities)) throw new Error(t('voice.error.pcmUnsupported'));
      const session = new SpeechRecognitionSession({ lang: speechLang(), interimResults: Boolean(capabilities.interimResults), audio: opus ? { mimeType: OPUS_MIME } : PCM_AUDIO });
      run.writer = session.audio.getWriter();
      session.onresult = (event) => { if (live(run) && api.onresult) api.onresult(event); };
      session.onerror = (event) => finish(run, Object.assign(new Error(event && (event.message || event.error) || t('voice.error.recognitionFailed')), { name: event && event.error || 'Error' }));
      session.onend = () => finish(run);
      const enqueue = (frame) => {
        run.pendingBytes += frame.byteLength;
        run.queuePeakBytes = Math.max(run.queuePeakBytes || 0, run.pendingBytes);
        if (run.pendingBytes > 128000) {
          finish(run, new Error(t('voice.error.uploadBackpressure')));
          return;
        }
        run.queue = run.queue.then(async () => {
          if (!live(run)) return;
          if (!run.writerStarted) {
            run.writerStarted = true;
            trace('voice.transport.first_write', { elapsedMs: Date.now() - run.createdAt, bytes: frame.byteLength });
          }
          await run.writer.write(frame);
          if (!run.writtenBytes) trace('voice.transport.first_write_complete', { elapsedMs: Date.now() - run.createdAt });
          run.writtenBytes += frame.byteLength;
          run.pendingBytes -= frame.byteLength;
        });
        run.queue.catch((error) => finish(run, error));
      };
      if (opus) recorder.onHeader((format, header) => {
        if (live(run) && !run.recorderStopped && format === 'opus' && header && header.byteLength) {
          trace('voice.transport.opus_header', { bytes: header.byteLength });
          enqueue(header.slice(0));
        }
      });
      recorder.onFrameRecorded(({ frameBuffer, voiceActive }) => {
        if (!live(run) || run.recorderStopped || !frameBuffer || !frameBuffer.byteLength) return;
        run.capturedBytes += frameBuffer.byteLength;
        if (voiceActive === true) run.vadTrue++;
        else if (voiceActive === false) run.vadFalse++;
        else run.vadUnknown++;
        const frames = opus ? [frameBuffer.slice(0)] : run.gate.push(frameBuffer, voiceActive);
        for (const frame of frames) enqueue(frame);
      });
      recorder.onError((event) => finish(run, new Error(event && event.errMsg || t('voice.error.micFailed'))));
      recorder.onStop(async () => {
        if (!live(run) || run.recorderStopped) return;
        run.recorderStopped = true;
        trace('voice.transport.recorder_stopped', { sinceStopMs: run.stopAt ? Date.now() - run.stopAt : null, pendingBytes: run.pendingBytes });
        run.gate.clear();
        clearTimeout(run.timer);
        run.timer = setTimeout(() => finish(run, new Error(t('voice.error.resultTimeout'))), 15000);
        try {
          await run.queue;
          if (live(run)) trace('voice.transport.queue_drained', { sinceStopMs: run.stopAt ? Date.now() - run.stopAt : null });
          if (live(run)) await run.writer.close();
        } catch (error) { finish(run, error); }
      });
      await recorder.start({ sampleRate: 16000, numberOfChannels: 1, format: opus ? 'opus' : 'pcm', frameSize: 100, ...(opus ? {} : { vad: { enabled: true, silenceDurationMs: 500 } }) });
      if (!live(run)) {
        try { await recorder.stop(); } catch (_) {}
        return;
      }
      run.started = true;
      clearTimeout(run.timer);
      if (api.onstart) api.onstart();
    } catch (error) { finish(run, error); }
  }

  function stop() {
    const run = current;
    if (!run || run.stopping) return;
    run.stopping = true;
    run.stopAt = Date.now();
    trace('voice.transport.stop_requested', { pendingBytes: run.pendingBytes, capturedBytes: run.capturedBytes, writtenBytes: run.writtenBytes });
    clearTimeout(run.timer);
    run.timer = setTimeout(() => finish(run, new Error(t('voice.error.stopTimeout'))), 15000);
    if (!run.started || !recorder) return finish(run, new Error(t('voice.error.notStarted')));
    Promise.resolve(recorder.stop()).catch((error) => finish(run, error));
  }

  function abort() {
    const run = current;
    if (!run) return;
    current = null;
    clearTimeout(run.timer);
    run.gate.clear();
    abortWriter(run);
    if (recorder && run.started) Promise.resolve(recorder.stop()).catch(() => {});
  }
  return api;
}
