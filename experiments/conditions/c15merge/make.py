"""Carbon on by default: the toy's worlds with carbon (README "Carbon on by default, and the toy worlds").

make.py holds the probe (live cells and the books) and run(); the condition files in this folder were written from it:
  worlds-w-on.json / worlds-w-off.json   the first tour (the U1 light + burn founders; only the maze ran: c15m-w-maze-s7)
  smoke.json, rchk*.json                 the merge smoke and the energy-rounding hunt (the first world seeded before any frame)
  c15m-lv-*.json                         maze levers at 2 min: ?carbon=0, more sugar, methane seeps, trace springs
  c15m-lv2-*.json, c15m-lv3-*.json       founder habits (burn, usual spread, photosynthesisers) at 4 min: maze, caves, rings
  c15m-f-*.json (queue-f.txt, queue-g)   every world with the toy's photosynthesising founders, the open dish, ?carbon=0 checks
  c15m-tool-cells.json                   the cells tool's tap with carbon
The table: table.py here.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ["maze", "thicket", "caves", "delta", "forest", "hive", "rings", "spiral", "islands", "sieve"]
PROBE = ("const L = moire.carbon && moire.carbon.ledger, H = moire.heat.ledger; "
         "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, job: moire.cells.stats && moire.cells.stats.job, "
         "cRound: L && L.rounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding})")
PROBES = [1, 60, 120, 180, 240]


def run(name, desc, query, dur=240):
    return {"name": name, "description": desc, "query": query, "duration": dur, "sample_every": 30, "stall": 300,
            "shots": [{"t": 1, "name": "t1"}, {"t": dur, "name": f"t{dur}"}], "snapshots": [],
            "evals": [{"t": t, "js": PROBE} for t in PROBES if t <= dur]}


def worlds(seed, tag, carbon_off=True, kinds=KINDS, extra=None):
    runs = []
    for k in kinds:
        q = {"terrain": k, "seed": seed, **(extra or {})}
        runs.append(run(f"c15m-{tag}-{k}-s{seed}", f"{k} seed {seed}, carbon on, 4 min", q))
        if carbon_off:
            runs.append(run(f"c15m-{tag}-{k}-s{seed}-off", f"{k} seed {seed}, ?carbon=0, 4 min", {**q, "carbon": 0}))
    return runs


def dump(obj, fname):
    with open(os.path.join(HERE, fname), "w") as f:
        json.dump(obj, f, indent=1)


if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "w"
    runs = worlds(7, tag)
    runs.append(run(f"c15m-{tag}-open-s7", "the open dish, seed 7, carbon on, 4 min", {"seed": 7}))
    runs.append(run(f"c15m-{tag}-open-s7-off", "the open dish, seed 7, ?carbon=0, 4 min", {"seed": 7, "carbon": 0}))
    on = [r for r in runs if not r["name"].endswith("-off")]
    dump({"batch": f"c15m-{tag}-on", "runs": on}, f"worlds-{tag}-on.json")
    dump({"batch": f"c15m-{tag}-off", "runs": [r for r in runs if r["name"].endswith("-off")]}, f"worlds-{tag}-off.json")
    dump({"batch": "c15m-smoke", "runs": [run("c15m-smoke-maze", "maze seed 7, 20 s", {"terrain": "maze", "seed": 7}, 20)]}, "smoke.json")
