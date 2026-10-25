'use strict';
/* Map: papers of the current view as a force-directed network, linked by
   - citations: arrows from the citing paper to the cited one; optional grey "ghost" nodes are
     papers you don't have that several of these papers cite;
   - keywords: keywords as hub nodes, or papers linked when they share keywords;
   - groups: your groups as hub nodes (subgroups linked to their parent), papers linked to their groups. */
const Graph = (() => {
  const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#59a14f', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#3d9970'];
  const STATUS_COLORS = {to_read: '#9aa0a6', reading: '#e3a008', read: '#2e9d5b'};
  const st = {
    canvas: null, ctx: null, nodes: [], edges: [], alpha: 0, raf: null, scale: 1, tx: 0, ty: 0, w: 0, h: 0,
    edgeMode: 'cites', showExt: true, kwStyle: 'hubs', minShared: 0, colorBy: 'group', hover: null, drag: null, pan: null, extInfo: {},
    key: '', fitPending: false, papers: [], colors: {},
  };

  function ensureDom() {
    const root = $('#map-view');
    if (root.dataset.ready) return;
    root.dataset.ready = '1';
    root.innerHTML = `
      <div class="map-bar">
        <span class="muted small">Links:</span>
        <div class="seg small-seg" id="map-edges"><button data-e="cites" class="on" title="Arrow = cites">Citations</button><button data-e="keywords" title="Papers connected through their keywords">Keywords</button><button data-e="groups" title="Papers connected to your groups (labels)">Groups</button></div>
        <label class="check map-opt" data-for="cites" title="Grey dots: papers you don't have that at least two of these papers cite"><input type="checkbox" id="map-ext" checked> key papers you don't have</label>
        <select id="map-kwstyle" class="map-opt" data-for="keywords" title="How keywords are shown"><option value="hubs">Keywords as nodes</option><option value="pairs">Papers linked by shared keywords</option></select>
        <select id="map-minshared" class="map-opt" data-for="pairs" title="How many keywords two papers must share to be linked"><option value="0">Auto</option><option value="1">≥ 1 shared</option><option value="2">≥ 2 shared</option><option value="3">≥ 3 shared</option></select>
        <select id="map-color" title="Node color"><option value="group">Color by group</option><option value="status">Color by reading status</option><option value="year">Color by year</option></select>
        <div class="grow"></div>
        <span id="map-info" class="muted small"></span>
        <button class="btn small" id="map-fetch" style="display:none"></button>
        <button class="btn small" id="map-fit" title="Fit to screen">⤢ Fit</button><button class="help-q" data-help="map" title="Explain this">?</button>
      </div>
      <div class="map-wrap" id="map-wrap">
        <canvas id="map-canvas"></canvas>
        <div id="map-tip" class="map-tip"></div>
        <div id="map-legend" class="map-legend"></div>
        <div id="map-msg" class="map-msg"></div>
        <div class="map-help muted small">Scroll to zoom · drag to move · click a paper to open it · double-click a dot to release it</div>
      </div>`;
    st.canvas = $('#map-canvas');
    st.ctx = st.canvas.getContext('2d');
    $('#map-edges').addEventListener('click', e => {
      const b = e.target.closest('[data-e]'); if (!b) return;
      st.edgeMode = b.dataset.e;
      $$('#map-edges button').forEach(x => x.classList.toggle('on', x === b));
      showOpts(); render(st.papers, false, true);
    });
    $('#map-kwstyle').addEventListener('change', e => { st.kwStyle = e.target.value; showOpts(); render(st.papers, false, true); });
    $('#map-minshared').addEventListener('change', e => { st.minShared = +e.target.value; render(st.papers, false, true); });
    showOpts();
    $('#map-ext').addEventListener('change', e => { st.showExt = e.target.checked; render(st.papers, false, true); });
    $('#map-color').addEventListener('change', e => { st.colorBy = e.target.value; legend(); draw(); });
    $('#map-fit').addEventListener('click', fit);
    $('#map-fetch').addEventListener('click', async () => {
      const ids = missingIds(st.papers);
      setBusy($('#map-fetch'), true, 'Getting citation data…');
      await fetchCitations(ids);
      setBusy($('#map-fetch'), false);
    });
    bindPointer();
    new ResizeObserver(resize).observe($('#map-wrap'));
  }

  function showOpts() {
    $$('.map-opt').forEach(el => {
      const f = el.dataset.for;
      el.style.display = f === st.edgeMode || (f === 'pairs' && st.edgeMode === 'keywords' && st.kwStyle === 'pairs') ? '' : 'none';
    });
  }

  const missingIds = papers => papers.filter(p => !p.openalex_id && !p.citations_at && (p.doi || p.arxiv_id)).map(p => p.id);

  function resize() {
    const wrap = $('#map-wrap'); if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    if (!st.w) { st.tx = w / 2; st.ty = h / 2; }
    st.w = w; st.h = h;
    st.canvas.width = Math.floor(w * dpr); st.canvas.height = Math.floor(h * dpr);
    st.canvas.style.width = w + 'px'; st.canvas.style.height = h + 'px';
    draw();
  }

  /* ------------------------------------------------------------ data */
  function build(papers) {
    const old = new Map(st.nodes.map(n => [n.key, n]));
    const nodes = [], edges = [];
    const byOa = new Map();
    const place = key => {
      const o = old.get(key);
      if (o) return {x: o.x, y: o.y, vx: 0, vy: 0, fixed: o.fixed};
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 160;
      return {x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fixed: false};
    };
    for (const p of papers) {
      const n = {key: 'p' + p.id, paper: p, deg: 0, ...place('p' + p.id)};
      nodes.push(n);
      if (p.openalex_id) byOa.set(p.openalex_id, n);
    }
    if (st.edgeMode === 'cites') {
      for (const n of nodes) for (const r of n.paper.refs || []) {
        const t = byOa.get(r);
        if (t && t !== n) { edges.push({s: n, t, w: 1}); t.deg++; }
      }
      if (st.showExt) {
        const owned = new Set(state.papers.map(p => p.openalex_id).filter(Boolean));
        const counts = new Map();
        for (const n of nodes) for (const r of new Set(n.paper.refs || [])) if (!owned.has(r)) counts.set(r, (counts.get(r) || 0) + 1);
        const top = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40);
        const extNodes = new Map();
        for (const [id, c] of top) {
          const n = {key: 'w' + id, ext: {id, count: c}, deg: c, ...place('w' + id)};
          nodes.push(n); extNodes.set(id, n);
        }
        for (const n of nodes) if (n.paper) for (const r of new Set(n.paper.refs || [])) {
          const t = extNodes.get(r); if (t) edges.push({s: n, t, w: 1, ext: true});
        }
        fetchExtInfo([...extNodes.keys()]);
      }
    } else if (st.edgeMode === 'keywords' && st.kwStyle === 'hubs') {
      // the most common keywords of these papers become nodes; each paper is linked to its keywords
      const freq = new Map();
      for (const n of nodes) for (const k of new Set(n.paper.keywords || [])) {
        const key = k.toLowerCase(); const f = freq.get(key) || {label: k, n: 0}; f.n++; freq.set(key, f);
      }
      const maxHubs = nodes.length > 300 ? 40 : 30;
      const top = [...freq.entries()].filter(([, f]) => f.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, maxHubs);
      const hubs = new Map();
      top.forEach(([key, f], i) => {
        const h = {key: 'k' + key, hub: {kind: 'kw', id: key, label: f.label, count: f.n, color: PALETTE[i % PALETTE.length]}, deg: f.n, ...place('k' + key)};
        nodes.push(h); hubs.set(key, h);
      });
      for (const n of nodes) if (n.paper) for (const k of new Set((n.paper.keywords || []).map(x => x.toLowerCase()))) {
        const h = hubs.get(k); if (h) { edges.push({s: n, t: h, w: 1, undirected: true, hub: true}); n.deg++; }
      }
    } else if (st.edgeMode === 'keywords') {
      // papers linked when they share keywords; each paper keeps only its strongest links (readable map)
      const kw = nodes.map(n => new Set((n.paper.keywords || []).map(k => k.toLowerCase())));
      const minShared = st.minShared || (nodes.length > 400 ? 2 : 1);
      const cand = [];
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        let shared = 0;
        for (const k of kw[i]) if (kw[j].has(k)) shared++;
        if (shared >= minShared) cand.push({i, j, w: shared});
      }
      const KEEP = 6, per = nodes.map(() => []);
      for (const c of cand) { per[c.i].push(c); per[c.j].push(c); }
      const keep = new Set();
      for (const list of per) list.sort((a, b) => b.w - a.w).slice(0, KEEP).forEach(c => keep.add(c));
      for (const c of keep) {
        edges.push({s: nodes[c.i], t: nodes[c.j], w: c.w, undirected: true}); nodes[c.i].deg++; nodes[c.j].deg++;
      }
    } else if (st.edgeMode === 'groups') {
      // your groups as nodes (with their parent groups), papers linked to the groups they are in
      const inScope = state.view.type === 'group' ? descendants(state.view.id) : null;
      const used = new Set();
      for (const n of nodes) for (const gid of n.paper.group_ids || []) if (!inScope || inScope.has(gid)) used.add(gid);
      const byId = new Map(state.groups.map(g => [g.id, g]));
      const show = new Set();
      for (const gid of used) {  // add the parents too, so the group tree is visible
        let g = byId.get(gid);
        while (g && (!inScope || inScope.has(g.id))) { show.add(g.id); g = byId.get(g.parent_id); }
      }
      const tops = state.groups.filter(g => g.parent_id == null).map(g => g.id);
      const topOf = gid => { let g = byId.get(gid); while (g && g.parent_id != null && byId.get(g.parent_id)) g = byId.get(g.parent_id); return g ? g.id : gid; };
      const hubs = new Map();
      for (const gid of show) {
        const g = byId.get(gid);
        const count = nodes.filter(n => n.paper && (n.paper.group_ids || []).includes(gid)).length;
        const ti = tops.indexOf(topOf(gid));
        const h = {key: 'g' + gid, hub: {kind: 'group', id: gid, label: g.name, path: groupPath(gid), count, color: ti >= 0 ? PALETTE[ti % PALETTE.length] : '#888',
          sub: g.parent_id != null}, deg: count, ...place('g' + gid)};
        nodes.push(h); hubs.set(gid, h);
      }
      for (const h of hubs.values()) {
        const g = byId.get(h.hub.id); const parent = hubs.get(g.parent_id);
        if (parent) edges.push({s: h, t: parent, w: 2, undirected: true, tree: true});
      }
      for (const n of nodes) if (n.paper) for (const gid of n.paper.group_ids || []) {
        const h = hubs.get(gid); if (h) { edges.push({s: n, t: h, w: 1, undirected: true, hub: true}); n.deg++; }
      }
    }
    for (const n of nodes) n.r = n.hub ? 9 + 2.8 * Math.sqrt(n.hub.count || 1) : n.ext ? 3.5 + 1.6 * Math.sqrt(n.ext.count) : 5 + 2.2 * Math.sqrt(n.deg);
    st.nodes = nodes; st.edges = edges;
  }

  async function fetchExtInfo(ids) {
    const missing = ids.filter(id => !st.extInfo[id]);
    if (!missing.length) return;
    try {
      const d = await api('/api/openalex/works', {method: 'POST', body: {ids: missing}});
      Object.assign(st.extInfo, d.works); draw();
    } catch (e) { /* offline: ghost nodes simply have no titles */ }
  }

  /* ------------------------------------------------------------ simulation */
  function tick() {
    const N = st.nodes, k = st.alpha;
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
        if (d2 > 160000) continue;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const f = 1400 * k / d2;
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
      }
    }
    for (const e of st.edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = (e.ext ? 55 : e.tree ? 110 : e.hub ? 45 : 75) + e.s.r + e.t.r;
      const f = (d - target) / d * 0.03 * k * Math.min(3, Math.sqrt(e.w));
      e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
    }
    for (const n of N) {
      n.vx -= n.x * 0.006 * k; n.vy -= n.y * 0.006 * k;
      if (n.fixed || n === st.drag?.node) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.55; n.vy *= 0.55;
      n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy));
    }
    st.alpha *= 0.982;
  }
  function loop() {
    st.raf = null;
    tick(); tick();
    if (st.fitPending && st.alpha < 0.25) { st.fitPending = false; fit(); }
    draw();
    if (st.alpha > 0.015) st.raf = requestAnimationFrame(loop);
    else if (st.fitPending) { st.fitPending = false; fit(); }
  }
  function heat(a = 1) { st.alpha = Math.max(st.alpha, a); if (!st.raf) st.raf = requestAnimationFrame(loop); }
  function stop() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = null; }

  function fit() {
    if (!st.nodes.length || !st.w) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of st.nodes) { x1 = Math.min(x1, n.x - n.r); y1 = Math.min(y1, n.y - n.r); x2 = Math.max(x2, n.x + n.r); y2 = Math.max(y2, n.y + n.r); }
    const pad = 70;
    st.scale = Math.min(2.2, Math.max(0.15, Math.min((st.w - pad) / (x2 - x1 || 1), (st.h - pad) / (y2 - y1 || 1))));
    st.tx = st.w / 2 - (x1 + x2) / 2 * st.scale; st.ty = st.h / 2 - (y1 + y2) / 2 * st.scale;
    draw();
  }

  /* ------------------------------------------------------------ drawing */
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function yearRange() {
    const ys = st.nodes.filter(n => n.paper?.year).map(n => n.paper.year);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [2000, 2025];
  }
  function nodeColor(n) {
    if (n.ext) return null;
    if (n.hub) return n.hub.color;
    const p = n.paper;
    if (st.colorBy === 'status') return STATUS_COLORS[p.status] || '#999';
    if (st.colorBy === 'year') {
      if (!p.year) return '#999';
      const [a, b] = st.yr; const t = b > a ? (p.year - a) / (b - a) : 1;
      return `hsl(${220 - 210 * t}, 70%, 50%)`;
    }
    const g = groupColorKey(p);
    return g == null ? '#9aa0a6' : PALETTE[g % PALETTE.length];
  }
  function groupColorKey(p) {
    if (!p.group_ids.length) return null;
    let ids = p.group_ids;
    if (state.view.type === 'group') {  // inside a group, color by its subgroups
      const kids = childrenOf(state.view.id).map(g => g.id);
      for (const [i, kid] of kids.entries()) if (ids.some(gid => descendants(kid).has(gid))) return i;
      return null;
    }
    const order = state.groups.filter(g => g.parent_id == null).map(g => g.id);
    for (const [i, top] of order.entries()) if (ids.some(gid => descendants(top).has(gid))) return i;
    return null;
  }
  function legend() {
    const el = $('#map-legend'); if (!el) return;
    let items = [];
    if (st.colorBy === 'status') items = Object.entries(STATUS_COLORS).map(([k, c]) => [c, STATUS_LABEL[k]]);
    else if (st.colorBy === 'year') { st.yr = yearRange(); items = [[`hsl(220,70%,50%)`, st.yr[0]], [`hsl(10,70%,50%)`, st.yr[1]]]; }
    else {
      const groups = state.view.type === 'group' ? childrenOf(state.view.id) : state.groups.filter(g => g.parent_id == null);
      items = groups.slice(0, 10).map((g, i) => [PALETTE[i % PALETTE.length], g.name]);
      items.push(['#9aa0a6', state.view.type === 'group' ? 'directly in this group' : 'no group']);
    }
    if (st.showExt && st.edgeMode === 'cites') items.push(['ghost', 'not in your library']);
    if (st.edgeMode === 'groups') items.push(['hub', 'group (size = papers; dashed = subgroup of)']);
    if (st.edgeMode === 'keywords' && st.kwStyle === 'hubs') items.push(['hub', 'keyword (size = papers)']);
    el.innerHTML = items.map(([c, l]) => `<div><span class="dot ${c === 'ghost' ? 'ghost' : c === 'hub' ? 'hubdot' : ''}" style="${c === 'ghost' || c === 'hub' ? '' : `background:${c}`}"></span>${esc(l)}</div>`).join('');
  }
  function label(n) {
    if (n.hub) return truncate(n.hub.label, 28);
    if (n.ext) { const w = st.extInfo[n.ext.id]; return w ? `${(w.authors || '').split(' ')[0]} ${w.year || ''}`.trim() : ''; }
    const a = n.paper.authors[0]?.family || truncate(n.paper.title, 18);
    return `${a} ${n.paper.year || ''}`.trim();
  }
  function neighbours(n) {
    const s = new Set([n]);
    for (const e of st.edges) { if (e.s === n) s.add(e.t); if (e.t === n) s.add(e.s); }
    return s;
  }
  function draw() {
    const c = st.ctx; if (!c || !st.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, st.w, st.h);
    const text = cssVar('--text') || '#222', muted = cssVar('--muted') || '#777', bg = cssVar('--bg') || '#fff', accent = cssVar('--accent') || '#36c';
    if (st.colorBy === 'year') st.yr = yearRange();
    const focus = st.hover ? neighbours(st.hover) : null;
    const S = (x, y) => [x * st.scale + st.tx, y * st.scale + st.ty];

    for (const e of st.edges) {
      const dim = focus && !(focus.has(e.s) && focus.has(e.t));
      const [x1, y1] = S(e.s.x, e.s.y), [x2, y2] = S(e.t.x, e.t.y);
      c.globalAlpha = dim ? 0.06 : (e.ext ? 0.22 : 0.45);
      c.strokeStyle = focus && !dim ? accent : muted;
      c.lineWidth = e.tree ? 1.6 : e.hub ? 0.9 : e.undirected ? Math.min(4, 0.6 + e.w * 0.6) : 1;
      if (e.tree) { c.setLineDash([5, 4]); c.globalAlpha = dim ? 0.06 : 0.7; }
      else if (e.hub && !dim) { c.globalAlpha = 0.3; if (!(focus && !dim)) c.strokeStyle = e.t.hub?.color || muted; }
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.setLineDash([]);
      if (!e.undirected) {  // arrowhead at the cited paper
        const ang = Math.atan2(y2 - y1, x2 - x1), rr = e.t.r * st.scale + 2;
        const ax = x2 - Math.cos(ang) * rr, ay = y2 - Math.sin(ang) * rr, sz = 6;
        c.beginPath(); c.moveTo(ax, ay);
        c.lineTo(ax - sz * Math.cos(ang - 0.4), ay - sz * Math.sin(ang - 0.4));
        c.lineTo(ax - sz * Math.cos(ang + 0.4), ay - sz * Math.sin(ang + 0.4));
        c.closePath(); c.fillStyle = c.strokeStyle; c.fill();
      }
    }
    c.globalAlpha = 1;
    for (const n of st.nodes) {
      const [x, y] = S(n.x, n.y); const r = Math.max(2.5, n.r * st.scale);
      c.globalAlpha = focus && !focus.has(n) ? 0.18 : 1;
      if (n.hub) {  // group / keyword: a rounded diamond
        c.beginPath(); c.moveTo(x, y - r * 1.25); c.lineTo(x + r * 1.25, y); c.lineTo(x, y + r * 1.25); c.lineTo(x - r * 1.25, y); c.closePath();
        c.fillStyle = n.hub.color; c.globalAlpha *= n.hub.sub ? 0.8 : 0.95; c.fill();
        c.lineWidth = n === st.hover ? 3 : 1.5; c.strokeStyle = n === st.hover ? text : bg; c.stroke();
        continue;
      }
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (n.ext) {
        c.fillStyle = bg; c.fill(); c.setLineDash([3, 2]); c.strokeStyle = muted; c.lineWidth = 1.4; c.stroke(); c.setLineDash([]);
      } else {
        c.fillStyle = nodeColor(n); c.fill();
        c.lineWidth = n === st.hover || n.paper.id === state.openId ? 3 : 1.2;
        c.strokeStyle = n === st.hover || n.paper.id === state.openId ? text : bg; c.stroke();
        if (n.paper.starred) { c.fillStyle = '#e0a100'; c.font = `${Math.max(9, r)}px sans-serif`; c.fillText('★', x + r * 0.5, y - r * 0.5); }
      }
    }
    c.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const n of st.nodes) {
      const show = n.hub ? !focus || focus.has(n) : (focus && focus.has(n)) || (!focus && (st.scale > 1.25 || n.r * st.scale > 9 || st.nodes.length < 25));
      if (!show) continue;
      const lbl = label(n); if (!lbl) continue;
      const [x, y] = S(n.x, n.y); const dy = n.r * st.scale * (n.hub ? 1.25 : 1) + 3;
      c.font = n.hub ? '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' : '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      c.globalAlpha = 1; c.lineWidth = 3; c.strokeStyle = bg; c.strokeText(lbl, x, y + dy);
      c.fillStyle = n.ext ? muted : text; c.fillText(lbl, x, y + dy);
    }
    c.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ interaction */
  function world(e) {
    const b = st.canvas.getBoundingClientRect();
    const sx = e.clientX - b.left, sy = e.clientY - b.top;
    return {sx, sy, x: (sx - st.tx) / st.scale, y: (sy - st.ty) / st.scale};
  }
  function hit(pt) {
    let best = null, bd = Infinity;
    for (const n of st.nodes) {
      const d = Math.hypot(n.x - pt.x, n.y - pt.y); const lim = n.r + 4 / st.scale;
      if (d < lim && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  function tip(n, pt) {
    const el = $('#map-tip');
    if (!n) { el.style.display = 'none'; return; }
    let html;
    if (n.hub) {
      html = n.hub.kind === 'group'
        ? `<b>Group: ${esc(n.hub.path || n.hub.label)}</b><div class="muted">${n.hub.count} paper${n.hub.count === 1 ? '' : 's'} here directly · click to open the group</div>`
        : `<b>Keyword: ${esc(n.hub.label)}</b><div class="muted">${n.hub.count} papers · click to show only these papers</div>`;
    } else if (n.ext) {
      const w = st.extInfo[n.ext.id];
      html = `<b>${esc(w?.title || 'Loading…')}</b><div>${esc([w?.authors, w?.venue, w?.year].filter(Boolean).join(' · '))}</div>
        <div class="muted">Cited by ${n.ext.count} of these papers · not in your library – click to add</div>`;
    } else {
      const p = n.paper;
      const inLib = st.edges.filter(e => e.t === n && !e.undirected).length;
      html = `<b>${esc(p.title)}</b><div>${esc([shortAuthors(p), p.journal, p.year].filter(Boolean).join(' · '))}</div>
        <div class="muted">${st.edgeMode === 'cites' ? `Cited by ${inLib} paper${inLib === 1 ? '' : 's'} here · ${(p.cited_by_count ?? 0).toLocaleString()} overall`
          : st.edgeMode === 'groups' ? (p.group_ids.length ? `In: ${p.group_ids.map(g => esc(groupPath(g))).join('; ')}` : 'Not in any group')
          : `${n.deg} connection${n.deg === 1 ? '' : 's'}${p.keywords?.length ? ' · ' + esc(p.keywords.slice(0, 6).join(', ')) : ''}`}</div>`;
    }
    el.innerHTML = html; el.style.display = 'block';
    const x = Math.min(pt.sx + 14, st.w - 320), y = Math.min(pt.sy + 14, st.h - el.offsetHeight - 8);
    el.style.left = Math.max(4, x) + 'px'; el.style.top = Math.max(4, y) + 'px';
  }
  function bindPointer() {
    const cv = st.canvas;
    cv.addEventListener('mousedown', e => {
      const pt = world(e); const n = hit(pt);
      if (n) st.drag = {node: n, moved: false, ox: pt.x - n.x, oy: pt.y - n.y};
      else st.pan = {x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty};
    });
    window.addEventListener('mousemove', e => {
      if (!st.canvas || state.mode !== 'map') return;
      if (st.drag) {
        const pt = world(e); const n = st.drag.node;
        n.x = pt.x - st.drag.ox; n.y = pt.y - st.drag.oy; n.fixed = true; st.drag.moved = true;
        heat(0.25); tip(null); return;
      }
      if (st.pan) { st.tx = st.pan.tx + e.clientX - st.pan.x; st.ty = st.pan.ty + e.clientY - st.pan.y; draw(); return; }
      if (e.target !== cv) return;
      const pt = world(e); const n = hit(pt);
      if (n !== st.hover) { st.hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; draw(); }
      tip(n, pt);
    });
    window.addEventListener('mouseup', () => {
      if (st.drag && !st.drag.moved) click(st.drag.node);
      st.drag = null; st.pan = null;
    });
    cv.addEventListener('mouseleave', () => { if (!st.drag) { st.hover = null; tip(null); draw(); } });
    cv.addEventListener('dblclick', e => { const n = hit(world(e)); if (n) { n.fixed = false; heat(0.3); } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const pt = world(e); const f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(5, Math.max(0.1, st.scale * f));
      st.tx = pt.sx - pt.x * ns; st.ty = pt.sy - pt.y * ns; st.scale = ns; draw();
    }, {passive: false});
  }
  function click(n) {
    if (n.paper) { openDetail(n.paper.id); draw(); return; }
    if (n.hub) {
      tip(null);
      if (n.hub.kind === 'group') setView({type: 'group', id: n.hub.id});
      else { state.keyword = n.hub.id; renderList(); renderKeywords(); renderMode(true); }
      return;
    }
    const w = st.extInfo[n.ext.id] || {id: n.ext.id, title: 'Unknown work'};
    const link = w.doi ? `https://doi.org/${w.doi}` : `https://openalex.org/${w.id}`;
    const m = modal(`<h3>${esc(w.title)}</h3><p class="muted">${esc([w.authors, w.venue, w.year].filter(Boolean).join(' · '))}</p>
      <p>Cited by <b>${n.ext.count}</b> of the papers on this map${w.cited_by_count ? ` and ${w.cited_by_count.toLocaleString()} times overall` : ''}. It's not in your library yet.</p>
      <div class="modal-actions"><button class="btn" data-close>Close</button><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">🔗 Open</a>
      <button class="btn primary" id="ext-add">＋ Add to library${currentGroupId() ? ' (this group)' : ''}</button></div>`);
    $('#ext-add', m.el).onclick = async () => {
      setBusy($('#ext-add', m.el), true, 'Adding…');
      try {
        const d = await api('/api/papers', {method: 'POST', body: {input: w.id, group_id: currentGroupId()}});
        upsertPaper(d.paper); m.close(); toast(`Added: ${truncate(d.paper.title, 80)}`, 'ok'); renderSidebar(); renderList(); renderMode();
      } catch (err) { setBusy($('#ext-add', m.el), false); toast(err.message, 'error'); }
    };
  }

  /* ------------------------------------------------------------ entry */
  function render(papers, scopeChanged = false, force = false) {
    ensureDom();
    st.papers = papers;
    const key = papers.map(p => `${p.id}:${p.openalex_id ? p.refs.length : 0}:${st.edgeMode === 'groups' ? p.group_ids.join('.') : st.edgeMode === 'keywords' ? (p.keywords || []).length : ''}`).join(',')
      + `|${st.edgeMode}|${st.showExt}|${st.kwStyle}|${st.minShared}|${st.edgeMode === 'groups' ? state.groups.map(g => g.id + ':' + g.parent_id + g.name).join(',') : ''}`;
    resize();
    const msg = $('#map-msg');
    const missing = missingIds(papers);
    $('#map-fetch').style.display = missing.length ? '' : 'none';
    $('#map-fetch').textContent = `Get citation data for ${missing.length} paper${missing.length === 1 ? '' : 's'}`;
    if (key !== st.key || force) {
      st.key = key;
      build(papers);
      st.fitPending = scopeChanged || force || st.fitPending;
      heat(scopeChanged || force ? 1 : 0.5);
    } else draw();
    legend();
    const links = st.edges.length;
    const hubs = st.nodes.filter(n => n.hub).length;
    $('#map-info').textContent = `${papers.length} paper${papers.length === 1 ? '' : 's'}${hubs ? ` · ${hubs} ${st.edgeMode === 'groups' ? 'group' : 'keyword'}${hubs === 1 ? '' : 's'}` : ''} · ${links} link${links === 1 ? '' : 's'}`;
    const withData = papers.filter(p => p.openalex_id).length;
    if (!papers.length) msg.innerHTML = 'No papers in this view.';
    else if (st.edgeMode === 'cites' && !withData) msg.innerHTML = `No citation data yet for these papers.<br><span class="muted small">PaperShelf gets it from OpenAlex, a free scholarly database (needs internet).</span>`;
    else if (st.edgeMode === 'cites' && !links) msg.innerHTML = `These papers don't cite each other.<br><span class="muted small">Try “Keywords” or “Groups”, or a larger group.</span>`;
    else if (st.edgeMode === 'groups' && !links) msg.innerHTML = `None of these papers is in a group yet.<br><span class="muted small">Create groups with ＋ in the sidebar and drag papers onto them.</span>`;
    else if (st.edgeMode === 'keywords' && !links) msg.innerHTML = `These papers share no keywords.<br><span class="muted small">Keywords are filled in automatically when papers are added; you can also type your own in a paper's details.</span>`;
    else msg.innerHTML = '';
    msg.style.display = msg.innerHTML ? '' : 'none';
  }

  return {render, stop: () => { stop(); if ($('#map-tip')) $('#map-tip').style.display = 'none'; }};
})();
