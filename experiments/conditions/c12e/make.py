"""Step C12e, waste must leave: the experiments' conditions. Run from the repository:
    python experiments/conditions/c12e/make.py

  oxy-spot / oxy-full        the C12d OXYGEN STORY (no spring of free atoms: a never-drying mineral spring at (875, 328), a slow
                             vent at (875, 472) re-dropped for 2 s of every 20 s), 40 min, the spotlight and the whole dish lit,
                             with saturation and osmosis on                                 (batch-oxygen.json: seeds 3 and 7)
  oxy-spot-np / oxy-full-np  the same with ?photolysis=0: light cannot free atoms in the open, any free t is made by life
                                                                                             (batch-nophoto.json: seeds 3 and 7)
  sat-only                   the whole dish, seed 3, saturation on, osmosis OFF (the stretch genes drift unused: the NEUTRAL
                             control for them)
  osm-only                   the whole dish, seed 3, osmosis on, saturation OFF            (batch-single.json)
  pilot                      oxy-full seed 3 for 10 min (a first look)
  check                      the books: 420 s at MAX, N, wash, resizes, G, every new switch at runtime, a snapshot saved and loaded
  reload-c12d                a C12d snapshot (oxy-spot_s7 at 40 min) loaded on this page (saturation and osmosis then off)
  speed-2k-on/-off, speed-10k-on/-off  the speed reached at MAX (off: ?saturation=0&osmosis=0)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CROP_SPRINGS = [775, 238, 200, 300]
VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"
START = ("moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); moire.matter.addSpring(875, 472, 'heavy', 2.0);"
         " return moire.matter.springs.map(s => s.kind + ' ' + s.life)")


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def oxy_evals(D):
    return [{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, D, 20)]


def oxy(name, desc, q, D=2400):
    shots = []
    for t in range(600, D + 1, 600):
        shots += [{"t": t}, {"t": t, "view": "strategy"}]
    shots += [{"t": t, "crop": CROP_SPRINGS, "scale": 3, "name": f"springs_t{t}"} for t in (600, 1200, D) if t <= D]
    shots += [{"t": D, "crop": [540, 300, 200, 200], "scale": 4, "name": "close"}]
    shots.append({"t": D, "panel": True, "name": "panel"})
    return write(name, {"name": f"c12e-{name}", "description": desc, "query": {"electrons": 1, **q},
                        "duration": D, "sample_every": 20, "evals": oxy_evals(D), "shots": shots,
                        "snapshots": [{"t": D, "grid": True}]})


def main():
    base = ("the C12d oxygen story (no spring of free atoms: a never-drying mineral spring at (875, 328), a slow vent at (875, 472), "
            "2 s of every 20 s)")
    for tag, q in (("spot", {}), ("full", {"light": "full"})):
        lit = "the whole dish lit" if tag == "full" else "the spotlight"
        oxy(f"oxy-{tag}", f"step C12e: {base}, {lit}, 40 min, saturation and osmosis on", q)
        oxy(f"oxy-{tag}-np", f"step C12e: {base}, {lit}, 40 min, saturation and osmosis on, ?photolysis=0", {**q, "photolysis": 0})
    write("batch-oxygen", {"batch": "c12e-oxygen", "runs": ["oxy-spot.json", "oxy-full.json"], "seeds": [3, 7]})
    write("batch-nophoto", {"batch": "c12e-nophoto", "runs": ["oxy-spot-np.json", "oxy-full-np.json"], "seeds": [3, 7]})
    oxy("sat-only", f"step C12e: {base}, the whole dish lit, 40 min, saturation only (?osmosis=0: the stretch genes drift unused, the neutral control)",
        {"light": "full", "osmosis": 0, "seed": 3})
    oxy("osm-only", f"step C12e: {base}, the whole dish lit, 40 min, osmosis only (?saturation=0)", {"light": "full", "saturation": 0, "seed": 3})
    write("batch-single", {"batch": "c12e-single", "runs": ["sat-only.json", "osm-only.json"]})
    oxy("pilot", f"step C12e pilot: {base}, the whole dish lit, 10 min, seed 3", {"light": "full", "seed": 3}, D=600)
    # the books
    W = "moire.waste.params"
    write("check", {
        "name": "c12e-check",
        "description": "Step C12e books check: 420 s at MAX (seed 5), the whole dish lit, a mineral spring and a vent plus other springs, N (60 s), a wash (100 s), a resize (150 s), G (200 s), a resize back (220 s), every C12e switch and knob off and on at runtime (250 to 350 s), a snapshot saved and loaded at once (380 s); atoms and charge rounding must stay 0",
        "query": {"seed": 5, "light": "full"},
        "duration": 420, "sample_every": 10,
        "resizes": [{"t": 150, "size": "1000x700"}, {"t": 220, "size": "1280x800"}],
        "evals": [
            {"t": 5, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.35, 'soap', 120); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.5, 'linker', 120); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.3, 'ions', 120); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'light', 1e9); return moire.matter.springs.length"},
            {"t": 60, "js": "return moire.control.action('culture')"},
            {"t": 100, "js": "return moire.control.action('wash')"},
            {"t": 105, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.4, 'light', 200); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 200); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.4, 'ions', 200); return 1"},
            {"t": 200, "js": "return moire.control.action('genomes')"},
            {"t": 240, "js": "{ const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.5, 'light'); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.5, 'heavy'); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.3, 'ions'); } return moire.matter.springs.length"},
            {"t": 250, "js": f"{W}.saturation = false; return 'saturation off'"},
            {"t": 260, "js": f"{W}.saturation = true; {W}.osmosis = false; return 'osmosis off'"},
            {"t": 270, "js": f"{W}.osmosis = true; {W}.stretch = false; {W}.tear = false; {W}.cost = false; return 'stretch, tear, cost off'"},
            {"t": 280, "js": f"{W}.stretch = true; {W}.tear = true; {W}.cost = true; {W}.kOsm = 80; {W}.wTol = 0.1; {W}.satScale = 5; return 'strong swelling, low tolerance, strong saturation'"},
            {"t": 300, "js": f"{W}.kOsm = 10; {W}.wTol = 0.5; {W}.satScale = 1; moire.electrons.params.photolysis = false; return 'knobs back, photolysis off'"},
            {"t": 320, "js": "moire.electrons.params.photolysis = true; moire.membrane.params.on = false; return 'photolysis on, membrane chemistry off'"},
            {"t": 330, "js": "moire.membrane.params.on = true; moire.lipids.params.on = false; return 'lipids off'"},
            {"t": 340, "js": "moire.lipids.params.on = true; moire.light.params.mode = 'spot'; return 'all on, spotlight'"},
            {"t": 350, "js": "moire.light.params.mode = 'full'; return 'whole dish'"},
            {"t": 380, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return { exact: r.exact, notes: r.notes, rounding: r.rounding }"},
        ],
        "shots": [{"t": 120}, {"t": 290}, {"t": 420, "panel": True, "name": "panel"}],
        "stall": 120,
    })
    write("reload-c12d", {
        "name": "c12e-reload-c12d",
        "description": "a C12d snapshot (oxy-spot_s7 at 40 min, cells of 84 words) loaded by ?snap= on the C12e page: it widens and runs with saturation and osmosis off",
        "query": {"snap": "experiments/runs/c12d-oxy-spot_s7/snapshots/snap_t2400.json"},
        "duration": 60, "sample_every": 10,
        "evals": [{"t": 2400, "js": "return { sat: moire.waste.params.saturation, osm: moire.waste.params.osmosis }"}],
        "shots": [{"t": 2460}],
    })
    for on in (True, False):
        tag = "on" if on else "off"
        off = {} if on else {"saturation": 0, "osmosis": 0}
        write(f"speed-2k-{tag}", {"name": f"c12e-speed-2k-{tag}", "description": f"Speed: the default scene, 2000 cells, seed 3, MAX, 150 s, C12e {tag}",
                                   "query": {"seed": 3, **off}, "duration": 150, "sample_every": 10})
        write(f"speed-10k-{tag}", {"name": f"c12e-speed-10k-{tag}", "description": f"Speed: the default scene, 10 000 cells, seed 3, MAX, 60 s, C12e {tag}",
                                    "query": {"seed": 3, "cells": 10000, **off}, "duration": 60, "sample_every": 5})


if __name__ == "__main__":
    main()
