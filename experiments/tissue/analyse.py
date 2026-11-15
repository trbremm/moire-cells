"""Tissue experiments: measures, stability score, sweep table, and the stored stable configurations.

    python experiments/tissue/analyse.py                  # sweep.csv + configs/ for the stable runs
    python experiments/tissue/analyse.py --crops DIR      # also crop every run's shots into DIR (for looking; not kept)

STABILITY SCORE (one number per run, 0..1), from the tissue measures sampled every 5 s:
    hold    = mean share of the cells in the largest cluster, t 50..80 s
    persist = mean contact persistence (share of the touching pairs still touching 5 s later), t 55..80 s
    reform  = mean share in the largest cluster at t 110..120 s (after the stir at 82 s) / hold, at most 1
    score   = hold x persist x reform;   STABLE (one tissue) = score >= 0.75
ISLANDS SCORE (many small tissues that hold, e.g. two types sorted into separate islands):
    linked  = 1 - mean share of isolated cells, t 50..80 s;  relinked = the same at t 110..120 s / linked, at most 1
    iscore  = linked x persist x relinked;   STABLE (islands) = iscore >= 0.75 and contacts >= 2 (groups of three and more, not just pairs)
"""
import argparse
import csv
import glob
import json
import os
import re
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
RUNS = os.path.join(REPO, "experiments", "runs", "tissue")
CONDS = os.path.join(REPO, "experiments", "conditions", "tissue")
CONFIGS = os.path.join(HERE, "configs")
CROP = os.path.join(HERE, "crop.ps1")
STABLE_AT = 0.75


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def window(rows, col, a, b):
    return mean([num(r.get(col)) for r in rows if a - 1e-6 <= num(r["trun"]) <= b + 1e-6])


def crop(src, dst, box, margin=36, scale=1.0, minimum=200):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    x0, y0, x1, y1 = box
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CROP, src, dst,
                    f"{x0:.1f}", f"{y0:.1f}", f"{x1:.1f}", f"{y1:.1f}", str(margin), str(scale), str(minimum)],
                   check=True, capture_output=True)


def analyse_run(rd):
    meta = json.load(open(os.path.join(rd, "meta.json"), encoding="utf-8"))
    if meta.get("status") != "ok":
        return {"name": meta["name"], "status": meta.get("status"), "error": meta.get("error", "")}
    rows = list(csv.DictReader(open(os.path.join(rd, "samples.csv"), encoding="utf-8")))
    cond = meta["condition"]
    ev = {round(e["t"]): e["result"] for e in meta.get("evals", []) if isinstance(e.get("result"), dict)}
    m80 = ev.get(80) or {}
    m120 = ev.get(120) or {}
    hold = window(rows, "tissue.inLargest", 50, 80)
    persist = window(rows, "tissue.persistence", 55, 80)
    end = window(rows, "tissue.inLargest", 110, 120)
    reform = min(1.0, end / hold) if hold and end is not None else 0.0
    score = (hold or 0) * (persist or 0) * reform
    n = num(rows[0]["alive"]) or 1
    linked = 1 - (window(rows, "tissue.isolated", 50, 80) or 0) / n
    relinked = min(1.0, (1 - (window(rows, "tissue.isolated", 110, 120) or 0) / n) / linked) if linked > 0 else 0.0
    iscore = linked * (persist or 0) * relinked
    contacts = window(rows, "tissue.contacts", 50, 80) or 0
    kind = "tissue" if score >= STABLE_AT else ("islands" if iscore >= STABLE_AT and contacts >= 2 else "")
    last80 = next((r for r in rows if abs(num(r["trun"]) - 80) < 0.5), rows[-1])
    st = cond.get("tissue_setting", {})
    setting = []
    for k, v in (st.get("knobs") or {}).items():
        setting.append(f"{k}={v}")
    for k, v in (st.get("genes") or {}).items():
        setting.append(f"gene {k}={v}")
    if st.get("typeB") is not None:
        setting.append("typeB " + ",".join(f"{k}={v}" for k, v in st["typeB"].items()) if st["typeB"] else "typeB (engines only)")
    for k, v in (st.get("query") or {}).items():
        setting.append(f"?{k}={v}")
    if st.get("extra_js"):
        setting.append("js: " + st["extra_js"].strip())
    out = {
        "name": meta["name"], "series": cond.get("series", ""), "description": cond.get("description", ""),
        "setting": "; ".join(setting) or "(baseline)", "seed": cond.get("query", {}).get("seed"), "cells": int(num(rows[0]["alive"]) or 0),
        "hold": hold, "persist": persist, "reform": reform, "score": score, "iscore": iscore, "linked": linked, "relinked": relinked,
        "stable": int(bool(kind)), "kind": kind,
        "contacts": window(rows, "tissue.contacts", 50, 80), "clusters": window(rows, "tissue.clusters", 50, 80),
        "isolated": window(rows, "tissue.isolated", 50, 80), "compact": window(rows, "tissue.compactLargest", 50, 80),
        "rg": window(rows, "tissue.rgLargest", 50, 80), "internal": window(rows, "tissue.internal", 55, 80),
        "move": window(rows, "tissue.move", 55, 80), "shape": window(rows, "tissue.shape", 55, 80),
        "ageMedian80": num(last80.get("tissue.ageMedian")), "end_inLargest": end,
        "end_contacts": window(rows, "tissue.contacts", 110, 120), "end_clusters": window(rows, "tissue.clusters", 110, 120),
        "elong80": m80.get("elong"), "hole80": m80.get("hole"), "chainy80": m80.get("chainy"), "edge80": m80.get("edge"),
        "elong120": m120.get("elong"), "hole120": m120.get("hole"), "chainy120": m120.get("chainy"),
        "sameType80": m80.get("sameType"), "sameType120": m120.get("sameType"), "sameRandom": m80.get("sameRandom"),
        "radialBA80": m80.get("radialBA"), "radialBA120": m120.get("radialBA"),
        "fates120": "/".join(str(x) for x in (m120.get("fates") or [])),
        "entropyRate": window(rows, "heat.rate.out", 50, 80), "heatOut120": num(rows[-1].get("heat.out")),
        "speed": meta.get("speed_reached"), "status": "ok",
        "_rd": rd, "_m80": m80, "_m120": m120, "_cond": cond, "_meta": meta, "_rows": rows,
    }
    return out


def store(r):
    """Copy a stable run into experiments/tissue/configs/<name>/."""
    name, rd = r["name"], r["_rd"]
    d = os.path.join(CONFIGS, name)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    series = r["series"]
    with open(os.path.join(d, "condition.json"), "w", encoding="utf-8") as f:
        json.dump(r["_cond"], f, indent=1, ensure_ascii=False)   # as run (with its seed)
    # the end state, without its copy of the measures (they are in measures.json; the loader does not use them), compact
    snap = json.load(open(os.path.join(rd, "snapshots", "end.json"), encoding="utf-8"))
    snap["measures"] = None
    with open(os.path.join(d, "snapshot.json"), "w", encoding="utf-8") as f:
        json.dump(snap, f, separators=(",", ":"))
    m80, m120 = r["_m80"], r["_m120"]
    two = r["_cond"].get("tissue_setting", {}).get("typeB") is not None
    shots = os.path.join(rd, "shots")
    replicate = bool(re.search(r"_s\d+$", name))   # seed replicates: snapshot and measures only (the folder stays small)
    if m120.get("box") and not replicate:
        crop(os.path.join(shots, "t120.png"), os.path.join(d, "clean.jpg"), m120.get("boxAll") or m120["box"], scale=1.25)
        if two:   # the strategy view tells the two types apart (gold B, green A); one genome: every cell looks alike there
            crop(os.path.join(shots, "t120_strategy.png"), os.path.join(d, "types.jpg"), m120.get("boxAll") or m120["box"],
                 scale=1.25)
    if m80.get("box") and not replicate:
        crop(os.path.join(shots, "t80.png"), os.path.join(d, "prestir.jpg"), m80.get("boxAll") or m80["box"], scale=0.8,
             minimum=160)
    keep = {k: v for k, v in r.items() if not k.startswith("_")}
    keep["measures_t80"] = m80
    keep["measures_t120"] = m120
    keep["url"] = f"index.html?snap=experiments/tissue/configs/{name}/snapshot.json"
    keep["run"] = os.path.relpath(rd, REPO).replace(os.sep, "/")
    keep["commit"] = r["_meta"].get("commit")
    with open(os.path.join(d, "measures.json"), "w", encoding="utf-8") as f:
        json.dump(keep, f, indent=1)


COLS = ["name", "series", "description", "setting", "seed", "cells", "score", "iscore", "stable", "kind", "linked", "relinked", "hold", "persist", "reform", "contacts",
        "clusters", "isolated", "compact", "rg", "internal", "move", "shape", "ageMedian80", "end_inLargest", "end_contacts",
        "end_clusters", "elong80", "hole80", "chainy80", "edge80", "elong120", "hole120", "chainy120", "sameType80",
        "sameType120", "sameRandom", "radialBA80", "radialBA120", "fates120", "entropyRate", "heatOut120", "speed", "status"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crops", default="", help="crop every run's t80 and t120 shots into this folder")
    ap.add_argument("--no-store", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated run name prefixes")
    a = ap.parse_args()
    res = []
    for rd in sorted(glob.glob(os.path.join(RUNS, "*"))):
        if not os.path.exists(os.path.join(rd, "meta.json")) or os.path.basename(rd).startswith("tr-"):
            continue   # (tr-: the reload checks, not sweep runs)
        if a.only and not any(os.path.basename(rd).startswith(p) for p in a.only.split(",")):
            continue
        res.append(analyse_run(rd))
    order = {"pilot": 0, "hold": 1, "chem": 2, "types": 3, "pairs": 4, "map": 5, "confirm": 6}
    res.sort(key=lambda r: (order.get(r.get("series", ""), 9), r["name"]))
    with open(os.path.join(HERE, "sweep.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in res:
            w.writerow({k: (f"{v:.4g}" if isinstance(v, float) else v) for k, v in r.items() if k in COLS})
    for r in res:
        if r.get("status") != "ok":
            print(f"{r['name']:28s} {r.get('status')} {r.get('error', '')[:80]}")
            continue
        flag = ("STABLE " + r["kind"]) if r["stable"] else ""
        print(f"{r['name']:28s} score {r['score']:.2f} isc {r['iscore']:.2f}  hold {r['hold']:.2f} pers {r['persist']:.2f} reform {r['reform']:.2f} "
              f"cont {r['contacts']:.1f} cmp {r['compact']:.2f} int {r['internal'] or 0:.2f} end {r['end_inLargest']:.2f} "
              f"el {r['elong80'] or 0:.1f} hole {r['hole80'] or 0:.1f} same {r['sameType80'] if r['sameType80'] is None else round(r['sameType80'], 2)} "
              f"rad {r['radialBA80'] if r['radialBA80'] is None else round(r['radialBA80'], 2)} {flag}")
        if a.crops:
            for t, key in (("t80", "_m80"), ("t120", "_m120")):
                box = r[key].get("boxAll") or r[key].get("box")
                p = os.path.join(r["_rd"], "shots", t + ".png")
                if box and os.path.exists(p):
                    crop(p, os.path.join(a.crops, f"{r['name']}_{t}.png"), box, scale=1.0)
        if r["stable"] and not a.no_store and r["series"] != "pilot":
            store(r)


if __name__ == "__main__":
    main()
