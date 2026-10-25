# PaperShelf

A personal, private library for scientific papers. Paste a DOI, a link or a title and PaperShelf
fills in the details, finds legal free PDFs (or helps you get them through your university), lets you
read and highlight them, organise them in groups, see how they cite each other, discover related
papers, build researcher profiles, and export reference lists in the main journal styles or to Zotero.

It runs **on your own computer** (Mac or Windows). The browser is only its window: your library is
not online, works offline, and has no size limit.

**⬇ Download:** [latest version](../../releases/latest) → under *Assets* click
**`PaperShelf-app-<version>.zip`**. Free and open source ([MIT licence](LICENSE)).

> **Help is built in.** Click **?** at the top of the app (or next to any setting) for step-by-step
> guides, including GitHub sync, university access and troubleshooting, plus a *System check*.

---

## Contents

1. [Install](#1-install)
2. [Start, stop, first steps](#2-start-stop-first-steps)
3. [Where your data is](#3-where-your-data-is)
4. [Features](#4-features)
5. [Optional settings](#5-optional-settings)
6. [Sync between computers (GitHub)](#6-sync-between-computers-github)
7. [Updating the app](#7-updating-the-app)
8. [Privacy & legal](#8-privacy--legal)
9. [Troubleshooting](#9-troubleshooting)
10. [For developers](#10-for-developers)
11. [Publishing new versions (maintainers)](#11-publishing-new-versions-maintainers)
12. [Licence](#12-licence)

---

## 1. Install

You need **Python 3.10 or newer**. Everything else is installed automatically the first time.

### Mac

1. **Python** – open the Terminal app and type `python3 --version`. If you see `Python 3.10` or
   higher you're done; otherwise install it from <https://www.python.org/downloads/>.
2. **Download** `PaperShelf-app-<version>.zip` from the [Releases page](../../releases/latest) and
   **unzip** it somewhere permanent, e.g. your **Documents** folder, so you get
   `Documents/PaperShelf-app`.
3. **Double-click `start.command`.** The first time macOS may say it "can't be opened because it is
   from an unidentified developer": right-click the file → **Open** → **Open** (only needed once).
4. The first start takes about a minute (it installs what it needs). Then your browser opens on
   **http://127.0.0.1:5055**.

### Windows

1. **Python** – install it from <https://www.python.org/downloads/>. During installation tick
   **"Add python.exe to PATH"**.
2. **Download** `PaperShelf-app-<version>.zip` from the [Releases page](../../releases/latest) and
   **unzip** it somewhere permanent, e.g. `Documents\PaperShelf-app`.
3. **Double-click `start.bat`.** If Windows SmartScreen warns you, click *More info* → *Run anyway*.
4. The first start takes about a minute; then your browser opens on **http://127.0.0.1:5055**.

> ⚠️ Don't put the app folder inside your library folder `~/PaperShelf` (see section 3).

**With git (optional):** `git clone https://github.com/MirkoZanon/PaperShelf.git PaperShelf-app` – note
the folder name `PaperShelf-app`, so it doesn't collide with the library folder `~/PaperShelf`. A git
copy updates itself with `git pull` at every start.

---

## 2. Start, stop, first steps

- **Start**: double-click `start.command` (Mac) / `start.bat` (Windows). A small Terminal / command
  window opens – keep it open while you use PaperShelf.
- **Stop**: close that window.
- **Start automatically** (optional): add `start.command` to *System Settings → General → Login
  Items* (Mac), or put a shortcut to `start.bat` in the Startup folder (Windows: `Win+R` →
  `shell:startup`).
- If the browser doesn't open by itself, go to **http://127.0.0.1:5055**.

**First five minutes**

1. Paste a DOI, a link to an article or a title in the box at the top → `Enter`.
2. Create a group with **＋** next to *Groups* and drag papers onto it (groups work like tags).
3. Open a paper → **⬇ Find & download PDF**, or **🔐 Open article & log in with my university**.
4. **📖 Read & highlight** the PDF.
5. **⤓ Export references** in your journal's style, or as RIS for Zotero.

Everything is saved immediately: closing the window, the browser or the computer loses nothing.

---

## 3. Where your data is

| | Location | Contents |
|---|---|---|
| **The app** | the folder you unzipped, e.g. `Documents/PaperShelf-app` | program files only |
| **Your library** | `~/PaperShelf` (Mac: `/Users/you/PaperShelf`, Windows: `C:\Users\you\PaperShelf`) | `library.db` (papers, groups, notes, highlights, profiles, settings), `PDFs/` |

- Replacing or updating the app never touches your library.
- **Back up** the library folder (Time Machine on Mac, File History on Windows). GitHub sync is also
  a copy of it.
- The PDF folder can be changed in ⚙︎ Settings.
- Advanced: start with `PAPERSHELF_HOME=/other/folder` to keep the library elsewhere.

---

## 4. Features

**Adding papers** – DOIs, doi.org links, journal pages, arXiv, bioRxiv, PubMed, PDF links, titles or
whole copied references; many at once (one per line); PDF files dragged onto the window (the DOI inside
is used); browser buttons that save the page you are reading. Duplicates are recognised.

**Organising** – groups and subgroups that work like tags (a paper can be in many; dragging adds,
never moves); automatic keywords with a clickable keyword cloud; reading status, stars, notes; search
in titles, authors, journals, keywords, abstracts and notes.

**PDFs** – legal free copies from arXiv, Unpaywall, OpenAlex, Semantic Scholar, CORE (university
repositories), Europe PMC / PubMed Central and publisher pages. For subscription papers:
**🔐 Open article & log in with my university** – you log in on your university's page, download the
PDF, and PaperShelf attaches it automatically from your Downloads folder. Optional library proxy
(EZproxy / OpenAthens) button.

**Reader** – read PDFs inside the app, highlight in five colours, add notes, copy highlights to your
notes, or save them into the PDF file (visible in Preview, Acrobat, Zotero).

**Citation map** – the papers of a group as a network of who cites whom, with the important papers you
don't have yet. **Discover** – suggestions: works often cited by your papers, recent papers citing
yours, related works.

**Researchers** – profile of any scientist in two views. *Overview*: summary (publications, first /
co-first / last / co-last authorship, current year), metrics and charts (OpenAlex), positions,
education, funding, awards (ORCID). *Publications*: one table, de-duplicated across sources and
classified (journal article, preprint, conference paper, abstract/poster, book, thesis, data/software,
other – datasets, supplementary files, peer reviews and corrections are recognised), with the
researcher's role (co-first/co-last from PubMed equal-contribution statements), journal impact factor
at publication and today, citations, year headings and filters. Export as a dated publication list /
CV (web page, Word, text, spreadsheet, RIS, BibTeX) with optional impact factor, chronological
numbering, highlighted authorship, summary table, sections by type and/or year, or only the current
year. Optional import of the public Google Scholar profile page you are viewing.

**Journal metrics** – SCImago quartile, SJR and citations-per-document (impact-factor formula, Scopus
data) at publication time and today, OpenAlex 2-year mean citedness, and your own entries of the
official impact factor.

**Citation styles** – APA 7, Nature, Science, Cell Press (Cell, Neuron, Current Biology, Cell Reports,
iScience), Royal Society (Proc B), J Neurosci, eLife, PNAS, PLOS / Vancouver.

**Export** – reference lists (.txt, Word/Pages .rtf), RIS (Zotero/EndNote/Mendeley, with PDFs linked
and groups as tags), BibTeX, CSL-JSON, CSV. In Zotero: *File → Import…*.

---

## 5. Optional settings

All in ⚙︎ Settings, stored only on this computer. PaperShelf works without them.

| Setting | What for | Where to get it |
|---|---|---|
| E-mail for Unpaywall | more free PDFs (Unpaywall requires an e-mail; sent only to Unpaywall) | any address |
| OpenAlex key | 10× more daily lookups for map, suggestions, profiles | free account on openalex.org → settings/api |
| CORE key | free copies from university repositories | core.ac.uk/services/api |
| Library access address | 🏛 button opening articles through your library | your library website ("off-campus access", "EZproxy") |
| GitHub repository + token | sync between computers | section 6 |

---

## 6. Sync between computers (GitHub)

Keeps the same library on several computers (Mac and/or Windows) through a **private** repository on
your GitHub account. Synced: papers, details, groups, notes, highlights, status – and PDFs if you
choose. Never synced: settings, keys, researcher profiles. (The same guide, with a live connection
test, is in the app: **? → Sync between computers**.)

### Once, on GitHub (5 minutes)

1. Create a free account on <https://github.com> if needed.
2. Go to <https://github.com/new>. Name: `papershelf-library`. Choose **Private**. Leave *Add a README*
   **unticked**. **Create repository**, then copy its address
   (e.g. `https://github.com/your-name/papershelf-library`).
3. Create an access token (works only for this repository):
   <https://github.com/settings/personal-access-tokens/new>
   (or GitHub → your photo → Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token).
   - Name `PaperShelf`; expiration up to 1 year (note it in your calendar).
   - Repository access: **Only select repositories** → `papershelf-library`.
   - Permissions → Repository permissions → **Contents: Read and write**.
   - **Generate token** and copy it (starts with `github_pat_`; shown only once – if lost, make a new one).

### On each computer

4. Install Git (once):
   - Mac: Terminal → `xcode-select --install` → accept (if "already installed", you're done).
   - Windows: <https://git-scm.com/download/win>, default options; then restart PaperShelf.
5. ⚙︎ Settings → **Sync with GitHub**: paste address and token → **Test connection** → **Save**.
   The first sync starts by itself.
6. On the other computer: install PaperShelf, repeat steps 4–5 with the same address.

### Every day

- Press **⟳** (top right), or tick *Sync automatically* (at start and every 20 minutes).
- Habit: sync before closing on one computer and after opening on the other.
- If the same paper changed on both computers between syncs, the latest change wins; deletions are
  applied everywhere.

### PDFs

- **Off** (default): only the library travels (a few MB). Use **⬇ Find PDFs** on the other computer.
- **On**: PDFs travel too. GitHub works best under ~1 GB (≈400–500 papers with PDFs) and refuses
  files over 100 MB. Keep the repository **private** – subscription PDFs are for personal use.

### Problems

| Message | What to do |
|---|---|
| Git is not installed | Step 4, then ⟳ again. |
| GitHub refused access | Token wrong/expired or without *Contents: Read and write* on this repository → new token. |
| Repository not found | Copy the address again; check the token includes this repository. |
| No internet connection | Nothing is lost; sync later. |
| ⟳ is red | Hover it to read the last error; run ? → *System check*. |

---

## 7. Updating the app

**Automatic (default).** Every time PaperShelf starts it checks the
[project page](https://github.com/MirkoZanon/PaperShelf) for a newer release. If there is one, it is
installed before the app opens (a few seconds) and a message shows what's new. You can turn this off
in ⚙︎ Settings → *Updates*.

**With the button.** If automatic installation is off, or a version comes out while PaperShelf is
open, a **⬆ Update** button appears at the top right (or ⚙︎ Settings → *Updates* → *Check for updates…*). Read what's new → **Install
update and restart**. PaperShelf downloads the new version from this GitHub repository, keeps a backup
of the current app in `~/PaperShelf/backups`, replaces only the app files, installs new libraries if
needed and restarts; the page reloads by itself. Your library is never touched.

- The check is an anonymous request to GitHub at start-up and twice a day (nothing about you or your
  library is sent). Check and automatic installation can be turned off in the Updates window.
- **No internet / GitHub blocked:** download the zip from the Releases page and use *Install from a zip
  file…* in the Updates window.
- **Going back:** close PaperShelf, unzip the backup from `~/PaperShelf/backups` and start that copy.
- **By hand:** close PaperShelf → replace the app folder (the one with `app.py`, **not**
  `~/PaperShelf`) with the new one → start it.
- **Git copies** update with `git pull` (automatically at every start, and from the Update button).

---

## 8. Privacy & legal

- PaperShelf answers only to this computer; requests from other websites or computers are refused.
- Library, notes, highlights, profiles and settings are stored only in your library folder (and your
  own private GitHub repository if you turn on sync).
- Online services receive only what a lookup needs (a DOI, a title, a name or ORCID iD you search).
  Your e-mail is never sent anywhere except to Unpaywall, if you enter it. E-mail search of
  researchers is disabled.
- University logins happen on your university's / the publisher's page; PaperShelf never sees or
  stores credentials.
- Only official interfaces (Crossref, OpenAlex, ORCID, arXiv, PubMed, Wikidata, Semantic Scholar, CORE,
  Unpaywall, Europe PMC, SCImago tables) and legal open-access sources are used. Google Scholar is never
  queried automatically – only the public page you choose to import. No "shadow libraries".
- Subscription PDFs are for personal use: keep a synced repository private and don't share them.
- Researcher profiles hold public professional data, kept locally; ask before publishing someone
  else's publication page.

---

## 9. Troubleshooting

Run **? → System check** in the app first: it shows what works and how to fix what doesn't.

| Problem | Solution |
|---|---|
| Mac: `start.command` "can't be opened" | Right-click → Open → Open (once). |
| "Python 3 is not installed" | Install from python.org (Windows: tick "Add python.exe to PATH"). |
| Page says PaperShelf is not running | The Terminal window was closed: start it again, reload the page. |
| Port already in use | PaperShelf is already running – the launcher just opens it. Or `python app.py --port 5060`. |
| No free PDF | Use 🔐 *Open article & log in with my university*, or 📎 *Attach PDF*. |
| Downloaded PDF not attached | Mac: allow Terminal to access *Downloads* (System Settings → Privacy & Security → Files and Folders). Check the Downloads folder in Settings. PDFs without a DOI inside are attached after you confirm the paper. |
| Wrong title / authors | Edit the fields, or ↻ *Update metadata* with the DOI. |
| "OpenAlex's free daily allowance is used up" | Add a free OpenAlex key, or try tomorrow. |
| Sync errors | Section 6, *Problems*. |
| Uninstall | Delete the app folder; delete `~/PaperShelf` only if you no longer want your library. |

---

## 10. For developers

```
pip install -r requirements.txt
python app.py [--port 5055] [--no-browser]
```

```
app.py            web server (Flask), database (SQLite), API
metadata.py       links/DOIs/titles → paper details (Crossref, OpenAlex, arXiv, PubMed, page meta tags)
pdffinder.py      legal open-access PDF search and download
citations.py      citation styles and exports (txt, rtf, html, BibTeX, RIS, CSL-JSON, CSV)
sync.py           GitHub sync (plain-text library in a git repository, last-edit-wins merge)
people.py         researcher profiles (ORCID, OpenAlex, Wikidata, PubMed roles, Google Scholar import)
report.py         publication-list documents (HTML, RTF, TXT, CSV) with IF, roles, summary
journals.py       journal metrics (SCImago tables, OpenAlex, manual impact factor)
watcher.py        attaches PDFs downloaded in the browser to the right paper
updater.py        in-app updates (GitHub releases → download, backup, replace, restart)
VERSION           the app version (single source of truth)
update.json       the GitHub repository the updater checks ("owner/name")
static/           interface: app.js, graph.js, discover.js, reader.js, people.js, help.js, update.js, style.css
static/vendor/pdfjs   PDF.js 4.10 (Apache-2.0), bundled for offline reading
start.command / start.bat   launchers (create .venv, install requirements, update via git if cloned)
.github/workflows/release.yml   creates a GitHub release when VERSION changes
CHANGELOG.md      what changed in each version (used as release notes)
```

The server listens only on 127.0.0.1 and rejects requests whose Host or Origin isn't local.

---

## 11. Publishing new versions (maintainers)

Users get a new version through the in-app **⬆ Update** button as soon as a *release* exists on GitHub.
Releases are created automatically by the included workflow (`.github/workflows/release.yml`).

**Where copies look for updates:** `update.json` → `{"repo": "MirkoZanon/PaperShelf"}`. If you fork
the project and publish your own versions, put your own `owner/name` there.

**For every new version**

1. Make and test your changes (`python app.py`).
2. Raise the number in `VERSION` (e.g. `1.7` → `1.8`; `1.8.1` for a small fix).
3. Add a section at the top of `CHANGELOG.md` starting with `## 1.8` – it becomes the release notes
   shown in the Update window.
4. Commit and push to `main` (VS Code: *Source Control* → message → *Commit* → *Sync Changes*).

The workflow then builds `PaperShelf-app-1.8.zip` and publishes the release *v1.8* (see the
*Actions* tab). Within hours every installed copy shows **⬆ Update**. Pushes that don't change
`VERSION` don't create a release, so you can push work in progress safely. Copies with automatic
installation (the default) install the new version the next time they start; the others see **⬆ Update**.

Rules that keep updates safe: never store user data in the app folder (it lives in `~/PaperShelf`);
database changes must be additive migrations in `init_db()` (old libraries must keep working); keep
`requirements.txt` small (new entries are installed automatically).

---

## 12. Licence

PaperShelf is released under the [MIT licence](LICENSE): anyone may use, copy, modify and share it,
keeping the copyright notice. It comes without warranty. Bundled third-party software and the online
data services it uses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Journal metrics
shown by PaperShelf are estimates from public sources (SCImago / Scopus, OpenAlex) unless you enter the
official value; PaperShelf is not affiliated with any publisher or data provider.
