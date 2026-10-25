#!/usr/bin/env python3
"""
PaperShelf - a small, local reference manager for scientific papers.

Run it with:   python3 app.py      (or double-click start.command / start.bat)
It opens in your browser at http://127.0.0.1:5055 . The app runs on your own
computer: the database and the PDFs are stored in ~/PaperShelf by default.
"""
from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from flask import Flask, Response, g, jsonify, redirect, request, send_file

import citations
import coauth
import fulltext
import journals
import metadata
import pdffinder
import people
import report
import sharing
import notes as notesmod
import sync as syncmod
import launcher
import updater
import watcher as watchermod

# Some systems (notably Windows) map .js/.mjs to the wrong type, which stops the page from loading
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css")):
    mimetypes.add_type(_type, _ext)

APP_VERSION = updater.read_version()
BASE_DIR = Path(__file__).resolve().parent
HOME = Path(os.environ.get("PAPERSHELF_HOME", Path.home() / "PaperShelf")).expanduser()
DB_PATH = HOME / "library.db"
DEFAULT_PDF_DIR = HOME / "PDFs"
PORT = int(os.environ.get("PAPERSHELF_PORT", "5055"))
LOG_PATH = HOME / "papershelf.log"

if sys.stdout is None or sys.stderr is None:  # started without a console (Windows icon, pythonw)
    try:
        HOME.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
    except OSError:
        sys.stdout = sys.stderr = open(os.devnull, "w")

TEXT_FIELDS = ["title", "journal", "journal_abbr", "volume", "issue", "pages", "publisher", "type", "doi",
               "arxiv_id", "url", "abstract", "pdf_url", "notes", "status"]
JSON_FIELDS = ["authors", "keywords"]
STATUSES = {"to_read", "reading", "read"}
META_FIELDS = ["title", "authors", "year", "journal", "journal_abbr", "volume", "issue", "pages", "publisher",
               "type", "doi", "arxiv_id", "url", "abstract", "pdf_url"]
CITATION_FIELDS = ["openalex_id", "refs", "related", "cited_by_count"]
SECRET_SETTINGS = {"sync_token", "openalex_key", "core_key", "share_token"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
PROXY_TEST_DOI = "10.1126/science.1127647"  # a subscription-only Science article, to test library access

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT, title TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL DEFAULT '[]', year INTEGER,
    journal TEXT NOT NULL DEFAULT '', journal_abbr TEXT NOT NULL DEFAULT '', volume TEXT NOT NULL DEFAULT '',
    issue TEXT NOT NULL DEFAULT '', pages TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'article', doi TEXT NOT NULL DEFAULT '', arxiv_id TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '', abstract TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '[]',
    pdf_path TEXT NOT NULL DEFAULT '', pdf_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'to_read',
    starred INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
    openalex_id TEXT NOT NULL DEFAULT '', refs TEXT NOT NULL DEFAULT '[]', related TEXT NOT NULL DEFAULT '[]',
    cited_by_count INTEGER, citations_at TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL,
    parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS paper_collections (
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (paper_id, collection_id)
);
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, rects TEXT NOT NULL DEFAULT '[]', text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'yellow',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deletions (uid TEXT PRIMARY KEY, kind TEXT NOT NULL, deleted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oa_cache (id TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY, state TEXT NOT NULL, origin TEXT NOT NULL DEFAULT '', group_id INTEGER,
    last_pull TEXT NOT NULL DEFAULT '', last_push TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '',
    published_hash TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS paper_shares (
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL, PRIMARY KEY (paper_id, share_id)
);
CREATE TABLE IF NOT EXISTS note_hidden (share_id TEXT NOT NULL, note_id TEXT NOT NULL, PRIMARY KEY (share_id, note_id));
CREATE TABLE IF NOT EXISTS share_dismissed (share_id TEXT NOT NULL, item_key TEXT NOT NULL, lamport INTEGER NOT NULL,
    PRIMARY KEY (share_id, item_key));
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT, orcid TEXT, openalex_id TEXT, name TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}', overrides TEXT NOT NULL DEFAULT '{}', excluded TEXT NOT NULL DEFAULT '[]',
    is_me INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL DEFAULT ''
);
"""
# Columns added after the first release (added to old databases automatically)
NEW_PAPER_COLUMNS = {
    "uid": "TEXT", "journal_abbr": "TEXT NOT NULL DEFAULT ''", "openalex_id": "TEXT NOT NULL DEFAULT ''",
    "refs": "TEXT NOT NULL DEFAULT '[]'", "related": "TEXT NOT NULL DEFAULT '[]'", "cited_by_count": "INTEGER",
    "citations_at": "TEXT NOT NULL DEFAULT ''", "note_list": "TEXT NOT NULL DEFAULT '[]'",
}
NEW_GROUP_COLUMNS = {"uid": "TEXT", "updated_at": "TEXT NOT NULL DEFAULT ''", "color": "TEXT NOT NULL DEFAULT ''"}
LABEL_COLORS = {"", "red", "coral", "orange", "amber", "yellow", "olive", "lime", "green", "mint", "teal", "cyan", "sky", "blue",
                "navy", "indigo", "violet", "purple", "magenta", "pink", "rose", "brown", "sand", "grey", "slate"}
NEW_PEOPLE_COLUMNS = {"scholar": "TEXT NOT NULL DEFAULT ''", "roles_extra": "TEXT NOT NULL DEFAULT '{}'"}

app = Flask(__name__, static_folder=str(BASE_DIR / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
app.json.sort_keys = False
sync_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #
def connect():
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    HOME.mkdir(parents=True, exist_ok=True)
    db = connect()
    db.executescript(SCHEMA)
    journals.init(db)
    fulltext.init(db)
    for table, cols in (("papers", NEW_PAPER_COLUMNS), ("collections", NEW_GROUP_COLUMNS), ("people", NEW_PEOPLE_COLUMNS)):
        have = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
        for name, ddl in cols.items():
            if name not in have:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        if table == "people":
            continue
        for (rid,) in db.execute(f"SELECT id FROM {table} WHERE uid IS NULL OR uid = ''").fetchall():
            db.execute(f"UPDATE {table} SET uid=? WHERE id=?", (uuid.uuid4().hex, rid))
    if "color" not in {r[1] for r in db.execute("PRAGMA table_info(shares)")}:
        db.execute("ALTER TABLE shares ADD COLUMN color TEXT NOT NULL DEFAULT ''")  # your own colour for a shared label
    # notes became a list of separate notes (version 1.14): the old single text becomes the first note
    for r in db.execute("SELECT id, notes, added_at, updated_at FROM papers WHERE notes != '' AND (note_list = '[]' OR note_list = '')").fetchall():
        db.execute("UPDATE papers SET note_list=? WHERE id=?", (json.dumps([{"id": uuid.uuid4().hex[:16], "body": r["notes"],
                   "created": r["added_at"], "at": r["updated_at"]}], ensure_ascii=False), r["id"]))
    db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_uid ON papers(uid);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_uid ON collections(uid);
        CREATE INDEX IF NOT EXISTS idx_ann_paper ON annotations(paper_id);
    """)
    db.commit()
    db.close()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect()
    return g.db


@app.before_request
def _local_only():
    """Privacy/safety: only this computer may use PaperShelf, and other websites can't make it act."""
    host = (request.host or "").rsplit(":", 1)[0] if not (request.host or "").startswith("[") else "[::1]"
    if host not in LOCAL_HOSTS:
        return "PaperShelf only answers on this computer.", 403
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("Origin")
        if origin and origin != "null":
            from urllib.parse import urlparse as _up
            if (_up(origin).hostname or "") not in {"127.0.0.1", "localhost", "::1"}:
                return jsonify(error="Requests from other websites are not allowed."), 403


@app.before_request
def _openalex_key():
    if request.path.startswith("/api/") or request.path == "/quickadd":
        metadata.OPENALEX_KEY = get_settings().get("openalex_key", "")


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_uid() -> str:
    return uuid.uuid4().hex


def get_settings(db=None, secrets=True) -> dict:
    db = db or get_db()
    s = {"email": "", "pdf_dir": str(DEFAULT_PDF_DIR), "default_style": "apa", "sync_repo": "", "sync_token": "",
         "sync_pdfs": "", "sync_auto": "", "last_sync": "", "last_sync_error": "", "proxies": "[]",
         "auto_import": "", "remove_downloads": "", "watch_dir": str(Path.home() / "Downloads"), "openalex_key": "",
         "core_key": "", "sjr_auto": "", "update_check": "1", "update_cache": "",
         "update_auto": "1", "just_updated": "", "own_window": "1",
         "share_repo": "", "share_token": "", "share_auto": "1", "install_id": "", "share_user": "", "share_gist": "",
         "display_name": ""}
    for row in db.execute("SELECT key, value FROM settings"):
        if row["value"] != "" or row["key"] in ("email", "sync_repo", "sync_token", "sync_pdfs", "sync_auto",
                                                "auto_import", "remove_downloads", "openalex_key", "core_key", "sjr_auto",
                                                "update_check", "update_cache", "update_auto", "just_updated", "own_window",
                                                "share_repo", "share_token", "share_auto", "share_user", "share_gist", "display_name"):
            s[row["key"]] = row["value"]
    try:
        s["proxies"] = json.loads(s["proxies"] or "[]")
    except ValueError:
        s["proxies"] = []
    if not secrets:
        for key in SECRET_SETTINGS:
            s["has_" + key] = bool(s.pop(key))
    return s


def set_setting(db, key, value):
    db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, str(value)))


def _int(v):
    try:
        return int(v) if v not in (None, "", "null") else None
    except (TypeError, ValueError):
        return None


def group_map(db, paper_id=None) -> dict:
    sql = "SELECT paper_id, collection_id FROM paper_collections"
    rows = db.execute(sql + " WHERE paper_id=?", (paper_id,)) if paper_id else db.execute(sql)
    out: dict[int, list[int]] = {}
    for r in rows:
        out.setdefault(r["paper_id"], []).append(r["collection_id"])
    return out


def annotation_counts(db) -> dict:
    return {r[0]: r[1] for r in db.execute("SELECT paper_id, COUNT(*) FROM annotations GROUP BY paper_id")}


def share_map(db, paper_id=None) -> dict:
    sql = "SELECT paper_id, share_id FROM paper_shares"
    rows = db.execute(sql + " WHERE paper_id=?", (paper_id,)) if paper_id else db.execute(sql)
    out: dict[int, list[str]] = {}
    for r in rows:
        out.setdefault(r["paper_id"], []).append(r["share_id"])
    return out


def row_to_paper(row, gmap, acounts=None, smap=None) -> dict:
    p = dict(row)
    for f in JSON_FIELDS + ["refs", "related", "note_list"]:
        try:
            p[f] = json.loads(p.get(f) or "[]")
        except ValueError:
            p[f] = []
    p["starred"] = bool(p["starred"])
    p["group_ids"] = gmap.get(p["id"], [])
    p["share_ids"] = (smap or {}).get(p["id"], [])
    p["pdf_exists"] = bool(p["pdf_path"]) and os.path.isfile(p["pdf_path"])
    if acounts is not None:
        p["annotation_count"] = acounts.get(p["id"], 0)
    return p


def load_paper(db, pid):
    row = db.execute("SELECT * FROM papers WHERE id=?", (pid,)).fetchone()
    if not row:
        return None
    p = row_to_paper(row, group_map(db, pid), annotation_counts(db), share_map(db, pid))
    _add_note_counts([p], public_note_counts(db) if p["share_ids"] else {})
    return p


def _add_note_counts(papers, pub):
    for p in papers:
        p["note_counts"] = {"private": len(p.get("note_list") or []), "public": pub.get(p["id"], 0)}


def load_papers(db, ids) -> list[dict]:
    ids = [int(i) for i in ids]
    out, gmap, ac, sm = [], group_map(db), annotation_counts(db), share_map(db)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        q = f"SELECT * FROM papers WHERE id IN ({','.join('?' * len(chunk))})"
        out += [row_to_paper(r, gmap, ac, sm) for r in db.execute(q, chunk)]
    _add_note_counts(out, public_note_counts(db) if sm else {})
    order = {pid: n for n, pid in enumerate(ids)}
    return sorted(out, key=lambda p: order.get(p["id"], 0))


def group_exists(db, gid) -> bool:
    return bool(gid) and db.execute("SELECT 1 FROM collections WHERE id=?", (gid,)).fetchone() is not None


def group_descendants(db, gid) -> set:
    out, stack = {gid}, [gid]
    while stack:
        cur = stack.pop()
        for (cid,) in db.execute("SELECT id FROM collections WHERE parent_id=?", (cur,)):
            if cid not in out:
                out.add(cid)
                stack.append(cid)
    return out


def group_paths(db) -> dict:
    rows = {r["id"]: dict(r) for r in db.execute("SELECT id, name, parent_id FROM collections")}

    def path(gid, depth=0):
        g_ = rows.get(gid)
        if not g_ or depth > 50:
            return ""
        parent = path(g_["parent_id"], depth + 1) if g_["parent_id"] else ""
        return f"{parent}/{g_['name']}" if parent else g_["name"]

    return {gid: path(gid) for gid in rows}


def touch_papers(db, ids):
    ts = now()
    for pid in ids:
        db.execute("UPDATE papers SET updated_at=? WHERE id=?", (ts, pid))


def find_duplicate(db, meta):
    doi = (meta.get("doi") or "").strip().lower()
    if doi:
        r = db.execute("SELECT id FROM papers WHERE lower(doi)=?", (doi,)).fetchone()
        if r:
            return r["id"]
    aid = (meta.get("arxiv_id") or "").strip()
    if aid:
        r = db.execute("SELECT id FROM papers WHERE arxiv_id=?", (aid,)).fetchone()
        if r:
            return r["id"]
    return None


def store_citation_data(db, pid, data: dict):
    if not data or not data.get("openalex_id"):
        return
    db.execute("UPDATE papers SET openalex_id=?, refs=?, related=?, cited_by_count=?, citations_at=? WHERE id=?",
               (data["openalex_id"], json.dumps(data.get("refs") or []), json.dumps(data.get("related") or []),
                data.get("cited_by_count"), now(), pid))


def insert_paper(db, meta, group_id=None):
    """Insert (or find the existing copy of) a paper. Returns (id, was_duplicate)."""
    dup = find_duplicate(db, meta)
    if dup:
        pid, duplicate = dup, True
    else:
        ts = now()
        vals = {f: str(meta.get(f) or "") for f in TEXT_FIELDS}
        vals["type"] = vals["type"] or "article"
        vals["status"] = vals["status"] if vals["status"] in STATUSES else "to_read"
        cols = TEXT_FIELDS + ["uid", "authors", "keywords", "year", "starred", "added_at", "updated_at"]
        values = [vals[f] for f in TEXT_FIELDS] + [
            new_uid(), json.dumps(meta.get("authors") or [], ensure_ascii=False),
            json.dumps(meta.get("keywords") or [], ensure_ascii=False),
            _int(meta.get("year")), 1 if meta.get("starred") else 0, ts, ts]
        cur = db.execute(f"INSERT INTO papers ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", values)
        pid, duplicate = cur.lastrowid, False
        if vals["notes"].strip():
            lst = []
            notesmod.add(lst, vals["notes"])
            db.execute("UPDATE papers SET note_list=? WHERE id=?", (json.dumps(lst, ensure_ascii=False), pid))
        store_citation_data(db, pid, meta)
    if group_exists(db, group_id):
        db.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, group_id))
        if duplicate:
            touch_papers(db, [pid])
    pdf_bytes = meta.get("_pdf_bytes")
    if pdf_bytes:
        row = db.execute("SELECT pdf_path FROM papers WHERE id=?", (pid,)).fetchone()
        if not (row["pdf_path"] and os.path.isfile(row["pdf_path"])):
            path = pdffinder.save_pdf(pdf_bytes, meta, get_settings(db)["pdf_dir"])
            db.execute("UPDATE papers SET pdf_path=? WHERE id=?", (str(path), pid))
    db.commit()
    return pid, duplicate


def apply_changes(db, pid, body: dict):
    sets, vals, touched = [], [], False
    for f in TEXT_FIELDS:
        if f == "notes":
            continue  # notes are separate notes now (see /api/papers/<id>/notes)
        if f in body:
            v = str(body[f] or "")
            v = v if f in ("abstract", "notes") else " ".join(v.split()) if f == "title" else v.strip()
            if f == "status" and v not in STATUSES:
                continue
            sets.append(f"{f}=?")
            vals.append(v)
    for f in JSON_FIELDS:
        if f in body and isinstance(body[f], list):
            sets.append(f"{f}=?")
            vals.append(json.dumps(body[f], ensure_ascii=False))
    if "year" in body:
        sets.append("year=?")
        vals.append(_int(body["year"]))
    if "starred" in body:
        sets.append("starred=?")
        vals.append(1 if body["starred"] else 0)
    if "pdf_path" in body and not body["pdf_path"]:
        sets.append("pdf_path=?")
        vals.append("")
    if "group_ids" in body and isinstance(body["group_ids"], list):
        db.execute("DELETE FROM paper_collections WHERE paper_id=?", (pid,))
        for gid in body["group_ids"]:
            if group_exists(db, _int(gid)):
                db.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, _int(gid)))
        touched = True
    if sets or touched:
        sets.append("updated_at=?")
        vals.append(now())
        db.execute(f"UPDATE papers SET {', '.join(sets)} WHERE id=?", vals + [pid])


def record_deletion(db, uid, kind):
    if uid:
        db.execute("INSERT OR REPLACE INTO deletions (uid, kind, deleted_at) VALUES (?, ?, ?)", (uid, kind, now()))


def move_to_trash(path: str):
    """Move a file to the Trash / Recycle Bin."""
    if not path or not os.path.isfile(path):
        return
    try:
        from send2trash import send2trash
        send2trash(path)
        return
    except ImportError:
        pass
    trash = Path.home() / ".Trash"
    if sys.platform == "darwin" and trash.is_dir():
        target, i = trash / Path(path).name, 2
        while target.exists():
            target = trash / f"{Path(path).stem} {i}{Path(path).suffix}"
            i += 1
        shutil.move(path, target)
    else:
        os.remove(path)


def open_path(path: str, reveal: bool = False):
    if sys.platform == "darwin":
        subprocess.run(["open", "-R", path] if reveal else ["open", path], check=False)
    elif os.name == "nt":
        if reveal:
            subprocess.run(["explorer", "/select,", os.path.normpath(path)], check=False)
        else:
            os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", os.path.dirname(path) if reveal else path], check=False)


def error(msg, status=400, **extra):
    return jsonify(error=msg, **extra), status


def lookup_error(exc):
    return error(str(exc), 502 if isinstance(exc, metadata.NetworkError) else 422,
                 nomatch=isinstance(exc, metadata.NoMatch))


def try_download(db, pid) -> dict:
    paper = load_paper(db, pid)
    if paper["pdf_exists"]:
        return {"ok": True, "already": True, "source": "already saved", "path": paper["pdf_path"]}
    s = get_settings(db)
    landing = paper.get("url") or (f"https://doi.org/{paper['doi']}" if paper.get("doi") else "")
    try:
        res = pdffinder.find_and_download(paper, s["pdf_dir"], s["email"], s.get("core_key", ""))
    except pdffinder.PdfNotFound as exc:
        return {"ok": False, "error": str(exc), "tried": exc.tried, "landing": landing}
    except OSError as exc:
        return {"ok": False, "error": f"Could not save the PDF: {exc}", "tried": [], "landing": landing}
    db.execute("UPDATE papers SET pdf_path=?, updated_at=? WHERE id=?", (res["path"], now(), pid))
    db.commit()
    return {"ok": True, **res}


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.get("/")
def index():
    return send_file(BASE_DIR / "static" / "index.html")


@app.get("/quickadd")
def quickadd():
    """Target of the browser bookmarklets: /quickadd?url=...&pdf=1"""
    target = request.args.get("url", "").strip()
    db = get_db()
    s = get_settings(db)
    try:
        meta = metadata.resolve(target, s["email"])
    except metadata.MetadataError as exc:
        return redirect("/#" + urlencode({"error": f"Could not add this page: {exc}"}))
    pid, dup = insert_paper(db, meta)
    msg = "Already in your library" if dup else "Added to your library"
    if request.args.get("pdf") == "1":
        res = try_download(db, pid)
        if res["ok"]:
            msg += " - PDF saved"
        else:
            WATCHER.expect(pid)
            msg += (" - no free PDF found. If you have access, download the PDF from the article page: "
                    "PaperShelf will attach it automatically")
    return redirect("/#" + urlencode({"paper": pid, "msg": msg}))


@app.get("/pdf/<int:pid>")
def view_pdf(pid):
    p = load_paper(get_db(), pid)
    if not p or not p["pdf_exists"]:
        return "PDF not found", 404
    return send_file(p["pdf_path"], mimetype="application/pdf", download_name=Path(p["pdf_path"]).name,
                     max_age=0)


# --------------------------------------------------------------------------- #
# API: library and papers
# --------------------------------------------------------------------------- #
@app.get("/api/library")
def library():
    db = get_db()
    gmap, ac, sm = group_map(db), annotation_counts(db), share_map(db)
    pub = public_note_counts(db)
    papers = []
    for r in db.execute("SELECT * FROM papers ORDER BY added_at DESC, id DESC"):
        p = row_to_paper(r, gmap, ac, sm)
        _add_note_counts([p], pub)
        p.pop("related", None)  # only needed on the server
        papers.append(p)
    groups = [dict(r) for r in db.execute(
        "SELECT id, uid, name, parent_id, position, color FROM collections ORDER BY position, name COLLATE NOCASE")]
    return jsonify(papers=papers, groups=groups, shares=shares_summary(db), settings=get_settings(db, secrets=False), data_dir=str(HOME),
                   styles=citations.style_list(), platform=sys.platform, version=APP_VERSION, app_dir=str(BASE_DIR))


@app.post("/api/papers")
def add_paper():
    body = request.get_json(silent=True) or {}
    db = get_db()
    settings = get_settings(db)
    if body.get("manual") is not None:
        meta = metadata.empty_meta()
        meta.update({k: v for k, v in (body.get("manual") or {}).items() if k in meta})
        meta["title"] = meta["title"] or "Untitled paper"
    else:
        try:
            meta = metadata.resolve(body.get("input", ""), settings["email"])
        except metadata.MetadataError as exc:
            return lookup_error(exc)
        except Exception as exc:  # never crash the UI on an unexpected page
            app.logger.exception("lookup failed")
            return error(f"Unexpected error while looking this up: {exc}", 500)
    pid, dup = insert_paper(db, meta, _int(body.get("group_id")))
    pdf = try_download(db, pid) if body.get("download_pdf") else None
    return jsonify(paper=load_paper(db, pid), duplicate=dup, pdf=pdf)


@app.get("/api/fulltext")
def fulltext_search():
    """Papers whose PDF contains all the words of the query, with snippets."""
    db = get_db()
    q = (request.args.get("q") or "").strip()
    hits = fulltext.search(db, q) if len(q) >= 2 else {}
    dois = {r["id"]: r["doi"] for r in db.execute(
        f"SELECT id, doi FROM papers WHERE id IN ({','.join('?' * len(hits))})", list(hits))} if hits else {}
    return jsonify(hits={str(k): dict(v, doi=dois.get(k, "")) for k, v in hits.items()}, status=fulltext.status(db))


def fulltext_loop():
    """Index the text of new or changed PDFs in the background (a few at a time)."""
    if STOP.wait(10):
        return
    while not STOP.is_set():
        db = connect()
        try:
            n = fulltext.index_pending(db, limit=5, stop=STOP)
        except Exception as exc:  # noqa: BLE001 - background task
            logging.getLogger("papershelf").warning("PDF text index failed: %s", exc)
            n = 0
        finally:
            db.close()
        STOP.wait(2 if n else 60)


@app.get("/api/search-topic")
def search_topic():
    """Search OpenAlex by meaning (semantic search on titles and abstracts) or by words."""
    q = (request.args.get("q") or "").strip()[:2000]
    if len(q) < 3:
        return error("Describe what you are looking for (a few words or a sentence).")
    mode = request.args.get("mode") or "semantic"
    filters = []
    y = _int(request.args.get("from"))
    if y:
        filters.append(f"publication_year:>{y - 1}")
    if request.args.get("oa") == "1":
        filters.append("is_oa:true")
    if request.args.get("type") == "articles":
        filters.append("type:article|review")
    if request.args.get("type") == "reviews":
        filters.append("type:review")
    params = {"per_page": 30 if mode == "semantic" else 40,
              "select": "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,type,open_access,abstract_inverted_index"}
    if filters:
        params["filter"] = ",".join(filters)
    note = ""
    try:
        r = metadata.http_get("https://api.openalex.org/works", params={**params, ("search.semantic" if mode == "semantic" else "search"): q})
        if mode == "semantic" and r.status_code != 200:
            note = "Search by meaning isn't available right now – showing results by words instead."
            r = metadata.http_get("https://api.openalex.org/works", params={**params, "search": q})
        if r.status_code != 200:
            return error(f"OpenAlex answered {r.status_code}. Try again in a moment.", 502)
        results = r.json().get("results") or []
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    db = get_db()
    have_doi = {(x["doi"] or "").lower(): x["id"] for x in db.execute("SELECT id, doi FROM papers WHERE doi != ''")}
    have_oa = {x["openalex_id"]: x["id"] for x in db.execute("SELECT id, openalex_id FROM papers WHERE openalex_id != ''")}
    out = []
    for w in results:
        wid = metadata.openalex_short(w.get("id"))
        doi = metadata.clean_doi((w.get("doi") or "").replace("https://doi.org/", ""))
        names = [((a.get("author") or {}).get("display_name") or "") for a in w.get("authorships") or []]
        names = [n for n in names if n]
        abstract = ""
        inv = w.get("abstract_inverted_index") or {}
        if inv:
            pos = sorted((i, word) for word, idx in inv.items() for i in idx)
            abstract = " ".join(word for _, word in pos)
        out.append({"id": wid, "doi": doi, "title": metadata.clean_text(w.get("display_name") or "", ""),
                    "authors": (", ".join(names[:3]) + (" et al." if len(names) > 3 else "")),
                    "venue": ((w.get("primary_location") or {}).get("source") or {}).get("display_name") or "",
                    "year": w.get("publication_year"), "cited_by_count": w.get("cited_by_count") or 0,
                    "type": w.get("type") or "", "oa": bool((w.get("open_access") or {}).get("is_oa")),
                    "abstract": abstract[:700], "in_library": have_doi.get(doi.lower()) or have_oa.get(wid)})
    return jsonify(results=out, mode="keyword" if note else mode, note=note)


@app.get("/api/search-online")
def search_online():
    """Suggestions for the "Add paper" box: likely papers for a few words of a title."""
    q = (request.args.get("q") or "").strip()
    try:
        cands = metadata.search_candidates(q, limit=min(_int(request.args.get("n")) or 8, 15))
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    db = get_db()
    have = {r[0].lower(): r[1] for r in db.execute("SELECT doi, id FROM papers WHERE doi != ''")}
    for c in cands:
        c["in_library"] = have.get((c.get("doi") or "").lower())
    return jsonify(results=cands, query=q)


def _kw_norm(k: str) -> str:
    """Variants of the same keyword share this form: case, accents, hyphens and simple plurals ignored."""
    import unicodedata
    k = unicodedata.normalize("NFKD", (k or "").lower())
    k = re.sub(r"[^a-z0-9]+", " ", k).strip()
    words = [w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w for w in k.split()]
    return " ".join(words)


@app.get("/api/keywords")
def list_keywords():
    """All keywords of the library with their counts, and groups of likely variants to merge."""
    db = get_db()
    counts, forms = Counter(), {}
    for (raw,) in db.execute("SELECT keywords FROM papers"):
        try:
            kws = json.loads(raw or "[]")
        except ValueError:
            continue
        seen = set()
        for k in kws:
            k = " ".join(str(k).split())
            if not k or k.lower() in seen:
                continue
            seen.add(k.lower())
            counts[k] += 1
    by_norm = {}
    for k, n in counts.items():
        by_norm.setdefault(_kw_norm(k), []).append(k)
    variants = [sorted(v, key=lambda x: -counts[x]) for v in by_norm.values() if len(v) > 1]
    return jsonify(keywords=[{"keyword": k, "count": n} for k, n in counts.most_common()],
                   variants=sorted(variants, key=lambda v: -sum(counts[x] for x in v)))


@app.post("/api/keywords")
def edit_keywords():
    """Rename, merge or delete keywords in the whole library."""
    b = request.get_json(silent=True) or {}
    action = b.get("action")
    targets = {" ".join(str(k).split()).lower() for k in b.get("keywords") or [] if str(k).strip()}
    to = " ".join(str(b.get("to") or "").split())
    if action not in ("rename", "merge", "delete") or not targets:
        return error("Choose the keywords first.")
    if action in ("rename", "merge") and not to:
        return error("Type the new keyword.")
    db = get_db()
    changed = 0
    ts = now()
    for r in db.execute("SELECT id, keywords FROM papers").fetchall():
        try:
            kws = json.loads(r["keywords"] or "[]")
        except ValueError:
            continue
        if not any(" ".join(str(k).split()).lower() in targets for k in kws):
            continue
        out, seen = [], set()
        for k in kws:
            k2 = to if " ".join(str(k).split()).lower() in targets else k
            if action == "delete" and k2 is to and not to:
                continue
            if action == "delete" and " ".join(str(k).split()).lower() in targets:
                continue
            if k2.lower() not in seen:
                seen.add(k2.lower())
                out.append(k2)
        db.execute("UPDATE papers SET keywords=?, updated_at=? WHERE id=?", (json.dumps(out, ensure_ascii=False), ts, r["id"]))
        changed += 1
    db.commit()
    return jsonify(ok=True, papers=changed)


@app.put("/api/papers/<int:pid>")
def update_paper(pid):
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    apply_changes(db, pid, request.get_json(silent=True) or {})
    db.commit()
    return jsonify(paper=load_paper(db, pid))


@app.post("/api/papers/bulk")
def bulk_update():
    body = request.get_json(silent=True) or {}
    db = get_db()
    changes = body.get("changes") or {}
    for pid in body.get("ids") or []:
        apply_changes(db, int(pid), changes)
    db.commit()
    return jsonify(papers=load_papers(db, body.get("ids") or []))


@app.delete("/api/papers/<int:pid>")
def delete_paper(pid):
    return _delete([pid], request.args.get("files") == "1", request.args.get("unshare", "1") == "1")


@app.post("/api/papers/delete")
def delete_papers():
    body = request.get_json(silent=True) or {}
    return _delete(body.get("ids") or [], bool(body.get("delete_files")), body.get("unshare", True) is not False)


def _delete(ids, delete_files, unshare=True):
    db = get_db()
    errors = []
    touched_shares = share_forget_papers(db, [int(i) for i in ids], unshare)
    for p in load_papers(db, ids):
        if delete_files and p["pdf_exists"]:
            try:
                move_to_trash(p["pdf_path"])
            except OSError as exc:
                errors.append(str(exc))
        record_deletion(db, p["uid"], "paper")
        db.execute("DELETE FROM papers WHERE id=?", (p["id"],))
    db.commit()
    for sid in touched_shares:
        publish_soon(sid)
    return jsonify(ok=True, errors=errors)


@app.post("/api/papers/<int:pid>/refresh")
def refresh_paper(pid):
    db = get_db()
    p = load_paper(db, pid)
    if not p:
        return error("Paper not found", 404)
    body = request.get_json(silent=True) or {}
    query = (body.get("input") or "").strip() or p["doi"] or p["arxiv_id"] or p["url"] or p["title"]
    try:
        meta = metadata.resolve(query, get_settings(db)["email"])
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    changes = {k: meta[k] for k in META_FIELDS if meta.get(k) not in (None, "", [])}
    changes["keywords"] = metadata.merge_keywords(p["keywords"], meta.get("keywords"), limit=30)
    apply_changes(db, pid, changes)
    store_citation_data(db, pid, meta)
    if meta.get("_pdf_bytes") and not p["pdf_exists"]:
        path = pdffinder.save_pdf(meta["_pdf_bytes"], meta, get_settings(db)["pdf_dir"])
        db.execute("UPDATE papers SET pdf_path=? WHERE id=?", (str(path), pid))
    db.commit()
    return jsonify(paper=load_paper(db, pid))


@app.get("/api/papers/<int:pid>/cite")
def cite(pid):
    p = load_paper(get_db(), pid)
    if not p:
        return error("Paper not found", 404)
    style = request.args.get("style") or get_settings()["default_style"]
    return jsonify(text=citations.cite_text(p, style), html=citations.cite_html(p, style), style=style)


@app.get("/api/styles")
def styles():
    return jsonify(styles=citations.style_list())


# --------------------------------------------------------------------------- #
# API: PDFs and highlights
# --------------------------------------------------------------------------- #
@app.post("/api/papers/<int:pid>/pdf")
def download_pdf(pid):
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    res = try_download(db, pid)
    paper = load_paper(db, pid)
    if not res["ok"]:
        return error(res["error"], 404, tried=res.get("tried", []), landing=res.get("landing", ""), paper=paper)
    return jsonify(paper=paper, pdf=res)


@app.post("/api/papers/<int:pid>/pdf/upload")
def upload_pdf(pid):
    db = get_db()
    p = load_paper(db, pid)
    if not p:
        return error("Paper not found", 404)
    f = request.files.get("file")
    data = f.read() if f else b""
    if b"%PDF-" not in data[:1024]:
        return error("That file doesn't look like a PDF.")
    path = pdffinder.save_pdf(data, p, get_settings(db)["pdf_dir"])
    db.execute("UPDATE papers SET pdf_path=?, updated_at=? WHERE id=?", (str(path), now(), pid))
    db.commit()
    return jsonify(paper=load_paper(db, pid))


@app.post("/api/papers/<int:pid>/open")
def open_pdf(pid):
    p = load_paper(get_db(), pid)
    if not p or not p["pdf_exists"]:
        return error("No PDF saved for this paper.", 404)
    open_path(p["pdf_path"], reveal=bool((request.get_json(silent=True) or {}).get("reveal")))
    return jsonify(ok=True)


def _annotation(row) -> dict:
    a = dict(row)
    a["rects"] = json.loads(a["rects"] or "[]")
    return a


@app.get("/api/papers/<int:pid>/annotations")
def list_annotations(pid):
    rows = get_db().execute("SELECT * FROM annotations WHERE paper_id=? ORDER BY page, id", (pid,))
    return jsonify(annotations=[_annotation(r) for r in rows])


@app.post("/api/papers/<int:pid>/annotations")
def add_annotation(pid):
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    b = request.get_json(silent=True) or {}
    ts = now()
    cur = db.execute("INSERT INTO annotations (uid, paper_id, page, rects, text, note, color, created_at, updated_at) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (new_uid(), pid, _int(b.get("page")) or 1, json.dumps(b.get("rects") or []),
                      (b.get("text") or "")[:5000], b.get("note") or "", b.get("color") or "yellow", ts, ts))
    touch_papers(db, [pid])
    db.commit()
    return jsonify(annotation=_annotation(db.execute("SELECT * FROM annotations WHERE id=?", (cur.lastrowid,)).fetchone()))


@app.put("/api/annotations/<int:aid>")
def update_annotation(aid):
    db = get_db()
    row = db.execute("SELECT * FROM annotations WHERE id=?", (aid,)).fetchone()
    if not row:
        return error("Highlight not found", 404)
    b = request.get_json(silent=True) or {}
    db.execute("UPDATE annotations SET note=?, color=?, updated_at=? WHERE id=?",
               (b.get("note", row["note"]), b.get("color", row["color"]), now(), aid))
    touch_papers(db, [row["paper_id"]])
    db.commit()
    return jsonify(annotation=_annotation(db.execute("SELECT * FROM annotations WHERE id=?", (aid,)).fetchone()))


@app.delete("/api/annotations/<int:aid>")
def delete_annotation(aid):
    db = get_db()
    row = db.execute("SELECT paper_id FROM annotations WHERE id=?", (aid,)).fetchone()
    if row:
        db.execute("DELETE FROM annotations WHERE id=?", (aid,))
        touch_papers(db, [row["paper_id"]])
        db.commit()
    return jsonify(ok=True)


HIGHLIGHT_COLORS = {"yellow": "ffd400", "green": "5fb236", "blue": "2ea8e5", "red": "ff6666", "purple": "a28ae5"}


@app.post("/api/papers/<int:pid>/annotations/embed")
def embed_annotations(pid):
    """Write the highlights into the PDF file itself (visible in Preview, Acrobat, Zotero...)."""
    db = get_db()
    p = load_paper(db, pid)
    if not p or not p["pdf_exists"]:
        return error("No PDF saved for this paper.", 404)
    anns = [_annotation(r) for r in db.execute("SELECT * FROM annotations WHERE paper_id=?", (pid,))]
    try:
        from pypdf import PdfWriter
        from pypdf.annotations import Highlight
        from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject
    except ImportError:
        return error("The pypdf package is missing. Run: pip install -r requirements.txt")
    path = p["pdf_path"]
    try:
        writer = PdfWriter(clone_from=path)
        for page in writer.pages:  # remove highlights written earlier by PaperShelf
            annots = page.get("/Annots")
            if annots:
                keep = [a for a in annots.get_object() if not str(a.get_object().get("/NM", "")).startswith("papershelf-")]
                page[NameObject("/Annots")] = ArrayObject(keep)
        count = 0
        for a in anns:
            idx = int(a["page"]) - 1
            rects = [r for r in a["rects"] if len(r) == 4]
            if not rects or idx < 0 or idx >= len(writer.pages):
                continue
            quads = []
            for x1, y1, x2, y2 in rects:
                quads += [x1, y2, x2, y2, x1, y1, x2, y1]
            box = (min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))
            annot = Highlight(rect=box, quad_points=ArrayObject([FloatObject(v) for v in quads]),
                              highlight_color=HIGHLIGHT_COLORS.get(a["color"], "ffd400"))
            annot[NameObject("/NM")] = TextStringObject(f"papershelf-{a['uid']}")
            annot[NameObject("/T")] = TextStringObject("PaperShelf")
            if a["note"]:
                annot[NameObject("/Contents")] = TextStringObject(a["note"])
            writer.add_annotation(page_number=idx, annotation=annot)
            count += 1
        tmp = path + ".papershelf-tmp"
        with open(tmp, "wb") as fh:
            writer.write(fh)
        os.replace(tmp, path)
    except Exception as exc:
        return error(f"Could not write the highlights into the PDF: {exc}", 500)
    return jsonify(ok=True, count=count)


@app.post("/api/import-pdf")
def import_pdf():
    """Add a paper from a PDF file on your computer (drag & drop)."""
    db = get_db()
    f = request.files.get("file")
    data = f.read() if f else b""
    if b"%PDF-" not in data[:1024]:
        return error("That file doesn't look like a PDF.")
    s = get_settings(db)
    meta, identified = None, False
    ident = metadata.identifier_from_pdf(data)
    if ident:
        try:
            meta, identified = metadata.resolve(ident, s["email"]), True
        except metadata.MetadataError:
            meta = None
    if not meta:
        meta = metadata.empty_meta()
        stem = Path(f.filename or "paper.pdf").stem
        meta["title"] = re.sub(r"[_]+", " ", stem).strip() or "Untitled paper"
        meta["notes"] = ("Imported from a PDF - details could not be found automatically. "
                         "Use 'Update metadata' and paste the DOI or title.")
    meta["_pdf_bytes"] = data
    pid, dup = insert_paper(db, meta, _int(request.form.get("group_id")))
    return jsonify(paper=load_paper(db, pid), duplicate=dup, identified=identified)


# --------------------------------------------------------------------------- #
# API: citation network and suggestions (OpenAlex)
# --------------------------------------------------------------------------- #
CACHE_DAYS = 30


def cached_works(db, ids, email):
    """OpenAlex summaries for the given IDs, using the local cache when possible."""
    ids = list(dict.fromkeys(i for i in ids if i))
    out, missing = {}, []
    cutoff = time.time() - CACHE_DAYS * 86400
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in db.execute(f"SELECT id, data, fetched_at FROM oa_cache WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            if r["fetched_at"] >= cutoff:
                out[r["id"]] = json.loads(r["data"])
    missing = [i for i in ids if i not in out]
    if missing:
        for w in metadata.openalex_works(missing, email):
            out[w["id"]] = w
            db.execute("INSERT OR REPLACE INTO oa_cache VALUES (?, ?, ?)", (w["id"], json.dumps(w), time.time()))
        db.commit()
    return out


@app.post("/api/papers/<int:pid>/citations")
def fetch_citations(pid):
    db = get_db()
    p = load_paper(db, pid)
    if not p:
        return error("Paper not found", 404)
    try:
        w = metadata.openalex_for_paper(p, get_settings(db)["email"])
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    if not w:
        db.execute("UPDATE papers SET citations_at=? WHERE id=?", (now(), pid))
        db.commit()
        return error("This paper isn't in OpenAlex (it needs a DOI or arXiv ID).", 404, paper=load_paper(db, pid))
    store_citation_data(db, pid, metadata.citation_fields(w))
    db.commit()
    return jsonify(paper=load_paper(db, pid))


@app.post("/api/openalex/works")
def openalex_works():
    ids = (request.get_json(silent=True) or {}).get("ids") or []
    db = get_db()
    try:
        works = cached_works(db, [metadata.openalex_short(i) for i in ids[:300]], get_settings(db)["email"])
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    return jsonify(works=works)


@app.get("/api/suggestions")
def suggestions():
    db = get_db()
    email = get_settings(db)["email"]
    gid = _int(request.args.get("group"))
    all_papers = [row_to_paper(r, {}) for r in db.execute("SELECT * FROM papers")]
    if gid:
        ids = group_descendants(db, gid) if request.args.get("sub", "1") == "1" else {gid}
        members = {r[0] for r in db.execute(
            f"SELECT paper_id FROM paper_collections WHERE collection_id IN ({','.join('?' * len(ids))})", list(ids))}
        scope = [p for p in all_papers if p["id"] in members]
    else:
        scope = all_papers
    owned_ids = {p["openalex_id"] for p in all_papers if p["openalex_id"]}
    owned_dois = {p["doi"].lower() for p in all_papers if p["doi"]}
    with_data = [p for p in scope if p["openalex_id"]]
    missing = len(scope) - len(with_data)

    def not_owned(w):
        return w and w["id"] not in owned_ids and (w.get("doi") or "").lower() not in owned_dois

    result = {"scope": len(scope), "with_data": len(with_data), "missing_data": missing,
              "cocited": [], "related": [], "citing": [], "errors": []}
    if not with_data:
        return jsonify(result)

    ref_counts = Counter(r for p in with_data for r in set(p["refs"]) if r not in owned_ids)
    min_count = 1 if len(with_data) <= 3 else 2
    top_refs = [(i, n) for i, n in ref_counts.most_common(60) if n >= min_count][:30]
    rel_counts = Counter(r for p in with_data for r in set(p["related"]) if r not in owned_ids)
    top_rel = rel_counts.most_common(30)
    try:
        works = cached_works(db, [i for i, _ in top_refs] + [i for i, _ in top_rel], email)
        result["cocited"] = [dict(works[i], count=n) for i, n in top_refs if not_owned(works.get(i))][:20]
        result["related"] = [dict(works[i], count=n) for i, n in top_rel if not_owned(works.get(i))][:20]
    except metadata.MetadataError as exc:
        result["errors"].append(str(exc))

    try:
        core = sorted(with_data, key=lambda p: -(p["cited_by_count"] or 0))[:50]
        core_ids = {p["openalex_id"] for p in core}
        citing = metadata.openalex_citing(core_ids, email, since_year=datetime.now().year - 6, limit=200)
        scored = []
        for w in citing:
            if not not_owned(w):
                continue
            overlap = len(core_ids.intersection(w.get("refs") or []))
            scored.append(dict(w, count=overlap))
        scored.sort(key=lambda w: (-w["count"], -(w.get("year") or 0), -(w.get("cited_by_count") or 0)))
        result["citing"] = scored[:20]
    except metadata.MetadataError as exc:
        result["errors"].append(str(exc))
    for lst in ("cocited", "related", "citing"):
        for w in result[lst]:
            w.pop("refs", None)
    return jsonify(result)


# --------------------------------------------------------------------------- #
# API: groups
# --------------------------------------------------------------------------- #
@app.post("/api/groups")
def create_group():
    body = request.get_json(silent=True) or {}
    db = get_db()
    name = " ".join((body.get("name") or "").split()) or "New label"
    parent = _int(body.get("parent_id"))
    if parent and not group_exists(db, parent):
        return error("Parent label not found", 404)
    pos = db.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM collections WHERE parent_id IS ?",
                     (parent,)).fetchone()[0]
    uid = new_uid()
    cur = db.execute("INSERT INTO collections (uid, name, parent_id, position, updated_at) VALUES (?, ?, ?, ?, ?)",
                     (uid, name, parent, pos, now()))
    db.commit()
    return jsonify(group={"id": cur.lastrowid, "uid": uid, "name": name, "parent_id": parent, "position": pos, "color": ""})


@app.put("/api/groups/<int:gid>")
def update_group(gid):
    body = request.get_json(silent=True) or {}
    db = get_db()
    if not group_exists(db, gid):
        return error("Label not found", 404)
    if "name" in body:
        name = " ".join((body.get("name") or "").split())
        if name:
            db.execute("UPDATE collections SET name=? WHERE id=?", (name, gid))
    if "color" in body and (body.get("color") or "") in LABEL_COLORS:
        db.execute("UPDATE collections SET color=? WHERE id=?", (body.get("color") or "", gid))
    if "parent_id" in body:
        parent = _int(body["parent_id"])
        if parent in group_descendants(db, gid):
            return error("A label can't be moved inside itself.")
        if parent and not group_exists(db, parent):
            return error("Parent label not found", 404)
        db.execute("UPDATE collections SET parent_id=? WHERE id=?", (parent, gid))
    db.execute("UPDATE collections SET updated_at=? WHERE id=?", (now(), gid))
    db.commit()
    row = db.execute("SELECT id, uid, name, parent_id, position, color FROM collections WHERE id=?", (gid,)).fetchone()
    return jsonify(group=dict(row))


@app.delete("/api/groups/<int:gid>")
def delete_group(gid):
    db = get_db()
    for sub in group_descendants(db, gid):
        row = db.execute("SELECT uid FROM collections WHERE id=?", (sub,)).fetchone()
        if row:
            record_deletion(db, row["uid"], "group")
    affected = [r[0] for r in db.execute("SELECT DISTINCT paper_id FROM paper_collections WHERE collection_id IN "
                                         f"({','.join('?' * len(group_descendants(db, gid)))})",
                                         list(group_descendants(db, gid)))]
    db.execute("DELETE FROM collections WHERE id=?", (gid,))  # subgroups go too (cascade)
    touch_papers(db, affected)
    db.commit()
    return jsonify(ok=True)


@app.post("/api/groups/<int:gid>/papers")
def assign_papers(gid):
    body = request.get_json(silent=True) or {}
    db = get_db()
    if not group_exists(db, gid):
        return error("Label not found", 404)
    ids = [int(i) for i in body.get("paper_ids") or []]
    for pid in ids:
        if body.get("action") == "remove":
            db.execute("DELETE FROM paper_collections WHERE paper_id=? AND collection_id=?", (pid, gid))
        else:
            db.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, gid))
    touch_papers(db, ids)
    db.commit()
    return jsonify(papers=load_papers(db, ids))



# --------------------------------------------------------------------------- #
# API: institutional access (library proxy + Downloads folder)
# --------------------------------------------------------------------------- #
WATCHER = watchermod.DownloadWatcher(connect, lambda db: get_settings(db), move_to_trash)


@app.post("/api/papers/<int:pid>/await")
def await_pdf(pid):
    """The user is about to download this paper's PDF in the browser: watch the Downloads folder."""
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    WATCHER.expect(pid)
    return jsonify(ok=True, folder=str(WATCHER.folder(get_settings(db))))


@app.get("/api/events")
def watcher_events():
    db = get_db()
    s = get_settings(db)
    return jsonify(events=WATCHER.events_after(_int(request.args.get("after")) or 0),
                   watching=WATCHER.active(s), awaiting=list(WATCHER.awaiting), error=WATCHER.last_error,
                   last_id=WATCHER.next_event - 1)


@app.post("/api/watcher/attach")
def watcher_attach():
    b = request.get_json(silent=True) or {}
    db = get_db()
    path = Path(b.get("path") or "")
    folder = WATCHER.folder(get_settings(db))
    try:
        inside = path.is_file() and path.resolve().parent == folder.resolve()
    except OSError:
        inside = False
    if not inside:
        return error("That file is no longer in your Downloads folder.", 404)
    try:
        WATCHER.attach(db, _int(b.get("paper_id")), path)
    except (OSError, ValueError) as exc:
        return error(str(exc))
    return jsonify(paper=load_paper(db, _int(b.get("paper_id"))))


# --------------------------------------------------------------------------- #
# API: researchers
# --------------------------------------------------------------------------- #
def person_summary(row) -> dict:
    data = json.loads(row["data"] or "{}")
    if not data.get("photo") and "scholar" in row.keys() and row["scholar"]:
        sd = json.loads(row["scholar"]).get("photo_data")
        if sd:
            data["photo"] = {"data": sd}
    return {"id": row["id"], "orcid": row["orcid"], "openalex_id": row["openalex_id"], "name": row["name"],
            "is_me": bool(row["is_me"]), "fetched_at": row["fetched_at"], "photo": data.get("photo"),
            "current": data.get("current") or [], "metrics": data.get("metrics") or {},
            "works": len(data.get("works") or [])}


def person_data(row) -> dict:
    """The stored profile with the Google Scholar list (if captured) merged in."""
    data = json.loads(row["data"] or "{}")
    for w in data.get("works") or []:  # always use the latest classification rules
        w["category"], w["cat_note"] = people.classify_detail(w)
        if "role" not in w:
            w["role"] = people.base_role(w, people.researcher_names(data))
    sch = json.loads(row["scholar"] or "{}") if "scholar" in row.keys() and row["scholar"] else None
    if sch:
        fams = [n.strip().split()[-1].lower() for n in [data.get("name") or sch.get("name") or ""] if n.strip()]
        data["works"], log = people.merge_scholar(data.get("works") or [], sch, fams)
        data["merge_log"] = (data.get("merge_log") or []) + log
        data["scholar"] = {k: v for k, v in sch.items() if k != "pubs"}
        data["scholar"]["pubs_count"] = len(sch.get("pubs") or [])
        # (roles from the paper texts are applied below, after the Scholar merge)
        if not data.get("photo") and sch.get("photo_data"):
            data["photo"] = {"data": sch["photo_data"], "url": None, "page": sch["url"], "source": "Google Scholar"}
        if not any(src["name"] == "Google Scholar" for src in data.get("sources") or []):
            data.setdefault("sources", []).append({"name": "Google Scholar", "url": sch["url"],
                                                   "what": f"public profile page captured by you on {sch['captured_at'][:10]}"})
    extra = json.loads(row["roles_extra"] or "{}") if "roles_extra" in row.keys() else {}
    for w in data.get("works") or []:  # co-first / co-last found in the papers themselves (kept across refreshes)
        e = extra.get(w.get("key"))
        if e:
            w["eq_checked"] = e
            if e.get("role") and w.get("role") in ("middle", "", None):
                w["role"], w["role_source"] = e["role"], e.get("source", "")
    return data


def person_full(db, row) -> dict:
    out = person_summary(row)
    data = person_data(row)
    lib = {d.lower() for (d,) in db.execute("SELECT doi FROM papers WHERE doi != ''")}
    lib_titles = {people.norm_title(t) for (t,) in db.execute("SELECT title FROM papers")}
    out.update(profile=data, overrides=json.loads(row["overrides"] or "{}"), excluded=json.loads(row["excluded"] or "[]"),
               in_library=[w["key"] for w in data.get("works") or []
                           if (w.get("doi") and w["doi"].lower() in lib) or people.norm_title(w["title"]) in lib_titles],
               categories=[{"id": k, "label": v} for k, v in people.CATEGORIES])
    return out


def save_person(db, prof, pid=None):
    ts = now()
    if pid:
        db.execute("UPDATE people SET orcid=?, openalex_id=?, name=?, data=?, fetched_at=? WHERE id=?",
                   (prof["orcid"], prof["openalex_id"], prof["name"], json.dumps(prof, ensure_ascii=False), ts, pid))
    else:
        cur = db.execute("INSERT INTO people (orcid, openalex_id, name, data, fetched_at, added_at) VALUES (?, ?, ?, ?, ?, ?)",
                         (prof["orcid"], prof["openalex_id"], prof["name"], json.dumps(prof, ensure_ascii=False), ts, ts))
        pid = cur.lastrowid
    db.commit()
    return pid


@app.get("/api/people")
def list_people():
    rows = get_db().execute("SELECT * FROM people ORDER BY is_me DESC, name COLLATE NOCASE")
    return jsonify(people=[person_summary(r) for r in rows])


@app.post("/api/people/search")
def search_people():
    b = request.get_json(silent=True) or {}
    try:
        return jsonify(results=people.search(b.get("query") or "", get_settings()["email"]))
    except metadata.MetadataError as exc:
        return lookup_error(exc)


@app.post("/api/people")
def add_person():
    b = request.get_json(silent=True) or {}
    db = get_db()
    orcid, oaid = (b.get("orcid") or "").strip() or None, (b.get("openalex_id") or "").strip() or None
    existing = None
    if orcid:
        existing = db.execute("SELECT * FROM people WHERE orcid=?", (orcid.upper(),)).fetchone()
    if not existing and oaid:
        existing = db.execute("SELECT * FROM people WHERE openalex_id=?", (oaid.upper(),)).fetchone()
    if existing:
        return jsonify(person=person_full(db, existing), existing=True)
    try:
        prof = people.build_profile(orcid, oaid, get_settings(db)["email"])
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    pid = save_person(db, prof)
    return jsonify(person=person_full(db, db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()))


@app.get("/api/people/<int:pid>")
def get_person(pid):
    db = get_db()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    return jsonify(person=person_full(db, row)) if row else error("Not found", 404)


@app.post("/api/people/<int:pid>/refresh")
def refresh_person(pid):
    db = get_db()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    if not row:
        return error("Not found", 404)
    try:
        prof = people.build_profile(row["orcid"], row["openalex_id"], get_settings(db)["email"])
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    save_person(db, prof, pid)
    return jsonify(person=person_full(db, db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()))


@app.post("/api/people/<int:pid>/roles")
def person_roles(pid):
    """Check co-first / co-last authorship (PubMed equal-contribution flags) without a full refresh."""
    db = get_db()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    if not row:
        return error("Not found", 404)
    prof = json.loads(row["data"] or "{}")
    if not any(w.get("pmid") for w in prof.get("works") or []):
        prof["warnings"] = [w for w in prof.get("warnings") or [] if "Co-first" not in w]
        people.add_roles(prof, online=False)
        prof["roles_checked"] = now()
        prof.setdefault("warnings", []).append("Co-first/co-last check: PubMed IDs are missing in this saved profile – "
                                               "click ↻ Refresh once to fetch them.")
    else:
        try:
            people.add_roles(prof)
        except metadata.MetadataError as exc:
            return lookup_error(exc)
    db.execute("UPDATE people SET data=? WHERE id=?", (json.dumps(prof, ensure_ascii=False), pid))
    db.commit()
    return jsonify(person=person_full(db, db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()))


@app.post("/api/people/<int:pid>/roles/deep")
def person_roles_deep(pid):
    """Read the papers (Europe PMC full text, open-access PDF, publisher page) to find co-first /
    co-last authorship for the given works. The client calls it a few works at a time."""
    db = get_db()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    if not row:
        return error("Not found", 404)
    keys = [k for k in (request.get_json(silent=True) or {}).get("keys") or []][:6]
    data = person_data(row)
    names = people.researcher_names(data)
    extra = json.loads(row["roles_extra"] or "{}")
    by_key = {w.get("key"): w for w in data.get("works") or []}
    out = {}
    for k in keys:
        w = by_key.get(k)
        if not w:
            continue
        idx = people.researcher_index(w, names)
        n = len([a for a in w.get("authors") or [] if a not in ("…", "...")])
        if w.get("role") not in ("middle", "", None) and not (w.get("eq_checked") or {}).get("role"):
            res = {"role": "", "source": w.get("role_source") or "", "note": f"already known: {w.get('role')}"}
        elif idx is None or idx in (0, n - 1):
            res = {"role": "", "source": "", "note": "not in a middle position"}
        else:
            ck = "eq:" + (w.get("doi") or w.get("openalex_id") or k)
            res = _cache_get(ck)
            if res is None:
                try:
                    res = coauth.check(w, idx)
                except Exception as exc:  # noqa: BLE001 - one unreadable paper must not stop the others
                    res = {"role": "", "source": "", "note": f"could not be checked ({exc.__class__.__name__})"}
                _cache_put(ck, res)
        res = dict(res, at=now())
        extra[k] = res
        out[k] = res
    db.execute("UPDATE people SET roles_extra=? WHERE id=?", (json.dumps(extra, ensure_ascii=False), pid))
    db.commit()
    return jsonify(results=out)


@app.put("/api/people/<int:pid>")
def update_person(pid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    if isinstance(b.get("overrides"), dict):
        clean = {k: v for k, v in b["overrides"].items() if v in people.CATEGORY_KEYS}
        db.execute("UPDATE people SET overrides=? WHERE id=?", (json.dumps(clean), pid))
    if isinstance(b.get("excluded"), list):
        db.execute("UPDATE people SET excluded=? WHERE id=?", (json.dumps([str(x) for x in b["excluded"]]), pid))
    if "is_me" in b:
        if b["is_me"]:
            db.execute("UPDATE people SET is_me=0")
        db.execute("UPDATE people SET is_me=? WHERE id=?", (1 if b["is_me"] else 0, pid))
    db.commit()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    return jsonify(person=person_full(db, row)) if row else error("Not found", 404)


@app.delete("/api/people/<int:pid>")
def delete_person(pid):
    db = get_db()
    db.execute("DELETE FROM people WHERE id=?", (pid,))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/people/<int:pid>/export")
def export_person(pid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    if not row:
        return error("Not found", 404)
    prof = person_data(row)
    overrides = json.loads(row["overrides"] or "{}")
    keys = b.get("keys")
    items = []
    for w in prof.get("works") or []:
        if keys is not None and w["key"] not in keys:
            continue
        items.append(dict(w, category=overrides.get(w["key"], w["category"])))
    types = b.get("types")
    if isinstance(types, list):
        items = [w for w in items if w["category"] in types]
    opts = report.default_options()
    opts.update({k: v for k, v in (b.get("options") or {}).items() if k in opts})
    if opts.get("year_only"):
        opts["year_only"] = _int(opts["year_only"])
        items = [w for w in items if w.get("year") == opts["year_only"]]
    if opts["group"] not in ("type", "year", "type_year", "none"):
        opts["group"] = "type"
    style = b.get("style") or get_settings(db)["default_style"]
    fmt = b.get("format") or "html"
    metrics = journals.metrics_for(db, [{"key": w["key"], "issns": w.get("issns") or [], "name": w.get("venue"),
                                         "year": w.get("year")} for w in items]) if (opts["include_if"] or fmt == "csv") else {}
    papers = [people.item_to_paper(w) for w in items]
    if fmt == "html":
        content, ext, mime = report.render_html(prof, items, metrics, style, opts), "html", "text/html; charset=utf-8"
    elif fmt == "txt":
        content, ext, mime = report.render_txt(prof, items, metrics, style, opts), "txt", "text/plain; charset=utf-8"
    elif fmt == "rtf":
        content, ext, mime = report.render_rtf(prof, items, metrics, style, opts), "rtf", "application/rtf"
    elif fmt == "ris":
        content, ext, mime = citations.ris(papers), "ris", "application/x-research-info-systems; charset=utf-8"
    elif fmt == "bibtex":
        content, ext, mime = citations.bibtex(papers), "bib", "application/x-bibtex; charset=utf-8"
    else:
        content, ext, mime = report.render_csv(prof, items, metrics, opts), "csv", "text/csv; charset=utf-8"
    fname = report.filename(prof, opts, ext)
    return Response(content, mimetype=mime, headers={"Content-Disposition": f'attachment; filename="{fname}"'})



# --------------------------------------------------------------------------- #
# Google Scholar: import what the user captured from a public profile page
# --------------------------------------------------------------------------- #
@app.get("/scholar-import")
def scholar_import_page():
    return send_file(BASE_DIR / "static" / "scholar-import.html")


@app.post("/api/scholar/import")
def scholar_import():
    b = request.get_json(silent=True) or {}
    db = get_db()
    sch = people.parse_scholar(b.get("data") or {})
    if not sch["name"] or not sch["url"].startswith("https://scholar.google."):
        return error("This doesn't look like data from a Google Scholar profile page.")
    if sch["photo_url"]:
        sch["photo_data"] = people.fetch_photo_data(sch["photo_url"])
    pid = _int(b.get("person_id"))
    if pid:
        if not db.execute("SELECT 1 FROM people WHERE id=?", (pid,)).fetchone():
            return error("Profile not found", 404)
    else:
        prof = people.profile_from_scholar(sch)
        pid = save_person(db, prof)
    db.execute("UPDATE people SET scholar=? WHERE id=?", (json.dumps(sch, ensure_ascii=False), pid))
    db.commit()
    return jsonify(person_id=pid, publications=len(sch["pubs"]))


@app.delete("/api/people/<int:pid>/scholar")
def scholar_remove(pid):
    db = get_db()
    db.execute("UPDATE people SET scholar='' WHERE id=?", (pid,))
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Journal metrics (SCImago SJR, OpenAlex, your own impact-factor entries)
# --------------------------------------------------------------------------- #
@app.get("/api/sjr/status")
def sjr_status():
    db = get_db()
    return jsonify(loaded=journals.loaded_years(db), latest=journals.latest_year(), first=journals.FIRST_YEAR,
                   failed={str(k): v for k, v in journals.failed_years(db).items()})


@app.post("/api/sjr/load")
def sjr_load():
    year = _int((request.get_json(silent=True) or {}).get("year"))
    if not year or year < journals.FIRST_YEAR or year > datetime.now().year:
        return error("Invalid year")
    db = get_db()
    try:
        n = journals.download_year(db, year, save_to=SJR_DIR)
        f = SJR_DIR / f"scimagojr {year}.csv"
        if f.exists():  # remember it, so the folder watcher doesn't import it a second time
            try:
                known = json.loads(get_settings(db).get("sjr_files") or "{}")
            except ValueError:
                known = {}
            st = f.stat()
            known[f.name] = f"{int(st.st_mtime)}:{st.st_size}"
            set_setting(db, "sjr_files", json.dumps(known))
            db.commit()
    except metadata.MetadataError as exc:
        return lookup_error(exc)
    return jsonify(year=year, journals=n)


SJR_FILE_RE = re.compile(r"^scimagojr[ _-]*(\d{4})(?:[ _-].*?)?(?: ?\(\d+\))?\.(?:csv|txt|xls)$", re.I)
SJR_DIR = HOME / "journal-metrics"  # PaperShelf's own folder for the SCImago tables
SJR_WAIT = {"until": 0.0}


@app.post("/api/sjr/await")
def sjr_await():
    """The user is downloading SCImago tables in the browser: watch the Downloads folder closely for a while."""
    SJR_WAIT["until"] = time.time() + 60 * 60
    SJR_DIR.mkdir(parents=True, exist_ok=True)
    return jsonify(ok=True, folder=str(WATCHER.folder(get_settings())), tables_dir=str(SJR_DIR))


@app.post("/api/sjr/open-folder")
def sjr_open_folder():
    SJR_DIR.mkdir(parents=True, exist_ok=True)
    open_path(str(SJR_DIR))
    return jsonify(ok=True, folder=str(SJR_DIR))


def sjr_collect(db, sweep_downloads: bool = True) -> list:
    """SCImago tables downloaded by the browser are MOVED from Downloads into PaperShelf's own
    "journal-metrics" folder; every table there is imported once (also files you put there yourself)."""
    s = get_settings(db)
    SJR_DIR.mkdir(parents=True, exist_ok=True)
    if sweep_downloads:
        try:
            files = [f for f in WATCHER.folder(s).iterdir() if f.is_file() and SJR_FILE_RE.match(f.name)]
        except OSError:
            files = []
        for f in files:
            try:
                if time.time() - f.stat().st_mtime < 1.5:
                    continue  # still being written
                m = SJR_FILE_RE.match(f.name)
                name = re.sub(r" ?\(\d+\)(?=\.\w+$)", "", f.name)  # "scimagojr 2019 (1).csv" -> "scimagojr 2019.csv"
                dest = SJR_DIR / name
                if dest.exists():
                    dest.unlink()
                shutil.move(str(f), str(dest))
                logging.getLogger("papershelf").info("SCImago %s moved to %s", m.group(1), dest)
            except OSError as exc:
                logging.getLogger("papershelf").warning("SCImago file %s not moved: %s", f.name, exc)
    try:
        known = json.loads(s.get("sjr_files") or "{}")
    except ValueError:
        known = {}
    done = []
    for f in sorted(SJR_DIR.iterdir()):
        m = SJR_FILE_RE.match(f.name)
        if not (m and f.is_file()):
            continue
        st = f.stat()
        sig = f"{int(st.st_mtime)}:{st.st_size}"
        if known.get(f.name) == sig:
            continue
        known[f.name] = sig
        try:
            journals.import_table(db, int(m.group(1)), f.read_bytes())
            done.append(int(m.group(1)))
        except (ValueError, OSError) as exc:
            logging.getLogger("papershelf").warning("SCImago file %s not imported: %s", f.name, exc)
    if done or known != json.loads(s.get("sjr_files") or "{}"):
        set_setting(db, "sjr_files", json.dumps(known))
        db.commit()
    return done


def sjr_watch_tick(db) -> list:  # kept for the tests of version 1.11
    return sjr_collect(db, sweep_downloads=True)


def sjr_watch_loop():
    """Pick up SCImago tables: every few seconds while you are downloading them, otherwise every 30 s
    (Downloads is looked at only if journal metrics are turned on or you asked for the tables)."""
    last = 0.0
    while not STOP.is_set():
        busy = time.time() < SJR_WAIT["until"]
        if busy or time.time() - last > 30:
            last = time.time()
            db = connect()
            try:
                sweep = busy or get_settings(db).get("sjr_auto") == "1"
                sjr_collect(db, sweep_downloads=sweep)
            except Exception as exc:  # noqa: BLE001 - background task
                logging.getLogger("papershelf").warning("SCImago watch failed: %s", exc)
            finally:
                db.close()
        STOP.wait(2.5)


@app.post("/api/sjr/import")
def sjr_import():
    """Import one or more SCImago tables downloaded by hand. The year is read from the file name
    ("scimagojr 2024.csv") unless given."""
    files = request.files.getlist("file")
    if not files:
        return error("Choose the SCImago file(s) first.")
    given = _int(request.form.get("year"))
    done, problems = [], []
    for f in files:
        year = given if (given and len(files) == 1) else journals.year_from_filename(f.filename)
        if not year:
            problems.append(f"{f.filename}: the year isn't in the file name – import it alone and type the year.")
            continue
        try:
            done.append({"year": year, "journals": journals.import_table(get_db(), year, f.read())})
        except ValueError as exc:
            problems.append(f"{f.filename}: {exc}")
    if not done:
        return error(" ".join(problems) or "Nothing imported.")
    return jsonify(imported=done, problems=problems, year=done[0]["year"], journals=done[0]["journals"])


def _cache_get(key):
    r = get_db().execute("SELECT data, fetched_at FROM oa_cache WHERE id=?", (key,)).fetchone()
    return json.loads(r["data"]) if r and r["fetched_at"] > time.time() - CACHE_DAYS * 86400 else None


def _cache_put(key, value):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO oa_cache VALUES (?, ?, ?)", (key, json.dumps(value), time.time()))
    db.commit()


@app.post("/api/journal-metrics")
def journal_metrics():
    b = request.get_json(silent=True) or {}
    db = get_db()
    items = [i for i in b.get("items") or [] if i.get("key")][:5000]
    out = journals.metrics_for(db, items)
    oa = {}
    sids = list(dict.fromkeys(s for s in b.get("openalex_sources") or [] if s))[:500]
    if sids:
        try:
            oa = journals.openalex_sources(db, sids, _cache_get, _cache_put)
        except (metadata.MetadataError, ValueError):
            oa = {}
    return jsonify(metrics=out, openalex=oa, loaded=journals.loaded_years(db), latest=journals.latest_year(),
                   failed={str(k): v for k, v in journals.failed_years(db).items()})


@app.put("/api/journal-jif")
def journal_jif():
    b = request.get_json(silent=True) or {}
    try:
        journals.set_manual_jif(get_db(), b.get("name"), _int(b.get("year")), b.get("value"))
    except (ValueError, TypeError) as exc:
        return error(str(exc))
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# API: export
# --------------------------------------------------------------------------- #
EXPORTS = {
    "txt": ("txt", "text/plain; charset=utf-8"),
    "rtf": ("rtf", "application/rtf"),
    "html": ("html", "text/html; charset=utf-8"),
    "bibtex": ("bib", "application/x-bibtex; charset=utf-8"),
    "ris": ("ris", "application/x-research-info-systems; charset=utf-8"),
    "csljson": ("json", "application/json; charset=utf-8"),
    "csv": ("csv", "text/csv; charset=utf-8"),
    # formats of the first version
    "apa_txt": ("txt", "text/plain; charset=utf-8"),
    "apa_rtf": ("rtf", "application/rtf"),
}


@app.post("/api/export")
def export():
    body = request.get_json(silent=True) or {}
    fmt = body.get("format", "txt")
    if fmt not in EXPORTS:
        return error("Unknown export format")
    db = get_db()
    style = body.get("style") or get_settings(db)["default_style"]
    if fmt.startswith("apa_"):
        style, fmt = "apa", fmt[4:]
    order = "list" if body.get("order") == "list" else "alpha"
    papers = load_papers(db, body.get("ids") or [])
    paths = group_paths(db)

    def tags_for(p):
        return [f"PaperShelf/{paths[g]}" for g in p.get("group_ids") or [] if g in paths] if body.get("group_tags") else []

    if fmt == "txt":
        content = citations.list_text(papers, style, order)
    elif fmt == "rtf":
        content = citations.list_rtf(papers, style, order)
    elif fmt == "html":
        content = citations.list_html(papers, style, order)
    elif fmt == "bibtex":
        content = citations.bibtex(papers, tags_for)
    elif fmt == "ris":
        content = citations.ris(papers, tags_for)
    elif fmt == "csljson":
        content = citations.csl_json(papers)
    else:
        content = citations.csv_export(papers, paths, style)
    ext, mime = EXPORTS[fmt]
    name = re.sub(r"[^\w\- ]+", "", body.get("name") or "references").strip().replace(" ", "_") or "references"
    return Response(content, mimetype=mime,
                    headers={"Content-Disposition": f'attachment; filename="{name}.{ext}"'})


# --------------------------------------------------------------------------- #
# API: settings and sync
# --------------------------------------------------------------------------- #
@app.get("/api/settings")
def read_settings():
    return jsonify(settings=get_settings(secrets=False), data_dir=str(HOME))


@app.put("/api/settings")
def write_settings():
    body = request.get_json(silent=True) or {}
    db = get_db()
    name_changed = False
    if "email" in body:
        email = (body.get("email") or "").strip()
        if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return error("That e-mail address doesn't look valid.")
        set_setting(db, "email", email)
    if "pdf_dir" in body:
        folder = Path((body.get("pdf_dir") or "").strip() or DEFAULT_PDF_DIR).expanduser()
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return error(f"Can't use that folder: {exc}")
        set_setting(db, "pdf_dir", str(folder))
    if body.get("default_style") in citations.STYLES:
        set_setting(db, "default_style", body["default_style"])
    if "sync_repo" in body:
        set_setting(db, "sync_repo", (body.get("sync_repo") or "").strip())
    if body.get("sync_token") is not None and body.get("sync_token") != "":
        set_setting(db, "sync_token", body["sync_token"].strip())
    if body.get("clear_sync_token"):
        set_setting(db, "sync_token", "")
    for key in ("sync_pdfs", "sync_auto", "auto_import", "remove_downloads", "sjr_auto", "update_check", "update_auto", "own_window", "share_auto"):
        if key in body:
            set_setting(db, key, "1" if body[key] else "")
    if body.get("openalex_key") is not None and body.get("openalex_key") != "":
        set_setting(db, "openalex_key", body["openalex_key"].strip())
    if body.get("clear_openalex_key"):
        set_setting(db, "openalex_key", "")
    if body.get("core_key") is not None and body.get("core_key") != "":
        set_setting(db, "core_key", body["core_key"].strip())
    if body.get("clear_core_key"):
        set_setting(db, "core_key", "")
    if "display_name" in body:
        dn = " ".join(str(body.get("display_name") or "").split())[:60]
        if dn != get_settings(db).get("display_name"):
            set_setting(db, "display_name", dn)
            name_changed = True
    if "share_repo" in body:
        repo = _share_repo_value(body.get("share_repo"))
        if repo is None:
            return error("Write your sharing repository as  your-github-name/papershelf-shared")
        set_setting(db, "share_repo", repo)
    if body.get("share_token") is not None and body.get("share_token") != "":
        set_setting(db, "share_token", body["share_token"].strip())
    if body.get("clear_share_token"):
        set_setting(db, "share_token", "")
    if "watch_dir" in body:
        set_setting(db, "watch_dir", str(Path((body.get("watch_dir") or "").strip() or Path.home() / "Downloads").expanduser()))
    if isinstance(body.get("proxies"), list):
        clean = []
        for px in body["proxies"]:
            tpl = (px.get("template") or "").strip()
            if not tpl.startswith(("http://", "https://")):
                return error("A library access address must start with https://")
            clean.append({"id": px.get("id") or new_uid()[:8], "name": (px.get("name") or "My library").strip(),
                          "template": tpl})
        set_setting(db, "proxies", json.dumps(clean))
    db.commit()
    if name_changed:  # your new name reaches the members of your shared labels
        ident = share_identity(db)
        for row in db.execute("SELECT id, state FROM shares").fetchall():
            st = json.loads(row["state"])
            me = _my_author(st, ident)
            if me and sharing.set_profile(st, me, get_settings(db)["display_name"]):
                _save_share(db, row["id"], st)
                db.commit()
                publish_soon(row["id"])
    return jsonify(settings=get_settings(db, secrets=False))


def run_sync(db) -> dict:
    if not sync_lock.acquire(blocking=False):
        raise syncmod.SyncError("A sync is already running.")
    try:
        stats = syncmod.sync(db, HOME, get_settings(db))
        set_setting(db, "last_sync", now())
        set_setting(db, "last_sync_error", "")
        db.commit()
        return stats
    except syncmod.SyncError as exc:
        set_setting(db, "last_sync_error", str(exc))
        db.commit()
        raise
    finally:
        sync_lock.release()


@app.post("/api/sync/test")
def sync_test():
    """Check the GitHub address and token (settings may be passed unsaved, to test before saving)."""
    db = get_db()
    s = get_settings(db)
    b = request.get_json(silent=True) or {}
    if b.get("sync_repo"):
        s["sync_repo"] = b["sync_repo"].strip()
    if b.get("sync_token"):
        s["sync_token"] = b["sync_token"].strip()
    try:
        return jsonify(syncmod.test_connection(HOME, s))
    except syncmod.SyncError as exc:
        return error(str(exc), 502)


@app.get("/api/diagnostics")
def diagnostics():
    """System check shown in Help: what works and what needs attention."""
    db = get_db()
    s = get_settings(db)
    checks = []

    def add(name, ok, detail, help_id=""):
        checks.append({"name": name, "ok": ok, "detail": detail, "help": help_id})

    add("PaperShelf", True, f"version {APP_VERSION}, Python {sys.version.split()[0]}")
    ucfg = updater.config()
    add("Updates", bool(ucfg["repo"]), (f"checked on github.com/{ucfg['repo']}" + (" (git copy: updates with git pull)"
        if updater.is_git_checkout() else "")) if ucfg["repo"] else "no update source set in update.json", "updates")
    n = db.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    add("Library", True, f"{n} papers in {DB_PATH}")
    pdf_dir = Path(s["pdf_dir"])
    try:
        pdf_dir.mkdir(parents=True, exist_ok=True)
        probe = pdf_dir / ".papershelf-write-test"
        probe.write_text("ok")
        probe.unlink()
        add("PDF folder", True, str(pdf_dir))
    except OSError as exc:
        add("PDF folder", False, f"Can't write to {pdf_dir}: {exc}", "troubleshooting")
    try:
        __import__("pypdf")
        add("PDF reading library", True, "installed")
    except ImportError:
        add("PDF reading library", False, "pypdf is missing: restart with start.command / start.bat", "troubleshooting")
    watch = Path(s.get("watch_dir") or Path.home() / "Downloads")
    try:
        next(iter(os.scandir(watch)), None)
        add("Downloads folder", True, f"{watch} can be read (needed to attach PDFs you download)")
    except OSError as exc:
        add("Downloads folder", False, f"{watch} can't be read ({exc.__class__.__name__}). On a Mac allow Terminal "
            "in System Settings → Privacy & Security → Files and Folders.", "university")
    add("Unpaywall e-mail", bool(s.get("email")), "set" if s.get("email") else "not set – optional, finds more free PDFs", "keys")
    add("OpenAlex key", bool(s.get("openalex_key")), "set" if s.get("openalex_key") else
        "not set – optional, raises the daily limit for citations, suggestions and profiles", "keys")
    ident = share_identity(db)
    nsh = db.execute("SELECT COUNT(*) FROM shares").fetchone()[0]
    bad = [r["last_error"] for r in db.execute("SELECT last_error FROM shares WHERE last_error != ''")]
    add("Shared labels", not bad, (f"{nsh} shared label(s)" + (f", shared through the gist of {ident['user']}" if ident["can_publish"] else
        ", not publishing (only following)") + (f" – {bad[0]}" if bad else "")) if nsh or ident["repo"] else "not used (optional)", "sharing")
    gs = syncmod.git_status()
    add("Git (for GitHub sync)", gs["ok"], gs["version"] or gs["error"], "sync")
    if s.get("sync_repo"):
        ok = not s.get("last_sync_error")
        add("GitHub sync", ok, (f"last sync {s['last_sync']}" if s.get("last_sync") else "configured, not synced yet")
            if ok else s["last_sync_error"], "sync")
    else:
        add("GitHub sync", True, "not used (optional)", "sync")
    return jsonify(checks=checks, version=APP_VERSION, data_dir=str(HOME), app_dir=str(BASE_DIR))


@app.post("/api/sync")
def sync_now():
    db = get_db()
    try:
        stats = run_sync(db)
    except syncmod.SyncError as exc:
        return error(str(exc), 409 if "already running" in str(exc) else 502)
    return jsonify(stats=stats, settings=get_settings(db, secrets=False))


def auto_sync_loop():
    """Sync at start-up and every 20 minutes when "Sync automatically" is on."""
    if STOP.wait(3):
        return
    while not STOP.is_set():
        db = connect()
        try:
            if get_settings(db).get("sync_auto") == "1" and get_settings(db).get("sync_repo"):
                run_sync(db)
        except Exception as exc:  # noqa: BLE001 - background task must never die
            logging.getLogger("papershelf").warning("auto-sync failed: %s", exc)
        finally:
            db.close()
        STOP.wait(20 * 60)


@app.post("/api/open-folder")
def open_folder():
    folder = Path(get_settings()["pdf_dir"])
    folder.mkdir(parents=True, exist_ok=True)
    open_path(str(folder))
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Start
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# Updates (see updater.py)
# --------------------------------------------------------------------------- #
UPDATE_CACHE_HOURS = 12
BACKUP_DIR = HOME / "backups"
SERVER = {"srv": None, "restart": False}
STOP = threading.Event()  # tells the background tasks to end (before a restart)


@app.get("/api/version")
def api_version():
    return jsonify(version=APP_VERSION)


@app.get("/api/update/check")
def update_check():
    """Ask GitHub whether a newer version exists. Cached for 12 hours unless ?force=1."""
    db = get_db()
    s = get_settings(db)
    force = request.args.get("force") == "1"
    if not force and request.args.get("auto") == "1" and s.get("update_check") != "1":
        return jsonify(skipped=True, current=APP_VERSION)
    if not force:
        try:
            cached = json.loads(s.get("update_cache") or "{}")
        except ValueError:
            cached = {}
        if cached.get("current") == APP_VERSION and time.time() - cached.get("ts", 0) < UPDATE_CACHE_HOURS * 3600:
            return jsonify({**cached, "cached_result": True})
    try:
        info = updater.check(current=APP_VERSION)
    except updater.UpdateError as exc:
        return error(str(exc), 502)
    info["ts"] = time.time()
    set_setting(db, "update_cache", json.dumps(info))
    db.commit()
    return jsonify(info)


def _remember_update(db, res, notes=""):
    set_setting(db, "just_updated", json.dumps({"version": res.get("installed"), "previous": res.get("previous"),
                                                "notes": notes or "", "warning": res.get("warning", "")}))


def _after_install(res, notes=""):
    db = get_db()
    _remember_update(db, res, notes)
    set_setting(db, "update_cache", "")
    db.commit()
    res["restart"] = res.get("installed") != APP_VERSION or bool(res.get("git"))
    return jsonify(res)


@app.post("/api/update/install")
def update_install():
    try:
        info = updater.check(current=APP_VERSION)
        if not info.get("available") and not info.get("git"):
            return error(f"You already have the latest version ({APP_VERSION}).")
        return _after_install(updater.install(info, BACKUP_DIR), info.get("notes", ""))
    except updater.UpdateError as exc:
        return error(str(exc), 502)


@app.post("/api/update/upload")
def update_upload():
    """Install a version from a zip file the user downloaded themselves (e.g. from the Releases page)."""
    f = request.files.get("file")
    if not f:
        return error("Choose the PaperShelf .zip file first.")
    data = f.read(updater.MAX_ZIP + 1)
    if len(data) > updater.MAX_ZIP:
        return error("That file is too large to be a PaperShelf version.")
    try:
        return _after_install(updater.install_zip(data, BACKUP_DIR))
    except updater.UpdateError as exc:
        return error(str(exc), 422)


@app.post("/api/update/seen")
def update_seen():
    db = get_db()
    set_setting(db, "just_updated", "")
    db.commit()
    return jsonify(ok=True)


def startup_update(open_browser: bool):
    """Install a new version before the app starts, when "Install updates automatically" is on (default).
    Quick and silent when offline; never blocks the start for more than a few seconds."""
    if updater.is_git_checkout():
        return  # git copies are updated by the start file (git pull)
    db = connect()
    try:
        s = get_settings(db)
        if s.get("update_auto") != "1" or s.get("update_check") != "1":
            return
        try:
            cached = json.loads(s.get("update_cache") or "{}")
        except ValueError:
            cached = {}
        if (cached.get("current") == APP_VERSION and not cached.get("available")
                and time.time() - cached.get("ts", 0) < 6 * 3600):
            return
        info = updater.check(current=APP_VERSION, timeout=6)
        info["ts"] = time.time()
        set_setting(db, "update_cache", json.dumps(info))
        db.commit()
        if not info.get("available"):
            return
        print(f"  Installing PaperShelf {info['latest']} (you had {APP_VERSION})...")
        res = updater.install(info, BACKUP_DIR)
        _remember_update(db, res, info.get("notes", ""))
        set_setting(db, "update_cache", "")
        db.commit()
    except Exception as exc:  # noqa: BLE001 - an update problem must never stop the app from starting
        print(f"  (Update check skipped: {exc})")
        return
    finally:
        db.close()
    print("  Done - starting the new version.\n")
    updater.relaunch(browser=open_browser)


@app.post("/api/update/restart")
def update_restart():
    if SERVER["srv"] is None:
        return error("Restart PaperShelf yourself: close its window and open the start file again.", 409)
    SERVER["restart"] = True
    threading.Timer(0.6, SERVER["srv"].shutdown).start()
    return jsonify(ok=True)


@app.post("/api/shortcut")
def make_shortcut():
    """Create the PaperShelf icon (Mac: Applications + Desktop; Windows: Desktop + Start menu)."""
    b = request.get_json(silent=True) or {}
    port = request.host.rsplit(":", 1)[-1] if ":" in (request.host or "") else PORT
    try:
        res = launcher.create_shortcut(int(port), LOG_PATH, APP_VERSION, desktop=b.get("desktop", True) is not False)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return error(f"The icon could not be created: {exc}", 500)
    return jsonify(res)


@app.post("/api/quit")
def quit_app():
    """Stop PaperShelf (useful when it runs in the background, started from its icon)."""
    if SERVER["srv"] is None:
        return error("Close the PaperShelf Terminal / command window to stop it.", 409)
    threading.Timer(0.5, SERVER["srv"].shutdown).start()
    return jsonify(ok=True)


@app.get("/manifest.webmanifest")
def web_manifest():
    data = {"name": "PaperShelf", "short_name": "PaperShelf", "start_url": "/", "scope": "/", "display": "standalone",
            "background_color": "#f5f4f0", "theme_color": "#2e7d55",
            "description": "Your private library of scientific papers",
            "icons": [{"src": f"/static/icons/icon-{n}.png", "sizes": f"{n}x{n}", "type": "image/png"} for n in (192, 512)]}
    return Response(json.dumps(data), mimetype="application/manifest+json")


@app.post("/api/open-backups")
def open_backups():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    open_path(str(BACKUP_DIR))
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Shared lists between users (see sharing.py)
# --------------------------------------------------------------------------- #
share_lock = threading.Lock()
SHARE_BACKGROUND = True  # tests turn this off


def _share_repo_value(v):
    """'name', 'name/repo' or a github.com link -> 'name/repo' ('' to clear, None if invalid)."""
    v = (v or "").strip().strip("/")
    if not v:
        return ""
    v = re.sub(r"^https?://github\.com/", "", v).removesuffix(".git")
    if "/" not in v:
        v = f"{v}/{sharing.DEFAULT_REPO_NAME}"
    return v if sharing.REPO_RE.match(v) else None


def share_identity(db) -> dict:
    """Who you are for sharing: your GitHub name and your shared-labels gist (set up in Settings)."""
    s = get_settings(db)
    if not s.get("install_id"):
        set_setting(db, "install_id", uuid.uuid4().hex[:10])
        db.commit()
        s["install_id"] = get_settings(db)["install_id"]
    token = s.get("share_token") or s.get("sync_token") or ""
    user, gist = s.get("share_user") or "", s.get("share_gist") or ""
    src = f"gist:{gist}" if gist else ""
    return {"user": user, "src": src, "repo": src, "token": token, "local": "local-" + s["install_id"],
            "can_publish": bool(user and gist and token)}

def _load_share(db, sid):
    row = db.execute("SELECT * FROM shares WHERE id=?", (sid,)).fetchone()
    if not row:
        return None, None
    return row, json.loads(row["state"])


def _save_share(db, sid, st, **fields):
    sets, vals = ["state=?"], [json.dumps(st, ensure_ascii=False)]
    for k, v in fields.items():
        sets.append(f"{k}=?")
        vals.append(v)
    db.execute(f"UPDATE shares SET {', '.join(sets)} WHERE id=?", vals + [sid])


def _my_author(st, ident) -> str | None:
    """The name under which I edit this list, or None if I'm only following it."""
    mem = sharing.members(st)
    if ident["user"] and ident["user"] in mem:
        return ident["user"]
    if ident["local"] in mem:
        return ident["user"] if ident["can_publish"] else ident["local"]
    return None


def _share_meta(p: dict) -> dict:
    return {k: p.get(k) for k in sharing.META_KEYS}


def _local_index(db):
    by_doi, by_arxiv, by_title = {}, {}, {}
    for r in db.execute("SELECT id, doi, arxiv_id, title, year FROM papers"):
        if r["doi"]:
            by_doi.setdefault(r["doi"].strip().lower(), r["id"])
        if r["arxiv_id"]:
            by_arxiv.setdefault(re.sub(r"v\d+$", "", r["arxiv_id"].strip().lower()), r["id"])
        t = sharing.norm_title(r["title"])
        if t:
            by_title.setdefault((t, r["year"]), r["id"])
            by_title.setdefault((t, None), r["id"])
    return by_doi, by_arxiv, by_title


def _find_local(idx, meta):
    by_doi, by_arxiv, by_title = idx
    doi = (meta.get("doi") or "").strip().lower()
    if doi and doi in by_doi:
        return by_doi[doi]
    ax = re.sub(r"v\d+$", "", (meta.get("arxiv_id") or "").strip().lower())
    if ax and ax in by_arxiv:
        return by_arxiv[ax]
    t = sharing.norm_title(meta.get("title"))
    if t and len(t) > 15:
        return by_title.get((t, meta.get("year"))) or (by_title.get((t, None)) if not doi else None)
    return None


def materialize_share(db, sid, st, group_id=None) -> dict:
    """Make the library match the list: new papers are added (with the list's label), papers removed
    from the list only lose the label - they stay in the library."""
    stats = {"added": 0, "tagged": 0, "untagged": 0}
    idx = _local_index(db)
    current = {r["item_key"]: r["paper_id"] for r in db.execute("SELECT * FROM paper_shares WHERE share_id=?", (sid,))}
    dismissed = {r["item_key"]: r["lamport"] for r in db.execute("SELECT * FROM share_dismissed WHERE share_id=?", (sid,))}
    live = sharing.items(st)
    group_ok = group_exists(db, group_id)
    for key, e in live.items():
        if key in current:
            continue
        if key in dismissed and e["add"][0] <= dismissed[key]:
            continue  # you took it out (only for you); it comes back only if someone adds it again
        pid = _find_local(idx, e["meta"])
        if pid is None:
            meta = metadata.empty_meta()
            meta.update({k: v for k, v in e["meta"].items() if v not in (None, "")})
            if meta.get("doi") and not meta.get("url"):
                meta["url"] = f"https://doi.org/{meta['doi']}"
            pid, _ = insert_paper(db, meta, group_id if group_ok else None)
            stats["added"] += 1
            idx = _local_index(db) if stats["added"] % 50 == 0 else idx
            if meta.get("doi"):
                idx[0][meta["doi"].lower()] = pid
        else:
            stats["tagged"] += 1
            if group_ok:
                db.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, group_id))
        db.execute("INSERT OR REPLACE INTO paper_shares VALUES (?, ?, ?)", (pid, sid, key))
        current[key] = pid
    for key, pid in list(current.items()):
        if key not in live:
            db.execute("DELETE FROM paper_shares WHERE share_id=? AND item_key=?", (sid, key))
            stats["untagged"] += 1
    db.commit()
    return stats


def share_forget_papers(db, ids, unshare=True) -> set:
    """Before papers are deleted from the library: remove them from the lists you edit (others keep
    their copy, without the label) or, if you follow the list or unshare is off, remember not to
    bring them back."""
    touched = set()
    if not ids:
        return touched
    ident = share_identity(db)
    q = f"SELECT * FROM paper_shares WHERE paper_id IN ({','.join('?' * len(ids))})"
    for r in db.execute(q, ids).fetchall():
        row, st = _load_share(db, r["share_id"])
        if not st:
            continue
        e = st["items"].get(r["item_key"])
        author = _my_author(st, ident)
        if unshare and author and e is not None:
            sharing.remove_item(st, author, r["item_key"])
            _save_share(db, r["share_id"], st)
            touched.add(r["share_id"])
        elif e is not None and e.get("add"):
            db.execute("INSERT OR REPLACE INTO share_dismissed VALUES (?, ?, ?)", (r["share_id"], r["item_key"], e["add"][0]))
    return touched


def _origin(row):
    """(owner, source) of the place a list was joined from."""
    o = row["origin"] or ""
    if "|" in o:
        owner, src = o.split("|", 1)
        return owner, src
    return (o.split("/")[0], o) if o else ("", "")


def share_summary_one(db, row, st, ident) -> dict:
    sm = sharing.summary(st)
    author = _my_author(st, ident)
    local = db.execute("SELECT COUNT(*) FROM paper_shares WHERE share_id=?", (row["id"],)).fetchone()[0]
    if author and ident["can_publish"]:
        code = sharing.make_code(ident["user"], ident["src"], row["id"])
    else:
        owner, src = _origin(row)
        if not owner:
            owner, src = next(((n, rp) for n, rp in sm["members"].items() if rp), ("", ""))
        code = sharing.make_code(owner, src, row["id"]) if owner and src else ""
    you = {ident["user"], ident["local"]} - {""}
    prof = sharing.profiles(st)
    return {**sm, "members": [{"name": n, "display": prof.get(n, ""), "joined": bool(rp), "you": n in you}
                              for n, rp in sorted(sm["members"].items())],
            "people": [{**p, "you": p["id"] in you} for p in sm["people"]],
            "role": "member" if author else "follower", "can_publish": ident["can_publish"], "local_papers": local,
            "group_id": row["group_id"], "color": row["color"] if "color" in row.keys() else "", "origin": row["origin"], "last_pull": row["last_pull"],
            "last_push": row["last_push"], "last_error": row["last_error"], "code": code,
            "published": bool(row["published_hash"])}

def shares_summary(db) -> list:
    ident = share_identity(db)
    out = []
    for row in db.execute("SELECT * FROM shares ORDER BY added_at"):
        try:
            out.append(share_summary_one(db, row, json.loads(row["state"]), ident))
        except (ValueError, KeyError):
            continue
    return sorted(out, key=lambda x: x["name"].lower())


def _index_entries(db, gh, ident, drop=()):
    """index.json of your gist: the shared labels you are a member of (kept across your computers)."""
    try:
        old = gh.read_src(ident["user"], ident["src"], "index", fresh=True) or {}
    except sharing.ShareError:
        old = {}
    lists = {x.get("id"): x for x in (old.get("lists") or []) if isinstance(x, dict) and x.get("id") not in drop}
    for row in db.execute("SELECT id, state FROM shares").fetchall():
        st = json.loads(row["state"])
        if row["id"] in drop:
            continue
        if ident["user"] in sharing.members(st):
            sm = sharing.summary(st)
            lists[row["id"]] = {"id": row["id"], "name": sm["name"], "description": sm["description"],
                                "papers": sm["papers"], "members": sorted(sm["members"]), "updated_at": sm["updated_at"]}
        elif row["id"] in lists:
            lists.pop(row["id"])  # you left it
    return {"papershelf_shared": sharing.FORMAT, "owner": ident["user"],
            "lists": sorted(lists.values(), key=lambda x: (x.get("name") or "").lower())}


def _publish(db, gh, ident, sid, st, drop=()):
    files = {} if sid in drop else {sharing.file_for(ident["src"], "list", sid): st}
    if sid in drop:
        files[sharing.file_for(ident["src"], "list", sid)] = st  # the copy that says you left
    files["index.json"] = _index_entries(db, gh, ident, drop)
    gh.publish(ident["src"], files)

def _apply_join_comments(st, sid, ident, joins):
    """Members who joined left a signed comment on your gist with the address of their own gist."""
    author = _my_author(st, ident)
    mem = sharing.members(st)
    for j in joins:
        if j["list"] == sid and j["member"] in mem and mem[j["member"]] != j["src"] and author:
            sharing.set_member(st, author, j["member"], j["src"])
            j["used"] = True


def sync_share(db, sid, ident=None, gh=None, joins=()) -> dict:
    """Read every member's copy of the list, merge, update the library and publish your copy."""
    ident = ident or share_identity(db)
    gh = gh or sharing.GitHub(ident["token"])
    row, st = _load_share(db, sid)
    if not st:
        raise sharing.ShareError("Shared label not found.")
    me = _my_author(st, ident)
    errors, authority = [], [(me, json.loads(json.dumps(st)))] if me else []  # your own copy decides about your notes
    sources = {(n, rp) for n, rp in sharing.members(st).items() if rp}
    o_owner, o_src = _origin(row)
    if o_src:
        sources.add((o_owner, o_src))
    for owner, src in sorted(sources):
        try:
            data = gh.read_src(owner, src, "list", sid, fresh=src == ident["src"])
            if data is None:
                if src != ident["src"]:
                    errors.append(f"{owner} hasn't published this label yet")
                continue
            data = sharing.validate(data)
            st = sharing.merge(st, data)
            if src != ident["src"] and owner:
                authority.append((owner, data))
        except sharing.ShareError as exc:
            errors.append(f"{owner}: {exc}")
    for owner, data in authority:  # each member's own copy decides about that member's notes
        sharing.trust_author_copy(st, owner, data)
    _apply_join_comments(st, sid, ident, joins)
    mem = sharing.members(st)
    announce = False
    if ident["can_publish"]:
        if ident["local"] in mem and ident["user"] not in mem:
            sharing.set_member(st, ident["user"], ident["user"], ident["src"])  # you started publishing
        elif ident["user"] in mem and mem[ident["user"]] != ident["src"]:
            sharing.set_member(st, ident["user"], ident["user"], ident["src"])  # you just joined as a member
            announce = True
    me = _my_author(st, ident)
    dn = get_settings(db).get("display_name") or ""
    if me and dn:
        sharing.set_profile(st, me, dn)  # the others see the name you chose (only changes when you change it)
    stats = materialize_share(db, sid, st, row["group_id"])
    fields = {"last_pull": now(), "last_error": "; ".join(errors)[:500]}
    published = False
    if ident["can_publish"] and ident["user"] in sharing.members(st):
        st["publisher"] = ident["user"]
        h = uuid.uuid5(uuid.NAMESPACE_OID, json.dumps({k: v for k, v in st.items() if k not in ("updated_at", "publisher")},
                                                       sort_keys=True)).hex
        if h != row["published_hash"]:
            try:
                _publish(db, gh, ident, sid, st)
                fields.update(published_hash=h, last_push=now())
                published = True
            except sharing.ShareError as exc:
                fields["last_error"] = (fields["last_error"] + "; " if fields["last_error"] else "") + f"publishing: {exc}"
        if announce:  # tell the others where your copy is
            for name, src in sharing.members(st).items():
                if name != ident["user"] and sharing.is_gist(src):
                    try:
                        gh.comment(src, sharing.join_comment(ident["user"], ident["src"], sid))
                    except sharing.ShareError as exc:
                        errors.append(str(exc))
            if o_src and sharing.is_gist(o_src) and o_owner != ident["user"] and o_src not in sharing.members(st).values():
                try:
                    gh.comment(o_src, sharing.join_comment(ident["user"], ident["src"], sid))
                except sharing.ShareError:
                    pass
    _save_share(db, sid, st, **fields)
    db.commit()
    return {**stats, "published": published, "errors": errors}

def restore_my_shares(db, ident, gh) -> int:
    """On another of your computers: rejoin the shared labels kept in your own gist."""
    if not ident["can_publish"]:
        return 0
    idx = gh.read_src(ident["user"], ident["src"], "index", fresh=True) or {}
    n = 0
    have = {r["id"] for r in db.execute("SELECT id FROM shares")}
    for x in idx.get("lists") or []:
        lid = str((x or {}).get("id") or "")
        if not sharing.ID_RE.match(lid) or lid in have:
            continue
        data = gh.read_src(ident["user"], ident["src"], "list", lid, fresh=True)
        if not data:
            continue
        st = sharing.validate(data)
        if ident["user"] not in sharing.members(st):
            continue
        db.execute("INSERT INTO shares (id, state, origin, added_at) VALUES (?, ?, ?, ?)",
                   (lid, json.dumps(st), f"{ident['user']}|{ident['src']}", now()))
        n += 1
    db.commit()
    return n

def sync_all_shares(db, only=None) -> dict:
    if not share_lock.acquire(timeout=120):
        raise sharing.ShareError("Shared labels are already being updated.")
    try:
        ident = share_identity(db)
        gh = sharing.GitHub(ident["token"])
        restored = 0
        if only is None and ident["can_publish"]:
            try:
                restored = restore_my_shares(db, ident, gh)
            except sharing.ShareError:
                restored = 0
        joins = []
        if ident["can_publish"]:
            for c in gh.comments(ident["src"]):
                j = sharing.parse_join_comment(c["body"])
                if j and j["member"] == c["user"]:  # GitHub signs comments: nobody can join in someone else's name
                    joins.append({**j, "cid": c["id"]})
        res = {}
        ids = [only] if only else [r["id"] for r in db.execute("SELECT id FROM shares")]
        for sid in ids:
            try:
                res[sid] = sync_share(db, sid, ident, gh, joins)
            except sharing.ShareError as exc:
                db.execute("UPDATE shares SET last_error=? WHERE id=?", (str(exc)[:500], sid))
                db.commit()
                res[sid] = {"error": str(exc)}
        for j in joins:
            if j.get("used") or j["list"] not in {r[0] for r in db.execute("SELECT id FROM shares")}:
                try:
                    gh.delete_comment(ident["src"], j["cid"])
                except sharing.ShareError:
                    pass
        return {"lists": res, "restored": restored}
    finally:
        share_lock.release()

def publish_soon(sid):
    """After a change you made: merge and publish in the background."""
    if not SHARE_BACKGROUND:
        return

    def run():
        time.sleep(1.5)
        db = connect()
        try:
            if share_identity(db)["can_publish"]:
                sync_all_shares(db, only=sid)
        except Exception as exc:  # noqa: BLE001 - background task
            logging.getLogger("papershelf").warning("publishing list failed: %s", exc)
        finally:
            db.close()
    threading.Thread(target=run, daemon=True).start()


def share_loop():
    """Keep shared lists up to date: shortly after start and every 15 minutes."""
    if STOP.wait(8):
        return
    while not STOP.is_set():
        db = connect()
        try:
            s = get_settings(db)
            has = db.execute("SELECT COUNT(*) FROM shares").fetchone()[0]
            if s.get("share_auto") == "1" and (has or (s.get("share_repo") and s.get("share_token"))):
                sync_all_shares(db)
        except Exception as exc:  # noqa: BLE001
            logging.getLogger("papershelf").warning("shared lists update failed: %s", exc)
        finally:
            db.close()
        STOP.wait(15 * 60)


# --------------------------------------------------------------------------- #
# Notes: private (your library) and public (papers of a shared label)
# --------------------------------------------------------------------------- #
def _hidden_notes(db, sid=None) -> set:
    rows = db.execute("SELECT share_id, note_id FROM note_hidden" + (" WHERE share_id=?" if sid else ""), (sid,) if sid else ())
    return {(r[0], r[1]) for r in rows}


def public_note_counts(db) -> dict:
    """{paper_id: number of public notes you see} over all your shared labels."""
    hidden, states, out = _hidden_notes(db), {}, {}
    for pid, sid, key in db.execute("SELECT paper_id, share_id, item_key FROM paper_shares").fetchall():
        if sid not in states:
            row = db.execute("SELECT state FROM shares WHERE id=?", (sid,)).fetchone()
            try:
                states[sid] = json.loads(row[0]) if row else {}
            except ValueError:
                states[sid] = {}
        e = (states[sid].get("items") or {}).get(key)
        if e and e.get("notes"):
            n = sum(1 for x in sharing.notes_of(e) if (sid, x["id"]) not in hidden)
            if n:
                out[pid] = out.get(pid, 0) + n
    return out


def _display_name(db, ident=None) -> str:
    ident = ident or share_identity(db)
    return get_settings(db).get("display_name") or ident["user"] or ""


def _paper_public(db, pid, ident) -> list:
    out = []
    for r in db.execute("SELECT share_id, item_key FROM paper_shares WHERE paper_id=?", (pid,)).fetchall():
        row, st = _load_share(db, r["share_id"])
        if not st:
            continue
        e = st["items"].get(r["item_key"])
        if not e:
            continue
        author = _my_author(st, ident)
        hidden = _hidden_notes(db, r["share_id"])
        me = {ident["user"], ident["local"]} - {""}
        out.append({"share_id": r["share_id"], "share_name": (st.get("name") or {}).get("v") or "", "can_write": bool(author),
                    "notes": [{**{k: n.get(k) for k in ("id", "by", "name", "body", "created", "at")},
                               "mine": n.get("by") in me, "hidden": (r["share_id"], n["id"]) in hidden}
                              for n in sharing.notes_of(e)]})
    return sorted(out, key=lambda x: x["share_name"].lower())


def _private_notes(db, pid) -> list:
    row = db.execute("SELECT note_list FROM papers WHERE id=?", (pid,)).fetchone()
    return notesmod.load(row[0]) if row else []


def _set_private(db, pid, lst):
    db.execute("UPDATE papers SET note_list=?, notes=?, updated_at=? WHERE id=?",
               (json.dumps(lst, ensure_ascii=False), notesmod.plain(lst), now(), pid))


def _notes_payload(db, pid):
    ident = share_identity(db)
    pub = _paper_public(db, pid, ident)
    return jsonify(private=_private_notes(db, pid), public=pub, display_name=_display_name(db, ident),
                   name_set=bool(get_settings(db).get("display_name")),
                   counts={"private": len(_private_notes(db, pid)),
                           "public": sum(1 for g in pub for n in g["notes"] if not n["hidden"])})


def _public_target(db, pid, sid):
    """(state, item key, author) of a paper in a shared label, or an error response."""
    row, st = _load_share(db, sid)
    if not st:
        return None, None, None, error("Shared label not found.", 404)
    r = db.execute("SELECT item_key FROM paper_shares WHERE paper_id=? AND share_id=?", (pid, sid)).fetchone()
    if not r or r["item_key"] not in st["items"]:
        return None, None, None, error("This paper is not in that shared label.")
    return st, r["item_key"], _my_author(st, share_identity(db)), None


@app.get("/api/papers/<int:pid>/notes")
def paper_notes(pid):
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    return _notes_payload(db, pid)


@app.post("/api/papers/<int:pid>/notes")
def paper_note_add(pid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    if not load_paper(db, pid):
        return error("Paper not found", 404)
    body = str(b.get("body") or "").strip("\n")
    if not body.strip():
        return error("The note is empty.")
    sid = b.get("share_id") or ""
    if not sid:
        lst = _private_notes(db, pid)
        if len(lst) >= notesmod.MAX_NOTES:
            return error("Too many notes on this paper.")
        notesmod.add(lst, body)
        _set_private(db, pid, lst)
        db.commit()
        return _notes_payload(db, pid)
    st, key, author, err = _public_target(db, pid, sid)
    if err:
        return err
    if not author:
        return error("You follow this shared label but are not a member, so you can't write public notes in it.")
    sharing.add_note(st, author, key, body, _display_name(db))
    _save_share(db, sid, st)
    db.commit()
    publish_soon(sid)
    return _notes_payload(db, pid)


@app.put("/api/papers/<int:pid>/notes/<nid>")
def paper_note_edit(pid, nid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    body = str(b.get("body") or "").strip("\n")
    if not body.strip():
        return error("The note is empty.")
    sid = b.get("share_id") or ""
    if not sid:
        lst = _private_notes(db, pid)
        if not notesmod.edit(lst, nid, body):
            return error("Note not found.", 404)
        _set_private(db, pid, lst)
        db.commit()
        return _notes_payload(db, pid)
    st, key, author, err = _public_target(db, pid, sid)
    if err:
        return err
    try:
        sharing.edit_note(st, author or "", key, nid, body=body, name=_display_name(db))
    except sharing.ShareError as exc:
        return error(str(exc), 403)
    _save_share(db, sid, st)
    db.commit()
    publish_soon(sid)
    return _notes_payload(db, pid)


@app.delete("/api/papers/<int:pid>/notes/<nid>")
def paper_note_delete(pid, nid):
    """Private note: deleted. Your public note: deleted for everybody. Someone else's: hidden for you."""
    db = get_db()
    sid = request.args.get("share") or ""
    if not sid:
        lst = _private_notes(db, pid)
        if not notesmod.remove(lst, nid):
            return error("Note not found.", 404)
        _set_private(db, pid, lst)
        db.commit()
        return _notes_payload(db, pid)
    st, key, author, err = _public_target(db, pid, sid)
    if err:
        return err
    n = (st["items"][key].get("notes") or {}).get(nid)
    if not n:
        return error("Note not found.", 404)
    if author and n.get("by") == author:
        sharing.edit_note(st, author, key, nid, delete=True)
        _save_share(db, sid, st)
        db.execute("DELETE FROM note_hidden WHERE share_id=? AND note_id=?", (sid, nid))
        db.commit()
        publish_soon(sid)
    else:
        db.execute("INSERT OR IGNORE INTO note_hidden VALUES (?, ?)", (sid, nid))
        db.commit()
    return _notes_payload(db, pid)


@app.post("/api/papers/<int:pid>/notes/<nid>/hide")
def paper_note_hide(pid, nid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    sid = b.get("share_id") or ""
    if b.get("hidden", True):
        db.execute("INSERT OR IGNORE INTO note_hidden VALUES (?, ?)", (sid, nid))
    else:
        db.execute("DELETE FROM note_hidden WHERE share_id=? AND note_id=?", (sid, nid))
    db.commit()
    return _notes_payload(db, pid)


@app.post("/api/notes/export")
def notes_export():
    """The notes of the chosen papers, each under its reference: Markdown, plain text or a web page."""
    b = request.get_json(silent=True) or {}
    fmt = b.get("format") if b.get("format") in ("md", "txt", "html") else "md"
    db = get_db()
    style = b.get("style") or get_settings(db)["default_style"]
    want_private, want_public = b.get("private", True), b.get("public", True)
    only_with = bool(b.get("only_with_notes"))
    ident = share_identity(db)
    me = _display_name(db, ident) or "Me"
    entries = []
    for p in load_papers(db, b.get("ids") or []):
        lst = []
        if want_private:
            lst += [{"body": n["body"], "who": me, "date": (n.get("at") or n.get("created") or "")[:10],
                     "where": "private", "public": False, "_t": n.get("created") or ""} for n in notesmod.load(p.get("note_list"))]
        if want_public:
            for g_ in _paper_public(db, p["id"], ident):
                lst += [{"body": n["body"], "who": n.get("name") or n.get("by") or "", "date": (n.get("at") or "")[:10],
                         "where": f"public · {g_['share_name']}", "public": True, "_t": n.get("created") or ""}
                        for n in g_["notes"] if not n["hidden"]]
        lst.sort(key=lambda n: n["_t"])
        if only_with and not lst:
            continue
        entries.append({"ref": citations.cite_text(p, style), "notes": lst})
    title = (b.get("title") or "Notes").strip()[:120] or "Notes"
    content = notesmod.export(entries, fmt, title)
    name = re.sub(r"[^\w\- ]+", "", b.get("name") or "notes").strip().replace(" ", "_") or "notes"
    mime = {"md": "text/markdown", "txt": "text/plain", "html": "text/html"}[fmt]
    return Response(content, mimetype=mime + "; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.{fmt}"'})


def _share_or_404(db, sid):
    row, st = _load_share(db, sid)
    if not st:
        return None, None, (jsonify(error="Shared label not found."), 404)
    return row, st, None


@app.get("/api/shares")
def list_shares():
    db = get_db()
    ident = share_identity(db)
    return jsonify(shares=shares_summary(db), identity={"user": ident["user"], "gist": ident["src"],
                                                         "can_publish": ident["can_publish"]})


@app.post("/api/shares")
def create_share():
    """A new shared list, optionally filled with papers (e.g. those of a group or a selection)."""
    b = request.get_json(silent=True) or {}
    db = get_db()
    ident = share_identity(db)
    name = (b.get("name") or "").strip()
    if not name:
        return error("Give the shared label a name.")
    author = ident["user"] if ident["can_publish"] else ident["local"]
    st = sharing.new_state(name, author, ident["repo"] if ident["can_publish"] else "",
                           display_name=get_settings(db).get("display_name") or ident["user"])
    if b.get("description"):
        sharing.set_description(st, author, b["description"])
    if get_settings(db).get("display_name"):
        sharing.set_profile(st, author, get_settings(db)["display_name"])
    ids = [int(i) for i in b.get("paper_ids") or []]
    if b.get("from_group"):
        gids = group_descendants(db, int(b["from_group"]))
        ids += [r[0] for r in db.execute(
            f"SELECT DISTINCT paper_id FROM paper_collections WHERE collection_id IN ({','.join('?' * len(gids))})", list(gids))]
    papers = load_papers(db, list(dict.fromkeys(ids)))
    db.execute("INSERT INTO shares (id, state, origin, added_at) VALUES (?, ?, '', ?)", (st["id"], "{}", now()))
    for p in papers:
        key = sharing.add_item(st, author, _share_meta(p))
        db.execute("INSERT OR REPLACE INTO paper_shares VALUES (?, ?, ?)", (p["id"], st["id"], key))
    _save_share(db, st["id"], st)
    db.commit()
    publish_soon(st["id"])
    row, _ = _load_share(db, st["id"])
    return jsonify(share=share_summary_one(db, row, st, ident), papers=load_papers(db, [p["id"] for p in papers]))


@app.put("/api/shares/<sid>")
def update_share(sid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    row, st, err = _share_or_404(db, sid)
    if err:
        return err
    ident = share_identity(db)
    author = _my_author(st, ident)
    if ("name" in b or "description" in b) and not author:
        return error("Only members can rename this shared label. You are following it.")
    if "name" in b and (b["name"] or "").strip() and b["name"].strip() != st["name"]["v"]:
        sharing.set_name(st, author, b["name"])
    if "description" in b and (b["description"] or "") != st["description"]["v"]:
        sharing.set_description(st, author, b["description"])
    if "group_id" in b:
        gid = _int(b.get("group_id"))
        db.execute("UPDATE shares SET group_id=? WHERE id=?", (gid if group_exists(db, gid) else None, sid))
    if "color" in b and (b.get("color") or "") in LABEL_COLORS:
        db.execute("UPDATE shares SET color=? WHERE id=?", (b.get("color") or "", sid))  # only on this computer
    _save_share(db, sid, st)
    db.commit()
    if author:
        publish_soon(sid)
    row, st = _load_share(db, sid)
    return jsonify(share=share_summary_one(db, row, st, ident))


@app.delete("/api/shares/<sid>")
def leave_share(sid):
    """Stop sharing / following: the papers stay in your library, only the label goes."""
    db = get_db()
    row, st, err = _share_or_404(db, sid)
    if err:
        return err
    ident = share_identity(db)
    author = _my_author(st, ident)
    if author and ident["can_publish"]:
        sharing.set_member(st, author, author, remove=True)
        try:
            _publish(db, sharing.GitHub(ident["token"]), ident, sid, st, drop={sid})
        except sharing.ShareError as exc:
            app.logger.warning("could not publish leaving: %s", exc)
    db.execute("DELETE FROM shares WHERE id=?", (sid,))
    db.execute("DELETE FROM share_dismissed WHERE share_id=?", (sid,))
    db.execute("DELETE FROM note_hidden WHERE share_id=?", (sid,))
    db.commit()
    return jsonify(ok=True)

@app.post("/api/shares/<sid>/papers")
def share_papers(sid):
    """Add papers to a list, or take them out (for everyone if you edit it, only for you if you follow it)."""
    b = request.get_json(silent=True) or {}
    db = get_db()
    row, st, err = _share_or_404(db, sid)
    if err:
        return err
    ident = share_identity(db)
    author = _my_author(st, ident)
    ids = [int(i) for i in b.get("paper_ids") or []]
    remove = b.get("action") == "remove"
    if not remove and not author:
        return error("You follow this shared label but are not a member, so you can't add papers. Ask a member to add "
                     "your GitHub name, then join again with the code.")
    for p in load_papers(db, ids):
        if remove:
            r = db.execute("SELECT item_key FROM paper_shares WHERE paper_id=? AND share_id=?", (p["id"], sid)).fetchone()
            if not r:
                continue
            if author:
                sharing.remove_item(st, author, r["item_key"])
            else:
                e = st["items"].get(r["item_key"]) or {}
                db.execute("INSERT OR REPLACE INTO share_dismissed VALUES (?, ?, ?)",
                           (sid, r["item_key"], (e.get("add") or [0])[0]))
            db.execute("DELETE FROM paper_shares WHERE paper_id=? AND share_id=?", (p["id"], sid))
        else:
            key = sharing.add_item(st, author, _share_meta(p))
            db.execute("DELETE FROM share_dismissed WHERE share_id=? AND item_key=?", (sid, key))
            db.execute("INSERT OR REPLACE INTO paper_shares VALUES (?, ?, ?)", (p["id"], sid, key))
    _save_share(db, sid, st)
    db.commit()
    if author:
        publish_soon(sid)
    row, st = _load_share(db, sid)
    return jsonify(papers=load_papers(db, ids), share=share_summary_one(db, row, st, ident))


@app.post("/api/shares/<sid>/members")
def share_members(sid):
    b = request.get_json(silent=True) or {}
    db = get_db()
    row, st, err = _share_or_404(db, sid)
    if err:
        return err
    ident = share_identity(db)
    author = _my_author(st, ident)
    if not author:
        return error("Only members can add or remove members.")
    if not ident["can_publish"]:
        return error("To share with other people, first turn on sharing in Settings → GitHub sync & sharing.")
    name = re.sub(r"^https?://github\.com/", "", (b.get("name") or "").strip()).strip("/@ ")
    if not sharing.NAME_RE.match(name):
        return error("Type the GitHub user name of the person (e.g. MarioRossi).")
    if b.get("remove"):
        sharing.set_member(st, author, name, remove=True)
    else:
        sharing.set_member(st, author, name)  # their address arrives when they join
    _save_share(db, sid, st)
    db.commit()
    publish_soon(sid)
    row, st = _load_share(db, sid)
    return jsonify(share=share_summary_one(db, row, st, ident))

@app.post("/api/shares/sync")
def shares_sync():
    db = get_db()
    b = request.get_json(silent=True) or {}
    try:
        res = sync_all_shares(db, only=b.get("id") or None)
    except sharing.ShareError as exc:
        return error(str(exc), 502)
    ids = [r[0] for r in db.execute("SELECT DISTINCT paper_id FROM paper_shares")]
    return jsonify(result=res, shares=shares_summary(db), papers_changed=bool(
        sum((v.get("added", 0) + v.get("untagged", 0) + v.get("tagged", 0)) for v in res["lists"].values()) or res["restored"]),
        tagged=len(ids))


def _add_share_state(db, st, origin="") -> tuple[str, dict]:
    """Store a list received from someone (or merge it into the copy you already have)."""
    row, old = _load_share(db, st["id"])
    if old:
        st = sharing.merge(old, st)
        _save_share(db, st["id"], st)
    else:
        db.execute("INSERT INTO shares (id, state, origin, added_at) VALUES (?, ?, ?, ?)",
                   (st["id"], json.dumps(st), origin, now()))
    row, _ = _load_share(db, st["id"])
    stats = materialize_share(db, st["id"], st, row["group_id"])
    db.commit()
    return st["id"], stats


@app.post("/api/shares/join")
def join_share():
    """Join with the code the other person gave you (owner/gist/label), or their gist link to choose a label."""
    b = request.get_json(silent=True) or {}
    db = get_db()
    ident = share_identity(db)
    gh = sharing.GitHub(ident["token"])
    try:
        owner, src, lid = sharing.parse_code(b.get("code") or "")
        lid = b.get("id") or lid
        if not lid:
            idx = gh.read_src(owner, src, "index", fresh=True)
            if not idx:
                return error(f"No shared labels found there. Ask {owner} for the code shown in the label's ⚙︎.", 404)
            have = {r[0] for r in db.execute("SELECT id FROM shares")}
            lists = [dict(x, joined=x.get("id") in have) for x in idx.get("lists") or [] if isinstance(x, dict)]
            return jsonify(choose=lists, owner=owner)
        data = gh.read_src(owner, src, "list", lid, fresh=True)
        if not data:
            return error("That shared label was not found. Check the code, or wait a minute if it was just created.", 404)
        st = sharing.validate(data)
        sid, stats = _add_share_state(db, st, origin=f"{owner}|{src}")
    except sharing.ShareError as exc:
        return error(str(exc), 422)
    if b.get("group_id") and group_exists(db, _int(b["group_id"])):
        db.execute("UPDATE shares SET group_id=? WHERE id=?", (_int(b["group_id"]), sid))
        db.commit()
    row, st = _load_share(db, sid)
    if ident["can_publish"] and ident["user"] in sharing.members(st):
        try:  # you are a member: publish your copy and tell the others where it is
            sync_all_shares(db, only=sid)
        except sharing.ShareError:
            pass
        row, st = _load_share(db, sid)
    return jsonify(share=share_summary_one(db, row, st, ident), stats=stats)

@app.get("/api/shares/<sid>/export")
def export_share(sid):
    """The list as a .papershelf file to send by e-mail or chat (titles and DOIs only)."""
    db = get_db()
    row, st, err = _share_or_404(db, sid)
    if err:
        return err
    name = re.sub(r"[^A-Za-z0-9 _-]+", "", st["name"]["v"]).strip().replace(" ", "_") or "shared_list"
    return Response(json.dumps(st, indent=1, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}.papershelf"'})


@app.post("/api/shares/import")
def import_share():
    f = request.files.get("file")
    if not f:
        return error("Choose the .papershelf file.")
    try:
        st = sharing.validate(json.loads(f.read(20 * 1024 * 1024)))
    except (ValueError, UnicodeDecodeError):
        return error("This is not a PaperShelf list file.")
    except sharing.ShareError as exc:
        return error(str(exc))
    db = get_db()
    sid, stats = _add_share_state(db, st)
    row, st = _load_share(db, sid)
    return jsonify(share=share_summary_one(db, row, st, share_identity(db)), stats=stats)


@app.post("/api/shares/setup")
def share_setup():
    """Turn sharing on: find (or create) your secret shared-labels gist with your GitHub token."""
    b = request.get_json(silent=True) or {}
    db = get_db()
    if b.get("off"):
        for k in ("share_user", "share_gist"):
            set_setting(db, k, "")
        db.commit()
        return jsonify(ok=True, settings=get_settings(db, secrets=False))
    s = get_settings(db)
    token = (b.get("token") or "").strip() or s.get("share_token") or s.get("sync_token")
    if not token:
        return error("Paste your GitHub token first.")
    gh = sharing.GitHub(token)
    try:
        user = gh.whoami()
        gist = gh.find_or_create_gist()
    except sharing.ShareError as exc:
        return error(str(exc), 502)
    if (b.get("token") or "").strip():
        set_setting(db, "share_token", token.strip())
    set_setting(db, "share_user", user)
    set_setting(db, "share_gist", gist)
    db.commit()
    return jsonify(ok=True, user=user, gist=gist, settings=get_settings(db, secrets=False))


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _own_window_setting() -> bool:
    """Open PaperShelf in its own window (Chrome/Edge app window) unless turned off in Settings."""
    try:
        db = connect()
        try:
            return get_settings(db).get("own_window", "1") == "1"
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        return True


def main():
    ap = argparse.ArgumentParser(description="PaperShelf - local reference manager")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--no-browser", action="store_true", help="don't open the browser automatically")
    args = ap.parse_args()
    url = f"http://127.0.0.1:{args.port}"

    if _port_in_use(args.port):
        print(f"PaperShelf already seems to be running - opening {url}")
        launcher.open_ui(url, _own_window_setting())
        return

    init_db()
    startup_update(open_browser=not args.no_browser)
    print("\n  PaperShelf is running")
    print(f"  -> open {url} in your browser")
    print(f"  -> library and PDFs are stored in {HOME}")
    print("  -> close this window (or press Ctrl+C) to stop it\n")
    if not args.no_browser:
        own = _own_window_setting()
        threading.Timer(1.2, lambda: launcher.open_ui(url, own)).start()
    threading.Thread(target=auto_sync_loop, daemon=True).start()
    threading.Thread(target=share_loop, daemon=True).start()
    threading.Thread(target=sjr_watch_loop, daemon=True).start()
    threading.Thread(target=fulltext_loop, daemon=True).start()
    WATCHER.start()
    import flask.cli
    logging.getLogger("werkzeug").setLevel(logging.ERROR)  # keep the Terminal window quiet
    flask.cli.show_server_banner = lambda *a, **k: None
    from werkzeug.serving import make_server
    srv = make_server("127.0.0.1", args.port, app, threaded=True)
    SERVER["srv"] = srv
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        return
    finally:
        srv.server_close()
    STOP.set()
    WATCHER.stop()
    if not SERVER["restart"]:
        print("\n  PaperShelf has stopped. You can close this window.\n")
    if SERVER["restart"]:
        print("\n  Restarting PaperShelf with the new version...\n")
        updater.relaunch()


if __name__ == "__main__":
    main()
