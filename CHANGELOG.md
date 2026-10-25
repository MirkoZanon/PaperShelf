# Changelog

Each section's text is used as the release notes shown in the app's Update window.

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
