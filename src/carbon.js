// Step C15a: CARBON IN THE OPEN DISH (README "Step C15a: carbon in the open dish"; design: design/C15_carbon_proposal.md).
// The user (2026-11-17): "our chemistry should have a carbon like element"; chose the REBUILD in stages, dead carbon as MUD, a little
// FUEL SEEP at vents (springs mostly CO2-like carbon), oxygen damaging membranes later, and slow carbon chemistry in the cool open dish.
// This first stage is a SIDECAR: carbon lives and reacts in the open dish only; the cells are blind to it (C15b feeds them), and
// nothing of the C12d table retires yet.
//
// THE ATOM, derived in the electrons' style (src/matter.js ELEC, eBond, gapBand), the old table untouched:
//   c        the BUILDER: a fourth group, four hands, core pull Zc = 2 (its levels -2, -1: grip -2, between the giver's -1.25 and the
//            light linker's -2.5), row 1 only. Never free: its four hands always hold g, t or another c.
//   bonds    a giver or taker on a hand: the electron FALLS as for any bond (released = the donor's level - the acceptor's + the same
//            row's match); two SHARERS (linkers, builders) share: released = (share a + share b) / 2 x (row a + row b), the share per
//            row 1/4 for a linker (so l-l 0.5, L-L 1, l-L 0.75 exactly as before: checked) and 1/2 for a builder:
//              c-g 1 (gap 1.625: visible 1) · c-t 3.75 (gap 4.75: hard) · c-c 1 (gap 1: warm, dark)
//   spark    1/8 x (row + row), x 2 on a bond to a four-handed atom (crowding): every carbon spark is 0.5, so carbon chemistry in the
//            cool open dish is about e^-8 (3000 x) slower than water forming (gt), and runs where it is hot (vents) or lit
//   polarity a bond is POLAR when its electron falls by >= 1 (grip difference): c-g water-shy, c-t polar, c-c water-shy (used later)
//   charge   booked by group, as before (g +1, t -1): a ladder molecule carries 2k - 4; only free atoms act as charges
//
// THE MOLECULES (grid channels; amounts in whole counts, ATOM_SCALE per unit, as every substance):
//   the LADDER, 5 mobile one-carbon molecules S_k = c g_k t_(4-k), k = 4 .. 0 (k g-hands, 4 - k t-hands):
//     cg4 (methane-like, -4) · cg3t (methanol-like, -6.75) · cg2t2 (sugar-unit-like, -9.5) · cgt3 (formic-like, -12.25) ·
//     ct4 (CO2-like, -15). They spread at row 1 x 0.7^4 (five atoms): 0.29 R^2/s. Each step down the ladder is one OXIDIZE (2.75)
//   TAR, 3 immobile HAND COUNTS per pixel: cc (backbone bonds), cg (fuel hands), ct (burnt hands); energy -(cc + cg + 3.75 ct);
//     carbons = (2 cc + cg + ct) / 4. No molecule identity: dead, amorphous carbon (mud, coal, crust)
//   CARBON IS CONSERVED EXACTLY: every reaction keeps 4 x (ladder molecules) + 2 cc + cg + ct, and the g and t atoms it moves between
//   the hands and the free atoms (the main grid's g, t, gt) are booked with them (the books per element below)
//
// THE REACTIONS (matter.wgsl + carbon.wgsl carbon_react, once per tick per pixel, after the main table's), each both ways:
//   OXIDIZE    t + [c-g] -> [c-t] + g, by heat (spark 0.5): releases 2.75 (any carrier: S4..S1 step down, tar cg -> ct)
//   REDUCE     g + [c-t] -> [c-g] + t, by HARD light caught by the c-t hand (5 >= 2.75 + half the spark): the rest heat (2.25);
//              ?photolysis=0 blocks it (it frees a t)
//   CONDENSE   [c-g] + [c-t] -> [c-c] + gt, by heat: releases 0.75; the two carbons go into tar (two ladder molecules, a molecule and
//              tar, or tar with itself: cross-linking)
//   HYDROLYZE  gt + [c-c] -> [c-g] + [c-t], by HARD light caught by the water (gt): the photon pays 0.75, the rest is heat
//   DISSOLVE   a loose tar carbon (no c-c hand: c (1 - p)^4 of them, p the backbone's share of the hands) leaves as a ladder molecule
//   SETTLE     a ladder molecule sticks to tar (rate x the tar there); both zero energy, no spark
//   light      the hands absorb where their gap matches (C12d): c-g visible 1 (no reaction open: it fluoresces warm light or warms),
//              c-t hard (REDUCE where g is, else fluoresces VISIBLE 2, sky blue, or warms), c-c warm (dark: heat). The carbon takes the
//              light the main table's absorbers left (sequential: never more than arrived)
// Sources: springs drip carbon too (shares below: molecules per atom of the spring's rate, so per area for D1's fissures and seeps):
// the mineral spring CO2-like carbon, the vent (fissure) a little methane-like FUEL SEEP with CO2-like carbon. Booked as added (energy
// in: their chemical energy, as every spring's molecules).

import { fmt, HEAT_SCALE, LEDGER_WORDS } from './heat.js';
import { BANDS } from './light.js';
import * as MX from './matter.js';   // (a cycle: matter.js imports this module; nothing here reads MX at load time)

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
/** Step C15a: carbon on (default) or off (?carbon=0: today's chemistry exactly; ?electrons=0 implies it). Fixed for the page. */
export const CARBON = !(QS && QS.get('electrons') === '0') && !(QS && QS.get('carbon') === '0');
/**
 * Step C15c, CARBON MAKES THE CELL (option R, the rebuild's third stage): the cells build their membranes (bilayer, oil, wall), pigments
 * and glue from carbon, and the linkers l, L retire (no spring drips them; their engines idle). Fixed for the page (the membrane's stock
 * words change meaning): ?cblip=0 gives step C15b (carbon beside the linkers); old snapshots reload with their own setting.
 */
export const CB_LIP = CARBON && !(QS && QS.get('cblip') === '0');
/**
 * Step C15e (fix h), AN ENZYME'S SCAFFOLD FROM ANY CARBON: an enzyme's job (catalysis: moving electrons) is its heavy giver G; its carbon is
 * only the frame that holds it, so the frame need not hold fuel (real proteins are not fuel either). With it an enzyme unit is 4 BURNT
 * chain carbons (per carbon one backbone bond and two burnt hands: hands (4, 0, 8)) + 1 G, cut from the granules' burnt carbons as they are
 * or condensed from formic-like molecules, instead of C15c's 4 cellulose-like ones (4, 4, 4), which took a fuel hand each from the
 * membranes and pigments. Fixed for the page (the enzymes' words mean other hands): ?cbenzany=0 gives C15d; snapshots carry it.
 */
export const CB_ENZANY = CB_LIP && !(QS && QS.get('cbenzany') === '0');
/** An enzyme unit's tar hands (backbone bonds, fuel hands, burnt hands). */
export const ENZ_H = CB_ENZANY ? [4, 0, 8] : [4, 4, 4];
/** Step C15c: sugar-unit-like carbon at the mineral spring, molecules per atom of its rate (?cbsugar=; 0: CO2-like only, as C15b). */
/**
 * Step C15d (fix d), IRON AT THE MINERAL SPRING: while carbon makes the cell, every enzyme holds a heavy giver G (C15c), and only vents
 * dripped any, so dishes far from a vent ran out (the shallows: 35-62 % of the cells short of G). A mineral spring that weathers rock carries
 * a little dissolved metal: G_SPRING of its atoms are G, in the place of the retired linkers (per atom of its rate, so per area for D1's
 * patches, booked as every spring's). ?cbgspring= (0: none, as C15c).
 */
export const G_SPRING = (() => { const v = QS && QS.has('cbgspring') ? Number(QS.get('cbgspring')) : 0.01; return CB_LIP && Number.isFinite(v) ? Math.max(0, Math.min(0.4, v)) : 0; })();
const SUGAR = (() => { const v = QS && QS.has('cbsugar') ? Number(QS.get('cbsugar')) : 0.06; return Number.isFinite(v) ? Math.max(0, v) : 0.06; })();

export const ATOM_SCALE = 4096;
export const LADDER = ['cg4', 'cg3t', 'cg2t2', 'cgt3', 'ct4'];   // channel j: 4 - j g-hands, j t-hands
export const LADDER_LIKE = ['methane-like', 'methanol-like', 'sugar-unit-like', 'formic-like', 'CO2-like'];
export const TAR = ['cc', 'cg', 'ct'];
export const CNAMES = [...LADDER, 'tar'];   // what Shift+S can show alone (tar as one)
export const NCB = 8;                         // channels: 5 ladder + 3 tar hand counts
const gH = (j) => 4 - j, tH = (j) => j;

// the builder, in the electrons' terms
export const BUILDER = { row: 1, group: 'builder', pull: 2, share: 1 / 2, crowd: 2 };

/** The springs' carbon (molecules per atom of the spring's rate): mostly CO2-like; a little methane-like fuel seeps at vents. */
export const CARBON_MIX = {
  light: SUGAR > 0 ? { ct4: 0.08, cg2t2: SUGAR } : { ct4: 0.08 },   // the mineral spring: CO2-like carbon (step C15c: and a little
                                        // sugar-unit-like carbon, so a lit dish can build before it can fix)
  heavy: { cg4: 0.025, ct4: 0.025 },    // the vent (and D1's fissures): a fuel seep with CO2-like carbon
};

// ledger words (heat_common.wgsl LG_CB...): per channel ADD, LOST, GONE, DISH (64-bit, 64 slots, 128 words each), events per type,
// light caught per band, the light given off as fluorescence
export const LG_CB = 32256;
// step C15b (heat_common.wgsl LG_CBC_*): the carbon in the cells (snapshot), taken in, given back (per channel, 64-bit), events, census
export const LG_CBC = { STOCK: 38400, IN: 39424, OUT: 40448, EV: 41472, CEN: 43520, CEN2: 43776, EV2: 44032, EV3: 45056, EV4: 46080 };   // (step C15c: CEN2, EV2; step C15d: EV3; step C15g: EV4)
const LGC = { ADD: LG_CB, LOST: LG_CB + 1024, GONE: LG_CB + 2048, DISH: LG_CB + 3072, RX: LG_CB + 4096, LIGHT: LG_CB + 5120, GLOW: LG_CB + 5632,
  HEAT: LG_CB + 5760, GT: LG_CB + 5888 };
export const RX_TYPES = ['oxidize', 'condense', 'reduce', 'hydrolyze', 'dissolve', 'settle', 'glow', 'warm'];

let TABLE = null;
/** Step C15a: the builder's table, derived and checked (once; after src/matter.js has loaded). */
export function carbonTable() {
  if (TABLE) return TABLE;
  const { ELEC, ATOMS, eBond, gapBand, SUBSTANCES, CH, SPREAD } = MX;
  const pullOf = (a) => (a.group === 'builder' ? BUILDER.pull : ELEC.pull[a.group]);
  const valence = (a) => -pullOf(a) / 2 ** (a.row - 1);
  const atomGap = (a) => pullOf(a) / 2 ** a.row;
  const SHARE = { linker: ELEC.share, builder: BUILDER.share };
  const crowd = (a) => (a.group === 'builder' ? BUILDER.crowd : 1);
  // the general bond rule (sharers share; otherwise the electron falls), checked against the electrons' own for every old pair
  function bond(a, b) {
    if (a.group === b.group && (a.group === 'giver' || a.group === 'taker')) return null;
    if (SHARE[a.group] != null && SHARE[b.group] != null) { const rel = (SHARE[a.group] + SHARE[b.group]) / 2 * (a.row + b.row); return { rel, gap: rel, donor: null, polar: false }; }
    const [d, c] = valence(a) >= valence(b) ? [a, b] : [b, a];
    const fall = valence(d) - valence(c);
    const rel = fall + (a.row === b.row ? ELEC.match : 0);
    return { rel, gap: rel + atomGap(d), donor: d, polar: fall >= 1 };
  }
  const old = Object.values(ATOMS).filter((a) => a.group !== 'inert' && !a.ground);
  for (const a of old) {
    for (const b of old) {
      const x = eBond(a, b), y = bond(a, b);
      if (!!x !== !!y || (x && (x.rel !== y.rel || x.gap !== y.gap))) throw new Error('carbon: the general bond rule does not reproduce the electrons\' table');
    }
  }
  const C = BUILDER, g = ATOMS.g, t = ATOMS.t;
  const spark = (a, b) => 0.125 * (a.row + b.row) * Math.max(crowd(a), crowd(b));
  const B = { cg: bond(C, g), ct: bond(C, t), cc: bond(C, C) };
  for (const k of Object.keys(B)) { B[k].spark = spark(C, k === 'cg' ? g : k === 'ct' ? t : C); B[k].band = gapBand(B[k].gap); }
  const e16 = (x) => { const v = Math.round(16 * x); if (v !== 16 * x) throw new Error(`carbon: ${x} is not a multiple of 1/16`); return v; };
  const E = { cg: e16(-B.cg.rel), ct: e16(-B.ct.rel), cc: e16(-B.cc.rel) };   // heat counts per count of each hand (or bond)
  const sp = B.cg.spark;
  if (B.ct.spark !== sp || B.cc.spark !== sp) throw new Error('carbon: the shaders take one spark for all carbon bonds');
  const ladder = LADDER.map((name, j) => {
    const energy = -(gH(j) * B.cg.rel + tH(j) * B.ct.rel);
    const bands = [...new Set([...(gH(j) ? [B.cg.band] : []), ...(tH(j) ? [B.ct.band] : [])].filter((b) => b >= 0))].sort();
    return { name, like: LADDER_LIKE[j], j, g: gH(j), t: tH(j), energy, e16: e16(energy), charge: gH(j) - tH(j),
      chi: (gH(j) - tH(j)) / 4, bands, spread: SPREAD.row1 * SPREAD.bond ** 4, atoms: 5 };
  });
  const L16 = (b) => Math.round(16 * BANDS[b].photon);
  const ox16 = E.cg - E.ct;                        // released by OXIDIZE (heat counts per event): 44
  const gt = SUBSTANCES[CH.gt];
  const cond16 = E.cg + E.ct - E.cc - gt.e16;      // released by CONDENSE: 12
  if (!(ox16 > 0 && cond16 > 0)) throw new Error('carbon: oxidize and condense must run downhill');
  // light: the lowest visible or hard band an uphill step can use (its absorber's band; the photon covers the rise + half the spark)
  const upBand = (bands, rise16) => bands.filter((b) => b >= 1 && L16(b) >= rise16 + 8 * sp).sort((a, b) => a - b)[0] ?? -1;
  const redBand = upBand([B.ct.band], ox16);       // REDUCE: absorber the c-t hand
  const hydBand = upBand(gt.bands, cond16);        // HYDROLYZE: absorber the water
  if (redBand !== 3 || hydBand !== 3) throw new Error('carbon: the shaders expect REDUCE and HYDROLYZE by hard light');
  // a hand's glow: it emits the next lower band (C12d's Stokes shift)
  const emitOf = (b) => (b >= 1 ? b - 1 : -1);
  if (B.cg.band !== 1 || B.ct.band !== 3 || B.cc.band !== 0) throw new Error('carbon: the shaders expect c-g visible 1, c-t hard, c-c warm');
  // the reactions as events (for the checks): d = changes of [S4 S3 S2 S1 S0, cc cg ct, g t gt], light in, heat out, light out
  const ev = [];
  const z = () => new Array(11).fill(0);
  for (let j = 0; j < 4; j++) { const d = z(); d[j] = -1; d[j + 1] = 1; d[9] = -1; d[8] = 1; ev.push({ type: 'oxidize', d, light: 0, heat: ox16, out: 0 }); }
  { const d = z(); d[6] = -1; d[7] = 1; d[9] = -1; d[8] = 1; ev.push({ type: 'oxidize tar', d, light: 0, heat: ox16, out: 0 }); }
  for (let j = 1; j < 5; j++) { const d = z(); d[j] = -1; d[j - 1] = 1; d[8] = -1; d[9] = 1; ev.push({ type: 'reduce', d, light: L16(3), heat: L16(3) - ox16, out: 0 }); }
  { const d = z(); d[7] = -1; d[6] = 1; d[8] = -1; d[9] = 1; ev.push({ type: 'reduce tar', d, light: L16(3), heat: L16(3) - ox16, out: 0 }); }
  for (let a = 0; a < 4; a++) {
    for (let b = 1; b < 5; b++) {
      const d = z(); d[a] -= 1; d[b] -= 1; d[5] = 1; d[6] = gH(a) - 1 + gH(b); d[7] = tH(a) + tH(b) - 1; d[10] = 1;
      ev.push({ type: 'condense', d, light: 0, heat: cond16, out: 0 });
    }
    const d = z(); d[a] = -1; d[5] = 1; d[6] = gH(a) - 1; d[7] = tH(a) - 1; d[10] = 1; ev.push({ type: 'condense on tar', d, light: 0, heat: cond16, out: 0 });
  }
  for (let b = 1; b < 5; b++) { const d = z(); d[b] = -1; d[5] = 1; d[6] = gH(b) - 1; d[7] = tH(b) - 1; d[10] = 1; ev.push({ type: 'tar condenses', d, light: 0, heat: cond16, out: 0 }); }
  { const d = z(); d[5] = 1; d[6] = -1; d[7] = -1; d[10] = 1; ev.push({ type: 'tar cross-links', d, light: 0, heat: cond16, out: 0 }); }
  { const d = z(); d[5] = -1; d[6] = 1; d[7] = 1; d[10] = -1; ev.push({ type: 'hydrolyze', d, light: L16(3), heat: L16(3) - cond16, out: 0 }); }
  for (let j = 0; j < 5; j++) {
    const d = z(); d[j] = 1; d[6] = -gH(j); d[7] = -tH(j); ev.push({ type: 'dissolve', d, light: 0, heat: 0, out: 0 });
    ev.push({ type: 'settle', d: d.map((x) => -x), light: 0, heat: 0, out: 0 });
  }
  ev.push({ type: 'c-t glows', d: z(), light: L16(3), heat: L16(3) - L16(emitOf(3)), out: L16(emitOf(3)) });
  ev.push({ type: 'c-g glows', d: z(), light: L16(1), heat: L16(1) - L16(emitOf(1)), out: L16(emitOf(1)) });
  const eOf = (d) => d.slice(0, 5).reduce((x, n, j) => x + n * ladder[j].e16, 0) + d[5] * E.cc + d[6] * E.cg + d[7] * E.ct + d[10] * gt.e16;
  for (const e of ev) {
    const d = e.d;
    const carbon = 4 * (d[0] + d[1] + d[2] + d[3] + d[4]) + 2 * d[5] + d[6] + d[7];
    const gA = d.slice(0, 5).reduce((x, n, j) => x + n * gH(j), 0) + d[6] + d[8] + d[10];
    const tA = d.slice(0, 5).reduce((x, n, j) => x + n * tH(j), 0) + d[7] + d[9] + d[10];
    const q = d.slice(0, 5).reduce((x, n, j) => x + n * ladder[j].charge, 0) + d[6] - d[7] + d[8] - d[9];
    if (carbon || gA || tA || q) throw new Error(`carbon: ${e.type} does not conserve carbon, g, t or charge`);
    if (e.light !== e.heat + eOf(d) + e.out || e.heat < 0) throw new Error(`carbon: ${e.type} does not balance its energy`);
  }
  // no free energy round a closed cycle (C12d's rule: sparks paid uphill and lost, a quarter of a downhill release lost)
  const ineff = 0.25;
  for (const [rel, spk] of [[ox16, 16 * sp], [cond16, 16 * sp]]) {
    if ((1 - ineff) * rel - (rel + spk) >= 0) throw new Error('carbon: a free-energy loop');
  }
  TABLE = { bonds: B, E, spark: sp, ladder, ox16, cond16, redBand, hydBand, gtCh: CH.gt, L16, emit: { cg: emitOf(1), ct: emitOf(3) },
    levels: [-C.pull, -C.pull / 2], grip: valence(C), atomGap: atomGap(C), events: ev.length };
  return TABLE;
}

/**
 * Step C15b: the four CARBON ENGINES a genome can carry (option S: appended behind the C12d table's 22, ENG_MAIN.., so old genomes keep
 * their meaning). Each names a reaction TYPE of the carbon table, not a molecule: inside the cell it works on whatever carbon the cell
 * holds (the ladder in its stock and its tar GRANULES), weighted by the hands there. Kinds as the main table's: 0 uphill (a pigment's
 * photon or the battery pays the rise, the spark always from the battery), 2 breathe (a free t takes an electron), 3 form (chains).
 *   OXIDIZE   t + [c-g] -> [c-t] + g   releases 2.75 (breathing on carbon; a g + t engine then bonds the freed g: 4.5 more)
 *   CONDENSE  [c-g] + [c-t] -> [c-c] + gt   releases 0.75 (two carbons join: storage granules; fermenting carbon)
 *   REDUCE    g + [c-t] -> [c-g] + t   uphill 2.75 (fixing carbon: a visible 2 photon pays it; with the water split that frees the g,
 *             two photons per hand, as the proposal's Z-scheme)
 *   HYDROLYZE gt + [c-c] -> [c-g] + [c-t]   uphill 0.75 (digesting storage: breaks a granule's backbone, usually battery-paid)
 */
export function carbonEngines() {
  const T = carbonTable();
  const E = (name, short, kind, g16, cb) => ({ name, short, kind, fam: 'carbon', g16, spark: T.spark, band: 0, carbon: true, cb, ins: [], outs: [] });
  return [
    E('t + [c-g] → [c-t] + g', 'oxidize carbon (breathing on carbon)', 2, T.ox16, 0),
    E('[c-g] + [c-t] → [c-c] + gt', 'condense carbon (storage granules)', 3, T.cond16, 1),
    E('g + [c-t] → [c-g] + t', 'reduce carbon (fixing carbon)', 0, T.ox16, 2),
    E('gt + [c-c] → [c-g] + [c-t]', 'hydrolyze carbon (digesting granules)', 0, T.cond16, 3),
  ];
}

/** Step C15a: what a carbon channel (or 'tar') is, in words. */
export function describeCarbon(name) {
  const T = carbonTable();
  const j = LADDER.indexOf(name);
  if (j >= 0) {
    const s = T.ladder[j];
    return `${s.like} ${name} (one carbon with ${s.g} giver${s.g === 1 ? '' : 's'} and ${s.t} taker${s.t === 1 ? '' : 's'} on its four hands: ` +
      `${j === 0 ? 'the richest carbon fuel' : j === 4 ? 'fully burnt, the bottom of the ladder' : `${j} step${j === 1 ? '' : 's'} burnt`})`;
  }
  return 'tar (dead carbon: backbone bonds, fuel hands and burnt hands that do not move; mud, coal, crust)';
}

export class Carbon {
  constructor(matter) {
    this.matter = matter;
    this.on = CARBON;
    this.table = CARBON ? carbonTable() : null;
    this.blocks = CARBON ? 16 : 0;   // the ladder in two copies (ping-pong), the tar's three hand counts (one copy), step N2: 3 scratch blocks the
                                     // tar's bedload is worked out into (carbon.wgsl tar_move, tar_copy; 13 until then)
    // live-tunable: moire.carbon.params (rules switches in the rules panel, group "Carbon (step C15a)")
    this.params = {
      oxidize: true,       // t + [c-g] -> [c-t] + g by heat
      condense: true,      // [c-g] + [c-t] -> [c-c] + gt by heat (tar forms)
      light: true,         // REDUCE and HYDROLYZE by hard light (photochemistry; also needs the electrons' photochemistry on)
      dissolve: true,      // loose tar carbons dissolve, ladder molecules settle on tar
      springs: true,       // springs and vents drip carbon (CARBON_MIX)
      hydHeat: true,       // step C15d: HYDROLYZE BY HEAT, condensation's reverse by the water's warmth (detailed balance; ?cbhydheat=0: by
                           // hard light only, as C15a)
      kOx: 5,              // R^2 per s, before the spark's factor (as the main table's bonds)
      kCond: 5,            // R^2 per s, before the spark's factor
      kDis: 0.02,          // per s: loose tar carbons dissolving
      kSet: 0.05,          // R^2 per s: ladder molecules settling on tar (x the tar's carbons per R^2)
      kAbs: null,          // optical depth per hand per R^2 (null: the electrons' kAbs)
      surf: 1,             // step C15b: the tar's SURFACE size, carbons per R^2: thicker tar is a lump whose inside does not react (only
                           // (surf / tar)^(1/3) of its hands; 0: all of them, as C15a; ?cbsurf=)
    };
    this.look = {
      on: true,            // drawn
      dust: 0.9,           // the ladder's dust brightness (share of the fuel's)
      tarAlpha: 0.75,      // tar's opacity
      sheen: 0.55,         // tar's waxy green sheen where it holds fuel hands
      step: 0.3,           // tar per R^2 (carbons) where a patch starts (its lighter core from 4 x)
    };
    this.cur = 0;
    this.seen = -1e9;      // when carbon was last in the dish (or a spring dripping it)
    this.live = false;
    this.tot = { add: new Float64Array(NCB), lost: new Float64Array(NCB), gone: new Float64Array(NCB), rx: new Float64Array(8), light: new Float64Array(4), glow: 0,
      heat: 0, gt: 0,     // (the heat its reactions put down, the water they made: the carbon's own energy book)
      cin: new Float64Array(NCB), cout: new Float64Array(NCB) };   // (step C15b: taken into cells, given back by them)
    this.cellsHeld = new Float64Array(NCB);   // step C15b: the carbon in the cells (last read-back)
    this.dish = new Float64Array(NCB);
    this.hist = [];
    this.series = [];
    this.ledger = null;
    this.amtF = new Float32Array(16 * 8);   // per spring: S4..S1, S0, spare x 3 (counts per tick)
  }

  // ---------- the grid's blocks (inside the matter's: behind the oil's four) ----------
  base(n) { return this.matter.copyBase(2, n) + 4 * n; }
  copyBase(k, n = this.matter.heat.n) { return this.base(n) + k * 5 * n; }
  tarBase(n = this.matter.heat.n) { return this.base(n) + 10 * n; }

  /** The tick slot's carbon words (struct MatterTick csrc, cdst, ctar) for substep s of tick t, or for a ledger slot. */
  writeSlot(T, o, src, dst, n) { T[o + 8] = this.copyBase(src, n); T[o + 9] = this.copyBase(dst, n); T[o + 10] = this.tarBase(n); T[o + 11] = 0; }

  /** A spring's carbon for this frame (spring slot k; rate in atoms per s, dt per tick). */
  writeSpring(k, s, kind, rate, dt) {
    const F = this.amtF, o = 8 * k;
    F.fill(0, o, o + 8);
    if (!this.on || !this.params.springs) return;
    const K = MX.SPRING_KINDS[kind];
    const mix = (K && K.carbon) || CARBON_MIX[kind];
    if (!mix) return;
    for (const [name, share] of Object.entries(mix)) {
      const j = LADDER.indexOf(name);
      if (j >= 0) F[o + j] = rate * share * dt * ATOM_SCALE;   // (a pipette's drop: share of the atoms, 1/5 of them molecules: see SPRING_KINDS)
    }
  }
  /** Whether a spring of this kind drips carbon. */
  drips(kind) {
    if (!this.on || !this.params.springs) return false;
    const K = MX.SPRING_KINDS[kind];
    return !!((K && K.carbon) || CARBON_MIX[kind]);
  }

  /**
   * The frame's carbon uniform (struct CarbonP), after the springs were written; returns whether carbon runs this frame. `held`:
   * carbon is in the dish (last read-back) or a spring drips it.
   */
  writeParams(dev, buf, ab, frame, show) {
    const u = new Uint32Array(ab), f = new Float32Array(ab), i32 = new Int32Array(ab);
    u.fill(0);
    if (!this.on) { this.live = false; return false; }
    const M = this.matter, p = this.params, T = this.table, EP = M.electrons.params, H = M.heat;
    const dt = frame.tickDt, a = H.px / H.R;
    const dishC = this.dish.reduce((x, v) => x + v, 0) + this.cellsHeld.reduce((x, v) => x + v, 0);   // (step C15b: cells breathe it out)
    if (dishC > 0 || M.springs.some((s) => this.drips(s.kind))) this.seen = frame.time;
    this.live = frame.time - this.seen < 2;
    const chemOn = M.chem.on, lightOn = !!(M.light && M.light.on);
    const photo = chemOn && p.light && EP.photo;
    u[0] = (chemOn && p.oxidize ? 1 : 0) | (chemOn && p.condense ? 2 : 0) | (photo ? 4 : 0) | (chemOn && p.dissolve ? 8 : 0) | (lightOn && chemOn ? 16 : 0) |
      (chemOn && p.hydHeat ? 32 : 0);
    // what paint shows: all (the summary), one alone, nothing
    const j = CNAMES.indexOf(show);
    u[1] = show === 'off' ? 0 : show === 'summary' ? 1 : j >= 0 ? 2 : 0; u[2] = Math.max(0, j); u[3] = 0;
    f[4] = Math.max(0, T.ladder[0].spread * M.params.spreadGain) * dt / (a * a);   // (per tick: flush divides by the substeps)
    f[5] = T.spark; f[6] = Math.max(0, p.kOx); f[7] = Math.max(0, p.kCond);
    const kAbs = p.kAbs ?? EP.kAbs;
    f[8] = Math.max(0, p.kDis); f[9] = Math.max(0, p.kSet); f[10] = Math.max(0, kAbs); f[11] = lightOn && chemOn && M.chem.dark > 0 ? M.chem.dark : 0;
    const yR = Math.max(0, Math.min(1, EP.yRx)), yF = EP.fluor ? Math.max(0, Math.min(1, EP.yFl)) : 0;
    f[12] = photo && EP.photolysis ? yR : 0;   // REDUCE frees a t (?photolysis=0 blocks it)
    f[13] = yF;
    f[14] = photo ? yR : 0;                    // HYDROLYZE
    f[15] = Math.max(0, p.surf || 0);   // step C15b: the tar's surface size
    i32[16] = T.ox16; i32[17] = T.cond16; i32[18] = 0; i32[19] = 0;
    for (let b = 0; b < 4; b++) f[20 + b] = T.L16(b);
    u[24] = T.emit.cg + 1; u[25] = T.emit.ct + 1; u[26] = T.gtCh; u[27] = 0;
    f.set(this.amtF, 28);
    return this.live;
  }

  /** After the matter has chosen its substeps: the spreading per substep, and the uniform to the GPU. */
  flush(dev, buf, ab, nSub) {
    const f = new Float32Array(ab);
    if (this.on) f[4] = Math.min(0.2, f[4] / Math.max(1, nSub));
    dev.queue.writeBuffer(buf, 0, ab);
  }

  /** Book a ledger read-back (called by src/matter.js apply, before it builds its own books); returns what the books add. */
  apply(rec, w) {
    if (!this.on) return null;
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot, A = ATOM_SCALE;
    for (let c = 0; c < NCB; c++) {
      T.add[c] += wide(LGC.ADD + 128 * c) / A; T.lost[c] += wide(LGC.LOST + 128 * c) / A; T.gone[c] += wide(LGC.GONE + 128 * c) / A;
      this.dish[c] = wide(LGC.DISH + 128 * c) / A;
    }
    for (let k = 0; k < 8; k++) T.rx[k] += wide(LGC.RX + 128 * k) / A;
    for (let b = 0; b < 4; b++) T.light[b] += wide(LGC.LIGHT + 128 * b) / HEAT_SCALE;
    T.glow += wide(LGC.GLOW) / HEAT_SCALE;
    T.heat += wide(LGC.HEAT) / HEAT_SCALE; T.gt += wide(LGC.GT) / A;
    const Tb = this.table, Lad = Tb.ladder;
    // per element, in atom-units: carbon (c), giver (g) and taker (t) atoms held in carbon; the energy (heat counts / 16 = units)
    const els = (arr) => {
      let c = 0, g = 0, t = 0, e = 0, q = 0;
      for (let j = 0; j < 5; j++) { c += arr[j]; g += gH(j) * arr[j]; t += tH(j) * arr[j]; e += Lad[j].energy * arr[j]; q += Lad[j].charge * arr[j]; }
      c += (2 * arr[5] + arr[6] + arr[7]) / 4; g += arr[6]; t += arr[7];
      e += (Tb.E.cc * arr[5] + Tb.E.cg * arr[6] + Tb.E.ct * arr[7]) / 16; q += arr[6] - arr[7];
      return { c, g, t, atoms: c + g + t, e, q };
    };
    const out = new Float64Array(NCB);
    for (let c = 0; c < NCB; c++) out[c] = T.lost[c] + T.gone[c];
    // step C15b: the carbon the cells hold (their stocks' ladder and granules, a snapshot) and what they took from the dish and gave back
    // (exchange, grazing; exhaled, spilled at deaths and bursts) since the start, per channel
    const held = new Float64Array(NCB);
    for (let c = 0; c < NCB; c++) {
      held[c] = wide(LG_CBC.STOCK + 128 * c) / A;
      T.cin[c] += wide(LG_CBC.IN + 128 * c) / A; T.cout[c] += wide(LG_CBC.OUT + 128 * c) / A;
    }
    this.cellsHeld = held;
    const add = els(T.add), dish = els(this.dish), gone = els(out), lost = els(T.lost), washed = els(T.gone), cells = els(held);
    const toCells = els(T.cin), fromCells = els(T.cout);
    const H = this.hist;
    H.push([rec.time, ...T.rx, ...T.light, T.glow, add.c, lost.c]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = (k) => (dt > 0.05 ? (H[H.length - 1][k] - H[0][k]) / dt : 0);
    const rx = Object.fromEntries(RX_TYPES.map((n, k) => [n, rate(1 + k)]));
    const light = T.light.reduce((x, v) => x + v, 0);
    this.ledger = {
      time: rec.time, add, dish, out: gone, lost, washed, rx, light, lightRate: [0, 1, 2, 3].map((b) => rate(9 + b)), glowRate: rate(13),
      cIn: rate(14), cOut: rate(15),
      ladder: Array.from(this.dish.slice(0, 5)), tar: Array.from(this.dish.slice(5)),
      rounding: add.c - (dish.c + cells.c + gone.c),
      // the carbon's energy book in the DISH (exact): energy in with springs + light caught + what the cells gave back = held + out with
      // matter + heat put down + the water made + what the cells took (step C15b: the cells' side is in the dish's whole energy book)
      eRounding: (add.e + light + fromCells.e) - (dish.e + gone.e + T.heat + T.gt * MX.SUBSTANCES[MX.CH.gt].energy + toCells.e),
      cells, toCells, fromCells, cellsLadder: Array.from(held.slice(0, 5)), cellsTar: Array.from(held.slice(5)),
      heat: T.heat, water: T.gt,
    };
    const L = this.ledger;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, ...L.ladder, dish.c - L.ladder.reduce((x, v) => x + v, 0), rx.oxidize, rx.condense, rx.reduce]);
      if (S.length > 400) S.shift();
    }
    return L;
  }

  /**
   * Tuning aid (console or tools/shot.py --eval): along the row of pixels at CSS y, every `step` CSS px from x0 to x1, the ladder and
   * tar per R^2, the temperature and the free g, t and water there, e.g. moire.carbon.probeLine(400, 0, 1280, 40).then(console.log).
   */
  async probeLine(y, x0 = 0, x1 = this.matter.view.cssW, step = 20) {
    const M = this.matter, H = M.heat, d = M.device, n = H.n;
    const buf = d.createBuffer({ size: H.bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(H.buffer, 0, buf, 0, H.bytes);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const w = new Int32Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const a = H.px / H.R, conc = 1 / (ATOM_SCALE * a * a);
    const hb = H.offset(H.cur), lb = LEDGER_WORDS + this.copyBase(this.cur), tb = LEDGER_WORDS + this.tarBase(), mb = LEDGER_WORDS + M.copyBase(M.cur);
    const py = Math.max(0, Math.min(H.hh - 1, Math.floor(y / H.px)));
    const rows = [];
    for (let x = x0; x <= x1; x += step) {
      const px = Math.max(0, Math.min(H.hw - 1, Math.floor(x / H.px))), i = py * H.hw + px;
      const lad = LADDER.map((nm, j) => w[lb + j * n + i] * conc);
      const tar = [0, 1, 2].map((j) => w[tb + j * n + i] * conc);
      rows.push(`x ${x} T ${(w[hb + i] * H.tempScale).toFixed(2)} | ladder ${lad.map((v) => v.toFixed(2)).join(' ')}` +
        ` | tar ${((2 * tar[0] + tar[1] + tar[2]) / 4).toFixed(2)} (cc ${tar[0].toFixed(2)} cg ${tar[1].toFixed(2)} ct ${tar[2].toFixed(2)})` +
        ` | g ${(w[mb + i] * conc).toFixed(2)} t ${(w[mb + n + i] * conc).toFixed(2)} gt ${(w[mb + 6 * n + i] * conc).toFixed(2)}`);
    }
    return rows.join('\n');
  }

  /** For moire.sample(): the numbers of the last read-back. */
  get census() {
    const L = this.ledger;
    if (!L) return null;
    const tarC = L.dish.c - L.ladder.reduce((x, v) => x + v, 0);
    return {
      cg4: L.ladder[0], cg3t: L.ladder[1], cg2t2: L.ladder[2], cgt3: L.ladder[3], ct4: L.ladder[4],
      tarCC: L.tar[0], tarCG: L.tar[1], tarCT: L.tar[2], tarC, carbon: L.dish.c, energy: L.dish.e, cellsC: L.cells.c, cellsE: L.cells.e,
      toCells: L.toCells.c, fromCells: L.fromCells.c,
      added: L.add.c, out: L.out.c, rounding: L.rounding, eRounding: L.eRounding, heat: L.heat, water: L.water,
      oxidize: L.rx.oxidize, condense: L.rx.condense, reduce: L.rx.reduce, hydrolyze: L.rx.hydrolyze, dissolve: L.rx.dissolve, settle: L.rx.settle,
      glowOut: L.glowRate, light: L.lightRate.reduce((x, v) => x + v, 0), cIn: L.cIn, cOut: L.cOut,
    };
  }

  /** The entropy panel's CARBON line. */
  panelLine(compact = false) {
    if (!this.on) return 'CARBON  off (?carbon=0)';
    const L = this.ledger;
    if (!L) return 'CARBON  …';
    const r = L.rx, lad = L.ladder.map((v) => fmt(v)).join(' ');
    const tarC = L.dish.c - L.ladder.reduce((x, v) => x + v, 0);
    const rd = (L.rounding === 0 ? '0' : L.rounding.toExponential(1)) + (L.eRounding === 0 ? '' : ` (energy ${L.eRounding.toExponential(1)})`);
    if (compact) return `CARBON ladder ${lad} · tar ${fmt(tarC)} · burn ${fmt(r.oxidize)}/s fix ${fmt(r.reduce)}/s · rounding ${rd}`;
    return `CARBON  ladder (methane-like → CO2-like) ${lad} · tar ${fmt(tarC)} carbons (hands c-c ${fmt(L.tar[0])}, fuel ${fmt(L.tar[1])}, burnt ${fmt(L.tar[2])})` +
      `\n        per s: oxidize ${fmt(r.oxidize)} · condense ${fmt(r.condense)} · reduce (hard light) ${fmt(r.reduce)} · hydrolyze ${fmt(r.hydrolyze)}` +
      ` · dissolve ${fmt(r.dissolve)} · settle ${fmt(r.settle)} · glow out ${fmt(L.glowRate)} · carbon in ${fmt(L.cIn)}/s out ${fmt(L.cOut)}/s` +
      ` · in ${fmt(L.add.c)} = dish ${fmt(L.dish.c)} + cells ${fmt(L.cells.c)} + out ${fmt(L.out.c)} · rounding ${rd}`;
  }

  /** The F overlay's lines. */
  overlayLines() {
    if (!this.on) return ['carbon (step C15a): off (?carbon=0)'];
    const T = this.table, p = this.params, on = (x) => (x ? 'on' : 'off');
    const lines = [`carbon (step C15a): builder c pull ${BUILDER.pull} levels [${T.levels.join(' ')}] grip ${T.grip} · bonds c-g ${T.bonds.cg.rel} (gap ${T.bonds.cg.gap}), c-t ${T.bonds.ct.rel} (gap ${T.bonds.ct.gap}), c-c ${T.bonds.cc.rel} · spark ${T.spark}` +
      ` · ladder ${T.ladder.map((s) => `${s.name} ${s.energy}`).join(' · ')} · oxidize ${T.ox16 / 16}, condense ${T.cond16 / 16} · ${T.events} events checked`];
    lines.push(`carbon rules: oxidize ${on(p.oxidize)} · condense ${on(p.condense)} · light (reduce, hydrolyze) ${on(p.light)} · dissolve/settle ${on(p.dissolve)} · hydrolyze by heat ${on(p.hydHeat)} (step C15d) · springs ${on(p.springs)}` +
      ` · k ox ${p.kOx}, cond ${p.kCond}, dissolve ${p.kDis}/s, settle ${p.kSet} · running ${this.live ? 'yes' : 'no'}`);
    const L = this.ledger;
    if (L) {
      lines.push(`carbon books (atom-units): carbon in ${fmt(L.add.c)} = held ${fmt(L.dish.c)} + lost ${fmt(L.lost.c)} + gone ${fmt(L.washed.c)} · rounding ${L.rounding === 0 ? '0' : L.rounding.toExponential(2)}` +
        ` · energy: in ${fmt(L.add.e)} + light ${fmt(L.light)} = held ${fmt(L.dish.e)} + out ${fmt(L.out.e)} + heat ${fmt(L.heat)} + water ${fmt(L.water)} × ${MX.SUBSTANCES[MX.CH.gt].energy}, rounding ${L.eRounding === 0 ? '0' : L.eRounding.toExponential(2)}` +
        ` · energy held ${fmt(L.dish.e)} · light caught ${fmt(L.light)} (per s ${L.lightRate.map((x) => fmt(x)).join(' / ')})`);
      lines.push(`carbon every 10 s (ladder S4..S0 / tar carbons, oxidize / condense / reduce per s): ${this.series.slice(-5).map((s) =>
        `${s[0].toFixed(0)}s ${s.slice(1, 6).map((x) => fmt(x)).join(' ')}/${fmt(s[6])} ${fmt(s[7])}/${fmt(s[8])}/${fmt(s[9])}`).join(' · ')}`);
    }
    return lines;
  }
}
