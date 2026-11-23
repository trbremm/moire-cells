"""Step M2: write the mutation sweep's condition batches (experiments/conditions/m2/sweep-*.json).

Settings: drift x0, x0.3, x1, x3 and rare (p 0.1, step 8), hard light's extra mutation OFF in all (?hardmut=0) but one pair; scenes: default seed 3 and 7, islands seed 7, colonies seed 3. Each setting
ON and (most) with a NULL twin: every neutral control that exists for a tracked gene at once (glue, flagellum, cilia, chemotaxis,
fidelity, duplication, gates, engulf, kin sparing, kin channels, shape). 20 simulated minutes, samples every 30 s (the MUTATION census
every 20 s), pictures at 4, 10 and 20 min in the neon view and the lineage (self marker) view.

    python tools/m2_sweep.py            # writes the batches
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "experiments", "conditions", "m2")
NULLS = {"gluenull": 1, "flagellanull": 1, "cilianull": 1, "chemonull": 1, "fidelitynull": 1, "dupnull": 1,
         "gatenull": 1, "engulfnull": 1, "kinsparenull": 1, "kinnull": 1, "shapenull": 1}
SETTINGS = {
    "x0": {"mut": 0},
    "x03": {"mut": 0.3},
    "x1": {"mut": 1},
    "x3": {"mut": 3},
    "rare": {"mutmode": "rare", "mutp": 0.1},
    "rare3": {"mutmode": "rare", "mutp": 0.3},
    "rarehl": {"mutmode": "rare", "mutp": 0.1, "hardmut": 1},   # the one pair with hard light's extra ON (against def3 rare)
}
SCENES = {
    "def3": {"seed": 3},
    "def7": {"seed": 7},
    "isl7": {"terrain": "islands", "seed": 7},
    "col3": {"preset": "colonies", "seed": 3},
}


def run(scene, setting, null, dur=1200):
    q = dict(SCENES[scene]); q["hardmut"] = 0; q.update(SETTINGS[setting]); q["mutcensus"] = 20   # hard light's extra OFF (but rarehl)
    if null:
        q.update(NULLS)
    name = f"m2-sw-{scene}-{setting}-{'null' if null else 'on'}"
    shots = []
    for t in (240, 600, 1200):
        shots.append({"t": t, "name": f"t{t}"})
        shots.append({"t": t, "view": "marker", "name": f"t{t}-marker"})
    return {"name": name, "description": f"step M2 sweep: {scene} {setting} {'NULL twin' if null else 'on'}, 20 min",
            "query": q, "duration": dur + 3, "sample_every": 30, "stall": 900, "shots": shots}


def batch(name, runs):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + ".json"), "w") as f:
        json.dump({"batch": name, "runs": runs}, f, indent=1)


if __name__ == "__main__":
    # the plan (coordinator 2026-11-23: at most ~5 h of GPU; x1, x3 and rare with twins on default s3/s7 and islands; x0, x0.3 and the
    # colonies without twins), most important first; four parallel queues balanced by cost (islands ~2x)
    plan = []
    for st in ("x1", "rare", "x3"):
        for sc in ("def3", "def7"):
            plan += [(sc, st, False), (sc, st, True)]
    plan += [("def3", "x0", False), ("def7", "x0", False), ("def3", "x03", False), ("def3", "rarehl", False)]
    for st in ("x1", "rare", "x3"):
        plan += [("isl7", st, False), ("isl7", st, True)]
    plan += [("col3", st, False) for st in ("x1", "rare", "x3", "x0")]
    queues = [[], [], [], []]
    cost = [0, 0, 0, 0]
    for sc, st, nu in plan:
        k = cost.index(min(cost))
        queues[k].append(run(sc, st, nu))
        cost[k] += 2 if sc == "isl7" else 1
    for k, q in enumerate(queues):
        batch(f"sweep-q{k}", q)
    print(len(plan), "runs in 4 queues:", cost)
