// ===== cell_common.wgsl: the cells' state, the simulation uniforms and the neighbour grid =====
// Not compiled on its own: src/cells.js prepends field_common.wgsl and then this file to every cell shader.
//
// Cells live in a fixed-capacity storage buffer (struct Cell, 48 bytes; keep in step with CELL_* in
// src/cells.js). Their order never changes, so drawing order is stable and a cell keeps its index.
//
// Neighbour grid (rebuilt every tick, see cell_grid.wgsl):
//   counts[g]   cells in grid cell g                        (atomic counter, then plain counts)
//   starts[g]   first slot of grid cell g in the sorted list (exclusive prefix sum of counts)
//   sorted[j]   copy of the cells in grid order; sortIdx[j] = the cell's index in `cells`
// Grid cell g = gy * gw + gx covers [gx cs, (gx+1) cs) x [gy cs, (gy+1) cs) in CSS px; positions outside
// the screen are clamped into the border cells. With cs >= the largest interaction range, a cell's
// neighbours are all in the 3 x 3 block around its own grid cell (grid_range below).

struct Cell {
  pos: vec2f,       // centre (CSS px)
  vel: vec2f,       // velocity (CSS px / s)
  r: f32,           // radius (CSS px); relaxes toward Sim.R
  la: f32,          // lattice angle (radians); the cell's key angle (a copy of Bio.key.x)
  e1: f32,          // area-preserving stretch (traceless tensor [[e1, e2], [e2, -e1]]), length at most 0.5
  e2: f32,
  kind: u32,        // KIND_* from field_common.wgsl: its fate (stem, epithelium, muscle, neuron, cartilage)
  flags: u32,       // bit 0: alive (all alive for now; kept for division and death later)
  seed: u32,        // per-cell random seed
  aux: f32,         // the cell's key scale (log of its lattice period factor; a copy of Bio.key.y)
};

const CELL_ALIVE: u32 = 1u;

// Per-tick simulation uniforms (written by src/cells.js; keep the order in step with writeSim there).
struct Sim {
  count: u32,       // number of cells
  gw: u32,          // grid width and height (grid cells)
  gh: u32,
  tick: u32,        // tick counter (random numbers)
  cs: f32,          // grid cell size (CSS px)
  R: f32,           // the cells' target radius (CSS px)
  W: f32,           // dish size (CSS px)
  H: f32,
  centre: vec2f,    // dish centre
  dt: f32,          // tick length (s)
  stiffness: f32,   // contact push (1/s); 0 = off
  damping: f32,     // velocity kept per tick (0.85 = reference)
  jitter: f32,      // Brownian kick per tick, full width, in units of R
  pull: f32,        // gentle pull to the dish centre (1/s)
  wall: f32,        // soft wall stiffness (1/s)
  pointer: vec2f,   // stir position (CSS px)
  pvel: vec2f,      // stir velocity (CSS px / s); zero when not stirring
  stirR2: f32,      // stir reach squared (CSS px^2)
  stir: f32,        // stir gain
  drift: f32,       // slow drift of the medium, in units of R per s (0.5 = reference)
  time: f32,        // simulation time (s)
  rules: u32,       // RULE_* bits: which genome rules are on
  pad0: u32,
  pad1: u32,
  pad2: u32,
  tau: f32,         // accumulator time constant (s): brief bumps fade, only sustained input counts
  release: f32,     // a committed cell goes back to stem below release x threshold
  reach: f32,       // neighbours within reach x (r_i + r_j) count as touching (signals, adhesion)
  adhesion: f32,    // adhesion pull at full stickiness, as the contact push of an overlap of adhesion x R
  adhSigma: f32,    // how alike two keys must be to stick (width of the Gaussian in the key difference)
  fateAdh: f32,     // extra stickiness between cells of the same committed fate
  body: f32,        // 1 = body traits on (size and motility from the genome and the fate), 0 = all alike
  adhBase: f32,     // stickiness every pair loses: unlike neighbours (stick below this) push off a little
  crawl: f32,       // crawling speed, in units of R per s (times the motility factor)
  turnRate: f32,    // how fast a crawling cell's heading wanders (rad^2 / s)
  turnover: f32,    // deaths per cell per s (each dead cell is reborn as a neighbour's daughter)
  unhappy: f32,     // extra death rate for cells that recognise none of their neighbours (x turnover)
  mutSize: f32,     // size of the small mutations (1 = the steps in mutate())
  mutJump: f32,     // chance per birth that one gene jumps to a fresh random value
  nutFar: f32,      // share of births that go to well-fed cells anywhere in the dish (when any feel nutrient)
  thrKill: f32,     // death rate x (1 + thrKill x the threat a cell feels)
  srcCount: u32,    // sources in the Sources uniform (0 = nutrient and threat rule off)
  beatMix: f32,     // 1 = cells feel the sources' beat (the halftone rosettes), 0 = only the smooth envelope
  // ---- the loop (step 4): cells emit into the field and feel it on their membrane ----
  lever: f32,       // how different the cells' lattices are from the medium's (1 = the keys as they are;
                    // smaller = closer to the medium, so longer and slower beats)
  emit: f32,        // cells' emission strength (0 = cells do not emit)
  r0: f32,          // a cell's envelope range r0, in units of R (reference 2.2)
  cut: f32,         // how far a cell feels another's field, in units of R (reference 3.6)
  sense: f32,       // gain of the force from the field felt on the membrane (0 = off; 1 = reference)
  tuneW: f32,       // receptor tuning width: how alike two lattices must be to feel each other (reference 0.177)
  srcAmp: f32,      // strength of a fresh source (reference 5)
  senseMax: f32,    // the field force saturates at this speed, in units of R per s (reference 3)
  activeGain: f32,  // active deformation gain: stretch along the cell's motion and the field's pull (0 = off)
  shapeRate: f32,   // how fast the shape follows its target (1/s; reference 3)
  pad16: f32,
  pad17: f32,
  pad18: f32,
  pad19: f32,
  pad20: f32,
  pad21: f32,
  pad22: f32,
  pad23: f32,
};

// fate-typical body: size and motility factors per fate (stem, epithelium, muscle, neuron, cartilage)
fn fate_size(kind: u32) -> f32 {
  switch kind {
    case 1u: { return 0.95; }
    case 2u: { return 1.1; }
    case 3u: { return 0.85; }
    case 4u: { return 1.15; }
    default: { return 1.0; }
  }
}
fn fate_motility(kind: u32) -> f32 {
  switch kind {
    case 1u: { return 0.6; }
    case 2u: { return 0.8; }
    case 3u: { return 1.4; }
    case 4u: { return 0.4; }
    default: { return 1.0; }
  }
}

// ---------- the genome ----------
// Every cell carries a Bio record (96 bytes; keep in step with BIO_* in src/cells.js): its genome plus its
// small mutable state. Bio is double-buffered: each tick reads last tick's copy of every cell (bioPrev) and
// writes the new one (bioNext), so a newborn copies its parent's genome race-free.
//
// The KEY is the cell's own lattice: an angle (hex symmetry: modulo 60 degrees) and a period factor
// exp(keyS). Two keys are alike when their lattice wavevectors are close: key_dist2 below is the squared
// wavevector difference in units of the medium's wavenumber (as the reference's receptor tuning).
struct Bio {
  key: vec4f,       // x key angle (0..pi/3), y key scale (log period factor), z receptor angle, w receptor scale
  rec: vec4f,       // x receptor width (pickiness; small = picky), y threshold, z output once committed, w founder id (a whole number)
  resp: vec4f,      // per fate channel (epi, mus, neu, cho): how recognised contact feeds that channel (-1..1)
  relay: vec4f,     // per fate channel: how a committed neighbour's signal on that channel feeds it (-1..1)
  body: vec4f,      // x adhesion, y size factor, z motility factor, w spare
  acc: vec4f,       // state, not genes: the four leaky accumulators
  env: vec4f,       // state: x nutrient, y threat felt last tick (neighbours read it when picking a parent)
};

// The sources (nutrient, threat) for the cells: two vec4 per source, written by src/cells.js every frame:
// (x, y, lattice angle, strength relative to a fresh source), (envelope range squared, kind, 0, 0).
const MAX_CELL_SOURCES: u32 = 16u;
struct Sources {
  s: array<vec4f, 32>,
};

// What a cell at p feels from the sources: (nutrient, threat). The same beat as the landscape draws (the
// emitter's lattice against the medium's), positive part only, so cells feel the halftone rosettes.
fn feel_sources(S: Sim, src: Sources, med: Medium, p: vec2f) -> vec2f {
  var out = vec2f(0.0);
  for (var k = 0u; k < min(S.srcCount, MAX_CELL_SOURCES); k++) {
    let a = src.s[2u * k];
    let b = src.s[2u * k + 1u];
    var e: Emitter;
    e.pos = a.xy;
    e.la = a.z;
    e.amp = a.w;
    e.r0sq = b.x;
    e.fa = 1.0; e.fb = 0.0; e.fd = 1.0;
    e.kind = u32(b.y);
    e._pad = 0u;
    let bt = make_beat(e, med);
    let v = bt.amp * beat_envelope(bt, p) * max(0.0, mix(1.0, beat_sum(bt, med, p) / 3.0, S.beatMix));
    if (e.kind == KIND_THR) { out.y += v; } else { out.x += v; }
  }
  return out;
}

const KEY_SPAN: f32 = 1.0471975512;   // key angles live in [0, 60 degrees)
const KEY_SMAX: f32 = 0.15;           // key scales live in [-0.15, 0.15]

// rule bits in Sim.rules (keep in step with RULE in src/cells.js)
const RULE_DIFF: u32 = 1u;      // differentiation (contact signalling, accumulators, commitment)
const RULE_ADH: u32 = 2u;       // adhesion
const RULE_TURN: u32 = 4u;      // turnover
const RULE_MUT: u32 = 8u;       // mutation at birth
const RULE_INHERIT: u32 = 16u;  // a newborn keeps its parent's fate (else it starts as stem)
const RULE_NUT: u32 = 32u;      // nutrient and threat bias of turnover

// Counters the GPU keeps for the overlay (read back a few times a second; see src/cells.js).
// The census part (fate, bins, founders) is cleared and refilled by the census pass before each read-back.
const STATS_EVENTS: u32 = 64u;
const STATS_ABINS: u32 = 24u;          // key-space bins: 24 angles x 6 scales
const STATS_SBINS: u32 = 6u;
const STATS_FWORDS: u32 = 1632u;       // founder bitmap words (52 224 founders; ids wrap beyond)
struct Stats {
  fate: array<atomic<u32>, 8>,        // census: cells per fate (0..4)
  births: atomic<u32>,                // cumulative since the page started
  deaths: atomic<u32>,
  nEvents: atomic<u32>,               // births and deaths recorded in `events` since the last read-back
  pad: array<u32, 5>,
  events: array<vec4f, 64>,           // x, y, +1 birth / -1 death, 0
  bins: array<atomic<u32>, 144>,      // census: cells per key bin
  founders: array<atomic<u32>, 1632>, // census: bit set = that founder line still has cells
};

// standard normal random number (Box-Muller) from two uniform draws of stream (a, b)
fn gauss(a: u32, b: u32) -> f32 {
  let u1 = max(rand01(a, b * 2u), 1e-7);
  let u2 = rand01(a, b * 2u + 1u);
  return sqrt(-2.0 * log(u1)) * cos(TAU * u2);
}

// one gene nudged by a Gaussian step, kept in [lo, hi]; k numbers the gene in the random stream
fn nudge(v: f32, step: f32, lo: f32, hi: f32, seed: u32, k: u32) -> f32 {
  return clamp(v + step * gauss(seed, k), lo, hi);
}

// a daughter's genome: every gene nudged a little (size x the steps below), and with chance `jump` one gene
// drawn afresh over its whole range. The accumulators and heading are state, not genes: the caller sets them.
fn mutate(p: Bio, seed: u32, size: f32, jump: f32) -> Bio {
  var b = p;
  let ka = size * 0.03;     // key angles: about 2 degrees
  let ks = size * 0.012;    // key scales
  b.key.x = b.key.x + ka * gauss(seed, 1u);
  b.key.x -= KEY_SPAN * floor(b.key.x / KEY_SPAN);
  b.key.y = nudge(b.key.y, ks, -KEY_SMAX, KEY_SMAX, seed, 2u);
  b.key.z = b.key.z + ka * gauss(seed, 3u);
  b.key.z -= KEY_SPAN * floor(b.key.z / KEY_SPAN);
  b.key.w = nudge(b.key.w, ks, -KEY_SMAX, KEY_SMAX, seed, 4u);
  b.rec.x = clamp(b.rec.x * exp(size * 0.06 * gauss(seed, 5u)), 0.03, 0.4);
  b.rec.y = nudge(b.rec.y, size * 0.05, 0.2, 3.0, seed, 6u);
  b.rec.z = nudge(b.rec.z, size * 0.05, 0.0, 2.0, seed, 7u);
  for (var c = 0u; c < 4u; c++) {
    b.resp[c] = nudge(b.resp[c], size * 0.05, -1.0, 1.0, seed, 8u + c);
    b.relay[c] = nudge(b.relay[c], size * 0.05, -1.0, 1.0, seed, 12u + c);
  }
  b.body.x = nudge(b.body.x, size * 0.03, 0.0, 1.0, seed, 16u);
  b.body.y = nudge(b.body.y, size * 0.02, 0.8, 1.25, seed, 17u);
  b.body.z = clamp(b.body.z * exp(size * 0.06 * gauss(seed, 18u)), 0.3, 3.0);
  // the occasional big jump: one gene redrawn over its whole range
  if (rand01(seed, 101u) < jump) {
    let g = min(u32(rand01(seed, 102u) * 18.0), 17u);
    let u = rand01(seed, 103u);
    switch g {
      case 0u: { b.key.x = u * KEY_SPAN; }
      case 1u: { b.key.y = (2.0 * u - 1.0) * KEY_SMAX; }
      case 2u: { b.key.z = u * KEY_SPAN; }
      case 3u: { b.key.w = (2.0 * u - 1.0) * KEY_SMAX; }
      case 4u: { b.rec.x = 0.06 * pow(0.25 / 0.06, u); }
      case 5u: { b.rec.y = 0.6 + u; }
      case 6u: { b.rec.z = 0.4 + u; }
      case 7u, 8u, 9u, 10u: { b.resp[g - 7u] = 2.0 * u - 1.0; }
      case 11u, 12u, 13u, 14u: { b.relay[g - 11u] = 2.0 * u - 1.0; }
      case 15u: { b.body.x = u; }
      case 16u: { b.body.y = 0.85 + 0.3 * u; }
      default: { b.body.z = 0.5 * pow(4.0, u); }
    }
  }
  return b;
}

// squared wavevector difference between lattices (angle a, log scale s), in units of the medium's wavenumber
fn key_dist2(a1: f32, s1: f32, a2: f32, s2: f32) -> f32 {
  var da = a1 - a2;
  da -= KEY_SPAN * round(da / KEY_SPAN);      // nearest of the three hex directions
  let k1 = exp(-s1);
  let k2 = exp(-s2);
  return k1 * k1 + k2 * k2 - 2.0 * k1 * k2 * cos(da);
}

// deformation matrix F = [[fa, fb], [fb, fd]] from the stretch (shape() in the reference)
fn cell_F(c: Cell) -> vec3f {
  let eps = sqrt(c.e1 * c.e1 + c.e2 * c.e2);
  if (eps < 1e-4) { return vec3f(1.0, 0.0, 1.0); }
  let ch = cosh(eps);
  let sh = sinh(eps) / eps;
  return vec3f(ch + sh * c.e1, sh * c.e2, ch - sh * c.e1);
}

// ---------- the loop (step 4): emitting, sensing, deforming ----------
// EMW of the reference: how a cell of fate `fate` responds to the field of an emitter of kind `kind`
// (positive = moves toward the field's bright blobs, negative = away). Like fates attract, unlike repel a
// little; nutrient attracts, threat repels; neurons barely care.
fn emw(fate: u32, kind: u32) -> f32 {
  if (kind == KIND_NUT) {
    switch fate {
      case 0u: { return 1.0; }
      case 1u: { return 0.4; }
      case 2u: { return 0.3; }
      case 4u: { return 0.2; }
      default: { return 0.0; }
    }
  }
  if (kind == KIND_THR) { return select(-1.2, -0.5, fate == KIND_NEU); }
  if (fate == KIND_NEU) { return -0.1; }
  if (fate == kind) { return select(0.5, 0.15, fate == KIND_STEM); }
  return -0.15;
}

// squared distance between two hex lattices given by their 3 wavevectors: each wavevector of a is paired with
// the nearest of b's (either sign, as the hex lattice is symmetric), and the squared differences summed
fn lattice_dist2(a0: vec2f, a1: vec2f, a2: vec2f, b0: vec2f, b1: vec2f, b2: vec2f) -> f32 {
  let a = array<vec2f, 3>(a0, a1, a2);
  let b = array<vec2f, 3>(b0, b1, b2);
  var sum = 0.0;
  for (var m = 0; m < 3; m++) {
    var best = 1e30;
    for (var n = 0; n < 3; n++) {
      let dm = a[m] - b[n];
      let dp = a[m] + b[n];
      best = min(best, min(dot(dm, dm), dot(dp, dp)));
    }
    sum += best;
  }
  return sum;
}

// receptor tuning (tune() in the reference): 1 for identical lattices, a Gaussian in the wavevector difference
fn tuning(dist2: f32, k0: f32, w: f32) -> f32 {
  return exp(-dist2 / (6.0 * w * w * k0 * k0));
}

// A cell's membrane: 6 straight segments of its (stretched) outline. mid = segment midpoint relative to the
// cell's centre; edge = the segment as a vector, going round in increasing angle, so (edge.y, -edge.x) is the
// outward normal times the segment's length.
struct Membrane {
  mid: array<vec2f, 6>,
  edge: array<vec2f, 6>,
};

fn membrane(c: Cell) -> Membrane {
  let F = cell_F(c);
  var P: array<vec2f, 6>;
  for (var a = 0; a < 6; a++) {
    let t = f32(a) * P3;
    let u = vec2f(cos(t), sin(t));
    P[a] = c.r * vec2f(F.x * u.x + F.y * u.y, F.y * u.x + F.z * u.y);
  }
  var mb: Membrane;
  for (var a = 0; a < 6; a++) {
    let nx = P[(a + 1) % 6];
    mb.mid[a] = 0.5 * (P[a] + nx);
    mb.edge[a] = nx - P[a];
  }
  return mb;
}

// Adds an emitter's field, averaged exactly along each membrane segment, to seg[0..6) (sense() in the reference).
// The field is w * (1/3) sum_m cos(q_m . (x - epos) + ph_m) / (1 + |x - epos|^2 / r0sq); rel = cell centre - epos.
// Along a straight segment, the mean of cos(q . x + p) is cos at the midpoint times sinc(q . edge / 2); the
// envelope is taken at the midpoint.
fn sense_field(seg: ptr<function, array<f32, 6>>, mb: Membrane, rel: vec2f, q0: vec2f, q1: vec2f, q2: vec2f,
               ph: vec3f, r0sq: f32, w: f32) {
  let q = array<vec2f, 3>(q0, q1, q2);
  var env: array<f32, 6>;
  for (var a = 0; a < 6; a++) {
    let x = rel + mb.mid[a];
    env[a] = w / (3.0 * (1.0 + dot(x, x) / r0sq));
  }
  for (var m = 0; m < 3; m++) {
    let base = dot(q[m], rel) + ph[m];
    for (var a = 0; a < 6; a++) {
      let X = 0.5 * dot(q[m], mb.edge[a]);
      let sinc = select(sin(X) / X, 1.0, abs(X) < 1e-4);
      (*seg)[a] += env[a] * cos(dot(q[m], mb.mid[a]) + base) * sinc;
    }
  }
}

// ---------- the cell as an emitter ----------
// The lattice a cell emits with: its key (angle, log period factor) plus its fate's period, with the
// difference from the medium's lattice scaled by the lever (Sim.lever). Returns (angle, log period factor).
fn cell_lattice(c: Cell, lever: f32) -> vec2f {
  let base = P3 * round(c.la / P3);            // the nearest of the medium's hex directions (0 or 60 degrees)
  return vec2f(base + lever * (c.la - base), lever * (c.aux + log(kind_period(c.kind))));
}

// A cell's beat, computed once per tick (cell_grid.wgsl, scatter) for everyone who senses or draws it (80 bytes;
// keep in step with CELL_BEAT_BYTES in src/cells.js). The phases are taken at the cell's own centre, so the
// field near it is  amp * envelope * (1/3) sum_m cos(q_m . (x - pos) + ph_m)  with small cosine arguments.
struct CellBeat {
  q01: vec4f,       // beat wavevectors q0 (xy) and q1 (zw)
  q2p: vec4f,       // q2 (xy), the cell's centre (zw)
  k01: vec4f,       // the cell's own (strained) lattice wavevectors k0 (xy) and k1 (zw), for receptor tuning
  k2a: vec4f,       // k2 (xy), strength (z; 0 = not emitting), envelope range squared (w)
  ph: vec3f,        // phases at the cell's centre
  idx: u32,         // the cell's index in `cells` (a copy of sortIdx, so the step pass needs one buffer less)
};

// The cell as a field emitter: strength min(1, r/R) (times Sim.emit), range r0 = Sim.r0 x R. Its lattice is
// strained by the cell's stretch (k = F^-1 . k0) and scaled by its period factor p; emitter_k does
// k = adj(F) . k0 / kind_period, so p goes in as F / p (with kind = stem, period 1).
fn cell_beat(c: Cell, S: Sim, M: Medium) -> CellBeat {
  let lat = cell_lattice(c, S.lever);
  let F = cell_F(c) * exp(-lat.y);
  var e: Emitter;
  e.pos = c.pos;
  e.la = lat.x;
  e.amp = S.emit * min(1.0, c.r / S.R);
  e.r0sq = (S.r0 * S.R) * (S.r0 * S.R);
  e.fa = F.x; e.fb = F.y; e.fd = F.z;
  e.kind = KIND_STEM;
  e._pad = 0u;
  let b = make_beat(e, M);
  let o = c.pos - M.centre;
  var cb: CellBeat;
  cb.q01 = vec4f(b.q0, b.q1);
  cb.q2p = vec4f(b.q2, c.pos);
  cb.k01 = vec4f(emitter_k(e, M, 0), emitter_k(e, M, 1));
  cb.k2a = vec4f(emitter_k(e, M, 2), e.amp, e.r0sq);
  let ph = vec3f(b.ph0 + dot(b.q0, o), b.ph1 + dot(b.q1, o), b.ph2 + dot(b.q2, o));
  cb.ph = ph - TAU * floor(ph / TAU);
  cb.idx = 0u;
  return cb;
}

// the field's taper near the cut-off: 1 out to 0.7 x cutR, then smoothly down to 0 at cutR, so a neighbour
// crossing the cut-off fades in and out instead of popping (the reference cut it off hard)
fn cut_taper(d2: f32, cutR: f32) -> f32 {
  return 1.0 - smoothstep(0.7 * cutR, cutR, sqrt(d2));
}

// a cell's field at x, before receptor tuning
fn cell_field(b: CellBeat, x: vec2f, cutR: f32) -> f32 {
  let d = x - b.q2p.zw;
  let d2 = dot(d, d);
  let s = cos(dot(b.q01.xy, d) + b.ph.x) + cos(dot(b.q01.zw, d) + b.ph.y) + cos(dot(b.q2p.xy, d) + b.ph.z);
  return b.k2a.z * s / (3.0 * (1.0 + d2 / b.k2a.w)) * cut_taper(d2, cutR);
}

// grid cell (x, y) of a position, clamped into the grid
fn grid_xy(S: Sim, p: vec2f) -> vec2i {
  let g = vec2i(floor(p / S.cs));
  return clamp(g, vec2i(0), vec2i(i32(S.gw) - 1, i32(S.gh) - 1));
}

fn grid_index(S: Sim, g: vec2i) -> u32 {
  return u32(g.y) * S.gw + u32(g.x);
}

// the 3 x 3 block of grid cells around g, clipped to the grid: min corner in .xy, max corner in .zw
fn grid_range(S: Sim, g: vec2i) -> vec4i {
  let lo = max(g - vec2i(1), vec2i(0));
  let hi = min(g + vec2i(1), vec2i(i32(S.gw) - 1, i32(S.gh) - 1));
  return vec4i(lo, hi);
}

// small fast hash -> uniform random in [0, 1)
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand01(a: u32, b: u32) -> f32 {
  return f32(pcg(a ^ pcg(b)) >> 8u) / 16777216.0;
}

// ===== end of cell_common.wgsl =====
