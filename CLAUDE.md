# Moiré cells

A toy simulation, made for beauty and fun: stem cells divide, specialise and form tissues while moving through
a "chemical" landscape made of moiré beats between lattices. It is NOT an experiment and not a biological model.
No benchmarks, no rivals, no claims. Judge changes by how they look and feel.

Started 2026-11-14, spun out of the `moire-experiment` project (sibling folder; closed, do not load it for context).

## The user
- Visual thinker: explain with what it looks like, in plain language; define technical terms.
- Works with microscopes by trade (hence the fluorescence-channel legend, scale bar, marker names).
- Not an ML or graphics specialist. They test by watching; ask what they see.

## The look (the user's words)
Faded neon colours on black. A fluid background that feels viscous, with subtle ripples.
Current palette: stem warm white, epithelium cyan, muscle pink, neuron violet, cartilage amber,
nutrient green, threat red. Keep it soft; avoid saturated or busy.

## Files
- `reference/neon_organoid_cpu.html` — the working CPU version (single file, Canvas 2D, about 520 cells).
  It is the reference for the rules. Open it in a browser to see the intended behaviour.
  Also published at https://claude.ai/artifact/ByKBbzmVQTh8MpmKzbg3rT (private to the user).

## The rules as they stand (all in the reference file)
Lattices:
- Every emitter (cell, nutrient source, threat source) carries a hex lattice: 3 wavevectors 60° apart,
  an angle `la`, and a period set by its kind (`PER`).
- The medium has its own lattice, anchored at the dish centre, breathing by about 1°.
- An emitter's chemical field = the beat of its lattice against the medium's:
  amp · envelope(r) · Σ cos(q_m·(x − centre) + phase_m), with q = k_emitter − k_medium.
  Envelope is a power law, 1 / (1 + r²/r0²).
- LESSON: anchoring the sensing lattice to the moving cell itself does not work. The beat then slides several
  times faster than the cell moves (the moiré lever), so cells get pinned within a few pixels. Beating against
  a shared medium lattice keeps the landscape stable in the world.

Sensing and motion:
- Nothing is simulated per pixel. A cell's membrane is 6 straight segments; the field is integrated exactly
  along each (closed form: cos at the midpoint × sinc of half the phase change).
- Force = Σ (segment integral × outward normal), which equals area × gradient; then a saturating (tanh) response.
- Receptor tuning: a cell feels an emitter in proportion to how alike their lattices are (Gaussian in the
  wavevector difference). `EMW` holds the sign and strength per cell type and emitter kind.

Deformation:
- Cell shape = area-preserving stretch (traceless tensor e1, e2, capped at 0.5).
- Passive: contact squeezes along the contact axis. Active: stretch along own motion and toward the landscape's
  pull (quadrupole of the membrane signal). Muscle has a built-in stretch.
- Stretching the cell squeezes its lattice the other way (k = F⁻¹·k0), which changes both the field it
  projects and what it can sense.

Biology (toy):
- Division held back by crowding, sped up by nutrient. Slow turnover.
- Fate choice from neighbours: surface → epithelium; muscle and cartilage recruit neighbours; neurons inhibit
  neurons nearby; a busy, uneven field on the membrane holds a stem cell back; threat pushes toward epithelium.
- Like sticks to like (contact adhesion matrix `J`). Committed cells untwist their lattice toward same-type neighbours.
- Nutrient attracts and is eaten; threat repels, kills what it reaches, and fades.

Background: a damped slow wave field (ripples from divisions, deaths, stirring) plus a drifting sheen, drawn at
coarse resolution; the sources' landscape is added as a green/red glow.

## Next step: local desktop app, Vulkan-powered (user decision 2026-11-14)
The user wants the engine on the GPU, as a desktop window on this machine, running on Vulkan. Not a browser page.
The CPU version spends about 13 ms per frame on simulation alone at 520 cells, so it cannot grow.

Machine (checked 2026-11-14): Windows 11, GTX 1650 (4 GB), Python 3.13 installed. No Rust, no CMake, no
Vulkan SDK on the PATH (`vulkaninfo` not found; the NVIDIA driver itself should still provide Vulkan — verify first).

Proposed stack (a proposal, not yet confirmed by the user or tried here):
- Python + `wgpu` (wgpu-py, bindings to wgpu-native) with the backend forced to Vulkan, in a desktop window
  (glfw or rendercanvas). Shaders in WGSL, including compute shaders for the simulation.
- Why: nothing to compile, Python is already installed, shader edits reload fast, and the rules can be ported
  from the reference file almost line by line. It runs on Vulkan without hand-writing Vulkan.
- Alternatives if the user wants "real" Vulkan: Rust + wgpu (same shaders, needs the Rust toolchain), or
  C++ with the Vulkan API directly (most work by far; needs the Vulkan SDK and a compiler).
- CHECK THE CURRENT wgpu-py DOCS before writing code (how to request the Vulkan backend, the window/canvas
  API, compute pipeline setup). Do not rely on memory for these; the API has changed between versions.

Build order (each step ends in something the user can look at; commit after each):
1. Window + Vulkan check: open a window, print the adapter name and backend, draw the viscous background
   (ripple field + sheen) as a full-screen shader. Confirms the stack works on this GPU.
2. Landscape shader: sources only, full resolution, same formula as the reference.
3. Cells on the GPU: state in buffers; compute pass for forces, with a uniform grid for neighbours
   (count, prefix sum, scatter; or sort by cell index). Contact forces first, then membrane sensing.
4. Draw cells: instanced quads, glow body + inner dot grid, stretched by each cell's deformation.
5. Biology: division and death change the cell count. Simplest route: fixed-capacity buffers with an alive
   flag, and do fate choice, division and death on the CPU every few frames from a read-back, or with an
   atomic counter in the compute shader. Decide when reached.
6. Full landscape including every cell's field (the reason to go to the GPU), then scale up the cell count.
7. Mouse: tap to drop stem cells / nutrient / threat, drag to stir.

Goals: many more cells (thousands to tens of thousands); a full-resolution landscape that includes every
cell's field, not only the sources'; 60 fps on the GTX 1650.
Keep `reference/neon_organoid_cpu.html` as the behavioural reference; try rule changes there first when quicker.
Claude cannot see the window: after each step, ask the user what they see, or save a screenshot to a file
and read it.

## Design direction: several separate fields, like the forces of matter (user idea, 2026-11-14; not built)
The user's picture: different fields as matter has, each with its own decay law, which do not mix by themselves
and only "leak" into each other through interaction rules carried by the cells (their example: Pauli exclusion).
Proposed shape (Claude's suggestion, open to change):
- 2 to 4 fields. Each field is its own sum over emitters, never added to another field. Each has its own
  lattice period ("band"), decay law, and sign rule. Starting set:
  long-range attraction ~1/r (nutrient / gravity-like) · mid-range, like repels like ~1/r² (charge-like) ·
  short-range binding, exponential cut-off (adhesion / strong-force-like).
- Bands keep fields apart naturally: lattices with very different periods make no slow beat, only close
  periods do. A cell that deforms strains its lattice toward another band, so deformation can be the leak.
- Cells are the only place fields meet. Each cell type has a "charge" per field (how strongly it emits and
  responds). Conversion rules live in the cell: e.g. feeling field A above a threshold makes it emit field B.
- Exclusion rule: two cells of the same type in the same internal state (lattice angle/phase) repel hard at
  short range; cells in different states may pack closer. Expected look: shells or alternating patterns.
- Orthogonal partner fields (user idea, after electric/magnetic): each field can have a partner at right angles.
  Suggested translation into patterns: (a) the partner is the same lattice a quarter period out of step
  (cos/sin pair), so the pair carries a phase and a direction of travel; (b) a CHANGE in one field at a cell's
  membrane makes the cell emit the partner (changing A makes B, changing B makes A), which lets signals travel
  as waves instead of sitting still; (c) the partner pushes a cell sideways to its motion, giving curls and spirals.
- NOT a particle simulation (user, explicit): no physics accuracy is wanted. Physics is only a source of
  concepts for how patterns exchange information. "Charge" above just means how strongly a cell emits into and
  listens to a field.
- Draw each field in its own faded colour, added together.
- Keep to the "minimal core first" advice: start with two fields and no biology, add one rule at a time.

## Ground rules
- State plainly what was tested and how. "Runs without errors" is not "looks right".
- Commit working states often, so a bad visual change is easy to undo.
