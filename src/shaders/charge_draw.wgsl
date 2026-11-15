// Step C6b: the screened charge field's potential phi drawn as thin crisp contour lines (src/charge.js; drawing only, under
// the cells; under the neon look they get the halo's tight glow like every line). A full-screen triangle; each pixel reads
// phi bilinearly from the grid (the heat buffer's phi block, plain f32 bits) and draws a line where phi crosses a multiple
// of `step` (not 0: most of the dish sits near 0), at most `levels` lines each way: + in one ink, - in the other. The
// line keeps its width on screen (the distance to the level is measured in screen pixels, through fwidth), and lines that
// crowd closer than about 2 pixels fade out instead of filling the place.

struct ContourP {
  hw: u32,          // grid width and height (pixels)
  hh: u32,
  phi: u32,         // word offset of phi in `g` (the heat buffer behind its ledger)
  levels: u32,      // lines each way at most
  px: f32,          // CSS px per grid pixel
  dpr: f32,
  step: f32,        // phi between two lines
  lineW: f32,       // CSS px
  pos: vec4f,       // ink of the + lines (premultiplied by its level; w the level)
  neg: vec4f,       // ink of the - lines
};

@group(0) @binding(0) var<uniform> C: ContourP;
@group(0) @binding(1) var<storage, read> g: array<i32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn phi_px(x: i32, y: i32) -> f32 {
  let q = clamp(vec2i(x, y), vec2i(0), vec2i(i32(C.hw) - 1, i32(C.hh) - 1));
  return bitcast<f32>(g[C.phi + u32(q.y) * C.hw + u32(q.x)]);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let x = fc.xy / C.dpr;                         // CSS px
  let gp = x / C.px - 0.5;                       // grid coordinates (pixel centres at whole numbers)
  let b = floor(gp);
  let f = gp - b;
  let i = vec2i(b);
  let p00 = phi_px(i.x, i.y);
  let p10 = phi_px(i.x + 1, i.y);
  let p01 = phi_px(i.x, i.y + 1);
  let p11 = phi_px(i.x + 1, i.y + 1);
  let phi = mix(mix(p00, p10, f.x), mix(p01, p11, f.x), f.y);
  let v = phi / C.step;
  let fw = max(fwidth(v), 1e-6);                 // level steps per device pixel
  let n = round(v);
  let d = abs(v - n) / fw;                       // device pixels to the nearest level
  let lw = C.lineW * C.dpr;
  var a = 1.0 - smoothstep(0.5 * lw - 0.5, 0.5 * lw + 0.5, d);
  a *= 1.0 - smoothstep(0.25, 0.5, fw);          // crowded lines (closer than 2 to 4 px) fade out
  if (n == 0.0 || abs(n) > f32(C.levels) || a <= 0.0) { return vec4f(0.0); }
  let ink = select(C.neg, C.pos, n > 0.0);
  return vec4f(ink.rgb * a, a * ink.w);
}
