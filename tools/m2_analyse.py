"""Step M2: summarise the mutation sweep (experiments/runs/m2-sw-*): counts, generations, lineages, genes vs their neutral-control twins.

    python tools/m2_analyse.py                 # tables to stdout (markdown)
    python tools/m2_analyse.py --json out.json # and every number as JSON

Run names: m2-sw-<scene>-<setting>-<on|null> (tools/m2_sweep.py). A gene's SHIFT = its dish mean at 20 min minus the founders' (the
MUTATION census's first read-back). A gene 'beats its null' in a scene when |shift on| > |shift null| AND the on shift points the same way
in both default seeds (only counted where both exist). Runs vary 2-3x: read everything here as hints unless it repeats.
"""
import argparse
import csv
import glob
import json
import os
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "..", "experiments", "runs")
SETTINGS = ["x0", "x03", "x1", "x3", "rare", "rare3", "rarehl"]
SCENES = ["def3", "def7", "isl7", "col3"]
# the genes with a neutral control (mutation.js TRACKED), and a natural size to read a shift against (their range)
GENES = {"glue": 1.0, "elongation": 1.39, "flagellum": 1.0, "cilia": 1.0, "ciliaCouple": 2.0, "chemo": 4.5, "fidelity": 5.0,
         "engulf": 1.0, "kinSpare": 1.0, "kinChan": 1.0, "gateGlue": 2.0, "gatePump": 2.0, "gateEngine": 2.0, "gateDiv": 2.0,
         "gateTurn": 2.0, "copies": 2.0}
OTHER = ["size", "motility", "push", "ionChan", "stretchChan", "stretchTol", "stiffness", "thickness", "wall", "tolerance",
         "permeability", "engines", "grnLinks", "display"]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load(name):
    p = os.path.join(RUNS, name, "samples.csv")
    if not os.path.exists(p):
        return None
    rows = list(csv.DictReader(open(p, encoding="utf-8")))
    if not rows:
        return None
    meta = {}
    mp = os.path.join(RUNS, name, "meta.json")
    if os.path.exists(mp):
        meta = json.load(open(mp, encoding="utf-8"))
    return rows, meta


def at(rows, t, key):
    best, bd = None, 1e9
    for r in rows:
        tt = num(r.get("t"))
        if tt is None:
            continue
        if abs(tt - t) < bd:
            bd, best = abs(tt - t), r
    return num(best.get(key)) if best else None


def summary(rows, meta):
    s = {"status": meta.get("status"), "sim": num(rows[-1].get("t")), "speed": meta.get("speed_reached")}
    for t in (120, 240, 300, 600, 900, 1200):
        s[f"n{t}"] = at(rows, t, "alive")
    for t in (240, 600, 1200):
        s[f"lines{t}"] = at(rows, t, "mut.lines")
        s[f"eff{t}"] = at(rows, t, "mut.linesEff")
        s[f"mark{t}"] = at(rows, t, "mut.marker.eff")
        s[f"geno{t}"] = at(rows, t, "mut.genotypes")
        s[f"clone{t}"] = at(rows, t, "mut.cloneTop")
        s[f"gen{t}"] = at(rows, t, "mut.gen.mean")
        s[f"genmax{t}"] = at(rows, t, "mut.gen.max")
    b = [num(r.get("mut.rates.birthsPerS")) for r in rows]
    b = [x for x in b if x is not None]
    s["births"] = statistics.mean(b) if b else None
    m = [num(r.get("mut.rates.mutShare")) for r in rows]
    m = [x for x in m if x is not None]
    s["mutShare"] = statistics.mean(m) if m else None
    s["shift"] = {g: at(rows, 1200, f"mut.shift.{g}") for g in list(GENES) + OTHER}
    s["sd"] = {g: at(rows, 1200, f"mut.genes.{g}.sd") for g in list(GENES) + OTHER}
    s["mean"] = {g: at(rows, 1200, f"mut.genes.{g}.mean") for g in list(GENES) + OTHER}
    return s


def f(x, d=0):
    if x is None:
        return "-"
    return f"{x:.{d}f}"


def main():
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    D = {}
    for p in sorted(glob.glob(os.path.join(RUNS, "m2-sw-*"))):
        name = os.path.basename(p)
        parts = name.split("-")
        if len(parts) != 5:
            continue
        L = load(name)
        if not L:
            continue
        D[name] = summary(*L)
        D[name].update(scene=parts[2], setting=parts[3], twin=parts[4])

    def get(sc, st, tw):
        return D.get(f"m2-sw-{sc}-{st}-{tw}")

    print("## Counts, generations, lineages (ON runs)\n")
    print("| scene | setting | cells 2/4/10/20 min | births/s | mutated | generation mean (max) 20 min | founder lines 4 -> 20 min (effective) | marker patches 4 -> 20 | genotypes 20 (largest clone) |")
    print("|---|---|---|---|---|---|---|---|---|")
    for sc in SCENES:
        for st in SETTINGS:
            s = get(sc, st, "on")
            if not s:
                continue
            print(f"| {sc} | {st} | {f(s['n120'])} / {f(s['n240'])} / {f(s['n600'])} / {f(s['n1200'])} | {f(s['births'], 2)} | {f(100 * s['mutShare'] if s['mutShare'] is not None else None)}% |"
                  f" {f(s['gen1200'], 1)} ({f(s['genmax1200'])}) | {f(s['lines240'])} ({f(s['eff240'], 1)}) -> {f(s['lines1200'])} ({f(s['eff1200'], 1)}) |"
                  f" {f(s['mark240'], 1)} -> {f(s['mark1200'], 1)} | {f(s['geno1200'])} ({f(100 * s['clone1200'] if s['clone1200'] is not None else None)}%) |")

    print("\n## Genes vs their neutral-control twin (shift from the founders at 20 min, on / null)\n")
    wins = {st: [0, 0] for st in SETTINGS}
    ratios = {st: [] for st in SETTINGS}
    for sc in SCENES:
        for st in SETTINGS:
            on, nu = get(sc, st, "on"), get(sc, st, "null")
            if not on or not nu:
                continue
            cells = []
            for g, rng in GENES.items():
                a_, b_ = on["shift"].get(g), nu["shift"].get(g)
                if a_ is None or b_ is None:
                    continue
                if abs(a_) < 1e-6 and abs(b_) < 1e-6:
                    continue
                w = abs(a_) > abs(b_)
                wins[st][0] += 1 if w else 0
                wins[st][1] += 1
                ratios[st].append((abs(a_) + 1e-4 * rng) / (abs(b_) + 1e-4 * rng))
                cells.append(f"{g} {a_:+.3f}/{b_:+.3f}{'*' if w else ''}")
            print(f"- {sc} {st}: " + " · ".join(cells))
    print("\n## Per setting: genes whose ON shift is larger than the NULL's (all scenes; * above)\n")
    print("| setting | on > null | median |on|/|null| |")
    print("|---|---|---|")
    for st in SETTINGS:
        w, n = wins[st]
        if n:
            print(f"| {st} | {w}/{n} | {statistics.median(ratios[st]):.2f} |")

    print("\n## Same direction in both default seeds (ON), shift beyond both nulls\n")
    for st in SETTINGS:
        a3, a7, n3, n7 = get("def3", st, "on"), get("def7", st, "on"), get("def3", st, "null"), get("def7", st, "null")
        if not (a3 and a7):
            continue
        hits = []
        for g, rng in GENES.items():
            x, y = a3["shift"].get(g), a7["shift"].get(g)
            if x is None or y is None or x * y <= 0:
                continue
            nmax = max(abs(n3["shift"].get(g) or 0) if n3 else 0, abs(n7["shift"].get(g) or 0) if n7 else 0)
            if min(abs(x), abs(y)) > nmax and (n3 or n7):
                hits.append(f"{g} {x:+.3f}/{y:+.3f} (nulls up to {nmax:.3f})")
        print(f"- {st}: " + (" · ".join(hits) if hits else "none"))

    if a.json:
        json.dump(D, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
