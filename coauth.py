"""
coauth.py - find out whether a researcher is a CO-FIRST or CO-LAST author of a paper.

PubMed marks equal contributions only when the publisher sends that information, so for papers where
the researcher appears in a middle position PaperShelf also looks at the paper itself, in this order,
stopping at the first source that can be read:

  1. Europe PMC full text (JATS XML) of open-access papers: the author list carries the
     "equal-contrib" attribute or footnotes such as "These authors contributed equally".
  2. The legal open-access PDF (arXiv, bioRxiv/medRxiv, PubMed Central, repositories...): the
     first pages are read for an equal-contribution note and the symbol it uses (†, ‡, *, #...).
  3. The article page on the publisher's website (what anyone can see without logging in).

Only a contiguous block of equal contributors starting with the first author (co-first) or ending
with the last author (co-last) changes the role: a general "all authors contributed" note doesn't.
Nothing is downloaded behind a paywall and nothing is stored except the result.
"""
from __future__ import annotations

import io
import re
import time
import unicodedata
import xml.etree.ElementTree as ET

import metadata
from metadata import MetadataError, split_name

EQ_RE = re.compile(
    r"(contributed\s+equally|equal(?:ly)?\s+contribut\w*|equal\s+contribution|contributed\s+equal(?:ly)?|"
    r"joint(?:ly)?\s+first[\s-]+author\w*|co-?\s?first\s+author\w*|shared?\s+(?:the\s+)?first[\s-]+author\w*|"
    r"equal\s+first[\s-]+author\w*|first\s+authors?\s+contributed\s+equally|"
    r"joint(?:ly)?\s+(?:senior|last)[\s-]+author\w*|co-?\s?(?:senior|last)\s+author\w*|"
    r"shared?\s+(?:the\s+)?(?:senior|last)[\s-]+author\w*|equal\s+senior[\s-]+author\w*|"
    r"jointly\s+supervised|co-?supervised\s+(?:this|the)\s+(?:work|study))", re.I)
NOT_EQ_RE = re.compile(r"all\s+authors\s+contributed\s+equally|authors?\s+contributed\s+equally\s+to\s+(?:the\s+)?"
                       r"(?:writing|analysis|design|manuscript)", re.I)
SYMBOLS = "†‡§¶*#‖※⁎∗✝✻⁑♯☯⊥⁂"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
MAX_PDF = 20 * 1024 * 1024


def _low(s: str) -> str:
    return (s or "").lower()


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _fam(name: str) -> str:
    return split_name(name)["family"]


# --------------------------------------------------------------------------- JATS (Europe PMC)
def flags_from_jats(xml: bytes) -> tuple[list, list] | None:
    """(authors [{'last','fore'}], equal flags) from a JATS full text, or None if unreadable."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    front = root.find("front")
    front = root if front is None else front
    notes = {}
    for fn in front.iter("fn"):
        txt = " ".join("".join(fn.itertext()).split())
        notes[fn.get("id") or ""] = (fn.get("fn-type") or "", txt)
    authors, flags = [], []
    for c in front.iter("contrib"):
        if (c.get("contrib-type") or "author") != "author":
            continue
        last = c.findtext("name/surname") or c.findtext("collab") or ""
        fore = c.findtext("name/given-names") or ""
        if not last:
            continue
        eq = (c.get("equal-contrib") or "").lower() == "yes"
        for x in c.iter("xref"):
            for rid in (x.get("rid") or "").split():
                ftype, txt = notes.get(rid, ("", ""))
                if ftype == "equal" or (EQ_RE.search(txt) and not NOT_EQ_RE.search(txt)):
                    eq = True
        authors.append({"last": last, "fore": fore})
        flags.append(eq)
    return (authors, flags) if authors else None


# --------------------------------------------------------------------------- free text (PDF / web page)
def _initials(name: str) -> str:
    sp = split_name(name)
    given = re.findall(r"[A-Za-zÀ-ÿ]+", sp["given"])
    fam = re.findall(r"[A-Za-zÀ-ÿ]+", sp["family"])
    return _ascii("".join(g[0] for g in given) + "".join(f[0] for f in fam[-1:]))


def flags_from_text(text: str, authors: list[str]) -> list | None:
    """Equal-contribution flags for `authors` (names in order) from the text of a paper, or None."""
    if not text or not authors:
        return None
    text = unicodedata.normalize("NFC", text)
    low = _low(text)
    alow = _ascii(text) if len(_ascii(text)) == len(text) else None
    fams = [_low(_fam(a)) for a in authors]
    fams_a = [_ascii(_fam(a)) for a in authors]
    n = len(authors)
    flags = [False] * n
    found_any = False

    def name_pos(i, limit):
        """First position of author i's family name before `limit` (or -1)."""
        best = -1
        for f, hay in ((fams[i], low), (fams_a[i], alow)):
            if not f or len(f) < 2 or hay is None:
                continue
            m = re.search(r"(?<![a-z])" + re.escape(f) + r"(?![a-z])", hay[:limit])
            if m and (best < 0 or m.start() < best):
                best = m.start()
        return best

    for m in EQ_RE.finditer(text):
        ends = [x.end() for x in re.finditer(r"[a-z0-9)\]]{2}[.;]\s", text[max(0, m.start() - 300): m.start()])]
        s0 = max(m.start() - 300 + (ends[-1] if ends else 0), text.rfind("\n", 0, m.start()) + 1, 0)
        s1 = text.find(".", m.end())
        s1 = len(text) if s1 < 0 else min(s1, m.end() + 300)
        sentence = text[s0:s1]
        if NOT_EQ_RE.search(sentence):
            continue
        found_any = True
        sl, sa = _low(sentence), _ascii(sentence)
        # A. the names are written in the note ("These authors contributed equally: A. Rossi, P. Neri")
        hits = [i for i in range(n) if (fams[i] and len(fams[i]) > 2 and re.search(r"(?<![a-z])" + re.escape(fams[i]) + r"(?![a-z])", sl))
                or (fams_a[i] and len(fams_a[i]) > 2 and re.search(r"(?<![a-z])" + re.escape(fams_a[i]) + r"(?![a-z])", sa))]
        if len(hits) < 2:  # B. initials ("M.R. and P.N. contributed equally")
            toks = {re.sub(r"[^a-z]", "", t.lower()) for t in re.findall(r"(?<![A-Za-z])(?:[A-Z]\.?\s?-?){2,4}(?![a-z])", sentence)}
            toks.discard("")
            ini = [_initials(a) for a in authors]
            hits = [i for i in range(n) if ini[i] in toks and ini.count(ini[i]) == 1]
        if len(hits) >= 2:
            for i in hits:
                flags[i] = True
            continue
        # C. a symbol or a footnote number marks the authors ("† These authors…", "4These authors…")
        pre = text[max(0, s0 - 5): m.start()]
        syms = [ch for ch in pre if ch in SYMBOLS]
        digit = re.search(r"(\d{1,2})\s*(?:these|the|both|all)?\s*\w*\s*$", pre, re.I) if not syms else None
        if not syms and not digit:
            continue
        limit = max(s0 - 1, 1)
        pos = [name_pos(i, limit) for i in range(n)]
        marked = []
        for i in range(n):
            if pos[i] < 0:
                continue
            nxt = [p for p in pos if p > pos[i]]
            end = min([pos[i] + len(fams[i]) + 25] + nxt)
            seg = text[pos[i] + len(fams[i]): end]
            if "\n" in seg.strip(" ,"):  # stop at the end of the author line
                seg = seg[: seg.index("\n", len(seg) - len(seg.lstrip(" ,")))]
            if syms and syms[-1] in seg:
                marked.append(i)
            elif digit:
                marks = re.match(r"[\s,\d*†‡§¶#]*", seg).group(0)
                if digit.group(1) in re.findall(r"\d{1,2}", marks):
                    marked.append(i)
        if len(marked) >= 2:
            for i in marked:
                flags[i] = True
    if any(flags):
        return flags
    return [] if found_any else None


def role_from_flags(flags: list, idx: int) -> str:
    n = len(flags)
    if n < 2 or idx is None or idx <= 0 or idx >= n - 1 or not flags[idx]:
        return ""
    if all(flags[: idx + 1]):
        return "co-first"
    if all(flags[idx:]):
        return "co-last"
    return ""


# --------------------------------------------------------------------------- sources
def _pmcid(w: dict) -> str:
    p = (w.get("pmcid") or "").upper()
    if p:
        return p if p.startswith("PMC") else "PMC" + p
    doi = w.get("doi")
    if not doi:
        return ""
    r = metadata.http_get(f"{EPMC}/search", params={"query": f'DOI:"{doi}"', "format": "json", "resultType": "lite"})
    if r.status_code != 200:
        return ""
    for res in (r.json().get("resultList") or {}).get("result") or []:
        if res.get("pmcid"):
            return res["pmcid"]
    return ""


def _jats(pmcid: str):
    r = metadata.http_get(f"{EPMC}/{pmcid}/fullTextXML", accept="application/xml", timeout=40)
    return r.content if r.status_code == 200 and r.content.lstrip().startswith(b"<") else None


def _pdf_text(url: str) -> str:
    import requests
    try:
        r = requests.get(url, headers=metadata.BROWSER_HEADERS, timeout=40, stream=True, allow_redirects=True)
    except requests.exceptions.RequestException:
        return ""
    with r:
        if r.status_code != 200:
            return ""
        data = b""
        for ch in r.iter_content(65536):
            data += ch
            if len(data) > MAX_PDF:
                return ""
    if b"%PDF-" not in data[:1024]:
        return ""
    try:
        from pypdf import PdfReader
        rd = PdfReader(io.BytesIO(data))
        return "\n".join((rd.pages[i].extract_text() or "") for i in range(min(2, len(rd.pages))))
    except Exception:  # noqa: BLE001 - unreadable PDF
        return ""


def _html_text(url: str) -> str:
    r = metadata.http_get(url, browser=True, timeout=30)
    if r.status_code != 200 or "html" not in (r.headers.get("content-type") or "html"):
        return ""
    html = r.text
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d)>", "\n", html)
    text = re.sub(r"<[^>]+>", " ", html)
    import html as _h
    return re.sub(r"[ \t\r\f\v]+", " ", _h.unescape(text))


def _pdf_urls(w: dict) -> list[str]:
    urls = []
    doi = (w.get("doi") or "").lower()
    if w.get("oa_url") and (".pdf" in w["oa_url"].lower() or "arxiv.org" in w["oa_url"]):
        urls.append(w["oa_url"].replace("/abs/", "/pdf/"))
    if doi.startswith("10.1101/"):
        urls.append(f"https://www.biorxiv.org/content/{doi}.full.pdf")
    if doi and len(urls) < 2:
        try:
            ow = metadata.openalex_lookup(doi)
            if ow:
                urls += [u for u in metadata.openalex_pdf_urls(ow) if u not in urls]
        except (MetadataError, ValueError):
            pass
    return urls[:3]


def check(w: dict, idx: int, pause: float = 0.3) -> dict:
    """Look for equal-contribution notes for one work. Returns
    {'role': 'co-first'|'co-last'|'', 'source': ..., 'note': ...}; role '' means not found."""
    authors = [a for a in (w.get("authors") or []) if a and a not in ("…", "...")]
    out = {"role": "", "source": "", "note": ""}
    if not authors or idx is None:
        return out
    tried = []
    # 1. Europe PMC full text
    try:
        pmcid = _pmcid(w)
        if pmcid:
            xml = _jats(pmcid)
            if xml:
                tried.append("Europe PMC")
                res = flags_from_jats(xml)
                if res:
                    j_auth, flags = res
                    names = [f"{a['fore']} {a['last']}".strip() for a in j_auth]
                    jidx = _match_index(names, authors[idx], idx, len(authors))
                    role = role_from_flags(flags, jidx)
                    out.update(source="Europe PMC full text", note="equal contribution in the author list" if any(flags) else "no equal-contribution note")
                    if role or any(flags):
                        out["role"] = role
                        return out
                    return out  # full author information read: no equal contribution
    except (MetadataError, ValueError):
        pass
    time.sleep(pause)
    # 2. open-access PDF
    for url in _pdf_urls(w):
        text = _pdf_text(url)
        if not text:
            continue
        tried.append("PDF")
        flags = flags_from_text(text, authors)
        if flags:
            out.update(role=role_from_flags(flags, idx), source="open-access PDF", note="equal-contribution note in the PDF")
            return out
        if flags == []:
            out.update(source="open-access PDF", note="an equal-contribution note was found but its authors couldn't be identified")
        break
    time.sleep(pause)
    # 3. publisher page
    if w.get("doi"):
        try:
            text = _html_text(f"https://doi.org/{w['doi']}")
        except MetadataError:
            text = ""
        if text:
            tried.append("publisher page")
            flags = flags_from_text(text, authors)
            if flags:
                out.update(role=role_from_flags(flags, idx), source="publisher page", note="equal-contribution note on the article page")
                return out
    if not out["source"]:
        out["source"] = ", ".join(tried) if tried else "nothing readable (paywalled?)"
        out["note"] = "no equal-contribution note found" if tried else "the paper's text couldn't be read freely"
    return out


def _match_index(names: list[str], researcher_name: str, hint: int, n_ref: int):
    """Index of the researcher in another version of the author list (by family name, else same position)."""
    fam = _ascii(_fam(researcher_name))
    hits = [i for i, nm in enumerate(names) if _ascii(_fam(nm)) == fam]
    if len(hits) == 1:
        return hits[0]
    if hits:
        return min(hits, key=lambda i: abs(i - hint))
    return hint if len(names) == n_ref else None
