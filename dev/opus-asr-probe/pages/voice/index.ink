<script def>
{"description":"Opus transport test"}
</script>
<script setup>
import wx from 'wx';
function log(stage, data) { console.log('PrismOpusProbe ' + stage + ' ' + JSON.stringify(data)); }
function hex(buffer, max) {
  return Array.from(new Uint8Array(buffer).slice(0, max), b => b.toString(16).padStart(2,'0')).join('');
}
export default {
  data: {status: 'Tap to test Opus'},
  onLoad() { this.probe(); },
  async probe() {
    if (this.running) return;
    this.running = true;
    this.setData({status: 'Opus capture running'});
    try {
      log('runtime', { session: typeof SpeechRecognitionSession, webOpus: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') });
      const capabilities = await SpeechRecognitionSession.getCapabilities();
      log('capabilities', capabilities);
      const session = new SpeechRecognitionSession({lang:'zh-CN',interimResults:true,audio:{mimeType:'audio/ogg;codecs=opus'}});
      const writer = session.audio.getWriter();
      let queue = Promise.resolve();
      let frames = 0;
      const write = (buffer) => {
        queue = queue.then(async () => { await writer.write(buffer); log('write', buffer.byteLength); });
        queue.catch(e => log('writeError', {name:e.name,message:e.message}));
      };
      session.onresult = (event) => {
        const results = Array.from(event.results, item => ({ final:item.isFinal, transcript:item[0].transcript }));
        log('result', results);
        this.setData({status: results.map(item => item.transcript).join('')});
      };
      session.onerror = e => log('asrError', { error:e.error, message:e.message });
      session.onend = () => { log('asrEnd', {}); this.running = false; };
      const recorder = wx.media.getRecorderManager();
      log('recorder', {exists:!!recorder,header:typeof recorder.onHeader});
      recorder.onHeader((format, buffer) => { log('header', {format,bytes:buffer.byteLength,hex:hex(buffer,256)}); write(buffer.slice(0)); });
      recorder.onFrameRecorded(({frameBuffer}) => { frames++; log('frame', {frames,bytes:frameBuffer.byteLength,hex:hex(frameBuffer,48)}); write(frameBuffer.slice(0)); });
      recorder.onError(e => log('recError', e));
      recorder.onStop(async e => { log('recStop', e); try { await queue; await writer.close(); log('closed',{}); } catch(e) { log('closeError',{name:e.name,message:e.message}); } });
      await recorder.start({sampleRate:16000,numberOfChannels:1,format:'opus',frameSize:250});
      log('started', {});
      setTimeout(() => recorder.stop(), 6500);
    } catch(e) { log('failure',{name:e.name,message:e.message}); this.running = false; }
  }
}
</script>
<page><view bindtap="probe"><text>{{status}}</text></view></page>
<style>view { width:480px; height:200px; background:#000; } text { color:#40ff5e; }</style>
