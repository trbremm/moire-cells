// Step T2, TENDRILS AND BONE (BUILD QUEUE 6a6e, the user 2026-11-24 after the L1 organ: "Tendrils, and possibly a simple skeleton tissue?
// With tendons"; README "Step T2"). Two general capabilities any cell could evolve (founders 0, each with a neutral control), never a rule
// naming a behaviour; "tendon", "bone", "ligament" are only the names of lab designs (src/tissues.js, src/organ.js):
//
//   TENDRILS   a cell grows up to four thin filaments from its outline (Bio.tn: REACH, COUNT, PLACEMENT round the front, SPREAD; the gene
//              network's 24th output GROW scales the reach). They are built of CHAIN CARBON (the eat pass's tendril pool, the C15 recipe of the
//              enzymes' frame, the battery paying the sparks; units per R x e^stiffness) and cost an upkeep per R. The TIP GRIPS the first thing
//              it meets: another cell's outline, an obstacle, the dish's edge, or (full length, by the FLOOR GRIP gene's chance) the floor; then
//              the tendril is a ROPE: tension only, stiffness k0 e^STIFFNESS (Bio.tk.x: thickness, so also carbon per R and strength), equal and
//              opposite on both cells, and it BREAKS above brk e^stiffness R/s (lets go, regrows). RETRACTION (Bio.tk.y x the 25th output)
//              pulls the rest length in (pili twitching: the cell is dragged to its anchor; fully in, it lets go and sprouts again), paid per s
//              from the battery. src/shaders/tendril.wgsl (after the step: tforce, tapply), cell_carbon.wgsl cb_tendrils, the eat pass's upkeep
//   BONE       the MINERALISE gene (Bio.tk.w x the 26th output) lets the cell's wall take rust Gt (the most settled compound, C12d) out of its
//              stock into a MINERAL WALL (stock word 31), slowly (a share of the shortfall per s) and at a cost per molecule (battery, as heat);
//              its HARDNESS (held / a full wall for its size) takes its sides' stiffness toward a full crust wall's, multiplies its junctions'
//              glue and damps its outline's wobble (held). Bursts and deaths spill the rust back exactly; daughters take their share
//
// Switches: ?tendrils=0 (off: as before T2), ?tendrilnull=1 (genes drift, nothing grows, nothing paid), ?mineral=0, ?mineralnull=1, ?t2grn=0
// (the outputs do not act); knobs on moire.tendrils.params (URL: ?tgrow= ?tk= ?tbreak= ?tretract= ?tfloor= ?ttorque= ?tcarbon= ?tupkeep=
// ?tretcost= ?minfull= ?minrate= ?mincost= ?minglue= ?minstiff=). Census every 5 s: the TENDRILS panel line; moire.tendrils.now().

import { loadFieldShader } from './field.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS, BIO_T2 } from './genome.js';
import { HEAT_SCALE } from './heat.js';
import { CARBON, ENZ_H, LG_CB, LG_CBC } from './carbon.js';
import { CW as CB_W } from './carboncells.js';
import { CH, lgM } from './matter.js';
import { readBuffer, settle, flushLedger, frames } from './snapshot.js';

export const TW = 40;                 // tendril words a cell (tendril.wgsl TW)
const TC_WORDS = 8;                   // the counters behind the cells' words
const TC = ['gripCell', 'gripWall', 'gripFloor', 'breaks', 'letGo', 'sprouts'];
const BITS = { TEN: 1024, TNULL: 2048, MIN: 4096, MNULL: 8192, TGRN: 16384 };   // Sim.shapeF (cell_common.wgsl SH_TEN ...)
const TPF = { ON: 1, POOL: 2, OBS: 4, EDGE: 8, MIN: 16 };
const TP_BYTES = 64, TD_BYTES = 224;
const SIM_BYTES = 256;
const ATOM_SCALE = 4096;
const C_FLAGS = 9, C_R = 4, C_BAT = 16;
const W_MIN = 31, SW_DEF = 64;
const CB_TEND = 23;
const B_FOUNDER = 7;

/** The tendril genes as numbers (Bio words from BIO_T2): reach, count, placement, spread, stiffness, retraction, floor grip, mineralise. */
export function tendrilGenes(g, o = 0) {
  const b = o + BIO_T2;
  return { reach: g[b] || 0, count: g[b + 1] || 0, place: g[b + 2] || 0, spread: g[b + 3] || 0, stiff: g[b + 4] || 0, retract: g[b + 5] || 0,
    floor: g[b + 6] || 0, mineral: g[b + 7] || 0, grow: [g[b + 8] || 0, g[b + 9] || 0], ret: [g[b + 10] || 0, g[b + 11] || 0], min: [g[b + 12] || 0, g[b + 13] || 0] };
}
/** Set a genome's tendril and mineral genes (a design's hand): any of reach, count (1..4 tendrils), place (rad from the front), spread,
 * stiff, retract, floor, mineral. */
export function setTendrils(g, t = {}, o = 0) {
  const b = o + BIO_T2;
  if (t.reach != null) g[b] = t.reach;
  if (t.count != null) g[b + 1] = Math.max(0, Math.min(1, (t.count - 1) / 3));
  if (t.place != null) g[b + 2] = t.place;
  if (t.spread != null) g[b + 3] = t.spread;
  if (t.stiff != null) g[b + 4] = t.stiff;
  if (t.retract != null) g[b + 5] = t.retract;
  if (t.floor != null) g[b + 6] = t.floor;
  if (t.mineral != null) g[b + 7] = t.mineral;
  if (t.grow) { g[b + 8] = t.grow[0]; g[b + 9] = t.grow[1]; }
  if (t.ret) { g[b + 10] = t.ret[0]; g[b + 11] = t.ret[1]; }
  if (t.min) { g[b + 12] = t.min[0]; g[b + 13] = t.min[1]; }
  return g;
}

export class Tendrils {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.tendrils.params)
    this.params = {
      on: true,          // tendrils act (?tendrils=0: as before T2; the genes carried, never mutating)
      null: false,       // their NEUTRAL control (?tendrilnull=1): the genes drift, nothing grows, nothing is paid
      mineral: true,     // mineralising acts (?mineral=0)
      mineralNull: false,   // its NEUTRAL control (?mineralnull=1)
      grn: true,         // the gene network's 24th..26th outputs act (?t2grn=0: the genes alone)
      grow: 1.2,         // R / s a free tip grows (?tgrow=)
      k: 6,              // the rope's stiffness at gene 0 (1 / s; the contact push is 7) (?tk=)
      brk: 3,            // the pull it breaks at, gene 0 (R / s; x e^stiffness) (?tbreak=)
      retract: 1.5,      // R / s a rope's rest length is pulled in at drive 1 (?tretract=)
      minRest: 0.15,     // R: fully retracted, a rope lets go (?tminrest=)
      floorRate: 1.5,    // per s at the floor grip gene 1 (?tfloor=)
      torque: 1,         // a rope's off-centre pull turns its cells (1 = derived, as the glue's) (?ttorque=)
      maxStep: 0.3,      // R: the most a cell is moved by its ropes in a tick (?tmaxstep=)
      wander: 0.3,       // rad: a new sprout's angle wanders this far either way (?twander=)
      hold: 0.8,         // s a rope holds at least before, fully retracted, it lets go (?thold=)
      edge: true,        // a tip grips the dish's edge (?tedge=0)
      walls: true,       // ... and obstacles (?twalls=0)
      carbon: 0.004,     // carbon units per R of tendril at stiffness 0 (the C15 recipe's chain carbon; x e^stiffness) (?tcarbon=; 0: free)
      upkeep: 0.0006,    // energy per s per R wanted (x e^stiffness) (?tupkeep=)
      retCost: 0.004,    // energy per s per tendril at retraction drive 1 (?tretcost=)
      minFull: 0.5,      // a full mineral wall: rust Gt units per R^2 of the cell's area (?minfull=)
      minRate: 0.03,     // share of the shortfall built per s (slow) (?minrate=)
      minCost: 0.4,      // energy per unit of rust built in (costly) (?mincost=)
      minDissolve: 0.01, // share of an excess dissolved back per s (?mindis=)
      minGlue: 1,        // the junctions' glue x (1 + this x hardness) (?minglue=)
      minStiff: 1,       // how far the hardness takes the sides' stiffness toward a full crust wall's (?minstiff=)
      minDamp: 0.3,      // the outline's wobble damped by this share a tick at hardness 1 (?mindamp=)
      censusEvery: 5,    // s of simulated time between the census's read-backs (0: never) (?tcensus=)
    };
    this.look = { on: true, segs: 8, tube: 0.9, bright: 0.9, dot: 2.2, boneBright: 0.55, fullT: 3, boneInk: [255, 238, 210], spacing: 0.2 };
    this.census = null;
    this.busy = false;
    this.lastAt = -1e9;
    this.prevCounters = null;
    this.rates = null;
  }

  get tendOn() { return !!this.params.on; }
  get minOn() { return !!this.params.mineral; }
  /** Whether the passes run (tendrils or mineralising, or a null: their genes drift). */
  get active() { const p = this.params; return !!(p.on || p.null || p.mineral || p.mineralNull); }

  /** The bits ORed into Sim.shapeF (word 28). */
  bits() {
    const p = this.params, acts = !!(this.cells.grn && this.cells.grn.acts);
    return (p.on ? (p.null ? BITS.TNULL : BITS.TEN) : 0) | (p.mineral ? (p.mineralNull ? BITS.MNULL : BITS.MIN) : 0) |
      ((p.on || p.mineral) && p.grn && acts ? BITS.TGRN : 0);
  }
  writeSim(u, o) { u[o + 28] |= this.bits(); }

  /** The eat pass's words (EatP.t2, 12 from o): the tendrils' carbon and upkeep, the mineral wall. */
  writeEat(u, f, o, dt) {
    const p = this.params, ten = p.on && !p.null, min = p.mineral && !p.mineralNull, tick = Math.max(1e-4, dt);
    u.fill(0, o, o + 12);
    f[o] = ten && CARBON ? Math.max(0, p.carbon) * ATOM_SCALE / 4 : 0;              // (pool units per R: 4 carbons a unit)
    f[o + 1] = ten ? Math.max(0, p.upkeep) * HEAT_SCALE * tick : 0;
    f[o + 2] = ten ? Math.max(0, p.retCost) * HEAT_SCALE * tick : 0;
    u[o + 3] = min ? 1 : 0;
    f[o + 4] = Math.max(0, p.minFull) * ATOM_SCALE;
    f[o + 5] = Math.min(1, Math.max(0, p.minRate) * tick);
    f[o + 6] = Math.max(0, p.minCost) * HEAT_SCALE / ATOM_SCALE;
    f[o + 7] = Math.max(0, p.minGlue);
    f[o + 8] = Math.max(0, Math.min(1, p.minStiff));
    f[o + 9] = Math.min(1, Math.max(0, p.minDissolve) * tick);
  }

  // ---------------------------------------------------------------- the GPU side
  async init(device, format, pre) {
    const d = device, C = this.cells, n = C.count;
    this.device = d;
    const [mod, dmod] = await Promise.all([loadFieldShader(d, 'src/shaders/tendril.wgsl', pre), loadFieldShader(d, 'src/shaders/tendril_draw.wgsl', pre)]);
    const U = GPUBufferUsage, S = GPUShaderStage.COMPUTE;
    this.buf = d.createBuffer({ label: 'tendrils', size: (n * TW + TC_WORDS) * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.ubuf = d.createBuffer({ label: 'tendril params', size: TP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.uAB = new ArrayBuffer(TP_BYTES);
    const ro = (binding) => ({ binding, visibility: S, buffer: { type: 'read-only-storage' } });
    const rw = (binding) => ({ binding, visibility: S, buffer: { type: 'storage' } });
    const un = (binding) => ({ binding, visibility: S, buffer: { type: 'uniform' } });
    this.bgl = d.createBindGroupLayout({ label: 'tendrils', entries: [
      { binding: 0, visibility: S, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SIM_BYTES } },
      rw(1), ro(2), rw(3), ro(4), ro(5), ro(6), ro(7), ro(8), un(9), un(10)] });
    const pl = d.createPipelineLayout({ label: 'tendrils', bindGroupLayouts: [this.bgl] });
    this.pForce = d.createComputePipeline({ label: 'tendril force', layout: pl, compute: { module: mod, entryPoint: 'tforce' } });
    this.pApply = d.createComputePipeline({ label: 'tendril apply', layout: pl, compute: { module: mod, entryPoint: 'tapply' } });
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.dPipe = d.createRenderPipeline({
      label: 'tendrils draw', layout: 'auto',
      vertex: { module: dmod, entryPoint: 'vs' },
      fragment: { module: dmod, entryPoint: 'fs', targets: [{ format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.bPipe = d.createRenderPipeline({
      label: 'bone draw', layout: 'auto',
      vertex: { module: dmod, entryPoint: 'vsb' },
      fragment: { module: dmod, entryPoint: 'fsb', targets: [{ format, blend: { color: add, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.dBuf = d.createBuffer({ label: 'tendrils draw params', size: TD_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.dAB = new ArrayBuffer(TD_BYTES);
    this.bgs = null;
    this.dbgs = null;
  }

  /** The compute bind groups (one per genome copy), remade when a buffer they hold was replaced (grid, heat). */
  bind() {
    const C = this.cells, d = this.device, H = C.heat, E = C.eat;
    const key = [C.cellBuf, C.startsBuf, C.sortIdxBuf, H.buffer, E.stockBuf, E.carbon && E.carbon.buf, C.bioBuf[0]];
    if (this.bgs && this.bgKey && key.every((x, k) => x === this.bgKey[k])) return;
    this.bgKey = key;
    const b = (binding, buffer, size) => ({ binding, resource: size ? { buffer, size } : { buffer } });
    this.bgs = [0, 1].map((k) => d.createBindGroup({
      label: 'tendrils', layout: this.bgl,
      entries: [b(0, C.simBuf, SIM_BYTES), b(1, C.cellBuf), b(2, C.bioBuf[k]), b(3, this.buf), b(4, C.startsBuf), b(5, C.sortIdxBuf),
        b(6, H.buffer), b(7, E.carbon.buf), b(8, E.stockBuf), b(9, this.ubuf), b(10, H.paramBuf)],
    }));
  }

  /** Once a frame, before the ticks: the uniform. */
  writeUniform() {
    const p = this.params, C = this.cells, f = new Float32Array(this.uAB), u = new Uint32Array(this.uAB);
    f[0] = Math.max(0, p.grow); f[1] = Math.max(0, p.k); f[2] = Math.max(1e-3, p.brk); f[3] = Math.max(0, p.retract);
    f[4] = Math.max(0.01, p.minRest); f[5] = Math.max(0, p.floorRate); f[6] = Math.max(0, p.torque); f[7] = Math.max(0.01, p.maxStep);
    f[8] = CARBON ? Math.max(0, p.carbon) * ATOM_SCALE / 4 : 0; f[9] = Math.max(0, Math.min(1, p.minDamp)); f[10] = Math.max(0, p.minFull) * ATOM_SCALE;
    f[11] = Math.max(0, p.wander);
    let obsOff = 0;
    const O = C.obstacles;
    if (O && p.walls) { const t = new Uint32Array(4); O.writeFields(t, new Float32Array(t.buffer), 0); obsOff = t[0] ? t[1] : 0; }
    const ten = p.on && !p.null, min = p.mineral && !p.mineralNull;
    u[12] = (ten ? TPF.ON : 0) | (ten && CARBON && p.carbon > 0 ? TPF.POOL : 0) | (obsOff ? TPF.OBS : 0) | (p.edge ? TPF.EDGE : 0) | (min ? TPF.MIN : 0);
    u[13] = obsOff; u[14] = C.count * TW; f[15] = Math.max(0, p.hold);
    this.device.queue.writeBuffer(this.ubuf, 0, this.uAB);
  }

  /** Record the tick in Sim slot t (after the cells' step: bioCur names this tick's genome copy). */
  encodeTick(encoder, t, slot) {
    if (!this.pForce || !this.active) return;
    const p = this.params;
    if (!(p.on && !p.null) && !(p.mineral && !p.mineralNull)) return;   // (the nulls: only the genes drift, in the gene network's pass)
    this.bind();
    if (t === 0) this.writeUniform();
    const C = this.cells, pass = encoder.beginComputePass({ label: 'tendrils' });
    pass.setBindGroup(0, this.bgs[C.bioCur], [t * slot]);
    const wg = Math.ceil(C.count / 64);
    pass.setPipeline(this.pForce); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pApply); pass.dispatchWorkgroups(wg);
    pass.end();
  }

  // ---------------------------------------------------------------- the drawing
  bindDraw() {
    const C = this.cells, d = this.device;
    if (this.dbgs && this.dKey === C.cellBuf && this.dBio === C.bioBuf[0]) return;
    this.dKey = C.cellBuf; this.dBio = C.bioBuf[0];
    const mk = (pipe, withBio) => C.bioBuf.map((bio) => d.createBindGroup({
      label: 'tendrils draw', layout: pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.dBuf } }, { binding: 1, resource: { buffer: C.cellBuf } },
        ...(withBio ? [{ binding: 2, resource: { buffer: bio } }] : []), { binding: 3, resource: { buffer: this.buf } }],
    }));
    this.dbgs = mk(this.dPipe, true);
    this.bbgs = mk(this.bPipe, false);   // (the bone's lamellae read no genome: its automatic layout has no binding 2)
  }
  writeDraw({ view, cam, zoom, neon, harmonic, time, palette }) {
    const L = this.look, C = this.cells, a = new Float32Array(this.dAB);
    a[0] = view.cssW / zoom; a[1] = view.cssH / zoom; a[2] = view.dpr * zoom; a[3] = C.R;
    a[4] = cam[0]; a[5] = cam[1]; a[6] = cam[2] || zoom; a[7] = 0;
    a[8] = harmonic ? 2 : neon ? 1 : 0; a[9] = time % 3600; a[10] = Math.max(0.2, L.tube) / Math.sqrt(Math.max(1, zoom)); a[11] = L.bright;
    a[12] = Math.max(2, Math.min(16, Math.round(L.segs))); a[13] = L.dot; a[14] = L.boneBright; a[15] = Math.max(0.1, L.fullT);
    const or = palette && palette.harm ? palette.harm.orange : [255, 128, 22];
    a[16] = or[0] / 255; a[17] = or[1] / 255; a[18] = or[2] / 255; a[19] = 0.6;
    a[20] = L.boneInk[0] / 255; a[21] = L.boneInk[1] / 255; a[22] = L.boneInk[2] / 255; a[23] = L.spacing;
    const job = palette && palette.job ? palette.job : [];
    job.forEach((ink, j) => { for (let k = 0; k < 3; k++) a[24 + 4 * j + k] = ink[k] / 255; });
    this.device.queue.writeBuffer(this.dBuf, 0, this.dAB);
  }
  /** The tendrils, into the cells' pass before the cells (a body covers a tendril's root). */
  render(pass, opts) {
    if (!this.dPipe || !this.look.on || !(this.params.on && !this.params.null)) return;
    this.bindDraw();
    this.writeDraw(opts);
    const NS = Math.max(2, Math.min(16, Math.round(this.look.segs)));
    pass.setPipeline(this.dPipe);
    pass.setBindGroup(0, this.dbgs[this.cells.bioCur]);
    pass.draw(4 * (NS * 6 + 6), this.cells.count);
  }
  /** The bone's lamellae, after the cells. */
  renderOver(pass) {
    if (!this.bPipe || !this.look.on || !(this.params.mineral && !this.params.mineralNull)) return;
    this.bindDraw();
    pass.setPipeline(this.bPipe);
    pass.setBindGroup(0, this.bbgs[this.cells.bioCur]);
    pass.draw(6, this.cells.count);
  }

  // ---------------------------------------------------------------- a scientist's hand: provision designed cells
  /**
   * PROVISION (the lab's hand, as the add-cell tool gives a placed cell its body): every live cell whose founder id is in `ids` (all with
   * tendril or mineral genes when null) gets its tendril pool (the carbon its genes want now) and its mineral wall (rust Gt), booked IN
   * (carbon: the dish's ADD and the cells' IN per tar hand; rust: matter ADD). Returns { cells, carbon, rust }.
   */
  async provision(ids = null, { tendrils = true, mineral = true } = {}) {
    const M = window.moire, C = this.cells, E = C.eat, d = this.device, ctl = M.control, n = C.count, p = this.params;
    const was = ctl.paused();
    try {
      await settle(M, ctl, true);
      const SW = E.stockBuf.size / 4 / n;
      const [cellAB, bioAB, stockAB, cbAB] = await Promise.all([readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4), readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, E.stockBuf, 0, n * SW * 4), CARBON ? readBuffer(d, E.carbon.buf, 0, n * CB_W * 4) : null]);
      const cf = new Float32Array(cellAB), cu = new Uint32Array(cellAB), g = new Float32Array(bioAB), st = new Int32Array(stockAB);
      const cb = cbAB ? new Int32Array(cbAB) : null;
      let nc = 0, units = 0, rust = 0;
      for (let i = 0; i < n; i++) {
        if (!(cu[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
        const o = i * BIO_FLOATS;
        if (ids && !ids.includes(Math.round(g[o + B_FOUNDER]))) continue;
        const t = tendrilGenes(g, o), area = Math.PI * (cf[i * CELL_FLOATS + C_R] / C.R) ** 2;
        let did = false;
        if (tendrils && cb && p.on && !p.null && t.reach > 0.05) {
          const cnt = 1 + Math.round(3 * Math.max(0, Math.min(1, t.count)));
          const want = Math.ceil(p.carbon * ATOM_SCALE / 4 * Math.exp(Math.max(-2, Math.min(2, t.stiff))) * cnt * Math.min(2.5, t.reach));
          const have = cb[i * CB_W + CB_TEND];
          if (want > have) { cb[i * CB_W + CB_TEND] = want; units += want - have; did = true; }
        }
        if (mineral && p.mineral && !p.mineralNull && t.mineral > 0.02) {
          const want = Math.round(p.minFull * ATOM_SCALE * area * Math.min(1, t.mineral));
          const have = st[i * SW + W_MIN];
          if (want > have) { st[i * SW + W_MIN] = want; rust += want - have; did = true; }
        }
        if (did) nc++;
      }
      if (units && cb) d.queue.writeBuffer(E.carbon.buf, 0, cb);
      if (rust) d.queue.writeBuffer(E.stockBuf, 0, st);
      // the books: carbon in (per tar hand, the enzymes' frame), rust in (matter ADD of Gt)
      const words = [];
      if (units) for (let w = 0; w < 3; w++) { const x = ENZ_H[w] * units; if (x) { words.push([LG_CB + 128 * (5 + w), x], [LG_CBC.IN + 128 * (5 + w), x]); } }
      if (rust) words.push([lgM('ADD', CH.Gt), rust]);
      for (const [w, x] of words) await bookAdd(d, C.heat.buffer, w, x);
      flushLedger(M, ctl.time());
      await d.queue.onSubmittedWorkDone();
      await frames(1);
      return { cells: nc, carbon: units * 4 / ATOM_SCALE, rust: rust / ATOM_SCALE };
    } finally { ctl.setPaused(was); }
  }

  // ---------------------------------------------------------------- the census
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!this.active || !(every > 0) || this.busy || !this.buf || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => console.warn('tendrils census:', e));
  }
  now() { return this.read(window.moire && window.moire.time ? window.moire.time() : this.lastAt); }

  async read(time = 0) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = this.device, n = C.count;
      const [tAB, bioAB, cellAB] = await Promise.all([readBuffer(d, this.buf, 0, (n * TW + TC_WORDS) * 4), readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
      const tu = new Uint32Array(tAB), tf = new Float32Array(tAB), ti = new Int32Array(tAB), g = new Float32Array(bioAB), cu = new Uint32Array(cellAB);
      let N = 0, carriers = 0, minCarriers = 0, grow = 0, free = 0, onCell = 0, onWorld = 0, sumT = 0, nT = 0, maxT = 0, len = 0, hard = 0, hardSum = 0, wired = 0;
      let sReach = 0, sMin = 0, sStiff = 0, sRet = 0;
      for (let i = 0; i < n; i++) {
        if (!(cu[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
        N++;
        const t = tendrilGenes(g, i * BIO_FLOATS);
        sReach += t.reach; sMin += t.mineral; sStiff += t.stiff; sRet += t.retract;
        if (t.reach > 0.05) carriers++;
        if (t.mineral > 0.02) minCarriers++;
        if (t.grow[0] !== 0 || t.ret[0] !== 0 || t.min[0] !== 0) wired++;
        const o = i * TW;
        if (tu[o] !== cu[i * CELL_FLOATS + 10]) continue;
        const h = tu[o + 1] / 65535;
        hardSum += h;
        if (h > 0.5) hard++;
        let any = false;
        for (let s = 0; s < 4; s++) {
          const so = o + 8 + 8 * s, st = tu[so] & 3;
          if (!st) continue;
          any = true;
          len += Math.max(0, tf[so + 5]);
          if (st === 1) free++;
          else {
            if (st === 2) onCell++; else onWorld++;
            const T = tf[so + 7];
            if (T > 0) { sumT += T; nT++; maxT = Math.max(maxT, T); }
          }
        }
        if (any) grow++;
      }
      const cnt = Array.from(ti.subarray(n * TW, n * TW + TC.length));
      let rates = null;
      if (this.prevCounters && time > this.prevCounters.time) {
        const dt = time - this.prevCounters.time;
        rates = Object.fromEntries(TC.map((k, j) => [k, (cnt[j] - this.prevCounters.c[j]) / dt]));
      }
      this.prevCounters = { time, c: cnt };
      if (rates) this.rates = rates;
      const P = this.params;
      this.census = { time, n: N, carriers, growing: grow, free, onCell, onWorld, tension: nT ? sumT / nT : 0, maxTension: maxT, ropes: nT,
        length: len, minCarriers, hard, hardness: N ? hardSum / N : 0, wired, reach: N ? sReach / N : 0, mineral: N ? sMin / N : 0,
        stiff: N ? sStiff / N : 0, retract: N ? sRet / N : 0, counters: Object.fromEntries(TC.map((k, j) => [k, cnt[j]])), rates: this.rates,
        null: P.null, mineralNull: P.mineralNull };
      return this.census;
    } finally {
      this.busy = false;
    }
  }

  panelLine(compact = false) {
    const p = this.params, c = this.census;
    if (!p.on && !p.mineral) return 'TENDRILS off · BONE off';
    if (!c) return 'TENDRILS …';
    const r = c.rates || {}, f1 = (x) => (x == null ? '–' : x.toFixed(2));
    const ten = !p.on ? 'TENDRILS off' : `TENDRILS${p.null ? ' NULL' : ''} ${c.growing} cells grow ${c.free + c.onCell + c.onWorld} (free ${c.free}, on cells ${c.onCell}, held ${c.onWorld})` +
      ` · tension ${c.tension.toFixed(2)} R/s (max ${c.maxTension.toFixed(1)}) · breaks ${f1(r.breaks)}/s, let go ${f1(r.letGo)}/s`;
    const bone = !p.mineral ? 'BONE off' : `BONE${p.mineralNull ? ' NULL' : ''} ${c.hard} hard (mean ${c.hardness.toFixed(2)}), ${c.minCarriers} carry the gene`;
    if (compact) return `${ten.split(' · ')[0]} · ${bone}`;
    return `${ten} · carriers ${c.carriers} (reach ${c.reach.toFixed(2)}) · ${bone}`;
  }
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    return [`tendrils (step T2) ${on(p.on)}${p.null ? ' NULL' : ''}: grow ${p.grow} R/s, rope k ${p.k}/s, breaks at ${p.brk} R/s, retract ${p.retract} R/s, floor ${p.floorRate}/s, carbon ${p.carbon}/R, upkeep ${p.upkeep}/s per R` +
      ` · bone ${on(p.mineral)}${p.mineralNull ? ' NULL' : ''}: full ${p.minFull}/R², ${p.minRate}/s, ${p.minCost} per unit, glue x(1+${p.minGlue} h), stiff ${p.minStiff}`];
  }
}

/** Add x to a 64-bit ledger counter (low word w, carries at w + 64), read-modify-write from the page (the queue must be idle). */
async function bookAdd(d, buf, w, x) {
  const [lo, hi] = await Promise.all([readBuffer(d, buf, w * 4, 4), readBuffer(d, buf, (w + 64) * 4, 4)]);
  const a = new Uint32Array(lo)[0], b = new Uint32Array(hi)[0], sum = a + x;
  d.queue.writeBuffer(buf, w * 4, new Uint32Array([sum >>> 0]));
  d.queue.writeBuffer(buf, (w + 64) * 4, new Uint32Array([(b + Math.floor(sum / 4294967296)) >>> 0]));
}
