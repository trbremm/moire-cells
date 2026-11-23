// Step N2, SUBSTANCES THAT FLOW (the user, 2026-11-23: "I also think that the nutrients need to flow more to pressure for activity", then
// "Not only nutrients, all substances"). README "Step N2: substances that flow". Until now food sat still: fixed springs, slow prescribed
// currents faded near walls, most carbon parked as immobile tar, heat never carried; a cell parked by a spring lived, so moving did not pay
// (step S2: no motor beat its neutral control). Five parts, each its own switch (?n2=0: all of them off, exactly as before):
//
//   ALL FLOW (part 2)     every mobile channel was already carried by the water (matter.wgsl spread, carbon.wgsl carbon_spread: upwind, flux
//                         form, whole counts); the HEAT was not (it only spread and leaked). Now the heat is carried too (heat.wgsl spread:
//                         the same corners' stream function, upwind, truncated the same from both pixels of an edge, so exact) (?heatflow=0)
//   GUSTS (part 2)        stronger, CHANGING currents: the N1 eddies and gyre x `strength`; each of the beat's three families of eddies swells and
//                         fades on its own slow clock (`gust`), the whole eddy pattern DRIFTS across the dish (`sweep` R/s, its heading turning
//                         slowly), and two basin-wide TIDAL modes turn round each other (`tide` R/s, one turn per `tidePeriod` s), so plumes
//                         sweep past cells and patches come and go. Still one stream function: divergence-free, exact (?gusts=0). The matter's
//                         substeps follow the fastest water (CFL: at most a tenth of a pixel per substep)
//   SCOUR (part 3)        what never moved (crust ll / LL, tar) is lifted where the water runs fast and drifts with it as BEDLOAD: across each
//                         pixel edge the bed moves with the edge's own flow share a, x carry x clamp((|a| - a_c) / a_c, 0, 1), a_c the speed
//                         that lifts it (`scourSpeed` R/s x its ROW: heavier is harder to lift; tar as row 1). No new channel: the same upwind
//                         edge flux as the water's, only switched on above a threshold (a Shields-like criterion), so the bed settles wherever
//                         the water slows (dead zones, the lee of pillars, inside bends): drifting crusts, sandbars. Exact (whole counts, the
//                         same number from both pixels of an edge). The TRACE that settles into the floor (step N1) now settles only where the
//                         water is slow (its bury rate x (1 - speed / its row's lifting speed)): fast water keeps it suspended (?scour=0)
//   PATCHY (part 4)       every LASTING scene spring (not the oases, which roam already, not a perfusion inlet, not a pipette drop) WANDERS
//                         slowly, PULSES, and after `life` s (+- half) goes dry; `gap` s later it rises somewhere else in the open water,
//                         gushing at first. Its rate x (1 + gap / life) while it runs, so the dish gets as much on average. Booked as every
//                         spring's drip, on the GPU, as it is dripped (?patchy=0)
//   CHEMOTAXIS (part 5)   the cells could already read where food is: the membrane's 6 corners smell the fuels (step C5; the carbon ladder's
//                         fuel C15b, trace T1a) and the crawl steers up that gradient (a fixed 0.5 R/s for every cell); a swimmer's front turns
//                         toward the same crawling intention (S2). Now how strongly a cell follows its nose is a GENE (Bio.mc.w, a log factor on
//                         the smell's gain: 0 = today's, founders 0; -3..1.5 = x 0.05 .. x 4.5); steering harder pushes harder, so it costs
//                         the crawl's work. ?chemo=0: the gene never mutates, every cell x 1 (as before); ?chemonull=1: the NEUTRAL control
//                         (the gene drifts, every cell x 1)
//
// Census (moire.flow.census, every `censusEvery` s of simulated time, a read-back of the cells): the motility genes (crawl motility, flagellum,
// cilia, chemotaxis), the smell (how many cells feel a gradient, how well their motion follows it), distance travelled per cell and per lifetime,
// and PATCH TRACKING (the share of cells within `near` R of a running spring, over the share of the open water that is). moire.flow.diagnose():
// part 1's numbers (which channels move, how fast, how long matter stays, how far it gets).

import { readBuffer } from './snapshot.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS, BIO_MO } from './genome.js';
import { SUBSTANCES, CH } from './matter.js';
import { CARBON, LADDER } from './carbon.js';

const TAU = 2 * Math.PI;
export const CHEMO = { ON: 1, NULL: 2 };   // Fields.g2.w bits (cell_step.wgsl CHEMO_*)
export const CHEMO_LO = -3, CHEMO_HI = 1.5;
const C_FLAGS = 9, C_SEED = 10, C_SMELL = 20;
const BIO_BODY = 4;   // Bio.body (x glue, y size, z motility, w heading)

function rng32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Flow {
  constructor(matter, seed = 1) {
    this.matter = matter;
    matter.flow = this;
    this.rng = rng32((seed ^ 0x0f10a7) >>> 0);
    // live-tunable: moire.flow.params; the rules panel's group "Substances that flow (step N2)"
    this.params = {
      on: true,            // ?n2=0: every part off (as before step N2)
      heat: true,          // the heat is carried by the water too (?heatflow=0)
      gusts: true,         // stronger, changing currents (?gusts=0)
      strength: 2,         // x the N1 eddies' and gyre's speed (?flowx=)
      gust: 0.6,           // each eddy family's strength swings by this share (?gust=)
      sweep: 0.25,         // R per s the eddy pattern drifts across the dish (?sweep=)
      sweepTurn: 0.06,     // its heading's slow random walk (rad per sqrt s: about a radian in 5 minutes)
      tide: 0.35,          // R per s of the two tidal modes at their strongest (?tide=)
      tidePeriod: 300,     // s for the tide to turn once round
      scour: true,         // crust and tar lifted by fast water, settling where it slows; trace settles only in slow water (?scour=0)
      scourSpeed: 0.7,     // R per s that starts lifting row-1 bed (x row; fully lifted at twice it) (?scourspeed=)
      carry: 0.5,          // the lifted bed moves at this share of the water's speed (?carry=)
      patchy: true,        // lasting springs wander, pulse, dry up and rise elsewhere (?patchy=0)
      life: 240,           // s a spring runs before it goes dry (each 0.5 to 1.5 x) (?springlife=)
      gap: 30,             // s before it rises elsewhere (each 0.5 to 1.5 x)
      wander: 0.12,        // R per s it wanders
      pulse: 0.5,          // its rate swings by this share ...
      period: [40, 120],   // ... over this many s (each its own)
      gush: 2.5,           // a risen spring gushes at first (x), settling over gushTime s
      gushTime: 25,
      chemo: true,         // the smell's gain is a gene (?chemo=0)
      chemoNull: false,    // ... its neutral control (?chemonull=1)
      censusEvery: 10,     // s of simulated time between the census's read-backs (0: never) (?flowcensus=)
      near: 10,            // R: "near a spring" for the patch tracking
    };
    this.obstacles = null; this.cells = null; this.water = null; this.view = null;   // set by main.js
    this.sweepX = 0; this.sweepY = 0; this.sweepA = TAU * this.rng(); this.lastT = null;
    this.gustPh = [0, 1, 2].map(() => TAU * this.rng());
    this.tracked = [];       // { s, rate0, vx, vy, period, phase, end, off (the time it rises again, or null) }
    this.census = null; this.series = []; this.busy = false; this.lastAt = -1e9;
    this.paths = new Map();  // slot -> { seed, x, y, path, born }
    this.lives = [];         // distances (R) of cells that died: [path, displacement, age]
  }

  get on() { return !!this.params.on; }
  get heatOn() { return this.on && !!this.params.heat; }
  get gustsOn() { return this.on && !!this.params.gusts; }
  get scourOn() { return this.on && !!this.params.scour; }
  get patchyOn() { return this.on && !!this.params.patchy; }
  get chemoBits() { const p = this.params; return this.on && p.chemo ? CHEMO.ON | (p.chemoNull ? CHEMO.NULL : 0) : 0; }

  resize(view) {
    if (this.view && (this.view.cssW !== view.cssW || this.view.cssH !== view.cssH)) {
      const sx = view.cssW / this.view.cssW, sy = view.cssH / this.view.cssH;
      for (const o of this.tracked) { o.vx *= sx; o.vy *= sy; }
    }
    this.view = view;
  }
  R() { return (this.matter.heat && this.matter.heat.R) || 6; }

  // ---------------------------------------------------------------- the currents (src/water.js asks)
  /** The water's words for this frame (struct WaterP n2a, n2b from word o), and the factor on the eddies' and gyre's amplitudes. */
  writeWater(f, o, t, W, H, R) {
    f[o] = 1; f[o + 1] = 1; f[o + 2] = 1; f[o + 3] = 0; f[o + 4] = 0; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
    if (!this.gustsOn) return 1;
    const p = this.params, g = Math.max(0, Math.min(0.95, p.gust));
    // each family of eddies on its own clock: two incommensurate swings, so the pattern never repeats exactly
    const P = [67, 103, 151];
    for (let m = 0; m < 3; m++) {
      const a = TAU * t / P[m] + this.gustPh[m];
      f[o + m] = 1 + g * (0.65 * Math.sin(a) + 0.35 * Math.sin(2.31 * a + 1.3 * m));
    }
    // the two tidal modes (2, 1) and (1, 2) of the basin, turning round each other: psi = T21 sin(2 pi x/W) sin(pi y/H) + T12 sin(pi x/W)
    // sin(2 pi y/H), amplitudes so that each one's fastest water runs at `tide` R/s
    const v = Math.max(0, p.tide) * R, w = TAU * t / Math.max(10, p.tidePeriod);
    f[o + 4] = v / Math.max(Math.PI / H, TAU / W) * Math.cos(w);
    f[o + 5] = v / Math.max(TAU / H, Math.PI / W) * Math.sin(w);
    return Math.max(0, p.strength);
  }
  /** The eddy pattern's drift so far (CSS px): its phases shift by -q . X. Advanced once per frame. */
  advance(t, R) {
    const dt = this.lastT == null ? 0 : Math.max(0, Math.min(1, t - this.lastT));
    this.lastT = t;
    if (!this.gustsOn || !(dt > 0)) return [this.sweepX, this.sweepY];
    const p = this.params;
    this.sweepA += (this.rng() - 0.5) * Math.sqrt(12 * dt) * Math.max(0, p.sweepTurn);   // (a random walk: its spread after s seconds ~ sweepTurn sqrt(s))
    const v = Math.max(0, p.sweep) * R;
    this.sweepX += Math.cos(this.sweepA) * v * dt; this.sweepY += Math.sin(this.sweepA) * v * dt;
    return [this.sweepX, this.sweepY];
  }
  /** An upper estimate of the fastest water (R per s), for the substeps. */
  fastest(base) {
    const p = this.params, s = this.gustsOn ? Math.max(0, p.strength) * (1 + Math.max(0, p.gust)) : 1;
    return base * s * 2.5 + (this.gustsOn ? Math.max(0, p.tide) : 0);
  }

  // ---------------------------------------------------------------- the matter (src/matter.js asks)
  /** Struct MatterP n2 (from word o): x the bed's lifting share per substep at row 1, y carry, z bits (1 bed, 2 trace settles by flow). */
  writeMatter(u, f, o, dtSub, px, R) {
    u.fill(0, o, o + 4);
    if (!this.scourOn) return;
    const p = this.params;
    f[o] = Math.max(1e-4, p.scourSpeed * R * dtSub / px);
    f[o + 1] = Math.max(0, Math.min(1, p.carry));
    u[o + 2] = 1 | 2;
  }
  /** The heat's tick words (struct HeatTick _p0: the corners' psi difference -> share of a pixel per substep, f32 bits; 0 = off). */
  heatScale(dtSub, px) { return this.heatOn ? dtSub / (px * px) : 0; }

  // ---------------------------------------------------------------- the springs (part 4)
  compute(encoder, frame) {
    if (!frame.ticks || !this.view) return;
    this.tick(frame.time);
    const M = this.matter, P = this.params, t = frame.time, dt = frame.dt, R = this.R(), v = this.view;
    if (!this.patchyOn) {
      // switched off: every spring back to its own rate, where it is
      for (const o of this.tracked) if (M.springs.includes(o.s)) o.s.rate = o.rate0;
      this.tracked = [];
      return;
    }
    this.tracked = this.tracked.filter((o) => M.springs.includes(o.s));
    for (const s of M.springs) {
      if (s.drop || s.kind === 'oasis' || s.kind === 'medium' || !(M.lifeOf(s) >= 1e8) || this.tracked.some((o) => o.s === s)) continue;
      const a = TAU * this.rng(), sp = P.wander * R;
      const rate0 = s.rate ?? M.params.rate;
      this.tracked.push({ s, rate0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, period: P.period[0] + (P.period[1] - P.period[0]) * this.rng(),
        phase: TAU * this.rng(), end: t + Math.max(10, P.life) * (0.5 + this.rng()), off: null, born: t - 1e3 });
    }
    const m = 0.06 * Math.min(v.cssW, v.cssH), comp = 1 + Math.max(0, P.gap) / Math.max(10, P.life);
    for (const o of this.tracked) {
      const s = o.s;
      if (o.off != null) {
        if (t < o.off) { s.rate = 0; continue; }
        // it rises elsewhere: a free place in the open water, away from the other springs
        const q = this.freePlace(m, R);
        if (q) { s.x = q[0]; s.y = q[1]; }
        o.off = null; o.born = t; o.end = t + Math.max(10, P.life) * (0.5 + this.rng());
      }
      if (t >= o.end) { o.off = t + Math.max(0, P.gap) * (0.5 + this.rng()); s.rate = 0; continue; }
      // a smooth random walk (the heading turns slowly), kept off the walls
      const sp = Math.max(0, P.wander) * R, ang = Math.atan2(o.vy, o.vx) + (this.rng() - 0.5) * 0.6 * Math.sqrt(dt);
      o.vx = Math.cos(ang) * sp; o.vy = Math.sin(ang) * sp;
      let nx = s.x + o.vx * dt, ny = s.y + o.vy * dt;
      const O = this.obstacles;
      if (O && O.active && O.sdAt(nx, ny).s < 1.5 * R) { o.vx = -o.vx; o.vy = -o.vy; nx = s.x; ny = s.y; }
      if (nx < m) { nx = m; o.vx = Math.abs(o.vx); } else if (nx > v.cssW - m) { nx = v.cssW - m; o.vx = -Math.abs(o.vx); }
      if (ny < m) { ny = m; o.vy = Math.abs(o.vy); } else if (ny > v.cssH - m) { ny = v.cssH - m; o.vy = -Math.abs(o.vy); }
      s.x = nx; s.y = ny;
      const g = 1 + Math.max(0, P.gush - 1) * Math.exp(-Math.max(0, t - o.born) / Math.max(1, P.gushTime));
      s.rate = o.rate0 * comp * g * Math.max(0, 1 + P.pulse * Math.sin(TAU * t / o.period + o.phase));
    }
  }
  /** A place in the open water (not in an obstacle, away from the edges and the other running springs), or null. */
  freePlace(m, R) {
    const v = this.view, O = this.obstacles && this.obstacles.active ? this.obstacles : null;
    let best = null, bestD = -1;
    for (let k = 0; k < 16; k++) {
      const q = [m + this.rng() * (v.cssW - 2 * m), m + this.rng() * (v.cssH - 2 * m)];
      if (O && O.sdAt(q[0], q[1]).s < 2 * R) continue;
      let d = 1e9;
      for (const s of this.matter.springs) if (s.rate !== 0) d = Math.min(d, Math.hypot(s.x - q[0], s.y - q[1]));
      if (d > bestD) { bestD = d; best = q; }
    }
    return best;
  }
  render() {}

  // ---------------------------------------------------------------- the cells (src/cells.js asks)
  /** Fields.g2.w: the chemotaxis gene's bits (u32). */
  writeFields(u, o) { u[o] = this.chemoBits; }

  // ---------------------------------------------------------------- the census
  tick(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || !this.cells || !this.cells.cellBuf || time - this.lastAt < every || this.busy) return;
    this.lastAt = time;
    this.read(time).catch((e) => console.warn('flow census:', e));
  }
  async read(time) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count, R = C.R;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
      const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
      const half = (C.eat && C.eat.params.smellHalf) || 0.05;
      const springs = this.matter.springs.filter((s) => (s.rate ?? 1) > 0 && !s.drop);
      const near2 = (this.params.near * R) ** 2;
      let N = 0, mot = 0, flag = 0, cil = 0, chemo = 0, chemo2 = 0, sm = 0, feel = 0, align = 0, nAlign = 0, speed = 0, nearN = 0, step = 0, nStep = 0;
      const seen = new Set(), gms = [];
      let pAlign = 0, nPAlign = 0;
      for (let i = 0; i < n; i++) {
        const o = i * CELL_FLOATS;
        if (!(u[o + C_FLAGS] & 1)) continue;
        N++;
        const b = i * BIO_FLOATS;
        mot += g[b + BIO_BODY + 2] || 0;
        flag += g[b + BIO_MO] || 0; cil += g[b + BIO_MO + 3] || 0;
        const ch = g[b + BIO_MO + 7] || 0;
        chemo += ch; chemo2 += ch * ch;
        const sx = f[o + C_SMELL], sy = f[o + C_SMELL + 1], gm = Math.hypot(sx, sy);
        const vx = f[o + 2], vy = f[o + 3], vm = Math.hypot(vx, vy);
        sm += gm; speed += vm / R; gms.push(gm / half);
        if (gm > 0.2 * half) { feel++; if (vm > 1e-6) { align += (vx * sx + vy * sy) / (vm * gm); nAlign++; } }
        const x = f[o], y = f[o + 1];
        if (springs.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < near2)) nearN++;
        // paths: the same slot and the same seed = the same cell
        seen.add(i);
        const seed = u[o + C_SEED], P = this.paths.get(i);
        if (P && P.seed === seed) {
          const dx = x - P.x, dy = y - P.y, dd = Math.hypot(dx, dy) / R;
          P.path += dd; step += dd; nStep++;
          // did it go where it smelled food at the last census? (the cosine between that smell and the way it went since)
          const pm = Math.hypot(P.sx, P.sy);
          if (pm > 0.2 * half && dd > 0.05) { pAlign += (dx * P.sx + dy * P.sy) / (pm * dd * R); nPAlign++; }
          P.x = x; P.y = y; P.sx = sx; P.sy = sy;
        } else {
          if (P) this.lives.push([P.path, Math.hypot(P.x - P.x0, P.y - P.y0) / R, time - P.born]);
          this.paths.set(i, { seed, x, y, x0: x, y0: y, path: 0, born: time, sx, sy });
        }
      }
      for (const [i, P] of this.paths) if (!seen.has(i)) { this.lives.push([P.path, Math.hypot(P.x - P.x0, P.y - P.y0) / R, time - P.born]); this.paths.delete(i); }
      while (this.lives.length > 5000) this.lives.shift();
      const dtc = this.prevAt != null ? time - this.prevAt : 0;
      this.prevAt = time;
      const L = this.lives.filter((x) => x[2] > 0), med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };
      const out = {
        time, n: N, springs: springs.length,
        motility: N ? mot / N : 0, flagellum: N ? flag / N : 0, cilia: N ? cil / N : 0,
        chemo: N ? chemo / N : 0, chemoSd: N ? Math.sqrt(Math.max(0, chemo2 / N - (chemo / N) ** 2)) : 0, chemoFactor: N ? Math.exp(chemo / N) : 1,
        smell: N ? sm / N : 0, smellRel: med(gms), feel: N ? feel / N : 0, align: nAlign ? align / nAlign : 0, alignPath: nPAlign ? pAlign / nPAlign : 0, speed: N ? speed / N : 0,
        // R per s actually travelled between two censuses (the path, not the jitter within)
        travel: nStep && dtc > 0 ? step / nStep / dtc : 0,
        lifePath: med(L.map((x) => x[0])), lifeDisp: med(L.map((x) => x[1])), lifeAge: med(L.map((x) => x[2])), lives: L.length,
        nearSpring: N ? nearN / N : 0, nearArea: this.nearArea(springs, near2), enrich: 0,
      };
      out.enrich = out.nearArea > 0 ? out.nearSpring / out.nearArea : 0;
      this.census = out;
      this.series.push([time, out.n, out.motility, out.flagellum, out.cilia, out.chemo, out.travel, out.enrich, out.align]);
      while (this.series.length > 2000) this.series.shift();
      return out;
    } finally {
      this.busy = false;
    }
  }
  /** The share of the open water within `near` of a running spring (sampled). */
  nearArea(springs, near2) {
    const v = this.view, O = this.obstacles && this.obstacles.active ? this.obstacles : null;
    if (!v || !springs.length) return 0;
    let n = 0, k = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 64; x++) {
        const px = (x + 0.5) / 64 * v.cssW, py = (y + 0.5) / 40 * v.cssH;
        if (O && O.sdAt(px, py).a < 0) continue;
        n++;
        if (springs.some((s) => (s.x - px) ** 2 + (s.y - py) ** 2 < near2)) k++;
      }
    }
    return n ? k / n : 0;
  }

  /** Part 1: the numbers. Which channels move (spread R^2/s, carried or not), the water's speed, the matter in the dish and how long it stays
   *  (atoms in the dish / atoms added per s), how far that takes it by spreading (sqrt(4 D tau)) and by the water (mean speed x tau). */
  async diagnose() {
    const M = this.matter, W = this.water, R = this.R();
    const st = W ? await W.stats() : null;
    const u = st && st.current ? st.current.mean : 0;
    const p0 = this._diag0;
    const now = { time: M.time, add: Array.from(M.tot.add), dish: Array.from(M.dish), cadd: CARBON ? Array.from(M.carbon.tot.add || []) : [], cdish: CARBON ? Array.from(M.carbon.dish) : [] };
    this._diag0 = now;
    const dt = p0 ? now.time - p0.time : 0;
    const rows = SUBSTANCES.map((s, c) => {
      const rate = dt > 0 ? (now.add[c] - p0.add[c]) / dt : null;
      const tau = rate > 0 ? now.dish[c] / rate : null;
      const D = s.spread * M.params.spreadGain;
      return { name: s.name, kind: s.kind, spread: D, carried: D > 0 || this.scourOn, bed: D === 0, dish: now.dish[c], addRate: rate, tau,
        byDiffusion: tau ? Math.sqrt(4 * D * tau) : null, byWater: tau ? u * tau : null };
    }).filter((r) => r.dish > 0 || (r.addRate || 0) > 0);
    const carbon = CARBON ? {
      ladder: LADDER.map((nm, j) => ({ name: nm, dish: now.cdish[j] })), tar: now.cdish.slice(5).reduce((a, b) => a + b, 0),
      tarShare: now.cdish.reduce((a, b) => a + b, 0) > 0 ? now.cdish.slice(5).reduce((a, b) => a + b, 0) / now.cdish.reduce((a, b) => a + b, 0) : 0,
    } : null;
    return { time: M.time, water: st ? st.current : null, interval: dt, channels: rows, carbon, trace: { buried: M.oases ? M.oases.params.bury : 0, ch: CH.trace },
      cells: this.census };
  }

  panelLine(compact = false) {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    if (!this.on) return compact ? 'FLOW off' : 'FLOW  (step N2) off';
    const c = this.census;
    const cs = c ? ` · cells travel ${c.travel.toFixed(2)} R/s, chemotaxis x${c.chemoFactor.toFixed(2)}, ${(100 * c.feel).toFixed(0)} % smell food, near springs x${c.enrich.toFixed(2)}` : '';
    if (compact) return `FLOW x${p.strength}${this.scourOn ? ' scour' : ''}${this.patchyOn ? ' patchy' : ''}${cs}`;
    return `FLOW  currents x${p.strength} (gusts ${on(p.gusts)}, sweep ${p.sweep} R/s, tide ${p.tide} R/s) · heat carried ${on(p.heat)} · scour ${on(p.scour)} (lifts from ${p.scourSpeed} R/s x row) · ` +
      `springs ${p.patchy ? `patchy (${this.tracked.filter((o) => o.off == null).length} running, ${this.tracked.filter((o) => o.off != null).length} dry)` : 'fixed'} · chemotaxis gene ${p.chemo ? (p.chemoNull ? 'null' : 'on') : 'off'}${cs}`;
  }
  overlayLines() {
    const p = this.params;
    return [`flow (step N2): ${this.on ? 'on' : 'off'} · strength ${p.strength}, gust ${p.gust}, sweep ${p.sweep} R/s, tide ${p.tide} R/s / ${p.tidePeriod} s · scour from ${p.scourSpeed} R/s, carry ${p.carry} · ` +
      `springs life ${p.life} s, gap ${p.gap} s · chemo ${p.chemo}${p.chemoNull ? ' (null)' : ''}`];
  }
}
