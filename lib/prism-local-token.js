// Local debug credential slot — DO NOT put a real token here.
//
// This module is bundled into every package, so it is the one channel a
// real-device debug build can rely on: the Ink runtime has no base URL for
// `fetch('./env.json')`, so browser-preview-style overrides cannot load on
// the glasses. `npm run debug` (dev/debug.mjs) temporarily writes the relay
// target and your Prism account token here, packs, and immediately
// restores the empty values below — the checked-in file never contains a
// credential (tests enforce this).
export const LOCAL_DEBUG_AUTH = Object.freeze({
  // Example of what `npm run debug` writes before packing (never commit):
  //   baseUrl: 'https://ai-cloud-test.rokid.com/prism/api',
  //   accountToken: '<access_token from ~/.prism/config.yaml>'
  baseUrl: '',
  accountToken: ''
});
