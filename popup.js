import { getSettings, setSettings } from './lib/settings.js';

const MAX_ROWS = 6;

const summary = document.getElementById('summary');
const list = document.getElementById('list');
const sweepBtn = document.getElementById('sweep');
const autoBox = document.getElementById('autoDedupe');
const autoRow = document.getElementById('autoRow');
const hint = document.getElementById('hint');
const undoBtn = document.getElementById('undo');

// The popup belongs to the browser window it was opened from, so this is the
// window the "this window" scope means.
const win = await chrome.windows.getCurrent();
const settings = await getSettings();

let allWindows = Boolean(settings.sweepAllWindows);
let view = 'duplicates';
/** Clutter rows the user has unticked — kept so a re-render doesn't re-tick them. */
let excluded = new Set();
let clutter = [];

autoBox.checked = Boolean(settings.autoDedupe);
autoBox.addEventListener('change', () => setSettings({ autoDedupe: autoBox.checked }));

function ask(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, allWindows, windowId: win.id, ...extra });
}

function setPressed(selector, attr, value) {
  for (const btn of document.querySelectorAll(selector)) {
    btn.setAttribute('aria-pressed', String(btn.dataset[attr] === value));
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// --- duplicates view --------------------------------------------------------

function renderDuplicates(report) {
  const n = report.count;
  summary.textContent = n
    ? `${plural(n, 'duplicate tab')} — ${plural(report.groups.length, 'page')}`
    : 'No duplicates here.';
  sweepBtn.disabled = n === 0;
  sweepBtn.textContent = n ? `Close ${plural(n, 'duplicate tab')}` : 'Nothing to close';
  hint.textContent = '';

  list.replaceChildren();
  for (const group of report.groups.slice(0, MAX_ROWS)) {
    const li = document.createElement('li');
    li.append(titleCell(group.title, group.host));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${group.copies}×`;
    li.append(count);
    list.append(li);
  }
  appendOverflow(report.groups.length);
}

// --- clutter view -----------------------------------------------------------

function renderClutter(report) {
  clutter = report.suggestions;
  const n = clutter.filter((s) => !excluded.has(s.id)).length;

  summary.textContent = clutter.length
    ? `${plural(clutter.length, 'tab')} you're probably done with`
    : `Nothing stale in ${plural(report.scanned, 'tab')}.`;
  hint.textContent = clutter.length ? 'Untick anything you want to keep.' : '';

  sweepBtn.disabled = n === 0;
  sweepBtn.textContent = n ? `Close ${plural(n, 'tab')}` : 'Nothing selected';

  list.replaceChildren();
  for (const item of clutter.slice(0, MAX_ROWS)) {
    const li = document.createElement('li');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pick';
    box.checked = !excluded.has(item.id);
    box.addEventListener('change', () => {
      if (box.checked) excluded.delete(item.id);
      else excluded.add(item.id);
      const left = clutter.filter((s) => !excluded.has(s.id)).length;
      sweepBtn.disabled = left === 0;
      sweepBtn.textContent = left ? `Close ${plural(left, 'tab')}` : 'Nothing selected';
    });

    li.append(box, titleCell(item.title, item.reasons.join(' · ')));
    list.append(li);
  }
  appendOverflow(clutter.length);
}

// --- shared -----------------------------------------------------------------

function titleCell(text, sub) {
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = text;
  title.title = text;
  if (sub) {
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = sub;
    title.append(host);
  }
  return title;
}

function appendOverflow(total) {
  const hidden = total - MAX_ROWS;
  if (hidden <= 0) return;
  const li = document.createElement('li');
  li.className = 'more';
  li.textContent = `+${hidden} more`;
  list.append(li);
}

async function refresh() {
  const { lastClose } = await chrome.storage.session.get('lastClose');
  undoBtn.hidden = !(lastClose && lastClose.count);
  if (!undoBtn.hidden) undoBtn.textContent = `Undo (${lastClose.count})`;

  autoRow.hidden = view === 'clutter';
  if (view === 'duplicates') renderDuplicates(await ask('report'));
  else renderClutter(await ask('clutter'));
}

for (const btn of document.querySelectorAll('[data-view]')) {
  btn.addEventListener('click', async () => {
    view = btn.dataset.view;
    setPressed('[data-view]', 'view', view);
    await refresh();
  });
}
setPressed('[data-view]', 'view', view);

for (const btn of document.querySelectorAll('[data-scope]')) {
  btn.addEventListener('click', async () => {
    allWindows = btn.dataset.scope === 'all';
    setPressed('[data-scope]', 'scope', btn.dataset.scope);
    // Remember it so the keyboard shortcut and context menu agree.
    await setSettings({ sweepAllWindows: allWindows });
    await refresh();
  });
}
setPressed('[data-scope]', 'scope', allWindows ? 'all' : 'window');

sweepBtn.addEventListener('click', async () => {
  sweepBtn.disabled = true;
  let closed = 0;

  if (view === 'duplicates') {
    const res = await ask('sweep');
    closed = res && res.count ? res.count : 0;
  } else {
    const ids = clutter.filter((s) => !excluded.has(s.id)).map((s) => s.id);
    const res = await ask('closeIds', { ids, what: 'clutter review' });
    closed = res && res.count ? res.count : 0;
    excluded = new Set();
  }

  summary.textContent = closed ? `Closed ${plural(closed, 'tab')}.` : 'Nothing closed.';
  hint.textContent = '';
  list.replaceChildren();
  sweepBtn.textContent = 'Done';
  undoBtn.hidden = closed === 0;
  undoBtn.textContent = `Undo (${closed})`;
});

undoBtn.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'undo' });
  const n = res && res.restored ? res.restored : 0;
  summary.textContent = n ? `Restored ${plural(n, 'tab')}.` : 'Nothing left to restore.';
  undoBtn.hidden = true;
  await refresh();
});

document.getElementById('arm').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'armBypass' });
  summary.textContent = 'Next tab you open stays, even if it is a duplicate.';
  list.replaceChildren();
  sweepBtn.disabled = true;
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

await refresh();
