"""Step P3: summarise the evolution runs (experiments/runs/p3-evo-*): the senses' and predators' census at each eval time.

Usage: python tools/p3_analyse.py [--runs experiments/runs] [--prefix p3-evo-] [--json out.json]

Prints one markdown table per measure (rows = scene and seed, columns = variants on / null / noclump at 600 and 1200 s).
"""

import argparse
import glob
import json
import os
import re


def load(run):
    try:
        m = json.load(open(os.path.join(run, "meta.json"), encoding="utf-8"))
    except Exception:
        return None
    out = {}
    for e in m.get("evals", []) or []:
        r = e.get("result")
        if not isinstance(r, str) or not r.startswith("{"):
            continue
        try:
            d = json.loads(r)
        except Exception:
            continue
        t = round(d.get("t", e.get("t", 0)) / 30) * 30
        out[t] = d
    return {"status": m.get("status"), "evals": out}


def get(d, path):
    for k in path.split("."):
        if d is None:
            return None
        if isinstance(d, list):
            try:
                d = d[int(k)]
            except Exception:
                return None
        else:
            d = d.get(k)
    return d


MEASURES = [
    ("cells", "senses.n"),
    ("oxygen dial", "senses.dials.0.mean"),
    ("exhaust dial", "senses.dials.1.mean"),
    ("spill dial", "senses.dials.2.mean"),
    ("heat dial", "senses.dials.3.mean"),
    ("range", "senses.range.mean"),
    ("|dial| sd oxygen", "senses.dials.0.sd"),
    ("predators' oxygen dial", "senses.dials.0.pred"),
    ("predators' exhaust dial", "senses.dials.1.pred"),
    ("predators' heat dial", "senses.dials.3.pred"),
    ("taste path cos", "senses.taste.alignPath"),
    ("nose path cos", "senses.nose.alignPath"),
    ("predators (engulf>=.25)", "senses.carriers"),
    ("pred closing R/s", "senses.chase.close"),
    ("others closing R/s", "senses.chase.baseClose"),
    ("pred chasing share", "senses.chase.chaseShare"),
    ("prey opening R/s", "senses.prey.open"),
    ("meals/s", "pred.rate.meals"),
    ("meals total", "pred.total.eaten"),
    ("tug ticks", "pred.total.tug"),
    ("glued of eaten / meal", None),
    ("glued group size", "senses.glued.meanSize"),
    ("in glued 4+", "senses.glued.in4"),
    ("singles (glue)", "senses.glued.single"),
    ("glue gene", "pred.genes.glue"),
    ("armour", "pred.now.armour"),
    ("hold", "pred.now.hold"),
    ("wall exposed", "senses.wall.exposed"),
    ("wall sheltered", "senses.wall.sheltered"),
    ("clusters in 8+", "pred.clusters.in8"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", default=os.path.join("experiments", "runs"))
    ap.add_argument("--prefix", default="p3-evo-")
    ap.add_argument("--times", default="600,1200")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    times = [int(x) for x in a.times.split(",")]
    runs = {}
    for p in sorted(glob.glob(os.path.join(a.runs, a.prefix + "*"))):
        name = os.path.basename(p)
        m = re.match(re.escape(a.prefix) + r"(\w+)-(\w+?)(?:_s(\d+))?$", name)
        if not m:
            continue
        r = load(p)
        if r:
            runs[(m.group(1), m.group(3) or "-", m.group(2))] = r
    scenes = sorted({(k[0], k[1]) for k in runs})
    variants = ["on", "null", "noclump"]
    allout = {}
    for label, path in MEASURES:
        rows = []
        for sc, seed in scenes:
            cells = []
            for v in variants:
                r = runs.get((sc, seed, v))
                for t in times:
                    d = r["evals"].get(t) if r else None
                    if path is None and d:
                        e = get(d, "pred.total.eaten") or 0
                        g = get(d, "pred.total.glued")
                        val = (g / e) if e and g is not None else None
                    else:
                        val = get(d, path) if d else None
                    cells.append(val)
                    allout.setdefault(label, {}).setdefault(f"{sc}_s{seed}", {})[f"{v}@{t}"] = val
            rows.append((f"{sc} s{seed}", cells))
        print(f"\n### {label}\n")
        print("| run | " + " | ".join(f"{v} @{t}" for v in variants for t in times) + " |")
        print("|---|" + "---|" * (len(variants) * len(times)))
        for nm, cells in rows:
            def f(x):
                if x is None:
                    return "-"
                if isinstance(x, (int, float)):
                    return f"{x:.3g}"
                return str(x)
            print(f"| {nm} | " + " | ".join(f(x) for x in cells) + " |")
    if a.json:
        json.dump(allout, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
