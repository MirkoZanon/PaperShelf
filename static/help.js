'use strict';
/* In-app guide: every topic in one place, opened from the ? buttons.
   Help.open('sync') opens a specific section. */
const Help = (() => {
  const step = (n, html) => `<div class="h-step"><span class="h-n">${n}</span><div>${html}</div></div>`;
  const tip = html => `<div class="h-tip">💡 ${html}</div>`;
  const warn = html => `<div class="h-warn">⚠️ ${html}</div>`;
  const kbd = k => `<kbd>${k}</kbd>`;
  const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);

  /* The Guide: ten short pages. Old topic names still work (see ALIAS). */
  const SECTIONS = [
    {id: 'start', icon: '👋', title: 'Quick start', html: () => `
      <p>PaperShelf is your private library of scientific papers. It runs <b>on this computer</b>: nothing is online unless you turn on sync or groups.</p>
      <h4>In five steps</h4>
      ${step(1, `Paste a <b>DOI</b>, a link or a few words of the title in <b>Add a paper</b> and press ${kbd('Enter')}. The details are filled in for you.`)}
      ${step(2, 'Sort papers with <b>labels</b>: <b>＋</b> next to <i>Labels</i>, then drag papers onto one.')}
      ${step(3, 'Open a paper → <b>Find &amp; download PDF</b> (free copies), or <b>Open article &amp; log in with my university</b>.')}
      ${step(4, '<b>Read &amp; highlight</b> the PDF inside PaperShelf.')}
      ${step(5, '<b>Export references</b> in your journal\'s style, or move everything to Zotero.')}
      <h4>Where things are</h4>
      <table class="h-table"><tr><td><b>Logo</b></td><td>Home: one box searches your library <i>and</i> the web, and adds papers; continue reading; every tool.</td></tr>
        <tr><td><b>Library</b></td><td>Your papers: reading list, all papers, and <i>Discover</i> for new ones.</td></tr>
        <tr><td><b>Write</b></td><td>Documents you write alone or with a group.</td></tr>
        <tr><td><b>Lab</b></td><td>Ideas, plans and tasks of your groups.</td></tr>
        <tr><td><b>Researchers</b></td><td>Profiles and publication lists of scientists.</td></tr>
        <tr><td><b>Top right</b></td><td>🔔 news · ⟳ update everything · ? this guide · ⚙︎ settings.</td></tr></table>
      ${tip('Everything is saved at once. Closing the window or the computer loses nothing.')}
      <h4>Start and stop</h4>
      <p>First time: open <code>start.command</code> (Mac) or <code>start.bat</code> (Windows). Then <b>⚙︎ Settings → General → App, window &amp; shortcuts</b> installs PaperShelf as an app with its own icon. To stop it: <b>Settings → ⏻ Quit</b>.</p>
      <p class="muted">Look and colour (the logo follows it) are in <b>Settings → General</b>.</p>`},

    {id: 'adding', icon: '🏷', title: 'Add & organise papers', html: () => `
      <h4>Add</h4>
      <ul><li><b>One paper</b>: DOI, article link (journal, arXiv, PubMed), PDF link, title, or a whole reference.</li>
        <li><b>Many</b>: paste several lines, or <b>⋯ → Add many at once</b>.</li>
        <li><b>PDF files</b>: drop them anywhere on the window; the DOI inside fills in the details.</li>
        <li><b>From the browser</b>: drag the two buttons from <b>Settings → General → Browser buttons</b> to your bookmarks bar.</li>
        <li>Wrong details? Edit any field, or <b>↻ Update metadata</b>. The same DOI is never added twice.</li></ul>
      <h4>Labels</h4>
      <ul><li>A paper can have <b>any number of labels</b>; they can be nested. Click a label to list its papers. Deleting a label never deletes papers.</li>
        <li>Drag papers onto a label (select several with ${kbd(isMac() ? '⌘' : 'Ctrl')}- or ${kbd('Shift')}-click), or <b>right-click</b> a paper for the label menu.</li>
        <li>Hover a label for colour, sub-label, rename and delete. <b>Groups</b> below labels are shared with other people (see <a href="#" data-help="sharing">Groups</a>).</li></ul>
      <h4>Library views</h4>
      <ul><li><b>Reading list</b>: what you read or want to read. Opening a PDF moves a paper to <i>Reading now</i>; <b>✓ Read</b> takes it off the list but keeps it in the Library.</li>
        <li><b>All papers</b>: everything, with the Map and the review Table. <b>Discover</b>: suggestions.</li>
        <li><b>No grouping</b> above the list can group papers by label or by label combination.</li></ul>
      <h4>Keywords, search, status</h4>
      <ul><li><b>Keywords</b> are filled in automatically; click one to filter. <b>✎</b> next to <i>Keywords</i> merges or renames variants across the whole library.</li>
        <li><b>Search</b> (${kbd('/')}) looks in titles, authors, notes <b>and inside your PDFs</b>. Several words must all appear; "quotes" for a phrase.</li>
        <li>Mark papers <i>To read / Reading / Read</i>, star the important ones. Shortcuts: ${kbd('n')} add · ${kbd('Esc')} close · ${kbd('Delete')} delete.</li></ul>
      <details class="help"><summary>Smart helpers</summary>
        <ul><li><b>Retractions and published versions</b> are checked when you press ⟳ (only DOIs are sent). Flagged papers appear under <b>⚠ Needs attention</b>. Turn it off in Settings → General.</li>
          <li><b>What's new</b> (🔔): recent papers of researchers you follow and topics you watch.</li>
          <li><b>Reminders</b> for papers waiting in the reading list too long; <b>label suggestions</b> in a paper's details; <b>Reading stats</b> on Home → Tools.</li></ul></details>
      <details class="help"><summary>Review table</summary>
        <p>In the Library open a label and choose <b>▦ Table</b>: one row per paper with columns you define (aim, method, result…). Export as CSV or Markdown. Tables of labels are private; in a group the table is shared.</p></details>`},

    {id: 'pdfs', icon: '📄', title: 'PDFs & reading', html: () => `
      <h4>Get a PDF</h4>
      <p><b>Find &amp; download PDF</b> tries only legal sources: arXiv, Unpaywall, OpenAlex, Semantic Scholar, CORE, Europe PMC and the publisher. Select several papers for <b>Find PDFs</b>. Your own file? <b>Attach PDF</b>, or drop it on the paper.</p>
      <h4>Paywalled papers (university access)</h4>
      ${step(1, 'Open the paper → <b>Open article &amp; log in with my university</b>.')}
      ${step(2, 'On the journal page choose <b>Access through your institution</b> and sign in – on your university\'s page. PaperShelf never sees your password.')}
      ${step(3, 'Click the journal\'s <b>Download PDF</b>. PaperShelf spots the file in <b>Downloads</b>, reads its DOI and attaches it.')}
      ${warn('Mac, first time: if asked whether Terminal may access Downloads, click <b>Allow</b> (System Settings → Privacy &amp; Security → Files and Folders).')}
      <p>Optional: add your library's address (EZproxy / OpenAthens) in <b>Settings → PDFs &amp; sources</b> for a one-click <b>Via …</b> button. On campus or VPN, <i>Find &amp; download</i> often works directly. PDFs from subscriptions are for your own use.</p>
      <h4>Read &amp; highlight</h4>
      <ul><li>Select text and pick a colour; <i>🖍 + note</i> adds a comment. The right-hand list jumps to each highlight.</li>
        <li><b>📝 Notes</b> opens the paper's notes beside the PDF. <b>Save into PDF</b> writes highlights into the file for Preview, Acrobat or Zotero.</li>
        <li>The reader remembers your page. Time spent reading is counted for your stats, only on this computer.</li></ul>
      <h4>Free up space</h4>
      <p><b>Settings → Storage…</b> shows what PDFs take and suggests ones you can clear (idle for 3 months and re-downloadable). Deleted PDFs go to the Trash; the paper, notes and highlights stay.</p>`},

    {id: 'export', icon: '⤓', title: 'Citations & export', html: () => `
      <p>Pick the default style in <b>Settings → General</b>, or per paper in its <i>Reference</i> box: APA 7, Nature, Science, Cell Press, Royal Society, J Neurosci, eLife, PNAS, PLOS/Vancouver. <b>Copy citation</b> copies one reference.</p>
      <h4>Export references</h4>
      <p><b>⤓ Export</b> works on the selection, the current label or everything: <b>.txt</b>, <b>.rtf</b> (Word/Pages), <b>.ris</b> (Zotero, EndNote, Mendeley), <b>.bib</b> (LaTeX), <b>.json</b>, <b>.csv</b>.</p>
      <h4>To Zotero</h4>
      ${step(1, 'Export as <b>RIS</b> (tick “Add my labels as tags”).')}
      ${step(2, 'Zotero → <b>File → Import…</b> → choose the file. Papers arrive in a new collection with PDFs linked.')}
      <h4>Notes</h4>
      <p>Select papers → <b>📝 Export notes</b>: each reference followed by its notes, as Markdown, text or a web page.</p>`},

    {id: 'map', icon: '🕸', title: 'Map & Discover', html: () => `
      <h4>Map</h4>
      <p><b>Map</b> (above the list) turns the papers in view into a network: scroll to zoom, drag to move, click a paper to open it. Dashed grey dots are papers you don't have that several of yours cite – click to add.</p>
      <ul><li><b>Links</b>: citations · shared keywords · your labels · <b>notes</b> (papers whose notes share ideas, computed on this computer) · <b>Mix</b> (all together, with adjustable <b>Weights</b>).</li></ul>
      <h4>Discover</h4>
      <p>The third switch in the Library suggests papers for your whole library, or for one label: works your papers cite often, recent papers that cite yours, related works. One click adds them.</p>
      <p><b>Search by topic</b> (top of Discover, or on Home): describe what you need in a few words or an abstract. <i>By meaning</i> finds papers using other words; <i>By words</i> is the classic search. Only your search text is sent to OpenAlex.</p>
      <p class="muted">Citation data comes from OpenAlex (needs internet). If its free daily allowance runs out, add a free key in <b>Settings → PDFs &amp; sources</b>.</p>`},

    {id: 'researchers', icon: '👤', title: 'Researchers & journal metrics', html: () => `
      <p>Type an <b>ORCID iD</b> (best) or a name, pick the right person, and PaperShelf builds a profile from ORCID and OpenAlex: metrics, positions, and a table of all publications.</p>
      <ul><li><b>At a glance</b> tiles are clickable. <b>h-index → how to raise it</b> shows how many citations, and on which papers, reach h+1.</li>
        <li><b>Role</b> (first, co-first, last, co-last) is read from PubMed and, when needed, from the paper itself. Hover a role to see where it was found.</li>
        <li>Duplicates are merged. Not theirs? Hide it with ✕; wrong type? change it in the table.</li>
        <li>Filter by type, role and year; click a column title to sort.</li>
        <li><b>⤓ Export list</b> makes a CV-style list (web page, Word, text, RIS, BibTeX) with numbering, highlighted authorship and a summary table.</li></ul>
      <h4>Google Scholar data (optional)</h4>
      <p>Google doesn't allow programs to search Scholar, so you import the <b>public</b> page you are viewing: drag <a class="bookmarklet" href="${esc(People.scholarBookmarklet())}" onclick="return false">🎓 Import Scholar profile</a> to your bookmarks bar, open the profile, click “Show more” until all papers show, then click the button.</p>
      <h4>Impact factor</h4>
      <p>The official Journal Impact Factor is sold by Clarivate, so PaperShelf shows free equivalents: <b>quartile and SJR</b> and <b>citations per document (2 years)</b> from SCImago, for the year of publication and today.</p>
      <ul><li>Click <b>Load journal metrics</b> once in a researcher's Publications. Missing years are loaded automatically.</li>
        <li>If scimagojr.com refuses programs, <b>Get the missing years…</b> downloads the tables through your browser and PaperShelf picks them up from Downloads.</li>
        <li>Blank cell: not a journal paper. <i>not indexed</i>: type the value yourself. Values in small print come from the closest earlier year.</li></ul>`},

    {id: 'sharing', icon: '👥', title: 'Groups, Lab & Write', html: () => `
      <p>A <b>group</b> shares papers with other people: a lab, a journal club, a co-author. Shared: titles, authors, year, journal, DOI, your <b>public</b> notes, tables and documents. <b>Never shared</b>: private notes, highlights, the rest of your library – and PDFs, unless you choose a shared folder.</p>
      <h4>Roles</h4>
      <ul><li><b>Editor</b>: adds papers, writes, invites. Needs a free GitHub account, connected once.</li>
        <li><b>Reader</b>: sees everything, changes nothing. Needs only the code.</li></ul>
      <h4>Create and join</h4>
      ${step(1, 'Connect GitHub once: <b>Settings → Groups</b> (token: <a href="#" data-help="sync">see Sync</a>).')}
      ${step(2, 'Sidebar → <b>Groups ＋ → Create a group</b> (from a label, the selected papers, or empty). Drag papers onto it later.')}
      ${step(3, '<b>＋ Invite someone</b> → choose editor or reader → <b>✉ Write the e-mail</b>. It opens your own mail app; PaperShelf sends nothing and keeps no addresses.')}
      ${step(4, 'To join: install PaperShelf, then <b>Groups ＋ → Join a group</b> and paste the code. Send the code only to people you invite.')}
      <p>No GitHub? <b>Save as a file</b> in the group's ⚙︎ and send the <code>.papershelf</code> file; open it with <i>Groups ＋ → Open a group file</i>.</p>
      <details class="help"><summary>PDFs in a group (optional)</summary>
        <p>Nothing travels online. In the group's ⚙︎ → <b>PDF files</b> pick a folder you already share (Dropbox, OneDrive, a network drive, a USB stick). You decide what goes in: one paper, all, or automatically. Missing PDFs found there are copied to your PDF folder. Share only what you may (your own papers, open access, preprints).</p></details>
      <details class="help"><summary>Notes: private and public</summary>
        <ul><li>Every paper has a small chat of notes (📝). <b>🔒 Private</b> is the default; <b>🌐 Public</b> is visible to a group the paper belongs to.</li>
          <li>You can edit, delete, or switch your own notes between public and private. Nobody can change anyone else's note; you can <b>hide</b> it on your computer.</li>
          <li>Markdown works: <code>**bold**</code>, <code>*italic*</code>, <code>==highlight==</code>, <code>- list</code>, <code>- [ ] to do</code>. ${kbd('⌘/Ctrl')}+${kbd('Enter')} saves.</li></ul></details>
      <details class="help"><summary>The group table</summary>
        <p><b>▦ Table</b> in a group: same columns for everybody. Click a cell to read its entries like a chat and add your own – <b>Public</b> (signed) or <b>Private</b>. Editors can change the columns. Exports to CSV or Markdown.</p></details>

      <h4>Write</h4>
      <p>The <b>Write</b> tab lists the documents of all your groups. <b>New document</b> → pick the group (or <i>Only me</i>) and write. Changes of several people are combined, never overwritten; you see others appear within seconds.</p>
      <ul><li><b>Markdown</b> toolbar, <b>Preview</b>, and <b>Review</b> (who wrote what, comments).</li>
        <li><b>Suggest</b> mode (like Google Docs): switch from <i>Edit</i> to <i>Suggest</i> and type normally; deletions stay struck out, insertions turn green, each change is a card to <b>Accept</b> or <b>Reject</b>. In Review you can also select text to comment or suggest.</li>
        <li><b>Citations</b>: type <code>[@</code> for a list of papers, best matches first (matching is local). The reference list is written for you.</li>
        <li><b>Tables</b> and <b>pictures</b> (paste, drop or <b>Picture</b>; max 12 per document, 2 MB total).</li>
        <li><b>Show pasted text</b> in Review hatches pasted passages. It is a transparency aid, not an AI detector.</li>
        <li><b>Delete or archive</b>: hover a document in the Write list and click <b>⋯</b> (or use ⋯ inside the document). Archive tidies it away; only its creator can delete it, and the others keep a read-only copy until they remove it.</li>
        <li><b>History</b>: save named versions or restore an earlier one. <b>Export</b>: Word, Markdown, text, or PDF (print → Save as PDF).</li>
        <li>Updates take about 5–10 seconds. Everyone in the group needs the same PaperShelf version.</li></ul>

      <h4>Lab</h4>
      <p>Pick a group on the left, or the Overview (your open tasks everywhere).</p>
      <ul><li><b>Posts</b>: idea, experiment, question, result, decision, protocol or note. Comment, 👍 support, 📌 pin, address to people with <b>📨 For</b> or ＠. Decisions are listed separately.</li>
        <li><b>Plans &amp; tasks</b>: a plan groups tasks with a goal, deadline and people in charge; start from an experiment or paper template. The board has <i>To do / Doing / Done</i>. Open a task for its checklist, notes, people and deadline – it saves as you type.</li>
        <li><b>Archive</b> tidies finished plans and tasks away without deleting. <b>⤓ Report</b> exports the whole lab as Markdown.</li></ul>
      <p class="muted">🔔 tells you when others post, comment or give you a task. Everything travels in the members' private GitHub gists (every 15 minutes, or ⟳) and goes nowhere else.</p>`},

    {id: 'sync', icon: '💻', title: 'Sync between computers', html: () => `
      <p>Keep the same library on all <b>your</b> computers (Mac and Windows) through a <b>private</b> GitHub repository only you can see. One computer? You don't need this. Sharing with others is <a href="#" data-help="sharing">Groups</a>.</p>
      <h4>First time (about 5 minutes)</h4>
      ${step(1, 'A free <b>GitHub account</b>: <a href="https://github.com/signup" target="_blank" rel="noopener">github.com/signup</a>.')}
      ${step(2, `A <b>private repository</b> named <code>papershelf-library</code>: <a href="https://github.com/new?name=papershelf-library&visibility=private&description=My%20PaperShelf%20library%20(private)" target="_blank" rel="noopener"><b>create it</b></a> (opens filled in), keep <b>Private</b>, leave README and licence <b>off</b>, click <b>Create repository</b>.`)}
      ${step(3, `A <b>token</b>, a password just for PaperShelf: <a href="https://github.com/settings/personal-access-tokens/new?name=PaperShelf&description=PaperShelf%3A%20sync%20my%20library%20and%20groups&expires_in=366&contents=write&gists=write" target="_blank" rel="noopener"><b>create it</b></a> (opens filled in). Under <i>Repository access</i> choose <i>Only select repositories → papershelf-library</i>, then <b>Generate token</b> and copy it (shown once; it starts with <code>github_pat_</code>).`)}
      ${step(4, `${isMac() ? '<b>Git</b> must be installed. If PaperShelf says it is missing: open Terminal, type <code>xcode-select --install</code>, accept.' : '<b>Git</b> must be installed. If PaperShelf says it is missing, install it from <a href="https://git-scm.com/download/win" target="_blank" rel="noopener">git-scm.com</a> (default options) and restart PaperShelf.'}`)}
      ${step(5, '<b>Settings → My computers</b>: paste the token and the repository address → <b>Test</b> → <b>Save</b>.')}
      <p>On every other computer: install PaperShelf and do step 5 with the same repository.</p>
      <div class="h-live" id="h-sync-live"><button class="btn small" id="h-sync-test">Test my current settings</button> <span id="h-sync-res" class="muted small"></span></div>
      <h4>Every day</h4>
      <ul><li>Press <b>⟳</b>, or tick <i>Sync automatically</i> (at start and every 20 minutes). If two computers change the same paper, the latest change wins.</li>
        <li><b>PDFs</b> are off by default. On: GitHub works best under ~1 GB (≈400 papers) and refuses files over 100 MB.</li></ul>
      <details class="help"><summary>Token for Groups only</summary>
        <p>If you don't sync, <a href="https://github.com/settings/personal-access-tokens/new?name=PaperShelf%20groups&description=PaperShelf%3A%20groups&expires_in=366&gists=write" target="_blank" rel="noopener"><b>create a token with only the Gists permission</b></a> and paste it in <b>Settings → Groups → Connect</b>. An older token without Gists: GitHub → Settings → Developer settings → Fine-grained tokens → <b>Edit</b> → Account permissions → <b>Gists: Read and write</b>. Tokens expire after a year; make a new one the same way.</p></details>
      <h4>Problems</h4>
      <table class="h-table"><tr><th>Message</th><th>What to do</th></tr>
        <tr><td>Git is not installed</td><td>Step 4, then press ⟳.</td></tr>
        <tr><td>GitHub refused access</td><td>Token wrong, expired, or without this repository: make a new one.</td></tr>
        <tr><td>Repository not found</td><td>Copy the address again from the repository page.</td></tr>
        <tr><td>⟳ is red</td><td>Hover it to read the last error.</td></tr></table>`},

    {id: 'updates', icon: '⬆️', title: 'Install & update', html: () => `
      <h4>Two separate folders</h4>
      <ul><li><b>The app</b>: <code>${esc(state.appDir || '')}</code></li>
        <li><b>Your library</b>: <code>${esc(state.dataDir || '~/PaperShelf')}</code> (database, PDFs, settings). Back this folder up (Time Machine, File History).</li></ul>
      ${warn('Never put one folder inside the other. Updating the app never touches your library.')}
      <h4>Updates</h4>
      <p>By default PaperShelf checks GitHub at start-up (an anonymous request) and installs a new version before it opens, keeping a backup. Switch this off in <b>Settings → General → Updates</b>; then a <b>⬆ Update</b> button appears and you choose when. <b>⟳</b> checks too.</p>
      <details class="help"><summary>If something goes wrong</summary>
        <ul><li><b>No internet</b>: download the zip from the project's Releases page and use <b>Install from a zip file…</b> in the update window.</li>
          <li><b>Going back</b>: every update leaves a zip of the previous version in <code>${esc(state.dataDir || '~/PaperShelf')}/backups</code>. Close PaperShelf, unzip, start that copy.</li>
          <li><b>By hand</b>: replace the app folder with the new one and start it again. With <code>git clone</code>, the start file runs <code>git pull</code> by itself.</li></ul></details>`},

    {id: 'privacy', icon: '🛡', title: 'Privacy, keys & help', html: () => `
      <h4>Privacy</h4>
      <ul><li>PaperShelf answers only to your computer. Library, private notes, highlights, profiles and settings stay in your library folder – and in your own private GitHub repository if you sync.</li>
        <li>Online services get only what a lookup needs: a DOI, a title, the name or ORCID iD you search, topics you watch. Your e-mail goes only to Unpaywall, and only if you enter it.</li>
        <li>University logins happen on your university's page. Only official interfaces and legal open-access sources are used; Google Scholar only through a page you import yourself.</li>
        <li>Researcher profiles are public professional data, kept locally.</li></ul>
      <h4>Optional keys (Settings → PDFs &amp; sources)</h4>
      <table class="h-table"><tr><th></th><th>Helps with</th><th>Get it</th></tr>
        <tr><td><b>E-mail</b></td><td>Unpaywall: more free PDFs</td><td>Any address you use.</td></tr>
        <tr><td><b>OpenAlex key</b></td><td>10× more citation lookups</td><td>Free at <a href="https://openalex.org/settings/api" target="_blank" rel="noopener">openalex.org/settings/api</a>.</td></tr>
        <tr><td><b>CORE key</b></td><td>University repositories</td><td>Free at <a href="https://core.ac.uk/services/api" target="_blank" rel="noopener">core.ac.uk/services/api</a>.</td></tr></table>
      <h4>Common problems</h4>
      <dl class="h-faq">
        <dt>Mac: <code>start.command</code> “can't be opened”</dt><dd>Right-click → <b>Open</b> → <b>Open</b> (first time only).</dd>
        <dt>“Python 3 is not installed”</dt><dd>Install it from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">python.org</a> (Windows: tick “Add python.exe to PATH”).</dd>
        <dt>“PaperShelf is not running”</dt><dd>Start <code>start.command</code> / <code>start.bat</code> again and reload.</dd>
        <dt>“Could not reach …”</dt><dd>Adding papers, PDFs, citation data, profiles and sync need internet; the rest works offline.</dd>
        <dt>A downloaded PDF wasn't attached</dt><dd>Check the Downloads permission and the downloads folder in Settings. PDFs without a DOI ask which paper they belong to.</dd>
        <dt>Uninstall</dt><dd>Delete the app folder; delete the library folder only if you no longer want your library.</dd></dl>
      <p>Still stuck? Run the <a href="#" data-help="status">System check</a>.</p>`},

    {id: 'status', icon: '🩺', title: 'System check', html: () => `
      <p>What works and what needs attention on this computer.</p>
      <div id="h-diag" class="muted">Checking…</div>`},
  ];

  /* old topic names -> the page that now holds them */
  const ALIAS = {organising: 'adding', smart: 'adding', university: 'pdfs', reader: 'pdfs', 'journal-metrics': 'researchers', lab: 'sharing', notes: 'sharing',
    'gh-repo': 'sync', 'gh-token': 'sync', keys: 'privacy', troubleshooting: 'privacy'};

  let current = 'start';
  const root = () => $('#help');

  function render() {
    const sec = SECTIONS.find(s => s.id === current) || SECTIONS[0];
    root().innerHTML = `<div class="h-panel" role="dialog" aria-label="Help">
      <div class="h-top"><b>📘 PaperShelf guide</b><span class="muted small">version ${esc(state.version || '')}</span><span class="grow"></span><button class="btn small" id="h-close">Close ✕</button></div>
      <div class="h-body">
        <nav class="h-nav">${SECTIONS.map(s => `<a href="#" data-help="${s.id}" class="${s.id === sec.id ? 'on' : ''}"><span>${s.icon}</span>${esc(s.title)}</a>`).join('')}</nav>
        <article class="h-content" id="h-content"><h2>${sec.icon} ${esc(sec.title)}</h2>${sec.html()}</article>
      </div></div>`;
    $('#h-content').scrollTop = 0;
    if (sec.id === 'status') diagnostics();
  }
  async function diagnostics() {
    try {
      const d = await api('/api/diagnostics');
      $('#h-diag').outerHTML = `<table class="h-table">${d.checks.map(c => `<tr><td>${c.ok ? '✅' : '⚠️'}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.detail)}${!c.ok && c.help ? ` <a href="#" data-help="${c.help}">How to set it up</a>` : ''}</td></tr>`).join('')}</table>
        <p class="muted small">App folder: <code>${esc(d.app_dir)}</code><br>Library folder: <code>${esc(d.data_dir)}</code></p>`;
    } catch (err) { $('#h-diag').textContent = err.message; }
  }
  async function testSync() {
    const out = $('#h-sync-res'); out.textContent = 'Testing…';
    if (!state.settings.sync_repo) { out.innerHTML = 'No repository set yet – do steps 1–3, then open ⚙︎ Settings.'; return; }
    try {
      const d = await api('/api/sync/test', {method: 'POST', body: {}});
      out.innerHTML = `<span style="color:var(--ok)">✓ Connection works${d.empty ? ' (the repository is still empty – press ⟳ to send your library)' : ''}.</span>`;
    } catch (err) { out.innerHTML = `<span style="color:var(--danger)">✗ ${esc(err.message)}</span>`; }
  }

  function open(id) {
    id = ALIAS[id] || id;
    current = SECTIONS.some(s => s.id === id) ? id : 'start';
    root().classList.add('open'); render();
  }
  function close() { root().classList.remove('open'); root().innerHTML = ''; }

  document.addEventListener('click', e => {
    const h = e.target.closest('[data-help]');
    if (h) { e.preventDefault(); open(h.dataset.help); return; }
    if (e.target.id === 'h-close' || e.target === root()) close();
    if (e.target.id === 'h-sync-test') testSync();
  });

  /* First visit: a short welcome */
  function welcome() {
    let seen = false;
    try { seen = localStorage.getItem('papershelf-welcomed') === '1'; } catch (e) { /* ignore */ }
    if (seen || state.papers.length) return;
    try { localStorage.setItem('papershelf-welcomed', '1'); } catch (e) { /* ignore */ }
    const m = modal(`<h3>👋 Welcome to PaperShelf</h3>
      <p class="muted">Your personal library of scientific papers – it runs on this computer, so it's private and works offline.</p>
      ${step(1, 'Paste a <b>DOI, link or title</b> in the box at the top and press Enter.')}
      ${step(2, 'Organise papers with <b>labels</b> (they work like tags).')}
      ${step(3, '<b>Find PDFs</b> (free ones automatically, others through your university), read and highlight them.')}
      ${step(4, '<b>Export</b> reference lists in your journal\'s style, or move them to Zotero.')}
      <p class="muted small">Help is one click away: the <b>?</b> at the top.</p>
      <div class="modal-actions"><button class="btn" data-help="start">Read the guide</button><button class="btn primary" data-close>Start</button></div>`, {wide: true});
    $$('[data-help]', m.el).forEach(b => b.addEventListener('click', () => m.close()));
  }

  return {open, close, isOpen: () => root()?.classList.contains('open'), welcome};
})();
