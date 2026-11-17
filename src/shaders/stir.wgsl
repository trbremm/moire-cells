// Step G0, CELLS STIR THE WATER (src/stir.js): the stirred flow's passes, once per frame before the water's surface pass. The cells' step
// (cell_step.wgsl) puts down, every tick, each cell's drag on the water (wet x its driven velocity relative to the water, x its footprint's
// share of a node's area) on a coarse STIR GRID (nodes h CSS px apart, sw x sh; two blocks of hb: x then y, fixed point, summed over the
// frame's ticks). Then:
//   curl     the curl of that force (its mean over the frame) at every node, x the gain G: the vorticity the cells' push makes
//   omega    the vorticity relaxes toward it with VISCOSITY and DECAY: an implicit step of d omega / dt = (G curl F - omega + L^2 lap omega)
//            / tau (L the viscous reach, tau the fading time; frame dt), by Jacobi passes from the frame before's vorticity
//   psi      the stream function: (lap - kappa^2) psi = -omega (kappa a weak screening, the dish floor's friction on a thin film: it keeps
//            the response local), Jacobi passes warm-started from the frame before's; psi = 0 on the dish's rim (no flow through the wall)
//            and HELD on solid nodes (the mask, MASK-READY for step G0b's obstacles: a solid node keeps the value it has, all fluid today)
//   publish  psi into its block of hb (f32 bits), where the water's surface pass adds it to the prescribed psi (water.wgsl) and the cells
//            read their own flow (cell_step.wgsl stir_vel)
// A uniform push gives a uniform flow u = G F (the vorticity of a shear is G x the force's), so G is "how fast the water goes where the
// cells push it": with full cover, cells moving at v relative to the water push it at G x wet x v.

struct StirP {
  sw: u32,              // the stir grid (nodes)
  sh: u32,
  n: u32,               // sw x sh
  flags: u32,           // bit 0: on
  fx: u32,              // word offsets in hb: the force splat's x block (its y block follows at fx + n)
  psi: u32,             // ... the published stream function
  _p0: u32,
  _p1: u32,
  h: f32,               // CSS px between nodes
  scale: f32,           // the splat's counts -> the frame's mean force (px / s of coverage-weighted drag): 1 / (fixed point x ticks)
  gain: f32,            // G
  a: f32,               // frame dt / tau (the decay's share this frame)
  c: f32,               // a x L^2 / h^2 (the viscosity's coupling this frame)
  k2: f32,              // kappa^2 h^2 (the stream function's screening)
  _p2: f32,
  _p3: f32,
};

@group(0) @binding(0) var<uniform> P: StirP;
@group(0) @binding(1) var<storage, read_write> hb: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read> rhs: array<f32>;
@group(0) @binding(3) var<storage, read> aux: array<f32>;
@group(0) @binding(4) var<storage, read> pin: array<f32>;
@group(0) @binding(5) var<storage, read_write> pout: array<f32>;
@group(0) @binding(6) var<storage, read> mask: array<u32>;

fn rim(x: u32, y: u32) -> bool { return x == 0u || y == 0u || x + 1u >= P.sw || y + 1u >= P.sh; }
fn force(o: u32) -> f32 { return f32(atomicLoad(&hb[o])) * P.scale; }

// the curl of the frame's mean force, x G (rim nodes 0), into `pout`
@compute @workgroup_size(8, 8)
fn curl(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.sw || id.y >= P.sh) { return; }
  let i = id.y * P.sw + id.x;
  if (rim(id.x, id.y) || mask[i] != 0u) { pout[i] = 0.0; return; }
  let fy = P.fx + P.n;
  let dFy = force(fy + i + 1u) - force(fy + i - 1u);
  let dFx = force(P.fx + i + P.sw) - force(P.fx + i - P.sw);
  pout[i] = P.gain * (dFy - dFx) / (2.0 * P.h);
}

// one Jacobi pass of the vorticity's implicit step: (1 + a + 4c) w = w_old + a S + c (sum of the 4 neighbours); rhs = S, aux = w_old
@compute @workgroup_size(8, 8)
fn omega(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.sw || id.y >= P.sh) { return; }
  let i = id.y * P.sw + id.x;
  if (rim(id.x, id.y) || mask[i] != 0u) { pout[i] = 0.0; return; }
  let nb = pin[i - 1u] + pin[i + 1u] + pin[i - P.sw] + pin[i + P.sw];
  pout[i] = (aux[i] + P.a * rhs[i] + P.c * nb) / (1.0 + P.a + 4.0 * P.c);
}

// one Jacobi pass of the stream function: (4 + k2) psi = omega h^2 + (sum of the 4 neighbours); rhs = omega; 0 on the rim, held on solid nodes
@compute @workgroup_size(8, 8)
fn psi(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.sw || id.y >= P.sh) { return; }
  let i = id.y * P.sw + id.x;
  if (rim(id.x, id.y)) { pout[i] = 0.0; return; }
  if (mask[i] != 0u) { pout[i] = pin[i]; return; }
  let nb = pin[i - 1u] + pin[i + 1u] + pin[i - P.sw] + pin[i + P.sw];
  pout[i] = (rhs[i] * P.h * P.h + nb) / (4.0 + P.k2);
}

// the stream function into hb (f32 bits), for the surface pass, the cells and the drawing
@compute @workgroup_size(8, 8)
fn publish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.sw || id.y >= P.sh) { return; }
  let i = id.y * P.sw + id.x;
  atomicStore(&hb[P.psi + i], bitcast<i32>(pin[i]));
}
