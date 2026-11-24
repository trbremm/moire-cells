"""Step M2: side-by-side pictures of the sweep's dishes (one row per time, one column per setting), saved as PNG.

    python tools/m2_montage.py def3 marker           # experiments/keep/m2/def3-marker.png (lineage view)
    python tools/m2_montage.py def3 neon             # ... the neon view
    python tools/m2_montage.py def3 marker --twin null

Writes a small HTML page next to the PNG (experiments/keep/m2/_montage.html) and shoots it with tools/shot.py (Chrome, headless).
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "..")
KEEP = os.path.join(REPO, "experiments", "keep", "m2")
SETTINGS = [("x0", "×0 exact copies"), ("x03", "×0.3"), ("x1", "×1 (today)"), ("x3", "×3"), ("rare", "rare big steps p 0.1")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scene")
    ap.add_argument("view", choices=["marker", "neon"])
    ap.add_argument("--twin", default="on")
    ap.add_argument("--times", default="240,600,1200")
    ap.add_argument("--settings", default="")
    a = ap.parse_args()
    os.makedirs(KEEP, exist_ok=True)
    times = [int(t) for t in a.times.split(",")]
    sets = [s for s in SETTINGS if not a.settings or s[0] in a.settings.split(",")]
    W, Wc = 360, 360 * 800 // 1280
    rows = []
    for t in times:
        cells = []
        for key, label in sets:
            run = f"m2-sw-{a.scene}-{key}-{a.twin}"
            fn = f"t{t}-marker.png" if a.view == "marker" else f"t{t}.png"
            p = os.path.join(REPO, "experiments", "runs", run, "shots", fn)
            src = f"../../runs/{run}/shots/{fn}"
            img = f'<img src="{src}">' if os.path.exists(p) else '<div class="none">not run</div>'
            cells.append(f'<td>{img}<div class="lab">{label} · {t // 60} min</div></td>')
        rows.append("<tr>" + "".join(cells) + "</tr>")
    title = f"{a.scene} · {'lineage (self marker) view' if a.view == 'marker' else 'neon view'} · {a.twin}"
    html = f"""<!doctype html><meta charset="utf-8"><title>M2 montage</title>
<style>body{{margin:0;background:#000;color:#ccc;font:13px system-ui}} h1{{font-size:14px;font-weight:500;margin:6px 8px}}
table{{border-collapse:collapse}} td{{padding:2px;vertical-align:top}} img{{width:{W}px;height:{Wc}px;display:block}}
.none{{width:{W}px;height:{Wc}px;background:#111}} .lab{{padding:2px 4px}}</style>
<h1>{title}</h1><table>{''.join(rows)}</table>"""
    hp = os.path.join(KEEP, "_montage.html")
    open(hp, "w", encoding="utf-8").write(html)
    out = os.path.join("experiments", "keep", "m2", f"{a.scene}-{a.view}{'' if a.twin == 'on' else '-' + a.twin}.png")
    w = len(sets) * (W + 4) + 4
    h = 30 + len(times) * (Wc + 24)
    subprocess.run([sys.executable, os.path.join(HERE, "shot.py"), "--page", "experiments/keep/m2/_montage.html", "--query", "",
                    "--size", f"{w}x{h}", "--wait", "1500", "--out", out, "--quiet"], check=True, cwd=REPO)
    os.remove(hp)
    print(out)


if __name__ == "__main__":
    main()
