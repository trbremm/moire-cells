// THE DISH: its own size, in cell units, chosen at a NEW CULTURE and kept while the window changes (the window is only a view).
// README "Dish size and densities".
//
// Before (?dishfollow=1 keeps it): the dish WAS the window. A resize set the cells' radius R from the window again, the medium lattice's
// own R from the window's area (5..9 CSS px), made a new substrate grid and drained the old one (every atom and all heat left the dish),
// and left the cells where they were in CSS px (outside a smaller window, the soft walls shoved them in). Experiments "Waves after a
// resize" (EXPERIMENTS.md) traced the user's travelling fronts to that.
//
// Now: the dish is { W, H } in DISH PX (the simulation's CSS px, as every layer has always used: positions, the grid, the springs), with
// the cells' radius R (px) and the medium lattice's R (mR, px) fixed with it. A window resize changes only how it is DRAWN: the canvas
// is fitted inside the window with the dish's shape (dark bands at the sides when the shapes differ), and `fit` = canvas CSS px per dish
// px. The drawing and the pointer go through the camera (src/camera.js), whose zoom 1 is the whole dish.
//
// Chosen (at the page's start, which is every new culture with another number of cells or another dish):
//   ?dish=WxH          the dish in cell radii R (e.g. ?dish=200x60), or in micrometres with a `um` suffix (?dish=1200x360um; a cell is
//                      12 um across: 6 um per R). R in px is then picked so the dish fills the window.
//   a preset's `dish`  the same, from the preset (src/culture.js)
//   a snapshot         its own dish (?snap=: exact)
//   otherwise          the window, as the page always did: dish = the window's CSS size, R from it and the starting number.
// PER AREA (fixed dish only; ?dishfollow=1 keeps the old per-px and per-dish amounts): a bigger dish in cell units is more of the same
// world, not a different balance. With A the dish's area in R^2 and A_REF the reference dish's (1280 x 800 px, 2000 cells, the
// experiments' default window, where every number below is exactly as before):
//   the medium lattice   mR = KAPPA x R (KAPPA = 9 / R_REF): the moire beats keep their size in cell units on any screen
//   light                power per R^2 (the knob `power` still reads "per 100 px^2" at the reference R)
//   clouds               size and drift in R
//   capacity             CAP_DENSITY x A cells (3 x 2000 at the reference)
//   springs              every scene's spring (and vent) drips x A / A_REF (pipette drops are the hand's, not scaled)
//   oases                count x A / A_REF (each drips as before)
// Already per R^2 or per s before: warmth, the heat's leak and spread, the sea, sparks and reactions, the oases' burying, the field reaches.

export const REF = { W: 1280, H: 800, cells: 2000, R_MAX: 9 };
/** The cells' radius on the reference dish (the window the experiments run in): 6.48 px. */
export const R_REF = Math.min(REF.R_MAX, 0.4 * Math.min(REF.W, REF.H) * Math.sqrt(0.82 / REF.cells));
export const KAPPA = REF.R_MAX / R_REF;          // the medium's R per cell R (1.389: the reference's 9 px over 6.48 px)
export const A_REF = REF.W * REF.H / (R_REF * R_REF);   // the reference dish's area in R^2 (24 390)
export const CAP_DENSITY = 3 * REF.cells / A_REF;       // capacity per R^2 (0.246: 85 % of a dish packed with hexagons)
export const UM_PER_R = 6;                       // the toy scale (src/app.js's scale bar): a cell 12 um across

/** The old rules, from a window (CSS px) and a starting number: the medium's R (5..9 px from the area) and the cells' R. */
export function legacyRadii(W, H, start) {
  const mR = Math.max(5, Math.min(REF.R_MAX, Math.sqrt(W * H / (420 * Math.PI * 3.6))));
  const R = Math.min(mR, 0.4 * Math.min(W, H) * Math.sqrt(0.82 / start));
  return { mR, R };
}

/** Parse ?dish=WxH (cell radii) or WxHum (micrometres): [W, H] in R, or null. */
export function parseDish(s) {
  if (!s) return null;
  const m = String(s).trim().toLowerCase().match(/^([\d.]+)\s*[x×,]\s*([\d.]+)\s*(um|µm|r)?$/);
  if (!m) return null;
  let w = Number(m[1]), h = Number(m[2]);
  if (m[3] === 'um' || m[3] === 'µm') { w /= UM_PER_R; h /= UM_PER_R; }
  if (!(w >= 10 && h >= 10)) return null;
  return [Math.min(4000, w), Math.min(4000, h)];
}

export const dish = {
  W: 0, H: 0,          // dish px
  R: 0,                // the cells' radius (px)
  mR: 0,               // the medium lattice's R (px)
  follow: false,       // ?dishfollow=1: the window is the dish (every resize re-sizes it, as before)
  perArea: true,       // supplies per R^2 (false: as before, per px^2 and per dish; ?dishfollow=1 and snapshots from before)
  fit: 1,              // canvas CSS px per dish px (drawing only)
  from: 'window',      // how it was chosen: window | url | preset | snapshot | follow

  /** Its area in R^2. */
  get area() { return this.W * this.H / Math.max(1e-9, this.R * this.R); },
  /** The per-area factor: this dish's area over the reference dish's (1 with perArea off). */
  get supply() { return this.perArea ? this.area / A_REF : 1; },
  /** Size in R, for the panels. */
  get sizeR() { return [this.W / this.R, this.H / this.R]; },

  /** The dish from a window (CSS px) and a starting number, R and the medium as the old rules (mR = KAPPA R unless perArea is off). */
  fromWindow(W, H, start, from = 'window') {
    const L = legacyRadii(W, H, start);
    Object.assign(this, { W, H, R: L.R, mR: this.follow ? L.mR : KAPPA * L.R, from });
  },

  /** The dish from a size in R ([w, h]), fitted to a window (CSS px): R px so it fills the window, at most R_MAX. */
  fromCells(wR, hR, winW, winH, from = 'url') {
    const R = Math.max(1, Math.min(REF.R_MAX, winW / wR, winH / hR));
    Object.assign(this, { W: Math.round(wR * R), H: Math.round(hR * R), R, mR: KAPPA * R, from });
  },

  /** The capacity for `start` cells (per area; ?cap= and the fixed count override it in main.js). */
  capacity(start) {
    if (!this.perArea) return 3 * start;
    return Math.max(start, Math.round(CAP_DENSITY * this.area));
  },

  /** The largest starting number whose blob (0.8 x the shorter side) fits this dish. */
  maxStart() { const m = 0.4 * Math.min(this.W, this.H) / this.R; return Math.max(20, Math.floor(0.82 * m * m)); },

  /** Light: the px^2 that a heat pixel of `px` counts as for the power (per 100 px^2): px^2 before, (px / R x R_REF)^2 per area. */
  lightArea(px, R) { if (!this.perArea) return px * px; const a = px / R * R_REF; return a * a; },
  /** A length given in px at the reference (clouds): in this dish's px. */
  refPx(x) { return this.perArea && this.R > 0 ? x * this.R / R_REF : x; },

  /** For the panels. */
  line() {
    const [w, h] = this.sizeR;
    return `dish ${Math.round(w)}×${Math.round(h)} R (${Math.round(this.W)}×${Math.round(this.H)} px, R ${this.R.toFixed(2)} px, medium ${(this.mR / this.R).toFixed(2)} R)` +
      ` · area ${(this.area / 1000).toFixed(1)}k R² (× ${(this.area / A_REF).toFixed(2)} the reference)` +
      ` · ${this.follow ? 'follows the window (?dishfollow=1)' : `fixed (${this.from})`}${this.perArea ? '' : ' · supplies per px (old)'}` +
      (this.fit !== 1 ? ` · drawn × ${this.fit.toFixed(2)}` : '');
  },
};

/** A snapshot's dish: its own (saved since the dish has its own size), or, from before, its window, R and medium, supplies per px. */
export function snapDish(S) {
  if (S.dish) return { W: S.dish.W, H: S.dish.H, R: S.dish.R, mR: S.dish.mR, perArea: S.dish.perArea !== false, follow: false };
  const W = S.view.cssW, H = S.view.cssH;
  return { W, H, R: S.R, mR: legacyRadii(W, H, S.start).mR, perArea: false, follow: false };
}
