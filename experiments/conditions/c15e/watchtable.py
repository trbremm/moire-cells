"""Step C15e: the watch table (cells alive, every C15d and C15e fix on, against C15d and ?carbon=0 at the same seed) and the Liebig limits per scene.

python experiments/conditions/c15e/watchtable.py
"""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runs")
TIMES = (300, 600, 900, 1200)


def probes(run):
    try:
        m = json.load(open(os.path.join(ROOT, run, "meta.json")))
    except OSError:
        return {}
    out = {}
    for e in m.get("evals", []):
        r = e.get("result")
        if isinstance(r, str) and r.startswith("{") and '"alive"' in r and '"t":' in r:
            d = json.loads(r)
            out[round(d["t"])] = d
    return out


def samples(run):
    """alive per sample time from samples.csv (for runs whose probes are missing)."""
    import csv
    try:
        rows = list(csv.DictReader(open(os.path.join(ROOT, run, "samples.csv"))))
    except OSError:
        return {}
    return {round(float(r["t"])): {"alive": int(float(r["alive"]))} for r in rows if r.get("alive")}


def alive(a, run=None):
    if run:
        s = samples(run)
        a = {**{t: v for t, v in s.items()}, **a}
    return " / ".join(str(a[t]["alive"]) if t in a else "-" for t in TIMES)


ROWS = [  # scene, seed, carbon life viable (C15e), C15d, ?carbon=0 run
    ("default", 3, "c15e-w-default_s3", "c15d-w-default_s3", "c15c-default-off_s3"),
    ("default", 7, "c15e-w-default_s7", "c15d-w-default_s7", "c15d-w-default-off_s7"),
    ("colonies (wild)", 3, "c15e-w-colonies_s3", "c15d-w-colonies_s3", "c15c-colonies-off_s3"),
    ("colonies (wild)", 7, "c15e-w-colonies_s7", "c15d-w-colonies_s7", "c15d-w-colonies-off_s7"),
    ("Sunlit shallows", 3, "c15e-w-shallows_s3", "c15d-w-shallows_s3", "c15c-shallows-off_s3"),
    ("oxygen, spotlight", 3, "c15e-w-oxy-spot_s3", "c15d-w-oxy-spot_s3", "c15c-oxy-spot-off_s3"),
    ("oxygen, whole dish", 3, "c15e-w-oxy-full_s3", "c15d-w-oxy-full_s3", "c15c-oxy-full-off_s3"),
]
print("| scene | seed | carbon life viable (C15e) | C15d | ?carbon=0 |")
print("|---|---|---|---|---|")
for scene, seed, on, old, off in ROWS:
    print(f"| {scene} | {seed} | {alive(probes(on), on)} | {alive(probes(old), old)} | {alive(probes(off), off)} |")
print()
print("Liebig at the last probe (share of living cells that could not build some part for want of carbon / G / trace / free g or t / battery),")
print("integrity, jobs (undecided/light/breathe/ferment/gradient/build/predator), the carbon in cells, mud's share:")
print("| scene | seed | t | alive | limited C / G / trace / g,t / battery | integrity | jobs | carbon in cells | mud |")
print("|---|---|---|---|---|---|---|---|---|")
for scene, seed, on, old, off in ROWS:
    a = probes(on)
    if not a:
        continue
    t = max(a)
    d = a[t]
    n = d["alive"] or 0
    P = d.get("parts") or {}
    F = d.get("flow") or {}
    pc = lambda k: f"{round(100 * P.get(k, 0) / n)}%" if n else "-"
    job = d.get("job")
    js = "/".join(str(x) for x in job[:7]) if isinstance(job, list) else "-"
    integ = (d.get("memb") or {}).get("integ") or 0
    cc = (F.get("all") or 0) * (F.get("cellShare") or 0)
    print(f"| {scene} | {seed} | {t} | {n} | {pc('limC')} / {pc('limG')} / {pc('limTr')} / {pc('limAt')} / {pc('limBat')} | {integ:.2f} | {js} | "
          f"{cc:.0f} | {100 * (F.get('mudShare') or 0):.0f}% |")
