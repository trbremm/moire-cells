"""Step C12e: the numbers of the waste-must-leave runs (and the C12d oxygen runs to compare), as markdown rows. Run from the repository:
    python experiments/conditions/c12e/analyse.py
Reads experiments/runs/c12e-*/samples.csv and experiments/runs/c12d-oxy-*/samples.csv.
"""
import csv
import glob
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")


def f(x, k, d=0.0):
    try:
        return float(x.get(k, ''))
    except ValueError:
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


RUNS = ['c12d-oxy-spot_s3', 'c12d-oxy-spot_s7', 'c12d-oxy-full_s3', 'c12d-oxy-full_s7',
        'c12e-oxy-spot_s3', 'c12e-oxy-spot_s7', 'c12e-oxy-full_s3', 'c12e-oxy-full_s7',
        'c12e-oxy-spot-np_s3', 'c12e-oxy-spot-np_s7', 'c12e-oxy-full-np_s3', 'c12e-oxy-full-np_s7',
        'c12e-sat-only', 'c12e-osm-only']
TIMES = [600, 1200, 1800, 2400]


def main_table():
    print('| run | cells 10 / 20 / 30 / 40 min | free t (oxygen) | rust Gt | photochemistry in the open per s | breathing into batteries per s | lost to saturation | swollen / shrunk (>10 %) at 40 min | torn, bursts per s | ENTROPY 40 min | ORDER | books: energy / atoms / charge |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for name in RUNS:
        r = rows(name)
        if len(r) < 3:
            continue
        T = lambda k: ' / '.join(f"{f(at(r, t), k):.0f}" for t in TIMES)
        e = r[-1]
        sat = f"{100 * mean(r, 'waste.lostShare', 300):.0f}%" if 'waste.lostShare' in e else '-'
        sw = f"{f(e, 'waste.up'):.0f} / {f(e, 'waste.down'):.0f}" if 'waste.up' in e else '-'
        tear = f"{mean(r, 'waste.rate.tear', 300):.2f}, {mean(r, 'membrane.rate.bursts', 300):.2f}" if 'waste.up' in e else f"-, {mean(r, 'membrane.rate.bursts', 300):.2f}"
        print(f"| {name} | {T('alive')} | {T('dish.t')} | {T('dish.Gt')} | {mean(r, 'electrons.rate.photo', 300):.1f} | {mean(r, 'electrons.rate.eBreath', 300):.0f} |"
              f" {sat} | {sw} | {tear} | {f(e, 'heat.out') / 1e6:.1f} M | {f(e, 'matter.order'):.3f} | {books(r)} |")


def t_table():
    print('| run | free t made inside / taken in / put out per s (mean 5..40 min) | breathers on OUTSIDE t / on their OWN t (10 / 20 / 30 / 40 min) | net importers / exporters of t at 40 min | pumps at 40 min: t OUT / t IN / gt OUT / T OUT / g OUT | gene stretch channels (mean ± sd) 10 / 40 min | gene stretch tolerance 10 / 40 min | pressure, swelling (mean 5..40 min) |')
    print('|---|---|---|---|---|---|---|---|')
    for name in RUNS:
        r = rows(name)
        if len(r) < 3 or 'waste.outb' not in r[-1]:
            continue
        e = r[-1]
        br = ' / '.join(f"{f(at(r, t), 'waste.outb'):.0f}/{f(at(r, t), 'waste.selfb'):.0f}" for t in TIMES)
        g = lambda k, sd: ' → '.join(f"{f(at(r, t), k):+.2f}±{f(at(r, t), sd):.2f}" for t in (600, 2400))
        print(f"| {name} | {mean(r, 'waste.rate.tMade', 300):.1f} / {mean(r, 'waste.rate.tIn', 300):.1f} / {mean(r, 'waste.rate.tOut', 300):.1f} | {br} |"
              f" {f(e, 'waste.imp'):.0f} / {f(e, 'waste.exp'):.0f} |"
              f" {f(e, 'waste.pumps.tOut'):.0f} / {f(e, 'waste.pumps.tIn'):.0f} / {f(e, 'waste.pumps.gtOut'):.0f} / {f(e, 'waste.pumps.TOut'):.0f} / {f(e, 'waste.pumps.gOut'):.0f} |"
              f" {g('waste.gch', 'waste.sdch')} | {g('waste.gtol', 'waste.sdtol')} | {mean(r, 'waste.P', 300):+.4f}, {mean(r, 'waste.w', 300):+.4f} |")


if __name__ == '__main__':
    main_table()
    print()
    t_table()
