// Hard light mutates cells (Part C, step C8). Where a cell's body catches HARD light (the top band of src/light.js), it
// keeps a DOSE: the hard light energy its body caught, fading as it is repaired (a share `1 / repair` of it per s). At a
// birth (turnover: a neighbour divides into a freed slot, cell_step.wgsl) the parent's dose scales the copy's mutation:
// x (1 + gain x dose), at most `maxFactor` x, the small steps' size and every jump's chance alike (mutate() in
// cell_common.wgsl). Derived: the extra mutation is in proportion to the hard light absorbed (recently). With mutation
// itself off (key M) only the extra part mutates, so in the dark a lineage then stays pure.
//   the dose                  Cell.flags bits 19..31 (DOSE_SCALE counts per energy unit, at most 8191 counts), written by the
//                             eat pass (cell_eat.wgsl): the hard light falling on the cell (light_factor x the band's power x
//                             its area) shared by optical depth between the medium, the body and any HARD pigment the cell
//                             carries (as the pigments' catch): only the body's share counts, so a hard pigment would shade
//                             it a little (a sunscreen, if one evolves; no rule asks for it)
//   the births                the step reads the parent's dose from the lean copy (its flags) and counts the births, their
//                             mutation factor and the slot jumps (engine or pump slots that changed) from lit parents (a dose
//                             of 1 energy unit or more) and from the others
// Nothing new moves in the books: the hard light was already caught and became heat (C2); the dose is only a record of it.
//
// This module holds the switch and knobs (moire.hardlight.params), writes them into the eat pass's and the step's uniforms,
// reads the census back (the heat's ledger, LG_HL, through src/eat.js) and gives the HARD LIGHT panel line, the overlay and
// stats() (how alike touching neighbours are, in the light and in the dark) for the experiments.

import { fmt } from './heat.js';
import { BIO_FLOATS } from './genome.js';
import { CELL_FLOATS } from './cells.js';

const LG_HL = 22016;           // heat_common.wgsl: 16 numbers x 16 slots (0..7 a snapshot, 8..15 counters)
export const HL_SNAP_WORDS = 8 * 16;
const DOSE_SCALE = 16;         // cell_common.wgsl
const DOSE_SHIFT = 19;
const KEY_SPAN = Math.PI / 3;  // the key angle's range (field_common.wgsl)
const CNT = ['births', 'fsum', 'hit', 'hitF', 'jumpHit', 'jumpClean'];

export class HardLight {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.hardlight.params). Switch: the rules panel's group "Hard light (step C8)" and ?hardmut=0.
    this.params = {
      on: true,          // hard light mutates (?hardmut=0)
      gain: 0.05,        // extra mutation per energy unit of dose: x (1 + gain x dose)
      maxFactor: 10,     // ... at most this many times the usual mutation
      repair: 20,        // s: the dose fades with this time constant (the cell repairs the damage)
    };
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];    // [time, dose in the light, dose in the dark, mutation factor of births, lit births share, jumps lit / clean per birth]
    this.near = null;    // the last stats() result
  }

  get active() { return !!this.params.on; }

  /** The eat uniform's words (struct EatP hl, from word o): on, the share repaired per tick, the gain (census). */
  writeEat(f, o, dt) {
    const p = this.params;
    f[o] = this.active ? 1 : 0; f[o + 1] = 1 - Math.exp(-dt / Math.max(0.1, p.repair)); f[o + 2] = this.active ? Math.max(0, p.gain) : 0; f[o + 3] = 0;
  }

  /** The step's words (struct Fields hm, from word o): the gain (0 = off), the largest factor. */
  writeFields(f, o) {
    const p = this.params;
    f[o] = this.active ? Math.max(0, p.gain) : 0; f[o + 1] = Math.max(1, p.maxFactor); f[o + 2] = 0; f[o + 3] = 0;
  }

  /** The heat's ledger read-back (Int32 words; called by src/eat.js apply). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_HL + 16 * q + k]; return s; };
    const T = this.tot;
    CNT.forEach((k, j) => { T[k] += v(8 + j); });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 10) H.shift();   // rates over the last 10 s (births are few per frame)
    const dt = rec.time - H[0][0];
    const d = Object.fromEntries(CNT.map((k, j) => [k, H[H.length - 1][1 + j] - H[0][1 + j]]));
    const nl = v(0), nd = v(2);
    const clean = d.births - d.hit;
    const C = {
      time: rec.time, nl, nd, doseLit: nl ? v(1) / DOSE_SCALE / nl : 0, doseDark: nd ? v(3) / DOSE_SCALE / nd : 0, hot: v(4),
      birthsPerS: dt > 0.05 ? d.births / dt : 0, factor: d.births ? d.fsum / 1000 / d.births : 1,
      hitShare: d.births ? d.hit / d.births : 0, hitFactor: d.hit ? d.hitF / 1000 / d.hit : 1,
      jumpsHit: d.hit ? d.jumpHit / d.hit : 0, jumpsClean: clean > 0 ? d.jumpClean / clean : 0,
      jumpsPerS: dt > 0.05 ? (d.jumpHit + d.jumpClean) / dt : 0,
    };
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.doseLit, C.doseDark, C.factor, C.hitShare, C.jumpsHit, C.jumpsClean]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's HARD LIGHT line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.params.on) return 'HARD LIGHT  does not mutate (rules panel)';
    if (!C) return 'HARD LIGHT  …';
    if (compact) return `HARD LIGHT dose ${C.doseLit.toFixed(0)} / ${C.doseDark.toFixed(1)} · lit births ×${C.hitFactor.toFixed(1)} · jumps ${fmt(C.jumpsPerS)}/s`;
    return `HARD LIGHT  dose in the light ${C.doseLit.toFixed(1)}, in the dark ${C.doseDark.toFixed(2)} · births from lit parents ${Math.round(100 * C.hitShare)}%` +
      ` mutating ×${C.hitFactor.toFixed(1)} (all ×${C.factor.toFixed(2)}) · slot jumps per birth: lit ${C.jumpsHit.toFixed(3)}, others ${C.jumpsClean.toFixed(3)}` +
      ` (${fmt(C.jumpsPerS)}/s)${this.near ? ` · neighbours' key difference: light ${this.near.lit.dKey.toFixed(2)}°, dark ${this.near.dark.dKey.toFixed(2)}°` : ''}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, C = this.census;
    const lines = [`hard light mutates (step C8) ${p.on ? 'on' : 'off'}: a birth mutates × (1 + ${p.gain} × the parent's dose), at most × ${p.maxFactor}` +
      ` · the dose (hard light the body caught, energy units) fades over ${p.repair} s`];
    if (C) {
      lines.push(`hard light: cells in the light ${C.nl} (dose ${C.doseLit.toFixed(2)}), in the dark ${C.nd} (dose ${C.doseDark.toFixed(3)}) · cells whose daughters would mutate ≥ ×1.5: ${C.hot}` +
        ` · births ${C.birthsPerS.toFixed(1)}/s, ${Math.round(100 * C.hitShare)}% from lit parents (dose ≥ 1) at ×${C.hitFactor.toFixed(2)} · slot jumps per birth lit ${C.jumpsHit.toFixed(3)}, others ${C.jumpsClean.toFixed(3)}` +
        `${this.near ? ` · neighbours (stats at ${this.near.time.toFixed(0)} s): key difference light ${this.near.lit.dKey.toFixed(2)}°, dark ${this.near.dark.dKey.toFixed(2)}°; engine sets differ light ${(100 * this.near.lit.dEng).toFixed(0)}%, dark ${(100 * this.near.dark.dEng).toFixed(0)}%` : ''}`);
      lines.push(`hard light every 10 s (dose light/dark, factor, lit births, jumps lit/others): ${this.series.slice(-6).map((s) => `${s[0].toFixed(0)}s ${s[1].toFixed(1)}/${s[2].toFixed(2)} ×${s[3].toFixed(2)} ${Math.round(100 * s[4])}% ${s[5].toFixed(2)}/${s[6].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }

  /**
   * For the experiments (console, tools): how alike TOUCHING neighbours are, in the light and in the dark. Reads the cells and
   * genomes back; for every pair of live cells closer than 1.15 x (r_i + r_j): the difference of their key angles (the
   * lineage tint, in degrees, on its 60-degree circle) and whether their engine sets differ (the three slots, ignoring rates).
   * A pair counts as "in the light" when both cells are. Also the mean dose. Resolves to { lit, dark } and keeps it for the panel.
   */
  async stats() {
    const Cc = this.eat.cells, d = Cc.device, n = Cc.count, F = CELL_FLOATS, B = BIO_FLOATS;
    const read = async (src, bytes) => {
      const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(src, 0, buf, 0, bytes);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const a = buf.getMappedRange().slice(0);
      buf.destroy();
      return a;
    };
    const fc = new Float32Array(await read(Cc.cellBuf, n * F * 4)), uc = new Uint32Array(fc.buffer);
    const g = new Float32Array(await read(Cc.bioBuf[Cc.bioCur], n * B * 4));
    const L = this.eat.heat.light, sp = L && L.modeIndex === 1 ? L.spot() : null;
    const isLit = (x, y) => (L ? (L.modeIndex === 2 || (sp && Math.hypot(x - sp.x, y - sp.y) < sp.r)) : false);
    const R = Cc.R, cs = 2.5 * R, grid = new Map();
    const alive = [];
    for (let i = 0; i < n; i++) {
      if (!(uc[i * F + 9] & 1)) continue;
      alive.push(i);
      const k = `${Math.floor(fc[i * F] / cs)},${Math.floor(fc[i * F + 1] / cs)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const ENG = 32;   // genome word of Bio.eng (key 0, rec 4, resp 8, relay 12, body 16, acc 20, env 24, conv 28, eng 32)
    const engSet = (i) => [0, 1, 2].map((k) => (g[i * B + 36 + k] > 0 ? Math.round(g[i * B + ENG + k]) : -1)).sort().join(',');
    const acc = { lit: { pairs: 0, dKey: 0, dEng: 0, cells: 0, dose: 0 }, dark: { pairs: 0, dKey: 0, dEng: 0, cells: 0, dose: 0 } };
    const litOf = new Uint8Array(n);
    for (const i of alive) {
      litOf[i] = isLit(fc[i * F], fc[i * F + 1]) ? 1 : 0;
      const A = litOf[i] ? acc.lit : acc.dark;
      A.cells++; A.dose += (uc[i * F + 9] >>> DOSE_SHIFT) / DOSE_SCALE;
    }
    for (const i of alive) {
      const x = fc[i * F], y = fc[i * F + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
          if (j <= i) continue;
          const reach = 1.15 * (fc[i * F + 4] + fc[j * F + 4]);
          if (Math.hypot(fc[j * F] - x, fc[j * F + 1] - y) > reach) continue;
          if (litOf[i] !== litOf[j]) continue;
          const A = litOf[i] ? acc.lit : acc.dark;
          let da = Math.abs(fc[i * F + 5] - fc[j * F + 5]) % KEY_SPAN;
          da = Math.min(da, KEY_SPAN - da);
          A.pairs++; A.dKey += da * 180 / Math.PI; A.dEng += engSet(i) !== engSet(j) ? 1 : 0;
        }
      }
    }
    for (const A of Object.values(acc)) {
      A.dKey = A.pairs ? A.dKey / A.pairs : 0; A.dEng = A.pairs ? A.dEng / A.pairs : 0; A.dose = A.cells ? A.dose / A.cells : 0;
    }
    this.near = { time: window.moire && window.moire.time ? window.moire.time() : 0, ...acc };
    return this.near;
  }
}
