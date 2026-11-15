"""Step C12b: tables from the runs in experiments/runs/c12b-* (samples.csv, meta.json), printed as markdown.

    python experiments/conditions/c12b/analyse.py [runs folder]
"""
import csv
import glob
import json
import os
import sys

RUNS = sys.argv[1] if len(sys.argv) > 1 else os.path.join("experiments", "runs")


def rows(name):
    p = os.path.join(RUNS, name, "samples.csv")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def at(R, t):
    best = None
    for r in R:
        if best is None or abs(float(r["t"]) - t) < abs(float(best["t"]) - t):
            best = r
    return best


def f(r, k, d=2):
    v = r.get(k, "") if r else ""
    if v in ("", None):
        return "-"
    x = float(v)
    if abs(x) >= 1e5:
        return f"{x / 1e6:.2f} M"
    return f"{x:.{d}f}"


def books(R):
    """The largest |rounding| over a run: atoms, charge, energy (and the energy in at the end)."""
    a = max((abs(float(r.get("matter.rounding") or 0)) for r in R), default=0)
    q = max((abs(float(r.get("charge.qRound") or 0)) for r in R), default=0)
    e = max((abs(float(r.get("heat.rounding") or 0)) for r in R), default=0)
    inn = float(R[-1].get("heat.in") or 0) if R else 0
    return a, q, e, inn


def evals(name):
    p = os.path.join(RUNS, name, "meta.json")
    if not os.path.exists(p):
        return []
    m = json.load(open(p, encoding="utf-8"))
    out = []
    for e in m.get("evals", []):
        r = e.get("result")
        if isinstance(r, str) and r.startswith("{"):
            try:
                out.append((e["t"], json.loads(r)))
            except ValueError:
                pass
    return out


def table(names, times, cols):
    print("| run | t (s) | " + " | ".join(c[0] for c in cols) + " |")
    print("|---|---|" + "---|" * len(cols))
    for n in names:
        R = rows(n)
        if not R:
            continue
        for t in times:
            r = at(R, t)
            print(f"| {n} | {float(r['t']):.0f} | " + " | ".join(f(r, k, d) for _, k, d in cols) + " |")


def main():
    names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(RUNS, "c12b-*")))
    print("## books\n\n| run | sim s | atoms max | charge max | energy max | energy in |\n|---|---|---|---|---|---|")
    for n in names:
        R = rows(n)
        if R:
            a, q, e, inn = books(R)
            print(f"| {n} | {float(R[-1]['t']):.0f} | {a:g} | {q:g} | {e:.3g} | {inn / 1e6:.2f} M |")
    general = [("cells", "alive", 0), ("soap", "lipids.soap", 2), ("oil", "lipids.oil", 2), ("wall", "lipids.wall", 2),
               ("oil gene", "lipids.oilGene", 2), ("wall gene", "lipids.wallGene", 2), ("stiffness", "lipids.stiff", 2),
               ("integrity", "membrane.integ", 2), ("bursts/s", "membrane.rate.bursts", 2), ("ENTROPY", "heat.out", 0),
               ("ORDER", "matter.order", 3)]
    for group in ("default", "heat", "oxygen"):
        sel = [n for n in names if n.startswith(f"c12b-{group}")]
        if not sel:
            continue
        print(f"\n## {group}\n")
        table(sel, [60, 300, 600, 900, 1200], general)
        if group == "heat" or group == "default":
            print()
            table(sel, [60, 300, 600, 900, 1200], [("lit cells", "lipids.lit.n", 0), ("lit T", "lipids.lit.temp", 1),
                                                    ("lit oil gene", "lipids.lit.oil", 3), ("lit k", "lipids.lit.stiff", 2),
                                                    ("dark cells", "lipids.dark.n", 0), ("dark T", "lipids.dark.temp", 1),
                                                    ("dark oil gene", "lipids.dark.oil", 3), ("dark k", "lipids.dark.stiff", 2),
                                                    ("lit wall", "lipids.lit.wall", 3), ("dark wall", "lipids.dark.wall", 3)])
        if group == "oxygen":
            print()
            table(sel, [60, 300, 600, 900, 1200], [("free g", "dish.g", 1), ("free t", "dish.t", 1), ("bitten bilayer/s", "lipids.rate.biteB", 3),
                                                    ("bitten wall/s", "lipids.rate.biteW", 3), ("made/s soap", "lipids.rate.soap", 3),
                                                    ("fused/s", "lipids.rate.fused", 3), ("walled", "lipids.walled", 0),
                                                    ("in-cell swaps/s", "cells.rate.inSwap", 2)])
        for n in sel:
            ev = evals(n)
            if not ev:
                continue
            t, s = ev[-1]
            print(f"\n{n} at {t:.0f} s, founder lineages (cells, oil gene, wall gene, head, soap +/-, oil, crust per cell, stiffness, cover, battery):")
            for g in s.get("founders", [])[:6]:
                print(f"  founder {g['founder']:>3}: {g['n']:5d} cells · oil {g['oilGene']:.2f} wall {g['wallGene']:.2f} head {g['head']:+.2f}"
                      f" · soap {g['soapP']:.3f}/{g['soapM']:.3f} oil {g['oil']:.3f} crust {g['ll'] + g['LL']:.3f}"
                      f" · k {g['stiff']:.2f} cover {g['cover']:.2f} · bat {g['bat']:.2f}")


if __name__ == "__main__":
    main()
