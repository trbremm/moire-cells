"""Step C12f, vents in the dark: the experiments' conditions. Run from the repository: python experiments/conditions/c12f/make.py

  dark           the Deep vents preset in total darkness (?preset=vent), 40 min, seeds 3 and 7 (batch-dark.json)
  dark-nomemb    the same with ?membrane=0 (no membrane chemistry: a cell holds its full capacity), seed 3: the control for the
                 bottleneck found in the pilots (batch-controls.json, with the next three)
  dim            the Deep vents preset with its faint light (&light=full: a third of the usual power), seed 3, 40 min
  default        the default scene (its vent is now hot; no sea), seed 3, 20 min
  oldvent        the Deep vents preset with ?hotvent=0&sea=0 (the C12d vent, no heat, no sea), seed 3, 10 min
  harmonic       the dark preset, seed 3, 10 min, ?look=harmonic (pictures)
  check          the books (see check.json)
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def run(name, desc, q, D=2400, look=None):
    snaps = [{"t": t, "grid": True} for t in (60, 120, 300, 600, 1200, 1800, 2400) if t <= D]
    shots = [{"t": t} for t in (120, 600, 1200, 2400) if t <= D]
    shots += [{"t": D, "panel": True, "name": "panel"}, {"t": D, "view": "strategy", "name": "strategy"}]
    shots += [{"t": t, "crop": c, "scale": 3, "name": f"close{k}_t{t}"} for t in (600, D) for k, c in enumerate([[540, 110, 200, 150], [1020, 40, 200, 150]])]
    return write(name, {"name": f"c12f-{name}", "description": desc, "query": q, "duration": D, "sample_every": 10,
                        "snapshots": snaps, "shots": shots})


def main():
    run("dark", "step C12f: the Deep vents preset in total darkness, 40 min", {"preset": "vent"})
    write("batch-dark", {"batch": "c12f-dark", "runs": ["dark.json"], "seeds": [3, 7]})
    run("dark-nomemb", "step C12f: the Deep vents preset in darkness, membrane chemistry off (?membrane=0), 40 min", {"preset": "vent", "membrane": 0, "seed": 3})
    run("dim", "step C12f: the Deep vents preset with its faint light (&light=full, a third of the power), 40 min", {"preset": "vent", "light": "full", "seed": 3})
    run("default", "step C12f: the default scene with a HOT vent (?hotvent=1; no sea), 20 min", {"seed": 3, "hotvent": 1}, D=1200)
    run("oldvent", "step C12f: the Deep vents preset with the C12d vent and no sea (?hotvent=0&sea=0), 10 min", {"preset": "vent", "hotvent": 0, "sea": 0, "seed": 3}, D=600)
    run("harmonic", "step C12f: the Deep vents preset in darkness, harmonic look, 10 min (pictures)", {"preset": "vent", "look": "harmonic", "seed": 3}, D=600)
    d = json.load(open(os.path.join(HERE, "default.json"))); d.update(name="c12f-default-oldvent", description="step C12f: the default scene with the C12d vent (?hotvent=0), 20 min: the comparison (the default since this run)"); d["query"]["hotvent"] = 0; write("default-oldvent", d)
    write("batch-controls", {"batch": "c12f-controls", "runs": ["dark-nomemb.json", "dim.json", "default.json", "oldvent.json", "harmonic.json"]})


if __name__ == "__main__":
    main()
