// One time step of the damped slow wave field (the viscous ripples).
// Based on the CPU reference (rippleStep):
//   next = (2*cur - prev + coupling * L(cur) + viscosity * L(cur - prev)) * damping
// Two changes from the reference, both for a softer, more viscous look:
//   - L is the 9-point (isotropic) Laplacian, so rings stay round instead of turning square with a plaid inside;
//   - the viscosity term damps short waves strongly and long waves hardly at all (honey rather than water).
//     viscosity = 0 gives back the reference's behaviour (apart from the Laplacian).
// Three buffers rotate roles each step (prev <- cur <- next), so every read sees a finished state.
// The border is held at zero, as in the reference.
// Step C1: heat makes the medium simmer. Each step, a ripple cell gets a small random bump (up or down) with a chance
// that grows with the square of the temperature of the heat grid under it (src/heat.js), so hot places fill with small
// rings and cool places go still. The heat buffer is read as plain i32 (the heat passes write it with atomics, in other passes).

struct StepParams {
  gw: u32,          // grid width  (cells)
  gh: u32,          // grid height (cells)
  coupling: f32,    // wave speed squared, in grid units per step (0.06 in the reference)
  damping: f32,     // per-step decay (0.992 in the reference)
  viscosity: f32,   // damping of short waves (0 = none; keep below about 0.3 for stability)
  heatOn: u32,      // 1 = heat drops on
  tick: u32,        // step counter (random numbers)
  sc: f32,          // CSS px per ripple cell
  hpx: f32,         // CSS px per heat pixel
  hw: u32,          // heat grid size (pixels)
  hh: u32,
  hcur: u32,        // word offset of the current heat copy in the heat buffer
  tempScale: f32,   // counts in one heat pixel x tempScale = temperature (heat per R^2, energy units)
  drops: f32,       // chance per ripple cell per step of a bump, x the temperature squared
  dropAmp: f32,     // height of a bump
  maxP: f32,        // the chance is capped here
};

@group(0) @binding(0) var<uniform> P: StepParams;
@group(0) @binding(1) var<storage, read> cur: array<f32>;
@group(0) @binding(2) var<storage, read> prev: array<f32>;
@group(0) @binding(3) var<storage, read_write> next: array<f32>;
@group(0) @binding(4) var<storage, read> heat: array<i32>;

fn rpcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// 9-point Laplacian (weights 4 for sides, 1 for diagonals), of the height and of the velocity (cur - prev)
fn lapCur(i: u32, w: u32) -> f32 {
  let side = cur[i - 1u] + cur[i + 1u] + cur[i - w] + cur[i + w];
  let diag = cur[i - w - 1u] + cur[i - w + 1u] + cur[i + w - 1u] + cur[i + w + 1u];
  return (4.0 * side + diag - 20.0 * cur[i]) / 6.0;
}

fn lapVel(i: u32, w: u32) -> f32 {
  let side = (cur[i - 1u] - prev[i - 1u]) + (cur[i + 1u] - prev[i + 1u])
           + (cur[i - w] - prev[i - w]) + (cur[i + w] - prev[i + w]);
  let diag = (cur[i - w - 1u] - prev[i - w - 1u]) + (cur[i - w + 1u] - prev[i - w + 1u])
           + (cur[i + w - 1u] - prev[i + w - 1u]) + (cur[i + w + 1u] - prev[i + w + 1u]);
  return (4.0 * side + diag - 20.0 * (cur[i] - prev[i])) / 6.0;
}

@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.gw || id.y >= P.gh) { return; }
  let i = id.y * P.gw + id.x;
  if (id.x == 0u || id.y == 0u || id.x == P.gw - 1u || id.y == P.gh - 1u) {
    next[i] = 0.0;
    return;
  }
  let a = cur[i];
  var v = (2.0 * a - prev[i] + P.coupling * lapCur(i, P.gw) + P.viscosity * lapVel(i, P.gw)) * P.damping;
  if (P.heatOn != 0u) {
    let hx = min(u32(f32(id.x) * P.sc / P.hpx), P.hw - 1u);
    let hy = min(u32(f32(id.y) * P.sc / P.hpx), P.hh - 1u);
    let temp = max(f32(heat[P.hcur + hy * P.hw + hx]), 0.0) * P.tempScale;
    let r = rpcg(i ^ rpcg(P.tick ^ bitcast<u32>(a)));   // (the height changes every step: fresh numbers at 8x too)
    if (f32(r >> 8u) / 16777216.0 < min(P.drops * temp * temp, P.maxP)) {   // squared: cool places go still
      v += select(-P.dropAmp, P.dropAmp, (r & 1u) == 1u);
    }
  }
  next[i] = v;
}
