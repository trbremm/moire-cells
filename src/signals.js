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

export const XY_SCALE = 16;            // flavour vector counts per heat count of energy (signal.wgsl, cell_eat.wgsl, cell_grn.wgsl)
export const SIG_BLOCKS_GRID = 6;      // two copies of A, X, Y
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
      hearJ: 1e-3,        // heard through junctions: energy per s at which the sense is 1 - 1/e (?hearj=)
      junction: true,     // release through formed junctions (?junction=0: the junction share is not released at all)
      taste: true,        // the taste dial steers (with step P3's taste on) (?sigtaste=0)
      fast: true,         // fast regulators act (?fastreg=0: every regulator at step T1b's tau)
      tauFast: 0.3,       // s (?taufast=)
      null: false,        // the NEUTRAL control (?signalnull=1): heard at a random place, the taste does not steer
      mutate: true,       // the genes mutate at births (?sigmut=0)
      censusEvery: 5,     // s of simulated time between the census's read-backs (0: never) (?sigcensus=)
      puffAmount: 0.4,    // the pipette: energy per puff (booked as energy in)
      puffRadius: 2.5,    // ... its radius (R)
      puffFlavour: 0,     // ... its flavour (rad)
    };
    this.look = { haze: 1, ref: 2e-4 };
    this.tot = { decay: 0, puff: 0, made: 0, junc: 0 };
    this.ledger = null;
    this.hist = [];
    this.puffs = [];
    this.nSub = 2; this.k = 0;
    this.census = null;
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
    if (!this.on || !H || !H.buffer || !this.pipes) return;
    const p = this.params, dt = frame.tickDt, a = H.px / H.R;
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

  // ---------------------------------------------------------------- the pipette
  /** A puff of signal at (x, y) (dish px): energy e (booked as energy in), flavour f (rad), radius r (R). Returns false when off. */
  puff(x, y, f = this.params.puffFlavour, e = this.params.puffAmount, r = this.params.puffRadius) {
    if (!this.on) return false;
    if (this.puffs.length < 32) this.puffs.push({ x, y, flavour: Number(f) || 0, e: Math.max(0, Number(e) || 0), r: Math.max(0.5, Number(r) || 1) });
    return true;
  }

  // ---------------------------------------------------------------- words for the panel
  panelLine(compact = false) {
    if (!this.on) return 'SIGNALS off';
    const L = this.ledger;
    const lr = L ? `in water ${fmt(L.dish)} · made ${fmt(L.rate.made)}/s · via junctions ${fmt(L.rate.junc)}/s · faded ${fmt(L.rate.decay)}/s` : '…';
    return compact ? `SIGNALS ${L ? fmt(L.dish) : '…'}` : `SIGNALS  ${lr}${this.params.null ? ' · NULL' : ''}`;
  }
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    return [`signal substance (step Q1) ${on(p.on)}: spread ${p.spread} R²/s (${this.nSub} substeps of k ${this.k.toFixed(3)}), life ${p.life} s, carried by the water ${on(p.flow)},` +
      ` power ${p.power}/s, hear ${p.hearW}/R² (water) ${p.hearJ}/s (junctions), junctions ${on(p.junction)}, taste ${on(p.taste)}, fast regulators ${on(p.fast)} (${p.tauFast} s)` +
      `${p.null ? ' · NEUTRAL CONTROL' : ''}`];
  }
}
