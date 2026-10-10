function deviceTokenError(code, message, cause) {
  const error = new Error(message);
  error.name = 'PrismDeviceTokenError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

const credentialCache = new WeakMap();
const credentialRequests = new WeakMap();

function runtimeNavigator() {
  if (typeof navigator !== 'undefined') return navigator;
  if (typeof globalThis !== 'undefined') return globalThis.navigator;
  return undefined;
}

function normalizeCredential(credential) {
  const token = credential && typeof credential.token === 'string' ? credential.token.trim() : '';
  const tokenType = credential && typeof credential.tokenType === 'string' ? credential.tokenType.trim() : '';
  if (!token || !tokenType) {
    throw deviceTokenError(
      'DEVICE_TOKEN_INVALID',
      'Ink navigator returned an invalid device token credential'
    );
  }
  const normalized = { token, tokenType };
  if (credential.expiresAt !== undefined && credential.expiresAt !== null) {
    const expiresAt = Number(credential.expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
      throw deviceTokenError(
        'DEVICE_TOKEN_INVALID',
        'Ink navigator returned an invalid device token expiry'
      );
    }
    normalized.expiresAt = expiresAt;
  }
  return normalized;
}

/**
 * Return the non-sensitive fields that are useful for request diagnostics.
 * The token itself is intentionally never included in logs or page state.
 */
export function describeDeviceCredential(credential) {
  const normalized = normalizeCredential(credential);
  return {
    tokenType: normalized.tokenType,
    tokenLength: normalized.token.length
  };
}

/**
 * Return only the opaque token value for Prism's existing account-token header.
 * The Ink tokenType describes the credential, but it is not an HTTP header
 * scheme and must not replace the established `X-Account-Token` key.
 */
export function formatDeviceAccountToken(credential) {
  return normalizeCredential(credential).token;
}

function cachedCredential(runtime) {
  const credential = credentialCache.get(runtime);
  if (!credential) return null;
  const expiresAt = Number(credential.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    credentialCache.delete(runtime);
    return null;
  }
  return { ...credential };
}

/**
 * Request a host-issued credential for the current Ink system agent.
 *
 * Contract: Ink `navigator.requestDeviceToken(options?)` resolves to
 * `{ token, tokenType, expiresAt? }`.
 *
 * Ink does not cache this value for the app. Prism keeps one normalized copy
 * in process memory per navigator so the home page and Widget can share a
 * valid credential; an expired credential is requested again and nothing is
 * persisted to disk.
 */
export async function requestDeviceCredential(runtime = runtimeNavigator()) {
  if (!runtime || typeof runtime.requestDeviceToken !== 'function') {
    throw deviceTokenError(
      'DEVICE_TOKEN_UNAVAILABLE',
      'navigator.requestDeviceToken is not available in this runtime.'
    );
  }
  const cached = cachedCredential(runtime);
  if (cached) return cached;
  const pending = credentialRequests.get(runtime);
  if (pending) return pending.then((credential) => ({ ...credential }));

  const request = Promise.resolve()
    .then(() => runtime.requestDeviceToken())
    .then(normalizeCredential)
    .then((credential) => {
      credentialCache.set(runtime, credential);
      credentialRequests.delete(runtime);
      return { ...credential };
    }, (error) => {
      credentialRequests.delete(runtime);
      throw error;
    });
  credentialRequests.set(runtime, request);
  return request;
}
