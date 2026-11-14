// The cells: a fixed number of them, all state on the GPU.
//
// State: one storage buffer of struct Cell (cell_common.wgsl, 48 bytes each), in a fixed order: index i is
// always the same cell, which keeps the drawing order stable.
// Drawing: instanced quads (cell_draw.wgsl), crisp discs with an outline and the cell's lattice as dots.
//
// Neighbour grid (cell_grid.wgsl), rebuilt every tick on the GPU: a counting sort by grid cell.
//   counts[g]  cells in grid cell g;  starts[g]  first slot of g in the sorted list;
//   sorted[j]  copy of the cells in grid order;  sortIdx[j]  that cell's index in `cells`.
// Grid cells are params.range x R wide (CSS px), so all contacts lie in the 3 x 3 block around a cell.
// A pass that needs neighbours binds sim (dynamic offset), counts, starts, sorted and sortIdx, and loops as
// cell_check.wgsl does. Per tick: clear counts, then count, scan_local, scan_top, scan_add, scatter.
//
// Per-tick uniforms (struct Sim) sit in slots 256 bytes apart in one buffer, bound with a dynamic offset, so
// several ticks in one frame each get their own tick number.
//
// The loop (step 4): in the grid's scatter pass every cell also works out its beat against the medium
// (struct CellBeat, cell_common.wgsl) into `beats`, in sorted order. The cells' field is drawn by scattering:
// each cell adds its beat x envelope over a quad into a half-resolution rgba16float texture (cell_field.wgsl),
// which the landscape's halftone dots read.
//
// Size: the cells' radius R is the reference's R (from the screen area, 5 to 9 CSS px), but smaller when
// that many cells would not fit in a round blob of about 0.8 x the dish height (so 10 000 or 50 000 cells
// get smaller). See `fitR`.
//
// URL: ?cells=N  number of cells (default 2000)
//      ?check=1  every 2 s, compare the grid's contacts with a brute-force count (console and overlay)

import { loadFieldShader, KIND } from './field.js';
import { Genome, BIO_BYTES } from './genome.js';

export const CELL_URL = 'src/shaders/cell_common.wgsl';

// struct Cell in cell_common.wgsl: pos.xy, vel.xy, r, la, e1, e2, kind (u32), flags (u32), seed (u32), aux
export const CELL_FLOATS = 12;
export const CELL_BYTES = CELL_FLOATS * 4;
const ALIVE = 1;

export const DEFAULT_CELLS = 2000;
export const MAX_CELLS = 262144;

const SIM_BYTES = 256;         // struct Sim
const SLOT = 256;              // uniform slot stride (minUniformBufferOffsetAlignment is at most 256)
const SLOTS = 128;             // ticks that can be encoded in one frame
const BLOCK = 512;             // scan block (cell_grid.wgsl)
const BRUTE_MAX = 20000;       // largest count the ?check brute force runs on
const STATS_BYTES = 8192;      // struct Stats in cell_common.wgsl (counters, events, census)
const STATS_CENSUS = 1088;     // byte offset of the key bins (then the founder bitmap) in struct Stats
const STATS_EVENTS = 64;
const MAX_SRC = 16;            // sources the cells feel (MAX_CELL_SOURCES in cell_common.wgsl)
const CELL_BEAT_BYTES = 80;    // struct CellBeat in cell_common.wgsl
const FIELD_FORMAT = 'rgba16float';
export const ANCHORS = ['sliding moire (reference)', 'pinned to the cell', 'still in the world'];

export class Cells {
  constructor(device, format, medium, count, seed) {
    this.device = device;
    this.genome = new Genome(seed);
    this.format = format;
    this.medium = medium;
    this.count = Math.max(1, Math.min(MAX_CELLS, Math.round(count) || DEFAULT_CELLS));
    this.R = 9;
    this.view = null;
    this.tick = 0;
    this.grid = { gw: 0, gh: 0, cs: 1, n: 0, cap: 0 };
    this.checkOn = false;
    this.checkResult = null;   // last ?check result, for the overlay
    this.pointer = { drag: false, x: 0, y: 0, vx: 0, vy: 0 };   // stirring (see stir)
    this.timing = null;        // per-tick GPU time of the grid and the physics, from probe()
    this.warm = 0;             // ticks still to run at once after a reset (the reference pre-steps 200)
    // physics (live-tunable: moire.cells.params); forces are in CSS px / s, as in the reference
    this.params = {
      contact: true,  // soft contact push on/off (key P)
      stiffness: 7,   // contact push per px of overlap (reference KR = 7)
      damping: 0.85,  // velocity kept per tick (reference: v = 0.85 v + 0.15 F)
      jitter: 0.05,   // Brownian kick per tick, full width, in units of R (reference: 0.05)
      squeeze: 0.25,  // pull to the dish centre, set as the overlap it would cause in the blob's middle
                      // (scaled by the count, so 50 000 cells are squeezed no harder than 2000)
      wall: 2,        // soft wall stiffness (reference)
      drift: 0.15,    // slow drift of the medium, in units of R / s (reference 0.5, which tears a blob without
                      // adhesion; 0 = still)
      warmup: 180,    // ticks run at once after a reset, so a new culture starts settled
      stir: 0.5,      // how strongly a drag pushes cells along (reference 0.5)
      stirReach: 110, // how far from the pointer a drag reaches (CSS px; reference sqrt(12000))
      range: 3.0,     // smallest grid cell size in units of R (must be >= the largest contact range: reach x 2 r,
                      // with r up to about 1.3 R for big cells); the grid is at least `cut` wide too
      // the loop (step 4)
      emit: true,     // cells emit into the field (key O)
      lever: 0.4,     // how different the cells' lattices are from the medium's (keys - and =): scales each
                      // key's angle and period difference from the medium (1 = as the genome has it; smaller =
                      // longer beats, so bigger clusters)
      r0: 2.2,        // a cell's envelope range, in units of R (reference: r0^2 = 4.84 R^2)
      cut: 3.6,       // how far a cell's field reaches (sensed and drawn), in units of R (reference 3.6)
      sense: 10,      // gain of the force from the other cells' field felt on the membrane (1 = reference, which
                      // is too weak to matter against the contact push at 2000 cells)
      senseSrc: 1.0,  // gain of the force from the sources' field (1 = reference)
      senseOn: true,  // field sensing on/off (key S)
      receptor: false, // tuning toward other cells by the genome's receptor instead of the own lattice (key R)
      tuneW: 0.5,     // tuning width toward other cells' lattices (reference 0.177: only near-identical keys)
      senseMax: 3.0,  // the field force saturates at this speed (R / s; reference 3)
      active: true,   // active deformation (key W): stretch along the motion and the field's pull
      shapeRate: 3,   // how fast the shape follows its target (1/s; reference 3)
      anchor: 1,      // where a cell's beat is anchored (key X): 0 = its lattice at the cell, the moire sliding as
                      // it moves (reference); 1 = the beat pinned to the cell, bright at its centre; 2 = its
                      // lattice anchored at the dish centre, the moire standing still in the world
    };
    // drawing (live-tunable: moire.cells.look)
    this.fieldScale = 0.5;     // texels per CSS px of the cells' field texture
    this.fieldTex = null;
    this.look = {
      view: 0,        // 0 = colour by fate, 1 = colour by lineage (the key's hue)
      fill: 0.09,     // disc fill of stem cells, as a fraction of the cell colour over black
      fillC: 0.34,    // disc fill of committed cells (flat colour, so tissues read as areas)
      fillA: 0.88,    // disc opacity (1 = background fully hidden under a cell)
      line: 0.72,     // outline brightness
      lineW: 1.1,     // outline width (CSS px)
      dots: 0.85,     // dot brightness (0 = no dots)
      dotR: 0.21,     // dot radius as a fraction of the dot spacing (reference: 2.7 / 16)
      period: 0.62,   // dot spacing per lattice period, in units of R (the medium's period is 0.62 R)
    };
  }

  static async create(device, format, medium, count, seed) {
    const c = new Cells(device, format, medium, count, seed);
    await c.init();
    return c;
  }

  async init() {
    const d = this.device;
    const [drawMod, gridMod, checkMod, stepMod, censusMod, fieldMod] = await Promise.all([
      loadFieldShader(d, 'src/shaders/cell_draw.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_grid.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_check.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_step.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_census.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_field.wgsl', [CELL_URL]),
    ]);
    // the cells' field: plain additive blending into a float texture (signed values add up)
    const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.fieldPipe = d.createRenderPipeline({
      label: 'cell field', layout: 'auto',
      vertex: { module: fieldMod, entryPoint: 'vs' },
      fragment: { module: fieldMod, entryPoint: 'fs', targets: [{ format: FIELD_FORMAT, blend: { color: add, alpha: add } }] },
      primitive: { topology: 'triangle-list' },
    });
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'cell draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });

    // compute pipelines with explicit layouts (the Sim uniform is bound with a dynamic offset)
    const C = GPUShaderStage.COMPUTE;
    const sim = { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SIM_BYTES } };
    const ro = (binding) => ({ binding, visibility: C, buffer: { type: 'read-only-storage' } });
    const rw = (binding) => ({ binding, visibility: C, buffer: { type: 'storage' } });
    const layout = (label, entries) => {
      const bgl = d.createBindGroupLayout({ label, entries });
      return { bgl, pl: d.createPipelineLayout({ label, bindGroupLayouts: [bgl] }) };
    };
    const un = (binding) => ({ binding, visibility: C, buffer: { type: 'uniform' } });
    this.gridL = layout('cell grid', [sim, ro(1), rw(2), rw(3), rw(4), rw(5), rw(6), rw(7), un(8), rw(9)]);
    // (at most 8 storage buffers per stage, the core limit: the step finds sortIdx in the beats)
    this.stepL = layout('cell step', [sim, ro(1), ro(3), ro(4), rw(5), ro(6), rw(7), rw(8), un(9), un(10), ro(11)]);
    this.censusL = layout('cell census', [sim, ro(1), ro(2), rw(3)]);
    this.checkL = layout('cell check', [sim, ro(1), ro(2), ro(3), ro(4), ro(5), rw(6),
      { binding: 7, visibility: C, buffer: { type: 'uniform' } }]);
    const pipe = (L, module, entryPoint) => d.createComputePipeline({
      label: `cell ${entryPoint}`, layout: L.pl, compute: { module, entryPoint },
    });
    this.pipes = {};
    for (const e of ['count', 'scan_local', 'scan_top', 'scan_add', 'scatter']) this.pipes[e] = pipe(this.gridL, gridMod, e);
    this.pipes.step = pipe(this.stepL, stepMod, 'step');
    this.pipes.check = pipe(this.checkL, checkMod, 'check');
    this.pipes.census = pipe(this.censusL, censusMod, 'census');

    const U = GPUBufferUsage;
    const n = this.count;
    this.cellBuf = d.createBuffer({ label: 'cells', size: n * CELL_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.sortedBuf = d.createBuffer({ label: 'cells sorted', size: n * CELL_BYTES, usage: U.STORAGE });
    this.sortIdxBuf = d.createBuffer({ label: 'cell sort index', size: n * 4, usage: U.STORAGE });
    this.beatBuf = d.createBuffer({ label: 'cell beats (sorted)', size: n * CELL_BEAT_BYTES, usage: U.STORAGE });
    this.fieldU = d.createBuffer({ label: 'cell field params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.fieldBG = d.createBindGroup({
      label: 'cell field', layout: this.fieldPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.fieldU } }, { binding: 1, resource: { buffer: this.beatBuf } }],
    });
    this.cellGridBuf = d.createBuffer({ label: 'cell grid slot', size: n * 8, usage: U.STORAGE });
    // the Bio records (genome + state), double-buffered: bioBuf[bioCur] holds the current tick's
    this.bioBuf = [0, 1].map((k) => d.createBuffer({ label: `cell bio ${k}`, size: n * BIO_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }));
    this.bioCur = 0;
    this.statsBuf = d.createBuffer({ label: 'cell stats', size: STATS_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    // read-back ring for the stats (never waits: a buffer still mapping is simply skipped)
    this.statsRead = [0, 1, 2].map((k) => ({ buf: d.createBuffer({ label: `cell stats read ${k}`, size: STATS_BYTES, usage: U.MAP_READ | U.COPY_DST }), busy: false }));
    this.stats = null;          // last census, for the overlay (see readStats)
    this.statsHist = [];        // [time, births, deaths] for births / deaths per second
    this.onEvents = null;       // callback(events) for births and deaths (main.js drops ripples)
    // the sources as the cells feel them (nutrient, threat), written every frame from the landscape
    this.srcBuf = d.createBuffer({ label: 'cell sources', size: MAX_SRC * 32, usage: U.UNIFORM | U.COPY_DST });
    this.srcData = new Float32Array(MAX_SRC * 8);
    this.srcCount = 0;
    this.landscape = null;      // set by main.js
    this.simBuf = d.createBuffer({ label: 'cell sim params', size: SLOTS * SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.simAB = new ArrayBuffer(SLOTS * SLOT);
    this.simF = new Float32Array(this.simAB);
    this.simU = new Uint32Array(this.simAB);

    this.drawU = d.createBuffer({ label: 'cell draw params', size: 64, usage: U.UNIFORM | U.COPY_DST });
    this.drawData = new Float32Array(16);
    this.drawBG = d.createBindGroup({
      layout: this.drawPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.drawU } },
        { binding: 1, resource: { buffer: this.cellBuf } },
      ],
    });
  }

  /** The cells' radius: the reference's R, or smaller if `count` cells would not fit in the dish. */
  fitR(view) {
    // a round blob packed at about 0.82 area fraction, diameter at most 0.8 x the shorter side
    const blob = 0.4 * Math.min(view.cssW, view.cssH);
    return Math.min(this.medium.R, blob * Math.sqrt(0.82 / this.count));
  }

  resize(view) {
    const first = !this.view;
    this.view = view;
    this.R = this.fitR(view);
    this.sizeGrid();
    this.sizeField();
    if (first) this.seed();
  }

  /** The cells' field texture: fieldScale texels per CSS px over the dish. */
  sizeField() {
    const { cssW: W, cssH: H } = this.view;
    const w = Math.max(1, Math.ceil(W * this.fieldScale)), h = Math.max(1, Math.ceil(H * this.fieldScale));
    if (this.fieldTex && this.fieldTex.width === w && this.fieldTex.height === h) return;
    if (this.fieldTex) this.fieldTex.destroy();
    this.fieldTex = this.device.createTexture({
      label: 'cell field', size: [w, h], format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.fieldView = this.fieldTex.createView();
    this.fieldBlank = false;
  }

  /** Whether the cells emit at all (key O). */
  emitting() { return !!this.params.emit; }

  /** Grid cell size in CSS px: the larger of the contact range and the field's reach. */
  gridSize() {
    const p = this.params;
    return Math.max(1, Math.max(p.range, p.cut) * this.R);
  }

  /** Grid dimensions from the dish size and R; (re)allocates the grid buffers when they grow. */
  sizeGrid() {
    const { cssW: W, cssH: H } = this.view;
    const cs = this.gridSize();
    const gw = Math.max(1, Math.ceil(W / cs)), gh = Math.max(1, Math.ceil(H / cs));
    const n = gw * gh;
    Object.assign(this.grid, { gw, gh, cs, n });
    if (n <= this.grid.cap) return;
    const cap = Math.ceil(n * 1.25);
    const d = this.device, U = GPUBufferUsage;
    for (const b of [this.countsBuf, this.startsBuf, this.blockBuf]) if (b) b.destroy();
    this.countsBuf = d.createBuffer({ label: 'grid counts', size: cap * 4, usage: U.STORAGE | U.COPY_DST });
    this.startsBuf = d.createBuffer({ label: 'grid starts', size: cap * 4, usage: U.STORAGE });
    this.blockBuf = d.createBuffer({ label: 'grid block sums', size: Math.ceil(cap / BLOCK) * 4, usage: U.STORAGE });
    this.grid.cap = cap;
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    this.gridBG = d.createBindGroup({
      label: 'cell grid', layout: this.gridL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.countsBuf), b(3, this.startsBuf), b(4, this.blockBuf), b(5, this.cellGridBuf),
        b(6, this.sortedBuf), b(7, this.sortIdxBuf), b(8, this.medium.buffer), b(9, this.beatBuf)],
    });
    // two step bind groups: stepBG[k] reads bioBuf[k] and writes bioBuf[1 - k]
    this.stepBG = [0, 1].map((k) => this.makeStepBG(this.cellBuf, this.bioBuf[k], this.bioBuf[1 - k], this.statsBuf));
    this.censusBG = [0, 1].map((k) => d.createBindGroup({
      label: 'cell census', layout: this.censusL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.bioBuf[k]), b(3, this.statsBuf)],
    }));
    this.makeCheck();
  }

  makeStepBG(cellBuf, bioPrev, bioNext, statsBuf) {
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    return this.device.createBindGroup({
      label: 'cell step', layout: this.stepL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.sortedBuf),
        b(3, this.startsBuf), b(4, this.countsBuf), b(5, cellBuf),
        b(6, bioPrev), b(7, bioNext), b(8, statsBuf), b(9, this.medium.buffer), b(10, this.srcBuf), b(11, this.beatBuf)],
    });
  }

  /**
   * A fresh culture: all stem cells in a round blob at the dish centre, a little looser than packed, each a
   * copy of one of the founder genomes. fresh = true draws new founders (key G); else the same ones (key N).
   */
  seed(fresh = false) {
    const { cssW: W, cssH: H } = this.view;
    const n = this.count, R = this.R, rng = this.genome.rng;
    if (fresh) this.genome.newFounders();
    const bab = new ArrayBuffer(n * BIO_BYTES);
    const keys = this.genome.fill(new Float32Array(bab), n);
    const ab = new ArrayBuffer(n * CELL_BYTES);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    const spread = R * Math.sqrt(n / 0.85);  // blob radius at 0.85 area fraction (overlaps settle in the warm-up)
    for (let i = 0; i < n; i++) {
      const a = rng() * 2 * Math.PI, dd = Math.sqrt(rng()) * spread;
      const o = i * CELL_FLOATS;
      f[o] = W / 2 + Math.cos(a) * dd; f[o + 1] = H / 2 + Math.sin(a) * dd;
      f[o + 2] = 0; f[o + 3] = 0;
      f[o + 4] = R;
      f[o + 5] = keys[2 * i];                          // lattice angle = the key angle
      f[o + 6] = 0; f[o + 7] = 0;
      u[o + 8] = KIND.STEM; u[o + 9] = ALIVE; u[o + 10] = (rng() * 4294967296) >>> 0;
      f[o + 11] = keys[2 * i + 1];                     // key scale
    }
    this.device.queue.writeBuffer(this.cellBuf, 0, ab);
    this.device.queue.writeBuffer(this.bioBuf[this.bioCur], 0, bab);
    this.warm = Math.max(0, Math.round(this.params.warmup));
  }

  /** Pull toward the dish centre (1/s) that squeezes the middle of the blob by about params.squeeze. */
  pull() {
    const p = this.params;
    return 6.6 * p.squeeze * p.stiffness / this.count;
  }

  /** Write the Sim uniform for one tick (at simulation time `time`) into slot k. */
  writeSim(k, dt, time) {
    const v = this.view, g = this.grid, p = this.params;
    const f = this.simF, u = this.simU, o = k * SLOT / 4;
    u[o] = this.count; u[o + 1] = g.gw; u[o + 2] = g.gh; u[o + 3] = this.tick >>> 0;
    f[o + 4] = g.cs; f[o + 5] = this.R; f[o + 6] = v.cssW; f[o + 7] = v.cssH;
    f[o + 8] = v.cssW / 2; f[o + 9] = v.cssH / 2; f[o + 10] = dt;
    f[o + 11] = p.contact ? p.stiffness : 0;
    f[o + 12] = p.damping; f[o + 13] = p.jitter; f[o + 14] = this.pull(); f[o + 15] = p.wall;
    const P = this.pointer, on = P.drag ? 1 : 0;
    f[o + 16] = P.x; f[o + 17] = P.y; f[o + 18] = P.vx * on; f[o + 19] = P.vy * on;
    f[o + 20] = p.stirReach * p.stirReach; f[o + 21] = p.stir;
    f[o + 22] = p.drift; f[o + 23] = time;
    u[o + 24] = this.genome.ruleBits();
    const G = this.genome.params;
    f[o + 28] = G.tau; f[o + 29] = G.release; f[o + 30] = G.reach; f[o + 31] = G.adhesion;
    f[o + 32] = G.adhSigma; f[o + 33] = G.fateAdh; f[o + 34] = this.genome.rules.body ? 1 : 0; f[o + 35] = G.adhBase;
    f[o + 36] = this.genome.rules.body ? G.crawl : 0; f[o + 37] = G.turnRate;
    f[o + 38] = G.turnover; f[o + 39] = G.unhappy; f[o + 40] = G.mutSize; f[o + 41] = G.mutJump;
    f[o + 42] = G.nutFar; f[o + 43] = G.thrKill; u[o + 44] = this.srcCount; f[o + 45] = G.beatMix;
    f[o + 46] = p.lever; f[o + 47] = p.emit ? 1 : 0; f[o + 48] = p.r0; f[o + 49] = p.cut;
    f[o + 50] = p.senseOn ? p.sense : 0; f[o + 51] = p.tuneW; f[o + 57] = p.senseOn ? p.senseSrc : 0;
    u[o + 58] = p.receptor ? 1 : 0;
    f[o + 52] = this.landscape ? this.landscape.params.amp : 5; f[o + 53] = p.senseMax;
    f[o + 54] = p.active ? 1 : 0; f[o + 55] = p.shapeRate; u[o + 56] = p.anchor;
  }

  /** Record the grid build for the tick whose uniforms are in slot k. */
  encodeGrid(encoder, k) {
    const g = this.grid, wg = Math.ceil(this.count / 256);
    encoder.clearBuffer(this.countsBuf, 0, g.n * 4);
    const pass = encoder.beginComputePass({ label: 'cell grid' });
    pass.setBindGroup(0, this.gridBG, [k * SLOT]);
    pass.setPipeline(this.pipes.count); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.scan_local); pass.dispatchWorkgroups(Math.ceil(g.n / BLOCK));
    pass.setPipeline(this.pipes.scan_top); pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.scan_add); pass.dispatchWorkgroups(Math.ceil(g.n / 256));
    pass.setPipeline(this.pipes.scatter); pass.dispatchWorkgroups(wg);
    pass.end();
  }

  /** Record the physics for the tick in slot k (after its grid). */
  encodeStep(encoder, k) {
    const pass = encoder.beginComputePass({ label: 'cell step' });
    pass.setPipeline(this.pipes.step);
    pass.setBindGroup(0, this.stepBG[this.bioCur], [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 128));
    pass.end();
    this.bioCur ^= 1;
  }

  compute(encoder, frame) {
    if (this.gridSize() !== this.grid.cs) this.sizeGrid();   // params.cut or range changed
    // after a reset, the warm-up ticks run first (all in this frame, at the current time)
    const warm = Math.min(this.warm, SLOTS - frame.ticks);
    this.warm -= warm;
    const ticks = warm + frame.ticks;
    if (!ticks) return;
    this.writeSources();
    for (let t = 0; t < ticks; t++) {
      const time = frame.time - Math.max(0, ticks - 1 - t) * frame.tickDt * (t < warm ? 0 : 1);
      this.writeSim(t, frame.tickDt, time);
      this.tick++;
      if (t >= warm) { this.pointer.vx *= 0.8; this.pointer.vy *= 0.8; }   // the stir fades (reference: per frame)
    }
    this.device.queue.writeBuffer(this.simBuf, 0, this.simAB, 0, ticks * SLOT);
    for (let t = 0; t < ticks; t++) {
      this.encodeGrid(encoder, t);
      // ?check runs between the grid build and the move, so both see the same positions
      if (t === ticks - 1) this.maybeCheck(encoder, t, frame);
      this.encodeStep(encoder, t);
    }
    this.maybeCensus(encoder, ticks - 1, frame);
    this.maybeMotion(encoder, frame);
    this.encodeField(encoder);
  }

  /** Scatter the cells' field into its texture (from the beats of the last tick's grid), if it is drawn. */
  encodeField(encoder) {
    const L = this.landscape;
    if (!this.fieldTex || !L) return;
    const on = this.emitting() && L.params.cellField;
    if (!on && this.fieldBlank) return;
    this.fieldBlank = !on;
    const v = this.view, a = new Float32Array([v.cssW, v.cssH, this.params.cut * this.R, 0]);
    this.device.queue.writeBuffer(this.fieldU, 0, a);
    const pass = encoder.beginRenderPass({
      label: 'cell field',
      colorAttachments: [{ view: this.fieldView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    if (on) {
      pass.setPipeline(this.fieldPipe);
      pass.setBindGroup(0, this.fieldBG);
      pass.draw(6, this.count);
    }
    pass.end();
  }

  /** Upload the sources as the cells feel them (once per frame). */
  writeSources() {
    const L = this.landscape, a = this.srcData;
    const list = L ? L.sources.slice(-MAX_SRC) : [];
    const r0sq = L ? (L.params.range * this.medium.R) ** 2 : 1, ref = L ? L.params.amp : 1;
    list.forEach((s, k) => {
      a.set([s.x, s.y, s.la, s.amp / ref, r0sq, s.kind, 0, 0], 8 * k);
    });
    this.srcCount = list.length;
    if (list.length) this.device.queue.writeBuffer(this.srcBuf, 0, a, 0, 8 * list.length);
  }

  // ---------- stats: census and read-back for the overlay ----------
  /** Every few frames: count fates, key bins and founder lines, and copy the stats out (if a buffer is free). */
  maybeCensus(encoder, k, frame) {
    if (frame.frameNo % 4 !== 0) return;
    const rb = this.statsRead.find((r) => !r.busy);
    if (!rb) return;
    rb.busy = true;
    encoder.clearBuffer(this.statsBuf, 0, 32);                       // fate counts
    encoder.clearBuffer(this.statsBuf, STATS_CENSUS, STATS_BYTES - STATS_CENSUS);   // key bins, founder bitmap
    const pass = encoder.beginComputePass({ label: 'cell census' });
    pass.setPipeline(this.pipes.census);
    pass.setBindGroup(0, this.censusBG[this.bioCur], [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
    encoder.copyBufferToBuffer(this.statsBuf, 0, rb.buf, 0, STATS_BYTES);
    encoder.clearBuffer(this.statsBuf, 40, 4);                       // event count: events restart after each copy
    const time = frame.time;
    setTimeout(() => this.readStats(rb, time), 0);                   // map once this frame is submitted
  }

  async readStats(rb, time) {
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      const u = new Uint32Array(rb.buf.getMappedRange().slice(0));
      rb.buf.unmap();
      const f = new Float32Array(u.buffer);
      const fate = Array.from(u.subarray(0, 5));
      const births = u[8], deaths = u[9];
      const nEv = Math.min(u[10], STATS_EVENTS);
      const events = [];
      for (let e = 0; e < nEv; e++) events.push([f[16 + 4 * e], f[17 + 4 * e], f[18 + 4 * e]]);
      // key bins holding a real share of the cells: a rough count of distinct lineages (genotype clusters)
      const bins = u.subarray(STATS_CENSUS / 4, STATS_CENSUS / 4 + 144);
      const big = Math.max(3, this.count / 400);
      let clusters = 0;
      for (const b of bins) if (b >= big) clusters++;
      let founders = 0;
      for (let w = STATS_CENSUS / 4 + 144; w < u.length; w++) { let x = u[w]; while (x) { x &= x - 1; founders++; } }
      const H = this.statsHist;
      H.push([time, births, deaths]);
      while (H.length > 2 && time - H[0][0] > 2) H.shift();
      const h0 = H[0], dt = time - h0[0];
      const rate = dt > 0.2 ? [((births - h0[1]) >>> 0) / dt, ((deaths - h0[2]) >>> 0) / dt] : [0, 0];
      this.stats = { time, fate, births, deaths, clusters, founders, birthRate: rate[0], deathRate: rate[1] };
      if (events.length && this.onEvents) this.onEvents(events);
    } catch (e) {
      // device lost or page closing: nothing to show
    } finally {
      rb.busy = false;
    }
  }

  // ---------- motion: how the cells move, for the overlay ----------
  /**
   * About once per simulation second, copy the cells out and compare with the copy before: mean speed (the
   * damped velocity), mean net displacement per second (low against the speed = jittering on the spot), mean
   * stretch, and the spread of the culture (RMS distance from its centre of mass, in R).
   */
  maybeMotion(encoder, frame) {
    if (this.motionBusy || frame.time - (this.motionLast ?? -1e9) < 1) return;
    const d = this.device;
    if (!this.motionRead) {
      this.motionRead = d.createBuffer({ label: 'cells motion read', size: this.count * CELL_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
    this.motionBusy = true;
    this.motionLast = frame.time;
    encoder.copyBufferToBuffer(this.cellBuf, 0, this.motionRead, 0, this.count * CELL_BYTES);
    const time = frame.time;
    setTimeout(() => this.readMotion(time), 0);
  }

  async readMotion(time) {
    try {
      await this.motionRead.mapAsync(GPUMapMode.READ);
      const f = new Float32Array(this.motionRead.getMappedRange().slice(0));
      this.motionRead.unmap();
      const n = this.count, R = this.R, prev = this.motionPrev;
      let sp = 0, st = 0, cx = 0, cy = 0, net = 0, nNet = 0;
      for (let i = 0; i < n; i++) {
        const o = i * CELL_FLOATS;
        sp += Math.hypot(f[o + 2], f[o + 3]); st += Math.hypot(f[o + 6], f[o + 7]);
        cx += f[o]; cy += f[o + 1];
      }
      cx /= n; cy /= n;
      let r2 = 0;
      for (let i = 0; i < n; i++) { const o = i * CELL_FLOATS; r2 += (f[o] - cx) ** 2 + (f[o + 1] - cy) ** 2; }
      const dt = prev ? time - prev.time : 0;
      if (prev && dt > 0.2) {
        for (let i = 0; i < n; i++) {
          const o = i * CELL_FLOATS, dd = Math.hypot(f[o] - prev.pos[2 * i], f[o + 1] - prev.pos[2 * i + 1]);
          if (dd < 8 * R * dt) { net += dd; nNet++; }   // a reborn cell jumps; leave those out
        }
      }
      const pos = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) { pos[2 * i] = f[i * CELL_FLOATS]; pos[2 * i + 1] = f[i * CELL_FLOATS + 1]; }
      this.motionPrev = { time, pos };
      this.motion = { time, speed: sp / n, net: nNet ? net / nNet / dt : null, stretch: st / n, spread: Math.sqrt(r2 / n) / R };
    } catch (e) {
      // device lost or page closing
    } finally {
      this.motionBusy = false;
    }
  }

  // ---------- stirring (called by main.js on pointer moves) ----------
  /** The pointer moved by (dx, dy) to (x, y) while dragging: cells nearby are pushed along, as in the reference. */
  stir(x, y, dx, dy) {
    const P = this.pointer;
    P.drag = true; P.x = x; P.y = y;
    P.vx = P.vx * 0.6 + dx * 24; P.vy = P.vy * 0.6 + dy * 24;
  }

  release() { Object.assign(this.pointer, { drag: false, vx: 0, vy: 0 }); }

  // ---------- timing ----------
  /**
   * Measure the GPU time of one tick's grid build and physics: submit each K times on its own, between frames,
   * and time it until the queue reports it done, minus the time an empty submit takes. Rough (+-0.1 ms), but
   * works in every browser (timestamp queries are optional and coarse). The physics copy writes to a scratch
   * buffer, and rebuilding the grid from the same positions changes nothing, so the probe does not disturb
   * the simulation.
   */
  async probe(K = 32) {
    if (this.probing) return;
    this.probing = true;
    const d = this.device, q = d.queue;
    try {
      if (!this.scratchBuf) {
        this.scratchBuf = d.createBuffer({ label: 'cells probe scratch', size: this.count * CELL_BYTES, usage: GPUBufferUsage.STORAGE });
      }
      if (!this.scratchStats) {
        this.scratchStats = d.createBuffer({ label: 'cells probe stats', size: STATS_BYTES, usage: GPUBufferUsage.STORAGE });
        this.scratchBio = d.createBuffer({ label: 'cells probe bio', size: this.count * BIO_BYTES, usage: GPUBufferUsage.STORAGE });
      }
      // the probe writes only to scratch buffers, so it changes nothing the simulation sees
      const scratchBG = this.makeStepBG(this.scratchBuf, this.bioBuf[this.bioCur], this.scratchBio, this.scratchStats);
      const record = (fn) => { const e = d.createCommandEncoder({ label: 'cells probe' }); for (let k = 0; k < K; k++) fn(e); return e.finish(); };
      const gridCB = record((e) => this.encodeGrid(e, 0));
      const stepCB = record((e) => {
        const pass = e.beginComputePass({ label: 'cell step (probe)' });
        pass.setPipeline(this.pipes.step);
        pass.setBindGroup(0, scratchBG, [0]);
        pass.dispatchWorkgroups(Math.ceil(this.count / 128));
        pass.end();
      });
      const timed = async (cbs) => { const t0 = performance.now(); q.submit(cbs); await q.onSubmittedWorkDone(); return performance.now() - t0; };
      await q.onSubmittedWorkDone();
      const base = await timed([]);
      const tg = await timed([gridCB]);
      const ts = await timed([stepCB]);
      const now = { grid: Math.max(0, tg - base) / K, step: Math.max(0, ts - base) / K };
      const T = this.timing;
      this.timing = T ? { grid: T.grid + (now.grid - T.grid) * 0.3, step: T.step + (now.step - T.step) * 0.3 } : now;
    } finally {
      this.probing = false;
    }
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const g = this.grid, p = this.params, T = this.timing, c = this.checkResult;
    const lines = [
      `cells <b>${this.count}</b> · r ${this.R.toFixed(2)} px · grid ${g.gw}×${g.gh} (${g.cs.toFixed(1)} px) · contact push ${p.contact ? 'on' : 'off'}`,
      T ? `cells per tick (gpu, probe): grid ${T.grid.toFixed(2)} ms · physics ${T.step.toFixed(2)} ms` : 'cells per tick (gpu, probe): measuring',
    ];
    const st = this.stats, r = this.genome.rules, on = (x) => (x ? 'on' : 'off');
    if (st) {
      const F = st.fate;
      lines.push(`fates: stem <b>${F[0]}</b> · epithelium <b>${F[1]}</b> · muscle <b>${F[2]}</b> · neuron <b>${F[3]}</b> · cartilage <b>${F[4]}</b>`);
      lines.push(`lineages: ${st.founders} founder lines · ${st.clusters} key clusters · births ${st.birthRate.toFixed(1)}/s · deaths ${st.deathRate.toFixed(1)}/s`);
    }
    lines.push(`rules: D differentiation ${on(r.diff)} · H adhesion ${on(r.adh)} · B body ${on(r.body)} · T turnover ${on(r.turn)} · M mutation ${on(r.mut)} · E nutrient/threat ${on(r.nut)} · I inherit fate ${on(r.inherit)} · view ${this.look.view ? 'lineage' : 'fate'}`);
    const mo = this.motion;
    lines.push(`loop: S sense ${on(p.senseOn)} · O emit ${on(p.emit)} · W active shape ${on(p.active)} · X beat ${ANCHORS[p.anchor] || p.anchor} · R tuning by ${p.receptor ? 'receptor' : 'own lattice'} · lever ${p.lever.toFixed(2)}` +
      (mo ? ` · speed ${mo.speed.toFixed(1)} px/s · net ${mo.net == null ? '-' : mo.net.toFixed(1)} px/s · stretch ${mo.stretch.toFixed(2)} · spread ${mo.spread.toFixed(1)} R` : ''));
    if (c) {
      lines.push(`grid check: ${c.contacts / 2} contacts` + (c.brute ? ` (brute force ${c.bruteContacts / 2}, ${c.mismatch} cells differ)` : '') +
        ` · ${c.badSort} bad slots · overlap mean ${(100 * c.ovMean).toFixed(1)}% max ${(100 * c.ovMax).toFixed(1)}%`);
    }
    return lines;
  }

  // ---------- ?check: the grid's contacts against brute force ----------
  enableCheck() {
    this.checkOn = true;
    this.nextCheck = 1;
    this.makeCheck();
  }

  makeCheck() {
    if (!this.checkOn || !this.countsBuf) return;
    const d = this.device, U = GPUBufferUsage, n = this.count;
    if (!this.checkBuf) {
      this.checkBuf = d.createBuffer({ label: 'check result', size: n * 16, usage: U.STORAGE | U.COPY_SRC });
      this.checkRead = d.createBuffer({ label: 'check readback', size: n * 16, usage: U.MAP_READ | U.COPY_DST });
      this.checkU = d.createBuffer({ label: 'check params', size: 16, usage: U.UNIFORM | U.COPY_DST });
      d.queue.writeBuffer(this.checkU, 0, new Uint32Array([n <= BRUTE_MAX ? 1 : 0, 0, 0, 0]));
    }
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    this.checkBG = d.createBindGroup({
      label: 'cell check', layout: this.checkL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.countsBuf), b(3, this.startsBuf), b(4, this.sortedBuf), b(5, this.sortIdxBuf),
        b(6, this.checkBuf), b(7, this.checkU)],
    });
  }

  maybeCheck(encoder, k, frame) {
    if (!this.checkOn || this.checkBusy || frame.time < this.nextCheck) return;
    this.nextCheck = frame.time + 2;
    this.checkBusy = true;
    const pass = encoder.beginComputePass({ label: 'cell check' });
    pass.setPipeline(this.pipes.check);
    pass.setBindGroup(0, this.checkBG, [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
    encoder.copyBufferToBuffer(this.checkBuf, 0, this.checkRead, 0, this.count * 16);
    // map once this frame has been submitted (main.js submits right after the layers have encoded)
    setTimeout(() => this.readCheck(frame.time), 0);
  }

  async readCheck(time) {
    try {
      await this.checkRead.mapAsync(GPUMapMode.READ);
      const r = new Uint32Array(this.checkRead.getMappedRange().slice(0));
      this.checkRead.unmap();
      const f = new Float32Array(r.buffer);
      const n = this.count, brute = n <= BRUTE_MAX;
      let contacts = 0, bruteContacts = 0, mismatch = 0, ovMax = 0, ovSum = 0, touching = 0, badSort = 0;
      for (let i = 0; i < n; i++) {
        if (r[4 * i + 3] !== 1) badSort++;
        const b = r[4 * i], g = r[4 * i + 1], ov = f[4 * i + 2];
        contacts += g; bruteContacts += b;
        if (brute && b !== g) mismatch++;
        if (g) { touching++; ovSum += ov; }
        ovMax = Math.max(ovMax, ov);
      }
      const res = { time, n, brute, contacts, bruteContacts, mismatch, badSort, ovMean: touching ? ovSum / touching : 0, ovMax };
      this.checkResult = res;
      const msg = `grid check t=${time.toFixed(1)} s: ${n} cells, ${contacts / 2} contacts via grid` +
        (brute ? `, ${bruteContacts / 2} by brute force, ${mismatch} cells differ` : ` (no brute force above ${BRUTE_MAX})`) +
        `; ${badSort} bad sort slots (grid ${this.grid.gw}x${this.grid.gh})` +
        `; deepest overlap per touching cell: mean ${(100 * res.ovMean).toFixed(1)}%, max ${(100 * ovMax).toFixed(1)}% of r_i + r_j`;
      if ((brute && mismatch) || badSort) console.warn(msg); else console.log(msg);
    } catch (e) {
      console.warn('grid check failed: ' + (e && e.message));
    } finally {
      this.checkBusy = false;
    }
  }

  render(pass) {
    const v = this.view, L = this.look, a = this.drawData;
    a[0] = v.cssW; a[1] = v.cssH; a[2] = v.dpr; a[3] = this.R;
    a[4] = L.fill; a[5] = L.fillA; a[6] = L.line; a[7] = L.lineW;
    a[8] = L.dots; a[9] = L.dotR; a[10] = L.period; a[11] = L.view; a[12] = L.fillC; a[13] = this.params.lever;
    this.device.queue.writeBuffer(this.drawU, 0, a);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(6, this.count);
  }
}
