"""Step S1 (cell shape): conditions. python experiments/conditions/s1/make.py
  check         the books (atoms and charge rounding 0) with spindles: every cell asks 3:1 at the start, then every S1 switch toggled at runtime
                (null, gene, network output, torques, exchange, wrap, the whole shape off and on), obstacles painted over the culture, a squeeze
                0.8 and a stretch 1.25, a resize, a snapshot saved and loaded; whole dish lit
  quick         the quick watch (the user: results not final): does elongation get SELECTED against its neutral control? Founders with the
                elongation gene drawn at random (?founders=wild&wild=shape: only the shape genes wild), 10 min, seeds 3 and 7, shape on vs
                ?shapenull=1: the default scene with 20 hand-made predators dropped at 2 min; the Chip (flow through a pillar array); the default
                scene alone
  pics          pictures: the default scene with wild shape founders at 300 s (neon, harmonic, close zooms), Chip and Crevices with them, the
                tissue lab with hand-set spindles (150 clones asking 3.3:1; bundles), wild colonies
  speed-after   as G0b's (headless Chrome 1280 x 800, default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s; neon and harmonic), shape on
                (founders round) and ?shape=0, plus 2000 with every cell asking 3:1 (the GPU is shared: compare within the batch)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


SHAPE = "return JSON.stringify(moire.spindle.census)"
PRED = "const C = moire.predators.census; return JSON.stringify(C ? {genes: C.genes, now: C.now, total: C.total} : null)"
HARM = "moire.control.action('harmonic'); return 'harmonic toggled'"
FIT = "moire.camera.fit(); return 'fit'"
SPIN = "await moire.genome.setAll({elongation: 1.1}); return 'every cell asks 3:1'"
SW = lambda k, v: f"moire.spindle.params.{k} = {json.dumps(v)}; return 'spindle.{k} {v}'"
PAINT = ("const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; "
         "O.line(0.5 * W, 0.05 * H, 0.5 * W, 0.95 * H, 2 * R); O.pillars(0.15 * W, 0.2 * H, 0.35 * W, 0.8 * H, 2.5 * R, 9 * R); "
         "return `painted ${O.shapes.length}`")
WILD = {"founders": "wild", "wild": "shape"}

write('check', {
    "name": "s1-check", "description": "step S1 books check: 420 s at MAX (seed 5), whole dish lit; every cell asks 3:1 at 2 s; every S1 switch "
    "toggled at runtime, obstacles painted over the culture, a squeeze 0.8 and a stretch 1.25, a resize, a snapshot saved and loaded: atoms and "
    "charge rounding must stay 0",
    "query": {"seed": 5, "light": "full"}, "duration": 420, "sample_every": 10, "stall": 300, "snapshots": [],
    "resizes": [{"t": 300, "size": "1000x700"}, {"t": 330, "size": "1280x800"}],
    "shots": [{"t": 40, "name": "spindles"}, {"t": 200, "name": "squeezed"}, {"t": 420, "panel": True, "name": "panel"}],
    "evals": [{"t": 2, "js": SPIN}, {"t": 30, "js": SHAPE},
              {"t": 50, "js": SW('null', True)}, {"t": 65, "js": SW('null', False)},
              {"t": 70, "js": SW('torque', False)}, {"t": 80, "js": SW('torque', True)},
              {"t": 85, "js": SW('exchange', False)}, {"t": 95, "js": SW('exchange', True)},
              {"t": 100, "js": SW('wrap', False)}, {"t": 105, "js": SW('wrap', True)},
              {"t": 110, "js": SW('grn', False)}, {"t": 115, "js": SW('grn', True)},
              {"t": 120, "js": SW('gene', False)}, {"t": 130, "js": SW('gene', True)},
              {"t": 140, "js": SW('on', False)}, {"t": 155, "js": SW('on', True)},
              {"t": 160, "js": SW('aspectMax', 2.5)}, {"t": 170, "js": SW('aspectMax', 4)},
              {"t": 175, "js": PAINT},
              {"t": 190, "js": "await moire.dish.scale(0.8); return 'squeezed'"}, {"t": 240, "js": "await moire.dish.scale(1.25); return 'stretched'"},
              {"t": 360, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return JSON.stringify({ exact: r.exact, notes: r.notes, rounding: r.rounding })"},
              {"t": 419, "js": SHAPE}],
})

quick = []
for name, q, extra in (('pred', {}, [{"t": 120, "js": "return await moire.predators.place(20)"}]),
                       ('chip', {"preset": "chip"}, []),
                       ('default', {}, [])):
    for ctl, cq in (('on', {}), ('null', {"shapenull": 1})):
        quick.append({"name": f"s1-q-{name}-{ctl}", "description": f"step S1 quick: {name}, wild shape founders, shape {ctl}, 10 min",
                      "query": {**WILD, **q, **cq}, "duration": 600, "sample_every": 30, "stall": 300, "snapshots": [],
                      "shots": [{"t": 300, "name": "t300"}, {"t": 600, "name": "end"}],
                      "evals": extra + [{"t": t, "js": SHAPE} for t in (60, 300, 599)] + ([{"t": 599, "js": PRED}] if name == 'pred' else [])})
write('quick-a', {"batch": "s1-quick-a", "runs": [r for r in quick if '-on' in r['name']], "seeds": [3, 7]})
write('quick-b', {"batch": "s1-quick-b", "runs": [r for r in quick if '-null' in r['name']], "seeds": [3, 7]})


def zoom_at(fx, fy, z):
    return f"moire.camera.set({z}, {fx} * moire.dish.W, {fy} * moire.dish.H); return 'zoom'"


def pics(name, q, T, z, extra=()):
    return {"name": f"s1-pics-{name}", "description": f"step S1 pictures: {name}, at {T} s: neon, a close zoom (neon, harmonic), harmonic",
            "query": q, "duration": T + 10, "sample_every": 60, "stall": 300, "snapshots": [], "dpr": 2,
            "shots": [{"t": T, "name": "dish_neon"}, {"t": T + 4, "name": "zoom_neon"}, {"t": T + 6, "name": "zoom_harm"}, {"t": T + 8, "name": "dish_harm"}],
            "evals": list(extra) + [{"t": T - 1, "js": SHAPE}, {"t": T + 3, "js": zoom_at(*z)}, {"t": T + 5, "js": HARM}, {"t": T + 7, "js": FIT}]}


write('pics', {"batch": "s1-pics", "seeds": [3], "runs": [
    pics('default', WILD, 300, (0.45, 0.45, 3.5)),
    pics('spindles', {}, 300, (0.45, 0.45, 3.5), extra=[{"t": 2, "js": SPIN}]),
    pics('lab', {"preset": "lab", "cells": 150, "genes": "elongation:1.2"}, 240, (0.5, 0.5, 2.5)),
    pics('chip', {"preset": "chip", **WILD}, 300, (0.25, 0.5, 3.5)),
    pics('crevices', {"preset": "crevices", **WILD}, 300, (0.42, 0.68, 3.5)),
    pics('colonies', {"preset": "colonies"}, 300, (0.5, 0.5, 2.5)),
]})

# ---- speed ----
g0 = json.load(open(os.path.join(HERE, '..', 'g0b', 'speed-after.json'), encoding='utf-8'))
runs = []
for r in g0['runs']:
    if '-r1' not in r['name'] or 'speedobs' in r['name']:
        continue
    base = r['name'].replace('g0b-speed', 's1-speed').replace('-r1', '')
    runs.append(dict(r, name=base + '-on', description=r['description'].replace('after G0b, nothing painted', 'after S1, shape on (founders round)')))
    runs.append(dict(r, name=base + '-off', description=r['description'].replace('after G0b, nothing painted', 'after S1, ?shape=0'),
                     query={**r['query'], 'shape': 0}))
    if '2k-neon' in r['name']:
        runs.append(dict(r, name=base + '-spindles', description=r['description'].replace('after G0b, nothing painted', 'after S1, every cell asks 3:1'),
                         evals=[{"t": 0, "js": SPIN}]))
write('speed-after', {"batch": "s1-speed", "runs": runs})
print('ok')
