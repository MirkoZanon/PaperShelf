/* PaperShelf – notes on papers.
   Private notes (🔒, only in your library) and public notes (🌐, on papers of a shared label, seen by
   every member). Notes are a small chat per paper, written in a safe Markdown with colours. */
const Notes = (() => {
  const COLORS = {red: '#d64545', orange: '#d9822b', green: '#2f9e44', blue: '#2f6fd6', purple: '#8b5cf6', grey: '#808a96', gray: '#808a96'};
  const SAFE_URL = /^(https?:\/\/|mailto:|doi:)/i;
  let cur = null; // {id, m, data, filter, showHidden, editing}

  /* ---------------------------------------------------------------- markdown (escaped first: no HTML runs) */
  function inline(t) {
    const codes = [];
    t = t.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
      let u = url.replace(/&amp;/g, '&');
      if (!SAFE_URL.test(u)) return all;
      if (/^doi:/i.test(u)) u = 'https://doi.org/' + u.slice(4);
      return `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`;
    });
    t = t.replace(/(^|[^"'>=\w])(https?:\/\/[^\s<]+[^\s<.,;:)\]])/g, (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^\w_/])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, '$1<em>$2</em>');
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>').replace(/==(.+?)==/g, '<mark>$1</mark>');
    t = t.replace(/\{(red|orange|green|blue|purple|grey|gray)\}([\s\S]+?)\{\/\}/g, (_, c, x) => `<span style="color:${COLORS[c]}">${x}</span>`);
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  }
  function md(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('\n');
    const out = []; let para = [], list = null, quote = [], inCode = false, code = [];
    const fPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const fList = () => { if (list) { out.push(`<${list.k}>${list.items.join('')}</${list.k}>`); list = null; } };
    const fQuote = () => { if (quote.length) { out.push('<blockquote>' + md(quote.join('\n').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')) + '</blockquote>'); quote = []; } };
    for (const ln of lines) {
      if (/^\s*```/.test(ln)) {
        if (inCode) { out.push('<pre><code>' + code.join('\n') + '</code></pre>'); code = []; inCode = false; }
        else { fPara(); fList(); fQuote(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(ln); continue; }
      const q = ln.match(/^\s*&gt;\s?(.*)$/);
      if (q) { fPara(); fList(); quote.push(q[1]); continue; }
      fQuote();
      if (!ln.trim()) { fPara(); fList(); continue; }
      const h = ln.match(/^(#{1,3})\s+(.*)$/);
      if (h) { fPara(); fList(); const k = h[1].length + 2; out.push(`<h${k}>${inline(h[2])}</h${k}>`); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { fPara(); fList(); out.push('<hr>'); continue; }
      const l = ln.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (l) {
        fPara();
        const k = /\d/.test(l[1][0]) ? 'ol' : 'ul';
        if (!list || list.k !== k) { fList(); list = {k, items: []}; }
        const c = l[2].match(/^\[( |x|X)\]\s+(.*)$/);
        list.items.push(c ? `<li class="task">${c[1].toLowerCase() === 'x' ? '☑' : '☐'} ${inline(c[2])}</li>` : `<li>${inline(l[2])}</li>`);
        continue;
      }
      fList(); para.push(ln);
    }
    if (inCode) out.push('<pre><code>' + code.join('\n') + '</code></pre>');
    fPara(); fList(); fQuote();
    return out.join('\n');
  }
  const plain = s => String(s || '').replace(/\{(red|orange|green|blue|purple|grey|gray)\}([\s\S]+?)\{\/\}/g, '$2')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1').replace(/\*\*|__|~~|==|`/g, '').replace(/^#{1,3}\s+/gm, '').replace(/^\s*>\s?/gm, '');

  /* ---------------------------------------------------------------- list row, detail panel */
  function counts(p) { return p.note_counts || {private: (p.note_list || []).length, public: 0}; }
  function badge(p) {
    const c = counts(p), n = c.private + c.public;
    const cls = c.private && c.public ? 'both' : c.public ? 'pub' : c.private ? 'priv' : 'none';
    const tip = n ? [c.private ? `${c.private} private` : '', c.public ? `${c.public} public` : ''].filter(Boolean).join(' + ') + ` note${n > 1 ? 's' : ''} – click to read` : 'Write a note';
    return `<button class="note-btn ${cls}" data-notes title="${tip}">📝${n ? `<b>${n}</b>` : ''}</button>`;
  }
  function detailField(p) {
    const c = counts(p), lst = p.note_list || [];
    const last = lst[lst.length - 1];
    const prev = last ? `<div class="note-prev md">${md(last.body.length > 600 ? last.body.slice(0, 600) + '…' : last.body)}</div>` : '';
    const info = c.private + c.public ? [c.private ? `🔒 ${c.private} private` : '', c.public ? `🌐 ${c.public} public` : ''].filter(Boolean).join(' · ') : 'No notes yet.';
    return `<div class="fld"><span>Notes</span><div class="notes-sum">
      <div class="notes-sum-head"><span class="muted small">${info}</span><span class="grow"></span><button class="btn small" data-act="notes">📝 ${c.private + c.public ? 'Open notes' : 'Write a note'}</button></div>${prev}</div></div>`;
  }

  /* ---------------------------------------------------------------- your name */
  async function ensureName(what = 'public notes') {
    if (state.settings.display_name) return state.settings.display_name;
    return new Promise(resolve => {
      const m = modal(`<h3>Your name for ${esc(what)}</h3>
        <p class="muted small">Shown next to your public notes and on the shared labels you create, so members know who wrote what. Use your name, initials or a nickname – it's seen only by the members of your shared labels. You can change it later in ⚙︎ Settings → General.</p>
        <input class="input wide" id="dn-in" maxlength="60" placeholder="e.g. Mirko Z. or MZ" value="${esc(state.settings.share_user || '')}">
        <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dn-ok">Save</button></div>`);
      let res = null; m.onclose = () => resolve(res);
      const go = async () => {
        const v = $('#dn-in', m.el).value.trim(); if (!v) { $('#dn-in', m.el).focus(); return; }
        try { const d = await api('/api/settings', {method: 'PUT', body: {display_name: v}}); state.settings = d.settings; res = v; m.close(); }
        catch (err) { toast(err.message, 'error'); }
      };
      $('#dn-ok', m.el).onclick = go;
      $('#dn-in', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      setTimeout(() => { $('#dn-in', m.el).focus(); $('#dn-in', m.el).select(); }, 40);
    });
  }

  /* ---------------------------------------------------------------- the notes window */
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const when = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s.slice(0, 10) : d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}); };

  function allNotes(d) {
    const out = d.private.map(n => ({...n, kind: 'private', mine: true, who: d.display_name || 'Me'}));
    const latest = {}; // everybody is shown with the name of their most recent note
    for (const g of d.public) for (const n of g.notes) if (n.name && (!latest[n.by] || (n.at || '') >= latest[n.by].at)) latest[n.by] = {name: n.name, at: n.at || ''};
    for (const g of d.public) for (const n of g.notes) out.push({...n, kind: 'public', share_id: g.share_id, share_name: g.share_name,
      who: (n.mine && d.display_name) || latest[n.by]?.name || n.name || n.by});
    return out.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  }
  function bubble(n) {
    const editing = cur.editing === n.id;
    const meta = `<span class="nb-who">${esc(n.kind === 'private' ? 'You' : n.mine ? `${n.who} (you)` : n.who)}</span>
      <span class="nb-tag ${n.kind}">${n.kind === 'private' ? '🔒 Private' : `🌐 ${esc(n.share_name)}`}</span>
      <span class="nb-time" title="${n.at && n.at !== n.created ? 'edited ' + esc(when(n.at)) : ''}">${esc(when(n.created))}${n.at && n.at !== n.created ? ' · edited' : ''}</span>`;
    const acts = n.mine
      ? `<button data-nedit title="Edit">✎</button><button data-ndel title="${n.kind === 'private' ? 'Delete' : 'Delete for everybody'}">🗑</button>`
      : `<button data-nhide title="${n.hidden ? 'Show it again' : 'Hide it on this computer (the others still see it)'}">${n.hidden ? '👁 Show' : '🙈 Hide'}</button>`;
    const avatar = n.mine ? '' : `<span class="nb-av" style="background:hsl(${hue(n.by)} 55% 46%)" title="${esc(n.by)}">${esc(initials(n.who))}</span>`;
    return `<div class="nb ${n.mine ? 'mine' : 'theirs'} ${n.kind} ${n.hidden ? 'hidden-note' : ''}" data-nid="${esc(n.id)}" data-kind="${n.kind}" data-share="${esc(n.share_id || '')}">
      ${avatar}<div class="nb-box"><div class="nb-meta">${meta}<span class="grow"></span><span class="nb-acts">${acts}</span></div>
      ${editing ? composerHtml({value: n.body, editing: true}) : `<div class="nb-body md">${md(n.body)}</div>`}</div></div>`;
  }
  function targets() {
    const d = cur.data;
    return [{v: '', label: '🔒 Private – only me', ok: true}].concat(d.public.map(g => ({v: g.share_id, label: `🌐 Public in “${g.share_name}”`, ok: g.can_write})));
  }
  function composerHtml({value = '', editing = false} = {}) {
    const tb = [['b', 'B', 'Bold'], ['i', '<i>I</i>', 'Italic'], ['s', '<s>S</s>', 'Strike-through'], ['mark', '<mark>H</mark>', 'Highlight'],
      ['h', 'H', 'Heading'], ['ul', '• List', 'List'], ['task', '☐', 'To-do item'], ['q', '❝', 'Quote'], ['code', '&lt;/&gt;', 'Code'], ['link', '🔗', 'Link']];
    const colors = Object.entries(COLORS).filter(([k]) => k !== 'gray').map(([k, c]) => `<button data-tb="color" data-c="${k}" title="${k}" class="nc-dot" style="background:${c}"></button>`).join('');
    const vis = editing ? '' : `<select class="input nc-vis" title="Who can read it">${targets().map(t => `<option value="${esc(t.v)}" ${t.ok ? '' : 'disabled'}>${esc(t.label)}${t.ok ? '' : ' (you only follow it)'}</option>`).join('')}</select>`;
    return `<div class="nc ${editing ? 'nc-edit' : ''}">
      <div class="nc-tools">${tb.map(([k, l, t]) => `<button data-tb="${k}" title="${t}">${l}</button>`).join('')}<span class="nc-sep"></span>${colors}<span class="grow"></span><button data-tb="preview" class="nc-prev-btn" title="Preview">👁 Preview</button></div>
      <textarea class="input nc-text" rows="${editing ? 4 : 3}" placeholder="Write a note… Markdown: **bold**, *italic*, ==highlight==, {red}colour{/}, - list, > quote">${esc(value)}</textarea>
      <div class="nc-preview md" style="display:none"></div>
      <div class="nc-foot">${vis}<span class="grow"></span><span class="muted small">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter</span>
        ${editing ? '<button class="btn small" data-ncancel>Cancel</button><button class="btn small primary" data-nsave>Save</button>' : '<button class="btn small primary" data-nsend>Add note</button>'}</div></div>`;
  }
  function render() {
    const d = cur.data, all = allNotes(d);
    const hiddenN = all.filter(n => n.hidden).length;
    const shown = all.filter(n => (cur.showHidden || !n.hidden) && (cur.filter === 'all' || (cur.filter === 'private' ? n.kind === 'private' : n.kind === 'public' && (cur.filter === 'public' || n.share_id === cur.filter))));
    const tabs = [['all', 'All'], ['private', '🔒 Private']].concat(d.public.length > 1 ? d.public.map(g => [g.share_id, `🌐 ${g.share_name}`]) : d.public.length ? [['public', '🌐 Public']] : []);
    const p = paperById(cur.id) || {};
    const body = $('.notes-body', cur.m.el);
    body.innerHTML = `<div class="notes-tabs">${tabs.map(([k, l]) => `<button data-nf="${esc(k)}" class="${cur.filter === k ? 'on' : ''}">${esc(l)}</button>`).join('')}
        <span class="grow"></span>${hiddenN ? `<button class="linklike small" data-nshowhidden>${cur.showHidden ? 'Hide' : 'Show'} ${hiddenN} hidden</button>` : ''}</div>
      <div class="notes-thread">${shown.length ? shown.map(bubble).join('') : `<div class="notes-empty muted">${all.length ? 'No notes in this view.' : 'No notes yet – write the first one below.'}</div>`}</div>
      ${cur.editing ? '' : composerHtml()}
      ${!d.public.length ? `<p class="muted small notes-hint">🔒 Notes are private. To discuss this paper with colleagues, put it in a <b>shared label</b>: you can then also write public notes that all its members see.</p>` : ''}`;
    $('.notes-title', cur.m.el).textContent = p.title || 'Notes';
    const th = $('.notes-thread', cur.m.el); th.scrollTop = th.scrollHeight;
    const vis = $('.nc-vis', cur.m.el);
    if (vis) { vis.value = cur.target ?? ''; if (vis.selectedOptions[0]?.disabled) vis.value = ''; vis.onchange = () => { cur.target = vis.value; }; }
    if (!cur.editing) setTimeout(() => $('.nc:not(.nc-edit) .nc-text', cur.m.el)?.focus({preventScroll: true}), 20);
    else setTimeout(() => { const t = $('.nc-edit .nc-text', cur.m.el); if (t && document.activeElement !== t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 20);
  }
  function applyCounts(d) {
    const p = paperById(cur.id); if (!p) return;
    p.note_counts = d.counts; p.note_list = d.private; p.notes = d.private.map(n => plain(n.body)).join('\n\n');
    renderList(); if (state.openId === cur.id) renderDetail();
  }
  async function call(path, opts) {
    try { const d = await api(path, opts); cur.data = d; applyCounts(d); render(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  }

  // toolbar actions
  function wrap(ta, a, b = a, ph = 'text') {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
    ta.setRangeText(a + sel + b, s, e, 'end');
    if (s === e) { ta.selectionStart = s + a.length; ta.selectionEnd = s + a.length + sel.length; }
    ta.focus();
  }
  function prefix(ta, pre) {
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', e) < 0 ? v.length : v.indexOf('\n', e);
    const block = v.slice(ls, le).split('\n').map(l => pre + l).join('\n');
    ta.setRangeText(block, ls, le, 'end'); ta.focus();
  }
  function tool(btn) {
    const nc = btn.closest('.nc'), ta = $('.nc-text', nc), k = btn.dataset.tb;
    if (k === 'preview') {
      const pv = $('.nc-preview', nc), on = pv.style.display === 'none';
      pv.style.display = on ? '' : 'none'; ta.style.display = on ? 'none' : ''; btn.classList.toggle('on', on);
      if (on) pv.innerHTML = md(ta.value) || '<span class="muted">Nothing to preview.</span>'; else ta.focus();
      return;
    }
    if (k === 'b') wrap(ta, '**'); if (k === 'i') wrap(ta, '*'); if (k === 's') wrap(ta, '~~'); if (k === 'mark') wrap(ta, '==');
    if (k === 'code') wrap(ta, '`', '`', 'code');
    if (k === 'color') wrap(ta, `{${btn.dataset.c}}`, '{/}');
    if (k === 'link') wrap(ta, '[', '](https://)', 'link text');
    if (k === 'h') prefix(ta, '## '); if (k === 'ul') prefix(ta, '- '); if (k === 'task') prefix(ta, '- [ ] '); if (k === 'q') prefix(ta, '> ');
  }

  async function send() {
    const ta = $('.nc:not(.nc-edit) .nc-text', cur.m.el); const body = ta.value;
    if (!body.trim()) { ta.focus(); return; }
    const share_id = $('.nc-vis', cur.m.el)?.value || '';
    if (share_id && !(await ensureName())) return;
    cur.target = share_id;
    const b = $('[data-nsend]', cur.m.el); setBusy(b, true, 'Saving…');
    const ok = await call(`/api/papers/${cur.id}/notes`, {method: 'POST', body: {body, share_id}});
    if (!ok) setBusy($('[data-nsend]', cur.m.el), false);
    else if (share_id) toast('Public note saved – the members of the shared label will see it at their next update.', 'ok');
  }

  async function open(id, {filter = 'all'} = {}) {
    let d;
    try { d = await api(`/api/papers/${id}/notes`); } catch (err) { toast(err.message, 'error'); return; }
    if (cur?.m) cur.m.close();
    const m = modal(`<h3 class="notes-h"><span class="notes-title"></span><span class="grow"></span><button class="btn small" data-nexport title="Download these notes with the reference">⤓ Export</button><button class="btn small" data-help="notes" title="How notes work">📘 Guide</button></h3>
      <div class="notes-body"></div>`, {wide: true});
    m.el.querySelector('.modal').classList.add('notes-modal');
    cur = {id, m, data: d, filter, showHidden: false, editing: null, target: ''};
    const prevClose = m.onclose; m.onclose = () => { if (cur?.m === m) cur = null; prevClose?.(); };
    render();
    m.el.addEventListener('click', async e => {
      const t = e.target;
      const tb = t.closest('[data-tb]'); if (tb) { e.preventDefault(); tool(tb); return; }
      const f = t.closest('[data-nf]'); if (f) { cur.filter = f.dataset.nf; render(); return; }
      if (t.closest('[data-nshowhidden]')) { cur.showHidden = !cur.showHidden; render(); return; }
      if (t.closest('[data-nsend]')) { send(); return; }
      if (t.closest('[data-nexport]')) { exportDialog([cur.id]); return; }
      const nb = t.closest('.nb'); if (!nb) return;
      const nid = nb.dataset.nid, kind = nb.dataset.kind, sid = nb.dataset.share;
      if (t.closest('[data-nedit]')) { cur.editing = nid; render(); return; }
      if (t.closest('[data-ncancel]')) { cur.editing = null; render(); return; }
      if (t.closest('[data-nsave]')) {
        const body = $('.nc-edit .nc-text', nb).value; if (!body.trim()) return;
        if (await call(`/api/papers/${cur.id}/notes/${nid}`, {method: 'PUT', body: {body, share_id: kind === 'public' ? sid : ''}})) { cur.editing = null; render(); }
        return;
      }
      if (t.closest('[data-ndel]')) {
        const ok = await confirmBox('Delete this note?', kind === 'public' ? 'It is deleted for all the members of the shared label.' : 'It is deleted from your library.', {ok: 'Delete', danger: true});
        if (ok) call(`/api/papers/${cur.id}/notes/${nid}${kind === 'public' ? `?share=${encodeURIComponent(sid)}` : ''}`, {method: 'DELETE'});
        return;
      }
      if (t.closest('[data-nhide]')) {
        const n = allNotes(cur.data).find(x => x.id === nid);
        call(`/api/papers/${cur.id}/notes/${nid}/hide`, {method: 'POST', body: {share_id: sid, hidden: !n?.hidden}});
      }
    });
    m.el.addEventListener('keydown', e => {
      if (e.key === 'Escape' && e.target.classList.contains('nc-text') && e.target.value.trim()) { e.stopPropagation(); e.target.blur(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.classList.contains('nc-text')) {
        e.preventDefault();
        if (e.target.closest('.nc-edit')) e.target.closest('.nb').querySelector('[data-nsave]').click(); else send();
      }
    });
  }

  async function addPrivate(id, body) {
    const d = await api(`/api/papers/${id}/notes`, {method: 'POST', body: {body}});
    const p = paperById(id);
    if (p) { p.note_counts = d.counts; p.note_list = d.private; p.notes = d.private.map(n => plain(n.body)).join('\n\n'); }
    renderList(); if (state.openId === id) renderDetail();
    if (cur?.id === id) { cur.data = d; render(); }
    return d;
  }

  /* ---------------------------------------------------------------- export */
  function exportDialog(ids) {
    ids = (ids || []).filter(id => paperById(id));
    const withNotes = ids.filter(id => { const c = counts(paperById(id)); return c.private + c.public; }).length;
    const styleOpts = state.styles.map(s => `<option value="${s.id}" ${s.id === state.settings.default_style ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const m = modal(`<h3>Export notes</h3>
      <p class="muted small">${ids.length} paper${ids.length === 1 ? '' : 's'} – ${withNotes} with notes. Each paper's reference is followed by its notes, with who wrote them and when.</p>
      <div class="section-label">Format</div>
      <label class="opt"><input type="radio" name="nfmt" value="md" checked><span>Markdown (.md)<small>Keeps bold, lists, highlights – opens in Obsidian, Typora, Notion, VS Code…</small></span></label>
      <label class="opt"><input type="radio" name="nfmt" value="txt"><span>Plain text (.txt)<small>Opens everywhere</small></span></label>
      <label class="opt"><input type="radio" name="nfmt" value="html"><span>Web page (.html)<small>With styles and colours; open it in the browser and print or paste into Word</small></span></label>
      <div class="section-label">Which notes</div>
      <label class="opt"><input type="checkbox" id="nx-priv" checked><span>🔒 My private notes</span></label>
      <label class="opt"><input type="checkbox" id="nx-pub" checked><span>🌐 Public notes of shared labels<small>Notes you hid are left out</small></span></label>
      <label class="opt"><input type="checkbox" id="nx-only" ${withNotes && withNotes < ids.length ? 'checked' : ''}><span>Only papers that have notes</span></label>
      <div class="section-label">Reference style</div>
      <select class="input wide" id="nx-style">${styleOpts}</select>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="nx-go">⤓ Download</button></div>`);
    $('#nx-go', m.el).onclick = async () => {
      const format = $('input[name=nfmt]:checked', m.el).value;
      try {
        const r = await fetch('/api/notes/export', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
          ids, format, style: $('#nx-style', m.el).value, private: $('#nx-priv', m.el).checked, public: $('#nx-pub', m.el).checked,
          only_with_notes: $('#nx-only', m.el).checked, name: ids.length === 1 ? 'notes_' + (paperById(ids[0])?.title || '').slice(0, 40) : 'notes', title: 'Notes'})});
        if (!r.ok) throw new Error('Export failed');
        const blob = await r.blob();
        const fn = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `notes.${format}`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        m.close(); toast(`Notes saved as ${fn} (in your Downloads).`, 'ok', 7000);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  return {md, badge, detailField, open, addPrivate, ensureName, exportDialog, isOpen: () => !!cur};
})();
