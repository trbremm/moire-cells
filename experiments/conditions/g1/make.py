"""Step G1, error correction (the fidelity gene, proofreading): QUICK CHECKS only (the user: experiments are not valid until more changes land).
Run from the repository:
    python experiments/conditions/g1/make.py

  check        the books: 420 s at MAX (seed 5), the whole dish lit, springs; the fidelity gene set high for everyone (proofreading costs), N, a
               wash, every G1 switch toggled at runtime (null, off, on, cost x5, hard light beyond 0 / 1), a resize with G (wild founders),
               the gene sloppy (-2) then careful (3), key M off and on, turnover mode (births by turnover pay too) and back, a snapshot saved and
               loaded with the genes spread: atoms and charge rounding must stay 0
  reload       a P1 snapshot (genomes from before G1: word 31 = 0, the founders' value) loads and runs 60 s
  act          does it act? 25 min, the Colonies preset (wild founders) and the default scene (spotlight: hard light), fidelity on vs the
               NEUTRAL control (?fidelitynull=1), seeds 3 and 7 (batch-act.json): the gene's mean against the control, where (light / shade,
               tissue interior / loners), the self marker's match at contacts within lineages
  speed        2000 / 10 000 cells, neon, two runs each (as P1's)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FID = ("const c = await moire.fidelity.now(); return JSON.stringify({t: c.time, n: c.n, mean: c.mean, sd: c.sd, above: c.above, below: c.below, "
       "lit: c.lit, shade: c.shade, hard: c.hard, interior: c.interior, edge: c.edge, loner: c.loner, kin: c.kin, lineages: c.lineages, copy: c.copy})")
KIN = "const C = moire.kin.census; return JSON.stringify(C ? {kinship: C.kinship, accepted: C.accepted, strangers: C.strangers, n: C.n} : null)"


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def run(name, desc, q, D, every=30, snaps=(), shots=(), evals=(), extra=None):
    c = {"name": f"g1-{name}", "description": desc, "query": q, "duration": D, "sample_every": every, "stall": 200,
         "snapshots": [{"t": t} for t in snaps if t <= D], "shots": list(shots), "evals": list(evals)}
    if extra:
        c.update(extra)
    return c


# ---- the books ----
t1b = json.load(open(os.path.join(HERE, '..', 't1b', 'check.json'), encoding='utf-8'))
ev = [e for e in t1b['evals'] if e['t'] in (5, 60, 100, 105)]
FP = "moire.fidelity.params"
ev += [
    {"t": 30, "js": "await moire.genome.setAll({fidelity: 1.5}); return 'fidelity 1.5 for all'"},
    {"t": 70, "js": "await moire.genome.setAll({fidelity: 2.5}); return 'fidelity 2.5 for all'"},
    {"t": 90, "js": f"{FP}.null = true; return 'null'"},
    {"t": 110, "js": f"{FP}.null = false; {FP}.on = false; return 'off'"},
    {"t": 125, "js": f"{FP}.on = true; {FP}.cost = 0.5; return 'on, cost 0.5'"},
    {"t": 140, "js": f"{FP}.beyond = 0; return 'beyond 0'"},
    {"t": 150, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 165, "js": f"{FP}.beyond = 1; await moire.genome.setAll({{fidelity: -2}}); return 'beyond 1, sloppy'"},
    {"t": 185, "js": "moire.genome.rules.mut = false; return 'key M off'"},
    {"t": 200, "js": "moire.genome.rules.mut = true; await moire.genome.setAll({fidelity: 3}); return 'key M on, careful 3'"},
    {"t": 220, "js": "moire.division.params.on = false; return 'turnover mode'"},
    {"t": 260, "js": "moire.division.params.on = true; return 'division mode'"},
    {"t": 280, "js": f"{FP}.cost = 0.1; {FP}.beyond = 0.5; return 'defaults'"},
    {"t": 300, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); "
                     "return { exact: r.exact, notes: r.notes, rounding: r.rounding }"},
    {"t": 305, "js": FID},
    {"t": 340, "js": f"{FP}.null = true; return 'null'"},
    {"t": 360, "js": f"{FP}.null = false; return 'on'"},
    {"t": 418, "js": FID},
]
check = run('check', 'step G1 books check: 420 s at MAX (seed 5), the whole dish lit; springs; the gene set high for all (costs), N, a wash, '
            'null / off / on / cost x5 / beyond 0 and 1 toggled at runtime, a resize with G (wild founders), sloppy -2 then careful 3, key M off '
            'and on, turnover mode and back, a snapshot saved and loaded (300 s): atoms and charge rounding must stay 0',
            {'seed': 5, 'light': 'full'}, 420, 10, shots=[{"t": 420, "panel": True, "name": "panel"}],
            evals=sorted(ev, key=lambda e: e['t']), extra={"resizes": [{"t": 150, "size": "1000x700"}, {"t": 230, "size": "1280x800"}]})
write('check', check)

# ---- an old snapshot (before G1) ----
write('reload', run('reload-p1', 'a P1 snapshot (genomes from before G1: word 31 = 0) loads and runs 60 s',
                    {'snap': 'experiments/runs/p1-col-on_s3/snapshots/snap_t1200.json'}, 60, 10,
                    evals=[{"t": 1, "js": FID}, {"t": 59, "js": FID}]))

# ---- does it act? 25 min, on vs the neutral control ----
D = 1503
fe = [{"t": t, "js": FID} for t in (300, 600, 900, 1200, 1500)] + [{"t": t, "js": KIN} for t in (600, 1500)]
shots = [{"t": 1500.5, "view": "marker", "name": "marker_end"}, {"t": 1501, "panel": True, "name": "panel"}]
act = []
for scene, q in (('col', {'preset': 'colonies'}), ('def', {})):
    act.append(run(f'{scene}-on', f'{scene}: fidelity on, 25 min', q, D, 30, shots=shots, evals=fe))
    act.append(run(f'{scene}-null', f'{scene}: fidelity NEUTRAL CONTROL (?fidelitynull=1), 25 min', {**q, 'fidelitynull': 1}, D, 30, shots=shots, evals=fe))
write('batch-act', {"batch": "g1-act", "runs": act, "seeds": [3, 7]})

# ---- speed (as P1's: headless Chrome, 1280 x 800, the default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s) ----
sp = []
for r in (1, 2):
    sp.append(run(f'speed-2k-neon-r{r}', 'step G1 speed: default scene, 2000 cells, MAX, 150 s, neon', {'seed': 3}, 150, 25))
    sp.append(run(f'speed-10k-neon-r{r}', 'step G1 speed: default scene, 10000 cells, MAX, 60 s, neon', {'seed': 3, 'cells': 10000}, 60, 10))
for c in sp:
    c.pop('stall', None)
write('speed', {"batch": "g1-speed", "runs": sp})
print('ok')

# (as run: the GPU was shared with other workers' batches (about x0.15 at MAX), so the default-scene pair ran in its own processes, 20 min,
#  from batch-def.json, named g1-spot-*; batch-act.json's processes were stopped after their colony runs)
write('batch-def', {"batch": "g1-def", "runs": [dict(r, name=r['name'].replace('g1-def', 'g1-spot'), duration=1203, evals=[e for e in r['evals'] if e['t'] <= 1200] +
                                                  [{"t": 1200, "js": KIN}],
                                                  shots=[{"t": 1200.5, "view": "marker", "name": "marker_end"}, {"t": 1201, "panel": True, "name": "panel"}])
                                                 for r in act if r['name'].startswith('g1-def')], "seeds": [3, 7]})

# (as run, the same reason: the colonies' neutral control ran in its own processes from the start, 20 min, from batch-colnull.json, named g1-colctl; the
#  colonies' 'on' runs of batch-act.json were stopped once past 20 min (their samples to 1200 s are what is compared))
write('batch-colnull', {"batch": "g1-colnull", "runs": [dict(r, name='g1-colctl', duration=1203, evals=[e for e in r['evals'] if e['t'] <= 1200] + [{"t": 1200, "js": KIN}],
                                                          shots=[{"t": 1200.5, "view": "marker", "name": "marker_end"}, {"t": 1201, "panel": True, "name": "panel"}])
                                                     for r in act if r['name'] == 'g1-col-null'], "seeds": [3, 7]})

# (... and the default scene's neutral control too, named g1-spotctl, from batch-spotnull.json; batch-def.json's processes were stopped
#  after their 'on' runs)
bd = json.load(open(os.path.join(HERE, 'batch-def.json'), encoding='utf-8'))
write('batch-spotnull', {"batch": "g1-spotnull", "runs": [dict(r, name='g1-spotctl') for r in bd['runs'] if r['name'] == 'g1-spot-null'], "seeds": [3, 7]})
