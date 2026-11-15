"""Step C12c, excited waste: the oxygen conditions rerun with the excited waste on and off. Run from the repository:
    python experiments/conditions/c12c/make.py

From experiments/conditions/oxygen (the oxygen retry: a never-drying light spring at (875, 328), a slow heavy spring at (875, 472)
re-dropped for 2 s of every 20 s, 1280 x 800):
  spot-on / spot-off      the default spotlight, 50 min, ?excited=1 / ?excited=0          (batch-spot.json: seeds 3 and 7)
  full-on / full-off      the whole dish lit (?light=full), 50 min                         (batch-full.json: seeds 3 and 7)
  upswap-on / upswap-off  the spotlight with the uphill swaps in the open x15 (kUpSwap 0.3: more light-made waste), 40 min,
                          seed 3                                                           (batch-upswap.json)
Shots every 10 min (clean and strategy view) and close-ups of the light spring (the haze) at 20 min and at the end.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OX = os.path.join(HERE, "..", "oxygen")
CROP = [775, 238, 200, 180]   # around the light spring (875, 328), CSS px


def load(name):
    with open(os.path.join(OX, name), encoding="utf-8") as fh:
        return json.load(fh)


def shots(D):
    out = []
    for t in range(600, D + 1, 600):
        out += [{"t": t}, {"t": t, "view": "strategy"}]
    for t in (1200, D):
        out.append({"t": t, "crop": CROP, "scale": 3, "name": f"spring_t{t}"})
    out.append({"t": D, "panel": True, "name": "panel"})
    return out


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def main():
    for src, tag, D, extra in (("o-spot.json", "spot", 3000, None), ("o-full.json", "full", 3000, None),
                               ("o-spot-upswap.json", "upswap", 2400, None)):
        base = load(src)
        for on in (True, False):
            c = dict(base)
            q = dict(base.get("query", {}))
            q["excited"] = 1 if on else 0
            c["query"] = q
            c["name"] = f"c12c-{tag}-{'on' if on else 'off'}"
            c["description"] = (f"step C12c: the oxygen retry's {base['name']} ({base.get('description', '')}) with the excited waste "
                                f"{'on' if on else 'off'}, {D // 60} min")
            c["duration"] = D
            c["evals"] = [e for e in base.get("evals", []) if e["t"] < D]
            c["shots"] = shots(D)
            c["snapshots"] = [{"t": D, "grid": True}]
            c["sample_every"] = 20
            write(f"{tag}-{'on' if on else 'off'}", c)
    for tag, seeds in (("spot", [3, 7]), ("full", [3, 7]), ("upswap", None)):
        b = {"batch": f"c12c-{tag}", "runs": [f"{tag}-on.json", f"{tag}-off.json"]}
        if seeds:
            b["seeds"] = seeds
        with open(os.path.join(HERE, f"batch-{tag}.json"), "w", encoding="utf-8") as fh:
            json.dump(b, fh, indent=1)


if __name__ == "__main__":
    main()
