"""Step G2, gene duplication for engines and pumps: QUICK CHECKS (the user: experiments are not valid until more changes land).
Run from the repository:
    python experiments/conditions/g2/make.py

  smoke        240 s, the default scene, duplication x10 (0.2 a birth): do copies appear, drift, get lost; the census and panel line
  check        the books: 420 s at MAX (seed 5), the whole dish lit, springs; duplication x10, every G2 switch toggled at runtime (null, off,
               on), a resize with G (wild founders), key M off and on, turnover mode and back, a snapshot saved and loaded (copies spread):
               atoms and charge rounding must stay 0
  reload       a snapshot from before G2 (genomes of 156 words, made on the branch's base commit) loads and runs 60 s
  act          does it act? 20 min, the default scene and the Colonies preset, duplication on vs its NEUTRAL control (?dupnull=1) vs off
               (?dup=0), seeds 3 and 7 (batch-act.json); plus the Oxygen preset (lit, oxygen world) on vs null, seeds 3 and 7 (batch-oxy.json)
  speed        2000 / 10 000 cells, neon, on and off, as G1's
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DUPJS = ("const c = await moire.dup.now(); return JSON.stringify({t: c.time, n: c.n, working: c.working, acting: c.acting, withCopy: c.withCopy, "
         "engCopy: c.engCopy, pumpCopy: c.pumpCopy, copies: c.copies, fate: c.fate, battery: c.battery, lineDups: c.lineDups, "
         "fam: {n: c.families.n, all: c.families.all, branched: c.families.branched, inCell: c.families.inCell, top: c.families.top}, "
         "pfam: {n: c.pumpFamilies.n, branched: c.pumpFamilies.branched, top: c.pumpFamilies.top}, rates: c.rates})")


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def run(name, desc, q, D, every=30, snaps=(), shots=(), evals=(), extra=None):
    c = {"name": f"g2-{name}", "description": desc, "query": q, "duration": D, "sample_every": every, "stall": 200,
         "snapshots": [{"t": t} for t in snaps if t <= D], "shots": list(shots), "evals": list(evals)}
    if extra:
        c.update(extra)
    return c


# ---- smoke ----
write('smoke', run('smoke', 'step G2 smoke: default scene, duplication 0.2 a birth (x10), 240 s', {'seed': 3, 'duprate': 0.2, 'dupcensus': 10},
                   240, 20, evals=[{"t": t, "js": DUPJS} for t in (60, 120, 239)], shots=[{"t": 238, "panel": True, "name": "panel"}]))

# ---- the books ----
t1b = json.load(open(os.path.join(HERE, '..', 't1b', 'check.json'), encoding='utf-8'))
ev = [e for e in t1b['evals'] if e['t'] in (5, 60, 100, 105)]
DP = "moire.dup.params"
ev += [
    {"t": 30, "js": f"{DP}.rate = 0.3; {DP}.del = 0.1; return 'dup 0.3, del 0.1'"},
    {"t": 90, "js": f"{DP}.null = true; return 'null'"},
    {"t": 110, "js": f"{DP}.null = false; {DP}.on = false; return 'off'"},
    {"t": 125, "js": f"{DP}.on = true; return 'on'"},
    {"t": 140, "js": DUPJS},
    {"t": 150, "js": "moire.genome.params.founderMode = 'wild'; return moire.control.action('genomes')"},
    {"t": 185, "js": "moire.genome.rules.mut = false; return 'key M off'"},
    {"t": 200, "js": "moire.genome.rules.mut = true; return 'key M on'"},
    {"t": 220, "js": "moire.division.params.on = false; return 'turnover mode'"},
    {"t": 260, "js": "moire.division.params.on = true; return 'division mode'"},
    {"t": 280, "js": f"{DP}.rate = 0.02; {DP}.del = 0.02; return 'defaults'"},
    {"t": 300, "js": "const S = await moire.snapshot({ grid: true }); const r = await moire.loadSnapshot(S); "
                     "return JSON.stringify({ exact: r.exact, notes: r.notes, rounding: r.rounding })"},
    {"t": 305, "js": DUPJS},
    {"t": 340, "js": f"{DP}.null = true; return 'null'"},
    {"t": 360, "js": f"{DP}.null = false; {DP}.rate = 0.3; return 'on, 0.3'"},
    {"t": 418, "js": DUPJS},
]
check = run('check', 'step G2 books check: 420 s at MAX (seed 5), the whole dish lit; springs; duplication 0.3 / loss 0.1 a birth, null / off / on '
            'toggled at runtime, a resize with G (wild founders), key M off and on, turnover mode and back, a snapshot saved and loaded (300 s): '
            'atoms and charge rounding must stay 0', {'seed': 5, 'light': 'full'}, 420, 10, shots=[{"t": 420, "panel": True, "name": "panel"}],
            evals=sorted(ev, key=lambda e: e['t']), extra={"resizes": [{"t": 150, "size": "1000x700"}, {"t": 230, "size": "1280x800"}]})
write('check', check)

# ---- an old snapshot (before G2) ----
write('reload', run('reload-pre', 'a snapshot from before G2 (genomes of 156 words) loads and runs 60 s',
                    {'snap': 'experiments/runs/g2-pre/snapshots/snap_t120.json'}, 60, 10,
                    evals=[{"t": 1, "js": DUPJS}, {"t": 59, "js": DUPJS}]))

# ---- does it act? 20 min, on vs the neutral control vs off ----
D = 1203
fe = [{"t": t, "js": DUPJS} for t in (300, 600, 900, 1200)]
shots = [{"t": 1200.5, "name": "end"}, {"t": 1201, "panel": True, "name": "panel"}]
act = []
for scene, q in (('def', {}), ('col', {'preset': 'colonies'})):
    act.append(run(f'{scene}-on', f'{scene}: duplication on, 20 min', q, D, 30, shots=shots, evals=fe))
    act.append(run(f'{scene}-null', f'{scene}: duplication NEUTRAL CONTROL (?dupnull=1), 20 min', {**q, 'dupnull': 1}, D, 30, shots=shots, evals=fe))
    act.append(run(f'{scene}-off', f'{scene}: no duplication (?dup=0), 20 min', {**q, 'dup': 0}, D, 30, shots=shots, evals=fe))
write('batch-act', {"batch": "g2-act", "runs": act, "seeds": [3, 7]})
oxy = []
for tag, q in (('on', {}), ('null', {'dupnull': 1})):
    oxy.append(run(f'oxy-{tag}', f'Oxygen preset (lit): duplication {tag}, 20 min', {'preset': 'oxygen', **q}, D, 30, shots=shots, evals=fe))
write('batch-oxy', {"batch": "g2-oxy", "runs": oxy, "seeds": [3, 7]})
# (as run: the Oxygen preset died in the founders' crash in both seeds by 210 s, before any duplication (known since C12e: photolysis off);
#  its batch was stopped and replaced by the default scene under the WHOLE DISH LIT, on vs null, seeds 3 and 7 (batch-lit.json))
lit = []
for tag, q in (('on', {}), ('null', {'dupnull': 1})):
    lit.append(run(f'lit-{tag}', f'default scene, whole dish lit (?light=full): duplication {tag}, 20 min', {'light': 'full', **q}, D, 30, shots=shots, evals=fe))
write('batch-lit', {"batch": "g2-lit", "runs": lit, "seeds": [3, 7]})

# ---- speed (as G1's: headless Chrome, 1280 x 800, the default scene, seed 3, MAX; 2000 cells 150 s, 10 000 60 s) ----
sp = []
for r in (1, 2):
    for tag, q in (('on', {}), ('off', {'dup': 0})):
        sp.append(run(f'speed-2k-{tag}-r{r}', f'step G2 speed: default scene, 2000 cells, MAX, 150 s, neon, duplication {tag}', {'seed': 3, **q}, 150, 25))
        sp.append(run(f'speed-10k-{tag}-r{r}', f'step G2 speed: default scene, 10000 cells, MAX, 60 s, neon, duplication {tag}', {'seed': 3, 'cells': 10000, **q}, 60, 10))
for c in sp:
    c.pop('stall', None)
write('speed', {"batch": "g2-speed", "runs": sp})
print('ok')

# ---- pictures: copies drawn as parts (duplication x10 so they are common; the default scene and the Colonies preset; neon and harmonic) ----
ZOOM = ("const w = (await moire.dup.where(40, 'new')).concat(await moire.dup.where(40)); if (!w.length) return 'none'; "
        "const c = w[0]; moire.camera.set(5, c.x, c.y); return JSON.stringify(w.slice(0, 6))")
pics = []
for scene, q in (('def', {}), ('col', {'preset': 'colonies'})):
    for look, lq in (('neon', {}), ('harm', {'look': 'harmonic'})):
        pics.append(run(f'pics-{scene}-{look}', f'pictures: {scene}, {look}, duplication 0.2 a birth (x10), 300 s', {'seed': 3, 'duprate': 0.2, **q, **lq}, 302, 60,
                        evals=[{"t": 299, "js": ZOOM}, {"t": 301.5, "js": "moire.camera.fit(); return 'fit'"}],
                        shots=[{"t": 298, "name": "wide"}, {"t": 300, "name": "zoom"}, {"t": 300.5, "panel": True, "name": "zoom_panel"}]))
write('pics', {"batch": "g2-pics", "runs": pics})
