/* PaperShelf – install as a real app (Chrome / Edge / Brave "Install app"), so it gets its own icon in
   the Dock or taskbar: a dot while open, clicking it brings the window back, Quit in its menu. */
'use strict';

const AppInstall = (() => {
  let deferred = null, status = null;
  const isMac = () => /Mac/.test(navigator.platform);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('ps-installable')); });
  window.addEventListener('appinstalled', () => { deferred = null; installedDialog(); refresh(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* not essential */ });

  async function refresh() { try { status = await api('/api/app-status'); } catch (e) { status = null; } return status; }

  const manual = () => `<ul class="small">
      <li><b>Chrome / Brave</b>: menu ⋮ → <i>Cast, save and share</i> → <b>Install page as app…</b> (or the install icon ⊕ at the right of the address bar).</li>
      <li><b>Edge</b>: menu … → <i>Apps</i> → <b>Install this site as an app</b>.</li>
      ${isMac() ? '<li><b>Safari</b> (macOS 14 or later): <i>File</i> → <b>Add to Dock…</b></li>' : ''}</ul>`;

  function installedDialog() {
    modal(`<h3>✓ PaperShelf is installed as an app</h3>
      <p>From now on use the new PaperShelf app:</p>
      <ol class="small">
        <li>${isMac() ? 'It is in your <b>Applications</b> folder (also in Launchpad and Spotlight). Open it and, while it is open, right-click its Dock icon → <i>Options</i> → <b>Keep in Dock</b>.' : 'It is in the <b>Start menu</b>. Open it, then right-click its taskbar icon → <b>Pin to taskbar</b>.'}</li>
        <li>Remove the old PaperShelf icon from the ${isMac() ? 'Dock (drag it out)' : 'taskbar (right-click → Unpin)'}.</li>
        <li>You can close this browser tab.</li></ol>
      <p class="muted small">If PaperShelf isn't running when you open the app, it shows a <b>Start PaperShelf</b> button. To have it always ready, turn on ⚙︎ Settings → General → <i>Start PaperShelf in the background when I log in</i>.</p>
      <div class="modal-actions"><button class="btn primary" data-close>OK</button></div>`);
  }

  // the page opened in a normal browser tab to install the app (#install-app)
  function installPage() {
    const m = modal(`<h3>Install PaperShelf as an app</h3>
      <p class="muted">PaperShelf gets its own icon ${isMac() ? 'in the Dock' : 'in the taskbar'}: a dot while it is open, a click brings its window back, and <i>Quit</i> in its menu – like any other app. Nothing is downloaded: it is this same PaperShelf, in its own window.</p>
      <div id="ia-box"></div>
      <div class="modal-actions"><button class="btn" data-close>Not now</button></div>`, {wide: true});
    const draw = () => {
      const box = $('#ia-box', m.el); if (!box) return;
      box.innerHTML = deferred ? `<button class="btn primary" id="ia-go">⬇ Install PaperShelf</button>`
        : `<p class="small">Your browser shows its own install option:</p>${manual()}`;
      $('#ia-go', m.el)?.addEventListener('click', async () => {
        deferred.prompt();
        const r = await deferred.userChoice.catch(() => null);
        if (r && r.outcome === 'accepted') { m.close(); }
      });
    };
    draw(); document.addEventListener('ps-installable', draw);
    setTimeout(draw, 1500);
  }

  async function settingsHtml() {
    const st = await refresh();
    if (!st) return '';
    const inst = st.installed;
    return `${inst ? `<p class="up-ok small">✓ PaperShelf is installed as an app – <b>${isMac() ? 'keep it in the Dock' : 'pin it to the taskbar'}</b> and use it instead of the old icon. <span class="muted">(${esc(inst)})</span></p>`
      : `<p class="muted small">Recommended: install PaperShelf as an app. It gets its own icon ${isMac() ? 'in the Dock' : 'in the taskbar'} that shows when it is open, brings its window back when clicked (no second window) and has <i>Quit</i> in its menu.${st.browser ? '' : ' Needs Chrome, Edge or Brave.'}</p>
         <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn small primary" id="ia-install">⬇ Install PaperShelf as an app</button><span class="muted small" id="ia-res"></span></div>`}
      <label class="opt" style="margin-top:8px"><input type="checkbox" id="ia-auto" ${st.autostart ? 'checked' : ''}><span>Start PaperShelf in the background when I log in<small>Then the app opens instantly, and your shared labels and sync keep up to date. It uses little memory and has no window; stop it with ⏻ Quit.</small></span></label>`;
  }
  function settingsBind(m) {
    $('#ia-install', m.el)?.addEventListener('click', async () => {
      if (deferred) { deferred.prompt(); return; }
      try {
        const d = await api('/api/install-app', {method: 'POST'});
        $('#ia-res', m.el).innerHTML = `PaperShelf opened in ${esc(d.browser || 'your browser')}: install it from there.`;
      } catch (err) { toast(err.message, 'error'); }
    });
    $('#ia-auto', m.el)?.addEventListener('change', async e => {
      try { const d = await api('/api/autostart', {method: 'POST', body: {on: e.target.checked}}); e.target.checked = d.autostart; toast(d.autostart ? 'PaperShelf will start in the background when you log in.' : 'PaperShelf won\'t start by itself anymore.', 'ok'); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
    });
  }
  return {installPage, settingsHtml, settingsBind, refresh, get canPrompt() { return !!deferred; }};
})();
