"""Step C12e: a colony's cells from a run's final snapshot (experiments/runs/<run>/snapshots/*.json). Run from the repository:
    python experiments/conditions/c12e/cells.py c12e-oxy-full_s3 [...]

Prints, per run:
  - osmosis: the swelling, the pressure, the membrane's integrity, the free ions inside (quantiles over the cells)
  - free t: per cell since its birth, made inside (stock word 62) and taken in from outside net (word 63); the cells that live on
    OUTSIDE t (a breathing engine, took in more than one unit and more than they made) against those burning their OWN (made more
    than one unit, at least what they took in), net exporters
  - PUMPS by substance and direction (slots with a rate of at least 0.05): how many cells carry each, and of the harvesters (a
    pigment engine) and of the breathers
  - the two stretch genes (channels Bio 55, tolerance Bio 74): mean, spread, quantiles
  - the engines (as c12d/engines.py)
"""
import base64, collections, glob, gzip, json, statistics, struct, sys
sys.stdout.reconfigure(encoding="utf-8")

ENG = ['gt → g + t', 'gT → g + T', 'Gt → G + t', 'GT → G + T', 'Gt + g → gt + G', 'gt + T → gT + t', 'GT + g → gT + G',
       'Gt + T → GT + t', 'gt + GT → gT + Gt', 'll → l + l', 'LL → L + L', 'g + t → gt', 'g + T → gT', 'G + t → Gt', 'G + T → GT',
       'G + gt → Gt + g', 't + gT → gt + T', 'G + gT → GT + g', 't + GT → Gt + T', 'gT + Gt → gt + GT', 'l + l → ll', 'L + L → LL']
BREATHE = {11, 13, 16, 18}   # the downhill engines that use a free t
BANDS = ['storer', 'V1', 'V2', 'hard']
SUB = ['g', 't', 'l', 'G', 'T', 'L', 'gt', 'gT', 'Gt', 'GT', 'll', 'LL', 'trace']


def unpack(p):
    raw = base64.b64decode(p['b64'])
    return gzip.decompress(raw) if p.get('enc') == 'gzip' else raw


def q(a, ks=(0, 0.1, 0.5, 0.9, 0.99, 1)):
    a = sorted(a)
    return [round(a[int(k * (len(a) - 1))], 3) for k in ks] if a else []


def main():
    for run in sys.argv[1:]:
        path = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'))[-1]
        S = json.load(open(path, encoding='utf-8'))
        CW, B, SW = S['layout']['cellWords'], S['layout']['bioWords'], S['layout']['stockWords']
        rec = unpack(S['cells']['rec'])
        n = len(rec) // (4 * CW)
        f = struct.unpack(f'<{n * CW}f', rec)
        g = struct.unpack(f'<{n * B}f', unpack(S['cells']['bio']))
        st = struct.unpack(f'<{n * SW}i', unpack(S['cells']['stock']))
        A = 4096
        print(f'== {run}: {n} cells (snapshot at {S.get("time", 0):.0f} s)')
        if CW >= 88:
            print('  swelling   ', q([f[i * CW + 84] for i in range(n)]))
            print('  pressure   ', q([f[i * CW + 85] for i in range(n)]))
        print('  integrity  ', q([sum(f[i * CW + 48:i * CW + 54]) / 6 for i in range(n)]))
        print('  free ions inside (units)', q([(st[i * SW] + st[i * SW + 1] + st[i * SW + 3] + st[i * SW + 4]) / A for i in range(n)]))
        made = [st[i * SW + 62] / A for i in range(n)]
        imp = [st[i * SW + 63] / A for i in range(n)]
        print('  t made     ', q(made), ' t taken in net', q(imp))
        pumps, pumpsH, pumpsB = collections.Counter(), collections.Counter(), collections.Counter()
        engines = collections.Counter()
        outside = own = brn = exporters = importers = 0
        for i in range(n):
            G = g[i * B:(i + 1) * B]
            harv = br = False
            for k in range(3):
                if G[36 + k] > 0:
                    code = int(round(G[32 + k]))
                    e, b = min(code & 31, len(ENG) - 1), code >> 5
                    engines[ENG[e] + (f' [{BANDS[min(b, 3)]}]' if e <= 10 else '')] += 1
                    harv = harv or (e <= 10 and b > 0)
                    br = br or e in BREATHE
            keys = []
            for s in range(2):
                if G[46 + s] >= 0.05:
                    code = int(round(G[44 + s]))
                    keys.append(f"{'OUT' if code & 16 else 'IN'} {SUB[min(code & 15, 12)]}")
            for k in set(keys):
                pumps[k] += 1
                if harv: pumpsH[k] += 1
                if br: pumpsB[k] += 1
            if br:
                brn += 1
                if imp[i] > 1 and imp[i] > made[i]: outside += 1
                elif made[i] > 1 and made[i] >= max(imp[i], 0): own += 1
            if imp[i] > 1: importers += 1
            if imp[i] < -1: exporters += 1
        print(f'  breathers {brn}: on OUTSIDE t {outside}, on their OWN {own} · net importers of t {importers}, exporters {exporters}')
        print('  pumps (cells; of them harvesters / breathers):', ', '.join(f'{k} {c} ({pumpsH[k]}/{pumpsB[k]})' for k, c in pumps.most_common(12)))
        if B > 74:
            ch = [g[i * B + 55] for i in range(n)]
            tol = [g[i * B + 74] for i in range(n)]
            print(f'  gene stretch channels mean {statistics.mean(ch):+.3f} sd {statistics.pstdev(ch):.3f}', q(ch, (0.1, 0.5, 0.9)))
            print(f'  gene stretch tolerance mean {statistics.mean(tol):+.3f} sd {statistics.pstdev(tol):.3f}', q(tol, (0.1, 0.5, 0.9)))
        print('  engines:', ', '.join(f'{k} {c}' for k, c in engines.most_common(8)))


if __name__ == '__main__':
    main()
