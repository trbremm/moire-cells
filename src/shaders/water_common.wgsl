// ===== water_common.wgsl (step N1): the water's surface, shared by water.wgsl (the caustic block the physics uses) and
// water_draw.wgsl (the net drawn at screen resolution). Not compiled on its own: src/water.js prepends it. Each shader declares
// `W` (struct WaterP) and `rip` (the ripple field, array<f32>) itself.

struct WaterP {
  hw: u32,              // the heat grid
  hh: u32,
  flags: u32,           // bit 0: caustics; bit 1: currents; bit 2: the ripples feed the surface
  caus: u32,            // word offset (in hb) of the caustic block
  cur: u32,             // word offset of psi
  gw: u32,              // the ripple grid (src/background.js)
  gh: u32,
  _p0: u32,
  px: f32,              // CSS px per heat pixel
  sc: f32,              // CSS px per ripple cell
  ripGain: f32,         // ripple height -> surface height (CSS px)
  depth: f32,           // D: how far the light travels below the surface (CSS px, x the refraction's factor)
  eps: f32,             // softening of the focus (a finite sun)
  imax: f32,            // the brightest the focus gets (x the mean)
  norm: f32,            // 1 / the swell's mean brightness
  strength: f32,        // 0: no caustics, 1: all
  wave: array<vec4f, 6>, // the swell: kx, ky (radians per CSS px), height (CSS px), phase now
  dish: vec4f,          // W, H (CSS px), the window's width (CSS px), spare
  cen: vec4f,           // the medium's centre x, y; A (the beat's psi amplitude, px^2 / s); G (the gyre's)
  q: array<vec4f, 3>,   // the beat's wavevectors (radians per CSS px) and their phases now
  stir: vec4u,          // step G0 (src/stir.js): word offset in hb of the STIRRED stream function on the stir grid (0: none), its width and
                        // height (nodes), its spacing (CSS px, f32 bits)
};

// step G0: where p (CSS px) sits on the stir grid: o the word of the node at its cell's lower corner (0 if p lies outside the grid, which reaches
// no further than its last node: beyond it the stirred psi is 0), t the bilinear weights; each shader reads its own buffer
struct StirCell { o: u32, t: vec2f, };
fn stir_cell(p: vec2f) -> StirCell {
  var r: StirCell;
  if (W.stir.x == 0u) { return r; }
  let q = p / bitcast<f32>(W.stir.w);
  let lim = vec2f(f32(W.stir.y - 1u), f32(W.stir.z - 1u));
  if (q.x < 0.0 || q.y < 0.0 || q.x >= lim.x || q.y >= lim.y) { return r; }
  let b = vec2u(floor(q));
  r.o = W.stir.x + b.y * W.stir.y + b.x;
  r.t = q - vec2f(b);
  return r;
}


fn rcell(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(W.gw) - 1);
  let cy = clamp(y, 0, i32(W.gh) - 1);
  return rip[u32(cy) * W.gw + u32(cx)];
}
// the ripple height at ripple-grid coordinate g (bilinear, as the background draws it)
fn rheight(g: vec2f) -> f32 {
  let f = floor(g);
  let t = g - f;
  let x = i32(f.x);
  let y = i32(f.y);
  return mix(mix(rcell(x, y), rcell(x + 1, y), t.x), mix(rcell(x, y + 1), rcell(x + 1, y + 1), t.x), t.y);
}

// the swell's curvature at p (CSS px): (h_xx, h_yy, h_xy)
fn swell_curv(p: vec2f) -> vec3f {
  var H = vec3f(0.0);
  for (var j = 0u; j < 6u; j++) {
    let w = W.wave[j];
    if (w.z == 0.0) { continue; }
    let s = w.z * sin(dot(w.xy, p) + w.w);
    H -= s * vec3f(w.x * w.x, w.y * w.y, w.x * w.y);
  }
  return H;
}
// the simulated ripples' curvature at p (their grid is a few CSS px: worked out once per heat pixel or screen pixel)
fn rip_curv(p: vec2f) -> vec3f {
  if ((W.flags & 4u) == 0u || W.gw <= 2u) { return vec3f(0.0); }
  let g = p / W.sc;
  let c = rheight(g);
  let k = W.ripGain / (W.sc * W.sc);
  let hx = rheight(g + vec2f(1.0, 0.0)) - 2.0 * c + rheight(g - vec2f(1.0, 0.0));
  let hy = rheight(g + vec2f(0.0, 1.0)) - 2.0 * c + rheight(g - vec2f(0.0, 1.0));
  let hxy = 0.25 * (rheight(g + vec2f(1.0, 1.0)) - rheight(g + vec2f(1.0, -1.0)) - rheight(g + vec2f(-1.0, 1.0)) + rheight(g + vec2f(-1.0, -1.0)));
  return k * vec3f(hx, hy, hxy);
}

// the caustic brightness for the surface's curvature H (x the light: 1 on average over the swell, `strength` mixed in)
fn caustic_of(H0: vec3f) -> f32 {
  let H = H0 * W.depth;
  let det = (1.0 + H.x) * (1.0 + H.y) - H.z * H.z;
  let I = min(inverseSqrt(det * det + W.eps * W.eps), W.imax) * W.norm;
  return max(0.0, 1.0 + W.strength * (I - 1.0));
}

// ===== end of water_common.wgsl =====
