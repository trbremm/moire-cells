"""Step S2: the act runs' table (motors on vs their neutral control). python experiments/conditions/s2/summary.py [world ...]"""
import json
import os
import sys

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'runs')


def census(name):
    p = os.path.join(RUNS, name, 'meta.json')
    if not os.path.exists(p):
        return None
    m = json.load(open(p, encoding='utf-8'))
    mot, place = {}, {}
    for e in m.get('evals', []):
        try:
            j = json.loads(e.get('result', ''))
        except (TypeError, ValueError):
            continue
        t = round(e['t'])
        if 'carriers' in j:
            mot[t] = j
        elif 'all' in j:
            place[t - 1] = j
    return m.get('status'), mot, place


worlds = sys.argv[1:] or ['delta', 'islands', 'colonies']
for w in worlds:
    for ctl in ('on', 'null'):
        r = census(f's2-act-{w}-{ctl}')
        if not r:
            print(w, ctl, 'missing')
            continue
        st, mot, place = r
        print(f'== {w} {ctl} ({st})')
        for t in sorted(mot):
            j = mot[t]
            line = (f"  t{t:5d} n {j['n']:5d} | flagellum gene {j['flagGene']:.3f}+-{j['flagSd']:.3f} carriers {j['carriers']:4d} "
                    f"swim {j['swimmers']:4d} at {j['speed']:.2f} R/s, pushers {j['pusherShare']:.2f} | cilia gene {j['ciliaGene']:.3f}+-{j['ciliaSd']:.3f} "
                    f"carriers {j['ciliaCarriers']:4d} beat {j['beating']:4d} wave {j['wave']:.2f} sync {j['sync']:.2f} coupling {j['coupling']:+.2f} "
                    f"| proteins {j['motorShare']:.2f}")
            print(line)
            p = place.get(t)
            if p:
                parts = []
                for k in ('alone', 'tissue', 'open', 'wall'):
                    z = p.get(k, {})
                    if z.get('n'):
                        parts.append(f"{k} {z['n']}: flag {z['flagGene']:.3f} cilia {z['ciliaGene']:.3f} swim {z['swimShare']:.2f} beat {z['beatShare']:.2f}")
                if parts:
                    print('         ' + ' | '.join(parts))
