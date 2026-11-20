"use strict";
/* PaperShelf – Home (the desk: what to read, what to write, what needs you) and Write (all documents of all groups).
   Both only look at data that is already on this computer; nothing is sent anywhere. */
const Home = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ago = t => {
    if (!t) return '';
    const s = (Date.now() - Date.parse(t)) / 1000; if (!(s >= 0)) return 'just now';
    if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400); return d < 8 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined});
  };
  const num = n => Number(n || 0).toLocaleString();
  const AUTH = p => { const a = (p.authors || [])[0]; const f = a ? (a.family || a.name || String(a)) : ''; return (f ? f + ((p.authors || []).length > 1 ? ' et al.' : '') : '') + (p.year ? ` · ${p.year}` : ''); };
  let seq = 0;

  /* ---------------------------------------------------------------- Home */
  async function show() {
    const el = $('#home-main'); const my = ++seq;
    state.updateAvailable = (typeof Updates !== 'undefined' && Updates.info && Updates.info.available) ? Updates.info.latest : '';
    el.innerHTML = skeleton({docs: null, over: null});
    const [docs, over, stor, app] = await Promise.all([
      api('/api/docs/recent').catch(() => ({docs: [], groups: []})),
      api('/api/lab/overview').catch(() => ({groups: [], my_tasks: [], for_me: []})),
      api('/api/storage').catch(() => null), api('/api/app-status').catch(() => null)]);
    if (stor && app) stor.app_installed = !!app.installed;
    if (my !== seq || state.tab !== 'home') return;
    el.innerHTML = skeleton({docs, over, stor});
  }
  function skeleton({docs, over, stor}) {
    const P = state.papers || [];
    const reading = P.filter(p => p.status === 'reading').sort((a, b) => String(b.read_at || b.updated_at || '').localeCompare(String(a.read_at || a.updated_at || ''))).slice(0, 4);
    const waiting = P.filter(p => p.status === 'to_read').length;
    const withPdf = P.filter(p => p.pdf_exists).length;
    const alerts = P.filter(p => p.alerts).length;
    const loading = !docs || !over;
    const D = (docs?.docs || []).filter(d => !d.arch && !d.gone);
    const G = over?.groups || [];
    // what needs you, most urgent first
    const att = [];
    for (const t of (over?.my_tasks || [])) {
      const late = t.due && t.due < (over.today || ''); if (!late && !(t.due && t.due <= addDays(over.today, 7))) continue;
      att.push({k: late ? 0 : 3, icon: 'check', text: t.title || 'Task', sub: `${late ? 'Overdue' : 'Due ' + t.due} · ${esc(t.group_name)}`, tone: late ? 'bad' : 'warn', go: `task|${t.group}`});
    }
    if (alerts) att.push({k: 1, icon: 'alert', text: `${alerts} paper${alerts > 1 ? 's' : ''} in your library need a look`, sub: 'Retractions or published versions', tone: 'bad', go: 'feed'});
    for (const d of D.filter(d => d.open > 0).slice(0, 3)) att.push({k: 2, icon: 'chat', text: `${d.open} open comment${d.open > 1 ? 's' : ''} in “${d.title}”`, sub: esc(d.group), tone: 'warn', go: `doc|${d.sid}|${d.id}`});
    for (const f of (over?.for_me || []).slice(0, 3)) att.push({k: 4, icon: 'chat', text: `${f.name} → you: ${f.title}`, sub: `${esc(f.group_name)} · ${ago(f.created)}`, tone: '', go: `post|${f.group}`});
    att.sort((a, b) => a.k - b.k);
    const row = (icon, title, sub, go, extra = '') => `<button class="hm-row" data-hm="${esc(go)}"><span class="hm-ri">${ic(icon)}</span><span class="hm-rt"><b>${esc(title)}</b><small>${sub}</small></span>${extra}</button>`;
    return `<div class="hm">
      <section class="hm-hero">
        <h1>Your research desk</h1>
        <p class="hm-sub">Read, write and share your research – everything starts here.</p>
        <form class="hm-omni" id="hm-omni" autocomplete="off">${ic('search')}<input id="hm-q" placeholder="Search your library – or paste a DOI, link or title to add a paper" aria-label="Search or add a paper"><button class="btn primary" type="submit">Go</button></form>
        <p class="hm-hint">Enter searches your library (titles, notes and the text of your PDFs). A DOI, an arXiv number or a web address is added as a new paper.</p>
        <div class="hm-chips">
          <button class="hm-chip" data-hm="add">${ic('plus')}Add a paper</button><button class="hm-chip" data-hm="pdfs">${ic('upload')}Import PDFs</button>
          <button class="hm-chip" data-hm="discover">${ic('compass')}Discover papers</button><button class="hm-chip" data-hm="newdoc">${ic('pen')}New document</button>
          <button class="hm-chip" data-hm="newgroup">${ic('group')}New group</button></div>
      </section>
      <div class="hm-grid">
        <section class="hm-card hm-read"><div class="hm-h"><h2>${ic('books')}Read</h2><button class="linklike" data-hm="reading">Reading list${waiting ? ` (${waiting})` : ''} →</button></div>
          ${reading.length ? reading.map(p => row(p.pdf_exists ? 'file' : 'book', p.title || '(untitled)', `${esc(AUTH(p))}${p.read_page && p.read_pages ? ` · page ${p.read_page} of ${p.read_pages}` : ''}`, 'paper|' + p.id,
            p.pdf_exists ? `<span class="hm-go">${p.read_page ? 'Resume' : 'Open'}</span>` : '')).join('')
            : `<p class="hm-empty">${waiting ? `Nothing in progress. <button class="linklike" data-hm="reading">${waiting} paper${waiting > 1 ? 's are' : ' is'} waiting in your reading list.</button>` : 'Nothing in progress. Add a paper to start your reading list.'}</p>`}
          <div class="hm-f"><span>${num(P.length)} papers · ${num(withPdf)} with a PDF</span><button class="linklike" data-hm="library">All papers →</button></div></section>
        <section class="hm-card hm-write"><div class="hm-h"><h2>${ic('pen')}Write</h2><button class="linklike" data-hm="write">All documents →</button></div>
          ${loading ? '<p class="hm-empty">Loading…</p>' : D.length ? D.slice(0, 4).map(d => row('file', d.title, `${esc(d.group)} · ${ago(d.updated)}`, `doc|${d.sid}|${d.id}`, d.open ? `<span class="hm-badge">${d.open}</span>` : '')).join('')
            : '<p class="hm-empty">No documents yet. Write a manuscript, a proposal or minutes together with your group – with comments, suggestions and citations of your papers.</p>'}
          <div class="hm-f"><span>${loading ? '' : `${D.length} document${D.length === 1 ? '' : 's'}`}</span><button class="linklike" data-hm="newdoc">+ New document</button></div></section>
        <section class="hm-card hm-att"><div class="hm-h"><h2>${ic('bell')}Needs you</h2></div>
          ${loading ? '<p class="hm-empty">Loading…</p>' : att.length ? att.slice(0, 6).map(a => row(a.icon, a.text, a.sub, a.go)).join('') : '<p class="hm-empty">Nothing is waiting for you. Tasks, comments and mentions from your groups show up here.</p>'}</section>
        <section class="hm-card hm-grp"><div class="hm-h"><h2>${ic('group')}Groups</h2><button class="linklike" data-hm="lab">Open Lab →</button></div>
          ${loading ? '<p class="hm-empty">Loading…</p>' : G.length ? G.slice(0, 5).map(g => row('group', g.name, `${g.members} member${g.members === 1 ? '' : 's'} · ${g.papers} papers${g.open_tasks ? ` · ${g.open_tasks} open task${g.open_tasks > 1 ? 's' : ''}` : ''}`, 'group|' + g.id)).join('')
            : '<p class="hm-empty">Groups share a reading list, ideas, plans and documents. Create one, or join with a code.</p>'}
          <div class="hm-f"><button class="linklike" data-hm="newgroup">+ New group</button><button class="linklike" data-hm="join">Join with a code</button></div></section>
        <section class="hm-card hm-disc"><div><h2>${ic('compass')}Find what to read next</h2><p>Papers related to your library, found by topic or by meaning – and the researchers behind them.</p></div>
          <div class="hm-disc-b"><button class="btn primary" data-hm="discover">Discover papers</button><button class="btn" data-hm="topic">Search by topic</button><button class="btn" data-hm="people">Researchers</button></div></section>
        <section class="hm-card hm-tools"><div class="hm-h"><h2>${ic('gear')}Tools</h2></div>
          <div class="hm-tiles">
            ${[['map', 'map', 'Citation map', 'How your papers cite each other'], ['table', 'table', 'Review table', 'One row per paper, with columns'], ['stats', 'chart', 'Reading stats', 'What you read, and when'],
              ['export', 'export', 'Export', 'References (APA, BibTeX…) or notes'], ['feed', 'bell', 'What\'s new', alerts ? `${alerts} alert${alerts > 1 ? 's' : ''}` : 'Retractions, new versions'], ['storage', 'folder', 'Storage', stor ? `PDFs use ${sizeTxt(stor.total)}${stor.low ? ' · disk almost full' : ''}` : 'PDFs and disk space']]
              .map(([k, i, t, s]) => `<button class="hm-tile" data-hm="${k}"><span>${ic(i)}</span><b>${t}</b><small>${esc(s)}</small></button>`).join('')}</div></section>
      </div>
      <div class="hm-foot"><span>PaperShelf ${esc(state.version || '')}</span>
        <button class="linklike" data-hm="guide">Guide</button><button class="linklike" data-hm="settings">Settings</button>
        ${state.updateAvailable ? `<button class="linklike hm-upd" data-hm="update">Install PaperShelf ${esc(state.updateAvailable)}</button>` : '<button class="linklike" data-hm="update">Check for updates</button>'}
        ${stor && stor.app_installed === false ? '<button class="linklike" data-hm="app">Install as an app</button>' : ''}
        <span class="grow"></span><button class="linklike" data-hm="quit">Quit PaperShelf</button></div></div>`;
  }
  function addDays(d, n) { const t = new Date((d || new Date().toISOString().slice(0, 10)) + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }

  async function go(a) {
    const [k, x, y] = a.split('|');
    const lib = (mode) => { setTab(state.libScope === 'library' ? 'library' : 'reading'); if (mode) setTimeout(() => $(`[data-mode=${mode}]`)?.click(), 60); };
    switch (k) {
      case 'add': setTab('reading'); setTimeout(() => $('#add-input')?.focus(), 80); return;
      case 'pdfs': setTab('reading'); $('#import-input').value = ''; $('#import-input').click(); return;
      case 'discover': return setTab('discover');
      case 'topic': setTab('discover'); return setTimeout(() => (document.querySelector('#t-q') || document.querySelector('[data-topic]'))?.focus?.(), 300);
      case 'newdoc': return Write.newDoc();
      case 'newgroup': return Shares.newDialog();
      case 'join': return Shares.joinDialog();
      case 'reading': return setTab('reading');
      case 'library': return setTab('library');
      case 'write': return setTab('write');
      case 'lab': return setTab('lab');
      case 'people': return setTab('people');
      case 'map': return lib('map');
      case 'table': return lib('table');
      case 'stats': return Stats.open();
      case 'export': return openExport();
      case 'feed': return Feed.open();
      case 'storage': return openStorage();
      case 'guide': return Help.open('start');
      case 'settings': return openSettings();
      case 'update': return Updates.open();
      case 'app': return openSettings('general');
      case 'quit': return quitApp();
      case 'paper': { const id = +x, p = paperById(id); if (p?.pdf_exists) { Reader.open(id); } else { setTab('reading'); setTimeout(() => openDetail(id), 80); } return; }
      case 'doc': return Write.open(x, y);
      case 'group': case 'post': case 'task': setTab('lab'); return setTimeout(() => Lab.openGroup(x, k === 'task' ? {sub: 'plans'} : {}), 60);
    }
  }
  function bind() {
    const el = $('#home-main');
    el.addEventListener('click', e => { const b = e.target.closest('[data-hm]'); if (b) go(b.dataset.hm); });
    el.addEventListener('submit', e => {
      if (e.target.id !== 'hm-omni') return; e.preventDefault();
      const v = $('#hm-q', el).value.trim(); if (!v) return;
      if (/^(https?:\/\/|doi:|10\.\d{4,}\/|arxiv:|\d{4}\.\d{4,5}(v\d+)?$)/i.test(v)) { setTab('reading'); $('#add-input').value = v; setTimeout(() => $('#add-form').requestSubmit(), 60); }
      else { setTab('library'); setTimeout(() => { const s = $('#search'); s.value = v; s.dispatchEvent(new Event('input', {bubbles: true})); }, 60); }
    });
  }
  document.addEventListener('DOMContentLoaded', bind);
  return {show};
})();

/* ---------------------------------------------------------------- Write: the documents of all groups */
const Write = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ago = t => { if (!t) return 'never'; const s = (Date.now() - Date.parse(t)) / 1000; if (!(s >= 0) || s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d < 8 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}); };
  let data = {docs: [], groups: []}, q = '', grp = '', arch = false, editing = false, seq = 0, skip = false;

  async function show() {
    const el = $('#write-main'); const my = ++seq;
    if (skip) { skip = false; return; }               // a document is being opened right now
    if (editing && Docs.busy(editing.sid)) return;          // somebody is in the middle of writing: keep the page
    editing = false; Docs.leave();
    try { data = await api('/api/docs/recent'); } catch (e) { data = {docs: [], groups: []}; }
    if (my !== seq || state.tab !== 'write') return;
    draw(el);
  }
  function draw(el) {
    const wr = data.docs.filter(d => !d.gone), shown = wr.filter(d => (arch ? d.arch : !d.arch) && (!grp || d.sid === grp) && (!q || (d.title + ' ' + d.group).toLowerCase().includes(q.toLowerCase())));
    const nArch = wr.filter(d => d.arch).length;
    el.innerHTML = `<div class="wr">
      <div class="wr-head"><div><h1>Write</h1><p class="muted">The documents of all your groups, in one place. Write together, comment, suggest changes and cite the papers of your library.</p></div>
        <button class="btn primary" data-wr="new">${ic('plus')}New document</button></div>
      ${wr.length || data.groups.length ? `<div class="wr-bar"><label class="search-box wr-search">${ic('search')}<input id="wr-q" type="search" placeholder="Search documents" value="${esc(q)}"></label>
        <select class="input" id="wr-g" aria-label="Group"><option value="">All groups</option>${data.groups.map(g => `<option value="${esc(g.id)}" ${grp === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        ${nArch || arch ? `<button class="btn small ${arch ? 'on' : ''}" data-wr="arch">${arch ? 'Show current' : `Archived (${nArch})`}</button>` : ''}</div>` : ''}
      <div class="wr-list">${shown.map(d => `<button class="wr-row" data-wr="open|${esc(d.sid)}|${esc(d.id)}">
          <span class="wr-ic">${ic('file')}</span>
          <span class="wr-t"><b>${esc(d.title)}</b><small><span class="wr-chip">${ic('group')}${esc(d.group)}</span>Edited ${ago(d.updated)}${d.authors?.length ? ` by ${esc(d.authors.slice(0, 3).join(', '))}${d.authors.length > 3 ? '…' : ''}` : ''} · ${Number(d.words || 0).toLocaleString()} words</small></span>
          ${d.open ? `<span class="hm-badge" title="Open comments and suggestions">${ic('chat')}${d.open}</span>` : ''}</button>`).join('')
        || `<div class="wr-empty"><div class="big">${ic('pen')}</div><h3>${wr.length && !arch ? 'Nothing matches' : arch ? 'Nothing archived' : 'No documents yet'}</h3>
           <p class="muted">${wr.length || arch ? 'Try another search or group.' : 'Start a manuscript, a proposal, a review or the minutes of a meeting. Documents live in a group – even a group of just you.'}</p>
           ${wr.length || arch ? '' : `<button class="btn primary" data-wr="new">${ic('plus')}New document</button>`}</div>`}</div></div>`;
    $('#wr-q', el)?.addEventListener('input', e => { q = e.target.value; const pos = e.target.selectionStart; draw(el); const i = $('#wr-q', el); i.focus(); i.setSelectionRange(pos, pos); });
    $('#wr-g', el)?.addEventListener('change', e => { grp = e.target.value; draw(el); });
  }
  function bind() {
    $('#write-main').addEventListener('click', e => {
      const b = e.target.closest('[data-wr]'); if (!b) return; const [k, x, y] = b.dataset.wr.split('|');
      if (k === 'new') return newDoc(); if (k === 'open') return open(x, y);
      if (k === 'arch') { arch = !arch; draw($('#write-main')); }
    });
  }
  async function open(sid, did, opt = {}) {
    if (state.tab !== 'write') { skip = true; setTab('write'); }
    const el = $('#write-main'); const d = data.docs.find(x => x.id === did);
    editing = {sid, did};
    el.innerHTML = `<div class="wr wr-edit"><div class="docs-host" id="wr-host"></div></div>`;
    await Docs.mount($('#wr-host', el), sid, d ? d.can_write : true, {open: did, onBack: () => { editing = false; show(); }, ...opt});
  }
  async function newDoc() {
    let g = data.groups.length ? data : null;
    if (!g) { try { data = await api('/api/docs/recent'); } catch (e) { /* ignore */ } }
    const gs = data.groups.filter(x => x.can_write);
    const pick = (sid) => { if (state.tab !== 'write') { skip = true; setTab('write'); } editing = {sid, did: null}; const el = $('#write-main'); el.innerHTML = '<div class="wr wr-edit"><div class="docs-host" id="wr-host"></div></div>'; Docs.mount($('#wr-host', el), sid, true, {newDoc: true, onBack: () => { editing = false; show(); }}); };
    if (gs.length === 1) return pick(gs[0].id);
    const m = modal(`<h3>New document</h3>
      <p class="muted small">Documents live in a group: everybody in it can read and edit. For a document just for you, use a group of one.</p>
      <div class="wr-pick">${gs.map(x => `<button class="wr-row" data-g="${esc(x.id)}"><span class="wr-ic">${ic('group')}</span><span class="wr-t"><b>${esc(x.name)}</b><small>${x.members} member${x.members === 1 ? '' : 's'}</small></span></button>`).join('')}
        <button class="wr-row" data-g="__me"><span class="wr-ic">${ic('user')}</span><span class="wr-t"><b>Only me</b><small>Creates a group “My writing” with you as the only member</small></span></button></div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button></div>`);
    m.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-g]'); if (!b) return; let sid = b.dataset.g; m.close();
      if (sid === '__me') {
        const mine = data.groups.find(x => x.name === 'My writing' && x.can_write);
        if (mine) sid = mine.id; else { try { const r = await api('/api/shares', {method: 'POST', body: {name: 'My writing'}}); sid = r.share.id; if (typeof loadLibrary === 'function') await loadLibrary(); } catch (err) { toast(err.message, 'error'); return; } }
      }
      pick(sid);
    });
  }
  document.addEventListener('DOMContentLoaded', bind);
  return {show, open, newDoc, leave: () => { if (editing) { Docs.leave(); editing = false; } }};
})();
