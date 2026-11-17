"""Step T1a: a run's numbers over time from samples.csv. python experiments/conditions/t1a/summary.py <run> [...] [--at 300,600,1200,1800]
Per run and time: cells, the kin channel gene (mean, sd, carriers > 0.25), display, tolerance, kinship over contacts, both-kin share,
strangers, cells by free sides (enclosed share) and their batteries, shared per s (fuel, linkers, trace), membrane integrity, books."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = next(it)
    else: runs.append(a)
AT = [float(x) for x in opt.get('--at', '300,600,1200,1800').split(',')]
for run in runs:
    p = os.path.join('experiments/runs', run, 'samples.csv')
    if not os.path.exists(p): print(run, 'no samples'); continue
    rows = list(csv.DictReader(open(p)))
    g = lambda r, k: float(r.get(k) or 'nan') if (r.get(k) or '') != '' else float('nan')
    print(f'== {run}')
    for t in AT:
        r = min(rows, key=lambda r: abs(float(r['trun']) - t))
        if abs(float(r['trun']) - t) > 30: continue
        print(f"  {float(r['trun']):5.0f}s cells {g(r, 'alive'):5.0f} · kin gene {g(r, 'kin.genes.kin'):.3f}±{g(r, 'kin.genes.kinSd'):.3f} (>0.25 {g(r, 'kin.genes.carriers'):.0%})"
              f" · display {g(r, 'kin.genes.display'):.2f} tol {g(r, 'kin.genes.tol'):.2f} · kinship {g(r, 'kin.kinship'):.2f} both-kin {g(r, 'kin.accepted'):.0%} strangers {g(r, 'kin.strangers'):.0%}"
              f" · enclosed {g(r, 'kin.bins.0.share'):.0%} bat encl/1-2/3-4/5-6 {g(r, 'kin.bins.0.bat'):.2f}/{g(r, 'kin.bins.1.bat'):.2f}/{g(r, 'kin.bins.2.bat'):.2f}/{g(r, 'kin.bins.3.bat'):.2f}"
              f" integ {g(r, 'kin.bins.0.integ'):.2f}/{g(r, 'kin.bins.1.integ'):.2f}/{g(r, 'kin.bins.2.integ'):.2f}/{g(r, 'kin.bins.3.integ'):.2f}"
              f" · shared/s fuel {g(r, 'kin.rate.fuel'):.3f} link {g(r, 'kin.rate.link'):.3f} trace {g(r, 'kin.rate.trace'):.4f} · integrity {g(r, 'membrane.integ'):.2f}")
    mr = [g(r, 'matter.rounding') for r in rows]; qr = [g(r, 'charge.qRound') for r in rows]; er = [g(r, 'heat.rounding') for r in rows]
    print(f"  books: atoms rounding max |{max(abs(x) for x in mr):g}| · charge |{max(abs(x) for x in qr):g}| · energy {min(er):.3f}..{max(er):.3f}")
