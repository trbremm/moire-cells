// The sources' landscape as crisp halftone dots, plus the sources' markers, drawn over the background.
// Needs field_common.wgsl in front of it (src/field.js does that).
//
// Halftone, as in print: a fixed screen of dot positions (a triangular / hex grid, or a square one) lies over
// the image. In each screen cell the field strength is read once, at the cell's centre, and a flat-coloured
// round dot is drawn there whose AREA grows with the strength (radius ~ sqrt). Weak field = no dot.
//   strength = the reference's glow quantity, 0.2 * amp * envelope * (base + (1 - base) * max(0, beat_sum / 3)),
//              summed per kind (nutrient, threat), times a gain
//   coverage = clamp((strength - threshold) / (1 - threshold), 0, 1);   dot radius = maxDot * pitch/2 * sqrt(coverage)
//   overlap  = one dot per screen cell: the stronger kind takes the cell, with its own colour and size
// Edges are anti-aliased over about one device pixel (distance measured in device px), nothing wider.
// The output is premultiplied and blended "over", so the flat colours stay flat on top of the soft background.
//
// marker = the reference's source sprite: a soft core and a thin ring, in the kind's colour,
//          size R (5 + 1.6 amp), opacity 0.5 + 0.08 amp (added: alpha 0 in premultiplied "over" is additive)

struct DrawParams {
  dpr: f32,         // device pixels per CSS pixel
  R: f32,           // cell radius of the reference (CSS px); sets the marker size
  count: u32,       // number of sources
  gain: f32,        // strength gain (0 = landscape off)
  markers: f32,     // marker gain (0 = no markers)
  pitch: f32,       // halftone screen pitch: distance between neighbouring dot centres (CSS px)
  angle: f32,       // screen rotation (radians)
  thresh: f32,      // strength below which there is no dot
  maxDot: f32,      // largest dot radius as a fraction of pitch/2 (1 = neighbours touch)
  hex: u32,         // 1 = triangular (hex) screen, 0 = square screen
  base: f32,        // share of the strength that does not follow the beat (reference 0.3)
  ringW: f32,       // ring stroke width (CSS px)
  nut: vec4f,       // nutrient ink: rgb, and the dots' level (dots are ink * level)
  thr: vec4f,       // threat ink
};

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> D: DrawParams;
@group(0) @binding(2) var<storage, read> beats: array<Beat>;

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
fn screen_point(u: vec2f) -> vec2f {
  let p = D.pitch;
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

// the reference's sprite gradient: opacity against radius (0 = centre, 1 = edge), piecewise linear
fn sprite_alpha(r: f32) -> f32 {
  if (r >= 1.0) { return 0.0; }
  if (r < 0.09) { return mix(0.55, 0.5, r / 0.09); }
  if (r < 0.13) { return mix(0.5, 0.2, (r - 0.09) / 0.04); }
  if (r < 0.27) { return mix(0.2, 0.24, (r - 0.13) / 0.14); }
  if (r < 0.32) { return mix(0.24, 0.7, (r - 0.27) / 0.05); }
  if (r < 0.37) { return mix(0.7, 0.16, (r - 0.32) / 0.05); }
  if (r < 0.6) { return mix(0.16, 0.045, (r - 0.37) / 0.23); }
  return mix(0.045, 0.0, (r - 0.6) / 0.4);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let x = in.pos.xy / D.dpr;       // CSS px, the world units of the field
  var res = vec4f(0.0);

  // ---- halftone dots ----
  if (D.gain > 0.0) {
    let o = medium.centre;                      // the screen is anchored at the dish centre
    let u = rot(x - o, -D.angle);
    let c = rot(screen_point(u), D.angle) + o;  // this screen cell's centre, in the world
    var nut = 0.0;
    var thr = 0.0;
    for (var i = 0u; i < D.count; i++) {
      let b = beats[i];
      let v = 0.2 * b.amp * beat_envelope(b, c) * (D.base + (1.0 - D.base) * max(0.0, beat_sum(b, medium, c) / 3.0));
      if (b.kind == KIND_THR) { thr += v; } else { nut += v; }
    }
    let s = max(nut, thr) * D.gain;
    let cov = clamp((s - D.thresh) / max(1.0 - D.thresh, 1e-3), 0.0, 1.0);
    if (cov > 0.0) {
      let r = D.maxDot * 0.5 * D.pitch * sqrt(cov);
      let ink = select(D.nut, D.thr, thr > nut);
      res = vec4f(ink.rgb * ink.a, 1.0) * disc(length(x - c), r);
    }
  }

  // ---- markers ----
  for (var i = 0u; i < D.count; i++) {
    let b = beats[i];
    let half = 0.5 * D.R * (5.0 + 1.6 * b.amp);
    let a = sprite_alpha(length(x - b.pos) / half) * min(1.0, 0.5 + 0.08 * b.amp) * D.markers;
    let ink = select(D.nut.rgb, D.thr.rgb, b.kind == KIND_THR);
    res = over(vec4f(ink * a, 0.0), res);
  }
  return res;
}
