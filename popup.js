import { getSettings, setSettings } from './lib/settings.js';

const MAX_ROWS = 6;

const summary = document.getElementById('summary');
const list = document.getElementById('list');
const sweepBtn = document.getElementById('sweep');
const autoBox = document.getElementById('autoDedupe');

// The popup belongs to the browser window it was opened from, so this is the
// window the "this window" scope means.
const win = await chrome.windows.getCurrent();
const settings = await getSettings();
let allWindows = Boolean(settings.sweepAllWindows);

autoBox.checked = Boolean(settings.autoDedupe);
autoBox.addEventListener('change', () => setSettings({ autoDedupe: autoBox.checked }));

function ask(type) {
  return chrome.runtime.sendMessage({ type, allWindows, windowId: win.id });
}

function render(report) {
  const n = report.count;
  summary.textContent = n
    ? `${n} duplicate tab${n === 1 ? '' : 's'} — ${report.groups.length} page${report.groups.length === 1 ? '' : 's'}`
    : 'No duplicates here.';

  sweepBtn.disabled = n === 0;
  sweepBtn.textContent = n ? `Close ${n} duplicate tab${n === 1 ? '' : 's'}` : 'Nothing to close';

  list.replaceChildren();
  for (const group of report.groups.slice(0, MAX_ROWS)) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = group.title;
    title.title = group.title;
    if (group.host) {
      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = group.host;
      title.append(host);
    }
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${group.copies}×`;
    li.append(title, count);
    list.append(li);
  }
  const hidden = report.groups.length - MAX_ROWS;
  if (hidden > 0) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = `+${hidden} more`;
    list.append(li);
  }
}

async function refresh() {
  render(await ask('report'));
}

for (const btn of document.querySelectorAll('[data-scope]')) {
  const isAll = btn.dataset.scope === 'all';
  btn.setAttribute('aria-pressed', String(isAll === allWindows));
  btn.addEventListener('click', async () => {
    allWindows = isAll;
    for (const other of document.querySelectorAll('[data-scope]')) {
      other.setAttribute('aria-pressed', String((other.dataset.scope === 'all') === allWindows));
    }
    // Remember the choice so the keyboard shortcut and context menu agree with it.
    await setSettings({ sweepAllWindows: allWindows });
    await refresh();
  });
}

sweepBtn.addEventListener('click', async () => {
  sweepBtn.disabled = true;
  const res = await ask('sweep');
  const n = res && res.count ? res.count : 0;
  summary.textContent = n ? `Closed ${n} duplicate tab${n === 1 ? '' : 's'}.` : 'Nothing closed.';
  list.replaceChildren();
  sweepBtn.textContent = 'Done';
});

document.getElementById('arm').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'armBypass' });
  summary.textContent = 'Next tab you open stays, even if it is a duplicate.';
  list.replaceChildren();
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

await refresh();
