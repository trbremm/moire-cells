// Pumps and the membrane voltage (Part C, step C7). The user (CLAUDE.md, C7): "active chemical excretion without forcing
// the behaviour". A PUMP is a gene: two slots per genome (Bio.pump, src/genome.js), each a SUBSTANCE (any that spreads: the
// atoms, fuels and trace; never sediment), a DIRECTION (IN or OUT) and a RATE. Nothing here names a purpose: no rule says
// "excrete", "toxin", "steal" or "share"; those are only words for watching what selection makes of the pumps.
//   where a pump works        on all six sides of the cell, a sixth of its rate each (cell_eat.wgsl, plan and eat). A side
//                             touching a neighbour that touches it back (Cell.nbr, found by the step) trades with that
//                             neighbour's STOCK (rule "across contact"); a free side with the dish just outside it (the
//                             pixel beyond the side's middle)
//   how much                  per s, rate x the source's amount per cell volume: IN from a free side, the concentration
//                             outside x the cell's area; from a neighbour or OUT, the stock (an inflow x the room left)
//   what it costs             DOWN its gradient it is free (it only adds to the passive leak); UP it, per unit moved,
//                             base x a smooth ramp (0 at equal concentrations, full from `ramp` e-folds) + grad x the
//                             e-folds up (ln of the concentration ratio, capped at `lnMax`); plus upkeep per unit of rate.
//                             What the battery cannot pay is not pumped. All of it becomes heat at the cell
//   membrane VOLTAGE (rule)   the charge the pumps move (givers +1, takers -1) builds up across the membrane: stock word VQ;
//                             the voltage = that charge / the capacitance (cap x r / R). Moving more of the same sign the
//                             same way does work against it: the battery pays the voltage's energy gain (q^2 / 2C), which
//                             is STORED in the voltage (stock word EVW, part of the books' "stored"). It leaks back through
//                             the membrane at `vLeak` per s (x the permeability gene / 3 x the damaged membrane's leak);
//                             the energy it frees becomes heat, or with "voltage pays the battery" a share `v2b` of it goes
//                             back into the battery: a second battery. Pumping charge against the voltage it built is dear,
//                             pumping charge of the other sign (or the other way) is cheap and frees the voltage's energy
//   the charge picture        a pump's charge comes in (or leaves) through the side it passes (C6d's side charges); the atoms
//                             it puts into the dish or takes from it are the substrate field's charge (C6b) as always
// The books: matter only moves (whole counts; a request is written by the pumping cell alone and applied by both cells from
// the same numbers), so the atoms and the charge stay exact; energy moves battery -> heat (gradients, upkeep), battery ->
// voltage -> heat or battery (voltage), all in heat counts.
//
// This module holds the switches and knobs (moire.pumps.params), the census read-back (the heat's ledger, through src/eat.js),
// the PUMPS panel line, the overlay and stats() for the experiments.

import { fmt, HEAT_SCALE } from './heat.js';
import { SUBSTANCES } from './matter.js';
import { PUMP_CHANNELS, pumpOf, BIO_FLOATS } from './genome.js';
import { CELL_FLOATS } from './cells.js';

const LG_PU = 20224;               // heat_common.wgsl: 96 numbers x 16 slots (0..63 a snapshot, 64..95 counters)
export const PU_SNAP_WORDS = 64 * 16;
const SNAP = 64;
const PC = ['inLight', 'inHeavy', 'inLink', 'inFuel', 'inTrace', 'outLight', 'outHeavy', 'outLink', 'outFuel', 'outTrace',
  'cinLight', 'cinHeavy', 'cinLink', 'cinFuel', 'cinTrace', 'coutLight', 'coutHeavy', 'coutLink', 'coutFuel', 'coutTrace',
  'grad', 'vwork', 'vheat', 'vbat', 'upkeep', 'busy', 'charge'];
const CLASSES = ['light atoms', 'heavy atoms', 'linkers', 'fuel', 'trace'];
const CLS = ['Light', 'Heavy', 'Link', 'Fuel', 'Trace'];
const ENERGY = /^(grad|vwork|vheat|vbat|upkeep)$/;
const STOCK_WORDS = 32;            // cell_eat.wgsl SW

/** A pump gene's short name: "OUT g", "IN gT". */
export function geneName(bin) {
  const n = PUMP_CHANNELS.length, out = bin >= n;
  return `${out ? 'OUT' : 'IN'} ${SUBSTANCES[PUMP_CHANNELS[bin % n]].name}`;
}

export class Pumps {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.pumps.params). Switches: the rules panel's group "Pumps (step C7)" and URL options.
    this.params = {
      on: true,          // pumps (master): the genome's pump slots move substances (?pumps=0)
      contact: true,     // ... across contact: sides touching a neighbour pump from / into its stock (?pumpcontact=0)
      voltage: true,     // membrane voltage: pumped charge builds a voltage that makes pumping that sign dearer (?voltage=0)
      v2b: true,         // ... and as it leaks back it pays a share into the battery (else all heat) (?v2b=0)
      // knobs
      base: 0.1,         // energy per unit moved up a gradient (the ramp's full height)
      grad: 0.1,         // energy per unit moved per e-fold up the gradient (ln of the concentration ratio)
      ramp: 0.5,         // the base cost grows smoothly over this many e-folds from equal concentrations
      lnMax: 5,          // the gradient term's cap (e-folds; a ratio of about 150)
      eps: 0.01,         // units per R^2 added to both concentrations (an empty side costs finitely)
      maxRate: 4,        // the largest rate a pump slot runs at (per s; the gene may drift higher, up to 6)
      upkeep: 0.003,     // energy per s per unit of pump rate (as the engines')
      vLeak: 0.5,        // the voltage leaks back at this rate (per s, at the light atoms' permeability 3, a whole membrane)
      vCap: 0.1,         // capacitance: charge (atom-units) per unit of voltage, per r / R (small = the voltage builds fast)
      v2bEff: 0.5,       // the share of the voltage's energy that goes back into the battery as it leaks (with v2b)
      contactCap: 1 / 24, // the most a pump moves out of another cell's stock per side and slot per tick (keeps stocks >= 0)
    };
    this.tot = Object.fromEntries(PC.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];     // [time, active share, top gene bins, mean |V|, paid /s, to dish /s, across contact /s] every 10 s
  }

  /** Whether a sub-rule acts (cells eat and the master switch on, and its own). */
  rule(k) { return !!(this.eat.params.on && this.params.on && (k === 'on' || this.params[k])); }
  get contactOn() { return this.rule('contact'); }

  /** The eat uniform's pump words (struct EatP pu0..pu2, from word 344): u = Uint32 view, f = Float32 view. */
  write(u, f, o, dt) {
    const p = this.params;
    u[o] = (this.rule('on') ? 1 : 0) | (this.rule('contact') ? 2 : 0) | (this.rule('voltage') ? 4 : 0) | (this.rule('voltage') && p.v2b ? 8 : 0);
    // costs per count moved: energy per unit x HEAT_SCALE / ATOM_SCALE = x 16 heat counts per count
    f[o + 1] = Math.max(0, p.base) * 16; f[o + 2] = Math.max(0, p.grad) * 16; f[o + 3] = Math.max(0, Math.min(6, p.maxRate));
    f[o + 4] = Math.max(0, p.upkeep) * HEAT_SCALE * dt; f[o + 5] = Math.max(0, p.vLeak); f[o + 6] = Math.max(1e-3, p.vCap);
    f[o + 7] = Math.max(0, Math.min(1, p.v2bEff));
    f[o + 8] = Math.max(1e-6, p.eps); f[o + 9] = Math.max(0, p.lnMax); f[o + 10] = Math.max(1e-3, p.ramp);
    f[o + 11] = Math.max(0, Math.min(1 / 24, p.contactCap));
  }

  /** The heat's ledger read-back (Int32 words; called by src/eat.js apply). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_PU + 16 * q + k]; return s; };
    const T = this.tot, A = 4096;
    PC.forEach((k, j) => { T[k] += v(SNAP + j) / (ENERGY.test(k) ? HEAT_SCALE : k === 'busy' ? 1 : A); });
    const H = this.hist;
    H.push([rec.time, ...PC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(PC.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const sum = (pre) => CLS.reduce((x, c) => x + rate[pre + c], 0);
    const n = Math.max(1, v(0)), ng = 2 * PUMP_CHANNELS.length;
    const genes = Array.from({ length: ng }, (_, b) => v(16 + b));
    const genesFed = Array.from({ length: ng }, (_, b) => v(38 + b));
    const act = v(1);
    const C = {
      time: rec.time, n: v(0), act, batAct: act ? v(2) / 1000 / act : 0, batNone: v(0) - act > 0 ? v(3) / 1000 / (v(0) - act) : 0,
      fed: v(4), fedAct: v(5), rate: v(6) / 1000, avolt: v(7) / 1000 / n, volt: v(8) / 1000 / n, vcells: v(9), ev: v(10) * 256 / HEAT_SCALE,
      genes, genesFed,
      flow: { ...rate, toDish: sum('out'), fromDish: sum('in'), pulled: sum('cin'), pushed: sum('cout'), paid: rate.grad + rate.vwork + rate.upkeep },
    };
    C.top = genes.map((x, b) => [b, x]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]);
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.act / n, C.top.slice(0, 3).map((e) => `${geneName(e[0])} ${Math.round(100 * e[1] / n)}%`).join(', '), C.avolt,
        C.flow.paid, C.flow.toDish + C.flow.fromDish, C.flow.pulled + C.flow.pushed]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's PUMPS line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.eat.params.on) return 'PUMPS  (cells eat is off: Shift+A)';
    if (!this.params.on) return 'PUMPS  off (rules panel)';
    if (!C || !C.n) return 'PUMPS  …';
    const pc = (x) => `${Math.round(100 * x / C.n)}%`, F = C.flow;
    const top = C.top.slice(0, compact ? 2 : 3).map((e) => `${geneName(e[0])} ${pc(e[1])}`).join(compact ? ' ' : ', ') || 'none';
    if (compact) return `PUMPS ${pc(C.act)} · ${top} · |V| ${C.avolt.toFixed(2)} · paid ${fmt(F.paid)}/s`;
    return `PUMPS  active ${pc(C.act)} (top ${top}) · |voltage| ${C.avolt.toFixed(2)} (${C.vcells} cells > 0.1)` +
      ` · paid ${fmt(F.paid)}/s · moved to dish ${fmt(F.toDish)}/s, from dish ${fmt(F.fromDish)}/s, across contact ${fmt(F.pulled + F.pushed)}/s`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`pumps (step C7) ${on(p.on)}: across contact ${on(p.contact)} · voltage ${on(p.voltage)} · voltage pays battery ${on(p.v2b)}` +
      ` · cost base ${p.base} (ramp ${p.ramp} e-folds) + ${p.grad}/e-fold (≤ ${p.lnMax}) · max rate ${p.maxRate}/s · upkeep ${p.upkeep}/s per rate` +
      ` · voltage leak ${p.vLeak}/s, capacitance ${p.vCap}/R, back to battery ${p.v2bEff} · slot jumps ${this.eat.cells.genome.params.pumpJump} per birth`];
    if (C && C.n) {
      const F = C.flow, pc = (x) => `${Math.round(100 * x / C.n)}%`;
      const cls = (pre) => CLS.map((c, k) => `${CLASSES[k]} ${fmt(F[pre + c])}`).join(', ');
      lines.push(`pumps: active ${C.act} of ${C.n} (battery ${C.batAct.toFixed(2)} vs ${C.batNone.toFixed(2)} without) · fed ${C.fed} (with a pump ${C.fedAct})` +
        ` · genes ${C.top.slice(0, 8).map((e) => `${geneName(e[0])} ${pc(e[1])} (fed ${C.genesFed[e[0]]})`).join(', ') || 'none'}` +
        ` · voltage |V| ${C.avolt.toFixed(3)} mean ${C.volt.toFixed(3)}, ${C.vcells} cells > 0.1, energy ${fmt(C.ev)}`);
      lines.push(`pumps per s: to dish ${cls('out')} · from dish ${cls('in')} · pulled from neighbours ${cls('cin')} · pushed into neighbours ${cls('cout')}` +
        ` · paid: gradients ${fmt(F.grad)}, voltage ${fmt(F.vwork)}, upkeep ${fmt(F.upkeep)} · voltage freed: heat ${fmt(F.vheat)}, battery ${fmt(F.vbat)}` +
        ` · cells pumping ${fmt(F.busy)} cell-ticks/s · charge moved ${fmt(F.charge)}/s`);
      lines.push(`pumps every 10 s (active, top, |V|, paid/s, dish/s, contact/s): ${this.series.slice(-6).map((s) => `${s[0].toFixed(0)}s ${Math.round(100 * s[1])}% [${s[2]}] ${s[3].toFixed(2)} ${fmt(s[4])} ${fmt(s[5])} ${fmt(s[6])}`).join(' · ')}`);
    }
    return lines;
  }

  /**
   * For tuning and the experiments (console, tools): reads the cells, genomes and stocks back. Per pump gene (substance and
   * direction, rate at least 0.05): carriers, their mean battery, mean |voltage|, how many sit in the light, and the free
   * light atoms (g + t, units per R^2) in the dish under them; and the same for the cells without a pump.
   */
  async stats() {
    const C = this.eat.cells, d = C.device, n = C.count, F = CELL_FLOATS, B = BIO_FLOATS;
    const read = async (src, bytes) => {
      const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(src, 0, buf, 0, bytes);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const a = buf.getMappedRange().slice(0);
      buf.destroy();
      return a;
    };
    const fc = new Float32Array(await read(C.cellBuf, n * F * 4)), uc = new Uint32Array(fc.buffer);
    const g = new Float32Array(await read(C.bioBuf[C.bioCur], n * B * 4));
    const st = new Int32Array(await read(this.eat.stockBuf, n * STOCK_WORDS * 4));
    const L = this.eat.heat.light, sp = L && L.modeIndex === 1 ? L.spot() : null;
    const lit = (x, y) => (L ? (L.modeIndex === 2 || (sp && Math.hypot(x - sp.x, y - sp.y) < sp.r)) : false);
    const groups = {};
    const add = (key, i) => {
      const G = groups[key] || (groups[key] = { n: 0, bat: 0, volt: 0, lit: 0, fuel: 0, freeLight: 0 });
      const o = i * F;
      G.n++; G.bat += fc[o + 16]; G.volt += Math.abs(fc[o + 63]);
      if (lit(fc[o], fc[o + 1])) G.lit++;
      let fu = 0, fl = 0;
      for (let c = 6; c < 10; c++) fu += st[i * STOCK_WORDS + c] / 4096;
      fl = (st[i * STOCK_WORDS] + st[i * STOCK_WORDS + 1]) / 4096;
      G.fuel += fu; G.freeLight += fl;
    };
    for (let i = 0; i < n; i++) {
      if (!(uc[i * F + 9] & 1)) continue;
      let any = false;
      for (let k = 0; k < 2; k++) {
        const P = pumpOf(g, i * B, k);
        if (P.rate < 0.05) continue;
        any = true;
        add(`${P.out ? 'OUT' : 'IN'} ${SUBSTANCES[P.ch].name}`, i);
      }
      if (!any) add('none', i);
    }
    for (const G of Object.values(groups)) for (const k of ['bat', 'volt', 'fuel', 'freeLight']) G[k] = G.n ? +(G[k] / G.n).toFixed(4) : 0;
    return Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].n - a[1].n));
  }
}
