"""A fresh load opens a generated world (README "The toy front", "A fresh load opens a generated world").

The candidates (the worlds that grew with carbon on, README "Carbon on by default"): each at 2 seeds, on a computer (1280 x 800)
and a phone (390 x 844), 4 simulated minutes, pictures at 10 s, 30 s, 2 and 4 minutes, live cells and the books at 1, 10, 30, 60, 120,
180, 240 s, and the world's build time (moire.toy.buildMs). A fresh load is exactly ?terrain=<kind>&seed=<N> (index.html rewrites the
address before any module reads it), so the runs open those links, with toywash=1 (the wash a toy link gets at its first start; the experiment
 tools add options, which turn it off).
  python make.py   -> fl-desk.json, fl-phone.json (washed, as a fresh load), fl-desk-nw.json, fl-phone-nw.json (toywash=0)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ["delta", "thicket", "islands", "sieve", "forest"]
SEEDS = [3, 12]
PROBE = ("const L = moire.carbon && moire.carbon.ledger, H = moire.heat.ledger; "
         "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, buildMs: moire.toy && moire.toy.buildMs, "
         "cRound: L && L.rounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding})")
PROBES = [1, 10, 30, 60, 120, 180, 240]
SHOTS = [10, 30, 120, 240]


def run(name, desc, query, size, dur=240):
    return {"name": name, "description": desc, "query": query, "size": size, "duration": dur, "sample_every": 30, "stall": 400,
            "shots": [{"t": t, "name": f"t{t}"} for t in SHOTS if t <= dur], "snapshots": [],
            "evals": [{"t": t, "js": PROBE} for t in PROBES if t <= dur]}


if __name__ == "__main__":
    for tag, size in (("desk", "1280x800"), ("phone", "390x844")):
        for wash, nw, how in ((1, "", "(a fresh load's world)"), (0, "-nw", "without the boot wash (toywash=0: the open dish's tar left in)")):
            runs = [run(f"fl-{tag}{nw}-{k}-s{s}", f"{k} seed {s}, {size}, carbon on, 4 min {how}",
                        {"terrain": k, "seed": s, "toywash": wash}, size) for s in SEEDS for k in KINDS]
            with open(os.path.join(HERE, f"fl-{tag}{nw}.json"), "w") as f:
                json.dump({"batch": f"fl-{tag}{nw}", "runs": runs}, f, indent=1)
