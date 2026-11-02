import { LOCAL_DEBUG_AUTH } from './prism-local-token.js';

function accountTokenError(code, message, cause) {
  const error = new Error(message);
  error.name = 'PrismAccountTokenError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

const openServiceRequests = new WeakMap();
let openServicePromise;

async function defaultOpenService() {
  if (!openServicePromise) {
    openServicePromise = import('open')
      .then(({ createOpenAPI }) => createOpenAPI())
      .catch((cause) => {
        openServicePromise = undefined;
        throw accountTokenError('OPEN_SERVICE_UNAVAILABLE', 'Open Service is not available in this runtime.', cause);
      });
  }
  return openServicePromise;
}

/**
 * `account.getToken()` receives host-managed authentication and resolves to a
 * token string. Concurrent consumers share one request; later resolutions
 * request a fresh token because this API does not expose an expiry.
 */
export async function requestOpenServiceCredential(getOpenService = defaultOpenService) {
  const pending = openServiceRequests.get(getOpenService);
  if (pending) return pending.then((credential) => ({ ...credential }));

  const request = Promise.resolve().then(async () => {
    const api = await getOpenService();
    if (!api || !api.account || typeof api.account.getToken !== 'function') {
      throw accountTokenError('OPEN_SERVICE_UNAVAILABLE', 'Open Service account.getToken is not available.');
    }
    const token = await api.account.getToken();
    if (typeof token !== 'string' || !token.trim()) {
      throw accountTokenError('OPEN_SERVICE_TOKEN_INVALID', 'Open Service returned an invalid account token.');
    }
    return { token: token.trim(), tokenType: 'open-service' };
  });
  openServiceRequests.set(getOpenService, request);
  try {
    return { ...await request };
  } finally {
    openServiceRequests.delete(getOpenService);
  }
}

/**
 * Resolve the account token through the default Open Service. A local token is
 * used only in a package built for local debugging. Credentials are never
 * persisted or included in the diagnostic summary.
 */
export async function resolveAccountCredential(localAuth = LOCAL_DEBUG_AUTH, getOpenService = defaultOpenService) {
  try {
    const credential = await requestOpenServiceCredential(getOpenService);
    return {
      accountToken: credential.token,
      summary: { tokenType: credential.tokenType, tokenLength: credential.token.length }
    };
  } catch (error) {
    const localToken = localAuth && typeof localAuth.accountToken === 'string'
      ? localAuth.accountToken.trim()
      : '';
    if (localToken) {
      return { accountToken: localToken, summary: { tokenType: 'local-token', tokenLength: localToken.length } };
    }
    throw error;
  }
}
