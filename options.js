import { RULES } from './lib/normalize.js';
import { parsePatterns } from './lib/fuzzy.js';
import { DEFAULTS, getSettings, setSettings } from './lib/settings.js';

const savedPill = document.getElementById('saved');
let savedTimer;

function flashSaved() {
  savedPill.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedPill.classList.remove('show'), 1100);
}

const settings = await getSettings();

// --- per-site rules: built from RULES, so adding one needs no markup ---------

const rulesHost = document.getElementById('rules');
const rulesCount = document.getElementById('rulesCount');

for (const rule of RULES) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.rule = rule.id;

  const text = document.createElement('span');
  const site = document.createElement('span');
  site.className = 'site';
  site.textContent = rule.site || rule.id;
  const detail = document.createElement('span');
  detail.className = 'detail';
  detail.textContent = rule.label;
  text.append(site, detail);

  label.append(box, text);
  rulesHost.append(label);
}

function updateRulesSummary() {
  const on = rulesHost.querySelectorAll('[data-rule]:checked').length;
  rulesCount.textContent = `Per-site rules — ${on} of ${RULES.length} on`;
  rulesHost.classList.toggle('disabled', !document.querySelector('[data-setting="smartRules"]').checked);
}

// --- settings bindings ------------------------------------------------------

for (const el of document.querySelectorAll('[data-setting]')) {
  const key = el.dataset.setting;
  const isNumber = el.dataset.type === 'number';

  if (isNumber) el.value = String(settings[key]);
  else el.checked = Boolean(settings[key]);

  el.addEventListener('change', async () => {
    let value;
    if (isNumber) {
      const parsed = Number(el.value);
      // Never let a blank or nonsense entry become the stored setting.
      value = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS[key];
      el.value = String(value);
    } else {
      value = el.checked;
    }
    await setSettings({ [key]: value });
    if (key === 'smartRules') updateRulesSummary();
    flashSaved();
  });
}

for (const el of rulesHost.querySelectorAll('[data-rule]')) {
  el.checked = !settings.disabledRules.includes(el.dataset.rule);
  el.addEventListener('change', async () => {
    const current = await getSettings();
    const off = new Set(current.disabledRules);
    if (el.checked) off.delete(el.dataset.rule);
    else off.add(el.dataset.rule);
    await setSettings({ disabledRules: [...off] });
    updateRulesSummary();
    flashSaved();
  });
}
updateRulesSummary();

// Line-per-entry text areas, stored as arrays.
const LISTS = {
  disposablePatterns: parsePatterns,
  ignoreHosts: (raw) =>
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
};

for (const [id, parse] of Object.entries(LISTS)) {
  const box = document.getElementById(id);
  box.value = (settings[id] || DEFAULTS[id] || []).join('\n');
  box.addEventListener('change', async () => {
    await setSettings({ [id]: parse(box.value) });
    flashSaved();
  });
}

// chrome:// links can't be navigated from an extension page, but tabs.create can.
document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// --- nav highlighting -------------------------------------------------------

const links = [...document.querySelectorAll('.nav a')];
const sections = links
  .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
  .filter(Boolean);

// Track everything currently on screen and highlight the topmost one. Reacting to
// each entry individually lets whichever fired last win, which picks the wrong
// section on load.
const onScreen = new Set();

const spy = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) onScreen.add(entry.target.id);
      else onScreen.delete(entry.target.id);
    }
    const active = sections.find((s) => onScreen.has(s.id));
    if (!active) return;
    for (const link of links) {
      link.classList.toggle('current', link.getAttribute('href') === `#${active.id}`);
    }
  },
  { rootMargin: '-96px 0px -55% 0px' },
);
for (const section of sections) spy.observe(section);
