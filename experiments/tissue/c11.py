"""Step C11, glue turns the cell and division by the front, in the tissue lab: the conditions, and the analysis of their runs.

    python experiments/tissue/c11.py make                 # writes experiments/conditions/tissue/c11/<series>/*.json and batches
    python tools/experiment.py experiments/conditions/tissue/c11/<series>/batch.json --out experiments/runs/tissue-c11
    python experiments/tissue/c11.py analyse              # table of every run (experiments/tissue/c11-sweep.csv), and the
                                                          # chosen ones (--keep a,b) stored in experiments/tissue/configs/c11-<name>/
    python experiments/tissue/c11.py analyse --crops DIR  # also crop every run's shots into DIR (for looking; not kept)

The method is the tissue series' and step C10's (TISSUE.md "How the runs were made", "C10: patterned walls in the tissue lab"):
few cells, one genome cloned to all, mutation off, differentiation off, no squeeze, a dark dish without springs, crawling free of
battery cost; measures every 5 s, a stir through the largest cluster at 82 s, the end at 120 s. The walls' genes are set by hand
(a0 = the adhesion gene, a1, a2; w = 0) and the fronts start at random (each cell its own). The walls' COST is off (the dark lab dish
holds no linkers). Each pattern runs with the glue's turning on and off (?turn=0), with field A not felt and with the long beat.

Series "grow" (division builds the tissue): ONE founder cell (?cells=1, capacity 100) with the life cycle on and mutation off, its
battery paying for its divisions (the starter charge 0.4 of the battery; a division costs nothing and is allowed from 0.003 of the
battery, so a founder's line grows for about seven generations, until the capacity of 100 is full); no engines (so no upkeep), no
starving, no background deaths. The gene divAxis puts the daughters along the front (0) or across it (1).
Scores: as analyse.py (hold x persist x reform; islands).
"""
import argparse
import csv
import glob
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import analyse as A  # noqa: E402  (the tissue series' measures and scores)

CONDS = os.path.join(REPO, "experiments", "conditions", "tissue", "c11")
RUNS = os.path.join(REPO, "experiments", "runs", "tissue-c11")
CONFIGS = os.path.join(HERE, "configs")

BASE_GENES = {"keyAngle": 0.35, "keyScale": 0.05, "recAngle": 0.35, "recScale": 0.05, "recWidth": 0.15, "size": 1, "motility": 1,
              "mix": 0, "thickness": 0.012, "stiffness": 1, "pumpRate0": 0, "pumpRate1": 0, "rate0": 2, "rate1": 0, "rate2": 0,
              "w": 0, "divAxis": 0}
BASE_KNOBS = {"cells.params.squeeze": 0, "genome.rules.diff": False, "eat.params.pay": False, "walls.params.cost": False}
QUERY = {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "springs": 0, "light": "off", "day": 0}

# the hand-set wall patterns: (description, a0, a1, a2)
PATTERNS = {
    "uni": ("uniform", 0.8, 0.0, 0.0),
    "pol": ("polar: front sticky, back not", 0.4, 0.5, 0.0),
    "end": ("two-ended: both ends sticky, the flanks not", 0.5, 0.0, 0.5),
    "sid": ("sticky sides: the flanks sticky, the ends not", 0.5, 0.0, -0.5),
    "epi": ("epithelial: the flanks sticky, the back a little, the front (apex) not", 0.5, -0.3, -0.4),
}
FIELDS = {
    "off": ("field A not felt", {"cells.params.senseOn": False}),
    "lb": ("long beat (lever 0.2)", {"cells.params.lever": 0.2}),
}
# growth: one founder, its battery pays for its divisions, capacity 100
GROW_QUERY = {"cells": 1, "cap": 100, "life": 1, "mut": 0}
GROW_KNOBS = {"division.params.divAt": 0.003, "division.params.cost": 0, "division.params.starveAt": 0, "division.params.age": 0,
              "membrane.params.burst": False}


def condition(name, series, desc, genes, knobs, fronts="random", query=None, cells=40, extra_js="", seed=3, stir=True):
    q = dict(QUERY, cells=cells, seed=seed)
    q.update(query or {})
    g = dict(BASE_GENES)
    g.update(genes)
    k = dict(BASE_KNOBS)
    k.update(knobs)
    js0 = ("const T = await import('/experiments/tissue/tissue-lab.js'); window.__T = T;\n"
           f"const knobs = T.apply({json.dumps(k)});\n"
           f"const g = {json.dumps(g)}; g.eng0 = moire.genome.engineCode('gt → g + t', 0);\n"
           "await T.genes(g, null);\n"
           f"const fr = await T.fronts({json.dumps({'mode': fronts} if isinstance(fronts, str) else fronts)});\n"
           f"{extra_js}\n"
           "return { knobs, genes: g, fronts: fr, m: await T.measure({ every: 1 }) };")
    evals = [{"t": 0, "js": js0}, {"t": 60, "js": "return await __T.measure({ every: 1 });"},
             {"t": 80, "js": "return await __T.measure({ every: 1 });"}]
    if stir:
        evals.append({"t": 82, "js": "return await __T.stirThrough();"})
    evals.append({"t": 120, "js": "return await __T.measure({ every: 1 });"})
    return {
        "name": name, "series": series, "description": desc,
        "tissue_setting": {"knobs": knobs, "genes": genes, "typeB": None, "query": query or {}, "extra_js": extra_js, "fronts": fronts},
        "query": q, "duration": 120, "sample_every": 5, "tissue": True, "evals": evals,
        "shots": [{"t": 30}, {"t": 60}, {"t": 80}, {"t": 120}, {"t": 80, "view": "walls"}, {"t": 120, "view": "walls"},
                  {"t": 80, "view": "machinery"}],
        "snapshots": [{"t": 80, "grid": False, "name": "prestir"}, {"t": 120, "grid": False, "name": "end"}],
    }


def make():
    out = {}
    # series "pat" (40 cells): the five patterns x field A off / long beat x turning on / off; "big" (100 cells): the long beat only
    for series, cells in (("pat", 40), ("big", 100)):
        for pk, (pdesc, a0, a1, a2) in PATTERNS.items():
            for fk, (fdesc, fknobs) in FIELDS.items():
                if cells == 100 and fk != "lb":
                    continue   # (100 cells: the long beat only, for time: the GPU was shared)
                for tk in ("t1", "t0"):
                    knobs = dict(fknobs)
                    knobs["walls.params.turn"] = tk == "t1"
                    name = f"c11-{pk}-{fk}-{tk}" + ("-100" if cells == 100 else "")
                    desc = f"{pdesc}; {fdesc}; glue turning {'on' if tk == 't1' else 'off'}; {cells} cells"
                    out.setdefault(series, []).append(condition(name, series, desc, {"adhesion": a0, "a1": a1, "a2": a2}, knobs, cells=cells))
    # series "grow": one founder of each pattern, divisions along (d0) or across (d1) the front, turning on / off; field A off
    for pk, (pdesc, a0, a1, a2) in PATTERNS.items():
        for dk, axis in (("d0", 0), ("d1", 1)):
            for tk in ("t1", "t0"):
                knobs = dict(FIELDS["off"][1])
                knobs.update(GROW_KNOBS)
                knobs["walls.params.turn"] = tk == "t1"
                name = f"c11-grow-{pk}-{dk}-{tk}"
                desc = (f"{pdesc}; one founder grows to 100 cells, daughters {'along' if axis == 0 else 'across'} the front; "
                        f"glue turning {'on' if tk == 't1' else 'off'}; field A not felt")
                out.setdefault("grow", []).append(condition(name, "grow", desc, {"adhesion": a0, "a1": a1, "a2": a2, "divAxis": axis, "rate0": 0},
                                                            knobs, query=GROW_QUERY, cells=1))
    for series, conds in out.items():
        d = os.path.join(CONDS, series)
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)
        for c in conds:
            with open(os.path.join(d, c["name"] + ".json"), "w", encoding="utf-8") as f:
                json.dump(c, f, indent=1, ensure_ascii=False)
        with open(os.path.join(d, "batch.json"), "w", encoding="utf-8") as f:
            json.dump({"batch": f"c11-{series}", "runs": [c["name"] + ".json" for c in conds]}, f, indent=1)
        print(f"{series}: {len(conds)} conditions in {os.path.relpath(d, REPO)}")


def store(r, image="t120.png"):
    """Keep a run in experiments/tissue/configs/<name>/: condition, cells-only snapshot, measures, one JPEG."""
    name, rd = r["name"], r["_rd"]
    d = os.path.join(CONFIGS, name)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    with open(os.path.join(d, "condition.json"), "w", encoding="utf-8") as f:
        json.dump(r["_cond"], f, indent=1, ensure_ascii=False)
    snap = json.load(open(os.path.join(rd, "snapshots", "end.json"), encoding="utf-8"))
    snap["measures"] = None
    with open(os.path.join(d, "snapshot.json"), "w", encoding="utf-8") as f:
        json.dump(snap, f, separators=(",", ":"))
    box = r["_m120"].get("boxAll") or r["_m120"].get("box")
    if box:
        A.crop(os.path.join(rd, "shots", image), os.path.join(d, "clean.jpg"), box, scale=1.25)
    keep = {k: v for k, v in r.items() if not k.startswith("_")}
    keep["measures_t80"] = r["_m80"]
    keep["measures_t120"] = r["_m120"]
    keep["url"] = f"index.html?snap=experiments/tissue/configs/{name}/snapshot.json"
    keep["run"] = os.path.relpath(rd, REPO).replace(os.sep, "/")
    keep["commit"] = r["_meta"].get("commit")
    with open(os.path.join(d, "measures.json"), "w", encoding="utf-8") as f:
        json.dump(keep, f, indent=1)


COLS = ["name", "series", "description", "cells", "n80", "score", "iscore", "stable", "kind", "hold", "persist", "reform", "contacts",
        "clusters", "isolated", "compact", "internal", "end_inLargest", "end_clusters", "elong80", "hole80", "chainy80", "elong120",
        "hole120", "chainy120", "front80", "side80", "back80", "front120", "onSticky80", "chance80", "onSticky120", "chance120",
        "bonds80", "chains80", "inChains80", "longest80", "rings80", "inRings80", "glue80", "matured80", "turn60_80", "speed", "status"]


def analyse(args):
    res = []
    for rd in sorted(glob.glob(os.path.join(args.runs or RUNS, "*"))):
        if not os.path.exists(os.path.join(rd, "meta.json")):
            continue
        if args.only and not any(os.path.basename(rd).startswith(p) for p in args.only.split(",")):
            continue
        r = A.analyse_run(rd)
        if r.get("status") == "ok":
            for t, m in (("80", r["_m80"]), ("120", r["_m120"])):
                w = (m or {}).get("walls") or {}
                ca = w.get("contactAt") or [None, None, None]
                r["front" + t], r["side" + t], r["back" + t] = ca
                r["glue" + t], r["matured" + t] = w.get("glue"), w.get("matured")
                r["onSticky" + t], r["chance" + t] = w.get("onSticky"), w.get("stickyChance")
                r["bonds" + t], r["chains" + t], r["inChains" + t] = w.get("bondsPerCell"), w.get("chains"), w.get("inChains")
                r["longest" + t], r["rings" + t], r["inRings" + t] = w.get("longestChain"), w.get("rings"), w.get("inRings")
            r["n80"] = (r["_m80"] or {}).get("n")
            r["turn60_80"] = A.window(r["_rows"], "walls.turnRate", 60, 80)
        res.append(r)
    with open(os.path.join(HERE, "c11-sweep.csv") if not args.runs else os.path.join(args.runs, "sweep.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in res:
            w.writerow({k: (f"{v:.4g}" if isinstance(v, float) else v) for k, v in r.items() if k in COLS})
    keep = set((args.keep or "").split(",")) - {""}
    for r in res:
        if r.get("status") != "ok":
            print(f"{r['name']:28s} {r.get('status')} {r.get('error', '')[:80]}")
            continue
        fmt = lambda x: "-" if x is None else f"{x:.2f}"  # noqa: E731
        print(f"{r['name']:24s} n {r['n80']} sc {r['score']:.2f} isc {r['iscore']:.2f} pers {fmt(r['persist'])} ref {r['reform']:.2f} "
              f"cont {fmt(r['contacts'])} cl {fmt(r['clusters'])} cmp {fmt(r['compact'])} el {fmt(r['elong80'])} hole {fmt(r['hole80'])} "
              f"stk {fmt(r['onSticky80'])}/{fmt(r['chance80'])} f/s/b {fmt(r['front80'])}/{fmt(r['side80'])}/{fmt(r['back80'])} "
              f"bonds {fmt(r['bonds80'])} ch {r['chains80']}/{r['inChains80']}/{r['longest80']} ring {r['rings80']}/{r['inRings80']} "
              f"turn {fmt(r['turn60_80'])} {('STABLE ' + r['kind']) if r['stable'] else ''}")
        if args.crops:
            for t, key in (("t80", "_m80"), ("t80_walls", "_m80"), ("t120", "_m120"), ("t120_walls", "_m120")):
                box = r[key].get("boxAll") or r[key].get("box")
                p = os.path.join(r["_rd"], "shots", t + ".png")
                if box and os.path.exists(p):
                    A.crop(p, os.path.join(args.crops, f"{r['name']}_{t}.png"), box, scale=1.0)
        if r["name"] in keep:
            store(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["make", "analyse"])
    ap.add_argument("--crops", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--runs", default="", help="another runs folder (default experiments/runs/tissue-c11)")
    ap.add_argument("--keep", default="", help="comma-separated run names to store as configurations")
    a = ap.parse_args()
    if a.what == "make":
        make()
    else:
        analyse(a)


if __name__ == "__main__":
    main()
