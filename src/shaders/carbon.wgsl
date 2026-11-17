// ===== carbon.wgsl: step C15a, CARBON IN THE OPEN DISH (src/carbon.js; README "Step C15a: carbon in the open dish") =====
// Not compiled on its own: src/matter.js appends it to matter.wgsl (when carbon is on), so it shares the matter's bindings (MP, T,
// SP, LP, CP, hb, mg) and helpers (mpcg, u01, add64, add64v, edge_flow, adv_up, psi_at, spring_d, light_here), plus its own
// uniform CB (binding 7) and, for paint, two textures of its own (group 1, bindings 4 and 5).
//
// The carbon's blocks (in `mg`, behind the oil's): the LADDER's 5 channels (cg4 cg3t cg2t2 cgt3 ct4: channel j has 4 - j giver hands
// and j taker hands) in two copies (ping-pong, as every mobile substance: T.csrc, T.cdst), then TAR's 3 hand counts (cc, cg, ct; one
// copy at T.ctar: tar does not move). Whole counts (ATOM_SCALE per unit), so every move and every reaction is exact.
//   carbon_spread  one substep: the ladder spreads (the matter's edge rule, the currents), leaves at the dish's rim, drips from springs
//   carbon_react   once per tick, after the main table's react, in the copies they leave: OXIDIZE, CONDENSE, DISSOLVE / SETTLE by
//                  heat; the light the main absorbers left: REDUCE and HYDROLYZE (hard), the hands' glow and warmth
//   carbon_count   the carbon in one copy (exact, 64-bit) into the ledger (DISH, or GONE on a wash or a resize)
//   carbon_paint   the amounts the drawing shows (matter_draw.wgsl texE, texF)

// the carbon's ledger (heat_common.wgsl's words 32256 .. 38399; src/carbon.js LG_CB)
const LG_CB_ADD: u32 = 32256u;     // per channel (8), 64-bit, 64 slots: added by springs
const LG_CB_LOST: u32 = 33280u;    // ... left at the dish's rim
const LG_CB_GONE: u32 = 34304u;    // ... washed out, dropped with the old grid on a resize
const LG_CB_DISH: u32 = 35328u;    // ... snapshot: in the dish now
const LG_CB_RX: u32 = 36352u;      // 8 types (RX_TYPES in src/carbon.js): events, counts
const LG_CB_LIGHT: u32 = 37376u;   // 4 bands: light caught by carbon (heat counts; a glow books only its photon's rest)
const LG_CB_GLOW: u32 = 37888u;    // the light carbon gave off as fluorescence (heat counts)
const LG_CB_HEAT: u32 = 38016u;    // the heat carbon's reactions put down (heat counts): its own energy book (src/carbon.js)
const LG_CB_GT: u32 = 38144u;      // the water (gt) carbon's reactions made, net (counts; condense +, hydrolyze -)

struct CarbonP {
  cfg: vec4u,      // x rules: 1 oxidize, 2 condense, 4 photochemistry (reduce, hydrolyze), 8 dissolve and settle, 16 light on;
                   // y what paint shows (0 nothing, 1 all, 2 one alone); z which (0..4 a ladder channel, 5 tar); w spare
  k: vec4f,        // x the ladder's spreading per substep; y the carbon spark (energy units); z kOx, w kCond (R^2 per s)
  k2: vec4f,       // x kDis (per s); y kSet (R^2 per s); z kAbs (depth per hand per R^2); w dark (warm depth per c-c bond per R^2)
  y: vec4f,        // x REDUCE's share of a c-t excitation (0: off); y the share of the rest that fluoresces; z HYDROLYZE's share
  e: vec4i,        // x OXIDIZE's release, y CONDENSE's (heat counts per event)
  ph: vec4f,       // a photon's heat counts per band (warm, visible 1, visible 2, hard)
  em: vec4u,       // x, y the band a c-g, a c-t hand emits when it glows + 1 (0 none); z the water's channel (gt)
  amt: array<vec4f, 32>,   // per spring k: [2k] = cg4 .. cgt3, [2k + 1].x = ct4 (counts per tick over its pixels)
};
@group(0) @binding(7) var<uniform> CB: CarbonP;

fn cb_gH(j: u32) -> i32 { return 4 - i32(j); }
fn cb_tH(j: u32) -> i32 { return i32(j); }
fn cb_pair(a: f32, b: f32) -> f32 { return a * b / max(a + b, 1e-12); }
fn cb_powi(x: f32, k: i32) -> f32 { var r = 1.0; for (var j = 0; j < k; j++) { r *= x; } return r; }
fn cb_binom(k: i32) -> f32 { return select(select(4.0, 6.0, k == 2), 1.0, k == 0 || k == 4); }

// ---------- carbon_spread ----------
var<workgroup> cwl: array<atomic<i32>, 5>;
var<workgroup> cwa: array<atomic<i32>, 5>;

@compute @workgroup_size(16, 4)
fn carbon_spread(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
                 @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let first = T.first != 0u;
  if (id.x < MP.hw && id.y < MP.hh) {
    let i = id.y * MP.hw + id.x;
    let hasL = id.x > 0u;
    let hasR = id.x + 1u < MP.hw;
    let hasU = id.y > 0u;
    let hasD = id.y + 1u < MP.hh;
    let nEdges = select(0, 1, hasL) + select(0, 1, hasR) + select(0, 1, hasU) + select(0, 1, hasD);
    let rim = nEdges < 4;
    let salt = 0x3c6ef372u;
    let eL = mpcg((2u * (i - 1u)) ^ T.seed ^ salt);
    let eR = mpcg((2u * i) ^ T.seed ^ salt);
    let eU = mpcg((2u * (i - MP.hw) + 1u) ^ T.seed ^ salt);
    let eD = mpcg((2u * i + 1u) ^ T.seed ^ salt);
    let eI = mpcg(i ^ T.seed ^ 0x1f83d9abu);
    var drip = 0u;
    if (first) {
      for (var k = 0u; k < min(T.count, 16u); k++) {
        let sp = SP.s[k].pos;
        if (spring_d((vec2f(id.xy) + 0.5) * MP.px, SP.s[k]) <= max(sp.z, 0.75 * MP.px)) { drip |= 1u << k; }
      }
    }
    // the currents (the matter's: the same corners, the same expression)
    var aE = vec4f(0.0);
    if (MP.n1.y != 0u) {
      let sc = bitcast<f32>(MP.n1.z);
      let p00 = psi_at(id.x, id.y);
      let p10 = psi_at(id.x + 1u, id.y);
      let p01 = psi_at(id.x, id.y + 1u);
      let p11 = psi_at(id.x + 1u, id.y + 1u);
      aE = vec4f(-(p01 - p00) * sc, -(p11 - p10) * sc, (p10 - p00) * sc, (p11 - p01) * sc);
      aE = clamp(aE, vec4f(-DRIFT_MAX), vec4f(DRIFT_MAX));
    }
    let os = MP.chg.w;
    let atOut = (os == 1u && !hasR) || (os == 2u && !hasL) || (os == 3u && !hasD) || (os == 4u && !hasU);
    let esh = select(MP.edge, max(MP.edge, MP.sea.w), atOut);
    let k = CB.k.x;
    for (var c = 0u; c < 5u; c++) {
      let s0 = T.csrc + c * MP.n;
      let m = mg[s0 + i];
      var acc = m;
      let cs = (c + 40u) * 0x9e3779b9u;
      if (k > 0.0) {
        if (hasL) { acc -= edge_flow(mg[s0 + i - 1u], m, k, aE.x, u01(mpcg(eL + cs))); }
        if (hasR) { acc += edge_flow(m, mg[s0 + i + 1u], k, aE.y, u01(mpcg(eR + cs))); }
        if (hasU) { acc -= edge_flow(mg[s0 + i - MP.hw], m, k, aE.z, u01(mpcg(eU + cs))); }
        if (hasD) { acc += edge_flow(m, mg[s0 + i + MP.hw], k, aE.w, u01(mpcg(eD + cs))); }
      }
      if (first && rim && m > 0 && esh > 0.0) {
        let out = clamp(i32(floor(f32(m) * esh + u01(mpcg(eI + cs)))), 0, m - nEdges * (m >> 2u));
        acc -= out;
        if (out != 0) { atomicAdd(&cwl[c], out); }
      }
      if (drip != 0u) {
        var add = 0;
        for (var q = 0u; q < 16u; q++) {
          if ((drip & (1u << q)) == 0u) { continue; }
          let a = CB.amt[2u * q + c / 4u][c % 4u] / max(SP.s[q].amt[4].w, 1.0);
          if (a > 0.0) { add += i32(floor(a + u01(mpcg(eI + c * 0x85ebca6bu + q * 0x27d4eb2fu + 0x2545f491u)))); }
        }
        acc += add;
        if (add != 0) { atomicAdd(&cwa[c], add); }
      }
      mg[T.cdst + c * MP.n + i] = acc;
    }
  }
  workgroupBarrier();
  let slot = (wid.y * nw.x + wid.x) & 63u;
  if (first && li < 5u) {
    add64(LG_CB_LOST + 128u * li + slot, atomicLoad(&cwl[li]));
    add64(LG_CB_ADD + 128u * li + slot, atomicLoad(&cwa[li]));
  }
}

// ---------- the light carbon catches ----------
// The depth of the main table's absorbers per band in pixel i of the matter copy o (as react and paint work it out), so the carbon
// takes what they leave: et x exp(-their depth) reaches it, and it catches 1 - exp(-its own depth) of that
fn cb_main_tau(o: u32, i: u32) -> vec4f {
  var m: array<i32, 16>;
  for (var c = 0u; c < 16u; c++) { m[c] = max(mg[o + c * MP.n + i], 0); }
  var tsum = vec4f(0.0);
  for (var r = 0u; r < CP.nrx; r++) {
    let R = CP.rx[r];
    if (R.by != 1u) { continue; }
    var amt = f32(m[R.ch.x]) * MP.conc;
    if (R.ch.y != NONE) { let b = f32(m[R.ch.y]) * MP.conc; amt = amt * b / max(amt + b, 1e-12); }
    tsum[R.band] += R.k * amt;
  }
  for (var c = 0u; c < 16u; c++) { tsum.x += CP.dark[c / 4u][c % 4u] * f32(m[c]) * MP.conc; }
  return tsum;
}

struct CbLight {
  caught: vec4f,   // heat counts per tick caught by the carbon per band
  tau: vec4f,      // the carbon's depth per band
  red: f32,        // hard: REDUCE's depth (c-t hands with g)
  ctl: f32,        // hard: the c-t hands' own (glow and heat)
  hyd: f32,        // hard: HYDROLYZE's (the water with c-c bonds)
};
// CG, CT: the pixel's c-g and c-t hands (counts), cc its c-c bonds, g and gt the free givers and the water there (counts)
fn cb_light(id: vec2u, mo: u32, CG: f32, CT: f32, cc: f32, g: f32, gt: f32) -> CbLight {
  var L: CbLight;
  L.caught = vec4f(0.0); L.tau = vec4f(0.0); L.red = 0.0; L.ctl = 0.0; L.hyd = 0.0;
  if ((CB.cfg.x & 16u) == 0u) { return L; }
  let et = light_here(id);
  if (!any(et > vec4f(0.0))) { return L; }
  let i = id.y * MP.hw + id.x;
  let ec = et * exp(-cb_main_tau(mo, i));
  let cn = MP.conc;
  let kA = CB.k2.z;
  L.red = kA * CB.y.x * cb_pair(CT * cn, g * cn);
  L.ctl = kA * (1.0 - CB.y.x) * CT * cn;
  L.hyd = kA * CB.y.z * cb_pair(gt * cn, cc * cn);
  L.tau = vec4f(CB.k2.w * cc * cn, kA * CG * cn, 0.0, L.red + L.ctl + L.hyd);
  L.caught = ec * (1.0 - exp(-L.tau));
  return L;
}

// ---------- carbon_react ----------
var<workgroup> cwx: array<atomic<i32>, 8>;
var<workgroup> cwlit: array<atomic<i32>, 4>;
var<workgroup> cwgl: atomic<i32>;
var<workgroup> cwht: atomic<i32>;
var<workgroup> cwgt: atomic<i32>;

@compute @workgroup_size(8, 8)
fn carbon_react(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32,
                @builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  if (id.x < MP.hw && id.y < MP.hh) {
    let i = id.y * MP.hw + id.x;
    let n = MP.n;
    let lo = T.cdst;   // the ladder after this tick's spreading
    let to = T.ctar;
    let mo = T.dst;    // the main grid after this tick's spreading and reactions
    var S: array<i32, 5>;
    var S0: array<i32, 5>;
    var stuff = 0;
    for (var j = 0u; j < 5u; j++) { S[j] = mg[lo + j * n + i]; S0[j] = S[j]; stuff += S[j]; }
    var cc = mg[to + i];
    var cg = mg[to + n + i];
    var ct = mg[to + 2u * n + i];
    let tar0 = vec3i(cc, cg, ct);
    stuff += cc + cg + ct;
    if (stuff > 0) {
      let gc = CB.em.z;
      var g = mg[mo + i];
      var t = mg[mo + n + i];
      var gt = mg[mo + gc * n + i];
      let m0 = vec3i(g, t, gt);
      let conc = MP.conc;
      let temp = max(f32(mg[T.heat + i]) * CP.tempScale, 1e-4);
      var sc = 1.0;
      if (CP.traceOn != 0u) { sc = 1.0 / (1.0 + CP.traceK * f32(mg[mo + CP.trace * n + i]) * conc); }
      let fs = exp(-CB.k.y * sc / (CP.theta * temp));
      let rs = mpcg(i ^ T.seed ^ 0x6c8e9cf5u);
      var heat = 0;
      var lit = vec4i(0);
      var ev: array<i32, 8>;
      var glowE = 0;
      let rules = CB.cfg.x;
      var rk = 0u;   // the random stream's index

      // OXIDIZE: t + [c-g] -> [c-t] + g (by heat)
      if ((rules & 1u) != 0u && t > 0 && fs > 0.0) {
        let kx = CB.k.z * f32(t) * conc * fs * CP.dt;
        for (var j = 0u; j < 4u; j++) {
          rk += 1u;
          if (S[j] <= 0 || t <= 0) { continue; }
          let nn = min(i32(floor(kx * f32(cb_gH(j)) * f32(S[j]) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(S[j], t));
          if (nn <= 0) { continue; }
          S[j] -= nn; S[j + 1u] += nn; t -= nn; g += nn; heat += nn * CB.e.x; ev[0] += nn;
        }
        rk += 1u;
        if (cg > 0 && t > 0) {
          let nn = min(i32(floor(kx * f32(cg) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(cg, t));
          if (nn > 0) { cg -= nn; ct += nn; t -= nn; g += nn; heat += nn * CB.e.x; ev[0] += nn; }
        }
      }

      // CONDENSE: [c-g] + [c-t] -> [c-c] + gt (by heat); the two carbons go into tar
      if ((rules & 2u) != 0u && fs > 0.0) {
        let kc = CB.k.w * conc * fs * CP.dt;
        // a ladder molecule's g-hand with another's t-hand
        for (var a = 0u; a < 4u; a++) {
          for (var b = 1u; b < 5u; b++) {
            rk += 1u;
            if (S[a] <= 0 || S[b] <= 0) { continue; }
            let x = kc * f32(cb_gH(a)) * f32(S[a]) * f32(cb_tH(b)) * f32(S[b]);
            var nn = i32(floor(x + u01(mpcg(rs + rk * 0x9e3779b9u))));
            if (a == b) { nn = min(nn, S[a] / 2); } else { nn = min(nn, min(S[a], S[b])); }
            if (nn <= 0) { continue; }
            S[a] -= nn; S[b] -= nn;
            cc += nn; cg += nn * (cb_gH(a) - 1 + cb_gH(b)); ct += nn * (cb_tH(a) + cb_tH(b) - 1);
            gt += nn; heat += nn * CB.e.y; ev[1] += nn;
          }
        }
        // a ladder molecule's g-hand with tar's t-hand, and tar's g-hand with a molecule's t-hand
        for (var a = 0u; a < 4u; a++) {
          rk += 1u;
          if (S[a] <= 0 || ct <= 0) { continue; }
          let nn = min(i32(floor(kc * f32(cb_gH(a)) * f32(S[a]) * f32(ct) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(S[a], ct));
          if (nn <= 0) { continue; }
          S[a] -= nn; ct -= nn; cc += nn; cg += nn * (cb_gH(a) - 1); ct += nn * cb_tH(a);
          gt += nn; heat += nn * CB.e.y; ev[1] += nn;
        }
        for (var b = 1u; b < 5u; b++) {
          rk += 1u;
          if (S[b] <= 0 || cg <= 0) { continue; }
          let nn = min(i32(floor(kc * f32(cg) * f32(cb_tH(b)) * f32(S[b]) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(S[b], cg));
          if (nn <= 0) { continue; }
          S[b] -= nn; cg -= nn; cc += nn; cg += nn * cb_gH(b); ct += nn * (cb_tH(b) - 1);
          gt += nn; heat += nn * CB.e.y; ev[1] += nn;
        }
        // tar with itself (cross-linking)
        rk += 1u;
        if (cg > 0 && ct > 0) {
          let nn = min(i32(floor(kc * f32(cg) * f32(ct) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(cg, ct));
          if (nn > 0) { cg -= nn; ct -= nn; cc += nn; gt += nn; heat += nn * CB.e.y; ev[1] += nn; }
        }
      }

      // DISSOLVE (loose tar carbons leave as ladder molecules) and SETTLE (molecules stick to tar): zero energy
      if ((rules & 8u) != 0u) {
        let C4 = 2 * cc + cg + ct;
        rk += 1u;
        if (C4 > 0 && cg + ct > 0) {
          let p = f32(2 * cc) / f32(C4);
          let lp = (1.0 - p) * (1.0 - p);
          let loose = 0.25 * f32(C4) * lp * lp;
          var rem = min(i32(floor(CB.k2.x * loose * CP.dt + u01(mpcg(rs + rk * 0x9e3779b9u)))), (cg + ct) / 4);
          if (rem > 0) {
            // which molecule each carbon leaves as: k of its 4 hands givers, binomial in the tar's giver share q
            let q = f32(cg) / f32(cg + ct);
            var pr = 1.0;
            for (var kk = 4; kk >= 0; kk--) {
              rk += 1u;
              if (rem <= 0) { break; }
              let gk = kk;
              let tk = 4 - kk;
              let pk = cb_binom(kk) * cb_powi(q, gk) * cb_powi(1.0 - q, tk);
              var take = rem;
              if (kk > 0 && pr > 1e-9) { take = i32(floor(f32(rem) * clamp(pk / pr, 0.0, 1.0) + u01(mpcg(rs + rk * 0x9e3779b9u)))); }
              if (gk > 0) { take = min(take, cg / gk); }
              if (tk > 0) { take = min(take, ct / tk); }
              take = max(take, 0);
              pr -= pk;
              if (take <= 0) { continue; }
              S[u32(4 - kk)] += take; cg -= gk * take; ct -= tk * take; rem -= take; ev[4] += take;
            }
          }
        }
        let tarC = 0.25 * f32(2 * cc + cg + ct) * conc;
        if (tarC > 0.0) {
          for (var j = 0u; j < 5u; j++) {
            rk += 1u;
            if (S[j] <= 0) { continue; }
            let nn = min(i32(floor(CB.k2.y * f32(S[j]) * tarC * CP.dt + u01(mpcg(rs + rk * 0x9e3779b9u)))), S[j]);
            if (nn <= 0) { continue; }
            S[j] -= nn; cg += nn * cb_gH(j); ct += nn * cb_tH(j); ev[5] += nn;
          }
        }
      }

      // LIGHT: what the main absorbers left, caught by the hands (their gaps), then REDUCE, HYDROLYZE, glow and heat
      var CG = cg;
      var CT = ct;
      for (var j = 0u; j < 5u; j++) { CG += cb_gH(j) * S[j]; CT += cb_tH(j) * S[j]; }
      let L = cb_light(id.xy, mo, f32(CG), f32(CT), f32(cc), f32(g), f32(gt));
      if (any(L.caught > vec4f(0.0))) {
        let yF = CB.y.y;
        // warm: the c-c bonds are dark, the light they catch is heat
        rk += 1u;
        let qw = i32(floor(L.caught.x + u01(mpcg(rs + rk * 0x9e3779b9u))));
        if (qw > 0) { heat += qw; lit.x += qw; ev[7] += qw; }
        // visible 1: the c-g hands are excited; no reaction is open to them: they glow (emit the next band down) or warm
        if (L.caught.y > 0.0) {
          let ex = L.caught.y / CB.ph.y;
          let e16 = select(0, i32(CB.ph[max(CB.em.x, 1u) - 1u]), CB.em.x > 0u);
          rk += 1u;
          let ng = i32(floor(ex * yF + u01(mpcg(rs + rk * 0x9e3779b9u))));
          rk += 1u;
          let nd = i32(floor(ex * (1.0 - yF) + u01(mpcg(rs + rk * 0x9e3779b9u))));
          let h = max(ng, 0) * (i32(CB.ph.y) - e16) + max(nd, 0) * i32(CB.ph.y);
          heat += h; lit.y += h; ev[6] += max(ng, 0); ev[7] += max(nd, 0);
          if (CB.em.x >= 2u) { glowE += max(ng, 0) * e16; }
        }
        // hard: the c-t hands (REDUCE where g is; else glow or heat) and the water next to c-c bonds (HYDROLYZE)
        if (L.caught.w > 0.0 && L.tau.w > 0.0) {
          let ph = i32(CB.ph.w);
          let per = L.caught.w / L.tau.w / CB.ph.w;   // events per unit of depth
          if (L.red > 0.0 && CT > 0) {
            let xr = per * L.red / f32(CT);
            for (var j = 1u; j < 5u; j++) {
              rk += 1u;
              if (S[j] <= 0 || g <= 0) { continue; }
              let nn = min(i32(floor(xr * f32(cb_tH(j) * S[j]) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(S[j], g));
              if (nn <= 0) { continue; }
              S[j] -= nn; S[j - 1u] += nn; g -= nn; t += nn; heat += nn * (ph - CB.e.x); lit.w += nn * ph; ev[2] += nn;
            }
            rk += 1u;
            if (ct > 0 && g > 0) {
              let nn = min(i32(floor(xr * f32(ct) + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(ct, g));
              if (nn > 0) { ct -= nn; cg += nn; g -= nn; t += nn; heat += nn * (ph - CB.e.x); lit.w += nn * ph; ev[2] += nn; }
            }
          }
          if (L.hyd > 0.0) {
            rk += 1u;
            let nn = min(i32(floor(per * L.hyd + u01(mpcg(rs + rk * 0x9e3779b9u)))), min(gt, cc));
            if (nn > 0) { gt -= nn; cc -= nn; cg += nn; ct += nn; heat += nn * (ph - CB.e.y); lit.w += nn * ph; ev[3] += nn; }
          }
          if (L.ctl > 0.0) {
            let ex = per * L.ctl;
            let e16 = select(0, i32(CB.ph[max(CB.em.y, 1u) - 1u]), CB.em.y > 0u);
            rk += 1u;
            let ng = max(i32(floor(ex * yF + u01(mpcg(rs + rk * 0x9e3779b9u)))), 0);
            rk += 1u;
            let nd = max(i32(floor(ex * (1.0 - yF) + u01(mpcg(rs + rk * 0x9e3779b9u)))), 0);
            let h = ng * (ph - e16) + nd * ph;
            heat += h; lit.w += h; ev[6] += ng; ev[7] += nd;
            if (CB.em.y >= 2u) { glowE += ng * e16; }
          }
        }
      }

      for (var j = 0u; j < 5u; j++) { if (S[j] != S0[j]) { mg[lo + j * n + i] = S[j]; } }
      if (cc != tar0.x) { mg[to + i] = cc; }
      if (cg != tar0.y) { mg[to + n + i] = cg; }
      if (ct != tar0.z) { mg[to + 2u * n + i] = ct; }
      if (g != m0.x) { mg[mo + i] = g; }
      if (t != m0.y) { mg[mo + n + i] = t; }
      if (gt != m0.z) { mg[mo + gc * n + i] = gt; }
      if (heat != 0) { mg[i] += heat; }   // the delta (heat_common.wgsl), taken in by the heat's next spreading substep
      for (var q = 0u; q < 8u; q++) { if (ev[q] != 0) { atomicAdd(&cwx[q], ev[q]); } }
      for (var b = 0u; b < 4u; b++) { if (lit[b] != 0) { atomicAdd(&cwlit[b], lit[b]); } }
      if (glowE != 0) { atomicAdd(&cwgl, glowE); }
      if (heat != 0) { atomicAdd(&cwht, heat); }
      if (gt != m0.z) { atomicAdd(&cwgt, gt - m0.z); }
    }
  }
  workgroupBarrier();
  let slot = (wid.y * nw.x + wid.x) & 63u;
  if (li < 8u) {
    add64(LG_CB_RX + 128u * li + slot, atomicLoad(&cwx[li]));
  } else if (li < 12u) {
    add64(LG_CB_LIGHT + 128u * (li - 8u) + slot, atomicLoad(&cwlit[li - 8u]));
  } else if (li == 12u) {
    add64(LG_CB_GLOW + slot, atomicLoad(&cwgl));
  } else if (li == 13u) {
    add64(LG_CB_HEAT + slot, atomicLoad(&cwht));
  } else if (li == 14u) {
    add64(LG_CB_GT + slot, atomicLoad(&cwgt));
  }
}

// ---------- carbon_count ----------
var<workgroup> cwlo: array<atomic<u32>, 8>;
var<workgroup> cwhi: array<atomic<u32>, 8>;

// dispatched as 256 workgroups of 256 (a grid-stride loop over the pixels), as count
@compute @workgroup_size(256)
fn carbon_count(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32,
                @builtin(workgroup_id) wid: vec3u) {
  var lo: array<u32, 8>;
  var hi: array<u32, 8>;
  for (var p = gid.x; p < T.count; p += 65536u) {
    for (var c = 0u; c < 8u; c++) {
      let o = select(T.ctar + (c - 5u) * T.count, T.csrc + c * T.count, c < 5u);
      let m = max(mg[o + p], 0);
      if (m == 0) { continue; }
      lo[c] += u32(m) & 0xffffu;
      hi[c] += u32(m) >> 16u;
    }
  }
  for (var c = 0u; c < 8u; c++) {
    if (lo[c] != 0u) { atomicAdd(&cwlo[c], lo[c]); }
    if (hi[c] != 0u) { atomicAdd(&cwhi[c], hi[c]); }
  }
  workgroupBarrier();
  if (li < 8u) {
    let L = atomicLoad(&cwlo[li]);
    let H = atomicLoad(&cwhi[li]);
    let reg = select(LG_CB_DISH, LG_CB_GONE, T.region == LG_M_GONE);
    let at = reg + 128u * li + (wid.x & 63u);
    add64v(at, i32(H >> 16u), H << 16u);
    add64v(at, 0, L);
  }
}

// ---------- carbon_paint ----------
// texE: the ladder's molecules per R^2, its burnt hands / 4 per R^2 (so y / x = how burnt), the light it re-emits in visible 2 per
// tick (heat counts: the c-t hands' sky blue glow), spare.  texF: tar's carbons, fuel hands, burnt hands, c-c bonds per R^2.
@group(1) @binding(4) var cTexE: texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var cTexF: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn carbon_paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= MP.hw || id.y >= MP.hh) { return; }
  let i = id.y * MP.hw + id.x;
  let n = MP.n;
  let show = CB.cfg.y;
  let one = CB.cfg.z;
  var e = vec4f(0.0);
  var f = vec4f(0.0);
  var CG = 0.0;
  var CT = 0.0;
  for (var j = 0u; j < 5u; j++) {
    let v = f32(max(mg[T.csrc + j * n + i], 0));
    CG += f32(cb_gH(j)) * v;
    CT += f32(cb_tH(j)) * v;
    if (show == 1u || (show == 2u && one == j)) { e.x += v * MP.conc; e.y += 0.25 * f32(cb_tH(j)) * v * MP.conc; }
  }
  let cc = f32(max(mg[T.ctar + i], 0));
  let cg = f32(max(mg[T.ctar + n + i], 0));
  let ct = f32(max(mg[T.ctar + 2u * n + i], 0));
  CG += cg;
  CT += ct;
  if (show == 1u || (show == 2u && one == 5u)) {
    f = vec4f(0.25 * (2.0 * cc + cg + ct), cg, ct, cc) * MP.conc;
  }
  // the c-t hands' glow (visible 2), as react works out the light (from the current copies)
  if (show != 0u && CB.em.y >= 2u && CT > 0.0 && CB.y.y > 0.0) {
    let g = f32(max(mg[T.src + i], 0));
    let gt = f32(max(mg[T.src + CB.em.z * n + i], 0));
    let L = cb_light(id.xy, T.src, CG, CT, cc, g, gt);
    if (L.caught.w > 0.0 && L.tau.w > 0.0) {
      e.z = L.caught.w * L.ctl / L.tau.w * CB.y.y * CB.ph[CB.em.y - 1u] / CB.ph.w;
    }
  }
  textureStore(cTexE, vec2i(id.xy), min(e, vec4f(60000.0)));
  textureStore(cTexF, vec2i(id.xy), min(f, vec4f(60000.0)));
}

// ===== end of carbon.wgsl =====
