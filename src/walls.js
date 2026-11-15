// Step C10: PATTERNED WALLS, evolvable adhesion per side (user 2026-11-15: "evolve walls with different adhesion levels on
// different parts of it"; on Claude's proposal: "I want those effects to combine"). All the parts below act TOGETHER by
// default; each has its own switch for comparison.
//
//   pattern     each of the 6 sides of a cell has its own adhesion. Three smooth genes set the pattern round the wall, in the
//               cell's body frame: P(psi) = clamp(a0 + s (a1 cos psi + a2 cos 2 psi), 0, 1), psi the side's middle direction
//               measured from the cell's FRONT, s the pattern strength (a knob, 1). a0 is the overall stickiness: the adhesion
//               gene (Bio.body.x) itself, so a uniform wall is exactly the old adhesion gene; a1 the polar part (front sticky,
//               back not: + ; the other way: -); a2 the two-fold part (+: both ends sticky, the sides not; -: the sides sticky).
//               Mutation drifts a1, a2 (and w) by 0.04 per birth (x the hard light dose's factor, step C8); the founders' walls
//               are near-uniform (|a1|, |a2| up to 0.08), so patterns must evolve.
//   front       the direction the pattern hangs on (Cell.front). It is fixed in the body: it turns as the honeycomb turns
//               (step C6c), and a daughter inherits it with her mother's orientation (division: the hexagon, its outline and the
//               front are copied; turnover: the parent's front and orientation from the lean copy). The gene w (0..1) lets the
//               charge DIPOLE (step C6d) pull it round: toward the dipole's + end at frontRate x w x |d| rad/s x the sine of
//               the angle between them. So chemistry -> polarity -> stickiness can evolve (switch "front follows the dipole")
//   contact     a contact holds by the SMALLER of the two touching sides' effective adhesion (both must be sticky), times the
//               match the adhesion already had (the keys' likeness, the J of the reference, plus the same-fate glue) and the
//               same knobs (strength, the loss every pair pays, the contact stiffness): pull = (min(A_i, A_j) x (likeness +
//               fate glue) - adhBase) x adhesion x R x stiffness, where it was (sqrt(a0_i a0_j) x likeness + fate glue -
//               adhBase) x ... Which side faces the neighbour: by the direction to it against each hexagon's orientation
//               (cell_common.wgsl wall_side; both cells find the same pair)
//   cost        adhesion molecules are made of LINKERS: a side wants, on top of its membrane (step C6c), linkPer x adhesion x
//               its rest length of linker, in the membrane's own mix, woven by the membrane's repair (paying the same sparks);
//               a side's adhesion is held only as far as those extra linkers are there (the membrane itself fills first). And
//               the battery pays an UPKEEP for the glue held, upkeep x adhesion x the side's length (R) per s, as heat; what it
//               cannot pay it cannot hold. So stickiness is paid for where it is used, in matter and in energy. (Needs the
//               membrane chemistry for the linkers; without it only the upkeep.)
//   maturation  a side that keeps touching a sticky neighbour gets stickier: its MATURITY rises at matureRate per s (by how
//               fully it touches) and fades at matureFade per s once the contact is lost; a mature junction holds x
//               (1 + (matureCap - 1) x maturity) (and wants that much more linker and upkeep)
//
// Where it is computed: the eat pass (cell_eat.wgsl) works out each side's pattern, maturity factor, linker want, availability
// and upkeep, and writes the effective adhesion (Cell.wadh, 8 bits a side); the grid's scatter copies it into the lean copy
// with the orientation and the front (8 bits each); the step (cell_step.wgsl) takes the smaller side of each contact, matures
// the junctions, turns the front and counts the census (Stats.wall) on the frame's last tick. With the walls off, everything is
// as before step C10 (the old adhesion formula, no linker want, no upkeep, a daughter's hexagon turned at random).
//
// This module holds the switches and knobs (moire.walls.params, .look), writes the step's, the eat pass's and the drawing's words,
// reads the census back (with the cells' stats), and gives the WALLS panel line, the overlay and stats() for the experiments.

import { fmt, HEAT_SCALE } from './heat.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { ATOM_SCALE } from './matter.js';

export const STATS_WALL = 8640;   // byte offset of Stats.wall in struct Stats (cell_common.wgsl)
export const WALL_WORDS = 24;
const AMAX = 3;                   // WALL_AMAX: the largest effective adhesion a side can hold
const CLASSES = ['uniform', 'polar', 'two-ended', 'sticky sides'];

/** A genome's wall pattern class: 0 uniform, 1 polar, 2 two-ended, 3 sticky sides (as the census and the walls view). */
export function wallClass(a1, a2, min = 0.15) {
  if (Math.max(Math.abs(a1), Math.abs(a2)) < min) return 0;
  if (Math.abs(a1) >= Math.abs(a2)) return 1;
  return a2 > 0 ? 2 : 3;
}

export class Walls {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.walls.params). Switches: the rules panel's group "Patterned walls (step C10)"; ?walls=0, ?wallfront=0,
    // ?wallcost=0, ?mature=0
    this.params = {
      on: true,          // patterned walls (master): each side its own adhesion, a contact holds by the smaller side; off: the
                         // adhesion of steps 3b to C9 (?walls=0)
      front: true,       // the front follows the charge dipole, by the gene w (?wallfront=0: the inherited orientation alone)
      cost: true,        // adhesion costs linkers in the membrane and battery upkeep (?wallcost=0: free)
      mature: true,      // junctions mature: a side that keeps touching gets stickier (?mature=0)
      strength: 1,       // the pattern's strength: x a1 and a2 (0: uniform walls whatever the genes)
      frontRate: 0.5,    // how fast the dipole turns the front (rad / s at w x |d| = 1)
      matureRate: 0.2,   // a touching side's maturity rises at this rate (1 / s: 63 % mature after 5 s of contact)
      matureFade: 0.5,   // ... and fades at this rate once the contact is lost (1 / s)
      matureCap: 2,      // a fully mature junction holds x this
      linkPer: 0.012,    // linker (atom-units) per R of side at adhesion 1 (as much again as the founders' thin membrane)
      upkeep: 0.001,     // energy per s per R of side at adhesion 1 (a fully sticky cell, about 6.6 R of wall: 0.0066 / s)
      patternMin: 0.15,  // the census: |a1| and |a2| both below this counts as a uniform wall
    };
    // the look (moire.walls.look; drawing only)
    this.look = {
      sticky: 0.25,      // a side's tube is this much brighter at full adhesion and this much dimmer at none (0.5: as before)
      junction: 0.5,     // a matured junction's tube whiter, by this much at full maturity (both cells' tubes: a bright shared wall)
      junctionGlow: 0.3, // ... and brighter by this much
      frontTick: 0.8,    // the machinery: a small tick from the centre toward the front (brightness, 0 = none)
      viewTube: 0.7,     // the walls view: the tubes' shading by adhesion (0..1: dark where not sticky)
      viewFill: 0.45,    // ... the body's fill in its pattern's ink
    };
    this.census = null;
    this.series = [];    // [time, uniform, polar, two-ended, sides, mean maturity] every 30 s of simulation time
    this.near = null;    // the last stats() result
    this.dt = 1 / 60;
  }

  /** Whether a sub-rule acts (the master and its own switch). */
  rule(k) { return !!(this.params.on && this.params[k]); }

  flags() {
    return (this.params.on ? 1 : 0) | (this.rule('front') ? 2 : 0) | (this.rule('cost') ? 4 : 0) | (this.rule('mature') ? 8 : 0);
  }

  /** The step's words (struct Fields wl0, wl1, from word o). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = this.flags(); f[o + 1] = Math.max(0, p.frontRate); f[o + 2] = Math.max(0, p.matureRate); f[o + 3] = Math.max(0, p.matureFade);
    f[o + 4] = Math.max(0, p.patternMin); f[o + 5] = Math.max(0, p.strength);
    f[o + 6] = this.rule('mature') ? Math.max(0, Math.min(AMAX, p.matureCap) - 1) : 0; f[o + 7] = 0;
  }

  /** The eat pass's words (struct EatP wl0, wl1, from word o). */
  writeEat(u, f, o, dt) {
    const p = this.params;
    this.dt = dt;
    u[o] = this.flags(); f[o + 1] = Math.max(0, p.strength);
    f[o + 2] = this.rule('mature') ? Math.max(0, Math.min(AMAX, p.matureCap) - 1) : 0; f[o + 3] = Math.max(0, p.linkPer);
    f[o + 4] = Math.max(0, p.upkeep) * HEAT_SCALE * dt; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  }

  /** The drawing's words (struct Draw wall, wall2, wallInk[4], from word o). */
  writeDraw(a, o, look, P) {
    const L = this.look, p = this.params, on = p.on && this.cells.genome.rules.adh;
    a[o] = on ? 1 : 0; a[o + 1] = Math.max(0, Math.min(0.9, L.sticky)); a[o + 2] = Math.max(0, L.junction); a[o + 3] = on && look.marks ? Math.max(0, L.frontTick) : 0;
    a[o + 4] = Math.max(0, Math.min(1, L.viewTube)); a[o + 5] = Math.max(0, L.viewFill); a[o + 6] = Math.max(0, p.patternMin); a[o + 7] = Math.max(0, L.junctionGlow);
    const inks = P.walls || { uniform: P.other, polar: P.other, ends: P.other, sides: P.other };
    [inks.uniform, inks.polar, inks.ends, inks.sides].forEach((ink, j) => { for (let k = 0; k < 3; k++) a[o + 8 + 4 * j + k] = ink[k] / 255; a[o + 11 + 4 * j] = 1; });
  }

  /** The cells' stats read-back (Stats.wall, u32 words). */
  apply(time, w) {
    const s = new Int32Array(w.buffer, w.byteOffset, w.length);
    const n = w[0], m = Math.max(1, n), pairs = w[13], pm = Math.max(1, pairs);
    this.census = {
      time, n,
      a0: w[1] / 1000 / m, a1: w[2] / 1000 / m, a2: w[3] / 1000 / m, a1s: s[18] / 1000 / m, a2s: s[19] / 1000 / m, w: w[12] / 1000 / m,
      uniform: w[4] / m, polar: w[5] / m, ends: w[6] / m, sides: w[7] / m,
      mature: w[8] / 1000 / m, eff: w[9] / 1000 / m, ask: w[20] / 1000 / m,
      linkers: w[10] / ATOM_SCALE, upkeep: w[11] / HEAT_SCALE / Math.max(1e-6, this.dt),
      pairs: pairs / 2, glue: w[14] / 1000 / pm, maturedPairs: w[15] / pm, frontPairs: w[21] / pm,
      frontDip: w[17] ? s[16] / 1000 / w[17] : null, polarised: w[17],
    };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (n && (!S.length || time - S[S.length - 1][0] >= 30)) {
      const C = this.census;
      S.push([time, C.uniform, C.polar, C.ends, C.sides, C.mature]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's WALLS line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, pct = (x) => `${Math.round(100 * x)}%`;
    if (!p.on) return compact ? 'WALLS off' : 'WALLS  off: every side as sticky as the adhesion gene, as before step C10 (rules panel)';
    if (!this.cells.genome.rules.adh) return compact ? 'WALLS · adhesion off (H)' : 'WALLS  on, but adhesion itself is off (key H)';
    if (!C || !C.n) return 'WALLS  …';
    if (compact) return `WALLS uni ${pct(C.uniform)} pol ${pct(C.polar)} end ${pct(C.ends)} sid ${pct(C.sides)} · mature ${C.mature.toFixed(2)} · ${fmt(C.upkeep)}/s`;
    return `WALLS  a0 ${C.a0.toFixed(2)} · |a1| ${C.a1.toFixed(2)} · |a2| ${C.a2.toFixed(2)} · uniform ${pct(C.uniform)}, polar ${pct(C.polar)}, two-ended ${pct(C.ends)}, sides ${pct(C.sides)}` +
      ` · mature ${C.mature.toFixed(2)} (contacts ${pct(C.maturedPairs)})${p.mature ? '' : ' off'} · glue ${C.eff.toFixed(2)} of ${C.ask.toFixed(2)} asked` +
      `${p.cost ? ` · in adhesion: linkers ${fmt(C.linkers)}, upkeep ${fmt(C.upkeep)}/s` : ' · cost off'}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`patterned walls (step C10) ${on(p.on)} · front follows the dipole ${on(p.front)} (${p.frontRate} rad/s at w|d| = 1) · cost ${on(p.cost)} (linker ${p.linkPer} per R at adhesion 1, upkeep ${p.upkeep}/s per R)` +
      ` · junctions mature ${on(p.mature)} (rise ${p.matureRate}/s, fade ${p.matureFade}/s, up to x${p.matureCap}) · pattern strength ${p.strength}`];
    if (C && C.n) {
      lines.push(`walls: ${C.n} cells · a0 ${C.a0.toFixed(3)} · a1 ${C.a1s.toFixed(3)} (|a1| ${C.a1.toFixed(3)}) · a2 ${C.a2s.toFixed(3)} (|a2| ${C.a2.toFixed(3)}) · w ${C.w.toFixed(2)}` +
        ` · contacts ${C.pairs}, glue ${C.glue.toFixed(2)}, meeting with the front ${Math.round(100 * C.frontPairs)}%` +
        `${C.frontDip != null ? ` · front along the dipole (cos) ${C.frontDip.toFixed(2)} over ${C.polarised} polarised cells` : ''}` +
        `${this.near ? ` · stats at ${this.near.time.toFixed(0)} s: contacts at the front/side/back ${this.near.contactAt.map((x) => Math.round(100 * x)).join('/')}%` : ''}`);
      const S = this.series.slice(-10);
      if (S.length) lines.push(`walls every 30 s (uniform/polar/two-ended/sides %, maturity): ${S.map((x) => `${x[0].toFixed(0)}s ${x.slice(1, 5).map((v) => Math.round(100 * v)).join('/')} ${x[5].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }

  /**
   * For the experiments (console, tools): the live cells' walls, read back. Per cell its genes and pattern class, each side's
   * effective adhesion and maturity; per touching pair (closer than 1.15 x the sum of the radii) WHERE on each cell's wall the
   * contact sits: the angle between the direction to the neighbour and the cell's front, in three bins (front: within 60
   * degrees, back: within 60 degrees of the back, side: between), and the glue (the smaller side). Resolves to the summary and
   * keeps it for the overlay.
   */
  async stats() {
    const Cc = this.cells, d = Cc.device, n = Cc.count, F = CELL_FLOATS, B = BIO_FLOATS;
    const read = async (src, size) => {
      const buf = d.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(src, 0, buf, 0, size);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = buf.getMappedRange().slice(0);
      buf.destroy();
      return out;
    };
    const [cab, bab] = await Promise.all([read(Cc.cellBuf, n * F * 4), read(Cc.bioBuf[Cc.bioCur], n * B * 4)]);
    const f = new Float32Array(cab), u = new Uint32Array(cab), g = new Float32Array(bab);
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * F + 9] & 1) live.push(i);
    const side = (o, k) => ((k < 4 ? u[o + 68] >>> (8 * k) : u[o + 69] >>> (8 * (k - 4))) & 255) / 255 * AMAX;
    const mat = (o, k) => ((u[o + 65 + (k >> 1)] >>> (16 * (k & 1))) & 65535) / 65535;
    const th8 = (o) => ((u[o + 9] & 8) ? Math.round(((f[o + 38] / (2 * Math.PI)) % 1 + 1) % 1 * 256) % 256 * 2 * Math.PI / 256 : 0);
    const sideOf = (o, dx, dy) => { let a = Math.atan2(dy, dx) - th8(o); a -= 2 * Math.PI * Math.floor(a / (2 * Math.PI)); return Math.min(5, Math.floor(a / (Math.PI / 3))); };
    const cls = [0, 0, 0, 0], R = Cc.R, cs = 2.5 * R, grid = new Map();
    let eff = 0, mt = 0;
    for (const i of live) {
      const o = i * F, b = i * B;
      cls[wallClass(g[b + 48], g[b + 49], this.params.patternMin)]++;
      for (let k = 0; k < 6; k++) { eff += side(o, k); mt += mat(o, k); }
      const key = `${Math.floor(f[o] / cs)},${Math.floor(f[o + 1] / cs)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    const at = [0, 0, 0];   // contacts at the front, the side, the back (from each cell of a pair)
    let pairs = 0, glue = 0, matured = 0;
    for (const i of live) {
      const o = i * F, x = f[o], y = f[o + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
        for (const j of grid.get(`${gx + a},${gy + c}`) || []) {
          if (j === i) continue;
          const p = j * F, dx = f[p] - x, dy = f[p + 1] - y, dd = Math.hypot(dx, dy);
          if (dd > 1.15 * (f[o + 4] + f[p + 4]) || dd < 1e-6) continue;
          let psi = Math.atan2(dy, dx) - f[o + 64];
          psi = Math.abs(Math.atan2(Math.sin(psi), Math.cos(psi)));
          at[psi < Math.PI / 3 ? 0 : psi > 2 * Math.PI / 3 ? 2 : 1]++;
          if (j > i) {
            const ki = sideOf(o, dx, dy), kj = sideOf(p, -dx, -dy);
            pairs++;
            glue += Math.min(side(o, ki), side(p, kj));
            if (mat(o, ki) > 0.5 && mat(p, kj) > 0.5) matured++;
          }
        }
      }
    }
    const m = Math.max(1, live.length), ta = Math.max(1, at[0] + at[1] + at[2]);
    this.near = {
      time: window.moire && window.moire.time ? window.moire.time() : 0, n: live.length,
      classes: Object.fromEntries(CLASSES.map((k, j) => [k, +(cls[j] / m).toFixed(3)])),
      effMean: +(eff / 6 / m).toFixed(3), matureMean: +(mt / 6 / m).toFixed(3),
      pairs, glue: pairs ? +(glue / pairs).toFixed(3) : 0, matured: pairs ? +(matured / pairs).toFixed(3) : 0,
      contactAt: at.map((x) => +(x / ta).toFixed(3)),   // a random arrangement: 1/3 each
    };
    return this.near;
  }
}
