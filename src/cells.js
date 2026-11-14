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
// Size: the cells' radius R is the reference's R (from the screen area, 5 to 9 CSS px), but smaller when
// that many cells would not fit in a round blob of about 0.8 x the dish height (so 10 000 or 50 000 cells
// get smaller). See `fitR`.
//
// URL: ?cells=N  number of cells (default 2000)
//      ?check=1  every 2 s, compare the grid's contacts with a brute-force count (console and overlay)

import { loadFieldShader, KIND } from './field.js';

export const CELL_URL = 'src/shaders/cell_common.wgsl';

// struct Cell in cell_common.wgsl: pos.xy, vel.xy, r, la, e1, e2, kind (u32), flags (u32), seed (u32), aux
export const CELL_FLOATS = 12;
export const CELL_BYTES = CELL_FLOATS * 4;
const ALIVE = 1;

export const DEFAULT_CELLS = 2000;
export const MAX_CELLS = 262144;

const SIM_BYTES = 96;          // struct Sim
const SLOT = 256;              // uniform slot stride (minUniformBufferOffsetAlignment is at most 256)
const SLOTS = 128;             // ticks that can be encoded in one frame
const BLOCK = 512;             // scan block (cell_grid.wgsl)
const BRUTE_MAX = 20000;       // largest count the ?check brute force runs on

export class Cells {
  constructor(device, format, medium, count) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.count = Math.max(1, Math.min(MAX_CELLS, Math.round(count) || DEFAULT_CELLS));
    this.R = 9;
    this.view = null;
    this.tick = 0;
    this.grid = { gw: 0, gh: 0, cs: 1, n: 0, cap: 0 };
    this.checkOn = false;
    this.checkResult = null;   // last ?check result, for the overlay
    this.params = {
      range: 2.2,     // grid cell size in units of R (must be >= the largest interaction range: 2 r for contact)
    };
    // drawing (live-tunable: moire.cells.look)
    this.look = {
      fill: 0.13,     // disc fill, as a fraction of the cell colour over black
      fillA: 0.88,    // disc opacity (1 = background fully hidden under a cell)
      line: 0.78,     // outline brightness
      lineW: 1.1,     // outline width (CSS px)
      dots: 0.5,      // dot brightness (0 = no dots)
      dotR: 0.17,     // dot radius as a fraction of the dot spacing (reference: 2.7 / 16)
      period: 0.62,   // dot spacing per lattice period, in units of R (the medium's period is 0.62 R)
    };
  }

  static async create(device, format, medium, count) {
    const c = new Cells(device, format, medium, count);
    await c.init();
    return c;
  }

  async init() {
    const d = this.device;
    const [drawMod, gridMod, checkMod] = await Promise.all([
      loadFieldShader(d, 'src/shaders/cell_draw.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_grid.wgsl', [CELL_URL]),
      loadFieldShader(d, 'src/shaders/cell_check.wgsl', [CELL_URL]),
    ]);
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
    this.gridL = layout('cell grid', [sim, ro(1), rw(2), rw(3), rw(4), rw(5), rw(6), rw(7)]);
    this.checkL = layout('cell check', [sim, ro(1), ro(2), ro(3), ro(4), ro(5), rw(6),
      { binding: 7, visibility: C, buffer: { type: 'uniform' } }]);
    const pipe = (L, module, entryPoint) => d.createComputePipeline({
      label: `cell ${entryPoint}`, layout: L.pl, compute: { module, entryPoint },
    });
    this.pipes = {};
    for (const e of ['count', 'scan_local', 'scan_top', 'scan_add', 'scatter']) this.pipes[e] = pipe(this.gridL, gridMod, e);
    this.pipes.check = pipe(this.checkL, checkMod, 'check');

    const U = GPUBufferUsage;
    const n = this.count;
    this.cellBuf = d.createBuffer({ label: 'cells', size: n * CELL_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.sortedBuf = d.createBuffer({ label: 'cells sorted', size: n * CELL_BYTES, usage: U.STORAGE });
    this.sortIdxBuf = d.createBuffer({ label: 'cell sort index', size: n * 4, usage: U.STORAGE });
    this.cellGridBuf = d.createBuffer({ label: 'cell grid slot', size: n * 8, usage: U.STORAGE });
    this.simBuf = d.createBuffer({ label: 'cell sim params', size: SLOTS * SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.simAB = new ArrayBuffer(SLOTS * SLOT);
    this.simF = new Float32Array(this.simAB);
    this.simU = new Uint32Array(this.simAB);

    this.drawU = d.createBuffer({ label: 'cell draw params', size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.drawData = new Float32Array(12);
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
    if (first) this.seed();
  }

  /** Grid dimensions from the dish size and R; (re)allocates the grid buffers when they grow. */
  sizeGrid() {
    const { cssW: W, cssH: H } = this.view;
    const cs = Math.max(1, this.params.range * this.R);
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
        b(6, this.sortedBuf), b(7, this.sortIdxBuf)],
    });
    this.makeCheck();
  }

  /** A fresh culture: all stem cells in a round blob at the dish centre, a little looser than packed. */
  seed() {
    const { cssW: W, cssH: H } = this.view;
    const n = this.count, R = this.R;
    const ab = new ArrayBuffer(n * CELL_BYTES);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    const spread = R * Math.sqrt(n / 0.7);   // blob radius at 0.7 area fraction
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 2 * Math.PI, dd = Math.sqrt(Math.random()) * spread;
      const o = i * CELL_FLOATS;
      f[o] = W / 2 + Math.cos(a) * dd; f[o + 1] = H / 2 + Math.sin(a) * dd;
      f[o + 2] = 0; f[o + 3] = 0;
      f[o + 4] = R;
      f[o + 5] = Math.random() * Math.PI / 3;          // lattice angle, as the reference's makeCell
      f[o + 6] = 0; f[o + 7] = 0;
      u[o + 8] = KIND.STEM; u[o + 9] = ALIVE; u[o + 10] = (Math.random() * 4294967296) >>> 0; f[o + 11] = 0;
    }
    this.device.queue.writeBuffer(this.cellBuf, 0, ab);
  }

  /** Write the Sim uniform for one tick into slot k. */
  writeSim(k, frame) {
    const v = this.view, g = this.grid;
    const f = this.simF, u = this.simU, o = k * SLOT / 4;
    u[o] = this.count; u[o + 1] = g.gw; u[o + 2] = g.gh; u[o + 3] = this.tick >>> 0;
    f[o + 4] = g.cs; f[o + 5] = this.R; f[o + 6] = v.cssW; f[o + 7] = v.cssH;
    f[o + 8] = v.cssW / 2; f[o + 9] = v.cssH / 2; f[o + 10] = frame.tickDt;
    for (let q = 11; q < 24; q++) f[o + q] = 0;
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

  compute(encoder, frame) {
    const ticks = frame.ticks;
    if (!ticks) return;
    for (let t = 0; t < ticks; t++) { this.writeSim(t, frame); this.tick++; }
    this.device.queue.writeBuffer(this.simBuf, 0, this.simAB, 0, ticks * SLOT);
    for (let t = 0; t < ticks; t++) {
      this.encodeGrid(encoder, t);
      if (t === ticks - 1) this.maybeCheck(encoder, t, frame);
    }
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
    a[8] = L.dots; a[9] = L.dotR; a[10] = L.period; a[11] = 0;
    this.device.queue.writeBuffer(this.drawU, 0, a);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(6, this.count);
  }
}
