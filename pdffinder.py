"""
pdffinder.py - find a *legally available* PDF for a paper and save it.

Where it looks, in order:
  1. arXiv (for preprints)
  2. the PDF link found when the paper was added (OpenAlex / publisher page)
  3. Unpaywall (needs your e-mail in Settings - it's free)
  4. OpenAlex open-access locations
  5. Semantic Scholar (open-access copies it indexes)
  6. CORE - papers from university repositories worldwide (free key, optional)
  7. Europe PMC (open-access biomedical papers)
  8. the publisher's page ("citation_pdf_url"), which works for open-access
     journals and sometimes when your network has a subscription (e.g. on campus)
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from urllib.parse import quote, urljoin

import requests

import metadata
from metadata import BROWSER_HEADERS, MetadataError, http_get, parse_meta

MAX_PDF_BYTES = 150 * 1024 * 1024


class PdfNotFound(Exception):
    def __init__(self, tried: list[dict]):
        self.tried = tried
        super().__init__(
            "No freely available PDF was found. If you have access (e.g. through your university), "
            "download it from the article page and use 'Attach PDF'."
        )


def candidate_urls(paper: dict, email: str = "", core_key: str = "") -> list[tuple[str, str]]:
    cands: list[tuple[str, str]] = []

    def add(url, source):
        if url and url not in [u for u, _ in cands]:
            cands.append((url, source))

    if paper.get("arxiv_id"):
        add(f"https://arxiv.org/pdf/{paper['arxiv_id']}", "arXiv")
    add(paper.get("pdf_url"), "saved PDF link")

    doi = (paper.get("doi") or "").strip()
    if doi and not doi.lower().startswith("10.48550/"):
        if email:
            try:
                r = http_get(f"https://api.unpaywall.org/v2/{quote(doi, safe='/:;()')}", params={"email": email})
                if r.status_code == 200:
                    d = r.json()
                    for loc in [d.get("best_oa_location")] + list(d.get("oa_locations") or []):
                        if loc and loc.get("url_for_pdf"):
                            add(loc["url_for_pdf"], f"Unpaywall ({loc.get('host_type') or 'open access'})")
            except (MetadataError, ValueError):
                pass
        try:
            w = metadata.openalex_lookup(doi, email)
            if w:
                for u in metadata.openalex_pdf_urls(w):
                    add(u, "OpenAlex")
        except (MetadataError, ValueError):
            pass
        try:
            r = http_get(f"https://api.semanticscholar.org/graph/v1/paper/DOI:{quote(doi, safe='/:;()')}",
                         params={"fields": "openAccessPdf"})
            if r.status_code == 200:
                add(((r.json() or {}).get("openAccessPdf") or {}).get("url"), "Semantic Scholar")
        except (MetadataError, ValueError):
            pass
        if core_key:
            try:
                r = requests.get("https://api.core.ac.uk/v3/search/works", params={"q": f'doi:"{doi}"', "limit": 5},
                                 headers={"Authorization": f"Bearer {core_key}"}, timeout=20)
                if r.status_code == 200:
                    for res in r.json().get("results", []):
                        add(res.get("downloadUrl"), "CORE (university repositories)")
            except (requests.exceptions.RequestException, ValueError):
                pass
        try:
            r = http_get("https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                         params={"query": f'DOI:"{doi}"', "format": "json", "resultType": "lite"})
            if r.status_code == 200:
                for res in r.json().get("resultList", {}).get("result", []):
                    if res.get("pmcid") and res.get("isOpenAccess") == "Y":
                        add(f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={res['pmcid']}&blobtype=pdf",
                            "Europe PMC")
        except (MetadataError, ValueError):
            pass
        add(f"https://doi.org/{doi}", "publisher website")
    elif paper.get("url"):
        add(paper["url"], "article page")
    return cands


def _looks_like_pdf(data: bytes) -> bool:
    return b"%PDF-" in data[:1024]


def fetch_pdf(url: str, depth: int = 0):
    """Return (bytes, None) on success or (None, reason)."""
    try:
        r = requests.get(url, headers=BROWSER_HEADERS, timeout=60, allow_redirects=True, stream=True)
    except requests.exceptions.RequestException as exc:
        return None, f"connection failed ({exc.__class__.__name__})"
    with r:
        if r.status_code >= 400:
            return None, f"HTTP {r.status_code}"
        final_url, encoding = r.url, r.encoding
        chunks, size = [], 0
        for chunk in r.iter_content(65536):
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_PDF_BYTES:
                return None, "file too large"
            if size > 3_000_000 and not _looks_like_pdf(chunks[0]):
                break  # a huge HTML page: no need to read it all
        data = b"".join(chunks)
    if _looks_like_pdf(data):
        return data, None
    if depth == 0 and b"<" in data[:4000]:
        page = parse_meta(data.decode(encoding or "utf-8", errors="replace"))
        link = (page.meta.get("citation_pdf_url") or [""])[0]
        if link:
            return fetch_pdf(urljoin(final_url, link), depth + 1)
        return None, "page has no downloadable PDF (probably paywalled)"
    return None, "not a PDF (probably paywalled)"


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def pdf_filename(paper: dict) -> str:
    authors = paper.get("authors") or []
    fam = authors[0].get("family", "") if authors else ""
    year = str(paper.get("year") or "nd")
    words = re.findall(r"[A-Za-z0-9]+", _ascii(paper.get("title") or "paper"))[:6]
    name = "_".join(x for x in (_ascii(fam).replace(" ", ""), year, "_".join(words)) if x)
    name = re.sub(r"[^A-Za-z0-9_\-]+", "", name)[:120] or "paper"
    return name + ".pdf"


def save_pdf(data: bytes, paper: dict, folder) -> Path:
    folder = Path(folder).expanduser()
    folder.mkdir(parents=True, exist_ok=True)
    name = pdf_filename(paper)
    path = folder / name
    i = 2
    while path.exists():
        path = folder / f"{name[:-4]}_{i}.pdf"
        i += 1
    path.write_bytes(data)
    return path


def find_and_download(paper: dict, folder, email: str = "", core_key: str = "") -> dict:
    tried = []
    for url, source in candidate_urls(paper, email, core_key):
        data, err = fetch_pdf(url)
        if data:
            path = save_pdf(data, paper, folder)
            return {"path": str(path), "source": source, "url": url, "tried": tried}
        tried.append({"source": source, "url": url, "error": err})
    raise PdfNotFound(tried)
