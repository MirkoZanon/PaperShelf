"""
journals.py - journal metrics for the publication lists.

The official Journal Impact Factor (Clarivate JCR) is a commercial product with
no free API, so PaperShelf uses open, citable equivalents:

  SCImago Journal Rank (scimagojr.com, based on Scopus), one table per year
  since 1999, downloaded once and kept locally:
    - SJR indicator and best quartile (Q1-Q4)
    - "Cites / Doc. (2 years)": citations received in a year by the papers of
      the two previous years - the same formula as the impact factor, computed
      on Scopus data. Available for the publication year AND the latest year.
  OpenAlex: the journal's current "2-year mean citedness" (same formula, on
      OpenAlex data).
  Your own entries: if you have JCR access through your university you can
      type the official impact factor of a journal; it is stored only here.
"""
from __future__ import annotations

import csv
import io
import re
import time
from datetime import datetime

import metadata

SJR_URL = "https://www.scimagojr.com/journalrank.php"
FIRST_YEAR = 1999

SCHEMA = """
CREATE TABLE IF NOT EXISTS sjr_journal (sourceid TEXT PRIMARY KEY, title TEXT, norm_title TEXT, issns TEXT);
CREATE TABLE IF NOT EXISTS sjr_issn (issn TEXT PRIMARY KEY, sourceid TEXT);
CREATE TABLE IF NOT EXISTS sjr_year (sourceid TEXT, year INTEGER, sjr REAL, quartile TEXT, cites2y REAL,
                                     PRIMARY KEY (sourceid, year));
CREATE TABLE IF NOT EXISTS sjr_loaded (year INTEGER PRIMARY KEY, journals INTEGER, loaded_at TEXT);
CREATE TABLE IF NOT EXISTS jif_manual (norm_title TEXT, year INTEGER, value REAL, PRIMARY KEY (norm_title, year));
CREATE INDEX IF NOT EXISTS idx_sjr_title ON sjr_journal(norm_title);
"""


def init(db):
    db.executescript(SCHEMA)


def norm_title(t):
    t = (t or "").lower().replace("&", "and")
    t = re.sub(r"^the\s+", "", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def norm_issn(i):
    i = re.sub(r"[^0-9Xx]", "", i or "").upper()
    return i if len(i) == 8 else ""


def latest_year() -> int:
    """SCImago publishes the previous year's table around May/June."""
    now = datetime.now()
    return now.year - 1 if now.month >= 7 else now.year - 2


def loaded_years(db) -> list[int]:
    return [r[0] for r in db.execute("SELECT year FROM sjr_loaded ORDER BY year")]


def _float(s):
    s = (s or "").strip().replace(".", "").replace(",", ".") if "," in (s or "") else (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def import_table(db, year: int, raw: bytes) -> int:
    """Store one SCImago yearly table (the CSV offered on scimagojr.com)."""
    text = raw.decode("utf-8-sig", errors="replace")
    first = text.split("\n", 1)[0]
    if "SJR" not in first or ("Issn" not in first and "ISSN" not in first):
        raise ValueError("This doesn't look like a SCImago journal ranking file.")
    delim = ";" if first.count(";") > first.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    cols = reader.fieldnames or []

    def col(*preds):
        for c in cols:
            if all(p(c) for p in preds):
                return c
        return None

    c_id = col(lambda c: c.strip().lower() == "sourceid")
    c_title = col(lambda c: c.strip().lower() == "title")
    c_issn = col(lambda c: c.strip().lower() == "issn")
    c_sjr = col(lambda c: c.strip().lower() == "sjr")
    c_q = col(lambda c: "quartile" in c.lower())
    c_cites = col(lambda c: "doc" in c.lower(), lambda c: "2year" in c.lower().replace(" ", ""))
    if not (c_title and c_issn and c_sjr):
        raise ValueError("Unexpected columns in the SCImago file.")
    n = 0
    for row in reader:
        title = (row.get(c_title) or "").strip()
        if not title:
            continue
        issns = [norm_issn(x) for x in re.split(r"[,\s]+", row.get(c_issn) or "") if norm_issn(x)]
        sid = (row.get(c_id) or "").strip() if c_id else ""
        sid = sid or (issns[0] if issns else "t:" + norm_title(title))
        db.execute("INSERT OR REPLACE INTO sjr_journal VALUES (?, ?, ?, ?)", (sid, title, norm_title(title), ",".join(issns)))
        for i in issns:
            db.execute("INSERT OR REPLACE INTO sjr_issn VALUES (?, ?)", (i, sid))
        q = (row.get(c_q) or "").strip() if c_q else ""
        db.execute("INSERT OR REPLACE INTO sjr_year VALUES (?, ?, ?, ?, ?)",
                   (sid, int(year), _float(row.get(c_sjr)), q if q in ("Q1", "Q2", "Q3", "Q4") else "",
                    _float(row.get(c_cites)) if c_cites else None))
        n += 1
    db.execute("INSERT OR REPLACE INTO sjr_loaded VALUES (?, ?, ?)", (int(year), n, datetime.now().isoformat(timespec="seconds")))
    db.commit()
    return n


def download_year(db, year: int) -> int:
    r = metadata.http_get(SJR_URL, params={"year": int(year), "out": "xls"}, browser=True, timeout=120)
    if r.status_code != 200 or not r.content:
        raise metadata.MetadataError(f"SCImago didn't provide the {year} table (HTTP {r.status_code}).")
    try:
        return import_table(db, year, r.content)
    except ValueError as exc:
        raise metadata.MetadataError(
            f"SCImago's {year} table could not be read ({exc}). You can download it yourself from "
            "scimagojr.com/journalrank.php (button 'Download data') and import it in Settings.") from exc


def find_journal(db, issns=(), name=""):
    for i in issns or []:
        i = norm_issn(i)
        if i:
            r = db.execute("SELECT sourceid FROM sjr_issn WHERE issn=?", (i,)).fetchone()
            if r:
                return r[0]
    nt = norm_title(name)
    if nt:
        r = db.execute("SELECT sourceid FROM sjr_journal WHERE norm_title=?", (nt,)).fetchone()
        if r:
            return r[0]
    return None


def year_metrics(db, sid, year):
    """Metrics for that year, or the closest loaded year (at most 2 years away)."""
    if not sid or not year:
        return None
    rows = db.execute("SELECT year, sjr, quartile, cites2y FROM sjr_year WHERE sourceid=? "
                      "ORDER BY ABS(year - ?) ASC, year DESC LIMIT 1", (sid, int(year))).fetchone()
    if not rows or abs(rows[0] - int(year)) > 2:
        return None
    return {"year": rows[0], "sjr": rows[1], "quartile": rows[2], "cites2y": rows[3]}


def metrics_for(db, items):
    """items: [{key, issns, name, year}] -> {key: {...}}"""
    latest = max(loaded_years(db) or [0])
    out = {}
    for it in items:
        sid = find_journal(db, it.get("issns"), it.get("name"))
        title = db.execute("SELECT title FROM sjr_journal WHERE sourceid=?", (sid,)).fetchone()[0] if sid else None
        nt = norm_title(title or it.get("name"))
        jif = {r[0]: r[1] for r in db.execute("SELECT year, value FROM jif_manual WHERE norm_title=?", (nt,))} if nt else {}
        y = it.get("year")
        out[it["key"]] = {
            "journal": title, "norm_title": nt,
            "at_pub": year_metrics(db, sid, y) if y else None,
            "current": year_metrics(db, sid, latest) if latest else None,
            "jif_pub": {"year": y, "value": jif[y]} if y in jif else None,
            "jif_current": {"year": max(jif), "value": jif[max(jif)]} if jif else None,
        }
    return out


def set_manual_jif(db, name, year, value):
    nt = norm_title(name)
    if not nt or not year:
        raise ValueError("Journal and year are needed.")
    if value in (None, ""):
        db.execute("DELETE FROM jif_manual WHERE norm_title=? AND year=?", (nt, int(year)))
    else:
        db.execute("INSERT OR REPLACE INTO jif_manual VALUES (?, ?, ?)", (nt, int(year), float(str(value).replace(",", "."))))
    db.commit()


def openalex_sources(db, ids, cache_get, cache_put):
    """Current 2-year mean citedness of journals from OpenAlex (cached)."""
    out, missing = {}, []
    for i in ids:
        c = cache_get("src:" + i)
        if c is not None:
            out[i] = c
        else:
            missing.append(i)
    for k in range(0, len(missing), 50):
        chunk = missing[k:k + 50]
        r = metadata.http_get("https://api.openalex.org/sources",
                              params={"filter": "openalex_id:" + "|".join(chunk), "per_page": 50,
                                      "select": "id,display_name,summary_stats"})
        if r.status_code != 200:
            break
        for s in r.json().get("results", []):
            sid = metadata.openalex_short(s.get("id"))
            v = {"name": s.get("display_name"), "mean2y": round((s.get("summary_stats") or {}).get("2yr_mean_citedness") or 0, 2),
                 "h_index": (s.get("summary_stats") or {}).get("h_index")}
            out[sid] = v
            cache_put("src:" + sid, v)
    return out
