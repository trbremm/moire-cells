"""Step C15e conditions: carbon life viable (README "Step C15e: carbon life viable"; EXPERIMENTS.md "Carbon life viable").

python experiments/conditions/c15e/make.py   -> the batch files in this folder

diag      which part's carbon holds the default scene down (every C15d fix on, one part's rule off at a time), 10 minutes
ab*       each C15e fix against C15d (its switch off), default scene seed 3 (and the wild colonies), 10 minutes
watch     the scenes the step must make viable, every fix on, against ?carbon=0 at the same seed
The tables: experiments/conditions/c15d/summary.py (the same probe) and watchtable.py here.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
# the probe of step C15d (the flow ledger, the Liebig census, the parts, the books), plus the death causes where the page has them
PROBE = ("const L = moire.carbon && moire.carbon.ledger, CC = moire.carbonCells, H = moire.heat.ledger; "
         "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, job: moire.cells.stats && moire.cells.stats.job, "
         "flow: CC && CC.flow, parts: CC && CC.census2, census: CC && CC.census, "
         "memb: moire.membrane && moire.membrane.census && {integ: moire.membrane.census.integ}, "
         "cRound: L && L.rounding, eRound: L && L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding, eIn: H.in, freeT: moire.matter.dish[1], "
         "freeG: moire.matter.dish[3]})")
# READY: who could divide: alive cells with the battery at divAt (0.6), with the body full (>= 0.995 of its want), both; and grown (r >= 0.9 R)
READY = ("const d = moire.gpu.device; const rb = async (buf, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
         "const e = d.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, b, 0, size); d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); "
         "const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; }; const C = moire.cells, n = C.count, CF = C.cellBuf.size / 4 / n; "
         "const cf = new Float32Array(await rb(C.cellBuf, n * CF * 4)), cu = new Uint32Array(cf.buffer); const CC = moire.eat.carbon; "
         "const cb = new Int32Array(await rb(CC.buf, n * 24 * 4)); const kB = CC.params.kBody, R = C.R; "
         "let alive = 0, bat = 0, body = 0, both = 0, grown = 0, all3 = 0, batSum = 0; const hb = [0,0,0,0,0]; "
         "for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; alive++; const b = cf[i * CF + 16], r = cf[i * CF + 4]; "
         "const want = kB * Math.PI * (r / R) ** 2 * 4096, have = 0.25 * (2 * cb[i * 24 + 8] + cb[i * 24 + 9] + cb[i * 24 + 10]); "
         "const okB = b >= 0.6, okC = !CC.params.growth || have >= 0.995 * want, okR = r >= 0.9 * R; batSum += b; hb[Math.min(4, Math.floor(b * 5))]++; "
         "if (okB) bat++; if (okC) body++; if (okB && okC) both++; if (okR) grown++; if (okB && okC && okR) all3++; } "
         "return JSON.stringify({ready: {alive, bat, body, both, grown, all3, batMean: batSum / Math.max(alive, 1), batHist: hb}})")
# DISH: every substance in the dish and in the cells (units), to see where G, t and the rest sit
DISH = ("const M = moire.matter; return JSON.stringify({dishM: Array.from(M.dish || []).map((x) => Math.round(x * 10) / 10), "
        "cellsM: Array.from((moire.eat && moire.eat.ledger && (moire.eat.ledger.held || moire.eat.ledger.stock)) || []).map((x) => Math.round(x * 10) / 10)})")
SPOT_VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"
COLONIES = {"preset": "colonies", "founders": "wild"}


def run(name, desc, query, dur, probes, shots=None, oxygen=False, snap=False, harmonic=False, every=30):
    evals = []
    if oxygen:   # the oxygen conditions (step M1's): a lasting mineral spring and a vent dripping 2 s every 20 s (no free-atom spring)
        evals.append({"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); " + SPOT_VENT})
        evals += [{"t": t, "js": SPOT_VENT} for t in range(20, dur, 20)]
    evals += [{"t": t, "js": PROBE} for t in probes]
    evals += [{"t": t, "js": READY} for t in probes]
    evals += [{"t": t, "js": DISH} for t in probes]
    sh = shots if shots is not None else [{"t": dur, "name": "end"}]
    if harmonic:
        evals.append({"t": dur + 1, "js": HARM_ON})
        sh = sh + [{"t": dur + 2, "name": "harmonic"}]
    return {"name": name, "description": desc, "query": query, "duration": dur + (2.5 if harmonic else 0), "sample_every": every, "stall": 300,
            "shots": sh, "snapshots": [{"t": dur, "grid": True}] if snap else [], "evals": evals}


def dump(obj, fname):
    json.dump(obj, open(os.path.join(HERE, fname), "w"), indent=1)
    print("wrote", fname)


def ab(name, desc, q, dur=600, scene=None, seed=3):
    base = dict(COLONIES) if scene == "colonies" else {}
    return run(f"c15e-{name}", desc, {"seed": seed, **base, **q}, dur, tuple(range(60, dur + 1, 60)), shots=[{"t": dur, "name": "end"}])


# ---------- diagnosis: one part's carbon rule off at a time (every fix on, (h) included) ----------
dump({"batch": "c15e-diag", "runs": [
    ab("diag-nobody", "every fix on, growth needs carbon OFF (?cbgrow=0): what the body's carbon costs; default scene, seed 3, 10 min", {"cbgrow": 0}),
    ab("diag-memb-pig", "every fix on, body and enzymes OFF (?cbgrow=0&cbenz=0): membranes and pigments alone; default scene, seed 3, 10 min",
       {"cbgrow": 0, "cbenz": 0}),
]}, "diag.json")

# ---------- smoke: books and the flow ledger over 90 s, with the fixes as they stand ----------
dump({"batch": "c15e-smoke", "runs": [
    run("c15e-smoke", "smoke: default scene 90 s, every fix on, books", {"seed": 3}, 90, (30, 60, 90), every=15),
    run("c15e-smoke-old", "smoke: default scene 90 s with ?cbenzany=0 (C15d's enzymes), books", {"seed": 3, "cbenzany": 0}, 90, (30, 60, 90), every=15),
]}, "smoke.json")

# ---------- ab1: fix (h) an enzyme's scaffold from any carbon ----------
dump({"batch": "c15e-ab1", "runs": [
    ab("ab1-enzany", "fix (h) enzymes from any carbon (every C15d fix on); default scene, seed 3, 10 min", {}),
    ab("ab1-enzany-colonies", "fix (h) enzymes from any carbon; colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "ab1.json")

# ---------- ab2: + fix (j) the granules' burnt hands reduced from the battery ----------
dump({"batch": "c15e-ab2", "runs": [
    ab("ab2-granred", "fixes (h) + (j) granule reduction (every C15d fix on); default scene, seed 3, 10 min", {}),
    ab("ab2-granred-colonies", "fixes (h) + (j); colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "ab2.json")

# ---------- ab3: + fix (l) the granules digested (spare backbones hydrolysed for their hands) ----------
dump({"batch": "c15e-ab3", "runs": [
    ab("ab3-granhyd", "fixes (h) (j) + (l) granule digestion (every C15d fix on); default scene, seed 3, 10 min", {}),
    ab("ab3-granhyd-colonies", "fixes (h) (j) + (l); colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "ab3.json")
