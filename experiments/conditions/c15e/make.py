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
READY = ("if (moire.eat.carbon.buf.size < moire.cells.count * 96) return JSON.stringify({ready: null}); const d = moire.gpu.device; const rb = async (buf, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
         "const e = d.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, b, 0, size); d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); "
         "const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; }; const C = moire.cells, n = C.count, CF = C.cellBuf.size / 4 / n; "
         "const cf = new Float32Array(await rb(C.cellBuf, n * CF * 4)), cu = new Uint32Array(cf.buffer); const CC = moire.eat.carbon; "
         "const cb = new Int32Array(await rb(CC.buf, n * 24 * 4)); const kB = CC.params.kBody, R = C.R; "
         "let alive = 0, bat = 0, body = 0, both = 0, grown = 0, all3 = 0, batSum = 0, bsEmpty = 0, bsBurnt = 0; const hb = [0,0,0,0,0], bsGr = [0,0,0]; "
         "for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; alive++; const b = cf[i * CF + 16], r = cf[i * CF + 4]; "
         "const want = kB * Math.PI * (r / R) ** 2 * 4096, have = 0.25 * (2 * cb[i * 24 + 8] + cb[i * 24 + 9] + cb[i * 24 + 10]); "
         "const okB = b >= 0.6, okC = !CC.params.growth || have >= 0.995 * want, okR = r >= 0.9 * R; batSum += b; hb[Math.min(4, Math.floor(b * 5))]++; "
         "if (okB) bat++; if (okC) body++; if (okB && okC) both++; if (okR) grown++; if (okB && okC && okR) all3++; "
         "if (okB && !okC) { const c = cb[i * 24 + 5], g = cb[i * 24 + 6], t = cb[i * 24 + 7]; bsGr[0] += c; bsGr[1] += g; bsGr[2] += t; if (2 * c + g + t < 4096 * want / 4096 * 0.5) bsEmpty++; if (4 * g < g + t) bsBurnt++; } } "
         "return JSON.stringify({ready: {alive, bat, body, both, grown, all3, batMean: batSum / Math.max(alive, 1), batHist: hb, "
         "batNoBody: {gran: bsGr.map((x) => Math.round(x / 4096 * 100) / 100), empty: bsEmpty, burnt: bsBurnt}}})")
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

# ---------- ab4: + fix (m) an enzyme's G from its compounds (GT, rust Gt) ----------
dump({"batch": "c15e-ab4", "runs": [
    ab("ab4-gsplit", "fixes (h) (j) (l) + (m) G from GT and rust (every C15d fix on); default scene, seed 3, 10 min", {}),
    ab("ab4-gsplit-colonies", "fixes (h) (j) (l) + (m); colonies of wild founders, seed 3, 10 min", {}, scene="colonies"),
]}, "ab4.json")

# ---------- watch: the scenes the step must make viable, every fix on (?carbon=0 references: step C15d's runs, the same code path) ----------
SCENES = {
    "default": ("default scene (spotlight, mineral spring, vent, a lasting fuel seep)", {}, False),
    "colonies": ("colonies preset (five wild founders' colonies, the whole dish lit)", dict(COLONIES), False),
    "shallows": ("Sunlit shallows preset", {"preset": "shallows"}, False),
    "oxy-spot": ("oxygen conditions (lasting mineral spring, a vent dripping 2 s in 20, spotlight)", {}, True),
    "oxy-full": ("oxygen conditions, the whole dish lit", {"light": "full"}, True),
}


def watch(key, seed, dur, off=False, extra=None, tag=""):
    desc, q, oxy = SCENES[key]
    name = f"c15e-w-{key}{'-off' if off else ''}{tag}_s{seed}"
    shots = [{"t": 300}, {"t": 600}, {"t": dur, "name": "end"}, {"t": dur, "panel": True, "name": "panel"}]
    return run(name, f"{desc}, {'?carbon=0' if off else 'carbon life viable (every C15d and C15e fix on)'}, seed {seed}, {dur // 60} min",
               {"seed": seed, **({"carbon": 0} if off else {}), **q, **(extra or {})}, dur, tuple(range(60, dur + 1, 60)), shots, oxygen=oxy,
               snap=not off, harmonic=not off)


# ?carbon=0 unchanged: the first 2 minutes of the default scene, seed 7, against step C15d's c15d-w-default-off_s7
dump({"batch": "c15e-offcheck", "runs": [watch("default", 7, 120, off=True, tag="-check")]}, "offcheck.json")

# ---------- ab5: + fix (i) the body from any built carbon ----------
dump({"batch": "c15e-ab5", "runs": [
    ab("ab5-bodyany", "fixes (h) (j) (l) (m) + (i) body from any granule carbon (every C15d fix on); default scene, seed 3, 10 min", {}),
    ab("ab5-bodyany-off", "fixes (h) (j) (l) (m), (i) OFF (?cbbodyany=0): the same build as ab5 without (i); default scene, seed 3, 10 min", {"cbbodyany": 0}),
]}, "ab5.json")

# ---------- diag2: what kills the wild colonies with every fix on: oxygen's bites on the carbon membranes? ----------
dump({"batch": "c15e-diag2", "runs": [
    ab("diag2-colonies-nobite", "every fix on, oxygen does not damage membranes (?cbbite=0); colonies of wild founders, seed 3, 10 min", {"cbbite": 0},
       scene="colonies"),
]}, "diag2.json")

dump({"batch": "c15e-watch", "runs": [
    watch("default", 3, 1200), watch("default", 7, 1200), watch("colonies", 3, 1200), watch("colonies", 7, 1200),
    watch("shallows", 3, 600), watch("oxy-spot", 3, 600), watch("oxy-full", 3, 600),
]}, "watch.json")

# ---------- the merge with main (step S1 cell shape): carbon on with every cell asking 3:1, ?carbon=0 alike, Firefox ----------
SPIN = "await moire.genome.setAll({elongation: 1.1}); return 'every cell asks 3:1'"
CENSUS = "return JSON.stringify(moire.spindle.census)"


def merge_run(name, desc, q, dur, spin=True, probe=True):
    r = run(name, desc, q, dur, tuple(t for t in (30, 60, dur) if t <= dur) if probe else (), shots=[{"t": dur, "name": "end"}], every=15)
    if spin:
        r["evals"] = [{"t": 2, "js": SPIN}] + r["evals"] + [{"t": min(60, dur), "js": CENSUS}, {"t": dur, "js": CENSUS}]
    return r


dump({"batch": "c15e-merge", "runs": [
    merge_run("c15e-merge-spindles", "merge check (S1 + carbon): default scene seed 3, every cell asks 3:1 at 2 s, 90 s, books", {"seed": 3}, 90),
    merge_run("c15e-merge-off", "merge check: ?carbon=0, default scene seed 3, every cell asks 3:1 at 2 s, 90 s", {"seed": 3, "carbon": 0}, 90, probe=False),
    merge_run("c15e-merge-firefox", "merge check in Firefox (headed): wild founders with shape genes, carbon on, 40 s, books",
              {"seed": 3, "founders": "wild", "wild": "shape"}, 40, spin=False),
]}, "merge.json")

# ---------- oxy: which fix makes the oxygen dishes smaller (after the merge with S1: every pair on the same code) ----------
dump({"batch": "c15e-oxy", "runs": [
    watch("oxy-spot", 3, 600, tag="-m"),
    watch("oxy-spot", 3, 600, extra={"cbgsplit": 0}, tag="-m-nogsplit"),
    watch("oxy-spot", 3, 600, extra={"cbgranhyd": 0, "cbgranred": 0}, tag="-m-nogran"),
    watch("oxy-spot", 3, 600, extra={"cbgsplit": 0, "cbgranhyd": 0, "cbgranred": 0, "cbenzany": 0}, tag="-m-c15d"),
]}, "oxy.json")

# ---------- phone size (Chrome 390 x 844 at device px 3), carbon on, after the merge ----------
_ph = run("c15e-merge-phone", "phone size (390 x 844 at dpr 3, Chrome): the default scene 20 s, every fix on, after the merge", {"seed": 3}, 20, (20,),
          shots=[{"t": 20}, {"t": 20, "panel": True, "name": "panel"}], every=10)
_ph["size"] = "390x844"
_ph["dpr"] = 3
dump({"batch": "c15e-phone", "runs": [_ph]}, "phone.json")

# ---------- speed: the first 60 s side by side, every C15e fix on against all off (the GPU is shared: a rough look only) ----------
dump({"batch": "c15e-speed", "runs": [
    run("c15e-speed-on", "speed: default scene seed 3, 60 s, every fix on", {"seed": 3}, 60, (), every=30),
    run("c15e-speed-off", "speed: default scene seed 3, 60 s, the C15e fixes off (C15d)", {"seed": 3, "cbenzany": 0, "cbgranred": 0, "cbgranhyd": 0,
        "cbgsplit": 0}, 60, (), every=30),
]}, "speed.json")
