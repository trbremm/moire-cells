// ===== light_common.wgsl: where the light falls (Part C, step C2) =====
// Not compiled on its own: src/heat.js prepends it to heat.wgsl (absorption, the in / out-of-spot numbers), and
// src/light.js to light_draw.wgsl (the spot's outline and tint). Both read the same struct, written once per frame by
// src/light.js, so what is drawn is exactly where the heat goes.
//
// The light has four bands on the energy ladder (src/light.js, BANDS): WARM, VISIBLE 1, VISIBLE 2, HARD. Each band's
// share of the power arrives where light_factor() says; what is caught there becomes heat, the rest passes through
// the dish and is lost. What catches a band is a list of ABSORBERS, each an optical depth tau per band times an amount
// per place (Beer-Lambert: the share caught is 1 - exp(-sum of tau x amount)). In C2 there are two: the bare medium
// (amount 1 everywhere) and the cells (amount = how much of the place they cover). Later steps add more (atoms,
// sediment, the cells' pigments) as further terms in heat.wgsl's absorb().

struct LightP {
  mode: u32,         // 0 off, 1 spotlight, 2 full field
  clouds: u32,       // 1: cloud patches drift over the full field
  viewW: f32,        // the dish's size (CSS px), for the drawing's quad
  viewH: f32,
  centre: vec2f,     // the spot's centre (CSS px)
  toward: vec2f,     // unit vector from the centre toward the light (the spot's near side)
  radius: f32,       // the beam's radius (CSS px): the ellipse's short half-axis
  stretch: f32,      // 1 / cos(tilt): the long half-axis (toward the light) is radius x stretch
  near: f32,         // brightness slope across the spot: x (1 + near) on the near rim, x (1 - near) on the far rim
  edge: f32,         // width of the rim's crisp falloff (CSS px)
  cloud: vec4f,      // xy: noise offset (drift; in cloud sizes), z: 1 / cloud size (per CSS px), w: depth (0 = none)
  power: vec4f,      // per band: counts per heat pixel per tick where light_factor = 1 (day cycle included)
  tauMed: vec4f,     // per band: optical depth of the bare medium
  tauCell: vec4f,    // per band: optical depth of one full layer of cells
  tint: vec4f,       // drawing: rgb and alpha of the flat tint inside the spot (or over the full field)
  line: vec4f,       // drawing: rgb and alpha of the outline and the marker
  draw: vec4f,       // drawing: dpr, outline width (CSS px), marker size (CSS px), tint steps (posterised levels)
};

const LIGHT_OFF: u32 = 0u;
const LIGHT_SPOT: u32 = 1u;
const LIGHT_FULL: u32 = 2u;

fn light_hash(i: vec2i) -> f32 {
  var h = (bitcast<u32>(i.x) * 0x8da6b343u) ^ (bitcast<u32>(i.y) * 0xd8163841u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h ^= h >> 15u;
  return f32(h >> 8u) / 16777216.0;
}

// smooth value noise, 0..1
fn light_noise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = light_hash(i);
  let b = light_hash(i + vec2i(1, 0));
  let c = light_hash(i + vec2i(0, 1));
  let d = light_hash(i + vec2i(1, 1));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// how much cloud is over x (0 clear .. 1 full): two octaves of noise, thresholded softly into patches
fn light_cloud(L: LightP, x: vec2f) -> f32 {
  let p = x * L.cloud.z + L.cloud.xy;
  let n = 0.65 * light_noise(p) + 0.35 * light_noise(2.03 * p + vec2f(17.3, -9.1));
  return smoothstep(0.42, 0.72, n);
}

// the spot's ellipse coordinates of x: (along the light's direction, across), both 1 on the rim
fn light_spot_uv(L: LightP, x: vec2f) -> vec2f {
  let d = x - L.centre;
  let perp = vec2f(-L.toward.y, L.toward.x);
  return vec2f(dot(d, L.toward) / (L.radius * L.stretch), dot(d, perp) / L.radius);
}

// whether x is lit at all (inside the spot, or anywhere in full field)
fn light_inside(L: LightP, x: vec2f) -> bool {
  if (L.mode == LIGHT_FULL) { return true; }
  if (L.mode != LIGHT_SPOT) { return false; }
  let uv = light_spot_uv(L, x);
  return dot(uv, uv) < 1.0;
}

// the light falling at x as a share of the full irradiance (the power at tilt 0, no clouds): 0 outside the spot.
// Spot: the same power spread over an ellipse 1 / cos(tilt) longer (so x cos(tilt) on average), brighter on the near
// side by a linear slope whose mean over the ellipse is zero (the total stays the same), with a crisp rim.
fn light_factor(L: LightP, x: vec2f) -> f32 {
  if (L.mode == LIGHT_FULL) {
    if (L.clouds != 0u && L.cloud.w > 0.0) { return 1.0 - L.cloud.w * light_cloud(L, x); }
    return 1.0;
  }
  if (L.mode != LIGHT_SPOT) { return 0.0; }
  let uv = light_spot_uv(L, x);
  let rho = length(uv);
  let rim = clamp((1.0 - rho) * L.radius / max(L.edge, 1e-3) + 0.5, 0.0, 1.0);
  return rim * max(1.0 + L.near * uv.x, 0.0) / L.stretch;
}

// ===== end of light_common.wgsl =====
