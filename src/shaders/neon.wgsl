// Step C6n: the neon look's post-processing (src/neon.js). Every entry draws one full-screen triangle.
//   fs_fade   the trails: outputs nothing; the pipeline's blend (dst x the blend constant) fades what the trail buffer
//             holds, before this frame's cells are drawn over it
//   fs_copy   the trail buffer (this frame's cells over their fading trails) copied "over" into the light buffer, between
//             the layers drawn under the cells and those drawn over them
//   fs_down   the halo's source at a lower resolution: the light, with the cells at full weight and the rest (substances,
//             field dots, spot) at `others`; 4 bilinear reads spread over the block of canvas pixels it stands for, each
//             through a soft knee (only bright light glows: the tubes, lamps and specks, not the dark insides or tints)
//   fs_blur   one direction of a separable Gaussian, with the linear-sampling trick (one bilinear read covers two taps)
//   fs_comp   the light composited onto the canvas (which holds the soft background): the sharp light as drawn, plus
//             the halos (k1 x the tight level, k2 x the wide one), with a soft shoulder above `shoulder` so a bright tube
//             saturates toward its own white-hot core instead of clipping in one channel. Premultiplied "over".

struct Down {
  srcTexel: vec2f,    // 1 / the source's size (texels)
  dstSize: vec2f,     // the target's size (texels)
  spread: f32,        // the 4 reads' offset from the block's centre, in source texels
  others: f32,        // share of the non-cell light in the halo (1 = all light alike)
  lo: f32,            // the knee: light dimmer than lo (its brightest channel) makes no halo, brighter than hi a full one,
  hi: f32,            // so flat dark areas (the cells' insides, the light's tint) do not haze over
};
struct Blur {
  dir: vec2f,         // one texel along the blur's direction, in uv
  n: u32,             // reads on each side (after the centre)
  _p: u32,
  w: array<vec4f, 3>, // weights: [0] the centre, [i] the pair at offset o[i] (both sides)
  o: array<vec4f, 3>, // offsets in texels
};
struct Comp {
  k1: f32,            // the tight halo's strength
  k2: f32,            // the wide halo's strength
  shoulder: f32,      // values above this roll off toward 1 (2 = no shoulder: the flat look as before)
  _p: f32,
};

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var texC: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> DN: Down;
@group(0) @binding(5) var<uniform> BL: Blur;
@group(0) @binding(6) var<uniform> CP: Comp;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return vec4f(f32((vi << 1u) & 2u) * 2.0 - 1.0, f32(vi & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_fade() -> @location(0) vec4f {
  return vec4f(0.0);
}

// texA = the trail buffer (same size as the target)
@fragment
fn fs_copy(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  return textureLoad(texA, vec2i(fc.xy), 0);
}

fn knee(c: vec4f) -> vec4f {
  let m = max(max(c.r, c.g), c.b);
  return c * smoothstep(DN.lo, DN.hi, m);
}

// texA = the light buffer (everything), texB = the trail buffer (the cells); the target's size is the halo level's
@fragment
fn fs_down(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / DN.dstSize;
  let s = DN.spread * DN.srcTexel;
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let o = vec2f(select(-1.0, 1.0, (k & 1) == 1), select(-1.0, 1.0, (k & 2) == 2)) * s;
    a += knee(textureSampleLevel(texA, samp, uv + o, 0.0));
    b += knee(textureSampleLevel(texB, samp, uv + o, 0.0));
  }
  return 0.25 * (b + DN.others * (a - b));
}

fn bw(i: u32) -> f32 { return BL.w[i / 4u][i % 4u]; }
fn bo(i: u32) -> f32 { return BL.o[i / 4u][i % 4u]; }

// texA = the source (same size as the target)
@fragment
fn fs_blur(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / vec2f(textureDimensions(texA));
  var acc = textureSampleLevel(texA, samp, uv, 0.0) * bw(0u);
  for (var i = 1u; i <= BL.n; i++) {
    let o = BL.dir * bo(i);
    acc += (textureSampleLevel(texA, samp, uv + o, 0.0) + textureSampleLevel(texA, samp, uv - o, 0.0)) * bw(i);
  }
  return acc;
}

fn shoulder(x: f32, s: f32) -> f32 {
  if (x <= s) { return x; }
  let r = 1.0 - s;
  return s + r * (1.0 - exp(-(x - s) / r));
}

// texA = the light buffer (canvas size), texB = the tight halo, texC = the wide halo
@fragment
fn fs_comp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let L = textureLoad(texA, vec2i(fc.xy), 0);
  let uv = fc.xy / vec2f(textureDimensions(texA));
  var rgb = L.rgb;
  if (CP.k1 > 0.0) { rgb += CP.k1 * textureSampleLevel(texB, samp, uv, 0.0).rgb; }
  if (CP.k2 > 0.0) { rgb += CP.k2 * textureSampleLevel(texC, samp, uv, 0.0).rgb; }
  if (CP.shoulder < 1.0) {
    rgb = vec3f(shoulder(rgb.r, CP.shoulder), shoulder(rgb.g, CP.shoulder), shoulder(rgb.b, CP.shoulder));
  }
  return vec4f(rgb, clamp(L.a, 0.0, 1.0));
}
