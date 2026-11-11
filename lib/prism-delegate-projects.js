// Project directories come from the desktop Agent's conversation index.
// Preserve the original path for draft writes and group equivalent paths by host.
export function directoryKey(cwd) {
  const path = String(cwd || '').trim().replace(/\\/g, '/');
  const trimmed = /^[a-z]:\/$/i.test(path) ? path : (path.replace(/\/+$/, '') || path);
  return /^(?:[a-z]:|\/\/)/i.test(path) ? trimmed.toLowerCase() : trimmed;
}

export function isProjectDirectory(cwd, pluginId) {
  const key = directoryKey(cwd);
  if (!/^(?:\/|[a-z]:\/)/i.test(key)) return false;
  // Codex reports a working directory for projectless chats as well. Match
  // the generated scratch-directory layout used by its desktop adapter.
  return pluginId !== 'codex' || !/\/documents\/codex\/\d{4}-\d{2}-\d{2}(?:\/|$)/i.test(key);
}

export function collectDelegateProjects(conversations) {
  const projects = new Map();
  for (const item of conversations) {
    const cwd = item.cwdKey;
    if (!isProjectDirectory(item.cwd, item.agent.plugin_id)) continue;
    const group = JSON.stringify([item.agent.host_id, cwd]);
    let project = projects.get(group);
    if (!project) {
      project = {
        key: `p${projects.size + 1}`,
        cwd,
        directory: item.cwd,
        name: cwd.split('/').pop() || cwd,
        agentDirectories: new Map()
      };
      projects.set(group, project);
    }
    if (!project.agentDirectories.has(item.agentKey)) project.agentDirectories.set(item.agentKey, item.cwd);
  }
  return [...projects.values()];
}
