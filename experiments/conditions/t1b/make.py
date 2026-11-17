"""Step T1b, the gene regulatory network + the reporter view: the conditions.
Run from the repository:
    python experiments/conditions/t1b/make.py

  col-on            the COLONIES preset (five colonies of wild founders, each its own lasting spring and slow vent, a moderate light
                    over the whole dish), the gene network on, 40 min; the network's census (cell types per lineage, where they sit,
                    which outputs differ) every 15 s in the samples and in full at 10 / 20 / 30 / 40 min (evals); lineage view, reporter
                    view (the most varied regulator), harmonic reporter, panel                  (batch-col.json, seeds 3, 7, 11)
  col-null          the same with the network's NEUTRAL CONTROL (?grnnull=1: it runs and mutates, its outputs have no effect)
  vent              the Deep vents preset with a random gene network on std founders (?founders=wild&wild=grn: only the network
                    wild), 40 min: does expression-scaled upkeep let life hold in the dark?    (batch-vent.json, seeds 3, 7)
  vent-null         ... its neutral control (?grnnull=1)
  default           the default scene once, 20 min, seed 3 (std founders: no network at the start)   (batch-default.json)
  check, speed, reload, same: the books check, speed (2000 / 10 000 cells, neon / harmonic), a T1a snapshot reloads, zero network = before
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HARM = "moire.control.action('harmonic'); return 'harmonic'"
CENSUS = ("const c = await moire.grn.typesNow(); return JSON.stringify({t: c.time, n: c.n, types: c.types, diff: c.diff, border: c.border, net: c.net, "
          "reporter: c.reporter, senses: c.senses, factors: c.factors, lineages: c.lineages})")
BEST = "const c = await moire.grn.typesNow(); moire.grn.look.reporter = c.reporter.best ?? 0; return 'reporter r' + moire.grn.look.reporter"


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def batch(name, runs, seeds):
    return write(f"batch-{name}", {"batch": f"t1b-{name}", "runs": runs, "seeds": seeds})


def run(name, desc, q, D, every=30, snaps=(), shots=(), evals=(), extra=None):
    c = {"name": f"t1b-{name}", "description": desc, "query": q, "duration": D, "sample_every": every,
         "snapshots": [{"t": t} for t in snaps if t <= D], "shots": list(shots), "evals": list(evals)}
    if extra:
        c.update(extra)
    return write(name, c)


D = 2403
census = [{"t": t, "js": CENSUS} for t in (600, 1200, 1800, 2400)]
best = [{"t": 1199, "js": BEST}, {"t": 2396, "js": BEST}, {"t": 2401, "js": HARM}]
shots = [{"t": 600, "view": "marker", "name": "marker_t600"}, {"t": 1200, "view": "marker", "name": "marker_t1200"},
         {"t": 1200, "view": "reporter", "name": "reporter_t1200"}, {"t": 2397, "view": "marker", "name": "marker_end"},
         {"t": 2397, "view": "reporter", "name": "reporter_end"}, {"t": 2398, "name": "neon"}, {"t": 2399, "view": "reporter", "panel": True, "name": "panel"},
         {"t": 2402, "view": "reporter", "name": "harm_reporter"}, {"t": 2402.5, "name": "harm"}]
col = [run('col-on', 'colonies preset (wild founders, habit both), gene network on, 40 min', {'preset': 'colonies'}, D, 30,
           snaps=(1200, 2400), shots=shots, evals=census + best),
       run('col-null', 'colonies preset, gene network NEUTRAL CONTROL (?grnnull=1), 40 min', {'preset': 'colonies', 'grnnull': 1}, D, 30,
           snaps=(2400,), shots=[s for s in shots if s['name'] in ('marker_end', 'reporter_end', 'panel')], evals=census + best[1:2])]
batch('col', col, [3, 7, 11])

vshots = [{"t": 300, "name": "neon_t300"}, {"t": 1200, "name": "neon_t1200"}, {"t": 2397, "name": "neon_end"},
          {"t": 2398, "view": "reporter", "name": "reporter_end"}, {"t": 2399, "panel": True, "name": "panel"}]
vent = [run('vent', 'Deep vents preset, a random gene network (?founders=wild&wild=grn), 40 min', {'preset': 'vent', 'founders': 'wild', 'wild': 'grn'},
            D, 30, snaps=(1200, 2400), shots=vshots, evals=[{"t": t, "js": CENSUS} for t in (300, 1200, 2400)] + [{"t": 2396, "js": BEST}]),
        run('vent-null', 'Deep vents preset, random network, NEUTRAL CONTROL (?grnnull=1), 40 min',
            {'preset': 'vent', 'founders': 'wild', 'wild': 'grn', 'grnnull': 1}, D, 30, snaps=(2400,), shots=[{"t": 2399, "panel": True, "name": "panel"}],
            evals=[{"t": t, "js": CENSUS} for t in (300, 1200, 2400)])]
batch('vent', vent, [3, 7])

dflt = [run('default', 'default scene, 20 min (std founders: no network at the start; mutation adds one)', {}, 1203, 30, snaps=(1200,),
            shots=[{"t": 600}, {"t": 1200, "panel": True, "name": "panel"}, {"t": 1201, "view": "reporter", "name": "reporter"}],
            evals=[{"t": t, "js": CENSUS} for t in (600, 1200)] + [{"t": 1199, "js": BEST}])]
batch('default', dflt, [3])

# books check (as T1a's): every T1b switch toggled at runtime, resizes, a snapshot saved and loaded, the add-cell tool, a New culture with
# WILD founders (now with a random network); atoms and charge rounding must stay 0
t1a = json.load(open(os.path.join(HERE, '..', 't1a', 'check.json'), encoding='utf-8'))
ev = [e for e in t1a['evals'] if e['t'] not in (170, 180, 190, 200, 210, 230, 260)]
ev += [
    {"t": 140, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 170, "js": "moire.grn.params.null = true; return 'grn null'"},
    {"t": 180, "js": "moire.grn.params.null = false; moire.grn.params.signal = false; return 'signal off'"},
    {"t": 190, "js": "moire.grn.params.signal = true; moire.grn.params.kinWeight = false; moire.grn.params.mutate = false; return 'kin weight off, mutation off'"},
    {"t": 200, "js": "moire.grn.params.kinWeight = true; moire.grn.params.mutate = true; moire.grn.params.on = false; return 'network off'"},
    {"t": 210, "js": "moire.grn.params.on = true; moire.grn.params.tau = 0.5; moire.grn.params.rewire = 0.5; moire.grn.params.dup = 0.2; return 'fast network, heavy rewiring'"},
    {"t": 240, "js": "moire.grn.params.tau = 5; moire.grn.params.rewire = 0.05; moire.grn.params.dup = 0.005; moire.cells.look.view = 7; moire.grn.look.reporter = 3; return 'defaults, reporter view'"},
    {"t": 260, "js": "moire.control.action('harmonic'); return 'harmonic'"},
    {"t": 280, "js": "moire.control.action('harmonic'); moire.cells.look.view = 0; return 'neon'"},
]
ev.sort(key=lambda e: e['t'])
chk = {**{k: v for k, v in t1a.items() if k != 'evals'}, 'name': 't1b-check', 'evals': ev,
       'description': 'step T1b books check: 420 s at MAX (seed 5), the whole dish lit; springs; N, 40 cells placed, a wash, resizes (150, 220 s); '
                      'G with wild founders (140 s: random networks); the network null, signal, kin weighting, mutation, the whole network '
                      'toggled at runtime, a fast tau with heavy rewiring and duplication (170..240 s); the reporter view in both looks (240..280 s); '
                      'G and N with wild founders (300, 320 s); a snapshot saved and loaded at once (360 s); atoms and charge rounding must stay 0'}
write('check', chk)
sp = json.load(open(os.path.join(HERE, '..', 't1a', 'speed.json'), encoding='utf-8'))
for r in sp['runs']:
    r['name'] = r['name'].replace('t1a-', 't1b-'); r['description'] = r['description'].replace('step T1a', 'step T1b')
sp['batch'] = 't1b-speed'
write('speed', sp)
write('reload', {"name": "t1b-reload-t1a", "description": "a T1a snapshot (six wild colonies, default scene, 10 min) loads with the network off and runs 60 s",
                 "query": {"snap": "experiments/runs/t1a-col-wild-default_s3/snapshots/snap_t600.json"}, "duration": 60, "sample_every": 10})
