// Touchpad gesture and key primitives: one press resolves to exactly one
// gesture (long press or tap); arrow keys are the host's own navigation
// events and never reclassify a press.

export const ARROW_KEYUP_FALLBACK_WINDOW_MS = 1500;

// Keep input on the documented page-level key path. A device-specific extra
// key can arrive alongside a standard key event, making one physical gesture
// look like two independent presses.
export function isConfirmKey(code) {
  return code === 'Enter';
}

export const LONG_PRESS_MENU_MS = 600;
export const TOUCHPAD_DUPLICATE_WINDOW_MS = 120;
// ArrowUp/ArrowDown are the host's own interaction events (navigation and
// scrolling, per the page-events API). The page never infers swipes from
// them: an Enter press/release can only resolve as a long press or a tap,
// and arrow steps never reclassify it.
// A press session without a matching release older than this is stale
// firmware state and must not block the next press.
export const STALE_PRESS_MS = 5000;

// One touchpad press resolves to exactly one gesture: long press (hold) or
// tap (activates on release). Arrow navigation arrives as its own API events
// and never reclassifies a press. `consumed` marks a press whose release an
// out-of-band interaction (voice wakeup) already owns.
export function createTouchpadGestureState() {
  return {
    phase: 'idle',
    startSurface: '',
    startAt: 0,
    consumed: false,
    longPressFired: false,
    longPressTimer: null,
    suppressUntil: 0
  };
}
