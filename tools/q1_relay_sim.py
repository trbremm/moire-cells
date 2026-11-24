"""Step Q1: a small model of the hand-wired RELAY (src/tissues.js relayGenome) on a hex sheet, junction hearing only, the gene network's
update as in cell_grn.wgsl. Usage: python tools/q1_relay_sim.py b1=1 b2=0 b3=1 (a space-time row: # firing, - refractory); scan=1 lists the
bias sets where a touch at one edge sends a pulse that travels and every cell returns to rest. Standard library only."""
import math, sys, itertools
# 1D-ish hex strip of relay cells with given derived weights (R1 release, R2 slow, R3 fast); junction hearing only
args = dict(a.split('=') for a in sys.argv[1:] if '=' in a)
W, H = int(args.get('W', 22)), int(args.get('H', 5))
dt = 1 / 60
P = 0.004
hearJ = float(args.get('hearJ', 2e-4))
tauF, tau2 = float(args.get('tauF', 0.3)), float(args.get('tau2', 5.0))
fast3 = True
# weights: (target, source) -> w ; sources: 'x1','x2','x3','s'
WT = eval(args.get('wt', "{'1s':-2.47,'12':2.56,'13':-2.23,'21':-2.7,'23':3.19,'31':-2.91,'32':-2.3,'3s':1.5}"))
u = float(args.get('u', -8))
sides = 6.0
sig = lambda h: 1 / (1 + math.exp(-max(-30, min(30, h))))
cells = [(x, y) for y in range(H) for x in range(W)]
idx = {c: k for k, c in enumerate(cells)}
def nb(x, y):
    off = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(-1, 1), (-1, -1)] if y % 2 == 0 else [(1, 1), (1, -1)])
    return [idx[(x + a, y + b)] for a, b in off if (x + a, y + b) in idx]
N = [nb(*c) for c in cells]
n = len(cells)

def run(b1, b2, b3, T=20, show=False, stimT=0.4):
    x1 = [0.9] * n; x2 = [0.1] * n; x3 = [0.05] * n
    def step(heard):
        for k in range(n):
            s = heard[k]
            h1 = b1 + WT.get('1s', 0) * s + WT.get('12', 0) * x2[k] + WT.get('13', 0) * x3[k]
            h2 = b2 + WT.get('2s', 0) * s + WT.get('21', 0) * x1[k] + WT.get('23', 0) * x3[k]
            h3 = b3 + WT.get('3s', 0) * s + WT.get('31', 0) * x1[k] + WT.get('32', 0) * x2[k]
            x1[k] += dt / tauF * (sig(h1) - x1[k]); x3[k] += dt / tauF * (sig(h3) - x3[k]); x2[k] += dt / tau2 * (sig(h2) - x2[k])
    for _ in range(1500): step([0] * n)
    rest = (x1[0], x2[0], x3[0])
    restRel = math.exp(u * x1[0])
    if restRel > 0.02: return None
    onset = [None] * n; last = [None] * n
    stim = [idx[(1, y)] for y in range(H)]
    t = 0.0; rows = []
    fires = [0] * n; prev = [False] * n
    while t < T:
        rel = [min(math.exp(u * x1[k]), 4) * P for k in range(n)]
        heard = []
        for k in range(n):
            s = sum(rel[j] / sides for j in N[k])
            if k in stim and t < stimT: s += 3 * hearJ
            heard.append(1 - math.exp(-s / hearJ))
        step(heard)
        for k in range(n):
            f = rel[k] > 0.1 * P
            if f and not prev[k]:
                fires[k] += 1
                if onset[k] is None: onset[k] = t
            if f: last[k] = t
            prev[k] = f
        t += dt
        if show and int(t / 0.5) != int((t - dt) / 0.5):
            rows.append('%5.1f %s' % (t, ''.join('#' if min(math.exp(u * x1[idx[(x, H // 2)]]), 4) > 0.1 else ('-' if x2[idx[(x, H // 2)]] > 0.5 else '.') for x in range(W))))
    mid = [onset[idx[(x, H // 2)]] for x in range(W)]
    endOn = sum(1 for k in range(n) if prev[k])
    return dict(rest=rest, restRel=restRel, mid=mid, endOn=endOn, fires=max(fires), rows=rows, last=[last[idx[(x, H // 2)]] for x in range(W)])

if args.get('scan'):
    good = []
    for b1, b2, b3 in itertools.product([0, 0.5, 1, 1.5, 2, 2.5, 3], [-2, -1, -0.5, 0, 0.5, 1], [-2, -1, 0, 1, 2]):
        r = run(b1, b2, b3, T=15)
        if not r: continue
        ok = all(o is not None for o in r['mid'][2:])
        if ok and r['endOn'] == 0:
            sp = (len(r['mid']) - 3) / (r['mid'][-1] - r['mid'][2] + 1e-9)
            width = [(l - o) for o, l in zip(r['mid'], r['last']) if o is not None and l is not None]
            good.append((b1, b2, b3, round(sp, 2), round(sum(width) / len(width), 2), r['fires'], round(r['restRel'], 4)))
    for g in good: print(g)
else:
    r = run(float(args['b1']), float(args['b2']), float(args['b3']), T=float(args.get('T', 25)), show=True)
    print(r and (r['rest'], r['restRel'], r['endOn'], r['fires']))
    if r:
        for row in r['rows']: print(row)
        print([None if o is None else round(o, 2) for o in r['mid']])
