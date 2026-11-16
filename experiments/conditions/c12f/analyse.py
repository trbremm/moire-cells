"""Step C12f: vents in the dark, read from a run's snapshots (experiments/runs/<run>/snapshots/*.json). Run from the repository:
    python experiments/conditions/c12f/analyse.py c12f-dark_s3 [...]          # every snapshot of each run
    python experiments/conditions/c12f/analyse.py --last c12f-dark_s3          # only the last one

Prints, per snapshot:
  - the cells, their mean battery, and the RADIAL PROFILE: cells per 100 R^2 of dish in rings of distance from the NEAREST VENT
    (springs of kind 'heavy'), with their mean battery; and, with a grid snapshot, the mean temperature and the free G, g, T and
    the fuels gT, GT per R^2 in the same rings
  - the ENGINE CENSUS: cells carrying (rate >= 0.1) an engine that EATS THE GRADIENT (a free giver + the free heavy taker: g + T -> gT,
    G + T -> GT), FERMENTS (the other downhill engines without a free t: G + gt, G + gT, the trade), BREATHES (uses a free t),
    HARVESTS (uphill with a pigment), STORES (uphill without one), FORMS chains; and the cells whose STRONGEST downhill engine is
    each of those
  - every engine by how many cells carry it
"""
import base64, collections, glob, gzip, json, math, os, struct, sys
sys.stdout.reconfigure(encoding="utf-8")

ENG = ['gt → g + t', 'gT → g + T', 'Gt → G + t', 'GT → G + T', 'Gt + g → gt + G', 'gt + T → gT + t', 'GT + g → gT + G',
       'Gt + T → GT + t', 'gt + GT → gT + Gt', 'll → l + l', 'LL → L + L', 'g + t → gt', 'g + T → gT', 'G + t → Gt', 'G + T → GT',
       'G + gt → Gt + g', 't + gT → gt + T', 'G + gT → GT + g', 't + GT → Gt + T', 'gT + Gt → gt + GT', 'l + l → ll', 'L + L → LL']
GRADIENT = {12, 14}
BREATHE = {11, 13, 16, 18}
FERMENT = {15, 17, 19}
FORM = {20, 21}
BANDS = ['storer', 'V1', 'V2', 'hard']
RINGS = [0, 3, 6, 9, 12, 16, 20, 25, 30, 40, 60, 1e9]   # distance from the nearest vent, in R


def unpack(p):
    raw = base64.b64decode(p['b64'])
    return gzip.decompress(raw) if p.get('enc') == 'gzip' else raw


def classify(G):
    """(set of classes the cell carries, class of its strongest downhill engine)"""
    have, best, bestRate = set(), None, 0.1
    for k in range(3):
        r = G[36 + k]
        if not r >= 0.1:
            continue
        code = int(round(G[32 + k]))
        e, b = min(code & 31, len(ENG) - 1), code >> 5
        if e <= 10:
            have.add('harvest' if b > 0 else 'store')
            continue
        c = 'gradient' if e in GRADIENT else 'breathe' if e in BREATHE else 'ferment' if e in FERMENT else 'form'
        have.add(c)
        if c != 'form' and r > bestRate:
            best, bestRate = c, r
    return have, best


def analyse(path):
    S = json.load(open(path, encoding='utf-8'))
    CW, B, SW = S['layout']['cellWords'], S['layout']['bioWords'], S['layout']['stockWords']
    R = S['R']
    rec = unpack(S['cells']['rec'])
    n = len(rec) // (4 * CW)
    f = struct.unpack(f'<{n * CW}f', rec)
    g = struct.unpack(f'<{n * B}f', unpack(S['cells']['bio']))
    vents = [(s['x'], s['y']) for s in S.get('springs', []) if s.get('kind') == 'heavy']
    W, H = S['view']['cssW'], S['view']['cssH']
    print(f'== {os.path.basename(os.path.dirname(os.path.dirname(path)))} at {S.get("time", 0):.0f} s: {n} cells, {len(vents)} vents, '
          f'mean battery {sum(f[i * CW + 16] for i in range(n)) / max(n, 1):.3f}')
    nearest = lambda x, y: min((math.hypot(x - vx, y - vy) / R for vx, vy in vents), default=1e9)
    # the ring areas (R^2 of dish nearer to a vent than any other, at that distance), by a coarse raster of the dish
    nb = len(RINGS) - 1
    area = [0.0] * nb
    step = R
    grid = S.get('grid')
    gsum = [[0.0] * 7 for _ in range(nb)]
    gpx = [0] * nb
    if grid:
        hw, hh, px = grid['hw'], grid['hh'], grid['px']
        blocks = grid['blocks']
        data = struct.unpack(f'<{hw * hh * len(blocks)}i', unpack(grid['data']))
        nn = hw * hh
        bi = {b: k for k, b in enumerate(blocks)}
        conc = 1 / (4096 * (px / R) ** 2)
        tscale = 1 / (65536 * (px / R) ** 2)
        for p in range(nn):
            x, y = (p % hw + 0.5) * px, (p // hw + 0.5) * px
            d = nearest(x, y)
            k = next(j for j in range(nb) if RINGS[j] <= d < RINGS[j + 1])
            gpx[k] += 1
            v = gsum[k]
            v[0] += data[bi['heat'] * nn + p] * tscale
            for j, name in enumerate(['G', 'g', 'T', 'gT', 'GT', 't']):
                v[1 + j] += data[bi[name] * nn + p] * conc
    y = step / 2
    while y < H:
        x = step / 2
        while x < W:
            d = nearest(x, y)
            k = next(j for j in range(nb) if RINGS[j] <= d < RINGS[j + 1])
            area[k] += (step / R) ** 2
            x += step
        y += step
    cnt, bat = [0] * nb, [0.0] * nb
    census, strongest, engines = collections.Counter(), collections.Counter(), collections.Counter()
    ringClass = [collections.Counter() for _ in range(nb)]
    for i in range(n):
        x, y = f[i * CW], f[i * CW + 1]
        d = nearest(x, y)
        k = next(j for j in range(nb) if RINGS[j] <= d < RINGS[j + 1])
        cnt[k] += 1
        bat[k] += f[i * CW + 16]
        G = g[i * B:(i + 1) * B]
        have, best = classify(G)
        for c in have:
            census[c] += 1
        strongest[best or 'none'] += 1
        ringClass[k][best or 'none'] += 1
        for kk in range(3):
            if G[36 + kk] >= 0.1:
                code = int(round(G[32 + kk]))
                e, b = min(code & 31, len(ENG) - 1), code >> 5
                engines[ENG[e] + (f' [{BANDS[min(b, 3)]}]' if e <= 10 else '')] += 1
    print('  ring (R from the nearest vent) | cells per 100 R^2 | cells | battery' + (' | T(emp) G g T gT GT t per R^2' if grid else '') + ' | strongest engines')
    for k in range(nb):
        if area[k] <= 0:
            continue
        hi = '∞' if RINGS[k + 1] > 1e8 else f'{RINGS[k + 1]:g}'
        line = f'  {RINGS[k]:>4g}-{hi:<4} | {100 * cnt[k] / area[k]:7.2f} | {cnt[k]:5d} | {bat[k] / cnt[k] if cnt[k] else 0:5.2f}'
        if grid and gpx[k]:
            v = [s / gpx[k] for s in gsum[k]]
            line += ' | ' + ' '.join(f'{z:6.3f}' for z in v)
        line += ' | ' + ', '.join(f'{c} {m}' for c, m in ringClass[k].most_common(4))
        print(line)
    print('  carry:', ', '.join(f'{c} {m}' for c, m in census.most_common()), '· strongest downhill:', ', '.join(f'{c} {m}' for c, m in strongest.most_common()))
    print('  engines:', ', '.join(f'{e} {m}' for e, m in engines.most_common(12)))


def main():
    args = sys.argv[1:]
    last = '--last' in args
    for run in [a for a in args if not a.startswith('--')]:
        paths = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'), key=lambda p: float(p.split('_t')[-1].split('.json')[0]))
        for p in (paths[-1:] if last else paths):
            analyse(p)


if __name__ == '__main__':
    main()
