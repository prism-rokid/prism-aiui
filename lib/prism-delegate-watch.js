// 委托卡片的回复监视：发送完成后，找到被委托的会话并挂上状态流，把
// Agent 的流式回复实时回传给卡片（步骤四），回复完成进入步骤五。
//
// 两个入口：
//   findNewConversation  — 草稿新建路径拿不到 conversation_id，轮询会话
//                          索引直到出现 sinceTs 之后有更新的会话；
//   watchAgentReply      — 打开 conversation NDJSON 状态流，解析
//                          conversation.snapshot / conversation.messages.turn
//                          帧里的 assistant 消息，onText 回传最新回复文本，
//                          全部 assistant 消息脱离 sending 态即 onCompleted。
//
// 完成兜底：流关闭、空闲超时、总超时都按"以已收到的文本完成"处理，卡片
// 不悬挂。minCreatedAt 之前的旧 assistant 消息（复用会话里的历史回复）不
// 触发完成，避免把上一轮回复当成对本轮委托的答复。

import { createStreamId } from './prism-api.js';

export function assistantReplyFromMessages(messages) {
  let text = '';
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message && message.role === 'assistant') text = String(message.content || '');
  }
  return text;
}

export function isMessageComplete(message) {
  const status = String(message && message.status || '');
  return status === '' || status === 'completed' || status === 'ok';
}

export async function findNewConversation(api, {
  hostId,
  pluginId,
  sinceTs = 0,
  pollMs = 2000,
  timeoutMs = 30000,
  isAborted = () => false
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let best = null;
  while (Date.now() < deadline) {
    if (isAborted()) return null;
    try {
      const response = await api.getConversationIndex(hostId, pluginId);
      const items = Array.isArray(response && response.items) ? response.items : [];
      for (const item of items) {
        const updatedAt = Number(item && item.updated_at) || 0;
        if (updatedAt < sinceTs) continue;
        if (!best || updatedAt > best.updatedAt) {
          best = {
            conversationId: String(item.conversation_id || ''),
            title: String(item.title || ''),
            updatedAt
          };
        }
      }
      if (best) return best;
    } catch (error) {
      // 索引暂不可得时继续轮询，直到超时。
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

export function watchAgentReply(api, {
  hostId,
  pluginId,
  conversationId,
  minCreatedAt = 0,
  onText = () => {},
  onCompleted = () => {},
  onError = () => {},
  completionIdleMs = 30000,
  totalTimeoutMs = 180000,
  isAborted = () => false
} = {}) {
  const streamId = createStreamId('delegate');
  const clientInstanceId = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let stopped = false;
  let completed = false;
  let lastText = '';
  let lastActivityAt = startedAt;

  function absorb(messages) {
    if (stopped || completed || !Array.isArray(messages)) return;
    let latest = '';
    let sawAssistant = false;
    let allComplete = true;
    for (const message of messages) {
      if (!message || message.role !== 'assistant') continue;
      const createdAt = Number(message.created_at) || 0;
      if (minCreatedAt && createdAt && createdAt < minCreatedAt) continue;
      sawAssistant = true;
      latest = String(message.content || '');
      if (!isMessageComplete(message)) allComplete = false;
    }
    if (!sawAssistant) return;
    if (latest && latest !== lastText) {
      lastText = latest;
      onText(latest);
    }
    if (latest && allComplete) finish(lastText);
  }

  function handleFrame(frame) {
    if (stopped || completed) return;
    lastActivityAt = Date.now();
    if (!frame || !frame.type) return;
    if (frame.type === 'conversation.messages.turn') {
      absorb(frame.turn && frame.turn.messages);
    } else if (frame.type === 'conversation.snapshot') {
      const detail = frame.detail || {};
      absorb(detail.messages || detail.page_messages || []);
    } else if (frame.type === 'stream.close') {
      finish(lastText);
    } else if (frame.type === 'stream.error') {
      stop();
      onError(frame.message || frame.code || 'stream error');
    }
  }

  function finish(text) {
    if (completed || stopped) return;
    completed = true;
    stop();
    onCompleted(String(text || ''));
  }

  const watchdog = setInterval(() => {
    if (completed || stopped) return;
    if (isAborted() || Date.now() - lastActivityAt >= completionIdleMs
      || Date.now() - startedAt >= totalTimeoutMs) {
      finish(lastText);
    }
  }, 3000);

  const handle = api.openConversationStream({
    hostId,
    pluginId,
    conversationId,
    streamId,
    clientInstanceId,
    onFrame: handleFrame,
    onClose: () => finish(lastText),
    onBuffered: () => {}
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(watchdog);
    try {
      if (handle && typeof handle.abort === 'function') handle.abort();
    } catch (error) { /* 传输层已在关闭流程中 */ }
    try {
      api.closeStateStream(streamId).catch(() => {});
    } catch (error) { /* 同步失败不影响完成回调 */ }
  }

  return { stop };
}
