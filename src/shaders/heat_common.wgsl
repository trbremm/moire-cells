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
//   [LEDGER_WORDS + 4n, + 36n)     step C3, the substances (src/matter.js, matter.wgsl): 16 channels (6 atoms, 4 fuels,
//                                  2 sediments, trace; step C12: oil, two amphiphiles), each a block of n words, in two
//                                  copies (ping-pong, as the heat): copy k, channel c at LEDGER_WORDS + 4n + (16 k + c) n.
//                                  Amounts in whole counts (ATOM_SCALE per atom-unit), so moving matter around is exact.
//                                  Step C12: then 3 blocks of f32 the oil passes work out once per tick (matter.wgsl
//                                  oil_field): the oil's volume share per pixel, its smoothed share, the amphiphile film
//   [LEDGER_WORDS + 39n, + 42n)    step C6, the cells' pigments (src/eat.js, cell_eat.wgsl): per light band (visible 1,
//                                  visible 2, hard) the optical depth the cells' pigments put down this tick (x their area
//                                  in pixels, COVER_SCALE per unit; read as the 3 x 3 mean as the cover; cleared after
//                                  every tick's spreading; HeatP.pig says where, 0 = none this frame)
//   [LEDGER_WORDS + 42n, + 44n)    step C6b, charge (src/charge.js; matter.wgsl relax, cell_eat.wgsl): the screened
//                                  potential phi (f32 bits, kept from tick to tick: each tick's relaxation starts from the
//                                  last), then the cells' net charge put down this tick (counts of charge, as the atoms;
//                                  cleared after every tick's spreading)
// Channel-major, so later steps can add channels as further blocks of n words.

const HEAT_SCALE: f32 = 65536.0;   // counts per energy unit
const HEAT_V0: f32 = 10.0;         // CSS px / s: the speed whose motion energy is 0.5 units
const LEDGER_WORDS: u32 = 31488u;   // (30976 until step M1; 28928 until step N1 merged; 28416 until step C12g; 28288 until step C12f; 27776 until step C12e; 25600 until step C12c; 19200 until step C6b, 19712 until step C6c, 20224 until step C7, 21760 until C7b,
                                    // 22016 until C8, 22272 until C9, 22528 until C12)
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
// step C6c, membrane chemistry (src/membrane.js, cell_eat.wgsl): 32 numbers x 16 slots (i32): 0..15 a snapshot (the ledger
// pass, every frame), 16..31 counters since the last read-back (the eat pass); MB_* in cell_eat.wgsl
const LG_MB: u32 = 19712u;
// step C7, pumps (src/pumps.js, cell_eat.wgsl): 96 numbers x 16 slots (i32): 0..63 a snapshot (the ledger pass, every frame),
// 64..95 counters since the last read-back (the eat pass); PC_* in cell_eat.wgsl
const LG_PU: u32 = 20224u;
// step C7b, catalysts (src/catalysts.js, cell_eat.wgsl): 16 numbers x 16 slots (i32), a snapshot (the ledger pass, every
// frame); CT_* in cell_eat.wgsl
const LG_CAT: u32 = 21760u;
// step C8, hard light mutates (src/hardlight.js; cell_eat.wgsl, cell_step.wgsl): 16 numbers x 16 slots (i32): 0..7 a snapshot
// (the eat ledger pass, every frame), 8..15 counters since the last read-back (the step, at births); HL_* in cell_common.wgsl
const LG_HL: u32 = 22016u;
// step C9, division (src/division.js; cell_eat.wgsl split): 16 numbers x 16 slots (i32), counters since the last read-back:
// [0] the heat counts the divisions' cost took from the mothers' batteries (the rest spare)
const LG_DIV: u32 = 22272u;
// step C12b, lipid membranes (src/lipids.js, cell_eat.wgsl), in the words step C12 left free (22528 .. 23039):
//   LG_LIP_E  the lipids' chemical energy in all membranes (heat counts, as a positive magnitude: the lipids' energy is below the
//             free atoms'), a snapshot, 64-bit, 64 slots (128 words)
//   LG_LIP_S  the census, 16 numbers x 16 slots (i32), a snapshot (the ledger pass)
//   LG_LIP_C  8 counters x 16 slots (i32) since the last read-back (the eat pass; LC_* in cell_eat.wgsl)
const LG_LIP_E: u32 = 22528u;
const LG_LIP_S: u32 = 22656u;
const LG_LIP_C: u32 = 22912u;
// step C12, oils and water (src/oil.js, matter.wgsl): LG_OIL (words 22528 .. 23040 left free for other steps; step C12b uses them)
//   + 0     the matter ledger of channels 13..15 (oil, the amphiphiles): ADD, LOST, GONE, DISH, 3 channels x 128 words each
//           (lg_mc maps a channel's word for every region)
//   + 1536  4 families' events (oil formed, oil cracked, head put on, head taken off): 64-bit, 64 slots, 128 words each
//   + 2048  a snapshot (the ledger pass, every frame): 16 numbers x 16 slots (i32; OS_* in matter.wgsl)
const LG_OIL: u32 = 23040u;
const LG_OIL_RX: u32 = 24576u;
const LG_OIL_SNAP: u32 = 25088u;
const LG_OIL_FUSE: u32 = 25344u;    // + 2304: oil taken into membranes (counts of lL), 16 slots, since the last read-back
// the C12b supply fix (2026-11-16), cells graze crust (src/lipids.js, cell_eat.wgsl): 8 counters x 16 slots (i32) since the last
// read-back (LC_GRAZE_* in cell_eat.wgsl): crust taken in (ll, LL), put into walls whole, cracked (ll, LL), heat counts paid
const LG_LIP_G: u32 = 25360u;
// step C12c, excited waste (src/excited.js; matter.wgsl, cell_eat.wgsl), words 25600 .. 27775:
//   LG_EXC    the matter ledger of channels 16, 17 (g*, t*): ADD, LOST, GONE, DISH, 2 channels x 128 words each (lg_mc)
//   LG_EXC_K  a snapshot: the excited atoms in the cells' stocks, 2 channels, 64-bit, 64 slots (128 words each)
//   LG_EXC_N  8 counters x 16 slots (i32) since the last read-back, counts of excited atoms (XN_* below)
//   LG_EXC_E  6 counters, 64-bit, 64 slots (128 words each) since the last read-back, heat counts (XE_* below)
const LG_EXC: u32 = 25600u;
const LG_EXC_K: u32 = 26624u;
const LG_EXC_N: u32 = 26880u;
const LG_EXC_E: u32 = 27008u;
// step C12e, waste must leave (src/waste.js, cell_eat.wgsl), words 27776 .. 28287: 16 snapshot numbers x 16 slots (i32; the ledger
// pass: WS_*), then 16 counters x 16 slots (i32) since the last read-back (the eat pass: WC_*)
const LG_WS: u32 = 27776u;
// step C12f, vents in the dark (src/vents.js, matter.wgsl spread), words 28288 .. 28415: the heat the hot vents put into the grid
// (heat counts, 64 slots, i32) and the free T the sea brought (counts, 64 slots, i32), since the last read-back
const LG_VENT: u32 = 28288u;
const LG_SEA: u32 = 28352u;
// step C12g, ion flow (src/ions.js, cell_eat.wgsl), words 28416 .. 28927: 16 snapshot numbers x 16 slots (i32; the ledger pass: IZ_*),
// then 16 counters x 16 slots (i32) since the last read-back (the eat pass: IC_*)
const LG_IO: u32 = 28416u;
// step N1, a nutrient landscape (src/pigments.js, cell_eat.wgsl): 16 counters, 64-bit, 64 slots (128 words each), words 28928 .. 30975 (28416 .. on branch landscape, before the merge with C12g):
// N1_* in cell_eat.wgsl (the pigments' light, why photons went unused, the pigment built, worn, bleached; a snapshot of what is held)
const LG_N1: u32 = 28928u;
// step M1, whole membranes (src/whole.js, cell_eat.wgsl), words 30976 .. 31487: 16 snapshot numbers x 16 slots (i32; the ledger pass:
// M1Z_*), then 16 counters x 16 slots (i32) since the last read-back (the eat, dump, split and reset passes: M1C_*)
const LG_M1: u32 = 30976u;
const XN_MADE_OPEN: u32 = 0u;    // excited atoms made by light in the open (the uphill swaps)
const XN_MADE_CELL: u32 = 1u;    // ... made by the cells' harvesting uphill swaps (a pigment's photon)
const XN_FADE_OPEN: u32 = 2u;    // ... faded to ground by themselves in the open
const XN_FADE_CELL: u32 = 3u;    // ... inside cells
const XN_RX_OPEN: u32 = 4u;      // ... used by a reaction in the open (their energy: heat)
const XN_RX_IN: u32 = 5u;        // ... used by a reaction loose inside a cell (heat)
const XN_ENGINE: u32 = 6u;       // ... used by a cell's engine (their energy: the battery)
const XN_BITE: u32 = 7u;         // ... spent biting a membrane (heat at the cell)
const XE_ENGINE: u32 = 0u;       // heat counts: excitation an engine put into a battery (after its ineff share)
const XE_FADE: u32 = 1u;         // ... excitation that faded into heat (open and cells)
const XE_LOOSE: u32 = 2u;        // ... excitation dumped as heat by uncontrolled reactions (open, loose in cells, bites)
const XE_BREATH: u32 = 3u;       // ... all the swap engines ("breathing") put into batteries (bond + excitation)
const XE_BURN: u32 = 4u;         // ... all the burn engines put into batteries
const XE_UPHEAT: u32 = 5u;       // ... (spare)
const EXC0: u32 = 16u;           // the first excited channel (g*; t* next): the twin of channel c < 2 is c + 16
// the ground twin of channel c (for the per-channel uniforms, which hold 16 channels: an excited atom moves, passes membranes
// and drifts in the fields exactly as its ground atom does)
fn gc(c: u32) -> u32 { return select(c, c - EXC0, c >= EXC0); }
const OIL_CH: u32 = 13u;            // the oil's channel (lL; src/matter.js checks)

const NCH: u32 = 13u;               // step C3: substance channels the CELLS hold (their stock; channels 0..12)
const NGRID: u32 = 18u;             // step C12: substance channels on the grid (+ oil lL and the amphiphiles glL, tlL; step C12c:
                                    // + the excited light atoms g*, t*)
const ATOM_SCALE: f32 = 4096.0;     // counts per atom-unit (ATOM_SCALE in src/matter.js)

// step C12: the ledger word of channel c in the matter ledger's region (LG_M_ADD, LG_M_LOST, LG_M_GONE or LG_M_DISH):
// channels 0..12 where they always were, 13..15 in step C12's part (LG_OIL)
fn lg_mc(region: u32, c: u32) -> u32 {
  if (c < NCH) { return region + 128u * c; }
  var k = 3u;
  if (region == LG_M_ADD) { k = 0u; } else if (region == LG_M_LOST) { k = 1u; } else if (region == LG_M_GONE) { k = 2u; }
  if (c >= EXC0) { return LG_EXC + 256u * k + 128u * (c - EXC0); }   // step C12c
  return LG_OIL + 384u * k + 128u * (c - NCH);
}

// step C6b: a channel's charge from the packed code (CHARGE_CODES in src/matter.js: 2 bits per channel, 1 = +1, 2 = -1)
fn charge_of(codes: u32, c: u32) -> i32 {
  let v = (codes >> (2u * gc(c))) & 3u;   // (step C12c: an excited atom carries its ground twin's charge)
  return select(select(0, -1, v == 2u), 1, v == 1u);
}

// step C4: one reaction of the table (src/matter.js, REACTIONS); one event moves one count of each channel listed
struct Rx {
  ch: vec4u,                    // reactants x, y and products z, w (255: none); 2 l -> ll lists l twice
  by: u32,                      // 0: by heat (rate x exp(-spark / (theta x temperature))); 1: by light of `band`
  band: u32,
  fam: u32,                     // family, for the counters (make, burn, photo, swap, form, crack; step C12: oil formed,
                                // oil cracked, head on, head off; step C12d: 10 fluorescence, 11 excited -> heat, not in the ledger's)
  open: u32,                    // step C12: bit 0 = in the open dish only (its substances are not in the cells' stock); step C12d:
                                // bit 1 an excited state's event (light, electrons on), bit 2 photochemistry, bits 8..15 the band it
                                // emits + 1 (fluorescence; 0 none)
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
  cry: vec4f,                   // step C7b, crystal seeding (src/catalysts.js): x 1 = on; y 1 / s0 (per unit per R^2); z the
                                // spark's floor (a share of it); w spare. Sediment lowers the spark of its OWN formation:
                                // spark x max(floor, 1 / (1 + s / s0)), s the chain already there (the pixel's own, or the
                                // mean of its 4 neighbours' if more: crust grows on crust and at its edge)
  fuse: vec4f,                  // step C12, membrane fusion (src/oil.js; cell_eat.wgsl): x 1 = on; y the share of a membrane's
                                // shortfall taken in from the oil under the cell per s; z heat counts per unit of oil opened
                                // (its chain's energy, uphill), w its spark (heat counts per unit, lost as heat)
  ex: vec4f,                    // step C12c, excited waste (src/excited.js): x 1 = on; y the heat counts one excited count holds
                                // (16 E*); z its fading rate (1 / lifetime, per s); w the temperature at which it fades twice as fast
  el: vec4f,                    // step C12d, electrons (src/matter.js, src/electrons.js): x 1 = on (the reactions are the electrons'
                                // table: light reactions excite, fluoresce, react; paint works out the glow); y z w spare
  rx: array<Rx, 48>,            // (24 until step C12, 32 until step C12d)
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
  caus: u32,        // step N1: word offset of the CAUSTIC block (the light's focusing by the water surface, f32 bits per pixel, x the
                    // light_factor; src/water.js; 0 = none this frame: x 1)
  cur: u32,         // step N1: word offset of the CURRENTS' stream function (f32 bits at the pixel corners, (hw + 1) x (hh + 1), CSS px^2
                    // per s; 0 = no currents this frame)
  curDrift: f32,    // step N1: how much of the current the cells drift with (cell_step.wgsl: a force = curDrift x the water's velocity)
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
