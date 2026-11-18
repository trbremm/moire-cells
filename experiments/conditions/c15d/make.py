"""Step C15d conditions: the carbon economy (README "Step C15d: the carbon economy"; EXPERIMENTS.md "The carbon economy").

python experiments/conditions/c15d/make.py   -> the batch files in this folder

smoke     the default scene 90 s: the flow ledger and the books
ab        the fixes one at a time and together, default scene seed 3, 10 minutes (the tuning runs)
watch     the scenes the step must make viable, all fixes on, against ?carbon=0 at the same seed
pictures  close-ups from the watch runs' snapshots (neon and harmonic)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
# a probe: the flow ledger, the Liebig census, the parts, the books (EXPERIMENTS.md tables come from these via summary.py)
PROBE = ("const L = moire.carbon && moire.carbon.ledger, CC = moire.carbonCells, H = moire.heat.ledger; "
         "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, job: moire.cells.stats && moire.cells.stats.job, "
         "flow: CC && CC.flow, parts: CC && CC.census2, census: CC && CC.census, "
         "memb: moire.membrane && moire.membrane.census && {integ: moire.membrane.census.integ}, "
         "cRound: L && L.rounding, eRound: L && L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding, eIn: H.in, freeT: moire.matter.dish[1], "
         "freeG: moire.matter.dish[3]})")
SPOT_VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"


def run(name, desc, query, dur, probes, shots=None, oxygen=False, snap=False, harmonic=False, every=30):
    evals = []
    if oxygen:   # the oxygen conditions (step M1's): a lasting mineral spring and a vent dripping 2 s every 20 s (no free-atom spring)
        evals.append({"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); " + SPOT_VENT})
        evals += [{"t": t, "js": SPOT_VENT} for t in range(20, dur, 20)]
    evals += [{"t": t, "js": PROBE} for t in probes]
    sh = shots if shots is not None else [{"t": dur, "name": "end"}]
    if harmonic:
        evals.append({"t": dur + 1, "js": HARM_ON})
        sh = sh + [{"t": dur + 2, "name": "harmonic"}]
    return {"name": name, "description": desc, "query": query, "duration": dur + (2.5 if harmonic else 0), "sample_every": every, "stall": 300,
            "shots": sh, "snapshots": [{"t": dur, "grid": True}] if snap else [], "evals": evals}


def dump(obj, fname):
    json.dump(obj, open(os.path.join(HERE, fname), "w"), indent=1)
    print("wrote", fname)


smoke = {"batch": "c15d-smoke", "runs": [
    run("c15d-smoke", "smoke: default scene 90 s, the flow ledger", {"seed": 3}, 90, (30, 60, 90), every=15),
]}
dump(smoke, "smoke.json")

# ---------- the tuning runs: each fix alone and together (default scene seed 3 and the wild colonies, 10 minutes) ----------
PROBES10 = tuple(range(60, 601, 60))
COLONIES = {"preset": "colonies", "founders": "wild"}


def ab(name, desc, q, dur=600, scene=None):
    base = dict(COLONIES) if scene == "colonies" else {}
    return run(f"c15d-{name}", desc, {"seed": 3, **base, **q}, dur, PROBES10 if dur == 600 else tuple(range(60, dur + 1, 60)),
               shots=[{"t": dur, "name": "end"}])


dump({"batch": "c15d-base", "runs": [
    ab("base-default", "baseline (C15c as committed): default scene, seed 3, 10 min", {}),
    ab("base-colonies", "baseline (C15c as committed): colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "base.json")

# ---------- the merge with main (G0b obstacles): carbon's spread keeps the obstacles' mask; books with carbon on ----------
dump({"batch": "c15d-merge", "runs": [
    run("c15d-merge-default", "merge check: default scene, carbon on, 60 s", {"seed": 3}, 60, (30, 60), every=15),
    run("c15d-merge-chip", "merge check: ?preset=chip, carbon on, 90 s", {"seed": 3, "preset": "chip"}, 90, (30, 60, 90), every=15),
    run("c15d-merge-crevices", "merge check: ?preset=crevices, carbon on, 90 s", {"seed": 3, "preset": "crevices"}, 90, (30, 60, 90), every=15),
]}, "merge.json")
# the carbon inside solid pixels (should be ~0: pushed out; only tar buried before the wall was there may stay)
SOLIDC = ("const H = moire.heat, M = moire.matter, Cb = M.carbon, O = moire.obstacles, d = moire.gpu.device, N = H.n; "
          "const buf = d.createBuffer({size: H.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); const e = d.createCommandEncoder(); "
          "e.copyBufferToBuffer(H.buffer, 0, buf, 0, H.bytes); d.queue.submit([e.finish()]); await buf.mapAsync(GPUMapMode.READ); "
          "const w = new Int32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy(); "
          "const LW = 46080, mk = O.off('mask'), lb = (Cb.cur ? Cb.copyBase(1) : Cb.copyBase(0)), tb = Cb.tarBase(); "
          "let ins = 0, out = 0, nS = 0; for (let i = 0; i < N; i++) { const solid = (w[mk + i] & 1) !== 0; let c = 0; "
          "for (let j = 0; j < 5; j++) c += Math.max(w[LW + lb + j * N + i], 0); for (let j = 0; j < 3; j++) c += Math.max(w[LW + tb + j * N + i], 0) * (j ? 0.25 : 0.5); "
          "if (solid) { ins += c; nS++; } else out += c; } return JSON.stringify({solidPx: nS, carbonInSolid: ins / 4096, carbonInWater: out / 4096});")
dump({"batch": "c15d-merge2", "runs": [
    {**run("c15d-merge-crevices2", "merge check: crevices, the carbon inside solids at 60 s", {"seed": 3, "preset": "crevices"}, 60, (60,), every=30),
     "evals": [{"t": 60, "js": SOLIDC}]},
]}, "merge2.json")

# the fixes, each alone (the others off) and all together; ?cbphoto, ?cbshut, ?cbhydheat
OFF = {"cbphoto": 0, "cbshut": 0, "cbhydheat": 0}
dump({"batch": "c15d-ab1", "runs": [
    ab("ab1-photo", "fix (a) alone: founders that photosynthesise fix carbon; default scene, seed 3, 10 min", {**OFF, "cbphoto": 1}),
    ab("ab1-shut", "fix (c) alone: the reducing shuttle; default scene, seed 3, 10 min", {**OFF, "cbshut": 1}),
    ab("ab1-hyd", "fix (b) alone: mud hydrolyses by heat; default scene, seed 3, 10 min", {**OFF, "cbhydheat": 1}),
    ab("ab1-all", "fixes (a) (b) (c) together; default scene, seed 3, 10 min", {}),
    ab("ab1-all-colonies", "fixes (a) (b) (c) together; colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "ab1.json")

# diagnosis after ab1 (the fixes (a)-(c) barely moved the default scene): which rule holds the count down? one rule off or eased at a time
dump({"batch": "c15d-diag", "runs": [
    ab("diag-nobody", "diagnosis: growth needs carbon OFF (?cbgrow=0); default scene, seed 3, 10 min", {"cbgrow": 0}),
    ab("diag-noenz", "diagnosis: enzymes OFF (?cbenz=0); default scene, seed 3, 10 min", {"cbenz": 0}),
    ab("diag-nobite", "diagnosis: oxygen bites OFF (?cbbite=0); default scene, seed 3, 10 min", {"cbbite": 0}),
    ab("diag-lip0", "diagnosis: C15b linker membranes (?cblip=0); default scene, seed 3, 10 min", {"cblip": 0}),
]}, "diag.json")

# ab2: with fat from granules (e1) and hunger for every part (e2); all fixes on, and (e1)+(e2) alone
OFF2 = {**OFF, "cbgran": 0, "cbhunger": 0}
dump({"batch": "c15d-ab2", "runs": [
    ab("ab2-all", "all fixes (a)-(e2); default scene, seed 3, 10 min", {}),
    ab("ab2-all-colonies", "all fixes (a)-(e2); colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
    ab("ab2-gran", "fixes (e1) fat from granules + (e2) hunger alone; default scene, seed 3, 10 min", {**OFF2, "cbgran": 1, "cbhunger": 1}),
]}, "ab2.json")
