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
  move light (the ellipse): a tap or drag puts the spotlight there (and switches the light to spotlight).
  With a mouse, as before: right-drag moves the spotlight, the wheel tilts it, Shift+wheel turns it.
- **Pause / play** (Space) · **speed** (keys [ ]; a tap goes to the next speed, after MAX back to 1×) ·
  **record** (Shift+V, see below).
- **Panels** (one open at a time; tap the button again, the ×, or Escape to close):
  - *light* (the sun): spotlight / full field / off, sliders for the tilt and the direction the light comes from,
    day and night;
  - *view* (the eye): the entropy panel, the stats overlay (F), the landscape, which substance is shown, colour by
    fate or lineage, and the other drawing switches;
  - *rules*: every rule that has a key, as a switch with a one-line explanation and its key, grouped as below
    (the loop, field B, steps 6 to 8, biology, heat and light); settings with several values show the current one
    and change on a tap; the lever has - and +. The switches follow the state, also when a key changes it;
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
- URL options: `?speed=32` or `?speed=max`, `?paused=1` (start paused), `?ui=0` (start with the toolbar folded).

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
- **T**: turnover on/off (cells die now and then and a neighbour divides into the gap)
- **M**: mutation on/off (off: daughters are exact copies of their parent)
- (**E** is free: it switched rule E, nutrient and threat, which went with the sources in step C3)
- **I**: daughters inherit their parent's fate on/off (default off: they start as stem cells)
- **V**: colour by fate or by lineage (the key's hue)
- **[** / **]**: simulation speed 1× / 2× / 4× / 8× / 16× / 32× / MAX (step C3b: the last three are the timelapse)
- Part C keys are **Shift + a letter** (step C1: Shift+H heat jitter, Shift+E entropy panel, Shift+R ripples simmer;
  see "Heat and the entropy counter" below; step C2: Shift+L light spot / full field / off, Shift+D day and night;
  step C3: Shift+S substances shown (summary / each alone / off), Shift+C wash the atoms out)
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
would not fit (about 2.9 px at 10 000 and 1.3 px at 50 000 on a 1280 × 800 window).

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
  A touching neighbour, picked at random, divides into its place; the daughter starts small and grows.
  The genome is double-buffered on the GPU, so the daughter copies its parent's genome from last tick.
- **M, mutation**: every gene of a daughter is nudged a little (key angle by about 2°), and with chance 3 %
  one gene is drawn afresh.
- *(gone in step C3)* **E, nutrient and threat**: each cell felt the sources' beat at its centre (the same maths as the
  halftone dots, positive part). Threat raised the death rate (× 1 + 6 × threat), and a cell killed by
  threat was refilled far away instead of from next door. 30 % of all births went to a well-fed cell anywhere in
  the dish. Growth by energy (step C5) is to take its place.
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
`?hour=`, `?clouds=0` (step C2, see "Light"), `?show=summary|off|<substance>` (step C3, e.g. `?show=G`).
In the browser console, `moire.background.params`, `moire.landscape.params`, `moire.medium.params`, `moire.heat.params`, `moire.light.params`, `moire.matter.params`,
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
  one drawn: cells are drawn as ellipses with their dots on it.
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

**Drawing** (the user's look: crisp halftone dots, flat colour, no glow). The dot screen is the medium's own lattice,
every 2 lattice spacings (about 13 px). A triangular lattice has three interleaved sets of points (the points and the
centres of its two kinds of triangle), and each carries one layer, so layers never sit on each other:
- **free atoms** on the lattice points: one dot for all of them, its area c / (c + 0.6 per R²); its ink by chemical
  function, mixed by what is there: the reactive atoms (givers g G and takers t T, hungry for a partner) in the old
  threat red, faded; linkers (l L) a dim, quiet grey-blue; lighter for row 1, deeper for row 2;
- **fuels** on one set of triangle centres, in the old nutrient green (C4 on);
- **trace** on the other set, as small pale silver diamonds;
- **sediment** not as dots but a flat, dim brown-grey layer in three crisp levels, under the dots (C4 on).

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

## The look of the landscape

The landscape is drawn as crisp halftone dots, like print: a dot screen lies over the dish, each dot reads what it
shows at its own centre, and its area grows with the amount (flat colour, no glow; too little draws no dot).
- The cells' fields (steps 4 to 8): field A in pale dots on a triangular screen turned 15°, field B as blue rings on
  one turned 45°, the partner A' in yellow dots at 75° (the separate colour screens of print). Knobs in
  `moire.landscape.params`: `pitch` (6 CSS px), `hex`, `angle`, `threshold` (0.12), `maxDot` (0.9), `cellGain`,
  `cellColour`, `cellLevel`, the `b...` and `p...` knobs for B and A'.
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
  the loop runs every layer's compute passes, then draws all layers into one render pass
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
  the atoms ledger and ORDER, and the halftone drawing on the medium lattice
- `src/cells.js` + `src/shaders/cell_*.wgsl`: the cells. `cell_common.wgsl` holds the cell layout, the per-tick
  uniforms, the grid helpers, the loop's maths (cell beat, membrane, sensing, tuning; prepended after
  field_common) and field B (struct `Fields`, charges, `cell_field_b`); `cell_grid.wgsl` rebuilds the neighbour grid every tick (a counting sort by grid cell) and
  works out every cell's beat; `cell_step.wgsl` moves the cells; `cell_field.wgsl` scatters the cells' fields
  (A into r, B into g) into their texture; `cell_draw.wgsl` draws them;
  `cell_check.wgsl` is the `?check=1` test; `cell_census.wgsl` counts fates, key bins and founder lines for the overlay,
  and the step 6 counters and histograms
- `src/heat.js` + `src/shaders/heat_common.wgsl`, `heat.wgsl`: the heat band (step C1): the heat grid and its
  spreading, the energy ledger and its read-back, the entropy panel's text. `heat_common.wgsl` (buffer layout, units,
  struct HeatP) is also prepended to every cell shader; the cells' kicks and deposits are in `cell_step.wgsl`
- `src/light.js` + `src/shaders/light_common.wgsl`, `light_draw.wgsl`: the light (step C2): its modes, band table, day
  cycle, clouds and mouse controls, and the uniform shared by the heat passes (`light_common.wgsl` is prepended to
  `heat.wgsl`, whose `absorb()` turns the caught light into heat) and the drawing (outline, marker, tint)
- `src/genome.js`: the genome layout, random founders, the rule switches and their numbers (`moire.genome`);
  the GPU side (mutation, key likeness, the `Bio` and `Stats` structs) is in `cell_common.wgsl`, the rules
  themselves in `cell_step.wgsl`
- `tools/shot.py`: headless screenshots (below)

## Screenshots without a browser tool

    python tools/shot.py --browser chrome                     # -> shots/shot.png
    python tools/shot.py --headed                             # Firefox; opens a window for a few seconds
    python tools/shot.py --browser chrome --key f --click 400,300 --drag 600,600,1100,450
    python tools/shot.py --query "speed=8&view=1&seed=3" --at 5,30,90,180   # a series in simulation time
    python tools/shot.py --clip 420,250,440,300,2             # only part of the page, enlarged 2x (Chrome)
    python tools/shot.py --dpr 2 --clip 560,330,160,110,5     # the page drawn at 2 device px per CSS px: sharp zooms
    python tools/shot.py --rdrag 640,400,400,300 --wheel 640,400,600 --wheel 640,400,300,shift   # right-drag, wheel
    python tools/shot.py --mobile                              # a phone: 390x844, 3 device px per CSS px, touch only
    python tools/shot.py --mobile --tapel "[data-action=tool-heavy]" --tap 200,300   # finger taps: a tool, the dish
    python tools/shot.py --mobile --size 844x390 --tapel "[data-panel=light]"        # sideways, light panel open

The tool serves the folder itself, waits in real time until the page has drawn ten frames, then saves the PNG
and prints the overlay text, any on-page message and the console output. `--help` lists all options.
Headless Chrome and Edge render WebGPU; headless Firefox reports no WebGPU adapter, so Firefox needs `--headed`.
`--tapel` taps run before `--tap` taps. Firefox cannot be given a phone-narrow viewport this way (its window does not
go below about 450 px and the resize call then times out): for phone sizes use Chrome's `--mobile`.
