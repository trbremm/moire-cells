// Step C13 experiments: how PATCHY the genes are in space (do lineages with their own beat period tile the dish, do guides cluster?)
//   const E = await import('/experiments/tissue/c13-evo.js'); return await E.patchiness();
// For each gene: its mean and spread over the live cells, and its NEIGHBOUR CORRELATION over the touching pairs (closer than reach x
// the sum of their radii; each pair once): sum (g_i - mean)(g_j - mean) / (pairs x variance). 0: the gene is scattered at random over
// the culture; toward 1: neighbours carry the same value (patches, as lineages that stay together). Read back while paused; changes
// nothing.

import { CELL_FLOATS } from '../../src/cells.js';
import { BIO_FLOATS } from '../../src/genome.js';
import { readBuffer } from '../../src/snapshot.js';

const M = () => window.moire;
const GENES = { leverA: 56, emitA: 57, senseA: 58, tuneA: 59, leverB: 60, senseB: 62, pickB: 63, angleA: 64, shareP: 66,
  glue: 68, pump: 69, engine: 70, div: 71, turn: 72, push: 73, keyAngle: 0 };

export async function patchiness({ reach = 1.15 } = {}) {
  await M().lab.settle(false);
  const C = M().cells, n = C.count, F = CELL_FLOATS, B = BIO_FLOATS, d = M().gpu.device;
  const [cab, bab] = await Promise.all([readBuffer(d, C.cellBuf, 0, n * F * 4), readBuffer(d, C.bioBuf[C.bioCur], 0, n * B * 4)]);
  const f = new Float32Array(cab), u = new Uint32Array(cab), g = new Float32Array(bab);
  const live = [];
  for (let i = 0; i < n; i++) if (u[i * F + 9] & 1) live.push(i);
  const cs = 3 * C.R, grid = new Map();
  for (const i of live) {
    const key = `${Math.floor(f[i * F] / cs)},${Math.floor(f[i * F + 1] / cs)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  const pairs = [];
  for (const i of live) {
    const x = f[i * F], y = f[i * F + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of grid.get(`${gx + a},${gy + b}`) || []) {
        if (j <= i) continue;
        if (Math.hypot(f[j * F] - x, f[j * F + 1] - y) < reach * (f[i * F + 4] + f[j * F + 4])) pairs.push([i, j]);
      }
    }
  }
  const out = { t: M().time(), n: live.length, pairs: pairs.length };
  for (const [name, w] of Object.entries(GENES)) {
    const v = (i) => g[i * B + w];
    let s = 0, s2 = 0;
    for (const i of live) { s += v(i); s2 += v(i) * v(i); }
    const m = s / Math.max(1, live.length), varr = Math.max(0, s2 / Math.max(1, live.length) - m * m);
    let c = 0;
    for (const [i, j] of pairs) c += (v(i) - m) * (v(j) - m);
    out[name] = { mean: +m.toFixed(4), sd: +Math.sqrt(varr).toFixed(4), corr: varr > 1e-10 && pairs.length ? +(c / pairs.length / varr).toFixed(3) : null };
  }
  // the key angle wraps every 60 degrees: its neighbour correlation as the mean cos(6 x difference) over the pairs (1: alike)
  let kc = 0;
  for (const [i, j] of pairs) kc += Math.cos(6 * (g[i * B] - g[j * B]));
  out.keyAngle.corr = pairs.length ? +(kc / pairs.length).toFixed(3) : null;
  return out;
}
