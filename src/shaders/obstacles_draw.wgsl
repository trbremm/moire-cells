// Step G0b, OBSTACLES drawn (src/obstacles.js). A full-screen triangle under the cells, into the light buffer ("over"):
//   the solid parts   a dark, slightly cool fill (glass or PDMS seen from above: what lies under it is hidden) with a thin
//                     bright TUBE along its edge (neon look: an ice-blue line with a white-hot core, whose tight halo the neon
//                     pass adds; harmonic look: a faint grey rim, as a glass interface shows in a multiphoton image)
//   porous parts      (a filter insert: water and atoms pass, cells do not) a lighter fill dotted with pores, the edge a
//                     dashed pale-aqua tube
//   a preview         the rectangle or pillar being dragged out with the obstacle tool, as a thin dashed outline
// Both outlines come from the signed distance fields the CPU rasterised from the shapes (sdA: everything that stops cells,
// sdS: what stops water and matter), sampled bilinearly at the heat pixels' centres, so the edges are smooth at any zoom.

struct ODraw {
  hw: u32,
  hh: u32,
  sdA: u32,             // word offset in g of sdA (f32 bits per pixel, CSS px; < 0 inside)
  sdS: u32,             // ... of sdS
  px: f32,              // CSS px per heat pixel
  dpr: f32,             // device px per CSS px (x the zoom)
  harm: f32,            // 1: the harmonic look
  lw: f32,              // the tube's width (CSS px)
  cam: vec4f,           // the camera (xy pan)
  ink: vec4f,           // the solid edge's colour; w its brightness
  pink: vec4f,          // the porous edge's colour; w its brightness
  fill: vec4f,          // the solid fill's colour; w its opacity
  pfill: vec4f,         // the porous fill's colour; w its opacity
  prev: vec4f,          // the preview: x type (0 none, 1 rect, 2 circle, 3 capsule), y spare, zw spare
  pa: vec4f,            // rect: x0 y0 x1 y1; circle: x y r; capsule: x0 y0 x1 y1
  pb: vec4f,            // capsule: half width
  dish: vec4f,          // W, H (CSS px)
};

@group(0) @binding(0) var<uniform> D: ODraw;
@group(0) @binding(1) var<storage, read> g: array<i32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn sd_px(o: u32, x: i32, y: i32) -> f32 {
  let q = clamp(vec2i(x, y), vec2i(0), vec2i(i32(D.hw) - 1, i32(D.hh) - 1));
  return bitcast<f32>(g[o + u32(q.y) * D.hw + u32(q.x)]);
}
// bilinear at p (CSS px), the values sitting at the pixels' centres
fn sd_at(o: u32, p: vec2f) -> f32 {
  let gp = p / D.px - 0.5;
  let b = floor(gp);
  let t = gp - b;
  let i = vec2i(b);
  return mix(mix(sd_px(o, i.x, i.y), sd_px(o, i.x + 1, i.y), t.x), mix(sd_px(o, i.x, i.y + 1), sd_px(o, i.x + 1, i.y + 1), t.x), t.y);
}

fn prev_sd(p: vec2f) -> f32 {
  let k = u32(D.prev.x);
  if (k == 1u) {
    let c = 0.5 * (D.pa.xy + D.pa.zw);
    let h = 0.5 * abs(D.pa.zw - D.pa.xy);
    let q = abs(p - c) - h;
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
  }
  if (k == 2u) { return length(p - D.pa.xy) - D.pa.z; }
  if (k == 3u) {
    let ab = D.pa.zw - D.pa.xy;
    let t = clamp(dot(p - D.pa.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - D.pa.xy - t * ab) - D.pb.x;
  }
  return 1e9;
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let x = fc.xy / D.dpr + D.cam.xy;      // CSS px of the dish
  var col = vec3f(0.0);
  var a = 0.0;
  let inDish = x.x >= 0.0 && x.y >= 0.0 && x.x <= D.dish.x && x.y <= D.dish.y;
  if (inDish && D.sdA != 0u) {
    let dA = sd_at(D.sdA, x);
    let dS = sd_at(D.sdS, x);
    let devA = dA * D.dpr;               // device px from the edge (< 0 inside)
    let devS = dS * D.dpr;
    let inA = 1.0 - smoothstep(-0.6, 0.6, devA);
    let inS = 1.0 - smoothstep(-0.6, 0.6, devS);
    let por = max(inA - inS, 0.0);       // porous: stops cells, not water
    // the fills
    var fa = inS * D.fill.w;
    var fcol = D.fill.rgb * fa;
    if (por > 0.0) {
      // pores: a fine square lattice of dim dots (about 0.6 CSS px each, 2 px apart)
      let q = fract(x / 2.0) - 0.5;
      let dot_ = 1.0 - smoothstep(0.18, 0.32, length(q));
      let pa = por * D.pfill.w;
      fcol += pa * (D.pfill.rgb * (0.45 + 0.9 * dot_));
      fa += pa;
    }
    col += fcol;
    a += fa;
    // the edge tubes: a crisp line on the edge (lw CSS px) with a white-hot core in the neon look
    let lw = max(D.lw * D.dpr, 1.0);
    let eS = 1.0 - smoothstep(0.5 * lw - 0.5, 0.5 * lw + 0.5, abs(devS));
    let eA = 1.0 - smoothstep(0.5 * lw - 0.5, 0.5 * lw + 0.5, abs(devA));
    // the porous edge: where the cell-stopping edge is not also a solid one, dashed along its length
    let dash = step(0.5, fract((x.x + x.y) / 3.0));
    let ePor = eA * (1.0 - inS) * (1.0 - eS) * dash;
    let core = 1.0 - smoothstep(0.0, 0.6, abs(devS));
    var tube = D.ink.rgb * eS * D.ink.w;
    if (D.harm < 0.5) { tube += vec3f(1.0) * core * eS * 0.45 * D.ink.w; }
    col = col * (1.0 - eS * D.ink.w) + tube;
    a = max(a, eS * D.ink.w);
    col = col * (1.0 - ePor * D.pink.w) + D.pink.rgb * ePor * D.pink.w;
    a = max(a, ePor * D.pink.w);
  }
  // the preview of a rectangle or pillar being dragged out (a thin dashed line)
  if (D.prev.x > 0.5) {
    let dv = prev_sd(x) * D.dpr;
    let l = 1.0 - smoothstep(0.4, 1.4, abs(dv));
    let dash = step(0.5, fract((x.x - x.y) / 4.0));
    let v = l * dash * 0.8;
    col = col * (1.0 - v) + D.ink.rgb * v;
    a = max(a, v);
  }
  return vec4f(col, min(a, 1.0));
}
