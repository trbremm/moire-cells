"""Step C15g conditions: carbon life, round 4 (README "Step C15g: carbon life, round 4"; EXPERIMENTS.md "Carbon life, round 4").
(The run builders are step C15f's, experiments/conditions/c15f/make.py, with the names' prefix c15g.)

python experiments/conditions/c15g/make.py   -> the batch files in this folder

base-main   the watch scenes on main c2e49a1 as it was (run from an export of that commit: tools/experiment.py of the export, --out here)
base-off    the same scenes with ?carbon=0 on main c2e49a1 (the references, rerun on this code; lever (s) changes ?carbon=0 too)
fl-main     the five fresh-load worlds (delta, islands, sieve, thicket, forest) at 30 s / 2 / 4 min, computer and phone size, main
crash-*     the founders' crash (default scene, 2 min, every 10 s), each lever against its switch
ab-*        each C15g lever against its switch off (written as the step went)
watch       the scenes with every C15g lever on (the end of the step)
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
# STOCKS (step C15g): what the idle photons' reductions need, summed over the live cells (units): free g, free t, water gt in the stocks, the
# cells with no free g; the burnt hands (ladder and granules) and the fuel hands
STOCKS = ("if (!moire.eat.carbon || !moire.eat.carbon.buf) return JSON.stringify({stocks: null}); const d = moire.gpu.device; const rb = async (buf, size) => { const b = d.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST}); "
          "const e = d.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, b, 0, size); d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); "
          "const a = b.getMappedRange().slice(0); b.unmap(); b.destroy(); return a; }; const C = moire.cells, n = C.count, CF = C.cellBuf.size / 4 / n, E = moire.eat; "
          "const cu = new Uint32Array(await rb(C.cellBuf, n * CF * 4)); const st = new Int32Array(await rb(E.stockBuf, n * 64 * 4)); const cb = new Int32Array(await rb(E.carbon.buf, n * 24 * 4)); "
          "let alive = 0, g = 0, t = 0, w = 0, g0 = 0, T = 0, G = 0, T0 = 0; for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; alive++; const o = i * 64, c = i * 24; "
          "g += st[o]; t += st[o + 1]; w += st[o + 6]; if (st[o] <= 0) g0++; const bt = cb[c + 1] + 2 * cb[c + 2] + 3 * cb[c + 3] + 4 * cb[c + 4] + cb[c + 7]; "
          "T += bt; if (bt <= 0) T0++; G += 4 * cb[c] + 3 * cb[c + 1] + 2 * cb[c + 2] + cb[c + 3] + cb[c + 6]; } const u = (x) => Math.round(x / 4096 * 100) / 100; "
          "return JSON.stringify({stocks: {alive, g: u(g), t: u(t), water: u(w), noG: g0, burnt: u(T), noBurnt: T0, fuel: u(G)}})")
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
    evals += [{"t": t, "js": STOCKS} for t in probes]
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
    name = f"c15g-{tag}-{key}_s{seed}"
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
    return {"name": f"c15g-fl-{tag}-{sz}-{kind}-s{seed}", "description": f"{kind} seed {seed}, {size}, {what}, 4 min",
            "query": {"terrain": kind, "seed": seed, **(extra or {})}, "size": size, "duration": 240, "sample_every": 10, "stall": 400,
            "shots": [{"t": t, "name": f"t{t}"} for t in (30, 120, 240)], "snapshots": [],
            "evals": [{"t": t, "js": FL_PROBE} for t in (1, 10, 30, 60, 90, 120, 180, 240)]}


def fl_batch(tag, what, extra=None, seeds=(3, 12), phone_seeds=(3,)):
    runs = [fl(k, s, tag, "1280x800", extra, what) for s in seeds for k in KINDS]
    runs += [fl(k, s, tag, "390x844", extra, what) for s in phone_seeds for k in KINDS if k != "sieve"]
    return {"batch": f"c15g-fl-{tag}", "runs": runs}


if __name__ == "__main__":
    # ---------- the baseline: main c2e49a1 as it was (carbon on), and ?carbon=0, both run from an export of that commit ----------
    dump({"batch": "c15g-base-main", "runs": [watch(k, s, d, "main", "main c2e49a1 (C15f + S2, carbon on)") for k, s, d in WATCH]}, "base-main.json")
    dump({"batch": "c15g-base-off", "runs": [watch(k, s, d, "off", "?carbon=0 on main c2e49a1", extra={"carbon": 0}) for k, s, d in WATCH]},
         "base-off.json")
    dump(fl_batch("main", "main c2e49a1"), "fl-main.json")

    # ---------- smoke: the books over 60 s with every C15g lever on (default scene; the oxygen spot dish) ----------
    sm = run("c15g-smoke", "smoke: default scene 60 s, every C15g lever on, books", {"seed": 3}, 60, (20, 40, 60), every=10, spend=True)
    sm2 = run("c15g-smoke-oxy", "smoke: oxygen spot dish 60 s, every C15g lever on, books", {"seed": 3}, 60, (20, 40, 60), oxygen=True, every=10)
    dump({"batch": "c15g-smoke", "runs": [sm, sm2]}, "smoke.json")

    # ---------- crash: the founders' first two minutes (default scene, every 10 s), every lever on and each against its switch ----------
    def crash(tag, desc, q, js=None, seed=3, dur=120):
        r = run(f"c15g-crash-{tag}_s{seed}", f"founders' crash: {desc}; default scene, seed {seed}, {dur} s", {"seed": seed, **q}, dur, (30, 60, 90, 120),
                every=10, spend=True)
        if js:
            r["evals"] = [{"t": 0, "js": js}] + r["evals"]
        return r
    NONE = {"cbidlered": 0, "crawlwork": 0, "cbmembfound": 0}   # (every C15g lever off: main's code path)
    dump({"batch": "c15g-crash", "runs": [
        crash("all", "every C15g lever on", {}), crash("none", "every C15g lever off (main)", NONE),
        crash("noidle", "every lever on but ?cbidlered=0", {"cbidlered": 0}), crash("nowork", "every lever on but ?crawlwork=0", {"crawlwork": 0}),
        crash("nomemb", "every lever on but ?cbmembfound=0", {"cbmembfound": 0}),
        crash("off-work", "?carbon=0, crawling paid by its work", {"carbon": 0}), crash("off-old", "?carbon=0, ?crawlwork=0 (main)", {"carbon": 0, "crawlwork": 0}),
    ] + [crash(t, d, q, seed=7) for t, d, q in (("all", "every C15g lever on", {}), ("none", "every C15g lever off (main)", NONE))]}, "crash.json")

    # ---------- ab1: every C15g lever on, and each against its switch off (default scene, seeds 3 and 7, 10 min); ?carbon=0 with lever (s) ----------
    ab = []
    for s in (3, 7):
        ab.append(watch("default", s, 600, "ab1-all", "every C15g lever on"))
        for tag, q, what in (("noidle", {"cbidlered": 0}, "?cbidlered=0"), ("nowork", {"crawlwork": 0}, "?crawlwork=0"), ("nomemb", {"cbmembfound": 0}, "?cbmembfound=0")):
            ab.append(watch("default", s, 600, f"ab1-{tag}", f"every C15g lever on but {what}", extra=q))
        ab.append(watch("default", s, 600, "ab1-offwork", "?carbon=0 with lever (s): the crawl paid by its work", extra={"carbon": 0}))
    dump({"batch": "c15g-ab1", "runs": ab}, "ab1.json")

    # ---------- the end: the watch with every C15g lever on (pictures, snapshots), and the fresh-load worlds ----------
    dump({"batch": "c15g-watch", "runs": [watch(k, s, d, "w", "every C15g lever on", pictures=True) for k, s, d in WATCH]}, "watch.json")
    dump(fl_batch("w", "every C15g lever on"), "fl-w.json")

    # ---------- checks: a C15f-era snapshot (made on main c2e49a1 from its export), loading with the C15g levers off; Firefox; phone ----------
    src = run("c15g-snapsrc", "a snapshot made on main c2e49a1 (C15f): default scene seed 7, 180 s (run from the export)", {"seed": 7}, 180, (180,),
              shots=[{"t": 180, "name": "end"}], snap=True, every=30)
    dump({"batch": "c15g-snapsrc", "runs": [src]}, "snapsrc.json")
    snap = run("c15g-snap-c15f", "the C15f snapshot (c15g-snapsrc at 180 s) loads and runs on 30 s on C15g (its levers off as it ran), books",
               {"snap": "experiments/runs/c15g-snapsrc/snapshots/snap_t180.json"}, 30, (), shots=[{"t": 30, "name": "end"}], every=10)
    snap["evals"] = [{"t": t, "js": FL_PROBE} for t in (1, 15, 30)] + [{"t": 2, "js": "return JSON.stringify({levers: {crawlWork: moire.eat.params.crawlWork, "
                                                                        "idleRed: moire.carbonCells.params.idleRed, membFound: moire.carbonCells.params.membFound}})"}]
    ff = run("c15g-firefox", "Firefox (headed): the default scene 40 s, every C15g lever on, books", {"seed": 3}, 40, (20, 40),
             shots=[{"t": 40, "name": "end"}], every=10)
    ph = run("c15g-phone", "phone size (390 x 844 at dpr 3, Chrome): a fresh-load world (islands, seed 3) 30 s, every C15g lever on",
             {"terrain": "islands", "seed": 3}, 30, (), shots=[{"t": 30}], every=10)
    ph["size"] = "390x844"
    ph["dpr"] = 3
    ph["evals"] = [{"t": t, "js": FL_PROBE} for t in (10, 30)]
    dump({"batch": "c15g-firefox", "runs": [ff]}, "firefox.json")
    dump({"batch": "c15g-checks", "runs": [ph, snap]}, "checks.json")
    # speed: the default scene, seed 3 (2000 founders), 60 s, on a free GPU, C15g then main (from the export) then C15g again
    sp = lambda name, what: {"name": name, "description": f"speed: default scene seed 3, 60 s, {what}", "query": {"seed": 3}, "duration": 60,
                             "sample_every": 30, "shots": []}
    spn = sp("c15g-speed-none", "every C15g lever off (main's code path, on this tree)")
    spn["query"] = {"seed": 3, **NONE}
    dump({"batch": "c15g-speed", "runs": [sp("c15g-speed-g", "every C15g lever on"), sp("c15g-speed-g2", "every C15g lever on, again"), spn]}, "speed.json")
    dump({"batch": "c15g-speed-main", "runs": [sp("c15g-speed-main", "main c2e49a1 (from its export)")]}, "speed-main.json")

    # ---------- ab2: the two follow-ups the ab1 numbers pointed to (both off by default until measured): idle photons also DIGEST the
    # granules' spare backbones (?cbidlehyd=1), and split a water for the g (?cbidlewater=1); default scene seeds 3 and 7, 10 min ----------
    ab2 = []
    for s in (3, 7):
        ab2.append(watch("default", s, 600, "ab2-hyd", "every C15g lever on + ?cbidlehyd=1", extra={"cbidlehyd": 1}))
        ab2.append(watch("default", s, 600, "ab2-hydwater", "every C15g lever on + ?cbidlehyd=1&cbidlewater=1", extra={"cbidlehyd": 1, "cbidlewater": 1}))
    dump({"batch": "c15g-ab2", "runs": ab2}, "ab2.json")

    # ---------- ab3: hungry cells smell the mud (?cbsmellmud=1) with every C15g lever on, default scene seeds 3 and 7, 10 min ----------
    dump({"batch": "c15g-ab3", "runs": [watch("default", s, 600, "ab3-mud", "every C15g lever on + ?cbsmellmud=1", extra={"cbsmellmud": 1})
                                        for s in (3, 7)]}, "ab3.json")

    # ---------- pictures: close-ups from the watch's last snapshots (step C15e's picture run, the same evals) ----------
    pics = json.load(open(os.path.join(HERE, "..", "c15e", "pictures.json")))
    runs = []
    for key, run_, t in (("default", "c15g-w-default_s3", 1200), ("default7", "c15g-w-default_s7", 1200), ("colonies", "c15g-w-colonies_s3", 1200)):
        r = json.loads(json.dumps(pics["runs"][0]))
        r["name"] = f"c15g-pics-{key}"
        r["description"] = f"close-ups from the last snapshot of {run_} (every C15g lever on): the most bilayer, the most pigment"
        r["query"] = {"snap": f"experiments/runs/{run_}/snapshots/snap_t{t}.json"}
        runs.append(r)
    dump({"batch": "c15g-pictures", "runs": runs}, "pictures.json")

    # ---------- rep: repeats (the same seed differs by a quarter between runs): every lever on vs every lever off (main's path), 10 min ----------
    rep = []
    for k in (2, 3):
        for s in (3, 7):
            rep.append(watch("default", s, 600, f"rep{k}-all", f"every C15g lever on (repeat {k})"))
            rep.append(watch("default", s, 600, f"rep{k}-none", f"every C15g lever off: main's code path (repeat {k})", extra=NONE))
    dump({"batch": "c15g-rep", "runs": rep}, "rep.json")
