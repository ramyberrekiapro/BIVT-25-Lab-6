#!/usr/bin/env python3
"""Build the folder/ZIP the owner uploads in the Cloudflare dashboard (no Terminal needed there).

Dashboard drag-and-drop uploads do not compile a functions/ folder, so this compiles
functions/ (+ lib/) into a single _worker.js ("advanced mode") and puts it next to the site
files. Result:
  upload/                       site files + _worker.js, flat
  ../lopez-menu-upload.zip      the same, zipped (index.html at the top level)

Run from the lopez-site folder:  python3 tools/make_upload.py
Needs Node.js (npx) for wrangler and Python 3.
"""
import os, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(HERE, "upload")
ZIP = os.path.join(HERE, "..", "lopez-menu-upload.zip")


def compile_worker():
    tmp = tempfile.mkdtemp()
    raw = os.path.join(tmp, "_worker.js")
    subprocess.run(["npx", "-y", "wrangler@4", "pages", "functions", "build", "functions", "--outfile", raw],
                   cwd=HERE, check=True, stdout=subprocess.DEVNULL)
    s = open(raw, encoding="utf-8").read()
    if s.startswith("--"):  # wrangler wrote an upload form: take the JavaScript module out of it
        boundary = s.split("\n", 1)[0].strip()
        part = [p for p in s.split(boundary) if "application/javascript+module" in p]
        if len(part) != 1:
            sys.exit("unexpected wrangler output")
        sep = "\r\n\r\n" if "\r\n\r\n" in part[0] else "\n\n"
        s = part[0].split(sep, 1)[1].rstrip("-\r\n ")
    shutil.rmtree(tmp)
    return s + "\n"


def main():
    worker = compile_worker()
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(os.path.join(HERE, "public"), OUT)
    open(os.path.join(OUT, "_worker.js"), "w", encoding="utf-8").write(worker)
    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(OUT):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, OUT))
    n = sum(len(f) for _, _, f in os.walk(OUT))
    print("upload/: %d files | %s: %.1f MB" % (n, os.path.basename(ZIP), os.path.getsize(ZIP) / 1e6))


if __name__ == "__main__":
    main()
