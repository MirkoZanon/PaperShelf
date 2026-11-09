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
    for pr in (st.get("profiles") or {}).values():
        if pr.get("s"):
            c = max(c, pr["s"][0])
    for col in (st.get("cols") or {}).values():
        if col.get("s"):
            c = max(c, col["s"][0])
    if st.get("lab"):
        c = max(c, _lab_stamps(st["lab"]))
    for x in (st.get("aliases") or {}).values():
        c = max(c, (x.get("s") or [0])[0])
    for e in st.get("items", {}).values():
        for cell in (e.get("cells") or {}).values():
            for n in cell.values():
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


def set_profile(st, author, name) -> bool:
    """The name `author` shows to the other members (each member sets only their own). True if changed."""
    name = " ".join(str(name or "").split())[:60]
    cur = (st.get("profiles") or {}).get(author) or {}
    if cur.get("name") == name:
        return False
    st.setdefault("profiles", {})[author] = {"name": name, "since": cur.get("since") or _now(), "s": tick(st, author)}
    return True


def profiles(st) -> dict:
    out = {k: v.get("name") or "" for k, v in (st.get("profiles") or {}).items()}
    for loc, a in (st.get("aliases") or {}).items():   # what you wrote before publishing shows your name
        if a.get("v"):
            out.setdefault(loc, out.get(a["v"]) or a["v"])
    return out


# --------------------------------------------------------------------------- your computer's placeholder
# A group created before you set up GitHub has you as "local-<computer>". When you start publishing,
# that placeholder becomes you: it leaves the members and everything it wrote shows your name.
# If two people ever claim the same placeholder, nobody gets it (it stays a nameless placeholder).
def adopt_local(st, user, local) -> bool:
    if not local.startswith("local-") or not NAME_RE.match(user):
        return False
    changed = False
    al = st.setdefault("aliases", {})
    if local not in al:
        al[local] = {"v": user, "s": tick(st, user)}
        changed = True
    m = (st.get("members") or {}).get(local)
    if m and present(m):
        set_member(st, user, local, remove=True)
        changed = True
    return changed


def canon(st, a) -> str:
    """The real member behind an author id (a computer's placeholder → its owner)."""
    return ((st.get("aliases") or {}).get(a) or {}).get("v") or a


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
        raise ShareError("This paper is not in the group.")
    nid = uuid.uuid4().hex[:16]
    e.setdefault("notes", {})[nid] = {"by": author, "name": (name or "")[:60], "body": (body or "")[:MAX_NOTE],
                                      "created": _now(), "at": _now(), "del": False, "s": tick(st, author)}
    e["notes"][nid]["c"] = e["notes"][nid]["s"][0]  # creation order (stays when the note is edited)
    return nid


def edit_note(st, author, key, nid, body=None, name=None, delete=False):
    n = ((st["items"].get(key) or {}).get("notes") or {}).get(nid)
    if not n:
        raise ShareError("Note not found.")
    if n.get("by") != author and canon(st, n.get("by")) != author:
        raise ShareError("Only the author can change this note for everybody.")
    n["by"] = author
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


# --------------------------------------------------------------------------- the group's table
# A review table shared by the group: columns any editor can add, rename, move or delete (the newest
# change wins), and in each cell (paper × column) a list of entries, like messages: each entry belongs
# to its author – only versions written by the author are accepted, exactly like public notes.
MAX_CELL = 5000
MAX_COLS = 24
DEFAULT_COLS = ["Question / aim", "Method", "Data / sample", "Main result", "Limitations"]
COL_RE = re.compile(r"^[a-z0-9]{1,16}$")


def set_col(st, author, cid, name=None, pos=None, delete=False):
    cols = st.setdefault("cols", {})
    cur = dict(cols.get(cid) or {"name": "Column", "pos": float(len(cols) + 1), "del": False})
    if name is not None:
        cur["name"] = " ".join(str(name).split())[:60] or "Column"
    if pos is not None:
        cur["pos"] = float(pos)
    cur["del"] = bool(delete)
    cur["s"] = tick(st, author)
    cols[cid] = cur


def ensure_cols(st, author) -> bool:
    """The usual first columns, with fixed ids so that two editors starting at once don't duplicate them."""
    if st.get("cols"):
        return False
    for i, n in enumerate(DEFAULT_COLS, 1):
        set_col(st, author, f"c{i}", name=n, pos=i)
    return True


def table_cols(st) -> list:
    return sorted(({"id": k, "name": v.get("name") or "Column", "pos": v.get("pos") or 0}
                   for k, v in (st.get("cols") or {}).items() if not v.get("del")), key=lambda c: (c["pos"], c["id"]))


def add_cell(st, author, key, cid, body, name="") -> str:
    e = st["items"].get(key)
    if e is None:
        raise ShareError("This paper is not in the group.")
    if cid not in (st.get("cols") or {}) or st["cols"][cid].get("del"):
        raise ShareError("That column doesn't exist any more.")
    eid = uuid.uuid4().hex[:16]
    s = tick(st, author)
    e.setdefault("cells", {}).setdefault(cid, {})[eid] = {"by": author, "name": (name or "")[:60], "body": (body or "")[:MAX_CELL],
                                                         "created": _now(), "at": _now(), "del": False, "s": s, "c": s[0]}
    return eid


def edit_cell(st, author, key, cid, eid, body=None, name=None, delete=False):
    n = (((st["items"].get(key) or {}).get("cells") or {}).get(cid) or {}).get(eid)
    if not n:
        raise ShareError("Entry not found.")
    if n.get("by") != author and canon(st, n.get("by")) != author:
        raise ShareError("Only the author can change this entry.")
    n["by"] = author
    n.update(at=_now(), s=tick(st, author))
    if delete:
        n.update(body="", **{"del": True})
    else:
        if body is not None:
            n["body"] = body[:MAX_CELL]
        if name:
            n["name"] = name[:60]


def cell_entries(e, cid) -> list:
    return notes_of({"notes": ((e.get("cells") or {}).get(cid) or {})})


def _merge_cols(x: dict, y: dict) -> dict:
    out = {}
    for cid in set(x) | set(y):
        a, b = x.get(cid), y.get(cid)
        out[cid] = dict(b if a is None or (b is not None and newer(b.get("s"), a.get("s"))) else a)
    return out


# --------------------------------------------------------------------------- the group's lab
# A place for the group's own research, beyond single papers:
#  - posts (ideas, experiments, questions, results, decisions…) with comments – each belongs to its
#    author, exactly like public notes; members can 👍 support a post (one vote each) and pin it;
#  - plans (milestones) and tasks (to do / doing / done, who, by when) that any editor can change:
#    every field on its own, the newest change wins.
LAB_KINDS = ("idea", "experiment", "question", "result", "decision", "protocol", "note")
TASK_STATUS = ("todo", "doing", "done")
TASK_PRIO = ("high", "normal", "low")
MAX_POST, MAX_COMMENT = 20000, 5000
LAB_LIMITS = {"posts": 2000, "comments": 10000, "plans": 300, "tasks": 3000, "checks": 20000}
OID_RE = re.compile(r"^[a-f0-9]{8,32}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _lab(st) -> dict:
    lab = st.setdefault("lab", {})
    for k in ("posts", "comments", "votes", "pins", "plans", "tasks", "checks"):
        lab.setdefault(k, {})
    return lab


def clean_people(v) -> list:
    """A list of members (who a task is for, or who a post or comment is addressed to)."""
    out = []
    for a in (v if isinstance(v, list) else [])[:12]:
        a = str(a)[:60]
        if (NAME_RE.match(a) or a.startswith("local-")) and a not in out:
            out.append(a)
    return out


def task_people(t) -> list:
    """Who a task is for (several people since 2.13.1; one before)."""
    return t.get("assignees") if isinstance(t.get("assignees"), list) else ([t["assignee"]] if t.get("assignee") else [])


def _clean_tags(tags) -> list:
    out = []
    for t in (tags or [])[:8]:
        t = " ".join(str(t).replace("#", "").split())[:30]
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t)
    return out


def add_post(st, author, name, kind, title, body, tags=(), papers=(), to=()) -> str:
    lab = _lab(st)
    if len(lab["posts"]) >= LAB_LIMITS["posts"]:
        raise ShareError("This group has too many posts.")
    pid = uuid.uuid4().hex[:16]
    s = tick(st, author)
    lab["posts"][pid] = {"by": author, "name": (name or "")[:60], "kind": kind if kind in LAB_KINDS else "idea",
                         "title": " ".join(str(title or "").split())[:200], "body": str(body or "")[:MAX_POST],
                         "tags": _clean_tags(tags), "papers": [str(k)[:80] for k in (papers or [])][:20],
                         "to": clean_people(list(to or [])), "created": _now(), "at": _now(), "del": False, "s": s, "c": s[0]}
    return pid


def edit_post(st, author, pid, delete=False, **fields):
    n = _lab(st)["posts"].get(pid)
    if not n or n.get("del"):
        raise ShareError("Post not found.")
    if n.get("by") != author and canon(st, n.get("by")) != author:
        raise ShareError("Only the author can change this post.")
    n["by"] = author
    if delete:
        n.update(body="", title="", tags=[], papers=[], **{"del": True})
    else:
        if "kind" in fields and fields["kind"] in LAB_KINDS:
            n["kind"] = fields["kind"]
        if fields.get("title") is not None:
            n["title"] = " ".join(str(fields["title"]).split())[:200]
        if fields.get("body") is not None:
            n["body"] = str(fields["body"])[:MAX_POST]
        if fields.get("tags") is not None:
            n["tags"] = _clean_tags(fields["tags"])
        if fields.get("papers") is not None:
            n["papers"] = [str(k)[:80] for k in fields["papers"]][:20]
        if fields.get("to") is not None:
            n["to"] = clean_people(fields["to"])
        if fields.get("name"):
            n["name"] = str(fields["name"])[:60]
    n.update(at=_now(), s=tick(st, author))


def add_comment(st, author, name, post, body, to=()) -> str:
    lab = _lab(st)
    if post not in lab["posts"] or lab["posts"][post].get("del"):
        raise ShareError("That post doesn't exist any more.")
    if len(lab["comments"]) >= LAB_LIMITS["comments"]:
        raise ShareError("This group has too many comments.")
    cid = uuid.uuid4().hex[:16]
    s = tick(st, author)
    lab["comments"][cid] = {"post": post, "by": author, "name": (name or "")[:60], "body": str(body or "")[:MAX_COMMENT],
                            "to": clean_people(list(to or [])),
                            "created": _now(), "at": _now(), "del": False, "s": s, "c": s[0]}
    return cid


def edit_comment(st, author, cid, body=None, delete=False, to=None):
    n = _lab(st)["comments"].get(cid)
    if not n or n.get("del"):
        raise ShareError("Comment not found.")
    if n.get("by") != author and canon(st, n.get("by")) != author:
        raise ShareError("Only the author can change this comment.")
    n["by"] = author
    if delete:
        n.update(body="", **{"del": True})
    else:
        if body is not None:
            n["body"] = str(body)[:MAX_COMMENT]
        if to is not None:
            n["to"] = clean_people(to)
    n.update(at=_now(), s=tick(st, author))


def set_vote(st, author, post, v: bool):
    _lab(st)["votes"].setdefault(post, {})[author] = {"v": bool(v), "s": tick(st, author)}


def set_pin(st, author, post, v: bool):
    _lab(st)["pins"][post] = {"v": bool(v), "s": tick(st, author)}


PLAN_FIELDS = {"name": 120, "goal": 3000, "due": 10, "owners": None, "pos": None, "del": None, "done": None}
# the checklist of a task: each item on its own, so two people ticking different items never clash
CHECK_FIELDS = {"task": 32, "text": 300, "done": None, "pos": None, "del": None}
SPECS = {"plans": PLAN_FIELDS, "tasks": None, "checks": CHECK_FIELDS}
TASK_FIELDS = {"title": 300, "notes": 5000, "status": None, "assignee": 60, "assignees": None, "due": 10, "plan": 32, "paper": 80,
               "post": 32, "prio": None, "pos": None, "del": None}


def _field_ok(coll, k, v):
    """The cleaned value of a field of a plan or task, or raise ValueError."""
    spec = {"plans": PLAN_FIELDS, "checks": CHECK_FIELDS}.get(coll, TASK_FIELDS)
    if k not in spec:
        raise ValueError(k)
    if k in ("del", "done"):
        return bool(v)
    if k == "pos":
        return float(v or 0)
    if k == "status":
        if v not in TASK_STATUS:
            raise ValueError(k)
        return v
    if k == "prio":
        return v if v in TASK_PRIO else "normal"
    if k in ("assignees", "owners"):
        return clean_people(v)
    v = str(v or "")
    if k == "due" and v and not DATE_RE.match(v):
        raise ValueError(k)
    if k in ("plan", "post", "task") and v and not OID_RE.match(v):
        raise ValueError(k)
    return (" ".join(v.split()) if k in ("title", "name", "assignee", "text") else v)[:spec[k]]


def set_fields(st, author, coll, oid=None, **fields) -> str:
    """Create (oid None) or change a plan or a task: each field keeps its newest value."""
    lab = _lab(st)
    if oid is None:
        if len(lab[coll]) >= LAB_LIMITS[coll]:
            raise ShareError("This group has too many " + coll + ".")
        oid = uuid.uuid4().hex[:16]
        lab[coll][oid] = {"by": author, "created": _now(), "f": {}}
    o = lab[coll].get(oid)
    if not o:
        raise ShareError("Not found.")
    s = tick(st, author)
    for k, v in fields.items():
        try:
            o["f"][k] = {"v": _field_ok(coll, k, v), "s": s}
        except (ValueError, TypeError):
            raise ShareError(f"Invalid value for {k}.")
    return oid


def obj_fields(o) -> dict:
    return {k: f.get("v") for k, f in (o.get("f") or {}).items()}


def lab_view(st) -> dict:
    """Everything visible in the lab, ready for the app."""
    lab = st.get("lab") or {}
    alive = lambda d: {k: dict(v, id=k) for k, v in (d or {}).items() if not v.get("del")}
    posts, comments = alive(lab.get("posts")), alive(lab.get("comments"))
    for c in comments.values():
        if c["post"] in posts:
            posts[c["post"]].setdefault("comments", []).append(c)
    for pid, p in posts.items():
        p["comments"] = sorted(p.get("comments") or [], key=lambda c: (c.get("created") or "", c.get("c") or 0))
        p["votes"] = sorted(a for a, v in ((lab.get("votes") or {}).get(pid) or {}).items() if v.get("v"))
        p["pinned"] = bool(((lab.get("pins") or {}).get(pid) or {}).get("v"))
    objs = lambda d: [dict(obj_fields(o), id=k, by=o.get("by"), created=o.get("created")) for k, o in (d or {}).items()
                      if not obj_fields(o).get("del")]
    tasks = sorted(objs(lab.get("tasks")), key=lambda t: (t.get("pos") or 0, t.get("created") or ""))
    checks = {}
    for c in sorted(objs(lab.get("checks")), key=lambda c: (c.get("pos") or 0, c.get("created") or "")):
        checks.setdefault(c.get("task") or "", []).append({"id": c["id"], "text": c.get("text") or "", "done": bool(c.get("done"))})
    for t in tasks:
        t["checklist"] = checks.get(t["id"], [])
    return {"posts": sorted(posts.values(), key=lambda p: (p.get("created") or ""), reverse=True),
            "plans": sorted(objs(lab.get("plans")), key=lambda p: (p.get("pos") or 0, p.get("created") or "")),
            "tasks": tasks}


def _merge_fields(x: dict, y: dict) -> dict:
    out = {}
    for oid in set(x) | set(y):
        a, b = x.get(oid), y.get(oid)
        if not a or not b:
            out[oid] = json.loads(json.dumps(a or b))
            continue
        first = a if (a.get("created") or "9") <= (b.get("created") or "9") else b
        f = {}
        for k in set(a.get("f") or {}) | set(b.get("f") or {}):
            fa, fb = (a.get("f") or {}).get(k), (b.get("f") or {}).get(k)
            f[k] = dict(fb if fa is None or (fb is not None and newer(fb.get("s"), fa.get("s"))) else fa)
        out[oid] = {"by": first.get("by"), "created": first.get("created"), "f": f}
    return out


def _merge_lab(a: dict, b: dict) -> dict:
    a, b = a or {}, b or {}
    out = {"posts": _merge_notes(a.get("posts") or {}, b.get("posts") or {}),
           "comments": _merge_notes(a.get("comments") or {}, b.get("comments") or {}),
           "plans": _merge_fields(a.get("plans") or {}, b.get("plans") or {}),
           "tasks": _merge_fields(a.get("tasks") or {}, b.get("tasks") or {}),
           "checks": _merge_fields(a.get("checks") or {}, b.get("checks") or {}), "votes": {}, "pins": {}}
    for pid in set(a.get("votes") or {}) | set(b.get("votes") or {}):
        va, vb = (a.get("votes") or {}).get(pid) or {}, (b.get("votes") or {}).get(pid) or {}
        d = {}
        for who in set(va) | set(vb):
            cands = [v for v in (va.get(who), vb.get(who)) if v and v.get("s") and v["s"][1] == who]
            if cands:
                d[who] = dict(max(cands, key=lambda v: tuple(v["s"])))
        if d:
            out["votes"][pid] = d
    for pid in set(a.get("pins") or {}) | set(b.get("pins") or {}):
        x, y = (a.get("pins") or {}).get(pid), (b.get("pins") or {}).get(pid)
        out["pins"][pid] = dict(y if x is None or (y is not None and newer(y.get("s"), x.get("s"))) else x)
    return out


def _lab_stamps(lab) -> int:
    c = 0
    for k in ("posts", "comments"):
        for n in (lab.get(k) or {}).values():
            c = max(c, (n.get("s") or [0])[0])
    for k in ("plans", "tasks", "checks"):
        for o in (lab.get(k) or {}).values():
            for f in (o.get("f") or {}).values():
                c = max(c, (f.get("s") or [0])[0])
    for d in (lab.get("votes") or {}).values():
        for v in d.values():
            c = max(c, (v.get("s") or [0])[0])
    for v in (lab.get("pins") or {}).values():
        c = max(c, (v.get("s") or [0])[0])
    return c


def _validate_lab(raw) -> dict:
    lab = {"posts": {}, "comments": {}, "votes": {}, "pins": {}, "plans": {}, "tasks": {}, "checks": {}}
    if not isinstance(raw, dict):
        return lab
    ok_name = lambda a: bool(NAME_RE.match(a) or a.startswith("local-"))
    for coll, lim in (("posts", MAX_POST), ("comments", MAX_COMMENT)):
        src = raw.get(coll) if isinstance(raw.get(coll), dict) else {}
        for oid, n in list(src.items())[:LAB_LIMITS[coll]]:
            if not (isinstance(n, dict) and OID_RE.match(str(oid))):
                continue
            by, stp = str(n.get("by") or ""), _stamp(n.get("s"))
            if not ok_name(by) or not stp or stp[1] != by:
                continue
            o = {"by": by, "name": str(n.get("name") or "")[:60], "body": str(n.get("body") or "")[:lim],
                 "created": str(n.get("created") or "")[:40], "at": str(n.get("at") or "")[:40], "del": bool(n.get("del")), "s": stp,
                 "c": n["c"] if isinstance(n.get("c"), int) and 0 <= n["c"] <= stp[0] else stp[0]}
            if n.get("to"):
                o["to"] = clean_people(n.get("to"))
            if coll == "posts":
                o.update(kind=n.get("kind") if n.get("kind") in LAB_KINDS else "idea", title=" ".join(str(n.get("title") or "").split())[:200],
                         tags=_clean_tags(n.get("tags") if isinstance(n.get("tags"), list) else []),
                         papers=[str(k)[:80] for k in (n.get("papers") if isinstance(n.get("papers"), list) else [])][:20])
            else:
                if not OID_RE.match(str(n.get("post") or "")):
                    continue
                o["post"] = str(n["post"])
            lab[coll][str(oid)] = o
    for coll in ("plans", "tasks", "checks"):
        src = raw.get(coll) if isinstance(raw.get(coll), dict) else {}
        for oid, o in list(src.items())[:LAB_LIMITS[coll]]:
            if not (isinstance(o, dict) and OID_RE.match(str(oid)) and isinstance(o.get("f"), dict)):
                continue
            f = {}
            for k, fv in o["f"].items():
                stp = _stamp(fv.get("s")) if isinstance(fv, dict) else None
                if not stp or not ok_name(stp[1]):
                    continue
                try:
                    f[str(k)] = {"v": _field_ok(coll, k, fv.get("v")), "s": stp}
                except (ValueError, TypeError):
                    continue
            if f:
                by = str(o.get("by") or "")
                lab[coll][str(oid)] = {"by": by if ok_name(by) else "", "created": str(o.get("created") or "")[:40], "f": f}
    votes = raw.get("votes") if isinstance(raw.get("votes"), dict) else {}
    for pid, d in list(votes.items())[:LAB_LIMITS["posts"]]:
        if not (OID_RE.match(str(pid)) and isinstance(d, dict)):
            continue
        ok = {}
        for who, v in list(d.items())[:MAX_MEMBERS * 2]:
            stp = _stamp(v.get("s")) if isinstance(v, dict) else None
            if stp and stp[1] == who and ok_name(str(who)):
                ok[str(who)] = {"v": bool(v.get("v")), "s": stp}
        if ok:
            lab["votes"][str(pid)] = ok
    pins = raw.get("pins") if isinstance(raw.get("pins"), dict) else {}
    for pid, v in list(pins.items())[:LAB_LIMITS["posts"]]:
        stp = _stamp(v.get("s")) if isinstance(v, dict) else None
        if stp and OID_RE.match(str(pid)) and ok_name(stp[1]):
            lab["pins"][str(pid)] = {"v": bool(v.get("v")), "s": stp}
    return lab


def trust_author_copy(st: dict, owner: str, copy: dict):
    """The copy published by `owner` (read from owner's own gist) is the authority on owner's notes:
    a version of one of owner's notes found in someone else's copy but not in owner's is dropped,
    so a member can't forge or change another member's note by editing their own copy by hand."""
    theirs_p = (copy.get("profiles") or {}).get(owner)
    if theirs_p and (st.get("profiles") or {}).get(owner) != theirs_p:
        st.setdefault("profiles", {})[owner] = dict(theirs_p)
    if st.get("lab"):   # the same for the owner's posts, comments and votes in the lab
        their_lab = copy.get("lab") or {}
        for coll in ("posts", "comments"):
            theirs_l = their_lab.get(coll) or {}
            for oid, n in list((st["lab"].get(coll) or {}).items()):
                if n.get("by") != owner:
                    continue
                if oid not in theirs_l:
                    del st["lab"][coll][oid]
                elif n != theirs_l[oid]:
                    st["lab"][coll][oid] = dict(theirs_l[oid])
        for pid, d in (st["lab"].get("votes") or {}).items():
            tv = ((their_lab.get("votes") or {}).get(pid) or {}).get(owner)
            if owner in d and d[owner] != tv:
                if tv:
                    d[owner] = dict(tv)
                else:
                    del d[owner]
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
        for cid, cell in list((e.get("cells") or {}).items()):   # the same for the table entries
            theirs_c = (mine.get("cells") or {}).get(cid) or {}
            for eid, n in list(cell.items()):
                if n.get("by") != owner:
                    continue
                if eid not in theirs_c:
                    del cell[eid]
                elif n != theirs_c[eid]:
                    cell[eid] = dict(theirs_c[eid])


def members(st) -> dict:
    """Current members: {name: repo}."""
    return {k: v.get("repo", "") for k, v in st.get("members", {}).items() if present(v)}


def items(st) -> dict:
    return {k: e for k, e in st.get("items", {}).items() if present(e)}


def merge(a: dict, b: dict) -> dict:
    """Combine two copies of the same list. Commutative, associative and idempotent."""
    if a.get("id") != b.get("id"):
        raise ShareError("These are two different groups.")
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
    pa, pb = a.get("profiles") or {}, b.get("profiles") or {}
    if pa or pb:
        out["profiles"] = {}
        for who in set(pa) | set(pb):
            cands = [p for p in (pa.get(who), pb.get(who)) if p and p.get("s") and p["s"][1] == who]
            if cands:
                best = cands[0]
                for c in cands[1:]:
                    if newer(c.get("s"), best.get("s")):
                        best = c
                out["profiles"][who] = dict(best)
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
        cells = {}
        for cid in set(x.get("cells") or {}) | set(y.get("cells") or {}):
            c = _merge_notes((x.get("cells") or {}).get(cid) or {}, (y.get("cells") or {}).get(cid) or {})
            if c:
                cells[cid] = c
        if cells:
            out["items"][key]["cells"] = cells
    cols = _merge_cols(a.get("cols") or {}, b.get("cols") or {})
    if cols:
        out["cols"] = cols
    if a.get("lab") or b.get("lab"):
        out["lab"] = _merge_lab(a.get("lab"), b.get("lab"))
    if a.get("aliases") or b.get("aliases"):
        out["aliases"] = {}
        for loc in set(a.get("aliases") or {}) | set(b.get("aliases") or {}):
            c = [x for x in ((a.get("aliases") or {}).get(loc), (b.get("aliases") or {}).get(loc)) if x]
            if len({x.get("v") for x in c}) > 1 or any(x.get("x") for x in c):   # two people claim it: nobody gets it
                out["aliases"][loc] = {"v": "", "x": True, "s": max((x["s"] for x in c), key=tuple)}
            else:
                out["aliases"][loc] = dict(c[0])
    return out


def validate(data) -> dict:
    """Check and clean a list file read from someone else's repository (never trust it blindly)."""
    if not isinstance(data, dict) or data.get("papershelf_shared") != FORMAT:
        raise ShareError("This is not a PaperShelf group.")
    lid = str(data.get("id") or "")
    if not ID_RE.match(lid):
        raise ShareError("This group has an invalid id.")
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
        raw_cells = e.get("cells") if isinstance(e.get("cells"), dict) else {}
        cells = {}
        for cid, cell in list(raw_cells.items())[:MAX_COLS * 2]:
            if not (COL_RE.match(str(cid)) and isinstance(cell, dict)):
                continue
            ok = {}
            for eid, n in list(cell.items())[:200]:
                if not (isinstance(n, dict) and re.match(r"^[a-f0-9]{8,32}$", str(eid))):
                    continue
                by, stp = str(n.get("by") or ""), _stamp(n.get("s"))
                if not (NAME_RE.match(by) or by.startswith("local-")) or not stp or stp[1] != by:
                    continue
                ok[str(eid)] = {"by": by, "name": str(n.get("name") or "")[:60], "body": str(n.get("body") or "")[:MAX_CELL],
                                "created": str(n.get("created") or "")[:40], "at": str(n.get("at") or "")[:40],
                                "del": bool(n.get("del")), "s": stp,
                                "c": n["c"] if isinstance(n.get("c"), int) and 0 <= n["c"] <= stp[0] else stp[0]}
            if ok:
                cells[str(cid)] = ok
        if cells:
            item["cells"] = cells
        st["items"][item_key(meta)] = item
    raw_p = data.get("profiles") if isinstance(data.get("profiles"), dict) else {}
    for who, pr in list(raw_p.items())[:MAX_MEMBERS]:
        stp = _stamp(pr.get("s")) if isinstance(pr, dict) else None
        if stp and stp[1] == who and (NAME_RE.match(str(who)) or str(who).startswith("local-")):
            st.setdefault("profiles", {})[str(who)] = {"name": " ".join(str(pr.get("name") or "").split())[:60],
                                                       "since": str(pr.get("since") or "")[:40], "s": stp}
    raw_cols = data.get("cols") if isinstance(data.get("cols"), dict) else {}
    for cid, col in list(raw_cols.items())[:MAX_COLS * 2]:
        stp = _stamp(col.get("s")) if isinstance(col, dict) else None
        if stp and COL_RE.match(str(cid)) and (NAME_RE.match(stp[1]) or stp[1].startswith("local-")):
            try:
                pos = float(col.get("pos") or 0)
            except (TypeError, ValueError):
                pos = 0.0
            st.setdefault("cols", {})[str(cid)] = {"name": " ".join(str(col.get("name") or "").split())[:60] or "Column",
                                                   "pos": pos, "del": bool(col.get("del")), "s": stp}
    c = data.get("creator") if isinstance(data.get("creator"), dict) else None
    if c and (NAME_RE.match(str(c.get("by") or "")) or str(c.get("by") or "").startswith("local-")):
        st["creator"] = {"by": str(c["by"])[:60], "name": str(c.get("name") or "")[:60], "at": str(c.get("at") or "")[:40]}
    if data.get("lab"):
        st["lab"] = _validate_lab(data.get("lab"))
    raw_al = data.get("aliases") if isinstance(data.get("aliases"), dict) else {}
    for loc, x in list(raw_al.items())[:MAX_MEMBERS * 2]:
        stp = _stamp(x.get("s")) if isinstance(x, dict) else None
        v = str((x or {}).get("v") or "") if isinstance(x, dict) else ""
        if stp and str(loc).startswith("local-") and len(str(loc)) <= 40 and NAME_RE.match(v) and stp[1] == v:
            st.setdefault("aliases", {})[str(loc)] = {"v": v, "s": stp}
        elif stp and str(loc).startswith("local-") and len(str(loc)) <= 40 and x.get("x"):
            st.setdefault("aliases", {})[str(loc)] = {"v": "", "x": True, "s": stp}
    st["clock"] = clock(st)
    return st


def summary(st: dict) -> dict:
    its = items(st)
    return {"id": st["id"], "name": st["name"]["v"], "description": (st.get("description") or {}).get("v", ""),
            "papers": len(its), "members": members(st), "updated_at": st.get("updated_at"),
            "creator": ({**st["creator"], "by": canon(st, st["creator"].get("by")),
                         "name": st["creator"].get("name") or profiles(st).get(st["creator"].get("by")) or ""} if st.get("creator") else {}),
            "notes": sum(len(notes_of(e)) for e in its.values()),
            "people": people(st)}


def people(st: dict) -> list:
    """Who takes part: every member with the name they chose, when they joined and what they contributed."""
    its, prof = items(st), st.get("profiles") or {}
    added, notes = {}, {}
    for e in its.values():
        a = canon(st, (e.get("add") or [0, ""])[1])
        added[a] = added.get(a, 0) + 1
        for n in notes_of(e):
            notes[canon(st, n["by"])] = notes.get(canon(st, n["by"]), 0) + 1
    creator = canon(st, (st.get("creator") or {}).get("by"))
    out = []
    for name, m in members(st).items():
        pr = prof.get(name) or {}
        out.append({"id": name, "name": pr.get("name") or "", "since": pr.get("since") or "", "joined": bool(m),
                    "creator": name == creator, "papers": added.get(name, 0), "notes": notes.get(name, 0)})
    return sorted(out, key=lambda p: (not p["creator"], not p["joined"], (p["name"] or p["id"]).lower()))


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
            raise ShareError("Paste your GitHub token first (Settings → Groups).")
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
                raise ShareError(f"GitHub answered {r.status_code} for {owner}'s groups.")
            return self._json(r.content, name)
        if not REPO_RE.match(src or ""):
            return None
        return self.read(src, name, fresh)

    def publish(self, src: str, files: dict):
        """Write {filename: data} into your own gist in one go."""
        if not (self.token and is_gist(src)):
            raise ShareError("GitHub is not connected for groups (Settings → Groups).")
        gid = src[5:]
        body = {"files": {n: {"content": json.dumps(d, indent=1, sort_keys=True, ensure_ascii=False) + "\n"} for n, d in files.items()}}
        r = self._req("PATCH", f"{API}/gists/{gid}", headers=self._headers(), json=body)
        if r.status_code in (200, 201):
            self._gists.pop(gid, None)
            return True
        if r.status_code in (401, 403):
            raise ShareError(NEEDS_GISTS)
        if r.status_code == 404:
            raise ShareError("Your groups gist was not found – in Settings → Groups click Disconnect, then connect again.")
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
               "“Gists” to Read and write, then click Update – no new token needed. See the guide (Groups).")
