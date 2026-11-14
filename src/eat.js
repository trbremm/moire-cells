// Cells eat (Part C, step C5). Every cell holds a STOCK of the 13 substances and a BATTERY (energy), in its own buffer
// (16 i32 per cell; cell_eat.wgsl), in the same whole counts as the dish (ATOM_SCALE per substance unit, HEAT_SCALE per
// energy unit), so the atoms ledger stays exact and the energy books balance with the cells in them.
//
// What it does (the rules; each a switch in the action table, src/actions.js):
//   cells eat (Shift+A)       the master switch. The membrane trades with the dish under the cell, passively, by
//                             concentration: per substance at PERMEABILITY x its spreading speed (light atoms pass
//                             easily, heavy fuel slowly, sediment never); a cell holds at most capR2 per R^2 of its area
//   burner (Shift+U)          every cell's built-in engine: fuel -> its two atoms; the bond's energy into the battery,
//                             minus a share (ineff) that becomes heat at the cell. The spark is paid from the battery first
//                             (and given back), so an empty battery starts nothing; trace inside lowers it
//   reactions inside (Shift+I) the table's heat-driven reactions (fuel breaking by heat, swaps, sediment forming) run inside
//                             the cells too, by the same rules as in the open, sparked by the local heat (no light inside);
//                             sediment formed inside is expelled where the cell is
//   battery pays crawl (Shift+W) crawling is as fast as the battery allows (full speed from crawlFull of it) and costs it
//                             crawlCost x the crawl's work (cell_step.wgsl); Brownian kicks from the heat stay free
//   heat damage (Shift+X)     a cell's death rate rises where the dish is hotter than the tolerance `tol`
//   energy-biased turnover (Shift+G) the neighbour that divides into a dead cell's slot is picked by battery (rich wins)
//   smell (Shift+N)           the membrane's 6 corners sample the fuels; the crawl steers up the fuel gradient
// A death hands the dead cell's stock back to the dish where it died and its battery as heat; a birth splits the parent's
// stock and battery in half (never copies). A new culture (N, G) hands every cell's stock back and gives every cell a
// starter charge (booked as energy in).
//
// The books (with the heat's ledger read-back): atoms in cells (per channel, 64-bit), batteries, starter charges in, and
// counters (burned, into batteries, heat, uptake, release, ...). src/matter.js adds the atoms in cells to its ledger
// (added = in dish + in cells + out); src/heat.js adds the cells' chemical energy and the batteries to "stored", and the
// starter charges to "in".

import { loadFieldShader } from './field.js';
import { HEAT_COMMON_URL, HEAT_SCALE, LEDGER_WORDS, fmt } from './heat.js';
import { SUBSTANCES, NCH, CH, ATOM_SCALE } from './matter.js';

const SW = 16;                      // stock words per cell (cell_eat.wgsl)
const EP_BYTES = 384;               // struct EatP
const LG_K = { STOCK: 11520, BAT: 13184, START: 13312, EV: 13440, COUNT: 15488 };   // heat_common.wgsl (COUNT: 5 x 64)
const EV = ['burned', 'gain', 'bheat', 'inBurn', 'inSwap', 'inForm', 'uptake', 'release', 'expel', 'paid', 'dump', 'batBack', 'gone', 'inHeat'];
const SED_MASK = SUBSTANCES.reduce((m, s, c) => (s.kind === 'sediment' ? m | (1 << c) : m), 0);
const ROW1 = SUBSTANCES[CH.g].spread;   // the light atoms' spreading speed: permeability's reference

export class Eat {
  constructor(device, cells) {
    this.device = device;
    this.cells = cells;
    // live-tunable: moire.eat.params. Switches are the rules (keys); the rest are knobs.
    this.params = {
      on: true,           // Shift+A: cells eat (everything below; off: the cells ignore the substances, as in step C4)
      burner: true,       // Shift+U: the built-in burner
      inside: true,       // Shift+I: the table's heat-driven reactions inside cells
      pay: true,          // Shift+W: the battery pays for crawling (and gates it)
      heat: true,         // Shift+X: heat damage
      bias: true,         // Shift+G: energy-biased turnover
      smell: true,        // Shift+N: smell (chemotaxis up the fuel gradient)
      // knobs
      perm: 3,            // permeability: per s, for the light atoms; each substance x its spreading speed / theirs
      capR2: 2,           // stock capacity: atom-units per R^2 of the cell's area
      batMax: 4,          // battery capacity (energy units)
      kBurner: 2,         // the burner: share of the fuel in stock it burns per s
      burnMax: 2,         // ... at most this many fuel units per s per cell
      ineff: 0.25,        // the burner's inefficiency: this share of the bond's energy becomes heat at the cell
      starter: 0.4,       // starter charge at a new culture, as a share of the battery's capacity (energy in)
      crawlFull: 0.3,     // battery share from which a cell crawls at full speed (below: in proportion; empty: not at all)
      crawlCost: 0.012,   // battery paid per unit of crawl work (the crawl's work is 0.5 (v / 10 px/s)^2 per unit)
      tol: 15,            // heat damage: tolerated temperature (heat per R^2; the culture in the spot at noon is about 13 to 16)
      heatKill: 0.1,      // ... extra deaths per s x (temperature / tol - 1), at most this (from twice the tolerance)
      biasFloor: 0.05,    // energy-biased turnover: a neighbour's weight = biasFloor + its battery share
      smellGain: 0.5,     // smell: crawl speed up the fuel gradient, R / s at a strong gradient (x motility, x the gate)
      smellHalf: 0.05,    // ... fuel gradient (energy per R^2 per R) that gives tanh(1) of it
    };
    this.ledger = null;
    this.tot = Object.fromEntries(EV.map((k) => [k, 0]));
    this.start = 0;            // starter charges in (energy units, cumulative)
    this.hist = [];
    this.heatVersion = -1;
  }

  static async create(device, cells) {
    const e = new Eat(device, cells);
    await e.init();
    return e;
  }

  async init() {
    const d = this.device;
    const mod = await loadFieldShader(d, 'src/shaders/cell_eat.wgsl', [HEAT_COMMON_URL, 'src/shaders/cell_common.wgsl']);
    const C = GPUShaderStage.COMPUTE;
    this.bgl = d.createBindGroupLayout({
      label: 'cell eat',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } },
        { binding: 1, visibility: C, buffer: { type: 'storage' } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
        { binding: 3, visibility: C, buffer: { type: 'storage' } },
        { binding: 4, visibility: C, buffer: { type: 'uniform' } },
        { binding: 5, visibility: C, buffer: { type: 'uniform' } },
        { binding: 6, visibility: C, buffer: { type: 'uniform' } },
        { binding: 9, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    // the plan pass: plain views (the stock, the heat buffer's grid part), no atomics (cell_eat.wgsl)
    this.bglP = d.createBindGroupLayout({
      label: 'cell eat plan',
      entries: [0, 1, 2, 4, 6, 7, 9].map((binding) => ({ binding, visibility: C,
        buffer: binding === 0 ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 }
          : binding === 4 || binding === 6 ? { type: 'uniform' } : { type: 'storage' } })),
    });
    const layout = d.createPipelineLayout({ label: 'cell eat', bindGroupLayouts: [this.bgl] });
    const layoutP = d.createPipelineLayout({ label: 'cell eat plan', bindGroupLayouts: [this.bglP] });
    this.pipes = {};
    for (const e of ['dump', 'split', 'eat', 'ledger', 'reset']) {
      this.pipes[e] = d.createComputePipeline({ label: `cell ${e}`, layout, compute: { module: mod, entryPoint: e } });
    }
    this.pipes.plan = d.createComputePipeline({ label: 'cell plan', layout: layoutP, compute: { module: mod, entryPoint: 'plan' } });
    const U = GPUBufferUsage, n = this.cells.count;
    this.stockBuf = d.createBuffer({ label: 'cell stock', size: n * SW * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.fluxBuf = d.createBuffer({ label: 'cell flux', size: n * SW * 4, usage: U.STORAGE });
    this.paramBuf = d.createBuffer({ label: 'cell eat params', size: EP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.paramAB = new ArrayBuffer(EP_BYTES);
  }

  get heat() { return this.cells.heat; }
  get matter() { return this.cells.matter; }

  makeBG() {
    const H = this.heat, M = this.matter;
    if (!H.buffer || !M || !M.chemBuf) return null;
    if (this.bg && this.heatVersion === H.version) return this.bg;
    this.heatVersion = H.version;
    const b = (binding, buffer, size) => ({ binding, resource: size ? { buffer, size } : { buffer } });
    this.bg = this.device.createBindGroup({
      label: 'cell eat', layout: this.bgl,
      entries: [b(0, this.cells.simBuf, 256), b(1, this.cells.cellBuf), b(2, this.stockBuf), b(3, H.buffer),
        b(4, this.paramBuf), b(5, M.chemBuf), b(6, H.paramBuf), b(9, this.fluxBuf)],
    });
    this.bgP = this.device.createBindGroup({
      label: 'cell eat plan', layout: this.bglP,
      entries: [b(0, this.cells.simBuf, 256), b(1, this.cells.cellBuf), b(2, this.stockBuf), b(4, this.paramBuf),
        b(6, H.paramBuf), { binding: 7, resource: { buffer: H.buffer, offset: LEDGER_WORDS * 4 } }, b(9, this.fluxBuf)],
    });
    return this.bg;
  }

  /** Whether a sub-rule acts (the master switch and its own). */
  rule(k) { return !!(this.params.on && this.params[k]); }

  /** The battery's capacity in heat counts. */
  get batCounts() { return Math.max(1, Math.round(this.params.batMax * HEAT_SCALE)); }

  /** Write the eat uniform (struct EatP) for this frame (mask: the channels the dish moves). */
  writeParams(dt, mask, resetCur = 0, heatEnd = 0) {
    const p = this.params, H = this.heat;
    const u = new Uint32Array(this.paramAB), f = new Float32Array(this.paramAB), i = new Int32Array(this.paramAB);
    u[0] = (p.on ? 1 : 0) | (this.rule('burner') ? 2 : 0) | (this.rule('inside') ? 4 : 0);
    u[1] = mask >>> 0; u[2] = H.n; u[3] = Math.round(Math.max(0, Math.min(1, p.ineff)) * 256);
    u[4] = SED_MASK; i[5] = Math.round(Math.max(0, p.starter) * this.batCounts); i[6] = this.batCounts; u[7] = resetCur;
    f[8] = dt; f[9] = this.cells.R; f[10] = Math.max(0, p.capR2); f[11] = Math.max(0, p.kBurner);
    f[12] = Math.max(0, p.burnMax) * dt * ATOM_SCALE; f[13] = Math.max(0, p.tol); u[14] = heatEnd;
    u[15] = this.rule('smell') ? 1 : 0;
    SUBSTANCES.forEach((s, c) => {
      f[16 + c] = Math.max(0, p.perm) * s.spread / ROW1;          // perm: sediment 0 (it does not spread)
      i[32 + c] = s.e16;
      u[48 + c] = s.kind === 'fuel' ? (CH[s.atoms[0]] | (CH[s.atoms[1]] << 8)) : 0xffff;
      f[64 + c] = s.atoms.length;
      f[80 + c] = s.spark;
    });
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramAB);
  }

  /** The frame's set-up (after the matter's beginFrame, which decides the channels that move). */
  beginFrame(frame, ticks) {
    const M = this.matter;
    this.ready = !!this.makeBG();
    if (!this.ready) return;
    // (the heat copy current after the frame's `ticks` ticks, warm-up included: the ledger's temperatures)
    this.writeParams(frame.tickDt, M ? M.active || 0 : 0, 0, this.heat.offsetAt(ticks));
  }

  /** Tick t's eating (Sim slot t), after the cells' step. */
  encodeTick(encoder, t, slot) {
    if (!this.ready) return;
    const pass = encoder.beginComputePass({ label: 'cell eat' });
    const wg = Math.ceil(this.cells.count / 64);
    pass.setBindGroup(0, this.bg, [t * slot]);
    pass.setPipeline(this.pipes.dump); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.split); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.plan); pass.setBindGroup(0, this.bgP, [t * slot]); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.eat); pass.setBindGroup(0, this.bg, [t * slot]); pass.dispatchWorkgroups(wg);
    pass.end();
  }

  /** Once per frame, with the heat's ledger (before its copy): the atoms and energy in the cells. */
  encodeLedger(encoder) {
    if (!this.ready || !this.bg) return;
    encoder.clearBuffer(this.heat.buffer, LG_K.STOCK * 4, (LG_K.START - LG_K.STOCK) * 4);
    encoder.clearBuffer(this.heat.buffer, LG_K.COUNT * 4, 320 * 4);
    const pass = encoder.beginComputePass({ label: 'cell eat ledger' });
    pass.setPipeline(this.pipes.ledger);
    pass.setBindGroup(0, this.bg, [0]);
    pass.dispatchWorkgroups(Math.ceil(this.cells.count / 64));
    pass.end();
  }

  /**
   * A new culture (before the new cells are written; queue order puts this first): every cell's stock back to the dish
   * at its place (into channels the dish moves; the rest booked as gone), its battery as heat, then the starter charge.
   */
  reset() {
    const M = this.matter;
    if (!this.makeBG()) return false;
    const cur = M && M.bufVersion === this.heat.version ? M.copyAt(0, true) : 0;
    const mask = cur ? (M.active || 0) : 0;
    this.writeParams(1 / 60, mask, cur);
    if (M && mask) M.touch(mask);
    const e = this.device.createCommandEncoder({ label: 'cell eat reset' });
    const pass = e.beginComputePass({ label: 'cell eat reset' });
    pass.setPipeline(this.pipes.reset);
    pass.setBindGroup(0, this.bg, [0]);
    pass.dispatchWorkgroups(Math.ceil(this.cells.count / 64));
    pass.end();
    this.device.queue.submit([e.finish()]);
    return true;
  }

  /** The starter charge's battery share (for the new cells' Cell.bat). */
  get starterShare() { return Math.max(0, Math.min(1, this.params.starter)); }

  /** The heat's ledger read-back (Int32 words), in order (before the matter's and the heat's own). */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const plain = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k]; return s; };
    const stock = new Float64Array(NCH);
    for (let c = 0; c < NCH; c++) stock[c] = wide(LG_K.STOCK + 128 * c) / ATOM_SCALE;
    const bat = wide(LG_K.BAT) / HEAT_SCALE;
    this.start += wide(LG_K.START) / HEAT_SCALE;
    const T = this.tot;
    EV.forEach((k, j) => {
      const v = wide(LG_K.EV + 128 * j);
      T[k] += /^(gain|bheat|paid|batBack|inHeat)$/.test(k) ? v / HEAT_SCALE : v / ATOM_SCALE;
    });
    const cnt = [0, 1, 2, 3, 4].map((k) => plain(LG_K.COUNT + 64 * k));
    const atoms = SUBSTANCES.reduce((x, s, c) => x + stock[c] * s.atoms.length, 0);
    const chem = SUBSTANCES.reduce((x, s, c) => x + stock[c] * s.energy, 0);
    const H = this.hist;
    H.push([rec.time, ...EV.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 1) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(EV.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    this.ledger = { time: rec.time, stock, atoms, chem, bat, start: this.start, full: cnt[0], empty: cnt[1], stuffed: cnt[2], n: cnt[3], hot: cnt[4], rate };
  }

  /** The entropy panel's line (step C5). */
  panelLine(compact = false) {
    const L = this.ledger;
    if (!L) return 'CELLS  …';
    if (!this.params.on) return `CELLS  not eating (Shift+A) · batteries ${fmt(L.bat)} · atoms inside ${fmt(L.atoms)}`;
    const r = L.rate, n = Math.max(1, L.n);
    if (compact) return `CELLS battery ${fmt(L.bat)} · full ${(100 * L.full / n).toFixed(0)}% · empty ${(100 * L.empty / n).toFixed(0)}% · burn ${fmt(r.gain)}/s`;
    return `CELLS  batteries ${fmt(L.bat)} (full ${(100 * L.full / n).toFixed(0)}%, empty ${(100 * L.empty / n).toFixed(0)}%) · atoms inside ${fmt(L.atoms)}` +
      ` · fuel inside ${fmt(L.chem)} · burner +${fmt(r.gain)}/s · crawl −${fmt(r.paid)}/s`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, L = this.ledger, on = (x) => (x ? 'on' : 'off');
    const lines = [`cells eat (step C5) Shift+A ${on(p.on)}: U burner ${on(p.burner)} · I reactions inside ${on(p.inside)} · W battery pays crawl ${on(p.pay)}` +
      ` · X heat damage ${on(p.heat)} · G energy-biased turnover ${on(p.bias)} · N smell ${on(p.smell)}` +
      ` · perm ${p.perm}/s · capacity ${p.capR2}/R² · battery ${p.batMax} · burner ${p.kBurner}/s (≤ ${p.burnMax}/s), ineff ${p.ineff}` +
      ` · starter ${p.starter} · crawl full at ${p.crawlFull}, cost ${p.crawlCost} · tolerance ${p.tol}/R², kill ${p.heatKill}/s · bias ${p.biasFloor} · smell ${p.smellGain} R/s (half ${p.smellHalf})`];
    if (L) {
      const r = L.rate, n = Math.max(1, L.n);
      lines.push(`cells per s: fuel burned ${fmt(r.burned)} → battery ${fmt(r.gain)} + heat ${fmt(r.bheat)} · crawl paid ${fmt(r.paid)}` +
        ` · inside: fuel broken by heat ${fmt(r.inBurn)}, swaps ${fmt(r.inSwap)}, sediment ${fmt(r.inForm)} (heat ${fmt(r.inHeat)}), expelled ${fmt(r.expel)}` +
        ` · atoms in ${fmt(r.uptake)}, out ${fmt(r.release)} · at deaths: atoms back ${fmt(r.dump)}, battery → heat ${fmt(r.batBack)}, gone ${fmt(r.gone)}`);
      lines.push(`cells: batteries ${fmt(L.bat)} (mean ${(L.bat / n).toFixed(2)} of ${p.batMax}; above half ${L.full}, below 5 % ${L.empty}, stock over half full ${L.stuffed} of ${L.n};` +
        ` hotter than the tolerance ${L.hot})` +
        ` · inside: ${SUBSTANCES.map((s, c) => (L.stock[c] > 0 ? `${s.name} ${fmt(L.stock[c])}` : null)).filter(Boolean).join(' · ') || 'nothing'}` +
        ` · chemical energy inside ${fmt(L.chem)} · starter charges in ${fmt(L.start)}`);
    }
    return lines;
  }
}
