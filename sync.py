"""
sync.py - keep your library in sync between computers through a private
GitHub repository (or any git remote).

How it works
------------
The repository holds a plain-text copy of the library:

    papershelf/papers/<uid>.json   one file per paper (details, groups, highlights)
    papershelf/groups.json         the group tree
    papershelf/deletions.json      what was deleted, so it disappears everywhere
    papershelf/pdfs/               the PDFs (only if "Sync PDFs" is on)

On "Sync now" PaperShelf downloads the repository, merges it with the local
database (for each paper the most recently edited copy wins), writes the merged
library back and pushes it. Nothing is ever merged by git itself, so there are
no git conflicts to resolve.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import socket
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

JSON_COLS = {"authors", "keywords", "refs", "related"}
SKIP_COLS = {"id", "pdf_path"}
MAX_PDF_BYTES = 95 * 1024 * 1024  # GitHub refuses files over 100 MB

GIT_MISSING = ("Git is not installed. On a Mac open the Terminal app and run:  xcode-select --install   "
               "(on Windows install it from https://git-scm.com). Then try again.")

REPO_README = """# PaperShelf library

This repository is managed by PaperShelf. Use the app's "Sync now" button
instead of editing these files by hand.
"""


class SyncError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _friendly(err: str) -> str:
    e = err or ""
    low = e.lower()
    if "xcrun: error" in low or "no developer tools" in low:
        return GIT_MISSING
    if ("repository not found" in low or "does not appear to be a git repository" in low
            or ("not found" in low and "repository" in low)):
        return ("Repository not found. Check the address in Settings, and that your token has access "
                "to this repository.")
    if any(x in low for x in ("authentication failed", "could not read username", "403", "401",
                              "permission denied", "invalid username or password", "terminal prompts disabled")):
        return ("GitHub refused access. Check the token in Settings (it needs 'Contents: read and write' "
                "permission on this repository) or, for an SSH address, your SSH key.")
    if "could not resolve host" in low or "unable to access" in low and "resolve" in low:
        return "No internet connection (could not reach GitHub). Your library is unchanged; try again later."
    lines = [ln.replace("fatal: ", "") for ln in e.strip().splitlines() if ln.strip()]
    return "Git error: " + (" ".join(lines[:2]) if lines else "unknown problem")


def _git(repo: Path, *args, token: str = "", check: bool = True, timeout: int = 600):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0",
               GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
    cmd = ["git"]
    if token:
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        cmd += ["-c", f"http.https://github.com/.extraheader=AUTHORIZATION: basic {basic}"]
    cmd += [str(a) for a in args]
    try:
        r = subprocess.run(cmd, cwd=str(repo), env=env, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise SyncError(GIT_MISSING) from exc
    except subprocess.TimeoutExpired as exc:
        raise SyncError("GitHub did not answer in time. Check your connection and try again.") from exc
    if check and r.returncode != 0:
        raise SyncError(_friendly(r.stderr or r.stdout))
    return r


# --------------------------------------------------------------------------- #
# Repository handling
# --------------------------------------------------------------------------- #
def _prepare(repo: Path, url: str):
    if not (repo / ".git").is_dir():
        repo.mkdir(parents=True, exist_ok=True)
        _git(repo, "init", "-q")
        _git(repo, "remote", "add", "origin", url)
    else:
        _git(repo, "remote", "set-url", "origin", url)
    _git(repo, "config", "user.name", "PaperShelf")
    _git(repo, "config", "user.email", "papershelf@users.noreply.github.com")
    _git(repo, "config", "core.quotepath", "false")


def _checkout_remote(repo: Path, token: str):
    """Make the working tree identical to the remote. Returns (branch, remote_has_commits)."""
    out = _git(repo, "ls-remote", "--symref", "origin", "HEAD", token=token).stdout
    m = re.search(r"ref:\s*refs/heads/(\S+)\s+HEAD", out)
    if not m:
        heads = _git(repo, "ls-remote", "--heads", "origin", token=token).stdout
        hm = re.search(r"refs/heads/(\S+)", heads)
        if not hm:  # brand-new empty repository
            _git(repo, "symbolic-ref", "HEAD", "refs/heads/main")
            return "main", False
        branch = hm.group(1)
    else:
        branch = m.group(1)
    _git(repo, "fetch", "-q", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}", token=token)
    _git(repo, "checkout", "-q", "-f", "-B", branch, f"origin/{branch}")
    _git(repo, "clean", "-q", "-f", "-d")
    return branch, True


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _read_state(repo: Path):
    base = repo / "papershelf"
    papers = {}
    for f in sorted((base / "papers").glob("*.json")):
        d = _read_json(f, None)
        if isinstance(d, dict) and d.get("uid"):
            papers[d["uid"]] = d
    groups = _read_json(base / "groups.json", {})
    deletions = _read_json(base / "deletions.json", {})
    return papers, (groups if isinstance(groups, dict) else {}), (deletions if isinstance(deletions, dict) else {})


# --------------------------------------------------------------------------- #
# Merge remote -> local
# --------------------------------------------------------------------------- #
def _encode(col, value):
    if col in JSON_COLS:
        return json.dumps(value if isinstance(value, list) else [], ensure_ascii=False)
    if col == "starred":
        return 1 if value else 0
    return value


def _decode(col, value):
    if col in JSON_COLS:
        try:
            return json.loads(value or "[]")
        except ValueError:
            return []
    if col == "starred":
        return bool(value)
    return value


def _unique_path(folder: Path, name: str) -> Path:
    path, i = folder / name, 2
    while path.exists():
        path = folder / f"{Path(name).stem}_{i}{Path(name).suffix}"
        i += 1
    return path


def _merge(db, repo: Path, pdf_dir: Path, with_pdfs: bool):
    rp, rg, rd = _read_state(repo)
    stats = {"added": 0, "updated": 0, "removed": 0, "pdfs_down": 0, "pdfs_up": 0}

    # 1. deletions: keep the newest tombstone for each uid
    ld = {r["uid"]: r["deleted_at"] for r in db.execute("SELECT uid, deleted_at FROM deletions")}
    kinds = {r["uid"]: r["kind"] for r in db.execute("SELECT uid, kind FROM deletions")}
    for uid, info in rd.items():
        t = (info or {}).get("deleted_at", "")
        if t > ld.get(uid, ""):
            db.execute("INSERT OR REPLACE INTO deletions (uid, kind, deleted_at) VALUES (?, ?, ?)",
                       (uid, info.get("kind", "paper"), t))
            ld[uid], kinds[uid] = t, info.get("kind", "paper")

    # 2. groups
    lg = {r["uid"]: dict(r) for r in db.execute("SELECT * FROM collections")}
    remote_won = set()
    for uid, g in rg.items():
        g_time = g.get("updated_at", "")
        if uid in ld and ld[uid] >= g_time:
            continue
        loc = lg.get(uid)
        if loc is None:
            db.execute("INSERT INTO collections (uid, name, position, updated_at) VALUES (?, ?, ?, ?)",
                       (uid, g.get("name") or "Group", g.get("position") or 0, g_time))
            remote_won.add(uid)
        elif g_time > (loc.get("updated_at") or ""):
            db.execute("UPDATE collections SET name=?, position=?, updated_at=? WHERE uid=?",
                       (g.get("name") or loc["name"], g.get("position") or 0, g_time, uid))
            remote_won.add(uid)
    uid2gid = {r["uid"]: r["id"] for r in db.execute("SELECT id, uid FROM collections")}
    for uid in remote_won:
        parent = uid2gid.get(rg[uid].get("parent_uid") or "")
        if parent != uid2gid[uid]:
            db.execute("UPDATE collections SET parent_id=? WHERE id=?", (parent, uid2gid[uid]))

    # 3. papers
    cols = [r[1] for r in db.execute("PRAGMA table_info(papers)")]
    lp = {r["uid"]: dict(r) for r in db.execute("SELECT * FROM papers")}
    by_doi = {(p["doi"] or "").lower(): p for p in lp.values() if p["doi"]}
    for uid, rec in rp.items():
        r_time = rec.get("updated_at", "")
        if uid in ld and ld[uid] >= r_time:
            continue
        loc = lp.get(uid)
        if loc is None and (rec.get("doi") or "").lower() in by_doi:
            # the same paper was added separately on two computers: keep one copy
            loc = by_doi[(rec.get("doi") or "").lower()]
            if loc["uid"] in rp:
                continue
            db.execute("UPDATE papers SET uid=? WHERE id=?", (uid, loc["id"]))
            db.execute("INSERT OR REPLACE INTO deletions (uid, kind, deleted_at) VALUES (?, 'paper', ?)",
                       (loc["uid"], _now()))
            loc = dict(loc, uid=uid)
            lp[uid] = loc
        if loc is not None and r_time <= (loc.get("updated_at") or ""):
            continue
        values = {c: _encode(c, rec.get(c)) for c in cols if c not in SKIP_COLS and c in rec}
        if loc is not None:
            db.execute(f"UPDATE papers SET {', '.join(f'{c}=?' for c in values)} WHERE id=?",
                       list(values.values()) + [loc["id"]])
            pid = loc["id"]
            stats["updated"] += 1
        else:
            values.setdefault("added_at", r_time or _now())
            values.setdefault("updated_at", r_time or _now())
            cur = db.execute(f"INSERT INTO papers ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})",
                             list(values.values()))
            pid = cur.lastrowid
            stats["added"] += 1
        db.execute("DELETE FROM paper_collections WHERE paper_id=?", (pid,))
        for gu in rec.get("group_uids") or []:
            if gu in uid2gid:
                db.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, uid2gid[gu]))
        db.execute("DELETE FROM annotations WHERE paper_id=?", (pid,))
        for a in rec.get("annotations") or []:
            db.execute("INSERT INTO annotations (uid, paper_id, page, rects, text, note, color, created_at, updated_at) "
                       "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (a.get("uid") or uuid.uuid4().hex, pid, a.get("page") or 1, json.dumps(a.get("rects") or []),
                        a.get("text") or "", a.get("note") or "", a.get("color") or "yellow",
                        a.get("created_at") or r_time, a.get("updated_at") or r_time))

    # 4. apply deletions locally (unless the item was edited after it was deleted elsewhere)
    for uid, t in ld.items():
        if kinds.get(uid) == "group":
            row = db.execute("SELECT id, updated_at FROM collections WHERE uid=?", (uid,)).fetchone()
            if row and (row["updated_at"] or "") <= t:
                db.execute("DELETE FROM collections WHERE id=?", (row["id"],))
        else:
            row = db.execute("SELECT id, updated_at FROM papers WHERE uid=?", (uid,)).fetchone()
            if row and (row["updated_at"] or "") <= t:
                db.execute("DELETE FROM papers WHERE id=?", (row["id"],))
                stats["removed"] += 1

    # 5. PDFs stored in the repository that this computer doesn't have yet
    if with_pdfs:
        rdir = repo / "papershelf" / "pdfs"
        for uid, rec in rp.items():
            name = rec.get("pdf_file") or ""
            src = rdir / name
            if not name or not src.is_file():
                continue
            row = db.execute("SELECT id, pdf_path FROM papers WHERE uid=?", (uid,)).fetchone()
            if not row or (row["pdf_path"] and os.path.isfile(row["pdf_path"])):
                continue
            pdf_dir.mkdir(parents=True, exist_ok=True)
            local_name = re.sub(r"^[0-9a-f]{8}_", "", name)
            dest = _unique_path(pdf_dir, local_name)
            shutil.copy2(src, dest)
            db.execute("UPDATE papers SET pdf_path=? WHERE id=?", (str(dest), row["id"]))
            stats["pdfs_down"] += 1
    db.commit()
    return stats, rp


# --------------------------------------------------------------------------- #
# Write local -> repository
# --------------------------------------------------------------------------- #
def _write_if_changed(path: Path, text: str):
    try:
        if path.read_text("utf-8") == text:
            return
    except OSError:
        pass
    path.write_text(text, "utf-8")


def _write_state(db, repo: Path, with_pdfs: bool, remote_papers: dict, stats: dict):
    base = repo / "papershelf"
    (base / "papers").mkdir(parents=True, exist_ok=True)
    pdf_repo = base / "pdfs"
    if with_pdfs:
        pdf_repo.mkdir(parents=True, exist_ok=True)
    if not (repo / "README.md").exists():
        (repo / "README.md").write_text(REPO_README, "utf-8")

    gid2uid = {r["id"]: r["uid"] for r in db.execute("SELECT id, uid FROM collections")}
    groups = {r["uid"]: {"name": r["name"], "parent_uid": gid2uid.get(r["parent_id"]), "position": r["position"],
                         "updated_at": r["updated_at"] or ""}
              for r in db.execute("SELECT * FROM collections")}
    memberships: dict[int, list[str]] = {}
    for r in db.execute("SELECT paper_id, collection_id FROM paper_collections"):
        if r["collection_id"] in gid2uid:
            memberships.setdefault(r["paper_id"], []).append(gid2uid[r["collection_id"]])
    notes: dict[int, list[dict]] = {}
    for a in db.execute("SELECT * FROM annotations ORDER BY page, id"):
        notes.setdefault(a["paper_id"], []).append({
            "uid": a["uid"], "page": a["page"], "rects": json.loads(a["rects"] or "[]"), "text": a["text"],
            "note": a["note"], "color": a["color"], "created_at": a["created_at"], "updated_at": a["updated_at"]})

    cols = [r[1] for r in db.execute("PRAGMA table_info(papers)")]
    keep_files, keep_pdfs = set(), set()
    for row in db.execute("SELECT * FROM papers"):
        rec = {c: _decode(c, row[c]) for c in cols if c not in SKIP_COLS}
        rec["group_uids"] = sorted(memberships.get(row["id"], []))
        rec["annotations"] = notes.get(row["id"], [])
        pdf = row["pdf_path"]
        rec["pdf_file"] = (remote_papers.get(row["uid"]) or {}).get("pdf_file", "")
        if pdf and os.path.isfile(pdf):
            repo_name = f"{row['uid'][:8]}_{Path(pdf).name}"
            if with_pdfs and os.path.getsize(pdf) <= MAX_PDF_BYTES:
                dest = pdf_repo / repo_name
                if not dest.exists():
                    shutil.copy2(pdf, dest)
                    stats["pdfs_up"] += 1
                rec["pdf_file"] = repo_name
        if rec["pdf_file"]:
            keep_pdfs.add(rec["pdf_file"])
        fname = f"{row['uid']}.json"
        keep_files.add(fname)
        _write_if_changed(base / "papers" / fname, json.dumps(rec, ensure_ascii=False, indent=1, sort_keys=True) + "\n")

    for f in (base / "papers").glob("*.json"):
        if f.name not in keep_files:
            f.unlink()
    if pdf_repo.is_dir():
        for f in pdf_repo.iterdir():
            if f.is_file() and f.name not in keep_pdfs:
                f.unlink()
    deletions = {r["uid"]: {"kind": r["kind"], "deleted_at": r["deleted_at"]}
                 for r in db.execute("SELECT * FROM deletions")}
    _write_if_changed(base / "groups.json", json.dumps(groups, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    _write_if_changed(base / "deletions.json", json.dumps(deletions, indent=1, sort_keys=True) + "\n")


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def sync(db, home: Path, settings: dict) -> dict:
    url = (settings.get("sync_repo") or "").strip()
    if not url:
        raise SyncError("Set up the GitHub repository in Settings first.")
    if re.match(r"^https://github\.com/[^/]+/[^/]+?/?$", url) and not url.endswith(".git"):
        url = url.rstrip("/") + ".git"
    token = (settings.get("sync_token") or "").strip() if url.startswith("https://") else ""
    with_pdfs = settings.get("sync_pdfs") == "1"
    pdf_dir = Path(settings.get("pdf_dir") or home / "PDFs").expanduser()
    repo = home / "sync-repo"
    _prepare(repo, url)

    for attempt in (1, 2):
        branch, has_remote = _checkout_remote(repo, token)
        stats, remote_papers = _merge(db, repo, pdf_dir, with_pdfs)
        _write_state(db, repo, with_pdfs, remote_papers, stats)
        _git(repo, "add", "-A")
        dirty = bool(_git(repo, "status", "--porcelain").stdout.strip())
        if dirty:
            _git(repo, "commit", "-q", "-m", f"PaperShelf sync from {socket.gethostname()} ({_now()})")
        if dirty or not has_remote:
            r = _git(repo, "push", "-q", "origin", f"HEAD:refs/heads/{branch}", token=token, check=False)
            if r.returncode != 0:
                err = (r.stderr or "").lower()
                if attempt == 1 and any(x in err for x in ("rejected", "fetch first", "non-fast-forward")):
                    continue  # someone synced in the meantime: merge again
                raise SyncError(_friendly(r.stderr))
        stats["pushed"] = dirty
        return stats
    raise SyncError("The repository kept changing during sync. Try again.")


def git_status() -> dict:
    """Is Git available? (On a Mac, don't call git if the command line tools are missing:
    that would pop up the installer.)"""
    import platform
    if platform.system() == "Darwin":
        r = subprocess.run(["xcode-select", "-p"], capture_output=True, text=True)
        if r.returncode != 0:
            return {"ok": False, "version": "", "error": GIT_MISSING}
    if not shutil.which("git"):
        return {"ok": False, "version": "", "error": GIT_MISSING}
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return {"ok": False, "version": "", "error": GIT_MISSING}
    return {"ok": r.returncode == 0, "version": r.stdout.strip(), "error": "" if r.returncode == 0 else GIT_MISSING}


def test_connection(home: Path, settings: dict) -> dict:
    """Check the repository address and token without changing anything."""
    url = (settings.get("sync_repo") or "").strip()
    if not url:
        raise SyncError("Enter the repository address first.")
    if re.match(r"^https://github\.com/[^/]+/[^/]+?/?$", url) and not url.endswith(".git"):
        url = url.rstrip("/") + ".git"
    gs = git_status()
    if not gs["ok"]:
        raise SyncError(gs["error"])
    token = (settings.get("sync_token") or "").strip() if url.startswith("https://") else ""
    if url.startswith("https://github.com/") and not token:
        raise SyncError("Paste the access token too (see step 2 of the guide).")
    home.mkdir(parents=True, exist_ok=True)
    out = _git(home, "ls-remote", "--heads", url, token=token, timeout=60).stdout
    return {"ok": True, "empty": not out.strip(), "git": gs["version"]}
