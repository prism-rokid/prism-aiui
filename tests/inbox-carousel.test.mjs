import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInboxView } from '../lib/prism-inbox-model.js';

const items = Array.from({ length: 4 }, (_, index) => ({ id: `card-${index}` }));
const transforms = (view) => view.inboxItems.map((item) => item.cardStyle);

test('empty and single-conversation carousels have no side cards', () => {
  const empty = buildInboxView([], -1);
  assert.deepEqual(empty.inboxItems, []);
  assert.deepEqual(empty.inboxProgressDots, []);
  assert.equal(empty.inboxFocusedItem, null);
  assert.equal(empty.inboxMotion, false);

  const single = buildInboxView(items.slice(0, 1), 0);
  assert.equal(single.inboxFocusedItem.id, 'card-0');
  assert.deepEqual(transforms(single), ['transform: translateX(0px) scale(1);']);
  assert.equal(single.inboxProgressDots.length, 1);
  assert.match(single.inboxProgressDots[0].className, /is-current/);
});

test('carousel keeps cards keyed to their conversation when moving or reversing', () => {
  const initial = buildInboxView(items, 0);
  const next = buildInboxView(initial.inboxItems, 1, true);
  const further = buildInboxView(next.inboxItems, 2, true);
  const reversed = buildInboxView(further.inboxItems, 1, true);
  assert.equal(next.inboxMotion, true);
  assert.equal(next.inboxFocusedItem.id, 'card-1');
  assert.deepEqual(next.inboxItems.map((item) => item.id), items.map((item) => item.id));
  assert.deepEqual(transforms(next), [
    'transform: translateX(-174px) scale(0.8);',
    'transform: translateX(0px) scale(1);',
    'transform: translateX(174px) scale(0.8);',
    'transform: translateX(348px) scale(0.8);'
  ]);
  assert.deepEqual(transforms(reversed), transforms(next));
  assert.deepEqual(next.inboxItems.map((item) => item.tabIndex), [-1, 0, -1, -1]);
  assert.deepEqual(next.inboxProgressDots.filter((dot) => dot.className.includes('is-current')).map((dot) => dot.id), ['card-1']);
});
