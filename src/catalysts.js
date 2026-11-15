// Catalysts (Part C, step C7b). The cells' engines are already their catalysts (enzymes); the open dish had only trace,
// which lowers every reaction's spark where it sits (step C4). Two more rules, both DERIVED (nothing set per substance):
//   crystal seeding (rule)    SEDIMENT LOWERS THE SPARK OF ITS OWN FORMATION: l + l -> ll starts more easily where ll
//                             already is, L + L -> LL where LL is (crust grows on crust: autocatalysis). The spark x
//                             max(floor, 1 / (1 + s / s0)), s the chain already there: the pixel's own amount, or the mean
//                             of its 4 neighbours' if that is more (so a crust also grows at its edge, into the next pixel).
//                             In the open only (matter.wgsl, react): inside a cell there is never sediment to seed on (what
//                             forms there is expelled at once, step C5), so the same rule would do nothing there
//   trace as cofactor (rule)  AN ENGINE'S RATE SCALES WITH THE TRACE INSIDE THE CELL, saturating: rate x (f0 + (1 - f0) x
//                             tr / (tr + tHalf)), tr the cell's trace per R^2 of its area, f0 a floor (a cell without trace
//                             still runs, slowly). For a pigment's engine the photons it catches stay the same, it can use
//                             only that share of them (the rest becomes heat, as photons with nothing to work on). Trace
//                             becomes a scarce vitamin; a pump slot "IN trace" (step C7) may now pay off. No rule says so.
// The books: nothing new moves (a spark is a rate, and the cofactor only scales how many events run), so atoms, charge and
// energy stay exact as before.
//
// This module holds the switches and knobs (moire.catalysts.params), writes them into the chemistry's and the eat pass's
// uniforms, reads the census back (the heat's ledger, LG_CAT, through src/eat.js), and gives the CATALYSTS panel line, the
// overlay and stats() (the crusts' patches, from the grid) for the experiments.

import { fmt, LEDGER_WORDS } from './heat.js';
import { CH, ATOM_SCALE } from './matter.js';

const LG_CAT = 21760;          // heat_common.wgsl: 16 numbers x 16 slots (a snapshot, the ledger pass)
export const CAT_SNAP_WORDS = 16 * 16;
const CT = ['n', 'f', 'tr', 'has', 'nl', 'fl', 'pump', 'pumpBat', 'pumpTr', 'bat', 'fed', 'fedF'];

export class Catalysts {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.catalysts.params). Switches: the rules panel's group "Catalysts (step C7b)" and URL options.
    this.params = {
      crystal: true,     // crystal seeding: sediment lowers the spark of its own formation (?crystal=0)
      cofactor: true,    // trace as cofactor: the engines' rates scale with the trace inside the cell (?cofactor=0)
      // knobs
      s0: 0.05,          // seeding: sediment per R^2 that halves the spark of its formation
      floor: 0.1,        // ... the spark never falls below this share of itself
      f0: 0.35,          // cofactor: the engines' speed with no trace inside, as a share of full
      tHalf: 0.002,      // ... trace per R^2 inside the cell that gives half the way from f0 to full
    };
    this.census = null;
    this.series = [];      // [time, mean cofactor factor, trace in cells, trace in dish, IN-trace pump carriers, crust ll, LL]
    this.crust = null;     // the last stats() result (crust patches)
  }

  get crystalOn() { const M = this.eat.matter; return !!(this.params.crystal && M && M.chem.on && M.chem.sediment); }
  get cofactorOn() { return !!(this.params.cofactor && this.eat.params.on && this.eat.params.engines); }

  /** The chemistry uniform's words (struct ChemP cry, from word o): on, 1 / s0, floor. */
  writeChem(f, o) {
    const p = this.params;
    f[o] = this.crystalOn ? 1 : 0; f[o + 1] = 1 / Math.max(1e-4, p.s0); f[o + 2] = Math.max(0, Math.min(1, p.floor)); f[o + 3] = 0;
  }

  /** The eat uniform's words (struct EatP cat, from word o): on, f0, tHalf. */
  writeEat(f, o) {
    const p = this.params;
    f[o] = this.cofactorOn ? 1 : 0; f[o + 1] = Math.max(0, Math.min(1, p.f0)); f[o + 2] = Math.max(1e-6, p.tHalf);
  }

  /** The heat's ledger read-back (Int32 words; called by src/eat.js apply). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_CAT + 16 * q + k]; return s; };
    const x = Object.fromEntries(CT.map((k, j) => [k, v(j)]));
    const E = this.eat.ledger, M = this.eat.matter;
    const pumpBin = this.pumpBin();
    const P = this.eat.pumps.census;
    const C = {
      time: rec.time, n: x.n, factor: x.n ? x.f / 1000 / x.n : 1, factorLit: x.nl ? x.fl / 1000 / x.nl : 1, nl: x.nl,
      trMean: E && E.n ? x.tr / 1e6 / E.n : 0, has: x.has,
      pump: x.pump, pumpBat: x.pump ? x.pumpBat / 1000 / x.pump : 0, pumpTr: x.pump ? x.pumpTr / 1e6 / x.pump : 0,
      bat: x.n ? x.bat / 1000 / x.n : 0, fed: x.fed, fedFactor: x.fed ? x.fedF / 1000 / x.fed : 1,
      trCells: E ? E.stock[CH.trace] : 0, trDish: M ? M.dish[CH.trace] : 0,
      ll: M ? M.dish[CH.ll] : 0, LL: M ? M.dish[CH.LL] : 0,
      pumpGene: P && pumpBin >= 0 ? P.genes[pumpBin] : 0,
    };
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.factor, C.trCells, C.trDish, C.pump, C.ll, C.LL]);
      if (S.length > 400) S.shift();
    }
  }

  /** The pumps' census bin of the gene "IN trace" (src/pumps.js geneName). */
  pumpBin() { return 10; }

  /** The entropy panel's CATALYSTS line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census;
    if (!p.crystal && !p.cofactor) return 'CATALYSTS  off (rules panel)';
    if (!C) return 'CATALYSTS  …';
    const crust = `crust ll ${fmt(C.ll)} LL ${fmt(C.LL)}${p.crystal ? '' : ' (seeding off)'}`;
    const cof = this.cofactorOn ? `engines at ${Math.round(100 * C.factor)}%` : 'cofactor off';
    if (compact) return `CATALYSTS ll ${fmt(C.ll)} LL ${fmt(C.LL)} · ${this.cofactorOn ? `engines ${Math.round(100 * C.factor)}%` : 'cofactor off'} · trace ${fmt(C.trCells)}`;
    return `CATALYSTS  ${crust} · ${cof} (in the light ${Math.round(100 * C.factorLit)}%, fed cells ${Math.round(100 * C.fedFactor)}%)` +
      ` · trace in cells ${fmt(C.trCells)}, in the dish ${fmt(C.trDish)} · cells with trace ≥ half ${C.has}` +
      ` · IN-trace pumps ${C.pump} (battery ${C.pumpBat.toFixed(2)} vs ${C.bat.toFixed(2)})`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`catalysts (step C7b): crystal seeding ${on(p.crystal)} (s0 ${p.s0}/R², spark ≥ ${p.floor} of itself) · trace as cofactor ${on(p.cofactor)}` +
      ` (no trace: ${p.f0} of full speed, half the way at ${p.tHalf} trace/R² inside)`];
    if (C) {
      lines.push(`catalysts: cells with an engine ${C.n} at ${(100 * C.factor).toFixed(1)}% of full speed (in the light ${C.nl}, ${(100 * C.factorLit).toFixed(1)}%;` +
        ` fed ${C.fed}, ${(100 * C.fedFactor).toFixed(1)}%) · trace inside per cell ${C.trMean.toExponential(2)}/R², ≥ half ${C.has}` +
        ` · IN-trace pump carriers ${C.pump} (battery ${C.pumpBat.toFixed(2)}, trace ${C.pumpTr.toExponential(2)}/R²) vs all ${C.bat.toFixed(2)}` +
        `${this.crust ? ` · crust (stats at ${this.crust.time.toFixed(0)} s): ${this.crust.pixels} px in ${this.crust.patches} patches, largest ${this.crust.largest}` : ''}`);
      lines.push(`catalysts every 10 s (factor, trace cells/dish, IN-trace pumps, crust ll/LL): ${this.series.slice(-6).map((s) => `${s[0].toFixed(0)}s ${(100 * s[1]).toFixed(0)}% ${fmt(s[2])}/${fmt(s[3])} ${s[4]} ${fmt(s[5])}/${fmt(s[6])}`).join(' · ')}`);
    }
    return lines;
  }

  /**
   * For tuning and the experiments (console, tools): the crusts as patches. Reads the substance grid back, marks every pixel
   * whose sediment (ll + LL) is at least `level` per R^2 (default: the drawing's sedStep), and counts the crust pixels, the
   * 4-connected patches, the largest patch, the edge pixels (crust next to no crust: a front's length) and the amounts of
   * ll and LL in crust. Resolves to an object; also kept for the overlay.
   */
  async stats(level) {
    const M = this.eat.matter, H = M.heat, d = M.device, n = H.n;
    const lv = level ?? M.params.sedStep;
    const bytes = 2 * n * 4, base = M.copyBase(M.cur);
    const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(H.buffer, (LEDGER_WORDS + base + CH.ll * n) * 4, buf, 0, bytes);   // ll, LL are next to each other
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const w = new Int32Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const a = H.px / H.R, conc = 1 / (ATOM_SCALE * a * a);
    const crust = new Uint8Array(n);
    let pixels = 0, inLl = 0, inLL = 0;
    for (let i = 0; i < n; i++) {
      const s = (w[i] + w[n + i]) * conc;
      if (s >= lv) { crust[i] = 1; pixels++; inLl += w[i] * conc; inLL += w[n + i] * conc; }
    }
    const lab = new Int32Array(n), W = H.hw, Hh = H.hh, stack = [];
    let patches = 0, largest = 0, edge = 0;
    for (let i = 0; i < n; i++) {
      if (!crust[i]) continue;
      const x = i % W, y = (i / W) | 0;
      if ((x > 0 && !crust[i - 1]) || (x + 1 < W && !crust[i + 1]) || (y > 0 && !crust[i - W]) || (y + 1 < Hh && !crust[i + W])) edge++;
      if (lab[i]) continue;
      patches++;
      let size = 0;
      lab[i] = patches; stack.push(i);
      while (stack.length) {
        const j = stack.pop(); size++;
        const jx = j % W;
        for (const k of [jx > 0 ? j - 1 : -1, jx + 1 < W ? j + 1 : -1, j - W, j + W]) {
          if (k >= 0 && k < n && crust[k] && !lab[k]) { lab[k] = patches; stack.push(k); }
        }
      }
      largest = Math.max(largest, size);
    }
    // in units of R^2 too (a pixel is (px / R)^2 R^2)
    this.crust = { time: this.eat.cells.time ?? 0, level: lv, pixels, areaR2: +(pixels * a * a).toFixed(1), patches, largest, edge,
      ll: +(inLl * a * a).toFixed(2), LL: +(inLL * a * a).toFixed(2) };
    if (window.moire && window.moire.time) this.crust.time = window.moire.time();
    return this.crust;
  }
}
