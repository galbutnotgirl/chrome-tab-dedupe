import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTab, suggestClosures, idleHours, STALENESS_DEFAULTS } from '../lib/staleness.js';
import { fuzzyScore, bestMatch, parsePatterns } from '../lib/fuzzy.js';

const NOW = 1_800_000_000_000;
const HOURS = (n) => NOW - n * 3600 * 1000;

const tab = (over = {}) => ({
  id: 1,
  windowId: 1,
  url: 'https://example.com/page',
  title: 'Some page',
  lastAccessed: HOURS(0),
  pinned: false,
  audible: false,
  active: false,
  discarded: false,
  groupId: -1,
  ...over,
});

// --- fuzzy ------------------------------------------------------------------

test('fuzzy: a phrase match beats scattered words beats letters', () => {
  assert.equal(fuzzyScore('yelp', 'Yelp — Taco Place reviews'), 1);
  assert.equal(fuzzyScore('taco reviews', 'Reviews of Taco Place'), 0.9);
  assert.ok(fuzzyScore('taco reviews', 'Taco Place menu') < 0.9);
  assert.ok(fuzzyScore('taco reviews', 'Taco Place menu') > 0.5);
  assert.equal(fuzzyScore('zqxj', 'Taco Place menu'), 0);
});

test('fuzzy: matching is case and punctuation blind', () => {
  assert.equal(fuzzyScore('GOOGLE SEARCH', 'google.com/search?q=x'), 0.9);
  assert.equal(fuzzyScore('flight-status', 'Flight status: DL123'), 1);
});

test('fuzzy: empty patterns never match anything', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.equal(fuzzyScore('x', ''), 0);
  assert.equal(bestMatch([], 'anything').score, 0);
  assert.equal(bestMatch(undefined, 'anything').score, 0);
});

test('fuzzy: bestMatch reports which pattern fired, for the UI to explain itself', () => {
  const { score, pattern } = bestMatch(['inbox', 'search results'], 'tacos - Google Search Results');
  assert.equal(pattern, 'search results');
  assert.equal(score, 1);
});

test('fuzzy: pattern lists ignore blanks and # comments', () => {
  assert.deepEqual(parsePatterns('yelp\n\n  # a note\n  search  \n'), ['yelp', 'search']);
  assert.deepEqual(parsePatterns(undefined), []);
});

// --- protection -------------------------------------------------------------

test('nothing pinned, audible, active, or grouped is ever suggested', () => {
  const cases = [
    ['pinned', { pinned: true }],
    ['playing audio', { audible: true }],
    ['active tab', { active: true }],
    ['in a tab group', { groupId: 4 }],
  ];
  for (const [why, over] of cases) {
    const result = scoreTab(tab({ lastAccessed: HOURS(400), ...over }), { activations: 0 }, {}, NOW);
    assert.equal(result.protectedBy, why);
    assert.equal(result.score, 0);
  }
});

test('a protect pattern outranks every staleness signal', () => {
  const settings = { protectPatterns: ['payroll'] };
  const t = tab({ title: 'Payroll approvals', lastAccessed: HOURS(900) });
  const result = scoreTab(t, { activations: 0 }, settings, NOW);
  assert.equal(result.protectedBy, 'matches "payroll"');
  assert.equal(result.score, 0);
});

// --- scoring ----------------------------------------------------------------

test('a tab you just looked at scores nothing', () => {
  const result = scoreTab(tab(), { activations: 5 }, {}, NOW);
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons, []);
});

test('idle time accrues by doublings and is capped below the threshold', () => {
  const at = (h) => scoreTab(tab({ lastAccessed: HOURS(h) }), { activations: 1 }, {}, NOW).score;
  assert.equal(at(1), 0, 'under the threshold');
  assert.equal(at(2), 1);
  assert.equal(at(4), 2);
  assert.equal(at(8), 2, 'capped at 2 — age can never reach the default threshold of 3');
  assert.equal(at(500), 2, 'a tab idle for weeks is still only old');
});

test('opened-but-never-viewed is the strongest single signal', () => {
  const result = scoreTab(tab({ lastAccessed: HOURS(3) }), { activations: 0 }, {}, NOW);
  assert.ok(result.reasons.includes('opened but never looked at'));
  assert.equal(result.score, 3, '1 idle + 2 never-viewed');
  assert.equal(result.intent, 1, 'counts as evidence you are done with it');
});

test('age alone is never enough to be proposed', () => {
  // The bug this prevents: with age able to reach the threshold on its own, every
  // tab older than a few hours got proposed — 97 rows in one popup.
  const ancient = tab({ id: 9, lastAccessed: HOURS(500) });
  const result = scoreTab(ancient, { activations: 3 }, {}, NOW);
  assert.equal(result.intent, 0, 'nothing here says you are finished with it');
  assert.deepEqual(suggestClosures([ancient], new Map([[9, { activations: 3 }]]), {}, NOW), []);
});

test('hundreds of old tabs on one site propose nothing', () => {
  // A docs/mail home is not a research pile. Before this, "106 tabs open on
  // docs.google.com" added a point to all 106 of them.
  const tabs = [];
  const intel = new Map();
  for (let i = 1; i <= 106; i += 1) {
    tabs.push(tab({ id: i, url: `https://docs.google.com/document/d/doc${i}/edit`, lastAccessed: HOURS(216) }));
    intel.set(i, { activations: 2 });
  }
  assert.deepEqual(suggestClosures(tabs, intel, {}, NOW), []);
});

test('a bounded pile still counts, an unbounded one does not', () => {
  const counts = (n) => new Map([['example.com', n]]);
  const at = (n) =>
    scoreTab(tab({ lastAccessed: HOURS(3) }), { activations: 2 }, {}, NOW, { hostCounts: counts(n) }).score;
  assert.equal(at(3), 1, 'below pileSize: idle only');
  assert.equal(at(6), 2, 'a real research pile');
  assert.equal(at(60), 1, 'a site you live in is not a pile');
});

test('reasons read as English, and days are reported as days', () => {
  const result = scoreTab(tab({ lastAccessed: HOURS(72) }), { activations: 2 }, {}, NOW);
  assert.deepEqual(result.reasons, ['untouched for 3d']);
});

test('a research pile on one site adds a point (but is not intent by itself)', () => {
  const hostCounts = new Map([['example.com', 6]]);
  const withPile = scoreTab(
    tab({ lastAccessed: HOURS(3) }),
    { activations: 2 },
    {},
    NOW,
    { hostCounts },
  );
  assert.ok(withPile.reasons.some((r) => r.includes('6 tabs open on example.com')));
  assert.equal(withPile.score, 2);
  assert.equal(withPile.intent, 0, 'a pile is context, not evidence');
});

test('missing intel degrades gracefully instead of assuming never-viewed', () => {
  const result = scoreTab(tab({ lastAccessed: HOURS(3) }), null, {}, NOW);
  assert.equal(result.score, 1, 'idle only — no phantom never-viewed point');
});

test('a tab with no lastAccessed is not treated as ancient', () => {
  assert.equal(idleHours(tab({ lastAccessed: 0 }), NOW), 0);
  assert.equal(scoreTab(tab({ lastAccessed: 0 }), { activations: 3 }, {}, NOW).score, 0);
});

// --- proposals --------------------------------------------------------------

test('suggestClosures ranks the worst offenders first and explains each', () => {
  const tabs = [
    tab({ id: 1, title: 'Active work', lastAccessed: HOURS(0), active: true }),
    tab({ id: 2, title: 'tacos - Google Search', url: 'https://google.com/search?q=tacos', lastAccessed: HOURS(30) }),
    tab({ id: 3, title: 'Menu', url: 'https://tacoplace.com/menu', lastAccessed: HOURS(30) }),
    tab({ id: 4, title: 'Pinned thing', pinned: true, lastAccessed: HOURS(500) }),
    tab({ id: 5, title: 'Read this later', lastAccessed: HOURS(1) }),
  ];
  const intel = new Map([
    [2, { activations: 0 }],
    [3, { activations: 1 }],
    [5, { activations: 2 }],
  ]);
  const settings = { disposablePatterns: ['google search'] };

  const out = suggestClosures(tabs, intel, settings, NOW);
  const ids = out.map((s) => s.id);

  assert.equal(ids[0], 2, 'never-viewed stale search result leads');
  assert.ok(!ids.includes(1), 'active tab excluded');
  assert.ok(!ids.includes(4), 'pinned excluded');
  assert.ok(!ids.includes(5), 'recently used excluded');
  assert.ok(out[0].reasons.length >= 2);
  assert.ok(out[0].reasons.some((r) => r.includes('google search')));
});

test('suggestClosures skips non-web tabs entirely', () => {
  const tabs = [
    tab({ id: 1, url: 'chrome://settings', title: 'Settings', lastAccessed: HOURS(900) }),
    tab({ id: 2, url: 'about:blank', title: '', lastAccessed: HOURS(900) }),
  ];
  assert.deepEqual(suggestClosures(tabs, new Map(), {}, NOW), []);
});

test('raising the threshold shrinks the proposal', () => {
  const tabs = [tab({ id: 2, lastAccessed: HOURS(30) })];
  const intel = new Map([[2, { activations: 0 }]]);
  // This tab scores 4: idle capped at 2, plus 2 for never being viewed.
  assert.equal(suggestClosures(tabs, intel, { threshold: 4 }, NOW).length, 1);
  assert.equal(suggestClosures(tabs, intel, { threshold: 5 }, NOW).length, 0);
});

test('an empty browser produces an empty proposal, not a crash', () => {
  assert.deepEqual(suggestClosures([], new Map(), {}, NOW), []);
  assert.deepEqual(suggestClosures([], null, STALENESS_DEFAULTS, NOW), []);
});
