'use strict';
/* PaperShelf – the Lab: the research space of each group, beyond single papers.
   💡 Ideas & discussion: ideas, experiments, questions, results, decisions, protocols and notes, with
      comments, 👍 support, pins, tags and links to the group's papers. Each post belongs to its author.
   ✅ Plans & tasks: plans (milestones) and tasks on a board (to do / doing / done) with who, by when
      and priority – any editor can move or change them.
   🏠 Overview: your tasks in every group, what happened this week, the latest decisions.
   Everything lives in the group's file and travels with it (see sharing.py). Readers only read. */
const Lab = (() => {
  const S = {sid: null, sub: 'ideas', data: null, ov: null, loading: false, open: new Set(), composing: null,
    f: {kind: 'all', tag: '', q: '', sort: 'new'}, plan: 'all', mine: false, focus: null};
  try { const p = JSON.parse(localStorage.getItem('papershelf-lab') || '{}'); S.sid = p.sid || null; S.sub = p.sub === 'plans' ? 'plans' : 'ideas'; } catch { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem('papershelf-lab', JSON.stringify({sid: S.sid, sub: S.sub})); } catch { /* ignore */ } };

  const KINDS = [['idea', '💡', 'Idea'], ['experiment', '🧪', 'Experiment'], ['question', '❓', 'Question'], ['result', '📊', 'Result'],
    ['decision', '✅', 'Decision'], ['protocol', '📋', 'Protocol'], ['note', '📝', 'Note']];
  const K = Object.fromEntries(KINDS.map(([k, i, l]) => [k, {i, l}]));
  const STATUS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
  const HINT = {idea: 'A hypothesis, a new direction, something worth trying…', experiment: 'Design: question, conditions, n, measures, expected result…',
    question: 'Something the group should answer or discuss…', result: 'What came out: data, figure, effect size, what it means…',
    decision: 'What was decided, by whom, and why…', protocol: 'A method or a procedure the group follows…', note: 'Anything worth sharing with the group…'};
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const av = (id, name, size = 24) => `<span class="lab-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.5)}px;background:hsl(${hue(id)} 50% 42%)" title="${esc(name || id)}">${esc(initials(name || id))}</span>`;
  const md = t => (typeof Notes !== 'undefined' && Notes.md) ? Notes.md(t) : esc(t).replace(/\n/g, '<br>');
  const today = () => new Date().toISOString().slice(0, 10);
  function ago(s) {
    const t = Date.parse(s); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); return d < 7 ? `${d} day${d > 1 ? 's' : ''} ago` : new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
  }
  const dueTxt = d => { if (!d) return ''; const t = new Date(d + 'T12:00'); return t.toLocaleDateString(undefined, {day: 'numeric', month: 'short'}); };
  const dueCls = (d, status) => !d || status === 'done' ? '' : d < today() ? 'overdue' : d <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) ? 'soon' : '';
  const main = () => $('#lab-main');
  const groups = () => state.shares || [];
  const W = () => !!S.data?.can_write;
  const sidQ = () => encodeURIComponent(S.sid);

  /* ------------------------------------------------------------------ data */
  async function load() {
    if (!S.sid) { S.data = null; try { S.ov = await api('/api/lab/overview'); } catch (err) { S.ov = {groups: [], my_tasks: [], error: err.message}; } return; }
    try { S.data = await api(`/api/shares/${sidQ()}/lab`); }
    catch (err) { S.data = null; toast(err.message, 'error'); S.sid = null; save(); return load(); }
  }
  async function call(path, opts) {
    try { const d = await api(`/api/shares/${sidQ()}/lab${path}`, opts); S.data = d; render(); flashSaved(); return d; }
    catch (err) { toast(err.message, 'error'); return null; }
  }
  async function show() {
    if (S.sid && !groups().some(g => g.id === S.sid)) S.sid = null;
    if (!S.data && !S.ov) main().innerHTML = '<p class="muted" style="padding:24px">Loading…</p>';
    await load(); render();
  }
  async function go(sid, sub) {
    S.sid = sid || null; if (sub) S.sub = sub; S.composing = null; S.open.clear(); S.f = {kind: 'all', tag: '', q: '', sort: 'new'}; S.plan = 'all';
    save(); main().innerHTML = '<p class="muted" style="padding:24px">Loading…</p>';
    await load(); render(); main().scrollTop = 0;
  }
  // from a notification, the overview or elsewhere
  async function openGroup(sid, {post = null, task = null, sub = null} = {}) {
    if (state.tab !== 'lab') setTab('lab');
    await go(sid, sub || (task ? 'plans' : post ? 'ideas' : null));
    if (post) { S.open.add(post); render(); const el = $(`[data-post="${CSS.escape(post)}"]`, main()); if (el) { el.scrollIntoView({block: 'center'}); flash(el); } }
    if (task) { const t = S.data?.tasks.find(x => x.id === task); if (t) taskDialog(t); }
  }
  const flash = el => { el.classList.add('lab-flash'); setTimeout(() => el.classList.remove('lab-flash'), 1600); };

  /* ------------------------------------------------------------------ page */
  function render() {
    const el = main(); if (!el) return;
    // keep what is being written (the page is redrawn after each change, also by the others' updates)
    if (S.composing) readComposer();
    const drafts = {}, foc = document.activeElement, focPost = foc?.matches?.('.lc-text') ? foc.closest('[data-post]')?.dataset.post : null;
    $$('.lc-text', el).forEach(ta => { if (ta.value) drafts[ta.closest('[data-post]').dataset.post] = ta.value; });
    const scroll = el.scrollTop;
    const G = groups();
    const rail = `<nav class="lab-rail">
        <div class="lab-rail-h">🧪 Lab</div>
        <button class="lab-g ${S.sid ? '' : 'on'}" data-lg=""><span class="lab-g-ico">🏠</span><span class="lab-g-name">Overview</span></button>
        <div class="lab-rail-sec">Your groups</div>
        ${G.map(g => `<button class="lab-g ${S.sid === g.id ? 'on' : ''}" data-lg="${esc(g.id)}" title="${esc(g.name)}"><span class="lab-g-ico lab-g-dot" style="background:${esc(g.color || `hsl(${hue(g.id)} 45% 48%)`)}">${esc(initials(g.name))}</span><span class="lab-g-name">${esc(g.name)}<small>${g.role === 'member' ? 'editor' : 'reader'} · ${plural(g.papers, 'paper')}</small></span></button>`).join('')
          || '<div class="muted small lab-rail-empty">No groups yet.</div>'}
        <div class="lab-rail-acts"><button class="btn small" data-lnewgroup>＋ New group</button><button class="btn small" data-ljoin>Join…</button></div>
      </nav>`;
    el.innerHTML = `<div class="lab">${rail}<section class="lab-body">${S.sid && S.data ? groupHtml() : overviewHtml()}</section></div>`;
    el.scrollTop = scroll;
    for (const [pid, v] of Object.entries(drafts)) { const ta = $(`[data-post="${CSS.escape(pid)}"] .lc-text`, el); if (ta) ta.value = v; }
    if (focPost) $(`[data-post="${CSS.escape(focPost)}"] .lc-text`, el)?.focus();
    else if (S.composing && !$('#lc-title', el)?.value && document.activeElement === document.body) $('#lc-title', el)?.focus();
  }

  /* ------------------------------------------------------------------ overview */
  function overviewHtml() {
    const ov = S.ov || {groups: [], my_tasks: []};
    if (!groups().length) return `<div class="lab-hero"><div class="lab-hero-ico">🧪</div><h2>The Lab of your groups</h2>
      <p>A shared space for the research of a group – beyond the notes on single papers:</p>
      <ul class="lab-hero-list"><li>💡 <b>Ideas & discussion</b> – ideas, experiments, questions, results, decisions and protocols, with comments and 👍</li>
        <li>✅ <b>Plans & tasks</b> – milestones and a board of things to do, with who and by when</li>
        <li>🏠 <b>Overview</b> – your tasks in every group and what happened this week</li></ul>
      <p class="muted">It works inside a <b>group</b>: create one (or join one with an invitation) and invite your colleagues.</p>
      <div class="lab-hero-acts"><button class="btn primary" data-lnewgroup>＋ Create a group</button><button class="btn" data-ljoin>Join a group…</button><button class="btn" data-help="lab">📘 How it works</button></div></div>`;
    const mt = ov.my_tasks || [];
    return `<div class="lab-head"><div><h2>Overview</h2><div class="muted small">Your groups at a glance – updated with the groups (every 15 minutes, or ⟳)</div></div><span class="grow"></span><button class="btn small" data-help="lab">📘 Guide</button></div>
      <div class="lab-ov">
        <section class="lab-card lab-mytasks"><h3>✅ My tasks <span class="muted small">${mt.length ? plural(mt.length, 'open task') : ''}</span></h3>
          ${mt.length ? mt.map(t => `<div class="lab-mt ${dueCls(t.due, t.status)}"><button class="lab-check" data-ovdone="${esc(t.group)}|${esc(t.id)}" title="Mark it done"></button>
              <button class="linklike lab-mt-t" data-ovtask="${esc(t.group)}|${esc(t.id)}">${t.prio === 'high' ? '<span class="lab-prio">❗</span>' : ''}${esc(t.title)}</button>
              <span class="lab-chip">${esc(t.group_name)}</span>${t.status === 'doing' ? '<span class="lab-chip doing">doing</span>' : ''}${t.due ? `<span class="lab-due ${dueCls(t.due, t.status)}">📅 ${esc(dueTxt(t.due))}</span>` : ''}</div>`).join('')
            : '<p class="muted small">Nothing assigned to you. 🎉</p>'}</section>
        <div class="lab-gcards">${(ov.groups || []).map(g => `<section class="lab-card lab-gcard">
            <div class="lab-gc-h"><span class="lab-g-dot big" style="background:hsl(${hue(g.id)} 45% 48%)">${esc(initials(g.name))}</span><div><h3>${esc(g.name)}</h3><div class="muted small">${plural(g.members, 'member')} · ${plural(g.papers, 'paper')}${g.can_write ? '' : ' · reader'}</div></div>
              <span class="grow"></span><button class="btn small primary" data-lg="${esc(g.id)}">Open</button></div>
            <div class="lab-stats"><span><b>${g.posts_week}</b> new posts</span><span><b>${g.comments_week}</b> comments</span><span class="muted">this week</span></div>
            <div class="lab-stats"><span><b>${g.open_tasks}</b> open tasks</span>${g.overdue ? `<span class="overdue"><b>${g.overdue}</b> overdue</span>` : ''}<span><b>${g.done_tasks}</b> done</span></div>
            ${g.latest.length ? `<div class="lab-gc-sec">Latest</div>${g.latest.map(p => `<button class="lab-gc-post" data-ovpost="${esc(g.id)}|${esc(p.id)}"><span>${K[p.kind]?.i || '💡'}</span><span class="lab-gc-pt">${esc(truncate(p.title || '(untitled)', 70))}</span><span class="muted small">${esc(p.name)} · ${esc(ago(p.created))}${p.comments ? ` · 💬 ${p.comments}` : ''}</span></button>`).join('')}` : '<p class="muted small">Nothing posted yet.</p>'}
            ${g.decisions.length ? `<div class="lab-gc-sec">Decisions</div>${g.decisions.map(p => `<button class="lab-gc-post" data-ovpost="${esc(g.id)}|${esc(p.id)}"><span>✅</span><span class="lab-gc-pt">${esc(truncate(p.title || 'Decision', 70))}</span><span class="muted small">${esc(ago(p.created))}</span></button>`).join('')}` : ''}
          </section>`).join('')}</div>
      </div>`;
  }

  /* ------------------------------------------------------------------ a group */
  function groupHtml() {
    const d = S.data, g = groups().find(x => x.id === S.sid) || {name: d.group.name, papers: 0};
    const open = d.tasks.filter(t => t.status !== 'done').length;
    return `<div class="lab-head"><div class="lab-gh"><span class="lab-g-dot big" style="background:${esc(g.color || `hsl(${hue(S.sid)} 45% 48%)`)}">${esc(initials(d.group.name))}</span><div><h2>${esc(d.group.name)}</h2>
          <div class="muted small">${plural(d.people.length, 'member')} · ${plural(g.papers || 0, 'paper')} · ${W() ? 'you are an editor' : 'you are a reader: read only'}</div></div></div>
        <span class="grow"></span><span class="lab-people">${d.people.slice(0, 8).map(p => av(p.id, p.name, 26)).join('')}${d.people.length > 8 ? `<span class="muted small">+${d.people.length - 8}</span>` : ''}</span>
        <button class="btn small" data-lpapers title="The group's papers in the library">📄 Papers</button><button class="btn small" data-ltable title="The group's review table">▦ Table</button>
        <button class="btn small" data-lsync title="Get the latest from the others now">⟳</button><button class="btn small" data-lexport title="Download the lab as a Markdown report (for a meeting, the minutes, a lab notebook)">⤓ Report</button></div>
      <div class="lab-tabs"><button data-lsub="ideas" class="${S.sub === 'ideas' ? 'on' : ''}">💡 Ideas & discussion <span class="lab-n">${d.posts.length || ''}</span></button>
        <button data-lsub="plans" class="${S.sub === 'plans' ? 'on' : ''}">✅ Plans & tasks <span class="lab-n">${open || ''}</span></button></div>
      ${S.sub === 'plans' ? plansHtml() : ideasHtml()}`;
  }

  /* ---------------------------------------------------- ideas */
  function postsShown() {
    const f = S.f, q = f.q.trim().toLowerCase();
    let P = S.data.posts.filter(p => (f.kind === 'all' || p.kind === f.kind) && (!f.tag || p.tags.includes(f.tag))
      && (!q || [p.title, p.body, p.name, ...p.tags, ...p.comments.map(c => c.body)].join(' ').toLowerCase().includes(q)));
    const last = p => [p.created, ...p.comments.map(c => c.created)].sort().pop() || '';
    if (f.sort === 'votes') P = P.slice().sort((a, b) => b.votes.length - a.votes.length || (b.created || '').localeCompare(a.created || ''));
    else if (f.sort === 'active') P = P.slice().sort((a, b) => last(b).localeCompare(last(a)));
    return [...P.filter(p => p.pinned), ...P.filter(p => !p.pinned)];
  }
  function ideasHtml() {
    const d = S.data, P = postsShown(), f = S.f;
    const counts = {}; d.posts.forEach(p => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    const tags = {}; d.posts.forEach(p => p.tags.forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
    const pinned = d.posts.filter(p => p.pinned), decisions = d.posts.filter(p => p.kind === 'decision').slice(0, 6);
    const top = d.posts.filter(p => p.votes.length).sort((a, b) => b.votes.length - a.votes.length).slice(0, 5);
    return `<div class="lab-ideas"><div class="lab-feed">
        ${W() ? (S.composing ? composerHtml() : `<button class="lab-new" data-lnew><span>${av(d.me, d.display_name, 30)}</span><span class="lab-new-ph">Share an idea, an experiment, a question, a result…</span><span class="btn small primary">＋ New post</span></button>`) : ''}
        <div class="lab-filters"><div class="lab-kinds"><button data-lkf="all" class="${f.kind === 'all' ? 'on' : ''}">All <span>${d.posts.length}</span></button>${KINDS.filter(([k]) => counts[k]).map(([k, i, l]) => `<button data-lkf="${k}" class="${f.kind === k ? 'on' : ''}">${i} ${l}s <span>${counts[k]}</span></button>`).join('')}</div>
          <span class="grow"></span>${f.tag ? `<button class="lab-tag on" data-ltag="">#${esc(f.tag)} ✕</button>` : ''}
          <input class="input lab-q" id="lab-q" placeholder="Search posts and comments…" value="${esc(f.q)}">
          <select class="input lab-sort" id="lab-sort"><option value="new" ${f.sort === 'new' ? 'selected' : ''}>Newest</option><option value="active" ${f.sort === 'active' ? 'selected' : ''}>Latest activity</option><option value="votes" ${f.sort === 'votes' ? 'selected' : ''}>Most supported 👍</option></select></div>
        <div class="lab-posts">${P.length ? P.map(postHtml).join('') : `<div class="lab-empty">${d.posts.length ? 'No post matches.' : `<div class="big">💡</div><h3>Nothing here yet</h3><p class="muted">${W() ? 'Write the first post: an idea for an experiment, a question for the group, a result to discuss…' : 'When the editors post ideas and results, they appear here.'}</p>`}</div>`}</div>
      </div>
      <div class="lab-side">
        ${pinned.length ? `<div class="lab-card"><h4>📌 Pinned</h4>${pinned.map(sideLink).join('')}</div>` : ''}
        ${decisions.length ? `<div class="lab-card"><h4>✅ Decisions</h4>${decisions.map(sideLink).join('')}</div>` : ''}
        ${top.length ? `<div class="lab-card"><h4>👍 Most supported</h4>${top.map(p => sideLink(p, `👍 ${p.votes.length}`)).join('')}</div>` : ''}
        ${Object.keys(tags).length ? `<div class="lab-card"><h4># Tags</h4><div class="lab-tagcloud">${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<button class="lab-tag ${f.tag === t ? 'on' : ''}" data-ltag="${esc(t)}">#${esc(t)} <span>${n}</span></button>`).join('')}</div></div>` : ''}
        <div class="lab-card lab-tip"><h4>Tip</h4><p class="muted small">Turn a post into work: <b>✅ Task</b> on a post creates a task linked to it in <i>Plans & tasks</i>. Record what the group agreed as a <b>Decision</b> – they are listed here and in the report.</p></div>
      </div></div>`;
  }
  const sideLink = (p, extra = '') => `<button class="lab-side-link" data-lgoto="${esc(p.id)}"><span>${K[p.kind]?.i || '💡'}</span><span>${esc(truncate(p.title || '(untitled)', 60))}</span>${extra ? `<span class="muted small">${extra}</span>` : ''}</button>`;
  function postHtml(p) {
    const open = S.open.has(p.id), editing = S.composing?.id === p.id;
    if (editing) return composerHtml();
    const long = (p.body || '').length > 600 || (p.body || '').split('\n').length > 10;
    return `<article class="lp k-${p.kind} ${p.pinned ? 'pinned' : ''}" data-post="${esc(p.id)}">
      <div class="lp-head"><span class="lp-kind">${K[p.kind]?.i || '💡'} ${K[p.kind]?.l || 'Post'}</span>${p.pinned ? '<span class="lp-pin" title="Pinned">📌 Pinned</span>' : ''}<span class="grow"></span>
        <span class="lp-meta">${av(p.by, p.name, 22)}<b>${esc(p.mine ? `${p.name} (you)` : p.name)}</b><span class="muted" title="${esc(new Date(p.created).toLocaleString())}${p.at && p.at !== p.created ? ' · edited ' + esc(new Date(p.at).toLocaleString()) : ''}">· ${esc(ago(p.created))}${p.at && p.at !== p.created ? ' · edited' : ''}</span></span></div>
      ${p.title ? `<h3 class="lp-title">${esc(p.title)}</h3>` : ''}
      ${p.body ? `<div class="lp-body md ${long && !open ? 'clamp' : ''}">${md(p.body)}</div>${long && !open ? '<button class="linklike small" data-lmore>Show more</button>' : ''}` : ''}
      ${p.tags.length || p.papers.length ? `<div class="lp-links">${p.tags.map(t => `<button class="lab-tag" data-ltag="${esc(t)}">#${esc(t)}</button>`).join('')}${p.papers.map(x => `<button class="lab-paper" ${x.paper_id ? `data-lpaper="${x.paper_id}"` : 'disabled'} title="${esc(x.title)}">📄 ${esc(truncate(x.title, 60))}</button>`).join('')}</div>` : ''}
      <div class="lp-acts">
        <button class="lp-a ${p.voted ? 'on' : ''}" data-lvote ${W() ? '' : 'disabled'} title="${p.votes.length ? 'Supported by ' + esc(p.votes.map(v => v.name).join(', ')) : 'Support it'}">👍 ${p.votes.length || ''}</button>
        <button class="lp-a ${open ? 'on' : ''}" data-lcom>💬 ${p.comments.length ? plural(p.comments.length, 'comment') : 'Comment'}</button>
        ${p.tasks ? `<button class="lp-a" data-ltasks title="Tasks linked to this post">✅ ${plural(p.tasks, 'task')}</button>` : ''}
        <span class="grow"></span>
        ${W() ? `<button class="lp-a" data-lmktask title="Create a task linked to this post">＋ Task</button><button class="lp-a" data-lpin title="${p.pinned ? 'Unpin' : 'Pin it at the top for everybody'}">📌</button>` : ''}
        ${p.mine && W() ? '<button class="lp-a" data-ledit title="Edit">✎</button><button class="lp-a" data-ldel title="Delete for everybody">🗑</button>' : ''}</div>
      ${open ? commentsHtml(p) : ''}</article>`;
  }
  function commentsHtml(p) {
    return `<div class="lp-comments">${p.comments.map(c => `<div class="lc ${c.mine ? 'mine' : ''}" data-cid="${esc(c.id)}">${av(c.by, c.name, 26)}<div class="lc-box">
        <div class="lc-meta"><b>${esc(c.mine ? `${c.name} (you)` : c.name)}</b><span class="muted">${esc(ago(c.created))}${c.at && c.at !== c.created ? ' · edited' : ''}</span><span class="grow"></span>${c.mine && W() ? '<button data-lcedit title="Edit">✎</button><button data-lcdel title="Delete">🗑</button>' : ''}</div>
        ${S.focus === 'c:' + c.id ? `<textarea class="input lc-edit" rows="2">${esc(c.body)}</textarea><div class="lc-foot"><button class="linklike small" data-lccancel>Cancel</button><button class="btn small primary" data-lcsave>Save</button></div>` : `<div class="lc-body md">${md(c.body)}</div>`}</div></div>`).join('')}
      ${W() ? `<div class="lc-new">${av(S.data.me, S.data.display_name, 26)}<textarea class="input lc-text" rows="1" placeholder="Write a comment… (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send)"></textarea><button class="btn small primary" data-lcsend>Comment</button></div>` : ''}</div>`;
  }
  function composerHtml() {
    const c = S.composing, papers = c.papers.map(id => paperById(id)).filter(Boolean);
    return `<div class="lab-composer lab-card" data-composer>
      <div class="lcp-kinds">${KINDS.map(([k, i, l]) => `<button data-lkind="${k}" class="${c.kind === k ? 'on' : ''}">${i} ${l}</button>`).join('')}</div>
      <input class="input lcp-title" id="lc-title" maxlength="200" placeholder="Title – e.g. “Silence V1 during the task with optogenetics”" value="${esc(c.title)}">
      <textarea class="input lcp-body" id="lc-body" rows="6" placeholder="${esc(HINT[c.kind] || '')}  Markdown works: **bold**, - lists, > quotes, ==highlight==">${esc(c.body)}</textarea>
      <div class="lcp-row"><input class="input" id="lc-tags" placeholder="Tags, separated by commas – e.g. opto, V1, pilot" value="${esc(c.tags.join(', '))}">
        <button class="btn small" data-lpick>📄 Link papers${papers.length ? ` (${papers.length})` : ''}</button></div>
      ${papers.length ? `<div class="lp-links">${papers.map(p => `<span class="lab-paper">📄 ${esc(truncate(p.title || 'Untitled', 60))}<button data-lunlink="${p.id}" title="Remove the link">✕</button></span>`).join('')}</div>` : ''}
      <div class="lc-foot"><span class="muted small">🌐 Everyone in the group sees it, signed with your name</span><span class="grow"></span>
        <button class="btn" data-lcancel>Cancel</button><button class="btn primary" data-lsave>${c.id ? 'Save changes' : 'Post'}</button></div></div>`;
  }
  function readComposer() {
    const c = S.composing; if (!c) return;
    const v = id => $(id, main())?.value;
    if ($('#lc-title', main())) { c.title = v('#lc-title'); c.body = v('#lc-body'); c.tags = (v('#lc-tags') || '').split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean); }
  }
  async function savePost() {
    readComposer(); const c = S.composing;
    if (!c.title.trim() && !c.body.trim()) { toast('Write a title or a text first.'); $('#lc-title', main())?.focus(); return; }
    if (!(await Notes.ensureName())) return;
    const body = {kind: c.kind, title: c.title, body: c.body, tags: c.tags, paper_ids: c.papers};
    const d = await call(c.id ? `/posts/${encodeURIComponent(c.id)}` : '/posts', {method: c.id ? 'PUT' : 'POST', body});
    if (d) { S.composing = null; render(); toast(c.id ? 'Post updated.' : 'Posted – the group will see it at their next update.', 'ok'); }
  }
  function pickPapers() {
    readComposer();
    const all = state.papers.filter(p => (p.share_ids || []).includes(S.sid));
    if (!all.length) { toast('This group has no papers yet.'); return; }
    const sel = new Set(S.composing.papers);
    const m = modal(`<h3>Link papers of the group</h3><input class="input wide" id="lk-q" placeholder="Search…">
      <div class="lk-list">${all.map(p => `<label class="opt lk-opt" data-t="${esc((p.title + ' ' + (p.authors_text || '') + ' ' + (p.year || '')).toLowerCase())}"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}><span>${esc(truncate(p.title || 'Untitled', 110))}<small>${esc([p.authors_text ? truncate(p.authors_text, 60) : '', p.year].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="lk-ok">Link</button></div>`);
    $('#lk-q', m.el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.lk-opt', m.el).forEach(o => { o.style.display = o.dataset.t.includes(q) ? '' : 'none'; }); };
    $('#lk-ok', m.el).onclick = () => { S.composing.papers = $$('.lk-opt input:checked', m.el).map(i => +i.value).slice(0, 20); m.close(); render(); };
  }

  /* ---------------------------------------------------- plans & tasks */
  function plansHtml() {
    const d = S.data;
    const T = d.tasks.filter(t => (S.plan === 'all' || (t.plan || '') === (S.plan === 'none' ? '' : S.plan)) && (!S.mine || t.mine));
    const prog = id => { const ts = d.tasks.filter(t => (t.plan || '') === id); const done = ts.filter(t => t.status === 'done').length; return {n: ts.length, done, pct: ts.length ? Math.round(100 * done / ts.length) : 0}; };
    const noPlan = d.tasks.filter(t => !t.plan).length;
    return `<div class="lab-plans">
      <div class="lab-planbar">
        <button class="lab-plan ${S.plan === 'all' ? 'on' : ''}" data-lplan="all"><b>All tasks</b><span class="muted small">${plural(d.tasks.length, 'task')}</span></button>
        ${d.plans.map(pl => { const g = prog(pl.id); return `<div class="lab-plan ${S.plan === pl.id ? 'on' : ''} ${dueCls(pl.due, g.n && g.done === g.n ? 'done' : '')}" data-lplan="${esc(pl.id)}" title="${esc(pl.goal || '')}">
            <div class="lab-plan-h"><b>${esc(pl.name)}</b>${W() ? `<button class="lab-plan-ed" data-lplanedit="${esc(pl.id)}" title="Edit the plan">✎</button>` : ''}</div>
            <div class="lab-prog"><span style="width:${g.pct}%"></span></div>
            <span class="muted small">${g.done}/${g.n} done${pl.due ? ` · 📅 ${esc(dueTxt(pl.due))}` : ''}</span></div>`; }).join('')}
        ${noPlan && d.plans.length ? `<button class="lab-plan ${S.plan === 'none' ? 'on' : ''}" data-lplan="none"><b>Without a plan</b><span class="muted small">${plural(noPlan, 'task')}</span></button>` : ''}
        ${W() ? '<button class="lab-plan add" data-lnewplan>＋ Plan<span class="muted small">a milestone, a project, an experiment series</span></button>' : ''}
      </div>
      <div class="lab-boardbar">${S.plan !== 'all' && S.plan !== 'none' ? (() => { const pl = d.plans.find(x => x.id === S.plan); return pl?.goal ? `<div class="lab-goal">🎯 ${esc(pl.goal)}</div>` : ''; })() : ''}
        <span class="grow"></span><label class="lab-mine"><input type="checkbox" id="lab-mine" ${S.mine ? 'checked' : ''}> Only mine</label>
        ${W() ? '<button class="btn small primary" data-lnewtask>＋ Task</button>' : ''}</div>
      <div class="lab-board">${STATUS.map(([st, label]) => { const col = T.filter(t => t.status === st); return `<div class="lab-col" data-col="${st}">
          <div class="lab-col-h"><b>${label}</b><span class="lab-n">${col.length}</span>${W() && st !== 'done' ? `<button class="lab-col-add" data-lnewtask="${st}" title="Add a task here">＋</button>` : ''}</div>
          <div class="lab-col-list">${col.map(taskCard).join('') || `<div class="lab-col-empty muted small">${st === 'todo' ? (W() ? 'Add a task with ＋' : 'Nothing to do') : st === 'doing' ? 'Drag a task here when you start it' : 'Finished tasks land here'}</div>`}</div></div>`; }).join('')}</div>
      ${!d.tasks.length ? `<p class="muted small lab-board-hint">Plans are milestones (e.g. <i>Pilot study – by 20 Dec</i>); tasks are the steps (<i>Order the virus</i>, <i>Write the ethics form</i>, <i>Present Smith 2024 at journal club</i>), each with who does it and by when. Drag the cards between the columns.</p>` : ''}
    </div>`;
  }
  function taskCard(t) {
    const pl = S.data.plans.find(x => x.id === t.plan);
    return `<div class="lab-task prio-${t.prio} ${t.mine ? 'mine' : ''}" data-task="${esc(t.id)}" ${W() ? 'draggable="true"' : ''}>
      <div class="lab-task-t">${t.prio === 'high' ? '<span class="lab-prio" title="High priority">❗</span>' : ''}${esc(t.title)}</div>
      ${t.notes ? `<div class="lab-task-n muted small">${esc(truncate(t.notes, 110))}</div>` : ''}
      <div class="lab-task-m">${t.assignee ? av(t.assignee, t.assignee_name, 20) + `<span class="small">${esc(t.mine ? 'You' : t.assignee_name)}</span>` : '<span class="muted small">Unassigned</span>'}
        <span class="grow"></span>${t.due ? `<span class="lab-due ${dueCls(t.due, t.status)}">📅 ${esc(dueTxt(t.due))}</span>` : ''}</div>
      ${pl || t.paper || t.post ? `<div class="lab-task-l">${pl && S.plan === 'all' ? `<span class="lab-chip">${esc(truncate(pl.name, 28))}</span>` : ''}${t.paper ? '<span class="lab-chip" title="' + esc(t.paper.title) + '">📄</span>' : ''}${t.post ? `<span class="lab-chip" title="${esc(t.post_title)}">💬</span>` : ''}</div>` : ''}</div>`;
  }
  function taskDialog(t = null, preset = {}) {
    const d = S.data, w = W(), x = t || {title: '', notes: '', status: 'todo', prio: 'normal', assignee: '', due: '', plan: S.plan !== 'all' && S.plan !== 'none' ? S.plan : '', ...preset};
    const papers = state.papers.filter(p => (p.share_ids || []).includes(S.sid));
    const ro = w ? '' : 'disabled';
    const m = modal(`<h3>${t ? (w ? 'Task' : 'Task (read only)') : 'New task'}</h3>
      <div class="fld"><label>What has to be done</label><input class="input" id="tk-title" maxlength="300" value="${esc(x.title)}" placeholder="e.g. Order the virus" ${ro}></div>
      <div class="fld"><label>Details <span class="muted small">(optional)</span></label><textarea class="input" id="tk-notes" rows="3" ${ro} placeholder="Steps, links, what “done” means…">${esc(x.notes || '')}</textarea></div>
      <div class="tk-grid">
        <div class="fld"><label>Who</label><select class="input" id="tk-who" ${ro}><option value="">Nobody yet</option>${d.people.map(p => `<option value="${esc(p.id)}" ${x.assignee === p.id ? 'selected' : ''}>${esc(p.id === d.me ? `${p.name} (you)` : p.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>By when</label><input class="input" type="date" id="tk-due" value="${esc(x.due || '')}" ${ro}></div>
        <div class="fld"><label>Status</label><select class="input" id="tk-status" ${ro}>${STATUS.map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="fld"><label>Priority</label><select class="input" id="tk-prio" ${ro}><option value="high" ${x.prio === 'high' ? 'selected' : ''}>❗ High</option><option value="normal" ${x.prio !== 'high' && x.prio !== 'low' ? 'selected' : ''}>Normal</option><option value="low" ${x.prio === 'low' ? 'selected' : ''}>Low</option></select></div>
        <div class="fld"><label>Plan</label><select class="input" id="tk-plan" ${ro}><option value="">No plan</option>${d.plans.map(pl => `<option value="${esc(pl.id)}" ${x.plan === pl.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select></div>
        <div class="fld"><label>Paper <span class="muted small">(optional)</span></label><select class="input" id="tk-paper" ${ro}><option value="">None</option>${papers.map(p => `<option value="${p.id}" ${x.paper?.paper_id === p.id || preset.paper_id === p.id ? 'selected' : ''}>${esc(truncate(p.title || 'Untitled', 70))}</option>`).join('')}</select></div>
      </div>
      ${x.post ? `<p class="small">💬 Linked to the post <button class="linklike" id="tk-post">${esc(x.post_title || d.posts.find(p => p.id === x.post)?.title || 'a post')}</button></p>` : ''}
      ${t ? `<p class="muted small">Created by ${esc(t.by_name || t.by || '')}${t.created ? ' · ' + esc(ago(t.created)) : ''}</p>` : ''}
      <div class="modal-actions">${t && w ? '<button class="btn danger-soft" id="tk-del">🗑 Delete</button>' : ''}<span class="grow"></span><button class="btn" data-close>${w ? 'Cancel' : 'Close'}</button>${w ? `<button class="btn primary" id="tk-save">${t ? 'Save' : 'Add task'}</button>` : ''}</div>`, {nofocus: !w});
    if (w) setTimeout(() => $('#tk-title', m.el)?.focus(), 30);
    $('#tk-post', m.el)?.addEventListener('click', () => { m.close(); S.sub = 'ideas'; S.open.add(x.post); render(); const el = $(`[data-post="${CSS.escape(x.post)}"]`, main()); if (el) { el.scrollIntoView({block: 'center'}); flash(el); } });
    $('#tk-del', m.el)?.addEventListener('click', async () => {
      if (!(await confirmBox('Delete this task?', 'It is deleted for everybody in the group.', {ok: 'Delete', danger: true}))) return;
      if (await call(`/tasks/${encodeURIComponent(t.id)}`, {method: 'DELETE'})) m.close();
    });
    $('#tk-save', m.el)?.addEventListener('click', async () => {
      const v = id => $(id, m.el).value;
      const body = {title: v('#tk-title').trim(), notes: v('#tk-notes'), assignee: v('#tk-who'), due: v('#tk-due'), status: v('#tk-status'), prio: v('#tk-prio'), plan: v('#tk-plan'), paper_id: v('#tk-paper') ? +v('#tk-paper') : ''};
      if (!body.title) { toast('Write what has to be done.'); $('#tk-title', m.el).focus(); return; }
      if (!t && x.post) body.post = x.post;
      if (await call(t ? `/tasks/${encodeURIComponent(t.id)}` : '/tasks', {method: t ? 'PUT' : 'POST', body})) { m.close(); if (!t) toast('Task added.', 'ok'); }
    });
    m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#tk-save', m.el)?.click(); });
  }
  function planDialog(pl = null) {
    const m = modal(`<h3>${pl ? 'Plan' : 'New plan'}</h3>
      <div class="fld"><label>Name</label><input class="input" id="pl-name" maxlength="120" value="${esc(pl?.name || '')}" placeholder="e.g. Pilot study, Paper revision, Grant application"></div>
      <div class="fld"><label>Goal <span class="muted small">(optional)</span></label><textarea class="input" id="pl-goal" rows="3" placeholder="What the plan should achieve">${esc(pl?.goal || '')}</textarea></div>
      <div class="fld"><label>Deadline <span class="muted small">(optional)</span></label><input class="input" type="date" id="pl-due" value="${esc(pl?.due || '')}"></div>
      <div class="modal-actions">${pl ? '<button class="btn danger-soft" id="pl-del">🗑 Delete</button>' : ''}<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pl-save">${pl ? 'Save' : 'Create plan'}</button></div>`);
    setTimeout(() => $('#pl-name', m.el)?.focus(), 30);
    $('#pl-del', m.el)?.addEventListener('click', async () => {
      const n = S.data.tasks.filter(t => t.plan === pl.id).length;
      if (!(await confirmBox(`Delete the plan “${pl.name}”?`, n ? `Its ${plural(n, 'task')} stay, without a plan.` : 'It is deleted for everybody.', {ok: 'Delete', danger: true}))) return;
      if (await call(`/plans/${encodeURIComponent(pl.id)}`, {method: 'DELETE'})) { if (S.plan === pl.id) S.plan = 'all'; m.close(); render(); }
    });
    $('#pl-save', m.el).addEventListener('click', async () => {
      const body = {name: $('#pl-name', m.el).value.trim(), goal: $('#pl-goal', m.el).value, due: $('#pl-due', m.el).value};
      if (!body.name) { $('#pl-name', m.el).focus(); return; }
      const d = await call(pl ? `/plans/${encodeURIComponent(pl.id)}` : '/plans', {method: pl ? 'PUT' : 'POST', body});
      if (d) { m.close(); if (!pl) { const np = d.plans.find(x => x.name === body.name && !S.data.tasks.some(t => t.plan === x.id)); if (np) { S.plan = np.id; render(); } } }
    });
  }

  /* ------------------------------------------------------------------ events */
  function bind() {
    const el = main();
    el.addEventListener('click', async e => {
      const t = e.target;
      const lg = t.closest('[data-lg]'); if (lg) { go(lg.dataset.lg); return; }
      if (t.closest('[data-lnewgroup]')) { Shares.newDialog?.(); return; }
      if (t.closest('[data-ljoin]')) { Shares.joinDialog?.(); return; }
      const ov = t.closest('[data-ovtask], [data-ovpost], [data-ovdone]');
      if (ov) {
        const [sid, id] = (ov.dataset.ovtask || ov.dataset.ovpost || ov.dataset.ovdone).split('|');
        if (ov.dataset.ovdone) {
          ov.classList.add('on');
          try { await api(`/api/shares/${encodeURIComponent(sid)}/lab/tasks/${encodeURIComponent(id)}`, {method: 'PUT', body: {status: 'done'}}); toast('Task done. ✓', 'ok'); } catch (err) { toast(err.message, 'error'); }
          await load(); render(); return;
        }
        openGroup(sid, ov.dataset.ovtask ? {task: id} : {post: id}); return;
      }
      if (!S.data) return;
      const sub = t.closest('[data-lsub]'); if (sub) { S.sub = sub.dataset.lsub; save(); render(); return; }
      if (t.closest('[data-lpapers]')) { setTab('library'); setView({type: 'share', id: S.sid}); return; }
      if (t.closest('[data-ltable]')) { setTab('library'); setView({type: 'share', id: S.sid}); setMode('table'); return; }
      if (t.closest('[data-lsync]')) { const b = t.closest('[data-lsync]'); b.disabled = true; await Shares.syncNow(S.sid); await load(); render(); return; }
      if (t.closest('[data-lexport]')) { const a = document.createElement('a'); a.href = `/api/shares/${sidQ()}/lab/export`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Report saved in your Downloads (Markdown).', 'ok'); return; }
      // ideas
      if (t.closest('[data-lnew]')) { S.composing = {id: null, kind: 'idea', title: '', body: '', tags: [], papers: []}; render(); return; }
      const kb = t.closest('[data-lkind]'); if (kb) { readComposer(); S.composing.kind = kb.dataset.lkind; render(); $('#lc-body', main())?.focus(); return; }
      if (t.closest('[data-lpick]')) { pickPapers(); return; }
      const ul = t.closest('[data-lunlink]'); if (ul) { readComposer(); S.composing.papers = S.composing.papers.filter(id => id !== +ul.dataset.lunlink); render(); return; }
      if (t.closest('[data-lcancel]')) { readComposer(); const c = S.composing; if ((c.title || c.body) && !c.id && !(await confirmBox('Discard this post?', 'What you wrote has not been posted.', {ok: 'Discard', danger: true}))) return; S.composing = null; render(); return; }
      if (t.closest('[data-lsave]')) { savePost(); return; }
      const kf = t.closest('[data-lkf]'); if (kf) { S.f.kind = kf.dataset.lkf; render(); return; }
      const tg = t.closest('[data-ltag]'); if (tg) { S.f.tag = S.f.tag === tg.dataset.ltag ? '' : tg.dataset.ltag; render(); return; }
      const lp = t.closest('[data-lpaper]'); if (lp) { const id = +lp.dataset.lpaper; setTab('library'); setView({type: 'share', id: S.sid}); openDetail(id); return; }
      const gt = t.closest('[data-lgoto]'); if (gt) { S.f = {kind: 'all', tag: '', q: '', sort: S.f.sort}; S.open.add(gt.dataset.lgoto); render(); const a = $(`[data-post="${CSS.escape(gt.dataset.lgoto)}"]`, main()); if (a) { a.scrollIntoView({block: 'center'}); flash(a); } return; }
      const art = t.closest('[data-post]');
      if (art) {
        const p = S.data.posts.find(x => x.id === art.dataset.post); if (!p) return;
        const q = `/posts/${encodeURIComponent(p.id)}`;
        if (t.closest('[data-lmore]')) { S.open.add(p.id); render(); return; }
        if (t.closest('[data-lcom]')) { S.open.has(p.id) ? S.open.delete(p.id) : S.open.add(p.id); render(); if (S.open.has(p.id)) $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main())?.focus(); return; }
        if (t.closest('[data-lvote]')) { call(`${q}/vote`, {method: 'POST', body: {v: !p.voted}}); return; }
        if (t.closest('[data-lpin]')) { call(`${q}/pin`, {method: 'POST', body: {v: !p.pinned}}); return; }
        if (t.closest('[data-lmktask]')) { S.sub = 'plans'; save(); render(); taskDialog(null, {title: p.title || truncate(p.body || '', 80), post: p.id, post_title: p.title}); return; }
        if (t.closest('[data-ltasks]')) { S.sub = 'plans'; S.plan = 'all'; save(); render(); return; }
        if (t.closest('[data-ledit]')) { S.composing = {id: p.id, kind: p.kind, title: p.title, body: p.body, tags: [...p.tags], papers: p.papers.map(x => x.paper_id).filter(Boolean)}; render(); return; }
        if (t.closest('[data-ldel]')) { if (await confirmBox('Delete this post?', 'It is deleted for everybody in the group, with its comments.', {ok: 'Delete', danger: true})) call(q, {method: 'DELETE'}); return; }
        if (t.closest('[data-lcsend]')) { sendComment(art, p); return; }
        const lc = t.closest('[data-cid]');
        if (lc) {
          const cq = `/comments/${encodeURIComponent(lc.dataset.cid)}`;
          if (t.closest('[data-lcedit]')) { S.focus = 'c:' + lc.dataset.cid; render(); $('.lc-edit', main())?.focus(); return; }
          if (t.closest('[data-lccancel]')) { S.focus = null; render(); return; }
          if (t.closest('[data-lcsave]')) { const body = $('.lc-edit', lc).value.trim(); if (!body) return; if (await call(cq, {method: 'PUT', body: {body}})) { S.focus = null; render(); } return; }
          if (t.closest('[data-lcdel]')) { if (await confirmBox('Delete your comment?', 'It is deleted for everybody.', {ok: 'Delete', danger: true})) call(cq, {method: 'DELETE'}); return; }
        }
        return;
      }
      // plans
      const pe = t.closest('[data-lplanedit]'); if (pe) { e.stopPropagation(); planDialog(S.data.plans.find(x => x.id === pe.dataset.lplanedit)); return; }
      const pb = t.closest('[data-lplan]'); if (pb) { S.plan = pb.dataset.lplan; render(); return; }
      if (t.closest('[data-lnewplan]')) { planDialog(); return; }
      const nt = t.closest('[data-lnewtask]'); if (nt) { taskDialog(null, nt.dataset.lnewtask ? {status: nt.dataset.lnewtask} : {}); return; }
      const tk = t.closest('[data-task]'); if (tk) { const x = S.data.tasks.find(y => y.id === tk.dataset.task); if (x) taskDialog(x); }
    });
    el.addEventListener('input', e => {
      if (e.target.id === 'lab-q') { S.f.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#lab-q', main()); q.focus(); q.setSelectionRange(pos, pos); }
      if (e.target.matches('.lc-text, .lc-edit')) { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 220) + 'px'; }
    });
    el.addEventListener('change', e => {
      if (e.target.id === 'lab-sort') { S.f.sort = e.target.value; render(); }
      if (e.target.id === 'lab-mine') { S.mine = e.target.checked; render(); }
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (e.target.matches('.lc-text')) { e.preventDefault(); const art = e.target.closest('[data-post]'); sendComment(art, S.data.posts.find(x => x.id === art.dataset.post)); }
        else if (e.target.matches('.lc-edit')) { e.preventDefault(); e.target.closest('.lc').querySelector('[data-lcsave]').click(); }
        else if (e.target.closest('[data-composer]')) { e.preventDefault(); savePost(); }
      }
    });
    // drag the tasks between the columns
    let drag = null;
    el.addEventListener('dragstart', e => { const tk = e.target.closest?.('[data-task]'); if (!tk || !W()) return; drag = tk.dataset.task; tk.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); });
    el.addEventListener('dragend', e => { e.target.closest?.('[data-task]')?.classList.remove('dragging'); $$('.lab-col.over', el).forEach(c => c.classList.remove('over')); drag = null; });
    el.addEventListener('dragover', e => { const col = e.target.closest('.lab-col'); if (!col || !drag) return; e.preventDefault(); $$('.lab-col.over', el).forEach(c => c !== col && c.classList.remove('over')); col.classList.add('over'); });
    el.addEventListener('drop', async e => {
      const col = e.target.closest('.lab-col'); if (!col || !drag) return; e.preventDefault();
      const id = drag, st = col.dataset.col; drag = null; col.classList.remove('over');
      const tk = S.data.tasks.find(x => x.id === id); if (!tk || tk.status === st) return;
      const cards = $$('.lab-task', col).filter(c => c.dataset.task !== id);
      const after = cards.find(c => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
      const P = S.data.tasks.filter(x => x.status === st).map(x => x.pos || 0);
      const pos = after ? (S.data.tasks.find(x => x.id === after.dataset.task)?.pos || 0) - 0.5 : (P.length ? Math.max(...P) + 1 : 1);
      tk.status = st; render();   // at once, then saved
      call(`/tasks/${encodeURIComponent(id)}`, {method: 'PUT', body: {status: st, pos}});
    });
  }
  async function sendComment(art, p) {
    const ta = $('.lc-text', art), body = ta?.value.trim(); if (!body) { ta?.focus(); return; }
    if (!(await Notes.ensureName())) return;
    ta.disabled = true; ta.value = '';
    const d = await call(`/posts/${encodeURIComponent(p.id)}/comments`, {method: 'POST', body: {body}});
    if (!d) { const t2 = $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main()); if (t2) { t2.disabled = false; t2.value = body; } return; }
    $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main())?.focus();
  }
  async function refresh() { if (state.tab === 'lab') { await load(); render(); } }

  document.addEventListener('DOMContentLoaded', () => { if (main()) bind(); });
  return {show, openGroup, refresh, isOpen: () => state.tab === 'lab'};
})();
