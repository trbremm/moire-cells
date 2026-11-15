// Division and death with a changing count (Part C, step C9; Part B step 9 of CLAUDE.md, pulled in for the experiments).
//
// The cells live in buffers of a fixed CAPACITY (src/cells.js `count`; ?cap=N, default 3 x the starting number); a slot is a
// live cell while its flags have ALIVE. Two life cycles, one at a time, both only while turnover (key T) is on:
//   turnover (fixed count)    as in steps 3b to C8: now and then a cell dies and a touching neighbour divides into its slot
//                             at once (?divide=0)
//   division (changing count) the default: a cell DIVIDES when its battery can pay for a daughter (at least divAt of its
//                             capacity), it has grown to minSize of its size and it is not crowded (the sum of its overlaps
//                             with its neighbours, each as a share of their contact distance, at most `crowd`), at a chance of
//                             `rate` per s. It claims a FREE slot (none left: the capacity is full, it waits); its daughter
//                             goes there, the two side by side along the mother's long axis, both at `split` of her radius,
//                             growing back to their size. The division's COST (energy units) leaves her battery as heat, then
//                             her stock, battery, membrane and voltage are SPLIT between the two (whole counts, conserved:
//                             cell_eat.wgsl split). The daughter's genome is a copy with mutation (and the step C8 hard light
//                             dose's extra), as at a turnover birth.
//                             A cell DIES for good when it STARVED (its battery below starveAt for starveTime s), of HEAT
//                             damage (C5's rule), when it BURST (C6c), or by a small background AGE rate (x the turnover's
//                             "unhappy" factor); the eat pass hands its stock back to the dish where it was and its battery as
//                             heat (matter and energy conserved, as at any death), and its slot is free again.
// So the number of cells rises and falls with the energy the dish catches.
//
// How a free slot is found (no read-back, no stall): the grid's counting sort puts every dead slot into one more bucket after
// the last grid cell (cell_grid.wgsl), so each tick the sorted list ends with the free slots; a dividing cell takes the next
// one with an atomic counter (Stats.claim, cleared before each tick). Every pass skips the free slots: the step runs over the
// live part of the sorted list only, the eat, census and ledger passes check ALIVE, the drawing emits nothing for them.
//
// Look (cells.look is not used; `look` here): both cells of a division flash (their tubes white-hot for `flash` s, fading
// fast); a starving cell fades out as its starvation time runs down; a death drops a dip into the ripples, a birth a bump
// (as before).
//
// This module holds the switch and knobs (moire.division.params), writes them into the step's uniform (Fields.dv0..dv2) and
// the drawing's, reads the counters back (from the cells' stats read-back) and gives the DIVISION panel line with the count's
// sparkline, the overlay and stats() (where the cells are: in the light, in patches) for the experiments.

import { fmt, HEAT_SCALE } from './heat.js';
import { CELL_FLOATS } from './cells.js';

export const STATS_DIV = 8576;      // byte offset of Stats.div in struct Stats (cell_common.wgsl)
export const STATS_CLAIM = 8636;    // ... of Stats.claim
export const DIV_SNAP = 8;          // DV_SNAP: Stats.div's snapshot words (cleared every frame) start here
const CNT = ['births', 'starved', 'heat', 'burst', 'age', 'noslot'];   // Stats.div 0..5 (DV_* in cell_common.wgsl)
const SPARK = '▁▂▃▄▅▆▇█';

export class Division {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.division.params). Switch: the rules panel's group "Division (step C9)" and ?divide=0.
    this.params = {
      on: true,          // division mode (changing count); off: turnover keeps the count (?divide=0)
      divAt: 0.6,        // a cell may divide from this share of its battery's capacity (?divat=)
      cost: 0.4,         // energy units a division costs the mother's battery, as heat (?divcost=)
      crowd: 0.6,        // ... and only while the sum of its overlaps (each as a share of the contact distance) is at most this
      rate: 0.5,         // ... at this chance per s once it may
      minSize: 0.9,      // ... once it has grown to this share of its size
      split: 0.71,       // the mother's and the daughter's radius right after (share of hers: about half her area each)
      apart: 0.4,        // ... put this share of her radius to either side of where she was
      starveAt: 0.03,    // a cell is starving while its battery is below this share
      starveTime: 30,    // ... and dies after this many s of it (?starve=)
      age: 0.002,        // background deaths per s (x the turnover's "unhappy" factor)
    };
    this.look = {
      flash: 1.2,        // a division's flash: the tubes' extra brightness (0 = none)
      flashTime: 0.5,    // ... its length (s)
      fade: 0.85,        // a starving cell fades out by this much as its starvation time runs down (0 = not at all)
    };
    this.tot = null;     // the counters at the last read-back (cumulative, u32 wrap-safe through differences)
    this.hist = [];      // [time, births, starved, heat, burst, age, noslot] for the rates
    this.census = null;
    this.series = [];    // [time, alive] every 5 s of simulation time (the sparkline, the overlay)
    this.near = null;    // the last stats() result
  }

  /** Whether division mode runs (the switch and the life cycle, key T). */
  get active() { return !!this.params.on && !!this.cells.genome.rules.turn; }

  /** A new culture: the count's history starts again. */
  reset() { this.series = []; this.hist = []; }

  /** The step's words (struct Fields dv0..dv2, from word o). */
  writeFields(f, u, o) {
    const p = this.params;
    u[o] = p.on ? 1 : 0; f[o + 1] = Math.max(0, p.divAt); f[o + 2] = Math.max(0, p.crowd); f[o + 3] = Math.max(0, p.rate);
    f[o + 4] = Math.max(0, p.starveAt); f[o + 5] = Math.max(0.1, p.starveTime); f[o + 6] = Math.max(0, p.age); f[o + 7] = Math.max(0, this.look.flashTime);
    f[o + 8] = Math.max(0, p.minSize); f[o + 9] = Math.max(0.3, Math.min(1, p.split)); f[o + 10] = Math.max(0, p.apart); f[o + 11] = 0;
  }

  /** The eat pass's word: the division's cost in heat counts (struct EatP dv.y). */
  get costCounts() { return Math.max(0, Math.round(this.params.cost * HEAT_SCALE)); }

  /** The drawing's words (struct Draw div, from word o). */
  writeDraw(a, o) {
    const L = this.look, on = this.active;
    a[o] = on ? Math.max(0, L.flash) : 0; a[o + 1] = Math.max(1e-3, L.flashTime);
    a[o + 2] = on ? Math.max(0, Math.min(1, L.fade)) : 0; a[o + 3] = 1 / Math.max(0.1, this.params.starveTime);
  }

  /** The cells' stats read-back (Stats.div as u32 words; `alive` from the census). */
  apply(time, w, alive) {
    const now = CNT.map((k, j) => w[j]);
    const H = this.hist;
    if (H.length && time < H[H.length - 1][0]) H.length = 0;
    H.push([time, ...now]);
    while (H.length > 2 && time - H[1][0] >= 10) H.shift();   // rates over the last 10 s
    const h0 = H[0], dt = time - h0[0];
    const rate = Object.fromEntries(CNT.map((k, j) => [k, dt > 0.2 ? ((now[j] - h0[1 + j]) >>> 0) / dt : 0]));
    const deaths = rate.starved + rate.heat + rate.burst + rate.age;
    this.census = { time, alive, cap: this.cells.count, rate, deaths, starving: w[8], ready: w[9], crowded: w[10], tot: now };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (!S.length || time - S[S.length - 1][0] >= 5) {
      S.push([time, alive]);
      if (S.length > 2000) S.shift();
    }
  }

  /** The heat's ledger read-back: the energy the divisions' cost turned into heat since the last one. */
  applyLedger(time, cost) {
    const K = this.costHist || (this.costHist = []);
    this.costTot = (this.costTot || 0) + cost;
    if (K.length && time < K[K.length - 1][0]) K.length = 0;
    K.push([time, this.costTot]);
    while (K.length > 2 && time - K[1][0] >= 10) K.shift();
    const dt = time - K[0][0];
    this.costRate = dt > 0.2 ? (this.costTot - K[0][1]) / dt : 0;
  }

  /** The count's sparkline over the last `n` samples (5 s apart), scaled from 0 to their largest. */
  sparkline(n = 36) {
    const s = this.series.slice(-n).map((x) => x[1]);
    if (s.length < 2) return '';
    const top = Math.max(1, ...s);
    return s.map((v) => SPARK[Math.min(7, Math.round(7 * v / top))]).join('');
  }

  /** The entropy panel's DIVISION line. */
  panelLine(compact = false) {
    const C = this.census, cells = this.cells;
    const n = C ? C.alive : cells.alive;
    if (!cells.genome.rules.turn) return `DIVISION  life cycle off (T): nothing is born or dies · ${n} cells`;
    if (!this.params.on) {
      const st = cells.stats;
      return compact ? `DIVISION off · turnover ${n} cells` : `DIVISION  off: turnover keeps the count at ${n} cells` +
        (st ? ` (births = deaths ${st.birthRate.toFixed(1)}/s)` : '') + ' (rules panel)';
    }
    if (!C) return 'DIVISION  …';
    const r = C.rate, sp = this.sparkline(compact ? 16 : 36);
    if (compact) return `DIVISION ${n}/${C.cap} · +${r.births.toFixed(1)} −${C.deaths.toFixed(1)}/s ${sp}`;
    const s = this.series.slice(-36).map((x) => x[1]);
    const span = s.length > 1 ? `last ${Math.round((s.length - 1) * 5 / 6) / 10} min, ${Math.min(...s)} to ${Math.max(...s)}` : '';
    return `DIVISION  cells ${n} of ${C.cap} · births ${r.births.toFixed(1)}/s · deaths ${C.deaths.toFixed(1)}/s:` +
      ` starved ${r.starved.toFixed(1)}, heat ${r.heat.toFixed(1)}, burst ${r.burst.toFixed(1)}, age ${r.age.toFixed(1)}` +
      ` · ready ${C.ready} (crowded ${C.crowded}) · starving ${C.starving}${r.noslot > 0.05 ? ` · no free slot ${r.noslot.toFixed(1)}/s` : ''}` +
      (sp ? `\nCOUNT  ${sp}  ${span}` : '');
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, C = this.census;
    const lines = [`division (step C9) ${p.on ? 'on: the count changes' : 'off: turnover keeps the count'}${this.cells.genome.rules.turn ? '' : ' (life cycle off: T)'}` +
      ` · divides from ${p.divAt} of the battery, cost ${p.cost} (heat), when its overlaps sum to ≤ ${p.crowd}, at ${p.rate}/s, from ${p.minSize} of its size` +
      ` · daughters at ${p.split} of the radius, ${p.apart} r apart · starving below ${p.starveAt} for ${p.starveTime} s dies · age ${p.age}/s` +
      ` · capacity ${this.cells.count} (started ${this.cells.start})`];
    if (C) {
      const t = C.tot;
      lines.push(`division: births ${C.rate.births.toFixed(2)}/s (${t[0]} so far) · deaths starved ${C.rate.starved.toFixed(2)}/s (${t[1]}), heat ${C.rate.heat.toFixed(2)}/s (${t[2]}), burst ${C.rate.burst.toFixed(2)}/s (${t[3]}), age ${C.rate.age.toFixed(2)}/s (${t[4]})` +
        ` · no free slot ${C.rate.noslot.toFixed(2)}/s · the divisions' cost → heat ${fmt(this.costRate || 0)}/s (${fmt(this.costTot || 0)} so far) · now: ready ${C.ready}, of them crowded ${C.crowded}; starving ${C.starving}` +
        `${this.near ? ` · stats at ${this.near.time.toFixed(0)} s: ${this.near.n} cells, ${Math.round(100 * this.near.litShare)}% in the light, ${this.near.patches} patches (largest ${this.near.largest})` : ''}`);
      const S = this.series.filter((x, j, a) => j === a.length - 1 || Math.floor(x[0] / 60) !== Math.floor(a[j + 1][0] / 60)).slice(-12);
      lines.push(`cells every minute: ${S.map((x) => `${x[0].toFixed(0)}s ${x[1]}`).join(' · ')}`);
    }
    return lines;
  }

  /**
   * For the experiments (console, tools): where the live cells are. Reads the cells back: how many, the share in the light
   * (spotlight or full field), mean battery share, the culture's centre (CSS px) and its spread (R), and its PATCHES: groups
   * of touching cells (closer than 1.15 x the sum of their radii): how many (of at least 3 cells), the largest, and the share
   * of the cells in patches of at least 20. Resolves to that and keeps it for the panel.
   */
  async stats() {
    const Cc = this.cells, d = Cc.device, n = Cc.count, F = CELL_FLOATS;
    const buf = d.createBuffer({ size: n * F * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(Cc.cellBuf, 0, buf, 0, n * F * 4);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0)), u = new Uint32Array(f.buffer);
    buf.destroy();
    const L = Cc.heat.light, sp = L && L.modeIndex === 1 ? L.spot() : null;
    const isLit = (x, y) => (L ? (L.modeIndex === 2 || (sp && Math.hypot(x - sp.x, y - sp.y) < sp.r)) : false);
    const R = Cc.R, cs = 2.5 * R, grid = new Map(), live = [];
    let lit = 0, bat = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const o = i * F;
      if (!(u[o + 9] & 1)) continue;
      live.push(i);
      if (isLit(f[o], f[o + 1])) lit++;
      bat += f[o + 16]; cx += f[o]; cy += f[o + 1];
      const k = `${Math.floor(f[o] / cs)},${Math.floor(f[o + 1] / cs)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const m = Math.max(1, live.length);
    cx /= m; cy /= m;
    let r2 = 0;
    for (const i of live) r2 += (f[i * F] - cx) ** 2 + (f[i * F + 1] - cy) ** 2;
    // patches: union-find over touching pairs
    const par = new Map(live.map((i) => [i, i]));
    const find = (i) => { while (par.get(i) !== i) { par.set(i, par.get(par.get(i))); i = par.get(i); } return i; };
    for (const i of live) {
      const x = f[i * F], y = f[i * F + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx},${gy + dy}`) || []) {
          if (j <= i) continue;
          if (Math.hypot(f[j * F] - x, f[j * F + 1] - y) > 1.15 * (f[i * F + 4] + f[j * F + 4])) continue;
          const a = find(i), b = find(j);
          if (a !== b) par.set(a, b);
        }
      }
    }
    const size = new Map();
    for (const i of live) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
    const sizes = [...size.values()].sort((a, b) => b - a);
    this.near = {
      time: window.moire && window.moire.time ? window.moire.time() : 0, n: live.length, litShare: lit / m, bat: bat / m,
      centre: [Math.round(cx), Math.round(cy)], spreadR: +(Math.sqrt(r2 / m) / R).toFixed(1),
      patches: sizes.filter((s) => s >= 3).length, largest: sizes[0] || 0, inBig: +(sizes.filter((s) => s >= 20).reduce((a, b) => a + b, 0) / m).toFixed(3),
      sizes: sizes.slice(0, 8),
    };
    return this.near;
  }
}
