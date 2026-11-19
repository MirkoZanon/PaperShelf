"""Shared documents: citations and export (Markdown, plain text, Word). Pure Python, no extra libraries."""
from __future__ import annotations

import io
import re
import zipfile
from xml.sax.saxutils import escape

CITE_RE = re.compile(r"\[@([^\]\n]{1,200})\]")


def _family(a) -> str:
    return (a.get("family") if isinstance(a, dict) else str(a or "")).strip()


def labels(items: dict) -> dict:
    """{item_key: 'Smith2020'} for the papers of a group; clashes get a, b, c… so every label is unique."""
    out, used = {}, {}
    for key in sorted(items):
        m = items[key].get("meta") or {}
        au = (m.get("authors") or [None])[0]
        fam = re.sub(r"[^A-Za-z0-9]", "", re.sub(r"\s+", "", _family(au))) or "Anon"
        base = f"{fam}{m.get('year') or ''}"
        n = used.get(base, 0)
        used[base] = n + 1
        out[key] = base + (chr(96 + n) if n else "")
    return out


def short_cite(meta: dict) -> str:
    au = meta.get("authors") or []
    f = [_family(a) for a in au if _family(a)]
    who = "Anon." if not f else (f[0] if len(f) == 1 else f"{f[0]} & {f[1]}" if len(f) == 2 else f"{f[0]} et al.")
    return f"{who}, {meta.get('year') or 'n.d.'}"


def reference(meta: dict) -> str:
    au = meta.get("authors") or []
    names = []
    for a in au[:8]:
        fam = _family(a)
        giv = (a.get("given") or "").strip() if isinstance(a, dict) else ""
        ini = "".join(p[0] + "." for p in re.split(r"[\s.-]+", giv) if p)
        names.append(f"{fam} {ini}".strip())
    who = ", ".join(names) + (" et al." if len(au) > 8 else "")
    bits = [who or "Anon.", f"({meta.get('year') or 'n.d.'})", (meta.get("title") or "").rstrip(".") + "."]
    if meta.get("journal"):
        bits.append(meta["journal"].rstrip(".") + ".")
    if meta.get("doi"):
        bits.append(f"https://doi.org/{meta['doi']}")
    return " ".join(b for b in bits if b)


def resolve(text: str, items: dict):
    """Replace [@Smith2020; @Lee2019] with (Smith, 2020; Lee et al., 2019). Returns (text, ordered list of cited item keys)."""
    by_label = {v: k for k, v in labels(items).items()}
    cited = []

    def sub(m):
        parts = [p.strip().lstrip("@").strip() for p in re.split(r"[;,]", m.group(1)) if p.strip()]
        out = []
        for p in parts:
            k = by_label.get(p)
            if not k:
                out.append(f"{p}?")
                continue
            if k not in cited:
                cited.append(k)
            out.append(short_cite(items[k].get("meta") or {}))
        return "(" + "; ".join(out) + ")"
    return CITE_RE.sub(sub, text), cited


def markdown(title: str, text: str, items: dict, by: str = "", date: str = "") -> str:
    body, cited = resolve(text, items)
    L = [f"# {title}", ""]
    if by or date:
        L += [f"_{' · '.join(x for x in (by, date) if x)}_", ""]
    L += [body.rstrip(), ""]
    if cited:
        refs = sorted(cited, key=lambda k: reference(items[k].get("meta") or {}).lower())
        L += ["## References", ""] + [f"- {reference(items[k].get('meta') or {})}" for k in refs] + [""]
    return "\n".join(L)


def plain(md: str) -> str:
    s = re.sub(r"^#{1,6}\s*", "", md, flags=re.M)
    s = re.sub(r"(\*\*|__)(.+?)\1", r"\2", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", s)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1 (\2)", s)


# ---- Word (.docx) written by hand: a zip of a few XML files
def _runs(s: str) -> str:
    out = []
    for part in re.split(r"(\*\*.+?\*\*|(?<![\w*])\*(?!\s).+?(?<!\s)\*(?![\w*])|`[^`]+`)", s):
        if not part:
            continue
        rp = ""
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            part, rp = part[2:-2], "<w:b/>"
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            part, rp = part[1:-1], "<w:i/>"
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            part, rp = part[1:-1], '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'
        part = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1 (\2)", part)
        out.append(f'<w:r>{"<w:rPr>" + rp + "</w:rPr>" if rp else ""}<w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
    return "".join(out)


def _para(line: str):
    m = re.match(r"^(#{1,3})\s+(.*)$", line)
    if m:
        return f'<w:p><w:pPr><w:pStyle w:val="Heading{len(m.group(1))}"/></w:pPr>{_runs(m.group(2))}</w:p>'
    m = re.match(r"^\s*([-*]|\d+[.)])\s+(.*)$", line)
    if m:
        lead = "•\t" if m.group(1) in "-*" else m.group(1) + "\t"
        return (f'<w:p><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr><w:r><w:t xml:space="preserve">{escape(lead)}</w:t></w:r>'
                f'{_runs(m.group(2))}</w:p>')
    m = re.match(r"^>\s?(.*)$", line)
    if m:
        return f'<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>{_runs(m.group(1))}</w:p>'
    return f"<w:p>{_runs(line)}</w:p>" if line.strip() else "<w:p/>"


def docx_bytes(md: str, title: str = "") -> bytes:
    lines = md.split("\n")
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    body = []
    if title:
        body.append(f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>{_runs(title)}</w:p>')
    body += [_para(l) for l in lines]
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{"".join(body)}'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')

    def style(sid, name, size, bold=False, italic=False, after=120, before=0, ind=0):
        return (f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:qFormat/>'
                f'<w:pPr><w:spacing w:before="{before}" w:after="{after}"/>{f"<w:ind w:left=\"{ind}\"/>" if ind else ""}</w:pPr>'
                f'<w:rPr>{"<w:b/>" if bold else ""}{"<w:i/>" if italic else ""}<w:sz w:val="{size}"/></w:rPr></w:style>')
    styles = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {ns}>'
              '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
              '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
              + style("Title", "Title", 44, True, after=240) + style("Heading1", "heading 1", 32, True, before=280)
              + style("Heading2", "heading 2", 28, True, before=220) + style("Heading3", "heading 3", 24, True, before=160)
              + style("Quote", "Quote", 22, italic=True, ind=567) + "</w:styles>")
    ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    drels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/_rels/document.xml.rels", drels)
    return buf.getvalue()
