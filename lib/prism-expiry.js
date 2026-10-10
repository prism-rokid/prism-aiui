// Beta expiry gate. After BETA_EXPIRY_AT (local device time) the app stops
// offering every feature and only shows the expiry notice pointing users to
// the agent store. The deadline is compared against the device clock; there
// is deliberately no remote check so the lock also works offline.

export const BETA_EXPIRY_AT = new Date(2027, 0, 1, 0, 0, 0, 0).getTime();

export function isBetaExpired(now = Date.now()) {
  return Number.isFinite(now) && now >= BETA_EXPIRY_AT;
}
