"""Step N2: print the worlds and evolution tables from experiments/runs/n2-* (python experiments/conditions/n2/summary.py)."""
import csv, glob, json, os

def rows(d):
    try:
        return list(csv.DictReader(open(os.path.join(d, 'samples.csv'))))
    except OSError:
        return []

def census(d, t=None):
    try:
        m = json.load(open(os.path.join(d, 'meta.json')))
    except OSError:
        return None, None
    ev = [e for e in m.get('evals', []) if e.get('result')]
    if t is not None:
        ev = [e for e in ev if abs(e['t'] - t) < 2]
    if not ev:
        return None, m
    r = json.loads(ev[-1]['result'])
    return r, m

def f(x, n=2):
    return '-' if x is None else f'{x:.{n}f}'

print('WORLDS (5 min): cells at 60/180/300 s, rounding (heat, matter, carbon), travel R/s, near springs x')
for d in sorted(glob.glob('experiments/runs/n2-world-*')):
    R = rows(d)
    if not R:
        print(os.path.basename(d), 'no samples'); continue
    at = lambda t: next((r['cells.n'] for r in R if abs(float(r['t']) - t) < 1), '-')
    c, m = census(d)
    print(f"{os.path.basename(d):30s} {at(60):>5s} {at(180):>5s} {at(300):>5s}  {R[-1].get('heat.rounding', '-')[:8]:>8s} {R[-1].get('matter.rounding')} "
          f"{R[-1].get('carbon.rounding')}  travel {f(c and c.get('travel'))} near x{f(c and c.get('enrich'))}  speed x{m and m.get('speed_reached')}")

print()
print('EVOLUTION (20 min): cells at 600/1200 s; at 1200 s the genes (crawl motility, flagellum, cilia, chemotaxis), travel R/s, path vs smell, near springs x')
for d in sorted(glob.glob('experiments/runs/n2-evo-*')):
    R = rows(d)
    at = lambda t: next((r['cells.n'] for r in R if abs(float(r['t']) - t) < 1), '-')
    c, m = census(d, 1200)
    if not c:
        print(os.path.basename(d), 'no census', m and m.get('status')); continue
    F, Mo = c['flow'] or {}, c['motors'] or {}
    print(f"{os.path.basename(d):30s} {at(600):>5s} {at(1200):>5s}  mot {f(F.get('motility'))} flag {f(F.get('flagellum'))} cil {f(F.get('cilia'))} "
          f"chemo {f(F.get('chemo'))}±{f(F.get('chemoSd'))} (x{f(F.get('chemoFactor'))})  travel {f(F.get('travel'))} path·smell {f(F.get('alignPath'), 3)} "
          f"near x{f(F.get('enrich'))}  life path {f(F.get('lifePath'), 1)} R")
