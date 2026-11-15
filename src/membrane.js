// Membrane chemistry (Part C, step C6c, its second half). The user, 2026-11-15: "Are they able to excrete? Can that be
// harmful to some? Maybe we need their membrane reacting with chemicals, not only through heat. Also the level of
// elasticity could be genetic."
//
// The membrane is now a MATERIAL: linker chains woven from the cell's stock, per side of its honeycomb outline (the stock
// buffer's words 16..27, cell_eat.wgsl). Nothing here names a toxin; harm is derived from the periodic table:
//   genes (Bio.memb, src/genome.js)  MIX: the heavy linkers' (L) share of the weave, the rest light (l); THICKNESS: linker
//                             per R of membrane; a STIFFNESS gene; the ION SELECTIVITY s
//   integrity (Cell.integ)    per side: what it holds over what the genes ask (thickness x its rest length, in the mix)
//   bites (rule)              a free reactive atom (giver or taker) at a side bites the chains of ITS OWN ROW (g, t bite
//                             l; G, T bite L), at kBite x its concentration x the side's length x that row's share of the
//                             side's weave x exp(-the chain's spark / (theta x temperature)): the table's sparks, so heavy
//                             chains are twice as hard to bite. The biting atom stays free (a catalyst of the breakdown);
//                             the bitten linkers go free into the dish
//   repair                    each side short of what it wants weaves linkers from the stock (repK of the shortfall per s),
//                             each linker paying its chain's spark from the battery (as heat)
//   consequences              a damaged membrane LEAKS (the exchange x (1 + leakK x the damage)), HOLDS LESS (the stock's
//                             capacity x (hold + (1 - hold) x integrity): a stock needs a closed membrane) and its damaged sides are
//                             SOFTER (cell_step.wgsl); a membrane that has been whole and is bitten below burstAt BURSTS:
//                             the cell spills its stock, its membrane (as free linkers) and its battery (as heat) where it
//                             is, and a neighbour's daughter takes its slot (with turnover on)
//   genetic elasticity (rule) the honeycomb's stiffness per cell from the material (heavy and thick = stiff, light and thin
//                             = soft) x the stiffness gene (memb_stiff in cell_common.wgsl)
//   ion selectivity (rule)    givers (+) pass the membrane x (1 + s), takers (-) x (1 - s) (passive exchange)
//
// The books: the membranes' linkers count with the cells' l and L in the atoms' ledger (exact, as everything else); the
// weave holds its linkers at the free linkers' energy (0), so weaving and bites change no stored energy; the sparks go
// from the batteries into heat. This module holds the switches and knobs (moire.membrane.params), reads the census back
// (the heat's ledger read-back, through src/eat.js) and writes the MEMBRANE panel line and the overlay lines.

import { fmt } from './heat.js';
import { SUBSTANCES, CH } from './matter.js';
import { MEMB_THIN, BIO_FLOATS } from './genome.js';
import { CELL_FLOATS } from './cells.js';

const LG_MB = 19712;        // heat_common.wgsl: 32 numbers x 16 slots
const MB = ['n', 'mix', 'thick', 'integ', 'asel', 'sel', 'ml', 'mh', 'whole', 'damaged', 'heavy', 'hinteg', 'stiff', 'seln', 'selq', 'qsel',
  'biteL', 'biteH', 'builtL', 'builtH', 'spark', 'bursts', 'shed', 'bitten'];
const MB_EV = MB.slice(16);
export const MB_WORDS = 32 * 16;
export const MB_SNAP_WORDS = 16 * 16;
if (CH.l !== 2 || CH.L !== 5) throw new Error('cell_eat.wgsl expects the linkers in channels 2 (l) and 5 (L)');

export class Membrane {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.membrane.params). Switches: the rules panel's group "Membrane chemistry (step C6c)" and URL options.
    this.params = {
      on: true,          // membrane chemistry (master): the material, integrity, repair, leak, softness (?membrane=0)
      bites: true,       // free reactive atoms bite the chains of their own row (?bites=0)
      burst: true,       // a whole membrane bitten below burstAt bursts (needs turnover; ?burst=0)
      elastic: true,     // genetic elasticity: the honeycomb's stiffness from the material and the gene (?elastic=0)
      select: true,      // the ion selectivity gene (?selectivity=0)
      // knobs
      kBite: 0.05,       // bites: linker units per s per R of side, per unit per R^2 of reactive atoms (x the share, the spark's factor)
      repK: 1.5,         // repair: share of a side's shortfall woven in per s (as the stock and battery allow)
      sideLen: 1.1,      // a side's rest length per r (the hexagon of area pi r^2)
      leakK: 2,          // leak: the exchange x (1 + leakK x (1 - mean integrity))
      leakMax: 4,        // ... at most this
      burstAt: 0.15,     // a whole membrane bitten while its mean integrity is below this bursts
      wholeAt: 0.5,      // a membrane counts as whole (it can burst from then on) once its mean integrity reached this
      shedAt: 1.25,      // a side holding more than this x what it wants lets the extra back into the stock ...
      shedK: 1,          // ... at this share per s
      tRef: MEMB_THIN,   // genetic elasticity: the thickness at which a light membrane has stiffness 1
      soft: 0.35,        // a fully damaged side's corner stiffness, as a share of its intact one
      hold: 0.3,         // a cell with no membrane holds only this share of its stock's capacity (a closed one: all of it)
    };
    this.tot = Object.fromEntries(MB_EV.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];     // [time, bursts per s, mean mix, mean integrity, heavy share, |sel|] every 10 s
  }

  /** Whether a sub-rule acts (cells eat and the master switch on, and its own). */
  rule(k) { return !!(this.eat.params.on && this.params.on && (k === 'on' || this.params[k])); }

  /** Bursting needs turnover (a neighbour's daughter takes the slot), as heat damage does. */
  get burstOn() { return this.rule('burst') && !!this.eat.cells.genome.rules.turn; }

  /** The eat uniform's membrane words (struct EatP mb0..mb4, from word 324): u = Uint32 view, f = Float32 view. */
  write(u, f, o) {
    const p = this.params, theta = this.eat.matter ? this.eat.matter.chem.theta : 1 / 32;
    const sp = (name) => SUBSTANCES[CH[name]].spark;
    u[o] = (this.rule('on') ? 1 : 0) | (this.rule('bites') ? 2 : 0) | (this.burstOn ? 4 : 0) | (this.rule('select') ? 8 : 0);
    f[o + 1] = Math.max(0, p.kBite); f[o + 2] = Math.max(0, p.repK); f[o + 3] = Math.max(0.1, p.sideLen);
    f[o + 4] = Math.max(0, p.leakK); f[o + 5] = Math.max(0, p.burstAt); f[o + 6] = Math.max(0, p.wholeAt); f[o + 7] = Math.max(1e-6, theta);
    f[o + 8] = Math.round(16 * sp('ll')); f[o + 9] = Math.round(16 * sp('LL')); f[o + 10] = sp('ll'); f[o + 11] = sp('LL');
    f[o + 12] = Math.max(1, p.shedAt); f[o + 13] = Math.max(0, p.shedK); f[o + 14] = Math.max(1, p.leakMax); f[o + 15] = Math.max(1e-4, p.tRef);
    f[o + 16] = Math.max(0, Math.min(1, p.hold));
  }

  /** The step's words in struct Fields (memb, from word 64; src/cells.js writeFields). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = (this.rule('elastic') ? 1 : 0) | (this.rule('on') ? 2 : 0) | (this.burstOn ? 4 : 0) |
      (this.eat.lipids && this.eat.lipids.active ? 8 : 0);   // step C12b: MB_LIPID, each corner's stiffness from its sides' lipids
    f[o + 1] = Math.max(1e-4, p.tRef); f[o + 2] = Math.max(0.02, Math.min(1, p.soft)); f[o + 3] = 0;
  }

  /** The heat's ledger read-back (Int32 words; called by src/eat.js apply). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_MB + 16 * q + k]; return s; };
    const T = this.tot;
    MB_EV.forEach((k, j) => { T[k] += v(16 + j); });
    const H = this.hist;
    H.push([rec.time, ...MB_EV.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(MB_EV.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const n = Math.max(1, v(0)), A = 4096;
    const C = {
      time: rec.time, n: v(0), mix: v(1) / 1000 / n, thick: v(2) / 100000 / n, integ: v(3) / 1000 / n, asel: v(4) / 1000 / n,
      sel: v(5) / 1000 / n, ml: v(6) / A, mh: v(7) / A, whole: v(8), damaged: v(9), heavy: v(10),
      hinteg: v(10) ? v(11) / 1000 / v(10) : 0, linteg: n - v(10) > 0 ? (v(3) - v(11)) / 1000 / (n - v(10)) : 0,
      stiff: v(12) / 1000 / n, seln: v(13), selq: v(14), qsel: v(15) / 1000 / n,
      rate: { biteL: rate.biteL / A, biteH: rate.biteH / A, builtL: rate.builtL / A, builtH: rate.builtH / A,
        spark: rate.spark / 65536, bursts: rate.bursts, shed: rate.shed / A, bitten: rate.bitten },
      bursts: T.bursts,
    };
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.rate.bursts, C.mix, C.integ, C.heavy / n, C.asel]);
      if (S.length > 400) S.shift();
    }
  }

  /**
   * For tuning and the time series (console, tools): reads the cells and genomes back and compares the fed cells (battery
   * at least `fed`) with the rest: count, heavy membranes (mix above 0.5), mean mix, thickness, integrity, whole share,
   * husks; and over the cells with a clear ion selectivity (|s| above 0.2) how their charge q goes with s.
   */
  async stats(fed = 0.3) {
    const C = this.eat.cells, d = C.device, n = C.count, F = CELL_FLOATS, B = BIO_FLOATS;
    const read = async (src, bytes) => {
      const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(src, 0, buf, 0, bytes);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const f = new Float32Array(buf.getMappedRange().slice(0));
      buf.destroy();
      return f;
    };
    const f = await read(C.cellBuf, n * F * 4), g = await read(C.bioBuf[C.bioCur], n * B * 4);
    const u = new Uint32Array(f.buffer);
    const grp = () => ({ n: 0, heavy: 0, mix: 0, thick: 0, integ: 0, whole: 0, husk: 0 });
    const G = { fed: grp(), rest: grp() };
    let sq = 0, ss = 0, sqs = 0, ns = 0, agree = 0, charged = 0;
    for (let i = 0; i < n; i++) {
      const o = i * F, b = i * B;
      if (!(u[o + 9] & 1)) continue;
      const x = f[o + 16] >= fed ? G.fed : G.rest;
      let im = 0;
      for (let k = 0; k < 6; k++) im += f[o + 48 + k] / 6;
      x.n++; x.mix += g[b + 40]; x.thick += g[b + 41]; x.integ += im;
      if (g[b + 40] > 0.5) x.heavy++;
      if (u[o + 9] & 0x40000) x.whole++;
      if (u[o + 9] & 0xf0) x.husk++;
      const s = g[b + 43], q = f[o + 22];
      if (Math.abs(s) > 0.2) {
        ns++; sq += q; ss += s; sqs += q * s;
        if (Math.abs(q) > 0.1) { charged++; if (Math.sign(q) === Math.sign(s)) agree++; }
      }
    }
    for (const x of Object.values(G)) for (const k of ['mix', 'thick', 'integ']) x[k] = x.n ? x[k] / x.n : 0;
    return { ...G, sel: { n: ns, charged, sameSign: agree, meanQS: ns ? sqs / ns : 0 } };
  }

  /** The entropy panel's MEMBRANE line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.eat.params.on) return 'MEMBRANE  (cells eat is off: Shift+A)';
    if (!this.params.on) return 'MEMBRANE  chemistry off (rules panel)';
    if (!C || !C.n) return 'MEMBRANE  …';
    const r = C.rate, pc = (x) => `${Math.round(100 * x / C.n)}%`;
    // step C12b: with the lipid membranes on, the integrity is the bilayer's, the mix gene is the oil share (the LIPIDS line) and
    // the old weave holds only the walls' glue
    if (this.eat.lipids && this.eat.lipids.active) {
      if (compact) return `MEMBRANE intact ${C.integ.toFixed(2)} · bursts ${fmt(r.bursts)}/s · |sel| ${C.asel.toFixed(2)}`;
      return `MEMBRANE  lipid bilayer: thickness ${C.thick.toFixed(3)} · integrity ${C.integ.toFixed(2)} (whole ${pc(C.whole)}, damaged ${C.damaged})` +
        ` · bursts ${fmt(r.bursts)}/s · glue linkers l ${fmt(C.ml)} L ${fmt(C.mh)} · |selectivity| ${C.asel.toFixed(2)}`;
    }
    if (compact) return `MEMBRANE mix ${C.mix.toFixed(2)} · intact ${C.integ.toFixed(2)} · bursts ${fmt(r.bursts)}/s · |sel| ${C.asel.toFixed(2)}`;
    return `MEMBRANE  mix ${C.mix.toFixed(2)} (heavy ${pc(C.heavy)}) · thickness ${C.thick.toFixed(3)} · integrity ${C.integ.toFixed(2)}` +
      ` (whole ${pc(C.whole)}, damaged ${C.damaged}) · bursts ${fmt(r.bursts)}/s · in membranes l ${fmt(C.ml)} L ${fmt(C.mh)}` +
      ` · bitten l ${fmt(r.biteL)} L ${fmt(r.biteH)}/s · |selectivity| ${C.asel.toFixed(2)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`membrane chemistry (step C6c) ${on(p.on)}: bites ${on(p.bites)} · bursting ${on(p.burst)}${this.eat.cells.genome.rules.turn ? '' : ' (needs turnover, T)'}` +
      ` · genetic elasticity ${on(p.elastic)} · ion selectivity ${on(p.select)} · bite ${p.kBite} · repair ${p.repK}/s · leak ${p.leakK} (≤ ×${p.leakMax})` +
      ` · burst below ${p.burstAt}, whole from ${p.wholeAt} · shed above ×${p.shedAt} at ${p.shedK}/s · stiffness 1 at thickness ${p.tRef} · damaged side ${p.soft} · an open membrane holds ${p.hold} of the capacity`];
    if (C && C.n) {
      const r = C.rate;
      lines.push(`membranes: ${C.n} cells · mix ${C.mix.toFixed(3)} · thickness ${C.thick.toFixed(4)} · integrity ${C.integ.toFixed(3)} (heavy ${C.heavy}: ${C.hinteg.toFixed(2)}, light: ${C.linteg.toFixed(2)})` +
        ` · whole ${C.whole}, damaged ${C.damaged} · material stiffness ${C.stiff.toFixed(2)} · linkers in membranes l ${fmt(C.ml)} L ${fmt(C.mh)}` +
        ` · per s: bitten l ${fmt(r.biteL)} L ${fmt(r.biteH)} (cell-ticks ${fmt(r.bitten)}), woven l ${fmt(r.builtL)} L ${fmt(r.builtH)} (sparks ${fmt(r.spark)}), shed ${fmt(r.shed)}, bursts ${fmt(r.bursts)} (${fmt(C.bursts)} in all)` +
        ` · selectivity mean ${C.sel.toFixed(3)}, |s| ${C.asel.toFixed(3)}, |s| > 0.3: ${C.seln} (charged ${C.selq}), mean q·s ${C.qsel.toFixed(4)}`);
      lines.push(`membranes every 10 s (bursts/s, mix, integrity, heavy share, |s|): ${this.series.slice(-8).map((s) => `${s[0].toFixed(0)}s ${fmt(s[1])}/${s[2].toFixed(2)}/${s[3].toFixed(2)}/${Math.round(100 * s[4])}%/${s[5].toFixed(2)}`).join(' ')}`);
    }
    return lines;
  }
}
