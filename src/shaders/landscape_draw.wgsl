// The cells' fields as crisp halftone dots, drawn over the background. Needs field_common.wgsl in front of it
// (src/field.js does that).
//
// Halftone, as in print: a fixed screen of dot positions (a triangular / hex grid, or a square one) lies over
// the image. In each screen cell the field strength is read once, at the cell's centre, and a flat-coloured
// round dot is drawn there whose AREA grows with the strength (radius ~ sqrt). Weak field = no dot.
//   coverage = clamp((strength - threshold) / (1 - threshold), 0, 1);   dot radius = maxDot * pitch/2 * sqrt(coverage)
// The cells' field A (step 4): the cells scatter their beats into a texture (cell_field.wgsl), read here at each dot
// centre, positive part only, times cellGain, in its own pale ink.
// Field B (step 5, channel g of the same texture) has its own screen on top, turned to another angle (as the
// separate colour screens of print), in its own ink: an open ring where B is positive, a filled dot where it is
// negative (the negative charges' field), the size again growing with the strength (bRing 0: filled dots only).
// The partner A' of the cells' field A (step 8, channel b) has a third screen, turned again, in its own ink: filled
// dots on its positive part, as field A's. Where a wave travels, A' sits a quarter period ahead of A, so the order
// of the two inks shows the direction of travel.
// (Until step C3 this shader also drew the nutrient and threat sources' landscape and their ring markers; the dish's
// substances are now drawn by matter_draw.wgsl.)
// Edges are anti-aliased over about one device pixel (distance measured in device px), nothing wider.
// The output is premultiplied and blended "over", so the flat colours stay flat on top of the soft background.

struct DrawParams {
  dpr: f32,         // device pixels per CSS pixel
  R: f32,           // cell radius of the reference (CSS px)
  _s0: u32,         // (spare: the sources' count, gain and marker gain until step C3)
  panX: f32,        // app: the camera's pan (dpr above is already x its zoom)
  panY: f32,
  pitch: f32,       // halftone screen pitch: distance between neighbouring dot centres (CSS px)
  angle: f32,       // screen rotation (radians)
  thresh: f32,      // strength below which there is no dot
  maxDot: f32,      // largest dot radius as a fraction of pitch/2 (1 = neighbours touch)
  hex: u32,         // 1 = triangular (hex) screen, 0 = square screen
  _s3: f32,         // (spare: the sources' base glow and marker stroke until step C3)
  _s4: f32,
  _s5: vec4f,       // (spare: the nutrient and threat inks until step C3)
  _s6: vec4f,
  cell: vec4f,      // the cells' field ink
  cellGain: f32,    // the cells' field strength gain (0 = not drawn)
  fieldScale: f32,  // texels per CSS px of the cells' field texture
  _p0: f32,
  _p1: f32,
  bInk: vec4f,      // field B's ink: rgb, and its level
  bGain: f32,       // field B's strength gain (0 = not drawn)
  bAngle: f32,      // field B's screen rotation (radians)
  bPitch: f32,      // field B's screen pitch (CSS px)
  bMaxDot: f32,     // field B's largest dot radius as a fraction of bPitch/2
  bRing: f32,       // stroke of B's open rings (positive field), CSS px; 0 = filled dots
  bThresh: f32,     // field B's strength below which there is no dot
  _p3: f32,
  _p4: f32,
  pInk: vec4f,      // step 8, the partner A' of the cells' field A: its ink (rgb) and level
  pGain: f32,       // its strength gain (0 = not drawn)
  pAngle: f32,      // its screen rotation (radians)
  pPitch: f32,      // its screen pitch (CSS px)
  pThresh: f32,     // its strength below which there is no dot
};

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> D: DrawParams;
@group(0) @binding(3) var cellTex: texture_2d<f32>;
@group(0) @binding(4) var cellSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  var o: VSOut;
  o.pos = vec4f(x, y, 0.0, 1.0);
  return o;
}

fn rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// nearest screen point to u (screen frame, CSS px). The hex grid is the union of two rectangular grids
// (p by p*sqrt3), the second shifted by half a cell; the nearer of the two candidates is the nearest point.
fn screen_point(u: vec2f, p: f32) -> vec2f {
  if (D.hex == 0u) { return round(u / p) * p; }
  let cell = vec2f(p, p * 1.7320508);
  let a = round(u / cell) * cell;
  let b = (round(u / cell - 0.5) + 0.5) * cell;
  return select(b, a, dot(u - a, u - a) <= dot(u - b, u - b));
}

// anti-aliased coverage of a disc of radius r (CSS px) at distance d (CSS px): a ramp one device pixel wide
fn disc(d: f32, r: f32) -> f32 {
  return clamp((r - d) * D.dpr + 0.5, 0.0, 1.0);
}

// premultiplied "over"
fn over(top: vec4f, under: vec4f) -> vec4f {
  return top + under * (1.0 - top.a);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let x = in.pos.xy / D.dpr + vec2f(D.panX, D.panY);   // CSS px, the world units of the field (app: through the camera)
  var res = vec4f(0.0);

  let o = medium.centre;                        // the halftone screen is anchored at the dish centre
  let c = rot(screen_point(rot(x - o, -D.angle), D.pitch), D.angle) + o;   // this screen cell's centre, in the world

  // ---- field A's halftone dots ----
  if (D.cellGain > 0.0) {
    let uv = c * D.fieldScale / vec2f(textureDimensions(cellTex));
    let cel = max(0.0, textureSampleLevel(cellTex, cellSamp, uv, 0.0).r) * D.cellGain;
    let cov = clamp((cel - D.thresh) / max(1.0 - D.thresh, 1e-3), 0.0, 1.0);
    if (cov > 0.0) {
      let r = D.maxDot * 0.5 * D.pitch * sqrt(cov);
      res = vec4f(D.cell.rgb * D.cell.a, 1.0) * disc(length(x - c), r);
    }
  }

  // ---- the partner A' (step 8): its own screen, over A's dots ----
  if (D.pGain > 0.0) {
    let cp = rot(screen_point(rot(x - o, -D.pAngle), D.pPitch), D.pAngle) + o;
    let uv = cp * D.fieldScale / vec2f(textureDimensions(cellTex));
    let v = textureSampleLevel(cellTex, cellSamp, uv, 0.0).b * D.pGain;
    let cov = clamp((v - D.pThresh) / max(1.0 - D.pThresh, 1e-3), 0.0, 1.0);
    if (cov > 0.0) {
      let r = D.maxDot * 0.5 * D.pPitch * sqrt(cov);
      res = over(vec4f(D.pInk.rgb * D.pInk.a, 1.0) * disc(length(x - cp), r), res);
    }
  }

  // ---- field B: its own screen, on top ----
  if (D.bGain > 0.0) {
    let cb = rot(screen_point(rot(x - o, -D.bAngle), D.bPitch), D.bAngle) + o;
    let uv = cb * D.fieldScale / vec2f(textureDimensions(cellTex));
    let v = textureSampleLevel(cellTex, cellSamp, uv, 0.0).g * D.bGain;
    let cov = clamp((abs(v) - D.bThresh) / max(1.0 - D.bThresh, 1e-3), 0.0, 1.0);
    if (cov > 0.0) {
      let r = D.bMaxDot * 0.5 * D.bPitch * sqrt(cov);
      let d = length(x - cb);
      // positive: an open ring (light ink, so the black stays); negative: a filled dot
      var a = disc(abs(d - r), 0.5 * D.bRing);
      if (v < 0.0 || D.bRing <= 0.0) { a = disc(d, r); }
      res = over(vec4f(D.bInk.rgb * D.bInk.a, 1.0) * a, res);
    }
  }

  return res;
}
