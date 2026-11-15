"""Write the tissue experiments' condition files (experiments/conditions/tissue/<series>/*.json) from the tables below.

Every run: few cells, no evolution (mutation and the life cycle off), one genome for all (or two types by slot parity), the
baseline's knobs plus the run's own, 120 s of simulated time:
  t 0      set knobs and genes (experiments/tissue/tissue-lab.js), measure
  every 5  sample (moire.sample with the tissue measures)
  t 60, 80 measure, shot (clean neon view); t 80 snapshot "prestir" (cells only)
  t 82     STIR through the largest cluster's centre (a mouse drag, 12 frames of 14 CSS px)
  t 120    measure, shots (clean, and lineage / strategy), snapshot "end" (cells only)

    python experiments/tissue/make_conditions.py            # writes every series
    python tools/experiment.py experiments/conditions/tissue/<series>/batch.json --out experiments/runs/tissue
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "experiments", "conditions", "tissue")

# ---------------------------------------------------------------- the baseline
BASE_QUERY = {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "springs": 0, "light": "off", "day": 0}
BASE_KNOBS = {
    "cells.params.squeeze": 0,          # no pull to the dish centre: what holds must hold by itself
    "genome.rules.diff": False,         # no differentiation: every cell stays stem (one type, one fate)
    "eat.params.pay": False,            # crawling is free (else the dark empties the batteries and everyone stops)
}
BASE_GENES = {
    "keyAngle": 0.35, "keyScale": 0.05, "recAngle": 0.35, "recScale": 0.05, "recWidth": 0.15,
    "adhesion": 0.6, "size": 1, "motility": 1,
    "mix": 0, "thickness": 0.012, "stiffness": 1, "pumpRate0": 0, "pumpRate1": 0,
    "rate0": 2, "rate1": 0, "rate2": 0,  # one engine, a burner of gt (strategy view: green); idle in the dark
}
# the engine codes are set in the page (moire.genome.engineCode) in the setup eval
ENG_A = "moire.genome.engineCode('gt → g + t', 0)"
ENG_B = "moire.genome.engineCode('g + t → gt', 1)"   # a harvester without a burner (strategy view: gold); idle in the dark

DURATION, STIR_T = 120, 82


def condition(name, series, desc, knobs=None, genes=None, typeB=None, query=None, every=1, extra_js="", duration=DURATION,
              size=None):
    q = {**BASE_QUERY, **(query or {})}
    k = {**BASE_KNOBS, **(knobs or {})}
    g = {**BASE_GENES, **(genes or {})}
    tb = dict(typeB) if typeB is not None else None
    two = tb is not None
    setup = (
        "const T = await import('/experiments/tissue/tissue-lab.js'); window.__T = T;\n"
        f"const knobs = T.apply({json.dumps(k)});\n"
        f"const g = {json.dumps(g)}; g.eng0 = {ENG_A};\n"
        + (f"const b = {json.dumps(tb)}; b.eng0 = {ENG_B};\n" if two else "const b = null;\n")
        + f"await T.genes(g, b);\n{extra_js}\n"
        f"return {{ knobs, genes: g, typeB: b, m: await T.measure({{ every: {2 if two else 1} }}) }};"
    )
    meas = f"return await __T.measure({{ every: {2 if two else 1} }});"
    view2 = "strategy" if two else "lineage"
    c = {
        "name": name,
        "description": desc,
        "series": series,
        "tissue_setting": {"knobs": knobs or {}, "genes": genes or {}, "typeB": typeB, "query": query or {}, "extra_js": extra_js},
        "query": q,
        "duration": duration,
        "sample_every": 5,
        "tissue": True,
        "evals": [{"t": 0, "js": setup}, {"t": 60, "js": meas}, {"t": 80, "js": meas},
                  {"t": STIR_T, "js": "return await __T.stirThrough();"}, {"t": duration, "js": meas}],
        "shots": [{"t": 60}, {"t": 80}, {"t": duration}, {"t": duration, "view": view2}],
        "snapshots": [{"t": 80, "grid": False, "name": "prestir"}, {"t": duration, "grid": False, "name": "end"}],
    }
    if size:
        c["size"] = size
    return c


# ---------------------------------------------------------------- the series
def series_pilot():
    return [
        condition("tp-base", "pilot", "baseline: 40 cells, no squeeze, no fates, dark, no springs"),
        condition("tp-squeeze", "pilot", "baseline + the default squeeze (0.25)", knobs={"cells.params.squeeze": 0.25}),
        condition("tp-adh-hi", "pilot", "baseline, adhesion gene 1, global adhesion x2", knobs={"genome.params.adhesion": 1.2},
                  genes={"adhesion": 1}),
        condition("tp-nosense", "pilot", "baseline, field A not felt", knobs={"cells.params.senseOn": False}),
    ]


def series_hold():
    """One factor at a time from the baseline (one genome, 40 cells, dark, no springs): what makes the blob HOLD and re-form."""
    S, out = "hold", []

    def c(name, desc, **kw):
        out.append(condition("th-" + name, S, desc, **kw))

    c("base", "baseline")
    # adhesion
    for a in (0, 0.25, 0.4, 0.8, 1.0):
        c(f"adhgene-{a:g}", f"adhesion gene {a:g} (baseline 0.6)", genes={"adhesion": a})
    for a in (0.3, 1.2, 2.4):
        c(f"adh-{a:g}", f"global adhesion strength {a:g} (genome.params.adhesion, baseline 0.6)", knobs={"genome.params.adhesion": a})
    for b in (0, 0.5):
        c(f"adhbase-{b:g}", f"adhesion baseline loss {b:g} (genome.params.adhBase, baseline 0.25)", knobs={"genome.params.adhBase": b})
    # motility
    for m in (0.5, 2):
        c(f"motgene-{m:g}", f"motility gene {m:g} (baseline 1)", genes={"motility": m})
    c("crawl-0", "no crawling (genome.params.crawl 0, baseline 0.6 R/s)", knobs={"genome.params.crawl": 0})
    c("crawl-1.5", "fast crawling (genome.params.crawl 1.5)", knobs={"genome.params.crawl": 1.5})
    # size
    for s in (0.85, 1.15):
        c(f"size-{s:g}", f"size gene {s:g} (baseline 1)", genes={"size": s})
    # field A, the loop
    c("senseoff", "field A not felt (key S)", knobs={"cells.params.senseOn": False})
    c("emitoff", "cells do not emit (key O): no field at all", knobs={"cells.params.emit": False})
    for g in (3, 20, 40):
        c(f"sense-{g:g}", f"field A gain {g:g} (cells.params.sense, baseline 10)", knobs={"cells.params.sense": g})
    for lv in (0.2, 0.8):
        c(f"lever-{lv:g}", f"lever {lv:g} (baseline 0.4; smaller = longer beats)", knobs={"cells.params.lever": lv})
    for k in (0.08, 0.8):
        c(f"key-{k:g}", f"key angle {k:g} rad (baseline 0.35): how far the clone's lattice is turned from the medium's",
          genes={"keyAngle": k, "recAngle": k})
    c("anchor-0", "beat anchor: sliding moire (the reference; key X)", knobs={"cells.params.anchor": 0})
    c("anchor-2", "beat anchor: still in the world (key X)", knobs={"cells.params.anchor": 2})
    c("r0-3.5", "field A envelope range 3.5 R (cells.params.r0, baseline 2.2)", knobs={"cells.params.r0": 3.5, "cells.params.cut": 5})
    # field B (step 5)
    c("Boff", "field B not felt (key Q)", knobs={"cells.fields.on": False})
    c("Bfate", "field B charges per fate, not from the stock (charge.params.stock off): every stem cell charge +1, like attracts like",
      knobs={"charge.params.stock": False})
    c("Bfate-repel", "field B per fate, like REPELS like (sign +1)", knobs={"charge.params.stock": False, "cells.fields.sign": 1})
    c("Bfate-gain2", "field B per fate, like attracts, gain 2 (baseline 0.6)", knobs={"charge.params.stock": False, "cells.fields.gain": 2})
    # exclusion (step 7)
    c("excl3", "exclusion on, 3 states, flip", knobs={"cells.excl.on": True})
    c("excl2", "exclusion on, 2 states, flip", knobs={"cells.excl.on": True, "cells.excl.states": 2})
    # partner fields (step 8)
    c("clock", "step 8 rule b: clock (change makes the partner)", knobs={"cells.partner.change": True})
    c("clock-side", "step 8 rules b + c: clock and sideways push (the curls)", knobs={"cells.partner.change": True, "cells.partner.side": True})
    c("clock-side-phase", "step 8 rules a + b + c", knobs={"cells.partner.change": True, "cells.partner.side": True, "cells.partner.on": True})
    # cell shape (step C6c)
    c("ellipse", "honeycomb off: the ellipse cells", knobs={"cells.shape.on": False})
    c("shape-soft", "honeycomb corners soft (cells.shape.stiffness 0.3)", knobs={"cells.shape.stiffness": 0.3})
    c("shape-stiff", "honeycomb corners stiff (cells.shape.stiffness 3)", knobs={"cells.shape.stiffness": 3})
    c("jelly-0", "rigid outline (cells.shape.jelly 0, baseline 0.3)", knobs={"cells.shape.jelly": 0})
    c("snap-1", "no wall snapping (cells.shape.snap 1: corners only stop at walls)", knobs={"cells.shape.snap": 1})
    c("memstiff-2", "membrane stiffness gene 2, thick heavy membrane (mix 1, thickness 0.03)", genes={"stiffness": 2, "mix": 1, "thickness": 0.03})
    # heat and noise
    c("kicksoff", "heat kicks off: the old constant jitter 0.05 R", knobs={"heat.params.kicks": False})
    c("jitter-0.2", "heat kicks off, constant jitter 0.2 R", knobs={"heat.params.kicks": False, "cells.params.jitter": 0.2})
    c("jitter-0", "heat kicks off, no jitter", knobs={"heat.params.kicks": False, "cells.params.jitter": 0})
    c("warm", "a warmer dish (heat.params.warmth 0.5, baseline 0.05)", knobs={"heat.params.warmth": 0.5})
    # medium
    c("drift-0", "no medium drift (cells.params.drift 0, baseline 0.15 R/s)", knobs={"cells.params.drift": 0})
    c("drift-0.5", "strong medium drift 0.5 R/s", knobs={"cells.params.drift": 0.5})
    c("stiff-3", "soft contact push (cells.params.stiffness 3, baseline 7)", knobs={"cells.params.stiffness": 3})
    c("stiff-14", "hard contact push (cells.params.stiffness 14)", knobs={"cells.params.stiffness": 14})
    c("squeeze", "the page's default squeeze 0.25 (a pull to the dish centre)", knobs={"cells.params.squeeze": 0.25})
    # fates (differentiation on, everyone committing to one fate through its own key)
    for k, fate in enumerate(["epithelium", "muscle", "neuron", "cartilage"]):
        resp = {f"resp{j}": (1 if j == k else -1) for j in range(4)}
        c(f"fate-{fate}", f"differentiation on: the clone commits to {fate} (+ same-fate glue 0.5, the fate's size and motility)",
          knobs={"genome.rules.diff": True}, genes={**resp, "threshold": 0.6, "recWidth": 0.25})
    # number of cells
    for n in (20, 100, 300):
        c(f"n{n}", f"{n} cells", query={"cells": n})
    return out


def series_chem():
    """Chemistry on: the default springs beside the culture and the spotlight; then the charge, dipoles, membrane, pumps."""
    S, out = "chem", []
    Q = {"springs": 1, "light": "spot"}

    def c(name, desc, knobs=None, genes=None, query=None, extra_js=""):
        out.append(condition("tc-" + name, S, desc, knobs=knobs, genes=genes, query={**Q, **(query or {})}, extra_js=extra_js))

    c("base", "chemistry baseline: the default light and heavy springs beside the culture, the spotlight (no day cycle)")
    c("lightoff", "springs, no light", query={"light": "off"})
    c("full", "springs, full-field light", query={"light": "full"})
    c("chargeoff", "charge field off (?charge=0)", knobs={"charge.params.on": False})
    c("lambda-1", "charge screening length 1 R (baseline 3)", knobs={"charge.params.lambda": 1})
    c("lambda-9", "charge screening length 9 R", knobs={"charge.params.lambda": 9})
    c("qfeeloff", "cells do not feel the charge field", knobs={"charge.params.feel": False})
    c("qstockoff", "field B charges per fate (not from the stock)", knobs={"charge.params.stock": False})
    c("dipoff", "dipoles off", knobs={"dipole.params.on": False})
    c("dip-polar", "dipoles: strong polarisation by the field (polar 0.6) and strong dipole push (2)",
      knobs={"dipole.params.polar": 0.6, "dipole.params.push": 2})
    c("memoff", "membrane chemistry off", knobs={"membrane.params.on": False})
    c("memheavy", "heavy thick stiff membranes (mix 1, thickness 0.03, stiffness 2)", genes={"mix": 1, "thickness": 0.03, "stiffness": 2})
    c("pump-steal", "pumps across contact: everyone pumps fuel gt IN from its neighbours (rate 1)",
      extra_js="await moire.genome.setAll({ pump0: moire.genome.pumpCode('gt', 'in'), pumpRate0: 1 });")
    c("pump-share", "pumps across contact: everyone pumps fuel gt OUT (rate 1)",
      extra_js="await moire.genome.setAll({ pump0: moire.genome.pumpCode('gt', 'out'), pumpRate0: 1 });")
    return out


def series_types():
    """Two types (slot parity), started mixed: sorting, core and shell (type B = every second slot)."""
    S, out = "types", []

    def c(name, desc, genes=None, typeB=None, knobs=None, query=None, extra_js=""):
        out.append(condition("tt-" + name, S, desc, genes=genes, typeB=typeB, knobs=knobs, query=query, extra_js=extra_js))

    c("same", "two types that differ only in their engines (the control: no sorting expected)", typeB={})
    c("dah", "differential adhesion: A adhesion 1, B 0.3", genes={"adhesion": 1}, typeB={"adhesion": 0.3})
    c("dah-mild", "differential adhesion: A 0.9, B 0.6", genes={"adhesion": 0.9}, typeB={"adhesion": 0.6})
    c("key-7deg", "B's key turned 0.12 rad (7 deg): cross adhesion weaker (like sticks to like); adhesion 0.8 both",
      genes={"adhesion": 0.8}, typeB={"keyAngle": 0.47, "recAngle": 0.47})
    c("key-17deg", "B's key turned 0.3 rad (17 deg); adhesion 0.8 both", genes={"adhesion": 0.8}, typeB={"keyAngle": 0.65, "recAngle": 0.65})
    c("mot", "B crawls 2.5x faster (motility 2.5)", typeB={"motility": 2.5})
    c("size", "A small (size 0.85), B large (1.15)", genes={"size": 0.85}, typeB={"size": 1.15})
    c("dah-senseoff", "differential adhesion A 1 / B 0.3, field A not felt", genes={"adhesion": 1}, typeB={"adhesion": 0.3},
      knobs={"cells.params.senseOn": False})
    c("key-excl", "B's key turned 0.35 rad (another exclusion state), exclusion on", genes={"adhesion": 0.8},
      typeB={"keyAngle": 0.7, "recAngle": 0.7}, knobs={"cells.excl.on": True})
    for nm, scatter in (("dah-agg", True),):
        c(nm, "differential adhesion A 1 / B 0.3, started SCATTERED (aggregation assay)", genes={"adhesion": 1},
          typeB={"adhesion": 0.3}, extra_js="await T.scatter({ radius: 14 });")
    c("key-agg", "B's key turned 7 deg, adhesion 0.8, started SCATTERED", genes={"adhesion": 0.8},
      typeB={"keyAngle": 0.47, "recAngle": 0.47}, extra_js="await T.scatter({ radius: 14 });")
    c("dah-100", "differential adhesion A 1 / B 0.3, 100 cells", genes={"adhesion": 1}, typeB={"adhesion": 0.3}, query={"cells": 100})
    return out


def series_pairs():
    """The most promising pairs, and the aggregation assay (started scattered) for the main holders."""
    S, out = "pairs", []
    A8 = {"adhesion": 0.8}
    BF = {"charge.params.stock": False}
    AGG = "await T.scatter({ radius: 14 });"

    def c(name, desc, **kw):
        out.append(condition("tq-" + name, S, desc, **kw))

    # adhesion that holds (gene 0.8) + a structure maker
    c("adh08-clockside", "adhesion gene 0.8 + step 8 clock and sideways push", genes=A8,
      knobs={"cells.partner.change": True, "cells.partner.side": True})
    c("adh08-excl3", "adhesion gene 0.8 + exclusion (3 states, flip)", genes=A8, knobs={"cells.excl.on": True})
    c("adh08-excl2", "adhesion gene 0.8 + exclusion (2 states, flip)", genes=A8, knobs={"cells.excl.on": True, "cells.excl.states": 2})
    c("adh1-excl2-nosense", "adhesion gene 1 + exclusion (2 states), field A not felt", genes={"adhesion": 1},
      knobs={"cells.excl.on": True, "cells.excl.states": 2, "cells.params.senseOn": False})
    c("adh08-Brepel-100", "adhesion gene 0.8 + field B per fate, like repels like, 100 cells", genes=A8,
      knobs={**BF, "cells.fields.sign": 1}, query={"cells": 100})
    c("adh1-Brepel-100", "adhesion gene 1 + field B per fate, like repels like, 100 cells", genes={"adhesion": 1},
      knobs={**BF, "cells.fields.sign": 1}, query={"cells": 100})
    c("adh08-sense40", "adhesion gene 0.8 + field A gain 40", genes=A8, knobs={"cells.params.sense": 40})
    c("adh08-lever02", "adhesion gene 0.8 + lever 0.2 (long beats)", genes=A8, knobs={"cells.params.lever": 0.2})
    c("adh08-mot2", "adhesion gene 0.8 + motility gene 2", genes={**A8, "motility": 2})
    c("adh1-mot2", "adhesion gene 1 + motility gene 2", genes={"adhesion": 1, "motility": 2})
    c("adh08-muscle", "adhesion gene 0.8 + the clone commits to muscle (built-in stretch)", knobs={"genome.rules.diff": True},
      genes={**A8, "resp0": -1, "resp1": 1, "resp2": -1, "resp3": -1, "threshold": 0.6, "recWidth": 0.25})
    c("adh08-ellipse", "adhesion gene 0.8 + ellipse cells (honeycomb off)", genes=A8, knobs={"cells.shape.on": False})
    c("adh08-n300", "adhesion gene 0.8, 300 cells", genes=A8, query={"cells": 300})
    c("Bfate-senseoff", "field B per fate (like attracts) + field A not felt", knobs={**BF, "cells.params.senseOn": False})
    c("Bfate-mot2", "field B per fate (like attracts) + motility gene 2", knobs=BF, genes={"motility": 2})
    c("Bfate-excl3", "field B per fate (like attracts) + exclusion (3 states)", knobs={**BF, "cells.excl.on": True})
    c("Bfate-clockside", "field B per fate (like attracts) + step 8 clock and sideways push",
      knobs={**BF, "cells.partner.change": True, "cells.partner.side": True})
    c("Bfate-adh0", "field B per fate (like attracts), adhesion gene 0: does the long-range pull alone link?", knobs=BF,
      genes={"adhesion": 0})
    # the aggregation assay (started scattered over a disc of 14 R)
    c("agg-base", "baseline, started scattered", extra_js=AGG)
    c("agg-adh08", "adhesion gene 0.8, started scattered", genes=A8, extra_js=AGG)
    c("agg-adh1-nosense", "adhesion gene 1, field A not felt, started scattered", genes={"adhesion": 1},
      knobs={"cells.params.senseOn": False}, extra_js=AGG)
    c("agg-Bfate", "field B per fate (like attracts), started scattered", knobs=BF, extra_js=AGG)
    c("agg-Bfate-adh08", "field B per fate + adhesion 0.8, started scattered", knobs=BF, genes=A8, extra_js=AGG)
    # two types, pairs
    c("dah-Bfate", "differential adhesion A 1 / B 0.3 + field B per fate (like attracts)", genes={"adhesion": 1},
      typeB={"adhesion": 0.3}, knobs=BF)
    c("dah-nosense-100", "differential adhesion A 1 / B 0.3, field A not felt, 100 cells", genes={"adhesion": 1},
      typeB={"adhesion": 0.3}, knobs={"cells.params.senseOn": False}, query={"cells": 100})
    c("dah55-nosense-100", "differential adhesion A 1 / B 0.55 (B sticks to B a little), field A not felt, 100 cells",
      genes={"adhesion": 1}, typeB={"adhesion": 0.55}, knobs={"cells.params.senseOn": False}, query={"cells": 100})
    c("key7-adh1", "B's key turned 7 deg, adhesion 1 both", genes={"adhesion": 1}, typeB={"keyAngle": 0.47, "recAngle": 0.47})
    c("key7-adh1-nosense-100", "B's key turned 7 deg, adhesion 1 both, field A not felt, 100 cells", genes={"adhesion": 1},
      typeB={"keyAngle": 0.47, "recAngle": 0.47}, knobs={"cells.params.senseOn": False}, query={"cells": 100})
    c("key17-Bfate", "B's key turned 17 deg (no cross adhesion) + field B per fate (like attracts: everyone pulls everyone)",
      genes={"adhesion": 0.8}, typeB={"keyAngle": 0.65, "recAngle": 0.65}, knobs=BF)
    return out


def series_map():
    """Two-factor maps: adhesion gene x field A gain, and adhesion gene x motility gene."""
    S, out = "map", []
    for a in (0.4, 0.6, 0.8, 1.0):
        for g in (0, 5, 10, 20):
            k = {"cells.params.sense": g} if g else {"cells.params.senseOn": False}
            out.append(condition(f"tm-a{a:g}-s{g:g}", S, f"adhesion gene {a:g}, field A gain {g:g}", genes={"adhesion": a}, knobs=k))
    for a in (0.6, 0.8, 1.0, 1.2):
        for m in (0.5, 2, 3):
            out.append(condition(f"tm-a{a:g}-m{m:g}", S, f"adhesion gene {a:g}, motility gene {m:g}", genes={"adhesion": a, "motility": m}))
    return out


SERIES = {"pilot": series_pilot, "hold": series_hold, "chem": series_chem, "types": series_types, "pairs": series_pairs, "map": series_map}


def write(series_name, conds):
    d = os.path.join(OUT, series_name)
    os.makedirs(d, exist_ok=True)
    for c in conds:
        with open(os.path.join(d, c["name"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(c, f, indent=1, ensure_ascii=False)
    with open(os.path.join(d, "batch.json"), "w", encoding="utf-8") as f:
        json.dump({"batch": f"tissue-{series_name}", "runs": [c["name"] + ".json" for c in conds]}, f, indent=1)
    return len(conds)


if __name__ == "__main__":
    import sys
    want = sys.argv[1:] or list(SERIES)
    for s in want:
        print(s, write(s, SERIES[s]()))
