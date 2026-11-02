// 16kHz mono s16 PCM: 300ms of unsent pre-roll protects speech onset.
export function createVoiceVadGate() {
  let pending = new Uint8Array(0);
  let active = false;
  let passthrough = false;
  return {
    push(buffer, voiceActive) {
      const frame = new Uint8Array(buffer).slice();
      if (typeof voiceActive !== 'boolean') passthrough = true;
      if (passthrough || voiceActive === true) {
        const frames = pending.length ? [pending.buffer, frame.buffer] : [frame.buffer];
        pending = new Uint8Array(0);
        active = true;
        return frames;
      }
      if (active) {
        active = false;
        return [frame.buffer]; // Keep the entire first false boundary frame.
      }
      const joined = new Uint8Array(pending.length + frame.length);
      joined.set(pending);
      joined.set(frame, pending.length);
      const start = Math.max(0, joined.length - 9600);
      pending = joined.slice(start + start % 2);
      return [];
    },
    clear() { pending = new Uint8Array(0); }
  };
}
