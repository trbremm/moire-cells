// Cells eat (Part C, step C5): every cell's STOCK of the 13 substances and its BATTERY, in their own buffer (16 i32 per
// cell: channels 0..12 in substance counts, ATOM_SCALE per unit, as the grid; word 13 the battery in heat counts,
// HEAT_SCALE per energy unit; 14, 15 spare). field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended
// (src/eat.js). Every amount is a whole count and every move is an atomic add or a "take" (below), so matter stays
// exact to the count and energy to the heat count.
//
// Each tick, after the cells' step and before the substances spread (src/cells.js), four dispatches in one pass:
//   dump   a slot whose cell died this tick (CELL_BORN, set by the step's turnover): the dead cell's stock goes back to
//          the dish where it died (Cell.dead; over the 3 x 3 pixels there), its battery as heat; a channel the dish is
//          not moving this frame (EP.mask) cannot be written (both its copies must stay all zero), so it is booked as
//          gone (as a wash) instead: rare, as the cells hold only what is in the dish or made from it
//   split  each newborn takes half of its parent's stock and battery (Cell.mom), so a birth splits, never copies
//   plan   every cell, reading plainly: how much of each substance its membrane lets in or out this tick (passive, by
//          concentration, per substance at its own rate; into `flux`), the temperature under it, and its SMELL (the fuel
//          gradient across the membrane's 6 corners, into Cell.smell for the next tick's step)
//   eat    every cell: pays its crawl (Cell.pay) from the battery; trades with the 3 x 3 pixels under it through the
//          membrane (the plan's flux); runs its built-in BURNER (fuel ->
//          its atoms, the bond energy into the battery minus a heat share; the spark is paid from the battery first,
//          so an empty battery starts nothing); runs the table's heat-driven reactions inside (the same rules as in
//          the open: swaps, fuel breaking by heat, sediment forming; sparks from the local heat, no light inside);
//          expels the sediment it formed; writes its battery share and fill into its Cell for the step and the drawing
//   ledger once per frame: the substances in all cells per channel and the batteries (64-bit), and a few cell counts
//   reset  a new culture (N, G): every cell's stock back to the dish at its place, its battery as heat, then the
//          starter charge into every battery (booked as energy in)
//
// A TAKE from a word other invocations may also change (a grid pixel, a parent's stock): subtract what is wanted, keep
// what was there (at most the want), and add back the rest. Whatever the order, no word goes below zero for good and
// the takers together get no more than was there.

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> stock: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> hb: array<atomic<i32>>;   // the heat buffer (heat_common.wgsl)
@group(0) @binding(4) var<uniform> EP: EatP;
@group(0) @binding(5) var<uniform> CP: ChemP;                           // step C4's reactions (heat_common.wgsl)
@group(0) @binding(6) var<uniform> HP: HeatP;
@group(0) @binding(9) var<storage, read_write> flux: array<i32>;      // per cell 16: the exchange per channel (+ in, - out),
                                                                    // [15] the temperature under it (f32 bits)
// The plan pass sees the same buffers through plain views (no atomics: on Direct3D an atomic load is a read-modify-write,
// so reading the 3 x 3 pixels of 13 channels per cell through atomics cost as much as the rest of the tick): the stock,
// and the heat buffer's grid part (everything behind the ledger), read only.
@group(0) @binding(2) var<storage, read_write> stockP: array<i32>;
@group(0) @binding(7) var<storage, read_write> mg: array<i32>;

const SW: u32 = 16u;       // stock words per cell
const BAT: u32 = 13u;      // the battery's word

// what src/eat.js writes once per frame (384 bytes)
struct EatP {
  flags: u32,              // EF_* below
  mask: u32,               // bit c: the dish moves channel c this frame (the cells may put matter into it)
  n: u32,                  // grid pixels (the substance channels' stride)
  ineff: u32,              // the burner's heat share x 256
  sedMask: u32,            // bit c: channel c is sediment (it never passes the membrane; formed inside, it is expelled)
  starter: i32,            // reset: every cell's starter charge (heat counts)
  batMax: i32,             // battery capacity (heat counts)
  resetCur: u32,           // reset: word offset of the substances' current copy (0 = none)
  dt: f32,
  R: f32,
  capR2: f32,              // stock capacity: atom-units per R^2 of the cell's area
  kBurner: f32,            // the burner: share of the fuel in stock it burns per s
  burnMax: f32,            // ... at most this many fuel counts per tick
  tol: f32,                // ledger: the heat damage's tolerance (temperature), to count the cells above it
  heatEnd: u32,            // ledger: word offset of the heat copy current after the frame's ticks
  smell: u32,              // plan: 1 = work out the smell (Cell.smell)
  perm: array<vec4f, 4>,   // per channel: how fast it equalises through the membrane (per s; 0 never)
  e16: array<vec4i, 4>,    // per channel: heat counts per count (16 x its energy)
  pair: array<vec4u, 4>,   // per channel: a fuel's two atoms' channels, x | y << 8 (0xffff: not a fuel)
  natoms: array<vec4f, 4>, // per channel: atoms per unit
  spark: array<vec4f, 4>,  // per channel: its bond's spark (energy units)
};
const EF_EAT: u32 = 1u;      // the membrane trades (cells eat, Shift+A)
const EF_BURN: u32 = 2u;     // the burner (Shift+U)
const EF_INSIDE: u32 = 4u;   // the table's reactions inside cells (Shift+I)

// counters (LG_K_EV + 128 k): per workgroup in wev, then one 64-bit add
const EV_BURNED: u32 = 0u;      // fuel counts the burners broke
const EV_GAIN: u32 = 1u;        // heat counts into the batteries
const EV_BHEAT: u32 = 2u;       // heat counts the burners lost as heat
const EV_IN_BURN: u32 = 3u;     // inside reactions: fuel broken by heat (counts)
const EV_IN_SWAP: u32 = 4u;     // ... swaps
const EV_IN_FORM: u32 = 5u;     // ... sediment formed
const EV_UPTAKE: u32 = 6u;      // atoms (counts) taken in through the membrane
const EV_RELEASE: u32 = 7u;     // atoms (counts) let out
const EV_EXPEL: u32 = 8u;       // sediment counts expelled
const EV_PAID: u32 = 9u;        // heat counts the batteries paid for crawling
const EV_DUMP: u32 = 10u;       // atoms (counts) back to the dish from dead cells (and at a reset)
const EV_BATBACK: u32 = 11u;    // heat counts: dead cells' batteries become heat
const EV_GONE: u32 = 12u;       // atoms (counts) booked as gone at a death (their channel not moving)
const EV_IN_HEAT: u32 = 13u;    // heat counts released by the reactions inside
var<workgroup> wev: array<atomic<i32>, 16>;

fn add64(lo: u32, x: i32) {
  if (x == 0) { return; }
  let old = bitcast<u32>(atomicAdd(&hb[lo], x));
  var c = select(0, 1, old + bitcast<u32>(x) < old);
  if (x < 0) { c -= 1; }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}
fn add64v(lo: u32, carry: i32, low: u32) {
  var c = carry;
  if (low != 0u) {
    let old = bitcast<u32>(atomicAdd(&hb[lo], bitcast<i32>(low)));
    if (old + low < old) { c += 1; }
  }
  if (c != 0) { atomicAdd(&hb[lo + 64u], c); }
}

fn take_hb(a: u32, want: i32) -> i32 {
  if (want <= 0) { return 0; }
  let old = atomicSub(&hb[a], want);
  let got = clamp(old, 0, want);
  if (got < want) { atomicAdd(&hb[a], want - got); }
  return got;
}
fn take_stock(a: u32, want: i32) -> i32 {
  if (want <= 0) { return 0; }
  let old = atomicSub(&stock[a], want);
  let got = clamp(old, 0, want);
  if (got < want) { atomicAdd(&stock[a], want - got); }
  return got;
}

fn ep_f(a: array<vec4f, 4>, c: u32) -> f32 { return a[c / 4u][c % 4u]; }
fn ep_i(a: array<vec4i, 4>, c: u32) -> i32 { return a[c / 4u][c % 4u]; }
fn ep_u(a: array<vec4u, 4>, c: u32) -> u32 { return a[c / 4u][c % 4u]; }

// the 3 x 3 heat / substance pixels around a position (clamped into the grid)
fn footprint(p: vec2f) -> array<u32, 9> {
  let h = heat_xy(HP, p);
  var idx: array<u32, 9>;
  for (var q = 0; q < 9; q++) {
    let x = clamp(h + vec2i(q % 3 - 1, q / 3 - 1), vec2i(0), vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1));
    idx[q] = u32(x.y) * HP.hw + u32(x.x);
  }
  return idx;
}

// v spread evenly over the 9 words base + idx[q] (the remainder to the middle one)
fn spread9(base: u32, idx: array<u32, 9>, v: i32) {
  if (v == 0) { return; }
  let part = v / 9;
  for (var q = 0; q < 9; q++) {
    let x = select(part, v - 8 * part, q == 4);
    if (x != 0) { atomicAdd(&hb[base + idx[q]], x); }
  }
}

// a cell's whole stock and battery back to the dish at position p (dump and reset); returns nothing, books the counters
fn give_back(i: u32, p: vec2f, cur: u32, slot: u32) {
  let idx = footprint(p);
  var back = 0;
  var gone = 0;
  for (var c = 0u; c < NCH; c++) {
    let m = atomicExchange(&stock[i * SW + c], 0);
    if (m <= 0) { continue; }
    let na = i32(ep_f(EP.natoms, c));
    if (cur != 0u && (EP.mask & (1u << c)) != 0u) {
      spread9(cur + c * EP.n, idx, m);
      back += m * na;
    } else {
      add64(LG_M_GONE + 128u * c + slot, m);
      gone += m * na;
    }
  }
  let b = atomicExchange(&stock[i * SW + BAT], 0);
  if (b > 0) { spread9(LEDGER_WORDS, idx, b); }
  atomicAdd(&wev[EV_DUMP], back);
  atomicAdd(&wev[EV_GONE], gone);
  atomicAdd(&wev[EV_BATBACK], max(b, 0));
}

fn flush_counters(li: u32, slot: u32) {
  workgroupBarrier();
  if (li < 16u) {
    let v = atomicLoad(&wev[li]);
    if (v != 0) { add64(LG_K_EV + 128u * li + slot, v); }
  }
}

// ---------- dump ----------
@compute @workgroup_size(64)
fn dump(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  if (i < S.count) {
    let c = cells[i];
    if ((c.flags & CELL_BORN) != 0u) { give_back(i, c.dead, S.matterCur, wid.x & 63u); }
  }
  flush_counters(li, wid.x & 63u);
}

// ---------- split ----------
@compute @workgroup_size(64)
fn split(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let c = cells[i];
  if ((c.flags & CELL_BORN) == 0u) { return; }
  let pi = min(c.mom, S.count - 1u);
  if (pi != i) {
    for (var k = 0u; k <= BAT; k++) {
      let h = atomicLoad(&stock[pi * SW + k]);
      let got = take_stock(pi * SW + k, h / 2);
      if (got > 0) { atomicAdd(&stock[i * SW + k], got); }
    }
  }
  cells[i].flags = c.flags & ~CELL_BORN;
}

// ---------- plan (plain reads) ----------
// The exchange: outside, the 9 pixels' amount over their area; inside, the stock over the cell's area. Per tick each
// channel moves a share min(1, perm x dt) of the way to equal concentrations (so it is stable at any rate); an inflow is
// scaled by the room left (1 - fill), so a cell cannot hoard more than its capacity.
@compute @workgroup_size(64)
fn plan(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let c = cells[i];
  let fo = i * SW;
  let idx = footprint(c.pos);
  let lw = LEDGER_WORDS;
  // the temperature under the cell
  var hsum = 0;
  for (var q = 0; q < 9; q++) { hsum += mg[S.heatCur - lw + idx[q]]; }
  flux[fo + 15u] = bitcast<i32>(f32(hsum) / 9.0 * HP.tempScale);
  let cur = S.matterCur;
  let eatOn = (EP.flags & EF_EAT) != 0u && cur != 0u && (c.flags & CELL_ALIVE) != 0u;
  let areaPx = 3.14159265 * c.r * c.r;
  let areaR2 = max(areaPx / (EP.R * EP.R), 1e-3);
  let cap = EP.capR2 * areaR2 * ATOM_SCALE;
  var atomsIn = 0.0;
  for (var k = 0u; k < NCH; k++) { atomsIn += f32(stockP[fo + k]) * ep_f(EP.natoms, k); }
  let room = clamp(1.0 - atomsIn / max(cap, 1.0), 0.0, 1.0);
  let Ao = 9.0 * HP.px * HP.px;
  let rs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + 0x2c1b3c6du));
  for (var k = 0u; k < NCH; k++) {
    var n = 0;
    let pk = ep_f(EP.perm, k);
    if (eatOn && pk > 0.0 && (EP.mask & (1u << k)) != 0u) {
      let base = cur - lw + k * EP.n;
      var Mo = 0;
      for (var q = 0; q < 9; q++) { Mo += max(mg[base + idx[q]], 0); }
      let Mi = stockP[fo + k];
      if (Mo != 0 || Mi != 0) {
        let jeq = (f32(Mo) * areaPx - f32(Mi) * Ao) / (Ao + areaPx);
        var j = jeq * min(1.0, pk * EP.dt);
        if (j > 0.0) { j *= room; }
        n = i32(floor(j + u01(pcg(rs + k * 0x85ebca6bu))));
        n = clamp(n, -Mi, Mo);
      }
    }
    flux[fo + k] = n;
  }
  var g = vec2f(0.0);
  cells[i].smell = g;
}

// ---------- eat ----------
@compute @workgroup_size(64)
fn eat(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  let slot = wid.x & 63u;
  if (i < S.count && (cells[i].flags & CELL_ALIVE) != 0u) {
    let c = cells[i];
    let o = i * SW;
    var m: array<i32, 13>;
    var m0: array<i32, 13>;
    for (var k = 0u; k < NCH; k++) { m[k] = atomicLoad(&stock[o + k]); m0[k] = m[k]; }
    var bat = atomicLoad(&stock[o + BAT]);
    let bat0 = bat;
    let batMax = max(EP.batMax, 1);
    var heat = 0;

    // crawling: the step worked out what its crawl costs; the battery pays what it can (the battery's energy became
    // part of the crawl's work, which the step booked as work coming in: so that much less comes in from outside)
    let pay = clamp(c.pay, 0, bat);
    if (pay > 0) {
      bat -= pay;
      atomicAdd(&hb[LG_WORK + (i & 255u)], -pay);
      atomicAdd(&wev[EV_PAID], pay);
    }

    let idx = footprint(c.pos);
    let cur = S.matterCur;
    let areaPx = 3.14159265 * c.r * c.r;                     // the cell's area, CSS px^2
    let areaR2 = max(areaPx / (EP.R * EP.R), 1e-3);          // ... in R^2
    let cap = EP.capR2 * areaR2 * ATOM_SCALE;                // stock capacity, atom counts
    let rs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + 0x51ed27u));

    // ---- the membrane: the exchange the plan pass worked out (flux), with the 3 x 3 pixels under the cell. An uptake
    // takes an even share from each pixel (a take: a pixel that has less gives what it has); a release is spread evenly.
    // Only channels that move touch the grid, so a cell in an empty place costs no atomics here.
    let fo = i * SW;
    if ((EP.flags & EF_EAT) != 0u && cur != 0u) {
      var up = 0;
      var down = 0;
      for (var k = 0u; k < NCH; k++) {
        let n = flux[fo + k];
        if (n == 0 || (EP.mask & (1u << k)) == 0u) { continue; }
        let base = cur + k * EP.n;
        let na = i32(ep_f(EP.natoms, k));
        if (n > 0) {
          let part = n / 9;
          var got = 0;
          for (var q = 0; q < 9; q++) { got += take_hb(base + idx[q], select(part, n - 8 * part, q == 4)); }
          m[k] += got;
          up += got * na;
        } else {
          let give = min(-n, m[k]);
          if (give > 0) {
            spread9(base, idx, give);
            m[k] -= give;
            down += give * na;
          }
        }
      }
      atomicAdd(&wev[EV_UPTAKE], up);
      atomicAdd(&wev[EV_RELEASE], down);
    }

    // the temperature under the cell (its 3 x 3 pixels' mean, from the plan pass), for the sparks of the reactions inside
    let temp = max(bitcast<f32>(flux[fo + 15u]), 1e-4);
    let concIn = 1.0 / (ATOM_SCALE * areaR2);                  // stock counts x concIn = units per R^2 inside
    var sparkScale = 1.0;
    if (CP.traceOn != 0u) { sparkScale = 1.0 / (1.0 + CP.traceK * f32(m[CP.trace]) * concIn); }

    // ---- the burner: fuel -> its two atoms, the bond's energy into the battery minus the heat share ----
    // The spark of each event is paid from the battery first and given back (the reaction is downhill), so a battery
    // holding less than one event's spark starts nothing. Rate: kBurner x the fuel in stock per s, at most burnMax counts
    // per tick in all, and no more than the battery has room for.
    if ((EP.flags & EF_BURN) != 0u) {
      var left = i32(EP.burnMax);
      for (var f = FUEL_CH; f < FUEL_CH + 4u; f++) {
        if (m[f] <= 0 || left <= 0) { continue; }
        let e16 = ep_i(EP.e16, f);
        let h1 = (e16 * i32(EP.ineff)) / 256;                 // heat share of one event (whole counts)
        let g1 = e16 - h1;                                     // ... and what the battery keeps
        let sp16 = max(i32(ceil(ep_f(EP.spark, f) * sparkScale * 16.0)), 1);
        var n = i32(floor(EP.kBurner * f32(m[f]) * EP.dt + u01(pcg(rs + f * 0x3c6ef372u))));
        n = min(n, min(m[f], left));
        n = min(n, bat / sp16);                                // the spark: an empty battery starts nothing
        n = min(n, max(batMax - bat, 0) / max(g1, 1));         // a full battery takes nothing more
        if (n <= 0) { continue; }
        let pr = ep_u(EP.pair, f);
        m[f] -= n;
        m[pr & 255u] += n;
        m[(pr >> 8u) & 255u] += n;
        bat += n * g1;
        heat += n * h1;
        left -= n;
        atomicAdd(&wev[EV_BURNED], n);
        atomicAdd(&wev[EV_GAIN], n * g1);
        atomicAdd(&wev[EV_BHEAT], n * h1);
      }
    }

    // write back what changed (only this invocation touches this cell's stock in this dispatch)
    for (var k = 0u; k < NCH; k++) { if (m[k] != m0[k]) { atomicStore(&stock[o + k], m[k]); } }
    if (bat != bat0) { atomicStore(&stock[o + BAT], bat); }
    if (heat != 0) { atomicAdd(&hb[LEDGER_WORDS + idx[4]], heat); }
    var fill = 0.0;
    for (var k = 0u; k < NCH; k++) { fill += f32(m[k]) * ep_f(EP.natoms, k); }
    cells[i].bat = clamp(f32(bat) / f32(batMax), 0.0, 1.0);
    cells[i].fill = clamp(fill / max(cap, 1.0), 0.0, 1.0);
  }
  flush_counters(li, slot);
}

fn u01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

// ---------- ledger (once per frame) ----------
var<workgroup> wlo: array<atomic<u32>, 14>;
var<workgroup> whi: array<atomic<u32>, 14>;
var<workgroup> wcnt: array<atomic<i32>, 5>;

@compute @workgroup_size(64)
fn ledger(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  if (i < S.count) {
    for (var k = 0u; k <= BAT; k++) {
      let v = max(atomicLoad(&stock[i * SW + k]), 0);
      if (v == 0) { continue; }
      atomicAdd(&wlo[k], u32(v) & 0xffffu);
      atomicAdd(&whi[k], u32(v) >> 16u);
    }
    let c = cells[i];
    if (c.bat > 0.5) { atomicAdd(&wcnt[0], 1); }
    if (c.bat < 0.05) { atomicAdd(&wcnt[1], 1); }
    if (c.fill > 0.5) { atomicAdd(&wcnt[2], 1); }
    atomicAdd(&wcnt[3], 1);
    let idx = footprint(c.pos);
    var hs = 0;
    for (var q = 0; q < 9; q++) { hs += atomicLoad(&hb[EP.heatEnd + idx[q]]); }
    if (f32(hs) / 9.0 * HP.tempScale > EP.tol) { atomicAdd(&wcnt[4], 1); }
  }
  workgroupBarrier();
  let slot = wid.x & 63u;
  if (li <= BAT) {
    let L = atomicLoad(&wlo[li]);
    let H = atomicLoad(&whi[li]);
    let at = select(LG_K_STOCK + 128u * li, LG_K_BAT, li == BAT) + slot;
    add64v(at, i32(H >> 16u), H << 16u);
    add64v(at, 0, L);
  } else if (li < BAT + 6u) {
    let k = li - BAT - 1u;
    let v = atomicLoad(&wcnt[k]);
    if (v != 0) { atomicAdd(&hb[LG_K_COUNT + 64u * k + slot], v); }
  }
}

// ---------- reset (a new culture) ----------
@compute @workgroup_size(64)
fn reset(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  let slot = wid.x & 63u;
  if (i < arrayLength(&cells)) {   // (not S.count: a reset can run before the first tick has written a Sim slot)
    give_back(i, cells[i].pos, EP.resetCur, slot);
    atomicStore(&stock[i * SW + BAT], EP.starter);
    add64(LG_K_START + slot, EP.starter);
  }
  flush_counters(li, slot);
}
