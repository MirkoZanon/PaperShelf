"""PaperShelf – conceptual links between papers, from what you wrote about them.

The text of each paper's notes (private and public), the notes on its highlights, the highlighted
sentences and its entries in group tables is turned into a list of weighted terms (words and
two-word phrases, without common words, in English and Italian), weighted by how specific they are
(TF-IDF). Two papers are linked when their terms are similar (cosine similarity), and the shared terms
explain why. Everything is computed here, on this computer – nothing is sent anywhere.
"""
import math
import re
from collections import Counter, defaultdict

STOP = set("""
a about above after again against all almost also although always am among an and another any are around as at
be because been before being below between both but by can cannot could did do does doing done down during each
either else enough even ever every few for from further get gets got had has have having he her here hers him his
how however i if in into is it its itself just least less let like likely made make makes many may me might more
most much must my near need neither never no nor not now of off often on once one only or other others otherwise
our out over own per perhaps quite rather really same see seem seems seen several shall she should since so some
still such than that the their them then there these they this those though through thus to too toward towards
under until up upon us very via was we well were what when where whether which while who whom whose why will with
within without would yet you your yours etc ie eg vs
paper papers study studies result results figure figures fig figs table tables page pages section author authors
et al also show shows shown showed using use used uses based new first second third two three four one way ways
note notes see read reading interesting nice good great important think thought maybe check like really look
looks looking point points thing things lot lots bit kind sort want wants try tried part case cases example
il lo la i gli le un uno una di da in con su per tra fra a al allo alla ai agli alle del dello della dei degli delle
dal dalla dai dagli dalle nel nello nella nei negli nelle sul sulla sui sugli sulle che chi cui non e ed o ma se
anche come più meno molto poco questo questa questi queste quello quella quelli quelle ci si mi ti vi ne sono
essere è era erano sia siano ha hanno ho abbiamo hai avere fare fa fanno può possono poi quindi però dove quando
cosa qui qua già ancora sempre mai tutto tutti tutta tutte ogni altro altra altri altre stesso stessa solo tra
nota note pagina pagine figura figure articolo studio risultati vedi vedere forse bene buono interessante
""".split())
SOURCE_WEIGHT = {"note": 1.0, "entry": 1.0, "hl_note": 1.0, "hl_text": 0.5}
WORD_RE = re.compile(r"[^\W\d_][\w']*", re.UNICODE)
URL_RE = re.compile(r"https?://\S+|www\.\S+|\b10\.\d{4,9}/\S+")
MD_RE = re.compile(r"[*_`#>\[\]()~=|]+")


def stem(w: str) -> str:
    """A very light stemmer (plurals), so that 'neurons' and 'neuron' are the same term."""
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("s") and not w.endswith(("ss", "us", "is", "ous")):
        return w[:-1]
    return w


def terms(text: str):
    """(key, surface form) for the words and two-word phrases of a text."""
    text = MD_RE.sub(" ", URL_RE.sub(" ", text or "")).replace("-", " ").replace("’", "'")
    for sentence in re.split(r"[.;:!?\n]+", text):
        prev = None
        for m in WORD_RE.finditer(sentence):
            raw = m.group(0).lower().split("'")[-1]        # l'attenzione → attenzione
            if len(raw) < 3 or raw in STOP or raw.isdigit():
                prev = None
                continue
            k = stem(raw)
            yield k, raw
            if prev:
                yield prev[0] + " " + k, prev[1] + " " + raw
            prev = (k, raw)


def vectors(docs: dict) -> tuple:
    """docs: {paper_id: [(source, text), ...]} → ({paper_id: {term: weight}}, labels, df)."""
    counts, surface = {}, defaultdict(Counter)
    for pid, parts in docs.items():
        c = Counter()
        for source, text in parts:
            w = SOURCE_WEIGHT.get(source, 1.0)
            for k, raw in terms(text):
                c[k] += w * (1.4 if " " in k else 1.0)   # phrases say more than single words
                surface[k][raw] += 1
        if c:
            counts[pid] = c
    df = Counter()
    for c in counts.values():
        df.update(c.keys())
    n = len(counts)
    vec = {}
    for pid, c in counts.items():
        v = {k: (1 + math.log(x)) * (math.log((n + 1) / (df[k] + 1)) + 1) for k, x in c.items() if x > 0}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vec[pid] = {k: x / norm for k, x in v.items()}
    labels = {k: s.most_common(1)[0][0] for k, s in surface.items()}
    return vec, labels, df


def _clean_terms(ks, labels, limit):
    """The best terms, without single words already said by a phrase."""
    out, said = [], set()
    ks = list(ks)
    phrases = [k for k in ks[:limit * 3] if " " in k]
    for k in ks:
        if " " not in k and any(k in p.split(" ") for p in phrases):
            continue
        out.append(labels.get(k, k))
        said.add(k)
        if len(out) >= limit:
            break
    return out


def analyse(docs: dict, per_paper: int = 8, min_sim: float = 0.05, max_concepts: int = 30) -> dict:
    vec, labels, df = vectors(docs)
    ids = list(vec)
    pairs = []
    for i in range(len(ids)):
        a = vec[ids[i]]
        for j in range(i + 1, len(ids)):
            b = vec[ids[j]]
            if len(a) > len(b):
                a_, b_ = b, a
            else:
                a_, b_ = a, b
            shared = [(k, w * b_[k]) for k, w in a_.items() if k in b_]
            if not shared:
                continue
            sim = sum(x for _, x in shared)
            if sim < min_sim:
                continue
            shared.sort(key=lambda t: -t[1])
            pairs.append({"a": ids[i], "b": ids[j], "w": round(sim, 4),
                          "terms": _clean_terms([k for k, _ in shared], labels, 5)})
    # each paper keeps its strongest links (a readable map)
    per = defaultdict(list)
    for p in pairs:
        per[p["a"]].append(p)
        per[p["b"]].append(p)
    keep = set()
    for lst in per.values():
        for p in sorted(lst, key=lambda p: -p["w"])[:per_paper]:
            keep.add(id(p))
    pairs = [p for p in pairs if id(p) in keep]
    # concepts: the terms several papers share
    score = Counter()
    holders = defaultdict(list)
    for pid, v in vec.items():
        for k, w in v.items():
            if df[k] >= 2:
                score[k] += w
                holders[k].append(pid)
    ranked = [k for k, _ in score.most_common(max_concepts * 3)]
    phrases = [k for k in ranked if " " in k]
    concepts = []
    for k in ranked:   # a single word that only repeats a phrase of the same papers is left out
        if " " not in k and any(k in c.split(" ") and set(holders[c]) >= set(holders[k]) for c in phrases):
            continue
        concepts.append({"key": k, "label": labels.get(k, k), "papers": sorted(holders[k]), "weight": round(score[k], 3)})
        if len(concepts) >= max_concepts:
            break
    top = {pid: _clean_terms([k for k, _ in sorted(v.items(), key=lambda t: -t[1])], labels, 6) for pid, v in vec.items()}
    return {"pairs": pairs, "concepts": concepts, "terms": top, "with_text": len(vec)}
