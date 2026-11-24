// Step L1, THE TISSUE LAB'S ORGAN (BUILD QUEUE 6a6d; README "Step L1"): a composite tissue laid out in one go from the four hand-wired designs
// of src/tissues.js (muscle, nerve, skin, pacemaker), a scientist's hand. Nothing here is a rule of the simulation: the layout only says where
// each cell starts, which genome it carries and which way its front points (and so its spindle). What happens next is the genes'.
//
//   muscle   (?tissue=organ, the default kind) a BUNDLE of muscle spindles glued end to end in staggered fibres (bricks); a NERVE of long relay
//            cells along its top, touching it, running out through the skin on the left (where the pipette pokes it); a SKIN of flat walled
//            cells round the whole (a stadium). Tap the nerve's free end with the signal pipette: a flash runs along the nerve, the muscle
//            fires and shortens, the skin flexes
//   ring     (?organ=ring) a BEATING RING: a closed loop of muscle spindles end to end (a tube's cross-section), a pacemaker cell on it (with
//            ?pacemaker=1, else poke it), skin outside: the contraction runs round
//   worm     (?organ=worm) a WORM: two muscle bundles side by side along the body, each with its own nerve on its outer side, skin round all;
//            fire one side's nerve and then the other's (moire.organ.wriggle()) and the body bends one way, then the other
//
// moire.organ: cells(kind, opts) (R units), layout for the culture (src/culture.js 'organ'), place(kind, { x, y, angle }) into a living dish
// (cells in the footprint are moved out to its rim first: room cleared, nothing killed, the books untouched), poke(which) (the signal pipette
// on the nerve's free end), measure() (now: the bundle's length, who fires, junctions, survival), twitch(opts) (poke and follow: shortening %,
// the nerve's signal speed, junctions torn, survival), the ORGAN panel line, release() (to evolution: mutation and turnover on).

import { CELL_FLOATS, CELL_BYTES } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { muscleGenome, nerveGenome, skinGenome, pacemakerGenome } from './tissues.js';
import { readBuffer, frames, settle } from './snapshot.js';
import { conDrive } from './contract.js';

export const ORGAN_KINDS = ['muscle', 'ring', 'worm'];
export const ORGAN_DESIGNS = ['muscle', 'nerve', 'skin', 'pacemaker'];   // the founders' order (founder k = design k)
const FOUNDER_IDS = [740, 750, 760, 770];
const C_FLAGS = 9, C_KIND = 8, C_FRONT = 64, C_MOTW = 93;
const B_FOUNDER = 7, B_SSW = 239, B_GX0 = 84;
// the spindles' lengths (capsule 2 (h + rho), area kept): 4:1 -> 3.64 R long, 0.91 R wide; 2.5:1 (skin) 2.93 R long, 1.17 R wide
const cap = (A) => { const rho = Math.sqrt(Math.PI / (Math.PI + 4 * (A - 1))); return { len: 2 * A * rho, wid: 2 * rho }; };
const M4 = cap(4), S25 = cap(2.5);

/** The muscle's and nerve's spindle aspect (opts.aspect, 1.5..4). */
export function organAspect(opts = {}) { return Math.max(1.5, Math.min(4, Number(opts.aspect) || ORGAN_ASPECT)); }
export const ORGAN_ASPECT = 4;
export const ORGAN_CON = 3;   // the muscle's contraction gene: a firing relay's output factor (0.25 .. 0.7) contracts it nearly fully
/** A genome per design (the founders, in ORGAN_DESIGNS' order), opts: aspect (the spindles'), glue, con (the muscle's contraction gene). */
export function organGenomes(rng = Math.random, opts = {}) {
  const G = [muscleGenome(rng, 740, opts.con ?? ORGAN_CON), nerveGenome(rng), skinGenome(rng), pacemakerGenome(rng)];
  const la = Math.log(organAspect(opts));
  G[0][13] = la; G[1][13] = la;
  if (opts.glue > 0) for (const g of G) g[16] = Math.max(0.05, Math.min(4, opts.glue));
  if (opts.muscleSheet) {   // (the sheet's relay biases and rest for the muscle: less excitable)
    const b = 84;
    G[0][b + 8] = 1; G[0][b + 9] = 0; G[0][b + 10] = 1; G[0][b] = 0.75; G[0][b + 1] = 0.18; G[0][b + 2] = 0.17;
  }
  return G;
}

/** Skin cells round a stadium (half-width a, half-height b, both to the skin's middle line), spaced `gap` R along it, skipping where `skip`
 * (x, y) says; front = the tangent. */
function stadium(out, a, b, gap, skip) {
  const st = Math.max(0, a - b), per = 4 * st + 2 * Math.PI * b, n = Math.max(6, Math.round(per / gap)), d = per / n;
  for (let k = 0; k < n; k++) {
    let s = (k + 0.5) * d, x, y, t;
    if (s < 2 * st) { x = -st + s; y = b; t = 0; }
    else if ((s -= 2 * st) < Math.PI * b) { const a0 = Math.PI / 2 - s / b; x = st + b * Math.cos(a0); y = b * Math.sin(a0); t = a0 - Math.PI / 2; }
    else if ((s -= Math.PI * b) < 2 * st) { x = st - s; y = -b; t = Math.PI; }
    else { s -= 2 * st; const a0 = -Math.PI / 2 - s / b; x = -st + b * Math.cos(a0); y = b * Math.sin(a0); t = a0 - Math.PI / 2; }
    if (skip && skip(x, y)) continue;
    out.push({ x, y, front: t, d: 2 });
  }
}

/** A bundle of F fibres (staggered: every other fibre one cell shorter, half a cell along) of L muscle spindles, along x, centred at y0. */
function bundle(out, F, L, y0, dy, stagger = true, M4 = cap(4)) {
  for (let j = 0; j < F; j++) {
    const odd = stagger && j % 2 === 1, n = odd ? L - 1 : L;
    for (let k = 0; k < n; k++) out.push({ x: (k - (n - 1) / 2) * M4.len, y: y0 + (j - (F - 1) / 2) * dy, front: 0, d: 0 });
  }
}

/**
 * The organ's cells in R units round (0, 0), along x: [{ x, y, front, d }] (d: 0 muscle, 1 nerve, 2 skin, 3 pacemaker). opts: fibres (5),
 * length (6 cells per fibre), pacemaker (false), ringCells (16).
 */
export function organCells(kind = 'muscle', opts = {}) {
  const M4 = cap(organAspect(opts));
  const out = [], dy = 1.04 * M4.wid;   // fibres side by side (their capsules just apart)
  const pace = !!opts.pacemaker;
  if (kind === 'ring') {
    // a loop of muscle spindles end to end (radius from the count), a second, staggered loop inside it; the pacemaker (or a nerve cell to
    // poke) just outside the outer loop; skin round the outside
    const n = Math.max(8, Math.round(opts.ringCells || 16)), r0 = n * M4.len / (2 * Math.PI), r1 = r0 - dy;
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * 2 * Math.PI; out.push({ x: r0 * Math.cos(a), y: r0 * Math.sin(a), front: a + Math.PI / 2, d: 0 }); }
    const n1 = Math.max(6, Math.round(2 * Math.PI * r1 / M4.len));
    for (let k = 0; k < n1; k++) { const a = k / n1 * 2 * Math.PI; out.push({ x: r1 * Math.cos(a), y: r1 * Math.sin(a), front: a + Math.PI / 2, d: 0 }); }
    const rs = r0 + 0.5 * M4.wid + 0.55 * S25.wid + 0.05, ns = Math.max(8, Math.round(2 * Math.PI * rs / (0.98 * S25.len)));
    const gapA = 2.2 / rs;   // a gap in the skin at angle 0 where the trigger cell sits
    for (let k = 0; k < ns; k++) {
      const a = (k + 0.5) / ns * 2 * Math.PI;
      if (opts.noskin || Math.abs(((a + Math.PI) % (2 * Math.PI)) - Math.PI) < gapA) continue;
      out.push({ x: rs * Math.cos(a), y: rs * Math.sin(a), front: a + Math.PI / 2, d: 2 });
    }
    out.push({ x: rs, y: 0, front: Math.PI / 2, d: pace ? 3 : 1 });
    return out;
  }
  if (kind === 'worm') {
    // two bundles (each F/2 fibres, at least 2) one above the other, a nerve along each outer side, skin round all
    const F = Math.max(2, Math.round((opts.fibres || 4) / 2)), L = Math.max(3, Math.round(opts.length || 7));
    const hb = (F - 1) / 2 * dy + 0.5 * dy;
    bundle(out, F, L, hb, dy, opts.stagger !== false, M4);
    bundle(out, F, L, -hb, dy, opts.stagger !== false, M4);
    const yN = 2 * hb + 0.5 * dy + 0.05 * dy, half = L * M4.len / 2;
    const nN = L + 1;
    for (const sgn of [1, -1]) for (let k = 0; k < nN; k++) out.push({ x: -half - 1.5 * M4.len + (k + 0.5) * M4.len, y: sgn * (yN + 0.5 * dy), front: 0, d: 1 });
    const a = half + 0.9, b = yN + 0.5 * dy + 0.5 * M4.wid + 0.55 * S25.wid;
    if (!opts.noskin) stadium(out, a, b, 0.98 * S25.len, (x, y) => x < -a + 1.5 && Math.abs(Math.abs(y) - (yN + 0.5 * dy)) < 1.6);
    return out;
  }
  // muscle: a bundle, a nerve on top (out through the skin on the left), skin round
  const F = Math.max(1, Math.round(opts.fibres || 5)), L = Math.max(2, Math.round(opts.length || 6));
  bundle(out, F, L, 0, dy, opts.stagger !== false, M4);
  const yTop = (F - 1) / 2 * dy, yN = yTop + dy, half = L * M4.len / 2;   // (the nerve's first row just above the top fibre)
  // the nerve: two staggered rows of long relay cells (a chain alone passes a pulse badly: each cell hears only the one before it), one
  // cell longer than the bundle, its free end out over the bundle's left end (where the pipette pokes it), inside the skin
  const nR = Math.max(1, Math.round(opts.nerveRows || 2)), nN = L + 1;
  for (let r = 0; r < nR; r++) {
    for (let k = 0; k < nN - (r % 2); k++) out.push({ x: -half - 0.6 * M4.len + (k + 0.5 + 0.5 * (r % 2)) * M4.len, y: yN + r * dy, front: 0, d: pace && r === 0 && k === 0 ? 3 : 1 });
  }
  const lo = -yTop - 0.5 * M4.wid, hi = yN + (nR - 1) * dy + 0.5 * M4.wid, mid = (lo + hi) / 2;
  for (const c of out) c.y -= mid;
  const b = (hi - lo) / 2 + 0.55 * S25.wid + 0.1, a = half + 0.6 * M4.len + 0.3;
  if (!opts.noskin) stadium(out, a, b, 0.98 * S25.len, null);
  return out;
}

/** The culture's layout (src/culture.js cultureLayout, spread 'organ'): dish coordinates, founder (= design), front, the stretch to start with. */
export function organLayout(kind, opts, W, H, R) {
  const list = organCells(kind, opts), ang = Number(opts.angle) || 0, c = Math.cos(ang), s = Math.sin(ang);
  const la = 0.5 * Math.log(organAspect(opts)), stretch = [la, la, 0.5 * Math.log(2.5), 0.5 * Math.log(2)];
  return {
    n: list.length,
    founder: (i) => list[i].d,
    at: (i) => [W / 2 + R * (c * list[i].x - s * list[i].y), H / 2 + R * (s * list[i].x + c * list[i].y)],
    front: (i) => list[i].front + ang,
    stretch: (i) => stretch[list[i].d],
  };
}

/**
 * The organ lab's GROOVE (a scientist's chip, as engineered muscle is grown in a channel): POROUS walls (they stop cells, not water or
 * substances; step G0b) along both long sides of the laid-out organ, `gap` R outside its outermost cells, a little longer than it, so the
 * organ cannot spread sideways while its length is free; the ring sits in a round well. The worm gets none (it is meant to move).
 */
export function organGroove(obs, organ, W, H, R, gap = 0.6) {
  if (!obs || !organ || organ.kind === 'worm') return 0;
  const list = organCells(organ.kind, organ.opts), ang = Number(organ.opts.angle) || 0, c = Math.cos(ang), s = Math.sin(ang);
  const half = 1.5;   // (the outermost cells' half width, about: the skin's 1.17 R / 2 and a margin)
  const P = (x, y) => [W / 2 + R * (c * x - s * y), H / 2 + R * (s * x + c * y)];
  if (organ.kind === 'ring') {
    const rr = list.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y)), 0) + half + gap, n = 48, pts = [];
    for (let k = 0; k <= n; k++) { const a = k / n * 2 * Math.PI; pts.push(P(rr * Math.cos(a), rr * Math.sin(a))); }
    obs.path(pts, 1.2 * R, 'porous');
    return 1;
  }
  const xm = list.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0) + 3, ym = list.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0) + half + gap;
  obs.path([P(-xm, ym + 0.6), P(xm, ym + 0.6)], 1.2 * R, 'porous');
  obs.path([P(-xm, -ym - 0.6), P(xm, -ym - 0.6)], 1.2 * R, 'porous');
  return 2;
}

export class Organ {
  constructor(M) {
    this.M = M;
    this.kind = null;     // what was laid out (the culture's, or the last place())
    this.opts = {};
    this.angle = 0;
    this.centre = null;   // dish coordinates
    this.n0 = 0;          // cells laid out
    this.last = null;     // the last twitch's numbers
    this.census = null;   // the last measure()
    this.pokeR = 1.8;     // the poke's radius (R): a few cells at the nerve's free end (one cell alone often fails to start a pulse)
  }

  /** The founder id of each design (to tell the organ's cells apart). */
  static designOf(fid) { const k = FOUNDER_IDS.indexOf(Math.round(fid)); return k; }

  /** Read the organ's cells back: per design its live cells, [x, y, front, firing, onset], and the junction word. */
  async read() {
    const M = this.M, C = M.cells, d = M.gpu.device, n = C.count;
    const [cellAB, bioAB] = await Promise.all([readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4), readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4)]);
    const f = new Float32Array(cellAB), u = new Uint32Array(cellAB), g = new Float32Array(bioAB);
    const by = [[], [], [], []], acts = !!(C.grn && C.grn.acts);
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FLOATS;
      if (!(u[o + C_FLAGS] & 1)) continue;
      const k = Organ.designOf(g[i * BIO_FLOATS + B_FOUNDER]);
      if (k < 0) continue;
      const w = u[o + C_KIND];
      // (FIRING: the relays' release regulator r0 low, its release factor e^(-8 x0) above 0.1; the flash (Cell.motW) shows only the onset)
      by[k].push({ i, x: f[o], y: f[o + 1], front: f[o + C_FRONT], e: Math.hypot(f[o + 6], f[o + 7]), fire: k === 2 ? 0 : Math.exp(-8 * Math.max(0, g[i * BIO_FLOATS + B_GX0])) / 0.3,
        flash: ((u[o + C_MOTW] >>> 24) & 255) / 255,
        onset: g[i * BIO_FLOATS + B_SSW], formed: ((w >>> 8) & ~w & 63), torn: w & 63, drive: conDrive(g, i * BIO_FLOATS, acts) });
    }
    return by;
  }

  /** The organ's axis (unit) and centre: the laid-out angle, else the muscle cells' principal axis. */
  axisOf(mus) {
    if (this.kind === 'muscle' || this.kind === 'worm') return [Math.cos(this.angle), Math.sin(this.angle)];
    let sx = 0, sy = 0;
    for (const p of mus) { sx += p.x; sy += p.y; }
    return [1, 0];
  }

  /**
   * Now: the bundle's LENGTH (muscle cells' extent along the organ's axis, centre to centre, in R), its width, the ring's mean radius, cells
   * per design and alive against laid out, firing now, formed and torn junction sides, the nerve's onset times along it.
   */
  async measure() {
    const M = this.M, R = M.cells.R, by = await this.read();
    const [mus, ner, skin, pace] = by;
    const ax = this.axisOf(mus), pr = (p) => p.x * ax[0] + p.y * ax[1], pp = (p) => -p.x * ax[1] + p.y * ax[0];
    const stat = (L, f) => { if (!L.length) return null; const v = L.map(f).sort((a, b) => a - b); return { lo: v[0], hi: v[v.length - 1], span: v[v.length - 1] - v[0] }; };
    const len = stat(mus, pr), wid = stat(mus, pp);
    // with the cells' own lengths: each muscle cell's capsule half-length along the axis (its outline's aspect, area kept), the bundle's
    // extent end to end, and the cells' summed length (what they would make laid end to end: shortens with every cell that contracts)
    const hl = (p) => { const A = Math.exp(2 * p.e), rho = Math.sqrt(Math.PI / (Math.PI + 4 * (A - 1))); return A * rho * R * Math.abs(Math.cos(p.front - Math.atan2(ax[1], ax[0]))); };
    const ends = mus.length ? (Math.max(...mus.map((p) => pr(p) + hl(p))) - Math.min(...mus.map((p) => pr(p) - hl(p)))) / R : 0;
    const sumLen = mus.reduce((a, p) => a + 2 * hl(p), 0) / R;
    let cx = 0, cy = 0;
    for (const p of mus) { cx += p.x; cy += p.y; }
    cx /= Math.max(1, mus.length); cy /= Math.max(1, mus.length);
    const ringR = mus.length ? mus.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / mus.length / R : 0;
    const all = [...mus, ...ner, ...skin, ...pace];
    const aspect = mus.length ? mus.reduce((a, p) => a + Math.exp(2 * p.e), 0) / mus.length : 0;
    const fm = mus.filter((p) => p.fire > 0.3), rm = mus.filter((p) => !(p.fire > 0.3));
    // the muscle's ORDER: how well the spindles' fronts keep to the organ's axis (mean cos 2 (front - axis): 1 aligned, 0 random)
    const axA = Math.atan2(ax[1], ax[0]);
    const order = mus.length ? mus.reduce((a, p) => a + Math.cos(2 * (p.front - axA)), 0) / mus.length : 0;
    const aspFiring = fm.length ? fm.reduce((a, p) => a + Math.exp(2 * p.e), 0) / fm.length : null;
    const aspResting = rm.length ? rm.reduce((a, p) => a + Math.exp(2 * p.e), 0) / rm.length : null;
    // the skin's shape: its cells' mean distance from the organ's centre along and across the axis
    const skinL = stat(skin, pr), skinW = stat(skin, pp);
    this.census = {
      time: M.time(), kind: this.kind,
      cells: { muscle: mus.length, nerve: ner.length, skin: skin.length, pacemaker: pace.length, all: all.length, laidOut: this.n0 },
      survival: this.n0 ? all.length / this.n0 : null,
      length: len ? len.span / R : 0, ends, sumLen, width: wid ? wid.span / R : 0, ringR, aspect, aspFiring, aspResting, order,
      drive: mus.length ? mus.reduce((a, p) => a + p.drive, 0) / mus.length : 0, contracting: mus.filter((p) => p.drive > 0.3).length,
      nerveJunctions: ner.length ? ner.reduce((a, p) => a + bits(p.formed), 0) / ner.length : 0,
      skin: { length: skinL ? skinL.span / R : 0, width: skinW ? skinW.span / R : 0 },
      firing: { muscle: mus.filter((p) => p.fire > 0.3).length, nerve: ner.filter((p) => p.fire > 0.3).length },
      junctions: { formed: all.reduce((a, p) => a + bits(p.formed), 0) / 2, torn: all.reduce((a, p) => a + bits(p.torn), 0) },
      nerve: ner.map((p) => [pr(p) / R, p.onset]),
      muscleOnsets: mus.map((p) => [pr(p) / R, p.onset]),
    };
    return this.census;
  }

  /** The nerve's free end (dish coordinates): the nerve cell furthest along -axis (the ring: the trigger cell, outermost). */
  async nerveEnd() {
    const by = await this.read(), ner = by[1];
    if (!ner.length) return null;
    if (this.kind === 'ring') return ner[0];
    const ax = this.axisOf(by[0]);
    return ner.reduce((b, p) => (p.x * ax[0] + p.y * ax[1] < b.x * ax[0] + b.y * ax[1] ? p : b));
  }

  /** POKE: the signal pipette's touch on the nerve's free end (or on (x, y)): the cells under it hear the signal for a moment and fire. */
  async poke(x = null, y = null, side = 0) {
    const Q = this.M.signals;
    if (!Q || !Q.on) return false;
    if (x == null) {
      if (this.kind === 'worm') {   // one side's nerve: its cells are above (side 0) or below (1) the axis
        const v = this.M.cells.view, ctr = this.centre || [v.cssW / 2, v.cssH / 2];
        const by = await this.read(), ax = this.axisOf(by[0]), ner = by[1].filter((p) => (side ? -1 : 1) * ((p.y - ctr[1]) * ax[0] - (p.x - ctr[0]) * ax[1]) > 0);
        if (!ner.length) return false;
        const e = ner.reduce((b, p) => (p.x * ax[0] + p.y * ax[1] < b.x * ax[0] + b.y * ax[1] ? p : b));
        x = e.x; y = e.y;
      } else {
        const e = await this.nerveEnd();
        if (!e) return false;
        x = e.x; y = e.y;
      }
    }
    const r = Q.params.puffRadius;
    Q.params.puffRadius = this.pokeR;   // (the electrode's tip: the end cells of the nerve, 1.8 R)
    Q.drop(x, y, 0);
    Q.params.puffRadius = r;
    return { x, y };
  }

  /**
   * A TWITCH: measure at rest, poke the nerve's free end, follow for `follow` s of simulated time (a read-back every `every` s): the bundle's
   * shortest length against rest (shortening %), when, the nerve's signal SPEED (a straight fit of onset time against place along the nerve,
   * for the cells that fired after the poke), the muscle's onsets, junctions torn (G0's cumulative tears, this dish), cells alive.
   */
  async twitch(opts = {}) {
    const M = this.M, follow = opts.follow ?? 12, every = opts.every ?? 0.25, ctl = M.control, was = ctl.paused();
    if (was) ctl.setPaused(false);   // (it follows the twitch as the dish runs)
    try { return await this._twitch(follow, every, opts); } finally { if (was) ctl.setPaused(true); }
  }
  async _twitch(follow, every, opts) {
    const M = this.M;
    const rest = await this.measure();
    const tears0 = M.glue && M.glue.census ? M.glue.census.tears : 0;
    const t0 = M.time();
    await this.poke(null, null, opts.side || 0);
    const series = [];
    let minL = rest.ends, minAt = t0, maxW = rest.width;
    while (M.time() < t0 + follow) {
      const t1 = M.time();
      while (M.time() < t1 + every) await frames(1);
      const c = await this.measure();
      series.push([+(c.time - t0).toFixed(2), +c.ends.toFixed(3), +c.width.toFixed(3), c.firing.muscle, c.firing.nerve, +c.ringR.toFixed(3), +c.skin.length.toFixed(2)]);
      if (c.ends < minL) { minL = c.ends; minAt = c.time - t0; }
      if (c.width > maxW) maxW = c.width;
    }
    const end = this.census;
    // the nerve's speed: onsets after the poke, against place along the axis (least squares, R per s)
    const pts = end.nerve.filter((p) => p[1] >= t0 - 0.05);
    let speed = null;
    if (pts.length >= 3) {
      const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, mt = pts.reduce((a, p) => a + p[1], 0) / n;
      let sxt = 0, stt = 0;
      for (const p of pts) { sxt += (p[0] - mx) * (p[1] - mt); stt += (p[1] - mt) ** 2; }
      speed = stt > 0 ? Math.abs(sxt / stt) : null;
    }
    const mOn = end.muscleOnsets.filter((p) => p[1] >= t0 - 0.05).map((p) => p[1] - t0).sort((a, b) => a - b);
    const tears1 = M.glue && M.glue.census ? M.glue.census.tears : 0;
    this.last = {
      time: t0, rest: rest.ends, min: minL, shortening: rest.ends ? 1 - minL / rest.ends : 0, sumRest: rest.sumLen, at: minAt, widthRest: rest.width, widthMax: maxW,
      ringRest: rest.ringR, nerveSpeed: speed, nerveFired: pts.length, nerveCells: end.nerve.length,
      muscleFired: mOn.length, muscleCells: end.cells.muscle, muscleFirst: mOn.length ? mOn[0] : null, muscleMedian: mOn.length ? mOn[mOn.length >> 1] : null,
      torn: Math.max(0, tears1 - tears0), tornNow: end.junctions.torn, formed: end.junctions.formed, survival: end.survival, series,
    };
    return this.last;
  }

  /** The worm's wriggle: twitch one side, wait, the other, `beats` times (each half `half` s). */
  async wriggle(beats = 3, half = 6) {
    const out = [];
    for (let k = 0; k < 2 * beats; k++) {
      await this.poke(null, null, k % 2);
      const t1 = this.M.time();
      while (this.M.time() < t1 + half) await frames(2);
      out.push(await this.measure());
    }
    return out.map((c) => ({ t: c.time, length: c.length, width: c.width }));
  }

  /**
   * Place an organ into the living dish at (x, y) (dish coordinates; default the view's centre), turned by `angle`: the cells inside its
   * footprint are first MOVED OUT to its rim (room cleared: nothing dies, the books are untouched), then each design's cells are added with
   * the add-cell tool (the starter charge booked in) and their fronts set.
   */
  async place(kind = 'muscle', opts = {}) {
    const M = this.M, C = M.cells, R = C.R, d = M.gpu.device;
    if (!M.app) throw new Error('the app is not ready');
    const cam = M.camera, v = C.view;
    const x = opts.x ?? (cam && cam.z ? cam.x + cam.W / (2 * cam.z) : v.cssW / 2), y = opts.y ?? (cam && cam.z ? cam.y + cam.H / (2 * cam.z) : v.cssH / 2);
    const ang = Number(opts.angle) || 0, cs = Math.cos(ang), sn = Math.sin(ang);
    const list = organCells(kind, opts);
    const pts = list.map((p) => ({ ...p, X: x + R * (cs * p.x - sn * p.y), Y: y + R * (sn * p.x + cs * p.y), F: p.front + ang }));
    // the footprint: the laid-out cells' bounding circle, plus 2 R
    let rr = 0;
    for (const p of pts) rr = Math.max(rr, Math.hypot(p.X - x, p.Y - y));
    rr += 2 * R;
    const ctl = M.control, was = ctl.paused();
    try {
      await settle(M, ctl, false);
      const n = C.count, ab = await readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4), f = new Float32Array(ab), u = new Uint32Array(ab);
      for (let i = 0; i < n; i++) {
        const o = i * CELL_FLOATS;
        if (!(u[o + C_FLAGS] & 1)) continue;
        const dx = f[o] - x, dy = f[o + 1] - y, dd = Math.hypot(dx, dy);
        if (dd >= rr) continue;
        const a = dd > 1e-3 ? Math.atan2(dy, dx) : Math.random() * 2 * Math.PI, to = rr + Math.random() * 2 * R;
        d.queue.writeBuffer(C.cellBuf, i * CELL_BYTES, new Float32Array([x + to * Math.cos(a), y + to * Math.sin(a), 0, 0]));
      }
      await d.queue.onSubmittedWorkDone();
    } finally { ctl.setPaused(was); }
    const G = organGenomes(Math.random, opts);
    for (let k = 0; k < 4; k++) {
      const P = pts.filter((p) => p.d === k);
      if (P.length) await M.app.place(P.map((p) => [p.X, p.Y, p.F, k === 2 ? 0.5 * Math.log(2.5) : k === 3 ? 0.5 * Math.log(2) : 0.5 * Math.log(organAspect(opts))]), G[k], `organ: ${ORGAN_DESIGNS[k]}`);
    }
    this.kind = kind; this.opts = opts; this.angle = ang; this.centre = [x, y]; this.n0 = pts.length;
    return { cells: pts.length, x, y, r: rr / R };
  }

  /** RELEASE to evolution: mutation and turnover (births and deaths) on, as the keys M and T. */
  release() {
    const r = this.M.genome.rules;
    r.mut = true; r.turn = true;
    return 'released to evolution: mutation and the life cycle on';
  }

  panelLine(compact = false) {
    const c = this.census, t = this.last;
    if (!this.kind) return null;
    if (!c) return 'ORGAN …';
    const tw = t ? ` · last twitch ${(100 * t.shortening).toFixed(0)}% shorter end to end${t.nerveSpeed ? `, nerve ${t.nerveSpeed.toFixed(1)} R/s` : ''}, ${t.torn} torn` : '';
    if (compact) return `ORGAN ${this.kind} ${c.cells.all}/${c.cells.laidOut}${tw}`;
    return `ORGAN  ${this.kind}: ${c.cells.muscle} muscle · ${c.cells.nerve} nerve · ${c.cells.skin} skin${c.cells.pacemaker ? ` · ${c.cells.pacemaker} pacemaker` : ''}` +
      ` (alive ${c.cells.all} of ${c.cells.laidOut}) · bundle ${c.ends.toFixed(1)} × ${c.width.toFixed(1)} R end to end (cells ${c.sumLen.toFixed(0)} R laid end to end)` +
      ` · firing ${c.firing.nerve} nerve, ${c.firing.muscle} muscle · contracting ${c.contracting}` +
      ` · junctions ${c.junctions.formed}, torn ${c.junctions.torn}${tw}`;
  }

  /** Once a frame: a measure() every `every` s of simulated time while an organ is laid out. */
  maybeCensus(time, every = 2) {
    if (!this.kind || this.busy || (this.lastAt != null && time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.busy = true;
    this.measure().catch((e) => console.warn('organ census:', e)).finally(() => { this.busy = false; });
  }
}
const bits = (w) => { let n = 0; for (let k = 0; k < 6; k++) n += (w >> k) & 1; return n; };
