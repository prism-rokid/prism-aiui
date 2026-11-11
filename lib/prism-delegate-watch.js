import { createStreamId } from './prism-api.js';
import { directoryKey } from './prism-delegate-projects.js';

// 草稿响应没有会话 ID 时，在目标目录中查找新会话。回执不确定时还需核对原消息。
export async function findNewConversation(api, {
  hostId,
  pluginId,
  cwd,
  knownConversationIds = [],
  submission,
  sinceTs = 0,
  pollMs = 2000,
  timeoutMs = 30000,
  isAborted = () => false
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const expectedDirectory = directoryKey(cwd);
  const known = new Set(knownConversationIds);
  while (Date.now() < deadline && !isAborted()) {
    try {
      const response = await api.getConversationIndex(hostId, pluginId);
      if (isAborted()) return null;
      const items = Array.isArray(response?.items) ? response.items : [];
      const candidates = items.filter((item) => {
        const conversationId = String(item?.conversation_id || '');
        return conversationId && !known.has(conversationId)
          && (!expectedDirectory || directoryKey(item.cwd) === expectedDirectory)
          && (Number(item.updated_at) || 0) >= sinceTs;
      }).sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
      for (const { conversation_id: id } of candidates) {
        if (isAborted() || Date.now() >= deadline) return null;
        if (!submission || await confirmSubmission(api, {
          hostId, pluginId, conversationId: String(id), submission,
          timeoutMs: Math.min(4000, deadline - Date.now())
        })) return String(id);
      }
    } catch {
      // 索引暂不可得时继续轮询，直到超时。
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  return null;
}

function frameMessages(frame) {
  if (frame?.type === 'conversation.messages.turn') return frame.turn?.messages;
  if (frame?.type === 'conversation.snapshot') return frame.detail?.messages || frame.detail?.page_messages;
}

function messageTime(value) {
  const numeric = Number(value);
  return numeric > 0 ? (numeric < 10000000000 ? numeric * 1000 : numeric) : Date.parse(value) || 0;
}

function matchesSubmission(message, submission) {
  if (message?.role !== 'user' || ['failed', 'sending'].includes(message.status)) return false;
  if (message.id === submission.messageId || message.message_id === submission.messageId) return true;
  const createdAt = messageTime(message.created_at);
  return String(message.content || '').trim() === submission.message
    && (!createdAt || createdAt >= submission.startedAt - 30000);
}

function closeReplyStream(api, streamId, handle) {
  try { handle?.abort(); } catch { /* 连接可能已经关闭 */ }
  try { void api.closeStateStream(streamId).catch(() => {}); } catch { /* 尽力释放服务端订阅 */ }
}

function confirmSubmission(api, { hostId, pluginId, conversationId, submission, timeoutMs }) {
  return new Promise((resolve) => {
    const streamId = createStreamId('delegate-check');
    let handle;
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(matched) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeReplyStream(api, streamId, handle);
      resolve(matched);
    }
    try {
      handle = api.openConversationStream({
        hostId, pluginId, conversationId, streamId,
        clientInstanceId: createStreamId('client'),
        onClose: () => finish(false),
        onFrame(frame) {
          const messages = frameMessages(frame);
          if (Array.isArray(messages) && messages.some((message) => matchesSubmission(message, submission))) {
            finish(true);
          } else if (frame?.type === 'stream.error' || frame?.type === 'stream.close') {
            finish(false);
          }
        }
      });
      if (settled) handle?.abort();
    } catch {
      finish(false);
    }
  });
}

export function watchAgentReply(api, {
  hostId,
  pluginId,
  conversationId,
  minCreatedAt = 0,
  submission,
  onText = () => {},
  onCompleted = () => {},
  onError = () => {},
  completionIdleMs = 30000,
  totalTimeoutMs = 180000,
  retryDelayMs = 1000
} = {}) {
  const clientInstanceId = createStreamId('client');
  let active;
  let retryTimer;
  let attempts = 0;
  let stopped = false;
  let lastText = '';
  let targetTurnId = '';

  function absorb(frame, messages) {
    if (!Array.isArray(messages)) return;
    const turnId = frame.turn?.turn_id || '';
    if (submission) {
      if (targetTurnId && turnId && targetTurnId !== turnId) return;
      if (!targetTurnId || !turnId) {
        const userIndex = messages.findIndex((message) => matchesSubmission(message, submission));
        if (userIndex < 0) return;
        if (turnId) targetTurnId = turnId;
        messages = messages.slice(userIndex + 1);
        const nextUser = messages.findIndex((message) => message?.role === 'user');
        if (nextUser >= 0) messages = messages.slice(0, nextUser);
      }
    }
    let reply = '';
    let progressText = '';
    let running = false;
    let completed = false;
    for (const message of messages) {
      if (!message || message.role !== 'assistant') continue;
      const createdAt = messageTime(message.created_at);
      if (minCreatedAt && createdAt && createdAt < minCreatedAt) continue;
      const content = String(message.content || '');
      const status = message.progress?.status || message.status;
      if (message.type === 'progress') {
        const steps = message.progress?.steps;
        const assistantSteps = Array.isArray(steps) ? steps.filter((step) => step.kind === 'assistant_text') : [];
        progressText = (status === 'running' ? content : '') || assistantSteps.at(-1)?.detail || progressText;
      } else {
        if (!content.trim()) continue;
        reply = content;
        completed ||= !status;
      }
      running ||= status === 'running' || status === 'streaming';
      completed ||= status === 'completed' || status === 'ok';
    }
    const latest = reply || progressText;
    if (!latest.trim()) return;
    if (latest !== lastText) {
      lastText = latest;
      onText(latest);
    }
    if (!running && completed) finish();
  }

  function finish() {
    stop();
    onCompleted(lastText);
  }

  function closeActive() {
    const stream = active;
    active = null;
    if (!stream) return;
    clearTimeout(stream.idleTimer);
    closeReplyStream(api, stream.id, stream.handle);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (retryTimer != null) clearTimeout(retryTimer);
    clearTimeout(deadline);
    closeActive();
  }

  function fail(message) {
    stop();
    onError(message);
  }

  function reconnect(stream, message) {
    if (active !== stream) return;
    closeActive();
    if (attempts >= 3) {
      fail(message);
      return;
    }
    retryTimer = setTimeout(connect, retryDelayMs * attempts);
  }

  function connect() {
    if (stopped) return;
    retryTimer = undefined;
    attempts += 1;
    const stream = { id: createStreamId('delegate') };
    active = stream;
    function resetIdle() {
      if (stream.idleTimer != null) clearTimeout(stream.idleTimer);
      stream.idleTimer = setTimeout(() => reconnect(stream, 'reply stream idle'), completionIdleMs);
    }
    resetIdle();
    try {
      stream.handle = api.openConversationStream({
        hostId, pluginId, conversationId, streamId: stream.id, clientInstanceId,
        onFrame(frame) {
          if (active !== stream) return;
          const messages = frameMessages(frame);
          if (messages?.length) {
            resetIdle();
            absorb(frame, messages);
          } else if (frame?.type === 'conversation.messages.page.end' && frame.error && !frame.retryable) {
            reconnect(stream, 'reply history unavailable');
          } else if (frame?.type === 'stream.error' || frame?.type === 'stream.close') {
            reconnect(stream, frame.message || frame.code || frame.type);
          }
        },
        onClose: (result) => reconnect(stream, result?.message || result?.reason || 'reply stream closed')
      });
      if (active !== stream) stream.handle?.abort();
    } catch (error) {
      reconnect(stream, error?.message || String(error));
    }
  }

  const deadline = setTimeout(() => fail('reply watch timed out'), totalTimeoutMs);
  connect();
  return { stop };
}
