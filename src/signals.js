// Step Q1, A SIGNAL SUBSTANCE (BUILD QUEUE 6a6c, the user 2026-11-24: "create a substance just for signaling, even if it is not realistic. It
// would still be multi purpose and let evolution apply it as a tool, could even become like a neuro transmitter of sorts"; README "Step Q1").
// A toy substance with no other effect than being heard: it does nothing unless a cell is wired to it. Every part its own switch (URL options,
// the rules panel's group "Signal substance (step Q1)"):
//
//   THE GRID (?signal=0)   one MATTER-FREE substance on the heat grid (src/shaders/signal.wgsl): its ENERGY A (heat counts: paid from the
//                        batteries, exact) and its FLAVOUR as a vector (X, Y = amount x cos / sin of a flavour angle), so signals of different
//                        flavours add and partly cancel. It spreads fast (`spread` R^2 per s), rides the water (?sigflow=0: not carried),
//                        stops at solid walls (step G0b; porous walls pass it), FADES with a fixed lifetime (`life` s): its energy becomes
//                        heat where it is (booked). The books: its energy in the dish is stored energy (the rounding stays 0)
//   RELEASE (eat pass)     a cell pays `power` energy per s at release gene 1 (Bio.sg.w, founders 0) x the gene network's output, split by the
//                        JUNCTION SHARE gene (Bio.sh.x) between the WATER (onto the grid at its centre, a hormone / quorum signal: slow, wide)
//                        and its formed JUNCTION sides (step G0: straight into each joined neighbour's inbox, a TRANSMITTER: fast, private; the
//                        energy becomes heat at the cell at once, only the flavour travels; ?junction=0)
//   HEARING (gene network pass)  a receptor reads the PROJECTION on its preferred flavour (Bio.sg.y) tuned by a width gene (Bio.sg.z): heard =
//                        |v| exp(-(1 - cos(angle(v) - preferred)) / width^2), so only near-matching flavours are heard (the moire principle
//                        again); two senses for the network: HEARD IN WATER (1 - e^(-heard / hearW)) and HEARD THROUGH JUNCTIONS (1 - e^(-heard
//                        per s / hearJ)); two outputs: RELEASE TO WATER, RELEASE TO JUNCTIONS (gene x exp(u x)). A TASTE dial (Bio.sh.y; step
//                        P3's steering) follows or flees the heard signal. ?signalnull=1 the NEUTRAL control: released and paid as usual, but
//                        every cell hears the dish somewhere else (a random pixel, a random cell's inbox: noise with the same statistics), and
//                        the taste does not steer
//   FAST REGULATORS (?fastreg=0)  a per-regulator SPEED gene (Bio.sh.z: bits, one per regulator): a fast regulator relaxes with tauFast (0.3 s)
//                        instead of step T1b's 5 s, so a relay (hear -> fire -> release) can carry a pulse from cell to cell, and waves or
//                        spirals through tissue become POSSIBLE. Never written as a rule: only wiring (evolved, or the lab's hand) makes one
//
// Founders: std and blank are SILENT (release 0, no fast regulators, no outputs, no taste; each founder line a random flavour, heard as its
// own); wild founders (group 'signal') draw everything. Mutation at births (M2's scale; rare mode with the gene network's group).
// This module: switches and knobs (moire.signals.params), the grid's passes, the books (heat ledger words 47104.., LG_SIG), the gene network's
// and the eat pass's words, a census, the SIGNALS panel line, overlay lines, the pipette (moire.signals.puff), the view's haze.

import { loadShader } from './gpu.js';
import { HEAT_COMMON_URL, HEAT_SCALE, LEDGER_WORDS, fmt } from './heat.js';
import { SIGNAL_SENSES } from './folding.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { readBuffer } from './snapshot.js';
import { camera } from './camera.js';

const B_SG = 224, B_SH = 228, B_SO = 232, B_SS = 236, B_FOUNDER = 7, B_GX = 84, B_GW = 100, B_GI = 124;
const C_FLAGS = 9, C_KIND = 8, C_MOTW = 93;
const SRC_W = 25, SRC_J = 26;   // the input codes of the senses heard in water, through junctions (9 + 16, 9 + 17)
const deg = (a) => Math.round(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 180 / Math.PI);

export const XY_SCALE = 16;            // flavour vector counts per heat count of energy (signal.wgsl, cell_eat.wgsl, cell_grn.wgsl)
export const SIG_BLOCKS_GRID = 6;      // two copies of A, X, Y
export const Q1 = { ON: 1, JUNC: 2, TASTE: 4, NULL: 8 };   // EatP.q1[0].x bits (cell_eat.wgsl Q1E_*)
const SQ_BYTES = 80;                   // struct SigQ (cell_grn.wgsl)
const FLASH_TAU = 0.25;                // s: a release's flash fades this fast
const FLASH_GAIN = 4;                  // a rise of a quarter of gene 1's release above the baseline lights the flash fully
const SP_BYTES = 80;                   // struct SigP
const ST_SLOT = 256;                   // struct SigT slots, bound with a dynamic offset
const MAX_TICKS = 320, MAX_SUB = 8;
const ST_LEDGER = MAX_TICKS * MAX_SUB, ST_DRAIN = ST_LEDGER + 1, ST_PUFF = ST_LEDGER + 2, ST_SLOTS = ST_LEDGER + 3;
const K_MAX = 0.15;                    // spreading per substep (with the water's share and the fade, what leaves a pixel stays below all of it)
const LG_SIG = 47104;                  // heat_common.wgsl
const RATE_WINDOW = 2;                 // s for the rates

export class Signals {
  constructor(cells) {
    this.cells = cells;
    this.heat = null;
    // live-tunable (moire.signals.params); the rules panel's group "Signal substance (step Q1)"
    this.params = {
      on: true,           // the whole step (?signal=0: no grid, no genes acting, nothing heard; the genes are carried)
      spread: 6,          // R^2 per s (?sigspread=): fast (the heat spreads 12, the atoms 0.5 .. 3)
      life: 2,            // s: the signal fades with this lifetime, its energy to heat (?siglife=)
      flow: true,         // the water carries it (?sigflow=0)
      power: 0.004,       // energy per s a cell releases at release gene 1 and output factor 1 (?sigpower=; an engine's upkeep at rate 1 is 0.003)
      hearW: 2e-4,        // heard in water: energy per R^2 (tuned projection) at which the sense is 1 - 1/e (?hearw=)
      hearJ: 2e-4,        // heard through junctions: energy per s at which the sense is 1 - 1/e (?hearj=; a neighbour firing at a release of 0.45 x gene 1 through 6 junctions gives 1.5)
      junction: true,     // release through formed junctions (?junction=0: the junction share is not released at all)
      taste: true,        // the taste dial steers (with step P3's taste on) (?sigtaste=0)
      fast: true,         // fast regulators act (?fastreg=0: every regulator at step T1b's tau)
      tauFast: 0.3,       // s (?taufast=)
      null: false,        // the NEUTRAL control (?signalnull=1): heard at a random place, the taste does not steer
      mutate: true,       // the genes mutate at births (?sigmut=0)
      censusEvery: 5,     // s of simulated time between the census's read-backs (0: never) (?sigcensus=)
      waveWindow: 4,      // s: the census's wave detector looks at cells that began to fire this recently
      puffAmount: 0.4,    // the pipette: energy per puff (booked as energy in)
      puffRadius: 2.5,    // ... its radius (R)
      puffFlavour: 0,     // ... its flavour (rad)
      pokeTime: 0.6,      // s: the pipette's touch lasts this long (the cells under it hear its flavour as through junctions)
      pokeHear: 3,        // ... as strongly as pokeHear x hearJ per s (heard at 1 - e^-3: 95 %)
    };
    // the look (moire.signals.look; drawing only)
    this.look = {
      haze: 0.8,         // the signals view's haze brightness (0: none)
      ref: 2e-4,         // energy per R^2 (as a vector) at which the haze is half bright
      mist: 0.5,         // the pale mist where flavours cancel (share)
      flash: 1.6,        // the release flash's brightness on the tube, in every view (0: none)
      fill: 0.45,        // the signals view's body fill at full release
      sat: 0.9,          // the hues' saturation
    };
    this.tot = { decay: 0, puff: 0, made: 0, junc: 0 };
    this.ledger = null;
    this.hist = [];
    this.puffs = [];
    this.nSub = 2; this.k = 0;
    this.census = null;
    this.busy = false;
    this.lastAt = -1e9;
  }

  async init(device) {
    this.device = device;
    const res = await fetch(HEAT_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${HEAT_COMMON_URL}: HTTP ${res.status}`);
    const common = (await res.text()).replace(/\s*$/, '\n\n');
    const mod = await loadShader(device, 'src/shaders/signal.wgsl', { prefixes: [{ name: HEAT_COMMON_URL, text: common }] });
    const C = GPUShaderStage.COMPUTE;
    this.bgl = device.createBindGroupLayout({
      label: 'signal',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    const layout = device.createPipelineLayout({ label: 'signal', bindGroupLayouts: [this.bgl] });
    this.pipes = {};
    for (const e of ['spread', 'sum', 'drain', 'puff']) this.pipes[e] = device.createComputePipeline({ label: `signal ${e}`, layout, compute: { module: mod, entryPoint: e } });
    const U = GPUBufferUsage;
    this.pBuf = device.createBuffer({ label: 'signal params', size: SP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.pAB = new ArrayBuffer(SP_BYTES);
    this.tBuf = device.createBuffer({ label: 'signal tick params', size: ST_SLOTS * ST_SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.tAB = new ArrayBuffer(ST_SLOTS * ST_SLOT);
    this.qBuf = device.createBuffer({ label: 'signal cells params', size: SQ_BYTES, usage: U.UNIFORM | U.COPY_DST });   // struct SigQ (cell_grn.wgsl)
    this.qAB = new ArrayBuffer(SQ_BYTES);
    // the signals view's haze (src/shaders/signal_draw.wgsl), into the light buffer under the cells
    const dmod = await loadShader(device, 'src/shaders/signal_draw.wgsl');
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = device.createRenderPipeline({
      label: 'signal haze', layout: 'auto',
      vertex: { module: dmod, entryPoint: 'vs' },
      fragment: { module: dmod, entryPoint: 'fs', targets: [{ format: this.cells.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.dBuf = device.createBuffer({ label: 'signal haze params', size: 64, usage: U.UNIFORM | U.COPY_DST });
    this.dAB = new ArrayBuffer(64);
  }

  // ---------------------------------------------------------------- the look
  /** The view in use is the signals view (cells.look.view, VIEWS in src/actions.js). */
  get viewOn() { return this.cells.look && this.cells.look.view === 8; }
  /** The cells' drawing words (struct Draw q1, from word o). */
  writeDraw(a, o, neon = true) {
    const K = this.look;
    a[o] = this.viewOn ? 1 + (this.cells.grn && this.cells.grn.acts ? 2 : 0) : 0; a[o + 1] = this.on ? Math.max(0, K.flash) * (neon ? 1 : 0.7) : 0; a[o + 2] = Math.max(0, K.fill); a[o + 3] = Math.max(0, K.sat);
  }
  /** A layer for main.js (under the cells, over the water): the haze, in the signals view only. */
  get drawLayer() {
    if (!this._dl) this._dl = { resize: () => {}, compute: () => {}, render: (pass, frame) => this.draw(pass, frame) };
    return this._dl;
  }
  draw(pass) {
    const H = this.heat, K = this.look;
    if (!this.on || !this.viewOn || !(K.haze > 0) || !H || !H.buffer || !this.drawPipe || !this.cells.view) return;
    if (!this.dbg || this.dbgHeat !== H.buffer) {
      this.dbgHeat = H.buffer;
      this.dbg = this.device.createBindGroup({
        label: 'signal haze', layout: this.drawPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.dBuf } }, { binding: 1, resource: { buffer: H.buffer } }],
      });
    }
    const u = new Uint32Array(this.dAB), f = new Float32Array(this.dAB), a = H.px / H.R, v = this.cells.view;
    u[0] = H.hw; u[1] = H.hh; u[2] = this.base(); u[3] = H.n;
    f[4] = H.px; f[5] = v.dpr * camera.z; f[6] = Math.max(1, K.ref * XY_SCALE * HEAT_SCALE * a * a); f[7] = K.haze;
    f.set(camera.vec(), 8);
    f[12] = v.cssW; f[13] = v.cssH; f[14] = K.sat; f[15] = K.mist;
    this.device.queue.writeBuffer(this.dBuf, 0, this.dAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.dbg);
    pass.draw(3);
  }

  get on() { return !!this.params.on; }

  // ---------------------------------------------------------------- the grid's blocks (src/heat.js: the last of its extra blocks)
  /** Blocks of n words in the heat buffer: two copies of A, X, Y, then the cells' INBOXES (2 words per cell slot: the flavour vector heard
   * through junctions this tick, written by the neighbours' eat pass, read and cleared by the gene network's pass). */
  blocksFor(n) { const cap = this.cells.count || 1; return SIG_BLOCKS_GRID + Math.max(1, Math.ceil(2 * cap / Math.max(1, n))); }
  get blocks() { return this.heat ? this.blocksFor(this.heat.n) : SIG_BLOCKS_GRID + 1; }
  /** Word offset in hb of copy 0, channel A (n pixels: the grid in use, or a replaced one). */
  base(n = this.heat.n) { return this.heat.signalBase(n); }
  get inbox() { return this.base() + SIG_BLOCKS_GRID * this.heat.n; }

  /** The grid's bind group (rebuilt when the heat buffer is replaced). */
  bgFor(buffer) {
    return this.device.createBindGroup({
      label: 'signal', layout: this.bgl,
      entries: [{ binding: 0, resource: { buffer: this.pBuf } }, { binding: 1, resource: { buffer: this.tBuf, size: 32 } }, { binding: 2, resource: { buffer } }],
    });
  }
  bindGroup() {
    const H = this.heat;
    if (this.bgVersion !== H.version || !this.bg) { this.bg = this.bgFor(H.buffer); this.bgVersion = H.version; }
    return this.bg;
  }

  /** The obstacles' mask word offset this frame (0: none), as the matter reads it. */
  maskOffset() {
    const O = this.cells.obstacles, H = this.heat;
    const on = O && O.active && O.n && O.gridVersion === H.version && !O.dirty;
    return on ? O.off('mask') : 0;
  }

  /** Before the frame's ticks (after the heat's beginFrame): the uniforms, every substep's slot, the pipette's pending puffs. */
  beginFrame(encoder, frame, ticks) {
    const H = this.heat;
    this.active = false;
    this.timeNow = frame.time;
    SIGNAL_SENSES.on = this.on;
    if (!this.on || !H || !H.buffer || !this.pipes) return;
    const p = this.params, dt = frame.tickDt, a = H.px / H.R;
    this.tickDt = dt;
    const kTot = Math.max(0, p.spread) * dt / (a * a);
    this.nSub = Math.max(2, Math.min(MAX_SUB, 2 * Math.ceil(kTot / (2 * K_MAX))));   // (even: copy 0 is current at every tick's start)
    this.k = Math.min(K_MAX, kTot / this.nSub);
    const hu = new Uint32Array(H.paramAB);
    this.cur = p.flow ? hu[14] : 0;   // (the currents' psi, as the heat's HeatP.cur: src/water.js writeHeat)
    const u = new Uint32Array(this.pAB), f = new Float32Array(this.pAB);
    u[0] = H.hw; u[1] = H.hh; u[2] = H.n; u[3] = 0;
    u[4] = this.base(); u[5] = this.maskOffset(); u[6] = this.cur; u[7] = 0;
    f[8] = this.k; f[9] = 1 - Math.exp(-dt / Math.max(0.05, p.life)); f[10] = H.px; f[11] = 0;
    const pf = this.puffs.shift();
    if (pf) {
      const r = Math.max(0.5, pf.r) * H.R, npx = Math.max(1, Math.PI * r * r / (H.px * H.px));
      f[12] = pf.x; f[13] = pf.y; f[14] = r; f[15] = pf.e * HEAT_SCALE / npx;
      f[16] = XY_SCALE * Math.cos(pf.flavour); f[17] = XY_SCALE * Math.sin(pf.flavour);
    }
    this.device.queue.writeBuffer(this.pBuf, 0, this.pAB);
    const T = new Uint32Array(this.tAB), TF = new Float32Array(this.tAB), w = ST_SLOT / 4, b0 = this.base(), n = H.n;
    const adv = this.cur ? dt / this.nSub / (H.px * H.px) : 0;
    const seed0 = (frame.frameNo * 7919 + 0x5167) >>> 0;
    for (let t = 0; t < ticks; t++) {
      for (let s = 0; s < this.nSub; s++) {
        const o = (t * this.nSub + s) * w, c = s & 1;
        T[o] = b0 + 3 * n * c; T[o + 1] = b0 + 3 * n * (c ^ 1); T[o + 2] = s === 0 ? 1 : 0;
        T[o + 3] = Math.imul(seed0 + t * 131 + s, 2654435761) >>> 0; TF[o + 4] = adv; T[o + 5] = 0;
      }
    }
    this.device.queue.writeBuffer(this.tBuf, 0, this.tAB, 0, ticks * this.nSub * ST_SLOT);
    const L = ST_LEDGER * w;
    T[L] = b0; T[L + 3] = seed0;
    const Q = ST_PUFF * w;
    T[Q] = b0; T[Q + 3] = seed0 ^ 0x9e3779b9;
    this.device.queue.writeBuffer(this.tBuf, ST_LEDGER * ST_SLOT, this.tAB, ST_LEDGER * ST_SLOT, 3 * ST_SLOT);
    this.active = true;
    if (pf) {
      const pass = encoder.beginComputePass({ label: 'signal puff' });
      pass.setPipeline(this.pipes.puff);
      pass.setBindGroup(0, this.bindGroup(), [ST_PUFF * ST_SLOT]);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
      pass.end();
    }
  }

  /** Tick t's substeps (after the cells eat: their releases are in copy 0; before the heat spreads: the fade's heat is in its delta). */
  encodeTick(encoder, t) {
    if (!this.active) return;
    const H = this.heat, pass = encoder.beginComputePass({ label: 'signal spread' });
    pass.setPipeline(this.pipes.spread);
    const bg = this.bindGroup(), wx = Math.ceil(H.hw / 8), wy = Math.ceil(H.hh / 8);
    for (let s = 0; s < this.nSub; s++) {
      pass.setBindGroup(0, bg, [(t * this.nSub + s) * ST_SLOT]);
      pass.dispatchWorkgroups(wx, wy);
    }
    pass.end();
  }

  /** The heat's ledger pass (src/heat.js endFrame, when a read-back is due): the signal's energy in the dish. */
  encodeLedger(encoder) {
    const H = this.heat;
    if (!this.pipes || !H.buffer) return;
    // (the copy current at the frame's end is copy 0; its slot was written by beginFrame; with the step off the grid still holds what it held)
    const T = new Uint32Array(this.tAB), w = ST_SLOT / 4, L = ST_LEDGER * w;
    T[L] = this.base();
    this.device.queue.writeBuffer(this.tBuf, ST_LEDGER * ST_SLOT, this.tAB, ST_LEDGER * ST_SLOT, ST_SLOT);
    if (!this.active) {   // (the uniform's n for this grid)
      const u = new Uint32Array(this.pAB);
      u[0] = H.hw; u[1] = H.hh; u[2] = H.n;
      this.device.queue.writeBuffer(this.pBuf, 0, this.pAB, 0, 16);
    }
    const pass = encoder.beginComputePass({ label: 'signal ledger' });
    pass.setPipeline(this.pipes.sum);
    pass.setBindGroup(0, this.bindGroup(), [ST_LEDGER * ST_SLOT]);
    pass.dispatchWorkgroups(Math.ceil(H.n / 256));
    pass.end();
  }

  /** A replaced grid (src/heat.js encodeDrain, before its ledger is copied over): its signal energy left the dish as heat. */
  encodeDrain(encoder, buffer, n) {
    if (!this.pipes) return;
    const T = new Uint32Array(this.tAB), w = ST_SLOT / 4, D = ST_DRAIN * w;
    T[D] = this.base(n); T[D + 5] = n;
    this.device.queue.writeBuffer(this.tBuf, ST_DRAIN * ST_SLOT, this.tAB, ST_DRAIN * ST_SLOT, ST_SLOT);
    const pass = encoder.beginComputePass({ label: 'signal drain' });
    pass.setPipeline(this.pipes.drain);
    pass.setBindGroup(0, this.bgFor(buffer), [ST_DRAIN * ST_SLOT]);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
  }

  /** The heat's read-back (before the heat applies it: the rounding counts the signal's energy as stored, the puffs as energy in). */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s / HEAT_SCALE; };
    const plain = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k]; return s / HEAT_SCALE; };
    const T = this.tot;
    T.decay += wide(LG_SIG + 128); T.puff += wide(LG_SIG + 256); T.made += plain(LG_SIG + 384); T.junc += plain(LG_SIG + 448);
    const H = this.hist;
    H.push([rec.time, T.decay, T.puff, T.made, T.junc]);
    while (H.length > 2 && rec.time - H[1][0] >= RATE_WINDOW) H.shift();
    const h0 = H[0], dt = rec.time - h0[0], last = H[H.length - 1];
    const rate = (k) => (dt > 0.05 ? (last[k] - h0[k]) / dt : 0);
    this.ledger = { time: rec.time, dish: wide(LG_SIG), puff: T.puff, rate: { decay: rate(1), puff: rate(2), made: rate(3), junc: rate(4) } };
  }

  // ---------------------------------------------------------------- the cells' words
  /** The gene network's words (struct GrnP q1, from word o): the senses and outputs exist, fast regulators, tauFast. */
  writeGrn(u, f, o) {
    const p = this.params;
    u[o] = this.on ? 1 | (p.fast ? 2 : 0) : 0; f[o + 1] = Math.max(0.02, Number(p.tauFast) || 0.3); f[o + 2] = 0; f[o + 3] = 0;
  }
  /** The signal dispatch's words (struct SigQ in cell_grn.wgsl), once a frame (with the gene network's uniform). */
  writeQ() {
    const H = this.heat, p = this.params;
    if (!H || !H.buffer) return;
    const u = new Uint32Array(this.qAB), f = new Float32Array(this.qAB), a = H.px / H.R, dt = this.tickDt || 1 / 60;
    u[0] = (this.on && this.active ? 1 : 0) | (p.null ? 2 : 0) | (p.mutate ? 4 : 0);
    u[1] = this.base(); u[2] = this.inbox; u[3] = H.n; u[4] = H.hw; u[5] = H.hh; u[6] = 0; u[7] = 0;
    f[8] = H.px;
    f[9] = 1 / (XY_SCALE * HEAT_SCALE * a * a * Math.max(1e-9, p.hearW));
    f[10] = 1 / (XY_SCALE * HEAT_SCALE * dt * Math.max(1e-9, p.hearJ));
    f[11] = 0;
    // the pipette's touch: while it lasts, cells under it find the poke's flavour in their inboxes (as `pokeHear` x hearJ per s: heard well)
    const K = this.pokeNow, tNow = this.timeNow || 0;
    if (K && tNow <= K.until) {
      f[12] = K.x; f[13] = K.y; f[14] = K.r; f[15] = p.pokeHear * p.hearJ * XY_SCALE * HEAT_SCALE * dt;
      f[16] = Math.cos(K.flavour); f[17] = Math.sin(K.flavour);
    } else {
      f[14] = 0; f[15] = 0;
      if (K && tNow > K.until) this.pokeNow = null;
    }
    this.device.queue.writeBuffer(this.qBuf, 0, this.qAB, 0, SQ_BYTES);
  }
  /** The eat pass's words (struct EatP q1[2], from word o), dt the tick: the release, the junctions, the taste, the flash. */
  writeEat(u, f, o, dt) {
    const H = this.heat, p = this.params, on = this.on && this.active && H && H.buffer;
    const a = H ? H.px / H.R : 0.5, per = Math.max(0, Number(p.power) || 0) * HEAT_SCALE * dt;
    u[o] = on ? Q1.ON | (p.junction ? Q1.JUNC : 0) | (p.taste && !p.null ? Q1.TASTE : 0) | (p.null ? Q1.NULL : 0) : 0;
    f[o + 1] = per; u[o + 2] = on ? this.base() : 0; u[o + 3] = on ? this.inbox : 0;
    u[o + 4] = on ? H.n : 0;
    f[o + 5] = 0.1 * Math.max(1e-9, p.hearW) * XY_SCALE * HEAT_SCALE * a * a;   // the taste's floor (tuned counts)
    f[o + 6] = Math.exp(-dt / FLASH_TAU); f[o + 7] = FLASH_GAIN;
  }

  // ---------------------------------------------------------------- the census
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!this.on || !(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('signals census:', e); });
  }
  /** The census now (a fresh read-back; console and experiment evals). */
  now() { return this.read(window.moire && window.moire.time ? window.moire.time() : this.lastAt); }

  /**
   * Read the genomes and cells back: EMITTERS (release gene x the outputs' factors, as expressed now, above 2 % of gene 1), LISTENERS (the
   * network reads a heard sense: a cached link from source 25 or 26), WIRED RELAYS (an emitter whose release output's regulator hears, or
   * reads a regulator that hears), fast regulators, what is heard, who fires now, the FLAVOURS per founder line, and a crude WAVE detector:
   * pairs of near cells (within 3 R) that began to fire within the last `waveWindow` s, apart in time by 0.03 s or more: their distance /
   * onset gap is a pulse speed (median, R/s).
   */
  async read(time = 0) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count, B = BIO_FLOATS, CF = CELL_FLOATS, R = C.R;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * B * 4), readBuffer(d, C.cellBuf, 0, n * CF * 4)]);
      const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
      const acts = !!(C.grn && C.grn.acts);
      const fac = (b, k) => {
        if (!acts) return 1;
        const gain = g[b + B_SO + 2 * k] || 0, r = Math.max(0, Math.min(7, Math.round(g[b + B_SO + 2 * k + 1] || 0)));
        const x = Math.max(0, Math.min(1, g[b + B_GX + r] || 0));
        return Math.min(Math.exp(Math.max(-8, Math.min(8, gain)) * x), 4);
      };
      const hears = (b, r) => {   // regulator r reads a heard sense (a cached link)
        const cw = Math.max(0, Math.round(g[b + B_GI + r] || 0));
        for (let k = 0; k < 3; k++) { const q = (cw >> (5 * k)) & 31; if ((q === SRC_W || q === SRC_J) && Math.abs(g[b + B_GW + 3 * r + k] || 0) >= 0.5) return true; }
        return false;
      };
      const feeds = (b, r) => {   // regulator r reads a regulator that hears
        const cw = Math.max(0, Math.round(g[b + B_GI + r] || 0));
        for (let k = 0; k < 3; k++) { const q = (cw >> (5 * k)) & 31; if (q >= 1 && q <= 8 && Math.abs(g[b + B_GW + 3 * r + k] || 0) >= 0.5 && hears(b, q - 1)) return true; }
        return false;
      };
      let N = 0, carriers = 0, emit = 0, emitW = 0, emitJ = 0, listen = 0, relay = 0, fastC = 0, fastB = 0, firing = 0, hearW = 0, hearJ = 0, junc = 0;
      let sRel = 0, sJs = 0, sTaste = 0, sTasteA = 0, sWidth = 0;
      const lines = new Map(), bins = new Array(12).fill(0), recent = [];
      const tnow = time, win = this.params.waveWindow;
      for (let i = 0; i < n; i++) {
        const o = i * CF;
        if (!(u[o + C_FLAGS] & 1)) continue;
        N++;
        const b = i * B, rel = Math.max(0, Math.min(1, g[b + B_SG + 3] || 0)), js = Math.max(0, Math.min(1, g[b + B_SH] || 0));
        sRel += rel; sJs += js; sTaste += g[b + B_SH + 1] || 0; sTasteA += Math.abs(g[b + B_SH + 1] || 0); sWidth += g[b + B_SG + 2] || 0;
        if (rel > 0.02) carriers++;
        const gw0 = g[b + B_SO] || 0, gj0 = g[b + B_SO + 2] || 0;
        const eW = rel * (1 - js) * fac(b, 0), eJ = rel * js * fac(b, 1);
        const a0 = g[b + B_SG] || 0, a = ((a0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (eW + eJ > 0.02) { emit++; if (eW >= eJ) emitW++; else emitJ++; bins[Math.min(11, Math.floor(a / (Math.PI / 6)))]++; }
        let lis = false;
        for (let r = 0; r < 8; r++) if (hears(b, r)) lis = true;
        if (lis) listen++;
        // a WIRED RELAY: it can release (the gene), and a release output that carries part of it is driven by a regulator that hears (or reads
        // one that hears): the wiring, whether it fires now or not
        if (rel > 0.02 && lis && acts) {
          const rw = Math.round(g[b + B_SO + 1] || 0), rj = Math.round(g[b + B_SO + 3] || 0);
          const wired = (gw0 && js < 0.95 && (hears(b, rw) || feeds(b, rw))) || (gj0 && js > 0.05 && (hears(b, rj) || feeds(b, rj)));
          if (wired) relay++;
        }
        const fm = Math.round(g[b + B_SH + 2] || 0) & 255;
        if (fm) { fastC++; for (let r = 0; r < 8; r++) if ((fm >> r) & 1) fastB++; }
        hearW += g[b + B_SS] || 0; hearJ += g[b + B_SS + 1] || 0;
        if (((u[o + C_MOTW] >>> 24) & 255) / 255 > 0.5) firing++;
        const w = u[o + C_KIND];
        if (((w >>> 8) & ~w) & 63) junc++;
        const on = g[b + B_SS + 3] || 0;
        if (on > 0 && tnow - on <= win && tnow - on >= 0) recent.push([f[o], f[o + 1], on]);
        const id = Math.round(g[b + B_FOUNDER] || 0);
        if (!lines.has(id)) lines.set(id, { n: 0, cx: 0, cy: 0, emit: 0 });
        const L = lines.get(id);
        L.n++; L.cx += Math.cos(a); L.cy += Math.sin(a); if (eW + eJ > 0.02) L.emit++;
      }
      // the waves: onset gaps between near cells
      const cs = 3 * R, grid = new Map(), key = (x, y) => `${Math.floor(x / cs)},${Math.floor(y / cs)}`;
      recent.forEach((c, k) => { const kk = key(c[0], c[1]); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k); });
      const speeds = [];
      recent.forEach((c, k) => {
        const gx = Math.floor(c[0] / cs), gy = Math.floor(c[1] / cs);
        for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) {
          const L = grid.get(`${gx + a},${gy + b2}`);
          if (!L) continue;
          for (const j of L) {
            if (j <= k) continue;
            const e = recent[j], dd = Math.hypot(e[0] - c[0], e[1] - c[1]), dt = Math.abs(e[2] - c[2]);
            if (dd <= cs && dd > 0.5 * R && dt >= 0.03) speeds.push(dd / R / dt);
          }
        }
      });
      speeds.sort((x, y) => x - y);
      const top = [...lines.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 4).map(([id, L]) => ({
        line: id, n: L.n, emit: L.emit, flavour: deg(Math.atan2(L.cy, L.cx)), spread: L.n ? 1 - Math.hypot(L.cx, L.cy) / L.n : 0 }));
      const out = {
        time, n: N, carriers, emitters: emit, toWater: emitW, toJunctions: emitJ, listeners: listen, relays: relay, fast: fastC,
        fastBits: fastC ? fastB / fastC : 0, firing, junctionCells: junc,
        heard: { water: N ? hearW / N : 0, junctions: N ? hearJ / N : 0 },
        genes: { release: N ? sRel / N : 0, junction: N ? sJs / N : 0, taste: N ? sTaste / N : 0, tasteAbs: N ? sTasteA / N : 0, width: N ? sWidth / N : 0 },
        flavours: bins.filter((x) => emit && x >= 0.05 * emit).length, lines: top,
        wave: { onsets: recent.length, pairs: speeds.length, speed: speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0,
          p90: speeds.length ? speeds[Math.floor(0.9 * (speeds.length - 1))] : 0 },
      };
      this.census = out;
      return out;
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- the pipette
  /**
   * The PIPETTE (the toy's 'signal' tool, a scientist's hand): a puff into the water at (x, y) (dish px) and a TOUCH of the cells under it for
   * `pokeTime` s (they find the flavour in their inboxes, heard as through junctions: a micro-injection; no energy). f the flavour (rad).
   */
  drop(x, y, f = this.params.puffFlavour) {
    if (!this.on) return false;
    const R = this.cells.R || 6, p = this.params;
    this.puff(x, y, f);
    this.pokeNow = { x, y, r: p.puffRadius * R, flavour: Number(f) || 0, until: (this.timeNow || 0) + p.pokeTime };
    return true;
  }
  /** A puff of signal at (x, y) (dish px): energy e (booked as energy in), flavour f (rad), radius r (R). Returns false when off. */
  puff(x, y, f = this.params.puffFlavour, e = this.params.puffAmount, r = this.params.puffRadius) {
    if (!this.on) return false;
    if (this.puffs.length < 32) this.puffs.push({ x, y, flavour: Number(f) || 0, e: Math.max(0, Number(e) || 0), r: Math.max(0.5, Number(r) || 1) });
    return true;
  }

  // ---------------------------------------------------------------- words for the panel
  panelLine(compact = false) {
    if (!this.on) return 'SIGNALS off';
    const L = this.ledger, c = this.census;
    const lr = L ? `in water ${fmt(L.dish)} · made ${fmt(L.rate.made)}/s · via junctions ${fmt(L.rate.junc)}/s · faded ${fmt(L.rate.decay)}/s` : '…';
    const cz = c ? `emitters ${c.emitters} (water ${c.toWater}, junctions ${c.toJunctions}) · listeners ${c.listeners} · relays ${c.relays} · fast ${c.fast}` +
      ` · firing ${c.firing} · flavours ${c.flavours}${c.wave.pairs >= 3 ? ` · pulses ${c.wave.speed.toFixed(1)} R/s (${c.wave.pairs})` : ''}` : '…';
    if (compact) return `SIGNALS ${c ? `emit ${c.emitters} · relays ${c.relays} · firing ${c.firing}` : '…'}`;
    return `SIGNALS  ${cz} · ${lr}${this.params.null ? ' · NULL' : ''}`;
  }
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    return [`signal substance (step Q1) ${on(p.on)}: spread ${p.spread} R²/s (${this.nSub} substeps of k ${this.k.toFixed(3)}), life ${p.life} s, carried by the water ${on(p.flow)},` +
      ` power ${p.power}/s, hear ${p.hearW}/R² (water) ${p.hearJ}/s (junctions), junctions ${on(p.junction)}, taste ${on(p.taste)}, fast regulators ${on(p.fast)} (${p.tauFast} s)` +
      `${p.null ? ' · NEUTRAL CONTROL' : ''}`];
  }
}
