/* PaperShelf – suggestions under the "Add paper" box: type a few words of a title (or authors,
   year…) and pick the paper from a list of likely matches found online (OpenAlex, Crossref). */
'use strict';

const Suggest = (() => {
  const MIN_CHARS = 6;
  let box = null, timer = null, seq = 0, items = [], active = -1, lastQ = '';
  const cache = new Map();

  const looksLikeId = v => /^(https?:\/\/|www\.|10\.\d{4,}\/|doi:|arxiv:|pmid:?|\d{4}\.\d{4,5}|W\d{5,}$)/i.test(v.trim());
  const input = () => $('#add-input');

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'suggest'; box.className = 'suggest'; box.hidden = true;
    $('#add-form').appendChild(box);
    box.addEventListener('mousedown', e => e.preventDefault()); // keep the focus in the input
    box.addEventListener('click', e => {
      if (e.target.closest('[data-topic]')) { const q = lastQ || input().value.trim(); close(); input().value = ''; setMode('discover'); Discover.searchFor(q); return; }
      const it = e.target.closest('[data-si]'); if (it) pick(+it.dataset.si);
      if (e.target.closest('[data-sclose]')) close();
    });
    return box;
  }

  function close() { if (box) { box.hidden = true; box.innerHTML = ''; } items = []; active = -1; }
  const isOpen = () => box && !box.hidden;

  function authorsLine(c) {
    const a = c.authors || [];
    if (!a.length) return '';
    if (a.length > 3) return `${esc(a[0])}, ${esc(a[1])} … ${esc(a[a.length - 1])}`;
    return a.map(esc).join(', ') + ((c.n_authors || 0) > a.length ? ' et al.' : '');
  }

  function render(q, {loading = false, error = '', fromError = false} = {}) {
    ensureBox();
    const head = fromError ? `<div class="sg-head">No exact match for “${esc(truncate(q, 60))}” – is it one of these?<button class="linklike" data-sclose>close</button></div>`
      : `<div class="sg-head">Papers matching “${esc(truncate(q, 60))}” <span class="muted">· ↑↓ to choose, Enter to add</span><button class="linklike" data-sclose>close</button></div>`;
    let body;
    if (loading) body = '<div class="sg-msg">Searching online…</div>';
    else if (error) body = `<div class="sg-msg err">${esc(error)}</div>`;
    else if (!items.length) body = '<div class="sg-msg">Nothing found. Try other words, the authors, or paste the DOI / link.</div>';
    else body = items.map((c, i) => `<div class="sg-item ${i === active ? 'on' : ''}" data-si="${i}">
        <div class="sg-title">${esc(c.title)}</div>
        <div class="sg-meta">${authorsLine(c)}${c.year ? ` · <b>${c.year}</b>` : ''}${c.venue ? ` · <i>${esc(truncate(c.venue, 50))}</i>` : ''}${c.cites ? ` · ${c.cites.toLocaleString()} cit.` : ''}${c.type && !['article', 'journal-article'].includes(c.type) ? ` · ${esc(c.type)}` : ''}</div>
        ${c.in_library ? '<span class="sg-have">in your library</span>' : ''}</div>`).join('');
    box.innerHTML = head + body + `<div class="sg-foot"><span>Papers whose title matches · OpenAlex / Crossref · only the words you typed are sent</span>
      <button class="linklike" data-topic title="Find papers about this subject, even if their titles use other words">🔎 Search by topic: “${esc(truncate(q, 40))}”</button></div>`;
    box.hidden = false;
  }

  async function search(q, opts = {}) {
    lastQ = q; const my = ++seq;
    if (cache.has(q)) { items = cache.get(q); active = items.length && opts.fromError ? 0 : -1; render(q, opts); return; }
    items = []; render(q, {...opts, loading: true});
    try {
      const d = await api('/api/search-online?q=' + encodeURIComponent(q));
      if (my !== seq) return;
      items = d.results || []; cache.set(q, items); active = items.length && opts.fromError ? 0 : -1;
      render(q, opts);
    } catch (err) { if (my === seq) render(q, {...opts, error: err.message}); }
  }

  async function pick(i) {
    const c = items[i]; if (!c) return;
    if (c.in_library) { close(); input().value = ''; openDetail(c.in_library); toast('Already in your library – opened it.'); return; }
    close();
    const btn = $('#add-btn'); setBusy(btn, true, 'Adding…');
    try {
      const d = await addOne(c.doi || c.openalex_id); input().value = '';
      upsertPaper(d.paper); renderAll(); openDetail(d.paper.id);
      toast(d.duplicate ? 'Already in your library – opened it.' : `Added: ${truncate(d.paper.title, 80)}`, d.duplicate ? 'info' : 'ok');
    } catch (err) { toast(err.message, 'error', 9000); }
    finally { setBusy(btn, false); }
  }

  function onInput() {
    clearTimeout(timer);
    const q = input().value.trim();
    if (q.length < MIN_CHARS || looksLikeId(q) || q.split(/\s+/).length < 2 || /\n/.test(q)) { if (!q || looksLikeId(q)) close(); return; }
    timer = setTimeout(() => { if (input().value.trim() === q && q !== lastQ) search(q); }, 550);
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { close(); e.preventDefault(); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      active = e.key === 'ArrowDown' ? (active + 1 >= n ? -1 : active + 1) : (active - 1 < -1 ? n - 1 : active - 1);
      $$('.sg-item', box).forEach((el, i) => el.classList.toggle('on', i === active));
      $$('.sg-item', box)[active]?.scrollIntoView({block: 'nearest'});
      return;
    }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(active); }
  }

  function init() {
    const inp = input(); if (!inp) return;
    inp.addEventListener('input', () => { lastQ = lastQ === inp.value.trim() ? lastQ : ''; onInput(); });
    inp.addEventListener('keydown', onKey, true);
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) close(); }, 150));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  return {init, close, show: (q, opts) => search(q, opts)};
})();

Suggest.init();
