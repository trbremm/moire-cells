// Step P3, CELLS THAT SENSE CELLS (BUILD QUEUE 6a6, the user 2026-11-23: "predators are so boring still ... either give them more skills or
// just have a larger dial for cells to be able to detect other cells, both to run away and to get closer. The run away/attraction should
// also be a dial"; then: scents are REAL CHEMICALS, no magic labels; and "the defensive cells should also have a reason to cluster or
// collaborate"). README "Step P3". Every part its own switch (the rules panel's group "Cells that sense cells (step P3)", URL options):
//
//   NOSE (?nose=0)       N2 found the membrane corners' smell saturated and noisy (steering always at full strength, smell vs path cosine
//                        ~0). Now the fuel smell is a RELATIVE gradient, d log (c + floor) across the cell (bacteria sense ratios), LOW-PASSED
//                        over `tau` s (state in Cell.smell: the eat pass mixes each reading in), and the steering responds softly, x / (x +
//                        noseHalf) instead of tanh. ?nose=0: exactly as in step N2
//   TASTE (?taste=0)     four DIALS per cell, -1..1 (Bio.ta; + approach, - flee; founders 0), each on a substance that is ALREADY in the
//                        water and that cells give off: OXYGEN (free t: light eaters' waste, a poison), EXHAUST (the CO2-like end of the
//                        carbon ladder: breathers' waste), SPILL (free G: the metal of broken enzymes, set free where a cell died, burst or
//                        was digested: inside-only stuff found outside), HEAT (the temperature: busy cells, digestion). The same corners,
//                        the same relative gradients, the same low-pass (Cell.taste); the crawl steers along the sum (tasteSpeed R/s at a
//                        strong taste), a swimmer's front turns toward it (S2). The RANGE gene (Bio.tb.x, -2..2) is the sensitivity: the
//                        floor below which a concentration is not told apart is the dish's mean of that substance (adaptation to the
//                        background) / rangeGain x e^-range, so a long-range nose follows fainter traces (cells farther away); it costs
//                        upkeep (rangeCost per s per unit of |dial| x e^range, from the battery as heat). The genes mutate at birth (M2's
//                        scale; rare mode with the chemotaxis group). ?tastenull=1 the NEUTRAL control: they drift, nothing steers, nothing
//                        is paid
//   CLUMP (?clump=0)     EAT THE CLUMP OR NOTHING: the engulf size test counts the prey's GLUED GROUP (the prey and each neighbour joined to it
//                        by a G0 junction, formed and not torn, each as big as the prey). A wrap may start on a glued prey but runs only to
//                        the TUG (share `tug` of the way), pulling it meanwhile, until its junctions tear (G0's own rule) and the rest of the
//                        group is small enough
//   ARMOUR (?sharedarmour=0)  SHARED ARMOUR: the crust wall is wanted (built, paid) on the EXPOSED sides only; a side joined to a neighbour
//                        by a junction wants `kinShare` of it (and sheds the rest back into the dish, exact). A cell's hold against a
//                        predator counts the armour of its exposed sides. A clump's outer ring armours, its core stays soft
//
// This module: the switches and knobs (moire.senses.params), the step's words (Fields p3a, p3b), the eat pass's (EatP p3), the dish's
// means for the taste's floors (every frame, from the books), a CENSUS every `censusEvery` s (a read-back: the taste genes vs their null,
// how well motion follows the nose and the taste, CHASES: predators closing on their nearest smaller cell vs ordinary cells, prey opening,
// glued groups, wall on exposed vs sheltered sides), the SENSES panel line, overlay lines, and a lab helper (moire.senses.lab()).

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { readBuffer } from './snapshot.js';
import { CH } from './matter.js';
import { CARBON } from './carbon.js';
import { HEAT_SCALE } from './heat.js';

export const P3 = { NOSE: 1, TASTE: 2, NULL: 4, CLUMP: 8, ARMOUR: 16 };
export const BIO_P3 = 180;          // Bio.ta (180..183: the dials), Bio.tb (184: the range; 185..187 spare)
export const TASTES = ['oxygen', 'exhaust', 'spill', 'heat'];
const C_KIND = 8, C_FLAGS = 9, C_SEED = 10, C_SMELL = 20, C_NBR = 60, C_LIP = 72, C_TASTE = 94;
const B_ENGULF = 82, B_FOUNDER = 7, B_MOT = 18, B_FLAG = 168;

export class Senses {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.senses.params); the rules panel's group "Cells that sense cells (step P3)"
    this.params = {
      nose: true,          // the averaged nose (?nose=0: the smell as in step N2)
      tau: 1.5,            // s the nose (and the taste) averages over (?tau=)
      noseHalf: 0.15,      // the fuel smell's relative gradient (per R) at which the steering is half its full (?nosehalf=)
      fuelFloor: 0.5,      // energy per R^2: the fuel smell's floor, d log (c + floor) (?fuelfloor=)
      taste: true,         // the taste dials steer (?taste=0: no taste at all, the genes do not drift)
      tasteNull: false,    // ... their NEUTRAL control (?tastenull=1): the dials and range drift, nothing steers, nothing is paid
      tasteSpeed: 1,       // R / s at a strong taste (crawling's own wander is 0.6) (?tastespeed=; 0.6 in the first lab runs and colonies-on)
      tasteHalf: 0.04,     // the summed taste (relative gradient per R x dial) at which the steering is half its full (?tastehalf=; 0.15 at
                           // first: a predator 10-15 R from a colony tastes ~0.06-0.1, so the wander's 0.6 R/s outweighed it; lab p3-clip-*)
      rangeGain: 1,        // the global sensitivity: every floor / this (?rangegain=)
      rangeCost: 0.003,    // energy per s per unit of |dial| at range 0 (x e^range; an engine of rate 1 costs as much) (?rangecost=)
      minFloor: [0.002, 0.002, 0.002, 0.05],   // the floors' least (per R^2; heat as temperature), so an empty dish still has one
      clump: true,         // eat the clump or nothing (?clump=0)
      tug: 0.5,            // the share of a wrap a predator gets to while the prey's glued group is too big (?tug=)
      armour: true,        // shared armour (?sharedarmour=0)
      kinShare: 0.2,       // the share of the wall a joined (sheltered) side still wants (?kinshare=)
      censusEvery: 10,     // s of simulated time between the census's read-backs (0: never) (?p3census=)
      near: 12,            // R: how far a predator looks for its nearest prey (census)
    };
    this.floors = [0, 0, 0, 0];
    this.census = null;
    this.series = [];
    this.paths = new Map();
    this.busy = false;
    this.lastAt = -1e9;
  }

  get tasteOn() { return !!this.params.taste; }
  get bits() {
    const p = this.params;
    return (p.nose ? P3.NOSE : 0) | (p.taste ? P3.TASTE : 0) | (p.taste && p.tasteNull ? P3.NULL : 0) | (p.clump ? P3.CLUMP : 0) | (p.armour ? P3.ARMOUR : 0);
  }
  /** Whether the taste steers (on and not its neutral control). */
  get acts() { return !!this.params.taste && !this.params.tasteNull; }

  /** The step's words (struct Fields p3a, p3b, from word o). */
  writeFields(u, f, o) {
    const p = this.params, n = (x, lo = 0) => Math.max(lo, Number(x) || 0);
    u[o] = this.bits; f[o + 1] = n(p.tasteSpeed); f[o + 2] = n(p.tasteHalf, 1e-4); f[o + 3] = n(p.noseHalf, 1e-4);
    f[o + 4] = Math.min(0.99, n(p.tug)); f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  }
  /** The eat pass's words (struct EatP p3[3], from word o), dt the tick. */
  writeEat(u, f, o, dt) {
    const p = this.params;
    u[o] = this.bits;
    f[o + 1] = p.tau > 0 ? 1 - Math.exp(-Math.max(1e-4, dt) / p.tau) : 1;
    f[o + 2] = Math.max(1e-4, Number(p.fuelFloor) || 0);
    // (energy per s -> heat counts per tick, as the engines' upkeep)
    f[o + 3] = Math.max(0, Number(p.rangeCost) || 0) * HEAT_SCALE * Math.max(1e-4, dt);
    this.updateFloors();
    for (let k = 0; k < 4; k++) f[o + 4 + k] = this.floors[k];
    f[o + 8] = Math.max(0, Math.min(1, Number(p.kinShare) || 0)); f[o + 9] = 0; f[o + 10] = 0; f[o + 11] = 0;
  }
  /** The taste's floors at range 0: the dish's mean of each substance per R^2 (heat as temperature) / rangeGain, at least minFloor. */
  updateFloors() {
    const C = this.cells, M = C.matter || (C.eat && C.eat.matter), H = C.heat, R = C.R || 6;
    const view = C.view || (M && M.view);
    const A = view ? Math.max(1, (view.cssW * view.cssH) / (R * R)) : 1e4;
    const p = this.params, g = Math.max(1e-3, Number(p.rangeGain) || 1);
    const dish = M && M.dish ? M.dish : null;
    const ox = dish ? (dish[CH.t] || 0) + (dish[CH['t*']] || 0) : 0;
    const ex = CARBON && M && M.carbon && M.carbon.dish ? M.carbon.dish[4] || 0 : 0;
    const sp = dish ? dish[CH.G] || 0 : 0;
    const ht = H && H.ledger ? H.ledger.heat || 0 : 0;
    [ox, ex, sp, ht].forEach((v, k) => { this.floors[k] = Math.max(p.minFloor[k] ?? 0.002, (v / A) / g); });
  }

  // ---------------------------------------------------------------- the census
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('senses census:', e); });
  }
  last() { return this.census; }
  now() { return this.read(this.lastAt); }

  async read(time = this.lastAt) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count, R = C.R, CF = CELL_FLOATS, B = BIO_FLOATS, p = this.params;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * B * 4), readBuffer(d, C.cellBuf, 0, n * CF * 4)]);
      const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
      const ratio = (C.pred && C.pred.params.sizeRatio) || 1.4;
      const live = [];
      for (let i = 0; i < n; i++) if (u[i * CF + C_FLAGS] & 1) live.push(i);
      const N = live.length;
      // the taste genes (all cells, and the carriers of the engulf gene), how motion follows the taste and the nose
      const s1 = [0, 0, 0, 0, 0], s2 = [0, 0, 0, 0, 0], pm = [0, 0, 0, 0, 0];
      let np = 0, tFeel = 0, tAlign = 0, nTA = 0, sFeel = 0, sAlign = 0, nSA = 0, pAlignT = 0, nPT = 0, pAlignS = 0, nPS = 0;
      const half = p.nose ? p.noseHalf : ((C.eat && C.eat.params.smellHalf) || 0.05);
      const seen = new Set();
      for (const i of live) {
        const b = i * B, o = i * CF;
        const genes = [g[b + BIO_P3], g[b + BIO_P3 + 1], g[b + BIO_P3 + 2], g[b + BIO_P3 + 3], g[b + BIO_P3 + 4]];
        const pred = (g[b + B_ENGULF] || 0) >= 0.25;
        for (let k = 0; k < 5; k++) { s1[k] += genes[k]; s2[k] += genes[k] * genes[k]; if (pred) pm[k] += genes[k]; }
        if (pred) np++;
        const vx = f[o + 2], vy = f[o + 3], vm = Math.hypot(vx, vy);
        const tx = f[o + C_TASTE], ty = f[o + C_TASTE + 1], tm = Math.hypot(tx, ty);
        const sx = f[o + C_SMELL], sy = f[o + C_SMELL + 1], sm = Math.hypot(sx, sy);
        if (tm > 0.2 * p.tasteHalf) { tFeel++; if (vm > 1e-6) { tAlign += (vx * tx + vy * ty) / (vm * tm); nTA++; } }
        if (sm > 0.2 * half) { sFeel++; if (vm > 1e-6) { sAlign += (vx * sx + vy * sy) / (vm * sm); nSA++; } }
        // the way it went since the last census against what it tasted / smelled then
        seen.add(i);
        const seed = u[o + C_SEED], P = this.paths.get(i), x = f[o], y = f[o + 1];
        if (P && P.seed === seed) {
          const dx = x - P.x, dy = y - P.y, dd = Math.hypot(dx, dy);
          if (dd > 0.05 * R) {
            const pt = Math.hypot(P.tx, P.ty), ps = Math.hypot(P.sx, P.sy);
            if (pt > 0.2 * p.tasteHalf) { pAlignT += (dx * P.tx + dy * P.ty) / (pt * dd); nPT++; }
            if (ps > 0.2 * half) { pAlignS += (dx * P.sx + dy * P.sy) / (ps * dd); nPS++; }
          }
        }
        this.paths.set(i, { seed, x, y, tx, ty, sx, sy });
      }
      for (const i of [...this.paths.keys()]) if (!seen.has(i)) this.paths.delete(i);
      const mean = (k) => (N ? s1[k] / N : 0), sd = (k) => (N ? Math.sqrt(Math.max(0, s2[k] / N - mean(k) ** 2)) : 0);
      // CHASES: each engulf carrier's nearest SMALLER live cell within `near` R (not touching: 2.2 R or more apart): the closing speed (R/s,
      // + = closing), and the same for ordinary cells toward their nearest smaller cell (the baseline: what drift and crowding alone give);
      // PREY: cells with a carrier within `near` R that is bigger than them: their opening speed away from it
      const cs = p.near * R, grid = new Map(), key = (x, y) => `${Math.floor(x / cs)},${Math.floor(y / cs)}`;
      for (const i of live) { const k = key(f[i * CF], f[i * CF + 1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
      const nearest = (i, test) => {
        const o = i * CF, x = f[o], y = f[o + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
        let best = -1, bd = Infinity;
        for (let a = -1; a <= 1; a++) for (let c2 = -1; c2 <= 1; c2++) {
          const L = grid.get(`${gx + a},${gy + c2}`);
          if (!L) continue;
          for (const j of L) {
            if (j === i || !test(j)) continue;
            const dd = Math.hypot(f[j * CF] - x, f[j * CF + 1] - y);
            if (dd < bd && dd <= cs) { bd = dd; best = j; }
          }
        }
        return [best, bd];
      };
      const closing = (i, j) => {
        const oi = i * CF, oj = j * CF, dx = f[oj] - f[oi], dy = f[oj + 1] - f[oi + 1], dd = Math.hypot(dx, dy) || 1;
        return ((f[oi + 2] - f[oj + 2]) * dx + (f[oi + 3] - f[oj + 3]) * dy) / dd / R;
      };
      const ch = { n: 0, close: 0, chases: 0, dist: 0, point: 0, nPoint: 0, taste: 0 }, base = { n: 0, close: 0, chases: 0 }, prey = { n: 0, open: 0, flee: 0, point: 0, nPoint: 0 };
      for (const i of live) {
        const o = i * CF, ri = f[o + 4], isPred = (g[i * B + B_ENGULF] || 0) >= 0.25;
        const [j, dd] = nearest(i, (k) => f[k * CF + 4] ** 2 * ratio <= ri * ri);
        if (j >= 0 && dd >= 2.2 * R) {
          const v = closing(i, j), Z = isPred ? ch : base;
          Z.n++; Z.close += v; if (v > 0.25) Z.chases++;
          if (isPred) {
            ch.dist += dd / R;
            // where its taste points: the cosine between Cell.taste and the way to that prey (1: straight at it)
            const tx = f[o + C_TASTE], ty = f[o + C_TASTE + 1], tm = Math.hypot(tx, ty);
            ch.taste += tm;
            if (tm > 1e-6) { ch.point += (tx * (f[j * CF] - f[o]) + ty * (f[j * CF + 1] - f[o + 1])) / (tm * dd); ch.nPoint++; }
          }
        }
        if (!isPred) {
          const [k, dk] = nearest(i, (q) => (g[q * B + B_ENGULF] || 0) >= 0.25 && f[q * CF + 4] ** 2 >= ratio * ri * ri);
          if (k >= 0 && dk >= 2.2 * R) {
            const v = -closing(i, k); prey.n++; prey.open += v; if (v > 0.25) prey.flee++;
            const tx = f[o + C_TASTE], ty = f[o + C_TASTE + 1], tm = Math.hypot(tx, ty);
            if (tm > 1e-6) { prey.point -= (tx * (f[k * CF] - f[o]) + ty * (f[k * CF + 1] - f[o + 1])) / (tm * dk); prey.nPoint++; }   // (+: away from it)
          }
        }
      }
      // GLUED GROUPS: cells joined by junctions (formed, not torn, on the side facing a listed neighbour that lists it back) (union-find)
      const par = new Int32Array(n).map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const formed = (i) => { const w = u[i * CF + C_KIND]; return ((w >>> 8) & ~w) & 63; };
      const nbr = (i, k) => (u[i * CF + C_NBR + (k >> 1)] >>> (16 * (k & 1))) & 0xffff;
      let exW = 0, exN = 0, shW = 0, shN = 0;
      for (const i of live) {
        const fm = formed(i);
        for (let k = 0; k < 6; k++) {
          const cover = (u[i * CF + C_LIP + k] >>> 24) / 255;
          if ((fm >> k) & 1) { shW += cover; shN++; } else { exW += cover; exN++; }
          if (!((fm >> k) & 1)) continue;
          const j = nbr(i, k);
          if (j === 0xffff || j >= n || !(u[j * CF + C_FLAGS] & 1)) continue;
          let back = false;
          for (let q = 0; q < 6; q++) if (nbr(j, q) === i && ((formed(j) >> q) & 1)) back = true;
          if (!back) continue;
          const a = find(i), c2 = find(j);
          if (a !== c2) par[a] = c2;
        }
      }
      const size = new Map();
      for (const i of live) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
      let single = 0, in4 = 0, wsum = 0, largest = 0;
      for (const s of size.values()) { if (s === 1) single++; if (s >= 4) in4 += s; wsum += s * s; largest = Math.max(largest, s); }
      const out = {
        time, n: N, carriers: np,
        dials: TASTES.map((nm, k) => ({ name: nm, mean: mean(k), sd: sd(k), pred: np ? pm[k] / np : null })),
        range: { mean: mean(4), sd: sd(4), pred: np ? pm[4] / np : null },
        taste: { feel: N ? tFeel / N : 0, align: nTA ? tAlign / nTA : 0, alignPath: nPT ? pAlignT / nPT : 0 },
        nose: { feel: N ? sFeel / N : 0, align: nSA ? sAlign / nSA : 0, alignPath: nPS ? pAlignS / nPS : 0 },
        chase: { preds: ch.n, close: ch.n ? ch.close / ch.n : 0, chases: ch.chases, dist: ch.n ? ch.dist / ch.n : 0,
          point: ch.nPoint ? ch.point / ch.nPoint : 0, nPoint: ch.nPoint, taste: ch.n ? ch.taste / ch.n : 0,
          baseN: base.n, baseClose: base.n ? base.close / base.n : 0, baseChaseShare: base.n ? base.chases / base.n : 0, chaseShare: ch.n ? ch.chases / ch.n : 0 },
        prey: { n: prey.n, open: prey.n ? prey.open / prey.n : 0, flee: prey.flee, fleeShare: prey.n ? prey.flee / prey.n : 0, point: prey.nPoint ? prey.point / prey.nPoint : 0, nPoint: prey.nPoint },
        glued: { groups: size.size, single: N ? single / N : 0, in4: N ? in4 / N : 0, meanSize: N ? wsum / N : 0, largest },
        wall: { exposed: exN ? exW / exN : 0, sheltered: shN ? shW / shN : 0, shelteredSides: (exN + shN) ? shN / (exN + shN) : 0 },
        floors: this.floors.slice(),
      };
      this.census = out;
      this.series.push([time, N, ...TASTES.map((_, k) => mean(k)), mean(4), out.taste.alignPath, out.nose.alignPath, out.chase.close, out.chase.baseClose, out.glued.meanSize]);
      while (this.series.length > 2000) this.series.shift();
      return out;
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- the lab
  /**
   * Place `n` hand-made predators (moire.predators.genome(opts): opts.taste [oxygen, exhaust, spill, heat], opts.range, opts.flagellum, ...)
   * evenly on a RING round the live cells: centred on their mean place, at the radius that holds 90 % of them + `gap` R (so they start out
   * in the open water, `gap` R from the colony's edge). Returns { centre, radius (R), placed }.
   */
  async ring(n = 16, gap = 15, opts = {}) {
    const C = this.cells, CF = CELL_FLOATS, R = C.R, v = C.view;
    const ab = await readBuffer(C.device, C.cellBuf, 0, C.count * CF * 4), f = new Float32Array(ab), u = new Uint32Array(ab);
    let sx = 0, sy = 0, m = 0;
    for (let i = 0; i < C.count; i++) if (u[i * CF + C_FLAGS] & 1) { sx += f[i * CF]; sy += f[i * CF + 1]; m++; }
    if (!m) throw new Error('no live cells');
    const cx = sx / m, cy = sy / m, ds = [];
    for (let i = 0; i < C.count; i++) if (u[i * CF + C_FLAGS] & 1) ds.push(Math.hypot(f[i * CF] - cx, f[i * CF + 1] - cy));
    ds.sort((a, b) => a - b);
    const r = ds[Math.floor(0.9 * (ds.length - 1))] + gap * R, mg = 3 * R, pts = [];
    for (let k = 0; k < n; k++) {
      const a = 2 * Math.PI * (k + 0.5 + (Number(opts.phase) || 0)) / n;   // (opts.phase: a share of the spacing, to put several rings between each other)
      pts.push([Math.max(mg, Math.min(v.cssW - mg, cx + r * Math.cos(a))), Math.max(mg, Math.min(v.cssH - mg, cy + r * Math.sin(a)))]);
    }
    await window.moire.app.place(pts, C.pred.genome(opts), 'predator');
    return { centre: [cx, cy], radius: r / R, placed: pts.length };
  }

  /**
   * The lab's probe: every cell with the engulf gene (>= 0.25) and a taste, grouped by its dials' pattern (as text): how big the taste it
   * holds is (Cell.taste), the cosine of it with the way to its nearest smaller live cell (+ = toward it; also for those > 5 R away), that
   * cell's distance (R) and the closing speed (R/s). For telling which scent points at prey, and from how far.
   */
  async probe(opts = {}) {   // (opts.founder: only cells of that founder id, Bio.rec.w: the hand-made predators are 900; then dials of 0 count too)
    const C = this.cells, d = C.device, n = C.count, CF = CELL_FLOATS, B = BIO_FLOATS, R = C.R;
    const ratio = (C.pred && C.pred.params.sizeRatio) || 1.4;
    const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * B * 4), readBuffer(d, C.cellBuf, 0, n * CF * 4)]);
    const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * CF + C_FLAGS] & 1) live.push(i);
    const groups = {};
    for (const i of live) {
      const b = i * B, o = i * CF;
      if ((g[b + B_ENGULF] || 0) < 0.25) continue;
      const dl = [0, 1, 2, 3].map((k) => Math.round(10 * g[b + BIO_P3 + k]) / 10);
      if (opts.founder != null ? Math.round(g[b + B_FOUNDER]) !== opts.founder : dl.every((x) => x === 0)) continue;
      let best = -1, bd = Infinity;
      for (const j of live) {
        if (j === i || f[j * CF + 4] ** 2 * ratio > f[o + 4] ** 2) continue;
        const dd = Math.hypot(f[j * CF] - f[o], f[j * CF + 1] - f[o + 1]);
        if (dd < bd) { bd = dd; best = j; }
      }
      if (best < 0) continue;
      const dx = f[best * CF] - f[o], dy = f[best * CF + 1] - f[o + 1], tx = f[o + C_TASTE], ty = f[o + C_TASTE + 1], tm = Math.hypot(tx, ty);
      const close = ((f[o + 2] - f[best * CF + 2]) * dx + (f[o + 3] - f[best * CF + 3]) * dy) / bd / R;
      const key = dl.join(','), G = groups[key] || (groups[key] = { n: 0, taste: 0, cos: 0, dist: 0, close: 0, far: 0, farCos: 0 });
      const cs = tm > 1e-6 ? (tx * dx + ty * dy) / (tm * bd) : 0;
      G.n++; G.taste += tm; G.cos += cs; G.dist += bd / R; G.close += close;
      if (bd > 5 * R) { G.far++; G.farCos += cs; }
    }
    for (const G of Object.values(groups)) {
      for (const k of ['taste', 'cos', 'dist', 'close']) G[k] /= G.n;
      G.farCos = G.far ? G.farCos / G.far : null;
    }
    return groups;
  }

  // ---------------------------------------------------------------- words
  panelLine(compact = false) {
    const p = this.params, c = this.census, on = (x) => (x ? 'on' : 'off');
    if (!p.nose && !p.taste && !p.clump && !p.armour) return 'SENSES  off';
    const parts = [`nose ${on(p.nose)}`, `taste ${p.taste ? (p.tasteNull ? 'NULL' : 'on') : 'off'}`, `clump ${on(p.clump)}`, `armour ${on(p.armour)}`];
    if (!c || !c.n) return `SENSES  ${parts.join(' · ')} …`;
    const dl = c.dials.map((x) => `${x.name.slice(0, 3)} ${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(2)}`).join(' ');
    if (compact) return `SENSES ${dl} rng ${c.range.mean.toFixed(2)} · chase ${c.chase.close.toFixed(2)} R/s · glued ${c.glued.meanSize.toFixed(1)}`;
    return `SENSES  ${parts.join(' · ')} · dials ${dl}, range ${c.range.mean.toFixed(2)} · follows taste ${c.taste.alignPath.toFixed(2)}, nose ${c.nose.alignPath.toFixed(2)}` +
      ` · predators close ${c.chase.close.toFixed(2)} R/s (others ${c.chase.baseClose.toFixed(2)}), ${c.chase.chases} chasing · prey open ${c.prey.open.toFixed(2)} R/s` +
      ` · glued groups ${c.glued.meanSize.toFixed(1)} (${Math.round(100 * c.glued.in4)} % in 4+) · wall exposed ${c.wall.exposed.toFixed(2)} / sheltered ${c.wall.sheltered.toFixed(2)}`;
  }
  overlayLines() {
    const p = this.params, c = this.census;
    const lines = [`senses (step P3): nose ${p.nose ? 'on' : 'off'} (tau ${p.tau} s, half ${p.noseHalf}/R, floor ${p.fuelFloor}) · taste ${p.taste ? (p.tasteNull ? 'NULL' : 'on') : 'off'} ` +
      `(${p.tasteSpeed} R/s, half ${p.tasteHalf}, range gain ${p.rangeGain}, cost ${p.rangeCost}/s) · clump ${p.clump ? 'on' : 'off'} (tug ${p.tug}) · shared armour ${p.armour ? 'on' : 'off'} (sheltered ${p.kinShare})` +
      ` · floors ${this.floors.map((x) => x.toPrecision(2)).join(' ')}`];
    if (c && c.n) {
      lines.push(`taste genes: ${c.dials.map((x) => `${x.name} ${x.mean.toFixed(3)} ± ${x.sd.toFixed(3)}${x.pred != null ? ` (predators ${x.pred.toFixed(2)})` : ''}`).join(' · ')} · range ${c.range.mean.toFixed(3)} ± ${c.range.sd.toFixed(3)}` +
        ` · taste felt by ${(100 * c.taste.feel).toFixed(0)} %, velocity ${c.taste.align.toFixed(3)}, path ${c.taste.alignPath.toFixed(3)} · nose felt ${(100 * c.nose.feel).toFixed(0)} %, velocity ${c.nose.align.toFixed(3)}, path ${c.nose.alignPath.toFixed(3)}`);
      lines.push(`chases: ${c.chase.preds} predators at ${c.chase.dist.toFixed(1)} R from prey, closing ${c.chase.close.toFixed(3)} R/s (${(100 * c.chase.chaseShare).toFixed(0)} % > 0.25), taste points at prey ${c.chase.point.toFixed(2)} vs others ${c.chase.baseClose.toFixed(3)} (${(100 * c.chase.baseChaseShare).toFixed(0)} %) · prey ${c.prey.n} opening ${c.prey.open.toFixed(3)} R/s` +
        ` · glued groups ${c.glued.groups}, mean size ${c.glued.meanSize.toFixed(2)}, largest ${c.glued.largest}, single ${(100 * c.glued.single).toFixed(0)} % · wall cover exposed ${c.wall.exposed.toFixed(3)} sheltered ${c.wall.sheltered.toFixed(3)} (${(100 * c.wall.shelteredSides).toFixed(0)} % of sides)`);
    }
    return lines;
  }
}
