"""Step G1: the quick checks' table, from the runs' samples (fid.*: the census every 15 s; kin.*: the TISSUES line).
    python experiments/conditions/g1/summary.py [t1 t2 ...]
Per run (on vs the neutral control, seeds 3 and 7): cells, the gene's mean ± sd, shares above / below the founders, light vs shade, hard-lit,
tissue interior vs loners, the self marker's match at contacts within lineages (and careful / sloppy pairs), the mutation scale per birth,
proofreading's cost per s, the T1a kinship at contacts.
"""
import csv
import os
import sys

RUNS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'runs'))
NAMES = ['g1-col-on_s3', 'g1-colctl_s3', 'g1-col-on_s7', 'g1-colctl_s7', 'g1-spot-on_s3', 'g1-spotctl_s3', 'g1-spot-on_s7', 'g1-spotctl_s7']
TIMES = [float(x) for x in sys.argv[1:]] or [300, 600, 900, 1200]
COLS = [('alive', 'cells', 0), ('fid.mean', 'F', 2), ('fid.sd', 'sd', 2), ('fid.above', 'above', 2), ('fid.below', 'below', 2),
        ('fid.lit.mean', 'light', 2), ('fid.shade.mean', 'shade', 2), ('fid.hard.mean', 'hard', 2), ('fid.interior.mean', 'inside', 2),
        ('fid.loner.mean', 'loners', 2), ('fid.kin.same.match', 'match', 2), ('fid.kin.careful.match', 'm.careful', 2),
        ('fid.kin.sloppy.match', 'm.sloppy', 2), ('fid.copy.perBirth', 'mut/birth', 2), ('fid.copy.costPerS', 'cost/s', 3),
        ('kin.kinship', 'kinship', 2), ('fid.lineageN', 'lineages', 0)]


def row_at(rows, t):
    best = None
    for r in rows:
        try:
            tr = float(r['t'])
        except (KeyError, ValueError):
            continue
        if tr <= t + 1 and (best is None or tr > float(best['t'])):
            best = r
    return best


def fmt(v, d):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return '-'
    return f'{x:.{d}f}'


print('| run | t | ' + ' | '.join(c[1] for c in COLS) + ' |')
print('|' + '---|' * (len(COLS) + 2))
for name in NAMES:
    p = os.path.join(RUNS, name, 'samples.csv')
    if not os.path.exists(p):
        continue
    rows = list(csv.DictReader(open(p, encoding='utf-8')))
    for t in TIMES:
        r = row_at(rows, t)
        if r is None or float(r['t']) < t - 31:
            continue
        print(f'| {name} | {float(r["t"]):.0f} | ' + ' | '.join(fmt(r.get(k), d) for k, _, d in COLS) + ' |')
