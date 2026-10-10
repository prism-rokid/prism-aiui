// Local CORS proxy for browser-preview development. The page runs on a local
// Preview origin, so same-origin requests to a Prism gateway need a relay;
// NDJSON state-stream responses are piped through unbuffered. Set
// PROXY_TARGET to relay a different gateway (e.g. production).
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PROXY_PORT || 9100);
const TARGET = (process.env.PROXY_TARGET || 'https://ai-cloud-test.rokid.com').replace(/\/+$/, '');

const FORWARD_HEADERS = new Set([
  'content-type', 'accept', 'x-account-token', 'authorization',
  'cache-control', 'pragma', 'if-none-match', 'if-modified-since',
  'x-prism-state-stream-id', 'x-prism-client-instance-id'
]);

const SKIP_RESP = new Set([
  'content-encoding', 'content-length', 'transfer-encoding',
  'connection', 'keep-alive', 'content-security-policy',
  'x-content-type-options', 'strict-transport-security'
]);

// Routes whose upstream response must be relayed incrementally instead of
// being buffered: the Prism NDJSON state stream relies on per-line flushes.
function isStreamingPath(url) {
  return url.indexOf('/state-stream') >= 0;
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, x-account-token, authorization, x-prism-state-stream-id, x-prism-client-instance-id',
    'access-control-max-age': '86400',
    'vary': 'origin'
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const upstreamUrl = TARGET + req.url;
  const streaming = isStreamingPath(req.url || '');
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (FORWARD_HEADERS.has(key.toLowerCase())) headers[key] = value;
  }
  if (streaming) {
    headers.accept = 'application/x-ndjson, application/json';
    headers['cache-control'] = 'no-cache';
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const startedAt = Date.now();
  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: 'manual'
    });
    const respHeaders = corsHeaders();
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('access-control-')) return;
      if (SKIP_RESP.has(key.toLowerCase())) return;
      respHeaders[key] = value;
    });
    if (streaming) {
      respHeaders['cache-control'] = 'no-cache, no-transform';
      respHeaders['x-accel-buffering'] = 'no';
      res.writeHead(upstream.status, respHeaders);
      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end();
      }
      console.log(`[cors-proxy] ${req.method} ${req.url} -> ${upstream.status} (streaming)`);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, respHeaders);
    res.end(buf);
    console.log(`[cors-proxy] ${req.method} ${req.url} -> ${upstream.status} (${Date.now() - startedAt}ms)`);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json', ...corsHeaders() });
      res.end(JSON.stringify({ error: 'PROXY_ERROR', message: String(error && error.message || error) }));
    } else {
      res.end();
    }
    console.error(`[cors-proxy] ${req.method} ${req.url} -> 502 ${error && error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`[cors-proxy] http://localhost:${PORT}  ->  ${TARGET}`);
  console.log(`[cors-proxy] set Prism apiBaseUrl = http://localhost:${PORT}/prism/api`);
});
