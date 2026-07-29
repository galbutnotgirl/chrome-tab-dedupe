import { getSettings, setSettings } from './lib/settings.js';

/** Duplicates group by page so the list is short; clutter is per tab, so show more. */
const MAX_ROWS = { duplicates: 6, clutter: 12 };

const summary = document.getElementById('summary');
const list = document.getElementById('list');
const sweepBtn = document.getElementById('sweep');
const autoBox = document.getElementById('autoDedupe');
const autoRow = document.getElementById('autoRow');
const hint = document.getElementById('hint');
const undoBtn = document.getElementById('undo');
const selectAllBtn = document.getElementById('selectAll');
const clearAllBtn = document.getElementById('clearAll');

// The popup belongs to the browser window it was opened from, so this is the
// window the "this window" scope means.
const win = await chrome.windows.getCurrent();
const settings = await getSettings();

let allWindows = Boolean(settings.sweepAllWindows);
let view = 'duplicates';
/**
 * Clutter is opt-in, not opt-out. Nothing is ticked until you tick it — a
 * proposal you can't read through is not something to pre-approve.
 */
let selected = new Set();
let clutter = [];
/**
 * The tab ids actually rendered. Select-all covers these and only these — the
 * proposal can be longer than the list, and selecting rows you cannot see is the
 * trap this whole view exists to avoid.
 */
let shownIds = [];

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
  for (const group of report.groups.slice(0, MAX_ROWS.duplicates)) {
    const li = document.createElement('li');
    li.append(titleCell(group.title, group.host));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${group.copies}×`;
    li.append(count);
    list.append(li);
  }
  appendOverflow(report.groups.length, MAX_ROWS.duplicates);
}

// --- clutter view -----------------------------------------------------------

function syncClutterButton() {
  const n = selected.size;
  sweepBtn.disabled = n === 0;
  sweepBtn.textContent = n ? `Close ${plural(n, 'tab')}` : 'Select tabs to close';

  // Both actions stay visible, so there's always a way back from a big selection.
  selectAllBtn.hidden = shownIds.length === 0;
  selectAllBtn.textContent = `Select all ${shownIds.length}`;
  selectAllBtn.disabled = shownIds.every((id) => selected.has(id));
  clearAllBtn.hidden = shownIds.length === 0;
  clearAllBtn.disabled = n === 0;
}

function syncBoxes() {
  for (const box of list.querySelectorAll('.pick')) {
    box.checked = selected.has(Number(box.dataset.tabId));
  }
}

function renderClutter(report) {
  clutter = report.suggestions;
  // Drop selections for tabs that are no longer in the proposal.
  const live = new Set(clutter.map((s) => s.id));
  selected = new Set([...selected].filter((id) => live.has(id)));

  const rows = clutter.slice(0, MAX_ROWS.clutter);
  shownIds = rows.map((item) => item.id);
  const shown = rows.length;
  summary.textContent = clutter.length
    ? `${plural(clutter.length, 'tab')} you're probably done with`
    : `Nothing stale in ${plural(report.scanned, 'tab')}.`;
  hint.textContent = clutter.length
    ? `Click a title to go look at it. Showing ${shown} of ${clutter.length}.`
    : '';

  list.replaceChildren();
  for (const item of rows) {
    const li = document.createElement('li');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pick';
    box.dataset.tabId = String(item.id);
    box.checked = selected.has(item.id);
    box.addEventListener('change', () => {
      if (box.checked) selected.add(item.id);
      else selected.delete(item.id);
      syncClutterButton();
    });

    // The title is a button, not text: closing a tab you can't inspect first is
    // a guess. Clicking switches to it (and closes the popup, as Chrome does).
    const jump = document.createElement('button');
    jump.className = 'jump';
    jump.append(titleCell(item.title, item.reasons.join(' · ')));
    jump.title = 'Go to this tab';
    jump.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'focusTab', tabId: item.id });
      window.close();
    });

    li.append(box, jump);
    list.append(li);
  }
  appendOverflow(clutter.length, MAX_ROWS.clutter);
  syncClutterButton();
}

// --- shared -----------------------------------------------------------------

function titleCell(text, sub) {
  const title = document.createElement('span');
  title.className = 'title';
  const main = document.createElement('span');
  main.className = 'titleText';
  main.textContent = text;
  title.append(main);
  title.title = text;
  if (sub) {
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = sub;
    title.append(host);
  }
  return title;
}

function appendOverflow(total, max) {
  const hidden = total - max;
  if (hidden <= 0) return;
  const li = document.createElement('li');
  li.className = 'more';
  li.textContent = `+${hidden} more — close these, then reopen to see the rest`;
  list.append(li);
}

async function refresh() {
  const { lastClose } = await chrome.storage.session.get('lastClose');
  undoBtn.hidden = !(lastClose && lastClose.count);
  if (!undoBtn.hidden) undoBtn.textContent = `Undo (${lastClose.count})`;

  autoRow.hidden = view === 'clutter';
  if (view !== 'clutter') {
    selectAllBtn.hidden = true;
    clearAllBtn.hidden = true;
  }
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

selectAllBtn.addEventListener('click', () => {
  selected = new Set(shownIds);
  syncBoxes();
  syncClutterButton();
});

clearAllBtn.addEventListener('click', () => {
  selected.clear();
  syncBoxes();
  syncClutterButton();
});

sweepBtn.addEventListener('click', async () => {
  sweepBtn.disabled = true;
  let closed = 0;

  if (view === 'duplicates') {
    const res = await ask('sweep');
    closed = res && res.count ? res.count : 0;
  } else {
    const res = await ask('closeIds', { ids: [...selected], what: 'clutter review' });
    closed = res && res.count ? res.count : 0;
    selected = new Set();
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
