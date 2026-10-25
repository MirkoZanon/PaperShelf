"""
sharing.py - shared paper lists between PaperShelf users.

What is shared
--------------
Only the bibliographic details of the papers in a list (DOI, title, authors, year, journal, link).
Never PDFs, notes, highlights or anything else from your library.

Where
-----
Each person who publishes lists has a small PUBLIC GitHub repository, by default
``<username>/papershelf-shared``, with:

    index.json                 the lists published there (name, number of papers, date)
    collections/<list-id>.json one file per list: its papers and its members

Everybody's PaperShelf reads the files of all the members of a list, merges them with its own copy
and writes the result back to its own repository. Reading needs no account; publishing needs a
GitHub token for your own sharing repository.

Merging (why the order of updates never matters)
------------------------------------------------
Every change is stamped with a logical clock (a "Lamport" counter, plus the author's name to break
ties): adding a paper, removing it from the list, renaming the list, adding or removing a member.
For each paper the list keeps the stamp of the last "add" and of the last "remove"; the paper is in
the list when its latest add is newer than its latest remove. Merging two copies just keeps, for every
paper and every member, the newest stamps. This merge gives the same result whatever the order in
which copies are combined, and combining a copy twice changes nothing - so updates can travel along
any chain of people (x <-> y <-> z) and in any order without losing papers or resurrecting
removed ones. Computer clocks are not used, so a wrong clock can't cause trouble.

What happens in your library
----------------------------
Papers that arrive through a list are added to YOUR library with the list's label. If someone later
removes a paper from the list, your copy only loses the label: the paper stays in your library until
you delete it yourself.
"""
from __future__ import annotations

import base64
import json
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

FORMAT = 1
DEFAULT_REPO_NAME = "papershelf-shared"
MAX_ITEMS = 20000
MAX_MEMBERS = 200
API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
NAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")       # GitHub user names
REPO_RE = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_.-]{1,100}$")
ID_RE = re.compile(r"^[a-f0-9]{8,32}$")
META_KEYS = ("doi", "title", "authors", "year", "journal", "arxiv_id", "url", "type")


class ShareError(Exception):
    """Shown to the user as is."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def norm_title(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def item_key(meta: dict) -> str:
    """Stable identity of a paper in a list: its DOI, else arXiv id, else title + year."""
    doi = (meta.get("doi") or "").strip().lower()
    if doi:
        return "doi:" + doi
    ax = (meta.get("arxiv_id") or "").strip().lower()
    if ax:
        return "arxiv:" + re.sub(r"v\d+$", "", ax)
    return "t:" + norm_title(meta.get("title"))[:160] + "|" + str(meta.get("year") or "")


def clean_meta(meta: dict) -> dict:
    """Only bibliographic details travel - nothing else from the library."""
    out = {}
    for k in META_KEYS:
        v = meta.get(k)
        if k == "authors":
            authors = []
            for a in (v or [])[:40]:
                if isinstance(a, dict):
                    authors.append({"family": str(a.get("family") or "")[:120], "given": str(a.get("given") or "")[:120]})
                elif isinstance(a, str):
                    authors.append({"family": a[:120], "given": ""})
            out[k] = authors
        elif k == "year":
            try:
                out[k] = int(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                out[k] = None
        else:
            out[k] = str(v or "")[:600 if k == "title" else 300]
    return out


# --------------------------------------------------------------------------- stamps
def _stamp(v):
    """A stamp is [lamport_counter, author]; None means 'never'."""
    if isinstance(v, (list, tuple)) and len(v) == 2:
        try:
            return [int(v[0]), str(v[1])[:60]]
        except (TypeError, ValueError):
            return None
    return None


def newer(a, b) -> bool:
    """Is stamp a newer than stamp b?"""
    if a is None:
        return False
    if b is None:
        return True
    return (a[0], a[1]) > (b[0], b[1])


def latest(a, b):
    return a if newer(a, b) or b is None else b


def present(entry: dict) -> bool:
    return bool(entry) and entry.get("add") is not None and newer(entry.get("add"), entry.get("rem"))


# --------------------------------------------------------------------------- state
def new_state(name: str, author: str, repo: str = "", list_id: str | None = None) -> dict:
    st = {"papershelf_shared": FORMAT, "id": list_id or new_id(), "clock": 0,
          "name": {"v": "", "s": None}, "description": {"v": "", "s": None},
          "members": {}, "items": {}, "updated_at": _now(), "publisher": author}
    set_name(st, author, name or "Shared list")
    set_member(st, author, author, repo)
    return st


def clock(st: dict) -> int:
    c = int(st.get("clock") or 0)
    for e in list(st.get("items", {}).values()) + list(st.get("members", {}).values()):
        for k in ("add", "rem"):
            if e.get(k):
                c = max(c, e[k][0])
    for k in ("name", "description"):
        if (st.get(k) or {}).get("s"):
            c = max(c, st[k]["s"][0])
    return c


def tick(st: dict, author: str):
    n = clock(st) + 1
    st["clock"] = n
    st["updated_at"] = _now()
    return [n, author]


def set_name(st, author, name):
    st["name"] = {"v": str(name or "").strip()[:120] or "Shared list", "s": tick(st, author)}


def set_description(st, author, text):
    st["description"] = {"v": str(text or "").strip()[:1000], "s": tick(st, author)}


def set_member(st, author, member, repo="", remove=False):
    m = st["members"].setdefault(member, {"repo": "", "add": None, "rem": None})
    s = tick(st, author)
    if remove:
        m["rem"] = s
    else:
        m["add"] = s
        if repo:
            m["repo"] = repo


def add_item(st, author, meta) -> str:
    meta = clean_meta(meta)
    key = item_key(meta)
    e = st["items"].setdefault(key, {"meta": meta, "add": None, "rem": None})
    e["add"] = tick(st, author)
    e["meta"] = meta
    return key


def remove_item(st, author, key):
    e = st["items"].get(key)
    if e is not None:
        e["rem"] = tick(st, author)


def members(st) -> dict:
    """Current members: {name: repo}."""
    return {k: v.get("repo", "") for k, v in st.get("members", {}).items() if present(v)}


def items(st) -> dict:
    return {k: e for k, e in st.get("items", {}).items() if present(e)}


def merge(a: dict, b: dict) -> dict:
    """Combine two copies of the same list. Commutative, associative and idempotent."""
    if a.get("id") != b.get("id"):
        raise ShareError("These are two different shared lists.")
    out = {"papershelf_shared": FORMAT, "id": a["id"], "clock": max(clock(a), clock(b)),
           "updated_at": max(a.get("updated_at") or "", b.get("updated_at") or ""),
           "publisher": a.get("publisher") or b.get("publisher") or ""}
    for k in ("name", "description"):
        x, y = a.get(k) or {"v": "", "s": None}, b.get(k) or {"v": "", "s": None}
        out[k] = dict(x if not newer(y.get("s"), x.get("s")) else y)
    out["members"] = {}
    for name in set(a.get("members", {})) | set(b.get("members", {})):
        x, y = a["members"].get(name), b["members"].get(name)
        if not x or not y:
            out["members"][name] = dict(x or y)
            continue
        out["members"][name] = {"add": latest(x.get("add"), y.get("add")), "rem": latest(x.get("rem"), y.get("rem")),
                                "repo": (y if newer(y.get("add"), x.get("add")) else x).get("repo") or x.get("repo") or y.get("repo") or ""}
    out["items"] = {}
    for key in set(a.get("items", {})) | set(b.get("items", {})):
        x, y = a["items"].get(key), b["items"].get(key)
        if not x or not y:
            out["items"][key] = dict(x or y)
            continue
        src = y if newer(y.get("add"), x.get("add")) else x
        out["items"][key] = {"meta": src.get("meta") or x.get("meta") or y.get("meta"),
                             "add": latest(x.get("add"), y.get("add")), "rem": latest(x.get("rem"), y.get("rem"))}
    return out


def validate(data) -> dict:
    """Check and clean a list file read from someone else's repository (never trust it blindly)."""
    if not isinstance(data, dict) or data.get("papershelf_shared") != FORMAT:
        raise ShareError("This is not a PaperShelf shared list.")
    lid = str(data.get("id") or "")
    if not ID_RE.match(lid):
        raise ShareError("This shared list has an invalid id.")
    st = {"papershelf_shared": FORMAT, "id": lid, "clock": 0, "updated_at": str(data.get("updated_at") or "")[:40],
          "publisher": str(data.get("publisher") or "")[:60], "members": {}, "items": {}}
    for k, lim in (("name", 120), ("description", 1000)):
        v = data.get(k) if isinstance(data.get(k), dict) else {}
        st[k] = {"v": str(v.get("v") or "")[:lim], "s": _stamp(v.get("s"))}
    raw_members = data.get("members") if isinstance(data.get("members"), dict) else {}
    for name, m in list(raw_members.items())[:MAX_MEMBERS]:
        if not isinstance(m, dict) or not (NAME_RE.match(str(name)) or str(name).startswith("local-")):
            continue
        repo = str(m.get("repo") or "")
        st["members"][str(name)] = {"repo": repo if REPO_RE.match(repo) else "", "add": _stamp(m.get("add")),
                                    "rem": _stamp(m.get("rem"))}
    raw_items = data.get("items") if isinstance(data.get("items"), dict) else {}
    for key, e in list(raw_items.items())[:MAX_ITEMS]:
        if not isinstance(e, dict) or not isinstance(e.get("meta"), dict):
            continue
        meta = clean_meta(e["meta"])
        if not (meta.get("title") or meta.get("doi")):
            continue
        st["items"][item_key(meta)] = {"meta": meta, "add": _stamp(e.get("add")), "rem": _stamp(e.get("rem"))}
    st["clock"] = clock(st)
    return st


def summary(st: dict) -> dict:
    its = items(st)
    return {"id": st["id"], "name": st["name"]["v"], "description": (st.get("description") or {}).get("v", ""),
            "papers": len(its), "members": members(st), "updated_at": st.get("updated_at")}


# --------------------------------------------------------------------------- where lists live
def parse_code(text: str):
    """What the user typed to join a list -> (owner, repo, list_id or None).

    Accepted: "username", "username/list-id", "username/repo", "username/repo/list-id",
    or a github.com / raw.githubusercontent.com link to the repository or to a list file."""
    t = (text or "").strip().strip("/").removesuffix(".json")
    if t.startswith(("http://", "https://")):
        u = urlparse(t)
        parts = [p for p in u.path.split("/") if p]
        if u.netloc.endswith("raw.githubusercontent.com") and len(parts) >= 2:
            owner, repo = parts[0], parts[1]
            lid = parts[-1] if len(parts) > 3 and ID_RE.match(parts[-1]) else None
            return owner, repo, lid
        if u.netloc.endswith("github.com") and parts:
            owner = parts[0]
            repo = parts[1] if len(parts) > 1 else DEFAULT_REPO_NAME
            lid = parts[-1] if ID_RE.match(parts[-1]) and len(parts) > 2 else None
            return owner, repo, lid
        raise ShareError("That link is not a GitHub address.")
    parts = [p for p in re.split(r"[/:\s]+", t) if p]
    if not parts or not NAME_RE.match(parts[0]):
        raise ShareError("Type the GitHub user name of the person sharing (e.g. MirkoZanon), or the code they gave you.")
    owner = parts[0]
    if len(parts) == 1:
        return owner, DEFAULT_REPO_NAME, None
    if len(parts) == 2:
        return (owner, DEFAULT_REPO_NAME, parts[1]) if ID_RE.match(parts[1]) else (owner, parts[1], None)
    return owner, parts[1], parts[2] if ID_RE.match(parts[2]) else None


def list_path(list_id: str) -> str:
    return f"collections/{list_id}.json"


class GitHub:
    """Reads and writes the small JSON files of the sharing repositories."""

    def __init__(self, token: str = "", timeout: int = 20):
        self.token = (token or "").strip()
        self.timeout = timeout

    def _headers(self, auth=True):
        h = {"Accept": "application/vnd.github+json", "User-Agent": "PaperShelf-sharing"}
        if auth and self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _req(self, method, url, **kw):
        try:
            return requests.request(method, url, timeout=self.timeout, **kw)
        except requests.exceptions.RequestException as exc:
            raise ShareError(f"Could not reach GitHub ({exc.__class__.__name__}). Check your internet connection.") from exc

    def read(self, repo: str, path: str, fresh: bool = False):
        """The JSON file, or None if it doesn't exist. `fresh` (or a token) reads through the API
        (no cache delay); otherwise the public raw address is used (cached by GitHub for ~5 min)."""
        if not REPO_RE.match(repo or ""):
            return None
        if fresh or self.token:
            r = self._req("GET", f"{API}/repos/{repo}/contents/{path}", headers=self._headers())
            if r.status_code == 200:
                try:
                    return json.loads(base64.b64decode(r.json().get("content") or ""))
                except (ValueError, TypeError):
                    raise ShareError(f"The file {path} in {repo} is damaged.")
            if r.status_code == 404:
                return None
            if r.status_code not in (401, 403):
                raise ShareError(f"GitHub answered {r.status_code} for {repo}.")
        r = self._req("GET", f"{RAW}/{repo}/HEAD/{path}", headers={"User-Agent": "PaperShelf-sharing"})
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ShareError(f"GitHub answered {r.status_code} for {repo}.")
        try:
            return json.loads(r.content)
        except ValueError:
            raise ShareError(f"The file {path} in {repo} is not readable.")

    def write(self, repo: str, path: str, data: dict, message: str):
        if not self.token:
            raise ShareError("Publishing needs a GitHub token for your sharing repository (Settings → Sharing).")
        url = f"{API}/repos/{repo}/contents/{path}"
        body = json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
        cur = self._req("GET", url, headers=self._headers())
        sha = cur.json().get("sha") if cur.status_code == 200 else None
        if cur.status_code == 200:
            try:
                if base64.b64decode(cur.json().get("content") or "").decode("utf-8") == body:
                    return False  # unchanged
            except (ValueError, UnicodeDecodeError):
                pass
        payload = {"message": message, "content": base64.b64encode(body.encode("utf-8")).decode("ascii")}
        if sha:
            payload["sha"] = sha
        r = self._req("PUT", url, headers=self._headers(), json=payload)
        if r.status_code in (200, 201):
            return True
        if r.status_code == 409 or r.status_code == 422 and "sha" in (r.text or ""):
            raise ShareError("Someone else (another of your computers?) published at the same moment – try again.")
        if r.status_code in (401, 403):
            raise ShareError("GitHub refused to publish: the token is wrong, expired, or lacks "
                             "'Contents: Read and write' on your sharing repository.")
        if r.status_code == 404:
            raise ShareError(f"The repository {repo} was not found (or the token can't see it). Create it on GitHub first.")
        raise ShareError(f"GitHub answered {r.status_code} while publishing.")

    def check(self, repo: str) -> dict:
        """Does the repository exist, is it public, and may this token write to it?"""
        if not REPO_RE.match(repo or ""):
            raise ShareError("Write the repository as  your-name/papershelf-shared")
        r = self._req("GET", f"{API}/repos/{repo}", headers=self._headers())
        if r.status_code == 404:
            raise ShareError(f"{repo} doesn't exist on GitHub (or the token can't see it). Create it first – see the guide.")
        if r.status_code == 401:
            raise ShareError("GitHub doesn't accept this token (wrong or expired).")
        if r.status_code != 200:
            raise ShareError(f"GitHub answered {r.status_code}.")
        d = r.json()
        perms = d.get("permissions") or {}
        return {"private": bool(d.get("private")), "can_write": bool(perms.get("push") or perms.get("admin")),
                "owner": (d.get("owner") or {}).get("login") or repo.split("/")[0]}
