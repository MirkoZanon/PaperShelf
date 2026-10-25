/* PaperShelf – shared lists: lists of papers (titles / DOIs only) shared with colleagues.
   They are separate from your groups: a paper can be in groups (your topics) and in shared lists
   ("from Mario", "lab journal club"). Papers that arrive stay in your library; if a list drops a
   paper, it only loses the list's label. */
'use strict';

const Shares = (() => {
  const byId = id => (state.shares || []).find(x => x.id === id);
  const editable = () => (state.shares || []).filter(x => x.role === 'member');
  const ago = iso => {
    if (!iso) return 'never';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
  };
  const publishReady = () => !!(state.settings.share_repo && state.settings.has_share_token);

  /* ------------------------------------------------------------ sidebar & list */
  function renderSidebar() {
    const el = $('#sharelist'); if (!el) return;
    const L = state.shares || [];
    el.innerHTML = L.length ? L.map(x => {
      const active = state.view.type === 'share' && state.view.id === x.id;
      const n = state.papers.filter(p => (p.share_ids || []).includes(x.id)).length;
      return `<div class="nav-item share-item ${x.role === 'member' ? 'editable' : ''} ${active ? 'active' : ''}" data-share="${esc(x.id)}"
          title="${x.role === 'member' ? 'Shared list – drag papers here to share them' : 'You follow this list (read-only)'}${x.last_error ? '\n⚠ ' + esc(x.last_error) : ''}">
          <span class="ico">${x.role === 'member' ? '🔗' : '📥'}</span><span class="label">${esc(x.name)}</span>
          ${x.last_error ? '<span class="warn-dot" title="Last update had a problem">!</span>' : ''}<span class="count">${n}</span>
          <span class="g-actions"><button title="Members, code, options" data-sact="manage" data-id="${esc(x.id)}">⚙︎</button></span></div>`;
    }).join('') : '<div class="empty-hint">Share lists of papers with colleagues (titles and DOIs only, never PDFs). Click ＋.</div>';
  }

  function viewSub(id) {
    const x = byId(id); if (!x) return '';
    const others = x.members.map(m => m.name).filter(n => n !== state.settings.share_repo?.split('/')[0] && !n.startsWith('local-'));
    const who = x.role === 'member'
      ? (others.length ? `Shared with ${others.map(esc).join(', ')}` : 'Only you so far – add members to share it')
      : `You follow this list (from ${esc((x.code || '').split('/')[0] || 'a file')})`;
    return `<span class="share-sub">${x.role === 'member' ? '🔗' : '📥'} ${who} · updated ${ago(x.last_pull || x.updated_at)}
      ${x.last_error ? ` · <span class="warn-txt" title="${esc(x.last_error)}">⚠ ${esc(truncate(x.last_error, 70))}</span>` : ''}
      <button class="linklike" data-sact="sync" data-id="${esc(id)}">⟳ Update now</button> · <button class="linklike" data-sact="manage" data-id="${esc(id)}">Members &amp; sharing…</button></span>`;
  }

  function bulkOptions() {
    const ed = editable();
    return `<option value="">Share…</option>${ed.map(x => `<option value="add:${esc(x.id)}">Add to “${esc(x.name)}”</option>`).join('')}<option value="__new">＋ New shared list with these…</option>`;
  }
  function bulk(v, ids) {
    if (v === '__new') return newDialog({paperIds: ids});
    if (v.startsWith('add:')) return addPapers(v.slice(4), ids);
  }

  function detailField(p) {
    const mine = (p.share_ids || []).map(byId).filter(Boolean);
    const can = editable().filter(x => !mine.includes(x));
    if (!mine.length && !(state.shares || []).length) return '';
    return `<div class="fld"><span>Shared lists <button class="help-q" data-help="sharing" title="Explain this">?</button></span><div class="share-chips">
      ${mine.map(x => `<span class="schip" title="${x.role === 'member' ? 'Remove from this list for everybody (their copies stay, without the label)' : 'Hide from this list for you'}">${x.role === 'member' ? '🔗' : '📥'} ${esc(x.name)}<button data-share-rm="${esc(x.id)}" title="Remove from list">×</button></span>`).join('')}
      ${can.length ? `<select class="share-add" data-share-add><option value="">＋ Share in…</option>${can.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>` : ''}
      ${!mine.length && !can.length ? '<span class="muted small">Not in any shared list.</span>' : ''}</div></div>`;
  }

  /* ------------------------------------------------------------ actions */
  async function refresh() { await loadLibrary(); }

  async function addPapers(id, ids) {
    const x = byId(id); if (!x || !ids.length) return;
    try {
      await api(`/api/shares/${id}/papers`, {method: 'POST', body: {paper_ids: ids}});
      await refresh();
      toast(`${ids.length} paper${ids.length > 1 ? 's' : ''} shared in “${x.name}”${publishReady() ? ' – publishing…' : ''}.`, 'ok');
    } catch (err) { toast(err.message, 'error', 9000); }
  }
  async function removePapers(id, ids) {
    const x = byId(id); if (!x || !ids.length) return;
    const ok = await confirmBox(`Remove ${ids.length > 1 ? `${ids.length} papers` : 'this paper'} from “${x.name}”?`,
      x.role === 'member' ? 'They leave the shared list for everybody. The papers stay in your library and in everybody else’s – only the list label goes.'
        : 'You follow this list: they are hidden from it only for you. They stay in your library.', {ok: 'Remove'});
    if (!ok) return;
    try { await api(`/api/shares/${id}/papers`, {method: 'POST', body: {paper_ids: ids, action: 'remove'}}); state.selected.clear(); await refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function syncNow(id = null, quiet = false) {
    const t = quiet ? null : toast('Updating shared lists…', 'info', 0);
    try {
      const d = await api('/api/shares/sync', {method: 'POST', body: id ? {id} : {}});
      t?.close(); await refresh();
      const L = Object.values(d.result.lists);
      const added = L.reduce((n, r) => n + (r.added || 0), 0), un = L.reduce((n, r) => n + (r.untagged || 0), 0);
      const errs = L.filter(r => r.error || (r.errors || []).length).length;
      if (!quiet) toast(`Shared lists updated${added ? ` · ${added} new paper${added > 1 ? 's' : ''}` : ''}${un ? ` · ${un} left a list` : ''}${d.result.restored ? ` · ${d.result.restored} list(s) restored from your repository` : ''}${errs ? ' · some members could not be read (see the list)' : ''}.`, errs ? 'info' : 'ok', 7000);
    } catch (err) { t?.close(); if (!quiet) toast(err.message, 'error', 9000); }
  }

  /* ------------------------------------------------------------ dialogs */
  function startMenu() {
    const m = modal(`<h3>Shared lists <span class="grow"></span><button class="btn small" data-help="sharing">📘 How sharing works</button></h3>
      <p class="muted small">Share lists of papers with colleagues – only titles, authors, year, journal and DOI travel, never PDFs, notes or highlights. Papers you receive are added to your library with the list's label; they stay yours even if the list changes.</p>
      <div class="share-start">
        <button class="share-opt" data-o="new"><b>＋ New shared list</b><small>From a group, from selected papers, or empty</small></button>
        <button class="share-opt" data-o="join"><b>⤵ Join a list</b><small>With the code or the GitHub name a colleague gave you</small></button>
        <button class="share-opt" data-o="file"><b>📄 Open a list file</b><small>A .papershelf file received by e-mail or chat</small></button>
      </div>
      ${publishReady() ? '' : `<p class="warn-box small">To publish lists online and share with others, set up <b>Sharing</b> once in ⚙︎ Settings (5 minutes). Without it you can still join and follow other people’s lists, and send lists as files.</p>`}
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    m.el.addEventListener('click', e => {
      const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
      m.close();
      if (o === 'new') newDialog({paperIds: [...state.selected]});
      if (o === 'join') joinDialog();
      if (o === 'file') pickFile();
    });
  }

  function newDialog({paperIds = [], fromGroup = null} = {}) {
    const gid = fromGroup ?? (state.view.type === 'group' ? state.view.id : null);
    const m = modal(`<h3>New shared list</h3>
      <label class="fld"><span>Name</span><input class="input wide" id="sh-name" placeholder="e.g. Journal club – visual cortex" value="${gid && !paperIds.length ? esc(state.groups.find(g => g.id === gid)?.name || '') : ''}"></label>
      <label class="fld"><span>Description <em>(optional)</em></span><input class="input wide" id="sh-desc" placeholder="What is this list for?"></label>
      <div class="fld"><span>Start with</span>
        ${paperIds.length ? `<label class="opt"><input type="radio" name="sh-src" value="sel" checked><span>The ${paperIds.length} selected paper${paperIds.length > 1 ? 's' : ''}</span></label>` : ''}
        ${state.groups.length ? `<label class="opt"><input type="radio" name="sh-src" value="group" ${!paperIds.length && gid ? 'checked' : ''}><span>All papers of the group <select id="sh-group">${groupOptions()}</select><small>A copy of the group's papers today – later, add papers by dragging them onto the list.</small></span></label>` : ''}
        <label class="opt"><input type="radio" name="sh-src" value="empty" ${!paperIds.length && !gid ? 'checked' : ''}><span>Empty – I'll drag papers onto it</span></label></div>
      ${publishReady() ? '<p class="muted small">After creating it, add members (their GitHub names) and give them the list’s code.</p>'
        : '<p class="warn-box small">Sharing isn’t set up yet: the list is kept here and can be sent as a file. Set up Sharing in ⚙︎ Settings to publish it and keep it in sync with others.</p>'}
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sh-create">Create list</button></div>`);
    if (gid && $('#sh-group', m.el)) $('#sh-group', m.el).value = gid;
    $('#sh-create', m.el).onclick = async () => {
      const name = $('#sh-name', m.el).value.trim(); if (!name) { $('#sh-name', m.el).focus(); return; }
      const src = $('input[name=sh-src]:checked', m.el)?.value;
      const body = {name, description: $('#sh-desc', m.el).value};
      if (src === 'sel') body.paper_ids = paperIds;
      if (src === 'group') body.from_group = +$('#sh-group', m.el).value;
      try {
        const d = await api('/api/shares', {method: 'POST', body});
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        toast(`Shared list “${d.share.name}” created with ${d.share.papers} paper${d.share.papers === 1 ? '' : 's'}.`, 'ok');
        if (publishReady()) manageDialog(d.share.id, {focusMember: true});
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function joinDialog(prefill = '') {
    const m = modal(`<h3>Join a shared list</h3>
      <p class="muted small">Type what your colleague gave you: the <b>list code</b> (e.g. <code>MarioRossi/3f2a9c1e0b7d</code>), or just their <b>GitHub name</b> to see their lists. Their papers are added to your library with the list’s label.</p>
      <div style="display:flex;gap:6px"><input class="input" id="sh-code" style="flex:1" placeholder="MarioRossi  or  MarioRossi/3f2a9c1e0b7d" value="${esc(prefill)}"><button class="btn primary" id="sh-look">Look up</button></div>
      <div id="sh-found" style="margin-top:10px"></div>
      ${state.groups.length ? `<label class="opt" style="margin-top:8px"><input type="checkbox" id="sh-g-on"><span>Also put the papers I receive in my group <select id="sh-g">${groupOptions()}</select><small>Optional – shared lists and groups stay separate otherwise.</small></span></label>` : ''}
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    const join = async (code, id = null) => {
      const res = $('#sh-found', m.el); res.innerHTML = '<p class="muted">Looking on GitHub…</p>';
      const body = {code, id};
      if ($('#sh-g-on', m.el)?.checked) body.group_id = +$('#sh-g', m.el).value;
      try {
        const d = await api('/api/shares/join', {method: 'POST', body});
        if (d.choose) {
          res.innerHTML = d.choose.length ? `<p class="muted small">Lists shared by <b>${esc(d.owner)}</b>:</p>` + d.choose.map(x => `<div class="share-found">
              <div><b>${esc(x.name)}</b><div class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} · members: ${esc((x.members || []).join(', '))}${x.description ? ' · ' + esc(x.description) : ''}</div></div>
              ${x.joined ? '<span class="muted small">already joined</span>' : `<button class="btn small primary" data-join="${esc(x.id)}">Join</button>`}</div>`).join('')
            : `<p class="muted">${esc(d.owner)} has no shared lists yet.</p>`;
          return;
        }
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        toast(`Joined “${d.share.name}”: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'} added, ${d.stats.tagged} you already had.${d.share.role === 'follower' ? ' You follow it (read-only) – to add papers, ask its owner to add you as a member.' : ''}`, 'ok', 10000);
      } catch (err) { res.innerHTML = `<p class="up-err">✗ ${esc(err.message)}</p>`; }
    };
    $('#sh-look', m.el).onclick = () => { const c = $('#sh-code', m.el).value.trim(); if (c) join(c); };
    $('#sh-code', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') $('#sh-look', m.el).click(); });
    $('#sh-found', m.el).addEventListener('click', e => { const b = e.target.closest('[data-join]'); if (b) join($('#sh-code', m.el).value.trim(), b.dataset.join); });
    if (prefill) join(prefill);
  }

  function pickFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.papershelf,.json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      try {
        const d = await api('/api/shares/import', {method: 'POST', form: fd});
        await refresh(); setView({type: 'share', id: d.share.id});
        toast(`List “${d.share.name}” opened: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'}, ${d.stats.tagged} already in your library.`, 'ok', 9000);
      } catch (err) { toast(err.message, 'error'); }
    };
    inp.click();
  }

  function manageDialog(id, {focusMember = false} = {}) {
    const x = byId(id); if (!x) return;
    const me = (state.settings.share_repo || '').split('/')[0];
    const member = x.role === 'member';
    const m = modal(`<h3>${member ? '🔗' : '📥'} ${esc(x.name)} <span class="grow"></span><button class="btn small" data-help="sharing">📘 Guide</button></h3>
      ${member ? `<label class="fld"><span>Name</span><input class="input wide" id="sm-name" value="${esc(x.name)}"></label>
        <label class="fld"><span>Description</span><input class="input wide" id="sm-desc" value="${esc(x.description || '')}" placeholder="optional"></label>`
        : `<p class="muted">${x.description ? esc(x.description) + '<br>' : ''}You <b>follow</b> this list: you receive its papers and updates, but can't change it. To add papers too, ask a member to add your GitHub name${me ? ` (<b>${esc(me)}</b>)` : ''}.</p>`}
      <div class="section-label">Members</div>
      <div class="share-members">${x.members.map(mb => `<span class="chip">${esc(mb.name.startsWith('local-') ? 'this computer (not published)' : mb.name)}${mb.name === me ? ' (you)' : ''}${member && mb.name !== me && !mb.name.startsWith('local-') ? `<button data-mrm="${esc(mb.name)}" title="Remove member">×</button>` : ''}</span>`).join('')}</div>
      ${member ? (x.can_publish ? `<div style="display:flex;gap:6px;margin-top:6px"><input class="input" id="sm-new" style="flex:1" placeholder="Colleague's GitHub name, e.g. MarioRossi"><button class="btn" id="sm-add">Add member</button></div>
          <p class="muted small">Members can add and remove papers; everybody's changes reach everybody, also through other members. Each member needs their own Sharing set-up (⚙︎ Settings).</p>`
        : '<p class="warn-box small">Set up Sharing in ⚙︎ Settings to publish this list and add members.</p>') : ''}
      <div class="section-label">Give it to colleagues</div>
      ${x.code ? `<div class="share-code"><code id="sm-code">${esc(x.code)}</code><button class="btn small" id="sm-copy">Copy code</button></div>
        <p class="muted small">They open PaperShelf → Shared lists ＋ → <i>Join a list</i> and paste this code. Anyone with the code can <b>follow</b> the list (read-only); members can also edit it.${x.published ? '' : ' <b>Not published yet</b> – click “Update now”.'}</p>` : '<p class="muted small">This list isn’t published online.</p>'}
      <button class="btn small" id="sm-export">📄 Save as file (.papershelf)</button> <span class="muted small">to send by e-mail – it contains titles and DOIs only</span>
      <div class="section-label">In my library</div>
      ${state.groups.length ? `<label class="opt"><input type="checkbox" id="sm-g-on" ${x.group_id ? 'checked' : ''}><span>Also put papers that arrive from this list in my group <select id="sm-g">${groupOptions()}</select></span></label>` : ''}
      <p class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} in the list · updated ${ago(x.last_pull)}${x.last_push ? ` · published ${ago(x.last_push)}` : ''}${x.last_error ? `<br><span class="warn-txt">⚠ ${esc(x.last_error)}</span>` : ''}</p>
      <div class="modal-actions"><button class="btn danger" id="sm-leave">${member ? 'Leave / stop sharing' : 'Stop following'}</button><span class="grow"></span>
        <button class="btn" id="sm-sync">⟳ Update now</button><button class="btn" data-close>Close</button>${member ? '<button class="btn primary" id="sm-save">Save</button>' : ''}</div>`, {wide: true});
    if (x.group_id && $('#sm-g', m.el)) $('#sm-g', m.el).value = x.group_id;
    if (focusMember) setTimeout(() => $('#sm-new', m.el)?.focus(), 60);
    const saveGroup = () => $('#sm-g-on', m.el) ? api(`/api/shares/${id}`, {method: 'PUT', body: {group_id: $('#sm-g-on', m.el).checked ? +$('#sm-g', m.el).value : null}}) : null;
    $('#sm-g-on', m.el)?.addEventListener('change', () => { if (!member) saveGroup()?.then(refresh).catch(e => toast(e.message, 'error')); });
    $('#sm-save', m.el)?.addEventListener('click', async () => {
      try { await api(`/api/shares/${id}`, {method: 'PUT', body: {name: $('#sm-name', m.el).value, description: $('#sm-desc', m.el).value}}); await saveGroup(); m.close(); await refresh(); toast('Saved.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    });
    const addMember = async () => {
      const name = $('#sm-new', m.el).value.trim(); if (!name) return;
      try { await api(`/api/shares/${id}/members`, {method: 'POST', body: {name}}); m.close(); await refresh(); manageDialog(id); toast(`${name} added. Send them the code ${byId(id)?.code || ''}.`, 'ok', 9000); }
      catch (err) { toast(err.message, 'error'); }
    };
    $('#sm-add', m.el)?.addEventListener('click', addMember);
    $('#sm-new', m.el)?.addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });
    m.el.addEventListener('click', async e => {
      const rm = e.target.closest('[data-mrm]'); if (!rm) return;
      const ok = await confirmBox(`Remove ${rm.dataset.mrm} from the members?`, 'They keep the papers they already have; they stop receiving changes from the members, and their changes are no longer read.', {ok: 'Remove'});
      if (!ok) return;
      try { await api(`/api/shares/${id}/members`, {method: 'POST', body: {name: rm.dataset.mrm, remove: true}}); m.close(); await refresh(); manageDialog(id); }
      catch (err) { toast(err.message, 'error'); }
    });
    $('#sm-copy', m.el)?.addEventListener('click', () => { navigator.clipboard?.writeText(x.code).then(() => toast('Code copied.', 'ok')).catch(() => {}); });
    $('#sm-export', m.el).onclick = () => { location.href = `/api/shares/${id}/export`; };
    $('#sm-sync', m.el).onclick = async () => { setBusy($('#sm-sync', m.el), true, 'Updating…'); await syncNow(id); m.close(); manageDialog(id); };
    $('#sm-leave', m.el).onclick = async () => {
      const ok = await confirmBox(member ? `Leave “${x.name}”?` : `Stop following “${x.name}”?`,
        'The papers stay in your library – only the list and its label go away from this computer.' + (member ? ' The other members keep the list.' : ''), {ok: member ? 'Leave' : 'Stop following', danger: true});
      if (!ok) return;
      try { await api(`/api/shares/${id}`, {method: 'DELETE'}); m.close(); if (state.view.type === 'share' && state.view.id === id) state.view = {type: 'all'}; await refresh(); toast('Done – the papers are still in your library.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ------------------------------------------------------------ settings section */
  function settingsHtml(s) {
    return `<div class="section-label">Sharing lists with colleagues <button class="help-q" data-help="sharing" title="Explain this">?</button></div>
      <p class="muted small">To <b>publish</b> lists (titles and DOIs only) you need a small <b>public</b> GitHub repository, e.g. <code>your-name/papershelf-shared</code>, and a token that can write to it. To only <b>join</b> other people’s lists you need nothing. <button class="linklike" data-help="sharing">Step-by-step guide</button></p>
      <input class="input wide" id="set-share-repo" value="${esc(s.share_repo || '')}" placeholder="your-github-name/papershelf-shared">
      <input class="input wide" id="set-share-token" type="password" style="margin-top:6px" autocomplete="off" placeholder="${s.has_share_token ? '•••••••• token saved – paste a new one to replace it' : 'GitHub token for that repository (github_pat_…)'}">
      <label class="opt" style="margin-top:8px"><input type="checkbox" id="set-share-auto" ${s.share_auto !== '' ? 'checked' : ''}><span>Update shared lists automatically<small>When PaperShelf starts and every 15 minutes; changes you make are published right away.</small></span></label>
      <div class="sync-actions"><button class="btn small" id="share-test">Test</button><span id="share-test-res" class="muted small"></span></div>`;
  }
  function settingsBind(m) {
    $('#share-test', m.el).onclick = async () => {
      const r = $('#share-test-res', m.el); r.textContent = 'Testing…';
      try { const d = await api('/api/shares/test', {method: 'POST', body: {share_repo: $('#set-share-repo', m.el).value, share_token: $('#set-share-token', m.el).value}});
        r.innerHTML = `<span style="color:var(--ok)">✓ ${esc(d.repo)} is ready. Click Save.</span>`; }
      catch (err) { r.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
    };
  }
  function settingsValues(m) {
    return {share_repo: $('#set-share-repo', m.el).value, share_token: $('#set-share-token', m.el).value, share_auto: $('#set-share-auto', m.el).checked};
  }

  /* ------------------------------------------------------------ wiring */
  function init() {
    $('#new-share')?.addEventListener('click', e => { e.stopPropagation(); startMenu(); });
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-sact]'); if (!a) return;
      e.stopPropagation();
      if (a.dataset.sact === 'manage') manageDialog(a.dataset.id);
      if (a.dataset.sact === 'sync') syncNow(a.dataset.id);
    }, true);
    const body = $('#detail-body');
    body?.addEventListener('click', e => {
      const rm = e.target.closest('[data-share-rm]'); if (rm && state.openId) removePapers(rm.dataset.shareRm, [state.openId]);
    });
    body?.addEventListener('change', e => {
      if (e.target.matches('[data-share-add]') && e.target.value && state.openId) { const v = e.target.value; e.target.value = ''; addPapers(v, [state.openId]); }
    });
    // pick up changes made by the background updates
    setInterval(() => { if (!document.hidden && (state.shares || []).length) api('/api/shares').then(d => {
      const before = JSON.stringify((state.shares || []).map(x => [x.id, x.papers, x.last_pull]));
      if (JSON.stringify(d.shares.map(x => [x.id, x.papers, x.last_pull])) !== before) loadLibrary().catch(() => {});
    }).catch(() => {}); }, 60000);
  }
  init();

  return {renderSidebar, viewSub, bulkOptions, bulk, detailField, addPapers, removePapers, syncNow, newDialog, joinDialog,
    manageDialog, startMenu, settingsHtml, settingsBind, settingsValues};
})();
