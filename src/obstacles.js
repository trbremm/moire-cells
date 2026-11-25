// Step G0b, OBSTACLES (user 2026-11-17: "does it make sense to add obstacles ... walls, blocks, etc"; "maybe the microfluidics chip
// analogy is better"). README "Step G0b: obstacles".
//
// A SOLID MASK on the substrate grid, made from a list of SHAPES (kept as shapes: they are what a snapshot saves, what the squeeze scales,
// and what the drawing's smooth edges come from), each with a kind:
//   solid    stops cells, water and matter (a wall, a block, a pillar, a rock)
//   porous   stops cells only: water and atoms pass (a filter insert, a membrane with pores smaller than a cell)
//   erase    cuts a hole in whatever was painted before it (an opening, a crack in a rock)
// Shapes: STROKES (a pen line with a width: walls, channels), RECTANGLES (blocks, with rounded corners), CIRCLES (pillars). They are
// applied IN ORDER to two signed distance fields at the heat pixels' centres (CSS px, < 0 inside, clamped to +-CAP): sdA (what stops
// cells: solid and porous) and sdS (what stops water and matter: solid); the ROUND DISH (?dish=round) adds the outside of the dish's
// inscribed circle to both as a solid RIM (kind 3, never erased: matter at it is lost to the rim's sink as at the dish's square edge).
//
// What the mask does (each layer reads a block of the heat buffer, behind the water's: src/water.js blocks 5..9):
//   matter   (matter.wgsl spread) no flux across a face between a pixel and a SOLID pixel: exact, both pixels of an edge drop it. Matter
//            inside a solid pixel (painted over, dripped or excreted there) is PUSHED OUT, all of it, one pixel per substep toward the
//            nearest fluid pixel (a direction per solid pixel from a breadth-first search: whole counts, so the books stay exact)
//   cells    (cell_step.wgsl) a contact push away from the edge (sdA < the cell's radius: a spring like the dish's wall, stiffer), a
//            hard limit (the centre never closer than `hard` x its radius), and the honeycomb's corners flatten against the edge as
//            against a neighbour's wall; a cell deep inside (painted over) walks out along the nearest-free direction
//   water    the prescribed eddies and gyre fade smoothly to 0 near solids (water.wgsl, like the dish's window); the cells' stirred flow
//            is 0 on solid nodes (stir.wgsl); PERFUSION's through-flow becomes PRESSURE-DRIVEN: a stream function solved round the
//            obstacles (below), so the medium threads between pillars and leaves dead zones behind blocks and in side chambers
//
// THE THROUGH-FLOW (my choice: depth-averaged flow in a thin chip, Hele-Shaw / Darcy, not a full Stokes solve): u = -K grad p with
// div u = 0, so with u = curl psi: div((1/K) grad psi) = 0. psi = 0 on one side wall and Q (the flux the pump sets) on the other; the
// inlet and outlet edges are open (d psi / dn = 0: the water crosses them straight); each obstacle ISLAND is a stream line (psi constant)
// whose value is set by zero net pressure round it (its psi = the weighted mean of its neighbours: iterated with the rest). K falls
// smoothly to `kmin` within `slip` R of every wall (the slow layer a no-slip wall makes in a shallow channel), so the flow is fastest in the
// middle of every gap and still along the walls (Poiseuille-like in narrow channels, plug-like in wide ones). Low Reynolds: smooth, no
// eddies, no vortex streets. Solved on the CPU (red-black SOR, warm-started, a few ms per frame until it settles), uploaded to the GPU,
// scaled by the pump's flux: matter, cells and the drawing read it through the same psi block as before (transport exact, flux form).
//
// Light: no shadows (not built). Speed: one mask word, two fields and a solved psi; the shaders skip it all while nothing is painted.
// Switches: ?obstacles=0 (the mask ignored: as before), ?obsflow=0 (perfusion keeps the old prescribed profile); knobs in params.

import { loadShader } from './gpu.js';
import { LEDGER_WORDS } from './heat.js';
import { camera } from './camera.js';
import { pal } from './palette.js';
import { readGrid, readBuffer } from './snapshot.js';
import { CELL_FLOATS } from './cells.js';
import { lod, LOD_URL, LOD_LIMITS } from './lod.js';   // step V1: LOD from band limits (drawing only)

const DRAW_BYTES = 176;          // struct ODraw (obstacles_draw.wgsl)
const BLOCK = { mask: 5, sdA: 6, sdS: 7, thru: 8 };   // blocks of the water's (src/water.js: 10 in all)
export const OBS_BLOCKS = 10;
const KINDS = ['solid', 'porous', 'erase'];
export const OB_BITS = { ON: 1 };   // Fields.ob0.x (cell_common.wgsl)

/** The signed distance (CSS px, < 0 inside) from (x, y) to one shape. (Exported for the toy's terrain generators, src/terrain.js.) */
export function shapeSd(s, x, y) {
  if (s.type === 'circle') return Math.hypot(x - s.x, y - s.y) - s.r;
  if (s.type === 'rect') {
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2, r = Math.max(0, s.r || 0);
    const hx = Math.abs(s.x1 - s.x0) / 2 - r, hy = Math.abs(s.y1 - s.y0) / 2 - r;
    const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }
  // a stroke: the nearest of its segments (a capsule each), minus half its width
  const P = s.pts, h = s.w / 2;
  let best = Infinity;
  if (P.length === 1) return Math.hypot(x - P[0][0], y - P[0][1]) - h;
  for (let k = 0; k + 1 < P.length; k++) {
    const [ax, ay] = P[k], [bx, by] = P[k + 1];
    // (a cheap bound first: the segment's box)
    const lo = Math.min(ax, bx) - x, hi = x - Math.max(ax, bx), lo2 = Math.min(ay, by) - y, hi2 = y - Math.max(ay, by);
    const box = Math.max(lo, hi, lo2, hi2, 0);
    if (box >= best) continue;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best - h;
}
/** The shape's box [x0, y0, x1, y1] (CSS px). */
function shapeBox(s) {
  if (s.type === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
  if (s.type === 'rect') return [Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.max(s.x0, s.x1), Math.max(s.y0, s.y1)];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - s.w / 2, y0 - s.w / 2, x1 + s.w / 2, y1 + s.w / 2];
}
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Obstacles {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    this.heat = null; this.water = null; this.stir = null; this.cells = null; this.perfusion = null;   // set by main.js
    // live-tunable: moire.obstacles.params
    this.params = {
      on: true,          // the mask acts (?obstacles=0: ignored by everything, as before G0b)
      flow: true,        // perfusion's through-flow is solved round the obstacles (?obsflow=0: the old prescribed profile)
      push: 14,          // the cells' contact push from an edge (1 / s: a spring, as the dish's wall's 2 / s, stiffer)
      hard: 0.45,        // a cell's centre never comes closer to an edge than this x its radius
      flatten: true,     // the honeycomb's corners flatten against an edge (as against a neighbour's wall)
      cap: 8,            // R: the distance fields are kept to +- this (the push, the flow's slow layer and the eddies' fade reach less)
      slip: 3,           // R: the through-flow's slow layer along every wall (K from kmin at the wall to 1 at this distance)
      kmin: 0.04,        // the permeability at a wall (x the open water's)
      fade: 4,           // R: the prescribed eddies and gyre fade to 0 within this of a solid
      solveMs: 4,        // ms per frame the through-flow's solver may take until it settles
      tol: 2e-5,         // ... settled when no psi moves more than this (x the pump's flux) in a sweep
      tube: 0.9,         // the edge's tube width (CSS px)
      glow: 0.85,        // the edge's brightness
      // the painting tool (src/app.js): what a drag or tap paints
      shape: 'wall',     // wall | block | pillar | erase
      kind: 'solid',     // solid | porous
      width: 2,          // R: a wall's width (and the eraser's)
      pillar: 2.5,       // R: a pillar's radius
    };
    this.shapes = [];       // in order
    this.round = false;     // the round dish (the outside of the inscribed circle is the rim)
    this.version = 0;       // bumped at every change of the mask
    this.gridVersion = -1;  // the heat grid's version the arrays were made for
    this.hw = 0; this.hh = 0; this.n = 0; this.px = 1;
    this.dirty = false;     // the GPU copy is behind
    this.solidShare = 0; this.porousShare = 0;
    this.flowS = null;      // the through-flow's solver state
    this.prev = null;       // the tool's preview (drawing only)
    this.census = null;
  }

  static async create(device, format) {
    const o = new Obstacles(device, format);
    await o.init();
    return o;
  }

  async init() {
    const d = this.device;
    const mod = await loadShader(d, 'src/shaders/obstacles_draw.wgsl', { prefixes: [{ name: LOD_URL, text: await (await fetch(LOD_URL, { cache: 'no-cache' })).text() }] });   // (step V1: + the shared fade)
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'obstacles draw', layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.dBuf = d.createBuffer({ label: 'obstacles draw params', size: DRAW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dAB = new ArrayBuffer(DRAW_BYTES);
  }

  // ---------- state ----------
  get R() { return (this.heat && this.heat.R) || (this.cells && this.cells.R) || 6; }
  get W() { return this.view ? this.view.cssW : 0; }
  get H() { return this.view ? this.view.cssH : 0; }
  /** Something is painted (or the dish is round), and the mask acts. */
  get active() { return !!(this.params.on && (this.shapes.length || this.round)); }
  get CAP() { return Math.max(2, this.params.cap) * this.R; }
  /** Word offsets in the heat buffer of the mask's blocks. */
  off(name) { return this.heat.waterOffset + BLOCK[name] * this.heat.n; }

  resize(view) { this.view = view; }

  /** The signed distances at (x, y) (CSS px), worked out from the shapes: { a: what stops cells, s: what stops water }. */
  sdAt(x, y) {
    const C = this.CAP;
    let a = C, s = C;
    for (const sh of this.shapes) {
      const d = shapeSd(sh, x, y);
      if (sh.kind === 'erase') { a = Math.max(a, -d); s = Math.max(s, -d); }
      else if (sh.kind === 'porous') { a = Math.min(a, d); s = Math.max(s, -d); }
      else { a = Math.min(a, d); s = Math.min(s, d); }
    }
    const r = this.rimD(x, y);
    return { a: Math.min(a, r), s: Math.min(s, r) };
  }
  /** Whether a cell of radius r at (x, y) would sit inside an obstacle (seeding, the add-cell tool). */
  blocked(x, y, r = 0) {
    if (!this.active) return false;
    return this.sdAt(x, y).a < r;
  }
  rimD(x, y) {
    if (!this.round || !this.W) return Infinity;
    const cx = this.W / 2, cy = this.H / 2, rD = Math.min(this.W, this.H) / 2 - this.R;
    return rD - Math.hypot(x - cx, y - cy);
  }

  // ---------- painting (the tool, the console, the presets) ----------
  add(shape) {
    const s = { ...shape, kind: KINDS.includes(shape.kind) ? shape.kind : 'solid' };
    s.box = shapeBox(s);
    this.shapes.push(s);
    this.changed(s.box);
    return s;
  }
  /** A wall from (x1, y1) to (x2, y2), w wide (CSS px). */
  line(x1, y1, x2, y2, w, kind = 'solid') { return this.add({ type: 'stroke', pts: [[x1, y1], [x2, y2]], w: Math.max(0.5, w || 2 * this.R), kind }); }
  /** A polyline wall through the points [[x, y], ...]. */
  path(pts, w, kind = 'solid') { return this.add({ type: 'stroke', pts: pts.map((p) => [p[0], p[1]]), w: Math.max(0.5, w || 2 * this.R), kind }); }
  /** A block from (x, y), w x h (CSS px), corners rounded by r. */
  rect(x, y, w, h, kind = 'solid', r = 0) { return this.add({ type: 'rect', x0: x, y0: y, x1: x + w, y1: y + h, r: Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)), kind }); }
  /** A round pillar at (x, y), radius r (CSS px). */
  circle(x, y, r, kind = 'solid') { return this.add({ type: 'circle', x, y, r: Math.max(0.5, r), kind }); }
  /** An array of round pillars of radius r filling the box (x0, y0)..(x1, y1), centres `gap` apart (CSS px), every other row shifted. */
  pillars(x0, y0, x1, y1, r, gap, kind = 'solid') {
    const out = [], dy = gap * Math.sqrt(3) / 2;
    let row = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1e-6; y += dy, row++) {
      for (let x = Math.min(x0, x1) + (row & 1 ? gap / 2 : 0); x <= Math.max(x0, x1) + 1e-6; x += gap) out.push(this.circle(x, y, r, kind));
    }
    return out.length;
  }
  /** Cut a line (an opening, a crack) w wide. */
  erase(x1, y1, x2, y2, w) { return this.line(x1, y1, x2, y2, w, 'erase'); }
  /**
   * Replace every shape at once (the toy's terrain generators, src/terrain.js): one raster of the whole grid instead of one per shape;
   * round: the round dish on or off (unchanged when not given).
   */
  setShapes(list, round) {
    this.shapes = list.map((sh) => { const s = { ...sh, kind: KINDS.includes(sh.kind) ? sh.kind : 'solid' }; s.box = shapeBox(s); return s; });
    if (round != null) this.round = !!round;
    this.live = null; this.prev = null;
    this.changed(null);
    return this.shapes.length;
  }
  /** Remove every shape (the round dish stays as it is). */
  clear() {
    this.shapes = [];
    this.changed(null);
    return 'obstacles cleared';
  }
  /** Remove the last shape painted. */
  undo() {
    const s = this.shapes.pop();
    if (!s) return 'nothing to undo';
    this.changed(s.box);
    return `removed the last ${s.kind === 'erase' ? 'eraser stroke' : s.type === 'stroke' ? 'wall' : s.type === 'rect' ? 'block' : 'pillar'}`;
  }
  /** Point and patch springs that sit inside an obstacle (or outside a round dish) moved toward the dish's centre until free (a scene's). */
  freeSprings(springs) {
    if (!this.active || !this.W) return 0;
    const R = this.R, cx = this.W / 2, cy = this.H / 2;
    let moved = 0;
    for (const s of springs) {
      if (s.shape && s.shape.type === 'line') continue;
      if (this.sdAt(s.x, s.y).s >= R) continue;
      const d = Math.hypot(cx - s.x, cy - s.y) || 1, ux = (cx - s.x) / d, uy = (cy - s.y) / d;
      for (let k = 1; k * R < d; k++) {
        const x = s.x + ux * k * R, y = s.y + uy * k * R;
        if (this.sdAt(x, y).s >= 1.5 * R) { s.x = x; s.y = y; moved++; break; }
      }
    }
    return moved;
  }

  /** The round dish on or off. */
  setRound(on) {
    this.round = !!on;
    this.changed(null);
    return this.round ? 'round dish: the outside of the circle is the rim' : 'square dish';
  }

  // a stroke being drawn (the tool): its points grow as the pointer moves
  beginStroke(x, y, w, kind) { this.live = this.add({ type: 'stroke', pts: [[x, y]], w, kind }); return this.live; }
  extendStroke(x, y) {
    const s = this.live;
    if (!s) return;
    const [lx, ly] = s.pts[s.pts.length - 1];
    if (Math.hypot(x - lx, y - ly) < 0.4 * this.R) return;
    s.pts.push([x, y]);
    const b = [Math.min(lx, x) - s.w / 2, Math.min(ly, y) - s.w / 2, Math.max(lx, x) + s.w / 2, Math.max(ly, y) + s.w / 2];
    s.box = [Math.min(s.box[0], b[0]), Math.min(s.box[1], b[1]), Math.max(s.box[2], b[2]), Math.max(s.box[3], b[3])];
    this.changed(b);
  }
  endStroke() { this.live = null; }

  /** The shapes changed inside box (null: everywhere): redo the fields there, the mask, the GPU copy, the flow. */
  changed(box) {
    this.version++;
    if (this.n && this.gridVersion === (this.heat && this.heat.version)) this.raster(box);
  }

  // ---------- the fields on the grid ----------
  /** (Re)make the arrays for the heat grid now in use. */
  ensureGrid() {
    const H = this.heat;
    if (!H || !H.buffer || !H.n) return false;
    if (this.gridVersion === H.version && this.n === H.n) return true;
    this.gridVersion = H.version;
    this.hw = H.hw; this.hh = H.hh; this.n = H.n; this.px = H.px;
    const n = this.n;
    this.sdA = new Float32Array(n); this.sdS = new Float32Array(n);
    this.kind = new Uint8Array(n); this.word = new Uint32Array(n);
    this.flowS = null;
    this.raster(null);
    return true;
  }

  /** Recompute the fields in a box (CSS px; null: the whole grid), then the kinds, the push-out directions and the flow. */
  raster(box) {
    if (!this.n) return;
    const C = this.CAP, px = this.px, hw = this.hw, hh = this.hh;
    let i0 = 0, j0 = 0, i1 = hw - 1, j1 = hh - 1;
    if (box) {
      i0 = Math.max(0, Math.floor((box[0] - C) / px)); i1 = Math.min(hw - 1, Math.ceil((box[2] + C) / px));
      j0 = Math.max(0, Math.floor((box[1] - C) / px)); j1 = Math.min(hh - 1, Math.ceil((box[3] + C) / px));
    }
    if (i1 >= i0 && j1 >= j0) {
      const X0 = i0 * px, X1 = (i1 + 1) * px, Y0 = j0 * px, Y1 = (j1 + 1) * px;
      const list = this.shapes.filter((s) => s.box[0] - C <= X1 && s.box[2] + C >= X0 && s.box[1] - C <= Y1 && s.box[3] + C >= Y0);
      for (let j = j0; j <= j1; j++) {
        const y = (j + 0.5) * px;
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * px;
          let a = C, s = C;
          for (const sh of list) {
            const b = sh.box;
            if (x < b[0] - C || x > b[2] + C || y < b[1] - C || y > b[3] + C) continue;
            const d = shapeSd(sh, x, y);
            if (sh.kind === 'erase') { a = Math.max(a, -d); s = Math.max(s, -d); }
            else if (sh.kind === 'porous') { a = Math.min(a, d); s = Math.max(s, -d); }
            else { a = Math.min(a, d); s = Math.min(s, d); }
            if (a < -C) a = -C; else if (a > C) a = C;
            if (s < -C) s = -C; else if (s > C) s = C;
          }
          const r = this.rimD(x, y);
          if (r < a) a = Math.max(-C, r);
          if (r < s) s = Math.max(-C, r);
          const k = j * hw + i;
          this.sdA[k] = a; this.sdS[k] = s;
          this.kind[k] = r < 0 ? 3 : s < 0 ? 1 : a < 0 ? 2 : 0;
        }
      }
    }
    this.directions();
    this.dirty = true;
    this.flowDirty = true;
  }

  /**
   * Each blocked pixel's way out: the step toward the nearest free pixel (breadth-first from the free ones), for the matter (water-solid:
   * kinds 1 and 3, toward water) and for the cells (kinds 1, 2, 3, toward a free pixel). Mask word: kind (bits 0-1), the matter's way
   * (2-4: 0 none, 1 left, 2 right, 3 up, 4 down), the cells' way (5-7).
   */
  directions() {
    const n = this.n, hw = this.hw, K = this.kind, W = this.word;
    if (!this.dist) this.dist = new Int32Array(n);
    if (!this.queue || this.queue.length < n) this.queue = new Int32Array(n);
    const dist = this.dist.length === n ? this.dist : (this.dist = new Int32Array(n));
    for (let k = 0; k < n; k++) W[k] = K[k];
    let solid = 0, porous = 0;
    for (let k = 0; k < n; k++) { if (K[k] === 1 || K[k] === 3) solid++; else if (K[k] === 2) porous++; }
    this.solidShare = solid / n; this.porousShare = porous / n;
    const bfs = (blocked, shift) => {
      const q = this.queue;
      let head = 0, tail = 0;
      for (let k = 0; k < n; k++) { if (blocked(K[k])) dist[k] = -1; else { dist[k] = 0; q[tail++] = k; } }
      while (head < tail) {
        const p = q[head++], x = p % hw;
        // neighbours of p, each told the way back to p
        if (x > 0 && dist[p - 1] < 0) { dist[p - 1] = dist[p] + 1; W[p - 1] |= 2 << shift; q[tail++] = p - 1; }        // p is its right
        if (x + 1 < hw && dist[p + 1] < 0) { dist[p + 1] = dist[p] + 1; W[p + 1] |= 1 << shift; q[tail++] = p + 1; }   // p is its left
        if (p - hw >= 0 && dist[p - hw] < 0) { dist[p - hw] = dist[p] + 1; W[p - hw] |= 4 << shift; q[tail++] = p - hw; }  // p is below it
        if (p + hw < n && dist[p + hw] < 0) { dist[p + hw] = dist[p] + 1; W[p + hw] |= 3 << shift; q[tail++] = p + hw; }   // p is above it
      }
    };
    if (solid) bfs((k) => k === 1 || k === 3, 2);
    if (solid || porous) bfs((k) => k !== 0, 5);
  }

  /** The stir grid's mask (src/stir.js): a node is solid when the heat corner under it touches a water-solid pixel. */
  stirMask(sw, sh, sc) {
    const out = new Uint32Array(sw * sh);
    if (!this.active || !this.n) return out;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) out[y * sw + x] = this.cornerSolid(x * sc, y * sc) ? 1 : 0;
    }
    return out;
  }
  cornerSolid(x, y) {
    const hw = this.hw, hh = this.hh, K = this.kind;
    for (let j = y - 1; j <= y; j++) {
      if (j < 0 || j >= hh) continue;
      for (let i = x - 1; i <= x; i++) {
        if (i < 0 || i >= hw) continue;
        if (K[j * hw + i] & 1) return true;
      }
    }
    return false;
  }

  // ---------- the through-flow (perfusion), pressure-driven round the obstacles ----------
  /** Whether the solved through-flow is wanted now. */
  get flowWanted() { return !!(this.active && this.params.flow && this.perfusion && this.perfusion.flowing && this.solidShare > 0); }
  get flowAxis() { const d = this.perfusion ? this.perfusion.params.dir : 'right'; return d === 'down' || d === 'up' ? 'y' : 'x'; }

  /** Build (or rebuild, warm) the solver for the mask now. */
  setupFlow() {
    const hw = this.hw, hh = this.hh, W1 = hw + 1, H1 = hh + 1, N = W1 * H1, K = this.kind, axis = this.flowAxis, P = this.params;
    const R = this.R, slip = Math.max(0.1, P.slip) * R, kmin = Math.max(1e-3, Math.min(1, P.kmin)), px = this.px;
    const old = this.flowS && this.flowS.psi && this.flowS.W1 === W1 && this.flowS.H1 === H1 && this.flowS.axis === axis ? this.flowS : null;   // (a blocked one has none)
    const PAD = W1 + 1;
    const F = { W1, H1, N, axis, PAD, blocked: false, converged: false, sweeps: 0, version: this.version };
    // the resistance 1/K of each water pixel (0 for a solid one)
    const res = new Float32Array(hw * hh);
    const Hd = hh * px, Wd = hw * px;
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < hw; i++) {
        const k = j * hw + i;
        if (K[k] & 1) continue;
        const x = (i + 0.5) * px, y = (j + 0.5) * px;
        const wall = axis === 'x' ? Math.min(y, Hd - y) : Math.min(x, Wd - x);
        const d = Math.min(this.sdS[k], wall);
        const t = Math.max(0, Math.min(1, d / slip));
        res[k] = 1 / (kmin + (1 - kmin) * t * (2 - t));
      }
    }
    const pxl = (i, j) => (i < 0 || j < 0 || i >= hw || j >= hh ? -1 : (K[j * hw + i] & 1 ? -1 : res[j * hw + i]));
    // the nodes: solid corners grouped into islands; the side walls fixed (psi 0 and 1)
    const solidC = new Uint8Array(N);
    for (let y = 0; y < H1; y++) for (let x = 0; x < W1; x++) solidC[y * W1 + x] = this.cornerSolid(x, y) ? 1 : 0;
    const onLow = (x, y) => (axis === 'x' ? y === 0 : x === 0);
    const onHigh = (x, y) => (axis === 'x' ? y === hh : x === hw);
    const comp = new Int32Array(N).fill(-1);
    const comps = [];
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!solidC[s] || comp[s] >= 0) continue;
      const id = comps.length, c = { low: false, high: false, nodes: 0 };
      comps.push(c);
      let h = 0, t = 0;
      q[t++] = s; comp[s] = id;
      while (h < t) {
        const p = q[h++], x = p % W1, y = (p - x) / W1;
        c.nodes++;
        if (onLow(x, y)) c.low = true;
        if (onHigh(x, y)) c.high = true;
        if (x > 0 && solidC[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; q[t++] = p - 1; }
        if (x + 1 < W1 && solidC[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; q[t++] = p + 1; }
        if (y > 0 && solidC[p - W1] && comp[p - W1] < 0) { comp[p - W1] = id; q[t++] = p - W1; }
        if (y + 1 < H1 && solidC[p + W1] && comp[p + W1] < 0) { comp[p + W1] = id; q[t++] = p + W1; }
      }
    }
    if (comps.some((c) => c.low && c.high)) { F.blocked = true; this.flowS = F; return F; }
    // node types: 0 unknown, 1 fixed, 2 island (free); fixed value
    const type = new Uint8Array(N), fixedV = new Float32Array(N), isl = new Int32Array(N).fill(-1);
    const free = [];
    comps.forEach((c, id) => { c.free = !(c.low || c.high) ? free.push(id) - 1 : -1; });
    for (let y = 0; y < H1; y++) {
      for (let x = 0; x < W1; x++) {
        const p = y * W1 + x, c = comp[p] >= 0 ? comps[comp[p]] : null;
        if (onLow(x, y) || (c && c.low)) { type[p] = 1; fixedV[p] = 0; }
        else if (onHigh(x, y) || (c && c.high)) { type[p] = 1; fixedV[p] = 1; }
        else if (c) { type[p] = 2; isl[p] = c.free; }
      }
    }
    // the links' weights: a horizontal link (x, y)-(x+1, y) is the pixel edge between pixels (x, y-1) and (x, y), a vertical one
    // (x, y)-(x, y+1) between (x-1, y) and (x, y): the mean resistance of its water pixels (0: none)
    const wE = new Float32Array(N), wS = new Float32Array(N);
    const mean2 = (a, b) => (a < 0 && b < 0 ? 0 : a < 0 ? b : b < 0 ? a : 0.5 * (a + b));
    for (let y = 0; y < H1; y++) {
      for (let x = 0; x < W1; x++) {
        const p = y * W1 + x;
        if (x < hw) wE[p] = mean2(pxl(x, y - 1), pxl(x, y));
        if (y < hh) wS[p] = mean2(pxl(x - 1, y), pxl(x, y));
        // (links inside one island or between fixed nodes carry nothing worth solving)
        if (x < hw && type[p] && type[p] === type[p + 1] && (type[p] === 1 || isl[p] === isl[p + 1])) wE[p] = 0;
        if (y < hh && type[p] && type[p] === type[p + W1] && (type[p] === 1 || isl[p] === isl[p + W1])) wS[p] = 0;
      }
    }
    // the unknowns, by parity (red-black), with their weights normalised
    const lists = [[], []];
    for (let p = 0; p < N; p++) {
      if (type[p] !== 0) continue;
      const x = p % W1, y = (p - x) / W1;
      const s = (x > 0 ? wE[p - 1] : 0) + (x < hw ? wE[p] : 0) + (y > 0 ? wS[p - W1] : 0) + (y < hh ? wS[p] : 0);
      if (s > 0) lists[(x + y) & 1].push(p);   // (a node with no link would only be pulled to 0)
    }
    F.idx = lists.map((l) => Int32Array.from(l));
    F.wt = F.idx.map((ix) => {
      const w = new Float32Array(4 * ix.length);
      for (let k = 0; k < ix.length; k++) {
        const p = ix[k], x = p % W1, y = (p - x) / W1;
        const a = x > 0 ? wE[p - 1] : 0, b = x < hw ? wE[p] : 0, c = y > 0 ? wS[p - W1] : 0, d = y < hh ? wS[p] : 0, s = a + b + c + d;
        if (s > 0) { w[4 * k] = a / s; w[4 * k + 1] = b / s; w[4 * k + 2] = c / s; w[4 * k + 3] = d / s; }
      }
      return w;
    });
    // the free islands: their links out (neighbour, weight)
    const iL = free.map(() => []);
    for (let p = 0; p < N; p++) {
      const x = p % W1, y = (p - x) / W1;
      const link = (qn, w) => {
        if (!(w > 0)) return;
        if (isl[p] >= 0 && isl[qn] !== isl[p]) iL[isl[p]].push(qn, w);
        if (isl[qn] >= 0 && isl[qn] !== isl[p]) iL[isl[qn]].push(p, w);
      };
      if (x < hw) link(p + 1, wE[p]);
      if (y < hh) link(p + W1, wS[p]);
    }
    F.isl = iL.map((l) => { const a = new Float32Array(l.length); for (let k = 0; k < l.length; k += 2) { a[k] = l[k]; a[k + 1] = l[k + 1]; } return a; });
    F.islNodes = free.map(() => []);
    for (let p = 0; p < N; p++) if (isl[p] >= 0) F.islNodes[isl[p]].push(p);
    F.islNodes = F.islNodes.map((l) => Int32Array.from(l));
    // psi: warm from the last solve, else the channel's profile; fixed nodes set
    const psi = new Float32Array(N + 2 * PAD);
    for (let p = 0; p < N; p++) {
      const x = p % W1, y = (p - x) / W1, s = axis === 'x' ? y / hh : x / hw;
      psi[PAD + p] = type[p] === 1 ? fixedV[p] : old ? old.psi[PAD + p] : s;
    }
    F.psi = psi;
    F.islands = free.length;
    F.unknowns = F.idx[0].length + F.idx[1].length;
    F.omega = Math.min(1.97, 2 / (1 + Math.sin(Math.PI / Math.max(W1, H1))));
    F.warm = !!old;
    this.flowS = F;
    this.updateIslands(F);
    return F;
  }

  updateIslands(F) {
    const psi = F.psi, PAD = F.PAD;
    let md = 0;
    for (let k = 0; k < F.isl.length; k++) {
      const L = F.isl[k];
      let s = 0, w = 0;
      for (let m = 0; m < L.length; m += 2) { s += L[m + 1] * psi[PAD + L[m]]; w += L[m + 1]; }
      if (!(w > 0)) continue;
      const v = s / w, nodes = F.islNodes[k];
      md = Math.max(md, Math.abs(v - psi[PAD + nodes[0]]));
      for (let m = 0; m < nodes.length; m++) psi[PAD + nodes[m]] = v;
    }
    return md;
  }

  /** Sweeps for up to ms milliseconds (or until settled); true when it settled. */
  solveFor(ms) {
    const F = this.flowS;
    if (!F || F.blocked) return true;
    const t0 = performance.now(), psi = F.psi, W1 = F.W1, om = F.omega, PAD = F.PAD, tol = Math.max(1e-7, this.params.tol);
    while (performance.now() - t0 < ms) {
      let md = 0;
      for (let r = 0; r < 2; r++) {
        const ix = F.idx[r], w = F.wt[r];
        for (let k = 0; k < ix.length; k++) {
          const p = PAD + ix[k], o = 4 * k;
          const v = w[o] * psi[p - 1] + w[o + 1] * psi[p + 1] + w[o + 2] * psi[p - W1] + w[o + 3] * psi[p + W1];
          const d = v - psi[p];
          psi[p] += om * d;
          if (d > md) md = d; else if (-d > md) md = -d;
        }
      }
      md = Math.max(md, this.updateIslands(F));
      F.sweeps++;
      F.last = md;
      if (md < tol) { F.converged = true; return true; }
    }
    return false;
  }

  // ---------- the frame ----------
  /** Before the water's pass: the arrays for the grid now in use, the GPU copy, a little more of the through-flow. */
  compute() {
    if (!this.ensureGrid()) return;
    const H = this.heat, q = this.device.queue;
    if (this.dirty && this.active) {
      q.writeBuffer(H.buffer, this.off('mask') * 4, this.word);
      q.writeBuffer(H.buffer, this.off('sdA') * 4, this.sdA);
      q.writeBuffer(H.buffer, this.off('sdS') * 4, this.sdS);
      this.dirty = false;
      this.flowUploaded = false;
    }
    if (!this.active) { this.dirty = true; return; }
    // the through-flow
    if (this.flowWanted) {
      const ax = this.flowAxis;
      if (this.flowDirty || !this.flowS || this.flowS.axis !== ax) {
        this.flowDirty = false;
        const F = this.setupFlow();
        if (!F.blocked) this.solveFor(F.warm ? this.params.solveMs : 400);   // (a first solve may take a moment)
        this.flowUploaded = false;
        this.flowNext = 0;
      } else if (!this.flowS.converged && !this.flowS.blocked) {
        this.solveFor(this.params.solveMs);
      }
      const F = this.flowS, now = performance.now();
      if (!F.blocked && (!this.flowUploaded || (!F.converged && now > (this.flowNext || 0)) || (F.converged && !F.sentDone))) {
        q.writeBuffer(H.buffer, this.off('thru') * 4, F.psi, F.PAD, F.N);
        this.flowUploaded = true;
        this.flowNext = now + 200;
        F.sentDone = F.converged;
      }
    }
  }

  /** The matter's words (struct MatterP obs from word o): the mask block in its grid view (0: none). */
  writeMatter(u, f, o) {
    const on = this.active && this.n && this.gridVersion === this.heat.version && !this.dirty;
    u[o] = on ? this.off('mask') - LEDGER_WORDS : 0; u[o + 1] = 0; u[o + 2] = 0; u[o + 3] = 0;
  }
  /** The cells' words (struct Fields ob0 from word o): bits, sdA's offset in hb, the push, the hard limit. */
  writeFields(u, f, o) {
    const on = this.active && this.n && this.heat && this.gridVersion === this.heat.version && !this.dirty;
    u[o] = on ? OB_BITS.ON | (this.params.flatten ? 2 : 0) : 0;
    u[o + 1] = on ? this.off('sdA') : 0;
    f[o + 2] = Math.max(0, this.params.push); f[o + 3] = Math.max(0, Math.min(0.95, this.params.hard));
  }
  /**
   * The water's words (struct WaterP obs, obs2 from word o): the mask's and sdS's offsets (0: none), the solved through-flow's (0: the
   * prescribed profile), flags (bit 0: the eddies fade near solids, bit 1: the through-flow is blocked); the fade's width (CSS px).
   */
  writeWater(u, f, o) {
    const on = this.active && this.n && this.heat && this.gridVersion === this.heat.version && !this.dirty;
    const F = this.flowS, solved = on && this.flowWanted && F && !F.blocked && this.flowUploaded;
    const blocked = on && this.flowWanted && F && F.blocked;
    u[o] = on ? this.off('mask') : 0; u[o + 1] = on ? this.off('sdS') : 0; u[o + 2] = solved ? this.off('thru') : 0;
    u[o + 3] = (on ? 1 : 0) | (blocked ? 2 : 0);
    f[o + 4] = 0; f[o + 5] = Math.max(0.5, this.params.fade) * this.R; f[o + 6] = 0; f[o + 7] = 0;
  }

  /** (As a layer it only computes: it comes first, so every pass reads the mask; `drawLayer` draws it, after the water.) */
  render() {}
  get drawLayer() {
    if (!this._dl) this._dl = { resize: () => {}, compute: () => {}, render: (pass, frame) => this.draw(pass, frame) };
    return this._dl;
  }

  /** Drawn under the cells (src/neon.js: the light buffer), in every look. */
  draw(pass, frame = {}) {
    const H = this.heat;
    const on = this.active && this.n && H && H.buffer && this.gridVersion === H.version && !this.dirty;
    if (!on && !this.prev) return;
    if (!this.bg || this.bgHeat !== H.buffer) {
      this.bgHeat = H.buffer;
      this.bg = this.device.createBindGroup({
        label: 'obstacles draw', layout: this.drawPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.dBuf } }, { binding: 1, resource: { buffer: H.buffer } }],
      });
    }
    const harm = !!(frame.look && frame.look.harmonic), neon = !!(frame.look && frame.look.neon);
    const u = new Uint32Array(this.dAB), f = new Float32Array(this.dAB);
    u[0] = this.hw; u[1] = this.hh; u[2] = on ? this.off('sdA') : 0; u[3] = on ? this.off('sdS') : 0;
    f[4] = this.px; f[5] = this.view.dpr * camera.z; f[6] = harm ? 1 : 0; f[7] = Math.max(0.3, this.params.tube) * (harm ? 0.8 : 1);
    f.set(camera.vec(), 8);
    const g = Math.max(0, this.params.glow);
    // inks: the edge ice-blue (neon) / a pale steel (flat) / a faint grey (harmonic); the porous edge pale aqua
    const ink = harm ? [0.42, 0.47, 0.5, 0.55 * g] : neon ? [0.55, 0.85, 1.0, g] : [0.62, 0.74, 0.82, g];
    const pink = harm ? [0.35, 0.45, 0.42, 0.45 * g] : [0.5, 0.95, 0.85, 0.8 * g];
    const fill = harm ? [0.006, 0.008, 0.01, 0.94] : [0.03, 0.045, 0.065, 0.9];
    const pfill = harm ? [0.02, 0.03, 0.03, 0.55] : [0.04, 0.09, 0.09, 0.5];
    f.set(ink, 12); f.set(pink, 16); f.set(fill, 20); f.set(pfill, 24);
    const P = this.prev;
    f.fill(0, 28, 40);
    if (P) {
      f[28] = P.type === 'rect' ? 1 : P.type === 'circle' ? 2 : 3;
      if (P.type === 'rect') { f[32] = Math.min(P.x0, P.x1); f[33] = Math.min(P.y0, P.y1); f[34] = Math.max(P.x0, P.x1); f[35] = Math.max(P.y0, P.y1); }
      else if (P.type === 'circle') { f[32] = P.x; f[33] = P.y; f[34] = P.r; }
      else { f[32] = P.x0; f[33] = P.y0; f[34] = P.x1; f[35] = P.y1; f[36] = P.w / 2; }
    }
    f[40] = this.W; f[41] = this.H; f[42] = lod.on ? Math.max(0.01, lod.params.spread) : 0; f[43] = LOD_LIMITS.grid;   // (step V1: z the fade's spread, 0 = off; w the grid limit)
    this.device.queue.writeBuffer(this.dBuf, 0, this.dAB);
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.bg);
    pass.draw(3);
  }

  // ---------- snapshots, the squeeze ----------
  save() { return { round: this.round, shapes: this.shapes.map((s) => { const c = clone(s); delete c.box; return c; }) }; }
  load(S) {
    this.shapes = [];
    this.round = !!(S && S.round);
    for (const s of (S && S.shapes) || []) { const c = clone(s); c.box = shapeBox(c); this.shapes.push(c); }
    this.flowS = null;
    this.changed(null);
  }
  /** The squeeze (src/squeeze.js): every shape moved and sized with the sample, about the centres. */
  static scaleSaved(S, f, cx, cy, ncx, ncy) {
    if (!S) return S;
    const X = (x) => ncx + (x - cx) * f, Y = (y) => ncy + (y - cy) * f;
    for (const s of S.shapes || []) {
      if (s.type === 'circle') { s.x = X(s.x); s.y = Y(s.y); s.r *= f; }
      else if (s.type === 'rect') { s.x0 = X(s.x0); s.x1 = X(s.x1); s.y0 = Y(s.y0); s.y1 = Y(s.y1); s.r = (s.r || 0) * f; }
      else { s.pts = s.pts.map(([x, y]) => [X(x), Y(y)]); s.w *= f; }
    }
    return S;
  }

  // ---------- measures ----------
  /**
   * For the experiments (moire.obstacles.measure()): the water's floor in zones by the distance to the nearest solid (or porous) edge,
   * with the matter (all counts per pixel, and the fuels', the trace's) and the cells per R^2 in each, relative to the open water's; the
   * dead zones (where the solved through-flow is slower than a tenth of its mean) the same way; and how many cells sit in the crevices.
   */
  async measure(M = window.moire) {
    if (!this.active || !this.n) return null;
    const n = this.n, hw = this.hw, px = this.px, R = this.R;
    const g = await readGrid(M);
    const SUB = M.matter.SUBSTANCES, NC = SUB.length;
    const C = M.cells, cnt = C.count;
    const cb = new Float32Array(await readBuffer(this.device, C.cellBuf, 0, cnt * CELL_FLOATS * 4)), cu = new Uint32Array(cb.buffer);
    const zones = [['edge0-2R', 0, 2], ['edge2-6R', 2, 6], ['open', 6, 1e9]];
    const zone = (k) => { const d = this.sdA[k] / R; if (d < 0) return -1; for (let z = 0; z < zones.length; z++) if (d >= zones[z][1] && d < zones[z][2]) return z; return zones.length - 1; };
    const fuelSet = new Set(['gT', 'GT', 'gt', 'Gt'].map((s) => SUB.findIndex((x) => x.name === s)).filter((c) => c >= 0));
    const trace = SUB.findIndex((x) => x.name === 'trace');
    const acc = zones.map(() => ({ px: 0, all: 0, fuel: 0, trace: 0, cells: 0 }));
    // the solved flow's speed per pixel (for the dead zones)
    const F = this.flowWanted && this.flowS && !this.flowS.blocked ? this.flowS : null;
    let spd = null, smean = 0, sN = 0;
    if (F) {
      spd = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        if (this.kind[k] & 1) continue;
        const i = k % hw, j = (k - i) / hw, p = F.PAD + j * F.W1 + i;
        const ux = (F.psi[p + F.W1] - F.psi[p] + F.psi[p + F.W1 + 1] - F.psi[p + 1]) / 2, uy = (F.psi[p + 1] - F.psi[p] + F.psi[p + F.W1 + 1] - F.psi[p + F.W1]) / 2;
        spd[k] = Math.hypot(ux, uy); smean += spd[k]; sN++;
      }
      smean /= Math.max(1, sN);
    }
    const dead = { px: 0, all: 0, fuel: 0, trace: 0, cells: 0 };
    // ENCLOSED (crevices, side chambers, narrow gaps): water pixels with more than 60 % solid in the square 5 R round them (a summed-area table)
    const hh = this.hh, half = Math.max(1, Math.round(5 * R / px)), sat = new Float64Array((hw + 1) * (hh + 1));
    for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) sat[(j + 1) * (hw + 1) + i + 1] = (this.kind[j * hw + i] & 1) + sat[j * (hw + 1) + i + 1] + sat[(j + 1) * (hw + 1) + i] - sat[j * (hw + 1) + i];
    const enclosedAt = (k) => {
      const i = k % hw, j = (k - i) / hw, a = Math.max(0, i - half), b = Math.min(hw, i + half + 1), c = Math.max(0, j - half), d = Math.min(hh, j + half + 1);
      const sum = sat[d * (hw + 1) + b] - sat[c * (hw + 1) + b] - sat[d * (hw + 1) + a] + sat[c * (hw + 1) + a];
      return sum > 0.6 * (b - a) * (d - c);
    };
    const encl = { px: 0, all: 0, fuel: 0, trace: 0, cells: 0 };
    let inSolid = 0;
    for (let k = 0; k < n; k++) {
      let all = 0, fuel = 0;
      for (let c = 0; c < NC; c++) { const v = g[(2 + c) * n + k]; all += v; if (fuelSet.has(c)) fuel += v; }
      const tr = trace >= 0 ? g[(2 + trace) * n + k] : 0;
      const z = zone(k);
      if (z < 0) { inSolid += all; continue; }
      const A = acc[z];
      A.px++; A.all += all; A.fuel += fuel; A.trace += tr;
      if (spd && spd[k] < 0.1 * smean) { dead.px++; dead.all += all; dead.fuel += fuel; dead.trace += tr; }
      if (enclosedAt(k)) { encl.px++; encl.all += all; encl.fuel += fuel; encl.trace += tr; }
    }
    let alive = 0, inside = 0;
    for (let i = 0; i < cnt; i++) {
      if (!(cu[i * CELL_FLOATS + 9] & 1)) continue;
      alive++;
      const x = cb[i * CELL_FLOATS], y = cb[i * CELL_FLOATS + 1];
      const ii = Math.max(0, Math.min(hw - 1, Math.floor(x / px))), jj = Math.max(0, Math.min(this.hh - 1, Math.floor(y / px))), k = jj * hw + ii;
      const z = zone(k);
      if (z < 0) { inside++; continue; }
      acc[z].cells++;
      if (spd && spd[k] < 0.1 * smean) dead.cells++;
      if (enclosedAt(k)) encl.cells++;
    }
    const pxR2 = (px / R) ** 2;
    const per = (A) => ({ share: A.px / n, all: A.px ? A.all / A.px : 0, fuel: A.px ? A.fuel / A.px : 0, trace: A.px ? A.trace / A.px : 0, cellsR2: A.px ? A.cells / (A.px * pxR2) : 0, cells: A.cells });
    const open = per(acc[zones.length - 1]);
    const rel = (Z) => ({ ...Z, allRel: open.all ? Z.all / open.all : 0, fuelRel: open.fuel ? Z.fuel / open.fuel : 0, traceRel: open.trace ? Z.trace / open.trace : 0, cellsRel: open.cellsR2 ? Z.cellsR2 / open.cellsR2 : 0 });
    const out = { time: M.time(), alive, cellsInSolid: inside, matterInSolid: inSolid, solid: this.solidShare, porous: this.porousShare };
    zones.forEach(([name], z) => { out[name] = rel(per(acc[z])); });
    if (spd) out.dead = rel(per(dead));
    out.enclosed = rel(per(encl));
    if (F) out.flow = { sweeps: F.sweeps, converged: F.converged, islands: F.islands, last: F.last };
    this.census = out;
    return out;
  }

  // ---------- text ----------
  /** A few words for the WATER line. */
  panelText() {
    if (!this.active) return '';
    const s = `obstacles ${(100 * this.solidShare).toFixed(1)} %${this.porousShare > 0 ? ` (+ ${(100 * this.porousShare).toFixed(1)} % porous)` : ''}`;
    if (!this.perfusion || !this.perfusion.flowing) return s;
    const F = this.flowS;
    if (!this.params.flow) return `${s}, through-flow prescribed`;
    if (!F) return `${s}, through-flow …`;
    if (F.blocked) return `${s}, through-flow BLOCKED (a wall joins both sides)`;
    return `${s}, through-flow ${F.converged ? 'solved' : 'settling'}`;
  }
  overlayLines() {
    const p = this.params, F = this.flowS, on = (x) => (x ? 'on' : 'off');
    return [`obstacles (step G0b) ${on(p.on)}: ${this.shapes.length} shapes${this.round ? ', round dish' : ''}, ${(100 * this.solidShare).toFixed(1)} % solid, ` +
      `${(100 * this.porousShare).toFixed(1)} % porous · push ${p.push}/s, hard ${p.hard} r, corners flatten ${on(p.flatten)} · through-flow solved ${on(p.flow)}` +
      (F ? (F.blocked ? ' (blocked)' : ` (${F.islands} islands, ${F.sweeps} sweeps, ${F.converged ? 'settled' : `change ${(F.last || 0).toExponential(1)}`}, slow layer ${p.slip} R, kmin ${p.kmin})`) : '')];
  }
}
