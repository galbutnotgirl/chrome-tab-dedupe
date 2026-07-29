import { RULES } from './lib/normalize.js';
import { parsePatterns } from './lib/fuzzy.js';
import { DEFAULTS, getSettings, setSettings } from './lib/settings.js';

const savedFlash = document.getElementById('saved');
let flashTimer;

function flashSaved() {
  savedFlash.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => savedFlash.classList.remove('show'), 900);
}

// Per-site rule checkboxes are generated from RULES, so adding a rule to
// lib/normalize.js is all it takes to expose it here.
const rulesHost = document.getElementById('rules');
for (const rule of RULES) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.rule = rule.id;
  label.append(box, document.createTextNode(rule.label));
  rulesHost.append(label);
}

function syncRulesEnabled(smartRules) {
  rulesHost.classList.toggle('disabled', !smartRules);
}

const settings = await getSettings();

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
    if (key === 'smartRules') syncRulesEnabled(el.checked);
    flashSaved();
  });
}

// Fuzzy pattern lists: stored as arrays, edited as one-per-line text.
for (const id of ['disposablePatterns', 'protectPatterns']) {
  const box = document.getElementById(id);
  box.value = (settings[id] || []).join('\n');
  box.addEventListener('change', async () => {
    await setSettings({ [id]: parsePatterns(box.value) });
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
    flashSaved();
  });
}
syncRulesEnabled(settings.smartRules);

const hostsBox = document.getElementById('ignoreHosts');
hostsBox.value = (settings.ignoreHosts || DEFAULTS.ignoreHosts).join('\n');
hostsBox.addEventListener('change', async () => {
  const hosts = hostsBox.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  await setSettings({ ignoreHosts: hosts });
  flashSaved();
});

const armResult = document.getElementById('armResult');
document.getElementById('arm').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'armBypass' }, (res) => {
    const secs = res && res.armedMs ? Math.round(res.armedMs / 1000) : 15;
    armResult.textContent = `Armed — the next tab you open stays (${secs}s).`;
  });
});

// chrome:// links can't be navigated from an extension page, but tabs.create can.
document.getElementById('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

const result = document.getElementById('sweepResult');
document.getElementById('sweep').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'sweep' }, (res) => {
    const n = res && typeof res.count === 'number' ? res.count : 0;
    result.textContent = n ? `Closed ${n} duplicate tab${n === 1 ? '' : 's'}.` : 'No duplicates found.';
  });
});
