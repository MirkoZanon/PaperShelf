"""
submission.py - get a manuscript ready for a journal.

A document can carry an ordered author list (with affiliations, who corresponds, equal contribution, ORCID, CRediT roles)
and a target journal (its reference style). From these this module:
  * checks which sections the journal usually asks for are there, and in which order,
  * writes the title-page block (authors, affiliations, markers) and the author-contributions statement,
  * adds the missing sections as empty headings, in the journal's order.

The section lists are the usual requirements of each journal family, not a copy of its instructions:
the person is told to check the current author guidelines. Nothing here is sent anywhere; no e-mail address is stored
(the corresponding author's address is left as a placeholder to fill in when submitting).
"""
from __future__ import annotations

import re

CREDIT = [
    "Conceptualization", "Data curation", "Formal analysis", "Funding acquisition", "Investigation", "Methodology",
    "Project administration", "Resources", "Software", "Supervision", "Validation", "Visualization",
    "Writing – original draft", "Writing – review & editing",
]


def _S(sid, title, req="required", syn=None, where="body", words=None, note=""):
    return {"id": sid, "title": title, "req": req, "syn": syn or [title.lower()], "where": where, "words": words, "note": note}


_ABSTRACT = lambda w, t="Abstract", req="required": _S("abstract", t, req, ["abstract", "summary"], "front", w)
_KEYWORDS = lambda req="recommended": _S("keywords", "Keywords", req, ["keywords", "key words"], "front")
_INTRO = lambda t="Introduction": _S("intro", t, "required", ["introduction", "background"])
_RESULTS = lambda: _S("results", "Results", "required", ["results", "results and discussion", "findings"])
_DISC = lambda t="Discussion": _S("discussion", t, "required", ["discussion", "conclusions", "conclusion", "general discussion"])
_METHODS = lambda t="Methods": _S("methods", t, "required", ["methods", "materials and methods", "method", "star methods", "online methods", "experimental procedures"])
_ACK = lambda t="Acknowledgements": _S("ack", t, "recommended", ["acknowledgements", "acknowledgments", "acknowledgement", "acknowledgment"], "end")
_CONTRIB = lambda t="Author contributions": _S("contrib", t, "required", ["author contributions", "authors' contributions", "authors contributions", "credit author statement", "contributions"], "end")
_COMPETE = lambda t="Competing interests": _S("compete", t, "required", ["competing interests", "declaration of interests", "conflict of interest", "conflicts of interest", "competing financial interests", "declaration of competing interest"], "end")
_FUND = lambda req="required": _S("funding", "Funding", req, ["funding", "financial support", "funding sources", "funding statement"], "end")
_DATA = lambda t="Data availability", req="required": _S("data", t, req, ["data availability", "data accessibility", "data and materials availability", "availability of data", "data availability statement", "data and code availability"], "end")
_REFS = lambda: _S("refs", "References", "required", ["references", "bibliography", "literature cited"], "end")
_ETHICS = lambda req="required": _S("ethics", "Ethics", req, ["ethics", "ethics statement", "ethics approval", "animal ethics"], "end",
                                    note="Animal or human studies: the approval (committee and number).")

_GENERIC = {
    "name": "Generic research article",
    "sections": [_ABSTRACT(250), _KEYWORDS(), _INTRO(), _METHODS(), _RESULTS(), _DISC(), _ACK(), _FUND("recommended"), _CONTRIB(), _COMPETE(), _DATA(), _REFS()],
    "contrib_title": "Author contributions",
    "rules": ["Check the author guidelines of the journal: sections, word limits and the order of the front matter differ from journal to journal."],
}

PROFILES = {
    "nature": {
        "name": "Nature family",
        "sections": [_ABSTRACT(150, "Abstract"), _INTRO(), _RESULTS(), _DISC(), _METHODS("Methods"), _DATA(), _S("code", "Code availability", "recommended", ["code availability"], "end"), _REFS(),
                     _ACK(), _CONTRIB(), _COMPETE(), _S("addinfo", "Additional information", "recommended", ["additional information", "correspondence"], "end")],
        "contrib_title": "Author contributions",
        "rules": ["The abstract (often called the summary paragraph) is unreferenced and short; the Methods follow the main text.",
                  "Affiliations are numbered; mark the corresponding author with * and give the address under Correspondence.",
                  "Author contributions are one short statement (initials), competing interests are always declared, data availability is required."],
    },
    "science": {
        "name": "Science family",
        "sections": [_ABSTRACT(125), _S("oneline", "One-sentence summary", "recommended", ["one-sentence summary", "one sentence summary"], "front", 30), _INTRO(), _RESULTS(), _DISC(), _REFS(), _ACK()],
        "contrib_title": "Author contributions",
        "rules": ["The Acknowledgments carry the funding, the author contributions, the competing interests and the data and materials availability statements.",
                  "Methods and supporting material usually go in the Supplementary Materials."],
    },
    "cell": {
        "name": "Cell Press",
        "sections": [_ABSTRACT(150, "Summary"), _S("highlights", "Highlights", "required", ["highlights"], "front", None, "Three to four bullet points, each short."), _KEYWORDS("required"), _INTRO(), _RESULTS(), _DISC(),
                     _S("limits", "Limitations of the study", "required", ["limitations of the study", "limitations"], "body"), _METHODS("STAR Methods"), _ACK(), _CONTRIB(), _COMPETE("Declaration of interests"), _REFS()],
        "contrib_title": "Author contributions",
        "rules": ["Cell Press asks for one author named as the Lead contact (with address) in addition to any corresponding authors.",
                  "The Methods are written as STAR Methods (key resources table, then the detailed procedures).",
                  "A Declaration of interests and an Author contributions section are required."],
    },
    "pnas": {
        "name": "PNAS",
        "sections": [_S("significance", "Significance Statement", "required", ["significance statement", "significance"], "front", 120), _ABSTRACT(250), _KEYWORDS("required"), _INTRO(), _RESULTS(), _DISC(),
                     _METHODS("Materials and Methods"), _ACK(), _CONTRIB(), _COMPETE(), _DATA(), _REFS()],
        "contrib_title": "Author contributions",
        "rules": ["A Significance Statement for non-specialists (up to 120 words) is required, before the abstract.", "Authors' contributions are a single statement; competing interests are always declared."],
    },
    "royalsociety": {
        "name": "Royal Society journals",
        "sections": [_ABSTRACT(200), _KEYWORDS("required"), _INTRO(), _METHODS(), _RESULTS(), _DISC(), _ETHICS(), _DATA("Data accessibility"), _CONTRIB("Authors' contributions"), _COMPETE(), _FUND(), _ACK(), _REFS()],
        "contrib_title": "Authors' contributions",
        "rules": ["Ethics, Data accessibility, Authors' contributions, Competing interests and Funding statements are all asked for, usually before the References."],
    },
    "jneurosci": {
        "name": "The Journal of Neuroscience / eNeuro",
        "sections": [_ABSTRACT(250), _S("significance", "Significance Statement", "required", ["significance statement"], "front", 120), _INTRO(), _METHODS("Materials and Methods"), _RESULTS(), _DISC(), _REFS(), _ACK(), _CONTRIB(), _COMPETE("Conflict of interest")],
        "contrib_title": "Author contributions",
        "rules": ["Abstract up to 250 words and a Significance Statement up to 120 words; the Methods come before the Results."],
    },
    "elife": {
        "name": "eLife",
        "sections": [_ABSTRACT(150), _INTRO(), _RESULTS(), _DISC(), _METHODS(), _DATA(), _ACK(), _FUND(), _CONTRIB(), _COMPETE(), _ETHICS(), _REFS()],
        "contrib_title": "Author contributions",
        "rules": ["Author contributions are given with the CRediT roles.", "A Data availability statement and the Funding are asked for; animal or human work needs an ethics statement."],
    },
    "vancouver": {
        "name": "PLOS / BMC / medical journals",
        "sections": [_ABSTRACT(300), _S("authorsummary", "Author summary", "recommended", ["author summary"], "front", 200), _INTRO(), _RESULTS(), _DISC(), _METHODS("Materials and Methods"), _ACK(), _CONTRIB("Author Contributions"), _FUND(), _COMPETE(), _DATA(), _ETHICS("recommended"), _REFS()],
        "contrib_title": "Author Contributions",
        "rules": ["PLOS asks for the CRediT roles of every author, a Funding statement, a Competing interests statement and a Data availability statement."],
    },
    "apa": {
        "name": "APA style (psychology journals)",
        "sections": [_ABSTRACT(250), _KEYWORDS("required"), _INTRO(), _METHODS("Method"), _RESULTS(), _DISC(), _REFS(), _S("authornote", "Author note", "recommended", ["author note"], "end"), _FUND(), _COMPETE("Conflict of interest"), _DATA("Open practices", "recommended")],
        "contrib_title": "Author contributions",
        "rules": ["The title page carries the authors, their affiliations and an Author note (funding, conflicts of interest, acknowledgments, correspondence)."],
    },
}


def profile(style: str) -> dict:
    return PROFILES.get(style) or _GENERIC


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9' ]+", " ", (t or "").lower().replace("’", "'").replace("**", "")).strip()


def headings(text: str) -> list:
    """[(line_index, level, title)] of the Markdown headings (and of a line that is only **Bold**)."""
    out = []
    for i, line in enumerate((text or "").split("\n")):
        m = re.match(r"^(#{1,4})\s+(.+?)\s*#*\s*$", line) or re.match(r"^()\*\*([^*]{2,60})\*\*\s*$", line)
        if m:
            out.append((i, len(m.group(1)), m.group(2).strip()))
    return out


def _find(heads, sec):
    for i, _lv, t in heads:
        n = _norm(t)
        if any(n == s or n.startswith(s + " ") for s in sec["syn"]):
            return i
    return None


def _ordered(found) -> set:
    """Indexes of the largest group of found sections that already follow the journal's order (the others are 'out of order')."""
    pos = [(k, ln) for k, (_s, ln) in enumerate(found) if ln is not None]
    best = []
    for i in range(len(pos)):
        best.append(max(([pos[j] for j in range(i)] and [best[j] for j in range(i) if best[j][-1][1] < pos[i][1]] or [[]]), key=len) + [pos[i]])
    top = max(best, key=len) if best else []
    return {k for k, _ln in top}


def check_sections(text: str, style: str) -> list:
    """[{id, title, req, state, words, note}]: state 'ok' | 'missing' | 'order' (found, but not where the journal has it)."""
    P = profile(style)
    heads = headings(text)
    found = [(s, _find(heads, s)) for s in P["sections"]]
    keep = _ordered(found)
    out = []
    for k, (s, ln) in enumerate(found):
        state = "missing" if ln is None else ("ok" if k in keep else "order")
        out.append({"id": s["id"], "title": s["title"], "req": s["req"], "state": state, "words": s["words"], "note": s["note"], "where": s["where"]})
    return out


def add_missing(text: str, style: str, only_required: bool = False) -> str:
    """The text with an empty heading for each missing section, put after the section that precedes it in the journal's order."""
    P = profile(style)
    text = text or ""
    todo = [s for s in P["sections"] if (s["req"] == "required" or not only_required)]
    for k, s in enumerate(P["sections"]):
        if s not in todo or _find(headings(text), s) is not None:
            continue
        lines = text.split("\n")
        heads = headings(text)
        # the nearest earlier section of the profile that exists
        at = None
        keep = _ordered([(x, _find(heads, x)) for x in P["sections"]])
        for kk in range(k - 1, -1, -1):
            prev = P["sections"][kk]
            ln = _find(heads, prev)
            if ln is not None and kk in keep:
                at = ln
                break
        block = ["", f"## {s['title']}", "", ("[" + (s["note"] or (f"up to {s['words']} words" if s["words"] else "to write")) + "]"), ""]
        if at is None:     # before everything but the title
            first = next((i for i, lv, _t in heads if lv == 1), None)
            idx = (first + 1) if first is not None else 0
            for j in range(idx, len(lines)):       # after the authors block, if there is one
                if lines[j].strip() == "<!-- /authors -->":
                    idx = j + 1
                    break
                if lines[j].startswith("#") or (lines[j].strip() and j > idx and "<!-- authors -->" not in "\n".join(lines[idx:j + 1]) and lines[j].strip()):
                    break
        else:
            nxt = [i for i, _lv, _t in heads if i > at]
            idx = nxt[0] if nxt else len(lines)
        lines[idx:idx] = block
        text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text)


_SUP = str.maketrans("0123456789,", "⁰¹²³⁴⁵⁶⁷⁸⁹˒")


def _sup(nums) -> str:
    return ",".join(str(n) for n in nums).translate(_SUP) if nums else ""


def _inits(a) -> str:
    """M.R. for Marco Rossi."""
    g = [p for p in re.split(r"[\s.-]+", (a.get("given") or "").strip()) if p]
    f = [p for p in re.split(r"[\s.-]+", (a.get("family") or "").strip()) if p]
    return "".join(p[0].upper() + "." for p in g + f[-1:])


def author_block(sub: dict, style: str) -> str:
    """The title-page block: authors with markers, then the affiliations and the notes (corresponding, equal contribution)."""
    A = [a for a in (sub.get("authors") or []) if a.get("family")]
    if not A:
        return ""
    aff = [x for x in (sub.get("affils") or []) if x]
    names = []
    for a in A:
        mark = _sup(a.get("aff") or []) + ("*" if a.get("corr") else "") + ("†" if a.get("equal") else "") + ("‡" if a.get("lead") else "")
        names.append(f"{(a.get('given') or '').strip()} {a['family'].strip()}".strip() + mark)
    out = [", ".join(names), ""]
    for i, t in enumerate(aff, 1):
        out.append(f"{_sup([i])} {t}  ")
    if aff:
        out.append("")
    if any(a.get("equal") for a in A):
        out.append("† These authors contributed equally.  ")
    if any(a.get("lead") for a in A) or style == "cell":
        lead = [f"{a['given']} {a['family']}".strip() for a in A if a.get("lead")]
        out.append("‡ Lead contact" + (f": {', '.join(lead)}" if lead else " (to be named)") + " [address]  ")
    cor = [f"{a['given']} {a['family']}".strip() for a in A if a.get("corr")]
    if cor:
        out.append("* Corresponding author" + ("s" if len(cor) > 1 else "") + f": {', '.join(cor)} [e-mail address]  ")
    orc = [f"{a['given']} {a['family']}".strip() + f" {a['orcid']}" for a in A if a.get("orcid")]
    if orc:
        out.append("ORCID: " + "; ".join(orc) + "  ")
    return "\n".join(out).rstrip() + "\n"


def contributions(sub: dict, style: str) -> str:
    """The author-contributions statement: the CRediT roles of each author, by initials."""
    A = [a for a in (sub.get("authors") or []) if a.get("family") and a.get("roles")]
    if not A:
        return ""
    P = profile(style)
    lines = [f"## {P['contrib_title']}", ""]
    if style in ("nature", "science", "pnas", "jneurosci", "royalsociety"):
        for a in A:
            lines.append(f"{_inits(a)}: " + ", ".join(a["roles"]) + ".")
        return "\n".join(lines) + "\n"
    lines.append("; ".join(f"{_inits(a)}: " + ", ".join(a["roles"]) for a in A) + ".")
    return "\n".join(lines) + "\n"


def insert_authors(text: str, sub: dict, style: str) -> str:
    """The authors block right under the title (replacing an earlier one that this function wrote)."""
    block = author_block(sub, style)
    if not block:
        return text
    marked = f"<!-- authors -->\n{block}<!-- /authors -->\n"
    text = re.sub(r"<!-- authors -->.*?<!-- /authors -->\n?", "", text or "", flags=re.S)
    lines = text.split("\n")
    first = next((i for i, l in enumerate(lines) if re.match(r"^#\s+\S", l)), None)
    idx = first + 1 if first is not None else 0
    lines[idx:idx] = ["", *marked.rstrip("\n").split("\n"), ""]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def insert_contributions(text: str, sub: dict, style: str) -> str:
    stmt = contributions(sub, style)
    if not stmt:
        return text
    P = profile(style)
    sec = next((s for s in P["sections"] if s["id"] == "contrib"), None)
    body = stmt.split("\n", 2)[2].strip()
    lines = (text or "").split("\n")
    ln = _find(headings(text), sec) if sec else None
    if ln is not None:      # fill the empty section (or replace its first paragraph)
        j = ln + 1
        while j < len(lines) and not re.match(r"^#{1,4}\s", lines[j]):
            j += 1
        lines[ln + 1:j] = ["", body, ""]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
    return re.sub(r"\n{3,}", "\n\n", (text or "").rstrip("\n") + "\n\n" + stmt)


def clean_sub(raw) -> dict:
    """The author list as it is stored: every field bounded, nothing but names, affiliations, flags, ORCID and CRediT roles."""
    raw = raw if isinstance(raw, dict) else {}
    authors = []
    for a in (raw.get("authors") or [])[:60]:
        if not isinstance(a, dict) or not str(a.get("family") or "").strip():
            continue
        aff = []
        for n in (a.get("aff") or [])[:10]:
            try:
                n = int(n)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= 30 and n not in aff:
                aff.append(n)
        orcid = str(a.get("orcid") or "").strip()
        authors.append({"given": " ".join(str(a.get("given") or "").split())[:120], "family": " ".join(str(a["family"]).split())[:120], "aff": aff,
                        "corr": bool(a.get("corr")), "equal": bool(a.get("equal")), "lead": bool(a.get("lead")),
                        "orcid": orcid if re.fullmatch(r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]", orcid) else "",
                        "roles": [r for r in (a.get("roles") or []) if r in CREDIT][:14]})
    return {"authors": authors, "affils": [" ".join(str(x).split())[:300] for x in (raw.get("affils") or [])[:30]]}
