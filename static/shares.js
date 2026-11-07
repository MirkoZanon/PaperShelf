/* PaperShelf – groups: papers (titles / DOIs only) and public notes shared with other people.
   Your labels are your own topics; a group is something you share ("lab journal club", "papers with
   Anna"). A paper can have both. Papers that arrive stay in your library; if a group drops a paper,
   it only loses the group. People in a group are editors (add papers, write notes – they need a free
   GitHub account) or readers (see everything, change nothing – they need nothing). */
'use strict';

const Shares = (() => {
  const APP_URL = 'https://github.com/MirkoZanon/PaperShelf';
  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=PaperShelf%20groups&description=PaperShelf%3A%20groups&expires_in=366&gists=write';
  const byId = id => (state.shares || []).find(x => x.id === id);
  const editable = () => (state.shares || []).filter(x => x.role === 'member');
  const ago = iso => {
    if (!iso) return 'never';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
  };
  const connected = () => !!(state.settings.share_gist && state.settings.share_user);
  const me = () => state.settings.share_user || '';
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  const initials = n => (String(n || '?').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  const pname = p => p.id.startsWith('local-') ? (p.you ? (state.settings.display_name || 'You') : 'someone (not online)') : (p.name || p.id);
  const pTip = p => [p.id.startsWith('local-') ? '' : `GitHub: ${p.id}`, p.creator ? 'created this group' : '', p.joined ? (p.since ? `editor since ${new Date(p.since).toLocaleDateString()}` : 'editor') : 'invited as editor – not joined yet',
    `${p.papers} paper${p.papers === 1 ? '' : 's'} added`, `${p.notes} public note${p.notes === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  function personChip(p, {remove = false} = {}) {
    return `<span class="person ${p.joined ? '' : 'invited'}" title="${esc(pTip(p))}"><span class="p-av" style="background:hsl(${hue(p.id)} 55% 46%)">${esc(initials(pname(p)))}</span>
      <span class="p-name">${esc(pname(p))}</span>${p.you ? '<span class="p-tag">you</span>' : ''}${p.creator ? '<span class="p-tag">creator</span>' : ''}${p.joined ? '' : '<span class="p-tag">invited</span>'}
      ${remove && !p.you && !p.id.startsWith('local-') ? `<button data-mrm="${esc(p.id)}" title="Remove this editor">×</button>` : ''}</span>`;
  }
  function peopleList(x, opts = {}) {
    const P = x.people || [];
    return `<div class="people-list">${P.map(p => `<div class="person-row">${personChip(p, opts)}<span class="muted small">${esc(p.id.startsWith('local-') ? '' : '@' + p.id)}${p.joined ? '' : ' · not joined yet'} · ${p.papers} paper${p.papers === 1 ? '' : 's'} · ${p.notes} note${p.notes === 1 ? '' : 's'}</span></div>`).join('')}</div>
      <p class="muted small">These are the <b>editors</b>. Readers aren't listed: they only read, so nothing of theirs is published.</p>`;
  }
  const roleTag = x => x.role === 'member' ? '' : '<span class="role-tag" title="You can see the papers and public notes but not change them">reader</span>';

  /* ------------------------------------------------------------ sidebar & list */
  function renderSidebar() {
    const el = $('#sharelist'); if (!el) return;
    const L = state.shares || [];
    el.innerHTML = L.length ? L.map(x => {
      const active = state.view.type === 'share' && state.view.id === x.id;
      const n = (typeof areaPapers === 'function' ? areaPapers() : state.papers).filter(p => (p.share_ids || []).includes(x.id)).length;
      return `<div class="nav-item share-item ${x.role === 'member' ? 'editable' : 'reader'} ${active ? 'active' : ''}" data-share="${esc(x.id)}"
          title="${x.role === 'member' ? 'Group – drag papers here to share them' : 'Group – you are a reader (read-only)'}${x.creator && x.creator.by ? '\nCreated by ' + esc(x.creator.name || x.creator.by) : ''}${x.last_error ? '\n⚠ ' + esc(x.last_error) : ''}">
          <span class="caret invisible"></span><span class="ico">${labelIcon(x.color, 'group')}</span><span class="label">${esc(x.name)}</span>
          ${x.last_error ? '<span class="warn-dot" title="Last update had a problem">!</span>' : ''}<span class="count">${n}</span>
          <span class="g-actions"><button title="Colour (only on this computer)" data-sact="color" data-id="${esc(x.id)}">🎨</button>${x.role === 'member' ? `<button title="Invite someone" data-sact="invite" data-id="${esc(x.id)}">＋👤</button>` : ''}<button title="People and options" data-sact="manage" data-id="${esc(x.id)}">⚙︎</button></span></div>`;
    }).join('') : '<div class="empty-hint">Share papers and notes with other people. ＋ to create a group or join one.</div>';
  }

  function viewSub(id) {
    const x = byId(id); if (!x) return '';
    const P = x.people || [];
    const ppl = P.length ? `<span class="share-people" data-sact="people" data-id="${esc(id)}" title="Who takes part – click for details">${P.slice(0, 8).map(p => personChip(p)).join('')}${P.length > 8 ? `<span class="muted small">+${P.length - 8}</span>` : ''}</span>` : '';
    return `<span class="share-sub">${ppl}${x.role === 'member' ? (P.length > 1 ? '' : 'Only you so far · ') : '<b>You are a reader</b> (read-only) · '}updated ${ago(x.last_pull || x.updated_at)}
      ${x.last_error ? ` · <span class="warn-txt" title="${esc(x.last_error)}">⚠ ${esc(truncate(x.last_error, 70))}</span>` : ''}
      · <button class="linklike" data-sact="manage" data-id="${esc(id)}">People & options</button>
      ${x.role === 'member' ? `<button class="btn small primary invite-btn" data-sact="invite" data-id="${esc(id)}">＋ Invite someone</button>` : ''}</span>`;
  }

  function bulkOptions() {
    const ed = editable();
    return `<option value="">Share in a group…</option>${ed.map(x => `<option value="add:${esc(x.id)}">Add to “${esc(x.name)}”</option>`).join('')}<option value="__new">＋ New group with these…</option>`;
  }
  function bulk(v, ids) {
    if (v === '__new') return newDialog({paperIds: ids});
    if (v.startsWith('add:')) return addPapers(v.slice(4), ids);
  }

  function detailField(p) {
    const mine = (p.share_ids || []).map(byId).filter(Boolean);
    const can = editable().filter(x => !mine.includes(x));
    if (!mine.length && !(state.shares || []).length) return '';
    return `<div class="fld"><span>Groups <button class="help-q" data-help="sharing" title="Explain this">?</button></span><div class="share-chips">
      ${mine.map(x => `<span class="schip ${x.color ? 'colored' : ''}"${chipStyle(x.color)} title="${x.role === 'member' ? 'Remove from this group for everybody (their copies stay, without the group)' : 'Hide this group on this paper, for you only'}">${labelIcon(x.color, 'group')}${esc(x.name)}<button data-share-rm="${esc(x.id)}" title="Remove">×</button></span>`).join('')}
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
      toast(`${ids.length} paper${ids.length > 1 ? 's' : ''} shared in “${x.name}”${connected() ? ' – publishing…' : ''}.`, 'ok');
    } catch (err) { toast(err.message, 'error', 9000); }
  }
  async function removePapers(id, ids) {
    const x = byId(id); if (!x || !ids.length) return;
    const ok = await confirmBox(`Remove ${ids.length > 1 ? `${ids.length} papers` : 'this paper'} from the group “${x.name}”?`,
      x.role === 'member' ? 'It goes out of the group for everybody. The papers stay in your library and in everybody else’s.'
        : 'You are a reader: it is hidden only for you. The papers stay in your library.', {ok: 'Remove'});
    if (!ok) return;
    try { await api(`/api/shares/${id}/papers`, {method: 'POST', body: {paper_ids: ids, action: 'remove'}}); state.selected.clear(); await refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function syncNow(id = null, quiet = false) {
    const t = quiet ? null : toast('Updating groups…', 'info', 0);
    try {
      const d = await api('/api/shares/sync', {method: 'POST', body: id ? {id} : {}});
      t?.close(); await refresh();
      const L = Object.values(d.result.lists);
      const added = L.reduce((n, r) => n + (r.added || 0), 0), un = L.reduce((n, r) => n + (r.untagged || 0), 0);
      const errs = L.filter(r => r.error || (r.errors || []).length).length;
      if (!quiet) toast(`Groups updated${added ? ` · ${added} new paper${added > 1 ? 's' : ''}` : ''}${un ? ` · ${un} left a group` : ''}${d.result.restored ? ` · ${d.result.restored} group(s) restored from your GitHub` : ''}${errs ? ' · some people could not be read (see the group)' : ''}.`, errs ? 'info' : 'ok', 7000);
    } catch (err) { t?.close(); if (!quiet) toast(err.message, 'error', 9000); }
  }

  /* ------------------------------------------------------------ dialogs */
  function startMenu() {
    const m = modal(`<h3>👥 Groups <span class="grow"></span><button class="btn small" data-help="sharing">📘 How groups work</button></h3>
      <p class="muted small">Share papers and notes with other people – a lab, a journal club, a co-author. Only titles, authors, journal and DOI travel, plus the notes you make public; never PDFs, private notes or the rest of your library.</p>
      <div class="share-start">
        <button class="share-opt" data-o="join"><b>⤵ Join a group</b><small>You received an invitation with a code</small></button>
        <button class="share-opt" data-o="new"><b>＋ Create a group</b><small>From one of your labels, from selected papers, or empty</small></button>
        <button class="share-opt" data-o="file"><b>📄 Open a group file</b><small>A .papershelf file received by e-mail</small></button>
      </div>
      ${connected() ? '' : `<p class="warn-box small">Creating groups, and adding papers or notes in them, needs GitHub connected once – ⚙︎ Settings → <button class="linklike" data-open-groups-settings>👥 Groups</button> (3 minutes). Joining as a reader needs nothing.</p>`}
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    m.el.addEventListener('click', e => {
      if (e.target.closest('[data-open-groups-settings]')) { m.close(); openSettings('sharing'); return; }
      const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
      m.close();
      if (o === 'new') newDialog({paperIds: [...state.selected]});
      if (o === 'join') joinDialog();
      if (o === 'file') pickFile();
    });
  }

  function newDialog({paperIds = [], fromGroup = null} = {}) {
    const gid = fromGroup ?? (state.view.type === 'group' ? state.view.id : null);
    const m = modal(`<h3>＋ Create a group</h3>
      <label class="fld"><span>Name</span><input class="input wide" id="sh-name" placeholder="e.g. Journal club – visual cortex" value="${gid && !paperIds.length ? esc(state.groups.find(g => g.id === gid)?.name || '') : ''}"></label>
      <label class="fld"><span>Description <em>(optional)</em></span><input class="input wide" id="sh-desc" placeholder="What is this group for?"></label>
      <div class="fld"><span>Start with</span>
        ${paperIds.length ? `<label class="opt"><input type="radio" name="sh-src" value="sel" checked><span>The ${paperIds.length} selected paper${paperIds.length > 1 ? 's' : ''}</span></label>` : ''}
        ${state.groups.length ? `<label class="opt"><input type="radio" name="sh-src" value="group" ${!paperIds.length && gid ? 'checked' : ''}><span>The papers with my label <select id="sh-group">${groupOptions()}</select><small>Those it has today – later, drag papers onto the group.</small></span></label>` : ''}
        <label class="opt"><input type="radio" name="sh-src" value="empty" ${!paperIds.length && !gid ? 'checked' : ''}><span>Empty – I'll drag papers onto it</span></label></div>
      ${connected() ? '<p class="muted small">Next you invite people: you choose who can edit and who can only read.</p>'
        : '<p class="warn-box small">GitHub isn’t connected yet: the group is kept here and can be sent as a file. Connect it in ⚙︎ Settings → 👥 Groups to invite people.</p>'}
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sh-create">Create group</button></div>`);
    if (gid && $('#sh-group', m.el)) $('#sh-group', m.el).value = gid;
    $('#sh-create', m.el).onclick = async () => {
      const name = $('#sh-name', m.el).value.trim(); if (!name) { $('#sh-name', m.el).focus(); return; }
      const src = $('input[name=sh-src]:checked', m.el)?.value;
      if (connected() && typeof Notes !== 'undefined' && !(await Notes.ensureName('the groups you create'))) return;
      const body = {name, description: $('#sh-desc', m.el).value};
      if (src === 'sel') body.paper_ids = paperIds;
      if (src === 'group') body.from_group = +$('#sh-group', m.el).value;
      try {
        const d = await api('/api/shares', {method: 'POST', body});
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        toast(`Group “${d.share.name}” created with ${d.share.papers} paper${d.share.papers === 1 ? '' : 's'}.`, 'ok');
        if (connected()) inviteDialog(d.share.id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function joinDialog(prefill = '') {
    const m = modal(`<h3>⤵ Join a group</h3>
      <p class="muted small">Paste the <b>code</b> from your invitation – it looks like <code>MarioRossi/1a2b…/9f8e…</code>. The group's papers are added to your library.</p>
      <div style="display:flex;gap:6px"><input class="input" id="sh-code" style="flex:1" placeholder="MarioRossi/1a2b3c…/9f8e7d…" value="${esc(prefill)}"><button class="btn primary" id="sh-look">Join</button></div>
      <div id="sh-found" style="margin-top:10px"></div>
      <p class="muted small">Invited as <b>editor</b>? ${connected() ? `You are connected to GitHub as <b>${esc(me())}</b>: this must be the username the person who invited you typed.` : 'Also connect GitHub once (⚙︎ Settings → 👥 Groups): until then you join as a reader, and you become editor by yourself afterwards.'}</p>
      ${state.groups.length ? `<label class="opt" style="margin-top:8px"><input type="checkbox" id="sh-g-on"><span>Also give the papers I receive my label <select id="sh-g">${groupOptions()}</select></span></label>` : ''}
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    const join = async (code, id = null) => {
      const res = $('#sh-found', m.el); res.innerHTML = '<p class="muted">Looking on GitHub…</p>';
      const body = {code, id};
      if ($('#sh-g-on', m.el)?.checked) body.group_id = +$('#sh-g', m.el).value;
      try {
        const d = await api('/api/shares/join', {method: 'POST', body});
        if (d.choose) {
          res.innerHTML = d.choose.length ? `<p class="muted small">Groups of <b>${esc(d.owner)}</b>:</p>` + d.choose.map(x => `<div class="share-found">
              <div><b>${esc(x.name)}</b><div class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} · editors: ${esc((x.members || []).join(', '))}${x.description ? ' · ' + esc(x.description) : ''}</div></div>
              ${x.joined ? '<span class="muted small">already joined</span>' : `<button class="btn small primary" data-join="${esc(x.id)}">Join</button>`}</div>`).join('')
            : `<p class="muted">${esc(d.owner)} has no groups yet.</p>`;
          return;
        }
        m.close(); await refresh(); setView({type: 'share', id: d.share.id});
        const reader = d.share.role !== 'member';
        toast(`Joined “${d.share.name}”${reader ? ' as a reader' : ' as an editor'}: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'}, ${d.stats.tagged} you already had.`
          + (reader ? (connected() ? ` If you were invited as editor, ask them to add your GitHub username “${me()}”.` : ' Invited as editor? Connect GitHub in ⚙︎ Settings → 👥 Groups.') : ''), 'ok', 11000);
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
        toast(`Group “${d.share.name}” opened: ${d.stats.added} new paper${d.stats.added === 1 ? '' : 's'}, ${d.stats.tagged} already in your library.`, 'ok', 9000);
      } catch (err) { toast(err.message, 'error'); }
    };
    inp.click();
  }

  const copy = (text, what) => {
    const ok = () => toast(`${what} copied.`, 'ok');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => fallbackCopy(text, ok));
    else fallbackCopy(text, ok);
  };
  function fallbackCopy(text, ok) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast('Select the text and copy it with ⌘C / Ctrl+C.', 'info'); }
    ta.remove();
  }

  /* the invitation: short, the steps in the order the person needs them */
  function invitation(x, {who = '', role = 'editor', gh = ''} = {}) {
    const from = state.settings.display_name || me();
    const editor = role === 'editor';
    const subject = `Invitation to the PaperShelf group “${x.name}”`;
    const body = `Hi${who ? ' ' + who : ''},\n\n` +
      `${from ? from + ' has' : 'I have'} invited you to the group “${x.name}” in PaperShelf, as ${editor ? 'an editor: you can add papers and write notes' : 'a reader: you see the papers and our public notes'}.\n\n` +
      `To join:\n` +
      `1. In PaperShelf, sidebar → Groups ＋ → “Join a group”, and paste this code:\n   ${x.code}\n` +
      (editor ? `2. To add papers and notes, connect your GitHub account once: ⚙︎ Settings → Groups (about 3 minutes, the steps are there).${gh ? ` Use the GitHub account “${gh}”.` : ''}\n` : '') +
      `\nNo PaperShelf yet? It's free, for Mac and Windows: ${APP_URL}\n` +
      `Download it (green “Code” button → Download ZIP), unzip it and double-click start.command (Mac) or start.bat (Windows). Then do the steps above.\n\n` +
      `Only titles, DOIs and the notes we make public are shared – never PDFs or private notes.`;
    return {subject, body};
  }

  async function inviteDialog(id) {
    let x = byId(id); if (!x) return;
    if (x.role !== 'member') {
      toast(`Only editors can invite people to “${x.name}”. Ask one of them (People & options).`, 'info', 8000); return;
    }
    if (x.can_publish && !x.published) { await syncNow(id, true); x = byId(id) || x; }  // publish before giving the code
    const ready = !!x.code && x.can_publish;
    const m = modal(`<h3>＋ Invite someone to “${esc(x.name)}” <span class="grow"></span><button class="btn small" data-help="sharing">📘 Guide</button></h3>
      ${ready ? `<div id="iv-form">
        <div class="iv-grid">
          <label class="fld"><span>Name <em>(for the message)</em></span><input class="input" id="iv-who" placeholder="e.g. Anna"></label>
          <label class="fld"><span>E-mail <em>(optional)</em></span><input class="input" id="iv-mail" type="email" placeholder="anna@uni.edu"></label>
        </div>
        <div class="fld"><span>They can</span>
          <label class="iv-role"><input type="radio" name="iv-role" value="editor" checked><span><b>Edit</b> – add papers and write notes<small>They need a free GitHub account: type their GitHub username.</small>
            <input class="input" id="iv-gh" placeholder="Their GitHub username, e.g. AnnaBianchi"></span></label>
          <label class="iv-role"><input type="radio" name="iv-role" value="reader"><span><b>Only read</b> – see the papers and the public notes<small>They need nothing else. Anyone with the code can read the group: send it only to the people you invite.</small></span></label>
        </div>
        <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="iv-go">Prepare the invitation</button></div>
      </div>
      <div id="iv-done" hidden></div>`
      : `<div class="warn-box"><b>This group isn't online yet.</b> To invite people, connect GitHub once: ⚙︎ Settings → <b>👥 Groups</b> (3 minutes).
          <div style="margin-top:8px"><button class="btn small primary" id="iv-settings">Open Groups settings</button></div></div>
        <p class="muted small">Or <button class="btn small" id="iv-file">📄 Save the group as a file</button> and send it by e-mail: they open it with <i>Groups ＋ → Open a group file</i>.</p>
        <div class="modal-actions"><button class="btn" data-close>Close</button></div>`}`, {wide: true});
    $('#iv-settings', m.el)?.addEventListener('click', () => { m.close(); openSettings('sharing'); });
    $('#iv-file', m.el)?.addEventListener('click', () => { location.href = `/api/shares/${id}/export`; });
    if (!ready) return;
    const ghBox = $('#iv-gh', m.el);
    m.el.addEventListener('change', e => { if (e.target.name === 'iv-role') ghBox.disabled = e.target.value !== 'editor'; });
    $('#iv-go', m.el).onclick = async () => {
      const role = $('input[name=iv-role]:checked', m.el).value, who = $('#iv-who', m.el).value.trim(), mail = $('#iv-mail', m.el).value.trim();
      const gh = ghBox.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/^@/, '').replace(/\/$/, '');
      if (role === 'editor') {
        if (!gh) { ghBox.focus(); toast('Type their GitHub username – or choose “Only read”.', 'info'); return; }
        try { await api(`/api/shares/${id}/members`, {method: 'POST', body: {name: gh}}); await refresh(); x = byId(id) || x; }
        catch (err) { toast(err.message, 'error'); return; }
      }
      const inv = invitation(x, {who, role, gh});
      const mailto = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(inv.subject)}&body=${encodeURIComponent(inv.body)}`;
      $('#iv-form', m.el).hidden = true;
      const done = $('#iv-done', m.el); done.hidden = false;
      done.innerHTML = `<p class="up-ok">✓ ${esc(who || gh || 'They')} ${role === 'editor' ? `${gh ? `(<b>${esc(gh)}</b>) ` : ''}can edit` : 'can read'} “${esc(x.name)}”. Now send the invitation:</p>
        <div class="iv-send"><a class="btn primary" id="iv-mailto" href="${esc(mailto)}">✉ Write the e-mail</a><button class="btn" id="iv-copy">📋 Copy the message</button><button class="btn" id="iv-code">📋 Copy only the code</button></div>
        <pre class="iv-preview">${esc(inv.body)}</pre>
        <p class="muted small">PaperShelf doesn't send e-mails and doesn't keep the address: the message opens in your own e-mail app, ready to send.</p>
        <div class="modal-actions"><button class="btn" id="iv-more">Invite someone else</button><span class="grow"></span><button class="btn primary" data-close>Done</button></div>`;
      $('#iv-copy', m.el).onclick = () => copy(`${inv.subject}\n\n${inv.body}`, 'Invitation');
      $('#iv-code', m.el).onclick = () => copy(x.code, 'Code');
      $('#iv-more', m.el).onclick = () => { m.close(); inviteDialog(id); };
    };
  }

  function peopleDialog(id) {
    const x = byId(id); if (!x) return;
    const m = modal(`<h3>👥 People in “${esc(x.name)}”</h3>${peopleList(x)}
      <div class="modal-actions">${x.role === 'member' ? '<button class="btn" id="pp-invite">＋ Invite someone…</button>' : ''}<span class="grow"></span><button class="btn" data-close>Close</button></div>`);
    $('#pp-invite', m.el)?.addEventListener('click', () => { m.close(); inviteDialog(id); });
  }

  function manageDialog(id) {
    const x = byId(id); if (!x) return;
    const member = x.role === 'member';
    const m = modal(`<h3>👥 ${esc(x.name)} ${roleTag(x)}<span class="grow"></span><button class="btn small" data-help="sharing">📘 Guide</button></h3>
      ${member ? `<label class="fld"><span>Name</span><input class="input wide" id="sm-name" value="${esc(x.name)}"></label>
        <label class="fld"><span>Description</span><input class="input wide" id="sm-desc" value="${esc(x.description || '')}" placeholder="optional"></label>`
        : `<p class="muted">${x.description ? esc(x.description) + '<br>' : ''}You are a <b>reader</b>: you receive the papers and the public notes, but can't change the group. To edit, ask an editor to add your GitHub username${me() ? ` (<b>${esc(me())}</b>)` : ' – and connect GitHub in ⚙︎ Settings → 👥 Groups'}.</p>`}
      ${x.creator && x.creator.by ? `<p class="muted small">Created by <b>${esc(x.creator.name || x.creator.by)}</b>${x.creator.at ? ` on ${esc(new Date(x.creator.at).toLocaleDateString())}` : ''}${x.notes ? ` · ${x.notes} public note${x.notes === 1 ? '' : 's'}` : ''}</p>` : ''}
      <div class="section-label">Editors</div>
      ${peopleList(x, {remove: member})}
      ${member ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small primary" id="sm-invite">＋ Invite someone…</button>${x.code ? `<button class="btn small" id="sm-code" title="${esc(x.code)}">📋 Copy the code</button>` : ''}</div>` : ''}
      <div class="section-label">In my library</div>
      ${state.groups.length ? `<label class="opt"><input type="checkbox" id="sm-g-on" ${x.group_id ? 'checked' : ''}><span>Also give papers that arrive here my label <select id="sm-g">${groupOptions()}</select></span></label>` : ''}
      <p class="muted small">${x.papers} paper${x.papers === 1 ? '' : 's'} · updated ${ago(x.last_pull)}${x.last_push ? ` · published ${ago(x.last_push)}` : ''}${x.last_error ? `<br><span class="warn-txt">⚠ ${esc(x.last_error)}</span>` : ''}
        · <button class="linklike" id="sm-file">Save as a file</button></p>
      <div class="modal-actions"><button class="btn danger" id="sm-leave">Leave the group</button><span class="grow"></span>
        <button class="btn" id="sm-sync">⟳ Update now</button><button class="btn" data-close>Close</button>${member ? '<button class="btn primary" id="sm-save">Save</button>' : ''}</div>`, {wide: true});
    if (x.group_id && $('#sm-g', m.el)) $('#sm-g', m.el).value = x.group_id;
    const saveGroup = () => $('#sm-g-on', m.el) ? api(`/api/shares/${id}`, {method: 'PUT', body: {group_id: $('#sm-g-on', m.el).checked ? +$('#sm-g', m.el).value : null}}) : null;
    $('#sm-g-on', m.el)?.addEventListener('change', () => { if (!member) saveGroup()?.then(refresh).catch(e => toast(e.message, 'error')); });
    $('#sm-save', m.el)?.addEventListener('click', async () => {
      try { await api(`/api/shares/${id}`, {method: 'PUT', body: {name: $('#sm-name', m.el).value, description: $('#sm-desc', m.el).value}}); await saveGroup(); m.close(); await refresh(); toast('Saved.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    });
    m.el.addEventListener('click', async e => {
      const rm = e.target.closest('[data-mrm]'); if (!rm) return;
      const ok = await confirmBox(`Remove ${rm.dataset.mrm} from the editors?`, 'They keep the papers they already have; their changes are no longer read and they stop receiving updates.', {ok: 'Remove'});
      if (!ok) return;
      try { await api(`/api/shares/${id}/members`, {method: 'POST', body: {name: rm.dataset.mrm, remove: true}}); m.close(); await refresh(); manageDialog(id); }
      catch (err) { toast(err.message, 'error'); }
    });
    $('#sm-invite', m.el)?.addEventListener('click', () => { m.close(); inviteDialog(id); });
    $('#sm-code', m.el)?.addEventListener('click', () => copy(x.code, 'Code'));
    $('#sm-file', m.el).onclick = () => { location.href = `/api/shares/${id}/export`; };
    $('#sm-sync', m.el).onclick = async () => { setBusy($('#sm-sync', m.el), true, 'Updating…'); await syncNow(id); m.close(); manageDialog(id); };
    $('#sm-leave', m.el).onclick = async () => {
      const ok = await confirmBox(`Leave “${x.name}”?`, 'The papers stay in your library – only the group goes away from this computer.' + (member ? ' The others keep it.' : ''), {ok: 'Leave', danger: true});
      if (!ok) return;
      try { await api(`/api/shares/${id}`, {method: 'DELETE'}); m.close(); if (state.view.type === 'share' && state.view.id === id) state.view = homeView(); await refresh(); toast('Done – the papers are still in your library.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  /* ------------------------------------------------------------ settings tab */
  function statusHtml(s) {
    return s.share_gist
      ? `<div class="set-status ok">✓ Connected as <b>${esc(s.share_user)}</b> – you can create groups, invite people and edit. <button class="linklike" id="share-off">Disconnect</button></div>`
      : `<div class="set-status">Not connected. <b>Joining as a reader needs nothing</b> (sidebar → Groups ＋ → Join). To <b>create</b> groups or <b>edit and write notes</b> in them, connect GitHub once:</div>`;
  }
  function connHtml(s) {
    const tokenSaved = s.has_share_token || s.has_sync_token;
    return statusHtml(s) + (s.share_gist ? '' : `<ol class="gh-steps">
        <li><b>A GitHub account</b> – free; skip if you have one. <a class="btn small" href="https://github.com/signup" target="_blank" rel="noopener">Create an account</a></li>
        <li><b>A token</b> with the <i>Gists</i> permission. ${s.has_sync_token ? 'If you sync your computers with a token created from PaperShelf 2.7 or later, it already has it: skip to step 3.' : ''}
          <a class="btn small" href="${TOKEN_URL}" target="_blank" rel="noopener">Create it on GitHub</a> <button class="linklike small" data-help="gh-token">Show me how</button>
          <small>The page opens filled in: click <i>Generate token</i> and copy it.</small></li>
        <li><b>Paste it and connect</b>:
          <input class="input wide" id="set-share-token" type="password" autocomplete="off" placeholder="${tokenSaved ? 'Empty = use the token already saved for “My computers”' : 'Token (github_pat_…)'}">
          <div class="sync-actions"><button class="btn small primary" id="share-on">Connect</button><span class="muted small" id="share-on-res"></span></div></li>
      </ol>`);
  }
  function settingsHtml(s) {
    return `<div class="set-intro share"><b>👥 Groups</b> – share papers and notes with other people: a lab, a journal club, a co-author. Only titles, authors, journal, DOI and the notes you make public travel – never PDFs, private notes or the rest of your library. <button class="help-q" data-help="sharing" title="Explain this">?</button></div>
      <div id="share-conn">${connHtml(s)}</div>
      <div class="section-label">Your name in groups</div>
      <input class="input wide" id="set-dispname" maxlength="60" value="${esc(s.display_name || '')}" placeholder="e.g. Mirko Z., MZ or a nickname">
      <p class="muted small">Shown next to your public notes and in the groups you create. Empty = your GitHub username.</p>
      <label class="opt"><input type="checkbox" id="set-share-auto" ${s.share_auto !== '' ? 'checked' : ''}><span>Update groups automatically<small>When PaperShelf starts and every 15 minutes; your changes are published right away.</small></span></label>`;
  }
  function settingsBind(m) {
    const panel = $('[data-panel=sharing]', m.el);
    panel?.addEventListener('click', async e => {
      if (e.target.id === 'share-on') {
        const res = $('#share-on-res', m.el); res.textContent = 'Connecting to GitHub…';
        try {
          const d = await api('/api/shares/setup', {method: 'POST', body: {token: $('#set-share-token', m.el)?.value || ''}});
          state.settings = {...state.settings, ...d.settings};
          $('#share-conn', m.el).innerHTML = connHtml(state.settings);
          toast(`Connected to GitHub as ${d.user}.`, 'ok'); syncNow(null, true);
        } catch (err) { res.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
      }
      if (e.target.id === 'share-off') {
        const ok = await confirmBox('Disconnect GitHub for groups on this computer?', 'Your groups stay online and with the other people; this computer just stops publishing your changes. You can connect again any time.', {ok: 'Disconnect'});
        if (!ok) return;
        const d = await api('/api/shares/setup', {method: 'POST', body: {off: true}}); state.settings = {...state.settings, ...d.settings};
        $('#share-conn', m.el).innerHTML = connHtml(state.settings);
      }
    });
  }
  function settingsValues(m) {
    return {share_auto: $('#set-share-auto', m.el)?.checked, share_token: $('#set-share-token', m.el)?.value || '',
      display_name: $('#set-dispname', m.el)?.value};
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
    manageDialog, inviteDialog, peopleDialog, startMenu, settingsHtml, settingsBind, settingsValues, invitation};
})();
