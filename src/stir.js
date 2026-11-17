// Step G0, CELLS STIR THE WATER (the user, 2026-11-17: "is the cells movement stirring the liquid too? if not, they should"; README "Step
// G0: strong glue and stirred water"). Until now the currents were PRESCRIBED (step N1: the medium's moire eddies + a gyre; D1's perfusion
// through-flow) and only dragged the cells (curDrift). Now the coupling goes both ways:
//
//   the push    every tick each cell puts down its drag on the water: WET x (its driven velocity - the water's velocity there), x its footprint's
//               share of a node's area, on a coarse STIR GRID (nodes `cell` heat pixels apart, about one R; cell_step.wgsl). The reaction of
//               the drag the water puts on the cell (curDrift x u: wet = curDrift by default, action = reaction). Choice: a crawler's MOTOR
//               pushes on the floor (its traction goes to the floor, not the water), but its BODY still moves through the water, so it drags
//               the water by the wet share of its drag; a cell that drifts with the water drags nothing; the heat's kicks (incoherent) are left
//               out. So a crawling colony stirs where its cells move together, not where they jiggle.
//   the flow    once per frame (src/shaders/stir.wgsl): the curl of the frame's mean force x GAIN = the vorticity it makes; the vorticity relaxes
//               toward it with VISCOSITY (reach `reach` R) and DECAY (`fade` s), an implicit step solved by `iters` Jacobi passes; then the
//               stream function, (lap - kappa^2) psi = -omega (a weak screening over `screen` R: the dish floor's friction on a thin film),
//               `psiIters` Jacobi passes warm-started from the frame before; psi = 0 on the rim. Its psi is ADDED to the prescribed psi at the
//               heat pixels' corners (water.wgsl), so the matter's transport (matter.wgsl spread, unchanged) stays divergence-free, flux-form and
//               exact, and the cells drift with the sum (curDrift).
//   energy      the water holds no energy of its own in the books (its motion is slow and syrupy: no inertia worth counting). The cells' work
//               against it stays drag heat (as before); what the STIRRED water's push does on a cell (its share of the forces' work) is taken
//               from the heat under that cell (cell_step.wgsl: the work in less it, the heat less it, the same counts), so the stirred flow's
//               work comes out of the heat the stirring cells' drag made, and when it brakes a cell it gives heat back. Exact.
//   MASK-READY  a solid mask on the stir grid (all fluid today): psi is HELD on solid nodes (an island keeps its value; the rim is 0), the curl and
//               the vorticity are 0 there. For step G0b: paint the mask from the substrate's solid pixels (downsampled), make the cells' contact
//               and the matter's flux respect it; perfusion's through() could then become PRESSURE-DRIVEN by giving the two side walls psi = 0
//               and psi = Q (the flux) instead of the prescribed profile, each obstacle island's psi set by zero net pressure round it (iterate
//               it from the circulation), and the through-flow then threads round the pillars by itself.
//
// Switches: ?stir=0 (off), ?stirgain= (the gain), ?stirsplit=0 (the stirred work not taken from heat: books then count it as work in, like the
// prescribed currents); streamlines of the stirred flow (pink) in the machinery view.

import { loadShader } from './gpu.js';
import { readBuffer } from './snapshot.js';

const SP_BYTES = 64;      // struct StirP
const FX = 1024;          // the splat's fixed point: counts per px/s of coverage-weighted drag (cell_step.wgsl, Fields.g0b.w)
export const ST_BITS = { ON: 1, SPLIT: 2 };   // ST_* in cell_common.wgsl

export class Stir {
  constructor(device) {
    this.device = device;
    this.water = null; this.heat = null;   // set by src/water.js / main.js
    // live-tunable: moire.stir.params (the rules panel's group "Stirred water (step G0)")
    this.params = {
      on: true,          // the cells stir the water (?stir=0)
      split: true,       // the stirred water's push on cells is paid from the heat under them (?stirsplit=0)
      gain: 4,           // G: water speed per unit of coverage-weighted push (?stirgain=; a crowd moving together at v drags the water at
                         // G wet v / (1 + G wet), about half its speed)
      wet: -1,           // the cells' drag share on the water (-1: the water's drift share, curDrift: action = reaction)
      reach: 2,          // the viscous reach (R): a push moves the water this far round it
      fade: 3,           // s: the stirred flow fades this fast when the push stops
      screen: 12,        // R: the stream function's screening (the floor's friction on a thin film; large = long-range)
      cell: 2,           // heat pixels per stir node (2: about one R)
      iters: 8,          // Jacobi passes per frame for the vorticity
      psiIters: 16,      // ... for the stream function (even)
      lines: 0.5,        // the stirred streamlines' brightness in the machinery view (0: not drawn)
      lineStep: 0,       // psi between two of them (0: from the flow's range)
      censusEvery: 2,    // s of simulated time between read-backs of the flow (its speed for the panel, the streamlines' spacing)
    };
    this.active = false;  // ran this frame (its offsets are valid for this frame's heat buffer)
    this.ticks = 0;       // the cells' ticks since the splat was last read (src/cells.js adds them)
    this.census = null;
    this.nextCensus = 0;
    this.version = -1;
    this.sw = 0; this.sh = 0; this.n = 0;
  }

  static async create(device) {
    const s = new Stir(device);
    await s.init();
    return s;
  }

  async init() {
    const d = this.device;
    const mod = await loadShader(d, 'src/shaders/stir.wgsl');
    const C = GPUShaderStage.COMPUTE;
    const ro = { type: 'read-only-storage' };
    this.bgl = d.createBindGroupLayout({
      label: 'stir',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'storage' } },
        { binding: 2, visibility: C, buffer: ro }, { binding: 3, visibility: C, buffer: ro }, { binding: 4, visibility: C, buffer: ro },
        { binding: 5, visibility: C, buffer: { type: 'storage' } }, { binding: 6, visibility: C, buffer: ro },
      ],
    });
    const layout = d.createPipelineLayout({ label: 'stir', bindGroupLayouts: [this.bgl] });
    this.pipes = {};
    for (const e of ['curl', 'omega', 'psi', 'publish']) this.pipes[e] = d.createComputePipeline({ label: `stir ${e}`, layout, compute: { module: mod, entryPoint: e } });
    this.uBuf = d.createBuffer({ label: 'stir params', size: SP_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uAB = new ArrayBuffer(SP_BYTES);
  }

  get on() { return !!this.params.on; }
  get spacing() { return Math.max(2, Math.round(this.params.cell)); }
  /** The wet share (the cells' drag on the water). */
  wet() { const w = this.params.wet; return w >= 0 ? w : Math.max(0, this.water ? this.water.params.drift : 0.3); }

  /** Word offset of the stir blocks in hb (behind the water's caustic block and its psi: blocks 3 and 4 of the water's 5). */
  offsets() {
    const H = this.heat;
    const base = H.waterOffset + 3 * H.n;
    return { fx: base, psi: base + 2 * this.n };
  }

  /** (Re)size the grid and its state for the heat grid now in use. */
  size() {
    const H = this.heat, sc = this.spacing;
    const sw = Math.floor(H.hw / sc) + 1, sh = Math.floor(H.hh / sc) + 1;
    if (this.version === H.version && sw === this.sw && sh === this.sh && this.bufs) return;
    this.version = H.version;
    if (this.bufs) for (const b of Object.values(this.bufs)) b.destroy();
    this.sw = sw; this.sh = sh; this.n = sw * sh;
    if (3 * this.n > 2 * H.n) throw new Error(`stir grid ${sw}x${sh} does not fit the water's blocks`);
    const d = this.device, U = GPUBufferUsage, mk = (label) => d.createBuffer({ label: `stir ${label}`, size: this.n * 4, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.bufs = { src: mk('source'), wOld: mk('vorticity'), wA: mk('vorticity A'), wB: mk('vorticity B'), pA: mk('psi A'), pB: mk('psi B'), mask: mk('mask') };
    const B = this.bufs, bg = (label, rhs, aux, pin, pout) => d.createBindGroup({
      label: `stir ${label}`, layout: this.bgl,
      entries: [{ binding: 0, resource: { buffer: this.uBuf } }, { binding: 1, resource: { buffer: H.buffer } },
        { binding: 2, resource: { buffer: rhs } }, { binding: 3, resource: { buffer: aux } }, { binding: 4, resource: { buffer: pin } },
        { binding: 5, resource: { buffer: pout } }, { binding: 6, resource: { buffer: B.mask } }],
    });
    this.bg = {
      curl: bg('curl', B.mask, B.mask, B.mask, B.src),
      w0: bg('omega 0', B.src, B.wOld, B.wOld, B.wA), wAB: bg('omega A>B', B.src, B.wOld, B.wA, B.wB), wBA: bg('omega B>A', B.src, B.wOld, B.wB, B.wA),
      pAB: bg('psi A>B', B.wOld, B.mask, B.pA, B.pB), pBA: bg('psi B>A', B.wOld, B.mask, B.pB, B.pA),
      pub: bg('publish', B.mask, B.mask, B.pA, B.src),
    };
    this.ticks = 0;
    this.census = null;
  }

  /** The frame's passes (src/water.js compute, before the surface pass): the cells' push of the frame before -> the stirred psi in hb. */
  compute(encoder, frame) {
    this.active = false;
    const H = this.heat;
    if (!this.on || !H || !H.buffer || !this.pipes) return;
    this.size();
    const p = this.params, R = H.R, h = this.spacing * H.px, o = this.offsets();
    const ticks = this.ticks;
    this.ticks = 0;
    const dt = Math.max(1e-4, ticks * (frame.tickDt || 1 / 60));
    const a = dt / Math.max(0.05, p.fade), L = Math.max(0, p.reach) * R / h, ks = h / (Math.max(0.5, p.screen) * R);
    const u = new Uint32Array(this.uAB), f = new Float32Array(this.uAB);
    u[0] = this.sw; u[1] = this.sh; u[2] = this.n; u[3] = 1; u[4] = o.fx; u[5] = o.psi; u[6] = 0; u[7] = 0;
    f[8] = h; f[9] = ticks ? 1 / (FX * ticks) : 0; f[10] = Math.max(0, p.gain); f[11] = ticks ? a : 0;
    f[12] = ticks ? a * L * L : 0; f[13] = ks * ks; f[14] = 0; f[15] = 0;
    this.device.queue.writeBuffer(this.uBuf, 0, this.uAB);
    const wx = Math.ceil(this.sw / 8), wy = Math.ceil(this.sh / 8), B = this.bufs;
    let pass = encoder.beginComputePass({ label: 'stir vorticity' });
    pass.setPipeline(this.pipes.curl); pass.setBindGroup(0, this.bg.curl); pass.dispatchWorkgroups(wx, wy);
    pass.setPipeline(this.pipes.omega);
    const K = Math.max(1, Math.round(p.iters));
    for (let k = 0; k < K; k++) { pass.setBindGroup(0, k === 0 ? this.bg.w0 : (k & 1 ? this.bg.wAB : this.bg.wBA)); pass.dispatchWorkgroups(wx, wy); }
    pass.end();
    encoder.copyBufferToBuffer(K & 1 ? B.wA : B.wB, 0, B.wOld, 0, this.n * 4);   // (the last pass wrote A when K is odd)
    encoder.clearBuffer(H.buffer, o.fx * 4, 2 * this.n * 4);                     // the splat: the cells put down this frame's from here
    pass = encoder.beginComputePass({ label: 'stir stream function' });
    pass.setPipeline(this.pipes.psi);
    const Kp = 2 * Math.max(1, Math.round(p.psiIters / 2));                       // (even: the result ends in A)
    for (let k = 0; k < Kp; k++) { pass.setBindGroup(0, k & 1 ? this.bg.pBA : this.bg.pAB); pass.dispatchWorkgroups(wx, wy); }
    pass.setPipeline(this.pipes.publish); pass.setBindGroup(0, this.bg.pub); pass.dispatchWorkgroups(wx, wy);
    pass.end();
    this.active = true;
    this.maybeCensus(frame.time);
  }

  /** The cells' words (struct Fields g0b, g0c from word o). */
  writeFields(u, f, o) {
    const p = this.params, on = this.active && this.on;
    u[o] = on ? ST_BITS.ON | (p.split ? ST_BITS.SPLIT : 0) : 0;
    f[o + 1] = on ? this.wet() : 0; f[o + 2] = on ? this.spacing * this.heat.px : 1; f[o + 3] = FX;
    const off = on ? this.offsets() : { fx: 0, psi: 0 };
    u[o + 4] = on ? this.sw : 0; u[o + 5] = on ? this.sh : 0; u[o + 6] = off.fx; u[o + 7] = off.psi;
  }

  /** The water's words (struct WaterP stir: offset, sw, sh, h bits): 0 offset = none. */
  writeWater(u, f, o) {
    const on = this.active && this.on;
    u[o] = on ? this.offsets().psi : 0; u[o + 1] = on ? this.sw : 0; u[o + 2] = on ? this.sh : 0; f[o + 3] = on ? this.spacing * this.heat.px : 1;
  }

  /** Every few s of simulated time: the stirred flow's speed (mean, 90th percentile, max; R / s) and its stream function's range. */
  maybeCensus(time) {
    if (this.reading || time < this.nextCensus) { if (time < this.nextCensus - 1e3) this.nextCensus = time; return; }
    this.nextCensus = time + Math.max(0.25, this.params.censusEvery);
    this.reading = true;
    const H = this.heat, o = this.offsets(), sw = this.sw, sh = this.sh, n = this.n, h = this.spacing * H.px, R = H.R, version = this.version;
    readBuffer(this.device, H.buffer, o.psi * 4, n * 4).then((ab) => {
      if (version !== this.version) return;
      const p = new Float32Array(ab), sp = [];
      let pmax = 0, s = 0;
      for (let y = 0; y + 1 < sh; y++) {
        for (let x = 0; x + 1 < sw; x++) {
          const i = y * sw + x;
          const ux = (p[i + sw] - p[i] + p[i + sw + 1] - p[i + 1]) / (2 * h), uy = -(p[i + 1] - p[i] + p[i + sw + 1] - p[i + sw]) / (2 * h);
          const v = Math.hypot(ux, uy) / R;
          sp.push(v); s += v;
          pmax = Math.max(pmax, Math.abs(p[i]));
        }
      }
      sp.sort((a, b) => a - b);
      const q = (x) => (sp.length ? sp[Math.min(sp.length - 1, Math.floor(x * sp.length))] : 0);
      this.census = { time, mean: sp.length ? s / sp.length : 0, p90: q(0.9), max: sp.length ? sp[sp.length - 1] : 0, psiMax: pmax, nodes: n };
    }).catch(() => {}).finally(() => { this.reading = false; });
  }

  /** The stirred streamlines' psi step (px^2 / s): from the flow's range, a handful of lines across it. */
  lineStep() {
    if (this.params.lineStep > 0) return this.params.lineStep;
    const C = this.census;
    return C && C.psiMax > 0 ? C.psiMax / 4 : 0;
  }

  panelText() {
    const C = this.census;
    if (!this.on) return 'stirred off';
    if (!C) return 'stirred …';
    return `stirred ${C.mean.toFixed(3)} R/s (max ${C.max.toFixed(2)})`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    return [`stirred water (step G0) ${on(p.on)}: gain ${p.gain}, wet ${this.wet().toFixed(2)}, reach ${p.reach} R, fade ${p.fade} s, screen ${p.screen} R, grid ${this.sw}×${this.sh}` +
      ` (${p.cell} heat px), ${p.iters} + ${p.psiIters} passes · work paid from heat ${on(p.split)}` +
      (C ? ` · speed mean ${C.mean.toFixed(4)}, p90 ${C.p90.toFixed(4)}, max ${C.max.toFixed(3)} R/s` : '')];
  }
}
