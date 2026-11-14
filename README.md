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
- **L**: landscape glow on/off (the sources' ring markers stay)
- **F**: frame time and adapter overlay
- **A**: ambient ripples on/off (random drops standing in for the cells' divisions and deaths)
- **N**: new culture (a fresh blob of stem cells at the centre)
- **P**: contact push on/off (without it, cells slide over each other and the centre pull heaps them up)

A fresh load starts with the reference's sources: two nutrient (green), one threat (red). At most 6 sources,
as in the reference; one more replaces the oldest (`moire.landscape.params.maxSources`, up to 64).
Sources do not drift, fade or get eaten yet.

Cells (step 3): a fixed number of stem cells, 2000 by default, in a packed blob. For now they only push each
other apart where they overlap, drift slowly, jitter a little and stay off the dish edge; they do not sense
the field, divide or specialise yet. Their radius is the reference's R (5 to 9 px), smaller when that many
cells would not fit (about 2.9 px at 10 000 and 1.3 px at 50 000 on a 1280 × 800 window).

URL options: `?overlay=1` (overlay from the start), `?ripple=1` (a ripple every 0.7 s),
`?debug=1` (console warnings into the overlay), `?nogpu=1` (show the no-WebGPU message),
`?cells=N` (number of cells, default 2000), `?check=1` (every 2 s, count the cells' contacts through the
neighbour grid and by brute force, and check the sort; result in the console and the overlay).
In the browser console, `moire.background.params`, `moire.landscape.params`, `moire.medium.params`,
`moire.cells.params` (physics) and `moire.cells.look` (drawing) hold live-tunable numbers.

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
  prep, and the per-pixel green / red landscape with ring markers
- `src/cells.js` + `src/shaders/cell_*.wgsl`: the cells. `cell_common.wgsl` holds the cell layout, the per-tick
  uniforms and the grid helpers (prepended after field_common); `cell_grid.wgsl` rebuilds the neighbour grid
  every tick (a counting sort by grid cell); `cell_step.wgsl` moves the cells; `cell_draw.wgsl` draws them;
  `cell_check.wgsl` is the `?check=1` test
- `tools/shot.py`: headless screenshots (below)

## Screenshots without a browser tool

    python tools/shot.py --browser chrome                     # -> shots/shot.png
    python tools/shot.py --headed                             # Firefox; opens a window for a few seconds
    python tools/shot.py --browser chrome --key f --click 400,300 --drag 600,600,1100,450

The tool serves the folder itself, waits in real time until the page has drawn ten frames, then saves the PNG
and prints the overlay text, any on-page message and the console output. `--help` lists all options.
Headless Chrome and Edge render WebGPU; headless Firefox reports no WebGPU adapter, so Firefox needs `--headed`.
