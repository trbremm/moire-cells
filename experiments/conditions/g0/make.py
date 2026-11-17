"""Step G0 (strong glue, junctions that break, cells stir the water): conditions. python experiments/conditions/g0/make.py
  speed-after   as F0's speed (headless Chrome 1280 x 800, default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s; neon and harmonic,
                two runs each), after G0 (the GPU may be shared with another worker's runs)
  quick         the quick experiments (the user: results not valid until more changes land): default scene, Fronts, Chip, colonies; glue on
                vs its neutral control (?gluenull=1), 20 min, seeds 3 and 7; samples every 30 s, pictures at the end
  pics          pictures: neon + harmonic, the stirred water's streamlines (machinery view), a close zoom of a torn junction
  check         the books (atoms and charge rounding 0) with every G0 switch toggled, squeeze, press, perfusion, a snapshot save and load
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


# ---- speed ----
f0 = json.load(open(os.path.join(HERE, '..', 'f0', 'speed-after.json'), encoding='utf-8'))
runs = []
for r in f0['runs']:
    if r['name'].endswith('-r3'):
        continue
    runs.append(dict(r, name=r['name'].replace('f0-speedpost', 'g0-speed'), description=r['description'].replace('step F0 speed, after', 'step G0 speed, after G0')))
write('speed-after', {"batch": "g0-speed", "runs": runs})

# ---- the glue's and the water's census ----
GLUE = "const g = moire.glue.census, s = moire.stir.census; return JSON.stringify({glue: g, stir: s, alive: moire.cells.alive})"
# zoom on a torn junction: a cell with a torn side (Cell word 8, bits 0..5) near the middle of the live cells, camera x8 on it
TORN = ("const { readBuffer } = await import('./src/snapshot.js'); const C = moire.cells, n = C.count, F = 92; "
        "const ab = await readBuffer(C.device, C.cellBuf, 0, n * F * 4); const f = new Float32Array(ab), u = new Uint32Array(ab); "
        "let best = null, bn = -1; for (let i = 0; i < n; i++) { const o = i * F; if (!(u[o + 9] & 1) || !(u[o + 8] & 63)) continue; "
        "let k = 0; for (let j = 0; j < n; j += 2) { const q = j * F; if ((u[q + 9] & 1) && Math.hypot(f[q] - f[o], f[q + 1] - f[o + 1]) < 3 * C.R) k++; } "
        "if (k > bn) { bn = k; best = [f[o], f[o + 1]]; } } if (best) moire.camera.set(8, best[0], best[1]); return JSON.stringify({best, bn})")
HARM = "moire.control.action('harmonic'); return 'harmonic toggled'"
FIT = "moire.camera.fit(); return 'fit'"

SCENES = [('default', {}), ('fronts', {"preset": "fronts"}), ('chip', {"preset": "chip"}), ('colonies', {"preset": "colonies"})]
quick = []
for name, q in SCENES:
    for tag, extra in (('on', {}), ('null', {"gluenull": 1})):
        quick.append({"name": f"g0-{name}-{tag}", "description": f"step G0 quick: {name}, glue {tag}, 20 min",
                      "query": dict(q, **extra), "duration": 1200, "sample_every": 30, "stall": 300, "snapshots": [],
                      "shots": [{"t": 600, "name": "t600"}, {"t": 1200, "name": "end"}, {"t": 1200, "view": "machinery", "name": "end_mach"}],
                      "evals": [{"t": t, "js": GLUE} for t in (60, 300, 600, 900, 1199)]})
write('quick', {"batch": "g0-quick", "runs": quick, "seeds": [3, 7]})


def pics(name, q, T, zoom=TORN):
    return {"name": f"g0-pics-{name}", "description": f"step G0 pictures: {name}, at {T} s: neon, the stirred streamlines, a torn junction close up, harmonic",
            "query": q, "duration": T + 10, "sample_every": 60, "stall": 300, "snapshots": [], "dpr": 2,
            "shots": [{"t": T, "name": "dish_neon"}, {"t": T + 2, "view": "machinery", "name": "dish_mach"}, {"t": T + 4, "name": "tear_neon"},
                      {"t": T + 6, "name": "tear_harm"}, {"t": T + 8, "name": "dish_harm"}],
            "evals": [{"t": T + 3, "js": zoom}, {"t": T + 5, "js": HARM}, {"t": T + 7, "js": FIT}]}


write('pics', {"batch": "g0-pics", "runs": [pics(n, q, 300) for n, q in SCENES], "seeds": [3]})

# ---- the books ----
SW = lambda p, k, v: f"moire.{p}.params.{k} = {json.dumps(v)}; return '{p}.{k} {v}'"
write('check', {
    "name": "g0-check", "description": "step G0 books check: 400 s at MAX (seed 5), whole dish lit, perfusion on; every G0 switch off and on again "
    "(stir, split, ceiling, cost, breaks, null), a squeeze 0.8 and a stretch 1.25, the press, a resize, a snapshot saved and loaded: atoms and "
    "charge rounding must stay 0",
    "query": {"seed": 5, "light": "full", "perfusion": 1}, "duration": 400, "sample_every": 10, "stall": 300, "snapshots": [],
    "resizes": [{"t": 300, "size": "1000x700"}, {"t": 330, "size": "1280x800"}],
    "shots": [{"t": 400, "panel": True, "name": "panel"}, {"t": 200, "view": "machinery", "name": "mach"}],
    "evals": [{"t": 30, "js": SW('stir', 'on', False)}, {"t": 50, "js": SW('stir', 'on', True)},
              {"t": 60, "js": SW('stir', 'split', False)}, {"t": 80, "js": SW('stir', 'split', True)},
              {"t": 90, "js": SW('glue', 'ceiling', False)}, {"t": 110, "js": SW('glue', 'ceiling', True)},
              {"t": 120, "js": SW('glue', 'tear', False)}, {"t": 140, "js": SW('glue', 'tear', True)},
              {"t": 150, "js": SW('glue', 'null', True)}, {"t": 170, "js": SW('glue', 'null', False)},
              {"t": 175, "js": SW('glue', 'cost', False)}, {"t": 185, "js": SW('glue', 'cost', True)},
              {"t": 210, "js": "await moire.dish.scale(0.8); return 'squeezed'"}, {"t": 240, "js": "await moire.dish.scale(1.25); return 'stretched'"},
              {"t": 250, "js": "Object.assign(moire.dish.press, { on: true, depth: 0.3, period: 60 }); return 'press on'"},
              {"t": 360, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return JSON.stringify({ exact: r.exact, notes: r.notes, rounding: r.rounding })"}]
             + [{"t": t, "js": GLUE} for t in (100, 200, 399)],
})
write('check-press', {
    "name": "g0-check-press", "description": "step G0 books with the press: the Fronts preset 300 s at MAX (seed 5)",
    "query": {"seed": 5, "preset": "fronts"}, "duration": 300, "sample_every": 10, "stall": 300, "snapshots": [],
    "shots": [{"t": 150, "view": "machinery", "name": "mach"}, {"t": 300, "panel": True, "name": "panel"}],
    "evals": [{"t": t, "js": GLUE} for t in (60, 150, 299)],
})
print('ok')
