"""
fulltext.py - the text of your PDFs, indexed on this computer so that the search box also finds words
written inside the papers (not only in title, authors, abstract, keywords and notes).

The text of each page is extracted with pypdf in the background and stored in an SQLite full-text
index (FTS5) inside the library database. Nothing leaves your computer. Scanned PDFs without a text
layer can't be searched.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone

MAX_PAGES = 400
FTS = True  # set to False when this SQLite has no FTS5 (then a slower plain search is used)


def init(db):
    global FTS
    db.execute("""CREATE TABLE IF NOT EXISTS pdf_text_meta (paper_id INTEGER PRIMARY KEY, path TEXT, mtime REAL,
                  size INTEGER, pages INTEGER, chars INTEGER, indexed_at TEXT, error TEXT NOT NULL DEFAULT '')""")
    try:
        db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS pdf_fts USING fts5(text, paper_id UNINDEXED, page UNINDEXED, "
                   "tokenize='unicode61 remove_diacritics 2')")
        FTS = True
    except Exception:  # noqa: BLE001 - SQLite built without FTS5
        FTS = False
        db.execute("CREATE TABLE IF NOT EXISTS pdf_pages (paper_id INTEGER, page INTEGER, text TEXT)")
    db.commit()


def _table():
    return "pdf_fts" if FTS else "pdf_pages"


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def extract_pages(path: str) -> list[str]:
    from pypdf import PdfReader
    rd = PdfReader(path)
    out = []
    for i, page in enumerate(rd.pages):
        if i >= MAX_PAGES:
            break
        try:
            t = page.extract_text() or ""
        except Exception:  # noqa: BLE001 - one bad page must not stop the rest
            t = ""
        t = re.sub(r"-\n(?=[a-z])", "", t)          # re-join words split at line ends
        out.append(re.sub(r"\s+", " ", t).strip())
    return out


def forget(db, pid):
    db.execute(f"DELETE FROM {_table()} WHERE paper_id=?", (pid,))
    db.execute("DELETE FROM pdf_text_meta WHERE paper_id=?", (pid,))


def index_one(db, pid: int, path: str) -> int:
    st = os.stat(path)
    try:
        pages = extract_pages(path)
        err = "" if any(pages) else "no text layer (scanned PDF?)"
    except Exception as exc:  # noqa: BLE001
        pages, err = [], f"unreadable ({exc.__class__.__name__})"
    db.execute(f"DELETE FROM {_table()} WHERE paper_id=?", (pid,))
    for i, t in enumerate(pages):
        if t:
            db.execute(f"INSERT INTO {_table()} (text, paper_id, page) VALUES (?, ?, ?)" if FTS else
                       "INSERT INTO pdf_pages (text, paper_id, page) VALUES (?, ?, ?)", (t, pid, i + 1))
    db.execute("INSERT OR REPLACE INTO pdf_text_meta VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
               (pid, path, st.st_mtime, st.st_size, len(pages), sum(len(t) for t in pages), _now(), err))
    db.commit()
    return len(pages)


def pending(db) -> list[tuple[int, str]]:
    """Papers whose PDF is new or changed since it was indexed (and clean-up of the others)."""
    meta = {r[0]: (r[1], r[2], r[3]) for r in db.execute("SELECT paper_id, path, mtime, size FROM pdf_text_meta")}
    todo, have = [], set()
    for pid, path in db.execute("SELECT id, pdf_path FROM papers WHERE pdf_path != ''"):
        if not path or not os.path.isfile(path):
            continue
        have.add(pid)
        st = os.stat(path)
        m = meta.get(pid)
        if not m or m[0] != path or abs((m[1] or 0) - st.st_mtime) > 1 or m[2] != st.st_size:
            todo.append((pid, path))
    for pid in set(meta) - have:  # paper deleted or PDF removed
        forget(db, pid)
    db.commit()
    return todo


def index_pending(db, limit: int = 10, stop=None) -> int:
    n = 0
    for pid, path in pending(db)[:limit]:
        if stop is not None and stop.is_set():
            break
        index_one(db, pid, path)
        n += 1
    return n


def status(db) -> dict:
    with_pdf = sum(1 for (p,) in db.execute("SELECT pdf_path FROM papers WHERE pdf_path != ''") if p and os.path.isfile(p))
    done = db.execute("SELECT COUNT(*) FROM pdf_text_meta WHERE error = ''").fetchone()[0]
    noread = db.execute("SELECT COUNT(*) FROM pdf_text_meta WHERE error != ''").fetchone()[0]
    return {"with_pdf": with_pdf, "indexed": done, "unreadable": noread, "fts": FTS}


def _terms(q: str) -> list[str]:
    """Words and "quoted phrases" of the query (at least 2 characters)."""
    out = [p for p in re.findall(r'"([^"]+)"', q)]
    rest = re.sub(r'"[^"]*"', " ", q)
    out += [w for w in re.findall(r"[\w'’-]+", rest, re.UNICODE) if len(w) >= 2]
    return [t.strip() for t in out if t.strip()][:8]


def search(db, q: str, limit_papers: int = 300) -> dict:
    """{paper_id: [{'page', 'snippet'}]} for papers whose PDF contains ALL the words (on any page).
    Snippets mark the matches with [[ ]]."""
    terms = _terms(q)
    if not terms:
        return {}
    if not FTS:
        pids = None
        for t in terms:
            found = {r[0] for r in db.execute("SELECT DISTINCT paper_id FROM pdf_pages WHERE text LIKE ?", (f"%{t}%",))}
            pids = found if pids is None else pids & found
        out = {}
        for pid in list(pids or [])[:limit_papers]:
            r = db.execute("SELECT page, text FROM pdf_pages WHERE paper_id=? AND text LIKE ? LIMIT 1", (pid, f"%{terms[0]}%")).fetchone()
            if r:
                i = r[1].lower().find(terms[0].lower())
                out[pid] = {"pages": 1, "hits": [{"page": r[0], "snippet": "…" + r[1][max(0, i - 60): i].strip() + " [[" + r[1][i:i + len(terms[0])] + "]] "
                                                  + r[1][i + len(terms[0]): i + 90].strip() + "…"}]}
        return out
    fts_term = lambda t: '"' + t.replace('"', '') + '"' + ("*" if " " not in t and len(t) >= 3 else "")
    pids = None
    for t in terms:  # every word somewhere in the paper (pages may differ)
        found = {r[0] for r in db.execute("SELECT DISTINCT paper_id FROM pdf_fts WHERE pdf_fts MATCH ?", (fts_term(t),))}
        pids = found if pids is None else pids & found
        if not pids:
            return {}
    out = {}
    all_q = " ".join(fts_term(t) for t in terms)
    any_q = " OR ".join(fts_term(t) for t in terms)
    for pid in list(pids)[:limit_papers]:
        rows = db.execute("SELECT page, snippet(pdf_fts, 0, '[[', ']]', '…', 14) FROM pdf_fts WHERE pdf_fts MATCH ? "
                          "AND paper_id=? ORDER BY rank LIMIT 3", (all_q, pid)).fetchall() or \
            db.execute("SELECT page, snippet(pdf_fts, 0, '[[', ']]', '…', 14) FROM pdf_fts WHERE pdf_fts MATCH ? "
                       "AND paper_id=? ORDER BY rank LIMIT 3", (any_q, pid)).fetchall()
        n_pages = db.execute("SELECT COUNT(*) FROM pdf_fts WHERE pdf_fts MATCH ? AND paper_id=?", (any_q, pid)).fetchone()[0]
        out[pid] = {"pages": n_pages, "hits": [{"page": r[0], "snippet": r[1]} for r in rows]}
    return out
