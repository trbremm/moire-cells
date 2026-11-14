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
UPDATE 2026-11-14 (user): "neon" was only a colour reference, NOT an effect to imitate. No blur, no glow, no
bloom. Think 80s graphic art: crisp, flat, graphic shapes with clean hard edges, and the faded palette above.
Soft in colour, sharp in form. (The reference CPU page still glows; that part of it is no longer the target.)

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

## Next step: GPU engine in the browser with WebGPU (user decision 2026-11-14, final)
The user wants the engine on the GPU, as a web page using WebGPU, so it is easy to show to friends by link.
(A desktop Vulkan app was considered the same day and dropped; do not reopen it.)
The CPU version spends about 13 ms per frame on simulation alone at 520 cells, so it cannot grow.

Machine: Windows 11, GTX 1650 (4 GB), Python 3.13 installed (enough for a local web server). No Node, Rust
or CMake assumed; check before relying on any.

Stack:
- Plain static site: `index.html` + JavaScript modules + WGSL shaders (compute shaders for the simulation,
  render shaders for drawing). No framework and no build step unless one becomes clearly necessary.
- Run locally with `python -m http.server` and open http://localhost:8000 in Chrome or Edge. WebGPU needs a
  secure context: localhost and https qualify; opening the file directly (file://) may not work.
- If WebGPU is missing (`navigator.gpu` undefined or no adapter), show a plain message saying which browsers
  work and link to the CPU reference page. Never a blank screen.
- Sharing with friends: any static https host works (GitHub Pages is the obvious free one). Publishing is
  outward-facing: ask the user before pushing anything public. Whether a claude.ai artifact allows WebGPU is
  unknown; test once with a tiny page before relying on it.
- Which browsers and phones support WebGPU changes quickly: CHECK CURRENT SUPPORT, do not rely on memory.
  Likewise check the current WebGPU / WGSL docs for API details before writing code.
- Testing: use a browser tool if the session has one (Claude in Chrome or the built-in browser) to load the
  page and take screenshots; otherwise ask the user what they see. Add a key that shows frame time and the
  adapter name on screen.

Build order (each step ends in something the user can look at; commit after each). Agreed principle:
minimal core first, then ONE rule at a time, so the user can see what each rule alone changes:
1. WebGPU check: a page that gets the GPU adapter, shows its name on screen, and draws the viscous background
   (ripple field + sheen) as a full-screen shader. Confirms the stack works on this GPU and in the browser.
   Include the no-WebGPU fallback message from the start.

   PART A — minimal core (no biology: no division, death, fates or adhesion matrix)
2. One field, sources only: full-resolution landscape shader, same beat formula as the reference
   (emitter lattice against the medium lattice, power-law envelope). Mouse drops sources.
3. Cells on the GPU, fixed count (start ~2 000): state in buffers; compute pass with a uniform grid for
   neighbours (count, prefix sum, scatter; or sort by grid index). Soft contact push only. Draw as instanced
   quads: glow body + inner dot grid.
4. The loop: membrane sensing (segment integrals), force, deformation, strained lattice — ported from the
   reference. Cells now emit into the field too, and the landscape shader includes every cell's field.
   LOOK HERE FIRST: what do thousands of cells do with only the loop? Tune the lever (how different the grids
   are) until patterns win over flicker. Do not move on until this is worth watching.
5. Second field with a different range and sign rule (e.g. long-range attraction + mid-range like-repels-like).
   Fields are separate sums in separate lattice bands, each drawn in its own colour. Look for clusters of a
   preferred size, stripes, regular spacing.
6. Leak by deformation: strained cells couple into the neighbouring band. Then conversion rules in the cell
   (feeling A above a threshold emits B). One rule at a time; keep only what makes it more interesting.
7. Exclusion: same-type cells in the same internal state (lattice angle) repel hard up close; different
   states pack closer. Look for shells filling up around an attractor.
8. Orthogonal partner fields: quarter-period partner lattice; a change in A makes the cell emit B and vice
   versa; partner pushes sideways to motion. Look for travelling waves, spirals, rotating clusters.

   PART B — biology on top (only once Part A is worth watching)
9. Division and death (cell count changes): fixed-capacity buffers with an alive flag; do it on the CPU every
   few frames from a read-back, or with an atomic counter in the compute shader. Decide when reached.
10. Fates and tissues, driven by the fields rather than by the hand-written neighbour rules of the reference
   where possible. Nutrient is eaten, threat kills. Neuron links and pulses if still wanted.
11. Polish: tap modes, stirring, legend/scale-bar overlay, performance (target 60 fps on the GTX 1650 with
   thousands to tens of thousands of cells).

Each new rule gets an on/off key, so its effect can be seen by toggling it.
Keep `reference/neon_organoid_cpu.html` as the behavioural reference for the loop (step 4) and the biology
(Part B); the multi-field ideas in "Design direction" below are new and have no reference.
After each step, look at the page (browser tool screenshot) or ask the user what they see before moving on.

## Design direction: several separate fields, like the forces of matter (user idea, 2026-11-14; not built)
This is the heart of the project now (build steps 5–8 above); the user is excited about it.
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
