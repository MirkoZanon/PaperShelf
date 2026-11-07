'use strict';
/* ------------------------------------------------------------------ helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const truncate = (s, n) => (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || '');
const STATUS_LABEL = {to_read: 'To read', reading: 'Reading', read: 'Read'};
const TYPE_LABEL = {article: 'Journal article', preprint: 'Preprint', conference: 'Conference paper', chapter: 'Book chapter',
  book: 'Book', thesis: 'Thesis', report: 'Report', dataset: 'Dataset', webpage: 'Web page', other: 'Other'};
const firstFamily = p => (p.authors[0]?.family || '').toLowerCase();
const SORTS = {
  added_desc: ['Recently added', (a, b) => b.added_at.localeCompare(a.added_at) || b.id - a.id],
  year_desc: ['Year (newest first)', (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title)],
  year_asc: ['Year (oldest first)', (a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title)],
  author: ['First author A–Z', (a, b) => firstFamily(a).localeCompare(firstFamily(b)) || (a.year || 0) - (b.year || 0)],
  title: ['Title A–Z', (a, b) => a.title.localeCompare(b.title)],
};

const state = {
  papers: [], groups: [], settings: {}, dataDir: '',
  view: {type: 'reading'}, area: 'reading', search: '', keyword: null, sort: 'added_desc', includeSub: true,
  selected: new Set(), openId: null, collapsed: new Set(), lastIndex: null,
  mode: 'list', styles: [], platform: '', tab: 'library',
};
const finderLabel = () => state.platform === 'darwin' ? 'Show in Finder' : 'Show in folder';
const styleName = id => state.styles.find(s => s.id === id)?.name || 'APA 7th edition';

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('papershelf-prefs') || '{}');
    if (SORTS[p.sort]) state.sort = p.sort;
    if (typeof p.includeSub === 'boolean') state.includeSub = p.includeSub;
    state.collapsed = new Set(p.collapsed || []);
    if (['list', 'map', 'discover'].includes(p.mode)) state.mode = p.mode;
    if (p.tab === 'people') state.tab = 'people';
    state.navMore = !!p.navMore; state.kwOpen = p.kwOpen !== false; state.details = !!p.details; state.arrange = p.arrange || {}; state.grpMode = p.grpMode === 'combo' ? 'combo' : 'each'; state.grpClosed = new Set(p.grpClosed || []); state.grpRank = p.grpRank || {}; state.closed = new Set(p.v >= 2 ? (p.closed || []) : []); state.sidePin = p.sidePin || {};  // v2.2.1: sections open again once
  } catch (e) { /* storage unavailable */ }
}
function savePrefs() {
  try { localStorage.setItem('papershelf-prefs', JSON.stringify({sort: state.sort, includeSub: state.includeSub, collapsed: [...state.collapsed], mode: state.mode, tab: state.tab, navMore: !!state.navMore, kwOpen: state.kwOpen !== false, details: !!state.details, arrange: state.arrange || {}, grpMode: state.grpMode || 'each', grpClosed: [...(state.grpClosed || [])], grpRank: state.grpRank || {}, closed: [...(state.closed || [])], sidePin: state.sidePin || {}, v: 2})); }
  catch (e) { /* ignore */ }
}

async function api(path, opts = {}) {
  const o = {method: opts.method || 'GET', headers: {}};
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  if (opts.form) o.body = opts.form;
  let r;
  try { r = await fetch(path, o); }
  catch (e) { throw new Error('PaperShelf is not running. Start it again (start.command) and reload this page.'); }
  let data = null;
  try { data = await r.json(); } catch (e) { /* not JSON */ }
  if (!r.ok) { const err = new Error((data && data.error) || `Request failed (${r.status})`); err.data = data; throw err; }
  return data;
}

function toast(msg, kind = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span></span><button aria-label="Close">×</button>`;
  el.querySelector('span').textContent = msg;
  $('#toasts').appendChild(el);
  const stack = $$('.toast', $('#toasts'));
  if (stack.length > 3) stack.slice(0, stack.length - 3).forEach(t => t.remove());
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').onclick = close;
  if (ms) setTimeout(close, ms);
  return {close, set: m => { el.querySelector('span').textContent = m; }};
}

function modal(html, {wide = false, nofocus = false} = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
  document.body.appendChild(wrap);
  const m = {el: wrap, onclose: null, guard: null, close(force) { if (force !== true && m.guard && !m.guard()) return; wrap.remove(); if (m.onclose) { const f = m.onclose; m.onclose = null; f(); } }};
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) m.close(); });
  // delegated: works also for buttons added later (dialogs that rebuild their content, e.g. Reading stats)
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]') && wrap.isConnected) m.close(); });
  if (!nofocus) setTimeout(() => $('input:not([type=radio]):not([type=checkbox]),textarea', wrap)?.focus(), 30);
  return m;
}
function topModal() { const all = $$('.modal-wrap'); return all[all.length - 1]; }

function askText(title, {value = '', label = '', placeholder = '', ok = 'OK'} = {}) {
  return new Promise(resolve => {
    const m = modal(`<h3>${esc(title)}</h3>${label ? `<p class="muted">${esc(label)}</p>` : ''}
      <input class="input wide" id="ask-in" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ask-ok">${esc(ok)}</button></div>`);
    let result = null;
    m.onclose = () => resolve(result);
    const inp = $('#ask-in', m.el);
    const done = () => { result = inp.value.trim(); m.close(); };
    $('#ask-ok', m.el).onclick = done;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  });
}

function confirmBox(title, message, {ok = 'OK', danger = false, checkbox = '', checkbox2 = '', checked2 = false} = {}) {
  return new Promise(resolve => {
    const m = modal(`<h3>${esc(title)}</h3><p class="muted">${esc(message)}</p>
      ${checkbox ? `<label class="opt"><input type="checkbox" id="cb-extra"><span>${esc(checkbox)}</span></label>` : ''}
      ${checkbox2 ? `<label class="opt"><input type="checkbox" id="cb-extra2" ${checked2 ? 'checked' : ''}><span>${esc(checkbox2)}<small>If unticked, the paper stays shared for everybody else and won't come back to your library.</small></span></label>` : ''}
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cb-ok">${esc(ok)}</button></div>`);
    let result = false;
    m.onclose = () => resolve(result);
    $('#cb-ok', m.el).onclick = () => { result = {checked: !!$('#cb-extra', m.el)?.checked, checked2: !!$('#cb-extra2', m.el)?.checked}; m.close(); };
    setTimeout(() => $('#cb-ok', m.el).focus(), 40);
  });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.classList.add('busy'); btn.innerHTML = `<span class="spin"></span> ${esc(label || 'Working…')}`; }
  else { btn.classList.remove('busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* ------------------------------------------------------------------ data */
async function loadLibrary() {
  const d = await api('/api/library');
  state.papers = d.papers; state.groups = d.groups; state.shares = d.shares || []; state.settings = d.settings; state.dataDir = d.data_dir;
  applyLook(state.settings.look);
  state.styles = d.styles || []; state.platform = d.platform || ''; state.version = d.version || ''; state.appDir = d.app_dir || '';
  updateSyncButton();
  const ids = new Set(state.papers.map(p => p.id));
  state.selected = new Set([...state.selected].filter(i => ids.has(i)));
  if (state.view.type === 'group' && !state.groups.some(g => g.id === state.view.id)) state.view = homeView();
  if (state.view.type === 'share' && !state.shares.some(x => x.id === state.view.id)) state.view = homeView();
  if (state.openId && !ids.has(state.openId)) state.openId = null;
  renderAll();
}
function upsertPaper(p) {
  const i = state.papers.findIndex(x => x.id === p.id);
  if (i >= 0) state.papers[i] = p; else state.papers.unshift(p);
}
function paperById(id) { return state.papers.find(p => p.id === id); }

function renderAll() {
  renderSidebar(); renderList(); renderMode();
  const editing = $('#detail-body').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (state.openId && !editing) renderDetail();
}

/* ------------------------------------------------------------------ groups */
function childrenOf(pid) {
  return state.groups.filter(g => (g.parent_id ?? null) === (pid ?? null))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
function descendants(gid) {
  const out = new Set([gid]); const stack = [gid];
  while (stack.length) {
    const cur = stack.pop();
    for (const g of state.groups) if (g.parent_id === cur && !out.has(g.id)) { out.add(g.id); stack.push(g.id); }
  }
  return out;
}
function groupPath(gid) {
  const parts = []; let g = state.groups.find(x => x.id === gid); let guard = 0;
  while (g && guard++ < 50) { parts.unshift(g.name); g = state.groups.find(x => x.id === g.parent_id); }
  return parts.join(' › ');
}
function groupCount(gid) {
  const ids = state.includeSub ? descendants(gid) : new Set([gid]);
  return areaPapers().filter(p => p.group_ids.some(g => ids.has(g))).length;
}
function groupOptions(pid = null, depth = 0) {
  return childrenOf(pid).map(g => `<option value="${g.id}">${'   '.repeat(depth)}${esc(g.name)}</option>` + groupOptions(g.id, depth + 1)).join('');
}
function currentGroupId() { return state.view.type === 'group' ? state.view.id : null; }

async function createGroup(parentId = null, name = null) {
  name = name ?? await askText(parentId ? `New sub-label in “${groupPath(parentId)}”` : 'New label', {placeholder: 'e.g. Thesis – Chapter 2', ok: 'Create'});
  if (!name) return null;
  try {
    const d = await api('/api/groups', {method: 'POST', body: {name, parent_id: parentId}});
    state.groups.push(d.group);
    if (parentId) state.collapsed.delete(parentId);
    savePrefs(); renderSidebar(); renderList();
    return d.group;
  } catch (err) { toast(err.message, 'error'); return null; }
}
async function renameGroup(gid) {
  const g = state.groups.find(x => x.id === gid); if (!g) return;
  const name = await askText('Rename label', {value: g.name, ok: 'Rename'});
  if (!name || name === g.name) return;
  try { const d = await api(`/api/groups/${gid}`, {method: 'PUT', body: {name}}); Object.assign(g, d.group); renderAll(); }
  catch (err) { toast(err.message, 'error'); }
}
async function deleteGroup(gid) {
  const sub = descendants(gid).size - 1;
  const ok = await confirmBox(`Delete “${groupPath(gid)}”?`,
    `${sub ? `Its ${sub} sub-label${sub > 1 ? 's' : ''} will be deleted too. ` : ''}The papers stay in your library – only the label is removed.`,
    {ok: 'Delete label', danger: true});
  if (!ok) return;
  try {
    await api(`/api/groups/${gid}`, {method: 'DELETE'});
    if (state.view.type === 'group' && descendants(gid).has(state.view.id)) state.view = homeView();
    await loadLibrary();
  } catch (err) { toast(err.message, 'error'); }
}
async function moveGroup(gid, parentId) {
  if (gid === parentId) return;
  try { await api(`/api/groups/${gid}`, {method: 'PUT', body: {parent_id: parentId}}); await loadLibrary(); }
  catch (err) { toast(err.message, 'error'); }
}
async function assign(gid, ids, action = 'add') {
  if (!ids.length) return;
  try {
    const d = await api(`/api/groups/${gid}/papers`, {method: 'POST', body: {paper_ids: ids, action}});
    d.papers.forEach(upsertPaper); renderAll();
    toast(`${ids.length} paper${ids.length > 1 ? 's' : ''} ${action === 'remove' ? 'removed from' : 'added to'} “${groupPath(gid)}”`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}

/* ------------------------------------------------------------------ filtering */
function haystack(p) {
  return [p.title, p.authors.map(a => `${a.given} ${a.family}`).join(' '), p.journal, p.year, p.doi,
    p.keywords.join(' '), p.abstract, p.notes, p.publisher].join(' ').toLowerCase();
}
// two pages over the same library: the Reading list (to read + reading now) and the whole Library
const areaPapers = () => state.area === 'reading' ? state.papers.filter(p => p.status !== 'read') : state.papers;
function filteredPapers({ignoreKeyword = false} = {}) {
  let list = areaPapers();
  const v = state.view;
  if (v.type === 'starred') list = list.filter(p => p.starred);
  else if (v.type === 'status') list = list.filter(p => p.status === v.value);
  else if (v.type === 'unfiled') list = list.filter(p => !p.group_ids.length);
  else if (v.type === 'nopdf') list = list.filter(p => !p.pdf_exists);
  else if (v.type === 'attention') list = list.filter(Smart.attention);
  else if (v.type === 'group') {
    const ids = state.includeSub ? descendants(v.id) : new Set([v.id]);
    list = list.filter(p => p.group_ids.some(g => ids.has(g)));
  } else if (v.type === 'share') list = list.filter(p => (p.share_ids || []).includes(v.id));
  if (!ignoreKeyword && state.keyword) list = list.filter(p => p.keywords.some(k => k.toLowerCase() === state.keyword));
  const terms = state.search.toLowerCase().split(/\s+/).filter(Boolean);
  const ft = state.ftQuery === state.search ? (state.ftHits || {}) : {};
  if (terms.length) list = list.filter(p => { const h = haystack(p); return terms.every(t => h.includes(t)) || ft[p.id]; });
  return [...list].sort(SORTS[state.sort][1]);
}
function viewKey() {
  const v = state.view;
  return v.type === 'status' ? `status:${v.value}` : v.type === 'group' ? `group:${v.id}` : v.type === 'share' ? `share:${v.id}` : v.type;
}
function viewTitle() {
  const v = state.view;
  return {all: 'All papers', reading: 'Reading list', starred: 'Starred', unfiled: 'Unfiled papers', nopdf: 'Without PDF', attention: 'Needs attention'}[v.type]
    || (v.type === 'status' ? (v.value === 'reading' ? 'Reading now' : STATUS_LABEL[v.value]) : v.type === 'group' ? groupPath(v.id)
      : v.type === 'share' ? (state.shares.find(x => x.id === v.id)?.name || 'Group') : 'Papers');
}
function applyLook(look) { document.body.classList.toggle('look-metal', (look || 'metal') === 'metal'); }
const treeOrder = (pid = null) => childrenOf(pid).flatMap(g => [g, ...treeOrder(g.id)]);   // labels as in the sidebar
const isDiscover = () => state.tab === 'library' && state.area === 'library' && state.mode === 'discover';
const homeView = () => ({type: state.area === 'reading' ? 'reading' : 'all'});   // the whole list of the page
function setView(view) {
  state.view = view; state.selected.clear(); state.keyword = null; state.lastIndex = null;
  renderSidebar(); renderList(); renderMode(true);
}

/* ------------------------------------------------------------------ sidebar */
/* ------------------------------------------------------------------ label colours */
const LABEL_COLORS = {red: '#e05252', coral: '#f07560', orange: '#e8833a', amber: '#d4a017', yellow: '#e3c52c', olive: '#8f9a2e',
  lime: '#84b93a', green: '#3a9d5d', mint: '#3fbf9f', teal: '#2a9d8f', cyan: '#2b9cc4', sky: '#5aaee8',
  blue: '#3f7be0', navy: '#2c4a8a', indigo: '#5b5fd6', violet: '#7d5ce0', purple: '#9256d6', magenta: '#c04fc0',
  pink: '#d65c9a', rose: '#e0708a', brown: '#9a6b4b', sand: '#c2a27a', grey: '#8a8f98', slate: '#4e5a6a'};
const lcol = c => LABEL_COLORS[c] || '';
// the same symbol for every label: grey when it has no colour, in its colour otherwise
const LABEL_SVG = {
  tag: '<path d="M2.2 2.2h5.4l6.2 6.2-5.4 5.4-6.2-6.2z" class="li-fill"/><circle cx="5.2" cy="5.2" r="1.1" class="li-dot"/>',
  link: '<path d="M6.6 9.4l2.8-2.8" class="li-line"/><path d="M7.4 4.6l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3M8.6 11.4l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3" class="li-line"/>',
  inbox: '<path d="M2.5 9.5l1.6-6h7.8l1.6 6v3.5h-11z" class="li-fill"/><path d="M2.5 9.5h3.3l.8 1.5h2.8l.8-1.5h3.3M8 4.5v3.6M6.5 6.7L8 8.2l1.5-1.5" class="li-line"/>',
  // a group: papers shared with other people
  group: '<circle cx="5.6" cy="5.4" r="2.2" class="li-fill"/><path d="M1.6 13.2c.3-2.4 1.9-3.8 4-3.8s3.7 1.4 4 3.8z" class="li-fill"/><circle cx="11" cy="6" r="1.8" class="li-line"/><path d="M10.6 9.6c1.9 0 3.4 1.2 3.8 3.6h-2.6" class="li-line"/>',
};
const labelIcon = (c, kind = 'tag') => `<span class="licon ${c && lcol(c) ? 'colored' : ''}"${c && lcol(c) ? ` style="--lc:${lcol(c)}"` : ''}><svg viewBox="0 0 16 16" aria-hidden="true">${LABEL_SVG[kind] || LABEL_SVG.tag}</svg></span>`;
const chipStyle = c => c && lcol(c) ? ` style="--lc:${lcol(c)}"` : '';
function pickColor(anchor, current, onPick) {
  document.querySelector('.color-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'color-pop';
  pop.innerHTML = `<div class="cp-title">Label colour</div><div class="cp-grid">${Object.entries(LABEL_COLORS).map(([k, v]) =>
    `<button data-c="${k}" title="${k}" class="${k === current ? 'on' : ''}" style="background:${v}"></button>`).join('')}</div>
    <button class="cp-none ${current ? '' : 'on'}" data-c="">No colour (grey)</button>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); };
  const out = e => { if (!pop.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', out, true), 0);
  pop.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; close(); onPick(b.dataset.c); });
}
async function setGroupColor(gid, color) {
  try { const d = await api(`/api/groups/${gid}`, {method: 'PUT', body: {color}}); const g = state.groups.find(x => x.id === gid); if (g) g.color = d.group.color; renderAll(); }
  catch (err) { toast(err.message, 'error'); }
}

function renderSidebar() {
  const P = state.papers, R = areaPapers(), reading = state.area === 'reading';
  // the reading list's sidebar has only labels and keywords: what you are reading is already on top of the list
  const main = reading ? [] : [
    ['all', 'All papers', '📚', P.length],
  ];
  const nAtt = reading ? 0 : R.filter(Smart.attention).length;   // retracted / corrected papers, preprints now published
  if (!reading && (nAtt || state.view.type === 'attention')) main.push(['attention', 'Needs attention', '⚠', nAtt]);
  const more = reading ? [] : [
    ['status:read', 'Read', '●', P.filter(p => p.status === 'read').length],
    ['starred', 'Starred', '★', P.filter(p => p.starred).length],
    ['status:to_read', 'To read', '○', P.filter(p => p.status === 'to_read').length],
    ['status:reading', 'Reading now', '◐', P.filter(p => p.status === 'reading').length],
    ['unfiled', 'Without labels', '▫︎', P.filter(p => !p.group_ids.length).length],
    ['nopdf', 'Without PDF', '⌀', P.filter(p => !p.pdf_exists).length],
  ];
  $('#nav-head').textContent = reading ? '' : 'Library';
  $('#nav').hidden = reading;
  const key = viewKey();
  const open = state.navMore || more.some(([k]) => k === key);
  const item = ([k, label, ico, n]) => `<div class="nav-item ${key === k ? 'active' : ''}" data-view="${k}"><span class="ico">${ico}</span><span class="label">${label}</span><span class="count">${n}</span></div>`;
  $('#nav').innerHTML = main.map(item).join('')
    + (more.length ? `<div class="nav-item nav-more" data-navmore><span class="ico">${open ? '▾' : '▸'}</span><span class="label">${open ? 'Less' : 'More'}</span>${open ? '' : '<span class="count">read, starred…</span>'}</div>`
    + (open ? `<div class="nav-sub">${more.map(item).join('')}</div>` : '') : '');
  const tn = $('#tab-reading-n'); if (tn) tn.textContent = P.filter(p => p.status !== 'read').length || '';
  // collapsible sections: Labels, and inside it Personal and Shared
  const C = state.closed || (state.closed = new Set());
    const nShared = (state.shares || []).length;
  // two separate sections: Labels (your own topics) and Groups (shared with other people)
  const secHead = (k, label, n, tip) => `<span class="sec-car">${C.has(k) ? '▸' : '▾'}</span> ${label}${C.has(k) && n ? ` <span class="sec-n">${n}</span>` : ''}`;
  const lh = $('#labels-head .sec-toggle'); lh.innerHTML = secHead('labels', 'Labels', state.groups.length); lh.title = 'Your own labels – topics, projects… Click to show / hide';
  const sh = $('#shares-head .sec-toggle'); sh.innerHTML = secHead('shared', 'Groups', nShared); sh.title = 'Groups: papers and notes you share with other people. Click to show / hide';
  $('#labels-body').hidden = C.has('labels'); $('#groups-body').hidden = C.has('shared');
  $('#tree').innerHTML = C.has('labels') ? '' : state.groups.length ? renderTree(null, 0)
    : `<div class="empty-hint">No labels yet. Click ＋ to create one, then drag papers onto it. A paper can have many labels; hover a label to add sub-labels.</div>`;
  if (typeof Shares !== 'undefined' && !C.has('shared')) Shares.renderSidebar();
  renderKeywords();
}
function renderTree(pid, depth) {
  return childrenOf(pid).map(g => {
    const kids = childrenOf(g.id); const collapsed = state.collapsed.has(g.id);
    const active = state.view.type === 'group' && state.view.id === g.id;
    return `<div class="nav-item group-item ${active ? 'active' : ''}" data-group="${g.id}" draggable="true" style="padding-left:${8 + depth * 16}px">
        <span class="caret ${kids.length ? '' : 'invisible'}" data-toggle="${g.id}">${collapsed ? '▸' : '▾'}</span>
        <span class="ico">${labelIcon(g.color, 'tag')}</span>
        <span class="label" title="${esc(groupPath(g.id))}">${esc(g.name)}</span>
        <span class="count">${groupCount(g.id)}</span>
        <span class="g-actions"><button title="Colour" data-gact="color" data-id="${g.id}">🎨</button><button title="Add sub-label" data-gact="sub" data-id="${g.id}">＋</button><button title="Rename" data-gact="rename" data-id="${g.id}">✎</button><button title="Delete label" data-gact="delete" data-id="${g.id}">🗑</button></span>
      </div>${kids.length && !collapsed ? renderTree(g.id, depth + 1) : ''}`;
  }).join('');
}
const KW_SHOW = 15;
function renderKeywords() {
  const counts = new Map();
  for (const p of filteredPapers({ignoreKeyword: true}))
    for (const k of p.keywords) {
      const key = k.toLowerCase();
      if (!counts.has(key)) counts.set(key, {label: k, n: 0});
      counts.get(key).n++;
    }
  const all = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  const head = $('#kw-head');
  if (head) head.innerHTML = `<span class="sec-toggle" data-kwtoggle><span class="sec-car">${state.kwOpen !== false ? '▾' : '▸'}</span> Keywords${all.length ? ` <span class="sec-n">${all.length}</span>` : ''}</span><button id="kw-manage" title="Rename, merge or delete keywords">✎</button>`;
  const box = $('#kwcloud');
  if (state.kwOpen === false) { box.innerHTML = ''; return; }
  if (!all.length) { box.innerHTML = '<div class="empty-hint">Keywords of the papers in this view appear here – click one to filter.</div>'; return; }
  const q = (state.kwFilter || '').toLowerCase();
  let shown = q ? all.filter(([k]) => k.includes(q)) : all;
  const total = shown.length;
  if (!state.kwAll) shown = shown.slice(0, KW_SHOW);
  else shown = shown.slice(0, 300);
  const active = state.keyword && !shown.some(([k]) => k === state.keyword) ? all.filter(([k]) => k === state.keyword) : [];
  const max = all[0][1].n;
  box.innerHTML = (all.length > KW_SHOW ? `<input class="kw-filter" id="kw-filter" type="search" placeholder="Filter ${all.length} keywords…" value="${esc(state.kwFilter || '')}">` : '')
    + [...active, ...shown].map(([key, {label, n}]) => `<button class="kw ${state.keyword === key ? 'active' : ''} ${n / max > .5 ? 'big' : ''}" data-kw="${esc(key)}">${esc(label)}<span>${n}</span></button>`).join('')
    + (total > KW_SHOW ? `<button class="linklike kw-more" data-kwall>${state.kwAll ? 'Show fewer' : `Show all ${total}`}</button>` : '')
    + (q && !total ? '<div class="empty-hint">No keyword matches.</div>' : '');
}

/* ------------------------------------------------------------------ list */
function shortAuthors(p) {
  const a = p.authors.filter(x => x.family);
  if (!a.length) return '';
  if (a.length === 1) return a[0].family;
  if (a.length === 2) return `${a[0].family} & ${a[1].family}`;
  return `${a[0].family} et al.`;
}
function pdfButton(p) {
  if (p.pdf_exists) return `<span class="pdf-wrap"><button class="pdf-btn has" data-pdfq title="Open the PDF">📄 PDF</button><button class="pdf-del" data-pdfdel title="Delete this PDF (moved to the Trash) – the paper, its notes and highlights stay">✕</button></span>`;
  if (!(p.doi || p.url || p.arxiv_id)) return '';
  return `<button class="pdf-btn get" data-pdfq title="Get the PDF: looks for a free copy and opens it; if there is none, opens the article page (log in with your university there – the downloaded PDF is attached automatically)">⬇ PDF</button>`;
}
async function quickPdf(id, btn) {
  const p = paperById(id); if (!p) return;
  const startReading = () => { if (p.status === 'to_read' && state.area === 'reading') savePaper(id, {status: 'reading'}, {rerender: false}); };
  if (p.pdf_exists) { startReading(); Reader.open(id); return; }
  setBusy(btn, true, 'PDF');
  const t = toast('Looking for a free PDF…', 'info', 0);
  try {
    const d = await api(`/api/papers/${id}/pdf`, {method: 'POST'});
    upsertPaper(d.paper); t.close(); renderAll();
    toast(`PDF found via ${d.pdf.source} and saved.`, 'ok');
    startReading(); Reader.open(id);
  } catch (err) {
    t.close(); setBusy(btn, false);
    if (err.data?.paper) { upsertPaper(err.data.paper); renderAll(); }
    if (p.doi || p.url) openForLogin(id); else showPdfFail(id, err);
  }
}
let rowHide = null, rowHideS = null;  // while drawing a label's section, the chips of that section's labels are left out of its rows
function rowHtml(p) {
  const sel = state.selected.has(p.id);
  const chips = !state.details ? '' : p.keywords.slice(0, 5).map(k => `<span class="chip" data-kw="${esc(k.toLowerCase())}">${esc(k)}</span>`).join('');
  const meta = [shortAuthors(p), p.journal, p.year].filter(Boolean).map(esc).join(' · ');
  const groups = p.group_ids.filter(g => !(state.view.type === 'group' && g === state.view.id) && !(rowHide && [...rowHide].some(h => descendants(g).has(h))))
    .map(g => { const G = state.groups.find(x => x.id === g); return `<span class="gchip ${G?.color ? 'colored' : ''}"${chipStyle(G?.color)} data-goto="${g}" title="${esc(groupPath(g))}">${labelIcon(G?.color, 'tag')}${esc(G?.name || '')}</span>`; }).join('')
    + (p.share_ids || []).filter(sid => !(state.view.type === 'share' && sid === state.view.id) && !(rowHideS && rowHideS.has(sid)))
      .map(sid => { const sh = (state.shares || []).find(x => x.id === sid); return sh ? `<span class="schip ${sh.color ? 'colored' : ''}"${chipStyle(sh.color)} data-goto-share="${esc(sid)}" title="Group: ${esc(sh.name)}${sh.role === 'member' ? '' : ' (you read it)'}">${labelIcon(sh.color, 'group')}${esc(sh.name)}</span>` : ''; }).join('');
  // papers being read are marked in the app's green – or in the colour of their label
  const rc = p.status === 'reading' && !rowHide && !rowHideS ? p.group_ids.map(g => lcol(state.groups.find(x => x.id === g)?.color)).find(Boolean) : '';
  return `<div class="row ${sel ? 'selected' : ''} ${state.openId === p.id ? 'open' : ''} ${p.status === 'reading' ? 'is-reading' : ''}" data-id="${p.id}" draggable="true"${rc ? ` style="--rc:${rc}"` : ''}>
    <input type="checkbox" class="sel" ${sel ? 'checked' : ''} aria-label="Select">
    <button class="star ${p.starred ? 'on' : ''}" title="${p.starred ? 'Unstar' : 'Star'}">${p.starred ? '★' : '☆'}</button>
    <div><div class="row-title">${esc(p.title || 'Untitled')}${Smart.badges(p)}</div>${meta ? `<div class="row-meta">${meta}</div>` : ''}${Smart.progress(p)}${ftSnippet(p)}${chips || groups ? `<div class="row-chips">${groups}${chips}</div>` : ''}</div>
    <div class="row-side">${state.area === 'reading' ? '' : `<span class="pill s-${p.status}">${STATUS_LABEL[p.status] || ''}</span>`}<div class="row-acts">${state.area === 'reading' ? `<button class="done-btn" data-done title="Mark as read – it leaves the reading list (it stays in the Library)">✓ Read</button>` : ''}${p.annotation_count ? `<span class="hl-badge" title="${p.annotation_count} highlight(s)">🖍 ${p.annotation_count}</span>` : ''}${Notes.badge(p)}${pdfButton(p)}</div></div>
  </div>`;
}
function emptyHtml() {
  if (state.area === 'reading' && state.papers.length && !state.search && !state.keyword) return `<div class="empty"><div class="big">📖</div><h2>Nothing to read here</h2>
    <div>Papers you add are <b>To read</b> and appear here; when you mark them <b>Read</b> they stay in the <button class="linklike" data-goto-library>Library</button>.</div></div>`;
  if (!state.papers.length) return `<div class="empty"><div class="big">📄</div><h2>Your shelf is empty</h2>
    <div>Paste something in the <button class="linklike" data-focus-add>＋ Add a paper</button> box (next to Reading list, top left) and press Enter. It understands:</div>
    <ul><li>DOIs – <code>10.1038/s41586-020-2649-2</code></li><li>arXiv links or IDs – <code>2106.09685</code></li>
    <li>publisher, PubMed or Google Scholar result links</li><li>a paper title, or a whole reference you copied</li></ul>
    <div style="margin-top:14px">You can also drop PDF files onto this window, or add the browser button from ⚙︎ Settings.</div>
    <div style="margin-top:18px"><button class="btn" data-help="start">📘 New here? Read the quick guide</button></div></div>`;
  return `<div class="empty"><div class="big">🔍</div><h2>Nothing here</h2><div>No papers match this view${state.search || state.keyword ? ' and filter' : ''}.</div></div>`;
}
function renderList() {
  const list = filteredPapers();
  state.visible = list.map(p => p.id);
  $('#view-title').innerHTML = esc(viewTitle()) + (['group', 'share', 'attention'].includes(state.view.type) || state.view.type !== homeView().type && state.area === 'reading'
    ? ` <button class="view-clear" data-view-clear title="Show the whole ${state.area === 'reading' ? 'reading list' : 'library'}">×</button>` : '');
  const total = filteredPapers({ignoreKeyword: true}).length;
  $('#view-sub').textContent = state.view.type === 'group' && state.includeSub && childrenOf(state.view.id).length
    ? 'Showing papers with this label and its sub-labels' : '';
  if (state.view.type === 'share' && typeof Shares !== 'undefined') $('#view-sub').innerHTML = Shares.viewSub(state.view.id);
  else if (state.area === 'reading') $('#view-sub').innerHTML = `${['group', 'share'].includes(state.view.type) ? 'In your reading list · ' : ''}Papers to read and being read – <button class="linklike" data-goto-library>the whole library</button>`;
  const chips = [];
  if (state.keyword) {
    const label = list[0]?.keywords.find(k => k.toLowerCase() === state.keyword) || state.keyword;
    chips.push(`<span class="fchip">Keyword: ${esc(label)} <button data-clear="kw" title="Clear">×</button></span>
      <button class="btn small" id="kw-to-group" title="Create a label for these papers">Make label from keyword</button>`);
  }
  if (state.search) {
    const fs = state.ftStatus, nft = Object.keys(state.ftQuery === state.search ? state.ftHits || {} : {}).length;
    chips.push(`<span class="fchip">Search: ${esc(state.search)} <button data-clear="search" title="Clear">×</button></span>`
      + (state.area === 'reading' ? `<button class="linklike small" data-goto-library title="Search all your papers, read ones included">search the whole library</button>` : '')
      + (fs && fs.with_pdf ? `<span class="muted small" title="The text of your PDFs is searched too (indexed on this computer)">📄 ${nft ? `${nft} found inside PDFs · ` : ''}searching the text of ${fs.indexed} of ${fs.with_pdf} PDFs${fs.indexed < fs.with_pdf - fs.unreadable ? ' (indexing…)' : ''}</span>` : ''));
  }
  $('#filters').innerHTML = chips.join('');

  const n = state.selected.size;
  $('#count-label').textContent = n ? `${n} selected` : `${list.length} paper${list.length === 1 ? '' : 's'}${list.length !== total ? ` (of ${total})` : ''}`;
  const all = $('#select-all');
  all.checked = list.length > 0 && list.every(p => state.selected.has(p.id));
  all.indeterminate = n > 0 && !all.checked;
  $('#bulk').classList.toggle('show', n > 0);
  $('#bulk-remove').style.display = state.view.type === 'group' || state.view.type === 'share' ? '' : 'none';
  $('#bulk-remove').textContent = 'Remove this label';
  $('#bulk-delpdf').style.display = [...state.selected].some(id => paperById(id)?.pdf_exists) ? '' : 'none';
  if (typeof Shares !== 'undefined') $('#bulk-share').innerHTML = Shares.bulkOptions();
  $('#bulk-group').innerHTML = `<option value="">Add label…</option>${groupOptions()}<option value="__new">＋ New label…</option>`;
  $('#incl-sub-wrap').style.display = state.view.type === 'group' && childrenOf(state.view.id).length ? '' : 'none';
  $('#incl-sub').checked = state.includeSub;
  const L = $('#list');
  L.classList.toggle('with-checks', state.settings.list_checkboxes === '1' || n > 0);  // boxes appear while you select
  $('#list-toolbar').classList.toggle('has-sel', state.settings.list_checkboxes === '1' || n > 0);
  $('#list-toolbar').classList.toggle('selecting', n > 0);
  L.classList.toggle('details', !!state.details);
  $('#details-toggle').checked = !!state.details;
  const grouped = (state.arrange || {})[state.area] === 'groups';
  $('#arr-sel').value = grouped ? (state.grpMode || 'each') : 'list';
  if (isDiscover()) {   // Discover is its own page: suggestions for the whole library, or for the label chosen on the left
    const g = state.view.type === 'group';
    $('#view-title').innerHTML = `Discover${g ? ` <span class="vt-scope">· ${esc(groupPath(state.view.id))}</span> <button class="view-clear" data-view-clear title="Suggestions for the whole library">×</button>` : ''}`;
    $('#view-sub').innerHTML = g ? 'Papers related to this label that you don\'t have yet' : 'Papers related to your library that you don\'t have yet – choose a label on the left to focus on one topic';
  }
  if (state.view.type === 'attention' && list.length) $('#view-sub').innerHTML = 'Retracted or corrected papers, and preprints now published in a journal – open a paper to see the details';
  Smart.gapsHint();
  const stale = state.area === 'reading' && ['reading', 'status'].includes(state.view.type) ? Smart.staleBanner() : '';
  if (grouped && list.length) { L.innerHTML = stale + groupedHtml(list); return; }
  if (state.area === 'reading' && list.length) {
    const now = list.filter(p => p.status === 'reading'), next = list.filter(p => p.status !== 'reading');
    state.visible = now.concat(next).map(p => p.id);
    const head = (t, n, tip) => `<div class="list-sec" title="${tip}">${t} <span>${n}</span></div>`;
    L.innerHTML = stale + (now.length ? head('📖 Reading now', now.length, 'Papers you are reading – open a PDF from the list and it moves here') + now.map(rowHtml).join('') : '')
      + (next.length ? (now.length ? head('To read', next.length, 'Papers waiting to be read') : '') + next.map(rowHtml).join('') : '');
  } else L.innerHTML = list.length ? list.map(rowHtml).join('') : emptyHtml();
}

/* ------------------------------------------------------------------ grouped by label */
// Papers grouped by their labels. A paper with several labels either appears under each of them
// (its other labels show as chips) or, with "combinations", once, under the exact set of its labels.
// Inside a label, the groups are its sub-labels. Reading-now papers come first in every group.
function groupedHtml(list) {
  const readingFirst = arr => state.area === 'reading' ? arr.filter(p => p.status === 'reading').concat(arr.filter(p => p.status !== 'reading')) : arr;
  const order = [], seen = new Set();
  const push = arr => arr.forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); order.push(p.id); } });
  const C = state.grpClosed || (state.grpClosed = new Set());
  const NOCOL = 'var(--faint)';
  const gcol = g => {  // a sub-label without its own colour takes its parent's
    let x = state.groups.find(y => y.id === g), guard = 0;
    while (x && guard++ < 20) { if (lcol(x.color)) return lcol(x.color); x = state.groups.find(y => y.id === x.parent_id); }
    return NOCOL;
  };
  const scol = sid => lcol((state.shares || []).find(x => x.id === sid)?.color) || NOCOL;
  const stripe = cols => cols.length <= 1 ? (cols[0] || NOCOL) : `linear-gradient(to bottom, ${cols.map((c, i) => `${c} ${i * 100 / cols.length}% ${(i + 1) * 100 / cols.length}%`).join(', ')})`;
  const nRead = arr => arr.filter(p => p.status === 'reading').length;
  const section = (key, title, icon, arr, {depth = 0, sub = '', inner = '', count = null, cols = [], rd = 0} = {}) => {
    if (!arr.length && !inner) return '';
    const closed = C.has(key), n = count ?? arr.length;
    const body = closed ? '' : (arr.length ? `<div class="grp-rows">${readingFirst(arr).map(p => rowHtml(p)).join('')}</div>` : '') + inner;
    return `<div class="grp ${closed ? 'closed' : ''} ${depth ? 'nested' : ''}" style="--gc:${cols[0] || NOCOL};--stripe:${stripe(cols)};--rc:${cols[0] && cols[0] !== NOCOL ? cols[0] : 'var(--accent)'}"><div class="grp-head" data-grp="${esc(key)}" draggable="true" title="Click to fold · drag to move this group"><span class="grp-car">${closed ? '▸' : '▾'}</span>${icon}<span class="grp-name">${title}</span><span class="grp-n">${n}</span>${rd ? `<span class="grp-rd" title="Papers you are reading in this group">📖 ${rd} reading</span>` : ''}${sub ? `<span class="grp-sub">${sub}</span>` : ''}</div>${body}</div>`;
  };
  // your own order (dragging a group's title) first, then the natural one
  const R = state.grpRank || (state.grpRank = {});
  const def = it => 1e6 + (it.rd ? 0 : 1e5) + it.i;  // groups with papers you are reading come first
  const ranked = items => items.map((it, i) => ({...it, i})).sort((a, b) => (R[a.key] ?? def(a)) - (R[b.key] ?? def(b))).map(it => it.html).join('');
  const scope = state.view.type === 'group' ? state.view.id : null;  // inside a label: its sub-labels
  // shared labels are groups too, except when you are already looking at one label
  const withShares = !['group', 'share'].includes(state.view.type) && (state.shares || []).length;
  const shareName = sid => (state.shares || []).find(x => x.id === sid)?.name || 'Group';
  const shareIcon = sid => { const x = (state.shares || []).find(y => y.id === sid); return labelIcon(x?.color, x?.role === 'member' ? 'link' : 'inbox'); };
  const shareIds = p => withShares ? (p.share_ids || []).filter(sid => (state.shares || []).some(x => x.id === sid)) : [];
  let html = '';
  if (state.grpMode === 'combo') {
    // each paper once, under the exact combination of its labels (personal + shared)
    const allowed = scope ? descendants(scope) : null;
    const buckets = new Map();
    for (const p of list) {
      const gs = p.group_ids.filter(g => (!allowed || allowed.has(g)) && g !== scope).sort((a, b) => groupPath(a).localeCompare(groupPath(b)));
      const ss = shareIds(p).sort((a, b) => shareName(a).localeCompare(shareName(b)));
      const k = gs.join(',') + '|' + ss.join(',');
      if (!buckets.has(k)) buckets.set(k, {gs, ss, papers: []});
      buckets.get(k).papers.push(p);
    }
    const keys = [...buckets.keys()].sort((a, b) => (a === '|') - (b === '|') || buckets.get(b).papers.length - buckets.get(a).papers.length);
    const items = [];
    for (const k of keys) {
      const {gs, ss, papers} = buckets.get(k); push(papers);
      // a label and its own sub-label read as one: "Thesis › Methods"
      const shown = gs.filter(g => !gs.some(o => o !== g && descendants(g).has(o)));
      const parts = shown.map(g => `<span class="grp-part">${labelIcon(state.groups.find(x => x.id === g)?.color, 'tag')}${esc(groupPath(g))}</span>`)
        .concat(ss.map(sid => `<span class="grp-part">${shareIcon(sid)}${esc(shareName(sid))}</span>`));
      const title = parts.length ? parts.join('<span class="grp-plus">+</span>') : esc(scope ? `Only “${state.groups.find(x => x.id === scope)?.name || ''}”` : 'Without labels');
      rowHide = new Set(gs); rowHideS = new Set(ss);
      const key = 'c:' + (scope || '') + ':' + k;
      const rd = nRead(papers);
      items.push({key, rd, html: section(key, title, '', papers, {cols: shown.map(gcol).concat(ss.map(scol)), rd})});
    }
    html = ranked(items);
  } else {
    const drawItems = (pid, depth) => childrenOf(pid).map(g => {
      const ids = descendants(g.id);
      const all = list.filter(p => p.group_ids.some(x => ids.has(x)));
      if (!all.length) return null;
      const kids = childrenOf(g.id);
      const direct = kids.length ? all.filter(p => !p.group_ids.some(x => x !== g.id && ids.has(x))) : all;
      rowHide = new Set([g.id]); rowHideS = null; push(direct);
      const inner = kids.length ? ranked(drawItems(g.id, depth + 1)) : '';
      rowHide = new Set([g.id]); rowHideS = null;
      const multi = all.filter(p => p.group_ids.some(x => !ids.has(x)) || shareIds(p).length).length;
      const rd = nRead(all);
      return {key: 'g:' + g.id, rd, html: section('g:' + g.id, esc(g.name), labelIcon(g.color, 'tag'), direct, {depth, inner, count: all.length, cols: [gcol(g.id)], rd,
        sub: [kids.length ? 'with its sub-labels' : '', multi ? `${multi} also in other labels` : ''].filter(Boolean).join(' · ')})};
    }).filter(Boolean);
    const items = drawItems(scope, 0);
    if (withShares) for (const x of [...state.shares].sort((a, b) => a.name.localeCompare(b.name))) {
      const arr = list.filter(p => (p.share_ids || []).includes(x.id)); if (!arr.length) continue;
      rowHide = null; rowHideS = new Set([x.id]); push(arr);
      const multi = arr.filter(p => p.group_ids.length || shareIds(p).length > 1).length;
      items.push({key: 's:' + x.id, rd: nRead(arr), html: section('s:' + x.id, esc(x.name), shareIcon(x.id), arr, {cols: [scol(x.id)], rd: nRead(arr), sub: ['group', multi ? `${multi} also in other labels` : ''].filter(Boolean).join(' · ')})});
    }
    const scopeIds = scope ? descendants(scope) : null;
    const none = list.filter(p => scope ? !p.group_ids.some(x => x !== scope && scopeIds.has(x)) : !p.group_ids.length && !shareIds(p).length);
    rowHide = scope ? new Set([scope]) : null; rowHideS = null; push(none);
    const nk = 'g:none:' + (scope || '');
    const nh = section(nk, esc(scope ? `Only “${state.groups.find(x => x.id === scope)?.name || ''}”` : 'Without labels'), '', none, {rd: nRead(none)});
    if (nh) items.push({key: nk, rd: nRead(none), html: nh});
    html = ranked(items);
  }
  rowHide = null; rowHideS = null;
  state.visible = order;
  return `<div class="grp-bar muted small">${list.length} paper${list.length === 1 ? '' : 's'} in ${state.grpMode === 'combo' ? 'groups of labels – each paper once' : 'labels – a paper with several labels appears in each'} · <button class="linklike" data-grp-all="close">fold all</button> · <button class="linklike" data-grp-all="open">unfold all</button> · drag a group's title to move it${Object.keys(state.grpRank || {}).length ? ' · <button class="linklike" data-grp-reset>reset order</button>' : ''}</div>` + html;
}

/* ------------------------------------------------------------------ detail */
function parseAuthors(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    if (line.includes(',')) { const i = line.indexOf(','); return {family: line.slice(0, i).trim(), given: line.slice(i + 1).trim()}; }
    const parts = line.split(/\s+/);
    return parts.length === 1 ? {family: parts[0], given: ''} : {family: parts.pop(), given: parts.join(' ')};
  });
}
function groupChecks(p, pid = null, depth = 0) {
  return childrenOf(pid).map(g => `<label style="padding-left:${depth * 18}px"><input type="checkbox" data-gcheck="${g.id}" ${p.group_ids.includes(g.id) ? 'checked' : ''}> ${labelIcon(g.color, 'tag')} ${esc(g.name)}</label>` + groupChecks(p, g.id, depth + 1)).join('');
}
function linkFor(p) { return p.doi ? `https://doi.org/${p.doi}` : p.url; }

function openDetail(id) {
  if (!paperById(id)) return;
  state.openId = id;
  renderDetail();
  $('#detail').classList.add('open'); document.body.classList.add('detail-open');
  $$('.row').forEach(r => r.classList.toggle('open', +r.dataset.id === id));
}
function closeDetail() {
  state.openId = null;
  $('#detail').classList.remove('open'); document.body.classList.remove('detail-open');
  $$('.row.open').forEach(r => r.classList.remove('open'));
}
function renderDetail() {
  const p = paperById(state.openId);
  if (!p) { closeDetail(); return; }
  const link = linkFor(p);
  const authorsText = p.authors.map(a => a.given ? `${a.family}, ${a.given}` : a.family).join('\n');
  $('#detail-body').innerHTML = detailHead(p) + detailRest(p, link, authorsText);
  $('#d-edit').addEventListener('toggle', e => { state.editOpen = e.target.open; });
  loadCitation(p.id);
  Smart.labelSuggestions(p);
}
function detailHead(p) {
  const meta = [p.journal, p.year, TYPE_LABEL[p.type] && p.type !== 'article' ? TYPE_LABEL[p.type] : ''].filter(Boolean).map(esc).join(' · ');
  const authorsLine = p.authors.length ? esc(p.authors.slice(0, 6).map(a => `${a.given ? a.given.split(/[\s.-]+/).filter(Boolean).map(x => x[0] + '.').join(' ') + ' ' : ''}${a.family}`).join(', ')) + (p.authors.length > 6 ? ` <span class="muted">+${p.authors.length - 6} more</span>` : '') : '<span class="muted">No authors</span>';
  return `
    <div class="d-head">
      <h2 class="d-title">${esc(p.title || 'Untitled')}</h2>
      <div class="d-authors">${authorsLine}</div>
      ${meta ? `<div class="d-meta">${meta}${p.doi ? ` · <a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a>` : ''}</div>` : ''}
    </div>`;
}
function detailRest(p, link, authorsText) {
  return `${Smart.detailBanners(p)}
    <div class="d-actions">
      ${p.pdf_exists
        ? `<button class="btn primary" data-act="read">📖 Read &amp; highlight</button><button class="btn" data-act="openapp" title="Open in Preview / your default PDF app">Open in app</button><button class="btn" data-act="reveal">${finderLabel()}</button>`
        : `<button class="btn primary" data-act="findpdf">⬇ Find &amp; download PDF</button>`}
      <button class="btn" data-act="attach">📎 ${p.pdf_exists ? 'Replace' : 'Attach'} PDF…</button>
      ${p.pdf_exists ? '<button class="btn danger-soft" data-act="delpdf" title="Move the PDF file to the Trash – the paper, its notes and highlights stay">🗑 Delete PDF</button>' : ''}
      ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">🔗 Article page</a>` : ''}
      <button class="btn" data-act="copy">❝ Copy citation</button>
    </div>
    ${!p.pdf_exists && (p.doi || p.url) ? `<div class="lib-btns"><button class="btn small" data-act="institution" title="Opens the article on the publisher's site: use its “Access through your institution” / “Log in via your university” option, then download the PDF – it is attached automatically">🔐 Open article &amp; log in with my university</button>${(state.settings.proxies || []).map(x => `<button class="btn small" data-act="viaproxy" data-proxy="${esc(x.id)}" title="Open the article through ${esc(x.name)}, then download the PDF: it is attached automatically">🏛 Via ${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="d-status-row"><div class="seg">${Object.keys(STATUS_LABEL).map(s => `<button data-status="${s}" class="${p.status === s ? 'on' : ''}">${STATUS_LABEL[s]}</button>`).join('')}</div>
      <button class="btn star-btn ${p.starred ? 'on' : ''}" data-act="star" title="${p.starred ? 'Starred – click to unstar' : 'Star this paper'}">${p.starred ? '★ Starred' : '☆ Star'}</button></div>
    ${Notes.detailField(p)}
    <div class="fld"><span>Labels</span><div class="group-checks">${state.groups.length ? groupChecks(p) : '<span class="muted">No labels yet – create one with ＋ next to Labels in the sidebar.</span>'}</div><div class="lsugg" id="lsugg"></div></div>
    ${typeof Shares !== 'undefined' ? Shares.detailField(p) : ''}
    ${p.annotation_count ? `<div class="fld"><span>Highlights</span><div class="hl-summary">🖍 ${p.annotation_count} highlight${p.annotation_count > 1 ? 's' : ''} in the PDF · <button class="linklike" data-act="read">open reader</button> · <button class="linklike" data-act="hl-notes">copy them into a note</button></div></div>` : ''}
    <details class="fld d-sec" ${p.abstract ? 'open' : ''}><summary>Abstract</summary><textarea data-f="abstract" rows="9" placeholder="No abstract">${esc(p.abstract)}</textarea></details>
    <div class="fld"><span>Keywords</span><div class="kw-edit">${p.keywords.map((k, i) => `<span class="chip">${esc(k)}<button data-kwdel="${i}" title="Remove">×</button></span>`).join('')}<input id="kw-input" placeholder="Add keyword + Enter"></div></div>
    <div class="fld"><span class="fld-row">Reference <select id="cite-style" title="Citation style (also used for exports)">${state.styles.map(s => `<option value="${s.id}" ${s.id === state.settings.default_style ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></span><div class="cite-box" id="cite-box"><span class="muted">…</span></div></div>
    ${citationSection(p)}
    <details class="fld d-sec" id="d-edit" ${state.editOpen ? 'open' : ''}><summary>✎ Edit details <span class="muted small">title, authors, journal, DOI…</span></summary>
    <label class="fld"><span>Title</span><textarea data-f="title" rows="2">${esc(p.title)}</textarea></label>
    <label class="fld"><span>Authors <em>– one per line, “Family, Given”</em></span><textarea data-f="authors" rows="${Math.min(8, Math.max(2, p.authors.length))}">${esc(authorsText)}</textarea></label>
    <div class="grid3">
      <label class="fld"><span>Year</span><input data-f="year" inputmode="numeric" value="${esc(p.year ?? '')}"></label>
      <label class="fld span2"><span>Type</span><select data-f="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <div class="grid3">
      <label class="fld span2"><span>Journal / book / source</span><input data-f="journal" value="${esc(p.journal)}"></label>
      <label class="fld"><span>Abbreviation</span><input data-f="journal_abbr" value="${esc(p.journal_abbr || '')}" placeholder="e.g. J. Neurosci."></label>
    </div>
    <div class="grid3">
      <label class="fld"><span>Volume</span><input data-f="volume" value="${esc(p.volume)}"></label>
      <label class="fld"><span>Issue</span><input data-f="issue" value="${esc(p.issue)}"></label>
      <label class="fld"><span>Pages</span><input data-f="pages" value="${esc(p.pages)}"></label>
    </div>
    <label class="fld"><span>Publisher</span><input data-f="publisher" value="${esc(p.publisher)}"></label>
    <label class="fld"><span>DOI</span><input data-f="doi" value="${esc(p.doi)}" placeholder="10.xxxx/…"></label>
    <label class="fld"><span>URL</span><input data-f="url" value="${esc(p.url)}"></label>
    </details>
    <div class="d-foot"><div class="d-foot-btns"><button class="btn small" data-act="refresh">↻ Update metadata</button><button class="btn small danger" data-act="delete">Delete paper</button></div>
      Added ${esc(new Date(p.added_at).toLocaleString())}${p.read_at ? ` · read ${esc(new Date(p.read_at).toLocaleDateString())}` : ''}${Smart.footNote(p)}${p.pdf_exists ? `<br>PDF: ${esc(p.pdf_path)} · <button class="linklike" data-act="detach">unlink PDF</button>` : ''}</div>`;
}
async function loadCitation(id) {
  try {
    const c = await api(`/api/papers/${id}/cite?style=${encodeURIComponent(state.settings.default_style || 'apa')}`);
    if (state.openId === id && $('#cite-box')) $('#cite-box').innerHTML = c.html;
  } catch (e) { /* ignore */ }
}
let savedTimer = null;
function flashSaved() {
  $('#saved').classList.add('show');
  clearTimeout(savedTimer); savedTimer = setTimeout(() => $('#saved').classList.remove('show'), 1400);
}
async function savePaper(id, changes, {rerender = true} = {}) {
  try {
    const d = await api(`/api/papers/${id}`, {method: 'PUT', body: changes});
    upsertPaper(d.paper); renderSidebar(); renderList();
    if (state.openId === id) { if (rerender) renderDetail(); else { loadCitation(id); const h = $('#detail-body .d-head'); if (h) h.outerHTML = detailHead(d.paper); } flashSaved(); }
    return d.paper;
  } catch (err) { toast(err.message, 'error'); return null; }
}

/* ------------------------------------------------------------------ actions */
async function addOne(text, {downloadPdf = false} = {}) {
  return api('/api/papers', {method: 'POST', body: {input: text, group_id: currentGroupId(), download_pdf: downloadPdf}});
}
async function findPdf(id) {
  const t = toast('Looking for a freely available PDF…', 'info', 0);
  try {
    const d = await api(`/api/papers/${id}/pdf`, {method: 'POST'});
    upsertPaper(d.paper); renderAll(); t.close();
    toast(`PDF saved (found via ${d.pdf.source}).`, 'ok');
  } catch (err) {
    t.close();
    if (err.data?.paper) { upsertPaper(err.data.paper); renderAll(); }
    showPdfFail(id, err);
  }
}
function showPdfFail(id, err) {
  const tried = err.data?.tried || [];
  const landing = err.data?.landing;
  const m = modal(`<h3>No free PDF found <button class="help-q" data-help="pdfs" title="Explain this">?</button></h3><p class="muted">${esc(err.message)}</p>
    ${tried.length ? `<div class="section-label">Places checked</div><ul class="tried">${tried.map(t => `<li><b>${esc(t.source)}</b> – ${esc(t.error)}</li>`).join('')}</ul>` : ''}
    <div class="modal-actions"><button class="btn" data-close>Close</button>
      ${landing ? `<a class="btn" href="${esc(landing)}" target="_blank" rel="noopener">🔗 Open article page</a>` : ''}
      <button class="btn" id="pf-inst">🔐 Open &amp; log in with my university</button>
      ${(state.settings.proxies || []).map(x => `<button class="btn" data-pfproxy="${esc(x.id)}">🏛 Via ${esc(x.name)}</button>`).join('')}
      <button class="btn primary" id="pf-attach">📎 Attach a PDF I downloaded…</button></div>
    <p class="muted small">“Open &amp; log in” opens the publisher's page: choose “Access through your institution” (or similar), log in with your university account, then download the PDF – PaperShelf attaches it automatically. Your credentials are typed only on your university's page; PaperShelf never sees them.</p>`, {wide: true});
  $('#pf-attach', m.el).onclick = () => { m.close(); pickAttach(id); };
  $$('[data-pfproxy]', m.el).forEach(b => b.onclick = () => { m.close(); getVia(id, b.dataset.pfproxy); });
  $('#pf-inst', m.el).onclick = () => { m.close(); openForLogin(id); };
}
let attachFor = null;
function pickAttach(id) { attachFor = id; $('#attach-input').value = ''; $('#attach-input').click(); }
async function uploadAttach(id, file) {
  const fd = new FormData(); fd.append('file', file);
  try {
    const d = await api(`/api/papers/${id}/pdf/upload`, {method: 'POST', form: fd});
    upsertPaper(d.paper); renderAll(); toast('PDF attached and saved in your PDF folder.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
}
async function copyCitation(id) {
  try {
    const c = await api(`/api/papers/${id}/cite?style=${encodeURIComponent(state.settings.default_style || 'apa')}`);
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([c.text], {type: 'text/plain'}), 'text/html': new Blob([c.html], {type: 'text/html'})})]);
      } else { await navigator.clipboard.writeText(c.text); }
    } catch (e) {
      const ta = document.createElement('textarea'); ta.value = c.text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast(`Citation copied (${styleName(state.settings.default_style)}) – paste it in Word, Pages or Google Docs, formatting included.`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}
async function refreshMeta(id) {
  const p = paperById(id);
  const input = await askText('Update metadata', {
    label: 'Looks up the details again. Leave as is to re-check, or paste a DOI, link or title to replace them. Your notes, status, labels and keywords are kept.',
    value: p.doi || p.arxiv_id || p.url || p.title, ok: 'Look up'});
  if (input === null) return;
  const t = toast('Looking up details…', 'info', 0);
  try {
    const d = await api(`/api/papers/${id}/refresh`, {method: 'POST', body: {input}});
    upsertPaper(d.paper); renderAll(); renderDetail(); t.close(); toast('Details updated.', 'ok');
  } catch (err) { t.close(); toast(err.message, 'error', 9000); }
}
async function deletePapers(ids) {
  if (!ids.length) return;
  const withPdf = ids.filter(id => paperById(id)?.pdf_exists).length;
  const one = ids.length === 1 ? paperById(ids[0]) : null;
  const editable = new Set((state.shares || []).filter(x => x.role === 'member').map(x => x.id));
  const inShared = ids.filter(id => (paperById(id)?.share_ids || []).some(sid => editable.has(sid))).length;
  const res = await confirmBox(one ? 'Delete this paper?' : `Delete ${ids.length} papers?`,
    one ? `“${truncate(one.title, 120)}” will be removed from your library.` : 'They will be removed from your library and from all labels.',
    {ok: 'Delete', danger: true, checkbox: withPdf ? `Also move ${withPdf > 1 ? `the ${withPdf} PDF files` : 'the PDF file'} to the Trash` : '',
     checkbox2: inShared ? `Also remove ${inShared > 1 ? 'them from their groups' : 'it from its group'} for everybody – the others keep their copy` : '', checked2: true});
  if (!res) return;
  try {
    await api('/api/papers/delete', {method: 'POST', body: {ids, delete_files: res.checked, unshare: inShared ? res.checked2 : true}});
    ids.forEach(id => state.selected.delete(id));
    if (ids.includes(state.openId)) closeDetail();
    await loadLibrary();
    toast(`Deleted ${ids.length} paper${ids.length > 1 ? 's' : ''}.`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
}
async function deletePdfs(ids) {
  ids = ids.filter(id => paperById(id)?.pdf_exists);
  if (!ids.length) { toast('No PDF to delete.'); return; }
  const one = ids.length === 1 ? paperById(ids[0]) : null;
  const trash = /Win/.test(navigator.platform) ? 'Recycle Bin' : 'Trash';
  const ok = await confirmBox(one ? 'Delete this PDF?' : `Delete ${ids.length} PDFs?`,
    `${one ? `The PDF of “${truncate(one.title || 'Untitled', 90)}” is` : 'The PDF files are'} moved to the ${trash} – you can still restore ${one ? 'it' : 'them'} from there. ${one ? 'The paper stays' : 'The papers stay'} in your library, with notes, highlights and labels; you can download the PDF again any time.`,
    {ok: `🗑 Move to the ${trash}`, danger: true});
  if (!ok) return;
  try {
    if (one) { const d = await api(`/api/papers/${one.id}/pdf`, {method: 'DELETE'}); upsertPaper(d.paper); }
    else {
      const d = await api('/api/papers/pdf/delete', {method: 'POST', body: {ids}});
      d.papers.forEach(upsertPaper);
      if (d.errors.length) toast(`${d.errors.length} PDF${d.errors.length > 1 ? 's' : ''} could not be deleted: ${d.errors[0]}`, 'error', 9000);
    }
    if (Reader.isOpen() && ids.includes(Reader.paperId?.())) Reader.close();
    renderAll(); if (state.openId && ids.includes(state.openId)) renderDetail();
    toast(one ? 'PDF moved to the ' + trash + '.' : `${ids.length} PDFs moved to the ${trash}.`, 'ok');
  } catch (err) { toast(err.message, 'error', 9000); }
}
async function bulkFindPdf(ids) {
  const todo = ids.filter(id => !paperById(id)?.pdf_exists);
  if (!todo.length) { toast('All selected papers already have a PDF.'); return; }
  const t = toast(`Finding PDFs… 0/${todo.length}`, 'info', 0);
  let ok = 0;
  for (const [i, id] of todo.entries()) {
    t.set(`Finding PDFs… ${i + 1}/${todo.length}`);
    try { const d = await api(`/api/papers/${id}/pdf`, {method: 'POST'}); upsertPaper(d.paper); ok++; }
    catch (err) { if (err.data?.paper) upsertPaper(err.data.paper); }
    renderList();
  }
  t.close(); renderAll();
  toast(`Downloaded ${ok} of ${todo.length} PDF${todo.length > 1 ? 's' : ''}.` +
    (ok < todo.length ? ' The others have no free version – use “Attach PDF” if you have access.' : ''), ok ? 'ok' : 'info', 9000);
}
async function importPdfs(files) {
  files = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { toast('Only PDF files can be imported.', 'error'); return; }
  const t = toast(`Importing ${files.length} PDF${files.length > 1 ? 's' : ''}…`, 'info', 0);
  let ok = 0, unknown = 0, lastId = null;
  for (const [i, f] of files.entries()) {
    t.set(`Importing ${i + 1}/${files.length}: ${truncate(f.name, 50)}`);
    const fd = new FormData(); fd.append('file', f);
    if (currentGroupId()) fd.append('group_id', currentGroupId());
    try { const d = await api('/api/import-pdf', {method: 'POST', form: fd}); upsertPaper(d.paper); ok++; lastId = d.paper.id; if (!d.identified) unknown++; }
    catch (err) { toast(`${f.name}: ${err.message}`, 'error', 8000); }
  }
  t.close(); await loadLibrary();
  if (ok) toast(`Imported ${ok} PDF${ok > 1 ? 's' : ''}.` + (unknown ? ` ${unknown} could not be identified – open them and use “Update metadata”.` : ''), unknown ? 'info' : 'ok', 9000);
  if (ok === 1 && lastId) openDetail(lastId);
}

/* ------------------------------------------------------------------ dialogs */
function openBulkAdd(prefill = '') {
  const m = modal(`<h3>Add many papers</h3><p class="muted">One per line: links, DOIs, arXiv IDs or titles.</p>
    <textarea class="input" id="bulk-text" rows="9" placeholder="10.1038/s41586-020-2649-2&#10;https://arxiv.org/abs/1706.03762&#10;Attention is all you need">${esc(prefill)}</textarea>
    <div class="section-label">Put them in</div>
    <select class="input" id="bulk-target" style="width:100%"><option value="">No label</option>${groupOptions()}</select>
    <label class="opt" style="margin-top:10px"><input type="checkbox" id="bulk-dl"><span>Also try to download free PDFs<small>Slower – each paper is checked on arXiv, Unpaywall, OpenAlex…</small></span></label>
    <div class="progress-list" id="bulk-progress"></div>
    <div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="bulk-go">Add all</button></div>`, {wide: true});
  if (currentGroupId()) $('#bulk-target', m.el).value = currentGroupId();
  $('#bulk-go', m.el).onclick = async () => {
    const lines = $('#bulk-text', m.el).value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const go = $('#bulk-go', m.el); setBusy(go, true, 'Adding…');
    const prog = $('#bulk-progress', m.el); prog.innerHTML = '';
    const gid = $('#bulk-target', m.el).value || null; const dl = $('#bulk-dl', m.el).checked;
    let ok = 0;
    for (const line of lines) {
      const row = document.createElement('div'); row.textContent = `… ${line}`; prog.appendChild(row); row.scrollIntoView({block: 'nearest'});
      try {
        const d = await api('/api/papers', {method: 'POST', body: {input: line, group_id: gid, download_pdf: dl}});
        upsertPaper(d.paper); ok++;
        row.textContent = `${d.duplicate ? '↺ already in library' : '✓'} ${truncate(d.paper.title, 90)}${dl ? (d.pdf?.ok ? ' · PDF ✓' : ' · no free PDF') : ''}`;
      } catch (err) { row.textContent = `✗ ${line} – ${err.message}`; row.style.color = 'var(--danger)'; }
    }
    setBusy(go, false); go.textContent = 'Add more';
    renderAll(); toast(`Added ${ok} of ${lines.length}.`, ok === lines.length ? 'ok' : 'info');
  };
}
function openExport() {
  const vis = state.visible || []; const sel = [...state.selected].filter(id => paperById(id));
  const groupName = state.view.type === 'group' ? state.groups.find(g => g.id === state.view.id)?.name : '';
  const styleOpts = state.styles.map(s => `<option value="${s.id}" ${s.id === state.settings.default_style ? 'selected' : ''}>${esc(s.name)} – ${esc(s.journals)}</option>`).join('');
  const m = modal(`<h3>Export references <button class="help-q" data-help="export" title="Explain this">?</button></h3>
    <div class="exp-cols"><div>
    <div class="section-label">Which papers</div>
    <label class="opt ${sel.length ? '' : 'disabled'}"><input type="radio" name="scope" value="sel" ${sel.length ? 'checked' : ''}><span>Selected papers <small>${sel.length} selected</small></span></label>
    <label class="opt"><input type="radio" name="scope" value="view" ${sel.length ? '' : 'checked'}><span>Current view: ${esc(viewTitle())}<small>${vis.length} paper${vis.length === 1 ? '' : 's'}${state.keyword || state.search ? ', with the active filters' : ''}</small></span></label>
    <label class="opt"><input type="radio" name="scope" value="all"><span>Whole library<small>${state.papers.length} papers</small></span></label>
    ${state.groups.length || (state.shares || []).length ? `<label class="opt"><input type="radio" name="scope" value="labels"><span>Papers with these labels<small id="exp-lab-n">Pick one or more – a paper with any of them is included</small>
      <span class="exp-labels">${treeOrder().map(g => `<button type="button" class="exp-lab"${chipStyle(g.color)} data-explab="g:${g.id}" title="${esc(groupPath(g.id))}">${labelIcon(g.color, 'tag')}${esc(g.name)}</button>`).join('')}${(state.shares || []).map(x => `<button type="button" class="exp-lab"${chipStyle(x.color)} data-explab="s:${esc(x.id)}">${labelIcon(x.color, 'group')}${esc(x.name)}</button>`).join('')}</span></span></label>` : ''}
    <div id="exp-style-box">
      <div class="section-label">Style</div>
      <select class="input wide" id="exp-style">${styleOpts}</select>
      <label class="opt" style="margin-top:8px"><input type="checkbox" id="exp-order"><span>Keep the order shown on screen<small>Otherwise alphabetical by first author; numbered styles get 1, 2, 3…</small></span></label>
    </div>
    <label class="opt" id="exp-tags-box" style="display:none"><input type="checkbox" id="exp-tags" checked><span>Add my labels as tags<small>e.g. “PaperShelf/Thesis/Chapter 1”, to find them in Zotero</small></span></label>
    </div><div>
    <div class="section-label">Format</div>
    <label class="opt"><input type="radio" name="fmt" value="txt" checked><span>Reference list – text (.txt)<small>Ready to paste anywhere</small></span></label>
    <label class="opt"><input type="radio" name="fmt" value="rtf"><span>Reference list – Word / Pages (.rtf)<small>With italics, bold, hanging indent and double spacing</small></span></label>
    <label class="opt"><input type="radio" name="fmt" value="ris"><span>For Zotero / EndNote / Mendeley (.ris) – recommended<small>Keeps keywords and notes, links your PDF files; labels can become tags</small></span></label>
    <label class="opt"><input type="radio" name="fmt" value="bibtex"><span>BibTeX (.bib)<small>LaTeX / Overleaf</small></span></label>
    <label class="opt"><input type="radio" name="fmt" value="csljson"><span>CSL-JSON (.json)<small>Most precise import into Zotero (no tags)</small></span></label>
    <label class="opt"><input type="radio" name="fmt" value="csv"><span>Spreadsheet (.csv)<small>All fields, opens in Excel or Numbers</small></span></label>
    </div></div>
    <div class="modal-actions"><span class="muted small">📝 Notes too? <button class="linklike" id="exp-notes">Export notes with their references…</button></span><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="exp-go">⤓ Download</button></div>`, {wide: true});
  const sync = () => {
    const fmt = $('input[name=fmt]:checked', m.el).value;
    $('#exp-style-box', m.el).style.display = ['txt', 'rtf', 'csv'].includes(fmt) ? '' : 'none';
    $('#exp-tags-box', m.el).style.display = ['ris', 'bibtex'].includes(fmt) ? '' : 'none';
  };
  $$('input[name=fmt]', m.el).forEach(r => r.addEventListener('change', sync)); sync();
  // export a subset: the papers with any of the chosen labels (sub-labels included) or groups
  const picked = new Set();
  const labelIds = () => {
    const out = new Set();
    for (const k of picked) {
      if (k.startsWith('g:')) { const ids = descendants(+k.slice(2)); state.papers.forEach(p => { if (p.group_ids.some(g => ids.has(g))) out.add(p.id); }); }
      else { const sid = k.slice(2); state.papers.forEach(p => { if ((p.share_ids || []).includes(sid)) out.add(p.id); }); }
    }
    return [...out];
  };
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-explab]'); if (!b) return;
    e.preventDefault();
    const k = b.dataset.explab; picked.has(k) ? picked.delete(k) : picked.add(k); b.classList.toggle('on', picked.has(k));
    const r = $('input[name=scope][value=labels]', m.el); if (r) r.checked = picked.size > 0 || r.checked;
    const n = labelIds().length;
    $('#exp-lab-n', m.el).textContent = picked.size ? `${n} paper${n === 1 ? '' : 's'} with ${picked.size === 1 ? 'this label' : 'any of these labels'}` : 'Pick one or more – a paper with any of them is included';
  });
  $('#exp-notes', m.el).onclick = () => {
    const scope = $('input[name=scope]:checked', m.el).value;
    m.close(); Notes.exportDialog(scope === 'sel' ? sel : scope === 'view' ? vis : state.papers.map(p => p.id));
  };
  $('#exp-go', m.el).onclick = async () => {
    const scope = $('input[name=scope]:checked', m.el).value; const fmt = $('input[name=fmt]:checked', m.el).value;
    const ids = scope === 'sel' ? sel : scope === 'view' ? vis : scope === 'labels' ? labelIds() : state.papers.map(p => p.id);
    if (!ids.length) { toast(scope === 'labels' ? 'Pick at least one label with papers.' : 'There are no papers to export.', 'error'); return; }
    const style = $('#exp-style', m.el).value;
    const labName = scope === 'labels' ? [...picked].map(k => k.startsWith('g:') ? state.groups.find(g => g.id === +k.slice(2))?.name : state.shares.find(x => x.id === k.slice(2))?.name).filter(Boolean).slice(0, 3).join('+') : '';
    const name = 'references' + (scope === 'view' && groupName ? '_' + groupName : '') + (labName ? '_' + labName : '') + (['txt', 'rtf'].includes(fmt) ? '_' + style : '');
    try {
      const r = await fetch('/api/export', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ids, format: fmt, name, style, order: $('#exp-order', m.el).checked ? 'list' : 'alpha', group_tags: $('#exp-tags', m.el).checked})});
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const fn = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'references.txt';
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      m.close();
      toast(`Exported ${ids.length} reference${ids.length > 1 ? 's' : ''} to ${fn} (in your Downloads).` +
        (fmt === 'ris' || fmt === 'csljson' ? ' In Zotero: File → Import… and pick this file.' : ''), 'ok', 9000);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openSettings(startTab) {
  const s = state.settings; const o = location.origin;
  const bm = pdf => `javascript:(function(){window.open('${o}/quickadd?url='+encodeURIComponent(location.href)${pdf ? "+'&pdf=1'" : ''},'_blank');})();`;
  const TABS = [['general', 'General'], ['pdfs', 'PDFs & access'], ['sync', '💻 My computers'], ['sharing', '👥 Groups'], ['data', 'Data sources'], ['updates', 'Updates']];
  let tab = 'general'; try { tab = localStorage.getItem('papershelf-settings-tab') || 'general'; } catch (e) { /* ignore */ }
  if (tab === 'github') tab = 'sync';
  if (typeof startTab === 'string') tab = startTab;
  if (!TABS.some(t => t[0] === tab)) tab = 'general';
  const m = modal(`<h3>Settings <span class="grow"></span><button class="btn small" data-help="status" title="Check that everything works: Git, GitHub, sources…">🩺 System check</button> <button class="btn small" id="set-quit" title="Stop PaperShelf on this computer">⏻ Quit</button></h3>
    <div class="stabs">${TABS.map(([id, label]) => `<button data-stab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div class="stab-panels">

    <div class="stab-panel" data-panel="general">
    <div class="section-label">Open PaperShelf on</div>
    <select class="input wide" id="set-start"><option value="reading" ${(s.start_page || 'reading') === 'reading' ? 'selected' : ''}>📖 Reading list</option><option value="library" ${s.start_page === 'library' ? 'selected' : ''}>📚 Library</option><option value="people" ${s.start_page === 'people' ? 'selected' : ''}>👥 Researchers</option></select>
    <div class="section-label">Look</div>
    <div class="seg look-seg"><button type="button" data-look="metal" class="${(s.look || 'metal') === 'metal' ? 'on' : ''}">✦ Green glass</button><button type="button" data-look="flat" class="${s.look === 'flat' ? 'on' : ''}">Flat</button></div>
    <div class="section-label">PaperShelf as an app <button class="help-q" data-help="updates" title="Explain this">?</button></div>
    <div id="ia-section"><p class="muted small">…</p></div>
    <details class="more"><summary>Other ways to start it</summary>
      <label class="opt"><input type="checkbox" id="set-ownwin" ${s.own_window !== '' ? 'checked' : ''}><span>Open in its own window<small>With Chrome, Edge or Brave: a window without the address bar. Otherwise your normal browser.</small></span></label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small" id="set-shortcut">🖥 Create a simple PaperShelf icon</button><span class="muted small" id="set-shortcut-res">${state.platform === 'win32' ? 'Desktop and Start menu' : state.platform === 'darwin' ? 'Applications folder and Desktop' : 'Applications menu'}</span></div>
    </details>
    <div class="section-label">Reading</div>
    <label class="opt-row">Remind me of papers waiting in the reading list for more than
      <select class="input" id="set-stale">${[['', 'never'], ['30', '1 month'], ['60', '2 months'], ['90', '3 months'], ['180', '6 months']].map(([v, l]) => `<option value="${v}" ${(s.stale_days || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="opt"><input type="checkbox" id="set-libcheck" ${s.lib_check !== '' ? 'checked' : ''}><span>Watch my papers for retractions and published versions <button class="help-q" data-help="smart" title="Explain this">?</button><small>When you press ⟳. Only the papers' DOIs are sent, nothing about you.</small></span></label>
    <label class="opt"><input type="checkbox" id="set-checks" ${s.list_checkboxes === '1' ? 'checked' : ''}><span>Always show selection boxes in the list<small>Off: they appear when you select (${state.platform === 'darwin' ? '⌘' : 'Ctrl'}-click or Shift-click).</small></span></label>
    <div class="section-label">Citations & files</div>
    <div class="set-grid"><span class="muted small">Citation style</span><select class="input" id="set-style">${state.styles.map(x => `<option value="${x.id}" ${x.id === s.default_style ? 'selected' : ''}>${esc(x.name)} – ${esc(x.journals)}</option>`).join('')}</select>
      <span class="muted small">PDF folder</span><div style="display:flex;gap:6px"><input class="input" id="set-dir" style="flex:1" value="${esc(s.pdf_dir)}"><button class="btn" id="open-dir">Open</button></div></div>
    <details class="more"><summary>Browser buttons – save an article from any web page</summary>
      <p class="muted small" style="margin-bottom:4px">Show the bookmarks bar (⇧⌘B on Mac, Ctrl+Shift+B on Windows), then <b>drag</b> these buttons onto it. On an article page, click one to save it here. <button class="help-q" data-help="adding" title="Explain this">?</button></p>
      <a class="bookmarklet" href="${esc(bm(false))}" onclick="return false">＋ Save to PaperShelf</a>
      <a class="bookmarklet" href="${esc(bm(true))}" onclick="return false">⬇ Save + PDF</a></details>
    <p class="muted small set-privacy">🛡 Your library, notes and settings stay on this computer (<code>${esc(state.dataDir)}</code>) – and in your own private GitHub repository if you sync. <button class="linklike" data-help="privacy">Privacy details</button></p>
    </div>

    <div class="stab-panel" data-panel="pdfs">
    <div class="section-label">E-mail for Unpaywall (optional) <button class="help-q" data-help="keys" title="Explain this">?</button></div>
    <input class="input wide" id="set-email" type="email" value="${esc(s.email)}" placeholder="leave empty to skip Unpaywall">
    <p class="muted small">Unpaywall, the largest index of legal free PDFs, asks for an e-mail with each request. It goes only to Unpaywall, only when you look for a PDF.</p>
    <div class="section-label">CORE API key (optional) <button class="help-q" data-help="keys" title="Explain this">?</button></div>
    <input class="input wide" id="set-core" type="password" autocomplete="off" placeholder="${s.has_core_key ? '•••••••• key saved – paste a new one to replace it' : 'Free key from core.ac.uk/services/api'}">
    <p class="muted small">University repositories worldwide (authors' legal copies). With a free key, “Find PDF” searches them too.</p>
    <div class="section-label">University / library access <button class="help-q" data-help="university" title="Explain this">?</button></div>
    <p class="muted small">For paywalled papers: PaperShelf opens the article through your library's page, you log in there as usual and download the PDF – it is attached to the right paper by itself. Your password is never stored.</p>
    <div id="proxy-rows">${(s.proxies || []).map(proxyRow).join('')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" id="proxy-add">＋ Add a library</button>
      <select class="input" id="proxy-preset" style="padding:4px 8px"><option value="">Templates…</option><option value="https://ezproxy.YOUR-UNIVERSITY.edu/login?url=">EZproxy (…/login?url=)</option><option value="https://YOUR-UNIVERSITY.idm.oclc.org/login?url=">EZproxy hosted by OCLC</option><option value="https://go.openathens.net/redirector/YOUR-UNIVERSITY.edu?url={url}">OpenAthens redirector</option></select></div>
    <details class="help"><summary>Where do I find my library's address?</summary>
      <p>Look on your library website for “off-campus access”, “EZproxy”, “OpenAthens” or a “library bookmarklet”, or search the web for <i>“your university name” EZproxy</i>. The address ends where the article link goes, for example <code>https://ezproxy.uni.edu/login?url=</code>. You can also write <code>{url}</code> or <code>{doi}</code> where the article link or DOI should go.</p>
      <p>Click <b>Test</b>: it opens a subscription-only <i>Science</i> article through your library. If after logging in you can read the full text, it works. On campus or on the university VPN, “Find &amp; download PDF” usually works directly too.</p></details>
    <label class="opt"><input type="checkbox" id="set-auto-import" ${s.auto_import === '1' ? 'checked' : ''}><span>Always attach PDFs I download<small>Any new PDF in the folder below whose DOI matches a paper in your library is attached automatically (not only after “Get via library”).</small></span></label>
    <label class="opt"><input type="checkbox" id="set-remove-dl" ${s.remove_downloads === '1' ? 'checked' : ''}><span>Move the downloaded file to the Trash once attached<small>A copy is kept in your PDF folder.</small></span></label>
    <div style="display:flex;gap:6px;align-items:center"><span class="muted small" style="white-space:nowrap">Downloads folder</span><input class="input" id="set-watch" style="flex:1" value="${esc(s.watch_dir)}"></div>
    ${state.platform === 'darwin' ? '<p class="muted small">The first time, macOS may ask to let PaperShelf access the Downloads folder: click Allow.</p>' : ''}
    </div>

    <div class="stab-panel" data-panel="sync">
    <div class="set-intro sync"><b>💻 The same library on all your computers</b> (Mac and Windows) – papers, labels, private notes, highlights, reading status and, if you like, PDFs. It goes through a <b>private</b> GitHub repository that only you can see. With one computer you don't need it. <button class="help-q" data-help="sync" title="Explain this">?</button></div>
    <div class="set-status ${s.sync_repo && s.has_sync_token ? (s.last_sync_error ? 'bad' : 'ok') : ''}">${s.sync_repo && s.has_sync_token
      ? `${s.last_sync_error ? `⚠ Last sync failed: ${esc(s.last_sync_error)}` : `✓ On – ${s.last_sync ? `last sync ${esc(new Date(s.last_sync).toLocaleString())}` : 'not synced yet'}`} · <span class="muted">${esc(s.sync_repo.replace(/^https?:\/\/github\.com\//, ''))}</span>`
      : 'Not set up yet: 4 steps, about 5 minutes, the first time only.'}</div>
    <ol class="gh-steps">
      <li><b>A GitHub account</b> – free; skip if you have one. <a class="btn small" href="https://github.com/signup" target="_blank" rel="noopener">Create an account</a></li>
      <li><b>A private repository</b> named <code>papershelf-library</code>: your library is kept there. <a class="btn small" href="https://github.com/new?name=papershelf-library&visibility=private&description=My%20PaperShelf%20library%20(private)" target="_blank" rel="noopener">Create it on GitHub</a> <button class="linklike small" data-help="gh-repo">Show me how</button></li>
      <li><b>A token</b> – a password just for PaperShelf. <a class="btn small" href="https://github.com/settings/personal-access-tokens/new?name=PaperShelf&description=PaperShelf%3A%20sync%20my%20library%20and%20groups&expires_in=366&contents=write&gists=write" target="_blank" rel="noopener">Create it on GitHub</a> <button class="linklike small" data-help="gh-token">Show me how</button>
        <small>The page opens filled in; you only choose <i>Repository access → Only select repositories → papershelf-library</i>, then <i>Generate token</i> and copy it. The same token works for 👥 Groups too.</small></li>
      <li><b>Paste them here</b> and click <i>Test</i>:
        <input class="input wide" id="set-token" type="password" autocomplete="off" placeholder="${s.has_sync_token ? '•••••••• token saved – paste a new one to replace it' : 'Token (github_pat_…)'}">
        <input class="input wide" id="set-repo" value="${esc(s.sync_repo)}" placeholder="Repository address, e.g. https://github.com/your-name/papershelf-library">
        <div class="sync-actions"><button class="btn small" id="sync-test">Test</button><span id="sync-test-res" class="muted small"></span></div></li>
    </ol>
    ${s.has_git === false ? `<p class="warn-box small"><b>Git is needed</b> and isn't installed on this computer. ${state.platform === 'darwin' ? 'Open the Terminal app, type <code>xcode-select --install</code>, press Enter and accept.' : 'Install it from <a href="https://git-scm.com/download/win" target="_blank" rel="noopener">git-scm.com</a> (default options), then restart PaperShelf.'}</p>` : ''}
    <label class="opt"><input type="checkbox" id="set-sync-auto" ${s.sync_auto === '1' ? 'checked' : ''}><span>Sync automatically<small>When PaperShelf starts and every 20 minutes. Otherwise press ⟳.</small></span></label>
    <label class="opt"><input type="checkbox" id="set-sync-pdfs" ${s.sync_pdfs === '1' ? 'checked' : ''}><span>Also sync PDF files<small>GitHub works best under ~1 GB (≈ 400 papers). Off: free PDFs can be fetched again with “Find PDFs”.</small></span></label>
    <p class="muted small"><b>On your other computer:</b> install PaperShelf, then do step 4 with the same repository (same token, or a new one). Your library appears after the first sync.</p>
    </div>

    <div class="stab-panel" data-panel="sharing">
    ${typeof Shares !== 'undefined' ? Shares.settingsHtml(s) : ''}
    </div>

    <div class="stab-panel" data-panel="data">
    <div class="section-label">OpenAlex API key (optional) <button class="help-q" data-help="keys" title="Explain this">?</button></div>
    <input class="input wide" id="set-oakey" type="password" autocomplete="off" placeholder="${s.has_openalex_key ? '•••••••• key saved – paste a new one to replace it' : 'Free key from openalex.org/settings/api'}">
    <p class="muted small">Citation data, suggestions, title search and researcher profiles come from OpenAlex. Without a key there is a small free daily allowance; a free key gives ten times more.</p>
    <div class="section-label">Journal rankings (SCImago) <button class="help-q" data-help="journal-metrics" title="Explain this">?</button></div>
    <p class="muted small">Used for the IF columns and quartiles in the Researchers tab. Normally downloaded automatically; if scimagojr.com refuses, open <a href="https://www.scimagojr.com/journalrank.php" target="_blank" rel="noopener">scimagojr.com</a>, choose a year, click “Download data”, and import the files here – several at once is fine (the year is read from the file name, e.g. <i>scimagojr 2024.csv</i>).</p>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn small" id="sjr-file-btn">Import tables…</button><button class="btn small" id="sjr-dir-btn" title="SCImago tables downloaded by your browser are moved here and used automatically">Open tables folder</button><input type="file" id="sjr-file" accept=".csv,.txt,.xls" multiple hidden><span class="muted small" id="sjr-loaded"></span></div>
    </div>

    <div class="stab-panel" data-panel="updates">
    <div class="section-label">PaperShelf ${esc(state.version || '')} <button class="help-q" data-help="updates" title="Explain this">?</button></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="muted small">${Updates.info && Updates.info.available ? `<b>${esc(Updates.info.latest)} is available.</b>` : 'New versions come from github.com/MirkoZanon/PaperShelf.'}</span><button class="btn small" id="set-updates">Check for updates…</button></div>
    <label class="opt" style="margin-top:10px"><input type="checkbox" id="set-upd-check" ${s.update_check !== '' ? 'checked' : ''}><span>Check for updates automatically<small>When PaperShelf starts and twice a day – an anonymous request to GitHub.</small></span></label>
    <label class="opt"><input type="checkbox" id="set-upd-auto" ${s.update_auto !== '' ? 'checked' : ''}><span>Install updates automatically<small>A new version is installed when PaperShelf starts, before it opens (a backup of the old one is kept). Off: the ⬆ Update button appears and you choose when.</small></span></label>
    </div>
    </div>
    <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="set-save">Save</button></div>`, {wide: true, nofocus: true});
  m.el.querySelector('.modal').classList.add('settings-modal');
  const showTab = id => {
    $$('[data-stab]', m.el).forEach(b => b.classList.toggle('on', b.dataset.stab === id));
    $$('.stab-panel', m.el).forEach(p => { p.hidden = p.dataset.panel !== id; });
    try { localStorage.setItem('papershelf-settings-tab', id); } catch (e) { /* ignore */ }
  };
  showTab(tab);
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-stab]'); if (b) showTab(b.dataset.stab); });
  $('#set-shortcut', m.el).onclick = async () => {
    const b = $('#set-shortcut', m.el); setBusy(b, true, 'Creating…');
    try { const d = await api('/api/shortcut', {method: 'POST', body: {desktop: true}}); $('#set-shortcut-res', m.el).innerHTML = `<span style="color:var(--ok)">✓ Done.</span> ${esc(d.hint)}`; }
    catch (err) { $('#set-shortcut-res', m.el).innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
    finally { setBusy(b, false); }
  };
  if (typeof AppInstall !== 'undefined') AppInstall.settingsHtml().then(h => { const el = $('#ia-section', m.el); if (el) { el.innerHTML = h; AppInstall.settingsBind(m); } });
  $('#set-start', m.el).onchange = async e => {
    try { const d = await api('/api/settings', {method: 'PUT', body: {start_page: e.target.value}}); state.settings = d.settings; toast('Saved – PaperShelf will open there next time.', 'ok'); }
    catch (err) { toast(err.message, 'error'); }
  };
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-look]'); if (!b) return;
    $$('[data-look]', m.el).forEach(x => x.classList.toggle('on', x === b)); applyLook(b.dataset.look);
    try { const d = await api('/api/settings', {method: 'PUT', body: {look: b.dataset.look}}); state.settings = d.settings; } catch (err) { toast(err.message, 'error'); }
  });
  $('#set-stale', m.el).onchange = async e => {
    try { const d = await api('/api/settings', {method: 'PUT', body: {stale_days: e.target.value}}); state.settings = d.settings; renderList(); }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#set-libcheck', m.el).onchange = async e => {
    try { const d = await api('/api/settings', {method: 'PUT', body: {lib_check: e.target.checked}}); state.settings = d.settings; }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#set-checks', m.el).onchange = async e => {
    try { const d = await api('/api/settings', {method: 'PUT', body: {list_checkboxes: e.target.checked}}); state.settings = d.settings; renderList(); }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#set-ownwin', m.el).onchange = async e => {
    try { const d = await api('/api/settings', {method: 'PUT', body: {own_window: e.target.checked}}); state.settings = d.settings; }
    catch (err) { toast(err.message, 'error'); }
  };
  $('#set-quit', m.el).onclick = () => { m.close(); quitApp(); };
  if (typeof Shares !== 'undefined') Shares.settingsBind(m);
  $('#set-updates', m.el).onclick = () => { m.close(); Updates.open(); };
  $('#open-dir', m.el).onclick = () => api('/api/open-folder', {method: 'POST'}).catch(e => toast(e.message, 'error'));
  $('#sync-test', m.el).onclick = async () => {
    const res = $('#sync-test-res', m.el); res.textContent = 'Testing…';
    try {
      const d = await api('/api/sync/test', {method: 'POST', body: {sync_repo: $('#set-repo', m.el).value, sync_token: $('#set-token', m.el).value}});
      res.innerHTML = `<span style="color:var(--ok)">✓ Works${d.empty ? ' – repository still empty, it will be filled at the first sync' : ''}. Click Save.</span>`;
    } catch (err) { res.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
  };
  $('#sjr-file-btn', m.el).onclick = () => $('#sjr-file', m.el).click();
  $('#sjr-dir-btn', m.el).onclick = () => api('/api/sjr/open-folder', {method: 'POST'}).catch(err => toast(err.message, 'error'));
  $('#sjr-file', m.el).onchange = async e => { await importSjrFiles([...e.target.files]); e.target.value = ''; showSjrLoaded(); };
  const showSjrLoaded = () => api('/api/sjr/status').then(st => { const el = $('#sjr-loaded', m.el); if (el) el.textContent = st.loaded.length ? `Loaded: ${compactYears(st.loaded)}` : 'No tables loaded yet.'; }).catch(() => {});
  showSjrLoaded();
  const addRow = tpl => { $('#proxy-rows', m.el).insertAdjacentHTML('beforeend', proxyRow({id: '', name: '', template: tpl || ''})); $$('.proxy-row .px-name', m.el).pop().focus(); };
  $('#proxy-add', m.el).onclick = () => addRow('');
  $('#proxy-preset', m.el).onchange = e => { if (e.target.value) { addRow(e.target.value); e.target.value = ''; } };
  $('#proxy-rows', m.el).addEventListener('click', e => {
    const r = e.target.closest('.proxy-row'); if (!r) return;
    if (e.target.closest('[data-pxdel]')) r.remove();
    if (e.target.closest('[data-pxtest]')) {
      const tpl = $('.px-tpl', r).value.trim();
      if (!/^https?:\/\//.test(tpl) || /YOUR-UNIVERSITY/.test(tpl)) { toast('Enter your library\'s address first.', 'error'); return; }
      window.open(proxiedUrl(tpl, {doi: '10.1126/science.1127647'}), '_blank', 'noopener');
    }
  });
  $('#set-save', m.el).onclick = async () => {
    try {
      const d = await api('/api/settings', {method: 'PUT', body: {
        email: $('#set-email', m.el).value, pdf_dir: $('#set-dir', m.el).value, default_style: $('#set-style', m.el).value,
        sync_repo: $('#set-repo', m.el).value, sync_token: $('#set-token', m.el).value,
        sync_pdfs: $('#set-sync-pdfs', m.el).checked, sync_auto: $('#set-sync-auto', m.el).checked,
        proxies: $$('.proxy-row', m.el).map(r => ({id: r.dataset.id, name: $('.px-name', r).value, template: $('.px-tpl', r).value.trim()})).filter(x => x.template),
        auto_import: $('#set-auto-import', m.el).checked, remove_downloads: $('#set-remove-dl', m.el).checked,
        watch_dir: $('#set-watch', m.el).value, openalex_key: $('#set-oakey', m.el).value, core_key: $('#set-core', m.el).value,
        update_check: $('#set-upd-check', m.el).checked, update_auto: $('#set-upd-auto', m.el).checked,
        ...(typeof Shares !== 'undefined' ? Shares.settingsValues(m) : {})}});
      const firstSync = !state.settings.sync_repo && d.settings.sync_repo;
      state.settings = d.settings; updateSyncButton(); m.close(); toast('Settings saved.', 'ok');
      if (state.openId) loadCitation(state.openId);
      if (firstSync) syncNow();
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ------------------------------------------------------------------ keyword manager */
async function manageKeywords() {
  let data;
  try { data = await api('/api/keywords'); } catch (err) { toast(err.message, 'error'); return; }
  const sel = new Set();
  const m = modal(`<h3>Keywords <span class="grow"></span><button class="btn small" data-help="organising">📘 Guide</button></h3>
    <p class="muted small">${data.keywords.length} keywords in your library. Tidy them up: <b>merge</b> variants of the same idea, <b>rename</b> or <b>delete</b>. Changes apply to every paper.</p>
    ${data.variants.length ? `<div class="kwm-variants"><div class="section-label">Probably the same keyword (${data.variants.length})</div>
      ${data.variants.slice(0, 30).map((v, i) => `<div class="kwm-var"><span>${v.map(esc).join(' · ')}</span><button class="btn small" data-mergev="${i}">Merge into “${esc(v[0])}”</button></div>`).join('')}
      ${data.variants.length > 1 ? `<button class="btn small" id="kwm-all">Merge all ${data.variants.length} suggestions</button>` : ''}</div>` : ''}
    <input class="input wide" id="kwm-q" type="search" placeholder="Search keywords…" style="margin-top:8px">
    <div class="kwm-list" id="kwm-list"></div>
    <div class="kwm-actions"><span class="muted small" id="kwm-n">Select keywords to change them</span><span class="grow"></span>
      <input class="input" id="kwm-to" placeholder="New name / merge into…" style="width:220px">
      <button class="btn small" id="kwm-apply" disabled>Rename / merge</button><button class="btn small danger" id="kwm-del" disabled>Delete</button></div>
    <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
  const list = () => {
    const q = $('#kwm-q', m.el).value.toLowerCase();
    const rows = data.keywords.filter(k => !q || k.keyword.toLowerCase().includes(q)).slice(0, 400);
    $('#kwm-list', m.el).innerHTML = rows.map(k => `<label class="kwm-row"><input type="checkbox" data-kwsel="${esc(k.keyword)}" ${sel.has(k.keyword) ? 'checked' : ''}><span>${esc(k.keyword)}</span><span class="muted small">${k.count}</span></label>`).join('')
      || '<div class="muted small" style="padding:8px">No keyword matches.</div>';
    $('#kwm-n', m.el).textContent = sel.size ? `${sel.size} selected` : 'Select keywords to change them';
    $('#kwm-apply', m.el).disabled = $('#kwm-del', m.el).disabled = !sel.size;
    $('#kwm-apply', m.el).textContent = sel.size > 1 ? 'Merge' : 'Rename';
  };
  const run = async (action, keywords, to = '') => {
    try {
      const d = await api('/api/keywords', {method: 'POST', body: {action, keywords, to}});
      toast(`${action === 'delete' ? 'Deleted' : action === 'merge' ? 'Merged' : 'Renamed'} – ${d.papers} paper${d.papers === 1 ? '' : 's'} updated.`, 'ok');
      await loadLibrary(); m.close(); manageKeywords();
    } catch (err) { toast(err.message, 'error'); }
  };
  list();
  $('#kwm-q', m.el).addEventListener('input', list);
  $('#kwm-list', m.el).addEventListener('change', e => {
    const k = e.target.dataset.kwsel; if (k == null) return;
    e.target.checked ? sel.add(k) : sel.delete(k);
    if (!$('#kwm-to', m.el).value && sel.size) $('#kwm-to', m.el).value = [...sel][0];
    list();
  });
  $('#kwm-apply', m.el).onclick = () => { const to = $('#kwm-to', m.el).value.trim(); if (!to) { $('#kwm-to', m.el).focus(); return; } run(sel.size > 1 ? 'merge' : 'rename', [...sel], to); };
  $('#kwm-del', m.el).onclick = async () => {
    const ok = await confirmBox(`Delete ${sel.size} keyword${sel.size > 1 ? 's' : ''}?`, 'They are removed from every paper. The papers themselves stay.', {ok: 'Delete', danger: true});
    if (ok) run('delete', [...sel]);
  };
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-mergev]');
    if (b) { const v = data.variants[+b.dataset.mergev]; run('merge', v, v[0]); }
    if (e.target.id === 'kwm-all') {
      const ok = await confirmBox(`Merge ${data.variants.length} groups of variants?`, 'Each group becomes its most used spelling.', {ok: 'Merge all'});
      if (!ok) return;
      for (const v of data.variants) { try { await api('/api/keywords', {method: 'POST', body: {action: 'merge', keywords: v, to: v[0]}}); } catch (err) { /* continue */ } }
      toast('Variants merged.', 'ok'); await loadLibrary(); m.close(); manageKeywords();
    }
  });
}

/* ------------------------------------------------------------------ search inside PDFs */
let ftSeq = 0;
async function searchPdfs() {
  const q = state.search, my = ++ftSeq;
  if (q.length < 2) { state.ftHits = {}; state.ftQuery = q; return; }
  try {
    const d = await api('/api/fulltext?q=' + encodeURIComponent(q));
    if (my !== ftSeq) return;
    state.ftHits = d.hits; state.ftStatus = d.status; state.ftQuery = q;
    renderList(); renderKeywords();
  } catch (e) { /* the metadata search still works */ }
}
function snippetHtml(s) { return esc(s).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>'); }
function ftSnippet(p) {
  if (!state.search || state.ftQuery !== state.search) return '';
  const h = (state.ftHits || {})[p.id]; if (!h || !h.hits?.length) return '';
  const first = h.hits[0];
  return `<div class="row-ft" data-ftpage="${first.page}" title="Open the PDF at this page">📄 <b>p. ${first.page}</b>${h.pages > 1 ? ` <span class="muted">(+${h.pages - 1} more page${h.pages > 2 ? 's' : ''})</span>` : ''} – ${snippetHtml(first.snippet)}</div>`;
}

/* ------------------------------------------------------------------ quit */
/* ------------------------------------------------------------------ sidebar: pinned or auto-hide */
// Each page (Reading list / Library) remembers whether its sidebar stays open. Unpinned, the sidebar
// hides and slides in when the mouse reaches the left edge, with ☰, or while dragging papers there.
const Side = {
  timer: null,
  key: () => state.tab === 'people' ? 'people' : state.area,  // reading / library / people, each remembered
  el: () => $(state.tab === 'people' ? '#people-side' : '#sidebar'),
  pinned: () => !!(state.sidePin || {})[Side.key()],
  apply() {
    const auto = !Side.pinned();
    document.body.classList.toggle('side-auto', auto);
    if (!auto) document.body.classList.remove('side-open');
    const where = {reading: 'Reading list', library: 'Library', people: 'Researchers'}[Side.key()];
    $$('#side-toggle, #people-side-toggle').forEach(t => { t.classList.toggle('on', Side.pinned()); t.title = Side.pinned() ? 'Hide the sidebar (it slides in when you move the mouse to the left edge)' : 'Keep the sidebar open (now it slides in when you move the mouse to the left edge)'; });
    $$('[data-sidepin]').forEach(b => { b.classList.toggle('on', Side.pinned()); b.title = Side.pinned() ? `The sidebar stays open on ${where} – click to hide it automatically` : `Keep the sidebar open on ${where}`; });
  },
  toggle() { state.sidePin = {...(state.sidePin || {}), [Side.key()]: !Side.pinned()}; savePrefs(); Side.apply(); },
  open() { clearTimeout(Side.timer); if (document.body.classList.contains('side-auto')) document.body.classList.add('side-open'); },
  close(delay = 350) {
    clearTimeout(Side.timer);
    Side.timer = setTimeout(() => {
      const sb = Side.el();
      if (!sb || sb.matches(':hover') || sb.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || $('.color-pop')) return;
      document.body.classList.remove('side-open');
    }, delay);
  },
};

/* ------------------------------------------------------------------ right-click menu on a paper */
function rowMenu(e, id) {
  e.preventDefault();
  document.querySelector('.ctx-menu')?.remove();
  const ids = state.selected.has(id) ? [...state.selected] : [id];
  const P = ids.map(paperById).filter(Boolean); if (!P.length) return;
  const one = P.length === 1 ? P[0] : null;
  const has = gid => P.every(p => p.group_ids.includes(gid));
  const some = gid => P.some(p => p.group_ids.includes(gid));
  const labelItems = (pid = null, depth = 0) => childrenOf(pid).map(g => `<button class="ctx-item ctx-check ${has(g.id) ? 'on' : some(g.id) ? 'part' : ''}" data-cl="${g.id}" style="padding-left:${10 + depth * 14}px"><span class="ctx-tick">${has(g.id) ? '✓' : some(g.id) ? '–' : ''}</span>${labelIcon(g.color, 'tag')}<span>${esc(g.name)}</span></button>` + labelItems(g.id, depth + 1)).join('');
  const shares = (state.shares || []).filter(x => x.role === 'member');
  const shHas = sid => P.every(p => (p.share_ids || []).includes(sid));
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = `<div class="ctx-head">${one ? esc(truncate(one.title || 'Untitled', 60)) : `${P.length} papers`}</div>
    <div class="ctx-item ctx-parent">🏷 Labels<span class="ctx-arrow">›</span><div class="ctx-sub">${state.groups.length ? labelItems() : '<div class="ctx-empty">No labels yet</div>'}<div class="ctx-sep"></div><button class="ctx-item" data-c="newlabel">＋ New label…</button></div></div>
    ${shares.length ? `<div class="ctx-item ctx-parent">👥 Groups<span class="ctx-arrow">›</span><div class="ctx-sub">${shares.map(x => `<button class="ctx-item ctx-check ${shHas(x.id) ? 'on' : ''}" data-cs="${esc(x.id)}"><span class="ctx-tick">${shHas(x.id) ? '✓' : ''}</span>${labelIcon(x.color, 'link')}<span>${esc(x.name)}</span></button>`).join('')}</div></div>` : ''}
    <div class="ctx-item ctx-parent">◐ Status<span class="ctx-arrow">›</span><div class="ctx-sub">${Object.entries({to_read: 'To read', reading: 'Reading now', read: 'Read'}).map(([k, l]) => `<button class="ctx-item ctx-check ${P.every(p => p.status === k) ? 'on' : ''}" data-cst="${k}"><span class="ctx-tick">${P.every(p => p.status === k) ? '✓' : ''}</span><span>${l}</span></button>`).join('')}</div></div>
    <div class="ctx-sep"></div>
    ${one ? `<button class="ctx-item" data-c="pdf">📄 ${one.pdf_exists ? 'Open PDF' : 'Get the PDF'}</button>${one.pdf_exists ? '<button class="ctx-item" data-c="delpdf">🗑 Delete the PDF…</button>' : ''}<button class="ctx-item" data-c="notes">📝 Notes</button><button class="ctx-item" data-c="details">ⓘ Details</button><button class="ctx-item" data-c="cite">❝ Copy citation</button>` : `<button class="ctx-item" data-c="export">⤓ Export references</button>${P.some(p => p.pdf_exists) ? `<button class="ctx-item" data-c="delpdf">🗑 Delete ${P.filter(p => p.pdf_exists).length} PDF${P.filter(p => p.pdf_exists).length > 1 ? 's' : ''}…</button>` : ''}`}
    <button class="ctx-item" data-c="star">${P.every(p => p.starred) ? '☆ Unstar' : '★ Star'}</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item ctx-danger" data-c="delete">🗑 Delete${one ? '' : ` ${P.length} papers`}…</button>`;
  document.body.appendChild(m);
  const W = window.innerWidth, H = window.innerHeight;
  m.style.left = Math.min(e.clientX, W - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(e.clientY, H - m.offsetHeight - 8) + 'px';
  if (e.clientX + m.offsetWidth + 240 > W) m.classList.add('flip');
  const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', esc_, true); };
  const out = ev => { if (!m.contains(ev.target)) close(); };
  const esc_ = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', esc_, true); }, 0);
  m.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.cl) {  // toggle a label, keep the menu open to tick more
      const gid = +b.dataset.cl, on = has(gid);
      await assign(gid, ids, on ? 'remove' : 'add');
      P.forEach((p, i) => { P[i] = paperById(p.id) || p; });
      const tick = !on; b.classList.toggle('on', tick); b.classList.remove('part'); b.querySelector('.ctx-tick').textContent = tick ? '✓' : '';
      return;
    }
    if (b.dataset.cs) { close(); shHas(b.dataset.cs) ? Shares.removePapers(b.dataset.cs, ids) : Shares.addPapers(b.dataset.cs, ids); return; }
    if (b.dataset.cst) {
      close();
      try { const d = await api('/api/papers/bulk', {method: 'POST', body: {ids, changes: {status: b.dataset.cst}}}); d.papers.forEach(upsertPaper); renderAll(); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const c = b.dataset.c; if (!c) return;
    close();
    if (c === 'newlabel') { const g = await createGroup(null); if (g) assign(g.id, ids); }
    if (c === 'pdf') quickPdf(id, $(`.row[data-id="${id}"] [data-pdfq]`));
    if (c === 'notes') Notes.open(id);
    if (c === 'details') openDetail(id);
    if (c === 'cite') copyCitation(id);
    if (c === 'export') { openExport(); }
    if (c === 'star') { const v = !P.every(p => p.starred); try { const d = await api('/api/papers/bulk', {method: 'POST', body: {ids, changes: {starred: v}}}); d.papers.forEach(upsertPaper); renderAll(); } catch (err) { toast(err.message, 'error'); } }
    if (c === 'delete') deletePapers(ids);
    if (c === 'delpdf') deletePdfs(ids);
  });
}

/* ------------------------------------------------------------------ the PaperShelf menu (logo) */
async function brandMenu() {
  const menu = $('#brand-menu');
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  const upd = Updates.info && Updates.info.available;
  let installed = true;
  try { installed = !!(await api('/api/app-status')).installed; } catch (e) { /* ignore */ }
  const item = (act, label, small = '') => `<button type="button" data-bm="${act}">${label}${small ? `<small>${small}</small>` : ''}</button>`;
  // only what isn't already one click away in the top bar (⟳, What's new, ?, ⚙︎)
  menu.innerHTML = `<div class="bm-head"><img src="/static/icons/icon-64.png" alt=""><div><b>PaperShelf ${esc(state.version || '')}</b><small>${state.papers.length} papers · ${state.groups.length} labels · ${(state.shares || []).length} groups</small></div></div>
    ${upd ? item('install-update', `⬆ Install PaperShelf ${esc(Updates.info.latest)}`, 'A new version is available') + '<div class="bm-sep"></div>' : ''}
    ${item('shares', '👥 Groups', 'Create a group, join one, invite people')}
    ${item('export', '⤓ Export references or notes', 'All papers, a view, or chosen labels')}
    ${item('stats', '📊 Reading stats')}
    <div class="bm-sep"></div>
    ${installed ? '' : item('app', '⬇ Install PaperShelf as an app', 'Own icon in the Dock / taskbar')}
    ${item('quit', '⏻ Quit PaperShelf', 'Stops it on this computer')}`;
  menu.classList.add('open');
  menu.onclick = async e => {
    const b = e.target.closest('[data-bm]'); if (!b) return;
    menu.classList.remove('open');
    const a = b.dataset.bm;
    if (a === 'update') syncNow();
    if (a === 'install-update' || a === 'check') Updates.open();
    if (a === 'topic') { setTab('discover'); setTimeout(() => (document.querySelector('#t-q') || document.querySelector('[data-topic]'))?.focus?.(), 300); }
    if (a === 'bulk') { if (state.tab !== 'library' || state.area !== 'reading') setTab('reading'); document.querySelector('#more-menu [data-menu=bulk]')?.click(); }
    if (a === 'export') openExport();
    if (a === 'feed') Feed.open();
    if (a === 'stats') Stats.open();
    if (a === 'checklib') { const t = toast('Checking your library…', 'info', 0); Smart.runChecks({force: true}).catch(err => toast(err.message, 'error')).finally(() => t.close()); }
    if (a === 'shares') Shares.startMenu();
    if (a === 'app') { openSettings('general'); }
    if (a === 'settings') openSettings();
    if (a === 'guide') Help.open('start');
    if (a === 'status') Help.open('status');
    if (a === 'quit') quitApp();
  };
}

async function quitApp() {
  const ok = await confirmBox('Quit PaperShelf?', 'PaperShelf stops on this computer. Everything is already saved. Start it again with its icon or with start.command / start.bat.', {ok: 'Quit'});
  if (!ok) return;
  try { await api('/api/quit', {method: 'POST'}); }
  catch (err) { toast(err.message, 'info', 8000); return; }
  document.body.innerHTML = `<div class="quit-screen"><img src="/static/icons/icon-192.png" alt="" width="96" height="96"><h2>PaperShelf has been closed</h2><p>You can close this window. Start PaperShelf again with its icon or with start.command / start.bat.</p></div>`;
  setTimeout(() => { try { window.close(); } catch (e) { /* not allowed */ } }, 600);
}

/* ------------------------------------------------------------------ SCImago tables imported by hand */
function compactYears(ys) {
  const a = [...ys].sort((x, y) => x - y); const out = [];
  for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j; }
  return out.join(', ');
}
async function importSjrFiles(files) {
  if (!files.length) return null;
  const fd = new FormData(); files.forEach(f => fd.append('file', f));
  if (files.length === 1 && !/(19|20)\d\d/.test(files[0].name)) {
    const y = await askText('Which year is this table?', {label: 'The year is not in the file name.', placeholder: 'e.g. 2024', ok: 'Import'});
    if (!y) return null; fd.append('year', y);
  }
  try {
    const d = await api('/api/sjr/import', {method: 'POST', form: fd});
    toast(`Imported ${d.imported.map(x => x.year).join(', ')} (${d.imported.reduce((n, x) => n + x.journals, 0).toLocaleString()} journal rows).${d.problems.length ? ' ' + d.problems.join(' ') : ''}`, d.problems.length ? 'info' : 'ok', 9000);
    return d;
  } catch (err) { toast(err.message, 'error', 12000); return null; }
}

/* ------------------------------------------------------------------ library access */
function proxyRow(x) {
  return `<div class="proxy-row" data-id="${esc(x.id || '')}"><input class="input px-name" placeholder="Name, e.g. My University" value="${esc(x.name)}">
    <input class="input px-tpl" placeholder="https://ezproxy.uni.edu/login?url=" value="${esc(x.template)}">
    <button class="btn small" data-pxtest title="Open a subscription-only article through this library">Test</button><button class="btn small" data-pxdel title="Remove">✕</button></div>`;
}
function proxiedUrl(tpl, p) {
  const target = p.doi ? `https://doi.org/${p.doi}` : p.url;
  if (tpl.includes('{doi}') && p.doi) return tpl.replace('{doi}', encodeURIComponent(p.doi));
  if (tpl.includes('{url}')) return tpl.replace('{url}', encodeURIComponent(target));
  return tpl + target;
}
async function openForLogin(id) {
  const p = paperById(id);
  const link = p.doi ? `https://doi.org/${p.doi}` : p.url;
  if (!link) { toast('This paper has no DOI or link to open.', 'error'); return; }
  window.open(link, '_blank', 'noopener');
  try { await api(`/api/papers/${id}/await`, {method: 'POST'}); } catch (e) { /* ignore */ }
  toast('On the publisher page choose “Access through your institution” / “Log in via your university”, sign in, and download the PDF – PaperShelf will attach it automatically.', 'info', 15000);
  schedulePoll(1500);
}
async function getVia(id, proxyId) {
  const p = paperById(id);
  const px = (state.settings.proxies || []).find(x => x.id === proxyId) || (state.settings.proxies || [])[0];
  if (!px || !(p.doi || p.url)) { toast('This paper has no DOI or link to open.', 'error'); return; }
  window.open(proxiedUrl(px.template, p), '_blank', 'noopener');
  try { await api(`/api/papers/${id}/await`, {method: 'POST'}); } catch (e) { /* ignore */ }
  toast(`Opened through ${px.name}. Log in if asked, then download the PDF – PaperShelf will attach it automatically.`, 'info', 12000);
  schedulePoll(1500);
}
let lastEvent = 0, pollTimer = null, warnedFolder = false;
function schedulePoll(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(pollEvents, ms); }
async function pollEvents() {
  let next = 15000;
  try {
    const d = await api(`/api/events?after=${lastEvent}`);
    for (const e of d.events) { lastEvent = Math.max(lastEvent, e.id); handleEvent(e); }
    if (d.error && d.watching && !warnedFolder) {
      warnedFolder = true;
      toast(`PaperShelf can't read your Downloads folder. On a Mac: System Settings → Privacy & Security → Files and Folders → allow Terminal to access “Downloads”. (${d.error})`, 'error', 15000);
    }
    if (d.watching) next = 3000;
  } catch (e) { /* server stopped */ }
  schedulePoll(next);
}
async function handleEvent(e) {
  if (e.type === 'attached') {
    await loadLibrary().catch(() => {});
    toast(`📎 PDF attached to “${truncate(e.title, 70)}” (${e.file}).`, 'ok', 8000);
  } else if (e.type === 'unmatched' && e.candidates?.length) {
    const m = modal(`<h3>New PDF in your Downloads</h3><p class="muted"><b>${esc(e.file)}</b> doesn't contain a DOI PaperShelf recognises. Is it one of these?</p>
      ${e.candidates.map(c => `<button class="btn" style="display:block;width:100%;text-align:left;margin-bottom:6px" data-attach="${c.id}">📎 ${esc(truncate(c.title, 110))}</button>`).join('')}
      <div class="modal-actions"><button class="btn" data-close>No, ignore it</button></div>`);
    $$('[data-attach]', m.el).forEach(b => b.onclick = async () => {
      try { const d = await api('/api/watcher/attach', {method: 'POST', body: {path: e.path, paper_id: +b.dataset.attach}}); upsertPaper(d.paper); renderAll(); m.close(); toast('PDF attached.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    });
  }
}
function setTab(tab, {keepView = false} = {}) {
  if (tab === 'reading' || tab === 'library' || tab === 'discover') {
    // each button shows its whole page (no label or keyword selected) – Discover can keep the label you were looking at
    const area = tab === 'reading' ? 'reading' : 'library';
    const keep = keepView && area === state.area && ['group', 'all'].includes(state.view.type);
    state.area = area; state.selected.clear(); state.keyword = null; state.lastIndex = null;
    if (!keep) state.view = homeView();
    if (tab === 'discover') state.mode = 'discover';
    else if (tab === 'reading' || state.mode === 'discover') state.mode = 'list';
    state.tab = 'library';
  } else state.tab = tab;
  savePrefs();
  document.body.classList.toggle('tab-people', state.tab === 'people');
  document.body.classList.toggle('area-reading', state.tab !== 'people' && state.area === 'reading');
  document.body.classList.toggle('tab-discover', isDiscover());
  const on = state.tab === 'people' ? 'people' : isDiscover() ? 'discover' : state.area;
  $$('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === on));
  document.body.classList.remove('side-open'); Side.apply();
  if (state.tab === 'people') { Graph.stop(); People.show(); } else { closeDetail(); renderAll(); renderMode(true); }
}

/* ------------------------------------------------------------------ styles, sync, citations */
async function setDefaultStyle(style) {
  try { const d = await api('/api/settings', {method: 'PUT', body: {default_style: style}}); state.settings = d.settings; }
  catch (err) { toast(err.message, 'error'); }
}

function updateSyncButton() {
  const b = $('#sync-btn'); const s = state.settings;
  b.style.display = '';
  const what = [s.sync_repo ? 'sync your library with your other computers' : '', (state.shares || []).length ? 'update your groups' : '', 'check for a new version of PaperShelf'].filter(Boolean);
  b.title = (s.last_sync_error ? `⚠ Last library sync failed: ${s.last_sync_error}\n` : '') + 'Update now: ' + what.join(', ') +
    (s.last_sync ? `\n(last library sync: ${new Date(s.last_sync).toLocaleString()})` : '');
  b.classList.toggle('warn', !!s.last_sync_error);
}
let syncing = false;
async function syncNow() {
  // one button for everything: your library on your other computers, shared labels & notes, new app versions
  if (syncing) return;
  syncing = true; const b = $('#sync-btn'); b.classList.add('spinning');
  const t = toast('Updating…', 'info', 0);
  const done = [], problems = []; let newVersion = null;
  if (state.settings.sync_repo) {
    t.set('Syncing your library with your other computers…');
    try {
      const d = await api('/api/sync', {method: 'POST'});
      state.settings = d.settings; const st = d.stats;
      const bits = [st.added && `${st.added} new`, st.updated && `${st.updated} updated`, st.removed && `${st.removed} removed`,
        st.pdfs_down && `${st.pdfs_down} PDFs received`, st.pdfs_up && `${st.pdfs_up} PDFs sent`].filter(Boolean);
      done.push(`library synced${bits.length ? ' (' + bits.join(', ') + ')' : ''}`);
    } catch (err) {
      problems.push('library sync: ' + err.message);
      try { const d = await api('/api/settings'); state.settings = d.settings; } catch (e) { /* ignore */ }
    }
  }
  if ((state.shares || []).length) {
    t.set('Updating groups…');
    try {
      const d = await api('/api/shares/sync', {method: 'POST', body: {}});
      const L = Object.values(d.result.lists || {});
      const added = L.reduce((n, r) => n + (r.added || 0), 0);
      done.push(`groups updated${added ? ` (${added} new paper${added > 1 ? 's' : ''})` : ''}`);
      if (L.some(r => r.error || (r.errors || []).length)) problems.push('some people in a group could not be read (see the group)');
    } catch (err) { problems.push('groups: ' + err.message); }
  }
  const fd = Feed.data;
  if (!fd || fd.followed.some(f => !f.muted) || fd.topics.length) {
    t.set('Looking for new papers by the researchers you follow…');
    try { const d = await Feed.check({quiet: true}); if (d && d.new) done.push(`${d.new} new paper${d.new > 1 ? 's' : ''} in What's new`); }
    catch (err) { problems.push("What's new: " + err.message); }
  }
  if (state.settings.lib_check !== '') {
    t.set('Checking your library (retractions, published versions)…');
    try { const d = await Smart.runChecks({quiet: true}); if (d.summary && d.summary.length) done.push(...d.summary); }
    catch (err) { problems.push('library check: ' + err.message); }
  }
  t.set('Checking for a new version of PaperShelf…');
  try { const d = await Updates.check({force: true}); if (d.available) newVersion = d; else if (d.configured !== false) done.push(`PaperShelf ${d.current} is the latest version`); }
  catch (err) { problems.push('update check: ' + err.message); }
  t.close();
  try { await loadLibrary(); } catch (e) { /* ignore */ }
  syncing = false; b.classList.remove('spinning'); updateSyncButton();
  if (done.length) toast('✓ ' + done.join(' · ') + '.', 'ok', 7000);
  if (problems.length) toast('⚠ ' + problems.join(' · '), 'error', 12000);
  if (newVersion) Updates.open();
}

function citationSection(p) {
  if (!p.openalex_id) {
    return `<div class="fld"><span>Citation network</span><div class="net-box muted">${p.doi || p.arxiv_id
      ? `No citation data yet. <button class="btn small" data-act="getcites">Get citation data</button>`
      : 'Needs a DOI or arXiv ID to look up citations.'}</div></div>`;
  }
  const byOa = new Map(state.papers.filter(x => x.openalex_id).map(x => [x.openalex_id, x]));
  const cites = (p.refs || []).map(r => byOa.get(r)).filter(Boolean);
  const citedBy = state.papers.filter(x => x.id !== p.id && (x.refs || []).includes(p.openalex_id));
  const li = arr => arr.slice(0, 12).map(x => `<li><button class="linklike" data-open="${x.id}">${esc(truncate(x.title, 90))}</button> <span class="muted">${esc(shortAuthors(x))} ${x.year || ''}</span></li>`).join('') + (arr.length > 12 ? `<li class="muted">…and ${arr.length - 12} more</li>` : '');
  return `<div class="fld"><span>Citation network</span><div class="net-box">
    <div>Cited <b>${(p.cited_by_count ?? 0).toLocaleString()}</b> times overall · cites <b>${(p.refs || []).length}</b> works</div>
    ${cites.length ? `<div class="net-sub">Cites ${cites.length} paper${cites.length > 1 ? 's' : ''} in your library:</div><ul>${li(cites)}</ul>` : ''}
    ${citedBy.length ? `<div class="net-sub">Cited by ${citedBy.length} paper${citedBy.length > 1 ? 's' : ''} in your library:</div><ul>${li(citedBy)}</ul>` : ''}
    ${!cites.length && !citedBy.length ? '<div class="muted">Not connected to other papers in your library yet.</div>' : ''}
  </div></div>`;
}

async function fetchCitations(ids, {quiet = false} = {}) {
  let ok = 0; const t = ids.length > 1 ? toast(`Getting citation data… 0/${ids.length}`, 'info', 0) : null;
  for (const [i, id] of ids.entries()) {
    t?.set(`Getting citation data… ${i + 1}/${ids.length}`);
    try { const d = await api(`/api/papers/${id}/citations`, {method: 'POST'}); upsertPaper(d.paper); ok++; }
    catch (err) { if (err.data?.paper) upsertPaper(err.data.paper); if (ids.length === 1 && !quiet) toast(err.message, 'error'); }
  }
  t?.close(); renderAll();
  if (ids.length > 1 && !quiet) toast(`Citation data found for ${ok} of ${ids.length} papers.`, ok ? 'ok' : 'info');
  return ok;
}

async function highlightsToNotes(id, shareId = null) {
  try {
    const d = await api(`/api/papers/${id}/annotations`);
    if (!d.annotations.length) { toast('No highlights yet.'); return; }
    if (shareId === null) {  // paper in a shared label: ask where the note goes
      const T = await Notes.targets(id);
      shareId = T.length > 1 ? await chooseNoteTarget(T, 'Copy the highlights into a note') : '';
      if (shareId === null) return;
    }
    const block = '### Highlights\n' + d.annotations.map(a => `- **p. ${a.page}**: ==${a.text.trim().replace(/\s+/g, ' ')}==${a.note ? ` → ${a.note}` : ''}`).join('\n');
    const r = await Notes.add(id, block, shareId);
    if (r) toast(shareId ? 'Highlights added as a public note – the group will see it.' : 'Highlights copied into a private note.', 'ok', 6000);
  } catch (err) { toast(err.message, 'error'); }
}
function chooseNoteTarget(T, title) {
  return new Promise(resolve => {
    const m = modal(`<h3>${esc(title)}</h3><p class="muted small">This paper is in a group: the note can stay private or be seen by the group.</p>
      <div class="note-targets">${T.map(t => `<button class="share-opt" data-t="${esc(t.v)}"><b>${esc(t.label)}</b><small>${t.v ? 'All members see it, with your name' : 'Only in your library'}</small></button>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button></div>`);
    let res = null; m.onclose = () => resolve(res);
    m.el.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { res = b.dataset.t; m.close(); } });
  });
}

/* ------------------------------------------------------------------ modes */
function renderMode(scopeChanged = false) {
  $('#mode-seg').style.display = state.area === 'reading' || state.mode === 'discover' ? 'none' : '';   // the reading list is just the list; Discover is a page of its own
  if (state.area === 'reading') state.mode = 'list';
  $$('#mode-seg [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  $('#list').style.display = state.mode === 'list' ? '' : 'none';
  $('#list-toolbar').style.display = state.mode === 'list' ? '' : 'none';
  $('#map-view').style.display = state.mode === 'map' ? 'flex' : 'none';
  $('#discover-view').style.display = state.mode === 'discover' ? 'block' : 'none';
  $('#review-view').style.display = state.mode === 'table' ? 'block' : 'none';
  if (state.mode === 'table') Review.render();
  if (state.mode === 'map') Graph.render(filteredPapers(), scopeChanged);
  else Graph.stop();
  if (state.mode === 'discover') Discover.render(scopeChanged);
}
function setMode(mode) { state.mode = mode; savePrefs(); renderMode(true); }

/* ------------------------------------------------------------------ events */
function bind() {
  // Add bar
  $('#add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#add-input'); const v = inp.value.trim(); if (!v) { inp.focus(); return; }
    if (typeof Suggest !== 'undefined') Suggest.close();
    const btn = $('#add-btn'); setBusy(btn, true, 'Looking up…');
    try {
      const d = await addOne(v); inp.value = '';
      upsertPaper(d.paper); renderAll(); openDetail(d.paper.id);
      const g = currentGroupId() ? ` → ${groupPath(currentGroupId())}` : '';
      toast(d.duplicate ? 'Already in your library – opened it.' : `Added: ${truncate(d.paper.title, 80)}${g}`, d.duplicate ? 'info' : 'ok');
    } catch (err) {
      if (err.data?.nomatch && typeof Suggest !== 'undefined') { inp.focus(); Suggest.show(v, {fromError: true}); }
      else toast(err.message, 'error', 9000);
    }
    finally { setBusy(btn, false); }
  });
  $('#add-input').addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 1) { e.preventDefault(); openBulkAdd(lines.join('\n')); }
  });
  $('#brand-btn').addEventListener('click', e => { e.stopPropagation(); $('#more-menu').classList.remove('open'); brandMenu(); });
  document.addEventListener('click', e => { if (!e.target.closest('#brand-menu')) $('#brand-menu').classList.remove('open'); });
  $('#more-btn').addEventListener('click', e => { e.stopPropagation(); $('#more-menu').classList.toggle('open'); });
  document.addEventListener('click', () => $('#more-menu').classList.remove('open'));
  $('#more-menu').addEventListener('click', async e => {
    const b = e.target.closest('[data-menu]'); if (!b) return;
    $('#more-menu').classList.remove('open');
    if (b.dataset.menu === 'bulk') openBulkAdd();
    if (b.dataset.menu === 'import') { $('#import-input').value = ''; $('#import-input').click(); }
    if (b.dataset.menu === 'manual') {
      try { const d = await api('/api/papers', {method: 'POST', body: {manual: {title: 'Untitled paper'}, group_id: currentGroupId()}});
        upsertPaper(d.paper); renderAll(); openDetail(d.paper.id); setTimeout(() => { const t = $('#detail-body textarea[data-f=title]'); t?.focus(); t?.select(); }, 60);
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  $('#import-input').addEventListener('change', e => importPdfs(e.target.files));
  $('#attach-input').addEventListener('change', e => { if (e.target.files[0] && attachFor) uploadAttach(attachFor, e.target.files[0]); });

  // Search & sort
  let st = null;
  $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { state.search = e.target.value.trim(); renderList(); renderKeywords(); searchPdfs(); }, 120); });
  $('#sort').innerHTML = Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('');
  $('#sort').value = state.sort;
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; savePrefs(); renderList(); });
  $('#details-toggle').addEventListener('change', e => { state.details = e.target.checked; savePrefs(); renderList(); });
  $('#arr-sel').addEventListener('change', e => {
    const v = e.target.value;
    state.arrange = {...(state.arrange || {}), [state.area]: v === 'list' ? 'list' : 'groups'};
    if (v !== 'list') state.grpMode = v;
    savePrefs(); renderList();
  });
  // moving a group: drag its title onto another group of the same level
  let grpDrag = null;
  const grpSiblings = head => [...head.parentElement.parentElement.children].filter(el => el.classList.contains('grp')).map(el => el.querySelector(':scope > .grp-head'));
  $('#list').addEventListener('dragstart', e => {
    const h = e.target.closest('.grp-head'); if (!h) return;
    grpDrag = h; e.dataTransfer.setData('text/plain', h.dataset.grp); e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation(); h.parentElement.classList.add('grp-dragging');
  });
  $('#list').addEventListener('dragover', e => {
    if (!grpDrag) return;
    const sib = grpSiblings(grpDrag);
    let g = e.target.closest('.grp'), h = null;
    while (g) { const hh = g.querySelector(':scope > .grp-head'); if (sib.includes(hh)) { h = hh; break; } g = g.parentElement.closest('.grp'); }
    $$('#list .grp-drop-before, #list .grp-drop-after').forEach(x => x.classList.remove('grp-drop-before', 'grp-drop-after'));
    if (!h || h === grpDrag) return;
    e.preventDefault();
    const r = h.parentElement.getBoundingClientRect();
    h.parentElement.classList.add(e.clientY < r.top + Math.min(r.height / 2, 40) ? 'grp-drop-before' : 'grp-drop-after');
  });
  $('#list').addEventListener('drop', e => {
    if (!grpDrag) return;
    const target = $('#list .grp-drop-before, #list .grp-drop-after'); e.preventDefault();
    if (target) {
      const before = target.classList.contains('grp-drop-before');
      const keys = grpSiblings(grpDrag).map(h => h.dataset.grp).filter(k => k !== grpDrag.dataset.grp);
      const t = target.querySelector(':scope > .grp-head').dataset.grp;
      keys.splice(keys.indexOf(t) + (before ? 0 : 1), 0, grpDrag.dataset.grp);
      state.grpRank = {...(state.grpRank || {})}; keys.forEach((k, i) => { state.grpRank[k] = i; });
      savePrefs();
    }
    grpDrag = null; renderList();
  });
  $('#list').addEventListener('dragend', () => { if (grpDrag) { grpDrag = null; renderList(); } });
  $('#list').addEventListener('click', e => {
    if (e.target.closest('[data-grp-reset]')) { state.grpRank = {}; savePrefs(); renderList(); return; }
    const h = e.target.closest('[data-grp]');
    if (h) { const k = h.dataset.grp; state.grpClosed.has(k) ? state.grpClosed.delete(k) : state.grpClosed.add(k); savePrefs(); renderList(); return; }
    const a = e.target.closest('[data-grp-all]');
    if (a) { const keys = $$('#list [data-grp]').map(x => x.dataset.grp); if (a.dataset.grpAll === 'close') keys.forEach(k => state.grpClosed.add(k)); else { keys.forEach(k => state.grpClosed.delete(k)); state.grpClosed.clear(); } savePrefs(); renderList(); }
  });
  // clicking anywhere outside the details panel closes it (rows open another paper instead)
  document.addEventListener('click', e => {
    if (!state.openId || !e.isTrusted) return;
    const t = e.target;
    if (t.closest('#detail, .row, .modal-wrap, .toast, .color-pop, .menu, #toasts, .reader, #reader, .help-panel, #help')) return;
    if (topModal() || Reader.isOpen() || Help.isOpen()) return;
    closeDetail();
  }, true);
  $('#incl-sub').addEventListener('change', e => { state.includeSub = e.target.checked; savePrefs(); renderAll(); });
  $('#filters').addEventListener('click', async e => {
    const c = e.target.closest('[data-clear]');
    if (c?.dataset.clear === 'kw') { state.keyword = null; renderList(); renderKeywords(); }
    if (c?.dataset.clear === 'search') { state.search = ''; $('#search').value = ''; state.ftHits = {}; renderList(); renderKeywords(); }
    if (e.target.id === 'kw-to-group') {
      const ids = state.visible.slice(); const label = paperById(ids[0])?.keywords.find(k => k.toLowerCase() === state.keyword) || state.keyword;
      const name = await askText('New label from keyword', {value: label, ok: 'Create', label: `Creates a label${currentGroupId() ? ' inside the current one' : ''} for the ${ids.length} papers shown.`});
      if (!name) return;
      const g = await createGroup(currentGroupId(), name);
      if (g) await assign(g.id, ids);
    }
  });

  // Sidebar
  $('#sidebar').addEventListener('click', e => {
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const id = +tog.dataset.toggle; state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id); savePrefs(); renderSidebar(); return; }
    const act = e.target.closest('[data-gact]');
    if (act) { const id = +act.dataset.id; ({sub: () => createGroup(id), rename: () => renameGroup(id), delete: () => deleteGroup(id),
      color: () => pickColor(act, state.groups.find(g => g.id === id)?.color || '', c => setGroupColor(id, c))})[act.dataset.gact](); return; }
    const kw = e.target.closest('[data-kw]');
    if (kw) { state.keyword = state.keyword === kw.dataset.kw ? null : kw.dataset.kw; state.selected.clear(); renderList(); renderKeywords(); return; }
    if (e.target.closest('[data-navmore]')) { state.navMore = !state.navMore; savePrefs(); renderSidebar(); return; }
    const sec = e.target.closest('[data-sec]');
    if (sec) { const k = sec.dataset.sec; state.closed.has(k) ? state.closed.delete(k) : state.closed.add(k); savePrefs(); renderSidebar(); return; }
    if (e.target.closest('[data-kwtoggle]')) { state.kwOpen = state.kwOpen === false; savePrefs(); renderKeywords(); return; }
    if (e.target.closest('[data-kwall]')) { state.kwAll = !state.kwAll; renderKeywords(); return; }
    if (e.target.closest('#kw-manage')) { manageKeywords(); return; }
    const nav = e.target.closest('[data-view]');
    if (nav) { const [type, value] = nav.dataset.view.split(':'); setView(value ? {type, value} : {type}); return; }
    const grp = e.target.closest('[data-group]');   // a click on the selected label deselects it
    if (grp) { const id = +grp.dataset.group; setView(state.view.type === 'group' && state.view.id === id ? homeView() : {type: 'group', id}); }
    const sh = e.target.closest('[data-share]');
    if (sh && !e.target.closest('button')) setView(state.view.type === 'share' && state.view.id === sh.dataset.share ? homeView() : {type: 'share', id: sh.dataset.share});
  });
  $('#sidebar').addEventListener('input', e => {
    if (e.target.id !== 'kw-filter') return;
    state.kwFilter = e.target.value; const pos = e.target.selectionStart;
    renderKeywords(); const f = $('#kw-filter'); if (f) { f.focus(); f.setSelectionRange(pos, pos); }
  });
  $('#sidebar').addEventListener('dblclick', e => { const grp = e.target.closest('[data-group]'); if (grp && !e.target.closest('button')) renameGroup(+grp.dataset.group); });
  $('#new-group').addEventListener('click', e => { e.stopPropagation(); createGroup(null); });

  // Drag & drop: papers -> groups, groups -> groups
  let dragKind = null;
  document.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.row');
    const grp = e.target.closest?.('.group-item');
    if (row) {
      const id = +row.dataset.id;
      const ids = state.selected.has(id) ? [...state.selected] : [id];
      dragKind = 'papers'; e.dataTransfer.setData('text/plain', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copyMove';
      // a small label instead of the whole row, so you can see where you drop it
      const gh = document.createElement('div'); gh.className = 'drag-ghost';
      gh.textContent = ids.length > 1 ? `📄 ${ids.length} papers` : `📄 ${truncate(paperById(id)?.title || 'Paper', 42)}`;
      document.body.appendChild(gh); e.dataTransfer.setDragImage(gh, 14, 14); setTimeout(() => gh.remove(), 0);
    } else if (grp) {
      dragKind = 'group'; e.dataTransfer.setData('text/plain', grp.dataset.group); e.dataTransfer.effectAllowed = 'move';
    }
  });
  document.addEventListener('dragend', () => { dragKind = null; $$('.drop').forEach(x => x.classList.remove('drop')); Side.close(600); });
  // sidebar that hides by itself
  document.addEventListener('click', e => { if (e.target.closest('[data-sidepin], #side-toggle, #people-side-toggle')) { e.stopPropagation(); Side.toggle(); } }, true);  // ☰ / 📌: always open or hides by itself
  $('#side-hot').addEventListener('mouseenter', () => Side.open());
  $('#side-hot').addEventListener('dragenter', () => Side.open());
  document.addEventListener('mousemove', e => {  // moving away from the open sidebar hides it again
    if (!dragKind && e.clientX > 300 && document.body.classList.contains('side-open') && !Side.timer2) {
      Side.timer2 = setTimeout(() => { Side.timer2 = null; }, 120); Side.close(250);
    }
  }, {passive: true});
  for (const sel of ['#sidebar', '#people-side']) {
    $(sel).addEventListener('mouseenter', () => clearTimeout(Side.timer));
    $(sel).addEventListener('mouseleave', () => { if (!dragKind) Side.close(); });
  }
  $('#people-side').addEventListener('click', e => { if (e.target.closest('[data-pid]')) Side.close(150); });
  $('#sidebar').addEventListener('dragenter', () => clearTimeout(Side.timer));
  $('#sidebar').addEventListener('click', e => {  // choosing a list or label closes the auto-hiding sidebar
    if (e.target.closest('button, .caret, [data-sec], [data-kwtoggle], [data-navmore], input')) return;
    if (e.target.closest('[data-view], [data-group], [data-share]')) Side.close(150);
  });
  $('#list').addEventListener('contextmenu', e => { const row = e.target.closest('.row'); if (row) rowMenu(e, +row.dataset.id); });
  $('#sidebar').addEventListener('dragover', e => {
    if (!dragKind) return;
    const target = e.target.closest('.group-item') || (dragKind === 'papers' ? e.target.closest('.share-item.editable') : null)
      || (dragKind === 'group' ? e.target.closest('#labels-head') : null);
    $$('.drop').forEach(x => x !== target && x.classList.remove('drop'));
    if (target) { e.preventDefault(); target.classList.add('drop'); }
  });
  $('#sidebar').addEventListener('drop', e => {
    const target = e.target.closest('.group-item') || e.target.closest('#labels-head') || e.target.closest('.share-item.editable');
    $$('.drop').forEach(x => x.classList.remove('drop'));
    if (!target || !dragKind) return;
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (dragKind === 'papers' && target.dataset.share) { Shares.addPapers(target.dataset.share, JSON.parse(data)); dragKind = null; return; }
    if (dragKind === 'papers' && target.dataset.group) assign(+target.dataset.group, JSON.parse(data));
    if (dragKind === 'group') moveGroup(+data, target.dataset.group ? +target.dataset.group : null);
    dragKind = null;
  });

  // Files dropped on the window -> import
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#drop-overlay').classList.add('show'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.remove('show'); } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#drop-overlay').classList.remove('show');
    const row = e.target.closest?.('#detail') && state.openId;
    if (row && e.dataTransfer.files.length === 1) uploadAttach(state.openId, e.dataTransfer.files[0]);
    else importPdfs(e.dataTransfer.files);
  });

  // List
  $('#list').addEventListener('click', e => {
    if (e.target.closest('[data-stale-review]')) { Smart.staleReview(); return; }
    if (e.target.closest('[data-stale-hide]')) { try { localStorage.setItem('papershelf-stale-hidden', Date.now()); } catch (err) { /* ignore */ } renderList(); return; }
    const row = e.target.closest('.row'); if (!row) return;
    const id = +row.dataset.id; const p = paperById(id);
    if (e.target.closest('[data-alert]')) { openDetail(id); return; }
    if (e.target.closest('.star')) { savePaper(id, {starred: !p.starred}); return; }
    if (e.target.closest('[data-notes]')) { Notes.open(id); return; }
    if (e.target.closest('[data-pdfdel]')) { deletePdfs([id]); return; }
    const pq = e.target.closest('[data-pdfq]'); if (pq) { quickPdf(id, pq); return; }
    if (e.target.closest('[data-done]')) { savePaper(id, {status: 'read'}).then(pp => { if (pp) toast(`Marked as read: ${truncate(pp.title, 60)} – it is in the Library.`, 'ok'); }); return; }
    const chip = e.target.closest('[data-kw]');
    if (chip) { state.keyword = chip.dataset.kw; renderList(); renderKeywords(); return; }
    const gchip = e.target.closest('[data-goto]');
    if (gchip) { setView({type: 'group', id: +gchip.dataset.goto}); return; }
    const ftp = e.target.closest('[data-ftpage]');
    if (ftp) { Reader.open(id, +ftp.dataset.ftpage); return; }
    const schip = e.target.closest('[data-goto-share]');
    if (schip) { setView({type: 'share', id: schip.dataset.gotoShare}); return; }
    const idx = state.visible.indexOf(id);
    if (e.target.classList.contains('sel') || e.metaKey || e.ctrlKey || e.shiftKey) {
      if (e.shiftKey && state.lastIndex !== null) {
        const [a, b] = [state.lastIndex, idx].sort((x, y) => x - y);
        state.visible.slice(a, b + 1).forEach(i => state.selected.add(i));
      } else {
        state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      }
      state.lastIndex = idx; renderList(); return;
    }
    state.lastIndex = idx; openDetail(id);
  });
  document.addEventListener('click', e => { if (e.target.closest('[data-goto-library]')) { e.preventDefault(); setTab('library'); } });
  document.addEventListener('click', e => { if (e.target.closest('[data-focus-add]')) { e.preventDefault(); if (state.area !== 'reading' || state.tab !== 'library') setTab('reading'); $('#add-input').focus(); } });
  $('#view-sub').addEventListener('click', e => { if (e.target.closest('[data-gaps]')) setTab('discover', {keepView: true}); });
  $('#view-title').addEventListener('click', e => { if (e.target.closest('[data-view-clear]')) setView(homeView()); });
  $('#select-all').addEventListener('change', e => {
    if (e.target.checked) state.visible.forEach(id => state.selected.add(id)); else state.selected.clear();
    renderList();
  });
  $('#bulk-group').addEventListener('change', async e => {
    const v = e.target.value; e.target.value = '';
    const ids = [...state.selected];
    if (v === '__new') { const g = await createGroup(null); if (g) assign(g.id, ids); }
    else if (v) assign(+v, ids);
  });
  $('#bulk-remove').addEventListener('click', () => state.view.type === 'share'
    ? Shares.removePapers(state.view.id, [...state.selected]) : assign(state.view.id, [...state.selected], 'remove'));
  $('#bulk-share').addEventListener('change', e => { const v = e.target.value; e.target.value = ''; if (v) Shares.bulk(v, [...state.selected]); });
  $('#bulk-status').addEventListener('change', async e => {
    const status = e.target.value; e.target.value = ''; if (!status) return;
    try { const d = await api('/api/papers/bulk', {method: 'POST', body: {ids: [...state.selected], changes: {status}}}); d.papers.forEach(upsertPaper); renderAll(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#bulk-pdf').addEventListener('click', () => bulkFindPdf([...state.selected]));
  $('#bulk-delpdf').addEventListener('click', () => deletePdfs([...state.selected]));
  $('#bulk-delete').addEventListener('click', () => deletePapers([...state.selected]));
  $('#bulk-notes').addEventListener('click', () => Notes.exportDialog([...state.selected]));
  $('#export-btn').addEventListener('click', openExport);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#sync-btn').addEventListener('click', syncNow);
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('#mode-seg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

  // Detail panel
  $('#close-detail').addEventListener('click', closeDetail);
  const body = $('#detail-body');
  body.addEventListener('change', e => {
    const id = state.openId; if (!id) return;
    if (e.target.id === 'cite-style') { setDefaultStyle(e.target.value).then(() => loadCitation(id)); return; }
    const gc = e.target.dataset.gcheck;
    if (gc) { const ids = $$('[data-gcheck]', body).filter(x => x.checked).map(x => +x.dataset.gcheck); savePaper(id, {group_ids: ids}, {rerender: false}); return; }
    const f = e.target.dataset.f; if (!f) return;
    let v = e.target.value;
    if (f === 'authors') v = parseAuthors(v);
    if (f === 'year') v = parseInt(v, 10) || null;
    savePaper(id, {[f]: v}, {rerender: false});
  });
  body.addEventListener('keydown', e => {
    if (e.target.id === 'kw-input' && e.key === 'Enter') {
      e.preventDefault();
      const words = e.target.value.split(/[;,]/).map(s => s.trim()).filter(Boolean); if (!words.length) return;
      const p = paperById(state.openId); const have = new Set(p.keywords.map(k => k.toLowerCase()));
      savePaper(p.id, {keywords: [...p.keywords, ...words.filter(w => !have.has(w.toLowerCase()))]}).then(() => $('#kw-input')?.focus());
    }
  });
  body.addEventListener('click', async e => {
    const id = state.openId; if (!id) return;
    const p = paperById(id);
    const jump = e.target.closest('[data-open]');
    if (jump) { openDetail(+jump.dataset.open); return; }
    const del = e.target.closest('[data-kwdel]');
    if (del) { const kws = p.keywords.filter((_, i) => i !== +del.dataset.kwdel); savePaper(id, {keywords: kws}); return; }
    const s = e.target.closest('[data-status]');
    if (s) { savePaper(id, {status: s.dataset.status}); return; }
    const ls = e.target.closest('[data-lsugg]');
    if (ls) { savePaper(id, {group_ids: [...p.group_ids, +ls.dataset.lsugg]}).then(pp => { if (pp) toast(`Label added: ${groupPath(+ls.dataset.lsugg)}`, 'ok'); }); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (await Smart.detailAct(act, p)) return;
    if (act === 'findpdf') { setBusy(a, true, 'Searching…'); await findPdf(id); setBusy(a, false); }
    if (act === 'attach') pickAttach(id);
    if (act === 'openapp' || act === 'reveal') api(`/api/papers/${id}/open`, {method: 'POST', body: {reveal: act === 'reveal'}}).catch(err => toast(err.message, 'error'));
    if (act === 'copy') copyCitation(id);
    if (act === 'refresh') refreshMeta(id);
    if (act === 'star') savePaper(id, {starred: !p.starred});
    if (act === 'delete') deletePapers([id]);
    if (act === 'read') Reader.open(id);
    if (act === 'viaproxy') getVia(id, a.dataset.proxy);
    if (act === 'institution') openForLogin(id);
    if (act === 'getcites') { setBusy(a, true, 'Fetching…'); await fetchCitations([id]); setBusy(a, false); }
    if (act === 'hl-notes') highlightsToNotes(id);
    if (act === 'notes') Notes.open(id);
    if (act === 'delpdf') { deletePdfs([id]); return; }
    if (act === 'detach') { const ok = await confirmBox('Unlink the PDF?', 'The file stays in your PDF folder; it just won’t be linked to this paper anymore.', {ok: 'Unlink'}); if (ok) savePaper(id, {pdf_path: ''}); }
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      const m = topModal();
      if (Help.isOpen()) { Help.close(); return; }
      if (!m && Reader.isOpen()) { Reader.close(); return; }
      if (m) { m.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); return; }
      if (typing) { document.activeElement.blur(); return; }
      if (state.openId) closeDetail(); else if (state.selected.size) { state.selected.clear(); renderList(); }
    }
    if (typing || topModal() || Reader.isOpen() || Help.isOpen() || state.tab === 'people') return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'n') { e.preventDefault(); if (state.area !== 'reading') setTab('reading'); $('#add-input').focus(); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selected.size) deletePapers([...state.selected]);
  });

  // Refresh when coming back to the tab (e.g. after using the browser button)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLibrary().catch(() => {}); });
}

function handleHash() {
  if (!location.hash) return;
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('msg')) toast(h.get('msg'), 'ok', 7000);
  if (h.get('error')) toast(h.get('error'), 'error', 12000);
  if (h.has('install-app') && typeof AppInstall !== 'undefined') setTimeout(() => AppInstall.installPage(), 300);
  const pid = parseInt(h.get('paper'), 10);
  if (pid) openDetail(pid);
  const person = parseInt(h.get('person'), 10);
  if (person) { state.tab = 'people'; document.body.classList.add('tab-people'); $$('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === 'people')); savePrefs(); People.openById(person); toast('Google Scholar data imported.', 'ok'); }
  history.replaceState(null, '', location.pathname);
}

// start once every script of the page has loaded (notes.js, shares.js… come after this file)
async function init() {
  loadPrefs(); bind();
  try { await loadLibrary(); } catch (err) { toast(err.message, 'error', 0); }
  const start = state.settings.start_page || 'reading';  // Settings → General → Open PaperShelf on
  setTab(start === 'library' || start === 'people' ? start : 'reading');
  handleHash();
  try { lastEvent = (await api('/api/events?after=999999999')).last_id || 0; } catch (e) { /* ignore */ }
  schedulePoll(3000);
  Help.welcome();

}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

/* ------------------------------------------------------------------ names cut short: full text at once on hover */
(() => {
  let tip = null, host = null;
  const hide = () => { if (host && host.dataset.ttl !== undefined) { host.title = host.dataset.ttl; delete host.dataset.ttl; } host = null; tip?.remove(); tip = null; };
  document.addEventListener('mouseover', e => {
    const el = e.target.closest?.('[title]');
    if (!el || el === host || !el.title || el.closest('button, .btn') && !el.matches('.hb-l, .label, .pi-sub, .ho-title')) return;
    const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2;
    if (!cut) return;
    hide();
    host = el; el.dataset.ttl = el.title; el.title = '';
    tip = document.createElement('div'); tip.className = 'tip-pop'; tip.textContent = el.dataset.ttl; document.body.appendChild(tip);
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left - 4))}px`;
    tip.style.top = `${r.bottom + 6 + t.height > window.innerHeight ? r.top - t.height - 6 : r.bottom + 6}px`;
  });
  document.addEventListener('mouseout', e => { if (host && (e.target === host || host.contains(e.target)) && !host.contains(e.relatedTarget)) hide(); });
  document.addEventListener('scroll', hide, true);
})();

/* a narrow list (details panel open, small window): icons only in the view buttons */
document.addEventListener('DOMContentLoaded', () => {
  const m = document.querySelector('main.tab-library-only'); if (!m || !window.ResizeObserver) return;
  new ResizeObserver(() => m.classList.toggle('narrow', m.clientWidth < 760)).observe(m);
});
