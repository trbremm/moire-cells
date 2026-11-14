// The sources (nutrient and threat emitters) and the landscape they make, drawn over the background.
//
// Sources live on the CPU as a short list and are uploaded to a fixed-capacity GPU storage buffer
// (struct Emitter, see field_common.wgsl) whenever they change. Each frame:
//   compute: field_prep.wgsl turns every emitter into its beat (wavevectors and phases against the medium),
//   render:  landscape_draw.wgsl draws the landscape as crisp halftone dots (flat green / red, dot area grows
//            with the field strength) and the sources' markers over the background.
// The cells' field (step 4) is drawn in the same dot screen: the cells scatter it into a texture
// (src/cells.js, cell_field.wgsl) and the dots read it (set `cells` to the Cells layer; key K switches it).
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
    this.cells = null;          // the Cells layer, whose field texture the dots also read (set by main.js)
    this.params = {
      on: true,           // landscape on/off (L key); markers stay
      gain: 1.0,          // field strength gain (1 = the reference's glow quantity)
      markers: 1.0,       // marker gain
      // halftone screen
      pitch: 6,           // distance between neighbouring dot centres (CSS px)
      hex: true,          // triangular (hex) screen; false = square
      angle: 15,          // screen rotation (degrees); beats lie near 0 or 30 degrees, 15 keeps clear of both
      threshold: 0.12,    // strength below which there is no dot
      maxDot: 0.9,        // largest dot radius as a fraction of pitch/2 (1 = neighbours touch; capped at 1)
      base: 0,            // share of the strength that does not follow the beat (reference glow 0.3; 0 = dots
                          // only on the beat's blobs, cleaner and with more black between them)
      ringW: 1.5,         // marker ring stroke (CSS px)
      // inks (palette colours, 0..255) and the dots' brightness level (0..1)
      nutColour: [168, 240, 160],
      thrColour: [255, 112, 98],
      dotLevel: 0.55,
      // the cells' field (step 4): positive part only, in a pale warm ink (the stem colour, dimmer)
      cellField: true,    // drawn on/off (key K)
      cellGain: 1.0,      // strength gain of the cells' field
      cellColour: [241, 236, 223],
      cellLevel: 0.32,
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
    // premultiplied "over": flat dots stay flat on top of the background (alpha 0 still adds, for soft parts)
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'landscape draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });

    const U = GPUBufferUsage;
    this.emitBuf = d.createBuffer({ label: 'sources', size: MAX_SOURCES * EMITTER_BYTES, usage: U.STORAGE | U.COPY_DST });
    this.beatBuf = d.createBuffer({ label: 'source beats', size: MAX_SOURCES * BEAT_BYTES, usage: U.STORAGE });
    this.prepU = d.createBuffer({ label: 'source prep params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.drawU = d.createBuffer({ label: 'landscape draw params', size: 112, usage: U.UNIFORM | U.COPY_DST });
    const ab = new ArrayBuffer(MAX_SOURCES * EMITTER_BYTES);
    this.emitF = new Float32Array(ab);
    this.emitU = new Uint32Array(ab);
    this.drawAB = new ArrayBuffer(112);
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
    // the cells' field texture: a 1 x 1 stand-in until the cells have made theirs
    this.blankTex = d.createTexture({ label: 'no cell field', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.fieldSampler = d.createSampler({ label: 'cell field', magFilter: 'linear', minFilter: 'linear' });
    this.bgTex = null;
  }

  /** The draw bind group, rebuilt when the cells' field texture changes (it is remade on resize). */
  drawBindGroup() {
    const tex = (this.cells && this.cells.fieldTex) || this.blankTex;
    if (tex !== this.bgTex) {
      this.bgTex = tex;
      this.drawBG = this.device.createBindGroup({
        layout: this.drawPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.medium.buffer } },
          { binding: 1, resource: { buffer: this.drawU } },
          { binding: 2, resource: { buffer: this.beatBuf } },
          { binding: 3, resource: tex.createView() },
          { binding: 4, resource: this.fieldSampler },
        ],
      });
    }
    return this.drawBG;
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
    const n = this.sources.length, p = this.params;
    const C = this.cells, cellOn = !!(C && C.fieldTex && p.cellField && C.emitting());
    if (!n && !cellOn) return;
    const F = this.drawF;
    F[0] = this.view.dpr; F[1] = this.medium.R; this.drawI[2] = n;
    F[3] = p.on ? p.gain : 0; F[4] = p.markers;
    F[5] = Math.max(2, p.pitch); F[6] = p.angle * Math.PI / 180; F[7] = p.threshold;
    F[8] = Math.max(0, Math.min(1, p.maxDot)); this.drawI[9] = p.hex ? 1 : 0; F[10] = p.base; F[11] = p.ringW;
    for (let j = 0; j < 3; j++) { F[12 + j] = p.nutColour[j] / 255; F[16 + j] = p.thrColour[j] / 255; }
    F[15] = F[19] = p.dotLevel;
    for (let j = 0; j < 3; j++) F[20 + j] = p.cellColour[j] / 255;
    F[23] = p.cellLevel;
    F[24] = cellOn ? p.cellGain : 0; F[25] = C ? C.fieldScale : 1;
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBindGroup());
    pass.draw(3);
  }
}
