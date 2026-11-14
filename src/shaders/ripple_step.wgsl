// One time step of the damped slow wave field (the viscous ripples).
// Based on the CPU reference (rippleStep):
//   next = (2*cur - prev + coupling * L(cur) + viscosity * L(cur - prev)) * damping
// Two changes from the reference, both for a softer, more viscous look:
//   - L is the 9-point (isotropic) Laplacian, so rings stay round instead of turning square with a plaid inside;
//   - the viscosity term damps short waves strongly and long waves hardly at all (honey rather than water).
//     viscosity = 0 gives back the reference's behaviour (apart from the Laplacian).
// Three buffers rotate roles each step (prev <- cur <- next), so every read sees a finished state.
// The border is held at zero, as in the reference.

struct StepParams {
  gw: u32,          // grid width  (cells)
  gh: u32,          // grid height (cells)
  coupling: f32,    // wave speed squared, in grid units per step (0.06 in the reference)
  damping: f32,     // per-step decay (0.992 in the reference)
  viscosity: f32,   // damping of short waves (0 = none; keep below about 0.3 for stability)
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> P: StepParams;
@group(0) @binding(1) var<storage, read> cur: array<f32>;
@group(0) @binding(2) var<storage, read> prev: array<f32>;
@group(0) @binding(3) var<storage, read_write> next: array<f32>;

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
  next[i] = (2.0 * a - prev[i] + P.coupling * lapCur(i, P.gw) + P.viscosity * lapVel(i, P.gw)) * P.damping;
}
