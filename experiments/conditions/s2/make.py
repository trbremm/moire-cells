"""Step S2 (flagella and cilia): conditions. python experiments/conditions/s2/make.py
  smoke        60 s, the plain dish, every cell given a pusher flagellum at 30 s: does it run, swim, stir
  lab          the tissue lab with hand-set motors (no evolution: ?preset=lab, mutation off by the preset), each 120 s, pictures + a strip of
               frames (motion matters): a few PUSHERS in open water, a dense PUSHER suspension (and the same as PULLERS), a CILIATED sheet
               (its edge beats, coupled: waves?), a ciliated free cell (and tilted: spinning)
  check        the books (atoms, charge, energy, carbon rounding 0): 360 s at MAX (seed 5), whole dish lit, every motor switch toggled at runtime,
               a snapshot saved and loaded, a resize, half the cells given motors
  act          does it act? 20 min, motors on vs their neutral controls (?flagellanull=1&cilianull=1), the delta (seed 7), islands (seed 12) and
               the Colonies preset (seed 3); act2: the same with seed 2; the place census every 5 min
  ff, phone    Firefox headed and the phone size (390 x 844): the page runs and draws the motors
  off, main    ?flagella=0&cilia=0 vs main (run main.json from an export of main d5076f5): 180 s, seed 3, the open world and the delta
  speed        2000 / 10 000 cells, neon, motors on and off, every cell given motors (the GPU is shared: compare within the batch)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


MOT = "return JSON.stringify(moire.motors.census)"
PLACE = "return JSON.stringify(await moire.motors.now())"
STIR = "return JSON.stringify(moire.stir.census)"
HARM = "moire.control.action('harmonic'); return 'harmonic toggled'"
FIT = "moire.camera.fit(); return 'fit'"
MP = lambda k, v: f"moire.motors.params.{k} = {json.dumps(v)}; return 'motors {k}'"
GIVE = lambda genes: "await moire.genome.setAll({" + ", ".join(f"{k}: {v}" for k, v in genes.items()) + "}); return 'genes set'"


# the lab has no food (no springs) and its batteries empty within ~40 s, which stops every motor (the battery gates them as it gates
# crawling): for the look the lab's battery neither pays nor gates (the motors' costs are checked in check / act)
FEED = "moire.eat.params.pay = false; return 'battery pays nothing, gates nothing'"


def zoom_at(fx, fy, z):
    return f"moire.camera.set({z}, {fx} * moire.dish.W, {fy} * moire.dish.H); return 'zoom'"


PUSH = {"flagellum": 1, "flagSign": 1, "flagPlace": 0}
PULL = {"flagellum": 1, "flagSign": -1, "flagPlace": 0}
CIL = {"cilia": 1, "ciliaCouple": 1, "ciliaTilt": 0}

write('smoke', {"name": "s2-smoke", "description": "step S2 smoke: the plain dish, every cell a pusher at 30 s, 60 s",
                "query": {"seed": 3, "world": "open"}, "duration": 60, "sample_every": 10, "stall": 400,
                "shots": [{"t": 29, "name": "before"}, {"t": 59, "name": "pushers", "panel": True}],
                "evals": [{"t": 30, "js": GIVE(PUSH)}, {"t": 45, "js": MOT}, {"t": 58, "js": MOT}, {"t": 58, "js": STIR}]})


def lab(name, cells, genes, desc, z=(0.5, 0.5, 2.5), extra_q=None):
    q = {"preset": "lab", "cells": cells, "genes": ",".join(f"{k}:{v}" for k, v in genes.items())}
    q.update(extra_q or {})
    shots = [{"t": 60, "name": "t60"}, {"t": 120, "name": "t120"}] + [{"t": 100 + 0.5 * k, "name": f"strip{k:02d}"} for k in range(8)]
    return {"name": f"s2-lab-{name}", "description": f"step S2 lab: {desc}", "query": q, "duration": 126, "sample_every": 10, "stall": 400, "dpr": 1,
            "shots": shots + [{"t": 122, "name": "zoom"}, {"t": 124, "name": "zoom_harm"}],
            "evals": [{"t": 0, "js": FEED}, {"t": 50, "js": MOT}, {"t": 119, "js": MOT}, {"t": 119, "js": STIR}, {"t": 121, "js": zoom_at(*z)}, {"t": 123, "js": HARM}]}


write('lab', {"batch": "s2-lab", "seeds": [3], "runs": [
    lab('pushers-few', 12, PUSH, '12 pushers in open water', extra_q={"spread": "scatter", "zoom": 1.5}),
    lab('pushers-dense', 400, PUSH, '400 pushers, a dense suspension', extra_q={"spread": "scatter", "zoom": 1}),
    lab('pullers-dense', 400, PULL, '400 pullers, a dense suspension', extra_q={"spread": "scatter", "zoom": 1}),
    lab('cilia-sheet', 150, {**CIL, "adhesion": 1.5}, 'a sticky sheet of 150 ciliated cells, coupled'),
    lab('cilia-free', 12, CIL, '12 free ciliated cells', extra_q={"spread": "scatter", "zoom": 1.5}),
    lab('cilia-spin', 12, {**CIL, "ciliaTilt": 0.8}, '12 free ciliated cells, stroke tilted round the body (spinning)', extra_q={"spread": "scatter", "zoom": 1.5}),
]})

check_ev = [
    {"t": 5, "js": GIVE({"flagellum": 0.6, "flagSign": 0.5, "cilia": 0.5, "ciliaCouple": 0.5})},
    {"t": 40, "js": MOT},
    {"t": 50, "js": MP('flagellaNull', True)}, {"t": 60, "js": MP('flagellaNull', False)},
    {"t": 65, "js": MP('ciliaNull', True)}, {"t": 75, "js": MP('ciliaNull', False)},
    {"t": 80, "js": MP('dipole', False)}, {"t": 90, "js": MP('dipole', True)},
    {"t": 95, "js": MP('water', False)}, {"t": 105, "js": MP('water', True)},
    {"t": 110, "js": MP('pump', False)}, {"t": 115, "js": MP('pump', True)},
    {"t": 120, "js": MP('couple', False)}, {"t": 125, "js": MP('couple', True)},
    {"t": 130, "js": MP('flagella', False)}, {"t": 140, "js": MP('cilia', False)},
    {"t": 150, "js": MP('flagella', True)}, {"t": 160, "js": MP('cilia', True)},
    {"t": 170, "js": GIVE({"flagSign": -0.5, "ciliaTilt": 0.7, "flagPlace": 0.3})},
    {"t": 240, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); "
                     "return JSON.stringify({ exact: r.exact, notes: r.notes, rounding: r.rounding })"},
    {"t": 300, "js": MOT}, {"t": 358, "js": MOT},
]
write('check', {"name": "s2-check", "description": "step S2 books check: 360 s at MAX (seed 5), whole dish lit; motors given to every cell; "
                "every motor switch toggled at runtime, a resize, a snapshot saved and loaded: rounding must stay 0",
                "query": {"seed": 5, "light": "full", "world": "open"}, "duration": 360, "sample_every": 10, "stall": 400, "snapshots": [],
                "resizes": [{"t": 200, "size": "1000x700"}, {"t": 220, "size": "1280x800"}],
                "shots": [{"t": 40, "name": "motors"}, {"t": 360, "panel": True, "name": "panel"}], "evals": check_ev})

act = []
for name, q in (('delta', {"terrain": "delta", "seed": 7}), ('islands', {"terrain": "islands", "seed": 12}), ('colonies', {"preset": "colonies", "seed": 3}),
                ('delta2', {"terrain": "delta", "seed": 2}), ('islands2', {"terrain": "islands", "seed": 2}), ('colonies2', {"preset": "colonies", "seed": 2})):
    for ctl, cq in (('on', {}), ('null', {"flagellanull": 1, "cilianull": 1})):
        act.append({"name": f"s2-act-{name}-{ctl}", "description": f"step S2 act: {name}, motors {ctl}, 20 min",
                    "query": {**q, **cq}, "duration": 1203, "sample_every": 30, "stall": 400, "snapshots": [],
                    "shots": [{"t": 600, "name": "t600"}, {"t": 1200, "name": "end"}, {"t": 1201, "panel": True, "name": "panel"}],
                    "evals": [{"t": t, "js": MOT} for t in (300, 600, 900, 1200)] + [{"t": t + 1, "js": PLACE} for t in (300, 600, 900, 1200)]})
first = lambda r: not r['name'].split('-')[2].endswith('2')
write('act-on', {"batch": "s2-act-on", "runs": [r for r in act if r['name'].endswith('-on') and first(r)]})
write('act-null', {"batch": "s2-act-null", "runs": [r for r in act if r['name'].endswith('-null') and first(r)]})
write('act2-on', {"batch": "s2-act2-on", "runs": [r for r in act if r['name'].endswith('-on') and not first(r)]})
write('act2-null', {"batch": "s2-act2-null", "runs": [r for r in act if r['name'].endswith('-null') and not first(r)]})

write('ff', {"name": "s2-ff", "description": "Firefox headed: the lab's dense pushers and ciliated sheet draw and run",
             "query": {"preset": "lab", "cells": 150, "genes": "flagellum:1,flagSign:1,cilia:1,ciliaCouple:1"}, "duration": 40, "sample_every": 10,
             "stall": 400, "shots": [{"t": 39, "name": "end", "panel": True}], "evals": [{"t": 38, "js": MOT}]})
write('phone', {"name": "s2-phone", "description": "phone size 390x844: the delta world with motors given at 20 s, 60 s", "size": "390x844",
                "query": {"terrain": "delta", "seed": 7}, "duration": 60, "sample_every": 10, "stall": 400,
                "shots": [{"t": 59, "name": "end"}, {"t": 59.5, "name": "panel", "panel": True}],
                "evals": [{"t": 20, "js": GIVE({"flagellum": 0.7, "flagSign": 1, "cilia": 0.7, "ciliaCouple": 1})}, {"t": 58, "js": MOT}]})

runs = []
for n, T in ((2000, 150), (10000, 60)):
    for tag, q, ev in (('on', {}, []), ('off', {"flagella": 0, "cilia": 0}, []),
                       ('given', {}, [{"t": 0, "js": GIVE({"flagellum": 0.7, "flagSign": 1, "cilia": 0.7, "ciliaCouple": 1})}])):
        runs.append({"name": f"s2-speed-{n // 1000}k-{tag}", "description": f"speed: {n} cells, neon, motors {tag}, {T} s at MAX",
                     "query": {"seed": 3, "world": "open", "cells": n}, "duration": T, "sample_every": 0, "stall": 400,
                     "evals": ev, "shots": []})
        runs[-1]["query"].update(q)
write('speed', {"batch": "s2-speed", "runs": runs})
offruns = []
for tag, q in (('open', {"seed": 3, "world": "open"}), ('delta', {"seed": 7, "terrain": "delta"})):
    offruns.append({"name": f"s2-off-{tag}", "description": f"motors off (?flagella=0&cilia=0), {tag}, 180 s: must match main",
                    "query": {**q, "flagella": 0, "cilia": 0}, "duration": 180, "sample_every": 10, "stall": 400, "snapshots": [],
                    "shots": [{"t": 180, "name": "end", "panel": True}]})
write('off', {"batch": "s2-off", "runs": offruns})
write('main', {"batch": "s2-main", "runs": [{**r, "name": r["name"].replace("s2-off", "s2-main"),
               "description": r["description"].replace("motors off (?flagella=0&cilia=0)", "main d5076f5"),
               "query": {k: v for k, v in r["query"].items() if k not in ("flagella", "cilia")}} for r in offruns]})
print('ok')
