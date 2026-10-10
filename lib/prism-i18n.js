// Locale resolution and text lookup. navigator.languages and navigator.region
// both carry IETF BCP 47 tags (zh-CN, zh-TW, zh-HK, zh-Hant-TW, ...),
// populated by the host through configNavigatorHost; both may be empty when
// the host does not configure them, so detection always falls back to zh-CN.
// An explicit override stored through wx storage (setLocale) wins over
// navigator detection.

import zhCN from './i18n/zh-CN.js';
import enUS from './i18n/en-US.js';
import jaJP from './i18n/ja-JP.js';
import zhHant from './i18n/zh-Hant.js';

export const PACKS = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP, 'zh-Hant': zhHant };
export const LOCALE_IDS = Object.keys(PACKS);
export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALE_AUTO = 'auto';
export const LOCALE_STORAGE_KEY = 'prism.locale';

let storageAccess = null;
let resolvedLocale = null;
let sessionOverride = null;

function runtimeNavigator() {
  if (typeof navigator !== 'undefined' && navigator) return navigator;
  if (typeof globalThis !== 'undefined' && globalThis.navigator) return globalThis.navigator;
  return null;
}

// BCP 47 canonical form: language lowercase, script Titlecase, region
// UPPERCASE (zh-hant-tw -> zh-Hant-TW). '_' is accepted as a separator.
export function normalizeTag(tag) {
  const parts = String(tag || '').trim().toLowerCase().replace(/_/g, '-').split('-').filter(Boolean);
  return parts
    .map((part, index) => {
      if (index === 0) return part;
      if (part.length === 4) return part.charAt(0).toUpperCase() + part.slice(1);
      if (part.length === 2 || /^\d{3}$/.test(part)) return part.toUpperCase();
      return part;
    })
    .join('-');
}

export function isSupportedLocale(id) {
  return LOCALE_IDS.includes(normalizeTag(id));
}

// BCP-47-ish matching without Intl: exact match first, then language/script/
// region heuristics. Extension and private-use sequences are ignored, and
// 3-letter extlang subtags never mask the script/region positions. All
// zh-Hant spellings (zh-TW/HK/MO/Hant*, yue) share one pack that must stay
// acceptable in both Taiwan and Hong Kong.
export function matchLocale(tag) {
  const normalized = normalizeTag(tag);
  if (!normalized) return null;
  if (isSupportedLocale(normalized)) return normalizeTag(normalized);
  const parts = normalized.split('-');
  const language = parts[0];
  let script = '';
  let region = '';
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.length === 1) break; // extension / private-use singleton
    if (part.length === 4) script = part;
    else if (part.length === 2 || /^\d{3}$/.test(part)) region = part;
  }
  if (language === 'zh' || language === 'yue') {
    if (script === 'Hant' || ['TW', 'HK', 'MO'].includes(region)) return 'zh-Hant';
    return 'zh-CN';
  }
  if (language === 'ja') return 'ja-JP';
  if (language === 'en') return 'en-US';
  return null;
}

// navigator.region follows BCP 47 as well: accept full tags (zh-TW, en-US)
// and fall back to a bare region subtag (TW, HK).
export function localeForRegion(region) {
  const value = String(region || '').trim();
  if (!value) return null;
  if (value.includes('-')) return matchLocale(value);
  switch (value.toUpperCase()) {
    case 'TW':
    case 'HK':
    case 'MO':
      return 'zh-Hant';
    case 'JP':
      return 'ja-JP';
    case 'CN':
      return 'zh-CN';
    case 'US':
    case 'GB':
    case 'UK':
    case 'AU':
    case 'CA':
    case 'NZ':
    case 'SG':
      return 'en-US';
    default:
      return null;
  }
}

function detectFromNavigator(nav) {
  const source = nav || runtimeNavigator();
  const languages = source && Array.isArray(source.languages) ? source.languages : [];
  const candidates = [...languages, source && source.language].filter(Boolean).map(String);
  for (const tag of candidates) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return localeForRegion(source && source.region) || DEFAULT_LOCALE;
}

export function detectLocale({ navigator: nav, stored } = {}) {
  const value = stored !== undefined ? stored : readStored();
  // 'auto' is a preference, not a locale: it defers to navigator detection.
  if (value !== LOCALE_AUTO) {
    const override = matchLocale(value);
    if (override) return override;
  }
  return detectFromNavigator(nav);
}

function readStored() {
  try {
    const value = storageAccess ? storageAccess.get() : null;
    return value === null || value === undefined ? '' : String(value);
  } catch (error) {
    return '';
  }
}

function writeStored(value) {
  try {
    if (storageAccess) storageAccess.set(value);
  } catch (error) {}
}

// Entry points (page onLoad / widget setup) inject wx-backed storage so the
// persisted override is honored; lib modules only ever call t().
export function initI18n({ wx, navigator: nav } = {}) {
  if (wx && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function') {
    storageAccess = {
      get: () => wx.getStorageSync(LOCALE_STORAGE_KEY),
      set: (value) => wx.setStorageSync(LOCALE_STORAGE_KEY, value)
    };
  }
  sessionOverride = null;
  resolvedLocale = detectLocale({ navigator: nav });
  return resolvedLocale;
}

export function currentLocale() {
  if (resolvedLocale) return resolvedLocale;
  resolvedLocale = detectLocale({});
  return resolvedLocale;
}

// id is any BCP 47 tag or 'auto'; variants fold onto the supported set
// (zh-TW -> zh-Hant). persist=false keeps the change in this session only
// (used by tests).
export function setLocale(id, { persist = true } = {}) {
  if (id === LOCALE_AUTO) {
    sessionOverride = LOCALE_AUTO;
    resolvedLocale = detectFromNavigator(null);
    if (persist) writeStored(LOCALE_AUTO);
    return resolvedLocale;
  }
  const localeId = matchLocale(id);
  if (!localeId) return currentLocale();
  sessionOverride = localeId;
  resolvedLocale = localeId;
  if (persist) writeStored(localeId);
  return resolvedLocale;
}

export function t(key, params) {
  const locale = currentLocale();
  const pack = PACKS[locale] || PACKS[DEFAULT_LOCALE];
  const fallback = PACKS[DEFAULT_LOCALE];
  const value = pack[key] !== undefined ? pack[key] : fallback[key] !== undefined ? fallback[key] : key;
  if (!params) return value;
  return String(value).replace(/\{(\w+)\}/g, (match, name) => (
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match
  ));
}

// WXML resolves {{text.a.b}} through nested objects, so the flat dotted keys
// of the pack are expanded into a tree for page data.
export function buildTextMap() {
  const pack = PACKS[currentLocale()] || PACKS[DEFAULT_LOCALE];
  const root = {};
  for (const [key, value] of Object.entries(pack)) {
    const parts = key.split('.');
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!node[parts[index]] || typeof node[parts[index]] !== 'object') node[parts[index]] = {};
      node = node[parts[index]];
    }
    node[parts[parts.length - 1]] = value;
  }
  return root;
}

// The ASR session lang contract is a BCP-47 tag the host speech capability
// understands. zh-Hant has no dedicated model on Rokid today: an empty lang
// lets the host pick its own default instead of forcing Simplified Chinese.
export function speechLang() {
  switch (currentLocale()) {
    case 'zh-CN':
      return 'zh-CN';
    case 'en-US':
      return 'en-US';
    case 'ja-JP':
      return 'ja-JP';
    default:
      return '';
  }
}
