"""Step N1: the light's share of the batteries' income and why photons go unused, per run (means over a window of samples).
python experiments/conditions/n1/analyse.py <run> [<run> ...] [--from 300] [--to 900]"""
import csv, sys
sys.stdout.reconfigure(encoding='utf-8')

opt, args, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'):
        opt[a] = next(it)
    else:
        args.append(a)
t0 = float(opt.get('--from', 300)); t1 = float(opt.get('--to', 1e9))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


COLS = ['alive', 'cells.rate2.eGain', 'lightmatter.fromLight', 'lightmatter.rate.caught', 'lightmatter.rate.iSat', 'lightmatter.rate.iCof',
        'lightmatter.rate.iMat', 'lightmatter.rate.iCap', 'lightmatter.rate.iBat', 'lightmatter.rate.iWaste', 'lightmatter.held', 'lightmatter.cells',
        'lightmatter.rate.built', 'lightmatter.rate.wear', 'lightmatter.rate.inhib', 'catalysts.factor', 'catalysts.factorLit', 'dish.trace', 'inside.trace',
        'dish.gt', 'inside.gt', 'dish.T', 'inside.T', 'dish.l', 'inside.l', 'dish.gT', 'dish.GT', 'engines.all.0.n', 'engines.all.1.n', 'engines.all.2.n',
        'engines.all.3.n', 'heat.rate.out', 'matter.order', 'heat.rounding', 'matter.rounding', 'charge.qRound']
for run in args:
    rows = list(csv.DictReader(open(f'experiments/runs/{run}/samples.csv', encoding='utf-8')))
    win = [r for r in rows if t0 <= (num(r.get('t')) or 0) <= t1]
    m = {}
    for c in COLS:
        v = [num(r.get(c)) for r in win]
        v = [x for x in v if x is not None]
        m[c] = sum(v) / len(v) if v else float('nan')
    last = rows[-1]
    caught = max(m['lightmatter.rate.caught'], 1e-9)
    pc = lambda k: 100 * m[f'lightmatter.rate.{k}'] / caught
    used = 100 - sum(pc(k) for k in ('iSat', 'iCof', 'iMat', 'iCap', 'iBat', 'iWaste'))
    share = 100 * m['lightmatter.fromLight'] / max(m['cells.rate2.eGain'], 1e-9)
    print(f"## {run}  (t {t0:.0f}..{min(t1, num(last['t'])):.0f} s, {len(win)} samples)")
    print(f"cells {m['alive']:.0f} (end {num(last['alive']):.0f}) · batteries +{m['cells.rate2.eGain']:.2f}/s · light made {m['lightmatter.fromLight']:.2f}/s = {share:.0f} % of it")
    print(f"photons caught {m['lightmatter.rate.caught']:.3f} units/s: used {used:.0f} % · idle: saturated {pc('iSat'):.0f} %, no trace (cofactor) {pc('iCof'):.0f} %, no material {pc('iMat'):.0f} %, top speed {pc('iCap'):.0f} %, battery {pc('iBat'):.0f} %, clogged {pc('iWaste'):.0f} %")
    print(f"pigment held {m['lightmatter.held']:.3f} in {m['lightmatter.cells']:.0f} cells · built {m['lightmatter.rate.built']:.4f}/s worn {m['lightmatter.rate.wear']:.4f}/s bleached {m['lightmatter.rate.inhib']:.4f}/s")
    print(f"engines at {100 * m['catalysts.factor']:.0f} % (lit {100 * m['catalysts.factorLit']:.0f} %) · trace dish {m['dish.trace']:.2f} cells {m['inside.trace']:.3f} · gt dish {m['dish.gt']:.1f} cells {m['inside.gt']:.2f} · T dish {m['dish.T']:.1f} cells {m['inside.T']:.2f} · l dish {m['dish.l']:.1f} cells {m['inside.l']:.2f} · fuel gT {m['dish.gT']:.1f} GT {m['dish.GT']:.1f}")
    n = [num(last[f'engines.all.{k}.n']) or 0 for k in range(4)]
    tot = max(sum(n), 1)
    print(f"strategies at the end (harvest / eat / both / other): {' / '.join(f'{100 * x / tot:.0f}' for x in n)} % · entropy rate {m['heat.rate.out']:.0f}/s · ORDER {m['matter.order']:.3f}")
    print(f"books: energy rounding {min(num(r['heat.rounding']) for r in rows):+.3f}..{max(num(r['heat.rounding']) for r in rows):+.3f}, atoms {max(abs(num(r['matter.rounding']) or 0) for r in rows):.0f}, charge {max(abs(num(r['charge.qRound']) or 0) for r in rows):.0f}")
    print()
