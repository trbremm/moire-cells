"""Step P1: on against the controls, one row per run and time. python experiments/conditions/p1/compare.py <prefix> [--at 600,1200,1800,2400]
e.g. compare.py p1-col   (every run whose name starts with p1-col), compare.py p1-drop-default --at 600,1200,1800
Columns: cells, the engulf gene (mean, carriers), kin sparing (mean), meals per s, the meals' kinship against the contacts', single prey,
glue gene a0, clusters >= 8, singles, contacts per cell, armour, the crust wall gene, the lineages (>= 20 cells)."""
import csv, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8')
pre = sys.argv[1]
AT = [float(x) for x in (sys.argv[sys.argv.index('--at') + 1] if '--at' in sys.argv else '600,1200,1800,2400').split(',')]
print('| run | t (min) | cells | engulf (carriers) | spare | meals/s | meals\' kinship vs contacts\' | single prey | glue a0 | in clusters >= 8 | singles | contacts/cell | armour | wall gene | lineages |')
print('|' + '---|' * 15)
for p in sorted(glob.glob(f'experiments/runs/{pre}*/samples.csv')):
    run = os.path.basename(os.path.dirname(p))
    rows = list(csv.DictReader(open(p)))
    g = lambda r, k: float(r[k]) if (r.get(k) or '') not in ('', 'null', 'NaN') else float('nan')
    pc = lambda x: '-' if x != x else f'{100 * x:.0f}%'
    f2 = lambda x: '-' if x != x else f'{x:.2f}'
    for t in AT:
        r = min(rows, key=lambda r: abs(float(r['trun']) - t))
        if abs(float(r['trun']) - t) > 30: continue
        lin = [int(g(r, f'grn.lineages.{k}.n')) for k in range(8) if (r.get(f'grn.lineages.{k}.id') or '') != '']
        print(f"| {run.replace('p1-', '')} | {t / 60:.0f} | {g(r, 'alive'):.0f} | {f2(g(r, 'pred.genes.engulf'))} ({pc(g(r, 'pred.genes.carriers'))}) | {f2(g(r, 'pred.genes.spare'))}"
              f" | {f2(g(r, 'pred.rate.meals'))} | {f2(g(r, 'pred.recent.kinship'))} vs {f2(g(r, 'kin.kinship'))} | {pc(g(r, 'pred.recent.alone'))} | {f2(g(r, 'pred.genes.glue'))}"
              f" | {pc(g(r, 'pred.clusters.in8'))} | {pc(g(r, 'pred.clusters.singles'))} | {f2(g(r, 'pred.clusters.perCell'))} | {f2(g(r, 'pred.now.armour'))}"
              f" | {f2(g(r, 'lipids.wallGene'))} | {len(lin)} ({'/'.join(map(str, lin))}) |")
