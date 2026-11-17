// Step T1c: THE CHEMICAL WARFARE CHECK (BUILD QUEUE 6; the user chose "measure first"). Is poisoning a neighbour still possible, and does
// it pay? Nothing here changes a rule: it only MEASURES, comparing cells at LINEAGE BORDERS (touching a cell of another lineage: founder id)
// with cells in their colony's INTERIOR. The weapons that exist (none written as a weapon): OUT pump genes (C7; across a contact a pump
// puts the substance straight into the neighbour's stock), same-row membrane BITES by free reactive atoms (C6c, C12b), free t (oxygen-like)
// inside a cell, HEAT damage. So per group:
//   cells        their battery, membrane integrity (bitten membranes are less whole), swelling, free t and free light atoms (g, t) inside,
//                the heat they feel
//   pump genes   the share of cells carrying an OUT pump of light atoms (g or t: the vandals that bite light membranes and burn fuel), of
//                t alone, of heavy atoms (G, T), an IN pump of fuel (taking from a touching neighbour: stealing), rate-weighted too
//   the dish     free g, t, G, T (per R^2) and the temperature under the cells
//   deaths       by cause (starved, heat, burst, age, eaten), at a border or inside: each death's place and lineage (the step's death
//                events carry them since T1c) against the last census's map, per cell-minute of each group
//   ground       each lineage's cells at every census: who gains ground at a border
// moire.warfare.census() (a read-back, paused while it reads); moire.warfare.deaths (the running counts since the page started or reset()).

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS, pumpOf } from './genome.js';
import { SW } from './eat.js';
import { SUBSTANCES, CH } from './matter.js';
import { readBuffer, settle, readGrid } from './snapshot.js';
import { grnOf } from './grn.js';

const C_POS = 0, C_R = 4, C_FLAGS = 9, C_BAT = 16, C_INTEG = 48, C_NBR = 60, C_OSM = 84, C_SNS1 = 87;
const CAUSES = ['turnover', 'starved', 'heat', 'burst', 'age', 'noslot', 'eaten'];
const NCH = SUBSTANCES.length;

export class Warfare {
  constructor(M) {
    this.M = M;
    this.map = null;           // the last census's cells: { x, y, fid } and a coarse grid for the deaths' neighbourhood
    this.deaths = null;
    this.exposure = { border: 0, interior: 0 };   // cell-seconds of each group (between censuses)
    this.lastTime = null;
    this.series = [];          // per census: [time, { fid: cells }, border share]
    this.last = null;
    this.reset();
    this.hooked = false;
  }

  reset() {
    this.deaths = { border: Object.fromEntries(CAUSES.map((c) => [c, 0])), interior: Object.fromEntries(CAUSES.map((c) => [c, 0])), unplaced: 0, seen: 0 };
    this.exposure = { border: 0, interior: 0 };
    this.series = [];
    this.lastTime = null;
  }

  hook() {
    if (this.hooked || !this.M.cells || !this.M.cells.eventTaps) return;
    this.hooked = true;
    this.M.cells.eventTaps.push((events) => this.onEvents(events));
  }

  onEvents(events) {
    const m = this.map;
    for (const e of events) {
      if (!(e[2] < 0) || e[3] == null) continue;
      this.deaths.seen++;
      if (!m) { this.deaths.unplaced++; continue; }
      const cause = CAUSES[Math.round(e[3]) & 15] || 'turnover', fid = Math.floor(Math.round(e[3]) / 16);
      // a border death: a cell of another lineage within reach (2.6 R) of where it died, in the last census
      const R = m.R, gx = Math.floor(e[0] / m.cs), gy = Math.floor(e[1] / m.cs);
      let other = false, any = false;
      for (let a = -1; a <= 1 && !other; a++) for (let b = -1; b <= 1 && !other; b++) {
        for (const k of m.grid.get((gx + a) * 100003 + (gy + b)) || []) {
          if (Math.hypot(m.x[k] - e[0], m.y[k] - e[1]) > 2.6 * R) continue;
          any = true;
          if (m.fid[k] !== fid) { other = true; break; }
        }
      }
      if (!any) { this.deaths.unplaced++; continue; }
      this.deaths[other ? 'border' : 'interior'][cause]++;
    }
  }

  /** The census (opts.dish = false: without the grid read-back). */
  async census(opts = {}) {
    this.hook();
    const M = this.M, C = M.cells, ctl = M.control, d = M.gpu.device, n = C.count, H = M.heat;
    const wasPaused = ctl.paused();
    let cellAB, bioAB, stockAB, grid = null;
    try {
      await settle(M, ctl, false);
      [cellAB, bioAB, stockAB] = await Promise.all([
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.eat.stockBuf, 0, n * SW * 4),
      ]);
      if (opts.dish !== false) grid = await readGrid(M);
    } finally { ctl.setPaused(wasPaused); }
    const f = new Float32Array(cellAB), u = new Uint32Array(cellAB), g = new Float32Array(bioAB), st = new Int32Array(stockAB);
    const time = M.time(), R = C.R, A = 4096;
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * CELL_FLOATS + C_FLAGS] & 1) live.push(i);
    const fid = new Map(live.map((i) => [i, Math.round(g[i * BIO_FLOATS + 7])]));
    const size = new Map();
    for (const i of live) size.set(fid.get(i), (size.get(fid.get(i)) || 0) + 1);
    // border: a touching neighbour (listed across a side, pressed) of another lineage
    const border = new Map();
    const foe = new Map();   // the other lineage across the border
    for (const i of live) {
      const oc = i * CELL_FLOATS;
      let b = false;
      for (let w = 0; w < 3 && !b; w++) for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
        if (j === 0xffff || j >= n || !fid.has(j) || j === i) continue;
        if (Math.hypot(f[j * CELL_FLOATS] - f[oc], f[j * CELL_FLOATS + 1] - f[oc + 1]) >= 1.15 * (f[oc + C_R] + f[j * CELL_FLOATS + C_R])) continue;
        if (fid.get(j) !== fid.get(i)) { b = true; foe.set(i, fid.get(j)); break; }
      }
      border.set(i, b);
    }
    // KIN RECOGNITION at contacts (for kin sparing, step P1): the marker MATCH (the moire beat over the shared wall x the phases' register,
    // without the displays) and the KINSHIP (x both displays as expressed: the gene x the network's display output), within a lineage and
    // between two (kin_match_m in cell_common.wgsl)
    const disp = (i) => {
      const ob = i * BIO_FLOATS, G = grnOf(g, ob);
      return Math.max(0, Math.min(1, g[ob + 79] * Math.min(Math.exp(Math.max(-8, Math.min(8, G.u[11])) * Math.max(0, Math.min(1, G.x[G.reg[11]]))), 4)));
    };
    const kinAcc = { same: [0, 0, 0, 0], cross: [0, 0, 0, 0] };   // n, match, kinship, match > 0.5
    for (const i of live) {
      const oc = i * CELL_FLOATS;
      for (let w = 0; w < 3; w++) for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
        if (j === 0xffff || j >= n || !fid.has(j) || j <= i) continue;
        const oj = j * CELL_FLOATS;
        if (Math.hypot(f[oj] - f[oc], f[oj + 1] - f[oc + 1]) >= 1.15 * (f[oc + C_R] + f[oj + C_R])) continue;
        const a = i * BIO_FLOATS + 76, b = j * BIO_FLOATS + 76;
        const qa = Math.exp(-g[a + 1]), qb = Math.exp(-g[b + 1]);
        const dx = qa * Math.cos(g[a]) - qb * Math.cos(g[b]), dy = qa * Math.sin(g[a]) - qb * Math.sin(g[b]);
        const N = Math.hypot(dx, dy) * 0.5 * (f[oc + C_R] + f[oj + C_R]) / R;
        const m = Math.exp(-9.8696044 * N * N / 6) * (0.5 + 0.5 * Math.cos(g[a + 2] - g[b + 2]));
        const K = kinAcc[fid.get(i) === fid.get(j) ? 'same' : 'cross'];
        K[0]++; K[1] += m; K[2] += m * disp(i) * disp(j); K[3] += m > 0.5 ? 1 : 0;
      }
    }
    const kinOut = Object.fromEntries(Object.entries(kinAcc).map(([k, K]) => [k, K[0] ? { pairs: K[0], match: K[1] / K[0], kinship: K[2] / K[0], matchOver05: K[3] / K[0] } : { pairs: 0 }]));
    // the dish under each cell (its pixel): free g t G T per R^2, the temperature
    const px = H.px, hw = H.hw, hh = H.hh, ng = hw * hh, per = (R * R) / (A * px * px), ts = H.tempScale;
    const dishAt = (x, y) => {
      if (!grid) return null;
      const ix = Math.max(0, Math.min(hw - 1, Math.floor(x / px))), iy = Math.max(0, Math.min(hh - 1, Math.floor(y / px))), p = iy * hw + ix;
      const s = (c) => Math.max(0, grid[(2 + c) * ng + p]) * per;
      return { g: s(CH.g), t: s(CH.t), G: s(CH.G), T: s(CH.T), temp: Math.max(0, grid[ng + p]) * ts };
    };
    const blank = () => ({ n: 0, bat: 0, integ: 0, osm: 0, tIn: 0, lightIn: 0, heat: 0, outLight: 0, outT: 0, outG: 0, outHeavy: 0, inFuel: 0, inLight: 0,
      outLightRate: 0, outAny: 0, dg: 0, dt: 0, dG: 0, dT: 0, temp: 0 });
    const grp = { border: blank(), interior: blank() };
    const perLin = new Map();
    const light = new Set([CH.g, CH.t]), heavy = new Set([CH.G, CH.T]), fuel = new Set([CH.gt, CH.gT, CH.Gt, CH.GT]);
    for (const i of live) {
      if ((size.get(fid.get(i)) || 0) < 20) continue;   // (lineages of 20 cells and more)
      const oc = i * CELL_FLOATS, ob = i * BIO_FLOATS, key = border.get(i) ? 'border' : 'interior';
      const P = grp[key];
      P.n++;
      P.bat += f[oc + C_BAT];
      let ig = 0;
      for (let s = 0; s < 6; s++) ig += Math.max(0, Math.min(1, f[oc + C_INTEG + s]));
      P.integ += ig / 6;
      P.osm += f[oc + C_OSM];
      P.tIn += Math.max(0, st[i * SW + CH.t]) / A;
      P.lightIn += (Math.max(0, st[i * SW + CH.g]) + Math.max(0, st[i * SW + CH.t])) / A;
      P.heat += ((u[oc + C_SNS1] >>> 8) & 255) / 255;
      let oL = 0, oT = 0, oG = 0, iF = 0, iL = 0, rate = 0, anyOut = 0;
      for (let k = 0; k < 2; k++) {
        const p = pumpOf(g, ob, k);
        if (!(p.rate > 0)) continue;
        if (p.out) {
          anyOut = 1;
          if (light.has(p.ch)) { oL = 1; rate += p.rate; }
          if (p.ch === CH.t) oT = 1;
          if (heavy.has(p.ch)) oG = 1;
        } else {
          if (fuel.has(p.ch)) iF = 1;
          if (light.has(p.ch)) iL = 1;
        }
      }
      P.outLight += oL; P.outT += oT; P.outHeavy += oG; P.inFuel += iF; P.inLight += iL; P.outLightRate += rate; P.outAny += anyOut;
      const dd = dishAt(f[oc], f[oc + 1]);
      if (dd) { P.dg += dd.g; P.dt += dd.t; P.dG += dd.G; P.dT += dd.T; P.temp += dd.temp; }
      // per lineage
      const L = perLin.get(fid.get(i)) || { id: fid.get(i), n: 0, border: 0, outLight: 0, outLightB: 0, integB: 0, integI: 0, batB: 0, batI: 0 };
      L.n++;
      if (key === 'border') { L.border++; L.outLightB += oL; L.integB += ig / 6; L.batB += f[oc + C_BAT]; }
      else { L.integI += ig / 6; L.batI += f[oc + C_BAT]; }
      L.outLight += oL;
      perLin.set(L.id, L);
    }
    const fin = (P) => {
      const m = Math.max(1, P.n), o = {};
      for (const [k, v] of Object.entries(P)) o[k] = k === 'n' ? v : v / m;
      return o;
    };
    const lineages = [...perLin.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((L) => ({
      id: L.id, n: L.n, border: L.border, outLight: L.outLight / Math.max(1, L.n), outLightBorder: L.border ? L.outLightB / L.border : null,
      integBorder: L.border ? L.integB / L.border : null, integInterior: L.n - L.border ? L.integI / (L.n - L.border) : null,
      batBorder: L.border ? L.batB / L.border : null, batInterior: L.n - L.border ? L.batI / (L.n - L.border) : null,
    }));
    // the deaths' exposure: cell-seconds of each group since the last census (the deaths in between are compared with these)
    if (this.lastTime != null && time > this.lastTime && this.last) {
      const dt = time - this.lastTime;
      this.exposure.border += this.last.groups.border.n * dt;
      this.exposure.interior += this.last.groups.interior.n * dt;
    }
    this.lastTime = time;
    // the map for the deaths to come
    const cs = 3 * R, gridMap = new Map(), xs = [], ys = [], fs = [];
    live.forEach((i, k) => {
      xs.push(f[i * CELL_FLOATS]); ys.push(f[i * CELL_FLOATS + 1]); fs.push(fid.get(i));
      const key = Math.floor(xs[k] / cs) * 100003 + Math.floor(ys[k] / cs);
      if (!gridMap.has(key)) gridMap.set(key, []);
      gridMap.get(key).push(k);
    });
    this.map = { R, cs, grid: gridMap, x: xs, y: ys, fid: fs };
    const D = this.deaths, ex = this.exposure;
    const perMin = (grp2, cause) => (ex[grp2] > 0 ? D[grp2][cause] / (ex[grp2] / 60) : null);
    const deathRates = Object.fromEntries(['border', 'interior'].map((k) => [k, Object.fromEntries(CAUSES.filter((c) => c !== 'noslot').map((c) => [c, perMin(k, c)]))]));
    const counts = Object.fromEntries([...size.entries()].filter(([, v]) => v >= 20).sort((a, b) => b[1] - a[1]));
    this.series.push([time, counts, grp.border.n / Math.max(1, grp.border.n + grp.interior.n)]);
    this.last = {
      time, n: live.length, lineages, counts, kin: kinOut,
      groups: { border: fin(grp.border), interior: fin(grp.interior) },
      deaths: { border: { ...D.border }, interior: { ...D.interior }, unplaced: D.unplaced, seen: D.seen, exposureMin: { border: ex.border / 60, interior: ex.interior / 60 }, perCellMin: deathRates },
    };
    return this.last;
  }
}
