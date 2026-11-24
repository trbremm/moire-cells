// Step M2: THE MUTATION SWEEP (BUILD QUEUE 6a5b, 2026-11-23; README "Step M2: mutation sweep"). The user asked whether the repeated
// evolutionary null ("the genes drift like the neutral control") comes from too MUCH mutation (fog: every birth nudges every gene), too
// LITTLE (a few hundred cells x a few dozen generations) or the founders' crash (one lineage fills the dish). Genes change ONLY at birth
// (cell_step.wgsl daughter_genome, cell_grn.wgsl for the gene network). This module turns the copying into a knob, and measures:
//
//   SCALE        ?mut=x (moire.mutation.params.scale): every copying error x x: mutate's small steps and every jump's chance, the G0 glue's
//                log steps, the S1 elongation, the S2 motors, the N2 chemotaxis gene, the gene network's nudges, rewiring, output moves and
//                duplication, G2's duplication, deletion and the copies' drift, the fidelity gene's own drift and the self marker's clock.
//                Hard light's extra (step C8) is part of the same scale (x0 = exact copies everywhere, also under hard light). 1 = today
//                exactly (same random draws). ?mut=0 also switches key M off, as before
//   MODES        DRIFT (?mutmode=drift, the default: today's, every gene nudged at every birth) or RARE BIG STEPS (?mutmode=rare): a birth is
//                an EXACT copy, except with chance pRare (?mutp=, 0.1) x the scale x the parent's copying (the fidelity gene's e^-F, + hard
//                light's extra: they scale the CHANCE, not the steps) it changes 1..3 gene GROUPS (cell_common.wgsl MG_*: key, body, engines,
//                membrane, pumps, walls, lipids, field A, field B, gates, channels, kin/engulf, shape, motors, chemotaxis, gene network,
//                duplication, fidelity), each by the BIG step (?mutbig=, 8 x today's small steps and jump chances). The self marker's clock
//                still ticks at every birth (a neutral tag for the lineage view), x the scale
//   GENERATION   Bio.resp.z (a spare word): a daughter's = her parent's + 1; at a division the mother's + 1 too (founders 0)
//   COUNTERS     the heat ledger's step C9 block, rows 13..15 (MTC_*): births, mutated births, gene groups changed
//   CENSUS       every censusEvery s, a read-back of the cells and genomes: the generation (mean, max), the founder LINES alive (and their
//                effective number), the MARKER patches (the self marker binned: effective number), distinct GENOTYPES (exact genomes) and
//                the largest clone, and the tracked genes' means and spreads with their shift from the founders' (the first census).
//                The on-vs-null gap needs two runs (a twin with the neutral controls): tools/m2_analyse.py
//
// The MUTATION panel line, overlay lines, moire.mutation.census / now(), and moire.sample()'s mut.*.

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { readBuffer } from './snapshot.js';

const LG_DIV = 22272;          // heat_common.wgsl: step C9's block, 16 numbers x 16 slots; M2's counters at rows 13..15 (MTC_* in cell_common.wgsl)
const ROW0 = 13;
const CNT = ['births', 'mut', 'groups'];
const MUT_RARE = 1;
const C_FLAGS = 9;
export const W_GEN = 10;       // Bio.resp.z: the generation
// genome words that are STATE, not genes (left out of a genotype): the job scores, the generation and rare mask, the heading, the
// accumulators, the felt and converted words, the network's expression, the cilia's beat phase
const STATE = new Set([8, 9, 10, 11, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 84, 85, 86, 87, 88, 89, 90, 91, 174]);
// the tracked genes (genome word or a function of the genome at word o) and the neutral control that tests each
export const TRACKED = [
  ['glue', 16, 'gluenull'], ['size', 17, null], ['motility', 18, null], ['elongation', 13, 'shapenull'],
  ['flagellum', 168, 'flagellanull'], ['cilia', 171, 'cilianull'], ['ciliaCouple', 172, 'cilianull'], ['chemo', 175, 'chemonull'],
  ['fidelity', 31, 'fidelitynull'], ['engulf', 82, 'engulfnull'], ['kinSpare', 83, 'kinsparenull'], ['kinChan', 80, 'kinnull'],
  ['display', 79, null], ['gateGlue', 68, 'gatenull'], ['gatePump', 69, 'gatenull'], ['gateEngine', 70, 'gatenull'],
  ['gateDiv', 71, 'gatenull'], ['gateTurn', 72, 'gatenull'], ['push', 73, null], ['ionChan', 75, null], ['stretchChan', 55, null],
  ['stretchTol', 74, null], ['stiffness', 42, null], ['thickness', 41, null], ['wall', 52, null], ['tolerance', 35, null],
  ['permeability', 39, null],
  ['copies', (g, o) => (g[o + 158] > 0 ? 1 : 0) + (g[o + 159] > 0 ? 1 : 0), 'dupnull'],
  ['engines', (g, o) => (g[o + 36] > 0 ? 1 : 0) + (g[o + 37] > 0 ? 1 : 0) + (g[o + 38] > 0 ? 1 : 0), null],
  ['grnLinks', (g, o) => { let k = 0; for (let q = 100; q < 124; q++) if (g[o + q] !== 0) k++; return k; }, 'grnnull'],
];

export class Mutation {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.mutation.params). Switches: the rules panel's group "Mutation sweep (step M2)"; URL ?mut= ?mutmode= ?mutp= ?mutbig=
    // ?mutcensus=
    this.params = {
      scale: 1,          // x every copying error (1 = today exactly, 0 = exact copies)
      rare: false,       // RARE BIG STEPS (else DRIFT: today's)
      p: 0.1,            // rare mode: the chance per birth of a mutation (x the scale, the fidelity gene, hard light)
      big: 8,            // rare mode: the step, x today's small steps and jump chances
      censusEvery: 30,   // s of simulated time between the census's read-backs (0: never)
    };
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.rates = null;
    this.census = null;
    this.base = null;    // the founders' census (the first one), for the genes' shifts
    this.series = [];    // per census: [time, cells, generation mean, max, lines, effective lines, marker patches, genotypes]
    this.busy = false;
    this.lastAt = -1e9;
  }

  get bits() { return this.params.rare ? MUT_RARE : 0; }
  get modeName() { return this.params.rare ? 'rare' : 'drift'; }

  /** The step's words in struct Fields (qA.y bits, qA.z scale, qA.w the rare chance; qB.y the rare step). */
  writeFields(u, f) {
    const p = this.params;
    u[1] = this.bits; f[2] = Math.max(0, p.scale); f[3] = Math.max(0, Math.min(1, p.p)); f[5] = Math.max(0, p.big);
  }

  /** The heat ledger's read-back (Int32 words; called by src/eat.js apply): the counters since the last one. */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_DIV + 16 * q + k]; return s; };
    const T = this.tot;
    CNT.forEach((k, j) => { T[k] += v(ROW0 + j); });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 20) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const d = Object.fromEntries(CNT.map((k, j) => [k, H.length ? H[H.length - 1][1 + j] - H[0][1 + j] : 0]));
    this.rates = {
      time: rec.time,
      birthsPerS: dt > 0.05 ? d.births / dt : 0,
      mutShare: d.births ? d.mut / d.births : null,               // births that mutated at all
      groupsPerBirth: d.births ? d.groups / d.births : null,      // gene groups changed per birth (drift: every one, 18)
      births: T.births, mutated: T.mut,
    };
    if (this.census) this.census.rates = this.rates;
  }

  /** Once a frame: start the census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('mutation census:', e); });
  }

  async read(time = this.lastAt) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      ]);
      const c = this.analyse(new Float32Array(bioAB), new Uint32Array(cellAB), n, time);
      if (!this.base || time < this.base.time) { this.base = c; this.series.length = 0; }
      c.shift = {};
      for (const [name] of TRACKED) {
        const a = c.genes[name], b = this.base.genes[name];
        c.shift[name] = a && b && a.mean != null && b.mean != null ? a.mean - b.mean : null;
      }
      c.rates = this.rates;
      this.census = c;
      this.series.push([c.time, c.n, c.gen.mean, c.gen.max, c.lines, c.linesEff, c.marker.eff, c.genotypes]);
      if (this.series.length > 400) this.series.shift();
      return c;
    } finally {
      this.busy = false;
    }
  }
  now() { return this.read(this.lastAt); }

  analyse(g, u, n, time) {
    const CF = CELL_FLOATS, B = BIO_FLOATS;
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * CF + C_FLAGS] & 1) live.push(i);
    const m = live.length;
    // the generation
    let gs = 0, gs2 = 0, gmax = 0;
    const lines = new Map(), marks = new Map(), geno = new Map();
    const lineMark = new Map();
    for (const i of live) {
      const o = i * B, gen = g[o + W_GEN] || 0;
      gs += gen; gs2 += gen * gen; gmax = Math.max(gmax, gen);
      const L = Math.round(g[o + 7]);
      lines.set(L, (lines.get(L) || 0) + 1);
      // the self marker, binned: its angle in 32 bins (0.2 rad), its period's log in 8 (the founders' markers differ far more; the clock's
      // ~0.01 rad a birth shows only within a bin)
      const a = g[o + 76], q = g[o + 77];
      const ka = Math.floor(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * 32);
      const kq = Math.max(0, Math.min(7, Math.floor((q + 2.12) / 1.43 * 8)));
      const mk = ka * 8 + kq;
      marks.set(mk, (marks.get(mk) || 0) + 1);
      if (!lineMark.has(L)) lineMark.set(L, { n: 0, c: 0, s: 0 });
      const LM = lineMark.get(L); LM.n++; LM.c += Math.cos(a); LM.s += Math.sin(a);
      // the genotype: every gene word (state left out), as one key
      let h = '';
      for (let w = 0; w < B; w++) if (!STATE.has(w)) h += g[o + w].toPrecision(7) + ',';
      geno.set(h, (geno.get(h) || 0) + 1);
    }
    const eff = (M) => { let s = 0; for (const k of M.values()) s += (k / m) ** 2; return m ? 1 / s : 0; };
    let clone = 0;
    for (const k of geno.values()) clone = Math.max(clone, k);
    // the clock's spread within each line (circular sd of the marker's angle, rad), cell-weighted
    let ws = 0, wsd = 0;
    for (const LM of lineMark.values()) {
      if (LM.n < 2) continue;
      const R = Math.min(1, Math.hypot(LM.c, LM.s) / LM.n);
      wsd += LM.n * Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-9)))); ws += LM.n;
    }
    const genes = {};
    for (const [name, w] of TRACKED) {
      let s = 0, s2 = 0;
      for (const i of live) { const x = typeof w === 'function' ? w(g, i * B) : g[i * B + w]; s += x; s2 += x * x; }
      genes[name] = { mean: m ? s / m : null, sd: m ? Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2)) : null };
    }
    const topLines = [...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, k]) => ({ id, n: k }));
    return {
      time, n: m, mode: this.modeName, scale: this.params.scale, p: this.params.p, big: this.params.big,
      gen: { mean: m ? gs / m : 0, sd: m ? Math.sqrt(Math.max(0, gs2 / m - (gs / m) ** 2)) : 0, max: gmax },
      lines: lines.size, linesEff: eff(lines), topLine: m && topLines.length ? topLines[0].n / m : 0, topLines,
      marker: { bins: marks.size, eff: eff(marks), clockSd: ws ? wsd / ws : 0 },
      genotypes: geno.size, cloneTop: m ? clone / m : 0, genes,
    };
  }

  /** For moire.sample(): flat numbers (the top lines' list left out). */
  get sample() {
    const C = this.census;
    if (!C) return this.rates ? { rates: this.rates } : null;
    const out = { ...C, topLines: undefined, mode: C.mode === 'rare' ? 1 : 0 };
    return out;
  }

  /** The entropy panel's MUTATION line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, Y = this.rates;
    const mode = p.rare ? `rare p${p.p} ×${p.big}` : 'drift';
    const head = `MUTATION ${mode} · scale ×${p.scale}`;
    if (!C || !C.n) return `${head}  …`;
    const r = Y ? `births ${Y.birthsPerS.toFixed(1)}/s${Y.mutShare != null ? `, ${Math.round(100 * Y.mutShare)}% mutated` : ''}` : 'births -';
    const sg = (x) => (x == null ? '-' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
    if (compact) return `${head} · ${r} · gen ${C.gen.mean.toFixed(1)} (max ${C.gen.max}) · lines ${C.lines} (eff ${C.linesEff.toFixed(1)}) · genotypes ${C.genotypes}`;
    const S = C.shift;
    return `${head}  ${r} · generation ${C.gen.mean.toFixed(1)} (max ${C.gen.max}) · founder lines ${C.lines} (effective ${C.linesEff.toFixed(1)}, top ${Math.round(100 * C.topLine)}%)` +
      ` · marker patches ${C.marker.eff.toFixed(1)} · genotypes ${C.genotypes} (largest clone ${Math.round(100 * C.cloneTop)}%)` +
      ` · shift from founders: glue ${sg(S.glue)} flagellum ${sg(S.flagellum)} cilia ${sg(S.cilia)} chemo ${sg(S.chemo)} fidelity ${sg(S.fidelity)} engulf ${sg(S.engulf)} copies ${sg(S.copies)}`;
  }

  overlayLines() {
    const p = this.params, C = this.census;
    const lines = [`mutation sweep (step M2): ${p.rare ? `RARE BIG STEPS: exact copies, a mutation with chance ${p.p} × scale × fidelity/hard light, 1-3 gene groups by ${p.big}× the small step` : 'DRIFT: every gene nudged at every birth'} · scale ×${p.scale}`];
    if (C && C.n) {
      lines.push(`mutation: ${C.n} cells · generation ${C.gen.mean.toFixed(1)}±${C.gen.sd.toFixed(1)} (max ${C.gen.max}) · founder lines ${C.topLines.map((L) => `#${L.id} ${L.n}`).join(', ')}` +
        ` · marker bins ${C.marker.bins}, clock spread within lines ${C.marker.clockSd.toFixed(3)} rad`);
      const S = this.series.slice(-6);
      if (S.length) lines.push(`mutation every census (cells, gen, max, lines, eff, marker patches, genotypes): ${S.map((x) => `${x[0].toFixed(0)}s ${x[1]} ${x[2].toFixed(1)} ${x[3]} ${x[4]} ${x[5].toFixed(1)} ${x[6].toFixed(1)} ${x[7]}`).join(' · ')}`);
    }
    return lines;
  }
}
