'use strict';
/* In-app guide: every topic in one place, opened from the ? buttons.
   Help.open('sync') opens a specific section. */
const Help = (() => {
  const step = (n, html) => `<div class="h-step"><span class="h-n">${n}</span><div>${html}</div></div>`;
  const tip = html => `<div class="h-tip">💡 ${html}</div>`;
  const warn = html => `<div class="h-warn">⚠️ ${html}</div>`;
  const kbd = k => `<kbd>${k}</kbd>`;
  const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);

  const SECTIONS = [
    {id: 'start', icon: '👋', title: 'Getting started', html: () => `
      <p>PaperShelf keeps your scientific papers in one place: it fills in the details for you, finds legal free PDFs,
        lets you read and highlight them, organise them with labels and export reference lists.</p>
      <p>It runs <b>on your computer</b>. The browser is only its window: your library is not online and works offline too.</p>
      <h4>Your first five minutes</h4>
      ${step(1, `Paste a <b>DOI</b> or a <b>link</b> to an article (journal, arXiv, PubMed…) in the box at the top and press ${kbd('Enter')} – or just type <b>a few words of the title</b> (or authors and year): a list of matching papers appears, pick one. Title, authors, journal, year, abstract and keywords are filled in automatically.`)}
      ${step(2, `Create a <b>label</b> with ＋ next to “Labels → Personal” and drag papers onto it. A paper can have many labels. <a href="#" data-help="organising">More</a>`)}
      ${step(3, `Open a paper and click <b>⬇ Find &amp; download PDF</b>. If it isn't free, use <b>🔐 Open article &amp; log in with my university</b>. <a href="#" data-help="university">More</a>`)}
      ${step(4, `Click <b>📖 Read &amp; highlight</b> to read the PDF and highlight passages.`)}
      ${step(5, `Click <b>⤓ Export references</b> to get your reference list in APA, Nature, Cell… or to move papers to Zotero.`)}
      <h4>Starting and stopping</h4>
      <p><b>The first time</b>, start PaperShelf with <code>start.command</code> (Mac) or <code>start.bat</code> (Windows) in the app folder: it sets itself up (about a minute).</p>
      <p><b>Then install it as an app</b> (recommended): ⚙︎ Settings → General → <b>⬇ Install PaperShelf as an app</b>. Chrome, Edge or Brave make PaperShelf a real app with its own icon: in the Dock or taskbar it shows a dot while open, clicking it brings back the open window instead of opening a new one, and right-click → <i>Quit</i> closes it. Keep it in the Dock (right-click → Options → Keep in Dock) or pin it to the taskbar, and remove the old icon. If PaperShelf isn't running when you open the app, it shows a <b>Start PaperShelf</b> button; with <i>Start PaperShelf in the background when I log in</i> it is always ready.</p>
      <p><b>Or make a simple icon</b>: ⚙︎ Settings → General → <b>🖥 Create PaperShelf icon</b> (it starts PaperShelf but isn't a real app window).</p>
      <ul><li><b>Mac</b>: PaperShelf appears in your Applications folder and on the Desktop. Drag it onto the <b>Dock</b> to keep it there; Spotlight (⌘ Space) finds it too.</li>
        <li><b>Windows</b>: on the Desktop and in the Start menu; right-click it → <i>Pin to taskbar</i>.</li></ul>
      <p>Started from the icon, PaperShelf runs quietly in the background and opens in its <b>own window</b> named PaperShelf (if Chrome, Edge or Brave is installed – otherwise in your browser). Clicking the icon again just brings the window back. To stop it: ⚙︎ Settings → <b>⏻ Quit</b>. Started with <code>start.command</code>, it stops when you close its Terminal window.</p>
      ${tip('Everything is saved immediately. Closing the window, the browser or the computer loses nothing.')}
      <h4>Recommended (optional) settings</h4>
      <ul><li><b>E-mail for Unpaywall</b> – finds more free PDFs.</li><li><b>OpenAlex key</b> – more daily lookups for citation map, suggestions and researcher profiles.</li>
        <li><b>GitHub sync</b> – the same library on several computers.</li></ul>
      <p>All are explained in <a href="#" data-help="keys">Optional keys</a> and <a href="#" data-help="sync">Sync</a>.</p>`},

    {id: 'adding', icon: '➕', title: 'Adding papers', html: () => `
      <p>The box at the top understands:</p>
      <ul><li>DOIs (<code>10.1038/s41586-020-2649-2</code>) and doi.org links</li><li>links to journal pages, arXiv, bioRxiv, PubMed</li>
        <li>direct links to PDF files</li><li>titles, or a whole reference copied from a paper</li></ul>
      <h4>Other ways</h4>
      <ul><li><b>Many at once</b>: paste several lines, or ⋯ → <i>Add many at once</i>.</li>
        <li><b>PDF files you already have</b>: drag them onto the window (or ⋯ → <i>Import PDF files</i>). The DOI inside each file is used to fill in the details.</li>
        <li><b>From the browser</b>: in ⚙︎ Settings drag the buttons <i>＋ Save to PaperShelf</i> and <i>⬇ Save + PDF</i> to your bookmarks bar; on any article page click one.</li>
        <li><b>By hand</b>: ⋯ → <i>Add manually</i>.</li></ul>
      ${tip('If a label is open when you add a paper, the paper gets that label.')}
      <h4>If the details are wrong or missing</h4>
      <p>Open the paper and edit any field directly, or click <b>↻ Update metadata</b> and paste the DOI. Duplicates (same DOI or arXiv ID) are recognised: adding a paper twice just opens the existing one.</p>`},

    {id: 'organising', icon: '🏷', title: 'Labels, keywords & search', html: () => `
      <h4>Labels</h4>
      <p>Labels work like tags: a paper can have <b>any number of labels</b>, and clicking a label lists every paper that has it. There are two kinds, in the sidebar under <b>Labels</b>:</p>
      <ul><li><b>Personal</b> – your own topics and projects. They can be nested (sub-labels) and are used by the map, Discover and the statistics.</li>
        <li><b>Shared</b> – labels you share with colleagues: their papers reach everybody's library. They are kept apart so that “from Mario” doesn't mix with your scientific topics. <a href="#" data-help="sharing">More</a></li></ul>
      <ul><li>Create a personal label with ＋; hover it for 🎨 (colour), ＋ (sub-label), ✎ (rename), 🗑 (delete). Drag a label onto another to nest it.</li>
        <li><b>Colours</b>: 🎨 gives a label one of 24 colours, shown in the sidebar and on the papers' label chips. Shared labels can have a colour too – only on your computer.</li>
        <li><b>Dragging a paper onto a label adds it</b> – it never removes its other labels. Select several papers (${kbd(isMac() ? '⌘' : 'Ctrl')}-click or ${kbd('Shift')}-click) to drag or label them together.</li>
        <li><b>The paper list</b> is kept clean: title, authors, labels, status and the buttons 📝 (notes) and <b>PDF</b>. Tick <b>Details</b> above the list to see the keywords too. Click a paper to open its details (click anywhere outside them to close); select several with ${kbd(isMac() ? '⌘' : 'Ctrl')}-click or ${kbd('Shift')}-click – the selection boxes appear as soon as something is selected (⚙︎ Settings → General → <i>Always show selection boxes</i> to keep them).</li>
        <li><b>📄 PDF</b> (green) opens the PDF in the reader. <b>⬇ PDF</b> fetches it: PaperShelf looks for a free legal copy and opens it; if there is none, it opens the article page – log in with your university there and download it: it is attached automatically.</li>
        <li>“include sub-labels” shows the papers of all sub-labels too. Deleting a label never deletes papers.</li></ul>
      <h4>The library menu</h4>
      <p><i>All papers</i>, <i>To read</i> and <i>Reading</i> are always shown; <i>Starred</i>, <i>Read</i>, <i>Without labels</i> and <i>Without PDF</i> are under <b>More</b>.</p>
      <h4>Keywords</h4>
      <p>Filled in automatically, editable in each paper. The sidebar shows the most frequent keywords of the papers in view (bigger = more frequent); <b>Show all</b> and the filter box find the others, and ▾ folds the section away. Click a keyword to filter; <i>Make label from keyword</i> turns the filter into a label.</p>
      <p>With many papers, keywords tend to multiply (“fMRI”, “functional MRI”, “fmri”…). Click <b>✎</b> next to <i>Keywords</i> to <b>merge</b> variants into one, <b>rename</b> or <b>delete</b> keywords in the whole library at once.</p>
      <h4>Status, stars, notes</h4>
      <p>Mark papers <i>To read / Reading / Read</i>, star the important ones, write notes in the details panel.</p>
      <h4>Search and shortcuts</h4>
      <p>The search box (top right) looks in titles, authors, journals, keywords, abstracts and notes – <b>and inside your PDFs</b>: PaperShelf indexes the text of every PDF on this computer in the background, so a word written anywhere in a paper is found too. Matches inside a PDF show the page and the sentence; click it to open the PDF at that page. Several words must all appear in the paper; use "quotes" for an exact phrase. Scanned PDFs without a text layer can't be searched. Shortcuts: ${kbd('/')} search · ${kbd('n')} add · ${kbd('Esc')} close · ${kbd('Delete')} delete selected.</p>`},

    {id: 'pdfs', icon: '📄', title: 'Getting PDFs', html: () => `
      <p><b>⬇ Find &amp; download PDF</b> looks for a legal, free copy in this order: arXiv · the link found when the paper was added · Unpaywall · OpenAlex · Semantic Scholar · CORE (university repositories) · Europe PMC / PubMed Central · the publisher's page.</p>
      <p>PDFs are saved in your PDF folder (⚙︎ Settings) with tidy names like <code>Rossi_2020_Orientation_tuning_in_mouse.pdf</code>. Select several papers and use <b>⬇ Find PDFs</b> to fetch them all.</p>
      <h4>No free PDF?</h4>
      <ul><li>Use <b>🔐 Open article &amp; log in with my university</b> – see <a href="#" data-help="university">University access</a>.</li>
        <li>Downloaded it yourself? <b>📎 Attach PDF</b>, or drop the file on the paper's panel.</li>
        <li>Write to the author: most are happy to send their paper.</li></ul>
      ${tip('An e-mail for Unpaywall and a free CORE key (⚙︎ Settings) noticeably increase how many free PDFs are found.')}
      <p class="muted">PaperShelf only uses legal sources; it never uses “shadow libraries”.</p>`},

    {id: 'university', icon: '🔐', title: 'University access (paywalled papers)', html: () => `
      <p>For papers your university subscribes to. You log in yourself on your university's page, as usual – PaperShelf never sees your credentials.</p>
      ${step(1, 'Open the paper in PaperShelf and click <b>🔐 Open article &amp; log in with my university</b>. The article opens on the journal\'s website.')}
      ${step(2, 'On that page click <b>Access through your institution</b> (also called “Institutional login”, “Log in via your university”, “Shibboleth”, “OpenAthens”), choose your university and sign in.')}
      ${step(3, 'Click the journal\'s <b>Download PDF</b> button.')}
      ${step(4, 'Done: PaperShelf notices the new file in your <b>Downloads</b> folder, reads its DOI and attaches it to the paper (you get a 📎 message).')}
      ${warn(`On a Mac, the first time, macOS asks whether “Terminal” may access the Downloads folder: click <b>Allow</b>. If you clicked “Don't allow”: System Settings → Privacy &amp; Security → Files and Folders → Terminal → turn on “Downloads folder”.`)}
      <h4>Optional: your library's access address</h4>
      <p>Many universities have an access address (EZproxy / OpenAthens), e.g. <code>https://ezproxy.your-uni.edu/login?url=</code>. Add it in ⚙︎ Settings → <i>University / library access</i>: a <b>🏛 Via …</b> button appears and opens articles already through your library. Find the address on your library website (“off-campus access”, “EZproxy”, “bookmarklet”) and press <b>Test</b>.</p>
      <h4>Good to know</h4>
      <ul><li>On campus or with the university VPN, “Find &amp; download PDF” often works directly.</li>
        <li>“Always attach PDFs I download” (Settings) attaches any matching PDF you download, not only after clicking the button.</li>
        <li>If a downloaded PDF has no DOI inside, PaperShelf asks you which paper it belongs to.</li>
        <li>PDFs obtained through your university are for your personal use – don't share them.</li></ul>`},

    {id: 'reader', icon: '📖', title: 'Reading & highlighting', html: () => `
      <ul><li><b>📖 Read &amp; highlight</b> opens the PDF inside PaperShelf (works offline).</li>
        <li>Select text → click a colour to highlight it; <i>🖍 + note</i> adds a comment.</li>
        <li>Click a highlight to change colour, add a note or delete it. The list on the right jumps to each highlight.</li>
        <li><b>Add to paper notes</b> copies all highlights into a note of the paper; <b>Copy all</b> copies them to the clipboard.</li>
        <li>When you write a note on a highlight, <i>Also add it to the paper's notes</i> copies it (with the highlighted sentence and page) into the paper's notes: <b>🔒 private</b>, or <b>🌐 public</b> in a shared label the paper belongs to, so its members see it.</li>
        <li><b>💾 Save into PDF</b> writes the highlights into the file itself, so they appear in Preview, Acrobat or Zotero (repeat it after new highlights – nothing is duplicated).</li></ul>`},

    {id: 'export', icon: '⤓', title: 'Citations, export & Zotero', html: () => `
      <h4>Citation styles</h4>
      <p>APA 7, Nature, Science, Cell Press (Cell, Neuron, Current Biology, Cell Reports, iScience), Royal Society (Proc B), J Neurosci, eLife, PNAS, PLOS/Vancouver. Choose the default in ⚙︎ Settings or in any paper's “Reference” box. <b>❝ Copy citation</b> copies one reference with italics.</p>
      <h4>Export</h4>
      <p><b>⤓ Export references</b>: the selected papers, the current label or everything, as</p>
      <ul><li><b>.txt</b> – reference list to paste · <b>.rtf</b> – for Word/Pages with italics and hanging indent</li>
        <li><b>.ris</b> – for Zotero, EndNote, Mendeley (keeps keywords and notes, links the PDFs, can add your labels as tags)</li>
        <li><b>.bib</b> – LaTeX/Overleaf · <b>.json</b> (CSL) · <b>.csv</b> – spreadsheet</li></ul>
      <h4>Moving papers to Zotero</h4>
      ${step(1, 'Export as <b>RIS</b> (tick “Add my labels as tags”).')}
      ${step(2, 'In Zotero: <b>File → Import…</b> → choose the file → Next.')}
      ${step(3, 'The papers arrive in a new collection with their PDFs linked and your labels as tags.')}
      ${tip('Numbered styles (Nature, Cell, Science…) are numbered in the exported list; in a manuscript Zotero handles the in-text numbering.')}`},

    {id: 'map', icon: '🕸', title: 'Citation map & Discover', html: () => `
      <h4>Map</h4>
      <p>Click <b>🕸 Map</b> above the list: the papers of the current view become a network. Arrows go from the citing paper to the cited one; grey dashed dots are papers you don't have that several of yours cite – click them to add them.</p>
      <p>Scroll to zoom, drag to move, click a paper to open it. Colour by label, status or year.</p>
      <h4>Three kinds of links</h4>
      <ul><li><b>Citations</b> – who cites whom (data from OpenAlex).</li>
        <li><b>Keywords</b> – the most common keywords become ◆ nodes and each paper is linked to its keywords, so papers on the same topics cluster together. Or choose <i>Papers linked by shared keywords</i> (thicker line = more keywords in common). Click a keyword ◆ to show only its papers.</li>
        <li><b>Labels</b> – your personal labels become ◆ nodes (a dashed line joins a sub-label to its parent) and each paper is linked to its labels: papers with several labels sit between them. Click a label ◆ to open it. Shared labels are not used here.</li></ul>
      <h4>Search by topic (in Discover)</h4>
      <p>At the top of <b>💡 Discover</b>, describe what you're looking for – a few words, a question, or even a whole abstract – and click <b>Search</b>. <b>By meaning</b> (OpenAlex semantic search) compares your text with the titles and abstracts of 250+ million works, so it also finds papers that talk about the same idea in other words; <b>By words</b> is the classic search. Filter by year, type or free-to-read, and add any result with one click. From the Add box, the suggestions list offers <i>🔎 Search by topic</i> too. Only your search text is sent to OpenAlex.</p>
      <h4>Discover</h4>
      <p><b>💡 Discover</b> suggests papers for the current label (or the whole library): works often cited by your papers, recent papers that cite yours, and related works. One click adds them.</p>
      <h4>Citation data</h4>
      <p>Both use citation data from OpenAlex, a free scholarly database (needs internet). New papers get it automatically; for older ones click <b>Get citation data</b>.</p>
      ${tip('If you see “OpenAlex’s free daily allowance is used up”, add a free OpenAlex key – see <a href="#" data-help="keys">Optional keys</a>.')}`},

    {id: 'researchers', icon: '👤', title: 'Researchers', html: () => `
      <p>The <b>Researchers</b> tab builds a profile of a scientist from official sources and lists all their publications.</p>
      ${step(1, 'Type an <b>ORCID iD</b> (most precise) or a name, and pick the right person (check institution and topics: names are often shared).')}
      ${step(2, '<b>Overview</b>: summary (publications, first / co-first / last / co-last authorship, this year), metrics and charts (OpenAlex), positions, education, funding, awards (ORCID).')}
      ${step(3, '<b>Publications</b>: one table with year, type, the researcher\'s role, journal impact factor at publication and today, citations.')}
      <h4>How the list is built</h4>
      <ul><li>ORCID, OpenAlex (and Google Scholar if imported) are merged and <b>duplicates removed</b> (same DOI, or same title and year).</li>
        <li>Each item gets a type: journal article, preprint, conference paper, abstract/poster, book, thesis, data/software, other. Datasets and files in repositories (figshare, Zenodo, Dryad, OSF, OpenNeuro…), supplementary files, peer-review reports and corrections are recognised from the DOI, the link and the title. Wrong? Change the type in the table – PaperShelf remembers it.</li>
        <li><b>Role</b>: first, co-first, last, co-last or sole author; empty for middle positions. Co-first and co-last are found in two steps:
          <ol><li>the equal-contribution flags recorded in <b>PubMed</b>;</li>
          <li>for papers where the researcher is in a middle position, PaperShelf <b>reads the paper itself</b> – the Europe PMC full text, the legal open-access PDF, or the article page on the publisher's site – looking for notes such as “† These authors contributed equally” or “M.R. and P.N. contributed equally”. Only a block of equal contributors starting with the first author (co-first) or ending with the last author (co-last) counts.</li></ol>
          This runs by itself in the background when you open a researcher (progress in the Summary card; you can stop it). Hover a role to see where it was found. Papers that can only be read behind a paywall can't be checked.</li>
        <li><b>IF</b>: see <a href="#" data-help="journal-metrics">Journal metrics &amp; impact factor</a>. The first time, click <i>Load journal metrics</i>.</li>
        <li>Not theirs? Hide it with ✕ (OpenAlex sometimes confuses people with the same name – items “not in ORCID” deserve a check).</li></ul>
      <h4>Filters</h4>
      <p>Type chips, search, role (e.g. “first, co-first, last or co-last”), years, <i>only ${new Date().getFullYear()}</i>, <i>separate years</i> (headings per year).</p>
      <h4>Sorting</h4>
      <p>Click any column title – Year, Publication, Type, Role, IF pub., IF now, Cit. – to sort by it; click again to reverse (▲ ascending, ▼ descending). Papers without a value always go last. The menu next to the filters does the same.</p>
      <h4>Export (publication list / CV)</h4>
      <p><b>⤓ Export list</b> saves a web page, Word/Pages (.rtf), text, spreadsheet, RIS or BibTeX. You choose:</p>
      <ul><li>which publications and types (supplementary files and other minor items are left out by default), or <b>only the current year</b>;</li>
        <li>journal <b>impact factor</b> at publication and current;</li>
        <li><b>numbering</b> 1, 2, 3… from the oldest;</li>
        <li><b>highlighting</b> of first, co-first, last and co-last authorship (name bold and underlined, with a label);</li>
        <li>a <b>summary table</b> (totals by type and role, all years / journal articles / this year);</li>
        <li>sections by type, by year or both, newest or oldest first, citation style.</li></ul>
      <p>Title and file name include the update date.</p>
      <h4>Google Scholar data</h4>
      <p>Google doesn't allow programs to search Scholar, so you bring in the <b>public</b> profile page you are viewing:</p>
      ${step(1, `Drag this button to your bookmarks bar: <a class="bookmarklet" href="${esc(People.scholarBookmarklet())}" onclick="return false">🎓 Import Scholar profile</a>`)}
      ${step(2, 'Open the researcher\'s profile on scholar.google.com; click “Show more” at the bottom until all papers are listed.')}
      ${step(3, 'Click the button and choose the profile to add the data to. Citations, h-index, i10, citations per year, photo and publications are added and compared with OpenAlex.')}`},

    {id: 'journal-metrics', icon: '📊', title: 'Journal metrics & impact factor', html: () => `
      <p>The official <b>Journal Impact Factor</b> belongs to Clarivate (Journal Citation Reports) and is only available with a subscription, so PaperShelf can't download it. It shows open, citable equivalents instead – for the year a paper was published and for today:</p>
      <ul><li><b>Quartile (Q1–Q4) and SJR</b> – SCImago Journal Rank, based on Scopus.</li>
        <li><b>Citations per document, 2 years</b> – the same formula as the impact factor, on Scopus data; usually close to it.</li>
        <li><b>2-year mean citedness</b> – the same idea on OpenAlex data (current).</li></ul>
      ${step(1, 'In a researcher\'s <b>Publications</b> click <b>Load journal metrics</b> (once). The SCImago tables for the years needed are downloaded (3–6 MB per year) and kept on your computer; later, missing years are loaded automatically.')}
      ${step(2, 'The <b>IF pub.</b> and <b>IF now</b> columns fill in, with the quartile. Values marked * are SCImago citations per document; click a value for all the numbers.')}
      <h4>Years without a table</h4>
      <p>SCImago publishes each year's table around June of the following year, and not every year may be available on your computer. When the table for a year is missing, PaperShelf uses the <b>closest previous year</b> that has data for that journal and shows that reference year in small under the value (e.g. a 2026 paper with <i>2025</i> data). If there is no earlier data, the cell stays empty.</p>
      <h4>If the download is refused</h4>
      <p>scimagojr.com sometimes refuses downloads made by programs, but not those made by your browser. PaperShelf then shows a yellow note with <b>Get the missing years…</b>:</p>
      ${step(1, 'The window lists exactly the years this researcher needs (the latest one and each publication year). Click <b>Download all missing years</b> – or one year at a time.')}
      ${step(2, 'Your browser downloads the tables (allow several downloads if it asks). As soon as a table lands in Downloads, PaperShelf <b>moves it into its own folder</b> <code>~/PaperShelf/journal-metrics</code> and uses it: each year turns ✓ and the IF columns fill in.')}
      <p>All the tables live in that folder (⚙︎ Settings → Data sources → <i>Open tables folder</i>) and serve every researcher: years already there are never asked again. You can also drop SCImago files into it yourself – they are picked up within a minute.</p>
      <h4>Why some cells are empty</h4>
      <ul><li><b>Not a journal publication</b> (preprint, dataset, supplementary file, peer-review report, thesis): no impact factor – the cell is left blank.</li>
        <li><b>“not indexed”</b>: the journal isn't in SCImago (often a new journal). Click the cell to type its impact factor yourself.</li>
        <li><b>The current year</b>: SCImago publishes a year's table only the following June, so this year's papers use the latest table available (shown in small, e.g. <i>2025</i>).</li></ul>
      <h4>Why not fully automatic?</h4>
      <p>The official Journal Impact Factor is sold by Clarivate and can't be downloaded freely. SCImago offers its yearly tables for free on its website; when the site doesn't answer programs, the one-click browser download is the legal way to get them.</p>
      ${step(3, 'Know the official impact factor (many journals show it on their homepage, or via your university\'s JCR access)? Type it in that window: it is stored only on your computer.')}
`},

    {id: 'sync', icon: '⟳', title: 'Sync between computers (GitHub)', html: () => `
      <p>Keep the same library on several computers (Mac and/or Windows). Your library is copied to a <b>private</b> repository on your GitHub account; each computer sends and receives changes when you press <b>⟳</b>.</p>
      <p class="muted">Synced: papers, details, personal labels, notes, highlights, reading status – and PDFs if you choose. Never synced: settings, keys, researcher profiles.</p>
      <h4>Once, on GitHub (5 minutes)</h4>
      ${step(1, 'Create a free account on <a href="https://github.com/signup" target="_blank" rel="noopener">github.com</a> if you don\'t have one.')}
      ${step(2, 'Go to <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>. Name: <code>papershelf-library</code>. Choose <b>Private</b>. Leave “Add a README” <b>unticked</b>. Click <b>Create repository</b> and copy its address (e.g. <code>https://github.com/your-name/papershelf-library</code>).')}
      ${step(3, `Create an access token – a password for PaperShelf only: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">open the token page</a> (or GitHub → your photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token).
        <ul><li>Name: <code>PaperShelf</code> · Expiration: up to 1 year (note it in your calendar)</li>
        <li>Repository access: <b>Only select repositories</b> → <code>papershelf-library</code></li>
        <li>Permissions → Repository permissions → <b>Contents</b>: <b>Read and write</b></li>
        <li>To also share labels with colleagues: Permissions → Account permissions → <b>Gists</b>: <b>Read and write</b></li>
        <li>Click <b>Generate token</b> and copy it (starts with <code>github_pat_</code>; it's shown only once – if lost, make a new one).</li></ul>`)}
      <h4>On each computer</h4>
      ${step(4, isMac() ? 'Install Git (once): open the <b>Terminal</b> app, type <code>xcode-select --install</code>, press Enter and accept. If it says it\'s already installed, you\'re done.'
        : 'Install Git (once) from <a href="https://git-scm.com/download/win" target="_blank" rel="noopener">git-scm.com</a> with the default options, then restart PaperShelf.')}
      ${step(5, 'Open <b>⚙︎ Settings → 💻 Sync my computers</b>, paste the token and the repository address, click <b>Test connection</b>, then <b>Save</b>. The first sync starts by itself.')}
      ${step(6, 'On the other computer install PaperShelf and repeat steps 4–5 with the same address (same or new token). After the sync, the library appears there.')}
      <div class="h-live" id="h-sync-live"><button class="btn small" id="h-sync-test">Test my current settings</button> <span id="h-sync-res" class="muted small"></span></div>
      <h4>Every day</h4>
      <ul><li>Press <b>⟳</b> (top right) – or tick <i>Sync automatically</i> (at start and every 20 minutes).</li>
        <li>Habit: sync before closing PaperShelf on one computer and after opening it on the other.</li>
        <li>If the same paper is changed on two computers between syncs, the latest change wins. Deletions are applied everywhere.</li></ul>
      <h4>PDFs</h4>
      <ul><li><b>Off</b> (default): only the library travels (a few MB). Use <b>⬇ Find PDFs</b> on the other computer for the free ones.</li>
        <li><b>On</b>: PDFs travel too. GitHub works best under ~1 GB (≈400–500 papers with PDFs) and refuses files over 100 MB.</li>
        <li>Keep the repository <b>private</b>: PDFs from your university are for your personal use only.</li></ul>
      <h4>Problems</h4>
      <table class="h-table"><tr><th>Message</th><th>What to do</th></tr>
        <tr><td>Git is not installed</td><td>Step 4, then press ⟳ again.</td></tr>
        <tr><td>GitHub refused access</td><td>Token wrong or expired, or without <i>Contents: Read and write</i> on this repository. Make a new one (step 3) and paste it in Settings.</td></tr>
        <tr><td>Repository not found</td><td>Copy the address again from the repository page; check the token includes this repository.</td></tr>
        <tr><td>No internet connection</td><td>Nothing is lost – sync later.</td></tr>
        <tr><td>⟳ is red</td><td>Hover it to read the last error.</td></tr></table>`},

    {id: 'sharing', icon: '🔗', title: 'Shared labels with colleagues', html: () => `
      <p>A <b>shared label</b> is a label you keep in common with one or more colleagues – a journal club, a lab reading list, “papers for Mario”. Only the <b>bibliographic details</b> of its papers travel (title, authors, year, journal, DOI) and the <b>public notes</b> members write on them: never PDFs, private notes, highlights or anything else from your library.</p>
      <h4>Shared vs personal labels</h4>
      <p>In the sidebar, <b>Labels</b> has two parts: <i>Personal</i> (your topics) and <i>Shared</i>. A paper can have both. The map, Discover and statistics use only personal labels. If you like, the papers that arrive with a shared label can also get one of your personal labels (shared label ⚙︎ → <i>Also give papers that arrive here my label…</i>).</p>
      <h4>What happens to the papers</h4>
      <ul><li>Papers that arrive with a shared label are <b>added to your library</b> (or simply labelled, if you already had them).</li>
        <li>If someone removes a paper from the shared label, your copy only <b>loses the label</b> – it stays in your library until you delete it yourself.</li>
        <li>If you delete a shared paper, PaperShelf asks whether to remove the shared label for everybody too (their copies stay, without the label) or to keep it for the others.</li></ul>
      <h4>Several people, always in sync</h4>
      <p>Every member’s PaperShelf reads the copies of all the other members and merges them. Changes travel along any chain: if you share with Anna and Anna adds Luca, Luca’s papers reach you through Anna even before you have read Luca’s copy. The merge doesn’t depend on the order or timing of the updates (each change carries a counter, not the clock time), so nothing is lost or brought back by mistake. Updates run when PaperShelf starts, every 15 minutes and right after you change something; <b>⟳ Update now</b> forces one.</p>

      <h4>1 · Turn sharing on (once, 2 minutes)</h4>
      <p class="muted">Only to create or edit shared labels. To follow a colleague’s label you need nothing.</p>
      ${step(1, 'Your GitHub token needs the <b>Gists</b> permission. If you already use library sync, just edit that token: GitHub → your photo → Settings → Developer settings → Personal access tokens → <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">Fine-grained tokens</a> → your PaperShelf token → <b>Edit</b> → Account permissions → <b>Gists: Read and write</b> → <b>Update</b>. Otherwise create a token with that permission (see <a href="#" data-help="sync">Sync</a>, step 3).')}
      ${step(2, 'In PaperShelf: ⚙︎ Settings → <b>👥 Sharing</b> → choose your name, paste the token (or leave it empty if your sync token already has the Gists permission) → <b>Turn on sharing</b>.')}
      <p>That’s all: PaperShelf creates a <b>secret gist</b> on your account to keep your shared labels – a small online notebook that isn’t listed anywhere; only people with a code can read it. No repository to create. On your other computers, turning sharing on with the same token finds the same gist and restores your shared labels.</p>

      <h4>2 · Share</h4>
      ${step(1, 'Sidebar → Labels → <b>Shared ＋</b> → <i>New shared label</i>: start from one of your labels, from the selected papers, or empty. Later, <b>drag papers onto it</b> (or select them → <i>Share…</i>, or use “Shared labels” in a paper’s details).')}
      ${step(2, 'In its ⚙︎ add your colleagues as <b>members</b> (their GitHub names) – members can add and remove papers too.')}
      ${step(3, 'Click the shared label, then the blue <b>📤 Invite colleagues / code</b> button above the list (or 📤 next to the label in the sidebar) → <b>Copy code</b> (e.g. <code>YourName/1a2b…/9f8e…</code>) and send it by e-mail or chat. <i>Copy invitation message</i> copies a ready-made text with the instructions.')}

      <h4>3 · Join</h4>
      ${step(1, 'Sidebar → Labels → <b>Shared ＋</b> → <i>Join a shared label</i> → paste the code → <b>Join</b>.')}
      ${step(2, 'If they added you as a member (and you turned sharing on), you can edit it too: your PaperShelf tells theirs where your copy is with a short comment on their gist, signed by GitHub with your account. Otherwise you <b>follow</b> it 📥: you receive everything, read-only. Removing a paper from a label you follow removes it only for you.')}

      <h4>Who takes part</h4>
      <p>Above the papers of a shared label you see its <b>people</b> 👥: every member with the name they chose (⚙︎ Settings → 👥 Sharing), and tags for <i>you</i>, the <i>creator</i> and people <i>invited</i> who haven't joined yet. Click them for details: GitHub name, since when, how many papers and public notes each added. This list is shared and updated like the papers and notes. People who only follow the label with the code aren't listed, because they don't publish anything.</p>
      <h4>Without GitHub</h4>
      <p>In a shared label’s ⚙︎ click <b>Save as file</b> and send the <code>.papershelf</code> file by e-mail or chat. The recipient opens it with <i>Shared ＋ → Open a label file</i>. If the label is also online, their copy keeps updating by itself.</p>

      <h4>Privacy</h4>
      <ul><li>Your shared labels live in a secret gist: anyone who has a code can read the titles in it, nobody else can find it.</li>
        <li>Your library, PDFs, private notes, highlights and your private sync repository are never involved. Public notes travel only inside the label they were written in, with the name you chose in ⚙︎ Settings → 👥 Sharing.</li>
        <li>PaperShelf only reads the gists of the members of the labels you joined.</li></ul>`},

    {id: 'notes', icon: '📝', title: 'Notes – private and public', html: () => `
      <p>Every paper has its own small <b>chat of notes</b>. The 📝 button on each row of the list shows how many notes a paper has, without opening it: <span class="note-btn priv" style="display:inline-flex">📝<b>2</b></span> private only, <span class="note-btn pub" style="display:inline-flex">📝<b>3</b></span> with public notes, <span class="note-btn both" style="display:inline-flex">📝<b>5</b></span> both. Click it (or <i>Open notes</i> in the paper's details) to read and write.</p>
      <h4>Two kinds of notes</h4>
      <ul><li><b>🔒 Private</b> – the default. Only in your library (and in your own private sync, if you use it). Nobody else ever sees them.</li>
        <li><b>🌐 Public</b> – only for papers in a <a href="#" data-help="sharing">shared label</a>. Choose <i>Public in “label”</i> under the text box: every member of that label sees the note, with your name, at their next update (every 15 minutes, or ⟳ Update now).</li></ul>
      <h4>Who can change what</h4>
      <ul><li>You can <b>edit</b> ✎ or <b>delete</b> 🗑 your own notes at any time. Editing or deleting a public note changes it for everybody.</li>
        <li>Nobody can change someone else's note: each member's own copy decides about that member's notes, so a changed copy elsewhere is ignored.</li>
        <li>You can <b>hide</b> 🙈 someone else's note on your computer only; the others still see it. Hidden notes can be shown again (“Show hidden”).</li>
        <li>People who only follow a label (read-only) see its public notes but can't write public notes.</li></ul>
      <h4>Your name</h4>
      <p>The first time you write a public note or create a shared label, PaperShelf asks the name to show next to it: your name, initials or a nickname. Change it in ⚙︎ Settings → 👥 Sharing → <i>Your name for colleagues</i>. Shared labels also remember who created them (⚙︎ of the label).</p>
      <h4>Styles and colours</h4>
      <p>Use the buttons above the text box, or type Markdown: <code>**bold**</code>, <code>*italic*</code>, <code>~~strike~~</code>, <code>==highlight==</code>, <code>{red}coloured{/}</code> (red, orange, green, blue, purple, grey), <code>## heading</code>, <code>- list</code>, <code>- [ ] to do</code>, <code>&gt; quote</code>, <code>\`code\`</code>, <code>[text](https://…)</code>. 👁 Preview shows the result; ${kbd('⌘/Ctrl')} + ${kbd('Enter')} saves.</p>
      <h4>Exporting notes</h4>
      <p>Select one or more papers → <b>📝 Export notes</b> (or ⤓ Export in the notes window, or <i>Export notes with their references…</i> in Export references). You get one file with each paper's reference in your chosen style followed by its notes, who wrote them and when – as Markdown, plain text or a web page.</p>
      ${tip('Highlights from the PDF reader can be copied into a private note: open the paper → Highlights → <i>copy them into a private note</i>.')}`},

    {id: 'updates', icon: '⬆️', title: 'Installing & updating the app', html: () => `
      <h4>Two separate folders</h4>
      <ul><li><b>The app</b>: the folder with <code>start.command</code> – here: <code>${esc(state.appDir || '')}</code></li>
        <li><b>Your library</b>: <code>${esc(state.dataDir || '~/PaperShelf')}</code> (database, PDFs, profiles, settings)</li></ul>
      ${warn('Never put the app folder inside the library folder (or the other way round). Updating the app never touches your library.')}
      <h4>Automatic updates (default)</h4>
      <p>Every time PaperShelf starts it checks the project page on GitHub. If a new version exists it is installed <b>before the app opens</b> (a few seconds, a backup of the old version is kept), and a message tells you what's new. Nothing else to do. Turn it off in ⚙︎ Settings → <i>Updates</i> if you prefer to choose yourself.</p>
      <h4>Updating with the button</h4>
      ${step(1, 'If automatic installation is off, or a version is published while PaperShelf is open, a <b>⬆ Update</b> button appears at the top right (or open ⚙︎ Settings → <i>Updates</i> → <i>Check for updates…</i>). The round <b>⟳</b> button at the top checks too – together with your library sync and shared labels – and opens the update window when a new version exists.')}
      ${step(2, 'Read what’s new and click <b>Install update and restart</b>. PaperShelf downloads the new version from GitHub, keeps a backup of the current one and restarts by itself; the page reloads after a few seconds.')}
      ${step(3, 'That’s it – your papers, PDFs, labels, notes and researcher profiles are exactly as before.')}
      <p>The check is an anonymous request to GitHub (like opening the project page): nothing about you or your library is sent. Both the check and the automatic installation can be turned off in the Updates window.</p>
      <h4>If something goes wrong</h4>
      <ul><li><b>No internet / GitHub blocked</b>: download the zip from the project's <i>Releases</i> page yourself and use <b>Install from a zip file…</b> in the Updates window.</li>
        <li><b>Going back</b>: every update leaves a zip of the previous version in <code>${esc(state.dataDir || '~/PaperShelf')}/backups</code> (button <i>Backups</i>). Close PaperShelf, unzip it, and start that copy.</li>
        <li><b>It didn't restart</b>: close the PaperShelf window and open <code>start.command</code> / <code>start.bat</code> again.</li></ul>
      <h4>Updating by hand</h4>
      ${step(1, 'Close the PaperShelf window (Terminal / command window).')}
      ${step(2, 'Replace the old <b>app</b> folder (the one with <code>app.py</code>) with the new one, unzipped in the same place.')}
      ${step(3, 'Start it with <code>start.command</code> / <code>start.bat</code>. New libraries are installed automatically.')}
      <h4>Git copies</h4>
      <p>If you downloaded the app with <code>git clone</code>, the start file runs <code>git pull</code> at every start, and the Update button uses <code>git pull</code> too.</p>
      <h4>Back-up</h4>
      <p>Back up the library folder (Time Machine on Mac, File History on Windows). GitHub sync is also a copy of your library.</p>`},

    {id: 'keys', icon: '🔑', title: 'Optional keys & e-mail', html: () => `
      <p>PaperShelf works without any of these; they make some features work better. All are stored only on this computer.</p>
      <table class="h-table"><tr><th></th><th>What for</th><th>How to get it</th></tr>
        <tr><td><b>E-mail for Unpaywall</b></td><td>Unpaywall, the largest index of legal free PDFs, requires an e-mail with each request. Sent only to Unpaywall.</td><td>Any address you use.</td></tr>
        <tr><td><b>OpenAlex key</b></td><td>Citation map, Discover and researcher profiles use OpenAlex; without a key there is a small free daily allowance, a key gives 10× more.</td><td>Create a free account on <a href="https://openalex.org" target="_blank" rel="noopener">openalex.org</a> → <a href="https://openalex.org/settings/api" target="_blank" rel="noopener">settings/api</a> → copy the key.</td></tr>
        <tr><td><b>CORE key</b></td><td>Searches university repositories for the authors' own legal copies of papers.</td><td>Register at <a href="https://core.ac.uk/services/api" target="_blank" rel="noopener">core.ac.uk/services/api</a>; the key arrives by e-mail.</td></tr>
        <tr><td><b>GitHub token</b></td><td>Sync between computers.</td><td>See <a href="#" data-help="sync">Sync</a>.</td></tr></table>
      <p>Paste them in <b>⚙︎ Settings</b> and click Save.</p>`},

    {id: 'privacy', icon: '🛡', title: 'Privacy & legal', html: () => `
      <ul><li>PaperShelf runs on your computer and answers only to it; requests from other websites or computers are refused.</li>
        <li>Library, private notes, highlights, profiles and settings are stored only in your library folder – and in your own private GitHub repository if you turn on sync. Public notes go only to the members of the shared label you wrote them in.</li>
        <li>Online services receive only what a lookup needs (a DOI, a title, a name or ORCID iD you search). Your e-mail is never sent, except to Unpaywall if you enter it. E-mail search of researchers is disabled.</li>
        <li>University logins happen on your university's or the publisher's page; PaperShelf never sees credentials.</li>
        <li>Only official interfaces and legal open-access sources are used. Google Scholar is never queried automatically – only the page you choose to import.</li>
        <li>PDFs obtained through subscriptions are for personal use: keep a synced repository private and don't share them.</li>
        <li>Researcher profiles contain public professional data, kept locally. Ask before publishing someone else's publication page.</li></ul>`},

    {id: 'troubleshooting', icon: '🧰', title: 'Troubleshooting & FAQ', html: () => `
      <dl class="h-faq">
        <dt>The Mac says <code>start.command</code> “can't be opened” / is from an unidentified developer</dt>
        <dd>Right-click it → <b>Open</b> → <b>Open</b>. Needed only the first time.</dd>
        <dt>“Python 3 is not installed”</dt>
        <dd>Install it from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">python.org</a> (on Windows tick “Add python.exe to PATH”), then start again.</dd>
        <dt>The page says PaperShelf is not running</dt>
        <dd>The Terminal / command window was closed: start <code>start.command</code> / <code>start.bat</code> again and reload the page.</dd>
        <dt>“Could not reach …” / no internet</dt>
        <dd>Adding new papers, PDFs, citation data, profiles and sync need internet; everything else works offline.</dd>
        <dt>No free PDF found</dt>
        <dd>Use <a href="#" data-help="university">University access</a>, or attach a PDF you downloaded.</dd>
        <dt>A PDF I downloaded wasn't attached</dt>
        <dd>Check the Downloads permission (see <a href="#" data-help="university">University access</a>) and that the folder in Settings is your Downloads folder. PDFs without a DOI inside are attached after you confirm which paper they belong to.</dd>
        <dt>Wrong title/authors</dt>
        <dd>Edit the fields, or <b>↻ Update metadata</b> with the DOI.</dd>
        <dt>“OpenAlex's free daily allowance is used up”</dt>
        <dd>Add a free OpenAlex key (<a href="#" data-help="keys">Optional keys</a>) or try again tomorrow.</dd>
        <dt>Sync errors</dt>
        <dd>See the table in <a href="#" data-help="sync">Sync</a>, and run the <a href="#" data-help="status">System check</a>.</dd>
        <dt>Where are my files? How do I back up?</dt>
        <dd>Library: <code>${esc(state.dataDir || '~/PaperShelf')}</code> (database <code>library.db</code> and folder <code>PDFs</code>). Back up that folder.</dd>
        <dt>How do I uninstall?</dt>
        <dd>Delete the app folder. Delete the library folder only if you no longer want your library.</dd>
      </dl>`},

    {id: 'status', icon: '🩺', title: 'System check', html: () => `
      <p>What works and what needs attention on this computer.</p>
      <div id="h-diag" class="muted">Checking…</div>`},
  ];

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
      <p class="muted small">Help is always one click away: the <b>?</b> button at the top, and the <b>?</b> next to anything that needs explaining.</p>
      <div class="modal-actions"><button class="btn" data-help="start">Read the guide</button><button class="btn primary" data-close>Start</button></div>`, {wide: true});
    $$('[data-help]', m.el).forEach(b => b.addEventListener('click', () => m.close()));
  }

  return {open, close, isOpen: () => root()?.classList.contains('open'), welcome};
})();
