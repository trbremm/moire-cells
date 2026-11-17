"""Step F0 (fates removed, colour by job): conditions. python experiments/conditions/f0/make.py
  speed-before / speed-after   as P1's speed (headless Chrome 1280 x 800, default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s; neon
                               and harmonic, three runs each), on main before the change (58d1963) and after
  pics                         pictures, the same for before and after (run from a worktree of 58d1963 for 'before'): the default scene,
                               the Sunlit shallows and the colonies preset, whole dish neon and harmonic, a close zoom in both looks
  check                        the books over a run with resizes and a snapshot save and reload (atoms and charge rounding 0)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


# ---- speed ----
p1 = json.load(open(os.path.join(HERE, '..', 'p1', 'speed.json'), encoding='utf-8'))
for tag, desc in (('pre', 'before (main 58d1963)'), ('post', 'after')):
    runs = []
    for r in p1['runs']:
        r = dict(r, name=r['name'].replace('p1-speed', f'f0-speed{tag}'), description=r['description'].replace('step P1 speed', f'step F0 speed, {desc}'))
        runs.append(r)
    write('speed-before' if tag == 'pre' else 'speed-after', {"batch": f"f0-speed{tag}", "runs": runs})

# ---- pictures ----
ZOOM = ("const C = moire.cells, s = moire.light.params.mode === 'spot' ? moire.light.spot() : null; "
        "const cam = moire.camera; let x = s ? s.x : cam.W / 2, y = s ? s.y : cam.H / 2; "
        "return JSON.stringify({x, y, z: cam.set(4, x, y)})")
# (the colonies: zoom on the largest cluster's middle, from a cell read-back)
ZOOMBIG = ("const { readBuffer } = await import('./src/snapshot.js'); const C = moire.cells, n = C.count, F = 92; "
           "const ab = await readBuffer(C.device, C.cellBuf, 0, n * F * 4); "
           "const f = new Float32Array(ab), u = new Uint32Array(ab); let best = null, bn = -1; const R = C.R; "
           "for (let i = 0; i < n; i += 7) { const o = i * F; if (!(u[o + 9] & 1)) continue; let k = 0; "
           "for (let j = 0; j < n; j += 3) { const q = j * F; if ((u[q + 9] & 1) && Math.hypot(f[q] - f[o], f[q + 1] - f[o + 1]) < 8 * R) k++; } "
           "if (k > bn) { bn = k; best = [f[o], f[o + 1]]; } } "
           "if (best) moire.camera.set(4, best[0], best[1]); return JSON.stringify({best, bn})")
HARM = "moire.control.action('harmonic'); return 'harmonic toggled'"
FIT = "moire.camera.fit(); return 'fit'"


def pics(name, q, T, zoom=ZOOM):
    return {"name": f"f0-pics-{name}", "description": f"step F0 pictures: {name}, at {T} s, neon and harmonic, whole dish and a x4 zoom",
            "query": q, "duration": T + 8, "sample_every": 60, "stall": 200, "snapshots": [],
            "shots": [{"t": T, "name": "dish_neon"}, {"t": T + 2, "name": "zoom_neon"}, {"t": T + 4, "name": "zoom_harm"}, {"t": T + 6, "name": "dish_harm"}],
            "evals": [{"t": T + 1, "js": zoom}, {"t": T + 3, "js": HARM}, {"t": T + 5, "js": FIT}], "dpr": 2}


write('pics', {"batch": "f0-pics", "runs": [
    pics('default', {}, 300),
    pics('shallows', {"preset": "shallows"}, 300),
    pics('colonies', {"preset": "colonies"}, 480, ZOOMBIG),
], "seeds": [3]})
print('ok')

# ---- the books, old snapshots, the lab and the designed tissues ----
JOBS = ("const s = moire.cells.stats; return JSON.stringify({t: s && s.time, job: s && s.job, alive: moire.cells.alive})")
SPR = ("const v = moire.control.view(); moire.matter.addSpring(v.cssW * 0.3, v.cssH * 0.35, 'soap', 120); "
       "moire.matter.addSpring(v.cssW * 0.5, v.cssH * 0.5, 'oil', 120); moire.matter.addSpring(v.cssW * 0.4, v.cssH * 0.6, 'light', 1e9); "
       "moire.matter.addSpring(v.cssW * 0.6, v.cssH * 0.6, 'heavy', 1e9); return moire.matter.springs.map(s => s.kind)")
write('check', {
    "name": "f0-check", "description": "step F0 books check: 330 s at MAX (seed 5), the whole dish lit, springs; resizes at 60 s and 120 s, 20 predators "
    "at 90 s, the three designed tissues placed at 100 s, wild genomes (G) at 150 s, key M off and on, turnover mode and back, a snapshot saved and "
    "loaded at 280 s: atoms and charge rounding must stay 0; the job census every 30 s",
    "query": {"seed": 5, "light": "full"}, "duration": 330, "sample_every": 10, "stall": 200, "snapshots": [],
    "resizes": [{"t": 60, "size": "1000x700"}, {"t": 120, "size": "1280x800"}],
    "shots": [{"t": 330, "panel": True, "name": "panel"}, {"t": 200, "name": "mid"}],
    "evals": [{"t": 5, "js": SPR}, {"t": 90, "js": "return await moire.predators.place(20)"},
              {"t": 100, "js": "const v = moire.control.view(); const out = []; for (const [k, n] of [['plant', 0.3], ['filament', 0.5], ['biofilm', 0.7]]) "
                               "out.push(await moire.tissues.place(k, { x: v.cssW * n, y: v.cssH * 0.5, n: 30 })); return JSON.stringify(out)"},
              {"t": 150, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
              {"t": 185, "js": "moire.genome.rules.mut = false; return 'key M off'"},
              {"t": 200, "js": "moire.genome.rules.mut = true; return 'key M on'"},
              {"t": 220, "js": "moire.division.params.on = false; return 'turnover mode'"},
              {"t": 250, "js": "moire.division.params.on = true; return 'division mode'"},
              {"t": 280, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); return { exact: r.exact, notes: r.notes, rounding: r.rounding }"}]
             + [{"t": t, "js": JOBS} for t in (30, 60, 120, 180, 240, 300, 329)],
})
write('reload', {"batch": "f0-reload", "runs": [
    {"name": "f0-reload-tissue", "description": "an old tissue-lab snapshot (C11, fates in its genomes and rules) loads and runs 40 s",
     "query": {"snap": "experiments/tissue/configs/c11-end-lb-t1/snapshot.json"}, "duration": 40, "sample_every": 10, "stall": 200,
     "snapshots": [], "shots": [{"t": 2, "name": "t2"}, {"t": 40, "name": "t40"}], "evals": [{"t": 1, "js": JOBS}, {"t": 39, "js": JOBS}]},
    {"name": "f0-reload-p1", "description": "a P1 snapshot (colonies, 20 min; cells with fates) loads and runs 60 s",
     "query": {"snap": "experiments/runs/p1-col-on_s3/snapshots/snap_t1200.json"}, "duration": 60, "sample_every": 10, "stall": 200,
     "snapshots": [], "shots": [{"t": 1, "name": "t1"}, {"t": 60, "name": "t60"}], "evals": [{"t": 0.5, "js": JOBS}, {"t": 59, "js": JOBS}]},
    {"name": "f0-lab", "description": "the Tissue lab preset, 120 s", "query": {"preset": "lab"}, "duration": 120, "sample_every": 20, "stall": 200,
     "snapshots": [], "shots": [{"t": 120, "name": "lab"}], "evals": [{"t": 119, "js": JOBS}]},
    {"name": "f0-tissues", "description": "the three designed tissues placed in an empty-ish dish (default scene, 60 cells) at 2 s, 120 s",
     "query": {"cells": 60}, "duration": 120, "sample_every": 20, "stall": 200, "snapshots": [],
     "shots": [{"t": 120, "name": "tissues"}],
     "evals": [{"t": 2, "js": "const v = moire.control.view(); const out = []; for (const [k, n] of [['plant', 0.25], ['filament', 0.5], ['biofilm', 0.75]]) "
                              "out.push(await moire.tissues.place(k, { x: v.cssW * n, y: v.cssH * 0.5, n: 40 })); return JSON.stringify(out)"},
               {"t": 119, "js": JOBS}]},
]})
print('ok checks')
