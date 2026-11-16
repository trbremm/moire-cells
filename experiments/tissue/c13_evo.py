"""Step C13 evolution runs: one table of the genes, the gates' marks and the patchiness over time.

    python experiments/tissue/c13_evo.py [experiments/runs/c13]      # prints markdown tables
"""
import csv
import glob
import json
import os
import sys

RUNS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runs", "c13")
TIMES = (120, 300, 600, 900, 1200, 1500)


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def at(rows, col, t):
    best = min(rows, key=lambda r: abs(num(r["trun"]) - t))
    return num(best.get(col)) if abs(num(best["trun"]) - t) < 20 else None


def f(x, d=2):
    return "-" if x is None else f"{x:.{d}f}"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    runs = sorted(d for d in glob.glob(os.path.join(RUNS, "c13-evo-*")) if os.path.exists(os.path.join(d, "meta.json")))
    print("| run | t | cells | entropy (rate) | ORDER | glue | pump | engine | div | turn | push | lever A | sense A | emit A | period bin |"
          " front·grad | div \\|cos\\| | contacts on felt | felt |")
    print("|" + "---|" * 19)
    for d in runs:
        rows = list(csv.DictReader(open(os.path.join(d, "samples.csv"), encoding="utf-8")))
        name = os.path.basename(d)
        for t in TIMES:
            if t > num(rows[-1]["trun"]) + 1:
                continue
            g = lambda k: at(rows, f"guides.genes.{k}.mean", t)  # noqa: E731
            sd = lambda k: at(rows, f"guides.genes.{k}.sd", t)  # noqa: E731
            gs = lambda k: f"{f(g(k))}±{f(sd(k))}"  # noqa: E731
            print(f"| {name} | {t} | {f(at(rows, 'alive', t), 0)} | {f((at(rows, 'heat.out', t) or 0) / 1e6, 1)} M ({f((at(rows, 'heat.rate.out', t) or 0) / 1e3, 1)} k/s) |"
                  f" {f(at(rows, 'matter.order', t))} | {gs('gateGlue')} | {gs('gatePump')} | {gs('gateEngine')} | {gs('gateDiv')} | {gs('gateTurn')} |"
                  f" {gs('push')} | {gs('leverA')} | {gs('senseA')} | {gs('emitA')} | {f(at(rows, 'guides.period.median', t), 0)} |"
                  f" {f(at(rows, 'guides.frontCos', t))} | {f(at(rows, 'guides.divCosNow', t))} | {f(at(rows, 'guides.contactFelt', t))} | {f(at(rows, 'guides.felt', t))} |")
    print()
    print("Patchiness (neighbour correlation of each gene over the touching pairs; 0 = scattered, 1 = patches):")
    print("| run | t | cells | lever A | sense A | emit A | tune A | lever B | key angle | glue | pump | engine | div | turn | push |")
    print("|" + "---|" * 15)
    for d in runs:
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        for e in meta.get("evals", []):
            r = e.get("result")
            if not isinstance(r, dict) or "leverA" not in r:
                continue
            c = lambda k: f(r[k]["corr"])  # noqa: E731
            print(f"| {os.path.basename(d)} | {round(e['t'])} | {r['n']} | {c('leverA')} | {c('senseA')} | {c('emitA')} | {c('tuneA')} | {c('leverB')} |"
                  f" {c('keyAngle')} | {c('glue')} | {c('pump')} | {c('engine')} | {c('div')} | {c('turn')} | {c('push')} |")


if __name__ == "__main__":
    main()
