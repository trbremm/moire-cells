"""C15 carbon: design checks of the energy table (scratch, not part of the repo).

Reproduces the C12d electron table (src/matter.js: ELEC, valence, atomGap, eBond, gapBand) and adds the BUILDER c.
Run: python -I carbon_check.py
"""
from fractions import Fraction as F
from itertools import product

# ---------- C12d as built ----------
PULL = {'giver': F(5, 4), 'linker': F(5, 2), 'taker': F(11, 2), 'builder': F(2)}   # builder: NEW (C15)
MATCH, SHARE_L, TOL = F(1, 4), F(1, 4), F(1, 2)
SHARE = {'linker': F(1, 4), 'builder': F(1, 2)}   # per row; builder NEW: shares twice as strongly as a linker
CROWD = {'giver': 1, 'taker': 1, 'linker': 1, 'builder': 2}   # NEW: spark x2 on a bond to a four-handed atom
BANDS = [('warm', 1), ('V1', 2), ('V2', 3), ('hard', 5)]
ATOMS = {'g': (1, 'giver'), 't': (1, 'taker'), 'l': (1, 'linker'), 'G': (2, 'giver'), 'T': (2, 'taker'),
         'L': (2, 'linker'), 'c': (1, 'builder')}


def levels(a):
    r, grp = ATOMS[a]
    return [-PULL[grp] / 2 ** k for k in range(r + 1)]


def valence(a):
    r, grp = ATOMS[a]
    return -PULL[grp] / 2 ** (r - 1)


def atom_gap(a):
    r, grp = ATOMS[a]
    return PULL[grp] / 2 ** r


SHARERS = ('linker', 'builder')


def bond(a, b):
    (ra, ga), (rb, gb) = ATOMS[a], ATOMS[b]
    if ga == gb and ga in ('giver', 'taker'):
        return None
    if ga in SHARERS and gb in SHARERS:
        rel = (SHARE[ga] + SHARE[gb]) / 2 * (ra + rb)
        return dict(rel=rel, gap=rel, donor=None, polar=False)
    d, c = (a, b) if valence(a) >= valence(b) else (b, a)
    rel = valence(d) - valence(c) + (MATCH if ra == rb else 0)
    # NEW polarity rule: a bond is POLAR when its electron falls by >= 1 (grip difference); shared bonds are apolar
    return dict(rel=rel, gap=rel + atom_gap(d), donor=d, polar=(valence(d) - valence(c)) >= 1)


def spark(a, b):
    (ra, ga), (rb, gb) = ATOMS[a], ATOMS[b]
    return F(1, 8) * (ra + rb) * max(CROWD[ga], CROWD[gb])


def band(gap):
    best = -1
    for k, (_, p) in enumerate(BANDS):
        if abs(p - gap) <= TOL and (best < 0 or abs(p - gap) < abs(BANDS[best][1] - gap)):
            best = k
    return BANDS[best][0] if best >= 0 else '-'


def f(x):
    return str(x) if x.denominator == 1 else f'{float(x):g}'


out = []
P = out.append
P('## 1. atoms (levels: shell 1 .. empty shell)')
for a in ATOMS:
    P(f'  {a}: {ATOMS[a][1]:8s} row {ATOMS[a][0]}  levels {[f(x) for x in levels(a)]}  grip {f(valence(a))}  atom gap {f(atom_gap(a))} -> {band(atom_gap(a))}')

P('\n## 2. bonds (released, gap -> band, spark, polar?)')
for a, b in [('g', 't'), ('g', 'T'), ('G', 't'), ('G', 'T'), ('l', 'l'), ('L', 'L'), ('l', 'L'), ('g', 'l'), ('t', 'l'),
             ('c', 'g'), ('c', 't'), ('c', 'c'), ('c', 'G'), ('c', 'T'), ('c', 'l')]:
    B = bond(a, b)
    P(f'  {a}-{b}: rel {f(B["rel"]):7s} gap {f(B["gap"]):7s} -> {band(B["gap"]):5s} spark {f(spark(a, b)):6s} polar {B["polar"]}')

E = {k: bond(*k)['rel'] for k in [('c', 'g'), ('c', 't'), ('c', 'c'), ('g', 't'), ('g', 'T'), ('G', 'T'), ('G', 't')]}
Ecg, Ect, Ecc, Egt = E[('c', 'g')], E[('c', 't')], E[('c', 'c')], E[('g', 't')]
for x in E.values():
    assert (16 * x).denominator == 1, 'not a multiple of 1/16'

P('\n## 3. polarity rule check (bond rule vs the C12 atom-charge classes)')
c12 = {'gt': 'polar', 'gT': 'polar', 'Gt': 'polar', 'GT': 'polar', 'll': 'apolar', 'LL': 'apolar', 'lL': 'apolar',
       'glL': 'amphiphile', 'tlL': 'amphiphile'}
for name, cls in c12.items():
    at = list(name)
    bonds = [bond(at[i], at[i + 1]) for i in range(len(at) - 1)]
    pol = [b['polar'] for b in bonds]
    new = 'apolar' if not any(pol) else ('amphiphile' if pol[0] and not any(pol[1:]) and len(pol) > 1 else 'polar')
    P(f'  {name}: C12 {cls:10s} bond rule {new:10s} {"OK" if new == cls else "DIFFERS"}')

# ---------- the C1 ladder: c with k g-hands and 4-k t-hands ----------
P('\n## 4. one-carbon ladder (S_k = c g_k t_(4-k)); energy = -(sum of hand bonds); group-sum charge; chi per bond')
names = {4: 'methane-like', 3: 'methanol-like', 2: 'sugar-unit-like', 1: 'formic-like', 0: 'CO2-like'}
S = {}
for k in range(4, -1, -1):
    e = -(k * Ecg + (4 - k) * Ect)
    chi = F(k - (4 - k), 4)
    bands = sorted(({band(bond('c', 'g')['gap'])} if k > 0 else set()) | ({band(bond('c', 't')['gap'])} if k < 4 else set()))
    S[k] = e
    spread = 1.2 * 0.7 ** 4
    P(f'  S{k} c g{k} t{4 - k} ({names[k]:15s}) E {f(e):7s} charge {k - (4 - k):+d} chi {f(chi):5s} absorbs {bands} spread {spread:.2f} R2/s')

P('\n## 5. reactions (release > 0 = downhill)')
ox = Ect - Ecg
cond = Ecc + Egt - Ecg - Ect
R = [
    ('OXIDIZE   t + [c-g] -> [c-t] + g', ox),
    ('BOND      g + t -> gt', Egt),
    ('full burn [c-g] + 2t -> [c-t] + gt', ox + Egt),
    ('CONDENSE  [c-g] + [c-t] -> [c-c] + gt', cond),
    ('HYDROLYZE gt + [c-c] -> [c-g] + [c-t]', -cond),
    ('REDUCE    g + [c-t] -> [c-g] + t', -ox),
    ('inorganic breathe t + gT -> gt + T', bond('g', 't')['rel'] + 0 - bond('g', 'T')['rel']),
    ('inorganic ferment G + gT -> GT + g', bond('G', 'T')['rel'] - bond('g', 'T')['rel']),
    ('methane fully burnt: S4 + 8t -> S0 + 4gt', S[4] - S[0] + 4 * Egt),
]
for n, r in R:
    P(f'  {n:42s} {f(r):7s}')
P(f'  per free t: carbon breathing {f((ox + Egt) / 2)} vs inorganic t+gT 3 ; carbon breathing/fermenting per hand = {float((ox + Egt) / cond):.1f}x')

P('\n## 6. the backbone strength decides tar (E_cc sweep; Zc = 2)')
for ecc in [F(1, 8), F(1, 2), F(1), F(3, 2), F(2)]:
    c = ecc + Egt - Ecg - Ect
    P(f'  E_cc {f(ecc):5s}: condense {"releases" if c > 0 else "costs"} {f(abs(c))}; c-c gap {f(ecc)} -> {band(ecc)};'
      f' breathe/ferment {float((ox + Egt) / c) if c > 0 else float("inf"):.1f}x')

P('\n## 7. pull sweep for the builder (why Zc = 2)')
for z in [F(3, 2), F(7, 4), F(2), F(9, 4), F(5, 2), F(3)]:
    eg = z - F(5, 4) + MATCH
    et = F(11, 2) - z + MATCH
    pol_cg = (z - F(5, 4)) >= 1
    P(f'  Zc {f(z):5s}: c-g {f(eg):6s} c-t {f(et):6s} oxidize {f(et - eg):6s} breathe/t {f((et - eg + Egt) / 2):6s}'
      f' c-g polar? {pol_cg} (methane {"water-loving" if pol_cg else "oily"})')

P('\n## 8. photosynthesis: CO2-like back to methane-like, per hand')
P(f'  split water gt -> g + t: rise {f(Egt)} (hard 5, or V2 3 + battery 1.5)')
P(f'  reduce g + [c-t] -> [c-g] + t: rise {f(-(-ox))} ... absorber [c-t] gap {f(bond("c","t")["gap"])} -> {band(bond("c","t")["gap"])};'
  f' in a cell: V2 photon 3 >= {f(ox)} (spark {f(spark("c","t"))} from the battery)')
P(f'  total {f(Egt + ox)} = exactly what breathing gives back: needs >= 2 photons (no band holds {f(Egt + ox)}): a Z-scheme')
P(f'  open dish (photolysis on): reduce needs photon >= rise + half spark = {f(ox + spark("c","t") / 2)} -> hard only (CO2 made into fuel by UV only)')

P('\n## 9. no free-energy loop (battery over closed cycles; ineff 1/4, sparks paid uphill, given back downhill)')
ineff = F(1, 4)
cycles = {
    'oxidize then reduce (dark: battery pays)': [('down', ox, spark('c', 'g')), ('up', ox, spark('c', 't'))],
    'condense then hydrolyze': [('down', cond, spark('c', 'c')), ('up', cond, spark('c', 'c'))],
    'methane burnt to CO2-like, fixed back by battery': [('down', 4 * (ox + Egt), 0), ('up', 4 * (ox + Egt), 8 * spark('c', 't'))],
}
for n, steps in cycles.items():
    bat = sum((1 - ineff) * r if d == 'down' else -(r + s) for d, r, s in steps)
    P(f'  {n:50s} battery net {f(bat)} (<0: no perpetual motion)')
P('  (energies are a state function: every species = minus its bonds; any closed cycle has zero total change, so only light can make the')
P('   battery gain round a cycle, and only light that a pigment catches pays an uphill step: HARVESTERS MUST BURN holds unchanged)')

# ---------- option R (recommended): lipids from carbon (C2 molecules) ----------
P('\n## 10. option R: lipids made of carbon (C2: two carbons, one c-c, 6 hands); head/tail read per carbon')
def c2(hA, hB):   # hands of carbon A, B: (g, t)
    e = -(Ecc + (hA[0] + hB[0]) * Ecg + (hA[1] + hB[1]) * Ect)
    head = sum(1 for h in (hA, hB) if h[1] > 0) / 2
    tail = 1 - head
    cls = 'apolar' if head == 0 else ('amphiphile' if head < 1 else 'polar')
    beta = 2 * min(head, tail) if cls == 'amphiphile' else 0
    return e, cls, tail - head if cls != 'amphiphile' else 0, beta
for nm, hA, hB in [('oil c2 g6', (3, 0), (3, 0)), ('soap1 c2 g5 t', (2, 1), (3, 0)), ('soap2 c2 g4 t2', (1, 2), (3, 0)),
                   ('gunk c2 g3 t3 (-> tar)', (2, 1), (1, 2))]:
    e, cls, chi, beta = c2(hA, hB)
    P(f'  {nm:24s} E {f(e):8s} {cls:10s} chi {chi:+.2f} beta {beta:.2f}')
P('  condensations of the ladder (S_a gives a g-hand, S_b a t-hand), each releases ' + f(cond) + ':')
for ka, kb in product(range(1, 5), range(0, 4)):
    A = (ka - 1, 4 - ka)
    Bh = (kb, 3 - kb)
    tA, tB = A[1], Bh[1]
    prod_ = {(0, 0): 'oil', (1, 0): 'soap1', (0, 1): 'soap1', (2, 0): 'soap2', (0, 2): 'soap2'}.get((tA, tB), 'tar')
    if prod_ != 'tar':
        P(f'    S{ka} + S{kb} -> {prod_} + gt')
P('  oxidation runs down the lipids: oil + t -> soap1 + g -> soap2 + g -> gunk (tar): oxygen turns fat to soap to crust,')
P('  which is also how membranes are damaged (lipid peroxidation): no separate bite rule')

# ---------- tar ----------
P('\n## 11. tar = three hand counts (cc, cg, ct), immobile; carbon atoms = (2cc + cg + ct)/4')
for n, d in [('oxidize', (0, -1, +1)), ('condense', (+1, -1, -1)), ('hydrolyze', (-1, +1, +1)), ('reduce', (0, +1, -1))]:
    w = 2 * d[0] + d[1] + d[2]
    P(f'  {n:10s} d(cc,cg,ct) = {d}  d(2cc+cg+ct) = {w}  (carbon conserved: {w == 0})')
P(f'  an S_k molecule retired into tar adds (0, k, 4-k): weighted sum 4 per count, energy unchanged (same bonds)')

# ---------- GPU budget ----------
P('\n## 12. heat-buffer budget at 300 000 pixels (MAX_PIXELS), 128 MiB default binding limit')
LED = 32256
for nm, blocks in [('today (4 + 2x18 + 4 oil + 3 pig + 2 charge + 3 water)', 52),
                   ('fallback S: + C1 5 + tar 3 (x2 copies)', 52 + 16),
                   ('option R: 20 channels (x2) instead of 18', 52 + 4),
                   ('option R + 8 species slots (X1 later)', 52 + 4 + 16),
                   ('option R + 16 species slots', 52 + 4 + 32)]:
    mb = (LED + blocks * 300000) * 4 / 2 ** 20
    P(f'  {nm:58s} {blocks:3d} blocks  {mb:6.1f} MiB  {"OK" if mb < 128 else "OVER: raise requiredLimits"}')

print('\n'.join(out))
