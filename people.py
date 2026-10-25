"""
people.py - researcher profiles built only from official / scholarly sources.

  ORCID      the researcher's own record: name, biography, employment and
             education history, funding, awards and the works they claimed
  OpenAlex   open scholarly index: metrics (works, citations, h-index, i10),
             affiliations over time, topics, and the full list of works with
             co-authors, author position and citation counts
  Wikidata   portrait photo (Wikimedia Commons), only when one exists

Google Scholar has no official API (and forbids automated access), so it is
only offered as a link.

The publication list merges ORCID and OpenAlex, removes duplicates (same DOI,
or same title and year), classifies every item (journal article, preprint,
conference paper, abstract/poster, book, thesis, data/software, other) and links
preprints to their published version.
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import quote

import metadata
from metadata import MetadataError, NetworkError, clean_text, openalex_short, split_name

ORCID_API = "https://pub.orcid.org/v3.0"
ORCID_RE = re.compile(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
OPENALEX_AUTHOR_RE = re.compile(r"(?:openalex\.org/(?:authors/)?)?\b(A\d{4,})\b", re.I)

CATEGORIES = [
    ("article", "Journal articles"), ("preprint", "Preprints"), ("conference", "Conference papers"),
    ("abstract", "Abstracts & posters"), ("book", "Books & chapters"), ("thesis", "Theses"),
    ("data", "Data & software"), ("other", "Other (supplementary files, peer reviews, corrections, editorials…)"),
]
CATEGORY_KEYS = [k for k, _ in CATEGORIES]

PREPRINT_DOI_PREFIXES = ("10.1101/", "10.48550/", "10.31234/", "10.2139/", "10.21203/", "10.20944/", "10.31219/",
                         "10.22541/", "10.31222/", "10.31235/", "10.36227/", "10.32942/", "10.26434/", "10.31730/",
                         "10.1002/essoar", "10.21428/", "10.31233/", "10.35542/")
PREPRINT_VENUES = ("arxiv", "biorxiv", "medrxiv", "psyarxiv", "ssrn", "research square", "preprints.org", "osf preprints",
                   "authorea", "chemrxiv", "socarxiv", "eartharxiv", "techrxiv", "edarxiv", "neuroscience preprints")
ABSTRACT_VENUE_RE = re.compile(r"\b(abstracts?|posters?|meeting|congress|supplement|meeting planner)\b", re.I)
ABSTRACT_TITLE_RE = re.compile(r"^\s*(abstract|poster)\b|[\[(](abstract|poster)[\])]|\bposter (session|presentation)\b", re.I)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _v(d, *path, default=None):
    """Safe nested lookup: _v(rec, 'person', 'name', 'family-name', 'value')."""
    for key in path:
        if not isinstance(d, dict):
            return default
        d = d.get(key)
        if d is None:
            return default
    return d


def norm_doi(doi):
    doi = (doi or "").strip().lower()
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi)


def norm_title(t):
    t = unicodedata.normalize("NFKD", clean_text(t or "", "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #
def _orcid(path, params=None):
    r = metadata.http_get(f"{ORCID_API}/{path}", params=params)
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise MetadataError(f"ORCID returned an error (HTTP {r.status_code}).")
    try:
        return r.json()
    except ValueError as exc:
        raise MetadataError("Could not read the ORCID response.") from exc


def _openalex(path, params=None, email=""):
    params = dict(params or {})  # privacy: no e-mail is sent
    r = metadata.http_get(f"https://api.openalex.org/{path}", params=params, email=email)
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise MetadataError(f"OpenAlex returned an error (HTTP {r.status_code}).")
    try:
        return r.json()
    except ValueError as exc:
        raise MetadataError("Could not read the OpenAlex response.") from exc


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #
def _oa_candidate(a):
    insts = [i.get("display_name") for i in (a.get("last_known_institutions") or []) if i.get("display_name")]
    return {
        "orcid": (ORCID_RE.search(a.get("orcid") or "") or [None, None])[1] if a.get("orcid") else None,
        "openalex_id": openalex_short(a.get("id")),
        "name": a.get("display_name") or "",
        "institutions": insts,
        "works_count": a.get("works_count"),
        "cited_by_count": a.get("cited_by_count"),
        "h_index": _v(a, "summary_stats", "h_index"),
        "topics": [t.get("display_name") for t in (a.get("topics") or [])[:3]],
        "sources": ["OpenAlex"],
    }


def search(query: str, email: str = "") -> list[dict]:
    """Find researchers by ORCID iD, OpenAlex ID, e-mail (if public on ORCID) or name."""
    q = " ".join((query or "").split())
    if not q:
        raise MetadataError("Type a name, an ORCID iD or an e-mail address.")
    m = ORCID_RE.search(q)
    if m:
        return [{"orcid": m.group(1).upper(), "openalex_id": None, "name": "", "exact": True, "sources": ["ORCID"]}]
    m = OPENALEX_AUTHOR_RE.fullmatch(q) or (OPENALEX_AUTHOR_RE.search(q) if "openalex.org" in q else None)
    if m:
        return [{"orcid": None, "openalex_id": m.group(1).upper(), "name": "", "exact": True, "sources": ["OpenAlex"]}]

    if EMAIL_RE.match(q) or "@" in q:
        raise MetadataError("For privacy, PaperShelf never sends e-mail addresses to other websites. "
                            "Search with the ORCID iD or the name instead.")
    cands: dict[str, dict] = {}
    errors = []
    if True:
        parts = q.split(" ")
        orcid_q = (f"given-names:{parts[0]}* AND family-name:{' '.join(parts[1:])}" if len(parts) > 1
                   else f"family-name:{q}")
    try:
        res = _orcid("expanded-search/", {"q": orcid_q, "rows": 10}) or {}
        for r in res.get("expanded-result") or []:
            oid = (r.get("orcid-id") or "").upper()
            if not oid:
                continue
            name = r.get("credit-name") or f"{r.get('given-names') or ''} {r.get('family-names') or ''}".strip()
            cands[oid] = {"orcid": oid, "openalex_id": None, "name": name,
                          "institutions": list(dict.fromkeys(r.get("institution-name") or []))[:3],
                          "works_count": None, "cited_by_count": None, "h_index": None, "topics": [],
                          "sources": ["ORCID"]}
    except MetadataError as exc:
        errors.append(str(exc))

    if not EMAIL_RE.match(q):
        try:
            res = _openalex("authors", {"search": q, "per_page": 10}, email) or {}
            for a in res.get("results") or []:
                c = _oa_candidate(a)
                if c["orcid"] and c["orcid"] in cands:
                    base = cands[c["orcid"]]
                    base.update({k: v for k, v in c.items() if k not in ("sources", "name", "institutions") and v})
                    base["institutions"] = c["institutions"] or base["institutions"]
                    base["sources"] = ["ORCID", "OpenAlex"]
                else:
                    cands[c["orcid"] or c["openalex_id"]] = c
        except MetadataError as exc:
            errors.append(str(exc))
    elif cands:  # e-mail found on ORCID: add OpenAlex numbers
        for c in cands.values():
            try:
                a = _openalex(f"authors/orcid:{c['orcid']}", None, email)
                if a:
                    oc = _oa_candidate(a)
                    c.update({k: oc[k] for k in ("openalex_id", "works_count", "cited_by_count", "h_index", "topics")})
                    c["sources"] = ["ORCID", "OpenAlex"]
            except MetadataError:
                pass
    if not cands and errors:
        raise NetworkError(errors[0])
    out = list(cands.values())
    out.sort(key=lambda c: (-len(c["sources"]), -(c["works_count"] or 0)))
    return out[:15]


# --------------------------------------------------------------------------- #
# ORCID record
# --------------------------------------------------------------------------- #
def _date(d):
    if not d:
        return ""
    y = _v(d, "year", "value") or ""
    m = _v(d, "month", "value") or ""
    return f"{y}-{m}" if y and m else y


def _affiliations(section, kind):
    out = []
    for grp in _v(section, "affiliation-group", default=[]) or []:
        for s in grp.get("summaries") or []:
            a = s.get(f"{kind}-summary") or {}
            org = a.get("organization") or {}
            addr = org.get("address") or {}
            out.append({
                "organization": org.get("name") or "", "department": a.get("department-name") or "",
                "role": a.get("role-title") or "", "city": addr.get("city") or "", "country": addr.get("country") or "",
                "start": _date(a.get("start-date")), "end": _date(a.get("end-date")), "url": _v(a, "url", "value") or "",
                "kind": kind,
            })
    out.sort(key=lambda x: (x["end"] == "", x["start"]), reverse=True)
    return out


def parse_orcid_record(rec: dict) -> dict:
    person = rec.get("person") or {}
    given = _v(person, "name", "given-names", "value") or ""
    family = _v(person, "name", "family-name", "value") or ""
    credit = _v(person, "name", "credit-name", "value") or ""
    acts = rec.get("activities-summary") or {}
    employments = _affiliations(acts.get("employments"), "employment") + _affiliations(acts.get("invited-positions"), "invited-position")
    educations = _affiliations(acts.get("educations"), "education") + _affiliations(acts.get("qualifications"), "qualification")
    distinctions = _affiliations(acts.get("distinctions"), "distinction")
    memberships = _affiliations(acts.get("memberships"), "membership")
    fundings = []
    for grp in _v(acts, "fundings", "group", default=[]) or []:
        f = (grp.get("funding-summary") or [{}])[0]
        fundings.append({"title": _v(f, "title", "title", "value") or "", "type": f.get("type") or "",
                         "funder": _v(f, "organization", "name") or "", "start": _date(f.get("start-date")),
                         "end": _date(f.get("end-date")), "url": _v(f, "url", "value") or ""})
    fundings.sort(key=lambda x: x["start"], reverse=True)
    works = []
    for grp in _v(acts, "works", "group", default=[]) or []:
        summaries = grp.get("work-summary") or []
        if not summaries:
            continue
        w = summaries[0]
        dois, pmid = [], ""
        for s in summaries:
            for eid in _v(s, "external-ids", "external-id", default=[]) or []:
                if (eid.get("external-id-type") or "").lower() == "pmid" and not pmid:
                    pmid = re.sub(r"\D", "", eid.get("external-id-value") or "")
                if (eid.get("external-id-type") or "").lower() == "doi":
                    d = norm_doi(_v(eid, "external-id-normalized", "value") or eid.get("external-id-value"))
                    if d and d not in dois:
                        dois.append(d)
        works.append({
            "title": clean_text(_v(w, "title", "title", "value") or "", ""),
            "year": int(y) if (y := _v(w, "publication-date", "year", "value")) and str(y).isdigit() else None,
            "venue": _v(w, "journal-title", "value") or "",
            "doi": dois[0] if dois else "", "dois": dois, "url": _v(w, "url", "value") or "",
            "orcid_type": w.get("type") or "", "put_codes": [s.get("put-code") for s in summaries if s.get("put-code")],
            "pmid": pmid,
        })
    return {
        "name": credit or f"{given} {family}".strip(), "given": given, "family": family,
        "other_names": [o.get("content") for o in _v(person, "other-names", "other-name", default=[]) or []],
        "bio": _v(person, "biography", "content") or "",
        "keywords": [k.get("content") for k in _v(person, "keywords", "keyword", default=[]) or [] if k.get("content")],
        "urls": [{"name": u.get("url-name") or _v(u, "url", "value"), "url": _v(u, "url", "value")}
                 for u in _v(person, "researcher-urls", "researcher-url", default=[]) or [] if _v(u, "url", "value")],
        "countries": [_v(a, "country", "value") for a in _v(person, "addresses", "address", default=[]) or []],
        "employments": employments, "educations": educations, "distinctions": distinctions,
        "memberships": memberships, "fundings": fundings, "works": works,
    }


def orcid_work_details(orcid: str, put_codes: list) -> dict:
    """Contributors and details for ORCID works (100 per request)."""
    out = {}
    for i in range(0, len(put_codes), 100):
        chunk = put_codes[i:i + 100]
        res = _orcid(f"{orcid}/works/{','.join(str(c) for c in chunk)}") or {}
        for b in res.get("bulk") or []:
            w = b.get("work") or {}
            if not w.get("put-code"):
                continue
            contribs = []
            for c in _v(w, "contributors", "contributor", default=[]) or []:
                n = _v(c, "credit-name", "value")
                if n:
                    contribs.append(n)
            out[w["put-code"]] = {"authors": contribs,
                                  "venue": _v(w, "journal-title", "value") or "",
                                  "url": _v(w, "url", "value") or ""}
    return out


# --------------------------------------------------------------------------- #
# OpenAlex
# --------------------------------------------------------------------------- #
_WORK_FIELDS = "id,doi,display_name,publication_year,type,primary_location,authorships,cited_by_count,biblio,open_access,ids"


def openalex_author_works(aid: str, email: str = "", limit: int = 3000) -> list[dict]:
    out, cursor, use_select = [], "*", True
    while cursor and len(out) < limit:
        params = {"filter": f"author.id:{aid}", "per_page": 200, "cursor": cursor}
        if use_select:
            params["select"] = _WORK_FIELDS
        try:
            res = _openalex("works", params, email) or {}
        except MetadataError:
            if use_select:  # the API refused the field list: retry with full records
                use_select = False
                continue
            raise
        out += res.get("results") or []
        cursor = _v(res, "meta", "next_cursor")
        if not res.get("results"):
            break
    return out


def _oa_item(w: dict, aid: str) -> dict:
    loc = w.get("primary_location") or {}
    src = loc.get("source") or {}
    position, authors = "", []
    for a in w.get("authorships") or []:
        name = _v(a, "author", "display_name") or a.get("raw_author_name") or ""
        authors.append(name)
        if openalex_short(_v(a, "author", "id")) == aid:
            position = a.get("author_position") or ""
    b = w.get("biblio") or {}
    fp, lp = b.get("first_page") or "", b.get("last_page") or ""
    return {
        "title": clean_text(w.get("display_name") or "", ""), "year": w.get("publication_year"),
        "venue": src.get("display_name") or "", "source_type": src.get("type") or "",
        "doi": norm_doi(w.get("doi")), "dois": [norm_doi(w.get("doi"))] if w.get("doi") else [],
        "url": loc.get("landing_page_url") or "", "oa_type": w.get("type") or "",
        "authors": authors, "position": position, "cited_by": w.get("cited_by_count") or 0,
        "volume": str(b.get("volume") or ""), "issue": str(b.get("issue") or ""),
        "pages": f"{fp}-{lp}" if fp and lp and fp != lp else str(fp),
        "oa_url": _v(w, "open_access", "oa_url") or "", "is_oa": bool(_v(w, "open_access", "is_oa")),
        "source_id": openalex_short(src.get("id")), "issns": [i for i in (src.get("issn") or []) if i]
                     or ([src["issn_l"]] if src.get("issn_l") else []),
        "openalex_id": openalex_short(w.get("id")), "orcid_type": "", "put_codes": [],
        "pmid": re.sub(r"\D", "", (w.get("ids") or {}).get("pmid") or ""),
    }


# --------------------------------------------------------------------------- #
# Classification and de-duplication
# --------------------------------------------------------------------------- #
# Repositories for datasets, code and research files (DOI prefixes)
DATA_DOI_PREFIXES = (
    "10.6084/",      # figshare
    "10.5281/",      # Zenodo
    "10.5061/", "10.6078/", "10.7272/",  # Dryad
    "10.17605/",     # OSF projects / registrations
    "10.17632/",     # Mendeley Data
    "10.7910/",      # Harvard Dataverse
    "10.1594/",      # PANGAEA
    "10.3886/",      # ICPSR
    "10.5524/",      # GigaDB
    "10.24433/",     # Code Ocean
    "10.18112/",     # OpenNeuro
    "10.48324/",     # DANDI archive
    "10.12751/",     # G-Node GIN
    "10.15468/",     # GBIF
    "10.4121/",      # 4TU.ResearchData
    "10.25384/", "10.25387/", "10.25386/", "10.1184/r1", "10.26180/", "10.26188/", "10.25919/",  # institutional figshare
    "10.34973/", "10.18150/", "10.25740/", "10.14279/", "10.23728/", "10.21227/",  # other data repositories
)
DATA_HOSTS = ("figshare.com", "zenodo.org", "datadryad.org", "osf.io", "dataverse", "data.mendeley.com",
              "pangaea.de", "openneuro.org", "dandiarchive.org", "gin.g-node.org", "codeocean.com", "github.com",
              "kaggle.com", "physionet.org")
SUPP_TITLE_RE = re.compile(
    r"^\s*(supplementa(l|ry)\b|supporting (information|data|material)|additional file \d|"
    r"(supplementary |extended data )?(figure|fig\.?|table|movie|video|audio|data|file|text|appendix|dataset|image|presentation|data[ _]?sheet)[ _]?s?\d+[a-z]?\b|"
    r"s\d+[ _](fig|figure|table|file|text|movie|video|data|appendix|dataset)\b|"
    r"(figure|fig\.?|table|movie|video) ?\d+[a-z]? (from|of|in)\b)", re.I)
DATA_TITLE_RE = re.compile(r"^\s*((raw )?data (for|from|underlying|supporting)\b|source data\b|dataset\b|code (for|from)\b)", re.I)
PEER_REVIEW_RE = re.compile(r"^\s*(author response|decision letter|reviewer #?\d|reviewers?'? (comments|report)|review (of|for)\b|"
                            r"referee report|peer review|response to reviewers|editor'?s? evaluation|elife assessment)", re.I)
CORRECTION_RE = re.compile(r"^\s*(correction|corrigendum|corrigenda|erratum|errata|retraction|retracted|expression of concern|"
                           r"addendum|publisher correction|author correction|notice of retraction)\b", re.I)
POSTER_RE = re.compile(r"\b(poster|posters|slides|presentation|talk|lecture|keynote|webinar)\b", re.I)
SUPP_DOI_RE = re.compile(r"(\.s\d{3}$|\.sa\d+$|/supp|\.supp|/v\d+/review|\.r\d+$|/suppl[_-]|\.figures?\.|\.t\d{3}$|\.g\d{3}$)", re.I)


def classify_detail(it: dict):
    """(category, note) - note explains special cases (e.g. 'supplementary file')."""
    ot, at = (it.get("orcid_type") or "").lower(), (it.get("oa_type") or "").lower()
    doi, title = (it.get("doi") or "").lower(), it.get("title") or ""
    url = (it.get("url") or "").lower()
    venue = (it.get("venue") or "").lower()
    if CORRECTION_RE.search(title) or at in ("erratum", "retraction"):
        return "other", "correction / retraction"
    if PEER_REVIEW_RE.search(title) or at == "peer-review" or ot == "review":
        return "other", "peer review"
    if SUPP_TITLE_RE.search(title) or SUPP_DOI_RE.search(doi) or at == "supplementary-materials":
        return "other", "supplementary file"
    in_repo = bool(DATA_TITLE_RE.search(title)) or doi.startswith(DATA_DOI_PREFIXES) or any(h in url for h in DATA_HOSTS) or \
        any(h.split(".")[0] in venue for h in ("figshare.com", "zenodo.org", "dryad", "dataverse", "openneuro", "dandi"))
    if in_repo:
        if POSTER_RE.search(title) or ot in ("conference-poster", "conference-abstract", "lecture-speech"):
            return "abstract", "poster / presentation in a repository"
        if ot == "preprint" or at == "preprint" or doi.startswith(PREPRINT_DOI_PREFIXES):
            return "preprint", ""
        if re.search(r"\b(pre-?registration|registered report protocol|study protocol)\b", title, re.I):
            return "other", "preregistration"
        return "data", "dataset / software / research files"
    return classify_base(it), ""


def classify(it: dict) -> str:
    return classify_detail(it)[0]


def classify_base(it: dict) -> str:
    ot, at = (it.get("orcid_type") or "").lower(), (it.get("oa_type") or "").lower()
    doi, venue, title = (it.get("doi") or "").lower(), (it.get("venue") or "").lower(), it.get("title") or ""
    if ot in ("conference-abstract", "conference-poster", "lecture-speech") or doi.startswith("10.7490/"):
        return "abstract"
    if ABSTRACT_TITLE_RE.search(title) or (venue and ABSTRACT_VENUE_RE.search(venue)):
        return "abstract"
    if (ot == "preprint" or at == "preprint" or doi.startswith(PREPRINT_DOI_PREFIXES)
            or any(v in venue for v in PREPRINT_VENUES)):
        return "preprint"
    issue, pages = (it.get("issue") or "").lower(), (it.get("pages") or "")
    if at in ("article", "") and ot in ("", "journal-article") and ("suppl" in issue or re.match(r"^S\d", pages)):
        return "abstract"
    if ot == "conference-paper" or (it.get("source_type") == "conference" and at in ("article", "")):
        return "conference"
    if ot in ("book", "book-chapter", "edited-book", "encyclopedia-entry") or at in ("book", "book-chapter", "reference-entry"):
        return "book"
    if ot in ("dissertation-thesis", "dissertation") or at == "dissertation":
        return "thesis"
    if ot in ("data-set", "software", "data-management-plan", "physical-object") or at in ("dataset", "software"):
        return "data"
    if at in ("paratext", "erratum", "editorial", "letter", "peer-review", "retraction", "supplementary-materials",
              "other", "report", "standard", "grant", "libguides") or ot in (
              "book-review", "dictionary-entry", "newsletter-article", "magazine-article", "newspaper-article",
              "report", "working-paper", "website", "review", "translation", "other", "annotation", "blog-post"):
        # ORCID "review" means peer review activity, not a review article
        return "other" if at not in ("article", "review") else "article"
    if ot in ("journal-article", "journal-issue") or at in ("article", "review"):
        return "article"
    return "other"


def _absorb(base: dict, extra: dict, why: str, log: list):
    log.append({"kept": base["title"], "merged": extra["title"], "kept_sources": list(base["sources"]),
                "merged_sources": list(extra["sources"]), "reason": why})
    for k in ("doi", "venue", "url", "year", "volume", "issue", "pages", "oa_url", "openalex_id", "position", "source_type", "pmid"):
        if not base.get(k) and extra.get(k):
            base[k] = extra[k]
    if extra.get("orcid_type") and not base.get("orcid_type"):
        base["orcid_type"] = extra["orcid_type"]
    if not base.get("oa_type") and extra.get("oa_type"):
        base["oa_type"] = extra["oa_type"]
    if len(extra.get("authors") or []) > len(base.get("authors") or []):
        base["authors"] = extra["authors"]
    base["cited_by"] = max(base.get("cited_by") or 0, extra.get("cited_by") or 0)
    for k in ("dois", "put_codes", "sources"):
        base[k] = list(dict.fromkeys((base.get(k) or []) + (extra.get(k) or [])))
    base["merged_count"] = base.get("merged_count", 0) + 1


def merge_works(oa_items: list, orcid_items: list):
    """Combine ORCID and OpenAlex works, removing duplicates. Returns (items, merge_log)."""
    log: list = []
    items: list = []
    by_doi: dict = {}
    by_oa: dict = {}
    for it in oa_items + orcid_items:
        target = None
        for d in it.get("dois") or ([it["doi"]] if it.get("doi") else []):
            if d in by_doi:
                target = by_doi[d]
                break
        if not target and it.get("openalex_id") and it["openalex_id"] in by_oa:
            target = by_oa[it["openalex_id"]]
        if target:
            _absorb(target, it, "same DOI", log)
            for d in it.get("dois") or []:
                by_doi.setdefault(d, target)
            continue
        items.append(it)
        for d in it.get("dois") or []:
            by_doi.setdefault(d, it)
        if it.get("openalex_id"):
            by_oa[it["openalex_id"]] = it

    for it in items:
        it["category"], it["cat_note"] = classify_detail(it)
        it["nt"] = norm_title(it["title"])

    final: list = []
    by_year: dict = {}
    for it in items:
        y = it.get("year")
        cands = [c for yy in ((y - 1, y, y + 1) if y else (None,)) for c in by_year.get(yy, [])]
        match = None
        for c in cands:
            if c["category"] != it["category"] or not it["nt"] or not c["nt"]:
                continue
            if c.get("doi") and it.get("doi") and c["doi"] != it["doi"]:
                continue  # two different DOIs are two different works
            if c["nt"] == it["nt"] or (min(len(c["nt"]), len(it["nt"])) > 30
                                       and difflib.SequenceMatcher(None, c["nt"], it["nt"]).ratio() >= 0.93):
                match = c
                break
        if match:
            _absorb(match, it, "same title and year", log)
            continue
        final.append(it)
        by_year.setdefault(y, []).append(it)

    # preprint -> published version
    articles = [x for x in final if x["category"] in ("article", "conference")]
    for p in final:
        if p["category"] != "preprint" or not p["nt"]:
            continue
        for a in articles:
            if a.get("year") and p.get("year") and a["year"] < p["year"] - 1:
                continue
            if a["nt"] == p["nt"] or (min(len(a["nt"]), len(p["nt"])) > 30
                                      and difflib.SequenceMatcher(None, a["nt"], p["nt"]).ratio() >= 0.9):
                p["published_as"] = a["key"] if "key" in a else None
                a["has_preprint"] = True
                p["_pub"] = a
                break

    for it in final:
        it["key"] = (f"doi:{it['doi']}" if it.get("doi") else f"oa:{it['openalex_id']}" if it.get("openalex_id")
                     else f"orcid:{(it.get('put_codes') or ['?'])[0]}" if it.get("put_codes") else f"t:{it['nt'][:60]}:{it.get('year')}")
    for it in final:
        pub = it.pop("_pub", None)
        if pub is not None:
            it["published_as"] = pub["key"]
        it.pop("nt", None)
    final.sort(key=lambda x: (-(x.get("year") or 0), x["title"].lower()))
    return final, log


# --------------------------------------------------------------------------- #
# Profile
# --------------------------------------------------------------------------- #
def wikidata_photo(orcid: str):
    q = f'SELECT ?item ?image WHERE {{ ?item wdt:P496 "{orcid}" . OPTIONAL {{ ?item wdt:P18 ?image }} }} LIMIT 1'
    try:
        r = metadata.http_get("https://query.wikidata.org/sparql", params={"query": q, "format": "json"},
                     accept="application/sparql-results+json")
        if r.status_code != 200:
            return None
        rows = _v(r.json(), "results", "bindings", default=[])
    except (MetadataError, ValueError):
        return None
    if not rows:
        return None
    img = _v(rows[0], "image", "value")
    item = _v(rows[0], "item", "value")
    if not img:
        return {"url": None, "page": item}
    img = img.replace("http://", "https://")
    return {"url": img + ("&" if "?" in img else "?") + "width=320", "page": item,
            "source": "Wikimedia Commons (via Wikidata)"}


def build_profile(orcid: str | None = None, openalex_id: str | None = None, email: str = "") -> dict:
    orcid = orcid.upper() if orcid else None
    openalex_id = openalex_id.upper() if openalex_id else None
    prof = {"orcid": orcid, "openalex_id": openalex_id, "name": "", "photo": None, "bio": "", "keywords": [],
            "urls": [], "current": [], "employments": [], "educations": [], "distinctions": [],
            "memberships": [], "fundings": [], "metrics": {}, "topics": [], "counts_by_year": [],
            "oa_affiliations": [], "works": [], "merge_log": [], "sources": [], "warnings": [],
            "fetched_at": _now()}

    author = None
    if openalex_id:
        author = _openalex(f"authors/{openalex_id}", None, email)
        if author and not orcid and author.get("orcid"):
            m = ORCID_RE.search(author["orcid"])
            orcid = prof["orcid"] = m.group(1).upper() if m else None
    orcid_data = None
    if orcid:
        rec = _orcid(f"{orcid}/record")
        if rec is None:
            raise MetadataError(f"ORCID iD {orcid} was not found.")
        orcid_data = parse_orcid_record(rec)
        prof.update({k: orcid_data[k] for k in ("name", "given", "family", "other_names", "bio", "keywords", "urls",
                                               "employments", "educations", "distinctions", "memberships", "fundings")})
        prof["sources"].append({"name": "ORCID", "url": f"https://orcid.org/{orcid}",
                                "what": "identity, biography, career, funding, claimed works"})
        if not author:
            try:
                author = _openalex(f"authors/orcid:{orcid}", None, email)
            except MetadataError as exc:
                prof["warnings"].append(f"OpenAlex: {exc}")
    if not orcid and not author:
        raise MetadataError("Researcher not found.")

    if author:
        aid = openalex_short(author.get("id"))
        prof["openalex_id"] = aid
        prof["name"] = prof["name"] or author.get("display_name") or ""
        ss = author.get("summary_stats") or {}
        prof["metrics"] = {"works_count": author.get("works_count"), "cited_by_count": author.get("cited_by_count"),
                           "h_index": ss.get("h_index"), "i10_index": ss.get("i10_index"),
                           "mean_citedness_2yr": round(ss.get("2yr_mean_citedness") or 0, 2)}
        prof["topics"] = [{"name": t.get("display_name"), "count": t.get("count"),
                           "field": _v(t, "field", "display_name")} for t in (author.get("topics") or [])[:10]]
        prof["counts_by_year"] = sorted([{"year": c.get("year"), "works": c.get("works_count"),
                                          "citations": c.get("cited_by_count")}
                                         for c in author.get("counts_by_year") or []], key=lambda c: c["year"])
        prof["oa_affiliations"] = sorted([{
            "organization": _v(a, "institution", "display_name") or "", "country": _v(a, "institution", "country_code") or "",
            "years": sorted(a.get("years") or [])} for a in author.get("affiliations") or []],
            key=lambda a: -(a["years"][-1] if a["years"] else 0))
        prof["last_known"] = [i.get("display_name") for i in author.get("last_known_institutions") or []]
        prof["sources"].append({"name": "OpenAlex", "url": f"https://openalex.org/authors/{aid}",
                                "what": "metrics, affiliations over time, topics, works and citations"})
        try:
            oa_items = [_oa_item(w, aid) for w in openalex_author_works(aid, email)]
        except MetadataError as exc:
            oa_items = []
            prof["warnings"].append(f"OpenAlex works: {exc}")
    else:
        oa_items = []
        prof["warnings"].append("Not found in OpenAlex: metrics and citation counts are not available.")

    orcid_items = []
    if orcid_data:
        for w in orcid_data["works"]:
            w.update({"authors": [], "position": "", "cited_by": None, "oa_type": "", "source_type": "",
                      "volume": "", "issue": "", "pages": "", "oa_url": "", "openalex_id": ""})
            orcid_items.append(w)
    for it in oa_items:
        it["sources"] = ["OpenAlex"]
    for it in orcid_items:
        it["sources"] = ["ORCID"]

    works, log = merge_works(oa_items, orcid_items)
    # ORCID-only works: fetch their contributor lists
    orcid_only = [w for w in works if w["sources"] == ["ORCID"] and w.get("put_codes")]
    if orcid_only and orcid:
        try:
            details = orcid_work_details(orcid, [w["put_codes"][0] for w in orcid_only][:300])
            for w in orcid_only:
                d = details.get(w["put_codes"][0])
                if d:
                    w["authors"] = d["authors"] or w["authors"]
                    w["venue"] = w["venue"] or d["venue"]
                    w["url"] = w["url"] or d["url"]
        except MetadataError as exc:
            prof["warnings"].append(f"ORCID work details: {exc}")
    prof["works"], prof["merge_log"] = works, log
    try:
        add_roles(prof)
    except MetadataError as exc:
        prof["warnings"].append(f"Co-first/co-last check (PubMed): {exc}")

    # current position
    current = [e for e in prof["employments"] if not e["end"] and e["kind"] == "employment"]
    if current:
        prof["current"] = [{"organization": e["organization"], "role": e["role"], "department": e["department"],
                            "since": e["start"], "source": "ORCID"} for e in current]
    elif prof.get("last_known"):
        prof["current"] = [{"organization": n, "role": "", "department": "", "since": "", "source": "OpenAlex"}
                           for n in prof["last_known"]]
    if orcid:
        photo = wikidata_photo(orcid)
        if photo and photo.get("url"):
            photo["data"] = fetch_photo_data(photo["url"])
            prof["photo"] = photo
            prof["sources"].append({"name": "Wikidata", "url": photo["page"], "what": "photo (Wikimedia Commons)"})
    return prof


# --------------------------------------------------------------------------- #
# Export helpers
# --------------------------------------------------------------------------- #
_CITE_TYPES = {"article": "article", "preprint": "preprint", "conference": "conference", "abstract": "conference",
               "book": "book", "thesis": "thesis", "data": "dataset", "other": "other"}


def item_to_paper(it: dict) -> dict:
    """Convert a publication-list item to the paper dict used by citations.py."""
    typ = _CITE_TYPES.get(it.get("category"), "other")
    if it.get("category") == "abstract" and it.get("source_type") == "journal":
        typ = "article"
    if it.get("category") == "book" and it.get("venue"):
        typ = "chapter"
    return {
        "title": it.get("title") or "", "authors": [split_name(a) for a in it.get("authors") or [] if a],
        "year": it.get("year"), "journal": it.get("venue") or "", "journal_abbr": "", "volume": it.get("volume") or "",
        "issue": it.get("issue") or "", "pages": it.get("pages") or "", "publisher": "", "type": typ,
        "doi": it.get("doi") or "", "url": it.get("url") or "", "arxiv_id": "",
        "keywords": [], "abstract": "", "notes": "", "uid": it.get("key"),
    }


def publication_page(prof: dict, items: list, style: str = "apa") -> str:
    """A standalone, shareable HTML page with the researcher's publication list."""
    import html as H
    import citations
    esc = H.escape
    cur = "; ".join(" – ".join(x for x in (c.get("role"), c.get("department"), c.get("organization")) if x)
                    for c in prof.get("current") or [])
    m = prof.get("metrics") or {}
    stats = " · ".join(f"{label}: {m[k]:,}" for k, label in (("works_count", "Works"), ("cited_by_count", "Citations"),
                                                             ("h_index", "h-index"), ("i10_index", "i10-index"))
                       if m.get(k) is not None)
    sections = []
    for cat, label in CATEGORIES:
        group = [it for it in items if it["category"] == cat]
        if not group:
            continue
        group.sort(key=lambda x: (-(x.get("year") or 0), x["title"].lower()))
        lis = []
        for it in group:
            ref = citations.cite_html(item_to_paper(it), style)
            ref = re.sub(r'(https?://[^\s<]+?)([.,;)]?)(?=\s|<|$)', r'<a href="\1">\1</a>\2', ref)
            link = f"https://doi.org/{it['doi']}" if it.get("doi") else it.get("url")
            extra = f' <a href="{esc(link)}">{esc(link)}</a>' if link and link not in ref else ""
            lis.append(f"<li>{ref}{extra}</li>")
        sections.append(f"<h2>{esc(label)} <span class='n'>({len(group)})</span></h2><ol reversed>{''.join(lis)}</ol>")
    src = " · ".join(f'<a href="{esc(s["url"])}">{esc(s["name"])}</a>' for s in prof.get("sources") or [])
    orcid = prof.get("orcid")
    photo = (prof.get("photo") or {}).get("url")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(prof.get('name') or 'Publications')} – publications</title>
<style>
body{{font:16px/1.55 Georgia,'Times New Roman',serif;max-width:52em;margin:2.5em auto;padding:0 1.2em;color:#1d2026;background:#fff}}
header{{display:flex;gap:1.2em;align-items:center;border-bottom:1px solid #ddd;padding-bottom:1em}}
header img{{width:96px;height:96px;border-radius:50%;object-fit:cover}}
h1{{margin:0;font-size:1.8em}} .meta{{color:#555;font-family:-apple-system,Segoe UI,sans-serif;font-size:.9em}}
h2{{font-family:-apple-system,Segoe UI,sans-serif;font-size:1.15em;margin-top:2em;border-bottom:1px solid #eee;padding-bottom:.2em}}
.n{{color:#888;font-weight:normal}} li{{margin:.55em 0}} a{{color:#2c64d6;word-break:break-all}}
footer{{margin-top:3em;color:#777;font:13px -apple-system,Segoe UI,sans-serif;border-top:1px solid #eee;padding-top:1em}}
@media (prefers-color-scheme:dark){{body{{background:#16171a;color:#e6e7e9}} .meta,footer{{color:#9c9fa6}} a{{color:#6d9bff}}}}
</style></head><body>
<header>{f'<img src="{esc(photo)}" alt="" onerror="this.remove()">' if photo else ''}<div><h1>{esc(prof.get('name') or '')}</h1>
<div class="meta">{esc(cur)}</div>
<div class="meta">{f'ORCID: <a href="https://orcid.org/{esc(orcid)}">{esc(orcid)}</a>' if orcid else ''}{' · ' + esc(stats) + ' (OpenAlex)' if stats else ''}</div></div></header>
{''.join(sections)}
<footer>{len(items)} publications. Compiled with PaperShelf on {datetime.now().strftime('%d %B %Y')} from {src}. Duplicates merged automatically.</footer>
</body></html>"""


# --------------------------------------------------------------------------- #
# Photos are downloaded once and kept locally (works offline, nothing is
# requested from other sites when you open the profile again)
# --------------------------------------------------------------------------- #
def fetch_photo_data(url: str) -> str:
    import base64
    try:
        r = metadata.http_get(url, browser=True, timeout=20)
    except MetadataError:
        return ""
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
    if r.status_code != 200 or not ctype.startswith("image/") or len(r.content) > 1_500_000:
        return ""
    return f"data:{ctype};base64," + base64.b64encode(r.content).decode()


# --------------------------------------------------------------------------- #
# Google Scholar: data captured by the user from the public profile page they
# are viewing (PaperShelf never queries Google Scholar by itself)
# --------------------------------------------------------------------------- #
def _num(s):
    s = re.sub(r"[^\d]", "", str(s or ""))
    return int(s) if s else None


def parse_scholar(data: dict) -> dict:
    """Normalise what the browser button captured from a Scholar profile page."""
    stats = data.get("stats") or []
    head = data.get("head") or []
    since = next((h for h in head[2:3]), "")

    def row(i):
        r = stats[i] if i < len(stats) else []
        return {"all": _num(r[1]) if len(r) > 1 else None, "since": _num(r[2]) if len(r) > 2 else None}

    years = [_num(y) for y in data.get("years") or [] if _num(y)]
    counts = []
    bars = data.get("bars") or []
    if years and bars:
        if len(bars) == len(years):
            counts = [{"year": y, "citations": _num(b.get("value")) or 0} for y, b in zip(years, bars)]
        else:  # years with no citations have no bar: use the z-index to place them
            per = {y: 0 for y in years}
            for b in bars:
                z = _num(b.get("z"))
                if z:
                    y = max(years) - z + 1
                    if y in per:
                        per[y] = _num(b.get("value")) or 0
            counts = [{"year": y, "citations": c} for y, c in sorted(per.items())]
    pubs = []
    for p in data.get("pubs") or []:
        title = clean_text(p.get("title") or "", "")
        if not title:
            continue
        pubs.append({"title": title, "authors": [a.strip() for a in (p.get("authors") or "").split(",") if a.strip()],
                     "venue": clean_text(p.get("venue") or "", ""), "year": _num(p.get("year")),
                     "cites": _num(p.get("cites")) or 0, "link": p.get("link") or ""})
    return {
        "url": (data.get("url") or "").split("#")[0], "name": clean_text(data.get("name") or "", ""),
        "affiliation": clean_text(data.get("affiliation") or "", ""),
        "interests": [clean_text(i, "") for i in data.get("interests") or [] if i],
        "photo_url": "" if "avatar_scholar" in (data.get("photo") or "") else (data.get("photo") or ""),
        "metrics": {"citations": row(0), "h_index": row(1), "i10_index": row(2), "since_label": since},
        "counts_by_year": counts, "pubs": pubs, "captured_at": _now(),
    }


def _classify_scholar(venue: str, title: str) -> str:
    v = (venue or "").lower()
    if not v:
        return "other"
    if any(x in v for x in PREPRINT_VENUES):
        return "preprint"
    if ABSTRACT_VENUE_RE.search(v) or ABSTRACT_TITLE_RE.search(title or ""):
        return "abstract"
    if re.search(r"\b(thesis|dissertation|tesi)\b", v):
        return "thesis"
    if "patent" in v:
        return "other"
    if re.search(r"\b(proceedings|conference)\b", v):
        return "conference"
    return "article"


def merge_scholar(works: list, scholar: dict, family_names: list):
    """Add the Scholar list to the merged publication list. Returns (works, log)."""
    import copy
    works = copy.deepcopy(works)
    log = []
    by_year: dict = {}
    for w in works:
        w["_nt"] = norm_title(w["title"])
        by_year.setdefault(w.get("year"), []).append(w)
    for p in scholar.get("pubs") or []:
        nt = norm_title(p["title"])
        y = p.get("year")
        cands = [c for yy in ((y - 1, y, y + 1) if y else (None,)) for c in by_year.get(yy, [])] or \
                ([c for c in works] if not y else [])
        best, score = None, 0.0
        for c in cands:
            if not c["_nt"] or not nt:
                continue
            s = 1.0 if c["_nt"] == nt else difflib.SequenceMatcher(None, c["_nt"], nt).ratio()
            if s > score or (s == score and best is not None and best["category"] == "preprint" and c["category"] != "preprint"):
                best, score = c, s
        if best is not None and score >= 0.9:
            best["scholar_cites"] = max(best.get("scholar_cites") or 0, p["cites"])
            if "Scholar" not in best["sources"]:
                best["sources"] = best["sources"] + ["Scholar"]
            log.append({"kept": best["title"], "merged": p["title"], "merged_sources": ["Scholar"],
                        "kept_sources": best["sources"], "reason": "same title and year"})
            continue
        authors = p["authors"]
        position = ""
        if authors and family_names:
            first, last = authors[0].lower(), authors[-1].lower()
            if any(f and f in first for f in family_names):
                position = "first"
            elif authors[-1] != "..." and any(f and f in last for f in family_names):
                position = "last"
            elif any(f and f in a.lower() for a in authors for f in family_names):
                position = "middle"
        item = {"title": p["title"], "year": y, "venue": p["venue"], "authors": [a for a in authors if a != "..."],
                "doi": "", "dois": [], "url": p.get("link") or "", "oa_type": "", "orcid_type": "", "source_type": "",
                "volume": "", "issue": "", "pages": "", "cited_by": None, "scholar_cites": p["cites"],
                "position": position, "sources": ["Scholar"], "openalex_id": "", "put_codes": [], "issns": [],
                "category": _classify_scholar(p["venue"], p["title"]),
                "role": ("sole" if len([a for a in authors if a != "..."]) == 1 and position else position),
                "role_source": "Google Scholar" if position else "",
                "key": "gs:" + re.sub(r"\s+", "-", nt)[:70] + f":{y or ''}"}
        item["_nt"] = nt
        works.append(item)
        by_year.setdefault(y, []).append(item)
    for w in works:
        w.pop("_nt", None)
    works.sort(key=lambda x: (-(x.get("year") or 0), x["title"].lower()))
    return works, log


def profile_from_scholar(sch: dict) -> dict:
    """A profile for someone who has no ORCID record (built only from their Scholar page)."""
    return {"orcid": None, "openalex_id": None, "name": sch["name"], "photo": None, "bio": "",
            "keywords": sch["interests"], "urls": [], "current": [{"organization": sch["affiliation"], "role": "",
            "department": "", "since": "", "source": "Google Scholar"}] if sch["affiliation"] else [],
            "employments": [], "educations": [], "distinctions": [], "memberships": [], "fundings": [], "metrics": {},
            "topics": [], "counts_by_year": [], "oa_affiliations": [], "works": [], "merge_log": [], "sources": [],
            "warnings": ["Built from the Google Scholar page only. Search the ORCID iD to add the official career data."],
            "fetched_at": _now()}


# --------------------------------------------------------------------------- #
# Authorship roles: first, co-first, last, co-last (equal contribution from PubMed)
# --------------------------------------------------------------------------- #
ROLE_LABELS = {"first": "first author", "co-first": "co-first author", "last": "last author",
               "co-last": "co-last author", "sole": "sole author", "middle": "co-author"}


def _ascii_low(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def researcher_names(prof: dict) -> list[tuple[str, str]]:
    """[(family name, first initial)] in plain lowercase ASCII, for matching author lists."""
    out = []
    fam, giv = prof.get("family") or "", prof.get("given") or ""
    if fam:
        out.append((_ascii_low(fam), _ascii_low(giv)[:1]))
    for n in [prof.get("name") or ""] + list(prof.get("other_names") or []):
        parts = split_name(n)
        if parts["family"]:
            out.append((_ascii_low(parts["family"]), _ascii_low(parts["given"])[:1]))
    seen, res = set(), []
    for f, i in out:
        f = re.sub(r"[^a-z\- ']", "", f).strip()
        if f and (f, i) not in seen:
            seen.add((f, i))
            res.append((f, i))
    return res


def _name_match(names, family, given_or_initials):
    fam = re.sub(r"[^a-z\- ']", "", _ascii_low(family)).strip()
    ini = _ascii_low(given_or_initials)[:1]
    for f, i in names:
        if not fam or not f:
            continue
        same = fam == f or fam.replace("-", " ") == f.replace("-", " ") or \
            (len(f) > 3 and (f in fam.split() or fam in f.split()))
        if same and (not i or not ini or i == ini):
            return True
    return False


def _author_index(authors, names, hint=""):
    hits = [i for i, a in enumerate(authors) if _name_match(names, a["last"], a.get("fore") or a.get("initials"))]
    if not hits:
        return None
    if hint == "last":
        return hits[-1]
    return hits[0]


def pubmed_authors(pmids: list) -> dict:
    """{pmid: [{'last', 'fore', 'initials', 'equal'}]} from PubMed (EqualContrib flags)."""
    import xml.etree.ElementTree as ET
    out = {}
    pmids = [p for p in dict.fromkeys(pmids) if p]
    for i in range(0, len(pmids), 150):
        chunk = pmids[i:i + 150]
        r = metadata.http_get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                              params={"db": "pubmed", "id": ",".join(chunk), "retmode": "xml"},
                              accept="application/xml", timeout=60)
        if r.status_code != 200:
            raise MetadataError(f"PubMed returned an error (HTTP {r.status_code}).")
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError as exc:
            raise MetadataError("Could not read the PubMed response.") from exc
        for art in root.iter("PubmedArticle"):
            pmid = (art.findtext("MedlineCitation/PMID") or "").strip()
            authors = []
            for a in art.findall("MedlineCitation/Article/AuthorList/Author"):
                if a.get("ValidYN", "Y") == "N":
                    continue
                last = a.findtext("LastName") or a.findtext("CollectiveName") or ""
                authors.append({"last": last, "fore": a.findtext("ForeName") or "", "initials": a.findtext("Initials") or "",
                                "equal": a.get("EqualContrib") == "Y"})
            if pmid and authors:
                out[pmid] = authors
    return out


def role_from_list(authors: list, idx: int) -> str:
    n = len(authors)
    if n == 1:
        return "sole"
    if idx == 0:
        return "first"
    if idx == n - 1:
        return "last"
    eq = [a.get("equal") for a in authors]
    if eq[idx] and all(eq[: idx + 1]):
        return "co-first"
    if eq[idx] and all(eq[idx:]):
        return "co-last"
    return "middle"


def base_role(w: dict, names) -> str:
    pos = w.get("position") or ""
    authors = [a for a in (w.get("authors") or []) if a and a != "…" and a != "..."]
    if len(authors) == 1 and pos in ("first", "last", ""):
        if not names or _name_match(names, split_name(authors[0])["family"], split_name(authors[0])["given"]):
            return "sole"
    if pos in ("first", "last", "middle"):
        return pos
    for i, a in enumerate(authors):  # no position from OpenAlex: find the name in the author list
        sp = split_name(a)
        if _name_match(names, sp["family"], sp["given"]):
            if i == 0:
                return "first"
            if i == len(authors) - 1 and not str(w.get("authors", [""])[-1]).startswith("..."):
                return "last"
            return "middle"
    return ""


def add_roles(prof: dict, online: bool = True):
    """Set w['role'] for every work; co-first/co-last from PubMed's equal-contribution flags."""
    names = researcher_names(prof)
    works = prof.get("works") or []
    pub = {}
    if online:
        pmids = [w.get("pmid") for w in works if w.get("pmid")]
        if pmids:
            pub = pubmed_authors(pmids)
    for w in works:
        role, src = base_role(w, names), ""
        authors = pub.get(w.get("pmid") or "")
        if authors:
            idx = _author_index(authors, names, w.get("position") or "")
            if idx is not None:
                role, src = role_from_list(authors, idx), "PubMed"
        w["role"] = role
        w["role_source"] = src or ("OpenAlex" if w.get("position") else "")
    prof["roles_checked"] = _now() if online else prof.get("roles_checked", "")
    return prof
