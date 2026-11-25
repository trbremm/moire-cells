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
