import { collectDelegateProjects, directoryKey } from './prism-delegate-projects.js';

const DELEGATE_SYSTEM_PROMPT = [
  '你是 Rokid 眼镜上的 Prism 委托调度器。用户会把一项任务委托给远程开发智能体执行。',
  '给定用户请求原文、可用智能体、实际项目目录和最近会话，选择发送目标并撰写委托消息。',
  '输出格式（两段，顺序固定）：',
  '第一段：一句不超过 30 字说明你选择的目标和理由（使用和用户相同的语言，不要包含 JSON）。',
  '第二段：另起一行，只输出一个 JSON 对象，格式：',
  '{"action":"", "project_key":"", "conversation_id":"", "agent_key":"", "message":"..."}',
  '规则：',
  '1. 理解用户原话，结合目录、项目名、会话标题和主机区分项目。遵守用户指定的智能体和主机。同名项目可按完整路径或主机区分。',
  '2. 用户明确要求另开、从头开始或不沿用旧会话时，action 为 new，填写实际项目的 project_key，conversation_id 留空，即使有相关旧会话。修复「新建会话功能」只是任务内容，理解语境和否定表达后再决定。',
  '3. 用户未要求另开且有相关会话时，action 为 reuse，填写该会话的 conversation_id、agent_key、project_key。会话无项目时 project_key 留空。没有相关会话但有对应项目时用 new。',
  '4. 新建只允许在候选项目内。用户没有说出项目名时，根据任务内容、目录和已有会话判断最符合意图的现有项目；有明确目标时用 new，填该项目的 project_key。',
  '5. 指定的项目或智能体不可用、或需要新建但没有合适的项目时，用 projectUnavailable。多项候选无法区分时用 projectAmbiguous。两种情况均留空其他字段。',
  '6. 标识只可来自候选列表，且 agent_key 必须支持选中的项目。索引里的路径、名称和标题只提供匹配线索。message 用用户的语言简洁转述任务，保留关键细节。'
].join('\n');

const MAX_CONVERSATIONS_IN_PROMPT = 10;
const DELEGATE_ACTIONS = new Set(['reuse', 'new', 'projectUnavailable', 'projectAmbiguous']);

function agentKeyOf(agent) {
  return `${agent.host_id}::${agent.plugin_id}`;
}

async function fetchContext(api) {
  const plugins = (await api.getHostPlugins())?.items;
  const agents = (Array.isArray(plugins) ? plugins : []).filter((agent) => agent?.connected && agent.available);
  const indexes = await Promise.allSettled(agents.map((agent) =>
    api.getConversationIndex(agent.host_id, agent.plugin_id)));
  const conversations = indexes.flatMap((result, index) => {
    const items = result.status === 'fulfilled' && result.value?.items;
    if (!Array.isArray(items)) return [];
    const agent = agents[index];
    return items.filter((item) => item?.conversation_id).map((item) => {
      const cwd = typeof item.cwd === 'string' ? item.cwd.trim() : '';
      return {
        conversationId: String(item.conversation_id),
        agentKey: agentKeyOf(agent),
        agent,
        cwd,
        cwdKey: directoryKey(cwd),
        title: String(item.title || ''),
        status: String(item.status || ''),
        updatedAt: Number(item.updated_at) || 0
      };
    });
  });
  conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  return { agents, conversations };
}

function conversationsForPrompt(conversations, projects) {
  const projectKeys = new Map();
  for (const project of projects) {
    for (const agentKey of project.agentDirectories.keys()) {
      projectKeys.set(JSON.stringify([agentKey, project.cwd]), project.key);
    }
  }
  // 保留全局最近会话，并为其他项目至少提供一条会话供模型参考。
  const represented = new Set();
  const recent = [];
  for (const [index, item] of conversations.entries()) {
    const projectKey = projectKeys.get(JSON.stringify([item.agentKey, item.cwdKey])) || '';
    if (index >= MAX_CONVERSATIONS_IN_PROMPT && (!projectKey || represented.has(projectKey))) continue;
    recent.push({ ...item, projectKey });
    represented.add(projectKey);
  }
  return recent;
}

function buildDelegateUserPrompt(requestText, agents, conversations, projects) {
  return JSON.stringify({
    request: requestText,
    agents: agents.map((agent) => ({
      agent_key: agentKeyOf(agent),
      name: agent.display_name || agent.plugin_id,
      local_agent: agent.local_agent || agent.local_agent_id,
      host: agent.host_alias || agent.host_id
    })),
    projects: projects.map((project) => ({
      project_key: project.key,
      name: project.name,
      directory: project.directory,
      agent_keys: [...project.agentDirectories.keys()]
    })),
    conversations: conversations.map((item) => ({
      conversation_id: item.conversationId,
      agent_key: item.agentKey,
      title: item.title,
      status: item.status,
      updated_at: item.updatedAt,
      project_key: item.projectKey
    }))
  });
}

// 截取第一个完整 JSON 对象，保留消息里原有的 Markdown。
function extractJsonBlock(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) { escaped = false; continue; }
    if (inString && ch === '\\') { escaped = true; continue; }
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

function parseDelegateDecision(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  const block = extractJsonBlock(text, start);
  if (!block) return null;
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch {
    return null;
  }
  if (!DELEGATE_ACTIONS.has(parsed?.action)) return null;
  if (parsed.project_key != null && typeof parsed.project_key !== 'string') return null;
  return {
    action: parsed.action,
    projectKey: parsed.project_key || '',
    conversationId: typeof parsed.conversation_id === 'string' ? parsed.conversation_id : '',
    agentKey: typeof parsed.agent_key === 'string' ? parsed.agent_key : '',
    message: typeof parsed.message === 'string' ? parsed.message.trim() : '',
    summary: text.slice(0, start).replace(/```(?:json)?/gi, '').trim()
  };
}

function resolveTarget(decision, agents, conversations, projects) {
  if (!decision) return { error: 'intentUnavailable' };
  const { action, agentKey, projectKey, conversationId } = decision;
  if (action === 'projectUnavailable' || action === 'projectAmbiguous') return { error: action };

  const agent = agents.find((item) => agentKeyOf(item) === agentKey);
  if (!agent) return { error: 'intentUnavailable' };
  const project = projects.find((item) => item.key === projectKey);
  const cwd = project?.agentDirectories.get(agentKey) || '';
  if ((projectKey || action === 'new') && !cwd) return { error: 'projectUnavailable' };

  if (action === 'reuse') {
    const conversation = conversations.find((item) => item.agentKey === agentKey
      && item.conversationId === conversationId && item.projectKey === projectKey);
    return conversation ? { agent, conversation, cwd } : { error: 'intentUnavailable' };
  }
  return { agent, cwd };
}

// 眼镜运行时的 promptStreaming 可能卡在首块，使用一次性 prompt。
async function decideWithModel(session, prompt) {
  if (!session) return null;
  try {
    return parseDelegateDecision(await session.prompt(prompt))
      || parseDelegateDecision(await session.prompt(prompt));
  } catch {
    return null;
  } finally {
    destroySession(session);
  }
}

function destroySession(session) {
  try {
    session?.destroy();
  } catch {
    // 宿主已经释放时，仍可继续委托。
  }
}

export function createDelegateRunner({ getApi, getModel }) {
  async function prepareModel() {
    try {
      const model = await getModel();
      return await model?.create({
        initialPrompts: [{ role: 'system', content: DELEGATE_SYSTEM_PROMPT }]
      });
    } catch {
      return null;
    }
  }

  // 202 + accepted:false 表示桌面 Agent 拒绝了提交。
  function ensureAccepted(response) {
    if (response?.accepted === false) throw new Error(response.error_message || 'MESSAGE_NOT_ACCEPTED');
  }

  async function deliver(api, target, submission) {
    const { agent, conversation, cwd } = target;
    const { messageId, message } = submission;
    if (conversation) {
      submission.startedAt = Date.now();
      ensureAccepted(await api.sendMessage(agent.host_id, agent.plugin_id, conversation.conversationId, {
        message_id: messageId,
        content: message
      }));
      return conversation.conversationId;
    }
    const draft = await api.openDraft(agent.host_id, agent.plugin_id, { cwd });
    const draftId = draft && (draft.draft_id || draft.draftId) || '';
    if (!draftId) throw new Error('DRAFT_ID_MISSING');
    submission.startedAt = Date.now();
    let started;
    try {
      started = await api.startDraft(agent.host_id, agent.plugin_id, draftId, {
        message_id: messageId,
        content: message,
        cwd
      });
    } catch (error) {
      // Codex has already sent the message by the time this check runs.
      if (agent.plugin_id === 'codex' && /codex could not verify the draft first message/i.test(error?.message || '')) {
        return null;
      }
      throw error;
    }
    ensureAccepted(started);
    return typeof started?.conversation_id === 'string' ? started.conversation_id.trim() : '';
  }

  return {
    async run(requestText, emit) {
      // 模型准备与鉴权、会话索引并行。
      const modelReady = prepareModel();
      let usedModel = false;
      let destination;
      try {
        let api;
        try {
          api = await getApi();
        } catch (error) {
          emit('error', { code: 'authFailed', error });
          return;
        }
        const { agents, conversations } = await fetchContext(api);
        if (!agents.length) {
          emit('error', { code: 'noAgents' });
          return;
        }

        const projects = collectDelegateProjects(conversations);
        const recent = conversationsForPrompt(conversations, projects);
        const prompt = buildDelegateUserPrompt(requestText, agents, recent, projects);
        usedModel = true;
        const decision = await decideWithModel(await modelReady, prompt);
        const target = resolveTarget(decision, agents, recent, projects);
        if (target.error) {
          emit('error', { code: target.error });
          return;
        }
        const targetKey = agentKeyOf(target.agent);
        destination = {
          hostId: target.agent.host_id,
          pluginId: target.agent.plugin_id,
          conversationId: target.conversation?.conversationId || ''
        };

        emit('matching', { summary: decision.summary });
        emit('sending');

        const submission = {
          messageId: `delegate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          message: decision.message || requestText
        };
        const conversationId = await deliver(api, target, submission);
        emit(conversationId === null ? 'verifying' : 'done', {
          ...destination,
          conversationId: conversationId || '',
          cwd: target.cwd,
          submission,
          knownConversationIds: conversationId ? [] : conversations
            .filter((item) => item.agentKey === targetKey).map((item) => item.conversationId)
        });
      } catch (error) {
        emit('error', {
          code: 'sendFailed',
          message: error && error.message || String(error),
          ...destination
        });
      } finally {
        // 提前返回时，模型准备完成后再释放，无需阻塞卡片报错。
        if (!usedModel) void modelReady.then(destroySession);
      }
    }
  };
}
