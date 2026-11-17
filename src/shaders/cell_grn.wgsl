// ===== cell_grn.wgsl: step T1b, THE GENE REGULATORY NETWORK (src/grn.js; README "Step T1b: gene network") =====
// field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended (src/grn.js). One dispatch per tick, after the cells' step and
// before they eat (src/cells.js), over every slot:
//
//   MUTATION  a cell born this tick (CELL_BORN: the step copied its mother's genome and expression into it) gets its network mutated, at
//             the birth's mutation size (key M, x the hard light dose's extra): every weight, bias and output gain in use nudged a little;
//             now and then one input REWIRED to another source (or cut), one output pointed at another regulator (or switched on or off),
//             the broadcast regulator changed; rarely one regulator DUPLICATED into the least used slot (its bias, inputs and expression
//             copied; each output it drives goes to the copy half the time), so gene families can arise
//   UPDATE    every live cell: x_i <- x_i + dt / tau (sigmoid(b_i + sum_k w_ik src(code_ik)) - x_i), each regulator reading up to three
//             SOURCES: another regulator's expression (as it was at the tick's start) or a SENSE (0..1, or -1..1 for the fields and the
//             swelling), all from what the cell already has: its contacts, the fields its membrane feels, its battery, swelling and
//             integrity (the step's and the eat pass's Cell words), the light, its free t, fuel, linkers, trace and heat (the eat pass's
//             Cell.sns0, sns1, last tick), and the CONTACT SIGNAL: the mean over its touching neighbours of the regulator each broadcasts
//             (Bio.gm.x; last tick's, from the other genome copy), weighted by kinship as far as the gene Bio.gm.y says
//
// The outputs (Bio.gu, Bio.go: cell_common.wgsl GRN_O_*) are read where each gene is read (the step, the eat pass): gene x exp(u x).
// The network moves no matter and no energy: the books are untouched.

struct GrnP {
  flags: u32,       // GF_* bits
  tau: f32,         // the expression's time constant (s)
  press: f32,       // a side touches a neighbour closer than press x the two radii (as the inside's, step T1a)
  wStep: f32,       // a birth's nudge of a weight or bias in use (x the mutation size; Gaussian)
  uStep: f32,       // ... of an output gain in use
  rewire: f32,      // chance per birth that one input is rewired
  orewire: f32,     // ... that one output is pointed elsewhere, switched on or off
  dup: f32,         // ... that one regulator is duplicated into the least used slot
  bjump: f32,       // ... that the broadcast regulator changes
  wNew: f32,        // a new link's weight is drawn from -wNew..wNew (an output's gain likewise, uNew)
  uNew: f32,
  spare: f32,
};

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> bioW: array<Bio>;   // this tick's genome copy (the step wrote it)
@group(0) @binding(3) var<storage, read> bioOld: array<Bio>;       // last tick's (the neighbours' broadcasts, race-free)
@group(0) @binding(4) var<uniform> GP: GrnP;
@group(0) @binding(5) var<uniform> FL: Fields;

const GF_RUN: u32 = 1u;      // the network runs (expression updates, mutation at births)
const GF_SIGNAL: u32 = 2u;   // the contact signal is sensed
const GF_KINW: u32 = 4u;     // ... weighted by kinship as the gene says (else every neighbour alike)
const GF_MUT: u32 = 8u;      // the network mutates at births

// the sources an input can read (its code): 0 none, 1..8 the regulators, 9 + GRN_S_* the senses
const GRN_NSRC: u32 = 25u;        // (23 until step P1's two senses)
const GRN_S_CONTACT: u32 = 0u;   // the share of the six sides pressed against a neighbour (0 alone .. 1 enclosed)
const GRN_S_FELTA: u32 = 1u;     // field A felt, the six sides' mean (-1..1, the C13 guides' s)
const GRN_S_SPREADA: u32 = 2u;   // ... how differently the sides feel it (max - min) / 2 (0..1: the gradient across the cell)
const GRN_S_FELTB: u32 = 3u;     // field B at the cell (-1..1)
const GRN_S_LIGHT: u32 = 4u;     // the light (0..1)
const GRN_S_T: u32 = 5u;         // free t inside (0..1)
const GRN_S_BAT: u32 = 6u;       // the battery (0..1)
const GRN_S_SWELL: u32 = 7u;     // the swelling (-1..1)
const GRN_S_FUEL: u32 = 8u;      // fuel inside (0..1)
const GRN_S_LINK: u32 = 9u;      // free linkers inside (0..1)
const GRN_S_TRACE: u32 = 10u;    // trace (the cofactor it gives, 0..1)
const GRN_S_INTEG: u32 = 11u;    // the membrane's integrity (0..1)
const GRN_S_SIGNAL: u32 = 12u;   // the contact signal (0..1)
const GRN_S_HEAT: u32 = 13u;     // the heat (the temperature over twice the tolerance, 0..1)
const GRN_S_MEAL: u32 = 14u;     // step P1: a MEAL inside (digesting: the share of it still to digest, 1 .. 0; else 0)
const GRN_S_PREY: u32 = 15u;     // step P1: PREY near (1 while a cell it could engulf touches it, or it is wrapping one)
const GRN_NOUT: u32 = 17u;       // outputs (16 until step P1's ENGULF, whose gain and regulator live in Bio.gm.z, gm.w)

fn grn_rand(seed: u32, k: u32) -> f32 { return rand01(seed, k); }

@compute @workgroup_size(64)
fn grn(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count || (GP.flags & GF_RUN) == 0u) { return; }
  let c = cells[i];
  if ((c.flags & CELL_ALIVE) == 0u) { return; }
  var x = array<f32, 8>(bioW[i].gx[0].x, bioW[i].gx[0].y, bioW[i].gx[0].z, bioW[i].gx[0].w,
                        bioW[i].gx[1].x, bioW[i].gx[1].y, bioW[i].gx[1].z, bioW[i].gx[1].w);
  var w: array<f32, 24>;
  var code: array<u32, 24>;
  var bias: array<f32, 8>;
  for (var r = 0u; r < GRN_R; r++) {
    bias[r] = bioW[i].gb[r >> 2u][r & 3u];
    let cw = u32(max(bioW[i].gi[r >> 2u][r & 3u], 0.0));
    for (var k = 0u; k < 3u; k++) {
      let q = 3u * r + k;
      w[q] = bioW[i].gw[q >> 2u][q & 3u];
      code[q] = min((cw >> (5u * k)) & 31u, 31u);
    }
  }

  // ---- a newborn: the network mutates (the step copied her mother's network and expression) ----
  if ((c.flags & CELL_BORN) != 0u && (GP.flags & GF_MUT) != 0u) {
    let mOn = (S.rules & RULE_MUT) != 0u;
    let mom = c.mom & 0x7fffffffu;
    let pdose = select(0.0, cell_dose(cells[min(mom, S.count - 1u)].flags), mom < S.count);
    let hx = select(0.0, min(FL.hm.x * pdose, max(FL.hm.y - 1.0, 0.0)), FL.hm.x > 0.0);
    // (step G1: x the parent's fidelity, as the step's daughter_genome; exactly as before while the gene does not act)
    let pfid = select(0.0, bioW[min(mom, S.count - 1u)].conv.w, mom < S.count);
    let ms = fid_birth(mOn, hx, pfid, FL.hm) * S.mutSize;
    if (ms > 0.0) {
      let bs = pcg(c.seed ^ pcg(S.tick * 0x2545f491u + 0x67726e31u));
      var u: array<f32, 17>;
      var oreg: array<u32, 17>;
      for (var o = 0u; o < 16u; o++) { u[o] = bioW[i].gu[o >> 2u][o & 3u]; oreg[o] = grn_reg(bioW[i].go, o); }
      var gm = bioW[i].gm;
      u[16] = gm.z;                                              // step P1: the ENGULF output
      oreg[16] = min(u32(max(gm.w, 0.0)), 7u);
      // the small steps: weights and output gains in use, every bias
      for (var q = 0u; q < 24u; q++) {
        if (code[q] != 0u && code[q] < GRN_NSRC) { w[q] = clamp(w[q] + ms * GP.wStep * gauss(bs, 300u + q), -GRN_UMAX, GRN_UMAX); }
      }
      for (var r = 0u; r < GRN_R; r++) { bias[r] = clamp(bias[r] + ms * GP.wStep * gauss(bs, 330u + r), -GRN_UMAX, GRN_UMAX); }
      for (var o = 0u; o < GRN_NOUT; o++) {
        if (u[o] != 0.0) { u[o] = clamp(u[o] + ms * GP.uStep * gauss(bs, 340u + o), -GRN_UMAX, GRN_UMAX); }
      }
      // REWIRE an input: another source (1..22), or cut (0) one time in seven; a new link starts at a random weight
      if (grn_rand(bs, 360u) < min(GP.rewire * ms, 1.0)) {
        let q = min(u32(grn_rand(bs, 361u) * 24.0), 23u);
        let v = grn_rand(bs, 362u);
        let nc = select(1u + min(u32(v * 7.0 / 6.0 * f32(GRN_NSRC - 1u)), GRN_NSRC - 2u), 0u, v >= 6.0 / 7.0);
        if (nc == 0u) { w[q] = 0.0; }
        else if (code[q] == 0u || w[q] == 0.0) { w[q] = GP.wNew * (2.0 * grn_rand(bs, 363u) - 1.0); }
        code[q] = nc;
      }
      // an OUTPUT pointed at another regulator (switched on at a random gain if it was off), or switched off one time in five
      if (grn_rand(bs, 365u) < min(GP.orewire * ms, 1.0)) {
        let o = min(u32(grn_rand(bs, 366u) * f32(GRN_NOUT)), GRN_NOUT - 1u);
        if (grn_rand(bs, 367u) < 0.2) { u[o] = 0.0; }
        else {
          oreg[o] = min(u32(grn_rand(bs, 368u) * 8.0), 7u);
          if (u[o] == 0.0) { u[o] = GP.uNew * (2.0 * grn_rand(bs, 369u) - 1.0); }
        }
      }
      // DUPLICATION: regulator a copied into the least used slot b (used = outputs reading it with a gain + inputs reading it with a weight;
      // ties from a random start); each output reading a goes to b half the time
      if (grn_rand(bs, 370u) < min(GP.dup * ms, 1.0)) {
        let a = min(u32(grn_rand(bs, 371u) * 8.0), 7u);
        let r0 = min(u32(grn_rand(bs, 372u) * 8.0), 7u);
        var bb = 8u;
        var best = 1e9;
        for (var t = 0u; t < GRN_R; t++) {
          let r = (r0 + t) & 7u;
          if (r == a) { continue; }
          var used = 0.0;
          for (var o = 0u; o < GRN_NOUT; o++) { if (oreg[o] == r && u[o] != 0.0) { used += 1.0; } }
          for (var q = 0u; q < 24u; q++) { if (code[q] == r + 1u && w[q] != 0.0 && q / 3u != r) { used += 1.0; } }
          if (used < best) { best = used; bb = r; }
        }
        if (bb < 8u) {
          bias[bb] = bias[a];
          x[bb] = x[a];
          for (var k = 0u; k < 3u; k++) { w[3u * bb + k] = w[3u * a + k]; code[3u * bb + k] = select(code[3u * a + k], bb + 1u, code[3u * a + k] == a + 1u); }
          for (var o = 0u; o < GRN_NOUT; o++) { if (oreg[o] == a && grn_rand(bs, 380u + o) < 0.5) { oreg[o] = bb; } }
        }
      }
      // the broadcast regulator now and then another; the kinship weighting drifts
      if (grn_rand(bs, 400u) < min(GP.bjump * ms, 1.0)) { gm.x = f32(min(u32(grn_rand(bs, 401u) * 8.0), 7u)); }
      gm.y = clamp(gm.y + ms * 0.04 * gauss(bs, 402u), 0.0, 1.0);
      // write the genes back (the expression below)
      for (var r = 0u; r < GRN_R; r++) {
        bioW[i].gb[r >> 2u][r & 3u] = bias[r];
        bioW[i].gi[r >> 2u][r & 3u] = f32(code[3u * r] + 32u * code[3u * r + 1u] + 1024u * code[3u * r + 2u]);
      }
      for (var q = 0u; q < 24u; q++) { bioW[i].gw[q >> 2u][q & 3u] = w[q]; }
      for (var o = 0u; o < 16u; o++) { bioW[i].gu[o >> 2u][o & 3u] = u[o]; }
      for (var v = 0u; v < 4u; v++) {
        bioW[i].go[v] = f32(oreg[4u * v] + 8u * oreg[4u * v + 1u] + 64u * oreg[4u * v + 2u] + 512u * oreg[4u * v + 3u]);
      }
      gm.z = u[16];
      gm.w = f32(oreg[16]);
      bioW[i].gm = gm;
    }
  }

  // ---- the senses ----
  var src: array<f32, 32>;
  for (var q = 0u; q < 32u; q++) { src[q] = 0.0; }
  for (var r = 0u; r < GRN_R; r++) { src[1u + r] = x[r]; }
  // contacts and the contact signal (the step's neighbour per side, Cell.nbr)
  var cov = 0.0;
  var sgS = 0.0;
  var sgW = 0.0;
  if (S.count <= NBR_NONE) {
    let sigOn = (GP.flags & GF_SIGNAL) != 0u;
    let kw = select(0.0, clamp(bioW[i].gm.y, 0.0, 1.0), (GP.flags & GF_KINW) != 0u);
    for (var k = 0u; k < 6u; k++) {
      let j = cell_nbr(c, k);
      if (j >= S.count || j == i) { continue; }
      let cj = cells[j];
      if ((cj.flags & CELL_ALIVE) == 0u || distance(cj.pos, c.pos) >= GP.press * (c.r + cj.r)) { continue; }
      cov += 1.0;
      if (sigOn) {
        let bj = u32(max(bioOld[j].gm.x, 0.0)) & 7u;
        let xj = clamp(bioOld[j].gx[bj >> 2u][bj & 3u], 0.0, 1.0);
        var wt = 1.0;
        if (kw > 0.0) {
          let mt = kin_match_m(bioOld[i].mark, bioOld[j].mark, 0.5 * (c.r + cj.r) / S.R);
          wt = mix(1.0, kin_accept(mt, bioOld[i].kin.y), kw);
        }
        sgS += wt * xj;
        sgW += wt;
      }
    }
  }
  let fa = unpack4x8snorm(c.felt[0]);
  let fb = unpack4x8snorm(c.felt[1] & 0xffffffu);
  let lo = min(min(min(fa.x, fa.y), min(fa.z, fa.w)), min(fb.x, fb.y));
  let hi = max(max(max(fa.x, fa.y), max(fa.z, fa.w)), max(fb.x, fb.y));
  var ig = 0.0;
  for (var k = 0u; k < 6u; k++) { ig += clamp(c.integ[k], 0.0, 1.0); }
  let s0 = unpack4x8unorm(c.sns0);
  let s1 = unpack4x8unorm(c.sns1);
  let o = 9u;
  src[o + GRN_S_CONTACT] = cov / 6.0;
  src[o + GRN_S_FELTA] = (fa.x + fa.y + fa.z + fa.w + fb.x + fb.y) / 6.0;
  src[o + GRN_S_SPREADA] = 0.5 * (hi - lo);
  src[o + GRN_S_FELTB] = fb.z;
  src[o + GRN_S_LIGHT] = s0.x;
  src[o + GRN_S_T] = s0.y;
  src[o + GRN_S_BAT] = clamp(c.bat, 0.0, 1.0);
  src[o + GRN_S_SWELL] = clamp(c.osm, -1.0, 1.0);
  src[o + GRN_S_FUEL] = s0.z;
  src[o + GRN_S_LINK] = s0.w;
  src[o + GRN_S_TRACE] = s1.x;
  src[o + GRN_S_INTEG] = ig / 6.0;
  src[o + GRN_S_SIGNAL] = select(0.0, sgS / sgW, sgW > 0.0);
  src[o + GRN_S_HEAT] = s1.y;
  // step P1: a meal inside (the share still to digest) and prey near (the step's Cell.eng)
  src[o + GRN_S_MEAL] = select(0.0, 1.0 - eng_prog(c.eng), eng_mode(c.eng) == ENG_DIGEST);
  src[o + GRN_S_PREY] = select(0.0, 1.0, (c.eng & ENG_NEAR) != 0u);

  // ---- the update: each regulator relaxes toward sigmoid(its input) ----
  let a = clamp(S.dt / max(GP.tau, 1e-3), 0.0, 1.0);
  var xn: array<f32, 8>;
  for (var r = 0u; r < GRN_R; r++) {
    var h = bias[r];
    for (var k = 0u; k < 3u; k++) { let q = 3u * r + k; h += w[q] * src[code[q]]; }
    let t = 1.0 / (1.0 + exp(-clamp(h, -30.0, 30.0)));
    xn[r] = clamp(x[r] + a * (t - x[r]), 0.0, 1.0);
  }
  bioW[i].gx[0] = vec4f(xn[0], xn[1], xn[2], xn[3]);
  bioW[i].gx[1] = vec4f(xn[4], xn[5], xn[6], xn[7]);
}
