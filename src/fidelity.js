// Step G1: ERROR CORRECTION (BUILD QUEUE 6b, 2026-11-17; README "Step G1: error correction"). The user: "yes" to a FIDELITY gene, as
// proofreading: higher fidelity = fewer copying errors at each birth, paid for with battery. Every piece its own switch (the rules panel's
// group "Error correction (step G1)", URL options); no rule says who should copy carefully:
//
//   THE GENE       Bio.conv.w (genome word 31; a spare word among the state words, so the record does not grow; old genomes and snapshots hold 0
//                  there = the founders' value): F, a LOG FACTOR, -2..3. A birth's copying errors are x m = e^-F: every gene's small steps
//                  (mutate, cell_common.wgsl) and every jump's chance (engine and pump slots, the big jumps), the gene network's nudges,
//                  rewiring, output moves and duplication (cell_grn.wgsl), and the SELF MARKER's clock (T1a), so careful lineages keep their
//                  kinship readable longer. Founders 0: m = 1, today's mutation exactly
//   HARD LIGHT     its extra mutation (step C8: x (1 + gain x dose)) is damage to the template, not only a copying error: a share `beyond`
//                  (0.5) of it is beyond proofreading (acts as it is), the rest is caught like any copying error (x m). So a careful lineage
//                  under the spotlight still mutates more than in the shade, but less than a sloppy one: repair may evolve against hard light
//   ITS OWN DRIFT  F drifts at each birth by FID_STEP (0.08) x today's mutation size (key M, and hard light's extra), NOT reduced by itself:
//                  a careful lineage can still lose its care, and the neutral control drifts exactly alike
//   COST           at each birth (turnover or division) the PARENT pays cost x (e^F - 1) energy units from her battery, as heat where she is
//                  (cell_eat.wgsl split), for F above 0; the founders' care and sloppier cost nothing extra (today's copying is the cheapest
//                  there is; a sloppy lineage saves nothing, it only mutates more). cost 0.1: F = 1 costs 0.17 a birth, 2 costs 0.64, 3 costs
//                  1.9 (a division itself costs 0.4, the battery holds 4). A parent with too little pays what she has (the copy is proofread
//                  anyway: counted as 'short')
//   CONTROLS       ?fidelity=0 off (the gene frozen, no effect, no cost: today's mutation); ?fidelitynull=1 the NEUTRAL control (the gene
//                  drifts as when on, no effect, no cost)
//
// This module: the switches and knobs (moire.fidelity.params), the step's words (Fields.hm.z, hm.w), the eat pass's (EatP.dv.z, dv.w), the
// counters (the heat ledger's step C9 block, LG_DIV 1..6: births, their mutation scale, proofreading's cost), a CENSUS every censusEvery s
// (a read-back of the cells and genomes: the gene's mean and spread, carriers above and below the founders, in the light and the shade, in
// tissue interiors and loners, the self marker's match at contacts within a lineage by the pair's care, by lineage), the FIDELITY panel
// line and overlay lines.

import { fmt, HEAT_SCALE } from './heat.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { readBuffer } from './snapshot.js';

const LG_DIV = 22272;          // heat_common.wgsl: step C9's block, 16 numbers x 16 slots; G1's counters at 1..6 (FDC_* in cell_common.wgsl)
const FID = { ACT: 1, DRIFT: 2 };
export const FID_LO = -2, FID_HI = 3;
export const W_FID = 31;       // the gene's genome word (Bio.conv.w)
const CNT = ['births', 'ms', 'ms0', 'cost', 'paid', 'short'];
const C_POS = 0, C_R = 4, C_FLAGS = 9, C_NBR = 60, C_SNS0 = 86;
const DOSE_SHIFT = 19, DOSE_SCALE = 16;

export class Fidelity {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.fidelity.params). Switches: the rules panel's group "Error correction (step G1)"; URL ?fidelity=0, ?fidelitynull=1,
    // ?fidcost=, ?fidbeyond=, ?fidcensus=
    this.params = {
      on: true,          // the gene acts (scales the copying errors, costs battery) and drifts
      null: false,       // the NEUTRAL control: the gene drifts as when on, no effect, no cost (?fidelitynull=1)
      cost: 0.1,         // energy units a birth costs the parent at e^F - 1 = 1 (F = 0.69), as heat
      beyond: 0.5,       // the share of hard light's extra mutation that proofreading cannot catch (0: all caught, 1: none)
      censusEvery: 15,   // s of simulated time between the census's read-backs (0: never)
      lit: 0.25,         // the census: a cell is 'in the light' when its light sense (Cell.sns0.x) is at least this
    };
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.copy = null;    // the counters' rates (births, mutation per birth, cost per s)
    this.census = null;
    this.series = [];    // per census: [time, cells, mean F, sd, share above, share below, kin match within lineages]
    this.busy = false;
    this.lastAt = -1e9;
  }

  get bits() {
    const p = this.params;
    return (p.on && !p.null ? FID.ACT : 0) | (p.on || p.null ? FID.DRIFT : 0);
  }
  get acts() { return (this.bits & FID.ACT) !== 0; }

  /** The step's words (struct Fields hm.z, hm.w: word o is hm.z). Call after src/hardlight.js wrote hm. */
  writeFields(u, f, o) {
    u[o] = this.bits; f[o + 1] = Math.max(0, Math.min(1, this.params.beyond));
  }
  /** The eat pass's words (struct EatP dv.z, dv.w: word o is dv.z): proofreading's cost (heat counts at e^F - 1 = 1), the bits. */
  writeEat(u, o) {
    u[o] = this.acts ? Math.max(0, Math.round(this.params.cost * HEAT_SCALE)) : 0; u[o + 1] = this.bits;
  }

  /** The heat ledger's read-back (Int32 words; called by src/eat.js apply): the counters since the last one. */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_DIV + 16 * q + k]; return s; };
    const T = this.tot;
    CNT.forEach((k, j) => { T[k] += v(1 + j); });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 10) H.shift();   // over the last 10 s (births are few per frame)
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const d = Object.fromEntries(CNT.map((k, j) => [k, H.length ? H[H.length - 1][1 + j] - H[0][1 + j] : 0]));
    this.copy = {
      time: rec.time,
      birthsPerS: dt > 0.05 ? d.births / dt : 0,
      // the mutation scale per birth (1 = today's copying: key M on, no hard light), after proofreading, and what it would have been at the
      // founders' care; their ratio is what the dish's proofreading saves
      perBirth: d.births ? d.ms / 1000 / d.births : null,
      perBirth0: d.births ? d.ms0 / 1000 / d.births : null,
      ratio: d.ms0 > 0 ? d.ms / d.ms0 : null,
      costPerS: dt > 0.05 ? d.cost / HEAT_SCALE / dt : 0,                 // energy units per s proofreading took (to heat)
      costPerBirth: d.births ? d.cost / HEAT_SCALE / d.births : 0,
      paidShare: d.births ? d.paid / d.births : 0,                        // births whose parent paid anything
      shortPerS: dt > 0.05 ? d.short / HEAT_SCALE / dt : 0,               // asked but not there (empty batteries)
      costTot: T.cost / HEAT_SCALE, births: T.births,
    };
    if (this.census) this.census.copy = this.copy;
  }

  /** Once a frame (before the frame's ticks are encoded): start the census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('fidelity census:', e); });
  }

  /** Read the cells and genomes back and work out the census (also moire.fidelity.now()). */
  async read(time = this.lastAt) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      ]);
      const c = this.analyse(new Float32Array(bioAB), new Float32Array(cellAB), new Uint32Array(cellAB), n, time);
      c.copy = this.copy;
      this.census = c;
      const S = this.series, last = S[S.length - 1];
      if (last && c.time < last[0]) S.length = 0;
      if (c.n) S.push([c.time, c.n, c.mean, c.sd, c.above, c.below, c.kin.same.pairs ? c.kin.same.match : null]);
      if (S.length > 400) S.shift();
      return c;
    } finally {
      this.busy = false;
    }
  }
  /** The census now (a fresh read-back; for the console and the experiments' evals). */
  now() { return this.read(this.lastAt); }

  analyse(g, f, u, n, time) {
    const CF = CELL_FLOATS, B = BIO_FLOATS, R = this.cells.R, P = this.params;
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * CF + C_FLAGS] & 1) live.push(i);
    const F = (i) => Math.max(FID_LO, Math.min(FID_HI, g[i * B + W_FID] || 0));
    const acc = () => ({ n: 0, s: 0 });
    const add = (A, x) => { A.n++; A.s += x; };
    const out = (A) => ({ n: A.n, mean: A.n ? A.s / A.n : null });
    // touching pairs: each lists the other across a side and they are within reach (as the predators' clusters, the warfare census)
    const lists = (i) => { const o = i * CF + C_NBR, a = []; for (let w = 0; w < 3; w++) a.push(u[o + w] & 0xffff, u[o + w] >>> 16); return a; };
    const isLive = new Uint8Array(n);
    for (const i of live) isLive[i] = 1;
    const contacts = new Uint8Array(n);
    const pairs = [];
    for (const i of live) {
      const oi = i * CF, li = lists(i);
      for (const j of li) {
        if (j === 0xffff || j >= n || j === i || !isLive[j]) continue;
        const oj = j * CF;
        if (Math.hypot(f[oj + C_POS] - f[oi + C_POS], f[oj + C_POS + 1] - f[oi + C_POS + 1]) >= 1.15 * (f[oi + C_R] + f[oj + C_R])) continue;
        if (!lists(j).includes(i)) continue;
        contacts[i]++;
        if (j > i) pairs.push([i, j]);
      }
    }
    let s = 0, s2 = 0, above = 0, below = 0, lo = Infinity, hi = -Infinity;
    const lit = acc(), shade = acc(), hard = acc(), interior = acc(), edge = acc(), loner = acc();
    const lin = new Map();
    for (const i of live) {
      const x = F(i), oc = i * CF;
      s += x; s2 += x * x; if (x > 0.1) above++; if (x < -0.1) below++; lo = Math.min(lo, x); hi = Math.max(hi, x);
      const light = (u[oc + C_SNS0] & 255) / 255;
      add(light >= P.lit ? lit : shade, x);
      if ((u[oc + C_FLAGS] >>> DOSE_SHIFT) / DOSE_SCALE >= 1) add(hard, x);
      const k = contacts[i];
      add(k >= 4 ? interior : k === 0 ? loner : edge, x);
      const fid = Math.round(g[i * B + 7]);
      if (!lin.has(fid)) lin.set(fid, { id: fid, n: 0, s: 0, s2: 0, pairs: 0, match: 0 });
      const L = lin.get(fid);
      L.n++; L.s += x; L.s2 += x * x;
    }
    const m = live.length;
    const mean = m ? s / m : null;
    // the self marker's MATCH at contacts (the moire beat over the shared wall x the phases' register, without the displays: kin_match_m in
    // cell_common.wgsl, as src/warfare.js), within a lineage and between two; within, by the pair's care (both above the founders, both
    // below, the rest)
    const kin = { same: acc2(), cross: acc2(), careful: acc2(), founders: acc2(), sloppy: acc2() };
    for (const [i, j] of pairs) {
      const a = i * B + 76, b = j * B + 76;
      const qa = Math.exp(-g[a + 1]), qb = Math.exp(-g[b + 1]);
      const dx = qa * Math.cos(g[a]) - qb * Math.cos(g[b]), dy = qa * Math.sin(g[a]) - qb * Math.sin(g[b]);
      const N = Math.hypot(dx, dy) * 0.5 * (f[i * CF + C_R] + f[j * CF + C_R]) / R;
      const mt = Math.exp(-9.8696044 * N * N / 6) * (0.5 + 0.5 * Math.cos(g[a + 2] - g[b + 2]));
      const same = Math.round(g[i * B + 7]) === Math.round(g[j * B + 7]);
      put(kin[same ? 'same' : 'cross'], mt);
      if (!same) continue;
      const fi = F(i), fj = F(j);
      put(kin[fi > 0.1 && fj > 0.1 ? 'careful' : fi < -0.1 && fj < -0.1 ? 'sloppy' : 'founders'], mt);
      const L = lin.get(Math.round(g[i * B + 7]));
      L.pairs++; L.match += mt;
    }
    const lineages = [...lin.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((L) => ({
      id: L.id, n: L.n, mean: L.s / L.n, sd: Math.sqrt(Math.max(0, L.s2 / L.n - (L.s / L.n) ** 2)), match: L.pairs ? L.match / L.pairs : null,
    }));
    return {
      time, n: m, mean, sd: m ? Math.sqrt(Math.max(0, s2 / m - mean * mean)) : null, above: m ? above / m : null, below: m ? below / m : null,
      min: m ? lo : null, max: m ? hi : null, m: mean == null ? null : Math.exp(-mean),
      lit: out(lit), shade: out(shade), hard: out(hard), interior: out(interior), edge: out(edge), loner: out(loner),
      kin: Object.fromEntries(Object.entries(kin).map(([k, K]) => [k, { pairs: K.n, match: K.n ? K.s / K.n : null, over05: K.n ? K.hi / K.n : null }])),
      lineages, lineageN: lin.size,
    };
  }

  /** The entropy panel's FIDELITY line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, Y = this.copy;
    const ctl = !p.on && !p.null ? ' (off)' : p.null ? ' · NULL' : '';
    if (!p.on && !p.null) return 'FIDELITY (off: today\'s copying)';
    if (!C || !C.n) return `FIDELITY${ctl}  …`;
    const pc = (x) => (x == null ? '-' : `${Math.round(100 * x)}%`), f2 = (x) => (x == null ? '-' : x.toFixed(2));
    const sg = (x) => (x == null ? '-' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
    const mut = Y && Y.perBirth != null ? `×${Y.perBirth.toFixed(2)}` : '-';
    if (compact) return `FIDELITY${ctl} ${sg(C.mean)}±${f2(C.sd)} (↑${pc(C.above)} ↓${pc(C.below)}) · mutation/birth ${mut} · proofreading ${fmt(Y ? Y.costPerS : 0)}/s · kin match ${f2(C.kin.same.match)}`;
    return `FIDELITY${ctl}  gene ${sg(C.mean)}±${f2(C.sd)} (errors ×${C.m.toFixed(2)}; above the founders ${pc(C.above)}, below ${pc(C.below)})` +
      ` · mutation per birth ${mut}${Y && Y.ratio != null ? ` (${Y.ratio.toFixed(2)} of the founders' care)` : ''} · proofreading ${fmt(Y ? Y.costPerS : 0)}/s (${Y ? Y.costPerBirth.toFixed(3) : '-'} a birth)` +
      ` · light ${sg(C.lit.mean)} shade ${sg(C.shade.mean)}${C.hard.n ? ` hard-lit ${sg(C.hard.mean)}` : ''} · interior ${sg(C.interior.mean)} edge ${sg(C.edge.mean)} loners ${sg(C.loner.mean)}` +
      ` · kin match at contacts ${f2(C.kin.same.match)} (careful pairs ${f2(C.kin.careful.match)}, sloppy ${f2(C.kin.sloppy.match)})`;
  }

  overlayLines() {
    const p = this.params;
    const lines = [`error correction (step G1): fidelity ${p.on ? 'on' : 'off'}${p.null ? ' · NEUTRAL CONTROL (drifts, no effect, no cost)' : ''}` +
      ` · copying errors × e^-F (F ${FID_LO}..${FID_HI}, founders 0) · hard light's extra: ${p.beyond} beyond proofreading · cost ${p.cost} × (e^F − 1) a birth (F > 0), from the parent's battery, as heat`];
    const C = this.census, Y = this.copy;
    if (C && C.n) {
      lines.push(`fidelity: ${C.n} cells, range ${C.min.toFixed(2)}..${C.max.toFixed(2)} · light ${C.lit.n} cells, shade ${C.shade.n}, hard-lit ${C.hard.n} · interior ${C.interior.n}, edge ${C.edge.n}, loners ${C.loner.n}` +
        ` · contacts within lineages ${C.kin.same.pairs} (match > 0.5: ${C.kin.same.over05 == null ? '-' : Math.round(100 * C.kin.same.over05) + '%'}), between ${C.kin.cross.pairs}` +
        (Y ? ` · births ${Y.birthsPerS.toFixed(2)}/s, paid ${Math.round(100 * Y.paidShare)}%, short ${fmt(Y.shortPerS)}/s, proofreading so far ${fmt(Y.costTot)}` : ''));
      lines.push(`fidelity by lineage (founder: cells, F, match): ${C.lineages.map((L) => `#${L.id} ${L.n} ${L.mean >= 0 ? '+' : ''}${L.mean.toFixed(2)}±${L.sd.toFixed(2)} ${L.match == null ? '-' : L.match.toFixed(2)}`).join(' · ')}`);
      const S = this.series.slice(-6);
      if (S.length) lines.push(`fidelity every census (cells, F, sd, above, below, kin match): ${S.map((x) => `${x[0].toFixed(0)}s ${x[1]} ${x[2].toFixed(2)} ${x[3].toFixed(2)} ${Math.round(100 * x[4])}% ${Math.round(100 * x[5])}% ${x[6] == null ? '-' : x[6].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }
}

function acc2() { return { n: 0, s: 0, hi: 0 }; }
function put(K, x) { K.n++; K.s += x; if (x > 0.5) K.hi++; }
