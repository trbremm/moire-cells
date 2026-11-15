// Step C12c: EXCITED WASTE, THE OXYGEN FIX (the user chose "charged waste", 2026-11-15). Real oxygen holds part of the sunlight
// that made it, which is why breathing beats fermenting. Until now the free light atoms the harvesters throw away held no energy
// (the zero of the table), so "breathing" a rich fuel with one (t + gT -> gt + T) released less than burning the fuel, and
// breathing never paid (EXPERIMENTS.md, "Oxygen retry"). Now:
//
//   made     when LIGHT drives a reaction that frees an atom (the uphill swaps, the only such reactions in the table: gt + T ->
//            gT + t, gt + G -> Gt + g, gT + G -> GT + g, Gt + T -> GT + t; in the open by the dish's light, in a cell by a
//            pigment's photon), the freed light atom leaves EXCITED (g*, t*: matter.js EXCITED, channels 16, 17 on the grid and
//            in the cells' stock) and keeps E* of the photon's surplus: share (1/2) x (photon - the step up: 2 - 0.75 = 1.25) =
//            0.625; the rest of the photon is heat as before. A storer (an uphill engine paid by the battery, no photon) frees a
//            ground atom: no light, no excitation
//   fade     an excited atom fades back to its ground atom by itself, its E* as heat on the spot, at 1 / life x (1 + T / hot)
//            per s (T the temperature there): the haze is rich but temporary, and fades faster where it is hot
//   react    it reacts as its ground atom does (every reaction takes a light giver or taker from the POOL of ground and excited
//            ones, the excited in proportion), and whatever reaction takes it also releases its E*: through a cell's ENGINE
//            (a genome engine: breathing swaps, but any engine) into the BATTERY (minus the engines' ineff share, as heat); in
//            any uncontrolled reaction (in the open, loose inside a cell, biting a membrane) as HEAT on the spot
//   pass     permeability treats it as its ground atom (the same speed through the membrane); pumps do not move it (a pump's
//            slot names a ground substance; an excited atom passes only by permeability); the soap builder takes ground heads only
//   books    E* is chemical energy (matter.js: the energy of g*, t*), so the ledger counts it as stored wherever it is; every
//            move is whole counts and whole heat counts (E* is a multiple of 1/16): atoms, charge and energy stay exact
// Nothing names breathers, poison or oxygen: whether breathing now pays enough to spread is for selection to say.
//
// This module holds the switch and knobs (moire.excited.params, .look), writes the chemistry uniform's words (ChemP.ex) and the
// drawing's, reads the counters back, and gives the EXCITED panel line and the overlay lines.

import { fmt, HEAT_SCALE } from './heat.js';

const LG_EXC_N = 26880, LG_EXC_E = 27008;   // heat_common.wgsl
const XN = ['madeOpen', 'madeCell', 'fadeOpen', 'fadeCell', 'rxOpen', 'rxIn', 'engine', 'bite'];
const XE = ['eEngine', 'eFade', 'eLoose', 'eBreath', 'eBurn', 'eSpare'];

export class Excited {
  constructor(matter, table) {
    this.matter = matter;
    this.table = table;          // matter.js EXCITED: { share, surplus, energy, e16 }
    this.params = {
      on: true,         // excited waste (?excited=0: the chemistry exactly as before step C12c)
      life: 30,         // s: an excited atom's lifetime in a cold dish
      hot: 4,           // the temperature (heat per R^2) at which it fades twice as fast (the lit spot is about 5 to 10)
    };
    this.look = {
      on: true,         // draw the excited haze
      density: 20,      // sparks per amount (x the dots' coverage)
      flicker: 2.5,     // the sparks' flicker (1 / s)
      bright: 1.6,      // their brightness
      radius: 0.95,     // a spark's radius (CSS px)
      ink: [1.0, 0.45, 0.16],   // hot red-orange: hotter than the free atoms' old threat red
    };
    this.tot = Object.fromEntries([...XN, ...XE].map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];
  }

  get on() { return !!this.params.on; }

  /** The chemistry uniform's words (struct ChemP ex, at float f[o]). */
  write(f, o) {
    const p = this.params;
    f[o] = p.on ? 1 : 0;
    f[o + 1] = this.table.e16;
    f[o + 2] = 1 / Math.max(0.05, p.life);
    f[o + 3] = Math.max(1e-3, p.hot);
  }

  /** The drawing's words (struct DrawP exc, excInk, from float a[o]). */
  writeDraw(a, o) {
    const L = this.look;
    a[o] = L.on ? 1 : 0; a[o + 1] = Math.max(0, L.density); a[o + 2] = Math.max(0, L.flicker); a[o + 3] = Math.max(0, L.bright);
    a[o + 4] = L.ink[0]; a[o + 5] = L.ink[1]; a[o + 6] = L.ink[2]; a[o + 7] = Math.max(0.3, L.radius);
  }

  /** The heat's ledger read-back (called by src/matter.js apply, after src/eat.js has read the cells' stocks). */
  apply(rec, w) {
    const n16 = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_EXC_N + 16 * q + k]; return s; };
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot, A = 4096;
    XN.forEach((k, j) => { T[k] += n16(j) / A; });
    XE.forEach((k, j) => { T[k] += wide(LG_EXC_E + 128 * j) / HEAT_SCALE; });
    const H = this.hist, ALL = [...XN, ...XE];
    H.push([rec.time, ...ALL.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(ALL.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const M = this.matter, E = M.eat && M.eat.ledger, CH = M.CH;
    const dish = { g: M.dish[CH['g*']], t: M.dish[CH['t*']] };
    const cells = E && E.stock ? { g: E.stock[CH['g*']], t: E.stock[CH['t*']] } : { g: 0, t: 0 };
    const C = { time: rec.time, dish, cells, inDish: dish.g + dish.t, inCells: cells.g + cells.t,
      energy: (dish.g + dish.t + cells.g + cells.t) * this.table.energy, rate, tot: { ...T } };
    // breathing that runs (the swap engines' events) and burning, from the engines' counters (src/eat.js)
    const R2 = E && E.rate2 ? E.rate2 : null;
    if (R2) { C.swaps = R2.eSwap || 0; C.burns = R2.eBurn || 0; }   // (units per s)
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.inDish, C.inCells, rate.madeOpen + rate.madeCell, rate.fadeOpen + rate.fadeCell, rate.eBreath, rate.eEngine, rate.eBurn]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's EXCITED line. */
  panelLine(compact = false) {
    const C = this.census, p = this.params;
    if (!C) return `EXCITED  ${p.on ? '…' : 'off: the freed light atoms carry no energy (rules panel)'}`;
    const r = C.rate;
    if (compact) return `EXCITED g* ${fmt(C.dish.g)} t* ${fmt(C.dish.t)} · breathing +${fmt(r.eBreath)}/s vs burning +${fmt(r.eBurn)}/s`;
    return `EXCITED  ${p.on ? '' : '(off) '}haze g* ${fmt(C.dish.g)} · t* ${fmt(C.dish.t)} in the dish, ${fmt(C.inCells)} in cells · per s: made ${fmt(r.madeOpen + r.madeCell)}` +
      ` (light ${fmt(r.madeOpen)}, pigments ${fmt(r.madeCell)}) · faded ${fmt(r.fadeOpen + r.fadeCell)} · eaten by engines ${fmt(r.engine)}` +
      ` · breathing ${fmt(C.swaps || 0)} swaps banks +${fmt(r.eBreath)} (excitation +${fmt(r.eEngine)}) vs burning +${fmt(r.eBurn)} · as heat: faded ${fmt(r.eFade)}, loose ${fmt(r.eLoose)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, L = this.look, X = this.table, on = (x) => (x ? 'on' : 'off');
    const lines = [`excited waste (step C12c) ${on(p.on)}: a light atom freed by light keeps E* = ${X.share} × the photon's surplus ${X.surplus} = ${X.energy}` +
      ` (${X.e16} heat counts a count) · life ${p.life} s (× 1 / (1 + T / ${p.hot})) · drawn ${on(L.on)} (density ${L.density}, flicker ${L.flicker}/s)`];
    const C = this.census;
    if (C) {
      const r = C.rate;
      lines.push(`excited: dish g* ${fmt(C.dish.g)} t* ${fmt(C.dish.t)} · cells g* ${fmt(C.cells.g)} t* ${fmt(C.cells.t)} · energy held ${fmt(C.energy)}` +
        ` · per s: made in the open ${fmt(r.madeOpen)}, by pigments ${fmt(r.madeCell)} · faded open ${fmt(r.fadeOpen)}, in cells ${fmt(r.fadeCell)}` +
        ` · used: open reactions ${fmt(r.rxOpen)}, loose in cells ${fmt(r.rxIn)}, engines ${fmt(r.engine)}, bites ${fmt(r.bite)}` +
        ` · energy: engines → batteries ${fmt(r.eEngine)}, faded → heat ${fmt(r.eFade)}, loose → heat ${fmt(r.eLoose)}` +
        ` · batteries from breathing ${fmt(r.eBreath)}, from burning ${fmt(r.eBurn)}`);
      lines.push(`excited every 10 s (dish/cells, made, faded, breathing/excitation/burning into batteries): ${this.series.slice(-6).map((s) =>
        `${s[0].toFixed(0)}s ${fmt(s[1])}/${fmt(s[2])} ${fmt(s[3])} ${fmt(s[4])} ${fmt(s[5])}/${fmt(s[6])}/${fmt(s[7])}`).join(' ')}`);
    }
    return lines;
  }
}
