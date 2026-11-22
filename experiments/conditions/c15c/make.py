"""Step C15c conditions: carbon makes the cell (README "Step C15c: carbon makes the cell"; EXPERIMENTS.md "Carbon makes the cell").

python experiments/conditions/c15c/make.py   -> smoke.json, watch-on.json, watch-off.json, pictures.json in this folder

smoke: the default scene 90 s with carbon making the cell, ?cblip=0 (step C15b plus the step's fixes) and ?carbon=0, books checked.
watch-on / watch-off: the scenes the step was asked to watch (default, shallows, oxygen spotlight and whole dish, colonies of wild founders,
Deep vents with a dim light), carbon on against ?carbon=0, 20 minutes, two seeds where the GPU allows (it is shared with another worker).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
PROBE = ("const L = moire.carbon && moire.carbon.ledger, C = moire.carbonCells && moire.carbonCells.ledger, H = moire.heat.ledger, "
         "CC = moire.carbonCells; return JSON.stringify({t: moire.time(), alive: moire.cells.alive, "
         "job: moire.cells.stats && moire.cells.stats.job, ladder: L && L.ladder, tar: L && L.tar, dishC: L && L.dish.c, "
         "cellsC: L && L.cells.c, cells: C && {rate: C.rate, census: C.census, granC: C.granC, ladder: C.ladder}, "
         "parts: CC && CC.census2, rate2: CC && CC.rate2, memb: moire.membrane && moire.membrane.census && {integ: moire.membrane.census.integ}, "
         "cRound: L && L.rounding, eRound: L && L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding, eIn: H.in, freeT: moire.matter.dish[1]})")
SPOT_VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"


def run(name, desc, query, dur, probes, shots=None, oxygen=False, snap=False, harmonic=False):
    evals = []
    if oxygen:   # the oxygen conditions (step M1's): a lasting mineral spring and a vent dripping 2 s every 20 s (no free-atom spring)
        evals.append({"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); " + SPOT_VENT})
        evals += [{"t": t, "js": SPOT_VENT} for t in range(20, dur, 20)]
    evals += [{"t": t, "js": PROBE} for t in probes]
    sh = shots if shots is not None else [{"t": dur, "name": "end"}]
    if harmonic:
        evals.append({"t": dur + 1, "js": HARM_ON})
        sh = sh + [{"t": dur + 2, "name": "harmonic"}]
    return {"name": name, "description": desc, "query": query, "duration": dur + (2.5 if harmonic else 0), "sample_every": 30, "stall": 300,
            "shots": sh, "snapshots": [{"t": dur, "grid": True}] if snap else [], "evals": evals}


smoke = {"batch": "c15c-smoke", "runs": [
    run("c15c-smoke", "smoke: default scene 90 s, carbon makes the cell", {"seed": 3}, 90, (5, 30, 60, 90)),
    run("c15c-smoke-lip0", "smoke: ?cblip=0 (step C15b + the fixes) 60 s", {"seed": 3, "cblip": 0}, 60, (30, 60)),
    run("c15c-smoke-off", "smoke: ?carbon=0 30 s", {"seed": 3, "carbon": 0}, 30, (30,)),
]}
json.dump(smoke, open(os.path.join(HERE, "smoke.json"), "w"), indent=1)

CONDS = [
    ("default", "default scene (spotlight, mineral spring, vent, a lasting fuel seep)", {}, False),
    ("shallows", "Sunlit shallows preset", {"preset": "shallows"}, False),
    ("oxy-spot", "oxygen conditions (lasting mineral spring, a vent dripping 2 s in 20, spotlight)", {}, True),
    ("oxy-full", "oxygen conditions, the whole dish lit", {"light": "full"}, True),
    ("colonies", "colonies preset (five wild founders' colonies)", {"preset": "colonies", "founders": "wild"}, False),
    ("vent-dim", "Deep vents preset, a dim light from above (&light=full)", {"preset": "vent", "light": "full"}, False),
]
DUR = 1200
SHOTS = [{"t": 300}, {"t": 600}, {"t": DUR}, {"t": DUR, "panel": True, "name": "panel"}]
on = {"batch": "c15c-watch-on", "runs": []}
off = {"batch": "c15c-watch-off", "runs": []}
for seed in (3, 7):
    for key, desc, q, oxy in CONDS:
        on["runs"].append(run(f"c15c-{key}_s{seed}", f"{desc}, carbon makes the cell, seed {seed}, 20 min", {"seed": seed, **q}, DUR,
                              (60, 300, 600, 900, DUR), SHOTS, oxygen=oxy, snap=True, harmonic=True))
        off["runs"].append(run(f"c15c-{key}-off_s{seed}", f"{desc}, ?carbon=0 (the chemistry before C15a), seed {seed}, 20 min",
                               {"seed": seed, "carbon": 0, **q}, DUR, (60, 300, 600, 900, DUR), SHOTS, oxygen=oxy))
json.dump(on, open(os.path.join(HERE, "watch-on.json"), "w"), indent=1)
json.dump(off, open(os.path.join(HERE, "watch-off.json"), "w"), indent=1)
print("wrote smoke.json, watch-on.json, watch-off.json")

# ---------- pictures: from the watch runs' snapshots at 20 min, close-ups through the app's camera (zoom x4), neon and harmonic ----------
READ = ("const d = moire.gpu.device; const rb = async (buf, off, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
        "const e = d.createCommandEncoder(); e.copyBufferToBuffer(buf, off, b, 0, size); d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); "
        "const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; }; window.__pk = window.__pk || {}; ")
CELLS = ("const C = moire.cells, n = C.count, CF = C.cellBuf.size / 4 / n; const cf = new Float32Array(await rb(C.cellBuf, 0, n * CF * 4)), "
         "cu = new Uint32Array(cf.buffer); const pts = []; ")
# a cell's score from its stock words (SW 64 a cell): the bilayer (soap1, soap2, oil: words 32..49) or the wall (50..61); the granules from
# the carbon buffer (24 words a cell)
def pick_stock(label, w0, w1):
    return (READ + CELLS + "const st = new Int32Array(await rb(moire.eat.stockBuf, 0, n * 64 * 4)); "
            f"for (let i = 0; i < n; i++) {{ if (!(cu[i * CF + 9] & 1)) continue; let g = 0; for (let w = {w0}; w < {w1}; w++) g += Math.max(st[i * 64 + w], 0); "
            "if (g > 0) pts.push([cf[i * CF], cf[i * CF + 1], g]); } let best = null, bv = 0; "
            "for (const p of pts) { let v = 0; for (const q of pts) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 900) v += q[2]; if (v > bv) { bv = v; best = p; } } "
            f"window.__pk.{label} = best ? [best[0], best[1]] : [640, 400]; return JSON.stringify({{{label}: window.__pk.{label}, v: bv / 4096, cells: pts.length}})")
PICK_GRAN = (READ + CELLS + "const cb = new Int32Array(await rb(moire.carbonCells.buf, 0, n * 24 * 4)); "
             "for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; const g = (2 * cb[i * 24 + 5] + cb[i * 24 + 6] + cb[i * 24 + 7]) / 4; "
             "if (g > 0) pts.push([cf[i * CF], cf[i * CF + 1], g]); } let best = null, bv = 0; "
             "for (const p of pts) { let v = 0; for (const q of pts) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 900) v += q[2]; if (v > bv) { bv = v; best = p; } } "
             "window.__pk.gran = best ? [best[0], best[1]] : [640, 400]; return JSON.stringify({gran: window.__pk.gran, v: bv / 4096, cells: pts.length})")
PICK_TAR = (READ + CELLS + "const H = moire.heat, Cb = moire.matter.carbon, LW = 45056, N = H.n; "
            "const t = new Int32Array(await rb(H.buffer, (LW + Cb.tarBase()) * 4, 3 * N * 4)); "
            "for (let i = 0; i < n; i++) if (cu[i * CF + 9] & 1) pts.push([cf[i * CF], cf[i * CF + 1]]); "
            "let best = null, bv = 0; for (let y = 2; y < H.hh - 2; y++) for (let x = 2; x < H.hw - 2; x++) { let v = 0; "
            "for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * H.hw + x + dx; v += 2 * t[j] + t[N + j] + t[2 * N + j]; } "
            "if (v > bv) { const px = (x + 0.5) * H.px, py = (y + 0.5) * H.px; if (pts.some((p) => (p[0] - px) ** 2 + (p[1] - py) ** 2 < 1600)) { bv = v; best = [px, py]; } } } "
            "window.__pk.tar = best || [640, 400]; return JSON.stringify({tar: window.__pk.tar, v: bv / 4 / 4096})")
PICKS = {"memb": pick_stock("memb", 32, 50), "wall": pick_stock("wall", 50, 62), "gran": PICK_GRAN, "tar": PICK_TAR}


def pictures(name, desc, snap, picks):
    evals, shots, t = [], [{"t": 1, "name": "dish"}], 1.5
    evals.append({"t": 1.2, "js": HARM_ON})
    shots.append({"t": 1.3, "name": "dish_harmonic"})
    evals.append({"t": 1.4, "js": HARM_ON})
    for label in picks:
        evals.append({"t": t, "js": PICKS[label]})
        evals.append({"t": t + 0.1, "js": f"moire.camera.set(4, ...window.__pk['{label}']); return 'zoom {label}'"})
        shots.append({"t": t + 0.3, "name": f"zoom_{label}"})
        evals.append({"t": t + 0.4, "js": HARM_ON})
        shots.append({"t": t + 0.6, "name": f"zoom_{label}_harmonic"})
        evals.append({"t": t + 0.7, "js": HARM_ON})
        evals.append({"t": t + 0.8, "js": "moire.camera.fit(); return 'unzoomed'"})
        t += 1.5
    return {"name": name, "description": desc, "query": {"snap": snap}, "dpr": 2, "duration": t + 0.5, "sample_every": 0, "stall": 300,
            "shots": shots, "snapshots": [], "evals": evals}


# (the runs as made: default and shallows 20 min, the others 10 min: stage2A.json, stage2B.json, written by hand from CONDS with D = 600)
pics = {"batch": "c15c-pictures", "runs": []}
for key, at in [("default", 1200), ("shallows", 1200), ("oxy-spot", 600), ("oxy-full", 600)]:   # (colonies and vent-dim: no cells left at 10 min)
    pics["runs"].append(pictures(f"c15c-pics-{key}_s3", f"close-ups from the {at // 60}-min snapshot of c15c-{key}_s3: the most bilayer, wall, granules, tar by cells",
                                 f"experiments/runs/c15c-{key}_s3/snapshots/snap_t{at}.json", ["memb", "wall", "gran", "tar"]))
json.dump(pics, open(os.path.join(HERE, "pictures.json"), "w"), indent=1)
print("wrote pictures.json")
