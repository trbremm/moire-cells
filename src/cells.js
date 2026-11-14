// The cells: a fixed number of them, all state on the GPU.
//
// State: one storage buffer of struct Cell (cell_common.wgsl, 48 bytes each), in a fixed order: index i is
// always the same cell, which keeps the drawing order stable.
// Drawing: instanced quads (cell_draw.wgsl), crisp discs with an outline and the cell's lattice as dots.
//
// Size: the cells' radius R is the reference's R (from the screen area, 5 to 9 CSS px), but smaller when
// that many cells would not fit in a round blob of about 0.8 x the dish height (so 10 000 or 50 000 cells
// get smaller). See `fitR`.
//
// URL: ?cells=N  number of cells (default 2000)

import { loadFieldShader, KIND } from './field.js';

export const CELL_URL = 'src/shaders/cell_common.wgsl';

// struct Cell in cell_common.wgsl: pos.xy, vel.xy, r, la, e1, e2, kind (u32), flags (u32), seed (u32), aux
export const CELL_FLOATS = 12;
export const CELL_BYTES = CELL_FLOATS * 4;
const ALIVE = 1;

export const DEFAULT_CELLS = 2000;
export const MAX_CELLS = 262144;

export class Cells {
  constructor(device, format, medium, count) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.count = Math.max(1, Math.min(MAX_CELLS, Math.round(count) || DEFAULT_CELLS));
    this.R = 9;
    this.view = null;
    // drawing (live-tunable: moire.cells.look)
    this.look = {
      fill: 0.13,     // disc fill, as a fraction of the cell colour over black
      fillA: 0.88,    // disc opacity (1 = background fully hidden under a cell)
      line: 0.78,     // outline brightness
      lineW: 1.1,     // outline width (CSS px)
      dots: 0.5,      // dot brightness (0 = no dots)
      dotR: 0.17,     // dot radius as a fraction of the dot spacing (reference: 2.7 / 16)
      period: 0.62,   // dot spacing per lattice period, in units of R (the medium's period is 0.62 R)
    };
  }

  static async create(device, format, medium, count) {
    const c = new Cells(device, format, medium, count);
    await c.init();
    return c;
  }

  async init() {
    const d = this.device;
    const drawMod = await loadFieldShader(d, 'src/shaders/cell_draw.wgsl', [CELL_URL]);
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'cell draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });

    const U = GPUBufferUsage;
    const n = this.count;
    this.cellBuf = d.createBuffer({ label: 'cells', size: n * CELL_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.drawU = d.createBuffer({ label: 'cell draw params', size: 48, usage: U.UNIFORM | U.COPY_DST });
    this.drawData = new Float32Array(12);
    this.drawBG = d.createBindGroup({
      layout: this.drawPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.drawU } },
        { binding: 1, resource: { buffer: this.cellBuf } },
      ],
    });
  }

  /** The cells' radius: the reference's R, or smaller if `count` cells would not fit in the dish. */
  fitR(view) {
    // a round blob packed at about 0.82 area fraction, diameter at most 0.8 x the shorter side
    const blob = 0.4 * Math.min(view.cssW, view.cssH);
    return Math.min(this.medium.R, blob * Math.sqrt(0.82 / this.count));
  }

  resize(view) {
    const first = !this.view;
    this.view = view;
    this.R = this.fitR(view);
    if (first) this.seed();
  }

  /** A fresh culture: all stem cells in a round blob at the dish centre, a little looser than packed. */
  seed() {
    const { cssW: W, cssH: H } = this.view;
    const n = this.count, R = this.R;
    const ab = new ArrayBuffer(n * CELL_BYTES);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    const spread = R * Math.sqrt(n / 0.7);   // blob radius at 0.7 area fraction
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 2 * Math.PI, dd = Math.sqrt(Math.random()) * spread;
      const o = i * CELL_FLOATS;
      f[o] = W / 2 + Math.cos(a) * dd; f[o + 1] = H / 2 + Math.sin(a) * dd;
      f[o + 2] = 0; f[o + 3] = 0;
      f[o + 4] = R;
      f[o + 5] = Math.random() * Math.PI / 3;          // lattice angle, as the reference's makeCell
      f[o + 6] = 0; f[o + 7] = 0;
      u[o + 8] = KIND.STEM; u[o + 9] = ALIVE; u[o + 10] = (Math.random() * 4294967296) >>> 0; f[o + 11] = 0;
    }
    this.device.queue.writeBuffer(this.cellBuf, 0, ab);
  }

  compute() {}

  render(pass) {
    const v = this.view, L = this.look, a = this.drawData;
    a[0] = v.cssW; a[1] = v.cssH; a[2] = v.dpr; a[3] = this.R;
    a[4] = L.fill; a[5] = L.fillA; a[6] = L.line; a[7] = L.lineW;
    a[8] = L.dots; a[9] = L.dotR; a[10] = L.period; a[11] = 0;
    this.device.queue.writeBuffer(this.drawU, 0, a);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(6, this.count);
  }
}
