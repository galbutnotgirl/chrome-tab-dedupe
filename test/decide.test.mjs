import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRealPage,
  stillPending,
  chooseAnchorId,
  targetIndexFor,
  shouldMove,
} from '../lib/decide.js';
import { DEFAULTS } from '../lib/settings.js';

test('isRealPage: only committed web pages count', () => {
  assert.equal(isRealPage('https://example.com/a'), true);
  assert.equal(isRealPage('http://example.com/a'), true);
  for (const url of ['chrome://newtab/', 'about:blank', 'chrome-extension://x/y', '', undefined]) {
    assert.equal(isRealPage(url), false, `expected false for ${url}`);
  }
});

test('a tab sitting on the new-tab page stays eligible (the Cmd+T regression)', () => {
  const entry = { windowId: 1, openerTabId: null, createdAt: 0 };
  // chrome://newtab reporting "complete" must NOT end the watch...
  assert.equal(stillPending(entry, 'chrome://newtab/'), true);
  assert.equal(stillPending(entry, 'about:blank'), true);
  // ...but a committed page does.
  assert.equal(stillPending(entry, 'https://docs.google.com/document/d/abc/edit'), false);
});

test('eligibility is not a timer — an old blank tab is still a new tab', () => {
  const ancient = { windowId: 1, openerTabId: null, createdAt: 0 };
  assert.equal(stillPending(ancient, 'chrome://newtab/'), true);
});

test('anchor: a link click uses its opener', () => {
  assert.equal(chooseAnchorId({ openerTabId: 7, current: 9, previous: 3 }, 9), 7);
});

test('anchor: Cmd+T activates the new tab, so the previous tab is the anchor', () => {
  // Tab 42 is the just-created, now-active tab being closed as a duplicate.
  assert.equal(chooseAnchorId({ openerTabId: null, current: 42, previous: 8 }, 42), 8);
});

test('anchor: a background tab never steals activation, so current is the anchor', () => {
  assert.equal(chooseAnchorId({ openerTabId: null, current: 8, previous: 3 }, 42), 8);
});

test('anchor: never returns the tab being closed, and copes with nothing usable', () => {
  assert.equal(chooseAnchorId({ openerTabId: 42, current: 42, previous: 42 }, 42), null);
  assert.equal(chooseAnchorId({ openerTabId: null, current: null, previous: null }, 42), null);
});

test('target index parks the tab immediately right of the anchor', () => {
  const anchor = { id: 1, windowId: 1, index: 5 };
  // Coming from the left: the anchor shifts down one on removal.
  assert.equal(targetIndexFor({ id: 2, windowId: 1, index: 0 }, anchor), 5);
  // Coming from the right: straight into the slot after it.
  assert.equal(targetIndexFor({ id: 2, windowId: 1, index: 9 }, anchor), 6);
  // Another window: no shift to account for.
  assert.equal(targetIndexFor({ id: 2, windowId: 2, index: 0 }, anchor), 6);
});

test('shouldMove: the ordinary far-left case moves', () => {
  const existing = { id: 2, windowId: 1, index: 0, pinned: false, groupId: -1 };
  const anchor = { id: 1, windowId: 1, index: 7 };
  assert.equal(shouldMove(existing, anchor, DEFAULTS), true);
});

test('shouldMove: pinned, grouped, already-adjacent, self, and opt-out all decline', () => {
  const anchor = { id: 1, windowId: 1, index: 7 };
  const base = { id: 2, windowId: 1, index: 0, pinned: false, groupId: -1 };

  assert.equal(shouldMove({ ...base, pinned: true }, anchor, DEFAULTS), false);
  assert.equal(shouldMove({ ...base, groupId: 12 }, anchor, DEFAULTS), false);
  assert.equal(shouldMove({ ...base, index: 8 }, anchor, DEFAULTS), false, 'already right of anchor');
  assert.equal(shouldMove({ ...base, id: 1 }, anchor, DEFAULTS), false, 'anchor is the tab itself');
  assert.equal(shouldMove(base, null, DEFAULTS), false, 'no anchor resolved');
  assert.equal(
    shouldMove(base, anchor, { ...DEFAULTS, moveNextToCurrent: false }),
    false,
    'user turned moving off',
  );
});

test('shouldMove: a grouped tab moves when respectGroups is off', () => {
  const existing = { id: 2, windowId: 1, index: 0, pinned: false, groupId: 12 };
  const anchor = { id: 1, windowId: 1, index: 7 };
  assert.equal(shouldMove(existing, anchor, { ...DEFAULTS, respectGroups: false }), true);
});

test('shouldMove: cross-window pull is a move', () => {
  const existing = { id: 2, windowId: 2, index: 0, pinned: false, groupId: -1 };
  const anchor = { id: 1, windowId: 1, index: 3 };
  assert.equal(shouldMove(existing, anchor, DEFAULTS), true);
});
