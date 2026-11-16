// Full-screen background: the drifting sheen plus the shaded ripple field, on near-black.
// Colours and formulas follow the CPU reference (drawBackground), but evaluated per pixel:
// the coarse ripple grid is sampled with smooth (bilinear) interpolation instead of an upscaled image.

struct DrawParams {
  canvas: vec2f,     // canvas size in device pixels
  dpr: f32,          // device pixels per dish CSS pixel (app: x the camera's zoom)
  sc: f32,           // CSS pixels per ripple grid cell
  grid: vec2f,       // ripple grid size (cells)
  time: f32,         // simulation seconds
  ripple: f32,       // ripple brightness gain (1 = reference)
  sheen: f32,        // sheen brightness gain (1 = reference)
  panX: f32,         // app: the camera's pan (the dish point at the screen's top left, CSS px)
  panY: f32,
  swell: f32,        // step N1: the swell's slope drawn x this (0: not drawn; src/water.js)
  wave: array<vec4f, 6>,   // step N1: the swell's waves (kx, ky per CSS px, height CSS px, phase now), as the caustic light's
};

@group(0) @binding(0) var<uniform> D: DrawParams;
@group(0) @binding(1) var<storage, read> field: array<f32>;

struct VSOut {
  @builtin(position) pos: vec4f,
};

// one triangle that covers the whole screen
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  var o: VSOut;
  o.pos = vec4f(x, y, 0.0, 1.0);
  return o;
}

fn cell(x: i32, y: i32) -> f32 {
  let gw = i32(D.grid.x);
  let gh = i32(D.grid.y);
  let cx = clamp(x, 0, gw - 1);
  let cy = clamp(y, 0, gh - 1);
  return field[cy * gw + cx];
}

// bilinear sample of the ripple height at grid coordinate g
fn height(g: vec2f) -> f32 {
  let f = floor(g);
  let t = g - f;
  let x = i32(f.x);
  let y = i32(f.y);
  let a = mix(cell(x, y), cell(x + 1, y), t.x);
  let b = mix(cell(x, y + 1), cell(x + 1, y + 1), t.x);
  return mix(a, b, t.y);
}

// tiny per-pixel noise to hide 8-bit banding in the dark gradients
fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let css = in.pos.xy / D.dpr + vec2f(D.panX, D.panY);   // (app: through the camera)
  let g = css / D.sc;                // grid coordinates, as in the reference
  let t = D.time;

  // drifting sheen: two slow, gently warped sine sheets multiplied together
  let s = sin(g.x * 0.07 + t * 0.11 + 2.0 * sin(g.y * 0.04 - t * 0.07))
        * sin(g.y * 0.06 - t * 0.09 + 1.7 * sin(g.x * 0.036 + t * 0.05));

  // ripples drawn as a slope, lit from the upper left (like the reference)
  var v = (height(g - vec2f(1.0, 0.0)) - height(g + vec2f(1.0, 0.0)))
        + (height(g - vec2f(0.0, 1.0)) - height(g + vec2f(0.0, 1.0)));
  // step N1: the slow SWELL of the water's surface (src/water.js: the waves that focus the light into the caustic net), as a slope
  // lit from the same side (its height in CSS px, so a slope; x 2 sc as the ripples' difference over two cells)
  if (D.swell > 0.0) {
    var sl = vec2f(0.0);
    for (var j = 0u; j < 6u; j++) {
      let w = D.wave[j];
      if (w.z == 0.0) { continue; }
      sl += w.z * cos(dot(w.xy, css) + w.w) * w.xy;
    }
    v -= D.swell * 2.0 * D.sc * (sl.x + sl.y);
  }
  v = clamp(v * D.ripple, -1.2, 1.2);

  var c = vec3f(5.0, 8.0, 14.0)
        + D.sheen * s * vec3f(2.5, 4.0, 7.0)
        + v * vec3f(22.0, 30.0, 42.0);
  c = c / 255.0 + (hash(in.pos.xy) - 0.5) / 255.0;
  return vec4f(max(c, vec3f(0.0)), 1.0);
}
