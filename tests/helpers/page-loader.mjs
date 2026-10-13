// Shared loader for the multi-file main page. The page entry (index.js) is
// evaluated as text with its ES module imports stripped and every free
// identifier injected: real implementations for the Node-safe lib modules,
// stubs for the device/API layer. (Before the page was split into
// lib/prism-page-*.js method groups it lived in a single .ink file that the
// same source-shape assertions scanned directly.)
import { readFile } from 'node:fs/promises';
import { trace } from '../../lib/prism-trace.js';
import { setLocale, initI18n, t, buildTextMap } from '../../lib/prism-i18n.js';
import { buildInitialChatState } from '../../lib/prism-chat-model.js';
import {
  CHAT_BOTTOM_ANCHOR_IDS, chatTopSpacerStyle, buildChatProgressSegments,
  INITIAL_CHAT_ITEMS, INITIAL_CHAT_LAYOUT, INITIAL_CHAT_ANCHORS,
  INITIAL_CHAT_FOCUS_INDEX, INITIAL_CHAT_LOADED_START_INDEX, INITIAL_CHAT_LOADED_PROGRESS_INDEX
} from '../../lib/prism-chat-model.js';
import { LIST_DEFAULT_VIEWPORT_HEIGHT, STATUS_DOT_PULSE_INTERVAL_MS } from '../../lib/prism-inbox-model.js';
import { MENU_CLASS_HIDDEN } from '../../lib/prism-surfaces.js';
import { createTouchpadGestureState } from '../../lib/prism-gesture.js';
import { createBootMethods } from '../../lib/prism-page-boot.js';
import { syncMethods } from '../../lib/prism-page-sync.js';
import { createStreamMethods } from '../../lib/prism-page-stream.js';
import { createMenuMethods } from '../../lib/prism-page-menu.js';
import { createVoiceMethods } from '../../lib/prism-page-voice.js';
import { inputMethods } from '../../lib/prism-page-input.js';

export const pageJsUrl = new URL('../../pages/index/index.js', import.meta.url);
export const pageWxmlUrl = new URL('../../pages/index/index.wxml', import.meta.url);
const pageWxssUrl = new URL('../../pages/index/index.wxss', import.meta.url);
const libUrls = [
  'prism-trace.js', 'prism-icons.js', 'prism-chat-model.js', 'prism-labels.js',
  'prism-inbox-model.js', 'prism-surfaces.js', 'prism-gesture.js',
  'prism-page-boot.js', 'prism-page-sync.js', 'prism-page-stream.js',
  'prism-page-menu.js', 'prism-page-voice.js', 'prism-page-input.js',
  'prism-i18n.js'
].map((name) => new URL(`../../lib/${name}`, import.meta.url));
const packUrls = ['zh-CN'].map((name) => new URL(`../../lib/i18n/${name}.js`, import.meta.url));

let cachedBundle;
// Full page source (entry + lib modules + template + styles) as one text, for
// source-shape assertions that used to scan the single .ink file.
export async function readPageBundle() {
  if (!cachedBundle) {
    const parts = await Promise.all(
      [pageJsUrl, ...libUrls, ...packUrls, pageWxmlUrl, pageWxssUrl].map((url) => readFile(url, 'utf8'))
    );
    cachedBundle = parts.join('\n');
  }
  return cachedBundle;
}

export async function evaluatePageConfig(wxOverrides = {}, RecognitionClass = class SpeechRecognition {}) {
  // Pin the locale so label assertions stay deterministic regardless of the
  // host environment's navigator.language (Node >= 21 exposes it).
  setLocale('zh-CN', { persist: false });
  const source = await readFile(pageJsUrl, 'utf8');
  const setup = source
    .replace(/^import .*;\s*$/gm, '')
    .replace('export default {', 'const pageConfig = {');
  const inject = {
    wx: {
      setBackgroundColor() {},
      exitMiniProgram() {},
      request(options) {
        if (options && typeof options.fail === 'function') options.fail({ errMsg: 'offline' });
      },
      ...wxOverrides
    },
    createVoiceInput: () => new RecognitionClass(),
    createPrismApi: () => ({}),
    createStreamId: () => 'stream-id',
    readableError: (error) => String(error && error.message || error || ''),
    PRODUCTION_API_BASE_URL: '',
    LOCAL_DEBUG_AUTH: { baseUrl: '', accountToken: '' },
    resolveAccountCredential: async () => {
      throw new Error('no device credential in Node');
    },
    renderFrame: undefined,
    trace,
    CHAT_BOTTOM_ANCHOR_IDS,
    chatTopSpacerStyle,
    buildChatProgressSegments,
    INITIAL_CHAT_ITEMS,
    INITIAL_CHAT_LAYOUT,
    INITIAL_CHAT_ANCHORS,
    INITIAL_CHAT_FOCUS_INDEX,
    INITIAL_CHAT_LOADED_START_INDEX,
    INITIAL_CHAT_LOADED_PROGRESS_INDEX,
    LIST_DEFAULT_VIEWPORT_HEIGHT,
    STATUS_DOT_PULSE_INTERVAL_MS,
    MENU_CLASS_HIDDEN,
    createTouchpadGestureState,
    createBootMethods,
    syncMethods,
    createStreamMethods,
    createMenuMethods,
    createVoiceMethods,
    inputMethods,
    initI18n,
    t,
    buildTextMap,
    buildInitialChatState
  };
  const factory = Function(...Object.keys(inject), `${setup}\nreturn pageConfig;`);
  return factory(...Object.values(inject));
}
