"""Shared documents: citations and export (Markdown, plain text, Word). Pure Python, no extra libraries."""
from __future__ import annotations

import base64
import io
import re
import struct
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
    text = re.sub(r"\][ \t]*[;,]?[ \t]*\[@", "; @", text)      # [@a] [@b] and [@a], [@b] are one group: (A, 2020; B, 2019)
    return CITE_RE.sub(sub, text), cited


IMG_RE = re.compile(r"!\[([^\]\n]*)\]\(img:([0-9a-f]{16})\)")
SEP_RE = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")


def markdown(title: str, text: str, items: dict, by: str = "", date: str = "", images: dict | None = None, inline_images: bool = False) -> str:
    body, cited = resolve(text, items)
    if inline_images:     # a stand-alone Markdown file carries its pictures inside
        body = IMG_RE.sub(lambda m: (f"![{m.group(1)}](data:{images[m.group(2)][0]};base64,{base64.b64encode(images[m.group(2)][1]).decode()})"
                                     if images and m.group(2) in images else f"[picture: {m.group(1)}]"), body)
    L = [f"# {title}", ""]
    if by or date:
        L += [f"_{' · '.join(x for x in (by, date) if x)}_", ""]
    L += [body.rstrip(), ""]
    if cited:
        refs = sorted(cited, key=lambda k: reference(items[k].get("meta") or {}).lower())
        L += ["## References", ""] + [f"- {reference(items[k].get('meta') or {})}" for k in refs] + [""]
    return "\n".join(L)


def plain(md: str) -> str:
    s = IMG_RE.sub(lambda m: f"[picture: {m.group(1)}]" if m.group(1) else "[picture]", md)
    s = re.sub(r"^#{1,6}\s*", "", s, flags=re.M)
    s = re.sub(r"(\*\*|__)(.+?)\1", r"\2", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", s)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1 (\2)", s)


# ---- Word (.docx) written by hand: a zip of a few XML files
def _runs(s: str) -> str:
    out = []
    for part in re.split(r"(==(?:\{\w+\})?.+?==|\*\*.+?\*\*|(?<![\w*])\*(?!\s).+?(?<!\s)\*(?![\w*])|`[^`]+`)", s):
        if not part:
            continue
        rp = ""
        hm = re.match(r"^==(?:\{(yellow|green|blue|pink|orange)\})?(.+?)==$", part)
        if hm:
            fill = {"yellow": "FFF59D", "green": "BFF0C2", "blue": "BFE0FF", "pink": "FFC9E3", "orange": "FFD3A1"}[hm.group(1) or "yellow"]
            part, rp = hm.group(2), f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>'
        elif part.startswith("**") and part.endswith("**") and len(part) > 4:
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


def img_size(raw: bytes):
    """(width, height) in pixels of a JPEG, PNG, GIF or WebP; (480, 320) when it cannot be read."""
    try:
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", raw[16:24])
        if raw[:3] == b"GIF":
            return struct.unpack("<HH", raw[6:10])
        if raw[:4] == b"RIFF":
            if raw[12:16] == b"VP8X":
                return 1 + int.from_bytes(raw[24:27], "little"), 1 + int.from_bytes(raw[27:30], "little")
            if raw[12:16] == b"VP8 ":
                return struct.unpack("<HH", raw[26:30])[0] & 0x3FFF, struct.unpack("<HH", raw[26:30])[1] & 0x3FFF
            if raw[12:16] == b"VP8L":
                v = int.from_bytes(raw[21:25], "little")
                return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
        if raw[:2] == b"\xff\xd8":
            i = 2
            while i < len(raw) - 9:
                if raw[i] != 0xFF:
                    i += 1
                    continue
                m = raw[i + 1]
                if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                    i += 2
                    continue
                if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", raw[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", raw[i + 2:i + 4])[0]
    except Exception:
        pass
    return 480, 320


def _cells(line: str) -> list:
    t = line.strip()
    t = t[1:] if t.startswith("|") else t
    t = t[:-1] if t.endswith("|") and not t.endswith("\\|") else t
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", t)]


_MID_RE = re.compile(r"^\s*\|(\s*:?-{3,}:?\s*\|?)+\s*$")


def _spans(line: str, merge: bool = True) -> list:
    """[(text, colspan)]. In header rows a cell followed by an empty cell ('Monday||') is merged with it; elsewhere empty cells stay empty."""
    t = line.strip()
    t = t[1:] if t.startswith("|") else t
    t = t[:-1] if t.endswith("|") and not t.endswith("\\|") else t
    out = []
    for k, c in enumerate(re.split(r"(?<!\\)\|", t)):
        if merge and k and c == "" and out:
            out[-1][1] += 1
        else:
            out.append([c.strip().replace("\\|", "|"), 1])
    return out


def _table(rows: list, align: list, nhead: int = 1) -> str:
    n = max(sum(sp for _t, sp in r) for r in rows)
    # the main separation lines (the column edges of the first header row) stay visible: a merged cell crossing one is cut there
    edges, c0 = set(), 0
    for _t, sp in rows[0]:
        c0 += sp
        edges.add(c0)
    bounds = edges if any(sp > 1 for _t, sp in rows[0]) else set()
    cut = []
    for r in rows:
        out, col = [], 0
        for txt, sp in r:
            frm, first = col, True
            while frm < col + sp:
                to = min([x for x in bounds if frm < x < col + sp] or [col + sp]) if first else frm + 1
                out.append((txt if first else "", to - frm, to in bounds))
                first, frm = False, to
            col += sp
        cut.append(out)
    rows = cut
    w = 9298 // n
    jc = {"c": "center", "r": "right"}
    out = ['<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
           + "".join(f'<w:{e} w:val="single" w:sz="4" w:space="0" w:color="999999"/>' for e in ("top", "left", "bottom", "right", "insideH", "insideV"))
           + '</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'
           + f'<w:gridCol w:w="{w}"/>' * n + "</w:tblGrid>"]
    for ri, r in enumerate(rows):
        head = ri < nhead
        out.append("<w:tr>" + ("<w:trPr><w:tblHeader/></w:trPr>" if head else ""))
        ci = 0
        for txt, sp, grp in r:
            runs = _runs(txt)
            if head:
                runs = runs.replace("<w:r>", "<w:r><w:rPr><w:b/></w:rPr>").replace("<w:r><w:rPr><w:b/></w:rPr><w:rPr>", "<w:r><w:rPr><w:b/>")
            al = align[ci] if ci < len(align) else ""
            out.append(f'<w:tc><w:tcPr><w:tcW w:w="{w * sp}" w:type="dxa"/>' + (f'<w:gridSpan w:val="{sp}"/>' if sp > 1 else "")
                       + ('<w:tcBorders><w:right w:val="single" w:sz="12" w:space="0" w:color="555555"/></w:tcBorders>' if grp else "")
                       + ('<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' if head else "") + "</w:tcPr>"
                       f'<w:p><w:pPr><w:spacing w:after="40"/>{f"<w:jc w:val=\"{jc[al]}\"/>" if al in jc else ""}</w:pPr>{runs}</w:p></w:tc>')
            ci += sp
        out.append("</w:tr>")
    out.append("</w:tbl><w:p/>")
    return "".join(out)


def _picture(n: int, rid: str, alt: str, raw: bytes) -> str:
    w, h = img_size(raw)
    cx, cy = max(w, 1) * 9525, max(h, 1) * 9525
    if cx > 5_400_000:
        cy, cx = cy * 5_400_000 // cx, 5_400_000
    a = escape(alt, {'"': "&quot;"})
    return (f'<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:docPr id="{n}" name="Picture {n}" descr="{a}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="{n}" name="Picture {n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')


def docx_bytes(md: str, title: str = "", images: dict | None = None) -> bytes:
    images = images or {}
    lines = md.split("\n")
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    body, media, i = [], [], 0
    if title:
        body.append(f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>{_runs(title)}</w:p>')
    while i < len(lines):
        ln = lines[i]
        if "|" in ln and i + 1 < len(lines) and SEP_RE.match(lines[i + 1]) and "|" in lines[i + 1]:
            al = ["c" if c.startswith(":") and c.endswith(":") else "r" if c.endswith(":") else "" for c in _cells(lines[i + 1])]
            tl, j = [], i + 2
            while j < len(lines) and lines[j].strip() and "|" in lines[j]:
                tl.append(lines[j])
                j += 1
            last_mid = max([k for k, l in enumerate(tl) if _MID_RE.match(l)] or [-1])   # a second dashed line: the rows above it are header rows too
            rows = [_spans(ln)] + [_spans(l, merge=k < last_mid) for k, l in enumerate(tl) if not _MID_RE.match(l)]
            nhead = 1 + sum(1 for k, l in enumerate(tl) if k < last_mid and not _MID_RE.match(l))
            i = j
            body.append(_table(rows, al, nhead))
            continue
        m = IMG_RE.fullmatch(ln.strip())
        if m and m.group(2) in images:
            raw = images[m.group(2)][1]
            media.append((images[m.group(2)][0], raw))
            body.append(_picture(len(media), f"rIdImg{len(media)}", m.group(1), raw))
        elif m:
            body.append(f"<w:p>{_runs('[picture: ' + m.group(1) + ']')}</w:p>")
        else:
            body.append(_para(ln))
        i += 1
    ns = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')
    doc = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{"".join(body)}'
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

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
          '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="webp" ContentType="image/webp"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    drels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
             + "".join(f'<Relationship Id="rIdImg{k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img{k}.{mt.split("/")[1].replace("jpeg", "jpeg")}"/>' for k, (mt, _) in enumerate(media, 1))
             + '</Relationships>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/_rels/document.xml.rels", drels)
        for k, (mt, raw) in enumerate(media, 1):
            z.writestr(f"word/media/img{k}.{mt.split('/')[1]}", raw)
    return buf.getvalue()
