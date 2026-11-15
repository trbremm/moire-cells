"""Step C12b tissue lab: the same 40 cloned cells with three hand-set lipid membranes, no mutation, no turnover.

Writes experiments/conditions/c12b/lab-<arm>.json (and lab-batch.json). Every arm gets the same supply: a soap, an oil and a
linker spring at the cluster's centre and on a ring around it (30 s), so each membrane takes what its genes ask for:
  soap    the bilayer of soap only (oil share 0, no wall): soft, fluid
  oily    soap with one oil molecule per soap between its tails (oil share 1): packed, stiffer
  walled  soap only, plus a full crust wall outside (wall 1, half light half heavy crust): rigid, brittle
Everything else as the C11 lab's uniform pattern (adhesion 0.8, long beat lever 0.2, glue turning on; no squeeze, no
differentiation, no crawl cost, glue free). At 80 s a stir goes through the cluster (tissue-lab.js stirThrough).

Usage: python experiments/tissue/c12b.py, then python tools/experiment.py experiments/conditions/c12b/lab-batch.json
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'conditions', 'c12b')

BASE_GENES = {"keyAngle": 0.35, "keyScale": 0.05, "recAngle": 0.35, "recScale": 0.05, "recWidth": 0.15, "size": 1, "motility": 1,
              "thickness": 0.012, "stiffness": 1, "pumpRate0": 0, "pumpRate1": 0, "rate0": 2, "rate1": 0, "rate2": 0, "w": 0,
              "divAxis": 0, "adhesion": 0.8, "a1": 0.0, "a2": 0.0, "head": 0.0}
ARMS = {
    "soap": ({"oilShare": 0.0, "wall": 0.0, "wallRow": 0.5}, "off"),
    "oily": ({"oilShare": 1.0, "wall": 0.0, "wallRow": 0.5}, "off"),
    "walled": ({"oilShare": 0.0, "wall": 1.0, "wallRow": 0.5}, "off"),
    # the same in a warm dish (the whole dish lit, no day cycle: about 8 to 10 heat per R^2 instead of 1 to 2)
    "soap-warm": ({"oilShare": 0.0, "wall": 0.0, "wallRow": 0.5}, "full"),
    "oily-warm": ({"oilShare": 1.0, "wall": 0.0, "wallRow": 0.5}, "full"),
}
KNOBS = {"cells.look.nStarveDim": 0, "cells.look.starveDim": 0, "cells.params.squeeze": 0, "genome.rules.diff": False, "eat.params.pay": False, "walls.params.cost": False,
         "cells.params.lever": 0.2, "walls.params.turn": True}


def condition(arm, genes, light="off", lipids=True):
    g = dict(BASE_GENES, **genes)
    name = f"c12b-lab-{arm}" + ("" if lipids else "-off")
    t0 = ("const T = await import('/experiments/tissue/tissue-lab.js'); window.__T = T;\n"
          f"const knobs = T.apply({json.dumps(KNOBS)});\n"
          f"const g = {json.dumps(g)}; g.eng0 = moire.genome.engineCode('gt → g + t', 0);\n"
          "await T.genes(g, null);\n"
          "const fr = await T.fronts({ mode: 'random' });\n"
          "const sp = await T.lipidSprings({ kinds: ['soap', 'oil', 'linker'], ring: 4, n: 4, life: 30 });\n"
          "return { knobs, genes: g, springs: sp, m: await T.measure({ every: 1 }) };")
    q = {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "springs": 0, "light": light, "day": 0}
    if not lipids:
        q["lipids"] = 0
    return {
        "name": name,
        "series": "c12b-lab",
        "description": f"step C12b lab: 40 cloned cells, {arm} membrane ({json.dumps(genes)}), light {light}; soap, oil and linker springs for 30 s; stir at 82 s",
        "query": q,
        "size": "640x400",
        "dpr": 3,
        "duration": 120,
        "sample_every": 5,
        "tissue": True,
        "evals": [
            {"t": 0, "js": t0},
            {"t": 60, "js": "return await __T.lipidMeasure();"},
            {"t": 80, "js": "return await __T.lipidMeasure();"},
            {"t": 82, "js": "return await __T.stirThrough();"},
            {"t": 83, "js": "return await __T.lipidMeasure();"},
            {"t": 120, "js": "return await __T.lipidMeasure();"},
        ],
        "shots": [{"t": 30}, {"t": 60}, {"t": 80}, {"t": 83}, {"t": 120}, {"t": 80, "view": "machinery"}],
        "clips": [{"t": 81, "until": 86, "speed": 1}],
        "snapshots": [{"t": 80, "grid": False, "name": "prestir"}],
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    runs = []
    for arm, (genes, light) in ARMS.items():
        c = condition(arm, genes, light)
        path = os.path.join(OUT, f"lab-{arm}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(c, fh, indent=1, ensure_ascii=False)
        runs.append(os.path.basename(path))
    with open(os.path.join(OUT, "lab-batch.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-lab", "runs": runs}, fh, indent=1)
    print("wrote", len(runs), "conditions to", OUT)


if __name__ == "__main__":
    main()
