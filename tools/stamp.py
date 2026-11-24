"""Stamp the JavaScript modules with content hashes, so a browser never mixes cached old modules with new shaders.

Why: the shaders are fetched with cache: 'no-cache' (always fresh), but the JS modules come from the browser's HTTP cache
(GitHub Pages lets them live 10 minutes). Right after a push, a returning visitor could run OLD cells.js against NEW
shaders and get a GPU validation error (seen 2026-11-24: "Binding size 1424 ... less than minimum 1472").

What: writes version.json = {"v": <hash of everything>, "js": {"src/x.js": <hash of x.js>, ...}}. index.html fetches it
with no-cache and builds an import map that points every module at "src/x.js?v=<hash>", so a changed module gets a new URL
(fresh) and an unchanged one stays cached.

Usage (run before every push to main):
    python tools/stamp.py           # write version.json
    python tools/stamp.py --check   # exit 1 if version.json is out of date
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def build():
    js = {}
    for p in sorted((ROOT / 'src').rglob('*.js')):
        rel = p.relative_to(ROOT).as_posix()
        js[rel] = hashlib.sha1(p.read_bytes()).hexdigest()[:10]
    every = hashlib.sha1()
    for p in sorted((ROOT / 'src').rglob('*')):
        if p.is_file() and p.suffix in ('.js', '.wgsl'):
            every.update(p.relative_to(ROOT).as_posix().encode())
            every.update(p.read_bytes())
    return {'v': every.hexdigest()[:10], 'js': js}


def main():
    data = build()
    text = json.dumps(data, indent=1, sort_keys=True) + '\n'
    out = ROOT / 'version.json'
    if '--check' in sys.argv:
        ok = out.exists() and out.read_text(encoding='utf-8') == text
        print('version.json is up to date' if ok else 'version.json is STALE: run python tools/stamp.py')
        sys.exit(0 if ok else 1)
    out.write_text(text, encoding='utf-8', newline='\n')
    print(f'version.json: {len(data["js"])} modules, v {data["v"]}')


if __name__ == '__main__':
    main()
