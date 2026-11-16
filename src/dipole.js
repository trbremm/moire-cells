// Charge per side: DIPOLES (Part C, step C6d). The user's picture (CLAUDE.md C6d): "each side holds its own charge (a cell
// that eats on one side gets charged there); an outside field pulls the + and - ends opposite ways, so cells turn, line up
// and stretch along the field, which strains their lattice and changes their field again (a form <-> field loop, like the
// step 8 curls)."
//
// What a cell holds: Cell.sideQ[6], the share of its stock's net charge on each side of its outline (atom-units). Their sum is
// always the net charge qNet (the eat pass puts them back on it every tick), so the side charges are a DISTRIBUTION of the
// charge the stock already has, never new charge; a neutral cell can still be polarised (+ on one side, - on the other).
//   where the charge sits (cell_eat.wgsl, plan)  each charged atom's THROUGH-FLOW: the exchange as if each side traded with
//                             the dish just outside it, less the cell's mean exchange. So a side facing more givers than
//                             the cell's other sides takes + in there, and the side facing fewer lets + out: a cell in a
//                             gradient of free charged atoms is polarised along it, as far as its + and - flows do not cancel
//                             (the ion selectivity gene, and light atoms passing faster than heavy ones, make them differ).
//                             The side charges even out within the cell at `relax` per s (charges move inside the cell),
//                             each side within `cap` x the cell's mobile charge / 6 of its even share
//   its dipole                p = sum_k sideQ[k] x (side k's middle - centre) / r, saturating: d = p / |p| x tanh(|p| / pHalf)
//                             (length 0..1); the grid's lean copy carries d, so neighbours see it
//   the field on the dipole   the neighbours' dipoles (dipole-dipole) and the substrate's charge field phi (its gradient
//                             across the membrane, from the eat pass's corners) make a field E at the cell
//   rules (cell_step.wgsl)    TURN: the torque d x E turns the honeycomb (its sides carry the charges) and turns the charges
//                             within the cell; POLARISE: the field pulls the cell's mobile charge apart along it (a dipole
//                             of `polar` x pHalf in a full field, against the evening out), so a polarised cell polarises
//                             its neighbours ahead of and behind it (induced dipoles: how chains grow); PUSH: two dipoles attract head-to-tail and repel side by side (short range,
//                             saturating); STRETCH: the stretch target gets the traceless part of E (x) d, so a dipole along
//                             the field pulls the cell out along it, which strains its lattice (k = F^-1 k0) and changes
//                             the moire fields it emits and feels: the form <-> field loop
//   with the charge field     each cell puts its charge into phi at its sides' middles instead of at its centre, so a
//                             polarised cell's dipole is in the substrate's field too
// The books: the side charges only spread charge the stock holds, so the atoms' and the charge's books are unchanged (exact);
// the push is a force like the others, its work booked with theirs.

import { CELL_FLOATS } from './cells.js';

export const STATS_DIP = 8512;    // byte offset of Stats.dip in struct Stats (cell_common.wgsl)
export const DIP_WORDS = 16;
const DIP_MIN = 0.2, DIP_BOND = 0.5;   // cell_common.wgsl

export class Dipole {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.dipole.params). Switches: the rules panel's group "Charge per side (step C6d)" and URL options.
    this.params = {
      on: false,         // dipoles (master): the side charges move (through-flow, relaxation), the dipole is seen (?dipoles=1; step C12g:
                         // off by default, with the dish-wide charge field: no outside field turns or pushes cells)
      dd: true,          // dipole-dipole: neighbours' dipoles turn each other (head-to-tail lines up) and push (?dd=0)
      phi: true,         // the substrate's charge field acts on the side charges (?dphi=0)
      field: true,       // the field turns the cells (the hexagon and the charges within) and stretches them along it (?dfield=0)
      deposit: true,     // with the charge field on, a cell puts its charge into it at its sides (its dipole shows in phi)
      // knobs: where the charge sits
      pHalf: 0.002,      // a dipole of pHalf atom-units x r is tanh(1) of full (d = 0.76)
      relax: 0.2,        // the side charges even out within the cell at this rate (1 / s): a dipole lasts about 5 s
      flow: 1,           // the through-flow's weight
      cap: 3,            // a side holds at most cap x (the mobile charge / 6) more or less than its even share
      // knobs: the rules
      range: 1.4,        // dipole-dipole range, x the contact distance (the sum of the radii; at most about 1.5: the grid)
      turn: 60,          // the torque's turning of the hexagon (rad / s^2 at a full dipole in a full field; contacts: 40)
      inner: 6,          // ... and of the charges within the cell (rad / s)
      polar: 0.2,        // the field polarises the cell: its dipole in a full field, x pHalf (0 = off; above about 0.1, neighbours
                         // polarise each other without any flow: the whole tissue polarises in domains)
      push: 0.6,         // dipole-dipole push, R / s at full dipoles touching head-to-tail (x 6 for the kernel's 6)
      pushSat: 1,        // ... saturating at (R / s)
      phiHalf: 0.02,     // the substrate's field: phi per R that is tanh(1) of a full field
      phiW: 1,           // ... its weight against the neighbours' dipoles
      stretch: 0.3,      // the stretch along the field (target stretch at a full dipole in a full field; muscle's own: 0.3)
    };
    this.census = null;
    this.series = [];     // [time, mean |d|, polarised share, polar order, head-to-tail, thread cells] every 10 s
  }

  get onNow() { return !!this.params.on; }

  /** The eat uniform's words (struct EatP dpFlags.. from word 107): u = Uint32 view, f = Float32 view. */
  writeEat(u, f, o) {
    const p = this.params;
    u[o] = (p.on ? 1 : 0) | (p.on && p.deposit ? 2 : 0);
    f[o + 1] = Math.max(0, p.flow); f[o + 2] = Math.max(0, p.relax); f[o + 3] = 0;
    f[o + 4] = Math.max(0.1, p.cap);
  }

  /** The step's words in struct Fields (dip0..dip2, from word 68; src/cells.js writeFields). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = (p.on ? 1 : 0) | (p.on && p.dd ? 2 : 0) | (p.on && p.field ? 4 : 0);
    f[o + 1] = 1 / Math.max(1e-6, p.pHalf); f[o + 2] = Math.max(1, Math.min(1.5, p.range)); f[o + 3] = Math.max(0, p.turn);
    f[o + 4] = Math.max(0, p.push); f[o + 5] = Math.max(0.01, p.pushSat); f[o + 6] = Math.max(1e-6, p.phiHalf); f[o + 7] = Math.max(0, p.stretch);
    f[o + 8] = Math.max(0, p.inner); f[o + 9] = p.phi ? Math.max(0, p.phiW) : 0; f[o + 10] = Math.max(0, p.relax) * Math.max(0, p.polar) * p.pHalf / 2.6; f[o + 11] = 0;
  }

  /** The census words from the cells' stats read-back (Int32 view of Stats.dip). */
  apply(time, w) {
    const all = Math.max(1, w[12]), pol = w[3], pairs = w[0];
    const C = {
      time, cells: w[12], meanD: w[4] / 1000 / all, polarised: pol, polShare: pol / all, pairs,
      order: pairs ? w[1] / 1000 / pairs : 0, htt: pairs ? w[2] / 1000 / pairs : 0, mid: w[5], ends: w[6],
      chain: pairs ? (w[2] - 0.5 * w[1]) / 1000 / pairs : 0,
      eDD: pol ? w[7] / 1000 / pol : 0, ePhi: pol ? w[8] / 1000 / pol : 0, align: w[10] ? w[9] / 1000 / w[10] : 0, nAlign: w[10],
      stretch: pol ? w[11] / 1000 / pol : 0,
    };
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (!S.length || time - S[S.length - 1][0] >= 10) {
      S.push([time, C.meanD, C.polShare, C.order, C.chain, C.mid]);
      if (S.length > 400) S.shift();
    }
  }

  /** Draw words (struct Draw dip, dip2, from word 120; src/cells.js render). */
  writeDraw(a, o, look, chargeView) {
    const p = this.params, L = look;
    a[o] = p.on ? L.dipTint : 0; a[o + 1] = p.on && L.marks ? L.dipArrow : 0; a[o + 2] = 1 / Math.max(1e-6, p.pHalf);
    a[o + 3] = p.on && chargeView ? L.dipTwoTone : 0;
    a[o + 4] = p.on ? 1 : 0; a[o + 5] = 0; a[o + 6] = 0; a[o + 7] = 0;
  }

  /**
   * For tuning and the experiments (console, tools): reads the cells back and measures the dipoles on the CPU. Neighbours =
   * pairs within `reach` x the contact distance; a head-to-tail BOND = both polarised (|d| above 0.2), (d_i . n)(d_j . n) and
   * d_i . d_j (unit vectors) above 0.5; THREADS = connected runs of bonded cells (union-find), counted from 3 cells. The same
   * measures with the dipoles shuffled among the polarised cells give the chance level.
   */
  async stats(opts = {}) {
    const C = this.cells, d = C.device, n = C.count, F = CELL_FLOATS, P = this.params;
    const reach = opts.reach ?? C.genome.params.reach;
    const buf = d.createBuffer({ size: n * F * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(C.cellBuf, 0, buf, 0, n * F * 4);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const u = new Uint32Array(f.buffer);
    const pos = [], dip = [], raw = [], rad = [], ids = [];
    for (let i = 0; i < n; i++) {
      const o = i * F;
      if (!(u[o + 9] & 1)) continue;
      const r = f[o + 4];
      // the sides' middles (as membrane() in cell_common.wgsl): the honeycomb's corners, or the stretched hexagon
      const Pc = [];
      if (u[o + 9] & 8) {
        for (let k = 0; k < 6; k++) { const a = f[o + 38] + k * Math.PI / 3 + f[o + 42 + k]; Pc.push([f[o + 26 + k] * Math.cos(a), f[o + 26 + k] * Math.sin(a)]); }
      } else {
        const e1 = f[o + 6], e2 = f[o + 7], eps = Math.hypot(e1, e2);
        const ch = Math.cosh(eps), sh = eps > 1e-4 ? Math.sinh(eps) / eps : 1;
        const fa = ch + sh * e1, fb = sh * e2, fd = ch - sh * e1;
        for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3, x = Math.cos(t), y = Math.sin(t); Pc.push([r * (fa * x + fb * y), r * (fb * x + fd * y)]); }
      }
      let px = 0, py = 0;
      for (let k = 0; k < 6; k++) {
        const a = Pc[k], b = Pc[(k + 1) % 6], q = f[o + 54 + k];
        px += q * 0.5 * (a[0] + b[0]); py += q * 0.5 * (a[1] + b[1]);
      }
      px /= Math.max(r, 1e-3); py /= Math.max(r, 1e-3);
      const m = Math.hypot(px, py), s = m > 1e-12 ? Math.tanh(m / P.pHalf) / m : 0;
      pos.push([f[o], f[o + 1]]); raw.push(m); dip.push([px * s, py * s]); rad.push(r); ids.push(i);
    }
    const N = pos.length, cs = 3 * C.R, grid = new Map();
    pos.forEach((p, a) => { const key = Math.floor(p[0] / cs) + 4096 * Math.floor(p[1] / cs); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(a); });
    const pairs = [];
    for (let a = 0; a < N; a++) {
      const gx = Math.floor(pos[a][0] / cs), gy = Math.floor(pos[a][1] / cs);
      for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) {
        for (const b of grid.get(x + 4096 * y) || []) {
          if (b <= a) continue;
          const dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1], dd = Math.hypot(dx, dy);
          if (dd < 1e-6 || dd > reach * (rad[a] + rad[b])) continue;
          pairs.push([a, b, dx / dd, dy / dd]);
        }
      }
    }
    const len = (v) => Math.hypot(v[0], v[1]);
    const measure = (D) => {
      let np = 0, sc = 0, sh = 0;
      const parent = Int32Array.from({ length: N }, (_, k) => k), deg = new Int32Array(N);
      const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
      for (const [a, b, nx, ny] of pairs) {
        const la = len(D[a]), lb = len(D[b]);
        if (la <= DIP_MIN || lb <= DIP_MIN) continue;
        const ax = D[a][0] / la, ay = D[a][1] / la, bx = D[b][0] / lb, by = D[b][1] / lb;
        const ca = ax * bx + ay * by, ht = (ax * nx + ay * ny) * (bx * nx + by * ny);
        np++; sc += ca; sh += ht;
        if (ht > DIP_BOND && ca > DIP_BOND) { deg[a]++; deg[b]++; parent[find(a)] = find(b); }
      }
      const size = new Map();
      for (let k = 0; k < N; k++) if (deg[k] > 0) { const r = find(k); size.set(r, (size.get(r) || 0) + 1); }
      const sizes = [...size.values()].sort((x, y) => y - x);
      const threads = sizes.filter((s) => s >= 3);
      return { pairs: np, order: np ? sc / np : 0, htt: np ? sh / np : 0, chain: np ? (sh - 0.5 * sc) / np : 0, bonded: sizes.reduce((x, y) => x + y, 0),
        threads: threads.length, inThreads: threads.reduce((x, y) => x + y, 0), longest: sizes[0] || 0, sizes: sizes.slice(0, 12) };
    };
    const real = measure(dip);
    // chance: the polarised cells' dipoles shuffled among them (same places, same strengths, random partners)
    const polIdx = [];
    for (let k = 0; k < N; k++) if (len(dip[k]) > DIP_MIN) polIdx.push(k);
    let rnd = null;
    if (polIdx.length > 1) {
      const D = dip.map((v) => v.slice());
      const vals = polIdx.map((k) => dip[k]);
      for (let k = vals.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [vals[k], vals[j]] = [vals[j], vals[k]]; }
      polIdx.forEach((k, j) => { D[k] = vals[j]; });
      rnd = measure(D);
    }
    const ds = dip.map(len).sort((x, y) => x - y), rs = raw.slice().sort((x, y) => x - y);
    const pct = (a, q) => (a.length ? +a[Math.min(a.length - 1, Math.floor(q * a.length))].toPrecision(3) : 0);
    return {
      cells: N, polarised: polIdx.length, meanD: ds.reduce((x, y) => x + y, 0) / Math.max(1, N),
      d: { p50: pct(ds, 0.5), p90: pct(ds, 0.9), p99: pct(ds, 0.99) }, rawP: { p50: pct(rs, 0.5), p90: pct(rs, 0.9), p99: pct(rs, 0.99) },
      ...real, chance: rnd ? { order: +rnd.order.toFixed(3), htt: +rnd.htt.toFixed(3), chain: +rnd.chain.toFixed(3), threads: rnd.threads, inThreads: rnd.inThreads, longest: rnd.longest } : null,
    };
  }

  /** The entropy panel's DIPOLES line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.params.on) return 'DIPOLES  off (rules panel)';
    if (!C || !C.cells) return 'DIPOLES  …';
    const pc = Math.round(100 * C.polShare);
    const sg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
    if (compact) return `DIPOLES |d| ${C.meanD.toFixed(2)} · polarised ${pc}% · head-to-tail ${sg(C.chain)} · threads ${C.mid}`;
    return `DIPOLES  |d| ${C.meanD.toFixed(2)} · polarised ${C.polarised} (${pc}%) · neighbours aligned ${C.order.toFixed(2)}` +
      ` · head-to-tail ${sg(C.chain)} · in threads ${C.mid} (ends ${C.ends}) · along the field ${C.align.toFixed(2)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`charge per side (step C6d) ${on(p.on)}: dipole-dipole ${on(p.dd)} · substrate field on the sides ${on(p.phi)} · turn and stretch ${on(p.field)}` +
      ` · into phi at the sides ${on(p.deposit)} · pHalf ${p.pHalf} · even out ${p.relax}/s · flow ${p.flow} · polarisable ${p.polar} · range ${p.range} × contact` +
      ` · turn ${p.turn}, within ${p.inner} · push ${p.push} (≤ ${p.pushSat} R/s) · phi ${p.phiHalf}/R × ${p.phiW} · stretch ${p.stretch}`];
    if (C && C.cells) {
      lines.push(`dipoles: mean |d| ${C.meanD.toFixed(3)} · polarised ${C.polarised} of ${C.cells} · touching polarised pairs ${C.pairs}: aligned ${C.order.toFixed(3)}, along the line ${C.htt.toFixed(3)}, head-to-tail index ${C.chain.toFixed(3)}` +
        ` · cells in threads ${C.mid}, ends ${C.ends} · field: neighbours' ${C.eDD.toFixed(2)}, substrate ${C.ePhi.toFixed(2)}, along it ${C.align.toFixed(2)} (${C.nAlign}) · stretch ${C.stretch.toFixed(3)}`);
      lines.push(`dipoles every 10 s (|d|, polarised, aligned, head-to-tail, in threads): ${this.series.slice(-8).map((s) => `${s[0].toFixed(0)}s ${s[1].toFixed(2)}/${Math.round(100 * s[2])}%/${s[3].toFixed(2)}/${s[4].toFixed(2)}/${s[5]}`).join(' ')}`);
    }
    return lines;
  }
}
