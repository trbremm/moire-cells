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
//
// Step C6, engines in the genome (each a switch too): every cell carries three ENGINE SLOTS in its genome (Bio.eng, Bio.rate;
// ENGINES in src/matter.js): harvest (make fuel by the light its pigment catches), burn, swap, form, each with a rate;
// plus a heat TOLERANCE and a PERMEABILITY gene. The rules:
//   engines (Shift+O)         the engines from the genome run (off: none; then only "everyone burns" makes energy)
//   everyone burns (Shift+U)  C5's built-in burner in every cell (off by default since C6, to compare the two)
//   pigments (Shift+Y)        harvest engines' pigments catch their band of the light (booked as light in; they put their
//                             depth down in the heat buffer, so the dish under them gets that much less of the band)
//   upkeep (Shift+Q)          per s, upEng x the engines' rates and upTol x tolerance / tolRef, from the battery, as heat
//   tolerance gene (Shift+Z)  heat damage by each cell's own tolerance (off: the global `tol`, and no upkeep for it)
//   permeability gene (Shift+J) the membrane's rate per cell (off: the global `perm`)
// Strategies (census, view): harvest (a harvest engine, no burn engine), burn (a burn engine, no harvest one), both, other.
//
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
import { SUBSTANCES, NCH, NCH_CELL, CH, ATOM_SCALE, ENGINES, ENGINE_KINDS, CHARGE_CODES, EXC0 } from './matter.js';
import { BANDS, LIGHT_COMMON_URL } from './light.js';
import { Membrane, MB_SNAP_WORDS } from './membrane.js';
import { Pumps, PU_SNAP_WORDS } from './pumps.js';
import { Catalysts, CAT_SNAP_WORDS } from './catalysts.js';
import { HardLight, HL_SNAP_WORDS } from './hardlight.js';
import { Lipids, LIP_SNAP } from './lipids.js';

export const SW = 64;               // stock words per cell (cell_eat.wgsl; 16 until step C6c's membranes, words 16..27; step C7:
                                    // 14 the pumped charge across the membrane, 15 the voltage's energy; 32 until step C12b's
                                    // lipid membrane, words 32..61)
const EP_BYTES = 1648;              // struct EatP (step C6c: + mb0..mb4; step C7: + pu0..pu2; step C7b: + cat; step C8: + hl;
                                    // step C9: + dv; step C10: + wl0, wl1; step C12b: + lp[9])
const EP_LP = 376;                  // ... its words lp (step C12b)
const EP_DV = 364;                  // ... its word dv (step C9)
const EP_WL = 368;                  // ... its word wl0 (step C10)
const LG_DIV = 22272;               // heat_common.wgsl: step C9's counters (the divisions' cost)
const EP_CAT = 356;                 // ... its word cat (step C7b)
const EP_HL = 360;                  // ... its word hl (step C8)
const EP_PU = 344;                  // ... its word pu0
const EP_MB = 324;                  // ... its word mb0 (after eng: 132 + 8 x 24)
const LG_MB = 19712;                // heat_common.wgsl: the membrane census (its first 16 numbers are a snapshot)
const LG_PU = 20224;                // heat_common.wgsl: the pumps' census (its first 64 numbers are a snapshot)
const LG_CAT = 21760;               // heat_common.wgsl: the catalysts' census (a snapshot; step C7b)
const LG_HL = 22016;                // heat_common.wgsl: the hard light census (its first 8 numbers are a snapshot; step C8)
// heat_common.wgsl (COUNT: 5 x 64; step C6: EV2 16 counters, 64-bit; CEN the census, 72 numbers x 16 slots)
const LG_K = { STOCK: 11520, BAT: 13184, START: 13312, EV: 13440, COUNT: 15488, EV2: 15872, CEN: 17920 };
const EV2 = ['pig0', 'pig1', 'pig2', 'pig3', 'made', 'deficit', 'eBurn', 'eSwap', 'eForm', 'eGain', 'eHeat', 'upkeep', 'idle', 'stored'];
const EV2_ENERGY = /^(pig\d|deficit|eGain|eHeat|upkeep|idle)$/;
export const STRATS = ['harvest', 'burn', 'both', 'other'];
const CEN_N = 76;
const LG_Q_CEN = 19136;
const LG_EXC_K = 26624;             // step C12c (heat_common.wgsl): the excited atoms in the cells' stocks, 2 channels, 64-bit             // step C6b (heat_common.wgsl): the cells' charge, 4 numbers x 16 slots
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
      burner: false,      // Shift+U: everyone burns (C5's built-in burner; off by default since step C6's engines)
      engines: true,      // Shift+O: step C6, the engines from the genome
      pigments: true,     // Shift+Y: ... harvest engines' pigments catch light
      upkeep: true,       // Shift+Q: ... engines and tolerance cost upkeep
      tolGene: true,      // Shift+Z: ... the heat tolerance is each cell's gene (off: `tol` for all)
      permGene: true,     // Shift+J: ... the permeability is each cell's gene (off: `perm` for all)
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
      // step C6
      engMax: 2,          // an engine slot runs at most this many units per s (fuel made or burned, swaps, chains)
      pigK: 0.12,         // a pigment's optical depth per unit of its slot's rate (a rate of 1 catches 11 % of its band)
      upEng: 0.003,       // upkeep: energy per s per unit of engine rate
      upTol: 0.003,       // upkeep: energy per s for a tolerance of tolRef (in proportion to the tolerance)
      tolRef: 15,
    };
    this.tot2 = Object.fromEntries(EV2.map((k) => [k, 0]));
    this.hist2 = [];
    this.pig = { tot: 0, rate: [0, 0, 0, 0], sum: 0 };   // light caught by the pigments (energy units; per s by band)
    this.census = null;     // step C6: the strategies (see apply)
    this.censusHist = [];   // [time, share per strategy] every 10 s of simulation time (for the overlay's time line)
    this.ledger = null;
    this.tot = Object.fromEntries(EV.map((k) => [k, 0]));
    this.start = 0;            // starter charges in (energy units, cumulative)
    this.hist = [];
    this.heatVersion = -1;
    this.charge = null;        // step C6b: the charge (src/charge.js; set by main.js)
    this.membrane = new Membrane(this);   // step C6c: the membrane chemistry (src/membrane.js)
    this.pumps = new Pumps(this);         // step C7: pumps and the membrane voltage (src/pumps.js)
    this.catalysts = new Catalysts(this); // step C7b: the catalysts (src/catalysts.js)
    this.hardlight = new HardLight(this); // step C8: hard light mutates (src/hardlight.js)
    this.lipids = new Lipids(this);       // step C12b: lipid membranes (src/lipids.js)
  }

  static async create(device, cells) {
    const e = new Eat(device, cells);
    await e.init();
    return e;
  }

  async init() {
    const d = this.device;
    const mod = await loadFieldShader(d, 'src/shaders/cell_eat.wgsl', [HEAT_COMMON_URL, LIGHT_COMMON_URL, 'src/shaders/cell_common.wgsl']);
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
        { binding: 8, visibility: C, buffer: { type: 'uniform' } },             // step C6: the light
        { binding: 9, visibility: C, buffer: { type: 'storage' } },
        { binding: 10, visibility: C, buffer: { type: 'read-only-storage' } },  // step C6: the genomes
      ],
    });
    // the plan pass: plain views (the stock, the heat buffer's grid part), no atomics (cell_eat.wgsl)
    this.bglP = d.createBindGroupLayout({
      label: 'cell eat plan',
      entries: [0, 1, 2, 4, 6, 7, 9, 10].map((binding) => ({ binding, visibility: C,
        buffer: binding === 0 ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 }
          : binding === 4 || binding === 6 ? { type: 'uniform' } : binding === 10 ? { type: 'read-only-storage' } : { type: 'storage' } })),
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
    if (!H.buffer || !M || !M.chemBuf || !H.light) return null;
    if (this.bgs && this.heatVersion === H.version) return this.bgs;
    this.heatVersion = H.version;
    const b = (binding, buffer, size) => ({ binding, resource: size ? { buffer, size } : { buffer } });
    // one bind group per genome copy (the genome is double-buffered: bioBuf[cells.bioCur] is this tick's)
    this.bgs = this.cells.bioBuf.map((bio) => this.device.createBindGroup({
      label: 'cell eat', layout: this.bgl,
      entries: [b(0, this.cells.simBuf, 256), b(1, this.cells.cellBuf), b(2, this.stockBuf), b(3, H.buffer),
        b(4, this.paramBuf), b(5, M.chemBuf), b(6, H.paramBuf), b(8, H.light.buffer), b(9, this.fluxBuf), b(10, bio)],
    }));
    this.bgPs = this.cells.bioBuf.map((bio) => this.device.createBindGroup({
      label: 'cell eat plan', layout: this.bglP,
      entries: [b(0, this.cells.simBuf, 256), b(1, this.cells.cellBuf), b(2, this.stockBuf), b(4, this.paramBuf),
        b(6, H.paramBuf), { binding: 7, resource: { buffer: H.buffer, offset: LEDGER_WORDS * 4 } }, b(9, this.fluxBuf), b(10, bio)],
    }));
    return this.bgs;
  }
  /** The bind groups for this tick's genome copy. */
  get bg() { return this.bgs ? this.bgs[this.cells.bioCur] : null; }
  get bgP() { return this.bgPs ? this.bgPs[this.cells.bioCur] : null; }

  /** Step C6: blocks of n words this keeps in the heat buffer (the pigments' depth, per band visible 1, visible 2, hard). */
  get blocks() { return 3; }
  /** Step C6: whether the cells' pigments catch light (the switches; the heat adds whether the light is on). */
  get pigmentsOn() { return this.rule('engines') && !!this.params.pigments; }

  /** Whether a sub-rule acts (the master switch and its own). */
  rule(k) { return !!(this.params.on && this.params[k]); }

  /** The battery's capacity in heat counts. */
  get batCounts() { return Math.max(1, Math.round(this.params.batMax * HEAT_SCALE)); }

  /** Write the eat uniform (struct EatP) for this frame (mask: the channels the dish moves). */
  writeParams(dt, mask, resetCur = 0, heatEnd = 0) {
    const p = this.params, H = this.heat;
    const u = new Uint32Array(this.paramAB), f = new Float32Array(this.paramAB), i = new Int32Array(this.paramAB);
    u[0] = (p.on ? 1 : 0) | (this.rule('burner') ? 2 : 0) | (this.rule('inside') ? 4 : 0) |
      (this.rule('engines') ? 8 : 0) | (this.pigmentsOn ? 16 : 0) | (this.rule('upkeep') ? 32 : 0) |
      (this.rule('tolGene') ? 64 : 0) | (this.rule('permGene') ? 128 : 0);
    u[1] = mask >>> 0; u[2] = H.n; u[3] = Math.round(Math.max(0, Math.min(1, p.ineff)) * 256);
    u[4] = SED_MASK; i[5] = Math.round(Math.max(0, p.starter) * this.batCounts); i[6] = this.batCounts; u[7] = resetCur;
    f[8] = dt; f[9] = this.cells.R; f[10] = Math.max(0, p.capR2); f[11] = Math.max(0, p.kBurner);
    f[12] = Math.max(0, p.burnMax) * dt * ATOM_SCALE; f[13] = Math.max(0, p.tol); u[14] = heatEnd;
    u[15] = this.rule('smell') ? 1 : 0;
    SUBSTANCES.forEach((s, c) => {
      if (c >= 16) return;                                        // (step C12c: the excited atoms read their ground twin's; their
                                                                  // energy is ChemP.ex.y)
      f[16 + c] = Math.max(0, p.perm) * s.spread / ROW1;          // perm: sediment 0 (it does not spread)
      i[32 + c] = s.e16;
      u[48 + c] = s.kind === 'fuel' ? (CH[s.atoms[0]] | (CH[s.atoms[1]] << 8)) : 0xffff;
      f[64 + c] = s.atoms.length;
      f[80 + c] = s.spark;
      f[116 + c] = s.spread / ROW1;                               // step C6: the permeability gene's scale per channel
    });
    // step C6: the engines' knobs and table (struct Eng: ch, kind, g16, spark)
    f[96] = Math.max(0, p.engMax) * dt * ATOM_SCALE; f[97] = Math.max(0, p.pigK);
    f[98] = Math.max(0, p.upEng) * HEAT_SCALE * dt; f[99] = Math.max(0, p.upTol) * HEAT_SCALE * dt; f[100] = Math.max(1e-3, p.tolRef);
    u[101] = H.pigOn ? H.pigOffset : 0;
    // step C6b, charge (src/charge.js): where the cells put their net charge down, q's scale, the field's gradient
    const Q = this.charge;
    u[102] = Q && Q.cellsDeposit && H.buffer ? H.chargeOffset + H.n : 0;
    f[103] = 1 / Math.max(1e-3, Q ? Q.params.qHalf : 0.5);
    u[104] = Q && Q.feelOn ? 1 : 0;
    u[105] = Q && H.buffer ? H.chargeOffset - LEDGER_WORDS : 0;
    u[106] = CHARGE_CODES;
    this.cells.dipole.writeEat(u, f, 107);   // step C6d: charge per side
    BANDS.forEach((b, k) => { i[112 + k] = Math.round(16 * b.photon); });
    ENGINES.forEach((e, k) => {
      const o = 132 + 8 * k;
      u[o] = e.ins[0]; u[o + 1] = e.ins.length > 1 ? e.ins[1] : 255; u[o + 2] = e.outs[0]; u[o + 3] = e.outs.length > 1 ? e.outs[1] : 255;
      u[o + 4] = e.kind; i[o + 5] = e.g16; f[o + 6] = e.spark; u[o + 7] = 0;
    });
    this.membrane.write(u, f, EP_MB);   // step C6c
    this.pumps.write(u, f, EP_PU, dt);  // step C7
    this.catalysts.writeEat(f, EP_CAT); // step C7b
    this.hardlight.writeEat(f, EP_HL, dt); // step C8
    // step C9: a reset fills the first `start` slots (they get the starter charge); a division's cost (heat counts)
    u[EP_DV] = this.cells.start; u[EP_DV + 1] = this.cells.division.costCounts; u[EP_DV + 2] = 0; u[EP_DV + 3] = 0;
    this.cells.walls.writeEat(u, f, EP_WL, dt);   // step C10: the walls' pattern, maturity, linker cost and upkeep
    this.lipids.write(u, f, EP_LP);               // step C12b: the lipid membranes
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
    // (after the step, which flipped cells.bioCur: bg is this tick's genome copy)
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
    encoder.clearBuffer(this.heat.buffer, LG_K.CEN * 4, CEN_N * 16 * 4);   // step C6: the census
    encoder.clearBuffer(this.heat.buffer, LG_Q_CEN * 4, 4 * 16 * 4);       // step C6b: the cells' charge
    encoder.clearBuffer(this.heat.buffer, LG_MB * 4, MB_SNAP_WORDS * 4);   // step C6c: the membrane census (snapshot)
    encoder.clearBuffer(this.heat.buffer, LG_PU * 4, PU_SNAP_WORDS * 4);   // step C7: the pumps' census (snapshot)
    encoder.clearBuffer(this.heat.buffer, LG_CAT * 4, CAT_SNAP_WORDS * 4); // step C7b: the catalysts' census (snapshot)
    encoder.clearBuffer(this.heat.buffer, LG_HL * 4, HL_SNAP_WORDS * 4);   // step C8: the hard light census (snapshot)
    encoder.clearBuffer(this.heat.buffer, LIP_SNAP.E * 4, (LIP_SNAP.E_WORDS + LIP_SNAP.S_WORDS) * 4);   // step C12b: the lipids (snapshot)
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
    for (let c = 0; c < NCH_CELL; c++) stock[c] = wide(LG_K.STOCK + 128 * c) / ATOM_SCALE;   // (step C12: the cells hold 0..12; the rest 0)
    for (let j = 0; j < 2; j++) stock[EXC0 + j] = wide(LG_EXC_K + 128 * j) / ATOM_SCALE;     // (step C12c: and the excited atoms)
    const bat = wide(LG_K.BAT) / HEAT_SCALE;
    this.start += wide(LG_K.START) / HEAT_SCALE;
    const T = this.tot;
    EV.forEach((k, j) => {
      const v = wide(LG_K.EV + 128 * j);
      T[k] += /^(gain|bheat|paid|batBack|inHeat)$/.test(k) ? v / HEAT_SCALE : v / ATOM_SCALE;
    });
    const cnt = [0, 1, 2, 3, 4].map((k) => plain(LG_K.COUNT + 64 * k));
    const atoms = SUBSTANCES.reduce((x, s, c) => x + stock[c] * s.atoms.length, 0);
    // (step C12b: the lipid membranes' molecules are in `stock` as their atoms, at the free atoms' energy; their chemical energy,
    // below that, is counted on its own)
    this.lipids.apply(rec, w);
    const chem = SUBSTANCES.reduce((x, s, c) => x + stock[c] * s.energy, 0) + this.lipids.energy;
    // what the cells hold per channel (for the dish's active channels): the stock, and the membranes' molecules as themselves
    const held = Float64Array.from(stock);
    for (let c = 0; c < NCH; c++) held[c] += this.lipids.held[c];
    const H = this.hist;
    H.push([rec.time, ...EV.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 1) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(EV.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    // step C6: the engines' counters (energy in energy units, matter in substance units) and the census
    const T2 = this.tot2;
    EV2.forEach((k, j) => { const v = wide(LG_K.EV2 + 128 * j); T2[k] += EV2_ENERGY.test(k) ? v / HEAT_SCALE : v / ATOM_SCALE; });
    const H2 = this.hist2;
    H2.push([rec.time, ...EV2.map((k) => T2[k])]);
    while (H2.length > 2 && rec.time - H2[1][0] >= 1) H2.shift();
    const dt2 = rec.time - H2[0][0];
    const rate2 = Object.fromEntries(EV2.map((k, j) => [k, dt2 > 0.05 ? (H2[H2.length - 1][1 + j] - H2[0][1 + j]) / dt2 : 0]));
    const pr = [0, 1, 2, 3].map((b) => rate2[`pig${b}`]);
    this.pig = { tot: T2.pig0 + T2.pig1 + T2.pig2 + T2.pig3, rate: pr, sum: pr.reduce((a, b) => a + b, 0) };
    this.census = this.readCensus(w, rec.time);
    this.membrane.apply(rec, w);   // step C6c
    this.pumps.apply(rec, w);      // step C7
    this.ledger = { time: rec.time, stock, held, atoms, chem, bat, start: this.start, full: cnt[0], empty: cnt[1], stuffed: cnt[2], n: cnt[3], hot: cnt[4], rate, rate2 };
    this.catalysts.apply(rec, w);  // step C7b (after the ledger: it reads the trace in the cells)
    this.hardlight.apply(rec, w);  // step C8
    // step C9: the energy the divisions' cost turned into heat
    let dc = 0;
    for (let k = 0; k < 16; k++) dc += w[LG_DIV + k];
    this.cells.division.applyLedger(rec.time, dc / HEAT_SCALE);
  }

  /**
   * Step C6: the strategies' census from the read-back: per strategy, in the light (spot or full field) and in the dark:
   * cells, mean battery share, mean rates (harvest, burn, other engines), mean tolerance and permeability, cells above half
   * a battery; and the harvest slots per pigment band.
   */
  readCensus(w, time) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_K.CEN + 16 * q + k]; return s; };
    const cls = (st, dark) => {
      const o = 8 * (st + 4 * dark), n = v(o);
      return { n, bat: v(o + 1) / 1000, rh: v(o + 2) / 1000, rb: v(o + 3) / 1000, ro: v(o + 4) / 1000, tol: v(o + 5) / 100, perm: v(o + 6) / 1000, full: v(o + 7) };
    };
    const C = { time, lit: STRATS.map((s, k) => cls(k, 0)), dark: STRATS.map((s, k) => cls(k, 1)) };
    C.all = STRATS.map((s, k) => {
      const a = C.lit[k], b = C.dark[k], r = {};
      for (const key of Object.keys(a)) r[key] = a[key] + b[key];
      return r;
    });
    C.n = C.all.reduce((x, c) => x + c.n, 0);
    C.bands = { lit: [0, 1, 2, 3].map((b) => v(64 + b)), dark: [0, 1, 2, 3].map((b) => v(68 + b)) };
    // cells carrying an uphill swap (a light-driven swap harvester) and a downhill swap engine (a "breather")
    C.up = { lit: v(72), dark: v(74) };
    C.breath = { lit: v(73), dark: v(75) };
    // the free light atoms in the dish (from the matter's last read-back): the waste of the uphill swaps, food of breathers
    const D = this.matter ? this.matter.dish : null;
    C.free = { g: D ? D[CH.g] : 0, t: D ? D[CH.t] : 0 };
    const H = this.censusHist, last = H[H.length - 1];
    if (!last || time - last[0] >= 10 || time < last[0]) {
      if (last && time < last[0]) H.length = 0;
      H.push([time, ...C.all.map((c) => (C.n ? c.n / C.n : 0)), C.free.g, C.free.t, C.up.lit + C.up.dark, C.breath.lit + C.breath.dark]);
      if (H.length > 400) H.shift();
    }
    return C;
  }

  /** Step C6: the entropy panel's strategies line. */
  strategyLine(compact = false) {
    const C = this.census;
    if (!C || !C.n) return 'ENGINES  …';
    const p = this.params;
    if (!p.on || !p.engines) return `ENGINES  not running (${!p.on ? 'Shift+A' : 'Shift+O'})${p.burner ? ' · everyone burns' : ''}`;
    const pc = (x) => `${Math.round(100 * x / C.n)}%`;
    const sh = { harvest: 'harvest', burn: 'burn', both: 'both', other: 'other' };
    const mb = (c) => (c.n ? Math.round(100 * c.bat / c.n) : 0);
    const T = C.all.reduce((x, c) => x + c.tol, 0) / C.n, P = C.all.reduce((x, c) => x + c.perm, 0) / C.n;
    const ab = { harvest: 'h', burn: 'b', both: 'h+b', other: 'o' };
    const up = C.up.lit + C.up.dark, br = C.breath.lit + C.breath.dark;
    if (compact) return `ENGINES ${STRATS.map((s, k) => `${ab[s]} ${pc(C.all[k].n)}`).join(' ')} · free g ${fmt(C.free.g)} t ${fmt(C.free.t)}`;
    const nl = C.lit.reduce((x, c) => x + c.n, 0);
    const lit = nl ? `${STRATS.map((s, k) => Math.round(100 * C.lit[k].n / nl)).join(' · ')} %` : '-';
    return `ENGINES  ${STRATS.map((s, k) => `${sh[s]} ${pc(C.all[k].n)}`).join(' · ')}  (batteries ${STRATS.map((s, k) => mb(C.all[k])).join(' · ')} %)` +
      ` · in the light ${lit} · tolerance ${T.toFixed(1)} · perm ${P.toFixed(2)}` +
      `\nFREE LIGHT ATOMS  g ${fmt(C.free.g)} · t ${fmt(C.free.t)} in the dish · cells with an uphill swap ${up} · breathers (downhill swap) ${br}`;
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
    const lines = [`cells eat (step C5) Shift+A ${on(p.on)}: U everyone burns ${on(p.burner)} · I reactions inside ${on(p.inside)} · W battery pays crawl ${on(p.pay)}` +
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
    // step C6
    lines.push(`engines (step C6) Shift+O ${on(p.engines)}: Y pigments ${on(p.pigments)} · Q upkeep ${on(p.upkeep)} · Z tolerance gene ${on(p.tolGene)}` +
      ` · J permeability gene ${on(p.permGene)} · engine max ${p.engMax}/s per slot · pigment depth ${p.pigK} per rate` +
      ` · upkeep ${p.upEng}/s per rate + ${p.upTol}/s x tolerance/${p.tolRef} · slot jumps ${this.cells.genome.params.engJump} per birth`);
    if (L && L.rate2) {
      const r = L.rate2;
      lines.push(`engines per s: pigments caught ${fmt(this.pig.sum)} (${BANDS.map((b, k) => `${b.name} ${fmt(this.pig.rate[k])}`).join(', ')})` +
        ` → made uphill ${fmt(r.made)} (+ by storers ${fmt(r.stored)}; battery paid ${fmt(r.deficit)} for sparks and differences; idle photons ${fmt(r.idle)}) · burned ${fmt(r.eBurn)}, swapped ${fmt(r.eSwap)}, sediment ${fmt(r.eForm)}` +
        ` → batteries +${fmt(r.eGain)} · engines' heat ${fmt(r.eHeat)} · upkeep −${fmt(r.upkeep)} · pigment light in all ${fmt(this.pig.tot)}`);
    }
    const C = this.census;
    if (C && C.n) {
      const row = (c, s) => (c.n ? `${s} ${c.n} (bat ${(c.bat / c.n).toFixed(2)}, >½ ${c.full}; rates h ${(c.rh / c.n).toFixed(2)} b ${(c.rb / c.n).toFixed(2)} o ${(c.ro / c.n).toFixed(2)};` +
        ` tol ${(c.tol / c.n).toFixed(1)}, perm ${(c.perm / c.n).toFixed(2)})` : `${s} 0`);
      lines.push(`strategies in the light: ${STRATS.map((s, k) => row(C.lit[k], s)).join(' · ')}`);
      lines.push(`strategies in the dark: ${STRATS.map((s, k) => row(C.dark[k], s)).join(' · ')}`);
      const bn = ['storers', 'visible 1', 'visible 2', 'hard'];
      lines.push(`uphill slots by pigment in the light: ${[0, 1, 2, 3].map((b) => `${bn[b]} ${C.bands.lit[b]}`).join(', ')} · in the dark: ${[0, 1, 2, 3].map((b) => `${bn[b]} ${C.bands.dark[b]}`).join(', ')}` +
        ` · over time (share h/b/hb/o every 10 s): ${this.censusHist.slice(-8).map((h) => `${h[0].toFixed(0)}s ${h.slice(1, 5).map((x) => Math.round(100 * x)).join('/')}`).join(' ')}`);
      lines.push(`uphill swaps (light upgrades a fuel, a light atom goes free): ${C.up.lit} cells in the light, ${C.up.dark} in the dark · breathers (downhill swap engines): ${C.breath.lit} in the light, ${C.breath.dark} in the dark` +
        ` · free light atoms in the dish g ${fmt(C.free.g)}, t ${fmt(C.free.t)} · every 60 s (g/t/uphill/breathers): ${this.censusHist.filter((h, j, a) => j === a.length - 1 || Math.floor(h[0] / 60) !== Math.floor((a[j + 1] || h)[0] / 60)).slice(-10).map((h) => `${h[0].toFixed(0)}s ${fmt(h[5])}/${fmt(h[6])}/${h[7]}/${h[8]}`).join(' ')}`);
    }
    return lines;
  }
}
