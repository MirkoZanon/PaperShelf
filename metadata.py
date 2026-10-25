"""
metadata.py - turn whatever the user pastes into structured paper metadata.

Accepted input:
  * a DOI (10.1038/...), a doi.org link, or any publisher link containing a DOI
  * an arXiv link or ID (2101.00001, arXiv:2101.00001v2, arxiv.org/pdf/...)
  * a PubMed link
  * any other article web page (reads the Google Scholar "citation_*" meta tags)
  * a direct link to a PDF (looks for a DOI / arXiv ID inside the PDF)
  * a plain title or a full reference string (searched on Crossref)

Free sources used (no API key needed):
  Crossref (bibliographic data), OpenAlex (keywords, abstracts, open-access
  locations), arXiv API, NCBI E-utilities (PubMed).
"""
from __future__ import annotations

import difflib
import html
import io
import re
import unicodedata
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import quote, unquote, urljoin, urlparse

import requests

TIMEOUT = 20

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.5 Safari/605.1.15"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class MetadataError(Exception):
    """A lookup failed; the message is meant to be shown to the user."""


class NetworkError(MetadataError):
    """A remote service could not be reached."""


# --------------------------------------------------------------------------- #
# HTTP helper
# --------------------------------------------------------------------------- #
def _host(url: str) -> str:
    return urlparse(url).netloc or url


def _api_headers(email: str = "") -> dict:
    # Privacy: no e-mail or other personal data is ever sent to these services.
    ua = "PaperShelf/1.0 (personal reference manager)"
    return {"User-Agent": ua, "Accept": "application/json"}


OPENALEX_KEY = ""  # optional free API key (Settings); set by app.py


def http_get(url, *, params=None, email="", browser=False, timeout=TIMEOUT, accept=None):
    headers = dict(BROWSER_HEADERS) if browser else _api_headers(email)
    if accept:
        headers["Accept"] = accept
    is_openalex = "api.openalex.org" in url
    if is_openalex and OPENALEX_KEY:
        params = dict(params or {})
        params["api_key"] = OPENALEX_KEY
    try:
        r = requests.get(url, params=params, headers=headers, timeout=timeout, allow_redirects=True)
    except requests.exceptions.RequestException as exc:
        raise NetworkError(
            f"Could not reach {_host(url)} ({exc.__class__.__name__}). Check your internet connection."
        ) from exc
    if is_openalex and r.status_code in (402, 429):
        raise NetworkError("OpenAlex's free daily allowance is used up. Add a free OpenAlex API key in "
                           "Settings (openalex.org/settings/api) or try again tomorrow.")
    return r


def _polite(email: str) -> dict | None:
    return None  # privacy: we don't send the user's e-mail to Crossref/OpenAlex


# --------------------------------------------------------------------------- #
# Identifier patterns
# --------------------------------------------------------------------------- #
DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s\"'<>]+)", re.I)
OPENALEX_RE = re.compile(r"^(?:https?://(?:api\.)?openalex\.org/(?:works/)?)?(W\d{2,})$", re.I)
ARXIV_DOI_RE = re.compile(r"^10\.48550/arxiv\.(.+)$", re.I)
ARXIV_URL_RE = re.compile(r"(?:arxiv\.org/(?:abs|pdf|html)/|\barxiv:\s*)(\d{4}\.\d{4,5})(v\d+)?", re.I)
ARXIV_OLD_RE = re.compile(r"(?:arxiv\.org/(?:abs|pdf)/|\barxiv:\s*)([a-z\-]+(?:\.[a-z]{2})?/\d{7})(v\d+)?", re.I)
ARXIV_BARE_RE = re.compile(r"^(\d{4}\.\d{4,5})(v\d+)?$")
PMID_URL_RE = re.compile(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", re.I)
PMID_BARE_RE = re.compile(r"^pmid:?\s*(\d{4,9})$", re.I)

_DOI_SUFFIXES = (
    "/full", "/abstract", "/pdf", "/epdf", "/pdfft", "/fulltext", "/html", "/summary", "/meta",
    "/references", "/figures", "/epub", "/full.pdf", ".full.pdf", ".full-text", ".full",
    ".abstract", ".pdf", ".supplementary-material",
)


def clean_doi(raw: str) -> str:
    """Normalise a DOI taken from a URL or free text."""
    doi = unquote(raw or "").strip()
    doi = re.sub(r"^(?:https?://)?(?:dx\.)?doi\.org/", "", doi, flags=re.I)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.I)
    doi = re.split(r"[?#\s]", doi)[0]
    changed = True
    while changed:
        changed = False
        stripped = doi.rstrip(".,;:)]}>\"'")
        if stripped != doi:
            doi, changed = stripped, True
        for suf in _DOI_SUFFIXES:
            if doi.lower().endswith(suf):
                doi, changed = doi[: -len(suf)], True
    return doi


def _doi_candidates(doi: str) -> list[str]:
    """The DOI plus progressively trimmed variants (URLs often add extra path parts)."""
    cands = [doi]
    m = re.match(r"^(.*?\d)v\d+$", doi)  # bioRxiv style ".../2020.01.01.123456v2"
    if m:
        cands.append(m.group(1))
    parts = doi.split("/")
    for n in range(len(parts) - 1, 1, -1):
        cands.append("/".join(parts[:n]))
    out: list[str] = []
    for c in cands:
        if c not in out:
            out.append(c)
    return out[:5]


# --------------------------------------------------------------------------- #
# Small text helpers
# --------------------------------------------------------------------------- #
_TAG_RE = re.compile(r"<[^>]+>")


def clean_text(s, tag_sep: str = " ") -> str:
    if not s:
        return ""
    s = html.unescape(_TAG_RE.sub(tag_sep, str(s)))
    return " ".join(s.split())


def _clean_abstract(s) -> str:
    s = clean_text(s)
    return re.sub(r"^(abstract|summary)[\s.:]+", "", s, flags=re.I)


_PARTICLES = {"van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "dos", "das",
              "la", "le", "ter", "ten", "bin", "al", "el"}


def split_name(full: str) -> dict:
    """'Ludwig van Beethoven' -> {'given': 'Ludwig', 'family': 'van Beethoven'}."""
    full = " ".join((full or "").split())
    if not full:
        return {"given": "", "family": ""}
    if "," in full:
        fam, _, giv = full.partition(",")
        return {"given": giv.strip(), "family": fam.strip()}
    parts = full.split(" ")
    if len(parts) == 1:
        return {"given": "", "family": parts[0]}
    i = len(parts) - 1
    while i > 1 and parts[i - 1].lower() in _PARTICLES:
        i -= 1
    return {"given": " ".join(parts[:i]), "family": " ".join(parts[i:])}


def merge_keywords(*lists, limit: int = 12) -> list[str]:
    seen, out = set(), []
    for lst in lists:
        for k in lst or []:
            k = clean_text(k).strip(" .;,")
            if not k or len(k) > 60:
                continue
            key = k.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(k)
    return out[:limit]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def empty_meta() -> dict:
    return {
        "title": "", "authors": [], "year": None, "journal": "", "volume": "", "issue": "",
        "pages": "", "publisher": "", "type": "article", "doi": "", "arxiv_id": "", "url": "",
        "abstract": "", "keywords": [], "pdf_url": "", "notes": "", "journal_abbr": "",
        "openalex_id": "", "refs": [], "related": [], "cited_by_count": None,
    }


# --------------------------------------------------------------------------- #
# Crossref
# --------------------------------------------------------------------------- #
_CR_TYPES = {
    "journal-article": "article", "proceedings-article": "conference", "book-chapter": "chapter",
    "book-section": "chapter", "book-part": "chapter", "reference-entry": "chapter", "book": "book",
    "monograph": "book", "edited-book": "book", "reference-book": "book",
    "posted-content": "preprint", "dissertation": "thesis", "report": "report", "dataset": "dataset",
}


def crossref_lookup(doi: str, email: str = ""):
    """Return (doi, crossref_message) or None when Crossref has no record."""
    for cand in _doi_candidates(doi):
        r = http_get("https://api.crossref.org/works/" + quote(cand, safe="/:;()"),
                     params=_polite(email), email=email)
        if r.status_code == 200:
            try:
                return cand, r.json()["message"]
            except (ValueError, KeyError):
                continue
    return None


def _crossref_year(msg: dict):
    for key in ("issued", "published-print", "published-online", "published", "created"):
        parts = (msg.get(key) or {}).get("date-parts") or []
        if parts and parts[0] and parts[0][0]:
            try:
                return int(parts[0][0])
            except (TypeError, ValueError):
                pass
    return None


def _from_crossref(msg: dict) -> dict:
    m = empty_meta()
    title = clean_text((msg.get("title") or [""])[0], "")
    sub = msg.get("subtitle") or []
    sub = clean_text(sub[0], "") if sub else ""
    if sub and sub.lower() not in title.lower():
        title = f"{title}: {sub}"
    m["title"] = title
    for a in msg.get("author") or []:
        if a.get("family"):
            m["authors"].append({"given": (a.get("given") or "").strip(), "family": a["family"].strip()})
        elif a.get("name"):  # organisation as author
            m["authors"].append({"given": "", "family": a["name"].strip()})
    m["year"] = _crossref_year(msg)
    container = msg.get("container-title") or []
    m["journal"] = clean_text(container[0], "") if container else ""
    short = msg.get("short-container-title") or []
    m["journal_abbr"] = clean_text(short[0], "") if short else ""
    if not m["journal"] and msg.get("type") == "posted-content":
        inst = msg.get("institution") or [{}]
        m["journal"] = (inst[0] or {}).get("name", "") if isinstance(inst, list) and inst else ""
    m["volume"] = str(msg.get("volume") or "")
    m["issue"] = str(msg.get("issue") or "")
    m["pages"] = str(msg.get("page") or msg.get("article-number") or "")
    m["publisher"] = msg.get("publisher") or ""
    m["type"] = _CR_TYPES.get(msg.get("type", ""), "article")
    m["doi"] = msg.get("DOI") or ""
    m["url"] = f"https://doi.org/{m['doi']}" if m["doi"] else (msg.get("URL") or "")
    m["abstract"] = _clean_abstract(msg.get("abstract"))
    m["keywords"] = merge_keywords(msg.get("subject") or [])
    return m


def search_crossref(text: str, email: str = "", strict: bool = False) -> dict:
    """Find a paper on Crossref from a title or a full reference string."""
    params = {"query.bibliographic": text[:500], "rows": 5}
    r = http_get("https://api.crossref.org/works", params=params, email=email)
    if r.status_code != 200:
        raise MetadataError(f"Crossref search failed (HTTP {r.status_code}). Try again in a moment.")
    try:
        items = r.json().get("message", {}).get("items", [])
    except ValueError:
        items = []
    nt = _norm(text)
    best, best_score = None, 0.0
    for it in items:
        t = _norm(clean_text((it.get("title") or [""])[0], ""))
        if not t:
            continue
        score = 1.0 if (len(t) >= 20 and t in nt) else difflib.SequenceMatcher(None, t, nt).ratio()
        if score > best_score:
            best, best_score = it, score
    if not best or best_score < (0.85 if strict else 0.75):
        raise MetadataError(
            "No confident match found for that title. Try pasting the DOI or the article link instead."
        )
    return from_doi(best["DOI"], email, _crossref=(best["DOI"], best))


# --------------------------------------------------------------------------- #
# OpenAlex
# --------------------------------------------------------------------------- #
def openalex_lookup(doi: str, email: str = ""):
    r = http_get("https://api.openalex.org/works/doi:" + quote(doi, safe="/:;()"),
                 params=_polite(email), email=email)
    if r.status_code != 200:
        return None
    try:
        return r.json()
    except ValueError:
        return None


def openalex_pdf_urls(w: dict) -> list[str]:
    urls: list[str] = []
    locs = [w.get("best_oa_location"), w.get("primary_location")] + list(w.get("locations") or [])
    for loc in locs:
        if loc and loc.get("pdf_url") and loc["pdf_url"] not in urls:
            urls.append(loc["pdf_url"])
    return urls


def openalex_keywords(w: dict) -> list[str]:
    return [k.get("display_name", "") for k in (w.get("keywords") or []) if isinstance(k, dict)]


def _openalex_fallback_keywords(w: dict) -> list[str]:
    out = []
    t = w.get("primary_topic") or {}
    for key in ("subfield", "field"):
        name = (t.get(key) or {}).get("display_name")
        if name:
            out.append(name)
    for c in w.get("concepts") or []:
        if (c.get("level") or 0) >= 1 and (c.get("score") or 0) >= 0.4:
            out.append(c.get("display_name", ""))
    return out[:6]


def inverted_to_text(inv: dict) -> str:
    pos = [(i, word) for word, idxs in (inv or {}).items() for i in idxs]
    return " ".join(w for _, w in sorted(pos))


def openalex_short(wid) -> str:
    return (wid or "").rsplit("/", 1)[-1]


def citation_fields(w: dict) -> dict:
    """Citation-network data kept for each paper (OpenAlex work IDs)."""
    return {
        "openalex_id": openalex_short(w.get("id")),
        "refs": [openalex_short(x) for x in (w.get("referenced_works") or [])],
        "related": [openalex_short(x) for x in (w.get("related_works") or [])],
        "cited_by_count": w.get("cited_by_count"),
    }


def _short_authors(w: dict) -> str:
    names = [((a.get("author") or {}).get("display_name") or "") for a in (w.get("authorships") or [])]
    names = [split_name(n)["family"] for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} & {names[1]}"
    return f"{names[0]} et al."


def work_summary(w: dict) -> dict:
    """Compact description of an OpenAlex work (used for suggestions and the map)."""
    src = (w.get("primary_location") or {}).get("source") or {}
    return {
        "id": openalex_short(w.get("id")),
        "doi": re.sub(r"^https?://doi\.org/", "", w.get("doi") or ""),
        "title": clean_text(w.get("display_name") or w.get("title") or "", ""),
        "authors": _short_authors(w),
        "year": w.get("publication_year"),
        "venue": src.get("display_name") or "",
        "cited_by_count": w.get("cited_by_count") or 0,
        "refs": [openalex_short(x) for x in (w.get("referenced_works") or [])],
    }


_SUMMARY_FIELDS = "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,referenced_works"


def openalex_works(ids, email: str = "") -> list[dict]:
    """Fetch summaries for many OpenAlex IDs (50 per request)."""
    out = []
    ids = [openalex_short(i) for i in ids if i]
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        params = {"filter": "openalex_id:" + "|".join(chunk), "per_page": 50, "select": _SUMMARY_FIELDS}
        r = http_get("https://api.openalex.org/works", params=params, email=email)
        if r.status_code != 200:
            raise MetadataError(f"OpenAlex returned an error (HTTP {r.status_code}).")
        try:
            out += [work_summary(w) for w in r.json().get("results", [])]
        except ValueError:
            pass
    return out


def openalex_citing(ids, email: str = "", since_year: int | None = None, limit: int = 100) -> list[dict]:
    """Works that cite at least one of the given OpenAlex IDs."""
    ids = [openalex_short(i) for i in ids if i][:50]
    if not ids:
        return []
    flt = "cites:" + "|".join(ids)
    if since_year:
        flt += f",from_publication_date:{since_year}-01-01"
    params = {"filter": flt, "per_page": min(limit, 200), "sort": "cited_by_count:desc", "select": _SUMMARY_FIELDS}
    r = http_get("https://api.openalex.org/works", params=params, email=email)
    if r.status_code != 200:
        raise MetadataError(f"OpenAlex returned an error (HTTP {r.status_code}).")
    try:
        return [work_summary(w) for w in r.json().get("results", [])]
    except ValueError:
        return []


def openalex_for_paper(paper: dict, email: str = ""):
    """Find the OpenAlex record of a paper already in the library."""
    if paper.get("openalex_id"):
        r = http_get(f"https://api.openalex.org/works/{paper['openalex_id']}", params=_polite(email), email=email)
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                pass
    doi = paper.get("doi") or (f"10.48550/arXiv.{paper['arxiv_id']}" if paper.get("arxiv_id") else "")
    if doi:
        return openalex_lookup(doi, email)
    return None


def from_openalex_id(wid: str, email: str = "") -> dict:
    r = http_get(f"https://api.openalex.org/works/{openalex_short(wid)}", params=_polite(email), email=email)
    if r.status_code != 200:
        raise MetadataError(f"OpenAlex work {wid} was not found.")
    w = r.json()
    doi = re.sub(r"^https?://doi\.org/", "", w.get("doi") or "")
    if doi:
        try:
            return from_doi(doi, email)
        except NetworkError:
            raise
        except MetadataError:
            pass
    m = _from_openalex(w)
    m.update(citation_fields(w))
    pdfs = openalex_pdf_urls(w)
    m["pdf_url"] = pdfs[0] if pdfs else ""
    return m


_OA_TYPES = {"article": "article", "preprint": "preprint", "book-chapter": "chapter", "book": "book",
             "dissertation": "thesis", "dataset": "dataset", "report": "report"}


def _from_openalex(w: dict) -> dict:
    m = empty_meta()
    m["title"] = clean_text(w.get("title") or w.get("display_name") or "", "")
    for a in w.get("authorships") or []:
        name = (a.get("author") or {}).get("display_name") or a.get("raw_author_name") or ""
        if name:
            m["authors"].append(split_name(name))
    m["year"] = w.get("publication_year")
    src = (w.get("primary_location") or {}).get("source") or {}
    m["journal"] = src.get("display_name") or ""
    b = w.get("biblio") or {}
    m["volume"] = str(b.get("volume") or "")
    m["issue"] = str(b.get("issue") or "")
    fp, lp = b.get("first_page") or "", b.get("last_page") or ""
    m["pages"] = f"{fp}-{lp}" if fp and lp and fp != lp else str(fp)
    m["type"] = _OA_TYPES.get(w.get("type"), "article")
    m["doi"] = re.sub(r"^https?://doi\.org/", "", w.get("doi") or "")
    m["url"] = w.get("doi") or (w.get("primary_location") or {}).get("landing_page_url") or ""
    if w.get("abstract_inverted_index"):
        m["abstract"] = inverted_to_text(w["abstract_inverted_index"])
    m["keywords"] = merge_keywords(openalex_keywords(w))
    return m


# --------------------------------------------------------------------------- #
# DOI
# --------------------------------------------------------------------------- #
def from_doi(doi: str, email: str = "", _crossref=None) -> dict:
    doi = clean_doi(doi)
    am = ARXIV_DOI_RE.match(doi)
    if am:
        return from_arxiv(am.group(1), email)

    errors: list[str] = []
    cr = _crossref
    if cr is None:
        try:
            cr = crossref_lookup(doi, email)
        except NetworkError as exc:
            errors.append(str(exc))
    found = cr[0] if cr else doi

    oa = None
    try:
        oa = openalex_lookup(found, email)
    except NetworkError as exc:
        errors.append(str(exc))

    if not cr and not oa:
        if errors:
            raise NetworkError(errors[0])
        raise MetadataError(f"No record found for DOI {doi}. Double-check it or paste the article link instead.")

    m = _from_crossref(cr[1]) if cr else _from_openalex(oa)
    if oa:
        alt = _from_openalex(oa)
        for k in ("year", "journal", "volume", "issue", "pages", "abstract", "title"):
            if not m.get(k) and alt.get(k):
                m[k] = alt[k]
        if not m["authors"]:
            m["authors"] = alt["authors"]
        m["keywords"] = merge_keywords(openalex_keywords(oa), m["keywords"])
        if not m["keywords"]:
            m["keywords"] = merge_keywords(_openalex_fallback_keywords(oa))
        pdfs = openalex_pdf_urls(oa)
        if pdfs and not m["pdf_url"]:
            m["pdf_url"] = pdfs[0]
        m.update(citation_fields(oa))
    m["doi"] = m["doi"] or found
    if not m["url"]:
        m["url"] = f"https://doi.org/{m['doi']}"
    return m


# --------------------------------------------------------------------------- #
# arXiv
# --------------------------------------------------------------------------- #
_ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
ARXIV_CATEGORIES = {
    "cs.AI": "artificial intelligence", "cs.LG": "machine learning", "stat.ML": "machine learning",
    "cs.CV": "computer vision", "cs.CL": "natural language processing", "cs.RO": "robotics",
    "cs.NE": "neural and evolutionary computing", "cs.IR": "information retrieval",
    "cs.HC": "human-computer interaction", "cs.CR": "cryptography and security",
    "cs.SE": "software engineering", "cs.DS": "data structures and algorithms",
    "q-bio.NC": "neuroscience", "q-bio.QM": "quantitative methods", "q-bio.GN": "genomics",
    "q-bio.BM": "biomolecules", "physics.bio-ph": "biological physics", "eess.IV": "image processing",
    "eess.SP": "signal processing", "eess.AS": "audio and speech processing",
    "math.OC": "optimization and control", "math.ST": "statistics theory", "stat.ME": "statistical methodology",
    "stat.AP": "applied statistics", "cond-mat.soft": "soft condensed matter", "quant-ph": "quantum physics",
    "astro-ph.CO": "cosmology", "astro-ph.GA": "galaxies", "hep-th": "high energy physics theory",
    "econ.EM": "econometrics", "q-fin.ST": "statistical finance",
}


def from_arxiv(aid: str, email: str = "") -> dict:
    base = re.sub(r"v\d+$", "", aid.strip())
    r = http_get("https://export.arxiv.org/api/query", params={"id_list": base, "max_results": 1},
                 accept="application/atom+xml")
    if r.status_code != 200:
        raise MetadataError(f"arXiv returned an error (HTTP {r.status_code}) for {base}.")
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError as exc:
        raise MetadataError("Could not read the arXiv response.") from exc
    entry = root.find("a:entry", _ATOM)
    if entry is None or "arxiv.org/abs/" not in (entry.findtext("a:id", "", _ATOM) or ""):
        raise MetadataError(f"arXiv ID {base} was not found.")

    m = empty_meta()
    m["title"] = " ".join((entry.findtext("a:title", "", _ATOM) or "").split())
    m["authors"] = [split_name(a.findtext("a:name", "", _ATOM)) for a in entry.findall("a:author", _ATOM)]
    pub = entry.findtext("a:published", "", _ATOM) or ""
    m["year"] = int(pub[:4]) if pub[:4].isdigit() else None
    m["abstract"] = " ".join((entry.findtext("a:summary", "", _ATOM) or "").split())
    cats = [c.get("term", "") for c in entry.findall("a:category", _ATOM)]
    m.update(type="preprint", journal="arXiv", publisher="arXiv", arxiv_id=base,
             doi=f"10.48550/arXiv.{base}", url=f"https://arxiv.org/abs/{base}",
             pdf_url=f"https://arxiv.org/pdf/{base}")
    pub_doi = (entry.findtext("arxiv:doi", "", _ATOM) or "").strip()
    jref = " ".join((entry.findtext("arxiv:journal_ref", "", _ATOM) or "").split())
    if pub_doi or jref:
        bits = [x for x in (jref, f"https://doi.org/{pub_doi}" if pub_doi else "") if x]
        m["notes"] = "Published version: " + " - ".join(bits)
    kws: list[str] = []
    try:
        w = openalex_lookup(m["doi"], email)
        if w:
            kws = openalex_keywords(w)
            m.update(citation_fields(w))
    except MetadataError:
        pass
    m["keywords"] = merge_keywords(kws, [ARXIV_CATEGORIES.get(c, c) for c in cats])
    return m


# --------------------------------------------------------------------------- #
# PubMed
# --------------------------------------------------------------------------- #
def from_pmid(pmid: str, email: str = "") -> dict:
    r = http_get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                 params={"db": "pubmed", "id": pmid, "retmode": "json"}, email=email)
    try:
        res = r.json()["result"][pmid]
    except (ValueError, KeyError, TypeError) as exc:
        raise MetadataError(f"PubMed ID {pmid} was not found.") from exc
    if res.get("error"):
        raise MetadataError(f"PubMed ID {pmid} was not found.")
    ids = {x.get("idtype"): x.get("value") for x in res.get("articleids", [])}
    if ids.get("doi"):
        try:
            return from_doi(ids["doi"], email)
        except MetadataError:
            pass
    m = empty_meta()
    m["title"] = clean_text(res.get("title", ""), "").rstrip(".")
    for a in res.get("authors", []):
        if a.get("authtype") not in (None, "Author"):
            continue
        name = a.get("name", "")
        fam, _, ini = name.rpartition(" ")
        if fam and ini.isupper() and len(ini) <= 4:
            m["authors"].append({"family": fam, "given": " ".join(ch + "." for ch in ini)})
        else:
            m["authors"].append(split_name(name))
    ym = re.search(r"\b(1[89]\d{2}|20\d{2})\b", res.get("pubdate", ""))
    m["year"] = int(ym.group(1)) if ym else None
    m["journal"] = res.get("fulljournalname") or res.get("source") or ""
    m["volume"], m["issue"], m["pages"] = res.get("volume", ""), res.get("issue", ""), res.get("pages", "")
    m["url"] = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    pmc = ids.get("pmc") or ids.get("pmcid") or ""
    if pmc:
        pmc = re.sub(r"^pmc-id:\s*", "", pmc).split(";")[0].strip()
        m["pdf_url"] = f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={pmc}&blobtype=pdf"
    return m


# --------------------------------------------------------------------------- #
# Web pages and PDFs
# --------------------------------------------------------------------------- #
class _MetaParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, list[str]] = {}
        self.title = ""
        self.canonical = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("name") or a.get("property") or a.get("itemprop") or "").strip().lower()
            if key and "content" in a:
                self.meta.setdefault(key, []).append(a["content"].strip())
        elif tag == "title":
            self._in_title = True
        elif tag == "link" and "canonical" in a.get("rel", "").lower():
            self.canonical = a.get("href", "")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and len(self.title) < 500:
            self.title += data


def parse_meta(text: str) -> _MetaParser:
    p = _MetaParser()
    try:
        p.feed(text[:800_000])
    except Exception:  # malformed HTML: keep whatever was parsed
        pass
    return p


def identifier_from_pdf(data: bytes) -> str:
    """Find a DOI, an arXiv ID or (as last resort) a title inside a PDF."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    texts, title = [], ""
    try:
        reader = PdfReader(io.BytesIO(data))
        try:
            info = reader.metadata or {}
            texts.extend(str(v) for v in info.values())
            title = (info.title or "").strip() if hasattr(info, "title") else ""
        except Exception:
            pass
        for page in reader.pages[:2]:
            try:
                texts.append(page.extract_text() or "")
            except Exception:
                pass
    except Exception:
        return ""
    blob = "\n".join(texts)
    labelled = re.search(r"(?:doi\.org/|doi:?\s*)(10\.\d{4,9}/[^\s\"'<>]+)", blob, re.I)
    if labelled:
        return clean_doi(labelled.group(1))
    ax = re.search(r"arXiv:\s*(\d{4}\.\d{4,5})(v\d+)?", blob, re.I)
    if ax:
        return "arXiv:" + ax.group(1)
    any_doi = DOI_RE.search(blob)
    if any_doi:
        return clean_doi(any_doi.group(1))
    if title and len(title) > 20 and not title.lower().endswith((".doc", ".docx", ".pdf")):
        return title
    return ""


def from_page(url: str, email: str = "") -> dict:
    if url.lower().startswith("www."):
        url = "https://" + url
    r = http_get(url, browser=True, timeout=30)
    data = r.content or b""
    ctype = (r.headers.get("Content-Type") or "").lower()

    if data[:5] == b"%PDF-" or "application/pdf" in ctype:
        ident = identifier_from_pdf(data)
        if not ident:
            raise MetadataError("This link is a PDF, but no DOI or arXiv ID was found inside it. "
                                "Paste the DOI or the article title instead.")
        m = resolve(ident, email)
        m["_pdf_bytes"] = data
        return m

    blocked = r.status_code in (401, 403, 429, 503)
    p = parse_meta(r.text if data else "")
    meta = p.meta

    def first(*keys):
        for k in keys:
            for v in meta.get(k, []):
                if v:
                    return v
        return ""

    page_kws: list[str] = []
    for k in ("citation_keywords", "dc.subject", "prism.keyword"):
        for v in meta.get(k, []):
            page_kws += re.split(r"\s*[;,]\s*", v)
    pdf_link = first("citation_pdf_url")
    if pdf_link:
        pdf_link = urljoin(r.url or url, pdf_link)

    doi_raw = first("citation_doi", "dc.identifier", "dc.identifier.doi", "prism.doi",
                    "bepress_citation_doi", "doi", "dc.relation.isversionof")
    dm = DOI_RE.search(doi_raw or "") or DOI_RE.search(p.canonical or "") or DOI_RE.search(r.url or "")
    if dm:
        try:
            m = from_doi(dm.group(1), email)
            m["keywords"] = merge_keywords(m["keywords"], page_kws)
            if pdf_link and not m["pdf_url"]:
                m["pdf_url"] = pdf_link
            return m
        except NetworkError:
            raise
        except MetadataError:
            pass  # fall back to the page's own meta tags

    scholarly_title = clean_text(first("citation_title", "dc.title"), "")
    loose_title = clean_text(first("og:title"), "") or clean_text(p.title, "")
    loose_title = re.split(r"\s+[|–—]\s+|\s+-\s+(?=[A-Z][\w .&]{2,40}$)", loose_title)[0].strip()

    if scholarly_title:
        m = empty_meta()
        m["title"] = scholarly_title
        authors = meta.get("citation_author", []) or meta.get("dc.creator", [])
        m["authors"] = [split_name(a) for a in authors if a.strip()]
        date = first("citation_publication_date", "citation_date", "citation_online_date",
                     "dc.date", "citation_year")
        ym = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", date)
        m["year"] = int(ym.group(1)) if ym else None
        m["journal"] = first("citation_journal_title", "citation_conference_title",
                             "citation_inbook_title", "citation_book_title")
        m["volume"], m["issue"] = first("citation_volume"), first("citation_issue")
        fp, lp = first("citation_firstpage"), first("citation_lastpage")
        m["pages"] = f"{fp}-{lp}" if fp and lp else fp
        m["publisher"] = first("citation_publisher", "dc.publisher")
        m["abstract"] = _clean_abstract(first("citation_abstract", "dc.description"))
        if first("citation_conference_title"):
            m["type"] = "conference"
        elif first("citation_inbook_title"):
            m["type"] = "chapter"
        elif first("citation_dissertation_institution"):
            m["type"] = "thesis"
        m["url"] = r.url or url
        m["pdf_url"] = pdf_link
        m["keywords"] = merge_keywords(page_kws)
        return m

    if not loose_title:
        if blocked:
            raise MetadataError(f"{_host(url)} blocked automatic access (HTTP {r.status_code}). "
                                "Paste the article's DOI or title instead - it's usually shown on the page.")
        raise MetadataError("Couldn't find article information on this page. Try the DOI or the title.")

    try:
        return search_crossref(loose_title, email, strict=True)
    except NetworkError:
        raise
    except MetadataError:
        if blocked:
            raise MetadataError(f"{_host(url)} blocked automatic access (HTTP {r.status_code}). "
                                "Paste the article's DOI or title instead.")
    m = empty_meta()
    m.update(title=loose_title, url=r.url or url, type="webpage", journal=first("og:site_name"))
    return m


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def _is_url(text: str) -> bool:
    return bool(re.match(r"^(https?://|www\.)", text, re.I))


def resolve(text: str, email: str = "") -> dict:
    """Main entry point: returns a metadata dict (see empty_meta)."""
    text = (text or "").strip().strip("<>\"'")
    if not text:
        raise MetadataError("Paste a link, DOI, arXiv ID or title first.")

    m = ARXIV_URL_RE.search(text) or ARXIV_OLD_RE.search(text) or ARXIV_BARE_RE.match(text)
    if m:
        return from_arxiv(m.group(1), email)
    m = OPENALEX_RE.match(text)
    if m:
        return from_openalex_id(m.group(1), email)
    m = PMID_URL_RE.search(text) or PMID_BARE_RE.match(text)
    if m:
        return from_pmid(m.group(1), email)
    m = DOI_RE.search(text)
    if m and (_is_url(text) or len(text) < 200 and text.lower().lstrip().startswith(("10.", "doi"))):
        return from_doi(m.group(1), email)
    if _is_url(text):
        return from_page(text, email)
    if m:  # a DOI buried inside a pasted reference string
        try:
            return from_doi(m.group(1), email)
        except NetworkError:
            raise
        except MetadataError:
            pass
    return search_crossref(text, email)
