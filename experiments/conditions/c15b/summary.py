"""Step C15b: the tables of EXPERIMENTS.md "Cells eat carbon" from the runs' probes (meta.json evals).

python experiments/conditions/c15b/summary.py [run-name-prefix ...]   (default: c15b-)
"""
import glob
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
JOBS = ["undecided", "light", "breathe", "ferment", "gradient", "build", "pred"]


def probes(meta):
    out = []
    for e in meta.get("evals", []):
        r = e.get("result")
        r = r if isinstance(r, str) else ""
        if r.startswith('{"t"') and '"cellsC"' in r:
            out.append(json.loads(r))
    return out


def f(x, d=1):
    return "-" if x is None else (f"{x:.{d}f}" if isinstance(x, (int, float)) else str(x))


def main():
    pre = sys.argv[1:] or ["c15b-"]
    rows = []
    for p in pre:
        for m in sorted(glob.glob(os.path.join(REPO, "experiments", "runs", p + "*", "meta.json"))):
            d = json.load(open(m))
            P = probes(d)
            if not P:
                continue
            rows.append((os.path.basename(os.path.dirname(m)), d.get("status"), d.get("speed_reached"), P))
    print("| run | t (s) | cells | jobs (white/lime/pink/violet/cyan/amber/red) | carbon engines in cells: ox / cond / fix by light / hyd |"
          " per s: breathe / store / fix / digest / graze | granules (carbons) | ladder in dish CH4..CO2 | tar | dish / cells carbon | free t |"
          " bodies held / wanted (carbons), cells short | roundings c / e / atoms / charge / energy |")
    print("|" + "---|" * 13)
    for name, st, sp, P in rows:
        for q in P:
            c = q.get("cells") or {}
            C, r = c.get("census") or {}, c.get("rate") or {}
            lad = q.get("ladder") or []
            tar = q.get("tar") or []
            tarC = (2 * tar[0] + tar[1] + tar[2]) / 4 if len(tar) == 3 else None
            job = q.get("job") or []
            print(f"| {name} | {q['t']:.0f} | {q.get('alive')} | {'/'.join(str(j) for j in job)} | {C.get('ox')}/{C.get('cond')}/{C.get('redLit')}/{C.get('hyd')}"
                  f" | {f(r.get('ox'), 3)}/{f(r.get('cond'), 3)}/{f(r.get('red'), 3)}/{f(r.get('hyd'), 3)}/{f(r.get('graze'), 3)} | {f(c.get('granC'), 2)}"
                  f" | {' '.join(f(x) for x in lad)} | {f(tarC)} | {f(q.get('dishC'))} / {f(q.get('cellsC'))} | {f(q.get('freeT'))}"
                  f" | {f(C.get('body'))} / {f(C.get('want'))}, {C.get('short')} | {q.get('rounding')} / {q.get('eRounding')} / {q.get('atoms')} / {q.get('charge')} / {f(q.get('energy'), 3)} of {f(q.get('eIn'), 0)} |")


if __name__ == "__main__":
    main()
