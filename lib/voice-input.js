import { trace } from './prism-trace.js';
import { t, speechLang } from './prism-i18n.js';

const OPUS_MIME = 'audio/ogg;codecs=opus';
const RECORDER_OPTIONS = { sampleRate: 16000, numberOfChannels: 1, format: 'opus', frameSize: 250 };
const TIMEOUT_MS = 15000;
const MAX_PENDING_BYTES = 128000;

function isOggOpusHeader(buffer) {
  const bytes = new Uint8Array(buffer);
  const packetOffset = 27 + bytes[26];
  const matches = (offset, text) => Array.from(text).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  return matches(0, 'OggS') && matches(packetOffset, 'OpusHead');
}

export function createVoiceInput({ wx, SpeechRecognitionSession } = {}) {
  let current = null;
  let recorderRelease = null;
  const api = { start, stop, abort };
  const live = (run) => current === run;

  function releaseRecorder(run) {
    if (!run.captureStart || run.release) return run.release;
    // The native manager is shared. Wait for this start and stop to settle
    // before installing the next run's callbacks.
    run.release = run.captureStart.catch(() => {}).then(() => run.recorder.stop());
    recorderRelease = run.release.catch(() => {});
    return run.release;
  }

  function dispose(run, cancelAudio) {
    current = null;
    clearTimeout(run.timer);
    if (cancelAudio && run.writer) Promise.resolve().then(() => run.writer.abort()).catch(() => {});
    if (!run.recorderStopped) releaseRecorder(run);
  }

  function finish(run, error) {
    if (!live(run)) return;
    trace('voice.transport.end', {
      reason: error ? error.message : 'complete',
      elapsedMs: Date.now() - run.createdAt,
      headerBytes: run.headerBytes,
      capturedBytes: run.capturedBytes,
      writtenBytes: run.writtenBytes,
      queuePeakBytes: run.queuePeakBytes
    });
    dispose(run, Boolean(error) || !run.closing);
    if (error && api.onerror) api.onerror({ error: error.name || 'recognition-failed', message: error.message || String(error) });
    if (api.onend) api.onend();
  }

  function enqueue(run, buffer) {
    run.pendingBytes += buffer.byteLength;
    run.queuePeakBytes = Math.max(run.queuePeakBytes, run.pendingBytes);
    if (run.pendingBytes > MAX_PENDING_BYTES) {
      finish(run, new Error(t('voice.error.uploadBackpressure')));
      return;
    }
    const chunk = buffer.slice(0);
    run.queue = run.queue.then(async () => {
      if (!live(run)) return;
      await run.writer.write(chunk);
      run.writtenBytes += chunk.byteLength;
      run.pendingBytes -= chunk.byteLength;
    });
    run.queue.catch((error) => finish(run, error));
  }

  async function start() {
    if (current) return;
    const run = {
      queue: Promise.resolve(), createdAt: Date.now(), headerBytes: 0,
      capturedBytes: 0, writtenBytes: 0, pendingBytes: 0, queuePeakBytes: 0
    };
    current = run;
    run.timer = setTimeout(() => finish(run, new Error(t('voice.error.startTimeout'))), TIMEOUT_MS);
    try {
      if (!SpeechRecognitionSession || typeof SpeechRecognitionSession.getCapabilities !== 'function') {
        throw new Error(t('voice.error.sessionUnsupported'));
      }
      const capabilities = await SpeechRecognitionSession.getCapabilities();
      if (recorderRelease) await recorderRelease;
      if (!live(run)) return;
      const formats = Array.isArray(capabilities?.audioFormats) ? capabilities.audioFormats.map((format) => format?.mimeType) : [];
      if (!formats.some((mime) => String(mime).toLowerCase().replace(/\s/g, '') === OPUS_MIME)) {
        throw new Error(t('voice.error.opusUnsupported'));
      }

      const recorder = wx?.media?.getRecorderManager?.();
      if (!recorder || typeof recorder.onHeader !== 'function') throw new Error(t('voice.error.recorderUnsupported'));
      run.recorder = recorder;
      // Let Ink read the Ogg/Opus metadata. The mic's 16 kHz input and the
      // Ogg granule clock (48 kHz) are different.
      const session = new SpeechRecognitionSession({
        lang: speechLang(), interimResults: Boolean(capabilities.interimResults), audio: { mimeType: OPUS_MIME }
      });
      run.writer = session.audio.getWriter();
      session.onresult = (event) => { if (live(run) && api.onresult) api.onresult(event); };
      session.onerror = (event) => finish(run, Object.assign(
        new Error(event?.message || event?.error || t('voice.error.recognitionFailed')),
        { name: event?.error || 'Error' }
      ));
      session.onend = () => finish(run);

      recorder.onHeader((format, buffer) => {
        if (!live(run) || run.recorderStopped || run.headerBytes) return;
        if (format !== 'opus' || !buffer?.byteLength || !isOggOpusHeader(buffer)) {
          finish(run, new Error(t('voice.error.opusHeader')));
          return;
        }
        run.headerBytes = buffer.byteLength;
        enqueue(run, buffer);
      });
      recorder.onFrameRecorded(({ frameBuffer }) => {
        if (!live(run) || run.recorderStopped || !frameBuffer?.byteLength) return;
        if (!run.headerBytes) {
          finish(run, new Error(t('voice.error.opusHeader')));
          return;
        }
        run.capturedBytes += frameBuffer.byteLength;
        enqueue(run, frameBuffer);
      });
      recorder.onError((event) => finish(run, new Error(event?.errMsg || t('voice.error.micFailed'))));
      recorder.onStop(async () => {
        if (!live(run) || run.recorderStopped) return;
        run.recorderStopped = true;
        if (!run.capturedBytes) {
          finish(run);
          return;
        }
        clearTimeout(run.timer);
        run.timer = setTimeout(() => finish(run, new Error(t('voice.error.resultTimeout'))), TIMEOUT_MS);
        try {
          await run.queue;
          if (!live(run)) return;
          run.closing = true;
          await run.writer.close();
        } catch (error) { finish(run, error); }
      });
      run.captureStart = Promise.resolve().then(() => recorder.start(RECORDER_OPTIONS));
      await run.captureStart;
      if (!live(run) || run.stopping) return;
      clearTimeout(run.timer);
      if (api.onstart) api.onstart();
    } catch (error) { finish(run, error); }
  }

  function stop() {
    const run = current;
    if (!run || run.stopping) return;
    run.stopping = true;
    if (!run.captureStart) {
      finish(run);
      return;
    }
    clearTimeout(run.timer);
    run.timer = setTimeout(() => finish(run, new Error(t('voice.error.stopTimeout'))), TIMEOUT_MS);
    releaseRecorder(run).catch((error) => finish(run, error));
  }

  function abort() {
    if (current) dispose(current, true);
  }

  return api;
}
