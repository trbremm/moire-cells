"""Step T1a: the tissues cell by cell, from a run's snapshots. python experiments/conditions/t1a/analyse.py <run> [<run> ...] [--t 1800]
Per snapshot (every one, or the one at --t s):
  colonies    lineages (founder id) alive and their sizes; how sorted the dish is: the share of contacts between cells of the same founder
              against what random mixing of these numbers would give (sum of p^2)
  kinship     the marker match over contacts (same formula as kin_match), between same-founder and different-founder pairs
  inside      cells by their free sides (0, 1-2, 3-4, 5-6; a side covered by the neighbour listed across it, pressed: < press x the radii):
              battery, membrane integrity, free t (oxygen-like) in the stock
  genes       kin channels (mean, sd, share above 0.25), tolerance, display (mean, sd), marker spread inside each founder lineage (the clock)"""
import base64, glob, gzip, json, math, os, re, struct, sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = next(it)
    else: runs.append(a)
A = 4096.0
PRESS = float(opt.get('--press', 1.1))


def unpack(p):
    raw = base64.b64decode(p['b64'])
    return gzip.decompress(raw) if p.get('enc') == 'gzip' else raw


def snaps_of(run):
    s = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'), key=lambda x: float((re.findall(r't(\d+)', os.path.basename(x)) or ['0'])[-1]))
    if '--t' in opt: s = [x for x in s if os.path.basename(x) == f"snap_t{opt['--t']}.json"]
    return s


def kin_match(a, b, ell):
    qa = (math.exp(-a[1]) * math.cos(a[0]), math.exp(-a[1]) * math.sin(a[0]))
    qb = (math.exp(-b[1]) * math.cos(b[0]), math.exp(-b[1]) * math.sin(b[0]))
    n = math.hypot(qa[0] - qb[0], qa[1] - qb[1]) * ell
    return math.exp(-9.8696044 * n * n / 6) * (0.5 + 0.5 * math.cos(a[2] - b[2])) * min(max(a[3], 0), 1) * min(max(b[3], 0), 1)


def analyse(path):
    S = json.load(open(path, encoding='utf-8'))
    CW, B, SW = S['layout']['cellWords'], S['layout']['bioWords'], S['layout']['stockWords']
    R, n = S['R'], S['alive']
    f = struct.unpack(f'<{n * CW}f', unpack(S['cells']['rec']))
    u = struct.unpack(f'<{n * CW}I', unpack(S['cells']['rec']))
    g = struct.unpack(f'<{n * B}f', unpack(S['cells']['bio']))
    st = struct.unpack(f'<{n * SW}i', unpack(S['cells']['stock']))
    idx = struct.unpack(f'<{n}I', unpack(S['cells']['idx'])) if S['cells'].get('idx') else list(range(n))
    slot = {s: k for k, s in enumerate(idx)}
    C = []
    for i in range(n):
        o, b, s = i * CW, i * B, i * SW
        nb = []
        for w in range(3):
            v = u[o + 60 + w]
            nb += [v & 0xffff, v >> 16]
        C.append(dict(x=f[o], y=f[o + 1], r=f[o + 4], bat=f[o + 16], integ=sum(f[o + 48:o + 54]) / 6, nb=nb,
                      fid=int(round(g[b + 7])), mark=(g[b + 76], g[b + 77], g[b + 78], g[b + 79]) if B > 76 else (0, 0, 0, 0),
                      kin=g[b + 80] if B > 80 else 0, tol=g[b + 81] if B > 81 else 0, t=st[s + 1] / A))
    # free sides and contacts
    pairs = set()
    for i, c in enumerate(C):
        cov = 0
        for k, j0 in enumerate(c['nb']):
            j = slot.get(j0)
            if j is None or j == i: continue
            d = C[j]
            if math.hypot(d['x'] - c['x'], d['y'] - c['y']) < PRESS * (c['r'] + d['r']):
                cov += 1
                if i in [slot.get(q) for q in d['nb']]: pairs.add((min(i, j), max(i, j)))
        c['free'] = 6 - cov
    # colonies
    cnt = Counter(c['fid'] for c in C)
    same = sum(1 for i, j in pairs if C[i]['fid'] == C[j]['fid'])
    chance = sum((v / n) ** 2 for v in cnt.values())
    ks, kd = [], []
    for i, j in pairs:
        m = kin_match(C[i]['mark'], C[j]['mark'], 0.5 * (C[i]['r'] + C[j]['r']) / R)
        (ks if C[i]['fid'] == C[j]['fid'] else kd).append(m)
    mean = lambda v: sum(v) / len(v) if v else float('nan')
    sd = lambda v: math.sqrt(max(0, mean([x * x for x in v]) - mean(v) ** 2)) if v else float('nan')
    print(f"  t {S['time']:.0f} s: {n} cells · lineages {len(cnt)}: {' '.join(f'{k}:{v}' for k, v in cnt.most_common(8))}")
    print(f"    contacts {len(pairs)} ({2 * len(pairs) / max(n, 1):.1f}/cell) · same founder {same / max(len(pairs), 1):.0%} (chance {chance:.0%})"
          f" · kinship same {mean(ks):.2f} (n {len(ks)}) different {mean(kd):.2f} (n {len(kd)})")
    bins = [(0, 0), (1, 2), (3, 4), (5, 6)]
    out = []
    for lo, hi in bins:
        R_ = [c for c in C if lo <= c['free'] <= hi]
        out.append(f"{lo}-{hi} free: {len(R_)} ({len(R_) / max(n, 1):.0%}) bat {mean([c['bat'] for c in R_]):.2f} integ {mean([c['integ'] for c in R_]):.2f} t {mean([c['t'] for c in R_]):.3f}")
    print('    by free sides: ' + ' | '.join(out))
    K = [c['kin'] for c in C]; D = [c['mark'][3] for c in C]; T = [c['tol'] for c in C]
    print(f"    genes: kin channel {mean(K):.3f}±{sd(K):.3f} (> 0.25: {sum(k > 0.25 for k in K) / max(n, 1):.0%}) · tolerance {mean(T):.2f}±{sd(T):.2f} · display {mean(D):.2f}±{sd(D):.2f}")
    # the clock: marker spread inside the three biggest lineages (angle sd, rad)
    sp = []
    for fid, v in cnt.most_common(3):
        a = [c['mark'][0] for c in C if c['fid'] == fid]
        cx, cy = mean([math.cos(x) for x in a]), mean([math.sin(x) for x in a])
        sp.append(f"{fid}: {math.sqrt(max(0, -2 * math.log(max(math.hypot(cx, cy), 1e-9)))):.3f}")
    print(f"    marker angle spread inside lineages (circular sd, rad): {' '.join(sp)}")
    # per lineage: kin gene and size (does sharing go with success?)
    rows = []
    for fid, v in cnt.most_common(6):
        L = [c for c in C if c['fid'] == fid]
        rows.append(f"{fid}:{v} kin {mean([c['kin'] for c in L]):.2f} disp {mean([c['mark'][3] for c in L]):.2f} bat {mean([c['bat'] for c in L]):.2f} enclosed {sum(c['free'] == 0 for c in L) / len(L):.0%}")
    print('    lineages: ' + ' | '.join(rows))
    B = []
    for lo, hi in bins:
        R_ = [c for c in C if lo <= c['free'] <= hi]
        B.append(dict(n=len(R_), share=len(R_) / max(n, 1), bat=mean([c['bat'] for c in R_]), integ=mean([c['integ'] for c in R_]), t=mean([c['t'] for c in R_])))
    return dict(bins=B, t=S['time'], n=n, lineages=len(cnt), same=same / max(len(pairs), 1), chance=chance, kinS=mean(ks), kinD=mean(kd),
                kin=mean(K), kinSd=sd(K), display=mean(D), tol=mean(T))


if __name__ == '__main__':
    for run in runs:
        print(f'== {run}')
        for p in snaps_of(run):
            analyse(p)
