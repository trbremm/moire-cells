// Step G0, STRONG GLUE and JUNCTIONS THAT BREAK (user 2026-11-17: "yes! do both"; README "Step G0: strong glue and stirred water").
// Before: the adhesion gene (Bio.body.x, a0, the walls' overall stickiness, src/walls.js) was capped at 1, glue was free up to freeGlue 0.5 per
// side, and nothing pulled joined cells apart, so the gene drifted near 0.5 (P1: no change against its control). Now:
//
//   ceiling   the glue gene on a LOG scale, 0.05..4: a birth's step multiplies it (x e^(0.06 n), the old step's 6 % at 0.5) and its rare
//             jump lands anywhere on the log scale (cell_step.wgsl daughter_genome). Stored as before (the value itself), so founders and old
//             genomes keep exactly their meaning; a founder below 0.05 is lifted to it at its first birth. The pattern round the wall (C10)
//             tops at max(1, a0); the gene network's factor can lift the expressed glue to 4 at most.
//   cost      derived from the walls' cost (C10/C11: a side wants linkPer x the glue it holds above the free base, in linkers, and upkeep x that
//             per s): up to 1 as before; ABOVE today's ceiling every unit costs a0 x as much (the adhesion molecules stack in layers on layers,
//             each as costly as the first), so a side's linkers and upkeep grow as a0 x its paid glue: a0 = 2 costs 4 x a0 = 1 for 2 x the
//             hold, a0 = 4 16 x. Paid where it is used, as before (?gluecost=0: linear, as C10).
//   breaking  each touching side's JUNCTION FORMS when it presses a glued neighbour closer than the contact distance R0, and stays while that
//             side keeps touching one. Its BREAKING STRENGTH is the glue's peak pull, (the smaller of the two sides' glue, x the maturity
//             factor already in it, x the keys' likeness - the base loss every pair pays) x adhesion x R x stiffness: the pull is largest at R0
//             and only weakens beyond (it fades to 0 at the reach), so a pair pulled past R0 x (1 + stretch) is held by less than what pulls it
//             apart, whatever that is (crawling, the water's drag and shear, the press and the squeeze, a predator pulling its prey, a crowd's
//             push from divisions): the junction TEARS (both cells see the same distance; only a pair moving apart, so an approaching
//             neighbour never tears one). A torn side holds no glue (its neighbours read it from the lean copy; the eat pass asks and pays
//             nothing for it) and has lost its junction's maturity; it HEALS at random (mean 1 / heal s), then glues and matures again.
//             Needs the patterned walls (per side). No integrity cost (the membrane is not torn, the junction is).
//   null      ?gluenull=1: the gene drifts as on, every effect at the FOUNDER's value (Bio.rec.z, stamped at a founder's making and inherited
//             unchanged): the yardstick for selection.
//
// Census (Stats.g0, cell_common.wgsl G0S_*): tears and heals (cumulative), the gene's log mean and spread, cells above 1, formed junctions,
// their mean strength and load, torn sides; the GLUE panel line; stats() for the experiments.

import { fmt } from './heat.js';

export const STATS_G0 = 9280;     // byte offset of Stats.g0 in struct Stats (cell_common.wgsl)
export const G0_WORDS = 32;
export const G0_CLEAR = 8;        // G0S_CLEAR: the words cleared every frame from here
export const GLUE_LO = 0.05, GLUE_HI = 4;
const BITS = { CEIL: 1, NULL: 2, TEAR: 4, COST: 8 };   // G0_* in cell_common.wgsl

/** Stamp a founder genome's own glue as its founder value (Bio.rec.z, word 6), unless it has one (a living cell's copy). */
export function stampFounderGlue(g, o = 0) {
  if (!(g[o + 6] > 0)) g[o + 6] = Math.max(0, g[o + 16] || 0);
}

export class Glue {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.glue.params); the rules panel's group "Strong glue (step G0)"
    this.params = {
      ceiling: true,     // the glue gene on a log scale 0.05..4 (?glueceil=0: 0..1, as before)
      cost: true,        // glue above 1 costs a0 x more per unit (?gluecost=0: linear)
      tear: true,        // junctions tear when pulled past their strength (?breaks=0)
      null: false,       // the neutral control: the gene drifts, its effects at the founder's value (?gluenull=1)
      stretch: 0.05,     // a formed junction tears when its pair is pulled this share past the contact distance (?tearat=)
      heal: 4,           // s: a torn side heals after this long on average (?heal=)
    };
    this.census = null;
    this.series = [];    // [time, ln-gene mean, sd, share above 1, tears per s, mean strength, mean load]
    this.prev = null;
  }

  /** The bits (Fields.g0a.x, EatP.wl1.w). */
  bits() {
    const p = this.params;
    return (p.ceiling ? BITS.CEIL : 0) | (p.null ? BITS.NULL : 0) | (p.tear ? BITS.TEAR : 0) | (p.cost ? BITS.COST : 0);
  }

  /** The step's words (struct Fields g0a from word o). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = this.bits(); f[o + 1] = 1 / Math.max(0.05, p.heal); f[o + 2] = Math.max(0, p.stretch); f[o + 3] = 0;
  }

  /** The cells' stats read-back (Stats.g0, u32 words). */
  apply(time, w) {
    const s = new Int32Array(w.buffer, w.byteOffset, w.length);
    const n = w[16], m = Math.max(1, n), jn = w[20], jm = Math.max(1, jn);
    const lm = s[17] / 1000 / m, l2 = w[18] / 1000 / m;
    const prev = this.prev, tears = w[0], heals = w[1];
    let rate = this.census ? this.census.tearRate : 0;
    if (prev && time > prev.time + 0.2) { rate = Math.max(0, (tears - prev.tears) / 2) / (time - prev.time); this.prev = { time, tears }; }
    else if (!prev || time < prev.time) this.prev = { time, tears };
    const ticks = w[9], work = s[8];
    this.census = {
      time, n, geneLog: lm, geneSd: Math.sqrt(Math.max(0, l2 - lm * lm)), geneGeo: Math.exp(lm), geneMean: w[24] / 1000 / m, high: w[19] / m,
      formed: jn / 2, strength: jn ? w[21] / 1000 / jm : 0, load: jn ? s[22] / 1000 / jm : 0, torn: w[23],
      tears: tears / 2, heals, tearRate: rate,
      stirWork: ticks ? work / 65536 / (ticks / 60) : 0,   // the stirred water's work on the cells per s (energy units; taken from heat)
      bad: w[2], fast: w[3],   // the portable guard (cell_step.wgsl G0S_BAD, G0S_FAST; src/gpu.js): cells put back after NaN / infinity; too-fast cell-ticks
    };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (n && (!S.length || time - S[S.length - 1][0] >= 30)) {
      const C = this.census;
      S.push([time, C.geneLog, C.geneSd, C.high, C.tearRate, C.strength, C.load]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's GLUE line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, pct = (x) => `${Math.round(100 * x)}%`;
    if (!C || !C.n) return 'GLUE  …';
    const g = `gene ${C.geneGeo.toFixed(2)}${p.ceiling ? '' : ' (0..1)'}${p.null ? ' NULL' : ''} (${pct(C.high)} > 1)`;
    const t = p.tear ? `tears ${fmt(C.tearRate)}/s · torn ${C.torn}` : 'tearing off';
    if (compact) return `GLUE ${g} · ${t} · junctions ${C.formed} str ${C.strength.toFixed(2)}`;
    return `GLUE  ${g}, spread ×${Math.exp(C.geneSd).toFixed(2)} · junctions ${C.formed}, strength ${C.strength.toFixed(2)}, load ${pct(C.load)} of it · ${t} sides`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`strong glue (step G0): log scale ${on(p.ceiling)} (${GLUE_LO}..${GLUE_HI}) · cost above 1 ×a0 ${on(p.cost)} · junctions tear ${on(p.tear)}` +
      ` (past ${p.stretch} × contact, heal ${p.heal} s) · neutral control ${on(p.null)}`];
    if (C && C.n) {
      lines.push(`glue: ${C.n} cells · gene geometric mean ${C.geneGeo.toFixed(3)} (ln ${C.geneLog.toFixed(3)} ± ${C.geneSd.toFixed(3)}), mean ${C.geneMean.toFixed(3)}, above 1: ${(100 * C.high).toFixed(1)}%` +
        ` · formed junctions ${C.formed}, strength ${C.strength.toFixed(3)}, load ${C.load.toFixed(3)} · tears ${C.tears} (${fmt(C.tearRate)}/s), heals ${C.heals}, torn now ${C.torn}` +
        ` · the stirred water's work on cells ${fmt(C.stirWork)}/s (from heat)`);
      const S = this.series.slice(-8);
      if (S.length) lines.push(`glue every 30 s (geo mean, >1 %, tears/s, strength): ${S.map((x) => `${x[0].toFixed(0)}s ${Math.exp(x[1]).toFixed(2)} ${Math.round(100 * x[3])} ${x[4].toFixed(2)} ${x[5].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }
}
