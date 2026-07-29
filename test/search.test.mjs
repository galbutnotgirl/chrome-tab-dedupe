import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch, searchTabs, readableUrl } from '../lib/search.js';

const NOW = 1_800_000_000_000;
const tab = (over = {}) => ({
  id: 1,
  windowId: 1,
  title: 'Some page',
  url: 'https://example.com/page',
  lastAccessed: NOW,
  pinned: false,
  active: false,
  ...over,
});

// --- search ranking ---------------------------------------------------------

test('readableUrl strips scheme, www, query and hash', () => {
  assert.equal(readableUrl('https://www.example.com/docs/intro?x=1#top'), 'example.com/docs/intro');
  assert.equal(readableUrl('https://example.com/'), 'example.com');
  assert.equal(readableUrl('chrome://settings'), '');
});

test('ranking is tiered: prefix beats contains beats words beats url', () => {
  const q = 'kokkari';
  const prefix = scoreMatch(q, tab({ title: 'Kokkari Estiatorio' }));
  const contains = scoreMatch(q, tab({ title: 'Menu — Kokkari' }));
  const url = scoreMatch(q, tab({ title: 'Reservations', url: 'https://kokkari.com/book' }));
  assert.ok(prefix > contains, 'a title that starts with the query wins');
  assert.ok(contains > url, 'a title match beats an address match');
  assert.ok(url > 0);
});

test('every query word in the title beats an address match', () => {
  const bothWords = scoreMatch('greek menu', tab({ title: 'Menu of greek things' }));
  const addressOnly = scoreMatch('greek menu', tab({ title: 'Untitled', url: 'https://x.com/greek/menu' }));
  assert.ok(bothWords > addressOnly);
});

test('a loose letters-in-order match is last, and short queries do not trigger it', () => {
  assert.equal(scoreMatch('kkri', tab({ title: 'Kokkari Estiatorio' })), 0.35);
  assert.equal(scoreMatch('ki', tab({ title: 'Kokkari Estiatorio' })), 0, 'two letters is noise');
});

test('no match and empty query both return 0', () => {
  assert.equal(scoreMatch('zzzqqq', tab()), 0);
  assert.equal(scoreMatch('', tab()), 0);
  assert.equal(scoreMatch('  ', tab()), 0);
});

test('matching ignores case', () => {
  assert.equal(scoreMatch('KOKKARI', tab({ title: 'kokkari estiatorio' })), 1);
});

test('searchTabs orders by score, then breaks ties on recency', () => {
  const tabs = [
    // 0.85 (contains), touched long ago
    tab({ id: 1, title: 'Old exact', lastAccessed: NOW - 9e8 }),
    // 0.85 (contains), touched just now
    tab({ id: 2, title: 'Menu — has exact inside', lastAccessed: NOW }),
    // 1.00 (title starts with the query)
    tab({ id: 3, title: 'exact recent', lastAccessed: NOW }),
  ];
  const out = searchTabs('exact', tabs);
  assert.deepEqual(
    out.map((r) => r.id),
    [3, 2, 1],
    'the prefix match leads; the two equal-scoring matches order newest first',
  );
});

test('searchTabs skips non-web tabs and respects the limit', () => {
  const tabs = [
    tab({ id: 1, url: 'chrome://settings', title: 'settings page' }),
    ...Array.from({ length: 30 }, (_, i) => tab({ id: 100 + i, title: `report ${i}` })),
  ];
  const out = searchTabs('report', tabs, { limit: 5 });
  assert.equal(out.length, 5);
  assert.ok(!out.some((r) => r.title === 'settings page'));
});

test('searchTabs folds copies of one document into a single result', () => {
  const tabs = [
    tab({ id: 1, title: 'Q3 Planning', url: 'https://docs.example.com/d/abc/edit#slide=1', lastAccessed: NOW - 1000 }),
    tab({ id: 2, title: 'Q3 Planning', url: 'https://docs.example.com/d/abc/edit#slide=9', lastAccessed: NOW }),
    tab({ id: 3, title: 'Q3 Planning notes', url: 'https://docs.example.com/d/xyz/edit' }),
  ];
  const keyOf = (t) => t.url.replace(/#.*$/, '');
  const out = searchTabs('q3 planning', tabs, { keyOf });

  assert.equal(out.length, 2, 'the two copies are one row');
  const folded = out.find((r) => r.copies === 2);
  assert.deepEqual(folded.ids.sort(), [1, 2]);
  assert.equal(folded.id, 2, 'the more recent copy represents the group');
});

test('searchTabs with no query returns nothing rather than everything', () => {
  assert.deepEqual(searchTabs('', [tab()]), []);
  assert.deepEqual(searchTabs('x', []), []);
  assert.deepEqual(searchTabs('x', null), []);
});
