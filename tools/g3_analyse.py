"""Step G3 (the moire genome): summarise evolution runs, on against their neutral controls.

Reads experiments/runs/<prefix>*/samples.csv (the fold.* columns, moire.folding.census) and meta.json (the evals' full census at
300/600/900/1200 s) and prints, per run, the numbers at the last sample and a few averaged over the last third:
cells, the share in the stress fold, refolds per s (in, back, big at birth), buffer releases per s, the dose, the buffering gene (mean,
spread), hidden drift and hidden links, lattice drift from the founder, distinct wirings, the fidelity gene, the gene network's cell types.

Usage: python tools/g3_analyse.py g3-evo            (every run whose folder starts with g3-evo)
       python tools/g3_analyse.py g3-evo --csv out.csv
"""
import csv
import glob
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLS = [("alive", "cells"), ("fold.stressFold", "stressF"), ("fold.stress", "stress"), ("fold.rates.on", "in/s"), ("fold.rates.off", "back/s"),
        ("fold.rates.big", "big/s"), ("fold.rates.rel", "rel/s"), ("fold.dose", "dose"), ("fold.repairing", "repair"), ("fold.buf", "buffer"),
        ("fold.bufSd", "bufSd"), ("fold.hidden", "hidden"), ("fold.buffered", "carry"), ("fold.hiddenLinks", "hidL"), ("fold.drift", "drift"),
        ("fold.wirings", "wirings"), ("fold.foldLinks", "foldL"), ("fid.mean", "fid"), ("grn.types", "types")]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    prefix, out = sys.argv[1], None
    if "--csv" in sys.argv:
        out = sys.argv[sys.argv.index("--csv") + 1]
    rows = []
    for d in sorted(glob.glob(os.path.join(REPO, "experiments", "runs", prefix + "*"))):
        f = os.path.join(d, "samples.csv")
        if not os.path.exists(f):
            continue
        with open(f, newline="", encoding="utf-8") as fh:
            S = list(csv.DictReader(fh))
        if not S:
            continue
        last = S[-1]
        tail = S[len(S) * 2 // 3:]
        row = {"run": os.path.basename(d), "t": num(last.get("t"))}
        for k, name in COLS:
            vals = [num(s.get(k)) for s in tail]
            vals = [v for v in vals if v is not None]
            row[name] = sum(vals) / len(vals) if vals else None
        rows.append(row)
    if not rows:
        print("no runs")
        return
    names = ["run", "t"] + [n for _, n in COLS]
    w = max(len(r["run"]) for r in rows)
    print(" ".join([f"{'run':<{w}}"] + [f"{n:>7}" for n in names[1:]]))
    for r in rows:
        cells = [f"{r['run']:<{w}}"]
        for n in names[1:]:
            v = r[n]
            cells.append(f"{'-':>7}" if v is None else f"{v:>7.3g}")
        print(" ".join(cells))
    if out:
        with open(out, "w", newline="", encoding="utf-8") as fh:
            wr = csv.DictWriter(fh, fieldnames=names)
            wr.writeheader()
            wr.writerows(rows)


if __name__ == "__main__":
    main()
