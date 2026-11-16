// Matter (Part C, step C3): the atom grid. SPRINGS (mouse-dropped, tap modes 2 and 3) drip atoms into the dish; the
// atoms spread (light ones quickly, heavy ones slowly), leave at the dish's edge, and are drawn as crisp halftone dots on
// the medium lattice (dot size = amount). Step C4: they react in the open (the energy table CHEM and the reaction list
// REACTIONS below; matter.wgsl's react, run every tick inside the heat's pass). The cells still ignore them (C5).
//
// Storage: 16 channels (6 atoms g t l G T L, 4 fuels gt gT Gt GT, 2 sediments ll LL, trace; step C12: oil lL and the
// amphiphiles glL, tlL; heat is in src/heat.js) on the heat grid's pixels (same size and geometry, so later steps react
// them together), as more blocks of the heat buffer (heat_common.wgsl): two copies of 16 blocks, ping-pong, and (step C12)
// 3 blocks the oil's passes work out each tick. The cells hold the first 13 (NCH_CELL) in their stock. The cells' step is at WebGPU's limit of 8
// storage buffers and already binds the heat buffer, so the cells can reach the atoms there later (C5) without one more.
// Amounts are whole counts (ATOM_SCALE per atom-unit) in i32, like the heat: atomics are integer only, and whole counts
// make moving matter around EXACT, so matter is conserved to the count.
//
// Every tick (matter.wgsl, spread):
//   drip    on the tick's first substep, each spring adds its atoms evenly over the pixels of a small disc (random
//           rounding), booked as "added";
//   spread  explicit, conservative, nSub substeps: each edge between two pixels carries k x the difference, rounded at
//           random (so thin tails keep spreading) and capped at a quarter of what the giver has (so nothing goes below
//           zero); both pixels work out the same edge from the same numbers, so what one gives the other receives. On a
//           tick's first substep the pixels on the dish's rim lose a share `edge` per s of their mobile atoms, booked as
//           "lost" (the sink that keeps the dish from filling up forever).
// Once per frame (with the heat's ledger): the atoms in the dish per channel (exact, 64-bit) and the sum of m ln m for the
// ORDER line; paint writes two small textures with the amounts the drawing shows.
//
// The ledger: added by springs = in the dish + lost at the edge + gone (washed out with Shift+C, or with the old grid on a
// window resize); rounding = what does not add up. Every amount is whole counts, so it stays at exactly 0.
//
// ORDER (the entropy panel): how patterned the dish's matter is. p = each pixel's share of each substance's atoms;
// H = -sum p ln p (Shannon entropy); Hmax = what H would be if the same matter were smeared evenly over the whole dish
// (ln pixels + the entropy of the mix); ORDER = 1 - H / Hmax: 1 = all in one spot, 0 = evenly smeared.

import { loadShader } from './gpu.js';
import { HEAT_COMMON_URL, HEAT_SCALE, LEDGER_WORDS, fmt } from './heat.js';
import { BANDS, LIGHT_COMMON_URL } from './light.js';
import { FLAT, pal } from './palette.js';
import { Oil } from './oil.js';
import { Excited } from './excited.js';
import { Electrons } from './electrons.js';
import { setShaderConst } from './gpu.js';

// ---------- step C12d, ELECTRONS: which table this page runs (fixed for the page: changing it would change the energy of
// every molecule in the dish). ?electrons=0 gives the previous table (step C4 to C12c) exactly ----------
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const ELECTRONS = !(QS && QS.has('electrons') && QS.get('electrons') === '0');

// ---------- the periodic table (CLAUDE.md, Part C): every property derived from ROW and GROUP, nowhere else ----------
// ROW is size: heavier = slower spreading (later: richer bonds, harder light needed). GROUP is role: a GIVER wants one
// partner, a TAKER wants one partner, a LINKER wants two (it chains), INERT wants none.
export const ATOMS = {
  g: { row: 1, group: 'giver' },
  t: { row: 1, group: 'taker' },
  l: { row: 1, group: 'linker' },
  G: { row: 2, group: 'giver' },
  T: { row: 2, group: 'taker' },
  L: { row: 2, group: 'linker' },
  trace: { row: 3, group: 'inert' },   // rare; never reacts, barely moves (C4: lowers the spark where it sits)
  // step C12c, EXCITED WASTE: a light giver or taker freed by LIGHT (an uphill swap) leaves excited, holding part of the photon's
  // surplus. The same atom (row, group, charge, speed); only its energy differs (EXCITED below) and it fades back to its ground
  // atom by itself
  'g*': { row: 1, group: 'giver', ground: 'g' },
  't*': { row: 1, group: 'taker', ground: 't' },
};

// Step C6b, CHARGE, from the GROUP alone (the same rule for every row): a giver is +1, a taker -1, a linker and the inert
// trace 0. A substance's charge is the sum of its atoms' (every fuel is a giver + a taker: 0; sediment, linkers: 0). Every
// reaction moves atoms without changing their groups, so it conserves charge; deriveReactions and deriveEngines check it.
export const GROUP_CHARGE = { giver: 1, taker: -1, linker: 0, inert: 0 };
for (const a of Object.values(ATOMS)) a.charge = GROUP_CHARGE[a.group];

// How fast things spread (R^2 per s of simulation time): row 1 quickly, each row further down SPREAD.perRow times
// slower; a bonded pair at the speed of its heavier atom, a little slower than that (SPREAD.bond); sediment not at all.
// (A patch spreads over about sqrt(4 x spread x t): light atoms 17 R in a minute, heavy ones 6 R, trace 2 R.)
export const SPREAD = { row1: 1.2, perRow: 0.12, bond: 0.7 };

// ---------- the energy table (step C4): every substance's chemical energy and every bond's SPARK, from ROW and GROUP ----
// Energies are per unit of the substance, in the energy unit of the heat (heat_common.wgsl), so a bond's energy and the
// heat it becomes are the same numbers. Nothing here is set per substance; change a factor and the whole table follows.
//   free atoms (and trace)  0: the zero of the scale
//   FUEL   giver + taker    E = fuelPerRow x (row of the giver + row of the taker): gt 1.5, gT and Gt 2.25, GT 3. Fuel
//                           holds energy: making it is uphill (paid by light), breaking it is downhill (heat comes out)
//   SEDIMENT linker chain   E = sedPerRow x (row + row): ll -0.5, LL -1. Below the free linkers: forming it releases a
//                           little heat; only hard light cracks it back (uphill)
//   SPARK (activation) of a bond = sparkPerRow x (row + row): gt and ll 0.25, gT Gt 0.375, GT and LL 0.5. Every reaction
//                           that breaks or makes a bond must first be paid its spark (from light or local heat; downhill
//                           reactions give it back). Trace in the pixel lowers it: spark / (1 + traceK x trace per R^2)
//   BAND that makes a fuel  the lowest light band whose photon covers the fuel's energy plus its spark: gt 1.75 ->
//                           visible 1 (photon 2), gT Gt 2.625 -> visible 2 (3), GT 3.5 -> hard (5)
// The factors are multiples of 1/16 on purpose: with 65 536 heat counts per energy unit and 4096 counts per atom, one
// count of a substance carries 16 x E heat counts, a whole number, so every reaction moves energy EXACTLY (no rounding).
// Swaps: a free atom takes a partner out of a bond and leaves its old partner free; it runs by itself only DOWNHILL, so
// only into a poorer bond (heavier fuel holds more energy, so the light atoms are the ones that swap: t + gT -> gt + T
// releases 2.25 - 1.5 = 0.75 as heat; the other way round would have to be paid). l + L do not chain (a chain is one
// row's linkers: there is no mixed sediment channel).
export const CHEM = { fuelPerRow: 0.75, sedPerRow: -0.25, sparkPerRow: 0.125 };

// Step C12: every BOND's energy from its two atoms' GROUPS and ROWS, so molecules of more than two atoms follow from the
// same two factors: each group brings a TENDENCY, a charged atom (giver, taker) half the fuel's factor, a linker half the
// chain's, and bond(a, b) = (tendency a + tendency b) x (row a + row b). Giver-taker: fuelPerRow (the fuels, as before);
// linker-linker: sedPerRow (the chains, as before); and the new charged-linker bond (an amphiphile's HEAD on its oily tail)
// halfway between: (0.375 - 0.125) = 0.25 per row, uphill (putting a head on stores a little, as making fuel does, less).
// A molecule's energy is the sum of its bonds'. A bond's SPARK is sparkPerRow x (row a + row b), whatever the groups.
const TEND = { giver: CHEM.fuelPerRow / 2, taker: CHEM.fuelPerRow / 2, linker: CHEM.sedPerRow / 2, inert: 0 };
const oldBondE = (a, b) => (TEND[a.group] + TEND[b.group]) * (a.row + b.row);
const bondSpark = (a, b) => CHEM.sparkPerRow * (a.row + b.row);

// ---------- step C12d, ELECTRONS: bonding rebuilt around GRIP (README "Step C12d: electrons") ----------
// Every atom has a small LADDER of levels (orbitals), from its row and group only. Each group has a core PULL Z: shell k of the
// atom sits at -Z / 2^(k-1) (each shell half as deep as the one inside it); a row-r atom has shells 1..r filled, its outermost
// (shell r) the VALENCE shell, and shell r + 1 empty above it. So each row adds a shell, and outer shells sit higher and hold
// looser. GRIP = the valence level: a giver's spare electron (heavier = looser: gives easily, metal-like), a taker's empty slot
// (lighter = deeper: pulls harder, oxygen-like), the level a linker shares. Bonds:
//   an electron FALLS (a bond with a giver or a taker; the donor is the partner whose valence sits higher): released = the
//          donor's level - the acceptor's, + match when both are of one row (shells of one size overlap best); like with like
//          (giver + giver, taker + taker): no bond
//   linkers SHARE: released = share x (row + row) (bigger shells overlap more), as the old chains
// A bond has a bonding level (where the electron now sits) and an anti-bonding one above: a fallen electron lifted is back on
// its donor's EMPTY shell, so the bond's GAP = released + the donor's atom gap; a shared pair splits evenly: gap = released.
// Light is absorbed only where a photon matches a gap (within tol of the band's photon): every substance has its own bands.
// Free atoms are the top of the scale (0): every bond goes down from there.
export const ELEC = { pull: { giver: 5 / 4, linker: 5 / 2, taker: 11 / 2, inert: 0 }, match: 1 / 4, share: 1 / 4, tol: 1 / 2 };
/** Step C12d: an atom's levels, shell 1 up to its empty shell (energy units; [] for trace, a closed shell). */
export function atomLevels(a) {
  if (a.group === 'inert') return [];
  return Array.from({ length: a.row + 1 }, (_, k) => -ELEC.pull[a.group] / 2 ** k);
}
const valence = (a) => -ELEC.pull[a.group] / 2 ** (a.row - 1);   // its grip (the valence level)
const atomGap = (a) => ELEC.pull[a.group] / 2 ** a.row;           // valence -> the empty shell above
/** Step C12d: the bond between atoms a and b: { rel (energy released forming it), gap, donor } or null (no bond). */
export function eBond(a, b) {
  if (a.group === 'inert' || b.group === 'inert') return null;
  if (a.group === b.group && a.group !== 'linker') return null;
  if (a.group === 'linker' && b.group === 'linker') { const rel = ELEC.share * (a.row + b.row); return { rel, gap: rel, donor: null }; }
  const [d, c] = valence(a) >= valence(b) ? [a, b] : [b, a];
  const rel = valence(d) - valence(c) + (a.row === b.row ? ELEC.match : 0);
  return { rel, gap: rel + atomGap(d), donor: d };
}
/** Step C12d: the band whose photon a gap matches (within ELEC.tol; the nearest), or -1. */
export function gapBand(gap) {
  let best = -1;
  BANDS.forEach((b, k) => { if (Math.abs(b.photon - gap) <= ELEC.tol && (best < 0 || Math.abs(b.photon - gap) < Math.abs(BANDS[best].photon - gap))) best = k; });
  return best;
}
const bondE = (a, b) => (ELECTRONS ? -eBond(a, b).rel : oldBondE(a, b));

// ---------- step C12c, EXCITED WASTE: how much energy an excited atom keeps (the user chose "charged waste") ----------
// Light drives the uphill swaps (gt + T -> gT + t, gt + G -> Gt + g, gT + G -> GT + g, Gt + T -> GT + t): a photon of the
// lowest band that covers the bond's step up and its spark pays the step up (0.75 for each of them), and until now the rest
// of the photon (its SURPLUS, band energy - the step up: 2 - 0.75 = 1.25 for all four, visible 1) became heat. Now the freed
// light atom leaves EXCITED and keeps a SHARE of that surplus: E* = share x the smallest surplus of the reactions that make
// it (so no reaction has to give more than its photon holds; the other light-driven reaction that frees light atoms, hard
// light breaking a fuel, gt + hard -> g* + t*, has far more to spare: 5 + 1.5), rounded down to 1/16 (one count of g* then carries a whole
// number of heat counts: the books stay exact). share = 1/2 (URL ?exshare=; fixed for the page: changing it while excited
// atoms exist would change the energy they hold): E* = 0.625. The rest of the surplus is heat, as before.
// Then breathing pays: t* + gT -> gt + T releases 0.75 + 0.625 = 1.375 (and the gt can still be burned for 1.5), against
// 2.25 for burning the gT outright: breathing + burning 2.875.
export const EXCITED = (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const sh = q && q.has('exshare') && Number.isFinite(Number(q.get('exshare'))) ? Number(q.get('exshare')) : 0.5;
  const share = Math.max(0, Math.min(1, sh));
  let surplus = Infinity;
  for (const giver of ['g', 'G']) {
    for (const taker of ['t', 'T']) {
      // the poorer fuel (giver, taker) and its two upgrades: a heavier giver, a heavier taker
      for (const [g2, t2] of [[giver === 'g' ? 'G' : null, taker], [giver, taker === 't' ? 'T' : null]]) {
        if (!g2 || !t2) continue;
        const up = oldBondE(ATOMS[g2], ATOMS[t2]) - oldBondE(ATOMS[giver], ATOMS[taker]);   // (the C4 table: step C12d leaves it)
        const sp = bondSpark(ATOMS[g2], ATOMS[t2]);
        const band = BANDS.findIndex((b) => b.photon >= up + sp);
        if (up > 0 && band >= 0) surplus = Math.min(surplus, BANDS[band].photon - up);
      }
    }
  }
  const e = Math.floor(16 * share * surplus) / 16;
  return { share, surplus, energy: e, e16: Math.round(16 * e) };
})();

// ---------- step C12: POLARITY, from the atoms' charges and where they sit (no physics; the user: "we can simplify their
// charges combining") ----------
// A charged atom (a giver +1, a taker -1) is water-loving; a linker that sits in a CHAIN (bonded to another linker) is
// water-shy. Read along the molecule (its atoms in chain order):
//   head = charged atoms / atoms, tail = chained linkers / atoms
//   AMPHIPHILE  the charged atoms all at ONE end, and a chain behind them (a charged head on an oily tail: soap, lipid)
//   POLAR       charged atoms anywhere else (a lone ion; both ends charged; a neutral molecule of + and - parts, as the
//               fuels, still counts: polarity is where the charge sits, not its sum)
//   APOLAR      a chain and no charged atom (oil; also the crust, which does not move)
//   neutral     neither (a lone linker, trace): takes no part
// Two numbers then say how it moves on the grid (src/oil.js, matter.wgsl): the bulk pull chi = tail - head (an amphiphile's
// head and tail cancel: 0), up the oil's share (chi > 0 gathers into oil, chi < 0 is pushed out of it); and the boundary
// pull beta = 2 x min(tail, head) for an amphiphile (0 for the rest), toward the oil-water boundary (where the oil's share
// is a half).
export function polarity(A) {
  const n = A.length, ch = A.map((a) => a.charge !== 0), lk = A.map((a) => a.group === 'linker');
  const charged = ch.filter(Boolean).length;
  const chained = lk.filter((x, i) => x && ((i > 0 && lk[i - 1]) || (i < n - 1 && lk[i + 1]))).length;
  const head = charged / n, tail = chained / n;
  const oneEnd = charged > 0 && chained > 0 && (ch.slice(0, charged).every(Boolean) || ch.slice(n - charged).every(Boolean));
  const cls = oneEnd ? 'amphiphile' : charged > 0 ? 'polar' : chained > 0 ? 'apolar' : 'neutral';
  return { cls, head, tail, chi: oneEnd ? 0 : tail - head, beta: oneEnd ? 2 * Math.min(tail, head) : 0, chained };
}

// Inks by chemical FUNCTION (faded palette, 0..255): each with a lighter variant for row 1 and a deeper one for row 2;
// a substance's ink sits between them by the share of its atoms in row 2. Reactive free atoms (givers and takers, hungry
// for a partner) in the old threat red; linkers dim and quiet; fuels in the old nutrient green; sediment a dim flat
// brown-grey; trace a pale silver, drawn as a small diamond instead of a dot.
// Step C6n: the inks live in src/palette.js (FLAT and NEON, the same meanings); INKS is the flat one (the toolbar's icons).
export const INKS = FLAT.substances;

// The 16 channels, in buffer order. A substance is just its atoms (in chain order); its kind follows from their groups:
// one giver or taker or linker = a free atom, giver + taker = FUEL, a chain of linkers of ONE row = SEDIMENT (a regular
// chain packs into a solid crust), the inert atom = trace; step C12: a chain of linkers of MIXED rows = OIL (it cannot
// pack into a crystal, so it stays liquid: mobile and water-shy), and a charged atom on one end of an oil chain =
// AMPHIPHILE. The new molecules are the smallest that fit the bond rules: the light and the heavy linker chained (lL),
// and a light giver or taker as its head on the light end (glL +1, tlL -1; the head takes the end where its bond is
// cheaper: rows 1 + 1).
export const SUBSTANCES = [
  ['g'], ['t'], ['l'], ['G'], ['T'], ['L'],
  ['g', 't'], ['g', 'T'], ['G', 't'], ['G', 'T'],
  ['l', 'l'], ['L', 'L'],
  ['trace'],
  ['l', 'L'], ['g', 'l', 'L'], ['t', 'l', 'L'],   // step C12
  ['g*'], ['t*'],                                   // step C12c: the excited light atoms (channels 16, 17)
].map((atoms) => derive(atoms));
export const NCH = SUBSTANCES.length;   // 18 (13 until step C12, 16 until step C12c)
export const NCH_CELL = 13;             // step C12: the cells' stock holds channels 0..12 (oil and amphiphiles stay in the open)
export const EXC0 = 16;                 // step C12c: the excited atoms' first channel (g*, then t*); EXC0 + j is the twin of channel j
// step C12c: the channels the cells hold: 0..12 and the excited light atoms (stock words 28, 29; cell_eat.wgsl cell_ch, stock_w)
export const CELL_CH = [...Array.from({ length: NCH_CELL }, (_, c) => c), 16, 17];
export const CH = Object.fromEntries(SUBSTANCES.map((s, c) => [s.name, c]));
if (CH.lL !== 13) throw new Error('heat_common.wgsl expects the oil (lL) in channel 13 (OIL_CH)');
if (CH['g*'] !== EXC0 || CH['t*'] !== EXC0 + 1 || CH.g !== 0 || CH.t !== 1) throw new Error('the shaders expect g*, t* in channels 16, 17 (twins of g, t)');
if (NCH > 18) throw new Error("the shaders hold 18 channels at most (16 in the per-channel uniforms: the excited ones read their ground twin's)");

function derive(atoms) {
  const A = atoms.map((a) => ATOMS[a]);
  const groups = A.map((a) => a.group).sort().join('+');
  const pol = polarity(A);   // step C12
  const allLink = A.every((a) => a.group === 'linker');
  const kind = atoms.length === 1 ? (A[0].group === 'inert' ? 'trace' : 'atom')
    : groups === 'giver+taker' ? 'fuel'
      : allLink ? (A.every((a) => a.row === A[0].row) ? 'sediment' : 'oil')
        : pol.cls === 'amphiphile' ? 'amphiphile' : 'other';
  const row = Math.max(...A.map((a) => a.row));
  const heavy = A.filter((a) => a.row >= 2).length / A.length;          // share of its atoms in row 2 or below
  const reactive = kind === 'atom' && (A[0].group === 'giver' || A[0].group === 'taker');
  const spread = kind === 'sediment' ? 0 : SPREAD.row1 * SPREAD.perRow ** (row - 1) * SPREAD.bond ** (atoms.length - 1);
  const excited = atoms.length === 1 && !!ATOMS[atoms[0]].ground;   // step C12c
  // step C12d (electrons): a giver-taker compound is FUEL while a stronger taker would still take its electron (release energy
  // swapping in), a settled MINERAL when its electron already sits in the deepest slot. SMELL (what the cells smell, cell_eat.wgsl):
  // the energy the strongest taker would release taking it (heat counts per count); the old table: the fuel's own energy
  let mineral = false, smell16 = kind === 'fuel' ? Math.round(16 * (atoms.length > 1 ? oldOrNewEnergy(A) : 0)) : 0;
  if (ELECTRONS && kind === 'fuel') {
    const gv = A.find((a) => a.group === 'giver'), tk = A.find((a) => a.group === 'taker');
    const best = Object.values(ATOMS).filter((a) => a.group === 'taker' && !a.ground).reduce((m, a) => (valence(a) < valence(m) ? a : m));
    const gain = eBond(gv, best).rel - eBond(gv, tk).rel;
    mineral = gain <= 0;
    smell16 = Math.round(16 * Math.max(0, gain));
  }
  const func = kind === 'atom' ? (reactive ? 'reactive' : 'linker') : kind === 'other' ? 'linker' : mineral ? 'mineral' : kind;
  const layer = excited ? 6 : mineral ? 7 : ({ atom: 0, fuel: 1, sediment: 2, trace: 3, oil: 4, amphiphile: 5 }[kind] ?? 0);   // drawing layer (C12c: 6; C12d: 7)
  const name = atoms.length === 1 ? atoms[0] : atoms.join('');
  // step C4, the energy table (CHEM above): energy per unit, the bond's spark, and the light band that makes a fuel.
  // Step C12: the sum of its bonds' energies (bondE: the same numbers for the fuels and the sediments as before), and the
  // spark of its first bond (the one its reactions make and break: a fuel's or a chain's only bond, an amphiphile's head)
  let energy = excited ? EXCITED.energy : 0;   // (step C12c: an excited atom holds E*)
  for (let k = 1; k < A.length; k++) energy += bondE(A[k - 1], A[k]);
  const spark = atoms.length > 1 ? bondSpark(A[0], A[1]) : 0;
  const e16 = Math.round(16 * energy);   // heat counts per count of the substance (exact: see CHEM)
  if (e16 !== 16 * energy) throw new Error(`energy of ${name} (${energy}) is not a multiple of 1/16`);
  const charge = A.reduce((x, a) => x + a.charge, 0);   // step C6b: the sum of its atoms' charges (GROUP_CHARGE)
  // step C12d (electrons): its GAPS (each bond's; a free atom's own: valence -> its empty shell) and the bands they match. Warm
  // absorption only ever makes heat (the `dark` depth); a visible or hard band excites it (photochemistry, fluorescence, heat)
  let gaps = [];
  if (ELECTRONS && !excited) {
    if (atoms.length === 1) { if (A[0].group !== 'inert') gaps = [atomGap(A[0])]; }
    else for (let k = 1; k < A.length; k++) gaps.push(eBond(A[k - 1], A[k]).gap);
  }
  const bands = [...new Set(gaps.map(gapBand).filter((b) => b >= 0))].sort();
  return { name, atoms, kind, row, heavy, reactive, spread, func, layer, ink: inkOf(func, heavy), energy, spark, e16, charge, excited,
    ground: excited ? ATOMS[atoms[0]].ground : null, mineral, smell16, gaps, bands,
    polarity: pol.cls, head: pol.head, tail: pol.tail, chi: pol.chi, beta: pol.beta, chained: pol.chained };
}
// (the old table's smell: a fuel's own energy, as cell_eat.wgsl summed it until step C12d)
function oldOrNewEnergy(A) { let e = 0; for (let k = 1; k < A.length; k++) e += bondE(A[k - 1], A[k]); return e; }

/** The light band that makes a fuel: the lowest whose photon covers its energy plus its spark (-1: none). */
export function makingBand(s) {
  return bondBand(s.energy + s.spark);
}
/** Step C12: the lowest band that makes bonds (warm light is heat only) whose photon covers the energy e (-1: none). */
export function bondBand(e) {
  return BANDS.findIndex((b, k) => k > 0 && b.photon >= e);
}

function inkOf(func, heavy, inks = INKS) {
  const I = inks[func];
  return I.light.map((v, j) => v + (I.heavy[j] - v) * heavy);
}

// ---------- the reactions (step C4), all derived from the substances above ----------
// Each: reactants `ins` and products `outs` (channels; one event moves ONE count of each listed channel, so 2 l -> ll
// lists l twice), what drives it (`by`: 'heat' = a rate x exp(-spark / temperature); 'light' = photons of `band` caught
// by the reactants), the heat it releases per event (heat counts; for a light reaction the photon's energy minus what
// goes into bonds), the light it uses per event, and its family (for the counters and the rules):
//   make   giver + taker -> fuel, by light of the fuel's band (making it is uphill: the photon pays bond and spark, the
//          rest is heat)
//   burn   fuel -> giver + taker, by heat (downhill: the bond's energy comes out as heat)
//   photo  fuel -> giver + taker, by hard light (photon + bond energy -> heat)
//   swap   free atom + fuel -> poorer fuel + the freed atom, by heat (the energy difference -> heat)
//   form   linker + linker (same row) -> sediment, by heat (releases a little)
//   crack  sediment -> linker + linker, by hard light (photon - the chain's energy -> heat)
// Step C12, in the open dish only (`open`: the cells' stock has no channel for them), the same two rules, both ways:
//   oil      l + L -> lL, by heat (a chain forming releases a little: 0.75), as sediment forms
//   oilcrack lL -> l + L, by hard light (photon - the chain's energy -> heat), as sediment cracks
//   head     g + lL -> glL, t + lL -> tlL, by light of the lowest bond-making band (visible 1: the head bond is uphill, 0.5
//            plus its spark 0.25), as fuel is made
//   unhead   glL -> g + lL, tlL -> t + lL, by heat (the head's bond energy -> heat), as fuel burns
export const FAMILIES = ['make', 'burn', 'photo', 'swap', 'form', 'crack', 'oil', 'oilcrack', 'head', 'unhead'];   // (step C6's
                                                                                                         // 'upswap' is counted as 'swap')
export const HARD = BANDS.length - 1;
// step C12d (electrons): the full table, every reaction both ways (TABLE_E), and from it the open dish's reactions
export const TABLE_E = ELECTRONS ? deriveTableE() : [];
export const REACTIONS = ELECTRONS ? deriveReactionsE() : deriveReactions();
/** Step C12d: the families as the shaders number them (the ledger counts the first 10; glow and dark, the excited states'
 * fluorescence and heat, are counted by the electrons' own counters). */
export const FAM_GPU = [...FAMILIES, 'glow', 'dark'];
/** Step C12d: what each family is called with electrons on (its ledger slot keeps the old name). */
export const FAM_LABEL = ELECTRONS
  ? { make: 'bond', burn: 'split', photo: 'trade', swap: 'swap', upswap: 'swap', form: 'chain', crack: 'crack', oil: 'oil', oilcrack: 'oil cracked', head: 'head on', unhead: 'head off', glow: 'fluorescence', dark: 'excited → heat' }
  : Object.fromEntries([...FAMILIES, 'upswap'].map((f) => [f, f]));

// ---------- step C12d: the electrons' table (README "Step C12d: electrons") ----------
// Every reaction both ways (SYMMETRY), each with its energy change (heat counts per event, d16: < 0 downhill) and spark:
//   bond   giver + taker -> compound (down)              split   compound -> giver + taker (up)
//   swap   a free atom takes a partner's place where that releases energy (down; t + gT -> gt + T: breathing), and back (up)
//   trade  two compounds swap partners where that releases energy (down: gT + Gt -> gt + GT), and back (up)
//   chain  l + l -> ll, L + L -> LL (down)               crack   the chain back into its linkers (up)
//   oil, head (the open dish only): l + L -> lL, a head atom on oil (down), and back (up)
// Each entry: fam (its ledger slot: bond 'make', split 'burn', trade 'photo', chain 'form'), dir, ins, outs, d16, spark, open.
function deriveTableE() {
  const T = [];
  const S = SUBSTANCES, ch = (name) => S.findIndex((s) => s.name === name);
  const E16 = (cs) => cs.reduce((x, c) => x + S[c].e16, 0);
  const nm = (cs) => cs.map((c) => S[c].name).join(' + ');
  const both = (fam, upFam, ins, outs, spark, open = false) => {
    const d = E16(outs) - E16(ins);
    if (!(d < 0)) throw new Error(`electrons: ${nm(ins)} → ${nm(outs)} should be downhill`);
    const back = fam === 'swap' ? [...ins].reverse() : ins;   // (an uphill swap names the richer compound first: gt + T → gT + t)
    T.push({ fam, dir: 'down', ins, outs, d16: d, spark, open, name: `${nm(ins)} → ${nm(outs)}` });
    T.push({ fam: upFam, dir: 'up', ins: outs, outs: back, d16: -d, spark, open, name: `${nm(outs)} → ${nm(back)}` });
  };
  const fuels = S.map((s, c) => [s, c]).filter(([s]) => s.kind === 'fuel');
  const free = S.map((s, c) => [s, c]).filter(([s]) => s.kind === 'atom' && !s.excited);
  for (const [f, c] of fuels) both('make', 'burn', f.atoms.map(ch), [c], f.spark);
  for (const [f, c] of fuels) {
    for (const [z, cz] of free) {
      for (let k = 0; k < 2; k++) {
        const old = f.atoms[k];
        if (ATOMS[z.name].group !== ATOMS[old].group || z.name === old) continue;
        const cn = ch((k === 0 ? [z.name, f.atoms[1]] : [f.atoms[0], z.name]).join(''));
        if (cn < 0 || S[cn].e16 >= f.e16) continue;
        both('swap', 'swap', [cz, c], [cn, ch(old)], f.spark);   // (the spark of the bond that breaks going down)
      }
    }
  }
  for (let i = 0; i < fuels.length; i++) {
    for (let j = i + 1; j < fuels.length; j++) {
      const [A, a] = fuels[i], [B, b] = fuels[j];
      const c1 = ch(A.atoms[0] + B.atoms[1]), c2 = ch(B.atoms[0] + A.atoms[1]);
      if (c1 < 0 || c2 < 0 || (c1 === a && c2 === b) || (c1 === b && c2 === a)) continue;
      if (E16([c1, c2]) >= E16([a, b])) continue;
      both('photo', 'photo', [a, b], [c1, c2], Math.max(A.spark, B.spark, S[c1].spark, S[c2].spark));
    }
  }
  S.forEach((f, c) => {
    if (f.kind === 'sediment') { const x = ch(f.atoms[0]); both('form', 'crack', [x, x], [c], f.spark); }
    if (f.kind === 'oil') both('oil', 'oilcrack', f.atoms.map(ch), [c], f.spark, true);
    if (f.kind === 'amphiphile') both('head', 'unhead', [ch(f.atoms[0]), ch(f.atoms.slice(1).join(''))], [c], f.spark, true);
  });
  return T;
}

// The open dish's reactions with electrons on:
//   by heat   every downhill reaction of the table (its spark from the local heat, as before)
//   by light  an uphill reaction runs where one of its reactants is EXCITED: it absorbs a visible or hard band (its gap matches)
//             whose photon covers the rise + HALF the spark (the excited state's spark is lower); the photon pays the rise, the
//             rest is heat. `absorber` is that reactant
//   excited   every substance's excited state per band it absorbs (visible and hard; warm light is heat only, CP.dark): it
//             FLUORESCES (emits the next lower band: `emit`, its energy leaves the dish; the photon's rest is heat) or turns into
//             HEAT. Matter does not change (ins = outs). Their shares and the photochemistry's: writeChem (src/electrons.js)
function deriveReactionsE() {
  const out = [];
  const L16 = (b) => Math.round(16 * BANDS[b].photon);
  for (const r of TABLE_E) {
    if (r.dir === 'down') out.push({ fam: r.fam, by: 'heat', ins: r.ins, outs: r.outs, heat16: -r.d16, light16: 0, spark: r.spark, open: r.open, name: r.name });
  }
  for (const r of TABLE_E) {
    if (r.dir !== 'up') continue;
    let best = null;
    for (const c of new Set(r.ins)) {
      for (const b of SUBSTANCES[c].bands) {
        if (b < 1 || L16(b) < r.d16 + 8 * r.spark) continue;   // (warm makes heat only; 16 x half the spark = 8 x spark)
        if (!best || b < best.band) best = { c, band: b };
      }
    }
    if (!best) continue;
    out.push({ fam: r.fam, by: 'light', band: best.band, ins: r.ins, outs: r.outs, heat16: L16(best.band) - r.d16, light16: L16(best.band),
      spark: r.spark, open: r.open, photo: true, absorber: best.c, name: `${r.name} (${BANDS[best.band].name})` });
  }
  SUBSTANCES.forEach((s, c) => {
    for (const b of s.bands) {
      if (b < 1) continue;
      const e = b - 1;
      out.push({ fam: 'glow', by: 'light', band: b, ins: [c], outs: [c], heat16: L16(b) - L16(e), light16: L16(b), emit: e, emit16: L16(e),
        spark: 0, absorber: c, name: `${s.name}* → ${s.name} + ${BANDS[e].name} light` });
      out.push({ fam: 'dark', by: 'light', band: b, ins: [c], outs: [c], heat16: L16(b), light16: L16(b), spark: 0, absorber: c,
        name: `${s.name}* → ${s.name} + heat` });
    }
  });
  for (const r of out) {
    const dE = r.outs.reduce((x, c) => x + SUBSTANCES[c].e16, 0) - r.ins.reduce((x, c) => x + SUBSTANCES[c].e16, 0);
    if (r.light16 !== r.heat16 + dE + (r.emit16 || 0) || r.heat16 < 0) throw new Error(`reaction ${r.name} does not balance`);
  }
  checkCharge(out, 'reaction');
  if (out.length > 48) throw new Error(`the shaders hold 48 reactions, the electrons' table has ${out.length}`);
  return out;
}

function deriveReactions() {
  const out = [];
  const ch = (name) => SUBSTANCES.findIndex((s) => s.name === name);
  const L16 = (b) => Math.round(16 * BANDS[b].photon);
  const free = SUBSTANCES.map((s, c) => [s, c]).filter(([s]) => s.kind === 'atom' && !s.excited);   // (step C12c: not the excited)
  // step C12c: a reaction driven by LIGHT that frees light givers or takers frees them EXCITED (with the excited waste on):
  // exOuts, each product's excited twin (or null), and the heat that is then left (every freed light atom keeps E* of it)
  const excite = (outs, heat16) => {
    const ex = outs.map((c) => { const t = ch(`${SUBSTANCES[c].name}*`); return t >= 0 ? t : null; });
    if (ex.every((t) => t == null)) return {};
    return { exOuts: ex, exHeat16: heat16 - ex.reduce((x, t) => x + (t == null ? 0 : SUBSTANCES[t].e16), 0) };
  };
  SUBSTANCES.forEach((f, c) => {
    if (f.kind === 'fuel') {
      const [x, y] = f.atoms.map(ch);
      const b = makingBand(f);
      if (b >= 0) out.push({ fam: 'make', by: 'light', band: b, ins: [x, y], outs: [c], heat16: L16(b) - f.e16, light16: L16(b), spark: f.spark, name: `${f.atoms[0]} + ${f.atoms[1]} → ${f.name}` });
      out.push({ fam: 'burn', by: 'heat', ins: [c], outs: [x, y], heat16: f.e16, light16: 0, spark: f.spark, name: `${f.name} → ${f.atoms[0]} + ${f.atoms[1]}` });
      out.push({ fam: 'photo', by: 'light', band: HARD, ins: [c], outs: [x, y], heat16: L16(HARD) + f.e16, light16: L16(HARD), spark: f.spark, name: `${f.name} → ${f.atoms[0]} + ${f.atoms[1]} (hard light)`,
        ...excite([x, y], L16(HARD) + f.e16) });   // (step C12c: its light atoms leave excited)
      // swaps: a free atom of the same group as one of the pair, from the other row, takes that one's place, if that
      // makes a poorer fuel (downhill)
      for (const [z, cz] of free) {
        for (let k = 0; k < 2; k++) {
          const old = f.atoms[k];
          if (ATOMS[z.name].group !== ATOMS[old].group || z.name === old) continue;
          const pair = k === 0 ? [z.name, f.atoms[1]] : [f.atoms[0], z.name];
          const cn = ch(pair.join(''));
          if (cn < 0 || SUBSTANCES[cn].e16 >= f.e16) continue;
          out.push({ fam: 'swap', by: 'heat', ins: [cz, c], outs: [cn, ch(old)], heat16: f.e16 - SUBSTANCES[cn].e16, light16: 0, spark: f.spark, name: `${z.name} + ${f.name} → ${SUBSTANCES[cn].name} + ${old}` });
          // step C6: and its inverse, uphill, by light of the lowest band that covers the difference and the spark
          // (poorer fuel + the heavy atom -> richer fuel + a free light atom); slow in the open (kUpSwap)
          const dE = f.e16 - SUBSTANCES[cn].e16, ub = BANDS.findIndex((b) => b.photon >= dE / 16 + f.spark);
          // (step C12c: with the excited waste on, the freed light atom leaves excited, keeping E* of the heat)
          out.push({ fam: 'upswap', by: 'light', band: ub, ins: [cn, ch(old)], outs: [c, cz], heat16: L16(ub) - dE, light16: L16(ub), spark: f.spark, name: `${SUBSTANCES[cn].name} + ${old} → ${f.name} + ${z.name}`,
            ...excite([c, cz], L16(ub) - dE) });
        }
      }
    }
    if (f.kind === 'sediment') {
      const x = ch(f.atoms[0]);
      out.push({ fam: 'form', by: 'heat', ins: [x, x], outs: [c], heat16: -f.e16, light16: 0, spark: f.spark, name: `${f.atoms[0]} + ${f.atoms[1]} → ${f.name}` });
      out.push({ fam: 'crack', by: 'light', band: HARD, ins: [c], outs: [x, x], heat16: L16(HARD) + f.e16, light16: L16(HARD), spark: f.spark, name: `${f.name} → ${f.atoms[0]} + ${f.atoms[1]} (hard light)` });
    }
    // step C12: oil (a mixed chain) forms and cracks as sediment does; an amphiphile's head goes on by light, off by heat
    if (f.kind === 'oil') {
      const [x, y] = f.atoms.map(ch);
      out.push({ fam: 'oil', by: 'heat', open: true, ins: [x, y], outs: [c], heat16: -f.e16, light16: 0, spark: f.spark, name: `${f.atoms[0]} + ${f.atoms[1]} → ${f.name}` });
      out.push({ fam: 'oilcrack', by: 'light', band: HARD, open: true, ins: [c], outs: [x, y], heat16: L16(HARD) + f.e16, light16: L16(HARD), spark: f.spark, name: `${f.name} → ${f.atoms[0]} + ${f.atoms[1]} (hard light)` });
    }
    if (f.kind === 'amphiphile') {
      const h = ch(f.atoms[0]), tl = ch(f.atoms.slice(1).join(''));
      const d = f.e16 - SUBSTANCES[h].e16 - SUBSTANCES[tl].e16, b = bondBand(d / 16 + f.spark);   // uphill: d > 0
      const tn = SUBSTANCES[tl].name;
      out.push({ fam: 'head', by: 'light', band: b, open: true, ins: [h, tl], outs: [c], heat16: L16(b) - d, light16: L16(b), spark: f.spark, name: `${f.atoms[0]} + ${tn} → ${f.name}` });
      out.push({ fam: 'unhead', by: 'heat', open: true, ins: [c], outs: [h, tl], heat16: d, light16: 0, spark: f.spark, name: `${f.name} → ${f.atoms[0]} + ${tn}` });
    }
  });
  // every event conserves energy exactly: light in = heat out + change of the bonds' energy
  for (const r of out) {
    const dE = r.outs.reduce((x, c) => x + SUBSTANCES[c].e16, 0) - r.ins.reduce((x, c) => x + SUBSTANCES[c].e16, 0);
    if (r.light16 !== r.heat16 + dE || r.heat16 < 0) throw new Error(`reaction ${r.name} does not balance`);
    if (r.exOuts) {   // step C12c: and with the excited atoms out
      const outs = r.outs.map((c, k) => r.exOuts[k] ?? c);
      const dX = outs.reduce((x, c) => x + SUBSTANCES[c].e16, 0) - r.ins.reduce((x, c) => x + SUBSTANCES[c].e16, 0);
      if (r.light16 !== r.exHeat16 + dX || r.exHeat16 < 0 || r.by !== 'light') throw new Error(`reaction ${r.name} (excited) does not balance`);
      r.exOuts.forEach((t, k) => { if (t != null && SUBSTANCES[t].ground !== SUBSTANCES[r.outs[k]].name) throw new Error(`reaction ${r.name}: not a twin`); });
    }
  }
  checkCharge(out, 'reaction');
  return out;
}

/** Step C6b: every reaction (or engine) conserves charge: the charges of its products add up to its reactants'. */
function checkCharge(list, what) {
  const q = (chs) => chs.reduce((x, c) => x + SUBSTANCES[c].charge, 0);
  for (const r of list) if (q(r.ins) !== q(r.outs)) throw new Error(`${what} ${r.name} does not conserve charge`);
}

/** Step C6b: the charges as one word for the shaders, 2 bits per channel (0: none, 1: +1, 2: -1; heat_common.wgsl). */
export const CHARGE_CODES = SUBSTANCES.slice(0, 16).reduce((m, s, c) => {
  if (Math.abs(s.charge) > 1) throw new Error(`charge of ${s.name} (${s.charge}) does not fit the shaders' code`);
  return (m | ((s.charge > 0 ? 1 : s.charge < 0 ? 2 : 0) << (2 * c))) >>> 0;
}, 0);
// (step C12c: the excited atoms' charge is their ground twin's: charge_of reads channel c - 16 for c >= 16)
SUBSTANCES.forEach((s, c) => { if (c >= EXC0 && s.charge !== SUBSTANCES[c - EXC0].charge) throw new Error(`${s.name} must carry ${SUBSTANCES[c - EXC0].name}'s charge`); });

// ---------- step C6: the ENGINES a genome can carry, also derived from the table ----------
// An engine slot names one of these by its index (Bio.eng in cell_common.wgsl). Every engine is one reaction of REACTIONS,
// run inside the cell on its stock; the table does the bookkeeping:
// The set is SYMMETRIC (the user: "endothermic and exothermic reactions and their inverse"): every reaction of the table
// that changes energy is an engine in both directions.
//   UPHILL (kind 0, "harvest"): make fuel (g + t -> gt, ...), uphill swaps (gT + G -> GT + g, ...: light upgrades a fuel
//            and frees a light atom), crack sediment (ll -> l + l). What pays the energy difference: the slot's band
//            gene. Band 1 to 3: a PIGMENT catches that band of the light on the cell, one photon per event (a photon
//            below the difference takes the rest from the battery; the rest of a photon is heat). Band 0: no pigment, a
//            STORER: the battery pays the whole difference (battery energy banked as fuel in the stock). The spark is
//            always paid from the battery and lost as heat. Light never charges the battery.
//   DOWNHILL (kinds 1 burn, 2 swap, 3 form): burn fuel, swap (a light atom takes a heavy one's place: "breathing"),
//            form sediment. The spark is paid from the battery and given back; the energy released goes into the
//            battery minus a share as heat. Only these fill a battery.
// In this order (4 make, 4 uphill swaps, 2 crack, 4 burn, 4 swap, 2 form = 20), so the order is part of the genome's
// meaning: keep it (a slot holds the index + 32 x its band, 0 to 3).
export const ENGINE_KINDS = ELECTRONS ? ['harvest', 'ferment', 'breathe', 'form'] : ['harvest', 'burn', 'swap', 'form'];
export const ENGINES = ELECTRONS ? deriveEnginesE() : deriveEngines();
setShaderConst('ENG_COUNT', ENGINES.length);   // (cell_common.wgsl: the engines a slot can name)

// Step C12d (electrons): every reaction of the table except the open dish's oil and heads, both ways (22): UPHILL (kind 0:
// splits, uphill swaps, the uphill trade, cracks: a pigment's photon or the battery pays) then DOWNHILL: BREATHE (kind 2: a free
// light taker, the strongest grabber, takes an electron: t + gT, t + GT, g + t, G + t), FERMENT (kind 1: the other bonds, swaps
// and the trade, no free light taker), FORM (kind 3: chains). The genome names an engine by its index: keep the order.
function deriveEnginesE() {
  const tk = Object.entries(ATOMS).filter(([, a]) => a.group === 'taker' && !a.ground).reduce((m, x) => (valence(x[1]) < valence(m[1]) ? x : m))[0];
  const best = SUBSTANCES.findIndex((s) => s.name === tk);
  const out = [];
  for (const fam of ['burn', 'swap', 'photo', 'crack']) {
    for (const r of TABLE_E) if (r.dir === 'up' && !r.open && r.fam === fam) out.push({ kind: 0, fam, ins: r.ins, outs: r.outs, g16: r.d16, spark: r.spark, band: 0, name: r.name });
  }
  for (const fam of ['make', 'swap', 'photo', 'form']) {
    for (const r of TABLE_E) {
      if (r.dir !== 'down' || r.open || r.fam !== fam) continue;
      out.push({ kind: fam === 'form' ? 3 : r.ins.includes(best) ? 2 : 1, fam, ins: r.ins, outs: r.outs, g16: -r.d16, spark: r.spark, band: 0, name: r.name });
    }
  }
  const key = (e) => `${[...e.ins].sort()}>${[...e.outs].sort()}`, inv = (e) => `${[...e.outs].sort()}>${[...e.ins].sort()}`;
  const keys = new Set(out.map(key));
  if (out.length !== 22 || out.some((e) => e.g16 <= 0 || !keys.has(inv(e)))) throw new Error('electrons: the engine table is not as expected');
  checkCharge(out, 'engine');
  return out;
}

function deriveEngines() {
  const order = [['make', 0], ['upswap', 0], ['crack', 0], ['burn', 1], ['swap', 2], ['form', 3]];
  const out = [];
  const dE = (ins, outs) => outs.reduce((x, c) => x + SUBSTANCES[c].e16, 0) - ins.reduce((x, c) => x + SUBSTANCES[c].e16, 0);
  for (const [fam, kind] of order) {
    for (const r of REACTIONS) {
      if (r.fam !== fam) continue;
      const d = dE(r.ins, r.outs);
      // g16: per event, heat counts stored in bonds (uphill, d > 0) or released (downhill, d < 0)
      out.push({ kind, fam, ins: r.ins, outs: r.outs, g16: Math.abs(d), spark: r.spark, band: r.band ?? 0, name: r.name.replace(' (hard light)', '') });
      if ((kind === 0) !== (d > 0)) throw new Error(`engine ${r.name} is not ${kind === 0 ? 'uphill' : 'downhill'}`);
    }
  }
  // every downhill engine's inverse is an uphill one and back (the set is symmetric)
  const key = (e) => `${[...e.ins].sort()}>${[...e.outs].sort()}`, inv = (e) => `${[...e.outs].sort()}>${[...e.ins].sort()}`;
  const keys = new Set(out.map(key));
  if (out.length !== 20 || out.some((e) => e.g16 <= 0 || !keys.has(inv(e)))) throw new Error('engine table is not as expected');
  checkCharge(out, 'engine');
  return out;
}
/** An engine's index by its reaction's name (as in REACTIONS, e.g. 'gt → g + t'). */
export function engineIndex(name) { return ENGINES.findIndex((e) => e.name === name); }

/**
 * Step C5: every channel the cells' insides can make from the channels in `active`: their burner (fuel -> its atoms, as
 * the burn reactions) and the heat-driven reactions (whatever the switches: the closure only has to be wide enough).
 * Step C6: and their engines (make fuel too).
 */
export function insideProducts(active) {
  let m = active;
  for (let grew = true; grew;) {
    grew = false;
    for (const r of [...REACTIONS.filter((x) => x.by === 'heat' && !x.open), ...ENGINES]) {   // (step C12: not the open dish's)
      if (r.ins.every((c) => m & (1 << c))) for (const c of r.outs) if (!(m & (1 << c))) { m |= 1 << c; grew = true; }
    }
  }
  return m;
}

/** A substance's name in words, for the flash and the overlay. */
export function describe(s) {
  const role = (a) => `${ATOMS[a].row === 1 ? 'light' : 'heavy'} ${ATOMS[a].group}`;
  if (s.excited) return `excited atom ${s.name} (a ${role(s.ground)} freed by light, holding ${s.energy} of the photon; it fades back to ${s.ground})`;
  if (s.kind === 'atom') return `free atom ${s.name} (${role(s.atoms[0])}${s.reactive ? ', reactive' : ''})`;
  if (s.kind === 'fuel' && s.mineral) return `mineral ${s.name} (${role(s.atoms[0])} + ${role(s.atoms[1])}: its electron sits in the deepest slot, settled)`;
  if (s.kind === 'fuel') return `${ELECTRONS ? 'fuel' : 'fuel'} ${s.name} (${role(s.atoms[0])} + ${role(s.atoms[1])}${ELECTRONS ? ': its electron still sits high' : ''})`;
  if (s.kind === 'sediment') return `sediment ${s.name} (${s.atoms[0] === 'l' ? 'light' : 'heavy'} linker chain)`;
  if (s.kind === 'oil') return `oil ${s.name} (a light and a heavy linker chained: apolar, water-shy)`;
  if (s.kind === 'amphiphile') return `amphiphile ${s.name} (${role(s.atoms[0])} head on an oil tail: soap-like, charge ${s.charge > 0 ? '+' : ''}${s.charge})`;
  return 'trace (the rare inert atom)';
}

// The springs' mixes (shares of the dripped atoms). Tap mode 2 = LIGHT spring (row 1), tap mode 3 = HEAVY spring
// (row 2, plus a little trace).
// Step C12d (electrons): no free reactive light atoms from the springs any more (any free light taker in the dish is made by light
// or life): tap mode 2 drips MINERALS (water-like gt, and the linkers that build crust, oil and membranes), tap mode 3 is a VENT
// (the fuel-like gT and GT and free heavy givers G, metal-like, which give easily: food without oxygen; a little trace). The kinds
// keep their keys ('light', 'heavy'), so tools and saved conditions still drop them.
export const SPRING_KINDS = {
  light: ELECTRONS ? { label: 'mineral spring', mix: { gt: 0.6, l: 0.2, L: 0.2 }, stroke: 1.25 }
    : { label: 'light spring', mix: { g: 1 / 3, t: 1 / 3, l: 1 / 3 }, stroke: 1.25 },
  heavy: ELECTRONS ? { label: 'vent', mix: { G: 0.2, gT: 0.36, GT: 0.4, trace: 0.04 }, stroke: 2.25 }
    : { label: 'heavy spring', mix: { G: 0.32, T: 0.32, L: 0.32, trace: 0.04 }, stroke: 2.25 },
  // step C10, the tissue lab only (no tool drops them; experiments/tissue/c10.py): linkers for the walls' cost, and the C6d ion
  // test spring (light givers + heavy takers) that polarises the cells near it
  linker: { label: 'linker spring (lab)', mix: { l: 0.5, L: 0.5 }, stroke: 1.5 },
  ions: { label: 'ion spring (lab)', mix: { g: 0.5, T: 0.5 }, stroke: 1.5 },
  // step C12: springs of whole molecules (the oil tool drops one of these, as the dish panel chooses; shares of the atoms)
  oil: { label: 'oil spring', mix: { lL: 1 }, stroke: 1.75 },
  emulsion: { label: 'oil + soap spring', mix: { lL: 0.9, glL: 0.05, tlL: 0.05 }, stroke: 1.75 },
  soap: { label: 'soap spring', mix: { glL: 0.5, tlL: 0.5 }, stroke: 1.75 },
};
export const OIL_SPRINGS = ['oil', 'emulsion', 'soap'];   // step C12: what the oil tool drops (src/oil.js params.spring)

export const ATOM_SCALE = 4096;          // counts per atom-unit (ATOM_SCALE in matter.wgsl)
const MP_BYTES = 688;                     // struct MatterP (step C6b: + chg, cq; step C12: + the oil's, 400 until then)
const MT_SLOT = 256;                      // struct MatterTick slots, bound with a dynamic offset
const MAX_TICKS = 320;                    // as SLOTS in cells.js
const MAX_SUB = 4;                        // spreading substeps per tick at most
const MT_LEDGER = MAX_TICKS * MAX_SUB;    // slot: the ledger snapshot and the paint (current copy after the ticks)
const MT_DRAIN = MT_LEDGER + 1;           // slot: the old grid on a resize
const MT_WASH = MT_LEDGER + 2;            // slot: Shift+C
const MT_SLOTS = MT_LEDGER + 3;
export const MAX_SPRINGS = 16;            // the springs uniform's capacity
const SPRING_FLOATS = 28;                 // struct Spring: pos (4), amt (20: 18 channels, [19] its disc's pixels), ink (4)
const DRAW_BYTES = 448;                   // struct DrawP in matter_draw.wgsl (224 until step C12, 336 until step C12c, 368 until C12d)
const K_MAX = 0.2;
const LG_M = { ADD: 3072, LOST: 4736, GONE: 6400, DISH: 8064, ORDER: 9728 };   // heat_common.wgsl
const LG_C = { LIGHT: 10240, RX: 10752 };
// step C12 (heat_common.wgsl): the ledger of channels 13..15, the oil's 4 families, the oil's snapshot
const LG_OIL = 23040, LG_OIL_RX = 24576, LG_OIL_SNAP = 25088;
const LG_EXC = 25600;                     // step C12c (heat_common.wgsl): the ledger of channels 16, 17 (the excited atoms)
const REGION = { ADD: 0, LOST: 1, GONE: 2, DISH: 3 };
/** The ledger word of channel c in a matter region ('ADD', 'LOST', 'GONE', 'DISH'), as lg_mc in heat_common.wgsl. */
export function lgM(region, c) {
  if (c >= EXC0) return LG_EXC + 256 * REGION[region] + 128 * (c - EXC0);
  return c < NCH_CELL ? LG_M[region] + 128 * c : LG_OIL + 384 * REGION[region] + 128 * (c - NCH_CELL);
}
/** The ledger word of a reaction family's events. */
function lgRx(k) { return k < 6 ? LG_C.RX + 128 * k : LG_OIL_RX + 128 * (k - 6); }
const LG_Q_PHI = 19200;                     // step C6b (heat_common.wgsl): phi's spread (256 f32), then its largest size   // step C4 (heat_common.wgsl): light caught per band, events per family
const MAX_RX = 48;                          // struct ChemP's reactions (REACTIONS has 24 since step C6's uphill swaps, 30 since C12;
                                            // step C12d's electrons 38)
const RX_BYTES = 48;                        // struct Rx
const CP_RX = 160;                          // struct ChemP: its first reaction's byte offset (96 until step C7b's cry, 112 until
                                            // step C12's fuse, 128 until step C12c's ex, 144 until step C12d's el)
const CP_BYTES = CP_RX + MAX_RX * RX_BYTES; // struct ChemP
const NONE = 255;                           // no channel (Rx.ch)
const SED_MASK = SUBSTANCES.reduce((m, s, c) => (s.kind === 'sediment' ? m | (1 << c) : m), 0);
const ORDER_SLOTS = 256;

// what Shift+S shows: the summary, each substance alone, nothing
export const SHOWS = ['summary', ...SUBSTANCES.map((s) => s.name), 'off'];

export class Matter {
  constructor(device, format, medium) {
    this.device = device;
    this.format = format;
    this.medium = medium;
    this.heat = null;
    this.landscape = null;    // key L hides the whole landscape, this included (set by main.js)
    this.blocks = 2 * NCH + 4;   // blocks of n words in the heat buffer (step C12: + the oil's rho, film, obar, a scratch)
    this.oil = new Oil(this);    // step C12: oils and water (src/oil.js)
    this.excited = new Excited(this, EXCITED);   // step C12c: excited waste (src/excited.js)
    this.electrons = new Electrons(this);         // step C12d: electrons (src/electrons.js): absorption by gap, excited states
    if (ELECTRONS) { this.excited.params.on = false; this.excited.look.on = false; }   // (C12c's lasting excited atoms are folded in)
    this.CH = CH; this.SUBSTANCES = SUBSTANCES;
    // live-tunable: moire.matter.params
    this.params = {
      show: 0,            // index into SHOWS (Shift+S cycles)
      edge: 1,            // share of the mobile atoms on the dish's rim pixels that leaves per s (the sink)
      spreadGain: 1,      // multiplies every substance's spreading (SPREAD above stays the source of truth)
      // springs
      rate: 6,            // atoms per s a spring drips (all its atoms together)
      life: 60,           // s of simulation time a spring drips before it dries up (and is removed)
      radius: 1,          // the disc it drips over, in cell radii R (at most 7 heat pixels)
      maxSprings: 12,     // one more removes the oldest (up to MAX_SPRINGS)
      // drawing: halftone dots on the medium lattice
      step: 2,            // dot spacing in medium lattice spacings (the medium's lattice spacing is 2 / sqrt 3 x its period)
      maxDot: 0.9,        // largest dot radius, as a share of half the distance between neighbouring dots of two layers
      half: 0.6,          // amount per R^2 at which a dot covers half its largest area (dot area = c / (c + half))
      thresh: 0.06,       // coverage below which there is no dot
      level: 0.85,        // the inks' brightness (step C6n: the palette's levels.substances, src/palette.js)
      // step C6n: how the substances look (Shift+5; the clean / machinery switch, Shift+4, sets it too):
      //   dust      MATERIAL: specks scattered at fixed random places (a fine grid, each square holding at most one speck
      //             per kind, its place jittered by a hash, so nothing flickers), as many as the amount says: fuel as
      //             green glow-dust, free atoms fainter, trace as rare small sparks; sediment as solid crusts (default)
      //   halftone  the dots on the medium lattice of steps C3 to C6 (the machinery view)
      style: 'dust',
      dustCell: 3.2,      // dust: the grid's square (CSS px); at most one speck of each kind in each
      dustR: [0.45, 0.95], // dust: a speck's radius (CSS px) at a small and at a large amount
      dustAtoms: 0.55,    // dust: free atoms' brightness, as a share of the fuel's (they are the quieter material)
      traceDot: 0.75,     // trace diamonds' size, as a share of a full dot
      sedStep: 0.3,       // sediment: amount per R^2 where a crust patch starts (its lighter core from 4 x; hard edges)
      sedAlpha: 0.7,      // sediment: opacity of the top level
      ringR: 1.3,         // spring marker radius, in medium R (CSS px x R)
    };
    // step C4, chemistry in the open (live-tunable: moire.matter.chem). The switches are the rules (Shift+M and the
    // others, src/actions.js); the numbers are the knobs. Energies and sparks are not here: they come from the table
    // (CHEM, derive). Rates are per s of simulation time; amounts per R^2.
    this.chem = {
      on: true,           // Shift+M: the chemistry as a whole
      make: true,         // Shift+F: light makes fuel (giver + taker -> fuel, by the fuel's band)
      burn: true,         // Shift+B: fuel breaks back into its atoms (by heat; and by hard light)
      swap: true,         // Shift+P: swaps (a free atom takes a partner out of a richer bond)
      sediment: true,     // Shift+K: linkers chain into sediment (by heat); hard light cracks it
      trace: true,        // Shift+T: trace lowers the spark where it sits
      theta: 1 / 32,      // temperature scale of the sparks: rate x exp(-spark / (theta x temperature per R^2))
      kMake: 1,           // optical depth of a giver-taker pair for its band, per pair unit per R^2 (pair = a b / (a + b))
      kBurn: 0.5,         // per s: fuel breaking by heat, before the spark's factor
      kPhoto: 0.03,       // optical depth of fuel for hard light (breaking it), per unit per R^2
      kSwap: 5,           // R^2 per s: swaps, before the spark's factor
      kUpSwap: 0.02,      // step C6: optical depth of a fuel + heavy atom pair for the uphill swap's band (slow: kMake / 50)
      kSed: 2,            // R^2 per s: linker + linker -> sediment, before the spark's factor
      kCrack: 0.01,       // optical depth of sediment for hard light (cracking it), per unit per R^2
      dark: 3,            // optical depth of sediment for warm light (dark: it warms in the light), per unit per R^2
      traceK: 3,          // spark x 1 / (1 + traceK x trace per R^2)
      // step C12d (electrons): the bonds and the trade run downhill by heat (R^2 per s, before the spark's factor)
      kBond: 5,           // giver + taker -> compound
      kTrade: 5,          // two compounds swap partners
    };
    this.springs = [];        // { x, y, kind, age }
    this.seen = new Float64Array(NCH).fill(-1e9);   // when each channel last had matter (or a spring dripping it)
    this.time = 0;
    this.cur = 0;             // which copy is current
    this.nSub = 1;
    this.bufVersion = -1;     // the heat buffer version the bind groups and `cur` belong to
    this.view = null;
    // ledger (atom-units; cumulative since the page started, per channel)
    this.tot = { add: new Float64Array(NCH), lost: new Float64Array(NCH), gone: new Float64Array(NCH) };
    this.dish = new Float64Array(NCH);
    this.ledger = null;       // last snapshot (see apply)
    this.hist = [];           // [time, added, lost] for the rates
    this.orderHist = [];      // [time, order] (the last few minutes)
    // step C4: cumulative light caught by the substances per band (energy units) and events per family (substance units)
    this.ctot = { light: new Float64Array(BANDS.length), rx: new Float64Array(FAMILIES.length) };
    this.chist = [];          // [time, ...events per family, light caught] for the rates
    this.light = null;        // step C4: the light (its uniform is bound to the reactions; set by main.js)
    this.eat = null;          // step C5: the cells' eating (src/eat.js; set by main.js): their stock is in the atoms ledger
    this.charge = null;       // step C6b: the charge field (src/charge.js; set by main.js): solved in each tick's pass, drifts
    this.catalysts = null;    // step C7b: the catalysts (src/catalysts.js; set by main.js): crystal seeding in the open
    this.snapTime = -1e9;     // step C5: the frame time of the last ledger read-back applied
    this.maskHist = [];       // step C5: [frame time, channels moving] of the frames since
    this.rxOn = [];           // the reactions sent to the GPU this frame
  }

  static async create(device, format, medium) {
    const m = new Matter(device, format, medium);
    await m.init();
    return m;
  }

  async init() {
    const d = this.device;
    const res = await fetch(HEAT_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${HEAT_COMMON_URL}: HTTP ${res.status}`);
    const common = (await res.text()).replace(/\s*$/, '\n\n');
    const fres = await fetch('src/shaders/field_common.wgsl', { cache: 'no-cache' });
    if (!fres.ok) throw new Error('Could not load shader src/shaders/field_common.wgsl');
    const field = (await fres.text()).replace(/\s*$/, '\n\n');
    const lres = await fetch(LIGHT_COMMON_URL, { cache: 'no-cache' });
    if (!lres.ok) throw new Error(`Could not load shader ${LIGHT_COMMON_URL}: HTTP ${lres.status}`);
    const lightC = (await lres.text()).replace(/\s*$/, '\n\n');
    const [mod, drawMod] = await Promise.all([
      loadShader(d, 'src/shaders/matter.wgsl', { prefixes: [{ name: HEAT_COMMON_URL, text: common }, { name: LIGHT_COMMON_URL, text: lightC }] }),
      loadShader(d, 'src/shaders/matter_draw.wgsl', { prefixes: [{ name: 'src/shaders/field_common.wgsl', text: field }] }),
    ]);
    const C = GPUShaderStage.COMPUTE, U = GPUBufferUsage;
    this.bgl = d.createBindGroupLayout({
      label: 'matter',
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
        { binding: 3, visibility: C, buffer: { type: 'uniform' } },
        { binding: 4, visibility: C, buffer: { type: 'storage' } },
        { binding: 5, visibility: C, buffer: { type: 'uniform' } },   // step C4: the light (light_common.wgsl)
        { binding: 6, visibility: C, buffer: { type: 'uniform' } },   // step C4: the chemistry (struct ChemP)
      ],
    });
    this.texBgl = d.createBindGroupLayout({
      label: 'matter paint',
      entries: [
        { binding: 0, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },   // step C12: oil
        { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },   // step C12c: excited
      ],
    });
    const layout = d.createPipelineLayout({ label: 'matter', bindGroupLayouts: [this.bgl] });
    const paintLayout = d.createPipelineLayout({ label: 'matter paint', bindGroupLayouts: [this.bgl, this.texBgl] });
    this.pipes = {};
    for (const e of ['spread', 'count', 'react', 'relax_red', 'relax_black', 'oil_rho', 'oil_blur', 'oil_blur_y']) {   // (relax: step C6b's charge field; oil_*: C12)
      this.pipes[e] = d.createComputePipeline({ label: `matter ${e}`, layout, compute: { module: mod, entryPoint: e } });
    }
    this.pipes.paint = d.createComputePipeline({ label: 'matter paint', layout: paintLayout, compute: { module: mod, entryPoint: 'paint' } });
    this.paramBuf = d.createBuffer({ label: 'matter params', size: MP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.paramAB = new ArrayBuffer(MP_BYTES);
    this.tickBuf = d.createBuffer({ label: 'matter tick params', size: MT_SLOTS * MT_SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.tickAB = new ArrayBuffer(MT_SLOTS * MT_SLOT);
    this.springBuf = d.createBuffer({ label: 'springs', size: MAX_SPRINGS * SPRING_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
    this.springF = new Float32Array(MAX_SPRINGS * SPRING_FLOATS);
    this.chemBuf = d.createBuffer({ label: 'chemistry', size: CP_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.chemAB = new ArrayBuffer(CP_BYTES);

    // drawing
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.drawPipe = d.createRenderPipeline({
      label: 'matter draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.drawU = d.createBuffer({ label: 'matter draw params', size: DRAW_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.drawAB = new ArrayBuffer(DRAW_BYTES);
    // step H1: the harmonic look's substances (fs_harm, its own uniform HarmP at binding 8; src/harmonic.js)
    this.harmPipe = d.createRenderPipeline({
      label: 'matter draw (harmonic)', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs_harm', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.harmU = d.createBuffer({ label: 'matter draw (harmonic)', size: 144, usage: U.UNIFORM | U.COPY_DST });
    this.harmF = new Float32Array(36);
    this.sampler = d.createSampler({ label: 'matter', magFilter: 'linear', minFilter: 'linear' });
    this.tex = null;          // [A, B] at the grid's size
  }

  /** The heat band whose buffer and grid the substances share. Called once by main.js, before the first resize. */
  attach(heat) {
    this.heat = heat;
    heat.setMatter(this);
  }

  get showName() { return SHOWS[this.params.show] || 'summary'; }

  makeBG(buffer) {
    return this.device.createBindGroup({
      label: 'matter', layout: this.bgl,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuf } },
        { binding: 1, resource: { buffer: this.tickBuf, size: 32 } },
        { binding: 2, resource: { buffer, offset: 0, size: LEDGER_WORDS * 4 } },   // the ledger, atomic
        { binding: 3, resource: { buffer: this.springBuf } },
        { binding: 4, resource: { buffer, offset: LEDGER_WORDS * 4 } },   // ... the grid blocks behind it, plain (matter.wgsl)
        { binding: 5, resource: { buffer: this.light.buffer } },
        { binding: 6, resource: { buffer: this.chemBuf } },
      ],
    });
  }

  /** Word offset of copy k's channel 0, counted from the end of the ledger (the grid binding's start), for n pixels. */
  copyBase(k, n = this.heat.n) { return this.heat.extraBase(n) - LEDGER_WORDS + k * NCH * n; }
  /** Step C12: word offset (in the grid binding) of the oil's 4 blocks (rho, film, obar, scratch), behind the two copies. */
  oilBase(n = this.heat.n) { return this.copyBase(2, n); }

  /**
   * Step C5: the word offset in the heat buffer of the copy current at the start of the cells' tick t of this frame
   * (the cells' warm-up ticks come first; the substances sit those out), for the cells' step and eat pass; outside a
   * frame (`outside`), the current copy. 0: no grid yet.
   */
  copyAt(t, outside = false) {
    const H = this.heat;
    if (!H || !H.buffer || this.bufVersion !== H.version) return 0;
    const mt = t - (this.warm || 0);
    const c = !outside && this.ticks && this.active && mt >= 0 ? this.cur ^ ((mt * this.nSub) & 1) : this.cur;
    return LEDGER_WORDS + this.copyBase(c);
  }

  /** Step C5: the channels in `mask` count as seen now (the cells just put matter into them outside a frame). */
  touch(mask) { for (let c = 0; c < NCH; c++) if (mask & (1 << c)) this.seen[c] = this.time; }

  resize(view) {
    // keep the springs at the same place relative to the dish
    if (this.view && (this.view.cssW !== view.cssW || this.view.cssH !== view.cssH)) {
      const sx = view.cssW / this.view.cssW, sy = view.cssH / this.view.cssH;
      for (const s of this.springs) { s.x *= sx; s.y *= sy; }
    }
    this.view = view;
  }

  // ---------- springs ----------
  /** Drop a spring at CSS px (x, y): kind 'light' or 'heavy'; life: s it drips (default params.life; step C5). */
  addSpring(x, y, kind, life = null) {
    const cap = Math.max(1, Math.min(MAX_SPRINGS, Math.round(this.params.maxSprings)));
    while (this.springs.length >= cap) this.springs.shift();
    this.springs.push({ x, y, kind, age: 0, life });
  }

  /** A spring's life (s): its own, or params.life. */
  lifeOf(s) { return s.life ?? this.params.life; }

  clearSprings() { this.springs.length = 0; }

  /** Shift+C: every atom out of the dish (booked as gone), now. */
  wash() {
    if (!this.bg || !this.heat.buffer) return;
    this.dish.fill(0);
    const d = this.device, n = this.heat.n;
    const T = new Uint32Array(this.tickAB), o = MT_WASH * MT_SLOT / 4;
    T[o] = this.copyBase(this.cur); T[o + 1] = 0; T[o + 2] = 0; T[o + 4] = n; T[o + 5] = LG_M.GONE;
    d.queue.writeBuffer(this.tickBuf, MT_WASH * MT_SLOT, this.tickAB, MT_WASH * MT_SLOT, MT_SLOT);
    const e = d.createCommandEncoder({ label: 'matter wash' });
    const pass = e.beginComputePass({ label: 'matter wash' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.bg, [MT_WASH * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
    e.clearBuffer(this.heat.buffer, (LEDGER_WORDS + this.copyBase(0)) * 4, this.blocks * n * 4);
    d.queue.submit([e.finish()]);
  }

  // ---------- the frame (called by the cells, between the heat's beginFrame and its ticks) ----------
  /** The old grid, replaced by a resize: its atoms are booked as gone (into its own ledger, which is carried over). */
  encodeDrain(encoder, buffer, n) {
    if (this.bufVersion < 0) return;
    const T = new Uint32Array(this.tickAB), o = MT_DRAIN * MT_SLOT / 4;
    T[o] = this.copyBase(this.cur, n); T[o + 1] = 0; T[o + 2] = 0; T[o + 4] = n; T[o + 5] = LG_M.GONE;
    this.device.queue.writeBuffer(this.tickBuf, MT_DRAIN * MT_SLOT, this.tickAB, MT_DRAIN * MT_SLOT, MT_SLOT);
    const pass = encoder.beginComputePass({ label: 'matter drain' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.makeBG(buffer), [MT_DRAIN * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
  }

  /**
   * The frame's set-up (after the heat's beginFrame): the springs, the spreading's and the reactions' parameters and
   * every tick's slots. `warm`: the cells' warm-up ticks that run before this frame's real ticks (the substances sit
   * those out, so matter tick t is the heat's tick warm + t). Then encodeTick for each tick, inside the heat's pass of
   * that tick, and endTicks.
   */
  beginFrame(encoder, frame, warm = 0) {
    this.ticks = 0;
    const H = this.heat;
    if (!H || !H.buffer) return;
    if (this.bufVersion !== H.version) {
      this.bufVersion = H.version;
      this.cur = 0;
      if (this.charge) this.charge.phiLive = false;   // step C6b: a new grid starts with phi = 0
      this.bg = this.makeBG(H.buffer);
      this.makeTextures();
    }
    const ticks = frame.ticks;
    if (!ticks) return;
    this.ticks = ticks;
    this.warm = warm;
    const p = this.params, dt = frame.tickDt, a = H.px / H.R;
    // springs: each drips on every tick of this frame on which it is still younger than its life (counted per tick, so
    // a spring gives the same amount at any speed, also with hundreds of ticks per frame), then ages and dries up.
    // Written longest-lived first (most life left), so the springs still dripping on tick t are the first nsAt(t).
    const order = this.springs.slice().sort((x, y) => (this.lifeOf(y) - y.age) - (this.lifeOf(x) - x.age));
    const ns = this.writeSprings(dt, order, ticks * dt);
    const nsAt = (t) => { let k = 0; while (k < ns && order[k].age + (t + 1) * dt < this.lifeOf(order[k])) k++; return k; };
    // the channels worth spreading: matter in the dish at the last read-back, or a spring dripping it, within the last
    // 2 s (so both copies of a channel left out are certainly all zero); the others are skipped (most are empty)
    this.time = frame.time;
    // (step C5: and what the cells hold, as they let it out into the dish)
    const held = this.eat && this.eat.ledger ? (this.eat.ledger.held || this.eat.ledger.stock) : null;   // (step C12b: + the lipids)
    for (let c = 0; c < NCH; c++) if (this.dish[c] > 0 || (held && held[c] > 0)) this.seen[c] = frame.time;
    for (const sp of order) for (const a of Object.keys(SPRING_KINDS[sp.kind].mix)) this.seen[CH[a]] = frame.time;
    for (const s of this.springs) s.age += ticks * dt;
    this.springs = this.springs.filter((s) => s.age < this.lifeOf(s));
    let active = 0;
    for (let c = 0; c < NCH; c++) if (frame.time - this.seen[c] < 2) active |= 1 << c;
    // step C4: the reactions on this frame, and every channel they can make from what is there (so a product's channel
    // spreads, both copies, from the tick it first appears)
    const rx = this.writeChem(dt);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rx) {
        if (r.ins.every((c) => active & (1 << c))) for (const c of r.outs) if (!(active & (1 << c))) { active |= 1 << c; grew = true; }
      }
    }
    // step C5: and every channel the cells' insides can make from what is there (their burner and the reactions inside,
    // whose products they let out); and the channels of the frames whose read-back has not come yet stay on: the cells
    // may have put matter into them, which the next read-back will show (a channel left out must be all zero in both
    // copies, see the top of this file)
    if (this.eat && this.eat.params.on) active = insideProducts(active);
    // step C12c: with the excited waste on, wherever light givers or takers are, light can excite them (in the open or in a
    // cell's pigment): their excited twins move too
    if (this.excited.on && (active & 3)) active |= (1 << EXC0) | (1 << (EXC0 + 1));
    this.maskHist = (this.maskHist || []).filter(([t]) => t > this.snapTime);
    for (const [, m] of this.maskHist) active |= m;
    this.maskHist.push([frame.time, active]);
    this.react = (rx.length > 0 || (this.dark && (active & SED_MASK) !== 0)) && active !== 0;
    this.active = active;

    // spreading per substep, per channel
    const kTot = SUBSTANCES.map((s) => Math.max(0, s.spread * p.spreadGain) * dt / (a * a));
    this.nSub = Math.max(1, Math.min(MAX_SUB, Math.ceil(Math.max(...kTot) / K_MAX)));
    const f = new Float32Array(this.paramAB), u = new Uint32Array(this.paramAB);
    u[0] = H.hw; u[1] = H.hh; u[2] = H.n; u[3] = this.copyBase(0);
    const show = this.showName;
    u[4] = show === 'off' ? 0 : show === 'summary' ? 1 : 2; u[5] = Math.max(0, CH[show] ?? 0); u[6] = this.nSub; u[7] = active;
    f[8] = H.px; f[9] = 1 / (ATOM_SCALE * a * a); f[10] = 1 - Math.exp(-Math.max(0, p.edge) * dt);
    u[11] = H.pigOn ? H.pigOffset - LEDGER_WORDS : 0;   // step C6: the cells' pigments (their depth takes its share of the light)
    SUBSTANCES.forEach((s, c) => {
      if (c >= 16) return;                                // (step C12c: the excited atoms read their ground twin's numbers)
      f[12 + c] = Math.min(K_MAX, kTot[c] / this.nSub);   // k
      u[28 + c] = s.layer;                                // layer
      f[44 + c] = s.reactive ? 1 : 0;                     // react
      f[60 + c] = s.heavy;                                // heavy
      f[76 + c] = s.atoms.length;                         // atoms per unit (the ORDER weights by atoms)
    });
    // step C6b: the charge field (src/charge.js): where phi and the cells' charge are, the charges, the relaxation's numbers
    const Q = this.charge, qOn = !!(Q && Q.fieldOn);
    this.solve = qOn;
    u[92] = qOn ? H.chargeOffset - LEDGER_WORDS : 0;
    u[93] = qOn && Q.cellsDeposit ? H.chargeOffset + H.n - LEDGER_WORDS : 0;
    u[94] = CHARGE_CODES; u[95] = 0;
    if (qOn) { const r = Q.relaxNumbers(1 / (ATOM_SCALE * a * a)); for (let k = 0; k < 4; k++) f[96 + k] = r[k]; }
    // step C12: the oil's words (src/oil.js); its passes run while oil or amphiphiles are in the dish
    const oilMask = (1 << CH.lL) | (1 << CH.glL) | (1 << CH.tlL);
    this.oilRun = this.oil.writeMatter(u, f, SUBSTANCES, this.oilBase(), 1 / (ATOM_SCALE * a * a), (active & oilMask) !== 0);
    this.device.queue.writeBuffer(this.paramBuf, 0, this.paramAB);

    const T = new Uint32Array(this.tickAB), w = MT_SLOT / 4;
    const seed0 = (frame.frameNo * 2654435761 + 0x7f4a7c15) >>> 0;
    this.seed0 = seed0;
    for (let t = 0; t < ticks; t++) {
      const nt = nsAt(t);
      const heatWord = H.offsetAt(warm + t) - LEDGER_WORDS;   // the heat copy current in this tick (index into the grid binding)
      for (let s = 0; s < this.nSub; s++) {
        const o = (t * MAX_SUB + s) * w, c = this.cur ^ ((t * this.nSub + s) & 1);
        T[o] = this.copyBase(c); T[o + 1] = this.copyBase(c ^ 1); T[o + 2] = s === 0 ? 1 : 0;
        T[o + 3] = Math.imul(seed0 + t * 131 + s * 7, 2654435761) >>> 0; T[o + 4] = nt; T[o + 5] = 0;
        T[o + 6] = heatWord;
      }
    }
    const last = (ticks - 1) * MAX_SUB + MAX_SUB;
    this.device.queue.writeBuffer(this.tickBuf, 0, this.tickAB, 0, Math.min(last, MT_LEDGER) * MT_SLOT);
  }

  /**
   * Tick t of this frame, recorded into the heat's pass of that tick (after the cells' step, before the heat spreads):
   * the spreading substeps, then the reactions in the copy they leave (which read the heat and the cells' cover of this
   * tick and put the heat they release into the delta the heat's spreading takes in next).
   * (With nothing in the dish and no spring, both copies are all zero: nothing to spread or react, the copies stay put.)
   */
  encodeTick(pass, t) {
    if (!this.active || t >= this.ticks) return;
    const H = this.heat;
    if (this.oilRun) {
      // step C12: the oil's share, film and smoothed share, from the tick's current copy (the first substep's src)
      pass.setBindGroup(0, this.bg, [(t * MAX_SUB) * MT_SLOT]);
      pass.setPipeline(this.pipes.oil_rho);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
      pass.setPipeline(this.pipes.oil_blur);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
      pass.setPipeline(this.pipes.oil_blur_y);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
    }
    pass.setPipeline(this.pipes.spread);
    for (let s = 0; s < this.nSub; s++) {
      pass.setBindGroup(0, this.bg, [(t * MAX_SUB + s) * MT_SLOT]);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 16), Math.ceil(H.hh / 4));
    }
    if (this.react) {
      // the tick's last substep's slot: its dst is the copy after this tick's spreading
      pass.setPipeline(this.pipes.react);
      pass.setBindGroup(0, this.bg, [(t * MAX_SUB + this.nSub - 1) * MT_SLOT]);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
    }
    // step C6b: the screened charge field, a few red-black sweeps on the copy the reactions left (src/charge.js)
    if (this.solve) {
      pass.setBindGroup(0, this.bg, [(t * MAX_SUB + this.nSub - 1) * MT_SLOT]);
      const n = Math.max(1, Math.min(16, Math.round(this.charge.params.sweeps)));
      for (let k = 0; k < n; k++) {
        pass.setPipeline(this.pipes.relax_red); pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
        pass.setPipeline(this.pipes.relax_black); pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
      }
      this.charge.phiLive = true;
    }
  }

  /** After the frame's ticks (before the heat's endFrame, which counts the dish): the current copy, the drawing's textures. */
  endTicks(encoder) {
    const H = this.heat;
    if (!this.ticks) return;
    if (this.active) this.cur ^= (this.ticks * this.nSub) & 1;
    // step C6b: with no matter anywhere there is nothing to solve: phi is cleared once (else it would stay as it was)
    if (!this.active && this.charge && this.charge.phiLive) {
      encoder.clearBuffer(H.buffer, H.chargeOffset * 4, H.n * 4);
      this.charge.phiLive = false;
    }
    this.writeLedgerSlot();
    if (this.tex && this.showName !== 'off') {
      const pass = encoder.beginComputePass({ label: 'matter paint' });
      pass.setPipeline(this.pipes.paint);
      pass.setBindGroup(0, this.bg, [MT_LEDGER * MT_SLOT]);
      pass.setBindGroup(1, this.texBG);
      pass.dispatchWorkgroups(Math.ceil(H.hw / 8), Math.ceil(H.hh / 8));
      pass.end();
    }
  }

  /** The ledger / paint slot: the current copy (after a frame's ticks; src/snapshot.js also before a ledger pass of its own). */
  writeLedgerSlot() {
    const T = new Uint32Array(this.tickAB), L = MT_LEDGER * MT_SLOT / 4;
    T[L] = this.copyBase(this.cur); T[L + 1] = 0; T[L + 2] = 1; T[L + 3] = this.seed0 >>> 0; T[L + 4] = this.heat.n; T[L + 5] = LG_M.DISH;
    this.device.queue.writeBuffer(this.tickBuf, MT_LEDGER * MT_SLOT, this.tickAB, MT_LEDGER * MT_SLOT, MT_SLOT);
  }

  /**
   * Step C4: the reactions switched on, into the chemistry uniform (struct ChemP in matter.wgsl), with their rate
   * constants from the knobs; returns the list. The table itself (energies, sparks, bands, what makes what) is REACTIONS.
   */
  writeChem(dt) {
    const p = this.chem, H = this.heat;
    const O = this.oil, OP = O.params;   // step C12: the oil's reactions (src/oil.js switches and knobs)
    const famOn = { make: p.make, burn: p.burn, photo: p.burn, swap: p.swap, upswap: p.swap, form: p.sediment, crack: p.sediment,
      oil: O.rule('on'), oilcrack: O.rule('on'), head: O.rule('amphi'), unhead: O.rule('amphi') };
    const famK = { make: p.kMake, burn: p.kBurn, photo: p.kPhoto, swap: p.kSwap, upswap: p.kUpSwap, form: p.kSed, crack: p.kCrack,
      oil: OP.kOil, oilcrack: OP.kCrack, head: OP.kHead, unhead: OP.kUnhead };
    const lightOn = !!(this.light && this.light.on);
    let list;
    if (ELECTRONS) {
      // step C12d: the switches and knobs by family (bond F, split B, trade and swaps P, chains K), and the excited states' shares
      // (src/electrons.js: the photochemistry, fluorescence and heat shares of what each substance absorbs)
      Object.assign(famOn, { photo: p.swap, glow: true, dark: true });
      Object.assign(famK, { make: p.kBond, photo: p.kTrade, glow: 1, dark: 1 });
      list = p.on ? REACTIONS.filter((r) => famOn[r.fam] && (r.by === 'heat' || lightOn) && famK[r.fam] > 0 && this.electrons.allows(r)).slice(0, MAX_RX) : [];
      this.electrons.shares(list, famK);
    } else {
      list = p.on ? REACTIONS.filter((r) => famOn[r.fam] && (r.by === 'heat' || lightOn) && famK[r.fam] > 0).slice(0, MAX_RX) : [];
    }
    this.rxOn = list;
    const u = new Uint32Array(this.chemAB), f = new Float32Array(this.chemAB), i32 = new Int32Array(this.chemAB);
    u[0] = list.length; u[1] = p.trace ? 1 : 0; u[2] = CH.trace; u[3] = lightOn ? 1 : 0;
    f[4] = Math.max(1e-6, p.theta); f[5] = H.tempScale; f[6] = dt; f[7] = Math.max(0, p.traceK);
    // sediment is dark: it catches warm light (as heat) while the chemistry is on, whatever the rules
    this.dark = p.on && lightOn && p.dark > 0;
    // (step C12d, electrons: whatever has a gap in the warm band is dark: warm light only ever makes heat)
    SUBSTANCES.forEach((s, c) => { if (c < 16) f[8 + c] = (ELECTRONS ? s.bands.includes(0) : s.kind === 'sediment') && this.dark ? p.dark : 0; });
    // step C7b: crystal seeding (src/catalysts.js): words 24..27 (struct ChemP cry)
    f[24] = 0; f[25] = 0; f[26] = 1; f[27] = 0;
    if (this.catalysts) this.catalysts.writeChem(f, 24);
    // step C12: membrane fusion (words 28..31, struct ChemP fuse)
    this.oil.writeFuse(f, 28, -SUBSTANCES[CH.lL].e16, Math.round(16 * SUBSTANCES[CH.lL].spark));
    // step C12c: the excited waste (words 32..35, struct ChemP ex)
    this.excited.write(f, 32);
    // step C12d: the electrons' words (36..39, struct ChemP el)
    f[36] = ELECTRONS ? 1 : 0; f[37] = 0; f[38] = 0; f[39] = 0;
    const exOn = this.excited.on && !ELECTRONS;
    list.forEach((r, k) => {
      const o = (CP_RX + k * RX_BYTES) / 4;
      const ex = exOn && !!r.exOuts;   // step C12c: the freed light atoms leave excited, keeping E* each of the heat
      const outs = ex ? r.outs.map((c, j) => r.exOuts[j] ?? c) : r.outs;
      u[o] = r.ins[0]; u[o + 1] = r.ins.length > 1 ? r.ins[1] : NONE; u[o + 2] = outs[0]; u[o + 3] = outs.length > 1 ? outs[1] : NONE;
      u[o + 4] = r.by === 'light' ? 1 : 0; u[o + 5] = r.band ?? 0; u[o + 6] = FAM_GPU.indexOf(r.fam === 'upswap' ? 'swap' : r.fam);
      // (step C12d: open's bit 1 = an excited state's event, bit 2 = photochemistry, bits 8..15 the band it emits + 1)
      u[o + 7] = (r.open ? 1 : 0) | (ELECTRONS && r.by === 'light' ? 2 : 0) | (r.photo ? 4 : 0) | (r.emit != null ? (r.emit + 1) << 8 : 0);
      i32[o + 8] = ex ? r.exHeat16 : r.heat16; i32[o + 9] = r.light16; f[o + 10] = Math.max(0, r.kEff ?? famK[r.fam]); f[o + 11] = r.spark;
    });
    this.device.queue.writeBuffer(this.chemBuf, 0, this.chemAB);
    return list;
  }

  /** Write the springs uniform for this frame (`list` in this order; `aged`: the age they reach this frame); returns how many. */
  writeSprings(dt, list, aged) {
    const p = this.params, F = this.springF, H = this.heat;
    const n = Math.min(MAX_SPRINGS, list.length);
    const rad = Math.min(7 * H.px, Math.max(0, p.radius) * H.R);
    F.fill(0);
    for (let k = 0; k < n; k++) {
      const s = list[k], K = SPRING_KINDS[s.kind], o = k * SPRING_FLOATS;
      F[o] = s.x; F[o + 1] = s.y; F[o + 2] = rad; F[o + 3] = Math.max(0, 1 - (s.age + aged) / this.lifeOf(s));
      F[o + 4 + 19] = discPixels(s.x / H.px, s.y / H.px, Math.max(rad / H.px, 0.75), H.hw, H.hh);   // amt[19]: its disc's pixels
      // (step C12: a mix's shares are of the atoms, so a molecule of n atoms drips 1 / n as many units)
      for (const [atom, share] of Object.entries(K.mix)) F[o + 4 + CH[atom]] = p.rate * share / SUBSTANCES[CH[atom]].atoms.length * dt * ATOM_SCALE;
      const ink = springInk(s.kind, pal().substances);
      F[o + 24] = ink[0] / 255; F[o + 25] = ink[1] / 255; F[o + 26] = ink[2] / 255; F[o + 27] = K.stroke;
    }
    this.device.queue.writeBuffer(this.springBuf, 0, F);
    this.nSprings = n;
    return n;
  }

  makeTextures() {
    const H = this.heat;
    if (this.tex) for (const t of this.tex) t.destroy();
    this.tex = [0, 1, 2, 3].map((k) => this.device.createTexture({
      label: `matter shown ${k}`, size: [H.hw, H.hh], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }));
    this.texBG = this.device.createBindGroup({
      label: 'matter paint', layout: this.texBgl,
      entries: [{ binding: 0, resource: this.tex[0].createView() }, { binding: 1, resource: this.tex[1].createView() },
        { binding: 2, resource: this.tex[2].createView() }, { binding: 3, resource: this.tex[3].createView() }],   // (C12c: excited)
    });
    this.drawBG = null;
  }

  /** Once per frame, with the heat's ledger (before its copy): the atoms in the dish and the ORDER sums. */
  encodeLedger(encoder) {
    if (!this.bg || this.bufVersion !== this.heat.version) return;
    encoder.clearBuffer(this.heat.buffer, LG_M.DISH * 4, (LG_M.ORDER + ORDER_SLOTS - LG_M.DISH) * 4);
    encoder.clearBuffer(this.heat.buffer, LG_Q_PHI * 4, (256 + 4) * 4);   // step C6b: phi's spread and largest size
    // step C12: the oil channels' DISH snapshot and the oil's census
    encoder.clearBuffer(this.heat.buffer, lgM('DISH', NCH_CELL) * 4, 3 * 128 * 4);
    encoder.clearBuffer(this.heat.buffer, lgM('DISH', EXC0) * 4, 2 * 128 * 4);   // step C12c: the excited atoms' DISH snapshot
    encoder.clearBuffer(this.heat.buffer, LG_OIL_SNAP * 4, 256 * 4);
    const pass = encoder.beginComputePass({ label: 'matter ledger' });
    pass.setPipeline(this.pipes.count);
    pass.setBindGroup(0, this.bg, [MT_LEDGER * MT_SLOT]);
    pass.dispatchWorkgroups(ORDER_SLOTS);
    pass.end();
    this.ledgerPixels = this.heat.n;
  }

  /** The heat's ledger read-back (Int32 words), in order: book the counters, take the snapshot. */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot;
    for (let c = 0; c < NCH; c++) {
      T.add[c] += wide(lgM('ADD', c)) / ATOM_SCALE;
      T.lost[c] += wide(lgM('LOST', c)) / ATOM_SCALE;
      T.gone[c] += wide(lgM('GONE', c)) / ATOM_SCALE;
      this.dish[c] = wide(lgM('DISH', c)) / ATOM_SCALE;
    }
    // atoms, weighting each substance by how many atoms it holds
    const atoms = (arr) => SUBSTANCES.reduce((x, s, c) => x + arr[c] * s.atoms.length, 0);
    const add = atoms(T.add), lost = atoms(T.lost), gone = atoms(T.gone), dish = atoms(this.dish);
    // step C5: the atoms inside the cells (src/eat.js reads them from the same read-back, just before)
    const EL = this.eat && this.eat.ledger && this.eat.ledger.time === rec.time ? this.eat.ledger : null;
    const cells = EL ? EL.atoms : 0;
    this.snapTime = rec.time;
    // ORDER: H = ln M - S / M over (pixel, substance), with M and S in counts of atoms
    const f = new Float32Array(w.buffer, LG_M.ORDER * 4, ORDER_SLOTS);
    let S = 0;
    for (let k = 0; k < ORDER_SLOTS; k++) S += f[k];
    const M = dish * ATOM_SCALE;
    let order = null, Hn = null;
    if (M > 0 && this.ledgerPixels) {
      const Hs = Math.log(M) - S / M;
      let Hmix = 0;
      SUBSTANCES.forEach((s, c) => { const q = this.dish[c] * s.atoms.length / dish; if (q > 0) Hmix -= q * Math.log(q); });
      const Hmax = Math.log(this.ledgerPixels) + Hmix;
      Hn = Hs / Hmax;
      order = Math.max(0, Math.min(1, 1 - Hn));
    }
    const Hh = this.hist;
    Hh.push([rec.time, add, lost]);
    while (Hh.length > 2 && rec.time - Hh[1][0] >= 1) Hh.shift();
    const dt = rec.time - Hh[0][0];
    const rate = (k) => (dt > 0.05 ? (Hh[Hh.length - 1][k] - Hh[0][k]) / dt : 0);
    if (order != null) {
      const O = this.orderHist;
      if (!O.length || rec.time - O[O.length - 1][0] >= 1) O.push([rec.time, order]);
      while (O.length > 600) O.shift();
    }
    // step C4: light caught by the substances, events per family, and the chemical energy: in the dish (each substance's
    // amount x its energy) and gone out with matter (lost at the edge, washed out, dropped on a resize). All exact.
    const CT = this.ctot;
    for (let b = 0; b < BANDS.length; b++) CT.light[b] += wide(LG_C.LIGHT + 128 * b) / HEAT_SCALE;
    for (let k = 0; k < FAMILIES.length; k++) CT.rx[k] += wide(lgRx(k)) / ATOM_SCALE;
    const byE = (arr) => SUBSTANCES.reduce((x, s, c) => x + arr[c] * s.energy, 0);
    // (step C12: springs of molecules bring chemical energy in with them: `added`, counted as energy in)
    const chem = { light: CT.light.reduce((a, b) => a + b, 0), dish: byE(this.dish), out: byE(T.lost) + byE(T.gone), added: byE(T.add) };
    chem.fuel = SUBSTANCES.reduce((x, s, c) => x + (s.kind === 'fuel' ? this.dish[c] : 0), 0);
    chem.sed = SUBSTANCES.reduce((x, s, c) => x + (s.kind === 'sediment' ? this.dish[c] : 0), 0);
    const CHs = this.chist;
    CHs.push([rec.time, ...CT.rx, ...CT.light]);
    while (CHs.length > 2 && rec.time - CHs[1][0] >= 1) CHs.shift();
    const cdt = rec.time - CHs[0][0];
    const crate = (k) => (cdt > 0.05 ? (CHs[CHs.length - 1][k] - CHs[0][k]) / cdt : 0);
    chem.rate = Object.fromEntries(FAMILIES.map((f, k) => [f, crate(1 + k)]));
    chem.lightRate = BANDS.map((b, k) => crate(1 + FAMILIES.length + k));
    // step C5: the cells' chemical energy (their stock) and their batteries are stored energy too; the starter charges
    // came in
    chem.cells = EL ? EL.chem : 0; chem.bat = EL ? EL.bat : 0; chem.start = this.eat ? this.eat.start : 0;
    this.ledger = { time: rec.time, add, lost, gone, dish, cells, rounding: add - (dish + cells + lost + gone), rateAdd: rate(1), rateLost: rate(2), order, entropy: Hn, chem };
    this.oil.apply(rec, w, (this.heat.px / this.heat.R) ** 2);   // step C12: the oil's census
    if (!ELECTRONS) this.excited.apply(rec, w);                   // step C12c: the excited haze's census (folded into C12d's)
    this.electrons.apply(rec, w);                                 // step C12d: the excited states, fluorescence
  }

  /**
   * Tuning aid (step C4; console or tools/shot.py --eval): read the grid back and print, along the row of pixels at CSS
   * y, every `step` CSS px from x0 to x1, the amounts per R^2 of the substances present and the temperature (heat per
   * R^2). Resolves to the rows as text, e.g. moire.matter.probeLine(400, 0, 640, 20).then(console.log).
   */
  async probeLine(y, x0 = 0, x1 = this.view.cssW, step = 20) {
    const H = this.heat, d = this.device, n = H.n;
    const bytes = (H.extraBlocks + 4) * n * 4;
    const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(H.buffer, LEDGER_WORDS * 4, buf, 0, bytes);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const w = new Int32Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const a = H.px / H.R, conc = 1 / (ATOM_SCALE * a * a);
    const heatBase = H.offset(H.cur) - LEDGER_WORDS, base = this.copyBase(this.cur);
    const py = Math.max(0, Math.min(H.hh - 1, Math.floor(y / H.px)));
    const rows = [];
    for (let x = x0; x <= x1; x += step) {
      const px = Math.max(0, Math.min(H.hw - 1, Math.floor(x / H.px))), i = py * H.hw + px;
      const parts = SUBSTANCES.map((s, c) => [s.name, w[base + c * n + i] * conc]).filter(([, v]) => v >= 0.005)
        .map(([nm, v]) => `${nm} ${v.toFixed(2)}`);
      rows.push(`x ${x} T ${(w[heatBase + i] * H.tempScale).toFixed(2)} | ${parts.join(' ')}`);
    }
    return rows.join('\n');
  }

  // ---------- drawing ----------
  compute() {}

  render(pass, frame = {}) {
    if (!this.tex || !this.view || this.showName === 'off') return;
    if (this.landscape && !this.landscape.params.on) return;
    const p = this.params, H = this.heat;
    if (!this.drawBG) {
      this.drawBG = this.device.createBindGroup({
        layout: this.drawPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.medium.buffer } },
          { binding: 1, resource: { buffer: this.drawU } },
          { binding: 2, resource: this.tex[0].createView() },
          { binding: 3, resource: this.tex[1].createView() },
          { binding: 4, resource: this.sampler },
          { binding: 5, resource: { buffer: this.springBuf } },
          { binding: 6, resource: this.tex[2].createView() },   // step C12: the oil's
          { binding: 7, resource: this.tex[3].createView() },   // step C12c: the excited atoms
        ],
      });
      // step H1: the harmonic pipeline's own (its automatic layout holds only what fs_harm reads: no free atoms' texture)
      this.harmBG = this.device.createBindGroup({
        layout: this.harmPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.medium.buffer } },
          { binding: 1, resource: { buffer: this.drawU } },
          { binding: 3, resource: this.tex[1].createView() },
          { binding: 4, resource: this.sampler },
          { binding: 5, resource: { buffer: this.springBuf } },
          { binding: 6, resource: this.tex[2].createView() },
          { binding: 7, resource: this.tex[3].createView() },
          { binding: 8, resource: { buffer: this.harmU } },
        ],
      });
    }
    const f = new Float32Array(this.drawAB), u = new Uint32Array(this.drawAB);
    f[0] = this.view.dpr; f[1] = Math.max(0.5, p.step); f[2] = Math.max(0, Math.min(1, p.maxDot)); f[3] = Math.max(1e-4, p.half);
    f[4] = H.px; f[5] = H.hw; f[6] = H.hh; f[7] = p.thresh;
    u[8] = this.nSprings || 0; f[9] = Math.max(1e-4, p.sedStep); f[10] = p.sedAlpha; f[11] = p.ringR * this.medium.R;
    const P = pal(), I = P.substances;
    f[12] = P.levels.substances * p.level / 0.85; f[13] = p.traceDot;
    f[14] = p.style === 'halftone' ? 0 : 1; f[15] = P === FLAT ? 0 : 1;
    const put = (o, rgb) => { f[o] = rgb[0] / 255; f[o + 1] = rgb[1] / 255; f[o + 2] = rgb[2] / 255; f[o + 3] = 1; };
    put(16, I.reactive.light); put(20, I.reactive.heavy); put(24, I.linker.light); put(28, I.linker.heavy);
    put(32, I.fuel.light); put(36, I.fuel.heavy); put(40, I.sediment.light); put(44, I.sediment.heavy);
    put(48, I.trace.light);
    f[52] = Math.max(1, p.dustCell); f[53] = p.dustR[0]; f[54] = p.dustR[1]; f[55] = p.dustAtoms;
    // step C12: the oil's look (src/oil.js)
    const OP = this.oil.params, IO = P.oil || FLAT.oil, IP = P.polarity || FLAT.polarity;
    f[56] = OP.on && OP.look ? 1 : 0; f[57] = Math.max(0.75, OP.lineW * this.view.dpr); f[58] = (performance.now() / 1000) % 3600; f[59] = OP.irid;
    f[60] = OP.filmAlpha; f[61] = OP.gloss; f[62] = OP.amphLine * P.levels.substances / 0.62; f[63] = OP.polarity ? OP.polAlpha : 0;
    put(64, IO.film); put(68, IO.edge); put(72, IO.amph); put(76, IP.polar); put(80, IP.apolar);
    this.excited.writeDraw(f, 84);   // step C12c: the excited haze's sparkle
    this.electrons.writeDraw(f, 92, P, H);   // step C12d: the minerals and the fluorescence glow
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    const HM = frame.look && frame.look.harmonic;   // step H1: the harmonic look
    if (HM) {
      HM.writeMatter(this.harmF, 0, Math.max(1e-4, p.sedStep), Math.max(1e-4, p.half));
      this.device.queue.writeBuffer(this.harmU, 0, this.harmF);
      pass.setPipeline(this.harmPipe);
      pass.setBindGroup(0, this.harmBG);
      pass.draw(3);
      return;
    }
    pass.setPipeline(this.drawPipe);
    pass.setBindGroup(0, this.drawBG);
    pass.draw(3);
  }

  /** Shift+S: the next view (summary, each substance alone, off); returns its description. */
  cycleShow() {
    const p = this.params;
    p.show = (p.show + 1) % SHOWS.length;
    return this.showText();
  }

  showText() {
    const name = this.showName;
    if (name === 'off') return 'substances not drawn';
    if (name === 'summary') return `substances: summary (free atoms red to grey dots, fuels green${ELECTRONS ? ', minerals slate and rust' : ''}, sediment flat, trace diamonds)`;
    const s = SUBSTANCES[CH[name]], amt = this.dish[CH[name]];
    return `${describe(s)} alone${amt > 0 ? '' : ' (none in the dish' + (s.kind === 'fuel' || s.kind === 'sediment' ? ': made by the chemistry of C4)' : ')')}`;
  }

  /** The entropy panel's line; compact: shorter, for a narrow screen (step C3b). */
  panelLine(compact = false) {
    const L = this.ledger;
    if (!L) return 'ORDER  …';
    const o = L.order == null ? '–' : L.order.toFixed(3);
    const inCells = L.cells > 0 ? ` · in cells ${fmt(L.cells)}` : '';
    if (compact) return `ORDER ${o} · atoms ${fmt(L.dish)}${L.cells > 0 ? ' + ' + fmt(L.cells) : ''} · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(1)}`;
    return `ORDER  ${o} · atoms in dish ${fmt(L.dish)}${inCells} · added ${fmt(L.add)} (+${fmt(L.rateAdd)}/s) · out ${fmt(L.lost + L.gone)} · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(1)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, L = this.ledger;
    const lines = [];
    const sp = this.springs.map((s) => `${s.kind} ${Math.max(0, this.lifeOf(s) - s.age).toFixed(0)} s left`).join(', ');
    lines.push(`matter (step C3): shown ${this.showName} (Shift+S) · springs ${this.springs.length}/${p.maxSprings}${sp ? ': ' + sp : ''}` +
      ` · drip ${p.rate} atoms/s for ${p.life} s over ${p.radius} R · edge sink ${p.edge}/s · ${this.nSub} substep(s)` +
      ` · channels moving ${SUBSTANCES.filter((s, c) => this.active & (1 << c)).map((s) => s.name).join(' ') || 'none'}`);
    lines.push('spreading (R²/s, from row and group): ' + SUBSTANCES.map((s) => `${s.name} ${(s.spread * p.spreadGain).toPrecision(2)}`).join(' · '));
    if (ELECTRONS) lines.push(...this.electrons.tableLines());
    else lines.push('energy table (step C4, from row and group; free atoms 0): ' + SUBSTANCES.filter((s) => s.atoms.length > 1).map((s) =>
      `${s.name} ${s.energy} (spark ${s.spark}${s.kind === 'fuel' ? ', made by ' + (BANDS[makingBand(s)] || { name: 'nothing' }).name : ''})`).join(' · ') +
      ` · swaps: ${REACTIONS.filter((r) => r.fam === 'swap').map((r) => r.name).join(', ')}`);
    const C = this.chem, on = (x) => (x ? 'on' : 'off');
    lines.push(`chemistry (step C4) Shift+M ${on(C.on)}: F make fuel by light ${on(C.make)} · B break fuel (heat, hard light) ${on(C.burn)}` +
      ` · P swaps ${on(C.swap)} · K sediment ${on(C.sediment)} · T trace lowers the spark ${on(C.trace)} · ${this.rxOn.length} reactions running` +
      ` · theta ${+C.theta.toFixed(4)} · k make ${C.kMake}, burn ${C.kBurn}/s, photo ${C.kPhoto}, swap ${C.kSwap} (uphill by light ${C.kUpSwap}), sediment ${C.kSed}, crack ${C.kCrack}, dark ${C.dark}, trace ${C.traceK}`);
    if (L && L.chem) {
      const K = L.chem, R = K.rate;
      if (ELECTRONS) lines.push(`chemistry per s (electrons): bonds formed ${fmt(R.make)} · split by light ${fmt(R.burn)} · trades ${fmt(R.photo)}` +
        ` · swaps ${fmt(R.swap)} · chains formed ${fmt(R.form)}, cracked ${fmt(R.crack)} (substance units)` +
        ` · light caught per band (net of fluorescence) ${K.lightRate.map((x, b) => `${BANDS[b].name} ${fmt(x)}`).join(', ')}` +
        ` · stored ${fmt(K.dish)} (from all atoms free = 0) · out with matter ${fmt(K.out)}`);
      else lines.push(`chemistry per s: fuel made ${fmt(R.make)} · burned ${fmt(R.burn + R.photo)} (by heat ${fmt(R.burn)}, by hard light ${fmt(R.photo)})` +
        ` · swaps ${fmt(R.swap)} · sediment formed ${fmt(R.form)}, cracked ${fmt(R.crack)} (substance units)` +
        ` · light caught per band ${K.lightRate.map((x, b) => `${BANDS[b].name} ${fmt(x)}`).join(', ')}` +
        ` · stored ${fmt(K.dish)} (fuel ${fmt(K.fuel)}, sediment ${fmt(K.sed)} units) · out with matter ${fmt(K.out)}`);
    }
    if (L) {
      const el = {};
      for (const a of Object.keys(ATOMS)) el[a] = { add: 0, dish: 0, out: 0 };
      SUBSTANCES.forEach((s, c) => {
        for (const a of s.atoms) { el[a].add += this.tot.add[c]; el[a].dish += this.dish[c]; el[a].out += this.tot.lost[c] + this.tot.gone[c]; }
      });
      lines.push(`atoms ledger: added ${fmt(L.add)} = in dish ${fmt(L.dish)} + in cells ${fmt(L.cells)} + lost at the edge ${fmt(L.lost)} + washed / resized / gone ${fmt(L.gone)}` +
        ` · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(2)} · per s +${fmt(L.rateAdd)} −${fmt(L.rateLost)}`);
      lines.push('per element (added / in dish / out): ' + Object.entries(el).filter(([, v]) => v.add > 0)
        .map(([a, v]) => `${a} ${fmt(v.add)} / ${fmt(v.dish)} / ${fmt(v.out)}`).join(' · '));
      lines.push(`order ${L.order == null ? '–' : L.order.toFixed(3)} (entropy ${L.entropy == null ? '–' : L.entropy.toFixed(3)} of the evenly smeared dish)` +
        ` · substances in dish: ` + SUBSTANCES.map((s, c) => (this.dish[c] > 0 ? `${s.name} ${fmt(this.dish[c])}` : null)).filter(Boolean).join(' · '));
    }
    return lines;
  }
}

/** How many pixels' centres lie within r of (cx, cy) (pixel units), inside a w x h grid: the pixels a spring drips on. */
function discPixels(cx, cy, r, w, h) {
  let n = 0;
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) n++;
    }
  }
  return Math.max(1, n);
}

/** A spring's marker ink: its atoms' inks (from `inks`, a palette's substances), weighted by its mix. */
export function springInk(kind, inks = INKS) {
  const mix = SPRING_KINDS[kind].mix, ink = [0, 0, 0];
  let tot = 0;
  for (const [a, share] of Object.entries(mix)) {
    if (a === 'trace') continue;
    const s = SUBSTANCES[CH[a]];
    const si = inkOf(s.func, s.heavy, inks);
    for (let j = 0; j < 3; j++) ink[j] += si[j] * share;
    tot += share;
  }
  return ink.map((v) => v / tot);
}
