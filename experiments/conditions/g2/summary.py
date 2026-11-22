"""Step G2: a table of the act / oxy runs (the dup census at 300, 600, 900, 1200 s from the samples). python experiments/conditions/g2/summary.py"""
import csv, glob, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'runs')
K = ['cells.n', 'dup.working', 'dup.withCopy', 'dup.engCopy', 'dup.pumpCopy', 'dup.copies.perCell', 'dup.fate.dosage', 'dup.fate.newfn',
     'dup.fate.alone', 'dup.families.n', 'dup.families.branched', 'dup.families.inCell', 'dup.battery.copy', 'dup.battery.none', 'dup.lineDups',
     'dup.rates.tot.eng', 'dup.rates.tot.pump', 'dup.rates.tot.del', 'matter.rounding', 'charge.qRound']
def num(x):
    try: return float(x)
    except: return None
rows = []
for d in sorted(glob.glob(os.path.join(ROOT, 'g2-*'))):
    f = os.path.join(d, 'samples.csv')
    if not os.path.exists(f) or 'pics' in d or 'speed' in d: continue
    r = list(csv.DictReader(open(f, encoding='utf-8')))
    if not r: continue
    for t in (300, 600, 900, 1200):
        best = min(r, key=lambda x: abs(num(x['t']) - t))
        if abs(num(best['t']) - t) > 20: continue
        rows.append([os.path.basename(d), t] + [num(best.get(k)) for k in K])
fmt = lambda v: '-' if v is None else (f'{v:.3g}' if abs(v) < 1000 else f'{v:.0f}')
print('| run | t | ' + ' | '.join(k.replace('dup.', '') for k in K) + ' |')
print('|' + '---|' * (len(K) + 2))
for x in rows:
    if len(sys.argv) > 1 and x[1] not in map(int, sys.argv[1:]): continue
    print('| ' + ' | '.join([x[0], str(x[1])] + [fmt(v) for v in x[2:]]) + ' |')
