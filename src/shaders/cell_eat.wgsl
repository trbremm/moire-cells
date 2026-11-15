// Cells eat (Part C, step C5): every cell's STOCK of the 13 substances and its BATTERY, in their own buffer (32 i32 per
// cell: channels 0..12 in substance counts, ATOM_SCALE per unit, as the grid; word 13 the battery in heat counts,
// HEAT_SCALE per energy unit; 14, 15 spare; step C6c: 16..21 the light linkers l woven into each side of the membrane,
// 22..27 the heavy linkers L, in counts; 28..31 spare). field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended
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
// Step C6, engines in the genome: every cell's engines (Bio.eng, Bio.rate; ENGINES in src/matter.js, struct Eng below) run in
// the eat dispatch, after the membrane: a HARVEST engine (make fuel, or a swap run uphill: gT + G -> GT + g, the light atom
// going free) has a pigment that catches its band of the light falling on the cell (the
// cell books it as light in; it also puts its pigment's depth down in the heat buffer, so the dish's absorption and the
// substances' reactions under it see less of that band) and each photon makes one fuel from the stock. Light never
// charges the battery: the photon pays only what goes into the bond (a weaker photon takes the difference from the
// battery), the spark is paid from the battery and lost as heat, the rest of the photon (and a photon with nothing to
// make) becomes heat at the cell. Only the downhill engines fill the battery: a BURN, SWAP or FORM engine works like the
// C5 burner (spark from the battery and given back, the energy released into it minus the `ineff` share as heat). So a
// harvester without a burner (or a breathing swap) runs its battery flat and stops. UPKEEP: a cell pays per s for its engines' rates and
// its heat tolerance, from the battery, as heat. The PERMEABILITY gene sets the membrane's rate per cell (plan).
// The C5 burner is now the rule "everyone burns" (EF_BURN), off by default once the engines are on.
//
// Step C6c, MEMBRANE CHEMISTRY (src/membrane.js): the membrane is a material, LINKER chains woven from the stock, per side
// (stock words 16..27). Genes (Bio.memb): MIX (the heavy linkers' share) and THICKNESS (linker per R of membrane); a side
// wants thickness x its rest length of linker, in that mix. Its INTEGRITY (Cell.integ) is what it holds over what it
// wants (0..1).
//   plan   BITES: a free reactive atom (giver or taker) outside a side bites the chains of ITS OWN ROW: g and t bite the l
//          part, G and T the L part, at kBite x their concentration at the side x the side's length x the share of that
//          row in the side's weave (the other row shields it) x exp(-the chain's spark / (theta x temperature)) (the
//          table's sparks: the heavy chain is twice as hard to bite). The biting atom stays free (it only breaks the weave,
//          a catalyst of the membrane's breakdown); the bitten linkers go free into the dish (flux 13, 14 carry them to
//          the eat dispatch). LEAK: the exchange is x (1 + leakK x (1 - mean integrity)) (each side's share of the
//          perimeter at its own leakiness); HOLD: the stock's capacity x (hold + (1 - hold) x mean integrity), as a stock
//          needs a closed membrane to hold it. ION SELECTIVITY: givers x (1 + s), takers x (1 - s) (passive exchange only).
//   eat    the bitten linkers into the dish; REPAIR: each side short of what it wants weaves linkers from the stock
//          (repK of the shortfall per s), each linker paying its chain's spark from the battery (as heat; weaving holds
//          the linkers at the free linkers' energy, so nothing else changes in the books); a side holding more than shedAt
//          x what it wants (the genes changed, the cell shrank) lets the extra back into the stock. A membrane that has
//          been WHOLE (mean integrity >= wholeAt) and is bitten below burstAt BURSTS: the cell spills its whole stock, its
//          membrane (as free linkers) and its battery (as heat) at its place, and its slot is given to a neighbour's
//          daughter (cell_step.wgsl, after BURST_TICKS; only with turnover on)
//   split  a newborn takes a share r / (r + r_parent) of every side of its parent's membrane (as both have about the same
//          integrity after); dump and reset hand membranes back to the dish as free linkers
//   ledger the membranes' linkers count in the cells' l and L (the atoms' books), and the membrane census (LG_MB)

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
@group(0) @binding(8) var<uniform> LP: LightP;                          // step C6: the light (light_common.wgsl)
@group(0) @binding(10) var<storage, read> bio: array<Bio>;              // step C6: the genomes (this tick's copy)
@group(0) @binding(9) var<storage, read_write> flux: array<i32>;      // per cell 16: the exchange per channel (+ in, - out),
                                                                    // [15] the temperature under it (f32 bits)
// The plan pass sees the same buffers through plain views (no atomics: on Direct3D an atomic load is a read-modify-write,
// so reading the 3 x 3 pixels of 13 channels per cell through atomics cost as much as the rest of the tick): the stock,
// and the heat buffer's grid part (everything behind the ledger), read only.
@group(0) @binding(2) var<storage, read_write> stockP: array<i32>;
@group(0) @binding(7) var<storage, read_write> mg: array<i32>;

const SW: u32 = 32u;       // stock words per cell (16 until step C6c)
const BAT: u32 = 13u;      // the battery's word
// step C6c: the membrane's words (per side: light linkers l, then heavy L) and the linker channels (SUBSTANCES order: g t l
// G T L ...; src/eat.js checks)
const MB_L0: u32 = 16u;
const MB_H0: u32 = 22u;
const MB_CH_L: u32 = 2u;
const MB_CH_H: u32 = 5u;

// step C6: one engine of ENGINES (src/matter.js), 32 bytes
struct Eng {
  ch: vec4u,               // reactants x, y and products z, w (NONE: none; form lists its linker twice)
  kind: u32,               // 0 harvest (make fuel by light, or an uphill swap: then w is the freed light atom), 1 burn,
                           // 2 swap, 3 form
  g16: i32,                // heat counts per event: stored in the bond (harvest) or released (the others)
  spark: f32,              // the bond's spark (energy units)
  _p: u32,
};

// what src/eat.js writes once per frame (1296 bytes)
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
  // ---- step C6 ----
  engMax: f32,             // an engine slot runs at most this many events (counts) per tick
  pigK: f32,               // a pigment's optical depth per unit of its slot's rate
  upEng: f32,              // upkeep: heat counts per tick per unit of engine rate
  upTol: f32,              // upkeep: heat counts per tick for a tolerance of tolRef (in proportion to the tolerance)
  tolRef: f32,
  pigOff: u32,             // word offset in hb of the pigment cover's first block (visible 1; then visible 2, hard); 0: none
  // ---- step C6b, charge (src/charge.js) ----
  qOff: u32,               // word offset in hb of the block the cells put their net charge down in (0: they do not)
  qInv: f32,               // a cell's q = tanh(net charge / qHalf): 1 / qHalf (per atom-unit)
  qFeel: u32,              // plan: 1 = work out the gradient of phi across the membrane (Cell.efield)
  phiOff: u32,             // word offset of phi in mg (the plain view behind the ledger)
  qCodes: u32,             // the channels' charges (CHARGE_CODES)
  _c5: u32, _c6: u32, _c7: u32, _c8: u32, _c9: u32,
  photon16: vec4i,         // per light band: one photon's energy in heat counts per event (16 x its energy)
  ratio: array<vec4f, 4>,  // per channel: its spreading speed / the light atoms' (scales the permeability gene; sediment 0)
  eng: array<Eng, 24>,     // ENGINES (18)
  // ---- step C6c, membrane chemistry (src/membrane.js) ----
  mb0: vec4f,              // x: MBF_* bits (u32); y kBite (per unit per R^2, per R of side, per s); z repK (per s); w a side's
                           // rest length per r (the hexagon of area pi r^2: 1.1)
  mb1: vec4f,              // x leakK; y burstAt (mean integrity); z wholeAt; w theta (the sparks' temperature scale)
  mb2: vec4f,              // x, y: heat counts per linker count woven, l and L (the chain's spark); z, w: the sparks themselves
  mb3: vec4f,              // x shedAt (x what a side wants); y shedK (per s); z the leak's largest (the exchange x at most this);
                           // w tRef (memb_stiff, for the census)
  mb4: vec4f,              // x hold: the share of its capacity a cell with no membrane can hold (a closed membrane: all of it)
};
const MBF_ON: u32 = 1u;      // membrane chemistry (master): material, integrity, repair, leak
const MBF_BITE: u32 = 2u;    // ... bites
const MBF_BURST: u32 = 4u;   // ... bursting (only while turnover is on)
const MBF_SEL: u32 = 8u;     // ion selectivity gene
fn mb_flags() -> u32 { return bitcast<u32>(EP.mb0.x); }
// what a side of cell c wants, in linker counts, for its genes' thickness (per R of membrane x its rest length)
fn memb_want(r: f32, thick: f32) -> f32 { return max(thick, 0.0) * EP.mb0.w * r / EP.R * ATOM_SCALE; }

// step C6c: the membrane counters and census (LG_MB + 16 q + slot), see heat_common.wgsl
const MB_N: u32 = 0u;          // snapshot: cells
const MB_MIX: u32 = 1u;        // ... sum of mix x 1000
const MB_THICK: u32 = 2u;      // ... sum of thickness x 100000
const MB_INTEG: u32 = 3u;      // ... sum of the mean integrity x 1000
const MB_ASEL: u32 = 4u;       // ... sum of |selectivity| x 1000
const MB_SEL: u32 = 5u;        // ... sum of selectivity x 1000
const MB_ML: u32 = 6u;         // ... light linkers in membranes (counts)
const MB_MH: u32 = 7u;         // ... heavy linkers in membranes (counts)
const MB_WHOLE: u32 = 8u;      // ... cells whose membrane has been whole
const MB_DAMAGED: u32 = 9u;    // ... of those, below half integrity now
const MB_HEAVY: u32 = 10u;     // ... cells with a heavy membrane (mix above 0.5)
const MB_HINTEG: u32 = 11u;    // ... their sum of the mean integrity x 1000
const MB_STIFF: u32 = 12u;     // ... sum of the material's stiffness (memb_stiff) x 1000
const MB_SELN: u32 = 13u;      // ... cells with |selectivity| above 0.3
const MB_SELQ: u32 = 14u;      // ... of those, charged (|q| above 0.3)
const MB_QSEL: u32 = 15u;      // ... sum of q x selectivity x 1000 (positive: givers-passing cells hold +)
const MB_BITE_L: u32 = 16u;    // counters: light linkers bitten out (counts)
const MB_BITE_H: u32 = 17u;    // ... heavy
const MB_BUILT_L: u32 = 18u;   // ... light linkers woven in
const MB_BUILT_H: u32 = 19u;   // ... heavy
const MB_SPARK: u32 = 20u;     // ... heat counts the batteries paid for weaving
const MB_BURSTS: u32 = 21u;    // ... cells that burst
const MB_SHED: u32 = 22u;      // ... linker counts let back into the stocks (extra material)
const MB_BITTEN: u32 = 23u;    // ... cell-ticks with a bite
var<workgroup> wmb: array<atomic<i32>, 16>;
const EF_EAT: u32 = 1u;      // the membrane trades (cells eat, Shift+A)
const EF_BURN: u32 = 2u;     // everyone burns: the C5 built-in burner (Shift+U)
const EF_INSIDE: u32 = 4u;   // the table's reactions inside cells (Shift+I)
const EF_ENG: u32 = 8u;      // step C6: engines from the genome
const EF_PIG: u32 = 16u;     // ... pigments catch light (harvest engines)
const EF_UPKEEP: u32 = 32u;  // ... upkeep costs
const EF_TOLG: u32 = 64u;    // ... the heat tolerance is a gene (else the global `tol`)
const EF_PERMG: u32 = 128u;  // ... the permeability is a gene (else the global `perm`)

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
// step C6 counters (LG_K_EV2 + 128 k), in heat counts unless said otherwise
const E2_PIG: u32 = 0u;         // 0..3: light the pigments caught, per band
const E2_MADE: u32 = 4u;        // counts the harvest engines (with a pigment) made: fuel, upgraded fuel, cracked sediment
const E2_DEFICIT: u32 = 5u;     // heat counts the batteries paid for the harvest engines (their sparks, weak photons)
const E2_BURN: u32 = 6u;        // counts the burn engines broke
const E2_SWAP: u32 = 7u;        // ... the swap engines swapped
const E2_FORM: u32 = 8u;        // ... the form engines chained (sediment counts)
const E2_GAIN: u32 = 9u;        // heat counts the burn, swap and form engines put into batteries
const E2_HEAT: u32 = 10u;       // heat counts the engines released (their inefficiency, the photons' rest, unused photons)
const E2_UPKEEP: u32 = 11u;     // heat counts paid as upkeep
const E2_IDLE: u32 = 12u;       // heat counts of photons caught with nothing to make (part of E2_HEAT)
const E2_STORE: u32 = 13u;      // counts the storers (uphill engines without a pigment) made, paid by the battery
var<workgroup> wev2: array<atomic<i32>, 16>;

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
  // step C6c: the membrane's linkers, as free linkers
  for (var k = 0u; k < 12u; k++) {
    let m = atomicExchange(&stock[i * SW + MB_L0 + k], 0);
    if (m <= 0) { continue; }
    let c = select(MB_CH_H, MB_CH_L, k < 6u);
    if (cur != 0u && (EP.mask & (1u << c)) != 0u) {
      spread9(cur + c * EP.n, idx, m);
      back += m;
    } else {
      add64(LG_M_GONE + 128u * c + slot, m);
      gone += m;
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
  } else if (li < 32u) {
    let v = atomicLoad(&wev2[li - 16u]);
    if (v != 0) { add64(LG_K_EV2 + 128u * (li - 16u) + slot, v); }
  } else if (li < 48u) {
    // step C6c: the membrane's counters (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wmb[li - 32u]);
    if (v != 0) { atomicAdd(&hb[LG_MB + 16u * (16u + li - 32u) + (slot & 15u)], v); }
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
    // step C6c: and a share r / (r + r_parent) of each side of the parent's membrane (side k to side k), so both start with
    // about the parent's integrity (the newborn is smaller and wants less)
    let sh = c.r / max(c.r + cells[pi].r, 1e-3);
    for (var k = 0u; k < 12u; k++) {
      let h = atomicLoad(&stock[pi * SW + MB_L0 + k]);
      let got = take_stock(pi * SW + MB_L0 + k, i32(floor(f32(h) * sh)));
      if (got > 0) { atomicAdd(&stock[i * SW + MB_L0 + k], got); }
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
  let husk = cell_burst(c.flags) != 0u && (mb_flags() & MBF_BURST) != 0u;   // step C6c: a burst cell trades nothing
  let eatOn = (EP.flags & EF_EAT) != 0u && cur != 0u && (c.flags & CELL_ALIVE) != 0u && !husk;
  let areaPx = 3.14159265 * c.r * c.r;
  let areaR2 = max(areaPx / (EP.R * EP.R), 1e-3);
  let cap = EP.capR2 * areaR2 * ATOM_SCALE;
  var atomsIn = 0.0;
  for (var k = 0u; k < NCH; k++) { atomsIn += f32(stockP[fo + k]) * ep_f(EP.natoms, k); }
  // step C6c: the membrane's material per side (it takes room in the cell too) and its integrity
  let mbf = mb_flags();
  let membOn = (mbf & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u;
  let gm = bio[i].memb;
  var ml: array<i32, 6>;
  var mh: array<i32, 6>;
  var integ = 0.0;
  let want = max(memb_want(c.r, gm.y), 1.0);
  for (var k = 0u; k < 6u; k++) {
    ml[k] = stockP[fo + MB_L0 + k];
    mh[k] = stockP[fo + MB_H0 + k];
    atomsIn += f32(ml[k] + mh[k]);
    integ += min(f32(ml[k] + mh[k]) / want, 1.0);
  }
  integ /= 6.0;
  // a stock needs a closed membrane to hold it: the capacity x (hold + (1 - hold) x mean integrity)
  let capM = select(cap, cap * (EP.mb4.x + (1.0 - EP.mb4.x) * integ), membOn);
  let room = clamp(1.0 - atomsIn / max(capM, 1.0), 0.0, 1.0);
  let Ao = 9.0 * HP.px * HP.px;
  let rs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + 0x2c1b3c6du));
  // step C6: with the permeability gene on, the cell's own (Bio.rate.w, for the light atoms) x each channel's ratio
  let permG = (EP.flags & EF_PERMG) != 0u;
  let pgene = bio[i].rate.w;
  // step C6c: a damaged membrane leaks (each side's share of the perimeter at 1 + leakK x its damage: the mean), and the
  // ion selectivity gene lets givers (+) through x (1 + s) and takers (-) x (1 - s)
  let leak = select(1.0, min(1.0 + EP.mb1.x * (1.0 - integ), EP.mb3.z), membOn);
  let selOn = (mbf & MBF_SEL) != 0u;
  for (var k = 0u; k < NCH; k++) {
    var n = 0;
    var pk = select(ep_f(EP.perm, k), pgene * ep_f(EP.ratio, k), permG) * leak;
    if (selOn) { pk *= max(1.0 + gm.w * f32(charge_of(EP.qCodes, k)), 0.0); }
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
  // step C6c, BITES: a free reactive atom outside a side bites the chains of its own row (g, t the l part; G, T the L part),
  // at kBite x its concentration there (units per R^2, the pixel just outside the side's middle) x the side's length (R)
  // x the share of that row in the side's weave x exp(-the chain's spark / (theta x temperature)); counts, rounded at
  // random. The biting atom stays free; the bitten linkers go to the dish in the eat dispatch (flux 13, 14)
  var bl = 0;
  var bh = 0;
  if (membOn && (mbf & MBF_BITE) != 0u && cur != 0u && (c.flags & CELL_ALIVE) != 0u && !husk) {
    let mbn = membrane(c);
    let tmp = max(f32(hsum) / 9.0 * HP.tempScale, 1e-4);
    let fL = exp(-EP.mb2.z / (EP.mb1.w * tmp));
    let fH = exp(-EP.mb2.w / (EP.mb1.w * tmp));
    let conc = EP.R * EP.R / (ATOM_SCALE * HP.px * HP.px);   // counts in a pixel -> units per R^2
    let mL = (EP.mask & 3u) != 0u;                           // g, t moving
    let mH = (EP.mask & 24u) != 0u;                          // G, T moving
    for (var k = 0u; k < 6u; k++) {
      let mk = ml[k] + mh[k];
      if (mk <= 0) { continue; }
      let e = mbn.edge[k];
      let len = length(e);
      let nrm = vec2f(e.y, -e.x) / max(len, 1e-6);
      let px = heat_xy(HP, c.pos + mbn.mid[k] + nrm * (0.5 * HP.px));
      let pi = u32(px.y) * HP.hw + u32(px.x);
      let base = cur - lw;
      let x0 = EP.mb0.y * len / EP.R * ATOM_SCALE * EP.dt * conc;
      if (mL && ml[k] > 0) {
        let cl = f32(max(mg[base + pi], 0) + max(mg[base + EP.n + pi], 0));
        let x = x0 * cl * fL * f32(ml[k]) / f32(mk);
        let n = min(i32(floor(x + u01(pcg(rs + k * 0x1b873593u + 0x68e31da4u)))), ml[k]);
        if (n > 0) { ml[k] -= n; bl += n; stockP[fo + MB_L0 + k] = ml[k]; }
      }
      if (mH && mh[k] > 0) {
        let ch = f32(max(mg[base + 3u * EP.n + pi], 0) + max(mg[base + 4u * EP.n + pi], 0));
        let x = x0 * ch * fH * f32(mh[k]) / f32(mk);
        let n = min(i32(floor(x + u01(pcg(rs + k * 0xcc9e2d51u + 0x3c6ef372u)))), mh[k]);
        if (n > 0) { mh[k] -= n; bh += n; stockP[fo + MB_H0 + k] = mh[k]; }
      }
    }
  }
  flux[fo + 13u] = bl;
  flux[fo + 14u] = bh;
  // smell: the fuels (each weighted by its energy) at the membrane's 6 corners; for a field v = v0 + G . x sampled at a
  // regular hexagon, sum v x = G sum |x|^2 / 2, so G = 2 sum v x / sum |x|^2 (here in energy per R^2 per R)
  var g = vec2f(0.0);
  if (EP.smell != 0u && cur != 0u) {
    let mb = membrane(c);
    var gr = vec2f(0.0);
    var rr = 0.0;
    for (var a = 0; a < 6; a++) {
      let cp = mb.mid[a] - 0.5 * mb.edge[a];
      let px = heat_xy(HP, c.pos + cp);
      let pi = u32(px.y) * HP.hw + u32(px.x);
      var v = 0.0;
      for (var f = FUEL_CH; f < FUEL_CH + 4u; f++) {
        if ((EP.mask & (1u << f)) != 0u) { v += f32(ep_i(EP.e16, f)) * f32(mg[cur - lw + f * EP.n + pi]); }
      }
      gr += v * cp;
      rr += dot(cp, cp);
    }
    // (e16 / 16 = energy per count; counts in a pixel / (ATOM_SCALE x its area in R^2) = units per R^2; x R: per R
    // instead of per CSS px)
    let conc = EP.R * EP.R / (ATOM_SCALE * HP.px * HP.px);
    g = 2.0 * gr / max(rr, 1e-6) * conc / 16.0 * EP.R;
  }
  cells[i].smell = g;
  // step C6b: the substrate's screened potential phi at the same 6 corners (bilinear), its gradient across the cell (phi
  // per R), for the next tick's step: a charged cell is pushed down (+) or up (-) it
  var ef = vec2f(0.0);
  if (EP.qFeel != 0u && EP.phiOff != 0u && (c.flags & CELL_ALIVE) != 0u) {
    let mb = membrane(c);
    var gr = vec2f(0.0);
    var rr = 0.0;
    for (var a = 0; a < 6; a++) {
      let cp = mb.mid[a] - 0.5 * mb.edge[a];
      gr += phi_bilinear(c.pos + cp) * cp;
      rr += dot(cp, cp);
    }
    ef = 2.0 * gr / max(rr, 1e-6) * EP.R;
  }
  cells[i].efield = ef;
}

// step C6b: phi (plain view) at a position (CSS px), bilinear between the pixel centres, clamped into the grid
fn phi_bilinear(p: vec2f) -> f32 {
  let gp = p / HP.px - 0.5;
  let b = floor(gp);
  let f = gp - b;
  let hi = vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1);
  let a0 = clamp(vec2i(b), vec2i(0), hi);
  let a1 = clamp(vec2i(b) + 1, vec2i(0), hi);
  let v00 = bitcast<f32>(mg[EP.phiOff + u32(a0.y) * HP.hw + u32(a0.x)]);
  let v10 = bitcast<f32>(mg[EP.phiOff + u32(a0.y) * HP.hw + u32(a1.x)]);
  let v01 = bitcast<f32>(mg[EP.phiOff + u32(a1.y) * HP.hw + u32(a0.x)]);
  let v11 = bitcast<f32>(mg[EP.phiOff + u32(a1.y) * HP.hw + u32(a1.x)]);
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

// ---------- eat ----------
@compute @workgroup_size(64)
fn eat(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  let slot = wid.x & 63u;
  // step C6c: a cell that burst (cell_burst) waits, empty, for a neighbour's daughter to take its slot (cell_step.wgsl);
  // with bursting off (or turnover) it is an ordinary cell again
  var husk = false;
  if (i < S.count && cell_burst(cells[i].flags) != 0u) {
    if ((mb_flags() & MBF_BURST) != 0u) { husk = true; }
    else { cells[i].flags = cells[i].flags & ~CELL_BURST_MASK; }
  }
  if (i < S.count && (cells[i].flags & CELL_ALIVE) != 0u && !husk) {
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

    // ---- step C6c, the membrane: the linkers the plan's bites broke out go free into the dish (into the stock while their
    // channel is not moving); then REPAIR: each side short of what the genes ask weaves linkers in from the stock (repK of
    // the shortfall per s, in the genes' mix), each paying its chain's spark from the battery, as heat (the weave holds them
    // at the free linkers' energy); a side holding more than shedAt x it wants lets the extra back into the stock
    let mbf = mb_flags();
    let membOn = (mbf & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u;
    let gm = bio[i].memb;
    var sl: array<i32, 6>;
    var sh: array<i32, 6>;
    for (var k = 0u; k < 6u; k++) { sl[k] = atomicLoad(&stock[o + MB_L0 + k]); sh[k] = atomicLoad(&stock[o + MB_H0 + k]); }
    let sl0 = sl;
    let sh0 = sh;
    let bitL = flux[fo + 13u];
    let bitH = flux[fo + 14u];
    if (bitL > 0) {
      if (cur != 0u && (EP.mask & (1u << MB_CH_L)) != 0u) { spread9(cur + MB_CH_L * EP.n, idx, bitL); } else { m[MB_CH_L] += bitL; }
      atomicAdd(&wmb[MB_BITE_L - 16u], bitL);
    }
    if (bitH > 0) {
      if (cur != 0u && (EP.mask & (1u << MB_CH_H)) != 0u) { spread9(cur + MB_CH_H * EP.n, idx, bitH); } else { m[MB_CH_H] += bitH; }
      atomicAdd(&wmb[MB_BITE_H - 16u], bitH);
    }
    if (bitL + bitH > 0) { atomicAdd(&wmb[MB_BITTEN - 16u], 1); }
    let want = max(memb_want(c.r, gm.y), 1.0);
    if (membOn) {
      let mix = clamp(gm.x, 0.0, 1.0);
      let wl = (1.0 - mix) * want;
      let wh = mix * want;
      var nl: array<i32, 6>;
      var nh: array<i32, 6>;
      var tl = 0;
      var th = 0;
      let kr = EP.mb0.z * EP.dt;
      for (var k = 0u; k < 6u; k++) {
        nl[k] = max(i32(floor(kr * max(wl - f32(sl[k]), 0.0) + u01(pcg(rs + k * 0x7feb352du + 0x1d8e4e27u)))), 0);
        nh[k] = max(i32(floor(kr * max(wh - f32(sh[k]), 0.0) + u01(pcg(rs + k * 0x846ca68bu + 0x5a3b9b5du)))), 0);
        tl += nl[k];
        th += nh[k];
      }
      // what the stock holds, then what the battery can pay (the sparks), scale the plan down
      var fl = select(1.0, f32(max(m[MB_CH_L], 0)) / f32(tl), tl > m[MB_CH_L]);
      var fh = select(1.0, f32(max(m[MB_CH_H], 0)) / f32(th), th > m[MB_CH_H]);
      let spl = i32(EP.mb2.x);
      let sph = i32(EP.mb2.y);
      let cost = f32(tl) * fl * f32(spl) + f32(th) * fh * f32(sph);
      if (cost > f32(bat)) { let q = f32(max(bat, 0)) / max(cost, 1.0); fl *= q; fh *= q; }
      var ul = 0;
      var uh = 0;
      for (var k = 0u; k < 6u; k++) {
        let a = i32(floor(f32(nl[k]) * fl));
        let b2 = i32(floor(f32(nh[k]) * fh));
        sl[k] += a; ul += a;
        sh[k] += b2; uh += b2;
      }
      let paid = ul * spl + uh * sph;
      m[MB_CH_L] -= ul;
      m[MB_CH_H] -= uh;
      bat -= paid;
      heat += paid;
      atomicAdd(&wmb[MB_BUILT_L - 16u], ul);
      atomicAdd(&wmb[MB_BUILT_H - 16u], uh);
      atomicAdd(&wmb[MB_SPARK - 16u], paid);
      // the extra back into the stock (free: the weave is at the free linkers' energy)
      var shed = 0;
      let ks = EP.mb3.y * EP.dt;
      for (var k = 0u; k < 6u; k++) {
        let xl = f32(sl[k]) - EP.mb3.x * wl - 1.0;
        if (xl > 0.0) { let a = min(i32(ceil(ks * xl)), sl[k]); sl[k] -= a; m[MB_CH_L] += a; shed += a; }
        let xh = f32(sh[k]) - EP.mb3.x * wh - 1.0;
        if (xh > 0.0) { let a = min(i32(ceil(ks * xh)), sh[k]); sh[k] -= a; m[MB_CH_H] += a; shed += a; }
      }
      atomicAdd(&wmb[MB_SHED - 16u], shed);
    }
    for (var k = 0u; k < 6u; k++) {
      if (sl[k] != sl0[k]) { atomicStore(&stock[o + MB_L0 + k], sl[k]); }
      if (sh[k] != sh0[k]) { atomicStore(&stock[o + MB_H0 + k], sh[k]); }
    }

    // the temperature under the cell (its 3 x 3 pixels' mean, from the plan pass), for the sparks of the reactions inside
    let temp = max(bitcast<f32>(flux[fo + 15u]), 1e-4);
    let concIn = 1.0 / (ATOM_SCALE * areaR2);                  // stock counts x concIn = units per R^2 inside
    var sparkScale = 1.0;
    if (CP.traceOn != 0u) { sparkScale = 1.0 / (1.0 + CP.traceK * f32(m[CP.trace]) * concIn); }

    // ---- step C6: the engines from the genome ----
    let b = bio[i];
    if ((EP.flags & EF_ENG) != 0u) {
      // pigments: each harvest slot's pigment catches its band of the light falling on the cell, in whole photons (one
      // photon = one event's worth); its optical depth is pigK x the slot's rate, and it shares the band with what else
      // catches it there (the medium, the cell's body) by depth, as the dish's absorption does
      var nph = vec3i(0);
      if ((EP.flags & EF_PIG) != 0u && LP.mode != LIGHT_OFF) {
        let s = light_factor(LP, c.pos);
        var tb = vec4f(0.0);
        for (var k = 0u; k < 3u; k++) {
          if (b.rate[k] > 0.0 && EP.eng[eng_index(b.eng[k])].kind == 0u && eng_band(b.eng[k]) > 0u) { tb[eng_band(b.eng[k])] += EP.pigK * b.rate[k]; }
        }
        if (s > 0.0 && any(tb > vec4f(0.0))) {
          let apx = areaPx / (HP.px * HP.px);                  // the cell's area in heat pixels
          let tot = tb + LP.tauMed + LP.tauCell;
          let caught = LP.power * s * apx * (1.0 - exp(-tot)) / max(tot, vec4f(1e-9));   // x a depth = what it catches
          for (var k = 0u; k < 3u; k++) {
            let band = eng_band(b.eng[k]);
            if (b.rate[k] <= 0.0 || EP.eng[eng_index(b.eng[k])].kind != 0u || band == 0u) { continue; }
            let ph16 = EP.photon16[band];
            let n = i32(floor(caught[band] * EP.pigK * b.rate[k] / f32(ph16) + u01(pcg(rs + k * 0x2f6b1e3du + 0x13579bdfu))));
            nph[k] = n;
            atomicAdd(&wev2[E2_PIG + band], n * ph16);
          }
          // the pigments' depth, put down over the 3 x 3 pixels under the cell for the light's absorption this tick
          // (heat.wgsl absorb, matter.wgsl react: they see that much less of the band, which the cells caught instead;
          // spread here, so the pixels read one word per band instead of nine)
          if (EP.pigOff != 0u) {
            let idx = footprint(c.pos);
            for (var band = 1u; band < 4u; band++) {
              let v = i32(round(tb[band] * apx * COVER_SCALE / 9.0));
              if (v <= 0) { continue; }
              for (var q = 0; q < 9; q++) { atomicAdd(&hb[EP.pigOff + (band - 1u) * HP.n + idx[q]], v); }
            }
          }
        }
      }
      let cap = i32(EP.engMax);
      for (var k = 0u; k < 3u; k++) {
        let rk = b.rate[k];
        if (rk <= 0.0) { continue; }
        let E = EP.eng[eng_index(b.eng[k])];
        let sp16 = max(i32(ceil(E.spark * sparkScale * 16.0)), 1);
        // what it works on: one reactant, two different ones (the scarcer), or a pair of the same (half of it)
        var a = m[E.ch.x];
        if (E.ch.y != NONE) { a = select(min(m[E.ch.x], m[E.ch.y]), m[E.ch.x] / 2, E.ch.y == E.ch.x); }
        if (E.kind == 0u) {
          // UPHILL (make fuel, an uphill swap freeing a light atom, crack sediment). Light never charges the battery.
          // With a pigment (band 1..3): one photon per event pays the energy that goes into the bonds (a photon below it
          // needs the difference, d16, from the battery); the SPARK is paid from the battery and lost as heat (so a
          // harvester runs its battery down unless the cell also burns or breathes); the rest of each photon, and photons
          // with nothing to work on, heat. Without one (band 0, a STORER): rate x what it works on per s, the battery
          // pays the whole difference and the spark (battery energy banked in the stock as fuel)
          let band = eng_band(b.eng[k]);
          var np = nph[k];
          var ph16 = 0;
          if (band == 0u) {
            np = i32(floor(rk * f32(max(a, 0)) * EP.dt + u01(pcg(rs + k * 0x6c8e9cf5u + 0x2545f491u))));
          } else {
            ph16 = EP.photon16[band];
          }
          if (np <= 0) { continue; }
          let d16 = max(E.g16 - ph16, 0);
          let c16 = sp16 + d16;                                 // from the battery per event
          var n = min(np, min(a, cap));
          n = max(min(n, bat / c16), 0);
          if (band == 0u) { np = n; }                           // (a storer has no photons to waste)
          m[E.ch.x] -= n;
          if (E.ch.y != NONE) { m[E.ch.y] -= n; }
          m[E.ch.z] += n;
          if (E.ch.w != NONE) { m[E.ch.w] += n; }
          bat -= n * c16;
          let hh = n * (ph16 + c16 - E.g16) + (np - n) * ph16;
          heat += hh;
          atomicAdd(&wev2[select(E2_MADE, E2_STORE, band == 0u)], n);
          atomicAdd(&wev2[E2_DEFICIT], n * c16);
          atomicAdd(&wev2[E2_HEAT], hh);
          atomicAdd(&wev2[E2_IDLE], (np - n) * ph16);
        } else {
          // burn, swap, form: rate x what it works on per s (the fuel; the scarcer of an atom and a fuel; pairs of
          // linkers), at most engMax per tick; the spark from the battery first (an empty one starts nothing), the energy
          // released into it minus the ineff share as heat; a full battery takes nothing more
          if (a <= 0) { continue; }
          let h1 = (E.g16 * i32(EP.ineff)) / 256;
          let g1 = E.g16 - h1;
          var n = i32(floor(rk * f32(a) * EP.dt + u01(pcg(rs + k * 0x6c8e9cf5u + 0x2545f491u))));
          n = min(n, min(a, cap));
          n = min(n, bat / sp16);
          n = min(n, max(batMax - bat, 0) / max(g1, 1));
          if (n <= 0) { continue; }
          m[E.ch.x] -= n;
          if (E.ch.y != NONE) { m[E.ch.y] -= n; }
          m[E.ch.z] += n;
          if (E.ch.w != NONE) { m[E.ch.w] += n; }
          bat += n * g1;
          heat += n * h1;
          atomicAdd(&wev2[E2_BURN + E.kind - 1u], n);
          atomicAdd(&wev2[E2_GAIN], n * g1);
          atomicAdd(&wev2[E2_HEAT], n * h1);
        }
      }
    }

    // ---- the burner (C5's built-in one; since C6 the rule "everyone burns"): fuel -> its two atoms, the bond's energy
    // into the battery minus the heat share ----
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

    // ---- the table's reactions inside the cell: the ones driven by heat, by the same rules as in the open (react in
    // matter.wgsl), with the stock's concentration over the cell's area and the local temperature. No light inside.
    if ((EP.flags & EF_INSIDE) != 0u) {
      var rh = 0;
      for (var r = 0u; r < CP.nrx; r++) {
        let R = CP.rx[r];
        if (R.by != 0u) { continue; }
        if (m[R.ch.x] <= 0) { continue; }
        var x = R.k * f32(m[R.ch.x]) * exp(-R.spark * sparkScale / (CP.theta * temp)) * EP.dt;
        if (R.ch.y != NONE) { x *= f32(m[R.ch.y]) * concIn; }
        var n = i32(floor(x + u01(pcg(rs + r * 0x9e3779b9u + 0x7f4a7c15u))));
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
        rh += n * R.heat16;
        if (R.fam == 1u) { atomicAdd(&wev[EV_IN_BURN], n); }
        else if (R.fam == 3u) { atomicAdd(&wev[EV_IN_SWAP], n); }
        else if (R.fam == 4u) { atomicAdd(&wev[EV_IN_FORM], n); }
      }
      heat += rh;
      atomicAdd(&wev[EV_IN_HEAT], rh);
    }

    // ---- step C6, upkeep: per s, upEng x the engines' rates (while they run) and upTol x tolerance / tolRef (while it is
    // a gene), paid from the battery as heat (what an empty battery cannot pay is not paid)
    if ((EP.flags & EF_UPKEEP) != 0u) {
      var cost = 0.0;
      if ((EP.flags & EF_ENG) != 0u) { cost += EP.upEng * (max(b.rate.x, 0.0) + max(b.rate.y, 0.0) + max(b.rate.z, 0.0)); }
      if ((EP.flags & EF_TOLG) != 0u) { cost += EP.upTol * b.eng.w / max(EP.tolRef, 1e-3); }
      let pay = clamp(i32(floor(cost + u01(pcg(rs + 0x0b4e0ef3u)))), 0, bat);
      if (pay > 0) {
        bat -= pay;
        heat += pay;
        atomicAdd(&wev2[E2_UPKEEP], pay);
      }
    }

    // ---- sediment formed inside is expelled where the cell is (it cannot pass the membrane, and it would clog the cell);
    // while its channel is not moving in the dish (the first frame it appears) it waits inside
    if (cur != 0u && EP.sedMask != 0u) {
      for (var k = 0u; k < NCH; k++) {
        if ((EP.sedMask & (1u << k)) == 0u || m[k] <= 0 || (EP.mask & (1u << k)) == 0u) { continue; }
        spread9(cur + k * EP.n, idx, m[k]);
        atomicAdd(&wev[EV_EXPEL], m[k]);
        m[k] = 0;
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

    // ---- step C6b: the cell's charge, the net charge of its stock (givers minus takers; fuel and sediment are neutral);
    // q saturates (tanh) for field B. With the charge field on it puts its net charge down where it is (cloud in cell:
    // over the 4 pixels around its centre, by their nearness), so the substrate's field sees the charge the cell took in
    var qn = 0;
    for (var k = 0u; k < NCH; k++) { qn += charge_of(EP.qCodes, k) * m[k]; }
    let qu = f32(qn) / ATOM_SCALE;
    cells[i].qNet = qu;
    cells[i].q = tanh(qu * EP.qInv);
    if (EP.qOff != 0u && qn != 0) {
      let gp = c.pos / HP.px - 0.5;
      let b0 = floor(gp);
      let fr = gp - b0;
      let hi = vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1);
      let p00 = clamp(vec2i(b0), vec2i(0), hi);
      let p11 = clamp(vec2i(b0) + 1, vec2i(0), hi);
      let w00 = i32(round(f32(qn) * (1.0 - fr.x) * (1.0 - fr.y)));
      let w10 = i32(round(f32(qn) * fr.x * (1.0 - fr.y)));
      let w01 = i32(round(f32(qn) * (1.0 - fr.x) * fr.y));
      let w11 = qn - w00 - w10 - w01;
      if (w00 != 0) { atomicAdd(&hb[EP.qOff + u32(p00.y) * HP.hw + u32(p00.x)], w00); }
      if (w10 != 0) { atomicAdd(&hb[EP.qOff + u32(p00.y) * HP.hw + u32(p11.x)], w10); }
      if (w01 != 0) { atomicAdd(&hb[EP.qOff + u32(p11.y) * HP.hw + u32(p00.x)], w01); }
      if (w11 != 0) { atomicAdd(&hb[EP.qOff + u32(p11.y) * HP.hw + u32(p11.x)], w11); }
    }

    // ---- step C6c: each side's integrity (what it holds over what it wants; 1 while the membrane chemistry is off), the
    // WHOLE mark (a membrane that once reached wholeAt), and BURSTING: a whole membrane bitten below burstAt bursts; the
    // cell spills everything at its place (its stock, its membrane as free linkers, its battery as heat: give_back) and
    // waits as an empty husk for a neighbour's daughter (cell_step.wgsl)
    var ig = array<f32, 6>(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    var im = 1.0;
    if (membOn) {
      im = 0.0;
      for (var k = 0u; k < 6u; k++) { ig[k] = clamp(f32(sl[k] + sh[k]) / want, 0.0, 1.0); im += ig[k]; }
      im /= 6.0;
    }
    var fl2 = c.flags;
    if (membOn && im >= EP.mb1.z) { fl2 |= CELL_WHOLE; }
    let burst = membOn && (mbf & MBF_BURST) != 0u && (fl2 & CELL_WHOLE) != 0u && im < EP.mb1.y && bitL + bitH > 0;
    if (burst) {
      give_back(i, c.pos, cur, slot);
      fl2 = (fl2 & ~CELL_BURST_MASK) | (1u << CELL_BURST_SHIFT);
      ig = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      cells[i].bat = 0.0;
      cells[i].fill = 0.0;
      cells[i].q = 0.0;
      cells[i].qNet = 0.0;
      atomicAdd(&wmb[MB_BURSTS - 16u], 1);
    }
    cells[i].integ = ig;
    if (fl2 != c.flags) { cells[i].flags = fl2; }
  } else if (husk) {
    cells[i].integ = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  }
  flush_counters(li, slot);
}

fn u01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

// ---------- ledger (once per frame) ----------
var<workgroup> wlo: array<atomic<u32>, 14>;
var<workgroup> whi: array<atomic<u32>, 14>;
var<workgroup> wcnt: array<atomic<i32>, 5>;
// step C6, the strategies' census (a snapshot, LG_K_CEN + 16 v): 8 classes (harvest, burn, both, other; in the light, then
// in the dark) x 8 numbers (cells, battery share x 1000, harvest rates x 1000, burn rates x 1000, other rates x 1000,
// tolerance x 100, permeability x 1000, cells above half a battery), then 8 numbers: harvest slots per pigment band
// (in the light: storers, visible 1, visible 2, hard; then the same in the dark), then 4: cells carrying an uphill swap
// (light-driven, with a pigment) and cells carrying a downhill swap engine (a "breather"), in the light, then in the dark.
// (A "harvester" in the strategies is a cell with an uphill engine that has a pigment.)
const CEN_N: u32 = 76u;
var<workgroup> wcen: array<atomic<i32>, 76>;
// step C6b, the cells' charge (a snapshot, LG_Q_CEN + 16 v): cells with q above 0.1, below -0.1, sum |q| x 1000, sum |net| x 1000
var<workgroup> wq: array<atomic<i32>, 4>;
// step C6c, the membrane census (a snapshot, LG_MB + 16 v; MB_* above)
var<workgroup> wmbs: array<atomic<i32>, 16>;

@compute @workgroup_size(64)
fn ledger(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  if (i < S.count) {
    // step C6c: the membrane's linkers count with the cells' l and L (the atoms' books)
    var ml = 0;
    var mh = 0;
    for (var k = 0u; k < 6u; k++) { ml += max(atomicLoad(&stock[i * SW + MB_L0 + k]), 0); mh += max(atomicLoad(&stock[i * SW + MB_H0 + k]), 0); }
    for (var k = 0u; k <= BAT; k++) {
      var v = max(atomicLoad(&stock[i * SW + k]), 0);
      if (k == MB_CH_L) { v += ml; }
      if (k == MB_CH_H) { v += mh; }
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
    let b = bio[i];
    let tol = select(EP.tol, b.eng.w, (EP.flags & EF_TOLG) != 0u);
    if (f32(hs) / 9.0 * HP.tempScale > tol) { atomicAdd(&wcnt[4], 1); }
    // step C6: the census of strategies
    var hv = false;
    var bu = false;
    var rr = vec3f(0.0);
    let lit = light_inside(LP, c.pos);
    let pb = select(68u, 64u, lit);
    var up = false;
    var br = false;
    for (var k = 0u; k < 3u; k++) {
      if (b.rate[k] <= 0.0) { continue; }
      let E = EP.eng[eng_index(b.eng[k])];
      if (E.kind == 0u) {
        let band = eng_band(b.eng[k]);
        atomicAdd(&wcen[pb + band], 1);
        if (band > 0u) { hv = true; rr.x += b.rate[k]; up = up || (E.ch.w != NONE && E.ch.y != NONE); }
        else { rr.z += b.rate[k]; }
      }
      else if (E.kind == 1u) { bu = true; rr.y += b.rate[k]; }
      else { rr.z += b.rate[k]; br = br || E.kind == 2u; }
    }
    let pu = select(74u, 72u, lit);
    if (up) { atomicAdd(&wcen[pu], 1); }
    if (br) { atomicAdd(&wcen[pu + 1u], 1); }
    let st = select(select(select(3u, 1u, bu), 0u, hv), 2u, hv && bu);
    let row = 8u * (st + select(4u, 0u, lit));
    atomicAdd(&wcen[row], 1);
    atomicAdd(&wcen[row + 1u], i32(round(c.bat * 1000.0)));
    atomicAdd(&wcen[row + 2u], i32(round(rr.x * 1000.0)));
    atomicAdd(&wcen[row + 3u], i32(round(rr.y * 1000.0)));
    atomicAdd(&wcen[row + 4u], i32(round(rr.z * 1000.0)));
    atomicAdd(&wcen[row + 5u], i32(round(b.eng.w * 100.0)));
    atomicAdd(&wcen[row + 6u], i32(round(b.rate.w * 1000.0)));
    if (c.bat > 0.5) { atomicAdd(&wcen[row + 7u], 1); }
    // step C6b: the cells' charge
    if (c.q > 0.1) { atomicAdd(&wq[0], 1); } else if (c.q < -0.1) { atomicAdd(&wq[1], 1); }
    atomicAdd(&wq[2], i32(round(abs(c.q) * 1000.0)));
    atomicAdd(&wq[3], i32(round(min(abs(c.qNet), 1e5) * 1000.0)));
    // step C6c: the membrane census
    let gm = b.memb;
    var im = 0.0;
    for (var k = 0; k < 6; k++) { im += c.integ[k]; }
    im /= 6.0;
    atomicAdd(&wmbs[MB_N], 1);
    atomicAdd(&wmbs[MB_MIX], i32(round(gm.x * 1000.0)));
    atomicAdd(&wmbs[MB_THICK], i32(round(gm.y * 100000.0)));
    atomicAdd(&wmbs[MB_INTEG], i32(round(im * 1000.0)));
    atomicAdd(&wmbs[MB_ASEL], i32(round(abs(gm.w) * 1000.0)));
    atomicAdd(&wmbs[MB_SEL], i32(round(gm.w * 1000.0)));
    atomicAdd(&wmbs[MB_ML], ml);
    atomicAdd(&wmbs[MB_MH], mh);
    if ((c.flags & CELL_WHOLE) != 0u) {
      atomicAdd(&wmbs[MB_WHOLE], 1);
      if (im < 0.5) { atomicAdd(&wmbs[MB_DAMAGED], 1); }
    }
    if (gm.x > 0.5) { atomicAdd(&wmbs[MB_HEAVY], 1); atomicAdd(&wmbs[MB_HINTEG], i32(round(im * 1000.0))); }
    atomicAdd(&wmbs[MB_STIFF], i32(round(memb_stiff(gm, EP.mb3.w) * 1000.0)));
    if (abs(gm.w) > 0.3) {
      atomicAdd(&wmbs[MB_SELN], 1);
      if (abs(c.q) > 0.3) { atomicAdd(&wmbs[MB_SELQ], 1); }
    }
    atomicAdd(&wmbs[MB_QSEL], i32(round(c.q * gm.w * 1000.0)));
  }
  workgroupBarrier();
  if (li < 16u) {
    let v = atomicLoad(&wmbs[li]);
    if (v != 0) { atomicAdd(&hb[LG_MB + 16u * li + (wid.x & 15u)], v); }
  }
  if (li < 4u) {
    let v = atomicLoad(&wq[li]);
    if (v != 0) { atomicAdd(&hb[LG_Q_CEN + 16u * li + (wid.x & 15u)], v); }
  }
  for (var q = li; q < CEN_N; q += 64u) {
    let v = atomicLoad(&wcen[q]);
    if (v != 0) { atomicAdd(&hb[LG_K_CEN + 16u * q + (wid.x & 15u)], v); }
  }
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
