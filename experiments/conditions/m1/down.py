"""Step M1: the downstream effects (ion block, osmosis, channel genes, oxygen kept or released), as means over a window of samples.
python experiments/conditions/m1/down.py <run> [...] [--from 600] [--to 1200]"""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = float(next(it))
    else: runs.append(a)
t0, t1 = opt.get('--from', 600), opt.get('--to', 1e9)
for run in runs:
    rows = [r for r in csv.DictReader(open(os.path.join('experiments/runs', run, 'samples.csv'))) if t0 <= float(r['trun']) <= t1]
    if not rows: print(run, 'no samples'); continue
    m = lambda k: sum(float(r.get(k) or 0) for r in rows) / len(rows)
    last = rows[-1]
    L = lambda k: float(last.get(k) or 0)
    print(f"{run} ({rows[0]['trun']}..{last['trun']} s): cells {m('alive'):.0f} (end {L('alive'):.0f}) · integrity {m('membrane.integ'):.2f} whole {m('whole.whole'):.0%} holes {m('whole.holey'):.0%}"
          f" · ions blocked {m('ions.blockShare'):.0%}, tight {m('ions.tight'):.0f} ({m('ions.tight') / max(m('alive'), 1):.0%}), pass + {m('ions.passC'):.2f} - {m('ions.passA'):.2f}"
          f" · swelling {m('ions.swell'):+.3f}, puffed {m('waste.up'):.0f} shrunk {m('waste.down'):.0f}, ions inside {m('waste.ions'):.2f}/R2"
          f" · channel gene {L('ions.gene'):+.2f} sd {L('ions.sdGene'):.2f}, balance {L('ions.bal'):+.2f} sd {L('ions.sdBal'):.2f} (+only {L('ions.csel'):.0f} -only {L('ions.asel'):.0f})"
          f" · stretch genes ch {L('waste.gch'):+.2f} sd {L('waste.sdch'):.2f} tol {L('waste.gtol'):+.2f}"
          f" · t: made {m('waste.rate.tMade'):.2f} in {m('waste.rate.tIn'):.2f} out {m('waste.rate.tOut'):.2f}/s, self-burners {m('waste.selfb'):.0f} outside-breathers {m('waste.outb'):.0f} of {m('waste.br'):.0f}, importers {m('waste.imp'):.0f} exporters {m('waste.exp'):.0f}, free t in dish {m('engines.free.t'):.0f}"
          f" · bursts {m('division.rate.burst'):.2f}/s tears {m('waste.rate.tear'):.2f}/s · ENTROPY {L('heat.out') / 1e6:.1f} M, ORDER {L('matter.order'):.3f}")
