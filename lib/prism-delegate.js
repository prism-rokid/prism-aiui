// 委托调度核心：把用户的委托请求原文交给端上语言模型理解，结合接入的
// Agent 与最近会话选定发送目标，代用户发出委托消息。api 与 model 全部
// 依赖注入（页面层负责 i18n / 设备认证 / LanguageModel 的解析），本模块
// 不触碰 wx 或全局能力，可以直接在 node:test 里驱动。
//
// 状态机（onUpdate 依次回调）：
//   understanding → matching → sending → done | error
// 任一步失败进入 error；发送属于写操作，失败不自动重试。

// 与 lib/prism-api.js agentIconFor 保持一致的识别来源字段。
const AGENT_ALIAS_PATTERNS = [
  { pattern: /claude\s*code|claudecode/i },
  { pattern: /codebuddy/i },
  { pattern: /openclaw/i },
  { pattern: /hermes/i },
  { pattern: /claude/i },
  { pattern: /codex/i }
];

export const DELEGATE_SYSTEM_PROMPT = [
  '你是 Rokid 眼镜上的 Prism 委托调度器。用户会把一项任务委托给远程开发智能体执行。',
  '给定用户请求原文、可用智能体列表和最近会话列表，选择最合适的发送目标并撰写委托消息。',
  '只输出一个 JSON 对象，不要输出任何其他文字，格式：',
  '{"conversation_id": "...", "agent_key": "host_id::plugin_id", "message": "...", "reason": "..."}',
  '规则：',
  '1. 用户点名的智能体优先（如"让CodeX清空回收站"中的 CodeX）。',
  '2. 有语义相关的最近会话时优先复用该会话，并填入其 conversation_id。',
  '3. 无合适会话时，选最相近的智能体，conversation_id 留空字符串，由调用方新建会话。',
  '4. message 用第一人称简洁中文转述用户请求，保留文件名、路径等关键细节。',
  '5. agent_key 必须来自可用智能体列表，conversation_id 必须来自最近会话列表，绝不编造。'
].join('\n');

export const DEFAULT_MODEL_TIMEOUT_MS = 30000;
const MAX_CONVERSATIONS_IN_PROMPT = 10;
const MODEL_PARSE_RETRIES = 1;

export function agentKeyOf(agent) {
  return `${agent && agent.host_id || ''}::${agent && agent.plugin_id || ''}`;
}

// 仿 agentIconFor：把身份字段拼成一个可匹配的字符串。
export function agentIdentityText(agent) {
  return [
    agent && agent.plugin_id,
    agent && agent.local_agent_id,
    agent && agent.local_agent,
    agent && agent.display_name
  ].filter(Boolean).join(' ').toLowerCase();
}

export function availableAgentsFrom(plugins) {
  return (Array.isArray(plugins) ? plugins : [])
    .filter((agent) => agent && agent.connected && agent.available);
}

// 展平为全局会话列表，按更新时间倒序，供 LLM 与匹配逻辑共用。
export function aggregateConversations(agents, itemsByAgentKey) {
  const conversations = [];
  for (const agent of agents) {
    const key = agentKeyOf(agent);
    const items = itemsByAgentKey && itemsByAgentKey[key];
    for (const conversation of Array.isArray(items) ? items : []) {
      if (!conversation || !conversation.conversation_id) continue;
      conversations.push({
        conversationId: String(conversation.conversation_id),
        agentKey: key,
        agent,
        title: String(conversation.title || ''),
        status: String(conversation.status || ''),
        updatedAt: Number(conversation.updated_at) || 0
      });
    }
  }
  return conversations.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function compactConversationList(conversations, limit = MAX_CONVERSATIONS_IN_PROMPT) {
  return conversations.slice(0, limit).map((item) => ({
    conversation_id: item.conversationId,
    agent_key: item.agentKey,
    title: item.title,
    status: item.status,
    updated_at: item.updatedAt
  }));
}

export function buildDelegateUserPrompt(requestText, agents, conversations) {
  return JSON.stringify({
    request: String(requestText || ''),
    agents: agents.map((agent) => ({ agent_key: agentKeyOf(agent), name: agent.display_name || agent.plugin_id })),
    conversations: compactConversationList(conversations)
  });
}

// 截取首个花括号平衡的 JSON 片段，容忍围栏与前后闲话。
export function extractJsonBlock(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function parseDelegateDecision(raw) {
  const block = extractJsonBlock(raw);
  if (!block) return null;
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (error) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : '',
    agentKey: typeof parsed.agent_key === 'string' ? parsed.agent_key : '',
    message: typeof parsed.message === 'string' ? parsed.message.trim() : '',
    reason: typeof parsed.reason === 'string' ? parsed.reason : ''
  };
}

// 白名单校验：conversation_id 命中时以其归属 Agent 为准（防幻觉 agent_key）。
export function normalizeDecision(decision, agents, conversations, requestText) {
  if (!decision) return null;
  const byKey = new Map(agents.map((agent) => [agentKeyOf(agent), agent]));
  const conversation = decision.conversationId
    ? conversations.find((item) => item.conversationId === decision.conversationId) || null
    : null;
  const agent = conversation ? conversation.agent : byKey.get(decision.agentKey) || null;
  if (!agent) return null;
  return {
    agent,
    conversation,
    message: decision.message || String(requestText || ''),
    reason: decision.reason
  };
}

// 规则降级：请求原文中点名别名 → 该 Agent；否则第一个可用 Agent。
export function ruleFallbackDecision(requestText, agents, conversations) {
  if (!agents.length) return null;
  const text = String(requestText || '');
  let matched = null;
  for (const { pattern } of AGENT_ALIAS_PATTERNS) {
    matched = agents.find((agent) => pattern.test(text) && pattern.test(agentIdentityText(agent)));
    if (matched) break;
  }
  const agent = matched || agents[0];
  const conversation = conversations.find((item) => item.agentKey === agentKeyOf(agent)) || null;
  return { agent, conversation, message: text, reason: matched ? 'alias' : 'default' };
}

export function latestConversationOf(conversations, agent) {
  return conversations.find((item) => item.agentKey === agentKeyOf(agent)) || null;
}

export function nextDelegateMessageId(now = Date.now(), random = Math.random) {
  return `delegate-${now.toString(36)}-${random().toString(36).slice(2, 8)}`;
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * 创建委托调度器。依赖：
 *   api: createPrismApi 客户端（getHostPlugins/getConversationIndex/
 *        sendMessage/openDraft/startDraft）
 *   model: { availability(): Promise<string>, create(options): Promise<session> }
 * 返回 { run(requestText, onUpdate) }；onUpdate(phase, detail) 依次收到
 * understanding / matching / sending / done / error。
 */
export function createDelegateRunner({ api, model, timeoutMs = DEFAULT_MODEL_TIMEOUT_MS, log = () => {} } = {}) {
  async function fetchContext() {
    const pluginResponse = await api.getHostPlugins();
    const agents = availableAgentsFrom(pluginResponse && pluginResponse.items);
    const settled = await Promise.allSettled(agents.map((agent) =>
      api.getConversationIndex(agent.host_id, agent.plugin_id)));
    const itemsByAgentKey = {};
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const items = result.value && result.value.items;
      itemsByAgentKey[agentKeyOf(agents[index])] = Array.isArray(items) ? items : [];
    });
    return { agents, conversations: aggregateConversations(agents, itemsByAgentKey) };
  }

  async function decideWithModel(requestText, agents, conversations) {
    const session = await model.create({
      initialPrompts: [{ role: 'system', content: DELEGATE_SYSTEM_PROMPT }]
    });
    const userPrompt = buildDelegateUserPrompt(requestText, agents, conversations);
    let decision = null;
    for (let attempt = 0; attempt <= MODEL_PARSE_RETRIES && !decision; attempt += 1) {
      const raw = await withTimeout(session.prompt(userPrompt), timeoutMs, 'MODEL_TIMEOUT');
      decision = parseDelegateDecision(raw);
    }
    session.destroy();
    return decision;
  }

  async function deliver(target) {
    const { agent, conversation, message } = target;
    const messageId = nextDelegateMessageId();
    if (conversation) {
      await api.sendMessage(agent.host_id, agent.plugin_id, conversation.conversationId, {
        message_id: messageId,
        content: message
      });
      return conversation;
    }
    const draft = await api.openDraft(agent.host_id, agent.plugin_id, {});
    const draftId = draft && (draft.draft_id || draft.draftId) || '';
    if (!draftId) throw new Error('DRAFT_ID_MISSING');
    await api.startDraft(agent.host_id, agent.plugin_id, draftId, {
      message_id: messageId,
      content: message
    });
    return null;
  }

  return {
    async run(requestText, onUpdate = () => {}) {
      const emit = (phase, detail) => {
        log('delegate.phase', { phase, detail });
        onUpdate(phase, detail);
      };
      try {
        emit('understanding', { requestText: String(requestText || '') });
        const { agents, conversations } = await fetchContext();
        if (!agents.length) {
          emit('error', { code: 'noAgents' });
          return;
        }

        let target = null;
        try {
          if (model && (await model.availability()) === 'available') {
            const decision = await decideWithModel(requestText, agents, conversations);
            target = normalizeDecision(decision, agents, conversations, requestText);
          } else {
            log('delegate.model_unavailable', {});
          }
        } catch (error) {
          log('delegate.model_failed', { message: error && error.message });
        }
        if (!target) target = ruleFallbackDecision(requestText, agents, conversations);

        emit('matching', { agent: target.agent.display_name || target.agent.plugin_id });
        emit('sending', { agent: target.agent.display_name || target.agent.plugin_id });

        const conversation = await deliver(target);
        emit('done', {
          agent: target.agent.display_name || target.agent.plugin_id,
          conversationTitle: conversation ? conversation.title : '',
          isNewConversation: !conversation
        });
      } catch (error) {
        emit('error', { code: 'sendFailed', message: error && error.message || String(error) });
      }
    }
  };
}
