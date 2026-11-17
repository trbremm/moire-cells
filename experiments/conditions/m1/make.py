"""Step M1, whole membranes: the experiments' conditions. Run from the repository:
    python experiments/conditions/m1/make.py

  diag-<scene>      the DIAGNOSIS: the membrane material budget with the new counters, every M1 fix off (as before step M1), 10 min:
                    default, oases (?preset=oases), shallows (?preset=shallows), oxy-spot / oxy-full (the C12g oxygen conditions: a
                    never-drying mineral spring at (875, 328), a slow vent at (875, 472) re-dropped for 2 s of every 20 s)
                                                                                             (batch-diag.json, seed 3)
  fix1-<scene>      the same with head on oil only (?biteblock=0), 10 min                   (batch-fix1.json, seed 3)
  fix12-<scene>     the same with both fixes (head on oil, bites through the block): the M1 defaults, 10 min
                                                                                             (batch-fix12.json, seed 3)
  vent-<v>          Task B, the Deep vents preset in total darkness (charge field off since C12g): pilots of the preset's own options
                    (the vents' rate by an eval at 0 s, ?ventheat, ?searate, ?sealevel, ?starter), 5 min (batch-ventpilot.json, seed 3)
  oases-<c>         Task C, the Oases preset's geography: trace settling (?bury), the currents' speed (?curspeed) and the oases' rate
                    (?oasisrate), 20 min, snapshots at 10 and 20 min for where.py           (batch-oases.json, seed 3)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"
START = ("moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); moire.matter.addSpring(875, 472, 'heavy', 2.0);"
         " return moire.matter.springs.map(s => s.kind + ' ' + s.life)")
SCENES = {
    'default': ({}, False),
    'oases': ({'preset': 'oases'}, False),
    'shallows': ({'preset': 'shallows'}, False),
    'oxy-spot': ({'electrons': 1}, True),
    'oxy-full': ({'electrons': 1, 'light': 'full'}, True),
}
OFF = {'oilsoap': 0, 'biteblock': 0}


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def run(name, desc, scene, q, D=600, snaps=(300, 600), shots=(300, 600), extra=None):
    sq, oxy = SCENES[scene]
    c = {"name": f"m1-{name}", "description": desc, "query": {**sq, **q}, "duration": D, "sample_every": 20,
         "snapshots": [{"t": t, "grid": True} for t in snaps if t <= D],
         "shots": [{"t": t} for t in shots if t <= D] + [{"t": D, "panel": True, "name": "panel"}]}
    if oxy:
        c["evals"] = [{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, D, 20)]
    if extra:
        for k, v in extra.items():
            c[k] = c.get(k, []) + v if isinstance(v, list) else v
    return write(name, c)


def ventrun(name, desc, q, rate=None, D=300, snaps=(60, 120, 300), extra_evals=()):
    ev = []
    if rate is not None:
        ev.append({"t": 0, "js": f"moire.matter.springs.forEach(s => {{ if (s.kind === 'heavy') s.rate = {rate}; }}); "
                               "return moire.matter.springs.map(s => s.kind + ' ' + s.rate)"})
    ev += list(extra_evals)
    c = {"name": f"m1-{name}", "description": desc, "query": {"preset": "vent", **q}, "duration": D, "sample_every": 10,
         "snapshots": [{"t": t, "grid": True} for t in snaps if t <= D],
         "shots": [{"t": t} for t in (120, D)] + [{"t": D, "panel": True, "name": "panel"}]}
    if ev:
        c["evals"] = ev
    return write(name, c)


VENT_PILOTS = {
    'v0': ({}, None, 'as shipped (vents 40 atoms/s, heat 10 per atom, sea 0.02 per R2 per s toward 0.5)'),
    'v1': ({'ventheat': 2}, None, 'vent heat 2 per atom'),
    'v2': ({}, 10, 'vents 10 atoms/s'),
    'v3': ({'ventheat': 2, 'sealevel': 1}, 10, 'vents 10 atoms/s, heat 2, sea level 1'),
    'v4': ({'ventheat': 3, 'sealevel': 1, 'searate': 0.05}, 15, 'vents 15 atoms/s, heat 3, sea level 1 at 0.05'),
    'v5': ({'ventheat': 2, 'sealevel': 1, 'starter': 0.9}, 10, 'as v3, starter 0.9'),
    # round 2: the founders on a ring 8..20 R round each vent (the preset's new default; ?ventring=)
    'w0': ({}, None, 'founders on a ring 8..20 R round each vent'),
    'w1': ({'starter': 0.9}, None, 'ring, starter 0.9'),
    'w2': ({'ventring': '10,24', 'sealevel': 1}, None, 'ring 10..24 R, sea level 1'),
    'w3': ({'ventheat': 5}, 20, 'ring, vents 20 atoms/s, heat 5'),
    'w4': ({'oilsoap': 0, 'biteblock': 0}, None, 'ring, the M1 fixes off'),
    'w5': ({'ionblock': 0}, None, 'ring, the ion block off'),
    # round 3: more food (the economy, not the geography, failed in rounds 1 and 2)
    'x1': ({'ventheat': 5, 'ventring': '10,24', 'starter': 0.9}, 80, 'vents 80 atoms/s, heat 5, ring 10..24 R, starter 0.9'),
    'x2': ({'sealevel': 2, 'searate': 0.1, 'starter': 0.9}, 40, 'sea level 2 at 0.1, starter 0.9'),
    'x3': ({'ventheat': 5, 'ventring': '10,24', 'sealevel': 2, 'searate': 0.1, 'starter': 0.9}, 80, 'vents 80 atoms/s, heat 5, ring 10..24, sea 2 at 0.1, starter 0.9'),
    # round 4: the founders' engines (a preset may set genes: ?genes=): every founder one gradient engine g + T -> gT at rate 2, nothing else
    'y1': ({'genes': 'eng0:12,rate0:2,rate1:0,rate2:0'}, None, 'ring, every founder only g + T -> gT (rate 2)'),
    'y2': ({'genes': 'eng0:12,rate0:1,rate1:0,rate2:0', 'starter': 0.9}, None, 'ring, every founder only g + T -> gT (rate 1), starter 0.9'),
    'y3': ({'genes': 'eng0:14,rate0:1,eng1:12,rate1:1,rate2:0'}, None, 'ring, every founder G + T -> GT and g + T -> gT (rate 1 each)'),
}


OASES = {
    'c0': ({}, 'as shipped (bury 1/150 per s, currents 0.35 R/s, oases 1 atom/s)'),
    'c1': ({'bury': 0.0167}, 'bury 1/60 per s'),
    'c2': ({'bury': 0.0167, 'curspeed': 0.2}, 'bury 1/60, currents 0.2 R/s'),
    'c4': ({'bury': 0.0167, 'oasisrate': 2}, 'bury 1/60, oases 2 atoms/s'),
}


def final(name, desc, scene, q, D, closeups=()):
    sq, oxy = SCENES[scene]
    shots = [{"t": t} for t in sorted({600, 1200, D}) if t <= D]
    shots += [{"t": D, "panel": True, "name": "panel"}, {"t": D + 2, "name": "harmonic"}]
    shots += [{"t": D, "crop": c, "scale": 4, "name": f"close{k}"} for k, c in enumerate(closeups)]
    shots += [{"t": D + 2, "crop": c, "scale": 4, "name": f"close{k}_harmonic"} for k, c in enumerate(closeups)]
    ev = [{"t": D + 1, "js": "moire.control.action('harmonic'); return 'harmonic'"}]
    if oxy:
        ev = [{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, D, 20)] + ev
    return write(name, {"name": f"m1-{name}", "description": desc, "query": {**sq, **q}, "duration": D + 3, "sample_every": 20,
                        "snapshots": [{"t": t, "grid": True} for t in sorted({600, 1200, D}) if t <= D], "shots": shots, "evals": ev})


def finals():
    fin, off = [], []
    for scene, D, cl in (('default', 1200, ([560, 320, 160, 160], [700, 420, 160, 160])),
                         ('oxy-spot', 2400, ([540, 300, 160, 160], [800, 300, 160, 160])),
                         ('oxy-full', 2400, ([540, 300, 160, 160], [800, 300, 160, 160]))):
        fin.append(final(f"final-{scene}", f"step M1 record: {scene} with the M1 defaults (head on oil, bites through the block), {D // 60} min",
                         scene, {}, D, cl))
        Doff = D if scene != 'oxy-full' else 1200
        off.append(final(f"off-{scene}", f"step M1 control: {scene} with every M1 fix off (?oilsoap=0&biteblock=0), {Doff // 60} min",
                         scene, OFF, Doff, cl))
    off.append(final("null-oxy-full", "step M1: oxy-full with M1 on and ?channels=0 (the channel genes drift without effect), 20 min",
                     'oxy-full', {'channels': 0}, 1200))
    write("batch-final", {"batch": "m1-final", "runs": fin, "seeds": [3]})
    write("batch-off", {"batch": "m1-off", "runs": off, "seeds": [3]})
    sp = []
    for r in (1, 2, 3):
        for look in ('neon', 'harmonic'):
            for n, D in ((2000, 150), (10000, 60)):
                q = {"seed": 3, **({"cells": n} if n != 2000 else {}), **({"look": "harmonic"} if look == 'harmonic' else {})}
                sp.append({"name": f"m1-speed-{n // 1000}k-{look}-r{r}", "description": f"step M1 speed: default scene, {n} cells, MAX, {D} s, {look}",
                           "query": q, "duration": D, "sample_every": 25 if D > 100 else 10})
    write("speed", {"batch": "m1-speed", "runs": sp})
    write("reload", {"runs": [{"name": "m1-reload", "description": "a snapshot from before M1 (merge-n1-default_s3 at 10 min): the M1 fixes load off",
                               "query": {"snap": "experiments/runs/merge-n1-default_s3/snapshots/snap_t600.json"}, "duration": 60, "sample_every": 10,
                               "evals": [{"t": 5, "js": "return moire.whole.params"}], "shots": [{"t": 60}]}]})
    V = "const v = moire.control.view(); "
    ev = [
        {"t": 5, "js": V + "moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.35, 'soap', 120); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.5, 'oil', 120); moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.3, 'linker', 120); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.3, 'ions', 120); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'light', 1e9); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 1e9); if (!moire.oases.started) moire.oases.start(); return moire.matter.springs.map(s => s.kind)"},
        {"t": 60, "js": "return moire.control.action('culture')"},
        {"t": 80, "js": "return await moire.app.place(Array.from({length: 40}, (_, k) => [150 + 13 * k, 120]), moire.genome.founders[0])"},
        {"t": 100, "js": "return moire.control.action('wash')"},
        {"t": 105, "js": V + "moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.4, 'light', 1e9); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 400); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'emulsion', 300); moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.4, 'soap', 200); return 'springs again'"},
        {"t": 170, "js": "moire.whole.params.oilSoap = false; return 'head on oil off'"},
        {"t": 190, "js": "moire.whole.params.oilSoap = true; moire.whole.params.biteBlock = false; return 'head on oil on, bite block off'"},
        {"t": 210, "js": "moire.whole.params.biteBlock = true; moire.ions.params.block = false; return 'ion block off (the bite block then acts on nothing)'"},
        {"t": 230, "js": "moire.ions.params.block = true; moire.lipids.params.on = false; return 'lipids off'"},
        {"t": 250, "js": "moire.lipids.params.on = true; moire.membrane.params.on = false; return 'membrane chemistry off'"},
        {"t": 270, "js": "moire.membrane.params.on = true; return 'membranes back'"},
        {"t": 300, "js": "return moire.control.action('genomes')"},
        {"t": 360, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return { exact: r.exact, notes: r.notes, rounding: r.rounding }"},
    ]
    write("check", {"name": "m1-check", "description": "step M1 books check: 420 s at MAX (seed 5), the whole dish lit; springs (soap, oil, linker, ion, mineral, vent, emulsion); N (60 s), 40 cells placed (80 s), a wash (100 s), resizes (150 s, 220 s), each M1 switch off and on (170..210 s), the ion block, lipids and membrane chemistry off and on (210..270 s), G (300 s), a snapshot saved and loaded at once (360 s); atoms and charge rounding must stay 0",
                    "query": {"seed": 5, "light": "full"}, "duration": 420, "sample_every": 10,
                    "resizes": [{"t": 150, "size": "1000x700"}, {"t": 220, "size": "1280x800"}],
                    "evals": ev, "shots": [{"t": 200}, {"t": 420, "panel": True, "name": "panel"}], "stall": 120})


def darks():
    out = []
    for name, q, d in (('dark', {}, 'the Deep vents preset as retuned (founders on a ring 8..20 R round each vent), total darkness'),
                       ('dark-eaters', {'genes': 'eng0:12,rate0:2,rate1:0,rate2:0'}, 'the same, every founder only the gradient engine g + T -> gT (rate 2)')):
        snaps = [{"t": t, "grid": True} for t in (60, 120, 300, 600, 1200, 2400)]
        shots = [{"t": t} for t in (60, 120, 300, 600, 2400)] + [{"t": 2400, "panel": True, "name": "panel"}]
        shots += [{"t": 120, "crop": [540, 110, 200, 150], "scale": 3, "name": "close_t120"}]
        out.append(write(name, {"name": f"m1-{name}", "description": f"step M1 Task B: {d}, 40 min", "query": {"preset": "vent", **q},
                                "duration": 2400, "sample_every": 10, "snapshots": snaps, "shots": shots}))
    write("batch-dark", {"batch": "m1-dark", "runs": out, "seeds": [3, 7]})


def main():
    darks()
    finals()
    oz = []
    for k, (q, d) in OASES.items():
        oz.append(write(f"oases-{k}", {"name": f"m1-oases-{k}", "description": f"step M1 Task C: the Oases preset, {d}, 20 min",
                                       "query": {"preset": "oases", **q}, "duration": 1200, "sample_every": 30,
                                       "snapshots": [{"t": 600, "grid": True}, {"t": 1200, "grid": True}],
                                       "shots": [{"t": 600}, {"t": 1200}, {"t": 1200, "panel": True, "name": "panel"}]}))
    write("batch-oases", {"batch": "m1-oases", "runs": oz, "seeds": [3]})
    vp = []
    for k, (q, rate, d) in VENT_PILOTS.items():
        vp.append(ventrun(f"vent-{k}", f"step M1 Task B pilot: the Deep vents preset in total darkness, {d}, 5 min", q, rate))
    write("batch-ventpilot", {"batch": "m1-ventpilot", "runs": [v for v in vp if '-v' in v], "seeds": [3]})
    write("batch-ventpilot2", {"batch": "m1-ventpilot2", "runs": [v for v in vp if '-w' in v], "seeds": [3]})
    write("batch-ventpilot3", {"batch": "m1-ventpilot3", "runs": [v for v in vp if '-x' in v], "seeds": [3]})
    write("batch-ventpilot4", {"batch": "m1-ventpilot4", "runs": [v for v in vp if '-y' in v], "seeds": [3]})
    diag, fix1, fix12 = [], [], []
    for s in SCENES:
        diag.append(run(f"diag-{s}", f"step M1 diagnosis: {s}, every M1 fix off (the membrane budget as before), 10 min", s, OFF))
        fix1.append(run(f"fix1-{s}", f"step M1: {s}, head on oil only (bites as before), 10 min", s, {'biteblock': 0}))
        fix12.append(run(f"fix12-{s}", f"step M1: {s}, both fixes (the M1 defaults), 10 min", s, {}))
    write("batch-diag", {"batch": "m1-diag", "runs": diag, "seeds": [3]})
    write("batch-fix1", {"batch": "m1-fix1", "runs": [f for f in fix1 if 'oases' not in f and 'spot' not in f], "seeds": [3]})
    write("batch-fix12", {"batch": "m1-fix12", "runs": fix12, "seeds": [3]})


if __name__ == "__main__":
    main()
