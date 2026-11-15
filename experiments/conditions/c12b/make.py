"""Step C12b: writes the conditions of experiments 2 to 4 (README "Step C12b: lipid membranes"); the lab's (experiment 1) come
from experiments/tissue/c12b.py. Run from the repository: python experiments/conditions/c12b/make.py

  default-on / default-off   the default scene, 20 simulated minutes, with the lipid membranes and with ?lipids=0
  heat-on / heat-off         the default scene (spotlight) plus lipid supply in the hot spot and at the cool far rim of the
                             colony: a soap and an oil spring in each, dripping 5 s of every 30 s; mutation on: do lineages in the
                             spot evolve oilier (stiffer) membranes than the ones at the cool rim? (never written as a rule)
  oxygen-on / oxygen-off     the oxygen retry's set-up (a never-drying light spring, a slow heavy spring: 2 s of every 20 s, the
                             default places), 20 min: free light atoms in the dish against bites on soap membranes, and whether
                             wall-building or oily lineages rise
Each samples every 20 or 30 s and asks moire.lipids.stats() (per founder lineage, lit and dark) every 5 minutes.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STATS = ("const s = await moire.lipids.stats(); return JSON.stringify({ all: s.all, lit: s.lit, dark: s.dark, "
         "founders: s.founders.slice(0, 8) })")


def stats_evals(duration, every=300):
    return [{"t": t, "js": STATS} for t in range(every, duration + 1, every)]


def shots(duration):
    out = []
    for t in (300, 600, duration):
        out.append({"t": t})
    out.append({"t": duration, "panel": True, "name": "panel"})
    out.append({"t": duration, "view": "lineage", "name": "lineage"})
    return out


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def main():
    files = []
    D = 1200
    for on in (True, False):
        q = {} if on else {"lipids": 0}
        tag = "on" if on else "off"
        files.append(write(f"default-{tag}", {
            "name": f"c12b-default-{tag}",
            "description": f"step C12b, experiment 2: the default scene, 20 min, lipid membranes {tag}",
            "query": q, "duration": D, "sample_every": 30,
            "evals": stats_evals(D), "shots": shots(D),
        }))
        # experiment 3: lipid supply in the hot spot and at the cool far rim, pulsed
        ev = [{"t": 0, "js": "const s = moire.light.spot(), v = moire.control.view(); window.__lip = [[s.x, s.y], [v.cssW - s.x, s.y]]; "
                             "return window.__lip"}]
        for t in range(0, D, 30):
            ev.append({"t": t, "js": "for (const [x, y] of window.__lip) { moire.matter.addSpring(x, y - 12, 'soap', 5); "
                                     "moire.matter.addSpring(x, y + 12, 'oil', 5); } return moire.matter.springs.length"})
        ev += stats_evals(D)
        files.append(write(f"heat-{tag}", {
            "name": f"c12b-heat-{tag}",
            "description": f"step C12b, experiment 3: the default scene with soap and oil dripped (5 s of every 30 s) in the hot spot and "
                           f"at the colony's cool far rim, 20 min, lipid membranes {tag}",
            "query": q, "duration": D, "sample_every": 30,
            "evals": sorted(ev, key=lambda e: e["t"]), "shots": shots(D),
        }))
        # experiment 4: the oxygen retry's springs (experiments/conditions/oxygen/o-spot.json), 20 min
        ev = [{"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); "
                             "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.map(s => s.kind + ' ' + s.life)"}]
        for t in range(20, D, 20):
            ev.append({"t": t, "js": "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"})
        ev += stats_evals(D)
        files.append(write(f"oxygen-{tag}", {
            "name": f"c12b-oxygen-{tag}",
            "description": f"step C12b, experiment 4: the oxygen retry's springs (a never-drying light spring, a heavy one 2 s of every "
                           f"20 s), spotlight, 20 min, lipid membranes {tag}",
            "query": q, "duration": D, "sample_every": 20,
            "evals": sorted(ev, key=lambda e: e["t"]), "shots": shots(D),
        }))
    with open(os.path.join(HERE, "batch-default.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-default", "runs": ["default-on.json", "default-off.json"], "seeds": [3, 7]}, fh, indent=1)
    with open(os.path.join(HERE, "batch-heat.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-heat", "runs": ["heat-on.json", "heat-off.json"], "seeds": [3]}, fh, indent=1)
    with open(os.path.join(HERE, "batch-oxygen.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-oxygen", "runs": ["oxygen-on.json", "oxygen-off.json"], "seeds": [3]}, fh, indent=1)
    print("wrote", files)


if __name__ == "__main__":
    main()
