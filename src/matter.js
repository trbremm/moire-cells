// Matter (Part C, step C3): the atom grid, without reactions. SPRINGS (mouse-dropped, tap modes 2 and 3) drip atoms into
// the dish; the atoms spread (light ones quickly, heavy ones slowly), leave at the dish's edge, and are drawn as crisp
// halftone dots on the medium lattice (dot size = amount). Cells ignore them in C3.
//
// Storage: 13 channels (6 atoms g t l G T L, 4 fuels gt gT Gt GT, 2 sediments ll LL, trace; heat is the 14th, in
// src/heat.js) on the heat grid's pixels (same size and geometry, so later steps react them together), as more blocks
// of the heat buffer (heat_common.wgsl): two copies of 13 blocks, ping-pong. The cells' step is at WebGPU's limit of 8
// storage buffers and already binds the heat buffer, so the cells can reach the atoms there later (C5) without one more.
// Amounts are whole counts (ATOM_SCALE per atom-unit) in i32, like the heat: atomics are integer only, and whole counts
// make moving matter around EXACT, so matter is conserved to the count.
//
// Every tick (matter.wgsl, spread):
//   drip    on the tick's first substep, each spring adds its atoms evenly over the pixels of a small disc (random
//           rounding), booked as "added";
//   spread  explicit, conservative, nSub substeps: each edge between two pixels carries k x the difference, rounded at
//           random (so thin tails keep spreading) and capped at a quarter of what the giver has (so nothing goes below
//           zero); both pixels work out the same edge from the same numbers, so what one gives the other receives. On a
//           tick's first substep the pixels on the dish's rim lose a share `edge` per s of their mobile atoms, booked as
//           "lost" (the sink that keeps the dish from filling up forever).
// Once per frame (with the heat's ledger): the atoms in the dish per channel (exact, 64-bit) and the sum of m ln m for the
// ORDER line; paint writes two small textures with the amounts the drawing shows.
//
// The ledger: added by springs = in the dish + lost at the edge + gone (washed out with Shift+C, or with the old grid on a
// window resize); rounding = what does not add up. Every amount is whole counts, so it stays at exactly 0.
//
// ORDER (the entropy panel): how patterned the dish's matter is. p = each pixel's share of each substance's atoms;
// H = -sum p ln p (Shannon entropy); Hmax = what H would be if the same matter were smeared evenly over the whole dish
// (ln pixels + the entropy of the mix); ORDER = 1 - H / Hmax: 1 = all in one spot, 0 = evenly smeared.

import { loadShader } from './gpu.js';
import { HEAT_COMMON_URL, LEDGER_WORDS, fmt } from './heat.js';

// ---------- the periodic table (CLAUDE.md, Part C): every property derived from ROW and GROUP, nowhere else ----------
// ROW is size: heavier = slower spreading (later: richer bonds, harder light needed). GROUP is role: a GIVER wants one
// partner, a TAKER wants one partner, a LINKER wants two (it chains), INERT wants none.
export const ATOMS = {
  g: { row: 1, group: 'giver' },
  t: { row: 1, group: 'taker' },
  l: { row: 1, group: 'linker' },
  G: { row: 2, group: 'giver' },
  T: { row: 2, group: 'taker' },
  L: { row: 2, group: 'linker' },
  trace: { row: 3, group: 'inert' },   // rare; never reacts, barely moves (C4: lowers the spark where it sits)
};

// How fast things spread (R^2 per s of simulation time): row 1 quickly, each row further down SPREAD.perRow times
// slower; a bonded pair at the speed of its heavier atom, a little slower than that (SPREAD.bond); sediment not at all.
// (A patch spreads over about sqrt(4 x spread x t): light atoms 17 R in a minute, heavy ones 6 R, trace 2 R.)
export const SPREAD = { row1: 1.2, perRow: 0.12, bond: 0.7 };

// Inks by chemical FUNCTION (faded palette, 0..255): each with a lighter variant for row 1 and a deeper one for row 2;
// a substance's ink sits between them by the share of its atoms in row 2. Reactive free atoms (givers and takers, hungry
// for a partner) in the old threat red; linkers dim and quiet; fuels in the old nutrient green; sediment a dim flat
// brown-grey; trace a pale silver, drawn as a small diamond instead of a dot.
export const INKS = {
  reactive: { light: [250, 170, 150], heavy: [214, 98, 86] },
  linker: { light: [150, 158, 176], heavy: [104, 112, 132] },
  fuel: { light: [196, 242, 178], heavy: [124, 204, 128] },
  sediment: { light: [96, 86, 74], heavy: [74, 64, 56] },
  trace: { light: [222, 222, 232], heavy: [222, 222, 232] },
};

// The 13 channels, in buffer order. A substance is just its atoms; its kind follows from their groups:
// one giver or taker or linker = a free atom, giver + taker = FUEL, linker + linker = SEDIMENT, the inert atom = trace.
export const SUBSTANCES = [
  ['g'], ['t'], ['l'], ['G'], ['T'], ['L'],
  ['g', 't'], ['g', 'T'], ['G', 't'], ['G', 'T'],
  ['l', 'l'], ['L', 'L'],
  ['trace'],
].map((atoms) => derive(atoms));
export const NCH = SUBSTANCES.length;   // 13
export const CH = Object.fromEntries(SUBSTANCES.map((s, c) => [s.name, c]));

function derive(atoms) {
  const A = atoms.map((a) => ATOMS[a]);
  const groups = A.map((a) => a.group).sort().join('+');
  const kind = atoms.length === 1 ? (A[0].group === 'inert' ? 'trace' : 'atom')
    : groups === 'giver+taker' ? 'fuel' : groups === 'linker+linker' ? 'sediment' : 'other';
  const row = Math.max(...A.map((a) => a.row));
  const heavy = A.filter((a) => a.row >= 2).length / A.length;          // share of its atoms in row 2 or below
  const reactive = kind === 'atom' && (A[0].group === 'giver' || A[0].group === 'taker');
  const spread = kind === 'sediment' ? 0 : SPREAD.row1 * SPREAD.perRow ** (row - 1) * (atoms.length > 1 ? SPREAD.bond : 1);
  const func = kind === 'atom' ? (reactive ? 'reactive' : 'linker') : kind === 'other' ? 'linker' : kind;
  const layer = { atom: 0, fuel: 1, sediment: 2, trace: 3 }[kind] ?? 0;   // which dot layer draws it
  const name = atoms.length === 1 ? atoms[0] : atoms.join('');
  return { name, atoms, kind, row, heavy, reactive, spread, func, layer, ink: inkOf(func, heavy) };
}

function inkOf(func, heavy) {
  const I = INKS[func];
  return I.light.map((v, j) => v + (I.heavy[j] - v) * heavy);
}

/** A substance's name in words, for the flash and the overlay. */
export function describe(s) {
  const role = (a) => `${ATOMS[a].row === 1 ? 'light' : 'heavy'} ${ATOMS[a].group}`;
  if (s.kind === 'atom') return `free atom ${s.name} (${role(s.atoms[0])}${s.reactive ? ', reactive' : ''})`;
  if (s.kind === 'fuel') return `fuel ${s.name} (${role(s.atoms[0])} + ${role(s.atoms[1])})`;
  if (s.kind === 'sediment') return `sediment ${s.name} (${s.atoms[0] === 'l' ? 'light' : 'heavy'} linker chain)`;
  return 'trace (the rare inert atom)';
}

// The springs' mixes (shares of the dripped atoms). Tap mode 2 = LIGHT spring (row 1), tap mode 3 = HEAVY spring
// (row 2, plus a little trace).
export const SPRING_KINDS = {
  light: { label: 'light spring', mix: { g: 1 / 3, t: 1 / 3, l: 1 / 3 }, stroke: 1.25 },
  heavy: { label: 'heavy spring', mix: { G: 0.32, T: 0.32, L: 0.32, trace: 0.04 }, stroke: 2.25 },
};

export const ATOM_SCALE = 4096;          // counts per atom-unit (ATOM_SCALE in matter.wgsl)
const MP_BYTES = 368;                     // struct MatterP
const MT_SLOT = 256;                      // struct MatterTick slots, bound with a dynamic offset
const MAX_TICKS = 128;
const MAX_SUB = 4;                        // spreading substeps per tick at most
const MT_LEDGER = MAX_TICKS * MAX_SUB;    // slot: the ledger snapshot and the paint (current copy after the ticks)
const MT_DRAIN = MT_LEDGER + 1;           // slot: the old grid on a resize
const MT_WASH = MT_LEDGER + 2;            // slot: Shift+C
const MT_SLOTS = MT_LEDGER + 3;
export const MAX_SPRINGS = 16;            // the springs uniform's capacity
const SPRING_FLOATS = 24;                 // struct Spring: pos (4), amt (16), ink (4)
const DRAW_BYTES = 224;                   // struct DrawP in matter_draw.wgsl
const K_MAX = 0.2;
const LG_M = { ADD: 3072, LOST: 4736, GONE: 6400, DISH: 8064, ORDER: 9728 };   // heat_common.wgsl
const ORDER_SLOTS = 256;

// what Shift+S shows: the summary, each substance alone, nothing
export const SHOWS = ['summary', ...SUBSTANCES.map((s) => s.name), 'off'];

export class Matter {
  constructor(device, format, medium) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.heat = null;
    this.landscape = null;    // key L hides the whole landscape, this included (set by main.js)
    this.blocks = 2 * NCH;    // blocks of n words in the heat buffer
    // live-tunable: moire.matter.params
    this.params = {
      show: 0,            // index into SHOWS (Shift+S cycles)
      edge: 1,            // share of the mobile atoms on the dish's rim pixels that leaves per s (the sink)
      spreadGain: 1,      // multiplies every substance's spreading (SPREAD above stays the source of truth)
      // springs
      rate: 6,            // atoms per s a spring drips (all its atoms together)
      life: 60,           // s of simulation time a spring drips before it dries up (and is removed)
      radius: 1,          // the disc it drips over, in cell radii R (at most 7 heat pixels)
      maxSprings: 12,     // one more removes the oldest (up to MAX_SPRINGS)
      // drawing: halftone dots on the medium lattice
      step: 2,            // dot spacing in medium lattice spacings (the medium's lattice spacing is 2 / sqrt 3 x its period)
      maxDot: 0.9,        // largest dot radius, as a share of half the distance between neighbouring dots of two layers
      half: 0.6,          // amount per R^2 at which a dot covers half its largest area (dot area = c / (c + half))
      thresh: 0.06,       // coverage below which there is no dot
      level: 0.85,        // the inks' brightness
      traceDot: 0.75,     // trace diamonds' size, as a share of a full dot
      sedStep: 1.5,       // sediment: amount per R^2 per flat level (3 levels)
      sedAlpha: 0.7,      // sediment: opacity of the top level
      ringR: 1.3,         // spring marker radius, in medium R (CSS px x R)
    };
    this.springs = [];        // { x, y, kind, age }
    this.seen = new Float64Array(NCH).fill(-1e9);   // when each channel last had matter (or a spring dripping it)
    this.time = 0;
    this.cur = 0;             // which copy is current
    this.nSub = 1;
    this.bufVersion = -1;     // the heat buffer version the bind groups and `cur` belong to
    this.view = null;
    // ledger (atom-units; cumulative since the page started, per channel)
    this.tot = { add: new Float64Array(NCH), lost: new Float64Array(NCH), gone: new Float64Array(NCH) };
    this.dish = new Float64Array(NCH);
    this.ledger = null;       // last snapshot (see apply)
    this.hist = [];           // [time, added, lost] for the rates
    this.orderHist = [];      // [time, order] (the last few minutes)
  }

  static async create(device, format, medium) {
    const m = new Matter(device, format, medium);
    await m.init();
    return m;
  }

  async init() {
    const d = this.device;
    const res = await fetch(HEAT_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${HEAT_COMMON_URL}: HTTP ${res.status}`);
    const common = (await res.text()).replace(/\s*$/, '\n\n');
    const fres = await fetch('src/shaders/field_common.wgsl', { cache: 'no-cache' });
    if (!fres.ok) throw new Error('Could not load shader src/shaders/field_common.wgsl');
    const field = (await fres.text()).replace(/\s*$/, '\n\n');
    const [mod, drawMod] = await Promise.all([
      loadShader(d, 'src/shaders/matter.wgsl', { prefixes: [{ name: HEAT_COMMON_URL, text: common }] }),
      loadShader(d, 'src/shaders/matter_draw.wgsl', { prefixes: [{ name: 'src/shaders/field_common.wgsl', text: field }] }),
    ]);
    const C = GPUShaderStage.COMPUTE, U = GPUBufferUsage;
    this.bgl = d.createBindGroupLayout({
      label: 'matter',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
        { binding: 3, visibility: C, buffer: { type: 'uniform' } },
        { binding: 4, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    this.texBgl = d.createBindGroupLayout({
      label: 'matter paint',
      entries: [
        { binding: 0, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const layout = d.createPipelineLayout({ label: 'matter', bindGroupLayouts: [this.bgl] });
    const paintLayout = d.createPipelineLayout({ label: 'matter paint', bindGroupLayouts: [this.bgl, this.texBgl] });
    this.pipes = {};
    for (const e of ['spread', 'count']) {
      this.pipes[e] = d.createComputePipeline({ label: `matter ${e}`, layout, compute: { module: mod, entryPoint: e } });
    }
    this.pipes.paint = d.createComputePipeline({ label: 'matter paint', layout: paintLayout, compute: { module: mod, entryPoint: 'paint' } });
    this.paramBuf = d.createBuffer({ label: 'matter params', size: MP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.paramAB = new ArrayBuffer(MP_BYTES);
    this.tickBuf = d.createBuffer({ label: 'matter tick params', size: MT_SLOTS * MT_SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.tickAB = new ArrayBuffer(MT_SLOTS * MT_SLOT);
    this.springBuf = d.createBuffer({ label: 'springs', size: MAX_SPRINGS * SPRING_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
    this.springF = new Float32Array(MAX_SPRINGS * SPRING_FLOATS);

    // drawing
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'matter draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.drawU = d.createBuffer({ label: 'matter draw params', size: DRAW_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.drawAB = new ArrayBuffer(DRAW_BYTES);
    this.sampler = d.createSampler({ label: 'matter', magFilter: 'linear', minFilter: 'linear' });
    this.tex = null;          // [A, B] at the grid's size
  }

  /** The heat band whose buffer and grid the substances share. Called once by main.js, before the first resize. */
  attach(heat) {
    this.heat = heat;
    heat.setMatter(this);
  }

  get showName() { return SHOWS[this.params.show] || 'summary'; }

  makeBG(buffer) {
    return this.device.createBindGroup({
      label: 'matter', layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: this.tickBuf, size: 32 } },
        { binding: 2, resource: { buffer, offset: 0, size: LEDGER_WORDS * 4 } },   // the ledger, atomic
        { binding: 3, resource: { buffer: this.springBuf } },
        { binding: 4, resource: { buffer, offset: LEDGER_WORDS * 4 } },   // ... the grid blocks behind it, plain (matter.wgsl)
      ],
    });
  }

  /** Word offset of copy k's channel 0, counted from the end of the ledger (the grid binding's start), for n pixels. */
  copyBase(k, n = this.heat.n) { return this.heat.extraBase(n) - LEDGER_WORDS + k * NCH * n; }

  resize(view) {
    // keep the springs at the same place relative to the dish
    if (this.view && (this.view.cssW !== view.cssW || this.view.cssH !== view.cssH)) {
      const sx = view.cssW / this.view.cssW, sy = view.cssH / this.view.cssH;
      for (const s of this.springs) { s.x *= sx; s.y *= sy; }
    }
    this.view = view;
  }

  // ---------- springs ----------
  /** Drop a spring at CSS px (x, y): kind 'light' or 'heavy'. */
  addSpring(x, y, kind) {
    const cap = Math.max(1, Math.min(MAX_SPRINGS, Math.round(this.params.maxSprings)));
    while (this.springs.length >= cap) this.springs.shift();
    this.springs.push({ x, y, kind, age: 0 });
  }

  clearSprings() { this.springs.length = 0; }

  /** Shift+C: every atom out of the dish (booked as gone), now. */
  wash() {
    if (!this.bg || !this.heat.buffer) return;
    this.dish.fill(0);
    const d = this.device, n = this.heat.n;
    const T = new Uint32Array(this.tickAB), o = MT_WASH * MT_SLOT / 4;
    T[o] = this.copyBase(this.cur); T[o + 1] = 0; T[o + 2] = 0; T[o + 4] = n; T[o + 5] = LG_M.GONE;
    d.queue.writeBuffer(this.tickBuf, MT_WASH * MT_SLOT, this.tickAB, MT_WASH * MT_SLOT, MT_SLOT);
    const e = d.createCommandEncoder({ label: 'matter wash' });
    const pass = e.beginComputePass({ label: 'matter wash' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.bg, [MT_WASH * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
    e.clearBuffer(this.heat.buffer, (LEDGER_WORDS + this.copyBase(0)) * 4, this.blocks * n * 4);
    d.queue.submit([e.finish()]);
  }

  // ---------- the frame (called by the cells, between the heat's beginFrame and its ticks) ----------
  /** The old grid, replaced by a resize: its atoms are booked as gone (into its own ledger, which is carried over). */
  encodeDrain(encoder, buffer, n) {
    if (this.bufVersion < 0) return;
    const T = new Uint32Array(this.tickAB), o = MT_DRAIN * MT_SLOT / 4;
    T[o] = this.copyBase(this.cur, n); T[o + 1] = 0; T[o + 2] = 0; T[o + 4] = n; T[o + 5] = LG_M.GONE;
    this.device.queue.writeBuffer(this.tickBuf, MT_DRAIN * MT_SLOT, this.tickAB, MT_DRAIN * MT_SLOT, MT_SLOT);
    const pass = encoder.beginComputePass({ label: 'matter drain' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.makeBG(buffer), [MT_DRAIN * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
  }

  /** Springs and spreading for the frame's ticks, then the drawing's textures. */
  encodeFrame(encoder, frame) {
    const H = this.heat;
    if (!H || !H.buffer) return;
    if (this.bufVersion !== H.version) {
      this.bufVersion = H.version;
      this.cur = 0;
      this.bg = this.makeBG(H.buffer);
      this.makeTextures();
    }
    const ticks = frame.ticks;
    if (!ticks) return;
    const p = this.params, dt = frame.tickDt, a = H.px / H.R;
    // springs: age, dry up, and their counts per tick
    for (const s of this.springs) s.age += ticks * dt;
    this.springs = this.springs.filter((s) => s.age < p.life);
    const ns = this.writeSprings(dt);
    // the channels worth spreading: matter in the dish at the last read-back, or a spring dripping it, within the last
    // 2 s (so both copies of a channel left out are certainly all zero); the others are skipped (most are empty)
    this.time = frame.time;
    for (let c = 0; c < NCH; c++) if (this.dish[c] > 0) this.seen[c] = frame.time;
    for (const sp of this.springs) for (const a of Object.keys(SPRING_KINDS[sp.kind].mix)) this.seen[CH[a]] = frame.time;
    let active = 0;
    for (let c = 0; c < NCH; c++) if (frame.time - this.seen[c] < 2) active |= 1 << c;
    this.active = active;

    // spreading per substep, per channel
    const kTot = SUBSTANCES.map((s) => Math.max(0, s.spread * p.spreadGain) * dt / (a * a));
    this.nSub = Math.max(1, Math.min(MAX_SUB, Math.ceil(Math.max(...kTot) / K_MAX)));
    const f = new Float32Array(this.paramAB), u = new Uint32Array(this.paramAB);
    u[0] = H.hw; u[1] = H.hh; u[2] = H.n; u[3] = this.copyBase(0);
    const show = this.showName;
    u[4] = show === 'off' ? 0 : show === 'summary' ? 1 : 2; u[5] = Math.max(0, CH[show] ?? 0); u[6] = this.nSub; u[7] = active;
    f[8] = H.px; f[9] = 1 / (ATOM_SCALE * a * a); f[10] = 1 - Math.exp(-Math.max(0, p.edge) * dt);
    SUBSTANCES.forEach((s, c) => {
      f[12 + c] = Math.min(K_MAX, kTot[c] / this.nSub);   // k
      u[28 + c] = s.layer;                                // layer
      f[44 + c] = s.reactive ? 1 : 0;                     // react
      f[60 + c] = s.heavy;                                // heavy
      f[76 + c] = s.atoms.length;                         // atoms per unit (the ORDER weights by atoms)
    });
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramAB);

    const T = new Uint32Array(this.tickAB), w = MT_SLOT / 4;
    const seed0 = (frame.frameNo * 2654435761 + 0x7f4a7c15) >>> 0;
    for (let t = 0; t < ticks; t++) {
      for (let s = 0; s < this.nSub; s++) {
        const o = (t * MAX_SUB + s) * w, c = this.cur ^ ((t * this.nSub + s) & 1);
        T[o] = this.copyBase(c); T[o + 1] = this.copyBase(c ^ 1); T[o + 2] = s === 0 ? 1 : 0;
        T[o + 3] = Math.imul(seed0 + t * 131 + s * 7, 2654435761) >>> 0; T[o + 4] = ns; T[o + 5] = 0;
      }
    }
    const last = (ticks - 1) * MAX_SUB + MAX_SUB;
    this.device.queue.writeBuffer(this.tickBuf, 0, this.tickAB, 0, Math.min(last, MT_LEDGER) * MT_SLOT);
    const pass = encoder.beginComputePass({ label: 'matter' });
    const wx = Math.ceil(H.hw / 8), wy = Math.ceil(H.hh / 8);
    if (active) {
      // (with nothing in the dish and no spring, both copies are all zero: nothing to spread, and the copies stay put)
      pass.setPipeline(this.pipes.spread);
      for (let t = 0; t < ticks; t++) {
        for (let s = 0; s < this.nSub; s++) {
          pass.setBindGroup(0, this.bg, [(t * MAX_SUB + s) * MT_SLOT]);
          pass.dispatchWorkgroups(Math.ceil(H.hw / 16), Math.ceil(H.hh / 4));
        }
      }
      this.cur ^= (ticks * this.nSub) & 1;
    }
    // the ledger / paint slot: the current copy after the ticks
    const L = MT_LEDGER * w;
    T[L] = this.copyBase(this.cur); T[L + 1] = 0; T[L + 2] = 1; T[L + 3] = seed0; T[L + 4] = H.n; T[L + 5] = LG_M.DISH;
    this.device.queue.writeBuffer(this.tickBuf, MT_LEDGER * MT_SLOT, this.tickAB, MT_LEDGER * MT_SLOT, MT_SLOT);
    if (this.tex && show !== 'off') {
      pass.setPipeline(this.pipes.paint);
      pass.setBindGroup(0, this.bg, [MT_LEDGER * MT_SLOT]);
      pass.setBindGroup(1, this.texBG);
      pass.dispatchWorkgroups(wx, wy);
    }
    pass.end();
  }

  /** Write the springs uniform for this frame; returns how many. */
  writeSprings(dt) {
    const p = this.params, F = this.springF, H = this.heat;
    const n = Math.min(MAX_SPRINGS, this.springs.length);
    const rad = Math.min(7 * H.px, Math.max(0, p.radius) * H.R);
    F.fill(0);
    for (let k = 0; k < n; k++) {
      const s = this.springs[k], K = SPRING_KINDS[s.kind], o = k * SPRING_FLOATS;
      F[o] = s.x; F[o + 1] = s.y; F[o + 2] = rad; F[o + 3] = Math.max(0, 1 - s.age / p.life);
      F[o + 4 + 13] = discPixels(s.x / H.px, s.y / H.px, Math.max(rad / H.px, 0.75), H.hw, H.hh);   // amt[13]: its disc's pixels
      for (const [atom, share] of Object.entries(K.mix)) F[o + 4 + CH[atom]] = p.rate * share * dt * ATOM_SCALE;
      const ink = springInk(s.kind);
      F[o + 20] = ink[0] / 255; F[o + 21] = ink[1] / 255; F[o + 22] = ink[2] / 255; F[o + 23] = K.stroke;
    }
    this.device.queue.writeBuffer(this.springBuf, 0, F);
    this.nSprings = n;
    return n;
  }

  makeTextures() {
    const H = this.heat;
    if (this.tex) for (const t of this.tex) t.destroy();
    this.tex = [0, 1].map((k) => this.device.createTexture({
      label: `matter shown ${k}`, size: [H.hw, H.hh], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }));
    this.texBG = this.device.createBindGroup({
      label: 'matter paint', layout: this.texBgl,
      entries: [{ binding: 0, resource: this.tex[0].createView() }, { binding: 1, resource: this.tex[1].createView() }],
    });
    this.drawBG = null;
  }

  /** Once per frame, with the heat's ledger (before its copy): the atoms in the dish and the ORDER sums. */
  encodeLedger(encoder) {
    if (!this.bg || this.bufVersion !== this.heat.version) return;
    encoder.clearBuffer(this.heat.buffer, LG_M.DISH * 4, (LG_M.ORDER + ORDER_SLOTS - LG_M.DISH) * 4);
    const pass = encoder.beginComputePass({ label: 'matter ledger' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.bg, [MT_LEDGER * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
    this.ledgerPixels = this.heat.n;
  }

  /** The heat's ledger read-back (Int32 words), in order: book the counters, take the snapshot. */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot;
    for (let c = 0; c < NCH; c++) {
      T.add[c] += wide(LG_M.ADD + 128 * c) / ATOM_SCALE;
      T.lost[c] += wide(LG_M.LOST + 128 * c) / ATOM_SCALE;
      T.gone[c] += wide(LG_M.GONE + 128 * c) / ATOM_SCALE;
      this.dish[c] = wide(LG_M.DISH + 128 * c) / ATOM_SCALE;
    }
    // atoms, weighting each substance by how many atoms it holds
    const atoms = (arr) => SUBSTANCES.reduce((x, s, c) => x + arr[c] * s.atoms.length, 0);
    const add = atoms(T.add), lost = atoms(T.lost), gone = atoms(T.gone), dish = atoms(this.dish);
    // ORDER: H = ln M - S / M over (pixel, substance), with M and S in counts of atoms
    const f = new Float32Array(w.buffer, LG_M.ORDER * 4, ORDER_SLOTS);
    let S = 0;
    for (let k = 0; k < ORDER_SLOTS; k++) S += f[k];
    const M = dish * ATOM_SCALE;
    let order = null, Hn = null;
    if (M > 0 && this.ledgerPixels) {
      const Hs = Math.log(M) - S / M;
      let Hmix = 0;
      SUBSTANCES.forEach((s, c) => { const q = this.dish[c] * s.atoms.length / dish; if (q > 0) Hmix -= q * Math.log(q); });
      const Hmax = Math.log(this.ledgerPixels) + Hmix;
      Hn = Hs / Hmax;
      order = Math.max(0, Math.min(1, 1 - Hn));
    }
    const Hh = this.hist;
    Hh.push([rec.time, add, lost]);
    while (Hh.length > 2 && rec.time - Hh[1][0] >= 1) Hh.shift();
    const dt = rec.time - Hh[0][0];
    const rate = (k) => (dt > 0.05 ? (Hh[Hh.length - 1][k] - Hh[0][k]) / dt : 0);
    if (order != null) {
      const O = this.orderHist;
      if (!O.length || rec.time - O[O.length - 1][0] >= 1) O.push([rec.time, order]);
      while (O.length > 600) O.shift();
    }
    this.ledger = { time: rec.time, add, lost, gone, dish, rounding: add - (dish + lost + gone), rateAdd: rate(1), rateLost: rate(2), order, entropy: Hn };
  }

  // ---------- drawing ----------
  compute() {}

  render(pass) {
    if (!this.tex || !this.view || this.showName === 'off') return;
    if (this.landscape && !this.landscape.params.on) return;
    const p = this.params, H = this.heat;
    if (!this.drawBG) {
      this.drawBG = this.device.createBindGroup({
        layout: this.drawPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.medium.buffer } },
          { binding: 1, resource: { buffer: this.drawU } },
          { binding: 2, resource: this.tex[0].createView() },
          { binding: 3, resource: this.tex[1].createView() },
          { binding: 4, resource: this.sampler },
          { binding: 5, resource: { buffer: this.springBuf } },
        ],
      });
    }
    const f = new Float32Array(this.drawAB), u = new Uint32Array(this.drawAB);
    f[0] = this.view.dpr; f[1] = Math.max(0.5, p.step); f[2] = Math.max(0, Math.min(1, p.maxDot)); f[3] = Math.max(1e-4, p.half);
    f[4] = H.px; f[5] = H.hw; f[6] = H.hh; f[7] = p.thresh;
    u[8] = this.nSprings || 0; f[9] = Math.max(1e-4, p.sedStep); f[10] = p.sedAlpha; f[11] = p.ringR * this.medium.R;
    f[12] = p.level; f[13] = p.traceDot;
    const put = (o, rgb) => { f[o] = rgb[0] / 255; f[o + 1] = rgb[1] / 255; f[o + 2] = rgb[2] / 255; f[o + 3] = 1; };
    put(16, INKS.reactive.light); put(20, INKS.reactive.heavy); put(24, INKS.linker.light); put(28, INKS.linker.heavy);
    put(32, INKS.fuel.light); put(36, INKS.fuel.heavy); put(40, INKS.sediment.light); put(44, INKS.sediment.heavy);
    put(48, INKS.trace.light);
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(3);
  }

  /** Shift+S: the next view (summary, each substance alone, off); returns its description. */
  cycleShow() {
    const p = this.params;
    p.show = (p.show + 1) % SHOWS.length;
    return this.showText();
  }

  showText() {
    const name = this.showName;
    if (name === 'off') return 'substances not drawn';
    if (name === 'summary') return 'substances: summary (free atoms red to grey dots, fuels green, sediment flat, trace diamonds)';
    const s = SUBSTANCES[CH[name]], amt = this.dish[CH[name]];
    return `${describe(s)} alone${amt > 0 ? '' : ' (none in the dish' + (s.kind === 'fuel' || s.kind === 'sediment' ? ': made by the chemistry of C4)' : ')')}`;
  }

  /** The entropy panel's line. */
  panelLine() {
    const L = this.ledger;
    if (!L) return 'ORDER  …';
    const o = L.order == null ? '–' : L.order.toFixed(3);
    return `ORDER  ${o} · atoms in dish ${fmt(L.dish)} · added ${fmt(L.add)} (+${fmt(L.rateAdd)}/s) · out ${fmt(L.lost + L.gone)} · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(1)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, L = this.ledger;
    const lines = [];
    const sp = this.springs.map((s) => `${s.kind} ${Math.max(0, p.life - s.age).toFixed(0)} s left`).join(', ');
    lines.push(`matter (step C3): shown ${this.showName} (Shift+S) · springs ${this.springs.length}/${p.maxSprings}${sp ? ': ' + sp : ''}` +
      ` · drip ${p.rate} atoms/s for ${p.life} s over ${p.radius} R · edge sink ${p.edge}/s · ${this.nSub} substep(s)` +
      ` · channels moving ${SUBSTANCES.filter((s, c) => this.active & (1 << c)).map((s) => s.name).join(' ') || 'none'}`);
    lines.push('spreading (R²/s, from row and group): ' + SUBSTANCES.map((s) => `${s.name} ${(s.spread * p.spreadGain).toPrecision(2)}`).join(' · '));
    if (L) {
      const el = {};
      for (const a of Object.keys(ATOMS)) el[a] = { add: 0, dish: 0, out: 0 };
      SUBSTANCES.forEach((s, c) => {
        for (const a of s.atoms) { el[a].add += this.tot.add[c]; el[a].dish += this.dish[c]; el[a].out += this.tot.lost[c] + this.tot.gone[c]; }
      });
      lines.push(`atoms ledger: added ${fmt(L.add)} = in dish ${fmt(L.dish)} + lost at the edge ${fmt(L.lost)} + washed / resized ${fmt(L.gone)}` +
        ` · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(2)} · per s +${fmt(L.rateAdd)} −${fmt(L.rateLost)}`);
      lines.push('per element (added / in dish / out): ' + Object.entries(el).filter(([, v]) => v.add > 0)
        .map(([a, v]) => `${a} ${fmt(v.add)} / ${fmt(v.dish)} / ${fmt(v.out)}`).join(' · '));
      lines.push(`order ${L.order == null ? '–' : L.order.toFixed(3)} (entropy ${L.entropy == null ? '–' : L.entropy.toFixed(3)} of the evenly smeared dish)` +
        ` · substances in dish: ` + SUBSTANCES.map((s, c) => (this.dish[c] > 0 ? `${s.name} ${fmt(this.dish[c])}` : null)).filter(Boolean).join(' · '));
    }
    return lines;
  }
}

/** How many pixels' centres lie within r of (cx, cy) (pixel units), inside a w x h grid: the pixels a spring drips on. */
function discPixels(cx, cy, r, w, h) {
  let n = 0;
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) n++;
    }
  }
  return Math.max(1, n);
}

/** A spring's marker ink: its atoms' inks, weighted by its mix. */
export function springInk(kind) {
  const mix = SPRING_KINDS[kind].mix, ink = [0, 0, 0];
  let tot = 0;
  for (const [a, share] of Object.entries(mix)) {
    if (a === 'trace') continue;
    const s = SUBSTANCES[CH[a]];
    for (let j = 0; j < 3; j++) ink[j] += s.ink[j] * share;
    tot += share;
  }
  return ink.map((v) => v / tot);
}
