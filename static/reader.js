'use strict';
/* PDF reader with highlights and notes, built on PDF.js (bundled, works offline).
   Highlights are stored in PaperShelf (in PDF coordinates) and can also be
   written into the PDF file itself with "Save into PDF". */
const Reader = (() => {
  const COLORS = {yellow: '#ffd400', green: '#5fb236', blue: '#2ea8e5', red: '#ff6666', purple: '#a28ae5'};
  let pdfjs = null, doc = null, paper = null, scale = 1.2, anns = [], pages = {}, color = 'yellow';
  let isOpen = false, observer = null, token = 0, sizes = [];

  async function lib() {
    if (!pdfjs) {
      pdfjs = await import('/static/vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.mjs';
    }
    return pdfjs;
  }
  const root = () => $('#reader');

  async function open(id, startPage = 0) {
    paper = paperById(id);
    if (!paper?.pdf_exists) { toast('There is no PDF for this paper yet.', 'error'); return; }
    isOpen = true; anns = []; pages = {}; token++;
    try { color = localStorage.getItem('papershelf-hl-color') || 'yellow'; } catch (e) { /* ignore */ }
    const r = root();
    r.innerHTML = `
      <div class="r-bar">
        <button class="btn small" id="r-close" title="Close (Esc)">✕ Close</button>
        <div class="r-title" title="${esc(paper.title)}">${esc(paper.title)}</div>
        <div class="r-tools">
          <span class="muted small" id="r-pageinfo"></span>
          <button class="btn small" id="r-zoom-out" title="Zoom out">−</button><span id="r-zoom" class="small r-zoom"></span><button class="btn small" id="r-zoom-in" title="Zoom in">+</button>
          <button class="btn small" id="r-fit">Fit width</button>
          <span class="r-colors" title="Highlight color">${Object.entries(COLORS).map(([k, v]) => `<button class="r-color ${k === color ? 'on' : ''}" data-color="${k}" style="background:${v}" title="${k}"></button>`).join('')}</span>
          <button class="btn small" id="r-embed" title="Write the highlights into the PDF file, so they also show in Preview, Acrobat or Zotero">💾 Save into PDF</button>
          <a class="btn small" href="/pdf/${paper.id}" target="_blank" rel="noopener" title="Open in the browser's own PDF viewer">↗</a><button class="help-q" data-help="reader" title="Explain this">?</button>
        </div>
      </div>
      <div class="r-body">
        <div class="r-pages" id="r-pages"><div class="r-loading muted">Loading PDF…</div></div>
        <aside class="r-side">
          <div class="r-side-head">Highlights <span class="muted" id="r-count"></span></div>
          <div class="muted small r-hint">Select text in the PDF, then click a color to highlight it. Click a highlight to add a note.</div>
          <div id="r-list"></div>
          <div class="r-side-foot"><button class="btn small" id="r-copy">Copy all</button><button class="btn small" id="r-tonotes">Add to my notes</button></div>
        </aside>
      </div>
      <div class="r-pop" id="r-pop"></div>`;
    r.classList.add('open'); document.body.classList.add('reader-open');
    bind();
    try {
      const L = await lib();
      doc = await L.getDocument({url: `/pdf/${paper.id}?t=${Date.now()}`}).promise;
      const d = await api(`/api/papers/${paper.id}/annotations`); anns = d.annotations;
      sizes = [];
      const n = doc.numPages;
      const first = await doc.getPage(1);
      for (let i = 1; i <= n; i++) {
        const pg = i === 1 ? first : (n <= 400 ? await doc.getPage(i) : first);
        const vp = pg.getViewport({scale: 1}); sizes[i] = [vp.width, vp.height];
      }
      fitWidth(false);
      layout(); list();
      if (startPage > 1 && startPage <= n) setTimeout(() => goTo({page: startPage, rects: [], id: 0}), 150);
    } catch (err) {
      $('#r-pages').innerHTML = `<div class="r-loading">Could not open this PDF: ${esc(err.message || String(err))}</div>`;
    }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false; token++;
    observer?.disconnect(); observer = null;
    try { doc?.destroy(); } catch (e) { /* ignore */ }
    doc = null;
    root().classList.remove('open'); root().innerHTML = ''; document.body.classList.remove('reader-open');
    loadLibrary().catch(() => {});
  }

  function fitWidth(relayout = true) {
    const avail = $('#r-pages').clientWidth - 48;
    scale = Math.max(0.5, Math.min(2.5, avail / (sizes[1]?.[0] || 612)));
    if (relayout) layout();
  }
  function zoom(f) {
    const box = $('#r-pages'); const ratio = box.scrollTop / Math.max(1, box.scrollHeight);
    scale = Math.max(0.4, Math.min(4, scale * f)); layout();
    box.scrollTop = ratio * box.scrollHeight;
  }

  function layout() {
    token++;
    const box = $('#r-pages');
    observer?.disconnect();
    pages = {};
    box.innerHTML = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const [w, h] = sizes[i] || sizes[1];
      const shell = document.createElement('div');
      shell.className = 'r-page'; shell.dataset.page = i;
      shell.style.width = `${Math.floor(w * scale)}px`; shell.style.height = `${Math.floor(h * scale)}px`;
      shell.innerHTML = `<canvas></canvas><div class="hl-layer"></div><div class="textLayer"></div><div class="r-pnum">${i}</div>`;
      box.appendChild(shell);
    }
    $('#r-zoom').textContent = `${Math.round(scale * 100)}%`;
    observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) renderPage(+e.target.dataset.page);
    }, {root: box, rootMargin: '800px 0px'});
    $$('.r-page', box).forEach(s => observer.observe(s));
    pageInfo();
  }

  async function renderPage(n) {
    const my = token;
    if (pages[n]?.token === my) return;
    pages[n] = {token: my};
    const page = await doc.getPage(n);
    if (my !== token) return;
    const vp = page.getViewport({scale});
    const shell = $(`.r-page[data-page="${n}"]`); if (!shell) return;
    shell.style.width = `${Math.floor(vp.width)}px`; shell.style.height = `${Math.floor(vp.height)}px`;
    shell.style.setProperty('--scale-factor', scale);
    const canvas = $('canvas', shell); const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
    pages[n].vp = vp;
    try {
      await page.render({canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null}).promise;
      if (my !== token) return;
      const tl = $('.textLayer', shell); tl.innerHTML = '';
      const L = await lib();
      await new L.TextLayer({textContentSource: page.streamTextContent(), container: tl, viewport: vp}).render();
    } catch (e) { /* rendering cancelled */ }
    drawHighlights(n);
  }

  function vpRect(vp, r) {
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
    return {left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
  }
  function drawHighlights(n) {
    const shell = $(`.r-page[data-page="${n}"]`); const vp = pages[n]?.vp;
    if (!shell || !vp) return;
    $('.hl-layer', shell).innerHTML = anns.filter(a => a.page === n).map(a => a.rects.map(r => {
      const b = vpRect(vp, r);
      return `<div class="hl ${a.note ? 'has-note' : ''}" data-ann="${a.id}" style="left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;background:${COLORS[a.color] || COLORS.yellow}"></div>`;
    }).join('')).join('');
  }

  /* ------------------------------------------------------------ selection -> highlight */
  function selectionRects() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!$('#r-pages').contains(range.commonAncestorContainer)) return null;
    const shells = $$('.r-page');
    const byPage = new Map();
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const shell = shells.find(s => { const b = s.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
      if (!shell) continue;
      const b = shell.getBoundingClientRect(); const n = +shell.dataset.page; const vp = pages[n]?.vp;
      if (!vp || (cr.width > b.width * 0.9 && cr.height > 40)) continue;
      const [ax, ay] = vp.convertToPdfPoint(cr.left - b.left, cr.top - b.top);
      const [bx, by] = vp.convertToPdfPoint(cr.right - b.left, cr.bottom - b.top);
      if (!byPage.has(n)) byPage.set(n, []);
      byPage.get(n).push([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
    }
    for (const [n, rects] of byPage) byPage.set(n, mergeRects(rects));
    return byPage.size ? {byPage, text: sel.toString().replace(/\s+/g, ' ').trim(), last: range.getBoundingClientRect()} : null;
  }
  function mergeRects(rects) {
    rects.sort((a, b) => b[3] - a[3] || a[0] - b[0]);
    const out = [];
    for (const r of rects) {
      const prev = out[out.length - 1];
      if (prev) {
        const overlap = Math.min(prev[3], r[3]) - Math.max(prev[1], r[1]);
        const hmin = Math.min(prev[3] - prev[1], r[3] - r[1]);
        if (overlap > hmin * 0.5 && r[0] - prev[2] < 4) {
          prev[0] = Math.min(prev[0], r[0]); prev[1] = Math.min(prev[1], r[1]);
          prev[2] = Math.max(prev[2], r[2]); prev[3] = Math.max(prev[3], r[3]); continue;
        }
      }
      out.push([...r]);
    }
    return out.map(r => r.map(v => Math.round(v * 100) / 100));
  }

  function popAt(rect, html) {
    const pop = $('#r-pop'); pop.innerHTML = html; pop.style.display = 'block';
    const x = Math.min(window.innerWidth - pop.offsetWidth - 10, Math.max(10, rect.left + rect.width / 2 - pop.offsetWidth / 2));
    let y = rect.bottom + 8; if (y + pop.offsetHeight > window.innerHeight - 10) y = rect.top - pop.offsetHeight - 8;
    pop.style.left = `${x}px`; pop.style.top = `${Math.max(10, y)}px`;
    return pop;
  }
  function hidePop() { const p = $('#r-pop'); if (p) p.style.display = 'none'; }

  function selectionPopup() {
    const s = selectionRects();
    if (!s) return false;
    const pop = popAt(s.last, `<div class="r-pop-row">${Object.entries(COLORS).map(([k, v]) => `<button class="r-color ${k === color ? 'on' : ''}" data-new="${k}" style="background:${v}" title="Highlight (${k})"></button>`).join('')}
      <button class="btn small" data-newnote>🖍 + note</button><button class="btn small" data-copysel title="Copy text">⧉</button></div>`);
    pop.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.copysel !== undefined) { navigator.clipboard?.writeText(s.text); hidePop(); return; }
      const c = b.dataset.new || color;
      if (b.dataset.new) setColor(c);
      const created = await create(s, c);
      window.getSelection().removeAllRanges(); hidePop();
      if (b.dataset.newnote !== undefined && created) editPopup(created);
    };
    return true;
  }
  async function create(s, c) {
    let first = null;
    for (const [page, rects] of s.byPage) {
      try {
        const d = await api(`/api/papers/${paper.id}/annotations`, {method: 'POST', body: {page, rects, text: s.text, color: c}});
        anns.push(d.annotation); drawHighlights(page); first = first || d.annotation;
      } catch (err) { toast(err.message, 'error'); }
    }
    list();
    return first;
  }
  function editPopup(a) {
    const el = $(`.hl[data-ann="${a.id}"]`);
    const rect = el ? el.getBoundingClientRect() : {left: window.innerWidth / 2, top: 200, width: 0, bottom: 220};
    const pop = popAt(rect, `<div class="r-pop-row">${Object.entries(COLORS).map(([k, v]) => `<button class="r-color ${k === a.color ? 'on' : ''}" data-recolor="${k}" style="background:${v}"></button>`).join('')}
      <span class="grow"></span><button class="btn small" data-copyann title="Copy text">⧉</button><button class="btn small danger" data-del title="Delete highlight">🗑</button></div>
      <div class="r-quote">“${esc(truncate(a.text, 240))}”</div>
      <textarea class="input" id="r-note" rows="3" placeholder="Add a note…">${esc(a.note)}</textarea>
      <div class="r-pop-row" style="justify-content:flex-end"><button class="btn small primary" data-savenote>Save note</button></div>`);
    setTimeout(() => $('#r-note')?.focus(), 30);
    pop.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.recolor) { await update(a, {color: b.dataset.recolor}); editPopup(anns.find(x => x.id === a.id)); }
      if (b.dataset.copyann !== undefined) { navigator.clipboard?.writeText(a.text); toast('Copied.'); }
      if (b.dataset.del !== undefined) { await remove(a); hidePop(); }
      if (b.dataset.savenote !== undefined) { await update(a, {note: $('#r-note').value}); hidePop(); }
    };
  }
  async function update(a, changes) {
    try {
      const d = await api(`/api/annotations/${a.id}`, {method: 'PUT', body: changes});
      Object.assign(a, d.annotation); drawHighlights(a.page); list();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function remove(a) {
    try {
      await api(`/api/annotations/${a.id}`, {method: 'DELETE'});
      anns = anns.filter(x => x.id !== a.id); drawHighlights(a.page); list();
    } catch (err) { toast(err.message, 'error'); }
  }
  function setColor(c) {
    color = c;
    try { localStorage.setItem('papershelf-hl-color', c); } catch (e) { /* ignore */ }
    $$('.r-bar .r-color').forEach(b => b.classList.toggle('on', b.dataset.color === c));
  }

  /* ------------------------------------------------------------ sidebar */
  function sorted() {
    return [...anns].sort((a, b) => a.page - b.page || (b.rects[0]?.[3] || 0) - (a.rects[0]?.[3] || 0));
  }
  function list() {
    $('#r-count').textContent = anns.length ? `(${anns.length})` : '';
    $('#r-list').innerHTML = anns.length ? sorted().map(a => `
      <div class="r-item" data-goto="${a.id}">
        <div class="r-item-head"><span class="dot" style="background:${COLORS[a.color] || COLORS.yellow}"></span>p. ${a.page}</div>
        <div class="r-item-text">${esc(a.text || '(highlight)')}</div>
        ${a.note ? `<div class="r-item-note">${esc(a.note)}</div>` : ''}
      </div>`).join('') : '<div class="muted small" style="padding:10px 2px">No highlights yet.</div>';
  }
  function asText() {
    return `${paper.title}\n\n` + sorted().map(a => `p. ${a.page}: “${a.text}”${a.note ? `\n   Note: ${a.note}` : ''}`).join('\n\n');
  }
  async function goTo(a) {
    const shell = $(`.r-page[data-page="${a.page}"]`); if (!shell) return;
    const box = $('#r-pages');
    await renderPage(a.page);
    const vp = pages[a.page]?.vp;
    const top = vp && a.rects[0] ? vpRect(vp, a.rects[0]).top : 0;
    box.scrollTo({top: shell.offsetTop + top - 120, behavior: 'smooth'});
    setTimeout(() => { $$(`.hl[data-ann="${a.id}"]`).forEach(h => { h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 1200); }); }, 350);
  }

  function pageInfo() {
    const box = $('#r-pages'); if (!box || !doc) return;
    const mid = box.scrollTop + box.clientHeight / 3;
    let cur = 1;
    for (const s of $$('.r-page', box)) { if (s.offsetTop <= mid) cur = +s.dataset.page; else break; }
    $('#r-pageinfo').textContent = `Page ${cur} / ${doc.numPages}`;
  }

  function bind() {
    $('#r-close').onclick = close;
    $('#r-zoom-in').onclick = () => zoom(1.15);
    $('#r-zoom-out').onclick = () => zoom(1 / 1.15);
    $('#r-fit').onclick = () => fitWidth(true);
    $('.r-bar .r-colors').onclick = e => { const b = e.target.closest('[data-color]'); if (b) setColor(b.dataset.color); };
    $('#r-pages').addEventListener('scroll', () => { hidePop(); pageInfo(); }, {passive: true});
    $('#r-pages').addEventListener('mouseup', e => {
      setTimeout(() => {
        if (selectionPopup()) return;
        const hl = hitHighlight(e.clientX, e.clientY);
        if (hl) editPopup(hl); else hidePop();
      }, 10);
    });
    $('#r-list').onclick = e => { const it = e.target.closest('[data-goto]'); if (it) { const a = anns.find(x => x.id === +it.dataset.goto); if (a) { goTo(a); setTimeout(() => editPopup(a), 700); } } };
    $('#r-copy').onclick = async () => { await navigator.clipboard?.writeText(asText()); toast('Highlights copied.', 'ok'); };
    $('#r-tonotes').onclick = () => highlightsToNotes(paper.id);
    $('#r-embed').onclick = async () => {
      if (!anns.length) { toast('No highlights to save yet.'); return; }
      const ok = await confirmBox('Save highlights into the PDF file?',
        'Your highlights and notes will be written into the PDF itself, so you see them in Preview, Acrobat or Zotero too. You can repeat this after adding more – it won\'t duplicate them.', {ok: 'Save into PDF'});
      if (!ok) return;
      try { const d = await api(`/api/papers/${paper.id}/annotations/embed`, {method: 'POST'}); toast(`${d.count} highlight${d.count === 1 ? '' : 's'} saved into the PDF file.`, 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    };
  }
  function hitHighlight(x, y) {
    for (const el of $$('.hl')) {
      const b = el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return anns.find(a => a.id === +el.dataset.ann);
    }
    return null;
  }

  return {open, close, isOpen: () => isOpen};
})();
