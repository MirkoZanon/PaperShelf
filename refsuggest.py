"""Reference suggestions for a shared document: which papers fit the paragraph being written.
Pure word matching on this computer (titles, keywords, abstracts weighted by how rare each word is) - nothing is sent anywhere."""
from __future__ import annotations

import math
import re
import unicodedata

STOP = set("""a about above after again against all also am an and any are as at be because been before being below between both but by can could did do
does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my
no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those
through to too under until up very was we were what when where which while who whom why will with would you your thus however using used use based
study studies paper results result show shows shown found find new one two may might also within among across via per et al""".split())
TOK = re.compile(r"[^\W\d_][^\W\d_'-]{2,}", re.U)
CITE = re.compile(r"\[@[^\]\n]*\]?")


def _norm(w: str) -> str:
    w = unicodedata.normalize("NFKD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def tokens(text: str) -> list:
    text = CITE.sub(" ", re.sub(r"[#*_`>|\[\]()!]|img:[0-9a-f]{16}", " ", text or ""))
    return [t for t in (_norm(w) for w in TOK.findall(text)) if t not in STOP and len(t) > 2]


def rank(text: str, docs: list, limit: int = 6, query: str = "") -> list:
    """docs: [{'id', 'title', 'abs', 'kw'}]. Returns [{'id', 'score', 'why'}] best first; 'query' (letters typed after [@) narrows by name."""
    q = tokens(text)
    if not q and not query:
        return []
    N = max(len(docs), 1)
    vecs, df = [], {}
    for d in docs:
        v = {}
        for w in tokens(d.get("title") or ""):
            v[w] = v.get(w, 0) + 3
        for w in tokens(d.get("kw") or ""):
            v[w] = v.get(w, 0) + 2
        for w in tokens(d.get("abs") or ""):
            v[w] = v.get(w, 0) + 1
        vecs.append(v)
        for w in v:
            df[w] = df.get(w, 0) + 1
    qtf = {}
    for w in q:
        qtf[w] = qtf.get(w, 0) + 1
    qn = (query or "").lower().strip()
    out = []
    for d, v in zip(docs, vecs):
        s, why = 0.0, []
        for w, n in qtf.items():
            if w in v:
                idf = math.log(1 + N / (1 + df[w]))
                s += idf * (1 + math.log(n)) * v[w] / (v[w] + 1.5)
                why.append((idf * v[w], w))
        name = ((d.get("label") or "") + " " + (d.get("cite") or "") + " " + (d.get("title") or "")).lower()
        if qn:
            if qn not in name:
                continue
            s += 1.0 + (1.5 if ((d.get("label") or "") or (d.get("cite") or "")).lower().startswith(qn) else 0)
        elif len(why) < 2 and s < 2.5:
            continue
        out.append({"id": d["id"], "score": round(s, 3), "why": [w for _, w in sorted(why, reverse=True)[:4]]})
    out.sort(key=lambda r: -r["score"])
    return out[:limit]
