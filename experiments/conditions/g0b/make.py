"""Step G0b (obstacles): conditions. python experiments/conditions/g0b/make.py
  check         the books (atoms and charge rounding 0) while obstacles are painted over the culture and its springs, erased, undone, switched
                off and on, cleared, the dish made round, with perfusion (the through-flow solved round them), a squeeze and a stretch, a resize,
                a snapshot saved and loaded
  quick         the quick watch (the user: results not final): Chip and Crevices, 10 min, seeds 3 and 7; Fronts with three blocks in the strip,
                10 min, seeds 3 and 7; the obstacles' measure (matter and cells near edges, in the dead zones, in the open) at 60, 300, 599 s
  pics          pictures at 300 s: neon, harmonic, the machinery view (streamlines) and a close zoom; Chip, Crevices, Maze, Fronts with blocks,
                the default scene in a round dish
  speed-after   as G0's (headless Chrome 1280 x 800, default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s; neon and harmonic, two runs
                each), nothing painted; plus 2000 and 10 000 with a pillar field painted at the start (the GPU may be shared)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


MEASURE = "const m = await moire.obstacles.measure(); return JSON.stringify(m)"
HARM = "moire.control.action('harmonic'); return 'harmonic toggled'"
FIT = "moire.camera.fit(); return 'fit'"
# Fronts with three blocks in the strip (painted at the start: the press's front meets them)
FRONT_BLOCKS = ("const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; "
                "O.rect(0.3 * W, 0.2 * H, 10 * R, 22 * R, 'solid', R); O.rect(0.5 * W, 0.55 * H, 10 * R, 22 * R, 'solid', R); "
                "O.circle(0.68 * W, 0.4 * H, 9 * R); return 'blocks'")
# the default scene: obstacles over the colony and its springs (matter is under them: it must be pushed out, exactly)
PAINT = ("const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; "
         "O.line(0.5 * W, 0.05 * H, 0.5 * W, 0.95 * H, 2 * R); O.rect(0.55 * W, 0.3 * H, 30 * R, 20 * R, 'solid', R); "
         "O.pillars(0.15 * W, 0.2 * H, 0.35 * W, 0.8 * H, 2.5 * R, 9 * R); O.circle(0.6 * W, 0.7 * H, 8 * R, 'porous'); "
         "for (const s of moire.matter.springs) O.circle(s.x, s.y, 3 * R); return `painted ${O.shapes.length}`")
SW = lambda k, v: f"moire.obstacles.params.{k} = {json.dumps(v)}; return 'obstacles.{k} {v}'"

write('check', {
    "name": "g0b-check", "description": "step G0b books check: 420 s at MAX (seed 5), whole dish lit, perfusion on; obstacles painted over the "
    "culture and its springs (matter pushed out), erased, undone, switched off and on, the through-flow's solve off and on, cleared, a round "
    "dish, pillars again, a squeeze 0.8 and a stretch 1.25, a resize, a snapshot saved and loaded: atoms and charge rounding must stay 0",
    "query": {"seed": 5, "light": "full", "perfusion": 1}, "duration": 420, "sample_every": 10, "stall": 300, "snapshots": [],
    "resizes": [{"t": 300, "size": "1000x700"}, {"t": 330, "size": "1280x800"}],
    "shots": [{"t": 40, "name": "painted"}, {"t": 60, "view": "machinery", "name": "mach"}, {"t": 180, "name": "round"}, {"t": 420, "panel": True, "name": "panel"}],
    "evals": [{"t": 20, "js": PAINT}, {"t": 45, "js": MEASURE},
              {"t": 70, "js": "const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; O.erase(0.5 * W, 0.4 * H, 0.5 * W, 0.6 * H, 3 * R); return 'erased'"},
              {"t": 90, "js": "return moire.obstacles.undo()"},
              {"t": 100, "js": SW('on', False)}, {"t": 115, "js": SW('on', True)},
              {"t": 120, "js": SW('flow', False)}, {"t": 135, "js": SW('flow', True)},
              {"t": 150, "js": "moire.obstacles.clear(); return moire.obstacles.setRound(true)"},
              {"t": 160, "js": "const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; O.pillars(0.3 * W, 0.3 * H, 0.7 * W, 0.7 * H, 2 * R, 8 * R); return `pillars ${O.shapes.length}`"},
              {"t": 200, "js": "await moire.dish.scale(0.8); return 'squeezed'"}, {"t": 240, "js": "await moire.dish.scale(1.25); return 'stretched'"},
              {"t": 260, "js": "moire.obstacles.setRound(false); const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; O.line(0.2 * W, 0.5 * H, 0.8 * W, 0.5 * H, 3 * R); return 'square, a wall'"},
              {"t": 360, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return JSON.stringify({ exact: r.exact, notes: r.notes, rounding: r.rounding, shapes: (S.obstacles || {}).shapes.length })"},
              {"t": 419, "js": MEASURE}],
})

quick = []
for name, q, extra in (('chip', {"preset": "chip"}, []), ('crevices', {"preset": "crevices"}, []),
                       ('fronts', {"preset": "fronts"}, [{"t": 0, "js": FRONT_BLOCKS}])):
    quick.append({"name": f"g0b-{name}", "description": f"step G0b quick: {name}, 10 min",
                  "query": q, "duration": 600, "sample_every": 30, "stall": 300, "snapshots": [],
                  "shots": [{"t": 300, "name": "t300"}, {"t": 600, "name": "end"}, {"t": 600, "view": "machinery", "name": "end_mach"}],
                  "evals": extra + [{"t": t, "js": MEASURE} for t in (60, 300, 599)]})
write('quick', {"batch": "g0b-quick", "runs": quick, "seeds": [3, 7]})


def zoom_at(fx, fy, z):
    return f"moire.camera.set({z}, {fx} * moire.dish.W, {fy} * moire.dish.H); return 'zoom'"


def pics(name, q, T, z, extra=()):
    return {"name": f"g0b-pics-{name}", "description": f"step G0b pictures: {name}, at {T} s: neon, the machinery view, a close zoom, harmonic",
            "query": q, "duration": T + 10, "sample_every": 60, "stall": 300, "snapshots": [], "dpr": 2,
            "shots": [{"t": T, "name": "dish_neon"}, {"t": T + 2, "view": "machinery", "name": "dish_mach"}, {"t": T + 4, "name": "zoom_neon"},
                      {"t": T + 6, "name": "zoom_harm"}, {"t": T + 8, "name": "dish_harm"}],
            "evals": list(extra) + [{"t": T + 3, "js": zoom_at(*z)}, {"t": T + 5, "js": HARM}, {"t": T + 7, "js": FIT}]}


write('pics', {"batch": "g0b-pics", "seeds": [3], "runs": [
    pics('chip', {"preset": "chip"}, 300, (0.25, 0.5, 3.5)),   # (the front at the pillars' leading edge at 300 s)
    pics('crevices', {"preset": "crevices"}, 300, (0.42, 0.68, 3.5)),
    pics('maze', {"preset": "maze"}, 300, (0.5, 0.5, 2.5)),
    pics('fronts', {"preset": "fronts"}, 300, (0.5, 0.6, 3), extra=[{"t": 0, "js": FRONT_BLOCKS}]),
    pics('round', {"dish": "round", "light": "full"}, 300, (0.5, 0.5, 3)),
]})

# ---- speed ----
g0 = json.load(open(os.path.join(HERE, '..', 'g0', 'speed-after.json'), encoding='utf-8'))
runs = [dict(r, name=r['name'].replace('g0-speed', 'g0b-speed'), description=r['description'].replace('after G0', 'after G0b, nothing painted'))
        for r in g0['runs']]
PILLARS = ("const O = moire.obstacles, W = moire.dish.W, H = moire.dish.H, R = moire.dish.R; "
           "O.pillars(0.1 * W, 0.1 * H, 0.9 * W, 0.9 * H, 2 * R, 14 * R); return `pillars ${O.shapes.length}`")
for r in g0['runs']:
    if r['name'].endswith('-r1') and 'neon' in r['name']:
        runs.append(dict(r, name=r['name'].replace('g0-speed', 'g0b-speedobs').replace('-r1', ''),
                         description=r['description'].replace('after G0', 'after G0b, a pillar field painted at the start'),
                         evals=[{"t": 0, "js": PILLARS}]))
write('speed-after', {"batch": "g0b-speed", "runs": runs})
print('ok')
