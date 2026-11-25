// Step C6n: the neon look (user, 2026-11-15: "80s neon colour lights, think of video clip graphics"), and the frame's
// drawing as a whole. Only drawing: nothing here reads back into the simulation.
//
// Every frame (encode):
//   1. the soft ripple background (src/background.js) straight onto the canvas: the one soft layer, not lit
//   2. the cells into the TRAIL buffer (rgba16float, canvas size). With trails on, what it holds is first faded (the
//      pipeline's blend multiplies it by the blend constant: exp(-real time / trail), the alpha faster so the ghosts are
//      light, not shadow), then this frame's cells are drawn over it: moving cells leave short fading streaks, as a long
//      exposure or video feedback. Trails off: the buffer is cleared instead
//   3. the LIGHT buffer (rgba16float, canvas size), cleared: the layers under the cells (the cells' field dots, the
//      substances and springs, the light's tint), the trail buffer copied over them, then the layers over the cells
//      (the spot's outline). The substances never trail
//   4. the HALO (neon on): the light at 1/res of the canvas's size (the cells at full weight, the rest at `others`, so
//      the substances and the spot are quieter lights), blurred by a separable Gaussian of sigma1 CSS px; with level 2
//      once more at half that size, sigma2 CSS px. Tight: sigma1 is about a tube's width, so a packed tissue stays a
//      net of separate tubes and the dish does not fog over
//   5. the composite onto the canvas: the light as drawn (sharp), plus k1 x the tight halo and k2 x the wide one, with
//      a soft shoulder (a tube brighter than white saturates toward white instead of clipping in one channel);
//      premultiplied "over" the background. Neon off: no halo, no shoulder: the flat look exactly as before (the
//      layers' "over" blending in a float buffer, then "over" the background, is the same as drawing them in order)
// The layers draw their own neon (src/cells.js and cell_draw.wgsl: tubes, parts, hum; matter_draw.wgsl: lit dots; the
// palette, src/palette.js). Recording (Shift+V) copies the canvas, so it gets the finished picture.
//
// Cost: two canvas-size float buffers (8 bytes per device pixel each) and, per frame, a fade, a copy, a composite and
// at most 2 x 3 small passes at 1/2 and 1/4 (or 1/4 and 1/8) resolution. The cheap path (phones and small screens): the
// tight halo at 1/4 resolution, no wide level, shorter trails; and if frames run slow at 1x to 8x, the halo steps down
// by itself (watch).
// Step H1: the HARMONIC look (src/harmonic.js) replaces steps 1, 4 and 5 while it is on: no ripples (the canvas is cleared
// to black by the last pass), no trails, no hum, no halo; the layers draw their harmonic versions into the same buffers
// (frame.look.harmonic), and the last pass (blur, grain, shoulder) puts the light buffer onto the canvas.

import { loadShader, computePipe, renderPipe, allPipes } from './gpu.js';
import { LOOK } from './palette.js';
import { Harmonic } from './harmonic.js';

export const LIGHT_FORMAT = 'rgba16float';

// halo strength (Shift+1 cycles): k1 the tight halo, k2 the wide, faint one (only with level 2)
export const HALOS = [
  { name: 'off', k1: 0, k2: 0 },
  { name: 'low', k1: 0.7, k2: 0 },
  { name: 'medium', k1: 1.2, k2: 0.25 },
  { name: 'high', k1: 1.8, k2: 0.6 },
];

const BG = { r: 4 / 255, g: 6 / 255, b: 10 / 255, a: 1 };   // --bg #04060a
const MAX_PAIRS = 11;          // blur reads on each side (struct Blur holds 12 weights)

export class Neon {
  /** cheap: the phone path (see the top of this file). */
  constructor(device, canvasFormat, cheap) {
    this.device = device;
    this.canvasFormat = canvasFormat;
    this.cheap = !!cheap;
    // live-tunable: moire.neon.params (the switches are E, Shift+1, Shift+2, Shift+3, and the view panel)
    this.params = {
      halo: 2,              // index into HALOS
      trails: true,         // Shift+2
      hum: true,            // Shift+3 (the cells' flicker and activity glow: cells.look.hum*)
      sigma1: 1.4,          // CSS px: the tight halo's Gaussian width
      sigma2: 4.5,          // CSS px: the wide level's
      res: cheap ? 4 : 2,   // the tight halo's resolution is 1 / res of the canvas's; the wide level's half that
      level2: !cheap,       // the wide level at all (halo medium and high)
      knee: [0.1, 0.45],    // only light brighter than these makes a halo (its brightest channel; soft between): tubes,
                            // lamps and specks glow, the dark insides and the light's faint tint do not
      others: 0.45,         // share of the non-cell light (substances, field dots, the spot) in the halo; cells 1
      trail: cheap ? 0.1 : 0.15,   // s of real time: the trails' fade time constant (a streak shows for about 3 x this)
      trailSpeed: 0.5,      // above 1x the trails shorten by (speed reached)^-trailSpeed, so 32x and MAX do not smear
      trailAlpha: 3,        // the trails' alpha fades this many times faster than their light (ghosts glow, never shade)
      shoulder: 0.82,       // composite: light above this rolls off toward 1 instead of clipping
      autoMs: 26,           // watch: frames slower than this (smoothed, at 1x to 8x) for 3 s step the halo down
    };
    this.time = 0;          // real seconds the page has drawn (the hum's clock)
    this.slow = 0;          // watch: seconds the frames have been slow
    this.reduced = 0;       // watch: steps taken
    this.view = null;
    this.timing = null;     // probe: GPU ms of the drawing
    this.harmonic = null;   // step H1: the harmonic look (src/harmonic.js)
  }

  get on() { return LOOK.neon; }
  set on(v) { LOOK.neon = !!v; }
  get halo() { return HALOS[Math.max(0, Math.min(HALOS.length - 1, this.params.halo))]; }

  static async create(device, canvasFormat, cheap) {
    const n = new Neon(device, canvasFormat, cheap);
    await n.init();
    return n;
  }

  async init() {
    const d = this.device;
    const mod = await loadShader(d, 'src/shaders/neon.wgsl');
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    const fade = { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' };
    const pipe = (entryPoint, format, blend) => renderPipe(d, {
      label: `neon ${entryPoint}`, layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint, targets: [blend ? { format, blend } : { format }] },
      primitive: { topology: 'triangle-list' },
    });
    Object.assign(this, await allPipes({   // (step SP1: async, at once)
      fadePipe: pipe('fs_fade', LIGHT_FORMAT, { color: fade, alpha: fade }),
      copyPipe: pipe('fs_copy', LIGHT_FORMAT, { color: over, alpha: over }),
      downPipe: pipe('fs_down', LIGHT_FORMAT, null),
      blurPipe: pipe('fs_blur', LIGHT_FORMAT, null),
      compPipe: pipe('fs_comp', this.canvasFormat, { color: over, alpha: over }),
    }));
    this.sampler = d.createSampler({ label: 'neon', magFilter: 'linear', minFilter: 'linear' });
    const U = GPUBufferUsage;
    this.downU = [0, 1].map((k) => d.createBuffer({ label: `neon down ${k}`, size: 32, usage: U.UNIFORM | U.COPY_DST }));
    this.blurU = [0, 1, 2, 3].map((k) => d.createBuffer({ label: `neon blur ${k}`, size: 112, usage: U.UNIFORM | U.COPY_DST }));
    this.compU = d.createBuffer({ label: 'neon composite', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.harmonic = await Harmonic.create(d, this.canvasFormat);   // step H1
  }

  // ---------- targets ----------
  resize(view) {
    this.view = view;
    this.makeTargets();
  }

  /** The canvas-size buffers and the halo levels (remade when the size or the halo's resolution changes). */
  makeTargets() {
    const v = this.view, P = this.params, d = this.device;
    const res = Math.max(1, Math.round(P.res));
    const sizes = [[v.pxW, v.pxH], [Math.ceil(v.pxW / res), Math.ceil(v.pxH / res)], [Math.ceil(v.pxW / res / 2), Math.ceil(v.pxH / res / 2)]];
    const key = JSON.stringify(sizes);
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    if (this.tex) for (const t of Object.values(this.tex)) t.destroy();
    const U = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const make = (label, [w, h]) => d.createTexture({ label: `neon ${label}`, size: [Math.max(1, w), Math.max(1, h)], format: LIGHT_FORMAT, usage: U });
    this.tex = {
      trail: make('trail', sizes[0]), light: make('light', sizes[0]),
      h1a: make('halo 1a', sizes[1]), h1b: make('halo 1b', sizes[1]),
      h2a: make('halo 2a', sizes[2]), h2b: make('halo 2b', sizes[2]),
    };
    this.sizes = sizes;
    const V = {};
    for (const [k, t] of Object.entries(this.tex)) V[k] = t.createView();
    this.views = V;
    const bg = (pipe, entries) => d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    const tex = (binding, view) => ({ binding, resource: view });
    const samp = { binding: 3, resource: this.sampler };
    const buf = (binding, buffer) => ({ binding, resource: { buffer } });
    this.bg = {
      copy: bg(this.copyPipe, [tex(0, V.trail)]),
      down1: bg(this.downPipe, [tex(0, V.light), tex(1, V.trail), samp, buf(4, this.downU[0])]),
      down2: bg(this.downPipe, [tex(0, V.h1a), tex(1, V.h1a), samp, buf(4, this.downU[1])]),
      blur1h: bg(this.blurPipe, [tex(0, V.h1a), samp, buf(5, this.blurU[0])]),
      blur1v: bg(this.blurPipe, [tex(0, V.h1b), samp, buf(5, this.blurU[1])]),
      blur2h: bg(this.blurPipe, [tex(0, V.h2a), samp, buf(5, this.blurU[2])]),
      blur2v: bg(this.blurPipe, [tex(0, V.h2b), samp, buf(5, this.blurU[3])]),
      comp: bg(this.compPipe, [tex(0, V.light), tex(1, V.h1a), tex(2, V.h2a), samp, buf(6, this.compU)]),
    };
  }

  // ---------- the frame ----------
  /** Real time between frames and the speed reached (main.js), for the trails and the hum. */
  tickReal(realDt) { this.time += realDt; }

  /** The trail buffer's fade this frame: exp(-real dt / the trail's time constant), shorter at fast speeds. */
  fadeFactor(f) {
    const P = this.params;
    const tau = Math.max(1e-3, P.trail) / Math.max(1, f.reached || 1) ** Math.max(0, P.trailSpeed);
    return Math.exp(-Math.max(0, f.realDt || 0) / tau);
  }

  /**
   * Record the whole drawing for frame f into the encoder: L = { background, under: [layers], cells, top: [layers] }
   * (see the top of this file). canvasView: the canvas's texture view this frame.
   */
  encode(encoder, f, canvasView, L) {
    if (!this.view) return;
    this.makeTargets();   // (cheap when nothing changed; moire.neon.params.res may have)
    const HM = this.harmonic, harm = !!(HM && HM.on);   // step H1: the harmonic look over either
    const on = this.on && !harm, P = this.params, d = this.device;
    f.now = this.time;                          // real time, for the hum
    f.look = { neon: on, hum: on && P.hum, harmonic: harm ? HM : null, cheap: this.cheap };   // what the layers draw (step S2: + the cheap path) (src/cells.js, src/matter.js, ...)
    // 1. background (step H1, harmonic: none; its last pass clears the canvas to black)
    let pass;
    if (!harm) {
      pass = encoder.beginRenderPass({
        label: 'background', colorAttachments: [{ view: canvasView, clearValue: BG, loadOp: 'clear', storeOp: 'store' }],
      });
      L.background.render(pass, f);
      pass.end();
    }
    // the cells' activity for the hum (a small compute pass of the drawing's own; reads the cells only); step H1: the
    // harmonic look's violet (busy cells) reads it too
    if (((on && P.hum) || harm) && L.cells.encodeGlow) L.cells.encodeGlow(encoder, f, this.time);
    // 2. the cells into the trail buffer
    const trails = on && P.trails && !f.camMoved;   // (app: a zoom or pan starts the trails afresh, instead of smearing them)
    pass = encoder.beginRenderPass({
      label: 'cells (trail)',
      colorAttachments: [{ view: this.views.trail, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: trails ? 'load' : 'clear', storeOp: 'store' }],
    });
    if (trails) {
      const k = this.fadeFactor(f), ka = k ** Math.max(1, P.trailAlpha);
      pass.setBlendConstant({ r: k, g: k, b: k, a: ka });
      pass.setPipeline(this.fadePipe);
      pass.draw(3);
    }
    L.cells.render(pass, f);
    pass.end();
    // 3. the light buffer
    pass = encoder.beginRenderPass({
      label: 'light', colorAttachments: [{ view: this.views.light, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    for (const l of L.under) l.render(pass, f);
    pass.setPipeline(this.copyPipe);
    pass.setBindGroup(0, this.bg.copy);
    pass.draw(3);
    for (const l of L.top) if (l.renderTop) l.renderTop(pass, f);
    pass.end();
    // step H1, harmonic: the last pass (blur, grain, shoulder) instead of the halo and the composite
    if (harm) {
      HM.encode(encoder, canvasView, this.views.light, this.view.pxW, this.view.pxH, this.time);
      return;
    }
    // 4. the halo
    const H = this.halo, v = this.view;
    const halo = on && H.k1 > 0, wide = halo && P.level2 && H.k2 > 0;
    if (halo) {
      const res = Math.max(1, Math.round(P.res));
      const [w1, h1] = this.sizes[1], [w2, h2] = this.sizes[2];
      d.queue.writeBuffer(this.downU[0], 0, new Float32Array([1 / v.pxW, 1 / v.pxH, w1, h1, res / 4, P.others, P.knee[0], P.knee[1]]));
      this.writeBlur(0, [1 / w1, 0], P.sigma1 * v.dpr / res);
      this.writeBlur(1, [0, 1 / h1], P.sigma1 * v.dpr / res);
      this.fullPass(encoder, 'halo 1 down', this.views.h1a, this.downPipe, this.bg.down1);
      this.fullPass(encoder, 'halo 1 blur x', this.views.h1b, this.blurPipe, this.bg.blur1h);
      this.fullPass(encoder, 'halo 1 blur y', this.views.h1a, this.blurPipe, this.bg.blur1v);
      if (wide) {
        d.queue.writeBuffer(this.downU[1], 0, new Float32Array([1 / w1, 1 / h1, w2, h2, 0.5, 1, 0, 1e-4]));
        this.writeBlur(2, [1 / w2, 0], P.sigma2 * v.dpr / res / 2);
        this.writeBlur(3, [0, 1 / h2], P.sigma2 * v.dpr / res / 2);
        this.fullPass(encoder, 'halo 2 down', this.views.h2a, this.downPipe, this.bg.down2);
        this.fullPass(encoder, 'halo 2 blur x', this.views.h2b, this.blurPipe, this.bg.blur2h);
        this.fullPass(encoder, 'halo 2 blur y', this.views.h2a, this.blurPipe, this.bg.blur2v);
      }
    }
    // 5. the composite
    d.queue.writeBuffer(this.compU, 0, new Float32Array([halo ? H.k1 : 0, wide ? H.k2 : 0, on ? P.shoulder : 2, 0]));
    pass = encoder.beginRenderPass({
      label: 'composite', colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.compPipe);
    pass.setBindGroup(0, this.bg.comp);
    pass.draw(3);
    pass.end();
  }

  fullPass(encoder, label, view, pipe, bg) {
    const pass = encoder.beginRenderPass({ label, colorAttachments: [{ view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  /** A blur pass's uniform: a Gaussian of `sigma` texels along `dir` (uv per texel), paired for bilinear reads. */
  writeBlur(k, dir, sigma) {
    const s = Math.max(0.35, sigma);
    const K = Math.max(1, Math.min(2 * MAX_PAIRS, Math.ceil(2.5 * s)));
    const g = [];
    for (let i = 0; i <= K; i++) g.push(Math.exp(-0.5 * (i / s) ** 2));
    const tot = g[0] + 2 * g.slice(1).reduce((a, b) => a + b, 0);
    const w = [g[0] / tot], o = [0];
    for (let i = 1; i <= K; i += 2) {
      const a = g[i] / tot, b = i + 1 <= K ? g[i + 1] / tot : 0;
      w.push(a + b);
      o.push((i * a + (i + 1) * b) / (a + b));
    }
    const ab = new ArrayBuffer(112), f = new Float32Array(ab), u = new Uint32Array(ab);
    f[0] = dir[0]; f[1] = dir[1]; u[2] = w.length - 1;
    w.forEach((x, i) => { f[4 + i] = x; });
    o.forEach((x, i) => { f[16 + i] = x; });
    this.device.queue.writeBuffer(this.blurU[k], 0, ab);
  }

  /**
   * The F overlay's timing: the GPU time of the whole drawing (all of encode: background, cells, light, halo, composite),
   * recorded K times into a scratch canvas-size texture and timed until the queue reports it done, minus an empty submit
   * (as src/cells.js probe; rough). The trails are left out (their fade is one pass more), and the trail buffer then holds
   * this frame's cells without their ghosts: a blink of the trails once a second while the overlay is open.
   */
  async probe(L, f, K = 8) {
    if (this.probing || !this.tex) return;
    this.probing = true;
    const d = this.device, q = d.queue, v = this.view, P = this.params;
    try {
      if (!this.scratch || this.scratch.width !== v.pxW || this.scratch.height !== v.pxH) {
        if (this.scratch) this.scratch.destroy();
        this.scratch = d.createTexture({ label: 'neon probe', size: [v.pxW, v.pxH], format: this.canvasFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      }
      const view = this.scratch.createView(), g = { ...f, dt: 0, realDt: 0 }, trails = P.trails;
      const timed = async (cbs) => { const t0 = performance.now(); q.submit(cbs); await q.onSubmittedWorkDone(); return performance.now() - t0; };
      await q.onSubmittedWorkDone();
      const base = await timed([]);
      // (step C12: encoded right before its submit, with no wait between: encoded before the waits, a window resize in
      // them destroyed buffers it holds, "used in submit while destroyed", on a busy GPU)
      if (!this.tex || !this.scratch || this.scratch.width !== this.view.pxW || this.scratch.height !== this.view.pxH) return;
      const e = d.createCommandEncoder({ label: 'neon probe' });
      P.trails = false;
      try { for (let k = 0; k < K; k++) this.encode(e, g, view, L); } finally { P.trails = trails; }
      const t = Math.max(0, (await timed([e.finish()])) - base) / K;
      this.timing = this.timing == null ? t : this.timing + (t - this.timing) * 0.3;
    } finally {
      this.probing = false;
    }
  }

  // ---------- switches ----------
  toggle() {
    if (this.harmonic && this.harmonic.on) { this.harmonic.on = false; this.on = true; return 'neon look: bright tubes with a tight halo, trails and hum (the harmonic look is off)'; }
    this.on = !this.on;
    return this.on ? 'neon look: bright tubes with a tight halo, trails and hum (E: flat look)' : 'flat look (as before step C6n): crisp shapes, faded colours, no glow (E: neon)'; }

  cycleHalo() {
    const P = this.params;
    P.halo = (P.halo + 1) % HALOS.length;
    return `halo ${this.halo.name}${this.on ? '' : ' (the neon look is off: E)'}`;
  }

  label() {
    if (this.harmonic && this.harmonic.on) return this.harmonic.label();
    if (!this.on) return 'flat';
    return `neon · halo ${this.halo.name} · trails ${this.params.trails ? 'on' : 'off'} · hum ${this.params.hum ? 'on' : 'off'}`;
  }

  /**
   * Called every frame by main.js: if the frames run slow (smoothed frame time above autoMs at 1x to 8x, not paused)
   * for 3 s, take the halo one step cheaper: first the wide level off, then the tight one at 1/4 resolution, then
   * halo low. Returns a message when it stepped (main.js flashes it).
   */
  watch(frameMs, realDt, steady) {
    const P = this.params;
    if (!this.on || (this.harmonic && this.harmonic.on) || !steady || this.halo.k1 <= 0 || frameMs < P.autoMs) { this.slow = 0; return null; }
    this.slow += realDt;
    if (this.slow < 3) return null;
    this.slow = 0;
    if (P.level2 && this.halo.k2 > 0) { P.level2 = false; this.reduced++; return 'neon: frames were slow, the wide halo is off (moire.neon.params.level2)'; }
    if (P.res < 4) { P.res = 4; this.makeTargets(); this.reduced++; return 'neon: frames were slow, the halo is now drawn at quarter resolution'; }
    if (P.halo > 1) { P.halo = 1; this.reduced++; return 'neon: frames were slow, halo low (Shift+1 cycles it)'; }
    return null;
  }

  /** The F overlay's line. */
  overlayLine() {
    const P = this.params, v = this.view, T = this.timing;
    if (this.harmonic && this.harmonic.on) return `look (\`): ${this.harmonic.label()}${T ? ` · drawing per frame (gpu, probe) ${T.toFixed(2)} ms` : ''}`;
    if (!this.on) return `look (E): flat${T ? ` · drawing per frame (gpu, probe) ${T.toFixed(2)} ms` : ''}`;
    return `look (E): neon · halo (Shift+1) ${this.halo.name}: 1/${P.res} res, sigma ${P.sigma1} px${P.level2 && this.halo.k2 > 0 ? ` + 1/${2 * P.res} res, ${P.sigma2} px` : ''}` +
      ` · trails (Shift+2) ${P.trails ? `${P.trail} s` : 'off'} · hum (Shift+3) ${P.hum ? 'on' : 'off'}${this.cheap ? ' · cheap path' : ''}${this.reduced ? ` · stepped down ${this.reduced}x` : ''}` +
      ` · buffers ${v ? `${v.pxW}x${v.pxH}` : '-'}${T ? ` · drawing per frame (gpu, probe) ${T.toFixed(2)} ms` : ''}`;
  }
}
