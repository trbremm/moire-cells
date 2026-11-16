"""Step C12f: the speed table from the speed runs' meta.json (MAX, mean speed reached). Run from the repository:
    python experiments/conditions/c12f/speed.py c12f-speed        # runs whose names start with this
"""
import glob, json, os, re, statistics, sys

pre = sys.argv[1] if len(sys.argv) > 1 else 'c12f-speed'
rows = {}
for p in sorted(glob.glob(f'experiments/runs/{pre}*/meta.json')):
    m = json.load(open(p, encoding='utf-8'))
    name = os.path.basename(os.path.dirname(p))
    key = re.sub(r'-r\d+$', '', name)
    rows.setdefault(key, []).append((m.get('speed_reached'), m.get('status'), m.get('commit', '')[:7]))
for k, v in rows.items():
    sp = [x[0] for x in v if x[0] is not None]
    print(f'{k:40s} runs {len(v)}  speeds {" ".join(f"x{s:.2f}" for s in sp)}  mean x{statistics.mean(sp):.2f}  commit {v[0][2]}  {set(x[1] for x in v)}')
