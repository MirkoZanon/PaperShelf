"""
report.py - a researcher's publication list as a document (HTML, TXT, RTF for
Word/Pages, CSV), with optional journal impact factor, continuous numbering
(oldest = 1), highlighted first / co-first / last authorship, a summary table,
sections by type and/or year, and the update date in the title and file name.
"""
from __future__ import annotations

import csv
import html
import io
import re
from datetime import date

import citations
from citations import _rtf_escape, _tidy
from people import CATEGORIES, ROLE_LABELS, item_to_paper, split_name

KEY_ROLES = ("first", "co-first", "last", "co-last", "sole")
CAT_LABEL = dict(CATEGORIES)
CAT_ORDER = {k: i for i, (k, _) in enumerate(CATEGORIES)}


def default_options():
    return {"include_if": True, "numbering": True, "group": "type", "order": "newest", "highlight": True,
            "summary": True, "year_only": None}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def if_values(m: dict | None):
    """(at publication, current) impact-factor values: official ones you entered, else SCImago's
    2-year citations per document (same formula, Scopus data)."""
    m = m or {}

    def pick(official, est):
        if official and official.get("value") is not None:
            return {"value": float(official["value"]), "year": official.get("year"), "official": True}
        if est and est.get("cites2y") is not None:
            return {"value": float(est["cites2y"]), "year": est.get("year"), "official": False}
        return None

    return pick(m.get("jif_pub"), m.get("at_pub")), pick(m.get("jif_current"), m.get("current"))


def fmt_if(v) -> str:
    if not v:
        return "–"
    return f"{v['value']:.1f}" + ("" if v["official"] else "*")


def if_text(m) -> str:
    pub, now = if_values(m)
    if not pub and not now:
        return ""
    bits = []
    if pub:
        bits.append(f"IF {pub['year']}: {fmt_if(pub)}")
    if now and (not pub or now["year"] != pub["year"]):
        bits.append(f"current ({now['year']}): {fmt_if(now)}")
    return "; ".join(bits)


def name_regex(prof: dict):
    fams = set()
    if prof.get("family"):
        fams.add(prof["family"].strip())
    for n in [prof.get("name") or ""] + list(prof.get("other_names") or []):
        f = split_name(n)["family"]
        if f:
            fams.add(f.strip())
    alts = sorted({re.escape(f) for f in fams if len(f) > 1}, key=len, reverse=True)
    if not alts:
        return None
    fam = "(?:%s)" % "|".join(alts)
    return re.compile(r"(?:(?:[A-Z]\.\s?-?)+\s?)?\b%s\b(?:,?\s(?:[A-Z]\.?-?\s?){1,4}(?=[,.;&\s)]|$))?" % fam)


def split_highlight(text: str, rx):
    if not rx:
        return [(text, False)]
    out, pos = [], 0
    for m in rx.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False))
        out.append((m.group(0).rstrip(), True))
        if m.group(0) != m.group(0).rstrip():
            out.append((m.group(0)[len(m.group(0).rstrip()):], False))
        pos = m.end()
    out.append((text[pos:], False))
    return [x for x in out if x[0]]


def number_items(items, per_type: bool) -> dict:
    groups: dict = {}
    for w in items:
        groups.setdefault(w["category"] if per_type else "all", []).append(w)
    nums = {}
    for g in groups.values():
        for i, w in enumerate(sorted(g, key=lambda w: (w.get("year") or 0, w["title"].lower())), 1):
            nums[w["key"]] = i
    return nums


def blocks(items, group: str, order: str):
    """[{'level', 'title', 'items'}] in reading order."""
    newest = order != "oldest"

    def srt(lst):
        return sorted(lst, key=lambda w: ((-(w.get("year") or 0)) if newest else (w.get("year") or 9999), w["title"].lower()))

    def by_year(lst, level):
        years = sorted({w.get("year") for w in lst}, key=lambda y: (y is None, -(y or 0) if newest else (y or 0)))
        return [{"level": level, "title": str(y) if y else "Year not known",
                 "count": len([w for w in lst if w.get("year") == y]), "items": srt([w for w in lst if w.get("year") == y])}
                for y in years]

    cats = [c for c, _ in CATEGORIES if any(w["category"] == c for w in items)]
    if group == "type":
        return [{"level": 1, "title": CAT_LABEL[c], "count": len([w for w in items if w["category"] == c]),
                 "items": srt([w for w in items if w["category"] == c])} for c in cats]
    if group == "year":
        return by_year(items, 1)
    if group == "type_year":
        out = []
        for c in cats:
            sub = [w for w in items if w["category"] == c]
            out.append({"level": 1, "title": CAT_LABEL[c], "count": len(sub), "items": []})
            out += by_year(sub, 2)
        return out
    return [{"level": 1, "title": None, "count": len(items), "items": srt(items)}]


def summary_rows(items, year: int):
    cols = [("All publications", items), ("Journal articles", [w for w in items if w["category"] == "article"]),
            (str(year), [w for w in items if w.get("year") == year])]
    rows = [("Total", [len(c) for _, c in cols])]
    for cat, label in CATEGORIES:
        n_all = len([w for w in items if w["category"] == cat])
        if n_all:
            rows.append((label.split(" (")[0], [len([w for w in c if w["category"] == cat]) for _, c in cols]))
    for role, label in (("first", "First author (incl. sole author)"), ("co-first", "Co-first author"),
                        ("last", "Last author"), ("co-last", "Co-last author")):
        roles = (role, "sole") if role == "first" else (role,)
        rows.append((label, [len([w for w in c if w.get("role") in roles]) for _, c in cols]))
    return [c for c, _ in cols], rows


def citation_pieces(w, style, rx):
    """Citation segments with the researcher's name marked: [(text, fmt, highlighted)]."""
    out = []
    for i, (t, f) in enumerate(citations.segments(item_to_paper(w), style)):
        if i == 0:
            for piece, hit in split_highlight(t, rx):
                out.append((piece, f, hit))
        else:
            out.append((t, f, False))
    return out


# --------------------------------------------------------------------------- #
# Renderers
# --------------------------------------------------------------------------- #
def _title(prof, opts):
    name = prof.get("name") or "Researcher"
    return f"Publications {opts['year_only']} – {name}" if opts.get("year_only") else f"Publications – {name}"


def filename(prof, opts, ext):
    base = re.sub(r"[^\w\- ]+", "", f"publications {prof.get('name') or ''}").strip().replace(" ", "_")
    if opts.get("year_only"):
        base += f"_{opts['year_only']}"
    return f"{base}_updated_{date.today().isoformat()}.{ext}"


def _affiliation(prof):
    return "; ".join(" – ".join(x for x in (c.get("role"), c.get("department"), c.get("organization")) if x)
                     for c in prof.get("current") or [])


def render_html(prof, items, metrics, style, opts) -> str:
    e = html.escape
    rx = name_regex(prof) if opts["highlight"] else None
    today = date.today().strftime("%d %B %Y")
    per_type = opts["group"] in ("type", "type_year")
    nums = number_items(items, per_type) if opts["numbering"] else {}
    year = opts.get("year_only") or date.today().year
    parts = []
    if opts["summary"]:
        heads, rows = summary_rows(items, year)
        parts.append("<table class='sum'><tr><th></th>" + "".join(f"<th>{e(h)}</th>" for h in heads) + "</tr>" +
                     "".join(f"<tr class='{'tot' if lab == 'Total' else ''}'><td>{e(lab)}</td>" + "".join(f"<td>{v}</td>" for v in vals) + "</tr>"
                             for lab, vals in rows) + "</table>")
    for b in blocks(items, opts["group"], opts["order"]):
        if b["title"]:
            tag = "h2" if b["level"] == 1 else "h3"
            parts.append(f"<{tag}>{e(b['title'])} <span class='n'>({b['count']})</span></{tag}>")
        if not b["items"]:
            continue
        lis = []
        for w in b["items"]:
            role = w.get("role") or ""
            key = role in KEY_ROLES
            ref = []
            for t, f, hit in citation_pieces(w, style, rx):
                t = e(t)
                if hit:
                    t = f"<b><u>{t}</u></b>" if key else f"<b>{t}</b>"
                if "b" in f:
                    t = f"<b>{t}</b>"
                if "i" in f:
                    t = f"<i>{t}</i>"
                ref.append(t)
            ref = _tidy("".join(ref))
            ref = re.sub(r'(https?://[^\s<]+?)([.,;)]?)(?=\s|<|$)', r'<a href="\1">\1</a>\2', ref)
            extra = []
            if opts["highlight"] and key:
                extra.append(f"<span class='role r-{e(role)}'>{e(ROLE_LABELS[role])}</span>")
            if opts["include_if"]:
                t = if_text(metrics.get(w["key"]))
                if t:
                    extra.append(f"<span class='if'>{e(t)}</span>")
            value = f" value='{nums[w['key']]}'" if nums else ""
            lis.append(f"<li{value}>{ref}{' ' + ' '.join(extra) if extra else ''}</li>")
        parts.append(f"<ol class='{'num' if nums else 'plain'}'>{''.join(lis)}</ol>")
    legend = []
    if opts["include_if"]:
        legend.append("IF = journal impact factor in the year of publication and in the latest year available (or the closest previous year with data, as indicated). "
                      "Values with * are SCImago “citations per document (2 years)” – the impact-factor formula on Scopus data; "
                      "values without * are official Journal Impact Factors entered by the user.")
    if opts["highlight"]:
        legend.append("Underlined: first, co-first, last or co-last authorship. Co-first/co-last from PubMed equal-contribution "
                      "statements, where available.")
    if opts["numbering"]:
        legend.append("Numbering is chronological (oldest = 1)" + (" within each type." if per_type else "."))
    src = " · ".join(f'<a href="{e(s["url"])}">{e(s["name"])}</a>' for s in prof.get("sources") or [])
    photo = (prof.get("photo") or {}).get("data") or (prof.get("photo") or {}).get("url")
    orcid = prof.get("orcid")
    title = _title(prof, opts)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{e(title)} (updated {e(today)})</title>
<style>
body{{font:15.5px/1.55 Georgia,'Times New Roman',serif;max-width:54em;margin:2.5em auto;padding:0 1.2em;color:#1d2026;background:#fff}}
header{{display:flex;gap:1.2em;align-items:center;border-bottom:1px solid #ddd;padding-bottom:1em}}
header img{{width:92px;height:92px;border-radius:50%;object-fit:cover}}
h1{{margin:0;font-size:1.7em}} .meta{{color:#555;font:14px -apple-system,Segoe UI,sans-serif;margin-top:3px}}
h2{{font:600 1.15em -apple-system,Segoe UI,sans-serif;margin-top:1.8em;border-bottom:1px solid #e6e6e6;padding-bottom:.2em}}
h3{{font:600 1em -apple-system,Segoe UI,sans-serif;margin:1.2em 0 .3em;color:#444}}
.n{{color:#888;font-weight:normal}} li{{margin:.5em 0}} a{{color:#2c64d6;word-break:break-all}}
ol.plain{{list-style:none;padding-left:0}} ol.num{{padding-left:2.6em}}
.role{{font:600 11px -apple-system,Segoe UI,sans-serif;border-radius:4px;padding:1px 6px;background:#e5edfc;color:#2c64d6;white-space:nowrap}}
.r-last,.r-co-last{{background:#e2f3ec;color:#1f7a4d}}
.if{{font:12px -apple-system,Segoe UI,sans-serif;color:#555;white-space:nowrap}}
table.sum{{border-collapse:collapse;margin:1.4em 0;font:14px -apple-system,Segoe UI,sans-serif}}
table.sum th,table.sum td{{padding:5px 14px 5px 0;border-bottom:1px solid #eee;text-align:left}} table.sum td+td,table.sum th+th{{text-align:right}}
table.sum tr.tot td{{font-weight:700}}
.legend,footer{{color:#666;font:12.5px -apple-system,Segoe UI,sans-serif}} footer{{margin-top:3em;border-top:1px solid #eee;padding-top:1em}}
@media (prefers-color-scheme:dark){{body{{background:#16171a;color:#e6e7e9}} .meta,footer,.legend,.if{{color:#9c9fa6}} a{{color:#6d9bff}} h3{{color:#ccc}}}}
@media print{{a{{color:inherit;text-decoration:none}}}}
</style></head><body>
<header>{f'<img src="{e(photo)}" alt="" onerror="this.remove()">' if photo else ''}<div><h1>{e(title)}</h1>
<div class="meta">{e(_affiliation(prof))}</div>
<div class="meta">{f'ORCID: <a href="https://orcid.org/{e(orcid)}">{e(orcid)}</a> · ' if orcid else ''}Updated {e(today)} · {len(items)} publications</div></div></header>
{''.join(parts)}
{('<p class="legend">' + '<br>'.join(e(x) for x in legend) + '</p>') if legend else ''}
<footer>Compiled with PaperShelf on {e(today)} from {src}. Duplicates merged automatically.</footer>
</body></html>"""


def render_txt(prof, items, metrics, style, opts) -> str:
    today = date.today().strftime("%d %B %Y")
    per_type = opts["group"] in ("type", "type_year")
    nums = number_items(items, per_type) if opts["numbering"] else {}
    year = opts.get("year_only") or date.today().year
    out = [_title(prof, opts), _affiliation(prof), f"Updated {today} · {len(items)} publications", ""]
    if opts["summary"]:
        heads, rows = summary_rows(items, year)
        w0 = max(len(r[0]) for r in rows) + 2
        out.append("SUMMARY")
        out.append(" " * w0 + "".join(h.rjust(18) for h in heads))
        for lab, vals in rows:
            out.append(lab.ljust(w0) + "".join(str(v).rjust(18) for v in vals))
        out.append("")
    for b in blocks(items, opts["group"], opts["order"]):
        if b["title"]:
            out.append(("" if b["level"] == 1 else "  ") + (b["title"].upper() if b["level"] == 1 else f"— {b['title']} —") + f" ({b['count']})")
            out.append("")
        for w in b["items"]:
            ref = _tidy("".join(t for t, _, _ in citation_pieces(w, style, None)))
            tags = []
            if opts["highlight"] and w.get("role") in KEY_ROLES:
                tags.append(ROLE_LABELS[w["role"]])
            if opts["include_if"]:
                t = if_text(metrics.get(w["key"]))
                if t:
                    tags.append(t)
            num = f"{nums[w['key']]}. " if nums else ""
            out.append(f"{num}{ref}" + (f" [{' | '.join(tags)}]" if tags else ""))
            out.append("")
    if opts["include_if"]:
        out.append("IF: impact factor at publication / latest year. * = SCImago citations per document (2 years), "
                   "Scopus data, same formula as the Journal Impact Factor; without * = official JIF entered by the user.")
    if opts["numbering"]:
        out.append("Numbering is chronological (oldest = 1)" + (" within each type." if per_type else "."))
    out.append(f"Sources: {', '.join(s['name'] for s in prof.get('sources') or [])}. Compiled with PaperShelf on {today}.")
    return "\n".join(out) + "\n"


def render_rtf(prof, items, metrics, style, opts) -> str:
    today = date.today().strftime("%d %B %Y")
    rx = name_regex(prof) if opts["highlight"] else None
    per_type = opts["group"] in ("type", "type_year")
    nums = number_items(items, per_type) if opts["numbering"] else {}
    year = opts.get("year_only") or date.today().year
    R = _rtf_escape
    lines = [r"{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Times New Roman;}{\f1\fswiss Helvetica;}}"
             r"{\colortbl;\red85\green85\blue85;\red44\green100\blue214;}\f0\fs24",
             r"{\pard\sa60\b\fs34 " + R(_title(prof, opts)) + r"\b0\par}",
             r"{\pard\sa40\f1\fs20\cf1 " + R(_affiliation(prof)) + r"\par}",
             r"{\pard\sa240\f1\fs20\cf1 " + R(f"Updated {today} · {len(items)} publications") + r"\par}"]
    if opts["summary"]:
        heads, rows = summary_rows(items, year)
        widths = [3600 + 1600 * (i + 1) for i in range(len(heads))]

        def row(cells, bold=False):
            r = r"\trowd\trgaph100\trleft0" + "".join(r"\cellx" + str(x) for x in [3600] + widths)
            for i, c in enumerate(cells):
                r += r"\pard\intbl\f1\fs20" + (r"\qr " if i else " ") + (r"\b " if bold else "") + R(str(c)) + (r"\b0" if bold else "") + r"\cell"
            return r + r"\row"
        lines.append(row([""] + heads, True))
        for lab, vals in rows:
            lines.append(row([lab] + vals, lab == "Total"))
        lines.append(r"\pard\sa200\par")
    for b in blocks(items, opts["group"], opts["order"]):
        if b["title"]:
            size = 28 if b["level"] == 1 else 24
            lines.append(r"{\pard\sb240\sa120\f1\b\fs" + str(size) + " " + R(f"{b['title']} ({b['count']})") + r"\b0\par}")
        for w in b["items"]:
            key = w.get("role") in KEY_ROLES
            segs = [R(f"{nums[w['key']]}. ")] if nums else []
            for t, f, hit in citation_pieces(w, style, rx):
                t = R(t)
                if hit:
                    t = "{\\b\\ul " + t + "}" if key else "{\\b " + t + "}"
                if "b" in f:
                    t = "{\\b " + t + "}"
                if "i" in f:
                    t = "{\\i " + t + "}"
                segs.append(t)
            tags = []
            if opts["highlight"] and key:
                tags.append(ROLE_LABELS[w["role"]])
            if opts["include_if"]:
                t = if_text(metrics.get(w["key"]))
                if t:
                    tags.append(t)
            tail = (r" {\f1\fs18\cf2 [" + R(" | ".join(tags)) + "]}") if tags else ""
            lines.append(r"{\pard\ql\sa120\li720\fi-720 " + _tidy("".join(segs)) + tail + r"\par}")
    notes = []
    if opts["include_if"]:
        notes.append("IF: impact factor at publication / latest year. * = SCImago citations per document (2 years), Scopus data, "
                     "same formula as the Journal Impact Factor; without * = official JIF entered by the user.")
    if opts["highlight"]:
        notes.append("Underlined: first, co-first, last or co-last authorship (co-first/co-last from PubMed equal-contribution statements).")
    if opts["numbering"]:
        notes.append("Numbering is chronological (oldest = 1)" + (" within each type." if per_type else "."))
    notes.append(f"Sources: {', '.join(s['name'] for s in prof.get('sources') or [])}. Compiled with PaperShelf on {today}.")
    for n in notes:
        lines.append(r"{\pard\sb120\f1\fs18\cf1 " + R(n) + r"\par}")
    lines.append("}")
    return "\n".join(lines)


def render_csv(prof, items, metrics, opts) -> str:
    nums = number_items(items, False)
    buf = io.StringIO()
    wr = csv.writer(buf)
    wr.writerow(["No. (chronological)", "Type", "Year", "Title", "Authors", "Role", "Venue", "DOI", "URL",
                 "IF at publication", "IF year", "IF current", "IF current year", "IF source",
                 "Citations (OpenAlex)", "Citations (Google Scholar)", "Sources", "Note"])
    for w in sorted(items, key=lambda w: (-(w.get("year") or 0), w["title"].lower())):
        pub, now = if_values(metrics.get(w["key"]))
        src = "" if not (pub or now) else ("official JIF (entered by user)" if (pub or now)["official"] else "SCImago cites/doc 2y")
        wr.writerow([nums.get(w["key"], ""), CAT_LABEL.get(w["category"], w["category"]).split(" (")[0], w.get("year") or "",
                     w["title"], "; ".join(w.get("authors") or []), ROLE_LABELS.get(w.get("role") or "", ""), w.get("venue") or "",
                     w.get("doi") or "", w.get("url") or "", f"{pub['value']:.1f}" if pub else "", (pub or {}).get("year") or "",
                     f"{now['value']:.1f}" if now else "", (now or {}).get("year") or "", src,
                     "" if w.get("cited_by") is None else w["cited_by"], w.get("scholar_cites") if w.get("scholar_cites") is not None else "",
                     ", ".join(w.get("sources") or []), w.get("cat_note") or ""])
    return "﻿" + buf.getvalue()
