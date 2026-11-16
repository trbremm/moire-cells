"""Step C12g, membranes modulate ion flow: the experiments' conditions. Run from the repository:
    python experiments/conditions/c12g/make.py

  oxy-spot / oxy-full        the C12d/C12e OXYGEN STORY (no spring of free atoms: a never-drying mineral spring at (875, 328), a slow
                             vent at (875, 472) re-dropped for 2 s of every 20 s), 40 min, the spotlight and the whole dish lit, with
                             the bilayer blocking ions and the channel genes on              (batch-oxygen.json: seeds 3 and 7)
  oxy-spot-np / oxy-full-np  the same with ?photolysis=0: light cannot free atoms in the open, any free t is made by life
                                                                                             (batch-nophoto.json: seeds 3 and 7)
  oxy-full-null              the whole dish, ?channels=0: the block on, every cell's channels at the base level, the channel genes
                             drifting without effect: the NEUTRAL control for them        (batch-control.json: seeds 3 and 7)
  oxy-full-noblock           the whole dish, ?ionblock=0: ions pass the bilayer as before (the same page's baseline), seed 3
  NOTE (step C12g, charge field off by default): runs named *-qfield have the dish-wide charge field and the dipoles back ON
                             (?chargefield=1&dipoles=1). The first dark runs (c12g-dark_s3/_s7, dark-null, pilot) were made before the charge
                             field went off: they were renamed c12g-dark-qfield_s3/_s7, c12g-dark-null-qfield, c12g-pilot-qfield (same code
                             otherwise, so they are the dark comparison with the field on).
  oxy-spot-qfield            oxy-spot seed 3 with the charge field and dipoles back on
  default-qfield             the default scene with the charge field and dipoles back on (batch-default.json with default)
  dark-soap / -null          the dark dish plus a soap spring in each vent's cold ring (membranes can be whole), channel genes on / off
  dark                       the C12f Deep vents preset in total darkness (?preset=vent), 40 min (batch-dark.json: seeds 3 and 7)
  dark-null                  the same with ?channels=0, seed 3                              (batch-darkctl.json, with dark-volt)
  dark-volt                  the same with ?ionvolt=1 (ions through channels feel the membrane voltage), seed 3
  default                    the default scene, seed 3, 20 min (did anything break? against c12f-default-oldvent)
  pilot                      oxy-full seed 3, 10 min (a first look)
  check                      the books: 420 s at MAX, N, wash, resizes, G, every new switch and knob at runtime, the add-cell tool,
                             a snapshot saved and loaded
  reload-c12f                a C12f snapshot (dark_s3 at 2 min) loaded on this page (the block and the channel genes then off)
  speed-2k-on/-off, speed-10k-on/-off  the speed reached at MAX (off: ?ionblock=0)
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


def oxy(name, desc, q, D=2400):
    shots = []
    for t in range(600, D + 1, 600):
        shots += [{"t": t}, {"t": t, "view": "strategy"}]
    shots += [{"t": t, "crop": CROP_SPRINGS, "scale": 3, "name": f"springs_t{t}"} for t in (600, 1200, D) if t <= D]
    shots += [{"t": D, "crop": [540, 300, 200, 200], "scale": 4, "name": "close"}]
    shots.append({"t": D, "panel": True, "name": "panel"})
    snaps = [{"t": t, "grid": True} for t in (600, 1200, D) if t <= D]
    return write(name, {"name": f"c12g-{name}", "description": desc, "query": {"electrons": 1, **q},
                        "duration": D, "sample_every": 20,
                        "evals": [{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, D, 20)],
                        "shots": shots, "snapshots": snaps})


def dark(name, desc, q, D=2400):
    snaps = [{"t": t, "grid": True} for t in (60, 120, 300, 600, 1200, 1800, 2400) if t <= D]
    shots = [{"t": t} for t in (120, 600, 1200, 2400) if t <= D]
    shots += [{"t": D, "panel": True, "name": "panel"}, {"t": D, "view": "strategy", "name": "strategy"}]
    shots += [{"t": t, "crop": c, "scale": 3, "name": f"close{k}_t{t}"} for t in (600, D) for k, c in enumerate([[540, 110, 200, 150], [1020, 40, 200, 150]])]
    return write(name, {"name": f"c12g-{name}", "description": desc, "query": {"preset": "vent", **q}, "duration": D, "sample_every": 10,
                        "snapshots": snaps, "shots": shots})


def main():
    base = ("the C12d oxygen story (no spring of free atoms: a never-drying mineral spring at (875, 328), a slow vent at (875, 472), "
            "2 s of every 20 s)")
    for tag, q in (("spot", {}), ("full", {"light": "full"})):
        lit = "the whole dish lit" if tag == "full" else "the spotlight"
        oxy(f"oxy-{tag}", f"step C12g: {base}, {lit}, 40 min, the bilayer blocks ions, channel genes on", q)
        oxy(f"oxy-{tag}-np", f"step C12g: {base}, {lit}, 40 min, the bilayer blocks ions, ?photolysis=0", {**q, "photolysis": 0})
    write("batch-oxygen", {"batch": "c12g-oxygen", "runs": ["oxy-spot.json", "oxy-full.json"], "seeds": [3, 7]})
    write("batch-nophoto", {"batch": "c12g-nophoto", "runs": ["oxy-spot-np.json", "oxy-full-np.json"], "seeds": [3, 7]})
    oxy("oxy-full-null", f"step C12g neutral control: {base}, the whole dish lit, 40 min, ?channels=0 (channel genes drift without effect)",
        {"light": "full", "channels": 0})
    oxy("oxy-full-noblock", f"step C12g baseline: {base}, the whole dish lit, 40 min, ?ionblock=0 (ions pass as before)",
        {"light": "full", "ionblock": 0, "seed": 3})
    write("batch-control", {"batch": "c12g-control", "runs": ["oxy-full-null.json"], "seeds": [3, 7]})
    # step C12g, charge field off by default: the comparisons with the dish-wide charge field back ON (as before C12g: ?chargefield=1, and
    # the dipoles ?dipoles=1), so the charge change alone can be told from the ion-flow change
    QF = {"chargefield": 1, "dipoles": 1}
    oxy("oxy-spot-null", f"step C12g neutral control: {base}, the spotlight, 40 min, ?channels=0 (channel genes drift without effect)",
        {"channels": 0, "seed": 3})
    oxy("oxy-spot-qfield", f"step C12g comparison: {base}, the spotlight, 40 min, the charge field and dipoles back ON (?chargefield=1&dipoles=1)",
        {**QF, "seed": 3})
    oxy("pilot", f"step C12g pilot: {base}, the whole dish lit, 10 min, seed 3", {"light": "full", "seed": 3}, D=600)
    dark("dark", "step C12g: the Deep vents preset in total darkness, 40 min, the bilayer blocks ions", {})
    write("batch-dark", {"batch": "c12g-dark", "runs": ["dark.json"], "seeds": [3, 7]})
    dark("dark-null", "step C12g: the Deep vents preset in darkness, ?channels=0 (neutral control), 40 min", {"channels": 0, "seed": 3})
    dark("dark-volt", "step C12g: the Deep vents preset in darkness, ?ionvolt=1 (ions feel the membrane voltage), 40 min", {"ionvolt": 1, "seed": 3})
    write("batch-darkctl", {"batch": "c12g-darkctl", "runs": ["dark-null.json", "dark-volt.json"]})
    # a test of the mechanism where membranes can be whole: the dark dish plus a never-drying SOAP spring in each vent's cold ring
    # (15 R out, on the side away from the dish's centre), so cells can fuse a bilayer; with the channel genes on and off
    soap = ("const v = moire.control.view(), R = moire.cells.R, m = Math.min(v.cssW, v.cssH); for (let k = 0; k < 3; k++) {"
            " const a = (-90 + 120 * k) * Math.PI / 180, cx = v.cssW / 2 + Math.cos(a) * (0.27 * m + 15 * R), cy = v.cssH / 2 + Math.sin(a) * (0.27 * m + 15 * R);"
            " moire.matter.addSpring(cx, cy, 'soap', 1e9); } return moire.matter.springs.map(s => s.kind)")
    for nm, q, d in (("dark-soap", {"seed": 3}, "channel genes on"), ("dark-soap-null", {"seed": 3, "channels": 0}, "?channels=0")):
        dark(nm, f"step C12g: the Deep vents preset in darkness plus a never-drying soap spring in each vent's cold ring (15 R out), {d}, 40 min", q)
        c = json.load(open(os.path.join(HERE, f"{nm}.json")))
        c["evals"] = [{"t": 0, "js": soap}]
        write(nm, c)
    write("batch-darksoap", {"batch": "c12g-darksoap", "runs": ["dark-soap.json", "dark-soap-null.json"]})
    d = json.load(open(os.path.join(HERE, "..", "c12f", "default-oldvent.json")))
    d.update(name="c12g-default", description="step C12g: the default scene (C12d vent), seed 3, 20 min, the bilayer blocks ions: did anything break? (against c12f-default-oldvent)")
    d["query"].pop("hotvent", None)
    write("default", d)
    d2 = dict(d, name="c12g-default-qfield", description="step C12g comparison: the default scene, seed 3, 20 min, the charge field and dipoles back ON (?chargefield=1&dipoles=1)")
    d2["query"] = {**d["query"], **QF}
    write("default-qfield", d2)
    write("batch-default", {"batch": "c12g-default", "runs": ["default.json", "default-qfield.json"]})
    # the books
    I = "moire.ions.params"
    write("check", {
        "name": "c12g-check",
        "description": "Step C12g books check: 420 s at MAX (seed 5), the whole dish lit, mineral, vent, soap, linker and ion springs, N (60 s), 40 cells placed with the add-cell tool (80 s), a wash (100 s), a resize (150 s), G (200 s), a resize back (220 s), every C12g switch and knob off and on at runtime (250 to 350 s), membranes and lipids off and on, a snapshot saved and loaded at once (380 s); atoms and charge rounding must stay 0",
        "query": {"seed": 5, "light": "full"},
        "duration": 420, "sample_every": 10,
        "resizes": [{"t": 150, "size": "1000x700"}, {"t": 220, "size": "1280x800"}],
        "evals": [
            {"t": 5, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.35, 'soap', 120); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.5, 'linker', 120); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.3, 'ions', 120); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'light', 1e9); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 1e9); return moire.matter.springs.length"},
            {"t": 60, "js": "return moire.control.action('culture')"},
            {"t": 80, "js": "return await moire.app.place(Array.from({length: 40}, (_, k) => [150 + 13 * k, 120]), moire.genome.founders[0])"},
            {"t": 100, "js": "return moire.control.action('wash')"},
            {"t": 105, "js": "const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.4, 'light', 1e9); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 200); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.4, 'ions', 200); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'soap', 200); return 1"},
            {"t": 200, "js": "return moire.control.action('genomes')"},
            {"t": 250, "js": f"{I}.block = false; return 'block off'"},
            {"t": 260, "js": f"{I}.block = true; {I}.genes = false; return 'block on, channel genes off'"},
            {"t": 270, "js": f"{I}.genes = true; {I}.volt = true; {I}.kV = 20; return 'voltage push on, strong'"},
            {"t": 280, "js": f"{I}.ionPass = 0; {I}.chanBase = 0.01; moire.pumps.params.vCap = 0.01; return 'ions nearly shut, small capacitance'"},
            {"t": 300, "js": f"{I}.ionPass = 1; {I}.chanBase = 1; return 'ions wide open'"},
            {"t": 310, "js": f"{I}.ionPass = 0.05; {I}.chanBase = 0.2; {I}.kV = 4; {I}.volt = false; moire.pumps.params.vCap = 0.1; return 'knobs back'"},
            {"t": 320, "js": "moire.membrane.params.on = false; return 'membrane chemistry off'"},
            {"t": 330, "js": "moire.membrane.params.on = true; moire.lipids.params.on = false; return 'lipids off (C6c weave blocks by integrity)'"},
            {"t": 340, "js": "moire.lipids.params.on = true; moire.membrane.params.select = false; return 'all on, selectivity gene off'"},
            {"t": 350, "js": "moire.membrane.params.select = true; return 'selectivity on'"},
            {"t": 380, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return { exact: r.exact, notes: r.notes, rounding: r.rounding }"},
        ],
        "shots": [{"t": 120}, {"t": 290}, {"t": 420, "panel": True, "name": "panel"}],
        "stall": 120,
    })
    write("reload-c12f", {
        "name": "c12g-reload-c12f",
        "description": "a C12f snapshot (dark_s3 at 2 min) loaded by ?snap= on the C12g page: the bilayer then passes ions as before, channel genes off",
        "query": {"snap": "experiments/runs/c12f-dark_s3/snapshots/snap_t120.json"},
        "duration": 60, "sample_every": 10,
        "evals": [{"t": 120, "js": "return { block: moire.ions.params.block, genes: moire.ions.params.genes }"}],
        "shots": [{"t": 180}],
    })
    for on in (True, False):
        tag = "on" if on else "off"
        off = {} if on else {"ionblock": 0}
        write(f"speed-2k-{tag}", {"name": f"c12g-speed-2k-{tag}", "description": f"Speed: the default scene, 2000 cells, seed 3, MAX, 150 s, C12g block {tag}",
                                   "query": {"seed": 3, **off}, "duration": 150, "sample_every": 10})
        write(f"speed-10k-{tag}", {"name": f"c12g-speed-10k-{tag}", "description": f"Speed: the default scene, 10 000 cells, seed 3, MAX, 60 s, C12g block {tag}",
                                    "query": {"seed": 3, "cells": 10000, **off}, "duration": 60, "sample_every": 5})


if __name__ == "__main__":
    main()
