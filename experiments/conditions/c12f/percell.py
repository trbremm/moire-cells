"""Step C12f: per-cell look at the gradient eaters in a snapshot (with grid). python experiments/conditions/c12f/percell.py <run> [time]"""
import glob, json, math, struct, sys
sys.path.insert(0, 'experiments/conditions/c12f')
from analyse import unpack, classify, ENG
run = sys.argv[1]
paths = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'))
p = [x for x in paths if len(sys.argv) < 3 or f"_t{sys.argv[2]}." in x][-1]
S = json.load(open(p, encoding='utf-8'))
CW, B, SW = S['layout']['cellWords'], S['layout']['bioWords'], S['layout']['stockWords']
R = S['R']; n = S['alive']
f = struct.unpack(f'<{n * CW}f', unpack(S['cells']['rec']))
g = struct.unpack(f'<{n * B}f', unpack(S['cells']['bio']))
st = struct.unpack(f'<{n * SW}i', unpack(S['cells']['stock']))
G = S['grid']; hw, hh, px = G['hw'], G['hh'], G['px']; bl = G['blocks']; nn = hw * hh
data = struct.unpack(f'<{nn * len(bl)}i', unpack(G['data']))
conc = 1 / (4096 * (px / R) ** 2)
vents = [(s['x'], s['y']) for s in S['springs'] if s['kind'] == 'heavy']
print(f'{p}: {n} cells')
print(' dist  bat  r/R  perm | in: g T gT G | out: g T G /R2 | engines')
for i in range(n):
    x, y = f[i * CW], f[i * CW + 1]
    d = min(math.hypot(x - a, y - b) for a, b in vents) / R
    q = int(y / px) * hw + int(x / px)
    out = [data[bl.index(c) * nn + q] * conc for c in ('g', 'T', 'G')]
    s = st[i * SW:(i + 1) * SW]
    eng = []
    for k in range(3):
        if g[i * B + 36 + k] >= 0.1:
            eng.append(f"{ENG[min(int(round(g[i * B + 32 + k])) & 31, 21)]}@{g[i * B + 36 + k]:.1f}")
    print(f'{d:5.1f} {f[i * CW + 16]:.2f} {f[i * CW + 4] / R:.2f} {g[i * B + 39]:4.1f} | {s[0] / 4096:.2f} {s[4] / 4096:.2f} {s[7] / 4096:.2f} {s[3] / 4096:.2f} | {out[0]:.2f} {out[1]:.2f} {out[2]:.2f} | {", ".join(eng)}')
