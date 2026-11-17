// App: the VIEW CAMERA (zoom and pan). Only the drawing and the pointer change; the simulation runs in dish coordinates
// (CSS px of the dish, 0..W x 0..H, as before) and never sees the camera.
//
//   screen = (dish - pan) x zoom x fit    dish = screen / (zoom x fit) + pan
//
// fit: canvas CSS px per dish px (src/dish.js: the dish keeps its own size and the canvas is fitted inside the window; 1 when the dish is
// the window, as before). The drawing gets it through view.dpr (device px per dish px), so only the pointer needs it here.
//
// zoom 1 (with pan 0) is the whole dish, as before; up to MAX_ZOOM. The pan is clamped so the view never leaves the dish.
// Every drawing uniform gets the camera from here (see `cam` in the draw shaders): the full-screen passes map a pixel to the
// dish as fc / (dpr x zoom) + pan, the instanced ones (cells, the spot's quad) map the dish to the screen the other way.
// `moved` is set whenever the camera changes, so the neon trails can start afresh (a pan would smear them).

export const MAX_ZOOM = 8;

export const camera = {
  z: 1, x: 0, y: 0,      // zoom, and the dish point at the screen's top left corner (CSS px of the dish)
  W: 1, H: 1,            // the dish (dish px; = the canvas's CSS px when fit is 1)
  f: 1,                  // canvas CSS px per dish px
  moved: false,          // changed since the last frame took it (main.js clears it after drawing)
  listeners: [],

  /** The dish's size (on a resize): the pan is clamped again. */
  setDish(W, H, f = 1) { this.W = W; this.H = H; this.f = f > 0 ? f : 1; this.clamp(); },

  /** The canvas's size (CSS px). */
  get SW() { return this.W * this.f; },
  get SH() { return this.H * this.f; },

  toDish(sx, sy) { const s = this.z * this.f; return [sx / s + this.x, sy / s + this.y]; },
  toScreen(dx, dy) { const s = this.z * this.f; return [(dx - this.x) * s, (dy - this.y) * s]; },

  clamp() {
    this.z = Math.max(1, Math.min(MAX_ZOOM, this.z));
    this.x = Math.max(0, Math.min(this.W - this.W / this.z, this.x));
    this.y = Math.max(0, Math.min(this.H - this.H / this.z, this.y));
  },

  changed() { this.moved = true; for (const f of this.listeners) f(this); },

  /** Zoom by `factor` keeping the dish point under the screen point (sx, sy) where it is. */
  zoomAt(sx, sy, factor) {
    const [dx, dy] = this.toDish(sx, sy);
    const z = Math.max(1, Math.min(MAX_ZOOM, this.z * factor));
    if (z === this.z) return false;
    this.z = z;
    this.x = dx - sx / (z * this.f); this.y = dy - sy / (z * this.f);
    this.clamp();
    this.changed();
    return true;
  },

  /** Move the view by (sx, sy) screen CSS px (a drag: the dish follows the finger). */
  panBy(sx, sy) {
    const x = this.x, y = this.y;
    this.x -= sx / (this.z * this.f); this.y -= sy / (this.z * this.f);
    this.clamp();
    if (x !== this.x || y !== this.y) this.changed();
  },

  /** Set zoom and the dish point at the screen's centre. */
  set(z, cx, cy) {
    this.z = Math.max(1, Math.min(MAX_ZOOM, z));
    this.x = cx - this.W / 2 / this.z; this.y = cy - this.H / 2 / this.z;
    this.clamp();
    this.changed();
  },

  /** The whole dish. */
  fit() { this.set(1, this.W / 2, this.H / 2); },

  /** For the draw uniforms: [pan x, pan y, zoom, 0]. */
  vec() { return [this.x, this.y, this.z, 0]; },
};
