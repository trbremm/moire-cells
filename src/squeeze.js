// SQUEEZE / STRETCH THE SAMPLE (user 2026-11-17: "we can add a tool to scale the dish as if we are compressing the sample"). README "Dish
// size and densities".
//
// moire.dish.scale(f): the dish's size x f (f < 1 squeezes, f > 1 stretches), KEEPING what it holds:
//   cells     moved toward (away from) the dish's centre in proportion; their sizes do not change, so a squeeze crowds them
//   substrate every pixel's atoms and heat moved with the sample into the new grid (same pixel size, fewer or more pixels), split by
//             overlap in WHOLE counts, so every atom stays (a squeeze piles them up per pixel, a stretch thins them); the charge field
//             (worked out from the atoms) starts again from 0
//   springs   moved with the sample (oases roam on from there); step G0b: the obstacles too (walls thinner or thicker with it)
//   the rest  R, the medium lattice and every rule stay; the supplies that go per area (src/dish.js) follow the new area at once
// Done as a snapshot of the whole state, transformed, and loaded back (src/snapshot.js): the books are exact across it (atoms and
// charge rounding 0; nothing drained). The capacity (the cells' buffers) stays as it is.

import { snapshot, loadSnapshot, pack, unpack } from './snapshot.js';
import { CELL_FLOATS } from './cells.js';
import { dish } from './dish.js';
import { Obstacles } from './obstacles.js';

/**
 * Move a block of whole counts (hw x hh pixels of px) into a new grid (nw x nh, same px) scaled by f about the centres (c, c'): each old
 * pixel's amount is split over the new pixels its scaled square covers, by overlap, in whole counts (the remainder to the largest
 * overlaps), so the block's total is exactly kept.
 */
function resampleBlock(src, hw, hh, nw, nh, px, f, cx, cy, ncx, ncy) {
  const out = new Int32Array(nw * nh);
  const idx = [], wts = [];
  for (let j = 0; j < hh; j++) {
    const y0 = ncy + (j * px - cy) * f, y1 = ncy + ((j + 1) * px - cy) * f;
    const jy0 = Math.max(0, Math.floor(y0 / px)), jy1 = Math.min(nh - 1, Math.floor((y1 - 1e-9) / px));
    for (let i = 0; i < hw; i++) {
      const v = src[j * hw + i];
      if (!v) continue;
      const x0 = ncx + (i * px - cx) * f, x1 = ncx + ((i + 1) * px - cx) * f;
      const ix0 = Math.max(0, Math.floor(x0 / px)), ix1 = Math.min(nw - 1, Math.floor((x1 - 1e-9) / px));
      idx.length = 0; wts.length = 0;
      let wsum = 0;
      for (let b = jy0; b <= Math.max(jy0, jy1); b++) {
        const oy = Math.max(0, Math.min(y1, (b + 1) * px) - Math.max(y0, b * px));
        for (let a = ix0; a <= Math.max(ix0, ix1); a++) {
          const ox = Math.max(0, Math.min(x1, (a + 1) * px) - Math.max(x0, a * px));
          const w = ox * oy;
          idx.push(Math.min(nh - 1, b) * nw + Math.min(nw - 1, a)); wts.push(w); wsum += w;
        }
      }
      if (!(wsum > 0)) { out[Math.min(nh - 1, Math.max(0, Math.floor((y0 + y1) / 2 / px))) * nw + Math.min(nw - 1, Math.max(0, Math.floor((x0 + x1) / 2 / px)))] += v; continue; }
      if (idx.length === 1) { out[idx[0]] += v; continue; }
      const s = v < 0 ? -1 : 1, a = Math.abs(v);
      let given = 0, best = 0;
      for (let k = 0; k < idx.length; k++) {
        const share = Math.floor(a * wts[k] / wsum);
        out[idx[k]] += s * share; given += share;
        if (wts[k] > wts[best]) best = k;
      }
      out[idx[best]] += s * (a - given);   // the remainder (fewer counts than pixels) to the largest overlap: the total is exact
    }
  }
  return out;
}

/** Scale the dish by f, keeping its contents (see the top of this file). Resolves to the load's result plus { from, to }. */
export async function scaleDish(M, ctl, f) {
  f = Number(f);
  if (!(f > 0.2 && f < 5)) throw new Error('dish.scale(f): f between 0.2 and 5');
  if (dish.follow) throw new Error('dish.scale: the dish follows the window (?dishfollow=1): it cannot be squeezed');
  const W = dish.W, H = dish.H, W2 = W * f, H2 = H * f;
  if (Math.min(W2, H2) < 20 * dish.R) throw new Error('dish.scale: the dish would be smaller than 20 cell radii');
  const S = await snapshot(M, ctl, { grid: true, note: `dish.scale(${f})` });
  const cx = W / 2, cy = H / 2, ncx = W2 / 2, ncy = H2 / 2;
  // the cells: positions (and this tick's death place) about the centre
  const rec = await unpack(S.cells.rec), fr = new Float32Array(rec.buffer, rec.byteOffset, rec.length);
  const m = rec.length / CELL_FLOATS;
  for (let k = 0; k < m; k++) {
    const o = k * CELL_FLOATS;
    fr[o] = ncx + (fr[o] - cx) * f; fr[o + 1] = ncy + (fr[o + 1] - cy) * f;
    fr[o + 14] = ncx + (fr[o + 14] - cx) * f; fr[o + 15] = ncy + (fr[o + 15] - cy) * f;
  }
  S.cells.rec = await pack(rec);
  // the substrate: every saved block moved into the new grid, whole counts kept (phi, worked out from the atoms, starts at 0)
  const G = S.grid, px = M.heat.pxFor(W2, H2, dish.R);
  if (Math.abs(px - G.px) > 1e-6) throw new Error(`dish.scale: the grid's pixel would change (${G.px.toFixed(3)} -> ${px.toFixed(3)} px; the dish is above the grid's pixel cap)`);
  const nw = Math.max(2, Math.ceil(W2 / px)), nh = Math.max(2, Math.ceil(H2 / px)), n = G.hw * G.hh, n2 = nw * nh;
  const data = await unpack(G.data), out = new Int32Array(G.blocks.length * n2);
  G.blocks.forEach((name, b) => {
    if (name === 'phi') return;
    out.set(resampleBlock(data.subarray(b * n, (b + 1) * n), G.hw, G.hh, nw, nh, px, f, cx, cy, ncx, ncy), b * n2);
  });
  Object.assign(G, { hw: nw, hh: nh, px, data: await pack(out) });
  // the springs with the sample; the dish's new size
  for (const s of S.springs) {
    s.x = ncx + (s.x - cx) * f; s.y = ncy + (s.y - cy) * f;
    if (s.shape && s.shape.type === 'line') s.shape.len *= f;    // (a fissure or a seep stretches with the sample: its rate per R and per R^2
    if (s.shape && s.shape.type === 'patch') s.shape.r *= f;     // stays the spring's total, so its drip per length thins or thickens)
  }
  // step G0b: the obstacles with the sample (walls, blocks and pillars moved and sized x f; the round dish's rim follows the dish)
  if (S.obstacles) Obstacles.scaleSaved(S.obstacles, f, cx, cy, ncx, ncy);
  S.view = { cssW: W2, cssH: H2 };
  S.dish = { W: W2, H: H2, R: dish.R, mR: dish.mR, perArea: dish.perArea, start: dish.start };
  const from = dish.from;
  const r = await loadSnapshot(M, ctl, S);
  dish.from = from === 'window' || from === 'url' || from === 'preset' ? `${from}, squeezed` : from;
  return { ...r, from: [W, H], to: [W2, H2] };
}
