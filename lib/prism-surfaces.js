// Surface state helpers: which overlay surface owns focus, and how the chat
// area flexes its layout while panels are stacked on top of it.

export function chatLayoutClass(planVisible, threadPickerVisible = false, menuVisible = false) {
  let className = 'prism-main-chat';
  if (planVisible) className += ' prism-main-chat-plan';
  if (menuVisible) className += ' prism-main-chat-menu';
  if (threadPickerVisible) className += ' prism-main-chat-thread-picker';
  return className;
}

export function isListSurface(surface) {
  return surface === 'inbox';
}

export function isMenuSurface(surface) {
  return surface === 'menu'
    || surface === 'quick'
    || surface === 'inbox'
    || surface === 'controls'
    || surface === 'approval';
}

export const MENU_CLASS_VISIBLE = 'prism-menu';
export const MENU_CLASS_HIDDEN = 'prism-menu prism-menu-hidden';
