"""Step C10, patterned walls in the tissue lab: the conditions, and the analysis of their runs.

    python experiments/tissue/c10.py make                 # writes experiments/conditions/tissue/c10/<series>/*.json and batches
    python tools/experiment.py experiments/conditions/tissue/c10/<series>/batch.json --out experiments/runs/tissue-c10
    python experiments/tissue/c10.py analyse              # table of every run (experiments/tissue/c10-sweep.csv), and the
                                                          # stable or chosen ones stored in experiments/tissue/configs/c10-<name>/
    python experiments/tissue/c10.py analyse --crops DIR  # also crop every run's shots into DIR (for looking; not kept)

The method is the tissue series' (TISSUE.md "How the runs were made"): few cells, one genome cloned to all, no evolution (mutation and
the life cycle off), differentiation off, no squeeze, a dark dish without springs, crawling free of battery cost; measures every 5 s,
a stir through the largest cluster at 82 s, the end at 120 s. On top: the walls' genes set by hand (a0 = the adhesion gene, a1, a2,
w) and the cells' fronts set at t = 0 (random: each its own; aligned: all one way, as one lineage that inherited one direction;
in / out: toward / away from the culture's centre). The dark lab dish holds no linkers, so the walls' COST is off in these runs
unless a run says so (with the cost on, a cell without linkers holds no glue); those runs drop a spring of linkers (a lab-only
spring kind) under the cells.
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

CONDS = os.path.join(REPO, "experiments", "conditions", "tissue", "c10")
RUNS = os.path.join(REPO, "experiments", "runs", "tissue-c10")
CONFIGS = os.path.join(HERE, "configs")

BASE_GENES = {"keyAngle": 0.35, "keyScale": 0.05, "recAngle": 0.35, "recScale": 0.05, "recWidth": 0.15, "size": 1, "motility": 1,
              "mix": 0, "thickness": 0.012, "stiffness": 1, "pumpRate0": 0, "pumpRate1": 0, "rate0": 2, "rate1": 0, "rate2": 0}
BASE_KNOBS = {"cells.params.squeeze": 0, "genome.rules.diff": False, "eat.params.pay": False}
QUERY = {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "springs": 0, "light": "off", "day": 0}

# the hand-set wall patterns: (a0, a1, a2)
PATTERNS = {
    "uni": ("uniform", 0.8, 0.0, 0.0),
    "pol": ("polar: front sticky, back not", 0.4, 0.5, 0.0),
    "end": ("two-ended: both ends sticky, the sides not", 0.5, 0.0, 0.5),
    "sid": ("sticky sides: the sides sticky, the ends not", 0.5, 0.0, -0.5),
}
FIELDS = {
    "off": ("field A not felt", {"cells.params.senseOn": False}),
    "lb": ("long beat (lever 0.2)", {"cells.params.lever": 0.2}),
}


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
        "shots": [{"t": 60}, {"t": 80}, {"t": 120}, {"t": 120, "view": "walls"}, {"t": 120, "view": "machinery"}],
        "snapshots": [{"t": 120, "grid": False, "name": "end"}],
    }


# a lab-only spring of linkers (l and L; SPRING_KINDS.linker in src/matter.js), so the walls' cost can be paid in the dark lab
# dish; dropped under the culture, dripping all run long
LINKER_SPRING = "{ const v = moire.control.view(); moire.matter.addSpring(v.cssW / 2, v.cssH / 2, 'linker', 1e9); }"
# a lab-only spring of light givers and heavy takers (SPRING_KINDS.ions, the C6d ion test spring): the cells near it polarise
ION_SPRING = "{ const v = moire.control.view(); moire.matter.addSpring(v.cssW / 2, v.cssH / 2, 'ions', 1e9); }"


def make():
    out = {}
    # series "pat": the four patterns x field A off / long beat x maturation on / off x fronts random / aligned (cost off)
    for pk, (pdesc, a0, a1, a2) in PATTERNS.items():
        for fk, (fdesc, fknobs) in FIELDS.items():
            for mk in ("m1", "m0"):
                for frk in ("rnd", "al"):
                    name = f"c10-{pk}-{fk}-{mk}-{frk}"
                    knobs = dict(fknobs)
                    knobs["walls.params.cost"] = False
                    knobs["walls.params.mature"] = mk == "m1"
                    desc = f"{pdesc}; {fdesc}; maturation {'on' if mk == 'm1' else 'off'}; fronts {'random' if frk == 'rnd' else 'aligned'}"
                    out.setdefault("pat", []).append(condition(name, "pat", desc, {"adhesion": a0, "a1": a1, "a2": a2, "w": 0}, knobs,
                                                               fronts="random" if frk == "rnd" else "aligned"))
    # series "more": 100 cells for each pattern (long beat, maturation on, fronts aligned and random); polar with the fronts
    # pointing in / out; the walls off as the control; the cost on with a linker spring
    for pk, (pdesc, a0, a1, a2) in PATTERNS.items():
        for frk in ("al", "rnd"):
            knobs = {"cells.params.lever": 0.2, "walls.params.cost": False}
            out.setdefault("more", []).append(condition(f"c10-{pk}-lb-100-{frk}", "more", f"{pdesc}; long beat; 100 cells; fronts {'aligned' if frk == 'al' else 'random'}",
                                                        {"adhesion": a0, "a1": a1, "a2": a2, "w": 0}, knobs, fronts="aligned" if frk == "al" else "random", cells=100))
    for frk in ("in", "out"):
        for a1 in (0.5, -0.5):
            nm = f"c10-pol{'+' if a1 > 0 else '-'}-lb-{frk}"
            out["more"].append(condition(nm, "more", f"polar (a1 {a1:+}): fronts pointing {frk}; long beat; 40 cells",
                                         {"adhesion": 0.4, "a1": a1, "a2": 0, "w": 0}, {"cells.params.lever": 0.2, "walls.params.cost": False}, fronts=frk))
    for pk in ("uni", "end", "sid"):
        _, a0, a1, a2 = PATTERNS[pk]
        out["more"].append(condition(f"c10-{pk}-lb-wallsoff", "more", f"control: the walls off (adhesion gene {a0}); long beat",
                                     {"adhesion": a0, "a1": a1, "a2": a2, "w": 0}, {"cells.params.lever": 0.2, "walls.params.on": False}))
        out["more"].append(condition(f"c10-{pk}-lb-cost", "more", f"{PATTERNS[pk][0]}; long beat; the cost ON, a spring of linkers under the cells",
                                     {"adhesion": a0, "a1": a1, "a2": a2, "w": 0}, {"cells.params.lever": 0.2, "walls.params.cost": True},
                                     extra_js=LINKER_SPRING))
    # series "front": the front from the dipole (w 1) against the inherited orientation (w 0), with an ion spring under the cells
    # that polarises them (dipoles), polar walls (front sticky) and two-ended, long beat; and with the chemistry's charge
    for pk in ("pol", "end", "sid"):
        _, a0, a1, a2 = PATTERNS[pk]
        for w in (0, 1):
            out.setdefault("front", []).append(condition(f"c10-{pk}-ion-w{w}", "front", f"{PATTERNS[pk][0]}; long beat; an ion spring (g + T) under the cells; gene w {w}",
                                                         {"adhesion": a0, "a1": a1, "a2": a2, "w": w}, {"cells.params.lever": 0.2, "walls.params.cost": False},
                                                         fronts="random", extra_js=ION_SPRING))
    for series, conds in out.items():
        d = os.path.join(CONDS, series)
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)
        for c in conds:
            with open(os.path.join(d, c["name"] + ".json"), "w", encoding="utf-8") as f:
                json.dump(c, f, indent=1, ensure_ascii=False)
        with open(os.path.join(d, "batch.json"), "w", encoding="utf-8") as f:
            json.dump({"batch": f"c10-{series}", "runs": [c["name"] + ".json" for c in conds]}, f, indent=1)
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


COLS = ["name", "series", "description", "cells", "score", "iscore", "stable", "kind", "hold", "persist", "reform", "contacts", "clusters",
        "isolated", "compact", "internal", "end_inLargest", "end_clusters", "elong80", "hole80", "chainy80", "edge80", "elong120", "hole120",
        "chainy120", "front80", "side80", "back80", "front120", "side120", "back120", "glue120", "matured120", "speed", "status"]


def analyse(args):
    res = []
    for rd in sorted(glob.glob(os.path.join(RUNS, "*"))):
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
        res.append(r)
    with open(os.path.join(HERE, "c10-sweep.csv"), "w", newline="", encoding="utf-8") as f:
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
        print(f"{r['name']:26s} sc {r['score']:.2f} isc {r['iscore']:.2f} hold {fmt(r['hold'])} pers {fmt(r['persist'])} ref {r['reform']:.2f} "
              f"cont {fmt(r['contacts'])} cl {fmt(r['clusters'])} cmp {fmt(r['compact'])} el {fmt(r['elong120'])} hole {fmt(r['hole120'])} "
              f"chain {fmt(r['chainy120'])} f/s/b {fmt(r['front120'])}/{fmt(r['side120'])}/{fmt(r['back120'])} glue {fmt(r['glue120'])} "
              f"mat {fmt(r['matured120'])} {('STABLE ' + r['kind']) if r['stable'] else ''}")
        if args.crops:
            for t, key in (("t120", "_m120"), ("t120_walls", "_m120"), ("t80", "_m80")):
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
    ap.add_argument("--keep", default="", help="comma-separated run names to store as configurations")
    a = ap.parse_args()
    if a.what == "make":
        make()
    else:
        analyse(a)


if __name__ == "__main__":
    main()
