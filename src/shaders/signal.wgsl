// ===== signal.wgsl: step Q1, A SIGNAL SUBSTANCE (src/signals.js; README "Step Q1: a signal substance") =====
// heat_common.wgsl is prepended (src/signals.js). The signal lives on the heat grid, in the heat buffer (blocks behind the water's, two
// copies, ping-pong as the heat; the copy current at every tick's start is copy 0, as the number of substeps per tick is even):
//   channel 0  A   its ENERGY (heat counts, whole numbers): what the cells paid from their batteries (or the pipette brought in); it spreads,
//                  rides the water and FADES: a share per tick becomes heat where it is (booked: LG_SIG_DECAY)
//   channel 1  X   its FLAVOUR vector, x and y (XY_SCALE counts per heat count of A, x cos / sin of the flavour angle): carries no energy,
//   channel 2  Y   only the meaning; signals of different flavours add as vectors and partly cancel (their A still adds up)
// Passes:
//   spread   one substep: the three channels spread (flux = k x the difference, truncated toward zero, so what one pixel gives its
//            neighbour receives: exact), the water carries them (upwind, the heat's rule: the same corners, the same expression from both
//            pixels of an edge), no flux across a face with a SOLID pixel (step G0b's mask; porous walls let it pass); on a tick's first
//            substep a share fades (A to the heat's delta: exact; X, Y the same share, random rounding)
//   sum      the ledger's snapshot: the signal's energy in the dish (64-bit)
//   drain    (on a replaced grid) its signal energy counted as heat that left the dish (LG_OUT), as the heat's own drain
//   puff     the PIPETTE: a puff of one flavour into a disc (whole counts per pixel, booked as energy in: LG_SIG_PUFF)

struct SigP {
  hw: u32,
  hh: u32,
  n: u32,
  flags: u32,       // spare
  base: u32,        // word offset in hb of copy 0, channel A (copy c channel ch at base + (3 c + ch) n)
  mask: u32,        // word offset in hb of the obstacles' mask (0: none this frame)
  cur: u32,         // word offset in hb of the currents' stream function (f32 bits at the pixel corners; 0: no currents)
  _p0: u32,
  k: f32,           // spreading per substep
  decay: f32,       // share of a pixel's signal that fades per tick
  px: f32,          // CSS px per pixel
  _p2: f32,
  puff: vec4f,      // the pipette: x y the centre (dish px), z the radius (px), w the energy per pixel (heat counts, fractional)
  puffF: vec4f,     // x y the flavour's cos and sin (x XY_SCALE); z w spare
};
struct SigT {
  src: u32,         // word offset of the copy read (channel A; X, Y follow at + n, + 2n)
  dst: u32,         // ... of the copy written
  first: u32,       // 1 on a tick's first substep: the fade
  seed: u32,        // random stream
  adv: f32,         // the water: psi's corner difference x adv = the share of a pixel crossing an edge per substep (0: not carried)
  count: u32,       // drain: the old grid's pixels
  _p1: u32,
  _p2: u32,
};

@group(0) @binding(0) var<uniform> P: SigP;
@group(0) @binding(1) var<uniform> T: SigT;
@group(0) @binding(2) var<storage, read_write> hb: array<atomic<i32>>;

// the signal's ledger (heat_common.wgsl words LG_SIG ..; src/signals.js)
const LG_SIG_DISH: u32 = LG_SIG;            // snapshot: its energy in the dish (64-bit, 64 slots)
const LG_SIG_DECAY: u32 = LG_SIG + 128u;    // faded into heat (64-bit)
const LG_SIG_PUFF: u32 = LG_SIG + 256u;     // the pipette's puffs (energy in; 64-bit)
const ADV_MAX: f32 = 0.04;

fn spcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn srand(a: u32, b: u32) -> f32 { return f32(spcg(a ^ spcg(b)) >> 8u) / 16777216.0; }
fn sadd64(lo: u32, x: i32) {
  if (x == 0) { return; }
  let old = bitcast<u32>(atomicAdd(&hb[lo], x));
  var c = select(0, 1, old + bitcast<u32>(x) < old);
  if (x < 0) { c -= 1; }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}
fn sflux(hj: i32, hi: i32) -> i32 { return i32(P.k * f32(hj - hi)); }
// what the water carries across an edge from its second pixel (hs) to its first (hf), the edge's share a (> 0: toward the first); `pos`:
// a channel that is never negative (A), whose upwind amount is clamped at 0 as the heat's
fn sadv(hf: i32, hs: i32, a0: f32, pos: bool) -> i32 {
  let a = clamp(a0, -ADV_MAX, ADV_MAX);
  if (a > 0.0) { return i32(a * f32(select(hs, max(hs, 0), pos))); }
  return -i32(-a * f32(select(hf, max(hf, 0), pos)));
}
fn spsi(x: u32, y: u32) -> f32 { return bitcast<f32>(atomicLoad(&hb[P.cur + y * (P.hw + 1u) + x])); }
fn ssolid(j: u32) -> bool { return (bitcast<u32>(atomicLoad(&hb[P.mask + j])) & 1u) != 0u; }

var<workgroup> wfade: atomic<i32>;

@compute @workgroup_size(8, 8)
fn spread(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
          @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let first = T.first != 0u;
  if (li == 0u) { atomicStore(&wfade, 0); }
  workgroupBarrier();
  if (id.x < P.hw && id.y < P.hh) {
    let i = id.y * P.hw + id.x;
    var oL = id.x > 0u;
    var oR = id.x + 1u < P.hw;
    var oU = id.y > 0u;
    var oD = id.y + 1u < P.hh;
    if (P.mask != 0u) {   // (step G0b: no flux across a face with a solid pixel)
      if (ssolid(i)) { oL = false; oR = false; oU = false; oD = false; }
      else {
        if (oL && ssolid(i - 1u)) { oL = false; }
        if (oR && ssolid(i + 1u)) { oR = false; }
        if (oU && ssolid(i - P.hw)) { oU = false; }
        if (oD && ssolid(i + P.hw)) { oD = false; }
      }
    }
    var aE = vec4f(0.0);
    let adv = T.adv != 0.0 && P.cur != 0u;
    if (adv) {
      let p00 = spsi(id.x, id.y);
      let p10 = spsi(id.x + 1u, id.y);
      let p01 = spsi(id.x, id.y + 1u);
      let p11 = spsi(id.x + 1u, id.y + 1u);
      aE = vec4f(-(p01 - p00), -(p11 - p10), p10 - p00, p11 - p01) * T.adv;
    }
    for (var ch = 0u; ch < 3u; ch++) {
      let s = T.src + ch * P.n;
      let v = atomicLoad(&hb[s + i]);
      let pos = ch == 0u;
      var acc = v;
      if (oL) { let w = atomicLoad(&hb[s + i - 1u]); acc += sflux(w, v); if (adv) { acc -= sadv(w, v, aE.x, pos); } }
      if (oR) { let w = atomicLoad(&hb[s + i + 1u]); acc += sflux(w, v); if (adv) { acc += sadv(v, w, aE.y, pos); } }
      if (oU) { let w = atomicLoad(&hb[s + i - P.hw]); acc += sflux(w, v); if (adv) { acc -= sadv(w, v, aE.z, pos); } }
      if (oD) { let w = atomicLoad(&hb[s + i + P.hw]); acc += sflux(w, v); if (adv) { acc += sadv(v, w, aE.w, pos); } }
      if (first && v != 0) {
        // the fade: a share of what the pixel held at the tick's start (random rounding, so small amounts are neither stuck nor lost)
        let a = abs(v);
        let f = min(i32(floor(f32(a) * P.decay + srand(i, T.seed + 977u * ch))), a);
        if (pos) {
          let g = min(f, max(acc, 0));
          acc -= g;
          if (g > 0) { atomicAdd(&hb[LEDGER_WORDS + i], g); atomicAdd(&wfade, g); }   // (its energy: heat here, taken in by this tick's spreading)
        } else {
          acc -= select(-f, f, v > 0);
        }
      }
      atomicStore(&hb[T.dst + ch * P.n + i], acc);
    }
  }
  workgroupBarrier();
  if (first && li == 0u) {
    let f = atomicLoad(&wfade);
    if (f != 0) { sadd64(LG_SIG_DECAY + ((wid.y * nw.x + wid.x) & 63u), f); }
  }
}

// the ledger's snapshot: the signal's energy in the dish (the current copy, T.src)
@compute @workgroup_size(256)
fn sum(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wid: vec3u) {
  if (id.x < P.n) {
    let a = atomicLoad(&hb[T.src + id.x]);
    if (a != 0) { sadd64(LG_SIG_DISH + (wid.x & 63u), a); }
  }
}

// a replaced grid (on the old buffer; its pixels in T.count): its signal's energy left the dish with it (as heat: the heat's out)
@compute @workgroup_size(256)
fn drain(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wid: vec3u) {
  if (id.x < T.count) {
    let a = atomicLoad(&hb[T.src + id.x]);
    if (a != 0) { sadd64(LG_OUT + ((wid.x + 16u) & 63u), a); }
  }
}

// the PIPETTE: a puff into every water pixel whose centre lies in the disc, its energy per pixel with random rounding (whole counts, booked)
var<workgroup> wpuff: atomic<i32>;
@compute @workgroup_size(8, 8)
fn puff(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  if (li == 0u) { atomicStore(&wpuff, 0); }
  workgroupBarrier();
  if (id.x < P.hw && id.y < P.hh) {
    let i = id.y * P.hw + id.x;
    let p = (vec2f(id.xy) + 0.5) * P.px;
    if (distance(p, P.puff.xy) <= P.puff.z && !(P.mask != 0u && ssolid(i))) {
      let e = i32(floor(P.puff.w + srand(i, T.seed)));
      if (e > 0) {
        atomicAdd(&hb[T.src + i], e);
        atomicAdd(&hb[T.src + P.n + i], i32(round(f32(e) * P.puffF.x)));
        atomicAdd(&hb[T.src + 2u * P.n + i], i32(round(f32(e) * P.puffF.y)));
        atomicAdd(&wpuff, e);
      }
    }
  }
  workgroupBarrier();
  if (li == 0u) {
    let e = atomicLoad(&wpuff);
    if (e != 0) { sadd64(LG_SIG_PUFF + ((wid.y * nw.x + wid.x) & 63u), e); }
  }
}
