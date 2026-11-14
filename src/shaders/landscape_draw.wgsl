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
// The cells' field (step 4) is a third kind: the cells scatter their beats into a texture (cell_field.wgsl),
// read here at each dot centre, positive part only, times cellGain, in its own pale ink.
// Field B (step 5, channel g of the same texture) has its own screen on top, turned to another angle (as the
// separate colour screens of print), in its own ink: an open ring where B is positive, a filled dot where it is
// negative (the negative charges' field), the size again growing with the strength (bRing 0: filled dots only).
// Edges are anti-aliased over about one device pixel (distance measured in device px), nothing wider.
// The output is premultiplied and blended "over", so the flat colours stay flat on top of the soft background.
//
// Ring markers: a clean stroke (ringW CSS px) at the radius where the reference's sprite had its ring,
// 0.32 * R (5 + 1.6 amp) / 2, and a solid centre dot, in the kind's full ink, opacity 0.5 + 0.08 amp.
// Halftone dots that sit on the ring or the centre dot are left out whole, so the marker stands clear
// (a keyline, as in print) without cut-off half dots; the background still shows there.

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
};

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> D: DrawParams;
@group(0) @binding(2) var<storage, read> beats: array<Beat>;
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
  let x = in.pos.xy / D.dpr;       // CSS px, the world units of the field
  var res = vec4f(0.0);

  let o = medium.centre;                        // the halftone screen is anchored at the dish centre
  let c = rot(screen_point(rot(x - o, -D.angle), D.pitch), D.angle) + o;   // this screen cell's centre, in the world

  // ---- halftone dots ----
  if (D.gain > 0.0 || D.cellGain > 0.0) {
    var nut = 0.0;
    var thr = 0.0;
    for (var i = 0u; i < D.count; i++) {
      let b = beats[i];
      let v = 0.2 * b.amp * beat_envelope(b, c) * (D.base + (1.0 - D.base) * max(0.0, beat_sum(b, medium, c) / 3.0));
      if (b.kind == KIND_THR) { thr += v; } else { nut += v; }
    }
    nut *= D.gain;
    thr *= D.gain;
    var cel = 0.0;
    if (D.cellGain > 0.0) {
      let uv = c * D.fieldScale / vec2f(textureDimensions(cellTex));
      cel = max(0.0, textureSampleLevel(cellTex, cellSamp, uv, 0.0).r) * D.cellGain;
    }
    let s = max(max(nut, thr), cel);
    let cov = clamp((s - D.thresh) / max(1.0 - D.thresh, 1e-3), 0.0, 1.0);
    if (cov > 0.0) {
      let r = D.maxDot * 0.5 * D.pitch * sqrt(cov);
      let ink = select(select(D.nut, D.thr, thr > nut), D.cell, cel > max(nut, thr));
      res = vec4f(ink.rgb * ink.a, 1.0) * disc(length(x - c), r);
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

  // ---- ring markers: stroke + centre dot ----
  if (D.markers > 0.0) {
    for (var i = 0u; i < D.count; i++) {
      let b = beats[i];
      let half = 0.5 * D.R * (5.0 + 1.6 * b.amp);   // the reference's sprite size
      let d = length(x - b.pos);
      let rr = 0.32 * half;                          // ring radius
      let rc = 0.07 * half;                          // centre dot radius
      let ring = disc(abs(d - rr), 0.5 * D.ringW);
      let core = disc(d, rc);
      // keyline: whole dots whose centre lies within half a pitch of the ring or the centre dot are dropped
      let dc = length(c - b.pos);
      let kw = 0.5 * D.ringW + 0.5 * D.pitch;
      let key = select(0.0, 1.0, abs(dc - rr) < kw || dc < rc + 0.5 * D.pitch);
      let m = min(1.0, D.markers * (0.5 + 0.08 * b.amp));
      let ink = select(D.nut.rgb, D.thr.rgb, b.kind == KIND_THR);
      res *= 1.0 - key;
      res = over(vec4f(ink, 1.0) * max(ring, core) * m, res);
    }
  }
  return res;
}
