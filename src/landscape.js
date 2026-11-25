// The landscape: the cells' fields drawn as crisp halftone dots over the background (landscape_draw.wgsl).
//
// The cells scatter their fields into a texture (src/cells.js, cell_field.wgsl): field A (step 4) in r, field B
// (step 5) in g, the partner A' (step 8) in b; the dots read it at each dot centre, each field on its own screen in its
// own ink (keys K, J and ;).
// Step C3: the hand-made nutrient and threat sources (and their beat landscape and ring markers) are gone; the dish's
// substances are drawn by src/matter.js on the medium lattice. Key L hides or shows the whole landscape (the cells'
// field dots and the substances' dots together).

import { loadFieldShader } from './field.js';
import { computePipe, renderPipe, allPipes } from './gpu.js';   // step SP1: async pipelines
import { lod, LOD_URL } from './lod.js';   // step V1: LOD from band limits
import { pal } from './palette.js';
import { camera } from './camera.js';   // app: the view camera (drawing only)

const DRAW_BYTES = 192;          // struct DrawParams in landscape_draw.wgsl

export class Landscape {
  constructor(device, format, medium) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.view = null;
    this.cells = null;          // the Cells layer, whose field texture the dots read (set by main.js)
    this.params = {
      on: true,           // the whole landscape on/off (key L): the cells' field dots and (src/matter.js) the substances
      // halftone screen of field A
      pitch: 6,           // distance between neighbouring dot centres (CSS px)
      hex: true,          // triangular (hex) screen; false = square
      angle: 15,          // screen rotation (degrees); beats lie near 0 or 30 degrees, 15 keeps clear of both
      threshold: 0.12,    // strength below which there is no dot
      maxDot: 0.9,        // largest dot radius as a fraction of pitch/2 (1 = neighbours touch; capped at 1)
      // the cells' field (step 4): positive part only, in a pale warm ink (the undecided cells' colour, dimmer)
      cellField: false,   // drawn on/off (key K; step C6n: off in the clean view, the default)
      cellGain: 0.5,      // strength gain of the cells' field (1 left a grey haze in every gap once field B opened
                          // the culture up)
      cellLevel: 0.32,    // (its ink, and B's and A''s below: the palette's field.A, B, P, src/palette.js; step C6n: the
                          // level x the palette's levels.field / 0.32)
      // field B (step 5), from the same texture's G channel, on its own screen: open rings where positive, filled
      // dots where negative, in a faded print blue. B sums many cells (about 20 in a crowd), hence the low gain;
      // the high threshold leaves black where the culture is loose, so the rings mark the crowded parts
      fieldB: false,      // drawn on/off (key J; step C6n: off in the clean view)
      bGain: 0.03,        // strength gain
      bLevel: 0.5,
      bAngle: 45,         // screen rotation (degrees; A's screen is at 15)
      bPitch: 8,          // distance between B's rings (CSS px)
      bMaxDot: 0.9,       // largest ring radius as a fraction of bPitch/2
      bRing: 1.0,         // stroke of the open rings (CSS px; 0 = filled dots)
      bThresh: 0.35,      // strength below which there is no ring
      // the partner A' of the cells' field A (step 8), from the texture's B channel, on a third screen: filled dots on
      // its positive part, as A's, in a faded print yellow. Drawn only while a step 8 rule is on (keys Z , .)
      partner: false,     // drawn on/off (key ;; step C6n: off in the clean view)
      pGain: 0.5,         // strength gain (as cellGain)
      pLevel: 0.42,
      pAngle: 75,         // screen rotation (degrees; A's is 15, B's 45: the print angles)
      pPitch: 6,
      pThresh: 0.12,
    };
  }

  static async create(device, format, medium) {
    const l = new Landscape(device, format, medium);
    await l.init();
    return l;
  }

  async init() {
    const d = this.device;
    const drawMod = await loadFieldShader(d, 'src/shaders/landscape_draw.wgsl', [LOD_URL]);   // (step V1: + the shared fade)
    // premultiplied "over": flat dots stay flat on top of the background
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = await renderPipe(d, {   // (step SP1: async)
      label: 'landscape draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.drawU = d.createBuffer({ label: 'landscape draw params', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.drawAB = new ArrayBuffer(DRAW_BYTES);
    this.drawF = new Float32Array(this.drawAB);
    this.drawI = new Uint32Array(this.drawAB);
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
          { binding: 3, resource: tex.createView() },
          { binding: 4, resource: this.fieldSampler },
        ],
      });
    }
    return this.drawBG;
  }

  resize(view) { this.view = view; }

  compute() {}

  render(pass) {
    const p = this.params;
    if (!p.on) return;
    const C = this.cells, cellOn = !!(C && C.fieldTex && p.cellField && C.emitting());
    const bOn = !!(C && C.fieldTex && p.fieldB && C.fields.emit);
    const pOn = !!(C && C.fieldTex && p.partner && C.partnerDrawn());
    if (!cellOn && !bOn && !pOn) return;
    const F = this.drawF;
    F[0] = this.view.dpr * camera.z; F[1] = this.medium.R;
    F[3] = camera.x; F[4] = camera.y;   // app: the view camera
    F[5] = Math.max(2, p.pitch); F[6] = p.angle * Math.PI / 180; F[7] = p.threshold;
    F[8] = Math.max(0, Math.min(1, p.maxDot)); this.drawI[9] = p.hex ? 1 : 0;
    lod.write4(F, 12);   // step V1: the dots' grid limit
    const P = pal();
    for (let j = 0; j < 3; j++) F[20 + j] = P.field.A[j] / 255;
    F[23] = p.cellLevel * P.levels.field / 0.32;
    F[24] = cellOn ? p.cellGain : 0; F[25] = C ? C.fieldScale : 1;
    for (let j = 0; j < 3; j++) F[28 + j] = P.field.B[j] / 255;
    F[31] = p.bLevel;
    F[32] = bOn ? p.bGain : 0; F[33] = p.bAngle * Math.PI / 180; F[34] = Math.max(2, p.bPitch);
    F[35] = Math.max(0, Math.min(1, p.bMaxDot)); F[36] = p.bRing; F[37] = p.bThresh;
    for (let j = 0; j < 3; j++) F[40 + j] = P.field.P[j] / 255;
    F[43] = p.pLevel; F[44] = pOn ? p.pGain : 0; F[45] = p.pAngle * Math.PI / 180; F[46] = Math.max(2, p.pPitch); F[47] = p.pThresh;
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBindGroup());
    pass.draw(3);
  }
}
