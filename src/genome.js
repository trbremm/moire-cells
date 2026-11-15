// The cells' genome ("DNA"): random at the start, copied with small mutations at each birth.
//
// Layout: struct Bio in cell_common.wgsl, 24 floats (96 bytes) per cell, double-buffered on the GPU.
//   key    x key angle (0..60 deg), y key scale (log period factor, -0.15..0.15),
//          z receptor angle, w receptor scale            -> WHICH keys the cell recognises (specific)
//   rec    x receptor width (pickiness), y threshold, z output once committed, w founder id (a whole number, as a float)
//   resp   per fate channel (epithelium, muscle, neuron, cartilage): recognised contact -> accumulator
//   relay  per fate channel: a committed neighbour's signal on that channel -> accumulator
//   body   x adhesion, y size factor, z motility factor, w spare
//   acc    state (not inherited as genes): the four leaky accumulators
//   env    state: x y spare (the nutrient and threat felt, until step C3); z the A felt (integrated), w converted (step 6)
//   conv   state (step 6): x the converted share of the neighbourhood (integrated, for the relay); y z w spare
//   eng    step C6, genes: x y z the three ENGINE SLOTS, each a whole number: the engine's index in ENGINES (src/matter.js)
//          + 32 x the light band its pigment catches (1 visible 1, 2 visible 2, 3 hard; 0 none: an uphill engine then
//          runs on the battery, a storer; used by uphill engines only);
//          w the HEAT TOLERANCE (temperature, heat per R^2)
//   rate   step C6, genes: x y z each slot's rate (0 = an empty slot; burn, swap, form: the share of what it works on per s;
//          harvest: the amount of pigment, its optical depth is pigK x rate); w the PERMEABILITY (per s, for the light atoms)
//   memb   step C6c, genes of the membrane (src/membrane.js): x MIX, the heavy linkers' (L) share of the membrane (0..1, the
//          rest light l); y THICKNESS, linker per R of membrane (atom-units); z the STIFFNESS gene (x what the material
//          gives: heavy and thick = stiff); w the ION SELECTIVITY s (-1..1: givers pass x (1 + s), takers x (1 - s))
//   pump   step C7, genes of the two PUMP SLOTS (src/pumps.js): x y each slot's code, a whole number: the substance's channel
//          (0..12, SUBSTANCES order; sediment is never pumped) + 16 x its direction (0 IN, 1 OUT); z w each slot's rate (per s:
//          the share of the source side's amount, per cell volume, it moves; 0 = an empty slot)
// The key is the cell's own lattice (Cell.la and Cell.aux carry copies), so it shows in the dot pattern.
//
// Seeding: `founders` random genomes (0 = every cell its own), each cell a copy of one of them, scattered at
// random. A seeded random generator (?seed=N) makes the start repeatable.

import { ENGINES, engineIndex } from './matter.js';

export const BIO_FLOATS = 48;   // (40 until step C6c's membrane genes, 44 until step C7's pumps)
export const BIO_BYTES = BIO_FLOATS * 4;

export const KEY_SPAN = Math.PI / 3;
export const KEY_SMAX = 0.15;

// rule bits (keep in step with RULE_* in cell_common.wgsl)
// (bit 32 was rule E, nutrient and threat, until step C3)
export const RULE = { DIFF: 1, ADH: 2, TURN: 4, MUT: 8, INHERIT: 16 };

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
export function randomGenome(rng, founder, mrng = rng, prng = mrng) {
  const g = new Array(BIO_FLOATS).fill(0);
  g[0] = U(rng, 0, KEY_SPAN); g[1] = U(rng, -KEY_SMAX, KEY_SMAX);
  g[2] = U(rng, 0, KEY_SPAN); g[3] = U(rng, -KEY_SMAX, KEY_SMAX);
  g[4] = logU(rng, 0.06, 0.25);          // receptor width
  g[5] = U(rng, 0.6, 1.6);               // threshold
  g[6] = U(rng, 0.4, 1.4);               // output once committed
  g[7] = founder;                        // founder id (exact as a float up to 2^24)
  for (let c = 0; c < 4; c++) g[8 + c] = U(rng, -1, 1);    // resp
  for (let c = 0; c < 4; c++) g[12 + c] = U(rng, -1, 1);   // relay
  g[16] = U(rng, 0, 1);                  // adhesion
  g[17] = U(rng, 0.85, 1.15);            // size
  g[18] = logU(rng, 0.5, 2);             // motility
  g[19] = U(rng, 0, 2 * Math.PI);        // crawling heading (state, not a gene)
  engines(g, rng, STRATEGIES[Math.floor(rng() * STRATEGIES.length)]);
  membrane(g, mrng, mrng() < 0.25);   // step C6c (its own random stream, so a seed's founders keep their other genes)
  pumps(g, prng);                      // step C7 (its own stream too)
  return g;
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

/** Fill the engine genes (slots, tolerance, permeability) of genome g for a strategy. */
function engines(g, rng, strategy) {
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
  g[43] = U(rng, -0.08, 0.08);                                                 // ion selectivity
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

/** The strategy a genome's engines amount to: 'harvest', 'burn', 'both' or 'other' (as the census and the view). */
export function strategyOf(g, o = 0) {
  let h = false, b = false;
  for (let k = 0; k < 3; k++) {
    if (!(g[o + 36 + k] > 0)) continue;
    const code = Math.round(g[o + 32 + k]), kind = ENGINES[Math.min(ENGINES.length - 1, code & 31)].kind;
    if (kind === 0 && code >> 5 > 0) h = true; else if (kind === 1) b = true;   // (an uphill engine without a pigment stores)
  }
  return h && b ? 'both' : h ? 'harvest' : b ? 'burn' : 'other';
}

export class Genome {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.mrng = makeRng(this.seed ^ 0x6c6c6c6c);   // step C6c: the membrane genes' own stream
    this.prng = makeRng(this.seed ^ 0x70756d70);   // step C7: the pump genes' own stream
    this.founders = [];
    // live-tunable (moire.genome.params); the rule switches are keys
    this.params = {
      founders: 12,     // founder genomes at a fresh start (0 = every cell its own random genome)
      tau: 2.0,         // accumulator time constant (s): brief contacts fade, sustained ones add up
      release: 0.3,     // a committed cell returns to stem when its channel falls below release x threshold
      reach: 1.15,      // neighbours closer than reach x (r_i + r_j) are in contact (signals, adhesion)
      adhesion: 0.6,    // adhesion pull at full stickiness (as the contact push of an overlap of 0.6 R)
      adhSigma: 0.12,   // how alike keys must be to stick (Gaussian width in the wavevector difference)
      fateAdh: 0.5,     // extra stickiness between cells of the same committed fate
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
    this.rules = { diff: true, adh: true, body: true, turn: true, mut: true, inherit: false };
  }

  /** Bits for Sim.rules. */
  ruleBits() {
    const r = this.rules;
    return (r.diff ? RULE.DIFF : 0) | (r.adh ? RULE.ADH : 0) | (r.turn ? RULE.TURN : 0) |
      (r.mut ? RULE.MUT : 0) | (r.inherit ? RULE.INHERIT : 0);
  }

  /** Draw a fresh set of founder genomes (key G). With founders = 0, every cell gets its own (made in fill). */
  newFounders() {
    const n = Math.max(0, Math.round(this.params.founders));
    this.founders = [];
    for (let k = 0; k < n; k++) {
      const g = randomGenome(this.rng, k, this.mrng, this.prng);
      engines(g, this.rng, STRATEGIES[k % STRATEGIES.length]);   // step C6: a spread of engine sets over the founders
      membrane(g, this.mrng, k % 4 === 3);                         // step C6c: mostly light thin membranes, a few heavy
      this.founders.push(g);
    }
  }

  /**
   * Fill the Bio records of n cells (Float32Array f) and return each
   * cell's key (angle, scale) for the Cell copies. Each cell is a copy of a random founder.
   */
  fill(f, n) {
    if (!this.founders.length && this.params.founders > 0) this.newFounders();
    const keys = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const g = this.founders.length ? this.founders[Math.floor(this.rng() * this.founders.length)] : randomGenome(this.rng, i, this.mrng, this.prng);
      const o = i * BIO_FLOATS;
      for (let k = 0; k < BIO_FLOATS; k++) f[o + k] = g[k];
      for (let k = 20; k < 32; k++) f[o + k] = 0;   // accumulators and step 6 state start empty (32..47: step C6's, C6c's and C7's genes)
      keys[2 * i] = g[0]; keys[2 * i + 1] = g[1];
    }
    return keys;
  }
}
