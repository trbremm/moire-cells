// The heat band (Part C, step C1): the heat grid's passes. heat_common.wgsl and light_common.wgsl are prepended
// (src/heat.js).
//
//   spread     one substep of spreading (explicit, conservative): every pixel exchanges k x the difference with its
//              4 neighbours, rounded toward zero, so what one pixel gives its neighbour receives to the count. On the
//              first substep of a tick it also takes in the cells' delta (and clears it), adds the base warmth and
//              leaks a share to the sky (both with random rounding, so small amounts are not lost or stuck), and
//              counts the warmth and the leak into the ledger. Step C2: on that substep the light is absorbed too
//              (absorb below): per band, what arrives on the pixel and what of it is caught, booked as light in and
//              light absorbed; only the caught part enters the pixel (as heat)
//   sum_heat   the ledger's snapshot: heat in the dish (the current copy plus any pending delta); step C2: also the
//              heat in the lit pixels and in the rest, and how many of each
//   sum_cells  the ledger's snapshot: the cells' motion energy; step C2: the heat under the cells in the light and under
//              the rest, and how many of each
//   deposit    every cell's motion energy into the delta at its position (before a new culture replaces the cells,
//              so the motion they had is not lost from the books)
//   drain      everything in the dish (current copy + delta) counted as leaked out (when the grid is replaced on resize)
// Only core WebGPU: i32 storage atomics and workgroup atomics.
// The ledger slots that can grow large (out, the snapshots) are 64-bit: add64 below.

struct HeatTick {
  src: u32,         // word offset of the current heat copy
  dst: u32,         // word offset of the copy to write
  first: u32,       // 1 on a tick's first substep: take in the delta, warmth and leak
  seed: u32,        // random stream of this substep
  count: u32,       // number of cells (sum_cells, deposit); pixels of the old grid (drain)
  _p0: u32,
  _p1: u32,
  _p2: u32,
};

@group(0) @binding(0) var<uniform> HP: HeatP;
@group(0) @binding(1) var<uniform> HT: HeatTick;
@group(0) @binding(2) var<storage, read_write> hb: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read> cellsF: array<f32>;   // struct Cell as raw floats (26 per cell; pos, vel first)
@group(0) @binding(4) var<uniform> LP: LightP;                  // step C2: the light (light_common.wgsl)

const CELL_FLOATS: u32 = 88u;   // as CELL_FLOATS in src/cells.js (step C6c: 240-byte cells; step C7: 256; step C10: 288; step C12b: 312; step C13: 336; C12e: 352)

// per workgroup: [0] warmth, [1] leak, [2..5] light in per band, [6..9] light absorbed per band
var<workgroup> wsum: array<atomic<i32>, 10>;
// step C2, the snapshot of the heat in / out of the light (for the overlay only, so not exact): per workgroup, per
// class, how many and their heat in units of SPOT_SHIFT counts (so a workgroup's sum stays far from overflowing)
var<workgroup> wspot: array<atomic<i32>, 4>;
const SPOT_SHIFT: u32 = 6u;

// Step C2: the light caught in pixel i (at grid position p), per band, in counts: .in what arrives, .abs what is caught.
// The absorbers: the bare medium (tauMed, everywhere) and the cells (tauCell x their cover, the 3 x 3 mean of what they
// put down this tick). Step C4: the substances (fuel-making pairs, fuel, the dark sediment) catch what these two leave,
// in matter.wgsl's react (the same light, times exp(-tau) of this pixel's medium and cells), so this pass needs no reads
// of the substance grid. Step C6: the cells' pigments add their depth (spread over their 3 x 3 pixels this tick) to
// `tau`; their share of what is caught is not heat here (the cells booked it as light in, in cell_eat.wgsl), so the
// light they catch is not used twice.
struct Caught { inc: vec4i, abs: vec4i, };
fn absorb(i: u32, p: vec2u) -> Caught {
  var r: Caught;
  let s = light_factor(LP, (vec2f(p) + 0.5) * HP.px);
  if (s <= 0.0) { return r; }
  let co = LEDGER_WORDS + 3u * HP.n;
  var cov = 0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = clamp(vec2i(p) + vec2i(dx, dy), vec2i(0), vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1));
      cov += atomicLoad(&hb[co + u32(q.y) * HP.hw + u32(q.x)]);
    }
  }
  let cover = f32(cov) / (9.0 * COVER_SCALE);
  let e = LP.power * s;                                     // per band, counts arriving
  let pig = pigment_depth(i);                               // step C6: the cells' pigments, per band
  let tau = LP.tauMed + LP.tauCell * cover + pig;           // per band, optical depth of everything in the way
  let a = e * (1.0 - exp(-tau)) * (1.0 - pig / max(tau, vec4f(1e-9)));   // per band, counts caught as heat here
  let seed = HT.seed ^ 0x3c6ef372u;
  for (var b = 0u; b < 4u; b++) {
    // random rounding, so small amounts are neither lost nor stuck
    r.inc[b] = i32(floor(e[b] + hrand(i, seed + 2u * b)));
    r.abs[b] = min(i32(floor(a[b] + hrand(i, seed + 2u * b + 1u))), r.inc[b]);
  }
  return r;
}

// step C6: the cells' pigments' optical depth over pixel i, per band (warm: 0); each cell spreads its depth over its
// 3 x 3 pixels as it puts it down, so this is one word per band
fn pigment_depth(i: u32) -> vec4f {
  var t = vec4f(0.0);
  if (HP.pig == 0u) { return t; }
  for (var b = 1u; b < 4u; b++) { t[b] = f32(atomicLoad(&hb[HP.pig + (b - 1u) * HP.n + i])) / COVER_SCALE; }
  return t;
}

fn hpcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hrand(a: u32, b: u32) -> f32 {
  return f32(hpcg(a ^ hpcg(b)) >> 8u) / 16777216.0;
}

// x added to the 64-bit counter at word `lo` (low word, as u32) and lo + 64 (carry word, signed): the low word wraps,
// and a wrap (or a negative x) moves the carry word
fn add64(lo: u32, x: i32) {
  if (x == 0) { return; }
  let old = bitcast<u32>(atomicAdd(&hb[lo], x));
  var c = select(0, 1, old + bitcast<u32>(x) < old);
  if (x < 0) { c -= 1; }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}

// what flows from a pixel holding hj into one holding hi: truncated toward zero, so flux(a, b) = -flux(b, a) exactly
fn flux(hj: i32, hi: i32) -> i32 {
  return i32(HP.k * f32(hj - hi));
}

@compute @workgroup_size(8, 8)
fn spread(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
          @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let first = HT.first != 0u;
  if (id.x < HP.hw && id.y < HP.hh) {
    let i = id.y * HP.hw + id.x;
    let hc = atomicLoad(&hb[HT.src + i]);
    var acc = hc;
    if (id.x > 0u) { acc += flux(atomicLoad(&hb[HT.src + i - 1u]), hc); }
    if (id.x + 1u < HP.hw) { acc += flux(atomicLoad(&hb[HT.src + i + 1u]), hc); }
    if (id.y > 0u) { acc += flux(atomicLoad(&hb[HT.src + i - HP.hw]), hc); }
    if (id.y + 1u < HP.hh) { acc += flux(atomicLoad(&hb[HT.src + i + HP.hw]), hc); }
    if (first) {
      let d = atomicExchange(&hb[LEDGER_WORDS + i], 0);
      var lr = HP.leak;
      if (id.x == 0u || id.y == 0u || id.x + 1u == HP.hw || id.y + 1u == HP.hh) { lr += HP.edge; }
      let out = select(0, i32(floor(f32(hc) * min(lr, 1.0) + hrand(i, HT.seed))), hc > 0);
      let warm = i32(floor(HP.base + hrand(i, HT.seed ^ 0x68e31da4u)));
      acc += d + warm - out;
      atomicAdd(&wsum[0], warm);
      atomicAdd(&wsum[1], out);
      if (LP.mode != LIGHT_OFF) {
        let c = absorb(i, id.xy);
        acc += c.abs.x + c.abs.y + c.abs.z + c.abs.w;
        for (var b = 0u; b < 4u; b++) {
          if (c.inc[b] != 0) { atomicAdd(&wsum[2u + b], c.inc[b]); }
          if (c.abs[b] != 0) { atomicAdd(&wsum[6u + b], c.abs[b]); }
        }
      }
    }
    atomicStore(&hb[HT.dst + i], acc);
  }
  workgroupBarrier();
  if (first && li == 0u) {
    let slot = (wid.y * nw.x + wid.x) & 63u;
    atomicAdd(&hb[LG_BASE + slot], atomicLoad(&wsum[0]));
    add64(LG_OUT + slot, atomicLoad(&wsum[1]));
    if (LP.mode != LIGHT_OFF) {
      for (var b = 0u; b < 4u; b++) {
        add64(LG_LIGHT_IN + 128u * b + slot, atomicLoad(&wsum[2u + b]));
        add64(LG_LIGHT_ABS + 128u * b + slot, atomicLoad(&wsum[6u + b]));
      }
    }
  }
}

// The snapshots and the drain add every pixel (or cell) straight into a 64-bit slot: a workgroup's i32 sum could
// overflow in a hot spot (a hard stir piles up heat along its path). Once per frame, so the atomics are cheap enough.
@compute @workgroup_size(256)
fn sum_heat(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wid: vec3u,
            @builtin(local_invocation_index) li: u32) {
  if (id.x < HP.n) {
    let h = atomicLoad(&hb[HT.src + id.x]);
    add64(LG_HEAT + (wid.x & 63u), h);
    add64(LG_HEAT + ((wid.x + 32u) & 63u), atomicLoad(&hb[LEDGER_WORDS + id.x]));
    // step C2: lit pixels and the rest
    let p = (vec2f(f32(id.x % HP.hw), f32(id.x / HP.hw)) + 0.5) * HP.px;
    let k = select(1u, 0u, light_inside(LP, p));
    atomicAdd(&wspot[k], 1);
    atomicAdd(&wspot[2u + k], h >> SPOT_SHIFT);
  }
  spot_flush(li, wid.x, 2u);
}

// one workgroup's in / out counts and heat into the ledger's classes base, base + 1 (cells 0, pixels 2)
fn spot_flush(li: u32, w: u32, base: u32) {
  workgroupBarrier();
  if (li < 2u) {
    let slot = w & 63u;
    let n = atomicLoad(&wspot[li]);
    if (n != 0) {
      atomicAdd(&hb[LG_SPOT_N + 64u * (base + li) + slot], n);
      add64(LG_SPOT_T + 128u * (base + li) + slot, atomicLoad(&wspot[2u + li]));
    }
  }
}

// (on the old grid, so its size comes in HT.count, not HP.n)
@compute @workgroup_size(256)
fn drain(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wid: vec3u) {
  if (id.x < HT.count) {
    add64(LG_OUT + (wid.x & 63u), atomicLoad(&hb[HT.src + id.x]));
    add64(LG_OUT + ((wid.x + 32u) & 63u), atomicLoad(&hb[LEDGER_WORDS + id.x]));
  }
}

@compute @workgroup_size(64)
fn sum_cells(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wid: vec3u,
             @builtin(local_invocation_index) li: u32) {
  // (step C9: a free slot has no motion and is not counted)
  if (id.x < HT.count && (bitcast<u32>(cellsF[id.x * CELL_FLOATS + 9u]) & 1u) != 0u) {
    let o = id.x * CELL_FLOATS;
    add64(LG_MOVE + (wid.x & 63u), heat_counts(heat_ke(vec2f(cellsF[o + 2u], cellsF[o + 3u]))));
    // step C2: the heat under the cells in the light and under the rest (the pixel at the cell's centre)
    let x = vec2f(cellsF[o], cellsF[o + 1u]);
    let q = heat_xy(HP, x);
    let k = select(1u, 0u, light_inside(LP, x));
    atomicAdd(&wspot[k], 1);
    atomicAdd(&wspot[2u + k], atomicLoad(&hb[HT.src + u32(q.y) * HP.hw + u32(q.x)]) >> SPOT_SHIFT);
  }
  spot_flush(li, wid.x, 0u);
}

@compute @workgroup_size(64)
fn deposit(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= HT.count) { return; }
  let o = id.x * CELL_FLOATS;
  let p = heat_xy(HP, vec2f(cellsF[o], cellsF[o + 1u]));
  let e = heat_counts(heat_ke(vec2f(cellsF[o + 2u], cellsF[o + 3u])));
  if (e != 0) { atomicAdd(&hb[LEDGER_WORDS + u32(p.y) * HP.hw + u32(p.x)], e); }
}
