"""Step C12d, electrons: the experiments' conditions. Run from the repository:
    python experiments/conditions/c12d/make.py

  substrate          the substrate alone: one cell, the whole dish lit, a never-drying MINERAL spring (gt + linkers) and a
                     never-drying VENT (gT, GT, free G, trace) side by side, 6 min: what forms, what glows, where free t appears
  default-on / -off  the default scene (the spotlight, a mineral spring and a vent beside the culture), 20 min, electrons on and
                     off (?electrons=0: the old table)                       (batch-default.json: seeds 3 and 7)
  oxy-spot / oxy-full the OXYGEN STORY with no spring of free atoms: a never-drying mineral spring at (875, 328) and a slow vent
                     at (875, 472) re-dropped for 2 s of every 20 s (as the oxygen retry's slow heavy spring), 40 min, the
                     spotlight and the whole dish lit                         (batch-oxygen.json: seeds 3 and 7)
  check              the books: 420 s at MAX, N, wash, resizes, G, every new switch at runtime, a snapshot saved and loaded
  speed-2k-on/-off, speed-10k-on/-off  the speed reached at MAX
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CROP_SPRINGS = [775, 238, 200, 300]   # around the mineral spring (875, 328) and the vent (875, 472), CSS px


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def oxy_evals(D):
    ev = [{"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.map(s => s.kind + ' ' + s.life)"}]
    for t in range(20, D, 20):
        ev.append({"t": t, "js": "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"})
    return ev


def main():
    # 1. the substrate alone
    write("substrate", {
        "name": "c12d-substrate",
        "description": "step C12d: the substrate alone (one cell), the whole dish lit, a never-drying mineral spring (left) and vent (right), 6 min",
        "query": {"seed": 3, "cells": 1, "light": "full", "springs": 0},
        "dpr": 2, "duration": 360, "sample_every": 10,
        "evals": [{"t": 0, "js": "const v = moire.control.view(); moire.matter.clearSprings(); moire.matter.addSpring(v.cssW * 0.42, v.cssH * 0.5, 'light', 1e9); moire.matter.addSpring(v.cssW * 0.58, v.cssH * 0.5, 'heavy', 1e9); return moire.matter.springs.map(s => s.kind)"}],
        "shots": [{"t": 60}, {"t": 180}, {"t": 360}, {"t": 360, "panel": True, "name": "panel"},
                  {"t": 180, "crop": [430, 280, 420, 240], "scale": 3, "name": "springs_t180"},
                  {"t": 360, "crop": [430, 280, 420, 240], "scale": 3, "name": "springs_t360"}],
    })
    # 2. the default scene, electrons on and off
    for on in (True, False):
        tag = "on" if on else "off"
        write(f"default-{tag}", {
            "name": f"c12d-default-{tag}",
            "description": f"step C12d: the default scene, 20 min, electrons {tag}",
            "query": {"electrons": 1 if on else 0},
            "duration": 1200, "sample_every": 20,
            "shots": [{"t": 300}, {"t": 600}, {"t": 600, "view": "strategy"}, {"t": 1200}, {"t": 1200, "view": "strategy"},
                      {"t": 1200, "panel": True, "name": "panel"}],
        })
    write("batch-default", {"batch": "c12d-default", "runs": ["default-on.json", "default-off.json"], "seeds": [3, 7]})
    # 3. the oxygen story
    D = 2400
    for tag, q in (("spot", {}), ("full", {"light": "full"})):
        shots = []
        for t in range(600, D + 1, 600):
            shots += [{"t": t}, {"t": t, "view": "strategy"}]
        shots += [{"t": t, "crop": CROP_SPRINGS, "scale": 3, "name": f"springs_t{t}"} for t in (600, 1200, D)]
        shots.append({"t": D, "panel": True, "name": "panel"})
        write(f"oxy-{tag}", {
            "name": f"c12d-oxy-{tag}",
            "description": f"step C12d: the oxygen story with no spring of free atoms: a never-drying mineral spring at (875, 328), a slow vent at (875, 472) (2 s of every 20 s), {'the whole dish lit' if tag == 'full' else 'the spotlight'}, 40 min",
            "query": {"electrons": 1, **q},
            "duration": D, "sample_every": 20, "evals": oxy_evals(D), "shots": shots,
            "snapshots": [{"t": D, "grid": True}],
        })
    write("batch-oxygen", {"batch": "c12d-oxygen", "runs": ["oxy-spot.json", "oxy-full.json"], "seeds": [3, 7]})
    # 4. the books
    write("check", {
        "name": "c12d-check",
        "description": "Step C12d books check: 420 s at MAX (seed 5), the whole dish lit, the default springs plus springs of every kind, N (60 s), a wash (100 s), a resize (150 s), G (200 s), a resize back (220 s), new springs (240 s), the electrons' switches and knobs (fluorescence, photochemistry, the glow, the depth and shares), lipids, membranes, engines and the chemistry off and on at runtime (250 to 350 s), a snapshot saved and loaded at once (380 s); atoms and charge rounding must stay 0",
        "query": {"seed": 5, "light": "full"},
        "duration": 420, "sample_every": 10,
        "resizes": [{"t": 150, "size": "1000x700"}, {"t": 220, "size": "1280x800"}],
        "evals": [
            {"t": 5, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.35, 'soap', 120); moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.65, 'oil', 120); moire.matter.addSpring(v.cssW * 0.7, v.cssH * 0.65, 'emulsion', 120); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.5, 'linker', 120); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.3, 'ions', 120); return moire.matter.springs.length"},
            {"t": 60, "js": "return moire.control.action('culture')"},
            {"t": 100, "js": "return moire.control.action('wash')"},
            {"t": 105, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.4, 'light', 200); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 200); return 1"},
            {"t": 200, "js": "return moire.control.action('genomes')"},
            {"t": 240, "js": "{ const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.5, 'light'); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.5, 'heavy'); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.3, 'emulsion'); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.7, 'soap'); } return moire.matter.springs.length"},
            {"t": 250, "js": "moire.electrons.params.fluor = false; return 'fluorescence off'"},
            {"t": 260, "js": "moire.electrons.params.fluor = true; moire.electrons.params.photo = false; moire.electrons.look.on = false; return 'photochemistry off, glow not drawn'"},
            {"t": 270, "js": "moire.electrons.params.photo = true; moire.electrons.look.on = true; moire.electrons.params.kAbs = 5; moire.electrons.params.yRx = 0.9; moire.electrons.params.yFl = 0.9; return 'depth 5, shares 0.9'"},
            {"t": 285, "js": "moire.electrons.params.kAbs = 1; moire.electrons.params.yRx = 0.5; moire.electrons.params.yFl = 0.4; moire.lipids.params.graze = false; return 'knobs back, graze off'"},
            {"t": 295, "js": "moire.lipids.params.graze = true; moire.lipids.params.on = false; return 'lipids off'"},
            {"t": 305, "js": "moire.lipids.params.on = true; moire.membrane.params.on = false; return 'membrane chemistry off'"},
            {"t": 315, "js": "moire.membrane.params.on = true; moire.eat.params.engines = false; moire.eat.params.burner = true; return 'engines off, everyone burns (not available with electrons)'"},
            {"t": 325, "js": "moire.eat.params.engines = true; moire.eat.params.burner = false; moire.matter.chem.on = false; return 'chemistry off'"},
            {"t": 335, "js": "moire.matter.chem.on = true; moire.light.params.mode = 'spot'; return 'all on, spotlight'"},
            {"t": 345, "js": "moire.light.params.mode = 'full'; return 'whole dish'"},
            {"t": 380, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return { exact: r.exact, notes: r.notes, rounding: r.rounding, electrons: S.electrons }"},
        ],
        "shots": [{"t": 120}, {"t": 420, "panel": True, "name": "panel"}],
        "stall": 120,
    })
    # 5. speed
    for on in (True, False):
        tag = "on" if on else "off"
        write(f"speed-2k-{tag}", {"name": f"c12d-speed-2k-{tag}", "description": f"Speed: the default scene, 2000 cells, seed 3, MAX, 150 s, electrons {tag}",
                                   "query": {"seed": 3, "electrons": 1 if on else 0}, "duration": 150, "sample_every": 10})
        write(f"speed-10k-{tag}", {"name": f"c12d-speed-10k-{tag}", "description": f"Speed: the default scene, 10 000 cells, seed 3, MAX, 60 s, electrons {tag}",
                                    "query": {"seed": 3, "cells": 10000, "electrons": 1 if on else 0}, "duration": 60, "sample_every": 5})
    # 6. old snapshots: the C11 lab configuration by ?snap= (the page reloads itself with ?electrons=0) and by the console
    write("reload-old", {
        "name": "c12d-reload-old",
        "description": "a stored configuration from before C12d (c11-pol-lb-t1-100) opened by ?snap= on an electrons page: the page reloads itself with ?electrons=0 and runs it as saved",
        "query": {"snap": "experiments/tissue/configs/c11-pol-lb-t1-100/snapshot.json"},
        "duration": 40, "sample_every": 10, "tissue": True,
        "evals": [{"t": 0, "js": "return { url: location.search, electrons: moire.electrons.on, excited: moire.excited.params.on }"}],
        "shots": [{"t": 40}],
    })


if __name__ == "__main__":
    main()
