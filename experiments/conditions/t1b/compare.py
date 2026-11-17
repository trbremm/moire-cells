"""Step T1b: the colony runs side by side (network on vs its neutral control), from the census the evals saved at 10 / 20 / 30 / 40 min.
python experiments/conditions/t1b/compare.py t1b-col-on_s3 t1b-col-null_s3 ...
Per run and census: cells, lineages >= 20 cells (sizes), cell types (per lineage), the spread, the wiring, the border share, and for the
biggest lineage how far apart its types sit: the range over its types (>= 5 % of it) of the mean sides pressed, light, distance to the
nearest spring (R) and border share; and the outputs that differ between its types."""
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')
print('| run | t | cells | lineages (sizes) | types per lineage | spread | inputs/reg | outputs/cell | border | biggest lineage: types >= 5 %, range of sides / light / spring R / border | outputs that differ |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for run in sys.argv[1:]:
    mp = os.path.join('experiments/runs', run, 'meta.json')
    if not os.path.exists(mp): print(f'| {run} | not run |'); continue
    for e in json.load(open(mp, encoding='utf-8')).get('evals', []):
        res = e.get('result')
        if not isinstance(res, str) or not res.startswith('{'): continue
        c = json.loads(res)
        if 'lineages' not in c: continue
        L = c['lineages']
        if not L:
            print(f"| {run} | {c['t'] / 60:.0f} min | {c['n']} | 0 | | | | | | | |"); continue
        b = L[0]
        ts = [t for t in b['top'] if t['share'] >= 0.05]
        rng = lambda k: (max(t[k] for t in ts if t[k] is not None) - min(t[k] for t in ts if t[k] is not None)) if len([t for t in ts if t[k] is not None]) > 1 else 0
        print(f"| {run} | {c['t'] / 60:.0f} min | {c['n']} | {len(L)} ({'/'.join(str(l['n']) for l in L)}) | {'/'.join(str(l['types']) for l in L)} | {c['diff']:.2f}"
              f" | {c['net']['links']:.2f} | {c['net']['outputs']:.1f} | {c.get('border', 0):.1%} | {len(ts)}: {rng('contact'):.2f} / {rng('light'):.2f} / {rng('spring'):.1f} / {rng('border'):.2f}"
              f" | {', '.join(d['out'] + ' x' + format(d['ratio'], '.1f') for d in b['differ'][:4]) or '-'} |")
