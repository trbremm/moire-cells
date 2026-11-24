"""Step L1: a small model of the PACEMAKER's gene network (src/tissues.js pacemakerGenome): six regulators at one lattice address in three
pairs, phases 0, s, 2 s; links derived as cell_grn.wgsl g3_derive does (same address: w = wMax cos(phase_r - phase_q + chi), the three
strongest with |w| >= wMin), update x += dt / tau (sigmoid(b + sum w x) - x). A doubled REPRESSILATOR: each pair inhibits the next (~-3.9)
and its twin excites it (+2.8), so the loop gain exceeds what one link (|w| <= 4) can give. Prints r0's swing and period for a few speed
choices and biases. Usage: python tools/l1_pacemaker.py [s=2.1]. Standard library only."""
import math, sys
args = dict(a.split('=') for a in sys.argv[1:] if '=' in a)
sig = lambda h: 1 / (1 + math.exp(-max(-30, min(30, h))))
CHI, WMAX, WMIN = math.pi / 4, 4, 1

def links(ph):
    out = []
    for r in range(len(ph)):
        c = sorted(((abs(w), q, w) for q in range(len(ph)) if q != r for w in [WMAX * math.cos(ph[r] - ph[q] + CHI)] if abs(w) >= WMIN), reverse=True)
        out.append([(q, w) for _, q, w in c[:3]])
    return out

def run(ph, bias, taus, T=300, dt=1 / 30):
    L = links(ph); x = [0.9, 0.9, 0.1, 0.1, 0.5, 0.5]; t = 0; ons = []; prev = False; lo, hi = 9, -9
    while t < T:
        h = [bias[r] + sum(w * x[q] for q, w in L[r]) for r in range(6)]
        x = [x[r] + dt / taus[r] * (sig(h[r]) - x[r]) for r in range(6)]
        t += dt
        if t > 60: lo, hi = min(lo, x[0]), max(hi, x[0])
        f = x[0] < 0.25
        if f and not prev and t > 60: ons.append(t)
        prev = f
    return hi - lo, (ons[-1] - ons[0]) / (len(ons) - 1) if len(ons) > 1 else None

s = float(args.get('s', 2.1))
ph = [0, 0, s, s, 2 * s, 2 * s]
print('links', [[(q, round(w, 2)) for q, w in L] for L in links(ph)])
for taus in [[0.3] * 6, [5] * 6, [0.3, 0.3, 5, 5, 5, 5], [0.3, 0.3, 5, 5, 0.3, 0.3]]:
    for b in [1, 2, 3]:
        a, p = run(ph, [b] * 6, taus)
        print('taus', taus, 'bias', b, 'r0 swing', round(a, 2), 'period', p and round(p, 1))
