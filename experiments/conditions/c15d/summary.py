"""Step C15d tables from the runs' probes (the PROBE eval in make.py).

python experiments/conditions/c15d/summary.py c15d-base-default c15d-base-colonies ...   (run names under experiments/runs/)
  --flow   also the flow ledger per probe (carbon units per minute; fuel hands = reduced carbon; energy per minute)
  --times 300,600   only these probe times
"""
import argparse
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")


def probes(run):
    try:
        m = json.load(open(os.path.join(ROOT, run, "meta.json")))
    except OSError:
        return []
    out = []
    for e in m.get("evals", []):
        r = e.get("result")
        if isinstance(r, str) and r.startswith("{") and '"alive"' in r:
            out.append(json.loads(r))
    return out


def f(x, n=1):
    if x is None:
        return "-"
    if isinstance(x, float):
        if abs(x) >= 100:
            return f"{x:.0f}"
        return f"{x:.{n}f}"
    return str(x)


def pc(x, n):
    return f"{round(100 * x / n)}%" if n else "-"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--flow", action="store_true")
    ap.add_argument("--times", default="")
    a = ap.parse_args()
    want = {int(t) for t in a.times.split(",") if t}
    print("| run | t | alive | jobs (undec/light/breathe/ferment/gradient/build/pred) | integrity | body short | parts C memb/wall/pig/enz | "
          "limited C / G / trace / g,t / bat | mud % | rounding C, E, atoms, charge |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    rows = []
    for run in a.runs:
        for d in probes(run):
            t = round(d["t"])
            if want and t not in want:
                continue
            n = d.get("alive") or 0
            P = d.get("parts") or {}
            C = d.get("census") or {}
            F = d.get("flow") or {}
            job = d.get("job")
            js = "/".join(str(x) for x in job[:7]) if isinstance(job, list) else "-"
            integ = (d.get("memb") or {}).get("integ")
            lim = " / ".join(pc(P.get(k, 0), n) for k in ("limC", "limG", "limTr", "limAt", "limBat"))
            parts = "/".join(f(P.get(k)) for k in ("membC", "wallC", "pigC", "enzC"))
            print(f"| {run} | {t} | {n} | {js} | {f(integ, 2)} | {C.get('short', '-')} | {parts} | {lim} | {pc(F.get('mudShare', 0), 1)} | "
                  f"{d.get('cRound')}, {d.get('eRound')}, {d.get('atoms')}, {d.get('charge')} |")
            rows.append((run, t, F, n))
    if a.flow:
        print()
        print("Flow ledger (per minute; carbon units, fuel hands, energy):")
        print("| run | t | in springs (fuel) | open fix / burn / ->mud | cells take (fuel) / graze / breathe out / ->mud | in cells fix / burn | "
              "built body / memb / wall / pig / enz | builder reduced / shuttled | batteries in / parts (memb, wall, red, pig, enz, trans) | "
              "mud / cells / all |")
        print("|---|---|---|---|---|---|---|---|---|---|")
        for run, t, F, n in rows:
            if not F:
                continue
            g = lambda k: f(F.get(k))
            print(f"| {run} | {t} | {g('inSprings')} ({g('inSpringsFuel')}) | {g('openFix')} / {g('openBurn')} / {g('mudFormedOpen')} | "
                  f"{g('uptake')} ({g('uptakeFuel')}) / {g('grazed')} / {g('exhaled')} / {g('toMud')} | {g('cellFix')} / {g('cellBurn')} | "
                  f"{g('builtBody')} / {g('builtLip')} / {g('builtWall')} / {g('builtPig')} / {g('builtEnz')} | {g('builderRed')} / {g('shuttle')} | "
                  f"{f((F.get('eIncome') or 0) + (F.get('eCarbonEng') or 0))} / {g('payLip')}, {g('payWall')}, {g('payRed')}, {g('payPig')}, {g('payEnz')}, {g('payTrans')} | "
                  f"{g('mud')} / {f((F.get('all') or 0) * (F.get('cellShare') or 0))} / {g('all')} |")


if __name__ == "__main__":
    main()
