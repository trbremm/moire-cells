// ===== cell_common.wgsl: the cells' state, the simulation uniforms and the neighbour grid =====
// Not compiled on its own: src/cells.js prepends field_common.wgsl and then this file to every cell shader.
//
// Cells live in a fixed-capacity storage buffer (struct Cell, 48 bytes; keep in step with CELL_* in
// src/cells.js). Their order never changes, so drawing order is stable and a cell keeps its index.
//
// Neighbour grid (rebuilt every tick, see cell_grid.wgsl):
//   counts[g]   cells in grid cell g                        (atomic counter, then plain counts)
//   starts[g]   first slot of grid cell g in the sorted list (exclusive prefix sum of counts)
//   sorted[j]   copy of the cells in grid order; sortIdx[j] = the cell's index in `cells`
// Grid cell g = gy * gw + gx covers [gx cs, (gx+1) cs) x [gy cs, (gy+1) cs) in CSS px; positions outside
// the screen are clamped into the border cells. With cs >= the largest interaction range, a cell's
// neighbours are all in the 3 x 3 block around its own grid cell (grid_range below).

struct Cell {
  pos: vec2f,       // centre (CSS px)
  vel: vec2f,       // velocity (CSS px / s)
  r: f32,           // radius (CSS px); relaxes toward Sim.R
  la: f32,          // lattice angle (radians)
  e1: f32,          // area-preserving stretch (traceless tensor [[e1, e2], [e2, -e1]]); 0 for now
  e2: f32,
  kind: u32,        // KIND_* from field_common.wgsl (all stem for now)
  flags: u32,       // bit 0: alive (all alive for now; kept for division and death later)
  seed: u32,        // per-cell random seed
  aux: f32,         // spare (e.g. differentiation progress later)
};

const CELL_ALIVE: u32 = 1u;

// Per-tick simulation uniforms (written by src/cells.js; keep the order in step with writeSim there).
struct Sim {
  count: u32,       // number of cells
  gw: u32,          // grid width and height (grid cells)
  gh: u32,
  tick: u32,        // tick counter (random numbers)
  cs: f32,          // grid cell size (CSS px)
  R: f32,           // the cells' target radius (CSS px)
  W: f32,           // dish size (CSS px)
  H: f32,
  centre: vec2f,    // dish centre
  dt: f32,          // tick length (s)
  stiffness: f32,   // contact push (1/s); 0 = off
  damping: f32,     // velocity kept per tick (0.85 = reference)
  jitter: f32,      // Brownian kick per tick, full width, in units of R
  pull: f32,        // gentle pull to the dish centre (1/s)
  wall: f32,        // soft wall stiffness (1/s)
  pointer: vec2f,   // stir position (CSS px)
  pvel: vec2f,      // stir velocity (CSS px / s); zero when not stirring
  stirR2: f32,      // stir reach squared (CSS px^2)
  stir: f32,        // stir gain
  drift: f32,       // slow drift of the medium, in units of R per s (0.5 = reference)
  time: f32,        // simulation time (s)
};

// deformation matrix F = [[fa, fb], [fb, fd]] from the stretch (shape() in the reference)
fn cell_F(c: Cell) -> vec3f {
  let eps = sqrt(c.e1 * c.e1 + c.e2 * c.e2);
  if (eps < 1e-4) { return vec3f(1.0, 0.0, 1.0); }
  let ch = cosh(eps);
  let sh = sinh(eps) / eps;
  return vec3f(ch + sh * c.e1, sh * c.e2, ch - sh * c.e1);
}

// the cell as a field emitter (for step 4): strength min(1, r/R), range r0^2 = 4.84 R^2 as in the reference
fn cell_emitter(c: Cell, R: f32) -> Emitter {
  let F = cell_F(c);
  var e: Emitter;
  e.pos = c.pos;
  e.la = c.la;
  e.amp = min(1.0, c.r / R);
  e.r0sq = 4.84 * R * R;
  e.fa = F.x; e.fb = F.y; e.fd = F.z;
  e.kind = c.kind;
  e._pad = 0u;
  return e;
}

// grid cell (x, y) of a position, clamped into the grid
fn grid_xy(S: Sim, p: vec2f) -> vec2i {
  let g = vec2i(floor(p / S.cs));
  return clamp(g, vec2i(0), vec2i(i32(S.gw) - 1, i32(S.gh) - 1));
}

fn grid_index(S: Sim, g: vec2i) -> u32 {
  return u32(g.y) * S.gw + u32(g.x);
}

// the 3 x 3 block of grid cells around g, clipped to the grid: min corner in .xy, max corner in .zw
fn grid_range(S: Sim, g: vec2i) -> vec4i {
  let lo = max(g - vec2i(1), vec2i(0));
  let hi = min(g + vec2i(1), vec2i(i32(S.gw) - 1, i32(S.gh) - 1));
  return vec4i(lo, hi);
}

// small fast hash -> uniform random in [0, 1)
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand01(a: u32, b: u32) -> f32 {
  return f32(pcg(a ^ pcg(b)) >> 8u) / 16777216.0;
}

// ===== end of cell_common.wgsl =====
