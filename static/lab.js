'use strict';
/* PaperShelf – the Lab: the research space of each group, beyond single papers.
   Ideas & discussion: ideas, experiments, questions, results, decisions, protocols and notes, with
      comments, support, pins, tags and links to the group's papers. Each post belongs to its author.
   Plans & tasks: plans (a project or a milestone, with someone responsible) and tasks on a board
      (to do / doing / done). A task opens in its own window: the checklist and the notes of the group
      on the left, the settings (who, by when, priority, plan) on the right – everything is saved as
      you change it. Plans have notes too, and can start from a template (experiment, paper).
   Overview: your tasks in every group, the plans you lead, what was written for you.
   Everything lives in the group's file and travels with it (see sharing.py). Readers only read. */
const Lab = (() => {
  const S = {sid: null, sub: 'ideas', data: null, ov: null, open: new Set(), composing: null, cto: {},
    f: {kind: 'all', tag: '', q: '', sort: 'new'}, plan: 'all', mine: false, focus: null, pn: {}, tw: null};
  const TH = {};   // the note threads being written: {'task:<id>' | 'plan:<id>': {edit, to, draft}}
  try { const p = JSON.parse(localStorage.getItem('papershelf-lab') || '{}'); S.sid = p.sid || null; S.sub = p.sub === 'plans' ? 'plans' : 'ideas'; } catch { /* storage unavailable */ }
  let ORDER = 'auto'; try { ORDER = localStorage.getItem('papershelf-lab-order') === 'manual' ? 'manual' : 'auto'; } catch { /* ignore */ }
  const PR = {high: 0, normal: 1, low: 2};
  // the board's order: by deadline (the closest first, overdue on top, no date last), then priority
  const byDeadline = (a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due || '').localeCompare(b.due || '')
    || (PR[a.prio] ?? 1) - (PR[b.prio] ?? 1) || (a.created || '').localeCompare(b.created || '');
  const save = () => { try { localStorage.setItem('papershelf-lab', JSON.stringify({sid: S.sid, sub: S.sub})); } catch { /* ignore */ } };

  /* ------------------------------------------------------------------ icons (one line style) */
  const IC = {
    home: 'M3.5 10.5 12 3.5l8.5 7V20a.8.8 0 0 1-.8.8H15v-6H9v6H4.3a.8.8 0 0 1-.8-.8z',
    refresh: 'M20 11a8 8 0 0 0-14.6-3.5M4.5 4v4h4M4 13a8 8 0 0 0 14.6 3.5M19.5 20v-4h-4',
    download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
    file: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4',
    table: 'M4 5.5h16v13H4zM4 10.5h16M10 5.5v13',
    check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 12.3l2.4 2.4 4.6-5',
    checks: 'M4 6.6 5.5 8 8 5.4M4 12.6 5.5 14 8 11.4M4 18.6 5.5 20 8 17.4M11.5 7H20M11.5 13H20M11.5 19H20',
    message: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    calendar: 'M5 6h14v14H5zM5 10.5h14M9 3.5V7M15 3.5V7',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
    inbox: 'M4 13 6.5 5h11L20 13v6H4zM4 13h4.5l1 2.5h5l1-2.5H20',
    plus: 'M12 5v14M5 12h14',
    pencil: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    x: 'M6 6l12 12M18 6 6 18',
    bulb: 'M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
    flask: 'M9.5 3.5h5M10.5 3.5v5.2L5.3 17.6A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.7-2.9l-5.2-8.9V3.5M7.6 14.5h8.8',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2 1-1.2 1.8M12 16.8v.4',
    chart: 'M5 20V11M12 20V4M19 20v-7',
    compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    book: 'M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
    flag: 'M5.5 21V4M5.5 4.5h11l-2 3.8 2 3.7h-11',
    thumb: 'M7 11v9H4v-9zM7 11l3.8-6.8A1.9 1.9 0 0 1 14.3 5.4V9h4.3a2 2 0 0 1 2 2.4l-1.3 6.9a2 2 0 0 1-2 1.7H7',
    pin: 'M9 4h6l-1 6 3 3.5H7L10 10zM12 13.5V20',
    at: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.6 7.2',
    chevron: 'M9 6l6 6-6 6',
    hash: 'M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16',
  };
  const ic = (n, size = 16) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n] || ''}"/></svg>`;

  const KINDS = [['idea', 'bulb', 'Idea'], ['experiment', 'flask', 'Experiment'], ['question', 'help', 'Question'], ['result', 'chart', 'Result'],
    ['decision', 'check', 'Decision'], ['protocol', 'checks', 'Protocol'], ['note', 'pencil', 'Note']];
  const K = Object.fromEntries(KINDS.map(([k, i, l]) => [k, {i: ic(i, 15), l}]));
  const kindIc = k => K[k]?.i || K.idea.i;
  const STATUS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
  const HINT = {idea: 'A hypothesis, a new direction, something worth trying…', experiment: 'Design: question, conditions, n, measures, expected result…',
    question: 'Something the group should answer or discuss…', result: 'What came out: data, figure, effect size, what it means…',
    decision: 'What was decided, by whom, and why…', protocol: 'A method or a procedure the group follows…', note: 'Anything worth sharing with the group…'};
  // a plan can start with the usual steps of this kind of work (each step is a task, with a checklist)
  const TEMPLATES = {
    experiment: {what: 'an experiment', icon: 'flask', hint: 'Design, approvals, setup, pilot, data collection, analysis, write-up', tasks: [
      ['Design the experiment', ['Question and hypothesis', 'Conditions and controls', 'Sample size', 'Measures and analysis plan']],
      ['Approvals and ethics', ['Ethics or animal protocol', 'Data management plan']],
      ['Materials and setup', ['Order what is missing', 'Prepare and calibrate the setup', 'Write the protocol']],
      ['Pilot', ['Run the pilot', 'Check the data quality', 'Adjust the protocol']],
      ['Data collection', []],
      ['Analysis', ['Preprocessing', 'Statistics', 'Figures']],
      ['Write up and share', ['Summary of the results', 'Present to the group']]]},
    paper: {what: 'a paper', icon: 'file', hint: 'Outline, figures, sections, internal review, submission', tasks: [
      ['Outline and key message', ['One-sentence message', 'Figure list', 'Target journal']],
      ['Figures', []], ['Methods', []], ['Results', []], ['Introduction and discussion', []],
      ['Internal review', ['Comments of the co-authors', 'Proofreading', 'Check the references']],
      ['Submission', ['Cover letter', 'Format for the journal', 'Upload data and code']]]},
  };
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const av = (id, name, size = 24) => `<span class="lab-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.5)}px;background:hsl(${hue(id)} 42% 44%)" title="${esc(name || id)}">${esc(initials(name || id))}</span>`;
  const gdot = (id, name, color, cls = '') => `<span class="lab-g-dot ${cls}" style="background:${esc(color || `hsl(${hue(id)} 40% 46%)`)}">${esc(initials(name))}</span>`;
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
  const dueChip = (d, status) => d ? `<span class="lab-due ${dueCls(d, status)}" title="${dueCls(d, status) === 'overdue' ? 'Overdue' : 'Deadline'}">${ic('calendar', 13)}${esc(dueTxt(d))}</span>` : '';
  const prog = (done, n) => `<span class="lab-prog"><span style="width:${n ? Math.round(100 * done / n) : 0}%"></span></span>`;
  // the members as chips to click (who a task is for, who a post or a note is addressed to)
  const pplChips = (sel, {id = '', disabled = false} = {}) => `<div class="lab-ppl" ${id ? `id="${id}"` : ''}>${(S.data?.people || []).map(p =>
    `<button type="button" class="lab-pp ${sel.includes(p.id) ? 'on' : ''}" data-pp="${esc(p.id)}" ${disabled ? 'disabled' : ''}>${av(p.id, p.name, 18)}${esc(p.id === S.data.me ? `${p.name} (you)` : p.name)}</button>`).join('')}</div>`;
  const pplRead = box => box ? $$('.lab-pp.on', box).map(b => b.dataset.pp) : [];
  const pname = a => S.data?.people.find(p => p.id === a)?.name || a;
  const toLine = to => to?.length ? `<span class="lab-to ${to.some(x => x.me) ? 'me' : ''}" title="Addressed to ${esc(to.map(x => x.name).join(', '))}">for ${to.map(x => esc(x.me ? 'you' : x.name)).join(', ')}</span>` : '';
  const main = () => $('#lab-main');
  const groups = () => state.shares || [];
  const W = () => !!S.data?.can_write;
  const sidQ = () => encodeURIComponent(S.sid);
  const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  const thState = key => TH[key] || (TH[key] = {edit: null, to: null, draft: ''});

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
  async function openGroup(sid, {post = null, task = null, sub = null, plan = null} = {}) {
    if (state.tab !== 'lab') setTab('lab');
    await go(sid, sub || (task || plan ? 'plans' : post ? 'ideas' : null));
    if (plan && S.data?.plans.some(x => x.id === plan)) { S.plan = plan; S.pn[plan] = true; render(); }
    if (post) gotoPost(post);
    if (task && S.data?.tasks.some(x => x.id === task)) taskWindow(task);
  }
  const flash = el => { el.classList.add('lab-flash'); setTimeout(() => el.classList.remove('lab-flash'), 1600); };
  function gotoPost(id) {
    S.sub = 'ideas'; S.f = {kind: 'all', tag: '', q: '', sort: S.f.sort}; S.open.add(id); save(); render();
    const el = $(`[data-post="${CSS.escape(id)}"]`, main()); if (el) { el.scrollIntoView({block: 'center'}); flash(el); }
  }

  /* ------------------------------------------------------------------ page */
  function render() {
    const el = main(); if (!el) return;
    // keep what is being written (the page is redrawn after each change, also by the others' updates)
    if (S.composing) readComposer();
    const drafts = {}, foc = document.activeElement, inMain = !!foc && el.contains(foc);
    const focPost = inMain && foc.matches('.lc-text') ? foc.closest('[data-post]')?.dataset.post : null;
    const focTh = inMain && foc.matches('.th-text') ? foc.closest('.th')?.dataset.th : null;
    const quick = $('.lab-quick', el), quickVal = quick?.value || '', quickFoc = !!quick && foc === quick;
    $$('.lc-text', el).forEach(ta => { if (ta.value) drafts[ta.closest('[data-post]').dataset.post] = ta.value; });
    const scroll = el.scrollTop;
    const G = groups();
    const rail = `<nav class="lab-rail">
        <div class="lab-rail-h">Lab</div>
        <button class="lab-g ${S.sid ? '' : 'on'}" data-lg=""><span class="lab-g-ico">${ic('home', 17)}</span><span class="lab-g-name">Overview</span></button>
        <div class="lab-rail-sec">Groups</div>
        ${G.map(g => `<button class="lab-g ${S.sid === g.id ? 'on' : ''}" data-lg="${esc(g.id)}" title="${esc(g.name)}">${gdot(g.id, g.name, g.color)}<span class="lab-g-name">${esc(g.name)}<small>${g.role === 'member' ? 'Editor' : 'Reader'}, ${plural(g.papers, 'paper')}</small></span></button>`).join('')
          || '<div class="muted small lab-rail-empty">No groups yet.</div>'}
        <div class="lab-rail-acts"><button class="btn small" data-lnewgroup>${ic('plus', 14)}New group</button><button class="btn small" data-ljoin>Join</button></div>
      </nav>`;
    el.innerHTML = `<div class="lab">${rail}<section class="lab-body">${S.sid && S.data ? groupHtml() : overviewHtml()}</section></div>`;
    el.scrollTop = scroll;
    for (const [pid, v] of Object.entries(drafts)) { const ta = $(`[data-post="${CSS.escape(pid)}"] .lc-text`, el); if (ta) ta.value = v; }
    const q2 = $('.lab-quick', el); if (q2) { q2.value = quickVal; if (quickFoc) q2.focus(); }
    if (focPost) $(`[data-post="${CSS.escape(focPost)}"] .lc-text`, el)?.focus();
    else if (focTh) { const ta = $(`[data-th="${CSS.escape(focTh)}"] .th-text`, el); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
    else if (S.composing && !$('#lc-title', el)?.value && document.activeElement === document.body) $('#lc-title', el)?.focus();
    $$('.th-text', el).forEach(grow);
    S.tw?.paint();
  }
  const grow = ta => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; };

  /* ------------------------------------------------------------------ overview */
  function overviewHtml() {
    const ov = S.ov || {groups: [], my_tasks: []};
    if (!groups().length) return `<div class="lab-hero"><div class="lab-hero-ico">${ic('flask', 34)}</div><h2>The Lab of your groups</h2>
      <p>A shared space for the research of a group, beyond the notes on single papers.</p>
      <ul class="lab-hero-list"><li>${ic('bulb')}<span><b>Ideas and discussion</b>: ideas, experiments, questions, results and decisions, with comments</span></li>
        <li>${ic('checks')}<span><b>Plans and tasks</b>: what has to be done, by whom and by when, with checklists and notes</span></li>
        <li>${ic('home')}<span><b>Overview</b>: your tasks in every group and what happened this week</span></li></ul>
      <p class="muted">It works inside a group: create one, or join one with an invitation, and invite your colleagues.</p>
      <div class="lab-hero-acts"><button class="btn primary" data-lnewgroup>Create a group</button><button class="btn" data-ljoin>Join a group</button><button class="btn" data-help="lab">How it works</button></div></div>`;
    const mt = ov.my_tasks || [], mp = ov.my_plans || [], fm = ov.for_me || [];
    const sec = (icon, title, n, body) => `<section class="ov-sec"><h3>${ic(icon, 16)}<span>${title}</span>${n ? `<span class="lab-n">${n}</span>` : ''}</h3>${body}</section>`;
    return `<div class="lab-head"><div><h2>Overview</h2><div class="muted small">What is waiting for you, and what happened in your groups this week</div></div><span class="grow"></span><button class="btn small" data-help="lab">${ic('book', 15)}Guide</button></div>
      <div class="lab-ov">
        <div class="lab-card ov-mine">
          ${sec('check', 'My tasks', mt.length, mt.length ? mt.map(t => `<div class="ov-row ${dueCls(t.due, t.status)}"><button class="lab-check" data-ovdone="${esc(t.group)}|${esc(t.id)}" title="Mark it done" aria-label="Mark it done"></button>
              <button class="ov-main" data-ovtask="${esc(t.group)}|${esc(t.id)}"><span class="ov-t">${t.prio === 'high' ? `<span class="lab-prio" title="High priority">${ic('flag', 13)}</span>` : ''}${esc(t.title)}</span>
                <span class="ov-m"><span>${esc(t.group_name)}</span>${t.status === 'doing' ? '<span class="lab-chip doing">Doing</span>' : ''}${t.checks?.[1] ? `<span class="ov-i">${ic('checks', 13)}${t.checks[0]}/${t.checks[1]}</span>` : ''}${t.notes ? `<span class="ov-i">${ic('message', 13)}${t.notes}</span>` : ''}${dueChip(t.due, t.status)}</span></button></div>`).join('')
            : '<p class="muted small ov-empty">Nothing is assigned to you.</p>')}
          ${mp.length ? sec('compass', 'Plans you lead', 0, mp.map(p => `<div class="ov-row"><button class="ov-main" data-ovplan="${esc(p.group)}|${esc(p.id)}"><span class="ov-t">${esc(p.name)}</span>
              <span class="ov-m"><span>${esc(p.group_name)}</span><span class="ov-i">${prog(p.done, p.n)}${p.done}/${p.n} tasks</span>${dueChip(p.due, p.n && p.done === p.n ? 'done' : '')}</span></button></div>`).join('')) : ''}
          ${fm.length ? sec('inbox', 'Written for you', 0, fm.map(x => `<div class="ov-row"><button class="ov-main" data-ovpost="${esc(x.group)}|${esc(x.post)}"><span class="ov-t">${esc(x.name)} ${x.kind === 'post' ? 'wrote to you' : 'replied to you'}: ${esc(truncate(x.title || '', 60))}</span>
              <span class="ov-m">${x.excerpt ? `<span class="ov-q">“${esc(truncate(x.excerpt, 80))}”</span>` : ''}<span>${esc(x.group_name)}, ${esc(ago(x.created))}</span></span></button></div>`).join('')) : ''}
        </div>
        <div class="lab-gcards">${(ov.groups || []).map(g => `<section class="lab-card lab-gcard">
            <div class="lab-gc-h">${gdot(g.id, g.name, groups().find(x => x.id === g.id)?.color, 'big')}<div class="lab-gc-t"><h3>${esc(g.name)}</h3><div class="muted small">${plural(g.members, 'member')}, ${plural(g.papers, 'paper')}${g.can_write ? '' : ', you read only'}</div></div>
              <button class="btn small" data-lg="${esc(g.id)}">Open${ic('chevron', 14)}</button></div>
            <div class="lab-figs"><div><b>${g.open_tasks}</b><span>open tasks</span></div><div class="${g.overdue ? 'overdue' : ''}"><b>${g.overdue}</b><span>overdue</span></div><div><b>${g.done_tasks}</b><span>done</span></div><div><b>${g.posts_week + g.comments_week}</b><span>posts this week</span></div></div>
            ${g.latest.length ? `<div class="lab-gc-sec">Latest</div>${g.latest.map(p => `<button class="lab-gc-post k-${p.kind}" data-ovpost="${esc(g.id)}|${esc(p.id)}"><span class="lab-kic">${kindIc(p.kind)}</span><span class="lab-gc-pt">${esc(truncate(p.title || '(untitled)', 70))}</span><span class="lab-gc-m muted small">${esc(p.name)}, ${esc(ago(p.created))}${p.comments ? `<span class="ov-i">${ic('message', 13)}${p.comments}</span>` : ''}</span></button>`).join('')}` : '<p class="muted small lab-gc-none">Nothing posted yet.</p>'}
            ${g.decisions.length ? `<div class="lab-gc-sec">Decisions</div>${g.decisions.map(p => `<button class="lab-gc-post k-decision" data-ovpost="${esc(g.id)}|${esc(p.id)}"><span class="lab-kic">${kindIc('decision')}</span><span class="lab-gc-pt">${esc(truncate(p.title || 'Decision', 70))}</span><span class="lab-gc-m muted small">${esc(ago(p.created))}</span></button>`).join('')}` : ''}
          </section>`).join('')}</div>
      </div>`;
  }

  /* ------------------------------------------------------------------ a group */
  function groupHtml() {
    const d = S.data, g = groups().find(x => x.id === S.sid) || {name: d.group.name, papers: 0};
    const open = d.tasks.filter(t => t.status !== 'done').length;
    return `<div class="lab-head"><div class="lab-gh">${gdot(S.sid, d.group.name, g.color, 'big')}<div><h2>${esc(d.group.name)}</h2>
          <div class="muted small">${plural(d.people.length, 'member')}, ${plural(g.papers || 0, 'paper')}${W() ? '' : '. You are a reader: you can read, not write'}</div></div></div>
        <span class="grow"></span><span class="lab-people">${d.people.slice(0, 8).map(p => av(p.id, p.name, 26)).join('')}${d.people.length > 8 ? `<span class="muted small">+${d.people.length - 8}</span>` : ''}</span>
        <div class="lab-tools"><button class="btn small" data-lpapers title="The group's papers in the library">${ic('file', 15)}Papers</button><button class="btn small" data-ltable title="The group's review table">${ic('table', 15)}Table</button>
          <button class="btn small" data-lexport title="Download the lab as a Markdown report, for a meeting, the minutes or a lab notebook">${ic('download', 15)}Report</button>
          <button class="btn small" data-lsync title="Get the latest from the others now">${ic('refresh', 15)}Update</button></div></div>
      <div class="lab-tabs"><button data-lsub="ideas" class="${S.sub === 'ideas' ? 'on' : ''}">${ic('bulb', 16)}Ideas and discussion<span class="lab-n">${d.posts.length || ''}</span></button>
        <button data-lsub="plans" class="${S.sub === 'plans' ? 'on' : ''}">${ic('checks', 16)}Plans and tasks<span class="lab-n">${open || ''}</span></button></div>
      ${S.sub === 'plans' ? plansHtml() : ideasHtml()}`;
  }

  /* ---------------------------------------------------- ideas */
  function postsShown() {
    const f = S.f, q = f.q.trim().toLowerCase();
    const forMe = p => p.for_me || p.comments.some(c => c.for_me);
    let P = S.data.posts.filter(p => (f.kind === 'all' || (f.kind === 'forme' ? forMe(p) : p.kind === f.kind)) && (!f.tag || p.tags.includes(f.tag))
      && (!q || [p.title, p.body, p.name, ...p.tags, ...p.comments.map(c => c.body)].join(' ').toLowerCase().includes(q)));
    const last = p => [p.created, ...p.comments.map(c => c.created)].sort().pop() || '';
    if (f.sort === 'votes') P = P.slice().sort((a, b) => b.votes.length - a.votes.length || (b.created || '').localeCompare(a.created || ''));
    else if (f.sort === 'active') P = P.slice().sort((a, b) => last(b).localeCompare(last(a)));
    return [...P.filter(p => p.pinned), ...P.filter(p => !p.pinned)];
  }
  function ideasHtml() {
    const d = S.data, P = postsShown(), f = S.f;
    const counts = {}; d.posts.forEach(p => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    const nForMe = d.posts.filter(p => p.for_me || p.comments.some(c => c.for_me)).length;
    const tags = {}; d.posts.forEach(p => p.tags.forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
    const pinned = d.posts.filter(p => p.pinned), decisions = d.posts.filter(p => p.kind === 'decision').slice(0, 6);
    const top = d.posts.filter(p => p.votes.length).sort((a, b) => b.votes.length - a.votes.length).slice(0, 5);
    const side = (icon, title, body) => `<div class="lab-sidesec"><h4>${ic(icon, 14)}${title}</h4>${body}</div>`;
    return `<div class="lab-ideas"><div class="lab-feed">
        ${W() ? (S.composing && !S.composing.id ? composerHtml() : `<button class="lab-new" data-lnew>${av(d.me, d.display_name, 30)}<span class="lab-new-ph">Share an idea, an experiment, a question, a result…</span><span class="btn small primary">New post</span></button>`) : ''}
        <div class="lab-filters"><div class="lab-kinds"><button data-lkf="all" class="${f.kind === 'all' ? 'on' : ''}">All<span>${d.posts.length}</span></button>${nForMe ? `<button data-lkf="forme" class="forme ${f.kind === 'forme' ? 'on' : ''}" title="Posts and comments addressed to you">${ic('inbox', 14)}For you<span>${nForMe}</span></button>` : ''}${KINDS.filter(([k]) => counts[k]).map(([k, , l]) => `<button data-lkf="${k}" class="${f.kind === k ? 'on' : ''}">${kindIc(k)}${l}s<span>${counts[k]}</span></button>`).join('')}</div>
          <span class="grow"></span>${f.tag ? `<button class="lab-tag on" data-ltag="">#${esc(f.tag)} ✕</button>` : ''}
          <input class="input lab-q" id="lab-q" placeholder="Search posts" value="${esc(f.q)}">
          <select class="input lab-sort" id="lab-sort" title="Order of the posts"><option value="new" ${f.sort === 'new' ? 'selected' : ''}>Newest first</option><option value="active" ${f.sort === 'active' ? 'selected' : ''}>Latest activity</option><option value="votes" ${f.sort === 'votes' ? 'selected' : ''}>Most supported</option></select></div>
        <div class="lab-posts">${P.length ? P.map(postHtml).join('') : `<div class="lab-empty">${d.posts.length ? 'No post matches.' : `<div class="big">${ic('bulb', 30)}</div><h3>Nothing here yet</h3><p class="muted">${W() ? 'Write the first post: an idea for an experiment, a question for the group, a result to discuss.' : 'When the editors post ideas and results, they appear here.'}</p>`}</div>`}</div>
      </div>
      <div class="lab-side">
        ${pinned.length ? side('pin', 'Pinned', pinned.map(p => sideLink(p)).join('')) : ''}
        ${decisions.length ? side('check', 'Decisions', decisions.map(p => sideLink(p)).join('')) : ''}
        ${top.length ? side('thumb', 'Most supported', top.map(p => sideLink(p, p.votes.length)).join('')) : ''}
        ${Object.keys(tags).length ? side('hash', 'Tags', `<div class="lab-tagcloud">${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<button class="lab-tag ${f.tag === t ? 'on' : ''}" data-ltag="${esc(t)}">#${esc(t)}<span>${n}</span></button>`).join('')}</div>`) : ''}
        <p class="muted small lab-tip">Turn a post into work with <b>Make a task</b>: the task stays linked to the post. Record what the group agreed as a <b>Decision</b>, so it is easy to find later.</p>
      </div></div>`;
  }
  const sideLink = (p, extra = '') => `<button class="lab-side-link k-${p.kind}" data-lgoto="${esc(p.id)}"><span class="lab-kic">${kindIc(p.kind)}</span><span>${esc(truncate(p.title || '(untitled)', 60))}</span>${extra ? `<span class="muted small">${extra}</span>` : ''}</button>`;
  function postHtml(p) {
    const open = S.open.has(p.id), editing = S.composing?.id === p.id;
    if (editing) return composerHtml();
    const long = (p.body || '').length > 600 || (p.body || '').split('\n').length > 10;
    return `<article class="lp k-${p.kind} ${p.pinned ? 'pinned' : ''} ${p.for_me ? 'for-me' : ''}" data-post="${esc(p.id)}">
      <div class="lp-head"><span class="lp-kind">${kindIc(p.kind)}${K[p.kind]?.l || 'Post'}</span>${p.pinned ? `<span class="lp-pin" title="Pinned at the top">${ic('pin', 13)}Pinned</span>` : ''}${p.for_me ? `<span class="lab-foryou">${ic('inbox', 12)}For you</span>${p.to.length > 1 ? `<span class="lab-to">and ${esc(p.to.filter(x => !x.me).map(x => x.name).join(', '))}</span>` : ''}` : toLine(p.to)}<span class="grow"></span>
        <span class="lp-meta">${av(p.by, p.name, 22)}<b>${esc(p.mine ? 'You' : p.name)}</b><span class="muted" title="${esc(new Date(p.created).toLocaleString())}${p.at && p.at !== p.created ? ', edited ' + esc(new Date(p.at).toLocaleString()) : ''}">${esc(ago(p.created))}${p.at && p.at !== p.created ? ', edited' : ''}</span></span></div>
      ${p.title ? `<h3 class="lp-title">${esc(p.title)}</h3>` : ''}
      ${p.body ? `<div class="lp-body md ${long && !open ? 'clamp' : ''}">${md(p.body)}</div>${long && !open ? '<button class="linklike small" data-lmore>Show more</button>' : ''}` : ''}
      ${p.tags.length || p.papers.length ? `<div class="lp-links">${p.tags.map(t => `<button class="lab-tag" data-ltag="${esc(t)}">#${esc(t)}</button>`).join('')}${p.papers.map(x => `<button class="lab-paper" ${x.paper_id ? `data-lpaper="${x.paper_id}"` : 'disabled'} title="${esc(x.title)}">${ic('file', 13)}${esc(truncate(x.title, 60))}</button>`).join('')}</div>` : ''}
      <div class="lp-acts">
        <button class="lp-a ${p.voted ? 'on' : ''}" data-lvote ${W() ? '' : 'disabled'} title="${p.votes.length ? 'Supported by ' + esc(p.votes.map(v => v.name).join(', ')) : 'Support it'}">${ic('thumb', 15)}${p.votes.length || 'Support'}</button>
        <button class="lp-a ${open ? 'on' : ''}" data-lcom>${ic('message', 15)}${p.comments.length ? plural(p.comments.length, 'comment') : 'Comment'}</button>
        ${p.tasks ? `<button class="lp-a" data-ltasks title="Tasks linked to this post">${ic('checks', 15)}${plural(p.tasks, 'task')}</button>` : ''}
        <span class="grow"></span>
        ${W() ? `<button class="lp-a" data-lmktask title="Create a task linked to this post">${ic('plus', 14)}Make a task</button><button class="lp-a icon ${p.pinned ? 'on' : ''}" data-lpin title="${p.pinned ? 'Unpin' : 'Pin it at the top for everybody'}">${ic('pin', 15)}</button>` : ''}
        ${p.mine && W() ? `<button class="lp-a icon" data-ledit title="Edit">${ic('pencil', 15)}</button><button class="lp-a icon" data-ldel title="Delete for everybody">${ic('trash', 15)}</button>` : ''}</div>
      ${open ? commentsHtml(p) : ''}</article>`;
  }
  function commentsHtml(p) {
    const cto = S.cto[p.id];
    return `<div class="lp-comments">${p.comments.map(c => `<div class="lc ${c.mine ? 'mine' : ''} ${c.for_me ? 'for-me' : ''}" data-cid="${esc(c.id)}">${av(c.by, c.name, 26)}<div class="lc-box">
        <div class="lc-meta"><b>${esc(c.mine ? 'You' : c.name)}</b>${toLine(c.to)}<span class="muted">${esc(ago(c.created))}${c.at && c.at !== c.created ? ', edited' : ''}</span><span class="grow"></span>${c.mine && W() ? `<button data-lcedit title="Edit">${ic('pencil', 13)}</button><button data-lcdel title="Delete">${ic('trash', 13)}</button>` : ''}</div>
        ${S.focus === 'c:' + c.id ? `<textarea class="input lc-edit" rows="2">${esc(c.body)}</textarea><div class="lc-foot"><button class="linklike small" data-lccancel>Cancel</button><button class="btn small primary" data-lcsave>Save</button></div>` : `<div class="lc-body md">${md(c.body)}</div>`}</div></div>`).join('')}
      ${W() ? `<div class="lc-new">${av(S.data.me, S.data.display_name, 26)}<div class="lc-newbox"><textarea class="input lc-text" rows="1" placeholder="Write a comment (${MOD}+Enter to send)"></textarea>
          ${cto ? `<div class="lc-to-row"><span class="muted small">For</span>${pplChips(cto)}</div>` : ''}</div>
          <button class="btn small lab-at ${cto?.length ? 'on' : ''}" data-lcto title="Address the comment to someone: they get a notification">${ic('at', 15)}${cto?.length || ''}</button><button class="btn small primary" data-lcsend>Comment</button></div>` : ''}</div>`;
  }
  function composerHtml() {
    const c = S.composing, papers = c.papers.map(id => paperById(id)).filter(Boolean);
    return `<div class="lab-composer lab-card" data-composer>
      <div class="lcp-kinds">${KINDS.map(([k, , l]) => `<button data-lkind="${k}" class="${c.kind === k ? 'on' : ''}">${kindIc(k)}${l}</button>`).join('')}</div>
      <input class="input lcp-title" id="lc-title" maxlength="200" placeholder="Title, for example: Silence V1 during the task with optogenetics" value="${esc(c.title)}">
      <textarea class="input lcp-body" id="lc-body" rows="6" placeholder="${esc(HINT[c.kind] || '')}  Markdown works: **bold**, - lists, > quotes, ==highlight==">${esc(c.body)}</textarea>
      <div class="lcp-row"><input class="input" id="lc-tags" placeholder="Tags, separated by commas: opto, V1, pilot" value="${esc(c.tags.join(', '))}">
        <button class="btn small" data-lpick>${ic('file', 14)}Link papers${papers.length ? ` (${papers.length})` : ''}</button></div>
      ${papers.length ? `<div class="lp-links">${papers.map(p => `<span class="lab-paper">${ic('file', 13)}${esc(truncate(p.title || 'Untitled', 60))}<button data-lunlink="${p.id}" title="Remove the link">✕</button></span>`).join('')}</div>` : ''}
      <div class="lcp-to"><span class="muted small">For (optional, they get a notification)</span>${pplChips(c.to || [], {id: 'lc-to'})}</div>
      <div class="lc-foot"><span class="muted small">Everyone in the group sees it, signed with your name</span><span class="grow"></span>
        <button class="btn" data-lcancel>Cancel</button><button class="btn primary" data-lsave>${c.id ? 'Save changes' : 'Post'}</button></div></div>`;
  }
  function readComposer() {
    const c = S.composing; if (!c) return;
    const v = id => $(id, main())?.value;
    if ($('#lc-to', main())) c.to = pplRead($('#lc-to', main()));
    if ($('#lc-title', main())) { c.title = v('#lc-title'); c.body = v('#lc-body'); c.tags = (v('#lc-tags') || '').split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean); }
  }
  async function savePost() {
    readComposer(); const c = S.composing;
    if (!c.title.trim() && !c.body.trim()) { toast('Write a title or a text first.'); $('#lc-title', main())?.focus(); return; }
    if (!(await Notes.ensureName())) return;
    const body = {kind: c.kind, title: c.title, body: c.body, tags: c.tags, paper_ids: c.papers, to: c.to || []};
    const d = await call(c.id ? `/posts/${encodeURIComponent(c.id)}` : '/posts', {method: c.id ? 'PUT' : 'POST', body});
    if (d) { S.composing = null; render(); toast(c.id ? 'Post saved.' : 'Posted. The group sees it at their next update.', 'ok'); }
  }
  function pickPapers() {
    readComposer();
    const all = state.papers.filter(p => (p.share_ids || []).includes(S.sid));
    if (!all.length) { toast('This group has no papers yet.'); return; }
    const sel = new Set(S.composing.papers);
    const m = modal(`<h3>Link papers of the group</h3><input class="input wide" id="lk-q" placeholder="Search">
      <div class="lk-list">${all.map(p => `<label class="opt lk-opt" data-t="${esc((p.title + ' ' + (p.authors_text || '') + ' ' + (p.year || '')).toLowerCase())}"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}><span>${esc(truncate(p.title || 'Untitled', 110))}<small>${esc([p.authors_text ? truncate(p.authors_text, 60) : '', p.year].filter(Boolean).join(', '))}</small></span></label>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="lk-ok">Link</button></div>`);
    $('#lk-q', m.el).oninput = e => { const q = e.target.value.toLowerCase(); $$('.lk-opt', m.el).forEach(o => { o.style.display = o.dataset.t.includes(q) ? '' : 'none'; }); };
    $('#lk-ok', m.el).onclick = () => { S.composing.papers = $$('.lk-opt input:checked', m.el).map(i => +i.value).slice(0, 20); m.close(); render(); };
  }

  /* ---------------------------------------------------- notes on a task or a plan (a thread) */
  function threadHtml(on, ref, R, empty) {
    const key = `${on}:${ref}`, st = thState(key), w = W();
    return `<div class="th" data-th="${esc(key)}">
      ${R.length ? `<div class="th-list">${R.map(r => `<div class="th-n ${r.mine ? 'mine' : ''} ${r.for_me ? 'for-me' : ''}" data-rid="${esc(r.id)}">${av(r.by, r.name, 26)}<div class="th-box">
          <div class="th-meta"><b>${esc(r.mine ? 'You' : r.name)}</b>${toLine(r.to)}<span class="muted" title="${esc(new Date(r.created).toLocaleString())}">${esc(ago(r.created))}${r.at && r.at !== r.created ? ', edited' : ''}</span><span class="grow"></span>${r.mine && w ? `<button data-thedit title="Edit">${ic('pencil', 13)}</button><button data-thdel title="Delete for everybody">${ic('trash', 13)}</button>` : ''}</div>
          ${st.edit === r.id ? `<textarea class="input th-edit" rows="2">${esc(r.body)}</textarea><div class="lc-foot"><button class="linklike small" data-thcancel>Cancel</button><button class="btn small primary" data-thsave>Save</button></div>` : `<div class="th-body md">${md(r.body)}</div>`}</div></div>`).join('')}</div>`
        : `<p class="th-empty muted small">${empty}</p>`}
      ${w ? `<div class="th-new">${av(S.data.me, S.data.display_name, 26)}<div class="th-newbox"><textarea class="input th-text" rows="1" placeholder="Write a note for the group (${MOD}+Enter to add)">${esc(st.draft)}</textarea>
          ${st.to ? `<div class="lc-to-row"><span class="muted small">For</span>${pplChips(st.to)}</div>` : ''}</div>
          <button class="btn small lab-at ${st.to?.length ? 'on' : ''}" data-thto title="Address the note to someone: they get a notification">${ic('at', 15)}${st.to?.length || ''}</button><button class="btn small primary" data-thsend>Add note</button></div>` : ''}</div>`;
  }
  // clicks inside a thread, wherever it is shown (a plan on the page, a task in its window); true if it was one
  async function threadClick(e) {
    const t = e.target, th = t.closest('.th'); if (!th) return false;
    const key = th.dataset.th, st = thState(key);
    const sel = `[data-th="${CSS.escape(key)}"]`;
    const pp = t.closest('[data-pp]');
    if (pp) { if (!pp.disabled) { pp.classList.toggle('on'); st.to = pplRead(pp.closest('.lab-ppl')); const b = $('[data-thto]', th); if (b) { b.classList.toggle('on', !!st.to.length); b.innerHTML = ic('at', 15) + (st.to.length || ''); } } return true; }
    if (t.closest('[data-thto]')) { st.to = st.to ? null : []; render(); const ta = $(`${sel} .th-text`); if (ta) { ta.focus(); grow(ta); } return true; }
    if (t.closest('[data-thsend]')) { await sendNote(key); return true; }
    const n = t.closest('[data-rid]');
    if (n) {
      const q = `/remarks/${encodeURIComponent(n.dataset.rid)}`;
      if (t.closest('[data-thedit]')) { st.edit = n.dataset.rid; render(); const ta = $(`${sel} .th-edit`); if (ta) { ta.focus(); grow(ta); } return true; }
      if (t.closest('[data-thcancel]')) { st.edit = null; document.activeElement?.blur(); render(); return true; }
      if (t.closest('[data-thsave]')) { const body = $('.th-edit', n).value.trim(); if (!body) return true; st.edit = null; document.activeElement?.blur(); if (!(await call(q, {method: 'PUT', body: {body}}))) { st.edit = n.dataset.rid; render(); } return true; }
      if (t.closest('[data-thdel]')) { if (await confirmBox('Delete your note?', 'It is deleted for everybody in the group.', {ok: 'Delete', danger: true})) call(q, {method: 'DELETE'}); return true; }
    }
    return true;
  }
  async function sendNote(key) {
    const i = key.indexOf(':'), on = key.slice(0, i), ref = key.slice(i + 1), st = thState(key), sel = `[data-th="${CSS.escape(key)}"] .th-text`;
    const ta = $(sel), body = (ta?.value || st.draft || '').trim(); if (!body) { ta?.focus(); return; }
    if (!(await Notes.ensureName())) return;
    const to = st.to || []; st.draft = ''; st.to = null; if (ta) ta.value = '';
    const d = await call('/remarks', {method: 'POST', body: {on, ref, body, to}});
    if (!d) { st.draft = body; st.to = to.length ? to : null; render(); return; }
    if (to.length) toast(`Note added. ${to.map(pname).join(', ')} will get a notification.`, 'ok');
    $(sel)?.focus();
  }
  function threadInput(e) {
    const t = e.target;
    if (t.matches('.th-text')) { thState(t.closest('.th').dataset.th).draft = t.value; grow(t); return true; }
    if (t.matches('.th-edit')) { grow(t); return true; }
    return false;
  }
  function threadKey(e) {
    if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return false;
    if (e.target.matches('.th-text')) { e.preventDefault(); sendNote(e.target.closest('.th').dataset.th); return true; }
    if (e.target.matches('.th-edit')) { e.preventDefault(); e.target.closest('.th-n').querySelector('[data-thsave]').click(); return true; }
    return false;
  }

  /* ---------------------------------------------------- plans & tasks */
  const planProg = id => { const ts = S.data.tasks.filter(t => (t.plan || '') === id); return {n: ts.length, done: ts.filter(t => t.status === 'done').length}; };
  function plansHtml() {
    const d = S.data, w = W();
    let pl = d.plans.find(x => x.id === S.plan);
    if (S.plan !== 'all' && S.plan !== 'none' && !pl) S.plan = 'all';
    const T = d.tasks.filter(t => (S.plan === 'all' || (t.plan || '') === (S.plan === 'none' ? '' : S.plan)) && (!S.mine || t.mine));
    const noPlan = d.tasks.filter(t => !t.plan).length;
    let head;
    if (pl) {
      const g = planProg(pl.id), notesOpen = S.pn[pl.id] ?? pl.remarks.length > 0;
      head = `<div class="lab-phead"><div class="lab-phead-top"><div class="lab-phead-main"><h3>${esc(pl.name)}</h3>
            ${pl.goal ? `<p class="lab-goal">${esc(pl.goal)}</p>` : ''}
            <div class="lab-pmeta"><span class="lab-pm">${ic('user', 14)}${pl.people.length ? pl.people.map(x => `<span class="lab-pp-s">${av(x.id, x.name, 18)}${esc(x.me ? 'You' : x.name)}</span>`).join('') : '<span class="muted">Nobody is responsible yet</span>'}</span>
              ${dueChip(pl.due, g.n && g.done === g.n ? 'done' : '')}
              <span class="lab-pm">${prog(g.done, g.n)}<span class="muted">${g.done} of ${g.n} tasks done</span></span></div></div>
          <div class="lab-phead-acts"><button class="btn small ${notesOpen ? 'on' : ''}" data-lpnotes="${esc(pl.id)}" title="Notes of the group on this plan">${ic('message', 15)}Notes${pl.remarks.length ? `<span class="lab-n">${pl.remarks.length}</span>` : ''}</button>
            ${w ? `<button class="btn small" data-lplanedit="${esc(pl.id)}">${ic('pencil', 14)}Edit</button>` : ''}</div></div>
          ${notesOpen ? `<div class="lab-pnotes">${threadHtml('plan', pl.id, pl.remarks, w ? 'No notes on this plan yet. Write what the group should know: constraints, ideas, changes of plan.' : 'No notes on this plan yet.')}</div>` : ''}</div>`;
    } else {
      head = `<div class="lab-phead plain"><div class="lab-phead-main"><h3>${S.plan === 'none' ? 'Tasks without a plan' : 'All tasks'}</h3>
          ${d.tasks.length ? '' : '<p class="muted small lab-explain">A plan is a project or a milestone, such as a pilot study or a paper. Its tasks are the steps: each has people, a deadline, a checklist to tick and notes for the group.</p>'}</div></div>`;
    }
    return `<div class="lab-plans2">
      <div class="lab-plist">
        <div class="lab-plist-h"><b>Plans</b>${w ? `<button class="btn small" data-lnewplan title="A project or a milestone that groups tasks">${ic('plus', 14)}New plan</button>` : ''}</div>
        <button class="lab-pi ${S.plan === 'all' ? 'on' : ''}" data-lplan="all"><span class="lab-pi-h"><b>All tasks</b><span class="lab-n">${d.tasks.length || ''}</span></span></button>
        ${d.plans.map(p => { const x = planProg(p.id); return `<button class="lab-pi ${S.plan === p.id ? 'on' : ''}" data-lplan="${esc(p.id)}" title="${esc(p.goal || '')}">
            <span class="lab-pi-h"><b>${esc(p.name)}</b><span class="lab-task-ppl">${p.people.map(y => av(y.id, y.name, 18)).join('')}</span></span>
            ${prog(x.done, x.n)}
            <span class="lab-pi-m muted small"><span>${x.done}/${x.n} done</span>${p.remarks.length ? `<span class="ov-i">${ic('message', 12)}${p.remarks.length}</span>` : ''}<span class="grow"></span>${dueChip(p.due, x.n && x.done === x.n ? 'done' : '')}</span></button>`; }).join('')}
        ${noPlan && d.plans.length ? `<button class="lab-pi ${S.plan === 'none' ? 'on' : ''}" data-lplan="none"><span class="lab-pi-h"><b>Without a plan</b><span class="lab-n">${noPlan}</span></span></button>` : ''}
        ${!d.plans.length ? `<p class="muted small lab-plist-hint">${w ? 'No plans yet. Start one for an experiment or a paper: it can come with the usual steps already filled in.' : 'No plans yet.'}</p>` : ''}
      </div>
      <div class="lab-pmain">${head}
        <div class="lab-boardbar"><label class="lab-mine"><input type="checkbox" id="lab-mine" ${S.mine ? 'checked' : ''}> Only my tasks</label>
          <select class="input lab-order" id="lab-order" title="How the tasks are ordered in each column"><option value="auto" ${ORDER === 'auto' ? 'selected' : ''}>By deadline, then priority</option><option value="manual" ${ORDER === 'manual' ? 'selected' : ''}>In the order I drag them</option></select><span class="grow"></span>
          ${w ? `<button class="btn small primary" data-lfocusquick>${ic('plus', 14)}New task</button>` : ''}</div>
        <div class="lab-board">${STATUS.map(([st, label]) => { const col = T.filter(t => t.status === st); if (ORDER === 'auto') col.sort(byDeadline); return `<div class="lab-col" data-col="${st}">
            <div class="lab-col-h"><span class="lab-st ${st}"></span><b>${label}</b><span class="lab-n">${col.length}</span></div>
            <div class="lab-col-list">${col.map(taskCard).join('') || `<div class="lab-col-empty muted small">${st === 'todo' ? (w ? 'Type a task below and press Enter.' : 'Nothing to do.') : st === 'doing' ? 'Drag a task here when you start it.' : 'Finished tasks land here.'}</div>`}</div>
            ${w && st === 'todo' ? `<div class="lab-quickrow">${ic('plus', 15)}<input class="lab-quick" maxlength="300" placeholder="Add a task${pl ? ` to ${esc(truncate(pl.name, 22))}` : ''}" title="Press Enter to add it. Then open it to set people, a date, a checklist and notes."></div>` : ''}</div>`; }).join('')}</div>
      </div></div>`;
  }
  function taskCard(t) {
    const pl = S.data.plans.find(x => x.id === t.plan), ck = t.checklist || [], done = ck.filter(c => c.done).length;
    const shown = t.status === 'done' ? [] : ck.slice(0, 5), w = W();
    return `<div class="lab-task prio-${t.prio} ${t.mine ? 'mine' : ''}" data-task="${esc(t.id)}" ${w ? 'draggable="true"' : ''}>
      <div class="lab-task-t">${t.prio === 'high' ? `<span class="lab-prio" title="High priority">${ic('flag', 13)}</span>` : ''}${esc(t.title)}</div>
      ${t.notes ? `<div class="lab-task-n muted small">${esc(truncate(t.notes, 110))}</div>` : ''}
      ${shown.length ? `<div class="lab-ck-list">${shown.map(c => `<label class="lab-ck ${c.done ? 'done' : ''}"><input type="checkbox" data-lchk="${esc(c.id)}" ${c.done ? 'checked' : ''} ${w ? '' : 'disabled'}><span>${esc(c.text)}</span></label>`).join('')}${ck.length > shown.length ? `<span class="lab-ck-more muted small">and ${ck.length - shown.length} more</span>` : ''}</div>` : ''}
      <div class="lab-task-m">${t.people.length ? `<span class="lab-task-ppl" title="${esc(t.people.map(x => x.name).join(', '))}">${t.people.map(x => av(x.id, x.name, 20)).join('')}</span>` : ''}
        ${ck.length ? `<span class="ov-i ${done === ck.length ? 'all' : ''}" title="Checklist">${ic('checks', 13)}${done}/${ck.length}</span>` : ''}${t.remarks.length ? `<span class="ov-i" title="Notes">${ic('message', 13)}${t.remarks.length}</span>` : ''}${t.paper ? `<span class="ov-i" title="${esc(t.paper.title)}">${ic('file', 13)}</span>` : ''}${t.post ? `<span class="ov-i" title="From the post: ${esc(t.post_title)}">${ic('bulb', 13)}</span>` : ''}
        <span class="grow"></span>${dueChip(t.due, t.status)}</div>
      ${pl && S.plan === 'all' ? `<div class="lab-task-l"><span class="lab-chip">${esc(truncate(pl.name, 30))}</span></div>` : ''}</div>`;
  }

  /* The window of a task. Left: what it is, its checklist, the notes of the group.
     Right: the settings – status, people, deadline, priority, plan, paper. Saved as you change them. */
  function taskWindow(id, {focusNotes = false} = {}) {
    const get = () => S.data?.tasks.find(t => t.id === id);
    let t = get(); if (!t) return;
    if (S.tw) S.tw.m.close(true);
    const w = W(), ro = w ? '' : 'disabled';
    const papers = state.papers.filter(p => (p.share_ids || []).includes(S.sid));
    const m = modal(`<div class="tw-top"><div class="seg tw-status" id="tw-status"></div><span class="grow"></span>
        <span class="muted small tw-auto">${w ? 'Changes are saved as you make them' : 'You are a reader: read only'}</span>
        <button class="tw-x" data-close title="Close (Esc)" aria-label="Close">${ic('x', 18)}</button></div>
      <div class="tw-grid">
        <div class="tw-main">
          <textarea class="tw-title" id="tw-title" rows="1" maxlength="300" placeholder="What has to be done" ${ro}>${esc(t.title)}</textarea>
          <textarea class="tw-desc" id="tw-desc" rows="1" maxlength="5000" placeholder="${w ? 'Add a description: what done means, links, details' : ''}" ${ro}>${esc(t.notes || '')}</textarea>
          <section class="tw-sec">
            <div class="tw-sec-h" id="tw-ck-head"></div>
            <div class="tw-ck-list" id="tw-ck-list"></div>
            ${w ? `<div class="tw-ck-add">${ic('plus', 16)}<input id="tw-ck-new" maxlength="300" placeholder="Add an item and press Enter. Paste a list to add several." autocomplete="off"></div>` : ''}
          </section>
          <section class="tw-sec">
            <div class="tw-sec-h" id="tw-th-head"></div>
            <div id="tw-thread"></div>
          </section>
        </div>
        <aside class="tw-side" id="tw-side"></aside>
      </div>`, {wide: true, nofocus: true});
    m.el.querySelector('.modal').classList.add('tw');
    const el = m.el, ti = $('#tw-title', el), de = $('#tw-desc', el);
    const put = body => call(`/tasks/${encodeURIComponent(id)}`, {method: 'PUT', body});
    const sideHtml = x => `
        <div class="tw-f"><label>People</label>${pplChips(x.assignees, {id: 'tw-who', disabled: !w})}${w && !x.assignees.length ? '<p class="muted small">Click who does it. They get a notification.</p>' : ''}${!w && !x.assignees.length ? '<p class="muted small">Nobody yet</p>' : ''}</div>
        <div class="tw-f"><label for="tw-due">Deadline</label><div class="tw-due ${dueCls(x.due, x.status)}"><input class="input" type="date" id="tw-due" value="${esc(x.due || '')}" ${ro}>${x.due && w ? `<button class="tw-clear" data-twcleardue title="Remove the deadline">${ic('x', 14)}</button>` : ''}</div></div>
        <div class="tw-f"><label>Priority</label><div class="seg tw-prio">${[['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].map(([k, l]) => `<button type="button" data-twprio="${k}" class="${x.prio === k ? 'on' : ''}" ${ro}>${k === 'high' ? ic('flag', 13) : ''}${l}</button>`).join('')}</div></div>
        <div class="tw-f"><label for="tw-plan">Plan</label><select class="input" id="tw-plan" ${ro}><option value="">No plan</option>${S.data.plans.map(pl => `<option value="${esc(pl.id)}" ${x.plan === pl.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select></div>
        <div class="tw-f"><label for="tw-paper">Paper</label><select class="input" id="tw-paper" ${ro}><option value="">None</option>${papers.map(p => `<option value="${p.id}" ${x.paper?.paper_id === p.id ? 'selected' : ''}>${esc(truncate(p.title || 'Untitled', 60))}</option>`).join('')}</select>
          ${x.paper?.paper_id ? `<button class="linklike small" data-twpaper="${x.paper.paper_id}">Open the paper</button>` : ''}</div>
        ${x.post ? `<div class="tw-f"><label>From the post</label><button class="linklike tw-post" data-twpost>${ic('bulb', 14)}${esc(truncate(x.post_title || 'a post', 60))}</button></div>` : ''}
        <div class="tw-foot"><span class="muted small">Created by ${esc(x.by_name || x.by || '')}${x.created ? ', ' + esc(ago(x.created)) : ''}</span>
          ${w ? `<button class="btn small danger-soft" data-twdel>${ic('trash', 14)}Delete task</button>` : ''}</div>`;
    function paint() {
      t = get(); if (!t) { m.close(true); return; }
      const a = document.activeElement, inM = !!a && el.contains(a);
      $('#tw-status', el).innerHTML = STATUS.map(([k, l]) => `<button type="button" data-twstatus="${k}" class="${t.status === k ? 'on' : ''}" ${ro}><span class="lab-st ${k}"></span>${l}</button>`).join('');
      if (a !== ti && ti.value !== t.title) ti.value = t.title;
      if (a !== de && de.value !== (t.notes || '')) de.value = t.notes || '';
      grow(ti); grow(de);
      const ck = t.checklist, done = ck.filter(c => c.done).length;
      $('#tw-ck-head', el).innerHTML = `${ic('checks', 17)}<h4>Checklist</h4>${ck.length ? `<span class="tw-count ${done === ck.length ? 'all' : ''}">${done} of ${ck.length}</span><span class="grow"></span>${prog(done, ck.length)}` : '<span class="muted small">Small steps to tick, one by one</span>'}`;
      if (!(inM && a.matches('.tw-ck-text'))) {
        $('#tw-ck-list', el).innerHTML = ck.map(c => `<div class="tw-ck ${c.done ? 'done' : ''}" data-ck="${esc(c.id)}"><input type="checkbox" ${c.done ? 'checked' : ''} ${ro} data-ckdone aria-label="Done">
          <input class="tw-ck-text" value="${esc(c.text)}" maxlength="300" ${ro} data-cktext>${w ? `<button type="button" class="tw-ck-del" data-ckdel title="Remove this item">${ic('x', 14)}</button>` : ''}</div>`).join('');
      }
      $('#tw-th-head', el).innerHTML = `${ic('message', 17)}<h4>Notes</h4>${t.remarks.length ? `<span class="tw-count">${t.remarks.length}</span>` : '<span class="muted small">Considerations, updates and questions about this task</span>'}`;
      if (!(inM && a.matches('.th-edit'))) {
        const thFoc = inM && a.matches('.th-text');
        $('#tw-thread', el).innerHTML = threadHtml('task', id, t.remarks, w ? 'No notes yet. Write the first one below.' : 'No notes yet.');
        const ta = $('#tw-thread .th-text', el); if (ta) { grow(ta); if (thFoc) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
      }
      if (!(inM && a.closest('#tw-side') && a.matches('select, input'))) $('#tw-side', el).innerHTML = sideHtml(t);
    }
    S.tw = {id, m, paint};
    paint();
    m.onclose = () => {   // what was being typed in the title or the description is not lost
      S.tw = null;
      const cur = get(); if (!cur || !w) return;
      const body = {};
      if (ti.value.trim() && ti.value.trim() !== cur.title) body.title = ti.value.trim();
      if (de.value !== (cur.notes || '')) body.notes = de.value;
      if (Object.keys(body).length) put(body);
    };
    const addItems = async texts => {
      let pos = get().checklist.length + 1;
      for (const text of texts) if (text) await call('/checks', {method: 'POST', body: {task: id, text: text.slice(0, 300), pos: pos++}});
      $('#tw-ck-new', el)?.focus();
    };
    const clean = s => s.replace(/^\s*(?:[-*•]\s*)?(?:\[[ xX]?\]\s*)?(?:\d+[.)]\s*)?/, '').trim();
    el.addEventListener('click', async e => {
      const x = e.target;
      if (x.closest('.th')) { await threadClick(e); return; }
      const stb = x.closest('[data-twstatus]'); if (stb && w) { put({status: stb.dataset.twstatus}); return; }
      const prb = x.closest('[data-twprio]'); if (prb && w) { put({prio: prb.dataset.twprio}); return; }
      const pp = x.closest('#tw-who [data-pp]');
      if (pp && w) {
        pp.classList.toggle('on');
        const who = pplRead($('#tw-who', el)), before = get().assignees;
        if (await put({assignees: who})) { const fresh = who.filter(a => !before.includes(a) && a !== S.data.me); if (fresh.length) toast(`${fresh.map(pname).join(', ')} will get a notification at their next update.`, 'ok', 5000); }
        return;
      }
      if (x.closest('[data-twcleardue]')) { put({due: ''}); return; }
      if (x.closest('[data-twpaper]')) { const pid = +x.closest('[data-twpaper]').dataset.twpaper; m.close(); setTab('library'); setView({type: 'share', id: S.sid}); openDetail(pid); return; }
      if (x.closest('[data-twpost]')) { const post = get().post; m.close(); gotoPost(post); return; }
      if (x.closest('[data-twdel]')) {
        if (!(await confirmBox('Delete this task?', 'It is deleted for everybody in the group, with its checklist and notes.', {ok: 'Delete', danger: true}))) return;
        if (await call(`/tasks/${encodeURIComponent(id)}`, {method: 'DELETE'})) m.close(true);
        return;
      }
      const row = x.closest('[data-ck]');
      if (row && x.closest('[data-ckdel]')) { call(`/checks/${encodeURIComponent(row.dataset.ck)}`, {method: 'DELETE'}); return; }
      if (x.closest('.tw-ck-add')) $('#tw-ck-new', el)?.focus();
    });
    el.addEventListener('change', e => {
      const x = e.target; if (!w) return;
      if (x === ti) { const v = ti.value.trim(); if (!v) { ti.value = get().title; grow(ti); return; } if (v !== get().title) put({title: v}); return; }
      if (x === de) { if (de.value !== (get().notes || '')) put({notes: de.value}); return; }
      if (x.id === 'tw-due') { put({due: x.value}); return; }
      if (x.id === 'tw-plan') { put({plan: x.value}); return; }
      if (x.id === 'tw-paper') { put({paper_id: x.value ? +x.value : ''}); return; }
      const row = x.closest('[data-ck]'); if (!row) return;
      const c = get().checklist.find(y => y.id === row.dataset.ck); if (!c) return;
      if (x.matches('[data-ckdone]')) { row.classList.toggle('done', x.checked); call(`/checks/${encodeURIComponent(c.id)}`, {method: 'PUT', body: {done: x.checked}}); }
      else if (x.matches('[data-cktext]')) { const text = x.value.trim(); if (!text) { x.value = c.text; return; } if (text !== c.text) call(`/checks/${encodeURIComponent(c.id)}`, {method: 'PUT', body: {text}}); }
    });
    el.addEventListener('input', e => { if (threadInput(e)) return; if (e.target === ti || e.target === de) grow(e.target); });
    el.addEventListener('keydown', e => {
      if (threadKey(e)) return;
      const x = e.target;
      if (x === ti && e.key === 'Enter') { e.preventDefault(); ti.blur(); return; }
      if (x.id === 'tw-ck-new' && e.key === 'Enter') { e.preventDefault(); const text = x.value.trim(); x.value = ''; if (text) addItems([text]); return; }
      if (x.matches('.tw-ck-text') && e.key === 'Enter') { e.preventDefault(); x.blur(); $('#tw-ck-new', el)?.focus(); return; }
      if (x.matches('.tw-ck-text') && e.key === 'Backspace' && !x.value) { e.preventDefault(); const row = x.closest('[data-ck]'); x.blur(); call(`/checks/${encodeURIComponent(row.dataset.ck)}`, {method: 'DELETE'}).then(() => $('#tw-ck-new', el)?.focus()); }
    });
    $('#tw-ck-new', el)?.addEventListener('paste', e => {   // a pasted list becomes several items
      const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!/\n/.test(txt.trim())) return;
      e.preventDefault(); addItems(txt.split(/\r?\n/).map(clean).filter(Boolean).slice(0, 40));
    });
    if (focusNotes) setTimeout(() => $('#tw-thread .th-text', el)?.focus(), 60);
    else if (w && !t.checklist.length && !t.notes && !t.remarks.length) setTimeout(() => $('#tw-ck-new', el)?.focus(), 60);
  }
  async function newTask(body, {open = false} = {}) {
    const old = new Set(S.data.tasks.map(y => y.id));
    const d = await call('/tasks', {method: 'POST', body: {status: 'todo', ...body}});
    const nt = d?.tasks.find(y => !old.has(y.id));
    if (nt && open) taskWindow(nt.id);
    return nt;
  }
  function planDialog(pl = null) {
    const m = modal(`<h3>${pl ? 'Edit the plan' : 'New plan'}</h3>
      <div class="fld"><label for="pl-name">Name</label><input class="input" id="pl-name" maxlength="120" value="${esc(pl?.name || '')}" placeholder="Pilot study, paper revision, grant application"></div>
      <div class="fld"><label for="pl-goal">Goal (optional)</label><textarea class="input" id="pl-goal" rows="2" placeholder="What the plan should achieve">${esc(pl?.goal || '')}</textarea></div>
      <div class="fld pl-duefld"><label for="pl-due">Deadline (optional)</label><input class="input" type="date" id="pl-due" value="${esc(pl?.due || '')}"></div>
      <div class="fld"><label>Responsible</label>${pplChips(pl?.owners || [], {id: 'pl-owners'})}<p class="muted small">Who leads it. They get a notification.</p></div>
      ${pl ? '' : `<div class="fld"><label>Start with</label><div class="pl-tpl">
          <label class="opt"><input type="radio" name="pl-tpl" value="" checked><span>An empty plan<small>You add the tasks yourself</small></span></label>
          ${Object.entries(TEMPLATES).map(([k, v]) => `<label class="opt"><input type="radio" name="pl-tpl" value="${k}"><span>The steps of ${v.what}<small>${v.hint}. ${v.tasks.length} tasks with checklists, all editable.</small></span></label>`).join('')}</div></div>`}
      <div class="modal-actions">${pl ? `<button class="btn danger-soft" id="pl-del">${ic('trash', 14)}Delete plan</button>` : ''}<span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pl-save">${pl ? 'Save' : 'Create plan'}</button></div>`);
    setTimeout(() => $('#pl-name', m.el)?.focus(), 30);
    m.el.addEventListener('click', e => { const pp = e.target.closest('[data-pp]'); if (pp && !pp.disabled) pp.classList.toggle('on'); });
    $('#pl-del', m.el)?.addEventListener('click', async () => {
      const n = S.data.tasks.filter(t => t.plan === pl.id).length;
      if (!(await confirmBox(`Delete the plan “${pl.name}”?`, n ? `Its ${plural(n, 'task')} stay, without a plan.` : 'It is deleted for everybody.', {ok: 'Delete', danger: true}))) return;
      if (await call(`/plans/${encodeURIComponent(pl.id)}`, {method: 'DELETE'})) { if (S.plan === pl.id) S.plan = 'all'; m.close(); render(); }
    });
    const saveIt = async () => {
      const body = {name: $('#pl-name', m.el).value.trim(), goal: $('#pl-goal', m.el).value, due: $('#pl-due', m.el).value, owners: pplRead($('#pl-owners', m.el))};
      if (!body.name) { $('#pl-name', m.el).focus(); return; }
      const tpl = TEMPLATES[$('input[name="pl-tpl"]:checked', m.el)?.value];
      if (!pl && tpl) body.tasks = tpl.tasks.map(([title, checklist]) => ({title, checklist}));
      const old = new Set(S.data.plans.map(x => x.id));
      const d = await call(pl ? `/plans/${encodeURIComponent(pl.id)}` : '/plans', {method: pl ? 'PUT' : 'POST', body});
      if (!d) return;
      m.close();
      if (pl) return;
      const np = d.plans.find(x => !old.has(x.id));
      if (np) { S.plan = np.id; render(); toast(tpl ? `Plan created with ${tpl.tasks.length} tasks. Change or delete what does not fit.` : 'Plan created. Add its tasks below.', 'ok', 5000); }
    };
    $('#pl-save', m.el).addEventListener('click', saveIt);
    m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target.id === 'pl-name')) { e.preventDefault(); saveIt(); } });
  }

  /* ------------------------------------------------------------------ events */
  function bind() {
    const el = main();
    el.addEventListener('click', async e => {
      const t = e.target;
      const lg = t.closest('[data-lg]'); if (lg) { go(lg.dataset.lg); return; }
      if (t.closest('[data-lnewgroup]')) { Shares.newDialog?.(); return; }
      if (t.closest('[data-ljoin]')) { Shares.joinDialog?.(); return; }
      const op = t.closest('[data-ovplan]'); if (op) { const [sid, id] = op.dataset.ovplan.split('|'); openGroup(sid, {plan: id}); return; }
      const ov = t.closest('[data-ovtask], [data-ovpost], [data-ovdone]');
      if (ov) {
        const [sid, id] = (ov.dataset.ovtask || ov.dataset.ovpost || ov.dataset.ovdone).split('|');
        if (ov.dataset.ovdone) {
          ov.classList.add('on');
          try { await api(`/api/shares/${encodeURIComponent(sid)}/lab/tasks/${encodeURIComponent(id)}`, {method: 'PUT', body: {status: 'done'}}); toast('Task done.', 'ok'); } catch (err) { toast(err.message, 'error'); }
          await load(); render(); return;
        }
        openGroup(sid, ov.dataset.ovtask ? {task: id} : {post: id}); return;
      }
      if (!S.data) return;
      if (t.closest('.th')) { await threadClick(e); return; }
      const sub = t.closest('[data-lsub]'); if (sub) { S.sub = sub.dataset.lsub; save(); render(); return; }
      if (t.closest('[data-lpapers]')) { setTab('library'); setView({type: 'share', id: S.sid}); return; }
      if (t.closest('[data-ltable]')) { setTab('library'); setView({type: 'share', id: S.sid}); setMode('table'); return; }
      if (t.closest('[data-lsync]')) { const b = t.closest('[data-lsync]'); b.disabled = true; b.classList.add('busy'); await Shares.syncNow(S.sid); await load(); render(); return; }
      if (t.closest('[data-lexport]')) { const a = document.createElement('a'); a.href = `/api/shares/${sidQ()}/lab/export`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Report saved in your Downloads, as Markdown.', 'ok'); return; }
      // ideas
      if (t.closest('[data-lnew]')) { S.composing = {id: null, kind: 'idea', title: '', body: '', tags: [], papers: [], to: []}; render(); return; }
      const pp = t.closest('[data-pp]');
      if (pp && !pp.disabled) {
        pp.classList.toggle('on');
        const art = pp.closest('[data-post]');
        if (art && pp.closest('.lc-to-row')) { const to = S.cto[art.dataset.post] = pplRead(pp.closest('.lab-ppl')); const b = $('[data-lcto]', art); if (b) { b.classList.toggle('on', !!to.length); b.innerHTML = ic('at', 15) + (to.length || ''); } }
        return;
      }
      const kb = t.closest('[data-lkind]'); if (kb) { readComposer(); S.composing.kind = kb.dataset.lkind; render(); $('#lc-body', main())?.focus(); return; }
      if (t.closest('[data-lpick]')) { pickPapers(); return; }
      const ul = t.closest('[data-lunlink]'); if (ul) { readComposer(); S.composing.papers = S.composing.papers.filter(id => id !== +ul.dataset.lunlink); render(); return; }
      if (t.closest('[data-lcancel]')) { readComposer(); const c = S.composing; if ((c.title || c.body) && !c.id && !(await confirmBox('Discard this post?', 'What you wrote has not been posted.', {ok: 'Discard', danger: true}))) return; S.composing = null; render(); return; }
      if (t.closest('[data-lsave]')) { savePost(); return; }
      const kf = t.closest('[data-lkf]'); if (kf) { S.f.kind = kf.dataset.lkf; render(); return; }
      const tg = t.closest('[data-ltag]'); if (tg) { S.f.tag = S.f.tag === tg.dataset.ltag ? '' : tg.dataset.ltag; render(); return; }
      const lp = t.closest('[data-lpaper]'); if (lp) { const id = +lp.dataset.lpaper; setTab('library'); setView({type: 'share', id: S.sid}); openDetail(id); return; }
      const gt = t.closest('[data-lgoto]'); if (gt) { gotoPost(gt.dataset.lgoto); return; }
      const art = t.closest('[data-post]');
      if (art) {
        const p = S.data.posts.find(x => x.id === art.dataset.post); if (!p) return;
        const q = `/posts/${encodeURIComponent(p.id)}`;
        if (t.closest('[data-lmore]')) { S.open.add(p.id); render(); return; }
        if (t.closest('[data-lcom]')) { S.open.has(p.id) ? S.open.delete(p.id) : S.open.add(p.id); render(); if (S.open.has(p.id)) $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main())?.focus(); return; }
        if (t.closest('[data-lvote]')) { call(`${q}/vote`, {method: 'POST', body: {v: !p.voted}}); return; }
        if (t.closest('[data-lpin]')) { call(`${q}/pin`, {method: 'POST', body: {v: !p.pinned}}); return; }
        if (t.closest('[data-lmktask]')) { S.sub = 'plans'; S.plan = 'all'; save(); await newTask({title: p.title || truncate(p.body || '', 80), post: p.id}, {open: true}); return; }
        if (t.closest('[data-ltasks]')) { S.sub = 'plans'; S.plan = 'all'; save(); render(); return; }
        if (t.closest('[data-lcto]')) { if (S.cto[p.id]) delete S.cto[p.id]; else S.cto[p.id] = []; render(); return; }
        if (t.closest('[data-ledit]')) { S.composing = {id: p.id, kind: p.kind, title: p.title, body: p.body, tags: [...p.tags], to: p.to.map(x => x.id), papers: p.papers.map(x => x.paper_id).filter(Boolean)}; render(); return; }
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
      const pe = t.closest('[data-lplanedit]'); if (pe) { planDialog(S.data.plans.find(x => x.id === pe.dataset.lplanedit)); return; }
      const pnb = t.closest('[data-lpnotes]');
      if (pnb) {
        const id = pnb.dataset.lpnotes, pl = S.data.plans.find(x => x.id === id);
        S.pn[id] = !(S.pn[id] ?? pl.remarks.length > 0); render();
        if (S.pn[id]) $(`[data-th="plan:${CSS.escape(id)}"] .th-text`, main())?.focus();
        return;
      }
      const pb = t.closest('[data-lplan]'); if (pb) { S.plan = pb.dataset.lplan; render(); return; }
      if (t.closest('[data-lnewplan]')) { planDialog(); return; }
      if (t.closest('[data-lfocusquick], .lab-quickrow')) { const q = $('.lab-quick', main()); if (q) { q.scrollIntoView({block: 'nearest'}); q.focus(); } return; }
      if (t.closest('.lab-ck')) return;   // ticking an item on a card (see 'change')
      const tk = t.closest('[data-task]'); if (tk) taskWindow(tk.dataset.task);
    });
    el.addEventListener('input', e => {
      if (threadInput(e)) return;
      if (e.target.id === 'lab-q') { S.f.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#lab-q', main()); q.focus(); q.setSelectionRange(pos, pos); }
      if (e.target.matches('.lc-text, .lc-edit')) grow(e.target);
    });
    el.addEventListener('change', e => {
      if (e.target.id === 'lab-sort') { S.f.sort = e.target.value; render(); }
      if (e.target.id === 'lab-mine') { S.mine = e.target.checked; render(); }
      if (e.target.id === 'lab-order') { ORDER = e.target.value; try { localStorage.setItem('papershelf-lab-order', ORDER); } catch { /* ignore */ } render(); }
      if (e.target.matches('[data-lchk]')) call(`/checks/${encodeURIComponent(e.target.dataset.lchk)}`, {method: 'PUT', body: {done: e.target.checked}});
    });
    el.addEventListener('keydown', async e => {
      if (threadKey(e)) return;
      if (e.target.matches('.lab-quick')) {
        if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; e.target.blur(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const title = e.target.value.trim(), andOpen = e.shiftKey; if (!title) return;
        e.target.value = '';
        const nt = await newTask({title, plan: S.plan !== 'all' && S.plan !== 'none' ? S.plan : ''}, {open: andOpen});
        const q = $('.lab-quick', main());
        if (!nt && q) q.value = title;
        if (!andOpen) q?.focus();
        return;
      }
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
    const to = S.cto[p.id] || [];
    const d = await call(`/posts/${encodeURIComponent(p.id)}/comments`, {method: 'POST', body: {body, to}});
    if (d) { delete S.cto[p.id]; render(); if (to.length) toast(`Comment sent. ${to.map(pname).join(', ')} will get a notification.`, 'ok'); }
    if (!d) { const t2 = $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main()); if (t2) { t2.disabled = false; t2.value = body; } return; }
    $(`[data-post="${CSS.escape(p.id)}"] .lc-text`, main())?.focus();
  }
  async function refresh() { if (state.tab === 'lab') { await load(); render(); } }

  document.addEventListener('DOMContentLoaded', () => { if (main()) bind(); });
  return {show, openGroup, refresh, isOpen: () => state.tab === 'lab'};
})();
