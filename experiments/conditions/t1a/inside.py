"""Step T1a: rim against inside, a table over runs at one time. python experiments/conditions/t1a/inside.py <run> [...] [--t 1800]
Per run: the share of cells enclosed (0 free sides), with 1-2, 3-4, 5-6 free sides, and each group's battery, integrity, free t."""
import contextlib, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
t = args[args.index('--t') + 1] if '--t' in args else '1800'
runs = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--t')]
sys.argv = [sys.argv[0], '--t', t]
import analyse  # noqa: E402
sys.stdout.reconfigure(encoding='utf-8')
print('| run | enclosed | 1-2 free | 3-4 free | 5-6 free |')
print('|---|---|---|---|---|')
for run in runs:
    ps = analyse.snaps_of(run)
    if not ps: print(f'| {run} | no snapshot at {t} |'); continue
    with contextlib.redirect_stdout(io.StringIO()):
        r = analyse.analyse(ps[-1])
    cells = [f"{b['share']:.0%}: bat {b['bat']:.2f}, integ {b['integ']:.2f}, t {b['t']:.3f}" if b['n'] else '-' for b in r['bins']]
    print(f"| {run} | " + ' | '.join(cells) + ' |')
