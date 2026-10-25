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
  const publishReady = () => !!(state.settings.share_gist && state.settings.share_user);
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const pname = p => p.id.startsWith('local-') ? (p.you ? (state.settings.display_name || 'You') : 'someone (not published)') : (p.name || p.id);
  const pTip = p => [p.id.startsWith('local-') ? '' : `GitHub: ${p.id}`, p.creator ? 'created this label' : '', p.joined ? (p.since ? `taking part since ${new Date(p.since).toLocaleDateString()}` : 'has joined') : 'invited – not joined yet',
    `${p.papers} paper${p.papers === 1 ? '' : 's'} added`, `${p.notes} public note${p.notes === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  function personChip(p, {remove = false} = {}) {
    return `<span class="person ${p.joined ? '' : 'invited'}" title="${esc(pTip(p))}"><span class="p-av" style="background:hsl(${hue(p.id)} 55% 46%)">${esc(initials(pname(p)))}</span>
      <span class="p-name">${esc(pname(p))}</span>${p.you ? '<span class="p-tag">you</span>' : ''}${p.creator ? '<span class="p-tag">creator</span>' : ''}${p.joined ? '' : '<span class="p-tag">invited</span>'}
      ${remove && !p.you && !p.id.startsWith('local-') ? `<button data-mrm="${esc(p.id)}" title="Remove from the members">×</button>` : ''}</span>`;
  }
  function peopleList(x, opts = {}) {
    const P = x.people || [];
    return `<div class="people-list">${P.map(p => `<div class="person-row">${personChip(p, opts)}<span class="muted small">${esc(p.id.startsWith('local-') ? '' : '@' + p.id)}${p.joined ? '' : ' · not joined yet'} · ${p.papers} paper${p.papers === 1 ? '' : 's'} · ${p.notes} note${p.notes === 1 ? '' : 's'}</span></div>`).join('')}</div>
      <p class="muted small">Everybody's name and contributions update together with the papers and notes. People who only <i>follow</i> the label with the code (read-only) don't publish anything, so they aren't listed.</p>`;
  }
  const me = () => state.settings.share_user || '';

  /* ------------------------------------------------------------ sidebar & list */
  function renderSidebar() {
    const el = $('#sharelist'); if (!el) return;
    const L = state.shares || [];
    el.innerHTML = L.length ? L.map(x => {
      const active = state.view.type === 'share' && state.view.id === x.id;
      const n = state.papers.filter(p => (p.share_ids || []).includes(x.id)).length;
      return `<div class="nav-item share-item ${x.role === 'member' ? 'editable' : ''} ${active ? 'active' : ''}" data-share="${esc(x.id)}"
          title="${x.role === 'member' ? 'Shared label – drag papers here to share them' : 'You follow this shared label (read-only)'}${x.creator && x.creator.by ? '\nCreated by ' + esc(x.creator.name || x.creator.by) : ''}${x.last_error ? '\n⚠ ' + esc(x.last_error) : ''}">
          <span class="caret invisible"></span><span class="ico">${labelIcon(x.color, x.role === 'member' ? '🔗' : '📥')}</span><span class="label">${esc(x.name)}</span>
          ${x.last_error ? '<span class="warn-dot" title="Last update had a problem">!</span>' : ''}<span class="count">${n}</span>
          <span class="g-actions"><button title="Colour (only on this computer)" data-sact="color" data-id="${esc(x.id)}">🎨</button><button title="Invite colleagues – get the code" data-sact="invite" data-id="${esc(x.id)}">📤</button><button title="Members and options" data-sact="manage" data-id="${esc(x.id)}">⚙︎</button></span></div>`;
    }).join('') : '<div class="empty-hint">Share labels with colleagues – titles and DOIs only. ＋ to create or join.</div>';
  }

  function viewSub(id) {
    const x = byId(id); if (!x) return '';
    const P = x.people || [];
    const who = x.role === 'member'
      ? (P.length > 1 ? '' : 'Only you so far – invite colleagues to share it')
      : `You follow this label (read-only)`;
    const ppl = P.length ? `<span class="share-people" data-sact="people" data-id="${esc(id)}" title="Who takes part – click for details">👥 ${P.slice(0, 8).map(p => personChip(p)).join('')}${P.length > 8 ? `<span class="muted small">+${P.length - 8}</span>` : ''}</span>` : '';
    return `<span class="share-sub">${ppl}${x.role === 'member' ? '🔗' : '📥'} ${who ? who + ' · ' : ''}updated ${ago(x.last_pull || x.updated_at)}
      ${x.last_error ? ` · <span class="warn-txt" title="${esc(x.last_error)}">⚠ ${esc(truncate(x.last_error, 70))}</span>` : ''}
      <button class="linklike" data-sact="sync" data-id="${esc(id)}">⟳ Update now</button> · <button class="linklike" data-sact="manage" data-id="${esc(id)}">Settings…</button>
      <button class="btn small primary invite-btn" data-sact="invite" data-id="${esc(id)}" title="Get the code to give to colleagues">📤 Invite colleagues / code</button></span>`;
  }

  function bulkOptions() {
    const ed = editable();
    return `<option value="">Share…</option>${ed.map(x => `<option value="add:${esc(x.id)}">Add to “${esc(x.name)}”</option>`).join('')}<option value="__new">＋ New shared label with these…</option>`;
  }
  function bulk(v, ids) {
    if (v === '__new') return newDialog({paperIds: ids});
    if (v.startsWith('add:')) return addPapers(v.slice(4), ids);
  }

  function detailField(p) {
    const mine = (p.share_ids || []).map(byId).filter(Boolean);
    const can = editable().filter(x => !mine.includes(x));
    if (!mine.length && !(state.shares || []).length) return '';
    return `<div class="fld"><span>Shared labels <button class="help-q" data-help="sharing" title="Explain this">?</button></span><div class="share-chips">
      ${mine.map(x => `<span class="schip ${x.color ? 'colored' : ''}"${chipStyle(x.color)} title="${x.role === 'member' ? 'Remove this shared label for everybody (their copies stay, without the label)' : 'Hide this shared label for you'}">${x.role === 'member' ? '🔗' : '📥'} ${esc(x.name)}<button data-share-rm="${esc(x.id)}" title="Remove">×</button></span>`).join('')}
      ${can.length ? `<select class="share-add" data-share-add><option value="">＋ Share in…</option>${can.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>` : ''}
      ${!mine.length && !can.length ? '<span class="muted small">Not shared.</span>' : ''}</div></div>`;
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
    const ok = await confirmBox(`Remove the shared label “${x.name}” from ${ids.length > 1 ? `${ids.length} papers` : 'this paper'}?`,
      x.role === 'member' ? 'The shared label is removed for everybody. The papers stay in your library and in everybody else’s – only the label goes.'
        : 'You follow this label: it is removed only for you. The papers stay in your library.', {ok: 'Remove'});
    if (!ok) return;
    try { await api(`/api/shares/${id}/papers`, {method: 'POST', body: {paper_ids: ids, action: 'remove'}}); state.selected.clear(); await refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function syncNow(id = null, quiet = false) {
    const t = quiet ? null : toast('Updating shared labels…', 'info', 0);
    try {
      const d = await api('/api/shares/sync', {method: 'POST', body: id ? {id} : {}});
      t?.close(); await refresh();
      const L = Object.values(d.result.lists);
      const added = L.reduce((n, r) => n + (r.added || 0), 0), un = L.reduce((n, r) => n + (r.untagged || 0), 0);
      const errs = L.filter(r => r.error || (r.errors || []).length).length;
      if (!quiet) toast(`Shared labels updated${added ? ` · ${added} new paper${added > 1 ? 's' : ''}` : ''}${un ? ` · ${un} lost a shared label` : ''}${d.result.restored ? ` · ${d.result.restored} label(s) restored from your gist` : ''}${errs ? ' · some members could not be read (see the label)' : ''}.`, errs ? 'info' : 'ok', 7000);
    } catch (err) { t?.close(); if (!quiet) toast(err.message, 'error', 9000); }
  }

  /* ------------------------------------------------------------ dialogs */
  function startMenu() {
    const m = modal(`<h3>Shared labels <span class="grow"></span><button class="btn small" data-help="sharing">📘 How sharing works</button></h3>
      <p class="muted small">Share labels with colleagues – only titles, authors, year, journal and DOI travel, plus the public notes members write – never PDFs, private notes or highlights. Papers you receive are added to your library with the shared label; they stay yours even if the label changes.</p>
      <div class="share-start">
        <button class="share-opt" data-o="new"><b>＋ New shared label</b><small>From a group, from selected papers, or empty</small></button>
        <button class="share-opt" data-o="join"><b>⤵ Join a shared label</b><small>With the code or the GitHub name a colleague gave you</small></button>
        <button class="share-opt" data-o="file"><b>📄 Open a label file</b><small>A .papershelf file received by e-mail or chat</small></button>
      </div>
      ${publishReady() ? '' : `<p class="warn-box small">To share your own labels online, turn on sharing once in ⚙︎ Settings → 👥 Sharing (2 minutes). Without it you can still join and follow your colleagues’ labels, and send labels as files.</p>`}
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
    const m = modal(`<h3>New shared label</h3>
      <label class="fld"><span>Name</span><input class="input wide" id="sh-name" placeholder="e.g. Journal club – visual cortex" value="${gid && !paperIds.length ? esc(state.groups.find(g => g.id === gid)?.name || '') : ''}"></label>
      <label class="fld"><span>Description <em>(optional)</em></span><input class="input wide" id="sh-desc" placeholder="What is this label for?"></label>
      <div class="fld"><span>Start with</span>
        ${paperIds.length ? `<label class="opt"><input type="radio" name="sh-src" value="sel" checked><span>The ${paperIds.length} selected paper${paperIds.length > 1 ? 's' : ''}</span></label>` : ''}
        ${state.groups.length ? `<label class="opt"><input type="radio" name="sh-src" value="group" ${!paperIds.length && gid ? 'checked' : ''}><span>All papers with my label <select id="sh-group">${groupOptions()}</select><small>The papers that have that label today – later, add papers by dragging them onto the shared label.</small></span></label>` : ''}
        <label class="opt"><input type="radio" name="sh-src" value="empty" ${!paperIds.length && !gid ? 'checked' : ''}><span>Empty – I'll drag papers onto it</span></label></div>
      ${publishReady() ? '<p class="muted small">After creating it, add members (their GitHub names) and give them the code.</p>'
        : '<p class="warn-box small">Sharing isn’t turned on yet: the label is kept here and can be sent as a file. Turn on sharing in ⚙︎ Settings → 👥 Sharing to keep it in sync with others.</p>'}
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sh-create">Create shared label</button></div>`);
    if (gid && $('#sh-group', m.el)) $('#sh-group', m.el).value = gid;
    $('#sh-create', m.el).onclick = async () => {
      const name = $('#sh-name', m.el).value.trim(); if (!name) { $('#sh-name', m.el).focus(); return; }
      const src = $('input[name=sh-src]:checked', m.el)?.value;
      if (publishReady() && typeof Notes !== 'undefined' && !(await Notes.ensureName('the shared labels you create'))) return;
      const body = {name, description: $('#sh-desc', m.el).value};
      if (src === 'sel') body.paper_ids = paperIds;
      if (src === 'group') body.from_group = +$('#sh-group', m.el).value;
      try {
        const d = await api('/api/shares', {method: 'POST', body});
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        toast(`Shared label “${d.share.name}” created with ${d.share.papers} paper${d.share.papers === 1 ? '' : 's'}.`, 'ok');
        inviteDialog(d.share.id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function joinDialog(prefill = '') {
    const m = modal(`<h3>Join a shared label</h3>
      <p class="muted small">Paste the <b>code</b> your colleague sent you – it looks like <code>MarioRossi/1a2b…/9f8e…</code>. Its papers are added to your library with the shared label.</p>
      <p class="muted small">No code yet? Ask your colleague: in their PaperShelf they click the shared label in the sidebar (Labels → Shared), then the blue <b>📤 Invite colleagues / code</b> button above the list, and send you the code.</p>
      <div style="display:flex;gap:6px"><input class="input" id="sh-code" style="flex:1" placeholder="MarioRossi/1a2b3c…/9f8e7d…" value="${esc(prefill)}"><button class="btn primary" id="sh-look">Look up</button></div>
      <div id="sh-found" style="margin-top:10px"></div>
      ${state.groups.length ? `<label class="opt" style="margin-top:8px"><input type="checkbox" id="sh-g-on"><span>Also give the papers I receive my label <select id="sh-g">${groupOptions()}</select><small>Optional – shared and personal labels stay separate otherwise.</small></span></label>` : ''}
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    const join = async (code, id = null) => {
      const res = $('#sh-found', m.el); res.innerHTML = '<p class="muted">Looking on GitHub…</p>';
      const body = {code, id};
      if ($('#sh-g-on', m.el)?.checked) body.group_id = +$('#sh-g', m.el).value;
      try {
        const d = await api('/api/shares/join', {method: 'POST', body});
        if (d.choose) {
          res.innerHTML = d.choose.length ? `<p class="muted small">Labels shared by <b>${esc(d.owner)}</b>:</p>` + d.choose.map(x => `<div class="share-found">
              <div><b>${esc(x.name)}</b><div class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} · members: ${esc((x.members || []).join(', '))}${x.description ? ' · ' + esc(x.description) : ''}</div></div>
              ${x.joined ? '<span class="muted small">already joined</span>' : `<button class="btn small primary" data-join="${esc(x.id)}">Join</button>`}</div>`).join('')
            : `<p class="muted">${esc(d.owner)} has no shared labels yet.</p>`;
          return;
        }
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        toast(`Joined “${d.share.name}”: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'} added, ${d.stats.tagged} you already had.${d.share.role === 'follower' ? ' You follow it (read-only) – to add papers too, ask a member to add your GitHub name, then join again.' : ''}`, 'ok', 10000);
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
        toast(`Shared label “${d.share.name}” opened: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'}, ${d.stats.tagged} already in your library.`, 'ok', 9000);
      } catch (err) { toast(err.message, 'error'); }
    };
    inp.click();
  }

  const copy = (text, what) => {
    const ok = () => toast(`${what} copied – paste it in an e-mail or chat.`, 'ok');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
    else fallbackCopy(text, ok);
  };
  function fallbackCopy(text, ok) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast('Select the code and copy it with ⌘C / Ctrl+C.', 'info'); }
    ta.remove();
  }
  const invitation = x => `Hi! I'm sharing the paper list “${x.name}” with you in PaperShelf.\n\n` +
    `1. Install PaperShelf (free): https://github.com/MirkoZanon/PaperShelf\n` +
    `2. In PaperShelf, sidebar → Labels → Shared ＋ → “Join a shared label”\n` +
    `3. Paste this code: ${x.code}\n\nOnly titles, authors and DOIs are shared (plus the notes we decide to make public).`;

  async function inviteDialog(id) {
    let x = byId(id); if (!x) return;
    const member = x.role === 'member';
    if (member && x.can_publish && !x.published) { await syncNow(id, true); x = byId(id) || x; }  // publish before giving the code
    const others = x.members.filter(mb => !mb.you && !mb.name.startsWith('local-'));
    const ready = !!x.code;
    const m = modal(`<h3>📤 Invite colleagues to “${esc(x.name)}” <span class="grow"></span><button class="btn small" data-help="sharing">📘 Guide</button></h3>
      ${ready ? `
      <div class="invite-step"><span class="num">1</span><div><b>Copy the code of this label</b>
        <div class="invite-code"><code id="iv-code">${esc(x.code)}</code><button class="btn primary" id="iv-copy">📋 Copy code</button></div>
        <button class="linklike small" id="iv-msg">or copy a ready-made invitation message (with instructions)</button></div></div>
      <div class="invite-step"><span class="num">2</span><div><b>Send it to your colleagues</b> by e-mail, chat… <span class="muted small">The code is not secret like a password, but only people who have it can see the label.</span></div></div>
      <div class="invite-step"><span class="num">3</span><div><b>They paste it in their PaperShelf</b>: sidebar → Labels → <b>Shared ＋</b> → <i>Join a shared label</i>. The papers appear in their library, with the label.</div></div>
      ${member ? `<div class="section-label">Should they also add papers and write public notes?</div>
        ${x.can_publish ? `<p class="muted small">With the code alone they <b>follow</b> the label (read-only). To let someone edit it, add their <b>GitHub user name</b> here <i>before</i> they join (they also turn on sharing once in their Settings).</p>
          <div class="share-members">${(x.people || []).map(p => personChip(p)).join('')}</div>
          <div style="display:flex;gap:6px;margin-top:6px"><input class="input" id="iv-new" style="flex:1" placeholder="Colleague's GitHub name, e.g. MarioRossi"><button class="btn" id="iv-add">Add as member</button></div>` : ''}` : `<p class="muted small">You follow this label: anyone you give this code to can follow it too (read-only).</p>`}`
      : `<div class="warn-box"><b>This label isn't online yet, so it has no code.</b><br>To get a code, turn on sharing once (2 minutes, free GitHub account): ⚙︎ Settings → <b>👥 Sharing</b>.
          <div style="margin-top:8px"><button class="btn small primary" id="iv-settings">Open sharing settings</button></div></div>`}
      <div class="section-label">Without GitHub</div>
      <p class="muted small"><button class="btn small" id="iv-file">📄 Save as file (.papershelf)</button> and send it by e-mail: they open it with <i>Shared ＋ → Open a label file</i>. It contains titles, DOIs and public notes only.</p>
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    $('#iv-copy', m.el)?.addEventListener('click', () => copy(x.code, 'Code'));
    $('#iv-msg', m.el)?.addEventListener('click', () => copy(invitation(x), 'Invitation'));
    $('#iv-settings', m.el)?.addEventListener('click', () => { m.close(); openSettings('sharing'); });
    $('#iv-file', m.el).onclick = () => { location.href = `/api/shares/${id}/export`; };
    const add = async () => {
      const name = $('#iv-new', m.el).value.trim(); if (!name) return;
      try { await api(`/api/shares/${id}/members`, {method: 'POST', body: {name}}); await refresh(); m.close(); inviteDialog(id); toast(`${name} is now a member – send them the code.`, 'ok', 8000); }
      catch (err) { toast(err.message, 'error'); }
    };
    $('#iv-add', m.el)?.addEventListener('click', add);
    $('#iv-new', m.el)?.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  function peopleDialog(id) {
    const x = byId(id); if (!x) return;
    const m = modal(`<h3>👥 People in “${esc(x.name)}”</h3>${peopleList(x)}
      <div class="modal-actions">${x.role === 'member' ? '<button class="btn" id="pp-invite">📤 Invite more…</button>' : ''}<span class="grow"></span><button class="btn" data-close>Close</button></div>`);
    $('#pp-invite', m.el)?.addEventListener('click', () => { m.close(); inviteDialog(id); });
  }

  function manageDialog(id, {focusMember = false} = {}) {
    const x = byId(id); if (!x) return;
    const member = x.role === 'member';
    const m = modal(`<h3>${member ? '🔗' : '📥'} ${esc(x.name)} <span class="grow"></span><button class="btn small" data-help="sharing">📘 Guide</button></h3>
      ${member ? `<label class="fld"><span>Name</span><input class="input wide" id="sm-name" value="${esc(x.name)}"></label>
        <label class="fld"><span>Description</span><input class="input wide" id="sm-desc" value="${esc(x.description || '')}" placeholder="optional"></label>`
        : `<p class="muted">${x.description ? esc(x.description) + '<br>' : ''}You <b>follow</b> this shared label: you receive its papers and updates, but can't change it. To add papers too, ask a member to add your GitHub name${me() ? ` (<b>${esc(me())}</b>)` : ''}, then join again with the code.</p>`}
      ${x.creator && x.creator.by ? `<p class="muted small">Created by <b>${esc(x.creator.name || x.creator.by)}</b>${x.creator.name && !x.creator.by.startsWith('local-') && x.creator.name !== x.creator.by ? ` (${esc(x.creator.by)})` : ''}${x.creator.at ? ` on ${esc(new Date(x.creator.at).toLocaleDateString())}` : ''}${x.notes ? ` · ${x.notes} public note${x.notes === 1 ? '' : 's'}` : ''}</p>` : ''}
      <div class="section-label">People taking part</div>
      ${peopleList(x, {remove: member})}
      ${member ? (x.can_publish ? `<div style="display:flex;gap:6px;margin-top:6px"><input class="input" id="sm-new" style="flex:1" placeholder="Colleague's GitHub name, e.g. MarioRossi"><button class="btn" id="sm-add">Add member</button></div>
          <p class="muted small">Members can add and remove papers; everybody's changes reach everybody, also through other members. Each member turns on sharing once (⚙︎ Settings → 👥 Sharing) and joins with the code.</p>`
        : '<p class="warn-box small">Turn on sharing in ⚙︎ Settings → <b>👥 Sharing</b> to publish this label and add members.</p>') : ''}
      <div class="section-label">Give it to colleagues</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${x.code ? `<code class="share-code-small">${esc(x.code)}</code>` : ''}<button class="btn small primary" id="sm-invite">📤 Invite colleagues / code…</button></div>
      <div class="section-label">In my library</div>
      ${state.groups.length ? `<label class="opt"><input type="checkbox" id="sm-g-on" ${x.group_id ? 'checked' : ''}><span>Also give papers that arrive here my label <select id="sm-g">${groupOptions()}</select></span></label>` : ''}
      <p class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} shared · updated ${ago(x.last_pull)}${x.last_push ? ` · published ${ago(x.last_push)}` : ''}${x.last_error ? `<br><span class="warn-txt">⚠ ${esc(x.last_error)}</span>` : ''}</p>
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
    $('#sm-invite', m.el).onclick = () => { m.close(); inviteDialog(id); };
    $('#sm-sync', m.el).onclick = async () => { setBusy($('#sm-sync', m.el), true, 'Updating…'); await syncNow(id); m.close(); manageDialog(id); };
    $('#sm-leave', m.el).onclick = async () => {
      const ok = await confirmBox(member ? `Leave “${x.name}”?` : `Stop following “${x.name}”?`,
        'The papers stay in your library – only the shared label goes away from this computer.' + (member ? ' The other members keep it.' : ''), {ok: member ? 'Leave' : 'Stop following', danger: true});
      if (!ok) return;
      try { await api(`/api/shares/${id}`, {method: 'DELETE'}); m.close(); if (state.view.type === 'share' && state.view.id === id) state.view = {type: 'all'}; await refresh(); toast('Done – the papers are still in your library.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ------------------------------------------------------------ settings section */
  function statusHtml(s) {
    return s.share_gist
      ? `<p class="up-ok small">✓ Sharing is on, as <b>${esc(s.share_user)}</b>. Your shared labels are kept in a <a href="https://gist.github.com/${esc(s.share_user)}/${esc(s.share_gist)}" target="_blank" rel="noopener">secret gist</a> that PaperShelf created on your GitHub account – only people with a label's code can read it. <button class="linklike" id="share-off">Turn off</button></p>`
      : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small primary" id="share-on">Turn on sharing</button><span class="muted small" id="share-on-res"></span></div>`;
  }
  function settingsHtml(s) {
    const tokenSaved = s.has_share_token || s.has_sync_token;
    return `<div class="set-intro share"><b>👥 Sharing with colleagues</b> – shared labels (lists of papers) and public notes.
        <ul><li>Shared: titles, authors, year, journal, DOI of the papers you put in a shared label, the public notes you write there, and your display name.</li>
          <li>Never shared: PDFs, private notes, highlights, personal labels, the rest of your library.</li>
          <li>Joining or following a colleague's label needs nothing. To create your own, turn sharing on below.</li></ul></div>
      <div class="section-label">1 · Your name for colleagues <button class="help-q" data-help="notes" title="Explain this">?</button></div>
      <input class="input wide" id="set-dispname" maxlength="60" value="${esc(s.display_name || '')}" placeholder="e.g. Mirko Z., MZ or a nickname">
      <p class="muted small">Shown next to your public notes and on the shared labels you create – only the members of those labels see it. Empty = your GitHub name.</p>
      <div class="section-label">2 · GitHub token for sharing <button class="help-q" data-help="sharing" title="Explain this">?</button></div>
      <p class="muted small">A free GitHub account is used as the post office between colleagues. The token needs the <b>Gists: Read and write</b> permission. ${s.has_sync_token && !s.has_share_token ? 'If the token of <i>💻 Sync my computers</i> has that permission too, leave this empty: it is used for both.' : ''} <button class="linklike" data-help="sharing">How to create it</button></p>
      <input class="input wide" id="set-share-token" type="password" autocomplete="off" placeholder="${s.has_share_token ? '•••••••• token saved – paste a new one to replace it' : tokenSaved ? 'Empty: the token of “Sync my computers” is used' : 'GitHub access token (github_pat_…)'}">
      <div class="section-label">3 · Turn sharing on</div>
      <div id="share-status">${statusHtml(s)}</div>
      <label class="opt" style="margin-top:8px"><input type="checkbox" id="set-share-auto" ${s.share_auto !== '' ? 'checked' : ''}><span>Update shared labels automatically<small>When PaperShelf starts and every 15 minutes; your changes are published right away.</small></span></label>
      <div class="section-label">Then: give a label to a colleague</div>
      <p class="muted small">Sidebar → Labels → Shared: click your shared label → blue <b>📤 Invite colleagues / code</b> button above the list → <b>Copy code</b> and send it. They paste it in <i>Shared ＋ → Join a shared label</i>.</p>`;
  }
  function settingsBind(m) {
    const box = $('#share-status', m.el);
    box.addEventListener('click', async e => {
      if (e.target.id === 'share-on') {
        const res = $('#share-on-res', m.el); res.textContent = 'Connecting to GitHub…';
        try {
          const d = await api('/api/shares/setup', {method: 'POST', body: {token: $('#set-share-token', m.el)?.value || ''}});
          state.settings = {...state.settings, ...d.settings}; box.innerHTML = statusHtml(state.settings);
          toast(`Sharing is on (${d.user}).`, 'ok'); syncNow(null, true);
        } catch (err) { res.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
      }
      if (e.target.id === 'share-off') {
        const ok = await confirmBox('Turn sharing off on this computer?', 'Your shared labels stay in your gist and with your colleagues; this computer simply stops publishing. You can turn it on again any time.', {ok: 'Turn off'});
        if (!ok) return;
        const d = await api('/api/shares/setup', {method: 'POST', body: {off: true}}); state.settings = {...state.settings, ...d.settings};
        box.innerHTML = statusHtml(state.settings);
      }
    });
  }
  function settingsValues(m) {
    return {share_auto: $('#set-share-auto', m.el).checked, share_token: $('#set-share-token', m.el).value,
      display_name: $('#set-dispname', m.el).value};
  }

  /* ------------------------------------------------------------ wiring */
  function init() {
    $('#new-share')?.addEventListener('click', e => { e.stopPropagation(); startMenu(); });
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-sact]'); if (!a) return;
      e.stopPropagation();
      if (a.dataset.sact === 'manage') manageDialog(a.dataset.id);
      if (a.dataset.sact === 'invite') inviteDialog(a.dataset.id);
      if (a.dataset.sact === 'people') peopleDialog(a.dataset.id);
      if (a.dataset.sact === 'color') pickColor(a, byId(a.dataset.id)?.color || '', async c => {
        try { await api(`/api/shares/${a.dataset.id}`, {method: 'PUT', body: {color: c}}); await refresh(); } catch (err) { toast(err.message, 'error'); }
      });
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
    manageDialog, inviteDialog, peopleDialog, startMenu, settingsHtml, settingsBind, settingsValues};
})();
