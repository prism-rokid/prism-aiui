// Diagnostics plumbing shared by every page module: trace logging, gated input
// traces, and error normalization. The sink is bound once by the page entry so
// this module stays importable in Node for tests.
export const INPUT_DIAGNOSTICS_ENABLED = false;

const NOISY_TRACE_PREFIXES = [
  'feedback.',
  'poll.',
  'stream.frame.heartbeat',
  'stream.liveness',
  'plugins.apply.',
  'plugins.selection_styles.',
  'conversations.apply.',
  'conversations.selection_styles.',
  'interaction.'
];
const NOISY_TRACE_EVENTS = new Set([
  'menu.rebuild',
  'toast.dismiss',
  'exit.confirmation.cancel'
]);

let logSink = null;

export function bindTraceSink(sink) {
  logSink = sink;
}

function logTime() {
  const now = new Date();
  const pad = (value) => (value < 10 ? `0${value}` : String(value));
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function trace(event, details = {}) {
  const isError = event.endsWith('.error');
  const isNoisy = NOISY_TRACE_EVENTS.has(event)
    || NOISY_TRACE_PREFIXES.some((prefix) => event.startsWith(prefix));
  if (isNoisy && !isError) return;
  let text;
  try {
    text = JSON.stringify({ time: logTime(), event, ...details });
  } catch (error) {
    text = event;
  }
  console.log('[PrismAIUI]', text);
  if (logSink) logSink.push(isError ? 'error' : 'log', `[PrismAIUI] ${text}`);
}

export function inputTrace(name, event, surface, details = '') {
  if (!INPUT_DIAGNOSTICS_ENABLED) return;
  const type = event && event.type || '';
  const code = event && event.code || '';
  const keyword = event && event.keyword || '';
  const suffix = details ? ` ${details}` : '';
  const line = `[PrismInput] time=${logTime()} event=${name} type=${type} code=${code} keyword=${keyword} surface=${surface || ''}${suffix}`;
  console.log(line);
  if (logSink) logSink.push('log', line);
}

export function scrollTrace(event, details = {}) {
  if (!INPUT_DIAGNOSTICS_ENABLED) return;
  try {
    console.log('[PrismScroll]', JSON.stringify({ time: logTime(), event, ...details }));
  } catch (error) {
    console.log('[PrismScroll]', event);
  }
}

export function performanceTimestamp() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function performanceTrace(event, details = {}) {
  if (!INPUT_DIAGNOSTICS_ENABLED) return;
  const atMs = performanceTimestamp();
  try {
    console.log('[PrismPerf]', JSON.stringify({
      time: logTime(),
      atMs: Number(atMs.toFixed ? atMs.toFixed(3) : atMs),
      event,
      ...details
    }));
  } catch (error) {
    console.log('[PrismPerf]', event);
  }
}

export function errorDetails(error) {
  return {
    message: error && error.message || String(error || ''),
    code: error && error.code || '',
    statusCode: error && error.statusCode || 0
  };
}

export function isConversationMissingError(error) {
  const message = String(error && error.message || '').toLowerCase();
  return message.indexOf('conversation not found') >= 0 || message.indexOf('conversation_unavailable') >= 0;
}
