// ===== signal_draw.wgsl: step Q1, the SIGNALS view's haze (src/signals.js drawLayer) =====
// A full-screen triangle under the cells (the light buffer, "over"), only in the signals view: the signal in the water as a faint haze, its
// hue the flavour (the vector's angle), its brightness the vector's length, soft (a / (a + ref)); where flavours cancel (the energy A holds
// more than the vector shows) a pale grey mist. Bilinear between the pixels' centres, so it stays smooth at any zoom.

struct SDraw {
  hw: u32,
  hh: u32,
  base: u32,        // word offset of the signal's copy 0, channel A (X at + n, Y at + 2 n)
  n: u32,
  px: f32,          // CSS px per pixel
  dpr: f32,         // device px per CSS px (x the zoom)
  href: f32,        // vector counts per pixel at half brightness
  strength: f32,    // the haze's brightness
  cam: vec4f,       // the camera (xy pan)
  dish: vec4f,      // x y the dish (CSS px); z the hues' saturation; w the pale mist's share
};
@group(0) @binding(0) var<uniform> D: SDraw;
@group(0) @binding(1) var<storage, read> g: array<i32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn at3(x: i32, y: i32) -> vec3f {
  let q = clamp(vec2i(x, y), vec2i(0), vec2i(i32(D.hw) - 1, i32(D.hh) - 1));
  let j = u32(q.y) * D.hw + u32(q.x);
  return vec3f(f32(g[D.base + j]), f32(g[D.base + D.n + j]), f32(g[D.base + 2u * D.n + j]));
}
fn sample(p: vec2f) -> vec3f {
  let gp = p / D.px - 0.5;
  let b = floor(gp);
  let t = gp - b;
  let i = vec2i(b);
  return mix(mix(at3(i.x, i.y), at3(i.x + 1, i.y), t.x), mix(at3(i.x, i.y + 1), at3(i.x + 1, i.y + 1), t.x), t.y);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let x = fc.xy / D.dpr + D.cam.xy;
  if (x.x < 0.0 || x.y < 0.0 || x.x > D.dish.x || x.y > D.dish.y) { discard; }
  let s = sample(x);
  let v = s.yz;
  let a = length(v);
  let e = max(s.x * 16.0 - a, 0.0);      // (16 = XY_SCALE: what the energy holds beyond the vector, where flavours cancelled)
  let hb = a / (a + D.href);
  let mb = D.dish.w * e / (e + 2.0 * D.href);
  if (hb + mb < 0.004) { discard; }
  let h = atan2(v.y, v.x) / 6.2831853 + 0.56;   // (as the cells' q1_hue: flavour 0 sky blue)
  let hue = max(0.55 + 0.5 * D.dish.z * cos(6.2831853 * (h + vec3f(0.0, -1.0 / 3.0, 1.0 / 3.0))), vec3f(0.0));
  let rgb = D.strength * (hue * hb + vec3f(0.55, 0.58, 0.62) * mb);
  let al = clamp(0.85 * (hb + mb), 0.0, 0.45);   // (faint: a dense, busy dish's haze stays a veil)
  return vec4f(rgb * al, al);
}
