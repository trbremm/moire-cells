// Step N1, A NUTRIENT LANDSCAPE (the user, 2026-11-16: "I think light is fueling them too easily. We might need to make the
// nutrient landscape more interesting"): THE WATER. Parts 4 and 5; README "Step N1: nutrient landscape".
//
//   CAUSTIC LIGHT (part 4)  the ripple background is the water's SURFACE: its simulated ripples (src/background.js) plus a slow SWELL
//                           of a few long travelling waves (drawn in the background too). The light that comes down through it is
//                           focused by the surface's curvature into a wandering bright NET on the dish floor: brightness 1 / |det(I +
//                           D H)| (H the curvature, D the depth the light travels; softened, capped, scaled so the swell alone
//                           averages 1: light is moved around, not made). It multiplies the light everywhere the light is USED (the
//                           dish's absorption, the substances' light reactions, the cells' pigments and dose), so it is not only drawn:
//                           cells on a bright line get more photons (and, past saturation, bleach: src/pigments.js), cells between
//                           the lines less. Drawn as a faint net of the light's colour (neon) or a dim grey one (harmonic look).
//   CURRENTS (part 5)       a slow flow carrying every mobile substance (matter.wgsl spread: upwind, flux form, exact counts) and the
//                           cells a little (cell_step.wgsl: curDrift x the water's velocity, as a force). From a stream function psi
//                           at the heat pixels' corners, so the flow is divergence-free and stops at the wall: psi = window x (A x the
//                           MOIRE BEAT of the medium's lattice against a copy turned by `turn` degrees, a hexagonal array of slow
//                           eddies that breathes a little with the medium and wanders + G x a basin-wide gyre that slowly reverses).
//                           Springs make plumes downstream; trace (the scarce nutrient, src/oases.js), which hardly spreads by itself,
//                           now travels where the water takes it. Streamlines (psi's level lines) are drawn in the machinery view.
//
// One compute pass per frame (src/shaders/water.wgsl, before the cells' ticks) writes the caustic block and psi into the heat
// buffer (3 blocks behind the charge's; heat.waterOffset); the heat (HeatP caus, cur, curDrift) and the matter (MatterP n1) pass
// the offsets on. Switches: the rules panel's group "Nutrient landscape (step N1)", URL ?caustics=0 ?currents=0.

import { loadShader } from './gpu.js';
import { LEDGER_WORDS, fmt } from './heat.js';
import { LIGHT_COMMON_URL } from './light.js';
import { pal, LOOK } from './palette.js';
import { camera } from './camera.js';
import { readBuffer } from './snapshot.js';
import { Stir } from './stir.js';
import { OBS_BLOCKS } from './obstacles.js';

const WATER_COMMON_URL = 'src/shaders/water_common.wgsl';
const WP_BYTES = 320;     // struct WaterP (step N2: + n2a, n2b, 288 until then; step G0b: + obs, obs2; 256 until then)
const WD_BYTES = 144;     // struct WDraw (step G0: + the stirred streamlines, 112 until then)
// the swell: directions (degrees from the wind), wavelengths (in R) and how fast each runs (R per s): a fixed set, so every dish's
// light moves the same way
const SWELL = [[-75, 9, 0.4], [-38, 6.2, 0.33], [-6, 12, 0.48], [23, 5.1, 0.3], [55, 7.7, 0.38], [101, 6.8, 0.35]];

export class Water {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    this.heat = null; this.background = null; this.medium = null; this.light = null;   // set by main.js
    // live-tunable: moire.water.params
    this.params = {
      caustics: true,     // the surface focuses the light into a caustic net (?caustics=0)
      currents: true,     // the water flows: substances carried, cells drift a little (?currents=0)
      // the surface
      strength: 1,        // how much of the focusing acts (0 = even light, 1 = all)
      focus: 1.8,         // how strongly the swell focuses (below ~0.8: soft dappling; ~1.3: a net of bright lines)
      depth: 20,          // how far the light travels below the surface (R): sets the swell's height for that focus
      wind: 30,           // the swell's direction (degrees)
      swellSpeed: 1,      // x every wave's speed (0: a still net)
      ripples: 0.6,       // how much the simulated ripples (divisions, deaths, the heat's simmer) bend the light
      eps: 0.08,          // softening of the focus (a finite sun)
      imax: 12,           // the brightest focus (x the mean)
      // the currents
      speed: 0.35,        // the eddies' speed (R per s)
      turn: 2.2,          // the beat: the copy of the medium's lattice turned by this many degrees (eddies ~ 0.62 R_medium / turn)
      breathe: 0.3,       // the share of the medium's breathing the eddies follow (they swell and shrink a little)
      wander: 0.015,      // the eddies' slow wandering (radians of phase per s)
      gyre: 0.25,         // the basin-wide gyre's speed (R per s at its strongest)
      gyrePeriod: 360,    // s for the gyre to turn one way, stop, turn the other way and back
      drift: 0.3,         // how much of the water's speed the cells drift with
      window: 4,          // the flow fades to nothing within this many R of the wall
      // drawing
      net: 0.22,          // the caustic net's brightness (neon; 0: not drawn)
      netHarm: 0.07,      // ... under the harmonic look
      netFrom: 0.35,      // the net shows where the light is brighter than this share of the way from 1 to the brightest focus ...
      netTo: 1,           // ... fully from here (with a soft power: thin bright lines, faint halos)
      lines: 0.35,        // the streamlines' brightness (machinery only)
      lineStep: 0,        // psi between two streamlines (0: about a dozen across the eddies' range)
      lineW: 0.8,         // CSS px
      swellShade: 0.05,   // the swell's slope in the ripple background (0: not drawn)
    };
    this.machinery = false;   // set by the View panel's machinery switch (src/actions.js)
    this.norm = 1; this.normAt = -1e9;
    this.waves = new Float32Array(24);
    this.ran = false;
    this.speedNow = 0;
  }

  static async create(device, format) {
    const w = new Water(device, format);
    await w.init();
    w.stir = await Stir.create(device);   // step G0: the cells stir the water (src/stir.js)
    w.stir.water = w;
    return w;
  }

  async init() {
    const d = this.device;
    const lres = await fetch(LIGHT_COMMON_URL, { cache: 'no-cache' });
    if (!lres.ok) throw new Error(`Could not load shader ${LIGHT_COMMON_URL}: HTTP ${lres.status}`);
    const lightC = (await lres.text()).replace(/\s*$/, '\n\n');
    const cres = await fetch(WATER_COMMON_URL, { cache: 'no-cache' });
    if (!cres.ok) throw new Error(`Could not load shader ${WATER_COMMON_URL}: HTTP ${cres.status}`);
    const waterC = (await cres.text()).replace(/\s*$/, '\n\n');
    const [mod, drawMod] = await Promise.all([
      loadShader(d, 'src/shaders/water.wgsl', { prefixes: [{ name: WATER_COMMON_URL, text: waterC }] }),
      loadShader(d, 'src/shaders/water_draw.wgsl', { prefixes: [{ name: LIGHT_COMMON_URL, text: lightC }, { name: WATER_COMMON_URL, text: waterC }] }),
    ]);
    this.pipe = d.createComputePipeline({ label: 'water surface', layout: 'auto', compute: { module: mod, entryPoint: 'surface' } });
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'water draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    const U = GPUBufferUsage;
    this.uBuf = d.createBuffer({ label: 'water params', size: WP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.uAB = new ArrayBuffer(WP_BYTES);
    this.dBuf = d.createBuffer({ label: 'water draw params', size: WD_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.dAB = new ArrayBuffer(WD_BYTES);
    this.noRip = d.createBuffer({ label: 'water: no ripples', size: 16, usage: U.STORAGE });
  }

  /**
   * Blocks of n words this keeps in the heat buffer: the caustic block, then psi ((hw + 1) x (hh + 1) words fit in 2 blocks); step G0: then the
   * cells' stirring (src/stir.js: its force splat, x and y, and its stream function on the coarse stir grid, 3 x sw x sh words in 2 blocks);
   * step G0b: then the obstacles' (src/obstacles.js: the mask, sdA, sdS, and the solved through-flow at the corners in 2 blocks).
   */
  get blocks() { return OBS_BLOCKS; }
  get causticsOn() { return !!(this.params.caustics && this.light && this.light.on && this.params.strength > 0); }
  get eddiesOn() { return !!(this.params.currents && (this.params.speed > 0 || this.params.gyre > 0)); }
  /** The water flows: the eddies and the gyre, or a perfusion's through-flow (src/perfusion.js), or both. */
  get currentsOn() { return this.eddiesOn || !!(this.perfusion && this.perfusion.flowing) || this.stirOn; }
  /** Step G0: the cells stir the water (src/stir.js). */
  get stirOn() { return !!(this.stir && this.stir.on); }

  resize(view) { this.view = view; }

  /** The heat's words (struct HeatP caus, cur, curDrift from word o), for the frame the water ran in. */
  writeHeat(u, f, o) {
    const H = this.heat;
    if (!this.ran || !H || !H.buffer || this.ranVersion !== H.version) return;
    u[o] = this.causticsOn ? H.waterOffset : 0;
    u[o + 1] = this.currentsOn ? H.waterOffset + H.n : 0;
    f[o + 2] = this.currentsOn ? Math.max(0, this.params.drift) : 0;
  }

  /** The matter's words (struct MatterP n1 from word o): the offsets in its grid view (behind the ledger), dt per substep / px^2. */
  writeMatter(u, f, o, dtSub) {
    const H = this.heat;
    if (!this.ran || !H || !H.buffer || this.ranVersion !== H.version) return;
    u[o] = this.causticsOn ? H.waterOffset - LEDGER_WORDS : 0;
    u[o + 1] = this.currentsOn ? H.waterOffset + H.n - LEDGER_WORDS : 0;
    f[o + 2] = dtSub / (H.px * H.px);
  }

  /** The swell's waves at time t (kx, ky per CSS px; height CSS px; phase), into this.waves. */
  swellAt(t) {
    const p = this.params, R = (this.heat && this.heat.R) || 6, D = Math.max(1, p.depth) * R;
    const W = this.waves, per = Math.max(0, p.focus) / Math.sqrt(SWELL.length);
    SWELL.forEach(([da, lam, c], j) => {
      const a = (p.wind + da) * Math.PI / 180, k = 2 * Math.PI / (lam * R);
      W[4 * j] = k * Math.cos(a); W[4 * j + 1] = k * Math.sin(a);
      W[4 * j + 2] = per / (D * k * k);                                    // D h k^2 = the wave's share of the focus
      W[4 * j + 3] = (1.7 * j + 0.4) - k * c * R * p.swellSpeed * t;       // phase now (the wave runs at c R / s)
    });
    for (let j = SWELL.length; j < 6; j++) W.fill(0, 4 * j, 4 * j + 4);
    return W;
  }

  /** 1 / the swell's mean brightness (sampled on a coarse grid, as the shader works it out), every couple of seconds. */
  updateNorm(t) {
    if (Math.abs(t - this.normAt) < 2 && this.normAt > -1e8) return;
    this.normAt = t;
    const p = this.params, W = this.waves, R = (this.heat && this.heat.R) || 6, D = Math.max(1, p.depth) * R;
    const vw = this.view, w = vw ? vw.cssW : 1280, h = vw ? vw.cssH : 800;
    let sum = 0, n = 0;
    for (let y = 0; y < 31; y++) {
      for (let x = 0; x < 47; x++) {
        const px = (x + 0.5) / 47 * w, py = (y + 0.5) / 31 * h;
        let hxx = 0, hyy = 0, hxy = 0;
        for (let j = 0; j < 6; j++) {
          const kx = W[4 * j], ky = W[4 * j + 1], a = W[4 * j + 2];
          if (!a) continue;
          const s = a * Math.sin(kx * px + ky * py + W[4 * j + 3]);
          hxx -= s * kx * kx; hyy -= s * ky * ky; hxy -= s * kx * ky;
        }
        const det = (1 + D * hxx) * (1 + D * hyy) - D * D * hxy * hxy;
        sum += Math.min(1 / Math.sqrt(det * det + p.eps * p.eps), p.imax); n++;
      }
    }
    this.norm = n ? n / Math.max(sum, 1e-6) : 1;
  }

  /** The frame's pass (after the background's ripples stepped, before the cells' ticks). */
  compute(encoder, frame) {
    this.ran = false;
    const H = this.heat, B = this.background, Md = this.medium;
    if (!H || !H.buffer || !this.view) return;
    // step G0: the stirred flow first (the cells' push of the frame before -> its psi in hb, which the surface pass adds)
    if (this.stir) { this.stir.heat = H; this.stir.compute(encoder, frame); }
    const caus = this.causticsOn, cur = this.currentsOn;
    if (!caus && !cur) return;
    const p = this.params, R = H.R, t = frame.time;
    this.swellAt(t);
    if (caus) this.updateNorm(t);
    // the bind group: the heat buffer and the ripple field current now (the background rotates its three buffers)
    const ripBuf = B && B.fields && B.fields[B.cur] && p.ripples > 0 ? B.fields[B.cur] : this.noRip;
    // (bind groups cached per heat buffer and ripple buffer: the background rotates three)
    if (this.bgHeat !== H.buffer) { this.bgHeat = H.buffer; this.bgs = new Map(); this.dbgs = new Map(); }
    if (!this.bgs.has(ripBuf)) {
      this.bgs.set(ripBuf, this.device.createBindGroup({
        label: 'water', layout: this.pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uBuf } },
          { binding: 1, resource: { buffer: H.buffer } },
          { binding: 2, resource: { buffer: ripBuf } },
        ],
      }));
    }
    this.bg = this.bgs.get(ripBuf);
    this.ripBuf = ripBuf;
    const u = new Uint32Array(this.uAB), f = new Float32Array(this.uAB);
    const rip = ripBuf !== this.noRip;
    u[0] = H.hw; u[1] = H.hh; u[2] = (caus ? 1 : 0) | (cur ? 2 : 0) | (rip ? 4 : 0); u[3] = H.waterOffset;
    u[4] = H.waterOffset + H.n; u[5] = rip ? B.gw : 0; u[6] = rip ? B.gh : 0; u[7] = 0;
    f[8] = H.px; f[9] = B ? B.sc : 5; f[10] = Math.max(0, p.ripples); f[11] = Math.max(1, p.depth) * R;
    f[12] = Math.max(1e-3, p.eps); f[13] = Math.max(1, p.imax); f[14] = this.norm; f[15] = Math.max(0, Math.min(1, p.strength));
    f.set(this.waves, 16);
    const W = this.view.cssW, Hh = this.view.cssH;
    // PERFUSION (src/perfusion.js): the through-flow's mean speed along x (f[43]) and y (f[51]), CSS px per s
    const thr = this.perfusion && this.perfusion.flowing ? this.perfusion.velocity(R) : [0, 0];
    f[40] = W; f[41] = Hh; f[42] = Math.max(0.5, p.window) * R; f[43] = thr[0];
    // the currents: the medium's beat against its turned copy (k0 and the breathing from src/field.js Medium)
    const k0 = Md ? Md.k0 : 2 * Math.PI / (0.62 * 9), la = (Md ? Md.la0 : 0) * Math.max(0, p.breathe), turn = p.turn * Math.PI / 180;
    let qmag = 0;
    const ph = [p.wander * t, -p.wander * t, 0];
    // step N2 (src/flow.js): the gusts (each family's strength, the tides) and the eddy pattern's drift X: its phases shift by -q . X
    const N2 = this.flow;
    const sx = N2 ? N2.advance(t, R) : [0, 0];
    const gain = N2 ? N2.writeWater(f, 72, t, W, Hh, R) : 1;
    if (!N2) { f[72] = 1; f[73] = 1; f[74] = 1; f.fill(0, 75, 80); }
    for (let m = 0; m < 3; m++) {
      const a1 = la + m * Math.PI / 3, a2 = turn + m * Math.PI / 3;
      const qx = k0 * (Math.cos(a1) - Math.cos(a2)), qy = k0 * (Math.sin(a1) - Math.sin(a2));
      qmag = Math.max(qmag, Math.hypot(qx, qy));
      f[48 + 4 * m] = qx; f[49 + 4 * m] = qy; f[50 + 4 * m] = ph[m] - (qx * sx[0] + qy * sx[1]); f[51 + 4 * m] = 0;
    }
    f[51] = thr[1];
    if (this.stir) this.stir.writeWater(u, f, 60);   // step G0: the stirred psi (struct WaterP stir)
    else u.fill(0, 60, 64);
    // step G0b: the obstacles (struct WaterP obs, obs2): the eddies fade near them, the through-flow solved round them, x the pump's flux Q
    // (the old profile's: U x the dish's height for a flow along x, -V x its width along y)
    if (this.obstacles) { this.obstacles.writeWater(u, f, 64); f[68] = thr[0] * Hh - thr[1] * W; }
    else u.fill(0, 64, 72);
    const eddies = this.eddiesOn;
    const A = eddies && qmag > 1e-9 ? gain * Math.max(0, p.speed) * R / qmag : 0;     // |u| ~ A |q|: the eddies' speed (step N2: x gain)
    const G = !eddies ? 0 : gain * Math.max(0, p.gyre) * R * Math.min(W, Hh) / Math.PI * Math.cos(2 * Math.PI * t / Math.max(10, p.gyrePeriod));
    if (!eddies) { f[76] = 0; f[77] = 0; }   // (step N2: the tides are the eddies' kin: off with them)
    f[44] = Md ? Md.cx : W / 2; f[45] = Md ? Md.cy : Hh / 2; f[46] = A; f[47] = G;
    this.psiScale = A * 3 + Math.abs(G) + Math.abs(f[76]) + Math.abs(f[77]) + Math.abs(thr[0]) * Hh + Math.abs(thr[1]) * W;
    this.speedNow = (eddies ? gain : 1) * Math.max(0, p.speed) + Math.abs(G) * Math.PI / Math.min(W, Hh) / R;
    this.gain = eddies ? gain : 1;
    this.eddy = qmag > 1e-9 ? 2 * Math.PI / qmag / R : 0;   // the beat's period (R)
    this.device.queue.writeBuffer(this.uBuf, 0, this.uAB);
    const pass = encoder.beginComputePass({ label: 'water surface' });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bg);
    pass.dispatchWorkgroups(Math.ceil((H.hw + 1) / 8), Math.ceil((H.hh + 1) / 8));
    pass.end();
    this.ran = true;
    this.ranVersion = H.version;
  }

  /** Under the cells: the caustic net where the light falls; the streamlines with the machinery. */
  render(pass, frame = {}) {
    const H = this.heat, p = this.params;
    if (!this.ran || !this.view || !H || !H.buffer || this.ranVersion !== H.version) return;
    const harm = !!(frame.look && frame.look.harmonic);
    const netA = this.causticsOn ? (harm ? p.netHarm : p.net) : 0;
    const lineA = this.currentsOn && this.machinery && !harm ? p.lines : 0;
    // step G0: the stirred flow's own streamlines (pink), in the machinery view
    const St = this.stir, stStep = St && St.active ? St.lineStep() : 0;
    const stirA = St && St.active && this.machinery && !harm && stStep > 0 ? Math.max(0, St.params.lines) : 0;
    if (!(netA > 0) && !(lineA > 0) && !(stirA > 0)) return;
    const rb = this.ripBuf || this.noRip;
    if (!this.dbgs.has(rb)) {
      this.dbgs.set(rb, this.device.createBindGroup({
        label: 'water draw', layout: this.drawPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.dBuf } },
          { binding: 1, resource: { buffer: H.buffer } },
          { binding: 2, resource: { buffer: this.light.buffer } },
          { binding: 3, resource: { buffer: this.uBuf } },
          { binding: 4, resource: { buffer: rb } },
        ],
      }));
    }
    this.dbg = this.dbgs.get(rb);
    const u = new Uint32Array(this.dAB), f = new Float32Array(this.dAB), P = pal();
    u[0] = H.hw; u[1] = H.hh; u[2] = netA > 0 ? H.waterOffset : 0; u[3] = lineA > 0 ? H.waterOffset + H.n : 0;
    f[4] = H.px; f[5] = this.view.dpr * camera.z; f[6] = netA * (this.light ? this.light.dayLevel : 1); f[7] = lineA;
    const ink = harm ? [150, 170, 200] : (P.spot || [242, 228, 200]);
    f[8] = ink[0] / 255; f[9] = ink[1] / 255; f[10] = ink[2] / 255; f[11] = 0;
    const li = [90, 200, 210];   // the streamlines: a faint teal (the water)
    f[12] = li[0] / 255; f[13] = li[1] / 255; f[14] = li[2] / 255; f[15] = 0;
    f.set(camera.vec(), 16);
    f[20] = p.lineStep > 0 ? p.lineStep : Math.max(1e-3, (this.psiScale || 1) / (this.eddiesOn ? 6 : 14));   // (step G0b: a through-flow alone, 14 lines across) f[21] = Math.max(0.3, p.lineW);
    const top = Math.max(1.01, p.imax * this.norm);   // the brightest the light gets (x the mean)
    f[22] = 1 + (top - 1) * Math.max(0, p.netFrom); f[23] = 1 + (top - 1) * Math.max(p.netFrom + 0.02, p.netTo);
    // step G0: the stirred streamlines: the stir grid (offset, sw, sh, spacing) and their step, brightness and ink
    if (stirA > 0) St.writeWater(u, f, 24); else u.fill(0, 24, 28);
    f[28] = stStep; f[29] = stirA; f[30] = this.obstacles && this.obstacles.active ? 0.5 : 0; f[31] = 0;
    const pink = [255, 120, 190];
    f[32] = pink[0] / 255; f[33] = pink[1] / 255; f[34] = pink[2] / 255; f[35] = 0;
    this.device.queue.writeBuffer(this.dBuf, 0, this.dAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.dbg);
    pass.draw(3);
  }

  /** For the experiments: the caustic light's spread (mean, quantiles, share of the floor above 1.5 x the mean) and the currents' speed. */
  async stats() {
    const H = this.heat;
    if (!H || !H.buffer || !this.ran) return null;
    const n = H.n, w = H.hw + 1, nn = (H.hw + 1) * (H.hh + 1);
    const buf = await readBuffer(this.device, H.buffer, H.waterOffset * 4, (n + nn) * 4);
    const f = new Float32Array(buf);
    const out = {};
    if (this.causticsOn) {
      const c = Array.from(f.subarray(0, n)).sort((a, b) => a - b);
      const q = (x) => c[Math.min(n - 1, Math.floor(x * n))];
      out.caustic = { mean: c.reduce((a, b) => a + b, 0) / n, p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: c[n - 1], bright: c.filter((x) => x > 1.5).length / n };
    }
    if (this.currentsOn) {
      let s = 0, mx = 0, k = 0;
      for (let y = 0; y < H.hh; y++) {
        for (let x = 0; x < H.hw; x++) {
          const o = n + y * w + x;
          const ux = (f[o + w] - f[o]) / H.px, uy = -(f[o + 1] - f[o]) / H.px, v = Math.hypot(ux, uy) / H.R;
          s += v; mx = Math.max(mx, v); k++;
        }
      }
      out.current = { mean: s / k, max: mx, eddy: this.eddy };
    }
    return out;
  }

  /** The panel's WATER line. */
  panelLine(compact = false) {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    const c = this.causticsOn ? `caustics ${p.focus >= 1 ? 'net' : 'dappled'} (focus ${p.focus})` : 'caustics off';
    const k = this.currentsOn ? `currents ${fmt(this.speedNow || 0)} R/s (eddies ${fmt(this.eddy || 0)} R)` : 'currents off';
    const st = (this.stir ? ` · ${this.stir.panelText()}` : '') +   // step G0: the cells' own stirring
      (this.obstacles && this.obstacles.active ? ` · ${this.obstacles.panelText()}` : '');   // step G0b: the obstacles
    if (compact) return `WATER ${c} · ${k}${st}`;
    return `WATER  ${c} · ${k}${st} · cells drift ${p.drift} of it · gyre ${p.gyre} R/s, turning every ${p.gyrePeriod} s · rules: caustics ${on(p.caustics)}, currents ${on(p.currents)}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    return [`water (step N1): caustics ${on(p.caustics)} (strength ${p.strength}, focus ${p.focus}, depth ${p.depth} R, wind ${p.wind}°, ripples ${p.ripples}, ` +
      `mean scale ${this.norm.toFixed(3)}) · currents ${on(p.currents)} (eddies ${p.speed} R/s at ${p.turn}° beat, ${fmt(this.eddy || 0)} R across; gyre ${p.gyre} R/s; cells drift ${p.drift})`,
      ...(this.stir ? this.stir.overlayLines() : []), ...(this.obstacles ? this.obstacles.overlayLines() : [])];
  }
}
