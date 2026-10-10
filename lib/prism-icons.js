// Menu icons ship as local SVGs with the theme color baked in (#40FF5E),
// matching the agent avatar pattern. Remote CDN icons rendered black on the
// device when query params were dropped or cache missed.
import { agentIconFor } from './prism-api.js';

export const MENU_ICON_NAMES = Object.freeze({
  approval: 'shield-check',
  hideMenu: 'minimize-2',
  redo: 'redo-2',
  retry: 'rotate-ccw',
  send: 'send',
  stop: 'square',
  stopVoice: 'square',
  undo: 'undo-2',
  voice: 'mic'
});

export function menuIconPath(name) {
  return `../../assets/icons/menu_icon/icon_menu_${name}.svg`;
}

// Agent avatars ship as local SVGs with the theme color baked in. The earlier
// remote-SVG pipeline (fetch -> recolor currentColor -> base64 data URL)
// rendered black on the device, while relative-asset SVGs like the chat
// bubbles render reliably, so avatars now use the same mechanism.
export function iconPath(agent) {
  return `../../assets/icons/agent_icon/icon_agent_${agentIconFor(agent)}.svg`;
}

export function menuButton(id, label) {
  return { id, label, icon: menuIconPath(MENU_ICON_NAMES[id] || 'circle') };
}
