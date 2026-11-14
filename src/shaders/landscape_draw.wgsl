// The sources' landscape, drawn per pixel and added over the background (additive blending).
// Needs field_common.wgsl in front of it (src/field.js does that).
//
// Same look as the CPU reference (landscapeRows + drawBackground + the source sprites), but per pixel
// instead of on the 5 px background grid:
//   glow   = 0.2 * amp * envelope * (0.3 + 0.7 * max(0, beat_sum / 3)), summed per kind, capped at 1.3,
//            nutrient adds (10, 38, 20) / 255 per unit, threat (50, 9, 16) / 255
//   marker = the reference's source sprite: a soft core and a thin ring, in the kind's colour,
//            size R (5 + 1.6 amp), opacity 0.5 + 0.08 amp

struct DrawParams {
  dpr: f32,         // device pixels per CSS pixel
  R: f32,           // cell radius of the reference (CSS px); sets the marker size
  count: u32,       // number of sources
  glow: f32,        // landscape glow gain (0 = landscape off)
  markers: f32,     // marker gain
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
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

fn kind_colour(kind: u32) -> vec3f {
  if (kind == KIND_THR) { return vec3f(255.0, 112.0, 98.0) / 255.0; }
  return vec3f(168.0, 240.0, 160.0) / 255.0;   // nutrient
}

fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let x = in.pos.xy / D.dpr;       // CSS px, the world units of the field
  var nut = 0.0;
  var thr = 0.0;
  var mark = vec3f(0.0);
  for (var i = 0u; i < D.count; i++) {
    let b = beats[i];
    if (D.glow > 0.0) {
      let v = 0.2 * b.amp * beat_envelope(b, x) * (0.3 + 0.7 * max(0.0, beat_sum(b, medium, x) / 3.0));
      if (b.kind == KIND_THR) { thr += v; } else { nut += v; }
    }
    let half = 0.5 * D.R * (5.0 + 1.6 * b.amp);
    let a = sprite_alpha(length(x - b.pos) / half) * min(1.0, 0.5 + 0.08 * b.amp);
    mark += kind_colour(b.kind) * a;
  }
  nut = min(nut * D.glow, 1.3);
  thr = min(thr * D.glow, 1.3);
  var c = (nut * vec3f(10.0, 38.0, 20.0) + thr * vec3f(50.0, 9.0, 16.0)) / 255.0 + D.markers * mark;
  // dither against banding in the soft gradients (only where something is drawn; the blend adds it)
  let lit = step(0.5 / 255.0, max(c.r, max(c.g, c.b)));
  c += lit * (hash(in.pos.xy + 17.0) - 0.5) / 255.0;
  return vec4f(max(c, vec3f(0.0)), 0.0);
}
