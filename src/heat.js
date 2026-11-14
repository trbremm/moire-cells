// The heat band (Part C, step C1): a heat grid on the GPU, the cells' losses feeding it, kicks drawing on it, a leak
// to the sky, and the energy ledger behind the entropy counter.
//
// Heat is the lowest, INCOHERENT band: only its amount per place matters, so it is one channel on a coarse substrate
// grid (about one pixel per half a cell radius) instead of a sum of lattices. Every tick:
//   1. the cells' step (cell_step.wgsl) reads the heat under each cell (its 3 x 3 pixels), gives it a kick in a random
//      direction whose size grows with that heat, and adds to the grid's delta (atomic adds, whole counts): the motion
//      the drag took this tick, minus the kick's energy (a kick uses heat up), plus the motion of a cell that died;
//   2. spread (heat.wgsl), nSub substeps: the delta comes in, a base warmth is added, a share leaks to the sky, and the
//      heat spreads to the neighbouring pixels (explicit, conservative, exact in whole counts).
// Energy unit: a cell moving at 10 CSS px/s carries 0.5 (heat_common.wgsl). Storage: one i32 buffer laid out as
// [ledger | delta | heat copy 0 | heat copy 1] (heat_common.wgsl), channel-major so later steps can add channels.
//
// The ledger (entropy counter): the GPU counts, in whole counts, the work done on the cells (forces), the base warmth
// put in, the heat leaked out, the drag and the kicks; once per frame it also sums the heat in the dish and the cells'
// motion energy, and the ledger part of the buffer is copied to one of a small ring of MAP_READ buffers (skipped when
// all are busy: the counters then keep adding up until the next copy), read without waiting.
//   ENTROPY = all heat that has left the dish; in = work + warmth + light absorbed; rounding = in - (moving + heat in
//   dish + out).
//
// Step C2, light (src/light.js): on each tick's first spreading substep, every pixel takes in the light that falls on it
// and keeps, as heat, what its absorbers catch (the bare medium, and the cells, which put down their cover in a fourth
// block of the buffer during their step); the ledger books, per band, the light arriving and the light absorbed (the
// difference passed through and is lost). Once per frame it also sums the heat under the cells in the light and under
// the rest, for the overlay.
//
// Step C3, matter (src/matter.js): the substances' 13 channels live in this buffer too, behind the heat's blocks (so the
// cells' step, at WebGPU's limit of 8 storage buffers, can reach them later), and book into this ledger (words 3072 on);
// this module makes room for them (extraBlocks), calls the matter's drain on a resize and its ledger pass once per frame,
// and hands it the read-back.

import { loadShader } from './gpu.js';

const LIGHT_COMMON_URL = 'src/shaders/light_common.wgsl';

export const HEAT_COMMON_URL = 'src/shaders/heat_common.wgsl';
export const HEAT_SCALE = 65536;          // counts per energy unit (HEAT_SCALE in heat_common.wgsl)
export const LEDGER_WORDS = 15872;              // LEDGER_WORDS in heat_common.wgsl (words 3072 on: step C3's matter ledger;
                                                // 10240 on: step C4's chemistry; 11520 on: step C5, cells eat)
// ledger regions [first word, slots]; OUT, HEAT and MOVE are 64-bit (the carry words follow 64 words later)
const LG = { WORK: [0, 256], BASE: [256, 64], OUT: [320, 64], HEAT: [448, 64], MOVE: [576, 64], DRAG: [704, 160], KICK: [864, 160] };
const LG_WIDE = new Set(['OUT', 'HEAT', 'MOVE']);
// step C2 (heat_common.wgsl): per band (4) light in and light absorbed, 64-bit, 128 words each; the snapshot of the
// heat under cells and pixels in / out of the light: 4 classes of 64 counts (i32), and their heat (64-bit, 128 words each)
const LG_LIGHT_IN = 1024, LG_LIGHT_ABS = 1536, LG_SPOT_N = 2048, LG_SPOT_T = 2304;
const SPOT_UNIT = 64;     // the spot snapshot counts heat in units of 64 counts (SPOT_SHIFT in heat.wgsl)
const HP_BYTES = 64;                      // struct HeatP
const HT_SLOT = 256;                      // struct HeatTick slots, bound with a dynamic offset
const MAX_TICKS = 320;                    // as SLOTS in cells.js
const MAX_SUB = 8;                        // spreading substeps per tick at most
const HT_LEDGER = MAX_TICKS * MAX_SUB;    // slot of the ledger passes
const HT_DRAIN = HT_LEDGER + 1;
const HT_DEPOSIT = HT_LEDGER + 2;
const HT_SLOTS = HT_LEDGER + 3;
const MAX_PIXELS = 300000;                // the grid gets coarser than half a radius beyond this (very many cells)
const K_MAX = 0.2;                        // spreading per substep (the explicit scheme is stable below 0.25)
const RATE_WINDOW = 1.0;                  // s of simulation time over which the rates are measured

export class Heat {
  constructor(device) {
    this.device = device;
    // live-tunable: moire.heat.params
    this.params = {
      kicks: true,      // Shift+H: kicks from heat (off: the old constant jitter, Sim.jitter)
      spread: 12,       // how fast heat spreads (R^2 per s; a patch spreads over about sqrt(spread / leak) R)
      leak: 0.5,        // share of the heat that leaks out to the sky per s (sets the dish's temperature)
      edge: 0,          // extra share per s that leaks at the dish edge (0 = an insulated edge)
      warmth: 0.05,     // base warmth put in everywhere (units per R^2 per s), so the dish is never at zero
      grab: 0.00125,    // share of the heat under a cell (its 3 x 3 pixels) that one kick takes on average, per tick
      kickMax: 2,       // largest kick, R / s per axis
      pxR: 0.5,         // heat pixel size in units of the cells' radius R
    };
    this.hw = 0; this.hh = 0; this.n = 0; this.px = 1; this.R = 1;
    this.cur = 0;           // which heat copy is current
    this.nSub = 1; this.k = 0;
    this.version = 0;       // bumped when the buffer is replaced (bind groups that hold it are rebuilt)
    this.buffer = null;
    this.old = null;        // the grid replaced by a resize, drained into "out" at the next frame
    this.trash = [];
    this.cellBuf = null; this.count = 0;
    this.light = null;      // step C2: the light (src/light.js; its uniform is bound to the heat passes)
    this.matter = null;     // step C3: the substance grid (src/matter.js), whose channels live in this buffer too
    this.eat = null;        // step C5: the cells' eating (src/eat.js), which books into this ledger too
    // ledger (cumulative since the page started; energy units)
    this.tot = { work: 0, base: 0, out: 0, drag: 0, kick: 0, lin: [0, 0, 0, 0], labs: [0, 0, 0, 0] };
    this.ledger = null;     // last snapshot: { time, moving, heat, in, out, rounding, rate }
    this.hist = [];         // [time, work, base, out, drag, kick] for the rates
    this.seq = 0; this.nextSeq = 0; this.pending = new Map();
    this.ticksSince = 0;
  }

  static async create(device) {
    const h = new Heat(device);
    await h.init();
    return h;
  }

  async init() {
    const d = this.device;
    const res = await fetch(HEAT_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${HEAT_COMMON_URL}: HTTP ${res.status}`);
    const common = (await res.text()).replace(/\s*$/, '\n\n');
    const lres = await fetch(LIGHT_COMMON_URL, { cache: 'no-cache' });
    if (!lres.ok) throw new Error(`Could not load shader ${LIGHT_COMMON_URL}: HTTP ${lres.status}`);
    const light = (await lres.text()).replace(/\s*$/, '\n\n');
    const mod = await loadShader(d, 'src/shaders/heat.wgsl', {
      prefixes: [{ name: HEAT_COMMON_URL, text: common }, { name: LIGHT_COMMON_URL, text: light }],
    });
    const C = GPUShaderStage.COMPUTE;
    this.bgl = d.createBindGroupLayout({
      label: 'heat',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
        { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: C, buffer: { type: 'uniform' } },
      ],
    });
    const layout = d.createPipelineLayout({ label: 'heat', bindGroupLayouts: [this.bgl] });
    this.pipes = {};
    for (const e of ['spread', 'sum_heat', 'sum_cells', 'deposit', 'drain']) {
      this.pipes[e] = d.createComputePipeline({ label: `heat ${e}`, layout, compute: { module: mod, entryPoint: e } });
    }
    const U = GPUBufferUsage;
    this.paramBuf = d.createBuffer({ label: 'heat params', size: HP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.paramAB = new ArrayBuffer(HP_BYTES);
    this.tickBuf = d.createBuffer({ label: 'heat tick params', size: HT_SLOTS * HT_SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.tickAB = new ArrayBuffer(HT_SLOTS * HT_SLOT);
    this.reads = [0, 1, 2].map((k) => ({
      buf: d.createBuffer({ label: `heat ledger read ${k}`, size: LEDGER_WORDS * 4, usage: U.MAP_READ | U.COPY_DST }), busy: false,
    }));
  }

  /** Step C2: the light, whose uniform the heat passes read. Called once by main.js, before the first resize. */
  setLight(light) {
    this.light = light;
    if (this.buffer && this.cellBuf) this.bg = this.makeBG(this.buffer);
  }

  /** The cells (their buffer is read by sum_cells and deposit). Called once by cells.js. */
  setCells(cellBuf, count) {
    this.cellBuf = cellBuf; this.count = count;
    if (this.buffer) this.bg = this.makeBG(this.buffer);
  }

  makeBG(buffer) {
    return this.device.createBindGroup({
      label: 'heat', layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: this.tickBuf, size: 32 } },
        { binding: 2, resource: { buffer } },
        { binding: 3, resource: { buffer: this.cellBuf } },
        { binding: 4, resource: { buffer: this.light.buffer } },
      ],
    });
  }

  /** Word offset of heat copy c. */
  offset(c) { return LEDGER_WORDS + this.n * (1 + c); }
  /** Word offset of the current heat copy at the start of tick t of this frame (each substep flips the copies). */
  offsetAt(t) { return this.offset(this.cur ^ ((t * this.nSub) & 1)); }
  /** Word offset of the cells' cover (step C2). */
  get coverOffset() { return LEDGER_WORDS + 3 * this.n; }
  /** Bytes of the whole heat buffer (with step C3's substance channels behind the heat's blocks). */
  get bytes() { return (LEDGER_WORDS + (4 + this.extraBlocks) * this.n) * 4; }
  /** Blocks of n words that other bands keep in this buffer (step C3: the substances, 2 copies of 13 channels). */
  get extraBlocks() { return this.matter ? this.matter.blocks : 0; }
  /** Word offset of the first block after the heat's own (step C3: the substances' copy 0, channel 0), for n pixels. */
  extraBase(n = this.n) { return LEDGER_WORDS + 4 * n; }

  /** Step C3: the substance grid. Called once by main.js, before the first resize (the buffer makes room for it). */
  setMatter(matter) { this.matter = matter; }
  /** Whether the light is on this frame (then the cells put down their cover and the pixels absorb). */
  get lightOn() { return !!(this.light && this.light.on); }

  /** Size the grid from the dish and the cells' radius R; a new grid replaces the old at the next frame. */
  resize(view, R) {
    this.R = R;
    const p = this.params, { cssW: W, cssH: H } = view;
    const px = Math.max(p.pxR * R, Math.sqrt(W * H / MAX_PIXELS), 0.5);
    this.px = px;
    const hw = Math.max(2, Math.ceil(W / px)), hh = Math.max(2, Math.ceil(H / px));
    if (this.buffer && hw === this.hw && hh === this.hh) return;
    if (this.buffer) {
      // the grid in use is drained into "out" at the next frame (its heat leaves with the old dish); a grid made by an
      // earlier resize and never used since is simply dropped
      if (this.old) this.trash.push(this.buffer);
      else this.old = { buffer: this.buffer, bg: this.bg, n: this.n, src: this.offset(this.cur) };
    }
    this.hw = hw; this.hh = hh; this.n = hw * hh; this.cur = 0;
    this.buffer = this.device.createBuffer({
      label: `heat grid ${hw}x${hh}`, size: this.bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    if (this.cellBuf) this.bg = this.makeBG(this.buffer);
    this.version++;
  }

  /** Temperature (heat per R^2, energy units) per count in one pixel. */
  get tempScale() { const a = this.px / this.R; return 1 / (HEAT_SCALE * a * a); }

  /** Write the grid's parameters and every substep's slot for this frame; drain a replaced grid. */
  beginFrame(encoder, ticks, frame) {
    for (const b of this.trash) b.destroy();
    this.trash.length = 0;
    const p = this.params, dt = frame.tickDt, a = this.px / this.R;
    const kTot = Math.max(0, p.spread) * dt / (a * a);
    this.nSub = Math.max(1, Math.min(MAX_SUB, Math.ceil(kTot / K_MAX)));
    this.k = Math.min(K_MAX, kTot / this.nSub);
    const f = new Float32Array(this.paramAB), u = new Uint32Array(this.paramAB);
    u[0] = this.hw; u[1] = this.hh; u[2] = this.n; u[3] = (p.kicks ? 1 : 0) | (this.lightOn ? 2 : 0);
    f[4] = this.px; f[5] = Math.max(0, p.grab); f[6] = Math.max(0, p.kickMax) * this.R; f[7] = this.k;
    f[8] = 1 - Math.exp(-Math.max(0, p.leak) * dt); f[9] = 1 - Math.exp(-Math.max(0, p.edge) * dt);
    f[10] = Math.max(0, p.warmth) * a * a * dt * HEAT_SCALE; f[11] = this.tempScale;
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramAB);

    const T = new Uint32Array(this.tickAB), w = HT_SLOT / 4;
    const tick0 = (frame.frameNo * 977 + 0x9e37) >>> 0;
    for (let t = 0; t < ticks; t++) {
      for (let s = 0; s < this.nSub; s++) {
        const o = (t * this.nSub + s) * w, c = this.cur ^ ((t * this.nSub + s) & 1);
        T[o] = this.offset(c); T[o + 1] = this.offset(c ^ 1); T[o + 2] = s === 0 ? 1 : 0;
        T[o + 3] = Math.imul(tick0 + t * 131 + s, 2654435761) >>> 0; T[o + 4] = this.count;
      }
    }
    const L = HT_LEDGER * w;
    T[L] = this.offset(this.cur ^ ((ticks * this.nSub) & 1)); T[L + 4] = this.count;
    const used = ticks * this.nSub;
    this.device.queue.writeBuffer(this.tickBuf, 0, this.tickAB, 0, used * HT_SLOT);
    this.device.queue.writeBuffer(this.tickBuf, HT_LEDGER * HT_SLOT, this.tickAB, HT_LEDGER * HT_SLOT, HT_SLOT);

    if (this.old) {
      // the replaced grid: its heat counted as leaked out, and its ledger counters carried over to the new buffer
      const O = this.old, D = HT_DRAIN * w;
      T[D] = O.src; T[D + 4] = O.n;
      this.device.queue.writeBuffer(this.tickBuf, HT_DRAIN * HT_SLOT, this.tickAB, HT_DRAIN * HT_SLOT, HT_SLOT);
      const pass = encoder.beginComputePass({ label: 'heat drain' });
      pass.setPipeline(this.pipes.drain);
      pass.setBindGroup(0, O.bg, [HT_DRAIN * HT_SLOT]);
      pass.dispatchWorkgroups(Math.ceil(O.n / 256));
      pass.end();
      if (this.matter) this.matter.encodeDrain(encoder, O.buffer, O.n);   // step C3: its atoms leave with the old dish
      encoder.copyBufferToBuffer(O.buffer, 0, this.buffer, 0, LEDGER_WORDS * 4);
      this.trash.push(O.buffer);
      this.old = null;
    }
  }

  /**
   * Record tick t's spreading (after the cells' step of that tick). `before(pass)`, if given, records more dispatches
   * into the same pass first (step C4: the substances' spreading and reactions, which read this tick's heat and the
   * cells' cover and put the heat they release into the delta that the spreading's first substep takes in).
   */
  encodeTick(encoder, t, before = null) {
    const pass = encoder.beginComputePass({ label: 'heat spread' });
    if (before) before(pass);
    pass.setPipeline(this.pipes.spread);
    const wx = Math.ceil(this.hw / 8), wy = Math.ceil(this.hh / 8);
    for (let s = 0; s < this.nSub; s++) {
      pass.setBindGroup(0, this.bg, [(t * this.nSub + s) * HT_SLOT]);
      pass.dispatchWorkgroups(wx, wy);
    }
    pass.end();
    // step C2: the cells' cover was read by the first substep; clear it for the next tick
    if (this.lightOn) encoder.clearBuffer(this.buffer, this.coverOffset * 4, this.n * 4);
  }

  /** After the frame's ticks: advance the current copy, and copy the ledger out if a read-back buffer is free. */
  endFrame(encoder, ticks, frame) {
    this.cur ^= (ticks * this.nSub) & 1;
    this.ticksSince += ticks;
    const rb = this.reads.find((r) => !r.busy);
    if (!rb) return;
    rb.busy = true;
    encoder.clearBuffer(this.buffer, LG.HEAT[0] * 4, 256 * 4);           // the two snapshots (64-bit)
    const pass = encoder.beginComputePass({ label: 'heat ledger' });
    pass.setBindGroup(0, this.bg, [HT_LEDGER * HT_SLOT]);
    pass.setPipeline(this.pipes.sum_heat); pass.dispatchWorkgroups(Math.ceil(this.n / 256));
    pass.setPipeline(this.pipes.sum_cells); pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
    if (this.matter) this.matter.encodeLedger(encoder);                  // step C3: the atoms in the dish, the order
    if (this.eat) this.eat.encodeLedger(encoder);                        // step C5: the atoms and energy in the cells
    encoder.copyBufferToBuffer(this.buffer, 0, rb.buf, 0, LEDGER_WORDS * 4);
    encoder.clearBuffer(this.buffer, 0, LG.HEAT[0] * 4);                  // work, warmth, out: counted from here on
    encoder.clearBuffer(this.buffer, LG.DRAG[0] * 4, (LEDGER_WORDS - LG.DRAG[0]) * 4);   // drag, kicks
    const rec = { seq: this.seq++, time: frame.time, ticks: this.ticksSince };
    this.ticksSince = 0;
    setTimeout(() => this.read(rb, rec), 0);                             // map once this frame is submitted
  }

  async read(rb, rec) {
    let words = null;
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      words = new Int32Array(rb.buf.getMappedRange().slice(0));
      rb.buf.unmap();
    } catch (e) {
      // device lost or page closing
    } finally {
      rb.busy = false;
    }
    // apply in order (the counters are deltas, the snapshots must belong to the totals they are compared with)
    this.pending.set(rec.seq, { rec, words });
    while (this.pending.has(this.nextSeq)) {
      const { rec: r, words: w } = this.pending.get(this.nextSeq);
      this.pending.delete(this.nextSeq++);
      // (the matter first: step C4's chemical energy is part of the energy books)
      // (step C5: the cells' stock first, which both books include)
      if (w) { if (this.eat) this.eat.apply(r, w); if (this.matter) this.matter.apply(r, w); this.apply(r, w); }
    }
  }

  apply(rec, w) {
    // a region's slots summed (exact in a double); 64-bit slots: carry word x 2^32 + the low word read as unsigned
    const sum = (name) => {
      const [a, n] = LG[name];
      let s = 0;
      if (LG_WIDE.has(name)) for (let k = a; k < a + n; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0);
      else for (let k = a; k < a + n; k++) s += w[k];
      return s / HEAT_SCALE;
    };
    // a 64-bit region of 64 slots at word a (step C2's light and spot numbers), and a plain one
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const plain = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k]; return s; };
    const T = this.tot, kick = sum('KICK');
    T.work += sum('WORK'); T.base += sum('BASE'); T.out += sum('OUT'); T.drag += sum('DRAG'); T.kick += kick;
    for (let b = 0; b < 4; b++) {
      T.lin[b] += wide(LG_LIGHT_IN + 128 * b) / HEAT_SCALE;
      T.labs[b] += wide(LG_LIGHT_ABS + 128 * b) / HEAT_SCALE;
    }
    const lin = T.lin.reduce((a, b) => a + b, 0), labs = T.labs.reduce((a, b) => a + b, 0);
    // step C4: the light the substances caught (into bonds, the rest as heat), the chemical energy in the dish, and the
    // chemical energy that left with matter (at the edge, washed out, on a resize)
    const C = this.matter && this.matter.ledger ? this.matter.ledger.chem : { light: 0, dish: 0, out: 0 };
    // step C5: the cells' chemical energy (their stock) and their batteries are stored too; the starter charges came in
    const cellsE = (C.cells || 0) + (C.bat || 0);
    const moving = sum('MOVE'), heat = sum('HEAT'), inn = T.work + T.base + labs + C.light + (C.start || 0);
    // the heat under the cells / pixels in the light and the rest, as temperatures (heat per R^2)
    const ts = this.tempScale;
    const spot = [0, 1, 2, 3].map((k) => {
      const n = plain(LG_SPOT_N + 64 * k);
      return { n, temp: n ? wide(LG_SPOT_T + 128 * k) * SPOT_UNIT * ts / n : 0 };
    });
    const H = this.hist;
    H.push([rec.time, T.work, T.base, T.out, T.drag, T.kick, lin, labs, ...T.lin, ...T.labs]);
    while (H.length > 2 && rec.time - H[1][0] >= RATE_WINDOW) H.shift();
    const h0 = H[0], dt = rec.time - h0[0];
    const rate = (k) => (dt > 0.05 ? (H[H.length - 1][k] - h0[k]) / dt : 0);
    this.ledger = {
      time: rec.time, moving, heat, in: inn, out: T.out, rounding: inn - (moving + heat + T.out + C.dish + cellsE + C.out),
      chem: C.dish + cellsE, chemDish: C.dish, chemCells: C.cells || 0, bat: C.bat || 0, chemOut: C.out,
      light: { in: lin, abs: labs, chem: C.light, pass: lin - labs - C.light },
      rate: {
        work: rate(1), base: rate(2), out: rate(3), drag: rate(4), kick: rate(5), lin: rate(6), labs: rate(7),
        binIn: [0, 1, 2, 3].map((b) => rate(8 + b)), binAbs: [0, 1, 2, 3].map((b) => rate(12 + b)),
        // step C4: the light the substances caught, per s (from the matter's ledger, same read-back)
        binChem: C.lightRate || [0, 0, 0, 0], lchem: (C.lightRate || []).reduce((a, b) => a + b, 0),
      },
      spot: { cellsIn: spot[0], cellsOut: spot[1], pxIn: spot[2], pxOut: spot[3] },
      kickPerTick: rec.ticks && this.count ? kick / (rec.ticks * this.count) : 0,
    };
  }

  /**
   * Every cell's motion energy into the heat at its place (before a new culture overwrites the cells; queue order
   * puts this before the write). The books stay balanced: moving goes down, heat in dish up by the same counts.
   */
  depositAll() {
    if (!this.buffer || !this.cellBuf || !this.bg) return;
    const T = new Uint32Array(this.tickAB), o = HT_DEPOSIT * HT_SLOT / 4;
    T[o + 4] = this.count;
    this.device.queue.writeBuffer(this.tickBuf, HT_DEPOSIT * HT_SLOT, this.tickAB, HT_DEPOSIT * HT_SLOT, HT_SLOT);
    const e = this.device.createCommandEncoder({ label: 'heat deposit' });
    const pass = e.beginComputePass({ label: 'heat deposit' });
    pass.setPipeline(this.pipes.deposit);
    pass.setBindGroup(0, this.bg, [HT_DEPOSIT * HT_SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
    this.device.queue.submit([e.finish()]);
  }

  /** The entropy panel's lines (plain text); compact: shorter lines for a narrow screen (step C3b). */
  panelText(compact = false) {
    const L = this.ledger;
    if (!L) return 'ENTROPY  …';
    const Lt = this.light, r = L.rate;
    // step C4: "stored" is the chemical energy in the dish (fuel's bonds, minus the sediment's; step C5: plus the cells'
    // stock and batteries); the light the substances
    // catch goes partly into bonds and is not heat until a reaction releases it
    if (compact) {
      const light = !Lt || !Lt.on ? 'light off' : `light ${fmt(r.lin)}/s → caught ${fmt(r.labs + r.lchem)}/s · ${Lt.label().replace(' · day', '')}`;
      return `ENTROPY ${fmt(L.out)} +${fmt(L.rate.out)}/s\n` +
        `heat ${fmt(L.heat)} · moving ${fmt(L.moving)} · stored ${fmt(L.chem)} · rounding ${fmtRound(L.rounding)}\n` + light;
    }
    const light = !Lt || !Lt.on ? 'light off'
      : `light in ${fmt(r.lin)}/s → heat ${fmt(r.labs)}/s · chemistry ${fmt(r.lchem)}/s · passed ${fmt(r.lin - r.labs - r.lchem)}/s · ${Lt.label()}`;
    return `ENTROPY  ${fmt(L.out)}  +${fmt(L.rate.out)}/s\n` +
      `moving ${fmt(L.moving)} · heat in dish ${fmt(L.heat)} · stored ${fmt(L.chem)} · in ${fmt(L.in)} · rounding ${fmtRound(L.rounding)}\n` + light;
  }

  /** Lines for the F overlay. */
  overlayLines(view) {
    const p = this.params, L = this.ledger, on = (x) => (x ? 'on' : 'off');
    const lines = [`heat: grid ${this.hw}×${this.hh} (${this.px.toFixed(2)} px, ${(this.px / this.R).toFixed(2)} R) · spread ${p.spread} R²/s` +
      ` (${this.nSub} substeps of k ${this.k.toFixed(3)}) · leak ${p.leak}/s · edge ${p.edge}/s · warmth ${p.warmth}/R²/s` +
      ` · Shift+H kicks ${on(p.kicks)} (grab ${p.grab}/tick, max ${p.kickMax} R/s)`];
    if (L) {
      const area = view.cssW * view.cssH / (this.R * this.R);
      const sigma = HEAT_V0_PX * Math.sqrt(Math.max(0, L.kickPerTick)) / this.R;
      const r = L.rate;
      lines.push(`energy per s: in ${fmt(r.work + r.base + r.labs + r.lchem)} (work by forces ${fmt(r.work)}, warmth ${fmt(r.base)}, light ${fmt(r.labs)}` +
        ` + caught by the substances ${fmt(r.lchem)}) · stored ${fmt(L.chem)} (in the dish's bonds ${fmt(L.chemDish)}, in the cells' stock ${fmt(L.chemCells)}, batteries ${fmt(L.bat)}), out with matter ${fmt(L.chemOut)} · drag → heat ${fmt(r.drag)}` +
        ` · kicks ← heat ${fmt(r.kick)} · out ${fmt(r.out)} · mean temperature ${(L.heat / area).toFixed(3)}/R² · kick ≈ ${sigma.toFixed(3)} R/s per axis` +
        ` (the old jitter ≈ 0.13) · rounding ${fmtRound(L.rounding)} (${L.in > 0 ? (L.rounding / L.in).toExponential(1) : '-'} of in)`);
    }
    if (this.light) {
      lines.push(this.light.overlayLine());
      if (L && L.light) {
        const r = L.rate, S = L.spot, t = (c) => `${c.temp.toFixed(2)}/R² (${c.n})`;
        // the kick a cell at that temperature gets (sigma per axis, before its motility): HEAT_V0 sqrt(grab x its 3 x 3 pixels)
        const ar = this.px / this.R, kick = (T) => (HEAT_V0_PX * Math.sqrt(Math.max(0, this.params.grab * 9 * T * ar * ar)) / this.R).toFixed(2);
        if (this.light.on) {
          const per = BAND_NAMES.map((n, b) => `${n} ${fmt(r.binIn[b])} → ${fmt(r.binAbs[b])} + ${fmt(r.binChem[b])}`).join(', ');
          const where = this.light.modeIndex === 1 ? 'in the spot' : 'lit';
          lines.push(`light per s: in ${fmt(r.lin)} · absorbed → heat ${fmt(r.labs)} · caught by the substances ${fmt(r.lchem)} · passed through (lost) ${fmt(r.lin - r.labs - r.lchem)}` +
            ` · per band in → absorbed + by the substances: ${per} · totals in ${fmt(L.light.in)}, absorbed ${fmt(L.light.abs)}, substances ${fmt(L.light.chem)}, passed ${fmt(L.light.pass)}`);
          lines.push(`temperature under cells ${where} ${t(S.cellsIn)}, outside ${t(S.cellsOut)} (kick ≈ ${kick(S.cellsIn.temp)} and ${kick(S.cellsOut.temp)} R/s per axis)` +
            ` · dish pixels ${where} ${t(S.pxIn)}, outside ${t(S.pxOut)}`);
        } else {
          lines.push(`temperature under cells ${t(S.cellsOut)} (kick ≈ ${kick(S.cellsOut.temp)} R/s per axis) · dish pixels ${t(S.pxOut)}`);
        }
      }
    }
    return lines;
  }
}

const HEAT_V0_PX = 10;   // HEAT_V0 in heat_common.wgsl
const BAND_NAMES = ['warm', 'visible 1', 'visible 2', 'hard'];   // as BANDS in src/light.js

/** A number with 3 significant digits and a k / M / G suffix. */
export function fmt(x) {
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toPrecision(3) + ' G';
  if (a >= 1e6) return (x / 1e6).toPrecision(3) + ' M';
  if (a >= 1e4) return (x / 1e3).toPrecision(3) + ' k';
  if (a >= 100) return x.toFixed(0);
  if (a >= 1) return x.toPrecision(3);
  if (a === 0) return '0';
  return x.toPrecision(2);
}

/** The rounding: signed, 2 significant digits. */
function fmtRound(x) {
  if (x === 0) return '0';
  const s = x > 0 ? '+' : '−';
  const a = Math.abs(x);
  return s + (a >= 1e4 || a < 1e-3 ? a.toExponential(1) : a.toPrecision(2));
}
