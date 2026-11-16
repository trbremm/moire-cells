"""Step N1: where life is, from a run's last snapshot (with grid): the share of the cells within D R of an oasis against the share of the
dish's area there, the trace per R^2 under the cells against the dish's mean, the caustic light is not in a snapshot (per frame), the
pigment held per cell, the batteries near and far.
python experiments/conditions/n1/where.py <run> [<run> ...] [--d 15] [--t 600]"""
import base64, glob, gzip, json, math, os, re, struct, sys

sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'):
        opt[a] = next(it)
    else:
        runs.append(a)
D = float(opt.get('--d', 15))


def unpack(p):
    raw = base64.b64decode(p['b64'])
    return gzip.decompress(raw) if p.get('enc') == 'gzip' else raw


for run in runs:
    # (the last snapshot by its time, or the one at --t s; 'snap_t1200' sorts before 'snap_t600' as text)
    snaps = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'), key=lambda q: float((re.findall(r't(\d+)', os.path.basename(q)) or ['0'])[-1]))
    if '--t' in opt: snaps = [q for q in snaps if os.path.basename(q) == f"snap_t{opt['--t']}.json"]
    p = snaps[-1]
    S = json.load(open(p, encoding='utf-8'))
    CW, SW = S['layout']['cellWords'], S['layout']['stockWords']
    R, n = S['R'], S['alive']
    f = struct.unpack(f'<{n * CW}f', unpack(S['cells']['rec']))
    st = struct.unpack(f'<{n * SW}i', unpack(S['cells']['stock']))
    W, H = S['view']['cssW'], S['view']['cssH']
    oases = [(s['x'], s['y']) for s in S['springs'] if s['kind'] == 'oasis']
    G = S.get('grid')
    tr = None
    if G:
        hw, hh, px, bl = G['hw'], G['hh'], G['px'], G['blocks']
        nn = hw * hh
        data = struct.unpack(f'<{nn * len(bl)}i', unpack(G['data']))
        conc = 1 / (4096 * (px / R) ** 2)
        k = bl.index('trace')
        tr = lambda x, y: data[k * nn + min(hh - 1, int(y / px)) * hw + min(hw - 1, int(x / px))] * conc
        trMean = sum(data[k * nn:(k + 1) * nn]) * conc / nn
    near, bat_n, bat_f, pig_n, pig_f, trc = 0, [], [], [], [], []
    for i in range(n):
        x, y = f[i * CW], f[i * CW + 1]
        d = min((math.hypot(x - a, y - b) for a, b in oases), default=1e9) / R
        b = st[i * SW + 13] / 65536
        pg = st[i * SW + 30] / 4096
        if d <= D:
            near += 1; bat_n.append(b); pig_n.append(pg)
        else:
            bat_f.append(b); pig_f.append(pg)
        if tr:
            trc.append(tr(x, y))
    # the dish's area within D R of an oasis (sampled)
    inside = sum(1 for yy in range(60) for xx in range(96)
                 if min((math.hypot((xx + 0.5) / 96 * W - a, (yy + 0.5) / 60 * H - b) for a, b in oases), default=1e9) / R <= D)
    area = inside / (96 * 60)
    mean = lambda v: sum(v) / len(v) if v else float('nan')
    print(f"## {run} (t {S['time']:.0f} s): {n} cells, {len(oases)} oases")
    print(f"within {D:.0f} R of an oasis: {100 * near / max(n, 1):.0f} % of the cells on {100 * area:.0f} % of the dish (x{(near / max(n, 1)) / max(area, 1e-9):.1f})"
          f" · battery near {mean(bat_n):.2f} far {mean(bat_f):.2f} · pigment per cell near {mean(pig_n):.4f} far {mean(pig_f):.4f}")
    if tr:
        print(f"trace under the cells {mean(trc):.4f} per R^2, the dish's mean {trMean:.4f} (x{mean(trc) / max(trMean, 1e-12):.1f})")
    print()
