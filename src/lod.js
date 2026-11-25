// Step V1: LOD FROM BAND LIMITS (design/lod_band_limits.md). DRAWING ONLY: the simulation never sees any of this.
//
// There is no separate LOD system. Every drawn feature is declared ONCE below with its size in the world (in R, the cells' radius,
// or in dish px for the few laid out in the dish) and the kind of limit it must clear on screen:
//   pixel 1   the tube's core line (the silhouette carrier): it never thins below a device pixel, it dims instead
//   grid  3   patterns and textures (dust, halftone and field dots, granules, stripes, dashes, fibres, pores)
//   beat  6   parts (the engines' marks, the battery's core, the phagosome, a flagellum), and the cell's sign ladder
//   host 12   marks that sit on a part (pump notches, wall bricks, cilia hairs, tendrils, the marker on the tube): their host (the
//             cell) must be 2 beats across
// The screen size of a feature = its world size x s, s = device px per R = dish px per R x the camera's zoom x the device px ratio.
// One shared fade (lod_common.wgsl lod_keep): a feature is kept by smoothstep over +-spread (30 %) of its limit, so nothing pops.
// What fails is not just dropped: its light goes into the tone of its cell (VALUES OVER DETAILS), and zoomed out the walls two cells
// share dim and give their light to the cells' insides, so packed tissue reads as one lit mass with its outer outline (MERGE).
// The cell itself steps down a SIGN LADDER: the full neon tube with its parts at 2.5 beats (15 px across) or more; a simplified sign
// from 1.25 to 2.5 beats (the tube and one core whose brightness is the battery); below that a minimal sign (a lit blob in the job's
// colour, its outline on free sides).
// Switch: ?lod=0 (and the View panel's "level of detail") draws exactly as before step V1. Knobs live: moire.lod.params.
// Console: moire.lod.table() (each feature's screen size and kept share at zoom 1, 3, 8 for the dish as it is now).

export const LOD_LIMITS = { pixel: 1, grid: 3, beat: 6, host: 12 };
export const LOD_URL = 'src/shaders/lod_common.wgsl';   // the shared fade (prepended to the draw shaders)

// The declared features. size: world size (unit 'R' or 'px' = dish px, the dish's own fixed grids); kind: the limit; where: the shader
// that applies it; fold: what the feature turns into when it fails. Sizes follow the look's knobs (src/cells.js look, matter, ...): the
// numbers here are the defaults, refreshed from the live knobs by table().
export const FEATURES = [
  { id: 'cell.full', what: 'the cell, FULL sign (neon tube + parts)', size: 2, unit: 'R', kind: 'beat', times: 2.5, where: 'cell_draw',
    fold: 'simplified sign' },
  { id: 'cell.sign', what: 'the cell, SIMPLIFIED sign (tube + one battery core)', size: 2, unit: 'R', kind: 'beat', times: 1.25,
    where: 'cell_draw', fold: 'minimal sign: a lit blob in the job colour' },
  { id: 'tube', what: 'the tube\'s width (silhouette carrier)', size: 1.1, unit: 'px', kind: 'pixel', where: 'cell_draw',
    fold: 'keeps 1 device px, dims by its lost width' },
  { id: 'walls', what: 'shared walls (two cells\' tubes on one wall)', size: 2, unit: 'R', kind: 'beat', times: 2.5, where: 'cell_draw',
    fold: 'dim, their light into both cells\' insides (merge)' },
  { id: 'core', what: 'battery core (area by charge, lit rim)', size: 0.72, unit: 'R', kind: 'beat', where: 'cell_draw',
    fold: 'the simplified core (brightness = battery)' },
  { id: 'parts', what: 'engine marks (disc, diamond, triangle, square)', size: 0.48, unit: 'R', kind: 'beat', where: 'cell_draw',
    fold: 'their inks into the cell\'s tint' },
  { id: 'granules', what: 'carbon granules (dots inside)', size: 0.2, unit: 'R', kind: 'grid', where: 'cell_draw',
    fold: 'amber into the tint' },
  { id: 'phago', what: 'phagosome (the meal\'s ghost)', size: 0.7, unit: 'R', kind: 'beat', where: 'cell_draw',
    fold: 'the meal\'s colour into the tint' },
  { id: 'notches', what: 'pump notches (on the tube)', size: 2, unit: 'R', kind: 'host', where: 'cell_draw',
    fold: 'the tube\'s tinted segment stays' },
  { id: 'bricks', what: 'crust wall bricks (on the rim)', size: 2, unit: 'R', kind: 'host', where: 'cell_draw',
    fold: 'a flat rim as covered as the wall' },
  { id: 'dashes', what: 'damaged membrane dashes', size: 0.45, unit: 'R', kind: 'grid', where: 'cell_draw',
    fold: 'a dimmer whole tube' },
  { id: 'marker', what: 'self-marker stripes on the tube', size: 0.25, unit: 'R', kind: 'grid', host: true, where: 'cell_draw',
    fold: 'their average dimming (replaces the old switch at zoom 3)' },
  { id: 'latdots', what: 'lattice dots inside cells (machinery)', size: 0.62, unit: 'R', kind: 'grid', where: 'cell_draw',
    fold: 'their average into the tint' },
  { id: 'fibres', what: 'harmonic: fibres, striations in cells', size: 0.26, unit: 'R', kind: 'grid', where: 'cell_draw (fs_harm)',
    fold: 'their average orange' },
  { id: 'flagella', what: 'flagellum (a swimmer\'s tail)', size: 3.0, unit: 'R', kind: 'beat', where: 'motor_draw',
    fold: 'the cell\'s tube a little brighter' },
  { id: 'cilia', what: 'cilia hairs (on free sides)', size: 2, unit: 'R', kind: 'host', where: 'motor_draw',
    fold: 'the cell\'s tube a little brighter' },
  { id: 'tendrils', what: 'tendrils and ropes (on the cell)', size: 2, unit: 'R', kind: 'host', where: 'tendril_draw',
    fold: 'fade (ropes keep 25 %)' },
  { id: 'lamellae', what: 'bone lamellae (rings)', size: 0.3, unit: 'R', kind: 'grid', where: 'tendril_draw',
    fold: 'an even ivory tone' },
  { id: 'dust', what: 'substances as dust (grid square)', size: 3.2, unit: 'px', kind: 'grid', where: 'matter_draw',
    fold: 'an even glow of the same light' },
  { id: 'halftone', what: 'substances as halftone (machinery)', size: 0, unit: 'px', kind: 'grid', where: 'matter_draw',
    fold: 'an even tone' },
  { id: 'crust', what: 'harmonic: crust fibre strands', size: 2.2, unit: 'px', kind: 'grid', where: 'matter_draw (fs_harm)',
    fold: 'an even orange' },
  { id: 'fielddots', what: 'field dots (machinery)', size: 6, unit: 'px', kind: 'grid', where: 'landscape_draw',
    fold: 'an even tone' },
  { id: 'pores', what: 'porous walls: pores and dashes', size: 2, unit: 'px', kind: 'grid', where: 'obstacles_draw',
    fold: 'an even tone' },
];

export const lod = {
  params: {
    on: true,          // ?lod=0: off (today's drawing exactly)
    spread: 0.3,       // the fade: +-30 % around each limit
    merge: 0.35,       // zoomed out, a shared wall's tube dims by up to this share (the two neighbours' tubes close into one line) ...
    wallFold: 0.35,    // ... and this share of the light it lost goes into the cells' insides (1 = all: a flat lit mass, not neon)
    fold: 1,           // a failed feature's (part's, granule's, pattern's) light goes into its cell's tone x this (1 = its light kept)
    partTube: 0.6,     // ... of the engines' marks' light, this share lights the tube instead (busy cells shine brighter, as the hum)
    tubeMax: 1.6,      // ... by at most this factor
    signFill: 0.18,    // the minimal sign: the blob's tone (share of the job colour) ...
    signLamp: 0.7,     // ... its middle brighter by this (a small lamp: the halo lights it) ...
    signTube: 0.7,     // ... and its tube's brightness (the rest of the tube's light is the blob)
    coreR: 0.34,       // the simplified sign's core: its radius (share of r)
    harmFill: 0.5,     // harmonic: the share of a merged / failed rim's green kept as the inside's tone
  },
  app: null,           // window.moire (main.js), for table()

  get on() { return !!this.params.on; },

  /** The shared fade (as lod_common.wgsl lod_keep). */
  keep(px, limit) {
    if (!this.on) return 1;
    const s = this.params.spread, a = (1 - s) * limit, b = (1 + s) * limit;
    const t = Math.max(0, Math.min(1, (px - a) / (b - a)));
    return t * t * (3 - 2 * t);
  },

  /** The cells' drawing words (struct Draw lod, lod2, lodL, lod3 in cell_draw.wgsl, from float o). */
  writeCells(a, o) {
    const P = this.params, L = LOD_LIMITS;
    a[o] = this.on ? 1 : 0; a[o + 1] = Math.max(0.01, P.spread); a[o + 2] = P.merge; a[o + 3] = P.fold;
    a[o + 4] = P.signFill; a[o + 5] = P.signTube; a[o + 6] = P.coreR; a[o + 7] = P.harmFill;
    a[o + 8] = L.pixel; a[o + 9] = L.grid; a[o + 10] = L.beat; a[o + 11] = L.host;
    a[o + 12] = P.wallFold; a[o + 13] = P.partTube; a[o + 14] = P.tubeMax; a[o + 15] = P.signLamp;
  },

  /** A small layer's words as one vec4: on, spread, and the two limits it uses (default the grid's and the host's). */
  write4(a, o, k1 = 'grid', k2 = 'host') {
    a[o] = this.on ? 1 : 0; a[o + 1] = Math.max(0.01, this.params.spread); a[o + 2] = LOD_LIMITS[k1]; a[o + 3] = LOD_LIMITS[k2];
  },

  /** Each feature's screen size and kept share at the given zooms, for the dish as it is now (console.table). */
  table(zooms = [1, 3, 8], print = true) {
    const M = this.app, C = M && M.cells;
    const R = C ? C.R : 7, dpr = C && C.view ? C.view.dpr : (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const L = C ? C.look : null, MP = M && M.matter ? M.matter.params : null, LP = M && M.landscape ? M.landscape.params : null;
    const size = (f) => {
      if (f.id === 'tube' && L) return L.tube;
      if (f.id === 'parts' && L) return 2 * L.partSize;
      if (f.id === 'core' && L) return 2 * L.coreParts;
      if (f.id === 'dust' && MP) return MP.dustCell;
      if (f.id === 'halftone' && M && M.medium) return (MP ? MP.step : 2) * 2 * (2 * Math.PI / M.medium.k0) / Math.sqrt(3);
      if (f.id === 'fielddots' && LP) return LP.pitch;
      if (f.id === 'crust' && M && M.neon && M.neon.harmonic) return 2 * Math.max(0.3, M.neon.harmonic.params.fibreW);
      return f.size;
    };
    const rows = FEATURES.map((f) => {
      const row = { feature: f.id, what: f.what, limit: `${f.kind} ${(f.times || 1) * LOD_LIMITS[f.kind]} px`, size: `${+size(f).toFixed(2)} ${f.unit}` };
      for (const z of zooms) {
        const s = dpr * z;   // device px per dish px
        const px = f.unit === 'R' ? size(f) * R * s : size(f) * s;
        const lim = (f.times || 1) * LOD_LIMITS[f.kind];
        let k = this.keep(px, lim);
        if (f.host) k *= this.keep(2 * R * s, LOD_LIMITS.host);
        if (f.kind === 'pixel') k = Math.min(1, px / lim);   // (the tube: kept at full width, its brightness x this)
        row[`x${z} px`] = +px.toFixed(1);
        row[`x${z} kept`] = +k.toFixed(2);
      }
      row.fold = f.fold;
      return row;
    });
    if (print) {
      console.log(`LOD (step V1): R ${R.toFixed(2)} dish px, ${dpr} device px per dish px at zoom 1, lod ${this.on ? 'on' : 'OFF'}`);
      console.table(rows);
    }
    return rows;
  },
};
