# Moiré cells

A toy simulation made for beauty: cells moving through a "chemical" landscape made of moiré beats between
lattices. This is the WebGPU version (work in progress). The original CPU version is
`reference/neon_organoid_cpu.html`. See `CLAUDE.md` for the plan.

## Run it

WebGPU needs a page served over http(s), not opened as a file. In the project folder:

    python -m http.server

then open http://localhost:8000 in **Firefox** (141 or newer on Windows), **Chrome** or **Edge**.

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
- **A**: ambient ripples on/off (random drops standing in for the cells' divisions and deaths)
- **N**: new culture (a fresh blob of stem cells at the centre, the same founder genomes)
- **G**: new culture with fresh random founder genomes
- **P**: contact push on/off (without it, cells slide over each other and the centre pull heaps them up)
- **D**: differentiation on/off (off: every cell goes back to stem and stays there)
- **H**: adhesion on/off (like sticks to like)
- **B**: body traits on/off (size, motility and crawling from the genome and the fate; off: all alike, no crawling)
- **T**: turnover on/off (cells die now and then and a neighbour divides into the gap)
- **M**: mutation on/off (off: daughters are exact copies of their parent)
- **E**: nutrient and threat on/off (off: the cells ignore the sources)
- **I**: daughters inherit their parent's fate on/off (default off: they start as stem cells)
- **V**: colour by fate or by lineage (the key's hue)
- **[** / **]**: simulation speed 1× / 2× / 4× / 8×

A fresh load starts with the reference's sources: two nutrient (green), one threat (red). At most 6 sources,
as in the reference; one more replaces the oldest (`moire.landscape.params.maxSources`, up to 64).
Sources do not drift, fade or get eaten yet.

Cells (step 3): a fixed number of cells, 2000 by default, starting as a packed blob of stem cells. They push
each other apart where they overlap, drift slowly, jitter a little and stay off the dish edge. They do not
sense the field yet (step 4). Their radius is the reference's R (5 to 9 px), smaller when that many cells
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

URL options: `?overlay=1` (overlay from the start), `?ripple=1` (a ripple every 0.7 s),
`?debug=1` (console warnings into the overlay), `?nogpu=1` (show the no-WebGPU message),
`?cells=N` (number of cells, default 2000), `?check=1` (every 2 s, count the cells' contacts through the
neighbour grid and by brute force, and check the sort; result in the console and the overlay),
`?seed=N` (repeatable start: positions, genomes; the run itself drifts apart after a while, because the
GPU's neighbour order varies), `?speed=1|2|4|8`, `?founders=N`, `?view=1` (lineage colours).
In the browser console, `moire.background.params`, `moire.landscape.params`, `moire.medium.params`,
`moire.cells.params` (physics), `moire.cells.look` (drawing) and `moire.genome.params` / `.rules` hold
live-tunable numbers.

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
  uniforms and the grid helpers (prepended after field_common); `cell_grid.wgsl` rebuilds the neighbour grid
  every tick (a counting sort by grid cell); `cell_step.wgsl` moves the cells; `cell_draw.wgsl` draws them;
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
