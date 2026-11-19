/* Shared documents of a group (inside the Lab).
   The text is a character-level sequence CRDT: every member appends operations to their own log, the text is
   rebuilt from all the logs in one fixed order (same rules as sharing.py), so simultaneous typing never overwrites
   anybody. This file: the replay, the editor, comments and suggestions, versions, citations, export. */
const Docs = (() => {
  const D = {sid: null, can: false, list: null, id: null, host: null, R: null, mode: 'write', side: 'comments', sel: null, view: null,
             pending: null, poll: null, flushT: null, flushing: false, status: 'saved', showArch: false, composing: false, selCm: null, filter: 'open', auth: false, split: false, standalone: false, ext: new Set(), rsel: null};
  const root = () => $('#dx-root', D.host) || D.host;
  const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const av = (id, name, size = 22) => `<span class="lab-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.5)}px;background:hsl(${hue(id)} 42% 44%)" title="${esc(name || id)}">${esc(initials(name || id))}</span>`;
  const q = s => encodeURIComponent(s);
  const base = () => `/api/shares/${q(D.sid)}/docs`;
  function ago(s) {
    const t = Date.parse(s); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); return d < 7 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
  }
  const num = n => Number(n || 0).toLocaleString();

  /* ------------------------------------------------------------- the text engine (mirror of sharing.py) */
  const cmpId = (a, b) => (a.c - b.c) || (a.a < b.a ? -1 : a.a > b.a ? 1 : 0);
  const opEnd = op => op.k === 'i' ? op.c + Array.from(op.t).length - 1 : op.c;
  function replay(ops, upto) {
    const all = [];
    for (const a of Object.keys(ops)) ops[a].forEach((op, i) => { if (upto == null || op.c <= upto) all.push({c: op.c, a, i, op}); });
    all.sort((x, y) => (x.c - y.c) || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.i - y.i));
    const head = {c: 0, a: '', ch: '', next: null, dead: false}, byId = new Map([['0|', head]]);
    for (const {c, a, op} of all) {
      if (op.k !== 'i') continue;
      const anchor = op.a ? byId.get(op.a[0] + '|' + op.a[1]) : head;
      if (!anchor || byId.has(c + '|' + a)) continue;
      let p = anchor; const me = {c, a};
      while (p.next && cmpId(p.next, me) > 0) p = p.next;
      const after = p.next; let prev = p;
      Array.from(op.t).forEach((ch, j) => { const n = {c: c + j, a, ch, next: null, dead: false}; prev.next = n; byId.set(n.c + '|' + a, n); prev = n; });
      prev.next = after;
    }
    for (const {op} of all) if (op.k === 'd') for (const [c0, a0, n] of op.r) for (let k = 0; k < n; k++) { const x = byId.get((c0 + k) + '|' + a0); if (x) x.dead = true; }
    const nodes = []; for (let p = head.next; p; p = p.next) nodes.push(p);
    return nodes;
  }
  // everything the editor needs about one state of the text
  function build(ops, upto) {
    const nodes = replay(ops, upto), vis = [], pref = new Array(nodes.length), idx = new Map(), off = [0];
    let text = '';
    nodes.forEach((n, i) => { idx.set(n.c + '|' + n.a, i); if (!n.dead) { vis.push(n); text += n.ch; off.push(text.length); } pref[i] = vis.length; });
    return {nodes, vis, pref, idx, off, text};
  }
  const maxCtr = ops => { let m = 0; for (const a of Object.keys(ops)) { const l = ops[a]; for (let i = l.length - 1; i >= Math.max(0, l.length - 3); i--) m = Math.max(m, opEnd(l[i])); } return m; };
  // UTF-16 offset <-> index among the visible characters
  function offToIdx(B, o) { let lo = 0, hi = B.off.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (B.off[m] < o) lo = m + 1; else hi = m; } return lo; }
  // the position of a (maybe deleted) character as a visible index: how many visible characters come before it
  function visBefore(B, id) { const i = B.idx.get(id[0] + '|' + id[1]); if (i == null) return null; return B.pref[i] - (B.nodes[i].dead ? 0 : 1); }
  function visAfter(B, id) { const i = B.idx.get(id[0] + '|' + id[1]); return i == null ? null : B.pref[i]; }
  const textOf = (B, a, b) => B.text.slice(B.off[a], B.off[b]);

  /* ------------------------------------------------------------- local editing */
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const clean = t => String(t).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
  function pushOp(op) {
    const R = D.R, log = R.ops[R.me] || (R.ops[R.me] = []), last = log[log.length - 1], unsent = log.length - 1 >= Math.max(R.sent, R.fl || 0);   // an operation already on its way never grows
    if (unsent && last && last.k === 'i' && op.k === 'i' && op.a && op.a[0] === opEnd(last) && op.a[1] === R.me && op.c === R.max + 1 && R.max === opEnd(last)) {
      last.t += op.t; last.at = op.at; R.max = opEnd(last); return;               // typing: one operation grows
    }
    if (unsent && last && last.k === 'd' && op.k === 'd' && last.r.length + op.r.length < 380) {
      for (const r of op.r) { const l = last.r[last.r.length - 1]; if (l && l[1] === r[1] && l[0] + l[2] === r[0]) l[2] += r[2]; else last.r.push(r); }
      last.at = op.at; return;                                                       // backspacing: one operation grows
    }
    log.push(op); R.max = Math.max(R.max, opEnd(op));
  }
  // turn "the text became newText" into operations (common start and end are kept)
  function editTo(newText) {
    const R = D.R, B = R.B, old = B.text; newText = clean(newText);
    if (old === newText) return false;
    let p = 0; const n = Math.min(old.length, newText.length);
    while (p < n && old.charCodeAt(p) === newText.charCodeAt(p)) p++;
    if (p && /[\ud800-\udbff]/.test(old[p - 1])) p--;
    let s = 0; while (s < n - p && old.charCodeAt(old.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
    if (s && /[\udc00-\udfff]/.test(old[old.length - s])) s--;
    const i0 = offToIdx(B, p), i1 = offToIdx(B, old.length - s), ins = newText.slice(p, newText.length - s);
    if (i1 > i0) {
      const r = [];
      for (let i = i0; i < i1; i++) { const x = B.vis[i], l = r[r.length - 1]; if (l && l[1] === x.a && l[0] + l[2] === x.c) l[2]++; else r.push([x.c, x.a, 1]); }
      pushOp({k: 'd', c: R.max + 1, r: r.slice(0, 399), at: nowIso()});
    }
    if (ins) { const a = i0 ? [B.vis[i0 - 1].c, B.vis[i0 - 1].a] : null; pushOp({k: 'i', c: R.max + 1, a, t: ins, at: nowIso()}); }
    rebuild(); schedule(); return true;
  }
  function rebuild(upto) { const R = D.R; R.B = build(R.ops, upto); R.max = Math.max(R.max || 0, maxCtr(R.ops)); }

  /* ------------------------------------------------------------- talking to the server */
  const setStatus = s => { D.status = s; const el = $('#dx-status', D.host); if (el) { el.textContent = {saved: 'Saved', saving: 'Saving…', offline: 'Not saved yet, retrying…', read: 'Read only'}[s] || ''; el.className = 'dx-status ' + s; } };
  function schedule() {
    setStatus('saving'); clearTimeout(D.flushT);
    D.flushT = setTimeout(flush, D.R && activeAuthors().length ? 900 : 1800);
    if (!D.firstEdit) D.firstEdit = Date.now();
    if (Date.now() - D.firstEdit > 5000) { clearTimeout(D.flushT); flush(); }
  }
  async function flush() {
    const R = D.R; if (!R || D.flushing) return;
    const log = R.ops[R.me] || []; if (log.length <= R.sent) { setStatus('saved'); return; }
    D.flushing = true; D.firstEdit = 0;
    const sendTo = log.length, from = R.sent, payload = JSON.parse(JSON.stringify(log.slice(from))); R.fl = sendTo;
    try {
      const r = await api(`${base()}/${q(D.id)}/ops`, {method: 'POST', body: {from, ops: payload}});
      R.sent = Math.max(R.sent, sendTo); R.have[R.me] = r.n;
      D.flushing = false;
      if ((R.ops[R.me] || []).length > R.sent) { schedule(); } else setStatus('saved');
    } catch (err) {
      D.flushing = false;
      if (err.data && typeof err.data.n === 'number') {
        const n = err.data.n;
        if (n >= from && n <= log.length && n !== from) { R.sent = n; R.have[R.me] = n; flush(); return; }  // the answer got lost: they are stored
        toast('Your copy of this document was out of date, so it has been reloaded. The last few seconds of typing may need to be written again.', 'error', 9000);
        await openDoc(D.id, {keep: true}); return;
      }
      setStatus('offline'); clearTimeout(D.flushT); D.flushT = setTimeout(flush, 5000);
    }
  }

  function absorb(r) {
    const R = D.R; let changed = false;
    for (const [a, o] of Object.entries(r.ops || {})) {
      if (a === R.me) { if (o.n > (R.ops[a] || []).length) { R.ops[a] = (R.ops[a] || []).slice(0, o.from).concat(o.ops); R.sent = R.ops[a].length; changed = true; } R.have[a] = Math.max(R.have[a] || 0, o.n); continue; }
      if (o.ops.length) { R.ops[a] = (R.ops[a] || []).slice(0, o.from).concat(o.ops); R.have[a] = o.n; changed = true; }
    }
    R.title = r.title; R.arch = r.arch; R.gone = r.gone; R.canDelete = r.can_delete; R.comments = r.comments; R.snaps = r.snaps; R.papers = r.papers; R.people = r.people; D.can = r.can_write;
    return changed;
  }
  async function pull() {
    if (!D.R || !D.host || !document.body.contains(D.host)) return stopPoll();
    try {
      const r = await api(`${base()}/${q(D.id)}/sync`, {method: 'POST', body: {have: D.R.have}});
      if (!D.R || r.id !== D.id) return;
      const changed = absorb(r);
      if (changed) applyRemote(); else paintSide();
      if (r.sync_error) $('#dx-net', D.host)?.setAttribute('title', r.sync_error);
    } catch (err) { /* offline: try again later */ }
  }
  // the faster someone else is writing, the faster we look (about every 4 s), otherwise every 12 s
  function startPoll() {
    stopPoll(); D.pollOn = true;
    const tick = async () => {
      if (!D.pollOn) return;
      if (document.visibilityState === 'visible' && D.host && D.host.offsetParent !== null && D.R && !D.R.gone) await pull();
      if (!D.pollOn) return;
      D.poll = setTimeout(tick, document.visibilityState !== 'visible' ? 30000 : D.R && activeAuthors().length ? 4500 : 12000);
    };
    D.poll = setTimeout(tick, 3500);
    D.onvis = () => { if (document.visibilityState === 'visible' && D.R && !D.R.gone) pull(); };
    document.addEventListener('visibilitychange', D.onvis);
  }
  function stopPoll() { D.pollOn = false; clearTimeout(D.poll); D.poll = null; if (D.onvis) document.removeEventListener('visibilitychange', D.onvis); D.onvis = null; }

  /* ------------------------------------------------------------- list of documents */
  async function loadList() {
    try { const r = await api(base()); D.list = r.docs; D.can = r.can_write; }
    catch (err) { D.list = []; toast(err.message, 'error'); }
  }
  function cardHtml(d) {
    return `<button class="dx-card" data-dx-open="${esc(d.id)}">
          <span class="dx-card-t">${esc(d.title)}</span>
          <span class="dx-card-m">${num(d.words)} word${d.words === 1 ? '' : 's'}${d.updated ? ` · edited ${esc(ago(d.updated))}` : ''}</span>
          <span class="dx-card-f"><span class="dx-who">${(d.authors.length ? d.authors : [d.by_name]).slice(0, 5).map(n => av(n, n, 20)).join('')}</span>
            ${d.open ? `<span class="dx-badge" title="Open comments and suggestions">${ic('chat')}${d.open}</span>` : ''}</span></button>`;
  }
  function listHtml() {
    const all = D.list || [], live = all.filter(d => !d.gone), gone = all.filter(d => d.gone);
    const shown = live.filter(d => D.showArch ? d.arch : !d.arch), nArch = live.filter(d => d.arch).length;
    return `<div class="dx-list">
      <div class="dx-lhead"><div><h3>Documents</h3><p class="muted small">Write together: everyone types at the same time and nothing is overwritten. Comment, suggest changes, cite the group's papers, export to Word.</p></div><span class="grow"></span>
        ${nArch ? `<button class="btn small" data-dx="toggle-arch">${D.showArch ? 'Back to documents' : `Archived (${nArch})`}</button>` : ''}
        ${D.can ? `<button class="btn primary" data-dx="new">${ic('plus')}New document</button>` : ''}</div>
      ${shown.length ? `<div class="dx-cards">${shown.map(cardHtml).join('')}</div>`
        : `<div class="lab-empty"><div class="big">${ic('file', 30)}</div><h3>${D.showArch ? 'Nothing archived' : 'No documents yet'}</h3>
            <p class="muted">${D.can ? 'Start a manuscript, a grant proposal, meeting minutes or a literature review. Everyone in the group can write in it, at the same time.' : 'The editors of this group have not written a document yet.'}</p></div>`}
      ${gone.length && !D.showArch ? `<h4 class="dx-h dx-goneh">Deleted from the group, still on your computer</h4><p class="muted small">These documents are no longer shared or updated. Export what you need, then remove them from this computer.</p>
        <div class="dx-cards">${gone.map(d => `<div class="dx-card gone"><button class="dx-gopen" data-dx-open="${esc(d.id)}"><span class="dx-card-t">${esc(d.title)}</span><span class="dx-card-m">${num(d.words)} words · deleted by ${esc(d.by_name)}</span></button>
          <button class="btn small" data-dx-purge="${esc(d.id)}">${ic('trash')}Remove from this computer</button></div>`).join('')}</div>` : ''}
      ${D.can ? '' : '<p class="muted small">You are a reader of this group: you can read and export documents, not write.</p>'}
    </div>`;
  }
  const TEMPLATES = {
    blank: '',
    paper: '# Title\n\n## Abstract\n\n## Introduction\n\n## Methods\n\n## Results\n\n## Discussion\n\n## References\n',
    review: '# Title\n\n## Why this review\n\n## What we looked for\n\n## What the papers say\n\n## Gaps and open questions\n\n## Next steps\n',
    minutes: '# Meeting minutes\n\n**Date:** \n**Present:** \n\n## Agenda\n\n- \n\n## Decisions\n\n- \n\n## To do\n\n- [ ] \n',
    grant: '# Title\n\n## Aims\n\n## Background\n\n## Approach\n\n## Timeline\n\n## Team and resources\n',
  };
  function newDialog() {
    const m = modal(`<h3>New document</h3>
      <label class="fld"><span>Title</span><input class="input" id="dx-nt" maxlength="150" placeholder="e.g. Manuscript: effects of X on Y"></label>
      <label class="fld"><span>Start from</span><select class="input" id="dx-ntpl"><option value="blank">Empty page</option><option value="paper">Research paper (Abstract … References)</option>
        <option value="review">Literature review</option><option value="grant">Grant proposal</option><option value="minutes">Meeting minutes</option></select></label>
      <p class="muted small">Everyone in the group can read and edit it. Nothing leaves the group: the text travels like the rest of the group's data.</p>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dx-ncreate">Create</button></div>`);
    setTimeout(() => $('#dx-nt', m.el).focus(), 40);
    const go = async () => {
      const b = $('#dx-ncreate', m.el); setBusy(b, true, 'Creating…');
      try {
        const r = await api(base(), {method: 'POST', body: {title: $('#dx-nt', m.el).value.trim() || 'Untitled document', text: TEMPLATES[$('#dx-ntpl', m.el).value] || ''}});
        D.list = r.docs; m.close(); await openDoc(r.id);
      } catch (err) { toast(err.message, 'error'); setBusy(b, false); }
    };
    $('#dx-ncreate', m.el).onclick = go; $('#dx-nt', m.el).onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  /* ------------------------------------------------------------- the editor */
  async function openDoc(id, {keep = false} = {}) {
    if (D.ext.has(D.sid + '/' + id) && !D.standalone) { toast('This document is open in another window. Write there, or close that window first.'); return; }
    stopPoll(); clearTimeout(D.flushT);
    try {
      const r = await api(`${base()}/${q(id)}`);
      D.id = id; D.can = r.can_write; D.mode = keep ? D.mode : 'write'; D.view = null; D.selCm = null;
      D.R = {me: r.me, ops: {}, have: {}, sent: 0, max: 0, B: null, title: r.title, arch: r.arch, gone: r.gone, canDelete: r.can_delete, byName: r.by_name, comments: [], snaps: [], papers: [], people: [], text0: ''};
      for (const [a, o] of Object.entries(r.ops)) { D.R.ops[a] = o.ops; D.R.have[a] = o.n; }
      D.R.sent = (D.R.ops[D.R.me] || []).length; absorb({...r, ops: {}}); rebuild();
      if (D.standalone) document.title = r.title + ' – PaperShelf';
      paint(); if (!r.gone) { startPoll(); setTimeout(pull, 600); }
    } catch (err) { toast(err.message, 'error'); D.id = null; await loadList(); paintList(); }
  }
  function closeDoc() {
    flushNow().finally(() => { stopPoll(); D.id = null; D.R = null; D.view = null; hideBubble(); loadList().then(paintList); });
  }
  async function flushNow() { clearTimeout(D.flushT); for (let i = 0; i < 3 && D.R && ((D.R.ops[D.R.me] || []).length > D.R.sent || D.flushing); i++) { if (!D.flushing) await flush(); else await new Promise(r => setTimeout(r, 300)); } }

  // writers get well-separated colours (the n-th writer: golden-angle steps around the colour wheel)
  const auHue = a => { const ids = [...new Set([...(D.R.people || []).map(p => p.id), ...Object.keys(D.R.ops)])].sort(); const i = Math.max(0, ids.indexOf(a)); return Math.round((i * 137.508 + 150) % 360); };
  function peopleName(a) { return (D.R.people.find(p => p.id === a) || {}).name || a; }
  function activeAuthors(ms = 150000) {
    const R = D.R, out = [];
    for (const [a, log] of Object.entries(R.ops)) { const last = log[log.length - 1]; if (a !== R.me && last && Date.now() - Date.parse(last.at) < ms) out.push(a); }
    return out;
  }
  // where somebody wrote last: a visible index in the text
  function lastSpot(a) {
    const B = D.R.B, log = D.R.ops[a] || [], op = log[log.length - 1]; if (!op) return null;
    if (op.k === 'i') { const n = Array.from(op.t).length; return visAfter(B, [op.c + n - 1, a]); }
    return op.r.length ? visBefore(B, [op.r[0][0], op.r[0][1]]) : null;
  }
  function sectionAt(idx) {
    const B = D.R.B, head = B.text.slice(0, B.off[Math.min(idx, B.vis.length)]).split('\n').reverse().find(l => /^#{1,6}\s/.test(l));
    return head ? head.replace(/^#+\s*/, '').trim().slice(0, 40) : '';
  }
  function paint() {
    if (!D.host) return;
    const R = D.R, W = D.can;
    root().innerHTML = `<div class="dx ${D.mode}">
      <div class="dx-bar">
        ${D.standalone ? '' : `<button class="btn small" data-dx="back" title="All documents">${ic('caret')}<span>Documents</span></button>`}
        <input class="dx-title" id="dx-title" value="${esc(R.title)}" maxlength="150" ${W ? '' : 'readonly'} aria-label="Title">
        <span class="dx-status ${D.status}" id="dx-status">${W ? 'Saved' : 'Read only'}</span>
        <span class="dx-now" id="dx-now"></span>
        <span class="grow"></span>
        <div class="seg dx-modes"><button data-dx-mode="write" class="${D.mode === 'write' ? 'on' : ''}" title="Type here">${W ? 'Write' : 'Read'}</button>
          <button data-dx-mode="marks" class="${D.mode === 'marks' ? 'on' : ''}" title="Comment and suggest changes on the text, like in Google Docs">Review</button>
          <button data-dx-mode="preview" class="${D.mode === 'preview' ? 'on' : ''}" title="The formatted document with citations and references">Preview</button></div>
        ${D.standalone ? '' : `<button class="btn small dx-ibtn ${D.split ? 'on' : ''}" data-dx="split" title="Show your library next to the document">${ic('books')}<span>Library</span></button><button class="btn small dx-ibtn" data-dx="window" title="Open this document in its own window, to keep the library in the main one">${ic('export')}<span>New window</span></button>`}
        <span class="dx-menu"><button class="btn small" data-dx="export-menu">${ic('download')}Export</button></span>
        ${W || R.canDelete ? `<span class="dx-menu"><button class="btn small" data-dx="more-menu" title="More">⋯</button></span>` : ''}
      </div>
      ${R.gone ? `<div class="dx-gonebar">${ic('alert')}<span><b>${esc(R.byName)}</b> deleted this document for the group. It is no longer shared or updated: this copy stays on your computer only.</span><span class="grow"></span><button class="btn small" data-dx-exp="docx">Export</button><button class="btn small danger" data-dx="purge">Remove from this computer</button></div>` : ''}
      ${W && D.mode === 'write' ? `<div class="dx-tools" role="toolbar" aria-label="Formatting">
        <button data-fmt="h1" title="Heading 1"><b>H1</b></button><button data-fmt="h2" title="Heading 2"><b>H2</b></button><button data-fmt="h3" title="Heading 3"><b>H3</b></button><span class="dx-sep"></span>
        <button data-fmt="bold" title="Bold (${MOD}+B)"><b>B</b></button><button data-fmt="italic" title="Italic (${MOD}+I)"><i>I</i></button><button data-fmt="code" title="Code"><code>&lt;/&gt;</code></button><span class="dx-sep"></span>
        <button data-fmt="ul" title="Bulleted list">• List</button><button data-fmt="ol" title="Numbered list">1. List</button><button data-fmt="quote" title="Quote">❝</button><button data-fmt="link" title="Link">${ic('link')}</button><span class="dx-sep"></span>
        <button data-fmt="cite" title="Cite a paper of the group">${ic('book')}Cite</button>
        <button data-fmt="comment" title="Comment on the selected text (${MOD}+Alt+M)">${ic('chat')}Comment</button>
        <button data-fmt="suggest" title="Suggest a change to the selected text">${ic('pen')}Suggest</button>
      </div>` : ''}
      <div class="dx-main"><div class="dx-page" id="dx-page"></div><aside class="dx-side" id="dx-side"></aside></div></div>`;
    paintPage(); paintSide(); paintNow();
  }
  function paintNow() {
    const el = $('#dx-now', D.host); if (!el || !D.R) return;
    const act = activeAuthors();
    el.innerHTML = act.slice(0, 3).map(a => {
      const typing = Date.now() - Date.parse(D.R.ops[a][D.R.ops[a].length - 1].at) < 20000, sp = lastSpot(a), sec = sp == null ? '' : sectionAt(sp);
      return `<span class="dx-live ${typing ? 'typing' : ''}" title="${esc(peopleName(a))}${typing ? ' is writing' : ' was here a moment ago'}">${av(a, peopleName(a), 22)}<span class="dx-live-t"><b>${esc(peopleName(a).split(' ')[0])}</b>${typing ? ' is writing' : ' is here'}${sec ? ` · ${esc(sec)}` : ''}</span></span>`;
    }).join('') + (act.length > 3 ? `<span class="muted small">+${act.length - 3}</span>` : '');
  }

  // ---- the page itself: textarea (write), coloured source (review) or formatted text (preview)
  function resolveCites(text) {
    const by = new Map((D.R.papers || []).map(p => [p.label, p])), used = [];
    const out = text.replace(/\[@([^\]\n]{1,200})\]/g, (_m, g) => '(' + g.split(/[;,]/).map(x => x.trim().replace(/^@/, '')).filter(Boolean).map(l => { const p = by.get(l); if (!p) return l + '?'; if (!used.includes(p)) used.push(p); return p.cite; }).join('; ') + ')');
    return {text: out, used};
  }
  const mdHtml = t => (typeof Notes !== 'undefined' && Notes.md) ? Notes.md(t) : esc(t).replace(/\n/g, '<br>');
  function previewHtml(B, title) {
    const {text, used} = resolveCites(B.text);
    const refs = used.slice().sort((a, b) => a.ref.toLowerCase().localeCompare(b.ref.toLowerCase()));
    return `<article class="dx-prev"><h1>${esc(title)}</h1>${mdHtml(text)}${refs.length ? `<h2>References</h2><ol class="dx-refs">${refs.map(p => `<li>${esc(p.ref)}</li>`).join('')}</ol>` : ''}</article>`;
  }
  // comment highlights, suggestions (old text struck out, new text inserted), flags where others wrote
  function reviewItems(B) {
    const n = B.vis.length, hi = [], sug = [], ins = new Map();
    for (const c of D.R.comments) {
      if (c.parent) continue;
      const open = c.state === 'open'; if (!open && !(D.filter === 'all' && c.state !== 'rejected')) continue;
      const isSug = c.rep != null;
      if (isSug && !open) continue;
      if (c.ins) {   // an insertion: the new text appears after the character it was written next to
        const pos = c.anchor ? visAfter(B, c.anchor[1]) : 0; if (pos == null) continue;
        (ins.get(pos) || ins.set(pos, []).get(pos)).push({id: c.id, rep: c.rep}); continue;
      }
      if (!c.anchor) continue;
      const a = visBefore(B, c.anchor[0]), b = visAfter(B, c.anchor[1]); if (a == null || b == null || b <= a) continue;
      (isSug ? sug : hi).push({id: c.id, a, b});
      if (isSug && c.rep) (ins.get(b) || ins.set(b, []).get(b)).push({id: c.id, rep: c.rep});
    }
    const flags = new Map();
    for (const a of activeAuthors(300000)) { const sp = lastSpot(a); if (sp != null) (flags.get(Math.min(sp, n)) || flags.set(Math.min(sp, n), []).get(Math.min(sp, n))).push(a); }
    return {hi, sug, ins, flags};
  }
  function marksHtml(B) {
    const {hi, sug, ins, flags} = reviewItems(B), n = B.vis.length, cuts = new Set([0, n]);
    [...hi, ...sug].forEach(x => { cuts.add(x.a); cuts.add(Math.min(x.b, n)); });
    ins.forEach((_v, k) => cuts.add(Math.min(k, n))); flags.forEach((_v, k) => cuts.add(k));
    if (D.auth) for (let i = 1; i < n; i++) if (B.vis[i].a !== B.vis[i - 1].a) cuts.add(i);
    const pts = [...cuts].sort((x, y) => x - y); let h = '';
    const extra = k => (ins.get(k) || []).map(x => `<ins class="dx-ins ${x.id === D.selCm ? 'sel' : ''}" data-cmref="${esc(x.id)}">${esc(x.rep)}</ins>`).join('')
      + (flags.get(k) || []).map(a => `<span class="dx-flag ${Date.now() - Date.parse(D.R.ops[a][D.R.ops[a].length - 1].at) < 20000 ? '' : 'old'}" style="--c:${auHue(a)}" data-n="${esc(peopleName(a).split(' ')[0])}"></span>`).join('');
    for (let k = 0; k < pts.length; k++) {
      h += extra(pts[k]);
      const a = pts[k], b = pts[k + 1]; if (b == null || b <= a) continue;
      const cm = hi.filter(x => x.a <= a && x.b >= b).map(x => x.id), sg = sug.filter(x => x.a <= a && x.b >= b).map(x => x.id), all = [...sg, ...cm];
      const cls = ['dx-t', cm.length ? 'dx-cm' : '', sg.length ? 'dx-del' : '', all.includes(D.selCm) ? 'sel' : '', D.auth ? 'dx-au' : ''].filter(Boolean).join(' ');
      h += `<span class="${cls}" data-a="${a}" ${all.length ? `data-cmref="${all.map(esc).join(' ')}"` : ''} ${D.auth ? `style="--c:${auHue(B.vis[a].a)}" title="${esc(peopleName(B.vis[a].a))}"` : ''}>${esc(B.text.slice(B.off[a], B.off[b]))}</span>`;
    }
    return h || '<span class="muted">Empty document.</span>';
  }
  function legendHtml() {
    const R = D.R, counts = {}; R.B.vis.forEach(n => { counts[n.a] = (counts[n.a] || 0) + 1; });
    const tot = R.B.vis.length || 1;
    return `<div class="dx-legend">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<span><i style="background:hsl(${auHue(a)} 62% 52%)"></i>${esc(peopleName(a))} ${Math.round(100 * n / tot)}%</span>`).join('')}</div>`;
  }
  function paintPage() {
    const pg = $('#dx-page', D.host); if (!pg) return;
    const R = D.R, W = D.can;
    if (D.view) {   // looking at an older version
      const B = D.view.B;
      pg.innerHTML = `<div class="dx-viewbar"><span>${ic('clock')} You are looking at <b>${esc(D.view.label)}</b>. Nothing was changed.</span><span class="grow"></span>
        ${W ? '<button class="btn small primary" data-dx="restore">Restore this version</button>' : ''}<button class="btn small" data-dx="leave-view">Back to the current text</button></div>
        <div class="dx-src dx-readonly">${esc(B.text) || '<span class="muted">Empty at that point.</span>'}</div>`;
      return;
    }
    if (D.mode === 'write') {
      pg.innerHTML = `<textarea id="dx-text" class="dx-text" spellcheck="true" ${W ? '' : 'readonly'} placeholder="${W ? 'Start writing…  Use # for headings, **bold**, - for lists, [@Smith2020] to cite a paper.' : ''}" aria-label="Document text"></textarea>`;
      const ta = $('#dx-text', pg); ta.value = R.B.text; autosize(ta);
    } else if (D.mode === 'marks') {
      pg.innerHTML = `<div class="dx-revbar">${W ? '<span class="muted small">Select some text to comment on it or suggest a change.</span>' : ''}<span class="grow"></span><label class="dx-chk"><input type="checkbox" data-dx-auth ${D.auth ? 'checked' : ''}> Colour by writer</label></div>${D.auth ? legendHtml() : ''}<div class="dx-src" id="dx-src">${marksHtml(R.B)}</div>`;
    } else {
      pg.innerHTML = previewHtml(R.B, R.title);
    }
  }
  const autosize = ta => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 4, 420) + 'px'; };

  // a remote change arrived: new text, keep the cursor where it was (by character, not by number)
  function applyRemote() {
    const R = D.R, old = R.B;
    const ta = $('#dx-text', D.host), focus = ta && document.activeElement === ta;
    let selA = null, selB = null;
    if (ta && D.mode === 'write') {
      const s = offToIdx(old, ta.selectionStart), e = offToIdx(old, ta.selectionEnd);
      selA = s ? [old.vis[s - 1].c, old.vis[s - 1].a] : null; selB = e ? [old.vis[e - 1].c, old.vis[e - 1].a] : null;
    }
    const prevText = old.text; rebuild();
    if (D.view) { paintSide(); paintNow(); return; }
    if (ta && D.mode === 'write') {
      if (D.composing) { D.late = true; paintSide(); return; }
      if (ta.value !== R.B.text) {
        const sc = window.scrollY, top = ta.scrollTop; ta.value = R.B.text; autosize(ta);
        const pos = id => id ? (visAfter(R.B, id) ?? 0) : 0;
        if (focus) { const a = R.B.off[pos(selA)], b = R.B.off[pos(selB)]; ta.setSelectionRange(a, Math.max(a, b)); }
        ta.scrollTop = top; if (window.scrollY !== sc) window.scrollTo(0, sc);
      }
    } else if (prevText !== R.B.text || D.mode !== 'write') paintPage();
    paintSide(); paintNow();
  }

  /* ------------------------------------------------------------- side panel */
  const sideTab = (id, label, n) => `<button data-dx-side="${id}" class="${D.side === id ? 'on' : ''}">${label}${n ? `<span class="lab-n">${n}</span>` : ''}</button>`;
  function paintSide() {
    const el = $('#dx-side', D.host); if (!el || !D.R) return;
    const R = D.R, openN = R.comments.filter(c => !c.parent && c.state === 'open').length;
    const keep = $('.dx-sbody', el)?.scrollTop || 0, draft = $('#dx-cnew', el)?.value, foc = document.activeElement?.id === 'dx-cnew';
    el.innerHTML = `<div class="dx-stabs">${sideTab('comments', 'Comments', openN)}${sideTab('cite', 'Cite', '')}${sideTab('history', 'History', '')}</div>
      <div class="dx-sbody">${D.side === 'cite' ? citeHtml() : D.side === 'history' ? historyHtml() : commentsHtml()}</div>`;
    const sb = $('.dx-sbody', el); if (sb) sb.scrollTop = keep;
    if (draft != null && $('#dx-cnew', el)) { $('#dx-cnew', el).value = draft; if (foc) $('#dx-cnew', el).focus(); }
  }
  function commentsHtml() {
    const R = D.R, B = R.B, W = D.can;
    const top = R.comments.filter(c => !c.parent), kids = id => R.comments.filter(c => c.parent === id);
    const shown = top.filter(c => D.filter === 'all' || c.state === 'open');
    const nDone = top.length - top.filter(c => c.state === 'open').length;
    const card = c => {
      const a = c.anchor ? visBefore(B, c.anchor[0]) : null, b = c.anchor ? visAfter(B, c.anchor[1]) : null, gone = c.ins ? (c.anchor && b == null) : c.anchor && (a == null || b == null || b <= a);
      const now = !gone && c.anchor ? textOf(B, a, b) : '', sug = c.rep != null;
      return `<div class="dx-c ${c.state} ${D.selCm === c.id ? 'sel' : ''}" data-cm="${esc(c.id)}">
        <div class="dx-c-h">${av(c.by, c.name, 22)}<b>${esc(c.name)}</b><span class="muted small">${esc(ago(c.created))}</span>${sug ? '<span class="dx-tag">suggestion</span>' : ''}${c.state !== 'open' ? `<span class="dx-tag ${c.state}">${c.state}</span>` : ''}</div>
        ${sug ? `<button class="dx-sugline ${gone ? 'gone' : ''}" data-dx-goto="${esc(c.id)}" title="Show in the text">${c.ins ? `<span class="muted small">Insert</span> <ins>${esc(truncate(c.rep, 300))}</ins>`
            : `<span class="muted small">${c.rep ? 'Replace' : 'Delete'}</span> <del>${esc(truncate(gone ? c.quote : now, 160))}</del>${c.rep ? ` <span class="muted small">with</span> <ins>${esc(truncate(c.rep, 300))}</ins>` : ''}`}</button>`
          : c.anchor ? `<button class="dx-quote ${gone ? 'gone' : ''}" data-dx-goto="${esc(c.id)}" title="${gone ? 'The text was deleted' : 'Show in the text'}">${gone ? `<i>${esc(c.quote || 'Text deleted')}</i>` : esc(truncate(now, 140))}</button>` : ''}
        ${c.body ? `<div class="dx-c-b">${esc(c.body).replace(/\n/g, '<br>')}</div>` : ''}
        ${kids(c.id).map(k => `<div class="dx-reply"><div class="dx-c-h">${av(k.by, k.name, 18)}<b>${esc(k.name)}</b><span class="muted small">${esc(ago(k.created))}</span>${k.mine && W ? `<button class="dx-x" data-dx-cdel="${esc(k.id)}" title="Delete">✕</button>` : ''}</div><div class="dx-c-b">${esc(k.body).replace(/\n/g, '<br>')}</div></div>`).join('')}
        ${W ? `<div class="dx-c-a">
          ${c.state === 'open' && sug && !gone ? `<button class="btn small primary" data-dx-accept="${esc(c.id)}">${ic('check')}Accept</button><button class="btn small" data-dx-res="${esc(c.id)}|rejected">Reject</button>`
            : c.state === 'open' ? `<button class="btn small" data-dx-res="${esc(c.id)}|resolved">${ic('check')}Resolve</button>` : `<button class="btn small" data-dx-res="${esc(c.id)}|open">Reopen</button>`}
          <button class="btn small" data-dx-reply="${esc(c.id)}">Reply</button>${c.mine ? `<button class="dx-x" data-dx-cdel="${esc(c.id)}" title="Delete">✕</button>` : ''}</div>` : ''}
      </div>`;
    };
    return `${W ? `<div class="dx-cnewbox"><textarea id="dx-cnew" class="input" rows="2" placeholder="${D.sel ? 'Comment on the selected text…' : 'Select some text in the document, then write your comment here'}"></textarea>
        <div class="dx-row"><button class="btn small primary" data-dx="comment-add">${ic('chat')}Comment</button><button class="btn small" data-dx="suggest-add" title="Propose new wording for the selected text">${ic('pen')}Suggest change</button></div></div>` : ''}
      <div class="dx-cfilter"><span class="muted small">${shown.length} shown</span><span class="grow"></span>${nDone ? `<button class="dx-link" data-dx="toggle-filter">${D.filter === 'all' ? 'Hide' : 'Show'} ${nDone} done</button>` : ''}</div>
      ${shown.length ? shown.map(card).join('') : `<p class="muted small dx-none">${top.length ? 'Nothing open. Everything is resolved.' : 'No comments yet. Select a piece of text and write what you think.'}</p>`}`;
  }
  function citeHtml() {
    const P = D.R.papers || [];
    return `<p class="muted small">Click a paper to put its citation in the text. The reference list is written for you in Preview and when you export.</p>
      ${P.length > 6 ? '<input class="input" id="dx-cq" placeholder="Search the group\'s papers" style="margin-bottom:8px">' : ''}
      <div id="dx-plist">${P.map(p => `<button class="dx-paper" data-dx-cite="${esc(p.label)}" data-s="${esc((p.label + ' ' + p.title).toLowerCase())}"><b>${esc(p.cite)}</b><span>${esc(truncate(p.title, 110))}</span><code>[@${esc(p.label)}]</code></button>`).join('') || '<p class="muted small dx-none">The group has no papers yet. Add papers to the group in the library, then cite them here.</p>'}</div>`;
  }
  function sessions() {
    const R = D.R, all = [];
    for (const [a, log] of Object.entries(R.ops)) log.forEach(op => all.push({a, op}));
    all.sort((x, y) => (x.op.c - y.op.c) || (x.a < y.a ? -1 : 1));
    const out = []; let cur = null;
    for (const {a, op} of all) {
      const t = Date.parse(op.at) || 0;
      if (!cur || cur.a !== a || t - cur.t1 > 600000) { cur = {a, t0: t, t1: t, upto: opEnd(op), add: 0, del: 0}; out.push(cur); }
      cur.t1 = t; cur.upto = Math.max(cur.upto, opEnd(op));
      if (op.k === 'i') cur.add += Array.from(op.t).length; else cur.del += op.r.reduce((s, r) => s + r[2], 0);
    }
    return out.reverse().slice(0, 40);
  }
  function historyHtml() {
    const R = D.R, S = sessions();
    return `${D.can ? `<div class="dx-cnewbox"><div class="dx-row"><input class="input" id="dx-vl" maxlength="80" placeholder="Name this version (e.g. Submitted draft)"><button class="btn small" data-dx="snap">${ic('save')}Save</button></div></div>` : ''}
      ${R.snaps.length ? `<h4 class="dx-h">Saved versions</h4>${R.snaps.slice().reverse().map(s => `<button class="dx-ver" data-dx-ver="${s.upto}|${esc(s.label)}">${ic('save')}<span><b>${esc(s.label)}</b><small>${esc(s.name)} · ${esc(ago(s.created))}</small></span></button>`).join('')}` : ''}
      <h4 class="dx-h">Editing history</h4>
      ${S.length ? S.map(s => `<button class="dx-ver" data-dx-ver="${s.upto}|${esc(peopleName(s.a))}, ${esc(new Date(s.t1).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}))}">${av(s.a, peopleName(s.a), 22)}<span><b>${esc(peopleName(s.a))}</b><small>${esc(ago(new Date(s.t1).toISOString()))} · ${s.add ? '+' + num(s.add) : ''}${s.add && s.del ? ' ' : ''}${s.del ? '−' + num(s.del) : ''} characters</small></span></button>`).join('') : '<p class="muted small dx-none">Nothing written yet.</p>'}
      <p class="muted small">Click an entry to see the document as it was right after it. You can restore any version: it becomes a new edit, so nothing is lost.</p>`;
  }

  /* ------------------------------------------------------------- selection, formatting, comments */
  function selection() {
    const ta = $('#dx-text', D.host); if (!ta) return D.sel;
    const B = D.R.B, a = offToIdx(B, ta.selectionStart), b = offToIdx(B, ta.selectionEnd);
    return {a, b, start: ta.selectionStart, end: ta.selectionEnd, ta};
  }
  const anchorFor = (B, a, b) => [[B.vis[a].c, B.vis[a].a], [B.vis[b - 1].c, B.vis[b - 1].a]];
  function wrap(kind) {
    const ta = $('#dx-text', D.host); if (!ta || !D.can) return;
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
    let out, from = s, to = e;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const prefixLine = p => { const L = v.slice(lineStart, e); out = v.slice(0, lineStart) + L.split('\n').map(l => p(l)).join('\n') + v.slice(e); to = lineStart + L.split('\n').map(l => p(l)).join('\n').length; from = lineStart; };
    switch (kind) {
      case 'bold': out = v.slice(0, s) + '**' + (sel || 'bold text') + '**' + v.slice(e); from = s + 2; to = from + (sel || 'bold text').length; break;
      case 'italic': out = v.slice(0, s) + '*' + (sel || 'italic text') + '*' + v.slice(e); from = s + 1; to = from + (sel || 'italic text').length; break;
      case 'code': out = v.slice(0, s) + '`' + (sel || 'code') + '`' + v.slice(e); from = s + 1; to = from + (sel || 'code').length; break;
      case 'link': { const t = sel || 'link text'; out = v.slice(0, s) + `[${t}](https://)` + v.slice(e); from = s + t.length + 3; to = from + 8; break; }
      case 'h1': case 'h2': case 'h3': { const h = '#'.repeat(+kind[1]) + ' '; prefixLine(l => h + l.replace(/^#{1,6}\s+/, '')); break; }
      case 'ul': prefixLine(l => l.startsWith('- ') ? l.slice(2) : '- ' + l); break;
      case 'ol': { let n = 0; prefixLine(l => /^\d+\.\s/.test(l) ? l.replace(/^\d+\.\s/, '') : `${++n}. ${l}`); break; }
      case 'quote': prefixLine(l => l.startsWith('> ') ? l.slice(2) : '> ' + l); break;
      default: return;
    }
    ta.value = out; ta.setSelectionRange(from, to); ta.focus(); editTo(out); autosize(ta); paintSide();
  }
  function insertAtCursor(text) {
    const ta = $('#dx-text', D.host); if (!ta || !D.can) { toast('Switch to Write mode to insert text.'); return; }
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    ta.value = v.slice(0, s) + text + v.slice(e); const p = s + text.length; ta.setSelectionRange(p, p); ta.focus();
    editTo(ta.value); autosize(ta); paintSide();
  }
  async function createComment({a, b, body = '', rep = null, ins = false}) {
    const R = D.R, B = R.B; let anchor = null, quote = '';
    if (ins) { if (a > 0) { anchor = [[B.vis[a - 1].c, B.vis[a - 1].a], [B.vis[a - 1].c, B.vis[a - 1].a]]; quote = B.vis[a - 1].ch; } }
    else if (b > a) { anchor = anchorFor(B, a, b); quote = selText({a, b}).slice(0, 300); }
    try {
      const r = await api(`${base()}/${q(D.id)}/comments`, {method: 'POST', body: {body, anchor, quote, rep, ins}});
      absorb(r); D.side = 'comments'; applyRemote(); paintSide(); return true;
    } catch (err) { toast(err.message, 'error'); return false; }
  }
  async function addComment(suggest) {
    if (!D.can) return;
    const R = D.R, S = D.rsel || selection(), box = $('#dx-cnew', D.host), body = (box?.value || '').trim();
    const sel = S && S.b > S.a && S.b <= R.B.vis.length ? S : null;
    if (suggest && !sel) { toast('Select the text you want to change first.'); return; }
    let rep = null;
    if (suggest) { rep = await askText('Suggest a change', 'New wording for the selected text (leave empty to suggest deleting it).', selText(sel)); if (rep === null) return; }
    else if (!body) { toast('Write your comment first.'); box?.focus(); return; }
    if (!suggest && !sel) { toast('Select the text this comment is about first.'); return; }
    if (await createComment({a: sel.a, b: sel.b, body, rep}) && box) box.value = '';
  }
  const selText = S => D.R.B.text.slice(D.R.B.off[S.a], D.R.B.off[S.b]);
  function askText(title, hint, value) {
    return new Promise(resolve => {
      const m = modal(`<h3>${esc(title)}</h3><p class="muted small">${esc(hint)}</p><textarea class="input" id="dx-ask" rows="5" style="width:100%">${esc(value || '')}</textarea>
        <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dx-ask-ok">Suggest</button></div>`);
      let res = null; m.onclose = () => resolve(res); $('#dx-ask-ok', m.el).onclick = () => { res = $('#dx-ask', m.el).value; m.close(); };
      setTimeout(() => $('#dx-ask', m.el).focus(), 40);
    });
  }
  async function cmCall(method, path, body) {
    try { const r = await api(`${base()}/${q(D.id)}/comments${path}`, {method, body}); absorb(r); applyRemote(); paintSide(); return r; }
    catch (err) { toast(err.message, 'error'); return null; }
  }
  // put a new text in the document (as one edit by me), wherever the person is looking
  function applyNewText(next) {
    editTo(next);
    const ta = $('#dx-text', D.host); if (ta) { ta.value = D.R.B.text; autosize(ta); } else paintPage();
  }
  async function acceptSuggestion(id) {
    const c = D.R.comments.find(x => x.id === id); if (!c || !D.can) return;
    const B = D.R.B; let a, b;
    if (c.ins) { a = b = c.anchor ? visAfter(B, c.anchor[1]) : 0; if (a == null) { toast('The text next to this insertion was deleted.'); return; } }
    else {
      a = visBefore(B, c.anchor[0]); b = visAfter(B, c.anchor[1]);
      if (a == null || b == null || b <= a) { toast('The text of this suggestion was deleted.'); return; }
      if (c.quote && selText({a, b}).slice(0, 300) !== c.quote && !await confirmBox('The text has changed', 'This part of the text was edited after the suggestion was made. Replace it anyway?', {ok: 'Replace'})) return;
    }
    applyNewText(B.text.slice(0, B.off[a]) + (c.rep || '') + B.text.slice(B.off[b]));
    await cmCall('POST', `/${q(id)}/resolve`, {state: 'accepted'});
  }
  function gotoComment(id) {
    const c = D.R.comments.find(x => x.id === id); if (!c || !c.anchor && !c.ins) return;
    const B = D.R.B, a = c.anchor ? visBefore(B, c.anchor[0]) : 0, b = c.anchor ? visAfter(B, c.anchor[1]) : 0; if (!c.ins && (a == null || b == null || b <= a)) return;
    D.selCm = id; if (D.mode === 'write') { D.mode = 'marks'; paint(); }
    if (D.mode === 'preview') { D.mode = 'marks'; paint(); }
    if (D.mode === 'write' && c.ins) { /* nothing to select */ }
    else if (D.mode === 'write') { const ta = $('#dx-text', D.host); ta.focus(); ta.setSelectionRange(B.off[a], B.off[b]); const line = B.text.slice(0, B.off[a]).split('\n').length; ta.blur(); ta.focus(); const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24; window.scrollTo({top: ta.getBoundingClientRect().top + window.scrollY + (line - 3) * lh - 120, behavior: 'smooth'}); }
    else { paintPage(); ($('.dx-ins.sel', D.host) || $('.dx-t.sel', D.host))?.scrollIntoView({block: 'center', behavior: 'smooth'}); }
    paintSide();
  }

  /* ------------------------------------------------------------- versions */
  function viewAt(upto, label) {
    const ops = D.R.ops, B = build(ops, upto); D.view = {upto, label, B}; paintPage();
  }
  async function restore() {
    const v = D.view; if (!v || !D.can) return;
    if (!await confirmBox('Restore this version?', `The document will go back to "${v.label}". It is saved as a new edit, so the current text stays in the history.`, {ok: 'Restore'})) return;
    const text = v.B.text; D.view = null; D.mode = 'write'; paint();
    applyNewText(text); toast('Version restored.');
  }

  /* ------------------------------------------------------------- selecting text in Review: comment / suggest, like Google Docs */
  function domPoint(node, off) {
    const el = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('.dx-t'); if (!el || node.nodeType !== 3) return null;
    const B = D.R.B, abs = B.off[+el.dataset.a] + off; return offToIdx(B, abs);
  }
  function readSelection() {
    const sel = window.getSelection(), src = $('#dx-src', D.host); if (!sel || !sel.rangeCount || !src || !src.contains(sel.anchorNode) || !src.contains(sel.focusNode)) return null;
    const r = sel.getRangeAt(0), a = domPoint(r.startContainer, r.startOffset), b = domPoint(r.endContainer, r.endOffset);
    if (a == null || b == null) return null;
    return {a: Math.min(a, b), b: Math.max(a, b), rect: r.getBoundingClientRect()};
  }
  function hideBubble() { $('.dx-bubble')?.remove(); $('.dx-comp')?.remove(); }
  function placeAt(el, rect) {
    document.body.appendChild(el); const w = el.offsetWidth, h = el.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2, y = rect.top - h - 8; if (y < 8) y = rect.bottom + 8;
    el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; el.style.top = Math.max(8, y) + 'px';
  }
  function showBubble() {
    hideBubble(); if (!D.can || D.mode !== 'marks' || D.view) return;
    const S = readSelection(); D.rsel = S; if (!S) return;
    const el = document.createElement('div'); el.className = 'dx-bubble'; el.setAttribute('role', 'toolbar');
    el.innerHTML = S.b > S.a ? `<button data-bub="comment">${ic('chat')}Comment</button><button data-bub="replace">${ic('pen')}Suggest edit</button><button data-bub="delete">${ic('trash')}Suggest deleting</button>`
      : `<button data-bub="insert">${ic('plus')}Suggest inserting text here</button>`;
    el.addEventListener('mousedown', e => e.preventDefault());       // keep the selection while clicking
    el.addEventListener('click', e => { const k = e.target.closest('[data-bub]')?.dataset.bub; if (k) composer(k, S); });
    placeAt(el, S.rect);
  }
  function composer(kind, S) {
    hideBubble(); const B = D.R.B, old = S.b > S.a ? selText(S) : '';
    const el = document.createElement('div'); el.className = 'dx-comp';
    const title = {comment: 'Comment', replace: 'Suggest an edit', insert: 'Suggest inserting text', delete: 'Suggest deleting this text'}[kind];
    el.innerHTML = `<div class="dx-comp-t">${esc(title)}</div>${old ? `<div class="dx-comp-q">${esc(truncate(old, 160))}</div>` : ''}
      ${kind === 'delete' ? '' : `<textarea class="input" rows="${kind === 'comment' ? 3 : 4}" placeholder="${kind === 'comment' ? 'Write a comment…' : kind === 'insert' ? 'Text to insert' : 'New wording'}">${kind === 'replace' ? esc(old) : ''}</textarea>`}
      ${kind === 'comment' || kind === 'delete' ? '' : '<input class="input dx-why" maxlength="300" placeholder="Why? (optional)">'}
      <div class="dx-row"><button class="btn small primary" data-ok>${kind === 'comment' ? 'Comment' : 'Suggest'}</button><button class="btn small" data-no>Cancel</button></div>`;
    placeAt(el, S.rect);
    const ta = $('textarea', el); if (ta) { ta.focus(); if (kind === 'replace') ta.select(); }
    $('[data-no]', el).onclick = () => el.remove();
    const go = async () => {
      const txt = ta ? ta.value : '', why = $('.dx-why', el)?.value.trim() || '';
      if (kind === 'comment' && !txt.trim()) { ta.focus(); return; }
      if (kind === 'insert' && !txt) { ta.focus(); return; }
      if (kind === 'replace' && txt === old) { toast('Change the text first.'); return; }
      const ok = await createComment(kind === 'comment' ? {a: S.a, b: S.b, body: txt} : kind === 'delete' ? {a: S.a, b: S.b, rep: ''} : kind === 'insert' ? {a: S.a, b: S.a, rep: txt, body: why, ins: true} : {a: S.a, b: S.b, rep: txt, body: why});
      if (ok) { el.remove(); window.getSelection()?.removeAllRanges(); }
    };
    $('[data-ok]', el).onclick = go;
    el.addEventListener('keydown', e => { if (e.key === 'Escape') el.remove(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
    if (kind === 'delete') go();
  }
  function moreMenu(btn) {
    $('.dx-pop')?.remove(); const R = D.R;
    const pop = document.createElement('div'); pop.className = 'dx-pop';
    pop.innerHTML = `${D.can ? `<button data-dx="archive">${R.arch ? 'Move back to documents' : 'Archive'}</button>` : ''}${R.canDelete ? '<button class="danger" data-dx="delete">Delete document…</button>' : ''}`;
    btn.parentElement.appendChild(pop); setTimeout(() => document.addEventListener('click', () => pop.remove(), {once: true}), 0);
  }
  async function deleteDoc() {
    if (!await confirmBox('Delete this document for the group?', 'It stops being shared and disappears from your list. The other members keep their copy on their own computer until they remove it themselves, so nobody loses work suddenly. This cannot be undone.', {ok: 'Delete', danger: true})) return;
    try { await flushNow(); const r = await api(`${base()}/${q(D.id)}`, {method: 'DELETE'}); D.list = r.docs; stopPoll(); D.id = null; D.R = null; paintList(); toast('Document deleted.'); } catch (err) { toast(err.message, 'error'); }
  }
  async function purgeDoc(id) {
    if (!await confirmBox('Remove from this computer?', 'The text of this deleted document is erased from this computer. Export it first if you still need it.', {ok: 'Remove', danger: true})) return;
    try { const r = await api(`${base()}/${q(id)}`, {method: 'DELETE'}); D.list = r.docs; stopPoll(); if (D.id === id) { D.id = null; D.R = null; } paintList(); toast('Removed from this computer.'); } catch (err) { toast(err.message, 'error'); }
  }
  async function archiveDoc() {
    try { const r = await api(`${base()}/${q(D.id)}`, {method: 'PUT', body: {arch: !D.R.arch}}); D.list = r.docs; D.R.arch = !D.R.arch; toast(D.R.arch ? 'Archived.' : 'Back in your documents.'); } catch (err) { toast(err.message, 'error'); }
  }

  /* ------------------------------------------------------------- own window and side by side with the library */
  async function openWindow() {
    await flushNow();
    const url = `/?doc=${q(D.sid)}/${q(D.id)}`, w = window.open(url, 'ps-doc-' + D.id, 'popup=yes,width=1040,height=920');
    if (!w) { toast('Your browser blocked the new window. Allow pop-ups for PaperShelf and try again.', 'error'); return; }
    D.ext.add(D.sid + '/' + D.id); stopPoll(); D.id = null; D.R = null; D.view = null; hideBubble();
    await loadList(); paintList(); toast('The document is open in its own window. Write there; this window is free for your library.');
  }
  function setSplit(on) {
    D.split = on; D.host.classList.toggle('split', on); document.body.classList.toggle('dx-split-on', on);
    const lib = $('#dx-lib', D.host);
    if (on && lib && !$('iframe', lib)) {
      lib.innerHTML = `<div class="dx-libbar"><b>${ic('books')} Your library</b><span class="muted small">Read papers and take notes while you write</span><span class="grow"></span><button class="btn small" data-dx="split">Close</button></div><iframe title="Your library" src="/?embed=1"></iframe>`;
      $('iframe', lib).addEventListener('load', e => { try { e.target.contentWindow.setTab?.('library'); } catch (err) { /* ignore */ } });
    }
    if (D.R) paint();
  }

  /* ------------------------------------------------------------- export */
  function exportMenu(btn) {
    $('.dx-pop')?.remove();
    const pop = document.createElement('div'); pop.className = 'dx-pop';
    pop.innerHTML = [['docx', 'Word document (.docx)'], ['md', 'Markdown (.md)'], ['txt', 'Plain text (.txt)'], ['pdf', 'PDF (print…)']].map(([k, l]) => `<button data-dx-exp="${k}">${l}</button>`).join('');
    btn.parentElement.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), {once: true}), 0);
  }
  async function doExport(kind) {
    await flushNow();
    if (kind === 'pdf') {
      const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups for PaperShelf to print.', 'error'); return; }
      const html = previewHtml(D.R.B, D.R.title);
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(D.R.title)}</title><style>body{font:12pt/1.5 Georgia,'Times New Roman',serif;max-width:700px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:22pt}h2{font-size:16pt;margin-top:1.4em}h3{font-size:13pt}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:14px;color:#444}code{background:#f2f2f2;padding:0 3px}.dx-refs li{margin:.3em 0}</style>${html}<script>setTimeout(()=>print(),300)<\/script>`);
      w.document.close(); return;
    }
    const a = document.createElement('a'); a.href = `${base()}/${q(D.id)}/export?format=${kind}`; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------- events */
  function bind(host) {
    host.addEventListener('input', e => {
      if (e.target.id === 'dx-text') {
        if (D.composing) return; if (!D.can) return;
        editTo(e.target.value); autosize(e.target); paintNow(); D.sel = selection();
        const open = D.R.comments.length; if (open) paintSideSoon();
      } else if (e.target.id === 'dx-cq') {
        const v = e.target.value.toLowerCase(); $$('#dx-plist .dx-paper', host).forEach(b => { b.hidden = !!v && !b.dataset.s.includes(v); });
      }
    });
    host.addEventListener('compositionstart', e => { if (e.target.id === 'dx-text') D.composing = true; });
    host.addEventListener('compositionend', e => { if (e.target.id === 'dx-text') { D.composing = false; editTo(e.target.value); autosize(e.target); if (D.late) { D.late = false; applyRemote(); } } });
    host.addEventListener('mouseup', e => { if (D.mode === 'marks' && e.target.closest('#dx-src') && !e.target.closest('[data-cmref]')) setTimeout(showBubble, 10); });
    host.addEventListener('keyup', e => { if (D.mode === 'marks' && e.shiftKey && e.target.closest?.('#dx-src, body')) setTimeout(showBubble, 10); });
    document.addEventListener('mousedown', e => { if (!e.target.closest('.dx-bubble, .dx-comp') && !e.target.closest('#dx-src')) hideBubble(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideBubble(); });
    host.addEventListener('change', e => { if (e.target.matches('[data-dx-auth]')) { D.auth = e.target.checked; paintPage(); } });
    host.addEventListener('select', e => { if (e.target.id === 'dx-text') D.sel = selection(); });
    host.addEventListener('keyup', e => { if (e.target.id === 'dx-text') D.sel = selection(); });
    host.addEventListener('mouseup', e => { if (e.target.id === 'dx-text') D.sel = selection(); });
    host.addEventListener('change', async e => {
      if (e.target.id === 'dx-title' && D.can) {
        try { await api(`${base()}/${q(D.id)}`, {method: 'PUT', body: {title: e.target.value}}); D.R.title = e.target.value.trim() || 'Untitled document'; } catch (err) { toast(err.message, 'error'); }
      }
    });
    host.addEventListener('keydown', e => {
      if (e.target.id === 'dx-text' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase(); if (k === 'b') { e.preventDefault(); wrap('bold'); } else if (k === 'i') { e.preventDefault(); wrap('italic'); }
      }
      if (e.target.id === 'dx-text' && (e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); D.side = 'comments'; paintSide(); $('#dx-cnew', host)?.focus(); }
      if (e.target.id === 'dx-text' && e.key === 'Enter' && D.can && !e.shiftKey && !e.metaKey && !e.ctrlKey) {   // continue a list
        const t = e.target, s = t.selectionStart, ls = t.value.lastIndexOf('\n', s - 1) + 1, line = t.value.slice(ls, s), m = line.match(/^(\s*)(- \[[ x]\] |[-*] |(\d+)\. |> )(.*)$/);
        if (m && s === t.selectionEnd) {
          e.preventDefault();
          if (!m[4].trim()) { t.value = t.value.slice(0, ls) + t.value.slice(s); t.setSelectionRange(ls, ls); editTo(t.value); autosize(t); return; }   // an empty item ends the list
          const nxt = m[3] ? `${m[1]}${+m[3] + 1}. ` : m[2].startsWith('- [') ? `${m[1]}- [ ] ` : m[1] + m[2];
          t.value = t.value.slice(0, s) + '\n' + nxt + t.value.slice(t.selectionEnd); const p = s + 1 + nxt.length; t.setSelectionRange(p, p); editTo(t.value); autosize(t);
        }
      }
    });
    host.addEventListener('click', async e => {
      const t = e.target;
      const open = t.closest('[data-dx-open]'); if (open) { await openDoc(open.dataset.dxOpen); return; }
      const dx = t.closest('[data-dx]')?.dataset.dx;
      if (dx === 'new') return newDialog();
      if (dx === 'toggle-arch') { D.showArch = !D.showArch; return paintList(); }
      if (dx === 'back') return closeDoc();
      if (dx === 'more-menu') { e.stopPropagation(); return moreMenu(t.closest('button')); }
      if (dx === 'archive') return archiveDoc();
      if (dx === 'delete') return deleteDoc();
      if (dx === 'purge') return purgeDoc(D.id);
      if (dx === 'window') return openWindow();
      if (dx === 'split') return setSplit(!D.split);
      const pg = t.closest('[data-dx-purge]')?.dataset.dxPurge; if (pg) return purgeDoc(pg);
      if (dx === 'export-menu') { e.stopPropagation(); return exportMenu(t.closest('button')); }
      if (dx === 'comment-add') return addComment(false);
      if (dx === 'suggest-add') return addComment(true);
      if (dx === 'toggle-filter') { D.filter = D.filter === 'all' ? 'open' : 'all'; paintPage(); return paintSide(); }
      if (dx === 'snap') { const l = $('#dx-vl', host).value; try { const r = await api(`${base()}/${q(D.id)}/snaps`, {method: 'POST', body: {label: l}}); absorb(r); paintSide(); toast('Version saved.'); } catch (err) { toast(err.message, 'error'); } return; }
      if (dx === 'restore') return restore();
      if (dx === 'leave-view') { D.view = null; paintPage(); return; }
      const mode = t.closest('[data-dx-mode]')?.dataset.dxMode; if (mode) { D.sel = selection(); D.mode = mode; D.view = null; paint(); return; }
      const side = t.closest('[data-dx-side]')?.dataset.dxSide; if (side) { D.side = side; return paintSide(); }
      const fmt = t.closest('[data-fmt]')?.dataset.fmt;
      if (fmt) { if (fmt === 'comment' || fmt === 'suggest') { D.sel = selection(); D.side = 'comments'; paintSide(); if (fmt === 'suggest') return addComment(true); $('#dx-cnew', host)?.focus(); return; } if (fmt === 'cite') { D.side = 'cite'; return paintSide(); } return wrap(fmt); }
      const cite = t.closest('[data-dx-cite]')?.dataset.dxCite; if (cite) { if (D.mode !== 'write') { toast('Switch to Write mode to insert a citation.'); return; } return insertAtCursor(`[@${cite}]`); }
      const res = t.closest('[data-dx-res]')?.dataset.dxRes; if (res) { const [id, st] = res.split('|'); return cmCall('POST', `/${q(id)}/resolve`, {state: st}); }
      const acc = t.closest('[data-dx-accept]')?.dataset.dxAccept; if (acc) return acceptSuggestion(acc);
      const go = t.closest('[data-dx-goto]')?.dataset.dxGoto; if (go) return gotoComment(go);
      const rep = t.closest('[data-dx-reply]')?.dataset.dxReply;
      if (rep) { const card = t.closest('.dx-c'); if ($('.dx-rbox', card)) return; const b = document.createElement('div'); b.className = 'dx-rbox'; b.innerHTML = '<textarea class="input" rows="2" placeholder="Write a reply…"></textarea><div class="dx-row"><button class="btn small primary">Reply</button><button class="btn small">Cancel</button></div>'; $('.dx-c-a', card).before(b); const ta = $('textarea', b); ta.focus(); const [ok, no] = $$('button', b); no.onclick = () => b.remove(); ok.onclick = async () => { if (ta.value.trim()) await cmCall('POST', '', {body: ta.value, parent: rep}); }; return; }
      const del = t.closest('[data-dx-cdel]')?.dataset.dxCdel; if (del) { if (await confirmBox('Delete this comment?', 'It disappears for everybody in the group.', {ok: 'Delete', danger: true})) await cmCall('DELETE', `/${q(del)}`); return; }
      const ver = t.closest('[data-dx-ver]')?.dataset.dxVer; if (ver) { const i = ver.indexOf('|'); return viewAt(+ver.slice(0, i), ver.slice(i + 1)); }
      const exp = t.closest('[data-dx-exp]')?.dataset.dxExp; if (exp) { $('.dx-pop')?.remove(); return doExport(exp); }
      const cmr = t.closest('[data-cmref]')?.dataset.cmref; if (cmr) { D.selCm = cmr.split(' ')[0]; D.side = 'comments'; paintPage(); paintSide(); $(`.dx-c[data-cm="${CSS.escape(D.selCm)}"]`, host)?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); return; }
    });
  }
  let sideT = null; const paintSideSoon = () => { clearTimeout(sideT); sideT = setTimeout(paintSide, 400); };

  window.addEventListener('beforeunload', () => { if (D.R && (D.R.ops[D.R.me] || []).length > D.R.sent) { try { navigator.sendBeacon?.(`${base()}/${q(D.id)}/ops`, new Blob([JSON.stringify({from: D.R.sent, ops: D.R.ops[D.R.me].slice(D.R.sent)})], {type: 'application/json'})); } catch (e) { /* ignore */ } } });

  /* ------------------------------------------------------------- mounting inside the Lab (or in a window of its own) */
  function paintList() { if (D.host) root().innerHTML = listHtml(); }
  const skeleton = host => { if (!$('#dx-root', host)) host.innerHTML = '<div id="dx-root"></div><div id="dx-lib"></div>'; };
  let bound = null;
  async function mount(host, sid, canWrite) {
    if (D.sid !== sid) { stopPoll(); D.id = null; D.R = null; D.list = null; D.view = null; D.showArch = false; }
    D.sid = sid; D.host = host; D.can = canWrite; skeleton(host);
    host.classList.toggle('split', D.split);
    document.body.classList.toggle('dx-split-on', D.split);
    if (bound !== host) { bind(host); bound = host; }
    if (D.split && !$('iframe', $('#dx-lib', host))) setSplit(true);
    if (D.id && D.R) { paint(); startPoll(); return; }
    root().innerHTML = '<p class="muted" style="padding:24px">Loading…</p>';
    await loadList(); if (D.host === host && !D.id) paintList();
  }
  // true while someone is writing: the lab must not redraw the page under their fingers
  const busy = sid => !!(D.R && D.id && D.sid === sid && D.host && document.body.contains(D.host));
  function leave() { stopPoll(); flushNow(); D.id = null; D.R = null; D.view = null; D.host = null; hideBubble(); document.body.classList.remove('dx-split-on'); }

  // a document in a window of its own: ?doc=<group>/<document>
  const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('papershelf-docs') : null;
  if (chan) chan.onmessage = e => {
    const m = e.data || {}, key = m.sid + '/' + m.did;
    if (m.t === 'open') D.ext.add(key); else if (m.t === 'close') { D.ext.delete(key); if (D.host && !D.id && D.sid === m.sid) loadList().then(paintList); }
  };
  async function standalone(sid, did) {
    D.standalone = true; document.body.classList.add('doc-window');
    const wrap = document.createElement('div'); wrap.id = 'docwin'; wrap.innerHTML = '<div class="docs-host"></div>'; document.body.appendChild(wrap);
    const host = $('.docs-host', wrap); D.sid = sid; D.host = host; skeleton(host); bind(host); bound = host;
    chan?.postMessage({t: 'open', sid, did}); window.addEventListener('pagehide', () => chan?.postMessage({t: 'close', sid, did}));
    await loadList(); await openDoc(did);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const qs = new URLSearchParams(location.search), d = qs.get('doc');
    if (d && d.includes('/')) { const [sid, did] = d.split('/'); standalone(sid, did); }
  });
  return {mount, busy, leave, pull, count: () => (D.list || []).filter(d => !d.arch && !d.gone).length};
})();
