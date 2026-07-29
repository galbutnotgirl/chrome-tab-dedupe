import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findRoot,
  subtreeIds,
  relatedCluster,
  sameHostCluster,
  hostOf,
} from '../lib/cluster.js';

const tab = (id, over = {}) => ({
  id,
  windowId: 1,
  index: id,
  url: `https://site${id}.com/page`,
  title: `Tab ${id}`,
  pinned: false,
  audible: false,
  groupId: -1,
  ...over,
});

const lineage = (pairs) => new Map(pairs);

/**
 * The restaurant excursion: from a search (10) you open the restaurant (11),
 * then its menu (12) and a review (13); the map (14) comes off the review.
 * Tab 1 is your inbox, unrelated.
 */
const RESEARCH_TABS = [
  tab(1, { url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Inbox (14)' }),
  tab(10, { url: 'https://google.com/search?q=tacos', title: 'tacos - Search' }),
  tab(11, { url: 'https://tacoplace.com/', title: 'Taco Place' }),
  tab(12, { url: 'https://tacoplace.com/menu', title: 'Menu — Taco Place' }),
  tab(13, { url: 'https://reviews.example.com/tacoplace', title: 'Reviews' }),
  tab(14, { url: 'https://maps.example.com/tacoplace', title: 'Directions' }),
];
const RESEARCH_LINEAGE = lineage([
  [10, 1],
  [11, 10],
  [12, 11],
  [13, 11],
  [14, 13],
]);

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;
/**
 * Creation times: the inbox has been open for three hours; the excursion happened
 * in one four-minute burst. That gap is what stops the climb at the search.
 */
const RESEARCH_META = new Map([
  [1, { createdAt: T0 - 180 * MIN }],
  [10, { createdAt: T0 }],
  [11, { createdAt: T0 + 1 * MIN }],
  [12, { createdAt: T0 + 2 * MIN }],
  [13, { createdAt: T0 + 3 * MIN }],
  [14, { createdAt: T0 + 4 * MIN }],
]);
const META = { meta: RESEARCH_META };

test('cluster: right-clicking deep in the excursion catches the whole thing', () => {
  const { ids, rootId } = relatedCluster(RESEARCH_TABS, RESEARCH_LINEAGE, 12, META);
  assert.equal(rootId, 10, 'root is the search that started it');
  assert.deepEqual(ids.sort((a, b) => a - b), [10, 11, 12, 13, 14]);
  assert.ok(!ids.includes(1), 'the inbox is never dragged in');
});

test('cluster: right-clicking the root behaves the same', () => {
  const { ids } = relatedCluster(RESEARCH_TABS, RESEARCH_LINEAGE, 10, META);
  assert.deepEqual(ids.sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('cluster: a hub tab is never climbed through', () => {
  // Tab 1 opened seven children — that's a hub (mail, a docs home), not a step
  // in one excursion. Ascending through it would drag in the whole day.
  const parentOf = lineage([
    [10, 1],
    [11, 10],
    [20, 1],
    [21, 1],
    [22, 1],
    [23, 1],
    [24, 1],
    [25, 1],
  ]);
  const tabs = [tab(1), tab(10), tab(11), ...[20, 21, 22, 23, 24, 25].map((n) => tab(n))];
  const meta = new Map(tabs.map((t) => [t.id, { createdAt: T0 }]));
  const { ids, rootId } = relatedCluster(tabs, parentOf, 11, { meta });
  assert.equal(rootId, 10);
  assert.deepEqual(ids.sort((a, b) => a - b), [10, 11]);
});

test('cluster: never climbs into a pinned or grouped ancestor', () => {
  const tabs = [tab(1, { pinned: true }), tab(10), tab(11)];
  const parentOf = lineage([
    [10, 1],
    [11, 10],
  ]);
  const meta = new Map([1, 10, 11].map((id) => [id, { createdAt: T0 }]));
  assert.equal(findRoot(11, new Map(tabs.map((t) => [t.id, t])), parentOf, { meta }), 10);

  const grouped = [tab(1, { groupId: 7 }), tab(10), tab(11)];
  assert.equal(findRoot(11, new Map(grouped.map((t) => [t.id, t])), parentOf, { meta }), 10);
});

test('cluster: protected tabs inside the tree are spared, not closed', () => {
  const tabs = RESEARCH_TABS.map((t) => (t.id === 13 ? { ...t, audible: true } : t));
  const { ids, skipped } = relatedCluster(tabs, RESEARCH_LINEAGE, 12, META);
  assert.ok(!ids.includes(13), 'the tab playing audio is not closed');
  assert.deepEqual(skipped, [13]);
  assert.ok(ids.includes(14), 'its child is still part of the excursion');
});

test('cluster: the clicked tab is included even if it would be protected', () => {
  const tabs = RESEARCH_TABS.map((t) => (t.id === 12 ? { ...t, groupId: 3 } : t));
  const { ids } = relatedCluster(tabs, RESEARCH_LINEAGE, 12, META);
  assert.ok(ids.includes(12), 'you right-clicked it, so you meant it');
});

test('cluster: a closed opener just ends the climb', () => {
  // Tab 10's parent (1) is gone from the tab list — no crash, root becomes 10.
  const tabs = RESEARCH_TABS.filter((t) => t.id !== 1);
  const { ids, rootId } = relatedCluster(tabs, RESEARCH_LINEAGE, 14, META);
  assert.equal(rootId, 10);
  assert.deepEqual(ids.sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('cluster: unknown creation times refuse to climb (conservative fallback)', () => {
  const { ids, rootId } = relatedCluster(RESEARCH_TABS, RESEARCH_LINEAGE, 11, { meta: null });
  assert.equal(rootId, 11, 'no timing, no ascent');
  assert.deepEqual(ids.sort((a, b) => a - b), [11, 12, 13, 14], 'descendants still count');
});

test('cluster: a long pause means a new excursion, not the same trail', () => {
  // Tab 11 was opened from the search 40 minutes later — past the gap.
  const meta = new Map(RESEARCH_META);
  meta.set(11, { createdAt: T0 + 40 * MIN });
  const { rootId } = relatedCluster(RESEARCH_TABS, RESEARCH_LINEAGE, 12, { meta });
  assert.equal(rootId, 11, 'climb stops below the stale parent');
});

test('cluster: a lone tab with no lineage returns only itself', () => {
  const { ids } = relatedCluster([tab(5)], new Map(), 5);
  assert.deepEqual(ids, [5]);
});

test('cluster: an unknown seed returns nothing rather than throwing', () => {
  const { ids } = relatedCluster(RESEARCH_TABS, RESEARCH_LINEAGE, 999, META);
  assert.deepEqual(ids, []);
});

test('cluster: lineage cycles terminate', () => {
  const parentOf = lineage([
    [1, 2],
    [2, 1],
  ]);
  const tabs = [tab(1), tab(2)];
  assert.doesNotThrow(() => relatedCluster(tabs, parentOf, 1));
  assert.doesNotThrow(() => subtreeIds(1, parentOf));
});

test('cluster: ascent is capped even in a deep chain', () => {
  const tabs = [];
  const pairs = [];
  for (let i = 1; i <= 20; i += 1) {
    tabs.push(tab(i));
    if (i > 1) pairs.push([i, i - 1]);
  }
  const meta = new Map(tabs.map((t) => [t.id, { createdAt: T0 }]));
  const root = findRoot(20, new Map(tabs.map((t) => [t.id, t])), lineage(pairs), { meta });
  assert.equal(root, 14, 'six steps up from 20, then stop');
});

test('same-host: closes the pile on one site, keeps the clicked tab', () => {
  const tabs = [
    tab(1, { url: 'https://tacoplace.com/' }),
    tab(2, { url: 'https://www.tacoplace.com/menu' }),
    tab(3, { url: 'https://tacoplace.com/hours', pinned: true }),
    tab(4, { url: 'https://other.com/' }),
  ];
  const { ids, host, skipped } = sameHostCluster(tabs, 1);
  assert.equal(host, 'tacoplace.com');
  assert.deepEqual(ids, [2], 'www. variant counts as the same site');
  assert.deepEqual(skipped, [3], 'pinned tab spared');
  assert.ok(!ids.includes(1), 'the clicked tab stays open');
});

test('hostOf: junk urls degrade to empty instead of throwing', () => {
  assert.equal(hostOf('chrome://newtab/'), '');
  assert.equal(hostOf('not a url'), '');
  assert.equal(hostOf(undefined), '');
});
