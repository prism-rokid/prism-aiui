// AIUI's native recorder supplies raw PCM frames to one ASR session at a time.

import { t, speechLang } from './prism-i18n.js';
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
    current = null;
    clearTimeout(run.timer);
    if (error) {
      abortWriter(run);
      if (api.onerror) api.onerror({ error: error.name || 'recognition-failed', message: error.message || String(error) });
    }
    if (api.onend) api.onend();
  };

  async function start() {
    if (current) return;
    const run = { queue: Promise.resolve(), stopping: false, started: false };
    current = run;
    run.timer = setTimeout(() => finish(run, new Error(t('voice.error.startTimeout'))), 15000);
    try {
      if (!SpeechRecognitionSession) throw new Error(t('voice.error.sessionUnsupported'));
      recorder = wx && wx.media && wx.media.getRecorderManager && wx.media.getRecorderManager();
      if (!recorder) throw new Error(t('voice.error.recorderUnsupported'));
      const capabilities = await SpeechRecognitionSession.getCapabilities();
      if (!live(run)) return;
      if (!supportsPcm(capabilities)) throw new Error(t('voice.error.pcmUnsupported'));
      const session = new SpeechRecognitionSession({ lang: speechLang(), interimResults: Boolean(capabilities.interimResults), audio: PCM_AUDIO });
      run.writer = session.audio.getWriter();
      session.onresult = (event) => { if (live(run) && api.onresult) api.onresult(event); };
      session.onerror = (event) => finish(run, Object.assign(new Error(event && (event.message || event.error) || t('voice.error.recognitionFailed')), { name: event && event.error || 'Error' }));
      session.onend = () => finish(run);
      recorder.onFrameRecorded(({ frameBuffer }) => {
        if (!live(run) || !frameBuffer || !frameBuffer.byteLength) return;
        run.queue = run.queue.then(() => live(run) ? run.writer.write(frameBuffer) : undefined);
        run.queue.catch((error) => finish(run, error));
      });
      recorder.onError((event) => finish(run, new Error(event && event.errMsg || t('voice.error.micFailed'))));
      recorder.onStop(async () => {
        if (!live(run)) return;
        clearTimeout(run.timer);
        run.timer = setTimeout(() => finish(run, new Error(t('voice.error.resultTimeout'))), 15000);
        try {
          await run.queue;
          if (live(run)) await run.writer.close();
        } catch (error) { finish(run, error); }
      });
      await recorder.start({ sampleRate: 16000, numberOfChannels: 1, format: 'pcm', frameSize: 250 });
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
    abortWriter(run);
    if (recorder && run.started) Promise.resolve(recorder.stop()).catch(() => {});
  }
  return api;
}
