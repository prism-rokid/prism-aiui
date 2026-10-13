import assert from 'node:assert/strict';
import test from 'node:test';
import { agentIconFor, createPrismApi, createStreamId, readableError, PRODUCTION_API_BASE_URL } from '../lib/prism-api.js';
import { setLocale } from '../lib/prism-i18n.js';

// Pin zh-CN: readableError assertions expect Chinese mappings and Node's
// own navigator.language would otherwise resolve the packs to en-US.
setLocale('zh-CN', { persist: false });

function mockWx(handler) {
  return {
    request(options) {
      handler(options);
      return { abort() {} };
    }
  };
}

function envelope(data) {
  return { success: true, code: 'ok', message: '', data };
}

test('API client targets the host-plugin route model and unwraps the envelope', async () => {
  let request;
  const wx = mockWx((options) => {
    request = options;
    options.success({ statusCode: 200, data: envelope({ changed: true, items: [{ host_id: 'host-1', plugin_id: 'codex.automation' }] }) });
  });
  const api = createPrismApi(wx, { baseUrl: 'https://prism.example/', accountToken: 'token-1' });

  const response = await api.getConversationIndex('host-1', 'codex/ui', 'known sig');
  assert.deepEqual(response.items, [{ host_id: 'host-1', plugin_id: 'codex.automation' }]);
  assert.equal(request.url, 'https://prism.example/user/hosts/host-1/plugins/codex%2Fui/conversation-index?known_signature=known%20sig');
  assert.equal(request.header['X-Account-Token'], 'token-1');
  assert.equal(request.responseType, 'text');
});

test('device credentials preserve the Prism X-Account-Token header key', async () => {
  let requestOptions = null;
  const api = createPrismApi(mockWx((options) => {
    requestOptions = options;
    options.success({ statusCode: 200, data: envelope({ items: [] }) });
  }), {
    baseUrl: 'https://prism.example',
    accountToken: 'device-token'
  });

  await api.getHostPlugins();

  assert.equal(requestOptions.header['X-Account-Token'], 'device-token');
  assert.equal(requestOptions.header.Authorization, undefined);
});

test('packaged builds default to the production gateway, with no local override', () => {
  assert.equal(PRODUCTION_API_BASE_URL, 'https://ai-cloud.rokid.com/prism/api');
  assert.doesNotMatch(PRODUCTION_API_BASE_URL, /localhost|127\.0\.0\.1/);
});

test('send message uses content field and glasses source device', async () => {
  let body;
  let url;
  const api = createPrismApi(mockWx((options) => {
    url = options.url;
    body = options.data;
    options.success({ statusCode: 202, data: envelope({ accepted: true }) });
  }), { baseUrl: 'https://prism.example' });

  await api.sendMessage('host-1', 'codex.automation', 'remote:abc', { message_id: 'msg-1', content: '继续' });
  assert.equal(url, 'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversations/remote%3Aabc/messages');
  assert.equal(body.content, '继续');
  assert.equal(body.message_id, 'msg-1');
  assert.equal(body.source_device, 'rokid-glasses-aiui');
});

test('new conversation flow goes through draft open and start', async () => {
  const requests = [];
  const api = createPrismApi(mockWx((options) => {
    requests.push({ url: options.url, method: options.method, data: options.data });
    options.success({
      statusCode: 200,
      data: envelope(requests.length === 1 ? { draft_id: 'draft-1', accepted: true } : { accepted: true })
    });
  }), { baseUrl: 'https://prism.example' });

  const draft = await api.openDraft('host-1', 'codex.automation', { cwd: '/workspace/demo' });
  assert.equal(draft.draft_id, 'draft-1');
  await api.startDraft('host-1', 'codex.automation', draft.draft_id, {
    message_id: 'msg-1',
    content: '帮我检查这个仓库',
    cwd: '/workspace/demo'
  });

  assert.deepEqual(requests.map((request) => request.url), [
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversation-drafts',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversation-drafts/draft-1:start'
  ]);
  assert.equal(requests[1].data.message_id, 'msg-1');
  assert.equal(requests[1].data.content, '帮我检查这个仓库');
});

test('selection, index, read, interrupt, approval and control endpoints match the new contract', async () => {
  const requests = [];
  const api = createPrismApi(mockWx((options) => {
    requests.push({ url: options.url, method: options.method, data: options.data });
    options.success({ statusCode: 202, data: envelope({ accepted: true }) });
  }), { baseUrl: 'https://prism.example' });

  await api.setSelection({ selected_host_id: 'host-1', selected_plugin_id: 'codex.automation', selected_conversation_id: 'remote:1', activate_desktop: true });
  await api.getHostPlugins('plugin sig');
  await api.getConversationIndex('host-1', 'codex.automation', 'conv sig');
  await api.markRead('host-1', 'codex.automation', 'remote:1');
  await api.interrupt('host-1', 'codex.automation', 'remote:1', 'task-1');
  await api.resolveApproval('host-1', 'codex.automation', 'remote:1', 'approval/1', 'approve', { task_id: 'task-1' });
  await api.control('host-1', 'codex.automation', 'remote:1', 'model.switch', { option_id: 'gpt-5.6' }, '', 'task-1');
  await api.closeStateStream('conv-1');

  assert.deepEqual(requests.map((request) => request.url), [
    'https://prism.example/user/remote-selection',
    'https://prism.example/user/host-plugins?known_signature=plugin%20sig',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversation-index?known_signature=conv%20sig',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversations/remote%3A1:read',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversations/remote%3A1:interrupt',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversations/remote%3A1/approvals/approval%2F1:resolve',
    'https://prism.example/user/hosts/host-1/plugins/codex.automation/conversations/remote%3A1:control',
    'https://prism.example/user/remote/state-streams/conv-1'
  ]);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].data.activate_desktop, true);
  assert.equal(requests[3].method, 'PUT');
  assert.equal(requests[4].data.reason, 'user_interrupt');
  assert.equal(requests[5].data.action_id, 'approve');
  assert.deepEqual(requests[6].data.target, { option_id: 'gpt-5.6' });
  assert.equal(requests[7].method, 'DELETE');
});

test('conversation state stream uses fetch and decodes NDJSON frames', async () => {
  const realFetch = globalThis.fetch;
  let fetchCall = null;
  const snapshot = JSON.stringify(envelope({ type: 'conversation.snapshot', conversation_id: 'remote:abc', detail: { title: 'Fix bug' } }));
  const turn = JSON.stringify(envelope({ type: 'conversation.messages.turn', conversation_id: 'remote:abc', turn: { turn_id: 'turn-1', messages: [{ id: 'm-1' }] } }));
  const turnBytes = new Uint8Array(Buffer.from(`${turn}\n`, 'utf8'));
  const errorLine = new Uint8Array(Buffer.from(JSON.stringify({ success: false, code: 'stream_overloaded', message: 'busy' }), 'utf8'));
  // Split the second line across two chunks to prove partial UTF-8 lines survive.
  const chunks = [
    new Uint8Array(Buffer.from(`${snapshot}\n`, 'utf8')),
    turnBytes.subarray(0, Math.floor(turnBytes.length / 2)),
    turnBytes.subarray(Math.floor(turnBytes.length / 2)),
    errorLine
  ];
  let cursor = 0;
  let readerCancelled = false;
  globalThis.fetch = async (url, init) => {
    fetchCall = { url, init };
    return {
      status: 200,
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (cursor < chunks.length) return { done: false, value: chunks[cursor++] };
              return { done: true };
            },
            cancel() { readerCancelled = true; }
          };
        }
      }
    };
  };
  try {
    const wx = { request() { throw new Error('wx.request must not be used when fetch exists'); } };
    const api = createPrismApi(wx, { baseUrl: 'https://prism.example', accountToken: 'token-1' });
    const frames = [];
    let closed = null;
    const streamId = createStreamId('conv');

    const handle = api.openConversationStream({
      hostId: 'host-1',
      pluginId: 'codex.automation',
      conversationId: 'remote:abc',
      streamId,
      clientInstanceId: 'client-1',
      onFrame: (frame) => frames.push(frame),
      onClose: (reason) => { closed = reason; }
    });
    assert.equal(typeof handle.abort, 'function');
    assert.ok(fetchCall, 'fetch transport was used');
    assert.equal(
      fetchCall.url,
      'https://prism.example/user/remote/state-stream?scope=conversation&host_id=host-1&plugin_id=codex.automation&conversation_id=remote%3Aabc'
    );
    assert.equal(fetchCall.init.method, 'GET');
    assert.equal(fetchCall.init.headers['X-Prism-State-Stream-Id'], streamId);
    assert.equal(fetchCall.init.headers['X-Prism-Client-Instance-Id'], 'client-1');
    assert.equal(fetchCall.init.headers['X-Account-Token'], 'token-1');
    assert.ok(fetchCall.init.signal, 'an abort signal is wired for closing the stream');

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(frames.map((frame) => frame.type), [
      'conversation.snapshot',
      'conversation.messages.turn',
      'stream.error'
    ]);
    assert.equal(frames[0].detail.title, 'Fix bug');
    assert.equal(frames[1].turn.messages[0].id, 'm-1');
    assert.equal(frames[2].code, 'stream_overloaded');
    assert.equal(closed && closed.reason, 'completed');
    assert.equal(readerCancelled, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('state stream emits UTF-8 frames before the HTTP response completes', async () => {
  const realFetch = globalThis.fetch;
  const payload = Buffer.from(`${JSON.stringify(envelope({
    type: 'conversation.snapshot',
    detail: { title: '流式返回' }
  }))}\n`, 'utf8');
  const splitAt = payload.indexOf(Buffer.from('流', 'utf8')) + 1;
  const chunks = [
    new Uint8Array(payload.subarray(0, splitAt)),
    new Uint8Array(payload.subarray(splitAt))
  ];
  let readCount = 0;
  let releaseSecondChunk;
  let finishResponse;
  let markSecondReadPending;
  let markCompletionReadPending;
  const secondReadPending = new Promise((resolve) => { markSecondReadPending = resolve; });
  const completionReadPending = new Promise((resolve) => { markCompletionReadPending = resolve; });

  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            readCount += 1;
            if (readCount === 1) return Promise.resolve({ done: false, value: chunks[0] });
            if (readCount === 2) {
              markSecondReadPending();
              return new Promise((resolve) => {
                releaseSecondChunk = () => resolve({ done: false, value: chunks[1] });
              });
            }
            markCompletionReadPending();
            return new Promise((resolve) => {
              finishResponse = () => resolve({ done: true });
            });
          },
          cancel() {}
        };
      }
    }
  });

  try {
    const diagnostics = [];
    const api = createPrismApi({ request() {} }, {
      baseUrl: 'https://prism.example',
      onLog: (level, message) => diagnostics.push({ level, message })
    });
    const frames = [];
    let closed = null;
    api.openConversationStream({
      hostId: 'host-1', pluginId: 'codex', conversationId: 'c-1',
      streamId: 'conv-live', clientInstanceId: 'client-1',
      onFrame: (frame) => frames.push(frame),
      onClose: (info) => { closed = info; }
    });

    await secondReadPending;
    assert.deepEqual(frames, [], 'an incomplete multi-byte character must remain buffered');
    releaseSecondChunk();
    await completionReadPending;
    assert.equal(frames.length, 1, 'the first frame should arrive while the response is still open');
    assert.equal(frames[0].detail.title, '流式返回');
    assert.equal(closed, null, 'the stream must still be open when the frame is delivered');
    assert.ok(diagnostics.some((entry) => entry.message.includes('"event":"stream.fetch.read_wait"')));
    assert.ok(diagnostics.some((entry) => entry.message.includes('"event":"stream.fetch.chunk"')));
    assert.ok(diagnostics.some((entry) => entry.message.includes('"event":"stream.line.received"')));
    assert.ok(diagnostics.some((entry) => entry.message.includes('"event":"stream.frame.decoded"')));

    finishResponse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(closed && closed.reason, 'completed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fallback fetch tolerates bodies without a streaming reader', async () => {
  const realFetch = globalThis.fetch;
  const payload = `${JSON.stringify(envelope({ type: 'conversation.snapshot', detail: { title: 'Buffered' } }))}\n`;
  globalThis.fetch = async () => ({ status: 200, ok: true, body: null, text: async () => payload });
  try {
    const api = createPrismApi({ request() {} }, { baseUrl: 'https://prism.example', accountToken: 'token-1' });
    const frames = [];
    let closed = null;
    let buffered = null;
    api.openConversationStream({
      hostId: 'host-1', pluginId: 'codex', conversationId: 'c-1',
      streamId: 'conv-1', clientInstanceId: 'client-1',
      onFrame: (frame) => frames.push(frame),
      onClose: (reason) => { closed = reason; },
      onBuffered: (info) => { buffered = info; }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(frames.map((frame) => frame.type), ['conversation.snapshot']);
    assert.equal(frames[0].detail.title, 'Buffered');
    assert.deepEqual(buffered, { streamId: 'conv-1', status: 200 });
    assert.equal(closed && closed.reason, 'completed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('conversation state stream does not fall back to wx.request when fetch is unavailable', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    let wxCalled = false;
    const wx = {
      request() {
        wxCalled = true;
        throw new Error('state streams must not use wx.request');
      }
    };
    const api = createPrismApi(wx, { baseUrl: 'https://prism.example', accountToken: 'token-1' });
    let closed = null;

    const handle = api.openConversationStream({
      hostId: 'host-1',
      pluginId: 'codex.automation',
      conversationId: 'remote:abc',
      streamId: 'conv-1',
      clientInstanceId: 'client-1',
      onFrame: () => {},
      onClose: (info) => { closed = info; }
    });
    assert.equal(typeof handle.abort, 'function');
    assert.equal(wxCalled, false);
    assert.equal(closed && closed.reason, 'FETCH_UNAVAILABLE');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('stream ids stay within the server identifier charset', () => {
  const id = createStreamId('conv');
  assert.match(id, /^[A-Za-z0-9-]{1,64}$/);
});

test('non-success envelopes expose API error semantics', async () => {
  const api = createPrismApi(mockWx((options) => {
    options.success({ statusCode: 409, data: { success: false, code: 'host_offline', message: 'Host 不在线', data: null } });
  }), { baseUrl: 'https://prism.example' });

  await assert.rejects(api.getHostPlugins(), (error) => {
    assert.equal(error.code, 'host_offline');
    assert.equal(readableError(error), '当前无网络，Agent 连接已断开');
    return true;
  });
});

test('new gateway error codes map to current user-facing states', () => {
  assert.equal(readableError({ code: 'host_not_connected' }), '当前无网络，Agent 连接已断开');
  assert.equal(readableError({ code: 'permission_denied' }), '没有权限访问当前 Agent');
  assert.equal(readableError({ code: 'conversation_unavailable' }), '会话当前不可用，请稍后重试');
  assert.equal(readableError({ code: 'draft_stale' }), '桌面草稿已失效，请重新发送');
  assert.equal(readableError({ code: 'control_target_stale' }), '控制目标已过期，请刷新后重试');
  assert.equal(readableError({ code: 'missing_required_field' }), '当前会话或请求参数不可用');
});

test('plugin icons cover every supported agent family', () => {
  assert.equal(agentIconFor({ plugin_id: 'codex.automation' }), 'codex');
  assert.equal(agentIconFor({ display_name: 'Claude Code' }), 'claudecode');
  assert.equal(agentIconFor({ plugin_id: 'hermes.remote' }), 'hermesagent');
  assert.equal(agentIconFor({ display_name: 'OpenClaw' }), 'openclaw');
  assert.equal(agentIconFor({ display_name: 'CodeBuddy' }), 'codebuddy');
  assert.equal(agentIconFor({ display_name: 'Unknown' }), 'openai');
});
