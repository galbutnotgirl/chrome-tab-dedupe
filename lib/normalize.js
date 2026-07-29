/**
 * URL -> dedupe key.
 *
 * Pure module: no chrome.* calls, so test/ imports it straight into node.
 *
 * Two layers:
 *   1. RULES — per-site "same document" rules. These reduce a URL to the thing
 *      a human would call the document (a doc id, an issue key, a page id) and
 *      throw away view state: which slide, which sheet tab, which heading, which
 *      PR sub-tab. This is what makes a Slides link with #slide=id.g12 match the
 *      copy you already had open on a different slide.
 *   2. genericKey — everything else. Origin + path + meaningful query. Hash is
 *      kept unless it looks like scroll position, because plenty of apps route
 *      on the hash (Gmail threads) and collapsing those would close live work.
 */

const TRACKING_PARAMS = new Set([
  'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'vero_id', 'oly_enc_id', 'oly_anon_id',
  'wickedid', 's_kwcid', 'usp', 'pli', 'si', 'trk', 'trkcampaign', 'originalreferer',
]);

const TRACKING_PREFIXES = [/^utm_/, /^ga_/, /^_ga/, /^pk_/, /^mtm_/, /^at_/];

// Hashes that mean "scroll here" rather than "show a different thing".
const NOISE_HASH = /^#(?:$|top$|:~:text=|slide=|heading=|bookmark=|gid=|range=|id\.|h\.)/i;

function isTrackingParam(name) {
  const k = name.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((re) => re.test(k));
}

/** Per-site same-document rules. Order matters: first match wins. */
export const RULES = [
  {
    id: 'google-docs',
    label: 'Google Docs / Sheets / Slides / Forms — same file on any slide, sheet tab, or heading',
    key(u, host) {
      if (host !== 'docs.google.com') return null;
      const m = u.pathname.match(
        /^\/(document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]{10,})/,
      );
      return m ? `gdoc:${m[1]}:${m[2]}` : null;
    },
  },
  {
    id: 'google-drive',
    label: 'Google Drive — same file or folder in any view mode',
    key(u, host) {
      if (host !== 'drive.google.com') return null;
      const folder = u.pathname.match(/\/folders\/([\w-]{10,})/);
      if (folder) return `gdrive:folder:${folder[1]}`;
      const file = u.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/);
      return file ? `gdrive:file:${file[1]}` : null;
    },
  },
  {
    id: 'jira',
    label: 'Jira — same issue whether opened direct or from a board',
    key(u, host) {
      if (!host.endsWith('.atlassian.net')) return null;
      const m = u.pathname.match(/\/(?:browse|issues)\/([A-Za-z][A-Za-z0-9]+-\d+)/);
      return m ? `jira:${host}:${m[1].toUpperCase()}` : null;
    },
  },
  {
    id: 'confluence',
    label: 'Confluence — same page even when the title slug differs',
    key(u, host) {
      if (!host.endsWith('.atlassian.net')) return null;
      const m = u.pathname.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)/);
      return m ? `confluence:${host}:${m[1]}` : null;
    },
  },
  {
    id: 'salesforce',
    label: 'Salesforce — same record on any related tab',
    key(u, host) {
      if (!/(?:\.lightning\.force|\.my\.salesforce)\.com$/.test(host)) return null;
      const m = u.pathname.match(/\/lightning\/r\/[^/]+\/(\w{15,18})\b/);
      return m ? `sf:${host}:${m[1]}` : null;
    },
  },
  {
    id: 'figma',
    label: 'Figma — same file on any page, node, or present mode',
    key(u, host) {
      if (host !== 'figma.com') return null;
      const m = u.pathname.match(/^\/(?:file|design|board|proto|slides)\/([\w-]{10,})/);
      return m ? `figma:${m[1]}` : null;
    },
  },
  {
    id: 'github',
    label: 'GitHub — same PR or issue on any sub-tab (files, commits, checks)',
    key(u, host) {
      if (host !== 'github.com') return null;
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/);
      return m ? `gh:${m[1]}/${m[2]}:${m[3]}` : null;
    },
  },
  {
    id: 'notion',
    label: 'Notion — same page regardless of title slug',
    key(u, host) {
      if (!/(?:^|\.)notion\.(?:so|site)$/.test(host)) return null;
      const m = u.pathname.match(/([0-9a-f]{32})/i);
      return m ? `notion:${m[1].toLowerCase()}` : null;
    },
  },
  {
    id: 'youtube',
    label: 'YouTube — same video, ignoring timestamp and playlist',
    key(u, host) {
      if (host === 'youtu.be') {
        const id = u.pathname.slice(1);
        return id ? `yt:${id}` : null;
      }
      if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;
      const v = u.searchParams.get('v');
      return v ? `yt:${v}` : null;
    },
  },
];

export function genericKey(u, host, settings = {}) {
  const path = u.pathname.replace(/\/+$/, '') || '/';

  let query = '';
  if (!settings.ignoreQuery) {
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !isTrackingParam(k))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (params.length) query = '?' + params.map(([k, v]) => `${k}=${v}`).join('&');
  }

  const hash = NOISE_HASH.test(u.hash) ? '' : u.hash;

  // http and https collapse: same page, and mixed-scheme dupes are common from
  // pasted links. Local dev hosts are excluded via ignoreHosts instead.
  return `web:${host}${path}${query}${hash}`;
}

function hostIsIgnored(host, ignoreHosts) {
  if (!ignoreHosts || !ignoreHosts.length) return false;
  return ignoreHosts.some((raw) => {
    const entry = String(raw).trim().toLowerCase().replace(/^\*?\./, '');
    if (!entry) return false;
    return host === entry || host.endsWith('.' + entry);
  });
}

/**
 * Returns a stable key for `rawUrl`, or null when the URL should never be
 * deduped (non-http, blank tabs, chrome:// pages, ignored hosts).
 */
export function keyForUrl(rawUrl, settings = {}) {
  if (!rawUrl) return null;

  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  if (hostIsIgnored(host, settings.ignoreHosts)) return null;

  if (settings.smartRules !== false) {
    const off = settings.disabledRules || [];
    for (const rule of RULES) {
      if (off.includes(rule.id)) continue;
      const key = rule.key(u, host);
      if (key) return key;
    }
  }

  return genericKey(u, host, settings);
}
