"""Step M1: the membranes cell by cell, from a run's snapshot (with grid).
python experiments/conditions/m1/memb.py <run> [<run> ...] [--t 600]
Per run: integrity distribution; what the cells with holey membranes lack (soap nearby, the atoms to build it: a head g/t, l, L in
the stock; the battery); the biting atoms at their membranes; the genes asking (thickness)."""
import base64, glob, gzip, json, math, os, re, struct, sys

sys.stdout.reconfigure(encoding='utf-8')
opt, runs, it = {}, [], iter(sys.argv[1:])
for a in it:
    if a.startswith('--'): opt[a] = next(it)
    else: runs.append(a)
A = 4096.0


def unpack(p):
    raw = base64.b64decode(p['b64'])
    return gzip.decompress(raw) if p.get('enc') == 'gzip' else raw


def q(v, ps=(0.1, 0.25, 0.5, 0.75, 0.9)):
    v = sorted(v)
    return [v[min(len(v) - 1, int(p * len(v)))] for p in ps] if v else []


def load(run, t=None):
    snaps = sorted(glob.glob(f'experiments/runs/{run}/snapshots/*.json'), key=lambda x: float((re.findall(r't(\d+)', os.path.basename(x)) or ['0'])[-1]))
    if t: snaps = [x for x in snaps if os.path.basename(x) == f'snap_t{t}.json']
    return snaps[-1], json.load(open(snaps[-1], encoding='utf-8'))


def main():
    for run in runs:
        p, S = load(run, opt.get('--t'))
        CW, B, SW = S['layout']['cellWords'], S['layout']['bioWords'], S['layout']['stockWords']
        R, n = S['R'], S['alive']
        f = struct.unpack(f'<{n * CW}f', unpack(S['cells']['rec']))
        g = struct.unpack(f'<{n * B}f', unpack(S['cells']['bio']))
        st = struct.unpack(f'<{n * SW}i', unpack(S['cells']['stock']))
        G = S.get('grid')
        hw, hh, px, bl = G['hw'], G['hh'], G['px'], G['blocks']
        nn = hw * hh
        data = struct.unpack(f'<{nn * len(bl)}i', unpack(G['data']))
        conc = 1 / (A * (px / R) ** 2)
        def at(name, x, y, r=1):
            k = bl.index(name); cx, cy = int(x / px), int(y / px); s = 0; m = 0
            for yy in range(max(0, cy - r), min(hh, cy + r + 1)):
                for xx in range(max(0, cx - r), min(hw, cx + r + 1)):
                    s += data[k * nn + yy * hw + xx]; m += 1
            return s * conc / max(m, 1)
        rows = []
        for i in range(n):
            o, b, s = i * CW, i * B, i * SW
            x, y, r = f[o], f[o + 1], f[o + 4]
            integ = sum(f[o + 48:o + 54]) / 6
            thick = g[b + 41]
            want = 6 * thick * 1.1 * r / R          # bilayer molecules the cell wants (units)
            lip = [sum(st[s + 32 + 6 * k + j] for j in range(6)) / A for k in range(5)]
            rows.append(dict(i=i, integ=integ, want=want, soap=lip[0] + lip[1], oil=lip[2], wall=lip[3] + lip[4],
                             g=st[s] / A, t=st[s + 1] / A, l=st[s + 2] / A, G=st[s + 3] / A, T=st[s + 4] / A, L=st[s + 5] / A,
                             bat=f[o + 16], osm=f[o + 84], r=r / R, thick=thick, oilg=g[b + 40], wallg=g[b + 52],
                             dsoap=at('glL', x, y) + at('tlL', x, y), doil=at('lL', x, y), dLL=at('LL', x, y), dll=at('ll', x, y),
                             dl=at('l', x, y), dL=at('L', x, y),
                             bite=at('g', x, y, 2) + at('t', x, y, 2) + at('g*', x, y, 2) + at('t*', x, y, 2), biteH=at('G', x, y, 2) + at('T', x, y, 2),
                             heat=at('heat', x, y) if 'heat' in bl else 0))
        I = [r['integ'] for r in rows]
        print(f'== {run} {os.path.basename(p)}: {n} cells, t {S["time"]:.0f} s')
        print(f'  integrity quantiles 10/25/50/75/90 %: {" ".join(f"{v:.2f}" for v in q(I))} · mean {sum(I) / n:.3f} · > 0.6: {sum(v > 0.6 for v in I) / n:.0%} · < 0.2: {sum(v < 0.2 for v in I) / n:.0%}')
        def grp(name, sel):
            R_ = [r for r in rows if sel(r)]
            if not R_: print(f'  {name}: none'); return
            m = lambda k: sum(r[k] for r in R_) / len(R_)
            fr = lambda c: sum(1 for r in R_ if c(r)) / len(R_)
            print(f'  {name} ({len(R_)}): want {m("want"):.3f} soap {m("soap"):.3f} oil {m("oil"):.3f} wall {m("wall"):.3f} | stock g {m("g"):.3f} t {m("t"):.3f} l {m("l"):.3f} L {m("L"):.4f} | bat {m("bat"):.2f}'
                  f' | dish under: soap {m("dsoap"):.3f} oil {m("doil"):.3f} l {m("dl"):.3f} L {m("dL"):.4f} ll {m("dll"):.3f} LL {m("dLL"):.3f} | biters light {m("bite"):.3f} heavy {m("biteH"):.3f} /R2'
                  f' | thick {m("thick"):.4f} r {m("r"):.2f} osm {m("osm"):+.2f}'
                  f' | holds L>0.002 {fr(lambda r: r["L"] > 0.002):.0%}, l {fr(lambda r: r["l"] > 0.002):.0%}, head {fr(lambda r: r["g"] + r["t"] > 0.002):.0%}, all three {fr(lambda r: r["L"] > 0.002 and r["l"] > 0.002 and r["g"] + r["t"] > 0.002):.0%}'
                  f' | soap under > 0.01/R2 {fr(lambda r: r["dsoap"] > 0.01):.0%}, bat < 0.05 {fr(lambda r: r["bat"] < 0.05):.0%}')
        grp('whole (> 0.6)', lambda r: r['integ'] > 0.6)
        grp('middle', lambda r: 0.2 <= r['integ'] <= 0.6)
        grp('holey (< 0.2)', lambda r: r['integ'] < 0.2)



if __name__ == '__main__':
    main()