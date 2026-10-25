"""
notes.py - notes on papers.

Private notes live in the paper itself (column note_list, a JSON list) and stay on your computers
(they travel only with your own personal sync). Public notes belong to the papers of a shared label
and are stored in that label's state (see sharing.py), so every member of the label sees them.

Notes are written in a small, safe Markdown:
  # Heading  ## Heading  ### Heading
  **bold**  *italic*  ~~strike~~  `code`  ==highlight==
  {red}coloured text{/}   (red, orange, green, blue, purple, grey)
  - list / 1. list / - [ ] to do / - [x] done
  > quote,  ---  (line),  [text](https://link)
Everything is escaped first: no HTML from a note is ever executed.
"""
from __future__ import annotations

import html
import json
import re
import uuid
from datetime import datetime, timezone

MAX_BODY = 20000
MAX_NOTES = 300
COLORS = {"red": "#d64545", "orange": "#d9822b", "green": "#2f9e44", "blue": "#2f6fd6",
          "purple": "#8b5cf6", "grey": "#808a96", "gray": "#808a96"}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- private notes
def load(raw) -> list:
    try:
        lst = json.loads(raw or "[]") if isinstance(raw, str) else (raw or [])
    except ValueError:
        return []
    out = []
    for n in lst if isinstance(lst, list) else []:
        if isinstance(n, dict) and isinstance(n.get("body"), str):
            out.append({"id": str(n.get("id") or uuid.uuid4().hex[:16])[:32], "body": n["body"][:MAX_BODY],
                        "created": str(n.get("created") or ""), "at": str(n.get("at") or n.get("created") or "")})
    return out[:MAX_NOTES]


def add(lst: list, body: str) -> dict:
    n = {"id": uuid.uuid4().hex[:16], "body": (body or "")[:MAX_BODY], "created": _now(), "at": _now()}
    lst.append(n)
    return n


def edit(lst: list, nid: str, body: str) -> bool:
    for n in lst:
        if n["id"] == nid:
            n["body"], n["at"] = (body or "")[:MAX_BODY], _now()
            return True
    return False


def remove(lst: list, nid: str) -> bool:
    k = len(lst)
    lst[:] = [n for n in lst if n["id"] != nid]
    return len(lst) != k


def plain(lst: list) -> str:
    """All private notes as one plain text (used by the search box and older exports)."""
    return "\n\n".join(to_text(n["body"]) for n in lst if n.get("body"))


# --------------------------------------------------------------------------- markdown
_SAFE_URL = re.compile(r"^(https?://|mailto:|doi:)", re.I)


def _inline(t: str) -> str:
    """t is already HTML-escaped."""
    codes = []

    def keep(m):
        codes.append(m.group(1))
        return f"\x00{len(codes) - 1}\x00"
    t = re.sub(r"`([^`\n]+)`", keep, t)

    def link(m):
        label, url = m.group(1), html.unescape(m.group(2))
        if not _SAFE_URL.match(url):
            return m.group(0)
        if url.lower().startswith("doi:"):
            url = "https://doi.org/" + url[4:]
        return f'<a href="{html.escape(url, quote=True)}" target="_blank" rel="noopener">{label}</a>'
    t = re.sub(r"\[([^\]\n]+)\]\(([^)\s]+)\)", link, t)
    t = re.sub(r"(?<![\"'>=])(https?://[^\s<]+[^\s<.,;:)\]])",
               lambda m: f'<a href="{m.group(1)}" target="_blank" rel="noopener">{m.group(1)}</a>', t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"__(.+?)__", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<em>\1</em>", t)
    t = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", r"<em>\1</em>", t)
    t = re.sub(r"~~(.+?)~~", r"<del>\1</del>", t)
    t = re.sub(r"==(.+?)==", r"<mark>\1</mark>", t)
    t = re.sub(r"\{(red|orange|green|blue|purple|grey|gray)\}(.+?)\{/\}",
               lambda m: f'<span style="color:{COLORS[m.group(1)]}">{m.group(2)}</span>', t, flags=re.S)
    return re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{codes[int(m.group(1))]}</code>", t)


def to_html(src: str) -> str:
    lines = html.escape(src or "", quote=False).replace("\r\n", "\n").split("\n")
    out, para, lst, quote = [], [], None, []

    def flush_para():
        if para:
            out.append("<p>" + "<br>".join(_inline(x) for x in para) + "</p>")
            para.clear()

    def flush_list():
        nonlocal lst
        if lst:
            out.append(f"<{lst[0]}>" + "".join(lst[1]) + f"</{lst[0]}>")
            lst = None

    def flush_quote():
        if quote:
            out.append("<blockquote>" + to_html(html.unescape("\n".join(quote))) + "</blockquote>")
            quote.clear()
    in_code, code = False, []
    for ln in lines:
        if ln.strip().startswith("```"):
            if in_code:
                out.append("<pre><code>" + "\n".join(code) + "</code></pre>")
                code, in_code = [], False
            else:
                flush_para(); flush_list(); flush_quote()
                in_code = True
            continue
        if in_code:
            code.append(ln)
            continue
        m_q = re.match(r"^\s*&gt;\s?(.*)$", ln)
        if m_q:
            flush_para(); flush_list()
            quote.append(m_q.group(1))
            continue
        flush_quote()
        if not ln.strip():
            flush_para(); flush_list()
            continue
        m_h = re.match(r"^(#{1,3})\s+(.*)$", ln)
        if m_h:
            flush_para(); flush_list()
            k = len(m_h.group(1)) + 2  # h3..h5: notes are small
            out.append(f"<h{k}>{_inline(m_h.group(2))}</h{k}>")
            continue
        if re.match(r"^\s*(-{3,}|\*{3,})\s*$", ln):
            flush_para(); flush_list()
            out.append("<hr>")
            continue
        m_l = re.match(r"^\s*([-*+]|\d+[.)])\s+(.*)$", ln)
        if m_l:
            flush_para()
            kind = "ol" if m_l.group(1)[0].isdigit() else "ul"
            if not lst or lst[0] != kind:
                flush_list()
                lst = (kind, [])
            item = m_l.group(2)
            m_c = re.match(r"^\[( |x|X)\]\s+(.*)$", item)
            if m_c:
                box = "☑" if m_c.group(1).lower() == "x" else "☐"
                lst[1].append(f'<li class="task">{box} {_inline(m_c.group(2))}</li>')
            else:
                lst[1].append(f"<li>{_inline(item)}</li>")
            continue
        flush_list()
        para.append(ln)
    if in_code:
        out.append("<pre><code>" + "\n".join(code) + "</code></pre>")
    flush_para(); flush_list(); flush_quote()
    return "\n".join(out)


def to_text(src: str) -> str:
    """Markdown → readable plain text."""
    t = (src or "").replace("\r\n", "\n")
    t = re.sub(r"\{(red|orange|green|blue|purple|grey|gray)\}(.+?)\{/\}", r"\2", t, flags=re.S)
    t = re.sub(r"\[([^\]\n]+)\]\(([^)\s]+)\)", r"\1 (\2)", t)
    t = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: m.group(1) or m.group(2), t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"\1", t)
    t = re.sub(r"~~(.+?)~~", r"\1", t)
    t = re.sub(r"==(.+?)==", r"\1", t)
    t = re.sub(r"`([^`\n]+)`", r"\1", t)
    t = re.sub(r"^```.*$", "", t, flags=re.M)
    t = re.sub(r"^(#{1,3})\s+(.*)$", lambda m: m.group(2).upper() if len(m.group(1)) == 1 else m.group(2), t, flags=re.M)
    t = re.sub(r"^(\s*)[-*+]\s+\[( |x|X)\]\s+", lambda m: m.group(1) + ("[x] " if m.group(2).lower() == "x" else "[ ] "), t, flags=re.M)
    t = re.sub(r"^(\s*)[*+]\s+", r"\1- ", t, flags=re.M)
    return t.strip()


# --------------------------------------------------------------------------- export
def _date(s: str) -> str:
    return (s or "")[:10]


def export(entries: list, fmt: str = "md", title: str = "Notes") -> str:
    """entries: [{'ref': str, 'notes': [{'body','who','date','where'}]}]  →  md / txt / html"""
    if fmt == "html":
        parts = [f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title><style>"
                 "body{font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:32px auto;"
                 "padding:0 16px;color:#1d2330}h1{font-size:22px}.paper{border-top:1px solid #dde2ea;padding:14px 0}"
                 ".ref{font-weight:600;margin-bottom:8px}.note{margin:8px 0 8px 12px;padding:6px 12px;border-left:3px solid #e0a83a}"
                 ".note.public{border-color:#2f6fd6}.meta{color:#69758a;font-size:12px}mark{background:#fff0a8}"
                 "blockquote{border-left:3px solid #ccd;margin:4px 0;padding-left:10px;color:#556}"
                 "code{background:#f1f3f7;padding:0 3px;border-radius:3px}li.task{list-style:none;margin-left:-18px}"
                 "</style></head><body>", f"<h1>{html.escape(title)}</h1>"]
        for e in entries:
            parts.append(f"<div class='paper'><div class='ref'>{html.escape(e['ref'])}</div>")
            for n in e["notes"]:
                parts.append(f"<div class='note {'public' if n.get('public') else ''}'><div class='meta'>"
                             f"{html.escape(n['who'])} · {html.escape(n['date'])} · {html.escape(n['where'])}</div>"
                             f"{to_html(n['body'])}</div>")
            if not e["notes"]:
                parts.append("<div class='meta'>No notes.</div>")
            parts.append("</div>")
        return "".join(parts) + "</body></html>"
    out = [f"# {title}" if fmt == "md" else title.upper(), ""]
    for i, e in enumerate(entries, 1):
        out.append(f"## {i}. {e['ref']}" if fmt == "md" else f"{i}. {e['ref']}")
        out.append("")
        for n in e["notes"]:
            meta = f"{n['who']} · {n['date']} · {n['where']}"
            if fmt == "md":  # headings inside a note go below the paper's heading
                body = re.sub(r"^(#{1,3})(\s)", lambda m: "#" * (len(m.group(1)) + 2) + m.group(2), n["body"].strip(), flags=re.M)
                out += [f"**{meta}**", "", body, ""]
            else:
                out += [f"   [{meta}]"] + ["   " + x for x in to_text(n["body"]).split("\n")] + [""]
        if not e["notes"]:
            out += ["(no notes)" if fmt != "md" else "_No notes._", ""]
        out.append("" if fmt == "md" else "-" * 60)
    return "\n".join(out).rstrip() + "\n"
