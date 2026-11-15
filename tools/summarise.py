"""Summarise experiment runs (tools/experiment.py): a markdown table of chosen columns at chosen times, and line plots.

Python standard library only. Plots are SVG written by hand (matplotlib is not assumed), one per column, every run a line
(runs past 8 are left out of the plot: fewer runs per plot, or --plot one column per call); each has a legend, labels at the
line ends (up to 4 runs), a native hover tooltip on every point, and a dark version for a dark screen.

Usage:
    python tools/summarise.py experiments/runs/default-2min
    python tools/summarise.py "experiments/runs/snap-*" --cols alive,heat.rate.out,matter.order --times 0,60,120
    python tools/summarise.py experiments/runs/a experiments/runs/b --plot heat.rate.out,alive,matter.order \
        --out experiments/summaries/smoke
    python tools/summarise.py experiments/runs/x --list            # every column name in the runs' samples.csv

Columns are the names in samples.csv (moire.sample()). Useful ones:
    alive                 cells alive                  heat.out          ENTROPY (all heat that left the dish)
    heat.rate.out         entropy rate (per s)         heat.heat         heat in the dish
    heat.rounding         energy rounding              matter.order      ORDER (1 = all in one place, 0 = smeared evenly)
    matter.rounding       atoms rounding (0)           charge.qRound     charge rounding (0)
    cells.bat             batteries                    engines.free.g    free light atoms g (oxygen-like?)
    division.rate.births  births per s                 division.deaths   deaths per s
    tissue.clusters, tissue.largest, tissue.contacts, tissue.persistence, tissue.ageMean, tissue.internal, tissue.shape,
    tissue.compactLargest (with "tissue": true)
Times are run times (s since the run's start, the CSV's `trun`); the sample nearest each time is used.
"""

import argparse
import csv
import glob
import html
import json
import math
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_COLS = ["alive", "heat.out", "heat.rate.out", "matter.order", "matter.rounding", "charge.qRound"]
DEFAULT_PLOTS = ["heat.rate.out", "alive", "matter.order"]
# the reference categorical palette (fixed order, light and dark steps), validated for colour-vision deficiency
SERIES = [("#2a78d6", "#3987e5"), ("#eb6834", "#d95926"), ("#1baf7a", "#199e70"), ("#eda100", "#c98500"),
          ("#e87ba4", "#d55181"), ("#008300", "#008300"), ("#6250d6", "#9085e9"), ("#e34948", "#e66767")]


def load_run(d):
    meta = {}
    mp = os.path.join(d, "meta.json")
    if os.path.exists(mp):
        with open(mp, encoding="utf-8") as f:
            meta = json.load(f)
    rows = []
    cp = os.path.join(d, "samples.csv")
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.append({k: num(v) for k, v in r.items()})
    return {"dir": d, "name": meta.get("name", os.path.basename(d.rstrip("/\\"))), "meta": meta, "rows": rows}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def at(rows, t, col):
    best = None
    for r in rows:
        if r.get("trun") is None:
            continue
        if best is None or abs(r["trun"] - t) < abs(best["trun"] - t):
            best = r
    return None if best is None else best.get(col)


def fmt(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    a = abs(x)
    if a == 0:
        return "0"
    if a >= 1e6:
        return f"{x / 1e6:.3g} M"
    if a >= 1e4:
        return f"{x / 1e3:.3g} k"
    if a >= 100:
        return f"{x:.0f}"
    if a >= 1:
        return f"{x:.3g}"
    return f"{x:.2g}"


def table(runs, cols, times):
    head = ["run", "status", "seed"] + [f"{c} @ {t:g} s" for c in cols for t in times]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in runs:
        seed = r["meta"].get("condition", {}).get("query", {}).get("seed", "")
        cells = [r["name"], r["meta"].get("status", "?"), str(seed)]
        cells += [fmt(at(r["rows"], t, c)) for c in cols for t in times]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def nice_ticks(lo, hi, n=5):
    if hi <= lo:
        hi = lo + 1
    span = hi - lo
    step = 10 ** math.floor(math.log10(span / n))
    for m in (1, 2, 2.5, 5, 10):
        if span / (step * m) <= n:
            step *= m
            break
    start = math.floor(lo / step) * step
    ticks, v = [], start
    while not ticks or ticks[-1] < hi - 1e-12:
        ticks.append(round(v, 10))
        v += step
    return ticks


def svg_plot(runs, col, path):
    runs = [r for r in runs if any(x.get(col) is not None for x in r["rows"])][:8]
    if not runs:
        return False
    W, H, L, R, T, B = 760, 380, 64, 150, 48, 44
    pts = [[(x["trun"], x[col]) for x in r["rows"] if x.get(col) is not None and x.get("trun") is not None] for r in runs]
    xs = [p[0] for s in pts for p in s]
    ys = [p[1] for s in pts for p in s]
    xt = nice_ticks(min(xs), max(xs))
    y0, y1 = min(ys), max(ys)
    if y0 > 0 and y0 < 0.25 * y1:
        y0 = 0
    yt = nice_ticks(y0, y1)
    xa, xb, ya, yb = xt[0], xt[-1], yt[0], yt[-1]
    px = lambda x: L + (x - xa) / (xb - xa or 1) * (W - L - R)  # noqa: E731
    py = lambda y: H - B - (y - ya) / (yb - ya or 1) * (H - T - B)  # noqa: E731
    css = [":root{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e4e3df}"]
    css += [f".s{k}{{stroke:{c[0]};fill:{c[0]}}}" for k, c in enumerate(SERIES)]
    css.append("@media (prefers-color-scheme: dark){:root{--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#383835}"
               + "".join(f".s{k}{{stroke:{c[1]};fill:{c[1]}}}" for k, c in enumerate(SERIES)) + "}")
    css.append("text{font:12px system-ui,-apple-system,'Segoe UI',sans-serif;fill:var(--ink2)}"
               ".title{font-size:14px;font-weight:600;fill:var(--ink)}.line{fill:none;stroke-width:2;stroke-linejoin:round}"
               ".pt{stroke:var(--surface);stroke-width:2}.grid{stroke:var(--grid);stroke-width:1}"
               ".hit{fill:transparent;stroke:none}.lab{fill:var(--ink)}")
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
           f'aria-label="{html.escape(col)} against run time">',
           f"<style>{''.join(css)}</style>", f'<rect width="{W}" height="{H}" fill="var(--surface)"/>',
           f'<text class="title" x="{L}" y="22">{html.escape(col)}</text>',
           f'<text x="{L}" y="38">against run time (s); one line per run</text>']
    for y in yt:
        out.append(f'<line class="grid" x1="{L}" x2="{W - R}" y1="{py(y):.1f}" y2="{py(y):.1f}"/>')
        out.append(f'<text x="{L - 8}" y="{py(y) + 4:.1f}" text-anchor="end">{fmt(y)}</text>')
    for x in xt:
        out.append(f'<text x="{px(x):.1f}" y="{H - B + 18}" text-anchor="middle">{fmt(x)}</text>')
    out.append(f'<text x="{(L + W - R) / 2:.0f}" y="{H - 8}" text-anchor="middle">run time (s)</text>')
    ends = []
    for k, (r, s) in enumerate(zip(runs, pts)):
        if not s:
            continue
        d = " ".join(f"{'M' if i == 0 else 'L'}{px(x):.1f},{py(y):.1f}" for i, (x, y) in enumerate(s))
        out.append(f'<path class="line s{k}" d="{d}"/>')
        for x, y in s:
            tip = html.escape(f"{r['name']}: {col} {fmt(y)} at {x:g} s")
            out.append(f'<g><circle class="hit" cx="{px(x):.1f}" cy="{py(y):.1f}" r="8"><title>{tip}</title></circle>'
                       f'<circle class="pt s{k}" cx="{px(x):.1f}" cy="{py(y):.1f}" r="3"><title>{tip}</title></circle></g>')
        ends.append([py(s[-1][1]), k, r["name"]])
    # direct labels at the line ends (up to 4 runs), pushed apart so they do not overlap
    if len(ends) <= 4:
        ends.sort()
        for i in range(1, len(ends)):
            ends[i][0] = max(ends[i][0], ends[i - 1][0] + 15)
        for y, k, nm in ends:
            out.append(f'<text class="lab" x="{W - R + 8}" y="{y + 4:.1f}">{html.escape(nm[:22])}</text>')
    # legend (always, for 2 runs or more)
    if len(runs) >= 2:
        lx, ly = L + 260, 14
        for k, r in enumerate(runs):
            cx, cy = lx + (k % 3) * 150, ly + (k // 3) * 16
            out.append(f'<line class="line s{k}" x1="{cx}" x2="{cx + 16}" y1="{cy}" y2="{cy}"/>'
                       f'<text x="{cx + 22}" y="{cy + 4}">{html.escape(r["name"][:18])}</text>')
    out.append("</svg>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", help="run folders (globs allowed)")
    ap.add_argument("--cols", default=",".join(DEFAULT_COLS), help="columns for the table")
    ap.add_argument("--times", default="", help="run times (s) for the table (default: start, middle, end)")
    ap.add_argument("--plot", default=",".join(DEFAULT_PLOTS), help="columns to plot ('' = none)")
    ap.add_argument("--out", default="", help="folder for summary.md and the plots (default: print the table only)")
    ap.add_argument("--list", action="store_true", help="list the columns and stop")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    dirs = []
    for p in args.runs:
        dirs += sorted(g for g in glob.glob(p) if os.path.isdir(g)) or ([p] if os.path.isdir(p) else [])
    runs = [load_run(d) for d in dirs]
    if not runs:
        sys.exit("no run folders found")
    if args.list:
        cols = []
        for r in runs:
            for k in (r["rows"][0].keys() if r["rows"] else []):
                if k not in cols:
                    cols.append(k)
        print("\n".join(cols))
        return
    cols = [c for c in args.cols.split(",") if c]
    if args.times:
        times = [float(t) for t in args.times.split(",")]
    else:
        end = max((x["trun"] for r in runs for x in r["rows"] if x.get("trun") is not None), default=0)
        times = [0, round(end / 2, 1), end]
    md = table(runs, cols, times)
    print(md)
    if args.out:
        out = args.out if os.path.isabs(args.out) else os.path.join(REPO, args.out)
        os.makedirs(out, exist_ok=True)
        plots = []
        for c in (c for c in args.plot.split(",") if c):
            fn = "plot_" + "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in c) + ".svg"
            if svg_plot(runs, c, os.path.join(out, fn)):
                plots.append((c, fn))
        lines = ["# Experiment summary", "", "Runs: " + ", ".join(f"`{os.path.relpath(r['dir'], REPO)}`" for r in runs), "",
                 md, ""]
        for r in runs:
            m = r["meta"]
            lines.append(f"- {r['name']}: {m.get('status', '?')}, {m.get('sim_s', '?')} sim s in {m.get('wall_s', '?')} wall s "
                         f"(x{m.get('speed_reached')}), {m.get('browser', '')} {m.get('adapter', '')}, commit "
                         f"{str(m.get('commit', ''))[:9]}{' (dirty)' if m.get('dirty') else ''}"
                         + (f", error: {m['error']}" if m.get("error") else ""))
        lines.append("")
        for c, fn in plots:
            lines += [f"![{c}]({fn})", ""]
        with open(os.path.join(out, "summary.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"\nwrote {os.path.join(out, 'summary.md')} and {len(plots)} plot(s)")


if __name__ == "__main__":
    main()
