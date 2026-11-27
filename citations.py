"""
citations.py - reference styles and file exports.

Styles: APA 7, Nature, Science, Cell Press, Royal Society (Proc B), J Neurosci,
eLife, PNAS, PLOS/Vancouver. Each style turns a paper into a list of
(text, format) segments, where format is "", "i" (italic), "b" (bold) or "bi";
the same segments are rendered as plain text, HTML or RTF.

Exports: formatted reference lists (.txt / .rtf / .html), BibTeX, RIS,
CSL-JSON (best for importing into Zotero) and CSV.
"""
from __future__ import annotations

import csv
import html
import io
import json
import re
import unicodedata
from pathlib import Path


# --------------------------------------------------------------------------- #
# Name helpers
# --------------------------------------------------------------------------- #
def initials(given: str, sep: str = " ", dot: bool = True) -> str:
    """initials('Jean-Paul Marie') -> 'J.-P. M.'; sep='' -> 'J.-P.M.'; dot=False -> 'JPM'."""
    given = (given or "").replace(".", ". ").strip()
    out = []
    for part in given.split():
        pieces = [h for h in part.split("-") if h]
        if not pieces:
            continue
        out.append("-".join(h[0].upper() + "." for h in pieces) if dot else "".join(h[0].upper() for h in pieces))
    return (sep if dot else "").join(out)


def _authors(p):
    return [a for a in (p.get("authors") or []) if (a.get("family") or "").strip()]


def fam_ini(a):          # Harris, C. R.
    ini = initials(a.get("given", ""))
    return f"{a['family'].strip()}, {ini}" if ini else a["family"].strip()


def fam_ini_compact(a):  # Harris, C.R.
    ini = initials(a.get("given", ""), sep="")
    return f"{a['family'].strip()}, {ini}" if ini else a["family"].strip()


def fam_nlm(a):          # Harris CR
    ini = initials(a.get("given", ""), dot=False)
    return f"{a['family'].strip()} {ini}".strip()


def ini_fam(a):          # C. R. Harris
    ini = initials(a.get("given", ""))
    return f"{ini} {a['family'].strip()}".strip()


apa_author = fam_ini  # kept for CSV export


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _end(s: str) -> str:
    s = (s or "").strip()
    return s if not s or s[-1] in ".?!" else s + "."


def _nlm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace(".", "")).strip()


class _Ctx:
    def __init__(self, p):
        self.title = " ".join((p.get("title") or "Untitled").split())
        self.year = str(p.get("year") or "")
        self.typ = p.get("type") or "article"
        self.journal = (p.get("journal") or "").strip()
        self.abbr = (p.get("journal_abbr") or "").strip() or self.journal
        self.vol = str(p.get("volume") or "").strip()
        self.iss = str(p.get("issue") or "").strip()
        self.pages = re.sub(r"\s*-+\s*", "–", str(p.get("pages") or "").strip())
        self.doi = (p.get("doi") or "").strip()
        self.url = (p.get("url") or "").strip()
        self.link = f"https://doi.org/{self.doi}" if self.doi else self.url
        self.arxiv = (p.get("arxiv_id") or "").strip()
        self.publisher = (p.get("publisher") or "").strip()
        self.article = self.typ == "article" and bool(self.journal)
        self.preprint = self.typ == "preprint"
        self.contained = self.typ in ("conference", "chapter") and bool(self.journal)
        self.source = self.journal or self.publisher  # e.g. arXiv / bioRxiv for preprints


class _Out:
    def __init__(self):
        self.segs: list[tuple[str, str]] = []

    def __call__(self, text, fmt=""):
        if text:
            self.segs.append((str(text), fmt))
        return self


# --------------------------------------------------------------------------- #
# Styles
# --------------------------------------------------------------------------- #
def style_apa(p):
    c, o = _Ctx(p), _Out()
    names = [fam_ini(a) for a in _authors(p)]
    if len(names) == 1:
        auth = names[0]
    elif 1 < len(names) <= 20:
        auth = ", ".join(names[:-1]) + ", & " + names[-1]
    elif names:
        auth = ", ".join(names[:19]) + ", . . . " + names[-1]
    else:
        auth = ""
    year = f"({c.year})" if c.year else "(n.d.)"
    italic_title = not (c.article or c.contained)

    def title():
        if c.preprint and c.arxiv:
            o(c.title, "i")(f" (arXiv:{c.arxiv}).")
        else:
            o(_end(c.title), "i" if italic_title else "")

    if auth:
        o(auth if auth.endswith(".") else auth + ".")(f" {year}. ")
        title()
    else:
        title()
        o(f" {year}.")
    if c.article:
        o(" ")(c.journal, "i")
        if c.vol:
            o(", ")(c.vol, "i")
        if c.iss:
            o(f"({c.iss})")
        if c.pages:
            o(f", {c.pages}")
        o(".")
    elif c.contained:
        o(" In ")(c.journal, "i")
        if c.pages:
            o(f" (pp. {c.pages})")
        o(".")
        if c.publisher and c.publisher.lower() not in c.journal.lower():
            o(" " + _end(c.publisher))
    elif c.preprint:
        if c.source:
            o(" " + _end(c.source))
    else:
        src = c.publisher or c.journal
        if src and src.lower() not in c.title.lower():
            o(" " + _end(src))
    if c.link:
        o(" " + c.link)
    return o.segs


def style_nature(p):
    c, o = _Ctx(p), _Out()
    names = [fam_ini(a) for a in _authors(p)]
    if len(names) > 5:
        auth = names[0] + " et al."
    elif len(names) > 1:
        auth = ", ".join(names[:-1]) + " & " + names[-1]
    else:
        auth = names[0] if names else ""
    if auth:
        o(_end(auth) + " ")
    if c.article:
        o(_end(c.title) + " ")(c.abbr, "i")
        if c.vol:
            o(" ")(c.vol, "b")
        if c.pages:
            o(f", {c.pages}")
        o(f" ({c.year})." if c.year else ".")
    elif c.preprint:
        o(_end(c.title) + f" Preprint at {c.link}" + (f" ({c.year})." if c.year else "."))
    elif c.contained:
        o(_end(c.title) + " in ")(c.journal, "i")
        if c.pages:
            o(f" {c.pages}")
        paren = ", ".join(x for x in (c.publisher, c.year) if x)
        o(f" ({paren})." if paren else ".")
    else:
        o(c.title, "i")
        paren = ", ".join(x for x in (c.publisher, c.year) if x)
        o(f" ({paren})." if paren else ".")
    return o.segs


def _science_like(p, max_authors):
    c, o = _Ctx(p), _Out()
    names = [ini_fam(a) for a in _authors(p)]
    auth = (names[0] + " et al.") if len(names) > max_authors else ", ".join(names)
    if auth:
        o(auth + ", ")
    if c.article:
        o(_end(c.title) + " ")(c.abbr, "i")
        if c.vol:
            o(" ")(c.vol, "b")
        if c.pages:
            o(f", {c.pages}")
        o(f" ({c.year})." if c.year else ".")
    elif c.preprint:
        o(_end(c.title) + " ")(c.source or "Preprint", "i")
        o(" [Preprint]" + (f" ({c.year})." if c.year else ".") + (f" {c.link}." if c.link else ""))
    elif c.contained:
        o(c.title + ", in ")(c.journal, "i")
        o(f" ({', '.join(x for x in (c.publisher, c.year) if x)})" if (c.publisher or c.year) else "")
        o(f", pp. {c.pages}." if c.pages else ".")
    else:
        o(c.title, "i")
        paren = ", ".join(x for x in (c.publisher, c.year) if x)
        o(f" ({paren})." if paren else ".")
    return o.segs


def style_science(p):
    return _science_like(p, 10)


def style_pnas(p):
    return _science_like(p, 5)


def style_cell(p):
    c, o = _Ctx(p), _Out()
    names = [fam_ini_compact(a) for a in _authors(p)]
    if len(names) > 10:
        auth = ", ".join(names[:10]) + ", et al."
    elif len(names) > 1:
        auth = ", ".join(names[:-1]) + ", and " + names[-1]
    else:
        auth = names[0] if names else ""
    if auth:
        o(auth + " ")
    o(f"({c.year}). " if c.year else "")
    if c.article:
        o(_end(c.title) + " " + c.abbr)
        if c.vol:
            o(" ")(c.vol, "i")
        if c.pages:
            o(f", {c.pages}")
        o(".")
    elif c.preprint:
        o(_end(c.title) + f" Preprint at {c.source or 'a preprint server'}.")
    elif c.contained:
        o(_end(c.title) + " In ")(c.journal, "i")
        if c.publisher:
            o(f" ({c.publisher})")
        o(f", pp. {c.pages}." if c.pages else ".")
    else:
        o(c.title, "i")(f" ({c.publisher})." if c.publisher else ".")
    if c.link:
        o(f" {c.link}.")
    return o.segs


def style_royalsociety(p):
    c, o = _Ctx(p), _Out()
    names = [fam_nlm(a) for a in _authors(p)]
    auth = (names[0] + " et al") if len(names) > 10 else ", ".join(names)
    if auth:
        o(auth + ". ")
    o(f"{c.year} " if c.year else "")
    if c.article:
        o(_end(c.title) + " ")(c.abbr, "i")
        if c.vol:
            o(" ")(c.vol, "b")
        o(f", {c.pages}." if c.pages else ".")
    elif c.preprint:
        o(_end(c.title) + " ")(c.source or "Preprint", "i")(".")
    elif c.contained:
        o(_end(c.title) + " In ")(c.journal, "i")
        o(f", pp. {c.pages}." if c.pages else ".")
        if c.publisher:
            o(" " + _end(c.publisher))
    else:
        o(_end(c.title), "i")
        if c.publisher:
            o(" " + _end(c.publisher))
    if c.doi:
        o(f" (doi:{c.doi})")
    elif c.url:
        o(f" ({c.url})")
    return o.segs


def style_jneurosci(p):
    c, o = _Ctx(p), _Out()
    names = [fam_nlm(a) for a in _authors(p)]
    if names:
        o(", ".join(names) + " ")
    o(f"({c.year}) " if c.year else "")
    if c.article:
        o(_end(c.title) + " " + _nlm(c.abbr))
        if c.vol and c.pages:
            o(f" {c.vol}:{c.pages}.")
        elif c.vol:
            o(f" {c.vol}.")
        else:
            o(".")
    elif c.preprint:
        o(_end(c.title) + f" {c.source or 'Preprint'}" + (f" {c.arxiv}" if c.arxiv else "") + ".")
        if c.doi:
            o(f" doi: {c.doi}.")
    elif c.contained:
        o(_end(c.title) + f" In: {c.journal}")
        o(f", pp {c.pages}." if c.pages else ".")
        if c.publisher:
            o(" " + _end(c.publisher))
    else:
        o(_end(c.title))
        if c.publisher:
            o(" " + _end(c.publisher))
    return o.segs


def style_elife(p):
    c, o = _Ctx(p), _Out()
    names = [fam_nlm(a) for a in _authors(p)]
    if names:
        o(", ".join(names) + ". ")
    o(f"{c.year}. " if c.year else "")
    if c.article:
        o(_end(c.title) + " ")(c.journal, "i")
        if c.vol:
            o(" ")(c.vol, "b")
        o(f":{c.pages}." if c.pages else ".")
    elif c.preprint:
        o(_end(c.title) + " ")(c.source or "Preprint", "i")(".")
    elif c.contained:
        o(_end(c.title) + " In: ")(c.journal, "i")
        o(f". {_end(c.publisher)}" if c.publisher else ".")
        o(f" p. {c.pages}." if c.pages else "")
    else:
        o(_end(c.title), "i")
        if c.publisher:
            o(" " + _end(c.publisher))
    if c.doi:
        o(f" DOI: https://doi.org/{c.doi}")
    elif c.url:
        o(f" {c.url}")
    return o.segs


def style_vancouver(p):
    c, o = _Ctx(p), _Out()
    names = [fam_nlm(a) for a in _authors(p)]
    auth = ", ".join(names[:6]) + ", et al" if len(names) > 6 else ", ".join(names)
    if auth:
        o(auth + ". ")
    if c.article:
        o(_end(c.title) + " " + _end(_nlm(c.abbr)) + " ")
        o(f"{c.year}" if c.year else "")
        if c.vol:
            o(f";{c.vol}")
        if c.iss:
            o(f"({c.iss})")
        if c.pages:
            o(f":{c.pages}")
        o(".")
    elif c.preprint:
        o(f"{c.title} [Preprint]. {c.source or 'Preprint server'}" + (f"; {c.year}." if c.year else "."))
    elif c.contained:
        o(_end(c.title) + f" In: {_end(c.journal)}")
        o(f" {c.publisher};" if c.publisher else "")
        o(f" {c.year}." if c.year else "")
        o(f" p. {c.pages}." if c.pages else "")
    else:
        o(_end(c.title))
        o(f" {c.publisher};" if c.publisher else "")
        o(f" {c.year}." if c.year else "")
    if c.doi:
        o(f" doi:{c.doi}")
    elif c.url:
        o(f" Available from: {c.url}")
    return o.segs


STYLES = {
    "apa": {"name": "APA 7th edition", "journals": "Psychology journals and many others", "fn": style_apa, "numbered": False},
    "nature": {"name": "Nature", "journals": "Nature, Nature Neuroscience, Nature Communications, Scientific Reports",
               "fn": style_nature, "numbered": True},
    "science": {"name": "Science", "journals": "Science, Science Advances", "fn": style_science, "numbered": True},
    "cell": {"name": "Cell Press", "journals": "Cell, Neuron, Current Biology, Cell Reports, iScience",
             "fn": style_cell, "numbered": True},
    "royalsociety": {"name": "Royal Society", "journals": "Proceedings B, Biology Letters, Phil Trans B",
                     "fn": style_royalsociety, "numbered": True},
    "jneurosci": {"name": "Journal of Neuroscience", "journals": "J Neurosci, eNeuro", "fn": style_jneurosci,
                  "numbered": False},
    "elife": {"name": "eLife", "journals": "eLife", "fn": style_elife, "numbered": False},
    "pnas": {"name": "PNAS", "journals": "PNAS, PNAS Nexus", "fn": style_pnas, "numbered": True},
    "vancouver": {"name": "PLOS / Vancouver", "journals": "PLOS Biology, PLOS Comp Biol, PLOS ONE, medical journals",
                  "fn": style_vancouver, "numbered": True},
}


# --------------------------------------------------------------------------- #
# Journal -> reference style (built in, works offline)
# --------------------------------------------------------------------------- #
# The style a journal asks for, by the start of its name. Journals that are not listed are not guessed: the person picks.
_JOURNAL_RULES = [
    ("nature", r"^(nature\b|nature$|scientific (reports|data)\b|communications (biology|chemistry|physics|earth|medicine|psychology|materials)\b|npj\b)"),
    ("science", r"^science($| advances| translational| signaling| immunology| robotics)"),
    ("cell", r"^(cell($| reports| systems| stem cell| metabolism| host| chemical biology| genomics)|neuron$|current biology|iscience|molecular cell|developmental cell|immunity$|cancer cell|structure$|trends in\b|chem$|joule$|heliyon|patterns$)"),
    ("pnas", r"^(proceedings of the national academy|pnas)"),
    ("royalsociety", r"^(proceedings of the royal society|proc\.? (r\.? )?soc|biology letters|philosophical transactions|journal of the royal society|royal society open science|open biology|interface focus)"),
    ("jneurosci", r"^(the )?(journal of neuroscience$|j\.? ?neurosci\.?$|eneuro)"),
    ("elife", r"^elife"),
    ("vancouver", r"^(plos\b|bmj\b|the lancet|lancet\b|new england journal|jama\b|journal of the american medical|bmc\b|nucleic acids research|annals of\b|blood$|cancer research|the journal of biological chemistry|journal of biological chemistry)"),
    ("apa", r"^(psychological|journal of experimental psychology|american psychologist|developmental psychology|journal of personality|cognition$|cognitive|behavioral and brain|journal of abnormal|journal of applied psychology|emotion$|neuropsychology|journal of educational psychology|perspectives on psychological|memory and cognition|quarterly journal of experimental psychology|frontiers in\b)"),
]
# a few names to complete while typing (the rules above decide the style of anything else)
JOURNAL_HINTS = [
    "Nature", "Nature Neuroscience", "Nature Communications", "Nature Methods", "Nature Ecology & Evolution", "Nature Human Behaviour", "Scientific Reports",
    "Science", "Science Advances", "Cell", "Neuron", "Current Biology", "Cell Reports", "iScience", "Molecular Cell", "Developmental Cell", "Trends in Cognitive Sciences", "Trends in Ecology & Evolution",
    "Proceedings of the National Academy of Sciences", "PNAS Nexus", "Proceedings of the Royal Society B", "Biology Letters", "Philosophical Transactions of the Royal Society B",
    "Journal of the Royal Society Interface", "Royal Society Open Science", "The Journal of Neuroscience", "eNeuro", "eLife",
    "PLOS Biology", "PLOS ONE", "PLOS Computational Biology", "PLOS Genetics", "BMC Biology", "Frontiers in Neuroscience", "Frontiers in Psychology", "Frontiers in Behavioral Neuroscience",
    "Nucleic Acids Research", "The Lancet", "New England Journal of Medicine", "JAMA", "BMJ", "Journal of Biological Chemistry",
    "Psychological Science", "Psychological Review", "Psychological Bulletin", "Journal of Experimental Psychology: General", "Cognition",
]


def style_for_journal(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "").strip().lower().replace("&", "and"))
    for sid, rx in _JOURNAL_RULES:
        if re.search(rx, n):
            return sid
    return ""


def journal_suggestions(q: str, limit: int = 8) -> list:
    """Journals (from a short built-in list) whose name starts with or contains the typed text; plus what the typed text itself maps to."""
    q = re.sub(r"\s+", " ", (q or "").strip())
    if not q:
        return []
    ql = q.lower()
    out, seen = [], set()
    own = style_for_journal(q)
    if own:
        out.append({"journal": q, "style": own, "name": STYLES[own]["name"], "typed": True})
        seen.add(ql)
    for j in sorted(JOURNAL_HINTS, key=lambda x: (not x.lower().startswith(ql), x.lower())):
        if ql in j.lower() and j.lower() not in seen:
            sid = style_for_journal(j)
            if sid:
                out.append({"journal": j, "style": sid, "name": STYLES[sid]["name"]})
                seen.add(j.lower())
        if len(out) >= limit:
            break
    return out


def paper_of_meta(meta: dict) -> dict:
    """The shape the style functions want, from the few details a group keeps of a paper."""
    m = dict(meta or {})
    au = [a if isinstance(a, dict) else {"family": str(a), "given": ""} for a in (m.get("authors") or [])]
    base = {"title": "", "year": None, "journal": "", "journal_abbr": "", "volume": "", "issue": "", "pages": "", "publisher": "", "type": "article", "doi": "", "url": "", "arxiv_id": ""}
    base.update({k: v for k, v in m.items() if v is not None})
    base["authors"] = au
    return base


# --------------------------------------------------------------------------- #
# Completeness check of a reference, for the style of the document
# --------------------------------------------------------------------------- #
FILLABLE = ("year", "title", "journal", "volume", "issue", "pages", "publisher", "doi")
_FIELD_LABEL = {"year": "Year", "title": "Title", "journal": "Journal", "volume": "Volume number", "issue": "Issue number",
                "pages": "Pages or article number", "publisher": "Publisher", "doi": "DOI"}


def check_meta(meta: dict, style: str) -> list:
    """What a journal's copy-editor would query in this reference: [{f, msg, sev}] with sev 'miss' (needed by the style) or 'hint'."""
    m = meta or {}
    out = []

    def add(f, msg=None, sev="miss"):
        out.append({"f": f, "msg": msg or f"{_FIELD_LABEL.get(f, f)} missing", "sev": sev})
    au = [a for a in (m.get("authors") or []) if (a.get("family") if isinstance(a, dict) else a)]
    if not au:
        add("authors", "No author")
    else:
        short = [a["family"] for a in au if isinstance(a, dict) and not (a.get("given") or "").strip() and len(a["family"].split()) <= 2]
        if short:
            add("initials", "First name or initials missing for " + ", ".join(short[:3]) + (" …" if len(short) > 3 else "") + " (edit the authors in your library)")
    if not m.get("year"):
        add("year")
    if not (m.get("title") or "").strip():
        add("title")
    t = m.get("type") or "article"
    if t in ("article", "chapter", "preprint", "conference", "proceedings") or not t:
        if not (m.get("journal") or "").strip():
            add("journal", "Journal name missing" if t == "article" else "Journal, book or server name missing")
    if t == "article":
        if not str(m.get("volume") or "").strip():
            add("volume")
        if not str(m.get("pages") or "").strip():
            add("pages")
        if style in ("apa", "vancouver") and not str(m.get("issue") or "").strip():
            add("issue", "Issue number missing (some journals leave it out)", "hint")
    if t in ("book", "chapter", "report", "thesis") and not (m.get("publisher") or "").strip():
        add("publisher")
    if t == "chapter" and not str(m.get("pages") or "").strip():
        add("pages")
    if t == "preprint" and not (m.get("doi") or m.get("arxiv_id") or m.get("url")):
        add("doi", "No DOI, arXiv number or link")
    elif style in ("apa", "elife", "royalsociety", "pnas") and t in ("article", "chapter") and not m.get("doi"):
        add("doi", "DOI missing (this style prints it)", "hint")
    return out


# how a numbered style cites inside the text
INLINE_BRACKETS = {"nature": ("[", "]"), "science": ("(", ")"), "cell": ("[", "]"), "royalsociety": ("[", "]"), "pnas": ("[", "]"), "vancouver": ("(", ")")}


def style_list():
    return [{"id": k, "name": v["name"], "journals": v["journals"], "numbered": v["numbered"]} for k, v in STYLES.items()]


def segments(p, style="apa"):
    return STYLES.get(style, STYLES["apa"])["fn"](p)


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def _tidy(s: str) -> str:
    s = re.sub(r"(?<![.\s])\.\.(?!\.)", ".", s)
    s = re.sub(r"\.(</[ib]>)\.", r".\1", s)
    s = re.sub(r",\s*,", ",", s)
    return re.sub(r"[ \t]{2,}", " ", s).strip()


def cite_text(p, style="apa") -> str:
    return _tidy("".join(t for t, _ in segments(p, style)))


def _html_seg(t, f):
    t = html.escape(t)
    if "b" in f:
        t = f"<b>{t}</b>"
    if "i" in f:
        t = f"<i>{t}</i>"
    return t


def cite_html(p, style="apa") -> str:
    return _tidy("".join(_html_seg(t, f) for t, f in segments(p, style)))


# Backwards-compatible names
def apa_text(p):
    return cite_text(p, "apa")


def apa_html(p):
    return cite_html(p, "apa")


def _sort_key(p):
    authors = _authors(p)
    lead = authors[0]["family"] if authors else (p.get("title") or "")
    lead = unicodedata.normalize("NFKD", lead).encode("ascii", "ignore").decode().lower()
    return (lead, p.get("year") or 0, (p.get("title") or "").lower())


def sort_references(papers):
    return sorted(papers, key=_sort_key)


def _ordered(papers, style, order):
    return list(papers) if order == "list" else sort_references(papers)


def _prefix(style, i):
    return f"{i}. " if STYLES.get(style, STYLES["apa"])["numbered"] else ""


def list_text(papers, style="apa", order="alpha") -> str:
    refs = _ordered(papers, style, order)
    return "\n\n".join(_prefix(style, i) + cite_text(p, style) for i, p in enumerate(refs, 1)) + "\n"


def list_html(papers, style="apa", order="alpha", title="References") -> str:
    refs = _ordered(papers, style, order)
    items = "\n".join(f"<p>{html.escape(_prefix(style, i))}{cite_html(p, style)}</p>" for i, p in enumerate(refs, 1))
    return ("<!doctype html><html><head><meta charset='utf-8'><title>References</title><style>"
            "body{font:12pt/2 'Times New Roman',serif;max-width:46em;margin:3em auto}"
            "p{padding-left:2em;text-indent:-2em;margin:0}</style></head><body>"
            f"<h3 style='text-align:center'>{html.escape(title)}</h3>\n{items}\n</body></html>")


def _rtf_escape(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if ch in "\\{}":
            out.append("\\" + ch)
        elif ch == "\n":
            out.append("\\line ")
        elif o < 128:
            out.append(ch)
        elif o > 0xFFFF:
            o -= 0x10000
            for unit in (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)):
                out.append(f"\\u{unit - 65536}?")
        else:
            out.append(f"\\u{o if o < 32768 else o - 65536}?")
    return "".join(out)


def list_rtf(papers, style="apa", order="alpha", heading="References") -> str:
    """Word/Pages-ready: Times 12pt, double spacing, hanging indent, italics/bold."""
    lines = [r"{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Times New Roman;}}\f0\fs24",
             r"{\pard\qc\sl480\slmult1\b " + _rtf_escape(heading) + r"\b0\par}"]
    for i, p in enumerate(_ordered(papers, style, order), 1):
        segs = [_rtf_escape(_prefix(style, i))]
        for text, f in segments(p, style):
            t = _rtf_escape(text)
            if "b" in f:
                t = "{\\b " + t + "}"
            if "i" in f:
                t = "{\\i " + t + "}"
            segs.append(t)
        lines.append(r"{\pard\ql\sl480\slmult1\li720\fi-720 " + _tidy("".join(segs)) + r"\par}")
    lines.append("}")
    return "\n".join(lines)


# Old function names used by earlier versions
def apa_list_text(papers):
    return list_text(papers, "apa")


def apa_list_rtf(papers, heading="References"):
    return list_rtf(papers, "apa", heading=heading)


# --------------------------------------------------------------------------- #
# BibTeX
# --------------------------------------------------------------------------- #
_BIB_TYPES = {"article": "article", "conference": "inproceedings", "chapter": "incollection",
              "book": "book", "thesis": "phdthesis", "report": "techreport"}
_STOP = {"a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "from", "towards", "toward"}


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def _bib_escape(s) -> str:
    return re.sub(r"([&%$#_])", r"\\\1", " ".join(str(s or "").split()))


def bibtex_entry(p, used: set, tags=None) -> str:
    authors = _authors(p)
    fam = re.sub(r"[^A-Za-z0-9]", "", _ascii(authors[0]["family"])) if authors else "anon"
    words = [w for w in re.findall(r"[A-Za-z0-9]+", _ascii(p.get("title") or "")) if w.lower() not in _STOP]
    base = f"{fam.lower() or 'anon'}{p.get('year') or ''}{words[0].lower() if words else ''}"
    key, n = base, 0
    while key in used:
        n += 1
        key = (base + chr(ord("a") + n - 1)) if n <= 26 else f"{base}{n}"
    used.add(key)

    typ = p.get("type") or "article"
    btype = _BIB_TYPES.get(typ, "misc")
    if typ == "article" and not p.get("journal"):
        btype = "misc"
    fields = []

    def f(name, value, raw=False):
        if value:
            fields.append(f"  {name} = {{{value if raw else _bib_escape(value)}}}")

    f("author", " and ".join(
        (f"{a['family']}, {a.get('given', '')}" if a.get("given") else f"{{{a['family']}}}") for a in authors))
    f("title", "{" + _bib_escape(p.get("title")) + "}", raw=True)
    container = p.get("journal") or ""
    if btype == "article":
        f("journal", container)
        f("shortjournal", p.get("journal_abbr") if p.get("journal_abbr") != container else "")
    elif btype in ("inproceedings", "incollection"):
        f("booktitle", container)
    elif typ == "preprint" and container:
        f("howpublished", container)
    f("year", p.get("year"))
    f("volume", p.get("volume"))
    f("number", p.get("issue"))
    f("pages", re.sub(r"\s*[-–]+\s*", "--", str(p.get("pages") or "")), raw=True)
    f("publisher", p.get("publisher") if btype != "article" else "")
    if p.get("arxiv_id"):
        f("eprint", p["arxiv_id"], raw=True)
        f("archivePrefix", "arXiv", raw=True)
    f("doi", p.get("doi"), raw=True)
    f("url", p.get("url"), raw=True)
    f("keywords", ", ".join(list(p.get("keywords") or []) + list(tags or [])))
    f("abstract", p.get("abstract"))
    if p.get("pdf_path"):
        f("file", p["pdf_path"], raw=True)
    return f"@{btype}{{{key},\n" + ",\n".join(fields) + "\n}"


def bibtex(papers, tags_for=None) -> str:
    used: set = set()
    tags_for = tags_for or (lambda p: [])
    return "\n\n".join(bibtex_entry(p, used, tags_for(p)) for p in sort_references(papers)) + "\n"


# --------------------------------------------------------------------------- #
# RIS (Zotero, EndNote, Mendeley) - groups become tags, PDFs become linked files
# --------------------------------------------------------------------------- #
_RIS_TYPES = {"article": "JOUR", "preprint": "JOUR", "conference": "CPAPER", "chapter": "CHAP", "book": "BOOK",
              "thesis": "THES", "report": "RPRT", "dataset": "DATA", "webpage": "ELEC", "other": "GEN"}


def ris(papers, tags_for=None) -> str:
    tags_for = tags_for or (lambda p: [])
    out = []
    for p in papers:
        lines = [f"TY  - {_RIS_TYPES.get(p.get('type') or 'article', 'GEN')}"]

        def add(tag, value):
            value = " ".join(str(value or "").split())
            if value:
                lines.append(f"{tag}  - {value}")

        for a in _authors(p):
            add("AU", f"{a['family']}, {a.get('given', '')}".rstrip(", "))
        add("TI", p.get("title"))
        add("T2", p.get("journal"))
        add("J2", p.get("journal_abbr"))
        add("PY", p.get("year"))
        add("VL", p.get("volume"))
        add("IS", p.get("issue"))
        pages = re.split(r"\s*[-–]+\s*", str(p.get("pages") or ""), maxsplit=1)
        add("SP", pages[0])
        if len(pages) > 1:
            add("EP", pages[1])
        add("PB", p.get("publisher"))
        add("DO", p.get("doi"))
        add("UR", p.get("url"))
        add("AB", p.get("abstract"))
        for k in list(p.get("keywords") or []) + list(tags_for(p)):
            add("KW", k)
        add("N1", p.get("notes"))
        if p.get("pdf_path"):
            add("L1", Path(p["pdf_path"]).as_uri() if Path(p["pdf_path"]).is_absolute() else p["pdf_path"])
        lines.append("ER  - ")
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"


# --------------------------------------------------------------------------- #
# CSL-JSON (Zotero: File > Import...)
# --------------------------------------------------------------------------- #
_CSL_TYPES = {"article": "article-journal", "preprint": "article", "conference": "paper-conference",
              "chapter": "chapter", "book": "book", "thesis": "thesis", "report": "report",
              "dataset": "dataset", "webpage": "webpage", "other": "document"}


def csl_json(papers) -> str:
    items = []
    for p in papers:
        it = {"id": p.get("uid") or str(p.get("id")), "type": _CSL_TYPES.get(p.get("type") or "article", "document"),
              "title": p.get("title") or ""}
        if _authors(p):
            it["author"] = [{"family": a["family"], "given": a.get("given", "")} for a in _authors(p)]
        if p.get("year"):
            it["issued"] = {"date-parts": [[int(p["year"])]]}
        for key, field in (("container-title", "journal"), ("container-title-short", "journal_abbr"),
                           ("volume", "volume"), ("issue", "issue"), ("page", "pages"), ("publisher", "publisher"),
                           ("DOI", "doi"), ("URL", "url"), ("abstract", "abstract"), ("note", "notes")):
            if p.get(field):
                it[key] = str(p[field])
        if p.get("keywords"):
            it["keyword"] = ", ".join(p["keywords"])
        items.append(it)
    return json.dumps(items, ensure_ascii=False, indent=2)


# --------------------------------------------------------------------------- #
# CSV
# --------------------------------------------------------------------------- #
def csv_export(papers, group_paths: dict | None = None, style="apa") -> str:
    group_paths = group_paths or {}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Title", "Authors", "Year", "Journal/Source", "Volume", "Issue", "Pages", "DOI", "URL",
                "Keywords", "Labels", "Status", "Starred", "Times cited", "PDF file", "Notes", "Reference", "Added"])
    for p in papers:
        w.writerow([
            p.get("title", ""), "; ".join(fam_ini(a) for a in _authors(p)), p.get("year") or "",
            p.get("journal", ""), p.get("volume", ""), p.get("issue", ""), p.get("pages", ""), p.get("doi", ""),
            p.get("url", ""), "; ".join(p.get("keywords") or []),
            "; ".join(group_paths.get(g, "") for g in p.get("group_ids") or []),
            p.get("status", ""), "yes" if p.get("starred") else "", p.get("cited_by_count") or "",
            p.get("pdf_path", ""), p.get("notes", ""), cite_text(p, style), p.get("added_at", ""),
        ])
    return "﻿" + buf.getvalue()  # BOM so Excel/Numbers read accents correctly
