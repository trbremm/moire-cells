// ===== field_common.wgsl: the chemical field's maths, shared by every shader that draws or senses it =====
// Not compiled on its own: src/field.js prepends it to a shader's source (plain text concatenation), so the
// cells' beats (cell_common.wgsl) and their membrane sensing use identical maths.
// It declares no bindings; each shader binds its own buffers and passes the medium in as a value.
//
// Ported from the CPU reference (reference/neon_organoid_cpu.html: shape, prep, landscapeRows, sense).
// World units are CSS pixels.
//
// Every emitter (a cell; until step C3 also the nutrient and threat sources) carries a hex lattice: 3 wavevectors 60 degrees apart,
// turned by its angle `la`, with a period PER[kind] times the medium's period, squeezed by its own stretch.
// The medium has its own lattice, anchored at the dish centre, breathing by about 1 degree.
// An emitter's field is the slow beat of its lattice against the medium's:
//     field(x) = amp * envelope(x) * (1/3) * sum_m cos(q_m . (x - centre) + ph_m)
//     q_m = k_m - (matching medium wavevector),   ph_m = -k_m . (emitter - centre)
//     envelope = 1 / (1 + r^2 / r0^2)   (power law; r = distance to the emitter)

const P3: f32 = 1.0471975512;      // 60 degrees
const TAU: f32 = 6.2831853072;

// emitter kinds: since step F0 only one, the cells' (kinds 1..4 were the fates: epithelium, muscle, neuron, cartilage, each with its
// own lattice period; the reference's sources, 5 and 6, went in step C3)
const KIND_STEM: u32 = 0u;

// The medium's lattice. Written once per frame by src/field.js (Medium).
struct Medium {
  centre: vec2f,    // dish centre (CSS px); the medium lattice is anchored here
  k0: f32,          // medium wavenumber, 2 pi / (0.62 R)
  la0: f32,         // medium lattice angle; breathes as 0.02 sin(0.05 t)
};

// An emitter (filled in by cell_common.wgsl's cell_beat).
struct Emitter {
  pos: vec2f,       // centre (CSS px)
  la: f32,          // lattice angle (radians)
  amp: f32,         // strength
  r0sq: f32,        // envelope range squared (CSS px^2): cells 4.84 R^2 in the reference
  fa: f32,          // deformation matrix F = [[fa, fb], [fb, fd]] (area-preserving stretch); identity = 1, 0, 1
  fb: f32,
  fd: f32,
  kind: u32,        // KIND_*
  _pad: u32,
};

// What the field evaluation needs per emitter (make_beat).
struct Beat {
  q0: vec2f,        // beat wavevectors (emitter lattice minus medium lattice)
  q1: vec2f,
  q2: vec2f,
  pos: vec2f,       // emitter centre
  ph0: f32,         // phases (reduced to 0..2 pi)
  ph1: f32,
  ph2: f32,
  amp: f32,
  r0sq: f32,
  kind: u32,
};

// the medium's wavevector m (0..2)
fn medium_k(M: Medium, m: i32) -> vec2f {
  let a = M.la0 + f32(m) * P3;
  return M.k0 * vec2f(cos(a), sin(a));
}

// the emitter's wavevector m (0..2): k = F^-1 . k0 (stretching the cell squeezes its lattice the other way)
fn emitter_k(e: Emitter, M: Medium, m: i32) -> vec2f {
  let km = M.k0;   // (step F0: every emitter at the medium's period; the fates had their own, PER in the reference)
  let a = e.la + f32(m) * P3;
  let kx = km * cos(a);
  let ky = km * sin(a);
  return vec2f(e.fd * kx - e.fb * ky, -e.fb * kx + e.fa * ky);
}

// Beat of the emitter's lattice against the medium's (prep in the reference). Each emitter direction is paired
// with the nearest medium direction; pairing across the 180 degree wrap flips the medium vector's sign.
// Emitter direction m lies at about (m + s) x 60 degrees, so it pairs with medium direction m + s. (The reference
// and steps 2 to 4 used m - s: right for |angle| < 30 degrees, but beyond that every direction was paired with
// the wrong one, so the beat was fast, a period of about 0.6 medium periods: such an emitter was in effect silent.)
fn make_beat(e: Emitter, M: Medium) -> Beat {
  let s = i32(round((e.la - M.la0) / P3));
  var q: array<vec2f, 3>;
  var ph: array<f32, 3>;
  for (var m = 0; m < 3; m++) {
    var idx = m + s;
    let w = i32(floor(f32(idx) / 3.0));
    let sg = select(1.0, -1.0, (w & 1) != 0);
    idx -= 3 * w;
    let k = emitter_k(e, M, m);
    q[m] = k - sg * medium_k(M, idx);
    let p = -dot(k, e.pos - M.centre);
    ph[m] = p - TAU * floor(p / TAU);
  }
  var b: Beat;
  b.q0 = q[0]; b.q1 = q[1]; b.q2 = q[2];
  b.ph0 = ph[0]; b.ph1 = ph[1]; b.ph2 = ph[2];
  b.pos = e.pos;
  b.amp = e.amp;
  b.r0sq = e.r0sq;
  b.kind = e.kind;
  return b;
}

// power-law envelope, 1 at the emitter, 1/2 at distance r0
fn beat_envelope(b: Beat, x: vec2f) -> f32 {
  let d = x - b.pos;
  return 1.0 / (1.0 + dot(d, d) / b.r0sq);
}

// the hex interference pattern: sum of the three beat waves, between -1.5 and 3
fn beat_sum(b: Beat, M: Medium, x: vec2f) -> f32 {
  let w = x - M.centre;
  return cos(dot(b.q0, w) + b.ph0) + cos(dot(b.q1, w) + b.ph1) + cos(dot(b.q2, w) + b.ph2);
}

// the emitter's field value at x (what a membrane point feels before receptor tuning)
fn beat_field(b: Beat, M: Medium, x: vec2f) -> f32 {
  return b.amp * beat_envelope(b, x) * beat_sum(b, M, x) / 3.0;
}

// ===== end of field_common.wgsl =====
