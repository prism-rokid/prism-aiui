// Menu icons ship as local SVGs with white baked in (#FFFFFF).

export const MENU_ICON_NAMES = Object.freeze({
  approval: 'shield-check',
  question: 'shield-check',
  planReview: 'shield-check',
  questionVoiceDone: 'send',
  questionVoiceCancel: 'undo-2',
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

export function agentAvatar(plugin) {
  const url = typeof plugin?.icon_url === 'string' ? plugin.icon_url.trim() : '';
  const remote = /^https:\/\/[^/?#\s]+(\/[^?#\s]*)?(?:[?#]\S*)?$/i.exec(url);
  return {
    src: remote ? url : '',
    isPng: /\.png$/i.test(remote?.[1] || '')
  };
}

export function menuButton(id, label) {
  return { id, label, icon: menuIconPath(MENU_ICON_NAMES[id] || 'circle') };
}
