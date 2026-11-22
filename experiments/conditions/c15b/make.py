"""Step C15b conditions: cells eat carbon (README "Step C15b: cells eat carbon"; EXPERIMENTS.md "Cells eat carbon").

python experiments/conditions/c15b/make.py   -> watch-on.json, watch-off.json, speed.json, pictures.json in this folder

watch-on / watch-off are the full plan (20 min, two seeds). The GPU was shared with another worker's two runs, so the runs actually made are
run-A.json (carbon on) and run-B.json (?carbon=0): the same conditions trimmed to 10 min (the default scene, seed 3, kept at 20 min), seed 7
only for the default scene and the whole-dish oxygen run, ?carbon=0 for seed 3 only (cut from watch-*.json by hand; the conditions' words
are the same). Those runs (before GROWTH NEEDS CARBON was built) were then kept as experiments/runs/c15b-v1-*; the runs with it are
run-A2.json and run-B2.json (the same conditions, plus ?cbfounder=1 and ?cbgrow=0 on the default scene, seed 3). surf.json: the substrate
alone (one cell), the tar's surface size 0 / 1 / 0.1. grow-smoke.json, smoke.json, ab.json, pilot.json, merge.json: checks.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
PROBE = ("const L = moire.carbon.ledger, C = moire.carbonCells.ledger, H = moire.heat.ledger; return JSON.stringify({t: moire.time(), "
         "alive: moire.cells.alive, job: moire.cells.stats && moire.cells.stats.job, "
         "ladder: L && L.ladder, tar: L && L.tar, dishC: L && L.dish.c, cellsC: L && L.cells.c, rx: L && L.rx, "
         "cells: C && {rate: C.rate, census: C.census, granC: C.granC, ladder: C.ladder}, "
         "rounding: L && L.rounding, eRounding: L && L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding, eIn: H.in, "
         "freeT: moire.matter.dish[1], engines: moire.eat.census && moire.eat.census.all.map(c => c.n)})")
SPOT_VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"


def watch(name, desc, query, dur=1200, oxygen=False):
    evals = []
    if oxygen:   # the oxygen conditions (step M1's): a lasting mineral spring and a vent dripping 2 s every 20 s (no free-atom spring)
        evals.append({"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); " + SPOT_VENT})
        evals += [{"t": t, "js": SPOT_VENT} for t in range(20, dur, 20)]
    evals += [{"t": t, "js": PROBE} for t in (300, 600, 900, dur)]
    evals.append({"t": dur + 1, "js": HARM_ON})
    shots = [{"t": 300}, {"t": 600}, {"t": dur}, {"t": dur, "panel": True, "name": "panel"}, {"t": dur + 2, "name": "harmonic"}]
    return {"name": name, "description": desc, "query": query, "duration": dur + 2.5, "sample_every": 30, "stall": 300,
            "shots": shots, "snapshots": [{"t": dur, "grid": True}], "evals": evals}


CONDS = [
    ("default", "default scene (spotlight, mineral spring, vent, a lasting fuel seep)", {}, False),
    ("vent-dark", "Deep vents preset, total darkness", {"preset": "vent"}, False),
    ("vent-dim", "Deep vents preset, a dim light from above (&light=full)", {"preset": "vent", "light": "full"}, False),
    ("oxy-spot", "oxygen conditions (lasting mineral spring, a vent dripping 2 s in 20, spotlight)", {}, True),
    ("oxy-full", "oxygen conditions, the whole dish lit", {"light": "full"}, True),
]
on = {"batch": "c15b-watch-on", "runs": []}
off = {"batch": "c15b-watch-off", "runs": []}
for seed in (3, 7):
    for key, desc, q, oxy in CONDS:
        on["runs"].append(watch(f"c15b-{key}_s{seed}", f"{desc}, carbon on, seed {seed}, 20 min", {"seed": seed, **q}, oxygen=oxy))
        if seed == 3:
            off["runs"].append(watch(f"c15b-{key}-off_s{seed}", f"{desc}, ?carbon=0 (the chemistry before C15a), seed {seed}, 20 min",
                                     {"seed": seed, "carbon": 0, **q}, oxygen=oxy))
json.dump(on, open(os.path.join(HERE, "watch-on.json"), "w"), indent=1)
json.dump(off, open(os.path.join(HERE, "watch-off.json"), "w"), indent=1)

# speed: the default scene at 2000 cells, carbon on against ?carbon=0, twice each (the GPU is shared with another worker)
speed = {"batch": "c15b-speed", "runs": []}
for r in (1, 2):
    for o in (True, False):
        q = {"seed": 3} if o else {"seed": 3, "carbon": 0}
        speed["runs"].append({"name": f"c15b-speed-2k-{'on' if o else 'off'}-r{r}", "description": f"speed, default scene, 2000 cells, carbon {'on' if o else 'off'}, 150 s",
                              "query": q, "duration": 150, "sample_every": 25, "shots": [], "snapshots": [], "evals": []})
json.dump(speed, open(os.path.join(HERE, "speed.json"), "w"), indent=1)
print("wrote watch-on.json, watch-off.json, speed.json")

# ---------- pictures: from the watch runs' snapshots at 20 min, close-ups through the app's camera (zoom x4), neon and harmonic ----------
# PICK_GRAN: the place where the cells hold the most granule carbon (within 30 CSS px); PICK_TAR: where the dish holds the most tar near a
# cell (the tar lying under or beside a colony); both into window.__pk[name]
READ = ("const d = moire.gpu.device; const rb = async (buf, off, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
        "const e = d.createCommandEncoder(); e.copyBufferToBuffer(buf, off, b, 0, size); d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); "
        "const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; }; window.__pk = window.__pk || {}; ")
CELLS = ("const C = moire.cells, n = C.count, CF = C.cellBuf.size / 4 / n; const cf = new Float32Array(await rb(C.cellBuf, 0, n * CF * 4)), "
         "cu = new Uint32Array(cf.buffer); const pts = []; ")
PICK_GRAN = (READ + CELLS + "const cb = new Int32Array(await rb(moire.carbonCells.buf, 0, n * 16 * 4)); "
             "for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; const g = (2 * cb[i * 16 + 5] + cb[i * 16 + 6] + cb[i * 16 + 7]) / 4; "
             "if (g > 0) pts.push([cf[i * CF], cf[i * CF + 1], g]); } let best = null, bv = 0; "
             "for (const p of pts) { let v = 0; for (const q of pts) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 900) v += q[2]; if (v > bv) { bv = v; best = p; } } "
             "window.__pk.gran = best ? [best[0], best[1]] : [640, 400]; return JSON.stringify({gran: window.__pk.gran, v: bv / 4096, cells: pts.length})")
PICK_TAR = (READ + CELLS + "const H = moire.heat, Cb = moire.matter.carbon, LW = 43776, N = H.n; "
            "const t = new Int32Array(await rb(H.buffer, (LW + Cb.tarBase()) * 4, 3 * N * 4)); "
            "for (let i = 0; i < n; i++) if (cu[i * CF + 9] & 1) pts.push([cf[i * CF], cf[i * CF + 1]]); "
            "let best = null, bv = 0; for (let y = 2; y < H.hh - 2; y++) for (let x = 2; x < H.hw - 2; x++) { let v = 0; "
            "for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * H.hw + x + dx; v += 2 * t[j] + t[N + j] + t[2 * N + j]; } "
            "if (v > bv) { const px = (x + 0.5) * H.px, py = (y + 0.5) * H.px; if (pts.some((p) => (p[0] - px) ** 2 + (p[1] - py) ** 2 < 1600)) { bv = v; best = [px, py]; } } } "
            "window.__pk.tar = best || [640, 400]; return JSON.stringify({tar: window.__pk.tar, v: bv / 4 / 4096})")


def pictures(name, desc, snap, picks):
    evals, shots, t = [], [{"t": 1, "name": "dish"}], 1.5
    evals.append({"t": 1.2, "js": HARM_ON})
    shots.append({"t": 1.3, "name": "dish_harmonic"})
    evals.append({"t": 1.4, "js": HARM_ON})
    for label, js in picks:
        evals.append({"t": t, "js": js})
        evals.append({"t": t + 0.1, "js": f"moire.camera.set(4, ...window.__pk['{label}']); return 'zoom {label}'"})
        shots.append({"t": t + 0.3, "name": f"zoom_{label}"})
        evals.append({"t": t + 0.4, "js": HARM_ON})
        shots.append({"t": t + 0.6, "name": f"zoom_{label}_harmonic"})
        evals.append({"t": t + 0.7, "js": HARM_ON})
        evals.append({"t": t + 0.8, "js": "moire.camera.fit(); return 'unzoomed'"})
        t += 1.5
    return {"name": name, "description": desc, "query": {"snap": snap}, "dpr": 2, "duration": t + 0.5, "sample_every": 0, "stall": 300,
            "shots": shots, "snapshots": [], "evals": evals}


pics = {"batch": "c15b-pictures", "runs": []}
for key, at in [("default_s3", 1200), ("default_s7", 600), ("default-cbf_s3", 600), ("oxy-spot_s3", 600), ("oxy-full_s3", 600)]:
    pk = [(p, PICK_GRAN if p == "gran" else PICK_TAR) for p in ("gran", "tar")]
    pics["runs"].append(pictures(f"c15b-pics-{key}", f"close-ups from the {at // 60}-min snapshot of c15b-{key}: the most granules, the most tar by cells",
                                 f"experiments/runs/c15b-{key}/snapshots/snap_t{at}.json", pk))
json.dump(pics, open(os.path.join(HERE, "pictures.json"), "w"), indent=1)
print("wrote pictures.json")
