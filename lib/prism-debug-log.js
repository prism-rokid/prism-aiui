// Optional remote diagnostics sink. When a log endpoint is configured, trace
// lines are buffered and flushed over wx.request; otherwise diagnostics stay
// on the local console only.
export function createDebugSink(wx, options = {}) {
  const url = (options && options.url) || '';
  const enabled = Boolean(url && options.enabled !== false && wx && typeof wx.request === 'function');
  const FLUSH_MS = 800;
  const MAX_BUFFER = 200;
  const buffer = [];
  let timer = null;

  function flush() {
    timer = null;
    if (!buffer.length) return;
    const lines = buffer.splice(0, buffer.length);
    try {
      wx.request({
        url,
        method: 'POST',
        data: { lines },
        header: { 'Content-Type': 'application/json' },
        dataType: 'json',
        responseType: 'text',
        timeout: 4000,
        success() {},
        fail() {}
      });
    } catch (error) {}
  }

  function push(level, text) {
    if (!enabled) return;
    const type = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    buffer.push({ type, text: String(text) });
    if (buffer.length >= MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    if (timer === null && typeof setTimeout === 'function') {
      timer = setTimeout(flush, FLUSH_MS);
    }
  }

  return { push, flush, enabled };
}
