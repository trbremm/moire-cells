// The sources (nutrient and threat emitters) and the landscape they make, drawn over the background.
//
// Sources live on the CPU as a short list and are uploaded to a fixed-capacity GPU storage buffer
// (struct Emitter, see field_common.wgsl) whenever they change. Each frame:
//   compute: field_prep.wgsl turns every emitter into its beat (wavevectors and phases against the medium),
//   render:  landscape_draw.wgsl evaluates the beat per pixel and adds the soft green / red glow and the
//            ring markers on top of the background (additive blending).
//
// Not yet ported from the reference: sources drifting with the medium and being pushed by stirring,
// threat fading (amp -0.06 per s, removed below 0.4), nutrient being eaten, and new sources appearing
// on their own every ~25 s. Sources here sit still and keep their strength.

import { loadFieldShader, writeEmitter, KIND, EMITTER_FLOATS, EMITTER_BYTES, BEAT_BYTES } from './field.js';

export const MAX_SOURCES = 64;   // GPU buffer capacity

export class Landscape {
  constructor(device, format, medium) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.sources = [];          // { x, y, kind, la, amp } in CSS px
    this.dirty = true;
    this.view = null;
    this.params = {
      on: true,           // landscape glow on/off (L key); markers stay
      glow: 1.0,          // glow gain (1 = reference)
      markers: 1.0,       // marker gain
      maxSources: 6,      // the reference keeps at most 6; adding one more drops the oldest (up to MAX_SOURCES)
      amp: 5,             // strength of a new source (reference)
      range: 9,           // envelope range r0 in units of R (reference: r0^2 = 81 R^2)
    };
  }

  static async create(device, format, medium) {
    const l = new Landscape(device, format, medium);
    await l.init();
    return l;
  }

  async init() {
    const d = this.device;
    const [prepMod, drawMod] = await Promise.all([
      loadFieldShader(d, 'src/shaders/field_prep.wgsl'),
      loadFieldShader(d, 'src/shaders/landscape_draw.wgsl'),
    ]);
    this.prepPipe = d.createComputePipeline({
      label: 'source prep', layout: 'auto', compute: { module: prepMod, entryPoint: 'prep' },
    });
    const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'landscape draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: add, alpha: add } }] },
      primitive: { topology: 'triangle-list' },
    });

    const U = GPUBufferUsage;
    this.emitBuf = d.createBuffer({ label: 'sources', size: MAX_SOURCES * EMITTER_BYTES, usage: U.STORAGE | U.COPY_DST });
    this.beatBuf = d.createBuffer({ label: 'source beats', size: MAX_SOURCES * BEAT_BYTES, usage: U.STORAGE });
    this.prepU = d.createBuffer({ label: 'source prep params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.drawU = d.createBuffer({ label: 'landscape draw params', size: 32, usage: U.UNIFORM | U.COPY_DST });
    const ab = new ArrayBuffer(MAX_SOURCES * EMITTER_BYTES);
    this.emitF = new Float32Array(ab);
    this.emitU = new Uint32Array(ab);
    this.drawAB = new ArrayBuffer(32);
    this.drawF = new Float32Array(this.drawAB);
    this.drawI = new Uint32Array(this.drawAB);

    this.prepBG = d.createBindGroup({
      layout: this.prepPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.medium.buffer } },
        { binding: 1, resource: { buffer: this.prepU } },
        { binding: 2, resource: { buffer: this.emitBuf } },
        { binding: 3, resource: { buffer: this.beatBuf } },
      ],
    });
    this.drawBG = d.createBindGroup({
      layout: this.drawPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.medium.buffer } },
        { binding: 1, resource: { buffer: this.drawU } },
        { binding: 2, resource: { buffer: this.beatBuf } },
      ],
    });
  }

  resize(view) {
    // keep the sources at the same place relative to the dish, as the reference does
    if (this.view && (this.view.cssW !== view.cssW || this.view.cssH !== view.cssH)) {
      const sx = view.cssW / this.view.cssW, sy = view.cssH / this.view.cssH;
      for (const s of this.sources) { s.x *= sx; s.y *= sy; }
    }
    this.view = view;
    this.dirty = true;   // R may have changed, and with it the range
  }

  /** Add a source at CSS pixel (x, y). kind: KIND.NUT or KIND.THR. la: lattice angle (random if omitted). */
  addSource(x, y, kind, la) {
    if (la === undefined) la = (Math.random() < 0.5 ? -1 : 1) * (0.07 + Math.random() * 0.14);  // 4 to 12 degrees off the medium
    const cap = Math.max(1, Math.min(MAX_SOURCES, Math.round(this.params.maxSources)));
    while (this.sources.length >= cap) this.sources.shift();
    this.sources.push({ x, y, kind, la, amp: this.params.amp });
    this.dirty = true;
  }

  clear() { this.sources.length = 0; this.dirty = true; }

  /** The reference's starting sources (two nutrient, one threat), with fixed angles so a fresh load looks the same. */
  seed() {
    const { cssW: W, cssH: H } = this.view;
    this.addSource(W * 0.24, H * 0.36, KIND.NUT, 0.12);
    this.addSource(W * 0.74, H * 0.70, KIND.NUT, -0.16);
    this.addSource(W * 0.80, H * 0.24, KIND.THR, 0.10);
  }

  upload() {
    const R = this.medium.R, r0sq = (this.params.range * R) ** 2;
    this.sources.forEach((s, i) => writeEmitter(this.emitF, this.emitU, i, { ...s, r0sq }));
    const n = this.sources.length;
    if (n) this.device.queue.writeBuffer(this.emitBuf, 0, this.emitF, 0, n * EMITTER_FLOATS);
    this.device.queue.writeBuffer(this.prepU, 0, new Uint32Array([n, 0, 0, 0]));
    this.dirty = false;
  }

  compute(encoder) {
    if (this.dirty) this.upload();
    const n = this.sources.length;
    if (!n) return;
    // every frame: the medium breathes, so the beats change even when the sources do not
    const pass = encoder.beginComputePass({ label: 'source prep' });
    pass.setPipeline(this.prepPipe);
    pass.setBindGroup(0, this.prepBG);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
  }

  render(pass) {
    const n = this.sources.length;
    if (!n) return;
    const p = this.params;
    this.drawF[0] = this.view.dpr; this.drawF[1] = this.medium.R; this.drawI[2] = n;
    this.drawF[3] = p.on ? p.glow : 0; this.drawF[4] = p.markers;
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(3);
  }
}
