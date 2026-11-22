"""Step C15a conditions: carbon in the open dish, watched with the cells blind to it (README "Step C15a: carbon in the open dish").

python experiments/conditions/c15a/make.py   -> batch-watch.json, books.json, speed.json in this folder
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
TAR_ALONE = "moire.matter.params.show = 24"     # Shift+S: tar alone (summary 0, the 18 substances, the ladder 19..23, tar 24)
SHOW_ALL = "moire.matter.params.show = 0"
PROBE = ("const L = moire.carbon.ledger; return JSON.stringify({t: moire.time(), ladder: L.ladder, tar: L.tar, "
         "carbon: L.dish.c, rx: L.rx, rounding: L.rounding, eRounding: L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null})")


def watch(name, desc, query, crops, dur=600):
    shots = [{"t": 120}, {"t": 300}, {"t": dur}]
    shots += [{"t": dur + 1, "name": f"close{k}", "crop": c, "scale": 3} for k, c in enumerate(crops)]
    shots += [{"t": dur + 2, "name": "harmonic"}]
    shots += [{"t": dur + 2.5, "name": f"harmonic_close{k}", "crop": c, "scale": 3} for k, c in enumerate(crops)]
    shots += [{"t": dur + 3, "name": "tar_alone"}]
    return {
        "name": name, "description": desc, "query": query, "duration": dur + 3.5, "sample_every": 30, "stall": 200,
        "shots": shots, "snapshots": [],
        "evals": [{"t": 300, "js": PROBE}, {"t": dur, "js": PROBE},
                  {"t": dur + 1.5, "js": HARM_ON}, {"t": dur + 2.75, "js": HARM_ON}, {"t": dur + 2.9, "js": TAR_ALONE},
                  {"t": dur + 3.2, "js": SHOW_ALL}],
    }


DEF_CROPS = [[794, 268, 160, 100], [794, 422, 160, 100]]          # the mineral spring, the vent (default scene, 1280 x 800)
VENT_CROPS = [[560, 134, 160, 100], [747, 458, 160, 100]]          # two of the Deep vents' fissures (1280 x 800)
runs = [
    watch("c15a-default-spot", "default scene, spotlight (as the page opens), 10 min", {"seed": 3}, DEF_CROPS),
    watch("c15a-default-full", "default scene, the whole dish lit, 10 min", {"seed": 3, "light": "full"}, DEF_CROPS),
    watch("c15a-vent-dark", "Deep vents preset, total darkness, 10 min", {"seed": 3, "preset": "vent"}, VENT_CROPS),
    watch("c15a-vent-dim", "Deep vents preset, a dim light from above (&light=full), 10 min", {"seed": 3, "preset": "vent", "light": "full"}, VENT_CROPS),
]
json.dump({"batch": "c15a-watch", "runs": runs}, open(os.path.join(HERE, "batch-watch.json"), "w"), indent=1)

# the books: carbon, atoms, charge and energy roundings over 20 min of the default scene, and a wash and a reload half way
books = {"batch": "c15a-books", "runs": [{
    "name": "c15a-books", "description": "books: 20 min default scene, whole dish lit, a wash (Shift+C) at 600 s", "query": {"seed": 7, "light": "full"},
    "duration": 1200, "sample_every": 60, "stall": 200, "shots": [{"t": 1200}], "snapshots": [{"t": 900, "grid": True}],
    "evals": [{"t": 590, "js": PROBE}, {"t": 600, "js": "moire.matter.wash(); return 'washed'"}, {"t": 660, "js": PROBE}, {"t": 1200, "js": PROBE}],
}]}
json.dump(books, open(os.path.join(HERE, "books.json"), "w"), indent=1)

# speed: the default scene at 2000 cells, carbon on against ?carbon=0 (the chemistry before C15a), twice each
speed = {"batch": "c15a-speed", "runs": []}
for r in (1, 2):
    for on in (True, False):
        q = {"seed": 3} if on else {"seed": 3, "carbon": 0}
        speed["runs"].append({"name": f"c15a-speed-2k-{'on' if on else 'off'}-r{r}", "description": f"speed, default scene, 2000 cells, carbon {'on' if on else 'off'}, 150 s",
                              "query": q, "duration": 150, "sample_every": 25, "shots": [], "snapshots": [], "evals": []})
json.dump(speed, open(os.path.join(HERE, "speed.json"), "w"), indent=1)
print("wrote batch-watch.json, books.json, speed.json")

# close-ups through the app's camera (zoom x4 at a place, then back), neon and harmonic, at device px 2: a tar rim, a vent's plume
def closeups(name, desc, query, places, dur=600):
    shots, evals, t = [{"t": dur}], [], dur + 0.5
    for k, (x, y, label) in enumerate(places):
        at = f"{x}, {y}" if not isinstance(x, str) else f"...window.__sp['{x}']"
        evals.append({"t": t, "js": f"moire.camera.set(4, {at}); return 'zoom {label}'"})
        shots.append({"t": t + 0.2, "name": f"zoom_{label}"})
        evals.append({"t": t + 0.3, "js": HARM_ON})
        shots.append({"t": t + 0.5, "name": f"zoom_{label}_harmonic"})
        evals.append({"t": t + 0.6, "js": HARM_ON})
        evals.append({"t": t + 0.7, "js": TAR_ALONE})
        shots.append({"t": t + 0.8, "name": f"zoom_{label}_tar"})
        evals.append({"t": t + 0.9, "js": SHOW_ALL})
        t += 1.5
    evals.append({"t": t, "js": "moire.camera.fit(); return 'unzoomed'"})
    # where the springs were at the start (a vent dries up after a minute; its tar stays)
    keep = {"t": 1, "js": "window.__sp = {}; for (const q of moire.matter.springs) if (!window.__sp[q.kind]) window.__sp[q.kind] = [q.x, q.y]; return JSON.stringify(window.__sp)"}
    return {"name": name, "description": desc, "query": query, "dpr": 2, "duration": t + 0.5, "sample_every": 60, "stall": 200,
            "shots": shots, "snapshots": [], "evals": [keep, {"t": dur - 1, "js": PROBE}] + evals}


pics = {"batch": "c15a-pictures", "runs": [
    closeups("c15a-pics-vent", "Deep vents, dark, 10 min: close-ups of two fissures", {"seed": 3, "preset": "vent"},
             [(640, 184, "fissure_top"), (827, 508, "fissure_right")]),
    closeups("c15a-pics-default", "default scene with ONE cell (the substrate alone), whole dish lit, 10 min: close-ups of the vent and the mineral spring",
             {"seed": 3, "light": "full", "cells": 1}, [("heavy", None, "vent"), ("light", None, "spring")]),
    closeups("c15a-pics-colony", "default scene, spotlight, 10 min: close-up of the colony round the springs (the warm place)",
             {"seed": 3}, [("heavy", None, "vent")]),
]}
json.dump(pics, open(os.path.join(HERE, "pictures.json"), "w"), indent=1)
print("wrote pictures.json")

# snapshots: one saved without carbon (?carbon=0) and the books run's carbon one, each loaded and run on (the books stay exact)
reload = {"batch": "c15a-reload", "runs": [
    {"name": "c15a-nocarbon-snap", "description": "save a snapshot WITHOUT carbon (as every snapshot from before C15a)", "query": {"seed": 3, "carbon": 0},
     "duration": 30, "sample_every": 10, "shots": [], "snapshots": [{"t": 30, "grid": True}], "evals": []},
    {"name": "c15a-reload-nocarbon", "description": "that snapshot loads (the page reloads itself with ?carbon=0) and runs 60 s",
     "query": {"snap": "experiments/runs/c15a-nocarbon-snap/snapshots/snap_t30.json"}, "duration": 60, "sample_every": 10, "shots": [],
     "snapshots": [], "evals": [{"t": 1, "js": "return JSON.stringify({search: location.search, carbon: moire.carbon.on})"}]},
    {"name": "c15a-reload-carbon", "description": "the books run's snapshot at 900 s (with carbon) loads and runs 120 s", 
     "query": {"snap": "experiments/runs/c15a-books/snapshots/snap_t900.json"}, "duration": 120, "sample_every": 20, "shots": [{"t": 1}],
     "snapshots": [], "evals": [{"t": 1, "js": PROBE}, {"t": 119, "js": PROBE}]},
]}
json.dump(reload, open(os.path.join(HERE, "reload.json"), "w"), indent=1)
print("wrote reload.json")
