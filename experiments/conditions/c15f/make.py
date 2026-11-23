"""Step C15f conditions: carbon life, round 3 (README "Step C15f: carbon life, round 3"; EXPERIMENTS.md "Carbon life, round 3").

python experiments/conditions/c15f/make.py   -> the batch files in this folder

base-main   the watch scenes on main d5076f5 as it was (run from an export of that commit: tools/experiment.py of the export, --out here)
base-off    the same scenes with ?carbon=0 on the same code (everything new sits behind the carbon switch)
fl-*        the five fresh-load worlds (delta, islands, sieve, thicket, forest) at 30 s / 2 / 4 min, computer and phone size
ab-*        each C15f fix against its switch off, one at a time (written as the step went)
watch       the scenes with every C15f fix on (the end of the step)
The tables: table.py here.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM_ON = "moire.control.action('harmonic')"
# the probe of steps C15d/C15e (the flow ledger, the Liebig census, the parts, the books)
PROBE = ("const L = moire.carbon && moire.carbon.ledger, CC = moire.carbonCells, H = moire.heat.ledger; "
         "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, job: moire.cells.stats && moire.cells.stats.job, "
         "flow: CC && CC.flow, parts: CC && CC.census2, census: CC && CC.census, "
         "memb: moire.membrane && moire.membrane.census && {integ: moire.membrane.census.integ}, "
         "cRound: L && L.rounding, eRound: L && L.eRounding, atoms: moire.matter.ledger.rounding, "
         "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding, eIn: H.in, freeT: moire.matter.dish[1], "
         "freeG: moire.matter.dish[3]})")
# READY (step C15e): who could divide: the battery at divAt (0.6), the body full, both; the battery's histogram
READY = ("if (!moire.eat.carbon || !moire.eat.carbon.buf || moire.eat.carbon.buf.size < moire.cells.count * 96) return JSON.stringify({ready: null}); const d = moire.gpu.device; const rb = async (buf, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
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
# DISH: every substance in the dish and in the cells (units)
DISH = ("const M = moire.matter; return JSON.stringify({dishM: Array.from(M.dish || []).map((x) => Math.round(x * 10) / 10), "
        "cellsM: Array.from((moire.eat && moire.eat.ledger && (moire.eat.ledger.held || moire.eat.ledger.stock)) || []).map((x) => Math.round(x * 10) / 10)})")
# SPEND (step C15f): the batteries' energy per s by what it pays, from the ledgers the page keeps (the eat ledger's rates, the flow ledger)
SPEND = ("const E = moire.eat && moire.eat.ledger, F = moire.carbonCells && moire.carbonCells.flow, Lp = moire.lipids && moire.lipids.ledger; "
         "return JSON.stringify({spend: {t: moire.time(), alive: moire.cells.alive, bat: E && E.bat, rate: E && E.rate, rate2: E && E.rate2, "
         "lip: Lp && Lp.rate, cb3: moire.carbonCells && moire.carbonCells.tot3}})")
SPOT_VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"
COLONIES = {"preset": "colonies", "founders": "wild"}


def run(name, desc, query, dur, probes, shots=None, oxygen=False, snap=False, harmonic=False, every=30, spend=False):
    evals = []
    if oxygen:   # the oxygen conditions (step M1's): a lasting mineral spring and a vent dripping 2 s every 20 s (no free-atom spring)
        evals.append({"t": 0, "js": "moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); " + SPOT_VENT})
        evals += [{"t": t, "js": SPOT_VENT} for t in range(20, dur, 20)]
    evals += [{"t": t, "js": PROBE} for t in probes]
    evals += [{"t": t, "js": READY} for t in probes]
    evals += [{"t": t, "js": DISH} for t in probes]
    if spend:
        evals += [{"t": t, "js": SPEND} for t in sorted(set([10, 20, 30, 45, 60, 90, 120, 180, 240] + list(probes))) if t <= dur]
    sh = shots if shots is not None else [{"t": dur, "name": "end"}]
    if harmonic:
        evals.append({"t": dur + 1, "js": HARM_ON})
        sh = sh + [{"t": dur + 2, "name": "harmonic"}]
    return {"name": name, "description": desc, "query": query, "duration": dur + (2.5 if harmonic else 0), "sample_every": every, "stall": 400,
            "shots": sh, "snapshots": [{"t": dur, "grid": True}] if snap else [], "evals": evals}


def dump(obj, fname):
    json.dump(obj, open(os.path.join(HERE, fname), "w"), indent=1)
    print("wrote", fname)


SCENES = {
    "default": ("default scene (spotlight, mineral spring, vent, a lasting fuel seep)", {}, False),
    "colonies": ("colonies preset (five wild founders' colonies, the whole dish lit)", dict(COLONIES), False),
    "shallows": ("Sunlit shallows preset", {"preset": "shallows"}, False),
    "oxy-spot": ("oxygen conditions (lasting mineral spring, a vent dripping 2 s in 20, spotlight)", {}, True),
    "oxy-full": ("oxygen conditions, the whole dish lit", {"light": "full"}, True),
}
WATCH = [("default", 3, 1200), ("default", 7, 1200), ("colonies", 3, 1200), ("colonies", 7, 1200),
         ("shallows", 3, 600), ("oxy-spot", 3, 600), ("oxy-full", 3, 600)]


def watch(key, seed, dur, tag, what, extra=None, pictures=False, spend=True, every=30):
    desc, q, oxy = SCENES[key]
    name = f"c15f-{tag}-{key}_s{seed}"
    shots = [{"t": 300}, {"t": 600}, {"t": dur, "name": "end"}] + ([{"t": dur, "panel": True, "name": "panel"}] if pictures else [])
    shots = [s for s in shots if s["t"] <= dur]
    return run(name, f"{desc}, {what}, seed {seed}, {dur // 60} min", {"seed": seed, **q, **(extra or {})}, dur,
               tuple(range(60, dur + 1, 60)), shots, oxygen=oxy, snap=pictures, harmonic=pictures, spend=spend, every=every)


# ---------- the fresh-load worlds (a link ?terrain=<kind>&seed=<N>, as index.html rewrites a bare link) ----------
KINDS = ["delta", "islands", "sieve", "thicket", "forest"]
FL_PROBE = ("const L = moire.carbon && moire.carbon.ledger, H = moire.heat.ledger; "
            "return JSON.stringify({t: moire.time(), alive: moire.cells.alive, "
            "cRound: L && L.rounding, atoms: moire.matter.ledger.rounding, "
            "charge: moire.charge.ledger ? moire.charge.ledger.qRound : null, energy: H.rounding})")


def fl(kind, seed, tag, size, extra=None, what=""):
    sz = "desk" if size == "1280x800" else "phone"
    return {"name": f"c15f-fl-{tag}-{sz}-{kind}-s{seed}", "description": f"{kind} seed {seed}, {size}, {what}, 4 min",
            "query": {"terrain": kind, "seed": seed, **(extra or {})}, "size": size, "duration": 240, "sample_every": 10, "stall": 400,
            "shots": [{"t": t, "name": f"t{t}"} for t in (30, 120, 240)], "snapshots": [],
            "evals": [{"t": t, "js": FL_PROBE} for t in (1, 10, 30, 60, 90, 120, 180, 240)]}


def fl_batch(tag, what, extra=None, seeds=(3, 12), phone_seeds=(3,)):
    runs = [fl(k, s, tag, "1280x800", extra, what) for s in seeds for k in KINDS]
    runs += [fl(k, s, tag, "390x844", extra, what) for s in phone_seeds for k in KINDS if k != "sieve"]
    return {"batch": f"c15f-fl-{tag}", "runs": runs}


if __name__ == "__main__":
    # ---------- the baseline: main d5076f5 as it was, and ?carbon=0 on the same code ----------
    dump({"batch": "c15f-base-main", "runs": [watch(k, s, d, "main", "main d5076f5 (C15e, carbon on)") for k, s, d in WATCH]}, "base-main.json")
    dump({"batch": "c15f-base-off", "runs": [watch(k, s, d, "off", "?carbon=0", extra={"carbon": 0}) for k, s, d in WATCH]}, "base-off.json")
    dump(fl_batch("main", "main d5076f5"), "fl-main.json")

    # ---------- crash: what empties the founders' batteries in the first two minutes (default scene, seed 3, every 10 s) ----------
    MAIN = {"cbhydfloor": 0, "cbwallcut": 0, "cboilheld": 0, "cbspoilkeep": 0}   # (the C15f fixes off: main d5076f5)
    def crash(tag, desc, q, js=None, seed=3, dur=120):
        r = run(f"c15f-crash-{tag}_s{seed}", f"founders' crash: {desc}; default scene, seed {seed}, {dur} s", {"seed": seed, **q}, dur, (30, 60, 90, 120),
                every=10, spend=True)
        if js:
            r["evals"] = [{"t": 0, "js": js}] + r["evals"]
        return r
    dump({"batch": "c15f-crash", "runs": [
        crash("main", "main (the C15f fixes off)", MAIN),
        crash("nopay", "main, crawling free (moire.eat.params.pay = false)", MAIN, "moire.eat.params.pay = false; return 1"),
        crash("noenz", "main, engines need no enzymes (?cbenz=0)", {**MAIN, "cbenz": 0}),
        crash("nolipc", "main, membranes and walls not of carbon (?cblip=0)", {**MAIN, "cblip": 0}),
        crash("starter08", "main, starter charge 0.8 of the battery (?starter=0.8)", {**MAIN, "starter": 0.8}),
        crash("off", "?carbon=0", {"carbon": 0}),
        crash("fix", "the C15f fixes as they stand", {}),
    ]}, "crash.json")

    dump({"batch": "c15f-crash2", "runs": [
        crash("nosmell", "main, the corners do not smell the ladder's fuel (?cbsmell=0)", {**MAIN, "cbsmell": 0}),
        crash("nosmellall", "main, no smell at all (moire.eat.params.smell = false)", MAIN, "moire.eat.params.smell = false; return 1"),
    ]}, "crash2.json")

    # ---------- smoke: the books over 90 s with every C15f fix on (the oxygen spot dish: bites, digestion, walls) ----------
    dump({"batch": "c15f-smoke", "runs": [run("c15f-smoke", "smoke: oxygen spot dish 90 s, every C15f fix on, books", {"seed": 3}, 90, (30, 60, 90),
                                              oxygen=True, every=15)]}, "smoke.json")

    # ---------- ab1: the C15f fixes, all on, and each against its switch off where its mechanism acts ----------
    MAINQ = {"cbhydfloor": 0, "cbwallcut": 0, "cboilheld": 0, "cbspoilkeep": 0}
    dump({"batch": "c15f-ab1", "runs": [
        watch("default", 3, 600, "ab1-fix", "every C15f fix on"), watch("default", 7, 600, "ab1-fix", "every C15f fix on"),
        watch("oxy-spot", 3, 600, "ab1-fix", "every C15f fix on"), watch("colonies", 7, 600, "ab1-fix", "every C15f fix on"),
        watch("colonies", 3, 600, "ab1-fix", "every C15f fix on"),
        watch("oxy-spot", 3, 600, "ab1-nofloor", "every C15f fix on but ?cbhydfloor=0", extra={"cbhydfloor": 0}),
        watch("default", 3, 600, "ab1-nofloor", "every C15f fix on but ?cbhydfloor=0", extra={"cbhydfloor": 0}),
        watch("default", 3, 600, "ab1-nocut", "every C15f fix on but ?cbwallcut=0", extra={"cbwallcut": 0}),
        watch("default", 3, 600, "ab1-nooil", "every C15f fix on but ?cboilheld=0", extra={"cboilheld": 0}),
        watch("colonies", 7, 600, "ab1-nospoil", "every C15f fix on but ?cbspoilkeep=0", extra={"cbspoilkeep": 0}),
    ]}, "ab1.json")

    # ---------- ab2: each fix against its switch off, where its mechanism acts (short runs; the "on" side is the watch below at the same
    # seed and scene; the GPU was too busy for full 10-minute pairs) ----------
    nooil = crash("nooil", "every C15f fix on but ?cboilheld=0", {"cboilheld": 0})
    dump({"batch": "c15f-ab2", "runs": [
        watch("oxy-spot", 3, 600, "ab2-nofloor", "every C15f fix on but ?cbhydfloor=0", extra={"cbhydfloor": 0}),
        watch("colonies", 7, 360, "ab2-nospoil", "every C15f fix on but ?cbspoilkeep=0", extra={"cbspoilkeep": 0}),
        watch("default", 3, 300, "ab2-nocut", "every C15f fix on but ?cbwallcut=0", extra={"cbwallcut": 0}),
        watch("default", 3, 300, "ab2-fix", "every C15f fix on (the pair of ab2-nocut)"),
        nooil,
    ]}, "ab2.json")

    # ---------- the end: the watch with every C15f fix on (pictures, snapshots), and the fresh-load worlds ----------
    dump({"batch": "c15f-watch", "runs": [watch(k, s, d, "w", "every C15f fix on", pictures=True) for k, s, d in WATCH]}, "watch.json")
    dump(fl_batch("fix", "every C15f fix on"), "fl-fix.json")
    # (the whole-dish oxygen run of the watch, run on its own under another name while the others ran)
    _wb = [r for r in json.load(open(os.path.join(HERE, "watch.json")))["runs"] if r["name"] == "c15f-w-oxy-full_s3"][0]
    _wb["name"] = "c15f-wb-oxy-full_s3"
    dump({"batch": "c15f-watch-b", "runs": [_wb]}, "watch-b.json")

    # ---------- pictures: close-ups from the watch's last snapshots (step C15e's picture run, the same evals) ----------
    pics = json.load(open(os.path.join(HERE, "..", "c15e", "pictures.json")))
    runs = []
    for key, run_, t in (("default", "c15f-w-default_s3", 1200), ("default7", "c15f-w-default_s7", 1200), ("colonies", "c15f-w-colonies_s3", 1200),
                         ("oxyspot", "c15f-w-oxy-spot_s3", 600)):
        r = json.loads(json.dumps(pics["runs"][0]))
        r["name"] = f"c15f-pics-{key}"
        r["description"] = f"close-ups from the last snapshot of {run_} (every C15f fix on): the most bilayer, the most pigment"
        r["query"] = {"snap": f"experiments/runs/{run_}/snapshots/snap_t{t}.json"}
        runs.append(r)
    dump({"batch": "c15f-pictures", "runs": runs}, "pictures.json")

    # ---------- checks: Firefox (headed), phone size (Chrome 390 x 844 at dpr 3), a C15e snapshot loading with the C15f fixes ----------
    ff = run("c15f-firefox", "Firefox (headed): the default scene 40 s, every C15f fix on, books", {"seed": 3}, 40, (20, 40),
             shots=[{"t": 40, "name": "end"}], every=10)
    ph = run("c15f-phone", "phone size (390 x 844 at dpr 3, Chrome): a fresh-load world (thicket, seed 3) 30 s, every C15f fix on", {"terrain": "thicket", "seed": 3},
             30, (), shots=[{"t": 30}], every=10)
    ph["size"] = "390x844"
    ph["dpr"] = 3
    ph["evals"] = [{"t": t, "js": FL_PROBE} for t in (10, 30)]
    snap = run("c15f-snap-c15e", "a C15e snapshot (c15e-w-default_s7 at 20 min) loads and runs on 30 s with the C15f fixes, books",
               {"snap": "experiments/runs/c15e-w-default_s7/snapshots/snap_t1200.json"}, 30, (), shots=[{"t": 30, "name": "end"}], every=10)
    snap["evals"] = [{"t": t, "js": FL_PROBE} for t in (1, 15, 30)]
    dump({"batch": "c15f-firefox", "runs": [ff]}, "firefox.json")
    dump({"batch": "c15f-checks", "runs": [ph, snap]}, "checks.json")
