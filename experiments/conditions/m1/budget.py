"""Step M1: the membrane material budget from a run's samples (the whole.* counters), as means over a window.
python experiments/conditions/m1/budget.py <run> [<run> ...] [--from 120] [--to 600]
Per run: cells; integrity, whole (>= 0.6) and holey (< 0.2) shares; bilayer held / wanted; per s (molecule units, the whole dish,
and per 1000 cells): fused soap, fused oil, made soap, made oil, head on oil, bitten soap, bitten oil, shed soap, shed oil, spilled at
deaths, to newborns; the builder's shortfall by first limit (head, l, L, battery); stocks holding L, l, all three."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = float(next(it))
    else: runs.append(a)
t0, t1 = opt.get('--from', 120), opt.get('--to', 1e9)
K = ['fuseS', 'fuseO', 'madeS', 'madeO', 'headOn', 'biteS', 'biteO', 'shedS', 'shedO', 'spill', 'split']
for run in runs:
    p = run if os.path.exists(os.path.join(run, 'samples.csv')) else os.path.join('experiments/runs', run)
    rows = [r for r in csv.DictReader(open(os.path.join(p, 'samples.csv'))) if r.get('whole.n') not in (None, '') and t0 <= float(r['trun']) <= t1]
    if not rows: print(run, 'no samples'); continue
    m = lambda k: sum(float(r.get(k) or 0) for r in rows) / len(rows)
    n = m('whole.n')
    sh = [m(f'whole.short.{k}') for k in ('head', 'l', 'L', 'bat')]
    print(f"{os.path.basename(p)} ({rows[0]['trun']}..{rows[-1]['trun']} s): cells {n:.0f} · integrity {m('whole.integ'):.2f}, whole {m('whole.whole'):.0%},"
          f" holes {m('whole.holey'):.0%} · held {m('whole.held'):.1f} of {m('whole.want'):.1f} · oil past tails {m('whole.xoil'):.1f}"
          f" · stocks with L {m('whole.hasL'):.0%} l {m('whole.hasl'):.0%} all {m('whole.hasAll'):.0%} · empty bat {m('whole.empty'):.0%}")
    print('   per s (units):    ' + ' '.join(f"{k} {m('whole.rate.' + k):.2f}" for k in K))
    print('   per 1000 cells/s: ' + ' '.join(f"{k} {1000 * m('whole.rate.' + k) / max(n, 1):.3f}" for k in K))
    print(f"   builder short of: head {sh[0]:.0%} l {sh[1]:.0%} L {sh[2]:.0%} battery {sh[3]:.0%} · in {m('whole.supply'):.2f} out {m('whole.loss'):.2f}"
          f" · births/s {m('division.rate.births'):.1f}")
