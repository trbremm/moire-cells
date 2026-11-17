"""Step P1, predators (engulfing, kin sparing, a hand-made predator): the conditions.
Run from the repository:
    python experiments/conditions/p1/make.py

  col-on            the COLONIES preset (five colonies of wild founders: every gene wild, now also the ENGULF and KIN SPARING genes and the
                    gene network's ENGULF output), engulfing on, 40 min: does predation evolve, does cannibalism die out (kin meals' share
                    over time; the sparing gene against the controls), do lineages LINK more (glue, clusters, contacts) and get armour
                    (wall, stiffness)? Predator-prey patterns?                                                  (batch-col.json, seeds 3, 7, 11)
  col-null          ... the NEUTRAL control (?engulfnull=1: the genes drift, nothing is ever engulfed)
  col-kinnull       ... kin sparing's control (?kinsparenull=1: kinship ignored), seeds 3 and 7 only
  drop-default      the default scene, ~20 hand-made predators dropped at 5 min (engulf 1, kin sparing 0, big), 30 min   (batch-drop.json, seeds 3, 7)
  drop-shallows     the Sunlit shallows preset, the same
  drop-*-null       ... the same with ?engulfnull=1 (the dropped predators cannot engulf: what they do by just being there)
  check             the books (resizes, G at the instant of a resize: the old leak, every P1 switch toggled at runtime, predators placed,
                    a snapshot saved and loaded while meals are being digested, G and N with wild founders): atoms and charge rounding 0
  reload            a T1b snapshot (genomes of 156 words, cells of 88) loads with engulfing off and runs 60 s
  speed             2000 / 10 000 cells, neon / harmonic, three runs each (as T1b's)
  look, pics        close-ups of wraps and phagosomes (both looks) and the lineage view of a predator wave
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM = "moire.control.action('harmonic'); return 'harmonic'"
CL = "return JSON.stringify(await moire.predators.clustersNow())"
PRED = ("const C = moire.predators.census; return JSON.stringify({t: C.time, genes: C.genes, now: C.now, total: C.total, recent: C.recent, "
        "all: C.all, clusters: C.clusters, digest: C.digest})")
GRN = ("const c = await moire.grn.typesNow(); return JSON.stringify({t: c.time, n: c.n, types: c.types, lineages: (c.lineages || []).map(l => "
       "({id: l.id, n: l.n, types: l.types}))})")


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def batch(name, runs, seeds):
    return write(f"batch-{name}", {"batch": f"p1-{name}", "runs": runs, "seeds": seeds})


def run(name, desc, q, D, every=30, snaps=(), shots=(), evals=(), extra=None):
    c = {"name": f"p1-{name}", "description": desc, "query": q, "duration": D, "sample_every": every, "stall": 150,
         "snapshots": [{"t": t} for t in snaps if t <= D], "shots": list(shots), "evals": list(evals)}
    if extra:
        c.update(extra)
    return c


# ---- the colonies: does predation evolve? ----
D = 2403
cl = [{"t": t, "js": CL} for t in (300, 600, 1200, 1800, 2400)] + [{"t": t, "js": PRED} for t in (600, 1200, 1800, 2400)]
shots = [{"t": 600, "view": "marker", "name": "marker_t600"}, {"t": 1200, "view": "marker", "name": "marker_t1200"},
         {"t": 1800, "view": "marker", "name": "marker_t1800"}, {"t": 2397, "view": "marker", "name": "marker_end"},
         {"t": 2398, "name": "neon_end"}, {"t": 2399, "panel": True, "name": "panel"}, {"t": 2402, "name": "harm_end"}]
col = [run('col-on', 'colonies preset (wild founders: every gene, also engulf, kin sparing, the network\'s engulf output), engulfing on, 40 min',
           {'preset': 'colonies'}, D, 15, snaps=(1200, 2400), shots=shots, evals=cl + [{"t": 2401, "js": HARM}]),
       run('col-null', 'colonies preset, engulfing NEUTRAL CONTROL (?engulfnull=1: genes drift, nothing is eaten), 40 min',
           {'preset': 'colonies', 'engulfnull': 1}, D, 15, snaps=(2400,), shots=shots, evals=cl + [{"t": 2401, "js": HARM}])]
batch('col', col, [3, 7, 11])
colk = [run('col-kinnull', 'colonies preset, kin sparing CONTROL (?kinsparenull=1: kinship ignored), 40 min',
            {'preset': 'colonies', 'kinsparenull': 1}, D, 15, snaps=(2400,), shots=[s for s in shots if s['name'] in ('marker_end', 'panel')], evals=cl)]
batch('colk', colk, [3, 7])

# ---- hand-made predators dropped into a culture ----
DROP = ("const v = moire.control.view(), s = moire.light.params.mode === 'spot' ? moire.light.spot() : null; "
        "const pts = []; for (let k = 0; k < 20; k++) { const a = 2 * Math.PI * k / 20 + 0.3; "
        "if (s) { const r = s.r * (0.2 + 0.6 * ((k * 7) % 10) / 10); pts.push([s.x + r * Math.cos(a), s.y + r * Math.sin(a)]); } "
        "else pts.push([v.cssW * (0.1 + 0.8 * ((k * 0.618034) % 1)), v.cssH * (0.1 + 0.8 * ((k * 0.381966 + 0.2) % 1))]); } "
        "return await moire.predators.place(pts)")
D2 = 1803
dcl = [{"t": 300, "js": DROP}] + [{"t": t, "js": CL} for t in (290, 420, 600, 900, 1200, 1500, 1800)] + [{"t": t, "js": PRED} for t in (600, 1200, 1800)]
dshots = [{"t": 330, "name": "neon_t330"}, {"t": 600, "name": "neon_t600"}, {"t": 900, "view": "marker", "name": "marker_t900"},
          {"t": 1200, "name": "neon_t1200"}, {"t": 1797, "view": "marker", "name": "marker_end"}, {"t": 1798, "name": "neon_end"},
          {"t": 1799, "panel": True, "name": "panel"}]
drop = [run('drop-default', 'default scene, 20 hand-made predators (engulf 1, kin sparing 0, size 1.25) dropped in the spot at 5 min, 30 min', {}, D2, 15,
            snaps=(1800,), shots=dshots, evals=dcl),
        run('drop-default-null', '... the same, engulfing NEUTRAL CONTROL (?engulfnull=1)', {'engulfnull': 1}, D2, 15, shots=dshots[-2:], evals=dcl),
        run('drop-shallows', 'Sunlit shallows preset, 20 hand-made predators dropped over the dish at 5 min, 30 min', {'preset': 'shallows'}, D2, 15,
            snaps=(1800,), shots=dshots, evals=dcl),
        run('drop-shallows-null', '... the same, engulfing NEUTRAL CONTROL (?engulfnull=1)', {'preset': 'shallows', 'engulfnull': 1}, D2, 15,
            shots=dshots[-2:], evals=dcl)]
batch('drop', drop, [3, 7])

# ---- books check (as T1b's, with step P1's pieces) ----
t1b = json.load(open(os.path.join(HERE, '..', 't1b', 'check.json'), encoding='utf-8'))
ev = [e for e in t1b['evals'] if e['t'] in (5, 60, 100, 105)]
ev += [
    {"t": 80, "js": "return await moire.predators.place(40)"},
    {"t": 120, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 150, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},   # G at the instant of the resize (the old leak)
    {"t": 152, "js": "return await moire.predators.place(40)"},
    {"t": 170, "js": "moire.predators.params.null = true; return 'engulf null'"},
    {"t": 180, "js": "moire.predators.params.null = false; moire.predators.params.kinNull = true; return 'kin null'"},
    {"t": 190, "js": "moire.predators.params.kinNull = false; moire.predators.params.on = false; return 'engulfing off'"},
    {"t": 200, "js": "moire.predators.params.on = true; moire.predators.params.drive = 30; moire.predators.params.sizeRatio = 1.05; moire.predators.params.wrapTime = 0.8; return 'easy engulfing'"},
    {"t": 215, "js": "moire.membrane.params.on = false; return 'membrane chemistry off (C6c weave path)'"},
    {"t": 225, "js": "moire.membrane.params.on = true; moire.lipids.params.on = false; return 'lipids off'"},
    {"t": 235, "js": "moire.lipids.params.on = true; return 'lipids on'"},
    {"t": 240, "js": "moire.predators.look.mark = true; moire.control.action('harmonic'); return 'harmonic, mark'"},
    {"t": 260, "js": "moire.control.action('harmonic'); return 'neon'"},
    {"t": 300, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 310, "js": "return await moire.predators.place(60)"},
    {"t": 330, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('culture')"},
    {"t": 335, "js": "return await moire.predators.place(60)"},
    {"t": 360, "js": "const C = moire.predators.census; const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); "
                     "return { digesting: C.now.digesting, wrapping: C.now.wrapping, exact: r.exact, notes: r.notes, rounding: r.rounding }"},
    {"t": 420, "js": "moire.predators.params.drive = 3; moire.predators.params.sizeRatio = 1.4; moire.predators.params.wrapTime = 3; return 'defaults'"},
]
check = run('check', 'step P1 books check: 480 s at MAX (seed 5), the whole dish lit; springs; N, 40 predators placed, a wash, resizes (150: with G at '
            'the same instant, the old leak; 220); G with wild founders (predation genes wild); engulf null, kin null, engulfing off and on, easy '
            'engulfing (many meals) with the membrane chemistry off, lipids off and on; the harmonic look and the mark; G and N with wild founders, '
            'predators placed; a snapshot saved and loaded while meals are digested (360 s); atoms and charge rounding must stay 0',
            {'seed': 5, 'light': 'full'}, 480, 10, shots=[{"t": 205}, {"t": 245, "name": "harm"}, {"t": 480, "panel": True, "name": "panel"}],
            evals=sorted(ev, key=lambda e: e['t']), extra={"resizes": [{"t": 150, "size": "1000x700"}, {"t": 220, "size": "1280x800"}], "stall": 150})
write('check', check)

# ---- an old snapshot (step T1b's colonies at 20 min) loads with engulfing off ----
write('reload', run('reload-t1b', 'a T1b snapshot (cells of 88 words) loads with engulfing off and runs 60 s',
                    {'snap': 'experiments/runs/t1b-col-on_s3/snapshots/snap_t1200.json'}, 60, 10,
                    evals=[{"t": 1, "js": "return JSON.stringify({on: moire.predators.params.on, n: moire.cells.alive})"}]))

# ---- pictures: close-ups of wraps and phagosomes in both looks, a clip of one engulfment (default scene, predators dropped in the spot) ----
FW = "return JSON.stringify(await moire.predators.focus('wrap', 6))"
FD = "return JSON.stringify(await moire.predators.focus('digest', 6))"
NEON = "moire.control.action('harmonic'); return 'neon'"
pev = [{"t": 300, "js": DROP}, {"t": 359.9, "js": FW}, {"t": 361.9, "js": FD}, {"t": 363.9, "js": HARM}, {"t": 364.9, "js": FW}, {"t": 366.9, "js": FD},
       {"t": 368.9, "js": NEON}, {"t": 380.9, "js": "return JSON.stringify(await moire.predators.focus('wrap', 5))"},
       {"t": 420.9, "js": "moire.camera.fit(); return 'whole dish'"}]
psh = [{"t": 360, "name": "wrap_neon"}, {"t": 362, "name": "digest_neon"}, {"t": 365, "name": "wrap_harm"}, {"t": 367, "name": "digest_harm"},
       {"t": 421, "view": "marker", "name": "lineage_dish"}, {"t": 422, "name": "neon_dish"}]
pics = [run('pics', 'pictures: default scene, 20 predators dropped in the spot at 5 min; close-ups of a wrap and a phagosome in both looks, a clip',
            {}, 425, 30, shots=psh, evals=pev, extra={"clips": [{"t": 381, "until": 393, "speed": 1}], "dpr": 2})]
batch('pics', pics, [7, 3])

# ---- speed (as T1b's: headless Chrome, 1280 x 800, the default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s) ----
sp = []
for r in (1, 2, 3):
    for look in ('neon', 'harmonic'):
        q2 = {'seed': 3} if look == 'neon' else {'seed': 3, 'look': 'harmonic'}
        sp.append(run(f'speed-2k-{look}-r{r}', f'step P1 speed: default scene, 2000 cells, MAX, 150 s, {look}', q2, 150, 25))
        sp.append(run(f'speed-10k-{look}-r{r}', f'step P1 speed: default scene, 10000 cells, MAX, 60 s, {look}', {**q2, 'cells': 10000}, 60, 10))
for c in sp:
    c.pop('stall', None)
write('speed', {"batch": "p1-speed", "runs": sp})
# ... where it goes, at 10 000 cells (neon): engulfing off (no search, no wraps), the neutral control (the search runs, nothing is eaten)
spp = [run(f'speedparts-10k-{k}-r{r}', f'step P1 speed parts: 10000 cells, MAX, 60 s, neon, {k}', {'seed': 3, 'cells': 10000, **q}, 60, 10)
       for r in (1, 2) for k, q in (('off', {'engulf': 0}), ('null', {'engulfnull': 1}), ('on', {}))]
for c in spp:
    c.pop('stall', None)
write('speed-parts', {"batch": "p1-speedparts", "runs": spp})
print('ok')
