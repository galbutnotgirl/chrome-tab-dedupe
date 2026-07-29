import { getSettings, setSettings } from './lib/settings.js';

/** Duplicates group by page so the list is short; clutter is per tab, so show more. */
const MAX_ROWS = { duplicates: 6, clutter: 12, finished: 12 };

const summary = document.getElementById('summary');
const list = document.getElementById('list');
const sweepBtn = document.getElementById('sweep');
const autoBox = document.getElementById('autoDedupe');
const autoRow = document.getElementById('autoRow');
const hint = document.getElementById('hint');
const undoBtn = document.getElementById('undo');
const selectAllBtn = document.getElementById('selectAll');
const clearAllBtn = document.getElementById('clearAll');
const relatedBox = document.getElementById('related');
const scopeRow = document.getElementById('scopeRow');
const viewsRow = document.querySelector('.views');
const findInput = document.getElementById('find');
const resultsList = document.getElementById('results');
const mergeBtn = document.getElementById('merge');

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
/** Find state: current results and the keyboard cursor within them. */
let results = [];
let cursor = 0;
let finishedItems = [];

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

function plural(n, word, many) {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${many || `${word}s`}`;
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
    ? `Showing ${shown} of ${clutter.length} · click a title to look first`
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

// --- finished view ----------------------------------------------------------

const CATEGORY_ORDER = ['handoff', 'slack', 'meet'];
/** [singular, plural] — brand names keep their capitals in both. */
const CATEGORY_NAME = {
  handoff: ['hand-off page', 'hand-off pages'],
  slack: ['Slack link', 'Slack links'],
  meet: ['ended Meet call', 'ended Meet calls'],
};

function renderFinished(report) {
  const items = report.items;
  finishedItems = items;

  if (!items.length) {
    summary.textContent = `Nothing finished in ${plural(report.scanned, 'tab')}.`;
    hint.textContent = 'Slack links, "you can close this" pages and ended Meet calls show up here.';
    list.replaceChildren();
    sweepBtn.disabled = true;
    sweepBtn.textContent = 'Nothing to close';
    return;
  }

  // Counts per category, so the header says what the number is made of.
  const counts = new Map();
  for (const item of items) counts.set(item.category, (counts.get(item.category) || 0) + 1);
  const breakdown = CATEGORY_ORDER.filter((c) => counts.has(c))
    .map((c) => {
      const n = counts.get(c);
      return `${n} ${CATEGORY_NAME[c][n === 1 ? 0 : 1]}`;
    })
    .join(' · ');

  summary.textContent = `${plural(items.length, 'tab')} already done with`;
  hint.textContent = breakdown;
  sweepBtn.disabled = false;
  sweepBtn.textContent = `Close all ${items.length}`;

  list.replaceChildren();
  for (const item of items.slice(0, MAX_ROWS.finished)) {
    const li = document.createElement('li');
    const jump = document.createElement('button');
    jump.className = 'jump';
    jump.append(titleCell(item.title, item.label));
    jump.title = 'Go to this tab';
    jump.addEventListener('click', () => jumpTo(item.id));

    // Per-row close, for when you want one gone but not the rest.
    const one = document.createElement('button');
    one.className = 'link';
    one.textContent = '✕';
    one.title = 'Close just this tab';
    one.addEventListener('click', async (event) => {
      event.stopPropagation();
      await ask('closeIds', { ids: [item.id], what: 'finished page' });
      await refresh();
    });

    li.append(jump, one);
    list.append(li);
  }
  appendOverflow(items.length, MAX_ROWS.finished);
}

// --- related view -----------------------------------------------------------

const MAX_GROUP_ROWS = 4;

async function jumpTo(tabId) {
  await chrome.runtime.sendMessage({ type: 'focusTab', tabId });
  window.close();
}

function renderRelated(report) {
  relatedBox.replaceChildren();

  if (!report.seed) {
    summary.textContent = 'No tab to review.';
    hint.textContent = '';
    return;
  }

  summary.textContent = report.seed.title;
  hint.textContent = 'Each group closes on its own. Undo puts it back.';

  for (const group of report.groups) {
    const block = document.createElement('div');
    block.className = 'group';

    const head = document.createElement('div');
    head.className = 'groupHead';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = group.label;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = group.ids.length ? plural(group.ids.length, 'tab') : 'none';
    head.append(name, num);

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = group.skipped
      ? `${group.note} · ${group.skipped} left alone (pinned, grouped, or playing)`
      : group.note;

    block.append(head, note);

    if (group.tabs.length) {
      const ul = document.createElement('ul');
      for (const item of group.tabs.slice(0, MAX_GROUP_ROWS)) {
        const li = document.createElement('li');
        if (item.isSeed) li.className = 'self';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = item.isSeed ? '▸' : '·';
        const jump = document.createElement('button');
        jump.textContent = item.isSeed ? `${item.title} (this tab)` : item.title;
        jump.title = 'Go to this tab';
        jump.addEventListener('click', () => jumpTo(item.id));
        li.append(dot, jump);
        ul.append(li);
      }
      const hidden = group.tabs.length - MAX_GROUP_ROWS;
      if (hidden > 0) {
        const li = document.createElement('li');
        li.textContent = `   +${hidden} more`;
        ul.append(li);
      }
      block.append(ul);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'act';
    closeBtn.disabled = group.ids.length === 0;
    closeBtn.textContent = group.ids.length ? `Close ${plural(group.ids.length, 'tab')}` : 'Nothing to close';
    closeBtn.addEventListener('click', async () => {
      closeBtn.disabled = true;
      const res = await ask('closeIds', { ids: group.ids, what: `related: ${group.key}` });
      const n = res && res.count ? res.count : 0;
      closeBtn.textContent = `Closed ${n}`;
      await refresh();
    });
    block.append(closeBtn);

    relatedBox.append(block);
  }
}

// --- find -------------------------------------------------------------------

const searching = () => findInput.value.trim().length > 0;

function renderResults(report) {
  results = report.results;
  cursor = Math.min(cursor, Math.max(results.length - 1, 0));

  const total = results.reduce((n, r) => n + r.ids.length, 0);
  summary.textContent = results.length
    ? `${plural(results.length, 'match', 'matches')}${total > results.length ? ` · ${total} tabs` : ''}`
    : `Nothing matches "${report.query}".`;
  hint.textContent = results.length ? '↑↓ to move · Enter to open · Esc to clear' : '';

  resultsList.replaceChildren();
  results.forEach((item, index) => {
    const li = document.createElement('li');
    if (index === cursor) li.className = 'cursor';
    if (item.active) li.classList.add('here');

    const jump = document.createElement('button');
    jump.className = 'jump';
    jump.append(titleCell(item.title, item.host));
    jump.addEventListener('click', () => jumpTo(item.id));
    li.append(jump);

    if (item.copies > 1) {
      const copies = document.createElement('span');
      copies.className = 'copies';
      copies.textContent = `${item.copies}×`;
      copies.title = `${item.copies} copies of this page`;
      li.append(copies);
    }
    resultsList.append(li);
  });

  // Close every match, copies included — the fast way to clear a whole topic.
  sweepBtn.hidden = results.length === 0;
  sweepBtn.disabled = results.length === 0;
  sweepBtn.textContent = total ? `Close ${plural(total, 'matching tab')}` : 'Nothing to close';
}

function moveCursor(delta) {
  if (!results.length) return;
  cursor = (cursor + delta + results.length) % results.length;
  for (const [index, li] of [...resultsList.children].entries()) {
    li.classList.toggle('cursor', index === cursor);
  }
  resultsList.children[cursor].scrollIntoView({ block: 'nearest' });
}

findInput.addEventListener('input', () => {
  cursor = 0;
  refresh();
});

findInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveCursor(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveCursor(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (results[cursor]) jumpTo(results[cursor].id);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (searching()) {
      findInput.value = '';
      refresh();
    } else {
      window.close();
    }
  }
});

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
  li.textContent = `+${hidden} more — handle these, then reopen`;
  list.append(li);
}

async function refresh() {
  // Only worth offering when there is actually something to merge.
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  mergeBtn.hidden = windows.length < 2;
  if (!mergeBtn.hidden) mergeBtn.textContent = `Merge ${windows.length} windows`;

  const { lastClose } = await chrome.storage.session.get('lastClose');
  undoBtn.hidden = !(lastClose && lastClose.count);
  if (!undoBtn.hidden) undoBtn.textContent = `Undo (${lastClose.count})`;

  const finding = searching();

  // Search takes over the body of the popup while there's a query.
  viewsRow.hidden = finding;
  resultsList.hidden = !finding;
  if (finding) {
    scopeRow.hidden = true;
    list.hidden = true;
    relatedBox.hidden = true;
    autoRow.hidden = true;
    selectAllBtn.hidden = true;
    clearAllBtn.hidden = true;
    renderResults(await ask('find', { query: findInput.value.trim() }));
    return;
  }
  sweepBtn.hidden = false;

  autoRow.hidden = view !== 'duplicates';
  if (view !== 'clutter') {
    selectAllBtn.hidden = true;
    clearAllBtn.hidden = true;
  }

  // A trail follows openers across windows, and a finished page is finished in any
  // window — a scope switch would only mislead in both views.
  scopeRow.hidden = view === 'related' || view === 'finished';
  list.hidden = view === 'related';
  relatedBox.hidden = view !== 'related';
  sweepBtn.hidden = view === 'related';

  if (view === 'duplicates') renderDuplicates(await ask('report'));
  else if (view === 'clutter') renderClutter(await ask('clutter'));
  else if (view === 'finished') renderFinished(await ask('finished'));
  else renderRelated(await ask('relatedReport', { tabId: await seedTabId() }));
}

/**
 * Which tab the Related view is about: the one you right-clicked if you came
 * from "Review related tabs…", otherwise the tab you're looking at.
 */
async function seedTabId() {
  const res = await chrome.runtime.sendMessage({ type: 'takeSeed' });
  if (res && res.tabId != null) return res.tabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active ? active.id : null;
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

  if (searching()) {
    const ids = results.flatMap((r) => r.ids);
    const res = await ask('closeIds', { ids, what: `search: ${findInput.value.trim()}` });
    closed = res && res.count ? res.count : 0;
    summary.textContent = closed ? `Closed ${plural(closed, 'tab')}.` : 'Nothing closed.';
    hint.textContent = '';
    resultsList.replaceChildren();
    sweepBtn.textContent = 'Done';
    undoBtn.hidden = closed === 0;
    undoBtn.textContent = `Undo (${closed})`;
    return;
  }

  if (view === 'finished') {
    const res = await chrome.runtime.sendMessage({ type: 'closeFinished' });
    closed = res && res.count ? res.count : 0;
  } else if (view === 'duplicates') {
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

mergeBtn.addEventListener('click', async () => {
  mergeBtn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'mergeWindows', windowId: win.id });
  const moved = res && res.merged ? res.merged : 0;
  summary.textContent = moved
    ? `Merged ${plural(moved, 'tab')} into this window.${res.skipped ? ` ${res.skipped} left grouped.` : ''}`
    : 'Nothing to merge.';
  hint.textContent = '';
  list.replaceChildren();
  resultsList.replaceChildren();
  relatedBox.replaceChildren();
  sweepBtn.hidden = true;
  mergeBtn.hidden = true;
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
