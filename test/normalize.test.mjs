import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyForUrl } from '../lib/normalize.js';
import { DEFAULTS } from '../lib/settings.js';

const S = DEFAULTS;
const same = (a, b, msg) => assert.equal(keyForUrl(a, S), keyForUrl(b, S), msg);
const differ = (a, b, msg) => assert.notEqual(keyForUrl(a, S), keyForUrl(b, S), msg);

test('Google Slides: same deck on a different slide', () => {
  same(
    'https://docs.google.com/presentation/d/1SlIdEsAbCdEfGhIjKlMnOpQrStUvWx/edit#slide=id.g12345_0_1',
    'https://docs.google.com/presentation/d/1SlIdEsAbCdEfGhIjKlMnOpQrStUvWx/edit',
  );
});

test('Google Docs: ?tab=, heading anchors, /u/0/ and share params all collapse', () => {
  const canonical = 'https://docs.google.com/document/d/1DoCuMeNtAbCdEfGhIjKlMnOpQrStUv/edit';
  same(canonical, canonical + '?tab=t.0#heading=h.abc123');
  same(canonical, 'https://docs.google.com/document/u/0/d/1DoCuMeNtAbCdEfGhIjKlMnOpQrStUv/edit');
  same(canonical, canonical + '?usp=sharing');
  same(canonical, 'https://docs.google.com/document/d/1DoCuMeNtAbCdEfGhIjKlMnOpQrStUv/preview');
});

test('Google Sheets: different gid is still the same spreadsheet', () => {
  same(
    'https://docs.google.com/spreadsheets/d/1ShEeTsAbCdEfGhIjKlMnOpQrStUvWx/edit#gid=0',
    'https://docs.google.com/spreadsheets/d/1ShEeTsAbCdEfGhIjKlMnOpQrStUvWx/edit#gid=887766',
  );
});

test('different documents never collapse', () => {
  differ(
    'https://docs.google.com/document/d/1AAAAAAAAAAAAAAAAAAAA/edit',
    'https://docs.google.com/document/d/1BBBBBBBBBBBBBBBBBBBB/edit',
  );
  differ(
    'https://docs.google.com/document/d/1AAAAAAAAAAAAAAAAAAAA/edit',
    'https://docs.google.com/spreadsheets/d/1AAAAAAAAAAAAAAAAAAAA/edit',
  );
});

test('hash-routed apps stay distinct (Gmail threads)', () => {
  differ(
    'https://mail.google.com/mail/u/0/#inbox/FMfcgzAAAA',
    'https://mail.google.com/mail/u/0/#inbox/FMfcgzBBBB',
  );
});

test('Confluence page id wins over the title slug', () => {
  same(
    'https://example.atlassian.net/wiki/spaces/TEAM/pages/123456/Quarterly+Plan',
    'https://example.atlassian.net/wiki/spaces/TEAM/pages/123456/quarterly-plan-and-targets',
  );
});

test('Jira issue: board link and direct link match', () => {
  same(
    'https://example.atlassian.net/browse/ACME-42',
    'https://example.atlassian.net/jira/software/c/projects/ACME/issues/ACME-42',
  );
  differ(
    'https://example.atlassian.net/browse/ACME-42',
    'https://example.atlassian.net/browse/ACME-43',
  );
});

test('Salesforce record across related tabs', () => {
  same(
    'https://example.lightning.force.com/lightning/r/Account/0018d00000ABCDEfgh/view',
    'https://example.lightning.force.com/lightning/r/Account/0018d00000ABCDEfgh/related/Opportunities/view',
  );
});

test('GitHub PR sub-tabs collapse to the PR', () => {
  same(
    'https://github.com/acme/site/pull/812/files#diff-abc',
    'https://github.com/acme/site/pull/812',
  );
  differ('https://github.com/acme/site/pull/812', 'https://github.com/acme/site/pull/813');
});

test('Figma file across pages and present mode', () => {
  same(
    'https://www.figma.com/design/AbCdEf123456/Deck?node-id=1-2',
    'https://www.figma.com/proto/AbCdEf123456/Deck?node-id=99-1',
  );
});

test('YouTube ignores timestamp and playlist', () => {
  same('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://youtu.be/dQw4w9WgXcQ');
});

test('generic: scheme, www, trailing slash, tracking params, scroll-to-text', () => {
  same('http://example.com/docs/', 'https://www.example.com/docs');
  same('https://example.com/a?utm_source=slack&gclid=x', 'https://example.com/a');
  same('https://example.com/a#:~:text=hello', 'https://example.com/a');
});

test('generic: meaningful query params are kept, in any order', () => {
  same('https://example.com/s?b=2&a=1', 'https://example.com/s?a=1&b=2');
  differ('https://example.com/s?q=pricing', 'https://example.com/s?q=assets');
});

test('non-dedupable URLs return null', () => {
  for (const url of ['chrome://newtab/', 'about:blank', 'chrome-extension://abc/x.html', '', undefined]) {
    assert.equal(keyForUrl(url, S), null, `expected null for ${url}`);
  }
});

test('ignoreHosts covers subdomains', () => {
  assert.equal(keyForUrl('http://localhost:3000/app', S), null);
  assert.equal(keyForUrl('http://api.localhost/app', S), null);
  assert.notEqual(keyForUrl('https://example.com/app', S), null);
});

test('disabling a rule falls back to generic matching', () => {
  const off = { ...DEFAULTS, disabledRules: ['google-docs'] };
  const a = 'https://docs.google.com/presentation/d/1AAAAAAAAAAAAAAAAAAAA/edit#slide=id.g1';
  const b = 'https://docs.google.com/presentation/d/1AAAAAAAAAAAAAAAAAAAA/edit#slide=id.g9';
  // Slide hashes are treated as scroll position even generically, so these still
  // match — but a different sub-path no longer collapses.
  assert.equal(keyForUrl(a, off), keyForUrl(b, off));
  assert.notEqual(
    keyForUrl('https://docs.google.com/presentation/d/1AAAAAAAAAAAAAAAAAAAA/edit', off),
    keyForUrl('https://docs.google.com/presentation/d/1AAAAAAAAAAAAAAAAAAAA/preview', off),
  );
});
