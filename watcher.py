"""
watcher.py - attach PDFs you download yourself (e.g. through your university
library) to the right paper automatically.

When you click "Get via <library>" PaperShelf opens the article through your
library's proxy in your browser, where you log in as usual (SSO, two-factor...).
When you then download the PDF, it lands in your Downloads folder: this module
notices the new file, reads the DOI inside it and attaches it to the paper.
"""
from __future__ import annotations

import difflib
import os
import re
import threading
import time
from collections import deque
from pathlib import Path

import metadata
import pdffinder

AWAIT_MINUTES = 20


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


class DownloadWatcher:
    def __init__(self, connect, get_settings, on_remove=None):
        self.connect = connect            # () -> sqlite3 connection
        self.get_settings = get_settings  # (db) -> dict
        self.on_remove = on_remove        # (path) -> None, e.g. move to Trash
        self.awaiting: dict[int, float] = {}
        self.seen: dict[str, tuple] = {}
        self.sizes: dict[str, int] = {}
        self.events: deque = deque(maxlen=100)
        self.next_event = 1
        self.started = time.time()
        self.lock = threading.Lock()
        self.thread = None
        self.last_error = ""

    # ----------------------------------------------------------------- API
    def expect(self, paper_id: int):
        with self.lock:
            self.awaiting[int(paper_id)] = time.time()

    def events_after(self, after: int):
        with self.lock:
            return [e for e in self.events if e["id"] > after]

    def _event(self, **e):
        with self.lock:
            e["id"] = self.next_event
            e["time"] = time.time()
            self.next_event += 1
            self.events.append(e)

    def active(self, settings) -> bool:
        cutoff = time.time() - AWAIT_MINUTES * 60
        with self.lock:
            self.awaiting = {k: v for k, v in self.awaiting.items() if v >= cutoff}
            waiting = bool(self.awaiting)
        return waiting or settings.get("auto_import") == "1"

    def folder(self, settings) -> Path:
        return Path(settings.get("watch_dir") or Path.home() / "Downloads").expanduser()

    def start(self):
        if self.thread:
            return
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    # ----------------------------------------------------------------- scanning
    def stop(self):
        self.stopped = True

    def _loop(self):
        while not getattr(self, "stopped", False):
            try:
                self.scan_once()
            except Exception as exc:  # noqa: BLE001 - never stop watching
                self.last_error = str(exc)
            time.sleep(2)

    def scan_once(self):
        db = self.connect()
        try:
            settings = self.get_settings(db)
            if not self.active(settings):
                return
            folder = self.folder(settings)
            with self.lock:
                since = min(self.awaiting.values()) - 30 if self.awaiting else time.time()
            if settings.get("auto_import") == "1":
                since = min(since, self.started)
            try:
                files = [f for f in folder.iterdir() if f.suffix.lower() == ".pdf" and f.is_file()]
            except OSError as exc:  # e.g. macOS hasn't allowed access to Downloads yet
                self.last_error = f"Can't read {folder}: {exc}"
                return
            self.last_error = ""
            for f in files:
                try:
                    st = f.stat()
                except OSError:
                    continue
                key = str(f)
                sig = (st.st_mtime, st.st_size)
                if self.seen.get(key) == sig:
                    continue
                if max(st.st_mtime, getattr(st, "st_birthtime", 0)) < since:
                    self.seen[key] = sig  # was already there before we started watching
                    continue
                if self.sizes.get(key) != st.st_size:  # still downloading: wait for a stable size
                    self.sizes[key] = st.st_size
                    continue
                self.seen[key] = sig
                self._process(db, f, settings)
        finally:
            db.close()

    def _process(self, db, f: Path, settings):
        try:
            data = f.read_bytes()
        except OSError:
            return
        if b"%PDF-" not in data[:1024]:
            return
        ident = metadata.identifier_from_pdf(data)
        paper = None
        if ident:
            if ident.lower().startswith("arxiv:"):
                paper = db.execute("SELECT * FROM papers WHERE arxiv_id=?", (ident.split(":", 1)[1],)).fetchone()
            elif ident.startswith("10."):
                paper = db.execute("SELECT * FROM papers WHERE lower(doi)=?", (ident.lower(),)).fetchone()
            else:  # a title found in the PDF's properties
                best, score = None, 0.0
                for row in db.execute("SELECT * FROM papers WHERE pdf_path = '' OR pdf_path IS NULL"):
                    s = difflib.SequenceMatcher(None, _norm(row["title"]), _norm(ident)).ratio()
                    if s > score:
                        best, score = row, s
                paper = best if score >= 0.9 else None
        if paper is not None:
            if paper["pdf_path"] and os.path.isfile(paper["pdf_path"]):
                return
            self.attach(db, paper["id"], f, data, settings)
            return
        with self.lock:
            waiting = list(self.awaiting)
        if waiting:
            rows = [db.execute("SELECT id, title FROM papers WHERE id=?", (pid,)).fetchone() for pid in waiting]
            self._event(type="unmatched", file=f.name, path=str(f),
                        candidates=[{"id": r["id"], "title": r["title"]} for r in rows if r])

    def attach(self, db, paper_id: int, f: Path, data: bytes | None = None, settings=None):
        settings = settings or self.get_settings(db)
        row = db.execute("SELECT * FROM papers WHERE id=?", (paper_id,)).fetchone()
        if row is None:
            raise ValueError("Paper not found")
        data = data if data is not None else f.read_bytes()
        paper = dict(row)
        import json
        paper["authors"] = json.loads(paper.get("authors") or "[]")
        path = pdffinder.save_pdf(data, paper, settings["pdf_dir"])
        db.execute("UPDATE papers SET pdf_path=?, updated_at=? WHERE id=?",
                   (str(path), metadata_now(), paper_id))
        db.commit()
        with self.lock:
            self.awaiting.pop(paper_id, None)
        if settings.get("remove_downloads") == "1" and self.on_remove:
            try:
                self.on_remove(str(f))
            except OSError:
                pass
        self._event(type="attached", paper_id=paper_id, title=paper["title"], file=f.name)


def metadata_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
