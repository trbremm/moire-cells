"""Step C12g: the numbers of the ion-flow runs (and the C12e oxygen runs to compare), as markdown rows. Run from the repository:
    python experiments/conditions/c12g/analyse.py [run ...]
Reads experiments/runs/<run>/samples.csv (default: every c12g-oxy-* run and the C12e oxygen runs).
"""
import csv
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")


def f(x, k, d=0.0):
    try:
        return float(x.get(k, ''))
    except (ValueError, TypeError):
        return d


def at(rows, t):
    return min(rows, key=lambda x: abs(f(x, 't') - t))


def rows(name):
    path = f'experiments/runs/{name}/samples.csv'
    return list(csv.DictReader(open(path, encoding='utf-8'))) if os.path.exists(path) else []


def books(r):
    rd = [f(x, 'heat.rounding') for x in r]
    am = max(abs(f(x, 'matter.rounding')) for x in r)
    qm = max(abs(f(x, 'charge.qRound')) for x in r)
    return f"{min(rd):+.2f}..{max(rd):+.2f} / {am:g} / {qm:g}"


def mean(r, k, t0, t1=1e9):
    late = [x for x in r if t0 <= f(x, 't') <= t1]
    return sum(f(x, k) for x in late) / max(1, len(late))


RUNS = ['c12e-oxy-spot_s3', 'c12e-oxy-spot_s7', 'c12e-oxy-full_s3', 'c12e-oxy-full_s7',
        'c12g-oxy-spot_s3', 'c12g-oxy-spot_s7', 'c12g-oxy-full_s3', 'c12g-oxy-full_s7',
        'c12g-oxy-spot-np_s3', 'c12g-oxy-spot-np_s7', 'c12g-oxy-full-np_s3', 'c12g-oxy-full-np_s7',
        'c12g-oxy-full-null_s3', 'c12g-oxy-full-null_s7', 'c12g-oxy-full-noblock', 'c12g-pilot']
TIMES = [600, 1200, 1800, 2400]


def tt(r, k, fmt='{:.0f}'):
    return ' / '.join(fmt.format(f(at(r, t), k)) for t in TIMES if f(r[-1], 't') >= t - 30)


def main_table(names):
    print('| run | cells 10 / 20 / 30 / 40 min | free t (oxygen) | breathing into batteries per s | swollen / shrunk (>10 %) at the end | torn, bursts per s | mean integrity | ENTROPY end | books: energy / atoms / charge |')
    print('|---|---|---|---|---|---|---|---|---|')
    for name in names:
        r = rows(name)
        if len(r) < 3:
            continue
        e = r[-1]
        print(f"| {name} | {tt(r, 'alive')} | {tt(r, 'dish.t')} | {mean(r, 'electrons.rate.eBreath', 300):.0f} |"
              f" {f(e, 'waste.up'):.0f} / {f(e, 'waste.down'):.0f} | {mean(r, 'waste.rate.tear', 300):.2f}, {mean(r, 'membrane.rate.bursts', 300):.2f} |"
              f" {f(e, 'membrane.integ'):.2f} | {f(e, 'heat.out') / 1e6:.1f} M | {books(r)} |")


def ion_table(names):
    print('| run | ions held back (share, mean 5 min..end) | ions in per s: + / − (mean) | membranes pass + / − of a neutral (end) | tight cells (end) | channel level gene 10 min → end | balance gene 10 min → end | channels + / − (end) | + only / − only (end) |')
    print('|---|---|---|---|---|---|---|---|---|')
    for name in names:
        r = rows(name)
        if len(r) < 3 or 'ions.gene' not in r[-1]:
            continue
        e = r[-1]
        g = lambda k, sd: ' → '.join(f"{f(at(r, t), k):+.2f}±{f(at(r, t), sd):.2f}" for t in (600, f(e, 't')))
        print(f"| {name} | {100 * mean(r, 'ions.blockShare', 300):.0f}% | {mean(r, 'ions.rate.cIn', 300):.1f} / {mean(r, 'ions.rate.aIn', 300):.1f} |"
              f" {f(e, 'ions.passC'):.2f} / {f(e, 'ions.passA'):.2f} | {f(e, 'ions.tight'):.0f} of {f(e, 'ions.n'):.0f} | {g('ions.gene', 'ions.sdGene')} | {g('ions.bal', 'ions.sdBal')} |"
              f" {f(e, 'ions.cat'):.2f} / {f(e, 'ions.an'):.2f} | {f(e, 'ions.csel'):.0f} / {f(e, 'ions.asel'):.0f} |")


def t_table(names):
    print('| run | free t made inside / taken in / put out per s (mean 5 min..end) | breathers on OUTSIDE t / on their OWN t (10 / 20 / 30 / 40 min) | pumps at the end: t OUT / t IN / g OUT / T OUT | stretch channels gene 10 min → end | pressure, swelling (mean 5 min..end) |')
    print('|---|---|---|---|---|---|')
    for name in names:
        r = rows(name)
        if len(r) < 3 or 'waste.outb' not in r[-1]:
            continue
        e = r[-1]
        br = ' / '.join(f"{f(at(r, t), 'waste.outb'):.0f}/{f(at(r, t), 'waste.selfb'):.0f}" for t in TIMES if f(e, 't') >= t - 30)
        g = ' → '.join(f"{f(at(r, t), 'waste.gch'):+.2f}±{f(at(r, t), 'waste.sdch'):.2f}" for t in (600, f(e, 't')))
        print(f"| {name} | {mean(r, 'waste.rate.tMade', 300):.1f} / {mean(r, 'waste.rate.tIn', 300):.1f} / {mean(r, 'waste.rate.tOut', 300):.1f} | {br} |"
              f" {f(e, 'waste.pumps.tOut'):.0f} / {f(e, 'waste.pumps.tIn'):.0f} / {f(e, 'waste.pumps.gOut'):.0f} / {f(e, 'waste.pumps.TOut'):.0f} |"
              f" {g} | {mean(r, 'waste.P', 300):+.4f}, {mean(r, 'waste.w', 300):+.4f} |")


if __name__ == '__main__':
    names = sys.argv[1:] or RUNS
    main_table(names)
    print()
    ion_table(names)
    print()
    t_table(names)
