// Matter (Part C, step C3): the dish's substances as crisp halftone dots ON THE MEDIUM LATTICE, and the springs'
// markers. field_common.wgsl is prepended (src/matter.js), for the medium's lattice.
//
// The dot screen is the medium's own lattice (its spacing a = 2 / sqrt 3 x the medium's period, turned with it as it
// breathes), every `step` lattice spacings. A triangular lattice has three interleaved sets of points: the lattice
// points and the centres of its two kinds of triangles. Each set carries one layer, so the layers never sit on each
// other:
//   lattice points       FREE ATOMS: a flat dot whose area grows with the amount (c / (c + half)), its ink from the
//                        mix there: reactive atoms (givers, takers) red, linkers dim grey-blue; lighter for row 1,
//                        deeper for row 2
//   up triangles         FUELS (made by the chemistry from C4 on): green dots, lighter for the light fuels
//   down triangles       TRACE: small pale diamonds
//   everywhere           SEDIMENT (C4 on): not dots but a flat, dim layer in three crisp levels, under the dots
// With Shift+S showing one substance alone, src/matter.js paints only that one into the textures, so the same code draws it.
// Amounts come from two small textures at the heat grid's size (matter.wgsl's paint), read with linear filtering at
// each dot's centre (one read per dot, as print reads the image once per screen cell).
// Spring markers: a crisp ring in the spring's ink (thicker for a heavy spring) and a centre dot that shrinks as the
// spring dries up; dots touching the ring or the centre dot are left out whole (a keyline, as the old source markers).
// Edges are anti-aliased over about one device pixel; the output is premultiplied, blended "over".

struct DrawP {
  dpr: f32,
  step: f32,          // dot spacing, in medium lattice spacings
  maxDot: f32,        // largest dot radius as a share of half the distance between two layers' neighbouring dots
  half: f32,          // amount per R^2 at which a dot covers half its largest area
  gridPx: f32,        // CSS px per grid pixel
  gw: f32,            // grid size (pixels)
  gh: f32,
  thresh: f32,        // coverage below which there is no dot
  nSprings: u32,
  sedStep: f32,       // sediment: amount per R^2 per flat level
  sedAlpha: f32,      // sediment: opacity of the top level
  ringR: f32,         // spring marker radius (CSS px)
  level: f32,         // the inks' brightness
  traceDot: f32,      // trace diamonds' size, as a share of a full dot
  _p0: f32,
  _p1: f32,
  reactL: vec4f,      // inks: reactive free atoms (row 1, row 2), linkers, fuels, sediment, trace
  reactH: vec4f,
  linkL: vec4f,
  linkH: vec4f,
  fuelL: vec4f,
  fuelH: vec4f,
  sedL: vec4f,
  sedH: vec4f,
  trace: vec4f,
  _p2: vec4f,
};

struct Spring {
  pos: vec4f,         // x, y (CSS px), radius of its disc (CSS px), share of its life left
  amt: array<vec4f, 4>,
  ink: vec4f,         // rgb, ring stroke (CSS px)
};
struct Springs { s: array<Spring, 16>, };

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> D: DrawP;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<uniform> SP: Springs;

struct VSOut { @builtin(position) pos: vec4f, };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(f32((vi << 1u) & 2u) * 2.0 - 1.0, f32(vi & 2u) * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// nearest point of the triangular lattice of spacing p (rows along x) to u: the union of two rectangular grids
fn tri_point(u: vec2f, p: f32) -> vec2f {
  let cell = vec2f(p, p * 1.7320508);
  let a = round(u / cell) * cell;
  let b = (round(u / cell - 0.5) + 0.5) * cell;
  return select(b, a, dot(u - a, u - a) <= dot(u - b, u - b));
}

fn disc(d: f32, r: f32) -> f32 { return clamp((r - d) * D.dpr + 0.5, 0.0, 1.0); }
fn over(top: vec4f, under: vec4f) -> vec4f { return top + under * (1.0 - top.a); }
fn uv_of(w: vec2f) -> vec2f { return w / (D.gridPx * vec2f(D.gw, D.gh)); }
fn cover(c: f32) -> f32 {
  let k = c / (c + D.half);
  return select(0.0, k, k >= D.thresh);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let x = in.pos.xy / D.dpr;                         // CSS px
  // sediment: a flat layer in three crisp levels (anti-aliased by the screen-space slope of the level)
  let sed = textureSampleLevel(texB, samp, uv_of(x), 0.0);
  let lv = sed.z / D.sedStep;
  let fw = max(fwidth(lv), 1e-4);
  let steps = clamp((lv - 1.0) / fw + 0.5, 0.0, 1.0) + clamp((lv - 2.0) / fw + 0.5, 0.0, 1.0) + clamp((lv - 3.0) / fw + 0.5, 0.0, 1.0);
  var res = vec4f(0.0);
  if (steps > 0.0) {
    let ink = mix(D.sedL.rgb, D.sedH.rgb, clamp(sed.w / max(sed.z, 1e-6), 0.0, 1.0));
    let al = D.sedAlpha * steps / 3.0;
    res = vec4f(ink * al, al);
  }

  // the medium's lattice: spacing 2 / sqrt 3 x its period, rows along la0 + 30 degrees
  let p = D.step * 2.0 * (TAU / medium.k0) / 1.7320508;
  let ang = medium.la0 + 0.5 * P3;
  let o = medium.centre;
  let u = rot(x - o, -ang);
  let rmax = D.maxDot * 0.5 * p / 1.7320508;          // half the distance between neighbouring dots of two layers
  let offB = vec2f(0.5 * p, 0.5 * p / 1.7320508);     // centre of an up triangle
  let offC = vec2f(0.0, p / 1.7320508);               // centre of a down triangle
  let cA = tri_point(u, p);
  let cB = tri_point(u - offB, p) + offB;
  let cC = tri_point(u - offC, p) + offC;
  let wA = rot(cA, ang) + o;
  let wB = rot(cB, ang) + o;
  let wC = rot(cC, ang) + o;

  // keyline: dots whose centre lies on a spring's ring or centre dot are dropped whole
  var keyA = false;
  var keyB = false;
  var keyC = false;
  var mark = vec4f(0.0);
  for (var k = 0u; k < D.nSprings; k++) {
    let s = SP.s[k];
    let rr = D.ringR;
    let rc = 0.32 * rr * sqrt(clamp(s.pos.w, 0.0, 1.0)) + 0.6;
    let kw = 0.5 * s.ink.w + rmax + 1.0;
    let dA = length(wA - s.pos.xy);
    let dB = length(wB - s.pos.xy);
    let dC = length(wC - s.pos.xy);
    keyA = keyA || abs(dA - rr) < kw || dA < rc + rmax + 1.0;
    keyB = keyB || abs(dB - rr) < kw || dB < rc + rmax + 1.0;
    keyC = keyC || abs(dC - rr) < kw || dC < rc + rmax + 1.0;
    let d = length(x - s.pos.xy);
    let a = max(disc(abs(d - rr), 0.5 * s.ink.w), disc(d, rc));
    mark = over(vec4f(s.ink.rgb, 1.0) * a, mark);
  }

  // free atoms on the lattice points
  if (!keyA) {
    let v = textureSampleLevel(texA, samp, uv_of(wA), 0.0);
    let cov = cover(v.x);
    if (cov > 0.0) {
      let rs = clamp(v.y / v.x, 0.0, 1.0);             // reactive share
      let hs = clamp(v.z / v.x, 0.0, 1.0);             // heavy share
      let ink = mix(mix(D.linkL.rgb, D.linkH.rgb, hs), mix(D.reactL.rgb, D.reactH.rgb, hs), rs) * D.level;
      res = over(vec4f(ink, 1.0) * disc(length(u - cA), rmax * sqrt(cov)), res);
    }
  }
  // fuels on the up triangles' centres
  if (!keyB) {
    let v = textureSampleLevel(texB, samp, uv_of(wB), 0.0);
    let cov = cover(v.x);
    if (cov > 0.0) {
      let ink = mix(D.fuelL.rgb, D.fuelH.rgb, clamp(v.y / v.x, 0.0, 1.0)) * D.level;
      res = over(vec4f(ink, 1.0) * disc(length(u - cB), rmax * sqrt(cov)), res);
    }
  }
  // trace on the down triangles' centres: small diamonds
  if (!keyC) {
    let v = textureSampleLevel(texA, samp, uv_of(wC), 0.0);
    let cov = cover(v.w);
    if (cov > 0.0) {
      let q = abs(u - cC);
      let r = D.traceDot * rmax * 1.25 * sqrt(cov);
      res = over(vec4f(D.trace.rgb * D.level, 1.0) * disc((q.x + q.y) * 0.7071, r * 0.7071), res);
    }
  }
  return over(mark, res);
}
