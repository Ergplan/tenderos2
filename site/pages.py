"""Renders the tender pages the demo site shows and finds each quoted passage on its page.

    python3 site/pages.py REQUESTS.json OUT_DIR RECTS.json

REQUESTS.json: [{"id", "file" (PDF path), "page" (1-based PDF page), "quote", "kind": was|now|value}].
Writes OUT_DIR/<doc>-p<page>.webp (one image per page used) and RECTS.json:
{"pages": {"<doc>-p<page>": {"w", "h", "src"}}, "marks": {"<id>": [{"page", "kind", "rects": [[x, y, w, h] as
fractions of the page]}]}}. A quote is located by its letters and digits only, so line breaks,
hyphens and spacing in the PDF do not matter; a quote not found on its page is reported and fails
the run (the site never shows a highlight it cannot place).
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

WIDTH = 1000  # px
norm = lambda s: re.sub(r"[^0-9a-z]", "", s.lower().replace("ﬁ", "fi").replace("ﬂ", "fl"))


def locate(page, quote):
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
    text, owner = [], []
    for k, w in enumerate(words):
        for ch in norm(w[4]):
            text.append(ch)
            owner.append(k)
    hay = "".join(text)
    needle = norm(quote)
    at = hay.find(needle)
    if at < 0 or not needle:
        return None
    hit = sorted(set(owner[at:at + len(needle)]))
    lines = {}
    for k in hit:
        x0, y0, x1, y1, _, block, line, _ = words[k]
        key = (block, line, round(y0))
        cur = lines.get(key)
        lines[key] = [min(cur[0], x0), min(cur[1], y0), max(cur[2], x1), max(cur[3], y1)] if cur else [x0, y0, x1, y1]
    W, H = page.rect.width, page.rect.height
    return [[round(x0 / W, 4), round(y0 / H, 4), round((x1 - x0) / W, 4), round((y1 - y0) / H, 4)] for x0, y0, x1, y1 in sorted(lines.values(), key=lambda r: (r[1], r[0]))]


def main():
    requests = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    pages, marks, missing, docs = {}, {}, [], {}
    for r in requests:
        doc = docs.setdefault(r["file"], pymupdf.open(r["file"]))
        key = f"{Path(r['file']).stem.lower()}-p{r['page']}"
        page = doc[r["page"] - 1]
        if key not in pages:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(WIDTH / page.rect.width, WIDTH / page.rect.width), alpha=False)
            from PIL import Image
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L").convert("RGB")
            img.save(out / f"{key}.webp", "WEBP", quality=42, method=6)
            pages[key] = {"w": pix.width, "h": pix.height, "src": f"/pages/{key}.webp"}
        rects = locate(page, r["quote"])
        if rects is None:
            missing.append(f"{r['id']} ({r['kind']}) on {key}")
            continue
        marks.setdefault(r["id"], []).append({"page": key, "kind": r["kind"], "rects": rects})
    Path(sys.argv[3]).write_text(json.dumps({"pages": pages, "marks": marks}, separators=(",", ":")))
    print(f"pages: {len(pages)} page images, {sum(len(v) for v in marks.values())} passages located, {len(missing)} not found")
    for m in missing:
        print("  not found:", m)
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
