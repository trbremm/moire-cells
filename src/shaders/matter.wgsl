// Matter (Part C, step C3): the substance grid's passes. heat_common.wgsl is prepended (src/matter.js): the substances
// live in the heat buffer, behind the heat's own blocks, and book into its ledger.
//
//   spread  one substep of spreading, per channel (explicit, conservative): every edge between two pixels carries
//           floor(k x difference + r) from the fuller to the emptier, r random per edge, channel and substep (so thin
//           tails keep spreading instead of sticking), capped at a quarter of what the giver has (4 edges at most, so
//           no pixel goes below zero). Both pixels of an edge work it out from the same two numbers and the same r, so
//           what one gives, the other receives, to the count. On a tick's first substep the pixels on the dish's rim
//           also lose a share `edge` of each mobile channel (the sink), booked as "lost" (LG_M_LOST), and the springs
//           drip: each spring's atoms of this tick, shared evenly over the pixels of a small disc (random rounding),
//           booked as "added" (LG_M_ADD). Per pixel, so overlapping springs need no atomics
//   count   all the matter in one copy, exact (64-bit, per channel) into a ledger region: the snapshot "in the dish"
//           (LG_M_DISH) once per frame, or "gone" (LG_M_GONE) when the dish is washed or the grid replaced; with the
//           snapshot, also the sum of m ln m (m = atoms in a pixel of a substance, in counts) for the ORDER line, as
//           f32 partial sums, one per workgroup (LG_M_ORDER)
//   paint   the amounts the drawing shows (per R^2), summed into its layers, into two small textures at grid size
//   react   step C4: one tick of chemistry per pixel (at the end of this file)
// Only core WebGPU: i32 storage atomics and workgroup atomics.

// (NCH and ATOM_SCALE are in heat_common.wgsl since step C5)

struct MatterP {
  hw: u32,                      // grid width and height (the heat grid's)
  hh: u32,
  n: u32,                       // hw x hh
  base: u32,                    // (word offset of copy 0, channel 0; the tick slots carry the current copies)
  show: u32,                    // what paint writes: 0 nothing, 1 the summary, 2 one substance alone
  solo: u32,                    // ... that substance's channel
  nSub: u32,                    // spreading substeps per tick
  moving: u32,                  // bit c: channel c has matter (or a spring dripping it); the others are all zero, skipped
  px: f32,                      // CSS px per pixel
  conc: f32,                    // counts in one pixel x conc = atom-units per R^2
  edge: f32,                    // share of a rim pixel's mobile matter that leaves per tick
  pig: u32,                     // step C6: offset in `mg` of the cells' pigment blocks (heat_common.wgsl; 0 = none)
  k: array<vec4f, 4>,           // per channel: spreading per substep (0 = does not move: sediment)
  layer: array<vec4u, 4>,       // per channel: the drawing's layer (0 free atoms, 1 fuels, 2 sediment, 3 trace)
  react: array<vec4f, 4>,       // per channel: 1 for a reactive free atom (a giver or a taker)
  heavy: array<vec4f, 4>,       // per channel: share of its atoms in row 2 or below
  natoms: array<vec4f, 4>,      // per channel: atoms per unit (1 for a free atom, 2 for a fuel or a sediment)
};

struct MatterTick {
  src: u32,                     // word offset of the current copy's channel 0 (in `mg`, which starts after the ledger)
  dst: u32,                     // ... of the copy to write (spread)
  first: u32,                   // spread: 1 on a tick's first substep (the edge sink); count: 1 = also the ORDER sums
  seed: u32,                    // random stream
  count: u32,                   // spread: springs; count: pixels of that grid (also the channel stride)
  region: u32,                  // count: ledger region (LG_M_DISH or LG_M_GONE)
  heat: u32,                    // step C4: word offset (in `mg`) of the heat copy current in this tick
  _p1: u32,
};

struct Spring {
  pos: vec4f,                   // x, y (CSS px), radius of its disc (CSS px), share of its life left
  amt: array<vec4f, 4>,         // counts per tick, per channel (fractional; random rounding); [13] = pixels in its disc
  ink: vec4f,                   // drawing only
};
struct Springs { s: array<Spring, 16>, };

// (struct Rx and ChemP, step C4's reaction table, are in heat_common.wgsl since step C5: the cells' eat pass reads them too)

@group(0) @binding(0) var<uniform> MP: MatterP;
@group(0) @binding(1) var<uniform> T: MatterTick;
// The heat buffer in two views that do not overlap (WebGPU forbids two writable bindings over the same bytes):
//   hb  the ledger only (words 0 .. LEDGER_WORDS), atomic: many workgroups add into the same slots;
//   mg  everything behind it (the heat's blocks, then the substances), plain numbers: every grid word is written by one
//       invocation only, and on Direct3D (Chrome and Firefox on Windows) an atomicLoad is an atomic read-modify-write,
//       which made the spreading (65 reads per pixel per substep) cost 7 ms per substep on a 300 000-pixel grid.
@group(0) @binding(2) var<storage, read_write> hb: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> mg: array<i32>;
@group(0) @binding(3) var<uniform> SP: Springs;
@group(0) @binding(5) var<uniform> LP: LightP;    // step C4: the light (light_common.wgsl)
@group(0) @binding(6) var<uniform> CP: ChemP;     // step C4: the reactions
@group(1) @binding(0) var texA: texture_storage_2d<rgba16float, write>;
@group(1) @binding(1) var texB: texture_storage_2d<rgba16float, write>;

fn mpcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn u01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

// x added to the 64-bit counter at word `lo` (carry word 64 words later), as in heat.wgsl
fn add64(lo: u32, x: i32) {
  if (x == 0) { return; }
  let old = bitcast<u32>(atomicAdd(&hb[lo], x));
  var c = select(0, 1, old + bitcast<u32>(x) < old);
  if (x < 0) { c -= 1; }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}
// carry x 2^32 + low (low unsigned) added to the 64-bit counter at `lo`
fn add64v(lo: u32, carry: i32, low: u32) {
  var c = carry;
  if (low != 0u) {
    let old = bitcast<u32>(atomicAdd(&hb[lo], bitcast<i32>(low)));
    if (old + low < old) { c += 1; }
  }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}

// ---------- spread ----------
var<workgroup> wlost: array<atomic<i32>, 13>;
var<workgroup> wadd: array<atomic<i32>, 13>;

// what flows across the edge from its second pixel (holding ms) to its first (holding mf): random rounding with r, capped
// at a quarter of the giver's amount (a pixel has at most 4 edges). Antisymmetric by construction: both pixels call it
// with the same (mf, ms, r).
fn edge_flow(mf: i32, ms: i32, k: f32, r: f32) -> i32 {
  let f = i32(floor(k * f32(ms - mf) + r));
  return clamp(f, -(max(mf, 0) >> 2u), max(ms, 0) >> 2u);
}

@compute @workgroup_size(16, 4)
fn spread(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
          @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let first = T.first != 0u;
  if (id.x < MP.hw && id.y < MP.hh) {
    let i = id.y * MP.hw + id.x;
    let hasL = id.x > 0u;
    let hasR = id.x + 1u < MP.hw;
    let hasU = id.y > 0u;
    let hasD = id.y + 1u < MP.hh;
    let nEdges = select(0, 1, hasL) + select(0, 1, hasR) + select(0, 1, hasU) + select(0, 1, hasD);
    let rim = nEdges < 4;
    // one random stream per edge (edge ids: 2 x its first pixel, + 1 for a vertical edge), the same from both sides
    let eL = mpcg((2u * (i - 1u)) ^ T.seed);
    let eR = mpcg((2u * i) ^ T.seed);
    let eU = mpcg((2u * (i - MP.hw) + 1u) ^ T.seed);
    let eD = mpcg((2u * i + 1u) ^ T.seed);
    let eI = mpcg(i ^ T.seed ^ 0x68e31da4u);
    // the springs whose disc covers this pixel (on the tick's first substep), as a bit mask
    var drip = 0u;
    if (first) {
      for (var k = 0u; k < min(T.count, 16u); k++) {
        let sp = SP.s[k].pos;
        if (length(vec2f(id.xy) + 0.5 - sp.xy / MP.px) <= max(sp.z / MP.px, 0.75)) { drip |= 1u << k; }
      }
    }
    for (var c = 0u; c < NCH; c++) {
      if ((MP.moving & (1u << c)) == 0u) { continue; }
      let s0 = T.src + c * MP.n;
      let m = mg[s0 + i];
      let k = MP.k[c / 4u][c % 4u];
      var acc = m;
      if (k > 0.0) {
        let cs = c * 0x9e3779b9u;
        if (hasL) { acc -= edge_flow(mg[s0 + i - 1u], m, k, u01(mpcg(eL + cs))); }
        if (hasR) { acc += edge_flow(m, mg[s0 + i + 1u], k, u01(mpcg(eR + cs))); }
        if (hasU) { acc -= edge_flow(mg[s0 + i - MP.hw], m, k, u01(mpcg(eU + cs))); }
        if (hasD) { acc += edge_flow(m, mg[s0 + i + MP.hw], k, u01(mpcg(eD + cs))); }
        if (first && rim && m > 0 && MP.edge > 0.0) {
          // the sink at the dish's rim: never more than the edges leave it (so it cannot go below zero)
          let out = clamp(i32(floor(f32(m) * MP.edge + u01(mpcg(eI + cs)))), 0, m - nEdges * (m >> 2u));
          acc -= out;
          if (out != 0) { atomicAdd(&wlost[c], out); }
        }
      }
      if (drip != 0u) {
        var add = 0;
        for (var k = 0u; k < 16u; k++) {
          if ((drip & (1u << k)) == 0u) { continue; }
          let a = SP.s[k].amt[c / 4u][c % 4u] / max(SP.s[k].amt[3].y, 1.0);   // amt[13]: the disc's pixels
          if (a > 0.0) { add += i32(floor(a + u01(mpcg(eI + c * 0x85ebca6bu + k * 0x27d4eb2fu)))); }
        }
        acc += add;
        if (add != 0) { atomicAdd(&wadd[c], add); }
      }
      mg[T.dst + c * MP.n + i] = acc;
    }
  }
  workgroupBarrier();
  if (first && li < NCH) {
    let slot = (wid.y * nw.x + wid.x) & 63u;
    add64(LG_M_LOST + 128u * li + slot, atomicLoad(&wlost[li]));
    add64(LG_M_ADD + 128u * li + slot, atomicLoad(&wadd[li]));
  }
}

// ---------- count ----------
var<workgroup> wlo: array<atomic<u32>, 13>;
var<workgroup> whi: array<atomic<u32>, 13>;
var<workgroup> wml: array<f32, 256>;

// dispatched as 256 workgroups of 256 (a grid-stride loop over the pixels)
@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u) {
  var lo: array<u32, 13>;
  var hi: array<u32, 13>;
  var ml = 0.0;
  let order = T.first != 0u;
  for (var p = gid.x; p < T.count; p += 65536u) {
    for (var c = 0u; c < NCH; c++) {
      let m = max(mg[T.src + c * T.count + p], 0);
      if (m == 0) { continue; }
      lo[c] += u32(m) & 0xffffu;
      hi[c] += u32(m) >> 16u;
      if (order) {
        let a = f32(m) * MP.natoms[c / 4u][c % 4u];   // atoms, in counts
        ml += a * log(a);
      }
    }
  }
  for (var c = 0u; c < NCH; c++) {
    if (lo[c] != 0u) { atomicAdd(&wlo[c], lo[c]); }
    if (hi[c] != 0u) { atomicAdd(&whi[c], hi[c]); }
  }
  wml[li] = ml;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { wml[li] += wml[li + s]; }
    workgroupBarrier();
  }
  if (li < NCH) {
    // the workgroup's total of channel li: H x 2^16 + L, added as a 64-bit number
    let L = atomicLoad(&wlo[li]);
    let H = atomicLoad(&whi[li]);
    let at = T.region + 128u * li + (wid.x & 63u);
    add64v(at, i32(H >> 16u), H << 16u);
    add64v(at, 0, L);
  }
  if (order && li == 0u) { atomicStore(&hb[LG_M_ORDER + wid.x], bitcast<i32>(wml[0])); }
}

// ---------- paint ----------
// texA: free atoms (all), of which reactive, of which heavy; trace.  texB: fuels, of which heavy; sediment, of which heavy.
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  let i = id.y * MP.hw + id.x;
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  for (var c = 0u; c < NCH; c++) {
    if (MP.show == 2u && c != MP.solo) { continue; }
    let v = min(f32(max(mg[T.src + c * MP.n + i], 0)) * MP.conc, 60000.0);
    if (v <= 0.0) { continue; }
    let h = MP.heavy[c / 4u][c % 4u];
    switch MP.layer[c / 4u][c % 4u] {
      case 0u: { a += vec4f(v, v * MP.react[c / 4u][c % 4u], v * h, 0.0); }
      case 1u: { b += vec4f(v, v * h, 0.0, 0.0); }
      case 2u: { b += vec4f(0.0, 0.0, v, v * h); }
      default: { a.w += v; }
    }
  }
  textureStore(texA, vec2i(id.xy), a);
  textureStore(texB, vec2i(id.xy), b);
}

// ---------- react (step C4) ----------
// One tick of chemistry in every pixel, in place in the copy this tick's spreading left (T.dst of the tick's last
// substep), after the cells' step and before the heat spreads (it runs inside the heat's pass of the tick). Per pixel:
//   temperature  the pixel's heat (the heat copy current in this tick) per R^2
//   light        what reaches the substances: the band's light on the pixel (as the heat's absorb()) after the bare medium
//                and the cells took their share (exp(-their optical depth)); per band, the substances' absorbers (each
//                light reaction's reactants: a pair a b / (a + b), or the one reactant, x its k; and the dark sediment
//                for the warm band) catch 1 - exp(-their summed depth) of it, shared by depth
//   reactions    in table order; each makes floor(x + random) events, x from its rate (by heat: k x amounts x
//                exp(-spark / (theta x temperature)) x dt, spark lowered by trace) or from the photons its share holds
//                (by light: share / light16), capped by what the reactants have. An event moves whole counts and whole
//                heat counts (heat16, light16 are exact; see CHEM in src/matter.js), so matter and energy stay exact
// The heat released goes into the delta (taken in by the heat's next spreading substep); the light caught and the
// events are counted per workgroup into the ledger (LG_C_LIGHT, LG_C_RX).
var<workgroup> wfam: array<atomic<i32>, 6>;
var<workgroup> wlit: array<atomic<i32>, 4>;

@compute @workgroup_size(8, 8)
fn react(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  if (id.x < MP.hw && id.y < MP.hh) {
    let i = id.y * MP.hw + id.x;
    let base = T.dst;
    var m: array<i32, 13>;
    var m0: array<i32, 13>;
    var stuff = 0;
    for (var c = 0u; c < NCH; c++) {
      if ((MP.moving & (1u << c)) != 0u) { m[c] = mg[base + c * MP.n + i]; }
      m0[c] = m[c];
      if (c != CP.trace) { stuff += m[c]; }
    }
    if (stuff > 0) {
      let conc = MP.conc;
      let temp = max(f32(mg[T.heat + i]) * CP.tempScale, 1e-4);
      var sparkScale = 1.0;
      if (CP.traceOn != 0u) { sparkScale = 1.0 / (1.0 + CP.traceK * f32(m[CP.trace]) * conc); }
      let rs = mpcg(i ^ T.seed ^ 0x2545f491u);
      var heat = 0;
      var lit = vec4i(0);

      // the light that reaches the substances, per band (counts per pixel per tick)
      var et = vec4f(0.0);
      if (CP.light != 0u && LP.mode != LIGHT_OFF) {
        let s = light_factor(LP, (vec2f(id.xy) + 0.5) * MP.px);
        if (s > 0.0) {
          let co = 3u * MP.n;   // the cells' cover (heat_common.wgsl), written by their step this tick
          var cov = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              let q = clamp(vec2i(id.xy) + vec2i(dx, dy), vec2i(0), vec2i(i32(MP.hw) - 1, i32(MP.hh) - 1));
              cov += mg[co + u32(q.y) * MP.hw + u32(q.x)];
            }
          }
          let cover = f32(cov) / (9.0 * COVER_SCALE);
          // step C6: and minus what the cells' pigments caught (their depth, which each cell spread over its 3 x 3
          // pixels, per band)
          var pig = vec4f(0.0);
          if (MP.pig != 0u) {
            for (var b = 1u; b < 4u; b++) { pig[b] = f32(mg[MP.pig + (b - 1u) * MP.n + i]) / COVER_SCALE; }
          }
          et = LP.power * s * exp(-(LP.tauMed + LP.tauCell * cover + pig));
        }
      }
      // optical depths of the absorbers, per reaction and per band
      var tau: array<f32, 24>;
      var tsum = vec4f(0.0);
      var tdark = 0.0;
      if (any(et > vec4f(0.0))) {
        for (var r = 0u; r < CP.nrx; r++) {
          let R = CP.rx[r];
          if (R.by != 1u) { continue; }
          let a = f32(m[R.ch.x]) * conc;
          var amt = a;
          if (R.ch.y != NONE) {
            let b = f32(m[R.ch.y]) * conc;
            amt = a * b / max(a + b, 1e-12);
          }
          tau[r] = R.k * amt;
          tsum[R.band] += tau[r];
        }
        for (var c = 0u; c < NCH; c++) { tdark += CP.dark[c / 4u][c % 4u] * f32(m[c]) * conc; }
        tsum.x += tdark;
      }
      let caught = et * (1.0 - exp(-tsum));
      if (tdark > 0.0) {
        // the dark sediment's share of the warm light: heat
        let q = i32(floor(caught.x * tdark / tsum.x + u01(mpcg(rs + 0x5bd1e995u))));
        heat += q;
        lit.x += q;
      }

      for (var r = 0u; r < CP.nrx; r++) {
        let R = CP.rx[r];
        var x = 0.0;
        if (R.by == 0u) {
          x = R.k * f32(m[R.ch.x]) * exp(-R.spark * sparkScale / (CP.theta * temp)) * CP.dt;
          if (R.ch.y != NONE) { x *= f32(m[R.ch.y]) * conc; }
        } else if (tau[r] > 0.0) {
          x = caught[R.band] * tau[r] / tsum[R.band] / f32(R.light16);
        }
        var n = i32(floor(x + u01(mpcg(rs + r * 0x9e3779b9u))));
        if (R.ch.y == R.ch.x) {
          n = min(n, m[R.ch.x] / 2);
        } else {
          n = min(n, m[R.ch.x]);
          if (R.ch.y != NONE) { n = min(n, m[R.ch.y]); }
        }
        if (n <= 0) { continue; }
        m[R.ch.x] -= n;
        if (R.ch.y != NONE) { m[R.ch.y] -= n; }
        m[R.ch.z] += n;
        if (R.ch.w != NONE) { m[R.ch.w] += n; }
        heat += n * R.heat16;
        if (R.by == 1u) { lit[R.band] += n * R.light16; }
        atomicAdd(&wfam[R.fam], n);
      }

      for (var c = 0u; c < NCH; c++) {
        if (m[c] != m0[c]) { mg[base + c * MP.n + i] = m[c]; }
      }
      if (heat != 0) { mg[i] += heat; }   // the delta (heat_common.wgsl: the first block behind the ledger)
      for (var b = 0u; b < 4u; b++) {
        if (lit[b] != 0) { atomicAdd(&wlit[b], lit[b]); }
      }
    }
  }
  workgroupBarrier();
  let slot = (wid.y * nw.x + wid.x) & 63u;
  if (li < 6u) {
    add64(LG_C_RX + 128u * li + slot, atomicLoad(&wfam[li]));
  } else if (li < 10u) {
    add64(LG_C_LIGHT + 128u * (li - 6u) + slot, atomicLoad(&wlit[li - 6u]));
  }
}
