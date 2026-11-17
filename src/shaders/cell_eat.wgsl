// Cells eat (Part C, step C5): every cell's STOCK of the 13 substances and its BATTERY, in their own buffer (32 i32 per
// cell: channels 0..12 in substance counts, ATOM_SCALE per unit, as the grid; word 13 the battery in heat counts,
// HEAT_SCALE per energy unit; 14, 15 spare; step C6c: 16..21 the light linkers l woven into each side of the membrane,
// 22..27 the heavy linkers L, in counts; 28..31 spare; step C12b: 64 words a cell, 32..61 the LIPID membrane, per kind (soap glL,
// soap tlL, oil lL, crust ll, crust LL) 6 sides of molecule counts; 62, 63 spare). field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended
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
//
// Step C6d, CHARGE PER SIDE (src/dipole.js): Cell.sideQ spreads the stock's net charge over the six sides (its sum is kept
// equal to qNet, so it is a distribution of the charge, never new charge; a neutral cell can be polarised).
//   plan   each charged channel's THROUGH-FLOW: the exchange as if each side traded with the dish just outside it (the
//          concentration there, bilinear, against the cell's), less the cell's mean exchange, so the part that only says
//          WHERE the charge came in or went out: z x that onto each side (the cell's real exchange is unchanged); a side
//          facing more givers than the others takes + in there, one facing fewer lets + out. The side charges also even
//          out (dpRelax per s) toward an even spread (against which the step's polarisation by the field works), each
//          side within dpCap x the cell's mobile charge / 6 of its even share (a side cannot hold charge the cell does not)
//   eat    the side charges are put back on the new net charge (each side's difference from the even share kept, the sum
//          = qNet), and with dipoles on the cell puts its charge into the substrate's field at its sides' middles (so its
//          dipole shows in phi), else at its centre as before

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

const SW: u32 = 64u;       // stock words per cell (16 until step C6c, 32 until step C12b)
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

// what src/eat.js writes once per frame (1424 bytes since step C7)
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
  // ---- step C6d, charge per side (src/dipole.js) ----
  dpFlags: u32,            // DPE_* below
  dpFlow: f32,             // the through-flow's weight (1: each side gets the charge that passes it)
  dpRelax: f32,            // the side charges even out within the cell at this rate (1 / s)
  dpSpare: f32,
  dpCap: f32,              // a side's charge differs from the even share by at most dpCap x (the mobile charge / 6)
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
  // ---- step C7, pumps (src/pumps.js) ----
  pu0: vec4f,              // x: PUF_* bits (u32); y the base cost (heat counts per count moved UP its gradient, once the ratio is
                           // past pu2.z e-folds); z the gradient cost (heat counts per count per e-fold up); w the largest rate (per s)
  pu1: vec4f,              // x upkeep (heat counts per tick per unit of pump rate); y the voltage's leak (per s, at the light atoms'
                           // permeability 3 and a whole membrane); z the capacitance (charge atom-units per unit of voltage, per r / R);
                           // w the share of the voltage's energy that flows into the battery as it leaks back (PUF_V2B)
  pu2: vec4f,              // x eps (units per R^2, so an empty side costs finitely); y the gradient term's cap (e-folds); z the base
                           // cost's ramp (e-folds: the cost grows smoothly from 0 at equal concentrations); w the most a pump moves from
                           // one cell's stock to another per side and slot per tick (share of the source; 1 / 24 keeps every stock >= 0)
  // ---- step C7b, catalysts (src/catalysts.js) ----
  cat: vec4f,              // x 1 = trace as cofactor: an engine's rate x (f0 + (1 - f0) x tr / (tr + tHalf)), tr the trace inside
                           // per R^2; y f0; z tHalf (trace per R^2); w spare
  // ---- step C8, hard light mutates (src/hardlight.js) ----
  hl: vec4f,               // x 1 = the cells keep a hard light DOSE (Cell.flags bits 19..31): the hard light their body caught
                           // (counts of 1 / DOSE_SCALE energy units), y the share of it repaired per tick; z the extra mutation
                           // per energy unit of dose (Fields.hm.x; the census only); w spare
  // ---- step C9, division and death with a changing count (src/division.js) ----
  dv: vec4u,               // x reset: how many slots the new culture fills (slots 0 .. x - 1 get the starter charge); y the
                           // division's cost (heat counts, from the mother's battery, as heat); step G1 (src/fidelity.js): z proofreading's
                           // cost at e^F - 1 = 1 (heat counts, any birth, from the parent's battery, as heat), w bits FID_*
  // ---- step C10, patterned walls (src/walls.js) ----
  wl0: vec4f,              // x: WL_* bits (u32); y the pattern strength (x a1, a2); z the maturity factor's extra at full
                           // maturity (the cap - 1; 0 while junctions do not mature); w linker per R of side at adhesion 1 (atom-units)
  wl1: vec4f,              // x the upkeep: heat counts per tick per R of side at adhesion 1; y step C11: the FREE base glue (the
                           // adhesion every side holds at no cost; only what a side asks above it is built and paid); z step C13:
                           // the gates' bits (FG_*, u32: glue, pump, engine); w spare
  // ---- step C12b, lipid membranes (src/lipids.js) ----
  lp: array<vec4f, 9>,     // [0] x LPF_* bits (u32); y Tref (the temperature at which pure soap has stiffness 1: the heat's factor is
                           //     2 / (1 + T / Tref)); z crackAt (a corner's sudden strain, its speed over its own wobble's angular
                           //     frequency, as a share of r, beyond which its sides' wall cracks); w the share of a cracked side's crust
                           //     that breaks off per tick
                           // [1] the polarity's atoms (polarity() in src/matter.js, head x atoms and tail x atoms): x soap's head
                           //     atoms, y soap's tail atoms, z oil's head atoms, w oil's tail atoms
                           // [2] per kind (soap, oil, crust ll, crust LL) the chain's spark (energy units): a bite's exp(-spark / theta T)
                           // [3] ... the heat counts the builder's sparks cost per molecule made from atoms (from the battery)
                           // [4] ... the heat counts making it releases (its bonds' energy, downhill)
                           // [5] x fusion's rate (share of the shortfall per s); y the oil one soap molecule holds between its tails
                           //     at most; z the stiffness floor; w a fully damaged side's share of its stiffness (as soft)
                           // [6] per kind its LIGHT linkers (l) in the chain, [7] its HEAVY linkers (L): what bites by row
                           // [8] x the honeycomb corners' angular frequency at stiffness 1 (1/s; Fields.hex.x = its square); y step C12d:
                           //     the minus soap's (tlL) release built from atoms (heat counts; [4].x is glL's); z w spare
  // ---- step C12d, electrons ----
  smellW: array<vec4f, 4>, // per channel: what smell weighs it by (heat counts per count): the old table a fuel's energy; electrons the
                           // energy the strongest taker would release taking its electron (fuel 3, 2.5; minerals 0)
  // ---- step C12e, waste must leave (src/waste.js) ----
  ws: array<vec4f, 2>,     // [0] x WSF_* bits (u32); y the saturation's temperature factor (x theta x T: 1 = the sparks' own scale); z kOsm
                           //     (swelling per unit of osmotic pressure at stiffness 1); w the swelling's relaxation rate (per s)
                           // [1] x the largest swelling (area share); y the smallest (< 0: shrunk); z kStretch (a stretched membrane's
                           //     passive exchange x (1 + kStretch x e^gene x swelling)); w wTol (the stretch a membrane tolerates at gene 0)
  ws2: vec4f,              // x the tear rate past the tolerance (bursts per s per unit of relative excess); y the stretch tolerance's
                           // upkeep (heat counts per tick at gene 0, x e^gene); z w spare
  // ---- step C12g, ion flow (src/ions.js) ----
  io: array<vec4f, 2>,     // [0] x IOF_* bits (u32); y ionPass: an intact bilayer passes free ions at this share of a neutral molecule's
                           //     rate; z chanBase: the founders' channel level (gene 0, balance 0), the same kind of share; w kV: with
                           //     IOF_VOLT, an ion of charge z crossing through the intact membrane settles at inside / outside =
                           //     exp(-z x kV x the membrane voltage)
                           // [1] spare
  // ---- step N1, a nutrient landscape: light needs matter (src/pigments.js) ----
  nl: array<vec4f, 2>,     // [0] x NLF_* bits (u32); y the pigment a cell wants (counts per R^2 of its area per unit of harvest rate);
                           //     z the share of the shortfall built per tick; w the build's cost (heat counts per pigment count)
                           // [1] x the share of the pigment that wears out per tick; y Isat (the light, as a share of the full noon
                           //     light, at which photosynthesis saturates; 0 none); z pigment counts bleached per photon past
                           //     saturation (photoinhibition); w the day's level (this frame's power over the full noon power)
  // ---- step M1, whole membranes (src/whole.js) ----
  m1: array<vec4f, 2>,     // [0] x M1F_* bits (u32); y z w spare
                           // [1] spare
  // ---- step T1a, an inside, kin channels, the smell for trace (src/kin.js) ----
  t1: array<vec4f, 2>,     // [0] x T1F_* bits (u32); y seal (a covered side's share closed to the dish); z press (a side is covered by a
                           //     neighbour closer than press x the two radii); w kinK (per s, at full conductance, per R of shared wall)
                           // [1] x kinCap (the most a pair moves per tick, share of the source); y the smell's trace weight at no trace
                           //     inside (smellW units: traceWorth x the richest fuel's); z w spare
  // ---- step P1, predators (src/predators.js) ----
  p1: array<vec4f, 2>,     // [0] x spare; y the share of the host's bilayer that wraps the meal (x the prey's perimeter over the host's);
                           //     z the share of the meal's battery that goes to the host's (the rest heat); w the digestion's time (s)
                           // [1] spare
};
// ---- step C12g, MEMBRANES MODULATE ION FLOW (src/ions.js). The lipid BILAYER blocks free ions (charged atoms: g t G T and the excited
// g* t*), derived from its make-up: per side the intact share (its integrity: soap + the oil between its tails over what the thickness
// asks; with ?lipids=0 the C6c weave's) passes ions at ionPass of a neutral molecule's rate, the damaged share (holes) as a neutral one;
// the crust WALL does not count in the integrity, so it is porous. Ions pass the intact bilayer through CHANNELS: a cation channel
// (free givers, +) and an anion channel (free takers, -), each an open level (a share of a neutral molecule's rate) from two genes:
// gate2.w, the channels' level (a log factor on chanBase) and the C6c ION SELECTIVITY memb.w = s, now the channels' BALANCE: cation
// = chanBase e^gene (1 + s), anion = chanBase e^gene (1 - s). The C12e STRETCH channels open a non-selective path when swollen (kStretch
// e^gene x swelling, for ions and neutral molecules alike). C7 pumps are the active route (untouched). With IOF_VOLT the ions through
// the intact membrane feel the C7 membrane VOLTAGE. Off (IOF_BLOCK clear): the exchange as before (s scales all ion exchange)
const IOF_BLOCK: u32 = 1u;     // the bilayer blocks ions (needs the membrane chemistry)
const IOF_GENES: u32 = 2u;     // the channel genes act (else every cell's channels at chanBase, balanced: the neutral control)
const IOF_VOLT: u32 = 4u;      // ions through the intact membrane feel the membrane voltage
fn io_flags() -> u32 { return bitcast<u32>(EP.io[0].x); }
// a cell's cation (x) and anion (y) channel levels (shares of a neutral molecule's rate through an intact bilayer)
fn ion_chan(gl: f32, s0: f32, selOn: bool) -> vec2f {
  var lv = EP.io[0].z;
  var s = 0.0;
  if ((io_flags() & IOF_GENES) != 0u) { lv *= exp(clamp(gl, -4.0, 2.0)); s = select(0.0, clamp(s0, -1.0, 1.0), selOn); }
  return lv * vec2f(1.0 + s, 1.0 - s);
}
// what the intact share of a membrane passes of an ion of charge z (its channel + the bilayer's own small leak, at most a neutral's)
fn ion_open(ch: vec2f, z: i32) -> f32 { return min(1.0, EP.io[0].y + select(ch.y, ch.x, z > 0)); }
// counters (LG_IO + 256 + 16 q + slot, i32, the eat pass) and the snapshot census (LG_IO + 16 q + slot, the ledger pass)
const IC_CIN: u32 = 0u;        // free cations (givers) taken in through the membrane (counts; the passive exchange)
const IC_COUT: u32 = 1u;       // ... put out
const IC_AIN: u32 = 2u;        // free anions (takers) taken in
const IC_AOUT: u32 = 3u;       // ... put out
const IC_CBLK: u32 = 4u;       // cations the block held back (what a neutral molecule's rate would have moved, less what moved)
const IC_ABLK: u32 = 5u;       // anions held back
const IZ_N: u32 = 0u;          // snapshot: live cells
const IZ_G: u32 = 1u;          // ... sum of the channel level gene x 1000
const IZ_G2: u32 = 2u;         // ... sum of its square x 1000
const IZ_S: u32 = 3u;          // ... sum of the balance (selectivity) gene x 1000
const IZ_S2: u32 = 4u;         // ... sum of its square x 1000
const IZ_CAT: u32 = 5u;        // ... sum of the cation channel's level x 1000
const IZ_AN: u32 = 6u;         // ... sum of the anion channel's level x 1000
const IZ_CSEL: u32 = 7u;       // ... cells with balance above 0.3 (cation-passing)
const IZ_ASEL: u32 = 8u;       // ... cells with balance below -0.3 (anion-passing)
const IZ_PC: u32 = 9u;         // ... sum of the share of a neutral's rate a cation passes now (holes, channels, stretch) x 1000
const IZ_PA: u32 = 10u;        // ... the same for an anion
const IZ_TIGHT: u32 = 11u;     // ... cells whose membrane passes ions at less than half a neutral's rate (both signs)
const IZ_OPEN: u32 = 12u;      // ... cells with the channel gene above +1 (channels e^1 = 2.7 x the founders')
const IZ_SHUT: u32 = 13u;      // ... cells with the channel gene below -1
var<workgroup> wio: array<atomic<i32>, 16>;
// ---- step C12e, WASTE MUST LEAVE (src/waste.js). Two pressures, both derived, no "expel" rule:
//   SATURATION (mass action): every reaction a cell runs slows as its own products pile up against its reactants: its rate x
//     (1 - Q / K), Q = the products' over the reactants' concentrations (each a share of the stock's capacity), K = exp(drive /
//     (theta x T)), drive = the energy the event gives off (a downhill reaction's release; an uphill one's photon surplus + its spark:
//     what the light and the battery put in beyond the rise). A big release is hard to clog, a small one clogs easily. The balance
//     point cannot be a gene: an engine is a catalyst, and a catalyst speeds both directions alike
//   OSMOSIS ON THE IONS: free ions (free givers and takers, by number) inside per unit of capacity - outside = the PRESSURE; the cell
//     SWELLS toward kOsm x pressure x its membrane's closure (its mean integrity: a leaky membrane holds no pressure) / its stiffness
//     (the bilayer's and wall's, C12b; the material's, C6c); a swollen membrane is thinner (the same material on a longer outline:
//     integrity falls), its STRETCH CHANNELS (a gene) open (the passive exchange x (1 + kStretch e^gene x swelling)), and past its
//     STRETCH TOLERANCE (a gene, paid as upkeep) it tears: it bursts at a rate rising with the excess
const WSF_SAT: u32 = 1u;       // saturation
const WSF_OSM: u32 = 2u;       // osmosis (master: swelling)
const WSF_STRETCH: u32 = 4u;   // ... stretch opens the membrane (the stretch channels gene)
const WSF_TEAR: u32 = 8u;      // ... overstretch tears (the stretch tolerance gene; bursting needs turnover, as bites')
const WSF_COST: u32 = 16u;     // ... the stretch tolerance costs upkeep
fn ws_flags() -> u32 { return bitcast<u32>(EP.ws[0].x); }
const W_TMADE: u32 = 62u;      // stock words: the free light takers t this cell has MADE (counts, since its birth), and
const W_TIMP: u32 = 63u;       // ... taken in from outside, net (exchange and pumps; < 0: it put out more than it took)
// counters (LG_WS + 256 + 16 q + slot, i32, the eat pass) and the snapshot census (LG_WS + 16 q + slot, the ledger pass)
const WC_WANT: u32 = 0u;       // reaction events (counts) the cells' reactions would run without saturation, / 16
const WC_LOST: u32 = 1u;       // ... of them lost to saturation, / 16
const WC_TMADE: u32 = 2u;      // free t made inside (counts)
const WC_TIN: u32 = 3u;        // free t taken in (exchange + pumps)
const WC_TOUT: u32 = 4u;       // free t put out
const WC_TEAR: u32 = 5u;       // cells that burst by overstretch
const WC_UPKEEP: u32 = 6u;     // heat counts the stretch tolerance's upkeep took
const WZ_N: u32 = 0u;          // snapshot: live cells
const WZ_P: u32 = 1u;          // ... sum of the osmotic pressure x 1000
const WZ_W: u32 = 2u;          // ... sum of the swelling x 1000
const WZ_UP: u32 = 3u;         // ... cells swollen by more than 10 %
const WZ_DOWN: u32 = 4u;       // ... cells shrunk by more than 10 %
const WZ_IMP: u32 = 5u;        // ... cells that took in more than one unit of t, net
const WZ_EXP: u32 = 6u;        // ... cells that put out more than one unit of t, net
const WZ_BR: u32 = 7u;         // ... cells with a breathing engine (one that uses a free t)
const WZ_OUTB: u32 = 8u;       // ... of them, breathing OUTSIDE t: took in more than one unit, more than they made
const WZ_SELFB: u32 = 9u;      // ... of them, burning their OWN t: made more than one unit, at least what they took in
const WZ_GCH: u32 = 10u;       // ... sum of the stretch channels gene x 1000
const WZ_GCH2: u32 = 11u;      // ... sum of its square x 1000
const WZ_GTOL: u32 = 12u;      // ... sum of the stretch tolerance gene x 1000
const WZ_GTOL2: u32 = 13u;     // ... sum of its square x 1000
const WZ_IONS: u32 = 14u;      // ... sum of the free ions inside (units per R^2) x 1000
const WZ_K: u32 = 15u;         // ... sum of the stiffness osmosis works against x 1000
var<workgroup> wws: array<atomic<i32>, 16>;
// the saturation factor 1 - Q / K: lq = ln(products' counts) - ln(reactants' counts), dn = (products - reactants), lnCap = ln(the
// stock's capacity in counts), drive in energy units, temp the temperature under the cell
fn sat_f(lq: f32, dn: f32, lnCap: f32, drive: f32, temp: f32) -> f32 {
  if ((ws_flags() & WSF_SAT) == 0u) { return 1.0; }
  let a = lq - dn * lnCap - max(drive, 0.0) / max(EP.ws[0].y * CP.theta * temp, 1e-6);
  return clamp(1.0 - exp(min(a, 0.0)), 0.0, 1.0);
}
fn lnc(n: i32) -> f32 { return log(max(f32(n), 0.5)); }
// a reaction's (or engine's) lq and dn from the stock (ch: reactants x, y, products z, w; 255 none; a light atom with its excited twin)
fn rx_lq(m: ptr<function, array<i32, 18>>, ch: vec4u) -> vec2f {
  var l = -lnc(xp(m, ch.x)) + lnc(xp(m, ch.z));
  var dn = 0.0;
  if (ch.y != NONE) { l -= lnc(xp(m, ch.y)); dn -= 1.0; }
  if (ch.w != NONE) { l += lnc(xp(m, ch.w)); dn += 1.0; }
  return vec2f(l, dn);
}
// how many free t (channel 1) one event makes (> 0) or uses (< 0)
fn t_net(ch: vec4u) -> i32 {
  return select(0, 1, ch.z == 1u) + select(0, 1, ch.w == 1u) - select(0, 1, ch.x == 1u) - select(0, 1, ch.y == 1u);
}
// step C13: the gates' bits (FG_* in cell_common.wgsl; src/guides.js writes them into EatP.wl1.z)
fn fg_bits() -> u32 { return bitcast<u32>(EP.wl1.z); }
// step C7b: the cofactor's factor for a cell holding `tr` trace per R^2 (1 while the rule is off)
fn cofactor(tr: f32) -> f32 {
  if (EP.cat.x <= 0.0) { return 1.0; }
  return EP.cat.y + (1.0 - EP.cat.y) * tr / (tr + max(EP.cat.z, 1e-9));
}
// step C7: pumps
const PUF_ON: u32 = 1u;        // pumps (master): the genome's pump slots move substances across the membrane
const PUF_CONTACT: u32 = 2u;   // ... across contact: a side touching a neighbour pumps from / into the neighbour's stock
const PUF_VOLT: u32 = 4u;      // ... membrane voltage: pumped charge builds a voltage that costs further pumping of that sign
const PUF_V2B: u32 = 8u;       // ... the voltage pays the battery as it leaks back (else its energy becomes heat)
const VQ: u32 = 14u;           // stock word: the charge the pumps moved across the membrane (counts of charge; + = into the cell)
const EVW: u32 = 15u;          // stock word: the energy stored in the voltage (heat counts; part of the books' "stored")
fn pu_flags() -> u32 { return bitcast<u32>(EP.pu0.x); }
// the energy of a voltage holding q charge counts (heat counts), for a capacitance cm (atom-units per unit voltage)
fn volt_energy(q: i32, cm: f32) -> f32 { let x = f32(q) / ATOM_SCALE; return 0.5 * x * x / max(cm, 1e-4) * HEAT_SCALE; }
// a channel's class for the pump counters: light atoms (g t), heavy atoms (G T), linkers (l L), fuels, trace
fn pump_class(ch: u32) -> u32 {
  if (ch == 0u || ch == 1u) { return 0u; }
  if (ch == 3u || ch == 4u) { return 1u; }
  if (ch == 2u || ch == 5u) { return 2u; }
  if (ch >= 6u && ch <= 9u) { return 3u; }
  return 4u;
}
// a pump's cost per count moved from concentration `src` to `dst` (units per R^2), heat counts: free down the gradient, base x a
// smooth ramp + the gradient cost x the e-folds up it (both bounded)
fn pump_cost(src: f32, dst: f32) -> f32 {
  let x = log((max(dst, 0.0) + EP.pu2.x) / (max(src, 0.0) + EP.pu2.x));
  if (x <= 0.0) { return 0.0; }
  return EP.pu0.y * clamp(x / max(EP.pu2.z, 1e-3), 0.0, 1.0) + EP.pu0.z * min(x, EP.pu2.y);
}
// two signed 16-bit counts in one word (a pump's two slots), and back
fn pack2(a: i32, b: i32) -> i32 { return (clamp(a, -32767, 32767) & 0xffff) | (clamp(b, -32767, 32767) << 16u); }
fn unpack2(w: i32) -> vec2i { return vec2i((w << 16u) >> 16u, w >> 16u); }
// step C7: the pump counters and census (LG_PU + 16 q + slot), see heat_common.wgsl
const PU_SNAP: u32 = 64u;      // snapshot numbers (the ledger pass), then 32 counters (the eat pass)
const PC_IN: u32 = 0u;         // counters 0..4: counts pumped in from the dish, per class; 5..9 out into the dish; 10..14 pulled
const PC_OUT: u32 = 5u;        // in from touching neighbours; 15..19 pushed out into them
const PC_CIN: u32 = 10u;
const PC_COUT: u32 = 15u;
const PC_GRAD: u32 = 20u;      // heat counts the batteries paid for pumping up gradients
const PC_VWORK: u32 = 21u;     // ... paid as work against the voltage (into its store)
const PC_VHEAT: u32 = 22u;     // ... the voltage's energy released as heat
const PC_VBAT: u32 = 23u;      // ... released into batteries
const PC_UPKEEP: u32 = 24u;    // ... pump upkeep
const PC_BUSY: u32 = 25u;      // cell-ticks with a pump moving something
const PC_CHARGE: u32 = 26u;    // |charge| counts the pumps moved
var<workgroup> wpu: array<atomic<i32>, 32>;
const MBF_ON: u32 = 1u;      // membrane chemistry (master): material, integrity, repair, leak
const MBF_BITE: u32 = 2u;    // ... bites
const MBF_BURST: u32 = 4u;   // ... bursting (only while turnover is on)
const MBF_SEL: u32 = 8u;     // ion selectivity gene
// step C12b, LIPID MEMBRANES (src/lipids.js): stock words 32..61, per kind LK_* six sides of molecule counts. The bilayer is
// SOAP (glL +, tlL -: a charged head on an oily tail), OIL (lL) slips in between the soap's tails (at most lp[5].y per soap
// molecule) and stiffens it; the WALL outside it is crust (ll, LL: one-row chains, a crystal): rigid and brittle
const LP0: u32 = 32u;
const LK_GP: u32 = 0u;       // soap glL (+)
const LK_TM: u32 = 1u;       // soap tlL (-)
const LK_OIL: u32 = 2u;      // oil lL
const LK_CL: u32 = 3u;       // crust ll (a light wall)
const LK_CH: u32 = 4u;       // crust LL (a heavy wall)
const LPF_ON: u32 = 1u;      // the lipid membranes (master; off: the C6c linker membrane)
const LPF_HEAT: u32 = 2u;    // ... heat makes the bilayer fluid (stiffness x 2 / (1 + T / Tref))
const LPF_CRACK: u32 = 4u;   // ... a strained wall cracks
const LPF_HEADS: u32 = 8u;   // ... the soap's heads charge the cell and its sides
const LPF_GRAZE: u32 = 16u;  // ... the supply fix (2026-11-16): cells graze the crust under them (walls whole, chains cracked)
fn lp_flags() -> u32 { return bitcast<u32>(EP.lp[0].x); }
fn lpw(kind: u32, side: u32) -> u32 { return LP0 + 6u * kind + side; }
// a lipid kind's channel in the dish (SUBSTANCES order; src/lipids.js checks)
fn lk_ch(k: u32) -> u32 { return select(select(select(select(11u, 10u, k == 3u), 13u, k == 2u), 15u, k == 1u), 14u, k == 0u); }
// a per-kind number from a vec4 (soap, oil, ll, LL): the two soaps share x
fn lk_of(v: vec4f, k: u32) -> f32 { return select(select(select(v.w, v.z, k == 3u), v.y, k == 2u), v.x, k <= 1u); }
// the BILAYER's stiffness from its lipids (S soap, O oil molecules): the polarity's tail atoms over its head atoms (packing over
// fluidity), relative to pure soap's (1 for pure soap; oil adds tails and no heads: stiffer), x 2 / (1 + T / Tref) (heat fluidises
// it: 2 when cold, 1 at Tref, falling as 1 / T when hot)
fn lip_kb(S: f32, O: f32, T: f32) -> f32 {
  let head = S * EP.lp[1].x + O * EP.lp[1].z;
  let tail = S * EP.lp[1].y + O * EP.lp[1].w;
  if (head <= 0.0) { return 0.0; }
  let rho = (tail / head) / max(EP.lp[1].y / max(EP.lp[1].x, 1e-6), 1e-6);
  var hf = 1.0;
  if ((lp_flags() & LPF_HEAT) != 0u) { hf = 2.0 / (1.0 + max(T, 0.0) / EP.lp[0].y); }
  return rho * hf;
}
// step C12b: the lipid counters (LG_LIP_C + 16 q + slot) and census (LG_LIP_S + 16 q + slot; the ledger pass)
const LC_BITE_B: u32 = 0u;   // counters: bilayer molecules bitten out
const LC_BITE_W: u32 = 1u;   // ... wall molecules bitten out
const LC_SOAP: u32 = 2u;     // ... soap made from atoms (the builder)
const LC_OIL: u32 = 3u;      // ... oil made
const LC_WALL: u32 = 4u;     // ... crust made
const LC_FUSED: u32 = 5u;    // ... lipid molecules taken in from the dish (fusion)
const LC_SHED: u32 = 6u;     // ... lipid molecules shed into the dish
const LC_CRACK: u32 = 7u;    // ... crust broken off by cracks
// the supply fix (2026-11-16), cells graze crust: counters 8..13 at LG_LIP_G + 16 (q - 8) + slot
const LC_GRAZE_L: u32 = 8u;   // ... light crust (ll) taken in from the dish under cells (counts)
const LC_GRAZE_H: u32 = 9u;   // ... heavy crust (LL)
const LC_GRAZE_W: u32 = 10u;  // ... of it, put into walls whole
const LC_GRAZE_CL: u32 = 11u; // ... ll cracked into two l
const LC_GRAZE_CH: u32 = 12u; // ... LL cracked into two L
const LC_GRAZE_PAID: u32 = 13u; // ... heat counts the batteries paid for cracking (the bonds' energy + the sparks)
var<workgroup> wlp: array<atomic<i32>, 16>;
// step C6d: charge per side
const DPE_ON: u32 = 1u;      // the side charges move (else they are kept even: the net charge / 6)
const DPE_DEPOSIT: u32 = 2u; // the cells put their charge into the substrate's field at their sides (else at the centre)
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
const EF_ELEC: u32 = 256u;   // step C12d: the electrons' table (the census counts breathing engines as eating; the burner is off)

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
const E2_GRAD: u32 = 14u;       // step C12f: counts the GRADIENT engines made (a bond from two free atoms with no free t: g + T, G + T)
const E2_GRADE: u32 = 15u;      // ... and the heat counts they put into batteries
var<workgroup> wev2: array<atomic<i32>, 16>;

// ==== step M1, WHOLE MEMBRANES (src/whole.js; README "Step M1: whole membranes") ====
// HEAD ON OIL (M1F_OILSOAP): a side short of soap that holds oil beyond what its soap's tails take puts a head from the stock on it
// (g + lL -> glL, t + lL -> tlL: the table's "head on", which step C12 runs only in the open), at the bilayer's reseal rate, the head
// the gene prefers first; the battery pays the head bond's spark (and, under a table where the head bond is uphill, the difference),
// the rest is heat. Fusion takes oil for it too (oil is the soap's tail, and the dish holds more oil than soap), and oil waiting for a
// head is not shed. Off: as step C12b (oil only between the tails; oil on a side without soap is shed again)
const M1F_OILSOAP: u32 = 1u;
// BITES THROUGH THE BLOCK (M1F_BITEBLOCK): the biting atoms are free ions; an intact bilayer keeps them off its chains as it keeps them
// out (step C12g): a side's bilayer is bitten x ((1 - its integrity) + integrity x ionPass). Needs the ion block on. The wall (outside) as before
const M1F_BITEBLOCK: u32 = 2u;
fn m1_flags() -> u32 { return bitcast<u32>(EP.m1[0].x); }
// counters (LG_M1 + 256 + 16 q + slot, i32: the eat, dump, split and reset passes), in molecule counts
const M1C_FUSE_S: u32 = 0u;    // soap fused into membranes from the dish
const M1C_FUSE_O: u32 = 1u;    // oil fused
const M1C_MADE_S: u32 = 2u;    // soap made from atoms (the C12b builder: head + l + L)
const M1C_MADE_O: u32 = 3u;    // oil made from atoms (l + L)
const M1C_BITE_S: u32 = 4u;    // soap bitten out of membranes
const M1C_BITE_O: u32 = 5u;    // oil bitten out
const M1C_SHED_S: u32 = 6u;    // soap shed into the dish (beyond what a side wants)
const M1C_SHED_O: u32 = 7u;    // oil shed
const M1C_SPILL: u32 = 8u;     // bilayer molecules (soap + oil) spilled at deaths, bursts and resets
const M1C_SPLIT: u32 = 9u;     // bilayer molecules a newborn took from its parent at a birth
const M1C_SH_HEAD: u32 = 10u;  // soap the builder wanted but could not make, the first limit: no head (g or t) in the stock
const M1C_SH_L: u32 = 11u;     // ... no light linker l
const M1C_SH_LL: u32 = 12u;    // ... no heavy linker L
const M1C_SH_BAT: u32 = 13u;   // ... the battery
const M1C_HEADON: u32 = 14u;   // soap made by putting a head on oil (M1F_OILSOAP)
var<workgroup> wm1: array<atomic<i32>, 16>;
// the snapshot (LG_M1 + 16 q + slot, the ledger pass)
const M1Z_N: u32 = 0u;         // live cells
const M1Z_INTEG: u32 = 1u;     // sum of the mean integrity x 1000
const M1Z_B0: u32 = 2u;        // cells with mean integrity below 0.2, 0.2..0.4, 0.4..0.6, 0.6..0.8, 0.8 and above (2..6)
const M1Z_WANT: u32 = 7u;      // sum of the bilayer molecules the cells' sides want (counts / 16)
const M1Z_HELD: u32 = 8u;      // ... hold (soap + the oil between its tails, counts / 16)
const M1Z_HAS_LL: u32 = 9u;    // cells holding a heavy linker L in the stock (at least 1/512 of a unit)
const M1Z_HAS_L: u32 = 10u;    // ... a light linker l
const M1Z_HAS_ALL: u32 = 11u;  // ... both linkers and a head (g or t): what the builder needs
const M1Z_EMPTY: u32 = 12u;    // cells with a battery below 5 %
const M1Z_WOIL: u32 = 13u;     // sum of the oil in membranes beyond the soap's tails (counts / 16)
var<workgroup> wm1s: array<atomic<i32>, 16>;
// ==== end of step M1's declarations ====

// ==== step T1a, TISSUES 1: AN INSIDE, KIN CHANNELS, THE SELF MARKER (src/kin.js; README "Step T1a") ====
// AN INSIDE (T1F_INSIDE): a membrane side PRESSED against a neighbour (it lists one across it, closer than press x the two radii) does
// not trade with the dish under it; only the FREE sides do. So every exchange with the dish is x the free share of the perimeter
// (1 - seal x the covered sides' length / the perimeter): the passive exchange (and so the haze, the vandal atoms, oxygen), fusion and
// grazing; per side, the bites and the pumps to the dish skip covered sides; osmosis's outside concentration is, over a covered side,
// the neighbour's inside. Light still falls on every cell from above, and heat passes through cells (it is not matter).
// KIN CHANNELS (T1F_KIN): gap junctions. Two cells in contact (each lists the other, pressed) share small NEUTRAL molecules (the four
// fuels, the free linkers l and L, trace) down the gradient, free, through a conductance min(open_i accept_i, open_j accept_j) (each
// cell's kin-channel gene x how far it accepts the other as kin: kin_match by the markers' moire beat, kin_accept by its tolerance), x kinK
// x the shared wall's length / R, x each molecule's own speed (EP.ratio). The cell with the lower index works out each pair (plan, flux
// words S.count SW + i KW..: per side 4 words, two channels each, + = into it); both apply it (eat), so every count leaves one stock and
// arrives in the other. A pair moves at most kinCap of the source per tick (with the pumps' worst case, no stock goes below 0).
// T1F_BLIND: the channels open to every neighbour (kinship ignored); T1F_NULL: the neutral control, the channels move nothing (genes drift).
// SMELL FOR TRACE (T1F_SMELL): the membrane's corners smell trace too, each unit weighted as traceWorth units of the richest fuel x the
// share of the engines' speed the lack of trace still holds back ((1 - cofactor) / (1 - f0) at the trace inside: 1 with none, 0 sated)
const T1F_INSIDE: u32 = 1u;
const T1F_KIN: u32 = 2u;
const T1F_BLIND: u32 = 4u;
const T1F_NULL: u32 = 8u;
const T1F_SMELL: u32 = 16u;
fn t1_flags() -> u32 { return bitcast<u32>(EP.t1[0].x); }
const KW: u32 = 24u;   // kin-channel words per cell (6 sides x 4)
const TRACE_CH: u32 = 12u;   // trace's channel (SUBSTANCES order; the plan has no ChemP: CP.trace in the eat pass)
// the channels the kin channels pass, two to a word: gt gT | Gt GT | l L | trace -
fn kin_ch(q: u32) -> u32 { return select(select(select(6u + q, 2u, q == 4u), 5u, q == 5u), 12u, q == 6u); }
// the sides pressed against a live neighbour (bit k: side k), from the step's neighbour list
fn cover_mask(c: Cell, i: u32) -> u32 {
  if (S.count > NBR_NONE) { return 0u; }
  var m = 0u;
  for (var k = 0u; k < 6u; k++) {
    let j = cell_nbr(c, k);
    if (j >= S.count || j == i) { continue; }
    let fj = cells[j].flags;
    if ((fj & CELL_ALIVE) == 0u || (cell_burst(fj) != 0u && (mb_flags() & MBF_BURST) != 0u)) { continue; }
    if (distance(cells[j].pos, c.pos) < EP.t1[0].z * (c.r + cells[j].r)) { m |= 1u << k; }
  }
  return m;
}
// counters (LG_T1 + 512 + 16 q + slot, i32; the eat pass), in counts
const T1C_FUEL: u32 = 0u;      // fuel shared through kin channels
const T1C_LINK: u32 = 1u;      // free linkers (l, L) shared
const T1C_TRACE: u32 = 2u;     // trace shared
const T1C_PAIRS: u32 = 3u;     // pairs that moved anything (per tick)
// step P1, predators: counters 4..15 of the same block (src/predators.js reads them)
const P1C_PAID: u32 = 4u;      // heat counts the batteries paid for engulfing (the step's Cell.engPay)
const P1C_ATOMS: u32 = 5u;     // atom counts digested from meals into stocks (with the meals' membrane weave and pigment as atoms)
const P1C_LIPID: u32 = 6u;     // lipid molecules (soap, oil, crust) from meals into the hosts' membranes
const P1C_BAT: u32 = 7u;       // heat counts from meals' batteries into the hosts' batteries
const P1C_HEAT: u32 = 8u;      // ... the rest of the meals' batteries, as heat
const P1C_SPILL: u32 = 9u;     // atom counts left over at a digestion's end (no room in the host), spilled into the dish
const P1C_MEALS: u32 = 10u;    // digestions finished
const P1C_WRAPM: u32 = 11u;    // membrane molecules (or weave linkers) the hosts gave the phagosomes at the catch
const P1C_VOID: u32 = 12u;     // digestions that found no meal (another predator caught it first)
const P1C_ORPHAN: u32 = 13u;   // ghosts whose host died or burst: spilled into the dish
var<workgroup> wt1: array<atomic<i32>, 16>;
// the snapshot (LG_T1 + 16 q + slot, the ledger pass): T1Z_*
const T1Z_N: u32 = 0u;         // live cells
const T1Z_FREE: u32 = 1u;      // free sides, summed
const T1Z_BIN: u32 = 2u;       // 2..5 cells with 0, 1-2, 3-4, 5-6 free sides (enclosed .. alone)
const T1Z_BAT: u32 = 6u;       // 6..9 ... their battery share x 1000
const T1Z_INTEG: u32 = 10u;    // 10..13 ... their mean integrity x 1000
const T1Z_TIN: u32 = 14u;      // 14..17 ... the free t (oxygen-like) in their stock, x 1000 per unit
const T1Z_CON: u32 = 18u;      // contacts (pairs in mutual pressed contact, each once)
const T1Z_KIN: u32 = 19u;      // ... their kinship (marker match) x 1000
const T1Z_ACC: u32 = 20u;      // ... those both cells accept as kin (accept > 0.5 both ways)
const T1Z_OPEN: u32 = 21u;     // ... their channel conductance (min open x accept) x 1000
const T1Z_GK: u32 = 22u;       // the kin channel gene x 1000, summed
const T1Z_GK2: u32 = 23u;      // ... its square x 1000
const T1Z_GT: u32 = 24u;       // the tolerance gene x 1000
const T1Z_GD: u32 = 25u;       // the display gene x 1000
const T1Z_GD2: u32 = 26u;      // ... its square x 1000
const T1Z_KC: u32 = 27u;       // cells with a kin channel gene above 0.25
const T1Z_STR: u32 = 28u;      // contacts between strangers (match below 0.1)
const T1Z_FS: u32 = 29u;       // the free share of the perimeter x 1000, summed
var<workgroup> wt1s: array<atomic<i32>, 32>;
// ==== end of step T1a's declarations ====

// ==== step T1b, THE GENE NETWORK'S OUTPUTS (src/grn.js; cell_common.wgsl GRN_*): cell i's factor for output o, exp(u x) of the
// regulator it reads (1 while the outputs do not act: the network off, or its neutral control). Each output multiplies a gene's base
// level where the gene is read; an engine's upkeep and pigment follow its expressed rate, so a cell can switch an engine off ====
fn grn_on() -> bool { return (bitcast<u32>(EP.t1[1].z) & GRN_ACT) != 0u; }
fn gof(i: u32, o: u32) -> f32 {
  if (!grn_on()) { return 1.0; }
  let j = grn_reg(bio[i].go, o);
  return grn_fac(bio[i].gu[o >> 2u][o & 3u], bio[i].gx[j >> 2u][j & 3u]);
}
// the membrane's genes as expressed: the thickness and the stiffness gene x their outputs
fn bio_memb(i: u32) -> vec4f { let m = bio[i].memb; return vec4f(m.x, m.y * gof(i, GRN_O_THICK), m.z * gof(i, GRN_O_STIFF), m.w); }
// ... the pump slots' rates, the marker (its display), the kin channels' opening, the ion channels' level (a log factor)
fn bio_pump(i: u32) -> vec4f { let p = bio[i].pump; return vec4f(p.xy, p.zw * gof(i, GRN_O_PUMP)); }
fn bio_mark(i: u32) -> vec4f { let m = bio[i].mark; return vec4f(m.xyz, m.w * gof(i, GRN_O_DISP)); }
fn bio_kin_open(i: u32) -> f32 { return clamp(bio[i].kin.x * gof(i, GRN_O_KIN), 0.0, 1.0); }
fn bio_chan(i: u32) -> f32 { return bio[i].gate2.w + log(gof(i, GRN_O_CHAN)); }
// the senses the eat pass hands the gene network (Cell.sns0, sns1): an amount as 1 - e^-(amount / (capacity x ref))
const GRN_REF_T: f32 = 0.001;     // free t (oxygen-like)       (refs: the default scene's means come out 0.1 .. 0.4)
const GRN_REF_FUEL: f32 = 0.005;  // fuel (gt gT Gt GT)
const GRN_REF_LINK: f32 = 0.001;  // free linkers (l L)
fn grn_amount(n: i32, cap: f32, sref: f32) -> f32 { return 1.0 - exp(-f32(max(n, 0)) / max(cap * sref, 1.0)); }
// ==== end of step T1b's declarations ====

// ==== step N1, A NUTRIENT LANDSCAPE: LIGHT NEEDS MATTER (src/pigments.js; README "Step N1: nutrient landscape") ====
// A harvest slot's PIGMENT is a molecule the cell BUILDS from its stock: two light linkers l (a chain that shares its electrons, an
// antenna, like chlorophyll's conjugated ring) holding one trace atom at its heart (like chlorophyll's magnesium). Stock word W_PIG
// holds it (counts; each count = 2 l + 1 trace; the atoms' books count it with the cells' l and trace; its energy is the free atoms',
// 0, so building it costs only its assembly, nl[0].w heat counts per count from the battery, as heat). It WEARS OUT (nl[1].x per tick,
// back into its atoms in the stock), so keeping it costs matter and battery all the time. A slot's optical depth is pigK x rate x the
// share of the wanted pigment the cell holds. PHOTOSYNTHESIS SATURATES: of the photons caught at a light s (a share of the full noon
// light), only Isat tanh(s / Isat) / s can be used; the rest are heat (idle photons) and, as PHOTOINHIBITION, each bleaches nl[1].z
// counts of the pigment (back into its atoms): shade is worth having under a strong light or a bright caustic line.
const W_PIG: u32 = 30u;          // stock word: the pigment (counts)
const N1_TRACE: u32 = 12u;       // trace's channel (src/eat.js checks)
const NLF_MATTER: u32 = 1u;      // pigments are built from the stock and wear out
const NLF_SAT: u32 = 2u;         // photosynthesis saturates
const NLF_INHIB: u32 = 4u;       // photons past saturation bleach the pigment
const NLF_SHED: u32 = 8u;        // (after the C12g + N1 merge) TRACE LEAVES LIFE: a worn or bleached pigment's trace atom goes to the DISH
                                 // under the cell (the broken antenna's metal is lost with it), its two l back into the stock
// counters (LG_N1 + 128 k, 64-bit): counts of photons (events) unless said otherwise
const N1_RISE: u32 = 0u;         // heat counts the pigments' photons stored uphill (n x the engine's rise): the energy light made
const N1_CAUGHT: u32 = 1u;       // photons the pigments caught
const N1_ISAT: u32 = 2u;         // ... not used: past saturation
const N1_ICOF: u32 = 3u;         // ... not used: no cofactor (trace)
const N1_IMAT: u32 = 4u;         // ... not used: the raw material ran out
const N1_ICAP: u32 = 5u;         // ... not used: the engine's top speed
const N1_IBAT: u32 = 6u;         // ... not used: the battery could not pay the spark (and a weak photon's difference)
const N1_IWASTE: u32 = 7u;       // ... not used: saturation by the products (step C12e)
const N1_BUILT: u32 = 8u;        // pigment counts built
const N1_BUILDE: u32 = 9u;       // heat counts paid for building
const N1_WEAR: u32 = 10u;        // pigment counts worn out (or let go while the rule is off)
const N1_INHIB: u32 = 11u;       // pigment counts bleached by photoinhibition
const N1_HELD: u32 = 12u;        // snapshot (ledger pass): pigment counts held
const N1_CELLS: u32 = 13u;       // snapshot: cells holding pigment
const N1_SHED: u32 = 14u;        // trace counts a worn or bleached pigment put into the dish (NLF_SHED)
var<workgroup> wn1: array<atomic<i32>, 16>;   // (12 until the trace shed; 12, 13 stay 0: the ledger pass writes those)
fn n1_flags() -> u32 { return bitcast<u32>(EP.nl[0].x); }
// a broken pigment's trace (n counts): with NLF_SHED into the dish under the cell (while trace moves in the dish), else back into the
// stock; returns what stays in the stock
fn n1_shed(n: i32, cur: u32, idx: array<u32, 9>) -> i32 {
  if (n > 0 && (n1_flags() & NLF_SHED) != 0u && cur != 0u && (EP.mask & (1u << N1_TRACE)) != 0u) {
    spread9(cur + N1_TRACE * EP.n, idx, n);
    atomicAdd(&wn1[N1_SHED], n);
    return 0;
  }
  return n;
}
// the CAUSTIC light at p (src/water.js: the water surface focusing the light, x the light_factor; 1 without it)
fn caustic_at(p: vec2f) -> f32 {
  if (HP.caus == 0u) { return 1.0; }
  let q = heat_xy(HP, p);
  return bitcast<f32>(atomicLoad(&hb[HP.caus + u32(q.y) * HP.hw + u32(q.x)]));
}
// ==== end of step N1's declarations ====

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

fn ep_f(a: array<vec4f, 4>, c: u32) -> f32 { let g = gc(c); return a[g / 4u][g % 4u]; }   // (step C12c: an excited channel
fn ep_i(a: array<vec4i, 4>, c: u32) -> i32 { let g = gc(c); return a[g / 4u][g % 4u]; }   //  reads its ground twin's numbers;
fn ep_u(a: array<vec4u, 4>, c: u32) -> u32 { let g = gc(c); return a[g / 4u][g % 4u]; }   //  its energy is CP.ex.y)

// step C12c, EXCITED WASTE (src/excited.js): the cells hold the excited light atoms too, as channels 16, 17 (g*, t*) at stock
// words 28, 29 and exchange words 40, 41 (flux; 42, 43: the excited atoms that bit the membrane this tick, g*, t*). The cell
// channels in order: 0..12, then 16, 17
const NCELL: u32 = 15u;
fn cell_ch(j: u32) -> u32 { return select(j, j + 3u, j >= 13u); }
fn stock_w(c: u32) -> u32 { return select(c, c + 12u, c >= EXC0); }
fn flux_w(c: u32) -> u32 { return select(c, c + 24u, c >= EXC0); }
// a reactant channel as a POOL: a light giver or taker with its excited twin (they react alike)
fn xp(m: ptr<function, array<i32, 18>>, c: u32) -> i32 {
  if (c < 2u) { return (*m)[c] + (*m)[c + EXC0]; }
  return (*m)[c];
}
// n counts taken from the pool of c, the excited ones in proportion (rounded at random with r); returns how many were excited
fn xtk(m: ptr<function, array<i32, 18>>, c: u32, n: i32, r: f32) -> i32 {
  if (c >= 2u || (*m)[c + EXC0] <= 0) { (*m)[c] -= n; return 0; }
  let x = (*m)[c + EXC0];
  let tot = (*m)[c] + x;
  var nx = i32(floor(f32(n) * f32(x) / f32(max(tot, 1)) + r));
  nx = clamp(nx, max(n - (*m)[c], 0), min(n, x));
  (*m)[c + EXC0] -= nx;
  (*m)[c] -= n - nx;
  return nx;
}
// step C12c counters: excited atoms (XN_*, i32, 16 slots) and their energy (XE_*, 64-bit) (heat_common.wgsl)
var<workgroup> wxn: array<atomic<i32>, 8>;
var<workgroup> wxe: array<atomic<i32>, 6>;

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
  for (var j = 0u; j < NCELL; j++) {
    let c = cell_ch(j);   // (step C12c: and the excited atoms)
    let m = atomicExchange(&stock[i * SW + stock_w(c)], 0);
    if (m <= 0) { continue; }
    let na = i32(ep_f(EP.natoms, c));
    if (cur != 0u && (EP.mask & (1u << c)) != 0u) {
      spread9(cur + c * EP.n, idx, m);
      back += m * na;
    } else {
      add64(lg_mc(LG_M_GONE, c) + slot, m);
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
  // step C12b: the lipid membrane's molecules, as themselves (soap, oil and crust into the dish, where they gather into droplets
  // and films, or sit as crust)
  for (var w = 0u; w < 30u; w++) {
    let m = atomicExchange(&stock[i * SW + LP0 + w], 0);
    if (m <= 0) { continue; }
    if (w < 18u) { atomicAdd(&wm1[M1C_SPILL], m); }   // (step M1: the bilayer's molecules, soap and oil)
    let c = lk_ch(w / 6u);
    let na = i32(ep_f(EP.natoms, c));
    if (cur != 0u && (EP.mask & (1u << c)) != 0u) {
      spread9(cur + c * EP.n, idx, m);
      back += m * na;
    } else {
      add64(lg_mc(LG_M_GONE, c) + slot, m);
      gone += m * na;
    }
  }
  // step N1: the pigment, as its atoms (one trace and two light linkers per count)
  let pgv = atomicExchange(&stock[i * SW + W_PIG], 0);
  if (pgv > 0) {
    for (var q = 0u; q < 2u; q++) {
      let c = select(N1_TRACE, MB_CH_L, q == 1u);
      let mm = select(pgv, 2 * pgv, q == 1u);
      if (cur != 0u && (EP.mask & (1u << c)) != 0u) { spread9(cur + c * EP.n, idx, mm); back += mm; }
      else { add64(lg_mc(LG_M_GONE, c) + slot, mm); gone += mm; }
    }
  }
  // (step C7: and the energy stored in its membrane voltage, as heat with the battery; the voltage itself is gone)
  atomicStore(&stock[i * SW + VQ], 0);
  atomicStore(&stock[i * SW + W_TMADE], 0);   // (step C12e: its t counters start again with the next cell in the slot)
  atomicStore(&stock[i * SW + W_TIMP], 0);
  let b = atomicExchange(&stock[i * SW + BAT], 0) + max(atomicExchange(&stock[i * SW + EVW], 0), 0);
  if (b > 0) { spread9(LEDGER_WORDS, idx, b); }
  atomicAdd(&wev[EV_DUMP], back);
  atomicAdd(&wev[EV_GONE], gone);
  atomicAdd(&wev[EV_BATBACK], max(b, 0));
  cb_give_back(i, idx, slot);   // step C15b: and its carbon (cell_carbon.wgsl)
}

fn flush_counters(li: u32, slot: u32) {
  workgroupBarrier();
  cb_flush(li, slot);   // step C15b
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
  } else if (li < 56u) {
    // step C12b: the lipid counters (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wlp[li - 48u]);
    if (v != 0) { atomicAdd(&hb[LG_LIP_C + 16u * (li - 48u) + (slot & 15u)], v); }
  } else {
    // the supply fix: the grazing counters (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wlp[li - 48u]);
    if (v != 0) { atomicAdd(&hb[LG_LIP_G + 16u * (li - 56u) + (slot & 15u)], v); }
  }
  if (li < 32u) {
    // step C7: the pumps' counters (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wpu[li]);
    if (v != 0) { atomicAdd(&hb[LG_PU + 16u * (PU_SNAP + li) + (slot & 15u)], v); }
  }
  // step C12e: the waste counters (16 slots, i32: cleared at each read-back)
  if (li < 16u) {
    let v = atomicLoad(&wws[li]);
    if (v != 0) { atomicAdd(&hb[LG_WS + 256u + 16u * li + (slot & 15u)], v); }
  } else if (li < 32u) {
    // step C12g: the ion flow's counters (16 slots, i32: cleared at each read-back)
    let v = atomicLoad(&wio[li - 16u]);
    if (v != 0) { atomicAdd(&hb[LG_IO + 256u + 16u * (li - 16u) + (slot & 15u)], v); }
  }
  // step M1: the whole membranes' counters (16 slots, i32: cleared at each read-back)
  if (li >= 16u && li < 32u) {
    let v = atomicLoad(&wm1[li - 16u]);
    if (v != 0) { atomicAdd(&hb[LG_M1 + 256u + 16u * (li - 16u) + (slot & 15u)], v); }
  }
  // step T1a: the kin channels' counters (16 slots, i32: cleared at each read-back)
  if (li >= 32u && li < 48u) {
    let v = atomicLoad(&wt1[li - 32u]);
    if (v != 0) { atomicAdd(&hb[LG_T1 + 512u + 16u * (li - 32u) + (slot & 15u)], v); }
  }
  // step N1: the pigments' counters
  if (li < 16u) {
    let v = atomicLoad(&wn1[li]);
    if (v != 0) { add64(LG_N1 + 128u * li + slot, v); }
  }
  // step C12c: the excited atoms' counters
  if (li < 8u) {
    let v = atomicLoad(&wxn[li]);
    if (v != 0) { atomicAdd(&hb[LG_EXC_N + 16u * li + (slot & 15u)], v); }
  } else if (li < 14u) {
    add64(LG_EXC_E + 128u * (li - 8u) + slot, atomicLoad(&wxe[li - 8u]));
  }
}

// ---------- dump ----------
@compute @workgroup_size(64)
fn dump(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  if (i < S.count) {
    let c = cells[i];
    // step P1: a GHOST (a dead slot holding a meal) keeps its stock while its host digests it; one whose host no longer does (the host
    // died, burst, or another predator got the meal) spills it at its place, as any death does
    if (by_mode(c.engBy) == BY_GHOST && (c.flags & CELL_ALIVE) == 0u) {
      let h = by_partner(c.engBy);
      var keep = false;
      if (h < S.count && h != i) {
        let ch = cells[h];
        keep = (ch.flags & CELL_ALIVE) != 0u && cell_burst(ch.flags) == 0u && eng_mode(ch.eng) == ENG_DIGEST && eng_partner(ch.eng) == i;
      }
      if (!keep) {
        give_back(i, c.pos, S.matterCur, wid.x & 63u);
        cells[i].engBy = 0u;
        atomicAdd(&wt1[P1C_ORPHAN], 1);
      }
    } else if ((c.flags & CELL_BORN) != 0u) { give_back(i, c.dead, S.matterCur, wid.x & 63u); }
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
  // step C9: a cell that died for good (division mode) only had its stock handed back (dump); its slot is now free
  if ((c.flags & CELL_ALIVE) == 0u) { cells[i].flags = c.flags & ~CELL_BORN; return; }
  let pi = min(c.mom & ~MOM_DIV, S.count - 1u);
  if (pi != i) {
    // step C9: a division's daughter: first the division's cost, from the mother's battery, as heat where she is
    if ((c.mom & MOM_DIV) != 0u && EP.dv.y > 0u) {
      let cost = take_stock(pi * SW + BAT, i32(EP.dv.y));
      if (cost > 0) { spread9(LEDGER_WORDS, footprint(cells[pi].pos), cost); atomicAdd(&hb[LG_DIV + (i & 15u)], cost); }
    }
    // step G1: PROOFREADING's cost (any birth: turnover or division), from the parent's battery, as heat where she is: dv.z x (e^F - 1) for
    // her fidelity gene F above the founders' (src/fidelity.js)
    if ((EP.dv.w & FID_ACT) != 0u && EP.dv.z > 0u) {
      let pf = clamp(bio[pi].conv.w, FID_LO, FID_HI);
      let want = i32(round(f32(EP.dv.z) * max(exp(pf) - 1.0, 0.0)));
      if (want > 0) {
        let paid = take_stock(pi * SW + BAT, want);
        if (paid > 0) {
          spread9(LEDGER_WORDS, footprint(cells[pi].pos), paid);
          atomicAdd(&hb[LG_DIV + 16u * FDC_COST + (i & 15u)], paid);
          atomicAdd(&hb[LG_DIV + 16u * FDC_PAID + (i & 15u)], 1);
        }
        if (want > paid) { atomicAdd(&hb[LG_DIV + 16u * FDC_SHORT + (i & 15u)], want - paid); }
      }
    }
    for (var k = 0u; k <= BAT + 2u; k++) {
      let w = select(k, k + 14u, k > BAT);   // (step C12c: and the excited atoms, words 28, 29)
      let h = atomicLoad(&stock[pi * SW + w]);
      let got = take_stock(pi * SW + w, h / 2);
      if (got > 0) { atomicAdd(&stock[i * SW + w], got); }
    }
    // step C7: and half of its membrane voltage (the pumped charge, either sign) and of the energy stored in it
    let vh = atomicLoad(&stock[pi * SW + VQ]) / 2;
    if (vh != 0) { atomicSub(&stock[pi * SW + VQ], vh); atomicAdd(&stock[i * SW + VQ], vh); }
    let eh = take_stock(pi * SW + EVW, atomicLoad(&stock[pi * SW + EVW]) / 2);
    if (eh > 0) { atomicAdd(&stock[i * SW + EVW], eh); }
    // step N1: and half of its pigment
    let pgh = take_stock(pi * SW + W_PIG, atomicLoad(&stock[pi * SW + W_PIG]) / 2);
    if (pgh > 0) { atomicAdd(&stock[i * SW + W_PIG], pgh); }
    // step C6c: and a share r / (r + r_parent) of each side of the parent's membrane (side k to side k), so both start with
    // about the parent's integrity (the newborn is smaller and wants less)
    let sh = c.r / max(c.r + cells[pi].r, 1e-3);
    for (var k = 0u; k < 12u; k++) {
      let h = atomicLoad(&stock[pi * SW + MB_L0 + k]);
      let got = take_stock(pi * SW + MB_L0 + k, i32(floor(f32(h) * sh)));
      if (got > 0) { atomicAdd(&stock[i * SW + MB_L0 + k], got); }
    }
    // step C12b: and the same share of each side's lipids (the bilayer and the wall)
    var gotB = 0;
    for (var w = 0u; w < 30u; w++) {
      let h = atomicLoad(&stock[pi * SW + LP0 + w]);
      let got = take_stock(pi * SW + LP0 + w, i32(floor(f32(h) * sh)));
      if (got > 0) { atomicAdd(&stock[i * SW + LP0 + w], got); if (w < 18u) { gotB += got; } }
    }
    if (gotB > 0) { atomicAdd(&hb[LG_M1 + 256u + 16u * M1C_SPLIT + (i & 15u)], gotB); }   // (step M1: the bilayer the newborn took)
    cb_split(i, pi, sh);   // step C15b: half the parent's ladder, the same share of its granules
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
  if ((c.flags & CELL_ALIVE) == 0u) {
    // step C9: a free slot (or a cell that died this tick) asks nothing of its neighbours: its pump requests, which their
    // eat applies in reverse, are cleared (stale ones would make or lose matter)
    for (var k = 16u; k < 46u; k++) { flux[i * SW + k] = 0; }   // (step C12b: and the lipid bites, 32..38; C12c: 40..43; C12g: 44, 45)
    if ((t1_flags() & T1F_KIN) != 0u) { for (var w = 0u; w < KW; w++) { flux[S.count * SW + i * KW + w] = 0; } }   // (step T1a: its kin requests)
    return;
  }
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
  for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); atomsIn += f32(stockP[fo + stock_w(k)]) * ep_f(EP.natoms, k); }
  // step C6c: the membrane's material per side (it takes room in the cell too) and its integrity
  let mbf = mb_flags();
  let membOn = (mbf & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u;
  let gm = bio_memb(i);   // (step T1b: the thickness and stiffness as expressed)
  var ml: array<i32, 6>;
  var mh: array<i32, 6>;
  var integ = 0.0;
  let want = max(memb_want(c.r, gm.y), 1.0);
  // step C12b: with the lipid membranes on, the old weave holds only the walls' glue (step C10) and the integrity is the
  // BILAYER's (soap + the oil between its tails, over what the thickness asks); the lipids take room in the cell too
  let lipOn = membOn && (lp_flags() & LPF_ON) != 0u;
  var lpm: array<array<i32, 6>, 5>;
  var headQ = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);   // the soap heads' charge per side (atom-units)
  let headsOn = (lp_flags() & LPF_HEADS) != 0u;
  for (var k = 0u; k < 6u; k++) {
    ml[k] = stockP[fo + MB_L0 + k];
    mh[k] = stockP[fo + MB_H0 + k];
    atomsIn += f32(ml[k] + mh[k]);
    for (var q = 0u; q < 5u; q++) { lpm[q][k] = stockP[fo + lpw(q, k)]; }
    let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
    atomsIn += 3.0 * S + 2.0 * f32(lpm[LK_OIL][k] + lpm[LK_CL][k] + lpm[LK_CH][k]);
    if (headsOn) { headQ[k] = f32(lpm[LK_GP][k] - lpm[LK_TM][k]) / ATOM_SCALE; }
    if (lipOn) { integ += min((S + min(f32(lpm[LK_OIL][k]), EP.lp[5].y * S)) / want, 1.0); }
    else { integ += min(f32(ml[k] + mh[k]) / want, 1.0); }
  }
  integ /= 6.0;
  if (CARBON_ON != 0u) { atomsIn += cb_atoms(i); }   // step C15b: the cell's carbon takes room too
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
  // step C12e: a SWOLLEN membrane's stretch channels open (the gene lip.w, a log factor on kStretch): x (1 + kStretch e^gene x swelling)
  let wsf = ws_flags();
  var so = 0.0;
  if ((wsf & (WSF_OSM | WSF_STRETCH)) == (WSF_OSM | WSF_STRETCH) && c.osm > 0.0) { so = EP.ws[1].z * exp(bio[i].lip.w) * c.osm; }
  var ionsOut = 0;   // step C12e: the free ions (free givers and takers, by number) in the 9 pixels under the cell
  let selOn = (mbf & MBF_SEL) != 0u;
  // step C12g: the bilayer blocks ions (its intact share passes them through its channels only; holes and the stretch path as a
  // neutral molecule), and with IOF_VOLT what crosses the intact share feels the membrane voltage (equilibrium inside / outside =
  // exp(-z kV V)); the ions held back, per sign (counts, for the census)
  let ioF = io_flags();
  let blockOn = (ioF & IOF_BLOCK) != 0u && membOn;
  let chl = ion_chan(bio_chan(i), gm.w, selOn);   // (step T1b: the channels' level as expressed)
  let voltOn = blockOn && (ioF & IOF_VOLT) != 0u;
  var blk = vec2f(0.0);
  // step C6d: the through-flow onto each side (charge, counts per tick), the points just outside the sides' middles, each
  // side's share of the perimeter, and the mobile charge in the stock (atom-units)
  let dpOn = (EP.dpFlags & DPE_ON) != 0u && (c.flags & CELL_ALIVE) != 0u && !husk;
  var dq = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  var sp: array<vec2f, 6>;
  var sw = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  var mob = 0.0;
  let mbd = membrane(c);
  // ---- step T1a, AN INSIDE: the sides pressed against a neighbour (bits), each side's length, and the share of the perimeter still free to
  // trade with the dish (1 - seal x the covered length / the perimeter); for the eat pass too (flux 39: the free share, 46: the bits)
  let t1f = t1_flags();
  var lenK: array<f32, 6>;
  var perim = 0.0;
  for (var k = 0u; k < 6u; k++) { lenK[k] = length(mbd.edge[k]); perim += lenK[k]; }
  var covm = 0u;
  if ((t1f & (T1F_INSIDE | T1F_KIN)) != 0u && !husk) { covm = cover_mask(c, i); }
  let insideOn = (t1f & T1F_INSIDE) != 0u;
  var freeS = 1.0;
  var covW = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);   // each side's share closed to the dish (seal or 0)
  if (insideOn && covm != 0u) {
    var cl = 0.0;
    for (var k = 0u; k < 6u; k++) { if ((covm & (1u << k)) != 0u) { cl += lenK[k]; covW[k] = clamp(EP.t1[0].y, 0.0, 1.0); } }
    freeS = 1.0 - clamp(EP.t1[0].y, 0.0, 1.0) * cl / max(perim, 1e-6);
  }
  flux[fo + 39u] = bitcast<i32>(freeS);
  flux[fo + 46u] = i32(covm);
  if (dpOn) {
    var L = 0.0;
    for (var k = 0u; k < 6u; k++) {
      let e = mbd.edge[k];
      let len = length(e);
      sp[k] = c.pos + mbd.mid[k] + vec2f(e.y, -e.x) / max(len, 1e-6) * (0.5 * HP.px);
      sw[k] = len;
      L += len;
    }
    for (var k = 0u; k < 6u; k++) { sw[k] /= max(L, 1e-6); }
  }
  for (var j = 0u; j < NCELL; j++) {
    let k = cell_ch(j);   // (step C12c: the excited atoms pass as their ground atoms do)
    var n = 0;
    let zk = charge_of(EP.qCodes, k);
    let pk0 = select(ep_f(EP.perm, k), pgene * ep_f(EP.ratio, k), permG) * leak * freeS;   // a neutral molecule's rate (step T1a: x the free share)
    var pk = pk0 * (1.0 + so);
    var pkC = 0.0;   // step C12g: the part through the intact membrane (channels, the bilayer's leak, the stretch path)
    if (blockOn && zk != 0) {
      pkC = pk0 * (integ * ion_open(chl, zk) + so);
      pk = pk0 * (1.0 - integ) + pkC;
    } else if (selOn) { pk *= max(1.0 + gm.w * f32(zk), 0.0); }
    if (eatOn && pk > 0.0 && (EP.mask & (1u << k)) != 0u) {
      let base = cur - lw + k * EP.n;
      var Mo = 0;
      for (var q = 0; q < 9; q++) { Mo += max(mg[base + idx[q]], 0); }
      let Mi = stockP[fo + stock_w(k)];
      if (zk != 0) { ionsOut += Mo; }
      if (Mo != 0 || Mi != 0) {
        let jeq0 = (f32(Mo) * areaPx - f32(Mi) * Ao) / (Ao + areaPx);
        var jeq = jeq0;
        if (voltOn && zk != 0) {
          // what crosses the intact membrane settles at inside / outside concentrations exp(-z kV V) instead of 1; the holes' part as before
          let bv = exp(-clamp(f32(zk) * EP.io[0].w * c.volt, -8.0, 8.0));
          let jeqV = (f32(Mo) * areaPx * bv - f32(Mi) * Ao) / (Ao + areaPx * bv);
          jeq = (jeq0 * (pk - pkC) + jeqV * pkC) / max(pk, 1e-9);
        }
        var j = jeq * min(1.0, pk * EP.dt);
        if (j > 0.0) { j *= room; }
        n = i32(floor(j + u01(pcg(rs + k * 0x85ebca6bu))));
        n = clamp(n, -Mi, Mo);
        if (blockOn && zk != 0) {
          // held back: what a neutral molecule's rate would have moved, less what moves
          let j0 = jeq0 * min(1.0, pk0 * (1.0 + so) * EP.dt) * select(1.0, room, jeq0 > 0.0);
          let d = max(abs(j0) - abs(j), 0.0);
          if (zk > 0) { blk.x += d; } else { blk.y += d; }
        }
      }
      // step C6d: this channel's through-flow, if it is charged: per side its share of the perimeter x the exchange's
      // rate x (the concentration outside that side - the mean outside), in the units of jeq (9 pixels' worth)
      let z = zk;
      if (dpOn && z != 0) {
        mob += f32(Mi) / ATOM_SCALE;
        var cs: array<f32, 6>;
        var cm = 0.0;
        for (var a = 0u; a < 6u; a++) { cs[a] = grid_bilinear(base, sp[a]); cm += sw[a] * cs[a]; }
        let kf = f32(z) * min(1.0, pk * EP.dt) * 9.0 * areaPx / (Ao + areaPx);
        for (var a = 0u; a < 6u; a++) { dq[a] += kf * sw[a] * (cs[a] - cm); }
      }
    }
    flux[fo + flux_w(k)] = n;
  }
  // step C15b: the ladder's exchange (a neutral molecule's rate) and the tar to graze (cell_carbon.wgsl)
  if (CARBON_ON != 0u) {
    cb_plan(i, idx, areaPx, Ao, select(ep_f(EP.perm, 0u), pgene * ep_f(EP.ratio, 0u), permG) * leak * freeS, room, freeS, eatOn, rs);
  }
  flux[fo + 44u] = i32(floor(blk.x + u01(pcg(rs + 0x1f83d9abu))));   // step C12g: the ions held back (counts, + and -)
  flux[fo + 45u] = i32(floor(blk.y + u01(pcg(rs + 0x5be0cd19u))));
  // ---- step C12e, the OSMOTIC PRESSURE: the free ions inside (units per R^2 of the cell's area: a swollen cell's are diluted) - outside
  // (the 9 pixels'), per unit of the stock's capacity (capR2); for the eat pass (flux 30)
  {
    var ionsIn = 0;
    for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); if (charge_of(EP.qCodes, k) != 0) { ionsIn += max(stockP[fo + stock_w(k)], 0); } }
    let cin = f32(ionsIn) / (ATOM_SCALE * areaR2);
    var cout = f32(ionsOut) / (ATOM_SCALE * Ao / (EP.R * EP.R));
    // step T1a: over a covered side the outside is the neighbour's inside (its free ions per R^2), by the side's share of the perimeter
    if (insideOn && covm != 0u) {
      var cn = 0.0;
      var wn = 0.0;
      for (var k = 0u; k < 6u; k++) {
        if (covW[k] <= 0.0) { continue; }
        let j = cell_nbr(c, k);
        var ij = 0;
        for (var jj = 0u; jj < NCELL; jj++) { let q = cell_ch(jj); if (charge_of(EP.qCodes, q) != 0) { ij += max(stockP[j * SW + stock_w(q)], 0); } }
        let rj = cells[j].r;
        cn += covW[k] * lenK[k] * f32(ij) / (ATOM_SCALE * max(3.14159265 * rj * rj / (EP.R * EP.R), 1e-3));
        wn += covW[k] * lenK[k];
      }
      let fw = wn / max(perim, 1e-6);
      cout = (1.0 - fw) * cout + cn / max(perim, 1e-6);
    }
    flux[fo + 30u] = bitcast<i32>(select(0.0, (cin - cout) / max(EP.capR2, 1e-3), eatOn));
    flux[fo + 31u] = bitcast<i32>(cin);
  }
  // ---- step C7, PUMPS: each slot of the genome (Bio.pump: a substance, IN or OUT, a rate) works on all six sides, a sixth of
  // its rate each. A side touching a neighbour that touches it back (both list each other in Cell.nbr) trades with that
  // neighbour's stock; a free side with the dish just outside it (the pixel beyond its middle). Per s a slot moves rate x the
  // source's amount per cell volume (IN from a free side: the concentration outside x the cell's area; from a neighbour or
  // OUT: the stock), an inflow scaled by the room left. Moving a substance DOWN its gradient is free; UP it costs
  // pump_cost per count; moving charge across builds the membrane voltage, whose energy the battery pays too (volt_energy).
  // What the battery (after the crawl) cannot pay is not pumped: everything is scaled down. Only this cell's plan writes its
  // requests (flux 16..29); its eat applies them to itself and its neighbours' eat apply the reverse to theirs (race-free,
  // and both sides read the same numbers, so matter stays exact). From another cell's stock at most pu2.w of it per side
  // and slot per tick, so that 6 sides x 2 slots x (pulled + pushed) never take a stock below zero.
  var pcq = array<i32, 6>(0, 0, 0, 0, 0, 0);      // contact requests per side, both slots packed (+ = into this cell)
  var pgq = array<i32, 6>(0, 0, 0, 0, 0, 0);      // grid requests per side, both slots packed (+ = into this cell)
  var pCostC = 0.0;
  var pCostG = 0.0;
  let puf = pu_flags();
  // step C13, the pump gate: the slots' rates x (1 + g s), s the field A the cell's sides felt (their mean; the step's Cell.felt)
  var gpu = bio_pump(i);   // (step T1b: the rates as expressed)
  if ((fg_bits() & FG_PUMP) != 0u) { gpu = vec4f(gpu.xy, gpu.zw * gate_factor(bio[i].gate.y, cell_felt_mean(c))); }
  let pmax = EP.pu0.w;
  let pr = vec2f(min(max(gpu.z, 0.0), pmax), min(max(gpu.w, 0.0), pmax));
  if ((puf & PUF_ON) != 0u && eatOn && (pr.x > 0.0 || pr.y > 0.0)) {
    let contact = (puf & PUF_CONTACT) != 0u && S.count <= NBR_NONE;
    let concIn = EP.R * EP.R / (ATOM_SCALE * areaPx);          // stock counts -> units per R^2 inside
    let concPx = EP.R * EP.R / (ATOM_SCALE * HP.px * HP.px);   // pixel counts -> units per R^2
    let batS = stockP[fo + BAT];
    let bat0 = f32(batS - clamp(c.pay, 0, max(batS, 0)));
    // the neighbour across each side, if it is in contact (it lists this cell too) and eats this tick
    var jn = array<u32, 6>(NBR_NONE, NBR_NONE, NBR_NONE, NBR_NONE, NBR_NONE, NBR_NONE);
    if (contact) {
      for (var k = 0u; k < 6u; k++) {
        let j = cell_nbr(c, k);
        if (j >= S.count || j == i || nbr_side(c.nbr, j) != k) { continue; }   // (a neighbour counts once: on its first side)
        let fj = cells[j].flags;
        if ((fj & CELL_ALIVE) == 0u || (cell_burst(fj) != 0u && (mbf & MBF_BURST) != 0u)) { continue; }
        if (nbr_side(cells[j].nbr, i) < 6u) { jn[k] = j; }
      }
    }
    var mouth: array<u32, 6>;                                   // the pixel just outside each side's middle
    for (var k = 0u; k < 6u; k++) {
      let e = mbd.edge[k];
      let px = heat_xy(HP, c.pos + mbd.mid[k] + vec2f(e.y, -e.x) / max(length(e), 1e-6) * (0.5 * HP.px));
      mouth[k] = u32(px.y) * HP.hw + u32(px.x);
    }
    var want: array<vec2f, 6>;                                  // contact (x) and grid (y) amounts per side, slot 0
    var want1: array<vec2f, 6>;                                 // ... slot 1
    var lim: array<vec2i, 6>;                                   // the most each slot may move with the neighbour (whole counts)
    var vdq = 0.0;                                              // charge counts the pumps would move in
    for (var s = 0u; s < 2u; s++) {
      let rk = pr[s];
      let code = gpu[s];
      let ch = pump_ch(code);
      let out = pump_out(code);
      if (rk <= 0.0 || (EP.sedMask & (1u << ch)) != 0u) { continue; }
      let z = f32(charge_of(EP.qCodes, ch));
      let ks = rk / 6.0 * EP.dt;
      let Mi = f32(max(stockP[fo + ch], 0));
      let ci = Mi * concIn;
      let gridOk = cur != 0u && (EP.mask & (1u << ch)) != 0u;
      for (var k = 0u; k < 6u; k++) {
        var a = vec2f(0.0);
        let j = jn[k];
        if (j != NBR_NONE) {
          let Mj = f32(max(stockP[j * SW + ch], 0));
          // (whole counts: rounding at random must never take more than the cap from the source, or a stock could go below 0)
          lim[k][s] = i32(floor(EP.pu2.w * select(Mj, Mi, out)));
          let rj = cells[j].r;
          let cj = Mj * EP.R * EP.R / (ATOM_SCALE * 3.14159265 * rj * rj);
          if (out) {
            a.x = -min(ks * Mi, EP.pu2.w * Mi) * clamp(1.0 - cells[j].fill, 0.0, 1.0);
            pCostC += -a.x * pump_cost(ci, cj);
          } else {
            a.x = min(ks * Mj, EP.pu2.w * Mj) * room;
            pCostC += a.x * pump_cost(cj, ci);
          }
          vdq += z * a.x;
        } else if (gridOk) {
          let Mp = f32(max(mg[cur - lw + ch * EP.n + mouth[k]], 0));
          let co = Mp * concPx;
          if (out) {
            a.y = -ks * Mi * (1.0 - covW[k]);   // (step T1a: a covered side does not reach the dish)
            pCostG += -a.y * pump_cost(ci, co);
          } else {
            a.y = min(ks * Mp * areaPx / (HP.px * HP.px), 0.25 * Mp) * room * (1.0 - covW[k]);
            pCostG += a.y * pump_cost(co, ci);
          }
          vdq += z * a.y;
        }
        if (s == 0u) { want[k] = a; } else { want1[k] = a; }
      }
    }
    // what the battery can pay: the gradients' cost and the voltage's work (the energy the moved charge adds to the voltage)
    let cm = EP.pu1.z * c.r / EP.R;
    var vw = 0.0;
    if ((puf & PUF_VOLT) != 0u) {
      let q0 = stockP[fo + VQ];
      vw = max(volt_energy(q0 + i32(round(vdq)), cm) - volt_energy(q0, cm), 0.0);
    }
    let tot = pCostC + pCostG + vw;
    let fpay = select(1.0, clamp(bat0 / max(tot, 1e-6), 0.0, 1.0), tot > bat0);
    pCostC *= fpay;
    pCostG *= fpay;
    for (var k = 0u; k < 6u; k++) {
      let r0 = u01(pcg(rs + k * 0x2c1b3c6du + 0x7a3f1e5bu));
      let r1 = u01(pcg(rs + k * 0x297a2d39u + 0x0b5ad4ecu));
      let a0 = want[k] * fpay;
      let a1 = want1[k] * fpay;
      let c0 = clamp(i32(floor(a0.x + r0)), -lim[k].x, lim[k].x);
      let c1 = clamp(i32(floor(a1.x + r1)), -lim[k].y, lim[k].y);
      let g0 = i32(floor(a0.y + r1));
      let g1 = i32(floor(a1.y + r0));
      pcq[k] = pack2(c0, c1);
      pgq[k] = pack2(g0, g1);
      // step C6d: the charge a pump moves through a side comes in (or leaves) there
      if (dpOn) {
        dq[k] += f32(charge_of(EP.qCodes, pump_ch(gpu.x))) * f32(c0 + g0) + f32(charge_of(EP.qCodes, pump_ch(gpu.y))) * f32(c1 + g1);
      }
    }
  }
  for (var k = 0u; k < 6u; k++) { flux[fo + 16u + k] = pcq[k]; flux[fo + 22u + k] = pgq[k]; }
  flux[fo + 28u] = i32(ceil(pCostC));
  flux[fo + 29u] = i32(ceil(pCostG));
  // ---- step T1a, KIN CHANNELS: for each neighbour in mutual pressed contact with a HIGHER index (the lower works out the pair), on this
  // cell's first side listing it: the conductance (each cell's open level x how far it accepts the other as kin, the smaller), then per
  // channel the share of the way to equal concentrations that kinK x conductance x the shared wall (R) x the molecule's speed x dt moves,
  // an inflow x the receiver's room; whole counts at random, at most kinCap of the source. + = into this cell
  if ((t1f & T1F_KIN) != 0u) {
    let kb = S.count * SW + i * KW;
    var kq: array<i32, 24>;
    for (var w = 0u; w < KW; w++) { kq[w] = 0; }
    let oi = bio_kin_open(i);   // (step T1b: as expressed)
    if (eatOn && (t1f & T1F_NULL) == 0u && oi > 0.0 && covm != 0u) {
      let blind = (t1f & T1F_BLIND) != 0u;
      let capK = clamp(EP.t1[1].x, 0.0, 1.0 / 6.0);
      for (var k = 0u; k < 6u; k++) {
        if ((covm & (1u << k)) == 0u) { continue; }
        let j = cell_nbr(c, k);
        if (j <= i || j >= S.count || nbr_side(c.nbr, j) != k) { continue; }
        if (nbr_side(cells[j].nbr, i) >= 6u) { continue; }   // (it must list this cell too: a contact)
        let oj = bio_kin_open(j);
        if (oj <= 0.0) { continue; }
        let rj = cells[j].r;
        var ai = 1.0;
        var aj = 1.0;
        if (!blind) {
          let mt = kin_match_m(bio_mark(i), bio_mark(j), 0.5 * (c.r + rj) / EP.R);   // (step T1b: the displays as expressed)
          ai = kin_accept(mt, bio[i].kin.y);
          aj = kin_accept(mt, bio[j].kin.y);
        }
        let G = min(oi * ai, oj * aj);
        if (G < 1e-3) { continue; }
        var wl = 0.0;   // the shared wall: this cell's covered sides listing j
        for (var a = 0u; a < 6u; a++) { if (cell_nbr(c, a) == j && (covm & (1u << a)) != 0u) { wl += lenK[a]; } }
        let Aj = 3.14159265 * rj * rj;
        let roomJ = clamp(1.0 - cells[j].fill, 0.0, 1.0);
        let kr = EP.t1[0].w * G * wl / EP.R * EP.dt;
        var nq: array<i32, 8>;
        for (var q = 0u; q < 8u; q++) { nq[q] = 0; }
        for (var q = 0u; q < 7u; q++) {
          let ch = kin_ch(q);
          let Mi = max(stockP[fo + ch], 0);
          let Mj = max(stockP[j * SW + ch], 0);
          if (Mi == 0 && Mj == 0) { continue; }
          let jeq = (f32(Mj) * areaPx - f32(Mi) * Aj) / (areaPx + Aj);
          var x = jeq * min(1.0, kr * ep_f(EP.ratio, ch));
          x *= select(roomJ, room, x > 0.0);
          let n = i32(floor(x + u01(pcg(rs + k * 0x5f356495u + q * 0x2c1b3c6du + 0x1d872b41u))));
          nq[q] = clamp(n, -i32(floor(capK * f32(Mi))), i32(floor(capK * f32(Mj))));
        }
        for (var w = 0u; w < 4u; w++) { kq[4u * k + w] = pack2(nq[2u * w], nq[2u * w + 1u]); }
      }
    }
    for (var w = 0u; w < KW; w++) { flux[kb + w] = kq[w]; }
  }
  // step C6d: the side charges: each side's difference from the even share D (sum 0) gets the through-flow and relaxes
  // (dpRelax per s) toward 0; kept within dpCap x mobile / 6. The even share stays the last net charge / 6 (the eat dispatch
  // puts it on the new one)
  var sq = c.sideQ;
  // step C12b: the soap heads' charge sits on its own side: the mobile part is what the through-flow and the relaxation work on
  if (dpOn) { for (var a = 0u; a < 6u; a++) { sq[a] -= headQ[a]; } }
  if (dpOn) {
    var mean = 0.0;
    for (var a = 0u; a < 6u; a++) { mean += sq[a]; }
    mean /= 6.0;
    var D: array<f32, 6>;
    let kr = min(1.0, EP.dpRelax * EP.dt);
    let cap = EP.dpCap * mob / 6.0;
    var dm = 0.0;
    for (var a = 0u; a < 6u; a++) {
      D[a] = sq[a] - mean;
      D[a] += -D[a] * kr + EP.dpFlow * dq[a] / ATOM_SCALE;
      D[a] = clamp(D[a], -cap, cap);
      dm += D[a] / 6.0;
    }
    for (var a = 0u; a < 6u; a++) { sq[a] = D[a] - dm + mean; }
  } else {
    let e = select(0.0, c.qNet / 6.0, (c.flags & CELL_ALIVE) != 0u && !husk);
    sq = array<f32, 6>(e, e, e, e, e, e);
  }
  // (the heads go back on below, after the lipids' bites)
  // step C6c, BITES: a free reactive atom outside a side bites the chains of its own row (g, t the l part; G, T the L part),
  // at kBite x its concentration there (units per R^2, the pixel just outside the side's middle) x the side's length (R)
  // x the share of that row in the side's weave x exp(-the chain's spark / (theta x temperature)); counts, rounded at
  // random. The biting atom stays free; the bitten linkers go to the dish in the eat dispatch (flux 13, 14)
  var bl = 0;
  var bh = 0;
  var bx = vec2f(0.0);   // step C12c: bites by excited atoms (g*, t*), rounded below
  if (membOn && (mbf & MBF_BITE) != 0u && cur != 0u && (c.flags & CELL_ALIVE) != 0u && !husk) {
    let mbn = membrane(c);
    let tmp = max(f32(hsum) / 9.0 * HP.tempScale, 1e-4);
    let fL = exp(-EP.mb2.z / (EP.mb1.w * tmp));
    let fH = exp(-EP.mb2.w / (EP.mb1.w * tmp));
    let conc = EP.R * EP.R / (ATOM_SCALE * HP.px * HP.px);   // counts in a pixel -> units per R^2
    let mL = (EP.mask & 0x30003u) != 0u;                     // g, t moving (step C12c: or g*, t*)
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
      let x0 = EP.mb0.y * len / EP.R * ATOM_SCALE * EP.dt * conc * (1.0 - covW[k]);   // (step T1a: a covered side is not bitten)
      if (mL && ml[k] > 0) {
        let gx = f32(max(mg[base + EXC0 * EP.n + pi], 0));
        let tx = f32(max(mg[base + (EXC0 + 1u) * EP.n + pi], 0));
        let cl = f32(max(mg[base + pi], 0) + max(mg[base + EP.n + pi], 0)) + gx + tx;
        let x = x0 * cl * fL * f32(ml[k]) / f32(mk);
        let n = min(i32(floor(x + u01(pcg(rs + k * 0x1b873593u + 0x68e31da4u)))), ml[k]);
        if (n > 0) { ml[k] -= n; bl += n; stockP[fo + MB_L0 + k] = ml[k]; bx += f32(n) * vec2f(gx, tx) / max(cl, 1.0); }
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
  // step C12b, BITES ON THE LIPIDS (the same rule, derived from the atoms): a free reactive atom at a side bites the chains of its
  // own row, so each lipid kind by the light linkers (l) and heavy linkers (L) its chain holds: soap and oil (one l, one L) by
  // both rows, a light crust (ll) only by light atoms, a heavy one (LL) only by heavy atoms; x exp(-its chain's spark / (theta x
  // temperature)); x that kind's share of the side's linkers. The WALL is outside: the bilayer is exposed only where no crust
  // covers it (1 - cover), and a fluid bilayer more than a packed one (x 2 / (1 + its stiffness): 1 for pure soap at Tref). A
  // bite pulls the molecule out WHOLE into the dish (soap and oil gather into films and droplets there, crust sits as crust):
  // matter, charge and energy move as they are
  var lb = array<i32, 5>(0, 0, 0, 0, 0);
  var lbB = 0;
  var lbW = 0;
  if (lipOn && (mbf & MBF_BITE) != 0u && cur != 0u && (c.flags & CELL_ALIVE) != 0u && !husk) {
    let mbn = membrane(c);
    let tmp = max(f32(hsum) / 9.0 * HP.tempScale, 1e-4);
    let conc = EP.R * EP.R / (ATOM_SCALE * HP.px * HP.px);
    let mL = (EP.mask & 0x30003u) != 0u;
    let mH = (EP.mask & 24u) != 0u;
    for (var k = 0u; k < 6u; k++) {
      var lam = 0.0;
      for (var q = 0u; q < 5u; q++) { lam += f32(lpm[q][k]) * (lk_of(EP.lp[6], q) + lk_of(EP.lp[7], q)); }
      if (lam <= 0.0) { continue; }
      let e = mbn.edge[k];
      let len = length(e);
      let nrm = vec2f(e.y, -e.x) / max(len, 1e-6);
      let px = heat_xy(HP, c.pos + mbn.mid[k] + nrm * (0.5 * HP.px));
      let pi = u32(px.y) * HP.hw + u32(px.x);
      let base = cur - lw;
      var cl = 0.0;
      var ch = 0.0;
      var gx = 0.0;   // step C12c: the excited light atoms there (part of cl)
      var tx = 0.0;
      if (mL) {
        gx = f32(max(mg[base + EXC0 * EP.n + pi], 0));
        tx = f32(max(mg[base + (EXC0 + 1u) * EP.n + pi], 0));
        cl = f32(max(mg[base + pi], 0) + max(mg[base + EP.n + pi], 0)) + gx + tx;
      }
      if (mH) { ch = f32(max(mg[base + 3u * EP.n + pi], 0) + max(mg[base + 4u * EP.n + pi], 0)); }
      if (cl + ch <= 0.0) { continue; }
      let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
      let cover = clamp(f32(lpm[LK_CL][k] + lpm[LK_CH][k]) / want, 0.0, 1.0);
      var expB = (1.0 - cover) * 2.0 / (1.0 + lip_kb(S, min(f32(lpm[LK_OIL][k]), EP.lp[5].y * S), tmp));
      // step M1 (M1F_BITEBLOCK): the biting atoms are free IONS, and an intact bilayer keeps ions away from its oily core (step C12g's
      // block): they reach the chains only where the side is damaged (its holes' edges), and through the intact share at the bilayer's
      // own ion leak; so the bilayer's exposure x ((1 - its integrity) + integrity x ionPass)
      if ((m1_flags() & M1F_BITEBLOCK) != 0u && blockOn) {
        let ibk = clamp((S + min(f32(lpm[LK_OIL][k]), EP.lp[5].y * S)) / want, 0.0, 1.0);
        expB *= (1.0 - ibk) + ibk * EP.io[0].y;
      }
      let x0 = EP.mb0.y * len / EP.R * ATOM_SCALE * EP.dt * conc / lam * (1.0 - covW[k]);   // (step T1a: a covered side is not bitten)
      for (var q = 0u; q < 5u; q++) {
        let n0 = lpm[q][k];
        if (n0 <= 0 || (EP.mask & (1u << lk_ch(q))) == 0u) { continue; }
        let x = x0 * select(expB, 1.0, q >= LK_CL) * exp(-lk_of(EP.lp[2], q) / (EP.mb1.w * tmp)) * f32(n0) *
                (cl * lk_of(EP.lp[6], q) + ch * lk_of(EP.lp[7], q));
        let n = min(i32(floor(x + u01(pcg(rs + k * 0x2545f491u + q * 0x9e3779b1u + 0x7a3c5b1du)))), n0);
        if (n > 0) {
          lpm[q][k] = n0 - n;
          stockP[fo + lpw(q, k)] = n0 - n;
          lb[q] += n;
          if (q >= LK_CL) { lbW += n; } else { lbB += n; }
          // step C12c: the share of these bites made by excited light atoms
          let lwt = cl * lk_of(EP.lp[6], q);
          bx += f32(n) * lwt / max(lwt + ch * lk_of(EP.lp[7], q), 1e-6) * vec2f(gx, tx) / max(cl, 1.0);
        }
      }
    }
  }
  for (var q = 0u; q < 5u; q++) { flux[fo + 32u + q] = lb[q]; }
  flux[fo + 37u] = lbB;
  flux[fo + 38u] = lbW;
  // step C12c: the excited atoms that bit (they spend their energy on the bite: the eat pass relaxes them, as heat at the cell)
  flux[fo + 42u] = i32(floor(bx.x + u01(pcg(rs + 0x4b1d3a7fu))));
  flux[fo + 43u] = i32(floor(bx.y + u01(pcg(rs + 0x29a8c7e3u))));
  // ... and the side charges get the soap heads back (those still there after the bites; with the dipoles off they stay even)
  if (headsOn && dpOn) {
    for (var k = 0u; k < 6u; k++) { sq[k] += f32(lpm[LK_GP][k] - lpm[LK_TM][k]) / ATOM_SCALE; }
  }
  cells[i].sideQ = sq;
  // smell: the fuels (each weighted by its energy) at the membrane's 6 corners; for a field v = v0 + G . x sampled at a
  // regular hexagon, sum v x = G sum |x|^2 / 2, so G = 2 sum v x / sum |x|^2 (here in energy per R^2 per R)
  var g = vec2f(0.0);
  if (EP.smell != 0u && cur != 0u) {
    let mb = membrane(c);
    // step T1a, the smell for trace: each unit of trace outside weighs as the richest fuel x traceWorth (EP.t1[1].y), x the share of the
    // engines' speed the lack of trace still holds back at the trace inside ((1 - cofactor) / (1 - f0)); nothing while the cofactor is off
    var wTr = 0.0;
    if ((t1f & T1F_SMELL) != 0u && EP.cat.x > 0.0 && (EP.mask & (1u << TRACE_CH)) != 0u) {
      let trIn = f32(max(stockP[fo + TRACE_CH], 0)) / (ATOM_SCALE * areaR2);
      wTr = EP.t1[1].y * (1.0 - cofactor(trIn)) / max(1.0 - EP.cat.y, 1e-3);
    }
    var gr = vec2f(0.0);
    var rr = 0.0;
    for (var a = 0; a < 6; a++) {
      let cp = mb.mid[a] - 0.5 * mb.edge[a];
      let px = heat_xy(HP, c.pos + cp);
      let pi = u32(px.y) * HP.hw + u32(px.x);
      var v = 0.0;
      for (var f = FUEL_CH; f < FUEL_CH + 4u; f++) {
        if ((EP.mask & (1u << f)) != 0u) { v += ep_f(EP.smellW, f) * f32(mg[cur - lw + f * EP.n + pi]); }   // (step C12d: smellW)
      }
      if (wTr > 0.0) { v += wTr * f32(mg[cur - lw + TRACE_CH * EP.n + pi]); }   // (step T1a: the trace)
      if (CARBON_ON != 0u) { v += cb_smell(pi); }   // (step C15b: the ladder's fuel)
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

// step C6d: a substance channel (plain view, its block at base in mg) at a position (CSS px), bilinear between the pixel
// centres, clamped into the grid (counts per pixel)
fn grid_bilinear(base: u32, p: vec2f) -> f32 {
  let gp = p / HP.px - 0.5;
  let b = floor(gp);
  let f = gp - b;
  let hi = vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1);
  let a0 = clamp(vec2i(b), vec2i(0), hi);
  let a1 = clamp(vec2i(b) + 1, vec2i(0), hi);
  let v00 = f32(max(mg[base + u32(a0.y) * HP.hw + u32(a0.x)], 0));
  let v10 = f32(max(mg[base + u32(a0.y) * HP.hw + u32(a1.x)], 0));
  let v01 = f32(max(mg[base + u32(a1.y) * HP.hw + u32(a0.x)], 0));
  let v11 = f32(max(mg[base + u32(a1.y) * HP.hw + u32(a1.x)], 0));
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
    var m: array<i32, 18>;    // by channel (step C12c: 0..12 and the excited 16, 17; 13..15 unused)
    var m0: array<i32, 18>;
    for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); m[k] = atomicLoad(&stock[o + stock_w(k)]); m0[k] = m[k]; }
    let ex16 = i32(CP.ex.y);  // step C12c: the heat counts one excited count holds
    var bat = atomicLoad(&stock[o + BAT]);
    let bat0 = bat;
    let batMax = max(EP.batMax, 1);
    var heat = 0;
    // step C12e: the free t this cell takes in, puts out and makes this tick (counts), and the reaction events saturation costs
    var tIn = 0;
    var tOut = 0;
    var tMade = 0;
    var satW = 0.0;
    var satL = 0.0;

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
    let fo = i * SW;

    // ---- step P1, PREDATORS (src/predators.js): what this tick's engulfing costs (the step's Cell.engPay), from the battery as heat; and
    // DIGESTION: a host's meal is the stock of its GHOST slot (the engulfed cell's, cell_step.wgsl); each tick a share of what is left moves
    // into the host (so it is gone when the digestion's progress is full): atoms and fuels into the stock (as far as the host has room), the
    // meal's membrane weave and pigment as their atoms, its lipids into the host's own membrane (the phagosome's membrane recycled), its
    // battery a share EP.p1[0].z into the host's battery and the rest heat; at the end what found no room spills into the dish. At the catch
    // (ENG_FRESH) a share of the host's own bilayer (or its C6c weave) goes round the meal (wrapping costs membrane; it comes back as the
    // phagosome is digested). Every count leaves one word and arrives in another: the books stay exact
    let ep = clamp(c.engPay, 0, bat);
    if (ep > 0) { bat -= ep; heat += ep; atomicAdd(&wt1[P1C_PAID], ep); }
    if (eng_mode(c.eng) == ENG_DIGEST) {
      let g = eng_partner(c.eng);
      var valid = g < S.count && g != i;
      if (valid) {
        let cg = cells[g];
        valid = (cg.flags & CELL_ALIVE) == 0u && by_mode(cg.engBy) == BY_GHOST && by_partner(cg.engBy) == i;
      }
      if (!valid) {
        cells[i].eng = 0u;
        atomicAdd(&wt1[P1C_VOID], 1);
      } else {
        let go = g * SW;
        cells[g].pos = c.pos;   // (the meal rides inside its host: if the host dies it spills here)
        if ((c.eng & ENG_FRESH) != 0u) {
          let wsh = clamp(EP.p1[0].y * cells[g].r / max(c.r, 1e-3), 0.0, 1.0);
          var wm = 0;
          if ((mb_flags() & MBF_ON) != 0u && (lp_flags() & LPF_ON) != 0u) {
            for (var q = 0u; q < 3u; q++) {
              for (var k = 0u; k < 6u; k++) {
                let w = lpw(q, k);
                let n = i32(floor(f32(atomicLoad(&stock[o + w])) * wsh));
                if (n > 0) { atomicSub(&stock[o + w], n); atomicAdd(&stock[go + w], n); wm += n; }
              }
            }
          } else if ((mb_flags() & MBF_ON) != 0u) {
            for (var k = 0u; k < 12u; k++) {
              let w = MB_L0 + k;
              let n = i32(floor(f32(atomicLoad(&stock[o + w])) * wsh));
              if (n > 0) { atomicSub(&stock[o + w], n); atomicAdd(&stock[go + w], n); wm += n; }
            }
          }
          if (wm > 0) { atomicAdd(&wt1[P1C_WRAPM], wm); }
          cells[i].eng = c.eng & ~ENG_FRESH;
        }
        let fin = eng_progN(c.eng) >= ENG_FULL;
        let dsh = select(clamp(EP.dt / max((1.0 - eng_prog(c.eng)) * EP.p1[0].w + EP.dt, EP.dt), 0.0, 1.0), 1.0, fin);
        var fillA = 3.0 * f32(max(atomicLoad(&stock[o + W_PIG]), 0));
        for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); fillA += f32(max(m[k], 0)) * ep_f(EP.natoms, k); }
        var roomA = max(cap - fillA, 0.0);
        var movedA = 0;
        let rr = pcg(rs + 0x7f4a7c15u);
        for (var j = 0u; j < NCELL; j++) {
          let k = cell_ch(j);
          let w = stock_w(k);
          let mv = atomicLoad(&stock[go + w]);
          if (mv <= 0) { continue; }
          let na = max(ep_f(EP.natoms, k), 1.0);
          let n = min(min(mv, i32(floor(f32(mv) * dsh + u01(pcg(rr + j))))), i32(floor(roomA / na)));
          if (n <= 0) { continue; }
          atomicSub(&stock[go + w], n);
          m[k] += n;
          roomA -= f32(n) * na;
          movedA += n * i32(na);
        }
        for (var k = 0u; k < 12u; k++) {
          let w = MB_L0 + k;
          let mv = atomicLoad(&stock[go + w]);
          if (mv <= 0) { continue; }
          let n = min(min(mv, i32(floor(f32(mv) * dsh + u01(pcg(rr + 40u + k))))), i32(floor(roomA)));
          if (n <= 0) { continue; }
          atomicSub(&stock[go + w], n);
          m[select(MB_CH_H, MB_CH_L, k < 6u)] += n;
          roomA -= f32(n);
          movedA += n;
        }
        let pv = atomicLoad(&stock[go + W_PIG]);
        if (pv > 0) {
          let n = min(min(pv, i32(floor(f32(pv) * dsh + u01(pcg(rr + 99u))))), i32(floor(roomA / 3.0)));
          if (n > 0) { atomicSub(&stock[go + W_PIG], n); m[N1_TRACE] += n; m[MB_CH_L] += 2 * n; roomA -= 3.0 * f32(n); movedA += 3 * n; }
        }
        if (movedA > 0) { atomicAdd(&wt1[P1C_ATOMS], movedA); }
        var movedL = 0;
        for (var w = 0u; w < 30u; w++) {
          let mv = atomicLoad(&stock[go + LP0 + w]);
          if (mv <= 0) { continue; }
          let n = min(mv, i32(floor(f32(mv) * dsh + u01(pcg(rr + 60u + w)))));
          if (n <= 0) { continue; }
          atomicSub(&stock[go + LP0 + w], n);
          atomicAdd(&stock[o + LP0 + w], n);
          movedL += n;
        }
        if (movedL > 0) { atomicAdd(&wt1[P1C_LIPID], movedL); }
        cb_digest(i, g, dsh, pcg(rr + 97u));   // step C15b: and the meal's carbon
        let gbt = atomicLoad(&stock[go + BAT]);
        if (gbt > 0) {
          let n = min(gbt, i32(floor(f32(gbt) * dsh + u01(pcg(rr + 98u)))));
          if (n > 0) {
            atomicSub(&stock[go + BAT], n);
            let toB = clamp(i32(floor(f32(n) * clamp(EP.p1[0].z, 0.0, 1.0))), 0, max(batMax - bat, 0));
            bat += toB;
            heat += n - toB;
            atomicAdd(&wt1[P1C_BAT], toB);
            atomicAdd(&wt1[P1C_HEAT], n - toB);
          }
        }
        if (fin) {
          // the end: what found no room spills into the dish here (its battery's rest and the voltage's energy as heat); the slot is free
          var left = 0;
          for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); left += max(atomicLoad(&stock[go + stock_w(k)]), 0) * i32(ep_f(EP.natoms, k)); }
          if (left > 0) { atomicAdd(&wt1[P1C_SPILL], left); }
          give_back(g, c.pos, cur, slot);
          cells[g].engBy = 0u;
          cells[i].eng = 0u;
          atomicAdd(&wt1[P1C_MEALS], 1);
        }
      }
    }

    // ---- step C7, PUMPS (planned in the plan dispatch, flux 16..29): first what this cell's pumps move with its touching
    // neighbours (its own requests), then what theirs move with it (their requests, reversed: the same numbers, so every
    // count leaves one stock and arrives in the other), then its trade with the dish at its free sides (takes and adds, as
    // the membrane's). It pays the gradients' cost from the battery (as heat), then the work the moved charge does against
    // its membrane VOLTAGE (into the voltage's store, stock word EVW); the voltage leaks back through the membrane (faster
    // when leaky or damaged), and the energy it frees becomes heat or, with PUF_V2B, partly battery charge
    let puf = pu_flags();
    var gpu = bio_pump(i);   // (step T1b: as expressed)
    if ((fg_bits() & FG_PUMP) != 0u) { gpu = vec4f(gpu.xy, gpu.zw * gate_factor(bio[i].gate.y, cell_felt_mean(c))); }   // step C13 (as the plan)
    let pch = vec2u(pump_ch(gpu.x), pump_ch(gpu.y));
    let pz = vec2i(charge_of(EP.qCodes, pch.x), charge_of(EP.qCodes, pch.y));
    var vdq = 0;                                                // charge counts this cell's pumps moved in
    var pmoved = false;
    for (var k = 0u; k < 6u; k++) {
      let w = flux[fo + 16u + k];
      if (w == 0) { continue; }
      let a = unpack2(w);
      for (var s = 0u; s < 2u; s++) {
        if (a[s] == 0) { continue; }
        m[pch[s]] += a[s];
        if (pch[s] == 1u) { if (a[s] > 0) { tIn += a[s]; } else { tOut -= a[s]; } }   // (step C12e)
        vdq += pz[s] * a[s];
        atomicAdd(&wpu[select(PC_COUT, PC_CIN, a[s] > 0) + pump_class(pch[s])], abs(a[s]));
      }
      pmoved = true;
    }
    if ((puf & PUF_CONTACT) != 0u && S.count <= NBR_NONE) {
      for (var k = 0u; k < 6u; k++) {
        let j = cell_nbr(c, k);
        if (j >= S.count || j == i || nbr_side(c.nbr, j) != k) { continue; }   // (once per neighbour, as its plan counts it)
        let q = nbr_side(cells[j].nbr, i);
        if (q >= 6u || (cells[j].flags & CELL_ALIVE) == 0u) { continue; }   // (step C9: not a cell that died this tick)
        let w = flux[j * SW + 16u + q];
        if (w == 0) { continue; }
        let a = unpack2(w);
        let gj = bio[j].pump;
        if (a.x != 0) { m[pump_ch(gj.x)] -= a.x; if (pump_ch(gj.x) == 1u) { tIn += max(-a.x, 0); tOut += max(a.x, 0); } }
        if (a.y != 0) { m[pump_ch(gj.y)] -= a.y; if (pump_ch(gj.y) == 1u) { tIn += max(-a.y, 0); tOut += max(a.y, 0); } }
      }
    }
    // ---- step T1a, KIN CHANNELS (worked out in the plan, flux S.count SW + i KW ..): this cell's own pairs (it has the lower index),
    // then the pairs its lower-index neighbours worked out with it, reversed (the same numbers: every count leaves one stock, arrives in
    // the other)
    if ((t1_flags() & T1F_KIN) != 0u && S.count <= NBR_NONE) {
      let kb = S.count * SW + i * KW;
      var sh = vec3i(0);
      for (var k = 0u; k < 6u; k++) {
        var moved = false;
        for (var w = 0u; w < 4u; w++) {
          let v = flux[kb + 4u * k + w];
          if (v == 0) { continue; }
          let a = unpack2(v);
          for (var h = 0u; h < 2u; h++) {
            let q = 2u * w + h;
            if (q >= 7u || a[h] == 0) { continue; }
            m[kin_ch(q)] += a[h];
            let am = abs(a[h]);
            if (q < 4u) { sh.x += am; } else if (q < 6u) { sh.y += am; } else { sh.z += am; }
            moved = true;
          }
        }
        if (moved) { atomicAdd(&wt1[T1C_PAIRS], 1); }
      }
      if (sh.x != 0) { atomicAdd(&wt1[T1C_FUEL], sh.x); }
      if (sh.y != 0) { atomicAdd(&wt1[T1C_LINK], sh.y); }
      if (sh.z != 0) { atomicAdd(&wt1[T1C_TRACE], sh.z); }
      for (var k = 0u; k < 6u; k++) {
        let j = cell_nbr(c, k);
        if (j >= i || j >= S.count || nbr_side(c.nbr, j) != k) { continue; }
        if ((cells[j].flags & CELL_ALIVE) == 0u) { continue; }
        let q = nbr_side(cells[j].nbr, i);
        if (q >= 6u) { continue; }
        let jb = S.count * SW + j * KW + 4u * q;
        for (var w = 0u; w < 4u; w++) {
          let v = flux[jb + w];
          if (v == 0) { continue; }
          let a = unpack2(v);
          m[kin_ch(2u * w)] -= a.x;
          if (w < 3u) { m[kin_ch(2u * w + 1u)] -= a.y; }
        }
      }
    }
    if (cur != 0u) {
      let mbp = membrane(c);
      for (var k = 0u; k < 6u; k++) {
        let w = flux[fo + 22u + k];
        if (w == 0) { continue; }
        let a = unpack2(w);
        let e = mbp.edge[k];
        let px = heat_xy(HP, c.pos + mbp.mid[k] + vec2f(e.y, -e.x) / max(length(e), 1e-6) * (0.5 * HP.px));
        let pi = u32(px.y) * HP.hw + u32(px.x);
        for (var s = 0u; s < 2u; s++) {
          let ch = pch[s];
          if (a[s] == 0 || (EP.mask & (1u << ch)) == 0u) { continue; }
          if (a[s] > 0) {
            let got = take_hb(cur + ch * EP.n + pi, a[s]);
            m[ch] += got;
            if (ch == 1u) { tIn += got; }
            vdq += pz[s] * got;
            atomicAdd(&wpu[PC_IN + pump_class(ch)], got);
          } else {
            let give = min(-a[s], max(m[ch], 0));
            if (give > 0) {
              atomicAdd(&hb[cur + ch * EP.n + pi], give);
              m[ch] -= give;
              if (ch == 1u) { tOut += give; }
              vdq -= pz[s] * give;
              atomicAdd(&wpu[PC_OUT + pump_class(ch)], give);
            }
          }
        }
        pmoved = true;
      }
    }
    if (pmoved) { atomicAdd(&wpu[PC_BUSY], 1); atomicAdd(&wpu[PC_CHARGE], abs(vdq)); }
    let pcost = clamp(flux[fo + 28u] + flux[fo + 29u], 0, max(bat, 0));
    if (pcost > 0) {
      bat -= pcost;
      heat += pcost;
      atomicAdd(&wpu[PC_GRAD], pcost);
    }
    // the membrane voltage: the moved charge's work against it (paid as far as the battery can), the leak back (rate x the
    // permeability gene / 3 x the membrane's leakiness), and the energy the leak frees (heat, or partly the battery)
    {
      var vq = atomicLoad(&stock[o + VQ]);
      var ev = atomicLoad(&stock[o + EVW]);
      let vq0 = vq;
      let ev0 = ev;
      let cm = EP.pu1.z * c.r / EP.R;
      if ((puf & (PUF_ON | PUF_VOLT)) == (PUF_ON | PUF_VOLT)) {
        let e0 = volt_energy(vq, cm);
        vq = clamp(vq + vdq, -i32(64.0 * ATOM_SCALE), i32(64.0 * ATOM_SCALE));
        let wv = clamp(i32(round(volt_energy(vq, cm) - e0)), 0, max(bat, 0));
        if (wv > 0) { bat -= wv; ev += wv; atomicAdd(&wpu[PC_VWORK], wv); }
        var ig = 0.0;
        for (var k = 0u; k < 6u; k++) { ig += clamp(c.integ[k], 0.0, 1.0) / 6.0; }
        let lk = select(1.0, min(1.0 + EP.mb1.x * (1.0 - ig), EP.mb3.z), (mb_flags() & MBF_ON) != 0u);
        let pg = select(3.0, bio[i].rate.w, (EP.flags & EF_PERMG) != 0u);
        // step C12g: a voltage leaks back as ions cross, so a bilayer that blocks ions holds it: x the mean share of a neutral's rate
        // that the two signs pass (holes, channels, the stretch path)
        var ionK = 1.0;
        if ((io_flags() & IOF_BLOCK) != 0u && (mb_flags() & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u) {
          let chv = ion_chan(bio_chan(i), bio[i].memb.w, (mb_flags() & MBF_SEL) != 0u);
          var sov = 0.0;
          if ((ws_flags() & (WSF_OSM | WSF_STRETCH)) == (WSF_OSM | WSF_STRETCH) && c.osm > 0.0) { sov = EP.ws[1].z * exp(bio[i].lip.w) * c.osm; }
          ionK = (1.0 - ig) + ig * 0.5 * (ion_open(chv, 1) + ion_open(chv, -1)) + sov;
        }
        let kv = min(1.0, EP.pu1.y * pg / 3.0 * lk * ionK * EP.dt);
        vq -= i32(floor(f32(vq) * kv + u01(pcg(rs + 0x5bd1e995u))));
      } else {
        vq = 0;
      }
      // what the voltage holds above the energy of its charge is freed
      let rel = select(ev - i32(ceil(volt_energy(vq, cm))), ev, vq == 0);
      if (rel > 0) {
        ev -= rel;
        var gb = 0;
        if ((puf & PUF_V2B) != 0u && (puf & PUF_VOLT) != 0u) { gb = clamp(i32(floor(f32(rel) * EP.pu1.w)), 0, max(EP.batMax - bat, 0)); }
        bat += gb;
        heat += rel - gb;
        atomicAdd(&wpu[PC_VBAT], gb);
        atomicAdd(&wpu[PC_VHEAT], rel - gb);
      }
      if (vq != vq0) { atomicStore(&stock[o + VQ], vq); }
      if (ev != ev0) { atomicStore(&stock[o + EVW], ev); }
      cells[i].volt = f32(vq) / ATOM_SCALE / max(cm, 1e-4);
    }

    // ---- the membrane: the exchange the plan pass worked out (flux), with the 3 x 3 pixels under the cell. An uptake
    // takes an even share from each pixel (a take: a pixel that has less gives what it has); a release is spread evenly.
    // Only channels that move touch the grid, so a cell in an empty place costs no atomics here.
    if ((EP.flags & EF_EAT) != 0u && cur != 0u) {
      var up = 0;
      var down = 0;
      for (var j = 0u; j < NCELL; j++) {
        let k = cell_ch(j);
        let n = flux[fo + flux_w(k)];
        if (n == 0 || (EP.mask & (1u << k)) == 0u) { continue; }
        let base = cur + k * EP.n;
        let na = i32(ep_f(EP.natoms, k));
        if (n > 0) {
          let part = n / 9;
          var got = 0;
          for (var q = 0; q < 9; q++) { got += take_hb(base + idx[q], select(part, n - 8 * part, q == 4)); }
          m[k] += got;
          up += got * na;
          if (k == 1u || k == EXC0 + 1u) { tIn += got; }
          let zk = charge_of(EP.qCodes, k);   // step C12g: ions in, by sign
          if (zk != 0 && got > 0) { atomicAdd(&wio[select(IC_AIN, IC_CIN, zk > 0)], got); }
        } else {
          let give = min(-n, m[k]);
          if (give > 0) {
            spread9(base, idx, give);
            m[k] -= give;
            down += give * na;
            if (k == 1u || k == EXC0 + 1u) { tOut += give; }
            let zk = charge_of(EP.qCodes, k);   // step C12g: ions out, by sign
            if (zk != 0) { atomicAdd(&wio[select(IC_AOUT, IC_COUT, zk > 0)], give); }
          }
        }
      }
      atomicAdd(&wev[EV_UPTAKE], up);
      atomicAdd(&wev[EV_RELEASE], down);
      let bk = vec2i(flux[fo + 44u], flux[fo + 45u]);   // step C12g: the ions the block held back (the plan's)
      if (bk.x != 0) { atomicAdd(&wio[IC_CBLK], bk.x); }
      if (bk.y != 0) { atomicAdd(&wio[IC_ABLK], bk.y); }
    }

    // ---- step C12, MEMBRANE FUSION (src/oil.js, CP.fuse): the membrane is linker chains, so it is oily: oil (lL) under a
    // cell whose membrane is short of linkers is taken in, each unit opening into one l and one L in the stock (the repair
    // below weaves them in, the rest stays in the stock), the battery paying the chain's energy (uphill) and its spark (as
    // heat). Up to fuse.y x the shortfall per s (the larger of the l and the L the sides still want, less what the stock holds)
    // (step C12b: with the lipid membranes on, the oil and soap join the membrane as themselves instead: below)
    if (CP.fuse.x > 0.0 && (mb_flags() & MBF_ON) != 0u && (lp_flags() & LPF_ON) == 0u && (EP.flags & EF_EAT) != 0u && cur != 0u && (EP.mask & (1u << OIL_CH)) != 0u) {
      let gf = bio_memb(i);
      let wf = max(memb_want(c.r, gf.y), 1.0);
      let mxf = clamp(gf.x, 0.0, 1.0);
      var shL = 0.0;
      var shH = 0.0;
      for (var k = 0u; k < 6u; k++) {
        shL += max((1.0 - mxf) * wf - f32(atomicLoad(&stock[o + MB_L0 + k])), 0.0);
        shH += max(mxf * wf - f32(atomicLoad(&stock[o + MB_H0 + k])), 0.0);
      }
      let per = i32(CP.fuse.z) + i32(CP.fuse.w);
      var nf = i32(floor(CP.fuse.y * EP.dt * bitcast<f32>(flux[fo + 39u]) * max(max(shL - f32(m[MB_CH_L]), shH - f32(m[MB_CH_H])), 0.0) + u01(pcg(rs + 0x6b43a9b5u))));
      nf = min(nf, max(bat, 0) / max(per, 1));
      if (nf > 0) {
        let part = nf / 9;
        var got = 0;
        for (var q = 0; q < 9; q++) { got += take_hb(cur + OIL_CH * EP.n + idx[q], select(part, nf - 8 * part, q == 4)); }
        if (got > 0) {
          m[MB_CH_L] += got;
          m[MB_CH_H] += got;
          bat -= got * per;
          heat += got * i32(CP.fuse.w);
          atomicAdd(&hb[LG_OIL_FUSE + (i & 15u)], got);
        }
      }
    }

    // ---- step C6c, the membrane: the linkers the plan's bites broke out go free into the dish (into the stock while their
    // channel is not moving); then REPAIR: each side short of what the genes ask weaves linkers in from the stock (repK of
    // the shortfall per s, in the genes' mix), each paying its chain's spark from the battery, as heat (the weave holds them
    // at the free linkers' energy); a side holding more than shedAt x it wants lets the extra back into the stock
    let mbf = mb_flags();
    let membOn = (mbf & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u;
    let gm = bio_memb(i);   // (step T1b: as expressed)
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
    // step C12c: the excited atoms that bit a membrane (the weave's or the lipids', planned: flux 42, 43) spend their energy on
    // it: taken from the dish under the cell, put back as their ground atoms, their energy as heat at the cell (uncontrolled)
    if (cur != 0u) {
      for (var j = 0u; j < 2u; j++) {
        let nb = flux[fo + 42u + j];
        let cx = EXC0 + j;
        if (nb <= 0 || (EP.mask & (1u << cx)) == 0u || (EP.mask & (1u << j)) == 0u) { continue; }
        let part = nb / 9;
        var got = 0;
        for (var q = 0; q < 9; q++) { got += take_hb(cur + cx * EP.n + idx[q], select(part, nb - 8 * part, q == 4)); }
        if (got > 0) {
          spread9(cur + j * EP.n, idx, got);
          heat += got * ex16;
          atomicAdd(&wxn[XN_BITE], got);
          atomicAdd(&wxe[XE_LOOSE], got * ex16);
        }
      }
    }
    let want = max(memb_want(c.r, gm.y), 1.0);
    // step C12b: with the lipid membranes on, the old weave holds only the walls' glue (wantW 0: no membrane of its own), woven in
    // the wall's row (Bio.lip.z, the heavy share); the membrane itself is the lipid layer below
    let lipOn = membOn && (lp_flags() & LPF_ON) != 0u;
    let wantW = select(want, 0.0, lipOn);
    // ---- step C10, PATTERNED WALLS: each side's adhesion as the genes ask for it, P = clamp(a0 + s (a1 cos psi + a2 cos 2 psi),
    // 0, 1) (psi the side's middle from the front), x the junction's maturity factor (1 + (cap - 1) x maturity). With the cost on,
    // the adhesion molecules are built from LINKERS in the membrane: a side wants, on top of its membrane, linkPer x adhesion x
    // its rest length of linker (in the membrane's mix), woven by the same repair and paying the same sparks
    let wlf = bitcast<u32>(EP.wl0.x);
    let wallOn = (wlf & WL_ON) != 0u;
    let wCost = wallOn && (wlf & WL_COST) != 0u;
    var aReq = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    var aPay = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);    // step C11: the part of it above the free base glue (what costs)
    var wX = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);      // the extra linker counts each side wants for its adhesion
    var wCf = 1.0;                                             // step G0: the cost per unit of glue above 1 (x a0)
    if (wallOn) {
      let mbw = membrane(c);
      let uf = vec2f(cos(c.front), sin(c.front));
      let gw = bio[i].wall;
      // (step T1b: the glue as expressed; step G0: up to the log scale's top, GLUE_HI, and under the neutral control the founder's value)
      let g0 = bitcast<u32>(EP.wl1.w);
      let a0 = clamp(glue_gene(bio[i], g0) * gof(i, GRN_O_GLUE), 0.0, glue_top(g0));
      // step G0: glue above today's ceiling of 1 costs MORE PER UNIT, x a0: the adhesion molecules pack in layers on layers, each layer as
      // costly as the first, so a side's linker want and upkeep grow as a0 x the glue it holds (a0 = 2: 4 x the cost of a0 = 1, for 2 x the
      // hold; a0 = 4: 16 x); up to 1, as before
      wCf = select(1.0, max(1.0, a0), (g0 & G0_COST) != 0u);
      // step C13, the glue gate: each side's pattern x (1 + g s_k), s_k what that side felt of field A (the step's Cell.felt)
      let glueG = (fg_bits() & FG_GLUE) != 0u;
      for (var k = 0u; k < 6u; k++) {
        let cs = dot(normalize(mbw.mid[k] + vec2f(1e-6, 0.0)), uf);
        var p = clamp(a0 + EP.wl0.y * (gw.x * cs + gw.y * (2.0 * cs * cs - 1.0)), 0.0, max(1.0, a0));   // (step G0: the pattern's top)
        if (glueG) { p *= gate_factor(bio[i].gate.x, cell_felt(c, k)); }
        if ((g0 & G0_TEAR) != 0u && jn_torn(c.kind, k)) { p = 0.0; }   // step G0: a torn side holds (and asks, and pays for) nothing
        aReq[k] = min(p * (1.0 + EP.wl0.z * wall_mature(c.mature, k)), WALL_AMAX);
        aPay[k] = select(aReq[k], max(aReq[k] - EP.wl1.y, 0.0), wCost);
        if (wCost && membOn) { wX[k] = memb_want(c.r, EP.wl0.w * aPay[k] * wCf); }
      }
    }
    if (membOn) {
      let mix = clamp(select(gm.x, bio[i].lip.z, lipOn), 0.0, 1.0);
      var wl: array<f32, 6>;
      var wh: array<f32, 6>;
      var nl: array<i32, 6>;
      var nh: array<i32, 6>;
      var tl = 0;
      var th = 0;
      let kr = EP.mb0.z * EP.dt;
      for (var k = 0u; k < 6u; k++) {
        wl[k] = (1.0 - mix) * (wantW + wX[k]);
        wh[k] = mix * (wantW + wX[k]);
        nl[k] = max(i32(floor(kr * max(wl[k] - f32(sl[k]), 0.0) + u01(pcg(rs + k * 0x7feb352du + 0x1d8e4e27u)))), 0);
        nh[k] = max(i32(floor(kr * max(wh[k] - f32(sh[k]), 0.0) + u01(pcg(rs + k * 0x846ca68bu + 0x5a3b9b5du)))), 0);
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
        let xl = f32(sl[k]) - EP.mb3.x * wl[k] - 1.0;
        if (xl > 0.0) { let a = min(i32(ceil(ks * xl)), sl[k]); sl[k] -= a; m[MB_CH_L] += a; shed += a; }
        let xh = f32(sh[k]) - EP.mb3.x * wh[k] - 1.0;
        if (xh > 0.0) { let a = min(i32(ceil(ks * xh)), sh[k]); sh[k] -= a; m[MB_CH_H] += a; shed += a; }
      }
      atomicAdd(&wmb[MB_SHED - 16u], shed);
    }
    for (var k = 0u; k < 6u; k++) {
      if (sl[k] != sl0[k]) { atomicStore(&stock[o + MB_L0 + k], sl[k]); }
      if (sh[k] != sh0[k]) { atomicStore(&stock[o + MB_H0 + k], sh[k]); }
    }
    // ---- step C10: what each side's adhesion really is. With the cost on: as far as its extra linkers are there (what the
    // side holds beyond its membrane's want, over what its adhesion wants; the membrane itself fills first), and the battery
    // pays an UPKEEP for the glue it holds, upkeep x adhesion x the side's length (R) per s, as heat; what it cannot pay, it
    // cannot hold (every side x the share paid). Without the membrane chemistry there is no material to count (only the
    // upkeep). Off: no cost, the sides hold what the pattern and the maturity ask.
    // Step C11: the cost is charged only for what a side asks ABOVE the free base glue (wl1.y): the base is held at no cost, as
    // every side's adhesion was before step C10, so a colony short of linkers still packs; a sticky side's extra is paid
    if (wallOn) {
      var av = array<f32, 6>(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
      var linkC = 0.0;
      var up = 0.0;
      let sideR = EP.mb0.w * c.r / EP.R;
      for (var k = 0u; k < 6u; k++) {
        if (wCost && membOn && wX[k] >= 1.0) {
          let extra = max(f32(sl[k] + sh[k]) - wantW, 0.0);
          av[k] = clamp(extra / wX[k], 0.0, 1.0);
          linkC += min(extra, wX[k]);
        }
        if (wCost) { up += EP.wl1.x * aPay[k] * wCf * av[k] * sideR; }
      }
      var pf = 1.0;
      var pay = 0;
      if (wCost && up > 0.0) {
        let owe = i32(floor(up + u01(pcg(rs + 0x2f6b9e1du))));   // (rounded at random: on average exactly the upkeep)
        pay = clamp(owe, 0, max(bat, 0));
        if (pay > 0) { bat -= pay; heat += pay; }
        if (pay < owe) { pf = clamp(f32(pay) / up, 0.0, 1.0); }
      }
      var e = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      for (var k = 0u; k < 6u; k++) { e[k] = wall_enc(aReq[k] - aPay[k] + aPay[k] * av[k] * pf); }   // (step G0: the log code)
      cells[i].wadh = array<u32, 2>(pack4x8unorm(vec4f(e[0], e[1], e[2], e[3])), pack4x8unorm(vec4f(e[4], e[5], 0.0, 0.0)));
      cells[i].wlink = u32(round(linkC));
      cells[i].wpay = u32(pay);
    }

    // ---- step C12b, LIPID MEMBRANES (src/lipids.js). Each side's bilayer is SOAP (glL +, tlL -) with OIL (lL) between its tails,
    // and outside it a WALL of crust (ll, LL). What a side wants: the thickness gene x its rest length of bilayer molecules, of which
    // the oil share gene (memb.x: oil per soap, 0..1) is oil and the rest soap; and the wall gene (lip.x) x as much again of crust,
    // in the wall's row (lip.z: the heavy share). In this order:
    //   bitten  the molecules the plan's bites pulled out go into the dish whole (flux 32..36)
    //   fusion  (the C12 switch) a side short of soap or oil takes it from the dish under the cell, as it is: soap of either head
    //           (the gene's head first) and oil join the bilayer for free (self-assembly; no bond changes)
    //   builder what is still short is MADE from the stock's atoms: soap = a head (g or t, by the head gene; the other if short) +
    //           l + L, oil = l + L, crust = l + l or L + L; each molecule pays its bonds' sparks from the battery and releases its
    //           bonds' energy, both as heat at the cell (the table's numbers: soap 0.625 + 0.25, oil 0.375 + 0.75, ll 0.25 + 0.5,
    //           LL 0.5 + 1). The bilayer rebuilds at repK x 2 / (1 + its stiffness) (a fluid bilayer reseals faster), the wall at repK
    //   crack   a WALL is a crystal: rigid and brittle. Where the outline is jolted (a corner's speed over its wobble's angular
    //           frequency, omega0 x sqrt(the side's stiffness): the swing it is in, as a share of r, above crackAt) the crust of its
    //           two sides breaks off (lp[0].w of it per tick) into the dish as crust. Slow packing does not crack it; a shove does
    //   shed    a side holding more than shedAt x what it wants (the oil: also more than its soap holds) lets the extra into the
    //           dish whole; with the lipid membranes off every lipid is shed so (the C6c weave takes over)
    //   then each side's integrity (the bilayer's), its STIFFNESS (the bilayer's lip_kb x (soft + (1 - soft) x integrity) x
    //   sqrt(thickness / tRef) x the stiffness gene, then the wall's cover takes it toward LIP_KMAX) and the look into Cell.lip
    var lpm: array<array<i32, 6>, 5>;
    for (var q = 0u; q < 5u; q++) { for (var k = 0u; k < 6u; k++) { lpm[q][k] = atomicLoad(&stock[o + lpw(q, k)]); } }
    let lpm0 = lpm;
    var heads0 = 0;
    for (var k = 0u; k < 6u; k++) { heads0 += lpm[LK_GP][k] - lpm[LK_TM][k]; }
    for (var q = 0u; q < 5u; q++) {
      let n = flux[fo + 32u + q];
      if (n > 0) { spread9(cur + lk_ch(q) * EP.n, idx, n); }   // (the plan bites only kinds whose channel is moving)
    }
    atomicAdd(&wlp[LC_BITE_B], flux[fo + 37u]);
    atomicAdd(&wlp[LC_BITE_W], flux[fo + 38u]);
    atomicAdd(&wm1[M1C_BITE_S], flux[fo + 32u] + flux[fo + 33u]);   // (step M1)
    atomicAdd(&wm1[M1C_BITE_O], flux[fo + 34u]);
    let tmpL = max(bitcast<f32>(flux[fo + 15u]), 1e-4);
    var gl = bio[i].lip;
    gl.x *= gof(i, GRN_O_WALL);   // (step T1b: the wall wanted as expressed)
    let oilShare = clamp(gm.x, 0.0, 1.0);
    let wS = select(0.0, want / (1.0 + oilShare), lipOn);                 // soap a side wants (molecules)
    let wO = select(0.0, want * oilShare / (1.0 + oilShare), lipOn);      // oil
    let wW = select(0.0, want * clamp(gl.x, 0.0, 1.0), lipOn);            // crust (a full wall: as much as the bilayer)
    let wWh = wW * clamp(gl.z, 0.0, 1.0);                                  // ... of it heavy (LL)
    let wWl = wW - wWh;                                                    // ... light (ll)
    let pG = clamp(0.5 + 0.5 * gl.y, 0.0, 1.0);                            // the head gene: the share of + heads (glL)
    let m1Heads = (m1_flags() & M1F_OILSOAP) != 0u && m[0] + m[1] > 0;     // step M1: heads in the stock (oil may wait for one)
    if (lipOn && cur != 0u) {
      // fusion: the soap and oil under the cell join the bilayer as they are (the C12 switch "membrane fusion")
      if (CP.fuse.x > 0.0) {
        var shS = 0.0;
        var shO = 0.0;
        for (var k = 0u; k < 6u; k++) {
          let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
          shS += max(wS - S, 0.0);
          shO += max(min(wO, EP.lp[5].y * max(S, wS)) - f32(lpm[LK_OIL][k]), 0.0);
        }
        let kf = EP.lp[5].x * EP.dt * bitcast<f32>(flux[fo + 39u]);   // (step T1a: through the free sides only)
        var nS = i32(floor(kf * shS + u01(pcg(rs + 0x4f1bbcdcu))));
        let nS0 = nS;
        // soap: the head the gene prefers first, then the other
        let first = select(LK_TM, LK_GP, pG >= 0.5);
        var gotS = array<i32, 2>(0, 0);   // [0] glL, [1] tlL
        for (var pp = 0u; pp < 2u; pp++) {
          let q = select(LK_GP + LK_TM - first, first, pp == 0u);
          let ch = lk_ch(q);
          if (nS <= 0 || (EP.mask & (1u << ch)) == 0u) { continue; }
          let part = nS / 9;
          var got = 0;
          for (var z = 0; z < 9; z++) { got += take_hb(cur + ch * EP.n + idx[z], select(part, nS - 8 * part, z == 4)); }
          gotS[q] += got;
          nS -= got;
        }
        // the oil: what the soap's tails take (as step C12b) and, step M1 with heads in the stock, the soap shortfall the dish's soap
        // did not meet (oil + a head make soap in the builder below)
        var shO2 = shO;
        let oilSoap = m1Heads;
        if (oilSoap) { shO2 += max(shS - f32(nS0 - nS), 0.0); }
        let nO = i32(floor(kf * shO2 + u01(pcg(rs + 0x2b5f8a61u))));
        atomicAdd(&wm1[M1C_FUSE_S], nS0 - nS);
        var gotO = 0;
        if (nO > 0 && (EP.mask & (1u << OIL_CH)) != 0u) {
          let part = nO / 9;
          for (var z = 0; z < 9; z++) { gotO += take_hb(cur + OIL_CH * EP.n + idx[z], select(part, nO - 8 * part, z == 4)); }
        }
        atomicAdd(&wlp[LC_FUSED], gotS[0] + gotS[1] + gotO);
        atomicAdd(&wm1[M1C_FUSE_O], gotO);
        // into the sides, each up to its shortfall from a random first side round (any rest to the last side)
        let k0 = pcg(rs + 0x61c88647u) % 6u;
        for (var j = 0u; j < 6u; j++) {
          let k = (k0 + j) % 6u;
          let S = lpm[LK_GP][k] + lpm[LK_TM][k];
          var need = i32(ceil(max(wS - f32(S), 0.0)));
          if (j == 5u) { need = gotS[0] + gotS[1]; }
          let a = min(need, gotS[0]);
          lpm[LK_GP][k] += a; gotS[0] -= a; need -= a;
          let b2 = min(need, gotS[1]);
          lpm[LK_TM][k] += b2; gotS[1] -= b2;
          var needO = i32(ceil(max(wO - f32(lpm[LK_OIL][k]), 0.0)));
          if (oilSoap) { needO = i32(ceil(max(wO + max(wS - f32(lpm[LK_GP][k] + lpm[LK_TM][k]), 0.0) - f32(lpm[LK_OIL][k]), 0.0))); }   // (step M1)
          if (j == 5u) { needO = gotO; }
          let c2 = min(needO, gotO);
          lpm[LK_OIL][k] += c2; gotO -= c2;
        }
      }
      // ---- the supply fix (2026-11-16), CELLS GRAZE CRUST (LPF_GRAZE): the crust (ll, LL) lying in the dish under the cell is
      // taken in, as fusion takes soap and oil (lp[5].x of the shortfall per s): (a) a wall short of crust takes it whole
      // (self-assembly: no bond changes, nothing paid); (b) for a bilayer short of linkers (each soap and oil molecule needs one l
      // and one L) the rest is CRACKED back into linkers in the stock by the table's reverse reaction, uphill: the battery pays the
      // chain's bond energy (into the linkers' chemical energy) and its spark (as heat). Grazed crust the battery cannot crack
      // waits in the stock as crust and is expelled with the sediment below (crust never stays in a stock)
      if ((lp_flags() & LPF_GRAZE) != 0u) {
        let cl = i32(EP.lp[3].z + EP.lp[4].z);                // cracking one ll: its spark + its bond energy (0.25 + 0.5)
        let ch2 = i32(EP.lp[3].w + EP.lp[4].w);               // ... one LL (0.5 + 1)
        var shB = 0.0;                                        // bilayer molecules short (soap and oil)
        var shW = vec2f(0.0);                                 // wall crust short (ll, LL)
        for (var k = 0u; k < 6u; k++) {
          let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
          shB += max(wS - S, 0.0) + max(min(wO, EP.lp[5].y * max(S, wS)) - f32(lpm[LK_OIL][k]), 0.0);
          shW.x += max(wWl - f32(lpm[LK_CL][k]), 0.0);
          shW.y += max(wWh - f32(lpm[LK_CH][k]), 0.0);
        }
        let kg = EP.lp[5].x * EP.dt * bitcast<f32>(flux[fo + 39u]);   // (step T1a: through the free sides only)
        let needl = max(shB - f32(max(m[MB_CH_L], 0)), 0.0);  // linkers the stock lacks for that bilayer
        let needL = max(shB - f32(max(m[MB_CH_H], 0)), 0.0);
        var got = vec2i(0);
        var forW = vec2i(0);                                  // of it, asked for the wall (the rest for cracking)
        for (var w = 0u; w < 2u; w++) {
          let ch = 10u + w;                                   // ll, LL (SUBSTANCES order; src/lipids.js checks)
          let hw = pcg(rs + w * 0x2c1b3c6du + 0x297a2d39u);
          let aw = i32(floor(kg * shW[w] + u01(hw)));
          let want = aw + i32(floor(kg * 0.5 * select(needl, needL, w == 1u) + u01(pcg(hw))));
          if (want <= 0 || (EP.mask & (1u << ch)) == 0u) { continue; }
          let part = want / 9;
          for (var z = 0; z < 9; z++) { got[w] += take_hb(cur + ch * EP.n + idx[z], select(part, want - 8 * part, z == 4)); }
          forW[w] = i32(floor(f32(got[w]) * f32(aw) / f32(want)));   // a short take is shared in proportion
        }
        if (got.x + got.y > 0) {
          atomicAdd(&wlp[LC_GRAZE_L], got.x);
          atomicAdd(&wlp[LC_GRAZE_H], got.y);
          // (a) the wall, whole, each side as it is short (from a random first side round)
          var dw = vec2i(0);
          let k0 = pcg(rs + 0x3b9aca07u) % 6u;
          for (var j = 0u; j < 6u; j++) {
            let k = (k0 + j) % 6u;
            let a = min(i32(ceil(max(wWl - f32(lpm[LK_CL][k]), 0.0))), forW.x - dw.x);
            lpm[LK_CL][k] += a; dw.x += a;
            let b2 = min(i32(ceil(max(wWh - f32(lpm[LK_CH][k]), 0.0))), forW.y - dw.y);
            lpm[LK_CH][k] += b2; dw.y += b2;
          }
          atomicAdd(&wlp[LC_GRAZE_W], dw.x + dw.y);
          // (b) the rest cracked into linkers in the stock (uphill, from the battery: the heavy chains first, L is the scarcer)
          var nh = clamp(max(bat, 0) / max(ch2, 1), 0, got.y - dw.y);
          var nl = clamp((max(bat, 0) - nh * ch2) / max(cl, 1), 0, got.x - dw.x);
          // step C12e, SATURATION of the cracking (uphill, paid by the battery: the drive is its spark): Q = linkers^2 / crust
          if ((ws_flags() & WSF_SAT) != 0u) {
            let lc = log(max(cap, 1.0));
            let fh = sat_f(2.0 * lnc(m[MB_CH_H]) - lnc(got.y - dw.y), 1.0, lc, EP.lp[3].w / 16.0, tmpL);
            let fl = sat_f(2.0 * lnc(m[MB_CH_L]) - lnc(got.x - dw.x), 1.0, lc, EP.lp[3].z / 16.0, tmpL);
            let nh1 = i32(floor(f32(nh) * fh));
            let nl1 = i32(floor(f32(nl) * fl));
            satW += f32(nh + nl);
            satL += f32(nh - nh1 + nl - nl1);
            nh = nh1;
            nl = nl1;
          }
          m[MB_CH_L] += 2 * nl;
          m[MB_CH_H] += 2 * nh;
          let cost = nl * cl + nh * ch2;
          bat -= cost;
          heat += nl * i32(EP.lp[3].z) + nh * i32(EP.lp[3].w);   // the sparks; the bond energy is now the linkers'
          atomicAdd(&wlp[LC_GRAZE_CL], nl);
          atomicAdd(&wlp[LC_GRAZE_CH], nh);
          atomicAdd(&wlp[LC_GRAZE_PAID], cost);
          m[10] += got.x - dw.x - nl;                         // (expelled below)
          m[11] += got.y - dw.y - nh;
        }
      }
      // ---- step M1, HEAD ON OIL (M1F_OILSOAP): a side short of soap whose oil is more than its soap's tails take puts a head from the
      // stock on that oil, at the bilayer's reseal rate (below), at most as much as keeps the oil within the tails of the soap it makes
      // (x <= (oil - cap soap) / (1 + cap)); the head the gene prefers first. The battery pays the head bond's spark and, if the head bond is
      // uphill (the old table), the rise; the spark and any release are heat (the table's own numbers: soap's build minus oil's)
      if ((m1_flags() & M1F_OILSOAP) != 0u) {
        let spHd = max(i32(EP.lp[3].x) - i32(EP.lp[3].y), 0);
        let dHd = vec2i(i32(EP.lp[4].x) - i32(EP.lp[4].y), i32(EP.lp[8].y) - i32(EP.lp[4].y));   // heat counts released (g, t head; < 0 uphill)
        let capO = EP.lp[5].y;
        var nHo = 0;
        for (var k = 0u; k < 6u; k++) {
          let S = lpm[LK_GP][k] + lpm[LK_TM][k];
          let O = lpm[LK_OIL][k];
          let xs = max(wS - f32(S), 0.0);
          let xo = max((f32(O) - capO * f32(S)) / (1.0 + capO), 0.0);
          let x = min(xs, xo);
          if (x <= 0.0) { continue; }
          let kb = EP.mb0.z * EP.dt * 2.0 / (1.0 + lip_kb(f32(S), min(f32(O), capO * f32(S)), tmpL));
          var n = min(i32(floor(kb * x + u01(pcg(rs + k * 0x6c8e9cf5u + 0x1b56c4e9u)))), i32(floor(xo)));
          if (n <= 0) { continue; }
          // heads: the gene's share of g first
          var g1 = min(i32(floor(f32(n) * pG + u01(pcg(rs + k * 0x3c6ef372u + 0x5bd1e995u)))), max(m[0], 0));
          var t1 = min(n - g1, max(m[1], 0));
          if (g1 + t1 < n) { g1 = min(n - t1, max(m[0], 0)); }
          // the battery: the spark per event, and the rise if uphill
          let costG = spHd + max(-dHd.x, 0);
          let costT = spHd + max(-dHd.y, 0);
          let can = max(bat, 0);
          if (g1 * costG + t1 * costT > can) {
            let q = f32(can) / f32(max(g1 * costG + t1 * costT, 1));
            g1 = i32(floor(f32(g1) * q)); t1 = i32(floor(f32(t1) * q));
          }
          if (g1 + t1 <= 0) { continue; }
          lpm[LK_OIL][k] -= g1 + t1;
          lpm[LK_GP][k] += g1; lpm[LK_TM][k] += t1;
          m[0] -= g1; m[1] -= t1;
          let paid = g1 * costG + t1 * costT;
          bat -= paid;
          heat += g1 * (spHd + max(dHd.x, 0)) + t1 * (spHd + max(dHd.y, 0));
          nHo += g1 + t1;
        }
        atomicAdd(&wm1[M1C_HEADON], nHo);
      }
      // the builder: what is still short, made from the stock's atoms
      let kr = EP.mb0.z * EP.dt;
      var rS: array<i32, 6>;
      var rO: array<i32, 6>;
      var rWl: array<i32, 6>;
      var rWh: array<i32, 6>;
      var tS = 0;
      var tO = 0;
      var tWl = 0;
      var tWh = 0;
      for (var k = 0u; k < 6u; k++) {
        let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
        let Oe = min(f32(lpm[LK_OIL][k]), EP.lp[5].y * S);
        let kb = kr * 2.0 / (1.0 + lip_kb(S, Oe, tmpL));
        let hs = pcg(rs + k * 0x7feb352du + 0x3c6ef372u);
        rS[k] = max(i32(floor(kb * max(wS - S, 0.0) + u01(hs))), 0);
        rO[k] = max(i32(floor(kb * max(min(wO, EP.lp[5].y * max(S, wS)) - f32(lpm[LK_OIL][k]), 0.0) + u01(pcg(hs)))), 0);
        rWl[k] = max(i32(floor(kr * max(wWl - f32(lpm[LK_CL][k]), 0.0) + u01(pcg(hs + 1u)))), 0);
        rWh[k] = max(i32(floor(kr * max(wWh - f32(lpm[LK_CH][k]), 0.0) + u01(pcg(hs + 2u)))), 0);
        tS += rS[k]; tO += rO[k]; tWl += rWl[k]; tWh += rWh[k];
      }
      let spS = i32(EP.lp[3].x);
      let spO = i32(EP.lp[3].y);
      let spL = i32(EP.lp[3].z);
      let spH = i32(EP.lp[3].w);
      var paid = 0;
      var made = 0;
      // soap first (the bilayer itself): heads, l, L and the sparks
      if (tS > 0) {
        let can = min(min(m[0] + m[1], min(m[MB_CH_L], m[MB_CH_H])), max(bat, 0) / max(spS, 1));
        let f = min(1.0, f32(max(can, 0)) / f32(tS));
        var remG = max(m[0], 0);
        var remT = max(m[1], 0);
        var nG = 0;
        var nT = 0;
        for (var k = 0u; k < 6u; k++) {
          let sk = i32(floor(f32(rS[k]) * f));
          if (sk <= 0) { continue; }
          var g1 = min(min(i32(floor(f32(sk) * pG + u01(pcg(rs + k * 0x1b873593u + 0x0d1f5ab3u)))), sk), remG);
          var t1 = sk - g1;
          if (t1 > remT) { t1 = remT; g1 = min(sk - t1, remG); }
          remG -= g1; remT -= t1;
          lpm[LK_GP][k] += g1; lpm[LK_TM][k] += t1;
          nG += g1; nT += t1;
        }
        let ns = nG + nT;
        // step M1: what the builder could not make, by its first limit (heads, l, L, the battery)
        if (ns < tS) {
          let lims = vec4i(m[0] + m[1], m[MB_CH_L], m[MB_CH_H], max(bat, 0) / max(spS, 1));
          let lo = min(min(lims.x, lims.y), min(lims.z, lims.w));
          let q = select(select(select(M1C_SH_BAT, M1C_SH_LL, lims.z == lo), M1C_SH_L, lims.y == lo), M1C_SH_HEAD, lims.x == lo);
          atomicAdd(&wm1[q], tS - ns);
        }
        atomicAdd(&wm1[M1C_MADE_S], ns);
        m[0] -= nG; m[1] -= nT; m[MB_CH_L] -= ns; m[MB_CH_H] -= ns;
        bat -= ns * spS; paid += ns * spS; heat += ns * spS + nG * i32(EP.lp[4].x) + nT * i32(EP.lp[8].y);   // (step C12d: each soap its own)
        atomicAdd(&wlp[LC_SOAP], ns);
      }
      // then the oil between the tails
      if (tO > 0) {
        let can = min(min(m[MB_CH_L], m[MB_CH_H]), max(bat, 0) / max(spO, 1));
        let f = min(1.0, f32(max(can, 0)) / f32(tO));
        var no = 0;
        for (var k = 0u; k < 6u; k++) { let a = i32(floor(f32(rO[k]) * f)); lpm[LK_OIL][k] += a; no += a; }
        m[MB_CH_L] -= no; m[MB_CH_H] -= no;
        atomicAdd(&wm1[M1C_MADE_O], no);   // (step M1)
        bat -= no * spO; paid += no * spO; heat += no * (spO + i32(EP.lp[4].y));
        atomicAdd(&wlp[LC_OIL], no);
      }
      // then the wall
      if (tWl > 0) {
        let can = min(m[MB_CH_L] / 2, max(bat, 0) / max(spL, 1));
        let f = min(1.0, f32(max(can, 0)) / f32(tWl));
        var nw = 0;
        for (var k = 0u; k < 6u; k++) { let a = i32(floor(f32(rWl[k]) * f)); lpm[LK_CL][k] += a; nw += a; }
        m[MB_CH_L] -= 2 * nw;
        bat -= nw * spL; paid += nw * spL; heat += nw * (spL + i32(EP.lp[4].z));
        made += nw;
      }
      if (tWh > 0) {
        let can = min(m[MB_CH_H] / 2, max(bat, 0) / max(spH, 1));
        let f = min(1.0, f32(max(can, 0)) / f32(tWh));
        var nw = 0;
        for (var k = 0u; k < 6u; k++) { let a = i32(floor(f32(rWh[k]) * f)); lpm[LK_CH][k] += a; nw += a; }
        m[MB_CH_H] -= 2 * nw;
        bat -= nw * spH; paid += nw * spH; heat += nw * (spH + i32(EP.lp[4].w));
        made += nw;
      }
      atomicAdd(&wlp[LC_WALL], made);
      atomicAdd(&wmb[MB_SPARK - 16u], paid);
      // a jolted wall cracks (a crystal does not bend): the crust of the sides at a corner swinging further than crackAt x r
      if ((lp_flags() & LPF_CRACK) != 0u && (c.flags & CELL_HEX) != 0u) {
        var crk = 0;
        for (var k = 0u; k < 6u; k++) {
          let w0 = lpm[LK_CL][k] + lpm[LK_CH][k];
          if (w0 <= 0) { continue; }
          let om = EP.lp[8].x * sqrt(max(LIP_KMAX * unpack4x8unorm(c.lip[k]).x, 0.25));
          let dev = max(abs(c.radV[k]), abs(c.radV[(k + 1u) % 6u])) / max(om * c.r, 1e-3);
          if (dev <= EP.lp[0].z) { continue; }
          for (var q = LK_CL; q <= LK_CH; q++) {
            let n0 = lpm[q][k];
            if (n0 <= 0 || (EP.mask & (1u << lk_ch(q))) == 0u) { continue; }
            let a = min(i32(ceil(f32(n0) * EP.lp[0].w)), n0);
            lpm[q][k] -= a;
            spread9(cur + lk_ch(q) * EP.n, idx, a);
            crk += a;
          }
        }
        atomicAdd(&wlp[LC_CRACK], crk);
      }
    }
    // shed: what a side holds beyond shedAt x its want (oil: also beyond what its soap holds) goes into the dish whole; with the lipid
    // membranes off the wants are 0, so every lipid is shed (at shedK per s); with the membrane chemistry off nothing changes
    if (membOn && cur != 0u) {
      let ks = EP.mb3.y * EP.dt;
      var shd = 0;
      for (var k = 0u; k < 6u; k++) {
        let S = lpm[LK_GP][k] + lpm[LK_TM][k];
        // the soap's limit, for both heads together (the head in surplus over the gene's share goes first)
        let xs = f32(S) - EP.mb3.x * wS - 1.0;
        let qs = select(LK_TM, LK_GP, f32(lpm[LK_GP][k]) > pG * f32(S));
        for (var q = 0u; q < 5u; q++) {
          var lim = EP.mb3.x * select(wWh, wWl, q == LK_CL);
          if (q == LK_OIL) {
            lim = min(EP.mb3.x * wO, EP.lp[5].y * f32(S));
            // step M1: with heads in the stock, oil for the soap still short waits for its head (the builder above)
            // (and the oil for the tails of the soap the side wants, as fusion counts it: no fused-then-shed churn while soap is short)
            if (m1Heads) {
              lim = min(EP.mb3.x * wO, EP.lp[5].y * max(f32(S), wS)) + max(wS - f32(S), 0.0);
            }
          }
          var x = f32(lpm[q][k]) - lim - 1.0;
          if (q <= LK_TM) { x = select(-1.0, xs, q == qs); }
          if (x <= 0.0 || lpm[q][k] <= 0 || (EP.mask & (1u << lk_ch(q))) == 0u) { continue; }
          let a = min(i32(ceil(ks * x)), lpm[q][k]);
          lpm[q][k] -= a;
          spread9(cur + lk_ch(q) * EP.n, idx, a);
          shd += a;
          if (q <= LK_TM) { atomicAdd(&wm1[M1C_SHED_S], a); } else if (q == LK_OIL) { atomicAdd(&wm1[M1C_SHED_O], a); }   // (step M1)
        }
      }
      atomicAdd(&wlp[LC_SHED], shd);
    }
    for (var q = 0u; q < 5u; q++) {
      for (var k = 0u; k < 6u; k++) {
        if (lpm[q][k] != lpm0[q][k]) { atomicStore(&stock[o + lpw(q, k)], lpm[q][k]); }
      }
    }
    var heads1 = 0;
    var kMean = 0.0;   // step C12e: the sides' mean stiffness (what osmosis swells against)
    var lipI = array<f32, 6>(1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    var lipL = array<u32, 6>(0u, 0u, 0u, 0u, 0u, 0u);
    var bitB = 0;
    if (lipOn) { bitB = flux[fo + 37u]; }
    let thickF = sqrt(max(gm.y, 1e-4) / max(EP.mb3.w, 1e-4)) * gm.z;
    for (var k = 0u; k < 6u; k++) {
      heads1 += lpm[LK_GP][k] - lpm[LK_TM][k];
      if (!lipOn) { continue; }
      let S = f32(lpm[LK_GP][k] + lpm[LK_TM][k]);
      let Oe = min(f32(lpm[LK_OIL][k]), EP.lp[5].y * S);
      let W = f32(lpm[LK_CL][k] + lpm[LK_CH][k]);
      let ib = clamp((S + Oe) / want, 0.0, 1.0);
      let cover = clamp(W / want, 0.0, 1.0);
      var kk = lip_kb(S, Oe, tmpL) * (EP.lp[5].w + (1.0 - EP.lp[5].w) * ib) * thickF;
      kk = clamp(mix(kk, LIP_KMAX, cover), EP.lp[5].z, LIP_KMAX);
      kMean += kk / 6.0;
      lipI[k] = ib;
      lipL[k] = pack4x8unorm(vec4f(kk / LIP_KMAX, select(0.0, f32(lpm[LK_CH][k]) / max(W, 1.0), W > 0.0),
                                   select(0.0, Oe / max(S + Oe, 1.0), S + Oe > 0.0), cover));
    }
    if ((lp_flags() & LPF_HEADS) == 0u) { heads0 = 0; heads1 = 0; }
    cells[i].lip = lipL;

    // the temperature under the cell (its 3 x 3 pixels' mean, from the plan pass), for the sparks of the reactions inside
    let temp = max(bitcast<f32>(flux[fo + 15u]), 1e-4);
    let concIn = 1.0 / (ATOM_SCALE * areaR2);                  // stock counts x concIn = units per R^2 inside
    var sparkScale = 1.0;
    if (CP.traceOn != 0u) { sparkScale = 1.0 / (1.0 + CP.traceK * f32(m[CP.trace]) * concIn); }
    let lnCap = log(max(cap, 1.0));                            // step C12e: saturation's concentrations are shares of the capacity
    let satOn = (ws_flags() & WSF_SAT) != 0u;

    // ---- step C6: the engines from the genome ----
    var b = bio[i];
    // step C13, the engine gate: the engine slots' rates x (1 + g s), s the field A the cell's sides felt (their mean)
    if ((fg_bits() & FG_ENGINE) != 0u) { b.rate = vec4f(b.rate.xyz * gate_factor(b.gate.z, cell_felt_mean(c)), b.rate.w); }
    // step T1b, the gene network: each slot's rate as EXPRESSED (its output x the gene), a harvest slot's also x the pigment output; the
    // pigment it builds and wants, the photons it catches and the upkeep below all follow the expressed rate (an engine expressed near 0
    // costs nothing)
    if (grn_on()) {
      var ef = vec3f(gof(i, GRN_O_ENG0), gof(i, GRN_O_ENG0 + 1u), gof(i, GRN_O_ENG0 + 2u));
      let pf = gof(i, GRN_O_PIG);
      for (var k = 0u; k < 3u; k++) {
        if (eng_at(b.eng[k]).kind == 0u && eng_band(b.eng[k]) > 0u) { ef[k] *= pf; }
      }
      b.rate = vec4f(b.rate.xyz * ef, b.rate.w);
    }
    var fpg = 1.0;                                // step N1: the share of the wanted pigment the cell holds (1: light needs no matter)
    var pg = atomicLoad(&stock[o + W_PIG]);       // ... the pigment it holds (counts)
    let pg0 = pg;
    var cbPh = vec3i(0);                          // step C15b: the photons a carbon slot's pigment caught (its engine runs below)
    var cbPs = vec3i(0);                          // ... of them, those it can use (saturation)
    if ((EP.flags & EF_ENG) != 0u) {
      // ---- step N1 block: LIGHT NEEDS MATTER. The pigment wears out into its atoms, then is built toward what the harvest slots
      // want (one trace and two l from the stock per count, the assembly paid from the battery as heat) ----
      let n1f = n1_flags();
      if ((n1f & NLF_MATTER) != 0u) {
        var hRate = 0.0;
        for (var k = 0u; k < 3u; k++) {
          if (b.rate[k] > 0.0 && eng_at(b.eng[k]).kind == 0u && eng_band(b.eng[k]) > 0u) { hRate += b.rate[k]; }
        }
        let pw = EP.nl[0].y * areaR2 * hRate;
        let nw = min(i32(floor(f32(pg) * EP.nl[1].x + u01(pcg(rs + 0x2a4c3e1fu)))), pg);
        if (nw > 0) { pg -= nw; m[N1_TRACE] += n1_shed(nw, cur, idx); m[MB_CH_L] += 2 * nw; atomicAdd(&wn1[N1_WEAR], nw); }
        let c16 = i32(EP.nl[0].w);
        if (f32(pg) < pw) {
          var nb = i32(floor((pw - f32(pg)) * EP.nl[0].z + u01(pcg(rs + 0x5be0cd19u))));
          nb = min(nb, min(max(m[N1_TRACE], 0), max(m[MB_CH_L], 0) / 2));
          if (c16 > 0) { nb = min(nb, max(bat, 0) / c16); }
          if (nb > 0) {
            pg += nb; m[N1_TRACE] -= nb; m[MB_CH_L] -= 2 * nb; bat -= nb * c16; heat += nb * c16;
            atomicAdd(&wn1[N1_BUILT], nb); atomicAdd(&wn1[N1_BUILDE], nb * c16);
          }
        }
        fpg = select(0.0, clamp(f32(pg) / pw, 0.0, 1.0), pw > 0.5);
      } else if (pg > 0) {
        m[N1_TRACE] += pg; m[MB_CH_L] += 2 * pg; atomicAdd(&wn1[N1_WEAR], pg); pg = 0;   // (the rule off: what was built falls apart)
      }
      // ---- end of the step N1 block ----
      // pigments: each harvest slot's pigment catches its band of the light falling on the cell, in whole photons (one
      // photon = one event's worth); its optical depth is pigK x the slot's rate, and it shares the band with what else
      // catches it there (the medium, the cell's body) by depth, as the dish's absorption does
      var nph = vec3i(0);
      var nsat = vec3i(0);                        // step N1: the photons the slot can use (saturation)
      if ((EP.flags & EF_PIG) != 0u && LP.mode != LIGHT_OFF) {
        let s = light_factor(LP, c.pos) * caustic_at(c.pos);   // (step N1: x the caustic light)
        var tb = vec4f(0.0);
        for (var k = 0u; k < 3u; k++) {
          if (b.rate[k] > 0.0 && eng_at(b.eng[k]).kind == 0u && eng_band(b.eng[k]) > 0u) { tb[eng_band(b.eng[k])] += EP.pigK * b.rate[k] * fpg; }
        }
        if (s > 0.0 && any(tb > vec4f(0.0))) {
          let apx = areaPx / (HP.px * HP.px);                  // the cell's area in heat pixels
          let tot = tb + LP.tauMed + LP.tauCell;
          let caught = LP.power * s * apx * (1.0 - exp(-tot)) / max(tot, vec4f(1e-9));   // x a depth = what it catches
          for (var k = 0u; k < 3u; k++) {
            let band = eng_band(b.eng[k]);
            if (b.rate[k] <= 0.0 || eng_at(b.eng[k]).kind != 0u || band == 0u) { continue; }
            let ph16 = EP.photon16[band];
            let n = i32(floor(caught[band] * EP.pigK * b.rate[k] * fpg / f32(ph16) + u01(pcg(rs + k * 0x2f6b1e3du + 0x13579bdfu))));
            nph[k] = n;
            atomicAdd(&wev2[E2_PIG + band], n * ph16);
            // ---- step N1 block: photosynthesis SATURATES (the light s, a share of the full noon light: Isat tanh(s / Isat) / s of the
            // photons usable), and photons past it BLEACH the pigment (photoinhibition) ----
            var nu1 = n;
            if ((n1_flags() & NLF_SAT) != 0u && EP.nl[1].y > 0.0 && n > 0) {
              let se = s * EP.nl[1].w;
              let uf = select(1.0, EP.nl[1].y * tanh(se / EP.nl[1].y) / se, se > 1e-6);
              nu1 = clamp(i32(floor(f32(n) * uf + u01(pcg(rs + k * 0x3c6ef372u + 0x0fedcba9u)))), 0, n);
            }
            nsat[k] = nu1;
            atomicAdd(&wn1[N1_CAUGHT], n);
            atomicAdd(&wn1[N1_ISAT], n - nu1);
            if ((n1_flags() & NLF_INHIB) != 0u && n > nu1 && pg > 0) {
              let nb = min(i32(floor(f32(n - nu1) * EP.nl[1].z + u01(pcg(rs + k * 0x27d4eb2fu + 0x165667b1u)))), pg);
              if (nb > 0) { pg -= nb; m[N1_TRACE] += n1_shed(nb, cur, idx); m[MB_CH_L] += 2 * nb; atomicAdd(&wn1[N1_INHIB], nb); }
            }
            // ---- end of the step N1 block ----
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
      // step C7b, trace as cofactor: every engine runs at cof of its rate (a pigment's engine uses only that share of the
      // photons it caught; the rest are photons with nothing to work on: heat)
      let cof = cofactor(f32(max(m[CP.trace], 0)) * concIn);
      for (var k = 0u; k < 3u; k++) {
        let rk = b.rate[k] * cof;
        if (rk <= 0.0) { continue; }
        if (eng_index(b.eng[k]) >= ENG_MAIN) { cbPh[k] = nph[k]; cbPs[k] = nsat[k]; continue; }   // step C15b: a carbon engine (its section, below)
        let E = EP.eng[eng_index(b.eng[k])];
        let sp16 = max(i32(ceil(E.spark * sparkScale * 16.0)), 1);
        // what it works on: one reactant, two different ones (the scarcer), or a pair of the same (half of it)
        // (step C12c: a light giver or taker is taken from the pool of ground and excited ones)
        var a = xp(&m, E.ch.x);
        if (E.ch.y != NONE) { a = select(min(xp(&m, E.ch.x), xp(&m, E.ch.y)), m[E.ch.x] / 2, E.ch.y == E.ch.x); }
        let rx1 = u01(pcg(rs + k * 0x7a3c5b1du + 0x3f84d5b5u));
        let rx2 = u01(pcg(rs + k * 0x7a3c5b1du + 0x1b56c4e9u));
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
          var nu = np;                                          // the photons the engine can use (the cofactor's share)
          if (band != 0u) { nu = nsat[k]; }                     // (step N1: those past saturation are idle)
          let nu0 = nu;
          if (band != 0u && cof < 1.0) { nu = i32(floor(f32(nu) * cof + u01(pcg(rs + k * 0x1b873593u + 0x0badf00du)))); }
          var n = min(nu, min(a, cap));
          n = max(min(n, bat / c16), 0);
          if (band != 0u) {   // step N1: why the photons went unused (counters only)
            let na = min(nu, max(a, 0));
            atomicAdd(&wn1[N1_ICOF], nu0 - nu);
            atomicAdd(&wn1[N1_IMAT], nu - na);
            atomicAdd(&wn1[N1_ICAP], na - min(na, cap));
            atomicAdd(&wn1[N1_IBAT], min(na, cap) - n);
          }
          // step C12e, SATURATION: x (1 - Q / K), the drive what the photon and the battery put in beyond the rise (its surplus + the spark)
          if (n > 0 && satOn) {
            let q = rx_lq(&m, E.ch);
            let fs = sat_f(q.x, q.y, lnCap, f32(max(ph16, E.g16) - E.g16 + sp16) / 16.0, temp);
            let n1 = clamp(i32(floor(f32(n) * fs + u01(pcg(rs + k * 0x2d358dccu + 0x31b2f3c1u)))), 0, n);
            satW += f32(n);
            satL += f32(n - n1);
            if (band != 0u) { atomicAdd(&wn1[N1_IWASTE], n - n1); }   // (step N1)
            n = n1;
          }
          tMade += n * max(t_net(E.ch), 0);
          if (band != 0u) { atomicAdd(&wn1[N1_RISE], n * E.g16); }   // (step N1: the energy light stored)
          if (band == 0u) { np = n; }                           // (a storer has no photons to waste)
          var nx = 0;
          if (n > 0) {
            if (E.ch.y == E.ch.x) { m[E.ch.x] -= 2 * n; }
            else { nx += xtk(&m, E.ch.x, n, rx1); if (E.ch.y != NONE) { nx += xtk(&m, E.ch.y, n, rx2); } }
          }
          // step C12c: an uphill swap driven by a pigment's photon frees its light atom EXCITED, keeping E* of the photon's rest
          // (a storer's, paid by the battery, frees a ground one)
          let exm = band != 0u && CP.ex.x > 0.5 && E.ch.w < 2u;
          m[E.ch.z] += n;
          if (E.ch.w != NONE) { m[select(E.ch.w, E.ch.w + EXC0, exm)] += n; }
          bat -= n * c16;
          var hh = n * (ph16 + c16 - E.g16) + (np - n) * ph16;
          if (exm && n > 0) { hh -= n * ex16; atomicAdd(&wxn[XN_MADE_CELL], n); }
          // ... and the excited reactants it used give their energy to the battery (an engine), less the ineff share
          if (nx > 0) {
            let ex = nx * ex16;
            let eb = clamp(ex - (ex * i32(EP.ineff)) / 256, 0, max(batMax - bat, 0));
            bat += eb;
            hh += ex - eb;
            atomicAdd(&wxn[XN_ENGINE], nx);
            atomicAdd(&wxe[XE_ENGINE], eb);
          }
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
          var xs = rk * f32(a) * EP.dt;
          // step C12e, SATURATION: x (1 - Q / K), the drive the reaction's release
          if (satOn) {
            let q = rx_lq(&m, E.ch);
            let fs = sat_f(q.x, q.y, lnCap, f32(E.g16) / 16.0, temp);
            let xw = min(xs, f32(min(a, cap)));
            satW += xw;
            satL += xw * (1.0 - fs);
            xs *= fs;
          }
          var n = i32(floor(xs + u01(pcg(rs + k * 0x6c8e9cf5u + 0x2545f491u))));
          n = min(n, min(a, cap));
          n = min(n, bat / sp16);
          n = min(n, max(batMax - bat, 0) / max(g1, 1));
          if (n <= 0) { continue; }
          var nx = 0;
          if (E.ch.y == E.ch.x) { m[E.ch.x] -= 2 * n; }
          else { nx += xtk(&m, E.ch.x, n, rx1); if (E.ch.y != NONE) { nx += xtk(&m, E.ch.y, n, rx2); } }
          m[E.ch.z] += n;
          if (E.ch.w != NONE) { m[E.ch.w] += n; }
          tMade += n * max(t_net(E.ch), 0);
          bat += n * g1;
          heat += n * h1;
          // step C12c: an excited reactant's energy goes into the battery too (an engine: controlled), less the ineff share; what
          // a full battery has no room for is heat
          var eb = 0;
          if (nx > 0) {
            let ex = nx * ex16;
            eb = clamp(ex - (ex * i32(EP.ineff)) / 256, 0, max(batMax - bat, 0));
            bat += eb;
            heat += ex - eb;
            atomicAdd(&wxn[XN_ENGINE], nx);
            atomicAdd(&wxe[XE_ENGINE], eb);
            atomicAdd(&wev2[E2_HEAT], ex - eb);
          }
          if (E.kind == 2u) { atomicAdd(&wxe[XE_BREATH], n * g1 + eb); }
          if (E.kind == 1u) { atomicAdd(&wxe[XE_BURN], n * g1 + eb); }
          if (E.kind == 1u && E.ch.w == NONE && E.ch.x < 6u && E.ch.y < 6u) { atomicAdd(&wev2[E2_GRAD], n); atomicAdd(&wev2[E2_GRADE], n * g1 + eb); }
          atomicAdd(&wev2[E2_BURN + E.kind - 1u], n);
          atomicAdd(&wev2[E2_GAIN], n * g1 + eb);
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
        if (R.by != 0u || R.open != 0u) { continue; }   // (step C12: oil and amphiphiles are the open dish's only)
        if (xp(&m, R.ch.x) <= 0) { continue; }
        var x = R.k * f32(xp(&m, R.ch.x)) * exp(-R.spark * sparkScale / (CP.theta * temp)) * EP.dt;
        if (R.ch.y != NONE) { x *= f32(xp(&m, R.ch.y)) * concIn; }
        // step C12e, SATURATION (the drive: the reaction's release)
        if (satOn) {
          let q = rx_lq(&m, R.ch);
          let fs = sat_f(q.x, q.y, lnCap, f32(R.heat16) / 16.0, temp);
          let xw = min(x, f32(xp(&m, R.ch.x)));
          satW += xw;
          satL += xw * (1.0 - fs);
          x *= fs;
        }
        var n = i32(floor(x + u01(pcg(rs + r * 0x9e3779b9u + 0x7f4a7c15u))));
        if (R.ch.y == R.ch.x) {
          n = min(n, m[R.ch.x] / 2);
        } else {
          n = min(n, xp(&m, R.ch.x));
          if (R.ch.y != NONE) { n = min(n, xp(&m, R.ch.y)); }
        }
        if (n <= 0) { continue; }
        // (step C12c: an excited atom loose in the cell reacts as its ground atom; its energy is dumped as heat, uncontrolled)
        var nx = 0;
        if (R.ch.y == R.ch.x) { m[R.ch.x] -= 2 * n; }
        else {
          nx += xtk(&m, R.ch.x, n, u01(pcg(rs + r * 0x51ed27u + 0x1b873593u)));
          if (R.ch.y != NONE) { nx += xtk(&m, R.ch.y, n, u01(pcg(rs + r * 0x51ed27u + 0x68e31da4u))); }
        }
        m[R.ch.z] += n;
        if (R.ch.w != NONE) { m[R.ch.w] += n; }
        tMade += n * max(t_net(R.ch), 0);
        rh += n * R.heat16 + nx * ex16;
        if (nx > 0) { atomicAdd(&wxn[XN_RX_IN], nx); atomicAdd(&wxe[XE_LOOSE], nx * ex16); }
        if (R.fam == 1u) { atomicAdd(&wev[EV_IN_BURN], n); }
        else if (R.fam == 3u) { atomicAdd(&wev[EV_IN_SWAP], n); }
        else if (R.fam == 4u) { atomicAdd(&wev[EV_IN_FORM], n); }
      }
      heat += rh;
      atomicAdd(&wev[EV_IN_HEAT], rh);
    }
    // ---- step C12c: the excited atoms inside fade to their ground atoms by themselves (their energy: heat at the cell), as in the
    // open: 1 / lifetime x (1 + temperature / hot) per s
    if (m[EXC0] + m[EXC0 + 1u] > 0) {
      let pf = clamp(CP.ex.z * (1.0 + temp / max(CP.ex.w, 1e-3)) * EP.dt, 0.0, 1.0);
      var nf = 0;
      for (var j = 0u; j < 2u; j++) {
        let xj = m[EXC0 + j];
        if (xj <= 0) { continue; }
        let f = min(i32(floor(f32(xj) * pf + u01(pcg(rs + j * 0x2c1b3c6du + 0x5851f42du)))), xj);
        m[EXC0 + j] -= f;
        m[j] += f;
        nf += f;
      }
      if (nf > 0) { heat += nf * ex16; atomicAdd(&wxn[XN_FADE_CELL], nf); atomicAdd(&wxe[XE_FADE], nf * ex16); }
    }

    // ---- step C15b: CELLS EAT CARBON (cell_carbon.wgsl): the ladder's exchange, grazing tar, the carbon engines, granules dissolving ----
    var cbo: CbOut;
    if (CARBON_ON != 0u) {
      cbo = cb_cell(i, b, cbPh, cbPs, &m, &bat, &heat, idx, lnCap, temp, satOn, sparkScale, cofactor(f32(max(m[CP.trace], 0)) * concIn),
                    pcg(rs + 0x08c3a5e9u));
    }

    // ---- step C6, upkeep: per s, upEng x the engines' rates (while they run) and upTol x tolerance / tolRef (while it is
    // a gene), paid from the battery as heat (what an empty battery cannot pay is not paid)
    if ((EP.flags & EF_UPKEEP) != 0u) {
      var cost = 0.0;
      if ((EP.flags & EF_ENG) != 0u) { cost += EP.upEng * (max(b.rate.x, 0.0) + max(b.rate.y, 0.0) + max(b.rate.z, 0.0)); }
      if ((EP.flags & EF_TOLG) != 0u) { cost += EP.upTol * b.eng.w / max(EP.tolRef, 1e-3); }
      // step C7: the pumps' upkeep (per unit of rate, as the engines')
      var pcu = 0.0;
      if ((puf & PUF_ON) != 0u) { pcu = EP.pu1.x * (min(max(gpu.z, 0.0), EP.pu0.w) + min(max(gpu.w, 0.0), EP.pu0.w)); }
      cost += pcu;
      let pay = clamp(i32(floor(cost + u01(pcg(rs + 0x0b4e0ef3u)))), 0, bat);
      if (pay > 0) {
        bat -= pay;
        heat += pay;
        atomicAdd(&wev2[E2_UPKEEP], pay);
        if (pcu > 0.0) { atomicAdd(&wpu[PC_UPKEEP], i32(round(f32(pay) * pcu / max(cost, 1e-9)))); }
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

    // ---- step C12e, OSMOSIS ON THE IONS: the swelling relaxes (ws[0].w per s) toward kOsm x the pressure (the plan's, flux 30) x the
    // membrane's closure (its mean integrity: a leaky membrane holds no pressure) / its stiffness (the bilayer and wall's, C12b; the
    // material's, C6c; 1 without the membrane chemistry), within the knobs' bounds. Past its STRETCH TOLERANCE (the gene gate2.z, a log
    // factor on wTol) a whole membrane TEARS: it bursts at ws2.x x (swelling / tolerance - 1) per s (below). The tolerance costs
    // upkeep, ws2.y x e^gene per tick, from the battery as heat (only while osmosis is on: with it off the genes drift, unpaid)
    let wsf = ws_flags();
    let osmOn = (wsf & WSF_OSM) != 0u && (EP.flags & EF_EAT) != 0u && cur != 0u;
    let posm = bitcast<f32>(flux[fo + 30u]);
    var wsw = 0.0;
    var tear = false;
    var kOsm = 1.0;
    if (lipOn) { kOsm = kMean; } else if (membOn) { kOsm = memb_stiff(gm, EP.mb3.w); }
    if (osmOn) {
      var close = 1.0;
      if (membOn) {
        close = 0.0;
        for (var k = 0u; k < 6u; k++) { close += select(clamp(f32(sl[k] + sh[k]) / want, 0.0, 1.0), lipI[k], lipOn) / 6.0; }
      }
      let weq = clamp(EP.ws[0].z * posm * close / max(kOsm, 0.05), EP.ws[1].y, EP.ws[1].x);
      wsw = c.osm + (weq - c.osm) * min(1.0, EP.ws[0].w * EP.dt);
      let tolG = exp(clamp(bio[i].gate2.z, -2.0, 1.5));
      if ((wsf & WSF_TEAR) != 0u && membOn && wsw > EP.ws[1].w * tolG) {
        tear = u01(pcg(rs + 0x6a09e667u)) < EP.ws2.x * (wsw / (EP.ws[1].w * tolG) - 1.0) * EP.dt;
      }
      if ((wsf & WSF_COST) != 0u) {
        let pay = clamp(i32(floor(EP.ws2.y * tolG + u01(pcg(rs + 0x3c6ef372u)))), 0, max(bat, 0));
        if (pay > 0) { bat -= pay; heat += pay; atomicAdd(&wws[WC_UPKEEP], pay); }
      }
    }
    // ... and the t made and taken in (the census: who lives on outside t), the saturation's counters
    if (tMade != 0) { atomicAdd(&stock[o + W_TMADE], tMade); atomicAdd(&wws[WC_TMADE], tMade); }
    if (tIn != tOut) { atomicAdd(&stock[o + W_TIMP], tIn - tOut); }
    if (tIn != 0) { atomicAdd(&wws[WC_TIN], tIn); }
    if (tOut != 0) { atomicAdd(&wws[WC_TOUT], tOut); }
    if (satW > 0.0) {
      atomicAdd(&wws[WC_WANT], i32(floor(satW / 16.0 + u01(pcg(rs + 0x510e527fu)))));
      atomicAdd(&wws[WC_LOST], i32(floor(satL / 16.0 + u01(pcg(rs + 0x9b05688cu)))));
    }

    // write back what changed (only this invocation touches this cell's stock in this dispatch)
    for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); if (m[k] != m0[k]) { atomicStore(&stock[o + stock_w(k)], m[k]); } }
    if (bat != bat0) { atomicStore(&stock[o + BAT], bat); }
    if (pg != pg0) { atomicStore(&stock[o + W_PIG], pg); }   // (step N1)
    if (heat != 0) { atomicAdd(&hb[LEDGER_WORDS + idx[4]], heat); }
    var fill = 3.0 * f32(max(pg, 0));                        // (step N1: the pigment's three atoms take room too)
    for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); fill += f32(m[k]) * ep_f(EP.natoms, k); }
    fill += cbo.atoms;                                        // (step C15b: and its carbon)
    cells[i].bat = clamp(f32(bat) / f32(batMax), 0.0, 1.0);
    cells[i].fill = clamp(fill / max(cap, 1.0), 0.0, 1.0);
    // step T1b: what the gene network senses of the cell's inside and its light (src/grn.js; Cell.sns0, sns1)
    {
      let ls = select(0.0, 1.0 - exp(-light_factor(LP, c.pos) * caustic_at(c.pos) * EP.nl[1].w), LP.mode != LIGHT_OFF);
      let tr = cofactor(f32(max(m[CP.trace], 0)) / (ATOM_SCALE * areaR2));
      let tol = select(EP.tol, bio[i].eng.w, (EP.flags & EF_TOLG) != 0u);
      let tmp = bitcast<f32>(flux[fo + 15u]) / max(2.0 * tol, 1e-3);
      cells[i].sns0 = pack4x8unorm(vec4f(ls, grn_amount(m[1] + m[17], cap, GRN_REF_T), grn_amount(m[6] + m[7] + m[8] + m[9], cap, GRN_REF_FUEL),
                                         grn_amount(m[2] + m[5], cap, GRN_REF_LINK)));
      // (step C15b: z the granules, for the drawing; w the BODY's share of its want, which the step's division reads: 1 without carbon)
      cells[i].sns1 = pack4x8unorm(vec4f(tr, clamp(tmp, 0.0, 1.0), grn_amount(i32(cbo.gran), cap, 0.05), select(1.0, cbo.ready, CARBON_ON != 0u)));
    }

    // ---- step C6b: the cell's charge, the net charge of its stock (givers minus takers; fuel and sediment are neutral);
    // q saturates (tanh) for field B. With the charge field on it puts its net charge down where it is (cloud in cell:
    // over the 4 pixels around its centre, by their nearness), so the substrate's field sees the charge the cell took in
    var qn = 0;
    for (var j = 0u; j < NCELL; j++) { let k = cell_ch(j); qn += charge_of(EP.qCodes, k) * m[k]; }
    qn += heads1;   // step C12b: the soap heads in its membrane (glL +, tlL -; 0 while LPF_HEADS is off)
    let qu = f32(qn) / ATOM_SCALE;
    cells[i].qNet = qu;
    cells[i].q = tanh(qu * EP.qInv);
    // step C6d: the side charges on the new net charge (each side's difference from the even share kept, the sum = qNet)
    // (step C12b: with the dipoles on, the soap heads' charge stays on its own side: taken off, the mobile rest put on the stock's
    // net charge, and the heads put back as they are now)
    var sq = c.sideQ;
    let hside = (EP.dpFlags & DPE_ON) != 0u && (lp_flags() & LPF_HEADS) != 0u;
    if (hside) { for (var k = 0u; k < 6u; k++) { sq[k] -= f32(lpm0[LK_GP][k] - lpm0[LK_TM][k]) / ATOM_SCALE; } }
    var sm = 0.0;
    for (var k = 0u; k < 6u; k++) { sm += sq[k]; }
    let sd = (qu - select(0.0, f32(heads1) / ATOM_SCALE, hside) - sm) / 6.0;
    for (var k = 0u; k < 6u; k++) { sq[k] += sd; }
    if (hside) { for (var k = 0u; k < 6u; k++) { sq[k] += f32(lpm[LK_GP][k] - lpm[LK_TM][k]) / ATOM_SCALE; } }
    cells[i].sideQ = sq;
    let dpDep = (EP.dpFlags & (DPE_ON | DPE_DEPOSIT)) == (DPE_ON | DPE_DEPOSIT);
    if (EP.qOff != 0u && dpDep) {
      // ... and puts them into the substrate's field at its sides' middles (cloud in cell at each; whole counts, the last
      // side taking the remainder, so the cell puts down exactly its net charge)
      let mbe = membrane(c);
      var left = qn;
      for (var k = 0u; k < 6u; k++) {
        var ck = i32(round(sq[k] * ATOM_SCALE));
        if (k == 5u) { ck = left; }
        left -= ck;
        if (ck != 0) { deposit_q(c.pos + mbe.mid[k], ck); }
      }
    } else if (EP.qOff != 0u && qn != 0) {
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
      for (var k = 0u; k < 6u; k++) { ig[k] = select(clamp(f32(sl[k] + sh[k]) / want, 0.0, 1.0), lipI[k], lipOn); im += ig[k]; }
      im /= 6.0;
    }
    var fl2 = c.flags;
    // ---- step C8: the hard light DOSE. The hard light falling on the cell, shared by optical depth between the medium, the
    // cell's body and its hard light pigments (as the pigments' catch above): what the BODY catches adds to the dose, which is
    // repaired at hl.y per tick. (A hard pigment takes its share first: a sunscreen, if one evolves.) The step reads the
    // parent's dose at a birth and scales the mutation by it. Off: the dose is cleared
    if (EP.hl.x > 0.0) {
      var dose = i32(fl2 >> CELL_DOSE_SHIFT);
      var add = 0.0;
      if (LP.mode != LIGHT_OFF) {
        let lf = light_factor(LP, c.pos) * caustic_at(c.pos);   // (step N1: x the caustic light)
        if (lf > 0.0) {
          var th = 0.0;
          if ((EP.flags & EF_ENG) != 0u && (EP.flags & EF_PIG) != 0u) {
            for (var k = 0u; k < 3u; k++) {
              if (b.rate[k] > 0.0 && eng_at(b.eng[k]).kind == 0u && eng_band(b.eng[k]) == 3u) { th += EP.pigK * b.rate[k] * fpg; }
            }
          }
          let tot = LP.tauMed.w + LP.tauCell.w + th;
          add = LP.power.w * lf * areaPx / (HP.px * HP.px) * (1.0 - exp(-tot)) * LP.tauCell.w / max(tot, 1e-6) / HEAT_SCALE * DOSE_SCALE;
        }
      }
      let rd = pcg(rs + 0x5f356495u);
      dose += i32(floor(add + u01(rd))) - i32(floor(f32(dose) * EP.hl.y + u01(pcg(rd))));
      dose = clamp(dose, 0, i32(CELL_DOSE_MAX));
      fl2 = (fl2 & ((1u << CELL_DOSE_SHIFT) - 1u)) | (u32(dose) << CELL_DOSE_SHIFT);
    } else {
      fl2 &= (1u << CELL_DOSE_SHIFT) - 1u;
    }
    if (membOn && im >= EP.mb1.z) { fl2 |= CELL_WHOLE; }
    let burst0 = membOn && (mbf & MBF_BURST) != 0u && (fl2 & CELL_WHOLE) != 0u && im < EP.mb1.y && bitL + bitH + bitB > 0;
    // step C12e: or torn by overstretch (a whole membrane past its stretch tolerance)
    let torn = tear && (mbf & MBF_BURST) != 0u && (fl2 & CELL_WHOLE) != 0u;
    let burst = burst0 || torn;
    if (torn && !burst0) { atomicAdd(&wws[WC_TEAR], 1); }
    cells[i].osm = select(wsw, 0.0, burst);
    cells[i].osmP = posm;
    if (burst) {
      give_back(i, c.pos, cur, slot);
      fl2 = (fl2 & ~CELL_BURST_MASK) | (1u << CELL_BURST_SHIFT);
      ig = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      cells[i].bat = 0.0;
      cells[i].fill = 0.0;
      cells[i].q = 0.0;
      cells[i].qNet = 0.0;
      cells[i].sideQ = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      cells[i].volt = 0.0;
      atomicAdd(&wmb[MB_BURSTS - 16u], 1);
    }
    cells[i].integ = ig;
    if (fl2 != c.flags) { cells[i].flags = fl2; }
  } else if (husk) {
    cells[i].integ = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    cells[i].lip = array<u32, 6>(0u, 0u, 0u, 0u, 0u, 0u);   // step C12b
    cells[i].wadh = array<u32, 2>(0u, 0u);   // step C10: a burst cell holds nothing
    cells[i].wpay = 0u;
    cells[i].wlink = 0u;
    cells[i].osm = 0.0;   // step C12e
  }
  flush_counters(li, slot);
}

fn u01(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

// step C6d: put n charge counts down in the cells' charge block at position p (cloud in cell over the 4 pixels around it)
fn deposit_q(p: vec2f, n: i32) {
  let gp = p / HP.px - 0.5;
  let b0 = floor(gp);
  let fr = gp - b0;
  let hi = vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1);
  let p00 = clamp(vec2i(b0), vec2i(0), hi);
  let p11 = clamp(vec2i(b0) + 1, vec2i(0), hi);
  let w00 = i32(round(f32(n) * (1.0 - fr.x) * (1.0 - fr.y)));
  let w10 = i32(round(f32(n) * fr.x * (1.0 - fr.y)));
  let w01 = i32(round(f32(n) * (1.0 - fr.x) * fr.y));
  let w11 = n - w00 - w10 - w01;
  if (w00 != 0) { atomicAdd(&hb[EP.qOff + u32(p00.y) * HP.hw + u32(p00.x)], w00); }
  if (w10 != 0) { atomicAdd(&hb[EP.qOff + u32(p00.y) * HP.hw + u32(p11.x)], w10); }
  if (w01 != 0) { atomicAdd(&hb[EP.qOff + u32(p11.y) * HP.hw + u32(p00.x)], w01); }
  if (w11 != 0) { atomicAdd(&hb[EP.qOff + u32(p11.y) * HP.hw + u32(p11.x)], w11); }
}

// ---------- ledger (once per frame) ----------
var<workgroup> wlo: array<atomic<u32>, 16>;   // (step C12c: 14, 15 the excited atoms)
var<workgroup> whi: array<atomic<u32>, 16>;
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
// step C7, the pumps' census (a snapshot, LG_PU + 16 v): cells, cells with an active pump (a slot's rate at least PUMP_ACTIVE),
// their battery share x 1000 and the others', fed cells (battery at least 0.3) and those with an active pump, sum of the active
// slots' rates x 1000, sum |voltage| x 1000, sum voltage x 1000, cells with |voltage| above 0.1, the voltages' energy (heat
// counts / 256), then cells carrying each pump gene (22: IN of the 11 pumpable substances in PUMP_CH order, then OUT), and
// the same among the fed cells
const PUMP_ACTIVE: f32 = 0.05;
const PS_N: u32 = 0u;
const PS_ACT: u32 = 1u;
const PS_BAT_ACT: u32 = 2u;
const PS_BAT_NONE: u32 = 3u;
const PS_FED: u32 = 4u;
const PS_FED_ACT: u32 = 5u;
const PS_RATE: u32 = 6u;
const PS_AVOLT: u32 = 7u;
const PS_VOLT: u32 = 8u;
const PS_VCELLS: u32 = 9u;
const PS_EV: u32 = 10u;
const PS_GENE: u32 = 16u;
const PS_GENE_FED: u32 = 38u;
var<workgroup> wpus: array<atomic<i32>, 64>;
// step C7b: the catalysts' census (CT_*; LG_CAT, src/catalysts.js)
var<workgroup> wcat: array<atomic<i32>, 16>;
const CT_N: u32 = 0u;          // cells with an engine
const CT_F: u32 = 1u;          // ... their cofactor factor x 1000
const CT_TR: u32 = 2u;         // all cells: trace inside per R^2 x 1e6
const CT_HAS: u32 = 3u;        // cells holding at least tHalf of trace per R^2
const CT_NL: u32 = 4u;         // cells with an engine in the light
const CT_FL: u32 = 5u;         // ... their factor x 1000
const CT_PUMP: u32 = 6u;       // cells with an active "IN trace" pump slot
const CT_PUMP_BAT: u32 = 7u;   // ... their battery x 1000
const CT_PUMP_TR: u32 = 8u;    // ... their trace per R^2 x 1e6
const CT_BAT: u32 = 9u;        // cells with an engine: battery x 1000
const CT_FED: u32 = 10u;       // cells with an engine and a battery of at least 0.3
const CT_FED_F: u32 = 11u;     // ... their factor x 1000
// step C8: the hard light census's snapshot (HL_* in cell_common.wgsl; LG_HL)
var<workgroup> whl: array<atomic<i32>, 8>;
// step C12b: the lipids' chemical energy (heat counts, its magnitude) and census (a snapshot, LG_LIP_S + 16 v): 0..4 the molecules in
// all membranes per kind (counts: glL, tlL, lL, ll, LL); 5 cells; sums x 1000 of 6 the oil share gene, 7 the wall gene, 8 the
// sides' mean stiffness; 9 cells whose wall covers at least half; in the light (spot or full field): 10 cells, sums of 11 the oil
// gene x 1000, 12 the stiffness x 1000, 13 the temperature x 100; 14 all cells' temperature x 100; 15 the light's wall gene x 1000
var<workgroup> wle: atomic<i32>;
var<workgroup> wlps: array<atomic<i32>, 16>;

@compute @workgroup_size(64)
fn ledger(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  var ml = 0;
  var mh = 0;
  var evc = 0;
  if (i < S.count) {
    // step C6c: the membrane's linkers count with the cells' l and L (the atoms' books)
    for (var k = 0u; k < 6u; k++) { ml += max(atomicLoad(&stock[i * SW + MB_L0 + k]), 0); mh += max(atomicLoad(&stock[i * SW + MB_H0 + k]), 0); }
    evc = max(atomicLoad(&stock[i * SW + EVW]), 0);   // step C7: the voltage's energy counts as stored, with the battery
    // step C12b: the lipid membrane's molecules count as their atoms with the cells' g, t, l and L (the atoms' and charge's books),
    // and their chemical energy (below the free atoms') on its own (LG_LIP_E)
    var lk = array<i32, 5>(0, 0, 0, 0, 0);
    for (var q = 0u; q < 5u; q++) { for (var k = 0u; k < 6u; k++) { lk[q] += max(atomicLoad(&stock[i * SW + lpw(q, k)]), 0); } }
    var le = 0;
    for (var q = 0u; q < 5u; q++) { le -= lk[q] * ep_i(EP.e16, lk_ch(q)); }
    if (le != 0) { atomicAdd(&wle, le); }
    for (var q = 0u; q < 5u; q++) { if (lk[q] != 0) { atomicAdd(&wlps[q], lk[q]); } }
    let lAtoms = lk[LK_GP] + lk[LK_TM] + lk[LK_OIL];
    // step N1: the pigment counts as its atoms with the cells' trace and l
    let pgv = max(atomicLoad(&stock[i * SW + W_PIG]), 0);
    if (pgv > 0) { add64(LG_N1 + 128u * N1_HELD + (i & 63u), pgv); add64(LG_N1 + 128u * N1_CELLS + (i & 63u), 1); }
    for (var k = 0u; k <= BAT; k++) {
      var v = max(atomicLoad(&stock[i * SW + k]), 0);
      if (k == N1_TRACE) { v += pgv; }
      if (k == MB_CH_L) { v += 2 * pgv; }
      if (k == MB_CH_L) { v += ml + lAtoms + 2 * lk[LK_CL]; }
      if (k == MB_CH_H) { v += mh + lAtoms + 2 * lk[LK_CH]; }
      if (k == 0u) { v += lk[LK_GP]; }
      if (k == 1u) { v += lk[LK_TM]; }
      if (k == BAT) { v += evc; }
      if (v == 0) { continue; }
      atomicAdd(&wlo[k], u32(v) & 0xffffu);
      atomicAdd(&whi[k], u32(v) >> 16u);
    }
    // step C12c: the excited atoms in the stock
    for (var j = 0u; j < 2u; j++) {
      let v = max(atomicLoad(&stock[i * SW + stock_w(EXC0 + j)]), 0);
      if (v == 0) { continue; }
      atomicAdd(&wlo[14u + j], u32(v) & 0xffffu);
      atomicAdd(&whi[14u + j], u32(v) >> 16u);
    }
  }
  if (i < S.count) { cb_ledger(i, (cells[i].flags & CELL_ALIVE) != 0u); }   // step C15b: the cells' carbon, its census
  // step C9: the census counts the live cells only (the books above count every slot: a free one holds nothing)
  if (i < S.count && (cells[i].flags & CELL_ALIVE) != 0u) {
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
      let E = eng_at(b.eng[k]);
      if (E.kind == 0u) {
        let band = eng_band(b.eng[k]);
        atomicAdd(&wcen[pb + band], 1);
        if (band > 0u) { hv = true; rr.x += b.rate[k]; up = up || (E.ch.w != NONE && E.ch.y != NONE); }
        else { rr.z += b.rate[k]; }
      }
      else if (E.kind == 1u || (E.kind == 2u && (EP.flags & EF_ELEC) != 0u)) { bu = true; rr.y += b.rate[k]; br = br || E.kind == 2u; }   // (step C12d:
      else { rr.z += b.rate[k]; br = br || E.kind == 2u; }                                                                                //  breathing feeds too)
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
    // step C12b: the lipid census (genes, stiffness, temperature; in the light and in all)
    var ks = 0.0;
    var wc = 0.0;
    for (var k = 0u; k < 6u; k++) { let lq = lip_side(c, k); ks += lq.x * LIP_KMAX / 6.0; wc += lq.w / 6.0; }
    let tc = f32(hs) / 9.0 * HP.tempScale;
    atomicAdd(&wlps[5], 1);
    atomicAdd(&wlps[6], i32(round(gm.x * 1000.0)));
    atomicAdd(&wlps[7], i32(round(b.lip.x * 1000.0)));
    atomicAdd(&wlps[8], i32(round(ks * 1000.0)));
    if (wc >= 0.5) { atomicAdd(&wlps[9], 1); }
    atomicAdd(&wlps[14], i32(round(min(tc, 1e5) * 100.0)));
    if (lit) {
      atomicAdd(&wlps[10], 1);
      atomicAdd(&wlps[11], i32(round(gm.x * 1000.0)));
      atomicAdd(&wlps[12], i32(round(ks * 1000.0)));
      atomicAdd(&wlps[13], i32(round(min(tc, 1e5) * 100.0)));
      atomicAdd(&wlps[15], i32(round(b.lip.x * 1000.0)));
    }
    // step M1: the whole membranes' census (the integrity's spread, the bilayer wanted and held, what the builder could use)
    {
      atomicAdd(&wm1s[M1Z_N], 1);
      atomicAdd(&wm1s[M1Z_INTEG], i32(round(im * 1000.0)));
      atomicAdd(&wm1s[M1Z_B0 + min(u32(floor(clamp(im, 0.0, 1.0) * 5.0)), 4u)], 1);
      let wnt = max(memb_want(c.r, gm.y), 1.0);
      var hold = 0.0;
      var xo = 0.0;
      for (var k = 0u; k < 6u; k++) {
        let S = f32(max(atomicLoad(&stock[i * SW + lpw(LK_GP, k)]), 0) + max(atomicLoad(&stock[i * SW + lpw(LK_TM, k)]), 0));
        let O = f32(max(atomicLoad(&stock[i * SW + lpw(LK_OIL, k)]), 0));
        hold += min(S + min(O, EP.lp[5].y * S), wnt);
        xo += max(O - EP.lp[5].y * S, 0.0);
      }
      atomicAdd(&wm1s[M1Z_WANT], i32(round(6.0 * wnt / 16.0)));
      atomicAdd(&wm1s[M1Z_HELD], i32(round(hold / 16.0)));
      atomicAdd(&wm1s[M1Z_WOIL], i32(round(xo / 16.0)));
      let one = 8;   // (1/512 of a unit)
      let sl = atomicLoad(&stock[i * SW + MB_CH_L]);
      let sh = atomicLoad(&stock[i * SW + MB_CH_H]);
      let hd = atomicLoad(&stock[i * SW]) + atomicLoad(&stock[i * SW + 1u]);
      if (sh >= one) { atomicAdd(&wm1s[M1Z_HAS_LL], 1); }
      if (sl >= one) { atomicAdd(&wm1s[M1Z_HAS_L], 1); }
      if (sh >= one && sl >= one && hd >= one) { atomicAdd(&wm1s[M1Z_HAS_ALL], 1); }
      if (c.bat < 0.05) { atomicAdd(&wm1s[M1Z_EMPTY], 1); }
    }
    // step T1a: the tissues' census: cells by their free sides (rim vs inside: battery, integrity, free t), the contacts and their kinship,
    // the kin genes (the sides pressed against a neighbour, whether or not the inside is on)
    {
      let cm = cover_mask(c, i);
      let nf = 6u - countOneBits(cm);
      let bin = select(select(select(3u, 2u, nf <= 4u), 1u, nf <= 2u), 0u, nf == 0u);
      atomicAdd(&wt1s[T1Z_N], 1);
      atomicAdd(&wt1s[T1Z_FREE], i32(nf));
      atomicAdd(&wt1s[T1Z_BIN + bin], 1);
      atomicAdd(&wt1s[T1Z_BAT + bin], i32(round(c.bat * 1000.0)));
      atomicAdd(&wt1s[T1Z_INTEG + bin], i32(round(im * 1000.0)));
      atomicAdd(&wt1s[T1Z_TIN + bin], i32(round(f32(max(atomicLoad(&stock[i * SW + 1u]), 0)) / ATOM_SCALE * 1000.0)));
      let fsv = bitcast<f32>(flux[i * SW + 39u]);
      atomicAdd(&wt1s[T1Z_FS], i32(round(select(1.0, clamp(fsv, 0.0, 1.0), (t1_flags() & T1F_INSIDE) != 0u) * 1000.0)));
      let gk = clamp(b.kin.x, 0.0, 1.0);
      let gd = clamp(b.mark.w, 0.0, 1.0);
      atomicAdd(&wt1s[T1Z_GK], i32(round(gk * 1000.0)));
      atomicAdd(&wt1s[T1Z_GK2], i32(round(gk * gk * 1000.0)));
      atomicAdd(&wt1s[T1Z_GT], i32(round(clamp(b.kin.y, 0.0, 1.0) * 1000.0)));
      atomicAdd(&wt1s[T1Z_GD], i32(round(gd * 1000.0)));
      atomicAdd(&wt1s[T1Z_GD2], i32(round(gd * gd * 1000.0)));
      if (gk > 0.25) { atomicAdd(&wt1s[T1Z_KC], 1); }
      for (var k = 0u; k < 6u; k++) {
        if ((cm & (1u << k)) == 0u) { continue; }
        let j = cell_nbr(c, k);
        if (j <= i || nbr_side(c.nbr, j) != k || nbr_side(cells[j].nbr, i) >= 6u) { continue; }
        let mt = kin_match_m(bio_mark(i), bio_mark(j), 0.5 * (c.r + cells[j].r) / EP.R);   // (step T1b: as the channels see it)
        let ai = kin_accept(mt, b.kin.y);
        let aj = kin_accept(mt, bio[j].kin.y);
        atomicAdd(&wt1s[T1Z_CON], 1);
        atomicAdd(&wt1s[T1Z_KIN], i32(round(mt * 1000.0)));
        if (ai > 0.5 && aj > 0.5) { atomicAdd(&wt1s[T1Z_ACC], 1); }
        if (mt < 0.1) { atomicAdd(&wt1s[T1Z_STR], 1); }
        atomicAdd(&wt1s[T1Z_OPEN], i32(round(min(bio_kin_open(i) * ai, bio_kin_open(j) * aj) * 1000.0)));
      }
    }
    // step C12e: the waste census (osmosis, who makes and who takes in the free t, the two stretch genes)
    atomicAdd(&wws[WZ_N], 1);
    atomicAdd(&wws[WZ_P], i32(round(clamp(c.osmP, -100.0, 100.0) * 1000.0)));
    atomicAdd(&wws[WZ_W], i32(round(clamp(c.osm, -10.0, 10.0) * 1000.0)));
    if (c.osm > 0.1) { atomicAdd(&wws[WZ_UP], 1); }
    if (c.osm < -0.1) { atomicAdd(&wws[WZ_DOWN], 1); }
    let tmd = atomicLoad(&stock[i * SW + W_TMADE]);
    let tim = atomicLoad(&stock[i * SW + W_TIMP]);
    let one = i32(ATOM_SCALE);
    if (tim > one) { atomicAdd(&wws[WZ_IMP], 1); }
    if (tim < -one) { atomicAdd(&wws[WZ_EXP], 1); }
    var brt = false;
    for (var k = 0u; k < 3u; k++) {
      let E = eng_at(b.eng[k]);
      brt = brt || (b.rate[k] > 0.0 && E.kind != 0u && (E.ch.x == 1u || E.ch.y == 1u));
    }
    if (brt) {
      atomicAdd(&wws[WZ_BR], 1);
      if (tim > one && tim > tmd) { atomicAdd(&wws[WZ_OUTB], 1); }
      else if (tmd > one && tmd >= max(tim, 0)) { atomicAdd(&wws[WZ_SELFB], 1); }
    }
    atomicAdd(&wws[WZ_GCH], i32(round(b.lip.w * 1000.0)));
    atomicAdd(&wws[WZ_GCH2], i32(round(b.lip.w * b.lip.w * 1000.0)));
    atomicAdd(&wws[WZ_GTOL], i32(round(b.gate2.z * 1000.0)));
    atomicAdd(&wws[WZ_GTOL2], i32(round(b.gate2.z * b.gate2.z * 1000.0)));
    atomicAdd(&wws[WZ_IONS], i32(round(clamp(bitcast<f32>(flux[i * SW + 31u]), 0.0, 1e4) * 1000.0)));
    atomicAdd(&wws[WZ_K], i32(round(select(memb_stiff(gm, EP.mb3.w), ks, (lp_flags() & LPF_ON) != 0u) * 1000.0)));
    // step C12g: the ion flow's census (the channel genes, the levels they give, what the membrane passes of each sign now)
    {
      let selI = (mb_flags() & MBF_SEL) != 0u;
      let chI = ion_chan(b.gate2.w, b.memb.w, selI);
      atomicAdd(&wio[IZ_N], 1);
      atomicAdd(&wio[IZ_G], i32(round(b.gate2.w * 1000.0)));
      atomicAdd(&wio[IZ_G2], i32(round(b.gate2.w * b.gate2.w * 1000.0)));
      atomicAdd(&wio[IZ_S], i32(round(b.memb.w * 1000.0)));
      atomicAdd(&wio[IZ_S2], i32(round(b.memb.w * b.memb.w * 1000.0)));
      atomicAdd(&wio[IZ_CAT], i32(round(min(chI.x, 100.0) * 1000.0)));
      atomicAdd(&wio[IZ_AN], i32(round(min(chI.y, 100.0) * 1000.0)));
      if (b.memb.w > 0.3) { atomicAdd(&wio[IZ_CSEL], 1); }
      if (b.memb.w < -0.3) { atomicAdd(&wio[IZ_ASEL], 1); }
      if (b.gate2.w > 1.0) { atomicAdd(&wio[IZ_OPEN], 1); }
      if (b.gate2.w < -1.0) { atomicAdd(&wio[IZ_SHUT], 1); }
      var pc = 1.0;
      var pa = 1.0;
      if ((io_flags() & IOF_BLOCK) != 0u && (mb_flags() & MBF_ON) != 0u && (EP.flags & EF_EAT) != 0u) {
        var igm = 0.0;
        for (var k = 0u; k < 6u; k++) { igm += clamp(c.integ[k], 0.0, 1.0) / 6.0; }
        var soI = 0.0;
        if ((ws_flags() & (WSF_OSM | WSF_STRETCH)) == (WSF_OSM | WSF_STRETCH) && c.osm > 0.0) { soI = EP.ws[1].z * exp(b.lip.w) * c.osm; }
        pc = ((1.0 - igm) + igm * ion_open(chI, 1) + soI) / (1.0 + soI);
        pa = ((1.0 - igm) + igm * ion_open(chI, -1) + soI) / (1.0 + soI);
      }
      atomicAdd(&wio[IZ_PC], i32(round(pc * 1000.0)));
      atomicAdd(&wio[IZ_PA], i32(round(pa * 1000.0)));
      if (pc < 0.5 && pa < 0.5) { atomicAdd(&wio[IZ_TIGHT], 1); }
    }
    // step C7: the pumps' census (PS_* above)
    let gp = b.pump;
    var act = false;
    let fed = c.bat >= 0.3;
    for (var s = 0u; s < 2u; s++) {
      if (gp[2u + s] < PUMP_ACTIVE) { continue; }
      act = true;
      let pc = pump_ch(gp[s]);
      let bin = min(select(pc, 10u, pc == 12u), 10u) + select(0u, PUMP_NCH, pump_out(gp[s]));   // (PUMP_CH order)
      atomicAdd(&wpus[PS_GENE + bin], 1);
      if (fed) { atomicAdd(&wpus[PS_GENE_FED + bin], 1); }
      atomicAdd(&wpus[PS_RATE], i32(round(gp[2u + s] * 1000.0)));
    }
    atomicAdd(&wpus[PS_N], 1);
    if (act) { atomicAdd(&wpus[PS_ACT], 1); atomicAdd(&wpus[PS_BAT_ACT], i32(round(c.bat * 1000.0))); }
    else { atomicAdd(&wpus[PS_BAT_NONE], i32(round(c.bat * 1000.0))); }
    if (fed) { atomicAdd(&wpus[PS_FED], 1); if (act) { atomicAdd(&wpus[PS_FED_ACT], 1); } }
    let vc = clamp(c.volt, -1e4, 1e4);
    atomicAdd(&wpus[PS_AVOLT], i32(round(abs(vc) * 1000.0)));
    atomicAdd(&wpus[PS_VOLT], i32(round(vc * 1000.0)));
    if (abs(vc) > 0.1) { atomicAdd(&wpus[PS_VCELLS], 1); }
    atomicAdd(&wpus[PS_EV], evc >> 8u);
    // step C7b: the catalysts' census (the cofactor's factor as the eat pass works it out)
    let trc = f32(max(atomicLoad(&stock[i * SW + CP.trace]), 0)) / (ATOM_SCALE * max(3.14159265 * c.r * c.r / (EP.R * EP.R), 1e-3));
    let cf = cofactor(trc);
    atomicAdd(&wcat[CT_TR], i32(round(min(trc, 1000.0) * 1e6)));
    if (trc >= EP.cat.z) { atomicAdd(&wcat[CT_HAS], 1); }
    if (any(b.rate.xyz > vec3f(0.0))) {
      atomicAdd(&wcat[CT_N], 1);
      atomicAdd(&wcat[CT_F], i32(round(cf * 1000.0)));
      atomicAdd(&wcat[CT_BAT], i32(round(c.bat * 1000.0)));
      if (lit) { atomicAdd(&wcat[CT_NL], 1); atomicAdd(&wcat[CT_FL], i32(round(cf * 1000.0))); }
      if (fed) { atomicAdd(&wcat[CT_FED], 1); atomicAdd(&wcat[CT_FED_F], i32(round(cf * 1000.0))); }
    }
    // step C8: the hard light dose, in the light and in the dark
    let dz = i32(c.flags >> CELL_DOSE_SHIFT);
    if (lit) { atomicAdd(&whl[HL_NL], 1); atomicAdd(&whl[HL_DL], dz); }
    else { atomicAdd(&whl[HL_ND], 1); atomicAdd(&whl[HL_DD], dz); }
    if (EP.hl.z * f32(dz) / DOSE_SCALE >= 0.5) { atomicAdd(&whl[HL_HOT], 1); }
    var tp = false;
    for (var s = 0u; s < 2u; s++) { tp = tp || (gp[2u + s] >= PUMP_ACTIVE && pump_ch(gp[s]) == CP.trace && !pump_out(gp[s])); }
    if (tp) {
      atomicAdd(&wcat[CT_PUMP], 1);
      atomicAdd(&wcat[CT_PUMP_BAT], i32(round(c.bat * 1000.0)));
      atomicAdd(&wcat[CT_PUMP_TR], i32(round(min(trc, 1000.0) * 1e6)));
    }
  }
  workgroupBarrier();
  if (li < 16u) {
    let v = atomicLoad(&wcat[li]);
    if (v != 0) { atomicAdd(&hb[LG_CAT + 16u * li + (wid.x & 15u)], v); }
  } else if (li < 24u) {
    let v = atomicLoad(&whl[li - 16u]);
    if (v != 0) { atomicAdd(&hb[LG_HL + 16u * (li - 16u) + (wid.x & 15u)], v); }
  }
  for (var q = li; q < PU_SNAP; q += 64u) {
    let v = atomicLoad(&wpus[q]);
    if (v != 0) { atomicAdd(&hb[LG_PU + 16u * q + (wid.x & 15u)], v); }
  }
  if (li < 16u) {
    let v = atomicLoad(&wmbs[li]);
    if (v != 0) { atomicAdd(&hb[LG_MB + 16u * li + (wid.x & 15u)], v); }
    let w = atomicLoad(&wlps[li]);   // step C12b
    if (w != 0) { atomicAdd(&hb[LG_LIP_S + 16u * li + (wid.x & 15u)], w); }
  }
  if (li == 63u) { add64(LG_LIP_E + (wid.x & 63u), atomicLoad(&wle)); }   // step C12b: the lipids' energy
  if (li >= 16u && li < 32u) {   // step M1: the whole membranes' census
    let v = atomicLoad(&wm1s[li - 16u]);
    if (v != 0) { atomicAdd(&hb[LG_M1 + 16u * (li - 16u) + (wid.x & 15u)], v); }
  }
  if (li < 32u) {                // step T1a: the tissues' census
    let v = atomicLoad(&wt1s[li]);
    if (v != 0) { atomicAdd(&hb[LG_T1 + 16u * li + (wid.x & 15u)], v); }
  }
  if (li >= 32u && li < 48u) {   // step C12e: the waste census
    let v = atomicLoad(&wws[li - 32u]);
    if (v != 0) { atomicAdd(&hb[LG_WS + 16u * (li - 32u) + (wid.x & 15u)], v); }
  } else if (li >= 48u) {        // step C12g: the ion flow's census
    let v = atomicLoad(&wio[li - 48u]);
    if (v != 0) { atomicAdd(&hb[LG_IO + 16u * (li - 48u) + (wid.x & 15u)], v); }
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
  } else if (li == 30u || li == 31u) {
    // step C12c: the excited atoms in the stocks (64-bit)
    let L = atomicLoad(&wlo[li - 16u]);
    let H = atomicLoad(&whi[li - 16u]);
    let at = LG_EXC_K + 128u * (li - 30u) + slot;
    add64v(at, i32(H >> 16u), H << 16u);
    add64v(at, 0, L);
  }
}

// ---------- reset (a new culture) ----------
@compute @workgroup_size(64)
fn reset(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let i = id.x;
  let slot = wid.x & 63u;
  if (i < arrayLength(&cells)) {   // (not S.count: a reset can run before the first tick has written a Sim slot)
    give_back(i, cells[i].pos, EP.resetCur, slot);
    if (i < EP.dv.x) {   // step C9: only the slots the new culture fills (the rest stay free)
      atomicStore(&stock[i * SW + BAT], EP.starter);
      add64(LG_K_START + slot, EP.starter);
      cb_found(i, EP.R, slot);   // step C15b: a founder's body (a full one for a cell of radius R)
    }
  }
  flush_counters(li, slot);
}
