// Charge (Part C, step C6b). CHARGE comes from the groups (src/matter.js, GROUP_CHARGE): a giver is +1, a taker -1, a
// linker and trace 0; fuel and sediment are neutral, and every reaction conserves charge (checked at startup).
//
// The SCREENED CHARGE FIELD lives on the substrate grid (the heat buffer, two blocks behind the cells' pigments): the
// potential phi solves  phi - lambda^2 laplacian(phi) = strength x rho,  rho the charge density (the free atoms' charges,
// and the cells' net charge, which each cell puts down at its place every tick), so its decay law is an exponential
// cut-off at the screening length lambda, as charge in salty water. A few red-black over-relaxation sweeps per tick
// (matter.wgsl, relax), each tick starting from the last tick's phi. Rules (each a switch in the action table):
//   charge field (Shift+7)       phi is computed, and the free charged atoms DRIFT in it, + down and - up the potential,
//                                at their own spreading speed (Einstein's relation, phi in units of the thermal energy),
//                                added to their spreading (matter.wgsl, spread: conservative, whole counts, a CFL-like cap).
//                                So a fast light atom cannot run far ahead of its slow partner of the other sign: their
//                                cloud spreads as a pair.
//   cells' charge from stock (Shift+8)  a cell's charge in field B (step 5) is its stock's net charge, saturating:
//                                qB x tanh(net / qHalf), instead of the fixed charge per fate (off: those, for comparison)
//   cells feel the grid (Shift+9) a charged cell is pushed down (+) or up (-) the grid's potential (its membrane's six corners
//                                read phi, cell_eat.wgsl plan; the step pushes, cell_step.wgsl)
//   contours (Shift+0)           phi drawn as thin crisp contour lines (+ and - in their own inks; drawing only; also with the
//                                machinery, Shift+4)
// The books: free charge in the dish (from the matter's read-back), the cells' charge (from the eat's), a census of the
// cells' charge and the spread of phi (ledger words LG_Q_* in heat_common.wgsl), shown in the F overlay and a short
// CHARGE line in the entropy panel.

import { loadShader } from './gpu.js';
import { LEDGER_WORDS, fmt } from './heat.js';
import { SUBSTANCES, NCH } from './matter.js';
import { pal } from './palette.js';
import { CELL_FLOATS } from './cells.js';   // step C6c: the Cell record grew

const LG_Q = { CEN: 19136, PHI: 19200, PMAX: 19456 };   // heat_common.wgsl
const DRAW_BYTES = 64;                                  // struct ContourP in charge_draw.wgsl

export class Charge {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    this.heat = null;
    this.matter = null;
    this.eat = null;
    this.cells = null;
    // live-tunable: moire.charge.params. The switches are rules (keys Shift+7 to Shift+0); the rest are knobs.
    this.params = {
      on: true,           // Shift+7: the screened charge field is computed, and the free charged atoms drift in it
      stock: true,        // Shift+8: a cell's charge in field B from its stock's net charge (off: the fixed charges per fate)
      feel: true,         // Shift+9: cells feel the grid's field (needs Shift+7)
      contours: false,    // Shift+0: phi drawn as contour lines (drawing only; also shown with the machinery, Shift+4)
      // the field
      lambda: 3,          // screening length (R): the field of a charge falls off as exp(-r / lambda)
      strength: 80,       // phi (in units of the thermal energy) per unit of charge density (atom-units per R^2), for a
                          // charge spread smoothly over more than lambda
      drift: 1,           // how fast the free charged atoms drift down the potential, x their spreading (1 = Einstein's
                          // relation: then a cloud in balance holds exp(-z phi) of its atoms of charge z)
      sweeps: 3,          // relaxation sweeps per tick (each: two dispatches over the grid)
      omega: 1.5,         // the sweeps' over-relaxation weight (1 = plain Gauss-Seidel; below 2)
      cellsIn: true,      // the cells' net charge counts in rho (so a charged cell gathers a cloud of the other sign)
      // the cells
      qHalf: 0.01,        // a cell's charge in field B is qB x tanh(net charge / qHalf) (net charge in atom-units: a cell holds about
                          // 0.3 units of each free atom; most cells are neutral to a few counts, cells running swap engines hold
                          // about 0.01 to 0.04 more of one sign, see the README)
      qB: 1,              // ... (the fixed per-fate charges of step 5 are about 1)
      bSign: 1,           // field B's sign rule while the charges come from the stocks: +1 like repels like (as real charge,
                          // and as the substrate's field); -1 like attracts like. Key U flips it then (and fields.sign, the
                          // per-fate charges' rule, while Shift+8 is off), so Shift+8 off gives back step 5's page exactly
      feelGain: 20,       // cells feel the grid: speed = feelGain x q x (-grad phi) (R / s per unit of phi per R; around a
                          // charged cell phi changes by about 0.01 to 0.05 per R, so a charged cell drifts at 0.2 to 1 R / s)
      feelSat: 1,         // ... saturating at this speed (R / s)
      // drawing (Shift+0): contour lines of phi
      step: 0.01,         // the first line's phi; each further line at twice the last (0.01, 0.02, ... 1.28)
      levels: 8,          // lines each way (+ and -) at most
      lineW: 1.1,         // line width (CSS px)
      alpha: 0.85,        // brightness
    };
    this.ledger = null;
    this.drawBG = null;
    this.bgVersion = -1;
    this.phiLive = false;   // phi has been solved since the grid was made (cleared when nothing is left to solve)
  }

  static async create(device, format) {
    const c = new Charge(device, format);
    await c.init();
    return c;
  }

  async init() {
    const d = this.device;
    const mod = await loadShader(d, 'src/shaders/charge_draw.wgsl');
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'charge contours', layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.drawU = d.createBuffer({ label: 'charge contours params', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.drawAB = new ArrayBuffer(DRAW_BYTES);
  }

  /** Blocks of n words this keeps in the heat buffer: phi, and the cells' net charge put down this tick. */
  get blocks() { return 2; }
  /** Word offset of phi in the heat buffer (0: no grid yet). */
  get phiOffset() { return this.heat && this.heat.buffer ? this.heat.chargeOffset : 0; }
  /** Whether the field is computed this frame. */
  get fieldOn() { return !!this.params.on; }
  /** Whether the cells put their net charge down this frame (the field on, the cells eating). */
  get cellsDeposit() { return this.fieldOn && !!this.params.cellsIn && !!(this.eat && this.eat.params.on); }
  /** Whether the cells feel the grid's field this frame. */
  get feelOn() { return this.fieldOn && !!this.params.feel && !!(this.eat && this.eat.params.on) && this.params.feelGain > 0; }
  /** Whether a cell's B charge comes from its stock (needs the cells eating: otherwise there is no stock to speak of). */
  get stockOn() { return !!this.params.stock && !!(this.eat && this.eat.params.on); }
  /** Field B's sign rule in use: the stock charges' (params.bSign) or the per-fate charges' (cells.fields.sign). */
  get signB() { return this.stockOn ? this.params.bSign : this.cells.fields.sign; }
  /** Key U: flip the sign rule in use; returns the new sign. */
  flipSignB() {
    if (this.stockOn) return (this.params.bSign = -this.params.bSign);
    return (this.cells.fields.sign = -this.cells.fields.sign);
  }

  /** Whether the contours are drawn (their switch, or the machinery). */
  get contoursOn() { return this.fieldOn && !!this.params.contours; }

  /** The relaxation's numbers for the matter's uniform: [L, strength x conc, omega, drift] (conc: units per R^2 per count). */
  relaxNumbers(conc) {
    const H = this.heat, P = this.params, a = H.px / H.R;
    const L = (Math.max(0.1, P.lambda) / a) ** 2;
    return [L, Math.max(0, P.strength) * conc, Math.max(0.1, Math.min(1.95, P.omega)), Math.max(0, P.drift)];
  }

  // ---------- the books ----------
  /** The heat's ledger read-back (after the eat's and the matter's): the census and phi's spread. */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_Q.CEN + 16 * q + k]; return s; };
    const f = new Float32Array(w.buffer, LG_Q.PHI * 4, 256);
    let p2 = 0;
    for (let k = 0; k < 256; k++) p2 += f[k];
    const pmax = new Float32Array(w.buffer, LG_Q.PMAX * 4, 1)[0];
    const M = this.matter, E = this.eat;
    const D = M ? M.dish : new Float64Array(NCH);
    let plus = 0, minus = 0;
    SUBSTANCES.forEach((s, c) => { if (s.charge > 0) plus += D[c] * s.charge; else if (s.charge < 0) minus -= D[c] * s.charge; });
    const S = E && E.ledger ? E.ledger.stock : null;
    let cellsQ = 0;
    if (S) SUBSTANCES.forEach((s, c) => { cellsQ += S[c] * s.charge; });
    const n = this.heat ? this.heat.n : 1;
    const cells = this.cells ? this.cells.count : 1;
    this.ledger = {
      time: rec.time, plus, minus, net: plus - minus, cellsQ, total: plus - minus + cellsQ, ...this.books(plus - minus + cellsQ),
      pos: v(0), neg: v(1), neutral: Math.max(0, cells - v(0) - v(1)), meanQ: v(2) / 1000 / cells, meanNet: v(3) / 1000 / cells,
      phiRms: Math.sqrt(Math.max(0, p2) / Math.max(1, n)), phiMax: pmax,
    };
  }

  /**
   * The charge's books, from the atoms ledger (src/matter.js; exact counts): charge added by the springs = in the dish +
   * in the cells + out (lost at the edge, washed, dropped on a resize). Every reaction conserves charge, so the rounding
   * is exactly 0, as the atoms'.
   */
  books(inside) {
    const M = this.matter;
    if (!M) return { qAdd: 0, qOut: 0, qRound: 0 };
    let add = 0, out = 0;
    SUBSTANCES.forEach((s, c) => { add += s.charge * M.tot.add[c]; out += s.charge * (M.tot.lost[c] + M.tot.gone[c]); });
    return { qAdd: add, qOut: out, qRound: add - (inside + out) };
  }

  /** For tools and the console: the numbers of the last read-back. */
  summary() { return this.ledger; }

  /** Tuning aid: the cells' net charges (atom-units) and q, read back: percentiles of |net|, and q's share above 0.5. */
  async cellStats() {
    const C = this.cells, d = this.device, n = C.count, F = CELL_FLOATS;
    const buf = d.createBuffer({ size: n * F * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(C.cellBuf, 0, buf, 0, n * F * 4);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const net = [], q = [];
    let pos = 0, neg = 0, ef = 0;
    for (let i = 0; i < n; i++) {
      net.push(Math.abs(f[i * F + 23])); q.push(f[i * F + 22]);
      if (f[i * F + 23] > 0) pos += f[i * F + 23]; else neg -= f[i * F + 23];
      ef += Math.hypot(f[i * F + 24], f[i * F + 25]);
    }
    // charged cells (|q| > 0.3) within 2.5 R of each other: how many pairs have the same sign, against random mixing of
    // the signs (do like charges keep apart, and opposite ones pair up?)
    const ch = [];
    for (let i = 0; i < n; i++) if (Math.abs(f[i * F + 22]) > 0.3) ch.push([f[i * F], f[i * F + 1], Math.sign(f[i * F + 22])]);
    let same = 0, pairs = 0;
    const r2 = (2.5 * C.R) ** 2;
    for (let a = 0; a < ch.length; a++) {
      for (let b = a + 1; b < ch.length; b++) {
        if ((ch[a][0] - ch[b][0]) ** 2 + (ch[a][1] - ch[b][1]) ** 2 > r2) continue;
        pairs++; if (ch[a][2] === ch[b][2]) same++;
      }
    }
    const np = ch.filter((c) => c[2] > 0).length, nm = ch.length - np, nn = ch.length;
    const rnd = nn > 1 ? (np * (np - 1) + nm * (nm - 1)) / (nn * (nn - 1)) : 0;
    net.sort((a, b) => a - b);
    const p = (x) => +net[Math.min(n - 1, Math.floor(x * n))].toPrecision(3);
    return { net: { p50: p(0.5), p90: p(0.9), p99: p(0.99), max: p(1 - 1e-9) }, sumPos: pos, sumNeg: neg,
      qAbove: q.filter((x) => Math.abs(x) > 0.5).length, qMeanAbs: q.reduce((a, b) => a + Math.abs(b), 0) / n, efMean: ef / n,
      charged: [np, nm], nearPairs: pairs, sameShare: pairs ? same / pairs : null, randomShare: rnd };
  }

  /**
   * Tuning aid (console or tools): read phi and the charge density back. Resolves to { phi: [min, max, rms], rho: [min,
   * max] (charge per R^2, free atoms + cells), sep: the rms of rho, pts: [x, y, phi, rho] at the 8 largest |phi| }.
   */
  async probe(cx = null, cy = null) {
    const H = this.heat, M = this.matter, d = this.device, n = H.n;
    const bytes = (H.extraBlocks + 4) * n * 4;
    const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(H.buffer, LEDGER_WORDS * 4, buf, 0, bytes);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const ab = buf.getMappedRange().slice(0);
    buf.unmap(); buf.destroy();
    const w = new Int32Array(ab), f = new Float32Array(ab);
    const po = H.chargeOffset - LEDGER_WORDS, base = M.copyBase(M.cur), a = H.px / H.R, conc = 1 / (4096 * a * a);
    let pmin = 0, pmax = 0, p2 = 0, rmin = 0, rmax = 0, r2 = 0;
    const top = [];
    for (let i = 0; i < n; i++) {
      const p = f[po + i];
      let q = 0;
      SUBSTANCES.forEach((s, c) => { if (s.charge) q += s.charge * w[base + c * n + i]; });
      q += w[po + n + i];
      const rho = q * conc;
      pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); p2 += p * p;
      rmin = Math.min(rmin, rho); rmax = Math.max(rmax, rho); r2 += rho * rho;
      if (top.length < 8 || Math.abs(p) > Math.abs(top[top.length - 1][2])) {
        top.push([(i % H.hw + 0.5) * H.px, (Math.floor(i / H.hw) + 0.5) * H.px, p, rho]);
        top.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]));
        if (top.length > 8) top.pop();
      }
    }
    // with a centre (CSS px): each charged substance's amount and its rms distance from there (R), e.g. a spring's cloud
    const spread = {};
    if (cx != null) {
      SUBSTANCES.forEach((s, c) => {
        if (!s.charge) return;
        let m = 0, mr = 0;
        for (let i = 0; i < n; i++) {
          const v = w[base + c * n + i];
          if (v <= 0) continue;
          const x = (i % H.hw + 0.5) * H.px - cx, y = (Math.floor(i / H.hw) + 0.5) * H.px - cy;
          m += v; mr += v * (x * x + y * y);
        }
        spread[s.name] = [m / 4096, m > 0 ? Math.sqrt(mr / m) / H.R : 0];
      });
    }
    return { phi: [pmin, pmax, Math.sqrt(p2 / n)], rho: [rmin, rmax], sep: Math.sqrt(r2 / n), pts: top.slice(0, 3), spread };
  }

  /** The entropy panel's line (short). */
  panelLine(compact = false) {
    const L = this.ledger, P = this.params;
    if (!L) return 'CHARGE  …';
    const sg = (x) => (x >= 0 ? '+' : '−') + fmt(Math.abs(x));
    const cells = `cells + ${L.pos} · − ${L.neg} · |q| ${L.meanQ.toFixed(2)}`;
    if (compact) return `CHARGE free ${sg(L.net)} · ${cells}`;
    const field = P.on ? '' : ' · field off (Shift+7)';
    return `CHARGE  free +${fmt(L.plus)} −${fmt(L.minus)} (net ${sg(L.net)}) · in cells ${sg(L.cellsQ)} · ${cells}${field}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const P = this.params, L = this.ledger, on = (x) => (x ? 'on' : 'off');
    const q = SUBSTANCES.filter((s) => s.charge !== 0).map((s) => `${s.name} ${s.charge > 0 ? '+' : ''}${s.charge}`).join(' ');
    const lines = [`charge (step C6b, from the groups: ${q}; the rest 0): Shift+7 field and drift ${on(P.on)} · Shift+8 cells' B charge from their stock ${on(P.stock)}` +
      ` · Shift+9 cells feel the grid ${on(P.feel)} · Shift+0 contours ${on(P.contours)} · screening ${P.lambda} R · strength ${P.strength} · drift ${P.drift}` +
      ` · ${P.sweeps} sweeps/tick (ω ${P.omega}) · cells in rho ${on(P.cellsIn)} · cell q = ${P.qB} tanh(net / ${P.qHalf}) · feel ${P.feelGain} R/s (≤ ${P.feelSat})`];
    if (L) {
      lines.push(`CHARGE free in the dish: + ${fmt(L.plus)} − ${fmt(L.minus)} (net ${L.net.toFixed(2)}) · in the cells ${L.cellsQ.toFixed(2)} · dish + cells ${L.total.toFixed(2)}` +
        ` · books: added by springs ${L.qAdd.toFixed(2)} = dish + cells + out ${L.qOut.toFixed(2)}, rounding ${L.qRound === 0 ? '0' : L.qRound.toExponential(1)}` +
        ` · cells net + ${L.pos}, net − ${L.neg}, neutral ${L.neutral} (|q| > 0.1) · mean |q| ${L.meanQ.toFixed(3)}, mean |net| ${L.meanNet.toFixed(3)} units` +
        ` · phi rms ${L.phiRms.toFixed(3)}, max ${L.phiMax.toFixed(3)}`);
    }
    return lines;
  }

  // ---------- drawing ----------
  resize(view) { this.view = view; }
  compute() {}

  render() {}

  /** Over the cells (they hold most of the charge, and their dark insides would hide the lines under them). */
  renderTop(pass) {
    const H = this.heat;
    if (!this.contoursOn || !this.view || !H || !H.buffer || !this.phiLive) return;
    if (!this.drawBG || this.bgVersion !== H.version) {
      this.bgVersion = H.version;
      this.drawBG = this.device.createBindGroup({
        label: 'charge contours', layout: this.drawPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.drawU } },
          { binding: 1, resource: { buffer: H.buffer, offset: LEDGER_WORDS * 4 } },
        ],
      });
    }
    const P = this.params, Pal = pal(), f = new Float32Array(this.drawAB), u = new Uint32Array(this.drawAB);
    u[0] = H.hw; u[1] = H.hh; u[2] = this.phiOffset - LEDGER_WORDS; u[3] = Math.max(1, Math.round(P.levels));
    f[4] = H.px; f[5] = this.view.dpr; f[6] = Math.max(1e-4, P.step); f[7] = Math.max(0.3, P.lineW);
    const ink = Pal.charge, lv = Pal.levels.charge * P.alpha;
    for (let k = 0; k < 3; k++) { f[8 + k] = ink.pos[k] / 255 * lv; f[12 + k] = ink.neg[k] / 255 * lv; }
    f[11] = lv; f[15] = lv;
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(3);
  }
}

