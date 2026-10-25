# Third-party software and data services

## Bundled with PaperShelf

| Component | Where | Licence |
|---|---|---|
| [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Mozilla) | `static/vendor/pdfjs/` | Apache License 2.0 – full text in `static/vendor/pdfjs/LICENSE` |

## Installed automatically from PyPI (not included in this repository)

| Package | Licence |
|---|---|
| [Flask](https://flask.palletsprojects.com/) (and Werkzeug, Jinja2, …) | BSD-3-Clause |
| [Requests](https://requests.readthedocs.io/) | Apache-2.0 |
| [pypdf](https://github.com/py-pdf/pypdf) | BSD-3-Clause |
| [Send2Trash](https://github.com/arsenetar/send2trash) | BSD-3-Clause |

## Online services used (only when you use the related feature)

PaperShelf talks to these services through their public, documented interfaces. Their data stays
subject to their own terms; please cite them when you publish data obtained from them.

| Service | Used for | Terms / licence of the data |
|---|---|---|
| [Crossref](https://www.crossref.org/) | paper details from DOIs | metadata mostly CC0 |
| [OpenAlex](https://openalex.org/) | citations, suggestions, researcher metrics, journal citedness | CC0 |
| [ORCID](https://orcid.org/) public API | researcher profiles | ORCID public data, CC0 |
| [arXiv](https://arxiv.org/) API | preprint details and PDFs | arXiv API terms of use |
| [NCBI PubMed E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25497/) | details, equal-contribution flags | NCBI usage policy |
| [Europe PMC](https://europepmc.org/) | open-access PDFs | Europe PMC terms |
| [Unpaywall](https://unpaywall.org/) (optional) | legal free PDFs | Unpaywall data, CC0 |
| [Semantic Scholar](https://www.semanticscholar.org/) API | legal free PDFs | Semantic Scholar API licence |
| [CORE](https://core.ac.uk/) (optional key) | repository copies of papers | CORE terms |
| [Wikidata / Wikimedia Commons](https://www.wikidata.org/) | researcher photos | CC0 data; photos under their own Commons licence |
| [SCImago Journal & Country Rank](https://www.scimagojr.com/) | journal quartile, SJR, citations/doc (Scopus data) | tables downloaded by the user from scimagojr.com; cite SCImago when you use them |
| [GitHub](https://github.com/) | your optional private library sync; checking for app updates | GitHub terms of service |

PaperShelf never uses unofficial "shadow libraries" and does not query Google Scholar automatically.
"Impact factor" values marked with * are estimates from SCImago/Scopus data, not Clarivate's
Journal Impact Factor™, unless you entered the official value yourself.
