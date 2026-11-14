// The viscous background: a damped slow wave field (ripples) simulated on the GPU, plus a drifting sheen.
//
// Ripple field: three f32 storage buffers on a coarse grid (one cell = SC CSS pixels, as in the CPU reference),
// holding the previous, current and next state; they rotate roles every step.
// Each frame: (1) inject queued impulses into the current buffer, (2) one wave step per simulation tick.
// Drawing: a full-screen triangle; the fragment shader samples the grid smoothly and adds the sheen.
// Step C1: the heat grid (src/heat.js, set as this.heat by main.js) makes the medium simmer: small random bumps, more
// where it is hot (ripple_step.wgsl), so hot places shimmer and cool places go still.
//
// Layer interface used by main.js (other layers follow the same shape):
//   resize(view)              view = { cssW, cssH, dpr, pxW, pxH }
//   compute(encoder, frame)   frame = { dt, time, ticks, tickDt }  (ticks = fixed 60 Hz sim steps this frame)
//   render(pass, frame)       draw into the shared render pass
//   impulse(x, y, amp, r)     public: drop a ripple at CSS pixel (x, y); later used by divisions and deaths

import { loadShader } from './gpu.js';

const MAX_IMPULSES = 256;

export class Background {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    this.params = {
      coupling: 0.06,   // wave speed squared (grid units per tick); reference value
      damping: 0.992,   // per tick; reference value
      viscosity: 0.015, // extra damping of short waves (not in the reference; 0 = off, 0.04 = very soft)
      ripple: 1.0,      // drawing gain for the ripples
      sheen: 1.0,       // drawing gain for the sheen
      heatDrops: 1e-5,  // step C1: chance per ripple cell per step of a small bump, x the temperature squared (heat per R^2)
      heatAmp: 0.3,     // ... the bump's height (a tap is about 2.5, spread over a few cells)
      heatMaxP: 0.004,  // ... the chance is capped here
    };
    this.heatOn = true;   // step C1: heat drives the ripples (Shift+R)
    this.heat = null;     // the heat band (set by main.js)
    this.heatVersion = -1;
    this.steps = 0;
    this.ambient = true;  // occasional random drops, standing in for the divisions and deaths of the reference
    this.queue = [];      // pending impulses: [gx, gy, amp, radius] in grid units
    this.cur = 0;         // which of the three field buffers holds the current state
    this.gw = 0; this.gh = 0; this.sc = 5;
    this.view = null;
  }

  static async create(device, format) {
    const bg = new Background(device, format);
    await bg.init();
    return bg;
  }

  async init() {
    const d = this.device;
    const [stepMod, injectMod, drawMod] = await Promise.all([
      loadShader(d, 'src/shaders/ripple_step.wgsl'),
      loadShader(d, 'src/shaders/ripple_inject.wgsl'),
      loadShader(d, 'src/shaders/background_draw.wgsl'),
    ]);
    this.stepPipe = d.createComputePipeline({
      label: 'ripple step', layout: 'auto', compute: { module: stepMod, entryPoint: 'step' },
    });
    this.injectPipe = d.createComputePipeline({
      label: 'ripple inject', layout: 'auto', compute: { module: injectMod, entryPoint: 'inject' },
    });
    this.drawPipe = d.createRenderPipeline({
      label: 'background draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    const U = GPUBufferUsage;
    this.stepU = d.createBuffer({ label: 'ripple step params', size: 64, usage: U.UNIFORM | U.COPY_DST });
    this.noHeat = d.createBuffer({ label: 'ripple no heat', size: 16, usage: U.STORAGE });
    this.injectU = d.createBuffer({ label: 'ripple inject params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.drawU = d.createBuffer({ label: 'background draw params', size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.impBuf = d.createBuffer({ label: 'ripple impulses', size: MAX_IMPULSES * 16, usage: U.STORAGE | U.COPY_DST });
    this.impData = new Float32Array(MAX_IMPULSES * 4);
    this.drawData = new Float32Array(12);
  }

  resize(view) {
    this.view = view;
    const { cssW, cssH } = view;
    this.sc = cssW * cssH > 1400000 ? 7 : 5;   // same rule as the reference
    const gw = Math.ceil(cssW / this.sc) + 1;
    const gh = Math.ceil(cssH / this.sc) + 1;
    if (gw === this.gw && gh === this.gh) return;
    this.gw = gw; this.gh = gh;

    const d = this.device;
    if (this.fields) this.fields.forEach((b) => b.destroy());
    this.fields = [0, 1, 2].map((k) => d.createBuffer({
      label: `ripple field ${k}`, size: gw * gh * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    this.cur = 0;

    this.makeStepBG();
    this.injectBG = [0, 1, 2].map((k) => d.createBindGroup({
      layout: this.injectPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.injectU } },
        { binding: 1, resource: { buffer: this.impBuf } },
        { binding: 2, resource: { buffer: this.fields[k] } },
      ],
    }));
    this.drawBG = [0, 1, 2].map((k) => d.createBindGroup({
      layout: this.drawPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.drawU } },
        { binding: 1, resource: { buffer: this.fields[k] } },
      ],
    }));
  }

  /** Bind groups for the three rotations: index k = "buffer k is current", (k+2)%3 previous, (k+1)%3 next. */
  makeStepBG() {
    const F = this.fields, H = this.heat && this.heat.buffer;
    this.heatVersion = H ? this.heat.version : -1;
    this.stepBG = [0, 1, 2].map((k) => this.device.createBindGroup({
      layout: this.stepPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.stepU } },
        { binding: 1, resource: { buffer: F[k] } },
        { binding: 2, resource: { buffer: F[(k + 2) % 3] } },
        { binding: 3, resource: { buffer: F[(k + 1) % 3] } },
        { binding: 4, resource: { buffer: H || this.noHeat } },
      ],
    }));
  }

  /**
   * Drop a ripple at CSS pixel (x, y). amp > 0 a bump, < 0 a dip, in the reference's units
   * (its impulse() calls: division 1.3, death -1, stir 1.2, tap 2 to 3). r = bump radius in CSS pixels.
   * The bump is a soft Gaussian scaled to hold the same volume as the reference's 5-point bump (1 + 4 x 0.5),
   * so wider bumps make longer, softer waves without making them stronger.
   */
  impulse(x, y, amp, r = 1.2 * this.sc) {
    const rc = Math.max(0.3, r / this.sc);
    const peak = amp * 3 / (2 * Math.PI * rc * rc);
    this.queue.push([x / this.sc, y / this.sc, peak, rc]);
    if (this.queue.length > MAX_IMPULSES) this.queue.splice(0, this.queue.length - MAX_IMPULSES);
  }

  ambientTick() {
    // about one drop per second, of the sizes the reference makes for divisions (+1.3) and deaths (-1)
    if (Math.random() < 0.018) {
      const v = this.view;
      const amp = Math.random() < 0.6 ? 0.6 + Math.random() * 0.7 : -(0.5 + Math.random() * 0.5);
      this.impulse(Math.random() * v.cssW, Math.random() * v.cssH, amp);
    }
  }

  compute(encoder, frame) {
    if (!frame.ticks) return;
    const d = this.device;
    if (this.ambient) for (let i = 0; i < frame.ticks; i++) this.ambientTick();

    // step params every frame, so tuning this.params live takes effect
    const Ht = this.heat, P = this.params;
    if (Ht && Ht.buffer && this.heatVersion !== Ht.version) this.makeStepBG();
    const heatOn = !!(this.heatOn && Ht && Ht.buffer && this.heatVersion === Ht.version && P.heatDrops > 0);
    const sp = new ArrayBuffer(64), su = new Uint32Array(sp), sf = new Float32Array(sp);
    su[0] = this.gw; su[1] = this.gh;
    sf[2] = P.coupling; sf[3] = P.damping; sf[4] = P.viscosity;
    su[5] = heatOn ? 1 : 0; su[6] = (this.steps += frame.ticks) >>> 0;
    sf[7] = this.sc;
    if (heatOn) {
      sf[8] = Ht.px; su[9] = Ht.hw; su[10] = Ht.hh; su[11] = Ht.offset(Ht.cur); sf[12] = Ht.tempScale;
      sf[13] = P.heatDrops; sf[14] = P.heatAmp; sf[15] = P.heatMaxP;
    }
    d.queue.writeBuffer(this.stepU, 0, sp);

    const wgx = Math.ceil(this.gw / 8), wgy = Math.ceil(this.gh / 8);
    const pass = encoder.beginComputePass({ label: 'ripples' });

    if (this.queue.length) {
      const n = this.queue.length;
      for (let i = 0; i < n; i++) this.impData.set(this.queue[i], i * 4);
      d.queue.writeBuffer(this.impBuf, 0, this.impData, 0, n * 4);
      d.queue.writeBuffer(this.injectU, 0, new Uint32Array([this.gw, this.gh, n, 0]));
      this.queue.length = 0;
      pass.setPipeline(this.injectPipe);
      pass.setBindGroup(0, this.injectBG[this.cur]);
      pass.dispatchWorkgroups(wgx, wgy);
    }

    pass.setPipeline(this.stepPipe);
    for (let s = 0; s < frame.ticks; s++) {
      pass.setBindGroup(0, this.stepBG[this.cur]);
      pass.dispatchWorkgroups(wgx, wgy);
      this.cur = (this.cur + 1) % 3;   // the buffer just written is now the current state
    }
    pass.end();
  }

  render(pass, frame) {
    const v = this.view;
    const a = this.drawData;
    a[0] = v.pxW; a[1] = v.pxH; a[2] = v.dpr; a[3] = this.sc;
    a[4] = this.gw; a[5] = this.gh; a[6] = frame.time; a[7] = this.params.ripple;
    a[8] = this.params.sheen;
    this.device.queue.writeBuffer(this.drawU, 0, a);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG[this.cur]);
    pass.draw(3);
  }
}
