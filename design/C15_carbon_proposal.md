# C15 CARBON: design proposal (draft for the coordinator)

Design only: nothing in the repo was changed. The numbers come from `carbon_check.py` (same folder; output in
`carbon_check_output.txt`), which copies the C12d rules from `src/matter.js` (ELEC, valence, atomGap, eBond, gapBand) and
adds the new atom.

The user (2026-11-17): "our chemistry should have a carbon like element", "yes, carbon sooner", and, during this design,
"rebalance the whole chemistry if needed". So there are two options below:

- **R (recommended): ONE BUILDER.** Carbon takes over everything the linkers do today: oil, soap, crust/walls and pigments
  become carbon molecules, and the linkers l and L are retired. The inorganic part of the C12d table (g t G T, minerals,
  fuels gT GT, rust, breathing t + gT, the vents' G + T) stays exactly as it is. We get there in stages, and every stage
  can be looked at.
- **S (fallback): SIDECAR.** Carbon is added next to today's chemistry (its fuel ladder, tar and four engines). Linkers,
  oil, soap and crust stay as they are. S is the same as the first two stages of R, so choosing R costs nothing up front:
  if R's third stage looks worse, we stop and keep S.

---

## 1. The atom

### 1.1 One light builder `c`, no heavy `C`

| atom | group | row | levels (shell 1, empty shell) | grip (valence) | atom gap -> band |
|---|---|---|---|---|---|
| g | giver | 1 | -1.25, -0.625 | -1.25 | 0.625 warm |
| **c** | **builder (4 hands)** | 1 | **-2, -1** | **-2** | **1 warm** |
| l (today) | linker (2 hands) | 1 | -2.5, -1.25 | -2.5 | 1.25 warm |
| t | taker | 1 | -5.5, -2.75 | -5.5 | 2.75 V2 |

- **Pull Zc = 2**, by the C12d ladder rule (shell k at -Z/2^(k-1)). That puts carbon's grip between the giver and the old
  linker, close to the giver, as real carbon sits close to hydrogen. Why exactly 2 (pull sweep, section 7 of the
  check): it is the strongest grip at which a carbon-giver bond is still **water-shy**, i.e. its grip difference is
  below 1 (see 1.3). At 2.25 or above, the methane-like molecule would come out water-loving. Lower values (1.5, 1.75)
  also work but give a weaker c-g bond. 2 is the round middle.
- **Four hands.** A hand holds g, t or another c. Carbon is never free: all four hands are always filled, so there is no
  "free c" channel and no free radical to handle.
- **Hands hold only row-1 atoms (g, t, c).** This is a simplification, justified by crowding: four hands leave room only
  for small atoms. Heavy G and T stay in the inorganic chemistry. (Without this rule, G + [c-g] -> [c-G] + g would release
  0.375, and T could never oxidise carbon anyway: c-T releases 0.75, less than c-g's 1.)
- **No heavy builder C (silicon-like) for now.** On this ladder its grip would be -1, looser than g, so it would hand
  electrons to g like a metal (real Si-H bonds really are like that). It is a fun later option for rock; it is not needed
  for C15.

### 1.2 Bonds (all multiples of 1/16)

Sharing is generalised: two sharers (linkers or builders) release (s_a + s_b)/2 x (row a + row b), where the share per row
is 1/4 for a linker (today) and **1/2 for a builder** (builders share twice as strongly). The l-l chain therefore keeps
exactly its 0.5.

| bond | released | gap -> band | spark | polar? |
|---|---|---|---|---|
| c-g | **1** | 1.625 -> V1 | 0.5 | no (grip diff 0.75) |
| c-t | **3.75** | 4.75 -> hard | 0.5 | yes (3.5) |
| c-c | **1** | 1 -> warm (dark, warms) | 0.5 | no (shared) |
| g-t (water, unchanged) | 4.5 | 5.125 hard | 0.25 | yes |

**SPARK.** Today a bond's spark is 1/8 x (row + row). The new rule doubles it for a bond to a four-handed atom (crowding).
All carbon sparks are therefore 0.5. With theta = 1/32 this makes carbon chemistry in the cool open dish about e^-8, or
roughly 3000 times, slower than gt bonding at the same temperature. It runs near hot vents and inside cells, where
engines pay the spark. As in real life, organic chemistry needs enzymes or heat. This is the main knob if tar forms too
fast or too slowly.

### 1.3 Charge and polarity

- **Charge: unchanged rule.** It is still the group count (giver +1, taker -1, others 0), summed over the atoms. Every
  reaction keeps each atom's group, so charge is conserved exactly by construction, and checkCharge passes. The side
  effect is that carbon molecules carry large booked charges: methane-like +4, CO2-like -4, sugar-like 0.
  **Proposal:** only FREE atoms act as charges (ions). That is already true for osmosis and the C12g ion block. The charge
  field (off by default) and the membrane voltage should count free atoms only. Molecules act through POLARITY instead.
  The zoo shows polarity, not charge, for carbon molecules. (With `?chargefield=1` the free-ion count can then change in
  carbon reactions, e.g. t + [c-g] -> [c-t] + g. The field is solved fresh each tick, so this does no harm.)
- **Polarity from bonds (new general rule):** a bond is POLAR when its electron falls by at least 1 (grip difference
  >= 1). Shared bonds are water-shy. Checked against every C12 substance: gt, gT, Gt, GT come out polar; ll, LL, lL
  apolar; glL, tlL amphiphile. **The same classes as today.** For carbon it gives: c-g water-shy (hydrocarbon is oily),
  c-t polar, c-c water-shy. So **c is water-shy where it carries g's and water-loving where it carries t's.** This is
  exactly what makes real fats and soaps.
- Head and tail are read **per carbon along the chain**: a carbon with any t hand is a head carbon, one with only g/c
  hands is a tail carbon. Then chi = tail - head and beta = 2 x min(head, tail) for an amphiphile, the same C12 formulas.

---

## 2. The molecule model

There are three tiers, from cheapest to richest.

### 2.1 Tier 1: the carbon ladder, 5 fixed mobile molecules (real chemistry's "C1 oxidation ladder")

Each is one carbon with k g-hands and 4-k t-hands. Energy = minus the sum of its hand bonds.

| | molecule | real analogue | energy | booked charge | chi (oily +) | absorbs |
|---|---|---|---|---|---|---|
| S4 | c g4 | methane | -4 | +4 | +1 | V1 |
| S3 | c g3 t | methanol | -6.75 | +2 | +0.5 | V1, hard |
| S2 | c g2 t2 | sugar unit (CH2O) | -9.5 | 0 | 0 | V1, hard |
| S1 | c g t3 | formic acid | -12.25 | -2 | -0.5 | V1, hard |
| S0 | c t4 | **CO2** | -15 | -4 | -1 | hard |

Each step down the ladder is the same reaction, OXIDIZE (2.75 released). Spreading follows today's rule (row 1 x
0.7^(atoms-1)): 0.29 R^2/s, a little slower than the fuels gT/GT.

### 2.2 Tier 2: TAR, dead or amorphous carbon as three immobile hand counts

Tar is three channels: **cc** (backbone bonds), **cg** (fuel hands) and **ct** (burnt hands).

- **Derived from those three numbers:** energy = -(cc E_cc + cg E_cg + ct E_ct); carbon atoms = (2cc + cg + ct)/4;
  "burnt-ness" = ct/(cg + ct); "how chained" = cc share.
- **No molecule identity is needed.** Every reaction keeps 2cc + cg + ct (section 11 of the check), so carbon is
  conserved exactly. It is counted in quarter-counts locally and is a whole number in the global books, because
  everything enters in whole carbons.
- **Immobile**, like crust, so its three channels can never drift apart. Currents do not carry it.
- **What it is:** crust, walls, humus, coal, cell storage granules, and the **catch-all** that makes recycling species
  slots exact (2.4).

### 2.3 Tier 3 (option R only): the lipids as three fixed C2 molecules

Two carbons, one c-c bond, six hands. They are the smallest molecules that can have a head and a tail.

| | molecule | class (per-carbon head/tail) | energy | made by condensing |
|---|---|---|---|---|
| oil | c2 g6 (ethane-like) | apolar, chi +1 | -7 | S4 + S3 |
| soap1 | c2 g5 t | amphiphile, beta 1 | -9.75 | S3 + S3, S4 + S2 |
| soap2 | c2 g4 t2 (both t on one carbon) | amphiphile, beta 1 | -12.5 | S2 + S3, S4 + S1 |

Any other condensation product, e.g. c2 g3 t3, has no channel and goes into **tar**. Oxidation runs down this list: **oil
+ t -> soap1 -> soap2 -> tar**. Oxygen turns fat into soap and then into crust.

### 2.4 Species slots (shared machinery for X1 proteins and C14 soup; NOT needed for C15 under R)

- **K slots** (8 to start; 16 fit the budget). Each slot has a descriptor: number of carbons + hands per carbon (later the
  X1 sequence). The CPU derives every property per slot and writes it into a uniform: energy, polarity, bands, spread
  (0.7^(atoms-1), so long chains barely move), oil volume and film.
- **Allocation (CPU, between frames):** a slot is free when its total read-back (dish + stocks + membranes) is exactly 0.
  A product that has no slot yet is not lost: it goes into tar (where the reaction allows it), or the engine that wants
  it counts "demand" and does not run. The CPU gives a free slot to the most demanded composition.
- **Retire (exact):** the CPU flags the least-used slot. Every pixel and every cell then converts its counts of that slot
  into tar hands, (n-1) cc, k_g cg, k_t ct per count. This has **zero energy change** (same bonds) and exact matter. The
  slot reads 0 afterwards and is free. **Tar is what makes slot recycling exact.**
- **Recommendation:** build slots with X1 (fibres first), not in C15. C15-R is complete with 20 fixed channels.

### 2.5 Coexist or replace? (the user asked us to rebalance if needed)

| today | option R | option S (fallback) |
|---|---|---|
| free l, L | **retired** | kept |
| crust ll, LL | **tar** (c-c rich) | kept, plus tar |
| oil lL | **oil c2g6** | kept |
| soap glL (+), tlL (-) | **soap1, soap2** (polar heads, booked charge not acting) | kept |
| g*, t* (empty since C12d) | **retired** | kept |
| g t G T, trace, gt gT Gt GT | **unchanged** | unchanged |
| new | S0..S4, tar x3 | S0..S4, tar x3 |
| channels | **20** (18 today) | 26 |

**What R buys:**
- One way to build chains instead of two parallel ones.
- Membranes made of carbon fat, so lipid supply is tied to the energy economy: fixing CO2 back to fat costs light.
- Walls made of carbon polymer (like cellulose or peptidoglycan).
- Pigments made of carbon + trace (chlorophyll + magnesium).
- **Membrane damage becomes lipid peroxidation:** oxygen oxidising membrane fat is the same OXIDIZE reaction as breathing,
  so the separate C6c "bite" rule goes away.
- The M1 bottleneck disappears (the heavy linker L locked in LL crust).
- The channel count stays about the same.

**What R loses, or must earn again:**
- "Light atoms bite light membranes, heavy atoms bite heavy ones": only oxygen (and heat) damages membranes now.
- The light/heavy wall-row gene (Bio.lip.z) becomes a cross-link gene (the wall's c-c share: stiffer, more brittle).
- Charged soap heads, which fed dipoles and field B. Both are off by default.
- The `?lipids=0` C6c linker weave (it stays reachable only with `?carbon=0`).
- All C12/C12b/M1/P1 tuning, which must be re-checked (the oil/soap drift numbers change slightly: beta 1 instead of 2/3).
- Past experiments, which stop being comparable (as with C12d).

---

## 3. Reactions

### 3.1 Five generic types, every one both ways, derived from the hand table

| type | downhill direction | released | reverse (uphill) driven by |
|---|---|---|---|
| OXIDIZE | t + [c-g] -> [c-t] + g | **2.75** | REDUCE: hard light in the open (absorber the c-t hand, 5 >= 2.75 + half spark); in a cell a V2 pigment (3) + spark from the battery |
| CONDENSE | [c-g] + [c-t] -> [c-c] + gt | **0.75** | HYDROLYZE: hard light in the open (absorber gt); battery in a cell (digestion costs) |
| DISSOLVE / SETTLE | loose tar carbons <-> C1 molecules | 0 | rate ~ tar carbons with no c-c hand, c(1-p)^4; same in both directions |
| (kept) BOND, SWAP, TRADE | inorganic g t G T table | as C12d | as C12d |
| (kept) water g + t -> gt | 4.5 | | |

- **Where they apply:** OXIDIZE/REDUCE work on any carbon that has the right hand: the S ladder, the lipids, tar, and
  later the slots. CONDENSE pairs any g-hand with any t-hand on another carbon. The product is a named molecule when one
  fits (2.3), otherwise tar.
- **Implementation:** these run in their **own carbon pass** (generic rules, written as loops, not as table entries). The
  48-entry reaction table and the 18-channel arrays of `react` stay untouched, which keeps `?carbon=0` exact.
- `?photolysis=0` also blocks REDUCE in the open, because it frees a t (rule unchanged).

### 3.2 The hoped-for outcomes fall out of the numbers (`carbon_check.py`, sections 5 to 9)

| hoped for | number |
|---|---|
| c-g is fuel | a free t releases 2.75 taking a c-g hand (gT: 3.0, GT: 2.5); methane-like burnt fully to CO2-like + water releases **29** |
| c-t is settled waste | every way of taking a c-t hand apart is uphill (REDUCE -2.75, HYDROLYZE -0.75); CO2-like is the bottom of the ladder |
| breathing beats fermenting | carbon breathing **3.625 per free t** (inorganic t + gT: 3.0); per hand, full burn 7.25 vs fermenting (CONDENSE) 0.75: **~10x** (real life about 18x) |
| breathing = fuel + t -> c-t + g-t | OXIDIZE then BOND: [c-g] + 2t -> [c-t] + gt (7.25) |
| photosynthesis needs light | CO2 back to fuel per hand = split water 4.5 + REDUCE 2.75 = **7.25**, more than any photon (hard = 5): **two photons per hand**, like the real two-photosystem Z-scheme; in the open only hard light can do it |
| harvesters must burn | engine rules unchanged: the photon pays only the rise, the spark always comes from the battery, only downhill engines fill it |
| no free-energy loop | energies are a state function (minus the bonds), so every closed cycle has zero total change; checked loops lose from the battery: oxidize+reduce -1.19, condense+hydrolyze -0.69, methane->CO2->methane in the dark -11.25 |
| backbones are structure | c-c (1) is as strong as c-g; chains are stable in water (HYDROLYZE uphill), cut by hard light or by a cell paying for it |

### 3.3 The one number that decides tar: backbone strength E_cc (section 6)

| E_cc | condense | look |
|---|---|---|
| 1/8 | costs 1/8 | dead carbon dissolves back into food; cells pay to build and keep structure; no carbon fermentation |
| 1/2 | releases 1/4 | weak fermentation (29x below breathing) |
| **1 (recommended)** | releases 3/4 | dark tar and crust slowly build up where reduced and burnt carbon meet, faster when hot; fermentation ~10x below breathing |
| 3/2 | releases 5/4 | tar everywhere; fermentation strong (6x) |

### 3.4 Engines (option R): still 22, inorganic order kept

- The 4 linker engines (l + l -> ll, L + L -> LL, and their 2 cracks) become the 4 carbon engines at the **same
  indices**, keeping their kind (downhill stays downhill): chain l -> **CONDENSE**, chain L -> **OXIDIZE (carbon
  breathing)**, crack ll -> **HYDROLYZE (digest)**, crack LL -> **REDUCE (carbon fixing, pigment or storer)**.
  ENG_COUNT stays 22, and old genomes change meaning only in those slots.
- Engines name a reaction **type**, not a molecule. They act on whatever carbon the cell holds, weighted by the hands
  available. That makes them robust to slot recycling. Later (G2/X1) a continuous specificity gene can prefer a
  composition by Gaussian matching, like receptor tuning.
- **Option S:** the 4 carbon engines are appended instead (ENG_COUNT 26).
- **Founders:**
  - the habit "other": chain maker -> CONDENSE (storage granules)
  - the breather gets OXIDIZE
  - the "pigments" habit gets REDUCE with a V2 pigment next to its water split
  - optional new habit "carbon": OXIDIZE + water BOND + a small CONDENSE

### 3.5 In cells

- **Stock:** all 20 channels in option R (today 13 + 2).
- **Membrane:** the bilayer holds soap1, soap2 and oil per side. The wall holds tar hands per side (cc, cg, ct).
- **Layout:** SW 64 -> 80 words: 0..19 stock, 20 battery, 24..41 bilayer, 42..59 wall, 60..79 spare (X1 slots later).
- **Lipid builder (C12b):** makes oil and soaps by condensing C1 from the stock (the table's reaction; sparks from the
  battery).
- **Bites:** OXIDIZE by free t at exposed sides, at the C12b fluidity exposure. The M1 ion block still shields, since t is
  an ion.
- **CO2 must leave:** S0 is neutral and passes the membrane by its gradient. C12e saturation slows OXIDIZE as burnt
  carbon piles up in the stock, so "expel CO2" emerges from mass action and is never written as a rule.
- **Pigment:** 2 carbons from the most reduced C1 in stock + 1 trace.
- **Smell:** what a free t would release from each channel (S4 4 x 2.75, ...).
- **Kin channels:** fuels + C1 + trace.
- **GRN senses:** "linkers" becomes "carbon fuel".

---

## 4. Grid and GPU budget

| | blocks in the heat buffer | MiB at 300 000 px |
|---|---|---|
| today | 52 | 59.6 |
| option S | 68 | 77.9 |
| **option R** | **56** | **64.2** |
| R + 8 slots (X1) | 72 | 82.5 |
| R + 16 slots | 88 | 100.8 |

- **Buffer limit:** everything stays under the 128 MiB default storage binding (Firefox: the user's browser). Beyond about
  110 blocks, the device must request a higher `maxStorageBufferBindingSize`, or MAX_PIXELS must shrink. Watch D1, which
  changes how the grid is sized.
- **Ledger:** + ~2 x 128 words per extra channel per region (ADD, LOST, GONE, DISH, cell stock), about 4-8 k words.
- **Passes:** spread for 20 channels (tar immobile: copied, not spread), plus one carbon react pass per tick (5 rules,
  early out on empty pixels), plus paint layers. Cells: exchange over about 20 channels instead of 15, plus 4 engine
  types.
- **Bookkeeping stays exact and integer:** each count of a substance carries 16 x E heat counts (E multiples of 1/16:
  checked); tar carbons in quarter-counts locally, whole numbers globally.
- **Expected speed** (GTX 1650; guesses, to be measured with GPU timestamps):

  | | today | option R | option S |
  |---|---|---|---|
  | 2000 cells | x6.60 | x5.8-6.3 (-5..-12 %) | x5.4-5.9 (-10..-18 %) |
  | 10 000 cells | x1.39 | x1.25-1.35 | x1.2-1.3 |

  Mitigations: tar skips spreading; the carbon pass runs every 2nd tick when the dish is cool; cells exchange carbon only
  when the stock or the pixel has any.

---

## 5. Look

**Neon:**
- **The carbon ladder:** halftone dust shaded by burnt-ness, from fuel green (methane-like), through yellow-green
  (sugar-like), to a dim slate (CO2-like, like water gt). Under hard light the c-t hands glow sky blue, like the
  minerals. This is derived (gap 4.75 hard -> emits V2).
- **Tar:** the crust's flat amber-brown bricks and fibres, with a faint waxy green sheen in proportion to cg. Burnt tar
  is dull brown. It absorbs warm light, so dark tar warms in the light.
- **Oil and soap:** the C12 looks unchanged (glossy film, iridescent boundary lines, pearly soap).
- **In cells:** storage tar granules as small dark-amber dots inside the body (the first storage "part"), and oil
  droplets as glossy beads.

**Harmonic:**
- ORANGE (SHG) fibres = tar or walls with a high c-c share (the crust look kept).
- GREEN (THG) = oil/soap boundaries and membranes, plus **lipid droplets inside cells as bright green dots** (real THG
  microscopy lights up lipid droplets exactly like this).
- VIOLET = fuel (S4, S3, gT, GT) and batteries.
- CO2-like = nothing (clear).

**Molecules zoo:**
- `c` in the periodic table in its own "builder (4 hands)" column between giver and taker, with its two levels.
- A **ladder strip** S4 -> S0 ("fuel to exhaust") with energies and glows.
- Cards for oil, soap1, soap2 drawn as two carbons with coloured hand stubs.
- A tar card showing its three numbers.
- Later, live slot cards.

**Panels:** a CARBON line: carbon in each tier, burning and fixing rates, CO2 in the dish, tar laid down and cleared.

---

## 6. Migration, build order, risks

### 6.1 Switches and compatibility

- `?carbon=0` = today's C12d table, exactly (no new blocks). `?electrons=0` implies `?carbon=0`.
- **Snapshots** carry a carbon flag. Old ones reload with `?carbon=0`, the way C12d handled old snapshots.
- **Breaks or needs re-deriving under R:**
  - springs: the mineral spring drips gt + S0 (+ a little S3/S4: see Q3); the vent adds S4; the sea adds a little S0
  - presets: desert (a tar spring), slick (the oil tool drops carbon oil/soap), deep vents, oxygen, shallows, oases,
    plumes, colonies, lab
  - tissue designs (PLANT, FILAMENT, BIOFILM name linker engines and walls)
  - experiment condition files that name l, L, ll, LL, lL, glL, tlL (rerun old ones with `?carbon=0`)
  - pump channel list (append C1, keep indices), kin, GRN senses, census strategies, pigments
- **Code touched by R:**
  - matter.js (ATOMS, SUBSTANCES, derive, polarity, table, ENGINES, springs)
  - heat_common/matter.wgsl (NCH 18 -> 20; the per-channel uniforms grow from 16 to 20 entries)
  - a new carbon pass
  - matter_draw, oil.js, lipids.js, membrane.js, whole.js, pigments.js, kin.js, grn senses, genome founders
  - cell_eat.wgsl (stock layout, bilayer and wall words, bites, grazing, builder)
  - zoo, harmonic, palette, snapshot, culture presets, tissues

### 6.2 Build order (each sub-step ends in something to look at; commit after each)

1. **C15a: carbon in the open dish (sidecar; cells ignore it).** The atom, the ladder S0..S4, the tar channels, the
   carbon pass (OXIDIZE, REDUCE by hard light, CONDENSE into tar, HYDROLYZE, DISSOLVE). Springs: S0 at the mineral
   spring, S4 at the vent. Drawing, zoo, CARBON line, `?carbon=0`, load-time checks (balance, charge, symmetry, 1/16).
   *Look:* green methane-like plumes from vents turning slate where oxygen is; dark tar rims growing where they meet,
   faster near the hot core; hard light bleaching tar.
2. **C15b: cells eat carbon.** Stock words, the 4 carbon engines, smell, saturation, census, granules drawn, founder
   habit "carbon".
   *Look:* colonies at vents living on methane; light-eaters fixing carbon and leaving slate CO2 trails; granules
   filling up in well-fed cells.
   **Option S ends here.**
3. **C15c: the switch (option R).** Oil and soaps become C2 carbon molecules; the lipid builder works from C1; walls are
   made of tar; bites become oxidation; pigments are carbon + trace; linkers and g*/t* retire; engines remapped; springs
   and presets re-derived.
   *Look:* the same glossy oil, soap rims and amber walls, now made by life from carbon; membranes thinning where
   oxygen builds up; walls slowly rotting.
   If this looks worse than C15b, keep S.
4. **C15d (or fold into X1): species slots.** K = 8, demand allocation, retire into tar, the first user being X1
   fibres.

### 6.3 Risks

- **Founders' crash:** under R, lipids need reduced carbon. A lit dish with only CO2 has to fix carbon before it can
  make membranes. Mitigation: a seep fraction of S3/S4 in the mineral spring, or a starter stock.
- **Vents too rich:** one methane-like molecule holds 29 when burnt fully, against 3 for gT. Spring rates must be set
  per energy and per area (the D1 audit).
- **Tar smothering the dish, or never forming:** the knobs are the carbon spark (crowding factor) and E_cc.
- **cell_eat.wgsl is already 3575 lines.** The carbon section should be its own function and kept small. Watch register
  pressure on the GTX 1650.
- **The 18 -> 20 channel arrays and 16-entry uniforms are hard-coded in several shaders.** This is the riskiest
  mechanical change; give it load-time asserts, as C12d did.
- **Booked charge ±4 on carbon molecules** (harmless with only free atoms acting; must be stated in the README).
- **Comparability:** past results become history, as with C12d.

---

## 7. Questions for the user (plain words)

1. **Rebuild or add-on?** Should carbon also make the oils, soaps, cell walls and pigments, replacing today's "linker"
   atoms, so that membranes are really fat made by life and oxygen damages them the way it does real membranes? Or
   should carbon only be added beside today's materials? *Recommended: rebuild, in stages, keeping the add-on if the
   rebuild looks worse.*
2. **Dead carbon: mud or soup?** Should dead and spilled carbon pile up as dark crust and mud in quiet places, cleared
   slowly by oxygen, hard light and grazing cells (recommended)? Or should it dissolve back into food in the water, so
   cells keep paying to hold their structures together?
3. **A little ready-made food at the springs?** Should springs bring a bit of methane-like or sugar-like carbon (like a
   seep), so first cells can build membranes? Or only CO2-like carbon, so every bit of fuel carbon in a lit dish is made
   by life (harder start)?
4. **Slow open-dish carbon chemistry.** Is it fine that carbon barely reacts in the cool open dish and mostly near hot
   vents and inside cells (enzymes)?
5. **One poison.** Is it fine that oxygen becomes the main thing that damages membranes, replacing "light atoms bite
   light membranes"?
