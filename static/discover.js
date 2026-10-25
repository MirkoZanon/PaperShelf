'use strict';
/* Discover: papers you might be missing, based on the citation network of the
   current label (or the whole library), from OpenAlex. */
const Discover = (() => {
  let lastKey = null, data = null, loading = false;
  // search by topic (OpenAlex semantic search on titles + abstracts)
  const T = {q: '', mode: 'semantic', from: '', oa: false, type: 'all', loading: false, results: null, note: '', error: '', seq: 0};
  try { Object.assign(T, JSON.parse(localStorage.getItem('papershelf-topic') || '{}'), {results: null, loading: false, error: '', note: ''}); } catch (e) { /* ignore */ }
  const added = new Map();  // suggestion id -> paper id

  const scopeKey = () => state.view.type === 'group' ? `g${state.view.id}:${state.includeSub ? 1 : 0}` : 'all';
  const scopeLabel = () => state.view.type === 'group' ? `“${groupPath(state.view.id)}”` : 'your whole library';

  async function load() {
    loading = true; draw();
    const q = state.view.type === 'group' ? `?group=${state.view.id}&sub=${state.includeSub ? 1 : 0}` : '';
    try { data = await api('/api/suggestions' + q); }
    catch (err) { data = {error: err.message}; }
    loading = false; draw();
  }

  function card(w, reason, abstract = '') {
    const done = added.get(w.id) || w.in_library;
    const link = w.doi ? `https://doi.org/${w.doi}` : `https://openalex.org/${w.id}`;
    return `<div class="s-card">
      <div class="s-title">${esc(w.title || 'Untitled')}</div>
      <div class="s-meta">${esc([w.authors, w.venue, w.year].filter(Boolean).join(' · '))}${w.oa ? ' · <span class="oa-tag" title="Free to read">open access</span>' : ''}</div>
      ${abstract ? `<div class="s-abs">${esc(abstract)}</div>` : ''}
      <div class="s-foot">
        <span class="s-reason">${reason}</span>
        <span class="muted small">cited ${(w.cited_by_count || 0).toLocaleString()}×</span>
        <span class="grow"></span>
        <a class="btn small" href="${esc(link)}" target="_blank" rel="noopener" title="Open the article page">🔗</a>
        ${done ? `<button class="btn small" data-openp="${done}">✓ ${w.in_library && !added.get(w.id) ? 'In your library' : 'Added'} – open</button>`
               : `<button class="btn small primary" data-add="${esc(w.id)}" data-sid="${esc(w.id)}">＋ Add</button>`}
      </div></div>`;
  }

  function section(title, help, items, reason) {
    if (!items?.length) return '';
    return `<section class="s-section"><h3>${title}</h3><p class="muted small">${help}</p>
      <div class="s-grid">${items.map(w => card(w, reason(w))).join('')}</div></section>`;
  }

  function topicPanel() {
    const r = T.results;
    let html = `<div class="topic-box">
      <div class="topic-row"><input class="input" id="t-q" type="search" placeholder="🔎 Find papers about… – describe a topic, a question, or paste an abstract" value="${esc(T.q)}">
        <button class="btn primary" id="t-go" ${T.loading ? 'disabled' : ''}>${T.loading ? 'Searching…' : 'Search'}</button></div>
      <div class="topic-opts">
        <span class="seg small-seg" id="t-mode"><button data-tm="semantic" class="${T.mode === 'semantic' ? 'on' : ''}" title="Finds papers about the same idea, even if they use other words">By meaning</button><button data-tm="keyword" class="${T.mode === 'keyword' ? 'on' : ''}" title="Classic search: papers containing your words (title, abstract, full text)">By words</button></span>
        <label class="muted small">from <input class="input" id="t-from" type="number" placeholder="year" value="${esc(T.from)}" style="width:80px"></label>
        <select class="input" id="t-type"><option value="all" ${T.type === 'all' ? 'selected' : ''}>All types</option><option value="articles" ${T.type === 'articles' ? 'selected' : ''}>Articles &amp; reviews</option><option value="reviews" ${T.type === 'reviews' ? 'selected' : ''}>Reviews only</option></select>
        <label class="muted small"><input type="checkbox" id="t-oa" ${T.oa ? 'checked' : ''}> free to read</label>
        <span class="muted small">· OpenAlex, 250+ million works – only your search text is sent</span>
        ${r ? '<button class="linklike" id="t-clear">clear results</button>' : ''}</div></div>`;
    if (T.error) html += `<p class="up-err">✗ ${esc(T.error)}</p>`;
    if (r) {
      html += `<section class="s-section"><h3>${T.mode === 'semantic' ? 'Papers about' : 'Papers matching'} “${esc(truncate(T.q, 80))}”</h3>
        <p class="muted small">${r.length} result${r.length === 1 ? '' : 's'}, most relevant first${T.note ? ' · ' + esc(T.note) : ''}. ${T.mode === 'semantic' ? 'Search by meaning compares your text with titles and abstracts, so it also finds papers that use different words.' : ''}</p>
        ${r.length ? `<div class="s-grid">${r.map((w, i) => card(w, `#${i + 1}${w.type && w.type !== 'article' ? ' · ' + esc(w.type) : ''}`, truncate(w.abstract || '', 260))).join('')}</div>` : '<div class="empty"><p>Nothing found – try other words, or switch between “By meaning” and “By words”.</p></div>'}</section>`;
    }
    return html;
  }

  async function searchTopic() {
    const q = ($('#t-q')?.value || '').trim(); if (q.length < 3) { $('#t-q')?.focus(); return; }
    T.q = q; T.from = $('#t-from')?.value || ''; T.oa = !!$('#t-oa')?.checked; T.type = $('#t-type')?.value || 'all';
    try { localStorage.setItem('papershelf-topic', JSON.stringify({q: T.q, mode: T.mode, from: T.from, oa: T.oa, type: T.type})); } catch (e) { /* ignore */ }
    const my = ++T.seq; T.loading = true; T.error = ''; draw();
    try {
      const d = await api(`/api/search-topic?q=${encodeURIComponent(q)}&mode=${T.mode}&from=${encodeURIComponent(T.from)}&oa=${T.oa ? 1 : 0}&type=${T.type}`);
      if (my !== T.seq) return;
      T.results = d.results; T.note = d.note || '';
    } catch (err) { if (my === T.seq) { T.error = err.message; T.results = null; } }
    if (my === T.seq) { T.loading = false; draw(); }
  }
  function searchFor(q, mode = 'semantic') { T.q = q; T.mode = mode; draw(); searchTopic(); }

  function draw() {
    const root = $('#discover-view');
    const nonGroup = !['all', 'group'].includes(state.view.type);
    let html = topicPanel() + `<div class="s-head"><div><b>Suggestions based on ${scopeLabel()}</b>${nonGroup ? ' <span class="muted small">(open a label to get suggestions for that topic)</span>' : ''}</div>
      <span><button class="btn small" id="s-refresh" ${loading ? 'disabled' : ''}>↻ Refresh</button> <button class="help-q" data-help="map" title="Explain this">?</button></span></div>`;
    if (loading) {
      html += `<div class="empty"><div class="spin big-spin"></div><p>Looking for related papers on OpenAlex…</p></div>`;
    } else if (!data) {
      html += '';
    } else if (data.error) {
      html += `<div class="empty"><div class="big">📡</div><h2>Couldn't get suggestions</h2><p>${esc(data.error)}</p></div>`;
    } else if (!data.scope) {
      html += `<div class="empty"><div class="big">💡</div><h2>No papers here yet</h2><p>Add some papers with this label first.</p></div>`;
    } else {
      if (data.missing_data) {
        html += `<div class="s-note">${data.missing_data} of ${data.scope} papers have no citation data yet, so suggestions are based on ${data.with_data}.
          <button class="btn small" id="s-fetch">Get citation data</button></div>`;
      }
      if (!data.with_data) {
        html += `<div class="empty"><div class="big">💡</div><h2>Citation data needed</h2><p>Suggestions come from who-cites-whom among your papers. Click “Get citation data” above (needs internet).</p></div>`;
      } else {
        const n = data.with_data;
        html += section('📌 Often cited by your papers', `Works that several of your papers cite – frequently the classics of the field.`,
          data.cocited, w => `cited by ${w.count} of your ${n} papers`);
        html += section('🆕 Recent papers that build on yours', `Published in the last few years and citing the papers here (most overlap first).`,
          data.citing, w => `cites ${w.count} of your papers`);
        html += section('🔗 Related works', `OpenAlex's “related works”, counted across your papers.`,
          data.related, w => `related to ${w.count} of your papers`);
        if (!data.cocited.length && !data.citing.length && !data.related.length) {
          html += `<div class="empty"><div class="big">🤷</div><h2>Nothing to suggest yet</h2><p>Add a few more papers on this topic and try again.</p></div>`;
        }
        if (data.errors?.length) html += `<p class="muted small">Some suggestions are missing: ${esc(data.errors.join('; '))}</p>`;
      }
    }
    const had = document.activeElement?.id === 't-q';
    root.innerHTML = html;
    if (had) { const f = $('#t-q'); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length); }
  }

  function bind() {
    const root = $('#discover-view');
    root.addEventListener('keydown', e => { if (e.target.id === 't-q' && e.key === 'Enter') { e.preventDefault(); searchTopic(); } });
    root.addEventListener('click', async e => {
      if (e.target.id === 't-go') { searchTopic(); return; }
      if (e.target.id === 't-clear') { T.results = null; draw(); return; }
      const tm = e.target.closest('[data-tm]');
      if (tm) { T.mode = tm.dataset.tm; T.q = $('#t-q')?.value || T.q; if (T.results) searchTopic(); else draw(); return; }
      if (e.target.id === 's-refresh') { data = null; load(); return; }
      if (e.target.id === 's-fetch') {
        const ids = state.papers.filter(p => !p.openalex_id && !p.citations_at && (p.doi || p.arxiv_id)).map(p => p.id);
        setBusy(e.target, true, 'Fetching…');
        await fetchCitations(ids, {quiet: true});
        data = null; load(); return;
      }
      const op = e.target.closest('[data-openp]');
      if (op) { openDetail(+op.dataset.openp); return; }
      const b = e.target.closest('[data-add]');
      if (!b) return;
      setBusy(b, true, 'Adding…');
      try {
        const d = await api('/api/papers', {method: 'POST', body: {input: b.dataset.add, group_id: currentGroupId()}});
        upsertPaper(d.paper); added.set(b.dataset.sid, d.paper.id);
        if (T.results) T.results.forEach(w => { if (w.id === b.dataset.sid) w.in_library = d.paper.id; });
        renderSidebar(); renderList(); draw();
        toast(`Added: ${truncate(d.paper.title, 80)}${currentGroupId() ? ` → ${groupPath(currentGroupId())}` : ''}`, 'ok');
      } catch (err) { setBusy(b, false); toast(err.message, 'error'); }
    });
  }

  function render(scopeChanged = false) {
    if (!bind.done) { bind(); bind.done = true; }
    const key = scopeKey();
    if (key !== lastKey || !data) { lastKey = key; data = null; if (!loading) load(); }
    else if (scopeChanged) draw();
  }
  return {render, searchFor};
})();
