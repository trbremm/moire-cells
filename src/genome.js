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
// The key is the cell's own lattice (Cell.la and Cell.aux carry copies), so it shows in the dot pattern.
//
// Seeding: `founders` random genomes (0 = every cell its own), each cell a copy of one of them, scattered at
// random. A seeded random generator (?seed=N) makes the start repeatable.

import { ENGINES, engineIndex } from './matter.js';

export const BIO_FLOATS = 40;
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
export function randomGenome(rng, founder) {
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
      const g = randomGenome(this.rng, k);
      engines(g, this.rng, STRATEGIES[k % STRATEGIES.length]);   // step C6: a spread of engine sets over the founders
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
      const g = this.founders.length ? this.founders[Math.floor(this.rng() * this.founders.length)] : randomGenome(this.rng, i);
      const o = i * BIO_FLOATS;
      for (let k = 0; k < BIO_FLOATS; k++) f[o + k] = g[k];
      for (let k = 20; k < 32; k++) f[o + k] = 0;   // accumulators and step 6 state start empty (32..39: step C6's genes)
      keys[2 * i] = g[0]; keys[2 * i + 1] = g[1];
    }
    return keys;
  }
}
