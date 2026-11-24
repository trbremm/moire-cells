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
import { muscleGenome, nerveGenome, skinGenome, pacemakerGenome, boneGenome, tendonGenome, anchorGenome, jointGenome } from './tissues.js';
import { readBuffer, frames, settle } from './snapshot.js';
import { conDrive } from './contract.js';
import { TW } from './tendrils.js';   // step T2: the limb's tendons' tension

export const ORGAN_KINDS = ['muscle', 'ring', 'worm', 'limb'];   // (step T2: + the LIMB)
export const ORGAN_DESIGNS = ['muscle', 'nerve', 'skin', 'pacemaker', 'bone', 'tendon', 'anchor', 'joint'];   // the founders' order (founder k = design k; step T2: + bone, tendon, anchor, joint)
const FOUNDER_IDS = [740, 750, 760, 770, 780, 790, 785, 787];
export const LIMB_IDS = [780, 790, 785, 787];   // step T2: the designs the limb's lab provisions (bone, tendon, anchor, joint: their mineral and tendril carbon)
const D_BONE = 4, D_TENDON = 5, D_ANCHOR = 6, D_JOINT = 7;
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
  const G = [muscleGenome(rng, 740, opts.con ?? ORGAN_CON), nerveGenome(rng), skinGenome(rng), pacemakerGenome(rng),
    boneGenome(rng), tendonGenome(rng), anchorGenome(rng), jointGenome(rng)];   // (step T2: bone, tendon, anchor, joint; drawn after the L1 four: their genomes as before)
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
  if (kind === 'limb') return limbCells(out, opts, M4, dy);
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

/**
 * Step T2, the LIMB (?tissue=limb; R units round the JOINT at (0, 0), along x): two BONE RODS (each a staggered double row of round hard cells,
 * `bone` cells long: the left rod's lower row ANCHOR bones that nail themselves to the floor with a tendril, so the left rod is held while the
 * right one is free), a gap of 1.6 R between them at the JOINT: the two lower rows' end cells are JOINT bones whose tendrils reach across and
 * grip each other (the LIGAMENTS: a hinge on the far side from the muscle; a separate ligament cell between the rods slid out of the gap and
 * let the right rod wander), the upper rows open (a V the joint can close into); a MUSCLE bundle above the rods across the joint (fibres of
 * 4:1 spindles end to end, laid out at the ~2.8:1 they settle to, 1.4 R clear of the bones, whose own key does not glue to it), a TENDON from
 * each end of the bundle down to the bone below (its pole tendrils grip the muscle's end and the bone), the NERVE along the outer side of the
 * muscle with its free end out over the left rod (where the pipette pokes it), and a SKIN cover of flat walled cells over the nerve. A poke: the nerve fires, the muscle shortens, the tendons pull the rods' far parts together over the
 * ligament: the joint FLEXES (the right rod swings toward the muscle). opts: bone (cells a row, 5), fibres (2), length (3), noskin, antagonist (a second
 * muscle under the rods, with its own nerve and tendons: it extends the joint again).
 */
function limbCells(out, opts, M4a, dy) {
  // (the muscle and nerve laid out at the length their spindles settle to, ~2.8:1, not the 4:1 they ask for: laid out longer, the bundle
  // shortened by itself as it settled and pulled the tendons, so the joint crept before any poke)
  const M4 = cap(Math.max(1.5, Math.min(4, Number(opts.layAspect) || 2.8)));
  const nb = Math.max(3, Math.round(opts.bone || 5)), g = 0.8, dB = 1.98, yLo = -0.5 * Math.sqrt(3) * dB / 2, yHi = -yLo;
  for (let k = 0; k < nb; k++) {
    // (the lower rows' cells at the joint are JOINT bones: each reaches a tendril across to the other rod's, the LIGAMENT: front 0 on the
    // left, pi on the right, so each points at the other)
    out.push({ x: -(g + 1 + dB * k), y: yLo, front: 0, d: k === 0 ? D_JOINT : D_ANCHOR });
    out.push({ x: g + 1 + dB * k, y: yLo, front: k === 0 ? Math.PI : 0, d: k === 0 ? D_JOINT : D_BONE });
  }
  for (let k = 0; k < nb - 1; k++) {
    out.push({ x: -(g + 1 + dB * (k + 0.5)), y: yHi, front: 0, d: D_BONE });
    out.push({ x: g + 1 + dB * (k + 0.5), y: yHi, front: 0, d: D_BONE });
  }
  const sides = opts.antagonist ? [1, -1] : [1];
  for (const sy of sides) {
    // a muscle bundle on this side (above: sy 1; the antagonist below: -1), its tendons, its nerve and skin
    const F = Math.max(1, Math.round(opts.fibres || 2)), L = Math.max(2, Math.round(opts.length || 3));
    const gapM = opts.gap != null ? Number(opts.gap) : 1.4;   // (the muscle's gap above the bones, R: the soft stack does not press on them)
    const half = L * M4.len / 2, yIn = yHi + 1 + gapM + 0.5 * M4.wid;   // (the fibre nearest the bones, its centre)
    const yMid = yIn + (F - 1) / 2 * dy;
    for (let j = 0; j < F; j++) for (let k = 0; k < L; k++) out.push({ x: (k - (L - 1) / 2) * M4.len, y: sy * (yIn + j * dy), front: 0, d: 0 });
    for (const sx of [-1, 1]) {
      // a tendon from the bundle's end (its middle height) down to the bone below, a little further out
      const xEnd = g + 1 + dB * (nb - 1.5), pm = [sx * half, yMid], pb = [sx * Math.min(half + 1.2, xEnd - 0.6), yHi + 0.85];   // (the insertion over the rod's upper row)
      const fr = Math.atan2(pb[1] - pm[1], pb[0] - pm[0]);
      out.push({ x: (pm[0] + pb[0]) / 2, y: sy * (pm[1] + pb[1]) / 2, front: sy > 0 ? fr : -fr, d: D_TENDON });
    }
    // the nerve: one row of long relay cells on the bundle's outer side, one cell longer, its free end out to the left
    const yN = yIn + (F - 1) * dy + dy, nN = L + 1;
    for (let k = 0; k < nN; k++) out.push({ x: -half - 0.6 * M4.len + (k + 0.5) * M4.len, y: sy * yN, front: 0, d: 1 });
    // the skin: a cover of flat walled cells over the nerve
    if (!opts.noskin) {
      const yS = yN + 0.5 * M4.wid + 0.55 * S25.wid + 0.05, nS = Math.max(3, Math.round((nN * M4.len) / (0.98 * S25.len)));
      for (let k = 0; k < nS; k++) out.push({ x: -half - 0.6 * M4.len + (k + 0.5) * nN * M4.len / nS, y: sy * yS, front: 0, d: 2 });
    }
  }
  return out;
}

/** The culture's layout (src/culture.js cultureLayout, spread 'organ'): dish coordinates, founder (= design), front, the stretch to start with. */
export function organLayout(kind, opts, W, H, R) {
  const list = organCells(kind, opts), ang = Number(opts.angle) || 0, c = Math.cos(ang), s = Math.sin(ang);
  const la = 0.5 * Math.log(organAspect(opts)), stretch = [la, la, 0.5 * Math.log(2.5), 0.5 * Math.log(2), 0, 0.5 * Math.log(2.5), 0, 0];   // (step T2: bone, tendon, anchor, joint)
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
  if (!obs || !organ || organ.kind === 'worm' || organ.kind === 'limb') return 0;   // (step T2: the limb holds itself: its anchors)
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
    const by = ORGAN_DESIGNS.map(() => []), acts = !!(C.grn && C.grn.acts);
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FLOATS;
      if (!(u[o + C_FLAGS] & 1)) continue;
      const k = Organ.designOf(g[i * BIO_FLOATS + B_FOUNDER]);
      if (k < 0) continue;
      const w = u[o + C_KIND];
      // (FIRING: the relays' release regulator r0 low, its release factor e^(-8 x0) above 0.1; the flash (Cell.motW) shows only the onset)
      by[k].push({ i, x: f[o], y: f[o + 1], front: f[o + C_FRONT], e: Math.hypot(f[o + 6], f[o + 7]), fire: k === 2 ? 0 : Math.exp(-8 * Math.max(0, g[i * BIO_FLOATS + B_GX0])) / 0.3,
        flash: ((u[o + C_MOTW] >>> 24) & 255) / 255,
        onset: g[i * BIO_FLOATS + B_SSW], formed: ((w >>> 8) & ~w & 63), torn: w & 63, drive: conDrive(g, i * BIO_FLOATS, acts), seed: u[o + 10] });
    }
    return by;
  }

  /** The organ's axis (unit) and centre: the laid-out angle, else the muscle cells' principal axis. */
  axisOf(mus) {
    if (this.kind === 'muscle' || this.kind === 'worm' || this.kind === 'limb') return [Math.cos(this.angle), Math.sin(this.angle)];
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
    const all = by.flat();   // (step T2: and the limb's bones, tendons, anchors)
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
      cellsT2: { bone: by[D_BONE].length + by[D_ANCHOR].length + by[D_JOINT].length, tendon: by[D_TENDON].length },
    };
    if (this.kind === 'limb') this.census.joint = await this.limbJoint(by, ax);
    return this.census;
  }

  /**
   * Step T2, the LIMB's JOINT now: the two rods (the left: every anchor and every bone laid out left of the joint; the right: the other bones;
   * fixed at the first look, by slot and seed), each rod's centroid and principal axis; the BEND = the right rod's axis turned against the
   * left rod's (degrees, + = flexed toward the muscle's side, as laid out: 0 straight); the ligament's and the tendons' ropes (gripping,
   * tension in R/s, mean and largest).
   */
  async limbJoint(by, ax) {
    const M = this.M, R = M.cells.R, ctr = this.centre || [M.cells.view.cssW / 2, M.cells.view.cssH / 2];
    const bones = [...by[D_BONE], ...by[D_ANCHOR], ...by[D_JOINT]];
    const key = (p) => `${p.i}:${p.seed}`;
    if (!this.rods) {
      const A = new Set(), B = new Set();
      for (const p of bones) ((p.x - ctr[0]) * ax[0] + (p.y - ctr[1]) * ax[1] < 0 ? A : B).add(key(p));
      this.rods = { A, B };
    }
    const rodA = bones.filter((p) => this.rods.A.has(key(p))), rodB = bones.filter((p) => this.rods.B.has(key(p)));
    const pca = (L) => {
      let cx = 0, cy = 0;
      for (const p of L) { cx += p.x; cy += p.y; }
      cx /= Math.max(1, L.length); cy /= Math.max(1, L.length);
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of L) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      return { c: [cx, cy], u: [Math.cos(a), Math.sin(a)] };
    };
    const PA = pca(rodA), PB = pca(rodB);
    // each axis oriented: A's from its far end toward B, B's from A away; the signed angle from A's to B's
    const orient = (P, to) => { const s = (to[0] - P.c[0]) * P.u[0] + (to[1] - P.c[1]) * P.u[1]; return s < 0 ? [-P.u[0], -P.u[1]] : P.u; };
    const dA = orient(PA, PB.c), uBb = orient(PB, PA.c), uB = [-uBb[0], -uBb[1]];
    const cr = dA[0] * uB[1] - dA[1] * uB[0], dt = dA[0] * uB[0] + dA[1] * uB[1];
    // + = toward the muscle's side: as laid out the muscle sits on the organ's +y side; the dish's y grows downward, so with the organ's
    // axis ax the muscle's side is (-ax.y, ax.x) in dish coordinates and a turn toward it has cross(dA, uB) of the sign of cross(ax, up)
    const up = [-ax[1], ax[0]], sgn = Math.sign(ax[0] * up[1] - ax[1] * up[0]) || 1;
    const bend = (Math.atan2(cr, dt) * 180) / Math.PI * sgn;
    // the ropes of the tendon cells (ligament and tendons): tension per gripping rope
    let ropes = 0, sumT = 0, maxT = 0, grip = 0, slots = 0, held = 0, onCells = 0, lig = 0, ligT = 0;
    const T = M.tendrils;
    if (T && T.buf) {
      const ab = await readBuffer(M.gpu.device, T.buf, 0, M.cells.count * TW * 4), tu = new Uint32Array(ab), tf = new Float32Array(ab);
      for (const p of by[D_TENDON]) {
        for (let s = 0; s < 4; s++) {
          const so = p.i * TW + 8 + 8 * s, st = tu[so] & 3;
          if (!st) continue;
          slots++;
          if (st >= 2) { grip++; const t = tf[so + 7]; if (t > 0) { ropes++; sumT += t; maxT = Math.max(maxT, t); } }
        }
      }
      for (const p of by[D_ANCHOR]) for (let s = 0; s < 4; s++) { const st = tu[p.i * TW + 8 + 8 * s] & 3; if (st === 3) held++; else if (st === 2) onCells++; }
      for (const p of by[D_JOINT]) for (let s = 0; s < 4; s++) { const so = p.i * TW + 8 + 8 * s; if ((tu[so] & 3) === 2) { lig++; ligT = Math.max(ligT, tf[so + 7]); } }
    }
    return { bend, rodA: rodA.length, rodB: rodB.length, span: Math.hypot(PB.c[0] - PA.c[0], PB.c[1] - PA.c[1]) / R,
      tendonSlots: slots, gripping: grip, ropesTaut: ropes, tension: ropes ? sumT / ropes : 0, maxTension: maxT, anchorsHeld: held, anchorsOnCells: onCells, ligaments: lig, ligamentTension: ligT };
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
      if (this.kind === 'worm' || (this.kind === 'limb' && this.opts.antagonist)) {   // one side's nerve (step T2: the limb's two muscles): its cells are above (side 0) or below (1) the axis
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
    let minL = rest.ends, minAt = t0, maxW = rest.width, jMax = 0, jAt = null, tMax = rest.joint ? rest.joint.maxTension : 0;
    while (M.time() < t0 + follow) {
      const t1 = M.time();
      while (M.time() < t1 + every) await frames(1);
      const c = await this.measure();
      series.push([+(c.time - t0).toFixed(2), +c.ends.toFixed(3), +c.width.toFixed(3), c.firing.muscle, c.firing.nerve, +c.ringR.toFixed(3), +c.skin.length.toFixed(2),
        ...(c.joint ? [+c.joint.bend.toFixed(2), +c.joint.tension.toFixed(3), +c.joint.maxTension.toFixed(3)] : [])]);   // (step T2: the limb's bend, tension)
      if (c.joint) {
        const db = (c.joint.bend - rest.joint.bend) * (opts.side ? -1 : 1);
        if (db > jMax) { jMax = db; jAt = c.time - t0; }
        if (c.joint.maxTension > tMax) tMax = c.joint.maxTension;
      }
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
      ...(rest.joint ? { jointRest: rest.joint.bend, jointFlex: jMax, jointAt: jAt, jointEnd: end.joint.bend, tensionRest: rest.joint.tension,
        tensionMax: tMax, ropesRest: rest.joint.gripping, ropesEnd: end.joint.gripping } : {}),   // (step T2: the limb's joint)
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
    const la = 0.5 * Math.log(organAspect(opts)), stretch = [la, la, 0.5 * Math.log(2.5), 0.5 * Math.log(2), 0, 0.5 * Math.log(2.5), 0, 0];
    for (let k = 0; k < ORGAN_DESIGNS.length; k++) {   // (step T2: + bone, tendon, anchor; the add-cell tool gives them their mineral and tendril carbon)
      const P = pts.filter((p) => p.d === k);
      if (P.length) await M.app.place(P.map((p) => [p.X, p.Y, p.F, stretch[k]]), G[k], `organ: ${ORGAN_DESIGNS[k]}`);
    }
    this.kind = kind; this.opts = opts; this.angle = ang; this.centre = [x, y]; this.n0 = pts.length; this.rods = null;
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
    const tw = t ? ` · last twitch ${(100 * t.shortening).toFixed(0)}% shorter end to end${t.nerveSpeed ? `, nerve ${t.nerveSpeed.toFixed(1)} R/s` : ''}${t.jointFlex != null ? `, joint flexed ${t.jointFlex.toFixed(0)}°` : ''}, ${t.torn} torn` : '';
    const J = c.joint;   // (step T2: the limb's joint)
    const jt = J ? ` · JOINT bend ${J.bend.toFixed(1)}° · tendons ${J.gripping}/${J.tendonSlots} gripping, tension ${J.tension.toFixed(2)} R/s (max ${J.maxTension.toFixed(2)}) · rods ${J.rodA}+${J.rodB} bone` : '';
    if (compact) return `ORGAN ${this.kind} ${c.cells.all}/${c.cells.laidOut}${J ? ` · joint ${J.bend.toFixed(0)}°` : ''}${tw}`;
    return `ORGAN  ${this.kind}: ${c.cells.muscle} muscle · ${c.cells.nerve} nerve · ${c.cells.skin} skin${c.cells.pacemaker ? ` · ${c.cells.pacemaker} pacemaker` : ''}` +
      ` (alive ${c.cells.all} of ${c.cells.laidOut}) · bundle ${c.ends.toFixed(1)} × ${c.width.toFixed(1)} R end to end (cells ${c.sumLen.toFixed(0)} R laid end to end)` +
      ` · firing ${c.firing.nerve} nerve, ${c.firing.muscle} muscle · contracting ${c.contracting}` +
      ` · junctions ${c.junctions.formed}, torn ${c.junctions.torn}${jt}${tw}`;
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
