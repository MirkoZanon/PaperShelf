"""
insights.py - smart helpers that keep an eye on the library.

* Retractions and corrections: Crossref (notices published by journals, plus the Retraction Watch
  database that Crossref includes) and OpenAlex's "is_retracted" flag.
* Published versions of preprints: arXiv (the journal DOI the authors added), Crossref
  ("is-preprint-of" links, used by bioRxiv, medRxiv, Research Square…) and, as a last resort,
  an exact title + first-author match in OpenAlex.
* "What's new": recent papers by the researchers you follow and on the topics you watch (OpenAlex).
* Label suggestions and reading statistics, computed on this computer only.

Privacy: only public identifiers (DOIs, arXiv IDs, OpenAlex IDs) and the topics you choose to
watch are sent, anonymously, to these public services. Nothing about you, your notes or your
reading is sent anywhere.
"""
from __future__ import annotations

import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import metadata
from metadata import MetadataError, http_get

PREPRINT_DOI_PREFIXES = ("10.1101/", "10.48550/", "10.31234/", "10.2139/", "10.21203/", "10.20944/", "10.31219/",
                         "10.22541/", "10.31222/", "10.31235/", "10.36227/", "10.32942/", "10.26434/", "10.31730/",
                         "10.1002/essoar", "10.21428/", "10.31233/", "10.35542/")
LEVEL = {"retracted": 3, "concern": 2, "corrected": 1}
_UPDATE_LEVEL = {"retraction": "retracted", "withdrawal": "retracted", "removal": "retracted",
                 "expression_of_concern": "concern", "partial_retraction": "corrected", "correction": "corrected",
                 "erratum": "corrected", "corrigendum": "corrected", "addendum": "corrected", "clarification": "corrected"}
_LABEL = {"retracted": "Retracted", "concern": "Expression of concern", "corrected": "Corrected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _date_parts(d) -> str:
    parts = ((d or {}).get("date-parts") or [[]])[0] or []
    return "-".join(f"{int(x):02d}" if i else str(int(x)) for i, x in enumerate(parts[:3]) if x is not None)


def is_preprint(p: dict) -> bool:
    doi = (p.get("doi") or "").lower()
    if p.get("type") == "preprint" or doi.startswith(PREPRINT_DOI_PREFIXES):
        return True
    return bool(p.get("arxiv_id")) and (not doi or doi.startswith("10.48550/") or (p.get("journal") or "").lower() in ("", "arxiv"))


# --------------------------------------------------------------------------- Crossref / OpenAlex batches
def crossref_works(dois) -> dict:
    """Crossref records of many DOIs (20 per request): {doi_lower: message}."""
    out = {}
    for chunk in _chunks([d for d in dois if d and "," not in d], 20):
        r = http_get("https://api.crossref.org/works",
                     params={"filter": ",".join("doi:" + d for d in chunk), "rows": 40})
        if r.status_code != 200:
            raise MetadataError(f"Crossref returned an error (HTTP {r.status_code}).")
        try:
            for it in r.json()["message"]["items"]:
                out[(it.get("DOI") or "").lower()] = it
        except (ValueError, KeyError, TypeError):
            continue
    return out


def crossref_notices(dois) -> dict:
    """Notices (retractions, corrections…) that point at these DOIs: {doi_lower: [notice]}."""
    want = {d.lower() for d in dois}
    out: dict[str, list] = defaultdict(list)
    for chunk in _chunks([d for d in dois if d and "," not in d], 20):
        r = http_get("https://api.crossref.org/works",
                     params={"filter": ",".join("updates:" + d for d in chunk), "rows": 100})
        if r.status_code != 200:
            raise MetadataError(f"Crossref returned an error (HTTP {r.status_code}).")
        try:
            items = r.json()["message"]["items"]
        except (ValueError, KeyError, TypeError):
            continue
        for it in items:
            for u in it.get("update-to") or []:
                target = (u.get("DOI") or "").lower()
                if target in want:
                    out[target].append({"type": (u.get("type") or "").lower().replace("-", "_"), "label": u.get("label") or "",
                                        "doi": it.get("DOI") or "", "date": _date_parts(u.get("updated")), "source": "publisher"})
    return out


def openalex_retracted(dois) -> set:
    out = set()
    for chunk in _chunks([d for d in dois if d and "|" not in d and "," not in d], 50):
        r = http_get("https://api.openalex.org/works",
                     params={"filter": "doi:" + "|".join(chunk), "select": "doi,is_retracted", "per_page": 50})
        if r.status_code != 200:
            raise MetadataError(f"OpenAlex returned an error (HTTP {r.status_code}).")
        try:
            for w in r.json().get("results") or []:
                if w.get("is_retracted"):
                    out.add(re.sub(r"^https?://doi\.org/", "", w.get("doi") or "").lower())
        except ValueError:
            continue
    return out


# --------------------------------------------------------------------------- retractions & corrections
def _notice(u: dict, source: str) -> dict:
    return {"type": (u.get("type") or "").lower().replace("-", "_"), "label": u.get("label") or "",
            "doi": u.get("DOI") or "", "date": _date_parts(u.get("updated")), "source": source}


def check_alerts(papers: list, cr: dict | None = None) -> dict:
    """{paper_id: alert or None}. alert = {level, label, notices[]}."""
    dois = {p["id"]: p["doi"].strip().lower() for p in papers
            if p.get("doi") and not p["doi"].lower().startswith("10.48550/")}
    if not dois:
        return {}
    cr = cr if cr is not None else crossref_works(dois.values())
    notices = crossref_notices(dois.values())
    retracted = openalex_retracted(dois.values())
    out = {}
    for pid, doi in dois.items():
        found, seen = [], set()
        msg = cr.get(doi) or {}
        for u in msg.get("updated-by") or []:   # includes the Retraction Watch database
            found.append(_notice(u, "retraction-watch" if u.get("source") == "retraction-watch" else "publisher"))
        for u in msg.get("update-to") or []:    # an article marked as retracted in place points at itself
            if (u.get("DOI") or "").lower() == doi:
                found.append(_notice(dict(u, DOI=msg.get("DOI") or ""), u.get("source") or "publisher"))
        found += notices.get(doi, [])
        uniq = []
        for n in found:
            k = (n["type"], n["doi"].lower() or n["date"])
            if k not in seen and _UPDATE_LEVEL.get(n["type"]):
                seen.add(k)
                uniq.append(n)
        level = max((_UPDATE_LEVEL[n["type"]] for n in uniq), key=lambda x: LEVEL[x], default="")
        if doi in retracted and LEVEL.get(level, 0) < 3:
            level = "retracted"
            if not any(_UPDATE_LEVEL[n["type"]] == "retracted" for n in uniq):
                uniq.append({"type": "retraction", "label": "Retracted (OpenAlex / Retraction Watch)", "doi": "",
                             "date": "", "source": "openalex"})
        out[pid] = {"level": level, "label": _LABEL[level], "notices": uniq[:10]} if level else None
    return out


# --------------------------------------------------------------------------- published versions
_ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def arxiv_published(ids) -> dict:
    """{arxiv_id: {'doi', 'journal_ref'}} for the preprints whose authors added the journal version."""
    out = {}
    for chunk in _chunks(ids, 40):
        r = http_get("https://export.arxiv.org/api/query", params={"id_list": ",".join(chunk), "max_results": len(chunk)},
                     accept="application/atom+xml", timeout=30)
        if r.status_code != 200:
            raise MetadataError(f"arXiv returned an error (HTTP {r.status_code}).")
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError:
            continue
        for e in root.findall("a:entry", _ATOM):
            m = re.search(r"arxiv\.org/abs/(.+?)(v\d+)?$", e.findtext("a:id", "", _ATOM) or "")
            if not m:
                continue
            raw = (e.findtext("arxiv:doi", "", _ATOM) or "").split()
            doi = metadata.clean_doi(raw[0]) if raw else ""
            jref = " ".join((e.findtext("arxiv:journal_ref", "", _ATOM) or "").split())
            if doi and not doi.lower().startswith("10.48550/"):
                out[m.group(1)] = {"doi": doi, "journal_ref": jref}
    return out


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", metadata.clean_text(t or "", "").lower()).strip()


def openalex_published(p: dict) -> dict | None:
    """The journal version of a preprint, found by exact title and first author in OpenAlex."""
    title = _norm_title(p.get("title"))
    fam = metadata._norm((p.get("authors") or [{}])[0].get("family") or "")
    if len(title) < 25 or not fam:
        return None
    q = re.sub(r"[,:|()]", " ", p["title"])[:200]
    r = http_get("https://api.openalex.org/works", params={
        "filter": f"title.search:{q},type:article|review", "per_page": 8,
        "select": "id,doi,display_name,publication_year,authorships,primary_location"})
    if r.status_code != 200:
        return None
    try:
        res = r.json().get("results") or []
    except ValueError:
        return None
    for w in res:
        doi = re.sub(r"^https?://doi\.org/", "", w.get("doi") or "")
        if not doi or doi.lower().startswith(PREPRINT_DOI_PREFIXES) or _norm_title(w.get("display_name")) != title:
            continue
        first = ((w.get("authorships") or [{}])[0].get("author") or {}).get("display_name") or ""
        if fam not in metadata._norm(first):
            continue
        src = ((w.get("primary_location") or {}).get("source") or {})
        if (src.get("type") or "") == "repository":
            continue
        return {"doi": doi, "journal": src.get("display_name") or "", "year": w.get("publication_year"), "source": "OpenAlex"}
    return None


def check_published(papers: list, cr: dict | None = None, search_limit: int = 10) -> dict:
    """{paper_id: {'doi', 'journal', 'year', 'title', 'source'}} for preprints with a journal version."""
    pre = [p for p in papers if is_preprint(p)]
    if not pre:
        return {}
    found: dict[int, dict] = {}
    ax = {p["arxiv_id"].strip(): p for p in pre if p.get("arxiv_id")}
    if ax:
        for aid, info in arxiv_published(list(ax)).items():
            p = ax.get(aid) or ax.get(re.sub(r"v\d+$", "", aid))
            if p:
                found[p["id"]] = {"doi": info["doi"], "journal": info["journal_ref"], "source": "arXiv"}
    dois = [p["doi"].lower() for p in pre if p.get("doi") and not p["doi"].lower().startswith("10.48550/") and p["id"] not in found]
    if dois:
        cr = cr if cr is not None else crossref_works(dois)
        for p in pre:
            msg = cr.get((p.get("doi") or "").lower()) or {}
            for rel in (msg.get("relation") or {}).get("is-preprint-of") or []:
                if rel.get("id-type") == "doi" and rel.get("id"):
                    found[p["id"]] = {"doi": metadata.clean_doi(rel["id"]), "source": "Crossref"}
                    break
    n = 0
    for p in pre:
        if p["id"] in found or n >= search_limit:
            continue
        n += 1
        try:
            hit = openalex_published(p)
        except MetadataError:
            hit = None
        if hit:
            found[p["id"]] = hit
    # details (journal, year, title) of the published versions
    need = [f["doi"] for f in found.values() if f.get("doi")]
    try:
        det = crossref_works(need) if need else {}
    except MetadataError:
        det = {}
    by_id = {p["id"]: p for p in pre}
    out = {}
    for pid, f in found.items():
        if (f["doi"] or "").lower() == (by_id[pid].get("doi") or "").lower():
            continue
        m = det.get(f["doi"].lower()) or {}
        if m:
            f["journal"] = ((m.get("container-title") or [""])[0]) or f.get("journal") or ""
            parts = ((m.get("issued") or {}).get("date-parts") or [[None]])[0]
            f["year"] = parts[0] if parts and parts[0] else f.get("year")
            f["title"] = metadata.clean_text((m.get("title") or [""])[0], "")
            if (m.get("type") or "") == "posted-content":
                continue   # another preprint, not a journal version
        f["found"] = _now()
        out[pid] = f
    return out


# --------------------------------------------------------------------------- What's new
_FEED_FIELDS = "id,doi,display_name,publication_year,publication_date,authorships,primary_location,type,cited_by_count,open_access"
_SKIP_TITLE = re.compile(r"^\s*(correction|corrigendum|erratum|retraction|retracted|expression of concern|"
                         r"addendum|publisher correction|author correction|reply|response to|editorial|front matter)\b", re.I)


def _feed_item(w: dict) -> dict:
    s = metadata.work_summary(w)
    s.pop("refs", None)
    s["date"] = w.get("publication_date") or ""
    s["type"] = w.get("type") or ""
    s["oa"] = bool((w.get("open_access") or {}).get("is_oa"))
    s["author_ids"] = [metadata.openalex_short((a.get("author") or {}).get("id")) for a in w.get("authorships") or []]
    return s


def _works(params) -> list:
    r = http_get("https://api.openalex.org/works", params=params)
    if r.status_code != 200:
        raise MetadataError(f"OpenAlex returned an error (HTTP {r.status_code}).")
    try:
        return r.json().get("results") or []
    except ValueError:
        return []


def fetch_new(authors: dict, topics: list, since: str) -> list:
    """authors: {openalex_author_id: name}. Returns [(item, why)] newest first."""
    out = []
    base = f"from_publication_date:{since},type:article|preprint|review"
    for chunk in _chunks(sorted(authors), 25):
        for w in _works({"filter": f"author.id:{'|'.join(chunk)},{base}", "sort": "publication_date:desc",
                         "per_page": 100, "select": _FEED_FIELDS}):
            it = _feed_item(w)
            who = [authors[a] for a in it["author_ids"] if a in authors]
            out.append((it, {"kind": "person", "names": who}))
    for t in topics:
        q = re.sub(r"[,:|]", " ", t).strip()
        if not q:
            continue
        for w in _works({"filter": f"title_and_abstract.search:{q},{base}", "sort": "publication_date:desc",
                         "per_page": 15, "select": _FEED_FIELDS}):
            out.append((_feed_item(w), {"kind": "topic", "topic": t}))
    return [(it, why) for it, why in out if it["id"] and not _SKIP_TITLE.search(it["title"] or "")]


# --------------------------------------------------------------------------- label suggestions
_STOP = set("""a about above after again against all also although am among an and any are as at be because been before
being below between both but by can could did do does doing down during each either few for from further had has have
having here how however i if in into is it its itself just may might more most much must no nor not now of off on once
only or other our out over own per same should since so some such than that the their them then there these they this
those through thus to too under until up upon very via was we were what when where whether which while who whom why will
with within without would yet you your using based new study studies analysis approach results result show shows shown
paper method methods data effect effects role use used model models two one three first second high low large small
different during toward towards across associated related role novel present report reveal reveals evidence""".split())
_TOK = re.compile(r"[a-zà-öø-ÿ][a-zà-öø-ÿ0-9\-]{2,}")


def _tokens(p: dict) -> Counter:
    text = " ".join([p.get("title") or ""] * 2 + [" ".join(p.get("keywords") or [])] * 2 + [(p.get("abstract") or "")[:3000]])
    c = Counter(t.strip("-") for t in _TOK.findall(text.lower()) if t not in _STOP and len(t.strip("-")) > 2)
    for k in p.get("keywords") or []:
        k = k.lower().strip()
        if " " in k:
            c["kw:" + k] += 3
    return c


def _norm(v: dict) -> dict:
    n = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {k: x / n for k, x in v.items()}


def suggest_labels(target: dict, papers: list, members: dict, max_n: int = 3) -> list:
    """members: {label_id: set(paper_id)}. Returns [{'id', 'score', 'why'}] best first."""
    docs = {p["id"]: _tokens(p) for p in papers}
    if not docs.get(target["id"]):
        return []
    df = Counter()
    for c in docs.values():
        df.update(c.keys())
    n = len(docs)
    idf = {t: math.log((n + 1) / (k + 1)) + 1 for t, k in df.items()}
    vec = lambda c: _norm({t: (1 + math.log(x)) * idf.get(t, 1) for t, x in c.items()})  # noqa: E731
    tv = vec(docs[target["id"]])
    by_id = {p["id"]: p for p in papers}
    t_refs = set(target.get("refs") or [])
    t_oa = target.get("openalex_id") or ""
    out = []
    for gid, pids in members.items():
        pids = [x for x in pids if x != target["id"] and x in by_id]
        if not pids or target["id"] in members[gid]:
            continue
        cen = Counter()
        for pid in pids:
            for t, x in vec(docs[pid]).items():
                cen[t] += x
        cen = _norm(cen)
        text = sum(x * cen.get(t, 0) for t, x in tv.items())
        links = sum(1 for pid in pids if (t_oa and t_oa in (by_id[pid].get("refs") or []))
                    or (by_id[pid].get("openalex_id") and by_id[pid]["openalex_id"] in t_refs))
        shared = 0.0
        if t_refs:
            lrefs = Counter(r for pid in pids for r in set(by_id[pid].get("refs") or []))
            shared = sum(1 for r in t_refs if lrefs.get(r, 0) >= max(1, len(pids) // 4)) / max(10, len(t_refs))
        score = text + 0.25 * min(1.0, links / max(1, len(pids)) * 2) + 0.6 * min(0.5, shared)
        need = 0.2 if len(pids) >= 2 else 0.3
        if score >= need:
            why = []
            common = sorted(((x * cen.get(t, 0), t) for t, x in tv.items() if cen.get(t)), reverse=True)[:3]
            words = [t[3:] if t.startswith("kw:") else t for _, t in common]
            if words:
                why.append("shares the words " + ", ".join(f"“{w}”" for w in words))
            if links:
                why.append(f"cites or is cited by {links} of its papers")
            out.append({"id": gid, "score": round(score, 3), "why": "; ".join(why)})
    out.sort(key=lambda x: -x["score"])
    return out[:max_n]


# --------------------------------------------------------------------------- reading statistics
def _month(s: str) -> str:
    return (s or "")[:7]


def reading_stats(papers: list, log: list, labels: dict, today: date | None = None) -> dict:
    """papers: rows with status, added_at, read_at; log: [(day 'YYYY-MM-DD', paper_id, seconds)];
    labels: {paper_id: [label names]}."""
    today = today or date.today()
    months = []
    y, m = today.year, today.month
    for _ in range(12):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    months.reverse()
    finished = Counter(_month(p["read_at"]) for p in papers if p.get("read_at"))
    added = Counter(_month(p["added_at"]) for p in papers if p.get("added_at"))
    # reading time per ISO week (12 weeks), streak, top papers
    per_day = Counter()
    per_paper = Counter()
    for day, pid, sec in log:
        per_day[day] += sec
        if (today - date.fromisoformat(day)).days <= 90:
            per_paper[pid] += sec
    weeks = []
    start = today - timedelta(days=today.weekday())
    for i in range(11, -1, -1):
        w0 = start - timedelta(weeks=i)
        weeks.append({"week": w0.isoformat(), "minutes": round(sum(per_day.get((w0 + timedelta(days=d)).isoformat(), 0)
                                                                   for d in range(7)) / 60)})
    streak, d = 0, today
    if per_day.get(d.isoformat(), 0) < 60:
        d -= timedelta(days=1)
    while per_day.get(d.isoformat(), 0) >= 60:
        streak += 1
        d -= timedelta(days=1)
    days_to_read = []
    for p in papers:
        if p.get("read_at") and p.get("added_at"):
            try:
                a = datetime.fromisoformat(p["added_at"].replace("Z", "+00:00"))
                r = datetime.fromisoformat(p["read_at"].replace("Z", "+00:00"))
                days_to_read.append(max(0, (r - a).days))
            except ValueError:
                pass
    year = str(today.year)
    lab = Counter(n for p in papers if (p.get("read_at") or "").startswith(year) for n in labels.get(p["id"], []))
    by_id = {p["id"]: p for p in papers}
    month_now = today.strftime("%Y-%m")
    return {
        "months": [{"month": mm, "finished": finished.get(mm, 0), "added": added.get(mm, 0)} for mm in months],
        "weeks": weeks,
        "finished_month": finished.get(month_now, 0),
        "finished_year": sum(v for k, v in finished.items() if k.startswith(year)),
        "finished_total": sum(finished.values()),
        "read_without_date": sum(1 for p in papers if p["status"] == "read" and not p.get("read_at")),
        "minutes_week": weeks[-1]["minutes"],
        "minutes_total": round(sum(per_day.values()) / 60),
        "streak": streak,
        "reading_list": sum(1 for p in papers if p["status"] != "read"),
        "reading_now": sum(1 for p in papers if p["status"] == "reading"),
        "median_days": sorted(days_to_read)[len(days_to_read) // 2] if days_to_read else None,
        "top_papers": [{"id": pid, "title": by_id[pid]["title"], "minutes": round(s / 60)}
                       for pid, s in per_paper.most_common(8) if pid in by_id and s >= 60],
        "top_labels": [{"name": k, "n": v} for k, v in lab.most_common(6)],
        "logged_since": min((d for d, _, _ in log), default=""),
    }


def json_or(v, default):
    try:
        return json.loads(v) if v else default
    except (ValueError, TypeError):
        return default
