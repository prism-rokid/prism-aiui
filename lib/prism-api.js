import { t } from './prism-i18n.js';

const SOURCE_DEVICE = 'rokid-glasses-aiui';
const STATE_STREAM_PATH = '/user/remote/state-stream';
const STATE_STREAM_TIMEOUT_MS = 1800000;
const MAX_STREAM_BUFFER_CHARS = 262144;

// Every created client registers its sink here, so the page and the two
// widgets can coexist in one runtime without silently re-routing each
// other's diagnostics.
const _onLogSinks = new Set();

function logTime() {
  const now = new Date();
  const pad = (value) => (value < 10 ? `0${value}` : String(value));
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function apiTrace(event, details = {}) {
  const payload = { time: logTime(), event, ...details };
  let text;
  try {
    text = JSON.stringify(payload);
  } catch (error) {
    text = event;
  }
  console.log('[PrismAPI]', text);
  const level = /error|rejected/i.test(event) ? 'error' : 'log';
  for (const sink of _onLogSinks) sink(level, `[PrismAPI] ${text}`);
}

function responseSummary(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    changed: value.changed,
    itemCount: Array.isArray(value.items) ? value.items.length : undefined,
    accepted: value.accepted,
    keys: Object.keys(value).slice(0, 12).join(',')
  };
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function encodeSegment(value) {
  return encodeURIComponent(String(value || ''));
}

export function createStreamId(prefix = 'stream') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`.slice(0, 64);
}

/**
 * Incrementally decodes response.body chunks and emits each complete NDJSON
 * line immediately. Keep one TextDecoder alive for the whole response: this
 * matches AIUI's loadStreamPreview() example and preserves UTF-8 characters
 * split across adjacent ReadableStream chunks.
 */
function createLineReader(onLine) {
  let decoder = new TextDecoder();
  let buffer = '';

  function emitCompleteLines() {
    let emittedLines = 0;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const text = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (text) {
        emittedLines += 1;
        onLine(text);
      }
    }
    return emittedLines;
  }

  return {
    push(raw) {
      if (!raw) return { byteLength: 0, decodedChars: 0, emittedLines: 0, bufferedChars: buffer.length, overflowed: false };
      const byteLength = Number(raw.byteLength === undefined ? raw.length : raw.byteLength);
      if (!byteLength) return { byteLength: 0, decodedChars: 0, emittedLines: 0, bufferedChars: buffer.length, overflowed: false };
      const decoded = decoder.decode(raw, { stream: true });
      buffer += decoded;
      const emittedLines = emitCompleteLines();
      let overflowed = false;
      if (buffer.length > MAX_STREAM_BUFFER_CHARS) {
        overflowed = true;
        buffer = '';
        decoder = new TextDecoder();
      }
      return { byteLength, decodedChars: decoded.length, emittedLines, bufferedChars: buffer.length, overflowed };
    },
    flush() {
      const decoded = decoder.decode();
      buffer += decoded;
      let emittedLines = emitCompleteLines();
      const text = buffer.trim();
      buffer = '';
      if (text) {
        emittedLines += 1;
        onLine(text);
      }
      return { decodedChars: decoded.length, emittedLines, bufferedChars: 0 };
    }
  };
}

function responseHeader(response, name) {
  try {
    const headers = response && response.headers;
    if (!headers) return '';
    if (typeof headers.get === 'function') return String(headers.get(name) || '');
    return String(headers[name] || headers[String(name).toLowerCase()] || '');
  } catch (error) {
    return '';
  }
}

function shouldTraceStreamRead(index) {
  return index <= 12 || index % 25 === 0;
}

/**
 * Create a Prism client.
 *
 * `accountToken` is the canonical Prism credential and is sent as
 * `X-Account-Token: <token>`.
 */
export function createPrismApi(wx, config = {}) {
  if (!wx || typeof wx.request !== 'function') {
    throw new Error('wx.request unavailable');
  }
  if (typeof config.onLog === 'function') _onLogSinks.add(config.onLog);

  const baseUrl = trimTrailingSlash(config.baseUrl);
  const accountToken = String(config.accountToken || '');

  function applyAuthHeader(headers) {
    if (accountToken) headers['X-Account-Token'] = accountToken;
    return headers;
  }

  function authHeaders() {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    return applyAuthHeader(headers);
  }

  function unwrapEnvelope(body) {
    if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.success === 'boolean') {
      return { enveloped: true, ok: body.success !== false, data: body.data, code: body.code || '', message: body.message || '' };
    }
    return { enveloped: false, ok: true, data: body, code: '', message: '' };
  }

  function rejectFromEnvelope(status, body) {
    const parsed = unwrapEnvelope(body);
    const message = parsed.enveloped
      ? (parsed.message || parsed.code || `HTTP_${status}`)
      : (body && (body.error_message || body.message) || `HTTP_${status}`);
    const error = new Error(message);
    error.statusCode = status;
    error.code = parsed.enveloped ? String(parsed.code || '').toLowerCase() : String(body && body.code || '').toLowerCase();
    error.data = parsed.enveloped ? parsed.data : body;
    return error;
  }

  function request(path, options = {}) {
    if (!baseUrl) {
      apiTrace('request.rejected', { path, reason: 'API_BASE_URL_MISSING' });
      return Promise.reject(new Error('API_BASE_URL_MISSING'));
    }

    const method = options.method || 'GET';
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${baseUrl}${path}`,
        method,
        data: options.data,
        header: authHeaders(),
        dataType: 'json',
        responseType: 'text',
        timeout: options.timeout || 15000,
        success(response) {
          const status = Number(response.statusCode || 0);
          const body = response.data;
          if (status >= 200 && status < 300) {
            const parsed = unwrapEnvelope(body);
            if (!parsed.ok) {
              const error = rejectFromEnvelope(status, body);
              apiTrace('request.envelope_error', {
                method, path, status, code: error.code, durationMs: Date.now() - startedAt, message: error.message
              });
              reject(error);
              return;
            }
            const data = parsed.data === undefined || parsed.data === null ? {} : parsed.data;
            if (method !== 'GET') {
              apiTrace('request.success', {
                method, path, status, durationMs: Date.now() - startedAt, ...responseSummary(data)
              });
            }
            resolve(data);
            return;
          }
          const error = rejectFromEnvelope(status, body);
          apiTrace('request.http_error', {
            method, path, status, code: error.code, durationMs: Date.now() - startedAt, message: error.message
          });
          reject(error);
        },
        fail(error) {
          const message = error && error.errMsg ? error.errMsg : 'NETWORK_ERROR';
          apiTrace('request.network_error', { method, path, durationMs: Date.now() - startedAt, message });
          reject(new Error(message));
        }
      });
    });
  }

  function pluginPath(hostId, pluginId, suffix = '') {
    return `/user/hosts/${encodeSegment(hostId)}/plugins/${encodeSegment(pluginId)}${suffix}`;
  }

  function conversationPath(hostId, pluginId, conversationId, suffix = '') {
    return `${pluginPath(hostId, pluginId)}/conversations/${encodeSegment(conversationId)}${suffix}`;
  }

  /**
   * Opens one NDJSON state stream. Each decoded envelope becomes one frame
   * callback carrying the envelope `data` payload. Transport-level failures
   * are surfaced through onClose({reason}).
   *
   * Transport: state streams use fetch exclusively. Hosts exposing a readable
   * response.body are consumed incrementally; buffered fetch implementations
   * notify the caller so it can close and drain the server stream deliberately.
   * Error envelopes (success:false)
   * arrive as regular NDJSON lines and are converted to stream.error frames,
   * so HTTP error statuses need no special casing here.
   */
  function openStateStream(streamConfig) {
    const {
      scope, hostId = '', pluginId = '', conversationId = '', draftId = '',
      streamId, clientInstanceId, onFrame, onClose, onBuffered
    } = streamConfig;
    if (!baseUrl) {
      apiTrace('stream.rejected', { scope, reason: 'API_BASE_URL_MISSING' });
      if (onClose) onClose({ reason: 'API_BASE_URL_MISSING' });
      return { abort() {} };
    }
    const query = [`scope=${encodeSegment(scope)}`];
    if (hostId) query.push(`host_id=${encodeSegment(hostId)}`);
    if (pluginId) query.push(`plugin_id=${encodeSegment(pluginId)}`);
    if (conversationId) query.push(`conversation_id=${encodeSegment(conversationId)}`);
    if (draftId) query.push(`draft_id=${encodeSegment(draftId)}`);

    const headers = {
      Accept: 'application/x-ndjson, application/json',
      'Content-Type': 'application/json',
      'X-Prism-State-Stream-Id': streamId,
      'X-Prism-Client-Instance-Id': clientInstanceId
    };
    applyAuthHeader(headers);

    const openedAt = Date.now();
    let lineCount = 0;
    let frameCount = 0;
    const reader = createLineReader((line) => {
      lineCount += 1;
      // Active conversations emit one line per assistant update; tracing every
      // line floods the diagnostics channel, so sample like stream reads.
      if (shouldTraceStreamRead(lineCount)) {
        apiTrace('stream.line.received', {
          streamId,
          lineIndex: lineCount,
          chars: line.length,
          elapsedMs: Date.now() - openedAt
        });
      }
      let envelope;
      try {
        envelope = JSON.parse(line);
      } catch (error) {
        apiTrace('stream.parse_error', {
          streamId,
          lineIndex: lineCount,
          chars: line.length,
          format: line.indexOf('data:') === 0 ? 'sse-data' : (line.indexOf('event:') === 0 ? 'sse-event' : 'unknown'),
          reason: String(error && error.message || error)
        });
        return;
      }
      if (!envelope || typeof envelope !== 'object') return;
      const frame = envelope.success === false
        ? {
          type: 'stream.error',
          state_stream_id: streamId,
          code: String(envelope.code || 'stream_error').toLowerCase(),
          message: envelope.message || '',
          retryable: true
        }
        : (envelope.data && typeof envelope.data === 'object' ? envelope.data : {});
      frameCount += 1;
      if (shouldTraceStreamRead(frameCount)) {
        apiTrace('stream.frame.decoded', {
          streamId,
          frameIndex: frameCount,
          lineIndex: lineCount,
          type: frame.type || '',
          firstFrame: frameCount === 1,
          elapsedMs: Date.now() - openedAt
        });
      }
      if (onFrame) onFrame(frame);
    });

    let closed = false;
    function finish(reason, extra) {
      if (closed) return;
      closed = true;
      if (onClose) onClose({ reason, ...extra });
    }

    const fetchImpl = typeof fetch === 'function'
      ? fetch
      : (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
    if (fetchImpl) {
      const streamUrl = `${baseUrl}${STATE_STREAM_PATH}?${query.join('&')}`;
      apiTrace('stream.open', {
        scope, hostId, pluginId, conversationId, streamId, transport: 'fetch',
        baseUrl,
        hasAbortController: typeof AbortController !== 'undefined'
      });
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let bodyReader = null;
      let aborted = false;
      let stage = 'fetch.start';
      let readCount = 0;
      let chunkCount = 0;
      let totalBytes = 0;
      let lastChunkAt = openedAt;

      async function pump() {
        apiTrace('stream.fetch.start', { streamId, path: STATE_STREAM_PATH, elapsedMs: Date.now() - openedAt });
        const fetchStartedAt = Date.now();
        const response = await fetchImpl(streamUrl, {
          method: 'GET',
          headers,
          signal: controller ? controller.signal : undefined
        });
        stage = 'response.accepted';
        const status = Number(response && response.status || 0);
        const body = response && response.body;
        apiTrace('stream.fetch.accepted', {
          streamId,
          status,
          ok: Boolean(response && response.ok),
          fetchMs: Date.now() - fetchStartedAt,
          elapsedMs: Date.now() - openedAt,
          hasBody: Boolean(body),
          bodyType: typeof body,
          getReaderType: body ? typeof body.getReader : '',
          contentType: responseHeader(response, 'content-type'),
          contentLength: responseHeader(response, 'content-length'),
          cacheControl: responseHeader(response, 'cache-control')
        });
        if (body) {
          // Follow AIUI's loadStreamPreview() contract directly. Avoid feature
          // testing bridged stream methods with typeof; native host methods can
          // be callable without presenting exactly like browser JS functions.
          stage = 'reader.acquire';
          bodyReader = body.getReader();
          apiTrace('stream.fetch.reader_acquired', {
            streamId,
            readerType: typeof bodyReader,
            readType: bodyReader ? typeof bodyReader.read : '',
            elapsedMs: Date.now() - openedAt
          });
          for (;;) {
            stage = 'reader.read';
            readCount += 1;
            const readStartedAt = Date.now();
            if (shouldTraceStreamRead(readCount)) {
              apiTrace('stream.fetch.read_wait', {
                streamId,
                readIndex: readCount,
                idleMs: readStartedAt - lastChunkAt,
                elapsedMs: readStartedAt - openedAt
              });
            }
            const { value, done } = await bodyReader.read();
            const readFinishedAt = Date.now();
            if (done) {
              apiTrace('stream.fetch.read_done', {
                streamId,
                readIndex: readCount,
                waitMs: readFinishedAt - readStartedAt,
                chunks: chunkCount,
                totalBytes,
                lines: lineCount,
                frames: frameCount,
                elapsedMs: readFinishedAt - openedAt
              });
              break;
            }
            if (value) {
              chunkCount += 1;
              const stats = reader.push(value);
              totalBytes += stats.byteLength;
              lastChunkAt = readFinishedAt;
              if (shouldTraceStreamRead(readCount) || stats.emittedLines || stats.overflowed) {
                apiTrace('stream.fetch.chunk', {
                  streamId,
                  readIndex: readCount,
                  chunkIndex: chunkCount,
                  waitMs: readFinishedAt - readStartedAt,
                  bytes: stats.byteLength,
                  totalBytes,
                  decodedChars: stats.decodedChars,
                  emittedLines: stats.emittedLines,
                  bufferedChars: stats.bufferedChars,
                  overflowed: stats.overflowed,
                  elapsedMs: readFinishedAt - openedAt
                });
              }
            } else {
              apiTrace('stream.fetch.empty_chunk', {
                streamId,
                readIndex: readCount,
                waitMs: readFinishedAt - readStartedAt,
                elapsedMs: readFinishedAt - openedAt
              });
            }
          }
          bodyReader = null;
        } else {
          stage = 'response.text';
          apiTrace('stream.fetch.buffered_mode', { streamId, status, elapsedMs: Date.now() - openedAt });
          if (onBuffered) onBuffered({ streamId, status });
          const textStartedAt = Date.now();
          apiTrace('stream.fetch.buffered_wait', { streamId, elapsedMs: textStartedAt - openedAt });
          const text = await response.text();
          if (text) reader.push(stringToBytes(text));
          apiTrace('stream.fetch.buffered_body', {
            streamId,
            status,
            bytes: text ? text.length : 0,
            waitMs: Date.now() - textStartedAt,
            lines: lineCount,
            frames: frameCount,
            elapsedMs: Date.now() - openedAt
          });
        }
        stage = 'decoder.flush';
        const flushStats = reader.flush();
        apiTrace('stream.decoder.flushed', { streamId, ...flushStats, elapsedMs: Date.now() - openedAt });
        apiTrace('stream.completed', {
          streamId,
          status,
          transport: 'fetch',
          reads: readCount,
          chunks: chunkCount,
          totalBytes,
          lines: lineCount,
          frames: frameCount,
          elapsedMs: Date.now() - openedAt
        });
        finish('completed');
      }

      pump().catch((error) => {
        if (aborted) {
          apiTrace('stream.aborted', { streamId, transport: 'fetch' });
          finish('aborted');
          return;
        }
        const message = String(error && error.message || error);
        apiTrace('stream.failed', {
          streamId,
          transport: 'fetch',
          stage,
          reads: readCount,
          chunks: chunkCount,
          totalBytes,
          lines: lineCount,
          frames: frameCount,
          elapsedMs: Date.now() - openedAt,
          message
        });
        finish('failed', { message });
      });

      return {
        abort() {
          if (closed) return;
          aborted = true;
          try {
            if (bodyReader && typeof bodyReader.cancel === 'function') bodyReader.cancel();
          } catch (error) {
            apiTrace('stream.abort_error', { streamId, message: String(error && error.message || error) });
          }
          try {
            if (controller) controller.abort();
          } catch (error) {
            apiTrace('stream.abort_error', { streamId, message: String(error && error.message || error) });
          }
        }
      };
    }

    apiTrace('stream.rejected', { streamId, reason: 'FETCH_UNAVAILABLE' });
    finish('FETCH_UNAVAILABLE');
    return { abort() {} };
  }

  return {
    getMe() {
      return request('/user/me');
    },
    getHostPlugins(knownSignature = '') {
      const query = knownSignature ? `?known_signature=${encodeSegment(knownSignature)}` : '';
      return request(`/user/host-plugins${query}`);
    },
    getConversationIndex(hostId, pluginId, knownSignature = '') {
      const query = knownSignature ? `?known_signature=${encodeSegment(knownSignature)}` : '';
      return request(`${pluginPath(hostId, pluginId, '/conversation-index')}${query}`);
    },
    getSelection() {
      return request('/user/remote-selection');
    },
    setSelection(selection) {
      return request('/user/remote-selection', { method: 'PUT', data: selection });
    },
    markRead(hostId, pluginId, conversationId) {
      return request(conversationPath(hostId, pluginId, conversationId, ':read'), { method: 'PUT', data: {} });
    },
    sendMessage(hostId, pluginId, conversationId, payload = {}) {
      return request(conversationPath(hostId, pluginId, conversationId, '/messages'), {
        method: 'POST',
        data: {
          content: payload.content || '',
          message_id: payload.message_id || payload.request_id || '',
          attachments: payload.attachments || [],
          cwd: payload.cwd || '',
          metadata: payload.metadata || {},
          source_device: payload.source_device || SOURCE_DEVICE
        }
      });
    },
    openDraft(hostId, pluginId, payload = {}) {
      return request(pluginPath(hostId, pluginId, '/conversation-drafts'), {
        method: 'POST',
        data: { cwd: payload.cwd || '', source_device: payload.source_device || SOURCE_DEVICE }
      });
    },
    startDraft(hostId, pluginId, draftId, payload = {}) {
      return request(pluginPath(hostId, pluginId, `/conversation-drafts/${encodeSegment(draftId)}:start`), {
        method: 'POST',
        data: {
          message_id: payload.message_id || '',
          content: payload.content || '',
          attachments: payload.attachments || [],
          cwd: payload.cwd || '',
          source_device: payload.source_device || SOURCE_DEVICE
        }
      });
    },
    interrupt(hostId, pluginId, conversationId, taskId = '') {
      return request(conversationPath(hostId, pluginId, conversationId, ':interrupt'), {
        method: 'POST',
        data: { task_id: taskId || '', reason: 'user_interrupt', source_device: SOURCE_DEVICE }
      });
    },
    resolveApproval(hostId, pluginId, conversationId, approvalRequestId, actionId, payload = {}) {
      const suffix = `/approvals/${encodeSegment(approvalRequestId)}:resolve`;
      const data = {
        action_id: actionId,
        task_id: payload.task_id || '',
        source_device: payload.source_device || SOURCE_DEVICE
      };
      if (payload.input) data.input = payload.input;
      return request(conversationPath(hostId, pluginId, conversationId, suffix), { method: 'POST', data });
    },
    control(hostId, pluginId, conversationId, action, target = {}, name = '', taskId = '') {
      return request(conversationPath(hostId, pluginId, conversationId, ':control'), {
        method: 'POST',
        data: {
          action,
          target: target && typeof target === 'object' ? target : {},
          name: name || '',
          task_id: taskId || '',
          source_device: SOURCE_DEVICE
        }
      });
    },
    closeStateStream(stateStreamId) {
      if (!stateStreamId) return Promise.resolve({});
      return request(`/user/remote/state-streams/${encodeSegment(stateStreamId)}`, { method: 'DELETE' });
    },
    openConversationStream(streamConfig) {
      return openStateStream({ ...streamConfig, scope: 'conversation' });
    },
    openHomeStream(streamConfig) {
      return openStateStream({ ...streamConfig, scope: 'home' });
    }
  };
}

function stringToBytes(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xFF;
  return out;
}

export function agentIconFor(plugin = {}) {
  const key = `${plugin.plugin_id || ''} ${plugin.local_agent_id || ''} ${plugin.local_agent || ''} ${plugin.display_name || ''}`.toLowerCase();
  if (key.includes('claude code') || key.includes('claudecode')) return 'claudecode';
  if (key.includes('codebuddy')) return 'codebuddy';
  if (key.includes('openclaw')) return 'openclaw';
  if (key.includes('hermes')) return 'hermesagent';
  if (key.includes('claude')) return 'claude';
  if (key.includes('codex')) return 'codex';
  return 'openai';
}

export function readableError(error) {
  const code = String(error && error.code || '').toLowerCase();
  const message = error && error.message ? error.message : '';
  if (error && error.statusCode === 401 || code === 'unauthorized' || code === 'c100401') return t('api.error.unauthorized');
  if (code === 'permission_denied' || code === 'host_forbidden') return t('api.error.permissionDenied');
  if (code === 'host_offline' || code === 'realtime_target_missing' || code === 'host_not_connected') return t('api.error.hostOffline');
  if (code === 'plugin_unavailable') return t('api.error.pluginUnavailable');
  if (code === 'conversation_unavailable') return t('api.error.conversationUnavailable');
  if (code === 'conversation_start_failed') return t('api.error.conversationStartFailed');
  if (code === 'draft_stale') return t('api.error.draftStale');
  if (code === 'control_target_stale') return t('api.error.controlTargetStale');
  if (code === 'invalid_parameter' || code === 'missing_required_field') return t('api.error.invalidParameter');
  if (message === 'API_BASE_URL_MISSING') return t('api.error.baseUrlMissing');
  return message || t('api.error.networkFailed');
}
