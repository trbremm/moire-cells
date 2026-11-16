# Moiré cells

A toy simulation made for beauty: cells moving through a "chemical" landscape made of moiré beats between
lattices. This is the WebGPU version (work in progress). The original CPU version is
`reference/neon_organoid_cpu.html`. See `CLAUDE.md` for the plan.

## Run it

Online: **https://trbremm.github.io/moire-cells/** (GitHub Pages, published from `main`; give it a minute after a
push). Some views to try: `?bio=0` (the loop alone, with exclusion), `?cells=10000&bio=0&excl=0&seed=3&change=1&side=1&partner=1`
(step 8's curling waves); pick a spring in the toolbar (or press 2 or 3) and tap into the empty dish to drop a spring
of atoms (step C3). On a phone, tap the dish with the toolbar's tools; everything else is in its panels.

Locally:

WebGPU needs a page served over http(s), not opened as a file. In the project folder:

    python tools/serve.py

(like `python -m http.server`, but it tells the browser not to cache, so after an update you never run a mix
of old and new code; add `--lan` to reach it from other devices on the network) then open http://localhost:8000 in **Firefox** (141 or newer on Windows), **Chrome** or **Edge**.

Browsers with WebGPU (checked November 2026):
Firefox 141+ on Windows and 147+ on Apple-silicon Macs; Chrome / Edge 113+ on Windows, macOS, ChromeOS;
Chrome 121+ on Android 12+; Safari 26 on macOS, iOS and iPadOS. Not yet by default: Firefox on Linux, Android
and Intel Macs; Chrome on most Linux setups.
Without WebGPU the page shows a message and links to the CPU version.

**Laptops with two GPUs:** browsers usually pick the integrated one. On this machine both Firefox and Chrome
picked the AMD Vega instead of the GTX 1650. To change it: Windows Settings > System > Display > Graphics,
choose the browser, set "High performance", restart the browser.

## Controls (step C3b)

Everything can be done with a finger or the mouse, through the **toolbar** at the bottom left; the keys (below) still
work and do exactly the same (one table of actions, `src/actions.js`, drives both). The toolbar folds away to one
small button (the arrow at its left end; the page remembers it; `?ui=0` starts folded). Hover a button for its name.

- **Tools** (what a tap and a drag on the dish do; one at a time, the active one outlined in cyan):
  ripple (key 1) · light spring (2) · heavy spring (3): a tap drops one, a drag stirs ·
  stir: a tap or drag stirs (ripples, and the cells near your finger are pushed along) ·
  move light (the ellipse): a tap or drag puts the spotlight there (and switches the light to spotlight) ·
  oil spring (the drop; step C12, no key): a tap drops a spring of oil, of oil with a little soap (the default), or of
  soap, as the rules panel's "oil tool drops" says.
  With a mouse, as before: right-drag moves the spotlight, the wheel tilts it, Shift+wheel turns it.
- **Pause / play** (Space) · **speed** (keys [ ]; a tap goes to the next speed, after MAX back to 1×) ·
  **record** (Shift+V, see below).
- **Panels** (one open at a time; tap the button again, the ×, or Escape to close):
  - *light* (the sun): spotlight / full field / off, sliders for the tilt and the direction the light comes from,
    day and night;
  - *view* (the eye): first the **look** (step C6n: neon, halo, trails, hum, show the machinery, substances as dust or
    halftone, the lattice inside the cells; step C6b: the charge contours; step C6c: corner rounding; step C12: oil films
    drawn, polarity wash), then the entropy panel, the stats overlay (F),
    the landscape, which substance is shown, colour by fate, lineage, strategy (step C6), charge (step C6b) or wall pattern
    (step C10), and the other drawing switches;
  - *rules*: every rule that has a key, as a switch with a one-line explanation and its key, grouped as below
    (the loop, cell shape (step C6c: honeycomb shapes and their stiffness, panel only), field B, steps 6 to 8, biology, heat and light, chemistry, cells eat, engines, charge, membrane chemistry (step C6c, panel only), charge per side (step C6d, panel only: the dipoles' switches and six knobs with - and +), pumps (step C7, panel only: four switches and five knobs with - and +), catalysts (step C7b, panel only: two switches and four knobs), hard light (step C8, panel only: one switch and three knobs), division (step C9, panel only: the mode and five knobs), patterned walls (step C10, panel only: four switches and six knobs, the sixth, free base glue, since step C11), glue turns cells (step C11, panel only: two switches and two knobs), oils and water (step C12, panel only: four
    switches, what the oil tool drops, and four knobs)); settings with several values show the current one
    and change on a tap; the lever and the stiffness have - and +. The switches follow the state, also when a key changes it;
  - *dish* (the dish with three cells): the speed as a row of buttons, new culture (N), new genomes (G), clear
    springs (C), wash the atoms out (Shift+C).
- **Touch:** one finger on the dish is the active tool; two fingers are left to the browser (pinch-zoom). On a
  touch-only screen the bottom line shows only the short messages after a tap, not the keys.
- **Speeds:** 1×, 2×, 4×, 8× as before; **16×** and **32×** are a timelapse: more ticks of 1/60 s between two
  drawn frames (the ticks themselves are the same at every speed, so is the simulation); **MAX** runs as many ticks per
  frame as the graphics card does while the picture keeps about 50 frames per second. The fast speeds adapt to the
  measured time between frames (16× and 32× allow down to about 30 frames per second), at most 256 ticks per frame, so
  the speed a slow card reaches is lower: the speed button shows it under the setting (e.g. "32×" over "×11"), and so
  do the entropy panel's first line and the F overlay. Measured on this machine (the browsers use the integrated AMD
  Vega): 2000 cells, Chrome: 32× reaches ×16 at 34 frames/s, MAX ×17 at 53; Firefox: 8× ×8, 32× ×11 at 33, MAX ×11
  at 57; 10 000 cells, Chrome: 8× ×6.8 at 13 frames/s (as before), 32× ×6.5 at 31, MAX ×6.1 at 55. The energy
  ledger's rounding stays within ±0.11 (in up to 7.6 M) and the atoms ledger's at 0 at any speed. A spring drips on
  each tick it lives, so it gives the same amount at any speed.
- **Recording:** the record button (Shift+V) records **the dish only** (not the toolbar, panels or counters) as a
  video; a small red "REC 0:12" shows while it runs; pressing it again stops and downloads the file,
  `moire-cells-YYYY-MM-DD-HHMM.webm`. WebM with VP9 in Chrome and Edge, VP8 in Firefox, MP4 in Safari; at the
  page's size in CSS pixels (at most 1920 wide), about 8 Mbit/s for 1080p (5 s at 1280 × 800: about 3 MB). Record
  at 32× or MAX for a timelapse. Where the browser cannot record a canvas, the button is greyed out. Browser
  recordings usually carry no total length in the file: most players play them fine, some cannot show a seek bar.
- **On a phone** the page starts with fewer cells (unless `?cells=` says otherwise): 2000 × (shorter side / 800 px)²,
  between 800 and 1500, on touch screens and windows shorter than 600 px; a phone of 390 px gets 800 cells of about
  the computer's size. The entropy panel gets shorter lines, panels take at most about half the screen and scroll,
  buttons are 42 px.
- URL options: `?speed=32` or `?speed=max`, `?paused=1` (start paused), `?ui=0` (start with the toolbar folded);
  step C6n: `?neon=0`, `?halo=off|low|medium|high`, `?trails=0`, `?hum=0`, `?machinery=1`, `?cheap=0|1`, and
  `?until=T` (run to simulation time T, then pause at exactly that tick); step C6b: `?charge=0`, `?qstock=0`, `?qfeel=0`,
  `?contours=1`, `?view=charge`; step C6c: `?honeycomb=0` (the ellipse cells), `?membrane=0` (no membrane chemistry),
  `?bites=0`, `?burst=0`, `?elastic=0`, `?selectivity=0`; step C6d: `?dipoles=0`, `?dd=0`, `?dphi=0`, `?dfield=0`; step C7: `?pumps=0`, `?pumpcontact=0`, `?voltage=0`, `?v2b=0`; step C7b: `?crystal=0`, `?cofactor=0`; step C8: `?hardmut=0`; step C9: `?divide=0` (the old turnover, a fixed count), `?cap=N` (the capacity), `?divat=`,
  `?divcost=`, `?starve=`, `?crowd=`, `?age=` (the division's knobs); step C10: `?walls=0` (every side as sticky as the
  adhesion gene, as before), `?wallfront=0`, `?wallcost=0`, `?mature=0`, `?view=walls`; step C11: `?turn=0` (the glue does not
  turn the cells), `?divfront=0` (divisions along the long axis, as in step C9), `?freeglue=x` (the free base glue; 0 = all glue costs,
  as in step C10); step C12: `?oil=0` (no oil forms
  or separates), `?phase=0` (no phase separation: everything only spreads), `?amphi=0` (no amphiphiles made, no boundary
  pull, no skin), `?fusion=0` (no membrane fusion), `?oilspring=oil|emulsion|soap` (what the oil tool drops),
  `?polarity=1` (the polarity wash shown); step C12b: `?lipids=0` (the C6c linker membrane, as before), `?lipheat=0` (heat does
  not fluidise the bilayer), `?crack=0` (walls never crack), `?lipheads=0` (the soap heads do not charge the cells), `?graze=0`
  (cells do not graze the crust under them: the C12b supply fix off); step C12c: `?excited=0` (freed light atoms carry no energy:
  the chemistry as before), `?exshare=x` (the share of the photon's surplus an excited atom keeps, 0..1, default 0.5, fixed for
  the page), `?exlife=s` (its lifetime in a cold dish, default 30 s), `?exhot=T` (the temperature at which it fades twice as fast,
  default 4), `?exlook=0` (the excited haze not drawn).
  Experiments (see "Experiments: tools"): `?mut=0` (mutation off), `?life=0` (life cycle off), `?snap=<file>` (load a
  saved state), `?clone=1` (every cell gets the first cell's genes; `?clone=@N`: slot N's), `?genes=adhesion:0.8,motility:0.5`.

## Keyboard shortcuts

- click: what the tool does (a ripple or spring tool drops, the stir tool stirs, the move-light tool moves the spot) ·
  drag: stir (ripples, and cells near the pointer are pushed along)
- **1** / **2** / **3**: tool: ripple / light spring / heavy spring (step C3; the toolbar shows the tool)
- **Space**: pause / play (step C3b)
- **Shift+V**: record the dish as a video / stop and save it (step C3b)
- **C**: clear the springs (the atoms already in the dish stay; Shift+C washes them out)
- **L**: the whole landscape on/off: the cells' field dots and the substances' dots
- **F**: frame time and adapter overlay
- **?**: the hint line shows all keys / the short line
- **A**: ambient ripples on/off (random drops standing in for the cells' divisions and deaths)
- **N**: new culture (a fresh blob of stem cells at the centre, the same founder genomes)
- **G**: new culture with fresh random founder genomes
- **P**: contact push on/off (without it, cells slide over each other and the centre pull heaps them up)
- **D**: differentiation on/off (off: every cell goes back to stem and stays there)
- **H**: adhesion on/off (like sticks to like)
- **B**: body traits on/off (size, motility and crawling from the genome and the fate; off: all alike, no crawling)
- **T**: the life cycle on/off: births and deaths (step C9: by division, the count rising and falling, the default; or by the
  old turnover, a fixed count, where a dead cell's slot goes at once to a neighbour's daughter: rules panel, Division)
- **M**: mutation on/off (off: daughters are exact copies of their parent)
- **E**: the neon look on/off (step C6n; off: the flat look of steps 1 to C6). Until step C3 E switched rule E,
  nutrient and threat, which went with the sources
- **Shift+1**: halo off / low / medium / high · **Shift+2**: light trails · **Shift+3**: hum · **Shift+4**: show the
  machinery (every diagnostic layer at once; default off: the clean view) · **Shift+5**: substances as dust / halftone ·
  **Shift+6**: the lattice inside the cells (step C6n, "The neon look and the clean view" below; Shift + the digit key,
  on any keyboard layout)
- **Shift+7**: the charge field (and the free atoms' drift in it) · **Shift+8**: cells' charge in field B from their
  stock (off: per fate) · **Shift+9**: cells feel the charge field · **Shift+0**: the charge field's contour lines (step
  C6b, "Charge" below)
- **I**: daughters inherit their parent's fate on/off (default off: they start as stem cells)
- **V**: colour by fate, by lineage (the key's hue), by strategy (step C6: how the cell's engines make a living), or by
  charge (step C6b: rose net +, blue net -, grey neutral), or by wall pattern (step C10: coral polar, mint two-ended, magenta
  sticky sides, grey uniform)
- **[** / **]**: simulation speed 1× / 2× / 4× / 8× / 16× / 32× / MAX (step C3b: the last three are the timelapse)
- Part C keys are **Shift + a letter** (step C1: Shift+H heat jitter, Shift+E entropy panel, Shift+R ripples simmer;
  see "Heat and the entropy counter" below; step C2: Shift+L light spot / full field / off, Shift+D day and night;
  step C3: Shift+S substances shown (summary / each alone / off), Shift+C wash the atoms out; step C4, "Chemistry in
  the open" below: Shift+M chemistry, Shift+F make fuel by light, Shift+B break fuel, Shift+P swaps, Shift+K sediment,
  Shift+T trace lowers the spark; step C5, "Cells eat" below: Shift+A cells eat, Shift+U everyone burns, Shift+I reactions
  inside, Shift+W battery pays crawl, Shift+X heat damage, Shift+G rich cells divide, Shift+N smell; step C6, "Engines in the genome" below: Shift+O engines, Shift+Y
  pigments, Shift+Q upkeep, Shift+Z gene: heat tolerance, Shift+J gene: permeability)
- right-drag: move the spotlight · wheel: tilt it · Shift+wheel: turn where the light comes from (step C2, "Light" below)

The loop (step 4):
- **S**: field sensing on/off (the force from the field felt on the membrane)
- **O**: cells emit on/off (off: no field at all)
- **W**: active deformation on/off (off: only contact squeezes the cells)
- **X**: where a cell's beat is anchored: pinned to the cell (default) / still in the world / sliding moiré
  (the reference)
- **R**: tuning toward other cells by the genome's receptor instead of likeness to the own lattice (default off)
- **K**: the cells' field drawn in the halftone on/off (drawing only)
- **-** / **=**: the lever, smaller / larger (how different the cells' lattices are from the medium's)

Field B (step 5):
- **Q**: cells feel field B on/off (it is still emitted and drawn)
- **U**: B's sign rule: like repels like / like attracts like (default; `?bio=0` starts with like repels)
- **Y**: what "like" means for B: the same sign of charge (default; charges by fate) / a similar key (lineage)
- **J**: field B drawn on/off (blue rings; drawing only)

Where the fields meet (step 6):
- **4**: leak by deformation on/off (default off): strongly stretched cells leak part of their A into B (blue centre dot)
- **5**: conversion on/off (default on): a cell that feels enough A converts and emits more B (blue outline; a
  converted stem cell is filled blue)
- **6**: what conversion does: boost B (default) / flip the sign of the cell's B charge
- **7**: relay through B on/off (default on; needs 5): converted cells excite their neighbours, tire and rest, so
  conversion travels as waves

Exclusion (step 7):
- **8**: exclusion on/off (default off; on with `?bio=0`): cells of the same fate in the same state (the bar across each cell) keep a
  gap; other states may touch
- **9**: state flip on/off (default on; acts only while 8 is on): a cell crowded by its own state turns to the state
  least represented around it
- **0**: number of states: 2 / 3 (default) / 4
- **`\`** (backslash): squeeze on/off: the pull to the dish centre normal (0.25) or hard (1.2). With 2 states, exclusion on and
  field B not felt (Q): the woven checkerboard (`?bio=0&states=2&squeeze=1`, then Q)

Partner fields (step 8; all off by default, and the page looks as before until one is on):
- **Z**: rule a, the partner A′ felt as a phase current (cells pushed the way the pair's phase travels)
- **,** (comma): rule b, change makes the partner: each cell's emission turns between A and A′ (yellow fill and hand)
- **'** (apostrophe): rule b's mode: clock (default) / felt change
- **.** (full stop): rule c, sideways push: the partner's force turned 90 degrees
- **;**: the partner A′ drawn (yellow dots) on/off, while a step 8 rule is on

Until step C3 a fresh load started with the reference's sources, two nutrient (green) and one threat (red); they are
gone (CLAUDE.md, "NO NUTRIENT, NO THREAT"): springs of atoms took their place (step C3 below), and food and harm are
to emerge from the chemistry.

Cells (step 3): a fixed number of cells, 2000 by default, starting as a packed blob of stem cells. They push
each other apart where they overlap, drift slowly, jitter a little and stay off the dish edge. Since step 4
they also emit into the field and feel it (below). Their radius is the reference's R (5 to 9 px), smaller when that many cells
would not fit (about 2.9 px at 10 000 and 1.3 px at 50 000 on a 1280 × 800 window). Since step C9 the number changes: cells
divide and die, in buffers with room for 3 times the starting number (`?cap=N`); `?divide=0` keeps the old fixed count.

## Genome and specialisation (step 3b)

Every cell carries a small random genome. Cells meet by touching; a cell recognises some neighbours and not
others (SPECIFIC), adds up what it recognises over time (SUFFICIENT: only lasting contact counts), and
commits to a fate when one of four counters passes its threshold. Cells die now and then and a neighbour
divides into the gap, copying its genome with small mistakes, so lineages compete, spread and drift.
What it looks like after a minute or two at 8×: tissues of one fate gather into patches (cyan epithelium,
amber cartilage, violet neuron, pink muscle when a lineage evolves it), stem cells end up in a loose rim
and in seams between the patches, and in the lineage view (V) related cells form colour patches whose hue
slowly drifts. (Until step C3, rule E made the tissue drain away from a threat source and grow towards nutrient.)

The genes (`src/genome.js`, struct `Bio` in `cell_common.wgsl`, 28 floats per cell):
- **key**: the cell's own lattice, an angle (0 to 60°, the hex repeats every 60°) and a period factor
  (0.86 to 1.16). It is also the lattice drawn inside the cell, and its hue in the lineage view. Two keys are
  alike when their lattice wavevectors are close (as the reference's receptor tuning).
- **receptor**: the key it listens to (angle, period) and a width (pickiness, 0.06 to 0.25; 0.03 to 0.4
  after mutation). A touching neighbour counts by a Gaussian in the difference between its key and this
  receptor.
- **threshold** (0.6 to 1.6), **output once committed** (0.4 to 1.4).
- **response** (one per fate channel, −1 to 1): how recognised contact feeds that channel.
- **relay** (one per fate channel, −1 to 1): how a committed neighbour's signal on that channel feeds it
  (positive recruits, negative inhibits).
- **body**: adhesion (0 to 1), size factor (0.85 to 1.15), motility factor (0.5 to 2).
- **founder** id (for the lineage count), plus state that is not inherited: the four counters, the crawling
  heading (two spare state numbers held the nutrient and threat felt, until step C3).

The rules, each with its key:
- **D, differentiation**: per channel, counter += (response × recognised contact + relay × committed
  neighbours' output − counter) × dt / tau (tau 2 s). A stem cell commits to its strongest channel above
  threshold; a committed cell goes back to stem only below release × threshold (0.3), so fates do not flicker.
  Committed cells are drawn with a flat fill in their colour, stem cells stay dark inside.
- **H, adhesion**: touching cells pull together by both cells' adhesion genes × how alike their keys are
  (Gaussian, width 0.12) plus 0.5 if they share a committed fate, minus 0.25 for every pair (so unlike
  neighbours push off a little, which lets the tissue sort itself out). The pull fades below 0.85 × contact
  distance, so sticky cells touch without piling up.
- **B, body traits**: size and motility from the genes times a fate-typical factor (epithelium 0.95 / 0.6,
  muscle 1.1 / 0.8, neuron 0.85 / 1.4, cartilage 1.15 / 0.4). Each cell also crawls slowly on a wandering
  heading (0.6 R per s × motility); without crawling a packed blob is jammed and hardly sorts.
- **T, turnover**: each cell dies at 0.02 per s, up to 3× faster when it recognises none of its neighbours.
  A touching neighbour, picked at random (since step C5, rule Shift+G: weighted by its battery), divides into its
  place; the daughter starts small and grows.
  The genome is double-buffered on the GPU, so the daughter copies its parent's genome from last tick.
- **M, mutation**: every gene of a daughter is nudged a little (key angle by about 2°), and with chance 3 %
  one gene is drawn afresh.
- *(gone in step C3)* **E, nutrient and threat**: each cell felt the sources' beat at its centre (the same maths as the
  halftone dots, positive part). Threat raised the death rate (× 1 + 6 × threat), and a cell killed by
  threat was refilled far away instead of from next door. 30 % of all births went to a well-fed cell anywhere in
  the dish. Growth by energy (step C5, "Cells eat") took its place.
- **I, inherit**: daughters take their parent's fate and counters instead of starting as stem cells.
  Off by default (in the one run compared, seed 3, it gave larger, bolder epithelium areas).

Births and deaths drop small ripples into the background (`moire.genome.params.ripple`, 0 = none).
The F overlay shows cells per fate, founder lines still alive, "key clusters" (key-space bins, 24 angles ×
6 periods, holding at least 0.25 % of the cells: a rough count of distinct lineages), births and deaths per
second (simulation time), and which rules are on. The counts are read back from the GPU a few times a
second without waiting for it.

Live-tunable in the console: `moire.genome.params` (founders, tau, release, reach, adhesion, adhSigma,
fateAdh, adhBase, crawl, turnRate, turnover, unhappy, mutSize, mutJump, ripple)
and `moire.genome.rules` (the switches above). `founders` is the number of founder genomes at a fresh start
(12; 0 = every cell its own random genome, which gives more fates at first and lineages dying out fast).

URL options: `?overlay=1` (overlay from the start; `?overlay=ghost` keeps it up to date but invisible, so
`tools/shot.py` can print it without it covering the shot), `?bio=0` (start with D H B T M off: the loop alone; field B like repels like, exclusion on), `?ripple=1` (a ripple every 0.7 s),
`?debug=1` (console warnings into the overlay), `?nogpu=1` (show the no-WebGPU message),
`?cells=N` (number of cells, default 2000), `?check=1` (every 2 s, count the cells' contacts through the
neighbour grid and by brute force, and check the sort; result in the console and the overlay),
`?excl=0|1`, `?flip=0|1`, `?states=2..4`, `?squeeze=0|1` (step 7, keys 8 9 0 and `\`), `?partner=0|1`, `?change=0|1`, `?clock=0|1`,
`?side=0|1` (step 8, keys Z , ' .), `?seed=N` (repeatable start: positions, genomes; the run itself drifts apart after a while, because the
GPU's neighbour order varies), `?speed=1|2|4|8`, `?founders=N`, `?view=1` (lineage colours),
`?heat=0`, `?entropy=0`, `?simmer=0` (step C1, Shift+H E R), `?light=spot|full|off`, `?spot=x,y,r`, `?tilt=`, `?az=`, `?day=0`,
`?hour=`, `?clouds=0` (step C2, see "Light"), `?show=summary|off|<substance>` (step C3, e.g. `?show=G`), `?chem=0` (step C4),
`?eat=0`, `?springs=0` (step C5, see "Cells eat"), `?engines=0`, `?burners=1`, `?view=strategy` (step C6, see "Engines in the
genome").
In the browser console, `moire.background.params`, `moire.landscape.params`, `moire.medium.params`, `moire.heat.params`, `moire.light.params`, `moire.matter.params`, `moire.eat.params`,
`moire.cells.params` (physics), `moire.cells.look` (drawing) and `moire.genome.params` / `.rules` hold
live-tunable numbers.

## The loop (step 4)

Every cell is an emitter: its lattice (its key, its fate's period, and its stretch) beats against the
medium's lattice, and that beat, times a power-law envelope (range r0 = 2.2 R), is its field. Every cell feels
the field of its neighbours (within 3.6 R, found through the grid; until step C3 also the sources') on its membrane, moves
along it, and is stretched by it, which changes its lattice, which changes what it emits and feels: the loop.
Ported from the reference, with the changes marked:
- **Membrane sensing**: 6 straight segments of the stretched outline; the field is averaged exactly along each
  (cos at the midpoint × sinc of half the phase change). Force = Σ segment × outward normal (area × gradient),
  × 1.3 R / r, saturating (tanh) at 3 R/s. Weights: the reference's sign table (fate × emitter kind: like fates
  attract, unlike repel a little; its nutrient and threat rows went in step C3) × tuning (a Gaussian in the difference
  between the two strained lattices) × a smooth taper near 3.6 R (new; the reference cut off hard).
  New: the cells' part has a gain of 10 (`sense`; the reference's 1 is too weak to matter against the contact
  push at 2000 cells; the sources kept 1 until step C3); the tuning width is 0.5 (`tuneW`; reference 0.177,
  which lets only near-identical keys feel each other).
- **Deformation**: an area-preserving stretch (capped at 0.5) relaxing toward a target: contact squeezes along
  the contact axis; actively (W) a stretch along the cell's motion and toward the field's pull on its outline;
  muscle along its crawling heading. The stretched lattice is the one the cell emits and senses with, and the
  one drawn: cells are drawn as ellipses with their dots on it. (Since step C6c the outline is an elastic honeycomb cell
  by default and the stretch is worked out from it; the ellipse cells are the switch's off state. See "Step C6c: elastic
  honeycomb cells" below.)
- **Beat anchor (X), new**: in the reference a cell's lattice is anchored at the cell, so its moiré slides many
  times faster than the cell moves (the same lever as in the LESSON of the brief). With thousands of moving
  cells that turns the field into noise: at gain 1 nothing changes, at high gain the blob only jitters.
  Pinned (default) keeps the beat's pattern still relative to the cell, bright at its centre with hex rings at
  the beat period; still in the world anchors the cell's lattice at the dish centre like the medium's.
- **The lever** (`- =`, default 0.4): scales how far each cell's lattice angle and period are from the
  medium's. Smaller = longer beats = bigger rosettes; 1 = the genome's keys as they are.
- **Receptor tuning (R), option**: a cell feels other cells through its genome's receptor (angle, period,
  width) instead of likeness to its own lattice, so A may feel B without B feeling A. No clear gain in the look
  so far; off by default.
- **Drawing the cells' field (K)**: summing thousands of emitters per pixel does not scale, so each cell adds
  its field over one quad into a half-resolution float texture (additive), and the halftone dots read it: pale
  warm dots (`moire.landscape.params.cellColour`, `cellLevel` 0.32, `cellGain` 0.5), positive part only. Under a
  packed tissue they are hidden; they show as halos around loose cells and clusters.

What it looks like (seed 3, 2000 cells): with the biology off (`?bio=0`) the middle stays packed and the rim
breaks into small rosettes (one cell with 3 to 7 around it, each with a halo of pale dots) that drift off as
groups. With the biology on, stem cells gather into flower-like rosettes with radially stretched "petals",
epithelium forms ribbons and sheets of stretched cells, and the culture spreads wider. W off keeps the
rosettes but rounds the cells; X to the sliding moiré loosens everything into a mixed, noisier culture.

Live-tunable in `moire.cells.params`: `sense`, `senseMax`, `tuneW`, `lever`, `anchor` (0 sliding,
1 pinned, 2 world), `receptor`, `emit`, `r0`, `cut`, `active`, `shapeRate`. The F overlay's "loop" line shows the
switches and, once per simulation second, the cells' mean speed, net displacement per second (low against the
speed = jittering on the spot), mean stretch and spread (RMS distance from their centre, in R).

Cost (F overlay probe, per simulation tick, GPU time): GTX 1650 in headless Chrome, grid 0.1 ms + physics
0.3 ms at 2000 cells, 0.14 + 0.6 ms at 10 000; the AMD Vega in Firefox, physics 2.5 ms at 2000 cells (so 8×
speed there costs about 20 ms a frame).

Fixed in step 5: the beat paired each lattice direction of an emitter with the wrong direction of the medium's
lattice whenever the emitter was turned more than 30 degrees from the medium (`make_beat` in
`field_common.wgsl`, and `prep()` in the CPU reference: m - s instead of m + s). Those beats were fast (about
0.6 medium periods), so about half of the cells, those with key angles above 30 degrees, were in effect silent.
With the fix every cell emits its slow beat: loop only, the middle pulls together into a tighter drop (spread
25 R instead of 31 R at 90 s, seed 3); with the biology, the rosettes are rounder and more frequent.

On the lattice scale: the field's lattice keeps the medium's period (0.62 × the screen-based R, 9 px here)
rather than following the cells' radius (6.5 px at 2000 cells, 2.9 px at 10 000). Tried at 2000 cells: tying
it to the cell radius makes the source rosettes smaller and sparser and the cells cluster less; and at 10 000
cells it would bring the beats down toward the halftone pitch.

## Field B (step 5)

A second field, a separate sum that is never added to field A, in its own lattice band: every lattice of field B
(the medium's and each cell's) is `band` = 1.5 times longer than field A's, so A and B make no slow beat with each
other. A cell's B lattice is its key and stretch as for A, with its own lever, 0.1: B's beat is then far longer
than its reach, so each cell's B is a smooth bump (at lever 0.4 its rings make the summed force jitter, a gas).
B reaches further than A: power-law envelope from r0 = 5 R (A: 2.2 R), cut at 10 R (A: 3.6 R), always pinned.

Charges: each fate has a charge per field, how strongly it emits into that field and listens to it
(`moire.cells.fields.chargeA`, all 1, and `chargeB`: stem 1, epithelium 1, muscle -1, neuron 0.5, cartilage -1).
Sign rule (U): like repels like. By charge (Y, default) the two charges multiply: same sign repels, opposite
attracts. By lineage, two cells repel by how alike their keys are (Gaussian, width 0.15) times the size of their
charges; unlike keys ignore each other.

Sensing: B is smooth over a cell, so the membrane integral is taken as area x gradient at the centre, summed over
the neighbours within 10 R (the neighbour block grows from 3 x 3 to 7 x 7 grid cells while B is felt), scaled as
field A's force, gain 0.6, saturating at 2 R/s.

Drawing: B goes into the field texture's G channel and has its own halftone screen (8 px, turned 45 degrees,
A's is 15), in a faded print blue: open rings where B is positive, filled dots where it is negative. B sums many
cells (about 20 in a crowd), so gain 0.03 with a high threshold (0.35): the rings mark the crowded parts and leave
black where the culture is loose. Knobs in `moire.landscape.params`: `fieldB`, `bGain`, `bThresh`, `bColour`,
`bLevel`, `bAngle`, `bPitch`, `bMaxDot`, `bRing` (0 = filled dots).

What it looks like (seed 3, 2000 cells, compare with Q):
- Loop only (`?bio=0`): without B the culture is one packed drop with a few rosettes breaking off at the rim.
  With B (like repels like) the drop opens into rounded islands of 7 to 20 cells at the rim, evenly spaced with
  about a cell's width of black between them, each with its pale halo, and a labyrinth of short worms in the
  middle where the blue rings show the crowding (spread 44 R instead of 22 R at 180 s). The islands form within
  about 30 s and then keep their size. U (like attracts) pulls everything into one tighter drop (19 R).
  By lineage (Y), the culture stays more compact (36 R), islands only at the rim, each a mix of lineages.
- With the biology: like repels like spreads the culture over most of the dish as islands of stem rosettes, and
  the fates mostly fail to form (at 180 s: 1814 stem cells of 2000, against 1366 without B), because the cells
  no longer keep their contacts. Like attracts like (U) does the opposite and is the richer picture with the
  biology: a compact culture (29 R) with bold tissue domains, large cyan and violet sheets, amber worm-like
  chains and round pink muscle clumps (at 400 s: 828 stem, 638 epithelium, 81 muscle, 349 neuron).
  So the default follows the biology: like attracts on the normal page, like repels with `?bio=0` (U flips).

Live-tunable in `moire.cells.fields`: `chargeA`, `chargeB` (5 numbers each), `band`, `lever`, `r0`, `cut`,
`emit`, `on`, `gain`, `sat`, `sign` (1 / -1), `like` (0 / 1), `likeW`, `strain` (how much the stretch strains
B's lattice, 1 = as A; for step 6).

Cost (physics per tick, B felt vs not): GTX 1650 in headless Chrome, 0.38 vs 0.24 ms at 2000 cells, 0.81 vs
0.46 ms at 10 000; the field scatter's quads grow to B's 10 R. The AMD Vega in Firefox: about 3.2 ms per tick at
2000 cells either way (the probe there is too rough to see B's share).

## Where the fields meet (step 6)

Fields A and B never mix by themselves; step 6 adds three rules, carried by the cells, through which A turns into
B. Each has a key; the F overlay has two "step 6" lines (counts, stretch, the A felt and the thresholds).

**Leak by deformation (key 4, off by default).** A stretched cell's A lattice is squeezed the other way, so along
its stretch its wavevector shrinks toward B's band (B's lattices are 1.5 times longer: a stretch of about 0.4 along a
lattice direction gets there). Of the cell's three strained A wavevectors and B's three medium wavevectors, the
closest pair makes a slow beat, and the leak level is a Gaussian in that pair's beat wavevector (width `leakW` 0.1
of the medium's wavenumber; an unstretched cell is about 0.33 away, so it leaks nothing). That share of the cell's A
emission goes into B instead, as that one beat: a plane wave pinned to the cell (stripes across the stretch axis),
with B's envelope. The cell also listens to B through its A charge in the same share. A leaking cell gets a flat
blue centre dot, its area growing with the leak.
What it does: loop only (`?bio=0`), nothing: cells there hardly stretch (90 % below 0.05), so no cell leaks. With
the biology about 10 % of the cells leak, mostly stretched neurons (their lattice period is the medium's, and they
move and stretch the most); epithelium is stretched as often but its shorter period needs more stretch than the cap
allows. At `leak` 1 the culture looks the same with and without (seed 3, 120 and 300 s); at 15 the fates sort a
little less. So the blue dots show where the strain bridges the two bands, but the bridge does not change the
picture yet: off by default.

**Conversion A to B (key 5, on).** Every cell adds up the A its neighbours' fields give at its centre (tuned, as
the sensing), through a leaky integrator (`convTau` 1 s). It converts above a threshold and converts back below a
lower one (hysteresis, so it does not flicker). A converted cell emits and listens to B x (1 + `conv`) = 3 (boost,
default) or x -2 (flip, key 6). It gets an outline in B's ink, and a converted stem cell is filled flat with it.
The thresholds follow the culture (`convAuto`): the A felt differs a lot between cultures (loop only, median 1.2 at
2000 cells and 2.4 at 10 000, where the cells are smaller than the field's lattice and sit in each other's bright
cores; with the biology a long tail, median 1.8 and 90th percentile 6.5), so the census keeps a histogram of the A
felt and the thresholds are its 90th percentile (`convUp` 0.9) and its median (`convDown` 0.5), smoothed over 20 s.
Without the relay: loop only, the converted cells are the centres of the rosettes (one blue cell with six around
it), the "nuclei" of the islands; with the biology, converted tissue gathers into islands wrapped in B's blue rings.
Flip (6) pulls the loop-only culture into one tight blob (opposite charges attract), so boost is the default.

**Relay through B (key 7, on).** The converted share of a cell's neighbourhood (within B's reach, 10 R, weighted by
B's envelope; its own integrator) adds to the trigger, measured in units of the gap between the two thresholds:
with `relay` 4, a cell at the median converts once a quarter of its neighbourhood has. A converted cell tires
after `relayOn` 2 s and then rests `relayRest` 6 s before it can convert again: an excitable medium, as in the
chemical waves of a Belousov-Zhabotinsky dish.
What it looks like: loop only, the culture pulses. Every 8 to 9 s a burst of conversion starts in the dense middle
and a blue ring travels out to the rim, behind it the resting cells; then the next starts in the middle (a target
pattern). At 2000 cells the bursts are patchy (from about 60 to 300 converted cells); at 10 000 cells the ring is
clean and sharp (from about 100 to 3500 converted). With the biology the pulses are there too (160 to 480 converted, every
9 s), but they read as a blue shimmer moving over the tissues rather than a ring, since only converted stem cells
are filled. The fates come out about as without it (seed 3 at 160 s: 953 stem, 507 epithelium, 406 neuron, 129
cartilage). Tried and dropped: summing the converted neighbours instead of taking their share made the whole
culture flash in sync (all 2000 at once, then none); fixed thresholds made 10 000 cells flash in sync and kept the
relay from spreading with the biology.

Live-tunable in `moire.cells.fields`: `leakOn`, `leak`, `leakW`; `convOn`, `conv`, `convMode`, `convAuto`, `convUp`,
`convDown` (quantiles with `convAuto`, else absolute A), `convTau`; `relayOnKey`, `relay`, `relayOn`, `relayRest`.
Drawing in `moire.cells.look`: `leakDot` (0.42 of the radius), `leakMin` (0.2), `convFill` (0.55).
State: `Bio.env.z` the A felt, `Bio.env.w` converted / resting time, `Bio.conv.x` the relay share (Bio is now
32 floats); `Cell.flags` bit 1 converted and bits 8 to 15 the leak level (the drawing and the scatter read them).

Cost (physics per tick): GTX 1650 in headless Chrome, 2000 cells 0.77 ms with the step 6 rules off and 0.80 ms on;
10 000 cells 1.30 and 1.56 ms. The AMD Vega in headed Firefox: 3.9 ms at 2000 cells (3.2 ms before step 6), 31 fps
at 4x speed.

## Exclusion (step 7)

The brief's "Pauli exclusion", as a pattern rule, not physics: two cells of the same TYPE in the same STATE do not
share a place; cells in different states may.
- **Type = fate** (stem, epithelium, muscle, neuron, cartilage). It is the cell's "kind of particle", and it is what
  the biology already uses for "like" (adhesion, field A's sign table). Loop only (`?bio=0`) every cell is stem, so
  the state alone decides.
- **State = the cell's lattice angle, cut into 2, 3 or 4 bins** (key 0), like spin up / down: the key angle's 60
  degrees (the hex lattice repeats every 60) in equal parts. It lives in the lattice, as the brief asks, and costs
  no memory. Rule 2 below adds an offset (`Cell.flags` bits 16-17, 0 at birth) that changes the state without
  turning the lattice, so a flipped cell keeps its key, its adhesion and its field.
- Drawn as a flat **bar** through the cell's centre in the cell's colour, turned 180 / states degrees per state
  (2 states: upright and lying; 3: three directions 60 degrees apart), with the lattice dots cleared around it, so it
  reads as one clean print mark. Only while exclusion is on (`moire.cells.look.stateMark`, `bar` brightness).

**Rule 1, exclusion (key 8, off by default, on with `?bio=0` since the user chose that).** Same type, same state: the contact push reaches out to `reach` 1.3 x
the contact distance (the two radii) and is `hard` 4 times as stiff. Same type, other state: they push apart only
below `pack` x the contact distance (default 1, plain contact; 0.85 lets them sink into each other, which looked
cluttered, worst with 3 states). Different types: as before. The motion integration stays stable at these numbers
(the damped update tolerates a stiffness far beyond this), so no extra cap was needed, and no jitter showed.
The F overlay's "step 7" line counts, among same-type neighbours, the share in the same state, touching and within
1.6 x contact distance, against what random mixing of the states would give.

**Rule 2, state flip (key 9, on; needs 8).** A cell that has more neighbours of its type in its own state than in some
other state (within the "shell", 1.05 x the exclusion reach) moves, at a random moment (`flipRate` 1 per s, so
neighbours do not all flip at once), to the state least represented around it. Like a crowded shell spilling into
the next one. It also evens out the states: the 12 founders give the states unequal shares (seed 3, 2 states: 494 /
1506 cells; 3 states: 494 / 0 / 1506, as no founder key lies between 20 and 40 degrees), and the flip brings them to
a third each within seconds.

What it looks like (seed 3, 2000 cells, at 90 s loop only and 160 s with the biology; shots compared at the same seed
with the keys on and off):
- **Rule 1 alone, 2 states, loop only** (`?founders=0` for even states): the rosettes break up. A rosette needs a
  centre touching six neighbours, and two states cannot alternate around a triangle, so the packing opens into
  short tangled chains in which upright and lying bars alternate (| - | -), with small 2 x 2 checkerboards. Touching
  same-state pairs: 0 % (57 % without; random 50 %); touching neighbours per cell 2.0 instead of 3.0.
- **Squeezed** (`moire.cells.params.squeeze = 1.2`, field B not felt): 2 states turn the hex packing into a
  **square checkerboard**, rows of | - | - like a woven basket, the clearest picture of the rule. The drop also
  swells: spread 29 R instead of 19 R, exclusion holding the crowd up against the pull ("degeneracy pressure").
- **3 states + flip, loop only** (the defaults when you press 8): the picture is the loop's again (rosettes, worms;
  spread 46 R, 2.9 touching neighbours per cell against 3.1 off), but each rosette is a **pinwheel**: the centre in
  one state, the ring around it alternating the other two, a perfect 3-colouring (touching same-state 0 %, within 1.6
  x contact 17 % against 33 % random). Seen best zoomed in; at 10 000 cells the bars become a fine texture.
- **With the biology**, rule 1 alone pulls the tissues apart: a lineage shares one key, so a clonal patch is all
  one state and may not touch itself (touching same-fate neighbours per cell 1.2 instead of 6.4; at 160 s cartilage
  16 cells instead of 153). The culture becomes a speckled mix of cyan and violet chains. With the flip and 3 states
  the tissues hold again (stem 1127, epithelium 397, neuron 352, cartilage 123 against 952 / 549 / 374 / 121 off),
  each tissue a mosaic of bar directions, but looser than without exclusion (2.8 touching same-fate neighbours per
  cell), so the domains are smaller. With 2 states and the flip they stay loose (frustrated, as above).
- Shells around a source (the sources were removed in step C3): not seen at the scale of a nutrient source; the stem cells do not crowd there enough. The
  shell picture shows at the scale of one rosette (its centre is the attractor; the first ring fills with the other
  states).
- Squeezed hard with 3 states and the flip, the drop "boils" (mean speed 17.5 px/s against 3.4 off): the pull presses
  same-state cells together faster than flips can sort them.

Live-tunable in `moire.cells.excl`: `on`, `hard`, `reach`, `pack`, `states`, `flip`, `flipRate`. Sim uniforms `excl`,
`exclReach`, `pack`, `states`, `flip`, and `xCount` (the frame's last tick counts neighbour pairs into
`Stats.xPairs`, cleared every frame); the census counts cells per state (`Stats.extra[70..73]`).

Cost (physics per tick): GTX 1650 in headless Chrome, 2000 cells about 0.37 ms off and 0.40 to 0.45 ms on; 10 000
cells 1.05 and 1.14 ms. The AMD Vega in headed Firefox: 3.3 ms at 2000 cells with 8 and 9 on, 62 fps at 1x.

## Partner fields (step 8)

The user's idea after electric and magnetic fields: a field with a partner at right angles, where a change in one makes
the other, so signals travel instead of sitting still. Three rules, built and looked at one at a time, each with its key,
all off by default. Since waves and swirls are motion, a new overlay line measures rotation (below).

**The partner A′.** Field A of a cell is its pinned beat, three cosine waves; the partner is the same beat a quarter
period out of step, the sine twin. Together (A + i A′) they carry a phase. Which way each of the three sine waves runs is
a choice: the cell's three beat waves lie 0, 60 and 120 degrees apart, and "one way" gives every cell an arrow (its
partner is a dipole across it; `moire.cells.partner.arrow = true`), while "symmetric" (default) makes them a triad 120
degrees apart, so a lone cell has no arrow and its partner is weak close to it. Every cell carries a phasor z (`Cell.z`)
that turns and scales its beat: at 90 degrees its A has become A′. The partner goes into the field texture's B channel
and is drawn on its own halftone screen (75 degrees, filled dots in a faded yellow; `moire.landscape.params.pColour`,
`pLevel`, `pGain`, `pAngle`, `pPitch`, `pThresh`; key ;), only while a step 8 rule is on.

**Rule a, phase current (key Z).** On the membrane (in one pass with field A, with the same weights) the cell feels A
and A′, their means and gradients, and is pushed along the current j = A grad A′ − A′ grad A divided by A² + A′² + eps²:
the direction in which the pair's phase runs, `gain` x R x (R x the phase gradient) per s, saturating at `sat` R/s.
What it does: nothing visible on its own. With every phasor at (1, 0) the pair has almost no phase to follow (seed 3,
2000 cells loop only: speed 4.4 px/s and spread 43.8 R at 60 s, as without). At gain 20 to 50 it turns the rosettes into
a gas, and with the arrow it drives the whole culture off to one side. On top of rule b it adds little to the motion
(swirl 1.2 against 1.1 deg/s at 10 000 cells), but it sharpens rule c's curls (below). Kept, off.

**Rule b, change makes the partner (key ,; its mode, key ').** Two readings of "a change in A makes A′ and back":
- *Felt change* (mode 0): a cell emits A′ in proportion to how fast the A it feels changes, and A in proportion to how
  fast the A′ it feels changes (`chGain` 2 s; the rates are the slopes of the step 6 integrator; the phasor follows in
  `chTau` 0.3 s, soft cap `chMax` 1.5, `chSign` −1 as in Faraday's law). Measured: the phasors only shimmer with the
  cells' jitter (65 % of the cells off (1, 0) by more than 0.25, each hand its own way), no waves. For a field that sits
  still this rule just damps out; it is the cells' small motions that keep kicking it.
- *Clock* (mode 1, default): the change happens inside the cell. Its A turns into A′ and its A′ into −A, so its phasor
  turns at `omega` (2.5 rad/s), a clock hand; the pair it feels from its neighbours (their phasors, each seen through its
  beat) pulls its hand toward theirs turned back by `lag` (1.0 rad), at up to `pull` (1.5 rad/s). Each clock starts at a
  random hour. A clock in step with its neighbours runs at omega − pull x sin(lag), a turn in about 5 s.
  Drawn as a hand on each cell (`moire.cells.look.hand`; hidden on cells smaller than 5 device px), and stem cells are
  filled with the partner's yellow as far as they emit A′, so the waves read as yellow bands at any size.
  What it looks like: loop only at 10 000 cells (`?cells=10000&bio=0&excl=0&change=1`, clearest with key 5 off), after about
  20 s of patchy disagreement, rings of yellow run INWARD from the culture's rim to its middle, one every 4 to 5 s (the
  rim leads), and the culture breathes with them: field A's bright cores turn dark and back, so the pull between cells
  comes and goes. With a lag of 0.3 or less everything falls into step and blinks as one; at 0.6 with omega 1 the clocks
  nearly stop in step (omega − pull x sin(lag) close to 0) and the culture freezes into a mottle. At 2000 cells the culture
  turns looser and busier (speed 7.5 against 4.4 px/s) and the rings are patchy. With the biology the fates form as usual
  (seed 3 at 160 s: stem 957, epithelium 375, neuron 529, cartilage 133, against 975 / 513 / 391 / 108 without).

**Rule c, sideways push (key .).** The force the partner A′ makes on the membrane (from its gradient, scaled and
saturating as field A's) applied at right angles (mode 0, default; `sideGain` 1). Mode 1 (`sideMode`) instead turns the
cell's velocity by the A′ it feels, as a charge in a magnetic field. Alone it does nothing visible (no phases, a weak
partner). With the clock (rule b) the inward rings break up and their fronts CURL: hooks and small spirals of yellow,
and of the step 6 relay's blue, wrap round each other like marbled paper or breaking waves. Each curl lives about 2 to 3 s
and then dissolves into wavy bands; no spiral core lasted. Measured at 10 000 cells loop only: local swirl rms 2.8 to 3.0
deg/s against 1.0 to 1.1 with rule b alone, about 140 bins of 6 R turning each way (of 950), and the eddies turn over
fast (correlation with the second before 0.11 to 0.17). Mode 1 changes little (swirl 1.1 to 1.3).
**The highlight of step 8**: `?cells=10000&bio=0&excl=0&seed=3&change=1&side=1&partner=1`, curls from about 40 s of simulation
time on (`&speed=2` gets there in 20 s; zoom in on the middle). In comparison runs at the same seed and zoom: b + c makes
the curls, a sharpens them, the relay (key 5) adds the blue ones; a + c without b stays a calm packing. Rotating clusters
(a group turning as one) were not seen.

**Rotation numbers (F overlay, "rotation" line).** About once a second the cells are read back and compared with the
copy before: the culture's spin (the best rigid-rotation fit about its centre, deg/s, + = clockwise on screen); the local
swirl (the velocity averaged in 6 R bins, half its vorticity, RMS over the bins), the same after taking out the spin
("eddies"), how many bins turn faster than 3 deg/s each way, and how well each bin's turning matches the second before
(near 1: the same eddies keep turning; near 0: new ones every second). Baselines (seed 3): spin about 0, swirl 0.9 to 1.5
deg/s, loop only and with the biology. 5 s means in brackets.

Tried and dropped: the arrow partner with the clock scrambles the phases (each direction couples with its own delay), so
symmetric is the default. Spirals by stirring across a step 6 relay ring (no step 8 rule): the cut front curls for a few
seconds, then the dense middle's pacemaker takes over again with target rings.

Live-tunable in `moire.cells.partner`: `on`, `gain`, `sat`, `eps`, `arrow` (rule a); `change`, `chMode`, `chGain`,
`chTau`, `chMax`, `chSign`, `omega`, `pull`, `lag` (rule b); `side`, `sideGain`, `sideMode` (rule c). State: `Cell.z` the
phasor (the Cell is now 56 bytes), `Bio.conv.y` the A′ felt (felt change), `Bio.conv.z` 1 while the clock runs; census
`Stats.extra[74..75]` (phasors off (1, 0), in the step 8 overlay line). Fields uniform 192 bytes.

Cost (physics per tick, GPU probe, GTX 1650 in headless Chrome; the probe drifts by about 0.1 ms between runs): 2000 cells 0.59 to
0.64 ms with step 8 off and 0.64 to 0.66 ms with all three rules on; 10 000 cells 1.10 to 1.21 and 1.05 to 1.09 ms. The
commit before step 8, measured in the same session, gave 0.66 to 0.71 and 1.11 to 1.21 ms, so the larger Cell (56
bytes) and the partner's extra sine on the membrane cost nothing measurable. The AMD Vega in headed Firefox: 3.9 ms at
2000 cells with all three on (3.3 ms in step 7), 80 fps at 1x; `?check=1` passes there and in Chrome.

## Heat and the entropy counter (Part C, step C1)

The first step of Part C (light, chemistry and heat; see `CLAUDE.md`). Every bit of motion the cells lose ends up as
**heat**, the lowest band of the energy ladder. Heat is a field like A or B but *incoherent*: it has no lattice and no
phase, only an amount per place, so it pushes nowhere in particular; it only shakes. The cells' Brownian jitter is now
"feeling the heat": a cell is kicked in a random direction each tick, harder where it is hot, and the kick uses that
heat up. Heat spreads fast, leaks out of the dish "to the sky", and makes the soft ripple background simmer.

**What it looks like.** About as lively as before, a little more where the culture is busy. The heat gathers where
the cells are and move most: under a busy culture the temperature is about 10 times the empty dish's (seed 3, 2000
cells with the biology: about 3.4 per R² under the cells, from 1.7 to 4.9 between the coolest and hottest tenth; 0.3 in
the empty dish). There the background simmers with small soft blips, while the empty dish stays smooth. Stir hard with
the mouse and the stirred path heats up (the stir's work becomes heat through the drag): for a few seconds the cells
there boil, then the heat leaks away. Stragglers out in the cool dish barely shiver. The loop-only view (`?bio=0`) is
calmer, so it runs cooler: its kicks are about as big as the old constant jitter.

**Energy.** One unit is the motion of a cell moving at 10 CSS px/s carrying 0.5 (energy 0.5 x (v / 10 px/s)^2). Each
tick a cell's velocity update is split into three parts, each booked:
- drag (the damping, v x 0.85): the motion it removes becomes heat in the 3 x 3 heat pixels under the cell;
- force (+ 0.15 x the sum of the forces: fields, contact, crawling, centre pull, walls, stirring): the change of motion
  energy it makes is the **work** coming in (it can be negative: a force that brakes a cell gives energy back);
- kick (a random velocity, Gaussian per axis): its mean energy is a share `grab` (0.004 per tick) of the heat under the
  cell, capped at `kickMax` (2 R/s per axis), times the cell's motility; its actual energy change is taken from the heat
  (a kick against the motion gives some back).
A cell that dies hands its motion to the heat too, and so does every cell when N or G starts a new culture. Kicks
consume heat and the heat leaks out, so the loop motion -> drag -> heat -> kicks -> motion cannot run away: at 8x for
600 s of simulation the temperature, the kick size and the rates stayed level.

**The heat grid.** One channel on a coarse grid, about one pixel per half a cell radius (396 x 247 for 2000 cells on a
1280 x 800 window; coarser beyond 300 000 pixels, e.g. 693 x 434 at 10 000 cells). All amounts are whole numbers of
counts (65 536 per unit) in i32, because WebGPU's atomics are i32 / u32 only: the cells add to a delta with atomic adds,
and whole numbers make the spreading exact (what one pixel gives, its neighbour receives, to the count). One storage
buffer holds `[ledger | delta | heat copy 0 | heat copy 1]` (`heat_common.wgsl`); each tick the spreading pass
(`heat.wgsl`, explicit, 4 substeps of k = 0.2 at 2000 cells) takes in the delta, adds the base warmth, leaks a share,
and spreads. The layout is channel-major, so later steps can add the other channels (atoms, fuels, sediment: 14 in
all) as more blocks of the same buffer. The step pass was at WebGPU's limit of 8 storage buffers, so it now finds where
a grid cell's cells end from the next grid cell's start instead of reading `counts`, which frees the slot for the heat.

**Ripples.** Each ripple cell gets a small random bump with a chance that grows with the square of the temperature
under it (`ripple_step.wgsl`), so hot places fill with small rings and cool places go still. The ambient drops (key A)
stay as they were.

**The entropy counter** (top right, every frame; Shift+E hides it):

    ENTROPY  2.06 M  +10.5 k/s
    moving 924 · heat in dish 21.1 k · in 2.09 M · rounding +0.027

- ENTROPY: all the heat that has left the dish so far, and how fast it leaves now (per second of simulation time);
- moving: the cells' motion energy now; heat in dish: the heat on the grid now;
- in: all the energy put in so far: the work of the forces on the cells plus the base warmth;
- rounding: in − (moving + heat in dish + ENTROPY), what does not add up. It is the rounding of each cell's energy
  changes to whole counts and of the 32-bit float arithmetic: the "free entropy" of numerical error. Measured: it
  wanders within a few hundredths of a unit (0.07 at most, at 10 000 cells) while in grows to millions (1e-8 of in
  or less), through new cultures, hard
  stirring, Shift+H and window resizes. Growing fast would mean a bug.
The GPU sums the heat and the motion once per frame, and copies the ledger (4 KB) into one of three read-back buffers,
read without waiting (the panel is 1 to 2 frames behind; if all three are busy, the counters keep adding up until the
next copy). The F overlay has two more lines: the grid and its knobs, and the energy flows per second (work in,
warmth in, drag to heat, kicks from heat, out), the mean temperature and the mean kick size.

Keys (Part C uses Shift + a letter; every plain letter is taken):
- **Shift+H**: jitter from heat on/off (off: the old constant jitter, which moves the position and involves no energy;
  the heat is still made, spread and leaked)
- **Shift+E**: entropy panel shown/hidden
- **Shift+R**: ripples simmer with heat on/off

URL options: `?heat=0` (kicks off at the start), `?entropy=0` (panel hidden), `?simmer=0` (ripples not driven by
heat). `tools/shot.py --key shift+h` presses Shift + a letter, and the tool prints the entropy panel.

Live-tunable in `moire.heat.params`: `kicks`, `spread` (12 R²/s; a warm patch spreads over about sqrt(spread / leak)
= 5 R), `leak` (0.5 per s), `edge` (extra leak at the dish edge, 0), `warmth` (0.05 per R² per s), `grab`, `kickMax`,
`pxR` (pixel size in R, 0.5; applied at the next resize). In `moire.background.params`: `heatDrops` (1e-4; since step C2
grab is 0.00125 and heatDrops 1e-5, see "Light"),
`heatAmp` (0.3), `heatMaxP` (0.004). The ledger itself: `moire.heat.ledger`, `moire.heat.tot`.

Measured energy flows (seed 3, 2000 cells with the biology, after 60 s): work in about 10 k per s, warmth 1.2 k,
drag to heat 16 to 17 k, kicks from heat 6 to 7 k (the kicks recycle about 40 % of the heat the drag makes), out
11 k; mean kick 0.35 R/s per axis against 0.13 R/s for the old jitter (the old one moved the position; as a velocity
kick that is the same spreading). Loop only (`?bio=0`): work 5 k per s, kicks 0.14 R/s. 10 000 cells loop only: 0.23 R/s.

Cost: GTX 1650 in headless Chrome, frame time unchanged (9.7 ms before and after; physics probe 0.74 to 0.86 ms
against 0.85 before at 2000 cells, 1.19 against 0.98 ms at 10 000: the 9 heat reads and 9 atomic adds per cell);
the heat's spreading pass 0.03 ms per substep on the 396 x 247 grid (4 substeps: 0.12 ms per tick, so about 1 ms
per frame at 8x) and 0.09 ms on the 693 x 434 grid of 10 000 cells (3 substeps: 0.26 ms per tick); the ledger's sums
and read-back once per frame are small next to that. In headed Firefox on this machine: 32 to 38 ms per frame, the
same as the commit before measured in the same session (25 to 45 ms; Firefox was slow on this machine that day either
way).

## Light (Part C, step C2)

A light falls on the dish. Where it falls, whatever catches it warms up: the caught light becomes heat in the heat grid
of step C1, so the cells there shiver more, the ripples simmer more, and the entropy panel shows "light in". The rest
passes through the dish and is lost. Two modes (Shift+L cycles spotlight / full field / off; the page starts with the
**spotlight**, because the contrast between the lit middle and the darker rim is the picture):
- **Spotlight**: a disc of light, by default at the dish centre with a radius of a quarter of the dish's shorter side. Tilt
  the beam and the spot becomes an ellipse stretched away from the light: the same power spread over a larger area (so
  dimmer on average, by cos(tilt)), and brighter on the near side (a linear slope across the spot, x (1 + 0.6 sin(tilt))
  on the near rim, x (1 - 0.6 sin(tilt)) on the far rim; its mean over the ellipse is zero, so the total stays the same).
- **Full field**: the whole dish lit evenly, with soft cloud patches drifting slowly over (low-frequency noise, about 380
  px across, drifting 6 px/s; a full cloud takes 45 % of the light).
- Both follow a gentle **day and night**: the power rises and falls over 240 s of simulation time, between 15 % (night)
  and 100 % (noon); the page starts at about half past eight in the morning (70 %), and noon comes after 36 s. Shift+D
  turns the cycle off (then it is always noon).

**Bands.** The light carries four bands on the one energy ladder of Part C (table `BANDS` in `src/light.js`, with
comments): WARM (photon energy 1, 40 % of the power), VISIBLE 1 (2, 22 %), VISIBLE 2 (3, 22 %) and HARD (5, 16 %). What
catches a band is a list of absorbers, each with an optical depth per band (Beer-Lambert: the share caught is
1 - exp(-sum of depth x amount)). In C2 there are two: the bare medium (warm 0.4, so 33 % caught; hard 0.08, 8 %) and the
cells (one full layer: warm 2.3, 90 %; hard 1.2, 70 %). Nothing catches visible light yet (no pigments, no atoms), so both
visible bands pass straight through. Later steps add their absorbers (atoms, sediment, the cells' pigment genes) as more
terms in `absorb()` in `heat.wgsl`.

**How it is computed.** Nothing new per cell except one number: during its step, while the light is on, each cell adds its
area (in heat pixels) at its centre into a fourth block of the heat buffer, the "cover" (the step pass is at WebGPU's limit
of 8 storage buffers, so this lives in the heat buffer it already has; the light's numbers come in as a uniform). On each
tick's first spreading substep every heat pixel works out the light falling on it (`light_factor` in
`light_common.wgsl`: the spot's ellipse with a crisp 1.5 px rim, or the clouds), reads the 3 x 3 mean of the cover, and
per band books what arrives and what its absorbers catch (whole counts, random rounding); only the caught part enters the
pixel, as heat. The cover is cleared after every tick. The drawing reads the same uniform, so what is drawn is exactly
where the heat goes.

**Ledger.** The entropy panel's "in" is now work + base warmth + absorbed light, and it still balances: over 330 s at 8x
(seed 3, through a full day and night) the rounding wandered between -0.005 and +0.04 while in grew to 7 M (5e-9). A
third panel line:

    light in 41.9 k/s → heat 15.9 k/s · passed 26.0 k/s · spot · day 100%

The F overlay adds three lines: the light's settings (mode, power, day level and the hour, spot position, size, tilt and
direction), the flows per s (in, absorbed, passed, and per band in → absorbed, with totals), and the temperature under the
cells in the spot and outside it (with the kick size it gives: sigma per axis, before the cell's motility), and of the
dish's pixels in and out of the spot.

**Retuned heat.** Most heat now comes from light, so a cell's kick takes a smaller share of the heat under it (`grab`
0.004 -> 0.00125 per tick) and the ripples' simmer chance per temperature squared is smaller (`heatDrops` 1e-4 -> 1e-5);
the base warmth stays at 0.05 per R² per s as a floor, so the dark dish is never frozen. Measured (seed 3, 2000 cells with
the biology, light at noon, after 60 s):

| | temperature under the cells (per R²) | kick (R/s per axis) |
|---|---|---|
| C1 (before; no light, the old grab) | 4.4 | 0.31 |
| spotlight: cells in the spot | 14.8 | 0.32 |
| spotlight: cells outside it | 5.0 | 0.18 |
| full field (all cells lit) | 12.7 | 0.29 |
| light off | 4.3 | 0.17 |

So the lit culture shivers about as C1's whole culture did, and the unlit rim visibly less (about 55 %). At 10 000 cells
loop only (`?cells=10000&bio=0`) the kicks are 0.36 R/s in the spot and 0.12 outside (C1: 0.23 everywhere), and the
difference shows plainly: inside the spot the labyrinth of worms melts into an even, shimmering crowd; outside it stays. Energy per s with
the spot at noon: light in 42 k, absorbed 16 k, passed through 26 k; work by the forces 10 k; warmth 1.2 k. Full field: in
268 k, absorbed 53 k. The empty dish in the spot warms to about 2 per R² (the bare medium catches 14 % of the light) and
simmers with small dimples; in full field the whole empty dish simmers that way.

**What it looks like.** A thin, hard-edged ellipse outline in a faded warm white lies over the culture, with a small
triangle on its rim on the side the light comes from, pointing inward. Inside, a very faint flat tint, posterised into
bands across the spot when it is tilted (brighter toward the light). The cells inside shiver about as in C1; those outside
the rim are calmer; the background inside the spot simmers. Over the day the lit middle calms down toward night (at 15 %
the cells in the spot are only about twice as warm as the rest) and livens up again in the morning. Full field: no outline,
only a very faint tint over the whole dish, in three flat levels where the clouds pass.

Keys and mouse:
- **Shift+L**: light: spotlight / full field / off
- **Shift+D**: day and night cycle on/off
- **right-drag**: move the spot (its centre follows the pointer; the context menu is off on the canvas)
- **wheel**: tilt the beam (5 degrees a notch, 0 to 70)
- **Shift+wheel**: turn the direction the light comes from (15 degrees a notch; browsers report Shift+wheel as a sideways
  scroll, so either wheel axis counts)

Left tap and left drag keep their meaning (drop, stir). In full field the mouse does not move the light (the hint says so).

URL options: `?light=spot|full|off`, `?spot=x,y,r` (shares of the dish's width, height and shorter side, e.g.
`?spot=0.3,0.6,0.15`; CSS px if any number is above 2), `?tilt=deg` (0 to 70), `?az=deg` (where the light comes from: 0 from
the right, 90 from below, 180 from the left, 270 from above; default 225, the upper left), `?day=0` (no cycle: noon),
`?hour=h` (the hour at the start, 12 = noon), `?clouds=0`. `tools/shot.py --rdrag x1,y1,x2,y2` right-drags and
`--wheel x,y,dy[,shift]` turns the wheel (dy 100 = one notch down), e.g.
`python tools/shot.py --wheel 640,400,1000 --wheel 640,400,-300,shift` tilts by 50 degrees and turns by -45.

Live-tunable in `moire.light.params`: `mode`, `power` (33 per 100 CSS px² per s at noon: per dish area, not per cell, so
the kicks it gives scale with the cells' radius; about 14 per R² at 2000 cells), `x`, `y`, `radius`, `tilt`, `maxTilt`,
`az`, `near` (0.6), `edge` (1.5 px), `day`, `dayPeriod` (240 s), `dayMin` (0.15), `dayStart`, `clouds`, `cloudSize`,
`cloudDrift`, `cloudDepth`; drawing: `colour`, `lineAlpha` (0.55), `lineWidth` (1.25 px), `marker` (7 px), `tintAlpha`
(0.045), `fullTint` (0.025), `tintSteps` (3). The band table: `BANDS` in `src/light.js` (read every frame).

Cost: GTX 1650 in headless Chrome, no change at 2000 cells (8.3 ms per frame before and after, held by the display rate;
physics probe 0.55 to 0.86 ms against 0.60 to 0.75 before, within its drift); 10 000 cells at 8x, 69 to 74 ms per frame
against 66 to 69 ms before. Headed Firefox on this machine (it picked the AMD Radeon): 22.7 to 27.8 ms per frame with the
light on and 19.8 with it off, against 19.5 to 23.3 ms for C1 in the same session; the runs scatter by several ms, so the
light costs perhaps 2 to 3 ms there (the absorption in the first spreading substep, the cells' cover, two small draws).
The spot is drawn on a quad around the ellipse only.

## Matter: springs and the atom grid (Part C, step C3)

The hand-made nutrient (green) and threat (red) sources are gone, and with them rule E and key E (CLAUDE.md, "NO
NUTRIENT, NO THREAT": food and harm are to emerge from the chemistry). In their place: **springs** that drip atoms into
the dish. Tap mode 2 drops a **light spring** (the row 1 atoms g, t, l in equal shares), tap mode 3 a **heavy spring**
(G, T, L, plus 4 % trace). A spring drips 6 atoms per second for 60 s of simulation time, then dries up and is
removed; C clears all springs at once. The atoms spread out, light ones quickly and heavy ones slowly, and slowly leave
at the dish's edge. There is no chemistry yet (no reactions, so no fuel or sediment is made) and the cells ignore the
atoms entirely: that is C4 and C5.

**What it looks like.** A small crisp ring where you click, in the colour of its atoms (pale for a light spring,
deeper red and thicker for a heavy one), with a centre dot that shrinks as the spring runs dry. Around it a disc of flat
dots grows, largest at the spring and smaller outward. After 10 s the light spring's dots reach about 45 px out, the
heavy spring's barely past its ring; after a minute the light cloud is some 250 px across with small dots at its rim,
the heavy one about 120 px with big dots packed near the middle; after three minutes the light cloud is a wide, faint
field of pinpricks (some 400 px) while the heavy one is still a compact disc of about 220 px. The dots sit on the
medium's own lattice, so a cloud is a crisp hex pattern, and it turns very slowly with the medium's breathing (about 1
degree).

**The periodic table** (`src/matter.js`, one table with comments). Each atom is two numbers, ROW (size) and GROUP
(role: giver, taker, linker; trace is the inert row 3 atom), and every property of every substance is derived from
them, never set per atom. For C3 only spreading matters (R² per s): row 1 spreads at 1.2, each row further down 0.12
times as fast (row 2: 0.14, trace: 0.017, "almost not at all"); a bonded pair spreads at its heavier atom's speed times
0.7 (gt 0.84, gT Gt GT 0.10); sediment does not spread. A patch spreads over about sqrt(4 × rate × t): in a minute the
light atoms 17 R, the heavy ones 6 R, trace 2 R. The inks come from the same table (by function, lighter for row 1).

**The grid.** 13 channels: the 6 atoms g t l G T L, the 4 fuels gt gT Gt GT (giver + taker), the 2 sediments ll LL
(linker chains) and trace; heat (step C1) is the 14th. They share the heat grid's pixels (half a cell radius each), so
C4 can react them with the heat, and they live in the heat's own buffer, behind its blocks, in two ping-pong copies:
the cells' step pass is at WebGPU's limit of 8 storage buffers and already binds that buffer, so the cells can reach the
atoms in C5 without one more. Fuels and sediment have their channels, spreading and drawing already; they stay empty
until C4 makes them. Amounts are whole numbers of counts (4096 per atom), like the heat, so matter is exactly conserved:
- each tick the springs drip on a disc of about 1 R (shared evenly over its pixels, random rounding);
- spreading is explicit and conservative: across each edge between two pixels flows k × the difference, rounded at
  random (so thin tails keep spreading instead of sticking at the last count), capped at a quarter of the giver's
  amount (so no pixel goes below zero); both pixels work the edge out from the same numbers, so what one gives the
  other receives, to the count;
- the sink: the pixels on the dish's rim lose 1 per s of what reaches them. An edge sink rather than a slow decay,
  because atoms are never destroyed: they leave, and the ledger says where. Light atoms reach the edge within minutes
  and drain; heavy ones mostly stay (the springs dry up, so the dish cannot fill up forever; Shift+C washes it);
- channels with nothing in them (and no spring dripping them) for 2 s are skipped, so an empty dish costs nothing.

**The atoms ledger** (a line in the entropy panel; details in the F overlay, per element too): added by the springs =
in the dish + lost at the edge + washed out (Shift+C) or dropped with the old grid on a window resize. Every amount is a
whole count, so the rounding is exactly 0, and it stayed 0 in every test: 300 s at 8×, a window resize, a wash, 10 000
cells.

**ORDER** (the entropy panel's fourth line): how patterned the dish's matter is. In one sentence: it is 1 minus the
Shannon entropy of where the atoms are (each pixel's share of each substance), divided by the entropy the same atoms
would have if they were smeared evenly over the whole dish, so 1 means all in one spot and 0 means evenly smeared.
Computed on the GPU in the same once-per-frame pass that counts the atoms (the sum of m ln m per workgroup), read back
with the heat's ledger, never waiting. With a light and a heavy spring (seed 3, 8×):

| simulation time | 10 s | 30 s | 60 s | 120 s | 180 s | 300 s |
|---|---|---|---|---|---|---|
| ORDER | 0.47 | 0.37 | 0.32 | 0.23 | 0.20 | 0.18 |
| atoms in the dish / out at the edge | 77 / 0 | 317 / 0 | 677 / 0 | 714 / 6 | 686 / 34 | 625 / 95 |

(The springs dry up at 60 s; everything that left by 300 s was light atoms.) The panel then reads, for example:

    ENTROPY  3.86 M  +13.6 k/s
    moving 766 · heat in dish 28.3 k · in 4.03 M · rounding −0.056
    light in 9595/s → heat 4217/s · passed 5378/s · spot · day 24%
    ORDER  0.204 · atoms in dish 686 · added 720 (+0/s) · out 33.7 · rounding 0

**Drawing** (the user's look then: crisp halftone dots, flat colour, no glow; since step C6n this halftone is the
machinery view, Shift+4 or Shift+5, and the default draws the substances as dust, see "The neon look and the clean
view"). The dot screen is the medium's own lattice,
every 2 lattice spacings (about 13 px). A triangular lattice has three interleaved sets of points (the points and the
centres of its two kinds of triangle), and each carries one layer, so layers never sit on each other:
- **free atoms** on the lattice points: one dot for all of them, its area c / (c + 0.6 per R²); its ink by chemical
  function, mixed by what is there: the reactive atoms (givers g G and takers t T, hungry for a partner) in the old
  threat red, faded; linkers (l L) a dim, quiet grey-blue; lighter for row 1, deeper for row 2;
- **fuels** on one set of triangle centres, in the old nutrient green (C4 on);
- **trace** on the other set, as small pale silver diamonds;
- **sediment** not as dots but a flat, dim brown-grey layer under the dots (C4 on); since step C5 a flat patch with
  hard edges and a lighter core, see "Cells eat".

Shift+S cycles: summary / each substance alone (g, t, l, G, T, L, gt, gT, Gt, GT, ll, LL, trace) / off; a short flash
names what is shown (and says when a substance is not in the dish yet), and so does the F overlay. A paint pass sums the
grid into two small textures once per frame; the drawing reads them once per dot.

Keys: **2** / **3** tap mode light / heavy spring (then click), **C** clear the springs, **Shift+S** what is shown,
**Shift+C** wash every atom out (booked as gone), **L** hides it with the rest of the landscape. URL: `?show=G` (or
`summary`, `off`, any substance). `tools/shot.py` presses keys before it clicks, so for both kinds of spring use
`--eval "moire.matter.addSpring(220,220,'light'); moire.matter.addSpring(1060,580,'heavy')"`.

Live-tunable in `moire.matter.params`: `rate` (6 atoms/s), `life` (60 s), `radius` (1 R), `maxSprings` (12), `edge`
(1 per s), `spreadGain`; drawing: `step` (2), `half` (0.6 per R²), `thresh`, `maxDot`, `level`, `traceDot`, `sedStep`,
`sedAlpha`, `ringR`. The table itself: `ATOMS`, `SPREAD`, `INKS`, `SPRING_KINDS` in `src/matter.js`. The ledger:
`moire.matter.ledger`, `.tot`, `.dish`; ORDER over time: `moire.matter.orderHist`.

**Cost.** An empty dish costs nothing (its channels are skipped): 10 000 cells loop only at 8× in headless Chrome,
8.3 ms per frame before and after. With a light and a heavy spring (7 channels moving): 2000 cells at 8×, still 8.3 ms
per frame (held by the display rate; the GPU finishes after about 8 to 9 ms against 7 before); 10 000 cells at 8× (a
693 × 434 grid), 13.3 ms. Headed Firefox, 2000 cells at 4× with two springs: 13.7 to 16.1 ms per frame against 15.7 to
16.4 before (no difference within the scatter). One lesson: the first version read the grid through atomics, as the
heat does, and on Direct3D (Chrome and Firefox on Windows) an atomic load is a read-modify-write: 73 ms per frame at
10 000 cells. The grid is now read through a second binding of the same buffer that covers only the grid, as plain
numbers (WebGPU forbids two writable bindings over the same bytes, but not over separate ranges), and the drip moved
into the spreading pass, so the grid needs no atomics at all.

## Chemistry in the open (Part C, step C4)

The atoms of step C3 now react with each other, out in the dish, with no cells involved (the cells still ignore the
atoms; eating is step C5). Light of the right band bonds a giver and a taker into **fuel** (green); heat breaks fuel
apart again; linkers chain into dark **sediment** crusts that warm up in the light and slowly crack under hard light; a
free light atom can take a heavy one's place in a fuel (a **swap**); and **trace** makes every reaction start more
easily where it sits. Energy is the currency throughout: every reaction is paid and booked, and what it releases ends
up as heat.

**Where to watch it.** (Since step C5 the page starts with a light and a heavy spring beside the culture and the spot
between them, see "Cells eat"; with `?springs=0` it starts as described here.) The cells are drawn over the substances,
and the culture sits in the middle of the default spotlight, so most of the chemistry there is hidden (it runs: the
culture is hot, so fuel made there burns quickly).
To see the substrate alone, move the spot beside the culture (right-drag, or the "move light" tool) and drop a light
and a heavy spring a hundred or two px apart inside it; or switch to full field (Shift+L) and drop springs in the empty
corners. For example:

    python tools/shot.py --query "spot=190,400,175&speed=8&day=0&springs=0" --at 30,90,240 \
      --eval "moire.matter.addSpring(110,400,'light'); moire.matter.addSpring(270,400,'heavy')"

**What it looks like** (that example, seed 3, 2000 cells, noon). After **30 s** both clouds are green: around the light
spring a disc of pale green fuel dots (gt) with pale pink free atoms and grey linkers between them; around the heavy
spring, which spreads much more slowly, a tight disc of deeper green (GT) and red (free G and T) dots (its trace
diamonds show once the spring's marker is gone). By **90 s** the springs have dried up; the light cloud has spread over most of the spot, still
pale green, and a small flat **crust** of warm grey has formed at the light spring's centre (sediment ll, about 1 per
R²). The heavy spring has its own crust (LL), smaller and thicker (1.4 per R², fastest there because trace sits there).
Between the two clouds the fuels mix: gT and Gt, a middle green. By **240 s** the light spring's fuel has mostly burned
away in the warm spot, leaving a sparse field of grey linkers and the crust, with an empty, fuel-free ring around the
crust (it is the warmest place in the spot: 6.1 per R² against 4.5 around, because the dark crust catches warm light);
the heavy cloud is a wide disc of green with red; the mixed fuels between them keep growing (gT and Gt from 0.01 to
0.05 per R²). Fuel that drifts out of the light keeps (cold and dark: frozen), so the clouds stay green a little beyond
the spot's rim while they fade inside. In full field the same happens around each spring, everywhere at once.

Honestly: in these runs nothing organises itself into fronts, rings or spots beyond that (the crust with its
fuel-free halo, the fuel kept just outside the light). The crusts stay small (a few heat pixels at the spring centres),
so the warming they cause does not feed back strongly enough to spread them.

**The energy table** (`CHEM` in `src/matter.js`, next to `ATOMS`; every number derived from row and group, nothing
set per substance):

| substance | energy (per unit) | spark | made by |
|---|---|---|---|
| free atoms g t l G T L, trace | 0 | | |
| fuel gt | 0.75 × (1 + 1) = 1.5 | 0.125 × 2 = 0.25 | visible 1 (photon 2 ≥ 1.75) |
| fuel gT, Gt | 2.25 | 0.375 | visible 2 (photon 3 ≥ 2.625) |
| fuel GT | 3 | 0.5 | hard (photon 5 ≥ 3.5) |
| sediment ll | −0.25 × 2 = −0.5 | 0.25 | (heat, downhill) |
| sediment LL | −1 | 0.5 | (heat, downhill) |

The band that makes a fuel is the lowest whose photon covers the fuel's energy plus its spark. All the factors are
multiples of 1/16: one count of a substance (4096 per unit) then carries a whole number of heat counts (65 536 per
energy unit), so every reaction moves energy **exactly**.

**The reactions** (`REACTIONS`, derived from the table; 22 of them), per pixel per tick:
- **make fuel** (Shift+F): giver + taker → fuel, by light of the fuel's band. The pair catches that band (its optical
  depth is `kMake` × a b / (a + b) per R²); the photon pays the bond and its spark, the rest becomes heat.
- **break fuel** (Shift+B): fuel → giver + taker, by heat: rate `kBurn` × exp(−spark / (theta × temperature)), with
  the temperature the pixel's heat per R². The bond's energy comes out as heat. And by hard light (the fuel catches
  it, `kPhoto`): photon and bond energy become heat. So fuel keeps where it is cold and dark and burns where it is hot.
- **swaps** (Shift+P): a free atom takes a partner's place in a fuel and leaves the old one free, by heat (spark of
  the bond it breaks, rate `kSwap` × amounts). They run by themselves only **downhill**, into a poorer bond. Because
  heavier fuel holds more energy, the swaps that run are the light atoms taking a heavy atom's place:
  t + gT → gt + T, g + Gt → gt + G, g + GT → gT + G, t + GT → Gt + T (each releases 0.75 as heat). A choice for you to
  judge: CLAUDE.md's example T + gt → gT + t would go uphill with this table (it would need 0.75 put in), so it does
  not run; it could only run if heavy fuel held LESS energy, or if free heavy atoms carried energy of their own.
- **sediment** (Shift+K): linker + linker → chain, by heat (rate `kSed` × amount², spark of the chain); releases 0.5
  (ll) or 1 (LL) as heat; it does not spread, so it piles up where it forms. **l + L do not link**: a chain is one row's
  linkers (there is no mixed sediment channel, and none is needed). Hard light cracks chains back into linkers
  (`kCrack`; photon minus the chain's energy becomes heat).
- **sediment is dark**: it catches the warm band (optical depth `dark` per unit per R²), which becomes heat, so crusts
  warm up in the light. This goes with the chemistry switch, not with Shift+K.
- **trace lowers the spark** (Shift+T): spark × 1 / (1 + `traceK` × trace per R²), for the reactions driven by heat (the
  light reactions use a fixed band per fuel). Trace itself never reacts.
- **chemistry** (Shift+M): everything at once. Off: the atoms only spread, as in step C3. URL `?chem=0`.

**How it is computed** (`react` in `matter.wgsl`). The substances now spread and react tick by tick, inside the heat's
pass of each tick, after the cells' step and before the heat spreads: so the reactions read this tick's temperature and
the cells' cover, and the heat they release goes into the heat grid's delta, taken in by the heat's next substep. Each
pixel works out the light that reaches its substances (the same light as the heat's absorption, after the bare medium
and the cells took their share), shares each band among its absorbers by optical depth (Beer-Lambert), then runs the
reactions in table order: each makes floor(x + random) events, capped by what its reactants hold, and an event moves
whole counts of matter and whole heat counts. So the atoms stay exact to the count, and so does the chemical energy.

**The books.** "Stored" is now the chemical energy in the dish: each substance's amount times its energy (fuel
positive, sediment negative). Light caught by the substances counts as energy in; it is not heat until a reaction
releases it. The entropy panel:

    ENTROPY  1.50 M  +15.1 k/s   8×
    moving 699 · heat in dish 30.6 k · stored 337 · in 1.54 M · rounding +0.0013
    light in 31.7 k/s → heat 4763/s · chemistry 276/s · passed 26.7 k/s · spot · day 100%
    ORDER  0.335 · atoms in dish 698 · added 719 (+0/s) · out 20.2 · rounding 0

where in = work + warmth + light absorbed by the medium and cells + light caught by the substances, and rounding = in −
(moving + heat in dish + stored + heat out + chemical energy that left with matter at the edge or by a wash). On a phone
the second line is "heat · moving · stored · rounding" and the light line shows what was caught in total. The F overlay
adds the energy table, the switches and knobs, and per second: fuel made, fuel burned (by heat, by hard light), swaps,
sediment formed and cracked, and the light the substances caught per band.

Measured (seed 3, two light and two heavy springs, spot): energy rounding between −0.018 and +0.015 over 300 s at 1× (in grew to 5.4 M), −0.086 to +0.009
over 400 s at 8× (7 M), −0.012 to +0.052 over 400 s at MAX; the same run with the chemistry off: −0.008 to +0.055, so the
chemistry adds no drift of its own; atoms rounding exactly 0 in every run.

**Knobs** (live in `moire.matter.chem`): `theta` (1/32: the temperature scale of the sparks; the cold dish, about 1 per
R², is frozen: e^−8 for gt; the empty spot, about 4.5, reacts: e^−1.8; the culture in the spot, about 15, fast),
`kMake` (1), `kBurn` (0.5 per s), `kPhoto` (0.03), `kSwap` (5 R² per s), `kSed` (2 R² per s), `kCrack` (0.01), `dark`
(3), `traceK` (3), and the switches `on`, `make`, `burn`, `swap`, `sediment`, `trace`. The sediment's look:
`moire.matter.params.sedStep` (0.3 per R² per level; it was 1.5, too high to ever show) and `sedAlpha`; a crust is drawn
as one flat warm-grey patch, its thicker parts as subtle steps inside it (step C5: two levels with hard edges, see "Cells
eat"). Tuning aid:
`moire.matter.probeLine(y, x0, x1, step).then(console.log)` prints every substance per R² and the temperature along a
row of the dish.

**Cost.** At 1× and 8× nothing to see: headless Chrome on the GTX 1650, 2000 cells, two light and two heavy springs,
9.5 ms per frame at 1× and at 8× (before C4: 9.6 and 9.6; held by the display rate); headed Firefox at 1×, three runs
each, alternating: 16 ms per frame before, after, and with the chemistry off (the 60 Hz display), the GPU done after
16 to 20 ms in all three. At the timelapse speeds it shows: MAX reached ×11.6 to ×13.1 against ×13.6 to ×16.5 before
(Chrome, two runs each); with the chemistry off ×13.9 to ×17.0, so moving the substances' passes into each tick costs
nothing and the chemistry about 15 to 20 % of the fastest speed. Most of that is spreading: once fuel and sediment
exist, 13 channels move instead of 7 (sediment does not spread, but it is still copied between the two copies every
substep). Firefox MAX: ×9.2 against ×12.2 (one run each). The reaction pass itself is light: each pixel reads its 13
channels, empty pixels stop there, and it needs no atomics on the grid.

## Cells eat (Part C, step C5)

The cells now live on the chemistry of C4. Every cell holds a small **stock** of the substances and a **battery**
(energy). Its membrane lets substances in and out, a built-in **burner** turns the fuel it holds into battery charge,
and the battery pays for crawling. Cells that sit in fuel fill up; cells far from it run down and go quiet; where a
cell dies, what it held goes back into the dish. No engines in the genome yet (C6), no pumps between cells (C7).

**What it looks like** (the default scene, seed 3, 2000 cells, 8×). The page now starts with a light and a heavy spring
just beyond the culture's right rim (below it on a tall phone screen), with the spotlight centred on the rim between
them, so the chemistry and the eating show without doing anything (`?springs=0`: the old empty start). Every cell
has a flat pale-green **core** in its middle (since step C6n, under the neon look, a soft-lit disc with a bright rim):
its battery, the core's area in proportion to the charge (green: the
fuel's colour, energy). At the start every cell has a small core (the starter charge). Within a minute the cells on
the rim by the springs have big cores, the light spring's cloud of green fuel dots has a bite out of it where they sit,
and a few of them crawl out into the cloud. Far from the springs the cores shrink to dots and vanish, and those cells
are drawn dimmer (down to 60 % at an empty battery) and stop crawling: they only shiver with the heat, so they pack
rounder and still. By 2 minutes a lobe of fed cells (cyan epithelium, violet neuron, white stem cells, all with big
cores) has pushed into the light spring's cloud; the cloud's edge against the culture is a clean front with no
dots behind it. By 10 minutes (MAX) the culture has shifted over both springs: the fed half sits in the spot with big
cores, the cloud survives only beyond the culture's front, and the far half is dim and still. The dish never runs
away: over 600 s the number of cells with more than half a battery rose from about 10 to 150-170 (8 %), the empty ones
(under 5 %) fell from 1700 to about 1300 of 2000, births and deaths stayed at 40 to 65 per s (as before C5).

**Stock and battery.** One more storage buffer, 16 numbers per cell: the 13 substances in the dish's own units (4096
counts per atom-unit) and the battery in the heat's units (65 536 counts per energy unit), all whole counts, so the
atoms stay exact. Stock and battery are only ever moved: through the membrane, by a reaction (the energy table's
numbers), at a death (the dead cell's stock goes back to the dish where it died, spread over its 3 × 3 pixels; its
battery becomes heat there), at a birth (the newborn takes half its parent's stock and battery: a split, not a copy),
and at a new culture (N, G: every cell's stock goes back to the dish, its battery becomes heat, then every cell gets a
**starter charge** of 40 % of a battery, booked as energy coming in). A cell holds at most `capR2` = 2 atom-units per R²
of its area; its battery holds `batMax` = 4 energy units.

**The membrane** (rule *cells eat*, Shift+A, the master switch): passive exchange with the 3 × 3 heat pixels under the
cell, by concentration: outside, what those pixels hold over their area; inside, the stock over the cell's area. Each
tick every substance moves a share of the way to equal concentrations: `perm` (3 per s) × its spreading speed from the
table, relative to the light atoms. So the light atoms pass at 3 per s, light fuel gt at 2.1, heavy atoms and the heavy
fuels at 0.25 to 0.36, trace hardly at all (0.04), sediment never. Inflow is scaled down as the stock fills
(1 − fill). A cell full of fuel near an empty patch lets fuel back out; a cell that burns its fuel keeps pulling more in.

**The burner** (Shift+U; since step C6 the rule "everyone burns", off by default, see "Engines in the genome"): every
cell's one built-in engine until C6 puts engines into the genome. Fuel → its two
atoms (gt → g + t, GT → G + T, ...), at `kBurner` (2 per s) of the fuel in stock, at most `burnMax` (2 fuel units per s
per cell). The bond's energy (1.5 for gt up to 3 for GT) goes into the battery, minus `ineff` (25 %) that becomes heat
at the cell. Each event's **spark** is paid from the battery first and given back (the reaction is downhill), so a
battery holding less than one spark starts nothing; trace inside the cell lowers the spark, as in the open. A full
battery burns nothing more. The atoms the burner frees leave through the membrane, and the light remakes fuel from them
out in the spot: a cycle.

**Reactions inside** (Shift+I): the table's heat-driven reactions of C4 run inside every cell by the same rules as in
the open, with the stock's concentration over the cell's area and the temperature under the cell: fuel breaking by heat
(wasted as heat, not into the battery), swaps (a light free atom that got in degrades rich fuel, t + gT → gt + T, heat
out) and sediment forming from linkers. There is no light inside (until pigments in C6), so no fuel making and no hard
light inside. **Sediment formed inside is expelled** where the cell is, onto the dish (it cannot pass the membrane, and
kept inside it would fill the cell with dead weight; expelled, a busy culture leaves crusts behind). Measured, the
inside reactions are small next to the burner (fuel broken by heat inside: 0.3 to 6 units per s, while the burners put
2 to 30 energy units per s into the batteries; swaps under 1 per s).

**Energy pays** (Shift+W, battery pays crawl): a cell's crawling (its wandering heading, and smell's steering) is
gated by its battery: full speed from `crawlFull` (30 %) of a battery up, in proportion below it, none when empty.
Brownian kicks from the heat stay free, so an empty cell still shivers. Crawling costs the battery `crawlCost` (0.012)
× the work of crawling at that speed against the drag (its motion energy × (1 − 0.85²) per tick). The battery's energy
goes into the motion, which the drag turns into heat as before; in the books it replaces that much of the "work coming
in". A choice for you to judge: paying the full work (cost 1) emptied every battery within seconds (2000 cells crawl
away about 3000 energy units per s, more than the springs' fuel holds), so the motor is 80 times "better than physics".
The other cost of living is turnover: every death turns a battery into heat (deaths run at about 2.5 % of the cells per
s), and that is what empties the cells far from fuel within a minute or two.

**Heat damage** (Shift+X): a cell's death rate rises where the temperature under it is above the **tolerance** `tol`
(15 per R²; a global knob now, a gene in C6): by `heatKill` (0.1 per s) × (temperature / tol − 1), at most `heatKill`
(from twice the tolerance). The culture in the spot is 12 to 16 per R² at noon, so the effect is a gentle extra turnover
in the hottest middle of the spot around noon (heat deaths a few per s then, none at night). It needs turnover on (T).
Lesson: the first version had no cap, and a hot patch ran away (deaths and births heat the dish, which killed more,
up to 30 000 deaths per s and 400 per R²); the cap keeps it bounded.

**Energy-biased turnover** (Shift+G, "rich cells divide"): when a cell dies, the touching neighbour that divides into
its slot is picked with weight `biasFloor` (0.05) + its battery share, so full cells win the slots around them and
their lineages spread from the fuel side (colour by lineage, V, shows it). This replaces the old nutrient rule.

**Smell** (Shift+N): the membrane's 6 corners (the outline's own geometry) read the fuels in the substance grid (each
weighted by its energy); their spread across the corners gives the fuel gradient, which steers the crawl up toward the
fuel: `smellGain` (0.5 R per s) × tanh(gradient / `smellHalf`), gated by the battery like the crawl. A/B at 180 s: with
smell, 40 to 67 cells above half a battery at 80 to 120 s against 14 to 35 without, and the fuel in the dish eaten down
to 224 units against 325.

**The books.** The atoms ledger is now added = in the dish + **in cells** + out; the panel's ORDER line says "in cells".
The energy books: "stored" = the dish's chemical energy + the cells' stock's chemical energy + their batteries, and
"in" includes the starter charges. A fifth panel line:

    CELLS  batteries 948 (full 8%, empty 64%) · atoms inside 658 · fuel inside 45.1 · burner +24.8/s · crawl −5.98/s

(full: more than half a battery; empty: under 5 %; fuel inside: the chemical energy of the cells' stock; burner: energy
into batteries per s; crawl: paid per s). The F overlay adds the switches and knobs, the flows per s (fuel burned →
battery + heat, crawl paid, inside reactions, atoms in and out, what deaths hand back), what the cells hold per
substance, how many cells are above half, empty, stuffed, and hotter than the tolerance, and the heat deaths per s.
Measured (seed 3, default scene): 600 s at MAX, energy rounding +0.02 to +0.07 while in grew to 10 M, atoms rounding
exactly 0 throughout; 600 s at 8×, +0.046 to +0.059 (in 7.9 M), atoms 0; a run at 8× through N, Shift+C, a window resize, G, and Shift+A off and on again: energy
rounding within ±0.021, atoms 0.

**How it is computed** (`src/eat.js`, `cell_eat.wgsl`). The cells' step pass is at WebGPU's limit of 8 storage
buffers, so eating is its own pass each tick, after the step and before the dish spreads, with four dispatches:
*dump* (a slot whose cell died this tick hands the dead cell's stock and battery back), *split* (each newborn takes
half its parent's), *plan* (every cell reads the dish plainly: what its membrane lets in or out this tick, the
temperature under it, and the smell at its corners) and *eat* (pays the crawl, moves the planned matter with atomic
adds and "takes" only where something moves, runs the burner and the reactions inside, expels sediment). A "take"
subtracts what is wanted and gives back what was not there, so two cells drawing on one pixel never drive it below
zero and never get more than it held. The step reads only a few numbers from the Cell record (battery share, the
smell gradient) and writes the crawl's cost, the dead cell's place and the parent for the eat pass. Matter written
into the dish must go into channels the dish is moving this frame (a channel left out must be zero in both copies), so
the matter's list of moving channels now also counts what the cells hold and what their insides can make, and keeps a
channel on until a ledger read-back has seen what went into it.

**Keys** (all on by default; each acts only while Shift+A is on; since C6 Shift+U is "everyone burns", off): **Shift+A** cells eat · **Shift+U** burner ·
**Shift+I** reactions inside · **Shift+W** battery pays crawl · **Shift+X** heat damage · **Shift+G** rich cells divide
(energy-biased turnover) · **Shift+N** smell. URL: `?eat=0` (start not eating), `?springs=0` (no default scene).

**Knobs** (live in `moire.eat.params`): `perm` (3 per s), `capR2` (2 per R²), `batMax` (4), `kBurner` (2 per s),
`burnMax` (2 per s), `ineff` (0.25), `starter` (0.4 of a battery), `crawlFull` (0.3), `crawlCost` (0.012), `tol`
(15 per R²), `heatKill` (0.1 per s), `biasFloor` (0.05), `smellGain` (0.5 R per s), `smellHalf` (0.05 energy per R²
per R). The look in `moire.cells.look`: `core` (0.55: a full core's radius as a share of the cell's), `coreInk`,
`starve` (0.12: below this share of a battery a cell dims) and `starveDim` (0.4). The default scene: `SCENE` in
`src/main.js` (springs' life 240 s, distance from the culture). The sediment's look (step C5's first fix): crusts are now
flat patches with hard edges, thresholded per screen pixel in two levels (the patch from `sedStep` and a lighter core
from 4 × `sedStep`), no smoothing; the C4 version anti-aliased each level along the slope of the amount, which on a
gentle crust spread each edge over several pixels and read as a soft blurred disc.

**Cost** (headless Chrome on the GTX 1650, seed 3, compared with C4 at commit 1ae88e5 with the same two springs and
spot). 2000 cells: 9.4 ms per frame at 1× against 9.3 (held by the display); MAX reached ×11.3 to ×12.7 against ×12.7
to ×13.8 (about 8 % slower). 10 000 cells at 8×: 111 ms per frame (×4.8) against 89 ms (×6.0); with the cells not
eating (`?eat=0`) 98 ms, so the eating itself costs about 0.4 ms per tick there and the rest is the larger cell record
(88 bytes instead of 56) and the extra dispatches. A lesson: the first version read the dish through atomics in the
eat pass and smelled in the step: on Direct3D an atomic load is a read-modify-write, and the step's probe at 10 000
cells went from 3.7 ms per tick (C4) to 6.4; with the plain-read plan dispatch it is 5.3.

## Engines in the genome (Part C, step C6)

Cells no longer all make their living the same way. Every genome now carries three **engine slots**, each one reaction
of the chemistry's table with a rate (and, for an uphill reaction, the light band its pigment catches), plus two more
genes, a **heat tolerance** and a **permeability**. Some lineages catch light with a pigment and make fuel with it, some
burn the fuel they find, most winners do both; a few swap atoms or make sediment for a small gain. The engines are drawn
as small coloured **parts** inside each cell, and turnover with mutation decides which engine sets spread where. C5's
built-in burner is now a switch, "everyone burns", off by default.

**The chemistry is symmetric** (the user: "as long as our chemistry enables endothermic and exothermic reactions and their
inverse, it is close enough"). Every reaction that changes energy exists in both directions, in the open and as an engine:
- downhill needs only its spark (in the open from the local heat; in a cell from the battery, given back) and releases
  its energy (in the open as heat; in a cell into the battery, minus `ineff`, 25 %, as heat);
- uphill needs the energy difference plus the spark (in the open from light of a band that covers both; in a cell the
  difference from light caught by a pigment, or from the battery, and the spark always from the battery).
New in the open: the four swaps also run **uphill by light** (gt + T → gT + t, gt + G → Gt + g, gT + G → GT + g,
Gt + T → GT + t: light upgrades a fuel with a heavy atom and frees a light one), slowly (`kUpSwap` 0.02, a fiftieth of
fuel making's depth), so C4's look does not change; they count with the swaps (Shift+P). The table now has 24 reactions.

**The engines** (`ENGINES` in `src/matter.js`, derived from the reaction table; a slot names one by its index, and the
order is part of the genome's meaning):

| # | engine | kind | energy per unit |
|---|---|---|---|
| 0-3 | g + t → gt, g + T → gT, G + t → Gt, G + T → GT | uphill: make fuel | stores 1.5, 2.25, 2.25, 3 |
| 4-7 | gt + T → gT + t, gt + G → Gt + g, gT + G → GT + g, Gt + T → GT + t | uphill swap (frees a light atom) | stores 0.75 |
| 8-9 | ll → l + l, LL → L + L | uphill: crack sediment | stores 0.5, 1 |
| 10-13 | gt → g + t, gT → g + T, Gt → G + t, GT → G + T | downhill: burn | releases 1.5 … 3 |
| 14-17 | t + gT → gt + T, g + Gt → gt + G, g + GT → gT + G, t + GT → Gt + T | downhill swap ("breathing") | releases 0.75 |
| 18-19 | l + l → ll, L + L → LL | downhill: make sediment (expelled) | releases 0.5, 1 |

A slot holds the engine's index + 32 × a band (0 to 3). For an uphill engine the band says what pays the difference:
- band 1, 2 or 3: a **pigment** for visible 1, visible 2 or hard light. Its optical depth is `pigK` × the slot's rate; it
  catches its share of that band of the light falling on the cell (shared by depth with the medium and the cell's body,
  as the dish's absorption does), in whole photons, one per event. The photon pays the energy that goes into the bonds;
  a weaker photon takes the rest from the battery; what is left of a photon, and photons with nothing to work on, become
  heat in the cell. This is a **harvester**.
- band 0: no pigment, a **storer**: rate × what it works on per s, the battery pays the whole difference: battery energy
  banked in the stock as fuel (burning it back returns 75 %).
In every case the uphill engine's **spark is paid from the battery** and lost as heat, and **light never charges the
battery**: only the downhill engines (and the C5 burner, when "everyone burns" is on) fill it. So a harvester without a
burner or a breathing swap runs its battery flat and stops: **pure harvesters do not exist** as a strategy that lasts
(the user: "harvesters should not be able to operate without burning at least a bit"). Downhill engines work as C5's
burner: rate × what they work on per s (the fuel; the scarcer of an atom and a fuel; pairs of linkers), the spark from
the battery first (an empty battery starts nothing), at most `engMax` (2 units per s) per slot, a full battery takes
nothing more. Slots run in order 1, 2, 3, after the membrane and before the reactions inside.

**The other genes.** **Heat tolerance** (founders 10 to 20 per R², C5's global was 15): heat damage uses the cell's own
(rule Shift+Z; off: the global `tol`). **Permeability** (founders 1.5 to 6 per s, C5's global 3): the membrane's rate for
the light atoms, each substance scaled by its spreading speed as in C5 (rule Shift+J; off: the global `perm`).

**Tradeoffs** (no gene is free; rule Shift+Q, upkeep): engines cost `upEng` (0.003 energy per s) × the sum of their
rates, and tolerance costs `upTol` (0.003 per s) × tolerance / 15, from the battery, as heat (what an empty battery
cannot pay is not paid). Permeability has no upkeep; its cost is emergent: a leaky cell loses its own fuel and atoms and
lets the light free atoms in (which degrade its rich fuel by the reactions inside); a tight one takes up fuel slowly.
A harvester also heats itself (each photon's rest, and photons with nothing to make), so tolerance matters in the light.

**Founders** (G, N; `STRATEGIES` in `src/genome.js`): founder k gets the k-th of 12 engine sets, so the default 12 founders
are 5 burners (gt fast, one heavier fuel slower), 3 harvest + burn (a visible 1 pigment for gt and a gt burner, half also
a heavy-fuel burner), 2 pigment-heavy cells (gt by visible 1, gT by visible 2, and a small gt burner: every founder that
harvests also burns) and 2 others (sediment from light linkers, and a breathing swap). With `founders = 0` every cell
draws one of the 12. Rates are drawn within each set.

**Mutation** (rule M, at every birth): rates × e^(0.1 g), tolerance × e^(0.04 g), permeability × e^(0.08 g) (g a standard
normal draw; an empty slot stays empty); and with chance `engJump` (0.04 per birth) one slot jumps: to another of the 20
engines (45 %; an empty slot starts up at a rate of 0.4 to 1.4), to another band, 0 to 3 (30 %), or it empties (25 %).

**What it looks like** (the default scene, 2000 cells, MAX, seeds 3 and 7, Chrome on the GTX 1650; these are the
numbers with every rule above). At the start the culture is a mix: most cells show a green diamond or two (burners),
many a small gold disc at the top (a visible 1 pigment), some a sky-blue disc (visible 2), a few a red triangle (a
breathing swap) or a grey square (sediment). In the first two minutes the cells on the rim by the springs fill their
green cores; from 2 to 5 minutes the cells in the spotlight with a gold disc AND a green diamond (harvest + burn) have
the fullest cores (mean battery 0.4 to 0.75 against 0.05 to 0.3 for the burners beside them), win the freed slots
around them and fill the spot: by 10 minutes 89 % of the cells in the light are harvest + burn, by 20 minutes 88 to 94 %,
and their lineage has spread into the dark part of the culture too (77 to 82 % of all cells), where it carries its
pigments uselessly (all batteries in the dark are empty, so there is nothing to select by there; it changes by drift and
by the lit lineage pushing in). The visible 2 pigment dies out in the light (its fuel gT needs the heavy taker T, which is
scarce). Cells with a pigment but no burner keep appearing by mutation (a slot jump empties or replaces the burner): 1 to
5 % of the cells at 2 to 10 minutes, 5 to 10 % at 20 minutes, every one of them with an empty battery (mean 0.00 in the
light and in the dark): they run flat, never win a slot and are replaced as turnover reaches them. The colour-by-strategy
view (key V, third press) shows it as areas: the spot a block of gold-and-green split cells, green burners around it.

Census over time (share of all cells harvest only / burn / harvest + burn / other; in brackets: among the cells in the light):

| sim time | seed 3 | seed 7 |
|---|---|---|
| 120 s | 1 / 39 / 52 / 8 (1 / 33 / 59 / 8) | 1 / 39 / 40 / 19 (1 / 43 / 41 / 15) |
| 300 s | 2 / 35 / 58 / 6 (2 / 20 / 76 / 2) | 4 / 31 / 50 / 15 (1 / 33 / 62 / 5) |
| 600 s | 2 / 33 / 63 / 2 (2 / 7 / 89 / 1) | 5 / 21 / 66 / 8 (0 / 9 / 89 / 1) |
| 900 s | 3 / 30 / 66 / 1 (1 / 28 / 71 / 0) | 10 / 14 / 71 / 5 (3 / 8 / 84 / 4) |
| 1200 s | 5 / 18 / 77 / 1 (1 / 5 / 94 / 0) | 10 / 7 / 82 / 1 (7 / 3 / 88 / 2) |

Births and deaths stayed at 41 to 74 per s, cells above half a battery rose from 5 % to 17 to 38 %, and nothing
collapsed. Seed 7 had two bursts of heat deaths around noon (up to 36 per s for a while, capped by `heatKill` as in C5):
a dense patch of harvesters in the spot heats itself. An earlier tuning with the pigments at a quarter of their strength
(pigK 0.03) let the burners win instead (65 % of all cells, 76 % in the light at 15 minutes): the dish's own light
chemistry, which then caught four times more light than the pigments, fed them.

**Free light atoms and breathers** (the user's question: a "great oxidation"-like moment?). The uphill swaps free light
atoms (g, t) as waste; the breathing swaps eat them with rich fuel. The panel's FREE LIGHT ATOMS line shows the free g and
t in the dish and how many cells carry an uphill swap with a pigment and how many a breathing swap. Honestly, at the defaults there was no
such moment. Over 20 minutes the free light atoms did build up slowly (g from 44 to 73 in seed 3, from 45 to 106 in seed
7; t the same), but not from the uphill swaps alone (the springs stop at 240 s, and the harvest + burn cells' cycles and
the dish's own chemistry move light atoms too), and the breathers did not rise after it: cells carrying a breathing swap
fell from 171 to 89 (seed 3) and from 407 to 155 (seed 7), and the cells carrying an uphill swap with a pigment stayed
few (6 to 112, mostly in the dark, where they do nothing). The knob that came closest: the uphill swaps in the open 15
times faster (`moire.matter.chem.kUpSwap = 0.3`, seed 7): the free light atoms rose earlier (88 by 300 s against 60) and
reached 112 at 20 minutes, the dish's swaps ran at 23 per s, and the breathers kept a foothold in the light (11 % of the
cells in the spot are "other", mostly breathers, against 0 to 2 % at the defaults; 113 breathers in the light) though
their total still fell (468 to 293). No rule forces it.

**The census.** The entropy panel has two new lines:

    ENGINES  harvest 10% · burn 7% · both 82% · other 1%  (batteries 0 · 1 · 43 · 0 %) · in the light 7 · 3 · 88 · 2 % · tolerance 16.4 · perm 3.53
    FREE LIGHT ATOMS  g 106 · t 108 in the dish · cells with an uphill swap 51 · breathers (downhill swap) 155

(share of the cells per strategy, their mean battery, the shares among the cells in the light, the mean tolerance and
permeability; on a phone a short form). A "harvester" is a cell with an uphill engine that has a pigment; "both" also has
a burn engine; a storer alone does not make a harvester. The F overlay adds the switches and knobs, the engines' flows per
s (light the pigments caught per band, made uphill, made by storers, what the batteries paid for sparks and differences,
idle photons, burned / swapped / chained, into the batteries, the engines' heat, upkeep), per strategy in the light and in
the dark (cells, mean battery, cells above half, mean rates, tolerance, permeability), the uphill slots per band (storers,
visible 1, visible 2, hard), the shares every 10 s and the free light atoms, uphill swappers and breathers every 60 s. It
is counted on the GPU in the ledger pass once per frame and comes back with the energy ledger's read-back (never waits).

**Parts** (the user's body-plus-parts plan; colour means function). Each non-empty slot is a small flat mark with a hard
edge around the battery's core, at a fixed place (slot 1 up, slot 2 lower right, slot 3 lower left), its area in
proportion to its rate up to `partRate` (2): **harvester** a disc in its band's colour (visible 1 gold, visible 2 sky
blue, hard pale violet; `ink` in `BANDS`, `src/light.js`), **storer** a ring in the battery's pale green, **burn** a
diamond in the fuel's deeper green, **breathing swap** a triangle pointing out, faded red, **sediment** a square, dim warm
grey. The body keeps its fate colour; the lattice dots dim to 45 % and keep a clear margin around each part; the core is a
little smaller at full charge (0.36 of the radius instead of 0.55). The parts show while the engines run (Shift+O). A cell
is about 13 px across at 2000 cells on a computer screen, so zoom in (pinch, or the browser's zoom) to read them.
Since step C6n the inks are in `src/palette.js` (`band`, `core`, `burn`, `swap`, `sed`), and under the neon look the
parts are small bright lamps, whiter at their centres; the lattice dots are off in the clean view (Shift+6).

**Colour by strategy** (key V cycles fate → lineage → strategy; `?view=strategy`): harvester only = its band's colour,
burn only = green, both = split down the middle (band colour left, green right, a crisp edge), the rest = dim grey; every
body gets the same flat fill (`strategyFill`, 0.5). Starving cells still dim.

**The books.** Light the pigments catch is energy in (the light line shows "pigments …/s"; "passed" is what nobody
caught). The pigments put their optical depth down in the heat buffer (three blocks behind the substances, one per band,
each cell spreading its depth over its 3 × 3 pixels; cleared after each tick), so the dish's absorption (`absorb` in
`heat.wgsl`) and the substances' light reactions (`react` in `matter.wgsl`) see that much less of the band: light is not
used twice. Everything else moves whole counts as in C5. Measured (final code, seed 5, MAX): a run through N (120 s), Shift+C (220 s), a resize
(300 s), G (400 s), a resize back (480 s) and a new spring (520 s): energy rounding between −0.001 and +0.091 while in
grew to 11.8 M, atoms rounding exactly 0 throughout; the 1200 s runs ended at −0.12 (16.8 M) and +0.092 (20.4 M), atoms 0
(an earlier version's stress run drifted to −0.18 at 11 M and the same run with the engines off and everyone burning
stayed within −0.04 to +0.08; the final code's runs are back within ±0.12, of the size C5 showed).

**Rules** (group "Engines in the genome (step C6)" in the rules panel; each acts only while Shift+A is on): **Shift+O**
engines · **Shift+Y** pigments · **Shift+Q** upkeep · **Shift+Z** gene: heat tolerance · **Shift+J** gene: permeability;
and in the C5 group **Shift+U** everyone burns (C5's built-in burner, now off by default). URL: `?engines=0`,
`?burners=1`, `?view=strategy`.

**Knobs** (live in `moire.eat.params`): `engMax` (2 per s per slot), `pigK` (0.12: a pigment's optical depth per unit of
rate; a rate of 1 catches 11 % of its band), `upEng` (0.003), `upTol` (0.003), `tolRef` (15); `moire.genome.params.engJump`
(0.04); `moire.matter.chem.kUpSwap` (0.02); the look in `moire.cells.look`: `parts`, `partSize` (0.24 of the radius),
`partDist` (0.58), `partRate` (2), `partDots` (0.45), `coreParts` (0.36), `burnInk`, `sedInk`, `swapInk`, `otherInk`,
`strategyFill` (0.5).

**How it is computed.** The genome grew from 32 to 40 floats (`Bio.eng`: the three slots and the tolerance; `Bio.rate`:
the three rates and the permeability). The eat pass (`cell_eat.wgsl`) also binds the light and this tick's genome copy
(one bind group per copy of the double-buffered genome): `plan` reads the permeability, `eat` runs the pigments, the
engines and the upkeep, `ledger` counts the strategies. The step reads the tolerance for heat damage; the drawing reads
the genome for the parts. The engine table travels in the eat uniform (struct `Eng`). The ledger grew by 3328 words (16
engine counters and the census).

**Where the colours are decided** (one place, for restyling): the parts' and the strategy view's inks are
`moire.cells.look` (`burnInk`, `sedInk`, `swapInk`, `otherInk`, `coreInk` for the storer's ring) and the light bands'
`ink` in `BANDS` (`src/light.js`) for the pigments; the shapes and places are in `cell_draw.wgsl` (step C6 block).

**Cost** (headless Chrome on the GTX 1650, seed 3, 2000 cells, against C5 at commit 0ead2fd, alternating runs): MAX
reached ×11.4 and ×12.0 against ×12.1 and ×11.4 (no difference beyond the noise); at 1× 8.3 ms per frame in both (held
by the display), the step's physics 0.62 ms per tick against 0.67. The pigments' blocks are read as one word per band per
pixel (each cell spreads its depth over its 3 × 3 pixels when it puts it down), as atomic reads are slow on Direct3D.
Firefox (headed) ran the page without errors.

## The neon look and the clean view (step C6n)

The user, 2026-11-15: "I don't want the rendering to look like 80s computer graphics, I want it to look like 80s neon
colour lights. Think of video clip graphics." And: "Simplify what is shown: fields (dots) can be hidden, just the cells,
interesting materials, the substrate. Nothing algorithmic." Only the drawing changed: the simulation, the ledgers and
the census are the same code (see "Checked" below).

**What it looks like.** Black dish, the soft ripples underneath as before (the one soft layer), and on it the cells as
thin bright **neon tubes**: each outline is a tube about 1.1 px wide whose centre line is nearly white-hot and whose
edges carry the fate's colour, with a tight coloured halo around it; the inside of the cell is dark, with only a faint
tint and a soft glow just inside the tube (as a lit tube lights the wall behind it). Inside, the battery is a small
**soft-lit disc with a bright rim** (its size is still the charge), and the engines are tiny bright **lamps** (the same
shapes and colours as in C6, whiter at their centres). Fates in neon colours: stem warm white (peach), epithelium cyan,
muscle hot pink, neuron violet, cartilage amber. In a packed tissue every cell stays a separate ring: the halo is about
a tube's width, and only bright light makes one (the dark insides do not), so the dish does not fog over. The
substances are **material**, not a dot screen: fuel is green glow-dust, free atoms are fainter specks (red to grey-blue
by their mix), trace is a rare small spark, sediment is a solid dark crust. The spot's outline is a quiet warm-white
line, the springs are small lit rings.

**Trails.** Moving cells leave short fading streaks, as a long exposure or video feedback: the cells are drawn into
their own buffer, which is faded each frame (by exp(-real time / 0.15 s); the ghosts lose their opacity three times
faster than their light, so they glow and never shade what lies under them) before the new frame is drawn over it.
Only the cells trail: the substances, springs, spot and the panels never do. The fade runs on real time, and above 1x
it shortens by the square root of the speed reached (at 16x a quarter, at MAX about a third or less), so a timelapse
shows short ghost outlines instead of smear. At 1x the cells crawl slowly, so the trails show mostly where cells are
stirred, shoved or jitter in hot spots (a slight softness on shivering cells).

**Hum.** Every tube's brightness wobbles by about 5 % at its own slow rate (0.5 to 1.3 per s) and phase (from the cell's
seed), and rises with the cell's **activity**: how fast its battery changes, either way (burning fuel or a downhill
engine fills it; crawling, sparks and upkeep empty it), smoothed over about 0.6 s of real time. An idle cell is at 0.8,
the busiest at about 1.1 (they look whiter: the tube saturates toward its white core). In the default scene at 1 to 2
minutes most batteries are empty and the busy cells are the few percent near the springs and in the spot, so those
light up. A division flares briefly (the parent's battery halves, the daughter's jumps). Measured: the activity's
median is near 0, the top 1 % about 0.04 to 0.07 battery per s (`humAct`, 0.03, is where a cell is 63 % of the way to
the busiest). The activity is worked out by a small compute pass of the drawing's own (`cell_glow.wgsl`), which reads
the cells and writes only its own buffer.

**The clean view (default) and the machinery.** The default screen shows the cells, the materials, the light and the
ripples. Everything diagnostic is behind one switch, **show the machinery** (Shift+4, view panel; `?machinery=1`):
the cells' field dots (K, J, ;), the lattice inside each cell (Shift+6), the substances as the halftone on the medium
lattice (Shift+5), and the marks of steps 6 to 8 (the blue leak dot and converted outline, the state bar, the clock
hand). Each layer keeps its own switch too. The short hint line at the bottom goes quiet 8 s after the start on a
computer (flashes still show, ? still lists all keys); the entropy panel stays (Shift+E hides it).

**Switches** (keys, and the view panel's new "Look" group at its top):
- **E**: neon look on / off. Off is the flat look of steps 1 to C6 (crisp shapes, the faded palette, no glow, no
  trails, no hum), kept for comparison; with Shift+4 too it is the old page exactly (`?neon=0`).
- **Shift+1**: halo off / low / medium (default) / high (`?halo=high`).
- **Shift+2**: light trails on / off (`?trails=0`).
- **Shift+3**: hum on / off (`?hum=0`).
- **Shift+4**: show the machinery (above). **Shift+5**: substances as dust / halftone. **Shift+6**: the lattice
  inside the cells.
Every Shift + letter was taken, so these are Shift + a digit key. The page reads the key's place on the keyboard, so
it works on any layout; where Shift + that key types a symbol that is already a key of its own (Shift+7 is / on a
German keyboard, Shift+1 is 1 on a French one), the symbol keeps its meaning and the view panel has the switch.

**How it is drawn** (`src/neon.js`, `neon.wgsl`). Every layer but the background now draws into float buffers
(rgba16float, the canvas's size), and the frame is: (1) the ripple background onto the canvas; (2) the cells into the
trail buffer, after fading it; (3) the light buffer: the layers under the cells (field dots, substances, the light's
tint), the trail buffer copied over them, then the spot's outline; (4) the halo: the light at half resolution (the
cells at full weight, the rest at 45 %, each pixel through a soft knee so only light brighter than about 0.1 to 0.45
makes a halo), blurred by a Gaussian of 1.4 CSS px; with halo medium and high once more at a quarter resolution, 4.5 px,
added faintly; (5) the composite onto the canvas: the light as drawn, plus 1.2 x the tight halo and 0.25 x the wide one
(medium), through a soft shoulder above 0.82 so a tube brighter than white saturates toward white instead of clipping
in one channel. With the neon look off, steps (2) to (5) only copy: no fade, no halo, no shoulder, and the result is the
old picture (premultiplied "over" in a float buffer and then over the background is the same as drawing in order).
Recording (Shift+V) copies the canvas, so videos get the finished picture.

**Palette.** Every colour is in one place, `src/palette.js`: `FLAT` (the faded palette) and `NEON`, with the same
meanings (fates; the light bands; the battery, burn, swap, sediment engines; the strategy view's "other"; the
substances by function; the spot; the field dots) and the levels of the quieter layers (substances 0.62, field dots
0.2, spot 0.4 under neon). E swaps every colour at once. The cells' fate colours moved from the shader into it; the old
`moire.cells.look` inks (`coreInk`, `burnInk`, `sedInk`, `swapInk`, `otherInk`), `BANDS[].ink` and the landscape's
`cellColour` / `bColour` / `pColour` now live there.

**Knobs** (live from the console): `moire.neon.params`: `halo` (index), `trails`, `hum`, `sigma1` (1.4 CSS px),
`sigma2` (4.5), `res` (2: the tight halo at half resolution; 4 = quarter), `level2` (the wide level), `knee` ([0.1,
0.45]), `others` (0.45), `trail` (0.15 s), `trailSpeed` (0.5), `trailAlpha` (3), `shoulder` (0.82), `autoMs` (26).
`moire.cells.look`: `tube` (1.1 px), `white` (0.6), `innerGlow` (0.08), `innerReach` (0.3), `nFill` / `nFillC` /
`nFillA` (the inside: 0.03, 0.06, 0.8), `nLine`, `nDots`, `nStrategyFill`, `nStarveDim` (0.25: a starving cell dims
less than in the flat look, as the hum already dims idle cells), `coreRim`, `coreDim`, `partWhite`, `humDepth` (0.05),
`humRate` (0.9 Hz), `humIdle` (0.8), `humAct` (0.03), `humTau` (0.6 s), `innerDots`, `marks`. `moire.matter.params`:
`style` ('dust' or 'halftone'), `dustCell` (3.2 px: at most one speck of each kind per square), `dustR` ([0.45, 0.95]
px), `dustAtoms` (0.55). For tuning the hum: `await moire.cells.glowStats()` gives the activity's percentiles.

**Phones and small screens** (touch-only, or the shorter side under 600 px; `?cheap=0|1` overrides): the cheap path,
the tight halo at a quarter resolution, no wide level, trails 0.1 s. On any device, if frames are slower than 26 ms for
3 s at 1x to 8x (not paused), the halo steps down by itself (the wide level off, then quarter resolution, then halo
low) and says so in the hint line.

**Cost** (this machine; F overlay's "drawing per frame (gpu, probe)": all the drawing timed on its own). Headless
Chrome, 1280 x 800, 2000 cells: the flat look 0.65 ms, neon (halo medium, trails, hum) 0.75 ms, halo high 0.78 ms,
the cheap path 0.68 ms; 1920 x 1080 at MAX: 3.0 ms flat, 3.6 ms neon (measured while the simulation runs flat out, so
rough). MAX reached at 1920 x 1080: the old page (before C6n) x11.4 and x12.1, neon off x12.2, neon x12.0: no
difference beyond the noise. Firefox (headed, 1600 x 1000): 11.6 ms per frame at 8x, drawing 2.6 ms. Phone size
(Chrome, 390 x 844 at 2 device px per CSS px, cheap path): drawing 0.67 ms. Memory: two float buffers of the canvas's
size (8 bytes per device pixel each: 16 MB at 1920 x 1080) plus the halo levels.

**Checked.** No WebGPU errors in Chrome (headless) or Firefox (headed). Recording: 3 s in Chrome gave a 1.5 MB VP9
WebM whose frames are the finished picture (mean brightness 45 of 255, not black). The simulation: the drawing only
reads the cells (the hum's pass writes its own buffer). The numbers cannot be compared to the last digit, because the
simulation is not bit-for-bit repeatable between runs on the GPU (the same seed with neon off twice, stopped at the same
tick with `?until=40`: batteries 154 and 161, atoms in cells 80.3 and 83.5); neon on falls inside that spread
(batteries 154, atoms in cells 81.4). `?until=T` (new) runs to simulation time T and pauses at exactly that tick.

## Charge (Part C, step C6b)

The atoms now carry **charge**, and charge makes a field of its own on the substrate. Everything follows from the
periodic table's GROUP (`GROUP_CHARGE` in `src/matter.js`), nothing is set per substance: a **giver is +1**, a **taker
-1**, a linker and the trace 0. A substance's charge is the sum of its atoms', so every fuel (a giver and a taker) and
every sediment is neutral, and only the four free atoms g G (+) and t T (-) are charged. Every reaction moves atoms
without changing their groups, so every reaction and every engine conserves charge; the page checks that at startup
(and would stop with an error if a later table change broke it). The F overlay lists the charges.

**The screened charge field** (Shift+7, on). The free charged atoms, and the cells' net charge (below), make a potential
**phi** on the substrate grid, like charge in salty water: phi - lambda² ∇²phi = strength × rho, where rho is the charge
per R². Its decay law is an exponential cut-off: a charge's field fades over the **screening length** lambda (3 R), so it
reaches a few cells and no further. The free charged atoms **drift** in it, + down the potential and - up it, at their
own spreading speed (Einstein's relation, phi in units of the thermal energy), on top of their spreading. So a fast light
atom cannot run far ahead of its slow partner of the other sign: where they part, the charge they leave behind pulls
them back together, and the cloud spreads as a pair.

What it looks like, on a test spring of light givers g (fast, +) and heavy takers T (slow, -) only (not one of the
page's springs; in the console: `import('./src/matter.js').then(m => { m.SPRING_KINDS.ion = { label: 'ion', mix: { g:
0.5, T: 0.5 }, stroke: 1.5 }; moire.matter.addSpring(200, 200, 'ion'); })`, with `?springs=0&chem=0&light=off`). Without
the field the light givers run out into a wide faint haze around a tight core of heavy takers; with it the cloud is one
compact disc with a clear edge, and grows as one:

| simulation time | 30 s | 60 s | 90 s | 120 s |
|---|---|---|---|---|
| rms radius of g / T, field off (R) | 8.1 / 2.9 | 11.6 / 4.2 | 16.0 / 5.8 | 19.1 / 7.1 |
| rms radius of g / T, field on (R) | 5.0 / 3.9 | 6.8 / 5.6 | 9.6 / 7.8 | 11.7 / 9.5 |
| largest charge density (per R²) off / on | 4.3 / 0.17 | 5.3 / 0.15 | 1.7 / 0.045 | 1.0 / 0.039 |

(The heavy takers are pulled out a little and the light givers held back a lot: the "ambipolar" spreading of a plasma.
At `strength` 300 the pair stays tighter still (10.8 / 10.0 R at 120 s) but the dripping spring's centre starts to flicker
between + and -; 80 is the default.) With the contour lines on (Shift+0) the test cloud is a set of blue rings (its core
holds the slow takers' excess) inside rose rings (the givers' fringe).

In the **default scene** the field does almost nothing: the springs drip givers and takers in equal shares, a row's giver
and taker spread at the same speed, and every reaction conserves charge, so the clouds are neutral to a few counts.
There phi is tiny (rms 0.003, at most 0.1 to 0.3 near the most charged cells) and the dish looks the same with the field
on and off.

**Cells' charge from their stock** (Shift+8, on). A cell's charge in field B (step 5) is now the net charge of what it
holds: q = tanh(net / qHalf), qHalf 0.01 atom-units, replacing the fixed charges per fate (Shift+8 off gives them back,
with their own sign rule: exactly the page of step 5). With the charge field on, each cell also puts its net charge down
where it is, so a charged cell gathers a small cloud of the other sign around it. And field B's sign rule for these
charges is **like repels like** (`moire.charge.params.bSign`, U flips it), the way real charge and the substrate's field
behave; the per-fate charges keep "like attracts like" with the biology, as before.

What makes a cell charged: not much, honestly. A cell lets givers and takers of one row through at the same rate, and
its reactions conserve charge, so most cells are neutral to a few counts (they hold about 0.3 atom-units of each light
atom). The cells that do get charged are the ones running **swap engines**: a swap such as t + GT → Gt + T turns a light
taker into a heavy one, which leaks out eight times slower than light takers come in, so the cell piles up takers (-);
g + Gt → gt + G piles up givers (+). At 300 s (seed 3, MAX) 100 to 150 cells of 2000 are net + and as many net - (|q| above
0.1), mean |q| 0.05; the most charged hold 0.03 to 0.07 atom-units more of one sign. The new **colour by charge** view
(key V, the fourth press; `?view=charge`) shows them: grey neutral cells, rose for net +, blue for net -; they sit mostly
in the spot by the springs, where the breathers work.

What it does to the culture: since most cells are neutral, field B mostly falls silent. The culture is then held by
adhesion and the pull to the centre alone, and at 300 s it is a little more compact, a finer mosaic of small tissue
patches (with the per-fate charges, Shift+8 off, the opposite charges of stem and epithelium against muscle and
cartilage push the patches apart into a looser culture with larger domains). The charged cells do not form anything of
their own yet that the eye picks out. Charge separation that matters will need what the chemistry does not have yet:
pumps that move one sign (C7) and charge per side (C6d).

**Cells feel the substrate's field** (Shift+9, on). A charged cell is pushed down (+) or up (-) the gradient of phi
across its membrane: the eat pass reads phi at the membrane's six corners (the same corners that smell), and the next
step pushes the cell by `feelGain` (20 R/s per unit of phi per R) × q, at most `feelSat` (1 R/s). Around a charged cell
phi changes by about 0.01 to 0.05 per R, so a charged cell drifts at 0.2 to 1 R/s toward cells and clouds of the other
sign. Measured: no change in the culture's mean speed (4.3 to 4.5 px/s) or spread (28 to 29 R) at 60 to 240 s, with and
without, and nothing runs away.

**Do like charges keep apart?** Measured at 290 s (seed 3, MAX) with `moire.charge.cellStats()`: among the strongly
charged cells (|q| above 0.3, about 45 of 2000 at the defaults) the pairs within 2.5 R of each other, and how many of
those have the same sign, against random mixing of the signs: like repels like 50 % (random 49 %), like attracts like 61 %
(random 62 %): no ordering the eye or the numbers can find, the charged cells are too few and too packed in. With a
smaller `qHalf` (0.003: about 300 strongly charged cells) like repels like still gives 51 % (random 50 %), while like
attracts like gives 58 % (random 50 %): the same signs gather a little. With the charge field off (Shift+7), cells are
not neutralised by the cloud they gather, so there are more charged cells (143) and like charges sit together more
(68 %, random 56 %), as the breathers of one lineage are next to each other.

**Look.** The charge field is not drawn in the clean view. With the machinery (Shift+4), or on its own (Shift+0), phi is
drawn as thin crisp contour lines over the cells (the cells hold most of the charge, and their dark insides hid the lines
when they were drawn under them): **+ in a warm rose, - in an ice blue**, the colours of an electrostatic map (`charge` in
`src/palette.js`). The levels double, 0.01, 0.02, 0.04 ... 1.28 (`step`, `levels` 8; the zero level is left out, as most
of the dish sits there), so both the faint field of the default scene and a strongly separated cloud get a few lines.
Under the neon look they get the tight halo like every line; lines closer than about two pixels fade out instead of
filling the place. In the default scene there is little to see: a ragged rose line or two by the springs at the culture's
rim and a few small blue rings round charged cells; the test spring above shows the field clearly.

**The books.** A line in the entropy panel (on a phone a short one):

    CHARGE  free +212 −212 (net +0.088) · in cells −0.083 · cells + 142 · − 147 · |q| 0.05

(free charge in the dish, each sign and the net; the cells' net charge; cells net + and net - with |q| above 0.1; their
mean |q|). The F overlay adds the switches and knobs, cells neutral, the mean |net| in atom-units, phi's rms and its
largest size, and the charge's books: charge added by the springs = in the dish + in the cells + out (at the edge,
washed, dropped on a resize). The springs drip givers and takers with random rounding, so the dish's net charge wanders
a little (between -0.65 and +0.61 against 20 to 250 of each sign in a 660 s run); the books balance exactly (rounding 0),
as the atoms do.

**Switches** (group "Charge (step C6b)" in the rules panel; contours in the view panel's Look group): **Shift+7** charge
field (and the drift of free atoms) · **Shift+8** cells' charge from their stock (off: per fate) · **Shift+9** cells feel
the charge field · **Shift+0** charge contours. Shift + the digit keys, by their place on the keyboard, as in step C6n.
URL: `?charge=0`, `?qstock=0`, `?qfeel=0`, `?contours=1`, `?view=charge`.

**Knobs** (live in `moire.charge.params`): `lambda` (screening length, 3 R), `strength` (phi per unit of charge per R²,
80), `drift` (the free atoms' drift, x their spreading, 1), `sweeps` (3 per tick), `omega` (1.5), `cellsIn` (the cells'
charge counts in the field, true), `qHalf` (0.01), `qB` (1), `bSign` (1), `feelGain` (20), `feelSat` (1 R/s); drawing:
`step` (0.01), `levels` (8), `lineW` (1.1 CSS px), `alpha` (0.85). Tuning aids: `await moire.charge.probe(x, y)` (phi's
and rho's range; with a centre, each charged atom's amount and rms distance from it) and `await moire.charge.cellStats()`
(the cells' net charges).

**How it is computed.** Two more blocks of the heat buffer, behind the cells' pigments: phi (f32 bits, kept from tick to
tick) and the cells' net charge put down this tick (cleared after each tick, like the pigments). Each tick, inside the
heat's pass, after the substances spread and react, three red-black over-relaxation sweeps (`relax` in `matter.wgsl`; two
dispatches each, the even and the odd pixels, so each half reads only the other) update phi in place from last tick's: the
charges move little in one tick, so phi follows them closely. The drift is part of the spreading (`spread`): across each
edge a charged substance moves k × (the difference + z × drift × the potential's difference × the amount on the upwind
side), capped at 0.2 of the pixel it leaves and, as before, at a quarter of the giver, rounded at random and worked out
the same way from both sides, so the counts stay exact. The eat pass (`cell_eat.wgsl`) sums each cell's stock into
`Cell.qNet` and `Cell.q`, puts the net charge down over the 4 pixels around the cell (cloud in cell), and its plan reads
phi at the membrane's corners into `Cell.efield`; the step adds the push. The Cell record grew from 88 to 104 bytes (q,
qNet, efield). The ledger grew to 19 712 words (the cells' charge census, phi's spread, its largest size). One lesson: in
the matter's count pass a loop that tested a boolean `let` (true) skipped its body on Direct3D in Chrome; the loop now
tests the uniform itself.

**Cost** (headless Chrome on this machine, seed 3, MAX, the commit before C6b alternating with this one in one session):
2000 cells, ×12.4 and ×13.3 before, ×13.2 and ×13.4 now; with the charge field off (Shift+7) ×16.2, faster than before
because field B now skips the many neutral cells, so the field itself costs about 18 % of the fastest speed. 10 000 cells:
×3.8 before, ×3.7 now, ×4.8 with the field off.

**Checked.** A 660 s run at MAX (seed 5) through N (120 s), Shift+C (220 s), a window resize (300 s), G (400 s), a resize
back (480 s) and two new springs (520 s): energy rounding between -0.0016 and +0.12 while in grew to 9.2 M (as in C6),
atoms rounding exactly 0 throughout; the charge's books balanced to exactly 0 in a 260 s run through N, a wash and a
resize. No WebGPU errors in Chrome (headless), Firefox (headed, 1600 x 1000) and Chrome at phone size (390 x 844); the
rules panel shows the new group, and Shift+7 to Shift+0 and U switch as described.

## Step C6c: elastic honeycomb cells

The user, 2026-11-15: "I want them to cluster in honeycomb shape and deform elastically." This is the first half of
C6c, the shape and its drawing; the membrane's chemistry (integrity, bites, repair, bursting, material genes) is the
second half, in its own section, "Step C6c: membrane chemistry", below.

**What it looks like.** A lone cell is a soft hexagon with rounded corners, nearly round. Where cells touch, the sides
facing each other press flat into one **shared straight wall**, so a packed tissue reads as a neon **honeycomb**, or
rather a foam: most cells have 5 to 7 sides, and patches of one fate look like stained glass. Two neighbours' tubes run
side by side along their wall with a thin dark gap between them, like two real neon tubes (on a phone or a zoom; at one
device pixel per CSS pixel they merge into one lit wall). At the culture's rim the free sides stay round and bulge a
little outward (a cell pressed flat on some sides makes up the area on the others). Cells are **elastic**: stir the
dish and the cells you hit squash on the side they were pushed (to about two thirds of their radius), spring back within
half a second, overshoot a little and settle; in a jostling tissue the walls keep breathing by about a tenth. A small
newborn squeezed between big neighbours gets a small, often three- or four-sided tile until it has grown. At 10 000 cells
the loop's rosettes show as pinwheels of kite-shaped cells (`?cells=10000&bio=0&excl=0&seed=3&change=1&side=1&partner=1`,
zoom in).

**How the shape works** (all in the step pass, `cell_step.wgsl`, "honeycomb"):
- The outline is **6 corners**: corner k at distance `rad[k]` from the centre, in the direction theta + k × 60 degrees +
  `alpha[k]`. Side k runs from corner k to corner k + 1; these are the same 6 membrane segments the sensing always used
  (`membrane()` in `cell_common.wgsl` now returns the real corners).
- **Rest shape:** the hexagon whose corners lie on the ellipse of the cell's active stretch (`ea`: the old target's
  active part: along its motion, toward the field's pull, muscle along its heading; it follows its target at `shapeRate`
  as the ellipse did), scaled to the rest area pi r² (the ellipse cell's area).
- **Walls:** for every neighbour closer than 1.4 × the sum of the radii, the wall is the line where the two cells'
  power distances |x - p|² - r² are equal: the midline between the centres, shifted toward the smaller cell. Both cells
  find the same line, so they share it. No corner may pass it (the polygon stays inside the half-plane exactly when its
  corners do), which is why the state is corner distances rather than side distances. Along each corner's direction the
  nearest wall is the edge of the cell's tile in the power diagram.
- **Targets:** a corner whose wall is nearer than its rest place goes to the wall (contact presses the side flat); a
  wall a little further (up to `snap` = 1.5 × the rest place) still draws the corner out to it, less the further it is,
  so touching cells close the gap and share the wall, as cells in a tissue do; beyond that the corner is free. The free
  corners scale together (down to 0.75, up to `bulge` = 1.5) until the area is the rest area again.
- **Elastic:** each corner is an **underdamped spring** toward its target, 1.6 Hz at stiffness 1, damping ratio 0.35
  (a push swings back about once and has settled after about 0.8 s); a wall stops a corner at once (it can only move back
  in). **Jelly:** the corners lag the centre's change of velocity (drag and forces, not the heat kicks; `jelly` 0.3), so
  a cell that is shoved squashes and wobbles.
- **Sliding corners:** with the corners fixed at 60 degrees apart, a cell with 5 or 7 neighbours can only touch its walls
  at points, and the first version looked like separate hexagon tiles with gaps between them. So each corner slides round
  (at most 24 degrees) toward the corner of its tile: up the slope of the wall's distance along its direction (the walls
  weighted by (distance / r)^-12, a soft minimum, so a corner settles at a tile corner instead of chattering), back toward
  its regular place when no wall is near, and neighbouring corners keep an even spacing, so two corners do not crowd into
  one tile corner (a five-sided tile reads as a pentagon, not a triangle). The mean slide goes into theta.
- **Turning:** the hexagon turns so a side faces each touching neighbour (a pull of sin 6 delta per neighbour, delta its
  angle from the nearest side's middle; `turn` 40, damped by `turnDamp` 8).
- The corners are kept convex and within 0.3 to 2.2 r.

**What the shape changes in the rest of the simulation.**
- **Sensing** follows the real outline: the field integral on the 6 sides, the quadrupole (the field's pull on the
  outline, which drives the active stretch), the eat pass's smell and its charge-field gradient at the corners. The
  field force is scaled by the rest area (2.6 r² / pi r²), so a lone cell feels the same push as the ellipse cell did.
- **The stretch** e1, e2 is worked out from the outline: its second moment of area about the centre, normalised to
  determinant 1, is exp(2 e). So the strained lattice (k = F^-1 k0), the field the cell emits, the leak of step 6 and
  the census's stretch histogram all follow the real shape. A cell in the middle of a honeycomb is nearly unstretched
  (the old passive squeeze along each contact is replaced by the flat walls); a rim cell is stretched along its free side.
- **Not the motion:** the shape is **kinematic**. It never pushes a cell: the contact push keeps the centres apart as
  before (unchanged; a tissue's centres still sit at about 0.91 of the sum of the radii), and the walls only decide
  where each outline ends, so outlines never overlap although the cells' circles do. Nothing in the shape takes energy
  from or gives energy to the motion, so it is outside the energy books, which balance as before.

**The switches and knobs.** Rules panel, group "Cell shape (step C6c)": **honeycomb shapes** (on; off = the stretched
ellipse cells of steps 4 to C6b, for comparison; switching back on rebuilds every outline from its ellipse) and
**stiffness** (- / +, × 1.4 a step; the wobble's frequency goes with its square root). View panel, look: **corner
rounding** (0.3 of the radius; 0 = sharp hexagons, 0.6 nearly round; the walls stay straight). There are no keys left, so
these are panel only; `?honeycomb=0` starts with the ellipse cells. Console: `moire.cells.shape` (on, stiffness,
wobbleHz, zeta, size, bulge, snap, turn, turnDamp, jelly), `moire.cells.look.corner` and `.wallGap` (each tube 0.45 px
inside its wall, at most 0.08 r); the sliding's rates are constants in `cell_step.wgsl` (HEX_SLIDE_RATE 8, HEX_SLIDE_BACK
1.5, HEX_SPACE 3; HEX_SLIDE, 24 degrees, in `cell_common.wgsl`). `moire.cells.shapeStats()` measures the shapes (below).

**How it is drawn** (`cell_draw.wgsl`). A honeycomb cell is drawn on a square around its farthest corner. The vertex
shader works out the 6 sides as lines (outward normal, distance from the centre) and hands them on; the fragment shader
measures how far inside each line a pixel is and takes, over the corners, the "round intersection" of the corner's two
sides (straight where the sides are, rounded within rc of both). That never folds over on itself, however short a side,
and keeps shared walls straight. The tube, the inner glow, the tint and the anti-aliasing use that distance; the inside
(battery core, engine lamps, lattice dots, marks) is drawn in the cell's stretched frame as before (interpolated from the
vertices). A first try that shrank the hexagon by rc and measured the distance to it folded over on short sides (cells
drawn with a second ring inside).

**Per-side state** (for the membrane chemistry and step C6d). Side k = the side from corner k to corner k + 1 = the
membrane's segment k (`membrane(c).mid[k]`, `.edge[k]`, its outward normal (edge.y, -edge.x)). The Cell record
(`cell_common.wgsl`, `CELL_FLOATS` in `src/cells.js` and `heat.wgsl`) grew from 104 to 240 bytes; the new words:
26-31 `rad[6]`, 32-37 `radV[6]` (the corners' speeds), 38 `theta`, 39 `spin`, 40-41 `ea`, 42-47 `alpha[6]`, and
**48-53 `integ[6]`** (each side's integrity, since the membrane chemistry below) and **54-59 `sideQ[6]`** (each side's
charge, since step C6d: see "Step C6d: charge per side"); step C7 added 60-62 `nbr` (the touching neighbour across each side,
16 bits each) and 63 `volt` (the membrane voltage): 256 bytes. The
step pass reads each cell whole from its own slot and writes it back whole, so whatever another pass writes there (as the
eat pass writes `smell` and `efield`) survives; a newborn starts with zeros (the membrane chemistry gives it a share of its parent's sides),
and with the honeycomb off the sides are the ellipse's 6 segments. The step's neighbours come from the grid's sorted
copy, now a lean `CellCore` (the first 104 bytes, `cell_core()`), so the neighbour loop reads no more memory than before;
a rule that needs a NEIGHBOUR's per-side state (dipoles, C6d) has to add it to CellCore or read `cells` by index (step C6d
added the dipole, 2 floats: 112 bytes).

**Numbers** (headless Chrome on this machine, 2000 cells, seed 3, default scene, MAX, at 30 s; `shapeStats()` over pairs
of cells whose power-diagram tiles share a wall, the gap between their outlines along the line between the centres, in
units of R):
- honeycomb: gap 0.025 / 0.083 / 0.23 R (10th / 50th / 90th percentile), outlines meeting within 0.05 R 27 %,
  overlapping by more than 0.05 R 0.1 %; corners at 0.92 / 1.06 / 1.26 r. With the cells held still (no crawling,
  drift, kicks or field forces, 20 s): gap 0.003 / 0.054 / 0.23 R, 47 % meeting, so the gaps left in a live culture are
  mostly the corners following moving walls;
- ellipse cells: gap -0.55 / -0.21 / +0.23 R: 69 % of neighbouring pairs overlap visibly;
- a stirred cell (121 px/s): its corners went to 0.63 to 0.8 r on the side it was pushed, back at 0.45 s, 5 to 10 %
  over, then settled into the tissue's breathing (about ± 0.1 r) within about 0.6 s;
- the loop alone (`?bio=0`, 60 s): a packed drop in both shapes (spread 30.2 R honeycomb, 29.4 R ellipses), the
  honeycomb showing grain lines like a polycrystal; step 8's curling culture at 10 000 cells (60 s): local swirl
  2.3 deg/s (ellipses 2.6), 194 of 1000 bins turning faster than 3 deg/s (227), and a more fingered rim.

**Cost.** Same session, alternating: 2000 cells MAX ×12.0 to ×12.4 (the commit before C6c: ×12.9 to ×13.0), the
physics probe about 0.5 ms per tick in both; 10 000 cells ×2.75 to ×3.14 against ×2.33 to ×3.43 with the ellipse
cells (the speed reached varies by about 20 % between runs here), drawing 1.33 against 0.95 ms per frame (the squares
are larger and each pixel measures six lines). Firefox (headed, 1600 x 1000, 2000 cells): ×7.2 against ×7.7, physics
1.13 against 0.80 ms per tick. Two lessons: the bigger Cell made the neighbour loop about a third slower until the sorted
copy went back to 104 bytes (CellCore); and Firefox's compiler was slow with the corners' arrays indexed inside the
neighbour loop (1.59 ms) until the six corners were worked on at once in vectors.

**Checked.** A 320 s run at MAX: energy rounding +0.026 in 4.45 M in, atoms and charge rounding exactly 0. Switching the
honeycomb off and on at runtime (every outline rebuilt, overlaps 66 % with the ellipses, 0.1 % again with the
honeycomb), the stiffness knob, no WebGPU errors in Chrome (headless, also at phone size 390 x 844) and Firefox
(headed). Not bit-repeatable (the GPU's neighbour order varies), so the comparisons above are statistics of one run each.

## Step C6c: membrane chemistry

The user, 2026-11-15: "Are they able to excrete? Can that be harmful to some? Maybe we need their membrane reacting with
chemicals, not only through heat. Also the level of elasticity could be genetic." This is the second half of C6c: the
membrane becomes a **material** that the chemistry can attack, and its stiffness becomes a gene. No rule names a toxin:
what harms a membrane follows from the periodic table (rows, groups, sparks).

**What it looks like** (clean view, default scene). The tubes now show the membranes' state. A cell that has woven a
full membrane has the bright tube of before; a side with little or no material is dimmer and a quarter thinner, so the
starving cells in the dark part of the culture, which never get linkers, have fainter, thinner outlines (they were
already dimmed for their empty batteries; the culture as a whole looks much as before). Where a membrane that had been
whole is being eaten, that side's tube **breaks into short dashes**, the gaps growing as it empties, and flickers
gently: in the default scene this shows on a few dozen to a hundred cells at a time, at the culture's rim by the springs
and in the spot, where the free light atoms are. A cell with a **heavy** membrane (mostly L) has a second, fainter tube
just inside the first (a double wall); a thick membrane's tube is a little wider. A cell that **bursts** flashes white
for a fifth of a second with its tube broken all round and its battery core gone; a small puff of dust (its fuel and
atoms) marks the place, and a neighbour's daughter appears in its slot. Soft cells (light, thin membranes, or damaged
sides) wobble slower and squash further when stirred; stiff ones (heavy, thick) hardly do.

**The material.** Each side of a cell's membrane (the six sides of the honeycomb outline) holds light linkers **l** and
heavy linkers **L**, woven from the cell's own stock. Two genes say what the cell wants (`Bio.memb`):
- **MIX**: the heavy linkers' share of the weave (0 = all light, 1 = all heavy);
- **THICKNESS**: linker per R of membrane (atom-units). A side wants thickness × its rest length (1.1 r, the side of
  the hexagon of area pi r²) of linker, in the mix.

A side's **integrity** is what it holds over what it wants (0 to 1). The weave holds its linkers at the free linkers'
energy (0 on the energy table), so weaving and biting change no stored energy; only the sparks move energy (below).
Linkers, until now mostly waste and crust, are a real need: the cells take l and L in through the membrane like any
atom and weave them in.

**Bites** (the derived rule). A free **reactive** atom (a giver or a taker) just outside a side bites the chains of **its
own row**: g and t bite the l part of the weave, G and T the L part. Per s, in linker units: kBite × (its concentration
in the pixel just outside the side's middle, per R²) × the side's length (R) × that row's share of the side's weave (the
other row's chains shield it) × exp(−the chain's spark / (theta × the temperature)). The sparks are the table's: the
light chain's 0.25, the heavy chain's 0.5, so a heavy weave is much harder to bite (exp(−8/T) against exp(−16/T): at a
temperature of 8 per R², 0.37 against 0.14), and everything bites faster where it is hot. **The biting atom stays
free**: it only breaks the weave (a catalyst of the membrane's breakdown), and the bitten linkers go free into the dish
under the cell (where the cell can take them back in). Chosen because it conserves cleanly: the table has no
giver-linker or taker-linker substance to bind into, and an atom held by the membrane would make it charged (that is
step C6d). Bites are counted per side, rounded at random, never more than the side holds.

**Repair.** Every tick each side short of what it wants weaves linkers in from the stock, `repK` (1.5) of its shortfall
per s, in the genes' mix, as far as the stock holds l and L; each linker woven pays **its chain's spark** from the
battery (0.25 energy per unit of l, 0.5 per unit of L), which becomes heat at the cell. A cell with an empty battery
cannot repair. A side holding more than `shedAt` (1.25) × what it wants (the genes changed, or a newborn got a large
share) lets the extra back into the stock. Repair runs right after the membrane's exchange, before the engines and the
reactions inside, so the cell's own sediment making does not take the linkers first.

**Consequences.**
- **Leaky:** the membrane's exchange runs × (1 + leakK × (1 − mean integrity)), leakK 2 (each side's share of the
  perimeter at its own leakiness: the mean), at most × 4.
- **Holds less:** a stock needs a closed membrane to hold it: the stock's capacity × (hold + (1 − hold) × mean
  integrity), hold 0.3. (Added after the first runs: without it an unbuilt membrane only leaked, and leaking also
  feeds a cell faster, so never building a membrane was the cheapest strategy.)
- **Softer:** each honeycomb corner's spring × (soft + (1 − soft) × the mean integrity of its two sides), soft 0.35.
- **Bursting:** a membrane that has been **whole** (mean integrity 0.5 or more since the cell was born, or its parent's
  had been) and is bitten while its mean integrity is below `burstAt` (0.15) **bursts**: in that tick the cell spills its
  whole stock (into the dish under it, as at a death), its membrane (as free linkers) and its battery (as heat), and
  becomes an empty **husk** for BURST_TICKS (12 ticks, 0.2 s: the flash); then a touching neighbour divides into its slot
  as at any death. Bursting needs turnover (T), as heat damage does; with turnover off a husk is an ordinary empty cell
  again. A membrane that was never built cannot burst (there is nothing to burst): it leaks and holds little instead.
  The "whole" mark is inherited because a daughter gets real sides from its parent; without that, every daughter of a
  damaged parent was safe until it had rebuilt.
- **Birth:** a newborn takes a share r / (r + r_parent) of each side of its parent's membrane (0.375 at its starting
  size, 0.6 of the parent's radius), so both have about the parent's integrity afterwards; deaths and a new culture (N,
  G) hand the membranes back to the dish as free linkers.

**Genetic elasticity.** The honeycomb's stiffness (the corner springs of the first half) is each cell's own:
(0.7 + mix) / 0.8 × sqrt(thickness / 0.012) × the **stiffness gene**, between 0.25 and 4 (1 for the founders' usual
light thin membrane). The corners' omega² is multiplied by it and their damping by its square root, so every cell keeps
the damping ratio and a soft cell wobbles slower and further. With the rule off every cell has the shape panel's
stiffness (damaged sides are still softer while the membrane chemistry is on).

**Ion selectivity** (Claude's addition, so that charge separation can emerge for C6b and C6d). A gene s, −1 to 1:
givers (+) pass the membrane × (1 + s), takers (−) × (1 − s) (the passive exchange only; the reactions are unchanged).
A cell with s > 0 trades its givers faster than its takers, so where they arrive or leave unevenly its stock's net
charge shifts.

**Founders and mutation.** Founders (`MEMB_THIN` = 0.012 in `src/genome.js`): mostly light and thin (mix 0 to 0.15,
thickness 0.7 to 1.4 × 0.012); three of the default twelve (founders 3, 7, 11: one pigment-heavy, one burner, one
"other") heavy and thicker (mix 0.55 to 0.9, thickness 1.5 to 3 × 0.012); the stiffness gene 0.8 to 1.25; the
selectivity −0.08 to 0.08. The membrane genes come from their own random stream, so a seed's founders keep all their
other genes. At each birth: mix + 0.03 g, thickness × e^(0.08 g), stiffness × e^(0.05 g), selectivity + 0.03 g (g a
standard normal draw; kept within 0..1, 0.002..0.2, 0.3..3, −1..1).

**What happened in the default scene** (2000 cells, MAX, Chrome headless on this machine, seeds 3 and 7, 20 minutes
each; seed 7 also with `?membrane=0` as a control; `moire.membrane.stats()` sampled every minute; "fed" = battery at
least 0.3). Plainly:
- **Linkers are scarce, and the heavy ones are locked in crusts.** The springs drip l and L at 2 per s each for 240 s;
  by 4 minutes about 430 units of each lie in sediment (ll 210, LL 225) and only 25 to 40 units of free l and 6 to 10
  of free L are left. The founders' thin membrane wants about 0.1 units per cell, 200 for the culture, so most cells
  (the starving ones in the dark) never build one: the mean integrity over all cells is 0.04 at 1 minute and 0.16 to
  0.20 at 20 minutes. The fed cells do: their mean integrity is 0.6 (seed 3) and 0.5 (seed 7), 60 to 75 % of them have
  had a whole membrane. Heavy membranes almost never fill: there was never more than 6.5 units of L in all membranes
  together (against 22 to 55 of l), because free L chains into crust as fast as it comes (it spreads slowly, so it sits
  dense around its spring and forms LL there). The cells' demand barely touches the crusts: at 20 minutes ll 184 to
  198 with membranes, 213 in the control at 12.5 minutes (the membranes hold 20 to 55 units of l).
- **Bites happen where the free light atoms are**: at the rim by the springs and in the spot. 0.2 to 3 units of l
  bitten out per s (the membranes hold 15 to 55), repaired about as fast; the sparks cost the batteries 0.3 to 1 energy
  per s in all (the burners put 20 to 30 per s into them). Damaged membranes (whole once, below half now): 60 to 120
  cells at a time. **Bursts**: 1474 (seed 3) and 1758 (seed 7) in 20 minutes, 0 to 5 per s, about 1.2 to 1.5 per s on
  average, against about 50 deaths per s from turnover: a few % of the deaths (only a membrane that has been whole can burst, and those are mostly the fed cells', on the
  springs' side; the screenshot of a burst caught one there).
- **Do heavy-membrane lineages rise near the vandals? Not that the numbers show.** The heavy share drifts with the
  lineages it rides on: seed 3 heavy 26 % → 34 % (5 min) → 28 % (20 min), among the fed cells 12 % → 7 %; seed 7 heavy
  25 % → 61 %, among the fed 21 % → 58 %; and the seed 7 control without any membrane chemistry went the same way
  (heavy 25 % → 54 %, fed 43 % at 12.5 minutes, against 51 % and 52 % with it). The founders' heavy membranes ride on
  their other genes (founders 3, 7 and 11), and since heavy membranes cannot be filled, a heavy gene mostly means an
  unbuilt membrane. Thickness drifted a little up (0.016 → 0.023 seed 3; 0.014 → 0.017 seed 7), selectivity spreads by
  mutation (mean |s| 0.03 → 0.12 to 0.13, about what drift alone gives over 15 generations).
- **Ion selectivity does show in the charges, mildly.** Among the cells with |s| above 0.2 that are charged (|q| above
  0.1), 65 to 68 % carry the sign their membrane favours at 20 minutes (seed 3: 107 of 158; seed 7: 100 of 155; the
  control without selectivity: 23 of 66, i.e. chance); the mean |q| of all cells was 0.13 to 0.18 with the membrane
  chemistry against 0.09 to 0.11 in the control, and 300 to 340 cells of each sign were charged (the control: 216 to
  265). No pattern of charged cells the eye picks out yet; that is for C6d.
- **Strategies** were as in step C6 (harvest + burn takes the light: seed 3 64 %, seed 7 80 % of all cells at 20
  minutes).
- **Linkers as a need, crusts and crackers**: no lineage took up the crack engines (ll → l + l) to free linkers in these
  runs; that would be the obvious answer to the scarcity and is left to watch for in longer runs.

**Checked** (the books): a 660 s run at MAX (seed 5) through N (120 s), a wash (Shift+C, 220 s), a window resize (300 s),
G (400 s), a resize back (480 s) and two new springs (520 s): atoms and charge rounding exactly 0 throughout, energy
rounding between −0.031 and +0.137 while in grew to 9.1 M (657 bursts in the run); the two 20-minute runs: atoms and
charge exactly 0, energy +0.20 at most (in 15 to 18 M; the control +0.06 to −0.09 in 11.5 M, the same size as in steps
C6 and C6b). Switching the master, bites, elasticity, selectivity and turnover off and on at runtime: the integrity reads
1 while the chemistry is off and rebuilds after, no bites with bites off, no bursts without turnover, books exact. No
WebGPU errors in Chrome (headless, also at phone size 390 × 844, where the panel shows the short line) and Firefox
(headed, 1600 × 1000). Not bit-repeatable, so every comparison above is one run each.

**Switches** (rules panel, group "Membrane chemistry (step C6c)"; panel only, as no keys are left): **membrane
chemistry** (the master: material, integrity, repair, leak, hold, softness; off: the membranes stay as they are and
every side is drawn and treated as whole) · **bites** · **bursting** (needs turnover) · **gene: elasticity** · **gene:
ion selectivity**. URL: `?membrane=0`, `?bites=0`, `?burst=0`, `?elastic=0`, `?selectivity=0`.

**Knobs** (live in `moire.membrane.params`): `kBite` (0.05), `repK` (1.5 per s), `sideLen` (1.1), `leakK` (2),
`leakMax` (4), `hold` (0.3), `burstAt` (0.15), `wholeAt` (0.5), `shedAt` (1.25), `shedK` (1 per s), `tRef` (0.012: the
thickness of stiffness 1), `soft` (0.35); the look in `moire.cells.look`: `membLook`, `membDim` (0.35), `membBreak`
(0.5: below this a damaged side breaks into dashes), `membFlicker` (0.3), `membInner` (0.45: the heavy membrane's inner
tube), `membWide` (0.3), `membFlash` (1.5); `BURST_TICKS` (12) in `cell_common.wgsl`. `await moire.membrane.stats()`
compares the fed cells (battery at least 0.3) with the rest and lists how the charge goes with the selectivity.

**The census.** A MEMBRANE line in the entropy panel:

    MEMBRANE  mix 0.34 (heavy 28%) · thickness 0.023 · integrity 0.19 (whole 26%, damaged 121) · bursts 0.50/s · in membranes l 51.6 L 5.04 · bitten l 0.15 L 0.01/s · |selectivity| 0.12

(mean mix and the share of heavy membranes, mean thickness, mean integrity, cells whose membrane has been whole and how
many of those are below half now, bursts per s, linkers in membranes, linkers bitten out per s, mean |selectivity|; on a
phone `MEMBRANE mix 0.34 · intact 0.19 · bursts 0.50/s · |sel| 0.12`). The F overlay adds the switches and knobs, the
heavy and light membranes' mean integrity, the material stiffness, the linkers woven and shed per s and the sparks paid,
the cells with a clear selectivity and how many of them are charged, and the census every 10 s. It is counted on the GPU
in the ledger pass (a snapshot) and the eat pass (counters), 32 numbers × 16 slots behind the charge's part of the ledger
(LEDGER_WORDS grew to 20 224).

**The books.** The membranes' linkers count with the cells' l and L in the atoms' ledger ("in cells"), so the atoms stay
exact: bites move linkers from a membrane into the dish, repair from the stock into a membrane, bursts and deaths from
membranes into the dish (or "gone", as a dead cell's stock, if their channel is not moving that frame), all in whole
counts. Charge: linkers carry none. Energy: the weave is at the free linkers' energy (0), the repair sparks go from the
batteries to heat, a burst's battery becomes heat as at a death.

**How it is computed.** All in the eat pass (`cell_eat.wgsl`), which owns the stock (the cell step is at the
storage-buffer limit): the stock grew from 16 to 32 words per cell (16..21 the l per side, 22..27 the L per side).
*plan* (plain reads) works out each side's integrity, the leak, the hold and the selectivity for the exchange, and the
bites (it reads the dish just outside each side and writes the bitten counts into the membrane's words and into flux
words 13 and 14); *eat* puts the bitten linkers into the dish, repairs, writes `Cell.integ`, the WHOLE mark (Cell.flags
bit 18) and bursts (flags bits 4..7 count the husk's ticks); *split* gives the newborn its share; *dump* and *reset* hand
membranes back; *ledger* counts them. The step (`cell_step.wgsl`) reads the stiffness gene and `integ` for the corners,
counts a husk's ticks and gives its slot away. The drawing reads `integ`, the flags and the genes (`memb_side` finds the
side a pixel's tube belongs to: the nearest side's line, or the side's 60 degrees on an ellipse cell). Struct Fields
grew to 288 bytes (`memb`), the eat uniform to 1376 (`mb0`..`mb4`), the draw uniform to 480, the genome to 44 floats.

**Cost** (Chrome headless, 2000 cells, seed 3, MAX, alternating runs in one session, mean speed reached from 40 to
150 s): the commit before (c8e8a95) ×11.97 and ×11.96, now ×11.33 and ×11.52 (about 4 % slower), now with
`?membrane=0` ×11.56 and ×11.62 (the larger stock and the side loops cost about 3 % even when off). Firefox (headed,
1600 × 1000): ×7.6 (the honeycomb's first half: ×7.2).

## Step C6d: charge per side (dipoles)

The idea (CLAUDE.md, C6d): each of the six sides of a cell holds its own charge, so a cell that takes charged atoms in
through one side gets charged there; an outside field pulls the + end and the - end opposite ways, so cells turn, line
up and stretch along the field, which strains their lattice and changes their field again (a form ↔ field loop, like
step 8's curls). Expected: chains, head-to-tail threads, alternating stripes.

**What it looks like.** In the clean view (default) a polarised cell's tube is tinted toward rose on its + side and
toward ice blue on its - side (the colours of the charge contours), its white-hot centre line unchanged; at a zoom a
thread reads as tubes going rose, blue, rose, blue along it. It is subtle on purpose and shows only where cells are
polarised (below). **Colour by charge** (V, the fourth view; `?view=charge`) makes it plain: a polarised cell is drawn
in two halves split across its dipole, rose toward its + end and blue toward its - end, with a crisp edge, so the
polarised part of the culture becomes a mosaic of rose-and-blue cells whose halves meet head to tail along short
curving lines; unpolarised cells stay grey. With **the machinery** (Shift+4) each polarised cell carries a small arrow
from its - end to its + end (the shaft blue to rose, its length with the dipole's strength). Honestly, to the eye: the
arrows form short runs of 3 to 6 cells head to tail, curved rather than straight, and the runs next to each other often
point the other way (rose beside blue), which is what dipoles do when they cannot all point one way in a packed tissue.
It reads as a fine, mixed mosaic of short strokes, not as long threads. With the interactions off, cells in one gradient
all point the same way (in the spot: every cell rose on one side, blue on the other), which looks MORE ordered to the eye
but is not head to tail; the numbers below tell the two apart.

In the default scene the polarised cells are where the free charged atoms are: at first the spot and the springs' side
of the culture (about a fifth of the cells at 2 minutes), then, as atoms pile up in the dish, more and more of it (three
quarters at 10 minutes). The starving cells in the dark hold almost no charged atoms and stay unpolarised: a side cannot
hold charge the cell does not have. Around an ion test spring (light givers + heavy takers, the C6b test) nearly every
cell nearby is polarised; there the culture loosens into a lace with dark gaps (the side-by-side push), and in the
charge view the rose-and-blue cells swirl round the spring.

**Where the side charges come from** (`cell_eat.wgsl`, plan and eat). `Cell.sideQ[k]` is side k's share of the cell's net
charge (atom-units; the Cell's reserved words 54..59). Its sum is the stock's net charge, always: every tick the eat pass
puts the six shares back on the new net charge, keeping each side's difference from the even share (qNet / 6). So the side
charges are a distribution of charge the stock already holds, never new charge, and a neutral cell can be polarised (+ on
one side, - on the other).
- **Through-flow:** for each charged atom (g, G +1; t, T -1) the plan works out the exchange as if each side traded with
  the dish just outside it (the concentration there, bilinear, against the cell's), less the cell's mean exchange. That
  part only says WHERE the charge came in or went out; z × it goes onto each side. The cell's real exchange (what moves
  between the dish and the stock) is unchanged, so the books are untouched. A side facing more givers than the cell's
  other sides takes + in there; the side facing fewer lets + out. So a cell sitting in a gradient of free charged atoms
  is polarised along it, as far as its + and - flows do not cancel: they cancel exactly in a neutral cloud of atoms that
  pass the membrane alike, and do not where the ion selectivity gene (step C6c) favours one sign, or where a light atom
  (fast through the membrane) meets a heavy one of the other sign (slow), as at the ion test spring.
- **Evening out:** the differences relax toward an even spread at `relax` (0.2 per s: a dipole lasts about 5 s);
- **Cap:** a side's difference from the even share stays within `cap` (3) × the cell's mobile charge (its free givers
  and takers) / 6.

**The dipole.** p = Σ sideQ[k] × (side k's middle − centre) / r (atom-units; per radius, so size does not matter),
saturating: d = p / |p| × tanh(|p| / pHalf), length 0 to 1 (pHalf 0.002). The grid's lean neighbour copy (`CellCore`)
carries d (2 floats, 104 → 112 bytes), worked out once per tick when the grid is built; the six side charges stay in the
cell's own record.

**The field on a dipole** (`cell_step.wgsl`). Two sources: the **neighbours' dipoles**, each adding w (3 (d_j · n) n −
d_j) (n from the neighbour to the cell, w = (contact distance / distance)³, tapered to 0 at `range`, 1.4 × the contact
distance), and the **substrate's charge field** (step C6b), −grad phi across the membrane (the eat pass's six corners),
saturating at `phiHalf` (0.02 phi per R), weight `phiW` (1). In the default scene phi is weak (rms about 0.001), so the
neighbours' dipoles do almost all of it; at the ion test spring phi has a real gradient. What the field does:
- **Turn:** the torque d × E (E saturated, length at most 1) turns the honeycomb (its sides carry the charges; `turn`
  60 rad/s² at full dipole and field, against the contacts' own turning, 40) and turns the charges **within** the cell
  (`inner`, 6 rad/s: the dipole pattern of the side charges rotates; in a packed tissue the hexagon is held by its
  neighbours, so this is how a packed cell lines up). The lattice angle (the cell's key, its identity) is never turned.
- **Polarise:** the field pulls the cell's mobile charge apart along it (a dipole of `polar` × pHalf in a full field
  against the evening out, polar 0.2), so a polarised cell polarises the cells ahead of it and behind it a little.
  Bounded by the cap: it only moves charge the cell holds, so it does nothing in empty cells.
- **Push:** two dipoles attract head to tail and repel side by side (the force between two point dipoles, with the same
  short-range kernel / distance; `push` 0.6 R/s per unit, saturating at `pushSat` 1 R/s). A force like the others: its
  work is booked with theirs.
- **Stretch (the loop):** the stretch target gets `stretch` (0.3) × the traceless part of E ⊗ d: a dipole along the field
  pulls the cell out along it, one across it shears it. The stretched cell's lattice is strained (k = F⁻¹ k0), which
  changes the moiré fields it emits and feels (field A, field B, the leak of step 6): form → field → form.
- **Into phi at the sides:** with the charge field on, a cell puts its charge into rho at its six sides' middles (the
  last side taking the remainder, so exactly its net charge) instead of at its centre, so a polarised cell's dipole is
  in the substrate's field too (`deposit`).

**Numbers.** Measured with `moire.dipole.stats()` (the cells read back): pairs of touching cells both polarised (|d|
above 0.2); **aligned** = the mean cos of the angle between their dipoles; **head-to-tail index** = the mean of (d̂_i ·
n)(d̂_j · n) − ½ d̂_i · d̂_j, which is 0 for random dipoles and also for any uniform alignment (all pointing one way), and
positive when partners sit along their dipoles' axis (head to tail) or side by side pointing opposite ways; a **bond** =
(d̂_i · n)(d̂_j · n) and d̂_i · d̂_j both above 0.5, **threads** = connected runs of 3 or more bonded cells. The control
("chance") is the same cells with the polarised cells' dipoles shuffled among them. Default scene, 2000 cells, MAX,
headless Chrome; "off" = dipole-dipole and the field's turning off (`?dd=0&dfield=0`: the dipoles still form from the
through-flow, but nothing acts on them):

| 10 minutes | polarised (2 / 5 / 10 min) | aligned | head-to-tail index | threads (chance) | cells in threads (chance) | longest (chance) |
|---|---|---|---|---|---|---|
| seed 3, on | 22 % / 45 % / 75 % | −0.03 to 0.00 | **+0.22 to +0.23** | 168 (128) | 1053 (555) | 41 (15) |
| seed 3, off | 21 % / 45 % / 72 % | +0.16 to +0.26 | −0.01 to +0.01 | 144 (131) | 868 (563) | 31 (11) |
| seed 7, on | 22 % / 43 % / 72 % | −0.03 to +0.03 | **+0.21 to +0.23** | 153 (130) | 995 (605) | 36 (21) |
| seed 7, off | 23 % / 46 % / 73 % | +0.24 to +0.27 | +0.01 to +0.02 | 103 (119) | 878 (548) | 72 (20) |

(Ranges over 2, 5, 7.5 and 10 minutes; threads etc. at 10 minutes.) So: without the interactions, neighbours' dipoles
point roughly the same way (they sit in the same gradient: aligned +0.2) and the head-to-tail index is zero; with them
the index is +0.22 all along, the plain alignment goes to zero (the alternating, side-by-side-opposite arrangement), and
there are about twice as many cells in threads as by chance, the longest about 40 cells (off, the cells in threads come
from the plain alignment along a gradient: more than chance too, but the bonds run along the gradient, not head to tail
by choice). Shorter tests (2 minutes, seed
3, the knobs before tuning): field's turning off with the push on, index +0.03; dipole-dipole off, +0.03 to +0.05.
Ion test spring (`?springs=0&chem=0&light=off`, a g + T spring at the culture's middle, 2 minutes): polarised 38 to 40 %;
dipole-dipole off: aligned +0.45 (all pointing out from the spring), index −0.01; on: aligned +0.21 to +0.28, index
+0.17 to +0.19. The loop alone (`?bio=0`, 4 minutes): polarised 39 %; index +0.23 to +0.25 (off: +0.01 to +0.02), threads
90 (47 by chance; off 64, chance 79), cells in threads 471 (198).

Tuning: the default scene's charges were not too weak where there are atoms (most fed cells are polarised), but the
dark half of the culture never polarises, whatever the knobs. Knobs tried at 2 minutes (index): pHalf 0.004 → 0.002
(+0.12 → +0.14; a few more polarised), relax 0.5 → 0.2 (+0.17), inner 2 → 6 with turn 30 → 60 (+0.19), all three
(+0.23), plus push × 3 and stretch 0.45 (+0.21: no gain, and a looser culture), polar 0 to 0.4 (no measurable change:
the cells that could be polarised by their neighbours are mostly polarised already by the flow). The defaults are the
three together with polar 0.2: visible in the charge view and the machinery, subtle in the clean view.

**Switches** (rules panel, group "Charge per side (step C6d)"; panel only, as no keys are left): **dipoles** (the
master: off = every cell's charge spread evenly round it, as before) · **dipole-dipole** · **substrate field on the
sides** · **field turns and stretches cells** (the turning, the polarising and the stretch). Knobs with - and +:
**evening out** (relax), **dipole scale** (pHalf), **turning**, **dipole push**, **dipole range**, **stretch along the
field**. URL: `?dipoles=0`, `?dd=0`, `?dphi=0`, `?dfield=0`. Console: `moire.dipole.params` (also flow, cap, inner,
polar, pushSat, phiHalf, phiW, deposit), `moire.cells.look.dipTint` (0.6), `.dipArrow` (0.9), `.dipTwoTone` (0.85),
`await moire.dipole.stats()`.

**The census.** A DIPOLES line in the entropy panel:

    DIPOLES  |d| 0.18 · polarised 445 (22%) · neighbours aligned 0.04 · head-to-tail +0.20 · in threads 186 (ends 180) · along the field 0.90

(mean |d|; cells with |d| above 0.2; touching polarised pairs' alignment and head-to-tail index; cells with two or more
head-to-tail bonds, and with one; the mean cos between a polarised cell's dipole and the field it feels). On a phone
the short form. The F overlay adds the switches and knobs, the fields' mean sizes and the stretch, and the numbers every
10 s. It is counted on the GPU by the step on the frame's last tick (Stats.dip, 16 words; the pairs are also counted
while dipole-dipole is off, for comparison).

**The books.** The side charges are a distribution of the stock's net charge, so the atoms' and the charge's books are
unchanged. Checked in a 660 s run at MAX (seed 5) through N (120 s), a wash (Shift+C, 220 s), a resize to 1000 × 700
(300 s), G (400 s), a resize back (480 s) and two new springs (520 s): atoms and charge rounding exactly 0 throughout,
energy rounding between −0.031 and +0.075 while in grew to 8.7 M (as before). The push is a force like contact or field B: its work goes into the energy ledger with the other forces'.

**Decisions.** The torque turns the honeycomb's orientation (theta) and the charges within the cell, never the lattice
angle (the cell's key). With the honeycomb off (ellipse cells) the body cannot turn, only the charges within. The field on
the side charges is the neighbours' dipoles plus phi; field B and the partner A' (moiré fields) do not act on them (they
already move the cells, and through the stretch the dipoles change what B and A' see). Births: a newborn starts with an
even spread (no dipole); a burst cell's side charges go with its stock.

**How it is computed.** Plan (`cell_eat.wgsl`): per charged channel, the concentration just outside each side's middle
(bilinear, 4 reads × 6 sides) and the through-flow; the evening out, the cap. Eat: the sides back on the new net charge;
the deposit into rho at the sides. Grid scatter (`cell_grid.wgsl`): d into the lean copy. Step (`cell_step.wgsl`): own d
from its sides, the neighbours' field and push in the neighbour loop (with the census), torque, polarisation, stretch.
Draw (`cell_draw.wgsl`): d per cell in the vertex shader; the side's tint from `sideQ`. Fields grew to 320 bytes (dip0
.. dip2), Draw to 512 (dip, dip2), Stats to 8576 bytes (dip), CellCore to 112.

**Cost** (headless Chrome, 2000 cells, seed 3, MAX, mean speed from 40 to 150 s, alternating runs): the commit before
(98d3955) ×11.94 and ×11.92, now ×11.70 and ×11.64 (about 2 % slower), now with `?dipoles=0` ×11.97. Firefox (headed,
1600 × 1000): ×7.1 (step C6c: ×7.6).

**Checked.** No WebGPU errors in Chrome (headless, also at phone size 390 × 844, where the panel shows the short line)
and Firefox (headed, 1600 × 1000). The census counts with dipole-dipole off too (for the comparisons). Not bit-repeatable,
so every comparison above is one run each.

## Step C7: pumps and membrane voltage

The user (CLAUDE.md, C7): "active chemical excretion without forcing the behaviour". Every genome now carries two **pump
slots**. A pump slot is three genes: a **substance** (any that spreads: the six atoms, the four fuels, trace; never
sediment), a **direction** (IN or OUT) and a **rate**. Pumping a substance down its gradient is free (it only adds to the
membrane's passive leak); pumping it up its gradient costs the battery, more the steeper the gradient. No rule says what
to pump, which way, or why: "exporter", "thief", "sharer", "poisoner" are only words for watching what selection makes of
the pumps. Charged atoms (givers +1, takers -1) pumped across the membrane build a **membrane voltage**, which makes
pumping more of the same sign the same way dearer, and pays part of its energy back into the battery as it leaks: a
second battery.

**What it looks like.** In the clean view a cell with a pump carries small **notches** on its membrane, like the engines'
parts but on the tube: at the middle of every other side (slot 1 on three alternate sides of the outline, slot 2 on the three
between) a tiny triangle just inside the tube, in the substance's ink (the reactive free atoms' red, the fuels' green, the
linkers' grey-blue, trace silver; the heavier row deeper), pointing IN toward the centre or OUT with its tip on the tube,
its size with the rate; the tube's short segment there takes the same ink. At 2000 cells on a computer screen they read as
small coloured ticks round the rim of a cell; zoom in to see which way they point. Most cells have none (pumps have to earn
their place). A lineage that carries a pump shows as a patch of cells with the same ticks. With **the machinery** (Shift+4)
a cell with a membrane voltage also gets a faint rim just inside its tube, rose for + (it pumped givers in or takers out)
and blue for -, full at a voltage of 0.5.

**What happened** (the default scene, 2000 cells, MAX, Chrome headless on this machine; seeds 3 and 7, 20-minute runs with
the pumps on and with `?pumps=0`, 10-minute runs with other settings; `moire.pumps.stats()` sampled along the way; not
bit-repeatable, so every comparison is one run each, and repeats went different ways). Plainly:
- **Pumps neither die out nor take over.** At the start 17 to 34 % of the cells carry a pump (the founders' lineages that
  got one). Over 20 minutes the share rose to 32 to 36 % (seed 3) and 44 to 58 % (seed 7). Much of what the census lists is
  carried along by lineages that win for other reasons (their engines): with the pumps switched off the genes still drift
  and spread, and the controls show the same kind of list (seed 3 with the pumps off, 10 minutes: "OUT l" in 172 cells with
  batteries of 0.55, though nothing was pumped). So a gene only means something where it differs between on and off.
- **Exporters of light givers in the spot (seed 7).** The clearest case. A founder lineage carries "OUT g" (pumping out the
  light giver g). With the pumps on, in two of three seed-7 runs (one of them with the capacitance at 0.3), its carriers rose
  from about 190 to 270 to 340 cells, two thirds of them in the light, harvest + burn cells, with batteries of 0.33 to 0.49
  against 0.06 to 0.10 for the cells without a pump; in the third run they stayed at about 130 (battery 0.16). With the pumps
  off the same lineage stayed at 120 to 180 cells with batteries of 0.02 to 0.2, and with the pumps on but **not across
  contact** it shrank to 85 cells with empty batteries. So its advantage came through the contact sides: these cells push
  their light givers into their neighbours (everything pushed into neighbours: 2.9 to 4.6 units per s at 15 to 20 minutes,
  against 1.2 to 2.5 pulled), and keep less of the vandal g inside, which degrades rich fuel there. Nobody told them to; the
  neighbours get the g. It shows in the charges: at 20 minutes 534 cells were net negative and 377 net positive (the control:
  311 and 401), as exporting + leaves a cell -. In the clean view they are the cells in the spot with small red ticks round
  their rims (red: the reactive light atoms' ink), pointing out.
- **Fuel taken from neighbours.** Fuel pulled across contact into the pumping cell ran at 0.1 to 0.9 units per s at 10 to 20
  minutes in every run (fuel pushed out into neighbours: 0.02 to 0.3). The carriers of IN Gt and IN gT are mostly harvest +
  burn cells; their advantage is small and comes and goes (seed 7: IN Gt 77 to 206 carriers at batteries 0.12 to 0.30; the
  control 130 to 280 at 0.0 to 0.17).
- **Importers of the heavy taker (seed 7).** "IN T" (pulling in the heavy taker T) rose in two seed-7 runs with the pumps on
  (20 minutes: 88 carriers, battery 0.39 against 0.14 without a pump; 10 minutes without contact: 169 carriers, battery 0.63,
  three quarters in the light) and in no control. T is the scarce half of the heavier fuels (gT, GT); in the C6 runs the visible
  2 pigment died out for lack of it. Whether these cells make gT with it was not measured. In seed 3 IN T carriers were
  common too but unfed (batteries 0.0 to 0.1): riding along.
- **The voltage builds where charge is pumped one way.** With the default capacitance most cells' voltage is near zero
  (mean |V| 0.001 to 0.03); the exporters and importers of charged atoms reach 0.05 to 0.25, and 100 to 160 cells are above
  0.1 when they are common (seed 7). The battery then pays more for the voltage than for the gradients (seed 7 at 20 minutes:
  1.76 energy per s against 1.25, and 0.8 per s came back into the batteries as the voltage leaked). With a capacitance three
  times smaller (0.03) the voltage became the main cost and the light-giver exporters of seed 7 did not rise (215 carriers,
  battery 0.10); with 0.3 it never mattered (|V| 0.001).
- **Small in the books.** All pumping together cost the batteries 0.4 to 3.9 energy per s, against 20 to 30 per s the burners
  put in. The dish's entropy and its rate were 2 to 8 % higher with the pumps on, and slightly fewer cells were above half a
  battery (table).
- **What did not show.** No lineage of "excreters" of light atoms into the dish near the springs (the free sides put 0.07 to
  1.8 units per s into the dish, much of it the seed-7 exporters at the culture's rim); no change in the free light atoms (g at
  20 minutes 69 to 80 with the pumps, 65 to 77 without), so no "great oxidation" from pumping either; no clear change in heavy
  membranes or bursts (heavy membranes, a lineage marker, went either way); the dipoles' head-to-tail order stayed the same
  (+0.20 to +0.21).

Numbers at 20 minutes (the second run with the pumps on in brackets; it had the capacitance at 0.1 too, but the code before the
last fix to contact, and its seed-3 run showed the atoms' rounding at -2 counts from 900 s, the bug since fixed):

| | seed 3 on (repeat) | seed 3 off | seed 7 on (repeat) | seed 7 off |
|---|---|---|---|---|
| cells with an active pump | 32 % (36 %) | (genes only) | 58 % (44 %) | (genes only) |
| top pump genes (share of all cells) | OUT l 7, OUT T 6, IN T 3 % | - | OUT g 13, IN Gt 10, OUT l 7 % (OUT g 7, IN gT 5, IN T 4 %) | - |
| mean battery: a rising gene's carriers / cells without a pump | OUT l 0.62 / 0.24 (OUT l 0.11 / 0.29) | OUT gT 0.54 / 0.30 | OUT g 0.38 / 0.10 (IN T 0.39 / 0.14) | OUT g 0.02 / 0.28 |
| battery paid for pumping (energy / s) | 0.56 (0.39) | 0 | 3.85 (1.05) | 0 |
| moved into the dish / from the dish / across contact (units / s) | 0.22 / 0.16 / 1.43 | 0 | 1.77 / 0.70 / 7.14 | 0 |
| mean \|voltage\|, cells above 0.1 | 0.001, 5 | 0 | 0.025, 154 (0.003, 13) | 0 |
| cells above half a battery | 509 (454) | 537 | 323 (369) | 433 |
| free light atoms g / t | 69 / 71 (73 / 77) | 65 / 66 | 79 / 73 (80 / 81) | 77 / 75 |
| net + / net - cells | 355 / 411 (345 / 507) | 371 / 370 | 377 / 534 (386 / 425) | 401 / 311 |
| entropy (heat out), its rate | 16.0 M, +17.1 k/s (16.2 M, +17.9 k/s) | 15.6 M, +16.5 k/s | 19.2 M, +21.8 k/s (18.9 M, +21.0 k/s) | 18.6 M, +20.3 k/s |
| atoms and charge rounding | 0 | 0 | 0 | 0 |

"OUT l" and "OUT gT" in seed 3 are hitchhikers (they rode on winning lineages in pumps-off runs too). Words for what emerged,
for watching: **exporters** (OUT g in the spot, into their neighbours), **takers of neighbours' fuel** (IN fuel across
contact), **importers of the scarce heavy taker** (IN T).

**Tuning and the defaults.** Costs: base 0.1 and 0.1 per e-fold keep pumping cheap next to the engines (a pump moving 0.3 units
per s up one or two e-folds costs 0.06 to 0.1 per s; the upkeep of a rate-1 slot 0.003 per s), so a weak pump is nearly
neutral and selection acts on what it does more than on its price (other costs were not tried). Capacitance: 0.3, 0.1 and 0.03
per R tried (above); 0.1 chosen, where the voltage matters for the cells that pump one sign hard and not for the rest. The
voltage's leak 0.5 per s, back to the battery 0.5. Founders: a third with one weak pump; mutation as below.

**Where a pump works.** On all six sides of the cell, a sixth of its rate each:
- a side touching a neighbour that touches it back (each cell records the touching neighbour across each of its sides,
  `Cell.nbr`, found by the step from its neighbour loop: the nearest touching cell whose direction is closest to the side's
  middle; two cells that list each other are in **contact**) trades with that neighbour's **stock** (rule "pumps across
  contact"): an IN pump pulls from it, an OUT pump pushes into it;
- a free side trades with the **dish** just outside it (the pixel beyond the side's middle): OUT puts the substance there,
  IN takes it from there.

**How much.** Per s a slot moves rate x the source's amount per cell volume: IN from a free side, the concentration in that
pixel x the cell's area; IN from a neighbour, or OUT, the stock that gives. An inflow is scaled by the room left in the
cell (as the passive exchange), a push into a neighbour by the room left in it. The rate is the gene's, at most `maxRate`
(4 per s; the gene may drift to 6).

**What it costs** (per unit moved, energy units; all of it heat at the cell): with x = ln((c_to + eps) / (c_from + eps)),
the e-folds up the gradient (concentrations in units per R^2, eps 0.01): nothing if x <= 0 (down the gradient); else
`base` (0.1) x min(x / `ramp`, 1) (ramp 0.5: the base cost grows smoothly from equal concentrations) + `grad` (0.1) x
min(x, `lnMax`) (lnMax 5). Plus **upkeep**, `upkeep` (0.003 energy per s) x the slot's rate, as for the engines. For
comparison: burning a unit of the light fuel gt gives 1.5 (1.125 after the burner's heat share), the heavy fuel GT 3.

**The battery decides.** The plan works out what the cell's pumps want this tick and what that costs (the gradients and the
voltage's work, below); if the battery (after this tick's crawl) cannot pay it all, every pump is scaled down to what it
can. A pump the battery cannot pay does not run.

**Membrane voltage** (rule "membrane voltage"). Each cell keeps the charge its own pumps moved across its membrane (+ in;
stock word 14) and the energy stored in it (word 15). The voltage V = that charge / the capacitance (`vCap` 0.1 atom-units
per unit of voltage, x r / R), the energy q^2 / 2C. Moving charge with a pump does work against the voltage: the battery
pays the energy the move adds (so pumping a sign the same way again costs V per unit, growing as V grows; pumping the other
sign, or the other way, lowers the voltage and costs nothing for it). The voltage **leaks back** through the membrane at
`vLeak` (0.5 per s) x the permeability gene / 3 x the damaged membrane's leak (step C6c), so a leaky or bitten membrane cannot
hold a voltage. Whatever the stored energy holds above q^2 / 2C after the leak is freed: as heat, or with the rule **voltage
pays the battery** a share `v2bEff` (0.5) back into the battery (as far as it has room). A cell that pumped charge up a
voltage gets half of the voltage's energy back as it relaxes: a second, leaky battery. Stealing charged atoms from a
neighbour builds a voltage like any other pumping, so it fights itself.
The voltage feeds the charge picture where it is natural: the charge a pump moves enters (or leaves) through the side it
passes, so it goes into that side's charge (step C6d's dipoles), and the atoms it moves into or out of the dish are the
substrate field's charge (step C6b) as always. The voltage is not added to the cell's charge q (that stays its stock's net
charge).

**Switches** (rules panel, group "Pumps (step C7)"; panel only, as no keys are left): **pumps** (the master) · **pumps across
contact** · **membrane voltage** · **voltage pays the battery**. Knobs with - and +: **base cost**, **gradient cost**, **max
rate**, **voltage leak**, **voltage to battery**. URL: `?pumps=0`, `?pumpcontact=0`, `?voltage=0`, `?v2b=0`. Console:
`moire.pumps.params` (also `ramp`, `lnMax`, `eps`, `upkeep`, `vCap`, `contactCap`), `moire.genome.params.pumpJump` (0.04),
the look in `moire.cells.look` (`pumpParts`, `pumpSize` 0.2 of r, `pumpRate` 1.5, `pumpTint` 0.7, `voltRim` 0.7, `voltFull`
0.5), `await moire.pumps.stats()` (per pump gene: carriers, their mean battery, |voltage|, how many in the light, fuel and
free light atoms inside).

**Genes, founders and mutation.** `Bio.pump` (the genome grew from 44 to 48 floats): two codes (channel + 16 x direction)
and two rates. About a third of the founders get one weak pump (rate 0.1 to 0.5) of a random substance and direction, the
rest none; they come from their own random stream (`?seed=` keeps every other gene as it was). At each birth: rates x
e^(0.1 g) (an empty slot stays empty), and with chance `pumpJump` (0.04 per birth) one slot jumps: to another substance (40 %;
an empty slot starts up at 0.1 to 0.5), to the other direction (30 %), or it empties (30 %).

**The census.** A PUMPS line in the entropy panel:

    PUMPS  active 30% (top OUT T 9%, IN L 3%, IN T 3%) · |voltage| 0.00 (4 cells > 0.1) · paid 0.45/s · moved to dish 0.11/s, from dish 0.32/s, across contact 1.36/s

(cells with a slot at rate 0.05 or more; the three commonest pump genes and their share of the cells; mean |voltage| and
the cells above 0.1; battery energy paid for pumping per s (gradients, voltage, upkeep); substance units moved per s into
and out of the dish and across contact). On a phone `PUMPS 30% · OUT T 9% IN L 3% · |V| 0.00 · paid 0.45/s`. The F overlay
adds the switches and knobs, the carriers' mean battery against the others', the fed cells (battery at least 0.3) with a
pump, every gene with its carriers (and how many of them are fed), the flows per s by class (light atoms, heavy atoms,
linkers, fuel, trace) into the dish, out of it, pulled from neighbours and pushed into them, the energy paid and freed, and
the numbers every 10 s.

**The books.** Matter is only moved, in whole counts. Race-free and exact across contact: only the pumping cell's plan writes
its requests (flux words 16..29: per side two signed 16-bit counts, one per slot); its eat applies them to its own stock,
and the neighbour's eat reads the same words and applies the reverse to its own. A request may take at most 1/24 of the
source stock (whole counts) per side, slot and tick, so 6 sides x 2 slots x (pulled + pushed) can never take a stock below
zero; the requests and the cap are worked out from the stocks as they are when the plan runs, and both cells apply them
before anything else changes the stocks. (The first version rounded each request at random before capping it, and a stock
of a few counts could go one count below zero: the atoms' rounding showed -1 count, the charge's +1, in a 10-minute run.)
Energy: battery -> heat (gradients, upkeep), battery -> the voltage's store -> heat or battery; the voltage's store counts
with the batteries in "stored". Checked: a 660 s run at MAX (seed 5) through N (120 s), a wash (Shift+C, 220 s), a resize
(300 s), G (400 s), a resize back (480 s) and a new spring (520 s): atoms and charge rounding exactly 0 throughout, energy
rounding between -0.062 and +0.007 while in grew to 9.6 M; the final 20-minute runs of seeds 3 and 7: atoms and charge 0,
energy -0.005 to +0.082 (in 16 to 19 M).

**How it is computed.** Plan (`cell_eat.wgsl`, plain reads): per slot and side, the source and destination amounts and
concentrations (the neighbour's stock and radius, or the pixel outside the side), the wanted counts and their cost, the
voltage's work, the battery's scaling, the rounding; the charge into the side's through-flow (C6d); the requests into flux.
Eat: right after the crawl, the own requests, the neighbours' requests on this cell (reversed), the takes and adds at the
free sides, the payment, the voltage (work, leak, release); deaths, bursts and new cultures hand the voltage's energy back as
heat with the battery, a birth splits it. Step (`cell_step.wgsl`): the touching neighbour across each side, in vectors in the
neighbour loop (only while pumping across contact is on; the Cell record grew from 240 to 256 bytes: `nbr`, 16 bits per side,
and `volt`). Ledger: the census (64 numbers) and 32 counters (`LG_PU`; LEDGER_WORDS 21 760). Draw: the notches from the
genome, each side's middle from the vertex shader.

**Cost** (headless Chrome, 2000 cells, seed 3, MAX, mean speed reached from 40 to 150 s, alternating runs in one session): the
commit before (1555e51) ×11.81 and ×11.72, now ×11.20 and ×11.19 (about 5 % slower), now with `?pumps=0` ×11.43 and ×11.42.
A lesson: the first version picked a pump slot in the mutation by a number (`b.pump[k]`) and a substance from a constant
array, and the whole step ran a quarter slower on Direct3D (×9.1), even with the pumps off; written with whole vectors and
selects it costs nothing measurable. Firefox (headed, 1600 × 1000) and Chrome at phone size (390 × 844: the short PUMPS line
fits, the rules panel shows the new group with its touch buttons) ran without errors.

## Step C7b: catalysts

The cells' engines are already their catalysts (enzymes); out in the dish only trace lowered the sparks (step C4). Two
more rules, both **derived** (nothing is set per substance), each its own switch:
- **Crystal seeding**: sediment lowers the spark of its **own** formation. Light linker chains (ll) make l + l → ll start
  more easily where ll already lies, heavy chains (LL) do the same for L + L → LL: crust grows on crust.
- **Trace as cofactor**: an engine runs faster the more trace the cell holds, down to a floor without any. Trace was meant
  to become a scarce vitamin.

**Crystal seeding, how it works.** The spark of a chain's formation x max(`floor`, 1 / (1 + s / `s0`)), where s is the
sediment of that same kind already there: the pixel's own, or the mean of its 4 neighbours' if that is more (so a crust
also grows at its edge, into the next pixel). The neighbours are read from the copy the tick's spreading started from
(last tick's sediment), so no pixel reads what another one is writing. **In the open only**: inside a cell there is never
any sediment to seed on (what forms there is expelled at once, step C5), so the same rule would do nothing there. Defaults:
`s0` 0.05 per R² (a thin crust already halves the spark), `floor` 0.1.

**What it looks like, honestly.** Crusts did **not** become travelling fronts or spots. What seeding does:
- **Crusts start where they never would have.** In cool light unseeded chains hardly ever form (the spark's factor is
  e^-6 or less), so the linkers a spring drips just spread out as a faint free haze. With seeding, the first few chains at
  the spring's centre lower the spark for the next ones and a crust takes off there. The clearest case: the substrate alone
  in a dim full field (light power 10 instead of 33, no day cycle, the temperature 1.3 to 1.7 per R², the cells not
  eating), a light and a heavy spring dropped side by side. After 300 s, seeded: a flat warm-grey disc of crust with a
  lighter core at the light spring (ll 38 units, 133 crust pixels), most free linkers used up (29 left); unseeded: no crust
  at the light spring at all, only the haze (ll 6.7, 31 crust pixels, all of them at the heavy spring; 63 free linkers).
  The heavy spring has its crust either way (its trace lowers the spark already). Pictures: `shots/c7b/dimcrust_cr1_t300.png`
  and `shots/c7b/dimcrust_cr0_t300.png` (not in the repository).
- **In the warm spot it changes little.** There the spark is small anyway (seeding takes its factor from 0.17 to at most
  0.64), and chains form at the springs' centres, where the linkers are dense, with or without it.
- **Crusts get a little more compact.** Seeded crust pulls the linkers onto itself, so less crust forms elsewhere: in the
  default scene at 20 minutes 576 and 621 crust pixels in 2 to 3 patches (seeds 3 and 7) against 649 and 708 in 3 to 5
  patches without, about the same amount of sediment (ll 202 to 209 against 192 to 202), fewer free linkers (29 to 32
  against 38 to 41).
- **In the cold dark dish nothing happens either way**: outside the light the dish is at about 0.1 per R², and even the
  seeded spark (a tenth of itself) leaves a factor of e^-8.
- **No balance of growth and cracking** showed: hard light cracks crust in the spot, and seeding makes the freed linkers
  chain again on the same crust, so the crust stays where it is.

Why no fronts: forming a chain needs **two** free linkers to meet, so its rate goes with the linkers' concentration
squared. Seeding takes away the spark's brake, never that one. Away from the springs the free linkers are thin (0.02 to
0.05 per R²), so a crust's edge eats them at about one count a second and creeps forward by roughly a pixel in five
minutes. Stronger seeding did not change it: substrate alone in the warm spot, s0 0.2 / floor 0.25, s0 0.05 / 0.1 and s0
0.01 / 0.02 gave 166, 172 and 181 crust pixels at 220 to 320 s, against 148 without. Fronts would need linker-rich water
(many light springs, springs that never dry up) or a rule where a single linker joins an existing chain (first order in
the linker), which is a different rule than "sediment lowers its spark"; not built.

**Trace as cofactor, how it works.** Every engine slot's rate x (`f0` + (1 - `f0`) x tr / (tr + `tHalf`)), tr the cell's
trace per R² of its area (`cell_eat.wgsl`). For a harvester the pigment still catches the same photons (its amount is the
gene); the engine can use only that share of them, the rest become heat, like photons with nothing to work on. Storers,
burners, swaps and sediment engines simply run at the scaled rate. Upkeep is still paid on the gene's rate. The C5 burner
("everyone burns") is not an engine of the genome and is not scaled. Defaults: `f0` 0.35, `tHalf` 0.002 per R² (a cell of
3 R² holding 0.006 units of trace, 25 counts, runs half way between). Measured: trace hardly passes a membrane (its
permeability is a twenty-fifth of the light atoms'), all the dish's trace comes from the heavy spring (4 % of its drip), and
over 20 minutes the cells together hold about 19 units of it, spread over 290 to 360 of the 2000 cells.

**What happened** (the default scene, 2000 cells, MAX, seeds 3 and 7, 20 minutes with both rules on and with
`?crystal=0&cofactor=0`; not bit-repeatable, one run each):
- **The engines ran at 37 to 46 % of full speed on average** (rising slowly as trace spreads into the cells), the cells
  with a battery of 0.3 or more at 41 to 73 %: the fed cells are the trace holders, so trace matters where it can.
- **It cost the culture energy in seed 3, little in seed 7**: mean battery 0.17 against 0.24 (seed 3) and 0.17 against
  0.17 (seed 7); cells above half a battery 317 against 503, and 319 against 334. The strategies hardly moved (harvest +
  burn 66 to 67 % either way); in seed 7 fewer "other" cells (5 against 10 %). Tuning: with f0 0.5 the engines ran at 51 to
  55 % and the culture stayed nearer the control; with f0 0.25 at 28 to 32 %, and the cells above half a battery fell to 66
  to 155 (of 2000) at 400 to 550 s: too hard.
- **Trace did not become a hoarded vitamin.** The trace inside the cells was the same with and without the rule (19.1 and
  18.9 units against 18.8 and 21.6 at 20 minutes); cells carrying an active "IN trace" pump numbered 11 to 33 with the rule
  against 7 to 34 without, came and went in both, and their batteries were empty (0.00 to 0.08). Pumping trace in is
  pumping up a steep gradient from water that holds very little of it near most cells, so the price is high and the gain
  small. Nothing rose.

| at about 20 minutes | seed 3 on | seed 3 off | seed 7 on | seed 7 off |
|---|---|---|---|---|
| crust pixels (patches) | 576 (2) | 649 (5) | 621 (3) | 708 (3) |
| sediment ll / LL in the dish | 202 / 224 | 192 / 215 | 209 / 222 | 202 / 215 |
| free light linkers l | 32 | 41 | 29 | 38 |
| engines' speed: all / fed cells | 46 % / 73 % | (100 %) | 46 % / 67 % | (100 %) |
| trace in cells / in the dish | 19.1 / 38.4 | 18.8 / 38.7 | 18.9 / 38.7 | 21.6 / 35.9 |
| cells holding ≥ tHalf of trace | 355 | 361 | 325 | 285 |
| IN-trace pump carriers (battery) | 24 (0.08) | 11 (0.10) | 26 (0.00) | 15 (0.06) |
| mean battery, cells above half | 0.17, 317 | 0.24, 503 | 0.17, 319 | 0.17, 334 |
| strategies h / b / h+b / o (%) | 7 / 23 / 67 / 3 | 11 / 19 / 69 / 1 | 9 / 20 / 66 / 5 | 8 / 16 / 66 / 10 |
| entropy (heat out) | 15.0 M | 16.3 M | 18.1 M | 18.7 M |

**The look.** Nothing new is drawn: crusts are drawn as before (flat warm-grey patches with a lighter core and hard edges,
the clean view's solid crusts). Under the culture they are hidden by the cells, as before; a seeded crust in the open looks
like the spring crusts of C4, a disc at the spring.

**Switches** (rules panel, group "Catalysts (step C7b)"; panel only, no keys are left): **crystal seeding** · **trace as
cofactor**. Knobs with - and +: **seeding scale** (`s0`), **spark floor** (`floor`), **speed without trace** (`f0`),
**trace half** (`tHalf`). URL: `?crystal=0`, `?cofactor=0`. Console: `moire.catalysts.params`, `await
moire.catalysts.stats()` (the crusts as patches, from the grid: crust pixels at the drawing's sedStep, patches, the largest,
edge pixels, the ll and LL in crust).

**The census.** A CATALYSTS line in the entropy panel:

    CATALYSTS  crust ll 56.8 LL 62.5 · engines at 36% (in the light 37%, fed cells 35%) · trace in cells 0.30, in the dish 15.9 · cells with trace ≥ half 16 · IN-trace pumps 6 (battery 0.00 vs 0.02)

(seed 3, early in a run: crust in the dish, the engines' mean speed, the trace inside and outside the cells, the cells
holding at least tHalf, the IN-trace pump carriers and their battery against all cells'; on a phone
`CATALYSTS ll 40.0 LL 46.2 · engines 36% · trace 0.33`). The F overlay adds the knobs, the trace inside per
cell, the carriers' trace, the last crust stats and the numbers every 10 s. Counted on the GPU in the eat pass's ledger
dispatch (LG_CAT, 16 numbers x 16 slots; LEDGER_WORDS 22 016), read back with the energy ledger.

**The books.** Nothing new moves: a spark is a rate, and the cofactor only changes how many events run, so the atoms, the
charge and the energy stay exact as before. Checked: 660 s at MAX (seed 5) through N (120 s), a wash (220 s), a resize
(300 s), G (400 s), a resize back (480 s) and new springs (520 s): atoms and charge rounding exactly 0, energy rounding
between -0.033 and +0.069 while in grew to 8.7 M.

**How it is computed.** Seeding: `react` in `matter.wgsl`, for the "form" reactions only (and only where the pixel holds
linkers); the numbers travel in struct ChemP's new `cry` (its reactions now start at byte 112). Cofactor: the engine loop
in `cell_eat.wgsl` (`cofactor()`), the numbers in struct EatP's new `cat` (1440 bytes). Census: the eat pass's ledger
dispatch.

**Cost** (headless Chrome, 2000 cells, seed 3, MAX, mean speed reached from 40 to 150 s, alternating runs): the commit
before (cf967bc) ×11.29 and ×11.33, with C7b ×11.07 and ×11.15 (about 1.5 % slower). Firefox (headed) and Chrome at phone
size (390 × 844) ran without errors; the phone's panel line fits, the rules panel shows the new group with its buttons.

## Step C8: hard light mutates

Where a cell's body catches **hard** light (the top band of the light, `src/light.js`), it keeps a **dose**: the hard
light energy it caught, fading as the cell repairs it. When the cell divides into a freed slot (turnover), its daughter's
genome is copied with more mutation, in proportion to the parent's dose. Nothing says "mutate in the spot": the rate
follows the hard light absorbed, so it is high under the spotlight at noon, low at night, and nothing in the dark.

**What it looks like** (colour by lineage, key V, `?view=1`; the default scene, 2000 cells, MAX). With colour by
lineage, a cell's hue is its key angle, which drifts a little at every copy, so a lineage is a patch of one hue.
- **Mutation on (the default) and hard light mutating**: outside the spot the culture is a quilt of flat patches of one
  colour each, as before; inside the spot the patches break up into **confetti**: neighbouring cells in all hues, pink
  next to green next to sky blue, a fine mosaic with no patch more than a few cells across. Without the rule
  (`?hardmut=0`) the spot is held by a few large patches (in seed 3 a broad green and a pink one) like the rest of the
  culture. Pictures: `shots/c8/s3_hardmut_on_t1200.png` and `shots/c8/s3_hardmut_off_t1200.png` (not in the repository).
- **Mutation itself off (key M) and hard light mutating**: then only the hard light mutates, and the difference is stark.
  After 15 minutes the dark part of the culture has coarsened into a few large flat patches (mostly one deep rose, with
  smaller teal, blue and green ones: lineages stay pure and the winners spread), while the spot is a bright confetti of
  every hue. With mutation off and the rule off too, the spot is taken by **one** cyan clone, a single flat patch.
  Pictures: `shots/c8/m0_on_t900.png` and `shots/c8/m0_off_t900.png`.

**How much** (the census line, below): in the spot at noon a cell's dose is 45 to 60 energy units, so its daughters
mutate 3 to 4.7 times as much (gain 0.05: x (1 + 0.05 x dose)); at night 12 to 15 (x 1.6 to 1.8); in the dark 0.1 to 1.7.
About 29 to 44 % of all births come from "lit" parents (a dose of at least 1). Engine and pump slot jumps per birth:
0.08 (night) to 0.30 (noon) from lit parents against 0.04 to 0.09 from the others.

**Diversity, measured** (`moire.hardlight.stats()`: for every pair of touching cells, both in the light or both in the
dark, the difference of their key angles in degrees, on the key's 60-degree circle, and how often their engine sets
differ; seeds 3 and 7, 20 minutes, sampled every 60 s; the numbers at about 1140 s and, in brackets, their range from
120 s on):

| | seed 3 on | seed 3 off | seed 7 on | seed 7 off |
|---|---|---|---|---|
| neighbours' key difference, light / dark | 10.8° / 6.1° (9.0 to 12.0 / 5.9 to 7.4) | 6.3° / 5.5° (5.7 to 7.2 / 5.5 to 7.1) | 10.4° / 6.4° (9.3 to 12.0 / 6.4 to 8.2) | 5.6° / 7.0° (5.6 to 8.4 / 6.2 to 7.7) |
| neighbours with different engine sets, light / dark | 61 % / 53 % (58 to 72 / 44 to 53) | 27 % / 46 % (27 to 45 / 39 to 47) | 68 % / 55 % (61 to 74 / 47 to 57) | 32 % / 55 % (27 to 46 / 45 to 55) |
| dose, light / dark (energy units; day and night) | 12 to 69 / 0.1 to 1.7 | - | 13 to 68 / 0.2 to 1.6 | - |
| slot jumps per birth, lit parents / others | 0.08 to 0.30 / 0.04 to 0.08 | - / 0.04 to 0.08 | 0.08 to 0.30 / 0.05 to 0.09 | - / 0.05 to 0.09 |
| cells above half a battery | 298 | 366 | 248 | 310 |
| strategies h / b / h+b / o (%) | 5 / 29 / 63 / 4 | 6 / 22 / 71 / 2 | 6 / 22 / 69 / 3 | 12 / 12 / 73 / 3 |
| entropy (heat out) | 16.3 M | 14.9 M | 17.0 M | 17.5 M |

And with mutation (key M) off, seed 3, 15 minutes: key difference light / dark 9.5° / 2.8° with the rule against 2.7° / 2.0°
without; engine sets differ 53 % / 21 % against 17 % / 11 %; the dark's key difference fell steadily from 6.9° to 2.8° (the
lineages purifying) while the spot's stayed at 7.5 to 9.5°.

So: the rule does what it should, plainly. It also has a price: the extra mutation keeps breaking the best engine sets in
the light (harvest + burn 63 to 69 % of the cells against 71 to 73 % without, fewer cells above half a battery: 298 and
248 against 366 and 310). No lineage evolved a shield: hard pigments, which would shade the body (below), did not rise.

**How it works.**
- **The dose** lives in Cell.flags (bits 19..31, 16 counts per energy unit, at most 512 units). Every tick the eat pass
  (`cell_eat.wgsl`) works out the hard light falling on the cell (the band's power x `light_factor` at its centre x its
  area), shares it by optical depth between the medium, the cell's body and any hard-band pigment the cell carries (as the
  pigments share their catch), and adds the **body's** share; then a share 1 - e^(-dt / `repair`) of the dose is repaired.
  A hard pigment takes its share first, so it would shade the body a little: a sunscreen, if one evolves (no rule asks
  for it). The dose is only a record: the light was already caught and became heat (C2), the books do not change.
- **At a birth** the step (`cell_step.wgsl`) reads the parent's dose from the neighbour grid's copy of its flags and
  mutates the copy with every mutation size and chance (the small steps, the gene jumps, the engine and pump slot jumps)
  x (1 + `gain` x dose), at most x `maxFactor`. With mutation off (key M) only the extra part (`gain` x dose) mutates, so
  in the dark a lineage then stays exactly pure. A newborn starts with no dose.
- Defaults: `gain` 0.05 per energy unit, `maxFactor` 10, `repair` 20 s (a cell lives about 40 s between turnovers).

**Switch and knobs** (rules panel, group "Hard light (step C8)"; panel only): **hard light mutates**; knobs with - and +:
**mutation per dose** (`gain`), **largest factor** (`maxFactor`), **repair time** (`repair`). URL: `?hardmut=0`. Console:
`moire.hardlight.params`, `await moire.hardlight.stats()` (touching neighbours' key difference and engine sets, light and
dark, and the mean dose).

**The census.** A HARD LIGHT line in the entropy panel:

    HARD LIGHT  dose in the light 54.9, in the dark 0.74 · births from lit parents 33% mutating ×3.8 (all ×1.93) · slot jumps per birth: lit 0.186, others 0.059 (5.64/s)

(the cells' mean dose in the light and in the dark; the share of births from parents with a dose of 1 or more and their
mutation factor, and all births'; engine and pump slot jumps per birth and per s; after a `stats()` also the neighbours'
key difference; on a phone `HARD LIGHT dose 37 / 1.3 · lit births ×2.7 · jumps 1.99/s`). With mutation off the factor
shown is only the extra part (so it can be below 1 at night). The F overlay adds the knobs, the cells whose daughters would
mutate at least 1.5 times as much, the births per s, the last `stats()` and the numbers every 10 s. Counted on the GPU: the
dose snapshot in the eat pass's ledger dispatch, the births in the step (LG_HL, 16 numbers x 16 slots; LEDGER_WORDS
22 272), read back with the energy ledger.

**Checked.** 660 s at MAX (seed 5) through N (120 s), a wash (220 s), a resize (300 s), G (400 s), a resize back (480 s)
and new springs (520 s): atoms and charge rounding exactly 0, energy rounding between -0.006 and +0.10 while in grew to
8.7 M; the four 20-minute runs: atoms and charge 0, energy -0.056 to +0.103. **Cost** (headless Chrome, 2000 cells, seed 3,
MAX, from 40 to 150 s, alternating): before (C7b) ×11.01 and ×11.04, with C8 ×11.19 and ×11.24 (no cost beyond the noise).
Firefox (headed) and Chrome at phone size (390 × 844) ran without errors; the phone's line fits, the rules panel shows the
new group with its buttons. Nothing new is drawn.

## Step C9: division and death with a changing count

Until now the number of cells never changed: when a cell died, a touching neighbour divided into its place at once
(turnover). Now cells **divide** when their battery can pay for a daughter and **die for good** when they starve, overheat
or burst, so the number of cells rises and falls with the energy the dish catches. The old turnover stays as a switch.

**What it looks like** (the default scene, 2000 cells, MAX, seeds 3 and 7).
- **The dark clears out.** In the first minute nothing seems to change, except that the cells far from the spot dim and then
  slowly fade out (a starving cell's tube fades as its starvation time runs down). Between about 80 and 120 s they die in a
  wave from the far side: whole tracts of the old blob go dark, a few small islands of fading cells last a little longer, and
  dust (the dead cells' atoms) is left where they were. By the first night (150 s) only a colony **in the spotlight** is
  left, 400 to 520 cells, most of them (86 % in seed 3) in the light. Pictures: `shots/c9/s3_div_t60.png`, `shots/c9/s3_dark_t120.png`
  (the fading, in darkness) (screenshots are not in the repository).
- **The colony grows outward from the light.** With the morning it fills up: cells divide at its edge (a dividing pair
  flashes white-hot for half a second, then two small cells grow back to full size, side by side), it spreads past the rim
  of the spot into the dark on the side of the old culture, and by 5 to 10 minutes it holds 1000 to 1300 cells, about two
  thirds of them in the light. It stays one patch (1 to 5 patches of 3 or more cells, the largest holding 97 % of them).
  Inside it the tissue is packed and nobody divides ("crowded"); births happen along the edge and in the holes deaths leave.
  Pictures: `shots/c9/s3_div_t600.png`, `shots/c9/zoom_flash_t270.png` (a close look: honeycomb tissue, white pairs that
  have just divided).
- **The count breathes with the day** and then slowly settles. Births run at 15 to 30 per s around noon and 5 to 10 at
  night; the count rises by day and stalls or falls at night (the COUNT sparkline in the panel shows the waves), peaks at
  1240 to 1310 at about 10 minutes, and then falls slowly to 650 to 750 at 20 minutes: the springs dried up after
  4 minutes, and the colony shrinks toward what the spot can feed (in turnover the same dish holds about 300 to 400 cells
  above half a battery). It never died out in the default scene.
- **Full field** (`?light=full`): the whole culture is lit, so after the same first collapse (to 435 to 510 at the first
  night: the far cells had no fuel yet) it grows outward in every direction, a ragged round colony that by 20 minutes covers
  most of the dish's height, 3700 to 3800 cells. With `?cap=2000` it fills its capacity at about 9 minutes and stays at
  exactly 2000: births equal deaths (8 per s), about 1200 cells are ready to divide and find no free slot (170 tries per s):
  turnover again, but chosen by the energy. Pictures: `shots/c9/s3_full_t1200.png`.
- **Darkness** (`?light=off`): no light, no fuel made, so the culture dies out: down to 380 cells in 41 small patches at
  2 minutes, all gone by 4 minutes. The springs only drip atoms, which nobody can eat without light. (A valid outcome: a
  dish without an energy source cannot keep cells.)
- **800 cells** (bigger cells, R from the starting number): the same story at a smaller scale, peaking at 750 at 6 minutes;
  here bursts dominate the deaths (8 to 13 per s: the free light atoms the burners release bite the light membranes) and
  the colony shrinks to about 225 by 20 minutes. Picture: `shots/c9/s3_800_t600.png`.

**Numbers** (the panel's DIVISION and ENTROPY numbers; cells alive at a time; entropy = heat out, M = millions; one run
each, not bit-repeatable; the capacity is 6000 unless noted):

| run | 2 min | 2.5 min (night) | 5 min | 10 min | 15 min | 20 min | entropy at 20 min | entropy rate at 20 min (/s) |
|---|---|---|---|---|---|---|---|---|
| seed 3, division (default) | 805 | 490 | 1122 | 1298 | 955 | 677 | 15.4 M | 13.5 k |
| seed 7, division | 619 | 403 | 888 | 1242 | 974 | 749 | 15.4 M | 14.1 k |
| seed 3, turnover (`?divide=0`) | 2000 | 2000 | 2000 | 2000 | 2000 | 2000 | 17.1 M | 18.7 k |
| seed 7, turnover | 2000 | 2000 | 2000 | 2000 | 2000 | 2000 | 18.8 M | 22.0 k |
| seed 3, full field | 774 | 435 | 1319 | 2539 | 3276 | 3683 | 56.0 M | 61.6 k |
| seed 3, full field, `?cap=2000` | 838 | 510 | 1267 | 2000 | 2000 | 2000 | 49.3 M | 47.9 k |
| seed 3, darkness | 382 | 44 | 0 (from 4 min) | 0 | 0 | 0 | 1.77 M | 1.2 k (warmth only) |
| seed 3, 800 cells (capacity 2400) | 434 | 484 | 641 | 484 | 278 | 224 | 17.4 M | 12.7 k |
| seed 3, `?cap=2000` | 805 | 517 | 995 | 1501 | 862 | 496 | 16.5 M | 12.8 k |
| seed 3, `?cap=10000` | 729 | 501 | 1271 | 1470 | 998 | 772 | 15.7 M | 14.7 k |

Deaths by cause, seed 3 division, per s (around noon / at night): starved 1 to 5 / 3 to 5, heat 0 to 3.4 (only around
noon) / 0, burst 3 to 9 / 0.3 to 1, age 3 to 6. In the spot scene the capacity never mattered (the count stays far below it:
`?cap=2000` and `?cap=10000` differ from the default only by the runs' noise). The **entropy** is a little lower with
division (15.4 M against 17.1 and 18.8 M with turnover, 20 minutes): fewer cells crawl, and the cells that are left are the
fed ones (22 to 25 % of them above half a battery at 20 minutes against 16 % in turnover). With the whole dish lit the
entropy is three to four times as high: the cells catch more light and burn more fuel; the culture's size follows. Atoms
and charge rounding stayed exactly 0 in every run, the energy rounding between −0.07 and +0.21 (in up to 56 M).

**How it works.**
- **Capacity and free slots.** The cells' buffers have a fixed number of slots: `?cap=N`, by default 3 times the starting
  number (6000 for 2000 cells; with `?divide=0` the starting number itself, as a fixed count needs no room). A slot is a
  cell while its flags have ALIVE. Each tick the neighbour grid's counting sort puts every dead slot into one more bucket
  after the last grid cell (`cell_grid.wgsl`), so the sorted list holds the live cells first (`starts[gw gh]` of them) and
  then the **free slots**. A dividing cell takes the next free slot with an atomic counter (`Stats.claim`, cleared before
  each tick); when none is left, it waits. No read-back and no stall: everything stays on the GPU. Every pass skips the
  free slots: the step runs over the live part of the sorted list only, the eat, census, ledger and heat passes check
  ALIVE, the drawing emits nothing for them, and the field draws nothing (their beat has no strength).
- **Division** (in the step, `cell_step.wgsl`): a cell may divide when its battery holds at least `divAt` (0.6) of its
  capacity, it has grown back to `minSize` (0.9) of its full size, and it is not **crowded**: the sum of its overlaps with
  its neighbours (each as a share of the contact distance) is at most `crowd` (0.6). Packed tissue has no room, so only
  the edge and the holes divide. A cell that may divides at a chance of `rate` (0.5) per s. Its daughter goes into the free
  slot, the two side by side along the mother's long axis (her stretch's direction, either end; at random when she is
  round), each `apart` (0.4) of her radius from where she was, both at `split` (0.71: about half her area each) of her
  radius, growing back to full size. The daughter's genome is a copy with mutation (`daughter_genome`, shared with the
  turnover, including step C8's hard light dose), her membrane and battery come from the split below, and she starts at
  rest (no motion energy is made).
- **The cost and the split** (in the eat pass, `cell_eat.wgsl` split): the division's **cost**, `cost` (0.4 energy units,
  a tenth of a full battery), leaves the mother's battery as heat where she is; then her stock, battery, membrane voltage and
  membrane linkers are **split** in half between the two, in whole counts (matter exact, energy exact to the count).
- **Death** (in the step): a cell dies for good when it **starved** (its battery below `starveAt`, 3 %, for `starveTime`,
  30 s; it fades out meanwhile), of **heat** damage (step C5's rule), when it **burst** (step C6c, after its flash), or by
  a small background **age** rate (`age`, 0.002 per s, times the turnover's "unhappy" factor for a cell that recognises
  none of its neighbours: so a cell lives a few minutes at most even when fed, and the colony keeps changing). The eat pass
  hands its stock and membrane back to the dish where it died and its battery (and voltage's energy) as heat, as at any
  death; its motion becomes heat too; its slot is free from the next tick.
- **Turnover** (`?divide=0`, or the switch): exactly as before, a fixed count. Both modes run only while the life cycle
  (key T, until now "turnover") is on. Switching at runtime is safe: from division to turnover the count stays where it is
  (free slots stay free), and back.
- **The look:** both cells of a division flash: their tubes go white-hot and brighter for `look.flashTime` (0.5 s), fading
  fast (`moire.division.look.flash`, 1.2); a starving cell fades out as its starvation time runs down (to 15 % at the end,
  `look.fade` 0.85) and then is gone; a birth drops a small bump into the ripples, a death a dip (as the old reference did).
  Kept subtle: at most a few dozen flashes per s, each half a second, over a colony of a thousand.

**Defaults and why.** Division is the default: it looks right (the culture finds its light and grows from it, the dark
clears out) and it stayed alive for 20 minutes in every lit run. The first versions of the numbers were the ones tested;
nothing needed a hand rule to keep the count up. The collapse in the first two minutes is real: the starting blob of 2000
holds far more cells than the spot can feed (in turnover 93 % of them had an empty battery at 2 minutes).

**Switch and knobs** (rules panel, group "Division (step C9)"; panel only, no keys are free): **division (changing count)**
(off: the old turnover); knobs with - and +: **division threshold** (`divAt`), **division cost** (`cost`), **starvation
time** (`starveTime`), **crowding limit** (`crowd`), **background deaths** (`age`). Key **T** is now "life cycle" (births
and deaths at all, in either mode). URL: `?divide=0`, `?cap=N`, `?divat=`, `?divcost=`, `?starve=` (the starvation time),
`?crowd=`, `?age=`. Console: `moire.division.params` (also `rate`, `minSize`, `split`, `apart`, `starveAt`),
`moire.division.look`, `await moire.division.stats()` (the live cells: how many, the share in the light, mean battery,
the culture's centre and spread, and its patches of touching cells: how many, the largest, the share in patches of 20 or
more).

**The census.** A DIVISION line and a COUNT line in the entropy panel:

    DIVISION  cells 1298 of 6000 · births 12.8/s · deaths 13.1/s: starved 4.8, heat 0.0, burst 3.4, age 4.9 · ready 428 (crowded 406) · starving 144
    COUNT  ▅▅▅▆▆▆▇▇▇▇▇█████▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  last 2.9 min, 1239 to 1310

(cells alive and the capacity; births and deaths per s over the last 10 s, the deaths by cause; the cells ready to divide
now, and of them those too crowded; the cells starving; "no free slot" when the capacity is full. COUNT: the number alive
every 5 s, the last 3 minutes, as block characters scaled from 0 to the largest; on a phone the line is
`DIVISION 716/2400 · +0.7 −2.3/s ▅▆▆▇…` with 16 samples). With turnover it says `DIVISION off: turnover keeps the count at
2000 cells (births = deaths 44.0/s)`. The F overlay adds the knobs, the totals per cause, the energy the divisions' cost
turned into heat, the last `stats()` and the count every minute. The cells' line in the overlay now reads "cells 1298 alive
of 6000 slots (started with 2000)". Counted on the GPU: the counters in `Stats.div` (the step), read back with the census
every 4 frames (the live count is the census's sum of the fates); the divisions' cost in the heat's ledger (`LG_DIV`;
`LEDGER_WORDS` 22 528).

**A fix on the way.** A cell that died could leave a stale pump request behind (step C7's pumps across contact): its plan
no longer ran, but a touching neighbour's eat still applied the reverse of its last request, which made or lost a little
matter (the atoms' rounding drifted to 0.02). The plan of a free slot now clears its requests, and a neighbour skips a dead
cell.

**Checked.** 660 s at MAX (seed 5) through N (120 s), a wash (220 s), a resize (300 s), G (400 s), a resize back (480 s),
new springs (520 s), switching to turnover (580 s) and back (620 s), and T off and on (640, 650 s): atoms and charge
rounding exactly 0, energy rounding between −0.004 and +0.038 (in 6 M); N and G bring the count back to 2000. The ten
20-minute runs above: atoms and charge 0. **Cost** (headless Chrome, 2000 cells, seed 3, MAX, from 40 to 150 s): before
(C8) ×11.17 and ×11.30; division (the default, capacity 6000) ×11.07 and ×11.13; turnover with a capacity of 6000 ×9.92
and ×10.06, with the capacity at the starting number ×10.91 and ×10.96 (hence `?divide=0` now defaults to that capacity).
So the 4000 free slots cost about 9 % while the count is still high (every per-slot pass runs over the whole capacity),
and division itself costs nothing more. With the whole dish lit and 3700 cells the speed falls to ×6. Firefox (headed)
ran without errors and draws the COUNT line; Chrome at phone size (390 × 844): the compact line fits, the rules panel
shows the new group with its buttons, console clean.

## Step C10: patterned walls

The user (CLAUDE.md, C10): "evolve walls with different adhesion levels on different parts of it", and, on Claude's proposal,
"I want those effects to combine". Each of the six sides of a cell now has its own stickiness, set by a few genes round the wall;
the pattern hangs on the cell's FRONT, which a daughter inherits and the charge dipole can turn; a contact holds only as well as
the LESS sticky of the two touching sides; glue costs linkers in the membrane and battery upkeep; and a contact that lasts
matures and grows stickier. All of it is on by default, each part with its own switch.

**What it looks like.** In the clean view (default) the change is in the tubes: a sticky side's tube is a little brighter, a
side with no glue a little dimmer (±25 %, so a wall of middling stickiness looks as before), and a junction that has matured
(two sides that have held each other for some seconds) goes whiter and a touch brighter on both cells, so a matured contact
reads as a bright shared wall. In a held tissue the shared walls inside are all whitish and the free rim stays the cells' own
colour (picture: `shots/c10/zoom/c10-uni-lb-100-al_clean.png`, not in the repository; the stored configuration
`experiments/tissue/configs/c10-uni-lb-100-al/clean.jpg`). With **the machinery** (Shift+4) every cell also carries a short tick
from its centre toward its front. **Colour by wall pattern** (V, the fifth view; `?view=walls`) fills each body in its pattern's
ink, grey uniform, coral polar (front sticky, back not, or the other way), mint two-ended (both ends sticky), magenta sticky
sides, and shades the tubes strongly by each side's glue, so a two-ended cell shows two bright ends and dark flanks, and a chain
of them reads as bright bars between the cells.

In the default scene the colony in the light is **looser** than before: with the cost on, a cell holds glue only where its
membrane has the linkers for it and its battery pays the upkeep, and most cells lack the linkers for most of the run (the mean glue
held is 0.02 to 0.28 of the 0.5 to 0.7 the genes ask for), so neighbours that hold no glue push off a little (the adhesion's
`adhBase`, as unlike neighbours always did) and the colony becomes a foam of cells with dark gaps between them, with whitish
matured patches where linkers are plenty (near the springs). With `?wallcost=0` it packs as before. (Since step C11 the first 0.5 of every side's glue is free, so the colony packs again: "Step C11: glue turns cells".)

**The pattern.** Three smooth genes in the cell's own frame set each side's adhesion:

    P(psi) = clamp(a0 + s (a1 cos psi + a2 cos 2 psi), 0, 1)

psi the direction of the side's middle measured from the cell's front, s the pattern strength (knob, 1). **a0** is the overall
stickiness: it is the adhesion gene itself (Bio.body.x), so a uniform wall is exactly the old adhesion gene. **a1** is the
polar part (+: the front sticky and the back not; −: the other way). **a2** is the two-fold part (+: both ends sticky and the
flanks not; −: the flanks sticky and the ends not). Mutation drifts a1, a2 and w (below) by 0.04 a birth (a normal step, kept
within −1..1 and 0..1; times the step C8 hard light factor, like every gene); the founders' walls are near-uniform (|a1|, |a2| up
to 0.08), so a pattern has to evolve. New genes in Bio.wall (the genome grew from 48 to 52 floats), from their own random
stream (`?seed=` keeps every other gene).

**The front.** Cell.front (radians) is a direction fixed in the cell's body: it turns as the honeycomb hexagon turns (the contacts'
turning, step C6c), and a daughter **inherits** it: at a division (step C9) she gets her mother's front and her mother's hexagon
(orientation, outline and corner slides: before C10 her hexagon started turned at random); at a turnover birth the parent's front
and orientation from the lean copy. The gene **w** (0..1) lets the charge dipole (step C6d) pull the front round: toward the
dipole's + end at `frontRate` (0.5 rad/s) × w × |d| × the sine of the angle between them. With w = 0 the front is the inherited
orientation alone; with w = 1 and a strong dipole it follows the dipole within a few seconds; a weak or passing dipole barely
moves it, so the front stays a property of the cell. The founders' w is 0 to 0.5. A culture's founders get their fronts from
their seeds (all directions).

**The contact.** A contact holds by the SMALLER of the two touching sides' effective adhesion (both must be sticky), times what
the adhesion already had for matching (the keys' likeness, the J of the reference, and the same-fate glue):

    pull = (min(A_i, A_j) x (likeness + same-fate glue) - adhBase) x strength x R x contact stiffness

where it was (sqrt(a0_i a0_j) x likeness + same-fate glue − adhBase) × the same. So a pair of uniform cells with the same a0 holds
as before (a0 × likeness), the same-fate glue now needs glue molecules too, and a pair whose touching sides hold nothing pushes
off a little (− adhBase), as unlike neighbours always did. Which side faces the neighbour: by the direction to it against each
hexagon's orientation (side k spans theta + k × 60 .. (k + 1) × 60 degrees; `wall_side` in `cell_common.wgsl`), at the 8 bits of
theta the neighbours see, so both cells of a contact pick the same pair of sides and the forces stay equal and opposite.

**Cost.** Adhesion molecules are made of **linkers** in the membrane. A side wants, on top of its membrane (step C6c),
`linkPer` (0.012 atom-units per R of side, as much again as the founders' thin membrane) × its adhesion × its rest length, in the
membrane's own mix of l and L, woven by the membrane's repair (paying the same sparks from the battery). The membrane itself fills
first: a side holds glue only as far as it holds linkers beyond its membrane's want. And the battery pays an **upkeep** for the
glue held, `upkeep` (0.001 energy per s per R of side at adhesion 1; a fully sticky cell has about 6.6 R of wall: 0.0066 per s,
about two engine rate-units' upkeep) × adhesion × the side's length, as heat; what it cannot pay it cannot hold (every side × the
share paid). So stickiness is paid for where it is used, in matter and in energy. Without the membrane chemistry there is no
material to count (only the upkeep). Derived only: no cost depends on the pattern itself.

**Maturation.** A side that keeps touching a sticky neighbour matures: its maturity rises at `matureRate` (0.2 per s, by how fully
it touches) toward 1 and fades at `matureFade` (0.5 per s) once the contact is lost; a junction holds × (1 + (`matureCap` − 1) ×
maturity), up to × 2 (and wants that much more linker and upkeep).

**Switches** (rules panel, group "Patterned walls (step C10)"; panel only, no keys are free): **patterned walls** (the master;
off: the adhesion of steps 3b to C9, exactly: the old formula, no linker want, no upkeep, a daughter's hexagon turned at random) ·
**front follows the dipole** · **adhesion costs** · **junctions mature**. Knobs with − and +: **pattern strength**, **front
turning**, **maturation rate**, **maturity cap**, **cost per adhesion** (the upkeep). URL: `?walls=0`, `?wallfront=0`,
`?wallcost=0`, `?mature=0`, `?view=walls`. Console: `moire.walls.params` (also `matureFade`, `linkPer`, `patternMin`),
`moire.walls.look` (`sticky` 0.25, `junction` 0.3, `junctionGlow` 0.12, `frontTick` 0.8, `viewTube` 0.7, `viewFill` 0.3),
`await moire.walls.stats()` (where on the walls the contacts sit: front, flank, back; the glue; the matured share), and the genes
by name for the tissue lab: `moire.genome.setAll({ a0: 0.5, a1: 0, a2: 0.5, w: 0 })` (`a0` is `adhesion`).

**The census.** A WALLS line in the entropy panel:

    WALLS  a0 0.60 · |a1| 0.45 · |a2| 0.37 · uniform 4%, polar 56%, two-ended 20%, sides 19% · mature 0.07 (contacts 6%) · glue 0.15 of 0.64 asked · in adhesion: linkers 21.1, upkeep 1.50/s

(the mean genes; the pattern classes: uniform when |a1| and |a2| are both below 0.15, else polar when |a1| is the larger, else
two-ended or sticky sides by the sign of a2; the sides' mean maturity and the share of contacts whose side has matured above half;
the mean glue held against the mean asked for; the linkers held for adhesion and the upkeep paid per s). On a phone
`WALLS uni 4% pol 56% end 20% sid 19% · mature 0.07 · 1.50/s`. The F overlay adds the switches and knobs, the signed means of a1
and a2, w, the contacts and their glue, the share meeting with the front, how well the front follows the dipole (the mean cos over
the polarised cells) and the classes every 30 s. Counted on the GPU by the step on the frame's last tick (Stats.wall, 24 words;
the genes also while the walls are off, for the controls), read back with the cells' census; in `moire.sample()` as `walls.*`
(and the last `stats()` as `wallstats.*`).

**How it is computed.** The eat pass (`cell_eat.wgsl`, right in the membrane's repair) works out each side's pattern (from the
genes, the front and the side's real middle), its maturity factor, the extra linker it wants (the repair weaves it), what it
holds, the upkeep and the share paid, and writes each side's effective adhesion (Cell.wadh, 8 bits a side, 0..3), the linkers
held for adhesion and the upkeep paid (Cell.wlink, wpay). The grid's scatter copies it into the lean neighbour copy with the
hexagon's orientation and the front (8 bits each: CellCore grew from 112 to 120 bytes). The step (`cell_step.wgsl`) takes the
smaller side of each contact in the neighbour loop, matures the junctions (Cell.mature, 16 bits a side), turns the front, makes the
inheritance and counts the census. The Cell record grew from 256 to 288 bytes (words 64..71: front, mature[3], wadh[2], wlink,
wpay), Fields to 416, EatP to 1504, Draw to 864, Stats to 8736 bytes. Snapshots: the walls' state is in the Cell and Bio records
and `walls.params`; a snapshot saved before C10 (cells of 64 words, genomes of 48) loads with the new words empty and the walls
**off**, so it runs on as it was saved (the stored tissue configurations load and run as before: checked below).

**The books.** The adhesion's linkers sit in the membrane's words, so they count with the cells' l and L (the atoms' books, exact);
weaving them pays the membrane's sparks; the upkeep goes from the batteries to heat. Nothing else moves matter or energy.

**In the tissue lab** (hand-set patterns, no evolution; the whole series in TISSUE.md, "C10: patterned walls in the tissue lab").
With the front fixed in each cell and nothing that turns a cell's sticky side toward its neighbours, a patterned wall cuts a
sheet into small units of a shape the pattern sets, and the contacts sit exactly where the pattern says: **polar** cells make
front-to-front pairs and little rosettes of 3 to 5 with their sticky fronts in the middle (contacts at the front 56 to 70 %);
**two-ended** cells make dumbbells and short chains, 2 to 4 cells end to end (contacts at the flanks 2 to 9 %), the joints bright
bars in the walls view; **sticky sides** make side-by-side pairs and small rafts (contacts at the flanks 44 to 71 %). None makes a
tissue by itself (scores 0.06 to 0.15 with field A off, against 1.0 for a uniform wall); the long beat (lever 0.2) glues them back
into loose nets and islands (0.16 to 0.55, islands up to 0.85). A uniform wall makes the honeycomb sheet as before, its inner
junctions all matured (bright shared walls). No cyst with a lumen, bilayer, long chain or palisade in 120 s. With the cost on (a
linker spring under the cells, dark dish) the tissue holds while the batteries last and lets go when they are empty (about 90 s).
The front follows the dipole when w = 1 (mean cos between front and dipole 0.49 to 0.65, against −0.08 to 0.12 with w = 0).
Pictures (not in the repository): `shots/c10/zoom/c10-pol-off-m0-al_walls.png` (rosettes), `shots/c10/zoom/c10-end-off-m1-al_walls.png`
(dumbbells and chains), `shots/c10/zoom/c10-end-off-m1-al_machinery.png` (the front ticks); stored: `experiments/tissue/configs/c10-*/clean.jpg`.

**Evolution** (the default scene, 2000 cells, division, MAX, headless Chrome; seeds 3 and 7, 20 minutes, walls on (the defaults)
against `?walls=0`; and seed 3 with the long beat, `lever 0.2`, both ways; one run each, not bit-repeatable; the walls' genes are
counted in the controls too, where they drift without acting):

| run | cells 2 / 5 / 10 / 15 / 20 min | entropy at 20 min (rate) | uniform / polar / two-ended / sides at 20 min | mean a1, a2 (|a1|, |a2|) at 20 min | glue held / asked | linkers in adhesion, upkeep |
|---|---|---|---|---|---|---|
| seed 3, walls on | 908 / 1368 / 1406 / 986 / 633 | 18.0 M (14.5 k/s) | 2 / 49 / 46 / 3 % | −0.08, +0.44 (0.53, 0.53) | 0.26 / 0.53 | 16.9, 1.24 /s |
| seed 3, walls off | 807 / 1107 / 1489 / 1154 / 730 | 16.3 M (14.3 k/s) | 3 / 61 / 17 / 18 % | −0.32, +0.02 (0.52, 0.38) | - | - |
| seed 7, walls on | 647 / 1410 / 1642 / 869 / 621 | 19.4 M (15.6 k/s) | 2 / 33 / 2 / 63 % | −0.17, −0.57 (0.45, 0.61) | 0.02 / 0.54 | 1.8, 0.11 /s |
| seed 7, walls off | 642 / 1180 / 1705 / 1186 / 858 | 17.9 M (16.6 k/s) | 4 / 46 / 42 / 8 % | −0.22, +0.36 (0.49, 0.50) | - | - |
| seed 3, long beat, walls on | 797 / 1104 / 1772 / 848 / 587 | 16.4 M (12.9 k/s) | 6 / 32 / 51 / 11 % | −0.07, +0.37 (0.42, 0.54) | 0.28 / 0.69 | 16.8, 1.25 /s |
| seed 3, long beat, walls off | 824 / 1520 / 1790 / 791 / 509 | 15.8 M (12.2 k/s) | 3 / 61 / 18 / 18 % | +0.58, −0.03 (0.61, 0.44) | - | - |

Plainly:
- **Patterns appear fast, but by drift, not (visibly) by selection.** Within 5 minutes fewer than a sixth of the cells have a
  uniform wall, by 20 minutes 2 to 6 %, in the controls exactly as with the walls on. The genes move 0.04 a birth, and in the
  spotlight the hard light (step C8) multiplies every mutation by 3 to 10, so a lineage's a1 and a2 wander across their whole range
  in some tens of generations. Which pattern ends up common follows the winning lineages (seed 7 with the walls on: sticky sides
  63 %; without: two-ended 42 %), and the signs differ between seeds and between on and off. The one hint of something more: the
  three runs with the walls on ended with larger |a2| (0.53 to 0.61) than their controls (0.38 to 0.50), and seed 3 went two-ended
  both times (46 % and 51 %, a2 +0.44 and +0.37) where its controls stayed polar. One run each: a hint only.
- **The tissue does not look patterned.** Where the contacts sit on the walls is random (front / flank / back a third each, in
  every run), because the fronts are not tied to anything the neighbours do: a colony's cells point every way. What does show is
  the cost: most cells hold little glue (the glue held 0.26 of the 0.53 to 0.69 asked in seed 3; almost none in seed 7, whose
  colony built few membranes: mean integrity 0.28), so the colony is a looser foam with dark gaps between the cells, with whitish
  matured walls in patches where linkers are plenty (near the springs and in the old culture's middle). Pictures:
  `shots/c10/zoom/evo-on_s7_clean.png`, `..._walls.png` (not in the repository; runs `experiments/runs/c10/c10-evo-*`).
- **Count and entropy.** The counts follow step C9's course (the dark clears in two minutes, the colony grows from the light,
  peaks at 10 minutes, shrinks as the springs dry up); at 20 minutes 633 and 621 cells with the walls on against 730 and 858 off,
  but 587 against 509 with the long beat: no clear difference. The entropy (heat out) at 20 minutes was a little higher with the
  walls on in all three pairs (+4 to +10 %; the upkeep itself is only about 1.2 energy per s of the 13 to 17 thousand per s that
  leave as heat); ORDER the same (0.21 to 0.22).
- **The long beat** (the tissue series' glue) made no visible tissue in the default scene either: the colony's cells are fed,
  divide and move, and the field holds them only loosely.

**Checked.** The books: a 700 s run at MAX (seed 5) through N (120 s), a wash (220 s), a resize to 1000 × 700 (300 s), G (400 s), a
resize back (480 s), two new springs (520 s), switching the walls off and on, the cost, the maturation, the front and the honeycomb
at runtime (560 to 610 s) and a snapshot saved and loaded at once (640 s: exact): atoms and charge rounding exactly 0 and the
energy's between −0.097 and −0.003 (in 7.5 M), except in the one sample taken in the same paused instant as each resize (the old
grid not yet drained into the new one: atoms 927 and 405, energy 42 k and 22 k; 10 s later 0 again). The same run with `?walls=0`
shows the same two samples (880 and 376 atoms), so that is the experiment tool sampling mid-resize, not the walls (the run's
count also falls the same way after G in both: 32 and 48 cells at 590 s). The six 20-minute runs and the 56 tissue runs: atoms
and charge 0 in every sample, energy between −0.13 and +0.12. The tissue series' stored configurations (saved before C10) reload
with the walls off and keep their form (TISSUE.md). No WebGPU errors in Chrome (headless; also at phone size 390 × 844: the short
WALLS line fits, the rules panel shows the group with its switches and knobs) or Firefox (headed, 1600 × 1000, the walls view).
**Cost (speed).** Measured as the earlier steps were (headless Chrome, 2000 cells, seed 3, MAX, the mean speed reached from 40 to
150 s), but the GPU was shared the whole time with another worker's experiment runs (two to three pages at once), so the numbers
say little: alternating runs gave the commit before C10 ×9.3 and ×1.54, C10 ×1.59 and ×1.42, C10 with `?walls=0` ×1.53 and
×9.19 (the two ×9 runs fell into a quiet moment); the three run side by side at once (sharing the GPU equally) gave ×0.66
(before), ×0.71 (C10) and ×0.68 (`?walls=0`). So no cost shows above the noise; what it costs in principle: the lean neighbour
copy grew from 112 to 120 bytes (read for every neighbour of every cell each tick), the Cell from 256 to 288 bytes, and the eat
pass works out six cosines per cell. Worth measuring again on a quiet GPU. Firefox (headed, 1600 × 1000) ran at ×2.2 at 8× on the
shared GPU (not comparable either).

## Step C11: glue turns cells

The user (CLAUDE.md, C11): "yes absolutely" to the idea that a sticky side pulling on a neighbour pulls off-centre, so the same
pull also turns the cell until its sticky sides face its neighbours; and division along (or across) the front, so daughters land
where the pattern says. Plus the walls' cost retuned ("your call"), so the default colony packs as a honeycomb again.

**What it looks like.** Nothing new is drawn: the change is in how cells sit. In the **tissue lab** (few cells, one hand-set wall
pattern, no evolution) the cells now swing their sticky parts toward each other within a second or two of meeting and then sit
still, so each pattern shows as a shape: **polar** cells (front sticky) close into trefoil **rosettes**, three cells with their
sticky fronts in the middle like a pinwheel; **two-ended** cells join end to end into a **net of short chains** (bright bars at the
joints in the walls view); cells with **sticky sides** lie flank to flank in **palisade rows** inside one sheet; an **epithelial**
pattern (flanks sticky, apex not) makes small **cords and trefoils with the apices outside**. A founder cell that divides by its
front grows its lineage's direction into the tissue: a plain founder dividing across its front grows an **elongated sheet**.
No hollow ring or cyst formed (TISSUE.md, "C11: glue turns cells"). In the **default scene** the colony packs as a honeycomb again
(the wall-cost retune, below): at 5 minutes the walls are whiter (more matured junctions) and the dark gaps between the cells of
C10's foam are mostly gone, except at the starving rim. With **the machinery** (Shift+4) the front ticks show the cells' fronts
turning; the WALLS line shows the turning rate and where the contacts sit.

**How the turning works** (`cell_step.wgsl`, in the neighbour loop, "step C11"). The adhesion of a contact acts along the whole
shared wall, through bonds anchored in both membranes. The wall's two ends sit 30 degrees either side of the line between the two
centres (one side of a hexagon) and its middle on that line; the glue at each of the three points is the smaller of the two cells'
adhesion there (each cell's adhesion round its wall: `wall_at`, linear between its six sides' middles, from the effective per-side
adhesion of step C10, so maturity and cost count). Where the wall is stickier the bonds pull harder, so the pull's point of action
lies off the centre line and the pull turns the cell: torque = r x F summed along the wall. It is worked out as the pull's virtual
work: the change of the wall's mean glue as THIS cell turns a little (± 0.1 rad), times K h beta / 3 (K the pull per unit of glue,
from the same factors as the adhesion force: likeness, fate glue, adhesion, R, contact stiffness, touch; h the wall's half-length, a
hexagon's side at the contact's distance; beta 30 degrees), which is r x F for a glue that changes evenly along the wall. Where the
neighbour's glue is the smaller, a turn of this cell changes nothing there and gives no torque from there. Each cell works out its
own torque from the same wall the same way, so there is no race; nothing says "face your neighbour".

A first version took r x F with the glue as it stands at the wall, not anchored to the cell that turns: where the neighbour's
pattern limited the glue, the torque never went away and cells kept spinning (in the lab: turning 1 rad/s at turning strength 20,
contact persistence down from 0.87 to 0.60). The virtual-work form stops a cell once its own sticky part faces the contact.

**The body turns** overdamped: rate = turning strength / rotational drag x torque / (r² / 2) rad/s (a disc dragged over its
substrate has a rotational drag of r² / 2 against the motion's drag of 1: in this simulation velocity = force), at most 3 rad/s.
Defaults: turning strength 1 (the torque as derived), rotational drag **0.2**: a cell turns its body five times as easily as a disc
dragged over its whole footprint. At 1 the turning (about 6 degrees per s) already helped, but slowly against crawling (0.6 R/s),
which breaks contacts (lab, 40 cells, field A off, contacts per cell: polar 1.4 → 2.1, two-ended 1.3 → 2.0, sticky sides 1.3 → 2.0);
at 0.2 more (two-ended 3.1, its score 0.29 → 0.61); a strength of 20 gave no more (polar 2.4, sticky sides lost persistence). The **front** (C10) and the honeycomb's **orientation** turn together with the body, and the dipole field's torque (C6d)
turns the body at the rate it reached before. The hexagon's own pull toward its neighbours (step C6c: a side faces each neighbour)
and its corners' slides now only fit the OUTLINE to its tile: they no longer turn the front. (Before C11 the front was carried by
every turn of the outline, which locks it every 60 degrees: a cell could never have turned its sticky side round in a tissue.)
With the turning off (`?turn=0`) everything is exactly as in step C10. Ellipse cells (honeycomb off) turn only their front.

**Division by the front** (`cell_step.wgsl`, division). The daughter is put along the mother's front (gene **divAxis** 0), across it
(1) or at that share of a right angle between, either end at random; daughters inherit the front (as since C10). divAxis is
Bio.wall.w (until now spare), drifts by 0.04 a birth like a1 and a2 (within 0..1, times the hard light's factor), and the founders'
is anywhere from 0 to 1 (its own random stream: `?seed=` keeps every other gene). Off (`?divfront=0`), or with the walls off: the
long axis, as in step C9. So a polar cell dividing along its front puts its daughter ahead of it, back to front; across, side by
side with both fronts the same way; a two-ended cell along its front, end to end (sticky to sticky); a cell with sticky flanks
across its front, flank to flank.

**The walls' cost, retuned: a free base glue** (`cell_eat.wgsl`). Step C10's cost made the default colony a loose foam: a side held
glue only from linkers beyond its membrane's own want, and in the default scene the membranes themselves are far from full for
minutes (mean integrity 0.03 at 30 s, 0.6 at 5 min), so most sides held none (glue at the contacts 0.04 at 5 min, seed 3) and
touching cells pushed each other off (the loss every pair pays, adhBase 0.25). Now each side holds up to **freeGlue** (0.5) of
adhesion at no cost, as every side did before C10 (the old adhesion gene was free; the founders' a0 is 0 to 1, mean 0.5); only what a
side asks ABOVE it (a sticky side's extra, a matured junction's extra) is built from linkers and pays upkeep, exactly as in C10. So a
plain wall packs, and a patterned one still pays for its sticky parts. Why this and not the other options: a lower linker price per
glue does not help (a side whose membrane is not yet full holds no extra linker at all, whatever the price); letting the glue take
linkers before the membrane would empty the membranes (and burst cells) in a colony that has too few linkers anyway. Knob **free
base glue** (Patterned walls group), `?freeglue=x` (0: every bit of glue costs, as in C10).

Default scene, seed 3, 300 s (`experiments/keep/c11/cost-before-c10_t300.jpg` against `cost-after-c11_t300.jpg`, a crop of the
colony's middle; runs in the scratchpad, numbers from the panel and `walls.stats()`):

| at 300 s | C10 as merged | C10 with `?wallcost=0` | C11 (default) | C11 with `?turn=0&divfront=0` |
|---|---|---|---|---|
| cells | 1241 | 1352 | 1255 | 1248 |
| glue held at the contacts (the smaller side) | 0.04 | 0.76 | 0.33 | 0.36 |
| glue held per side / asked | 0.10 / 0.59 | 0.97 / 0.97 | 0.44 / 0.78 | 0.45 / 0.88 |
| touching pairs per cell | 2.53 | 2.70 | 2.67 | 2.59 |
| matured contacts | 2 % | 54 % | 27 % | 39 % |
| linkers in adhesion, upkeep | 11.6, 0.90/s | 0, 0 | 6.5, 0.48/s | 6.8, 0.50/s |

(At 60 s, while the membranes are still empty: glue at contacts 0.035 in C10, 0.44 now.) So the colony holds about as many
contacts as with no cost at all, while the sticky extras (a matured junction asks up to twice its pattern) still cost linkers and
upkeep.

**Switches and knobs.** Rules panel, group **Glue turns cells (step C11)**: **glue turns cells** (`?turn=0`), **division by the
front** (`?divfront=0`), knobs with − and +: **turning strength** (`turnGain`, 1) and **rotational drag** (`rotDrag`, 0.2). Group
Patterned walls: **free base glue** (`freeGlue`, 0.5, `?freeglue=`). Console: `moire.walls.params` (turn, divFront, turnGain,
rotDrag, freeGlue); the gene by name for the lab: `moire.genome.setAll({ divAxis: 1 })`. Constants in `cell_step.wgsl`: the rate's
cap TURN_MAX (3 rad/s), the small turn the glue's change is measured over TURN_DA (0.1 rad). No keys (none are free): panel only.

**The census.** The WALLS line now starts with

    WALLS  contacts on sticky sides 93% (chance 47%) · turning 6.1°/s · a0 ...

(the contacts that sit on a STICKY side of a patterned cell, one whose pattern from the genes, without the maturity, is in the
upper half of the cell's own range, against the share of such sides; uniform cells are not counted; and the mean turning rate the
glue gives the cells that touch another). On a phone `· sticky 93/47% · 6.1°/s`. Counted on the GPU on the frame's last tick
(Stats.wall, now 32 words: Stats 8768 bytes), in `moire.sample()` as `walls.onSticky`, `walls.stickyChance`, `walls.turnRate`
(rad/s). The F overlay adds a line with the switches, the knobs and the numbers. `await moire.walls.stats()` adds `onSticky` and
`stickyChance` (the same, from the cells read back), `bondsPerCell` (touching pairs holding at least 0.2 glue, per cell), `chains`
(groups of 3 or more glued cells, each with at most two bonds and no loop), `inChains`, `longestChain`, `rings` (groups of 5 or more,
each with exactly two bonds: a closed loop of single cells round a hole), `inRings`.

**In the tissue lab** (TISSUE.md, "C11: glue turns cells": 50 runs, 40 and 100 cells, five hand-set patterns, field A off and the
long beat, turning on against off, and growth from one founder; walls' cost off as in C10). Turning raised the contacts per cell
of every patterned wall by a third to double (field A off: polar 1.6 → 2.3, two-ended 1.3 → 2.7, sticky sides 1.3 → 2.9, epithelial
1.8 → 3.0), the glued bonds by about half and the contacts' persistence (0.74 to 0.85 → 0.82 to 0.96); with the long beat two-ended and
sticky-sided cells now hold as one tissue (score 0.35 → 0.87 and 0.49 → 0.77 at 40 cells, 0.63 → 0.88 and 0.61 → 0.86 at 100).
Polar cells put 82 % of their contacts on the front (64 % without turning, 33 % by chance) and make rosettes of three. The mean
turning rate over the touching cells was 10 to 30 degrees per s. Growth: a uniform founder dividing across its front grew an
elongated sheet (elongation 2.6 against 1.3 without the turning, which also decouples the front from the outline's 60-degree lock,
so the lineage keeps its axis); two-ended founders a net of chains, polar founders a field of rosettes, epithelial founders short
cords with the apices out; no hollow ring or cyst (nothing in the toy empties a lumen). Nine configurations are stored in
`experiments/tissue/configs/c11-*`; pictures in `experiments/keep/c11/`.

**Evolution** (the default scene, 2000 cells, division, MAX, headless Chrome; seeds 3 and 7, 20 minutes, C11 on (the defaults)
against `?turn=0&divfront=0` (the free base glue in both); runs `experiments/runs/c11/c11-evo-*`; one run each, not
bit-repeatable; the GPU was shared with other workers' runs, about ×0.4 to ×0.5):

| run | cells 2 / 5 / 10 / 15 / 20 min | entropy at 20 min (rate) | uniform / polar / two-ended / sides at 20 min (%) | mean a1, a2 at 20 min | contacts on sticky sides at 10 min (chance) | turning at 10 min (deg/s) | glue at contacts | glued bonds per cell | contacts at front / flank / back | ORDER |
|---|---|---|---|---|---|---|---|---|---|---|
| seed 3, C11 on | 822 / 1249 / 1177 / 920 / 550 | 17.0 M (13.4 k/s) | 3 / 48 / 48 / 2 | +0.23, +0.41 | 0.51 (0.52) | 7.1 | 0.31 | 2.39 | 0.35 / 0.32 / 0.33 | 0.22 |
| seed 3, off | 829 / 1169 / 1391 / 1174 / 654 | 17.4 M (13.7 k/s) | 1 / 64 / 3 / 32 | +0.30, −0.32 | 0.51 (0.51) | 0 | 0.21 | 1.79 | 0.34 / 0.33 / 0.33 | 0.22 |
| seed 7, C11 on | 766 / 1094 / 1426 / 1057 / 631 | 17.5 M (13.7 k/s) | 3 / 55 / 29 / 13 | +0.08, +0.17 | 0.50 (0.50) | 10.2 | 0.26 | 2.19 | 0.34 / 0.33 / 0.33 | 0.22 |
| seed 7, off | 720 / 1168 / 1367 / 1110 / 571 | 18.6 M (14.8 k/s) | 1 / 37 / 52 / 11 | +0.38, +0.47 | 0.50 (0.49) | 0 | 0.27 | 1.93 | 0.34 / 0.32 / 0.34 | 0.22 |

Plainly: **no visible selection of wall patterns, and no patterned tissue in the default scene.** The patterns drift as in C10
(uniform walls fall from 60 to 75 % at 2 minutes to 1 to 3 % by 20 minutes, with the turning and without), and which pattern ends
up common follows the winning lineages (seed 3 with C11: two-ended 48 %; its control: sticky sides 32 %; seed 7 the other way
round), as in C10's runs. In the colony the contacts sit on sticky sides only as often as chance (0.50 against 0.50) and at the
front, flank and back a third each: the cells do turn (7 to 10 degrees per s on average), but in a packed, crowded colony every
side touches someone, the sticky ones and the others alike, so turning cannot choose; the fed cells also crawl, divide and die
every few minutes. What the turning does show: more glued bonds per cell (2.2 to 2.4 against 1.8 to 1.9) and fewer loose chains of
glued cells (4 to 6 against 12 to 24 at 20 minutes). Count, entropy (17.0 to 18.6 M; the turning's runs 2 to 6 % lower, within the
runs' spread) and ORDER (0.22) are the same. Atoms and charge rounding exactly 0 in every sample of the four runs; the energy's
between −0.035 and +0.12.

**Checked.** The books: a 700 s run at MAX (seed 5; `experiments/runs/c11/c11-check`) through N (120 s), a wash (220 s), a resize
to 1000 × 700 (300 s), G (400 s), a resize back (480 s), two new springs (520 s), every walls switch at runtime (560 to 610 s), the
turning and division by the front off and on again, turning strength 5 with no free base glue, the defaults back (620 to 632 s), and
a snapshot saved and loaded at once (640 s: exact): atoms and charge rounding exactly 0 and the energy's between +0.004 and +0.095
(in 6.6 M), except in the two samples taken in the paused instant of each resize (atoms 881 and 363: the old grid not yet drained,
the same artefact as in step C10's check; 10 s later 0 again). The four 20-minute evolution runs and the 50 lab runs: atoms and
charge 0 in every sample. Snapshots from before C11 (C10's stored configurations) load with the turning, division by the front and
the free base glue off (the note says so) and run on as saved; older ones as before (walls off). No WebGPU errors in Chrome
(headless; also at phone size 390 × 844: the short WALLS line, two lines there, the rules panel shows the new group with its two
switches and two knobs) or Firefox (headed, 1600 × 1000, the walls view and `?turn=0`); only Chrome's usual powerPreference warning.
Not bit-repeatable: every comparison above is one run each.

**Cost (speed).** Measured as before (headless Chrome, 2000 cells, seed 3, MAX, the mean speed reached from 40 to 150 s), alternating
C10 (8e51206), C11 and C11 with `?turn=0&divfront=0`, but the GPU was saturated the whole time by other workers' runs (six other
pages), so every run reached only about real time: C10 ×1.04 and ×0.80, C11 ×0.83 and ×0.80, C11 off ×0.82 and ×0.80. No cost shows
above that noise. What it costs in principle: per touching pair with the turning on, nine lookups of the glue round the wall (one
angle each, `wall_at_a`) and three atan2 in the neighbour loop; per cell a few extra words in the census on the frame's last tick.
The Cell, CellCore and Bio records are unchanged (the gene took Bio.wall.w, spare until now); Stats grew by 32 bytes. Worth measuring
again on a quiet GPU.

## Step C12: oils and water

The user (CLAUDE.md, C12): "try to build molecules that are polar and apolar; we can simplify their charges combining
without actual physics". Molecules now have a POLARITY worked out from their atoms' charges and where those sit; water-shy
matter (oil) gathers with its own kind into droplets, water-loving matter is pushed out of them, and molecules with a
charged head on an oily tail (amphiphiles: soap) gather on the rims. All of it in the open dish; the cells meet oil
through their membranes.

**What it looks like.** Oil shows as **dark glossy droplets**: a disc a shade darker than the dish (the ripples under it
go quiet), a soft sheen just inside the rim on the side facing the light (up and left), and the **rim as one thin bright
line whose colour drifts slowly along it and in time**, as an oil slick's. Oil still dissolved (too thin to separate) is
only a faint haze. **Soap** (the amphiphiles) shows as **thin pearly lines**: around a coated droplet a second, white
line just outside its rainbow rim (an emulsion droplet looks like a ring in a ring); soap dissolved deep inside oil is not
drawn. Nothing else changes in the clean view. With **the machinery** (Shift+4), or the view panel's **polarity wash**,
water-loving matter is washed warm (orange) and water-shy matter cool (blue), flat and faint.
Pictures (kept in `experiments/keep/c12/`): `oil-droplets.png` (sixteen dark droplets with rainbow rims),
`emulsion-coated-droplets.png` (the same with soap: each rim inside a pearly ring), `soap-rings.png` (soap alone, zoomed:
every blob a hollow ring with a rainbow rim outside and inside and a pearly halo, like vesicles), `soap-foam-600s.png` (the
same later: the rings filled in, their halos joined into a net), `cells-with-oil-droplet.png` (a coated droplet at the
colony's edge, cells sitting over it), `diamonds-before-the-fix.png` (what the first scheme did: see below).

**The polarity rule** (written once, `polarity()` in `src/matter.js`; every substance's numbers come from it). A charged
atom (a giver +1, a taker −1) is water-loving; a linker that sits in a chain (bonded to another linker) is water-shy. Read
along the molecule:

    head = charged atoms / atoms        tail = chained linkers / atoms

- **amphiphile**: all the charged atoms at ONE end, a chain behind them (a charged head on an oily tail: soap, lipid);
- **polar**: charged atoms anywhere else (a lone ion; both ends charged; the fuels: a neutral molecule of a + and a − part
  still counts, because polarity is where the charge sits, not its sum);
- **apolar**: a chain and no charged atom (oil; the crusts too, but they do not move);
- neutral: neither (a lone linker, trace): no part in it.

Two numbers then say how it moves: the **bulk pull** chi = tail − head (oil +1: gathers into oil; ions and fuels −1: pushed
out; an amphiphile's head and tail cancel: 0) and the **boundary pull** beta = 2 × min(tail, head) for an amphiphile (2/3 for
glL and tlL; 0 for the rest), toward the oil-water boundary.

| substance | atoms | class | head | tail | chi | beta | charge | energy | spreads (R²/s) |
|---|---|---|---|---|---|---|---|---|---|
| g t G T | 1 | polar | 1 | 0 | −1 | 0 | ±1 | 0 | 1.2 / 0.14 |
| l L, trace | 1 | neutral | 0 | 0 | 0 | 0 | 0 | 0 | 1.2 / 0.14 / 0.017 |
| gt gT Gt GT (fuels) | 2 | polar | 1 | 0 | −1 | 0 | 0 | 1.5 to 3 | 0.84 / 0.10 |
| ll LL (crust) | 2 | apolar | 0 | 1 | +1 | 0 | 0 | −0.5 / −1 | 0 |
| **lL (oil)** | 2 | apolar | 0 | 1 | +1 | 0 | 0 | −0.75 | 0.10 |
| **glL, tlL (amphiphiles)** | 3 | amphiphile | 1/3 | 2/3 | 0 | 2/3 | +1 / −1 | −0.25 | 0.071 |

**The new molecules** are the smallest that fit the bond rules (linkers want two partners and chain; givers and takers want
one). The table had no mobile oil (ll and LL pile up as crust) and no amphiphile. Now:
- **oil lL**: a light and a heavy linker chained. Derived rule for the kind: a chain of ONE row is regular and packs into a
  solid crust (the old sediment); a chain of MIXED rows cannot pack into a crystal, so it stays liquid: it moves (at the
  speed of its heavier atom, × 0.7 for its bond, as a fuel) and is water-shy. Until now l + L did not chain at all.
- **amphiphiles glL (+1) and tlL (−1)**: a light giver or taker as a HEAD on the light end of an oil chain (the end where
  its bond is cheaper: rows 1 + 1). Three atoms, so slower (× 0.7 per bond).

**Energies, derived.** Every bond's energy now comes from its two atoms' groups and rows: each group brings a tendency (a
charged atom half the fuel's factor, +0.375; a linker half the chain's, −0.125), and bond(a, b) = (tendency a + tendency b)
× (row a + row b). That gives the old numbers for every fuel (giver-taker: 0.75 per row) and crust (linker-linker: −0.25 per
row), and for the new charged-linker bond (the head) 0.25 per row, uphill. A molecule's energy is the sum of its bonds'
(oil −0.75, an amphiphile −0.75 + 0.5 = −0.25); a bond's spark is 0.125 × its rows, as before.

**The reactions** (in the same table, both ways, atoms and charge conserved; open dish only):

| family | reaction | by | heat per event | spark |
|---|---|---|---|---|
| oil | l + L → lL | heat (k 2 R²/s, as the crust) | 0.75 | 0.375 |
| oilcrack | lL → l + L | hard light (photon 5) | 4.25 | 0.375 |
| head | g + lL → glL, t + lL → tlL | visible 1 (photon 2; the head bond is 0.5 uphill, + its spark 0.25) | 1.5 | 0.25 |
| unhead | glL → g + lL, tlL → t + lL | heat (k 0.5 /s, as fuel burning) | 0.5 | 0.25 |

The warm band is heat only, so the lowest band that makes bonds is visible 1 (the table's `bondBand`; the fuels' bands are
unchanged). Inside the cells these do not run: the cells' stock has the 13 old channels only (`NCH_CELL`), so the oil and the
amphiphiles are the open dish's (a reaction with `open` is skipped by the cells' reaction loop). The cells meet oil through
their membranes (below).

**Phase separation** (`matter.wgsl`: `oil_rho`, `oil_blur`, `oil_blur_y` once per tick before the spreading, then the
spreading's `oil_edge`). Per pixel:
- **rho**, the oil's share: the water-shy mobile matter there (the oil's chained atoms, and the amphiphiles' tails at
  `tailVol`) over `full` (1.5 atoms per R² fill a pixel);
- **obar**, rho smoothed by a Gaussian of `blur` (2) pixels, at most 1: what a molecule "sees" of the oil around it;
- **film**, the amphiphiles' share: their atoms over `filmFull` (0.6 per R²).

Every substance with a polarity is drawn up the pull **u = gain × (chi × obar + beta × 4 obar (1 − obar))** (gain 9, in
units of the thermal energy): oil climbs toward oil, ions and fuels slide out of it, soap climbs to where obar is a half,
the rim. Across each edge between two pixels the spreading and the pull (and the charge's drift of step C6b, for the
charged ones) make one **Scharfetter-Gummel flux**, `k (B(−D) m_s room_f − B(D) m_f room_s)` with B(x) = x / (eˣ − 1) and D
the drive across the edge: no drive, plain spreading; at rest the amounts follow e^u exactly, whichever way round the grid
they went. The **room** is 1 − rho for oil and 1 − film for soap (at least 0.05): a droplet fills up and then grows in area,
a film stays thin. **Skin**: oil crossing an edge where there is soap is slowed to k / (1 + skin × the film there), skin 4: a
coated droplet holds its oil. Whole counts, every edge worked out from the same numbers by both its pixels, so the atoms
and the charge stay exact. Oil separates where rho (1 − rho) × gain is above 1; below that it stays dissolved; around a
droplet about e^(−gain/2) of a full pixel stays dissolved.

Two things that did not work, kept for the record: the plain upwind drift of step C6b with a 3 × 3 or 5 × 5 smoothing made
every droplet a **diamond** (its rim was a pixel wide and the grid's axes showed); a wider Gaussian alone made them softer
diamonds; the Scharfetter-Gummel flux made them round. And a pixel's room may not reach 0: with room 0 a droplet's inside
froze, and a spring dripping into it packed it three times fuller than full.

**Membranes: fusion** (`cell_eat.wgsl`, the eat pass, just before the membrane's repair; ChemP `fuse`). The membrane is woven
from linker chains (step C6c), so it is oily. A cell whose membrane is short of linkers takes in the oil under it (its 3 × 3
pixels): each unit opens into one l and one L in its stock, and the repair weaves them in as usual. Up to `fuseK` (1) × the
shortfall per s (the larger of the l and the L its sides still want, less what the stock already holds), as far as the
battery can pay: the chain's energy (0.75 per unit: the weave holds its linkers at the free linkers' energy, step C6c) and
its spark (0.375, as heat). So fusing oil is dearer than weaving free linkers, and a cell does it only where free linkers
are short and oil is there. The other way needs no rule: a burst or a death spills the membrane as free l and L, which chain
into oil again where l meets L. Amphiphiles are not a membrane material (the cells' stock has no channel for them): the
simplest choice, left open.

**Springs.** The **oil tool** (the drop in the toolbar; no key is free) drops a spring of **oil** (lL), **oil + soap** (by
atoms 90 % oil, 5 % glL, 5 % tlL: the default) or **soap** (glL and tlL half and half: neutral overall), as the rules panel's
"oil tool drops" says (`?oilspring=`). A spring of molecules brings their chemical energy with it (oil −0.75 per unit), so
the energy ledger counts the springs' chemical energy as energy in (`chem.added`; 0 for the atom springs, as before).

**What the substrate did alone** (headless Chrome, one cell (so the cells' radius is 9 px and the grid 4.5 px a pixel),
no default springs, the light off unless said; the GPU shared all the while with up to eight other workers' runs, so the
runs reached only ×0.6 to ×10; numbers from `moire.sample()` and `moire.oil.stats()`; one run each, not bit-repeatable):
- **One oil spring** (150 s; run with the first scheme, see above, so its droplet was a diamond): the oil gathers into
  **one droplet** around the spring at once; it stays one droplet and creeps outward slowly as the last oil comes in; 77 to
  95 % of the oil inside it, the rest dissolved around it. Sixteen springs 70 px apart (also the first scheme) **merged**
  while they were dripping into one quilted puddle with water holes, the holes closing within a few minutes into one big
  drop.
- **Sixteen small oil springs 120 px apart** (20 s each): sixteen round droplets of 26 R², growing to 42 R² in 5 minutes
  (filling up to `full` from their overpacked start) and **not merging or ripening** in that time (the oil between them is
  scarce at gain 9): no coarsening to see within 5 to 20 minutes unless droplets touch. ORDER falls from 0.42 to 0.27 as
  they swell (it measures how concentrated each substance is, and a droplet that fills out spreads its oil).
- **The same with oil + soap**: sixteen **coated droplets** (a white soap line just outside each rainbow rim), 70 % of the
  soap on the rims, 5 % inside the oil, 24 % dissolved in the water; stable for 10 minutes, no merging.
- **Soap alone**: each blob of soap first gathers, then **hollows into a ring** (by 3 to 5 minutes all sixteen were rings:
  `stats()` 16 droplets, 16 rings): the soap's tails make it oily, its heads pull it to the oil-water boundary, and a blob's
  middle is no boundary, so the soap leaves it. Vesicle-like compartments, the hoped-for look. Later (10 minutes) the rings
  had **filled in again** (16 discs, 91 % of the soap on rims) and their dilute halos joined into a net with diamond-shaped
  holes, like a foam: the rings are a stage, not an end.
- **Oil from the chemistry** (a light and a heavy spring 120 px apart, the whole dish lit, 20 minutes): l + L chain into oil
  slowly (0.02 to 0.09 units per s), because the same linkers chain into crust faster (ll and LL, with crystal seeding:
  about 550 units each by 10 minutes against 16 of oil). One **small coated droplet** appears at the heavy spring at about 4
  minutes (where the slow L is dense and the fast l arrives) and grows to 35 R² (39 units of oil) by 20 minutes. Soap is made
  by the light wherever g or t meet oil (up to 2 heads per s) and taken off by heat about as fast: 6 to 13 units stay, most
  of it dissolved, 7 to 23 % on the rim.

**With cells** (the default scene, seed 3, 10 minutes instead of 20 because the GPU ran at ×0.4; an oil + soap spring
dripping for 240 s at the colony's upper edge in both runs; with oil on and with `?oil=0`, where the spring's oil and soap
only spread):
- The oil becomes **one coated droplet** at the colony's edge (90 R², 648 units of oil, all of it in the droplet by 10
  minutes); the cells crawl over it (the drawing puts the cells on top). With `?oil=0` the same oil spreads out invisibly.
- **Fusion is a trickle**: 8 units of oil taken into membranes in 10 minutes (up to 0.03 per s), because a cell fuses only
  where its membrane is short and its battery pays 1.1 per unit; free linkers from the springs and from bursts serve the
  membranes first. Membranes the same either way (mean integrity 0.67 against 0.70; l in membranes 42 against 49, L 10
  against 7).
- **ORDER is higher with the oil gathered**: 0.39 against 0.24 at 10 minutes (0.49 against 0.38 at 2 minutes): the separated
  oil is concentrated where the control's is smeared. The entropy (heat out) is the same within noise (9.63 M against 9.47 M),
  the count too (1459 against 1388 cells: one run each, and the count swings by more than that).
- In the default scene without an oil spring, the springs' l and L make almost no oil (0.04 units by 3 minutes: the
  linkers go into crusts and membranes first).

**Switches** (rules panel, group "Oils and water (step C12)"; panel only): **oils and water** (the master: the oil's and
soap's reactions, the separation, fusion, the look) · **phase separation** (off: everything only spreads) ·
**amphiphiles** (off: no heads put on or taken off, no rim pull, no skin) · **membrane fusion** · **oil tool drops**
(oil, oil + soap, soap). View panel (look): **oil films drawn**, **polarity wash** (also part of the machinery, Shift+4).
URL: `?oil=0`, `?phase=0`, `?amphi=0`, `?fusion=0`, `?oilspring=oil|emulsion|soap`, `?polarity=1`.

**Knobs** (`moire.oil.params`; four in the panel): `gain` (9: the pull; below about 4 nothing separates), `full` (1.5 atoms
per R²), `blur` (2 pixels: the smoothing, the rims' roundness), `tailVol` (1: soap's tails count as oil), `filmFull` (0.6),
`skin` (4), `kOil` (2 R²/s), `kCrack` (0.01), `kHead` (1), `kUnhead` (0.5 /s), `fuseK` (1 /s); the look: `filmAlpha`
(0.55), `lineW` (1.1), `irid` (0.7: how much the rim's colour drifts), `gloss` (0.7), `amphLine` (1), `polAlpha` (0.45).
`await moire.oil.stats()` reads the grid back and finds the droplets (8-connected pixels with rho at least a half), the
rings among them (a droplet around a patch of water that does not reach the dish's edge: vesicle-like) and where the soap
sits (on rims, inside oil, in water).

**The census.** An OIL line in the entropy panel:

    OIL  oil 863 · soap 64.1 · droplets ~16 (49.5 R²) · oil in droplets 95% · soap on boundaries 70%

(oil and soap in the dish, in units; droplets from the Euler number of the oily pixels, counted on the GPU from 2 × 2 quads,
so a ring counts 0, and their mean area; the oil's share inside droplets; the soap's share on rims, where rho is between
0.15 and 0.85; with fusion acting also `fused …/s`). On a phone `OIL 863 · soap 64.1 · drops 16 (49.5 R²)`. The F overlay
adds the switches and knobs, every substance's polarity, and the census in full. `moire.sample()` includes `oil.*` and the
last `stats()` as `oilstats.*`.

**How it is computed.** The grid holds 16 channels (13 before): `heat_common.wgsl`'s `NGRID`; the cells' stock keeps 13
(`NCH`, `NCH_CELL` in `src/matter.js`), so the cells' code is unchanged but for skipping the open dish's reactions and the
fusion block. The oil's 4 blocks (rho, film, obar, the smoothing's half way) sit behind the two copies of the substances
(the heat buffer grew by 10 blocks of the grid: 6 for the new channels' two copies, 4 for the oil). The matter ledger of the
new channels and the oil's counters live at `LG_OIL` (words 23040 on; `LEDGER_WORDS` grew to 25 600, words 22528 to 23039
left free); `lg_mc` maps a channel's ledger word. The reaction table holds up to 32 (30 now). Struct MatterP grew to 688
bytes, ChemP by `fuse` (its reactions from byte 128), the springs' uniform to 28 floats a spring, the draw uniform to 336
bytes; the paint pass writes a third texture. Old snapshots (13 substances) load: the grid's blocks are matched by name and
the new channels start empty.

**Checked** (the books): a 360 s run at MAX (seed 5, `experiments/conditions/c12/check.json`) through oil, oil + soap and soap
springs, N (60 s), a wash (100 s), a resize to 1000 × 700 (150 s), G (200 s), a resize back (220 s), new springs of every kind
(240 s), switching phase separation, amphiphiles, fusion and the master off and on and the polarity view (260 to 310 s), and a
snapshot saved and loaded at once (330 s: exact): atoms and charge rounding exactly 0 and the energy's between −0.014 and +0.056
(in 4.4 M), except in the one sample taken in the same paused instant as each resize (the old grid not yet drained: atoms 1277
and 1575; 10 s later 0 again; the same as in step C10). The first try of this check stopped at the resize with a GPU error from
the drawing's timing probe (`src/neon.js`: it recorded its commands, waited for the queue, and submitted them after a resize
had replaced a buffer they used; on a busy GPU the wait is long): the probe now records right before it submits, and the
check passed. Every other run above: atoms and charge 0 in every sample, energy within ±0.09. A snapshot saved before step C12
(`experiments/tissue/configs/c10-end-lb-100-al/snapshot.json`, 13 substances) loads with `?snap=` and runs 60 s with atoms and
charge 0. No WebGPU errors in Chrome (headless), at phone size (390 × 844, touch: the toolbar wraps into two rows with the
drop, a tap on it and two taps on the dish drop two oil springs, the panel shows the short OIL line) or Firefox (headed,
1600 × 1000, oil + soap and soap springs in the default scene).

**Cost (speed).** Measured as the earlier steps were (headless Chrome, 2000 cells, seed 3, MAX, the mean speed reached from 40
to 150 s, `experiments/conditions/c12/speed.json`), alternating, but with the GPU shared by up to eight other workers' runs the
whole time, so the numbers say little: the commit before C12 ×0.49 and ×0.60, C12 ×0.47, C12 with `?oil=0` ×0.68. No cost
shows above that noise. What it costs in principle: in the default scene (almost no oil) only the three more channels in the
loops (empty ones are skipped) and 10 more grid blocks of memory (about 4 MB: a grid of 396 × 247 at 1280 × 800); while oil or soap is in the
dish, three more dispatches per tick (the oil's share and the smoothing, 2 × 11 reads a pixel) and every polar channel's
spreading through the Scharfetter-Gummel path (two exponentials an edge). Worth measuring again on a quiet GPU.

## Step C12b: lipid membranes

The user, 2026-11-15: "Lipids should be connected with elasticity. In the membrane." Then, unsure: "I just know that bacteria
have a lipid membrane." So, closer to real cells: the membrane of step C6c (a weave of linkers) becomes a LIPID layer. SOAP (the
amphiphiles of step C12: a charged head on an oily tail) is the bilayer itself; OIL slips in between the soap's tails and
stiffens it (as cholesterol and hopanoids do); CRUST builds a rigid, brittle WALL outside it (as a bacterium's cell wall). How
stiff each side is follows from what it is made of, by the polarity numbers of step C12, never by a number set per molecule.

**What it looks like.** In the clean view the membranes now say what they are made of, inside the existing neon tubes. A **soap** membrane is a
thin **pearly** tube whose colour drifts softly along it and in time (pinks, greens, blues over the cell's own colour, like the
soap films of step C12). An **oily** membrane (soap with oil between its tails) is a **deeper, glossier** tube: a little wider,
more saturated in the cell's colour, with a sharper white-hot core. A **walled** cell has a flat, crisp **amber rim of crust**
outside its tube, laid as small bricks (a light ll crust amber, a heavy LL one deeper brown; a partial or cracked wall shows as
scattered bricks), and its tube sits a little further in, so walled cells in a tissue are separated by their crust like plant
cells. In motion: soap cells wobble slower and further when shoved, oily ones less, walled ones hardly at all, and a shoved
walled cell loses bricks (its wall cracks). Pictures (`experiments/keep/c12b/`): `lab-soap-oily-walled.jpg` (the same 40
cloned cells with a soap, an oily and a walled membrane, side by side), `lab-stir-soap-oily-walled.jpg` (the same just after a
stir), `lab-warm-soap-oily.jpg` (soap and oily membranes in a warm dish: pearly against deep red-orange).

**The make-up.** Each of the six sides of a cell holds five kinds of molecule, in its own words of the stock (32..61): soap glL
(+1), soap tlL (−1), oil lL, light crust ll and heavy crust LL. What a side wants comes from four genes:
- **thickness** (C6c's gene, unchanged): bilayer molecules per R of membrane; a side wants thickness × its rest length (1.1 r);
- **oil share** (C6c's MIX gene, `memb.x`, now read as oil per soap, 0..1): of the bilayer, oil/(1 + oil) is oil and the rest
  soap; a soap molecule holds at most one oil between its tails (`oilCap`), so oil beyond the soap there is shed;
- **wall** (`lip.x`, new): the crust wanted, as a share of a full wall (a full wall holds as much crust as the bilayer holds
  lipid); **wall row** (`lip.z`): its heavy (LL) share;
- **head** (`lip.y`, −1..1): which head the soap the cell makes carries (+1 all glL, −1 all tlL).
The small **stiffness gene** stays. Founders: the oil share is the old mix gene's values (so most founders are nearly pure
soap and a quarter oily, 0.55 to 0.9); a quarter of the founders (1, 5, 9 of 12) build walls (0.4 to 0.9 of a full wall), the
rest at most a trace; heads anywhere from mostly − to mostly +. Mutation: small additive steps (0.03 to 0.04 a birth). The genome
grew from 52 to 56 floats (`Bio.lip`).

The **integrity** of a side (step C6c's: leak, hold, softness, bursting) is now its bilayer's: soap plus the oil between its
tails, over what the thickness asks. The wall does not seal.

**Stiffness, derived.** From the polarity numbers (`polarity()` in `src/matter.js`; head = the charged atoms' share, tail =
the chained linkers' share; soap glL: 1 head atom, 2 tail atoms; oil lL: 0 and 2):

    packing   = (tail atoms / head atoms over the side's bilayer) / (pure soap's: 2 / 1)      1 for pure soap, 2 for one oil per soap
    heat      = 2 / (1 + T / Tref)                                                           2 cold, 1 at Tref (3), ~1/T hot
    bilayer k = packing × heat × (soft + (1 − soft) × integrity) × sqrt(thickness / tRef) × the stiffness gene
    side k    = bilayer k + wall cover × (4 − bilayer k)                                     a crust is a crystal: the stiffest (4)

(clamped to 0.25 .. 4; `soft` and `tRef` are C6c's knobs). Each honeycomb corner's spring (step C6c) takes the mean of its two
sides' k (omega² × k, the damping × sqrt k: every cell keeps its damping ratio, so a soft cell wobbles slower and further). In
the default scene the dark part of the dish is about 1 to 2 (heat per R²) and the spot 8 to 10: pure soap 1.2 to 1.5 in the dark
and about 0.5 in the spot; with one oil per soap twice that; a full wall 4. The same **fluidity**, 1 / (1 + bilayer k), also sets
how fast a side reseals (its bilayer rebuilds at repK × 2 / (1 + k)) and how exposed it is to bites (× 2 / (1 + k)): soap is
soft, wobbly, quick to heal and easy to bite.

**Supply.** In this order, every tick, in the eat pass:
- **fusion** (the C12 switch "membrane fusion", now for soap too): a side short of soap or oil takes it from the dish under the
  cell as it is, up to `fuseK` (1) of its shortfall per s; free (self-assembly: no bond changes); soap of the head the gene
  prefers first, then the other;
- the **builder**: what is still short is MADE from the stock's atoms: soap = a head (g or t by the head gene, the other if that
  one is short) + l + L, oil = l + L, crust = l + l or L + L, in that order (bilayer first). Each molecule pays its bonds' sparks
  from the battery (soap 0.625, oil 0.375, ll 0.25, LL 0.5) and releases its bonds' energy (soap 0.25, oil 0.75, ll 0.5, LL 1),
  both as heat at the cell (the reaction table's numbers: no new constants). A cell with an empty battery builds nothing;
- **shed**: a side holding more than shedAt (1.25) × what it wants lets the extra into the dish whole (where it gathers into soap
  films and oil droplets, or sits as crust).
Bursts and deaths spill the membrane's molecules into the dish as they are (matter exact). With the lipid membranes switched
off at runtime every lipid is shed (at shedK, 1 per s) and the C6c weave takes over; switched on, the old weave keeps only the
walls' glue (below) and sheds the rest into the stock.

**Bites, derived from the atoms** (C6c's rule, generalised): a free reactive atom outside a side bites the chains of its own
row, so each lipid by the linkers its chain holds: soap and oil (l + L) by both light and heavy atoms, a light crust (ll) only by
light atoms, a heavy crust (LL) only by heavy ones; at kBite × the atoms' concentration × the side's length × that kind's share
of the side's linkers × exp(−its chain's spark / (theta × T)) (chain sparks: ll 0.25, soap and oil 0.375, LL 0.5). The WALL is
outside: the bilayer is exposed only where no crust covers it (× (1 − cover)), and a fluid bilayer more than a packed one
(× 2 / (1 + k)). A bite pulls the molecule out whole into the dish. So a heavy (LL) wall shields a soap bilayer from the free
light atoms completely; a light (ll) wall is itself eaten by them.

**Brittle walls.** A wall CRACKS where its cell is jolted: when a corner's speed over its own wobble's angular frequency (the
swing it is in, as a share of r) exceeds `crackAt` (0.1), half the crust of its two sides breaks off per tick into the dish.
Slow packing does not crack a wall; a stir, a crowd pushing through, a division next door does.

**Charge.** The soap heads carry charge: a membrane's glL count +1 each, its tlL −1, in the cell's net charge (field B's q, the
substrate's field), and, with the dipoles on (step C6d), each side's heads stay on that side (the mobile charge moves round them).
The books count the membrane's molecules as their atoms (exact as before).

**The walls' glue (C10, C11).** Adhesion molecules are still built from linkers in the C6c weave's words: with the lipid
membranes on, those words hold ONLY the glue (no membrane of their own), woven in the wall's row (`lip.z`), with the same
sparks, upkeep and free base glue as in step C11. So glue and membrane are separate materials, both from the stock.

**The books.** Atoms and charge: the membranes' molecules count as their atoms in the cells' ledger (g, t, l, L), so every move
(fusion, building, bites, sheds, cracks, bursts) is exact to the count. Energy: the lipids' chemical energy (below the free
atoms': soap −0.25, oil −0.75, ll −0.5, LL −1 per unit) is summed on the GPU (LG_LIP_E, 64-bit) and counted as stored; the
builder's sparks and released energy go to heat; fusion, bites, sheds, cracks and spills move molecules with their energy.

**Switches** (rules panel, group "Lipid membranes (step C12b)"; panel only): **lipid membranes** (the master; off = the C6c
linker membrane exactly as before) · **heat fluidises** · **walls crack** · **soap heads charge**; knobs **soap stiff at**
(Tref), **wall cracks at**, **lipid fusion**. URL: `?lipids=0`, `?lipheat=0`, `?crack=0`, `?lipheads=0`. Old snapshots load
with the lipid membranes off and run as saved. Console: `moire.lipids.params` (on, heat, crack, heads, tRef 3, crackAt 0.1,
crackLoss 0.5, fuseK 1, oilCap 1, kMin 0.25), `moire.lipids.look` (pearl 0.55, gloss 0.5, rim 0.22, rimBright 0.8, brick
0.42), `await moire.lipids.stats()` (per founder lineage and lit/dark: genes, what the membranes hold, stiffness, cover, battery).

**The census.** A LIPIDS line in the entropy panel:

    LIPIDS  soap 20.4 (+11.2 −9.2) · oil 4.2 · wall 3.1 · genes: oil 0.21 wall 0.19 · walled 12% · stiffness 0.62 · per s: made 1.2 fused 0.1 bitten 0.3+0.1 cracked 0.05 · lit: oil … | dark: oil …

(the molecules in all membranes, units; the mean oil share and wall genes; cells whose wall covers at least half; the mean side
stiffness; per s: made from atoms, fused from the dish, bitten out of the bilayer + the wall, cracked off; in the light and in
the dark: the oil gene, stiffness and temperature). On a phone `LIPIDS soap 20.4 · oil 4.2 · wall 3.1 · stiff 0.62`.

**How it is computed.** `cell_eat.wgsl`: `plan` (the integrity, the bites, the heads on the side charges), `eat` (fusion, the
builder, cracks, sheds, the stiffness and the look into `Cell.lip`, the heads in the net charge), `give_back` and `split` (spills
and a newborn's share r / (r + r_parent) of each side), `ledger` (books and census). `cell_step.wgsl`: each corner's stiffness from
`Cell.lip` (Fields.memb bit MB_LIPID). The Cell record grew from 288 to 312 bytes (`lip[6]`: per side 8 bits each of stiffness / 4,
the wall's heavy share, the bilayer's oil share, the wall's cover), the stock from 32 to 64 words, struct EatP by `lp[9]` (1648
bytes), the Draw uniform by `lip`, `lip2`, `lipInk[3]` (944 bytes); the ledger uses the words step C12 left free (22528..23039).

**Experiment 1: the tissue lab** (`experiments/tissue/c12b.py`, conditions `experiments/conditions/c12b/lab-*.json`; 40 cloned
cells, no mutation, no turnover, the C11 lab's uniform glue (adhesion 0.8, lever 0.2, turning on), soap, oil and linker springs at
the cluster for 30 s, a stir through it at 82 s; 640 × 400 CSS px at 3 device px; one run each). The same cells with three
membranes, and two of them in a warm dish (the whole dish lit, no day cycle):

| membrane | dish T | stiffness (80 s) | wall cover | corner speed at rest (R/s) | shape change (/s) | contacts per cell | during the stir: stiffness, corner speed | wall after the stir |
|---|---|---|---|---|---|---|---|---|
| soap | 0.4 | 1.19 | – | 0.18 | 0.021 | 6.4 | 0.31, 1.85 | – |
| soap + one oil per soap | 0.3 | 2.72 | – | 0.19 | 0.012 | 5.5 | 0.52, 1.42 | – |
| soap + a full wall | 0.4 | 3.49 | 0.77 | 0.22 | 0.012 | 7.0 | 1.68, 1.48 | 0.39 (0.53 at 120 s) |
| soap, warm | 6.6 | 0.62 | – | 0.30 | 0.020 | 6.5 | 0.29, 1.76 | – |
| soap + oil, warm | 6.4 | 1.27 | – | 0.25 | 0.017 | 7.2 | 0.46, 1.71 | – |

Plainly: the derivation does what it says (oil doubles the stiffness, heat halves it, a wall takes it near the top), and the
stirred cells' outlines change most where the membrane is soap (shape change 0.021 against 0.012 per s at rest). The stir itself
heats the dish for a moment, so every bilayer goes soft while it is stirred (stiffness 0.3 to 0.5); the wall holds better
(1.7), and half of it cracks off (cover 0.77 → 0.39), then grows back as far as the cell still holds linkers. The pictures show the
difference best as colour and line (pearly thin soap, deep glossy oil, amber brick walls); the wobble shows in motion (the run's
clip, `clips/`, not kept). All clusters held together (40 of 40, contact persistence 0.95 to 1); the membrane's make-up did not
change whether the tissue links, only how its cells move and look.

**Experiment 2: the default scene** (seeds 3 and 7, 20 min at MAX, lipid membranes on and `?lipids=0`; conditions
`default-on.json`, `default-off.json`):

| run | cells (5 / 10 / 20 min) | soap in all membranes (20 min) | mean integrity (20 min) | bursts/s (mean) | ENTROPY (20 min) | ORDER (20 min) |
|---|---|---|---|---|---|---|
| on, seed 3 | 1406 / 1712 / 579 | 0.52 | 0.03 | 0 | 18.5 M | 0.231 |
| on, seed 7 | 1132 / 1697 / 664 | 0.31 | 0.01 | 0 | 20.7 M | 0.238 |
| off, seed 3 | 1250 / 1511 / 746 | (C6c weave) | 0.84 | 3.7 | 17.6 M | 0.222 |
| off, seed 7 | 1554 / 1549 / 480 | (C6c weave) | 0.53 | 0.6 | 18.0 M | 0.217 |

**In the default scene the cells can hardly build lipid membranes.** Every soap and oil molecule needs a heavy linker L, and the
default springs' L is almost all locked in heavy crust (LL) within minutes (the C6c finding, now decisive): at 4 minutes all the
cells together held 0.28 units of L against about 100 units of soap a culture of a thousand would want. So the bilayers stay
nearly empty (integrity 0.00 to 0.03 against 0.5 to 0.8 for the C6c weave), the tubes are drawn thin and dim (unbuilt), no
membrane bursts (none is ever whole), and the walls that the walled founders build from light linkers (0.27 per s) crack off
in the jostling colony about as fast (0.2 per s). The culture's count, ENTROPY and ORDER are the same within the run-to-run swing
(the count crashes every night in both, the day cycle). The lineage genes drift the same way with and without lipids (the wall
gene rose from 0.19 to 0.44 to 0.51 with them and to 0.37 to 0.45 without, where it does nothing): hitch-hiking on the founders'
other genes, not selection. To see lipid membranes in the default scene, give it lipids: drop soap and oil with the oil tool next
to the colony (experiment 3), or a slow heavy spring (experiment 4).

**Experiment 3: heat** (seed 3, 20 min; the default scene plus a soap and an oil spring dripping 5 s of every 30 s in the hot spot
and the same at the colony's far, cool rim; `heat-on.json`, `heat-off.json`). With lipids to take up, the membranes fill: soap in
all membranes 15 units at 5 minutes, 24 at 20 (+12.5 −11.6: the heads balance), oil 7.8, mean integrity 0.11 → 0.43; fusion
brings 1.6 molecules per s, the builder only 0.04 (still no L in the cells), bites take 1.2 per s back out of the bilayers; bursts
1.1 per s against 3.6 per s with the C6c weave fed the same oil. Stiffness, in the light (the spot, temperature 7 to 14) and in the
dark (2 to 3):

| t | lit cells | lit T | lit oil gene | lit stiffness | dark cells | dark T | dark oil gene | dark stiffness |
|---|---|---|---|---|---|---|---|---|
| 5 min | 817 | 13.6 | 0.15 | 0.28 | 612 | 3.1 | 0.20 | 0.45 |
| 10 min | 861 | 7.0 | 0.30 | 0.36 | 687 | 2.5 | 0.24 | 0.53 |
| 15 min | 661 | 5.2 | 0.29 | 0.41 | 425 | 2.6 | 0.31 | 0.68 |
| 20 min | 568 | 11.0 | 0.34 | 0.39 | 307 | 3.3 | 0.38 | 0.61 |

**No homeoviscous adaptation showed.** The hot cells are softer (0.3 to 0.4 against 0.45 to 0.7) only because heat fluidises
their bilayers; the oil share gene is no higher in the spot (0.34 against 0.38 at 20 minutes), and by then one lineage (founder 9)
had taken the whole dish, so there were no separate hot and cool lineages to compare. (The cool supply at the far rim was mostly
left alone: the colony drifts into the spot.) With `?lipids=0` founder 1 took the dish instead: one run each, so nothing can be
read into it. Picture: `heat-on-600s-colony.jpg` (the fed colony at 10 minutes, at the screen's own scale: the tubes pearly and
iridescent where the soap is).

**Experiment 4: the oxygen hook.** (seed 3, 20 min; the oxygen retry's springs: a never-drying light spring and a heavy one dripping 2 s of every
20 s, spotlight; `oxygen-on.json`, `oxygen-off.json`). The free light atoms build up as in the oxygen runs (g and t about 140 each at
5 minutes, 480 at 10, 1070 at 20; the same with `?lipids=0`). But the slow heavy spring's L still goes to crust, so again the cells
build almost no bilayer (soap in all membranes 0.04 to 0.19 units, integrity 0.00): what soap they fuse is bitten straight back out
(fused 0.11 to 0.31 per s, bitten out of bilayers 0.11 to 0.31 per s, the same numbers), and the light crust walls are bitten too
(0.1 to 0.2 per s). So the hoped-for story (vandals eating soft soap membranes, wall-building or oily lineages rising) **did not
show**: there were no soap membranes to eat. The wall gene fell (0.39 at 10 min → 0.30 at 20) where it rose with the C6c weave
(0.41 → 0.75, where it does nothing), and one lineage (founder 1, mostly − heads) held the whole dish; one run each, so this is no
evidence of selection. With `?lipids=0` the C6c weaves were bitten through and burst often (15 to 37 per s), with lipids nothing
burst (no membrane was ever whole). The culture was larger with lipids at 20 minutes (2305 against 2008 cells): one run each.
The obvious next try is the same set-up with a soap spring next to the light spring.

**Checked** (the books; `experiments/conditions/c12b/check.json`, seed 5, 420 s at MAX): soap, oil, emulsion and linker springs,
a quarter of the cells given a wall and oil (30 s), N (60 s), a wash (100 s), a resize to 1000 × 700 (150 s), G (200 s), a resize
back (220 s), springs of every kind (240 s), every new switch off and on at runtime and the membrane chemistry, fusion, bites and
elasticity too (255 to 340 s), a snapshot saved and loaded at once (380 s: exact). Atoms and charge rounding exactly 0 in every
sample except the two taken in the same paused instant as each resize (the old grid not yet drained: atoms 2086 and 1997, as in
steps C10 and C12; 10 s later 0 again); energy rounding between −0.033 and +0.007 in 4.4 M. Every 20-minute run: atoms and charge
0 in every sample, energy within ±0.10 in 17 to 21 M. A snapshot saved before C12b (`experiments/tissue/configs/c11-end-lb-t1`:
cells of 72 words, genomes of 52, stocks of 32) loads with `?snap=`, the lipid membranes off ("saved before step C12b: lipid
membranes off (as it ran)"), and runs 60 s with atoms and charge 0. No WebGPU errors in Chrome (headless, every run above; at phone
size 390 × 844 with the rules panel open at the new group, the panel showing the short LIPIDS line) or in Firefox (headed, 1280 ×
800, the default scene and 40 cells given soap, oil and walls). Not bit-repeatable: every comparison above is one run each.

**Cost.** Not measured on a quiet GPU (the GPU was shared with a long oxygen run all the while; the runs reached ×2.5 to ×15). In
principle: the eat pass reads and writes 30 more words per cell and runs the bites, fusion, builder, cracks and sheds per side;
the stock doubled (64 words), the Cell grew by 24 bytes; the oil's grid passes now run whenever membranes hold lipids (their
channels stay active).

**Known issues and open questions.**
- The default scene's chemistry leaves no heavy linker for soap, so lipid membranes are rare there unless soap or oil is given.
  Options for the user to decide (none is a rule yet): drop a soap or emulsion spring in the default scene; let some free L escape
  the crust (weaker crystal seeding for LL); or let the builder make soap from what is common. Left as found.
- Walls in a dense, jostling colony crack about as fast as they are built; in a quiet tissue (the lab) they hold.
- The head gene drifts but nothing selects it yet (heads balance in the colony: +12.5 −11.6).

## C12b supply: cells graze crust

The problem C12b found: in the default scene the cells could not build lipid membranes. Every soap and oil molecule needs one
heavy linker L, and within minutes nearly all the L in the dish is locked in heavy crust (LL), so the bilayers stayed empty
(integrity 0.00 to 0.03). The fix (Claude's call, CLAUDE.md "SUPPLY FIX"): **cells graze the crust under them**. No new
chemistry and no new numbers per molecule: the crust is taken in as it is, and chains are cracked back into linkers by the
reaction table's own reverse reaction, paid as the symmetry rule of step C6 says.

**What it looks like.** Little, at the scale of the whole dish: the crusts under the colony thin out (the dish holds 120 to 140
units of light crust after 15 minutes instead of 235, and 190 to 205 of heavy crust instead of 230), and about one cell in ten
now has a whole membrane, drawn as the pearly soap tube of step C12b (glossier where it holds oil) instead of the thin dim tube
of an unbuilt membrane. A few cells carry amber crust walls again (wall in all membranes up to 16 units, against 0.2 to 0.5).
Pictures: `experiments/keep/c12c/graze-on-close.jpg` and `graze-off-close.jpg` (the colony over the springs at 10 minutes, seed 7,
3 device px per CSS px): with grazing many outlines are crisp bright tubes, some pearly, some with an amber crust rim; without, the
tubes are thin and dim (unbuilt) and the cells read as green cores in faint rings.

**The rule** (in the builder's block of the eat pass, `cell_eat.wgsl`, LPF_GRAZE; after fusion, before the builder):
- a cell's want: its wall's shortfall of light and of heavy crust (as the genes ask), and the linkers its bilayer lacks (each soap
  and oil molecule needs one l and one L; what the stock already holds counts);
- it takes up to `fuseK` (the lipid fusion knob, 1 per s) of that shortfall per s from the crust in its 3 x 3 pixels (a "take", as
  everything the cells draw from the dish);
- crust asked for the wall goes into the wall **whole** (the wall is crust: self-assembly, no bond changes, nothing paid);
- the rest is **cracked** into linkers in the stock: ll -> l + l, LL -> L + L, uphill, the battery paying the chain's bond energy
  (0.5 for ll, 1 for LL: it becomes the linkers' chemical energy) and its spark (0.25, 0.5: heat), exactly the table's numbers, the
  heavy chains first; grazed crust the battery cannot crack waits in the stock as crust and is expelled with the sediment that
  tick (a cell never keeps crust in its stock).
Switch: rules panel, Lipid membranes, **cells graze crust**; URL `?graze=0`. Old snapshots load with grazing off. The LIPIDS line
says `grazed …/s`; the F overlay and `moire.sample()` (`lipids.rate.grazeL`, `grazeH`, `grazeWall`, `crackL`, `crackH`,
`crackPaid`) the details.

**Experiment: the default scene, grazing on and off** (`experiments/conditions/c12b-graze/`, seeds 3 and 7, 15 minutes at MAX,
headless Chrome on the GTX 1650, one run each):

| run | cells 5 / 10 / 15 min | mean integrity 15 min | whole membranes | soap / oil / wall in membranes (units) | crust in dish ll / LL | ENTROPY 15 min | ORDER |
|---|---|---|---|---|---|---|---|
| grazing, seed 3 | 1411 / 1819 / 745 | 0.12 | 98 | 7.4 / 3.0 / 2.0 | 140 / 204 | 12.5 M | 0.227 |
| grazing, seed 7 | 1057 / 1453 / 994 | 0.08 | 98 | 16.9 / 5.5 / 8.8 | 124 / 187 | 12.5 M | 0.231 |
| no grazing, seed 3 | 1482 / 1550 / 906 | 0.007 | 0 | 0.1 / 0.1 / 0.3 | 237 / 229 | 14.5 M | 0.245 |
| no grazing, seed 7 | 1370 / 1644 / 1335 | 0.001 | 0 | 0.2 / 0.1 / 0.2 | 236 / 229 | 15.1 M | 0.256 |

Grazing takes 7 to 25 units of crust per s by 10 to 15 minutes and the batteries pay 2.5 to 5.7 energy units per s for cracking;
50 to 100 times more soap gets into membranes, and the first whole membranes of the default scene appear. ORDER is a little lower
(the crust patches, the most concentrated matter in the dish, are eaten); the entropy is lower too, but the count swings by more
between runs than the two differ, so nothing can be read into it. No membrane burst in either. The books: atoms and charge
rounding 0 in every sample, energy within −0.11 to +0.06.

**Why it is not enough: integrity stays near 0.1, far from the 0.3 hoped for.** Two reasons, measured:
1. **The two linkers never meet in one cell.** A soap molecule needs a head (g or t), one l and one L. In the default scene the light
   linkers chain into light crust at the light spring and the heavy ones into heavy crust at the heavy spring, 144 px (about 11
   cell diameters) apart. A diagnosis every 5 minutes read every cell's stock: with grazing, 145 to 373 cells hold heavy linkers
   and 530 to 1230 hold light ones, but only 1 to 26 hold both (and a head); the L-holders listed hold 15 to 700 counts of L and 0 to 9 of l.
   A cell on the heavy crust cracks LL and has L but no l; one on the light crust the other way round; and an unsealed membrane
   leaks what it took in before it could be carried far (step C6c's hold rule: no closed membrane, no full stock): the
   chicken-and-egg of building a membrane with a leaky one.
2. **Bites cap the bilayer even when supply is plenty.** The co-location test (`same-on`, `same-off`: both springs dropped at one
   place, 8 minutes): soap and oil now form in the open where l meets L, fusion brings 2 to 9 units of soap per s into the
   membranes, and integrity rises to 0.19 (0.13 without grazing) at 4 minutes, then settles at 0.12 to 0.13 as the colony grows:
   bites take out as much soap as fusion brings (the same numbers to within 10 %, 2 to 8 units per s). Soap is the fluid, exposed part
   of the bilayer (x 2 / (1 + k)), and the free light atoms around a busy colony bite it. (C12b's experiment 3, with soap and oil
   dripped in, reached 0.43; the bites were the limit there too.)

The smallest derived changes that would help, for the user to choose (none made): a mixed spring (light and heavy linkers from
one place: a scene change, not chemistry, and the test above shows it lifts integrity to only 0.12 to 0.19); cells carrying
crust in their wall and cracking their own wall when the bilayer is short (a store that does not leak; the same reaction, so
derived, but it trades the wall for the bilayer); or nothing: a thin membrane is what this dish can afford, and the oxygen
story (step C12c) may change the bites anyway.

## Step C12c: excited waste

The oxygen retry found why breathing never ran: the free light atoms the harvesters throw away carry no energy (they are the zero
of the table), so breathing a rich fuel with one (t + gT -> gt + T) releases only the step between two fuels (0.75), while burning
the same gT releases 2.25. Real oxygen holds part of the sunlight that made it, which is why breathing beats fermenting. The user
chose the "charged waste" fix: **a light atom freed by light leaves excited**, holding part of the photon.

**What it looks like.** Where light frees light atoms (around the light spring under the spot, wherever hard light breaks fuel,
inside harvesting cells), a faint glitter of tiny **hot red-orange sparks** appears over the dust: hotter and whiter than the dim
threat-red of the ordinary free atoms, each spark flickering on its own phase, thinning out and dimming as the haze fades back to
ground atoms. It is sparse by design (at most one spark per small grid square, fewer where there is less), and in the default and
oxygen scenes it is thin: a few sparks around the light spring and the spot's rim. With the haze forced thick (a lifetime of 600 s)
it becomes an orange dust cloud around the springs. Pictures (`experiments/keep/c12c/`): `haze-sparkle-on.jpg` and
`haze-sparkle-off.jpg` (a light and a heavy spring in an empty corner of the lit dish, close up, the sparkle drawn and not).

**The rule as built** (`src/excited.js`, `src/matter.js` EXCITED and the table, `matter.wgsl`, `cell_eat.wgsl`):
- **Which reactions excite.** Every light-driven reaction of the table that frees a light giver or taker: the four uphill swaps
  (gt + T -> gT + t*, gt + G -> Gt + g*, gT + G -> GT + g*, Gt + T -> GT + t*: in the open by the dish's light, and in cells by a
  pigment's photon, the harvesting swap engines) and hard light breaking a fuel (gt -> g* + t*, gT -> g* + T, Gt -> G + t*; GT frees
  only heavy atoms). Heavy atoms are never freed excited, so there are two new substances, **g\*** and **t\***. Making fuel by light
  and the soap heads frees nothing; cracking crust and oil by hard light frees linkers, which have no excited form. A storer (an
  uphill engine paid by the battery, no photon) frees a ground atom: no light, no excitation.
- **How much it keeps.** E* = share x the photon's SURPLUS, the part that was heat until now: the uphill swaps are all driven by
  visible 1 (photon 2) and step up by 0.75, so the surplus is 1.25 for each of them. share = 1/2 (URL `?exshare=`), so **E* = 0.625**
  (taken as the smallest surplus of the reactions that excite, so every one of them can pay it; hard light breaking a fuel has 5 +
  1.5 to spare; rounded down to 1/16, so one count of g* carries 10 whole heat counts and the books stay exact). The rest of the
  photon is heat, as before. The share is fixed for the page: the excited atoms already made hold that much.
- **Substances.** g* and t* are channels 16 and 17 on the grid and words 28, 29 of every cell's stock (with exchange words 40, 41).
  They are the same atoms as g and t in every other way: row, group, charge (+1, −1: the charge field and its drift treat them
  alike), speed (they spread and pass membranes at the light atoms' rate; every per-channel number the shaders read for them is
  their ground twin's). The ledger counts their energy (E* each) as stored chemical energy wherever they are.
- **Fading.** An excited atom fades back to its ground atom by itself, its E* as heat where it is, at 1 / `life` x (1 + T / `hot`)
  per s (T the temperature there): `life` 30 s in a cold dish, `hot` 4, so about 10 s in the lit spot. The haze is rich but
  temporary.
- **Reacting.** Every reaction takes a light giver or taker from the POOL of ground and excited ones (the excited ones in proportion,
  rounded at random), so they react as their ground atoms do, at the same rates. Whatever reaction takes an excited atom also
  releases its E*:
  - through a cell's **engine** (any genome engine that uses a light giver or taker: the breathing swaps t + gT -> gt + T,
    g + Gt -> gt + G, g + GT -> gT + G, t + GT -> Gt + T, and fuel making) into the **battery**, less the engines' `ineff` share
    (25 %) as heat, as far as the battery has room (the rest heat). So **breathing gT with t\* banks 0.75 + 0.625 = 1.375** before
    ineff, and the gt it leaves can still be burned for 1.5: 2.875 in all, against 2.25 for burning the gT outright;
  - in any **uncontrolled** reaction (in the open; loose inside a cell, the heat-driven reactions of step C5; biting a membrane) as
    **heat on the spot**: the excited haze heats what it touches, a worse poison than the ground haze. An excited atom that bites a
    membrane (steps C6c and C12b) spends its E* on it: it is put back as its ground atom and the heat goes to the cell.
  - the soap builder (step C12b) takes ground heads only, and **pumps do not move excited atoms** (a pump's slot names a ground
    substance; an excited atom passes the membrane only by permeability). Both are choices to keep the rule small.
- **Off** (`?excited=0` or the rules panel): light frees ground atoms as before; excited atoms already there keep fading. From the
  start, with it off, nothing is ever excited and the chemistry is exactly the previous one (the pool of a light atom and an empty
  twin is the light atom).

No rule names breathers, oxygen or poison.

**The panel.** An EXCITED line:

    EXCITED  haze g* 0.82 · t* 0.79 in the dish, 0.18 in cells · per s: made 1.76 (light 1.70, pigments 0.06) · faded 0.29 · eaten by engines 0.23 · breathing 0.007 swaps banks +0.005 (excitation +0.08) vs burning +187 · as heat: faded 0.18, loose 0.76

(units of substance, and energy units per s: "banks" is what the swap engines put into batteries, "excitation" what all engines
gained from excited atoms, "burning" what the burn engines put into batteries). On a phone `EXCITED g* … t* … · breathing +…/s vs
burning +…/s`. The F overlay has every counter. `moire.sample()` includes `excited.*` (`excited.inDish`, `excited.rate.eBreath`,
`excited.rate.eEngine`, ...) and, as before, `cells.rate2.eSwap` (breathing events per s) and `engines.*` (the strategies' census).

**Switches and knobs.** Rules panel, group "Excited waste (step C12c)": **excited waste**, **excited lifetime**, **fades twice as fast
at**, and the share (shown; set by URL). View panel: **excited haze drawn**. URL `?excited=0`, `?exshare=`, `?exlife=`, `?exhot=`,
`?exlook=0`. Console: `moire.excited.params` (on, life, hot), `.look` (on, density, flicker, bright, radius, ink), `.table` (share,
surplus, energy).

**How it is computed.** The grid holds 18 channels (`NGRID`); every per-channel uniform of the shaders still holds 16, and an excited
channel reads its ground twin's (`gc()` in `heat_common.wgsl`). The springs' uniform keeps its disc's pixel count in `amt[19]` (it was
`amt[16]`). The ledger grew by 2176 words (`LEDGER_WORDS` 27776): the matter ledger of channels 16 and 17 (`lg_mc`), the cells' g* and
t*, and the counters (8 counts and 6 energies). ChemP grew by `ex` (its reactions from byte 144). The drawing reads a fourth texture.
Old snapshots (16 substances) load with the excited waste off; their grid's blocks are matched by name.

**The oxygen conditions again** (EXPERIMENTS.md, "Oxygen with excited waste"; `experiments/conditions/c12c/`: the oxygen retry's
springs, spotlight seeds 3 and 7, spotlight with the uphill swaps x15, the whole dish seed 3; excited waste on and off; 40 minutes
at MAX; one run each). Plainly: **breathing still does not run, and breathers do not rise.** The excited haze is thin: 1.2 to 2
units in the dish under the spot against 1000 to 3400 units of ground free light atoms (0.07 %; up to 0.8 % under the whole dish).
The free light atoms the dish is full of are not the light's waste: they come from the light spring and from every burner's
exhaust, ground, hundreds per s, against 1 to 7 per s freed excited by light. So a breathing engine, which takes its light atoms from
the cell's pool, gets an excited one about once in a thousand events: per event breathing an excited atom now beats burning (2.875
against 2.25 per gT), on average it gains 0.0006. Breathing ran at 0.02 to 0.09 swaps per s with it on and 0.04 to 0.06 with it
off; the excitation all engines banked was 0.1 to 0.3 % of burning, mostly through the harvesters' own fuel-making engines. One
large difference, in one run: under the whole dish the cells carrying a light-driven uphill swap rose to 52 % of the colony with the
excited waste on, against 2.5 % with it off (their own fuel makers bank their excited waste: light reaches the battery in two steps);
it needs another seed before it means anything. Nothing burst (the C12b membranes are rarely whole), so the haze had nothing to
poison. Entropy, ORDER and the count were the same within the runs' swing. The books: atoms and charge 0 in every sample, energy within
-0.14 and +0.28 in 47 to 180 M.

**Checked.**
- The books (`experiments/conditions/c12c/check.json`, seed 5, the whole dish lit, the uphill swaps x15, 420 s at MAX): springs of
  every kind, a quarter of the cells walled and oily, N (60 s), a wash (100 s), a resize to 1000 x 700 (150 s), G (200 s), a resize
  back (220 s), new springs (240 s), the excited waste off and on, its look off and on, its lifetime at 3 s and 300 s, `hot` 0.5,
  grazing off and on, the lipid membranes, the membrane chemistry, the engines and the chemistry each off and on at runtime (255 to
  345 s), a snapshot saved and loaded at once (380 s: exact). Atoms and charge rounding exactly 0 in every sample except the two taken
  in the same paused instant as each resize (the old grid not yet drained, as in steps C10 to C12b; 10 s later 0 again); energy
  within -0.095 and +0.001 while 15 M came in. Up to 10 units of excited atoms in the dish and 2 in the cells during it.
- Old snapshots: one saved at commit 035d3e9 (C12b with grazing, 16 substances; `reload-old.json`) loads exactly, the excited waste
  off ("saved before step C12c: excited waste off (as it ran)"), and runs 60 s with atoms and charge 0; the C11 lab snapshot
  (`experiments/conditions/c12b/reload-old.json`) loads with the lipid membranes and the excited waste off.
- Consoles clean: headless Chrome (every run above), phone size (`tools/shot.py --mobile`, 390 x 844, the toolbar and the rules panel
  open, the panel showing the short EXCITED line), headed Firefox (1280 x 800, the whole dish lit, the EXCITED line, g* in the dish).
- Not bit-repeatable: every comparison is one run per seed.

**Known issues.**
- The share of the photon an excited atom keeps is fixed for the page (`?exshare=`): changing it with excited atoms in the dish would
  change the energy they hold. A snapshot saved with another share says so when it loads, and its energy books will not match.
- Pumps do not move excited atoms, and the soap builder takes ground heads only (choices to keep the rule small; README above).
- With the excited waste on, light can reach a battery in two steps (a harvester's own engine eats its excited waste). The user's rule
  "light never charges the battery" holds for the photon itself; this route goes through a substance and an engine, as the C12c spec
  asks, and is small (0.1 to 0.3 % of burning in these runs). Worth the user's judgment.
- The excited channels spread wherever light givers or takers are, even when they are empty (2 of 18 channels: a little speed).


## The look of the landscape

Since step C6n the landscape's dots are part of the machinery (Shift+4; off in the clean default view), and the
substances are drawn as dust by default (see "The neon look and the clean view" above).
The landscape is drawn as crisp halftone dots, like print: a dot screen lies over the dish, each dot reads what it
shows at its own centre, and its area grows with the amount (flat colour, no glow; too little draws no dot).
- The cells' fields (steps 4 to 8): field A in pale dots on a triangular screen turned 15°, field B as blue rings on
  one turned 45°, the partner A' in yellow dots at 75° (the separate colour screens of print). Knobs in
  `moire.landscape.params`: `pitch` (6 CSS px), `hex`, `angle`, `threshold` (0.12), `maxDot` (0.9), `cellGain`,
  `cellLevel`, the `b...` and `p...` knobs for B and A' (the inks: `field` in `src/palette.js`).
- The substances (step C3): on the medium's own lattice instead, see "Matter" above.
- Until step C3 the nutrient and threat sources' beat landscape was drawn here too (green and red rosettes with ring
  markers); it went with the sources.
Key L hides or shows all of it. The background ripples stay soft on purpose.

## Files

- `index.html`: page, styles, safety-net message if the scripts do not start
- `src/actions.js`: the one table of actions (step C3b): every key and every toolbar button, with its label, group,
  state, what it does and its one-line explanation
- `src/ui.js`: the toolbar and its panels (light, view, rules, dish), built from that table; `src/record.js`: the
  video recording
- `src/main.js`: boot, frame loop (speeds and their budgets), input, overlay. Layers are classes with `resize`, `compute`, `render`;
  the loop runs every layer's compute passes, then hands the drawing to `src/neon.js`
- `src/neon.js` + `src/shaders/neon.wgsl`: the drawing as a whole (step C6n): the background onto the canvas, the cells
  into the trail buffer, the other layers into the light buffer, the halo, the composite; the neon switches and the
  drawing's probe. `src/palette.js`: every colour, flat and neon, with its meaning. `src/shaders/cell_glow.wgsl`: the
  cells' activity for the hum (drawing only)
- `src/gpu.js`: adapter/device setup, fallback and error messages, shader loading with readable errors
- `src/background.js` + `src/shaders/ripple_*.wgsl`, `background_draw.wgsl`: the viscous background (since step C1
  it reads the heat grid: hot places simmer)
- `src/shaders/field_common.wgsl`: the field's maths (lattices, beat against the medium, envelope), shared by
  every shader that draws or senses the field; `src/field.js` prepends it (`loadFieldShader`) and owns the
  medium's breathing lattice (`Medium`, a layer that runs first)
- `src/landscape.js` + `src/shaders/landscape_draw.wgsl`: the cells' fields as halftone dots (until step C3 also the
  nutrient and threat sources and their landscape; `field_prep.wgsl` went with them)
- `src/matter.js` + `src/shaders/matter.wgsl`, `matter_draw.wgsl`: matter (step C3): the periodic table (atoms by row
  and group, every substance's properties derived from it), the substance grid in the heat buffer, springs, spreading,
  the atoms ledger and ORDER, and the halftone drawing on the medium lattice; step C4: the energy table and the
  reaction list (derived from the same table), the chemistry's knobs and switches, and `react` in `matter.wgsl`
- `src/charge.js` + `src/shaders/charge_draw.wgsl`: charge (step C6b): its switches and knobs, the books (CHARGE line,
  overlay), the tuning aids and the contour lines; the field's relaxation and the free atoms' drift are in `matter.wgsl`
  (relax, spread), the cells' charge and the field's gradient at their membrane in `cell_eat.wgsl`, their push in
  `cell_step.wgsl`; the charges themselves (`GROUP_CHARGE`, `CHARGE_CODES`) in `src/matter.js`
- `src/pumps.js`: pumps and the membrane voltage (step C7): the switches and knobs, the census and counters (from the heat's
  ledger read-back), `stats()` (per pump gene: carriers, battery, voltage, in the light), the PUMPS panel line and the overlay;
  the pumps themselves are planned and applied in `cell_eat.wgsl` (plan, eat; the voltage in stock words 14 and 15), the
  touching neighbour across each side is found in `cell_step.wgsl` (Cell.nbr), the genes and their mutation in `src/genome.js`
  and `cell_common.wgsl` (Bio.pump, mutate), the notches and the voltage's rim in `cell_draw.wgsl`
- `src/catalysts.js`: the catalysts (step C7b): the switches and knobs, the census (from the heat's ledger read-back), the
  CATALYSTS panel line, the overlay and `stats()` (the crusts as patches); crystal seeding itself is in `react` in
  `matter.wgsl` (struct ChemP `cry`), the cofactor in the engine loop of `cell_eat.wgsl` (`cofactor()`, struct EatP `cat`)
- `src/division.js`: division and death with a changing count (step C9): the mode and knobs, the counters (from the cells'
  stats read-back), the DIVISION and COUNT panel lines, the overlay and `stats()` (where the cells are: light, patches); the
  free-slot list is built by the grid (`cell_grid.wgsl`: the dead slots' bucket), the divisions and deaths are in
  `cell_step.wgsl`, the division's cost and the split in `cell_eat.wgsl` (split), the flash and the fading in `cell_draw.wgsl`
- `src/walls.js`: patterned walls (step C10): the switches and knobs, the census (from the cells' stats read-back,
  Stats.wall), the WALLS panel line, the overlay and `stats()` (where on the walls the contacts sit, the glue, the junctions); each
  side's pattern, linker want and upkeep are worked out in `cell_eat.wgsl` (Cell.wadh), the smaller side of each contact, the
  maturation, the front and the inheritance in `cell_step.wgsl`, the side lookup and the genes' drift in `cell_common.wgsl`
  (wall_side, mutate), the lean copy's walls in `cell_grid.wgsl` (scatter, cell_core), the look in `cell_draw.wgsl`;
  `experiments/tissue/c10.py`: the tissue lab's C10 conditions and their analysis. Step C11 adds to the same files: the glue's torque
  and the body's turning, the division by the front and the census of turning and contacts on sticky sides in `cell_step.wgsl`,
  `wall_at` (the glue round the wall) in `cell_common.wgsl`, the free base glue in `cell_eat.wgsl`, the switches, knobs, panel and
  `stats()` (contacts on sticky sides, glued bonds, chains, rings) in `src/walls.js`, the gene `divAxis` in `src/genome.js`;
  `experiments/tissue/c11.py`: the tissue lab's C11 conditions and their analysis
- `src/oil.js`: oils and water (step C12): the switches and knobs (`moire.oil.params`), the oil's words of the matter
  uniform and the fusion's of the chemistry's, the census (from the heat's ledger read-back), the OIL panel line, the
  overlay and `stats()` (droplets, rings, where the soap sits, from the grid); the polarity rule, the new molecules and
  their reactions are in `src/matter.js` (`polarity`, `SUBSTANCES`, `REACTIONS`), the phase separation in `matter.wgsl`
  (`oil_rho`, `oil_blur`, `oil_blur_y`, `oil_edge` in `spread`, the census in `count`), the fusion in `cell_eat.wgsl`, the
  look in `matter_draw.wgsl` (`oil_layer`)
- `src/lipids.js`: lipid membranes (step C12b): the switches and knobs (`moire.lipids.params`, `.look`), the lipid table derived
  from the atoms (`LIPID_TABLE`: head and tail atoms, chain and bond sparks, the bonds' energy, linkers by row), the eat pass's
  words (struct EatP `lp`), the census (from the heat's ledger read-back: LG_LIP_E, LG_LIP_S, LG_LIP_C), the LIPIDS panel line,
  the overlay and `stats()` (per founder lineage, lit and dark); the membrane itself is in `cell_eat.wgsl` (stock words 32..61;
  the bites in `plan`, fusion, the builder, cracks, shedding, the stiffness and the heads' charge in `eat`, the books and the census
  in `ledger`), the corners' stiffness in `cell_step.wgsl` (MB_LIPID), the look in `cell_draw.wgsl` (Draw `lip`, `lip2`, `lipInk`);
  `experiments/tissue/c12b.py`: the lab's conditions; `experiments/conditions/c12b/make.py`: experiments 2 to 4; the supply fix
  (cells graze crust) is in the builder's block of `eat` (LPF_GRAZE; counters LG_LIP_G), its conditions in
  `experiments/conditions/c12b-graze/make.py`
- `src/excited.js`: excited waste (step C12c): the switch and knobs (`moire.excited.params`, `.look`), the chemistry uniform's
  words (struct ChemP `ex`), the census (from the heat's ledger read-back: LG_EXC_N, LG_EXC_E, the dish's and the cells' g*, t*),
  the EXCITED panel line and the overlay. The excited atoms themselves are substances of `src/matter.js` (`ATOMS` g*, t*,
  `EXCITED`: the energy they keep, derived from the uphill swaps' photon surplus; `exOuts` on the light-driven reactions that free
  light atoms), channels 16 and 17 on the grid (`matter.wgsl`: the pool of ground and excited reactants, the fading, the counters;
  `matter_draw.wgsl` `sparkle`) and stock words 28, 29 in the cells (`cell_eat.wgsl`: `cell_ch`, `stock_w`, `xp`, `xtk`; the
  engines, the reactions inside, the fading, the bites); `experiments/conditions/c12c/make.py`: the oxygen conditions on and off
- `src/hardlight.js`: hard light mutates (step C8): the switch and knobs, the census (from the heat's ledger read-back),
  the HARD LIGHT panel line, the overlay and `stats()` (touching neighbours' likeness, light and dark); the dose is kept
  in `cell_eat.wgsl` (Cell.flags bits 19..31, struct EatP `hl`), the mutation at a birth in `cell_step.wgsl` (struct
  Fields `hm`)
- `src/dipole.js`: charge per side, the dipoles (step C6d): the switches and knobs, the census (from the cells' stats
  read-back), `stats()` (threads, with a shuffled control), the DIPOLES panel line and the overlay; the side charges' flow
  and evening out are in `cell_eat.wgsl` (plan, eat), the turning, polarising, push and stretch in `cell_step.wgsl`, the
  lean copy's dipole in `cell_grid.wgsl` (scatter), the look in `cell_draw.wgsl`
- `src/membrane.js`: the membrane chemistry (step C6c): its switches and knobs, the census read-back, `stats()`, the
  MEMBRANE panel line and the overlay; the rules themselves (bites, repair, leak, hold, bursting, selectivity) are in
  `cell_eat.wgsl`, the elasticity and the burst's slot in `cell_step.wgsl`, the look in `cell_draw.wgsl`
- `src/eat.js` + `src/shaders/cell_eat.wgsl`: cells eat (step C5): every cell's stock and battery (their own buffer),
  the membrane, the burner, the reactions inside, deaths and births handing stock back and splitting it, the starter
  charge, the cells' part of the books, the entropy panel's CELLS line; step C6: the engines (pigments, storers, upkeep,
  the tolerance and permeability genes), the pigments' blocks in the heat buffer, the census and the ENGINES and FREE
  LIGHT ATOMS lines; the engine table itself (`ENGINES`) is derived in `src/matter.js` next to the reactions
- `src/cells.js` + `src/shaders/cell_*.wgsl`: the cells. `cell_common.wgsl` holds the cell layout, the per-tick
  uniforms, the grid helpers, the loop's maths (cell beat, membrane, sensing, tuning; prepended after
  field_common) and field B (struct `Fields`, charges, `cell_field_b`); `cell_grid.wgsl` rebuilds the neighbour grid every tick (a counting sort by grid cell) and
  works out every cell's beat; `cell_step.wgsl` moves the cells (step C6c: and their honeycomb outlines); `cell_field.wgsl` scatters the cells' fields
  (A into r, B into g) into their texture; `cell_draw.wgsl` draws them;
  `cell_check.wgsl` is the `?check=1` test; `cell_census.wgsl` counts fates, key bins and founder lines for the overlay,
  and the step 6 counters and histograms
- `src/heat.js` + `src/shaders/heat_common.wgsl`, `heat.wgsl`: the heat band (step C1): the heat grid and its
  spreading, the energy ledger and its read-back, the entropy panel's text. `heat_common.wgsl` (buffer layout, units,
  struct HeatP) is also prepended to every cell shader; the cells' kicks and deposits are in `cell_step.wgsl`
- `src/light.js` + `src/shaders/light_common.wgsl`, `light_draw.wgsl`: the light (step C2): its modes, band table, day
  cycle, clouds and mouse controls, and the uniform shared by the heat passes (`light_common.wgsl` is prepended to
  `heat.wgsl`, whose `absorb()` turns the caught light into heat) and the drawing (outline, marker, tint)
- `src/genome.js`: the genome layout, random founders (step C6: their engine sets, `STRATEGIES`), the rule switches and
  their numbers (`moire.genome`);
  the GPU side (mutation, key likeness, the `Bio` and `Stats` structs) is in `cell_common.wgsl`, the rules
  themselves in `cell_step.wgsl`
- `tools/shot.py`: headless screenshots (below)
- `src/lab.js`: the experiments' helpers on `window.moire` (`sample`, `tissue`, genome edits, views for screenshots, the
  `?snap= ?clone= ?genes=` options); `src/snapshot.js`: save and load the whole state
- `tools/experiment.py`: the headless experiment runner; `tools/summarise.py`: tables and plots of its runs;
  `experiments/conditions/`: condition files; `experiments/runs/`: their numbers (see "Experiments: tools")

## Screenshots without a browser tool

    python tools/shot.py --browser chrome                     # -> shots/shot.png
    python tools/shot.py --headed                             # Firefox; opens a window for a few seconds
    python tools/shot.py --browser chrome --key f --click 400,300 --drag 600,600,1100,450
    python tools/shot.py --query "speed=8&view=1&seed=3" --at 5,30,90,180   # a series in simulation time
    python tools/shot.py --clip 420,250,440,300,2             # only part of the page, enlarged 2x (Chrome)
    python tools/shot.py --dpr 2 --clip 560,330,160,110,5     # the page drawn at 2 device px per CSS px: sharp zooms
    python tools/shot.py --key e --key shift+4                # neon off, then the machinery (Shift + a digit key)
    python tools/shot.py --rdrag 640,400,400,300 --wheel 640,400,600 --wheel 640,400,300,shift   # right-drag, wheel
    python tools/shot.py --mobile                              # a phone: 390x844, 3 device px per CSS px, touch only
    python tools/shot.py --mobile --tapel "[data-action=tool-heavy]" --tap 200,300   # finger taps: a tool, the dish
    python tools/shot.py --mobile --size 844x390 --tapel "[data-panel=light]"        # sideways, light panel open

The tool serves the folder itself, waits in real time until the page has drawn ten frames, then saves the PNG
and prints the overlay text, any on-page message and the console output. `--help` lists all options.
Headless Chrome and Edge render WebGPU; headless Firefox reports no WebGPU adapter, so Firefox needs `--headed`.
`--tapel` taps run before `--tap` taps. Firefox cannot be given a phone-narrow viewport this way (its window does not
go below about 450 px and the resize call then times out): for phone sizes use Chrome's `--mobile`.

## Experiments: tools

Tooling for the experiments phase: run a condition headless at MAX speed, timed by **simulated** time, and keep its
numbers (mainly the entropy), pictures and states. Python standard library only; Chrome (headless) by default.

### Run a condition

    python tools/experiment.py experiments/conditions/default-2min.json
    python tools/experiment.py experiments/conditions/tissue-40.json
    python tools/experiment.py experiments/conditions/batch-example.json           # a batch, once per seed
    python tools/experiment.py cond.json --seeds 3,7,11                            # any condition once per seed
    python tools/experiment.py cond.json --only quick-full --duration 30           # one run of a batch, shorter
    python tools/experiment.py cond.json --browser firefox                         # Firefox (a window opens)

The page opens with `?speed=max&until=0&overlay=ghost&ui=0` plus the condition's URL options, so it waits paused at
t = 0 (after its warm-up; or right after its `?snap=` state has loaded). The runner then walks through the condition's
events in simulated time and pauses **exactly** at each (`moire.control.runUntil(t)`): evals first, then the sample,
screenshots, snapshots, clips. Each run writes `experiments/runs/<name>/` (a rerun replaces it):

- `samples.csv`: one row per sample: `trun` (s since the run's start), `t` (simulation time), `wall`, and every number of
  the entropy panel and of the ledgers and censuses behind it (about 500 columns; list them with
  `python tools/summarise.py <run> --list`). The main ones: `heat.out` (ENTROPY: all heat that left the dish),
  `heat.rate.out` (its rate), `heat.heat` (heat in the dish), `heat.moving`, `heat.chem` (stored), `heat.in`,
  `heat.rounding` (energy), `matter.order` (ORDER), `matter.rounding` and `charge.qRound` (atoms and charge: always 0),
  `alive`, `cells.bat` (batteries), `engines.all.<k>.n` (cells per strategy: 0 harvest, 1 burn, 2 both, 3 other),
  `engines.free.g` and `.t` (free light atoms), `dish.<substance>`, `inside.<substance>`, `charge.*`, `membrane.*`,
  `dipole.*`, `pumps.*`, `catalysts.*`, `hardlight.*`, `division.rate.births`, `division.deaths`,
  `division.rate.starved` (and `.heat`, `.burst`, `.age`), `motion.*`; with `"tissue": true` also `tissue.*` (below)
- `panel.txt`: the entropy panel's text at every sample; `meta.json`: the exact URL, the condition, the git commit (and
  whether the tree had changes), browser and version, adapter, wall time, simulated time, the speed reached (simulated s
  per wall s while running), status and error, console errors, eval results; `console.log`: the page's console
- `shots/*.png`, `clips/*.webm`, `snapshots/*.json`

A run that hangs (simulation time stuck for `stall` wall seconds, default 60), whose page shows its error box, throws,
or whose eval fails is recorded as **failed** (status and error in `meta.json`, the console in `console.log`) and the
batch goes on (`--strict`: console errors fail a run too). Each run gets its own browser, closed at its end.

A condition file (every key but `name` optional; the comments in brackets are not part of the JSON):

    {
      "name": "tissue-40",
      "description": "40 cells, one genome cloned, no evolution; a stir at 40 s",
      "query": {"seed": 3, "cells": 40, "mut": 0, "life": 0, "clone": 1, "genes": "adhesion:0.9,motility:0.6"},
      "size": "1280x800",
      "duration": 60,                     (simulated s from the start)
      "sample_every": 5,                  (simulated s; 0: only at the start and the end)
      "tissue": true,                     (sample moire.tissue.stats() too)
      "evals": [{"t": 0, "js": "moire.cells.params.stiffness = 9"},
                {"t": 40, "js": "await moire.tissue.stir(560, 400, 14, 0, 12)"}],
      "shots": [{"t": 0}, {"t": 60, "view": "lineage", "panel": true, "name": "end"}],
      "clips": [{"t": 10, "until": 20, "speed": 8}],
      "snapshots": [{"t": 60, "grid": false}],
      "resizes": [{"t": 30, "size": "1000x700"}],   (step C10: the window resized, Chrome only, before the evals at that time)
      "stall": 60, "timeout": 0
    }

- `query`: URL options (README "Controls" and the steps' sections). All times are run times (s since the start).
- `evals`: statements run in the page (`await` allowed; a `return` value is kept in `meta.json`). If an eval moves the
  clock (e.g. `moire.loadSnapshot`), the run's timeline moves with it; a stir moves it by a fraction of a second.
- `shots`: `view` is `clean` (default: colour by fate, no machinery), `fate`, `lineage`, `strategy`, `charge`, `walls` (step C10) or
  `machinery`; the panels are hidden unless `"panel": true`.
- `clips`: a .webm of the dish from `t` to `until`, recorded while it runs at `speed` (default 8); events inside that span
  happen at its end; at least 2 s of real time is recorded (shorter recordings can come out empty).
- `snapshots`: `moire.snapshot()` saved as JSON (`"grid": false`: cells and settings only, much smaller).

A batch file: `{"batch": "name", "seeds": [3, 7], "runs": ["quick.json", {an inline condition}, ...]}` (file names
relative to the batch file); with seeds (or `--seeds`) every run goes once per seed, named `<name>_s<seed>`.

### Summarise

    python tools/summarise.py experiments/runs/default-2min experiments/runs/snap-b --times 0,60,120 \
        --cols alive,heat.out,heat.rate.out,matter.order --plot heat.rate.out,alive,matter.order \
        --out experiments/summaries/smoke

prints a markdown table (one row per run, each column at each time: the sample nearest it) and, with `--out`, writes
`summary.md` and one SVG plot per `--plot` column (every run a line, at most 8; a legend, labels at the line ends, a
tooltip on every point, a dark version for a dark screen). matplotlib is not used (it is not installed here).

### Snapshots: save and load the whole state

- `await moire.snapshot({ grid })` returns the whole state as JSON: every switch and knob, the live cells' raw records
  (Cell: position, velocity, radius, lattice angle, shape, outline corners, orientation, membrane integrity, side
  charges, neighbours, voltage; Bio: genome and its state; stock: substances, battery, membrane, pumped charge), the
  cells' Stats buffer (counters), the springs, the ledgers' running totals, the simulation time and tick, and with
  `grid` (the default) the substrate grid (heat, the 13 substances, the charge field) as whole counts. Arrays are gzipped
  base64: about 1.1 MB for 2000 cells with the grid at 1280 x 800, a few kB for 40 cells without it. `measures` inside it
  is a `moire.sample()` of that moment.
- `await moire.loadSnapshot(obj)` puts it back; `?snap=experiments/runs/x/snapshots/snap_t60.json` loads a file of the site
  at the start (its starting number and capacity size the page; its settings replace the page's: change knobs afterwards
  with evals). The rules panel's last group, **Save and load the state**, has the same as two buttons (a file download
  and a file picker; also `moire.snapshotDownload()`, `moire.snapshotUpload()`).
- **Exactness and the books.** Both happen while paused, after every read-back in flight has come home and one extra
  ledger pass at the frozen state, so the running totals belong to exactly that state. On load the buffers are written,
  the totals are **set** to the snapshot's (entropy = heat out, light in, warmth, atoms added / lost / gone, the cells'
  counters, the starter charges), and every rate history starts again. In a window of the same size with the same
  starting number (what `?snap=` gives) the load is exact: checked here, a snapshot taken right after loading is
  bit-identical (cells, genomes, stocks, stats, grid, books) to the one loaded, in Chrome and in Firefox and across the
  two, and the atoms' and charge's rounding stay 0 while it runs on; the energy's rounding keeps its value. Into another
  window size or starting number the load is a best effort: the cells move with the dish's centre, the page's own grid
  stays where the sizes differ, and the books are **re-based** (the atoms' difference per substance booked as added, the
  energy's as warmth), so all three rounding lines start again from 0; the result says so (`exact: false`, `notes`,
  `rebased`). Running on is not bit-deterministic (the GPU passes' per-frame random seeds are not part of the state).

### Tissues: few cells, no evolution, measures

- Setting up: `?cells=40&mut=0&life=0&clone=1` (mutation off; life cycle off: nobody is born or dies; every cell gets
  the first live cell's genes) and `?genes=adhesion:0.9,size:1,motility:0.5` (genes for every cell). From the console:
  `await moire.genome.cloneAll(i)`, `await moire.genome.setAll('stiffness', 1.5)` or `setAll({ mix: 0.8, thickness: 0.03 })`,
  `await moire.genome.get(i)`. Gene names (`moire.genome.GENES`): `keyAngle keyScale recAngle recScale recWidth threshold
  output founder resp0..3 relay0..3 adhesion size motility eng0..2 tolerance rate0..2 permeability mix thickness
  stiffness selectivity pump0 pump1 pumpRate0 pumpRate1`, and since step C10 `a0` (= adhesion) `a1 a2 w` (the walls); engine and pump slot codes from
  `moire.genome.engineCode('gt → g + t', band)` and `moire.genome.pumpCode('g', 'out')`. `?founders=1` (one founder
  genome) also gives a single genome, from birth.
- `await moire.tissue.stats()`: touching pairs (closer than the genome's contact reach, 1.15 x the sum of the radii),
  `clusters` (groups of 2 or more), `clusters3`, `isolated`, `largest`, `inLargest`, `sizes` (the 10 largest),
  `contacts` (per cell), `compactLargest` and `compactMean` (cell area over a round blob of the same spread: about 0.9 for
  a packed disc, above 1 where cells overlap, about 1.5 / n for a chain of n), `rgLargest` (its spread, in R); and against
  the previous call: `persistence` (share of the touching pairs then that still touch), `gained` and `lost` (pairs per s),
  `ageMean` and `ageMedian` (how long the touching pairs have touched, s, counted from the first call), `move` (R per s),
  `internal` (the largest cluster's cells moving against each other, R per s, its drift taken out), `shape` (corner
  radii change, share of the radius per s), `turn` (degrees per s). `await moire.tissue.stir(x, y, dx, dy, frames)`: a
  mouse stir (run at 1x, then the speed and the pause are put back), for "does it survive a stir".
- In a condition, `"tissue": true` samples them as `tissue.*`.

### What is kept in git

`experiments/conditions/`, each run's `samples.csv`, `meta.json` and `console.log`, and `experiments/summaries/`
(markdown and SVG) are committed. Screenshots (`shots/` folders, ignored everywhere), clips (`*.webm`), snapshots and
`panel.txt` are ignored; pictures and states worth keeping go into `experiments/keep/` by hand (committed: keep it small,
the repository is public).

### Smoke tests (2026-11-15, GTX 1650, headless Chrome 157 unless said)

- `default-2min` (2000 cells, seed 3, 120 s at x11.8): CSV, panel, 4 shots, a snapshot of 1.1 MB. The count falls from
  1984 to about 810 (the dark clears out, as in step C9; two runs gave 809 and 813: not bit-deterministic), the entropy rate from 16 k/s to 7 k/s; atoms and charge rounding 0
  all the way. Table and plots: `experiments/summaries/smoke/` and `experiments/summaries/tissue-smoke/`.
- `tissue-40` (40 cells, one genome, no evolution, adhesion 0.9, motility 0.6, 60 s at x23 to x27): one cluster of all 40 the
  whole time, about 8 contacts per cell (packed and overlapping: compactness about 2), persistence 0.93 to 0.99 per 5 s,
  the contacts' age growing with the run; the stir at 40 s doubles `move` for a moment, the cluster stays whole.
- `snap-a`, then `snap-b`: a snapshot at 30 s, loaded into a new page and saved again at once: bit-identical; 60 s more
  with atoms and charge rounding 0. The same in Firefox, loading Chrome's file. `tissue-reload`: tissue-40's cells-only
  snapshot (a best-effort load: books re-based, rounding 0).
- Batches with seeds; a run whose eval throws and one that hangs (both recorded as failed, the batch went on); a .webm
  clip; a load into another window size and starting number; the phone layout (the new group sits at the end of the
  rules panel). Console clean in Chrome and Firefox (only Chrome's usual powerPreference warning).

Known issues: ORDER is blank (`matter.order` missing) in the very first sample of a run (no tick has run yet, so the
substances' parameters are not on the GPU yet); the entropy rate is 0 there too (its window needs two read-backs).
Starting a page takes about 15 s of wall time in headless Chrome.
