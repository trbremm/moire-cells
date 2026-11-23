"""Step C15g tables (README "Step C15g: carbon life, round 4").

python experiments/conditions/c15g/table.py watch            the watch table: cells alive at 5 / 10 / 20 min, C15f vs main d5076f5 vs ?carbon=0
python experiments/conditions/c15g/table.py crash            the founders' crash: cells, batteries, deaths, spending in the first two minutes
python experiments/conditions/c15g/table.py ab <prefix>...   cells at 2 / 5 / 10 min, the ledger at the last probe, for runs by name prefix
python experiments/conditions/c15g/table.py fl <tag>...      the fresh-load worlds: cells at 30 s / 2 / 4 min, per tag (main, fix, ...)
"""
import csv
import glob
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")


def meta(run):
    try:
        return json.load(open(os.path.join(ROOT, run, "meta.json")))
    except OSError:
        return {}


def results(run, key):
    """Eval results that are JSON objects with key, by rounded sim time."""
    out = {}
    for e in meta(run).get("evals", []):
        r = e.get("result")
        if isinstance(r, str) and r.startswith("{") and f'"{key}"' in r[:40]:
            try:
                d = json.loads(r)
            except ValueError:
                continue
            if key not in d:
                continue
            out[round(e["t"])] = d
    return out


def samples(run):
    try:
        rows = list(csv.DictReader(open(os.path.join(ROOT, run, "samples.csv"))))
    except OSError:
        return {}
    return {round(float(r["t"])): r for r in rows if r.get("t")}


def alive_at(run, times):
    s = samples(run)
    p = results(run, "alive")
    out = []
    for t in times:
        if t in p:
            out.append(str(p[t]["alive"]))
        elif t in s and s[t].get("alive"):
            out.append(str(int(float(s[t]["alive"]))))
        else:
            out.append("-")
    return " / ".join(out)


def books(run):
    """The worst rounding of carbon, atoms, charge over the probes, and the energy's at the end."""
    worst = {"c": 0.0, "a": 0.0, "q": 0.0}
    e = None
    for d in results(run, "t").values():
        for k, kk in (("cRound", "c"), ("atoms", "a"), ("charge", "q")):
            v = d.get(k)
            if isinstance(v, (int, float)):
                worst[kk] = max(worst[kk], abs(v))
        if isinstance(d.get("energy"), (int, float)):
            e = d["energy"]
    return worst, e


ROWS = [("default", 3), ("default", 7), ("colonies", 3), ("colonies", 7), ("shallows", 3), ("oxy-spot", 3), ("oxy-full", 3)]


def at(run, t):
    p, sm = results(run, "alive"), samples(run)
    if t in p:
        return p[t]["alive"]
    if t in sm and sm[t].get("alive"):
        return int(float(sm[t]["alive"]))
    return None


def watch(tag="w"):
    """C15g (runs c15g-<tag>-*) against main c2e49a1 and ?carbon=0 (both rerun on main c2e49a1 for this step)."""
    T = (300, 600, 1200)
    print(f"| scene | seed | C15g ({tag}) | main c2e49a1 | ?carbon=0 (main) | C15g / ?carbon=0 at 10 min | main / ?carbon=0 at 10 min |")
    print("|---|---|---|---|---|---|---|")
    for k, s in ROWS:
        a, b, c = f"c15g-{tag}-{k}_s{s}", f"c15g-main-{k}_s{s}", f"c15g-off-{k}_s{s}"
        y = at(c, 600)
        r = lambda run: f"{100 * at(run, 600) / y:.0f} %" if at(run, 600) is not None and y else "-"
        print(f"| {k} | {s} | {alive_at(a, T)} | {alive_at(b, T)} | {alive_at(c, T)} | {r(a)} | {r(b)} |")


def ledger_line(run):
    p = results(run, "alive")
    if not p:
        return "-"
    t = max(p)
    d = p[t]
    n = d["alive"] or 0
    F = d.get("flow") or {}
    P = d.get("parts") or {}
    pc = lambda k: f"{round(100 * P.get(k, 0) / n)}" if n else "-"
    inc = (F.get("eIncome") or 0) + (F.get("eCarbonEng") or 0)
    pay = {k: F.get(k) or 0 for k in ("payBody", "payLip", "payWall", "payRed", "payPig", "payEnz", "payTrans")}
    integ = (d.get("memb") or {}).get("integ") or 0
    rd = results(run, "ready").get(t, {}).get("ready") or {}
    return (f"t {t}: {n} cells; income {inc:.0f}/min, parts {sum(pay.values()):.0f} (wall {pay['payWall']:.0f}, lip {pay['payLip']:.0f}, enz "
            f"{pay['payEnz']:.0f}); built wall {F.get('builtWall', 0):.0f} held {F.get('in_wall', 0):.0f}; integ {integ:.2f}; limited C/G/tr/at/bat "
            f"{pc('limC')}/{pc('limG')}/{pc('limTr')}/{pc('limAt')}/{pc('limBat')} %; ready bat {rd.get('bat', '-')} body {rd.get('body', '-')} "
            f"both {rd.get('both', '-')}, battery mean {rd.get('batMean', 0):.2f}")


def ab(prefixes):
    runs = sorted({os.path.basename(p) for pre in prefixes for p in glob.glob(os.path.join(ROOT, pre + "*")) if os.path.isdir(p)})
    print("| run | cells at 2 / 5 / 10 min | books (carbon, atoms, charge; energy) |")
    print("|---|---|---|")
    for r in runs:
        w, e = books(r)
        print(f"| {r} | {alive_at(r, (120, 300, 600))} | {w['c']:.3g} {w['a']:.3g} {w['q']:.3g}; {e if e is None else round(e, 3)} |")
    print()
    for r in runs:
        print(f"- {r}: {ledger_line(r)}")


def crash():
    runs = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "c15g-crash-*")) if os.path.isdir(p))
    T = (0, 30, 60, 90, 120)
    print("| run | cells at 0 / 30 / 60 / 90 / 120 s | batteries (sum) | starved per s at 90 s | spend per s at 30 s |")
    print("|---|---|---|---|---|")
    for r in runs:
        s = samples(r)
        bat = " / ".join(f"{float(s[t]['cells.bat']):.0f}" if t in s else "-" for t in T)
        st = s.get(90, {}).get("division.rate.starved", "-")
        sp = results(r, "spend").get(30, {}).get("spend") or {}
        rt, r2, lp = sp.get("rate") or {}, sp.get("rate2") or {}, sp.get("lip") or {}
        spend = (f"crawl {rt.get('paid', 0):.1f}; upkeep {r2.get('upkeep', 0):.1f}; harvest sparks {r2.get('deficit', 0):.1f}; "
                 f"income {rt.get('gain', 0) + r2.get('eGain', 0):.1f}") if sp else "-"
        print(f"| {r} | {alive_at(r, T)} | {bat} | {st} | {spend} |")


def fl(tags):
    T = (30, 120, 240)
    kinds = ["delta", "islands", "sieve", "thicket", "forest"]
    for size in ("desk", "phone"):
        seeds = sorted({int(p.rsplit("-s", 1)[1]) for p in glob.glob(os.path.join(ROOT, f"c15g-fl-*-{size}-*-s*"))})
        print(f"\n{size}: cells at 30 s / 2 / 4 min")
        print("| world | seed | " + " | ".join(tags) + " |")
        print("|---|---|" + "---|" * len(tags))
        for s in seeds:
            for k in kinds:
                cells = [alive_at(f"c15g-fl-{t}-{size}-{k}-s{s}", T) for t in tags]
                if all(c == "- / - / -" for c in cells):
                    continue
                print(f"| {k} | {s} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "watch"
    if what == "watch":
        watch(*(sys.argv[2:3] or ["w"]))
    elif what == "crash":
        crash()
    elif what == "ab":
        ab(sys.argv[2:])
    elif what == "fl":
        fl(sys.argv[2:] or ["main", "fix"])
