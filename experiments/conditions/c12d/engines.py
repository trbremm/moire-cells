"""Step C12d: which engines a run's colony carries at the end, from its final snapshot (experiments/runs/<run>/snapshots/*.json):
cells carrying each engine with a positive rate, and the sum of their rates. Run from the repository:
    python experiments/conditions/c12d/engines.py c12d-oxy-spot_s3 [...]
"""
import base64, collections, glob, gzip, json, struct, sys

NAMES = ['gt → g + t', 'gT → g + T', 'Gt → G + t', 'GT → G + T', 'Gt + g → gt + G', 'gt + T → gT + t', 'GT + g → gT + G',
         'Gt + T → GT + t', 'gt + GT → gT + Gt', 'll → l + l', 'LL → L + L', 'g + t → gt', 'g + T → gT', 'G + t → Gt', 'G + T → GT',
         'G + gt → Gt + g', 't + gT → gt + T', 'G + gT → GT + g', 't + GT → Gt + T', 'gT + Gt → gt + GT', 'l + l → ll', 'L + L → LL']
BANDS = ['storer', 'V1', 'V2', 'hard']


def unpack(p):
    raw = base64.b64decode(p['b64'])
    if p.get('enc') == 'gzip':
        raw = gzip.decompress(raw)
    return raw


for run in sys.argv[1:]:
    path = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'))[-1]
    S = json.load(open(path, encoding='utf-8'))
    B = S['layout']['bioWords']
    raw = unpack(S['cells']['bio'])
    n = len(raw) // (4 * B)
    f = struct.unpack(f'<{n * B}f', raw)
    cnt, rate = collections.Counter(), collections.Counter()
    for i in range(n):
        g = f[i * B:(i + 1) * B]
        for k in range(3):
            if g[36 + k] > 0:
                code = int(round(g[32 + k]))
                e, b = min(code & 31, len(NAMES) - 1), code >> 5
                key = NAMES[e] + (f' [{BANDS[min(b, 3)]}]' if e <= 10 else '')
                cnt[key] += 1
                rate[key] += g[36 + k]
    print(f'{run}: {n} cells')
    for key, c in cnt.most_common(12):
        print(f'  {key:28s} {c:5d} cells, rate sum {rate[key]:.0f}')
