"""Step T1a, tissues 1 (an inside, kin channels, the self marker, wild / blank founders, the smell for trace): the conditions.
Run from the repository:
    python experiments/conditions/t1a/make.py

  pilot-<x>         short pilots (5 min, seed 3): the default scene with the inside on / off; six colonies with wild / blank founders
                                                                                              (batch-pilot.json)
  col-<f>-<scene>   the RANDOM-COLONY runs (EXPERIMENT STYLE FOR T1): ?spread=colonies&colonies=6, founders wild or blank, the default
                    lighting or the Oases preset, 30 min; snapshots every 5 min (lineages, positions, free sides), shots in the lineage
                    view and both looks                                                       (batch-col.json, seeds 3 and 7)
  null-<f>-<scene>  the same with the kin channels' NEUTRAL CONTROL (?kinnull=1: the genes drift, the channels move nothing)
                                                                                              (batch-null.json, seeds 3 and 7)
  oases-smell<x>    the Oases preset with the smell for trace on / off: cells within 15 R of an oasis vs chance at 10 / 20 / 30 min
                                                                                              (batch-oases.json, seed 3, 7)
  oxy-spot          the M1 oxygen spot dish (never-drying mineral spring, slow vent re-dropped), 40 min, seed 7 (M1 ran seed 3):
                    self-burners vs outside-t breathers                                       (batch-oxy.json)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
VENT = "moire.matter.addSpring(875, 472, 'heavy', 2.0); return moire.matter.springs.length"
START = ("moire.matter.clearSprings(); moire.matter.addSpring(875, 328, 'light', 1e9); moire.matter.addSpring(875, 472, 'heavy', 2.0);"
         " return moire.matter.springs.map(s => s.kind + ' ' + s.life)")
COL = {'spread': 'colonies', 'colonies': 6}
HARM = "moire.control.action('harmonic'); return 'harmonic'"


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def batch(name, runs, seeds):
    return write(f"batch-{name}", {"batch": f"t1a-{name}", "runs": runs, "seeds": seeds})


def run(name, desc, q, D, every=20, snaps=(), shots=(), evals=(), extra=None):
    c = {"name": f"t1a-{name}", "description": desc, "query": q, "duration": D, "sample_every": every,
         "snapshots": [{"t": t, "grid": True} for t in snaps if t <= D],
         "shots": list(shots), "evals": list(evals)}
    if extra:
        c.update(extra)
    return write(name, c)


def colony_shots(D):
    s = []
    for t in (300, 900, D - 3):
        s.append({"t": t, "view": "marker", "name": f"marker_t{t}"})
    s += [{"t": D - 3, "name": "neon"}, {"t": D - 3, "panel": True, "name": "panel"},
          {"t": D - 1, "name": "harmonic"}]
    return s


pil = [
    run('pilot-default', 'default scene, T1a on, 5 min', {}, 300, 10, snaps=(300,), shots=[{"t": 300, "panel": True, "name": "panel"}]),
    run('pilot-default-noin', 'default scene, ?inside=0, 5 min', {'inside': 0}, 300, 10, snaps=(300,), shots=[{"t": 300, "panel": True, "name": "panel"}]),
    run('pilot-wild', 'six colonies, wild founders, 5 min', {**COL, 'founders': 'wild'}, 300, 10, snaps=(300,),
        shots=[{"t": 300, "view": "marker", "name": "marker"}, {"t": 300, "panel": True, "name": "panel"}]),
    run('pilot-blank', 'six colonies, blank founders, 5 min', {**COL, 'founders': 'blank'}, 300, 10, snaps=(300,),
        shots=[{"t": 300, "view": "marker", "name": "marker"}, {"t": 300, "panel": True, "name": "panel"}]),
]
batch('pilot', pil, [3])

D = 1803
col, nul = [], []
for f in ('wild', 'blank'):
    for scene, sq in (('default', {}), ('oases', {'preset': 'oases'})):
        q = {**sq, **COL, 'founders': f}
        snaps = tuple(range(300, 1801, 300))
        evs = [{"t": D - 2, "js": HARM}]
        col.append(run(f"col-{f}-{scene}", f"six colonies, {f} founders, {scene}, 30 min", q, D, 20, snaps=snaps,
                       shots=colony_shots(D), evals=evs))
        nul.append(run(f"null-{f}-{scene}", f"six colonies, {f} founders, {scene}, 30 min, kin channels NEUTRAL CONTROL (?kinnull=1)",
                       {**q, 'kinnull': 1}, D, 20, snaps=snaps, shots=[{"t": D - 3, "view": "marker", "name": "marker_end"},
                                                                           {"t": D - 3, "panel": True, "name": "panel"}]))
batch('col', col, [3, 7])
noin = []
for scene, sq in (('default', {}), ('oases', {'preset': 'oases'})):
    noin.append(run(f"noin-wild-{scene}", f"six colonies, wild founders, {scene}, 30 min, the inside OFF (?inside=0): a control for the rim / inside numbers",
                    {**sq, **COL, 'founders': 'wild', 'inside': 0}, D, 20, snaps=tuple(range(300, 1801, 300)),
                    shots=[{"t": D - 3, "panel": True, "name": "panel"}]))
batch('noin', noin, [3])
batch('null', nul, [3, 7])

oas = []
for on in (1, 0):
    oas.append(run(f"oases-smell{on}", f"Oases preset, smell for trace {'on' if on else 'off'}, 30 min", {'preset': 'oases', 'smelltrace': on},
                   1800, 30, snaps=(600, 1200, 1800), shots=[{"t": 600}, {"t": 1800}, {"t": 1800, "panel": True, "name": "panel"}]))
batch('oases', oas, [3, 7])

oxy = [run('oxy-spot', 'the M1 oxygen spot dish, 40 min (M1 ran seed 3; this is the second seed)', {'electrons': 1}, 2403, 20,
           snaps=(600, 1200, 2400), shots=[{"t": 1200}, {"t": 2400}, {"t": 2400, "panel": True, "name": "panel"}],
           evals=[{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, 2400, 20)])]
batch('oxy', oxy, [7])
oxyn = [run('oxy-spot-null', 'the M1 oxygen spot dish, 40 min, kin channels NEUTRAL CONTROL (?kinnull=1)', {'electrons': 1, 'kinnull': 1}, 2403, 20,
            snaps=(1200, 2400), shots=[{"t": 2400, "panel": True, "name": "panel"}],
            evals=[{"t": 0, "js": START}] + [{"t": t, "js": VENT} for t in range(20, 2400, 20)])]
batch('oxynull', oxyn, [7])
# books check (as M1's): every T1a switch toggled at runtime, resizes, a snapshot saved and loaded, the add-cell tool, a New culture with
# WILD founders; atoms and charge rounding must stay 0
m1 = json.load(open(os.path.join(HERE, '..', 'm1', 'check.json'), encoding='utf-8'))
ev = [e for e in m1['evals'] if e['t'] not in (170, 190, 210, 230, 250, 270, 300)]
ev += [
    {"t": 170, "js": "moire.kin.params.inside = false; return 'inside off'"},
    {"t": 180, "js": "moire.kin.params.inside = true; moire.kin.params.channels = false; return 'inside on, kin channels off'"},
    {"t": 190, "js": "moire.kin.params.channels = true; moire.kin.params.blind = true; return 'channels blind'"},
    {"t": 200, "js": "moire.kin.params.blind = false; moire.kin.params.null = true; moire.kin.params.clock = false; moire.kin.params.smellTrace = false; return 'null, clock off, smell off'"},
    {"t": 210, "js": "moire.kin.params.null = false; moire.kin.params.clock = true; moire.kin.params.smellTrace = true; moire.kin.params.seal = 0.5; return 'all on, seal 0.5'"},
    {"t": 230, "js": "moire.kin.params.seal = 1; moire.kin.params.kinK = 20; return 'kinK 20 (fast sharing)'"},
    {"t": 260, "js": "moire.kin.params.kinK = 1; return 'kinK 1'"},
    {"t": 300, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 320, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('culture')"},
]
ev.sort(key=lambda e: e['t'])
chk = {**{k: v for k, v in m1.items() if k != 'evals'}, 'name': 't1a-check', 'evals': ev,
       'description': 'step T1a books check: 420 s at MAX (seed 5), the whole dish lit; springs; N, 40 cells placed, a wash, resizes (150, 220 s); '
                      'inside, kin channels, blind, null, clock, smell, seal, kinK toggled at runtime (170..260 s); G and N with wild founders '
                      '(300, 320 s); a snapshot saved and loaded at once (360 s); atoms and charge rounding must stay 0'}
write('check', chk)
sp = json.load(open(os.path.join(HERE, '..', 'm1', 'speed.json'), encoding='utf-8'))
for r in sp['runs']:
    r['name'] = r['name'].replace('m1-', 't1a-'); r['description'] = r['description'].replace('step M1', 'step T1a')
sp['batch'] = 't1a-speed'
write('speed', sp)
oldsnap = {"name": "t1a-reload-m1", "description": "an M1 snapshot (default scene at 10 min) loads with the T1a parts off and runs 60 s",
           "query": {"snap": "experiments/runs/m1-final-default_s3/snapshots/snap_t600.json"}, "duration": 60, "sample_every": 10}
write('reload', oldsnap)
# pictures from the colony runs' snapshots: the lineage view, zoomed close-ups of the marker texture (neon and harmonic)
def pics(name, run, t, zx, zy, z=5):
    cam = f"moire.camera.set({z}, {zx} * moire.control.view().cssW, {zy} * moire.control.view().cssH); return 'zoom'"
    fit = "moire.camera.fit(); return 'fit'"
    return run_(name, run, t, cam, fit)


def run_(name, run, t, cam, fit):
    c = {"name": f"t1a-{name}", "description": f"pictures from {run} at {t} s", "query": {"snap": f"experiments/runs/{run}/snapshots/snap_t{t}.json"},
         "duration": 6, "sample_every": 0, "dpr": 2,
         "evals": [{"t": 0.5, "js": fit}, {"t": 2, "js": cam}, {"t": 4.5, "js": HARM}],
         "shots": [{"t": 1, "view": "marker", "name": "lineage"}, {"t": 1, "name": "neon"},
                   {"t": 3, "view": "marker", "name": "zoom_lineage"}, {"t": 3, "name": "zoom_neon"},
                   {"t": 5.5, "name": "zoom_harmonic"}]}
    return write(name, c)


pv = [pics('pics-wild-oases', 't1a-col-wild-oases_s3', 1800, 0.45, 0.5), pics('pics-wild-default', 't1a-col-wild-default_s3', 1800, 0.66, 0.4)]
batch('pics', pv, [3])
print('written')
