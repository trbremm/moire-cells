"""Step C15a: the watch runs' table, from the samples (carbon.*: the CARBON line's numbers; the books' roundings).
    python experiments/conditions/c15a/summary.py [run names ...]
Per run and time: the ladder (methane-like -> CO2-like), tar's carbons and hands, reactions per s, carbon in / out per s, the roundings
(carbon, carbon energy, atoms, charge).
"""
import csv
import os
import sys

RUNS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'runs'))
NAMES = sys.argv[1:] or ['c15a-default-spot', 'c15a-default-full', 'c15a-vent-dark', 'c15a-vent-dim']
COLS = [('alive', 'cells', 0), ('carbon.cg4', 'cg4', 2), ('carbon.cg3t', 'cg3t', 2), ('carbon.cg2t2', 'cg2t2', 2), ('carbon.cgt3', 'cgt3', 2),
        ('carbon.ct4', 'ct4', 2), ('carbon.tarC', 'tar C', 1), ('carbon.tarCC', 'c-c', 1), ('carbon.tarCG', 'fuel h', 1),
        ('carbon.tarCT', 'burnt h', 1), ('carbon.oxidize', 'ox/s', 2), ('carbon.condense', 'cond/s', 2), ('carbon.reduce', 'red/s', 3),
        ('carbon.hydrolyze', 'hyd/s', 3), ('carbon.dissolve', 'dis/s', 3), ('carbon.settle', 'set/s', 3), ('carbon.cIn', 'C in/s', 2),
        ('carbon.cOut', 'C out/s', 2), ('carbon.glowOut', 'glow/s', 2), ('carbon.rounding', 'C round', 0), ('carbon.eRounding', 'E round', 0)]


def fmt(v, d):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return '-'
    return f'{x:.{d}f}' if d else (f'{x:g}')


for name in NAMES:
    path = os.path.join(RUNS, name, 'samples.csv')
    if not os.path.exists(path):
        print(f'{name}: no samples')
        continue
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    print(f'\n{name}')
    print('   t ' + ' '.join(f'{h:>8}' for _, h, _ in COLS))
    for r in rows:
        print(f"{float(r.get('t', 0)):5.0f} " + ' '.join(f'{fmt(r.get(k), d):>8}' for k, _, d in COLS))
    extra = [k for k in rows[-1] if k.endswith('rounding') and not k.startswith('carbon.')]
    print('   other roundings at the end: ' + ', '.join(f'{k} {rows[-1][k]}' for k in extra[:8]))
