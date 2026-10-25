'use strict';
/* Researchers tab: profiles from ORCID + OpenAlex (+ Wikidata photo, Google Scholar import).
   Two views: Overview (profile, summary, charts, career) and Publications (one clean table). */
const People = (() => {
  const S = {
    list: [], person: null, view: 'search', results: null, searching: false, query: '', loadingProfile: false,
    ptab: 'overview', f: null, selected: new Set(), jm: null, jmLoading: null, rolesChecking: false,
  };
  try { S.ptab = localStorage.getItem('papershelf-ptab') || 'overview'; } catch (e) { /* ignore */ }
  const THIS_YEAR = new Date().getFullYear();
  const newFilters = () => ({cats: null, q: '', from: '', to: '', role: 'all', sort: 'year', thisYear: false,
    byYear: true, showExcluded: false, hidePubPreprints: false});
  S.f = newFilters();
  const CAT_CLASS = c => `cat-badge cat-${c}`;
  const fmt = n => (n ?? 0).toLocaleString();
  const ROLE_LABEL = {first: 'First', 'co-first': 'Co-first', last: 'Last', 'co-last': 'Co-last', sole: 'Sole', middle: 'Co-author', '': '–'};
  const KEY_ROLES = ['first', 'co-first', 'last', 'co-last', 'sole'];

  function initials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
  function avatar(p, size) {
    const name = p.name || p.profile?.name || '';
    const url = p.photo?.data || p.profile?.photo?.data || p.photo?.url || p.profile?.photo?.url;
    const fallback = `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px">${esc(initials(name))}</span>`;
    return url ? `<img class="avatar" src="${esc(url)}" alt="" style="width:${size}px;height:${size}px" onerror="this.outerHTML=${esc(JSON.stringify(fallback))}">` : fallback;
  }
  const shortCat = id => ({article: 'Article', preprint: 'Preprint', conference: 'Conf. paper', abstract: 'Abstract/poster',
    book: 'Book/chapter', thesis: 'Thesis', data: 'Data/software', other: 'Other'})[id] || id;

  /* ------------------------------------------------------------ data */
  async function loadList() {
    try { S.list = (await api('/api/people')).people; } catch (e) { S.list = []; }
    side();
  }
  async function openPerson(id) {
    S.loadingProfile = true; S.view = 'profile'; draw();
    try { setPerson((await api(`/api/people/${id}`)).person); }
    catch (err) { toast(err.message, 'error'); }
    S.loadingProfile = false; draw(); side();
  }
  function setPerson(p) {
    S.person = p; S.selected.clear(); S.jm = null; S.f = newFilters();
    setTimeout(loadJournalMetrics, 0);
    if (!p.profile.roles_checked) setTimeout(checkRoles, 50);
  }
  async function add(c) {
    S.loadingProfile = true; draw();
    try {
      const d = await api('/api/people', {method: 'POST', body: {orcid: c.orcid, openalex_id: c.openalex_id}});
      setPerson(d.person); S.view = 'profile'; await loadList();
    } catch (err) { toast(err.message, 'error', 9000); }
    S.loadingProfile = false; draw();
  }
  async function search(q) {
    S.query = q; S.searching = true; S.results = null; draw();
    try {
      const r = (await api('/api/people/search', {method: 'POST', body: {query: q}})).results;
      if (r.length === 1 && r[0].exact) { S.searching = false; await add(r[0]); return; }
      S.results = r;
    } catch (err) { toast(err.message, 'error', 9000); S.results = []; }
    S.searching = false; draw();
  }
  async function save(changes) {
    try { const d = await api(`/api/people/${S.person.id}`, {method: 'PUT', body: changes}); S.person = d.person; }
    catch (err) { toast(err.message, 'error'); }
  }
  async function checkRoles(manual = false) {
    const P = S.person; if (!P || S.rolesChecking) return;
    S.rolesChecking = true; if (manual) draw();
    try {
      const d = await api(`/api/people/${P.id}/roles`, {method: 'POST'});
      if (S.person?.id === P.id) { S.person = d.person; draw(); }
      if (manual) toast('Authorship roles checked (co-first / co-last from PubMed where available).', 'ok');
    } catch (err) { if (manual) toast(err.message, 'error'); }
    S.rolesChecking = false;
  }

  /* ------------------------------------------------------------ works */
  const cat = w => S.person.overrides[w.key] || w.category;
  const roleOf = w => w.role ?? w.position ?? '';
  const isFirst = r => r === 'first' || r === 'sole';
  function familyNames() {
    const p = S.person.profile;
    const names = [p.family, p.name, ...(p.other_names || [])].filter(Boolean);
    return [...new Set(names.map(n => n.trim().split(/\s+/).pop().toLowerCase()))];
  }
  function visibleWorks() {
    const ex = new Set(S.person.excluded);
    return S.person.profile.works.filter(w => !ex.has(w.key));
  }
  function filtered({ignoreCats = false} = {}) {
    const f = S.f, ex = new Set(S.person.excluded);
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = S.person.profile.works.filter(w => f.showExcluded || !ex.has(w.key));
    if (!ignoreCats && f.cats) list = list.filter(w => f.cats.has(cat(w)));
    if (f.thisYear) list = list.filter(w => w.year === THIS_YEAR);
    if (f.from) list = list.filter(w => (w.year || 0) >= +f.from);
    if (f.to) list = list.filter(w => (w.year || 9999) <= +f.to);
    const R = roleOf;
    if (f.role === 'first') list = list.filter(w => isFirst(R(w)));
    if (f.role === 'co-first') list = list.filter(w => R(w) === 'co-first');
    if (f.role === 'firstany') list = list.filter(w => isFirst(R(w)) || R(w) === 'co-first');
    if (f.role === 'last') list = list.filter(w => R(w) === 'last' || R(w) === 'sole');
    if (f.role === 'lastany') list = list.filter(w => ['last', 'co-last', 'sole'].includes(R(w)));
    if (f.role === 'key') list = list.filter(w => KEY_ROLES.includes(R(w)));
    if (f.hidePubPreprints) list = list.filter(w => !(cat(w) === 'preprint' && w.published_as));
    if (terms.length) list = list.filter(w => { const h = `${w.title} ${w.venue} ${(w.authors || []).join(' ')} ${w.doi}`.toLowerCase(); return terms.every(t => h.includes(t)); });
    const sorters = {
      year: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title),
      oldest: (a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title),
      cites: (a, b) => Math.max(b.cited_by || 0, b.scholar_cites || 0) - Math.max(a.cited_by || 0, a.scholar_cites || 0),
      if: (a, b) => (ifVals(b)[0]?.value || 0) - (ifVals(a)[0]?.value || 0),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...list].sort(sorters[f.sort] || sorters.year);
  }
  function authorsHtml(w) {
    const fam = familyNames();
    const a = w.authors || [];
    if (!a.length) return '';
    const shown = a.length > 12 ? [...a.slice(0, 10), '…', a[a.length - 1]] : a;
    const key = KEY_ROLES.includes(roleOf(w));
    return shown.map(n => fam.some(f => f && n.toLowerCase().includes(f)) ? `<b class="${key ? 'me-key' : 'me'}">${esc(n)}</b>` : esc(n)).join(', ');
  }

  /* ------------------------------------------------------------ impact factor */
  function ifVals(w) {
    const m = S.jm?.metrics?.[w.key] || {};
    const pick = (off, est) => off?.value != null ? {value: +off.value, year: off.year, official: true}
      : est?.cites2y != null ? {value: +est.cites2y, year: est.year, official: false, q: est.quartile} : null;
    const pub = pick(m.jif_pub, m.at_pub), now = pick(m.jif_current, m.current);
    if (pub && m.at_pub) pub.q = m.at_pub.quartile;
    if (now && m.current) now.q = m.current.quartile;
    return [pub, now];
  }
  function ifCell(v, w, label) {
    if (!v) return `<button class="if-cell empty" data-jm="${esc(w.key)}" title="No journal metrics – click for details">–</button>`;
    return `<button class="if-cell" data-jm="${esc(w.key)}" title="${label} ${v.year}: ${v.official ? 'official impact factor (entered by you)' : 'SCImago citations per document, 2 years (impact-factor formula, Scopus data)'}${v.q ? ' · ' + v.q : ''}">${v.value.toFixed(1)}${v.official ? '' : '<sup>*</sup>'}${v.q ? ` <span class="q q-${v.q}">${v.q}</span>` : ''}</button>`;
  }

  /* ------------------------------------------------------------ charts (SVG, no external libraries) */
  const CAT_COLORS = {article: '#2c64d6', preprint: '#d08a1c', conference: '#2a9d8f', abstract: '#9b5d8c',
    book: '#59a14f', thesis: '#8cb04a', data: '#8d99ae', other: '#b5b5b5'};
  function stackedBars(labels, series, {height = 150, title = ''} = {}) {
    const n = labels.length; if (!n) return '<div class="muted small">No data</div>';
    const W = Math.max(520, n * 22), H = height, pad = 22;
    const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
    const max = Math.max(1, ...totals);
    const bw = (W - 30) / n;
    let out = `<svg viewBox="0 0 ${W} ${H + pad}" class="chart" role="img" aria-label="${esc(title)}">`;
    out += `<text x="0" y="10" class="ax">${fmt(max)}</text><line x1="28" x2="${W}" y1="4" y2="4" class="grid"/>`;
    labels.forEach((lab, i) => {
      let y = H;
      for (const s of series) {
        const v = s.values[i] || 0; if (!v) continue;
        const h = (H - 6) * v / max; y -= h;
        out += `<rect x="${30 + i * bw + 1}" y="${y}" width="${Math.max(2, bw - 3)}" height="${h}" fill="${s.color}" rx="1.5"><title>${esc(lab)} – ${esc(s.name)}: ${fmt(v)}</title></rect>`;
      }
      if (n <= 14 || i % Math.ceil(n / 12) === 0 || i === n - 1) out += `<text x="${30 + i * bw + bw / 2}" y="${H + 14}" class="ax" text-anchor="middle">${esc(String(lab).slice(-2) === String(lab) ? lab : "'" + String(lab).slice(-2))}</text>`;
    });
    return out + '</svg>';
  }
  function groupedBars(labels, series, opts) {  // side-by-side series
    const n = labels.length; if (!n) return '<div class="muted small">No data</div>';
    const H = opts?.height || 150, W = Math.max(520, n * 26), pad = 22;
    const max = Math.max(1, ...series.flatMap(s => s.values.map(v => v || 0)));
    const bw = (W - 30) / n, k = series.length;
    let out = `<svg viewBox="0 0 ${W} ${H + pad}" class="chart"><text x="0" y="10" class="ax">${fmt(max)}</text><line x1="28" x2="${W}" y1="4" y2="4" class="grid"/>`;
    labels.forEach((lab, i) => {
      series.forEach((s, j) => {
        const v = s.values[i] || 0; const h = (H - 6) * v / max;
        out += `<rect x="${30 + i * bw + 1 + j * (bw - 3) / k}" y="${H - h}" width="${Math.max(1.5, (bw - 3) / k - 1)}" height="${h}" fill="${s.color}" rx="1.5"><title>${esc(lab)} – ${esc(s.name)}: ${fmt(v)}</title></rect>`;
      });
      if (n <= 14 || i % Math.ceil(n / 12) === 0 || i === n - 1) out += `<text x="${30 + i * bw + bw / 2}" y="${H + 14}" class="ax" text-anchor="middle">'${String(lab).slice(-2)}</text>`;
    });
    return out + '</svg>';
  }
  function donut(parts) {
    const total = parts.reduce((s, p) => s + p.value, 0); if (!total) return '<div class="muted small">No data</div>';
    let a = -Math.PI / 2, out = '<svg viewBox="0 0 120 120" class="donut">';
    for (const p of parts) {
      const da = 2 * Math.PI * p.value / total;
      if (p.value === total) { out += `<circle cx="60" cy="60" r="44" fill="none" stroke="${p.color}" stroke-width="22"/>`; break; }
      const x1 = 60 + 44 * Math.cos(a), y1 = 60 + 44 * Math.sin(a), x2 = 60 + 44 * Math.cos(a + da), y2 = 60 + 44 * Math.sin(a + da);
      out += `<path d="M${x1} ${y1} A44 44 0 ${da > Math.PI ? 1 : 0} 1 ${x2} ${y2}" fill="none" stroke="${p.color}" stroke-width="22"><title>${esc(p.label)}: ${p.value}</title></path>`;
      a += da;
    }
    out += `<text x="60" y="58" text-anchor="middle" class="donut-n">${total}</text><text x="60" y="74" text-anchor="middle" class="ax">items</text></svg>`;
    return `<div class="donut-wrap">${out}<div class="legend">${parts.map(p => `<div><span class="dot" style="background:${p.color}"></span>${esc(p.label)} <b>${p.value}</b></div>`).join('')}</div></div>`;
  }
  function hbars(items, color = 'var(--accent)') {
    const max = Math.max(1, ...items.map(i => i.value));
    return items.length ? `<div class="hbars">${items.map(i => `<div class="hb"><span class="hb-l" title="${esc(i.label)}">${esc(i.label)}</span><span class="hb-bar"><i style="width:${100 * i.value / max}%;background:${i.color || color}"></i></span><b>${i.value}</b></div>`).join('')}</div>` : '<div class="muted small">No data</div>';
  }
  function rolesChart(works) {
    const peer = works.filter(w => ['article', 'conference'].includes(cat(w)));
    const parts = [['first', 'First / sole', '#2c64d6', r => isFirst(r)], ['co-first', 'Co-first', '#6d9bff', r => r === 'co-first'],
      ['middle', 'Co-author', '#8d99ae', r => r === 'middle'], ['co-last', 'Co-last', '#5fbf8f', r => r === 'co-last'],
      ['last', 'Last', '#2a9d8f', r => r === 'last'], ['', 'Unknown', '#d0d0d0', r => !r]]
      .map(([, l, c, fn]) => ({label: l, value: peer.filter(w => fn(roleOf(w))).length, color: c})).filter(x => x.value);
    return hbars(parts);
  }
  function chartsSection(works) {
    const p = S.person.profile;
    const cards = [];
    const oa = p.counts_by_year || [], gs = p.scholar?.counts_by_year || [];
    const ys = [...new Set([...oa.map(c => c.year), ...gs.map(c => c.year)])].sort().slice(-14);
    if (ys.length) {
      const series = [];
      if (oa.length) series.push({name: 'OpenAlex', color: '#2c64d6', values: ys.map(y => oa.find(c => c.year === y)?.citations || 0)});
      if (gs.length) series.push({name: 'Google Scholar', color: '#e8710a', values: ys.map(y => gs.find(c => c.year === y)?.citations || 0)});
      cards.push(`<div class="p-card"><h3>Citations per year</h3>${groupedBars(ys, series)}
        <div class="legend inline">${series.map(s => `<span><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join('')}</div></div>`);
    }
    const years = works.map(w => w.year).filter(Boolean);
    if (years.length) {
      const y0 = Math.max(Math.min(...years), Math.max(...years) - 24), y1 = Math.max(...years);
      const labels = []; for (let y = y0; y <= y1; y++) labels.push(y);
      const cats = S.person.categories.map(c => c.id).filter(c => works.some(w => cat(w) === c));
      const series = cats.map(c => ({name: shortCat(c), color: CAT_COLORS[c], values: labels.map(y => works.filter(w => w.year === y && cat(w) === c).length)}));
      cards.push(`<div class="p-card"><h3>Publications per year</h3>${stackedBars(labels, series)}
        <div class="legend inline">${series.map(s => `<span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div></div>`);
    }
    const typeParts = S.person.categories.map(c => ({label: shortCat(c.id), value: works.filter(w => cat(w) === c.id).length, color: CAT_COLORS[c.id]})).filter(x => x.value);
    cards.push(`<div class="p-card"><h3>Types of output</h3>${donut(typeParts)}</div>`);
    cards.push(`<div class="p-card"><h3>Authorship <span class="muted tiny">(articles &amp; conference papers)</span></h3>${rolesChart(works)}</div>`);
    const venues = {};
    for (const w of works.filter(w => ['article', 'conference'].includes(cat(w)))) if (w.venue) venues[w.venue] = (venues[w.venue] || 0) + 1;
    const top = Object.entries(venues).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, v]) => ({label: l, value: v}));
    cards.push(`<div class="p-card"><h3>Main journals &amp; venues</h3>${hbars(top)}</div>`);
    if (S.jm && S.jm.loaded.length) {
      const q = {Q1: 0, Q2: 0, Q3: 0, Q4: 0, 'n/a': 0};
      for (const w of works.filter(w => cat(w) === 'article')) { const m = S.jm.metrics[w.key]; q[m?.at_pub?.quartile || 'n/a']++; }
      const qc = {Q1: '#2e9d5b', Q2: '#8cb04a', Q3: '#e3a008', Q4: '#e15759', 'n/a': '#d0d0d0'};
      cards.push(`<div class="p-card"><h3>Journal quartile when published <span class="muted tiny">(articles, SCImago)</span></h3>${hbars(Object.entries(q).filter(([, v]) => v).map(([k, v]) => ({label: k, value: v, color: qc[k]})))}</div>`);
    }
    return `<div class="p-cols charts">${cards.join('')}</div>`;
  }

  /* ------------------------------------------------------------ summary */
  function counts(list) {
    const r = list.map(roleOf);
    return {total: list.length, articles: list.filter(w => cat(w) === 'article').length,
      first: r.filter(isFirst).length, cofirst: r.filter(x => x === 'co-first').length,
      last: r.filter(x => x === 'last').length, colast: r.filter(x => x === 'co-last').length};
  }
  function summaryCard() {
    const all = visibleWorks(), c = counts(all), y = counts(all.filter(w => w.year === THIS_YEAR));
    const art = counts(all.filter(w => cat(w) === 'article'));
    const tile = (n, label, sub = '') => `<div class="stile"><b>${n}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const checked = S.person.profile.roles_checked;
    return `<div class="p-card summary-card">
      <div class="sum-head"><h3>Summary</h3><span class="muted tiny">${checked ? 'Co-first / co-last from PubMed equal-contribution statements.' : ''}
        <button class="linklike" id="p-roles">${S.rolesChecking ? 'checking…' : checked ? 'check again' : 'Check co-first / co-last (PubMed)'}</button></span></div>
      <div class="stiles">
        ${tile(c.total, 'publications', `${c.articles} journal articles`)}
        ${tile(c.first, 'first or sole author', `${art.first} in journals`)}
        ${tile(c.cofirst, 'co-first author', `${art.cofirst} in journals`)}
        ${tile(c.last, 'last author', `${art.last} in journals`)}
        ${tile(c.colast, 'co-last author', `${art.colast} in journals`)}
        <div class="stile this-year"><b>${y.total}</b><span>in ${THIS_YEAR}</span><em>${y.first + y.cofirst} first/co-first · ${y.last + y.colast} last/co-last</em>
          <button class="linklike" id="p-goyear">show them</button></div>
      </div></div>`;
  }

  /* ------------------------------------------------------------ Google Scholar button */
  // Runs on the Scholar profile page the user is looking at and passes the visible data to PaperShelf.
  // (No '#' or '%' characters, so it works as a bookmark in every browser.)
  const scholarBookmarklet = () => "javascript:(function(){var D=document,q=function(s,r){var e=(r||D).querySelector(s);return e?e.textContent.trim():''},A=function(s,f,r){return [].map.call((r||D).querySelectorAll(s),f)},T=function(c){return c.textContent.trim()};" +
    "if(!/scholar\\.google\\./.test(location.host)||!D.getElementById('gsc_prf_in')){alert('Open a Google Scholar profile page first (scholar.google.com/citations?user=...)');return}" +
    "var d={url:location.href.split(String.fromCharCode(35))[0],name:T(D.getElementById('gsc_prf_in')),affiliation:q('.gsc_prf_il'),interests:A('[id=gsc_prf_int] a',T),photo:(D.getElementById('gsc_prf_pup-img')||{}).src||''," +
    "head:A('[id=gsc_rsb_st] thead th',T),stats:A('[id=gsc_rsb_st] tbody tr',function(r){return A('td',T,r)}),years:A('.gsc_g_t',T)," +
    "bars:A('.gsc_g_a',function(e){var m=/z-index:\\s*(\\d+)/.exec(e.getAttribute('style')||'');return{z:m?m[1]:'',value:q('.gsc_g_al',e)}})," +
    "pubs:A('tr.gsc_a_tr',function(r){var g=r.querySelectorAll('.gs_gray'),a=r.querySelector('.gsc_a_at');return{title:a?T(a):'',link:a?a.href:'',authors:g[0]?T(g[0]):'',venue:g[1]?T(g[1]):'',cites:q('.gsc_a_ac',r),year:q('.gsc_a_y span',r)}})};" +
    `window.open('${location.origin}/scholar-import'+String.fromCharCode(35)+encodeURIComponent(JSON.stringify(d)),'_blank')})();`;

  function scholarHelp() {
    return `<details class="help"><summary>Add Google Scholar data (citations, h-index, photo, publication list)</summary>
      <p>Google Scholar can't be queried automatically, but you can bring in the <b>public</b> profile page you are looking at – like copying it, in one click:</p>
      <ol><li>Drag this button to your bookmarks bar: <a class="bookmarklet" href="${esc(scholarBookmarklet())}" onclick="return false">🎓 Import Scholar profile</a></li>
      <li>Open the researcher's profile on <a href="https://scholar.google.com/" target="_blank" rel="noopener">scholar.google.com</a>. To get all publications, click “Show more” at the bottom until the list is complete.</li>
      <li>Click the button: PaperShelf opens and asks which profile to add the data to.</li></ol>
      <p class="muted small">Only what the page shows publicly is read; no login, no private data. Nothing is sent anywhere – it stays on this computer.</p></details>`;
  }
  function scholarCard() {
    const g = S.person.profile.scholar; if (!g) return '';
    const m = g.metrics || {}, oa = S.person.profile.metrics || {};
    const row = (label, a, b, c) => `<tr><th>${label}</th><td>${a ?? '–'}</td><td>${b ?? '–'}</td><td>${c ?? '–'}</td></tr>`;
    return `<div class="p-card"><h3>Google Scholar vs OpenAlex</h3>
      <table class="cmp"><tr><th></th><th>Scholar (all)</th><th>Scholar (${esc(m.since_label || 'recent')})</th><th>OpenAlex</th></tr>
      ${row('Citations', fmt(m.citations?.all), fmt(m.citations?.since), oa.cited_by_count != null ? fmt(oa.cited_by_count) : null)}
      ${row('h-index', m.h_index?.all, m.h_index?.since, oa.h_index)}
      ${row('i10-index', m.i10_index?.all, m.i10_index?.since, oa.i10_index)}</table>
      <div class="src-note">Scholar: <a href="${esc(g.url)}" target="_blank" rel="noopener">public profile</a>, captured ${esc(new Date(g.captured_at).toLocaleDateString())} (${g.pubs_count} publications).
      Scholar usually counts more because it also includes non-peer-reviewed sources. To update, click the 🎓 button again on the Scholar page. <button class="linklike" id="p-rm-scholar">remove Scholar data</button></div></div>`;
  }
  /* ------------------------------------------------------------ journal metrics */
  async function loadJournalMetrics() {
    const P = S.person; if (!P) return;
    const items = P.profile.works.filter(w => w.venue || w.issns?.length).map(w => ({key: w.key, issns: w.issns || [], name: w.venue, year: w.year}));
    const sources = [...new Set(P.profile.works.map(w => w.source_id).filter(Boolean))];
    try {
      const d = await api('/api/journal-metrics', {method: 'POST', body: {items, openalex_sources: sources}});
      if (S.person === P) { S.jm = d; draw(); if (state.settings.sjr_auto === '1') loadRankings({auto: true}); }
    } catch (e) { /* offline: no metrics */ }
  }
  function jmModal(key) {
    const w = S.person.profile.works.find(x => x.key === key); const m = S.jm?.metrics?.[key] || {};
    const oa = w.source_id && S.jm?.openalex?.[w.source_id];
    const pubY = w.year, curY = m.current?.year || S.jm?.latest;
    const v = x => x == null || x === '' ? '–' : x;
    const md = modal(`<h3>${esc(m.journal || w.venue || 'Journal')}</h3>
      <table class="cmp"><tr><th></th><th>When published (${pubY || '?'})</th><th>Latest (${curY || '?'})</th></tr>
        <tr><th>Quartile (SJR)</th><td>${v(m.at_pub?.quartile)}${m.at_pub && m.at_pub.year !== pubY ? ` <span class="muted tiny">(${m.at_pub.year})</span>` : ''}</td><td>${v(m.current?.quartile)}</td></tr>
        <tr><th>SJR indicator</th><td>${v(m.at_pub?.sjr)}</td><td>${v(m.current?.sjr)}</td></tr>
        <tr><th>Cites per doc, 2 years <span class="muted tiny">(IF formula, Scopus data)</span></th><td>${v(m.at_pub?.cites2y)}</td><td>${v(m.current?.cites2y)}</td></tr>
        <tr><th>2-year mean citedness <span class="muted tiny">(OpenAlex)</span></th><td>–</td><td>${v(oa?.mean2y)}</td></tr>
        <tr><th>Impact factor (JCR) <span class="muted tiny">entered by you</span></th>
          <td><input class="input" id="jif-pub" style="width:90px" value="${esc(m.jif_pub?.value ?? '')}" placeholder="${pubY || ''}"></td>
          <td><input class="input" id="jif-cur" style="width:90px" value="${esc(m.jif_current?.year === curY ? m.jif_current.value : '')}" placeholder="${curY || ''}"></td></tr>
      </table>
      ${S.jm?.loaded?.length ? '' : '<p class="warn-box">Journal metrics are not loaded yet – use “Load journal metrics” in the Publications view.</p>'}
      <p class="muted small"><a href="#" data-help="journal-metrics">More about these metrics</a>. The official Journal Impact Factor belongs to Clarivate (Journal Citation Reports) and is only available with a subscription, so PaperShelf can't download it. “Cites per doc (2 years)” from SCImago uses the same formula on Scopus data and is usually close. If your university gives you JCR access, you can type the official value here – it's stored only on this computer.
      Sources: <a href="https://www.scimagojr.com" target="_blank" rel="noopener">SCImago Journal &amp; Country Rank</a>, <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a>.</p>
      <div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="jif-save">Save impact factors</button></div>`, {wide: true});
    $('#jif-save', md.el).onclick = async () => {
      const name = m.journal || w.venue;
      try {
        if (pubY) await api('/api/journal-jif', {method: 'PUT', body: {name, year: pubY, value: $('#jif-pub', md.el).value.trim()}});
        if (curY && curY !== pubY) await api('/api/journal-jif', {method: 'PUT', body: {name, year: curY, value: $('#jif-cur', md.el).value.trim()}});
        md.close(); toast('Saved on this computer.', 'ok'); loadJournalMetrics();
      } catch (err) { toast(err.message, 'error'); }
    };
  }
  async function neededYears() {
    const st = await api('/api/sjr/status');
    const pubYears = S.person.profile.works.filter(w => ['article', 'conference', 'abstract'].includes(cat(w))).map(w => w.year)
      .filter(y => y && y >= st.first && y <= st.latest);
    return [...new Set([...pubYears, st.latest])].filter(y => !st.loaded.includes(y)).sort((a, b) => b - a);
  }
  async function loadRankings({auto = false} = {}) {
    if (S.jmLoading) return;
    const want = await neededYears();
    if (!want.length) { if (!auto) toast('Journal metrics are already loaded for all these years.'); return; }
    if (!auto) {
      const ok = await confirmBox('Load journal impact metrics?',
        `PaperShelf will download the SCImago Journal Rank tables for ${want.length} year${want.length > 1 ? 's' : ''} (${want.slice(0, 6).join(', ')}${want.length > 6 ? '…' : ''}), about 3–6 MB each, once, and keep them on this computer. Missing years for other researchers will then be loaded automatically. Only the year is sent to scimagojr.com.`,
        {ok: 'Download'});
      if (!ok) return;
      try { const d = await api('/api/settings', {method: 'PUT', body: {sjr_auto: true}}); state.settings = d.settings; } catch (e) { /* ignore */ }
    }
    S.jmLoading = {done: 0, total: want.length}; draw();
    let failed = [];
    for (const y of want) {
      try { await api('/api/sjr/load', {method: 'POST', body: {year: y}}); }
      catch (err) { failed.push(`${y}: ${err.message}`); if (failed.length >= 2 && S.jmLoading.done === 0) break; }
      S.jmLoading.done++; draw();
    }
    S.jmLoading = null;
    if (failed.length) toast(`Some years could not be downloaded. ${failed[0]}`, 'error', 15000);
    loadJournalMetrics();
  }

  /* ------------------------------------------------------------ rendering */
  function side() {
    const el = $('#people-side'); if (!el) return;
    el.innerHTML = `<div class="side-head">Researchers <button id="p-new" title="Find a researcher">＋</button></div>
      ${S.list.length ? S.list.map(p => `<div class="person-item ${S.view === 'profile' && S.person?.id === p.id ? 'active' : ''}" data-pid="${p.id}">
          ${avatar(p, 34)}<div style="min-width:0"><div class="pi-name">${esc(p.name || p.orcid)}${p.is_me ? '<span class="me-badge">me</span>' : ''}</div>
          <div class="pi-sub">${esc(p.current?.[0]?.organization || `${p.works} works`)}</div></div></div>`).join('')
        : '<div class="empty-hint">Profiles you open are kept here.</div>'}
      <div class="empty-hint" style="margin-top:16px">Data from <a href="https://orcid.org" target="_blank" rel="noopener">ORCID</a> and <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a>. Needs internet to look up or refresh; saved profiles open offline.</div>`;
  }
  function searchView() {
    const r = S.results;
    return `<div class="p-search">
      <h1>Find a researcher <button class="help-q" data-help="researchers" title="Explain this">?</button></h1>
      <p class="muted">Type an <b>ORCID iD</b> (most precise) or a name. PaperShelf collects the official profile and publications from ORCID and OpenAlex, and cites its sources.
        Only public data is used, it's saved only on this computer, and only the name or iD you type is sent to those search services.</p>
      <form id="p-search-form"><input class="input" id="p-q" value="${esc(S.query)}" placeholder="e.g. 0000-0002-1825-0097, or Maria Rossi" autocomplete="off">
        <button class="btn primary" ${S.searching ? 'disabled' : ''}>${S.searching ? '<span class="spin"></span> Searching…' : 'Search'}</button></form>
      ${r ? (r.length ? `<p class="muted small">${r.length} match${r.length > 1 ? 'es' : ''}. Several people can share a name: check institution and topics, and prefer results that have an ORCID iD.</p>` +
        r.map((c, i) => `<div class="cand">
          <div class="avatar" style="width:40px;height:40px">${esc(initials(c.name))}</div>
          <div class="grow"><div><b>${esc(c.name || c.orcid || c.openalex_id)}</b> ${c.sources.map(s => `<span class="src-badge ${s.toLowerCase()}">${s}</span>`).join('')}</div>
            <div class="muted small">${esc((c.institutions || []).join(' · ') || 'institution unknown')}</div>
            <div class="muted small">${[c.works_count != null && `${fmt(c.works_count)} works`, c.cited_by_count != null && `${fmt(c.cited_by_count)} citations`, c.h_index != null && `h-index ${c.h_index}`, c.orcid && `ORCID ${c.orcid}`].filter(Boolean).map(esc).join(' · ')}</div>
            ${c.topics?.length ? `<div class="muted small">${esc(c.topics.join(', '))}</div>` : ''}</div>
          <button class="btn primary small" data-cand="${i}">Open profile</button></div>`).join('')
        : '<div class="empty"><div class="big">🔍</div><h2>No one found</h2><p>Try the ORCID iD, or a different spelling of the name.</p></div>') : ''}
      <div style="margin-top:22px">${scholarHelp()}</div>
    </div>`;
  }
  function timeline(items, empty) {
    if (!items.length) return `<div class="muted small">${empty}</div>`;
    return items.map(e => `<div class="tl-item"><div class="when">${esc(e.start || '?')} – ${e.end ? esc(e.end) : '<span class="now">now</span>'}</div>
      <div>${e.role ? `<b>${esc(e.role)}</b><br>` : ''}${esc([e.department, e.organization].filter(Boolean).join(', '))}${e.city ? ` <span class="muted">(${esc([e.city, e.country].filter(Boolean).join(', '))})</span>` : ''}</div></div>`).join('');
  }
  function heroHtml() {
    const P = S.person, p = P.profile;
    const orcidUrl = p.orcid ? `https://orcid.org/${p.orcid}` : '';
    const scholar = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(p.name)}`;
    return `<div class="hero compact">
        <div>${avatar(P, 84)}</div>
        <div style="flex:1;min-width:0">
          <h1>${esc(p.name)} ${P.is_me ? '<span class="me-badge">me</span>' : ''}</h1>
          ${(p.current || []).map(c => `<div class="cur">${c.role ? `<b>${esc(c.role)}</b> · ` : ''}${esc([c.department, c.organization].filter(Boolean).join(', '))}${c.since ? ` <span class="muted">(since ${esc(c.since)})</span>` : ''}</div>`).join('') || '<div class="muted">Current affiliation not available</div>'}
          <div class="links">
            ${orcidUrl ? `<a class="btn small" href="${orcidUrl}" target="_blank" rel="noopener"><span class="src-badge orcid">iD</span> ${esc(p.orcid)}</a>` : ''}
            ${p.openalex_id ? `<a class="btn small" href="https://openalex.org/authors/${esc(p.openalex_id)}" target="_blank" rel="noopener">OpenAlex</a>` : ''}
            <a class="btn small" href="${p.scholar?.url || scholar}" target="_blank" rel="noopener">Google Scholar ↗</a>
            ${(p.urls || []).map(u => `<a class="btn small" href="${esc(u.url)}" target="_blank" rel="noopener">🔗 ${esc(truncate(u.name || u.url, 26))}</a>`).join('')}
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn small" id="p-refresh" title="Download the profile again">↻ Refresh</button>
          <button class="btn small" id="p-me">${P.is_me ? 'Unmark “me”' : 'This is me'}</button>
          <button class="btn small danger" id="p-remove">Remove</button>
        </div>
      </div>
      <div class="seg ptabs"><button data-ptab="overview" class="${S.ptab === 'overview' ? 'on' : ''}">Overview</button><button data-ptab="pubs" class="${S.ptab === 'pubs' ? 'on' : ''}">Publications <span class="cnt">${visibleWorks().length}</span></button></div>`;
  }

  function overviewView() {
    const p = S.person.profile, m = p.metrics || {};
    const works = visibleWorks();
    return `
      ${p.warnings?.length ? `<div class="warn-box">${p.warnings.map(esc).join('<br>')}</div>` : ''}
      ${summaryCard()}
      ${m.works_count != null ? `<div class="metrics">
        <div class="metric"><b>${fmt(m.cited_by_count)}</b><span>citations</span></div>
        <div class="metric"><b>${m.h_index ?? '–'}</b><span>h-index</span></div>
        <div class="metric"><b>${m.i10_index ?? '–'}</b><span>i10-index</span></div>
        <div class="metric"><b>${fmt(m.works_count)}</b><span>works in OpenAlex</span></div>
        <div class="metric"><b>${m.mean_citedness_2yr ?? '–'}</b><span>2-year mean citedness</span></div>
      </div>
      <div class="src-note">Metrics: OpenAlex, retrieved ${esc(new Date(p.fetched_at).toLocaleDateString())}; they can differ from Google Scholar or Scopus.</div>` : ''}
      ${chartsSection(works)}
      ${p.bio || p.keywords?.length || p.topics?.length ? `<div class="p-card" style="margin-bottom:12px"><h3>About</h3>${p.bio ? `<div class="bio">${esc(truncate(p.bio, 900))}</div>` : ''}
        <div class="row-chips" style="margin-top:8px">${(p.keywords || []).map(k => `<span class="chip">${esc(k)}</span>`).join('')}${(p.topics || []).slice(0, 8).map(t => `<span class="chip" title="OpenAlex topic · ${t.count} works">${esc(t.name)}</span>`).join('')}</div></div>` : ''}
      <div class="p-cols">
        <div class="p-card"><h3>Positions</h3>${timeline(p.employments || [], p.oa_affiliations?.length ? '' : 'Not available on ORCID.')}
          ${!(p.employments || []).length && p.oa_affiliations?.length ? p.oa_affiliations.map(a => `<div class="tl-item"><div class="when">${a.years[0] || ''}${a.years.length > 1 ? '–' + a.years[a.years.length - 1] : ''}</div><div>${esc(a.organization)} <span class="muted">(${esc(a.country)})</span></div></div>`).join('') + '<div class="src-note">Source: OpenAlex</div>' : '<div class="src-note">Source: ORCID</div>'}</div>
        <div class="p-card"><h3>Education</h3>${timeline(p.educations || [], 'Not available on ORCID.')}<div class="src-note">Source: ORCID</div></div>
        ${scholarCard()}
        ${p.fundings?.length ? `<div class="p-card"><h3>Funding</h3>${p.fundings.map(f => `<div class="tl-item"><div class="when">${esc(f.start || '?')}${f.end ? '–' + esc(f.end) : ''}</div><div><b>${esc(f.title)}</b><br><span class="muted">${esc(f.funder)}</span></div></div>`).join('')}<div class="src-note">Source: ORCID</div></div>` : ''}
        ${p.distinctions?.length ? `<div class="p-card"><h3>Awards</h3>${timeline(p.distinctions, '')}<div class="src-note">Source: ORCID</div></div>` : ''}
      </div>
      ${p.scholar ? '' : scholarHelp()}
      <div class="src-note" style="margin-top:14px">Sources: ${p.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.what)})`).join(' · ')}.</div>`;
  }

  function rowHtml(w, num, inLib, ex, byKey) {
    const c = cat(w), r = roleOf(w);
    const link = w.doi ? `https://doi.org/${w.doi}` : w.url;
    const pub = w.published_as && byKey.get(w.published_as);
    const [ifPub, ifNow] = ifVals(w);
    const notes = [];
    if (w.cat_note && !S.person.overrides[w.key]) notes.push(esc(w.cat_note));
    if (pub) notes.push(`published as <a href="#" data-jump="${esc(pub.key)}">${esc(truncate(pub.venue || 'article', 34))} ${pub.year || ''}</a>`);
    if (S.person.profile.orcid && !w.sources.includes('ORCID')) notes.push('<span title="Found by OpenAlex/Scholar but not in the ORCID record – check it is really theirs">not in ORCID</span>');
    return `<div class="prow ${ex ? 'excluded' : ''} ${KEY_ROLES.includes(r) ? 'keyrole' : ''}" data-key="${esc(w.key)}">
      <span><input type="checkbox" class="psel" ${S.selected.has(w.key) ? 'checked' : ''}></span>
      <span class="num">${num}</span>
      <span class="yr">${w.year || ''}</span>
      <div class="pmain">
        <div class="t">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title)}</div>
        ${w.authors?.length ? `<div class="a">${authorsHtml(w)}</div>` : ''}
        <div class="v">${esc(w.venue || '')}${notes.length ? ` <span class="pnotes">· ${notes.join(' · ')}</span>` : ''}</div>
      </div>
      <span><select class="${CAT_CLASS(c)}" data-cat title="Type – change it if it is wrong">${S.person.categories.map(k => `<option value="${k.id}" ${k.id === c ? 'selected' : ''}>${esc(shortCat(k.id))}</option>`).join('')}</select></span>
      <span><span class="role r-${esc(r || 'none')}" title="${esc(w.role_source ? 'Source: ' + w.role_source : '')}">${ROLE_LABEL[r] ?? '–'}</span></span>
      <span class="ifc">${ifCell(ifPub, w, 'At publication')}</span>
      <span class="ifc">${ifCell(ifNow, w, 'Latest')}</span>
      <span class="cit" title="Citations: OpenAlex${w.scholar_cites != null ? ' · Google Scholar ' + fmt(w.scholar_cites) : ''}">${w.cited_by != null ? fmt(w.cited_by) : (w.scholar_cites != null ? fmt(w.scholar_cites) + '<sup>GS</sup>' : '')}</span>
      <span class="pact">${inLib ? '<span title="In your library" style="color:var(--ok)">✓</span>' : '<button class="iconbtn" data-addlib title="Add to my library">＋</button>'}<button class="iconbtn" data-exclude title="${ex ? 'Show again' : 'Not theirs / hide'}">${ex ? '↺' : '✕'}</button></span>
    </div>`;
  }

  function pubsView() {
    const P = S.person, p = P.profile;
    const works = p.works, byKey = new Map(works.map(w => [w.key, w]));
    const lib = new Set(P.in_library), ex = new Set(P.excluded);
    const base = filtered({ignoreCats: true});
    const cc = {}; for (const w of base) cc[cat(w)] = (cc[cat(w)] || 0) + 1;
    const list = filtered();
    const chrono = [...list].sort((a, b) => (a.year || 0) - (b.year || 0) || a.title.localeCompare(b.title));
    const nums = new Map(chrono.map((w, i) => [w.key, i + 1]));
    const allSel = list.length && list.every(w => S.selected.has(w.key));
    let rows = '';
    if (S.f.byYear && ['year', 'oldest'].includes(S.f.sort)) {
      let cur = undefined;
      for (const w of list) {
        if (w.year !== cur) {
          cur = w.year;
          const n = list.filter(x => x.year === cur).length;
          rows += `<div class="year-sep ${cur === THIS_YEAR ? 'now' : ''}">${cur || 'Year not known'} <span>${n} publication${n > 1 ? 's' : ''}${cur === THIS_YEAR ? ' · this year' : ''}</span></div>`;
        }
        rows += rowHtml(w, nums.get(w.key), lib.has(w.key), ex.has(w.key), byKey);
      }
    } else rows = list.map(w => rowHtml(w, nums.get(w.key), lib.has(w.key), ex.has(w.key), byKey)).join('');
    const merged = p.merge_log?.length || 0;
    const jmBanner = S.jmLoading ? `<div class="s-note">Downloading journal metrics… ${S.jmLoading.done}/${S.jmLoading.total} years</div>`
      : (S.jm && !S.jm.loaded.length) ? `<div class="s-note"><span>📊 To fill the <b>IF</b> columns, load the journal metrics once (SCImago, about 3–6 MB per year). <button class="help-q" data-help="journal-metrics">?</button></span><button class="btn small primary" id="p-rankings">Load journal metrics</button></div>` : '';
    return `
      <div class="cat-chips">${P.categories.filter(c => cc[c.id]).map(c => `<button class="cat-chip ${!S.f.cats || S.f.cats.has(c.id) ? 'on' : ''}" data-chip="${c.id}">${esc(shortCat(c.id))}<span>${cc[c.id]}</span></button>`).join('')}
        ${S.f.cats ? '<button class="btn small" id="p-allcats">All types</button>' : ''}
        <span class="grow"></span>
        <button class="btn small" id="p-addsel" ${S.selected.size ? '' : 'disabled'}>＋ Add ${S.selected.size || ''} to library</button>
        <button class="btn small primary" id="p-export">⤓ Export list</button></div>
      <div class="pub-filters">
        <input type="search" id="p-fq" placeholder="Search titles, journals, co-authors…" value="${esc(S.f.q)}" style="min-width:230px">
        <select id="p-role"><option value="all">Any role</option><option value="key">First, co-first, last or co-last</option><option value="firstany">First or co-first</option><option value="first">First / sole author</option><option value="co-first">Co-first author</option><option value="lastany">Last or co-last</option><option value="last">Last author</option></select>
        <span class="muted small">Years</span><input type="number" id="p-from" placeholder="from" value="${esc(S.f.from)}"><input type="number" id="p-to" placeholder="to" value="${esc(S.f.to)}">
        <select id="p-sort"><option value="year">Newest first</option><option value="oldest">Oldest first</option><option value="cites">Most cited</option><option value="if">Highest IF</option><option value="title">Title A–Z</option></select>
        <label><input type="checkbox" id="p-byyear" ${S.f.byYear ? 'checked' : ''}> separate years</label>
        <label class="${S.f.thisYear ? 'on-filter' : ''}"><input type="checkbox" id="p-thisyear" ${S.f.thisYear ? 'checked' : ''}> only ${THIS_YEAR}</label>
        <details class="more-f"><summary>More</summary>
          <label><input type="checkbox" id="p-hidepre" ${S.f.hidePubPreprints ? 'checked' : ''}> hide preprints already published</label>
          <label><input type="checkbox" id="p-showex" ${S.f.showExcluded ? 'checked' : ''}> show hidden items (${P.excluded.length})</label></details>
      </div>
      ${jmBanner}
      <div class="ptable">
        <div class="prow head"><span><input type="checkbox" id="p-selall" ${allSel ? 'checked' : ''} title="Select all shown"></span><span title="Chronological number (oldest = 1)">#</span><span>Year</span><span>Publication</span><span>Type</span><span>Role</span>
          <span title="Impact factor in the year of publication">IF pub.</span><span title="Latest impact factor">IF now</span><span>Cit.</span><span></span></div>
        ${rows || '<div class="empty">No publications match these filters.</div>'}
      </div>
      <div class="src-note" style="margin-top:10px">${list.length} shown${S.selected.size ? ` · ${S.selected.size} selected` : ''} ·
        ${merged ? `duplicate check: ${merged} duplicate record${merged > 1 ? 's' : ''} merged` : 'duplicate check: none found'} ·
        <b>IF</b>: <sup>*</sup> = SCImago 2-year citations per document (impact-factor formula, Scopus data); without * = official impact factor you entered (click a value). Roles: co-first/co-last from PubMed where available.</div>`;
  }

  function profileView() {
    return heroHtml() + (S.ptab === 'pubs' ? pubsView() : overviewView());
  }

  function draw() {
    const el = $('#people-main'); if (!el) return;
    if (S.loadingProfile) { el.innerHTML = `<div class="empty"><div class="spin big-spin"></div><p>Collecting the profile from ORCID, OpenAlex and PubMed… (a researcher with many papers can take ~30 seconds)</p></div>`; return; }
    if (S.view === 'search' || !S.person) { el.innerHTML = searchView(); setTimeout(() => $('#p-q')?.focus(), 30); return; }
    const scroll = el.scrollTop;
    const focus = document.activeElement?.id;
    el.innerHTML = profileView();
    if ($('#p-role')) { $('#p-role').value = S.f.role; $('#p-sort').value = S.f.sort; }
    el.scrollTop = scroll;
    if (focus === 'p-fq') { const f = $('#p-fq'); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length); }
  }

  /* ------------------------------------------------------------ actions */
  async function addToLibrary(keys) {
    const works = S.person.profile.works.filter(w => keys.includes(w.key));
    const t = toast(`Adding ${works.length} to your library…`, 'info', 0); let ok = 0;
    for (const [i, w] of works.entries()) {
      t.set(`Adding ${i + 1}/${works.length}…`);
      const body = w.doi ? {input: w.doi} : w.openalex_id ? {input: w.openalex_id}
        : {manual: {title: w.title, year: w.year, journal: w.venue, url: w.url, authors: (w.authors || []).map(a => { const p = a.split(' '); return {family: p.pop(), given: p.join(' ')}; })}};
      try { const d = await api('/api/papers', {method: 'POST', body}); upsertPaper(d.paper); S.person.in_library.push(w.key); ok++; }
      catch (err) { toast(`${truncate(w.title, 60)}: ${err.message}`, 'error', 7000); }
    }
    t.close(); toast(`Added ${ok} of ${works.length} to your library.`, ok ? 'ok' : 'error');
    S.selected.clear(); draw(); renderSidebar(); renderList();
  }

  function exportDialog() {
    const vis = filtered().map(w => w.key); const sel = [...S.selected];
    const shown = visibleWorks();
    const all = shown.map(w => w.key);
    const present = S.person.categories.filter(c => shown.some(w => cat(w) === c.id));
    const nThis = shown.filter(w => w.year === THIS_YEAR).length;
    const jmReady = S.jm?.loaded?.length;
    const m = modal(`<h3>Export publications – ${esc(S.person.name)} <button class="help-q" data-help="researchers">?</button></h3>
      <div class="exp-grid">
      <div>
        <div class="section-label">Which publications</div>
        <label class="opt ${sel.length ? '' : 'disabled'}"><input type="radio" name="pscope" value="sel" ${sel.length ? 'checked' : ''}><span>Selected<small>${sel.length}</small></span></label>
        <label class="opt"><input type="radio" name="pscope" value="vis" ${sel.length ? '' : 'checked'}><span>As shown in the list (filters applied)<small>${vis.length}</small></span></label>
        <label class="opt"><input type="radio" name="pscope" value="all"><span>All (except hidden)<small>${all.length}</small></span></label>
        <label class="opt"><input type="checkbox" id="x-year"><span>Only ${THIS_YEAR}<small>${nThis} publication${nThis === 1 ? '' : 's'} this year – a report for the current year</small></span></label>
        <div class="section-label">Types to include</div>
        <div class="type-checks">${present.map(c => `<label><input type="checkbox" class="x-type" value="${c.id}" ${c.id !== 'other' ? 'checked' : ''}> ${esc(shortCat(c.id))} <span class="muted">(${shown.filter(w => cat(w) === c.id).length})</span></label>`).join('')}</div>
        <div class="section-label">Format</div>
        <select class="input wide" id="x-fmt">
          <option value="html">Web page (.html) – clean, printable, shareable</option>
          <option value="rtf">Word / Pages document (.rtf)</option>
          <option value="txt">Plain text (.txt)</option>
          <option value="csv">Spreadsheet (.csv) – all columns incl. IF and role</option>
          <option value="ris">Zotero / EndNote (.ris)</option>
          <option value="bibtex">BibTeX (.bib)</option></select>
      </div>
      <div id="x-opts">
        <div class="section-label">Options</div>
        <label class="opt"><input type="checkbox" id="x-if" ${jmReady ? 'checked' : ''}><span>Journal impact factor<small>At the year of publication and the latest year${jmReady ? '' : ' – <b>load the journal metrics first</b> (Publications → Load journal metrics), or the values will be empty'}</small></span></label>
        <label class="opt"><input type="checkbox" id="x-num" checked><span>Numbering (oldest = 1)<small>Continuous, chronological; restarts for each type when grouped by type</small></span></label>
        <label class="opt"><input type="checkbox" id="x-hl" checked><span>Highlight first, co-first and last authorship<small>Name in bold and underlined, with a role label</small></span></label>
        <label class="opt"><input type="checkbox" id="x-sum" checked><span>Summary table<small>Totals by type, first / co-first / last / co-last authorship, and ${THIS_YEAR}</small></span></label>
        <div class="two">
          <label>Sections<select class="input" id="x-group"><option value="type">By type</option><option value="year">By year</option><option value="type_year">By type, then year</option><option value="none">None</option></select></label>
          <label>Order<select class="input" id="x-order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        </div>
        <label>Citation style<select class="input wide" id="x-style">${state.styles.map(s => `<option value="${s.id}" ${s.id === state.settings.default_style ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <p class="muted small">The title and the file name include today's date (“updated ${new Date().toLocaleDateString()}”).</p>
      </div></div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pexp-go">⤓ Download</button></div>`, {wide: true});
    m.el.querySelector('.modal').classList.add('xwide');
    const syncOpts = () => { $('#x-opts', m.el).style.opacity = ['ris', 'bibtex'].includes($('#x-fmt', m.el).value) ? .35 : 1; };
    $('#x-fmt', m.el).onchange = syncOpts;
    $('#pexp-go', m.el).onclick = async () => {
      const scope = $('input[name=pscope]:checked', m.el).value;
      const keys = scope === 'sel' ? sel : scope === 'vis' ? vis : all;
      const types = $$('.x-type', m.el).filter(x => x.checked).map(x => x.value);
      const options = {include_if: $('#x-if', m.el).checked, numbering: $('#x-num', m.el).checked, highlight: $('#x-hl', m.el).checked,
        summary: $('#x-sum', m.el).checked, group: $('#x-group', m.el).value, order: $('#x-order', m.el).value,
        year_only: $('#x-year', m.el).checked ? THIS_YEAR : null};
      // apply type corrections made in PaperShelf
      try {
        const r = await fetch(`/api/people/${S.person.id}/export`, {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({keys, types, format: $('#x-fmt', m.el).value, style: $('#x-style', m.el).value, options})});
        if (!r.ok) throw new Error('Export failed');
        const blob = await r.blob();
        const fn = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'publications';
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        m.close(); toast(`Saved ${fn} in your Downloads.`, 'ok', 7000);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function bind() {
    $('#people-side').addEventListener('click', e => {
      if (e.target.closest('#p-new')) { S.view = 'search'; S.results = null; S.query = ''; side(); draw(); return; }
      const it = e.target.closest('[data-pid]'); if (it) openPerson(+it.dataset.pid);
    });
    const main = $('#people-main');
    main.addEventListener('submit', e => { if (e.target.id === 'p-search-form') { e.preventDefault(); const q = $('#p-q').value.trim(); if (q) search(q); } });
    main.addEventListener('click', async e => {
      const c = e.target.closest('[data-cand]'); if (c) { add(S.results[+c.dataset.cand]); return; }
      if (!S.person) return;
      const id = e.target.id;
      const pt = e.target.closest('[data-ptab]');
      if (pt) { S.ptab = pt.dataset.ptab; try { localStorage.setItem('papershelf-ptab', S.ptab); } catch (x) { /* ignore */ } draw(); $('#people-main').scrollTop = 0; return; }
      if (id === 'p-refresh') {
        S.loadingProfile = true; draw();
        try { setPerson((await api(`/api/people/${S.person.id}/refresh`, {method: 'POST'})).person); toast('Profile updated.', 'ok'); }
        catch (err) { toast(err.message, 'error'); }
        S.loadingProfile = false; draw(); loadList(); return;
      }
      if (id === 'p-roles') { checkRoles(true); return; }
      if (id === 'p-goyear') { S.ptab = 'pubs'; S.f.thisYear = true; draw(); return; }
      if (id === 'p-me') { await save({is_me: !S.person.is_me}); draw(); loadList(); return; }
      if (id === 'p-remove') {
        const ok = await confirmBox(`Remove ${S.person.name}?`, 'The saved profile is removed from PaperShelf. Papers you added to your library stay.', {ok: 'Remove', danger: true});
        if (ok) { await api(`/api/people/${S.person.id}`, {method: 'DELETE'}); S.person = null; S.view = 'search'; S.results = null; await loadList(); draw(); }
        return;
      }
      if (id === 'p-export') { exportDialog(); return; }
      if (id === 'p-rankings') { loadRankings(); return; }
      if (id === 'p-rm-scholar') { await api(`/api/people/${S.person.id}/scholar`, {method: 'DELETE'}); await openPerson(S.person.id); return; }
      const jm = e.target.closest('[data-jm]'); if (jm) { jmModal(jm.dataset.jm); return; }
      if (id === 'p-addsel') { addToLibrary([...S.selected]); return; }
      if (id === 'p-allcats') { S.f.cats = null; draw(); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const cur = S.f.cats;
        if (!cur) S.f.cats = new Set([chip.dataset.chip]);
        else if (cur.size === 1 && cur.has(chip.dataset.chip)) S.f.cats = null;
        else { cur.has(chip.dataset.chip) ? cur.delete(chip.dataset.chip) : cur.add(chip.dataset.chip); if (!cur.size) S.f.cats = null; }
        draw(); return;
      }
      const jump = e.target.closest('[data-jump]');
      if (jump) { e.preventDefault(); const el = $(`.prow[data-key="${CSS.escape(jump.dataset.jump)}"]`); el?.scrollIntoView({block: 'center', behavior: 'smooth'}); el?.classList.add('flash-row'); setTimeout(() => el?.classList.remove('flash-row'), 1500); return; }
      const row = e.target.closest('.prow'); if (!row || row.classList.contains('head')) return;
      const key = row.dataset.key;
      if (e.target.closest('[data-addlib]')) { addToLibrary([key]); return; }
      if (e.target.closest('[data-exclude]')) {
        const ex = new Set(S.person.excluded); ex.has(key) ? ex.delete(key) : ex.add(key);
        await save({excluded: [...ex]}); S.selected.delete(key); draw(); return;
      }
    });
    main.addEventListener('change', async e => {
      if (!S.person) return;
      const t = e.target;
      if (t.classList.contains('psel')) { const k = t.closest('.prow').dataset.key; t.checked ? S.selected.add(k) : S.selected.delete(k); draw(); return; }
      if (t.id === 'p-selall') { const vis = filtered().map(w => w.key); if (t.checked) vis.forEach(k => S.selected.add(k)); else S.selected.clear(); draw(); return; }
      if (t.dataset.cat !== undefined) {
        const key = t.closest('.prow').dataset.key; const w = S.person.profile.works.find(x => x.key === key);
        const ov = {...S.person.overrides};
        if (t.value === w.category) delete ov[key]; else ov[key] = t.value;
        await save({overrides: ov}); draw(); return;
      }
      const map = {'p-role': 'role', 'p-sort': 'sort', 'p-from': 'from', 'p-to': 'to'};
      if (map[t.id]) { S.f[map[t.id]] = t.value; draw(); return; }
      const bools = {'p-hidepre': 'hidePubPreprints', 'p-showex': 'showExcluded', 'p-byyear': 'byYear', 'p-thisyear': 'thisYear'};
      if (bools[t.id]) { S.f[bools[t.id]] = t.checked; draw(); }
    });
    let qt = null;
    main.addEventListener('input', e => {
      if (e.target.id !== 'p-fq') return;
      clearTimeout(qt);
      qt = setTimeout(() => { S.f.q = e.target.value; draw(); }, 220);
    });
  }

  let bound = false;
  async function show() {
    if (!bound) {
      bind(); bound = true; await loadList();
      if (S.list.length) { const me = S.list.find(p => p.is_me) || S.list[0]; await openPerson(me.id); return; }
    }
    side(); draw();
  }
  async function openById(id) { if (!bound) await show(); await loadList(); await openPerson(id); }
  return {show, openById, scholarBookmarklet};
})();
