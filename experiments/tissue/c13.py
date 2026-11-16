"""Step C13, fields as guides, in the tissue lab: EACH GATE ALONE, hand-set, mutation off; the conditions and their analysis.

    python experiments/tissue/c13.py make                 # writes experiments/conditions/c13/lab/<series>/*.json and batches
    python tools/experiment.py experiments/conditions/c13/lab/<series>/batch.json --out experiments/runs/tissue-c13
    python experiments/tissue/c13.py analyse              # table of every run (experiments/tissue/c13-sweep.csv); --keep a,b stores
                                                          # the chosen ones in experiments/tissue/configs/c13-<name>/
    python experiments/tissue/c13.py analyse --crops DIR  # also crop every run's shots into DIR (for looking; not kept)

The method is the tissue series' and steps C10 / C11's (TISSUE.md "How the runs were made"): few cells, one genome cloned to all,
mutation off, differentiation off, no squeeze, a dark dish without springs, crawling free of battery cost; measures every 5 s, a stir
through the largest cluster at 82 s, the end at 120 s; the walls' cost off; the glue's turning (C11) on. Field A is FELT (the gates
read it): with the default beat (lever 0.4) and with the long beat (lever 0.2). Every gate runs alone, its gene set by hand to +1 or -1,
against the same genes with that gate switched off ("off": the control, side by side). The other gates are off throughout; the field
genes are at today's values (mutation off, nothing drifts).

Series:
  glue  uniform walls (a0 0.6): the glue gate, each side's adhesion x (1 + g s_k); 40 and 100 cells
  turn  polar walls (a0 0.4, a1 0.5: the front sticky): the turn gate, the front toward (+1) or away from (-1) the felt gradient
  div   ONE founder grows to 100 cells (c11.py's grow set-up; uniform walls a0 0.8, divisions by the front with divAxis 0): the
        division gate, the daughter along (+1) or across (-1) the felt gradient
  rate  40 cells under the whole dish's light with a light spring under them, each cell a harvester and a burner (a visible-1 pigment
        making gt, and a gt burner), the eating paid from the battery: the engine and pump gates together (+1 / -1: engines and a
        pump of light atoms IN run faster where the field is high / low)
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

CONDS = os.path.join(REPO, "experiments", "conditions", "c13", "lab")
RUNS = os.path.join(REPO, "experiments", "runs", "tissue-c13")
CONFIGS = os.path.join(HERE, "configs")

BASE_GENES = {"keyAngle": 0.35, "keyScale": 0.05, "recAngle": 0.35, "recScale": 0.05, "recWidth": 0.15, "size": 1, "motility": 1,
              "mix": 0, "thickness": 0.012, "stiffness": 1, "pumpRate0": 0, "pumpRate1": 0, "rate0": 2, "rate1": 0, "rate2": 0,
              "w": 0, "divAxis": 0, "a1": 0, "a2": 0,
              "gateGlue": 0, "gatePump": 0, "gateEngine": 0, "gateDiv": 0, "gateTurn": 0, "push": 1}
GATES_OFF = {"guides.params.glue": False, "guides.params.pump": False, "guides.params.engine": False, "guides.params.div": False,
             "guides.params.turn": False}
BASE_KNOBS = {"cells.params.squeeze": 0, "genome.rules.diff": False, "eat.params.pay": False, "walls.params.cost": False, **GATES_OFF}
QUERY = {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "springs": 0, "light": "off", "day": 0}
BEATS = {
    "db": ("the default beat (lever 0.4)", {"cells.params.lever": 0.4}),
    "lb": ("the long beat (lever 0.2)", {"cells.params.lever": 0.2}),
}
GROW_QUERY = {"cells": 1, "cap": 100, "life": 1, "mut": 0}
GROW_KNOBS = {"division.params.divAt": 0.003, "division.params.cost": 0, "division.params.starveAt": 0, "division.params.age": 0,
              "membrane.params.burst": False}
# series: (gate's knob, gene, walls genes and extra genes, extra knobs, query, cells list, description)
SERIES = {
    "glue": ("glue", "gateGlue", {"adhesion": 0.6}, {}, {}, (40, 100), "uniform walls a0 0.6"),
    "turn": ("turn", "gateTurn", {"adhesion": 0.4, "a1": 0.5}, {}, {}, (40,), "polar walls a0 0.4, a1 0.5 (the front sticky)"),
    "div": ("div", "gateDiv", {"adhesion": 0.8, "rate0": 0}, GROW_KNOBS, GROW_QUERY, (1,), "one founder grows to 100 cells, uniform walls a0 0.8"),
    "rate": ("engine", "gateEngine", {"adhesion": 0.6, "rate0": 1.5, "rate1": 1.0, "pumpRate0": 1.0},
             {"eat.params.pay": True, "guides.params.pump": "SAME"}, {"light": "full"}, (40,),
             "uniform walls a0 0.6; whole dish lit; a light spring under the cells; a harvester (visible 1, g + t -> gt) and a gt burner, "
             "a pump of g IN; engines and pump gated together"),
}


def condition(name, series, desc, genes, knobs, query=None, cells=40, extra_js="", seed=3, stir=True):
    q = dict(QUERY, cells=cells, seed=seed)
    q.update(query or {})
    g = dict(BASE_GENES)
    g.update(genes)
    k = dict(BASE_KNOBS)
    k.update(knobs)
    js0 = ("const T = await import('/experiments/tissue/tissue-lab.js'); window.__T = T;\n"
           f"const knobs = T.apply({json.dumps(k)});\n"
           f"const g = {json.dumps(g)}; g.eng0 = moire.genome.engineCode('gt → g + t', 0);\n"
           f"{extra_js}\n"
           "await T.genes(g, null);\n"
           "const fr = await T.fronts({ mode: 'random' });\n"
           "return { knobs, genes: g, fronts: fr, m: await T.measure({ every: 1 }) };")
    evals = [{"t": 0, "js": js0}, {"t": 60, "js": "return await __T.measure({ every: 1 });"},
             {"t": 80, "js": "return await __T.measure({ every: 1 });"}]
    if stir:
        evals.append({"t": 82, "js": "return await __T.stirThrough();"})
    evals.append({"t": 120, "js": "return await __T.measure({ every: 1 });"})
    return {
        "name": name, "series": series, "description": desc,
        "tissue_setting": {"knobs": knobs, "genes": genes, "typeB": None, "query": query or {}, "extra_js": extra_js},
        "query": q, "duration": 120, "sample_every": 5, "tissue": True, "evals": evals, "dpr": 2,
        "shots": [{"t": 30}, {"t": 60}, {"t": 80}, {"t": 120}, {"t": 80, "view": "guides"}, {"t": 120, "view": "guides"},
                  {"t": 80, "view": "machinery"}],
        "snapshots": [{"t": 80, "grid": False, "name": "prestir"}, {"t": 120, "grid": False, "name": "end"}],
    }


def make():
    out = {}
    for series, (gate, gene, sgenes, sknobs, squery, cells_list, sdesc) in SERIES.items():
        for cells in cells_list:
            for bk, (bdesc, bknobs) in BEATS.items():
                for gk, gv, on in (("p", 1, True), ("m", -1, True), ("off", 1, False)):
                    if cells == 100 and gk == "m":
                        continue   # (100 cells: + and off only, for time)
                    genes = dict(sgenes)
                    genes[gene] = gv
                    knobs = dict(bknobs)
                    knobs.update({k: v for k, v in sknobs.items() if v != "SAME"})
                    knobs[f"guides.params.{gate}"] = on
                    if sknobs.get("guides.params.pump") == "SAME":
                        knobs["guides.params.pump"] = on
                        genes["gatePump"] = gv
                    extra = ""
                    if series == "rate":
                        # a visible-1 harvester (g + t -> gt) in slot 1, the gt burner in slot 0, a pump of g IN in slot 0
                        extra = ("g.eng1 = moire.genome.engineCode('g + t → gt', 1); g.pump0 = moire.genome.pumpCode('g', 'in'); "
                                 "{ const v = moire.control.view(); moire.matter.addSpring(v.cssW / 2, v.cssH / 2, 'light', 1e9); }")
                    size = f"-{cells}" if cells == 100 else ""
                    name = f"c13-{series}-{bk}-{gk}{size}"
                    gdesc = "gate off (the gene +1 does nothing)" if not on else f"gene {gv:+d}"
                    desc = f"{sdesc}; {bdesc}; the {gate} gate {gdesc}; {cells if cells > 1 else 'one founder,'} cells"
                    q = dict(squery)
                    out.setdefault(series, []).append(condition(name, series, desc, genes, knobs, query=q, cells=cells, extra_js=extra))
    for series, conds in out.items():
        d = os.path.join(CONDS, series)
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)
        for c in conds:
            with open(os.path.join(d, c["name"] + ".json"), "w", encoding="utf-8") as f:
                json.dump(c, f, indent=1, ensure_ascii=False)
        with open(os.path.join(d, "batch.json"), "w", encoding="utf-8") as f:
            json.dump({"batch": f"c13-{series}", "runs": [c["name"] + ".json" for c in conds]}, f, indent=1)
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
        crop2(r, os.path.join(rd, "shots", image), os.path.join(d, "clean.jpg"), box, scale=0.75)
    keep = {k: v for k, v in r.items() if not k.startswith("_")}
    keep["measures_t80"] = r["_m80"]
    keep["measures_t120"] = r["_m120"]
    keep["url"] = f"index.html?snap=experiments/tissue/configs/{name}/snapshot.json"
    keep["run"] = os.path.relpath(rd, REPO).replace(os.sep, "/")
    keep["commit"] = r["_meta"].get("commit")
    with open(os.path.join(d, "measures.json"), "w", encoding="utf-8") as f:
        json.dump(keep, f, indent=1)


def crop2(r, src, dst, box, scale=0.5):
    """Crop a shot taken at the condition's dpr (the boxes are CSS px)."""
    k = float(r["_cond"].get("dpr", 1))
    A.crop(src, dst, [x * k for x in box], margin=36 * k, scale=scale, minimum=200 * k)


COLS = ["name", "series", "description", "cells", "n80", "score", "iscore", "stable", "kind", "hold", "persist", "reform", "contacts",
        "clusters", "isolated", "compact", "internal", "move", "end_inLargest", "elong80", "hole80", "chainy80", "elong120", "hole120",
        "felt", "spread", "guide", "contactFelt", "frontCos", "divCos", "glueEff", "rateEff", "glue80", "matured80", "bonds80",
        "chains80", "longest80", "rings80", "bat", "burner", "eGain", "pumpBusy", "speed", "status"]


def analyse(args):
    res = []
    for rd in sorted(glob.glob(os.path.join(args.runs or RUNS, "*"))):
        if not os.path.exists(os.path.join(rd, "meta.json")):
            continue
        if args.only and not any(os.path.basename(rd).startswith(p) for p in args.only.split(",")):
            continue
        r = A.analyse_run(rd)
        if r.get("status") == "ok":
            rows = r["_rows"]
            for t, m in (("80", r["_m80"]),):
                w = (m or {}).get("walls") or {}
                r["glue" + t], r["matured" + t] = w.get("glue"), w.get("matured")
                r["bonds" + t], r["chains" + t], r["longest" + t], r["rings" + t] = (w.get("bondsPerCell"), w.get("chains"),
                                                                                     w.get("longestChain"), w.get("rings"))
            r["n80"] = (r["_m80"] or {}).get("n")
            for k, col in (("felt", "guides.felt"), ("spread", "guides.spread"), ("guide", "guides.guide"), ("contactFelt", "guides.contactFelt"),
                           ("frontCos", "guides.frontCos"), ("glueEff", "guides.glueEff"), ("rateEff", "guides.rateEff"),
                           ("bat", "cells.bat"), ("burner", "cells.rate.burned"), ("pumpBusy", "pumps.rate")):
                r[k] = A.window(rows, col, 50, 80)
            # divisions against the gradient: the cumulative |cos| at the end (the whole growth)
            r["divCos"] = A.num(rows[-1].get("guides.divCos"))
            r["eGain"] = A.window(rows, "cells.rate2.eGain", 50, 80)
        res.append(r)
    out = os.path.join(HERE, "c13-sweep.csv") if not args.runs else os.path.join(args.runs, "sweep.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in res:
            w.writerow({k: (f"{v:.4g}" if isinstance(v, float) else v) for k, v in r.items() if k in COLS})
    keep = set((args.keep or "").split(",")) - {""}
    fmt = lambda x: "-" if x is None else f"{x:.2f}"  # noqa: E731
    for r in res:
        if r.get("status") != "ok":
            print(f"{r['name']:28s} {r.get('status')} {r.get('error', '')[:80]}")
            continue
        print(f"{r['name']:22s} n {r['n80']} sc {r['score']:.2f} isc {r['iscore']:.2f} pers {fmt(r['persist'])} cont {fmt(r['contacts'])} "
              f"cl {fmt(r['clusters'])} iso {fmt(r['isolated'])} el {fmt(r['elong80'])} hole {fmt(r['hole80'])} | felt {fmt(r['felt'])} "
              f"spr {fmt(r['spread'])} grad {fmt(r['guide'])} cF {fmt(r['contactFelt'])} fC {fmt(r['frontCos'])} dC {fmt(r['divCos'])} "
              f"gE {fmt(r['glueEff'])} rE {fmt(r['rateEff'])} glue {fmt(r['glue80'])} bonds {fmt(r['bonds80'])} bat {fmt(r['bat'])} "
              f"burn {fmt(r['burner'])} {('STABLE ' + r['kind']) if r['stable'] else ''}")
        if args.crops:
            for t, key in (("t80", "_m80"), ("t80_guides", "_m80"), ("t120", "_m120"), ("t120_guides", "_m120"), ("t80_machinery", "_m80")):
                box = r[key].get("boxAll") or r[key].get("box")
                p = os.path.join(r["_rd"], "shots", t + ".png")
                if box and os.path.exists(p):
                    crop2(r, p, os.path.join(args.crops, f"{r['name']}_{t}.png"), box, scale=1.0)
        if r["name"] in keep:
            store(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["make", "analyse"])
    ap.add_argument("--crops", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--runs", default="", help="another runs folder (default experiments/runs/tissue-c13)")
    ap.add_argument("--keep", default="", help="comma-separated run names to store as configurations")
    a = ap.parse_args()
    if a.what == "make":
        make()
    else:
        analyse(a)


if __name__ == "__main__":
    main()
