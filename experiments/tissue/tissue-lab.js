// Tissue experiments: helpers loaded into the page by the conditions' evals
//   const T = await import('/experiments/tissue/tissue-lab.js');
// Nothing here changes how the simulation runs by itself; it sets knobs (as the console would), gives cells their genes, reads
// the cells back for extra measures (types, shape of the largest cluster, its box for cropping) and stirs through the
// largest cluster. Used by experiments/tissue/make_conditions.py; see TISSUE.md.

import { CELL_FLOATS } from '../../src/cells.js';
import { readBuffer } from '../../src/snapshot.js';

const M = () => window.moire;

/** Set knobs by path: { 'cells.params.squeeze': 0, 'eat.params.pay': false, ... } (paths below window.moire). */
export function apply(knobs = {}) {
  const done = {};
  for (const [path, v] of Object.entries(knobs)) {
    const parts = path.split('.');
    let o = M();
    for (let k = 0; k < parts.length - 1; k++) {
      if (o == null || !(parts[k] in o)) throw new Error(`apply: no ${parts.slice(0, k + 1).join('.')}`);
      o = o[parts[k]];
    }
    const last = parts[parts.length - 1];
    if (!(last in o)) throw new Error(`apply: no ${path}`);
    if (Array.isArray(o[last]) && Array.isArray(v)) v.forEach((x, i) => { o[last][i] = x; });
    else o[last] = v;
    done[path] = v;
  }
  return done;
}

/** Genes for everyone, then for type B (every `every`-th slot from `offset`: slot parity by default). */
export async function genes(all = {}, typeB = null, { every = 2, offset = 1 } = {}) {
  if (Object.keys(all).length) await M().genome.setAll(all);
  if (typeB && Object.keys(typeB).length) {
    const n = M().cells.count, slots = [];
    for (let i = offset; i < n; i += every) slots.push(i);
    await M().genome.setAll(typeB, { cells: slots });
  }
  return { all, typeB };
}

async function cellsNow() {
  const C = M().cells, n = C.count, F = CELL_FLOATS;
  const ab = await readBuffer(M().gpu.device, C.cellBuf, 0, n * F * 4);
  const f = new Float32Array(ab), u = new Uint32Array(ab);
  const live = [];
  for (let i = 0; i < n; i++) if (u[i * F + 9] & 1) live.push({ i, x: f[i * F], y: f[i * F + 1], r: f[i * F + 4], kind: u[i * F + 8] });
  return live;
}

/**
 * Extra measures: the largest cluster's centre and box (CSS px, for cropping the shot), its elongation (gyration tensor:
 * sqrt of the eigenvalue ratio, 1 = round), hollowness (the empty middle: the nearest cell centre to the centroid, in R),
 * share of its cells at the edge (fewer than 4 contacts), degree histogram (0, 1, 2, 3+ contacts) over all cells, the
 * fates, and with two types (slot parity, `every`): same-type share of contacts against random mixing, and the radial
 * order in the largest cluster (type B's mean distance from the centre over type A's; above 1: B outside, a shell).
 */
export async function measure({ every = 2, offset = 1, reach = null } = {}) {
  const cells = await cellsNow(), R = M().cells.R, rc = reach ?? M().genome.params.reach ?? 1.15;
  const n = cells.length, par = cells.map((_, k) => k), deg = new Array(n).fill(0);
  const find = (k) => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  const isB = (c) => every > 1 && (c.i - offset) % every === 0 && c.i >= offset;
  let same = 0, pairs = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const A = cells[a], B = cells[b];
    if (Math.hypot(A.x - B.x, A.y - B.y) >= rc * (A.r + B.r)) continue;
    deg[a]++; deg[b]++; pairs++;
    if (isB(A) === isB(B)) same++;
    const ra = find(a), rb = find(b);
    if (ra !== rb) par[ra] = rb;
  }
  const groups = new Map();
  cells.forEach((_, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });
  const g = [...groups.values()].sort((p, q) => q.length - p.length)[0] || [];
  let cx = 0, cy = 0;
  for (const k of g) { cx += cells[k].x; cy += cells[k].y; }
  cx /= Math.max(1, g.length); cy /= Math.max(1, g.length);
  let xx = 0, yy = 0, xy = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, hole = 1e9;
  for (const k of g) {
    const c = cells[k], dx = c.x - cx, dy = c.y - cy;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
    x0 = Math.min(x0, c.x - c.r); y0 = Math.min(y0, c.y - c.r); x1 = Math.max(x1, c.x + c.r); y1 = Math.max(y1, c.y + c.r);
    hole = Math.min(hole, Math.hypot(dx, dy));
  }
  const m = Math.max(1, g.length);
  xx /= m; yy /= m; xy /= m;
  const tr = xx + yy, det = xx * yy - xy * xy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
  const hist = [0, 0, 0, 0];
  deg.forEach((d) => { hist[Math.min(3, d)]++; });
  const edge = g.filter((k) => deg[k] < 4).length / m;
  const fates = [0, 0, 0, 0, 0];
  cells.forEach((c) => { if (c.kind < 5) fates[c.kind]++; });
  const out = {
    t: M().time(), n, R, largest: g.length, cx, cy, box: [x0, y0, x1, y1],
    elong: g.length >= 3 ? Math.min(99, Math.sqrt(l1 / l2)) : 0, hole: g.length >= 3 ? hole / R : 0, edge, deg: hist, fates,
    chainy: g.length ? g.filter((k) => deg[k] <= 2).length / m : 0,
  };
  // the bounding box of all live cells too (for a whole-culture crop)
  let a0 = 1e9, b0 = 1e9, a1 = -1e9, b1 = -1e9;
  for (const c of cells) { a0 = Math.min(a0, c.x - c.r); b0 = Math.min(b0, c.y - c.r); a1 = Math.max(a1, c.x + c.r); b1 = Math.max(b1, c.y + c.r); }
  out.boxAll = [a0, b0, a1, b1];
  if (every > 1) {
    const nb = cells.filter(isB).length, pB = nb / Math.max(1, n);
    out.sameType = pairs ? same / pairs : null;
    out.sameRandom = pB * pB + (1 - pB) * (1 - pB);
    let rA = 0, nA = 0, rB = 0, nB = 0;
    for (const k of g) {
      const c = cells[k], d = Math.hypot(c.x - cx, c.y - cy);
      if (isB(c)) { rB += d; nB++; } else { rA += d; nA++; }
    }
    out.radialBA = nA && nB && rA > 0 ? (rB / nB) / (rA / nA) : null;
    out.nB = nb;
  }
  // step C10: where the contacts sit on the cells' walls (front, side, back), the glue, the junctions' maturity
  if (M().walls && M().walls.params.on) {
    const w = await M().walls.stats();
    out.walls = { contactAt: w.contactAt, glue: w.glue, matured: w.matured, effMean: w.effMean, matureMean: w.matureMean, classes: w.classes,
      // step C11: contacts on the sticky sides against chance, glued bonds per cell, chains and rings of glued bonds
      onSticky: w.onSticky, stickyChance: w.stickyChance, bondsPerCell: w.bondsPerCell, chains: w.chains, inChains: w.inChains,
      longestChain: w.longestChain, rings: w.rings, inRings: w.inRings };
  }
  window.__tissueLast = out;
  return out;
}

/**
 * The aggregation assay: put the live cells at random places in a disc of `radius` R around the dish centre (no two closer
 * than `gap` x the sum of their radii), at rest. Writes the positions straight into the cell buffer while paused (an assay,
 * like dissociating a tissue into single cells; the honeycomb outlines follow by themselves).
 */
export async function scatter({ radius = 14, gap = 1.25, seed = 1 } = {}) {
  await M().lab.settle(false);
  const C = M().cells, n = C.count, F = CELL_FLOATS, R = C.R, d = M().gpu.device;
  const ab = await readBuffer(d, C.cellBuf, 0, n * F * 4);
  const f = new Float32Array(ab), u = new Uint32Array(ab);
  const v = M().control.view(), cx = v.cssW / 2, cy = v.cssH / 2;
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const placed = [];
  let tries = 0;
  for (let i = 0; i < n; i++) {
    if (!(u[i * F + 9] & 1)) continue;
    const r = f[i * F + 4];
    for (let k = 0; k < 2000; k++) {
      tries++;
      const a = 2 * Math.PI * rnd(), q = radius * R * Math.sqrt(rnd());
      const x = cx + q * Math.cos(a), y = cy + q * Math.sin(a);
      if (placed.every((p) => Math.hypot(p[0] - x, p[1] - y) >= gap * (p[2] + r)) || k === 1999) {
        placed.push([x, y, r]);
        f[i * F] = x; f[i * F + 1] = y; f[i * F + 2] = 0; f[i * F + 3] = 0;
        break;
      }
    }
  }
  d.queue.writeBuffer(C.cellBuf, 0, f);
  await d.queue.onSubmittedWorkDone();
  if (M().tissue.reset) M().tissue.reset();
  return { cells: placed.length, radius, tries };
}

/**
 * Step C10, patterned walls: set every live cell's FRONT (Cell.front, the direction its wall pattern hangs on; word 64) while
 * paused, an assay like scatter: 'aligned' (every cell `angle` rad: as one lineage that inherited one direction), 'random' (each
 * its own, from `seed`), 'in' / 'out' (toward / away from the live cells' centre). The front then turns with the cell's body
 * (and, with the gene w, toward its dipole) as usual.
 */
export async function fronts({ mode = 'aligned', angle = 0, seed = 1 } = {}) {
  await M().lab.settle(false);
  const C = M().cells, n = C.count, F = CELL_FLOATS, d = M().gpu.device;
  const ab = await readBuffer(d, C.cellBuf, 0, n * F * 4);
  const f = new Float32Array(ab), u = new Uint32Array(ab);
  const live = [];
  for (let i = 0; i < n; i++) if (u[i * F + 9] & 1) live.push(i);
  let cx = 0, cy = 0;
  for (const i of live) { cx += f[i * F]; cy += f[i * F + 1]; }
  cx /= Math.max(1, live.length); cy /= Math.max(1, live.length);
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (const i of live) {
    const o = i * F, out = Math.atan2(f[o + 1] - cy, f[o] - cx);
    const a = mode === 'random' ? 2 * Math.PI * rnd() : mode === 'in' ? out + Math.PI : mode === 'out' ? out : angle;
    f[o + 64] = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }
  d.queue.writeBuffer(C.cellBuf, 0, f);
  await d.queue.onSubmittedWorkDone();
  return { cells: live.length, mode, angle };
}

/** Stir across the largest cluster's centre (a mouse drag from its left, `frames` frames of `step` CSS px). */
export async function stirThrough({ step = 14, frames = 12 } = {}) {
  const m = await measure({ every: 1 });
  const x = m.cx - step * frames / 2, y = m.cy;
  await M().tissue.stir(x, y, step, 0, frames);
  return { x, y, cx: m.cx, cy: m.cy };
}

/**
 * Step C12b: lipid springs at the largest cluster's centre and on a ring around it (radius in R), each dripping for `life` s:
 * kinds as matter springs ('soap', 'oil', 'emulsion', 'linker', ...). The cells take the soap and oil in by fusion and build
 * crust walls from the linkers (their genes decide what), so every lipid in a membrane came in through a spring (exact books).
 */
export async function lipidSprings({ kinds = ['soap'], ring = 0, n = 4, life = 30 } = {}) {
  const m = await measure({ every: 1 }), R = M().cells.R, out = [];
  for (const kind of kinds) {
    M().matter.addSpring(m.cx, m.cy, kind, life);
    out.push([kind, 'centre']);
    for (let k = 0; ring > 0 && k < n; k++) {
      const a = 2 * Math.PI * (k + 0.5) / n;
      M().matter.addSpring(m.cx + ring * R * Math.cos(a), m.cy + ring * R * Math.sin(a), kind, life);
      out.push([kind, k]);
    }
  }
  return { cx: m.cx, cy: m.cy, springs: out.length };
}

/**
 * Step C12b: the membranes' make-up and stiffness (moire.lipids.stats(), its 'all' group), and the outlines' motion: the
 * corners' mean speed (R / s: the wobble) and how far the corners are from the outline's mean distance (the std of rad / its
 * mean: 0 = a regular hexagon), each over the live honeycomb cells; plus contacts per cell from measure().
 */
export async function lipidMeasure() {
  const s = await M().lipids.stats();
  const C = M().cells, n = C.count, F = CELL_FLOATS, R = C.R;
  const ab = await readBuffer(M().gpu.device, C.cellBuf, 0, n * F * 4);
  const f = new Float32Array(ab), u = new Uint32Array(ab);
  let cells = 0, speed = 0, dev = 0;
  for (let i = 0; i < n; i++) {
    const o = i * F;
    if (!(u[o + 9] & 1) || !(u[o + 9] & 8)) continue;
    let mr = 0;
    for (let k = 0; k < 6; k++) mr += f[o + 26 + k] / 6;
    let v = 0, d2 = 0;
    for (let k = 0; k < 6; k++) { v += Math.abs(f[o + 32 + k]) / 6; d2 += (f[o + 26 + k] / mr - 1) ** 2 / 6; }
    cells++; speed += v / R; dev += Math.sqrt(d2);
  }
  const m = await measure({ every: 1 });
  return { lipids: s.all, wobble: cells ? speed / cells : 0, cornerDev: cells ? dev / cells : 0, contacts: m.contacts ?? m.meanDeg ?? null, measure: m };
}
