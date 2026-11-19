"""The full text of each tender document, page by page, for the amended-document view.

Reads every PDF under web/public/tenders/<tender>/ and writes web/public/tenders/<tender>/text/<name>.json:
{"file": "RfS.pdf", "pages": ["text of PDF page 1", ...]}. Page i of the list is PDF page i + 1, as the
packs' quotes count pages. The view (web/src/tender/trackChanges.js) finds each amendment's original
text in these pages and shows it struck through with the new text after it.

Run after adding or replacing a tender PDF:
    python3 tools/build_tender_text.py            # every tender
    python3 tools/build_tender_text.py seci-fdre-x
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent / "web" / "public" / "tenders"


# a line that starts a paragraph: a clause number, a list marker, a heading word
START = re.compile(r"^(\d+(\.\d+)*\.?\s|\d+(\.\d+)+\.?$|[A-Za-z]\.\s|\(?[a-z]{1,2}\)|\(?[ivxl]{1,6}[.)]|[•●▪\-–]\s|"
                   r"(ARTICLE|Article|SECTION|Section|FORMAT|Format|ANNEXURE|Annexure|Schedule|SCHEDULE|Note|NOTE)\b)")
# a list marker alone on its line ("xv.", "(a)", "6.1"): its text follows on the next line
MARKER = re.compile(r"^(\(?[a-z]{1,2}\)|\(?[ivxl]{1,6}[.)]|\d+(\.\d+)*\.?|[A-Za-z]\.|[•●▪])$")


def raw_lines(page) -> list[str]:
    return [" ".join(line.split()) for line in page.get_text("text").replace("\r", "").split("\n")]


def running_lines(pages: list[list[str]]) -> set[str]:
    """The header and footer lines: those (page numbers aside) on a third of the pages or more."""
    if len(pages) < 4:
        return set()
    count: dict[str, int] = {}
    for lines in pages:
        for key in {re.sub(r"\d+", "#", line) for line in lines[:6] + lines[-4:] if line}:
            count[key] = count.get(key, 0) + 1
    return {k for k, n in count.items() if n >= len(pages) / 3}


def paragraphs(lines: list[str], running: set[str]) -> str:
    """The page's lines joined into paragraphs, one per line of the result."""
    out: list[str] = []
    for line in lines:
        if not line or re.sub(r"\d+", "#", line) in running:
            continue
        heading = line.isupper() and len(line) < 90
        prev = out[-1] if out else ""
        new = (not out or START.match(line) or heading or prev.isupper()
               or MARKER.match(prev) is None and re.search(r"[.:;]$", prev) and line[:1].isupper())
        if MARKER.match(prev):
            out[-1] = f"{prev} {line}"
        elif new:
            out.append(line)
        else:
            out[-1] = f"{prev[:-1]}{line}" if prev.endswith("-") and line[:1].islower() else f"{prev} {line}"
    return "\n".join(out)


def build(folder: Path) -> list[str]:
    done = []
    out_dir = folder / "text"
    out_dir.mkdir(exist_ok=True)
    for pdf in sorted(folder.glob("*.pdf")):
        with pymupdf.open(pdf) as doc:
            lines = [raw_lines(p) for p in doc]
        running = running_lines(lines)
        pages = [paragraphs(page, running) for page in lines]
        target = out_dir / f"{pdf.stem}.json"
        target.write_text(json.dumps({"file": pdf.name, "pages": pages}, ensure_ascii=False, separators=(",", ":")) + "\n")
        done.append(f"{folder.name}/{target.name}: {len(pages)} pages, {target.stat().st_size // 1024} KB")
    return done


def main(argv: list[str]) -> None:
    folders = [ROOT / name for name in argv] if argv else sorted(p for p in ROOT.iterdir() if p.is_dir())
    for folder in folders:
        if not folder.is_dir():
            raise SystemExit(f"no tender folder {folder}")
        for line in build(folder):
            print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
