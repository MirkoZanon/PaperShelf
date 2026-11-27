'use strict';
/* PaperShelf – the lab calendar.
   Shows the events of a group (experiments, meetings, deadlines, other) together with the deadlines of its tasks and plans;
   or of all your groups. Month, week and agenda views; filters; an event window (date, time, place, who, description, reminder,
   link to a discussion); export to Apple/Google/Outlook calendars (.ics); reminders as notifications while PaperShelf is open
   (and through the operating system while it runs in the background – see labcal.py).
   Events live in the group's file like tasks do (see sharing.py): every member sees them, editors change them. */
const Cal = (() => {
  const C = {host: null, group: null, canWrite: false, view: 'month', cur: new Date(), items: [], mine: false, types: {event: true, task: true, plan: true},
    notify: true, onChange: null, today: ''};
  try { const p = JSON.parse(localStorage.getItem('papershelf-cal') || '{}'); if (['month', 'week', 'agenda'].includes(p.view)) C.view = p.view; C.mine = !!p.mine; } catch { /* ignore */ }
  const store = () => { try { localStorage.setItem('papershelf-cal', JSON.stringify({view: C.view, mine: C.mine})); } catch { /* ignore */ } };
  const KINDS = [['experiment', 'Experiment'], ['meeting', 'Meeting'], ['deadline', 'Deadline'], ['other', 'Other']];
  const REMIND = [[-1, 'No reminder'], [0, 'At the start'], [10, '10 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [2880, '2 days before']];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => new Date(s + 'T12:00');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const fmt = (d, o) => d.toLocaleDateString(undefined, o);
  const when = i => i.start ? `${i.start}${i.end ? '–' + i.end : ''}` : '';
  const done = i => i.type !== 'event' && i.status === 'done';
  const sidQ = () => encodeURIComponent(C.group || '');

  async function load() {
    try { const d = await api('/api/calendar' + (C.group ? `?group=${sidQ()}` : '')); C.items = d.items; C.today = d.today; C.notify = d.notify; }
    catch (err) { C.items = []; toast(err.message, 'error'); }
  }
  const shown = () => C.items.filter(i => C.types[(i.type === 'note' || i.type === 'step') ? 'task' : i.type] && (!C.mine || i.mine));
  const byDay = () => { const m = {}; for (const i of shown()) (m[i.date] ||= []).push(i); return m; };

  /* ---------------------------------------------------------------- views */
  const chip = i => `<button class="cal-it k-${i.kind} t-${i.type} ${done(i) ? 'done' : ''}" data-ci="${esc(i.key)}" title="${esc(i.title)}${i.start ? ' · ' + esc(when(i)) : ''}${i.group_name && !C.group ? ' · ' + esc(i.group_name) : ''}">${i.type === 'task' ? '☐ ' : i.type === 'plan' ? '⚑ ' : i.type === 'note' ? '✎ ' : ''}${i.start ? `<b>${esc(i.start)}</b> ` : ''}${esc(i.title)}</button>`;
  function monthHtml() {
    const first = new Date(C.cur.getFullYear(), C.cur.getMonth(), 1, 12), start = monday(first), M = byDay();
    const cells = [];
    for (let k = 0; k < 42; k++) {
      const d = addDays(start, k), s = ymd(d), its = M[s] || [];
      cells.push(`<div class="cal-day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${s === C.today ? 'today' : ''}" data-cd="${s}">
        <div class="cal-dn">${d.getDate()}</div>${its.slice(0, 3).map(chip).join('')}${its.length > 3 ? `<button class="cal-more" data-cmore="${s}">+${its.length - 3} more</button>` : ''}</div>`);
      if (k === 34 && addDays(start, 35).getMonth() !== first.getMonth()) break;
    }
    const names = Array.from({length: 7}, (_, k) => fmt(addDays(start, k), {weekday: 'short'}));
    return `<div class="cal-month"><div class="cal-wd">${names.map(n => `<div>${esc(n)}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div>`;
  }
  function weekHtml() {
    const start = monday(C.cur), M = byDay();
    return `<div class="cal-week">${Array.from({length: 7}, (_, k) => {
      const d = addDays(start, k), s = ymd(d), its = (M[s] || []).slice().sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
      return `<div class="cal-wcol ${s === C.today ? 'today' : ''}" data-cd="${s}"><div class="cal-wh"><span>${esc(fmt(d, {weekday: 'short'}))}</span><b>${d.getDate()}</b></div>
        ${its.map(chip).join('') || '<div class="cal-empty">–</div>'}</div>`;
    }).join('')}</div>`;
  }
  function agendaHtml() {
    const from = C.today || ymd(new Date()), its = shown().filter(i => i.date >= from && !done(i));
    if (!its.length) return '<p class="muted cal-none">Nothing coming up. Add an experiment, a meeting or a deadline with “New event”.</p>';
    const days = {}; for (const i of its) (days[i.date] ||= []).push(i);
    return `<div class="cal-agenda">${Object.keys(days).sort().map(s => `<div class="cal-ag-day"><div class="cal-ag-h ${s === C.today ? 'today' : ''}">${esc(fmt(parse(s), {weekday: 'long', day: 'numeric', month: 'long'}))}${s === C.today ? ' · today' : ''}</div>
      ${days[s].sort((a, b) => (a.start || '').localeCompare(b.start || '')).map(i => `<button class="cal-ag-row k-${i.kind}" data-ci="${esc(i.key)}"><span class="cal-ag-t">${esc(when(i) || 'all day')}</span><span class="cal-ag-main"><b>${i.type === 'task' ? '☐ ' : i.type === 'plan' ? '⚑ ' : ''}${esc(i.title)}</b>
        <small>${esc([i.type === 'event' ? (KINDS.find(k => k[0] === i.kind)?.[1] || '') : i.type === 'task' ? 'Task deadline' : i.type === 'step' ? 'Checklist item' : i.type === 'note' ? 'Document task · ' + (i.doc_title || '') : 'Plan deadline', C.group ? '' : i.group_name, i.place, i.people.length ? i.people.map(p => p.me ? 'you' : p.name).join(', ') : ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>`).join('')}</div>`;
  }
  function title() {
    if (C.view === 'month') return fmt(C.cur, {month: 'long', year: 'numeric'});
    if (C.view === 'week') { const a = monday(C.cur), b = addDays(a, 6); return `${fmt(a, {day: 'numeric', month: 'short'})} – ${fmt(b, {day: 'numeric', month: 'short', year: 'numeric'})}`; }
    return 'Coming up';
  }
  function render() {
    const h = C.host; if (!h) return;
    const q = `?${C.group ? `group=${sidQ()}&` : ''}${C.mine ? 'mine=1' : ''}`;
    h.innerHTML = `<div class="cal">
      <div class="cal-bar">
        <div class="cal-nav">${C.view === 'agenda' ? '' : '<button class="btn small" data-cnav="-1" aria-label="Previous">‹</button><button class="btn small" data-cnav="0">Today</button><button class="btn small" data-cnav="1" aria-label="Next">›</button>'}<h3>${esc(title())}</h3></div>
        <span class="grow"></span>
        <div class="seg">${[['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']].map(([v, l]) => `<button data-cview="${v}" class="${C.view === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${C.canWrite || !C.group ? '<button class="btn small primary" data-cnew>＋ New event</button>' : ''}
      </div>
      <div class="cal-filters">
        <label class="opt small"><input type="checkbox" data-cmine ${C.mine ? 'checked' : ''}> Only mine</label>
        <label class="opt small"><input type="checkbox" data-ctype="event" ${C.types.event ? 'checked' : ''}> Events</label>
        <label class="opt small"><input type="checkbox" data-ctype="task" ${C.types.task ? 'checked' : ''}> Task deadlines <span class="muted">(and document tasks)</span></label>
        <label class="opt small"><input type="checkbox" data-ctype="plan" ${C.types.plan ? 'checked' : ''}> Plan deadlines</label>
        <span class="grow"></span>
        <button class="btn small" data-cnotify title="Reminders for your events and deadlines: a notification while PaperShelf is open (and from the system when it runs in the background)">🔔 Reminders: ${C.notify ? 'on' : 'off'}</button>
        <a class="btn small" href="/api/calendar.ics${q}" download title="A calendar file for Apple Calendar, Google Calendar or Outlook: open it or import it there">⭳ Export (.ics)</a>
      </div>
      ${C.view === 'month' ? monthHtml() : C.view === 'week' ? weekHtml() : agendaHtml()}
      <p class="muted small cal-note">Times are your local time. Reminders need PaperShelf to be running; exporting to your own calendar app gives alerts even when it is closed.</p></div>`;
  }

  /* ---------------------------------------------------------------- event window */
  async function eventDialog({item = null, date = '', sid = null} = {}) {
    const groups = (state.shares || []).filter(g => g.role === 'member');
    sid = item?.group || sid || C.group || groups[0]?.id;
    if (!sid) { toast('Create or join a group first (events belong to a group).', 'info'); return; }
    let L; try { L = await api(`/api/shares/${encodeURIComponent(sid)}/lab`); } catch (err) { toast(err.message, 'error'); return; }
    if (!L.can_write) { toast('You are a reader of this group: ask an editor to make you an editor to add events.', 'info'); return; }
    const ev = item ? (L.events.find(e => e.id === item.id) || {}) : {};
    const sel = new Set(ev.ids || []);
    const posts = L.posts.map(p => [p.id, p.title || (p.body || '').slice(0, 50) || 'Post']);
    const m = modal(`<h3>${item ? 'Event' : 'New event'}</h3>
      <div class="cal-form">
        ${!item && !C.group && groups.length > 1 ? `<label>Group<select class="input" id="ev-group">${groups.map(g => `<option value="${esc(g.id)}" ${g.id === sid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : ''}
        <label>Title<input class="input wide" id="ev-title" maxlength="200" value="${esc(ev.title || '')}" placeholder="e.g. PCR run, lab meeting, grant deadline"></label>
        <div class="cal-row"><label>Type<select class="input" id="ev-kind">${KINDS.map(([k, l]) => `<option value="${k}" ${(ev.kind || 'experiment') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Date<input class="input" type="date" id="ev-date" value="${esc(ev.date || date || C.today)}"></label>
          <label>Start<input class="input" type="time" id="ev-start" value="${esc(ev.start || '')}"></label>
          <label>End<input class="input" type="time" id="ev-end" value="${esc(ev.end || '')}"></label></div>
        <label>Place<input class="input wide" id="ev-place" maxlength="160" value="${esc(ev.place || '')}" placeholder="Room, microscope, video link…"></label>
        <label>Description<textarea class="input wide" id="ev-desc" rows="3" maxlength="5000" placeholder="What will happen, what to bring, the protocol…">${esc(ev.desc || '')}</textarea></label>
        <div><div class="cal-lbl">Who <span class="muted small">(nobody selected = everyone in the group)</span></div>
          <div class="lab-ppl" id="ev-ppl">${L.people.map(p => `<button type="button" class="lab-pp ${sel.has(p.id) ? 'on' : ''}" data-pp="${esc(p.id)}">${esc(p.id === L.me ? `${p.name} (you)` : p.name)}</button>`).join('')}</div></div>
        <div class="cal-row"><label>Reminder<select class="input" id="ev-remind">${REMIND.map(([v, l]) => `<option value="${v}" ${(ev.remind ?? 30) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Discussion<select class="input" id="ev-post"><option value="">${item ? 'None' : 'Create a discussion post'}</option>${item ? '' : '<option value="-">No discussion</option>'}${posts.map(([id, t]) => `<option value="${esc(id)}" ${ev.post === id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
        <p class="muted small">${item ? 'The discussion is the post of the group where this event is talked about.' : 'A new post is created in the group’s Ideas and discussion so everyone can comment before and after.'}</p>
      </div>
      <div class="modal-actions">${item ? `<button class="btn danger" id="ev-del">Delete</button><a class="btn" href="/api/calendar/item.ics?type=event&group=${encodeURIComponent(sid)}&id=${encodeURIComponent(item.id)}" download>Add to my calendar</a>` : ''}<span class="grow"></span>
        ${item?.post ? '<button class="btn" id="ev-open">Open discussion</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="ev-save">Save</button></div>`, {wide: true});
    $('#ev-ppl', m.el).addEventListener('click', e => e.target.closest('.lab-pp')?.classList.toggle('on'));
    const base = () => `/api/shares/${encodeURIComponent($('#ev-group', m.el)?.value || sid)}/lab/events`;
    $('#ev-save', m.el).onclick = async () => {
      const post = $('#ev-post', m.el).value;
      const body = {title: $('#ev-title', m.el).value, kind: $('#ev-kind', m.el).value, date: $('#ev-date', m.el).value, start: $('#ev-start', m.el).value, end: $('#ev-end', m.el).value,
        place: $('#ev-place', m.el).value, desc: $('#ev-desc', m.el).value, people: $$('.lab-pp.on', m.el).map(b => b.dataset.pp), remind: +$('#ev-remind', m.el).value};
      if (item) body.post = post; else if (post === '') body.make_post = true; else if (post && post !== '-') body.post = post;
      try { await api(item ? `${base()}/${encodeURIComponent(item.id)}` : base(), {method: item ? 'PUT' : 'POST', body}); }
      catch (err) { toast(err.message, 'error'); return; }
      m.close(); toast(item ? 'Event saved.' : 'Event added.', 'ok'); await reload();
    };
    $('#ev-del', m.el)?.addEventListener('click', async () => {
      if (!await confirmBox('Delete this event?', 'It disappears for everyone in the group (its discussion post stays).', {ok: 'Delete', danger: true})) return;
      try { await api(`${base()}/${encodeURIComponent(item.id)}`, {method: 'DELETE'}); } catch (err) { toast(err.message, 'error'); return; }
      m.close(); toast('Event deleted.', 'ok'); await reload();
    });
    $('#ev-open', m.el)?.addEventListener('click', () => { m.close(); Lab.openGroup(sid, {post: item.post}); });
  }
  async function reload() { await load(); render(); try { C.onChange?.(); } catch { /* ignore */ } }

  /* ---------------------------------------------------------------- reminders */
  const notified = new Set();
  async function poll() {
    let d; try { d = await api('/api/calendar/due', {method: 'POST', body: {}}); } catch { return; }
    for (const r of d.due || []) {
      if (notified.has(r.key + r.date)) continue; notified.add(r.key + r.date);
      toast(`🔔 ${r.head} – ${r.text}`, 'info', 20000);
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(r.head, {body: r.text, icon: '/static/icons/icon-192.png'}); } catch { /* ignore */ }
    }
  }
  async function toggleNotify() {
    const on = !C.notify;
    if (on && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* ignore */ } }
    try { const d = await api('/api/calendar/settings', {method: 'POST', body: {notify: on}}); C.notify = d.notify; } catch (err) { toast(err.message, 'error'); return; }
    toast(C.notify ? 'Reminders on.' + ('Notification' in window && Notification.permission === 'denied' ? ' (Browser notifications are blocked: reminders appear inside PaperShelf and as system notifications when it runs in the background.)' : '') : 'Reminders off.', 'ok');
    render();
  }

  /* ---------------------------------------------------------------- wiring */
  function bind(h) {
    if (h._calBound) return; h._calBound = true;
    h.addEventListener('click', async e => {
      const t = e.target;
      const nav = t.closest('[data-cnav]');
      if (nav) {
        const n = +nav.dataset.cnav;
        if (n === 0) C.cur = new Date(); else if (C.view === 'month') C.cur = new Date(C.cur.getFullYear(), C.cur.getMonth() + n, 1, 12); else C.cur = addDays(C.cur, 7 * n);
        render(); return;
      }
      const v = t.closest('[data-cview]'); if (v) { C.view = v.dataset.cview; store(); render(); return; }
      if (t.closest('[data-cnew]')) { eventDialog({date: C.today}); return; }
      if (t.closest('[data-cnotify]')) { toggleNotify(); return; }
      const more = t.closest('[data-cmore]'); if (more) { C.view = 'week'; C.cur = parse(more.dataset.cmore); store(); render(); return; }
      const ci = t.closest('[data-ci]');
      if (ci) {
        const i = C.items.find(x => x.key === ci.dataset.ci); if (!i) return;
        if (i.type === 'event') eventDialog({item: i}); else if (i.type === 'note') { Write.open(i.group, i.doc, {cm: i.cid}); } else if (i.type === 'task' || i.type === 'step') Lab.openGroup(i.group, {task: i.id}); else Lab.openGroup(i.group, {plan: i.id});
        return;
      }
      const cd = t.closest('[data-cd]'); if (cd && (C.canWrite || !C.group)) eventDialog({date: cd.dataset.cd});
    });
    h.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('[data-cmine]')) { C.mine = t.checked; store(); render(); }
      if (t.matches('[data-ctype]')) { C.types[t.dataset.ctype] = t.checked; render(); }
    });
  }
  async function mount(host, {group = null, canWrite = false, onChange = null} = {}) {
    C.host = host; C.group = group; C.canWrite = canWrite; C.onChange = onChange; bind(host);
    if (!C.items.length || C.loadedFor !== group) { host.innerHTML = '<p class="muted" style="padding:16px">Loading…</p>'; await load(); C.loadedFor = group; }
    render(); load().then(() => { if (C.host === host && host.isConnected) render(); });
  }
  const invalidate = () => { C.loadedFor = undefined; };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(poll, 4000); setInterval(poll, 60000); });
  return {mount, invalidate, eventDialog, upcoming: () => C.items};
})();
