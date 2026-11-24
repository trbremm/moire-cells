// The cells' genome ("DNA"): random at the start, copied with small mutations at each birth.
//
// Layout: struct Bio in cell_common.wgsl, 24 floats (96 bytes) per cell, double-buffered on the GPU.
//   key    x key angle (0..60 deg), y key scale (log period factor, -0.15..0.15),
//          z receptor angle, w receptor scale            -> WHICH keys the cell recognises (specific)
//   rec    x receptor width (pickiness), y spare (the fates' threshold until step F0), z step G0: the FOUNDER's glue (its body.x when
//          it was made, inherited unchanged: the glue's neutral control acts with it), w founder id (a whole number, as a float)
//   resp   step F0, state (inherited, not mutated): x y the JOB scores builder, predator (src/jobs.js); z w spare (the fates' response
//          genes until then)
//   relay  x spare (the carbon branch's transporter gene); step S1: y the ELONGATION gene (ln of the aspect the cell asks for, 0 round ..
//          ln 4; founders 0, wild founders anywhere; src/spindle.js), z w the gene network's 18th output (SHAPE): its gain and regulator
//          (the fates' relay genes until step F0)
//   body   x adhesion, y size factor, z motility factor, w spare
//   acc    step F0, state (inherited): the JOB scores light eater, breather, fermenter, gradient eater, low-passed (the fates' four
//          leaky accumulators until then)
//   env    state: x y spare (the nutrient and threat felt, until step C3); z the A felt (integrated), w converted (step 6)
//   conv   state (step 6): x the converted share of the neighbourhood (integrated, for the relay); y z step 8's clock (state);
//          w step G1: the FIDELITY gene (proofreading; src/fidelity.js): a log factor, a birth's copying errors x e^-w (-2..3; founders 0:
//          today's copying), a GENE although it sits among the state words (inherited; words 20..30 are the state)
//   eng    step C6, genes: x y z the three ENGINE SLOTS, each a whole number: the engine's index in ENGINES (src/matter.js)
//          + 32 x the light band its pigment catches (1 visible 1, 2 visible 2, 3 hard; 0 none: an uphill engine then
//          runs on the battery, a storer; used by uphill engines only);
//          w the HEAT TOLERANCE (temperature, heat per R^2)
//   rate   step C6, genes: x y z each slot's rate (0 = an empty slot; burn, swap, form: the share of what it works on per s;
//          harvest: the amount of pigment, its optical depth is pigK x rate); w the PERMEABILITY (per s, for the light atoms)
//   memb   step C6c, genes of the membrane (src/membrane.js): x MIX, the heavy linkers' (L) share of the membrane (0..1, the
//          rest light l); y THICKNESS, linker per R of membrane (atom-units); z the STIFFNESS gene (x what the material
//          gives: heavy and thick = stiff); w the ION SELECTIVITY s (-1..1: givers pass x (1 + s), takers x (1 - s); step C12g: with
//          the bilayer blocking ions, the channels' BALANCE: the cation channel x (1 + s), the anion channel x (1 - s))
//   pump   step C7, genes of the two PUMP SLOTS (src/pumps.js): x y each slot's code, a whole number: the substance's channel
//          (0..12, SUBSTANCES order; sediment is never pumped) + 16 x its direction (0 IN, 1 OUT); z w each slot's rate (per s:
//          the share of the source side's amount, per cell volume, it moves; 0 = an empty slot)
//   wall   step C10, genes of the PATTERNED WALLS (src/walls.js): x a1, the polar part of the wall's adhesion (front sticky: +);
//          y a2, the two-fold part (ends sticky: +, sides sticky: -); z w, how much the front follows the charge dipole; w step C11:
//          the DIVISION AXIS, 0..1 (a daughter is put along the front at 0, across it at 1, at that share of a right angle between).
//          The overall stickiness a0 is the adhesion gene (body.x)
//   mark   step T1a, the SELF MARKER (src/kin.js): x its angle (rad), y its period (ln of the stripe spacing in R), z its phase (rad);
//          w the DISPLAY gene (0..1); no other effect: it drifts at every birth (a molecular clock) and is compared at contacts
//   kin    step T1a: x the KIN CHANNELS gene (0..1), y the TOLERANCE (0..1); step P1: z the ENGULF gene (0..1), w the KIN SPARING gene
//          (0..1) (src/predators.js; founders 0, wild founders anywhere; the gene network's 17th output, ENGULF, has its gain and regulator
//          in gm.z, gm.w)
//   gx..gm step T1b, the GENE REGULATORY NETWORK (src/grn.js, cell_grn.wgsl), words 84..155: gx[2] (84..91) the 8 regulators' EXPRESSION
//          (state: inherited, not mutated), gb[2] (92..99) their biases, gw[6] (100..123) the input weights (regulator i's input k at 3 i + k),
//          gi[2] (124..131) the input codes (a + 32 b + 1024 c; a source 0 none, 1..8 a regulator, 9..22 a sense), gu[4] (132..147) the 16
//          output gains, go (148..151) each output's regulator (four to a word, 3 bits each), gm (152..155) x the broadcast regulator, y the
//          contact signal's kinship weighting, z w spare. Every weight and gain 0 (std, blank founders, old genomes): no network, as before
//   dx     step G2, GENE DUPLICATION (src/dup.js), words 156..167: dx (156..159) the two SILENT engine slots 3, 4: x y their codes (as eng),
//          z w their rates (0 = silent); df (160..163) the FAMILY words of engine slots 0..3, dg (164..167) x engine slot 4's, y z pump slots
//          0 and 1's, w the duplications in the line since its founder. A family word = id x 8 + bits (0..1 the gene-network output the slot
//          follows, 4 a copy made by duplication); 0 = an empty slot or one not named yet (named at the next birth: founders' slots
//          1 + 16 x founder + slot, pumps + 8; a slot started from empty by mutation a fresh id). Old genomes: all 0, the slots silent
//   mo     step S2, FLAGELLA AND CILIA (src/motors.js), words 168..179: mo (168..171) x the FLAGELLUM's thrust (0..1), y its sign (> 0 a pusher,
//          < 0 a puller), z its placement round the pole (-1..1 x 90 degrees), w the CILIA's beat (0..1); mc (172..175) x the cilia's coupling
//          (-1..1), y their stroke's tilt (-1..1 x 90 degrees), z STATE: the beat's phase (rad), w spare; mg (176..179) the gene network's 19th
//          output (FLAGELLUM: x gain, y regulator) and 20th (CILIA: z gain, w regulator). Founders: no motors (thrust and beat 0), a random
//          sign, placement within +-0.05, coupling and tilt 0, a random phase; wild founders (group 'motors') every gene over its range.
//          Old genomes: all 0 (no motors; the phase starts at 0)
//   ta tb  step P3, CELLS THAT SENSE CELLS (src/senses.js), words 180..187: ta the four TASTE DIALS, -1..1 (+ approach, - flee): x OXYGEN (free
//          t), y EXHAUST (the CO2-like carbon), z SPILL (free G), w HEAT; tb x the RANGE (log sensitivity, -2..2), y z w spare. Founders 0 (std and
//          blank: no taste, the range in the middle); wild founders (group 'taste') every dial and the range over their whole span. Old genomes 0
//   lip    step C12b, genes of the LIPID MEMBRANE (src/lipids.js): x WALL, the crust wall wanted as a share of a full wall (0..1);
//          y HEAD, which head the soap the cell makes carries (-1 all t: tlL, -; 1 all g: glL, +); z the wall's ROW (its heavy
//          share, LL of ll + LL); w spare. With the lipid membranes on, memb.x (the C6c mix) is the bilayer's OIL share (oil
//          molecules wanted per soap molecule, 0..1)
// The key is the cell's own lattice (Cell.la and Cell.aux carry copies), so it shows in the dot pattern.
//
// Seeding: `founders` random genomes (0 = every cell its own), each cell a copy of one of them, scattered at
// random. A seeded random generator (?seed=N) makes the start repeatable.

import { ALL_ENGINES as ENGINES, engineIndex, ELECTRONS } from './matter.js';   // (step C15b: + the carbon engines)
import { CARBON, CB_LIP } from './carbon.js';
import { fieldDefaults, founderGates, BIO_FG } from './guides.js';
import { stampFounderGlue } from './glue.js';
import { stampLattices, founderOutputs } from './folding.js';

export const BIO_FLOATS = 256;  // (240 until step T2's tendril and mineral genes; 224 until step Q1's signal genes; 188 until step G3's moire genome; 180 until step P3's taste genes; 168 until step S2's motor genes; 156 until step G2's duplicate slots and families; 40 until step C6c's membrane genes, 44 until step C7's pumps, 48 until step C10's walls, 52 until step C12b's lipids,
                                //  56 until step C13's field genes and gates, 76 until step T1a's marker and kin channels, 84 until step T1b's gene network)
export const BIO_GRN = 84;      // step T1b: the gene network's first word (Bio.gx)
export const BIO_G2 = 156;      // step G2: the duplicate slots' first word (Bio.dx; Bio.df at 160, Bio.dg at 164)
export const BIO_MO = 168;      // step S2: the motor genes' first word (Bio.mo; Bio.mc at 172, Bio.mg at 176)
export const BIO_T1 = 76;       // step T1a: the first marker word (Bio.mark; Bio.kin at 80)
export const BIO_G3 = 188;      // step G3: the regulators' lattice angles (Bio.la; lk at 196, lp at 204, fh 212, fs 216, gs 220)
export const BIO_Q1 = 224;      // step Q1: the signal genes (Bio.sg; sh at 228, so 232, ss 236: state)
export const BIO_T2 = 240;      // step T2: the tendril genes (Bio.tn; tk at 244: stiffness, retraction, floor grip, MINERALISE; tq 248, tm 252: outputs)
export const BIO_BYTES = BIO_FLOATS * 4;

export const KEY_SPAN = Math.PI / 3;
export const KEY_SMAX = 0.15;

// rule bits (keep in step with RULE_* in cell_common.wgsl)
// (bit 32 was rule E, nutrient and threat, until step C3)
export const RULE = { ADH: 2, TURN: 4, MUT: 8 };   // (step F0: 1 was differentiation, 16 inherit fate)

/** Small seeded random generator (mulberry32): returns a function giving floats in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const U = (rng, a, b) => a + (b - a) * rng();
const logU = (rng, a, b) => a * Math.pow(b / a, rng());

/** One random genome, as a plain array of BIO_FLOATS numbers. */
export function randomGenome(rng, founder, mrng = rng, prng = mrng, wrng = prng, drng = wrng, lrng = drng, grng = lrng, irng = grng) {
  const g = new Array(BIO_FLOATS).fill(0);
  g[0] = U(rng, 0, KEY_SPAN); g[1] = U(rng, -KEY_SMAX, KEY_SMAX);
  g[2] = U(rng, 0, KEY_SPAN); g[3] = U(rng, -KEY_SMAX, KEY_SMAX);
  g[4] = logU(rng, 0.06, 0.25);          // receptor width
  U(rng, 0.6, 1.6); U(rng, 0.4, 1.4);    // (step F0: the fates' threshold and output; still drawn, so a seed's founders keep their genes)
  g[7] = founder;                        // founder id (exact as a float up to 2^24)
  for (let c = 0; c < 8; c++) U(rng, -1, 1);   // (step F0: the fates' resp and relay genes, drawn and dropped as above; the job state starts 0)
  g[16] = U(rng, 0, 1);                  // adhesion
  g[17] = U(rng, 0.85, 1.15);            // size
  g[18] = logU(rng, 0.5, 2);             // motility
  g[19] = U(rng, 0, 2 * Math.PI);        // crawling heading (state, not a gene)
  engines(g, rng, STRATEGIES[Math.floor(rng() * STRATEGIES.length)]);
  membrane(g, mrng, mrng() < 0.25);   // step C6c (its own random stream, so a seed's founders keep their other genes)
  pumps(g, prng);                      // step C7 (its own stream too)
  walls(g, wrng);                      // step C10 (and its own)
  g[51] = drng();                      // step C11: the division axis, anywhere from along the front (0) to across it (1) (its own stream too)
  lipids(g, lrng, lrng() < 0.25);      // step C12b (and its own)
  fieldDefaults(g);                    // step C13: the field genes at today's values (x 1, offset 0), so mutation off changes nothing;
  founderGates(g, grng);               // ... the gates near 0 (within +-0.05; their own stream)
  g[75] = U(irng, -0.5, 0.5);          // step C12g: the ion channels' level (log factor on chanBase), near the knob's value (its own stream)
  grnDefaults(g);                      // step T1b: no network (no random numbers drawn)
  return g;
}

// Step C12b: the founders' lipid genes. The bilayer's oil share is memb.x (the C6c mix gene: most founders 0 to 0.15, a quarter
// 0.55 to 0.9, so the same founders give near-pure soap and oily membranes); a WALL for a quarter of the founders (founder k with
// k mod 4 = 1, i.e. 1, 5, 9 of the default 12: one burner, one harvest + burn, one heavy harvester; with founders = 0 a quarter
// at random), 0.4 to 0.9 of a full wall, the rest at most a trace; the head anywhere from mostly - to mostly +; the wall's row
// anywhere.
function lipids(g, rng, walled) {
  g[52] = walled ? U(rng, 0.4, 0.9) : U(rng, 0, 0.05);   // wall
  g[53] = U(rng, -0.6, 0.6);                              // head (+: glL, -: tlL)
  g[54] = U(rng, 0, 1);                                   // the wall's row (heavy share)
  g[55] = 0;
}

// Step C10: the founders' walls are NEAR-UNIFORM (a small polar part a1 and two-fold part a2, so any pattern must evolve), and
// the gene w (how much the front follows the dipole) anywhere from 0 to 0.5. Mutation drifts all three (cell_common.wgsl mutate)
function walls(g, rng) {
  g[48] = U(rng, -0.08, 0.08); g[49] = U(rng, -0.08, 0.08); g[50] = U(rng, 0, 0.5); g[51] = 0;
}

// Step C6: the founders' engine sets, so a new culture neither starves at once nor is all alike. Each founder gets one
// strategy (founder k gets STRATEGIES[k mod 12], so with the default 12 founders there are 5 burners, 3 harvest + burn,
// 2 heavy harvesters and 2 others; with founders = 0 every cell draws one at random from the same list):
//   burn     burns the light fuel gt fast and one heavier fuel slower (the C5 burner's habit, now a choice)
//   both     a visible 1 pigment making gt, and a burner of gt: the light and the fuel in one cell
//   pigments two pigments (gt by visible 1, gT by visible 2) and a small gt burner (light never charges a battery and a
//            harvester's spark comes from it, so every founder that harvests also burns; a harvester without a burner
//            only arises by mutation, and it runs flat)
//   other    makes sediment from linkers and swaps a light atom into rich fuel (small gains, no burner)
const STRATEGIES = ['burn', 'both', 'burn', 'pigments', 'burn', 'both', 'other', 'burn', 'pigments', 'both', 'burn', 'other'];
const E = (name) => engineIndex(name);
const HEAVY_BURN = ['gT → g + T', 'Gt → G + t', 'GT → G + T'];
const slot = (g, k, eng, rate, band = 1) => { g[32 + k] = eng + 32 * band; g[36 + k] = rate; };

// Step C12d (electrons): the founders' engine sets from the electrons' table. Free atoms are now the restless, energy-rich state,
// and light makes them: in the open, hard light splits the water-like mineral gt into g + t and visible light splits the vent's
// fuel; a pigment does it inside a cell. So the founders (the same four habits as before, in the new table):
//   burn     ("eaters") bond free atoms: g + t -> gt (a free light taker grabbing a free giver: 4.5, the richest burn) and a
//            fermenting engine (no oxygen needed: G + T -> GT, G + gT -> GT + g, g + T -> gT or the trade gT + Gt -> gt + GT)
//   both     a visible 2 pigment SPLITTING the mineral gt -> g + t (the photon pays 3 of the 4.5, the battery the rest) and the burn
//            g + t -> gt: light made into free atoms and burned back in one cell (as C6's "both": a harvester must burn)
//   pigments PHOTOSYNTHESIS: gt + T -> gT + t (visible 2: fuel made, a free light taker thrown out) and Gt + T -> GT + t, and a
//            small burn of g + t
//   other    a chain maker, a BREATHER (t + gT -> gt + T, 3: idle until oxygen comes) and a small fermenter
const FERMENT = ['G + T → GT', 'G + gT → GT + g', 'g + T → gT', 'gT + Gt → gt + GT'];
function enginesE(g, rng, strategy) {
  for (let k = 0; k < 3; k++) slot(g, k, E('g + t → gt'), 0, 1);
  const fer = () => E(FERMENT[Math.floor(rng() * FERMENT.length)]);
  if (strategy === 'burn') {
    slot(g, 0, E('g + t → gt'), U(rng, 1.5, 3), 0);
    slot(g, 1, fer(), U(rng, 1, 2.5), 0);
  } else if (strategy === 'both') {
    slot(g, 0, E('gt → g + t'), U(rng, 0.6, 1.5), 2);
    slot(g, 1, E('g + t → gt'), U(rng, 1.5, 3), 0);
    if (rng() < 0.5) slot(g, 2, fer(), U(rng, 0.5, 1.5), 0);
  } else if (strategy === 'pigments') {
    slot(g, 0, E('gt + T → gT + t'), U(rng, 0.8, 2), 2);
    slot(g, 1, E('Gt + T → GT + t'), U(rng, 0.5, 1.5), 2);
    slot(g, 2, E('g + t → gt'), U(rng, 0.3, 0.8), 0);
  } else if (strategy === 'carbon' && CARBON) {
    // step C15b: a carbon eater (?habit=carbon, the add-cell tool): breathing on carbon (OXIDIZE), bonding the freed g with t, storing
    // a little as granules (CONDENSE)
    slot(g, 0, CE(0), U(rng, 1.5, 3), 0);
    slot(g, 1, E('g + t → gt'), U(rng, 1.5, 3), 0);
    slot(g, 2, CE(1), U(rng, 0.3, 0.8), 0);
  } else {
    slot(g, 0, E('l + l → ll'), U(rng, 1, 2.5), 0);
    slot(g, 1, E('t + gT → gt + T'), U(rng, 1, 2.5), 0);
    slot(g, 2, fer(), U(rng, 0.3, 0.8), 0);
  }
  g[35] = U(rng, 10, 20);
  g[39] = logU(rng, 1.5, 6);
}

// Step C15b: CARBON ENGINES FOR THE FOUNDERS (with carbon on; from their own random stream, so a seed's other genes stay as they were).
// A std founder gets carbon engines with chance CARBON_FOUNDER: an eater (burn) a weak BREATHER ON CARBON (OXIDIZE) in its free third slot,
// a chain maker (other) a STORER (CONDENSE: granules) in its third; a photosynthesiser (pigments) becomes a CARBON FIXER: REDUCE with a
// visible 2 pigment, OXIDIZE to burn what it fixed (a harvester must burn: light never charges the battery) and the g + t bond (the freed
// g with the freed t). A light + burn founder (both) keeps its three. A WILD founder draws, with chance 1/2, any one of the four into any
// slot (an uphill one with any pigment band). Four numbers are always drawn.
export const CARBON_FOUNDER = 1 / 3;
const CE = (j) => (CARBON ? engineIndex(['t + [c-g] → [c-t] + g', '[c-g] + [c-t] → [c-c] + gt', 'g + [c-t] → [c-g] + t', 'gt + [c-c] → [c-g] + [c-t]'][j]) : -1);
// Step C15d, FOUNDERS THAT PHOTOSYNTHESISE FIX CARBON (?cbphoto=0: as C15c): in a dish where carbon makes the cell (CB_LIP) the light
// harvest IS carbon fixation, as in real photosynthesis. So a photosynthesiser (pigments) is ALWAYS a carbon fixer (the C15b set: REDUCE
// with a visible 2 pigment, OXIDIZE to burn some of what it fixed, the g + t bond), and a light + burn founder (both), whose visible 2
// pigment already splits water into g + t, uses its third slot to REDUCE carbon with that g (a second visible 2 pigment: two photons per
// hand, the proposal's Z-scheme) instead of its odd fermenter: water + CO2-like carbon + light -> sugar-like carbon + free t (oxygen).
// The same four draws (the seed's other genes unchanged); wild founders get it before their own random carbon engine.
export const CB_PHOTO = { on: true };
function founderCarbon(g, rng, strategy, wild, chance = CARBON_FOUNDER) {
  if (!CARBON || !ELECTRONS) return;
  const u = rng(), v = rng(), w = rng(), x = rng();
  const photo = CB_LIP && CB_PHOTO.on;
  if (photo && strategy === 'both') slot(g, 2, CE(2), 0.5 + 0.7 * v, 2);
  if (photo && strategy === 'pigments' && !wild) chance = 1;
  if (wild) {
    if (u >= 0.5) return;
    const j = Math.min(3, Math.floor(v * 4)), k = Math.min(2, Math.floor(w * 3));
    slot(g, k, CE(j), 0.3 + 1.2 * x, j >= 2 ? Math.min(3, Math.floor(x * 4)) : 0);
    return;
  }
  if (u >= chance) return;
  if (strategy === 'burn') slot(g, 2, CE(0), 0.3 + 0.6 * v, 0);
  else if (strategy === 'other') slot(g, 2, CE(1), 0.3 + 0.5 * v, 0);
  else if (strategy === 'pigments') { slot(g, 0, CE(2), 0.8 + 1.2 * v, 2); slot(g, 1, CE(0), 1 + w, 0); slot(g, 2, E('g + t → gt'), 0.3 + 0.5 * x, 0); }
}

/** Fill the engine genes (slots, tolerance, permeability) of genome g for a strategy. */
function engines(g, rng, strategy) {
  if (ELECTRONS) { enginesE(g, rng, strategy); return; }
  for (let k = 0; k < 3; k++) slot(g, k, E('gt → g + t'), 0, 1);
  if (strategy === 'burn') {
    slot(g, 0, E('gt → g + t'), U(rng, 1.5, 3));
    slot(g, 1, E(HEAVY_BURN[Math.floor(rng() * 3)]), U(rng, 1, 2.5));
  } else if (strategy === 'both') {
    slot(g, 0, E('g + t → gt'), U(rng, 0.6, 1.5), 1);
    slot(g, 1, E('gt → g + t'), U(rng, 1.5, 3));
    if (rng() < 0.5) slot(g, 2, E(HEAVY_BURN[Math.floor(rng() * 3)]), U(rng, 0.5, 1.5));
  } else if (strategy === 'pigments') {
    slot(g, 0, E('g + t → gt'), U(rng, 0.8, 2), 1);
    slot(g, 1, E('g + T → gT'), U(rng, 0.5, 1.5), 2);
    slot(g, 2, E('gt → g + t'), U(rng, 0.3, 0.8));
  } else {
    slot(g, 0, E('l + l → ll'), U(rng, 1, 2.5));
    slot(g, 1, E('t + gT → gt + T'), U(rng, 1, 2.5));
  }
  g[35] = U(rng, 10, 20);                // heat tolerance (C5's global: 15)
  g[39] = logU(rng, 1.5, 6);             // permeability (C5's global: 3)
}

// Step C6c: the founders' membranes: mostly light and thin (cheap: few linkers, the light ones), a few heavy and thicker
// (founder k with k mod 4 = 3, i.e. 3 of the default 12, one of each of three strategies; with founders = 0, a quarter of
// the cells at random). The stiffness gene near 1, the ion selectivity near neutral (charge separation is left to mutation).
export const MEMB_THIN = 0.012;          // the founders' usual thickness (linker atom-units per R of membrane)
function membrane(g, rng, heavy) {
  g[40] = heavy ? U(rng, 0.55, 0.9) : U(rng, 0, 0.15);                         // mix
  g[41] = heavy ? logU(rng, 1.5 * MEMB_THIN, 3 * MEMB_THIN) : logU(rng, 0.7 * MEMB_THIN, 1.4 * MEMB_THIN);   // thickness
  g[42] = logU(rng, 0.8, 1.25);                                                // stiffness gene
  g[43] = U(rng, -0.25, 0.25);                                                 // ion selectivity (step C12g: the channels' balance;
                                                                               //  -0.08..0.08 until C12g)
}

// Step C7: the founders' pumps: most have none (pumps must earn their place by selection); about a third get ONE weak pump
// of a random substance (never sediment) and direction. Mutation does the rest (cell_common.wgsl mutate).
export const PUMP_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12];   // g t l G T L gt gT Gt GT trace (PUMP_CH in cell_common.wgsl)
export const PUMP_OUT = 16;            // a slot's code: channel + 16 x direction (1 = OUT)
function pumps(g, rng, share = 0.33) {
  g[44] = 0; g[45] = PUMP_OUT; g[46] = 0; g[47] = 0;
  if (rng() < share) {
    g[44] = PUMP_CHANNELS[Math.floor(rng() * PUMP_CHANNELS.length)] + (rng() < 0.5 ? PUMP_OUT : 0);
    g[46] = U(rng, 0.1, 0.5);
  }
}
/** A pump slot's gene as words: { ch, out, rate }. */
export function pumpOf(g, o, k) {
  const code = Math.round(g[o + 44 + k]);
  return { ch: code & 15, out: (code >> 4) & 1, rate: Math.max(0, g[o + 46 + k]) };
}

// Step T1a: the SELF MARKER and the KIN CHANNELS (src/kin.js). A founder's marker is drawn anywhere (angle, period between 0.15 and
// 0.4 R, phase), so unrelated founders are strangers and their colonies stay apart in the lineage view; it shows fully (display 1);
// no kin channels (0: they must evolve) and a middling tolerance (accepts a match of 0.5 and up).
export const MARK_P = [Math.log(0.12), Math.log(0.5)];   // the marker period's range (ln of the stripe spacing in R; MARK_PLO, MARK_PHI)
export function t1Genes(g, rng, o = 0) {
  g[o + 76] = U(rng, 0, 2 * Math.PI);
  g[o + 77] = U(rng, Math.log(0.15), Math.log(0.4));
  g[o + 78] = U(rng, 0, 2 * Math.PI);
  g[o + 79] = 1;
  g[o + 80] = 0; g[o + 81] = 0.5; g[o + 82] = 0; g[o + 83] = 0;
}

// Step T1a, the FOUNDER MODES (?founders=wild|blank, the New culture dialog; genome.params.founderMode):
//   std    today's founders (the T1a genes as t1Genes: no kin channels)
//   blank  the new ABILITIES at 0: no pumps, every guide gate exactly 0 (push 1), no kin channels, the stretch and ion genes at the knobs'
//          values (0), the walls uniform (a1 = a2 = 0, the front not following the dipole), no A' share; the engines and the rest as std
//   wild   every gene drawn over its WHOLE range (the ranges mutate() keeps them in): field genes, gates, push, stretch, channels, pumps
//          (each slot half the time empty, else any substance, either way, rate 0.05..6), walls, membrane (mix, thickness 0.002..0.2,
//          stiffness, selectivity), lipids, heat tolerance, permeability, marker, display, kin channels, tolerance. The engines keep
//          the founder's habit (its slots and their rates: a founder must be able to eat), and the key, receptors and body are random
//          already. From its own random stream, so a seed's std founders are unchanged
export const FOUNDER_MODES = ['std', 'blank', 'wild'];
// Step T1b: NO NETWORK (std and blank founders): every weight, gain and code 0, the expression at 0.5 (where a regulator with no input sits),
// broadcasting regulator 0, no kinship weighting. Its outputs are all exp(0) = 1: the cell behaves exactly as before the network
export function grnDefaults(g, o = 0) {
  for (let k = BIO_GRN; k < BIO_G2; k++) g[o + k] = 0;   // (step G2: the network's words end where the duplicate slots begin)
  for (let r = 0; r < 8; r++) g[o + BIO_GRN + r] = 0.5;
}
// ... WILD founders (group 'grn'): a random SPARSE network: each regulator a bias in -2..2 and each of its three inputs a source (any regulator
// or sense) at a weight in -4..4 six times in ten; each output reads a random regulator at a gain in -3..3 four times in ten (else none);
// a random broadcast regulator and kinship weighting. The expression starts at 0.5 (it settles in a few tau)
export function wildGrn(g, rng, o = 0) {
  const b = o + BIO_GRN;
  for (let r = 0; r < 8; r++) {
    g[b + r] = 0.5;
    g[b + 8 + r] = U(rng, -2, 2);
    let cw = 0;
    for (let k = 0; k < 3; k++) {
      const on = rng() < 0.6, c = 1 + Math.min(21, Math.floor(rng() * 22)), w = U(rng, -4, 4);
      g[b + 16 + 3 * r + k] = on ? w : 0;
      cw += (on ? c : 0) * 32 ** k;
    }
    g[b + 40 + r] = cw;
  }
  const regs = [0, 0, 0, 0];
  for (let q = 0; q < 16; q++) {
    const on = rng() < 0.4, r = Math.min(7, Math.floor(rng() * 8)), u = U(rng, -3, 3);
    g[b + 48 + q] = on ? u : 0;
    regs[q >> 2] += (on ? r : 0) * 8 ** (q & 3);
  }
  for (let w = 0; w < 4; w++) g[b + 64 + w] = regs[w];
  g[b + 68] = Math.min(7, Math.floor(rng() * 8)); g[b + 69] = rng(); g[b + 70] = 0; g[b + 71] = 0;
}
export function blankGenes(g, o = 0) {
  g[o + 44] = 0; g[o + 45] = PUMP_OUT; g[o + 46] = 0; g[o + 47] = 0;                 // no pumps
  g[o + 48] = 0; g[o + 49] = 0; g[o + 50] = 0;                                        // uniform walls, the front its own
  g[o + 55] = 0;                                                                      // stretch channels at the knob's value
  g[o + 66] = 0;                                                                      // no A' share
  for (let k = 68; k <= 72; k++) g[o + k] = 0;                                        // every gate 0
  g[o + 73] = 1; g[o + 74] = 0; g[o + 75] = 0;                                        // push 1, stretch tolerance 0, ion channels 0
  g[o + 80] = 0;                                                                      // no kin channels
}
export const WILD_GROUPS = ['body', 'membrane', 'pumps', 'walls', 'lipids', 'fields', 'gates', 'kin', 'grn', 'engulf', 'shape', 'motors', 'taste', 'signal'];
export const BIO_TASTE = 180;   // step P3: the taste dials' first word (Bio.ta; the range at 184)
// step P3: every founder's TASTE genes (std and blank: none, the range 0; so a taste must evolve), and WILD founders' (group 'taste'): each dial
// anywhere in -1..1, the range anywhere in -2..2. Their own random stream (a seed's other genes stay as they were)
export function tasteGenes(g, rng, o = 0, wild = false, groups = WILD_GROUPS) {
  const d = [U(rng, -1, 1), U(rng, -1, 1), U(rng, -1, 1), U(rng, -1, 1)], r = U(rng, -2, 2);
  const W = wild && groups.includes('taste'), b = o + BIO_TASTE;
  for (let k = 0; k < 4; k++) g[b + k] = W ? d[k] : 0;
  g[b + 4] = W ? r : 0; g[b + 5] = 0; g[b + 6] = 0; g[b + 7] = 0;
}
// step Q1: every founder's SIGNAL genes (src/signals.js). Std and blank founders are SILENT (release 0, no taste, no fast regulators, no
// outputs; so using the signal must evolve), each with a FLAVOUR of its own (emits and prefers the same: a private language per line), a
// moderate tuning (0.6 rad) and half its release through junctions. WILD founders (group 'signal'): release anywhere in 0..1 (half of them 0),
// a preferred flavour their own or anywhere (half each), tuning anywhere in 0.2..3 (log), junction share and taste dial over their spans, each
// regulator fast one time in four, and (with the group 'grn' too) each release output four times in ten from a random regulator at a gain in
// -3..3. Their own random stream (a seed's other genes stay as they were)
export function signalGenes(g, rng, o = 0, wild = false, groups = WILD_GROUPS) {
  const fl = U(rng, 0, 2 * Math.PI), own = rng() < 0.5, pref = U(rng, 0, 2 * Math.PI), width = logU(rng, 0.2, 3);
  const rel = rng() < 0.5 ? 0 : rng(), js = rng(), taste = U(rng, -1, 1);
  let mask = 0;
  for (let r = 0; r < 8; r++) if (rng() < 0.25) mask |= 1 << r;
  const on1 = rng() < 0.4, r1 = Math.min(7, Math.floor(rng() * 8)), u1 = U(rng, -3, 3), on2 = rng() < 0.4, r2 = Math.min(7, Math.floor(rng() * 8)), u2 = U(rng, -3, 3);
  const b = o + BIO_Q1, W = wild && groups.includes('signal'), net = W && groups.includes('grn');
  g[b] = fl; g[b + 1] = W && !own ? pref : fl; g[b + 2] = W ? width : 0.6; g[b + 3] = W ? rel : 0;
  g[b + 4] = W ? js : 0.5; g[b + 5] = W ? taste : 0; g[b + 6] = W ? mask : 0; g[b + 7] = 0;
  g[b + 8] = net && on1 ? u1 : 0; g[b + 9] = net && on1 ? r1 : 0; g[b + 10] = net && on2 ? u2 : 0; g[b + 11] = net && on2 ? r2 : 0;
  for (let k = 12; k < 16; k++) g[b + k] = 0;
}
// step S2: every founder's MOTOR genes (std and blank: no motors yet, a random sign and phase, the placement near the axis; so the motors must
// evolve), and WILD founders' (group 'motors'): the flagellum's thrust anywhere in 0..1 (half of them 0), its sign and placement over -1..1, the
// cilia's beat anywhere in 0..1 (half of them 0), coupling and tilt over -1..1, and the gene network's 19th and 20th outputs four times in ten
// each from a random regulator at a gain in -3..3 (only with the group 'grn' too). Their own random stream (a seed's other genes stay as they were)
export function motorGenes(g, rng, o = 0, wild = false, groups = WILD_GROUPS) {
  const sign = U(rng, -1, 1), place = U(rng, -0.05, 0.05), phase = U(rng, 0, 2 * Math.PI);
  const wf = rng() < 0.5 ? 0 : rng(), wp = U(rng, -1, 1), wc = rng() < 0.5 ? 0 : rng(), wk = U(rng, -1, 1), wt = U(rng, -1, 1);
  const on1 = rng() < 0.4, r1 = Math.min(7, Math.floor(rng() * 8)), u1 = U(rng, -3, 3), on2 = rng() < 0.4, r2 = Math.min(7, Math.floor(rng() * 8)), u2 = U(rng, -3, 3);
  const b = o + BIO_MO, W = wild && groups.includes('motors');
  g[b] = W ? wf : 0; g[b + 1] = sign; g[b + 2] = W ? wp : place; g[b + 3] = W ? wc : 0;
  g[b + 4] = W ? wk : 0; g[b + 5] = W ? wt : 0; g[b + 6] = phase; g[b + 7] = 0;
  const net = W && groups.includes('grn');
  g[b + 8] = net && on1 ? u1 : 0; g[b + 9] = net && on1 ? r1 : 0; g[b + 10] = net && on2 ? u2 : 0; g[b + 11] = net && on2 ? r2 : 0;
}
// step S1: WILD founders' shape genes (group 'shape'), from their own random stream (so a seed's other wild genes stay as they were): the
// ELONGATION gene anywhere in 0..ln 4, and the gene network's 18th output (SHAPE) four times in ten from a random regulator at a gain in -3..3
// (only with the group 'grn' too)
export function wildS1(g, rng, o = 0, groups = WILD_GROUPS) {
  const e = U(rng, 0, Math.log(4)), on = rng() < 0.4, r = Math.min(7, Math.floor(rng() * 8)), u = U(rng, -3, 3);
  if (groups.includes('shape')) g[o + 13] = e;
  if (groups.includes('shape') && groups.includes('grn')) { g[o + 14] = on ? u : 0; g[o + 15] = on ? r : 0; }
}
// step P1: WILD founders' predation genes (group 'engulf'), from their own random stream (so a seed's other wild genes stay as in step T1b):
// the ENGULF gene and the KIN SPARING gene anywhere in 0..1, and the gene network's 17th output (ENGULF) four times in ten from a random
// regulator at a gain in -3..3 (only with the group 'grn' too)
export const BIO_P1 = 82;         // step P1: the engulf gene's word (Bio.kin.z; kin sparing at 83)
export function wildP1(g, rng, o = 0, groups = WILD_GROUPS) {
  const e = U(rng, 0, 1), sp = U(rng, 0, 1), on = rng() < 0.4, r = Math.min(7, Math.floor(rng() * 8)), u = U(rng, -3, 3);
  if (groups.includes('engulf')) { g[o + 82] = e; g[o + 83] = sp; }
  if (groups.includes('engulf') && groups.includes('grn')) { g[o + BIO_GRN + 70] = on ? u : 0; g[o + BIO_GRN + 71] = on ? r : 0; }
}
export function wildGenes(g, rng, o = 0, groups = WILD_GROUPS) {
  // (every group draws its numbers whether it is kept or not, so leaving a group out does not change the others' draws)
  const on = (k) => groups.includes(k);
  const set = (k, w, v) => { if (on(k)) g[o + w] = v; };
  const sgn = (x) => (x < 0 ? -1 : 1);
  set('body', 35, logU(rng, 3, 60));                                // heat tolerance
  set('body', 39, logU(rng, 0.2, 20));                              // permeability
  set('membrane', 40, U(rng, 0, 1)); set('membrane', 41, logU(rng, 0.002, 0.2)); set('membrane', 42, logU(rng, 0.3, 3)); set('membrane', 43, U(rng, -1, 1));
  for (let k = 0; k < 2; k++) {                                     // pumps
    const empty = rng() < 0.5, ch = PUMP_CHANNELS[Math.floor(rng() * PUMP_CHANNELS.length)] + (rng() < 0.5 ? PUMP_OUT : 0), rate = logU(rng, 0.05, 6);
    set('pumps', 44 + k, empty ? PUMP_OUT * k : ch); set('pumps', 46 + k, empty ? 0 : rate);
  }
  set('walls', 48, U(rng, -1, 1)); set('walls', 49, U(rng, -1, 1)); set('walls', 50, U(rng, 0, 1)); set('walls', 51, U(rng, 0, 1));   // walls, division axis
  set('lipids', 52, U(rng, 0, 1)); set('lipids', 53, U(rng, -1, 1)); set('lipids', 54, U(rng, 0, 1)); set('lipids', 55, U(rng, -4, 2));    // lipids, stretch channels
  const sB = sgn(g[o + 62]);
  set('fields', 56, logU(rng, 0.25, 4)); set('fields', 57, logU(rng, 0.1, 3)); set('fields', 58, U(rng, -2, 2)); set('fields', 59, logU(rng, 0.2, 4));   // field A
  set('fields', 60, logU(rng, 0.25, 4)); set('fields', 61, logU(rng, 0.1, 3)); set('fields', 62, sB * U(rng, 0, 2)); set('fields', 63, U(rng, 0, 4));  // field B (its sign kept)
  set('fields', 64, U(rng, -0.5, 0.5)); set('fields', 65, U(rng, -0.5, 0.5)); set('fields', 66, U(rng, -1, 1)); set('fields', 67, U(rng, -2, 2));    // angles, A'
  for (let k = 68; k <= 72; k++) set('gates', k, U(rng, -1, 1));   // the gates
  set('gates', 73, U(rng, 0, 2)); set('membrane', 74, U(rng, -2, 1.5)); set('membrane', 75, U(rng, -4, 2));   // push; stretch tolerance, ion channels
  set('kin', 79, U(rng, 0, 1)); set('kin', 80, U(rng, 0, 1)); set('kin', 81, U(rng, 0, 1));                     // display, kin channels, tolerance
  // step T1b: the gene network (drawn last, so the earlier groups' draws stay as they were; drawn whether kept or not)
  const net = new Array(BIO_FLOATS).fill(0);
  wildGrn(net, rng, 0);
  if (on('grn')) for (let k = BIO_GRN; k < BIO_G2; k++) g[o + k] = net[k];
}

/** The strategy a genome's engines amount to: 'harvest', 'burn', 'both' or 'other' (as the census and the view). */
export function strategyOf(g, o = 0) {
  let h = false, b = false;
  for (let k = 0; k < 3; k++) {
    if (!(g[o + 36 + k] > 0)) continue;
    const code = Math.round(g[o + 32 + k]), kind = ENGINES[Math.min(ENGINES.length - 1, code & 31)].kind;
    if (kind === 0 && code >> 5 > 0) h = true; else if (kind === 1 || (ELECTRONS && kind === 2)) b = true;   // (an uphill engine without a pigment
                                                                                                         // stores; C12d: breathing feeds too)
  }
  return h && b ? 'both' : h ? 'harvest' : b ? 'burn' : 'other';
}

export class Genome {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.mrng = makeRng(this.seed ^ 0x6c6c6c6c);   // step C6c: the membrane genes' own stream
    this.prng = makeRng(this.seed ^ 0x70756d70);   // step C7: the pump genes' own stream
    this.wrng = makeRng(this.seed ^ 0x77616c6c);   // step C10: the walls' genes' own stream
    this.drng = makeRng(this.seed ^ 0x64697661);   // step C11: the division axis's own stream
    this.lrng = makeRng(this.seed ^ 0x6c697064);   // step C12b: the lipid genes' own stream
    this.grng = makeRng(this.seed ^ 0x67617465);   // step C13: the gates' own stream
    this.irng = makeRng(this.seed ^ 0x696f6e73);   // step C12g: the ion channels' own stream
    this.brng = makeRng(this.seed ^ 0x62736e67);   // the founders' field-B sign (after the C12g + N1 merge): its own stream
    this.krng = makeRng(this.seed ^ 0x6b696e31);   // step T1a: the marker and kin genes' own stream
    this.xrng = makeRng(this.seed ^ 0x77696c64);   // step T1a: the wild founders' own stream
    this.erng = makeRng(this.seed ^ 0x656e6731);   // step P1: the wild founders' predation genes' own stream
    this.crng = makeRng(this.seed ^ 0x63617262);   // step C15b: the founders' carbon engines' own stream
    this.srng = makeRng(this.seed ^ 0x73686170);   // step S1: the wild founders' shape genes' own stream
    this.orng = makeRng(this.seed ^ 0x6d6f746f);   // step S2: the founders' motor genes' own stream
    this.trng = makeRng(this.seed ^ 0x74617374);   // step P3: the wild founders' taste genes' own stream
    this.frng = makeRng(this.seed ^ 0x666f6c64);   // step G3: the founders' regulator lattices and folds' own stream
    this.qrng = makeRng(this.seed ^ 0x7369676e);   // step Q1: the founders' signal genes' own stream
    this.foldP = null;                              // step G3: the moire genome's knobs (src/cells.js sets it: the folds' bounds, the buffer)
    this.founders = [];
    // live-tunable (moire.genome.params); the rule switches are keys
    this.params = {
      founders: 12,     // founder genomes at a fresh start (0 = every cell its own random genome)
      founderMode: 'std', // step T1a: 'std' today's founders, 'blank' the new abilities at 0, 'wild' every gene over its whole range
                        // (FOUNDER_MODES above; ?founders=wild|blank; acts on the next founders drawn: G, N, a new culture)
      wildGroups: WILD_GROUPS.slice(),   // step T1a: the gene groups wild founders draw over their whole range (?wild=fields,gates,...)
      cbFounder: CARBON_FOUNDER,   // step C15b: the chance a std founder gets its carbon engines (?cbfounder=)
      habit: null,      // step T1b: every founder's engines of this habit ('burn', 'both', 'pigments', 'other'; ?habit=); null: the usual spread
      bSign: 'mixed',   // the founders' field-B SENSING SIGN (the sign of the senseB gene, which with the C12g default is also the sign of
                        // their B charge): 'mixed' (default) each founder + or - at random from its own stream, both signs present
                        // whenever there are 2 or more founders; 'plus': all + (as from step C13 until this switch) (?bsign=plus)
      reach: 1.15,      // neighbours closer than reach x (r_i + r_j) are in contact (signals, adhesion)
      adhesion: 0.6,    // adhesion pull at full stickiness (as the contact push of an overlap of 0.6 R)
      adhSigma: 0.12,   // how alike keys must be to stick (Gaussian width in the wavevector difference)
      adhBase: 0.25,    // stickiness every pair loses (unlike neighbours push off a little; helps sorting)
      crawl: 0.6,       // crawling speed (R / s, times the motility factor); body traits (key B)
      turnRate: 0.5,    // how fast a crawling cell's heading wanders (rad^2 / s)
      turnover: 0.02,   // deaths per cell per s (each reborn as a neighbour's daughter; key T)
      unhappy: 2,       // extra death rate (x turnover) for a cell that recognises none of its neighbours
      mutSize: 1,       // size of the small mutations at each birth (key M switches mutation)
      mutJump: 0.03,    // chance per birth that one gene is drawn afresh
      engJump: 0.04,    // step C6: chance per birth that one engine slot jumps (to another reaction, another pigment band,
                        // or empty; an empty one may start up again)
      pumpJump: 0.04,   // step C7: chance per birth that one pump slot jumps (another substance, the other direction, or
                        // empty; an empty one starts up at a small rate)
      ripple: 0.4,      // ripple strength of a birth (a death dips by 0.7 of it); 0 = none
    };
    this.rules = { adh: true, body: true, turn: true, mut: true };   // (step F0: diff and inherit went with the fates)
  }

  /** Bits for Sim.rules. */
  ruleBits() {
    const r = this.rules;
    return (r.adh ? RULE.ADH : 0) | (r.turn ? RULE.TURN : 0) | (r.mut ? RULE.MUT : 0);
  }

  /** Draw a fresh set of founder genomes (key G). With founders = 0, every cell gets its own (made in fill). */
  newFounders() {
    const n = Math.max(0, Math.round(this.params.founders));
    this.founders = [];
    for (let k = 0; k < n; k++) {
      const g = randomGenome(this.rng, k, this.mrng, this.prng, this.wrng, this.drng, this.lrng, this.grng, this.irng);
      // step C6: a spread of engine sets over the founders (step T1b: or every founder one habit, ?habit=; the Colonies preset's 'both')
      const habit = HABITS.includes(this.params.habit) ? this.params.habit : STRATEGIES[k % STRATEGIES.length];
      engines(g, this.rng, habit);
      founderCarbon(g, this.crng, habit, this.params.founderMode === 'wild', this.params.cbFounder ?? CARBON_FOUNDER);   // step C15b (its own stream)
      membrane(g, this.mrng, k % 4 === 3);                         // step C6c: mostly light thin membranes, a few heavy
      lipids(g, this.lrng, k % 4 === 1);                           // step C12b: a few founders build a crust wall
      this.founders.push(g);
    }
    this.mixBSigns(this.founders);
    this.finishFounders(this.founders);
  }

  /**
   * Step T1a: the founders' marker and kin genes (their own stream, so every other gene of a seed stays as it was), then the founder
   * mode (blank: the new abilities at 0; wild: every gene over its range, from the wild stream). Last, after the B signs.
   */
  finishFounders(list) {
    const mode = this.params.founderMode;
    for (const g of list) {
      t1Genes(g, this.krng);
      if (mode === 'blank') blankGenes(g);
      else if (mode === 'wild') {
        wildGenes(g, this.xrng, 0, this.params.wildGroups); wildP1(g, this.erng, 0, this.params.wildGroups);
        wildS1(g, this.srng, 0, this.params.wildGroups);   // step S1
      }
      motorGenes(g, this.orng, 0, mode === 'wild', this.params.wildGroups);   // step S2 (every mode: std and blank founders without motors)
      tasteGenes(g, this.trng, 0, mode === 'wild', this.params.wildGroups);   // step P3 (every mode: std and blank founders without a taste)
      signalGenes(g, this.qrng, 0, mode === 'wild', this.params.wildGroups);   // step Q1 (every mode: std and blank founders silent)
      stampLattices(g, this.frng, 0, this.foldP);   // step G3: every founder's regulator lattices and folds (without outputs they change nothing)
      if (this.foldP && this.foldP.on && this.foldP.founderOut && mode !== 'wild') founderOutputs(g, this.frng, 0, this.foldP);   // ... and outputs
    }
    // step T1b: wild founders' markers turned a golden angle apart (no random number drawn), so in the lineage view any few surviving
    // founders show clearly different hues (their markers are strangers either way)
    if (mode === 'wild' && list.length > 1) list.forEach((g, k) => { g[76] = (list[0][76] + k * 2 * Math.PI * 0.381966) % (2 * Math.PI); });
  }

  /**
   * The founders' field-B sensing sign (Bio fb.z, gene senseB): with bSign 'mixed' each + or - at random from its own stream
   * (so every other gene of a seed stays as it was), and when all came out alike with 2 or more, one at random flips, so both
   * signs are present. With the C12g default (field B's charge = qGene x this sign) like repels like and unlike attracts.
   */
  mixBSigns(list) {
    if (this.params.bSign !== 'mixed' || !list.length) return;
    const s = list.map(() => (this.brng() < 0.5 ? -1 : 1));
    if (s.length > 1 && s.every((x) => x === s[0])) s[Math.floor(this.brng() * s.length)] *= -1;
    list.forEach((g, k) => { g[BIO_FG + 6] = s[k] * Math.abs(g[BIO_FG + 6] || 1); });
  }

  /**
   * Fill the Bio records of n cells (Float32Array f) and return each
   * cell's key (angle, scale) for the Cell copies. Each cell is a copy of a random founder.
   */
  fill(f, n, pick = null) {
    if (!this.founders.length && this.params.founders > 0) this.newFounders();
    // (step T1a: founders saved before it get a marker each, no kin channels, once)
    for (const fd of this.founders) {
      if (fd.length > BIO_T1) continue;
      const len = fd.length;
      while (fd.length < BIO_FLOATS) fd.push(0);
      if (len <= BIO_FG) fieldDefaults(fd);   // (... and before step C13 the field genes)
      t1Genes(fd, this.krng);
    }
    const keys = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      // (app: `pick(i)`, if given, chooses cell i's founder by its index, e.g. one founder per colony; else at random)
      const fi = pick && this.founders.length ? pick(i, this.founders.length) : -1;
      let g = this.founders.length ? this.founders[fi >= 0 ? fi % this.founders.length : Math.floor(this.rng() * this.founders.length)]
        : randomGenome(this.rng, i, this.mrng, this.prng, this.wrng, this.drng, this.lrng, this.grng, this.irng);
      if (!this.founders.length && this.params.bSign === 'mixed') { g = g.slice(); g[BIO_FG + 6] = this.brng() < 0.5 ? -1 : 1; }   // (each its own)
      if (!this.founders.length) { g = g.slice(); this.finishFounders([g]); }   // (step T1a: each its own marker, the founder mode)
      const o = i * BIO_FLOATS;
      for (let k = 0; k < BIO_FLOATS; k++) f[o + k] = g[k] ?? 0;   // (founders from a snapshot before step C10 lack the walls' genes, before C12b the lipids')
      if (g.length <= BIO_FG) fieldDefaults(f, o);   // (... before step C13 the field genes: today's values)
      for (let k = 20; k < 31; k++) f[o + k] = 0;   // accumulators and step 6 state start empty (32..47: step C6's, C6c's and C7's genes;
                                                    //  step G1: word 31 is the fidelity gene, the founder's: 0)
      stampFounderGlue(f, o);                       // step G0: the founder's glue (Bio.rec.z), what the glue's neutral control acts with
      nameFamilies(f, o);                           // step G2: the working slots' family ids (the founder's)
      keys[2 * i] = g[0]; keys[2 * i + 1] = g[1];
    }
    return keys;
  }
}

/**
 * Step G2: name the working engine and pump slots of genome g (at word o) that have no FAMILY yet, as the step names them at a birth
 * (cell_step.wgsl dup_birth: 1 + 16 x founder + slot, pumps + 8; x 8 + the gene-network output an engine slot follows, its own for 0..2);
 * empty slots get none. Founders and hand-made genomes, so the dish's first cells already carry their families.
 */
export function nameFamilies(g, o = 0) {
  const fnd = Math.min(65535, Math.max(0, Math.round(g[o + 7] || 0)));
  const fam = (k) => ((1 + 16 * fnd + k) % FAM_NEW) * 8;
  for (let k = 0; k < 5; k++) {
    const rate = k < 3 ? g[o + 36 + k] : g[o + BIO_G2 + 2 + (k - 3)], w = k < 4 ? o + BIO_G2 + 4 + k : o + BIO_G2 + 8;
    if (!(rate > 0)) g[w] = 0; else if (!(g[w] >= 0.5)) g[w] = fam(k) + Math.min(k, 2);
  }
  for (let k = 0; k < 2; k++) {
    const w = o + BIO_G2 + 9 + k;
    if (!(g[o + 46 + k] > 0)) g[w] = 0; else if (!(g[w] >= 0.5)) g[w] = fam(8 + k);
  }
}
export const FAM_NEW = 1048576;   // fresh family ids lie in FAM_NEW .. 2 FAM_NEW - 1 (cell_common.wgsl FAM_NEW)
/** Step G2: a family word's parts: { id, reg (the gene-network output an engine slot follows), copy (made by duplication) }. */
export function famOf(w) { const v = Math.round(w || 0); return { id: Math.floor(v / 8), reg: v & 3, copy: (v & 4) !== 0 }; }

/**
 * App (the add-cell tool, the new culture's diversity): one founder genome of a habit, as a fresh culture's founders get them:
 * 'burn' (eaters), 'both' (light + burn), 'pigments' (photosynthesisers / harvesters), 'other'. `rng` a random function.
 */
export function founderGenome(strategy, rng = Math.random, founder = 0, bSign = 'mixed', t1 = true) {
  const g = randomGenome(rng, founder);
  engines(g, rng, STRATEGIES.includes(strategy) || (strategy === 'carbon' && CARBON) ? strategy : 'burn');
  if (bSign === 'mixed') g[BIO_FG + 6] = rng() < 0.5 ? -1 : 1;   // the field-B sign (drawn last, so the other genes stay as they were)
  if (t1) t1Genes(g, rng);                                       // step T1a: a marker of its own (after, for the same reason)
  signalGenes(g, makeRng((Math.imul(founder + 1, 2654435761) ^ 0x7369676e) >>> 0), 0, false);   // step Q1: silent, a flavour (its own stream)
  return g;
}
export const HABITS = ['burn', 'both', 'pigments', 'other', ...(CARBON && ELECTRONS ? ['carbon'] : [])];   // (step C15b: + carbon eaters)

/**
 * Step P1: a HAND-MADE PREDATOR (the add-cell tool's founder "predator", moire.predators.genome()): a big cell (size gene at its top, 1.25)
 * with the engulf gene high and kin sparing as asked (0: a cannibal), little glue (it sticks to nothing it would eat), crawling a little more,
 * and engines that live on what cells hold: bonding free atoms (g + t -> gt), breathing (t + gT -> gt + T) and a fermenter (G + gT -> GT + g).
 * opts: { engulf (1), spare (0), size (1.25), rng }
 */
export function predatorGenome(opts = {}) {
  const rng = opts.rng || Math.random;
  const g = founderGenome('burn', rng, opts.founder ?? 900);
  for (let k = 0; k < 3; k++) slot(g, k, E('g + t → gt'), 0, 0);
  if (ELECTRONS) {
    slot(g, 0, E('g + t → gt'), 2, 0);
    slot(g, 1, E('t + gT → gt + T'), 2, 0);
    slot(g, 2, E('G + gT → GT + g'), 1, 0);
  }
  g[16] = 0.15;                                   // little glue
  g[17] = opts.size ?? 1.25;                      // big (the size gene's top)
  g[18] = 1.6;                                    // crawls a little more
  g[82] = Math.max(0, Math.min(1, opts.engulf ?? 1));
  g[83] = Math.max(0, Math.min(1, opts.spare ?? 0));
  // step P3: a taste, if asked (opts.taste: [oxygen, exhaust, spill, heat], -1..1; opts.range -2..2), and a flagellum (opts.flagellum 0..1)
  if (opts.taste) for (let k = 0; k < 4; k++) g[BIO_TASTE + k] = Math.max(-1, Math.min(1, Number(opts.taste[k]) || 0));
  if (opts.range != null) g[BIO_TASTE + 4] = Math.max(-2, Math.min(2, Number(opts.range) || 0));
  if (opts.flagellum != null) { g[168] = Math.max(0, Math.min(1, opts.flagellum)); g[169] = 1; g[170] = 0; }
  return g;
}
