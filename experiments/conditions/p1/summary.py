"""Step P1: the predators' numbers over time. python experiments/conditions/p1/summary.py <run> [...] [--at 300,600,1200,1800,2400] [--md out.md]
Per run and time (samples.csv): cells; the engulf and kin sparing genes (mean, carriers: engulf >= 0.25; the carriers' sparing); meals per s,
wraps and escapes; of the meals in the last ~10 s the share that were KIN (marker match > 0.5) and SINGLE cells (no glue to others); since the
start the kin share; LINKING: the glue gene a0 (as expressed), clusters (the share of cells in clusters of 8 and more, singles, contacts per cell,
the largest); ARMOUR: the hold's armour part, the crust wall gene, the membranes' stiffness; the lineages (grn census: founder id and size); the
books (atoms, charge rounding)."""
import csv, json, os, sys
sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = next(it)
    else: runs.append(a)
AT = [float(x) for x in opt.get('--at', '300,600,1200,1800,2400').split(',')]
out = []


def say(s=''):
    print(s)
    out.append(s)


for run in runs:
    p = os.path.join('experiments/runs', run, 'samples.csv')
    if not os.path.exists(p):
        say(f'{run}: no samples')
        continue
    rows = list(csv.DictReader(open(p)))
    g = lambda r, k: float(r[k]) if (r.get(k) or '') not in ('', 'null', 'NaN') else float('nan')
    say(f'### {run}')
    say('')
    say('| t (min) | cells | engulf (carriers) | spare (carriers\') | meals/s | wraps/s | escapes/s | kin meals (last 10 s / all) | kinship of meals (last 10 s) vs of contacts | single prey | glue a0 | in clusters >= 8 | singles | contacts/cell | largest | armour | wall gene | stiffness | lineages (id:cells) |')
    say('|' + '---|' * 19)
    for t in AT:
        r = min(rows, key=lambda r: abs(float(r['trun']) - t))
        if abs(float(r['trun']) - t) > 30: continue
        lin = [(int(g(r, f'grn.lineages.{k}.id')), int(g(r, f'grn.lineages.{k}.n'))) for k in range(8) if (r.get(f'grn.lineages.{k}.id') or '') != '']
        pc = lambda x: '-' if x != x else f'{100 * x:.0f}%'
        f2 = lambda x: '-' if x != x else f'{x:.2f}'
        say(f"| {float(r['trun']) / 60:.0f} | {g(r, 'alive'):.0f} | {f2(g(r, 'pred.genes.engulf'))} ({pc(g(r, 'pred.genes.carriers'))}) | {f2(g(r, 'pred.genes.spare'))} ({f2(g(r, 'pred.genes.carrierSpare'))})"
            f" | {f2(g(r, 'pred.rate.meals'))} | {f2(g(r, 'pred.rate.starts'))} | {f2(g(r, 'pred.rate.escapes'))} | {pc(g(r, 'pred.recent.kin'))} / {pc(g(r, 'pred.all.kin'))}"
            f" | {f2(g(r, 'pred.recent.kinship'))} vs {f2(g(r, 'kin.kinship'))} | {pc(g(r, 'pred.recent.alone'))} | {f2(g(r, 'pred.genes.glue'))} | {pc(g(r, 'pred.clusters.in8'))} | {pc(g(r, 'pred.clusters.singles'))}"
            f" | {f2(g(r, 'pred.clusters.perCell'))} | {g(r, 'pred.clusters.largest'):.0f} | {f2(g(r, 'pred.now.armour'))} | {f2(g(r, 'lipids.wallGene'))} | {f2(g(r, 'lipids.stiff'))}"
            f" | {' '.join(f'{a}:{b}' for a, b in lin)} |")
    mr = [g(r, 'matter.rounding') for r in rows]; qr = [g(r, 'charge.qRound') for r in rows]; er = [g(r, 'heat.rounding') for r in rows]
    last = rows[-1]
    say('')
    say(f"meals in all {g(last, 'pred.total.eaten'):.0f} (kin {g(last, 'pred.total.kin'):.0f}, single {g(last, 'pred.total.alone'):.0f}), wraps {g(last, 'pred.total.start'):.0f}, "
        f"escapes lost {g(last, 'pred.total.lost'):.0f} held {g(last, 'pred.total.held'):.0f} poor {g(last, 'pred.total.poor'):.0f} · books: atoms rounding max "
        f"|{max(abs(x) for x in mr if x == x):g}|, charge |{max(abs(x) for x in qr if x == x):g}|, energy {min(er):.3f}..{max(er):.3f}")
    # the alive count every minute (boom-bust?)
    mins = {}
    for r in rows:
        m = int(float(r['trun']) // 60)
        mins.setdefault(m, g(r, 'alive'))
    say('cells every minute: ' + ' '.join(f'{v:.0f}' for k, v in sorted(mins.items())))
    say('')
if '--md' in opt:
    with open(opt['--md'], 'a', encoding='utf-8') as fh:
        fh.write('\n'.join(out) + '\n')
