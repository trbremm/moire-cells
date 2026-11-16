// Step N1, A NUTRIENT LANDSCAPE (the user, 2026-11-16: "I think light is fueling them too easily. We might need to make the
// nutrient landscape more interesting"). Part 2: LIGHT NEEDS MATTER. README "Step N1: nutrient landscape".
//
//   PIGMENT FROM THE STOCK   a harvest slot's pigment is a molecule the cell builds: two light linkers l (a chain that shares its
//                            electrons, an antenna, like chlorophyll's conjugated ring of C and N) holding one TRACE atom at its heart
//                            (like chlorophyll's magnesium). Each count of pigment takes one trace and two l out of the stock (stock
//                            word 30; the atoms' books count them with the cells' trace and l, so atoms and charge stay exact), and its
//                            assembly costs `cost` energy per unit from the battery, as heat (its own energy is the free atoms', 0)
//   WEAR                     the pigment falls apart into its atoms at `wear` per s (back into the stock), so a harvester keeps
//                            paying matter and battery to keep it: harvesting is no longer free
//   ITS DEPTH                a slot's optical depth is pigK x rate x the share of the wanted pigment the cell holds (the want: `want`
//                            per R^2 of the cell's area per unit of harvest rate)
//   SATURATION               of the photons caught at a light s (a share of the full noon light, power 33, straight down), only
//                            Isat tanh(s / Isat) / s can be used; the rest are heat (photons with nothing to work on)
//   PHOTOINHIBITION          each photon past saturation bleaches `inhib` counts of the pigment (back into its atoms): under a
//                            strong light, or on a bright caustic line, shade is worth having
// Since trace is also the engines' cofactor (step C7b) and, with the scarce-nutrient switch (src/oases.js), comes only from a few
// oases, light-catching now needs a place where trace can be found.
//
// This module holds the switches and knobs (moire.pigments.params), writes the eat pass's words (struct EatP nl), reads the counters
// back (the heat's ledger, LG_N1, through src/eat.js) and gives the LIGHT panel line and the overlay. The rule itself is in
// cell_eat.wgsl (the "step N1" blocks).

import { fmt, HEAT_SCALE } from './heat.js';
import { ATOM_SCALE } from './matter.js';

export const LG_N1 = 28416;          // heat_common.wgsl: 16 counters, 64-bit, 64 slots (128 words each)
const N1 = ['rise', 'caught', 'iSat', 'iCof', 'iMat', 'iCap', 'iBat', 'iWaste', 'built', 'buildE', 'wear', 'inhib', 'held', 'cells'];
const N1_ENERGY = /^(rise|buildE)$/;
const N1_SNAP = /^(held|cells)$/;
export const REF_POWER = 33;         // the light's default power (src/light.js): "the full noon light" saturation is measured against

export class Pigments {
  constructor(eat) {
    this.eat = eat;
    this.light = null;   // set by main.js
    // live-tunable: moire.pigments.params. Switches: the rules panel's group "Nutrient landscape (step N1)" and URL options.
    this.params = {
      matter: true,      // pigments are built from the stock (a trace and two l per count) and wear out (?pigmatter=0: free, as before)
      sat: true,         // photosynthesis saturates (?pigsat=0)
      inhib: true,       // photons past saturation bleach the pigment (?inhib=0)
      // knobs
      want: 0.01,        // the pigment a cell wants, units per R^2 of its area per unit of harvest rate (?pigwant=)
      build: 0.5,        // share of the shortfall built per s
      cost: 4,           // energy per unit of pigment built (from the battery, as heat; a multiple of 1/16)
      wear: 1 / 120,     // share of the pigment that falls apart per s (?pigwear=)
      isat: 1,           // the light (share of the full noon light) at which photosynthesis saturates (?isat=)
      bleach: 0.002,     // pigment counts bleached per photon past saturation (?bleach=)
    };
    this.tot = Object.fromEntries(N1.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
  }

  get on() { const E = this.eat.params; return !!(E.on && E.engines); }
  flags() {
    const p = this.params;
    return (p.matter ? 1 : 0) | (p.sat ? 2 : 0) | (p.inhib && p.sat ? 4 : 0);
  }

  /** The eat pass's words (struct EatP nl[0], nl[1], from word o). */
  writeEat(u, f, o, dt, areaScale = 1) {
    const p = this.params, L = this.light;
    u[o] = this.on ? this.flags() : 0;
    f[o + 1] = Math.max(0, p.want) * ATOM_SCALE;
    f[o + 2] = 1 - Math.exp(-Math.max(0, p.build) * dt);
    f[o + 3] = Math.round(16 * Math.max(0, p.cost));
    f[o + 4] = 1 - Math.exp(-Math.max(0, p.wear) * dt);
    f[o + 5] = Math.max(0, p.isat);
    f[o + 6] = Math.max(0, p.bleach);
    f[o + 7] = L ? Math.max(0, L.params.power) / REF_POWER * (L.dayLevel ?? 1) : 1;
  }

  /** The heat's ledger read-back (called by src/eat.js apply). */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot, snap = {};
    N1.forEach((k, j) => {
      const v = wide(LG_N1 + 128 * j);
      const x = N1_ENERGY.test(k) ? v / HEAT_SCALE : v / ATOM_SCALE;
      if (N1_SNAP.test(k)) snap[k] = k === 'cells' ? v : x; else T[k] += x;
    });
    const H = this.hist;
    H.push([rec.time, ...N1.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const rate = Object.fromEntries(N1.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    // the batteries' income (energy into them per s: the downhill engines') and the share light made (the energy the pigments' photons
    // stored, x (1 - ineff) when it is burned back)
    const E = this.eat, r2 = E.ledger ? E.ledger.rate2 : null;
    const gain = r2 ? (r2.eGain || 0) : 0;
    const ineff = Math.max(0, Math.min(1, E.params.ineff));
    const fromLight = rate.rise * (1 - ineff);
    const caught = Math.max(rate.caught, 1e-9);
    this.census = {
      time: rec.time, held: snap.held || 0, cells: snap.cells || 0, rate, tot: { ...T }, gain, fromLight,
      lightShare: gain > 1e-9 ? Math.min(1, fromLight / gain) : 0,
      unused: { sat: rate.iSat / caught, cof: rate.iCof / caught, mat: rate.iMat / caught, cap: rate.iCap / caught, bat: rate.iBat / caught, waste: rate.iWaste / caught },
      used: rate.caught > 0 ? 1 - (rate.iSat + rate.iCof + rate.iMat + rate.iCap + rate.iBat + rate.iWaste) / caught : 0,
    };
  }

  /** The entropy panel's PIGMENTS line. */
  panelLine(compact = false) {
    const C = this.census, p = this.params, on = (x) => (x ? 'on' : 'off');
    if (!C) return 'PIGMENTS  …';
    const pc = (x) => `${Math.round(100 * x)}%`, u = C.unused;
    if (compact) return `PIGMENTS light makes ${pc(C.lightShare)} of income · held ${fmt(C.held)} · photons used ${pc(C.used)}`;
    return `PIGMENTS  batteries +${fmt(C.gain)}/s, light made ${pc(C.lightShare)} (${fmt(C.fromLight)}/s) · pigment held ${fmt(C.held)} in ${fmt(C.cells)} cells` +
      ` (built ${fmt(C.rate.built)}/s, worn ${fmt(C.rate.wear)}/s, bleached ${fmt(C.rate.inhib)}/s) · photons caught ${fmt(C.rate.caught)}/s, used ${pc(C.used)};` +
      ` idle: saturated ${pc(u.sat)} · no trace ${pc(u.cof)} · no material ${pc(u.mat)} · top speed ${pc(u.cap)} · battery ${pc(u.bat)} · clogged ${pc(u.waste)}` +
      ` · rules: matter ${on(p.matter)}, saturation ${on(p.sat)}, bleaching ${on(p.inhib && p.sat)}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`light needs matter (step N1): pigment from the stock ${on(p.matter)} (2 l + 1 trace per count, want ${p.want}/R² per rate, built ${p.build}/s,` +
      ` cost ${p.cost} per unit, wears ${fmt(p.wear)}/s) · saturation ${on(p.sat)} (Isat ${p.isat} of the full noon light) · bleaching ${on(p.inhib)} (${p.bleach} per photon past it)`];
    if (C) lines.push(`pigments: totals built ${fmt(C.tot.built)}, worn ${fmt(C.tot.wear)}, bleached ${fmt(C.tot.inhib)}, assembly paid ${fmt(C.tot.buildE)} energy; light stored ${fmt(C.rate.rise)}/s`);
    return lines;
  }
}
