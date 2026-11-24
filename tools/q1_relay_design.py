"""Step Q1: the search for the relay's regulator LATTICES (src/tissues.js RELAY_LATTICES): random placements of three regulators near the
signal's junction sense, the links derived as cell_grn.wgsl g3_derive does, kept when the wiring matches (r2 hears, r0 inhibited by r2 and
raised by r1, r1 lowered by r0) and both release outputs read r0. Standard library only; ~1 min."""
import math, random
PI3 = math.pi / 3
SIG, WMAX, WMIN, CHI = 0.12, 4.0, 1.0, math.pi / 4

def sense(s):
    return (((s & 3) + 0.5) * PI3 / 4, -0.375 + 0.25 * (s >> 2), s * 2.3999632)

def outp(o):
    return ((o % 5 + 0.5) * PI3 / 5, -0.45 + 0.3 * (o // 5))

def d2(a, b):
    x = a[0] - b[0]
    d = x - PI3 * round(x / PI3)
    return 2 * math.cosh(max(-4, min(4, a[1] - b[1]))) - 2 * math.cos(d)

def derive(th, lk, ph, nsrc=27):
    inv = 1 / (2 * SIG * SIG)
    out = []
    for r in range(8):
        best = []
        for q in range(1, nsrc):
            if q == r + 1: continue
            if q <= 8: a = (th[q - 1], lk[q - 1]); p = ph[q - 1]
            else: s = sense(q - 9); a = (s[0], s[1]); p = s[2]
            w = WMAX * math.exp(-d2((th[r], lk[r]), a) * inv) * math.cos(ph[r] - p + CHI)
            if abs(w) < WMIN: continue
            best.append((abs(w), q, w))
        best.sort(key=lambda t: -t[0])
        out.append([(q, round(w, 2)) for _, q, w in best[:3]])
    return out

def nearest(th, lk, o):
    a = outp(o)
    return min(range(8), key=lambda r: d2((th[r], lk[r]), a))

S16, S17 = sense(16), sense(17)
print('S16', S16, 'S17', S17, 'out20', outp(20), 'out21', outp(21))
random.seed(1)
best = None
for it in range(200000):
    th = [0] * 8; lk = [0] * 8; ph = [0] * 8
    for r in range(3):
        th[r] = random.uniform(0.0, 0.7); lk[r] = random.uniform(0.35, 0.75); ph[r] = random.uniform(0, 2 * math.pi)
    for r in range(3, 8):
        th[r] = 0.05 + 0.2 * (r - 3); lk[r] = -0.6; ph[r] = r * 1.3
    L = derive(th, lk, ph)
    # R1 = reg 0 (release), R2 = reg 1 (refractory, slow), R3 = reg 2 (excitable, hears)
    w = lambda r, q: dict(L[r]).get(q, 0.0)
    hearR3 = max(w(2, 26), 0)     # junction sense, positive
    hearR3w = max(w(2, 25), 0)    # water sense, positive (bonus)
    r1_3 = w(0, 3); r1_2 = w(0, 2); r1_s = abs(w(0, 26)) + abs(w(0, 25))
    r2_1 = w(1, 1)
    r3_1 = w(2, 1); r3_2 = w(2, 2)
    r2_s = abs(w(1, 26)) + abs(w(1, 25))
    ok = nearest(th, lk, 20) == 0 and nearest(th, lk, 21) == 0
    if not ok: continue
    score = min(hearR3, 4) + 0.5 * min(hearR3w, 3) - r1_3 + r1_2 - r2_1 - 0.5 * r3_1 - 0.5 * r3_2 - 2 * r1_s - 2 * r2_s
    if hearR3 < 1.5 or r1_3 > -1.5 or r1_2 < 1.5 or r2_1 > -1.5: continue
    if best is None or score > best[0]:
        best = (score, [round(x, 3) for x in th[:3]], [round(x, 3) for x in lk[:3]], [round(x, 3) for x in ph[:3]], L[:3])
print(best)
