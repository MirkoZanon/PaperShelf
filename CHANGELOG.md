# Changelog

Each section's text is used as the release notes shown in the app's Update window.

## 3.13 – 2026-11-27
- **Authors, one person per row**: in a paper's *Edit details* the authors are now rows with **First name(s) or initials** and **Surname**, plus **Add author**, move up/down (the first row is the first author) and remove. Nobody has to guess commas and spaces, and the names are saved the way citations need them. A row with a first name but no surname is marked and not saved. **Paste a list instead** still understands "Rossi M, Bianchi L" or "Marco Rossi and Luca Bianchi" and turns it into rows.

## 3.12 – 2026-11-27
- **Wrong author names in citations, fixed**: a paper keeps in the group the details it had when it was added, so a paper typed by hand and corrected later (authors, year, title) was still cited with the old, empty or someone else's details. Now every correction you make in your library (or "Refresh") also updates the group's copy, and papers corrected earlier are brought up to date the first time you open a document. Note: a citation label is made of the first author and the year (Rossi2020), so it changes if you change those.
- **Authors typed on one line**: "Rossi M, Bianchi L", "Rossi, M., Bianchi, L.", "Marco Rossi and Luca Bianchi" or "Smith JK; Lee K" are now read as separate authors (before, the whole line became a single author with an odd name).

## 3.11 – 2026-11-27
- **Simpler Lab**: a group now has only two tabs, **Home** and **Ideas and discussion**. The calendar is not specific to a group, so the per-group Calendar tab is gone: use **Calendar** on the left of Lab (all groups, with a Group choice for new events). Home keeps its small calendar, now with **New event** and a link to the full calendar.
- **No second place for documents**: the group's Documents tab is gone too, because the same documents are in **Write**. On the group's Home, "Documents being written" opens a document in Write; **New** and **All documents** are next to it.
- Fixed a small error that could appear in the background after closing a document.

## 3.10 – 2026-11-27
- **Cite search, fixed**: searching an author name now puts the papers *by* that author first (exact surname, then name starts, then the rest of the authors), and only then papers that merely contain the word in the title. Accents are ignored (`bodenes` finds Bodénès), and the lists are longer (30 group papers, 60 from your library), newest first among equals.

## 3.9 – 2026-11-27
- **Lab always opens on Home**: each click on Lab lands on the group's Home page (plans, tasks and the shortcuts).
- **Your picture**: your own avatar (tasks, posts, documents) uses your GitHub picture when you are signed in, otherwise the colour of the app. Others keep their own colours.
- **Icons in the app style**: the calendar (Reminders, Export, New event, task and plan markers) and the Lab use the same line icons as the rest of the app instead of emoji and symbols.
- **"Your copy of this document was out of date"**: when the group's copy turns out to be shorter than yours, PaperShelf now writes your text again instead of discarding the last seconds. If the message still appears it now says the reason in brackets, so we can find the cause.

## 3.8 – 2026-11-27
- **Lab home**: the first tab of a group is now **Home** (the old Plans and tasks page). On top, two shortcuts: the documents being written (authors, last edit, words, open comments) and the latest ideas and discussion. Click a row to open it. The Done column is slimmer and shows only the latest four finished tasks, with "Show all" for the rest.
- **Cleaner toolbars**: the calendar and document bars now have buttons of the same height (Month/Week/Agenda next to New event, Edit/Suggest/Preview next to Library), and the calendar filters are plain checkboxes instead of odd pills.

## 3.7 – 2026-11-27
- **Coloured text in documents**: new **Color** button in the toolbar and colour dots in the selection bar (red, orange, green, blue, purple, grey). Written as `{red}text{/}`; shown in colour while you write, in Preview and in the Word / Markdown / PDF exports. People who still have an older version see the plain markers.
- **Other people's changes as coloured text**: new text from others is written in their colour (and fades back after a short while) instead of a highlight. The Authors button colours all the text by author, also as font colour. A colour you choose yourself always wins.

## 3.6 – 2026-11-27
- **Plans and tasks, easier to read**: the board now starts with **Doing**, then To do, then Done.
- **A deadline for each checklist item**: every step in a task's checklist can have its own date (field at the right of the item). The date also shows on the task card, and the steps appear in the calendar as "Task › step", with the usual morning reminder, in the .ics export and on Home.
- **Deadlines at a glance**: above the board, chips show what is overdue, what is due in 7 days and what nobody has taken yet. Click one to filter the board.
- **Calendar widget on the page**: under the list of plans, a small month with the number of deadlines on each day (red when late, green when done) and the next deadlines below. It follows the plan you have open and "Only my tasks". Click a day to see its items, an item to open it, and "Open the full calendar" to go to the group calendar.
- "Today" and "due soon" now use your local date (they could be off by one around midnight).

## 3.5 – 2026-11-27
- **Document in its own window**: fixed the tools (Suggest, Cite, comments…) that did not work there. The app running behind the window was tearing the document down.
- **Several citations in one parenthesis**: `[@a] [@b]`, `[@a], [@b]` and `[@a]; [@b]` are now shown (and exported) together, like `(Smith, 2020; Lee, 2019)`.
- **Cite tool: search**: the search box is always there. It finds papers of the group and of your own library by title, author, year, DOI or keyword; a paper that is only in your library gets "Add and cite" (title, authors, year and DOI go to the group, never the PDF).
- **PDF reader in its own window**: "Own window" in the reader bar (or Shift/Cmd/Ctrl+click on Read) opens the PDF in a separate window with its highlights and notes, so you can have several PDFs open at once. Closing the window saves the page where you stopped.

## 3.4 – 2026-11-26
- **Authors in colour while you write**: a new "Authors" button in the second bar of a document colours each person's text in their own colour, in Edit and Suggest mode too (before this it was only in Review mode). A legend under the bar shows each colour with the person and their share of the text. It follows what you type, and each computer of a person keeps the same colour.

## 3.3.1 – 2026-11-26
- The word count moved to the right end of the second bar (the toolbar row), which is now shown in every mode so the count is always in the same place.

## 3.3 – 2026-11-26
- **Documents: both bars stay visible** while you scroll: the title bar with Edit / Suggest / Preview, and the formatting toolbar. The side panel sticks right under them.
- **Word count**: a button in the title bar shows the words of the document (and "11 of 960 words" while you select text). Click it for words, characters (with and without spaces), sentences, paragraphs and reading time, for the whole document and for the selected text. Works in every mode.

## 3.2 – 2026-11-26
- **Tasks in shared documents**: a comment, or a marked section of the text, can be given to yourself or to collaborators, with a deadline. Tick "Make it a task" when you comment (a section can be a task without writing a note), or use "Make a task" / "Edit task" on an existing comment.
- The task is shown on the comment, in the calendar (group and all-groups, with reminders and in the .ics export) and under "Needs you" on the Home tab. Clicking it opens the document at that comment. Resolving the comment completes the task.
- Fixed the missing calendar icon.

## 3.1 – 2026-11-26
- **Calendar on the Home tab**: a month grid with colored dots on days that have something (experiments, meetings, deadlines), plus a "Coming up" list for the next two weeks. Click a day to see what is on it, click an item to open it, and "Open calendar" jumps to the Lab calendar of all your groups.

## 3.0 – 2026-11-26
**The lab calendar.**
- New **Calendar** tab in every group, and **Calendar** in the Lab sidebar for all your groups together. Month, week and agenda views; filters (only mine, events, task deadlines, plan deadlines).
- **Events** shared with the group: experiments, meetings, deadlines and other, with date, start and end time, place, description, who is involved and a reminder. Click a day to add one. Events travel with the group like tasks do, so every member sees them on every computer.
- Task and plan deadlines appear in the calendar too, and the Overview has a **Coming up** list for the next 7 days.
- **Experiments and meetings get a discussion**: a post is created in Ideas and discussion (or link an existing one), and the event links to it.
- **Reminders**: a notification while PaperShelf is open, and an operating-system notification when it runs in the background. Deadlines remind you at 09:00 on the day. Turn them off with the 🔔 button.
- **Export to your calendar** (.ics) for a whole group, all groups, only yours, or a single event, for Apple Calendar, Google Calendar and Outlook (which then alert you even when PaperShelf is closed). Nothing is published online.
- Includes everything since 2.30: highlights, account and GitHub sign-in, several computers on one account, hidden console windows on Windows.

## 2.33.6 – 2026-11-26
- Windows: no more black console windows flashing when PaperShelf starts or updates (git, PowerShell and the like now run hidden).

## 2.33.5 – 2026-11-26
- Fixed: with several computers on the same GitHub account, what you did on one computer (accepting or resolving a comment, writing a comment, a note, a lab post) was dropped on your other computers, so they kept showing old open comments. Everything you write on any of your computers now reaches all of them.

## 2.33.4 – 2026-11-26
- Fixed: with several computers on the same GitHub account, one computer could overwrite another's newest document edits in your shared gist, and the overwritten one never noticed, so a third computer showed old versions. Each computer now checks whether your gist is missing something it has and publishes it again.
- Account panel: "Repair" publishes this computer's copy of every group again (use it on the computer that has the newest versions, then update the others).

## 2.33.3 – 2026-11-26
- The account icon shows your GitHub profile picture (fetched once from GitHub and kept on this computer; your initial is shown if it can't be loaded).
- Settings: the top-right button is now "Close" instead of "Quit". "Quit PaperShelf" moved to the bottom of the General tab, with a short explanation.

## 2.33.2 – 2026-11-26
- "Find my groups" now says what it found online: how many groups your GitHub account holds and, for any it could not restore, why. This tells you whether the other computer has published them yet.

## 2.33.1 – 2026-11-26
- Fixed: on a new computer, signing in did not bring back your groups (they were only updated if the computer already had some). Signing in now restores all your groups, documents and notes from your GitHub account, and the update button and the automatic update do the same.
- The account panel has "Find my groups" and shows how many groups are on this computer.

## 2.33 – 2026-11-26
- New person icon in the top bar: your account. Signed out, it walks you through signing in with GitHub on screen, step by step (first the one-time GitHub preparation, then the short code), and says exactly what is created: a private "papershelf-library" repository, a secret gist for groups, and a token stored only on this computer.
- Signed in, the icon shows your initial. Its panel shows what is connected, lets you sync now, sign out, or switch to another saved account.

## 2.32 – 2026-11-26
- Sign in with GitHub (Settings → Groups): approve a short code on github.com and PaperShelf sets up Groups and your library sync by itself, creating the private papershelf-library repository if needed. No token to create or copy. On a new computer: sign in and everything is found again.
- One-time setup: this needs the Client ID of a free GitHub OAuth app (Device Flow enabled), pasted in the same screen. The token stays only on this computer. Using a token by hand still works.

## 2.31 – 2026-11-26
- Accounts: Settings → Groups now lists the GitHub accounts saved on this computer. Sign out, sign in to another account with one click, or remove one. Tokens stay on this computer only.
- Updates: after an update the browser can no longer keep old copies of the app's scripts and styles (a likely reason a computer looked "up to date" but behaved like an older version).
- Library sync: also runs when you come back to the app, and every 5 minutes (was 20). Warns if this computer's clock is wrong, because the newest edit wins when libraries merge.
- Windows: the shortcut icon is now stored in a local folder and uses a format all Windows versions draw (fixes the blank icon on some work computers); existing shortcuts are fixed after the update.

## 2.30.2 – 2026-11-25
- Highlighting now works the way you expect: select text with the mouse (or Shift+arrows) and a small row of colors appears next to the selection; click one and the text is highlighted.
- Fixed: the color swatches in the toolbar's Highlight menu did nothing after 2.30.1.

## 2.30.1 – 2026-11-24
- Highlight colors now open as a compact row of round swatches (plus "None") right under the button, never stacked or over the text.
- The formatting toolbar has a solid background and stays pinned at the top of the visible page while you scroll.

## 2.30 – 2026-11-24

- **Highlight text in color** – select a sentence and use **Highlight** in the toolbar: yellow, green, blue, pink or orange (or **None** to remove it). It is written `==text==` / `=={green}text==`, shows in color in the text while you edit, in Preview and in the Word export.
- **Undo and Redo** – **⌘/Ctrl + Z** takes back your last change, **⇧⌘Z / Ctrl + Y** redoes it, also with the new ↶ ↷ buttons in the toolbar. It undoes only *your* changes, character by character, so what your collaborators wrote in the meantime stays. Typing in one go counts as one step. (Edit mode; in Suggest mode reject the suggestion instead.)

## 2.29.6 – 2026-11-24

- **Tables look the same everywhere and keep every cell line** – the extra styling of tables with merged headers (rounded corners, gaps in the lines) came from a clash with another style and is gone. Cells are only merged in header rows (`| Monday|| Tuesday||`); in the body, `||` is simply an empty cell, so all the separations stay visible. Also in Word export.

## 2.29.5 – 2026-11-24

- **Fixed: answering a comment** – the reply box disappeared (with your text) whenever the document refreshed in the background. It now stays, keeps what you typed and the cursor, and **⌘/Ctrl + Enter** sends the reply.
- **No more separate Review mode** – you no longer have to leave Edit to work with comments. Comments are marked in yellow directly in the text you are editing (suggestions in green, the one you opened stronger); click one in the panel to jump to it, put the cursor inside a commented piece to see its comment. The "who wrote what" and "pasted text" views moved to **⋯ → Show who wrote what** (a **Back to editing** button is always at the bottom). Read-only members still have Read / Review / Preview.

## 2.29.4 – 2026-11-24

- **Fixed: the page jumped when you started typing** – the view slid down so you lost the place you were writing. It now stays exactly where it is, also when somebody else's changes arrive.
- **Colored cursors of your collaborators** in the text (Edit mode), each with a name tag, blinking while they type.
- **Their latest changes are colored** – text they just added is highlighted in their color, a dashed marker shows where they deleted something, and both fade away after about 12 seconds.

## 2.29.3 – 2026-11-24

- **Tables: no more missing cell lines** – when a merged cell crosses a main line (e.g. between two days), the cells after the cut are now single cells again, so every separation line shows (also in Word export).

## 2.29.2 – 2026-11-24

- **Preview is always at hand** – a floating **Preview** button sits at the bottom of the document, wherever you have scrolled (also **⌘/Ctrl + Alt + P**). In the preview it becomes **Back to editing**, and you return to the same place in the text.
- **See who is working where, live** – the bottom of the document shows your collaborators ("Anna is writing · Methods"). Click one to jump to where they are. If somebody is writing in the paragraph you are in, the chip turns orange and you get a note, so you don't edit the same lines. Cursor positions are shared only inside the group, only while the document is open, and nothing else is stored.
- **Faster updates** – changes of others reach you within a few seconds (checking every ~2.5 s while somebody is active, instead of 4.5 s; your own changes are sent sooner).
- **Tables: the main separation lines stay visible** – with merged header cells (e.g. the days), their lines now run through all the rows, even when a merged cell crosses them; the text stays in the first part. Also in Word export.

## 2.29.1 – 2026-11-24

- **Tables with merged cells and two header rows** – write a cell as `||` (no space between the bars) to merge it with the cell before it, e.g. `| Monday|| Tuesday||` gives two days spanning two columns each. A second dashed line under the first body row turns that row into a header row too (for example M / N under each day). Works in the document, the preview and Word export, and the table buttons keep the merges when you tidy.

## 2.29 – 2026-11-24

- **Documents now stay identical on all your computers and for everybody in the group.** Until now your Mac and your PC wrote into the same edit log under your name, so edits made on one could overwrite or differ from edits made on the other (some words ended up different). Every computer now has its own log, and all logs are merged in the same order everywhere. **Everyone in the group must update to 2.29** (older versions don't see the new logs). If two computers had already drifted apart, they settle on one version after updating; open History to check, and re-type anything that went missing.
- **Comments: the box empties after you post** – the text no longer stays there, so you can write the next comment straight away. A short "Comment added" message confirms it.

## 2.28.6 – 2026-11-24

- **Windows: the app window and taskbar icon was a blank page** – the icon is now a PNG in your accent colour instead of an SVG, which Windows app windows can't draw. The Desktop / Start menu shortcut also points to its icon explicitly (create it again from Settings → App icon).

## 2.28.5 – 2026-11-24

- **Pasting from Word, web pages and Excel keeps the formatting** – headings, bold/italic, links, bullet and numbered lists (also nested) and tables are converted to Markdown instead of being treated as a picture. A pasted picture is inserted only when the clipboard holds no text.
- **Editable tables** – put the cursor in any table in a document and the toolbar shows **+ Row, + Column, − Row, − Column** and **Tidy** (aligns the columns). Cells are plain text you can edit directly. Cells copied from Excel (tab-separated) also become a table.
- Works in both Edit and Suggest mode; pasted text is still marked in "Show pasted text".

## 2.28.4 – 2026-11-24

- **No more overlaps in the Library header** – it now adapts to its own width (also when the paper panel is open beside the list): the List / Map / Table switch moves to its own row sooner, and when there is very little room the buttons show only their icons (the names appear as tooltips).

## 2.28.3 – 2026-11-24

- **The Home search box looks everywhere** – while you type, it lists matching papers from your library and, below, papers found online (OpenAlex, Crossref); click one to add it (only the words you type are sent). A DOI, arXiv number or link is still added directly, and “Search by topic” is one click away.
- **A search with no match offers the web** – the empty Library page now has a “Search online and add it” button.
- **Search chips no longer overlap the buttons** – a long search or keyword sits on its own row (and is shortened with …), and the List / Map / Table switch moves to its own row sooner when the window is not wide.

## 2.28.2 – 2026-11-20

- **Delete or archive a document from the Write list** – hover a document and click ⋯. Only the person who created a document can delete it; everyone who can write can archive it.

## 2.28.1 – 2026-11-20

- Researchers profiles now use the Home style too (hero panel, cards with tinted title bands, soft tiles).
- In a document, the Edit / Suggest / Review / Preview switch, Library, New window and Export are now one aligned row of the same height, in a glass bar.
- Home cards: each title (Read, Write, Needs you, Groups, Tools) now sits on a tinted band, and the items below use small plain icons, so titles and items no longer look alike.

## 2.28 – 2026-11-20

- **One look everywhere** – the glass style of Home (tinted panels, soft cards, rounded corners) now covers the Library,
  Write, Lab and Researchers too, in light and dark and with every colour.
- **The logo follows your colour** – the PaperShelf logo and the browser-tab icon take the accent you choose in Settings.
- **Simpler Settings** – four tabs (General, PDFs & sources, My computers, Groups), shorter texts, rarely used things
  folded away (optional keys, app shortcuts, browser buttons). Updates moved into General, data sources into PDFs & sources.
- **A shorter Guide** – 11 pages instead of 22, starting with a one-page Quick start. Old help links still open the right page.

## 2.27.1 – 2026-11-20

- **The logo is the Home button** – the Home tab and the little arrow are gone from the top bar (Library, Write, Lab,
  Researchers remain). Guide, Settings, updates, *Install as an app* and *Quit PaperShelf* now sit at the bottom of Home.
- Calmer Home: a tinted welcome panel, clearer section icons, and the logo is highlighted while you are on Home.

## 2.27 – 2026-11-20

- **Home** – a new desk, and the page PaperShelf opens on (click the logo to come back): one box to search your library
  or add a paper, *Read* (continue where you stopped), *Write* (your latest documents), *Needs you* (overdue tasks,
  open comments, mentions, alerts), your groups, Discover, and every tool – citation map, review table, reading
  stats, export, what's new, storage – one click away.
- **Write** – a tab of its own with the documents of all your groups in one list: search, filter by group, start a new
  document (also just for you), and open one without going through the Lab.
- **Discover moved into the Library** – *All papers | Reading list | Discover*, so searching your papers and finding
  new ones are side by side. The top bar is now Home, Library, Write, Lab, Researchers.
- Settings → *Open PaperShelf on* now offers Home and Write too.

## 2.26 – 2026-11-20

- **Tables and pictures in shared documents** – *Table* inserts a table, *Picture* (or paste / drop an image) adds a
  picture, shrunk on your computer and stored in the document for the whole group. They show in Preview and are
  included in the Word, Markdown and PDF exports. Everyone in the group needs this version.
- **Suggested citations** – type `[@` and the papers that fit the paragraph come first; in the *Cite* tab, *Suggest*
  finds papers for the paragraph you are in, from the group and from the rest of your library (add to the group and
  cite in one click). Matched on your computer, nothing is sent.
- **Pasted text in Review** – *Show pasted text* marks what was pasted or dropped rather than typed, with the share of
  the text.
- **Storage** (Settings → Storage…) – how much room the PDFs take and how full the disk is, with a list of PDFs you
  could clear (not opened for 3 months and re-downloadable). Nothing is removed without your confirmation, and PDFs
  go to the Trash. If the disk is nearly full PaperShelf tells you, once a day.

## 2.25 – 2026-11-19

- **Suggest mode, like in Google Docs** – the document bar now has *Edit | Suggest | Review | Preview*. In *Suggest*
  you keep typing in the document itself: deleted text stays in place struck out in red, new text appears in green, and
  every change becomes a suggestion card the others can accept or reject. Everyone in the group needs this version.

## 2.24 – 2026-11-19

- **Suggestions like in Google Docs** – in a document's *Review* view, select text and choose *Comment*, *Suggest
  edit* or *Suggest deleting*, or click between words to *suggest inserting* text. Suggestions appear in the text
  (old text struck out, new text in green) and as cards you can accept or reject.
- **See who is writing** – the top bar shows who is writing right now and in which section, and in Review a flag with
  their name marks where they edited last. The document refreshes about every 4 seconds while someone else is active.
- **Library next to your document, or in its own window** – *Library* shows your library beside the text, *New window*
  opens the document in a separate window (for a second screen).
- **Delete a document** – the creator can delete it for the group (⋯ menu); the others keep a read-only copy on their
  computer until they remove it themselves. *Archive* tidies a document away. Everyone in the group needs this version.

## 2.23 – 2026-11-19

- **Shared documents** – a new *Documents* tab in each group's Lab: write a manuscript, a proposal, a review or
  the minutes together. Everybody can type at the same time and nothing is overwritten (each person's changes are
  kept and combined the same way for everyone); the others' work appears within a few seconds. Markdown editor with
  a toolbar, *Preview* and *Review* (who wrote what), **comments** with replies, **suggested changes** to accept or
  reject, **citations** of the group's papers with an automatic list of references, **named versions** and the full
  editing history with restore, and export to Word, Markdown, text or PDF. Everyone in the group needs this version.
- Safer syncing: changes made on this computer while PaperShelf was talking to GitHub are never lost.

## 2.22 – 2026-11-19

- **Small windows** – in a group's view the people of the group, “updated…”, *People & options* and
  *Invite someone* are now one row under the title that wraps, instead of a narrow column stretched
  vertically. The top bar wraps on a small window (tabs and tools on the first row, the Add box on its
  own row) instead of overlapping, and the side panels follow its real height.

## 2.21 – 2026-11-19

- **One Add button** – the top bar has a single place to add: type or paste a DOI, link or title and press
  **Add**, or open the arrow next to it for PDF files, many papers at once, manual entry, a new label,
  a new group and your groups. The second Add button below is gone.
- **The PaperShelf menu lists the four places** – Library, Discover, Researchers and Lab, each with a
  line of explanation (the one you are in is highlighted), then Groups, Export and Reading stats.
- **A Groups page** – create a group, join one or open a group file, and for each of your groups go
  straight to its **Library**, its **Ideas & chat**, its **Plans & tasks**, invite people or manage it.
  Open it from the PaperShelf menu or from the Add arrow.
- **Line icons everywhere** – the remaining coloured emoji in buttons, menus, headings, dialogs and the
  Help are drawn with the same thin line icons. What people write (notes, posts, titles) is untouched.
- The switch, the Labels button, the view tools and the search box now sit on one line, same height.
  **Esc** closes an open menu.

## 2.20 – 2026-11-19

- **A cleaner Library header** – the **All papers | Reading list** switch is now the title, on the left;
  the view tools **List · Map · Table** sit in the middle (the reading list is just the list); **＋ Add** and
  the search box on the right never move. A label, group or list name appears next to the switch only when
  you select one, with a **×** to go back.
- **One icon style** – thin line icons everywhere instead of coloured emoji: the switch, the sidebar,
  List/Map/Table, the PDF and notes buttons on each paper.
- **Plainer buttons** – flat, same corners, one accent colour for the main action.
- **A new app icon** in the same style: white line books on a green tile (Dock, taskbar, browser tab).

## 2.19 – 2026-11-19

- **One Library, two views** – the separate *Reading list* tab is gone: the **Library** has a switch
  above the list, **📖 Reading list | 📚 All papers**, with the same labels in both and the choice
  remembered. The tabs are now Library, Discover, Researchers, Lab.
- **Labels always in reach** – the labels sidebar, with its **＋ New label**, stays open on a wide window,
  also in the Reading list (before, the pin covered the ＋ there). Hide it with **Labels** or the pin.
- **Add from anywhere** – the quick *Add a paper* box is always at the top of the Library, and the green
  **＋ Add** menu sits next to the switch. The `n` key focuses the quick box.
- **A softer look** – papers are cards with a light shadow, a larger title, rounder buttons and switches,
  clearer selection and keyboard focus, in light and dark.

## 2.18 – 2026-11-19

- **Drop a PDF to add it** – drop PDF files anywhere in the window (or use ＋ Add → PDF files). PaperShelf
  reads the first pages: the DOI or arXiv ID is looked up; without one, the title (found by the type size)
  is searched in Crossref and accepted only if it matches; as a last resort title, year, abstract and
  keywords are taken from the text and the paper is marked to check. The message tells how each file
  was recognised. The PDF is stored with the paper.
- **PDFs in groups, only if you choose** – in a group's window, *PDF files*: pick a folder that the members
  already share (Dropbox, OneDrive, a network drive, a USB stick…). You decide what goes in: one paper
  (*Share the PDF with …* in the paper), all those of the group, or automatically at every update. The
  PDFs the others put there are copied to your folder for the papers you miss. Nothing goes online from
  PaperShelf, files are named by a code (not the title), nothing is overwritten, and you can take yours back.
- **Easier to find things** – a green **＋ Add** button in the header of every view: paper by DOI, link or
  title (with a drop zone for PDFs), PDF files, many at once, manual, **＋ New label**, new group or join.
  The sidebar button now says **Labels**.

## 2.17.1 – 2026-11-13

- **Lab: archive plans and tasks** – when something is finished or set aside, archive it instead of
  deleting it: it leaves the board, the counts and the Overview, and is kept with its checklists and
  notes. *Archive* next to a plan's name archives the plan with its tasks; *Archive* at the top of the
  *Done* column moves all the finished tasks at once; a single task can be archived from its window.
- Everything archived is under **Archive**, at the bottom of the list of plans: open a plan or a task
  from there, or bring it back with *Restore*. A plan's progress keeps counting its archived finished
  tasks. The archive is shared with the group and listed at the end of the report.
- All members need 2.17.1 to see the same archive; with an older version archived things still show
  on the board.

## 2.17 – 2026-11-13

- **Lab: a task opens in its own window** – on the left the work itself: title, description, the
  **checklist** and the **notes**; on the right its settings: status, people, deadline, priority, plan,
  paper. Everything is saved as you change it. In the checklist, press Enter to add an item, paste a
  list to add several at once, click an item to reword it. The first items also show on the card in
  the board, where they can be ticked directly.
- **Lab: notes on tasks and plans** – write considerations, updates and questions on a task or on a
  whole plan (*Notes* next to the plan's name). Notes are signed, can be addressed to someone with ＠,
  and notify the people of the task or the plan. They are in the report too.
- **Lab: plan faster** – type a task at the bottom of *To do* and press Enter, one after the other
  (Shift+Enter also opens it). A new plan can **start with the usual steps** of an experiment or of a
  paper, each with its checklist, all editable.
- **Lab: a cleaner look** – one set of line icons instead of emoji, a tidier Overview (your tasks with
  deadline, checklist and notes; the plans you lead; figures for each group), larger *Papers, Table,
  Report, Update* buttons with labels, a quieter list of plans and status colours on the board.
- All members need 2.17 to see the notes on tasks and plans; older versions keep working and simply
  don't show them.

## 2.16.1 – 2026-11-12

- **Fix: dark mode** – the boxes of the list grouped by label or group were light grey with white text
  (the glass look painted them as in light mode). They are dark and tinted with the label's colour
  again, and a few other light patches in dark mode are gone.

## 2.16 – 2026-11-12

- **Map: links from your notes** – a new *Notes* link type connects papers by what you wrote about them:
  notes (private and public), notes on highlights, highlighted sentences and group-table entries. The
  important words and phrases are found and weighed (TF-IDF, English and Italian common words left
  out), and papers whose notes talk about the same ideas are linked; hover a line to see the shared
  ideas. *Shared ideas as nodes* shows the recurring ideas as ◆ – click one to select its papers.
  Computed on this computer; nothing is sent anywhere.
- **Map: ✦ Mix** – one link strength from citations (citing each other or the same papers), keywords,
  labels and notes together. *⚖ Weights* sets how much each counts and the minimum strength; hovering a
  line explains why two papers are linked and how much each part contributes.
- Hovering a line in the map now explains the link (also for shared keywords).

## 2.15 – 2026-11-12

- **Notes beside the PDF** – in the PDF reader, *📝 Notes* (top bar, or the tab on the right) opens the
  paper's notes next to the page: read them, write new ones (🔒 private or 🌐 public in one of its
  groups), edit them, without closing the PDF. The reader remembers the tab you used last and asks
  before closing with an unsaved note; Esc while writing just leaves the text box.
- **Tasks ordered by deadline and priority** – in each column of the Lab board the tasks now follow
  their deadline (overdue first, no date last), then priority. *↓ As I drag them* keeps your own order.

## 2.14.2 – 2026-11-09

- **Fix: you appeared twice in a group, once as "local-…"** – a group created before GitHub was set up
  had you as a placeholder for that computer (*local-…*), and it stayed among the members after you
  started publishing. Now, at the next update, the placeholder becomes you: it leaves the members, and
  the papers and notes it added show your name (and you can edit those notes again).

## 2.14.1 – 2026-11-09

- **Plans & tasks, clearer** – plans are listed on the left (click one to see only its tasks); the chosen
  plan shows its goal, deadline, who is responsible and its progress on top, and *＋ New task* adds to
  it. A short explanation says what a plan and a task are.
- **Plans have someone responsible** – one or more people, who get a notification and see the plan in
  the Overview under *Plans you lead*.
- **Checklists in tasks** – small items to tick: add them in the task and tick them right on the card
  (☑ 2/3). Each item is saved on its own, so two people can tick different items at the same time.
  The report lists them too.

## 2.14 – 2026-11-09

- **A calmer, cleaner look** – the glass look is now neutral and translucent: frosted, almost colourless
  panels, quiet buttons and tabs (the chosen one is a raised white pill), no more green backgrounds and
  metallic gradients. The colour only marks what matters: main buttons, the selected tab or item,
  focus, badges.
- **Choose the colour** – ⚙︎ Settings → General → *Colour*: green, teal, blue, violet, rose, amber or
  graphite. It applies at once, in light and dark mode, and is remembered.

## 2.13.1 – 2026-11-09

- **Tasks for one or more people** – in a task, click the names under *Who*: everyone chosen sees it in
  *My tasks* and gets a notification (also when they are added later).
- **Posts and comments addressed to someone** – *📨 For* in a new post, *＠* under a comment. The people
  chosen get a notification; for them the post is marked *📨 For you*, appears in the Overview under
  *For you*, and the *📨 For you* filter collects everything addressed to them.
- Notifications for you (tasks and messages) pop up as a message and show a red number on the Lab tab.

## 2.13 – 2026-11-09

- **🧪 Lab – a new tab for the research of your groups**, beyond the notes on single papers:
  - **💡 Ideas & discussion** – posts that are ideas, experiments, questions, results, decisions, protocols
    or notes, with Markdown, tags and links to the group's papers. Members comment, 👍 support and 📌 pin
    them; filter by type or tag, search, sort by latest activity or most supported. Pinned posts,
    decisions, the most supported ideas and the tags are listed on the side. Posts and comments are signed
    and only their author can change them.
  - **✅ Plans & tasks** – plans (milestones with goal, deadline and progress) and a task board – To do /
    Doing / Done – with who, by when, priority and an optional paper; drag the cards between the columns.
    *＋ Task* on a post turns an idea into work. Any editor can change them, field by field, without
    overwriting the others.
  - **🏠 Overview** – your open tasks in every group (overdue in red, tick to finish them) and, per group,
    what happened this week, open tasks, latest posts and decisions.
  - **⤓ Report** – the whole lab as a Markdown file for a lab meeting, the minutes or a lab notebook.
  - The 🔔 also tells you about new posts, comments and tasks given to you.
- The Lab travels with the group like papers and notes; readers see it without writing. *Open PaperShelf
  on* can now also be the Lab.

## 2.12.1 – 2026-11-09

- **Change who can read a note or a table entry** – hover one of your notes and click *🌐 Make public* or
  *🔒 Make private*, or edit it ✎ and choose in *Who can read it* (also to move it to another group). In
  the group table: *🔒 Make private* / *🌐 Make public* on your entries, or the Public / Private buttons
  while editing one. The note keeps its date; made private, it is removed from the group for everybody
  at their next update.

## 2.12 – 2026-11-09

- **🔔 Notifications from your groups** – when another member adds a public note, an entry in the group
  table or a paper, the bell at the top shows a number and a short message pops up: *"Anna added a note
  on …"*. Click the bell for the list (with the first words of the note or entry) and click an item to
  open that note, that cell of the table or that paper. They arrive when the groups update (every 15
  minutes, or with ⟳); your own changes don't notify you. *What's new* is now the first row of the same
  panel. Notifications are kept only on this computer.

## 2.11.5 – 2026-11-07

- **Delete a PDF quickly** – hover a paper and click the small ✕ on its *📄 PDF* button; or *🗑 Delete
  PDF* in the paper's details, in the PDF reader's top bar and in the right-click menu; for several
  papers select them and click *🗑 Delete PDFs*. The file goes to the Trash (it can still be restored);
  the paper keeps its notes, highlights and labels, and the PDF can be downloaded again any time.

## 2.11.4 – 2026-11-07

- **Fix: the app installed from Chrome kept the old icon** – the browser reused the icon it had saved
  before. The icon's address now changes whenever the icon changes, so a new installation (and the
  browser tab) always gets the current one.

## 2.11.3 – 2026-11-07

- **Fix: the PaperShelf icon kept bouncing without opening** – 2.11.2 could mistake PaperShelf's own
  icon (the launcher) for the app installed by Chrome, and then each start opened the next one, in a
  loop. Now only a real browser app counts, and a safety net stops PaperShelf from reopening itself
  more than a few times in a row.

## 2.11.2 – 2026-11-07

- **Fix: the PaperShelf app wasn't recognised again** – when Chrome reinstalls an app it can give it a
  name like *PaperShelf 22.44.52*; PaperShelf only looked for *PaperShelf* and so opened a separate
  browser window every time (no dot in the Dock, a new window at each click). Now any PaperShelf app
  installed by Chrome, Edge or Brave is found, and opening PaperShelf brings back its open window.

## 2.11.1 – 2026-11-07

- **A window for each cell of the group table** – click a cell to open it: all its entries like a chat,
  and a box to write a new one. Before saving choose **🌐 Public** (the group sees it, signed with your
  name) or **🔒 Private** (only you, on this computer), then *Add entry*. Click one of your entries to
  edit or delete it, or to make a private one public; the others' entries can be read and answered with
  a new entry. Clear *Add entry / Save changes* and *Close* buttons; ✕ and Esc close it at once, and it
  asks before throwing away text you haven't saved. (This replaces the small typing box inside the
  cells, which was confusing and hard to leave.)
- **Private entries** in group tables, also for readers. A table you had already filled for a group
  (it was on your computer only) becomes your private entries.

## 2.11 – 2026-11-07

- **Shared table in groups** – in a group, *▦ Table* is now shared with its members: the same columns
  for everybody, and each cell collects **entries**, like short messages, each signed with its author's
  initials (hover for name and date). Nobody overwrites anybody else, and only the author can edit or
  delete an entry. Editors can add, rename, move or delete columns for everybody; readers see the table
  read-only. It updates with the group, and the CSV/Markdown export lists each entry with its author's
  name.

## 2.10 – 2026-11-07

- **Green glass** – the look is now metallic green with a “liquid glass” feel: translucent, softly
  blurred top bar, sidebar, details panel, menus and dialogs over a light green background; buttons,
  tabs and switches in polished metallic green with a highlight; the page title with a green sheen.
  Dark mode becomes deep green glass. The icon is green again, metallic and glossy, with metal-coloured
  books. ⚙︎ Settings → General → *Look*: *Green glass* (default) or *Flat*.

## 2.9 – 2026-11-07

- **Discover has its own tab** – next to Library and Researchers. It suggests papers for the whole
  library, or for the label you pick in the sidebar, and has the search by topic. The Library keeps
  List, Map and Table.
- **Metallic look** (replaced by *Green glass* in 2.10).
- **Export by labels** – *Papers with these labels*: pick one or more labels or groups (sub-labels
  included) and export only those papers.
- **Simpler logo menu** – *Check my library* is gone (⟳ already does it) and so is *Search by topic*
  (it's in Discover).

## 2.8 – 2026-11-07

- **Fix: option buttons in dialogs** – in *Create a group*, *Export* and other windows the round option
  buttons took all the width and pushed the text to the right; they are now small and aligned.
- **A calmer, more consistent look** – the app's green for every checkbox and radio button; one style for
  all drop-down menus; segmented buttons (status, filters) like the view switcher; option cards with a
  quiet selected state; dialogs with softer corners and a lightly blurred background; thin scrollbars;
  a hairline between papers in the list.
- **Paper details** – the star moved next to the status (*★ Starred*), so the action buttons stay on one
  line; with the details open, search and view buttons take their own row above the list.
- **Export** – two columns (papers and style on the left, format on the right): everything fits on
  screen.
- Settings no longer put the cursor in the PDF-folder box when they open; *include sub-labels* looks
  like the other list options; small wording fixes (“No label”).

## 2.7 – 2026-11-07

- **Labels and Groups** – the sidebar has two separate sections: **Labels** (your own topics, nested if
  you like) and **Groups** (what you share with other people – a lab, a journal club). Groups have a
  people icon everywhere, so they don't mix with topic labels on the papers. “Shared labels” are now
  called groups; nothing changes in how they work, and existing ones keep working.
- **Clear roles in groups** – each person is an **editor** (adds papers and writes notes; needs a free
  GitHub account) or a **reader** (sees papers and public notes; needs nothing). The person who invites
  chooses.
- **Invitations** – *＋ Invite someone*: name, optional e-mail, *Edit* (with their GitHub username) or
  *Only read*. PaperShelf prepares a short message – the code, how to join, where to download
  PaperShelf – and **✉ Write the e-mail** opens it in your own e-mail app, ready to send (PaperShelf
  sends no e-mails and keeps no addresses). Or copy it.
- **Settings, step by step** – *💻 My computers* and *👥 Groups* now show where you are (connected / not
  set up / last error) and numbered steps in the right order, with buttons that open GitHub already
  filled in: the private repository, and a token with the right permissions (one token for both).
  New guides *How to create the private repository* and *How to create the GitHub token*. The General
  tab is shorter, with the less used options folded away.
- **Simpler logo menu** – only what isn't already in the top bar: groups, search by topic, export,
  reading stats, library check, install as app, quit.
- **Fix** – *Close* didn't close the Reading stats window.

## 2.6 – 2026-11-07

- **New top bar** – on the left the **Reading list** with its **＋ Add a paper** box (shown on the
  Reading list, where new papers go); on the right the tools, **Library** and **Researchers**, with icons;
  then What's new, ⟳, help and settings.
- **Title row** – the search box moved next to the title (🔍, shortcut `/`); the List / Map / Table /
  Discover buttons are a quieter segmented control, icons only when the list is narrow.
- **List toolbar** – the paper count is discreet and the select-all box appears only on hover or while
  selecting; grouping, sorting and Details are one compact group with icons, next to Export. While papers
  are selected the toolbar shows only the actions for them.
- **Researchers** – long journal and venue names are no longer cut: they get their own line above the
  bar. Everywhere, a name cut short shows in full as soon as the mouse is on it.

## 2.5.1 – 2026-11-07

- **Simpler Reading list** – it is just the list: no Map / Table / Discover buttons (they stay in the
  Library), and its sidebar has only labels and keywords (no more Reading list / Reading now / To read /
  Starred entries – what you are reading is already on top of the list).
- **Back to the whole list** – click a selected label again, the **×** next to the title, or the
  *Reading list* / *Library* button.

## 2.5 – 2026-11-03

- **✨ What's new** – a bell at the top lists recent papers by the researchers you follow (Researchers
  tab) and on topics you choose to watch; checked with ⟳. *＋ Reading list* adds one, *✕* drops it.
- **Retraction and correction alerts** – with ⟳, each paper is checked about once a week against
  Crossref (journal notices and the Retraction Watch database) and OpenAlex. Retracted papers get a red
  badge, corrected ones an amber one; the details panel links to the notice.
- **Preprint → published version** – arXiv, bioRxiv, medRxiv… papers that came out in a journal get a
  *📰 Published* badge; *Use the published version* updates title, journal, DOI and pages and keeps
  labels, notes, highlights and the PDF.
- **Needs attention** – a sidebar view with all the papers that have a badge. Logo menu → *Check my
  library* checks everything now (can be turned off in Settings → General).
- **Resume reading** – the reader reopens a PDF on the page where you stopped; papers you are reading
  show a small progress bar in the list.
- **Reading-list reminders** – papers waiting for more than 2 months are pointed out: keep, mark as read
  or move to the Library without reading (delay in Settings → General).
- **📊 Reading stats** – papers read per month, minutes of reading per week, streak, most-read papers and
  labels. Only on your computer.
- **Label suggestions** – the details panel suggests labels whose papers are similar (computed locally).
- **Key references you don't have** – under a label's title, with a link to Discover.
- **▦ Review table** – in the Library, a label as a table: one row per paper, your own columns, export to
  CSV or Markdown; private labels' tables travel with your personal sync.
- **Updates: progress bar** while the new version is downloaded and installed.

## 2.4.5 – 2026-11-03

- **Windows: no more black windows flashing** over PaperShelf when it is started from its icon. The
  commands it runs in the background (git for sync, pip, PowerShell…) now run hidden, so the
  PaperShelf window stays in front during updates and syncs.

## 2.4.4 – 2026-11-03

- **Windows: updating restarts PaperShelf by itself again.** The new version now starts as its own
  background process that waits for the old one to close, instead of being started from inside the
  closing one (which on Windows could leave the update window waiting forever).
- Windows: replacing the app's files is patient when an antivirus scan briefly locks a file.

## 2.4.3 – 2026-11-03

- Papers you are reading are marked in the app's green – or in the colour of their label (in the
  grouped view, the colour of the group).
- Grouped view: groups with papers you are reading come first, with a *📖 n reading* badge (your own
  order, if you moved groups, still wins).

## 2.4.2 – 2026-11-03

- Grouped view: **drag a group's title** to move the group up or down (sub-labels move inside their
  label). The order is remembered; *reset order* goes back to the usual one.

## 2.4.1 – 2026-11-03

- Grouped view: **shared labels are groups too** (and part of the combinations), and every group is
  now a **card in its label's colour** – tinted header, coloured edge (all the colours of a
  combination), nested cards for sub-labels – so the groups are clearly separated.

## 2.4 – 2026-11-03

- **Papers grouped by label** (optional, Reading list and Library): the menu above the list offers
  *Group by label* – a section per label with its sub-labels nested, papers with several labels in
  each of them – or *Group by label combination* – each paper once, under the exact set of its
  labels. Groups fold with a click; inside a selected label the groups are its sub-labels. The plain
  list stays the default, and each page remembers its choice.

## 2.3.1 – 2026-10-30

- **Researcher overview reorganised**: one *At a glance* card with impact (citations, h-index, i10,
  mean citedness) and authorship (publications, first, co-first, last, co-last, this year) – no more
  repeated numbers. Every tile is clickable: *h-index → how to raise it* opens the outlook right
  there, authorship tiles open the publication list filtered on them. With Google Scholar data a
  switch chooses OpenAlex or Scholar numbers (the comparison table is gone).
- The h-index chart is no longer stretched; the authorship chart (same as the tiles) was removed.

## 2.3 – 2026-10-30

- **h-index outlook** (Researchers → Overview): how many more citations are needed to reach h+1, h+2
  and h+3, and on which papers – the ones closest to counting, with how many each needs. A chart of
  citations by rank shows where the h-index lies, and the papers closest to 10 citations for the
  i10-index. With Google Scholar data you can switch between OpenAlex and Scholar citations.

## 2.2.2 – 2026-10-26

- **Researchers**: the list of researchers hides by itself too – move the mouse to the left edge to
  see it, or click ☰ (or its 📌) to keep it open. Each page remembers its choice.
- The citations chart uses the app's green.

## 2.2.1 – 2026-10-26

- **☰ next to the page title** switches the sidebar between always open and hiding by itself (it is
  green while the sidebar stays open).
- Label sections are open by default again; the fold arrows of *Labels* and *Keywords* are bigger.

## 2.2 – 2026-10-26

- **Right-click a paper** for a quick menu: tick or untick labels from the list of all your labels
  (several in a row), shared labels, status, PDF, notes, details, star, citation, delete – also for
  several selected papers at once.
- **The sidebar hides by itself**: a cleaner list; move the mouse to the left edge (or click ☰) and it
  slides in, also while dragging papers onto a label. The 📌 pin keeps it open – separately for the
  Reading list and the Library.
- **Dragging papers** now shows a small label with the title instead of the whole row, so you can see
  the label you drop it on.
- Library menu: only *All papers*; Read, Starred, To read… are under *More*.
- Fixed: on a fast computer the page could occasionally stay empty at start (now it waits until it
  is fully loaded).

## 2.1 – 2026-10-26

- **Reading list**: a new start page with only the papers you are reading and want to read –
  *Reading now* first (highlighted), then *To read*. Open a PDF from the list and the paper moves to
  *Reading now*; hover and click **✓ Read** when you are done (it stays in the Library). Labels,
  keywords, search and Discover work on the reading list too; *search the whole library* is one click.
- **Library**: all your papers, read ones included, with the citation map, Discover and statistics.
- **Tabs at the top**: *Reading list* (with how many papers are waiting) · *Library* · *Researchers*.
  Choose where PaperShelf opens in Settings → General → *Open PaperShelf on*.

## 2.0.2 – 2026-10-25

- Researchers: the publication list opens on the papers (journal articles, preprints, conference
  papers); abstracts, theses, data and other items are one click away in the type chips (*All types*).
- Sidebar: *Labels* and *Keywords* headers aligned, with the same fold arrows.

## 2.0.1 – 2026-10-25

- **PaperShelf menu**: click the logo at the top left for the most used actions – update now, check
  for a new version, search papers by topic, add many papers, export, shared labels, install as an
  app, settings, guide, system check and quit.
- The buttons at the top right stay at the right edge however wide the window is; settings and help
  are round buttons as big as the update button.

## 2.0 – 2026-10-25

PaperShelf 2.0 brings together everything added since 1.13:

- **Notes, reworked** – a chat of notes for every paper (📝 on each row shows how many), private by
  default, **public** on papers of shared labels (synced to all members, with your name), Markdown with
  colours, notes from the PDF reader, and *Export notes* with the references.
- **Shared labels, clearer** – *📤 Invite colleagues / code* with a ready-made invitation, the people
  taking part and what each contributed, separate Settings tabs for *Sync my computers* and *Sharing*.
- **A real app** – install PaperShelf as an app (Chrome, Edge, Brave): its own icon in the Dock or
  taskbar, the window comes back when you click it, *Quit* in its menu; optional start at login.
- **New look** – green colours and icon (also next to the name at the top), label colours (24), the
  same label symbols grey or coloured, a clean paper list with a **PDF** button on every paper,
  collapsible label sections, one round **⟳** button that syncs, updates shared labels and checks for
  a new version.
- **Paper details, tidier** – title, authors and journal at the top; notes, labels and abstract first;
  the bibliographic fields under *✎ Edit details*; the panel closes when you click outside it.
- Label colours are used in the map too.

## 1.14.8 – 2026-10-25

- **PaperShelf as a real app**: Settings → General → *Install PaperShelf as an app* (Chrome, Edge,
  Brave). It gets its own icon in the Dock / taskbar with the dot while it is open; clicking it brings
  back the open window instead of opening a new one; right-click → *Quit* closes it. PaperShelf then
  always opens in this app. If it isn't running when you open the app, a *Start PaperShelf* button
  starts it.
- **Start in the background when you log in** (optional, Settings → General): the app is always ready
  and shared labels and sync stay up to date.
- The old PaperShelf icon (launcher) gets the new green look by itself.

## 1.14.7 – 2026-10-25

- **Notes from the PDF reader can be public**: when you write a note on a highlight, choose *Also add
  it to the paper's notes* → private, or public in a shared label the paper belongs to (with the
  highlighted sentence and the page). *Add to paper notes* (all highlights at once) asks the same when
  the paper is in a shared label.

## 1.14.6 – 2026-10-25

- **Cleaner paper list**: keywords are hidden by default – tick **Details** above the list to show
  them. Selection boxes are hidden too: click opens a paper, ⌘/Ctrl-click and Shift-click select, and
  the boxes appear as soon as something is selected (Settings → General → *Always show selection
  boxes* to keep them visible).
- **PDF button on every paper**: green *📄 PDF* opens the PDF right away in the reader; *⬇ PDF* looks
  for a free copy, saves and opens it – and if there is none, opens the article page so you can log in
  with your university (the downloaded PDF is attached automatically).
- The details panel closes when you click anywhere outside it.

## 1.14.5 – 2026-10-25

- **One ⟳ button updates everything**: the round button at the top syncs your library with your other
  computers (if you use sync), updates shared labels and notes, and checks GitHub for a new version of
  PaperShelf – if there is one, the update window opens. Only the arrows turn while it works.
- **Label symbols keep their shape**: every label has the same small symbol (tag for personal labels,
  link for shared ones, tray for labels you follow) – grey without colour, in its colour otherwise.
  Labels without colour are grey on the papers too.
- **24 colours** to choose from instead of 12.

## 1.14.4 – 2026-10-25

- **Label colours**: hover a label in the sidebar → 🎨 to give it one of 12 colours. The colour shows in
  the sidebar, on the label chips of every paper and in the paper's details. Personal label colours
  travel with your sync between computers; shared label colours are only yours (each member picks
  their own).
- **New green look** for the whole app, the icon included (to update the Dock/Desktop icon:
  Settings → General → *Create PaperShelf icon* again).
- Shared labels are now aligned with personal labels in the sidebar, and their buttons (🎨 📤 ⚙︎)
  appear when you hover them.

## 1.14.3 – 2026-10-25

- **People in a shared label**: above the papers of a shared label you see who takes part – each with
  the name they chose, *you*, *creator* and *invited* tags; click for details (GitHub name, since when,
  papers added, public notes written). Names are shared and updated together with papers and notes:
  if someone changes their name in Settings, everybody sees the new one at the next update. Each
  member's own copy decides about their name, so nobody can change someone else's.
- Settings window wider: all tabs fit on one line.

## 1.14.2 – 2026-10-25

- **Invite colleagues, made obvious**: a blue *📤 Invite colleagues / code* button above every shared
  label (and 📤 next to it in the sidebar) shows the code in big with *Copy code*, a ready-made
  invitation message with instructions, and the three steps for your colleague. It opens by itself
  right after you create a shared label.
- **Settings split in two**: *💻 Sync my computers* (your private library on all your computers –
  nobody else sees it) and *👥 Sharing* (shared labels and public notes with colleagues: your name,
  the token for sharing, turning sharing on), each explaining what is and isn't shared.
- Fixed: checking for updates by hand gave an error the first time (the second time worked).

## 1.14.1 – 2026-10-25

- Notes window: a **Close ✕** button (closes without saving what you were typing) and a **Discard**
  button that clears the text box.

## 1.14 – 2026-10-25

- **Notes, reworked**: every paper has its own chat of notes. A 📝 button on each row shows whether a
  paper has notes and how many (amber = private, blue = public) – click it to read and write without
  opening the paper.
- **Private and public notes**: notes are private by default (only in your library). On papers of a
  shared label you can choose *Public in “label”*: every member sees the note with your name, and it
  stays in sync like the label itself. Only the author can edit or delete a note (for everybody);
  anyone can hide someone else's note on their own computer.
- **Your display name** (Settings → General): name, initials or nickname shown next to your public
  notes and on the shared labels you create – asked the first time. Shared labels now show who
  created them.
- **Markdown with colours**: bold, italic, strike-through, ==highlights==, coloured text, headings,
  lists, to-do boxes, quotes, code and links, with a toolbar and preview.
- **Export notes**: select papers → *📝 Export notes* – one file with each reference (in your
  citation style) followed by its notes, who wrote them and when, as Markdown, text or web page.
- Your old notes are kept: each becomes the first private note of its paper. Highlights can be copied
  into a private note.

## 1.13 – 2026-10-25

- **Search inside your PDFs**: the library search box also finds words written in the PDFs (indexed on
  this computer in the background). Matches show the page and the sentence; click to open the PDF
  there. The researchers' publication list searches the PDFs of the papers you have too.
- **Search by topic**: in Discover, describe what you're looking for (words, a question or an
  abstract). *By meaning* uses OpenAlex semantic search to find papers about the same idea even if
  they use other words; *By words* is the classic search. Filters for year, type and free-to-read.
  Also reachable from the Add box (*🔎 Search by topic*).

## 1.12 – 2026-10-25

- **Journal metrics kept in PaperShelf's own folder**: SCImago tables downloaded by the browser are
  moved automatically from Downloads into `~/PaperShelf/journal-metrics` and used right away; tables
  dropped into that folder are picked up too (Settings → Data sources → *Open tables folder*).
- Clearer IF cells: no value for items that aren't journal publications (preprints, datasets,
  supplementary files, peer-review reports); “not indexed” for journals missing from SCImago (often
  new journals – click to type the IF). Papers of the current year use the latest table available.

## 1.11 – 2026-10-25

- **Researchers – sortable table**: click any column title (Year, Publication, Type, Role, IF pub.,
  IF now, Cit.) to sort by it, click again to reverse. Empty values always go last.
- **Co-first and co-last found in the papers themselves**: besides PubMed, PaperShelf reads the
  Europe PMC full text, the legal open-access PDF or the publisher's article page of papers where the
  researcher is in a middle position, looking for notes such as “† These authors contributed
  equally”. Runs in the background, results are kept. Middle positions are no longer labelled.
- **Journal metrics in one click**: when scimagojr.com refuses PaperShelf's own download, *Get the
  missing years* lists exactly the years needed (latest + publication years); the browser downloads
  them and PaperShelf imports them automatically from the Downloads folder.

## 1.10 – 2026-10-25

- **Labels**: groups are now called *labels*, in two kinds under *Labels* in the sidebar: *Personal*
  (your topics, used by the map and statistics) and *Shared* (shared with colleagues).
- **Sharing without creating anything on GitHub**: turn sharing on in Settings with your GitHub token
  (it needs the *Gists* permission – the library-sync token can simply be edited). PaperShelf keeps
  your shared labels in a secret gist it creates for you. Members announce themselves automatically.
- **Settings in tabs**: General, PDFs & access, GitHub sync & sharing, Data sources, Updates. One
  GitHub token for sync and sharing.
- **Compact library menu**: All papers, To read, Reading; Starred, Read, Without labels and Without PDF
  under *More*.
- **Keywords that scale**: the sidebar shows the most frequent ones with a filter and *Show all*, and
  can be folded. New keyword manager (✎): merge variants such as “fMRI” / “fmri”, rename or delete
  keywords in the whole library.

## 1.9 – 2026-10-25

- **Shared lists**: share lists of papers with colleagues – titles, authors, year, journal and DOI
  only, never PDFs or notes. Sidebar → *Shared lists* ＋: create a list (from a group, a selection, or
  empty), add members by their GitHub name and give them the list's code; they *Join* it. Anyone with
  the code can follow a list read-only.
- Separate from groups: shared lists have their own section and labels; the map and keywords use only
  your groups. Optionally, papers that arrive from a list can also go into one of your groups.
- Papers you receive are added to your library. If a list later drops a paper, your copy only loses
  the label. When you delete a shared paper you choose whether it leaves the list for everybody.
- Lists with several members stay in sync automatically (at start, every 15 minutes and after each
  change), also along chains of people and in any order, without losing or resurrecting papers.
- Lists can be saved as `.papershelf` files and opened by anyone, even without GitHub.

## 1.8 – 2026-10-25

- **PaperShelf icon**: Settings → App icon & window → *Create PaperShelf icon*. On a Mac it goes in
  Applications and on the Desktop (drag it to the Dock); on Windows on the Desktop and in the Start
  menu. From the icon PaperShelf starts in the background, without a Terminal window.
- **Its own window**: with Chrome, Edge or Brave installed, PaperShelf opens as a separate
  “PaperShelf” window without the 127.0.0.1 address bar. New app icon. *Quit* button in Settings.
- **Find papers by a few words**: type part of a title (or authors and year) in the Add box and pick
  the paper from the list of matches. A title without an exact match now shows the closest papers.
- **Map**: links by *Keywords* (keywords as nodes, or papers linked by shared keywords) and by
  *Groups* (your groups as nodes), besides citations.
- **Journal metrics**: no more repeated download errors. Years that can't be downloaded are retried
  only after a few days; tables downloaded by hand can be imported several at once. When a year has no
  table, the closest previous year is used and shown; otherwise the cell stays empty.

## 1.7 – 2026-10-25

- **Automatic updates**: when PaperShelf starts it checks github.com/MirkoZanon/PaperShelf and installs
  a new version before opening (with a backup of the old one), then shows what's new. Can be turned
  off in Settings → Updates; then a **⬆ Update** button lets you choose when.
  Your library, PDFs and settings are never touched.
- Install a version from a downloaded zip file (Settings → Updates), and open earlier versions from the
  backups folder.
- Open-source release: MIT licence, third-party notices, automatic GitHub releases.

## 1.6

- Researchers: datasets, code, supplementary files, peer reviews and corrections are recognised from
  DOI, link and title (figshare, Zenodo, Dryad, OSF, OpenNeuro, DANDI…).
- Simpler layout: *Overview* and *Publications* tabs.
- Co-first and co-last authorship from PubMed equal-contribution statements; roles highlighted.
- Impact-factor columns (year of publication and today); manual official IF.
- Publication-list export: optional IF, chronological numbering, highlighted roles, summary table,
  sections by type and/or year, current-year report, dated title and file name.

## 1.5

- Built-in help centre with step-by-step guides, contextual “?” buttons and a system check.
- Complete README with installation and GitHub-sync guide.

## 1.4

- Researcher profiles from ORCID, OpenAlex and Wikidata; optional import of a public Google Scholar
  page; metrics charts; journal metrics (SCImago, OpenAlex); privacy safeguards.
- University access through the publisher's own login page; Downloads watcher attaches PDFs.

## 1.3

- Citation map, Discover suggestions, PDF reader with highlights, more journal styles, GitHub sync,
  Windows support.

## 1.0

- First version: add papers by link, DOI or title; groups; legal PDF search; APA export.
