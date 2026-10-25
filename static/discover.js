'use strict';
/* Discover: papers you might be missing, based on the citation network of the
   current label (or the whole library), from OpenAlex. */
const Discover = (() => {
  let lastKey = null, data = null, loading = false;
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

  function card(w, reason) {
    const done = added.get(w.id);
    const link = w.doi ? `https://doi.org/${w.doi}` : `https://openalex.org/${w.id}`;
    return `<div class="s-card">
      <div class="s-title">${esc(w.title || 'Untitled')}</div>
      <div class="s-meta">${esc([w.authors, w.venue, w.year].filter(Boolean).join(' · '))}</div>
      <div class="s-foot">
        <span class="s-reason">${reason}</span>
        <span class="muted small">cited ${(w.cited_by_count || 0).toLocaleString()}×</span>
        <span class="grow"></span>
        <a class="btn small" href="${esc(link)}" target="_blank" rel="noopener" title="Open the article page">🔗</a>
        ${done ? `<button class="btn small" data-openp="${done}">✓ Added – open</button>`
               : `<button class="btn small primary" data-add="${esc(w.id)}" data-sid="${esc(w.id)}">＋ Add</button>`}
      </div></div>`;
  }

  function section(title, help, items, reason) {
    if (!items?.length) return '';
    return `<section class="s-section"><h3>${title}</h3><p class="muted small">${help}</p>
      <div class="s-grid">${items.map(w => card(w, reason(w))).join('')}</div></section>`;
  }

  function draw() {
    const root = $('#discover-view');
    const nonGroup = !['all', 'group'].includes(state.view.type);
    let html = `<div class="s-head"><div><b>Suggestions based on ${scopeLabel()}</b>${nonGroup ? ' <span class="muted small">(open a label to get suggestions for that topic)</span>' : ''}</div>
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
    root.innerHTML = html;
  }

  function bind() {
    const root = $('#discover-view');
    root.addEventListener('click', async e => {
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
  return {render};
})();
