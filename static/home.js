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
    const [docs, over, stor, app, cl] = await Promise.all([
      api('/api/docs/recent').catch(() => ({docs: [], groups: []})),
      api('/api/lab/overview').catch(() => ({groups: [], my_tasks: [], for_me: []})),
      api('/api/storage').catch(() => null), api('/api/app-status').catch(() => null),
      api('/api/calendar').catch(() => null)]);
    if (cl) { cal.items = cl.items || []; cal.today = cl.today; if (!cal.month) cal.month = cl.today.slice(0, 7); cal.ok = true; }
    if (stor && app) stor.app_installed = !!app.installed;
    if (my !== seq || state.tab !== 'home') return;
    el.innerHTML = skeleton({docs, over, stor});
  }
  /* ---- calendar widget: a month, with dots on the days that have something, and what is coming up ---- */
  const cal = {items: [], today: '', month: '', day: '', ok: false};
  const KIND = {experiment: 'Experiment', meeting: 'Meeting', deadline: 'Deadline', other: 'Event'};
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const itemKind = i => i.type === 'event' ? (i.kind || 'other') : 'deadline';
  const itemLabel = i => (i.type === 'task' ? '☐ ' : i.type === 'plan' ? '⚑ ' : '') + (i.title || 'Event');
  function dayName(d) {
    if (d === cal.today) return 'Today'; if (d === addDays(cal.today, 1)) return 'Tomorrow';
    return new Date(d + 'T12:00:00').toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
  }
  function calCard() {
    if (!cal.ok) return '';
    const mine = cal.items.filter(i => i.mine !== false);
    const by = {}; for (const i of mine) (by[i.date] = by[i.date] || []).push(i);
    const [y, m] = cal.month.split('-').map(Number), first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
    const wd = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    let cells = wd.map(w => `<i class="hc-w">${w}</i>`).join('') + '<b class="hc-e"></b>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, L = by[ds] || [];
      const kinds = [...new Set(L.map(itemKind))].slice(0, 3);
      cells += `<button class="hc-d${ds === cal.today ? ' today' : ''}${ds === cal.day ? ' sel' : ''}${L.length ? ' has' : ''}" data-hm="calday|${ds}" title="${esc(L.map(itemLabel).join('\n'))}"><span>${d}</span><em>${kinds.map(k => `<u class="k-${k}"></u>`).join('')}</em></button>`;
    }
    const from = cal.day || cal.today;
    let list = mine.filter(i => cal.day ? i.date === cal.day : (i.date >= cal.today && i.date <= addDays(cal.today, 14) && !(i.type !== 'event' && i.status === 'done')));
    list.sort((a, b) => (a.date + (a.start || '99')).localeCompare(b.date + (b.start || '99')));
    const more = list.length - 7; list = list.slice(0, 7);
    const mon = new Date(y, m - 1, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
    return `<section class="hm-card hm-cal"><div class="hm-h"><h2>${ic('calendar')}Calendar</h2><button class="linklike" data-hm="calopen">Open calendar →</button></div>
      <div class="hc-body"><div class="hc-month"><div class="hc-nav"><button class="hc-b" data-hm="calnav|-1" aria-label="Previous month">‹</button><b>${esc(mon)}</b><button class="hc-b" data-hm="calnav|1" aria-label="Next month">›</button>${cal.month !== cal.today.slice(0, 7) || cal.day ? '<button class="linklike hc-t" data-hm="caltoday">Today</button>' : ''}</div>
        <div class="hc-grid">${cells}</div></div>
        <div class="hc-list"><div class="hc-lh">${cal.day ? esc(dayName(cal.day)) + `<button class="linklike" data-hm="calall">Show upcoming</button>` : 'Coming up · next 2 weeks'}</div>
          ${list.length ? list.map(i => `<button class="hc-i" data-hm="calitem|${esc(i.group)}|${esc(i.id)}|${i.type}"><span class="hc-dot k-${itemKind(i)}"></span><span class="hc-it"><b>${esc(itemLabel(i))}</b><small>${esc(cal.day ? '' : dayName(i.date) + ' · ')}${i.start ? esc(i.start) + ' · ' : ''}${esc(i.type === 'event' ? KIND[i.kind] || 'Event' : i.type === 'task' ? 'Task due' : 'Plan due')} · ${esc(i.group_name)}</small></span></button>`).join('')
            : `<p class="hm-empty">${cal.day ? 'Nothing on this day.' : 'Nothing planned in the next two weeks.'} ${cal.day ? '' : 'Plan an experiment or a meeting in the calendar of a group.'}</p>`}
          ${more > 0 ? `<button class="linklike hc-more" data-hm="calopen">+ ${more} more →</button>` : ''}</div></div></section>`;
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
        <form class="hm-omni" id="hm-omni" autocomplete="off" style="position:relative">${ic('search')}<input id="hm-q" placeholder="Search your library and online – or paste a DOI, link or title" aria-label="Search or add a paper"><button class="btn primary" type="submit">Go</button></form>
        <p class="hm-hint">Type to see papers from your library and from the web (OpenAlex, Crossref – only the words you type are sent). A DOI, an arXiv number or a web address is added as a new paper.</p>
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
        ${calCard()}
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

  function redrawCal() { const c = $('.hm-cal'); if (!c) return; const t = document.createElement('div'); t.innerHTML = calCard(); c.replaceWith(t.firstElementChild); }
  async function go(a) {
    const [k, x, y, z] = a.split('|');
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
      case 'calopen': return Lab.openCalendar();
      case 'calnav': { const [yy, mm] = cal.month.split('-').map(Number); cal.month = iso(new Date(yy, mm - 1 + (+x), 1)).slice(0, 7); cal.day = ''; return redrawCal(); }
      case 'caltoday': cal.month = cal.today.slice(0, 7); cal.day = ''; return redrawCal();
      case 'calall': cal.day = ''; return redrawCal();
      case 'calday': cal.day = cal.day === x ? '' : x; return redrawCal();
      case 'calitem': if (z === 'event') { await Lab.openGroup(x, {sub: 'cal'}); return Cal.eventDialog({item: {group: x, id: y}}); } return Lab.openGroup(x, z === 'task' ? {task: y} : {plan: y});
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
  /* ---- the search box: your library first, then the web ---- */
  const sg = {items: [], act: -1, seq: 0, timer: 0, q: '', online: null, loading: false, err: ''};
  const isId = v => /^(https?:\/\/|www\.|doi:|10\.\d{4,}\/|arxiv:|pmid:?|\d{4}\.\d{4,5}(v\d+)?$)/i.test(v.trim());
  const words = q => q.toLowerCase().split(/\s+/).filter(Boolean);
  function localMatches(q) {
    const w = words(q); if (!w.length) return [];
    return state.papers.filter(p => { const hay = `${p.title} ${(p.authors || []).join(' ')} ${p.year || ''} ${p.journal || ''} ${(p.keywords || []).join(' ')}`.toLowerCase(); return w.every(x => hay.includes(x)); });
  }
  const aLine = c => { const a = c.authors || []; return a.length > 2 ? `${a[0]} … ${a[a.length - 1]}` : a.join(', '); };
  function sugBox(el) { let b = $('#hm-sug', el); if (!b) { b = document.createElement('div'); b.id = 'hm-sug'; b.className = 'hm-sug'; b.hidden = true; $('#hm-omni', el).appendChild(b); b.addEventListener('mousedown', e => e.preventDefault()); } return b; }
  function closeSug(el) { const b = $('#hm-sug', el); if (b) { b.hidden = true; b.innerHTML = ''; } sg.items = []; sg.act = -1; }
  function drawSug(el) {
    const q = sg.q, b = sugBox(el); if (!q || isId(q)) return closeSug(el);
    const loc = localMatches(q), items = [];
    let h = '';
    if (loc.length) {
      h += `<div class="hm-sg-h">In your library <span class="muted">${loc.length}</span></div>`;
      loc.slice(0, 4).forEach(p => { items.push({k: 'lib', id: p.id}); h += `<div class="hm-sg-i" data-i="${items.length - 1}"><b>${esc(p.title)}</b><small>${esc((p.authors || []).slice(0, 2).join(', '))}${p.year ? ' · ' + esc(p.year) : ''}${p.journal ? ' · ' + esc(p.journal) : ''}</small></div>`; });
      if (loc.length > 4) { items.push({k: 'all'}); h += `<div class="hm-sg-i hm-sg-more" data-i="${items.length - 1}">Show all ${loc.length} in the Library</div>`; }
    }
    h += `<div class="hm-sg-h">On the web <span class="muted small">OpenAlex · Crossref</span></div>`;
    if (sg.loading) h += '<div class="hm-sg-m">Searching online…</div>';
    else if (sg.err) h += `<div class="hm-sg-m err">${esc(sg.err)}</div>`;
    else if (sg.online === null) h += `<div class="hm-sg-m muted">${q.length < 6 || words(q).length < 2 ? 'Type a few more words to search online.' : '…'}</div>`;
    else if (!sg.online.length) h += '<div class="hm-sg-m">Nothing found online. Try other words, the authors, or paste the DOI.</div>';
    else sg.online.slice(0, 5).forEach(c => { items.push({k: 'web', c}); h += `<div class="hm-sg-i" data-i="${items.length - 1}"><b>${esc(c.title)}</b><small>${esc(aLine(c))}${c.year ? ' · ' + esc(c.year) : ''}${c.venue ? ' · ' + esc(String(c.venue).slice(0, 40)) : ''}</small>${c.in_library ? '<span class="hm-sg-have">in your library</span>' : '<span class="hm-sg-add">＋ add</span>'}</div>`; });
    items.push({k: 'topic'}); h += `<div class="hm-sg-i hm-sg-act" data-i="${items.length - 1}">🔎 Search by topic: “${esc(q.slice(0, 50))}”</div>`;
    sg.items = items; if (sg.act >= items.length) sg.act = -1;
    b.innerHTML = h; b.hidden = false;
    $$('.hm-sg-i', b).forEach(n => n.classList.toggle('on', +n.dataset.i === sg.act));
  }
  async function runOnline(el, q) {
    if (q.length < 6 || words(q).length < 2 || isId(q)) { sg.online = null; sg.loading = false; return drawSug(el); }
    const my = ++sg.seq; sg.loading = true; sg.err = ''; drawSug(el);
    try { const d = await api('/api/search-online?q=' + encodeURIComponent(q)); if (my !== sg.seq) return; sg.online = d.results || []; }
    catch (err) { if (my !== sg.seq) return; sg.err = err.message; }
    sg.loading = false; drawSug(el);
  }
  async function pickSug(el, it) {
    closeSug(el); const inp = $('#hm-q', el);
    if (it.k === 'lib') { setTab('library'); return setTimeout(() => openDetail(it.id), 60); }
    if (it.k === 'all') return libSearch(inp.value.trim());
    if (it.k === 'topic') { const q = inp.value.trim(); setTab('discover'); return setTimeout(() => Discover.searchFor(q), 60); }
    const c = it.c;
    if (c.in_library) { setTab('library'); return setTimeout(() => openDetail(c.in_library), 60); }
    try { const d = await addOne(c.doi || c.openalex_id); upsertPaper(d.paper); inp.value = ''; sg.q = ''; setTab('reading'); renderAll(); openDetail(d.paper.id);
      toast(d.duplicate ? 'Already in your library – opened it.' : `Added: ${d.paper.title.slice(0, 80)}`, d.duplicate ? 'info' : 'ok'); }
    catch (err) { toast(err.message, 'error', 9000); }
  }
  function libSearch(v) { setTab('library'); setTimeout(() => { const s = $('#search'); s.value = v; s.dispatchEvent(new Event('input', {bubbles: true})); }, 60); }
  function bind() {
    const el = $('#home-main');
    el.addEventListener('click', e => {
      const it = e.target.closest('.hm-sg-i'); if (it) return pickSug(el, sg.items[+it.dataset.i]);
      const b = e.target.closest('[data-hm]'); if (b) go(b.dataset.hm);
    });
    el.addEventListener('input', e => {
      if (e.target.id !== 'hm-q') return; sg.q = e.target.value.trim(); sg.act = -1; sg.online = null; sg.err = ''; clearTimeout(sg.timer); ++sg.seq; sg.loading = false;
      drawSug(el); if (sg.q) sg.timer = setTimeout(() => runOnline(el, sg.q), 500);
    });
    el.addEventListener('keydown', e => {
      if (e.target.id !== 'hm-q') return; const b = $('#hm-sug', el); if (!b || b.hidden) return;
      if (e.key === 'Escape') { closeSug(el); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sg.items.length) { e.preventDefault(); const n = sg.items.length; sg.act = e.key === 'ArrowDown' ? (sg.act + 1 >= n ? -1 : sg.act + 1) : (sg.act - 1 < -1 ? n - 1 : sg.act - 1);
        $$('.hm-sg-i', b).forEach(x => x.classList.toggle('on', +x.dataset.i === sg.act)); $$('.hm-sg-i', b)[sg.act]?.scrollIntoView({block: 'nearest'}); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('#hm-omni')) { const h = $('#home-main'); if (h) closeSug(h); } });
    el.addEventListener('submit', e => {
      if (e.target.id !== 'hm-omni') return; e.preventDefault();
      const v = $('#hm-q', el).value.trim(); if (!v) return;
      if (sg.act >= 0 && sg.items[sg.act]) return pickSug(el, sg.items[sg.act]);
      if (/^(https?:\/\/|doi:|10\.\d{4,}\/|arxiv:|\d{4}\.\d{4,5}(v\d+)?$)/i.test(v)) { setTab('reading'); $('#add-input').value = v; setTimeout(() => $('#add-form').requestSubmit(), 60); return; }
      if (localMatches(v).length) return libSearch(v);          // found in your library
      if (sg.online && sg.online.length) { sg.act = sg.items.findIndex(i => i.k === 'web'); drawSug(el); return; }   // not here: show the web results
      clearTimeout(sg.timer); runOnline(el, v);
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
          ${d.open ? `<span class="hm-badge" title="Open comments and suggestions">${ic('chat')}${d.open}</span>` : ''}
          ${d.can_write ? `<span class="wr-more" role="button" tabindex="0" title="Archive or delete" data-wr="menu|${esc(d.sid)}|${esc(d.id)}">⋯</span>` : ''}</button>`).join('')
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
      if (k === 'menu') { e.stopPropagation(); return menu(b, x, y); }
    });
    document.addEventListener('click', () => $('.wr-pop')?.remove());
    $('#write-main').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.wr?.startsWith('menu|')) { e.preventDefault(); e.target.click(); } });
  }
  function menu(btn, sid, did) {
    $('.wr-pop')?.remove();
    const d = data.docs.find(x => x.id === did); if (!d) return;
    const pop = document.createElement('div'); pop.className = 'wr-pop';
    pop.innerHTML = `<button data-a="arch">${d.arch ? 'Move back to documents' : 'Archive'}</button>`
      + (d.can_delete ? '<button class="danger" data-a="del">Delete document…</button>' : '<span class="muted small">Only its creator can delete it.</span>');
    btn.closest('.wr-row').appendChild(pop);
    pop.addEventListener('click', async e => {
      e.stopPropagation(); const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; pop.remove();
      try {
        if (a === 'arch') { await api(`/api/shares/${encodeURIComponent(sid)}/docs/${encodeURIComponent(did)}`, {method: 'PUT', body: {arch: !d.arch}}); toast(d.arch ? 'Back in your documents.' : 'Archived.'); }
        else {
          if (!await confirmBox('Delete this document for the group?', 'It stops being shared and disappears from your list. The other members keep their copy on their own computer until they remove it themselves, so nobody loses work suddenly. This cannot be undone.', {ok: 'Delete', danger: true})) return;
          await api(`/api/shares/${encodeURIComponent(sid)}/docs/${encodeURIComponent(did)}`, {method: 'DELETE'}); toast('Document deleted.');
        }
        data = await api('/api/docs/recent'); draw($('#write-main'));
      } catch (err) { toast(err.message, 'error'); }
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
