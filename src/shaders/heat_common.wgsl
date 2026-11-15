// ===== heat_common.wgsl: the heat band's grid and the energy ledger (Part C, step C1) =====
// Not compiled on its own: src/heat.js prepends it to heat.wgsl, and src/cells.js to every cell shader.
//
// ENERGY UNIT: a cell's motion energy is 0.5 x (v / HEAT_V0)^2, v in CSS px per s, so a cell moving at 10 px/s carries
// 0.5. Heat is counted in the same unit. On the GPU every amount of energy is a whole number of counts (fixed point,
// HEAT_SCALE counts per unit), stored in i32: WGSL atomics exist only for i32 / u32, and whole numbers make spreading
// and leaking exact (what leaves one pixel arrives in its neighbour, to the count).
//
// One storage buffer holds everything (array<atomic<i32>>; offsets in words):
//   [0, LEDGER_WORDS)              the ledger: counters, each spread over 64 to 256 slots (less atomic contention,
//                                  and no slot overflows); the ones that can grow large (heat out, the snapshots) are
//                                  64-bit: a low word plus a carry word 64 slots further (add64); src/heat.js copies this
//                                  part out and sums the slots
//   [LEDGER_WORDS, + n)            delta: what the cells deposit (+) or take (-) this tick, by atomic adds
//   [LEDGER_WORDS + n, + 2n)       heat grid, copy 0     (ping-pong: the spreading reads one copy, writes the other;
//   [LEDGER_WORDS + 2n, + 3n)      heat grid, copy 1      Sim.heatCur / HeatTick.src say which is current)
//   [LEDGER_WORDS + 3n, + 4n)      cover (step C2): how much of each pixel the cells cover this tick (COVER_SCALE per
//                                  pixel area; each cell adds its area at its centre, the light's absorption reads the
//                                  3 x 3 mean; cleared after every tick's spreading)
//   [LEDGER_WORDS + 4n, + 30n)     step C3, the substances (src/matter.js, matter.wgsl): 13 channels (6 atoms, 4 fuels,
//                                  2 sediments, trace), each a block of n words, in two copies (ping-pong, as the heat):
//                                  copy k, channel c at LEDGER_WORDS + 4n + (13 k + c) n. Amounts in whole counts
//                                  (ATOM_SCALE per atom-unit), so moving matter around is exact.
//   [LEDGER_WORDS + 30n, + 33n)    step C6, the cells' pigments (src/eat.js, cell_eat.wgsl): per light band (visible 1,
//                                  visible 2, hard) the optical depth the cells' pigments put down this tick (x their area
//                                  in pixels, COVER_SCALE per unit; read as the 3 x 3 mean as the cover; cleared after
//                                  every tick's spreading; HeatP.pig says where, 0 = none this frame)
//   [LEDGER_WORDS + 33n, + 35n)    step C6b, charge (src/charge.js; matter.wgsl relax, cell_eat.wgsl): the screened
//                                  potential phi (f32 bits, kept from tick to tick: each tick's relaxation starts from the
//                                  last), then the cells' net charge put down this tick (counts of charge, as the atoms;
//                                  cleared after every tick's spreading)
// Channel-major, so later steps can add channels as further blocks of n words.

const HEAT_SCALE: f32 = 65536.0;   // counts per energy unit
const HEAT_V0: f32 = 10.0;         // CSS px / s: the speed whose motion energy is 0.5 units
const LEDGER_WORDS: u32 = 19712u;   // (19200 until step C6b)
const LG_WORK: u32 = 0u;     // 256 slots: work done on the cells by the forces (fields, contact, crawling, stirring)
const LG_BASE: u32 = 256u;   // 64: the base warmth put into the dish
const LG_OUT: u32 = 320u;    // 64, 64-bit: heat that leaked out of the dish (to the sky, at the edge, on a resize)
const LG_HEAT: u32 = 448u;   // 64, 64-bit: snapshot, the heat in the dish (cleared before each read-back)
const LG_MOVE: u32 = 576u;   // 64, 64-bit: snapshot, the cells' motion energy
const LG_DRAG: u32 = 704u;   // 160: motion lost to drag (damping), which became heat
const LG_KICK: u32 = 864u;   // 160: energy the heat kicks took from the grid (net; a kick against the motion gives back)
const LG_SLOTS_DK: u32 = 160u;
// step C2, light (64-bit slots, 128 words per band or class: 64 low words, then 64 carry words)
const LG_LIGHT_IN: u32 = 1024u;    // 4 bands: light arriving in the dish
const LG_LIGHT_ABS: u32 = 1536u;   // 4 bands: light absorbed, which became heat (the rest passed through, lost)
const LG_SPOT_N: u32 = 2048u;      // snapshot, 4 classes x 64 slots (i32): cells in the light, cells outside,
                                   //   pixels in the light, pixels outside
const LG_SPOT_T: u32 = 2304u;      // snapshot, 4 classes, 64-bit: the heat under them (counts)
const COVER_SCALE: f32 = 4096.0;   // cover counts per pixel area
// step C3, the matter ledger (src/matter.js): per channel (13), 64-bit, 64 slots (128 words per channel), in counts
const LG_M_ADD: u32 = 3072u;       // added by the springs
const LG_M_LOST: u32 = 4736u;      // left the dish at its edge
const LG_M_GONE: u32 = 6400u;      // washed out (Shift+C) or dropped with the old grid on a resize
const LG_M_DISH: u32 = 8064u;      // snapshot: in the dish now (cleared before each read-back)
const LG_M_ORDER: u32 = 9728u;     // snapshot: 256 f32 partial sums of m ln m (the ORDER line's entropy)
// step C4, chemistry (src/matter.js, matter.wgsl's react): 64-bit, 64 slots (128 words each)
const LG_C_LIGHT: u32 = 10240u;    // 4 bands: light caught by the substances (into bonds, and the rest as heat)
const LG_C_RX: u32 = 10752u;       // 6 families (make, burn, photo, swap, form, crack): events, in counts of substance
// step C5, cells eat (src/eat.js, cell_eat.wgsl): 64-bit, 64 slots (128 words each) unless said otherwise
const LG_K_STOCK: u32 = 11520u;    // snapshot, per channel (13): the substances inside the cells (counts)
const LG_K_BAT: u32 = 13184u;      // snapshot: the cells' batteries (heat counts)
const LG_K_START: u32 = 13312u;    // the starter charges given to new cultures (heat counts; energy in)
const LG_K_EV: u32 = 13440u;       // 16 counters (EV_* in cell_eat.wgsl)
const LG_K_COUNT: u32 = 15488u;    // snapshot, 5 classes x 64 slots (i32): cells with a battery above half, below 5 %,
                                   //   stock above half full, all cells, and cells hotter than the tolerance
// step C6, engines in the genome (src/eat.js, cell_eat.wgsl)
const LG_K_EV2: u32 = 15872u;      // 16 counters (E2_* in cell_eat.wgsl), 64-bit, 64 slots (128 words each)
const LG_K_CEN: u32 = 17920u;      // snapshot: the strategies' census, 76 numbers x 16 slots (i32; CEN_N in cell_eat.wgsl)
// step C6b, charge (src/charge.js), snapshots
const LG_Q_CEN: u32 = 19136u;      // the cells' charge, 4 numbers x 16 slots (i32): cells net +, net -, sum |q| x 1000 (q the
                                   //   saturated charge field B uses), sum |net charge| x 1000 (atom-units)
const LG_Q_PHI: u32 = 19200u;      // 256 f32 partial sums (one per workgroup of matter.wgsl's count): sum of phi^2 over pixels
const LG_Q_PMAX: u32 = 19456u;     // largest |phi| in the dish (f32 bits; atomicMax, as positive floats sort as integers)

const NCH: u32 = 13u;               // step C3: substance channels
const ATOM_SCALE: f32 = 4096.0;     // counts per atom-unit (ATOM_SCALE in src/matter.js)

// step C6b: a channel's charge from the packed code (CHARGE_CODES in src/matter.js: 2 bits per channel, 1 = +1, 2 = -1)
fn charge_of(codes: u32, c: u32) -> i32 {
  let v = (codes >> (2u * c)) & 3u;
  return select(select(0, -1, v == 2u), 1, v == 1u);
}

// step C4: one reaction of the table (src/matter.js, REACTIONS); one event moves one count of each channel listed
struct Rx {
  ch: vec4u,                    // reactants x, y and products z, w (255: none); 2 l -> ll lists l twice
  by: u32,                      // 0: by heat (rate x exp(-spark / (theta x temperature))); 1: by light of `band`
  band: u32,
  fam: u32,                     // family, for the counters (make, burn, photo, swap, form, crack)
  _p0: u32,
  heat16: i32,                  // heat counts released per event
  light16: i32,                 // light counts used per event (by light)
  k: f32,                       // by heat: rate constant (per s for one reactant, R^2 per s for two); by light: the
                                // reactants' optical depth per unit amount per R^2
  spark: f32,                   // the bond's spark (energy units)
};
struct ChemP {
  nrx: u32,                     // reactions in rx
  traceOn: u32,                 // 1: trace lowers the spark
  trace: u32,                   // trace's channel
  light: u32,                   // 1: the light is on
  theta: f32,                   // temperature scale of the sparks
  tempScale: f32,               // heat counts in a pixel x tempScale = temperature (heat per R^2)
  dt: f32,                      // s per tick
  traceK: f32,                  // spark x 1 / (1 + traceK x trace per R^2)
  dark: array<vec4f, 4>,        // per channel: optical depth for the WARM band per unit per R^2 (sediment: dark)
  rx: array<Rx, 24>,
};
const NONE: u32 = 255u;

// The heat grid's parameters (written once per frame by src/heat.js; 64 bytes)
struct HeatP {
  hw: u32,          // grid width and height (pixels)
  hh: u32,
  n: u32,           // hw x hh
  flags: u32,       // bit 0: kicks from heat (Shift+H); off = the old constant jitter. bit 1: light on (cells add cover)
  px: f32,          // CSS px per heat pixel (about half a cell radius)
  grab: f32,        // share of the heat under a cell (its 3 x 3 pixels) that one kick takes on average, per tick
  kickMax: f32,     // largest kick (CSS px / s, per axis)
  k: f32,           // spreading per substep: flux to a neighbour = k x the difference (<= 0.2 for stability)
  leak: f32,        // share of a pixel's heat that leaks to the sky per tick
  edge: f32,        // extra share per tick at the dish edge (0 = an insulated edge)
  base: f32,        // base warmth per pixel per tick (counts; fractional, added with random rounding)
  tempScale: f32,   // counts in one pixel x tempScale = temperature, as heat per R^2 (units)
  pig: u32,         // step C6: word offset of the cells' pigment blocks (visible 1, visible 2, hard; 0 = none this frame)
  _p1: f32,
  _p2: f32,
  _p3: f32,
};

// motion energy of a velocity (CSS px / s)
fn heat_ke(v: vec2f) -> f32 {
  return 0.5 * dot(v, v) / (HEAT_V0 * HEAT_V0);
}

// an amount of energy as counts, rounded to the nearest
fn heat_counts(e: f32) -> i32 {
  return i32(round(clamp(e * HEAT_SCALE, -2.0e9, 2.0e9)));
}

// the heat pixel under a position (CSS px), clamped into the grid
fn heat_xy(H: HeatP, p: vec2f) -> vec2i {
  return clamp(vec2i(floor(p / H.px)), vec2i(0), vec2i(i32(H.hw) - 1, i32(H.hh) - 1));
}

// ===== end of heat_common.wgsl =====
