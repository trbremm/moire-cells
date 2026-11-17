"""Step T1b: a run's gene network numbers over time. python experiments/conditions/t1b/summary.py <run> [...] [--at 600,1200,1800,2400]
Per run and time (samples.csv): cells, lineages (>= 20 cells) and their sizes, cell types (expression patterns held by >= 3 % of a lineage),
the differentiation spread, the wiring (inputs per regulator, outputs per cell), the reporter's best regulator, contacts between strangers
(a border), the books. Then the full census the evals saved (meta.json) at each time: per lineage its types (pattern over the 8 regulators:
- not driving an output, L low, m mid, H high), each type's share and where it sits (sides pressed 0..1, light, fuel, battery, distance to
the nearest spring in R) and the outputs that differ between the lineage's types."""
import csv, json, os, sys
sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = next(it)
    else: runs.append(a)
AT = [float(x) for x in opt.get('--at', '600,1200,1800,2400').split(',')]
for run in runs:
    p = os.path.join('experiments/runs', run, 'samples.csv')
    if not os.path.exists(p): print(run, 'no samples'); continue
    rows = list(csv.DictReader(open(p)))
    g = lambda r, k: float(r.get(k) or 'nan') if (r.get(k) or '') != '' else float('nan')
    print(f'== {run}')
    for t in AT:
        r = min(rows, key=lambda r: abs(float(r['trun']) - t))
        if abs(float(r['trun']) - t) > 30: continue
        lin = [(int(g(r, f'grn.lineages.{k}.id')), int(g(r, f'grn.lineages.{k}.n')), int(g(r, f'grn.lineages.{k}.types')))
               for k in range(8) if (r.get(f'grn.lineages.{k}.id') or '') != '']
        print(f"  {float(r['trun']):5.0f}s cells {g(r, 'alive'):5.0f} · lineages {len(lin)} " + ' '.join(f'#{a}:{b}({c}t)' for a, b, c in lin) +
              f" · types {g(r, 'grn.types'):.0f} · spread {g(r, 'grn.diff'):.3f} · wiring {g(r, 'grn.net.links'):.2f} in/reg {g(r, 'grn.net.outputs'):.1f} out/cell"
              f" · best reporter r{g(r, 'grn.reporter.best'):.0f} sd {g(r, 'grn.reporter.bestSd'):.2f} · border {g(r, 'grn.border'):.1%}")
    mr = [g(r, 'matter.rounding') for r in rows]; qr = [g(r, 'charge.qRound') for r in rows]; er = [g(r, 'heat.rounding') for r in rows]
    print(f"  books: atoms rounding max |{max(abs(x) for x in mr):g}| · charge |{max(abs(x) for x in qr):g}| · energy {min(er):.3f}..{max(er):.3f}")
    mp = os.path.join('experiments/runs', run, 'meta.json')
    if not os.path.exists(mp) or '--short' in opt: continue
    for e in json.load(open(mp, encoding='utf-8')).get('evals', []):
        res = e.get('result')
        if not isinstance(res, str) or not res.startswith('{'): continue
        c = json.loads(res)
        if 'lineages' not in c: continue
        f2 = lambda x: '-' if x is None else f'{x:.2f}'
        print(f"  -- census at {c['t']:.0f}s: {c['n']} cells, {c['types']} types, spread {c['diff']:.3f}, senses " +
              ' '.join(f'{k} {v:.2f}' for k, v in c['senses'].items()))
        for L in c['lineages'][:4]:
            print(f"     lineage {L['id']}: {L['n']} cells, {L['types']} types, spread {L['diff']:.3f}, at a border {L.get('border', 0):.0%}; differ: " +
                  (', '.join(f"{d['out']} x{d['ratio']:.1f}" for d in L['differ']) or 'none'))
            for T in L['top'][:4]:
                print(f"        {T['key']} {T['share']:.0%}: sides {T['contact']:.2f} light {T['light']:.2f} fuel {T['fuel']:.2f} bat {T['bat']:.2f}"
                      f" spring {f2(T['spring'])} R border {T.get('border', 0):.0%}")
