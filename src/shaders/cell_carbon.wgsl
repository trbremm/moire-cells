// ===== cell_carbon.wgsl: step C15b, CELLS EAT CARBON (src/carboncells.js; README "Step C15b: cells eat carbon") =====
// Not compiled on its own: src/eat.js prepends it to cell_eat.wgsl (after cell_common.wgsl), so it shares the eat pass's bindings and
// helpers (S, cells, stock, hb, EP, mg, bio, add64, take_hb, spread9, footprint, sat_f, lnc, eng_index, eng_band, pcg, u01, ...; WGSL
// declarations are order-free), plus its own buffer of CW words per cell (binding 11; a plain view for the plan pass) and uniform (12).
// With carbon off (?carbon=0) CARBON_ON is 0 and none of it runs (the buffer is a stub).
//
// A cell's carbon words: 0..4 its ladder molecules (methane-like cg4 .. CO2-like ct4; channel j has 4 - j giver hands, j taker hands),
// 5..7 its tar GRANULES (backbone bonds c-c, fuel hands c-g, burnt hands c-t), 8..10 its BODY (the carbon it is built of, the same three
// hand counts: GROWTH NEEDS CARBON, below), 11 spare (a part's element store, later), 12..16 the plan's exchange per ladder channel this
// tick (+ in, - out), 17..19 the tar it asks to graze per hand, 20..23 spare (later parts' material). Whole counts (ATOM_SCALE per unit),
// as the dish: every move is exact. The books count the body with the granules (both are tar-like hands); the census apart.
//
// GROWTH NEEDS CARBON (the user, 2026-11-17: "make carbon fundamental for all cells mechanisms"; carbon is the cells' BUILDING
// MATERIAL, the battery stays the energy currency). A cell's body WANTS kBody carbons per R^2 of its area (W(r) = kBody pi r^2 / R^2);
// short of it, it BUILDS (kBuild of the shortfall per s) from the carbon in its stock: ladder molecules that still hold a giver hand
// (sugar-unit-like first, then formic-, methanol-, methane-like: CO2-like carbon cannot be built with, it must be fixed first) and its
// granules while their fuel hands are at least a quarter of their hands; each carbon built pays the carbon spark (0.5) from the battery
// (assembly, as heat; the hands only move, no bond changes). A cell may DIVIDE only with its body full for its size (the step reads
// Cell.sns1.w, the body's share of W; the two halves at 0.71 of the radius share it: half each), so carbon limits growth. A death, burst,
// meal's end or reset spills the body into the dish as TAR (exact); grazers and the dish's dissolving recycle it; a birth splits it; a
// predator digests it into its granules. Founders start with a full body (booked as carbon and energy in, a cellulose-like make-up: per
// carbon one backbone bond, one fuel hand, one burnt hand). A PART's cost is a RECIPE (cb_build: n carbons + k x an element's atoms from
// the stock, the spark per carbon from the battery): the body is carbon alone; C15c's membranes, walls, pigments, engines name theirs.

struct CbCellP {
  cfg: vec4u,   // x CBF_* bits; y the cells' tick at the matter's tick 0 of this frame; z the matter's substeps per tick; w the carbon copy
                // current at the frame's start (0, 1)
  off: vec4u,   // x copy 0's channel 0 (word in hb), y copy 1's; z the tar's (one copy); w a reset's current copy (0: no grid)
  k: vec4f,     // x the ladder's membrane rate over the light atoms'; y kGraze (per s per unit of the grazing engines' rate); z kDis (per s)
  e: vec4i,     // x OXIDIZE's release (heat counts; REDUCE's rise), y CONDENSE's (HYDROLYZE's rise), z the carbon spark (heat counts), w the
                // smell's weight per giver hand (what a free t releases from it, heat counts)
  g: vec4f,     // growth: x kBody (carbon units per R^2 of a cell's area), y kBuild (share of the shortfall per s), z the founders' body (share
                // of the want), w spare
  t: vec4f,     // step C15c: x the TRANSPORTER's membrane rate per level (over the light atoms'), y its upkeep per level (heat counts per s),
                // z enzymes: carbon per unit of expressed engine rate per R^2 of the cell, w their turnover (share per s)
  u: vec4f,     // step C15c: x the founders' enzymes (share of the want), y a hungry cell's grazing (units of a grazing engine), z a water's
                // bond (heat counts per count: split for a reduction's g), w its spark
  v: vec4f,     // step C15c: x the battery's floor for the builder's reductions (heat counts), y z w spare
};
@group(0) @binding(11) var<storage, read_write> cbS: array<atomic<i32>>;
@group(0) @binding(11) var<storage, read_write> cbSP: array<i32>;      // (the plan pass's plain view)
@group(0) @binding(12) var<uniform> CBP: CbCellP;

const CW: u32 = 24u;
const CB_BODY: u32 = 8u;    // the body's three hand counts (cc, cg, ct)
const CB_FLUX: u32 = 12u;
const CB_GRAZE: u32 = 17u;
const CBF_GROW: u32 = 256u;
const CBF_ON: u32 = 1u;
const CBF_EXCH: u32 = 2u;
const CBF_ENG: u32 = 4u;
const CBF_GRAZE: u32 = 8u;
const CBF_DIS: u32 = 16u;
const CBF_FLIP: u32 = 32u;
const CBF_RESET: u32 = 64u;
const CBF_SMELL: u32 = 128u;
// step C15c, CARBON MAKES THE CELL (src/carboncells.js; README "Step C15c: carbon makes the cell")
const CBF_LIP: u32 = 512u;     // membranes (bilayer, oil, wall), pigments and glue are carbon (fixed for the page: CB_LIP)
const CBF_TRANS: u32 = 1024u;  // the carbon TRANSPORTER gene (Bio.relay.x) speeds the ladder through the membrane, at an upkeep
const CBF_RED: u32 = 2048u;    // the lipid builder may REDUCE burnt hands from the battery (a storer's way: fat from sugar)
const CBF_ENZ: u32 = 4096u;    // engines need ENZYMES (carbon + the heavy giver G), built, worn and rebuilt (T1b's upkeep becomes their turnover)
const CBF_OXB: u32 = 8192u;
// step C15d, THE CARBON ECONOMY (src/carboncells.js; README "Step C15d: the carbon economy")
const CBF_SHUT: u32 = 16384u;  // the REDUCING SHUTTLE: the builder reduces a hand with the g an oxidation of another carbon frees (cb_make2)    // OXYGEN DAMAGES MEMBRANES: free t oxidises the lipids' fuel hands (fat -> soap -> spoiled, into the mud)
// the event counters (64-bit, LG_CBC_EV; src/carboncells.js EV)
const CBE_OX: u32 = 0u;
const CBE_COND: u32 = 1u;
const CBE_RED: u32 = 2u;
const CBE_HYD: u32 = 3u;
const CBE_DIS: u32 = 4u;
const CBE_GRAZE: u32 = 5u;
const CBE_GAIN: u32 = 6u;
const CBE_HEAT: u32 = 7u;
const CBE_PAID: u32 = 8u;
const CBE_PHU: u32 = 9u;
const CBE_PHI: u32 = 10u;
const CBE_SATW: u32 = 11u;
const CBE_SATL: u32 = 12u;
const CBE_RISE: u32 = 13u;
const CBE_BUILT: u32 = 14u;     // carbon built into bodies (counts of carbons)
const CBE_BPAID: u32 = 15u;     // ... the sparks paid for it (heat counts)
// the census (16 numbers x 16 slots, i32; src/carboncells.js CEN)
const CBZ_N: u32 = 0u;
const CBZ_OX: u32 = 1u;
const CBZ_COND: u32 = 2u;
const CBZ_RED: u32 = 3u;
const CBZ_REDLIT: u32 = 4u;
const CBZ_HYD: u32 = 5u;
const CBZ_GRAN: u32 = 6u;
const CBZ_GRANC: u32 = 7u;
const CBZ_LAD: u32 = 8u;
const CBZ_ANY: u32 = 9u;
const CBZ_OXONLY: u32 = 10u;
const CBZ_LITONLY: u32 = 11u;
const CBZ_BODY: u32 = 12u;     // sum of the bodies' carbon x 1000
const CBZ_SHORT: u32 = 13u;    // cells whose body is below its want (they cannot divide)
const CBZ_WANT: u32 = 14u;     // sum of the bodies' want x 1000
const CBL_GONE: u32 = 34304u;   // the dish's carbon ledger: GONE per channel (carbon.wgsl LG_CB_GONE)
const LG_CB_ADD_C: u32 = 32256u; // ... ADD per channel (carbon.wgsl LG_CB_ADD): the founders' bodies come in as tar hands
// step C15c: the cell's carbon words 11 (ENZYMES: units, each 4 carbons as (4, 4, 4) hands + 1 G atom; kept in snapshots) and 20 (this
// frame's LIEBIG bits: which element stopped a part being built; read and cleared by the ledger pass)
const CB_ENZ: u32 = 11u;
const CB_LIM: u32 = 20u;
const CBL_C: u32 = 1u;       // short of buildable carbon (the ladder with a fuel hand, the granules)
const CBL_G: u32 = 2u;       // short of the heavy giver G (enzymes)
const CBL_TR: u32 = 4u;      // short of trace (pigments)
const CBL_AT: u32 = 8u;      // short of free g or t (the builder's reducing or oxidising, a soap's head)
const CBL_BAT: u32 = 16u;    // short of battery (the assembly's sparks, a reduction's rise)
// the second census (LG_CBC_CEN2, 16 numbers x 16 slots; src/carboncells.js CEN2)
const CBY_MEMB: u32 = 0u;    // the bilayers' carbon x 1000 (soap1, soap2, oil)
const CBY_WALL: u32 = 1u;    // the walls' carbon x 1000
const CBY_PIG: u32 = 2u;     // the pigments' carbon x 1000
const CBY_GLUE: u32 = 3u;    // the glue's carbon x 1000
const CBY_ENZ: u32 = 4u;     // the enzymes' carbon x 1000
const CBY_LC: u32 = 5u;      // cells whose last build was stopped by carbon
const CBY_LG: u32 = 6u;      // ... by G
const CBY_LTR: u32 = 7u;     // ... by trace
const CBY_LAT: u32 = 8u;     // ... by free g or t
const CBY_LBAT: u32 = 9u;    // ... by the battery
const CBY_TRANS: u32 = 10u;  // the transporter level, summed x 1000
const CBY_EWANT: u32 = 11u;  // the enzymes wanted (carbon x 1000)
const CBY_ESHORT: u32 = 12u; // cells whose enzymes are below half their want (engines slowed)
const CBY_ANY: u32 = 13u;    // cells with any limit bit
// the second event block (LG_CBC_EV2, 64-bit; src/carboncells.js EV2)
const CBE2_LIP: u32 = 0u;    // bilayer molecules made (soap1, soap2, oil), counts
const CBE2_WALL: u32 = 1u;   // wall carbons made
const CBE2_RED: u32 = 2u;    // hands the builder reduced (battery-paid)
const CBE2_OX: u32 = 3u;     // hands the builder oxidised (a head on oil, an over-reduced pair)
const CBE2_BITE: u32 = 4u;   // oxygen bites on membranes (oxidations)
const CBE2_SPOIL: u32 = 5u;  // membrane molecules spoiled out into the mud
const CBE2_PIG: u32 = 6u;    // pigment counts built (2 carbons each)
const CBE2_ENZ: u32 = 7u;    // enzyme units built
var<workgroup> wcbe2: array<atomic<i32>, 8>;
// step C15d, THE CARBON ECONOMY's flow ledger (LG_CBC_EV3, 64-bit; src/carboncells.js EV3): what the batteries spend on the parts (heat
// counts), so the ledger can say where a cell's energy goes besides its engines and crawling
const CBE3_LIP: u32 = 0u;     // the bilayer's soaps and oil (the builder, a head on oil): sparks, rises, water splits
const CBE3_WALL: u32 = 1u;    // the wall's chain carbons and cross-linked pairs
const CBE3_RED: u32 = 2u;     // ... of all builds, the REDUCTIONS' share (the rise 2.75 and a water split for the g)
const CBE3_PIG: u32 = 3u;     // the pigments' carbon and assembly
const CBE3_ENZ: u32 = 4u;     // the enzymes: renewed in place and built
const CBE3_TRANS: u32 = 5u;   // the transporter's upkeep
const CBE3_SHUT: u32 = 6u;    // hands moved by the REDUCING SHUTTLE (step C15d fix c: one carbon's oxidation reduces another's hand)
const CBE3_SPARE: u32 = 7u;
var<workgroup> wcbe3: array<atomic<i32>, 8>;
var<workgroup> wcbf: array<atomic<i32>, 16>;   // per channel: 0..7 taken in from the dish, 8..15 given back to it
var<workgroup> wcbe: array<atomic<i32>, 16>;   // CBE_*

fn cbg(j: u32) -> i32 { return 4 - i32(j); }
fn cbt(j: u32) -> i32 { return i32(j); }
fn cb_pw(x: f32, k: i32) -> f32 { var r = 1.0; for (var j = 0; j < k; j++) { r *= x; } return r; }

/** The ladder copy current at this tick (its channel 0, a word in hb), 0 with no grid. */
fn cb_cur() -> u32 {
  if ((CBP.cfg.x & CBF_RESET) != 0u) { return CBP.off.w; }
  var k = CBP.cfg.w;
  if ((CBP.cfg.x & CBF_FLIP) != 0u) {
    let mt = i32(S.tick - CBP.cfg.y);
    if (mt >= 0) { k ^= (u32(mt) * CBP.cfg.z) & 1u; }
  }
  return select(CBP.off.x, CBP.off.y, k == 1u);
}

// a carbon engine's kind (as the table's: 0 uphill, 2 breathe, 3 form): OXIDIZE, CONDENSE, REDUCE, HYDROLYZE
fn cb_kind(j: u32) -> u32 { return select(select(0u, 3u, j == 1u), 2u, j == 0u); }

/** Any engine slot's description: the table's from EatP, a carbon engine's made up (its reactants unnamed but a free t for OXIDIZE). */
fn eng_at(code: f32) -> Eng {
  let e = eng_index(code);
  if (e < ENG_MAIN) { return EP.eng[e]; }
  let j = e - ENG_MAIN;
  var E: Eng;
  E.ch = vec4u(select(NONE, 1u, j == 0u), NONE, NONE, NONE);
  E.kind = cb_kind(j);
  E.g16 = select(CBP.e.y, CBP.e.x, j == 0u || j == 2u);
  E.spark = f32(CBP.e.z) / 16.0;
  return E;
}

/** A body's WANT for a cell of radius r (CSS px), in carbon units: kBody per R^2 of its area. */
fn cb_want(r: f32) -> f32 { return CBP.g.x * 3.14159265 * r * r / max(EP.R * EP.R, 1e-6); }

/**
 * Step C15b, a PART's RECIPE: build up to n carbons (counts) into the hand counts (pc, pg, pt) from the stock's carbon (S: the ladder;
 * gc, gg, gt: the granules), each carbon paying sp16 heat counts from the battery (as heat), plus k atoms of the element in channel el of
 * the main stock per carbon (el NONE: carbon alone; C15c's parts will name theirs). The ladder in the order of the most built-with
 * (sugar-unit-like, formic-, methanol-, methane-like; CO2-like never), then the granules while their fuel hands are at least a quarter of
 * their hands. Returns the carbons built (whole counts; hands move, no bond changes).
 */
fn cb_build(n: i32, S: ptr<function, array<i32, 5>>, gc: ptr<function, i32>, gg: ptr<function, i32>, gt: ptr<function, i32>,
            pc: ptr<function, i32>, pg: ptr<function, i32>, pt: ptr<function, i32>, m: ptr<function, array<i32, 18>>, el: u32, k: i32,
            bat: ptr<function, i32>, heat: ptr<function, i32>, sp16: i32, r: f32) -> i32 {
  var left = min(n, *bat / max(sp16, 1));
  if (el != NONE && k > 0) { left = min(left, max((*m)[el], 0) / k); }
  if (left <= 0) { return 0; }
  var done = 0;
  let order = array<u32, 4>(2u, 3u, 1u, 0u);
  for (var q = 0u; q < 4u; q++) {
    let j = order[q];
    let x = min(left, (*S)[j]);
    if (x <= 0) { continue; }
    (*S)[j] -= x; *pg += x * cbg(j); *pt += x * cbt(j);
    left -= x; done += x;
  }
  // the granules: about x carbons as the same share of each hand count, in whole carbons (hand units in fours)
  let C4 = 2 * *gc + *gg + *gt;
  if (left > 0 && C4 >= 4 && 4 * *gg >= *gg + *gt) {
    let f = min(f32(4 * left) / f32(C4), 1.0);
    var dc = min(i32(floor(f32(*gc) * f + r)), *gc);
    var dg = min(i32(floor(f32(*gg) * f + r)), *gg);
    var dt = min(i32(floor(f32(*gt) * f + r)), *gt);
    let drop = (2 * dc + dg + dt) % 4;
    if (drop > 0) { if (dt >= drop) { dt -= drop; } else if (dg >= drop) { dg -= drop; } else { dc = 0; dg = 0; dt = 0; } }
    let x = (2 * dc + dg + dt) / 4;
    if (x > 0 && 2 * dc + dg + dt == 4 * x) {
      *gc -= dc; *gg -= dg; *gt -= dt; *pc += dc; *pg += dg; *pt += dt;
      left -= x; done += x;
    }
  }
  *bat -= done * sp16;
  *heat += done * sp16;
  if (el != NONE && k > 0) { (*m)[el] -= done * k; }   // (the element's atoms go into the part: C15c books them with it)
  return done;
}

/** A reset: a founder in slot i starts with a full body for radius r (cellulose-like hands), booked as carbon in (dish ADD and the cells' IN). */
fn cb_found(i: u32, r: f32, slot: u32) {
  if (CARBON_ON == 0u || (CBP.cfg.x & (CBF_ON | CBF_GROW)) != (CBF_ON | CBF_GROW)) { return; }
  let n = i32(round(cb_want(r) * clamp(CBP.g.z, 0.0, 4.0) * ATOM_SCALE));
  if (n <= 0) { return; }
  for (var q = 0u; q < 3u; q++) {
    atomicAdd(&cbS[i * CW + CB_BODY + q], n);
    add64(LG_CB_ADD_C + 128u * (5u + q) + slot, n);
    add64(LG_CBC_IN + 128u * (5u + q) + slot, n);
  }
}

fn take_cb(a: u32, want: i32) -> i32 {
  if (want <= 0) { return 0; }
  let old = atomicSub(&cbS[a], want);
  let got = clamp(old, 0, want);
  if (got < want) { atomicAdd(&cbS[a], want - got); }
  return got;
}

/** The atoms a cell's carbon holds (counts): five per ladder molecule; a granule's carbons and the atoms on its hands. (Plain view.) */
fn cb_atoms(i: u32) -> f32 {
  let o = i * CW;
  var a = 0;
  for (var j = 0u; j < 5u; j++) { a += 5 * max(cbSP[o + j], 0); }
  let cc = max(cbSP[o + 5u], 0) + max(cbSP[o + CB_BODY], 0);
  let cg = max(cbSP[o + 6u], 0) + max(cbSP[o + CB_BODY + 1u], 0);
  let ct = max(cbSP[o + 7u], 0) + max(cbSP[o + CB_BODY + 2u], 0);
  return f32(a) + 0.25 * f32(2 * cc + cg + ct) + f32(cg + ct);
}

/** A cell's carbon back to the dish at the pixels idx (death, burst, a meal's end, a reset); with no grid, booked as gone. */
fn cb_give_back(i: u32, idx: array<u32, 9>, slot: u32, gcur: u32) {   // (step C15c: gcur, the main grid's copy, for the enzymes' G)
  if (CARBON_ON == 0u) { return; }
  let cur = cb_cur();
  for (var w = 0u; w < 11u; w++) {
    let m = atomicExchange(&cbS[i * CW + w], 0);
    if (m <= 0) { continue; }
    let ch = select(w, w - 3u, w >= CB_BODY);   // (the body's hands as tar)
    add64(LG_CBC_OUT + 128u * ch + slot, m);
    if (cur != 0u) { spread9(select(CBP.off.z + (ch - 5u) * EP.n, cur + ch * EP.n, ch < 5u), idx, m); }
    else { add64(CBL_GONE + 128u * ch + slot, m); }   // (out of the cells and gone: both books see it)
  }
  // step C15c: the enzymes, as tar hands (their carbon) and their G atoms (into the dish's G, or booked gone)
  let ne = atomicExchange(&cbS[i * CW + CB_ENZ], 0);
  if (ne > 0) {
    cb_spill(CB_ENZ_H, ne, idx, false, slot);
    if (gcur != 0u && (EP.mask & 8u) != 0u) { spread9(gcur + 3u * EP.n, idx, ne); } else { add64(lg_mc(LG_M_GONE, 3u) + slot, ne); }
  }
  for (var w = 12u; w < CW; w++) { atomicStore(&cbS[i * CW + w], 0); }
}

/** A birth: the newborn i takes half its parent's ladder and the share sh of its granules. */
fn cb_split(i: u32, pi: u32, sh: f32) {
  if (CARBON_ON == 0u) { return; }
  for (var w = 0u; w < 12u; w++) {   // (step C15c: and the enzymes, word 11, by the same share as the granules)
    let h = atomicLoad(&cbS[pi * CW + w]);
    let want = select(i32(floor(f32(h) * sh)), h / 2, w < 5u);
    let got = take_cb(pi * CW + w, want);
    if (got > 0) { atomicAdd(&cbS[i * CW + w], got); }
  }
}

/** Digestion (P1): the host i takes the share dsh of its meal g's carbon (the rest spills with the meal at the end). */
fn cb_digest(i: u32, g: u32, dsh: f32, r: u32) {
  if (CARBON_ON == 0u) { return; }
  for (var w = 0u; w < 12u; w++) {
    let mv = atomicLoad(&cbS[g * CW + w]);
    if (mv <= 0) { continue; }
    let n = min(mv, i32(floor(f32(mv) * dsh + u01(pcg(r + w * 0x2f6b1e3du)))));
    // (its body into the host's granules; step C15c: its enzymes into the host's enzymes)
    if (n > 0) { atomicSub(&cbS[g * CW + w], n); atomicAdd(&cbS[i * CW + select(select(w, w - 3u, w >= CB_BODY), CB_ENZ, w == CB_ENZ)], n); }
  }
}

/**
 * The plan pass (plain reads): the exchange of each ladder channel with the 9 pixels under the cell (a neutral molecule's rate pkN x the
 * ladder's share, an inflow x room), and the tar it asks to graze (kGraze x its granule-eating engines' expressed rate, x room). Into the
 * cell's words 8..15 for the eat pass.
 */
fn cb_plan(i: u32, idx: array<u32, 9>, areaPx: f32, Ao: f32, pkN: f32, room: f32, freeS: f32, live: bool, rs: u32) {
  let o = i * CW;
  let cur = cb_cur();
  let lw = LEDGER_WORDS;
  let on = live && cur != 0u && (CBP.cfg.x & CBF_ON) != 0u;
  let pk = pkN * (CBP.k.x + CBP.t.x * cb_trans(i));   // (step C15c: + the TRANSPORTER's level)
  for (var j = 0u; j < 5u; j++) {
    var n = 0;
    if (on && (CBP.cfg.x & CBF_EXCH) != 0u && pk > 0.0) {
      let base = cur - lw + j * EP.n;
      var Mo = 0;
      for (var q = 0; q < 9; q++) { Mo += max(mg[base + idx[q]], 0); }
      let Mi = max(cbSP[o + j], 0);
      if (Mo != 0 || Mi != 0) {
        var x = (f32(Mo) * areaPx - f32(Mi) * Ao) / (Ao + areaPx) * min(1.0, pk * EP.dt);
        if (x > 0.0) { x *= room; }
        n = clamp(i32(floor(x + u01(pcg(rs + j * 0x7feb352du + 0x3243f6a9u)))), -Mi, Mo);
      }
    }
    cbSP[o + CB_FLUX + j] = n;
  }
  // grazing: the expressed rates of the engines that can use tar (OXIDIZE burns a granule's fuel hands, HYDROLYZE opens its backbones)
  var gr = 0.0;
  if (on && (CBP.cfg.x & CBF_GRAZE) != 0u && (CBP.cfg.x & CBF_ENG) != 0u && (EP.flags & EF_ENG) != 0u) {
    let b = bio[i];
    for (var k = 0u; k < 3u; k++) {
      let e = eng_index(b.eng[k]);
      if (b.rate[k] <= 0.0 || (e != ENG_MAIN && e != ENG_MAIN + 3u)) { continue; }
      gr += b.rate[k] * select(1.0, gof(i, GRN_O_ENG0 + k), grn_on());
    }
  }
  // ... and a HUNGRY cell (its body short of its want: GROWTH NEEDS CARBON) grazes as one unit of such an engine: mud is building material
  // (step C15c: as CBP.u.y units: carbon now also makes its membrane, walls and enzymes, and the dish's carbon is mostly mud)
  if (on && (CBP.cfg.x & (CBF_GRAZE | CBF_GROW)) == (CBF_GRAZE | CBF_GROW)) {
    let body = 0.25 * f32(2 * cbSP[o + CB_BODY] + cbSP[o + CB_BODY + 1u] + cbSP[o + CB_BODY + 2u]);
    if (body < cb_want(cells[i].r) * ATOM_SCALE) { gr += select(1.0, CBP.u.y, CBP.u.y > 0.0); }
  }
  // (step C15c: the mud lies on the FLOOR under the cell, so it is eaten with the whole underside, covered sides or not: T1a's inside
  // shields the membrane's sides from the water, not the floor)
  let kg = min(CBP.k.y * gr * EP.dt * select(freeS, 1.0, cb_lip()), 1.0) * room;
  for (var w = 0u; w < 3u; w++) {
    var want = 0;
    if (kg > 0.0) {
      let base = CBP.off.z - lw + w * EP.n;
      var Mo = 0;
      for (var q = 0; q < 9; q++) { Mo += max(mg[base + idx[q]], 0); }
      want = min(i32(floor(f32(Mo) * kg + u01(pcg(rs + w * 0x6c8e9cf5u + 0x1b873593u)))), Mo);
    }
    cbSP[o + CB_GRAZE + w] = want;
  }
}

/** The smell (plan pass): the ladder's fuel at a corner's pixel pi, in smellW's units (heat counts per count), the current copy. */
fn cb_smell(pi: u32) -> f32 {
  if (CARBON_ON == 0u || (CBP.cfg.x & (CBF_ON | CBF_SMELL)) != (CBF_ON | CBF_SMELL)) { return 0.0; }
  let cur = cb_cur();
  if (cur == 0u) { return 0.0; }
  var v = 0.0;
  for (var j = 0u; j < 4u; j++) { v += f32(cbg(j) * CBP.e.w) * f32(max(mg[cur - LEDGER_WORDS + j * EP.n + pi], 0)); }
  return v;
}

// n events over the carriers of one kind of hand: wts[q] the hands carrier q offers (0..4 the ladder molecules, 5 the granules), caps[q]
// the events it can take this tick; from a carrier picked by weight (r in 0..1) round the others; returns each one's share
fn cb_alloc(wts: array<i32, 6>, caps: array<i32, 6>, n: i32, r: f32) -> array<i32, 6> {
  var out = array<i32, 6>(0, 0, 0, 0, 0, 0);
  var tot = 0;
  for (var q = 0u; q < 6u; q++) { tot += max(wts[q], 0); }
  if (tot <= 0 || n <= 0) { return out; }
  let x = r * f32(tot);
  var start = 5u;
  var acc = 0.0;
  for (var q = 0u; q < 6u; q++) {
    acc += f32(max(wts[q], 0));
    if (x < acc) { start = q; break; }
  }
  var left = n;
  for (var s = 0u; s < 6u; s++) {
    let q = (start + s) % 6u;
    if (wts[q] <= 0 || left <= 0) { continue; }
    let t = min(left, max(caps[q], 0));
    out[q] = t;
    left -= t;
  }
  return out;
}
fn cb_sum(a: array<i32, 6>) -> i32 { return a[0] + a[1] + a[2] + a[3] + a[4] + a[5]; }

// what the eat pass hands back: x the granules' carbons (counts), y the ladder's fuel hands (counts), z the atoms the cell's carbon holds
struct CbOut { gran: f32, fuel: f32, atoms: f32, ready: f32 };   // (ready: the body's share of its want, 0..1; 1 with growth off)

/**
 * The eat pass, for a live cell i (after its engines, before its upkeep): the exchange and the grazing the plan worked out, the carbon
 * engines in its slots (b: its genome AS EXPRESSED; ph: the photons each slot's pigment caught this tick, phs those saturation leaves
 * usable: the rest are heat), the granules'
 * loose carbons dissolving. m, bat, heat: the cell's main stock, battery and heat (the eat pass stores them).
 */
fn cb_cell(i: u32, b: Bio, ph: vec3i, phs: vec3i, m: ptr<function, array<i32, 18>>, bat: ptr<function, i32>, heat: ptr<function, i32>, idx: array<u32, 9>,
           lnCap: f32, temp: f32, satOn: bool, sparkScale: f32, cof: f32, rs: u32) -> CbOut {
  let o = i * CW;
  var S: array<i32, 5>;
  var S0: array<i32, 5>;
  for (var j = 0u; j < 5u; j++) { S[j] = atomicLoad(&cbS[o + j]); S0[j] = S[j]; }
  var cc = atomicLoad(&cbS[o + 5u]);
  var cg = atomicLoad(&cbS[o + 6u]);
  var ct = atomicLoad(&cbS[o + 7u]);
  let t0 = vec3i(cc, cg, ct);
  let on = (CBP.cfg.x & CBF_ON) != 0u;
  let cur = cb_cur();

  // ---- the exchange through the membrane (the ladder), and the grazing (tar into granules)
  if (on && cur != 0u && (CBP.cfg.x & CBF_EXCH) != 0u) {
    for (var j = 0u; j < 5u; j++) {
      let n = atomicLoad(&cbS[o + CB_FLUX + j]);
      if (n == 0) { continue; }
      let base = cur + j * EP.n;
      if (n > 0) {
        let part = n / 9;
        var got = 0;
        for (var q = 0; q < 9; q++) { got += take_hb(base + idx[q], select(part, n - 8 * part, q == 4)); }
        S[j] += got;
        if (got > 0) { atomicAdd(&wcbf[j], got); }
      } else {
        let give = min(-n, S[j]);
        if (give > 0) { spread9(base, idx, give); S[j] -= give; atomicAdd(&wcbf[8u + j], give); }
      }
    }
  }
  if (on && cur != 0u && (CBP.cfg.x & CBF_GRAZE) != 0u) {
    var hands = 0;
    for (var w = 0u; w < 3u; w++) {
      let want = atomicLoad(&cbS[o + CB_GRAZE + w]);
      if (want <= 0) { continue; }
      let part = want / 9;
      var got = 0;
      for (var q = 0; q < 9; q++) { got += take_hb(CBP.off.z + w * EP.n + idx[q], select(part, want - 8 * part, q == 4)); }
      if (w == 0u) { cc += got; } else if (w == 1u) { cg += got; } else { ct += got; }
      if (got > 0) { atomicAdd(&wcbf[5u + w], got); hands += got; }
    }
    if (hands > 0) { atomicAdd(&wcbe[CBE_GRAZE], hands); }
  }

  // ---- the carbon engines (the slots naming one), as every engine: downhill ones fill the battery, uphill ones take light or battery
  let engOn = on && (CBP.cfg.x & CBF_ENG) != 0u;
  if ((EP.flags & EF_ENG) != 0u) {
    let capE = i32(EP.engMax);
    let batMax = max(EP.batMax, 1);
    let sp16 = max(i32(ceil(f32(CBP.e.z) / 16.0 * sparkScale * 16.0)), 1);
    for (var k = 0u; k < 3u; k++) {
      let e = eng_index(b.eng[k]);
      if (e < ENG_MAIN || b.rate[k] <= 0.0) { continue; }
      let j = e - ENG_MAIN;
      let band = eng_band(b.eng[k]);
      if (!engOn) {   // (idle: the photons its pigment caught are heat, as any idle photon)
        if (band != 0u && ph[k] > 0) { *heat += ph[k] * EP.photon16[band]; atomicAdd(&wcbe[CBE_HEAT], ph[k] * EP.photon16[band]); atomicAdd(&wcbe[CBE_PHI], ph[k]); }
        continue;
      }
      let rk = b.rate[k] * cof;
      let r1 = u01(pcg(rs + k * 0x2545f491u + 0x6a09e667u));
      let r2 = u01(pcg(rs + k * 0x2545f491u + 0xbb67ae85u));
      let r3 = u01(pcg(rs + k * 0x2545f491u + 0x3c6ef372u));
      // the hands on offer: giver hands (ladder 0..3 and granules), taker hands (ladder 1..4 and granules)
      let G = cbg(0u) * S[0] + cbg(1u) * S[1] + cbg(2u) * S[2] + cbg(3u) * S[3] + cg;
      let T = cbt(1u) * S[1] + cbt(2u) * S[2] + cbt(3u) * S[3] + cbt(4u) * S[4] + ct;
      if (j == 0u || j == 1u) {
        // DOWNHILL: OXIDIZE t + [c-g] -> [c-t] + g (2.75), CONDENSE [c-g] + [c-t] -> [c-c] + gt (0.75): rate x the scarcer x dt, the spark
        // from the battery first (an empty one starts nothing), the release into it minus the ineff share, a full one takes nothing more
        let g16 = select(CBP.e.y, CBP.e.x, j == 0u);
        let h1 = (g16 * i32(EP.ineff)) / 256;
        let g1 = g16 - h1;
        let a = select(min(G, T), min((*m)[1], G), j == 0u);
        if (a <= 0) { continue; }
        var xs = rk * f32(a) * EP.dt;
        if (satOn) {
          // saturation (C12e): the products against the reactants (oxidize: t hands and free g over g hands and free t; condense: c-c
          // and water over g and t hands)
          let lq = select(lnc(cc) + lnc((*m)[6]) - lnc(G) - lnc(T), lnc(T) + lnc((*m)[0]) - lnc(G) - lnc((*m)[1]), j == 0u);
          let fs = sat_f(lq, 0.0, lnCap, f32(g16) / 16.0, temp);
          let xw = min(xs, f32(min(a, capE)));
          atomicAdd(&wcbe[CBE_SATW], i32(round(xw)));
          atomicAdd(&wcbe[CBE_SATL], i32(round(xw * (1.0 - fs))));
          xs *= fs;
        }
        var n = i32(floor(xs + r1));
        n = min(n, min(a, capE));
        n = min(n, *bat / sp16);
        n = min(n, max(batMax - *bat, 0) / max(g1, 1));
        if (n <= 0) { continue; }
        var done = 0;
        if (j == 0u) {
          let al = cb_alloc(array<i32, 6>(4 * S[0], 3 * S[1], 2 * S[2], S[3], 0, cg), array<i32, 6>(S[0], S[1], S[2], S[3], 0, cg), n, r2);
          for (var q = 0u; q < 4u; q++) { S[q] -= al[q]; S[q + 1u] += al[q]; }
          cg -= al[5]; ct += al[5];
          done = cb_sum(al);
          (*m)[1] -= done; (*m)[0] += done;
          atomicAdd(&wcbe[CBE_OX], done);
        } else {
          // the donors (a giver hand), then the acceptors (a taker hand) from what the donors left; the bigger side trimmed
          var dn = cb_alloc(array<i32, 6>(4 * S[0], 3 * S[1], 2 * S[2], S[3], 0, cg), array<i32, 6>(S[0], S[1], S[2], S[3], 0, cg), n, r2);
          var ac = cb_alloc(array<i32, 6>(0, S[1], 2 * S[2], 3 * S[3], 4 * S[4], ct),
                            array<i32, 6>(0, S[1] - dn[1], S[2] - dn[2], S[3] - dn[3], S[4], ct), n, r3);
          let nd = cb_sum(dn);
          let na = cb_sum(ac);
          done = min(nd, na);
          var cut = nd - done;
          for (var q = 0u; q < 6u; q++) { let x = min(cut, dn[q]); dn[q] -= x; cut -= x; }
          cut = na - done;
          for (var q = 0u; q < 6u; q++) { let x = min(cut, ac[q]); ac[q] -= x; cut -= x; }
          cc += done;
          for (var q = 0u; q < 4u; q++) { S[q] -= dn[q]; cg += dn[q] * (cbg(q) - 1); ct += dn[q] * cbt(q); }
          cg -= dn[5];
          for (var q = 1u; q < 5u; q++) { S[q] -= ac[q]; cg += ac[q] * cbg(q); ct += ac[q] * (cbt(q) - 1); }
          ct -= ac[5];
          (*m)[6] += done;
          atomicAdd(&wcbe[CBE_COND], done);
        }
        *bat += done * g1;
        *heat += done * h1;
        atomicAdd(&wcbe[CBE_GAIN], done * g1);
        atomicAdd(&wcbe[CBE_HEAT], done * h1);
      } else {
        // UPHILL: REDUCE g + [c-t] -> [c-g] + t (2.75), HYDROLYZE gt + [c-c] -> [c-g] + [c-t] (0.75). With a pigment (band 1..3) one photon
        // per event pays the rise (a weaker one takes the rest from the battery), the spark always from the battery (lost as heat); band 0,
        // a STORER: rate x the scarcer x dt, the battery pays it all. Light never charges the battery: the rest of a photon is heat
        let g16 = select(CBP.e.y, CBP.e.x, j == 2u);
        let a = select(min((*m)[6], cc), min((*m)[0], T), j == 2u);
        var np = 0;
        var ph16 = 0;
        var nu = 0;
        if (band == 0u) {
          np = i32(floor(rk * f32(max(a, 0)) * EP.dt + r1));
          nu = np;
        } else {
          ph16 = EP.photon16[band];
          np = ph[k];
          nu = i32(floor(f32(phs[k]) * cof + r1));
        }
        if (np <= 0) { continue; }
        let d16 = max(g16 - ph16, 0);
        let c16 = sp16 + d16;
        var n = min(nu, min(max(a, 0), capE));
        n = max(min(n, *bat / c16), 0);
        if (n > 0 && satOn) {
          let lq = select(lnc(G) + lnc(T) - lnc(cc) - lnc((*m)[6]), lnc(G) + lnc((*m)[1]) - lnc(T) - lnc((*m)[0]), j == 2u);
          let fs = sat_f(lq, 0.0, lnCap, f32(max(ph16, g16) - g16 + sp16) / 16.0, temp);
          let n1 = clamp(i32(floor(f32(n) * fs + r3)), 0, n);
          atomicAdd(&wcbe[CBE_SATW], n);
          atomicAdd(&wcbe[CBE_SATL], n - n1);
          n = n1;
        }
        var done = 0;
        if (n > 0) {
          if (j == 2u) {
            let al = cb_alloc(array<i32, 6>(0, S[1], 2 * S[2], 3 * S[3], 4 * S[4], ct), array<i32, 6>(0, S[1], S[2], S[3], S[4], ct), n, r2);
            for (var q = 1u; q < 5u; q++) { S[q] -= al[q]; S[q - 1u] += al[q]; }
            ct -= al[5]; cg += al[5];
            done = cb_sum(al);
            (*m)[0] -= done; (*m)[1] += done;
            atomicAdd(&wcbe[CBE_RED], done);
          } else {
            done = n;
            cc -= done; cg += done; ct += done;
            (*m)[6] -= done;
            atomicAdd(&wcbe[CBE_HYD], done);
          }
        }
        if (band == 0u) { np = done; }   // (a storer has no photons to waste)
        *bat -= done * c16;
        let hh = done * (ph16 + c16 - g16) + (np - done) * ph16;
        *heat += hh;
        atomicAdd(&wcbe[CBE_PAID], done * c16);
        atomicAdd(&wcbe[CBE_RISE], done * g16);
        atomicAdd(&wcbe[CBE_HEAT], hh);
        if (band != 0u) { atomicAdd(&wcbe[CBE_PHU], done); atomicAdd(&wcbe[CBE_PHI], np - done); }
      }
    }
  }

  // ---- the granules' LOOSE carbons (no backbone bond) leave as ladder molecules, as the dish's DISSOLVE (zero energy), kDis per s
  if (on && (CBP.cfg.x & CBF_DIS) != 0u) {
    let C4 = 2 * cc + cg + ct;
    if (C4 > 0 && cg + ct > 0) {
      let p = f32(2 * cc) / f32(C4);
      let lp = (1.0 - p) * (1.0 - p);
      let loose = 0.25 * f32(C4) * lp * lp;
      var rem = min(i32(floor(CBP.k.z * loose * EP.dt + u01(pcg(rs + 0x510e527fu)))), (cg + ct) / 4);
      if (rem > 0) {
        let q = f32(cg) / f32(cg + ct);
        var pr = 1.0;
        var nd = 0;
        for (var kk = 4; kk >= 0; kk--) {
          if (rem <= 0) { break; }
          let tk = 4 - kk;
          let pk = select(select(4.0, 6.0, kk == 2), 1.0, kk == 0 || kk == 4) * cb_pw(q, kk) * cb_pw(1.0 - q, tk);
          var take = rem;
          if (kk > 0 && pr > 1e-9) { take = i32(floor(f32(rem) * clamp(pk / pr, 0.0, 1.0) + u01(pcg(rs + u32(kk) * 0x9b05688cu + 0x1f83d9abu)))); }
          if (kk > 0) { take = min(take, cg / kk); }
          if (tk > 0) { take = min(take, ct / tk); }
          take = max(take, 0);
          pr -= pk;
          if (take <= 0) { continue; }
          S[u32(4 - kk)] += take; cg -= kk * take; ct -= tk * take; rem -= take; nd += take;
        }
        if (nd > 0) { atomicAdd(&wcbe[CBE_DIS], nd); }
      }
    }
  }

  // ---- GROWTH NEEDS CARBON: the body builds toward its want from the stock's carbon (cb_build), the spark per carbon from the battery
  var bc = atomicLoad(&cbS[o + CB_BODY]);
  var bg = atomicLoad(&cbS[o + CB_BODY + 1u]);
  var bt = atomicLoad(&cbS[o + CB_BODY + 2u]);
  let b0 = vec3i(bc, bg, bt);
  let wantC = cb_want(cells[i].r) * ATOM_SCALE;                 // (carbon counts)
  var ready = 1.0;
  if (on && (CBP.cfg.x & CBF_GROW) != 0u && wantC > 0.0) {
    let have = 0.25 * f32(2 * bc + bg + bt);
    if (have < wantC) {
      let nb = i32(floor((wantC - have) * min(CBP.g.y * EP.dt, 1.0) + u01(pcg(rs + 0x6a09e667u))));
      let sp16 = max(i32(ceil(f32(CBP.e.z) / 16.0 * sparkScale * 16.0)), 1);
      let got = cb_build(max(nb, 0), &S, &cc, &cg, &ct, &bc, &bg, &bt, m, NONE, 0, bat, heat, sp16, u01(pcg(rs + 0x3c6ef372u)));
      if (got > 0) { atomicAdd(&wcbe[CBE_BUILT], got); atomicAdd(&wcbe[CBE_BPAID], got * sp16); }
    }
    ready = clamp(0.25 * f32(2 * bc + bg + bt) / wantC, 0.0, 1.0);
  }
  if (bc != b0.x) { atomicStore(&cbS[o + CB_BODY], bc); }
  if (bg != b0.y) { atomicStore(&cbS[o + CB_BODY + 1u], bg); }
  if (bt != b0.z) { atomicStore(&cbS[o + CB_BODY + 2u], bt); }

  // step C15c: the TRANSPORTER's upkeep (per level per s, from the battery as heat; what an empty battery cannot pay is not paid)
  if (on && cb_bit(CBF_TRANS) && CBP.t.y > 0.0) {
    let pay = clamp(i32(floor(CBP.t.y * cb_trans(i) * EP.dt + u01(pcg(rs + 0x71374491u)))), 0, max(*bat, 0));
    if (pay > 0) { *bat -= pay; *heat += pay; atomicAdd(&wcbe3[CBE3_TRANS], pay); }
  }
  for (var j = 0u; j < 5u; j++) { if (S[j] != S0[j]) { atomicStore(&cbS[o + j], S[j]); } }
  if (cc != t0.x) { atomicStore(&cbS[o + 5u], cc); }
  if (cg != t0.y) { atomicStore(&cbS[o + 6u], cg); }
  if (ct != t0.z) { atomicStore(&cbS[o + 7u], ct); }
  var out: CbOut;
  out.gran = 0.25 * f32(2 * cc + cg + ct);
  out.fuel = f32(4 * S[0] + 3 * S[1] + 2 * S[2] + S[3]);
  out.atoms = f32(5 * (S[0] + S[1] + S[2] + S[3] + S[4])) + out.gran + f32(cg + ct) + 0.25 * f32(2 * bc + bg + bt) + f32(bg + bt);
  out.ready = ready;
  return out;
}

/** The ledger pass: every slot's carbon (the books count every slot: a free one holds none), and the census of the live cells. */
fn cb_ledger(i: u32, live: bool) {
  if (CARBON_ON == 0u) { return; }
  cb_ledger_parts(i, live);   // step C15c
  let slot = i & 63u;
  var lad = 0;
  var bh = vec3i(0);
  for (var w = 0u; w < 11u; w++) {
    let v = max(atomicLoad(&cbS[i * CW + w]), 0);
    if (w >= CB_BODY) { bh[w - CB_BODY] = v; }
    if (v != 0) { add64(LG_CBC_STOCK + 128u * select(w, w - 3u, w >= CB_BODY) + slot, v); }   // (the body counts with the granules)
    if (w < 5u) { lad += v; }
  }
  if (!live) { return; }
  let s16 = i & 15u;
  let b = bio[i];
  var has = array<bool, 4>(false, false, false, false);
  var lit = false;
  var other = false;
  for (var k = 0u; k < 3u; k++) {
    if (b.rate[k] <= 0.0) { continue; }
    let e = eng_index(b.eng[k]);
    if (e < ENG_MAIN) { other = true; continue; }
    has[e - ENG_MAIN] = true;
    if (e - ENG_MAIN == 2u && eng_band(b.eng[k]) > 0u) { lit = true; }
  }
  atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_N + s16], 1);
  if (has[0]) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_OX + s16], 1); }
  if (has[1]) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_COND + s16], 1); }
  if (has[2]) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_RED + s16], 1); }
  if (lit) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_REDLIT + s16], 1); }
  if (has[3]) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_HYD + s16], 1); }
  if (has[0] || has[1] || has[2] || has[3]) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_ANY + s16], 1); }
  let gran = 0.25 * f32(2 * max(atomicLoad(&cbS[i * CW + 5u]), 0) + max(atomicLoad(&cbS[i * CW + 6u]), 0) + max(atomicLoad(&cbS[i * CW + 7u]), 0));
  if (gran > 0.05 * ATOM_SCALE) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_GRAN + s16], 1); }
  atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_GRANC + s16], i32(round(gran / ATOM_SCALE * 1000.0)));
  atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_LAD + s16], i32(round(f32(lad) / ATOM_SCALE * 1000.0)));
  if (has[0] && !other) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_OXONLY + s16], 1); }
  let body = 0.25 * f32(2 * bh.x + bh.y + bh.z) / ATOM_SCALE;
  let want = cb_want(cells[i].r);
  atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_BODY + s16], i32(round(body * 1000.0)));
  atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_WANT + s16], i32(round(want * 1000.0)));
  if (body < want * 0.999) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_SHORT + s16], 1); }
  if (lit && !other) { atomicAdd(&hb[LG_CBC_CEN + 16u * CBZ_LITONLY + s16], 1); }
}

/** The workgroup's carbon counters into the ledger (called from flush_counters, after its barrier). */
fn cb_flush(li: u32, slot: u32) {
  if (CARBON_ON == 0u) { return; }
  if (li < 16u) {
    let v = atomicLoad(&wcbf[li]);
    if (v != 0) { add64(select(LG_CBC_OUT + 128u * (li & 7u), LG_CBC_IN + 128u * li, li < 8u) + slot, v); }
  } else if (li < 32u) {
    let v = atomicLoad(&wcbe[li - 16u]);
    if (v != 0) { add64(LG_CBC_EV + 128u * (li - 16u) + slot, v); }
  } else if (li < 40u) {
    let v = atomicLoad(&wcbe2[li - 32u]);   // (step C15c)
    if (v != 0) { add64(LG_CBC_EV2 + 128u * (li - 32u) + slot, v); }
  } else if (li < 48u) {
    let v = atomicLoad(&wcbe3[li - 40u]);   // (step C15d)
    if (v != 0) { add64(LG_CBC_EV3 + 128u * (li - 40u) + slot, v); }
  }
}


// ===== step C15c: CARBON MAKES THE CELL (src/carboncells.js; README "Step C15c: carbon makes the cell") =====
// Every built part is carbon + the element its job needs (the user, 2026-11-17: "the organic chemistry becomes carbon + element needed for
// specialized work"). With CBF_LIP the C12b membrane's five kinds (stock words 32..61) are CARBON molecules (the linkers retire):
//   kind 0 (was soap glL)  SOAP1 c2 g5 t   a head carbon with one burnt hand (polar) on a tail carbon (oily): the bilayer
//   kind 1 (was soap tlL)  SOAP2 c2 g4 t2  both burnt hands on the head carbon: the bilayer, one oxidation from spoiling
//   kind 2 (was oil lL)    OIL   c2 g6     all fuel hands: water-shy, between the soap's tails (stiffens it)
//   kind 3 (was crust ll)  WALL, a chain carbon (one backbone bond per carbon, one fuel and one burnt hand: cellulose-like)
//   kind 4 (was crust LL)  WALL, a cross-linked pair (three backbone bonds, one fuel, one burnt hand: stiffer; the old wall-row gene
//                          lip.z is now the cross-link share)
// The PIGMENT (stock word 30) is 2 carbons with fuel hands (an oil-like pair: its c-g bonds catch visible 1) + 1 trace; the GLUE (the
// C6c weave words 16..21) is sugar-unit-like molecules (cg2t2: carbon + charged hands) held in the side; ENZYMES (carbon word 11) are 4
// carbons (cellulose-like) + 1 heavy giver G each. In the books every part's carbon counts as tar hands (or ladder, for the glue) in the
// cells' carbon (so carbon, atoms, energy and charge stay exact by the tar's own accounting), and leaves the cell as tar (mud) at a death,
// burst or bite.
fn cb_lip() -> bool { return CARBON_ON != 0u && (CBP.cfg.x & (CBF_ON | CBF_LIP)) == (CBF_ON | CBF_LIP); }
fn cb_bit(f: u32) -> bool { return CARBON_ON != 0u && (CBP.cfg.x & (CBF_ON | f)) == (CBF_ON | f); }
/** A membrane kind's hands per count (cc backbone bonds, cg fuel hands, ct burnt hands): see above. */
fn cb_lk_hands(q: u32) -> vec3i {
  if (q == 0u) { return vec3i(1, 5, 1); }
  if (q == 1u) { return vec3i(1, 4, 2); }
  if (q == 2u) { return vec3i(1, 6, 0); }
  if (q == 3u) { return vec3i(1, 1, 1); }
  return vec3i(3, 1, 1);
}
const CB_PIG_H = vec3i(1, 6, 0);   // a pigment count's carbon (2 carbons)
const CB_ENZ_H = vec3i(4, 4, 4);   // an enzyme unit's carbon (4 carbons)

/** Hands (h per count, n counts) out of a cell into the dish's tar under it (wg: counted in the eat pass's workgroup, else in the ledger). */
fn cb_spill(h: vec3i, n: i32, idx: array<u32, 9>, wg: bool, slot: u32) {
  if (n <= 0) { return; }
  let cur = cb_cur();
  for (var w = 0u; w < 3u; w++) {
    let v = h[w] * n;
    if (v <= 0) { continue; }
    if (cur != 0u) { spread9(CBP.off.z + w * EP.n, idx, v); } else { add64(CBL_GONE + 128u * (5u + w) + slot, v); }
    if (wg) { atomicAdd(&wcbf[13u + w], v); } else { add64(LG_CBC_OUT + 128u * (5u + w) + slot, v); }
  }
}
/** ... and a ladder molecule (channel j) out into the dish (the glue at a death). */
fn cb_spill_lad(j: u32, n: i32, idx: array<u32, 9>, slot: u32) {
  if (n <= 0) { return; }
  let cur = cb_cur();
  if (cur != 0u) { spread9(cur + j * EP.n, idx, n); } else { add64(CBL_GONE + 128u * j + slot, n); }
  add64(LG_CBC_OUT + 128u * j + slot, n);
}
/** Hands into the cell's own granules (a part broken down, shed or worn: zero energy, the hands only move). */
fn cb_gran_add(i: u32, h: vec3i, n: i32) {
  if (n <= 0) { return; }
  for (var w = 0u; w < 3u; w++) { if (h[w] != 0) { atomicAdd(&cbS[i * CW + 5u + w], h[w] * n); } }
}
/** The cell's ladder into S, its granules returned. */
fn cb_ld(i: u32, S: ptr<function, array<i32, 5>>) -> vec3i {
  for (var j = 0u; j < 5u; j++) { (*S)[j] = atomicLoad(&cbS[i * CW + j]); }
  return vec3i(atomicLoad(&cbS[i * CW + 5u]), atomicLoad(&cbS[i * CW + 6u]), atomicLoad(&cbS[i * CW + 7u]));
}
fn cb_st(i: u32, S: ptr<function, array<i32, 5>>, g: vec3i) {
  for (var j = 0u; j < 5u; j++) { atomicStore(&cbS[i * CW + j], (*S)[j]); }
  for (var w = 0u; w < 3u; w++) { atomicStore(&cbS[i * CW + 5u + w], g[w]); }
}
fn cb_lim(i: u32, bits: u32) { if (bits != 0u) { atomicOr(&cbS[i * CW + CB_LIM], i32(bits)); } }

/**
 * Make n TWO-CARBON molecules with nT burnt hands (0 oil or pigment, 1 soap1, 2 soap2) from the ladder in S, by the table's own reactions:
 * two ladder carbons CONDENSE ([c-g] + [c-t] -> [c-c] + gt, 0.75 as heat, the carbon spark from the battery), a pair j1 + j2 burnt hands
 * giving j1 + j2 - 1. The exact pairs first; then a pair too REDUCED for the target, whose extra fuel hands are OXIDISED with free t from the
 * stock (2.75 each as heat, a spark each); then (CBF_RED) a pair too BURNT, whose extra burnt hands are REDUCED with a free g from the stock
 * (or, without one, from a water split for it: 4.5 more, its t freed), the battery paying the rise (2.75) and a spark each, and only from
 * above its floor (half full): the storer's way, fat from sugar is dear (CO2-like carbon only on this way: fixed). The
 * water goes to the stock, the freed atoms too. Returns the molecules made; lim gets the reason a shortfall stopped.
 */
fn cb_make2(nT: i32, n: i32, S: ptr<function, array<i32, 5>>, m: ptr<function, array<i32, 18>>, bat: ptr<function, i32>,
            heat: ptr<function, i32>, lim: ptr<function, u32>) -> i32 {
  if (n <= 0) { return 0; }
  let sp = max(CBP.e.z, 1);
  let ox = CBP.e.x;
  let cd = CBP.e.y;
  let red = (CBP.cfg.x & CBF_RED) != 0u;
  let shut = (CBP.cfg.x & CBF_SHUT) != 0u;
  let ds = array<i32, 7>(0, -1, -2, -3, 1, 2, 3);
  var left = n;
  var made = 0;
  var nOx = 0;
  var nRed = 0;
  var nSh = 0;
  var why = 0u;
  for (var a = 0u; a < 7u; a++) {
    let d = ds[a];
    if (left <= 0 || (d > 0 && !red && !shut)) { break; }
    let s = nT + 1 + d;
    for (var j1 = 0; j1 <= 3; j1++) {
      let j2 = s - j1;
      if (j2 < j1 || j2 > select(3, 4, d > 0) || left <= 0) { continue; }   // (CO2-like only where the battery reduces it: fixing)
      var x = select(min((*S)[j1], (*S)[j2]), (*S)[j1] / 2, j1 == j2);
      x = min(x, left);
      if (x <= 0) { continue; }
      let ad = abs(d);
      let cost = sp * (1 + ad) + max(d, 0) * ox;
      var ws = 0;   // (the waters split for their g)
      let ww = i32(CBP.u.z) + i32(CBP.u.w);
      // step C15d (CBF_SHUT), THE REDUCING SHUTTLE: a pair too burnt is reduced with the g that OXIDISING another carbon of the stock frees
      // (t + [c-g] -> [c-t] + g releases 2.75, then g + [c-t] -> [c-g] + t takes 2.75: the release pays the rise, and the free t or g that
      // carries the electron comes back; as real cells make fat from sugar with the NADPH they win by burning more sugar to CO2). Both
      // steps are the table's own reactions, so the battery pays only their two sparks; the donors are the ladder's fuel hands left over,
      // the most burnt first (formic-like to CO2-like, then sugar-unit-like, ...). It needs a free g or t in the stock as the carrier
      if (d > 0 && shut && (*m)[0] + (*m)[1] > 0) {
        var DH = 0;
        for (var q = 0u; q < 4u; q++) { DH += cbg(q) * max((*S)[q], 0); }
        let cs = sp * (1 + 2 * d);
        var xs = min(x, DH / (d + 8 - s));   // (the pair itself takes 8 - s fuel hands from the donors' pool)
        if (max(*bat, 0) / cs < xs) { xs = max(*bat, 0) / cs; why |= CBL_BAT; }
        if (xs > 0) {
          (*S)[j1] -= xs;
          (*S)[j2] -= xs;
          var need = xs * d;
          for (var pass = 0; pass < 4 && need > 0; pass++) {
            for (var qq = 0u; qq < 4u; qq++) {
              let q = 3u - qq;
              let k = min(need, max((*S)[q], 0));
              if (k > 0) { (*S)[q] -= k; (*S)[q + 1u] += k; need -= k; }
            }
          }
          *bat -= xs * cs;
          *heat += xs * (cs + cd);
          (*m)[6] += xs;
          nSh += xs * d - need;
          left -= xs;
          made += xs;
          x = min(select(min((*S)[j1], (*S)[j2]), (*S)[j1] / 2, j1 == j2), left);
          if (x <= 0) { continue; }
        }
        if (!red) { continue; }
      }
      if (d <= 0) {
        let xb = max(*bat, 0) / cost;
        if (xb < x) { x = xb; why |= CBL_BAT; }
        if (d < 0) { let xa = max((*m)[1], 0) / ad; if (xa < x) { x = xa; why |= CBL_AT; } }
      } else {
        // a REDUCTION's g: the stock's free g first, then a WATER split for it (gt -> g + t: its bond 4.5 and its spark from the battery
        // too, the t freed into the stock: the storer's own small photosynthesis without light); the battery only above its floor (v.x)
        let avail = max(*bat - i32(CBP.v.x), 0);
        let g0 = max((*m)[0], 0);
        let w0 = max((*m)[6], 0);
        let xa = (g0 + w0) / d;
        if (xa < x) { x = xa; why |= CBL_AT; }
        let x1 = min(x, g0 / d);
        if (x1 * cost >= avail) { x = avail / cost; why |= CBL_BAT; }
        else {
          let x2 = min(x - x1, (avail - x1 * cost) / (cost + d * ww));
          if (x1 + x2 < x) { why |= CBL_BAT; }
          x = x1 + max(x2, 0);
        }
        ws = max(x * d - g0, 0);
        if (ws > 0) { *bat -= ws * ww; *heat += ws * i32(CBP.u.w); (*m)[6] -= ws; (*m)[0] += ws; (*m)[1] += ws; }
      }
      if (x <= 0) { continue; }
      (*S)[j1] -= x;
      (*S)[j2] -= x;
      *bat -= x * cost;
      *heat += x * (sp * (1 + ad) + cd + max(-d, 0) * ox);
      (*m)[6] += x;
      if (d < 0) { (*m)[1] -= x * ad; (*m)[0] += x * ad; nOx += x * ad; }
      if (d > 0) { (*m)[0] -= x * d; (*m)[1] += x * d; nRed += x * d; atomicAdd(&wcbe3[CBE3_RED], x * d * ox + ws * ww); }
      left -= x;
      made += x;
    }
  }
  if (nOx > 0) { atomicAdd(&wcbe2[CBE2_OX], nOx); }
  if (nRed > 0) { atomicAdd(&wcbe2[CBE2_RED], nRed); }
  if (nSh > 0) { atomicAdd(&wcbe3[CBE3_SHUT], nSh); }
  if (left > 0) {
    if ((*S)[0] + (*S)[1] + (*S)[2] + (*S)[3] < 2 || why == 0u) { why |= CBL_C; }
    *lim |= why;
  }
  return made;
}

/**
 * Make n chain carbons (hands 1, 1, 1 each: walls, enzymes): from the granules as they are (starch into cellulose: zero energy, the assembly
 * spark from the battery), from sugar-unit-like molecules (cg2t2 -> a chain carbon + a water: a condensation, 0.75 as heat, a spark) or from
 * a formic- + methanol-like or a methane- + CO2-like pair (two chain carbons + two waters). Returns the carbons made.
 */
fn cb_make_chain(n: i32, S: ptr<function, array<i32, 5>>, gr: ptr<function, vec3i>, m: ptr<function, array<i32, 18>>,
                 bat: ptr<function, i32>, heat: ptr<function, i32>, lim: ptr<function, u32>) -> i32 {
  if (n <= 0) { return 0; }
  let sp = max(CBP.e.z, 1);
  let cd = CBP.e.y;
  var left = n;
  var made = 0;
  var why = 0u;
  var x = min(min(left, (*gr).x), min((*gr).y, (*gr).z));
  if (max(*bat, 0) / sp < x) { x = max(*bat, 0) / sp; why |= CBL_BAT; }
  if (x > 0) { *gr -= vec3i(x); *bat -= x * sp; *heat += x * sp; left -= x; made += x; }
  x = min(left, (*S)[2]);
  if (max(*bat, 0) / sp < x) { x = max(*bat, 0) / sp; why |= CBL_BAT; }
  if (x > 0) { (*S)[2] -= x; (*m)[6] += x; *bat -= x * sp; *heat += x * (sp + cd); left -= x; made += x; }
  // pairs whose hands even out to one fuel and one burnt hand a carbon: formic- + methanol-like, methane- + CO2-like (two condensations:
  // the CO2-like carbon is built with here only because the methane-like one brings the fuel hands it lacks)
  for (var q = 0; q < 2; q++) {
    let ja = select(0, 1, q == 0);
    let jb = 4 - ja;
    x = min(left / 2, min((*S)[ja], (*S)[jb]));
    if (max(*bat, 0) / (2 * sp) < x) { x = max(*bat, 0) / (2 * sp); why |= CBL_BAT; }
    if (x > 0) { (*S)[ja] -= x; (*S)[jb] -= x; (*m)[6] += 2 * x; *bat -= 2 * x * sp; *heat += 2 * x * (sp + cd); left -= 2 * x; made += 2 * x; }
  }
  if (left > 0) { *lim |= select(why, CBL_C, why == 0u); }
  return made;
}
/** n cross-linked WALL pairs (hands 3, 1, 1): two chain carbons condensed once more (0.75 as heat, a spark). Returns the pairs made. */
fn cb_make_cross(n: i32, S: ptr<function, array<i32, 5>>, gr: ptr<function, vec3i>, m: ptr<function, array<i32, 18>>,
                 bat: ptr<function, i32>, heat: ptr<function, i32>, lim: ptr<function, u32>) -> i32 {
  if (n <= 0) { return 0; }
  let sp = max(CBP.e.z, 1);
  let c2 = cb_make_chain(2 * n, S, gr, m, bat, heat, lim);
  var x = c2 / 2;
  if (c2 - 2 * x > 0) { *gr += vec3i(1, 1, 1) * (c2 - 2 * x); }   // (an odd chain carbon back into the granules as it is)
  let xb = max(*bat, 0) / sp;
  if (xb < x) { *gr += vec3i(2, 2, 2) * (x - xb); x = xb; *lim |= CBL_BAT; }
  if (x <= 0) { return 0; }
  (*m)[6] += x;
  *bat -= x * sp;
  *heat += x * (sp + CBP.e.y);
  return x;
}

/**
 * OXYGEN DAMAGES MEMBRANES (CBF_OXB; the eat pass): the plan's bites per kind are OXIDATIONS by free t taken from the dish under the cell
 * (the table's OXIDIZE, t + [c-g] -> [c-t] + g, 2.75 as heat at the cell, uncontrolled): oil becomes soap1, soap1 soap2 (they stay in the
 * bilayer: lipid peroxidation, fat -> soap), and a bitten soap2 or wall piece leaves SPOILED into the dish's tar (-> mud). The freed g into
 * the dish (the stock while g does not move). Soap2 first, then soap1, then oil, so no molecule is bitten twice in a tick; the sides from a
 * random first one round. Returns the bites done.
 */
fn cb_bites(want: array<i32, 5>, lpm: ptr<function, array<array<i32, 6>, 5>>, m: ptr<function, array<i32, 18>>, heat: ptr<function, i32>,
            idx: array<u32, 9>, cur: u32, r: u32) -> i32 {
  let tw = want[0] + want[1] + want[2] + want[3] + want[4];
  if (tw <= 0 || cur == 0u || (EP.mask & 2u) == 0u) { return 0; }
  let part = tw / 9;
  var got = 0;
  for (var z = 0; z < 9; z++) { got += take_hb(cur + EP.n + idx[z], select(part, tw - 8 * part, z == 4)); }
  var left = got;
  var done = 0;
  var spoil = 0;
  let k0 = pcg(r) % 6u;
  let order = array<u32, 5>(1u, 0u, 2u, 3u, 4u);
  for (var a = 0u; a < 5u; a++) {
    let q = order[a];
    var x = min(want[q], left);
    for (var j = 0u; j < 6u; j++) {
      if (x <= 0) { break; }
      let k = (k0 + j) % 6u;
      let b = min(x, (*lpm)[q][k]);
      if (b <= 0) { continue; }
      (*lpm)[q][k] -= b;
      if (q == 2u) { (*lpm)[0][k] += b; }
      else if (q == 0u) { (*lpm)[1][k] += b; }
      else {
        cb_spill(cb_lk_hands(q) + vec3i(0, -1, 1), b, idx, true, 0u);   // (one fuel hand burnt, then out as tar)
        spoil += b;
      }
      x -= b;
      left -= b;
      done += b;
    }
  }
  if (left > 0) { spread9(cur + EP.n, idx, left); }   // (the t that found nothing to bite, back where it was)
  if (done > 0) {
    if ((EP.mask & 1u) != 0u) { spread9(cur, idx, done); } else { (*m)[0] += done; }
    *heat += done * CBP.e.x;
    atomicAdd(&wcbe2[CBE2_BITE], done);
    if (spoil > 0) { atomicAdd(&wcbe2[CBE2_SPOIL], spoil); }
  }
  return done;
}

/** The carbon TRANSPORTER's level for cell i (Bio.relay.x, a log factor: e^x, 0 = the founders' 1), as expressed (the channels' output). */
fn cb_trans(i: u32) -> f32 {
  if (!cb_bit(CBF_TRANS)) { return 0.0; }
  return exp(clamp(bio[i].relay.x, -4.0, 2.0)) * select(1.0, gof(i, GRN_O_CHAN), grn_on());
}

/**
 * ENZYMES (CBF_ENZ; the eat pass, before the engines): an engine runs only as far as its enzyme is there. A cell WANTS kEnz carbons per unit
 * of its engines' expressed rates per R^2 of its area, as units of 4 cellulose-like carbons + 1 heavy giver G (catalysis moves electrons:
 * the loosest one of the table, metal-like, as iron in real enzymes). The units WEAR (t.w per s) and are RENEWED in place, the battery paying
 * their assembly sparks again (T1b's upkeep of an expressed engine becomes this turnover); a worn unit the battery cannot renew falls apart
 * into the granules and the stock's G (exact). Short of the want, new units are BUILT (kBuild of the shortfall per s) from chain carbons
 * (cb_make_chain) + a free G from the stock. Returns the share of the want held (the engines' factor).
 */
fn cb_enzymes(i: u32, rates: vec3f, areaR2: f32, m: ptr<function, array<i32, 18>>, bat: ptr<function, i32>, heat: ptr<function, i32>, r: u32) -> f32 {
  if (!cb_bit(CBF_ENZ)) { return 1.0; }
  let o = i * CW;
  let bat0 = *bat;
  var E = atomicLoad(&cbS[o + CB_ENZ]);
  let E0 = E;
  let want = CBP.t.z * (max(rates.x, 0.0) + max(rates.y, 0.0) + max(rates.z, 0.0)) * areaR2 * ATOM_SCALE / 4.0;   // (units)
  // the worn units: RENEWED in place while the battery pays their assembly again (4 carbon sparks a unit, as heat: the turnover's cost);
  // what it cannot pay falls apart into the granules and the stock's G
  let nw = min(i32(floor(f32(E) * min(CBP.t.w * EP.dt, 1.0) + u01(pcg(r)))), E);
  if (nw > 0) {
    let c4 = 4 * max(CBP.e.z, 1);
    let rn = min(nw, max(*bat, 0) / c4);
    if (rn > 0) { *bat -= rn * c4; *heat += rn * c4; }
    let br = nw - rn;
    if (br > 0) { E -= br; cb_gran_add(i, CB_ENZ_H, br); (*m)[3] += br; }
  }
  if (f32(E) < want) {
    var nb = i32(floor((want - f32(E)) * min(CBP.g.y * EP.dt, 1.0) + u01(pcg(r + 0x9e3779b9u))));
    var lim = 0u;
    if (nb > max((*m)[3], 0)) { nb = max((*m)[3], 0); lim |= CBL_G; }
    if (nb > 0) {
      var S: array<i32, 5>;
      var gr = cb_ld(i, &S);
      let c4 = cb_make_chain(4 * nb, &S, &gr, m, bat, heat, &lim);
      let u = c4 / 4;
      if (c4 - 4 * u > 0) { gr += vec3i(1, 1, 1) * (c4 - 4 * u); }
      cb_st(i, &S, gr);
      if (u > 0) { E += u; (*m)[3] -= u; atomicAdd(&wcbe2[CBE2_ENZ], u); }
    }
    cb_lim(i, lim);
  }
  if (E != E0) { atomicStore(&cbS[o + CB_ENZ], E); }
  if (bat0 > *bat) { atomicAdd(&wcbe3[CBE3_ENZ], bat0 - *bat); }
  if (want < 1.0) { return 1.0; }
  return clamp(f32(E) / want, 0.0, 1.0);
}

/**
 * A reset: a founder's enzymes, those of a TYPICAL founder (engine rates summing to 4: the reset runs before the new genomes are written, so
 * it cannot read its own; a founder with fewer engines lets the rest wear into its granules), x u.x, booked as carbon and G in.
 */
fn cb_found_enz(i: u32, r: f32, slot: u32) {
  if (!cb_bit(CBF_ENZ)) { return; }
  let n = i32(round(CBP.t.z * 4.0 * 3.14159265 * r * r / max(EP.R * EP.R, 1e-6) * ATOM_SCALE / 4.0 * clamp(CBP.u.x, 0.0, 4.0)));
  if (n <= 0) { return; }
  atomicAdd(&cbS[i * CW + CB_ENZ], n);
  for (var q = 0u; q < 3u; q++) {
    add64(LG_CB_ADD_C + 128u * (5u + q) + slot, CB_ENZ_H[q] * n);
    add64(LG_CBC_IN + 128u * (5u + q) + slot, CB_ENZ_H[q] * n);
  }
  add64(lg_mc(LG_M_ADD, 3u) + slot, n);   // (its G atoms, booked as added)
}

/** The ledger pass: the parts' carbon (membranes, walls, pigment, glue, enzymes) into the cells' carbon books; the second census. */
fn cb_ledger_parts(i: u32, live: bool) {
  let slot = i & 63u;
  let s16 = i & 15u;
  var hm = vec3i(0);
  var hw = vec3i(0);
  var hp = vec3i(0);
  var glue = 0;
  if (cb_lip()) {
    for (var q = 0u; q < 5u; q++) {
      var n = 0;
      for (var k = 0u; k < 6u; k++) { n += max(atomicLoad(&stock[i * SW + lpw(q, k)]), 0); }
      if (q < 3u) { hm += cb_lk_hands(q) * n; } else { hw += cb_lk_hands(q) * n; }
    }
    hp = CB_PIG_H * max(atomicLoad(&stock[i * SW + W_PIG]), 0);
    for (var k = 0u; k < 12u; k++) { glue += max(atomicLoad(&stock[i * SW + MB_L0 + k]), 0); }
  }
  let ne = max(atomicLoad(&cbS[i * CW + CB_ENZ]), 0);
  let he = CB_ENZ_H * ne;
  let h = hm + hw + hp + he;
  for (var w = 0u; w < 3u; w++) { if (h[w] != 0) { add64(LG_CBC_STOCK + 128u * (5u + w) + slot, h[w]); } }
  if (glue != 0) { add64(LG_CBC_STOCK + 128u * 2u + slot, glue); }
  let lim = u32(atomicExchange(&cbS[i * CW + CB_LIM], 0));
  if (!live) { return; }
  let cK = 1000.0 / (4.0 * ATOM_SCALE);   // (hand counts -> carbons x 1000)
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_MEMB + s16], i32(round(f32(2 * hm.x + hm.y + hm.z) * cK)));
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_WALL + s16], i32(round(f32(2 * hw.x + hw.y + hw.z) * cK)));
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_PIG + s16], i32(round(f32(2 * hp.x + hp.y + hp.z) * cK)));
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_GLUE + s16], i32(round(f32(glue) * 1000.0 / ATOM_SCALE)));
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_ENZ + s16], i32(round(f32(4 * ne) * 1000.0 / ATOM_SCALE)));
  if ((lim & CBL_C) != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_LC + s16], 1); }
  if ((lim & CBL_G) != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_LG + s16], 1); }
  if ((lim & CBL_TR) != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_LTR + s16], 1); }
  if ((lim & CBL_AT) != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_LAT + s16], 1); }
  if ((lim & CBL_BAT) != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_LBAT + s16], 1); }
  if (lim != 0u) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_ANY + s16], 1); }
  atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_TRANS + s16], i32(round(cb_trans(i) * 1000.0)));
  if (cb_bit(CBF_ENZ)) {
    let b = bio[i];
    let rr = max(b.rate.x, 0.0) + max(b.rate.y, 0.0) + max(b.rate.z, 0.0);
    let r = cells[i].r;
    let want = CBP.t.z * rr * 3.14159265 * r * r / max(EP.R * EP.R, 1e-6);   // (carbon units, at the genes' rates)
    atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_EWANT + s16], i32(round(want * 1000.0)));
    if (f32(4 * ne) / ATOM_SCALE < 0.5 * want) { atomicAdd(&hb[LG_CBC_CEN2 + 16u * CBY_ESHORT + s16], 1); }
  }
}

// ===== end of cell_carbon.wgsl =====
