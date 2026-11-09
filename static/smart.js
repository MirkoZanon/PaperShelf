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

  function badge() { if (typeof Bell !== 'undefined') Bell.badge(); }
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
      el.innerHTML = `<div class="empty"><div class="big">▦</div><h2>Review table</h2><div>Open a <b>label</b> or a <b>group</b> (in the sidebar) to build its review table: one row per paper, with columns – aim, method, data, main result… Handy for a literature review or a thesis chapter. You can export it to CSV (Excel) or Markdown.</div></div>`;
      return;
    }
    const k = JSON.stringify(t);
    if (t.share) {   // a group: the table is shared with its members (entries signed by each person)
      if (k !== key) { key = k; data = null; el.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>'; }
      const my = ++seq;
      try { const d = await api(`/api/shares/${encodeURIComponent(t.share)}/table`); if (my !== seq) return; data = {...d, shared: true}; }
      catch (err) { if (!data) el.innerHTML = `<p class="up-err" style="padding:16px">${esc(err.message)}</p>`; return; }
      return draw();
    }
    if (k !== key) {
      key = k; data = null; el.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>';
      const my = ++seq;
      try { const d = await api('/api/review?' + qs(t)); if (my !== seq) return; data = d; }
      catch (err) { el.innerHTML = `<p class="up-err" style="padding:16px">${esc(err.message)}</p>`; return; }
    }
    draw();
  }
  /* ------------------------------------------------ shared mode (groups) */
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const when = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s.slice(0, 10) : d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}); };
  const sid = () => encodeURIComponent(state.view.id);
  const mdOr = t => (typeof Notes !== 'undefined' && Notes.md) ? Notes.md(t) : esc(t).replace(/\n/g, '<br>');
  // all entries of a cell, public and private, oldest first
  function cellEntries(pid, cid) {
    const pub = (((data.cells[String(pid)] || {})[cid]) || []).map(e => ({...e, kind: 'public'}));
    const pri = (((data.private?.[String(pid)] || {})[cid]) || []).map(e => ({...e, kind: 'private', mine: true, by: '', name: data.display_name || 'You'}));
    const t = e => Date.parse(e.created || '') || 0;
    return [...pub, ...pri].sort((a, b) => t(a) - t(b));
  }
  function chipHtml(e) {
    const who = e.kind === 'private' ? 'You · private, only on this computer' : e.mine ? `${e.name || 'You'} (you)` : (e.name || e.by);
    const av = e.kind === 'private' ? '<span class="rv-av priv">🔒</span>' : `<span class="rv-av" style="background:hsl(${hue(e.by)} 50% 42%)">${esc(initials(e.name || e.by))}</span>`;
    return `<div class="rv-e ${e.kind} ${e.mine ? 'mine' : ''}" data-eid="${esc(e.id)}" title="${esc(`${who} · ${when(e.created)}${e.mine ? ' – click to open or edit' : ' – click to open'}`)}">${av}<div class="rv-eb md">${mdOr(e.body)}</div></div>`;
  }
  function drawShared() {
    const el = box(); if (!el || !data) return;
    const P = papers(), W = data.can_write;
    const people = new Set(); Object.values(data.cells).forEach(r => Object.values(r).forEach(l => l.forEach(e => people.add(e.by))));
    el.innerHTML = `<div class="rv-head"><div><b>Group table</b> <span class="muted small">· ${plural(P.length, 'paper')} · click a cell to open it${people.size ? ` · ${plural(people.size, 'contributor')}` : ''}${W ? '' : ' · reader: your entries stay private'}</span></div><span class="grow"></span>
        ${W ? '<button class="btn small" id="rv-addcol">＋ Column</button>' : ''}<button class="btn small" id="rv-refresh" title="Get the latest entries of the others">⟳</button><button class="btn small" id="rv-csv" title="For Excel, Numbers, Google Sheets">⤓ CSV</button><button class="btn small" id="rv-md" title="A table for a text, a wiki or Obsidian">⤓ Markdown</button></div>
      ${P.length ? `<div class="rv-wrap"><table class="rv rv-shared"><thead><tr><th class="rv-paper">Paper</th>${data.cols.map((c, i) => `<th data-col="${esc(c.id)}"><div class="rv-th">${W ? `<button class="rv-name" data-rename="${esc(c.id)}" title="Rename (for everybody)">${esc(c.name)}</button><button class="rv-colmenu" data-colmenu="${i}" title="Move or delete">⋯</button>` : `<span class="rv-name">${esc(c.name)}</span>`}</div></th>`).join('')}</tr></thead>
        <tbody>${P.map(p => `<tr><td class="rv-paper"><button class="linklike rv-ref" data-open="${p.id}">${esc(ref(p))}</button><div class="rv-t">${esc(truncate(p.title || 'Untitled', 120))}</div>${p.journal ? `<div class="rv-j">${esc(p.journal)}</div>` : ''}<button class="rv-notes" data-rvnotes="${p.id}" title="Show this paper's notes and highlights, to copy from">📝 notes</button></td>
          ${data.cols.map(c => { const E = cellEntries(p.id, c.id); return `<td class="rv-sc" data-pid="${p.id}" data-col="${esc(c.id)}" title="${E.length ? '' : 'Click to add an entry'}"><div class="rv-ents">${E.map(chipHtml).join('')}</div><button class="rv-plus" data-cadd title="Add an entry">＋</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><div class="big">▦</div><h2>No papers in this group</h2><div>Add papers to the group and they become rows of this table.</div></div>`}`;
  }
  const colCall = async body => {
    try { const d = await api(`/api/shares/${sid()}/table/cols`, {method: 'POST', body}); data = {...d, shared: true}; drawShared(); flashSaved(); }
    catch (err) { toast(err.message, 'error'); }
  };

  /* The window of a cell: all its entries like a chat, and a box to add a new one (public or private)
     or to change one of yours. */
  function lsGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } }
  function openCell(pid, cid, focusId = null) {
    const p = paperById(pid), col = data.cols.find(c => c.id === cid); if (!p || !col) return;
    const W = data.can_write;
    const cw = {pid, cid, editing: null, vis: W ? lsGet('papershelf-table-vis', 'public') : 'private', orig: ''};
    const m = modal(`<div class="cw-head"><div class="cw-titles"><div class="cw-col">${esc(col.name)}</div><div class="cw-paper">${esc(ref(p))} · ${esc(truncate(p.title || 'Untitled', 90))}</div></div>
        <button class="cw-x" data-close title="Close (Esc)">✕</button></div>
      <div class="cw-thread notes-thread"></div>
      <div class="cw-composer">
        <div class="cw-mode"></div>
        <textarea class="input cw-text" rows="3" placeholder="Write an entry for this cell…"></textarea>
        <div class="cw-foot"><div class="cw-vis seg">
            <button data-vis="public" ${W ? '' : 'disabled title="You are a reader of this group: only private entries"'}>🌐 Public <small>the group sees it</small></button>
            <button data-vis="private">🔒 Private <small>only me</small></button></div>
          <span class="grow"></span><span class="muted small cw-kbd">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter</span>
          <button class="btn" data-cwclose>Close</button><button class="btn primary" data-cwsave>Add entry</button></div>
      </div>`, {wide: true, nofocus: true});
    m.el.querySelector('.modal').classList.add('cw');
    const ta = $('.cw-text', m.el);
    const dirty = () => ta.value.trim() !== '' && ta.value.trim() !== cw.orig.trim();
    m.guard = () => {
      if (!dirty()) return true;
      confirmBox('Discard what you wrote?', 'The text in the box has not been saved.', {ok: 'Discard', danger: true}).then(ok => { if (ok) m.close(true); });
      return false;
    };
    function bubble(e) {
      const who = e.kind === 'private' ? 'You' : e.mine ? `${e.name || 'You'} (you)` : (e.name || e.by);
      const acts = !e.mine ? '' : `<button data-cwedit title="Edit (also who can read it)">✎ Edit</button>${e.kind === 'private' && W ? '<button data-cwpub title="Make it public: the group will see it, signed with your name">🌐 Make public</button>' : ''}${e.kind === 'public' ? '<button data-cwpriv title="Make it private: it is removed from the group and stays only on this computer">🔒 Make private</button>' : ''}<button data-cwdel title="${e.kind === 'private' ? 'Delete' : 'Delete for everybody'}">🗑</button>`;
      const av = e.mine ? '' : `<span class="nb-av" style="background:hsl(${hue(e.by)} 55% 46%)">${esc(initials(e.name || e.by))}</span>`;
      return `<div class="nb ${e.mine ? 'mine' : 'theirs'} ${e.kind} ${cw.editing === e.id ? 'cw-editing' : ''}" data-eid="${esc(e.id)}" data-kind="${e.kind}">${av}<div class="nb-box">
        <div class="nb-meta"><span class="nb-who">${esc(who)}</span><span class="nb-tag ${e.kind}">${e.kind === 'private' ? '🔒 Private' : '🌐 Public'}</span>
          <span class="nb-time" title="${e.at && e.at !== e.created ? 'edited ' + esc(when(e.at)) : ''}">${esc(when(e.created))}${e.at && e.at !== e.created ? ' · edited' : ''}</span><span class="grow"></span><span class="nb-acts">${acts}</span></div>
        <div class="nb-body md">${mdOr(e.body)}</div></div></div>`;
    }
    function paint(scrollTo = null) {
      const E = cellEntries(pid, cid), th = $('.cw-thread', m.el);
      th.innerHTML = E.length ? E.map(bubble).join('') : '<div class="notes-empty muted">Nothing in this cell yet – write the first entry below.</div>';
      const ed = cw.editing && E.find(e => e.id === cw.editing);
      if (cw.editing && !ed) cw.editing = null;
      $('.cw-mode', m.el).innerHTML = ed ? `<b>✎ Editing your entry</b>${cw.editVis !== ed.kind ? `<span class="muted small">– it will become ${cw.editVis === 'public' ? '🌐 public' : '🔒 private'} when you save</span>` : ''}<span class="grow"></span><button class="linklike small" data-cwcancel>Cancel editing</button>`
        : `<b>＋ New entry</b><span class="muted small">${cw.vis === 'public' ? '– signed with your name, the group sees it' : '– only you see it, it stays on this computer'}</span>`;
      $('[data-cwsave]', m.el).textContent = ed ? 'Save changes' : 'Add entry';
      $$('.cw-vis button', m.el).forEach(b => { b.classList.toggle('on', b.dataset.vis === (ed ? cw.editVis : cw.vis)); b.disabled = b.dataset.vis === 'public' && !W; });
      $('.cw-composer', m.el).classList.toggle('editing', !!ed);
      const target = scrollTo && $(`.nb[data-eid="${CSS.escape(scrollTo)}"]`, th);
      if (target) { target.scrollIntoView({block: 'nearest'}); target.classList.add('cw-flash'); setTimeout(() => target.classList.remove('cw-flash'), 1200); }
      else th.scrollTop = th.scrollHeight;
    }
    const confirmVis = (from, to) => to === 'public'
      ? confirmBox('Make this entry public?', 'All the members of the group will see it, signed with your name. You can still edit it, delete it or make it private again.', {ok: '🌐 Make public'})
      : confirmBox('Make this entry private?', 'It is removed from the group – the other members will no longer see it (from their next update). It stays on this computer, only for you.', {ok: '🔒 Make private'});
    function startEdit(id) {
      const e = cellEntries(pid, cid).find(x => x.id === id); if (!e || !e.mine) return;
      cw.editing = id; cw.editVis = e.kind; cw.orig = e.body; ta.value = e.body; paint(id); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    function stopEdit() { cw.editing = null; cw.orig = ''; ta.value = ''; paint(); ta.focus(); }
    async function run(path, opts) {
      try { const d = await api(`/api/shares/${sid()}/table${path}`, opts); data = {...d, shared: true}; drawShared(); flashSaved(); return true; }
      catch (err) { toast(err.message, 'error'); return false; }
    }
    async function saveIt() {
      const body = ta.value.trim(); if (!body) { ta.focus(); return; }
      const btn = $('[data-cwsave]', m.el); if (btn.disabled) return; btn.disabled = true;
      const loc = {paper_id: pid, col: cid}, e = cw.editing && cellEntries(pid, cid).find(x => x.id === cw.editing);
      if (e && cw.editVis !== e.kind && !(await confirmVis(e.kind, cw.editVis))) { btn.disabled = false; return; }
      const ok = e && cw.editVis !== e.kind
        ? await run(e.kind === 'private' ? `/private/${encodeURIComponent(e.id)}/publish` : `/cells/${encodeURIComponent(e.id)}/private`, {method: 'POST', body: {...loc, body}})
        : e ? await run(`/${e.kind === 'private' ? 'private' : 'cells'}/${encodeURIComponent(e.id)}`, {method: 'PUT', body: {...loc, body}})
        : await run(cw.vis === 'private' ? '/private' : '/cells', {method: 'POST', body: {...loc, body}});
      btn.disabled = false;
      if (ok) { const was = cw.editing; cw.editing = null; cw.orig = ''; ta.value = ''; paint(was); ta.focus(); }
    }
    m.el.addEventListener('click', async ev => {
      const t = ev.target, nb = t.closest('.nb'), e = nb && cellEntries(pid, cid).find(x => x.id === nb.dataset.eid);
      if (t.closest('[data-cwclose]')) return m.close();
      if (t.closest('[data-cwsave]')) return saveIt();
      if (t.closest('[data-cwcancel]')) return stopEdit();
      const v = t.closest('[data-vis]');
      if (v && !v.disabled) {
        if (cw.editing) cw.editVis = v.dataset.vis;
        else { cw.vis = v.dataset.vis; if (W) lsSet('papershelf-table-vis', cw.vis); }
        paint(cw.editing); ta.focus(); return;
      }
      if (!e) return;
      if (t.closest('[data-cwedit]')) return startEdit(e.id);
      if (t.closest('[data-cwdel]')) {
        if (!(await confirmBox(e.kind === 'private' ? 'Delete this private entry?' : 'Delete your entry for everybody?', e.kind === 'private' ? 'It is only on this computer.' : 'The other members will no longer see it.', {ok: 'Delete', danger: true}))) return;
        if (cw.editing === e.id) { cw.editing = null; cw.orig = ''; ta.value = ''; }
        if (await run(`/${e.kind === 'private' ? 'private' : 'cells'}/${encodeURIComponent(e.id)}?paper=${pid}&col=${encodeURIComponent(cid)}`, {method: 'DELETE'})) paint();
        return;
      }
      if (t.closest('[data-cwpriv]')) {
        if (!(await confirmVis('public', 'private'))) return;
        if (cw.editing === e.id) { cw.editing = null; cw.orig = ''; ta.value = ''; }
        if (await run(`/cells/${encodeURIComponent(e.id)}/private`, {method: 'POST', body: {paper_id: pid, col: cid}})) paint();
        return;
      }
      if (t.closest('[data-cwpub]')) {
        if (!(await confirmVis('private', 'public'))) return;
        if (cw.editing === e.id) { cw.editing = null; cw.orig = ''; ta.value = ''; }
        if (await run(`/private/${encodeURIComponent(e.id)}/publish`, {method: 'POST', body: {paper_id: pid, col: cid}})) paint();
      }
    });
    ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); saveIt(); } });
    const fe = focusId && cellEntries(pid, cid).find(x => x.id === focusId);
    if (fe && fe.mine) startEdit(fe.id);
    else { paint(focusId); setTimeout(() => ta.focus(), 30); }
  }

  function draw() {
    const el = box(); if (!el || !data) return;
    if (data.shared) return drawShared();
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
    const cell = (p, c) => data.shared ? cellEntries(p.id, c.id).map(e => `${e.kind === 'private' ? 'Me (private)' : e.name || e.by}: ${e.body}`).join('\n') : (data.cells[p.uid] || {})[c.id] || '';
    const row = p => [ref(p), p.title || '', p.journal || '', p.doi || '', ...data.cols.map(c => cell(p, c))];
    const head = ['Reference', 'Title', 'Journal', 'DOI', ...data.cols.map(c => c.name)];
    if (kind === 'csv') {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      download(`${title} – review.csv`, '﻿' + [head, ...P.map(row)].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
    } else {
      const c = v => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
      const mdHead = ['Paper', ...data.cols.map(x => x.name)];
      const lines = [`# ${viewTitle()} – review`, '', `| ${mdHead.map(c).join(' | ')} |`, `|${mdHead.map(() => ' --- ').join('|')}|`,
        ...P.map(p => `| ${c(`${ref(p)}. ${p.title || ''}${p.doi ? ` https://doi.org/${p.doi}` : ''}`)} | ${data.cols.map(x => c(cell(p, x))).join(' | ')} |`)];
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
      if (data.shared) {
        if (a === 'del') {
          const used = Object.values(data.cells).filter(r => (r[C[i].id] || []).length).length;
          if (!(await confirmBox(`Delete the column “${C[i].name}” for everybody?`, used ? `Its entries in ${plural(used, 'paper')} will no longer be shown.` : 'It is removed from the table of every member.', {ok: 'Delete', danger: true}))) return;
          return colCall({action: 'delete', id: C[i].id});
        }
        return colCall({action: 'move', id: C[i].id, dir: a});
      }
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
    if (data.shared) return colCall({action: 'rename', id, name: v});
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
      if (data?.shared) {
        if (t.closest('#rv-refresh')) {
          const b = t.closest('#rv-refresh'); b.disabled = true;
          await Shares.syncNow(state.view.id);
          b.disabled = false; return render();
        }
        if (t.closest('#rv-addcol')) {
          const v = await askText('New column (for everybody)', {placeholder: 'e.g. Sample size, Species, Key figure…', ok: 'Add'}); if (!v) return;
          return colCall({action: 'add', name: v});
        }
        const td = t.closest('td.rv-sc');
        if (td && !String(getSelection())) {
          const chip = t.closest('.rv-e');
          return openCell(+td.dataset.pid, td.dataset.col, chip && !t.closest('[data-cadd]') ? chip.dataset.eid : null);
        }
      }
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
  // open a cell of a group's table (from a notification)
  async function openCellByName(pid, colName) {
    for (let i = 0; i < 40 && !(data?.shared && state.view.type === 'share'); i++) await new Promise(r => setTimeout(r, 100));
    if (!data?.shared) return;
    const c = data.cols.find(x => x.name === colName) || data.cols[0];
    if (c) openCell(pid, c.id);
  }
  return {render, bind, openCellByName, reset() { key = null; }};
})();

/* ------------------------------------------------------------------ the 🔔: notifications
   What the other members of your groups did (a note, an entry in the group table, a paper added),
   found when the groups are updated – plus the new papers of What's new. Kept on this computer. */
const Bell = (() => {
  let act = {items: [], unseen: 0}, pop = null, timer = null;
  const KEY = 'papershelf-bell-last';
  const lsGet = () => { try { return +localStorage.getItem(KEY) || 0; } catch { return 0; } };
  const lsSet = v => { try { localStorage.setItem(KEY, String(v)); } catch { /* private window */ } };
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  function ago(s) {
    const t = Date.parse(s); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); return d < 7 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString();
  }
  const feedN = () => Feed.data?.count || 0;
  function badge() {
    const forMe = act.items.filter(i => !i.seen && (i.kind === 'task' || i.kind === 'mention')).length;
    const lb = $('#tab-lab-n'); if (lb) { lb.textContent = forMe || ''; lb.title = forMe ? `${plural(forMe, 'new thing')} for you in the Lab (tasks, messages)` : ''; }
    const n = act.unseen + feedN();
    const b = $('#feed-n'); if (b) b.textContent = n ? (n > 99 ? '99+' : n) : '';
    const btn = $('#feed-btn');
    if (btn) btn.title = [act.unseen ? `${plural(act.unseen, 'new thing')} in your groups` : '', feedN() ? `${plural(feedN(), 'new paper')} in What's new` : ''].filter(Boolean).join(' · ') || 'Notifications – your groups and What\'s new';
  }
  const LABK = {idea: 'an idea', experiment: 'an experiment', question: 'a question', result: 'a result', decision: 'a decision', protocol: 'a protocol', note: 'a note'};
  const what = i => i.kind === 'post' ? `posted ${LABK[i.col] || 'an idea'} in the Lab${i.title ? `: <i>${esc(truncate(i.title, 90))}</i>` : ''}`
    : i.kind === 'comment' ? `commented on <i>${esc(truncate(i.title, 90))}</i>`
    : i.kind === 'task' ? `assigned you a task: <i>${esc(truncate(i.title, 90))}</i>`
    : i.kind === 'mention' ? (i.col === 'posts' ? `wrote to you in the Lab: <i>${esc(truncate(i.title, 90))}</i>` : `replied to you on <i>${esc(truncate(i.title, 90))}</i>`)
    : i.kind === 'note' ? `added a note on <i>${esc(truncate(i.title, 90))}</i>`
    : i.kind === 'entry' ? `added an entry in <b>${esc(i.col)}</b> on <i>${esc(truncate(i.title, 90))}</i>`
    : `added <i>${esc(truncate(i.title, 90))}</i> to the group`;
  const plainWhat = i => i.kind === 'post' ? `posted ${LABK[i.col] || 'an idea'} in ${i.share_name}: “${truncate(i.title || '', 60)}”`
    : i.kind === 'comment' ? `commented on “${truncate(i.title, 60)}”` : i.kind === 'task' ? `assigned you a task in ${i.share_name}: “${truncate(i.title, 60)}”`
    : i.kind === 'mention' ? (i.col === 'posts' ? `wrote to you in ${i.share_name}: “${truncate(i.title, 60)}”` : `replied to you on “${truncate(i.title, 60)}”`)
    : i.kind === 'note' ? `added a note on “${truncate(i.title, 60)}”` : i.kind === 'entry' ? `added an entry in ${i.col} on “${truncate(i.title, 60)}”` : `added “${truncate(i.title, 60)}” to ${i.share_name}`;
  async function load({toastNew = true} = {}) {
    try { act = await api('/api/activity'); } catch { return; }
    badge(); if (pop) paint();
    const last = lsGet(), top = act.items[0]?.id || 0;
    if (!last) { lsSet(top || 1); return; }                       // first time: no flood of toasts
    const fresh = act.items.filter(i => i.id > last && !i.seen);
    if (top > last) lsSet(top);
    if (!toastNew || !fresh.length) return;
    if (fresh.length <= 2) fresh.slice().reverse().forEach(i => toast(`${i.kind === 'task' ? '✅' : i.kind === 'mention' ? '📨' : '🔔'} ${i.name} ${plainWhat(i)}`, i.kind === 'task' || i.kind === 'mention' ? 'ok' : 'info', i.kind === 'task' || i.kind === 'mention' ? 12000 : 7000));
    else toast(`🔔 ${plural(fresh.length, 'new thing')} in your groups – click the bell to see them.`, 'info', 7000);
  }
  function paint() {
    if (!pop) return;
    const fn = feedN();
    pop.innerHTML = `<div class="bl-head"><b>Notifications</b><span class="grow"></span>${act.items.length ? '<button class="linklike small" data-blclear title="Remove all the notifications">Clear all</button>' : ''}</div>
      <button class="bl-feed" data-blfeed><span class="bl-fico">📰</span><span><b>What's new</b><br><span class="muted small">${fn ? `${plural(fn, 'new paper')} by the researchers and topics you follow` : 'New papers by the researchers and topics you follow'}</span></span>${fn ? `<span class="bl-n">${fn > 99 ? '99+' : fn}</span>` : ''}</button>
      <div class="bl-sec muted small">Your groups</div>
      <div class="bl-list">${act.items.length ? act.items.map(i => `<button class="bl-item ${i.seen ? '' : 'new'}" data-blid="${i.id}">
          <span class="bl-av" style="background:hsl(${hue(i.who)} 50% 42%)">${esc(initials(i.name))}</span>
          <span class="bl-txt"><span><b>${esc(i.name)}</b> ${what(i)}</span>${i.excerpt ? `<span class="bl-ex">“${esc(truncate(i.excerpt, 120))}”</span>` : ''}
            <span class="bl-meta">${{note: '📝', entry: '▦', post: '🧪', comment: '💬', task: '✅', mention: '📨'}[i.kind] || '📄'} ${esc(i.share_name)} · ${esc(ago(i.at))}</span></span></button>`).join('')
        : '<div class="bl-empty muted small">Nothing yet. When someone adds a note, an entry in the group table, a paper, a post or a comment in the Lab, or gives you a task in one of your groups, it appears here (groups update every 15 minutes, or with ⟳).</div>'}</div>`;
  }
  function close() { pop?.remove(); pop = null; document.removeEventListener('mousedown', outside, true); }
  function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('#feed-btn')) close(); }
  async function open() {
    if (pop) return close();
    pop = document.createElement('div'); pop.className = 'bell-pop'; document.body.appendChild(pop);
    const r = $('#feed-btn').getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`; pop.style.right = `${Math.max(8, innerWidth - r.right - 6)}px`;
    paint();
    document.addEventListener('mousedown', outside, true);
    pop.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-blfeed]')) { close(); Feed.open(); return; }
      if (t.closest('[data-blclear]')) { await api('/api/activity', {method: 'DELETE'}); act = {items: [], unseen: 0}; badge(); paint(); return; }
      const b = t.closest('[data-blid]'); if (!b) return;
      const i = act.items.find(x => x.id === +b.dataset.blid); close(); if (!i) return;
      if (i.kind === 'post' || i.kind === 'comment' || i.kind === 'mention') { Lab.openGroup(i.share_id, {post: i.item_key}); return; }
      if (i.kind === 'task') { Lab.openGroup(i.share_id, {task: i.item_key}); return; }
      const goGroup = () => { if (state.tab !== 'library' || state.area !== 'library') setTab('library'); setView({type: 'share', id: i.share_id}); };
      if (!i.paper_id) { goGroup(); return; }
      if (i.kind === 'note') Notes.open(i.paper_id);
      else if (i.kind === 'entry') { goGroup(); setMode('table'); Review.openCellByName(i.paper_id, i.col); }
      else { goGroup(); openDetail(i.paper_id); }
    });
    if (act.unseen) {   // seen once the panel is open (they stay highlighted until it closes)
      try { await api('/api/activity/seen', {method: 'POST'}); } catch { /* ignore */ }
      act.unseen = 0;
      act.items.forEach(i => { i.seen = true; });
      badge();
    }
  }
  function start() {
    load();
    clearInterval(timer); timer = setInterval(() => load(), 90000);
  }
  return {load, badge, open, close, start};
})();

document.addEventListener('DOMContentLoaded', () => {
  $('#feed-btn')?.addEventListener('click', () => Bell.open());
  setTimeout(() => Bell.start(), 900);
  Review.bind();
  setTimeout(() => Feed.load(), 1200);
});
