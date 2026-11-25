// Step I1, the CELL INSPECTOR (user 2026-11-25, after a "queen" cell in a starving colony: round, a full battery, bright, the colony packed
// in spiral arcs round her; README "Step I1"). A scientist's MAGNIFIER: tap a cell and ask it what it is. READ-ONLY: it changes nothing
// the simulation sees (its own buffers, and counters the eat pass adds to but never reads), so with the tool unused the dish runs as before.
//
//   THE FAMILY TREE  every cell gets a BIRTH ID and its mother's id, on the GPU right after each tick's step (src/shaders/inspect.wgsl:
//                    detect, commit), with how it was born (a division's daughter, the turnover's newborn, or placed: a founder, a hand,
//                    a snapshot) and, when it goes, what is knowable of why (eaten, burst, starved, hot, old age, turnover, replaced). Births
//                    and deaths go into a ring LOG the page reads back a few times a second, so the CPU keeps the whole tree since the
//                    page started (`tree`: mother, birth and death time, cause, slot, daughters as linked lists, by id).
//   ENGINES RAN      the eat pass counts what each engine slot actually ran and the energy it put into or took from the battery
//                    (src/eat.js ranBuf, cell_eat.wgsl ran_add), so the card can tell an engine that runs from one only carried.
//   THE CARD         src/inspectcard.js: the chosen cell's job, battery, body carbon, membrane, shape, age, generation, line and marker
//                    hue, daughters, living descendants, engines (ran vs carried), meals, genes of note, read back every quarter second
//                    (small copies into a ring of staging buffers, never stalling the frame).
//   SHOW FAMILY      the overlay (src/shaders/inspect_draw.wgsl, drawn last over either look): everyone else dimmed, the chosen cell's
//                    living DESCENDANTS ringed (daughters bright gold, deeper generations amber), its mother cyan, its sisters violet.
//   FOLLOW           the camera keeps the chosen cell in view (its position read back every frame, one or two frames old), until it dies.
//
// Console: moire.inspect.at(x, y) (dish px), .cell(slot), .close(), .family(slotOrNothing), .follow(on), .survey() (every living cell's age,
// daughters, living descendants against its battery: who are the colony's mothers), .tree. URL: ?inspect=0 (none of it: no pass, no
// read-backs; the eat pass's counters still count, unread). The family is known from the page's start: a snapshot loaded or a new culture
// starts every cell as a founder.

import { loadFieldShader } from './field.js';
import { HEAT_COMMON_URL } from './heat.js';
import { readBuffer } from './snapshot.js';
import { camera } from './camera.js';
import { RAN_W, SW } from './eat.js';
import { CW as CB_W } from './carboncells.js';

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const CELL_FLOATS = 96, CELL_BYTES = CELL_FLOATS * 4;   // (src/cells.js)
const BIO_FLOATS = 256, BIO_BYTES = BIO_FLOATS * 4;     // (src/genome.js)
const IW = 12;                 // info words per slot (inspect.wgsl)
const RING = 4096;             // log entries
const SIM_BYTES = 256, SLOT = 256;
export const HOW = ['placed', 'division', 'turnover'];
export const CAUSE = ['old age', 'eaten', 'burst', 'starved', 'heat', 'turnover', 'replaced'];   // ('old age': the background death rate,
                                                                                                  //  higher for a cell among strangers)
export const ROLE = { SELF: 1, DESC: 2, MOM: 3, SIS: 4 };

// the card's read-back: one staging buffer holds the chosen cell's words from six buffers
const RB = { cell: 0, bio: CELL_BYTES, stock: CELL_BYTES + BIO_BYTES, carbon: CELL_BYTES + BIO_BYTES + SW * 4 };
RB.ran = RB.carbon + CB_W * 4;
RB.info = RB.ran + RAN_W * 4;
RB.size = RB.info + IW * 4;

/** The family tree, by birth id (ids from 1, dense): typed arrays that grow. */
class Tree {
  constructor() { this.cap = 0; this.n = 0; this.grow(1 << 14); this.since = null; this.lost = 0; }
  grow(cap) {
    const old = this;
    const mk = (T, fill) => { const a = new T(cap); if (fill != null) a.fill(fill); return a; };
    const nx = { mom: mk(Uint32Array), born: mk(Float64Array, NaN), died: mk(Float64Array, NaN), cause: mk(Uint8Array), how: mk(Uint8Array),
      slot: mk(Int32Array, -1), killer: mk(Uint32Array), first: mk(Uint32Array), next: mk(Uint32Array), kids: mk(Uint32Array) };
    if (this.cap) for (const k of Object.keys(nx)) nx[k].set(old[k].subarray(0, this.cap));
    Object.assign(this, nx);
    this.cap = cap;
  }
  ensure(id) { if (id >= this.cap) { let c = this.cap; while (c <= id) c *= 2; this.grow(c); } if (id > this.n) this.n = id; }
  known(id) { return id > 0 && id <= this.n && !Number.isNaN(this.born[id]); }
  alive(id) { return this.known(id) && Number.isNaN(this.died[id]); }
  birth(id, mom, slot, t, how) {
    this.ensure(id);
    this.mom[id] = mom; this.born[id] = t; this.how[id] = how; this.slot[id] = slot;
    if (mom > 0 && mom < this.cap) { this.ensure(mom); this.next[id] = this.first[mom]; this.first[mom] = id; this.kids[mom]++; }
    if (this.since == null) this.since = t;
  }
  death(id, cause, killer, t) {
    if (!(id > 0)) return;
    this.ensure(id);
    this.died[id] = t; this.cause[id] = cause; this.killer[id] = killer; this.slot[id] = -1;
  }
  /** Daughters of id (all, newest first). */
  daughters(id) { const out = []; for (let k = this.first[id]; k; k = this.next[k]) out.push(k); return out; }
  /** Living descendants of id: [{ id, depth }], and the totals (all ever born, the deepest generation). */
  descendants(id, max = 200000) {
    const live = [];
    let all = 0, deep = 0;
    const st = [[id, 0]];
    while (st.length && all < max) {
      const [p, d] = st.pop();
      for (let k = this.first[p]; k; k = this.next[k]) {
        all++;
        if (d + 1 > deep) deep = d + 1;
        if (this.alive(k)) live.push({ id: k, depth: d + 1 });
        st.push([k, d + 1]);
      }
    }
    return { live, all, deep };
  }
  /** The line of mothers up to a founder (or the start of the record): [id, mother, grandmother, ...]. */
  line(id, max = 100000) {
    const out = [];
    for (let k = id; k > 0 && out.length < max; k = this.mom[k]) { out.push(k); if (!this.known(k)) break; }
    return out;
  }
}

export class Inspect {
  constructor(cells) {
    this.cells = cells;
    this.on = !(QS.get('inspect') === '0');
    this.tree = new Tree();
    this.sel = null;            // { slot, id, seed }
    this.data = null;           // the card's latest read-back (src/inspectcard.js reads it)
    this.hist = [];             // [time, ran counters, battery] samples for the rates
    this.showFamily = false;
    this.following = false;
    this.famInfo = null;        // the family last worked out ({ live, all, deep, mom, sisters })
    this.params = { dim: 0.6, ring: 1, cardEvery: 250, logEvery: 200, famEvery: 500 };
    this.busy = { log: false, card: 0, follow: 0 };
    this.lastLog = 0; this.lastCard = 0; this.lastFam = 0;
    this.logDone = 0;           // log entries processed
    this.famDirty = true;
    this.listeners = [];        // the card (called after each read-back)
    this.time = 0;              // the simulation time of the frame last encoded
  }

  async init(d) {
    if (!this.on) return;
    this.device = d;
    const format = navigator.gpu.getPreferredCanvasFormat();   // (the overlay draws on the canvas itself, not the cells' float targets)
    const pre = [HEAT_COMMON_URL, 'src/shaders/cell_common.wgsl'];
    const [mod, dmod] = await Promise.all([loadFieldShader(d, 'src/shaders/inspect.wgsl', pre), loadFieldShader(d, 'src/shaders/inspect_draw.wgsl', pre)]);
    const n = this.cells.count, U = GPUBufferUsage;
    this.n = n;
    this.infoBuf = d.createBuffer({ label: 'inspector info', size: n * IW * 4, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
    this.logBuf = d.createBuffer({ label: 'inspector log', size: (4 + RING * 4) * 4, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
    this.paramBuf = d.createBuffer({ label: 'inspector params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.famBuf = d.createBuffer({ label: 'inspector family', size: n * 8, usage: U.STORAGE | U.COPY_DST });
    this.drawU = d.createBuffer({ label: 'inspector draw', size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.fam = new Uint32Array(n * 2);
    const C = GPUShaderStage.COMPUTE;
    this.bgl = d.createBindGroupLayout({
      label: 'inspector', entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SIM_BYTES } },
        { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: C, buffer: { type: 'storage' } },
        { binding: 4, visibility: C, buffer: { type: 'storage' } },
        { binding: 5, visibility: C, buffer: { type: 'storage' } },
        { binding: 6, visibility: C, buffer: { type: 'uniform' } },
      ],
    });
    const layout = d.createPipelineLayout({ label: 'inspector', bindGroupLayouts: [this.bgl] });
    this.pipes = {
      detect: d.createComputePipeline({ label: 'inspector detect', layout, compute: { module: mod, entryPoint: 'detect' } }),
      commit: d.createComputePipeline({ label: 'inspector commit', layout, compute: { module: mod, entryPoint: 'commit' } }),
    };
    // the overlay: four pipelines on one layout
    const V = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.dbgl = d.createBindGroupLayout({
      label: 'inspector draw', entries: [
        { binding: 0, visibility: V, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const dl = d.createPipelineLayout({ label: 'inspector draw', bindGroupLayouts: [this.dbgl] });
    const A = GPUColorWrite.ALPHA, ALL = GPUColorWrite.ALL;
    const pipe = (label, vs, fs, target) => d.createRenderPipeline({
      label, layout: dl, vertex: { module: dmod, entryPoint: vs }, fragment: { module: dmod, entryPoint: fs, targets: [{ format, ...target }] },
      primitive: { topology: 'triangle-list' },
    });
    this.dpipes = {
      maskAll: pipe('inspector mask', 'vs_full', 'fs_maskall', { writeMask: A }),
      maskFam: pipe('inspector mask family', 'vs_cell', 'fs_mask', { writeMask: A }),
      dim: pipe('inspector dim', 'vs_full', 'fs_dim', {
        writeMask: ALL, blend: { color: { srcFactor: 'zero', dstFactor: 'one-minus-dst-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' } },
      }),
      rings: pipe('inspector rings', 'vs_cell', 'fs_ring', {
        writeMask: ALL, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } },
      }),
    };
    this.logRead = [0, 1].map(() => ({ buf: d.createBuffer({ label: 'inspector log read', size: (4 + RING * 4) * 4, usage: U.MAP_READ | U.COPY_DST }), busy: false }));
    this.cardRead = [0, 1].map(() => ({ buf: d.createBuffer({ label: 'inspector card read', size: RB.size, usage: U.MAP_READ | U.COPY_DST }), busy: false }));
    this.followRead = [0, 1, 2, 3].map(() => ({ buf: d.createBuffer({ label: 'inspector follow read', size: 48, usage: U.MAP_READ | U.COPY_DST }), busy: false }));
    this.ready = true;
  }

  /** The compute bind groups (one per genome copy; made again if the cells' buffers change). */
  bgs() {
    const C = this.cells, E = C.eat;
    if (!E || !E.ranBuf) return null;
    if (this._bgs && this._bgKey === C.bioBuf[0] && this._bgCell === C.cellBuf) return this._bgs;
    const b = (binding, buffer, size) => ({ binding, resource: size ? { buffer, size } : { buffer } });
    this._bgs = C.bioBuf.map((bio) => this.device.createBindGroup({
      label: 'inspector', layout: this.bgl,
      entries: [b(0, C.simBuf, SIM_BYTES), b(1, C.cellBuf), b(2, bio), b(3, this.infoBuf), b(4, this.logBuf), b(5, E.ranBuf), b(6, this.paramBuf)],
    }));
    this._bgKey = C.bioBuf[0]; this._bgCell = C.cellBuf;
    this._dbg = this.device.createBindGroup({
      label: 'inspector draw', layout: this.dbgl,
      entries: [b(0, this.drawU), b(1, C.cellBuf), b(2, this.infoBuf), b(3, this.famBuf)],
    });
    return this._bgs;
  }

  /** Once a frame, before the ticks: the pass's uniform. */
  beginFrame(frame) {
    if (!this.ready) return;
    this.time = frame.time;
    const ab = new ArrayBuffer(16), u = new Uint32Array(ab), f = new Float32Array(ab);
    u[0] = this.n; u[1] = RING;
    f[2] = Math.max(0.1, (this.cells.division && this.cells.division.params.starveTime) || 30);
    this.device.queue.writeBuffer(this.paramBuf, 0, ab);
  }

  /** After the cells' step of tick t (its newborns still marked; cells.bioCur names this tick's genomes). */
  encodeTick(encoder, t) {
    if (!this.ready) return;
    const bgs = this.bgs();
    if (!bgs) return;
    const pass = encoder.beginComputePass({ label: 'inspector' });
    pass.setBindGroup(0, bgs[this.cells.bioCur], [t * SLOT]);
    const wg = Math.ceil(this.n / 256);
    pass.setPipeline(this.pipes.detect); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.commit); pass.dispatchWorkgroups(wg);
    pass.end();
  }

  /** After the frame's ticks: the read-backs that are due (copies now, mapped once the frame is submitted). */
  encodeFrame(encoder) {
    if (!this.ready) return;
    const now = performance.now();
    // the log: always (the family tree must see every birth), a few times a second
    if (now - this.lastLog >= this.params.logEvery) {
      const rb = this.logRead.find((r) => !r.busy);
      if (rb) {
        this.lastLog = now;
        rb.busy = true;
        encoder.copyBufferToBuffer(this.logBuf, 0, rb.buf, 0, (4 + RING * 4) * 4);
        setTimeout(() => this.readLog(rb), 0);
      }
    }
    const S = this.sel;
    if (!S || S.dead) return;
    const C = this.cells, E = C.eat;
    if (now - this.lastCard >= this.params.cardEvery) {
      const rb = this.cardRead.find((r) => !r.busy);
      if (rb) {
        this.lastCard = now;
        rb.busy = true;
        const i = S.slot;
        encoder.copyBufferToBuffer(C.cellBuf, i * CELL_BYTES, rb.buf, RB.cell, CELL_BYTES);
        encoder.copyBufferToBuffer(C.bioBuf[C.bioCur], i * BIO_BYTES, rb.buf, RB.bio, BIO_BYTES);
        encoder.copyBufferToBuffer(E.stockBuf, i * SW * 4, rb.buf, RB.stock, SW * 4);
        if (E.carbon && E.carbon.buf && E.carbon.buf.size >= (i + 1) * CB_W * 4) encoder.copyBufferToBuffer(E.carbon.buf, i * CB_W * 4, rb.buf, RB.carbon, CB_W * 4);
        encoder.copyBufferToBuffer(E.ranBuf, i * RAN_W * 4, rb.buf, RB.ran, RAN_W * 4);
        encoder.copyBufferToBuffer(this.infoBuf, i * IW * 4, rb.buf, RB.info, IW * 4);
        const t = this.time;
        setTimeout(() => this.readCard(rb, S, t), 0);
      }
    }
    if (this.following) {
      const rb = this.followRead.find((r) => !r.busy);
      if (rb) {
        rb.busy = true;
        encoder.copyBufferToBuffer(C.cellBuf, S.slot * CELL_BYTES, rb.buf, 0, 48);
        setTimeout(() => this.readFollow(rb, S), 0);
      }
    }
  }

  async readLog(rb) {
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      const u = new Uint32Array(rb.buf.getMappedRange().slice(0));
      rb.buf.unmap();
      this.ingest(u);
    } catch (e) { /* a lost device or a destroyed buffer: skip */ } finally { rb.busy = false; }
  }

  /** The log's new entries into the tree. */
  ingest(u) {
    const total = u[1] >>> 0;
    let from = this.logDone;
    if (total < from) from = 0;                                 // (the page's buffers were made afresh)
    if (total - from > RING) { this.tree.lost += total - from - RING; from = total - RING; }
    const f = new Float32Array(u.buffer);
    const T = this.tree;
    for (let k = from; k < total; k++) {
      const o = 4 + (k % RING) * 4, w = u[o], kind = w & 1, detail = (w >>> 1) & 127, slot = w >>> 8, id = u[o + 1], other = u[o + 2], t = f[o + 3];
      if (kind === 0) T.birth(id, other, slot, t, detail);
      else if (id) T.death(id, detail, other, t);
    }
    if (total !== this.logDone) this.famDirty = true;
    this.logDone = total;
    const S = this.sel;
    if (S && S.id && !S.dead && !T.alive(S.id) && T.known(S.id)) this.markDead();
  }

  async readCard(rb, S, time) {
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      const ab = rb.buf.getMappedRange().slice(0);
      rb.buf.unmap();
      if (S !== this.sel) return;
      const f = new Float32Array(ab), u = new Uint32Array(ab);
      const cell = f.subarray(RB.cell / 4, RB.cell / 4 + CELL_FLOATS), cu = u.subarray(RB.cell / 4, RB.cell / 4 + CELL_FLOATS);
      const info = u.subarray(RB.info / 4, RB.info / 4 + IW);
      const alive = (cu[9] & 1) !== 0;
      if (!S.id && info[0]) { S.id = info[0]; S.seed = cu[10]; this.famDirty = true; }
      if (!alive || (S.id && info[0] && info[0] !== S.id) || (S.seed != null && cu[10] !== S.seed)) { this.markDead(); return; }
      const ran = Array.from(u.subarray(RB.ran / 4, RB.ran / 4 + RAN_W));
      this.hist.push({ time, ran, bat: cell[16] });
      while (this.hist.length > 2 && time - this.hist[1].time >= 4) this.hist.shift();
      if (this.hist.length && time < this.hist[0].time) this.hist = [this.hist[this.hist.length - 1]];
      this.data = {
        time, cell, cu, bio: f.subarray(RB.bio / 4, RB.bio / 4 + BIO_FLOATS), stock: new Int32Array(ab, RB.stock, SW),
        carbon: new Int32Array(ab, RB.carbon, CB_W), ran, info, rates: this.rates(),
      };
      if (this.showFamily && performance.now() - this.lastFam >= this.params.famEvery) this.updateFamily();
      else if (!this.showFamily && this.famDirty) this.updateFamily();
      this.emit();
    } catch (e) { /* skip */ } finally { rb.busy = false; }
  }

  /** Rates over the last few s of simulation time: each engine's events (units/s), the battery's energy in and out (energy/s), net. */
  rates() {
    const H = this.hist;
    if (H.length < 2) return null;
    const a = H[0], b = H[H.length - 1], dt = b.time - a.time;
    if (!(dt > 0.05)) return null;
    const d = (k) => ((b.ran[k] - a.ran[k]) >>> 0) / dt;
    const bm = (this.cells.eat && this.cells.eat.params.batMax) || 4;
    return { dt, eng: [0, 1, 2, 3, 4].map((k) => d(k) / 4096), gain: d(5) / 65536, paid: d(6) / 65536, net: (b.bat - a.bat) * bm / dt };
  }

  async readFollow(rb, S) {
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      const ab = rb.buf.getMappedRange().slice(0);
      rb.buf.unmap();
      if (S !== this.sel || !this.following) return;
      const f = new Float32Array(ab), u = new Uint32Array(ab);
      if (!(u[9] & 1) || (S.seed != null && u[10] !== S.seed)) { this.markDead(); return; }
      this.centreOn(f[0], f[1]);
    } catch (e) { /* skip */ } finally { rb.busy = false; }
  }

  /** The camera: the cell at the middle of the part of the screen the card leaves free. */
  centreOn(x, y, zoom = camera.z) {
    if (zoom !== camera.z) camera.z = Math.max(1, zoom);
    const off = this.viewOffset ? this.viewOffset() : [0, 0];   // (CSS px on screen, from the card)
    const s = camera.z * camera.f;
    const cx = x - off[0] / s, cy = y - off[1] / s;
    const tx = cx - camera.W / 2 / camera.z, ty = cy - camera.H / 2 / camera.z;
    if (Math.abs(tx - camera.x) * s < 0.25 && Math.abs(ty - camera.y) * s < 0.25) return;
    camera.set(camera.z, cx, cy);
  }

  markDead() {
    const S = this.sel;
    if (!S || S.dead) return;
    S.dead = true;
    this.following = false;
    this.famDirty = true;
    this.updateFamily();
    this.emit();
  }

  emit() { for (const f of this.listeners) { try { f(this); } catch (e) { console.warn('inspector card:', e); } } }

  /** The overlay's list: the chosen cell, and with SHOW FAMILY its living descendants, mother and sisters (by slot, with their ids). */
  updateFamily() {
    if (!this.ready) return;
    this.lastFam = performance.now();
    this.famDirty = false;
    const T = this.tree, S = this.sel, fam = this.fam;
    fam.fill(0);
    let info = null;
    if (S && S.id && T.known(S.id)) {
      const id = S.id;
      const put = (k, role, depth = 0) => { const s = T.slot[k]; if (s >= 0 && s < this.n && T.alive(k)) { fam[2 * s] = k; fam[2 * s + 1] = role | (depth << 8); } };
      const D = T.descendants(id);
      const mom = T.mom[id];
      const sisters = mom ? T.daughters(mom).filter((k) => k !== id) : [];
      const kids = T.daughters(id);
      info = { id, live: D.live.length, all: D.all, deep: D.deep, depths: D.live.reduce((m, x) => { m[x.depth] = (m[x.depth] || 0) + 1; return m; }, {}),
        mom, momAlive: T.alive(mom), sisters: sisters.length, sistersAlive: sisters.filter((k) => T.alive(k)).length,
        kids: kids.length, kidsAlive: kids.filter((k) => T.alive(k)).length };
      if (this.showFamily) {
        for (const x of D.live) put(x.id, ROLE.DESC, Math.min(255, x.depth));
        for (const k of sisters) put(k, ROLE.SIS);
        if (mom) put(mom, ROLE.MOM);
      }
    }
    if (S && S.id && !S.dead && S.slot < this.n) { fam[2 * S.slot] = S.id; fam[2 * S.slot + 1] = ROLE.SELF; }
    this.famInfo = info;
    this.device.queue.writeBuffer(this.famBuf, 0, fam);
  }

  /** Draw the overlay over the finished picture (main.js, after the looks). */
  draw(encoder, canvasView, view, realTime) {
    if (!this.ready || !this.sel || this.sel.dead || !this._dbg) return;
    const fam = this.showFamily;
    const ab = new Float32Array(12);
    ab[0] = camera.x; ab[1] = camera.y; ab[2] = camera.z; ab[3] = view.dpr;
    ab[4] = view.cssW / camera.z; ab[5] = view.cssH / camera.z; ab[6] = Math.max(0, Math.min(0.95, this.params.dim)); ab[7] = Math.max(0.3, this.params.ring);
    ab[8] = realTime; ab[9] = 0;
    this.device.queue.writeBuffer(this.drawU, 0, ab);
    const pass = encoder.beginRenderPass({ label: 'inspector', colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }] });
    pass.setBindGroup(0, this._dbg);
    if (fam && this.params.dim > 0) {
      pass.setPipeline(this.dpipes.maskAll); pass.draw(3);
      pass.setPipeline(this.dpipes.maskFam); pass.draw(6, this.n);
      pass.setPipeline(this.dpipes.dim); pass.draw(3);
    }
    pass.setPipeline(this.dpipes.rings); pass.draw(6, this.n);
    pass.end();
  }

  // ---------- the API (tool, card, console) ----------
  /** Choose the live cell nearest (x, y) (dish px), within 1.5 R of its edge. Returns its slot, or null. */
  async at(x, y) {
    if (!this.ready) return null;
    const C = this.cells, n = this.n;
    const ab = await readBuffer(this.device, C.cellBuf, 0, n * CELL_BYTES);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FLOATS;
      if (!(u[o + 9] & 1)) continue;
      const dd = Math.hypot(f[o] - x, f[o + 1] - y) - f[o + 4];
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0 || bd > 1.5 * (C.R || 9)) return null;
    await this.choose(best);
    return best;
  }
  /** Choose the cell in slot i (console). */
  async cell(i) {
    if (!this.ready || !(i >= 0 && i < this.n)) return null;
    await this.choose(i);
    return this.sel ? i : null;
  }
  async choose(slot) {
    const ab = await readBuffer(this.device, this.cells.cellBuf, slot * CELL_BYTES, CELL_BYTES);
    const iab = await readBuffer(this.device, this.infoBuf, slot * IW * 4, IW * 4);
    const u = new Uint32Array(ab), f = new Float32Array(ab), inf = new Uint32Array(iab);
    if (!(u[9] & 1)) return;
    this.sel = { slot, id: inf[0], seed: u[10], pos: [f[0], f[1]], dead: false, at: this.time };
    this.hist = [];
    this.data = null;
    this.famInfo = null;
    this.lastCard = 0;
    this.famDirty = true;
    this.updateFamily();
    this.emit();
  }
  close() {
    this.sel = null; this.data = null; this.famInfo = null; this.following = false; this.showFamily = false; this.hist = [];
    if (this.ready) this.updateFamily();
    this.emit();
  }
  /** SHOW FAMILY on / off (no argument: flips). Returns the family's numbers once known. */
  family(on) {
    this.showFamily = on == null ? !this.showFamily : !!on;
    this.famDirty = true;
    this.updateFamily();
    this.emit();
    return this.famInfo;
  }
  /** FOLLOW on / off (no argument: flips). */
  follow(on) {
    this.following = on == null ? !this.following : !!on;
    if (this.sel && this.sel.dead) this.following = false;
    this.emit();
    return this.following;
  }

  /** The tree's totals: births by how, deaths by cause, living (since the page started). */
  stats() {
    const T = this.tree, how = HOW.map(() => 0), cause = CAUSE.map(() => 0);
    let live = 0;
    for (let id = 1; id <= T.n; id++) {
      if (!T.known(id)) continue;
      how[T.how[id]]++;
      if (Number.isNaN(T.died[id])) live++; else cause[T.cause[id]]++;
    }
    return { ids: T.n, live, since: T.since, lost: T.lost, born: Object.fromEntries(HOW.map((k, j) => [k, how[j]])),
      died: Object.fromEntries(CAUSE.map((k, j) => [k, cause[j]])) };
  }

  /**
   * Every living cell's age, daughters and living descendants against its battery and place: who are the colony's mothers? (a fresh
   * read-back of the cells and the info). Returns { n, top: the 12 cells with the most living descendants, corr: correlations }.
   */
  async survey(topN = 12) {
    if (!this.ready) return null;
    const C = this.cells, n = this.n, d = this.device;
    const [cab, iab] = await Promise.all([readBuffer(d, C.cellBuf, 0, n * CELL_BYTES), readBuffer(d, this.infoBuf, 0, n * IW * 4)]);
    const f = new Float32Array(cab), u = new Uint32Array(cab), inf = new Uint32Array(iab), T = this.tree, now = this.time;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FLOATS;
      if (!(u[o + 9] & 1)) continue;
      const id = inf[i * IW];
      if (!T.known(id)) continue;
      const D = T.descendants(id);
      rows.push({ slot: i, id, x: f[o], y: f[o + 1], bat: f[o + 16], r: f[o + 4], age: now - T.born[id], kids: T.kids[id], live: D.live.length,
        deep: D.deep, how: HOW[T.how[id]], gen: T.line(id).length - 1 });
    }
    const corr = (a, b) => {
      const m = rows.length;
      if (m < 3) return null;
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (const r of rows) { const x = a(r), y = b(r); sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
      const va = saa / m - (sa / m) ** 2, vb = sbb / m - (sb / m) ** 2;
      return va > 0 && vb > 0 ? (sab / m - sa * sb / m / m) / Math.sqrt(va * vb) : null;
    };
    const top = [...rows].sort((a, b) => b.live - a.live).slice(0, topN);
    const rich = rows.filter((r) => r.bat >= 0.9), poor = rows.filter((r) => r.bat < 0.5);
    const mean = (a, k) => (a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : null);
    return {
      n: rows.length, since: T.since, now, lost: T.lost,
      corr: { batAge: corr((r) => r.bat, (r) => r.age), batKids: corr((r) => r.bat, (r) => r.kids), batLive: corr((r) => r.bat, (r) => Math.log1p(r.live)) },
      rich: { n: rich.length, age: mean(rich, 'age'), kids: mean(rich, 'kids'), live: mean(rich, 'live') },
      poor: { n: poor.length, age: mean(poor, 'age'), kids: mean(poor, 'kids'), live: mean(poor, 'live') },
      all: { age: mean(rows, 'age'), kids: mean(rows, 'kids') },
      top, rows,
    };
  }
}
