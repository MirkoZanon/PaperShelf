'use strict';
/* PaperShelf – smart tools: What's new, library check (retractions, published versions),
   reading-list reminders, reading statistics, label suggestions, missing key references and
   review tables. Everything is computed on this computer; online checks only send public
   identifiers (DOIs, arXiv / OpenAlex IDs) and the topics you choose to watch. */

const fmtDate = s => { if (!s) return ''; const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}); };
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;

/* ------------------------------------------------------------------ badges on papers */
const Smart = {
  alertOn: p => !!(p.alerts && p.alerts.level && p.alerts.dismissed !== p.alerts.level),
  pubOn: p => !!(p.published && p.published.doi && !p.published.dismissed && !p.published.switched),
  attention: p => Smart.alertOn(p) || Smart.pubOn(p),
  badges(p) {
    let h = '';
    if (Smart.alertOn(p)) h += `<span class="al-badge lvl-${p.alerts.level}" data-alert title="${esc(p.alerts.label)} – click for the notice">${p.alerts.level === 'retracted' ? '⚠ Retracted' : p.alerts.level === 'concern' ? '⚠ Concern' : '✎ Corrected'}</span>`;
    if (Smart.pubOn(p)) h += `<span class="pub-badge" data-alert title="This preprint was published${p.published.journal ? ' in ' + esc(p.published.journal) : ''} – click to see it">📰 Published</span>`;
    return h;
  },
  progress(p) {
    if (p.status === 'read' || !p.read_pages || !p.read_page || p.read_page < 2) return '';
    const pct = Math.min(100, Math.round(100 * p.read_page / p.read_pages));
    return `<div class="rprog" title="You stopped on page ${p.read_page} of ${p.read_pages} – the reader opens there"><span class="rprog-bar"><i style="width:${pct}%"></i></span><span>p. ${p.read_page}/${p.read_pages}</span></div>`;
  },
  detailBanners(p) {
    let h = '';
    const a = p.alerts;
    if (a && a.level) {
      const title = a.level === 'retracted' ? 'This paper has been retracted' : a.level === 'concern' ? 'The journal published an expression of concern about this paper' : 'A correction to this paper was published';
      const src = s => s === 'retraction-watch' ? 'Retraction Watch' : s === 'openalex' ? 'OpenAlex' : 'the publisher';
      h += `<div class="d-alert lvl-${a.level}"><b>${a.level === 'corrected' ? '✎' : '⚠'} ${title}.</b>
        <ul>${(a.notices || []).map(n => `<li>${esc(n.label || n.type.replace(/_/g, ' '))}${n.date ? ` · ${esc(fmtDate(n.date))}` : ''}${n.doi ? ` · <a href="https://doi.org/${esc(n.doi)}" target="_blank" rel="noopener">read the notice</a>` : ''} <span class="muted small">(from ${src(n.source)})</span></li>`).join('')}</ul>
        ${a.dismissed === a.level ? '' : `<button class="btn small" data-act="dismiss-alert" title="Keep the information here but remove the badge from the list">Hide the badge</button>`}</div>`;
    }
    const pb = p.published;
    if (pb && pb.doi && !pb.switched) {
      const where = [pb.journal, pb.year].filter(Boolean).map(esc).join(', ');
      h += `<div class="d-pub"><b>📰 This preprint has been published${where ? ` – ${where}` : ''}.</b>
        ${pb.title && pb.title.toLowerCase() !== (p.title || '').toLowerCase() ? `<div class="small">“${esc(pb.title)}”</div>` : ''}
        <div class="small muted"><a href="https://doi.org/${esc(pb.doi)}" target="_blank" rel="noopener">doi.org/${esc(pb.doi)}</a> · found via ${esc(pb.source || '')}</div>
        <div class="d-pub-btns"><button class="btn small primary" data-act="use-published" title="Replace title, journal, DOI, pages… with the published version. Labels, notes, highlights, status and the PDF stay.">Use the published version</button>${pb.dismissed ? '' : '<button class="btn small" data-act="dismiss-pub">Not now</button>'}</div></div>`;
    }
    return h;
  },
  footNote(p) {
    const pb = p.published;
    return pb && pb.switched ? `<br>Published version of the preprint ${pb.preprint_doi ? `<a href="https://doi.org/${esc(pb.preprint_doi)}" target="_blank" rel="noopener">${esc(pb.preprint_doi)}</a>` : ''}${pb.preprint_journal ? ` (${esc(pb.preprint_journal)})` : ''}` : '';
  },
  async detailAct(act, p) {
    try {
      if (act === 'dismiss-alert' || act === 'dismiss-pub') {
        const d = await api(`/api/papers/${p.id}/dismiss`, {method: 'POST', body: {what: act === 'dismiss-alert' ? 'alert' : 'published'}});
        upsertPaper(d.paper); renderAll(); return true;
      }
      if (act === 'use-published') {
        const t = toast('Getting the published version…', 'info', 0);
        try { const d = await api(`/api/papers/${p.id}/use-published`, {method: 'POST'}); upsertPaper(d.paper); t.close(); renderAll(); toast('✓ Now the published version. Your labels, notes, highlights and PDF are unchanged' + (p.pdf_exists ? ' (the PDF is still the preprint – “Find PDF” can get the published one).' : '.'), 'ok', 8000); }
        catch (err) {
          t.close();
          if (err.data?.other_id) { toast('The published version is already in your library – opening it. You can delete the preprint if you no longer need it.', 'info', 9000); openDetail(err.data.other_id); }
          else toast(err.message, 'error');
        }
        return true;
      }
    } catch (err) { toast(err.message, 'error'); return true; }
    return false;
  },

  /* ---------------------------------------------------------------- library check */
  async runChecks({force = false, quiet = false} = {}) {
    const d = await api('/api/checks/run', {method: 'POST', body: {force}});
    if (d.skipped) return d;
    (d.papers || []).forEach(upsertPaper);
    const bits = [];
    const al = (d.new_alerts || []).map(paperById).filter(Boolean);
    const nr = al.filter(p => p.alerts?.level === 'retracted').length;
    if (nr) bits.push(`⚠ ${plural(nr, 'paper')} in your library ${nr === 1 ? 'was' : 'were'} retracted`);
    if (al.length - nr) bits.push(`${plural(al.length - nr, 'paper')} got a correction or a notice`);
    if ((d.new_published || []).length) bits.push(`📰 ${plural(d.new_published.length, 'preprint')} ${d.new_published.length === 1 ? 'was' : 'were'} published in a journal`);
    d.summary = bits;
    if (!quiet) {
      renderAll();
      if (bits.length) toast(bits.join(' · ') + ' – see “Needs attention”.', nr ? 'error' : 'ok', 10000);
      else toast(`✓ Checked ${plural(d.checked, 'paper')}: no retractions, corrections or new published versions.`, 'ok');
    }
    return d;
  },

  /* ---------------------------------------------------------------- reading-list reminders */
  staleDays: () => +(state.settings.stale_days || 0),
  stale() {
    const days = Smart.staleDays(); if (!days) return [];
    const lim = Date.now() - days * 86400000;
    return state.papers.filter(p => p.status !== 'read' && new Date(p.status_at || p.added_at).getTime() < lim)
      .sort((a, b) => (a.status_at || a.added_at).localeCompare(b.status_at || b.added_at));
  },
  staleBanner() {
    const S = Smart.stale(); if (!S.length) return '';
    let hid = 0; try { hid = +localStorage.getItem('papershelf-stale-hidden') || 0; } catch (e) { /* ignore */ }
    if (Date.now() - hid < 7 * 86400000) return '';
    const months = Math.round(Smart.staleDays() / 30);
    return `<div class="stale-banner">⏳ <span><b>${plural(S.length, 'paper')}</b> ${S.length === 1 ? 'has' : 'have'} been waiting in your reading list for more than ${months >= 2 ? months + ' months' : Smart.staleDays() + ' days'}.</span>
      <button class="btn small" data-stale-review>Review them</button><button class="linklike small" data-stale-hide title="Hide this for a week">Later</button></div>`;
  },
  staleReview() {
    const S = Smart.stale(); if (!S.length) return;
    const row = p => `<div class="st-row" data-sid="${p.id}"><div class="st-main"><button class="linklike st-title" data-open="${p.id}">${esc(truncate(p.title || 'Untitled', 110))}</button>
        <div class="muted small">${esc([shortAuthors(p), p.year].filter(Boolean).join(' · '))} · ${p.status === 'reading' ? 'started' : 'added'} ${esc(fmtDate(p.status_at || p.added_at))}</div></div>
      <div class="st-btns"><button class="btn small" data-st="keep" title="Keep it in the reading list; remind me again later">Keep</button>
        <button class="btn small" data-st="read" title="I read it – it moves to the Library">✓ Read</button>
        <button class="btn small" data-st="shelve" title="Not now: it leaves the reading list but stays in your Library (not counted as read)">To Library</button></div></div>`;
    const m = modal(`<h3>⏳ Waiting in your reading list</h3>
      <p class="muted small">For each paper: keep it (you'll be reminded again in ${Smart.staleDays()} days), mark it as read, or move it to the Library without reading it – it stays there with its notes and labels. Reminders can be changed in ⚙︎ Settings → General.</p>
      <div class="st-list">${S.map(row).join('')}</div>
      <div class="modal-actions"><button class="btn" id="st-keepall">Keep all</button><button class="btn primary" data-close>Done</button></div>`, {wide: true});
    const act = async (id, what) => {
      const body = what === 'keep' ? {snooze: true} : what === 'read' ? {status: 'read'} : {status: 'read', shelve: true};
      try { const d = await api(`/api/papers/${id}`, {method: 'PUT', body}); upsertPaper(d.paper); }
      catch (err) { toast(err.message, 'error'); return; }
      const r = $(`.st-row[data-sid="${id}"]`, m.el); if (r) { r.classList.add('done'); r.querySelector('.st-btns').innerHTML = `<span class="muted small">${what === 'keep' ? 'Kept' : what === 'read' ? '✓ Read' : 'In the Library'}</span>`; }
    };
    m.el.addEventListener('click', e => {
      const b = e.target.closest('[data-st]'); if (b) { act(+b.closest('[data-sid]').dataset.sid, b.dataset.st); return; }
      const o = e.target.closest('[data-open]'); if (o) { m.close(); openDetail(+o.dataset.open); }
    });
    $('#st-keepall', m.el).onclick = async () => { for (const r of $$('.st-row:not(.done)', m.el)) await act(+r.dataset.sid, 'keep'); m.close(); };
    m.onclose = () => renderAll();
  },

  /* ---------------------------------------------------------------- label suggestions */
  async labelSuggestions(p) {
    const box = $('#lsugg'); if (!box || !state.groups.length) return;
    try {
      const d = await api(`/api/papers/${p.id}/label-suggestions`);
      if (state.openId !== p.id || !$('#lsugg')) return;
      const S = d.suggestions.filter(s => !p.group_ids.includes(s.id) && state.groups.some(g => g.id === s.id));
      $('#lsugg').innerHTML = S.length ? `<span class="muted small">Suggested:</span> ${S.map(s => { const G = state.groups.find(g => g.id === s.id); return `<button class="lsugg-chip"${chipStyle(G.color)} data-lsugg="${s.id}" title="${esc(s.why ? 'Similar to the papers in this label: ' + s.why : 'Similar to the papers in this label')} – click to add">${labelIcon(G.color, 'tag')}${esc(groupPath(s.id))} ＋</button>`; }).join('')}` : '';
    } catch (e) { /* ignore */ }
  },

  /* ---------------------------------------------------------------- missing key references */
  gapCache: {},
  async gapsHint() {
    const v = state.view;
    if (!['group', 'share'].includes(v.type) || state.area !== 'library' || state.mode === 'discover') return;   // a link to Discover, from the Library
    const key = `${v.type}:${v.id}:${state.includeSub ? 1 : 0}:${state.papers.length}`;
    let d = Smart.gapCache[key];
    if (!d) {
      try { d = await api(`/api/gaps?${v.type}=${encodeURIComponent(v.id)}&sub=${state.includeSub ? 1 : 0}`); Smart.gapCache[key] = d; }
      catch (e) { return; }
    }
    const sub = $('#view-sub'); const cur = state.view;
    if (!d.count || !sub || cur.type !== v.type || cur.id !== v.id || sub.querySelector('[data-gaps]')) return;
    sub.insertAdjacentHTML('beforeend', `<span class="gaps-hint">${sub.textContent.trim() ? ' · ' : ''}<button class="linklike" data-gaps title="Works cited by at least ${d.min_count} papers of this label that are not in your library – see them in Discover">📚 ${plural(d.count, 'key reference')} you don't have</button></span>`);
  },
};

/* ------------------------------------------------------------------ What's new */
const Feed = (() => {
  let data = null, dialog = null, filter = 'all';
  const added = new Map();

  function badge() {
    const n = data?.count || 0;
    const b = $('#feed-n'); if (b) b.textContent = n ? (n > 99 ? '99+' : n) : '';
    const btn = $('#feed-btn'); if (btn) btn.title = n ? `What's new: ${plural(n, 'new paper')} from the researchers you follow and your topics` : "What's new – recent papers by the researchers you follow and on the topics you watch";
  }
  async function load() { try { data = await api('/api/feed'); badge(); } catch (e) { /* ignore */ } return data; }
  const following = () => data.followed.filter(f => !f.muted);
  async function check({quiet = false} = {}) {
    if (data && !following().length && !data.topics.length) return {new: 0, skipped: true};
    data = await api('/api/feed/check', {method: 'POST'});
    badge(); if (dialog) render();
    if (!quiet && data.new) toast(`✓ ${plural(data.new, 'new paper')} in What's new.`, 'ok');
    return data;
  }
  const whyHtml = w => w.map(x => x.kind === 'person' ? (x.names || []).map(n => `<span class="fd-why p">👤 ${esc(n)}</span>`).join('') : `<span class="fd-why t">🔎 ${esc(x.topic)}</span>`).join('');
  function card(it) {
    const link = it.doi ? `https://doi.org/${it.doi}` : `https://openalex.org/${it.id}`;
    const done = added.get(it.id);
    return `<div class="s-card fd-card" data-fid="${esc(it.id)}">
      <div class="s-title">${esc(it.title || 'Untitled')}</div>
      <div class="s-meta">${esc([it.authors, it.venue, it.date ? fmtDate(it.date) : it.year].filter(Boolean).join(' · '))}${it.type === 'preprint' ? ' · <span class="muted">preprint</span>' : ''}${it.oa ? ' · <span class="oa-tag" title="Free to read">open access</span>' : ''}</div>
      <div class="s-foot"><span class="fd-whys">${whyHtml(it.why || [])}</span><span class="grow"></span>
        <a class="btn small" href="${esc(link)}" target="_blank" rel="noopener" title="Open the article page">🔗</a>
        ${done ? `<button class="btn small" data-openp="${done}">✓ Added – open</button>` : `<button class="btn small" data-fdismiss title="Not interested – remove it">✕</button><button class="btn small primary" data-fadd title="Add it to your reading list">＋ Reading list</button>`}</div></div>`;
  }
  function render() {
    if (!dialog || !data) return;
    const el = dialog.el;
    const items = data.items.filter(it => filter === 'all' || (it.why || []).some(w => w.kind === filter));
    const nP = data.items.filter(it => (it.why || []).some(w => w.kind === 'person')).length, nT = data.items.filter(it => (it.why || []).some(w => w.kind === 'topic')).length;
    $('#fd-sub', el).innerHTML = `${data.followed.length ? `Following <b>${plural(following().length, 'researcher')}</b> (the people in the <button class="linklike" data-goto-people>Researchers</button> tab)` : 'You don\'t follow any researcher yet – add some in the <button class="linklike" data-goto-people>Researchers</button> tab'}${data.topics.length ? ` and <b>${plural(data.topics.length, 'topic')}</b>` : ''}. ${data.last ? `Last checked ${esc(fmtDate(data.last))}.` : 'Not checked yet.'} Checked when you press ⟳.`;
    $('#fd-people', el).innerHTML = data.followed.length ? `<span class="muted small">Researchers:</span> ${data.followed.map(f => `<button class="fd-person ${f.muted ? 'muted' : ''}" data-mute="${f.id}" title="${f.muted ? 'Not followed in What\'s new – click to follow again' : 'Click to stop following in What\'s new (the profile stays)'}">${f.muted ? '＋' : '👤'} ${esc(f.name)}</button>`).join('')}` : '';
    $('#fd-topics', el).innerHTML = data.topics.map((t, i) => `<span class="chip">🔎 ${esc(t)}<button data-tdel="${i}" title="Stop watching">×</button></span>`).join('')
      + `<input class="input fd-tin" id="fd-tin" placeholder="${data.topics.length ? 'Add a topic…' : 'Watch a topic, e.g. “sleep spindles” + Enter'}">`;
    $('#fd-seg', el).innerHTML = data.items.length && nP && nT ? `<button data-ff="all" class="${filter === 'all' ? 'on' : ''}">All ${data.items.length}</button><button data-ff="person" class="${filter === 'person' ? 'on' : ''}">Researchers ${nP}</button><button data-ff="topic" class="${filter === 'topic' ? 'on' : ''}">Topics ${nT}</button>` : '';
    $('#fd-list', el).innerHTML = items.length ? items.map(card).join('')
      : `<div class="empty-hint fd-empty">${following().length || data.topics.length ? 'Nothing new right now. New papers appear here when you press ⟳ (or “Check now”).' : 'Follow researchers in the Researchers tab, or watch a topic above: their new papers will appear here.'}</div>`;
    $('#fd-clear', el).style.display = data.items.length ? '' : 'none';
  }
  async function setState(ids, st, all = false) {
    try { data = await api('/api/feed/state', {method: 'POST', body: all ? {all: true, state: st} : {ids, state: st}}); badge(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function open() {
    dialog = modal(`<h3>✨ What's new <span class="grow"></span><button class="btn small" id="fd-check">⟳ Check now</button></h3>
      <p class="muted small" id="fd-sub"></p>
      <div class="fd-topics" id="fd-people"></div>
      <div class="fd-topics" id="fd-topics"></div>
      <div class="seg fd-seg" id="fd-seg"></div>
      <div class="fd-list" id="fd-list"><div class="muted">Loading…</div></div>
      <div class="modal-actions"><button class="btn" id="fd-clear" title="Remove all these suggestions">Dismiss all</button><button class="btn primary" data-close>Close</button></div>`, {wide: true});
    const m = dialog; m.onclose = () => { dialog = null; };
    if (!data) await load();
    render();
    if (!data.last && (following().length || data.topics.length)) runCheck();
    $('#fd-check', m.el).onclick = runCheck;
    $('#fd-clear', m.el).onclick = async () => { await setState([], 'dismissed', true); render(); };
    m.el.addEventListener('keydown', async e => {
      if (e.target.id !== 'fd-tin' || e.key !== 'Enter') return;
      const v = e.target.value.trim(); if (!v) return;
      try { data = await api('/api/feed/topics', {method: 'PUT', body: {topics: [...data.topics, v]}}); render(); $('#fd-tin', m.el)?.focus(); runCheck(); }
      catch (err) { toast(err.message, 'error'); }
    });
    m.el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-goto-people]')) { m.close(); setTab('people'); return; }
      const ff = t.closest('[data-ff]'); if (ff) { filter = ff.dataset.ff; render(); return; }
      const mu = t.closest('[data-mute]');
      if (mu) {
        const id = +mu.dataset.mute, ids = data.followed.filter(f => f.muted).map(f => f.id);
        const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
        try { data = await api('/api/feed/muted', {method: 'PUT', body: {ids: next}}); render(); } catch (err) { toast(err.message, 'error'); }
        return;
      }
      const td = t.closest('[data-tdel]');
      if (td) { const T = data.topics.filter((_, i) => i !== +td.dataset.tdel); try { data = await api('/api/feed/topics', {method: 'PUT', body: {topics: T}}); render(); } catch (err) { toast(err.message, 'error'); } return; }
      const op = t.closest('[data-openp]'); if (op) { m.close(); if (state.tab === 'people') setTab(state.area); openDetail(+op.dataset.openp); return; }
      const c = t.closest('[data-fid]'); if (!c) return;
      const id = c.dataset.fid;
      if (t.closest('[data-fdismiss]')) { c.classList.add('gone'); await setState([id], 'dismissed'); setTimeout(render, 150); return; }
      const b = t.closest('[data-fadd]');
      if (b) {
        setBusy(b, true, 'Adding…');
        try {
          const d = await api('/api/papers', {method: 'POST', body: {input: id}});
          upsertPaper(d.paper); added.set(id, d.paper.id); renderAll();
          c.outerHTML = card(data.items.find(x => x.id === id));
          await setState([id], 'added');
          toast(d.duplicate ? 'Already in your library.' : '✓ Added to your reading list.', 'ok');
        } catch (err) { setBusy(b, false); toast(err.message, 'error'); }
      }
    });
  }
  async function runCheck() {
    const b = dialog && $('#fd-check', dialog.el); if (b) setBusy(b, true, 'Checking…');
    try { await check({quiet: true}); if (dialog) { render(); if (data.new) toast(`✓ ${plural(data.new, 'new paper')}.`, 'ok'); } }
    catch (err) { toast(err.message, 'error'); }
    if (b && dialog) setBusy(b, false);
  }
  return {load, check, open, badge, get data() { return data; }};
})();

/* ------------------------------------------------------------------ reading statistics */
const Stats = (() => {
  function bars(rows, key, {label, unit = '', color = 'var(--accent)'}) {
    const W = 560, H = 150, pad = 22, n = rows.length, bw = (W - 10) / n;
    const max = Math.max(1, ...rows.map(r => r[key]));
    const b = rows.map((r, i) => {
      const h = Math.round((H - pad - 14) * r[key] / max), x = 5 + i * bw;
      return `<g><title>${esc(label(r))}: ${r[key]}${unit}</title><rect x="${(x + bw * 0.18).toFixed(1)}" y="${H - pad - h}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(h, r[key] ? 2 : 0)}" rx="3" fill="${color}"/>
        ${r[key] ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - pad - h - 4}" class="st-v">${r[key]}</text>` : ''}
        <text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" class="st-x">${esc(label(r, true))}</text></g>`;
    }).join('');
    return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="st-axis"/>${b}</svg>`;
  }
  const mName = (m, short) => new Date(m + '-15T12:00:00').toLocaleDateString(undefined, short ? {month: 'short'} : {month: 'long', year: 'numeric'});
  const wName = (w, short) => short ? new Date(w + 'T12:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'numeric'}) : 'Week of ' + fmtDate(w);
  const hm = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}` : `${m} min`;
  async function open() {
    const m = modal('<h3>📊 Reading stats</h3><p class="muted">Loading…</p>', {wide: true});
    let s; try { s = await api('/api/stats'); } catch (err) { m.close(); toast(err.message, 'error'); return; }
    const tile = (v, l, tip = '') => `<div class="st-tile" title="${esc(tip)}"><b>${v}</b><span>${l}</span></div>`;
    m.el.querySelector('.modal').innerHTML = `<h3>📊 Reading stats</h3>
      <p class="muted small">Only on this computer – nothing is sent anywhere. “Read” counts the papers you marked as read (since PaperShelf 2.5); reading time is the time a PDF is open in PaperShelf's reader while you use it.</p>
      <div class="st-tiles">
        ${tile(s.finished_month, 'read this month')}${tile(s.finished_year, `read in ${new Date().getFullYear()}`)}
        ${tile(hm(s.minutes_week), 'reading this week', 'Time in the PDF reader')}
        ${tile(s.streak ? `${s.streak} 🔥` : '0', s.streak === 1 ? 'day streak' : 'days streak', 'Days in a row with at least a minute of reading')}
        ${tile(s.reading_list, 'in the reading list', `${s.reading_now} being read`)}
        ${s.median_days !== null ? tile(s.median_days, 'days from added to read', 'Median, for the papers you marked as read') : ''}
      </div>
      <div class="st-sec"><div class="st-h">Papers read per month</div>${bars(s.months, 'finished', {label: (r, sh) => mName(r.month, sh)})}</div>
      <div class="st-sec"><div class="st-h">Minutes of reading per week</div>${bars(s.weeks, 'minutes', {label: (r, sh) => wName(r.week, sh), unit: ' min', color: 'var(--accent-2, #5aa7d6)'})}</div>
      <div class="st-cols">
        <div><div class="st-h">Most time spent on <span class="muted small">(last 3 months)</span></div>${s.top_papers.length ? `<ol class="st-list2">${s.top_papers.map(t => `<li><button class="linklike" data-open="${t.id}">${esc(truncate(t.title, 70))}</button> <span class="muted small">${hm(t.minutes)}</span></li>`).join('')}</ol>` : '<p class="muted small">Open PDFs in PaperShelf\'s reader to see this.</p>'}</div>
        <div><div class="st-h">Labels you read most <span class="muted small">(${new Date().getFullYear()})</span></div>${s.top_labels.length ? `<ol class="st-list2">${s.top_labels.map(t => `<li>${esc(t.name)} <span class="muted small">${t.n}</span></li>`).join('')}</ol>` : '<p class="muted small">Nothing read yet this year.</p>'}</div>
      </div>
      ${s.read_without_date ? `<p class="muted small">${plural(s.read_without_date, 'paper')} marked as read before 2.5 (or moved to the Library unread) ${s.read_without_date === 1 ? 'is' : 'are'} not in the monthly counts.</p>` : ''}
      <div class="modal-actions"><button class="btn primary" data-close>Close</button></div>`;
    m.el.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) { m.close(); if (state.tab === 'people') setTab(state.area); openDetail(+o.dataset.open); } });
  }
  return {open};
})();

/* ------------------------------------------------------------------ review table */
const Review = (() => {
  let data = null, key = null, saveT = null, seq = 0;
  const box = () => $('#review-view');
  const target = () => state.view.type === 'group' ? {group: state.view.id} : state.view.type === 'share' ? {share: state.view.id} : null;
  const qs = t => t.group ? `group=${t.group}` : `share=${encodeURIComponent(t.share)}`;
  const papers = () => {
    const v = state.view;
    let list = state.papers;
    if (v.type === 'group') { const ids = state.includeSub ? descendants(v.id) : new Set([v.id]); list = list.filter(p => p.group_ids.some(g => ids.has(g))); }
    else list = list.filter(p => (p.share_ids || []).includes(v.id));
    return [...list].sort(SORTS[state.sort][1]);
  };
  const ref = p => `${shortAuthors(p) || 'Unknown'}${p.year ? ` (${p.year})` : ''}`;

  async function render() {
    const t = target(), el = box(); if (!el) return;
    if (!t) {
      el.innerHTML = `<div class="empty"><div class="big">▦</div><h2>Review table</h2><div>Open a <b>label</b> (in the sidebar) to build its review table: one row per paper, with your own columns – aim, method, data, main result… Handy for a literature review or a thesis chapter. You can export it to CSV (Excel) or Markdown.</div></div>`;
      return;
    }
    const k = JSON.stringify(t);
    if (k !== key) {
      key = k; data = null; el.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>';
      const my = ++seq;
      try { const d = await api('/api/review?' + qs(t)); if (my !== seq) return; data = d; }
      catch (err) { el.innerHTML = `<p class="up-err" style="padding:16px">${esc(err.message)}</p>`; return; }
    }
    draw();
  }
  function draw() {
    const el = box(); if (!el || !data) return;
    const P = papers();
    const w = c => data.widths[c] ? ` style="width:${data.widths[c]}px;min-width:${data.widths[c]}px"` : '';
    el.innerHTML = `<div class="rv-head"><div><b>Review table</b> <span class="muted small">· ${plural(P.length, 'paper')} · one row per paper, your own columns · saved automatically${state.view.type === 'share' ? ' · only on this computer (not shared)' : ''}</span></div><span class="grow"></span>
        <button class="btn small" id="rv-addcol">＋ Column</button><button class="btn small" id="rv-csv" title="For Excel, Numbers, Google Sheets">⤓ CSV</button><button class="btn small" id="rv-md" title="A table for a text, a wiki or Obsidian">⤓ Markdown</button></div>
      ${P.length ? `<div class="rv-wrap"><table class="rv"><thead><tr><th class="rv-paper"${w('paper')}>Paper</th>${data.cols.map((c, i) => `<th data-col="${esc(c.id)}"${w(c.id)}><div class="rv-th"><button class="rv-name" data-rename="${esc(c.id)}" title="Rename">${esc(c.name)}</button><button class="rv-colmenu" data-colmenu="${i}" title="Move or delete">⋯</button></div></th>`).join('')}</tr></thead>
        <tbody>${P.map(p => `<tr data-uid="${esc(p.uid)}"><td class="rv-paper"><button class="linklike rv-ref" data-open="${p.id}">${esc(ref(p))}</button><div class="rv-t">${esc(truncate(p.title || 'Untitled', 120))}</div>${p.journal ? `<div class="rv-j">${esc(p.journal)}</div>` : ''}<button class="rv-notes" data-rvnotes="${p.id}" title="Show this paper's notes and highlights, to copy from">📝 notes</button></td>
          ${data.cols.map(c => `<td><textarea data-cell="${esc(c.id)}" rows="2" placeholder="…">${esc((data.cells[p.uid] || {})[c.id] || '')}</textarea></td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><div class="big">▦</div><h2>No papers in this label</h2><div>Add papers to the label and they become rows of this table.</div></div>`}`;
    $$('textarea[data-cell]', el).forEach(grow);
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(320, ta.scrollHeight + 2) + 'px'; }
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      const t = target(); if (!t || !data || JSON.stringify(t) !== key) return;
      try { await api('/api/review', {method: 'PUT', body: {...t, ...data}}); flashSaved(); }
      catch (err) { toast(err.message, 'error'); }
    }, 700);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type}));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportAs(kind) {
    const P = papers(), title = viewTitle().replace(/[\\/:*?"<>|]+/g, '-');
    const row = p => [ref(p), p.title || '', p.journal || '', p.doi || '', ...data.cols.map(c => (data.cells[p.uid] || {})[c.id] || '')];
    const head = ['Reference', 'Title', 'Journal', 'DOI', ...data.cols.map(c => c.name)];
    if (kind === 'csv') {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      download(`${title} – review.csv`, '﻿' + [head, ...P.map(row)].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
    } else {
      const c = v => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
      const mdHead = ['Paper', ...data.cols.map(x => x.name)];
      const lines = [`# ${viewTitle()} – review`, '', `| ${mdHead.map(c).join(' | ')} |`, `|${mdHead.map(() => ' --- ').join('|')}|`,
        ...P.map(p => `| ${c(`${ref(p)}. ${p.title || ''}${p.doi ? ` https://doi.org/${p.doi}` : ''}`)} | ${data.cols.map(x => c((data.cells[p.uid] || {})[x.id] || '')).join(' | ')} |`)];
      download(`${title} – review.md`, lines.join('\n') + '\n', 'text/markdown');
    }
  }
  function colMenu(btn, i) {
    $$('.rv-menu').forEach(x => x.remove());
    const mnu = document.createElement('div'); mnu.className = 'menu open rv-menu';
    mnu.innerHTML = `<button data-cm="rename">Rename</button>${i > 0 ? '<button data-cm="left">◀ Move left</button>' : ''}${i < data.cols.length - 1 ? '<button data-cm="right">Move right ▶</button>' : ''}<button data-cm="del" class="danger-t">Delete column</button>`;
    document.body.appendChild(mnu);
    const r = btn.getBoundingClientRect(); mnu.style.position = 'fixed'; mnu.style.left = `${Math.min(window.innerWidth - 190, r.left)}px`; mnu.style.top = `${r.bottom + 4}px`;
    const off = e => { if (!mnu.contains(e.target)) { mnu.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    mnu.onclick = async e => {
      const a = e.target.closest('[data-cm]')?.dataset.cm; if (!a) return;
      mnu.remove(); document.removeEventListener('mousedown', off);
      const C = data.cols;
      if (a === 'rename') return rename(C[i].id);
      if (a === 'left' || a === 'right') { const j = a === 'left' ? i - 1 : i + 1; [C[i], C[j]] = [C[j], C[i]]; }
      if (a === 'del') {
        const used = Object.values(data.cells).filter(v => (v[C[i].id] || '').trim()).length;
        if (used && !(await confirmBox(`Delete the column “${C[i].name}”?`, `${plural(used, 'cell')} with text will be deleted too.`, {ok: 'Delete', danger: true}))) return;
        Object.values(data.cells).forEach(v => { delete v[C[i].id]; }); C.splice(i, 1);
      }
      draw(); save();
    };
  }
  async function rename(id) {
    const c = data.cols.find(x => x.id === id); if (!c) return;
    const v = await askText('Column name', {value: c.name, ok: 'Rename'}); if (!v) return;
    c.name = v; draw(); save();
  }
  async function showNotes(pid) {
    const p = paperById(pid);
    let N, H;
    try { [N, H] = await Promise.all([api(`/api/papers/${pid}/notes`), api(`/api/papers/${pid}/annotations`)]); }
    catch (err) { toast(err.message, 'error'); return; }
    const pub = (N.public || []).flatMap(g => g.notes.filter(n => !n.hidden).map(n => ({...n, where: g.share_name})));
    const m = modal(`<h3>📝 ${esc(truncate(p.title, 90))}</h3>
      <p class="muted small">Select text to copy it into the table.</p>
      <div class="rv-notelist">${N.private.map(n => `<div class="rv-note"><div class="muted small">🔒 private note</div><div class="md">${Notes.md(n.body)}</div></div>`).join('')}
        ${pub.map(n => `<div class="rv-note"><div class="muted small">👥 ${esc(n.name || '')} · ${esc(n.where || '')}</div><div class="md">${Notes.md(n.body)}</div></div>`).join('')}
        ${H.annotations.length ? `<div class="rv-note"><div class="muted small">🖍 highlights</div><ul>${H.annotations.map(a => `<li><b>p. ${a.page}</b> ${esc(a.text)}${a.note ? ` <i>– ${esc(a.note)}</i>` : ''}</li>`).join('')}</ul></div>` : ''}
        ${!N.private.length && !pub.length && !H.annotations.length ? '<p class="muted">No notes or highlights for this paper yet.</p>' : ''}</div>
      <div class="modal-actions"><button class="btn" data-open-notes>Open the notes</button><button class="btn primary" data-close>Close</button></div>`, {wide: true});
    $('[data-open-notes]', m.el).onclick = () => { m.close(); Notes.open(pid); };
  }
  function bind() {
    const el = box(); if (!el) return;
    el.addEventListener('input', e => {
      const ta = e.target.closest('textarea[data-cell]'); if (!ta || !data) return;
      const uid = ta.closest('tr').dataset.uid;
      (data.cells[uid] || (data.cells[uid] = {}))[ta.dataset.cell] = ta.value;
      grow(ta); save();
    });
    el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('#rv-addcol')) {
        const v = await askText('New column', {placeholder: 'e.g. Sample size, Species, Key figure…', ok: 'Add'}); if (!v) return;
        let n = data.cols.length + 1; while (data.cols.some(c => c.id === 'c' + n)) n++;
        data.cols.push({id: 'c' + n, name: v}); draw(); save(); return;
      }
      if (t.closest('#rv-csv')) return exportAs('csv');
      if (t.closest('#rv-md')) return exportAs('md');
      const rn = t.closest('[data-rename]'); if (rn) return rename(rn.dataset.rename);
      const cm = t.closest('[data-colmenu]'); if (cm) return colMenu(cm, +cm.dataset.colmenu);
      const nt = t.closest('[data-rvnotes]'); if (nt) return showNotes(+nt.dataset.rvnotes);
      const op = t.closest('[data-open]'); if (op) openDetail(+op.dataset.open);
    });
  }
  return {render, bind, reset() { key = null; }};
})();

document.addEventListener('DOMContentLoaded', () => {
  $('#feed-btn')?.addEventListener('click', () => Feed.open());
  Review.bind();
  setTimeout(() => Feed.load(), 1200);
});
