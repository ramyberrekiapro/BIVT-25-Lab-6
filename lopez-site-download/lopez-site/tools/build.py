#!/usr/bin/env python3
"""Prepare public/ for publishing.

1. Moves photos embedded in public/index.html (data: URIs) into public/img/<item-id>.jpg,
   resized and compressed, so the page loads each photo only when it is needed.
2. Writes public/menu-data.json: every section and item with its default French and
   English text, price and photo. The owner's page (/admin/) uses it as the starting
   point for edits.

Run from the lopez-site folder:  python3 tools/build.py
Needs Pillow (pip install pillow). Safe to run again; already extracted photos are kept.
"""
import base64, io, json, os, re, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
INDEX = os.path.join(ROOT, "index.html")
IMG_DIR = os.path.join(ROOT, "img")
MAX_W = 720          # px; cards show ~340 px on a 2x phone, the detail window ~420-900 px
QUALITY = 80


def text(html_fragment):
    t = re.sub(r"<[^>]+>", "", html_fragment)
    return (t.replace("&nbsp;", "").replace("&amp;", "&").replace("&lt;", "<")
             .replace("&gt;", ">").replace("&#39;", "'").replace("&quot;", '"').strip())


def main():
    s = open(INDEX, encoding="utf-8").read()
    os.makedirs(IMG_DIR, exist_ok=True)

    # 1. extract embedded photos
    extracted = 0
    def repl(m):
        nonlocal extracted
        item_id, b64 = m.group(1), m.group(2)
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        im.save(os.path.join(IMG_DIR, item_id + ".jpg"), quality=QUALITY, optimize=True, progressive=True)
        extracted += 1
        return m.group(0).replace("data:image/jpeg;base64," + b64, "img/%s.jpg" % item_id)
    s = re.sub(r'<article class="card" data-id="([^"]+)">\s*<div class="ph"><img src="data:image/jpeg;base64,([^"]+)"',
               repl, s)
    open(INDEX, "w", encoding="utf-8").write(s)

    # 2. menu-data.json
    en = json.loads(re.search(r"  var EN = (\{.*?\});\n", s).group(1))
    sections, items = [], []
    for sm in re.finditer(r'<section class="cat" id="([^"]+)">\s*<h2>([^<]+)</h2>(.*?)</section>', s, re.S):
        sec_id, title, body = sm.group(1), sm.group(2), sm.group(3)
        if sec_id == "contact":
            continue
        sections.append({"id": sec_id, "title_fr": title, "title_en": en["sections"].get(sec_id, title)})
        for cm in re.finditer(r'<article class="card" data-id="([^"]+)">(.*?)</article>', body, re.S):
            cid, card = cm.group(1), cm.group(2)
            img = re.search(r'<img src="([^"]+)"', card)
            name_fr = text(re.search(r"<h3>(.*?)</h3>", card, re.S).group(1))
            desc_fr = text(re.search(r'<p class="desc">(.*?)</p>', card, re.S).group(1))
            e = en["items"].get(cid, {})
            items.append({
                "id": cid, "section": sec_id,
                "name_fr": name_fr, "name_en": e.get("name", name_fr),
                "desc_fr": desc_fr, "desc_en": e.get("desc", desc_fr),
                "price": text(re.search(r'<span class="price">(.*?)</span>', card, re.S).group(1)),
                "img": img.group(1) if img else None,
            })
    json.dump({"sections": sections, "items": items},
              open(os.path.join(ROOT, "menu-data.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    size = os.path.getsize(INDEX)
    imgs = sum(os.path.getsize(os.path.join(IMG_DIR, f)) for f in os.listdir(IMG_DIR))
    print("photos extracted: %d | index.html: %.0f KB | img/: %d files, %.0f KB | items: %d in %d sections"
          % (extracted, size / 1024, len(os.listdir(IMG_DIR)), imgs / 1024, len(items), len(sections)))


if __name__ == "__main__":
    sys.exit(main())
