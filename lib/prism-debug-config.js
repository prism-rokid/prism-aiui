// Runtime environment configuration for the Prism API.
//
// Packaged builds always target the production gateway below. During local
// development you can drop a gitignored `env.json` next to the project root
// (see README) to point the page at the test environment:
//
//   { "baseUrl": "https://ai-cloud-test.rokid.com/prism/api", "token": "" }
//
// The file is excluded from git and from the packaged AIX, so the override
// only ever exists on a developer machine.
const DEFAULT_PRISM_DEBUG_AUTH = {
  baseUrl: 'https://ai-cloud.rokid.com/prism/api',
  // Keep disabled in packaged/test builds so the app never requests localhost.
  logEndpoint: '',
  accountToken: ''
};

export const PRISM_DEBUG_AUTH = Object.freeze({ ...DEFAULT_PRISM_DEBUG_AUTH });

function envObject(value) {
  const candidate = value && typeof value === 'object' && value.default
    ? value.default
    : value;
  return candidate && typeof candidate === 'object' ? candidate : {};
}

/**
 * Resolve the optional local-only env.json shape. `baseUrl` lets local
 * development target the test gateway; `token` is a browser-preview fallback
 * for flows that cannot use device credentials. The checked-in defaults never
 * contain a credential, so callers receive the account token only when they
 * explicitly load env.json.
 */
export function resolvePrismDebugAuth(value) {
  const env = envObject(value);
  const accountToken = typeof env.token === 'string' ? env.token.trim() : '';
  const baseUrlOverride = typeof env.baseUrl === 'string'
    ? env.baseUrl.trim().replace(/\/+$/, '')
    : '';
  return Object.freeze({
    ...PRISM_DEBUG_AUTH,
    baseUrl: baseUrlOverride || PRISM_DEBUG_AUTH.baseUrl,
    accountToken
  });
}

/**
 * Return safe diagnostics for the optional local token without returning the
 * credential itself to a logger or a page state object.
 */
export function describeLocalPrismDebugAuth(config) {
  const token = config && typeof config.accountToken === 'string'
    ? config.accountToken.trim()
    : '';
  if (!token) return null;
  return { tokenType: 'env.json', tokenLength: token.length };
}

let localConfigPromise;

/**
 * Load env.json when it exists in a local development checkout. The optional
 * file is absent from packaged agents, so on a device (or when the local
 * Preview server does not serve it) this resolves to the production defaults.
 */
export function loadPrismDebugAuth() {
  if (!localConfigPromise) {
    // The local Preview server exposes ignored source files over same-origin
    // fetch. The packaged AIX excludes env.json, so this request resolves to
    // the checked-in defaults on a device.
    localConfigPromise = typeof fetch === 'function'
      ? fetch('./env.json', { cache: 'no-store' })
        .then((response) => {
          if (!response || !response.ok) throw new Error('Local env.json is unavailable');
          return response.json();
        })
        .then(resolvePrismDebugAuth)
        .catch(() => PRISM_DEBUG_AUTH)
      : Promise.resolve(PRISM_DEBUG_AUTH);
  }
  return localConfigPromise;
}
