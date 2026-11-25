// Persist image bytes in the app's storage so pages and widgets can reuse them
// across launches.
const STORAGE_KEY = 'prism.agent-avatars.v1';
const MAX_BYTES = 128 * 1024;
const MAX_CACHE_CHARS = 1024 * 1024;
const pending = new Map();

function readEntries() {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Avatar request failed');
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|webp|svg\+xml|jpeg|gif|avif|x-icon|vnd\.microsoft\.icon)$/.test(mime)
    || Number(response.headers.get('content-length')) > MAX_BYTES) return url;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return url;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  const src = `data:${mime};base64,${btoa(binary)}`;
  try {
    const entries = readEntries().filter(entry => entry.url !== url);
    entries.push({ url, src });
    let size = entries.reduce((sum, entry) => sum + entry.url.length + entry.src.length, 0);
    while (size > MAX_CACHE_CHARS && entries.length > 1) {
      const oldest = entries.shift();
      size -= oldest.url.length + oldest.src.length;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* A full store still permits displaying this download. */ }
  return src;
}

function avatarSource(url) {
  if (!url || typeof localStorage === 'undefined' || typeof fetch !== 'function') return url;
  if (pending.has(url)) return pending.get(url);
  const cached = readEntries().find(entry => entry.url === url);
  if (cached) return cached.src;
  const request = download(url).catch(() => url).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

// Mount one image per distinct inbox avatar. Navigation then changes visibility
// without reading storage, replacing src, or making Ink decode the image again.
export function prepareInboxAvatars(view, agents) {
  const previous = view._inboxAvatarLayers || new Map();
  const layers = new Map();
  for (const { avatar, available, connected } of agents) {
    const url = avatar?.src;
    if (!url || available === false || connected === false || layers.has(url)) continue;
    let layer = previous.get(url);
    if (!layer) {
      layer = { url, src: '', isPng: avatar.isPng };
      const source = avatarSource(url);
      if (typeof source === 'string') layer.src = source;
      else source.then(src => {
        if (view._pageActive === false || view._inboxAvatarLayers?.get(url) !== layer) return;
        layer.src = src;
        view.setData({ inboxAvatarLayers: [...view._inboxAvatarLayers.values()] });
      });
    }
    layers.set(url, layer);
  }
  view._inboxAvatarLayers = layers;
  if (previous.size !== layers.size || [...layers.keys()].some(url => !previous.has(url))) {
    view.setData({ inboxAvatarLayers: [...layers.values()] });
  }
}

// Return the immediate value for the caller's setData patch. Only deliver an
// async result while this field still represents the originally requested URL.
export function cachedAvatar(view, field, avatar) {
  const url = avatar?.src || '';
  const slots = view._avatarSlots ||= {};
  if (slots[field]?.url === url) return slots[field].avatar;
  const source = avatarSource(url);
  const isPng = avatar?.isPng ?? false;
  const slot = { url, avatar: { src: typeof source === 'string' ? source : '', isPng } };
  slots[field] = slot;
  if (typeof source === 'string') return slot.avatar;
  source.then(src => {
    if (slots[field] !== slot || view._pageActive === false || view._avatarDestroyed) return;
    slot.avatar = { src, isPng };
    view.setData({ [field]: slot.avatar });
  });
  return slot.avatar;
}
