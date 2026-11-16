// Step H1: the harmonic look's last pass (src/harmonic.js): the light buffer (every layer, drawn in the harmonic look: the
// three channels added on black) onto the canvas as a scanned microscope image. One full-screen triangle.
//   blur    a slight softness: the sharp picture mixed with a 3 x 3 tent (four bilinear reads half a pixel off centre), as a
//           point-scanned image is a little soft at the pixel scale. Sharp, not glowing: nothing spreads beyond a pixel
//   grain   photon noise per channel, as each detector counts its own photons: a bright pixel's noise grows with the square
//           root of its signal, plus a faint dark noise on the black. The pattern changes `rate` times a second (a live
//           scan), fixed while paused
//   shoulder  bright light rolls off toward white instead of clipping in one channel, so green over orange goes yellow
//           and three channels together go white, as overlapping detector channels do
// The canvas was cleared to black (no ripples under the harmonic look); the output is opaque.

struct Post {
  blur: f32,        // share of the tent-blurred picture (0 = sharp)
  grain: f32,       // photon noise: its size at a full signal (it grows with sqrt(signal))
  dark: f32,        // dark noise on the black (0 = none)
  seed: f32,        // the grain's pattern (a new one `rate` times a second)
  gain: f32,        // the picture's brightness
  shoulder: f32,    // values above this roll off toward 1
  texel: vec2f,     // 1 / the light buffer's size
};

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> P: Post;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return vec4f(f32((vi << 1u) & 2u) * 2.0 - 1.0, f32(vi & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

fn hash3(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

fn shoulder(x: f32, s: f32) -> f32 {
  if (x <= s) { return x; }
  let r = 1.0 - s;
  return s + r * (1.0 - exp(-(x - s) / r));
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let L = textureLoad(texA, vec2i(fc.xy), 0);
  var rgb = L.rgb;
  if (P.blur > 0.0) {
    let uv = fc.xy * P.texel;
    let o = 0.5 * P.texel;
    let b = 0.25 * (textureSampleLevel(texA, samp, uv + vec2f(o.x, o.y), 0.0) + textureSampleLevel(texA, samp, uv + vec2f(-o.x, o.y), 0.0) +
                    textureSampleLevel(texA, samp, uv + vec2f(o.x, -o.y), 0.0) + textureSampleLevel(texA, samp, uv + vec2f(-o.x, -o.y), 0.0));
    rgb = mix(rgb, b.rgb, P.blur);
  }
  rgb = max(rgb * P.gain, vec3f(0.0));
  if (P.grain > 0.0 || P.dark > 0.0) {
    // about Gaussian: the sum of two uniform draws, per channel (each detector its own photons)
    let h = hash3(vec3f(fc.xy, P.seed)) + hash3(vec3f(fc.yx + 17.0, P.seed + 3.1)) - 1.0;
    rgb = max(rgb + h * (P.grain * sqrt(rgb) + P.dark), vec3f(0.0));
  }
  rgb = vec3f(shoulder(rgb.r, P.shoulder), shoulder(rgb.g, P.shoulder), shoulder(rgb.b, P.shoulder));
  return vec4f(rgb, 1.0);
}
