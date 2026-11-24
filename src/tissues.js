// Step T1c: DESIGNED TISSUES (BUILD QUEUE 6, 2026-11-17; README "Step T1c: designed tissues"). The user: "could we design some tissues
// that run in our engine? like light eaters surrounded by strong celled ones (like plants)". Each design is ONE genome (same DNA,
// different jobs): its gene network (step T1b) is wired by hand so that WHERE a cell sits decides what it does, through the senses the
// network already has (contacts, light, free t, the neighbours' broadcast signal). Nothing here is a new rule of the simulation: a
// design is only a genome, placed like any other cell (the add-cell tool, the cells zoo's "Designed tissues" buttons), and it mutates
// like any other once mutation is on.
//
//   plant      LIGHT EATERS INSIDE, BARK AT THE RIM: a regulator reads the CONTACT sense (the share of the six sides pressed against a
//              neighbour); with two or more free sides it switches on (a second regulator sharpens it), and in those rim cells it turns
//              the pigment down (x 0.2), the crust wall, the membrane's thickness and its stiffness up (x 4) and the glue a little up
//              (x 1.5). Enclosed cells keep a full pigment and a thin soft membrane. Kin channels open, so fuel and linkers can flow
//              between the core and the bark.
//   filament   A CHAIN OF LIGHT EATERS WITH A THICK-WALLED BREATHER EVERY FEW CELLS (heterocyst-like): sticky ENDS (the C10 two-fold wall
//              pattern) and division ALONG the front (C11), so daughters line up. A breather regulator H activates itself and is
//              switched off by the CONTACT SIGNAL; every cell broadcasts a RELAY regulator that is high in a breather and in a cell that
//              hears one (a signal that fades over two or three cells): LATERAL INHIBITION, so breathers space themselves. H turns the
//              pigment off, the breathing engine (t + gT -> gt + T: eats the chain's oxygen-like t) and the wall and thickness up.
//              Free t inside nudges H on (breathers arise where oxygen piles up).
//   biofilm    CRUST-BUILDING TOP, FERMENTING BOTTOM: a TOP regulator reads the LIGHT (and, a little, free sides); lit cells build a crust
//              wall (x 4) and turn their pigment up (x 4); a BOTTOM regulator (the inverse) turns a fermenting engine (G + gT -> GT + g,
//              living on vent fuel without light) up (x 4); the bottom keeps a quarter of the top's pigment.
//
// No sense or output had to be added: contacts, light, free t, the broadcast signal and the existing outputs (pigment, engine slots,
// wall, thickness, stiffness, glue) are enough.
//
// moire.tissues: DESIGNS, genome(name), place(name, { x, y, n, shape: 'disc' | 'line' | 'scatter', loose }), census() (the cells of a
// design by JOB: the job regulator above / below 0.5, where they sit, their battery, membrane, wall, what they express; and the pattern's
// fidelity: rim cells that are bark, breathers' spacing along the chain, top cells in the light). URL: ?tissue=plant|filament|biofilm
// makes the culture's founder the design (with ?spread=, ?cells=: a clump is a tissue, scatter the same cells loose; ?grnnull=1 the same
// genome with its network nulled).

import { BIO_FLOATS, BIO_GRN, BIO_G2, BIO_Q1, founderGenome, makeRng } from './genome.js';
import { derive, latticesOf, W_LA, W_LK, W_LP, W_FH, W_FS, W_GS } from './folding.js';
import { engineIndex } from './matter.js';
import { grnOf, SENSES, OUTPUTS } from './grn.js';
import { CELL_FLOATS } from './cells.js';
import { SW } from './eat.js';
import { readBuffer, settle } from './snapshot.js';
import { setTendrils } from './tendrils.js';   // step T2

const C_POS = 0, C_R = 4, C_FLAGS = 9, C_BAT = 16, C_INTEG = 48, C_NBR = 60, C_LIP = 72, C_OSM = 84, C_SNS0 = 86, C_SNS1 = 87;

// ---------- wiring a network by hand ----------
/** A source's code: 'r0'..'r7' a regulator, else a sense's name (grn.js SENSES). */
function src(name) {
  if (/^r[0-7]$/.test(name)) return 1 + Number(name[1]);
  const k = SENSES.indexOf(name);
  if (k < 0) throw new Error(`tissues: unknown source ${name}`);
  return 9 + k;
}
/**
 * Write a network into genome g: regs = [{ bias, x0, inputs: [[source, weight], ... up to 3] }, ...] (regulator k = regs[k]; the rest none,
 * expression x0 or 0.5), outputs = { name: [regulator, gain] } (grn.js OUTPUTS: 'pigment', 'engine 1', 'wall', ...), broadcast = the
 * regulator each cell broadcasts as its contact signal, kinWeight = how far the signal listens to kin only.
 */
export function wire(g, { regs, outputs = {}, broadcast = 0, kinWeight = 0 }) {
  const b = BIO_GRN;
  for (let k = b; k < BIO_G2; k++) g[k] = 0;   // (step G2: up to the duplicate slots)
  for (let r = 0; r < 8; r++) {
    const R = regs[r] || { bias: 0, inputs: [] };
    g[b + r] = R.x0 ?? 0.5;
    g[b + 8 + r] = R.bias || 0;
    let code = 0;
    (R.inputs || []).slice(0, 3).forEach(([s, w], k) => { g[b + 16 + 3 * r + k] = w; code += src(s) * 32 ** k; });
    g[b + 40 + r] = code;
  }
  const regWords = [0, 0, 0, 0];
  for (const [name, [r, u]] of Object.entries(outputs)) {
    const o = OUTPUTS.indexOf(name);
    if (o < 0) throw new Error(`tissues: unknown output ${name}`);
    if (o === 16) { g[b + 70] = u; g[b + 71] = r; continue; }   // (the 17th output, engulf, lives in gm.z, gm.w)
    if (o === 17) { g[14] = u; g[15] = r; continue; }           // (step S1: the 18th, shape, in relay.z, relay.w)
    if (o === 18 || o === 19) { g[176 + 2 * (o - 18)] = u; g[177 + 2 * (o - 18)] = r; continue; }   // (step S2: flagellum, cilia, in mg)
    if (o === 20 || o === 21) { g[232 + 2 * (o - 20)] = u; g[233 + 2 * (o - 20)] = r; continue; }   // (step Q1: the releases, in so)
    if (o === 22) { g[186] = u; g[187] = r; continue; }                                             // (step L1: contract, in tb.z, tb.w)
    if (o >= 23 && o <= 25) { g[248 + 2 * (o - 23)] = u; g[249 + 2 * (o - 23)] = r; continue; }   // (step T2: grow tendrils, retract, mineralise)
    g[b + 48 + o] = u;
    regWords[o >> 2] += r * 8 ** (o & 3);
  }
  for (let w = 0; w < 4; w++) g[b + 64 + w] = regWords[w];
  g[b + 68] = broadcast; g[b + 69] = kinWeight;
  return g;
}

const E = (name) => { const k = engineIndex(name); if (k < 0) throw new Error(`tissues: no engine ${name}`); return k; };
const slot = (g, k, name, rate, band = 0) => { g[32 + k] = E(name) + 32 * band; g[36 + k] = rate; };
const X4 = Math.log(4);   // an output gain that gives x 4 at full expression (the cap)

/** The genes every design shares: a quiet, sticky, kin-friendly cell (no pumps, no predation, a full marker, kin channels open). */
function base(rng, founder) {
  const g = founderGenome('both', rng, founder, 'plus');
  g[16] = 0.7;                 // glue a0
  g[17] = 1.0;                 // size
  g[18] = 0.4;                 // motility (crawls little: a tissue stays put)
  g[35] = 30; g[39] = 3;       // heat tolerance (twice C5's 15: a busy clump in steady light runs at 15 .. 18 and died of heat), permeability
  g[40] = 0.1; g[41] = 0.012; g[42] = 1; g[43] = 0;   // membrane: oil share, thickness (MEMB_THIN), stiffness gene, selectivity
  g[44] = 0; g[45] = 16; g[46] = 0; g[47] = 0;        // no pumps
  g[48] = 0; g[49] = 0; g[50] = 0; g[51] = 0.5;       // uniform walls, the front its own, division axis half way
  g[52] = 0.15; g[53] = 0; g[54] = 0.5; g[55] = 0;    // lipids: a thin crust wall (x 4 where the network asks), neutral heads, mixed row
  for (let k = 68; k <= 72; k++) g[k] = 0;            // no guide gates
  g[73] = 1; g[74] = 0; g[75] = 0;                    // push 1, stretch tolerance and ion channels at the knobs
  g[79] = 1; g[80] = 0.8; g[81] = 0.5;                // marker shown, kin channels open, tolerance (a clone is kin)
  g[82] = 0; g[83] = 0;                               // no engulfing
  g[56] = 0.5;                                        // field A's lever x 0.5: a long beat (the tissue series: a long beat glues)
  return g;
}

export const DESIGNS = {
  plant: {
    label: 'plant',
    desc: 'light eaters inside, bark at the rim: cells with two or more free sides build a crust wall, a thick stiff membrane and stick harder, and keep little pigment',
    shape: 'disc',
    job: 1, jobs: ['core (light eater)', 'bark'],
    reporter: 1,
    genome(rng = Math.random, founder = 700) {
      const g = base(rng, founder);
      for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
      slot(g, 0, 'gt → g + t', 1.2, 2);       // the pigment: visible 2 splits the mineral (the light pays 3 of 4.5)
      slot(g, 1, 'g + t → gt', 2.4);          // ... and the burn of what it split (the battery)
      slot(g, 2, 'G + gT → GT + g', 0.8);     // a fermenter: vent fuel without light (what bark can live on)
      return wire(g, {
        regs: [
          { bias: 4.5, x0: 0.2, inputs: [['contact', -8], ['r0', 4]] },     // r0 RIM: two or more free sides
          { bias: -4, x0: 0.1, inputs: [['r0', 8]] },                       // r1 BARK: r0 sharpened
        ],
        outputs: { pigment: [1, -1.6], wall: [1, X4], thickness: [1, X4], stiffness: [1, X4], glue: [1, Math.log(1.5)] },
        broadcast: 1,
      });
    },
  },
  filament: {
    label: 'filament',
    desc: 'a chain of light eaters with a thick-walled breather every few cells (heterocyst-like): sticky ends, division along the chain, breathers spaced by lateral inhibition through the neighbours\' signal',
    shape: 'line',
    job: 2, jobs: ['light eater', 'breather'],
    reporter: 2,
    genome(rng = Math.random, founder = 710) {
      const g = base(rng, founder);
      // ends sticky (two-fold), sides not; daughters put along the front (the tissue series' end-to-end chains: adhesion 0.5, a2 0.5, a
      // long beat, turning); it hardly crawls (a chain dragged toward the food balls up)
      g[16] = 0.5; g[48] = 0; g[49] = 0.5; g[51] = 0; g[18] = 0.05;
      for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
      slot(g, 0, 'gt → g + t', 1.2, 2);       // the pigment: visible 2 splits the mineral (free g and the oxygen-like t)
      slot(g, 1, 'g + t → gt', 2.4);          // ... the burn of what it split; the t that leaks out is the chain's oxygen
      slot(g, 2, 't + gT → gt + T', 0.4);     // breathing: eats t with fuel (x 4 in breathers)
      return wire(g, {
        regs: [
          { bias: -3, x0: 0, inputs: [['r0', 6], ['signal', -10], ['free t', 2]] },   // r0 H, the breather: itself on (free t pushes), the relay off
          { bias: -4, x0: 0, inputs: [['r0', 8], ['signal', 5]] },                     // r1 RELAY: high in a breather, fading over two or three cells
                                                                                         // (monostable: without a breather it dies away)
          { bias: -4, x0: 0, inputs: [['r0', 8]] },                                    // r2 H sharpened (what the outputs read)
        ],
        outputs: { pigment: [2, -6], 'engine 3': [2, X4], wall: [2, X4], thickness: [2, X4], stiffness: [2, Math.log(2)] },
        broadcast: 1,
      });
    },
  },
  biofilm: {
    label: 'biofilm',
    desc: 'a crust-building top and a fermenting bottom: lit cells build a crust wall and keep their pigment; shaded cells switch the pigment off and ferment vent fuel',
    shape: 'disc',
    job: 1, jobs: ['bottom (fermenter)', 'top (crust)'],
    reporter: 1,
    genome(rng = Math.random, founder = 720) {
      const g = base(rng, founder);
      g[52] = 0.2;
      for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
      slot(g, 0, 'gt → g + t', 0.3, 2);       // the pigment: little at the bottom, x 4 at the top
      slot(g, 1, 'g + t → gt', 2.4);          // its burn
      slot(g, 2, 'G + gT → GT + g', 0.6);     // a fermenter (x 4 at the bottom)
      return wire(g, {
        regs: [
          { bias: -2.4, x0: 0.5, inputs: [['light', 8], ['contact', -1]] },   // r0 TOP: in the light (above about 0.2), a little more with free sides
          { bias: -4, x0: 0.5, inputs: [['r0', 8]] },                         // r1 TOP sharpened
          { bias: 4, x0: 0.5, inputs: [['r0', -8]] },                         // r2 BOTTOM: the inverse
        ],
        outputs: { pigment: [1, X4], wall: [1, X4], thickness: [1, Math.log(2)], 'engine 3': [2, X4] },
        broadcast: 1,
      });
    },
  },
};
// step Q1: the RELAY's regulators as LATTICES (the moire genome derives the links from them; found by a search over placements near the
// signal's junction sense, src/tissues.js relayGenome): r0 RELEASE (fast; the release outputs read it, inverted), r1 REFRACTORY (slow), r2
// EXCITE (fast); the other five parked far away (lk -0.6), so they link with none of these
const RELAY_LATTICES = {
  th: [0.478, 0.519, 0.508, 0.05, 0.25, 0.45, 0.65, 0.85],
  lk: [0.677, 0.698, 0.717, -0.6, -0.6, -0.6, -0.6, -0.6],
  ph: [4.946, 0.261, 1.672, 3 * 1.3, 4 * 1.3, 5 * 1.3, 6 * 1.3, 7 * 1.3],
};
/**
 * Step Q1: the hand-wired RELAY (an EXCITABLE sheet; a scientist's design, the evolving dishes must find their own). Its moire-genome lattices
 * derive (sigma 0.12, wMax 4) r0 = {r1 +2.6, heard through junctions -2.5, r2 -2.2}, r1 = {r2 +3.2, r0 -2.7}, r2 = {r0 -2.9, r1 -2.3, heard
 * through junctions +1.5}; biases 1, 0, 1; r0 and r2 FAST (0.3 s), r1 slow (5 s). At rest r0 is high (0.75), so the release (gain -8: e^(-8
 * x0)) is ~0.25 % of the gene; hearing the signal through a junction pulls r0 down and r2 up (each the other's off-switch: a quick flip),
 * so the cell FIRES: it releases its own flavour through every formed junction, which fires its neighbours; r1 climbs over a few seconds and
 * puts r0 back up and r2 down (refractory: it cannot fire again until r1 has fallen). Release 1, all through junctions (share 1), its
 * receptor tuned to its own flavour. Glue 1.5 (junctions form in a sheet), it barely crawls. The cached links (the network's words) are the
 * derived ones, so ?g3=0 runs the same wiring as free weights.
 */
export function relayGenome(rng = Math.random, founder = 730, flavour = 0) {   // (flavour 0: the signal pipette's first, sky blue in the signals view)
  const g = base(rng, founder);
  g[16] = 1.5; g[18] = 0.1;   // glue (junctions form in a sheet), barely crawls
  for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
  slot(g, 0, 'gt → g + t', 1.2, 2);       // a light eater: the pigment splits the mineral
  slot(g, 1, 'g + t → gt', 2.4);          // ... and burns what it split (the battery)
  const x0 = [0.75, 0.18, 0.17, 0.5, 0.5, 0.5, 0.5, 0.5], bias = [1, 0, 1, 0, 0, 0, 0, 0];
  wire(g, { regs: x0.map((x, r) => ({ bias: bias[r], x0: x, inputs: [] })) });
  for (let r = 0; r < 8; r++) { g[W_LA + r] = RELAY_LATTICES.th[r]; g[W_LK + r] = RELAY_LATTICES.lk[r]; g[W_LP + r] = RELAY_LATTICES.ph[r]; }
  g[W_FH] = 0; g[W_FH + 1] = 0; g[W_FH + 2] = 0; g[W_FH + 3] = 0.05;   // the home fold at rest
  g[W_FS] = 0; g[W_FS + 1] = 0; g[W_FS + 2] = 0; g[W_FS + 3] = 0;      // the stress fold the same (a refold changes nothing)
  for (let k = 0; k < 4; k++) g[W_GS + k] = 0;                          // (derived at its first tick)
  const links = derive(latticesOf(g, 0), [0, 0, 0], { sigma: 0.12, wMax: 4, wMin: 1, chi: Math.PI / 4 }, 27);
  for (let r = 0; r < 8; r++) {
    let code = 0;
    links[r].forEach((l, k) => { g[BIO_GRN + 16 + 3 * r + k] = l.w; code += l.q * 32 ** k; });
    g[BIO_GRN + 40 + r] = code;
  }
  const q = BIO_Q1;
  g[q] = flavour; g[q + 1] = flavour; g[q + 2] = 0.6; g[q + 3] = 1;   // emits and prefers its flavour, release 1
  g[q + 4] = 1; g[q + 5] = 0; g[q + 6] = 1 | 4; g[q + 7] = 0;         // all through junctions, no taste, r0 and r2 fast
  g[q + 8] = -8; g[q + 9] = 0; g[q + 10] = -8; g[q + 11] = 0;         // both releases read r0, inverted
  for (let k = 12; k < 16; k++) g[q + k] = 0;
  return g;
}
DESIGNS.relay = {
  label: 'relay',
  desc: 'an EXCITABLE sheet (step Q1): each cell hears the signal through its junctions, FIRES (releases it through its junctions, a flash) and is then refractory for a few seconds; a touch of the signal pipette sends a wave of flashes across the sheet',
  shape: 'disc',
  job: 2, jobs: ['resting', 'firing'],
  reporter: 2,
  genome(rng = Math.random, founder = 730) { return relayGenome(rng, founder); },
};
// ---------- step L1: THE TISSUE LAB'S ORGAN (README "Step L1"; src/organ.js lays it out and measures it) ----------
// Four hand-wired genomes, one ORGANISM: they share the identity words (the key, so their glue's likeness is full; the receptor; the self marker,
// so they are kin), each its own founder id. Every capability they use is a general gene any cell could evolve: elongation (S1), contraction
// (L1), glue and junctions (G0), the relay's wiring (Q1), the crust wall and stiffness (C12b), the fast regulators (Q1).
const ORGAN_ID = { key: [0.42, 0.1, 0.42, 0.1], rec: 0.12, mark: [1.1, Math.log(0.25), 2.0, 1] };
function organIdentity(g) {
  for (let k = 0; k < 4; k++) g[k] = ORGAN_ID.key[k];
  g[4] = ORGAN_ID.rec;
  for (let k = 0; k < 4; k++) g[76 + k] = ORGAN_ID.mark[k];
  g[73] = 0;     // no push from field A (a calm organ: the moire field still guides nothing here)
  return g;
}
export const ORGAN_GLUE = 2.5;   // the organ's glue (G0's log scale, 0.05..4)
/** MUSCLE: a relay (it fires on what it hears through its junctions and passes it on) that is a 4:1 SPINDLE and CONTRACTS while it fires (the
 * 23rd output reads the release regulator r0, inverted: e^(-8 x0), ~0 at rest, ~0.6 firing). */
export function muscleGenome(rng = Math.random, founder = 740, con = 1) {
  const g = organIdentity(relayGenome(rng, founder));
  g[13] = Math.log(4); g[14] = 0; g[15] = 0;   // elongation 4:1 (relay.y), the shape output off
  g[16] = ORGAN_GLUE; g[18] = 0.05;            // glue, barely crawls
  g[185] = con; g[186] = -8; g[187] = 0;       // CONTRACTION: gene, the 23rd output's gain (inverted) and regulator (r0, as the releases)
  // between the sheet's relay and the nerve: biases 0.6, 0.5, 1.5 (the relay's model on a sheet: a pulse crosses it and every cell goes back
  // to rest; at the nerve's biases a packed muscle re-excites itself and stays contracted, a tetanus), starting at its rest
  g[BIO_GRN + 8] = 0.6; g[BIO_GRN + 9] = 0.5; g[BIO_GRN + 10] = 1.5;
  g[BIO_GRN] = 0.719; g[BIO_GRN + 1] = 0.317; g[BIO_GRN + 2] = 0.211;
  return g;
}
/** NERVE: the same relay as a long 4:1 spindle (one hop per cell length: a pulse runs about twice as far per firing as in a round sheet). */
export function nerveGenome(rng = Math.random, founder = 750) {
  const g = organIdentity(relayGenome(rng, founder));
  g[13] = Math.log(4); g[14] = 0; g[15] = 0;
  g[16] = ORGAN_GLUE; g[18] = 0.05;
  return excitable(g);
}
/** The organ's relays are more EXCITABLE than the sheet's (biases 0.3, 0, 2 against 1, 0, 1): in a chain a cell hears only the one before it,
 * split over its 2 .. 5 junction sides; the relay's model on a chain (tools/q1_relay_sim.py with one row) carries a pulse along it and back
 * to rest with 3 to 5 sides only at these biases. They start at their own rest (else they fire as they settle). */
function excitable(g) {
  g[BIO_GRN + 8] = 0.3; g[BIO_GRN + 9] = 0; g[BIO_GRN + 10] = 2;
  g[BIO_GRN] = 0.614; g[BIO_GRN + 1] = 0.367; g[BIO_GRN + 2] = 0.348;
  return g;
}
/** SKIN: flat (2.5:1 along the surface), a full crust wall, a thick stiff membrane, the organ's glue; a light eater; silent (it hears, nothing is
 * wired to it). */
export function skinGenome(rng = Math.random, founder = 760) {
  const g = organIdentity(base(rng, founder));
  g[13] = Math.log(2.5); g[14] = 0; g[15] = 0;
  g[16] = ORGAN_GLUE; g[18] = 0.05;
  g[41] = 0.03; g[42] = 3;                     // thickness x 2.5, stiffness gene 3
  g[52] = 1;                                   // a full crust wall
  for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
  slot(g, 0, 'gt → g + t', 1.2, 2);
  slot(g, 1, 'g + t → gt', 2.4);
  return g;
}
// the PACEMAKER's lattices: six regulators at ONE address (far from every sense), in three pairs a third of a turn apart in phase (2.1 rad):
// with the phase offset chi = pi/4 the derived links run one way round (each pair inhibits the next at ~-3.9, its twin excites it at +2.8,
// backward links below wMin): a doubled REPRESSILATOR, which oscillates (tools/l1_pacemaker.py). r0, r1 fast (0.3 s), r2..r5 slow (5 s), biases 2:
// period ~12 s in the model. r6, r7 parked a sixth of a turn away. The releases read r0 (inverted): it fires once a cycle
const PACE = { th0: 0.2, lk0: -0.7, s: 2.1 };
export function pacemakerGenome(rng = Math.random, founder = 770) {
  const g = organIdentity(relayGenome(rng, founder));
  g[13] = Math.log(2); g[14] = 0; g[15] = 0;
  g[16] = ORGAN_GLUE; g[18] = 0.05;
  const x0 = [0.9, 0.9, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5], bias = [2, 2, 2, 2, 2, 2, 0, 0];
  wire(g, { regs: x0.map((x, r) => ({ bias: bias[r], x0: x, inputs: [] })) });
  for (let r = 0; r < 8; r++) {
    const park = r >= 6;
    g[W_LA + r] = PACE.th0 + (park ? Math.PI / 6 : 0); g[W_LK + r] = PACE.lk0; g[W_LP + r] = park ? 0 : PACE.s * Math.floor(r / 2);
  }
  const links = derive(latticesOf(g, 0), [0, 0, 0], { sigma: 0.12, wMax: 4, wMin: 1, chi: Math.PI / 4 }, 27);
  for (let r = 0; r < 8; r++) {
    let code = 0;
    links[r].forEach((l, k) => { g[BIO_GRN + 16 + 3 * r + k] = l.w; code += l.q * 32 ** k; });
    g[BIO_GRN + 40 + r] = code;
  }
  g[BIO_Q1 + 6] = 1 | 2;   // r0, r1 fast
  g[BIO_Q1 + 2] = 0.6;     // (its receptor as the relay's; nothing reads it)
  return g;
}
DESIGNS.muscle = {
  label: 'muscle', desc: 'a 4:1 spindle relay that CONTRACTS while it fires (step L1): glued end to end in a bundle it shortens as a whole when the signal reaches it',
  shape: 'line', job: 0, jobs: ['firing', 'resting'], reporter: 0, organ: true,
  genome(rng = Math.random, founder = 740) { return muscleGenome(rng, founder); },
};
DESIGNS.nerve = {
  label: 'nerve', desc: 'a chain of long relay cells (step L1): one hop per cell length, it carries a pulse along the muscle and hands it over through its junctions',
  shape: 'line', job: 0, jobs: ['firing', 'resting'], reporter: 0, organ: true,
  genome(rng = Math.random, founder = 750) { return nerveGenome(rng, founder); },
};
DESIGNS.skin = {
  label: 'skin', desc: 'flat walled stiff cells with strong glue (step L1): wrapped round the organ, they shelter its inside',
  shape: 'disc', job: 0, jobs: ['skin', 'skin'], reporter: 0, organ: true,
  genome(rng = Math.random, founder = 760) { return skinGenome(rng, founder); },
};
DESIGNS.pacemaker = {
  label: 'pacemaker', desc: 'a cell whose gene network OSCILLATES (a doubled repressilator, step L1) and fires once a cycle: a rhythm for the nerve or a ring',
  shape: 'disc', job: 0, jobs: ['firing', 'resting'], reporter: 0, organ: true,
  genome(rng = Math.random, founder = 770) { return pacemakerGenome(rng, founder); },
};
// ---------- step T2: TENDRILS, BONE, TENDONS (README "Step T2"; src/tendrils.js the capabilities, src/organ.js the limb's layout) ----------
// Hand-set genomes (the scientist's hand) using only general genes: the tendril genes (reach, count, placement, spread, stiffness, retraction,
// floor grip), the MINERALISE gene, glue, elongation, the crust wall. They share the organ's identity (one organism, kin) where they meet it.
/** BONE: a round, hard cell: it mineralises fully (rust Gt into its wall: stiff, its junctions x 2), the strongest glue, a full crust wall, a
 * thick stiff membrane, barely crawls; a light eater (it must pay its upkeep). Glued in a staggered double row it makes a stiff ROD. */
export function boneGenome(rng = Math.random, founder = 780) {
  const g = organIdentity(base(rng, founder));
  g[13] = 0; g[14] = 0; g[15] = 0;            // round
  g[16] = 4; g[18] = 0.02;                    // the strongest glue, barely crawls
  g[0] = ORGAN_ID.key[0] + 0.5;               // its own KEY (the glue's likeness): bone sticks to bone, not to the muscle sliding over it (the
                                              // tendons and the ligament hold by their tendrils, not by glue)
  g[41] = 0.03; g[42] = 3; g[52] = 1;         // thick, stiff, a full crust wall
  for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
  slot(g, 0, 'gt → g + t', 1.2, 2);
  slot(g, 1, 'g + t → gt', 2.4);
  return setTendrils(g, { mineral: 1 });
}
/** ANCHOR BONE: a bone cell with one short thick tendril a quarter turn clockwise of its front (away from the muscle, in a rod along x) that
 * grips the FLOOR at its full length and never retracts: the rod's lower row nails itself to the dish (a clamp the cells make themselves;
 * three tendrils round it gripped their neighbours too and pulled the rod into a knot). */
export function anchorGenome(rng = Math.random, founder = 785) {
  return setTendrils(boneGenome(rng, founder), { reach: 0.4, count: 1, place: -Math.PI / 2, spread: 0, stiff: 2, retract: 0, floor: 1 });
}
/** JOINT BONE: a bone cell at a rod's end with two thick tendrils pointing out along its front (a little apart), across the joint's gap: they
 * grip the other rod's end cell and hold it as LIGAMENTS (never retracting); the rods turn about them. */
export function jointGenome(rng = Math.random, founder = 787) {
  return setTendrils(boneGenome(rng, founder), { reach: 2, count: 2, place: -0.12, spread: 0.04, stiff: 2, retract: 0, floor: 0 });
}
/** TENDON: a 2.5:1 spindle whose two tendrils grow from its two POLES along its axis (placement 0, spread 0.5) and grip whatever they touch
 * first (the muscle's end at one pole, a bone at the other); thick (stiffness gene 2: strong, k x 7.4), no retraction, little glue. Across a
 * joint the same cell is a LIGAMENT. */
export function tendonGenome(rng = Math.random, founder = 790) {
  const g = organIdentity(base(rng, founder));
  g[13] = Math.log(2.5); g[14] = 0; g[15] = 0;
  g[16] = 0.3; g[18] = 0.02;
  g[41] = 0.02; g[42] = 2; g[52] = 0.5;
  for (let k = 0; k < 3; k++) slot(g, k, 'g + t → gt', 0);
  slot(g, 0, 'gt → g + t', 1.2, 2);
  slot(g, 1, 'g + t → gt', 2.4);
  return setTendrils(g, { reach: 1.6, count: 2, place: 0, spread: 0.5, stiff: 2, retract: 0, floor: 0 });
}
/** PILI: a crawler with three long tendrils evenly round it (pili) that grip the floor (or a neighbour) at full length, RETRACT (dragging the
 * cell to the anchor), let go fully in and sprout again somewhere else: twitching motility. */
export function piliGenome(rng = Math.random, founder = 795) {
  const g = base(rng, founder);
  g[16] = 0.3; g[18] = 0.3;
  return setTendrils(g, { reach: 2, count: 3, place: 0, spread: 1, stiff: 0.5, retract: 0.5, floor: 1 });
}
DESIGNS.bone = {
  label: 'bone', desc: 'a HARD cell (step T2): it mineralises its wall with rust (stiff, outline held, junctions x 2) and holds the strongest glue; glued in a double row it makes a stiff rod',
  shape: 'line', job: 0, jobs: ['bone', 'bone'], reporter: 0, organ: true, provision: true,
  genome(rng = Math.random, founder = 780) { return boneGenome(rng, founder); },
};
DESIGNS.tendon = {
  label: 'tendon', desc: 'a spindle whose two TENDRILS grow from its poles along its axis and grip what they meet (step T2): ropes from a muscle to a bone, or a ligament across a joint',
  shape: 'line', job: 0, jobs: ['tendon', 'tendon'], reporter: 0, organ: true, provision: true,
  genome(rng = Math.random, founder = 790) { return tendonGenome(rng, founder); },
};
DESIGNS.pili = {
  label: 'pili', desc: 'a crawler with three long tendrils that grip the floor, RETRACT and let go (step T2): it twitches across the dish, tugged from anchor to anchor',
  shape: 'scatter', job: 0, jobs: ['pili', 'pili'], reporter: 0, provision: true,
  genome(rng = Math.random, founder = 795) { return piliGenome(rng, founder); },
};
export const DESIGN_NAMES = Object.keys(DESIGNS);

/** A design's genome (a plain array of BIO_FLOATS numbers). */
export function designGenome(name, rng = Math.random) {
  const D = DESIGNS[name];
  if (!D) throw new Error(`tissues: no design ${name}; designs: ${DESIGN_NAMES.join(' ')}`);
  return D.genome(rng);
}

/** Points for n cells in a shape round (x, y), dish coordinates, about `gap` x R apart. */
export function shapePoints(shape, n, x, y, R, gap = 1.9, rng = Math.random, angle = 0) {
  const pts = [];
  const d = gap * R;
  if (shape === 'line') {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let k = 0; k < n; k++) { const t = (k - (n - 1) / 2) * d; pts.push([x + c * t, y + s * t]); }
  } else if (shape === 'strip') {   // (step Q1: a band of hexagonally packed rows, 6 deep, along `angle`)
    const rows = Math.max(1, Math.min(6, Math.round(n / 8))), cols = Math.ceil(n / rows), c = Math.cos(angle), s = Math.sin(angle);
    for (let k = 0; k < n; k++) {
      const r = k % rows, q = Math.floor(k / rows), u = (q - (cols - 1) / 2 + (r % 2) / 2) * d, v = (r - (rows - 1) / 2) * d * 0.866;
      pts.push([x + c * u - s * v, y + s * u + c * v]);
    }
  } else if (shape === 'ring') {    // (step Q1: an annulus 3 cells wide, its circumference from n)
    const width = 3, rm = Math.max(3 * d, n * d * d * 0.866 / (2 * Math.PI * width * d));
    for (let w = 0; w < width; w++) {
      const r = rm + (w - (width - 1) / 2) * d * 0.866, m = Math.max(6, Math.round(2 * Math.PI * r / d));
      for (let k = 0; k < m && pts.length < n; k++) { const a = (k + (w % 2) / 2) / m * 2 * Math.PI; pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
    }
  } else if (shape === 'scatter') {
    const rad = d * Math.sqrt(n) * 3;
    for (let k = 0; k < n; k++) { const a = rng() * 2 * Math.PI, r = rad * Math.sqrt(rng()); pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  } else {   // a disc: hexagonal packing, rings out from the centre
    for (let ring = 0; pts.length < n; ring++) {
      if (ring === 0) { pts.push([x, y]); continue; }
      for (let side = 0; side < 6 && pts.length < n; side++) {
        for (let j = 0; j < ring && pts.length < n; j++) {
          const a0 = side * Math.PI / 3, a1 = a0 + Math.PI / 3;
          const px = ring * Math.cos(a0) + j * (Math.cos(a1) - Math.cos(a0)), py = ring * Math.sin(a0) + j * (Math.sin(a1) - Math.sin(a0));
          pts.push([x + d * px, y + d * py]);
        }
      }
    }
  }
  return pts;
}

export class Tissues {
  constructor(M) {
    this.M = M;
    this.DESIGNS = DESIGNS;
    this.last = null;
  }

  genome(name) { return designGenome(name); }

  /** Place a design: opts { x, y (dish coordinates; default the centre), n (cells, default 1), shape (the design's), gap, angle }. */
  async place(name, opts = {}) {
    const M = this.M, D = DESIGNS[name];
    if (!D) throw new Error(`tissues: no design ${name}`);
    if (!M.app) throw new Error('the app is not ready');
    const v = M.cells.view, R = M.cells.R;
    const n = Math.max(1, Math.round(opts.n ?? 1));
    const pts = shapePoints(opts.shape || D.shape, n, opts.x ?? v.cssW / 2, opts.y ?? v.cssH / 2, R, opts.gap ?? 1.9, Math.random, opts.angle ?? 0);
    return M.app.place(pts, designGenome(name), `tissue: ${D.label}`);
  }

  /** For pictures: centre the view (zoom z) on the cells of a design (their centroid; opts.job: on the first cell of that job). */
  async focus(name = null, z = 3, opts = {}) {
    const c = await this.census(name, { keep: true });
    const P = this._pos;
    if (!P || !P.length) return null;
    let pick = P;
    if (opts.job != null) pick = P.filter((p) => p[2] === opts.job);
    if (!pick.length) pick = P;
    const x = opts.job != null ? pick[0][0] : pick.reduce((a, p) => a + p[0], 0) / pick.length;
    const y = opts.job != null ? pick[0][1] : pick.reduce((a, p) => a + p[1], 0) / pick.length;
    if (this.M.camera) this.M.camera.set(z, x, y);
    return { x, y, n: c.n };
  }

  /**
   * The census of the cells of one design (founder id: the design's; or every live cell with opts.all): each cell's JOB (the design's job
   * regulator above 0.5), where it sits (sides pressed, light), its battery, membrane integrity, swelling, crust wall cover, stiffness,
   * free t inside, the expressed factors; per job the means; the pattern's FIDELITY. Reads the cells, genomes and stocks back (paused).
   */
  async census(name = null, opts = {}) {
    const M = this.M, C = M.cells, ctl = M.control, d = M.gpu.device, n = C.count;
    const wasPaused = ctl.paused();
    let cellAB, bioAB, stockAB;
    try {
      await settle(M, ctl, false);
      [cellAB, bioAB, stockAB] = await Promise.all([
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.eat.stockBuf, 0, n * SW * 4),
      ]);
    } finally { ctl.setPaused(wasPaused); }
    const f = new Float32Array(cellAB), u = new Uint32Array(cellAB), g = new Float32Array(bioAB), st = new Int32Array(stockAB);
    // which design: the name given, else the one whose founder id the most cells carry
    const fidOf = (i) => Math.round(g[i * BIO_FLOATS + 7]);
    const ids = Object.fromEntries(DESIGN_NAMES.map((k) => [DESIGNS[k].genome(() => 0.5)[7], k]));
    const live = [];
    for (let i = 0; i < n; i++) if (u[i * CELL_FLOATS + C_FLAGS] & 1) live.push(i);
    if (!name) {
      const cnt = {};
      for (const i of live) { const k = ids[fidOf(i)]; if (k) cnt[k] = (cnt[k] || 0) + 1; }
      name = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || null;
    }
    const D = name ? DESIGNS[name] : null;
    const fid = D ? D.genome(() => 0.5)[7] : null;
    const mine = opts.all || !D ? live : live.filter((i) => fidOf(i) === fid);
    const set = new Set(mine);
    const job = D ? D.job : 0;
    const A = 4096;
    const per = [0, 1].map(() => ({ n: 0, contact: 0, light: 0, bat: 0, integ: 0, osm: 0, wall: 0, stiff: 0, tIn: 0, tFree: 0, heat: 0, fac: new Array(OUTPUTS.length).fill(0) }));
    const cellJob = new Map();
    const cellCov = new Map();
    for (const i of mine) {
      const oc = i * CELL_FLOATS, ob = i * BIO_FLOATS, G = grnOf(g, ob);
      const x = Math.max(0, Math.min(1, G.x[job]));
      const k = x > 0.5 ? 1 : 0;
      cellJob.set(i, k);
      let cov = 0;
      for (let w = 0; w < 3; w++) for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
        if (j === 0xffff || j >= n || !(u[j * CELL_FLOATS + C_FLAGS] & 1)) continue;
        if (Math.hypot(f[j * CELL_FLOATS] - f[oc], f[j * CELL_FLOATS + 1] - f[oc + 1]) < 1.1 * (f[oc + C_R] + f[j * CELL_FLOATS + C_R])) cov++;
      }
      cellCov.set(i, cov);
      const P = per[k];
      P.n++;
      P.contact += cov / 6;
      const s0 = u[oc + C_SNS0], s1 = u[oc + C_SNS1];
      P.light += (s0 & 255) / 255; P.tIn += ((s0 >>> 8) & 255) / 255; P.heat += ((s1 >>> 8) & 255) / 255;
      P.bat += f[oc + C_BAT];
      let ig = 0, wl = 0, sf = 0;
      for (let s = 0; s < 6; s++) {
        ig += Math.max(0, Math.min(1, f[oc + C_INTEG + s]));
        const lp = u[oc + C_LIP + s];
        sf += (lp & 255) / 255; wl += (lp >>> 24) / 255;
      }
      P.integ += ig / 6; P.wall += wl / 6; P.stiff += sf / 6;
      P.osm += f[oc + C_OSM];
      P.tFree += Math.max(0, st[i * SW + 1]) / A;
      G.u.forEach((uu, q) => { P.fac[q] += Math.min(Math.exp(Math.max(-8, Math.min(8, uu)) * Math.max(0, Math.min(1, G.x[G.reg[q]]))), 4); });
    }
    const out = per.map((P, k) => {
      const m = Math.max(1, P.n);
      const facs = {};
      OUTPUTS.forEach((o, q) => { const v = P.fac[q] / m; if (Math.abs(v - 1) > 0.02) facs[o] = +v.toFixed(3); });
      return { job: D ? D.jobs[k] : k ? 'high' : 'low', n: P.n, contact: P.contact / m, light: P.light / m, bat: P.bat / m, integ: P.integ / m,
        osm: P.osm / m, wall: P.wall / m, stiff: P.stiff / m, tIn: P.tIn / m, tFree: P.tFree / m, heat: P.heat / m, factors: facs };
    });
    // the pattern's fidelity
    const fid2 = {};
    if (name === 'plant') {
      // rim (two or more free sides: at most 4 pressed) should be bark, enclosed or nearly (5, 6 pressed) the core
      let ok = 0, rim = 0, rimBark = 0, core = 0, coreCore = 0;
      for (const i of mine) {
        const isRim = cellCov.get(i) <= 4, bark = cellJob.get(i) === 1;
        if (isRim) { rim++; if (bark) rimBark++; } else { core++; if (!bark) coreCore++; }
        if (isRim === bark) ok++;
      }
      Object.assign(fid2, { fidelity: ok / Math.max(1, mine.length), rim, rimBark: rim ? rimBark / rim : null, inner: core, innerCore: core ? coreCore / core : null });
    } else if (name === 'filament') {
      // contacts per cell (a chain ~2), the breathers' share, and along the contact graph the distance from each breather to the next
      let deg = 0;
      const adj = new Map(mine.map((i) => [i, []]));
      for (const i of mine) {
        const oc = i * CELL_FLOATS;
        for (let w = 0; w < 3; w++) for (const j of [u[oc + C_NBR + w] & 0xffff, u[oc + C_NBR + w] >>> 16]) {
          if (j === 0xffff || !set.has(j) || j === i) continue;
          if (!adj.get(i).includes(j)) adj.get(i).push(j);
        }
      }
      for (const i of mine) deg += adj.get(i).length;
      const hs = mine.filter((i) => cellJob.get(i) === 1);
      const dist = [];
      for (const h of hs) {
        const seen = new Map([[h, 0]]);
        let q = [h], found = null;
        while (q.length && found == null) {
          const nq = [];
          for (const a of q) for (const b of adj.get(a)) {
            if (seen.has(b)) continue;
            seen.set(b, seen.get(a) + 1);
            if (cellJob.get(b) === 1) { found = seen.get(b); break; }
            nq.push(b);
          }
          q = found == null ? nq : [];
          if (seen.size > 400) break;
        }
        if (found != null) dist.push(found);
      }
      dist.sort((a, b) => a - b);
      // adjacent breathers (distance 1) break the spacing
      Object.assign(fid2, { contacts: deg / Math.max(1, mine.length), breathers: hs.length / Math.max(1, mine.length), spacingMedian: dist.length ? dist[dist.length >> 1] : null,
        spacingMean: dist.length ? dist.reduce((a, b) => a + b, 0) / dist.length : null, adjacent: dist.length ? dist.filter((x) => x === 1).length / dist.length : null,
        hist: [1, 2, 3, 4, 5, 6].map((k) => dist.filter((x) => (k < 6 ? x === k : x >= 6)).length) });
    } else if (name === 'biofilm') {
      // top cells should be the lit ones: the light of each job, and the share of the brighter half that is top
      const ls = mine.map((i) => (u[i * CELL_FLOATS + C_SNS0] & 255) / 255).sort((a, b) => a - b);
      const med = ls.length ? ls[ls.length >> 1] : 0;
      let ok = 0;
      for (const i of mine) if (((u[i * CELL_FLOATS + C_SNS0] & 255) / 255 > med) === (cellJob.get(i) === 1)) ok++;
      Object.assign(fid2, { fidelity: ok / Math.max(1, mine.length), lightMedian: med });
    }
    // DRIFT from the design (with mutation on): each designed output's gain (mean) and the share of cells where it has lost more than half
    // its strength or reads another regulator ("broken"); the designed links' weights (mean distance from the design); cells whose rim
    // or core expresses against the design are the candidates for CHEATERS (plant: rim cells that are not bark)
    const drift = {};
    if (D) {
      const ref = grnOf(D.genome(() => 0.5), 0);
      const outs = OUTPUTS.map((o, q) => [o, q]).filter(([, q]) => Math.abs(ref.u[q]) > 0.05);
      for (const [o, q] of outs) {
        let su = 0, broken = 0;
        for (const i of mine) {
          const G = grnOf(g, i * BIO_FLOATS);
          su += G.u[q];
          if (G.reg[q] !== ref.reg[q] || Math.sign(G.u[q]) !== Math.sign(ref.u[q]) || Math.abs(G.u[q]) < 0.5 * Math.abs(ref.u[q])) broken++;
        }
        drift[o] = { design: +ref.u[q].toFixed(3), mean: mine.length ? su / mine.length : null, broken: mine.length ? broken / mine.length : null };
      }
      let dw = 0, rew = 0, k = 0;
      for (const i of mine) {
        const G = grnOf(g, i * BIO_FLOATS);
        for (let q = 0; q < 24; q++) {
          if (ref.code[q] === 0) continue;
          k++;
          if (G.code[q] !== ref.code[q]) rew++; else dw += Math.abs(G.w[q] - ref.w[q]);
        }
      }
      drift.links = { weightDist: k ? dw / Math.max(1, k - rew) : null, rewired: k ? rew / k : null };
    }
    this._pos = mine.map((i) => [f[i * CELL_FLOATS], f[i * CELL_FLOATS + 1], cellJob.get(i)]);
    this.last = { time: M.time(), design: name, n: mine.length, all: live.length, jobs: out, pattern: fid2, drift };
    return this.last;
  }
}

/** ?tissue=name: the culture's one founder is the design (before the first resize seeds the culture). */
export function useDesignFounder(genome, name, seed) {
  if (!DESIGNS[name]) return false;
  genome.params.founders = 1;
  genome.founders = [designGenome(name, makeRng((seed ^ 0x74697373) >>> 0))];
  return true;
}
