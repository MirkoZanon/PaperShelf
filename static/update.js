/* PaperShelf – updates: check GitHub for a newer version, install it, restart. */
'use strict';

const Updates = (() => {
  let info = null;      // last result of /api/update/check
  let dialog = null;

  function notesHtml(text) {
    // tiny, safe renderer for release notes: headings, bullets, bold, line breaks
    const lines = esc(text || '').split(/\r?\n/);
    let html = '', inList = false;
    for (const raw of lines) {
      const l = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const li = l.match(/^\s*[-*]\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const h = l.match(/^#{1,6}\s+(.*)/);
      if (h) html += `<div class="un-h">${h[1]}</div>`;
      else if (l.trim()) html += `<p>${l}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }

  function badge() {
    const b = $('#update-btn'); if (!b) return;
    const on = !!(info && info.available);
    b.style.display = on ? '' : 'none';
    if (on) b.title = `PaperShelf ${info.latest} is available (you have ${info.current}) – click to update`;
  }

  async function check({force = false, auto = false} = {}) {
    const q = force ? '?force=1' : (auto ? '?auto=1' : '');
    const d = await api('/api/update/check' + q);
    if (!d.skipped) info = d;
    badge();
    return d;
  }

  function statusHtml() {
    if (!info) return '<p class="muted">Not checked yet.</p>';
    if (!info.configured) return `<p class="muted">This copy doesn't know where to look for updates: the file <code>update.json</code> in the app folder has no GitHub repository. Download new versions by hand, or install one from a zip file below.</p>`;
    const src = `<a href="${esc(info.page || ('https://github.com/' + info.repo))}" target="_blank" rel="noopener">github.com/${esc(info.repo)}</a>`;
    if (!info.available) return `<p class="up-ok">✓ You have the latest version (${esc(info.current)}). <span class="muted small">Source: ${src}</span></p>`;
    const when = info.published ? ` – published ${esc(new Date(info.published).toLocaleDateString())}` : '';
    return `<div class="up-new"><b>PaperShelf ${esc(info.latest)} is available</b>${when}. You have ${esc(info.current)}.
      <div class="muted small">Source: ${src}${info.git ? ' · this folder is a git copy: it will be updated with “git pull”' : ''}</div></div>
      ${info.notes ? `<div class="up-notes">${notesHtml(info.notes)}</div>` : ''}`;
  }

  function render() {
    if (!dialog) return;
    $('#up-status', dialog.el).innerHTML = statusHtml();
    $('#up-install', dialog.el).style.display = info && info.available ? '' : 'none';
  }

  async function open() {
    const s = state.settings || {};
    dialog = modal(`<h3>Updates <span class="grow"></span><button class="btn small" data-help="updates">📘 How updates work</button></h3>
      <p class="muted small">Installed version: <b>${esc(state.version || '')}</b>. Updating replaces only the app's own files – your library, PDFs, notes, profiles and settings (in <code>${esc(state.dataDir)}</code>) are never touched, and a backup of the current app is kept.</p>
      <div id="up-status"><p class="muted">Checking GitHub…</p></div>
      <div class="up-actions">
        <button class="btn primary" id="up-install" style="display:none">⬆ Install update and restart</button>
        <button class="btn" id="up-check">Check now</button>
        <button class="btn" id="up-file-btn" title="Use a PaperShelf .zip you downloaded yourself, e.g. from the Releases page">Install from a zip file…</button>
        <input type="file" id="up-file" accept=".zip" hidden>
        <button class="btn" id="up-backups" title="Earlier versions of the app, one zip per update">Backups</button>
      </div>
      <div id="up-progress" class="muted small"></div>
      <label class="opt"><input type="checkbox" id="up-auto" ${s.update_check !== '' ? 'checked' : ''}><span>Check for updates automatically<small>When PaperShelf starts and twice a day. It's an anonymous request to GitHub – nothing about you or your library is sent.</small></span></label>
      <label class="opt"><input type="checkbox" id="up-autoinst" ${s.update_auto !== '' ? 'checked' : ''}><span>Install updates automatically<small>A new version is installed when PaperShelf starts, before it opens (a backup of the old one is kept). Off: the ⬆ Update button appears and you choose when.</small></span></label>
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`, {wide: true});
    const m = dialog; m.onclose = () => { dialog = null; };
    $('#up-check', m.el).onclick = () => run(true);
    $('#up-install', m.el).onclick = install;
    $('#up-file-btn', m.el).onclick = () => $('#up-file', m.el).click();
    $('#up-file', m.el).onchange = e => { const f = e.target.files[0]; if (f) installFile(f); e.target.value = ''; };
    $('#up-backups', m.el).onclick = () => api('/api/open-backups', {method: 'POST'}).catch(err => toast(err.message, 'error'));
    const save = async body => {
      try { const d = await api('/api/settings', {method: 'PUT', body}); state.settings = d.settings; }
      catch (err) { toast(err.message, 'error'); }
    };
    $('#up-auto', m.el).onchange = e => { save({update_check: e.target.checked}); $('#up-autoinst', m.el).disabled = !e.target.checked; };
    $('#up-autoinst', m.el).onchange = e => save({update_auto: e.target.checked});
    $('#up-autoinst', m.el).disabled = !$('#up-auto', m.el).checked;
    if (info && !info.cached_result) render(); else run(false);
  }

  async function run(force) {
    if (dialog) $('#up-status', dialog.el).innerHTML = '<p class="muted">Checking GitHub…</p>';
    try { await check({force}); render(); }
    catch (err) { if (dialog) $('#up-status', dialog.el).innerHTML = `<p class="up-err">✗ ${esc(err.message)}</p>`; }
  }

  function progress(msg) { if (dialog) $('#up-progress', dialog.el).innerHTML = msg; }
  function lock(on) { if (dialog) $$('.up-actions button', dialog.el).forEach(b => { b.disabled = on; }); }

  async function install() {
    lock(true); progress('Downloading and installing… (this takes a few seconds)');
    try { finish(await api('/api/update/install', {method: 'POST'})); }
    catch (err) { lock(false); progress(`<span class="up-err">✗ ${esc(err.message)}</span>`); }
  }

  async function installFile(file) {
    lock(true); progress(`Installing ${esc(file.name)}…`);
    const fd = new FormData(); fd.append('file', file);
    try { finish(await api('/api/update/upload', {method: 'POST', form: fd})); }
    catch (err) { lock(false); progress(`<span class="up-err">✗ ${esc(err.message)}</span>`); }
  }

  async function finish(res) {
    info = null; badge();
    const n = (res.changed || []).length;
    progress(`✓ Version ${esc(res.installed)} installed${n ? ` (${n} files updated)` : ''}. ${res.warning ? `<br><span class="up-err">${esc(res.warning)}</span>` : ''}<br>Restarting PaperShelf…`);
    if (!res.restart) { lock(false); return; }
    try { await api('/api/update/restart', {method: 'POST'}); }
    catch (err) { progress(`✓ Version ${esc(res.installed)} installed. ${esc(err.message)}`); return; }
    const want = res.installed; const t0 = Date.now();
    await new Promise(r => setTimeout(r, 1500));
    while (Date.now() - t0 < 90000) {
      try {
        const v = await (await fetch('/api/version', {cache: 'no-store'})).json();
        if (!want || v.version === want || Date.now() - t0 > 20000) { location.reload(); return; }
      } catch (e) { /* still restarting */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    progress('The new version is installed but PaperShelf did not come back by itself: close its window and open the start file again.');
  }

  // after an update: say so once, with what's new
  async function announce() {
    let j = null;
    try { j = JSON.parse((state.settings || {}).just_updated || 'null'); } catch (e) { j = null; }
    if (!j || !j.version) return;
    try { await api('/api/update/seen', {method: 'POST'}); } catch (e) { /* ignore */ }
    if (state.settings) state.settings.just_updated = '';
    modal(`<h3>PaperShelf was updated to ${esc(j.version)}</h3>
      <p class="muted small">${j.previous ? `Previous version: ${esc(j.previous)}. ` : ''}Your library, PDFs and settings are unchanged.</p>
      ${j.notes ? `<div class="up-notes">${notesHtml(j.notes)}</div>` : ''}
      ${j.warning ? `<p class="up-err small">${esc(j.warning)}</p>` : ''}
      <div class="modal-actions"><button class="btn primary" data-close>OK</button></div>`);
  }

  async function autoCheck() {
    try { await check({auto: true}); } catch (e) { /* offline or GitHub unreachable: stay quiet */ }
  }

  return {open, check, autoCheck, announce, get info() { return info; }};
})();

document.addEventListener('DOMContentLoaded', () => {
  $('#update-btn')?.addEventListener('click', () => Updates.open());
});
(function waitForSettings(n) {
  if (state.settings && state.settings.update_check !== undefined) { Updates.announce(); return; }
  if (n < 40) setTimeout(() => waitForSettings(n + 1), 250);
})(0);
setTimeout(() => Updates.autoCheck(), 5000);
