# Moiré cells

A toy simulation made for beauty: cells moving through a "chemical" landscape made of moiré beats between
lattices. This is the WebGPU version (work in progress). The original CPU version is
`reference/neon_organoid_cpu.html`. See `CLAUDE.md` for the plan.

## Run it

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

## Keys and mouse

- click: drop what the tap mode says · drag: stir (ripples, and cells near the pointer are pushed along)
- **1** / **2** / **3**: tap mode: ripple / nutrient source / threat source (the hint line shows the mode)
- **C**: clear all sources
- **L**: landscape dots on/off (the sources' ring markers stay)
- **F**: frame time and adapter overlay
- **?**: the hint line shows all keys / only the main ones
- **A**: ambient ripples on/off (random drops standing in for the cells' divisions and deaths)
- **N**: new culture (a fresh blob of stem cells at the centre, the same founder genomes)
- **G**: new culture with fresh random founder genomes
- **P**: contact push on/off (without it, cells slide over each other and the centre pull heaps them up)
- **D**: differentiation on/off (off: every cell goes back to stem and stays there)
- **H**: adhesion on/off (like sticks to like)
- **B**: body traits on/off (size, motility and crawling from the genome and the fate; off: all alike, no crawling)
- **T**: turnover on/off (cells die now and then and a neighbour divides into the gap)
- **M**: mutation on/off (off: daughters are exact copies of their parent)
- **E**: nutrient and threat biology on/off (off: the sources no longer steer turnover; the cells still feel
  their field through the loop, key S)
- **I**: daughters inherit their parent's fate on/off (default off: they start as stem cells)
- **V**: colour by fate or by lineage (the key's hue)
- **[** / **]**: simulation speed 1× / 2× / 4× / 8×

The loop (step 4):
- **S**: field sensing on/off (the force from the field felt on the membrane)
- **O**: cells emit on/off (off: only the sources make a field)
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

A fresh load starts with the reference's sources: two nutrient (green), one threat (red). At most 6 sources,
as in the reference; one more replaces the oldest (`moire.landscape.params.maxSources`, up to 64).
Sources do not drift, fade or get eaten yet.

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
slowly drifts. With nutrient and threat on, the tissue drains away from a threat source and grows towards
nutrient.

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
  heading, and the nutrient and threat the cell felt last tick.

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
- **E, nutrient and threat**: each cell feels the sources' beat at its centre (the same maths as the
  halftone dots, positive part). Threat raises the death rate (× 1 + 6 × threat), and a cell killed by
  threat is refilled far away instead of from next door. 30 % of all births go to a well-fed cell anywhere in
  the dish (if one is found in 16 random tries).
- **I, inherit**: daughters take their parent's fate and counters instead of starting as stem cells.
  Off by default (in the one run compared, seed 3, it gave larger, bolder epithelium areas).

Births and deaths drop small ripples into the background (`moire.genome.params.ripple`, 0 = none).
The F overlay shows cells per fate, founder lines still alive, "key clusters" (key-space bins, 24 angles ×
6 periods, holding at least 0.25 % of the cells: a rough count of distinct lineages), births and deaths per
second (simulation time), and which rules are on. The counts are read back from the GPU a few times a
second without waiting for it.

Live-tunable in the console: `moire.genome.params` (founders, tau, release, reach, adhesion, adhSigma,
fateAdh, adhBase, crawl, turnRate, turnover, unhappy, mutSize, mutJump, nutFar, thrKill, beatMix, ripple)
and `moire.genome.rules` (the switches above). `founders` is the number of founder genomes at a fresh start
(12; 0 = every cell its own random genome, which gives more fates at first and lineages dying out fast).

URL options: `?overlay=1` (overlay from the start; `?overlay=ghost` keeps it up to date but invisible, so
`tools/shot.py` can print it without it covering the shot), `?bio=0` (start with D H B T M E off: the loop alone), `?ripple=1` (a ripple every 0.7 s),
`?debug=1` (console warnings into the overlay), `?nogpu=1` (show the no-WebGPU message),
`?cells=N` (number of cells, default 2000), `?check=1` (every 2 s, count the cells' contacts through the
neighbour grid and by brute force, and check the sort; result in the console and the overlay),
`?seed=N` (repeatable start: positions, genomes; the run itself drifts apart after a while, because the
GPU's neighbour order varies), `?speed=1|2|4|8`, `?founders=N`, `?view=1` (lineage colours).
In the browser console, `moire.background.params`, `moire.landscape.params`, `moire.medium.params`,
`moire.cells.params` (physics), `moire.cells.look` (drawing) and `moire.genome.params` / `.rules` hold
live-tunable numbers.

## The loop (step 4)

Every cell is an emitter: its lattice (its key, its fate's period, and its stretch) beats against the
medium's lattice, and that beat, times a power-law envelope (range r0 = 2.2 R), is its field. Every cell feels
the field of its neighbours (within 3.6 R, found through the grid) and of the sources on its membrane, moves
along it, and is stretched by it, which changes its lattice, which changes what it emits and feels: the loop.
Ported from the reference, with the changes marked:
- **Membrane sensing**: 6 straight segments of the stretched outline; the field is averaged exactly along each
  (cos at the midpoint × sinc of half the phase change). Force = Σ segment × outward normal (area × gradient),
  × 1.3 R / r, saturating (tanh) at 3 R/s. Weights: the reference's sign table (fate × emitter kind: like fates
  attract, unlike repel a little, nutrient attracts, threat repels) × tuning (a Gaussian in the difference
  between the two strained lattices) × a smooth taper near 3.6 R (new; the reference cut off hard).
  New: the cells' part has a gain of 10 (`sense`; the reference's 1 is too weak to matter against the contact
  push at 2000 cells), the sources keep 1 (`senseSrc`); the tuning width is 0.5 (`tuneW`; reference 0.177,
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

Live-tunable in `moire.cells.params`: `sense`, `senseSrc`, `senseMax`, `tuneW`, `lever`, `anchor` (0 sliding,
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

## The look of the landscape

The sources' landscape is drawn as crisp halftone dots, like print: a triangular dot screen lies over the
dish, each dot reads the field at its own centre, and its area grows with the field strength (flat colour,
no glow; a weak field draws no dot). The beat's hex blobs therefore show as rosettes of bigger dots.
Where nutrient and threat overlap, the stronger one takes the dot. The ring markers are a clean stroke and
a centre dot; dots under them are left out. Knobs in `moire.landscape.params`: `pitch` (6 CSS px between
dots), `hex` (false = square screen), `angle` (screen turned 15°), `threshold` (0.12), `maxDot` (0.9 of
half the pitch), `base` (0; the reference's glow used 0.3, which fills the troughs near a source with small
dots), `dotLevel` (0.55, dot brightness), `nutColour` / `thrColour` (palette), `ringW`, `markers`, `gain`.
The background ripples stay soft on purpose.

## Files

- `index.html`: page, styles, safety-net message if the scripts do not start
- `src/main.js`: boot, frame loop, input, overlay. Layers are classes with `resize`, `compute`, `render`;
  the loop runs every layer's compute passes, then draws all layers into one render pass
- `src/gpu.js`: adapter/device setup, fallback and error messages, shader loading with readable errors
- `src/background.js` + `src/shaders/ripple_*.wgsl`, `background_draw.wgsl`: the viscous background
- `src/shaders/field_common.wgsl`: the field's maths (lattices, beat against the medium, envelope), shared by
  every shader that draws or senses the field; `src/field.js` prepends it (`loadFieldShader`) and owns the
  medium's breathing lattice (`Medium`, a layer that runs first)
- `src/landscape.js` + `src/shaders/field_prep.wgsl`, `landscape_draw.wgsl`: the sources, their per-frame beat
  prep, and the green / red halftone landscape with ring markers
- `src/cells.js` + `src/shaders/cell_*.wgsl`: the cells. `cell_common.wgsl` holds the cell layout, the per-tick
  uniforms, the grid helpers, the loop's maths (cell beat, membrane, sensing, tuning; prepended after
  field_common) and field B (struct `Fields`, charges, `cell_field_b`); `cell_grid.wgsl` rebuilds the neighbour grid every tick (a counting sort by grid cell) and
  works out every cell's beat; `cell_step.wgsl` moves the cells; `cell_field.wgsl` scatters the cells' fields
  (A into r, B into g) into their texture; `cell_draw.wgsl` draws them;
  `cell_check.wgsl` is the `?check=1` test; `cell_census.wgsl` counts fates, key bins and founder lines for the overlay
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

The tool serves the folder itself, waits in real time until the page has drawn ten frames, then saves the PNG
and prints the overlay text, any on-page message and the console output. `--help` lists all options.
Headless Chrome and Edge render WebGPU; headless Firefox reports no WebGPU adapter, so Firefox needs `--headed`.
