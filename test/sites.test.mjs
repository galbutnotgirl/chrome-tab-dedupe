import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSlackHandoffPage,
  isHandoffPage,
  meetCode,
  isEndedMeetTab,
  finishedReason,
  finishedTabs,
  SITE_DEFAULTS,
} from '../lib/sites.js';

const NOW = 1_800_000_000_000;
const MINS = (n) => NOW - n * 60 * 1000;

const tab = (over = {}) => ({
  id: 1,
  windowId: 1,
  url: 'https://example.com/',
  title: 'Example',
  lastAccessed: NOW,
  pinned: false,
  active: false,
  audible: false,
  ...over,
});

// --- Slack ------------------------------------------------------------------

test('Slack permalinks and profile links are hand-offs', () => {
  assert.ok(isSlackHandoffPage(tab({ url: 'https://acme.slack.com/archives/C123/p1700000000' })));
  assert.ok(isSlackHandoffPage(tab({ url: 'https://acme.slack.com/team/U456' })));
});

test('the Slack web client is never a hand-off', () => {
  // Closing app.slack.com would shut a tab holding real work.
  assert.equal(isSlackHandoffPage(tab({ url: 'https://app.slack.com/client/T1/C2' })), false);
});

test('Slack detection needs the real Slack domain', () => {
  assert.equal(isSlackHandoffPage(tab({ url: 'https://notslack.com/archives/C1/p1' })), false);
  assert.equal(isSlackHandoffPage(tab({ url: 'https://slack.com.evil.test/archives/C1/p1' })), false);
  assert.equal(isSlackHandoffPage(tab({ url: 'http://acme.slack.com/archives/C1/p1' })), false, 'http only');
  assert.equal(isSlackHandoffPage(tab({ url: 'https://acme.slack.com/' })), false, 'workspace home');
});

// --- hand-off pages ---------------------------------------------------------

test('a page that says its job is done is a hand-off', () => {
  const cases = [
    'Connected',
    'You can close this tab',
    'You may now close this window',
    'Authentication complete',
    'Sign-in successful',
  ];
  for (const title of cases) {
    assert.ok(isHandoffPage(tab({ title })), title);
  }
});

test('the Claude desktop connector page is recognized by URL', () => {
  assert.ok(
    isHandoffPage(
      tab({ url: 'https://claude.ai/desktop/connected/epitaxy/local_2e71028b?mcp_auth_source=x', title: '' }),
    ),
  );
});

test('OAuth and meeting-launch callbacks are recognized by URL', () => {
  assert.ok(isHandoffPage(tab({ url: 'https://accounts.google.com/o/oauth2/approval?x=1', title: '' })));
  assert.ok(isHandoffPage(tab({ url: 'https://acme.zoom.us/j/123456', title: 'Launch Meeting' })));
  assert.ok(isHandoffPage(tab({ url: 'https://api.example.com/oauth/callback?code=abc', title: '' })));
});

test('a long article is never a hand-off just for containing a word', () => {
  const title = 'Success! How we shipped the thing and what you can learn from closing the loop';
  assert.equal(isHandoffPage(tab({ title })), false, 'title too long to be a hand-off page');
});

test('an untitled ordinary page is not a hand-off', () => {
  assert.equal(isHandoffPage(tab({ title: '' })), false);
  assert.equal(isHandoffPage(tab({ url: 'chrome://newtab/', title: 'Connected' })), false);
});

// --- Meet -------------------------------------------------------------------

test('meetCode reads a call code and ignores the Meet home page', () => {
  assert.equal(meetCode('https://meet.google.com/abc-defg-hij'), 'abc-defg-hij');
  assert.equal(meetCode('https://meet.google.com/'), null);
  assert.equal(meetCode('https://meet.google.com/landing'), null, 'landing is not a code');
  assert.equal(meetCode('https://example.com/abc-defg-hij'), null);
});

test('a Meet call goes stale only when silent, unfocused and old', () => {
  const call = { url: 'https://meet.google.com/abc-defg-hij' };
  assert.ok(isEndedMeetTab(tab({ ...call, lastAccessed: MINS(45) }), {}, NOW));

  assert.equal(isEndedMeetTab(tab({ ...call, lastAccessed: MINS(5) }), {}, NOW), false, 'too recent');
  assert.equal(
    isEndedMeetTab(tab({ ...call, lastAccessed: MINS(45), audible: true }), {}, NOW),
    false,
    'someone is talking — this is a live call',
  );
  assert.equal(isEndedMeetTab(tab({ ...call, lastAccessed: MINS(45), active: true }), {}, NOW), false, 'you are in it');
  assert.equal(isEndedMeetTab(tab({ ...call, lastAccessed: MINS(45), pinned: true }), {}, NOW), false, 'pinned');
  assert.equal(isEndedMeetTab(tab({ ...call, lastAccessed: 0 }), {}, NOW), false, 'no timing, no guess');
});

test('the Meet staleness window is configurable', () => {
  const call = { url: 'https://meet.google.com/abc-defg-hij', lastAccessed: MINS(20) };
  assert.equal(isEndedMeetTab(tab(call), { meetStaleMinutes: 30 }, NOW), false);
  assert.ok(isEndedMeetTab(tab(call), { meetStaleMinutes: 10 }, NOW));
});

// --- the recognizer ---------------------------------------------------------

test('pinned and active tabs are never called finished', () => {
  const slack = { url: 'https://acme.slack.com/archives/C1/p1' };
  assert.equal(finishedReason(tab({ ...slack, pinned: true }), {}, NOW), null);
  assert.equal(finishedReason(tab({ ...slack, active: true }), {}, NOW), null);
});

test('each category can be switched off independently', () => {
  const slack = tab({ url: 'https://acme.slack.com/archives/C1/p1' });
  assert.equal(finishedReason(slack, {}, NOW).category, 'slack');
  assert.equal(finishedReason(slack, { finishedSlack: false }, NOW), null);

  const handoff = tab({ title: 'Connected' });
  assert.equal(finishedReason(handoff, {}, NOW).category, 'handoff');
  assert.equal(finishedReason(handoff, { finishedHandoff: false }, NOW), null);

  const meet = tab({ url: 'https://meet.google.com/abc-defg-hij', lastAccessed: MINS(45) });
  assert.equal(finishedReason(meet, {}, NOW).category, 'meet');
  assert.equal(finishedReason(meet, { finishedMeet: false }, NOW), null);
});

test('reasons are written in the tab\'s own terms', () => {
  assert.match(finishedReason(tab({ url: 'https://acme.slack.com/archives/C1/p1' }), {}, NOW).label, /desktop app/);
  assert.match(
    finishedReason(tab({ url: 'https://meet.google.com/abc-defg-hij', lastAccessed: MINS(45) }), {}, NOW).label,
    /silent for over 30m/,
  );
});

test('finishedTabs lists the oldest leftovers first and skips live tabs', () => {
  const tabs = [
    tab({ id: 1, url: 'https://acme.slack.com/archives/C1/p1', title: 'Slack', lastAccessed: MINS(2) }),
    tab({ id: 2, title: 'Connected', lastAccessed: MINS(90) }),
    tab({ id: 3, url: 'https://docs.example.com/real/work', title: 'Real work', lastAccessed: MINS(200) }),
    tab({ id: 4, url: 'https://meet.google.com/abc-defg-hij', title: 'Meet', lastAccessed: MINS(60) }),
  ];
  const out = finishedTabs(tabs, {}, NOW);
  assert.deepEqual(out.map((t) => t.id), [2, 4, 1], 'oldest first; the real page is untouched');
  assert.deepEqual(out.map((t) => t.category), ['handoff', 'meet', 'slack']);
});

test('an empty browser produces an empty list', () => {
  assert.deepEqual(finishedTabs([], {}, NOW), []);
  assert.deepEqual(finishedTabs(null, {}, NOW), []);
  assert.equal(SITE_DEFAULTS.meetStaleMinutes, 30);
});
