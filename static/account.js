/* Account: the person icon in the header. Signed out it leads through a short guided sign-in with GitHub; signed in it
   shows who you are, what PaperShelf saved where, and lets you switch or sign out. */
const Account = (() => {
  const ST = {info: null};
  const initial = () => (state.settings?.share_user || '').slice(0, 1).toUpperCase();
  function paint() {
    const b = document.getElementById('account-btn'); if (!b) return;
    const u = state.settings?.share_user, on = !!(u && state.settings?.share_gist);
    b.classList.toggle('on', on);
    b.innerHTML = on ? `<span class="acc-ini">${esc(initial())}</span>` : '<svg class="hb-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 19.5c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><i class="acc-dot"></i>';
    b.title = on ? `Signed in as ${u} – account` : 'Sign in with GitHub';
  }
  const step = (n, html) => `<li><span class="acc-n">${n}</span><div>${html}</div></li>`;
  const copyBtn = t => `<button class="linklike small" data-acc-copy="${esc(t)}">copy</button>`;

  function view(m) {
    const s = state.settings, body = $('#acc-body', m.el), i = ST.info || {};
    const user = s.share_user, on = !!(user && s.share_gist);
    if (on) return signedIn(body, s);
    if (!i.available) return setup(body, i);
    return ready(body, i);
  }
  function setup(body, i) {
    const url = `https://github.com/settings/applications/new?oauth_application[name]=PaperShelf&oauth_application[url]=${encodeURIComponent(i.home)}&oauth_application[callback_url]=${encodeURIComponent(i.callback)}`;
    body.innerHTML = `<p class="acc-lead"><b>Step 1 of 2 – prepare GitHub</b> <span class="muted">(only once, about 1 minute)</span></p>
      <p class="muted small">PaperShelf needs its own “sign-in button” on GitHub. You create it once; nothing here is secret or costs anything.</p>
      <ol class="acc-steps">
        ${step(1, `Click <a class="btn small primary" href="${url}" target="_blank" rel="noopener">Open GitHub</a> and sign in there if asked. A form opens, already filled in.<br><small class="muted">If it is empty, type: Application name <b>PaperShelf</b> ${copyBtn('PaperShelf')} · Homepage URL <b>${esc(i.home)}</b> ${copyBtn(i.home)} · Callback URL <b>${esc(i.callback)}</b> ${copyBtn(i.callback)}</small>`)}
        ${step(2, 'On that form <b>tick “Enable Device Flow”</b>.')}
        ${step(3, 'Click the green <b>Register application</b> button.')}
        ${step(4, `At the top of the next page copy the <b>Client ID</b> (it starts with <code>Ov23</code>) and paste it here:
          <input class="input wide" id="acc-cid" placeholder="Ov23…" autocomplete="off"> <button class="btn primary" id="acc-save-cid">Save and continue</button>
          <div class="muted small" id="acc-msg"></div>`)}
      </ol>`;
  }
  function ready(body, i) {
    body.innerHTML = `<p class="acc-lead"><b>Step 2 of 2 – sign in</b></p>
      <p class="muted small">You will approve a short code on github.com. PaperShelf then sets up the following in <b>your</b> GitHub account:</p>
      <ul class="acc-list">
        <li><b>Private repository “papershelf-library”</b> – your library is kept here, so all your computers match. Only you can see it.</li>
        <li><b>A secret gist</b> – the data of your groups (notes, documents). Secret = only people you invite.</li>
        <li><b>Your sign-in token</b> – stored <b>only on this computer</b>, never sent anywhere except GitHub.</li>
      </ul>
      <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="acc-go">Sign in with GitHub</button></div><div class="muted small" id="acc-msg"></div>`;
  }
  function code(body, st) {
    body.innerHTML = `<p class="acc-lead"><b>Approve this code on GitHub</b></p>
      <div class="acc-code">${esc(st.code)}</div>
      <ol class="acc-steps">
        ${step(1, `Click <button class="btn small primary" id="acc-open">Open GitHub</button> (a new tab opens; sign in there if asked).`)}
        ${step(2, `Type the code <b>${esc(st.code)}</b> ${copyBtn(st.code)} and click <b>Continue</b>.`)}
        ${step(3, 'Click the green <b>Authorize</b> button. Come back here: this window continues by itself.')}
      </ol><div class="muted small" id="acc-msg">Waiting for you to approve…</div>
      <div class="modal-actions" style="justify-content:flex-start"><button class="btn small" id="acc-cancel">Cancel</button></div>`;
  }
  function signedIn(body, s) {
    const repo = (s.sync_repo || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    const others = (s.accounts || []).filter(a => !a.active);
    body.innerHTML = `<div class="acc-who"><span class="acc-ini big">${esc(initial())}</span><div><b>${esc(s.share_user)}</b><div class="muted small">signed in on this computer</div></div></div>
      <ul class="acc-list">
        <li><b>Groups:</b> connected ✓ – <b>${(state.shares || []).length}</b> on this computer <button class="btn small" id="acc-groups">Find my groups</button> <span class="muted small" id="acc-gres"></span></li>
        <li><b>Library sync:</b> ${s.sync_repo && s.has_sync_token ? `on ✓ – private repository <b>${esc(repo)}</b>${s.last_sync ? `, last sync ${esc(new Date(s.last_sync).toLocaleString())}` : ''}${s.last_sync_error ? ` <span style="color:var(--danger)">⚠ ${esc(s.last_sync_error)}</span>` : ''}` : 'not set up – sign out and sign in again'}</li>
        <li><b>Saved on this computer only:</b> your sign-in token. Nothing else about you is stored.</li>
      </ul>
      <div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" id="acc-sync">Sync now</button><button class="btn" id="acc-out">Sign out</button></div>
      ${others.length ? `<div class="section-label">Other accounts on this computer</div>${others.map(a => `<div class="opt" style="display:flex;gap:8px;align-items:center;margin:4px 0"><b>${esc(a.user)}</b><button class="btn small" data-acc-use="${esc(a.user)}">Switch to this account</button><button class="linklike small" data-acc-del="${esc(a.user)}">Remove</button></div>`).join('')}` : ''}
      <p class="muted small" style="margin-top:10px">To add another account: sign out, then sign in with the other one.</p>`;
  }

  async function open() {
    const m = modal(`<h3>Account <span class="grow"></span><button class="btn small" data-close>Close</button></h3><div id="acc-body" class="acc"></div>`, {nofocus: true, wide: true});
    try { ST.info = await api('/api/github/login'); } catch (e) { ST.info = {}; }
    const msg = t => { const el = $('#acc-msg', m.el); if (el) el.innerHTML = t; };
    let polling = null;
    const show = () => view(m);
    m.onclose = () => { polling = null; };
    m.el.addEventListener('click', async e => {
      const t = e.target;
      const cp = t.closest('[data-acc-copy]')?.dataset.accCopy; if (cp) { navigator.clipboard?.writeText(cp).then(() => toast('Copied.', 'ok')); return; }
      if (t.id === 'acc-save-cid') {
        const v = $('#acc-cid', m.el).value.trim(); if (!v) { msg('Paste the Client ID first.'); return; }
        try { await api('/api/github/login/start', {method: 'POST', body: {client_id: v}}).then(r => { polling = r; }); } catch (err) { msg(`<span style="color:var(--danger)">${esc(err.message)}</span>`); return; }
        ST.info = await api('/api/github/login'); await startCode(polling);
      }
      if (t.id === 'acc-go') { try { await startCode(await api('/api/github/login/start', {method: 'POST', body: {}})); } catch (err) { msg(`<span style="color:var(--danger)">${esc(err.message)}</span>`); } }
      if (t.id === 'acc-cancel') { polling = null; show(); }
      if (t.id === 'acc-groups') { await findGroups(t); }
      if (t.id === 'acc-sync') { m.close(); syncNow(); }
      if (t.id === 'acc-out') { if (!await confirmBox('Sign out on this computer?', 'Your groups and library stay on GitHub. You can sign in again any time.', {ok: 'Sign out'})) return;
        const d = await api('/api/shares/setup', {method: 'POST', body: {off: true}}); state.settings = {...state.settings, ...d.settings}; paint(); show(); }
      const use = t.closest('[data-acc-use]')?.dataset.accUse, del = t.closest('[data-acc-del]')?.dataset.accDel;
      if (use) { try { const d = await api('/api/shares/setup', {method: 'POST', body: {switch: use}}); state.settings = {...state.settings, ...d.settings}; paint(); show(); toast(`Signed in as ${d.user}.`, 'ok'); syncNow(null, true); } catch (err) { toast(err.message, 'error'); } }
      if (del) { if (!await confirmBox(`Remove ${del} from this computer?`, 'Its saved token is deleted here.', {ok: 'Remove'})) return;
        const d = await api('/api/shares/setup', {method: 'POST', body: {forget: del}}); state.settings = {...state.settings, ...d.settings}; paint(); show(); }
    });
    async function findGroups(btn) {
      if (btn) { btn.disabled = true; }
      const res = $('#acc-gres', m.el); if (res) res.textContent = 'Looking in your GitHub account…';
      try {
        const d = await api('/api/shares/sync', {method: 'POST', body: {}});
        try { await loadLibrary(); } catch (e) { /* ignore */ }
        const n = d.result.restored || 0, errs = Object.values(d.result.lists || {}).filter(x => x.error).length;
        const msgText = n ? `✓ ${n} group${n > 1 ? 's' : ''} restored from your account.` : ((state.shares || []).length ? '✓ Groups are up to date.' : 'No groups found in your GitHub account yet. Groups you created or joined on another computer appear here once that computer has synced (open PaperShelf there and press the update button).');
        toast(msgText, n || (state.shares || []).length ? 'ok' : 'info', 9000); if (errs) toast(`${errs} group(s) could not be read – see the group for details.`, 'error', 9000);
      } catch (err) { toast(err.message, 'error'); }
      if (m.el.isConnected) show();
    }
    async function startCode(st) {
      polling = st.code; code($('#acc-body', m.el), st);
      const go = () => window.open(st.url, '_blank', 'noopener'); go(); $('#acc-open', m.el).onclick = go;
      let every = (st.interval || 5) * 1000;
      const tick = async () => {
        if (polling !== st.code || !m.el.isConnected) return;
        try {
          const r = await api('/api/github/login/poll', {method: 'POST', body: {code: st.code}});
          if (r.status === 'ok') { state.settings = {...state.settings, ...r.settings}; paint(); show(); toast(`Signed in as ${r.user}.`, 'ok'); await findGroups(null); syncNow(null, true); return; }
          if (r.status === 'denied' || r.status === 'expired') { polling = null; show(); msg(r.status === 'denied' ? 'Cancelled on GitHub. Click Sign in to try again.' : 'The code expired. Click Sign in to get a new one.'); return; }
          if (r.status === 'slow') every = (r.interval || 10) * 1000;
        } catch (err) { msg('⚠ ' + esc(err.message)); }
        setTimeout(tick, every);
      };
      setTimeout(tick, every);
    }
    show();
  }
  function init() { document.getElementById('account-btn')?.addEventListener('click', open); paint(); }
  document.addEventListener('DOMContentLoaded', init);
  return {open, paint};
})();
