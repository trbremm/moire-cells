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

## Next step: GPU engine
The user wants the engine on the GPU. The CPU version spends about 13 ms per frame on simulation alone at
520 cells, so it cannot grow. Recommended: WebGPU (compute shaders), run as a local page in Chrome or Edge.
Goals: many more cells; a full-resolution landscape that includes every cell's field, not only the sources'.
Port the rules from the reference file; change rules in the reference first when that is quicker.
Whether WebGPU works inside a published claude.ai artifact is unknown; assume a local file.

## Ground rules
- State plainly what was tested and how. "Runs without errors" is not "looks right".
- Commit working states often, so a bad visual change is easy to undo.
