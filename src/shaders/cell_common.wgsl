// ===== cell_common.wgsl: the cells' state, the simulation uniforms and the neighbour grid =====
// Not compiled on its own: src/cells.js prepends field_common.wgsl and then this file to every cell shader.
//
// Cells live in a fixed-capacity storage buffer (struct Cell, 240 bytes; keep in step with CELL_* in
// src/cells.js, and CELL_FLOATS in heat.wgsl). Their order never changes, so drawing order is stable and a cell keeps its index.
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
  flags: u32,       // bit 0: alive; bit 1: converted (step 6, rule 2); bits 8..15: leak level 0..255 (step 6,
                    // rule 1), written by the step pass for the drawing and the census; bits 16..17: the state's
                    // offset from the key angle's bin (step 7, rule 2: a crowded cell flips its state)
  seed: u32,        // per-cell random seed
  aux: f32,         // the cell's key scale (log of its lattice period factor; a copy of Bio.key.y)
  z: vec2f,         // step 8: the phasor the cell emits field A and its partner A' with: (1, 0) = field A as in steps 4 to
                    // 7; its angle shifts the cell's pinned beat (A turns into A' at 90 degrees), its length scales it
  // ---- step C5, cells eat (the stock and the battery themselves live in their own buffer, cell_eat.wgsl) ----
  dead: vec2f,      // where the cell that died in this slot this tick was (with CELL_BORN; its stock goes back there)
  bat: f32,         // the battery as a share of its capacity, 0..1 (written by the eat pass; read by the step's crawl and
                    // turnover, and by the drawing)
  pay: i32,         // what this tick's crawling costs the battery (heat counts; the step works it out, the eat pass pays)
  mom: u32,         // a newborn's parent (its index in `cells`), with CELL_BORN
  fill: f32,        // how full the cell's stock is, as a share of its capacity (eat pass; for the overlay)
  smell: vec2f,     // the fuel gradient its membrane's corners smelled (eat pass, plan; energy per R^2 per R), which
                    // the next tick's step steers by
  // ---- step C6b, charge (written by the eat pass) ----
  q: f32,           // the cell's charge as field B uses it: tanh(its stock's net charge / qHalf), -1..1
  qNet: f32,        // its stock's net charge (atom-units: givers minus takers)
  efield: vec2f,    // the gradient of the substrate's screened potential across its membrane (plan; phi per R), which the
                    // next tick's step pushes it by (x -q)
  // ---- step C6c, elastic honeycomb cells: the outline as 6 corners (valid while flags has CELL_HEX) ----
  // Corner k sits at distance rad[k] from the centre in the direction theta + k x 60 degrees + alpha[k]; side k runs from
  // corner k to corner k + 1 (the membrane's segment k). Written by the step pass only (cell_step.wgsl, "honeycomb").
  rad: array<f32, 6>,   // each corner's distance from the centre (CSS px)
  radV: array<f32, 6>,  // ... and its speed (CSS px / s; the corners are underdamped springs, so a pushed cell wobbles)
  theta: f32,       // the hexagon's orientation (radians, 0..2 pi): the direction of corner 0
  spin: f32,        // ... and its turning rate (rad / s), driven by the contacts (a side turns to face each neighbour)
  ea: vec2f,        // the active stretch the rest shape follows (motion, the field's pull, muscle; as e1, e2 in the old
                    // ellipse cells); e1, e2 themselves are then worked out from the corners (their second moment)
  alpha: array<f32, 6>, // each corner's slide round from its regular direction theta + k x 60 degrees (radians, at most
                    // HEX_SLIDE), toward the corner of its tile, so a cell with 5 or 7 neighbours still shares straight walls
  // per side: side k = the side from corner k to corner k + 1
  integ: array<f32, 6>, // C6c, membrane chemistry: each side's integrity, 0..1 (its linker material / what the genes ask
                    // for; written by the eat pass every tick, 1 while the membrane chemistry is off), read by the step
                    // (a damaged side is softer) and the drawing (a damaged side's tube dims and breaks)
  sideQ: array<f32, 6>, // step C6d, charge per side: each side's share of the cell's charge (atom-units; written by the eat pass,
                    // which keeps their sum equal to the stock's net charge qNet, and turned within the cell by the step: see
                    // "dipoles" below). A neutral cell can still be polarised: + on one side, - on the other
};

// Step C6c: the part of a cell its neighbours read, the grid's sorted copy (cell_grid.wgsl scatter; 112 bytes, keep in step
// with CELL_CORE_BYTES in src/cells.js): Cell without the honeycomb outline and the per-side slots, so the step's neighbour
// loop reads little more memory than before the Cell grew (a cell reads its own outline from its own slot in `cells`).
// Step C6d: plus the cell's DIPOLE (dip: its saturated dipole vector, from its side charges, worked out once per tick by the
// scatter), which is all a neighbour needs of the six side charges
struct CellCore {
  pos: vec2f, vel: vec2f, r: f32, la: f32, e1: f32, e2: f32, kind: u32, flags: u32, seed: u32, aux: f32, z: vec2f,
  dead: vec2f, bat: f32, pay: i32, mom: u32, fill: f32, smell: vec2f, q: f32, qNet: f32, efield: vec2f, dip: vec2f,
};
fn cell_core(c: Cell, dip: vec2f) -> CellCore {
  return CellCore(c.pos, c.vel, c.r, c.la, c.e1, c.e2, c.kind, c.flags, c.seed, c.aux, c.z,
                  c.dead, c.bat, c.pay, c.mom, c.fill, c.smell, c.q, c.qNet, c.efield, dip);
}

const CELL_ALIVE: u32 = 1u;
const CELL_CONV: u32 = 2u;          // converted (step 6, rule 2): emits field B more strongly or with flipped sign
const CELL_LEAK_SHIFT: u32 = 8u;    // bits 8..15: leak level x 255 (step 6, rule 1)
const CELL_FLIP_SHIFT: u32 = 16u;   // bits 16..17: state offset 0..3 (step 7, rule 2)
const CELL_BORN: u32 = 4u;          // step C5: born this tick (the step sets it; the eat pass hands the dead cell's stock
                                    // back to the dish, gives the newborn half its parent's, and clears it)
const CELL_HEX: u32 = 8u;           // step C6c: the cell's outline is its 6 corners (rad, theta); else the stretched hexagon
                                    // of the ellipse cells (set and cleared by the step pass, as the honeycomb rule is on)
// step C6c, membrane chemistry (cell_eat.wgsl): bits 4..7 count the ticks since the cell BURST (0: it has not; the eat pass
// sets 1 when it bursts and spills everything, the step counts up and lets a neighbour divide into the slot at
// BURST_TICKS; the drawing shows the flash meanwhile); bit 18: its membrane has been WHOLE (mean integrity 0.5 or more)
// since it was born, or its parent's had (it got real sides from it at the split): only such a membrane can burst (one never
// built cannot)
const CELL_BURST_SHIFT: u32 = 4u;
const CELL_BURST_MASK: u32 = 0xf0u;
const BURST_TICKS: u32 = 12u;
const CELL_WHOLE: u32 = 0x40000u;
fn cell_burst(flags: u32) -> u32 { return (flags & CELL_BURST_MASK) >> CELL_BURST_SHIFT; }
fn cell_leak(c: Cell) -> f32 { return f32((c.flags >> CELL_LEAK_SHIFT) & 255u) / 255.0; }

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
  jitter: f32,      // Brownian kick per tick, full width, in units of R (only while the heat kicks are off, Shift+H)
  pull: f32,        // gentle pull to the dish centre (1/s)
  wall: f32,        // soft wall stiffness (1/s)
  pointer: vec2f,   // stir position (CSS px)
  pvel: vec2f,      // stir velocity (CSS px / s); zero when not stirring
  stirR2: f32,      // stir reach squared (CSS px^2)
  stir: f32,        // stir gain
  drift: f32,       // slow drift of the medium, in units of R per s (0.5 = reference)
  time: f32,        // simulation time (s)
  rules: u32,       // RULE_* bits: which genome rules are on
  flip: f32,        // step 7, rule 2: chance per s that a cell crowded by its own state flips (0 = off)
  heatCur: u32,     // step C1: word offset of the current heat copy in the heat buffer this tick (heat_common.wgsl)
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
  engJump: f32,     // step C6: chance per birth that one engine slot jumps (another reaction or pigment band, or empty)
                    // (42..45 held the nutrient and threat numbers until step C3)
  hexSize: f32,     // step C6c: a honeycomb cell's area at rest, as a share of pi r^2
  matterCur: u32,   // step C5: word offset in the heat buffer of the substances' current copy (channel 0) this tick; 0 =
                    // no substance grid
  hexTurnDamp: f32, // step C6c: how fast the hexagon's turning is damped (1/s)
  // ---- the loop (step 4): cells emit into the field and feel it on their membrane ----
  lever: f32,       // how different the cells' lattices are from the medium's (1 = the keys as they are;
                    // smaller = closer to the medium, so longer and slower beats)
  emit: f32,        // cells' emission strength (0 = cells do not emit)
  r0: f32,          // a cell's envelope range r0, in units of R (reference 2.2)
  cut: f32,         // how far a cell feels another's field, in units of R (reference 3.6)
  sense: f32,       // gain of the force from the other cells' field felt on the membrane (0 = off; 1 = reference)
  tuneW: f32,       // receptor tuning width: how alike two lattices must be to feel each other (reference 0.177)
  hexBulge: f32,    // step C6c: how far free corners may grow to keep the area when sides are pressed flat (x their rest)
                    // (word 52 held the sources' strength until step C3)
  senseMax: f32,    // the field force saturates at this speed, in units of R per s (reference 3)
  activeGain: f32,  // active deformation gain: stretch along the cell's motion and the field's pull (0 = off)
  shapeRate: f32,   // how fast the shape follows its target (1/s; reference 3)
  anchor: u32,      // where a cell's beat is anchored (key X): 0 = its lattice at the cell, so the moire slides
                    // as the cell moves (the reference); 1 = the beat pattern pinned to the cell, bright at its
                    // centre; 2 = its lattice anchored at the dish centre like the medium's, so the moire stands
                    // still in the world and only the envelope moves with the cell
  hexSnap: f32,     // step C6c: a neighbour's wall up to this x a corner's rest distance draws the corner out to it (the
                    // gap between touching cells closes); further, the corner stays free (word 57: the sources' sensing gain
                    // until step C3)
  receptor: u32,    // tuning toward other cells (key R): 0 = by the cell's own lattice (like feels like, the
                    // reference); 1 = by its genome's receptor (angle, period, width), so A may feel B but not back
  // ---- step 7: exclusion. Cells of the same type (fate) in the same state (their lattice angle, cut into
  // `states` bins, like spin up / down) keep a gap; cells of the same type in different states pack closer ----
  excl: f32,        // how hard same-state cells push apart, x the contact push (0 = exclusion off)
  exclReach: f32,   // ... out to this distance, x the contact distance r_i + r_j (1 = plain contact)
  pack: f32,        // cells of the same type in different states push apart only below pack x the contact distance
  states: u32,      // number of states (2..4): the key angle's 60 degrees cut into this many bins
  xCount: u32,      // 1 = this tick counts neighbour pairs by state for the census (Stats.xPairs)
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
// Every cell carries a Bio record (128 bytes; keep in step with BIO_* in src/genome.js): its genome plus its
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
  env: vec4f,       // state: x y spare (the nutrient and threat felt, until step C3);
                    // z the A felt, through a leaky integrator; w > 0 converted (rule 2: 1; with the relay,
                    // rule 3: seconds converted so far), w < 0 resting (seconds left), 0 neither (step 6)
  conv: vec4f,      // state (step 6): x the converted share of the neighbourhood, through the same integrator
                    // (rule 3, relay); y z w spare
  // ---- step C6: engines and the genes of the membrane and the heat (src/genome.js; ENGINES in src/matter.js) ----
  eng: vec4f,       // x y z: the three engine slots, each the engine's index + 32 x its pigment's light band (a whole number);
                    // w: the heat tolerance (temperature, heat per R^2)
  rate: vec4f,      // x y z: each slot's rate (0 = empty); w: the permeability (per s, for the light atoms)
  // ---- step C6c: the membrane's material and the ion selectivity (src/genome.js, cell_eat.wgsl) ----
  memb: vec4f,      // x MIX: the heavy linkers' (L) share of the membrane, 0..1 (the rest light, l); y THICKNESS: linker per
                    // R of membrane (atom-units); z the STIFFNESS gene (x the stiffness the material gives); w the ION
                    // SELECTIVITY s, -1..1: givers (+) pass the membrane x (1 + s), takers (-) x (1 - s)
};
// step C6c: the honeycomb stiffness a membrane's material gives (genetic elasticity): heavy and thick = stiff, light and thin
// = soft; 1 for the founders' usual light thin membrane (mix 0.1, thickness tRef)
fn memb_stiff(m: vec4f, tRef: f32) -> f32 {
  return clamp((0.7 + clamp(m.x, 0.0, 1.0)) / 0.8 * sqrt(max(m.y, 1e-4) / max(tRef, 1e-4)) * m.z, 0.25, 4.0);
}
const ENG_RATE_MAX: f32 = 6.0;     // largest rate of an engine slot
const ENG_COUNT: u32 = 20u;        // engines in ENGINES (src/matter.js)
fn eng_index(code: f32) -> u32 { return min(u32(round(max(code, 0.0))) & 31u, ENG_COUNT - 1u); }
// the slot's band: 1..3 a pigment for that light band (visible 1, visible 2, hard), 0 none (an uphill engine is then a storer)
fn eng_band(code: f32) -> u32 { return min(u32(round(max(code, 0.0))) >> 5u, 3u); }

const KEY_SPAN: f32 = 1.0471975512;   // key angles live in [0, 60 degrees)
const KEY_SMAX: f32 = 0.15;           // key scales live in [-0.15, 0.15]

// step 7: a cell's state, 0 .. n-1: which of n equal bins of the hex lattice's 60 degrees its lattice angle lies in,
// shifted by its flip offset (rule 2; 0 at birth). The offset changes the state, not the lattice, so a flipped cell
// keeps its key, its adhesion and its field.
// (step C6c: by the lattice angle la and the flags, so it works on a Cell and on its neighbours' CellCore alike)
fn key_bin(la: f32, n: u32) -> u32 {
  let m = max(n, 1u);
  return min(u32(fract(la / KEY_SPAN) * f32(m)), m - 1u);
}
fn cell_state(la: f32, flags: u32, n: u32) -> u32 {
  return (key_bin(la, n) + ((flags >> CELL_FLIP_SHIFT) & 3u)) % max(n, 1u);
}

// rule bits in Sim.rules (keep in step with RULE in src/cells.js)
const RULE_DIFF: u32 = 1u;      // differentiation (contact signalling, accumulators, commitment)
const RULE_ADH: u32 = 2u;       // adhesion
const RULE_TURN: u32 = 4u;      // turnover
const RULE_MUT: u32 = 8u;       // mutation at birth
const RULE_INHERIT: u32 = 16u;  // a newborn keeps its parent's fate (else it starts as stem)

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
  heatDeaths: atomic<u32>,            // step C5: of the deaths, those from heat damage (cumulative)
  xPairs: array<atomic<u32>, 4>,      // step 7 (cleared every frame, counted on its last tick): neighbour pairs of the
                                      // same type within 1.6 x contact distance: [0] all, [1] of the same state;
                                      // touching (within reach x contact distance): [2] all, [3] of the same state
  events: array<vec4f, 64>,           // x, y, +1 birth / -1 death, 0
  bins: array<atomic<u32>, 144>,      // census: cells per key bin
  founders: array<atomic<u32>, 1632>, // census: bit set = that founder line still has cells
  extra: array<atomic<u32>, 80>,      // census (step 6): see STATS_X_* below
  dip: array<atomic<u32>, 16>,        // step C6d (cleared every frame, counted on its last tick): STATS_D_* below; signed sums
                                      // are added as i32 bits (two's complement) and read back as Int32
};
// step C6d census counters in Stats.dip (pairs of touching neighbours both polarised, |d| above DIP_MIN, counted from both sides)
const STATS_D_PAIRS: u32 = 0u;      // such pairs
const STATS_D_COS: u32 = 1u;        // ... sum of cos(angle between their dipoles) x 1000 (polar order; random: 0)
const STATS_D_HTT: u32 = 2u;        // ... sum of (d_i . n)(d_j . n) / (|d_i| |d_j|) x 1000, n the line between them (head-to-tail
                                    // along the line: +1, side by side: 0, head-to-head: -1; random: 0)
const STATS_D_POL: u32 = 3u;        // cells polarised (|d| above DIP_MIN)
const STATS_D_SUM: u32 = 4u;        // sum of |d| x 1000 over all cells
const STATS_D_MID: u32 = 5u;        // cells with two or more head-to-tail bonds (inside a thread)
const STATS_D_END: u32 = 6u;        // cells with exactly one (a thread's end, or a pair)
const STATS_D_EDD: u32 = 7u;        // sum of |the neighbours' dipole field| x 1000 (polarised cells)
const STATS_D_EPHI: u32 = 8u;       // sum of |the substrate's field, saturated| x 1000 (polarised cells)
const STATS_D_ALIGN: u32 = 9u;      // sum of cos(dipole, total field) x 1000 (polarised cells feeling a field above 0.05)
const STATS_D_NALIGN: u32 = 10u;    // ... those cells
const STATS_D_STR: u32 = 11u;       // sum of |the stretch target the field adds| x 1000
const STATS_D_ALL: u32 = 12u;       // cells counted
const DIP_MIN: f32 = 0.2;
const DIP_BOND: f32 = 0.5;          // a head-to-tail bond: (d_i . n)(d_j . n) and d_i . d_j (unit vectors) both above this
// step 6 census counters in Stats.extra
const STATS_X_LEAK: u32 = 0u;       // cells leaking (leak level above 0.25)
const STATS_X_CONV: u32 = 1u;       // converted cells
const STATS_X_AHIST: u32 = 2u;      // 48 bins: the A a cell feels (its integrator), 0.2 wide from 0 (below 0 in bin 0)
const STATS_X_ABINS: u32 = 48u;
const STATS_X_AW: f32 = 0.2;
const STATS_X_SHIST: u32 = 50u;     // 10 bins: stretch length, 0.05 wide (0 .. 0.5)
const STATS_X_LHIST: u32 = 60u;     // 10 bins: leak level, 0.1 wide
const STATS_X_STATE: u32 = 70u;     // step 7: 4 bins, cells per state

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
fn mutate(p: Bio, seed: u32, size: f32, jump: f32, engJump: f32) -> Bio {
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
  // step C6: the engines' rates (an empty slot stays empty), the tolerance and the permeability, nudged (multiplicative)
  for (var k = 0u; k < 3u; k++) {
    if (b.rate[k] > 0.0) { b.rate[k] = clamp(b.rate[k] * exp(size * 0.1 * gauss(seed, 110u + k)), 0.02, ENG_RATE_MAX); }
  }
  b.eng.w = clamp(b.eng.w * exp(size * 0.04 * gauss(seed, 114u)), 3.0, 60.0);
  b.rate.w = clamp(b.rate.w * exp(size * 0.08 * gauss(seed, 115u)), 0.2, 20.0);
  // step C6c: the membrane's mix (additive), thickness and stiffness gene (multiplicative) and the ion selectivity (additive)
  b.memb.x = nudge(b.memb.x, size * 0.03, 0.0, 1.0, seed, 116u);
  b.memb.y = clamp(b.memb.y * exp(size * 0.08 * gauss(seed, 117u)), 0.002, 0.2);
  b.memb.z = clamp(b.memb.z * exp(size * 0.05 * gauss(seed, 118u)), 0.3, 3.0);
  b.memb.w = nudge(b.memb.w, size * 0.03, -1.0, 1.0, seed, 119u);
  // ... and now and then one slot jumps: to another engine (an empty slot starts up at a small rate), to another pigment
  // band (or none: an uphill engine then runs on the battery, a storer), or it empties
  if (rand01(seed, 120u) < engJump) {
    let k = min(u32(rand01(seed, 121u) * 3.0), 2u);
    let u = rand01(seed, 122u);
    let v = rand01(seed, 123u);
    let e = eng_index(b.eng[k]);
    let band = eng_band(b.eng[k]);
    if (u < 0.45) {
      b.eng[k] = f32(min(u32(v * f32(ENG_COUNT)), ENG_COUNT - 1u) + 32u * band);
      if (b.rate[k] <= 0.0) { b.rate[k] = 0.4 + rand01(seed, 124u); }
    } else if (u < 0.75) {
      b.eng[k] = f32(e + 32u * min(u32(v * 4.0), 3u));
    } else {
      b.rate[k] = 0.0;
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
fn cell_F(c: Cell) -> vec3f { return stretch_F(vec2f(c.e1, c.e2)); }
// ... from a stretch e = (e1, e2): F = exp([[e1, e2], [e2, -e1]]) (determinant 1: area kept)
fn stretch_F(e: vec2f) -> vec3f {
  let eps = length(e);
  if (eps < 1e-4) { return vec3f(1.0, 0.0, 1.0); }
  let ch = cosh(eps);
  let sh = sinh(eps) / eps;
  return vec3f(ch + sh * e.x, sh * e.y, ch - sh * e.x);
}

// ---------- the loop (step 4): emitting, sensing, deforming ----------
// EMW of the reference: how a cell of fate `fate` responds to the field of an emitter of kind `kind`
// (positive = moves toward the field's bright blobs, negative = away). Like fates attract, unlike repel a
// little; neurons barely care. (The reference's nutrient and threat rows went with the sources in step C3.)
fn emw(fate: u32, kind: u32) -> f32 {
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

// the 3 wavevectors of an unstrained lattice (angle, log period factor) as seen through the lever
fn lattice_k(angle: f32, logp: f32, lever: f32, k0: f32, m: i32) -> vec2f {
  let base = P3 * round(angle / P3);
  let a = base + lever * (angle - base) + f32(m) * P3;
  return k0 * exp(-lever * logp) * vec2f(cos(a), sin(a));
}

// ---------- step C6c: elastic honeycomb cells ----------
// The directions of a honeycomb cell's corners: corner k at theta + k x 60 degrees + alpha[k] (each corner may slide up to
// HEX_SLIDE round from its regular place, toward the corner of the tile its neighbours leave it)
const HEX_SLIDE: f32 = 0.42;     // radians (24 degrees): neighbouring corners stay at least 12 degrees apart
fn hex_dirs(c: Cell) -> array<vec2f, 6> {
  var u: array<vec2f, 6>;
  var al = c.alpha;
  for (var k = 0; k < 6; k++) {
    let a = c.theta + f32(k) * P3 + al[k];
    u[k] = vec2f(cos(a), sin(a));
  }
  return u;
}
// the corners relative to the centre (CSS px)
fn hex_corners(c: Cell) -> array<vec2f, 6> {
  var u = hex_dirs(c);
  var r = c.rad;
  for (var k = 0; k < 6; k++) { u[k] *= r[k]; }
  return u;
}
// a honeycomb cell's rest shape: its corners (directions u) on the ellipse of the stretch e (each at 1 / |F^-1 u|), the
// whole scaled to the area A0
fn hex_rest(e: vec2f, u: array<vec2f, 6>, A0: f32) -> array<f32, 6> {
  let F = stretch_F(e);                        // determinant 1, so F^-1 = [[fd, -fb], [-fb, fa]]
  var r: array<f32, 6>;
  for (var k = 0; k < 6; k++) {
    let v = vec2f(F.z * u[k].x - F.y * u[k].y, F.x * u[k].y - F.y * u[k].x);
    r[k] = 1.0 / max(length(v), 1e-6);
  }
  let s = sqrt(A0 / max(hex_area(r, u), 1e-9));
  for (var k = 0; k < 6; k++) { r[k] *= s; }
  return r;
}
// the area of the hexagon with corner distances r along the directions u (6 triangles of two neighbouring corners)
fn hex_area(r: array<f32, 6>, u: array<vec2f, 6>) -> f32 {
  var s = 0.0;
  for (var k = 0; k < 6; k++) {
    let a = u[k];
    let b = u[(k + 1) % 6];
    s += r[k] * r[(k + 1) % 6] * (a.x * b.y - a.y * b.x);
  }
  return 0.5 * s;
}

// A cell's membrane: 6 straight segments of its (stretched) outline (step C6c: of its honeycomb outline). mid = segment midpoint relative to the
// cell's centre; edge = the segment as a vector, going round in increasing angle, so (edge.y, -edge.x) is the
// outward normal times the segment's length.
struct Membrane {
  mid: array<vec2f, 6>,
  edge: array<vec2f, 6>,
};

fn membrane(c: Cell) -> Membrane {
  var P: array<vec2f, 6>;
  if ((c.flags & CELL_HEX) != 0u) {
    // step C6c: the honeycomb cell's real outline, its 6 corners
    P = hex_corners(c);
  } else {
    let F = cell_F(c);
    for (var a = 0; a < 6; a++) {
      let t = f32(a) * P3;
      let u = vec2f(cos(t), sin(t));
      P[a] = c.r * vec2f(F.x * u.x + F.y * u.y, F.y * u.x + F.z * u.y);
    }
  }
  var mb: Membrane;
  for (var a = 0; a < 6; a++) {
    let nx = P[(a + 1) % 6];
    mb.mid[a] = 0.5 * (P[a] + nx);
    mb.edge[a] = nx - P[a];
  }
  return mb;
}

// Step C6d: a cell's dipole from its side charges: p = sum_k sideQ[k] x (side k's middle - centre) / r (atom-units; the
// sides' middles relative to the centre, in units of the radius, so a big and a small cell holding the same charges have
// the same dipole), and its saturated form d = p / |p| x tanh(|p| / pHalf) (length 0..1), as the rules use it
fn cell_dipole_raw(c: Cell, mb: Membrane) -> vec2f {
  var p = vec2f(0.0);
  let sq = c.sideQ;
  for (var k = 0; k < 6; k++) { p += sq[k] * mb.mid[k]; }
  return p / max(c.r, 1e-3);
}
fn dip_sat(p: vec2f, pInv: f32) -> vec2f {
  let m = length(p);
  if (m < 1e-9) { return vec2f(0.0); }
  return p * (tanh(m * pInv) / m);
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

// ---------- the fields (step 5): A and B, separate sums in separate lattice bands ----------
// Field A is the loop's field (step 4): the cell's lattice near the medium's period. Field B is a second field
// in its own band: every lattice involved (the cell's and the medium's) is `bBand` times longer, so A and B
// make no slow beat with each other; it reaches further (power law from a larger r0) and has its own sign rule.
// Each fate carries a charge per field: how strongly it emits into that field and listens to it.
// Written once per frame by src/cells.js (writeFields; keep in step); a 320-byte buffer (256 until step C6c, 288 until C6d).
struct Fields {
  qA: vec4f,        // field A charge per fate: stem, epithelium, muscle, neuron (1 = as in step 4)
  qB: vec4f,        // field B charge per fate (signed: like charges repel, when bSign = 1)
  q4: vec2f,        // cartilage's charges (A, B)
  bBand: f32,       // B's lattice period, in units of the medium's period (its band)
  bLever: f32,      // as Sim.lever, for B's lattices
  bR0: f32,         // B's envelope range r0, in units of R
  bCut: f32,        // how far B reaches (sensed and drawn), in units of R
  bGain: f32,       // gain of the force from B (0 = cells do not feel B)
  bSat: f32,        // B's force saturates at this speed, in units of R per s
  bSign: f32,       // +1: like repels like; -1: like attracts like
  bLike: u32,       // what "like" means: 0 = by charge (the fates' signed charges multiply), 1 = by key (lineage)
  bLikeW: f32,      // lineage likeness width (Gaussian in the key difference, as adhSigma)
  bReach: u32,      // neighbour block radius in grid cells that covers bCut (1 = the usual 3 x 3)
  bEmit: f32,       // 1 = cells emit into B, 0 = not
  bStrain: f32,     // how much the cell's stretch strains its B lattice (1 = fully, as field A; 0 = not at all)
  // ---- step 6: where the fields meet, in the cells ----
  leak: f32,        // rule 1, leak by deformation: strength of the A emission that lands in B's band (0 = off)
  leakW: f32,       // how close the strained A lattice must come to B's band (Gaussian width in the beat
                    // wavevector, in units of the medium's wavenumber)
  conv: f32,        // rule 2, conversion A -> B: how much more B a converted cell emits (0 = off)
  convMode: u32,    // 0 = a converted cell emits B x (1 + conv); 1 = its B charge flips sign (x conv)
  convOn: f32,      // the A felt (leaky integrator) above which a cell converts
  convOff: f32,     // ... and below which it converts back (hysteresis)
  convTau: f32,     // the integrator's time constant (s)
  relay: f32,       // rule 3, relay through B: how much the B of converted neighbours adds to the trigger (0 = off;
                    // then a converted cell also tires after relayOn s and rests relayRest s before it can convert)
  relayOn: f32,     // how long a cell stays converted when the relay is on (s)
  relayRest: f32,   // how long it then cannot convert again (refractory, s)
  // ---- step 8: the partner A' of field A (the same pinned beat a quarter period out of step: the sin twin) ----
  pGain: f32,       // rule a: gain of the push along the pair's phase current (0 = off)
  pSat: f32,        // ... saturating at this speed, in units of R per s
  pEps: f32,        // ... the current is divided by |A|^2 + |A'|^2 + pEps^2 (so a cell near a zero of both is not flung)
  pOn: u32,         // 1 = the partner is worked out in the step (any step 8 rule on)
  pSgn1: f32,       // the middle wave's direction in the partner: 1 = arrow (all three one way), -1 = symmetric
  // rule b, change makes the partner. Mode 0, felt change: a cell emits A' in proportion to the rate of change of the
  // A it feels, and A in proportion to the rate of change of the A' it feels (its phasor z = (1 + chSign x chGain x
  // dA'/dt, chGain x dA/dt)). Mode 1, clock: inside the cell a change of A makes A' and a change of A' makes -A, so its
  // phasor turns at chOmega (a clock hand); the pair it feels pulls its hand toward the neighbours' (chGain rad/s)
  chGain: f32,      // mode 0: s; mode 1: the pull, rad/s (0 = rule off)
  chTau: f32,       // the phasor follows its target with this time constant (s)
  chMax: f32,       // mode 0: ... and stays within chMax of (1, 0) (soft cap)
  chSign: f32,      // mode 0: the sign of "change of A' makes A" (-1: as Faraday's law, the pair turns; +1: grows)
  chMode: u32,      // 0 = felt change, 1 = clock
  chOmega: f32,     // mode 1: the clock's rate (rad/s)
  chLag: f32,       // mode 1: the hand is pulled toward the neighbours' hand turned back by this much (rad)
  // rule c, sideways push: the partner pushes at right angles. Mode 0: the force the partner A' makes on the membrane
  // (as field A's, from its gradient), turned 90 degrees, so cells go round the partner's blobs instead of up them.
  // Mode 1: perpendicular to the cell's own motion, by the A' it feels (as a charge in a magnetic field), so paths curl
  side: f32,        // gain (0 = off); mode 0: x field A's force; mode 1: turning rate per tick at full A'
  sideMode: u32,
  hexOn: u32,       // step C6c: 1 = elastic honeycomb cells (the outline is 6 springy corners), 0 = the old ellipse cells
  // ---- step C5, cells eat: what the step needs (the eat pass has its own uniform, cell_eat.wgsl) ----
  eat: u32,         // bits: EAT_PAY battery pays the crawl, EAT_HEAT heat damage, EAT_BIAS energy-biased turnover,
                    // EAT_SMELL smell (all 0 while "cells eat" is off)
  crawlFull: f32,   // battery share at and above which a cell crawls at full speed (below: in proportion)
  crawlCost: f32,   // battery paid per unit of the crawl's work (the rest of the work comes in from outside, as before)
  tol: f32,         // heat damage: the temperature (heat per R^2) a cell tolerates
  heatKill: f32,    // ... extra deaths per s x (temperature / tol - 1) above it, at most heatKill
  bias: f32,        // energy-biased turnover: a neighbour's weight as parent = bias + its battery share
  smell: f32,       // smell: crawl speed up the fuel gradient at a strong gradient (R / s, x motility, x the battery's gate)
  smellHalf: f32,   // ... the fuel gradient (energy per R^2 per R) at which the steering is tanh(1) of full
  // ---- step C6b, charge (src/charge.js) ----
  qFeel: f32,       // cells feel the substrate's charge field: speed = qFeel x q x (-grad phi) (R / s per phi per R; 0 = off)
  qStock: u32,      // 1: a cell's charge in field B is qB x its Cell.q (from its stock); 0: the fixed charge of its fate
  qStockB: f32,     // ... x this (the fixed per-fate charges are about 1)
  qSat: f32,        // the grid's push saturates at this speed (R / s)
  hex: vec4f,       // step C6c: x the corners' spring (omega^2, 1/s^2), y their damping (1/s), z the contacts' turning pull on
                    // the hexagon (1/s^2), w jelly: how much the corners lag the centre's change of velocity (0 = rigid)
  // ---- step C6c, membrane chemistry (src/membrane.js) ----
  memb: vec4f,      // x bits: MB_ELASTIC genetic elasticity, MB_SOFT damaged sides are softer, MB_BURST bursting (with
                    // turnover); y the thickness at which a light membrane has stiffness 1 (memb_stiff); z a fully damaged
                    // side's stiffness, as a share of its intact one; w spare
  // ---- step C6d, charge per side: dipoles (src/dipole.js) ----
  dip0: vec4f,      // x bits DP_*; y 1 / pHalf (a dipole of pHalf atom-units x r is tanh(1) of full); z the dipole-dipole
                    // range (x the contact distance); w the torque's gain (rad / s^2 at full dipole and field)
  dip1: vec4f,      // x the dipole-dipole push (R / s at full dipoles touching); y ... saturating at (R / s); z the substrate's
                    // field: phi per R that gives tanh(1) of a full field; w the stretch along the field (x activeGain)
  dip2: vec4f,      // x the charges turn within the cell toward the field (rad / s at full torque); y the substrate field's
                    // weight in the field, against the neighbours' dipoles (1); z the field polarises the cell: the source of side
                    // charge along it (atom-units per s at a full field: dpRelax x polar x pHalf / 2.6); w spare
};
const DP_ON: u32 = 1u;       // dipoles (master): the side charges make a dipole (lean copy, drawing)
const DP_DD: u32 = 2u;       // dipole-dipole between near cells: torque (head-to-tail lines up), push (head-to-tail attract,
                             // side-by-side repel)
const DP_FIELD: u32 = 4u;    // the field turns and stretches cells: the torque (body and charges within) and the stretch
const MB_ELASTIC: u32 = 1u;
const MB_SOFT: u32 = 2u;
const MB_BURST: u32 = 4u;
const EAT_PAY: u32 = 1u;
const EAT_HEAT: u32 = 2u;
const EAT_BIAS: u32 = 4u;
const EAT_SMELL: u32 = 8u;
const EAT_TOLG: u32 = 16u;   // step C6: heat damage by each cell's own tolerance gene (else the global `tol`)
const FUEL_CH: u32 = 6u;   // the first fuel channel (gt, gT, Gt, GT: 6 .. 9; src/matter.js SUBSTANCES)

// Step 8: the partner A'. Field A of one cell is  amp x envelope x (1/3) sum_m cos(q_m . d + ph_m); its partner is
// the same beat a quarter period out of step,  amp x envelope x (1/3) sum_m sgn_m sin(q_m . d + ph_m). The pair is
// three travelling waves, cos(q_m . d - t) + i sin(...), each moving along sgn_m q_m. Which way each wave travels is
// a choice (cos does not care about the sign of q, sin does): the beat's three wavevectors lie 0, 60 and 120 degrees
// apart, so with sgn = (1, 1, 1) ("arrow", Fields.pSgn1 = 1) the three travel roughly the same way, along the cell's
// middle beat direction q1, and the partner is a dipole across the cell (plus on one side, minus on the other): every
// cell has an arrow. With sgn = (1, -1, 1) ("symmetric", pSgn1 = -1) they point 120 degrees apart (q0 - q1 + q2 = 0),
// the partner is three-fold and weak near the cell, and a lone cell's pair just pulses in place.
// cos(x - sgn_m pi/2) = sgn_m sin(x), so A' is field A evaluated with its phases shifted by p_shift(sgn1).
fn p_sgn(s1: f32) -> vec3f { return vec3f(1.0, s1, 1.0); }
fn p_shift(s1: f32) -> vec3f { return -1.5707963 * p_sgn(s1); }

fn charge_a(F: Fields, kind: u32) -> f32 {
  if (kind < 4u) { return F.qA[kind]; }
  return F.q4.x;
}
fn charge_b(F: Fields, kind: u32) -> f32 {
  if (kind < 4u) { return F.qB[kind]; }
  return F.q4.y;
}
// a cell's B charge, after conversion (step 6, rule 2): a converted cell emits B more strongly (mode 0:
// x (1 + conv)) or of the other sign (mode 1: x -conv), and listens to B with the same charge
fn cell_charge_b(F: Fields, c: Cell) -> f32 {
  // step C6b: from the cell's stock (its net charge, saturating; Cell.q, eat pass), or the fixed charge of its fate
  let q = select(charge_b(F, c.kind), F.qStockB * c.q, F.qStock != 0u);
  if (F.conv > 0.0 && (c.flags & CELL_CONV) != 0u) {
    return select(q * (1.0 + F.conv), -q * F.conv, F.convMode == 1u);
  }
  return q;
}

// Field B of one cell at x, before the sign rule: strength x envelope x (1/3) sum_m cos(q_m . (x - centre)),
// tapered to 0 at cutR. Its gradient (what a cell feels: membrane integral = area x gradient for a field this
// smooth over the cell) comes with it: returns (gradient xy, value z).
fn cell_field_b(b: CellBeat, x: vec2f, cutR: f32) -> vec3f {
  let d = x - b.q2p.zw;
  let d2 = dot(d, d);
  let inv = 1.0 / (1.0 + d2 / b.b2a.w);
  let a0 = dot(b.b01.xy, d);
  let a1 = dot(b.b01.zw, d);
  let a2 = dot(b.b2a.xy, d);
  let s = cos(a0) + cos(a1) + cos(a2);
  let gs = -(b.b01.xy * sin(a0) + b.b01.zw * sin(a1) + b.b2a.xy * sin(a2));
  let genv = d * (-2.0 / b.b2a.w * inv * inv);
  let t = cut_taper(d2, cutR) * b.b2a.z / 3.0;
  return vec3f((genv * s + inv * gs) * t, inv * s * t);
}

// ---------- the cell as an emitter ----------
// The lattice a cell emits with: its key (angle, log period factor) plus its fate's period, with the
// difference from the medium's lattice scaled by the lever (Sim.lever). Returns (angle, log period factor).
fn cell_lattice(c: Cell, lever: f32) -> vec2f {
  let base = P3 * round(c.la / P3);            // the nearest of the medium's hex directions (0 or 60 degrees)
  return vec2f(base + lever * (c.la - base), lever * (c.aux + log(kind_period(c.kind))));
}

// A cell's beat, computed once per tick (cell_grid.wgsl, scatter) for everyone who senses or draws it (128 bytes;
// keep in step with CELL_BEAT_BYTES in src/cells.js). The phases are taken at the cell's own centre, so the
// field near it is  amp * envelope * (1/3) sum_m cos(q_m . (x - pos) + ph_m)  with small cosine arguments.
struct CellBeat {
  q01: vec4f,       // beat wavevectors q0 (xy) and q1 (zw)
  q2p: vec4f,       // q2 (xy), the cell's centre (zw)
  k01: vec4f,       // the cell's own (strained) lattice wavevectors k0 (xy) and k1 (zw), for receptor tuning
  k2a: vec4f,       // k2 (xy), strength (z; 0 = not emitting), envelope range squared (w)
  ph: vec3f,        // phases at the cell's centre
  idx: u32,         // the cell's index in `cells` (a copy of sortIdx, so the step pass needs one buffer less)
  // field B (step 5): its own band, always pinned to the cell (phase 0 at the centre)
  b01: vec4f,       // B's beat wavevectors q0 (xy) and q1 (zw)
  b2a: vec4f,       // q2 (xy), signed strength = the cell's B charge x size (z), envelope range squared (w)
  // step 6, rule 1: the leak, the cell's strained A lattice beating against B's medium lattice (one plane wave,
  // the best-matching direction), pinned to the cell, with B's envelope
  lk: vec4f,        // beat wavevector (xy), strength (z; 0 = no leak), leak level 0..1 (w)
};

// The cell as a field emitter: strength min(1, r/R) (times Sim.emit), range r0 = Sim.r0 x R. Its lattice is
// strained by the cell's stretch (k = F^-1 . k0) and scaled by its period factor p; emitter_k does
// k = adj(F) . k0 / kind_period, so p goes in as F / p (with kind = stem, period 1).
fn cell_beat(c: Cell, S: Sim, M: Medium, FL: Fields) -> CellBeat {
  let lat = cell_lattice(c, S.lever);
  let F = cell_F(c) * exp(-lat.y);
  var e: Emitter;
  e.pos = c.pos;
  e.la = lat.x;
  e.amp = S.emit * charge_a(FL, c.kind) * min(1.0, c.r / S.R) * length(c.z);
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
  var pa = ph;                                          // anchor 0: the reference
  if (S.anchor == 1u) { pa = vec3f(0.0); }
  if (S.anchor == 2u) { pa = vec3f(dot(b.q0, o), dot(b.q1, o), dot(b.q2, o)); }
  // step 8: the phasor's angle shifts the beat: each wave by sgn_m x angle, so A and the partner A' turn into each other
  if (abs(c.z.y) > 1e-6 || c.z.x < 0.0) { pa += p_sgn(FL.pSgn1) * atan2(c.z.y, c.z.x); }
  cb.ph = pa - TAU * floor(pa / TAU);
  cb.idx = 0u;
  // field B: the same key and stretch, in B's band (the medium's lattice and the cell's both bBand times longer),
  // with B's own lever; pinned to the cell
  let latB = cell_lattice(c, FL.bLever);
  var cs = c;
  cs.e1 *= FL.bStrain;
  cs.e2 *= FL.bStrain;
  let FB = cell_F(cs) * exp(-latB.y);
  var MB = M;
  MB.k0 = M.k0 / FL.bBand;
  var eb = e;
  eb.la = latB.x;
  eb.fa = FB.x; eb.fb = FB.y; eb.fd = FB.z;
  let bb = make_beat(eb, MB);
  let rB = FL.bR0 * S.R;
  let qb = cell_charge_b(FL, c);
  cb.b01 = vec4f(bb.q0, bb.q1);
  cb.b2a = vec4f(bb.q2, FL.bEmit * qb * min(1.0, c.r / S.R), rB * rB);
  // rule 1, leak by deformation: a stretched cell's A lattice is squeezed the other way; where one of its three
  // wavevectors comes close to one of B's medium wavevectors (B's band: bBand x the medium's period), that pair
  // makes a slow beat, and that share of the cell's A emission lands in field B. Its level is a Gaussian in the
  // pair's beat wavevector |q|: 1 for a perfect match, small for an unstretched cell (|q| about k0 / 3).
  // The leaked B is that one beat, a plane wave pinned to the cell (stripes across the stretch axis), with B's
  // envelope; the A it emits loses the same share.
  cb.lk = vec4f(0.0);
  if (FL.leak > 0.0) {
    var best = vec2f(1e9);
    for (var m = 0; m < 3; m++) {
      let k = emitter_k(e, M, m);
      for (var n = 0; n < 3; n++) {
        let kb = medium_k(MB, n);
        let d1 = k - kb;
        let d2 = k + kb;
        if (dot(d1, d1) < dot(best, best)) { best = d1; }
        if (dot(d2, d2) < dot(best, best)) { best = d2; }
      }
    }
    let L = exp(-dot(best, best) / (2.0 * FL.leakW * FL.leakW * M.k0 * M.k0));
    cb.lk = vec4f(best, FL.leak * FL.bEmit * L * e.amp, L);
    cb.k2a.z = e.amp * (1.0 - L);
  }
  return cb;
}

// The leaked B of one cell at x (rule 1): strength x B's envelope x cos(q . (x - centre)), tapered to 0 at cutR.
// Returns (gradient xy, value z), as cell_field_b.
fn cell_field_leak(b: CellBeat, x: vec2f, cutR: f32) -> vec3f {
  let d = x - b.q2p.zw;
  let d2 = dot(d, d);
  let inv = 1.0 / (1.0 + d2 / b.b2a.w);
  let a = dot(b.lk.xy, d);
  let cs = cos(a);
  let genv = d * (-2.0 / b.b2a.w * inv * inv);
  let t = cut_taper(d2, cutR) * b.lk.z;
  return vec3f((genv * cs - inv * sin(a) * b.lk.xy) * t, inv * cs * t);
}

// the field's taper near the cut-off: 1 out to 0.7 x cutR, then smoothly down to 0 at cutR, so a neighbour
// crossing the cut-off fades in and out instead of popping (the reference cut it off hard)
fn cut_taper(d2: f32, cutR: f32) -> f32 {
  return 1.0 - smoothstep(0.7 * cutR, cutR, sqrt(d2));
}

// a cell's field at x, before receptor tuning
fn cell_field(b: CellBeat, x: vec2f, cutR: f32) -> f32 {
  return cell_field_ph(b, x, cutR, vec3f(0.0));
}
// ... with its phases shifted by dph (step 8: dph = p_shift(..) gives the partner A')
fn cell_field_ph(b: CellBeat, x: vec2f, cutR: f32, dph: vec3f) -> f32 {
  let d = x - b.q2p.zw;
  let d2 = dot(d, d);
  let p = b.ph + dph;
  let s = cos(dot(b.q01.xy, d) + p.x) + cos(dot(b.q01.zw, d) + p.y) + cos(dot(b.q2p.xy, d) + p.z);
  return b.k2a.z * s / (3.0 * (1.0 + d2 / b.k2a.w)) * cut_taper(d2, cutR);
}

// Step 8: as sense_field, but adds the emitter's field A (weight w) to seg and its partner A' (weight wP) to segP in
// one go: the partner shares the envelope, the midpoints and the sinc, only cos becomes sgn x sin.
fn sense_pair(seg: ptr<function, array<f32, 6>>, segP: ptr<function, array<f32, 6>>, mb: Membrane, rel: vec2f,
              q0: vec2f, q1: vec2f, q2: vec2f, ph: vec3f, r0sq: f32, w: f32, wP: f32, sgn: vec3f) {
  let q = array<vec2f, 3>(q0, q1, q2);
  var env: array<f32, 6>;
  for (var a = 0; a < 6; a++) {
    let x = rel + mb.mid[a];
    env[a] = 1.0 / (3.0 * (1.0 + dot(x, x) / r0sq));
  }
  for (var m = 0; m < 3; m++) {
    let base = dot(q[m], rel) + ph[m];
    let wp = wP * sgn[m];
    for (var a = 0; a < 6; a++) {
      let X = 0.5 * dot(q[m], mb.edge[a]);
      let e = env[a] * select(sin(X) / X, 1.0, abs(X) < 1e-4);
      let arg = dot(q[m], mb.mid[a]) + base;
      (*seg)[a] += w * e * cos(arg);
      (*segP)[a] += wp * e * sin(arg);
    }
  }
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
  return grid_range_n(S, g, 1);
}
// the (2n + 1) x (2n + 1) block: covers at least n grid cells' width around any point of g (field B's reach)
fn grid_range_n(S: Sim, g: vec2i, n: i32) -> vec4i {
  let lo = max(g - vec2i(n), vec2i(0));
  let hi = min(g + vec2i(n), vec2i(i32(S.gw) - 1, i32(S.gh) - 1));
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
