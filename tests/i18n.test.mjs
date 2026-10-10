import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PACKS,
  LOCALE_IDS,
  DEFAULT_LOCALE,
  LOCALE_AUTO,
  matchLocale,
  localeForRegion,
  detectLocale,
  normalizeTag,
  setLocale,
  currentLocale,
  t,
  buildTextMap,
  speechLang,
  isSupportedLocale
} from '../lib/prism-i18n.js';

const zhKeys = Object.keys(PACKS['zh-CN']).sort();

test('four first-phase locales ship packs with identical keys', () => {
  assert.deepEqual(LOCALE_IDS, ['zh-CN', 'en-US', 'ja-JP', 'zh-Hant']);
  for (const id of LOCALE_IDS) {
    assert.equal(Object.keys(PACKS[id]).length, zhKeys.length, `${id} covers every source key`);
  }
});

test('pack placeholders stay in sync across locales', () => {
  const placeholders = (value) => Array.from(String(value).matchAll(/\{(\w+)\}/g)).map((m) => m[1]).sort().join(',');
  for (const key of zhKeys) {
    const expected = placeholders(PACKS['zh-CN'][key]);
    for (const id of LOCALE_IDS) {
      assert.equal(placeholders(PACKS[id][key]), expected, `${id}:${key} keeps {placeholders}`);
    }
  }
});

test('matchLocale maps BCP 47 tag variants onto the supported set', () => {
  assert.equal(matchLocale('zh-CN'), 'zh-CN');
  assert.equal(matchLocale('zh'), 'zh-CN');
  assert.equal(matchLocale('zh_SG'), 'zh-CN');
  assert.equal(matchLocale('zh-TW'), 'zh-Hant');
  assert.equal(matchLocale('zh-HK'), 'zh-Hant');
  assert.equal(matchLocale('zh-Hant-TW'), 'zh-Hant');
  assert.equal(matchLocale('yue-Hant-HK'), 'zh-Hant');
  assert.equal(matchLocale('ja'), 'ja-JP');
  assert.equal(matchLocale('ja-JP'), 'ja-JP');
  assert.equal(matchLocale('en'), 'en-US');
  assert.equal(matchLocale('en-GB'), 'en-US');
  assert.equal(matchLocale('fr-FR'), null);
  assert.equal(matchLocale(''), null);
});

test('normalizeTag produces BCP 47 canonical casing', () => {
  assert.equal(normalizeTag('ZH-HANT-TW'), 'zh-Hant-TW');
  assert.equal(normalizeTag('zh_tw'), 'zh-TW');
  assert.equal(normalizeTag('JA-jp'), 'ja-JP');
  assert.equal(normalizeTag(' zh-cn '), 'zh-CN');
});

test('matchLocale tolerates BCP 47 extensions, private use, and extlangs', () => {
  assert.equal(matchLocale('zh-TW-x-cantonese'), 'zh-Hant');
  assert.equal(matchLocale('en-US-u-ca-gregory'), 'en-US');
  assert.equal(matchLocale('zh-Hant-u-nu-hanidec'), 'zh-Hant');
  assert.equal(matchLocale('zh-nan-TW'), 'zh-Hant');
  assert.equal(matchLocale('ZH-hant'), 'zh-Hant');
});

test('localeForRegion accepts BCP 47 tags and bare region subtags', () => {
  assert.equal(localeForRegion('TW'), 'zh-Hant');
  assert.equal(localeForRegion('hk'), 'zh-Hant');
  assert.equal(localeForRegion('MO'), 'zh-Hant');
  assert.equal(localeForRegion('zh-TW'), 'zh-Hant');
  assert.equal(localeForRegion('zh-HK'), 'zh-Hant');
  assert.equal(localeForRegion('zh-CN'), 'zh-CN');
  assert.equal(localeForRegion('en-US'), 'en-US');
  assert.equal(localeForRegion('JP'), 'ja-JP');
  assert.equal(localeForRegion('CN'), 'zh-CN');
  assert.equal(localeForRegion('US'), 'en-US');
  assert.equal(localeForRegion('GB'), 'en-US');
  assert.equal(localeForRegion('DE'), null);
  assert.equal(localeForRegion(''), null);
});

test('detectLocale prefers the stored override, then navigator languages, then region', () => {
  const navigator = (languages, language, region) => ({ languages, language, region });

  assert.equal(detectLocale({ navigator: navigator(['zh-CN', 'en-US']), stored: '' }), 'zh-CN');
  assert.equal(detectLocale({ navigator: navigator(['fr-FR'], 'fr'), stored: 'ja-JP' }), 'ja-JP');
  assert.equal(detectLocale({ navigator: navigator(['zh-TW']), stored: '' }), 'zh-Hant');
  assert.equal(detectLocale({ navigator: navigator([], '', 'HK'), stored: '' }), 'zh-Hant');
  assert.equal(detectLocale({ navigator: navigator([], '', 'zh-HK'), stored: '' }), 'zh-Hant');
  assert.equal(detectLocale({ navigator: navigator([], '', 'zh-TW'), stored: '' }), 'zh-Hant');
  // Stored overrides accept variant BCP 47 spellings and fold onto packs.
  assert.equal(detectLocale({ navigator: navigator(['en-US']), stored: 'zh_tw' }), 'zh-Hant');
  assert.equal(detectLocale({ navigator: navigator(['en-US']), stored: 'zh-TW' }), 'zh-Hant');
  assert.equal(detectLocale({ navigator: navigator(['en-US']), stored: 'gibberish' }), 'en-US');
  assert.equal(detectLocale({ navigator: navigator(['fr-FR'], 'fr-FR'), stored: '' }), DEFAULT_LOCALE);
  assert.equal(detectLocale({ navigator: navigator([], '', ''), stored: '' }), DEFAULT_LOCALE);
  // A stored 'auto' defers to navigator detection instead of pinning a locale.
  assert.equal(detectLocale({ navigator: navigator(['ja-JP']), stored: LOCALE_AUTO }), 'ja-JP');
});

test('t interpolates params and falls back through zh-CN', () => {
  setLocale('zh-CN', { persist: false });
  assert.equal(t('label.time.minutesAgo', { n: 5 }), '5分钟前');
  assert.equal(t('voice.sendFailed', { error: 'X' }).includes('X'), true);
  assert.equal(t('definitely.not.a.key'), 'definitely.not.a.key');

  setLocale('ja-JP', { persist: false });
  assert.equal(typeof t('menu.voiceInput'), 'string');
  assert.notEqual(t('menu.voiceInput'), 'menu.voiceInput');

  setLocale('zh-Hant', { persist: false });
  assert.equal(typeof t('menu.voiceInput'), 'string');
});

test('setLocale switches the effective locale and the speech language', () => {
  setLocale(LOCALE_AUTO, { persist: false });
  assert.equal(isSupportedLocale(currentLocale()), true);

  setLocale('en-US', { persist: false });
  assert.equal(currentLocale(), 'en-US');
  assert.equal(speechLang(), 'en-US');

  setLocale('zh-Hant', { persist: false });
  // zh-Hant has no dedicated on-device ASR model: the host default takes over.
  assert.equal(speechLang(), '');

  setLocale('zh-CN', { persist: false });
  assert.equal(speechLang(), 'zh-CN');
});

test('buildTextMap expands dotted keys into a tree for WXML bindings', () => {
  setLocale('zh-CN', { persist: false });
  const map = buildTextMap();
  assert.equal(map.chat.ariaChatProgress, '对话滚动进度');
  assert.equal(map.common.appName, '棱镜面板');
  assert.equal(map.chat.hintInbox, '单击进入');
});
