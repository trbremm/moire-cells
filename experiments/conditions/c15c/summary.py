"""Step C15c: the tables of EXPERIMENTS.md "Carbon makes the cell", from the runs' probes (meta.json evals).

python experiments/conditions/c15c/summary.py [run-name-prefix ...]   (default: every experiments/runs/c15c-* run)
"""
import glob
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")
JOBS = ["undecided", "light", "breathe", "ferment", "gradient", "build", "predator"]


def probes(run):
    try:
        m = json.load(open(os.path.join(run, "meta.json")))
    except (OSError, ValueError):
        return []
    out = []
    for e in m.get("evals", []):
        try:
            d = json.loads(e.get("result") or "")
        except (TypeError, ValueError):
            continue
        if isinstance(d, dict) and "alive" in d:
            out.append(d)
    return out


def f(x, nd=2):
    return "-" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def main():
    pre = sys.argv[1:] or ["c15c-"]
    runs = sorted(r for p in pre for r in glob.glob(os.path.join(ROOT, p + "*")) if os.path.isdir(r))
    print("| run | t | alive | jobs (undecided/light/breathe/ferment/gradient/build) | membrane integrity | body short | parts C (memb/wall/pig/glue/enz) "
          "| enz short | limited by C / G / trace / g,t / battery | bites/s | rounding C, E, atoms, charge, energy |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in runs:
        for d in probes(r):
            n = d.get("alive") or 0
            p = d.get("parts") or {}
            r2 = d.get("rate2") or {}
            cen = (d.get("cells") or {}).get("census") or {}
            pc = lambda k: f"{100 * (p.get(k) or 0) / n:.0f}%" if n and p else "-"
            job = d.get("job") or []
            memb = (d.get("memb") or {}).get("integ")
            parts = "/".join(f(p.get(k), 1) for k in ("membC", "wallC", "pigC", "glueC", "enzC")) if p else "-"
            lim = " / ".join(pc(k) for k in ("limC", "limG", "limTr", "limAt", "limBat")) if p else "-"
            rd = ", ".join(f(d.get(k), 3) for k in ("cRound", "eRound", "atoms", "charge", "energy"))
            print(f"| {os.path.basename(r)} | {d['t']:.0f} | {n} | {'/'.join(str(x) for x in job[:6])} | {f(memb)} | "
                  f"{(str(cen.get('short')) if cen else '-')} | {parts} | {pc('enzShort')} | {lim} | {f(r2.get('bites'), 3) if r2 else '-'} | {rd} |")


if __name__ == "__main__":
    main()
