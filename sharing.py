"""
sharing.py - shared paper lists between PaperShelf users.

What is shared
--------------
Only the bibliographic details of the papers in a list (DOI, title, authors, year, journal, link).
Never PDFs, notes, highlights or anything else from your library.

Where
-----
Each person who shares has one SECRET gist on GitHub, created automatically by PaperShelf with the
same token used for library sync (it needs the "Gists" permission). A secret gist is not listed
anywhere: only people who have its code can read it. It holds:

    index.json            the shared labels kept there (name, number of papers, date)
    list-<list-id>.json   one file per shared label: its papers and its members

Everybody's PaperShelf reads the gists of all the members of a list, merges them with its own copy
and writes the result back to its own gist. Following a list needs no account; editing it needs the
token. When someone joins as a member, their PaperShelf leaves a short comment on the inviting
person's gist with the address of its own gist (GitHub signs comments with the author's account, so
nobody can pretend to be someone else); that is how the members find each other.

(Version 1.9 used a public repository "<name>/papershelf-shared" instead; lists stored there can still
be read.)

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
GIST_RE = re.compile(r"^[a-f0-9]{20,40}$")
SRC_RE = re.compile(r"^gist:[a-f0-9]{20,40}$")
ID_RE = re.compile(r"^[a-f0-9]{12}$")
GIST_DESCRIPTION = "PaperShelf shared labels (managed by the PaperShelf app – titles and DOIs only)"
JOIN_PREFIX = "PaperShelf sharing:"
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
def new_state(name: str, author: str, repo: str = "", list_id: str | None = None, display_name: str = "") -> dict:
    st = {"papershelf_shared": FORMAT, "id": list_id or new_id(), "clock": 0,
          "name": {"v": "", "s": None}, "description": {"v": "", "s": None},
          "members": {}, "items": {}, "updated_at": _now(), "publisher": author}
    set_name(st, author, name or "Shared list")
    set_member(st, author, author, repo)
    st["creator"] = {"by": author, "name": (display_name or "")[:60], "at": _now()}
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
    for e in st.get("items", {}).values():
        for n in (e.get("notes") or {}).values():
            if n.get("s"):
                c = max(c, n["s"][0])
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


# --------------------------------------------------------------------------- public notes
# Each paper of a shared label can carry notes. A note belongs to its author: only versions written
# by the author (stamp author == note author) are accepted when merging, so nobody can change or
# delete someone else's note for everybody (others can only hide it on their own computer).
MAX_NOTE = 20000


def add_note(st, author, key, body, name="") -> str:
    e = st["items"].get(key)
    if e is None:
        raise ShareError("This paper is not in the shared label.")
    nid = uuid.uuid4().hex[:16]
    e.setdefault("notes", {})[nid] = {"by": author, "name": (name or "")[:60], "body": (body or "")[:MAX_NOTE],
                                      "created": _now(), "at": _now(), "del": False, "s": tick(st, author)}
    e["notes"][nid]["c"] = e["notes"][nid]["s"][0]  # creation order (stays when the note is edited)
    return nid


def edit_note(st, author, key, nid, body=None, name=None, delete=False):
    n = ((st["items"].get(key) or {}).get("notes") or {}).get(nid)
    if not n:
        raise ShareError("Note not found.")
    if n.get("by") != author:
        raise ShareError("Only the author can change this note for everybody.")
    n.update(at=_now(), s=tick(st, author))
    if delete:
        n.update(body="", **{"del": True})
    else:
        if body is not None:
            n["body"] = body[:MAX_NOTE]
        if name:
            n["name"] = name[:60]


def notes_of(e) -> list:
    """Visible notes of an item, oldest first."""
    return sorted((dict(v, id=k) for k, v in (e.get("notes") or {}).items() if not v.get("del")),
                  key=lambda n: (n.get("created") or "", n.get("c") or (n.get("s") or [0])[0], n.get("id")))


def _merge_notes(x: dict, y: dict) -> dict:
    out = {}
    for nid in set(x) | set(y):
        cands = [n for n in (x.get(nid), y.get(nid)) if n and n.get("s") and n["s"][1] == n.get("by")]
        if not cands:
            continue
        best = cands[0]
        for c in cands[1:]:
            if newer(c.get("s"), best.get("s")):
                best = c
        out[nid] = dict(best)
    return out


def trust_author_copy(st: dict, owner: str, copy: dict):
    """The copy published by `owner` (read from owner's own gist) is the authority on owner's notes:
    a version of one of owner's notes found in someone else's copy but not in owner's is dropped,
    so a member can't forge or change another member's note by editing their own copy by hand."""
    for key, e in (st.get("items") or {}).items():
        mine = ((copy.get("items") or {}).get(key) or {})
        if not mine:
            continue  # owner doesn't have this paper: nothing to compare with
        theirs = mine.get("notes") or {}
        for nid, n in list((e.get("notes") or {}).items()):
            if n.get("by") != owner:
                continue
            if nid not in theirs:
                del e["notes"][nid]
            elif n != theirs[nid]:
                e["notes"][nid] = dict(theirs[nid])


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
    ca, cb = a.get("creator"), b.get("creator")
    if ca or cb:
        out["creator"] = dict(min([c for c in (ca, cb) if c], key=lambda c: c.get("at") or "9"))
    out["items"] = {}
    for key in set(a.get("items", {})) | set(b.get("items", {})):
        x, y = a["items"].get(key), b["items"].get(key)
        if not x or not y:
            out["items"][key] = dict(x or y)
            continue
        src = y if newer(y.get("add"), x.get("add")) else x
        out["items"][key] = {"meta": src.get("meta") or x.get("meta") or y.get("meta"),
                             "add": latest(x.get("add"), y.get("add")), "rem": latest(x.get("rem"), y.get("rem"))}
        notes = _merge_notes(x.get("notes") or {}, y.get("notes") or {})
        if notes:
            out["items"][key]["notes"] = notes
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
        st["members"][str(name)] = {"repo": repo if (REPO_RE.match(repo) or SRC_RE.match(repo)) else "", "add": _stamp(m.get("add")),
                                    "rem": _stamp(m.get("rem"))}
    raw_items = data.get("items") if isinstance(data.get("items"), dict) else {}
    for key, e in list(raw_items.items())[:MAX_ITEMS]:
        if not isinstance(e, dict) or not isinstance(e.get("meta"), dict):
            continue
        meta = clean_meta(e["meta"])
        if not (meta.get("title") or meta.get("doi")):
            continue
        item = {"meta": meta, "add": _stamp(e.get("add")), "rem": _stamp(e.get("rem"))}
        raw_notes = e.get("notes") if isinstance(e.get("notes"), dict) else {}
        notes = {}
        for nid, n in list(raw_notes.items())[:300]:
            if not (isinstance(n, dict) and re.match(r"^[a-f0-9]{8,32}$", str(nid))):
                continue
            by = str(n.get("by") or "")
            stp = _stamp(n.get("s"))
            if not (NAME_RE.match(by) or by.startswith("local-")) or not stp or stp[1] != by:
                continue  # a version not written by the note's author is ignored
            notes[str(nid)] = {"by": by, "name": str(n.get("name") or "")[:60], "body": str(n.get("body") or "")[:MAX_NOTE],
                               "created": str(n.get("created") or "")[:40], "at": str(n.get("at") or "")[:40],
                               "del": bool(n.get("del")), "s": stp,
                               "c": n["c"] if isinstance(n.get("c"), int) and 0 <= n["c"] <= stp[0] else stp[0]}
        if notes:
            item["notes"] = notes
        st["items"][item_key(meta)] = item
    c = data.get("creator") if isinstance(data.get("creator"), dict) else None
    if c and (NAME_RE.match(str(c.get("by") or "")) or str(c.get("by") or "").startswith("local-")):
        st["creator"] = {"by": str(c["by"])[:60], "name": str(c.get("name") or "")[:60], "at": str(c.get("at") or "")[:40]}
    st["clock"] = clock(st)
    return st


def summary(st: dict) -> dict:
    its = items(st)
    return {"id": st["id"], "name": st["name"]["v"], "description": (st.get("description") or {}).get("v", ""),
            "papers": len(its), "members": members(st), "updated_at": st.get("updated_at"),
            "creator": st.get("creator") or {},
            "notes": sum(len(notes_of(e)) for e in its.values())}


# --------------------------------------------------------------------------- where lists live
# A "source" is where a member keeps their copies: "gist:<id>" (current) or "owner/repo" (version 1.9).
def is_gist(src: str) -> bool:
    return bool(SRC_RE.match(src or ""))


def file_for(src: str, kind: str, list_id: str = "") -> str:
    if is_gist(src):
        return "index.json" if kind == "index" else f"list-{list_id}.json"
    return "index.json" if kind == "index" else f"collections/{list_id}.json"


def list_path(list_id: str) -> str:  # version 1.9 layout
    return f"collections/{list_id}.json"


def parse_code(text: str):
    """What the user typed to join -> (owner, source, list_id or None).

    Accepted: "owner/<gist-id>/<list-id>" (the code shown in PaperShelf), "owner/<gist-id>",
    a gist.github.com link, and the version-1.9 forms "owner", "owner/<list-id>", github.com links."""
    t = (text or "").strip().strip("/").removesuffix(".json")
    if t.startswith(("http://", "https://")):
        u = urlparse(t)
        parts = [p for p in u.path.split("/") if p]
        if u.netloc.endswith("gist.github.com") or u.netloc.endswith("gist.githubusercontent.com"):
            gid = next((p for p in parts if GIST_RE.match(p)), None)
            if not gid or not parts:
                raise ShareError("That gist link is incomplete.")
            lid = (u.fragment or "").removeprefix("list-")
            return parts[0], "gist:" + gid, lid if ID_RE.match(lid or "") else None
        if u.netloc.endswith("raw.githubusercontent.com") and len(parts) >= 2:
            lid = parts[-1] if ID_RE.match(parts[-1]) else None
            return parts[0], f"{parts[0]}/{parts[1]}", lid
        if u.netloc.endswith("github.com") and parts:
            owner = parts[0]
            repo = parts[1] if len(parts) > 1 else DEFAULT_REPO_NAME
            lid = parts[-1] if ID_RE.match(parts[-1]) and len(parts) > 2 else None
            return owner, f"{owner}/{repo}", lid
        raise ShareError("That link is not a GitHub address.")
    parts = [p for p in re.split(r"[/:\s#]+", t) if p]
    if not parts or not NAME_RE.match(parts[0]):
        raise ShareError("Paste the code your colleague gave you (it looks like  MarioRossi/1a2b3c…/9f8e…).")
    owner = parts[0]
    if len(parts) >= 2 and GIST_RE.match(parts[1]):
        lid = parts[2] if len(parts) > 2 and ID_RE.match(parts[2]) else None
        return owner, "gist:" + parts[1], lid
    if len(parts) == 1:
        return owner, f"{owner}/{DEFAULT_REPO_NAME}", None
    if ID_RE.match(parts[1]):
        return owner, f"{owner}/{DEFAULT_REPO_NAME}", parts[1]
    return owner, f"{owner}/{parts[1]}", parts[2] if len(parts) > 2 and ID_RE.match(parts[2]) else None


def make_code(owner: str, src: str, list_id: str = "") -> str:
    if is_gist(src):
        return f"{owner}/{src[5:]}" + (f"/{list_id}" if list_id else "")
    return f"{owner}/{list_id}" if list_id else owner


def join_comment(member: str, src: str, list_id: str) -> str:
    return JOIN_PREFIX + " " + json.dumps({"member": member, "src": src, "list": list_id})


def parse_join_comment(body: str):
    body = (body or "").strip()
    if not body.startswith(JOIN_PREFIX):
        return None
    try:
        d = json.loads(body[len(JOIN_PREFIX):].strip())
    except ValueError:
        return None
    if not (isinstance(d, dict) and NAME_RE.match(str(d.get("member") or "")) and SRC_RE.match(str(d.get("src") or ""))
            and ID_RE.match(str(d.get("list") or ""))):
        return None
    return d


class GitHub:
    """Reads and writes the small JSON files of the shared labels (gists; 1.9 repositories read-only)."""

    def __init__(self, token: str = "", timeout: int = 20):
        self.token = (token or "").strip()
        self.timeout = timeout
        self._gists = {}  # gist id -> files, cached for one update round
        self._owners = {}  # gist id -> GitHub login of its owner (checked when reading a member's copy)

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

    def _json(self, raw, where):
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            raise ShareError(f"The shared file {where} is damaged.")

    # ---- account and gist
    def whoami(self) -> str:
        if not self.token:
            raise ShareError("Paste your GitHub token first (Settings → GitHub sync & sharing).")
        r = self._req("GET", f"{API}/user", headers=self._headers())
        if r.status_code == 401:
            raise ShareError("GitHub doesn't accept this token (wrong or expired).")
        if r.status_code != 200:
            raise ShareError(f"GitHub answered {r.status_code}.")
        return r.json().get("login") or ""

    def find_or_create_gist(self) -> str:
        """Your shared-labels gist: found among your gists, or created (secret)."""
        page = 1
        while page <= 10:
            r = self._req("GET", f"{API}/gists", headers=self._headers(), params={"per_page": 100, "page": page})
            if r.status_code in (401, 403, 404):
                raise ShareError(NEEDS_GISTS)
            if r.status_code != 200:
                raise ShareError(f"GitHub answered {r.status_code}.")
            batch = r.json()
            for g in batch:
                if g.get("description") == GIST_DESCRIPTION:
                    return g["id"]
            if len(batch) < 100:
                break
            page += 1
        body = {"description": GIST_DESCRIPTION, "public": False, "files": {"index.json": {"content": json.dumps(
            {"papershelf_shared": FORMAT, "lists": []}, indent=1) + "\n"}}}
        r = self._req("POST", f"{API}/gists", headers=self._headers(), json=body)
        if r.status_code in (401, 403, 404, 422):
            raise ShareError(NEEDS_GISTS)
        if r.status_code not in (200, 201):
            raise ShareError(f"GitHub answered {r.status_code} while creating the gist.")
        return r.json()["id"]

    def _gist_files(self, gid: str, fresh: bool):
        if gid in self._gists and not fresh:
            return self._gists[gid]
        r = self._req("GET", f"{API}/gists/{gid}", headers=self._headers())
        if r.status_code == 404:
            self._gists[gid] = None
            return None
        if r.status_code != 200:
            raise ShareError(f"GitHub answered {r.status_code}" + (" (too many requests without a token – try later)" if r.status_code == 403 else ""))
        files = {}
        self._owners[gid] = ((r.json().get("owner") or {}).get("login") or "")
        for name, f in (r.json().get("files") or {}).items():
            if f.get("truncated") and f.get("raw_url"):
                rr = self._req("GET", f["raw_url"], headers={"User-Agent": "PaperShelf-sharing"})
                files[name] = rr.text if rr.status_code == 200 else None
            else:
                files[name] = f.get("content")
        self._gists[gid] = files
        return files

    def read_src(self, owner: str, src: str, kind: str, list_id: str = "", fresh: bool = False):
        """A shared file (index or list) from a member's gist (or 1.9 repository); None if missing."""
        name = file_for(src, kind, list_id)
        if is_gist(src):
            gid = src[5:]
            if self.token or fresh:
                files = self._gist_files(gid, fresh)
                if files is None or files.get(name) is None:
                    return None
                real = self._owners.get(gid) or ""
                if owner and real and real.lower() != owner.lower():
                    raise ShareError(f"the copy said to be {owner}'s is in a gist of {real} - ignored.")
                return self._json(files[name], name)
            r = self._req("GET", f"https://gist.githubusercontent.com/{owner}/{gid}/raw/{name}",
                          headers={"User-Agent": "PaperShelf-sharing"})
            if r.status_code == 404:
                return None
            if r.status_code != 200:
                raise ShareError(f"GitHub answered {r.status_code} for {owner}'s shared labels.")
            return self._json(r.content, name)
        if not REPO_RE.match(src or ""):
            return None
        return self.read(src, name, fresh)

    def publish(self, src: str, files: dict):
        """Write {filename: data} into your own gist in one go."""
        if not (self.token and is_gist(src)):
            raise ShareError("Sharing is not set up (Settings → GitHub sync & sharing → Share labels).")
        gid = src[5:]
        body = {"files": {n: {"content": json.dumps(d, indent=1, sort_keys=True, ensure_ascii=False) + "\n"} for n, d in files.items()}}
        r = self._req("PATCH", f"{API}/gists/{gid}", headers=self._headers(), json=body)
        if r.status_code in (200, 201):
            self._gists.pop(gid, None)
            return True
        if r.status_code in (401, 403):
            raise ShareError(NEEDS_GISTS)
        if r.status_code == 404:
            raise ShareError("Your shared-labels gist was not found – turn sharing off and on again in Settings → GitHub sync & sharing.")
        raise ShareError(f"GitHub answered {r.status_code} while publishing.")

    def comment(self, src: str, body: str):
        if is_gist(src) and self.token:
            r = self._req("POST", f"{API}/gists/{src[5:]}/comments", headers=self._headers(), json={"body": body})
            if r.status_code not in (200, 201):
                raise ShareError(f"GitHub answered {r.status_code} while announcing you to the list.")

    def comments(self, src: str) -> list:
        if not (is_gist(src) and self.token):
            return []
        r = self._req("GET", f"{API}/gists/{src[5:]}/comments", headers=self._headers(), params={"per_page": 100})
        if r.status_code != 200:
            return []
        return [{"id": c.get("id"), "user": (c.get("user") or {}).get("login") or "", "body": c.get("body") or ""}
                for c in r.json() if isinstance(c, dict)]

    def delete_comment(self, src: str, cid):
        if is_gist(src) and self.token and cid:
            self._req("DELETE", f"{API}/gists/{src[5:]}/comments/{cid}", headers=self._headers())

    # ---- version 1.9 repositories (read only now)
    def read(self, repo: str, path: str, fresh: bool = False):
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
        return self._json(r.content, path)


NEEDS_GISTS = ("Your GitHub token can't use gists. Edit the token on GitHub (Settings → Developer settings → "
               "Personal access tokens → Fine-grained tokens → your token → Edit) and under Account permissions set "
               "“Gists” to Read and write, then click Update – no new token needed. See the guide (Shared labels).")
