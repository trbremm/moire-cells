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
//   oil_rho, oil_blur  step C12: once per tick, before the spreading: the oil's share, the amphiphiles' film, the smoothed
//           share (src/oil.js); spread then lets every substance with a polarity drift by them (phase separation)
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
  // ---- step C6b, charge (src/charge.js) ----
  chg: vec4u,                   // x: word offset in `mg` of phi (0 = no charge field this frame); y: of the cells' net
                                // charge put down this tick (0 = none); z: the channels' charges (CHARGE_CODES); w: spare
  cq: vec4f,                    // x: L = (screening length / pixel)^2; y: strength x the atom-units per R^2 of one count;
                                // z: the relaxation's over-relaxation weight; w: the drift (x the spreading; 1 = Einstein)
  // ---- step C12, oils and water (src/oil.js) ----
  oil: vec4u,                   // x: word offset in `mg` of the oil's 4 blocks (rho, film, obar, the smoothing's half way; 0
                                // = no oil passes this frame); y: bit 0 phase separation, bit 1 amphiphiles (boundary pull,
                                // skin); z: the smoothing's sigma (f32 bits, pixels)
  ok: vec4f,                    // x: gain; y: 1 / full per count (x atoms = share of a full pixel); z: 1 / filmFull per
                                // count; w: skin
  chi: array<vec4f, 4>,         // per channel: the bulk pull (oil 1, polar -1, amphiphiles and neutral 0; immobile 0)
  beta: array<vec4f, 4>,        // per channel: the boundary pull (amphiphiles)
  vol: array<vec4f, 4>,         // per channel: atoms per count that count in the oil's share (rho)
  fill: array<vec4u, 4>,        // per channel: what fills a pixel against its drift: 0 nothing, 1 the oil (rho), 2 the film
  // ---- step C12f, vents in the dark (src/vents.js) ----
  sea: vec4f,                   // the SEA: x counts of its channel per pixel per tick at an empty pixel (0 = no sea), y the sea's
                                // level (counts per pixel: the top-up falls to 0 there), z its channel (the free heavy taker T), w spare
  // ---- step N1, a nutrient landscape: the water (src/water.js) ----
  n1: vec4u,                    // x: word offset in `mg` of the CAUSTIC block (f32 bits per pixel, x the light; 0 = none); y: of the
                                // CURRENTS' stream function (f32 bits at the pixel corners, (hw + 1) x (hh + 1), CSS px^2 per s; 0 = none);
                                // z: dt per substep / px^2 (f32 bits: a corner difference x z = the share of a pixel that crosses the
                                // edge per substep); w: the share of the free TRACE in each pixel that settles into the floor per tick
                                // (f32 bits; 0 = none; src/oases.js: buried, booked as lost)
  // ---- step G0b, obstacles (src/obstacles.js) ----
  obs: vec4u,                   // x: word offset in `mg` of the obstacles' MASK (u32 per pixel: bits 0-1 the kind, 0 water, 1 solid, 2 porous
                                // (water and matter pass), 3 the round dish's rim; bits 2-4 a solid pixel's way out: 1 left, 2 right, 3 up,
                                // 4 down; 0 = no obstacles); yzw spare
  // ---- step N2, substances that flow (src/flow.js) ----
  n2: vec4f,                    // x: SCOUR, the edge share per substep (|a|) at which the water starts lifting row-1 bed (sediment, tar; x row;
                                // fully lifted at twice it); y: the lifted bed's share of the water's motion (carry); z: bits (u32: 1 the bed is
                                // scoured, 2 the trace settles only where the water is slow); w spare. All 0 while off
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
  // step C15a, carbon (src/carbon.js, carbon.wgsl; 0 when carbon is off): word offsets (in `mg`) of the ladder's copy to read and to
  // write in this substep (the ledger slots: the current copy), and of the tar's hand counts
  csrc: u32,
  cdst: u32,
  ctar: u32,
  _p2: u32,
};

struct Spring {
  pos: vec4f,                   // x, y (CSS px), radius of its disc (CSS px), share of its life left
  amt: array<vec4f, 5>,         // counts per tick, per channel (fractional; random rounding); [19] = pixels in its disc (step C12c:
                                // [16] until then; springs never drip the excited atoms, 16 and 17); step C12f: [18] the heat a HOT
                                // VENT puts into its disc per tick (heat counts; 0 for every other spring)
  ink: vec4f,                   // drawing only
  seg: vec4f,                   // EXTENDED SOURCES (README "Dish size and densities"): x, y the unit direction of a LINE (a fissure),
                                // z its half length (CSS px; 0 = a point or a patch), w a patch's radius for the drawing (0 = none).
                                // It drips over every pixel within pos.z of its segment (a capsule)
};
struct Springs { s: array<Spring, 16>, };

// the distance from p (CSS px) to a spring's segment (its centre for a point or a patch)
fn spring_d(p: vec2f, s: Spring) -> f32 {
  let d = p - s.pos.xy;
  let t = clamp(dot(d, s.seg.xy), -s.seg.z, s.seg.z);
  return length(d - t * s.seg.xy);
}

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
@group(1) @binding(2) var texC: texture_storage_2d<rgba16float, write>;   // step C12: oil, amphiphiles, polar, apolar
@group(1) @binding(3) var texD: texture_storage_2d<rgba16float, write>;   // step C12c: the excited atoms (x), spare

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
var<workgroup> wlost: array<atomic<i32>, 18>;
var<workgroup> wadd: array<atomic<i32>, 18>;
var<workgroup> wvent: atomic<i32>;   // step C12f: the hot vents' heat put in (heat counts)
var<workgroup> wsea: atomic<i32>;    // ... and the sea's atoms (counts)

// what flows across the edge from its second pixel (holding ms) to its first (holding mf): random rounding with r, capped
// at a quarter of the giver's amount (a pixel has at most 4 edges). Antisymmetric by construction: both pixels call it
// with the same (mf, ms, r).
fn edge_flow(mf: i32, ms: i32, k: f32, a: f32, r: f32) -> i32 {
  let f = i32(floor(k * f32(ms - mf) + adv_up(mf, ms, a) + r));   // (step N1: + the current's share, a)
  return clamp(f, -(max(mf, 0) >> 2u), max(ms, 0) >> 2u);
}

// Step C6b: the same with the DRIFT of a charged substance in the screened potential phi (pf, ps at the two pixels):
// a charge z moves down z x phi, at its own spreading speed (Einstein's relation: drift velocity = D z grad phi, phi in
// units of the thermal energy; zq = z x the drift knob). Upwind: what drifts across the edge is a share w of the pixel
// it leaves. w is capped at DRIFT_MAX (a CFL-like limit), and the whole flow at a quarter of the giver as before, so no
// pixel goes below zero; both pixels compute it from the same numbers, so the counts stay exact.
const DRIFT_MAX: f32 = 0.2;
fn edge_flow_q(mf: i32, ms: i32, pf: f32, ps: f32, k: f32, zq: f32, a: f32, r: f32) -> i32 {
  let w = clamp(k * zq * (ps - pf), -DRIFT_MAX, DRIFT_MAX);
  let up = select(f32(max(mf, 0)), f32(max(ms, 0)), w > 0.0);
  let f = i32(floor(k * f32(ms - mf) + w * up + adv_up(mf, ms, a) + r));   // (step N1: + the current's share, a)
  return clamp(f, -(max(mf, 0) >> 2u), max(ms, 0) >> 2u);
}
fn phi_at(o: u32) -> f32 { return bitcast<f32>(mg[o]); }

// Step C12: the same with the oil's drift too. uf, us: the PULL at the two pixels (oil_pull: a substance drifts toward the
// higher); rf, rs: the room each has for it (room: oil fills a pixel, a film fills it); Ff, Fs: the film there (the skin
// slows the oil crossing it: k / (1 + skin x their mean)). The charge's drift (zq, pf, ps) and the pull add into one drive
// D toward the first pixel (in units of the thermal energy), and the flow from the second pixel to the first is
//   ks x (B(-D) x ms x rf - B(D) x mf x rs),   B(x) = x / (e^x - 1)
// (the Scharfetter-Gummel flux of semiconductor models: with no drive it is plain spreading, ks (ms - mf), and at rest
// mf / ms is exactly e^D x the rooms' ratio, whichever way round the grid the matter went, so the drops' outline comes from
// the smoothing, which is round, not from the grid's axes: the plain upwind drift of step C6b made the droplets diamonds).
// D is capped so that ks x |D| <= DRIFT_MAX. Antisymmetric as the others: both pixels of the edge call it with the same
// numbers in the same order.
fn bern(x: f32) -> f32 { return select(x / (exp(x) - 1.0), 1.0 - 0.5 * x, abs(x) < 1e-3); }
fn oil_edge(mf: i32, ms: i32, k: f32, zq: f32, pf: f32, ps: f32, uf: f32, us: f32, rf: f32, rs: f32, Ff: f32, Fs: f32,
            skin: f32, a: f32, r: f32) -> i32 {
  let ks = k / (1.0 + skin * 0.5 * (Ff + Fs));
  let dm = DRIFT_MAX / max(ks, 1e-6);
  let D = clamp(zq * (ps - pf) + (uf - us), -dm, dm);
  let f = i32(floor(ks * (bern(-D) * f32(max(ms, 0)) * rf - bern(D) * f32(max(mf, 0)) * rs) + adv_up(mf, ms, a) + r));   // (step N1: + a)
  return clamp(f, -(max(mf, 0) >> 2u), max(ms, 0) >> 2u);
}
// the pull of a substance (bulk chi, boundary beta) where the smoothed oil share is ob, x gain
fn oil_pull(G: f32, chi: f32, bet: f32, ob: f32) -> f32 { return G * (chi * ob + bet * (4.0 * ob * (1.0 - ob))); }
// step C12: the oil's blocks: rho (the oil's share), film, obar (rho smoothed, at most 1), as f32 bits
fn oil_rho_at(i: u32) -> f32 { return bitcast<f32>(mg[MP.oil.x + i]); }
fn oil_film_at(i: u32) -> f32 { return bitcast<f32>(mg[MP.oil.x + MP.n + i]); }
fn oil_obar_at(i: u32) -> f32 { return bitcast<f32>(mg[MP.oil.x + 2u * MP.n + i]); }
fn mp4(a: array<vec4f, 4>, c: u32) -> f32 { let g = gc(c); return a[g / 4u][g % 4u]; }   // (step C12c: an excited channel reads its
fn mpu(a: array<vec4u, 4>, c: u32) -> u32 { let g = gc(c); return a[g / 4u][g % 4u]; }    //  ground twin's numbers)
// the room a pixel has for a channel that fills it (1: all, ROOM_MIN: full or more). Never 0: a pixel packed fuller than
// full (a spring dripping into a droplet) still lets its matter out, and the droplet swells until it is full, not more
const ROOM_MIN: f32 = 0.05;
fn room(fill: u32, rho: f32, film: f32) -> f32 {
  if (fill == 1u) { return clamp(1.0 - rho, ROOM_MIN, 1.0); }
  if (fill == 2u) { return clamp(1.0 - film, ROOM_MIN, 1.0); }
  return 1.0;
}

// Step N1, CURRENTS (src/water.js): the water flows, carrying every mobile substance alike. The flow comes from a stream function
// psi stored at the pixels' corners: what crosses an edge per substep is a = (psi at one end of the edge - psi at the other) x
// dt / px^2 (a share of a pixel), so whatever flows into a pixel flows out of it (divergence-free, to the last bit in the corner
// differences) and psi = 0 all round the dish's rim (no flow through the wall). Upwind: a share a of the pixel it LEAVES crosses
// (a > 0: toward the edge's first pixel), added to the edge's flow before its random rounding, so the counts stay exact as before.
fn psi_at(x: u32, y: u32) -> f32 { return bitcast<f32>(mg[MP.n1.y + y * (MP.hw + 1u) + x]); }
// Step N2, SCOUR: the share of an edge's flow a the bed moves with, where it lifts from ac: a x carry x clamp((|a| - ac) / ac, 0, 1) (bedload:
// nothing below the lifting speed, all of `carry` from twice it). Per edge, from the edge's own share: the same number from both pixels
fn bed_share(a: f32, ac: f32) -> f32 { return a * MP.n2.y * clamp((abs(a) - ac) / max(ac, 1e-6), 0.0, 1.0); }
fn n2_bits() -> u32 { return bitcast<u32>(MP.n2.z); }
fn adv_up(mf: i32, ms: i32, a: f32) -> f32 { return select(a * f32(max(mf, 0)), a * f32(max(ms, 0)), a > 0.0); }

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
    // step G0b, OBSTACLES (src/obstacles.js): no flux across a face with a SOLID pixel (kinds 1 and 3; porous ones let matter through): both
    // pixels of such an edge drop it (fL..fD: the edges that carry matter). A solid pixel gives ALL its matter, every substep, to the neighbour
    // its way out points to (toward the nearest water: matter painted over, dripped or put down there leaves, whole counts), and takes what
    // solid neighbours deeper in give it. A pixel beside the round dish's rim (kind 3) is on the rim (its sink)
    let mo = MP.obs.x;
    var mw = 0u;
    var sN = vec4<bool>(false);       // L R U D: the neighbour is solid
    var tN = vec4<bool>(false);       // ... and gives its matter to this pixel
    var rimO = false;
    if (mo != 0u) {
      mw = bitcast<u32>(mg[mo + i]);
      if (hasL) { let q = bitcast<u32>(mg[mo + i - 1u]); sN.x = (q & 1u) != 0u; tN.x = ((q >> 2u) & 7u) == 2u; rimO = rimO || (q & 3u) == 3u; }
      if (hasR) { let q = bitcast<u32>(mg[mo + i + 1u]); sN.y = (q & 1u) != 0u; tN.y = ((q >> 2u) & 7u) == 1u; rimO = rimO || (q & 3u) == 3u; }
      if (hasU) { let q = bitcast<u32>(mg[mo + i - MP.hw]); sN.z = (q & 1u) != 0u; tN.z = ((q >> 2u) & 7u) == 4u; rimO = rimO || (q & 3u) == 3u; }
      if (hasD) { let q = bitcast<u32>(mg[mo + i + MP.hw]); sN.w = (q & 1u) != 0u; tN.w = ((q >> 2u) & 7u) == 3u; rimO = rimO || (q & 3u) == 3u; }
    }
    let solidHere = (mw & 1u) != 0u;
    let outHere = (mw >> 2u) & 7u;
    let fL = hasL && !sN.x && !solidHere;
    let fR = hasR && !sN.y && !solidHere;
    let fU = hasU && !sN.z && !solidHere;
    let fD = hasD && !sN.w && !solidHere;
    let rim = nEdges < 4 || rimO;
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
        if (spring_d((vec2f(id.xy) + 0.5) * MP.px, SP.s[k]) <= max(sp.z, 0.75 * MP.px)) { drip |= 1u << k; }
      }
      // step C12f: a HOT VENT's heat, shared evenly over its disc's pixels (random rounding), into the delta the heat's spreading
      // takes in this tick (heat_common.wgsl: the first block behind the ledger; only this invocation writes this pixel's word in
      // this dispatch), booked as energy in (LG_VENT)
      if (drip != 0u) {
        var hv = 0;
        for (var k = 0u; k < 16u; k++) {
          if ((drip & (1u << k)) == 0u) { continue; }
          let a = SP.s[k].amt[4].z / max(SP.s[k].amt[4].w, 1.0);
          if (a > 0.0) { hv += i32(floor(a + u01(mpcg(eI + k * 0x3c6ef372u + 0x0b5ad4ecu)))); }
        }
        if (hv != 0) { mg[i] += hv; atomicAdd(&wvent, hv); }
      }
    }
    // step C6b: the screened potential here and at the 4 neighbours (for the charged substances' drift)
    let po = MP.chg.x;
    var pC = 0.0; var pL = 0.0; var pR = 0.0; var pU = 0.0; var pD = 0.0;
    if (po != 0u) {
      pC = phi_at(po + i);
      if (hasL) { pL = phi_at(po + i - 1u); }
      if (hasR) { pR = phi_at(po + i + 1u); }
      if (hasU) { pU = phi_at(po + i - MP.hw); }
      if (hasD) { pD = phi_at(po + i + MP.hw); }
    }
    // step C12: the oil's share, film and smoothed share here and at the 4 neighbours (for the phase separation's drift)
    let oilOn = MP.oil.x != 0u && (MP.oil.y & 1u) != 0u;
    var oR = vec4f(0.0); var oF = vec4f(0.0); var oB = vec4f(0.0);   // at L R U D: rho, film, obar
    var cR = 0.0; var cF = 0.0; var cB = 0.0;                        // here
    if (oilOn) {
      cR = oil_rho_at(i); cF = oil_film_at(i); cB = oil_obar_at(i);
      if (hasL) { oR.x = oil_rho_at(i - 1u); oF.x = oil_film_at(i - 1u); oB.x = oil_obar_at(i - 1u); }
      if (hasR) { oR.y = oil_rho_at(i + 1u); oF.y = oil_film_at(i + 1u); oB.y = oil_obar_at(i + 1u); }
      if (hasU) { oR.z = oil_rho_at(i - MP.hw); oF.z = oil_film_at(i - MP.hw); oB.z = oil_obar_at(i - MP.hw); }
      if (hasD) { oR.w = oil_rho_at(i + MP.hw); oF.w = oil_film_at(i + MP.hw); oB.w = oil_obar_at(i + MP.hw); }
    }
    // step N1, currents: each edge's share toward its first pixel (L = (i - 1, i), R = (i, i + 1), U = (i - hw, i), D = (i, i + hw)),
    // each from the same two corners by the same expression from both of its pixels (so both get the same number, to the bit)
    var aE = vec4f(0.0);   // L R U D
    if (MP.n1.y != 0u) {
      let sc = bitcast<f32>(MP.n1.z);
      let p00 = psi_at(id.x, id.y);
      let p10 = psi_at(id.x + 1u, id.y);
      let p01 = psi_at(id.x, id.y + 1u);
      let p11 = psi_at(id.x + 1u, id.y + 1u);
      aE = vec4f(-(p01 - p00) * sc, -(p11 - p10) * sc, (p10 - p00) * sc, (p11 - p01) * sc);
      aE = clamp(aE, vec4f(-DRIFT_MAX), vec4f(DRIFT_MAX));
    }
    for (var c = 0u; c < NGRID; c++) {
      if ((MP.moving & (1u << c)) == 0u) { continue; }
      let s0 = T.src + c * MP.n;
      let m = mg[s0 + i];
      let k = mp4(MP.k, c);
      var acc = m;
      if (solidHere) {
        if (outHere != 0u) { acc = 0; }        // (step G0b: all of it out, toward the water)
      } else if (k <= 0.0 && (n2_bits() & 1u) != 0u && MP.n1.y != 0u) {
        // step N2, SCOUR: the bed (sediment: crust ll, LL) is lifted where the water runs fast and moves with it as bedload, settling where it
        // slows (src/flow.js). Its lifting share by its row (1 + its heavy share). No rim sink: it does not leave the dish
        let cs = c * 0x9e3779b9u;
        let ac = MP.n2.x * (1.0 + mp4(MP.heavy, c));
        if (fL) { acc -= edge_flow(mg[s0 + i - 1u], m, 0.0, bed_share(aE.x, ac), u01(mpcg(eL + cs))); }
        if (fR) { acc += edge_flow(m, mg[s0 + i + 1u], 0.0, bed_share(aE.y, ac), u01(mpcg(eR + cs))); }
        if (fU) { acc -= edge_flow(mg[s0 + i - MP.hw], m, 0.0, bed_share(aE.z, ac), u01(mpcg(eU + cs))); }
        if (fD) { acc += edge_flow(m, mg[s0 + i + MP.hw], 0.0, bed_share(aE.w, ac), u01(mpcg(eD + cs))); }
      } else if (k > 0.0) {
        let cs = c * 0x9e3779b9u;
        let zq = select(0.0, f32(charge_of(MP.chg.z, c)) * MP.cq.w, po != 0u);
        let chi = select(0.0, mp4(MP.chi, c), oilOn);
        let bet = select(0.0, mp4(MP.beta, c), oilOn);
        if (chi != 0.0 || bet != 0.0) {
          // step C12, phase separation: the pull u = gain x (chi x obar + beta x 4 obar (1 - obar)) (a higher u draws the
          // substance), the charge's drift on top; what may drift is x the room the receiving pixel has; the oil crossing
          // a film is slowed (skin). Every edge's numbers in the same order from both sides (antisymmetric, exact)
          // (each pixel's numbers by the same scalar functions, and each edge by oil_edge with (first, second) in the same
          // order from both sides, so the two pixels of an edge get the same flow to the bit: L = (i - 1, i), R = (i, i + 1),
          // U = (i - hw, i), D = (i, i + hw))
          let G = MP.ok.x;
          let fl = mpu(MP.fill, c);
          let skin = select(0.0, MP.ok.w, fl == 1u);
          let uC = oil_pull(G, chi, bet, cB);
          let rC = room(fl, cR, cF);
          if (fL) {
            acc -= oil_edge(mg[s0 + i - 1u], m, k, zq, pL, pC, oil_pull(G, chi, bet, oB.x), uC, room(fl, oR.x, oF.x), rC,
                            oF.x, cF, skin, aE.x, u01(mpcg(eL + cs)));
          }
          if (fR) {
            acc += oil_edge(m, mg[s0 + i + 1u], k, zq, pC, pR, uC, oil_pull(G, chi, bet, oB.y), rC, room(fl, oR.y, oF.y),
                            cF, oF.y, skin, aE.y, u01(mpcg(eR + cs)));
          }
          if (fU) {
            acc -= oil_edge(mg[s0 + i - MP.hw], m, k, zq, pU, pC, oil_pull(G, chi, bet, oB.z), uC, room(fl, oR.z, oF.z), rC,
                            oF.z, cF, skin, aE.z, u01(mpcg(eU + cs)));
          }
          if (fD) {
            acc += oil_edge(m, mg[s0 + i + MP.hw], k, zq, pC, pD, uC, oil_pull(G, chi, bet, oB.w), rC, room(fl, oR.w, oF.w),
                            cF, oF.w, skin, aE.w, u01(mpcg(eD + cs)));
          }
        } else if (zq != 0.0) {
          if (fL) { acc -= edge_flow_q(mg[s0 + i - 1u], m, pL, pC, k, zq, aE.x, u01(mpcg(eL + cs))); }
          if (fR) { acc += edge_flow_q(m, mg[s0 + i + 1u], pC, pR, k, zq, aE.y, u01(mpcg(eR + cs))); }
          if (fU) { acc -= edge_flow_q(mg[s0 + i - MP.hw], m, pU, pC, k, zq, aE.z, u01(mpcg(eU + cs))); }
          if (fD) { acc += edge_flow_q(m, mg[s0 + i + MP.hw], pC, pD, k, zq, aE.w, u01(mpcg(eD + cs))); }
        } else {
          if (fL) { acc -= edge_flow(mg[s0 + i - 1u], m, k, aE.x, u01(mpcg(eL + cs))); }
          if (fR) { acc += edge_flow(m, mg[s0 + i + 1u], k, aE.y, u01(mpcg(eR + cs))); }
          if (fU) { acc -= edge_flow(mg[s0 + i - MP.hw], m, k, aE.z, u01(mpcg(eU + cs))); }
          if (fD) { acc += edge_flow(m, mg[s0 + i + MP.hw], k, aE.w, u01(mpcg(eD + cs))); }
        }
        // step N1: trace SETTLES into the floor (src/oases.js: buried, like phosphate in sediment), booked as lost, so a plume fades
        // with distance and an old oasis's trace does not pile up for ever
        var bur = 0;
        if (first && c == CP.trace && m > 0 && MP.n1.w != 0u) {
          // step N2: it settles only where the water is slow (the share of its row's lifting speed the water here runs at keeps it up)
          var bshare = bitcast<f32>(MP.n1.w);
          if ((n2_bits() & 2u) != 0u) {
            let sp = 0.5 * length(vec2f(aE.x + aE.y, aE.z + aE.w));
            bshare *= clamp(1.0 - sp / max(3.0 * MP.n2.x, 1e-6), 0.0, 1.0);
          }
          bur = clamp(i32(floor(f32(m) * bshare + u01(mpcg(eI + cs + 0x7f4a7c15u)))), 0, m - nEdges * (m >> 2u));
          acc -= bur;
          if (bur != 0) { atomicAdd(&wlost[c], bur); }
        }
        // PERFUSION (src/perfusion.js): the OUTLET side's rim (chg.w: 1 right, 2 left, 3 bottom, 4 top) lets out its share sea.w per
        // tick instead, if larger: the water leaving the chip carries what it holds (booked as lost, as the rim's sink)
        let os = MP.chg.w;
        let atOut = (os == 1u && !hasR) || (os == 2u && !hasL) || (os == 3u && !hasD) || (os == 4u && !hasU);
        let esh = select(MP.edge, max(MP.edge, MP.sea.w), atOut);
        if (first && rim && m > 0 && esh > 0.0) {
          // the sink at the dish's rim: never more than the edges leave it (so it cannot go below zero)
          let out = clamp(i32(floor(f32(m) * esh + u01(mpcg(eI + cs)))), 0, m - nEdges * (m >> 2u) - bur);
          acc -= out;
          if (out != 0) { atomicAdd(&wlost[c], out); }
        }
      }
      // step C12f: the SEA tops its channel up toward its level, on a tick's first substep, everywhere (random rounding; never takes
      // anything out), booked as added (as a spring's)
      if (first && MP.sea.x > 0.0 && c == u32(MP.sea.z) && !solidHere) {   // (step G0b: not into a solid pixel)
        let want = MP.sea.x * max(0.0, 1.0 - f32(max(m, 0)) / max(MP.sea.y, 1.0));
        let add = i32(floor(want + u01(mpcg(eI + c * 0x85ebca6bu + 0x6a09e667u))));
        if (add > 0) { acc += add; atomicAdd(&wadd[c], add); atomicAdd(&wsea, add); }
      }
      if (drip != 0u && c < EXC0) {   // (step C12c: springs drip no excited atoms)
        var add = 0;
        for (var k = 0u; k < 16u; k++) {
          if ((drip & (1u << k)) == 0u) { continue; }
          let a = SP.s[k].amt[c / 4u][c % 4u] / max(SP.s[k].amt[4].w, 1.0);   // amt[19]: the disc's pixels
          if (a > 0.0) { add += i32(floor(a + u01(mpcg(eI + c * 0x85ebca6bu + k * 0x27d4eb2fu)))); }
        }
        acc += add;
        if (add != 0) { atomicAdd(&wadd[c], add); }
      }
      // step G0b: what the solid neighbours push out into this pixel (each gives all it holds to one neighbour: exact)
      if (mo != 0u) {
        if (tN.x) { acc += mg[s0 + i - 1u]; }
        if (tN.y) { acc += mg[s0 + i + 1u]; }
        if (tN.z) { acc += mg[s0 + i - MP.hw]; }
        if (tN.w) { acc += mg[s0 + i + MP.hw]; }
      }
      mg[T.dst + c * MP.n + i] = acc;
    }
  }
  workgroupBarrier();
  let slot = (wid.y * nw.x + wid.x) & 63u;
  if (first && li < NGRID) {
    add64(lg_mc(LG_M_LOST, li) + slot, atomicLoad(&wlost[li]));
    add64(lg_mc(LG_M_ADD, li) + slot, atomicLoad(&wadd[li]));
  }
  if (first && li == NGRID) {   // step C12f
    let v = atomicLoad(&wvent);
    if (v != 0) { atomicAdd(&hb[LG_VENT + slot], v); }
  } else if (first && li == NGRID + 1u) {
    let v = atomicLoad(&wsea);
    if (v != 0) { atomicAdd(&hb[LG_SEA + slot], v); }
  }
}

// ---------- oil_rho, oil_blur (step C12) ----------
// Once per tick, before the spreading's substeps (on the tick's current copy, T.src): rho (the oil's share: the counts of
// every channel x its oil volume, MP.vol, x 1 / full), film (the amphiphiles' atoms x 1 / filmFull), then obar: rho
// smoothed by a Gaussian (sigma: src/oil.js params.blur, pixels; separable, through a 4th block), at most 1 (at the dish's
// edge the missing pixels count as the edge pixel itself). A narrow kernel (3 x 3, 5 x 5) made the droplets diamonds: the
// rim then is a pixel wide and the grid's axes show. Written as f32 bits into the oil's blocks (MP.oil.x).
@compute @workgroup_size(8, 8)
fn oil_rho(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  let i = id.y * MP.hw + id.x;
  var v = 0.0;
  var f = 0.0;
  for (var c = 0u; c < NGRID; c++) {
    if ((MP.moving & (1u << c)) == 0u) { continue; }
    let vo = mp4(MP.vol, c);
    let fl = mpu(MP.fill, c);
    if (vo == 0.0 && fl != 2u) { continue; }
    let m = f32(max(mg[T.src + c * MP.n + i], 0));
    v += vo * m;
    if (fl == 2u) { f += mp4(MP.natoms, c) * m; }
  }
  mg[MP.oil.x + i] = bitcast<i32>(v * MP.ok.y);
  mg[MP.oil.x + MP.n + i] = bitcast<i32>(f * MP.ok.z);
}
// the smoothing: a Gaussian of sigma MP.oil.z (f32 bits, pixels), separable: along x into the 4th block, then along y
fn oil_gauss(o: u32, i: vec2i, d: vec2i) -> f32 {
  let sg = max(bitcast<f32>(MP.oil.z), 0.3);
  let r = min(i32(ceil(2.5 * sg)), 8);
  var s = 0.0;
  var ws = 0.0;
  for (var k = -r; k <= r; k++) {
    let q = clamp(i + k * d, vec2i(0), vec2i(i32(MP.hw) - 1, i32(MP.hh) - 1));
    let w = exp(-0.5 * f32(k * k) / (sg * sg));
    s += w * bitcast<f32>(mg[o + u32(q.y) * MP.hw + u32(q.x)]);
    ws += w;
  }
  return s / ws;
}
@compute @workgroup_size(8, 8)
fn oil_blur(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  mg[MP.oil.x + 3u * MP.n + id.y * MP.hw + id.x] = bitcast<i32>(oil_gauss(MP.oil.x, vec2i(id.xy), vec2i(1, 0)));
}
@compute @workgroup_size(8, 8)
fn oil_blur_y(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  let s = oil_gauss(MP.oil.x + 3u * MP.n, vec2i(id.xy), vec2i(0, 1));
  mg[MP.oil.x + 2u * MP.n + id.y * MP.hw + id.x] = bitcast<i32>(min(s, 1.0));
}

// ---------- count ----------
var<workgroup> wlo: array<atomic<u32>, 18>;
var<workgroup> whi: array<atomic<u32>, 18>;
var<workgroup> wml: array<vec2f, 256>;   // x: m ln m (ORDER); y: phi^2 (step C6b)
var<workgroup> wpm: atomic<i32>;          // step C6b: the largest |phi| (f32 bits)
var<workgroup> wos: array<atomic<i32>, 10>;   // step C12: the oil's census (OS_* below)

// step C12, the oil's census (LG_OIL_SNAP, 16 slots each; src/oil.js): pixels with rho >= 1/2 (the oily area); Gray's quad
// counts of that set for its Euler number (quads with 1 pixel in, 3 in, 2 diagonal); the amphiphiles' atoms on the
// boundary (0.15 < rho < 0.85) and in all (counts / 16); the oil's counts / 16 in the oily area; boundary pixels; the
// polar matter's counts / 16 inside the oily area and in all
const OS_AREA: u32 = 0u;
const OS_N1: u32 = 1u;
const OS_N3: u32 = 2u;
const OS_ND: u32 = 3u;
const OS_AMPB: u32 = 4u;
const OS_AMPT: u32 = 5u;
const OS_OILIN: u32 = 6u;
const OS_EDGE: u32 = 7u;
const OS_POLIN: u32 = 8u;
const OS_POLT: u32 = 9u;
fn oil_in(x: i32, y: i32) -> u32 {
  if (x < 0 || y < 0 || x >= i32(MP.hw) || y >= i32(MP.hh)) { return 0u; }
  return select(0u, 1u, oil_rho_at(u32(y) * MP.hw + u32(x)) >= 0.5);
}
// the quad of pixels (x - 1 .. x, y - 1 .. y): Euler number (8-connected) = (n1 - n3 - 2 nd) / 4
fn quad(os: ptr<function, array<i32, 10>>, x: i32, y: i32) {
  let a = oil_in(x - 1, y - 1);
  let b = oil_in(x, y - 1);
  let c = oil_in(x - 1, y);
  let d = oil_in(x, y);
  let s = a + b + c + d;
  if (s == 1u) { (*os)[OS_N1] += 1; }
  else if (s == 3u) { (*os)[OS_N3] += 1; }
  else if (s == 2u && a == d) { (*os)[OS_ND] += 1; }
}

// dispatched as 256 workgroups of 256 (a grid-stride loop over the pixels)
@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u) {
  var lo: array<u32, 18>;
  var hi: array<u32, 18>;
  var os: array<i32, 10>;   // step C12: the oil's census, this invocation's part
  var ml = 0.0;
  let order = T.first != 0u;
  // step C6b: with the snapshot, the potential's spread (sum of phi^2) and its largest size
  let phiOn = order && MP.chg.x != 0u;
  var p2 = 0.0;
  var pm = 0.0;
  for (var p = gid.x; p < T.count; p += 65536u) {
    if (MP.chg.x != 0u) {   // (not `if (phiOn)`: that read false inside this loop on Direct3D, though phiOn was true)
      let ph = phi_at(MP.chg.x + p);
      p2 += ph * ph;
      pm = max(pm, abs(ph));
    }
    var amp = 0;   // step C12: this pixel's amphiphile atoms, oil, polar matter (counts / 16)
    var oilc = 0;
    var pol = 0;
    for (var c = 0u; c < NGRID; c++) {
      let m = max(mg[T.src + c * T.count + p], 0);
      if (m == 0) { continue; }
      lo[c] += u32(m) & 0xffffu;
      hi[c] += u32(m) >> 16u;
      if (order) {
        let a = f32(m) * mp4(MP.natoms, c);   // atoms, in counts
        ml += a * log(a);
      }
      let fl = mpu(MP.fill, c);
      if (fl == 2u) { amp += (m * i32(mp4(MP.natoms, c))) >> 4u; }
      if (fl == 1u) { oilc += m >> 4u; }
      if (mp4(MP.chi, c) < 0.0) { pol += (m * i32(mp4(MP.natoms, c))) >> 4u; }
    }
    // step C12: the oil's census, with the snapshot (not inside an `if (oilCensus)`: see the Direct3D note above)
    if (T.first != 0u && MP.oil.x != 0u) {
      let r = oil_rho_at(p);
      let x = i32(p % MP.hw);
      let y = i32(p / MP.hw);
      if (r >= 0.5) { os[OS_AREA] += 1; os[OS_OILIN] += oilc; os[OS_POLIN] += pol; }
      if (r > 0.15 && r < 0.85) { os[OS_EDGE] += 1; os[OS_AMPB] += amp; }
      os[OS_AMPT] += amp;
      os[OS_POLT] += pol;
      // the 2 x 2 quads with this pixel as their bottom-right corner (and, on the last column and row, the ones beyond)
      quad(&os, x, y);
      if (x == i32(MP.hw) - 1) { quad(&os, x + 1, y); }
      if (y == i32(MP.hh) - 1) { quad(&os, x, y + 1); }
      if (x == i32(MP.hw) - 1 && y == i32(MP.hh) - 1) { quad(&os, x + 1, y + 1); }
    }
  }
  for (var c = 0u; c < NGRID; c++) {
    if (lo[c] != 0u) { atomicAdd(&wlo[c], lo[c]); }
    if (hi[c] != 0u) { atomicAdd(&whi[c], hi[c]); }
  }
  for (var k = 0u; k < 10u; k++) { if (os[k] != 0) { atomicAdd(&wos[k], os[k]); } }
  wml[li] = vec2f(ml, p2);
  if (phiOn && pm > 0.0) { atomicMax(&wpm, bitcast<i32>(pm)); }
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { wml[li] += wml[li + s]; }
    workgroupBarrier();
  }
  if (phiOn && li == 1u) {
    atomicStore(&hb[LG_Q_PHI + wid.x], bitcast<i32>(wml[0].y));
    let mx = atomicLoad(&wpm);
    if (mx > 0) { atomicMax(&hb[LG_Q_PMAX], mx); }
  }
  if (li < NGRID) {
    // the workgroup's total of channel li: H x 2^16 + L, added as a 64-bit number
    let L = atomicLoad(&wlo[li]);
    let H = atomicLoad(&whi[li]);
    let at = lg_mc(T.region, li) + (wid.x & 63u);
    add64v(at, i32(H >> 16u), H << 16u);
    add64v(at, 0, L);
  }
  if (order && li >= 32u && li < 42u) {
    let v = atomicLoad(&wos[li - 32u]);
    if (v != 0) { atomicAdd(&hb[LG_OIL_SNAP + 16u * (li - 32u) + (wid.x & 15u)], v); }
  }
  if (order && li == 0u) { atomicStore(&hb[LG_M_ORDER + wid.x], bitcast<i32>(wml[0].x)); }
}

// ---------- relax (step C6b) ----------
// The SCREENED charge field: phi - lambda^2 laplacian(phi) = strength x rho, with rho the charge density (the free atoms'
// charges, CHARGE_CODES, plus the cells' net charge they put down this tick), in atom-units per R^2. Its decay law is an
// exponential cut-off at the screening length lambda (like charge in salty water), with no flux through the dish's edge.
// Solved by red-black over-relaxation, a few sweeps per tick (src/charge.js), each sweep two dispatches (the pixels with
// x + y even, then odd: each colour reads only the other), in place, starting from last tick's phi: the charges move
// little in one tick, so the field follows them closely. Runs inside the heat's pass of the tick, after the reactions,
// on the copy they leave (T.dst of the tick's last substep slot).
fn relax(id: vec2u, parity: u32) {
  if (id.x >= MP.hw || id.y >= MP.hh || ((id.x + id.y) & 1u) != parity) { return; }
  let i = id.y * MP.hw + id.x;
  var q = 0;
  for (var c = 0u; c < NGRID; c++) {
    let z = charge_of(MP.chg.z, c);
    if (z != 0 && (MP.moving & (1u << c)) != 0u) { q += z * mg[T.dst + c * MP.n + i]; }
  }
  if (MP.chg.y != 0u) { q += mg[MP.chg.y + i]; }
  let po = MP.chg.x;
  var s = 0.0;
  var nn = 0.0;
  if (id.x > 0u) { s += phi_at(po + i - 1u); nn += 1.0; }
  if (id.x + 1u < MP.hw) { s += phi_at(po + i + 1u); nn += 1.0; }
  if (id.y > 0u) { s += phi_at(po + i - MP.hw); nn += 1.0; }
  if (id.y + 1u < MP.hh) { s += phi_at(po + i + MP.hw); nn += 1.0; }
  let gs = (MP.cq.y * f32(q) + MP.cq.x * s) / (1.0 + MP.cq.x * nn);
  let old = phi_at(po + i);
  mg[po + i] = bitcast<i32>(old + MP.cq.z * (gs - old));
}
@compute @workgroup_size(8, 8)
fn relax_red(@builtin(global_invocation_id) id: vec3u) { relax(id.xy, 0u); }
@compute @workgroup_size(8, 8)
fn relax_black(@builtin(global_invocation_id) id: vec3u) { relax(id.xy, 1u); }

// ---------- paint ----------
// texA: free atoms (all), of which reactive, of which heavy; trace.  texB: fuels, of which heavy; sediment, of which heavy.
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  let i = id.y * MP.hw + id.x;
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  var o = vec4f(0.0);   // step C12: the oil's share (as rho), the film's share, polar atoms, apolar atoms (per R^2)
  var ex = 0.0;         // step C12c: the excited atoms (per R^2)
  var mn = vec2f(0.0);  // step C12d: the minerals (per R^2), of which heavy
  for (var c = 0u; c < NGRID; c++) {
    if (MP.show == 2u && c != MP.solo) { continue; }
    let mc = f32(max(mg[T.src + c * MP.n + i], 0));
    let v = min(mc * MP.conc, 60000.0);
    if (v <= 0.0) { continue; }
    let h = mp4(MP.heavy, c);
    let chi = mp4(MP.chi, c);
    let na = mp4(MP.natoms, c);
    if (chi < 0.0) { o.z += v * na; } else if (chi > 0.0 || mp4(MP.beta, c) > 0.0) { o.w += v * na; }
    if (c >= EXC0) { ex += v; continue; }   // step C12c: drawn as their own sparkle (matter_draw.wgsl), not as dust
    switch MP.layer[c / 4u][c % 4u] {
      case 0u: { a += vec4f(v, v * MP.react[c / 4u][c % 4u], v * h, 0.0); }
      case 1u: { b += vec4f(v, v * h, 0.0, 0.0); }
      case 2u: { b += vec4f(0.0, 0.0, v, v * h); }
      case 4u: { o.x += mp4(MP.vol, c) * mc * MP.ok.y; }
      case 5u: { o.x += mp4(MP.vol, c) * mc * MP.ok.y; o.y += na * mc * MP.ok.z; }
      case 7u: { mn += vec2f(v, v * h); }   // step C12d: minerals
      default: { a.w += v; }
    }
  }
  textureStore(texA, vec2i(id.xy), a);
  textureStore(texB, vec2i(id.xy), b);
  textureStore(texC, vec2i(id.xy), min(o, vec4f(60000.0)));
  // step C12d (electrons): what this pixel re-emits as fluorescence per tick (heat counts), in visible 1 and visible 2, worked out
  // as react shares the light (every light reaction's depth; the glow's share of its band), from the current copy
  var gl = vec2f(0.0);
  if (CP.el.x > 0.5 && MP.show != 0u) {
    let et = light_here(id.xy);
    if (any(et > vec4f(0.0))) {
      var m: array<i32, 18>;
      for (var c = 0u; c < 16u; c++) { m[c] = max(mg[T.src + c * MP.n + i], 0); }
      var tsum = vec4f(0.0);
      var tdark = 0.0;
      for (var r = 0u; r < CP.nrx; r++) {
        let R = CP.rx[r];
        if (R.by != 1u) { continue; }
        var amt = f32(m[R.ch.x]) * MP.conc;
        if (R.ch.y != NONE) { let b = f32(m[R.ch.y]) * MP.conc; amt = amt * b / max(amt + b, 1e-12); }
        tsum[R.band] += R.k * amt;
      }
      for (var c = 0u; c < 16u; c++) { tdark += CP.dark[c / 4u][c % 4u] * f32(m[c]) * MP.conc; }
      tsum.x += tdark;
      let caught = et * (1.0 - exp(-tsum));
      for (var r = 0u; r < CP.nrx; r++) {
        let R = CP.rx[r];
        let emit = (R.open >> 8u) & 255u;
        if (emit < 2u || R.by != 1u) { continue; }
        let tau = R.k * f32(m[R.ch.x]) * MP.conc;
        let e = caught[R.band] * tau / max(tsum[R.band], 1e-12) * f32(R.light16 - R.heat16) / f32(max(R.light16, 1));
        if (emit == 2u) { gl.x += e; } else { gl.y += e; }
      }
    }
  }
  textureStore(texD, vec2i(id.xy), vec4f(min(ex + gl.x, 60000.0), min(mn.x, 60000.0), min(mn.y, 60000.0), min(gl.y, 60000.0)));
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
var<workgroup> wfam: array<atomic<i32>, 10>;
var<workgroup> wlit: array<atomic<i32>, 4>;
var<workgroup> wxn: array<atomic<i32>, 4>;   // step C12c: excited atoms made, faded, used (XN_MADE_OPEN, XN_FADE_OPEN, XN_RX_OPEN), and
var<workgroup> wxe: array<atomic<i32>, 3>;   // ... their energy as heat: faded (XE_FADE), used by reactions (XE_LOOSE); step C12d (electrons,
                                             // where those are empty): excitations, fluoresced, photochemistry; the glow's energy in all
                                             // (XE_FADE), in visible 1 (XE_LOOSE), in visible 2 (XE_ENGINE)

// step C12c: a reaction's reactant channel c as a POOL: a light giver or taker with its excited twin (they react alike)
fn xpool(m: ptr<function, array<i32, 18>>, c: u32) -> i32 {
  if (c < 2u) { return (*m)[c] + (*m)[c + EXC0]; }
  return (*m)[c];
}
// ... n counts taken out of the pool of c: the excited ones in proportion (rounded at random with r); returns how many were excited
fn xtake(m: ptr<function, array<i32, 18>>, c: u32, n: i32, r: f32) -> i32 {
  if (c >= 2u || (*m)[c + EXC0] <= 0) { (*m)[c] -= n; return 0; }
  let x = (*m)[c + EXC0];
  let tot = (*m)[c] + x;
  var nx = i32(floor(f32(n) * f32(x) / f32(max(tot, 1)) + r));
  nx = clamp(nx, max(n - (*m)[c], 0), min(n, x));
  (*m)[c + EXC0] -= nx;
  (*m)[c] -= n - nx;
  return nx;
}

// the light that reaches the substances in pixel id (counts per pixel per tick, per band): the band's light there after the bare
// medium, the cells (their cover, 3 x 3 mean) and the cells' pigments took their share (step C12d: paint uses it too, for the glow)
fn light_here(id: vec2u) -> vec4f {
  if (CP.light == 0u || LP.mode == LIGHT_OFF) { return vec4f(0.0); }
  let i = id.y * MP.hw + id.x;
  var s = light_factor(LP, (vec2f(id) + 0.5) * MP.px);
  if (MP.n1.x != 0u) { s *= bitcast<f32>(mg[MP.n1.x + i]); }   // step N1: x the caustic light (src/water.js)
  if (s <= 0.0) { return vec4f(0.0); }
  let co = 3u * MP.n;   // the cells' cover (heat_common.wgsl), written by their step this tick
  var cov = 0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = clamp(vec2i(id) + vec2i(dx, dy), vec2i(0), vec2i(i32(MP.hw) - 1, i32(MP.hh) - 1));
      cov += mg[co + u32(q.y) * MP.hw + u32(q.x)];
    }
  }
  let cover = f32(cov) / (9.0 * COVER_SCALE);
  // step C6: and minus what the cells' pigments caught (their depth, which each cell spread over its 3 x 3 pixels, per band)
  var pig = vec4f(0.0);
  if (MP.pig != 0u) {
    for (var b = 1u; b < 4u; b++) { pig[b] = f32(mg[MP.pig + (b - 1u) * MP.n + i]) / COVER_SCALE; }
  }
  return LP.power * s * exp(-(LP.tauMed + LP.tauCell * cover + pig));
}

@compute @workgroup_size(8, 8)
fn react(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
         @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  if (id.x < MP.hw && id.y < MP.hh) {
    let i = id.y * MP.hw + id.x;
    let base = T.dst;
    var m: array<i32, 18>;
    var m0: array<i32, 18>;
    var stuff = 0;
    for (var c = 0u; c < NGRID; c++) {
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
      let et = light_here(id.xy);
      // optical depths of the absorbers, per reaction and per band
      var tau: array<f32, 48>;
      var tsum = vec4f(0.0);
      var tdark = 0.0;
      if (any(et > vec4f(0.0))) {
        for (var r = 0u; r < CP.nrx; r++) {
          let R = CP.rx[r];
          if (R.by != 1u) { continue; }
          let a = f32(xpool(&m, R.ch.x)) * conc;
          var amt = a;
          if (R.ch.y != NONE) {
            let b = f32(xpool(&m, R.ch.y)) * conc;
            amt = a * b / max(a + b, 1e-12);
          }
          tau[r] = R.k * amt;
          tsum[R.band] += tau[r];
        }
        for (var c = 0u; c < 16u; c++) { tdark += CP.dark[c / 4u][c % 4u] * f32(m[c]) * conc; }   // (sediment; step C12d: whatever has a warm gap)
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
          var sc = sparkScale;
          // step C7b, crystal seeding: a chain forms more easily where its own sediment already is (the pixel's, or the
          // mean of its 4 neighbours' if more: their last tick's, from the copy this tick's spreading read, so no pixel
          // reads what another writes now), spark x max(floor, 1 / (1 + s / s0))
          if (R.fam == 4u && CP.cry.x > 0.0 && m[R.ch.x] > 1) {
            let o = T.src + R.ch.z * MP.n + i;
            var nb = 0;
            if (id.x > 0u) { nb += mg[o - 1u]; }
            if (id.x + 1u < MP.hw) { nb += mg[o + 1u]; }
            if (id.y > 0u) { nb += mg[o - MP.hw]; }
            if (id.y + 1u < MP.hh) { nb += mg[o + MP.hw]; }
            let s = max(f32(m[R.ch.z]), 0.25 * f32(nb)) * conc;
            sc *= max(CP.cry.z, 1.0 / (1.0 + s * CP.cry.y));
          }
          x = R.k * f32(xpool(&m, R.ch.x)) * exp(-R.spark * sc / (CP.theta * temp)) * CP.dt;
          if (R.ch.y != NONE) { x *= f32(xpool(&m, R.ch.y)) * conc; }
        } else if (tau[r] > 0.0) {
          x = caught[R.band] * tau[r] / tsum[R.band] / f32(R.light16);
        }
        var n = i32(floor(x + u01(mpcg(rs + r * 0x9e3779b9u))));
        if (R.ch.y == R.ch.x) {
          n = min(n, m[R.ch.x] / 2);
        } else {
          n = min(n, xpool(&m, R.ch.x));
          if (R.ch.y != NONE) { n = min(n, xpool(&m, R.ch.y)); }
        }
        if (n <= 0) { continue; }
        // (step C12c: an excited reactant reacts as its ground atom and lets its stored energy go as heat, on the spot)
        var nx = 0;
        if (R.ch.y == R.ch.x) { m[R.ch.x] -= 2 * n; }
        else {
          nx += xtake(&m, R.ch.x, n, u01(mpcg(rs + r * 0x51ed27u + 0x1b873593u)));
          if (R.ch.y != NONE) { nx += xtake(&m, R.ch.y, n, u01(mpcg(rs + r * 0x51ed27u + 0x68e31da4u))); }
        }
        m[R.ch.z] += n;
        if (R.ch.w != NONE) { m[R.ch.w] += n; }
        if (nx > 0) {
          heat += nx * i32(CP.ex.y);
          atomicAdd(&wxn[2], nx);
          atomicAdd(&wxe[1], nx * i32(CP.ex.y));
        }
        if (R.ch.z >= EXC0 && R.ch.z != NONE) { atomicAdd(&wxn[0], n); }   // (light freed them excited)
        if (R.ch.w >= EXC0 && R.ch.w != NONE) { atomicAdd(&wxn[0], n); }
        heat += n * R.heat16;
        // (step C12d: an excited state's event; a fluorescence event books only the photon's rest as caught: the light it emits
        // passes on, out of the dish)
        let emit = (R.open >> 8u) & 255u;
        if (R.by == 1u) { lit[R.band] += n * select(R.light16, R.heat16, emit != 0u); }
        if ((R.open & 2u) != 0u) { atomicAdd(&wxn[0], n); }
        if ((R.open & 4u) != 0u) { atomicAdd(&wxn[2], n); }
        if (emit != 0u) {
          let e = n * (R.light16 - R.heat16);
          atomicAdd(&wxn[1], n);
          atomicAdd(&wxe[0], e);
          if (emit == 2u) { atomicAdd(&wxe[1], e); }        // visible 1: gold
          else if (emit == 3u) { atomicAdd(&wxe[2], e); }   // visible 2: sky blue
        }
        if (R.fam < 10u) { atomicAdd(&wfam[R.fam], n); }
      }

      // step C12c: the excited atoms FADE to their ground atom by themselves, the energy they held as heat on the spot, at the
      // rate 1 / lifetime x (1 + temperature / hot): the haze is rich but temporary, and fades faster where it is hot
      if (m[EXC0] + m[EXC0 + 1u] > 0) {
        let pf = clamp(CP.ex.z * (1.0 + temp / max(CP.ex.w, 1e-3)) * CP.dt, 0.0, 1.0);
        var nf = 0;
        for (var j = 0u; j < 2u; j++) {
          let x = m[EXC0 + j];
          if (x <= 0) { continue; }
          let f = min(i32(floor(f32(x) * pf + u01(mpcg(rs + j * 0x2c1b3c6du + 0x7f4a7c15u)))), x);
          m[EXC0 + j] -= f;
          m[j] += f;
          nf += f;
        }
        if (nf > 0) {
          heat += nf * i32(CP.ex.y);
          atomicAdd(&wxn[1], nf);
          atomicAdd(&wxe[0], nf * i32(CP.ex.y));
        }
      }
      for (var c = 0u; c < NGRID; c++) {
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
  } else if (li < 14u) {
    add64(LG_OIL_RX + 128u * (li - 10u) + slot, atomicLoad(&wfam[li - 4u]));   // step C12: families 6..9
  } else if (li < 17u) {
    // step C12c: excited atoms made by light, faded, used by reactions (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wxn[li - 14u]);
    let q = select(select(XN_RX_OPEN, XN_FADE_OPEN, li == 15u), XN_MADE_OPEN, li == 14u);
    if (v != 0) { atomicAdd(&hb[LG_EXC_N + 16u * q + (slot & 15u)], v); }
  } else if (li < 20u) {
    let q = select(select(XE_ENGINE, XE_LOOSE, li == 18u), XE_FADE, li == 17u);
    add64(LG_EXC_E + 128u * q + slot, atomicLoad(&wxe[li - 17u]));
  }
}
