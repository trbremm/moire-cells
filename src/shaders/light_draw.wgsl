// The light's drawing (Part C, step C2), crisp and flat: no glow, no blur. light_common.wgsl is prepended (src/light.js).
//   fs_tint  a very faint flat tint where the light falls, posterised into a few flat levels: in the spot, bands across
//            it (brighter on the near side when tilted); in full field, the cloud patches. Drawn under the cells.
//   fs_line  the spot's outline, a thin hard-edged ellipse, and a small triangle on the near rim pointing inward: the
//            side the light comes from. Drawn over the cells.
// Full field: a full-screen triangle; spot: a quad around the ellipse and its marker only. The shapes are worked out per
// pixel from the same numbers the heat passes use.

@group(0) @binding(0) var<uniform> L: LightP;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  if (L.mode != LIGHT_SPOT) {
    // full-screen triangle (vertices 3 to 5 collapse)
    let k = min(i, 2u);
    let p = vec2f(f32((k << 1u) & 2u), f32(k & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  }
  // the ellipse's bounding box, plus room for the marker and the outline
  let perp = vec2f(-L.toward.y, L.toward.x);
  let a = L.radius * L.stretch * L.toward;
  let b = L.radius * perp;
  let m = L.draw.z + L.draw.y + 3.0;
  let ext = sqrt(a * a + b * b) + vec2f(m);
  var corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                               vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let x = L.centre + corner[i] * ext;                         // CSS px
  let ndc = vec2f(x.x / L.viewW * 2.0 - 1.0, 1.0 - x.y / L.viewH * 2.0);
  return vec4f(ndc, 0.0, 1.0);
}

fn premul(rgb: vec3f, a: f32) -> vec4f {
  return vec4f(rgb * a, a);
}

@fragment
fn fs_tint(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dpr = L.draw.x;
  let x = fc.xy / dpr;
  let steps = max(L.draw.w, 1.0);
  if (L.mode == LIGHT_FULL) {
    // the clouds' shadow, posterised: clear sky = full tint, the deepest cloud = (1 - depth) of it
    var q = 1.0;
    if (L.clouds != 0u && L.cloud.w > 0.0) {
      let c = light_cloud(L, x);
      q = 1.0 - L.cloud.w * round(c * (steps - 1.0)) / max(steps - 1.0, 1.0);
    }
    return premul(L.tint.rgb, L.tint.a * q);
  }
  if (L.mode != LIGHT_SPOT) { discard; }
  let uv = light_spot_uv(L, x);
  let rho = length(uv);
  // a crisp rim: one device pixel of antialiasing
  let rim = clamp((1.0 - rho) * L.radius * dpr + 0.5, 0.0, 1.0);
  if (rim <= 0.0) { discard; }
  // brightness 1 + near x u in flat steps of 1 / steps, dimmer as the spot spreads (/ stretch)
  let b = round(max(1.0 + L.near * uv.x, 0.0) * steps) / steps;
  return premul(L.tint.rgb, L.tint.a * rim * b / L.stretch);
}

@fragment
fn fs_line(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dpr = L.draw.x;
  let x = fc.xy / dpr;
  let perp = vec2f(-L.toward.y, L.toward.x);
  let a = L.radius * L.stretch;          // half-axis toward the light
  let d = x - L.centre;
  let u = dot(d, L.toward) / a;
  let v = dot(d, perp) / L.radius;
  let rho = max(length(vec2f(u, v)), 1e-4);
  // distance to the ellipse, to first order: (rho - 1) / |grad rho| (CSS px), then in device px
  let g = length(u / a * L.toward + v / L.radius * perp) / rho;
  let dist = abs(rho - 1.0) / max(g, 1e-6) * dpr;
  let half = 0.5 * L.draw.y * dpr;
  var cov = clamp(half + 0.5 - dist, 0.0, 1.0);
  // the marker: a small triangle outside the near rim, its tip on the outline, pointing inward
  let h = L.draw.z;
  if (h > 0.0) {
    let w = 0.55 * h;
    let tip = L.centre + L.toward * a;
    let s = dot(x - tip, L.toward);       // 0 at the tip, h at the base (outward)
    let t = abs(dot(x - tip, perp));
    let side = (s * w - t * h) / sqrt(w * w + h * h);
    let inside = min(min(side, h - s), s + 0.5 * L.draw.y) * dpr;
    cov = max(cov, clamp(inside + 0.5, 0.0, 1.0));
  }
  if (cov <= 0.0) { discard; }
  return premul(L.line.rgb, L.line.a * cov);
}
