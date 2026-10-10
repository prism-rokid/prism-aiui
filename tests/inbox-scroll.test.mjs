import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInboxGroupLayout, inboxScrollTopForFocus } from '../lib/prism-inbox-model.js';

const now = new Date(2026, 9, 8, 12, 0, 0).getTime();

function rows(updatedAts) {
  return applyInboxGroupLayout(updatedAts.map((updated_at, index) => ({ id: `r${index}`, updated_at })), now);
}

function blockStarts(items) {
  return items.map((item, index) => (index === 0 ? 0 : item.offsetTop - (item.groupLabel ? 24 : 0)));
}

test('inbox scroll always lands on a row or header top edge', () => {
  const day = 24 * 3600 * 1000;
  const layouts = [
    rows(Array.from({ length: 10 }, (_, index) => now - index * 60 * 1000)),
    rows([now - 1, now - 2, now - day - 1, now - day - 2, now - 3 * day, now - 4 * day, now - 5 * day, now - 6 * day, now - 7 * day, now - 8 * day])
  ];
  for (const items of layouts) {
    const starts = new Set(blockStarts(items));
    for (const viewport of [150, 176, 190, 208, 230]) {
      let scrollTop = 0;
      // Walk down, wrap around, then walk up.
      const sequence = [...items.keys(), 0, ...[...items.keys()].reverse()];
      for (const focus of sequence) {
        scrollTop = inboxScrollTopForFocus(items, focus, scrollTop, viewport);
        assert.ok(starts.has(scrollTop), `scrollTop ${scrollTop} is a block edge (viewport ${viewport}, focus ${focus})`);
        const top = items[focus].offsetTop;
        assert.ok(top >= scrollTop, 'focused row top is visible');
        assert.ok(top + 44 <= scrollTop + Math.max(viewport, 44) || scrollTop === blockStarts(items)[focus], 'focused row fits');
      }
    }
  }
});

test('stale unaligned scroll offsets snap back to a row edge', () => {
  const items = rows(Array.from({ length: 6 }, (_, index) => now - index * 60 * 1000));
  // Rows start at 24, 68, 112...; 90 sits mid-row and must snap to 68.
  assert.equal(inboxScrollTopForFocus(items, 3, 90, 208), 68);
  assert.equal(inboxScrollTopForFocus(items, 0, 90, 208), 0);
});
