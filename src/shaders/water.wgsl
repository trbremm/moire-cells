// Step N1, a nutrient landscape: THE WATER (src/water.js). One pass per frame, before the cells' ticks, writes two things into the
// heat buffer that the light and the matter read:
//
//   CAUSTIC LIGHT   the dish's water has a SURFACE: the background's ripples (the simulated wave field, src/background.js) plus a
//                   slow SWELL of a few long travelling waves (the same swell is drawn in the ripple background). Light coming down
//                   through it is bent by the surface's slope, so the floor gets a pattern of focused light: a point x of the surface
//                   sends its light to x + D grad h, and where neighbouring rays converge the light is bright. The brightness is
//                   1 / |det(I + D H)|, H the surface's curvature (its second derivatives), softened (eps) and capped (imax), then
//                   scaled so the swell alone averages 1 (the light is moved around, not made), and mixed in by `strength`. It
//                   multiplies the light everywhere the light is used: the dish's absorption (heat.wgsl), the substances' light
//                   reactions (matter.wgsl), the cells' pigments and hard light dose (cell_eat.wgsl). The look: a wandering bright net.
//   CURRENTS        a stream function psi at the heat pixels' CORNERS ((hw + 1) x (hh + 1) of them, CSS px^2 per s): the water's
//                   velocity is (d psi / dy, -d psi / dx), so it is divergence-free, and psi = 0 on the dish's rim (no flow through
//                   the wall). psi = window x (A x the MOIRE BEAT of the medium's lattice against a copy of itself turned by a couple of
//                   degrees (three cosines: a hexagonal array of slow eddies, the user's "chemical landscape made of moire beats") +
//                   G x one basin-wide gyre that slowly reverses). matter.wgsl moves every mobile substance with it (upwind, exact
//                   counts), cell_step.wgsl lets the cells drift a little with it.

// (struct WaterP and the surface's curvature: water_common.wgsl, prepended)

@group(0) @binding(0) var<uniform> W: WaterP;
@group(0) @binding(1) var<storage, read_write> hb: array<i32>;
@group(0) @binding(2) var<storage, read> rip: array<f32>;

fn psi_node(p: vec2f) -> f32 {
  let wd = max(W.dish.z, 1.0);
  let win = smoothstep(0.0, wd, p.x) * smoothstep(0.0, wd, W.dish.x - p.x) * smoothstep(0.0, wd, p.y) * smoothstep(0.0, wd, W.dish.y - p.y);
  if (win <= 0.0) { return through(p); }
  let d = p - W.cen.xy;
  var beat = 0.0;
  for (var m = 0u; m < 3u; m++) { beat += cos(dot(W.q[m].xy, d) + W.q[m].z); }
  let gyre = sin(3.14159265 * p.x / W.dish.x) * sin(3.14159265 * p.y / W.dish.y);
  return win * (W.cen.z * beat + W.cen.w * gyre) + through(p);
}

// PERFUSION (src/perfusion.js): a gentle THROUGH-FLOW from the inlet side to the outlet side, mean speed U (dish.w along x, q[0].w along
// y; CSS px per s), with the channel's profile (Poiseuille: fastest in the middle, still at the side walls): psi = U H (3 s^2 - 2 s^3),
// s across the channel, so it stays divergence-free; at the inlet and outlet walls no flux is taken (the rim has no outer edge): matter
// piles against the outlet, whose sink lets it out
fn through(p: vec2f) -> f32 {
  var v = 0.0;
  if (W.dish.w != 0.0) { let s = clamp(p.y / W.dish.y, 0.0, 1.0); v += W.dish.w * W.dish.y * s * s * (3.0 - 2.0 * s); }
  if (W.q[0].w != 0.0) { let s = clamp(p.x / W.dish.x, 0.0, 1.0); v -= W.q[0].w * W.dish.x * s * s * (3.0 - 2.0 * s); }
  return v;
}

@compute @workgroup_size(8, 8)
fn surface(@builtin(global_invocation_id) id: vec3u) {
  if (id.x > W.hw || id.y > W.hh) { return; }
  if ((W.flags & 2u) != 0u) {
    hb[W.cur + id.y * (W.hw + 1u) + id.x] = bitcast<i32>(psi_node(vec2f(id.xy) * W.px));
  }
  if ((W.flags & 1u) != 0u && id.x < W.hw && id.y < W.hh) {
    // the pixel's mean over 3 x 3 points (the bright lines are thinner than a pixel)
    let hr = rip_curv((vec2f(id.xy) + 0.5) * W.px);
    var v = 0.0;
    for (var k = 0u; k < 9u; k++) {
      let o = (vec2f(f32(k % 3u), f32(k / 3u)) + 0.5) / 3.0;
      v += caustic_of(swell_curv((vec2f(id.xy) + o) * W.px) + hr);
    }
    hb[W.caus + id.y * W.hw + id.x] = bitcast<i32>(v / 9.0);
  }
}
