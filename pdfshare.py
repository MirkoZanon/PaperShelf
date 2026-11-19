"""PaperShelf - passing PDFs to the people of a group through a folder you choose.

Nothing goes online from here. A group can point to a folder (for example a folder that the
members already share with Dropbox, OneDrive, Google Drive, iCloud or a network drive). Then:

  * you decide which of your PDFs go in (one paper, or all those of the group): they are copied
    into the folder under a neutral name derived from the paper's DOI (a hash, no title);
  * the PDFs the others put in the folder are copied to your own PDF folder when you have the
    paper and miss the file.

Only files named exactly <hash>.pdf are ever read or written, so nothing else in the folder is
touched, and nothing is ever overwritten. The folder is stored on this computer only (each
computer has its own path), and is never part of the group's file.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
from pathlib import Path

MAX_BYTES = 100 * 1024 * 1024


class PdfShareError(Exception):
    pass


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def paper_key(p) -> str:
    """The same neutral name on every computer for the same paper: DOI, else arXiv ID, else title and year."""
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", (p["doi"] or "").strip().lower())
    if doi:
        basis = "doi:" + doi
    elif (p["arxiv_id"] or "").strip():
        basis = "arxiv:" + re.sub(r"v\d+$", "", p["arxiv_id"].strip().lower())
    else:
        basis = f"title:{_norm(p['title'])}|{p['year'] or ''}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def _fname(key: str) -> str:
    return key + ".pdf"


def check_folder(path: str, own_pdf_dir: str = "") -> Path:
    """A folder that exists and can be written; raises PdfShareError with a message to show."""
    if not (path or "").strip():
        raise PdfShareError("Choose a folder first.")
    f = Path(path.strip()).expanduser()
    if not f.is_dir():
        raise PdfShareError("That folder does not exist on this computer. Create it first, or paste its full path.")
    f = f.resolve()
    if not os.access(f, os.W_OK | os.R_OK):
        raise PdfShareError("PaperShelf cannot read and write in that folder.")
    if own_pdf_dir:
        try:
            if f == Path(own_pdf_dir).expanduser().resolve():
                raise PdfShareError("That is your own PDF folder. Choose a different one, shared with the group.")
        except OSError:
            pass
    return f


def get_config(db, sid):
    r = db.execute("SELECT folder, auto FROM share_pdf WHERE share_id=?", (sid,)).fetchone()
    return {"folder": r["folder"] if r else "", "auto": bool(r["auto"]) if r else False}


def set_config(db, sid, folder: str, auto: bool, own_pdf_dir: str = ""):
    if folder.strip():
        folder = str(check_folder(folder, own_pdf_dir))
    db.execute("INSERT INTO share_pdf (share_id, folder, auto) VALUES (?, ?, ?) "
               "ON CONFLICT(share_id) DO UPDATE SET folder=excluded.folder, auto=excluded.auto",
               (sid, folder.strip(), 1 if auto else 0))
    db.commit()


def _group_papers(db, sid):
    return db.execute("SELECT p.* FROM papers p JOIN paper_shares ps ON ps.paper_id = p.id WHERE ps.share_id=?", (sid,)).fetchall()


def _has_pdf(p) -> bool:
    return bool(p["pdf_path"]) and os.path.isfile(p["pdf_path"])


def _is_pdf(path: Path) -> bool:
    try:
        with open(path, "rb") as fh:
            return b"%PDF-" in fh.read(1024)
    except OSError:
        return False


def _folder(db, sid, own_pdf_dir="") -> Path:
    cfg = get_config(db, sid)
    if not cfg["folder"]:
        raise PdfShareError("Choose the folder for this group's PDFs first.")
    return check_folder(cfg["folder"], own_pdf_dir)


def status(db, sid, own_pdf_dir=""):
    cfg = get_config(db, sid)
    out = {"folder": cfg["folder"], "auto": cfg["auto"], "ok": False, "error": "", "papers": 0, "with_pdf": 0,
           "shared": [], "available": 0, "in_folder": 0}
    papers = _group_papers(db, sid)
    out["papers"] = len(papers)
    out["with_pdf"] = sum(1 for p in papers if _has_pdf(p))
    out["shared"] = [r["paper_id"] for r in db.execute("SELECT paper_id FROM share_pdf_files WHERE share_id=?", (sid,))]
    if not cfg["folder"]:
        return out
    try:
        f = check_folder(cfg["folder"], own_pdf_dir)
    except PdfShareError as exc:
        out["error"] = str(exc)
        return out
    out["ok"] = True
    for p in papers:
        there = (f / _fname(paper_key(p))).is_file()
        out["in_folder"] += there
        if there and not _has_pdf(p):
            out["available"] += 1
    return out


def share(db, sid, paper_ids=None, own_pdf_dir=""):
    """Copy PDFs into the group's folder. paper_ids None = all those of the group that have a PDF."""
    f = _folder(db, sid, own_pdf_dir)
    ids = None if paper_ids is None else {int(i) for i in paper_ids}
    done = skipped = failed = 0
    for p in _group_papers(db, sid):
        if ids is not None and p["id"] not in ids:
            continue
        if not _has_pdf(p) or not _is_pdf(Path(p["pdf_path"])) or os.path.getsize(p["pdf_path"]) > MAX_BYTES:
            skipped += 1
            continue
        dest = f / _fname(paper_key(p))
        try:
            if not dest.exists():
                tmp = f / ("." + dest.name + ".tmp")
                shutil.copyfile(p["pdf_path"], tmp)
                os.replace(tmp, dest)
                done += 1
            db.execute("INSERT OR IGNORE INTO share_pdf_files (share_id, paper_id, file) VALUES (?, ?, ?)", (sid, p["id"], dest.name))
        except OSError:
            failed += 1
    db.commit()
    return {"shared": done, "skipped": skipped, "failed": failed}


def unshare(db, sid, paper_ids, own_pdf_dir=""):
    """Take back what you put in the folder (only your own copies)."""
    f = _folder(db, sid, own_pdf_dir)
    removed = 0
    papers = {p["id"]: p for p in _group_papers(db, sid)}
    for pid in {int(i) for i in paper_ids}:
        rec = db.execute("SELECT file FROM share_pdf_files WHERE share_id=? AND paper_id=?", (sid, pid)).fetchone()
        if not rec:
            continue
        p = papers.get(pid)
        name = _fname(paper_key(p)) if p else rec["file"]
        if re.fullmatch(r"[0-9a-f]{24}\.pdf", name):
            try:
                (f / name).unlink()
                removed += 1
            except FileNotFoundError:
                pass
            except OSError as exc:
                raise PdfShareError(f"Could not remove the file from the folder: {exc.strerror or exc}")
        db.execute("DELETE FROM share_pdf_files WHERE share_id=? AND paper_id=?", (sid, pid))
    db.commit()
    return {"removed": removed}


def fetch(db, sid, save, own_pdf_dir=""):
    """Copy to your own PDF folder the PDFs of the group that you miss and that are in the folder.

    save(paper_row, data) stores the bytes and returns the new path."""
    f = _folder(db, sid, own_pdf_dir)
    got = bad = 0
    for p in _group_papers(db, sid):
        if _has_pdf(p):
            continue
        src = f / _fname(paper_key(p))
        if not src.is_file():
            continue
        try:
            if src.stat().st_size > MAX_BYTES or not _is_pdf(src):
                bad += 1
                continue
            path = save(p, src.read_bytes())
        except OSError:
            bad += 1
            continue
        db.execute("UPDATE papers SET pdf_path=? WHERE id=?", (str(path), p["id"]))
        got += 1
    db.commit()
    return {"received": got, "unreadable": bad}
