"""The first-load survey's table: live cells at each probe, per run (experiments/runs/fl-*)."""
import glob
import json
import os

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")
for d in sorted(glob.glob(os.path.join(RUNS, "fl-*"))):
    try:
        m = json.load(open(os.path.join(d, "meta.json")))
    except Exception:
        continue
    row, worst, build = [], 0, None
    for e in m.get("evals", []):
        try:
            v = json.loads(e.get("result") or "{}")
        except Exception:
            continue
        row.append(str(v.get("alive")))
        build = v.get("buildMs", build)
        for k in ("cRound", "atoms", "charge"):
            if v.get(k):
                worst = max(worst, abs(v[k]))
    print(f"{os.path.basename(d):28s} {m.get('status', '?'):8s} {' / '.join(row):40s} build {build if build is None else round(build)} ms"
          f"  books {worst}")
