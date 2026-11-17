// ===== cell_carbon.wgsl: step C15b, CELLS EAT CARBON (src/carboncells.js; README "Step C15b: cells eat carbon") =====
// Not compiled on its own: src/eat.js prepends it to cell_eat.wgsl (after cell_common.wgsl), so it shares the eat pass's bindings and
// helpers (S, cells, stock, hb, EP, mg, bio, add64, take_hb, spread9, footprint, sat_f, lnc, eng_index, eng_band, pcg, u01, ...; WGSL
// declarations are order-free), plus its own buffer of CW words per cell (binding 11; a plain view for the plan pass) and uniform (12).
// With carbon off (?carbon=0) CARBON_ON is 0 and none of it runs (the buffer is a stub).
//
// A cell's carbon words: 0..4 its ladder molecules (methane-like cg4 .. CO2-like ct4; channel j has 4 - j giver hands, j taker hands),
// 5..7 its tar GRANULES (backbone bonds c-c, fuel hands c-g, burnt hands c-t), 8..12 the plan's exchange per ladder channel this tick
// (+ in, - out), 13..15 the tar it asks to graze per hand. Whole counts (ATOM_SCALE per unit), as the dish: every move is exact.

struct CbCellP {
  cfg: vec4u,   // x CBF_* bits; y the cells' tick at the matter's tick 0 of this frame; z the matter's substeps per tick; w the carbon copy
                // current at the frame's start (0, 1)
  off: vec4u,   // x copy 0's channel 0 (word in hb), y copy 1's; z the tar's (one copy); w a reset's current copy (0: no grid)
  k: vec4f,     // x the ladder's membrane rate over the light atoms'; y kGraze (per s per unit of the grazing engines' rate); z kDis (per s)
  e: vec4i,     // x OXIDIZE's release (heat counts; REDUCE's rise), y CONDENSE's (HYDROLYZE's rise), z the carbon spark (heat counts), w the
                // smell's weight per giver hand (what a free t releases from it, heat counts)
};
@group(0) @binding(11) var<storage, read_write> cbS: array<atomic<i32>>;
@group(0) @binding(11) var<storage, read_write> cbSP: array<i32>;      // (the plan pass's plain view)
@group(0) @binding(12) var<uniform> CBP: CbCellP;

const CW: u32 = 16u;
const CB_FLUX: u32 = 8u;
const CB_GRAZE: u32 = 13u;
const CBF_ON: u32 = 1u;
const CBF_EXCH: u32 = 2u;
const CBF_ENG: u32 = 4u;
const CBF_GRAZE: u32 = 8u;
const CBF_DIS: u32 = 16u;
const CBF_FLIP: u32 = 32u;
const CBF_RESET: u32 = 64u;
const CBF_SMELL: u32 = 128u;
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
const CBL_GONE: u32 = 34304u;   // the dish's carbon ledger: GONE per channel (carbon.wgsl LG_CB_GONE)
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
  let cc = max(cbSP[o + 5u], 0);
  let cg = max(cbSP[o + 6u], 0);
  let ct = max(cbSP[o + 7u], 0);
  return f32(a) + 0.25 * f32(2 * cc + cg + ct) + f32(cg + ct);
}

/** A cell's carbon back to the dish at the pixels idx (death, burst, a meal's end, a reset); with no grid, booked as gone. */
fn cb_give_back(i: u32, idx: array<u32, 9>, slot: u32) {
  if (CARBON_ON == 0u) { return; }
  let cur = cb_cur();
  for (var w = 0u; w < 8u; w++) {
    let m = atomicExchange(&cbS[i * CW + w], 0);
    if (m <= 0) { continue; }
    add64(LG_CBC_OUT + 128u * w + slot, m);
    if (cur != 0u) { spread9(select(CBP.off.z + (w - 5u) * EP.n, cur + w * EP.n, w < 5u), idx, m); }
    else { add64(CBL_GONE + 128u * w + slot, m); }   // (out of the cells and gone: both books see it)
  }
  for (var w = 8u; w < CW; w++) { atomicStore(&cbS[i * CW + w], 0); }
}

/** A birth: the newborn i takes half its parent's ladder and the share sh of its granules. */
fn cb_split(i: u32, pi: u32, sh: f32) {
  if (CARBON_ON == 0u) { return; }
  for (var w = 0u; w < 8u; w++) {
    let h = atomicLoad(&cbS[pi * CW + w]);
    let want = select(i32(floor(f32(h) * sh)), h / 2, w < 5u);
    let got = take_cb(pi * CW + w, want);
    if (got > 0) { atomicAdd(&cbS[i * CW + w], got); }
  }
}

/** Digestion (P1): the host i takes the share dsh of its meal g's carbon (the rest spills with the meal at the end). */
fn cb_digest(i: u32, g: u32, dsh: f32, r: u32) {
  if (CARBON_ON == 0u) { return; }
  for (var w = 0u; w < 8u; w++) {
    let mv = atomicLoad(&cbS[g * CW + w]);
    if (mv <= 0) { continue; }
    let n = min(mv, i32(floor(f32(mv) * dsh + u01(pcg(r + w * 0x2f6b1e3du)))));
    if (n > 0) { atomicSub(&cbS[g * CW + w], n); atomicAdd(&cbS[i * CW + w], n); }
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
  let pk = pkN * CBP.k.x;
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
  let kg = min(CBP.k.y * gr * EP.dt * freeS, 1.0) * room;
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
struct CbOut { gran: f32, fuel: f32, atoms: f32 };

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

  for (var j = 0u; j < 5u; j++) { if (S[j] != S0[j]) { atomicStore(&cbS[o + j], S[j]); } }
  if (cc != t0.x) { atomicStore(&cbS[o + 5u], cc); }
  if (cg != t0.y) { atomicStore(&cbS[o + 6u], cg); }
  if (ct != t0.z) { atomicStore(&cbS[o + 7u], ct); }
  var out: CbOut;
  out.gran = 0.25 * f32(2 * cc + cg + ct);
  out.fuel = f32(4 * S[0] + 3 * S[1] + 2 * S[2] + S[3]);
  out.atoms = f32(5 * (S[0] + S[1] + S[2] + S[3] + S[4])) + out.gran + f32(cg + ct);
  return out;
}

/** The ledger pass: every slot's carbon (the books count every slot: a free one holds none), and the census of the live cells. */
fn cb_ledger(i: u32, live: bool) {
  if (CARBON_ON == 0u) { return; }
  let slot = i & 63u;
  var lad = 0;
  for (var w = 0u; w < 8u; w++) {
    let v = max(atomicLoad(&cbS[i * CW + w]), 0);
    if (v != 0) { add64(LG_CBC_STOCK + 128u * w + slot, v); }
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
  }
}

// ===== end of cell_carbon.wgsl =====
