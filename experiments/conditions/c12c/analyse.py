"""Step C12c: the numbers of the oxygen reruns (excited waste on and off), as markdown rows. Run from the repository:
    python experiments/conditions/c12c/analyse.py
Reads experiments/runs/c12c-*/samples.csv (and meta.json for the books).
"""
import csv
import glob
import os


def f(x, k, d=0.0):
    v = x.get(k, '')
    try:
        return float(v)
    except ValueError:
        return d


def at(rows, t):
    return min(rows, key=lambda x: abs(f(x, 't') - t))


def main():
    for path in sorted(glob.glob('experiments/runs/c12c-*/samples.csv')):
        name = os.path.basename(os.path.dirname(path))
        if any(s in name for s in ('check', 'old', 'reload')):
            continue
        r = list(csv.DictReader(open(path, encoding='utf-8')))
        if len(r) < 3:
            continue
        T = f(r[-1], 't')
        times = [t for t in (600, 1200, 1800, 2400) if t <= T + 1]
        late = [x for x in r if f(x, 't') >= 300]
        def mean(k, rows=late):
            return sum(f(x, k) for x in rows) / max(1, len(rows))
        def peak(k, rows=late):
            return max((f(x, k) for x in rows), default=0)
        cells = ' / '.join(str(int(f(at(r, t), 'alive'))) for t in times)
        haze = ' / '.join(f"{f(at(r, t), 'engines.free.g') + f(at(r, t), 'engines.free.t'):.0f}" for t in times)
        exc = ' / '.join(f"{f(at(r, t), 'excited.inDish'):.2f}" for t in times)
        bursts = ' / '.join(f"{f(at(r, t), 'membrane.rate.bursts'):.0f}" for t in times)
        carriers = ' / '.join(str(int(f(at(r, t), 'engines.breath.lit') + f(at(r, t), 'engines.breath.dark'))) for t in times)
        up = ' / '.join(str(int(f(at(r, t), 'engines.up.lit') + f(at(r, t), 'engines.up.dark'))) for t in times)
        end = r[-1]
        rd = [f(x, 'heat.rounding') for x in r]
        am = max(abs(f(x, 'matter.rounding')) for x in r)
        qm = max(abs(f(x, 'charge.qRound')) for x in r)
        print(f"| {name} | {cells} | {haze} | {exc} | made {mean('excited.rate.madeOpen'):.2f} + {mean('excited.rate.madeCell'):.2f} |"
              f" {mean('cells.rate2.eSwap'):.3f} (peak {peak('cells.rate2.eSwap'):.2f}) | {mean('excited.rate.eBreath'):.3f} |"
              f" {mean('excited.rate.eEngine'):.3f} | {mean('excited.rate.eBurn'):.0f} | {carriers} | {up} | {bursts} |"
              f" {f(end, 'heat.out') / 1e6:.1f} M | {f(end, 'matter.order'):.3f} | {min(rd):+.2f}..{max(rd):+.2f} / {am:g} / {qm:g} |")


if __name__ == '__main__':
    main()
