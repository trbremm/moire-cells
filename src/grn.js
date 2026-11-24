// Step T1b: THE GENE REGULATORY NETWORK + THE REPORTER VIEW (BUILD QUEUE 4, 2026-11-17; README "Step T1b: gene network"). The user:
// "our genetics must be stronger, tissue differentiation by contact is too rigid. We need to approximate that with phenotype and genes."
// Same DNA, different jobs: every cell runs a small network of REGULATOR genes whose EXPRESSION levels are its state (inherited by its
// daughters: cell memory). PHENOTYPE = genes x state x surroundings. Cell types are then the network's stable states (attractors), not rules.
//
//   the network   8 regulators, expression x_i in 0..1 (Bio.gx), each reading up to three SOURCES (another regulator or a sense) through
//                 genome weights: x_i <- x_i + dt / tau (sigmoid(b_i + sum_k w_ik src_ik) - x_i), tau ~ 5 s (cell_grn.wgsl)
//   senses        all from what the cell already computes, each 0..1 (the fields and the swelling -1..1): contacts (the share of its sides
//                 pressed against a neighbour), field A felt (the sides' mean) and its spread across the cell (a gradient), field B at the
//                 cell, the light (caustics and the day included), free t (oxygen-like) inside, the battery, the swelling, fuel, free
//                 linkers, trace (the cofactor), the membrane's integrity, the heat (temperature / twice the tolerance), and the CONTACT
//                 SIGNAL: each cell broadcasts one regulator (gene Bio.gm.x) and senses the mean over its touching neighbours' broadcasts,
//                 weighted by kinship (the T1a marker) as far as a gene (Bio.gm.y) says
//   outputs       16, each multiplies an existing gene's base level by exp(u_o x_j) (at most 4; a strongly negative gain switches it
//                 off), j the one regulator it reads: pigment, the three engine slots' rates, the wall wanted, the membrane's thickness and
//                 stiffness gene, glue (a0), the pumps' rates, the ion channels' level, the kin channels' opening, the marker's display,
//                 division readiness, motility, field A's and B's emission. ENGINE UPKEEP FOLLOWS THE EXPRESSED RATE (and so does the
//                 pigment a harvest slot builds), so a cell can switch engines off where they do not pay (M1's dark-vents economy)
//   mutation      at every birth (key M; hard light adds): weights, biases and output gains in use nudged; sometimes an input REWIRED (or
//                 cut), an output pointed at another regulator (or switched on or off), the broadcast regulator changed; rarely a regulator
//                 DUPLICATED into the least used slot (gene families)
//   founders      std and blank: no network (every weight and gain 0: they behave exactly as before, x = 0.5); wild (?founders=wild, group
//                 'grn'): random sparse wiring
//   null          the NEUTRAL control (?grnnull=1): the network runs and mutates, its outputs have no effect
//   reporter      the view 'reporter' (key V; ?view=reporter, ?reporter=i): like a GFP reporter, cells glow by one regulator's expression
//                 (neon: green; harmonic: an extra red fluorescence channel, a nucleus-like spot)
//   census        every censusEvery s of simulated time the genomes and cells are read back: CELL TYPES = the expression patterns (each
//                 output-driving regulator low < 0.35 / mid / high > 0.65) held by at least 3 % (and 5 cells) of a lineage (founder id);
//                 per type its share, where it sits (sides pressed, light, fuel, battery), and which outputs differ between a lineage's types
//
// Layout: Bio words 84..155 (struct Bio gx, gb, gw, gi, gu, go, gm in cell_common.wgsl); Cell.sns0, sns1 (words 86, 87, the senses the eat
// pass hands over); Fields t1.z (bits) and t1.w (field B's sense scale); EatP t1[1].z (bits); Draw grn, grnInk, grnInkH.

import { readBuffer } from './snapshot.js';
import { BIO_FLOATS, BIO_GRN } from './genome.js';

export const GRN_R = 8;
export const OUTPUTS = ['pigment', 'engine 1', 'engine 2', 'engine 3', 'wall', 'thickness', 'stiffness', 'glue', 'pumps', 'channels',
  'kin channels', 'display', 'division', 'motility', 'emit A', 'emit B', 'engulf', 'shape', 'flagellum', 'cilia', 'release water', 'release junctions'];   // (step Q1: + the releases, in so)   // (step S2: + flagellum, cilia, in mg)   // (step P1: + engulf, its gain and regulator in gm.z, gm.w;
                                                                                              //  step S1: + shape, the elongation gene's, in relay.z, relay.w)
const NOUT = OUTPUTS.length;
export const SENSES = ['contact', 'field A', 'A spread', 'field B', 'light', 'free t', 'battery', 'swelling', 'fuel', 'linkers', 'trace',
  'integrity', 'signal', 'heat', 'meal', 'prey', 'heard water', 'heard junctions'];   // (step Q1: + the signal heard)   // (step P1: + a meal inside, prey near)
const GF = { RUN: 1, SIGNAL: 2, KINW: 4, MUT: 8 };
const GRN_ACT = 1;
// the Bio words (genome.js BIO_GRN = 84)
const W_X = 0, W_B = 8, W_W = 16, W_I = 40, W_U = 48, W_O = 64, W_M = 68;
import { CELL_FLOATS } from './cells.js';
const C_POS = 0, C_FLAGS = 9, C_BAT = 16, C_NBR = 60, C_FELT1 = 83, C_SNS0 = 86, C_SNS1 = 87;
const UNIFORM_BYTES = 208;   // (step Q1: + q1, words 48..51, 192 until then; step G3: + the moire genome's words 12..47, 48 until then)

/** The network's numbers from genome g at word o (o = cell x BIO_FLOATS): { x, bias, w, code, u, reg, bc, kw }. */
export function grnOf(g, o = 0) {
  const b = o + BIO_GRN;
  const x = [], bias = [], w = [], code = [], u = [], reg = [];
  for (let r = 0; r < GRN_R; r++) {
    x.push(g[b + W_X + r]); bias.push(g[b + W_B + r]);
    const cw = Math.max(0, Math.round(g[b + W_I + r]));
    for (let k = 0; k < 3; k++) { w.push(g[b + W_W + 3 * r + k]); code.push((cw >> (5 * k)) & 31); }
  }
  for (let q = 0; q < 16; q++) {
    u.push(g[b + W_U + q]);
    reg.push((Math.max(0, Math.round(g[b + W_O + (q >> 2)])) >> (3 * (q & 3))) & 7);
  }
  u.push(g[b + W_M + 2]); reg.push(Math.max(0, Math.min(7, Math.round(g[b + W_M + 3]) || 0)));   // (step P1: the 17th output, ENGULF)
  u.push(g[o + 14] || 0); reg.push(Math.max(0, Math.min(7, Math.round(g[o + 15]) || 0)));        // (step S1: the 18th, SHAPE, in relay.z, relay.w)
  for (const w of [176, 178]) { u.push(g[o + w] || 0); reg.push(Math.max(0, Math.min(7, Math.round(g[o + w + 1]) || 0))); }   // (step S2: FLAGELLUM, CILIA, in mg)
  for (const w of [232, 234]) { u.push(g[o + w] || 0); reg.push(Math.max(0, Math.min(7, Math.round(g[o + w + 1]) || 0))); }   // (step Q1: the RELEASES, in so)
  return { x, bias, w, code, u, reg, bc: Math.round(g[b + W_M]) & 7, kw: g[b + W_M + 1] };
}
/**
 * Step T1b's census: cluster cells (each { x: expression[8] }) over the regulators `regs` into cell types: k-means (k-means++ seeding from a
 * fixed stream, 25 rounds) for k = 2..6, keeping the largest k whose clusters each hold at least minN cells and whose centres all differ by
 * at least 0.25 in some regulator (else one type). Returns each cell's type (0..k-1).
 */
export function clusterTypes(cells, regs, minN) {
  const n = cells.length, d = regs.length;
  let best = new Array(n).fill(0);
  if (!d || n < 2 * minN) return best;
  const v = cells.map((c) => regs.map((r) => c.x[r]));
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const dist2 = (a, b) => { let t = 0; for (let k = 0; k < d; k++) { const e = a[k] - b[k]; t += e * e; } return t; };
  for (let k = 2; k <= 6; k++) {
    const cen = [v[Math.floor(rnd() * n)].slice()];
    const dm = v.map((p) => dist2(p, cen[0]));
    while (cen.length < k) {
      const tot = dm.reduce((a, b) => a + b, 0);
      if (!(tot > 0)) break;
      let r = rnd() * tot, j = 0;
      while (j < n - 1 && (r -= dm[j]) > 0) j++;
      cen.push(v[j].slice());
      v.forEach((p, i) => { dm[i] = Math.min(dm[i], dist2(p, cen[cen.length - 1])); });
    }
    if (cen.length < k) break;
    const lab = new Array(n).fill(0);
    for (let it = 0; it < 25; it++) {
      let moved = false;
      v.forEach((p, i) => {
        let bj = 0, bd = Infinity;
        cen.forEach((c, j) => { const e = dist2(p, c); if (e < bd) { bd = e; bj = j; } });
        if (lab[i] !== bj) { lab[i] = bj; moved = true; }
      });
      const sum = cen.map(() => new Array(d).fill(0)), cnt = new Array(k).fill(0);
      v.forEach((p, i) => { cnt[lab[i]]++; for (let q = 0; q < d; q++) sum[lab[i]][q] += p[q]; });
      cen.forEach((c, j) => { if (cnt[j]) for (let q = 0; q < d; q++) c[q] = sum[j][q] / cnt[j]; });
      if (!moved && it > 0) break;
    }
    const cnt = new Array(k).fill(0);
    lab.forEach((j) => cnt[j]++);
    if (cnt.some((c) => c < minN)) continue;
    let ok = true;
    for (let a = 0; a < k && ok; a++) for (let b = a + 1; b < k && ok; b++) {
      let m = 0;
      for (let q = 0; q < d; q++) m = Math.max(m, Math.abs(cen[a][q] - cen[b][q]));
      if (m < 0.25) ok = false;
    }
    if (ok) best = lab;
  }
  return best;
}

/** A source code as words: 'none', 'r3', or a sense's name. */
export function sourceName(c) { return c === 0 ? 'none' : c <= GRN_R ? `r${c - 1}` : c - 9 < SENSES.length ? SENSES[c - 9] : 'none'; }

export class Grn {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.grn.params). Switches: the rules panel's group "Gene network (step T1b)"; URL ?grn=0, ?grnnull=1, ?grnsignal=0,
    // ?grnkin=0, ?grnmut=0, ?grntau=, ?reporter=
    this.params = {
      on: true,          // the network runs: expression updates, mutation at births, outputs act (off: frozen, no effect)
      null: false,       // the NEUTRAL control: the network runs and mutates, its outputs have no effect
      signal: true,      // the contact signal (neighbours' broadcast regulator) is sensed
      kinWeight: true,   // ... weighted by kinship as far as the gene says (off: every neighbour alike)
      mutate: true,      // the network mutates at births (with key M)
      tau: 5,            // the expression's time constant (s)
      wStep: 0.1,        // a birth's nudge of a weight or bias in use (x the mutation size)
      uStep: 0.08,       // ... of an output gain in use
      rewire: 0.05,      // chance per birth: one input rewired (or cut)
      orewire: 0.03,     // ... one output pointed at another regulator, switched on or off
      dup: 0.005,        // ... one regulator duplicated into the least used slot
      bjump: 0.02,       // ... the broadcast regulator changes
      wNew: 3,           // a new link's weight from -wNew..wNew
      uNew: 3,           // a new output's gain from -uNew..uNew
      bRef: 3,           // field B's sense: tanh(sensing gene x B x bRef)
      censusEvery: 15,   // s of simulated time between the census's read-backs (0: never)
    };
    // the look (moire.grn.look; drawing only)
    this.look = {
      reporter: 0,       // the regulator the reporter view shows (0..7)
      fill: 0.4,         // the reporter view's body fill at full expression (neon)
      harm: 1.1,         // the harmonic look's reporter channel (a nucleus-like spot), at full expression
      ink: [70, 255, 120],      // neon: GFP-like green
      inkH: [255, 60, 110],     // harmonic: an mCherry-like red (green is the membranes' channel there)
    };
    this.census = null;
    this.series = [];    // every census: [time, types, lineages, links per regulator, outputs per cell, reporter mean, diff]
    this.busy = false;
    this.lastAt = -1e9;
    this.uniform = null;
    this.bgs = null;
  }

  /** Whether the outputs act (the network on and not the neutral control). */
  get acts() { return !!(this.params.on && !this.params.null); }
  get flags() {
    const p = this.params;
    return (p.on ? GF.RUN : 0) | (p.signal ? GF.SIGNAL : 0) | (p.kinWeight ? GF.KINW : 0) | (p.mutate ? GF.MUT : 0);
  }

  /** The step's words (struct Fields t1.z, t1.w, from word o). */
  writeFields(u, f, o) { u[o] = this.acts ? GRN_ACT : 0; f[o + 1] = Math.max(0, this.params.bRef); }
  /** The eat pass's word (EatP t1[1].z). */
  writeEat(u, o) { u[o] = this.acts ? GRN_ACT : 0; }
  /** The drawing's words (struct Draw grn, grnInk, grnInkH, from word o). */
  writeDraw(a, o, L) {
    const K = this.look;
    a[o] = L.view === 7 ? 1 : 0; a[o + 1] = Math.max(0, Math.min(7, Math.round(K.reporter))); a[o + 2] = Math.max(0, K.fill); a[o + 3] = Math.max(0, K.harm);
    for (let k = 0; k < 3; k++) { a[o + 4 + k] = K.ink[k] / 255; a[o + 8 + k] = K.inkH[k] / 255; }
    a[o + 7] = 1; a[o + 11] = 1;
  }

  /** The tick's dispatch (after the step, which flipped bioCur: bioBuf[bioCur] is this tick's genome copy), Sim slot t. */
  encodeTick(encoder, t, slot) {
    const C = this.cells, d = C.device, Q = C.signals;
    const sig = !!(Q && Q.on && Q.active && C.pipes.signal);   // step Q1: the signal's dispatch (hearing, the inboxes, its genes' mutation)
    if ((!this.params.on && !sig) || !C.pipes.grn) return;
    if (!this.uniform) this.uniform = d.createBuffer({ label: 'grn params', size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const H = C.heat;
    if (!this.bgs || this.bgKey !== C.cellBuf || this.bgBio !== C.bioBuf[0] || this.bgHeat !== H.version) {
      this.bgKey = C.cellBuf; this.bgBio = C.bioBuf[0]; this.bgHeat = H.version;
      const b = (binding, buffer, size) => ({ binding, resource: size ? { buffer, size } : { buffer } });
      this.bgs = [0, 1].map((k) => d.createBindGroup({
        label: 'cell grn', layout: C.grnL.bgl,
        entries: [b(0, C.simBuf, 256), b(1, C.cellBuf), b(2, C.bioBuf[k]), b(3, C.bioBuf[1 - k]), b(4, this.uniform), b(5, C.fieldsBuf),
          b(6, H.buffer), b(7, Q.qBuf)],   // (step Q1: the heat buffer, the signal's words)
      }));
    }
    if (t === 0) { this.writeUniform(); if (Q) Q.writeQ(); }
    const pass = encoder.beginComputePass({ label: 'cell grn' });
    pass.setBindGroup(0, this.bgs[C.bioCur], [t * slot]);
    if (sig) { pass.setPipeline(C.pipes.signal); pass.dispatchWorkgroups(Math.ceil(C.count / 64)); }
    if (this.params.on) { pass.setPipeline(C.pipes.grn); pass.dispatchWorkgroups(Math.ceil(C.count / 64)); }
    pass.end();
  }

  writeUniform() {
    const p = this.params, ab = new ArrayBuffer(UNIFORM_BYTES), u = new Uint32Array(ab), f = new Float32Array(ab);
    u[0] = this.flags; f[1] = Math.max(0.05, p.tau); f[2] = Math.max(0.5, this.cells.kin ? this.cells.kin.params.press : 1.1);
    f[3] = Math.max(0, p.wStep); f[4] = Math.max(0, p.uStep); f[5] = Math.max(0, p.rewire); f[6] = Math.max(0, p.orewire);
    f[7] = Math.max(0, p.dup); f[8] = Math.max(0, p.bjump); f[9] = Math.max(0, p.wNew); f[10] = Math.max(0, p.uNew); f[11] = 0;
    if (this.cells.folding) this.cells.folding.writeGrn(u, f, 12);   // step G3: the moire genome (GrnP g3f..)
    if (this.cells.signals) this.cells.signals.writeGrn(u, f, 48);   // step Q1: the signal's senses and outputs, fast regulators (GrnP q1)
    this.cells.device.queue.writeBuffer(this.uniform, 0, ab);
  }

  /** Once a frame (main loop): start the census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('grn census:', e); });
  }

  /** Read the cells and genomes back and work out the census (also moire.grn.typesNow()). */
  async read(time = null) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      ]);
      this.census = this.analyse(new Float32Array(bioAB), new Float32Array(cellAB), new Uint32Array(cellAB), n, time ?? this.lastAt);
      const S = this.series, last = S[S.length - 1], c = this.census;
      if (last && c.time < last[0]) S.length = 0;
      S.push([c.time, c.types, c.lineageN, c.net.links, c.net.outputs, c.reporter.mean, c.diff]);
      if (S.length > 400) S.shift();
      return this.census;
    } finally {
      this.busy = false;
    }
  }
  /** The census now (a fresh read-back; for the console and the experiments' evals). */
  typesNow() { return this.read(this.lastAt); }

  analyse(g, f, u, n, time) {
    const rep = Math.max(0, Math.min(7, Math.round(this.look.reporter)));
    const springs = (this.matter && this.matter.springs) || [];
    const R = this.cells.R || 9;
    const lin = new Map();   // founder id -> { n, cells: [...] }
    let live = 0, links = 0, outs = 0, wired = 0, repS = 0, repS2 = 0, repHi = 0, repLo = 0;
    const sense = new Array(9).fill(0);
    const facS = new Array(NOUT).fill(0);
    const effG = Array.from({ length: GRN_R }, () => [0, 0, 0]);   // per regulator, over the cells where it drives an output: n, sum, sum of squares
    const fidOf = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (u[i * CELL_FLOATS + C_FLAGS] & 1) fidOf[i] = Math.round(g[i * BIO_FLOATS + 7]);
    let pairs = 0, cross = 0;
    for (let i = 0; i < n; i++) {
      const oc = i * CELL_FLOATS;
      if (!(u[oc + C_FLAGS] & 1)) continue;
      live++;
      const ob = i * BIO_FLOATS, G = grnOf(g, ob);
      // the network in use: inputs with a source and a weight, outputs with a gain
      let li = 0, lo = 0;
      for (let q = 0; q < 24; q++) if (G.code[q] > 0 && G.code[q] < 25 && Math.abs(G.w[q]) > 0.05) li++;
      const fac = new Array(NOUT), eff = new Set();
      for (let q = 0; q < NOUT; q++) {
        fac[q] = Math.min(Math.exp(Math.max(-8, Math.min(8, G.u[q])) * Math.max(0, Math.min(1, G.x[G.reg[q]]))), 4);
        facS[q] += fac[q];
        if (Math.abs(G.u[q]) > 0.05) lo++;
        if (Math.abs(G.u[q]) >= 0.5) eff.add(G.reg[q]);
      }
      links += li; outs += lo; if (li + lo > 0) wired++;
      const xr = G.x[rep];
      repS += xr; repS2 += xr * xr; if (xr > 0.65) repHi++; if (xr < 0.35) repLo++;
      // where it sits: its sides pressed (the step's neighbour list), the light, fuel, battery, distance to the nearest spring
      let nb = 0, other = 0;
      for (let w = 0; w < 3; w++) {
        for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
          if (j === 0xffff || j >= n || fidOf[j] < 0) continue;
          nb++; pairs++;
          if (fidOf[j] !== fidOf[i]) { other++; cross++; }
        }
      }
      const s0 = u[oc + C_SNS0], s1 = u[oc + C_SNS1];
      const light = (s0 & 255) / 255, tIn = ((s0 >>> 8) & 255) / 255, fuel = ((s0 >>> 16) & 255) / 255, link = (s0 >>> 24) / 255;
      const trace = (s1 & 255) / 255, heat = ((s1 >>> 8) & 255) / 255;
      sense[0] += light; sense[1] += tIn; sense[2] += fuel; sense[3] += link; sense[4] += trace; sense[5] += heat;
      const fb = ((u[oc + C_FELT1] >>> 16) & 255), fbv = Math.max(-1, ((fb << 24) >> 24) / 127);   // (field B felt: byte 2, snorm)
      sense[6] += Math.abs(fbv); sense[7] += nb / 6; sense[8] += fbv * fbv;
      const x = f[oc + C_POS], y = f[oc + C_POS + 1];
      let dS = Infinity;
      for (const s of springs) dS = Math.min(dS, Math.hypot(s.x - x, s.y - y));
      const fid = Math.round(g[ob + 7]);
      let L = lin.get(fid);
      if (!L) { L = { id: fid, n: 0, border: 0, cells: [], effN: new Array(GRN_R).fill(0), effX: new Array(GRN_R).fill(null).map(() => [0, 0, 0]) }; lin.set(fid, L); }
      L.n++;
      if (other) L.border++;
      for (const r of eff) {
        L.effN[r]++;
        const e = L.effX[r]; e[0]++; e[1] += G.x[r]; e[2] += G.x[r] * G.x[r];
        const h = effG[r]; h[0]++; h[1] += G.x[r]; h[2] += G.x[r] * G.x[r];
      }
      L.cells.push({ i, x: G.x, fac, contact: nb / 6, light, fuel, bat: f[oc + C_BAT], spring: Number.isFinite(dS) ? dS / R : null, border: other ? 1 : 0 });
    }
    // the CELL TYPES of each lineage (20 cells and more): clusters of its cells' expression over the regulators that drive an output in at
    // least half of them (k-means, k = 1..6: the largest k whose clusters each hold at least 3 % of the lineage and 5 cells, and whose centres
    // all differ by at least 0.25 in some regulator)
    const lineages = [];
    let types = 0, diffS = 0, diffN = 0;
    for (const L of [...lin.values()].sort((a, b) => b.n - a.n)) {
      if (L.n < 20) continue;
      const regs = [];
      for (let r = 0; r < GRN_R; r++) if (L.effN[r] >= 0.5 * L.n) regs.push(r);
      const label = clusterTypes(L.cells, regs, Math.max(5, 0.03 * L.n));
      const k = Math.max(...label) + 1;
      const ts = Array.from({ length: k }, () => ({ n: 0, contact: 0, light: 0, fuel: 0, bat: 0, spring: 0, springN: 0, border: 0, fac: new Array(NOUT).fill(0), x: new Array(GRN_R).fill(0) }));
      L.cells.forEach((c, j) => {
        const T = ts[label[j]];
        T.n++; T.contact += c.contact; T.light += c.light; T.fuel += c.fuel; T.bat += c.bat; T.border += c.border;
        if (c.spring != null) { T.spring += c.spring; T.springN++; }
        for (let q = 0; q < NOUT; q++) T.fac[q] += c.fac[q];
        for (let r = 0; r < GRN_R; r++) T.x[r] += c.x[r];
      });
      const tl = ts.filter((T) => T.n > 0).map((T) => {
        const m = T.n, xm = T.x.map((v) => v / m);
        let key = '';
        for (let r = 0; r < GRN_R; r++) key += regs.includes(r) ? (xm[r] < 0.35 ? 'L' : xm[r] > 0.65 ? 'H' : 'm') : '-';
        return { key, n: m, share: m / L.n, contact: T.contact / m, light: T.light / m, fuel: T.fuel / m, bat: T.bat / m, border: T.border / m,
          spring: T.springN ? T.spring / T.springN : null, fac: T.fac.map((v) => v / m), x: xm };
      }).sort((a, b) => b.n - a.n);
      types += tl.length;
      // do a type's cells sit together (patches, layers) or mixed (salt and pepper)? Of the lineage's touching pairs, the share of the same type,
      // against chance (the sum of the shares squared)
      const typeOf = new Map(L.cells.map((c, j) => [c.i, label[j]]));
      let same = 0, tot = 0;
      for (const c of L.cells) {
        const oc = c.i * CELL_FLOATS;
        for (let w = 0; w < 3; w++) {
          for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
            const tj = typeOf.get(j);
            if (tj == null) continue;
            tot++; if (tj === typeOf.get(c.i)) same++;
          }
        }
      }
      const cnt = new Array(k).fill(0);
      label.forEach((j) => cnt[j]++);
      const chance = cnt.reduce((a, b) => a + (b / L.n) ** 2, 0);
      // how far the output-driving regulators spread within the lineage (sd), the differentiation index
      let dS = 0, dN = 0;
      L.effX.forEach((e) => { if (e[0] >= 5) { const mu = e[1] / e[0]; dS += Math.sqrt(Math.max(0, e[2] / e[0] - mu * mu)); dN++; } });
      const diff = dN ? dS / dN : 0;
      if (dN) { diffS += diff; diffN++; }
      // which outputs differ between its types (the largest over the smallest mean factor, at least x 1.5)
      const differ = [];
      if (tl.length > 1) {
        for (let q = 0; q < NOUT; q++) {
          const v = tl.map((T) => T.fac[q]), hi = Math.max(...v), lo = Math.max(1e-3, Math.min(...v));
          if (hi / lo >= 1.5) differ.push({ out: OUTPUTS[q], ratio: hi / lo });
        }
        differ.sort((a, b) => b.ratio - a.ratio);
      }
      lineages.push({ id: L.id, n: L.n, types: tl.length, regs: regs.length, diff, border: L.border / L.n, together: tot ? same / tot : null, chance,
        differ: differ.slice(0, 6), top: tl.slice(0, 6) });
    }
    const m = Math.max(1, live), mu = repS / m;
    // the regulator that differs most between cells (the largest sd where it drives an output, in at least 5 % of the cells): the reporter
    // worth looking at
    let best = null, bestSd = 0;
    effG.forEach((h, r) => {
      if (h[0] < Math.max(5, 0.05 * live)) return;
      const mm = h[1] / h[0], sd = Math.sqrt(Math.max(0, h[2] / h[0] - mm * mm));
      if (sd > bestSd) { bestSd = sd; best = r; }
    });
    return {
      time, n: live, types, lineageN: lineages.length, diff: diffN ? diffS / diffN : 0,
      border: pairs ? cross / pairs : 0,   // the share of touching pairs (each side listed) between two lineages
      net: { links: links / m / GRN_R, outputs: outs / m, wired: wired / m },
      reporter: { r: rep, mean: mu, sd: Math.sqrt(Math.max(0, repS2 / m - mu * mu)), hi: repHi / m, lo: repLo / m, best, bestSd },
      senses: { light: sense[0] / m, t: sense[1] / m, fuel: sense[2] / m, linkers: sense[3] / m, trace: sense[4] / m, heat: sense[5] / m,
        fieldB: sense[6] / m, fieldBrms: Math.sqrt(sense[8] / m), contact: sense[7] / m },
      factors: Object.fromEntries(OUTPUTS.map((k, q) => [k, facS[q] / m])),
      lineages: lineages.slice(0, 8),
    };
  }

  /** The entropy panel's GENES line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census;
    const state = !p.on ? ' (off)' : p.null ? ' · NULL' : '';
    if (!C || !C.n) return `GENES${state}  …`;
    const L = C.lineages, per = L.slice(0, 5).map((l) => l.types).join('/');
    const r = C.reporter, pc = (x) => `${Math.round(100 * x)}%`;
    if (compact) return `GENES types ${C.types} (${C.lineageN} lineages ${per}) · reporter r${r.r} ${r.mean.toFixed(2)}${state}`;
    const dif = L.length && L[0].differ.length ? ` · ${L[0].differ.slice(0, 3).map((d) => `${d.out} ×${d.ratio.toFixed(1)}`).join(', ')}` : '';
    return `GENES${state}  cell types ${C.types} in ${C.lineageN} lineages (${per}) · spread ${C.diff.toFixed(2)}${dif} · border ${pc(C.border)}` +
      ` · wiring ${C.net.links.toFixed(2)} inputs/regulator, ${C.net.outputs.toFixed(1)} outputs/cell (wired ${pc(C.net.wired)})` +
      ` · reporter r${r.r} ${r.mean.toFixed(2)}±${r.sd.toFixed(2)} (on ${pc(r.hi)}, off ${pc(r.lo)})`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`gene network (step T1b): ${on(p.on)}${p.null ? ' · NEUTRAL CONTROL (outputs without effect)' : ''} · contact signal ${on(p.signal)} (kin-weighted ${on(p.kinWeight)})` +
      ` · mutation ${on(p.mutate)} (w ${p.wStep}, u ${p.uStep}, rewire ${p.rewire}, outputs ${p.orewire}, duplicate ${p.dup}, broadcast ${p.bjump}) · tau ${p.tau} s · reporter r${this.look.reporter}`];
    if (C && C.n) {
      const f2 = (x) => (x == null ? '-' : x.toFixed(2));
      lines.push(`genes: senses (means) ${Object.entries(C.senses).map(([k, v]) => `${k} ${f2(v)}`).join(' ')} · output factors ${Object.entries(C.factors).map(([k, v]) => `${k} ${f2(v)}`).join(' ')}`);
      for (const l of C.lineages.slice(0, 4)) {
        lines.push(`lineage ${l.id}: ${l.n} cells, ${l.types} types (spread ${f2(l.diff)}): ${l.top.map((t) => `${t.key} ${Math.round(100 * t.share)}% (sides ${f2(t.contact)}, light ${f2(t.light)}, fuel ${f2(t.fuel)}, bat ${f2(t.bat)})`).join(' | ')}` +
          (l.differ.length ? ` · differ: ${l.differ.map((d) => `${d.out} ×${d.ratio.toFixed(1)}`).join(', ')}` : ''));
      }
    }
    return lines;
  }
}
