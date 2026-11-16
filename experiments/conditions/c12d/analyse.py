"""Step C12d: the numbers of the electrons runs, as markdown rows. Run from the repository:
    python experiments/conditions/c12d/analyse.py
Reads experiments/runs/c12d-*/samples.csv.
"""
import csv
import glob
import os


def f(x, k, d=0.0):
    try:
        return float(x.get(k, ''))
    except ValueError:
        return d


def at(rows, t):
    return min(rows, key=lambda x: abs(f(x, 'trun', f(x, 't')) - t))


def rows(name):
    path = f'experiments/runs/{name}/samples.csv'
    return list(csv.DictReader(open(path, encoding='utf-8'))) if os.path.exists(path) else []


def books(r):
    rd = [f(x, 'heat.rounding') for x in r]
    am = max(abs(f(x, 'matter.rounding')) for x in r)
    qm = max(abs(f(x, 'charge.qRound')) for x in r)
    return f"{min(rd):+.2f}..{max(rd):+.2f} / {am:g} / {qm:g}"


def mean(r, k, t0):
    late = [x for x in r if f(x, 'trun', f(x, 't')) >= t0]
    return sum(f(x, k) for x in late) / max(1, len(late))


def default_table():
    print('| run | cells 5 / 10 / 15 / 20 min | eat / harvest / both / other at 20 min | into batteries per s (mean from 5 min) | breathing / fermenting into batteries per s | free t / G / rust / fuel at 20 min | births per s | ENTROPY 20 min, rate | ORDER | books: energy / atoms / charge |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for path in sorted(glob.glob('experiments/runs/c12d-default-*')):
        name = os.path.basename(path)
        r = rows(name)
        if len(r) < 3:
            continue
        times = [300, 600, 900, 1200]
        cells = ' / '.join(str(int(f(at(r, t), 'alive'))) for t in times)
        e = r[-1]
        n = max(1.0, sum(f(e, f'engines.all.{k}.n') for k in range(4)))
        st = ' / '.join(f"{100 * f(e, f'engines.all.{k}.n') / n:.0f}%" for k in (1, 0, 2, 3))
        print(f"| {name} | {cells} | {st} | {mean(r, 'cells.rate2.eGain', 300):.1f} |"
              f" {mean(r, 'electrons.rate.eBreath', 300):.2f} / {mean(r, 'electrons.rate.eFerment', 300):.2f} |"
              f" {f(e, 'dish.t'):.0f} / {f(e, 'dish.G'):.0f} / {f(e, 'dish.Gt'):.0f} / {f(e, 'dish.gT') + f(e, 'dish.GT'):.0f} |"
              f" {mean(r, 'division.rate.births', 300):.2f} | {f(e, 'heat.out') / 1e6:.1f} M, {mean(r, 'heat.rate.out', 300) / 1e3:.1f} k/s |"
              f" {f(e, 'matter.order'):.3f} | {books(r)} |")


def oxygen_table():
    print('| run | cells 10 / 20 / 30 / 40 min | free t (oxygen) | rust Gt | free G (the sink) | made by light in the open, photochemistry per s | harvesters (eat+harvest / harvest only) | breathing carriers | breathing: events / energy per s | fermenting energy per s | bursts per s | ENTROPY 40 min | ORDER | books |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for path in sorted(glob.glob('experiments/runs/c12d-oxy-*')):
        name = os.path.basename(path)
        r = rows(name)
        if len(r) < 3:
            continue
        times = [600, 1200, 1800, 2400]
        T = lambda k: ' / '.join(f"{f(at(r, t), k):.0f}" for t in times)
        cells = ' / '.join(str(int(f(at(r, t), 'alive'))) for t in times)
        hv = ' / '.join(f"{f(at(r, t), 'engines.all.2.n'):.0f}+{f(at(r, t), 'engines.all.0.n'):.0f}" for t in times)
        br = ' / '.join(f"{f(at(r, t), 'engines.breath.lit') + f(at(r, t), 'engines.breath.dark'):.0f}" for t in times)
        bu = ' / '.join(f"{f(at(r, t), 'membrane.rate.bursts'):.1f}" for t in times)
        e = r[-1]
        print(f"| {name} | {cells} | {T('dish.t')} | {T('dish.Gt')} | {T('dish.G')} | {mean(r, 'electrons.rate.photo', 300):.1f} | {hv} | {br} |"
              f" {mean(r, 'cells.rate2.eSwap', 300):.2f} / {mean(r, 'electrons.rate.eBreath', 300):.2f} | {mean(r, 'electrons.rate.eFerment', 300):.2f} | {bu} |"
              f" {f(e, 'heat.out') / 1e6:.1f} M | {f(e, 'matter.order'):.3f} | {books(r)} |")


if __name__ == '__main__':
    default_table()
    print()
    oxygen_table()
