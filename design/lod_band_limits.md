# LOD from band limits

Brought over by the user (2026-11-25) from another project; the general approach first, then how it maps onto Moiré cells.

## The approach

**Principle.** There is no separate LOD system. Every feature is authored in world units and drawn at a scale *s*. Its screen
size is world size × *s*, and it is drawn only while that clears a limit.

**1. Limits (screen px)**

| Limit | px | Applies to |
| --- | --- | --- |
| Pixel | 1 | motion |
| Grid | 3 | patterns, textures |
| Beat | 6 | parts, and patterns made of two interfering layers |
| Host | 12 | marks that sit on a part (the host must be 2 beats) |

**2. Rules**
- **Declare, don't code.** Each element lists its features in one table (kind, world size). The engine applies the limits.
- **Fade, don't pop.** A feature fades over ±30% around its limit. For octave sums, fade in over the next doubling.
- **Values over details.** What fails dissolves into the tone of its parent mass.
- **Structure never changes.** Distance removes detail from the same object; it never generates a different one. Position,
  height and silhouette stay fixed.
- **Merge, don't prune.** Small parts join their neighbour as one light unit and keep their outline. Pruning makes far objects
  thinner.
- **Sub-pixel motion becomes tone.** Movement under 1 px shifts the value by up to one step.
- **Fewer tones when small.** Tones per mass = clamp(round(size / 12), 2, 4).
- **Form steps down to a sign.** At 2.5 beats or more, use the full form. From 1.25 to 2.5, use a simplified graphic sign. Below
  that, use a minimal sign.
- **Silhouette carriers go last.** The outline only thins to a wash. Marks defined in pixels keep their pixel thickness and pack
  tighter.

**3. Checks**
- Run a blind A/B against the naive version (full detail, point-sampled down), in motion.
- Test any distance-tied pattern at the nearest plane, where it is finest.
- Show a table of each feature's screen size and kept share per scale.

**4. Open claim**

Two near-parallel fine layers still produce a broad beat when each is sub-pixel, which gives far objects one or two light
masses. Never confirmed in review: a hypothesis.

## Mapping onto Moiré cells (Claude, 2026-11-25)

World unit = the cell radius R. Scale s = screen px per R (dish px per R x camera zoom x device px ratio). At zoom 1 a cell is
~10-18 px across (less on phones and at 10 000 cells), so most cell detail sits right at the Beat and Host limits.

- **Today:** each feature handles zoom ad hoc (marker stripes switch on at zoom 3, harmonic rims widen with sqrt(zoom), the rest
  shrinks): the naive version, and the source of the busy look zoomed out.
- **Declare:** one table of drawn features with world sizes in R (battery core, engine marks, nuclei: parts / Beat; marker stripes,
  cilia hairs: Host; tendrils, halftone substance dots, machinery lattice dots, harmonic fibre swirl: Grid; the neon tube: the
  silhouette carrier); one shared WGSL fade (smoothstep over ±30 % of the limit).
- **Cell sign ladder:** >= 15 px full neon tube + parts; 7.5-15 px simplified (tube + one core whose brightness = battery);
  < 7.5 px a dot in the job colour. Job colour always kept (colour means function).
- **Values over details:** parts that fail fold into the cell's tint / brightness, never vanish without trace.
- **Merge, don't prune:** packed tissue zoomed out draws as one lit mass keeping its outer outline, not hundreds of halos.
- **Silhouette last:** the tube's halo is already in screen px; its core line keeps pixel width and dims rather than thins.
- **Structure never changes:** holds already (the simulation never depends on zoom).
- **Open claim, partly answered here:** a broad beat survives only when the fine layers MULTIPLY (one masks the other: the
  product holds the difference term cos((k1 - k2) x)); when they ADD, each blurs away alone and no beat is left. Even then the
  beat is right only if pixels area-average; point sampling gives a false (aliased) beat at the wrong spacing. Moiré cells
  computes its fields directly as the difference term (q = k_emitter - k_medium), which is why they stay broad and stable at any
  zoom. Risk here: halftone dots and machinery lattice dots (period ~1 R, 5-9 px at zoom 1) alias on phones: fade at the Grid limit.

## In practice (step V1, 2026-11-25)

What the mapping turned out to be once built (README "Step V1"; `src/lod.js`, `src/shaders/lod_common.wgsl`):

- **Declare, don't code** held: one table in `src/lod.js` (size in R or dish px, limit kind), one WGSL fade. Two departures: the sign
  ladder (2.5 / 1.25 beats) sits beside the per-feature fades, and a few "host" marks use the cell as their host (the cell must be
  12 px) rather than their own size.
- **At zoom 1 on a desktop a cell is ~13 px across**: just under the full form. So the everyday default view is the SIMPLIFIED sign, and
  the biggest calming came from the engine marks (3 px: far below the beat limit) leaving. Light conservation mattered more than the
  table: folding the parts' light into a flat inside tint at area share made the colony look dim and pastel (the neon halo only lights
  bright, concentrated light, so spread light disappears twice). What looks right is to fold most of a failed part's light into the TUBE
  (busy cells shine brighter, as the hum) and only a little into the tint; the merged walls give a third of their light to the insides.
- **Merge** works best mild (shared walls dim 35 %, the seam closes so two tubes meet as one line); strong merging turns neon into tiles.
- **Minimal sign**: a flat blob read as dull paint; a small lamp (bright middle, the halo picks it up) reads as light.
- **Values over details vs. "zoomed in exactly as before"**: the marker stripes only darken, so folding them to their mean dims every tube at
  zoom 1. Kept: they fade in by darkening (a smooth value change over the fade, not a pop), and zoomed in nothing differs (checked:
  zoom 8, lod on and off, pixel-identical).
- **Open claim**: not tested further. In this project the fields are already the difference term (the beat itself), so the far view
  keeps broad beats by construction; what aliased were the fixed screens (dust 3.2 dish px, pores 2 px, halftone, field dots, stripes,
  fibre noise), and those now fade to their tone at the grid limit. The old "marker texture from zoom 3" was a real pop: the mean
  brightness of a zoom sweep dropped ~15-25 % between zoom 2.6 and 3.0 with lod off; with lod on it moves smoothly.
- **Skipped**: "fewer tones when small" as its own rule (the ladder already leaves 2 to 3 tones per cell) and "sub-pixel motion becomes
  tone" (the neon trails already smear motion; nothing visible to gain at a cost).
