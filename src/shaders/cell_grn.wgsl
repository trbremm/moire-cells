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
  // ---- step G3, THE MOIRE GENOME (src/folding.js writeGrn; words 12..39) ----
  g3f: u32,         // G3_* bits below
  sigma: f32,       // the beat's tuning width: two lattices link as exp(-d^2 / (2 sigma^2)), d^2 = 2 cosh(dl) - 2 cos(dtheta)
  wMax: f32,        // a perfect match's weight
  wMin: f32,        // links weaker than this are left out (each regulator keeps its 3 strongest inputs)
  latStep: f32,     // a birth's nudge of a lattice's angle and spacing (x the mutation size; Gaussian)
  phStep: f32,      // ... of its phase (rad)
  jump: f32,        // chance per birth (x the mutation size) that one regulator's lattice is drawn afresh (the old rewiring's counterpart)
  foldStep: f32,    // a birth's nudge of both folds' twist and stretch
  refold: f32,      // chance per birth (x the mutation size) that one fold is drawn afresh: a BIG refold at birth
  twistMax: f32,    // a fold's twist in -twistMax..twistMax (rad)
  stretchMax: f32,  // ... its stretch in -stretchMax..stretchMax
  s0: f32,          // the stress (heat, oxidation) above which a living cell may refold into its stress fold, below which it folds back
  kOn: f32,         // ... per s at full stress (x (S - s0) / (1 - s0))
  kOff: f32,        // ... back home per s when calm (x (s0 - S) / s0)
  heatW: f32,       // the stress S = clamp(heatW x heat + oxW x free t, 0, 1) (the gene network's senses, 0..1)
  oxW: f32,
  doseHeat: f32,    // the damage dose collected per s at heat 1 (Brownian: local heat jitters the lattices)
  doseOx: f32,      // ... at free t 1 (oxidation knocks them)
  doseFade: f32,    // ... and fading by itself per s (the dose a cell carries saturates)
  doseStep: f32,    // at a birth the parent's dose D becomes lattice kicks of size doseStep x D
  repK: f32,        // REPAIR (the G1 fidelity gene): dose removed per s x (e^F - 1) x D, paid from the battery (the eat pass)
  bufCap: f32,      // the BUFFER's capacity at gene 1 (in the hidden drift's units: squared lattice change)
  bufStep: f32,     // a birth's nudge of the buffering gene
  bufWeaken: f32,   // stress weakens the buffer: capacity x max(0, 1 - bufWeaken x S)
  chi: f32,         // a link's weight x cos(phase difference + chi)
  hPhase: f32,      // a phase change counts toward the hidden drift x this
  bufFounder: f32,  // the buffering gene of a cell whose lattices are drawn here (a genome without them)
  spare2: f32,      // (kept free for step Q1: fast regulators)
  // ---- step G3, the toy's hands (src/folding.js writeGrn; words 40..47) ----
  zone: vec4f,      // the REFOLD tool: x y its centre (dish px), z its radius (0: none), w the fold it sets (0 home, 1 stress)
  shock: vec4f,     // the STRESS button: x added to every cell's stress, y x the refold rate; the LINE REFOLD (the zoo, the lab): z the founder
                    // line + 1 whose cells are put into the fold w this frame (-1: every cell; 0: none)
};
const G3_ON: u32 = 1u;          // the moire genome: the links derived from the lattices (off: the free weights and codes of step T1b)
const G3_FOLD: u32 = 2u;        // the fold acts on the lattices' addresses
const G3_FOLDLIFE: u32 = 4u;    // stress refolds a living cell (and calm folds it back)
const G3_FOLDNULL: u32 = 8u;    // the fold's NEUTRAL control: the folds drift and switch, the links always from the home fold
const G3_DOSE: u32 = 16u;       // the damage dose is written into the lattices at a birth
const G3_DOSENULL: u32 = 32u;   // ... its neutral control: collected, never written
const G3_REPAIR: u32 = 64u;     // the fidelity gene repairs the dose (battery-paid)
const G3_BUF: u32 = 128u;       // the buffering gene acts (and drifts)
const G3_BUFNULL: u32 = 256u;   // ... its neutral control: it drifts, the capacity stays 0, nothing paid
const G3_DERALL: u32 = 512u;    // derive every cell's links afresh this frame (a knob changed)
const G3_OUT: u32 = 1024u;      // the OUTPUTS are addressed by lattice too: each reads the regulator whose (folded) lattice best matches its own
                                // fixed one, so a refold also changes WHICH regulator drives each gene (the outputs' gains stay genes)
// step G3: Bio.gs.w, bits 5..9 the refold FLASH still to run (in 3-tick steps; the drawing), bit 10 its kind (1: into the stress fold)
const GS_FLASH_SHIFT: u32 = 5u;
const GS_FLASH_KIND: u32 = 1024u;
const GS_LINE: u32 = 2048u;     // the refolds in the line: the word / GS_LINE
const G3_PI3: f32 = 1.0471975512;

// the 16 senses' fixed lattices (angle, ln wavenumber, phase): a 4 x 4 grid over the regulators' address space, phases a golden angle apart
fn g3_sense(s: u32) -> vec3f {
  return vec3f((f32(s & 3u) + 0.5) * G3_PI3 / 4.0, -0.375 + 0.25 * f32(s >> 2u), f32(s) * 2.3999632);
}
// the 20 outputs' fixed lattices: a 5 x 4 grid set between the senses'
fn g3_out(o: u32) -> vec2f { return vec2f((f32(o % 5u) + 0.5) * G3_PI3 / 5.0, -0.45 + 0.3 * f32(o / 5u)); }
// a lattice's address under a fold (twist, stretch, axis): turned by the twist; its spacing stretched as it faces the axis (six-fold, as the
// lattice itself)
fn g3_addr(th: f32, lk: f32, fold: vec3f) -> vec2f { return vec2f(th + fold.x, lk + fold.y * cos(6.0 * (th - fold.z))); }
// the squared beat between two hex lattices, relative: 2 cosh(dl) - 2 cos(dtheta), the angle difference folded into -pi/6..pi/6
fn g3_d2(a: vec2f, b: vec2f) -> f32 {
  let d = a.x - b.x - G3_PI3 * round((a.x - b.x) / G3_PI3);
  return 2.0 * cosh(clamp(a.y - b.y, -4.0, 4.0)) - 2.0 * cos(d);
}
// DERIVE the network's links from the lattices under a fold: regulator r reads source q (another regulator, or a sense) at the weight
// wMax x exp(-d^2 / (2 sigma^2)) x cos(phase_r - phase_q + chi), keeping its 3 strongest (|w| >= wMin; none: 0) as step T1b's inputs
fn g3_derive(th: ptr<function, array<f32, 8>>, lk: ptr<function, array<f32, 8>>, ph: ptr<function, array<f32, 8>>, fold: vec3f,
             w: ptr<function, array<f32, 24>>, code: ptr<function, array<u32, 24>>) {
  var ax: array<vec2f, 8>;
  for (var r = 0u; r < GRN_R; r++) { ax[r] = g3_addr((*th)[r], (*lk)[r], fold); }
  let inv = 1.0 / max(2.0 * GP.sigma * GP.sigma, 1e-6);
  for (var r = 0u; r < GRN_R; r++) {
    var bw = array<f32, 3>(0.0, 0.0, 0.0);
    var bc = array<u32, 3>(0u, 0u, 0u);
    for (var q = 1u; q < GRN_NSRC; q++) {
      if (q == r + 1u) { continue; }
      var a: vec2f;
      var p: f32;
      if (q <= GRN_R) { a = ax[q - 1u]; p = (*ph)[q - 1u]; } else { let sn = g3_sense(q - 9u); a = sn.xy; p = sn.z; }
      let wv = GP.wMax * exp(-g3_d2(ax[r], a) * inv) * cos((*ph)[r] - p + GP.chi);
      let aw = abs(wv);
      if (aw < GP.wMin || aw <= abs(bw[2])) { continue; }
      if (aw > abs(bw[0])) { bw[2] = bw[1]; bc[2] = bc[1]; bw[1] = bw[0]; bc[1] = bc[0]; bw[0] = wv; bc[0] = q; }
      else if (aw > abs(bw[1])) { bw[2] = bw[1]; bc[2] = bc[1]; bw[1] = wv; bc[1] = q; }
      else { bw[2] = wv; bc[2] = q; }
    }
    for (var k = 0u; k < 3u; k++) { (*w)[3u * r + k] = bw[k]; (*code)[3u * r + k] = bc[k]; }
  }
}

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
const GRN_NOUT_S1: u32 = 18u;    // ... step S1: + SHAPE (the elongation gene, Bio.relay.y), its gain and regulator in Bio.relay.z, relay.w (while the shape is on)
const GRN_NOUT_S2: u32 = 20u;    // ... step S2: + FLAGELLUM and CILIA (Bio.mo.x, mo.w), their gains and regulators in Bio.mg (while either motor is on)

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
  // ---- step G3: the regulators' lattices, the folds, the state (src/folding.js) ----
  let g3 = (GP.g3f & G3_ON) != 0u;
  var th: array<f32, 8>;
  var lk: array<f32, 8>;
  var ph: array<f32, 8>;
  for (var r = 0u; r < GRN_R; r++) {
    th[r] = bioW[i].la[r >> 2u][r & 3u];
    lk[r] = bioW[i].lk[r >> 2u][r & 3u];
    ph[r] = bioW[i].lp[r >> 2u][r & 3u];
  }
  var fh = bioW[i].fh;
  var fs = bioW[i].fs;
  var gsv = bioW[i].gs;
  let gw0 = u32(max(gsv.w, 0.0));
  var gline = gw0 / GS_LINE;                // refolds in life in the cell's line
  var gbits = select(0u, gw0 & GS_SET, g3); // (this tick's events cleared; the links' mark kept while the moire genome is on)
  var gflash = (gw0 >> GS_FLASH_SHIFT) & 31u;   // the refold flash (the drawing), counting down
  var gfkind = gw0 & GS_FLASH_KIND;
  if (gflash > 0u && S.tick % 3u == 0u) { gflash -= 1u; }
  var g3force = false;                      // a big change: the links are derived afresh whatever the buffer holds
  var msG = 0.0;                            // this birth's mutation size (as the network's)
  // a genome without lattices (made by hand, or before step G3): drawn from its founder id, so a hand-made founder's copies share them
  if (g3 && (gbits & GS_SET) == 0u) {
    var none = true;
    for (var r = 0u; r < GRN_R; r++) { if (th[r] != 0.0 || lk[r] != 0.0 || ph[r] != 0.0) { none = false; } }
    if (none) {
      let fsd = pcg(u32(max(round(bioW[i].rec.w), 0.0)) * 0x9e3779b9u + 0x67336c61u);
      for (var r = 0u; r < GRN_R; r++) {
        th[r] = rand01(fsd, 10u + r) * G3_PI3;
        lk[r] = rand01(fsd, 20u + r) - 0.5;
        ph[r] = rand01(fsd, 30u + r) * TAU;
      }
      fh = vec4f(0.0, 0.0, 0.0, GP.bufFounder);
      fs = vec4f((2.0 * rand01(fsd, 40u) - 1.0) * GP.twistMax, (2.0 * rand01(fsd, 41u) - 1.0) * GP.stretchMax, rand01(fsd, 42u) * G3_PI3, 0.0);
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
    // (step M2, the mutation sweep: DRIFT x the scale Fields.qA.z; RARE: only when the step picked the network's group for this birth (the
    // mask it left in Bio.resp.w), at the big step Fields.qB.y; the mask cleared here)
    let rare = (bitcast<u32>(FL.qA.y) & MUT_RARE) != 0u;
    let rmask = u32(max(bioW[i].resp.w, 0.0));
    let ms = select(fid_birth(mOn, hx, pfid, FL.hm) * S.mutSize * max(FL.qA.z, 0.0),
                    select(0.0, S.mutSize * max(FL.qB.y, 0.0), mg_has(rmask, MG_GRN)), rare);
    bioW[i].resp.w = 0.0;
    msG = ms;
    if (ms > 0.0) {
      let bs = pcg(c.seed ^ pcg(S.tick * 0x2545f491u + 0x67726e31u));
      var u: array<f32, 20>;
      var oreg: array<u32, 20>;
      // (step S1: the 18th output only while the shape is on, so with it off a birth's random draws are exactly as before)
      // (step S2: the 19th and 20th only while a motor is on; then the 18th's words drift too, without effect while the shape is off)
      let moOn = (bitcast<u32>(FL.mo0.x) & (MO_FLAG | MO_CIL)) != 0u;
      let nOut = select(select(GRN_NOUT, GRN_NOUT_S1, (S.shapeF & SH_ON) != 0u), GRN_NOUT_S2, moOn);
      for (var o = 0u; o < 16u; o++) { u[o] = bioW[i].gu[o >> 2u][o & 3u]; oreg[o] = grn_reg(bioW[i].go, o); }
      var gm = bioW[i].gm;
      u[16] = gm.z;                                              // step P1: the ENGULF output
      oreg[16] = min(u32(max(gm.w, 0.0)), 7u);
      let rl = bioW[i].relay;
      u[17] = rl.z;                                              // step S1: the SHAPE output
      oreg[17] = min(u32(max(rl.w, 0.0)), 7u);
      let mgw = bioW[i].mg;
      u[18] = mgw.x;                                             // step S2: the FLAGELLUM output
      oreg[18] = min(u32(max(mgw.y, 0.0)), 7u);
      u[19] = mgw.z;                                             // ... the CILIA output
      oreg[19] = min(u32(max(mgw.w, 0.0)), 7u);
      // the small steps: weights and output gains in use, every bias
      if (!g3) {   // (step G3: the links come from the lattices: nudged below instead)
        for (var q = 0u; q < 24u; q++) {
          if (code[q] != 0u && code[q] < GRN_NSRC) { w[q] = clamp(w[q] + ms * GP.wStep * gauss(bs, 300u + q), -GRN_UMAX, GRN_UMAX); }
        }
      }
      for (var r = 0u; r < GRN_R; r++) { bias[r] = clamp(bias[r] + ms * GP.wStep * gauss(bs, 330u + r), -GRN_UMAX, GRN_UMAX); }
      for (var o = 0u; o < nOut; o++) {
        if (u[o] != 0.0) { u[o] = clamp(u[o] + ms * GP.uStep * gauss(bs, 340u + o), -GRN_UMAX, GRN_UMAX); }
      }
      // REWIRE an input: another source (1..22), or cut (0) one time in seven; a new link starts at a random weight
      if (!g3 && grn_rand(bs, 360u) < min(GP.rewire * ms, 1.0)) {
        let q = min(u32(grn_rand(bs, 361u) * 24.0), 23u);
        let v = grn_rand(bs, 362u);
        let nc = select(1u + min(u32(v * 7.0 / 6.0 * f32(GRN_NSRC - 1u)), GRN_NSRC - 2u), 0u, v >= 6.0 / 7.0);
        if (nc == 0u) { w[q] = 0.0; }
        else if (code[q] == 0u || w[q] == 0.0) { w[q] = GP.wNew * (2.0 * grn_rand(bs, 363u) - 1.0); }
        code[q] = nc;
      }
      // an OUTPUT pointed at another regulator (switched on at a random gain if it was off), or switched off one time in five
      if (grn_rand(bs, 365u) < min(GP.orewire * ms, 1.0)) {
        let o = min(u32(grn_rand(bs, 366u) * f32(nOut)), nOut - 1u);
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
          for (var o = 0u; o < nOut; o++) { if (oreg[o] == r && u[o] != 0.0) { used += 1.0; } }
          for (var q = 0u; q < 24u; q++) { if (code[q] == r + 1u && w[q] != 0.0 && q / 3u != r) { used += 1.0; } }
          if (used < best) { best = used; bb = r; }
        }
        if (bb < 8u) {
          bias[bb] = bias[a];
          x[bb] = x[a];
          if (g3) { th[bb] = th[a]; lk[bb] = lk[a]; ph[bb] = ph[a]; g3force = true; }   // (step G3: the copy carries its lattice)
          for (var k = 0u; k < 3u; k++) { w[3u * bb + k] = w[3u * a + k]; code[3u * bb + k] = select(code[3u * a + k], bb + 1u, code[3u * a + k] == a + 1u); }
          for (var o = 0u; o < nOut; o++) { if (oreg[o] == a && grn_rand(bs, 380u + o) < 0.5) { oreg[o] = bb; } }
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
      if (nOut > GRN_NOUT) { bioW[i].relay = vec4f(rl.xy, u[17], f32(oreg[17])); }
      if (nOut > GRN_NOUT_S1) { bioW[i].mg = vec4f(u[18], f32(oreg[18]), u[19], f32(oreg[19])); }
    }
  }

  // ---- step G3 at a birth: the lattices and the folds mutate (copying errors, at the network's mutation size), the parent's DAMAGE DOSE
  // (inherited with the genome copy) is written into the daughter's lattices; the change is HIDDEN drift until the buffer lets go ----
  let bornG = (c.flags & CELL_BORN) != 0u;
  var g3derive = false;
  let bufActs = (GP.g3f & (G3_BUF | G3_BUFNULL)) == G3_BUF;
  if (g3 && bornG) {
    let b3 = pcg(c.seed ^ pcg(S.tick * 0x2545f491u + 0x67336d31u));
    var dH = 0.0;
    if (msG > 0.0) {
      for (var r = 0u; r < GRN_R; r++) {
        let da = msG * GP.latStep * gauss(b3, 10u + r);
        let dl = msG * GP.latStep * gauss(b3, 20u + r);
        let dp = msG * GP.phStep * gauss(b3, 30u + r);
        th[r] += da;
        lk[r] = clamp(lk[r] + dl, -0.75, 0.75);
        ph[r] += dp;
        dH += da * da + dl * dl + GP.hPhase * GP.hPhase * dp * dp;
      }
      // now and then one regulator's lattice drawn afresh (the old rewiring's counterpart: a big change, never buffered)
      if (rand01(b3, 50u) < min(GP.jump * msG, 1.0)) {
        let r = min(u32(rand01(b3, 51u) * 8.0), 7u);
        th[r] = rand01(b3, 52u) * G3_PI3;
        lk[r] = rand01(b3, 53u) - 0.5;
        ph[r] = rand01(b3, 54u) * TAU;
        g3force = true;
      }
      // both folds drift a little (the one in use moves every address at once: counted as hidden drift)
      let fd = vec3f(gauss(b3, 60u), gauss(b3, 61u), gauss(b3, 62u)) * msG * GP.foldStep;
      let fe = vec3f(gauss(b3, 63u), gauss(b3, 64u), gauss(b3, 65u)) * msG * GP.foldStep;
      fh = vec4f(clamp(fh.x + fd.x, -GP.twistMax, GP.twistMax), clamp(fh.y + fd.y, -GP.stretchMax, GP.stretchMax), fh.z + fd.z, fh.w);
      fs = vec4f(clamp(fs.x + fe.x, -GP.twistMax, GP.twistMax), clamp(fs.y + fe.y, -GP.stretchMax, GP.stretchMax), fs.z + fe.z, fs.w);
      if ((GP.g3f & G3_FOLD) != 0u) { let du = select(fd.xy, fe.xy, fs.w > 0.5); dH += 8.0 * dot(du, du); }
      // a BIG REFOLD: one of the two folds drawn afresh (every link may change at once: the large mutation)
      if (rand01(b3, 70u) < min(GP.refold * msG, 1.0)) {
        let nf = vec3f((2.0 * rand01(b3, 71u) - 1.0) * GP.twistMax, (2.0 * rand01(b3, 72u) - 1.0) * GP.stretchMax, rand01(b3, 73u) * G3_PI3);
        if (rand01(b3, 74u) < 0.5) { fh = vec4f(nf, fh.w); } else { fs = vec4f(nf, fs.w); }
        g3force = true;
        gbits |= GS_EV_BIG;
        gflash = 31u;
        gfkind = GS_FLASH_KIND;
      }
      if ((GP.g3f & (G3_BUF | G3_BUFNULL)) != 0u) { fh.w = clamp(fh.w + msG * GP.bufStep * gauss(b3, 80u), 0.0, 1.0); }
    }
    let D = max(gsv.x, 0.0);
    if ((GP.g3f & (G3_DOSE | G3_DOSENULL)) == G3_DOSE && (S.rules & RULE_MUT) != 0u && D > 0.0) {
      let sd = GP.doseStep * D;
      for (var r = 0u; r < GRN_R; r++) {
        let da = sd * gauss(b3, 90u + r);
        let dl = sd * gauss(b3, 100u + r);
        th[r] += da;
        lk[r] = clamp(lk[r] + dl, -0.75, 0.75);
        dH += da * da + dl * dl;
      }
    }
    gsv.x = 0.0;                            // the daughter starts without damage
    gsv.y += dH;
    let cap = select(0.0, GP.bufCap * clamp(fh.w, 0.0, 1.0), bufActs);
    g3derive = g3force || gsv.y > cap;
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
      if ((cj.flags & CELL_ALIVE) == 0u) { continue; }
      // (step S1: pressed against it on their capsules: their gap against their end radii; off, the centres against the radii as before)
      let shOn = (S.shapeF & SH_ON) != 0u;
      let gp = cap_pair(c.pos, c.r, vec2f(c.e1, c.e2), cj.pos, cj.r, vec2f(cj.e1, cj.e2), shOn,
                        select(0.0, shape_ask(bioOld[i], S.shapeF, S.eCap), shOn), select(0.0, shape_ask(bioOld[j], S.shapeF, S.eCap), shOn));
      if (gp.x >= GP.press * gp.y) { continue; }
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

  // ---- step G3 in life: STRESS (heat, oxidation) may REFOLD the cell (calm folds it back; inherited, epigenetic), the DAMAGE DOSE
  // grows with heat and free t and is REPAIRED by the fidelity gene (the eat pass pays), and the BUFFER, weakened by stress, may let go ----
  if (g3 && !bornG) {
    let heat = src[o + GRN_S_HEAT];
    let tin = src[o + GRN_S_T];
    let st = clamp(GP.heatW * heat + GP.oxW * tin + GP.shock.x, 0.0, 1.0);   // (the toy's STRESS button adds shock.x)
    var flip = false;
    if ((GP.g3f & G3_FOLDLIFE) != 0u) {
      let rr = rand01(c.seed ^ 0x67336631u, S.tick);
      let kOn = GP.kOn * max(GP.shock.y, 1.0);
      if (fs.w < 0.5) {
        if (st > GP.s0 && rr < kOn * (st - GP.s0) / max(1.0 - GP.s0, 1e-3) * S.dt) { fs.w = 1.0; gbits |= GS_EV_ON; gline += 1u; flip = true; }
      } else if (st < GP.s0 && rr < GP.kOff * (GP.s0 - st) / max(GP.s0, 1e-3) * S.dt) { fs.w = 0.0; gbits |= GS_EV_OFF; flip = true; }
    }
    // the toy's REFOLD tool: cells under it are put into the fold it sets; the LINE REFOLD: every cell of a founder line (or all)
    let byLine = GP.shock.z < -0.5 || (GP.shock.z > 0.5 && round(bioW[i].rec.w) + 1.0 == round(GP.shock.z));
    let byZone = GP.zone.z > 0.0 && distance(c.pos, GP.zone.xy) < GP.zone.z + c.r;
    if (byZone || byLine) {
      let want = select(0.0, 1.0, select(GP.zone.w, GP.shock.w, byLine) > 0.5);
      if (fs.w != want) {
        fs.w = want;
        gbits |= select(GS_EV_OFF, GS_EV_ON, want > 0.5);
        if (want > 0.5) { gline += 1u; }
        flip = true;
      }
    }
    if (flip) {
      gflash = 31u;
      gfkind = select(0u, GS_FLASH_KIND, fs.w > 0.5);
      if ((GP.g3f & (G3_FOLD | G3_FOLDNULL)) == G3_FOLD) { g3derive = true; }
    }
    var D = max(gsv.x, 0.0);
    D += S.dt * (GP.doseHeat * heat + GP.doseOx * tin - GP.doseFade * D);
    gsv.z = 0.0;
    let F = bioW[i].conv.w;
    if ((GP.g3f & G3_REPAIR) != 0u && (bitcast<u32>(FL.hm.z) & 1u) != 0u && F > 0.0 && c.bat > 0.02 && D > 0.0) {
      let rem = min(D, D * GP.repK * (exp(min(F, 3.0)) - 1.0) * S.dt);
      D -= rem;
      gsv.z = rem;
    }
    gsv.x = max(D, 0.0);
    let cap = select(0.0, GP.bufCap * clamp(fh.w, 0.0, 1.0), bufActs) * max(0.0, 1.0 - GP.bufWeaken * st);
    if (gsv.y > cap) {
      g3derive = true;
      if (gsv.y > 1e-6) { gbits |= GS_EV_REL; }
    }
  }
  if (g3) {
    if ((gbits & GS_SET) == 0u || (GP.g3f & G3_DERALL) != 0u) { g3derive = true; }
    if (g3derive) {
      let fold = select(vec3f(0.0), select(fh.xyz, fs.xyz, fs.w > 0.5 && (GP.g3f & G3_FOLDNULL) == 0u), (GP.g3f & G3_FOLD) != 0u);
      g3_derive(&th, &lk, &ph, fold, &w, &code);
      gsv.y = 0.0;
      gbits |= GS_SET;
      // the outputs: each reads the regulator whose folded lattice beats slowest with its own (the gains stay as they are)
      if ((GP.g3f & G3_OUT) != 0u) {
        var oreg: array<u32, 20>;
        for (var q = 0u; q < 20u; q++) {
          let oa = g3_out(q);
          var best = 1e9;
          var br = 0u;
          for (var r = 0u; r < GRN_R; r++) {
            let dd = g3_d2(g3_addr(th[r], lk[r], fold), oa);
            if (dd < best) { best = dd; br = r; }
          }
          oreg[q] = br;
        }
        for (var v = 0u; v < 4u; v++) {
          bioW[i].go[v] = f32(oreg[4u * v] + 8u * oreg[4u * v + 1u] + 64u * oreg[4u * v + 2u] + 512u * oreg[4u * v + 3u]);
        }
        bioW[i].gm.w = f32(oreg[16]);
        bioW[i].relay.w = f32(oreg[17]);
        bioW[i].mg.y = f32(oreg[18]);
        bioW[i].mg.w = f32(oreg[19]);
      }
      for (var r = 0u; r < GRN_R; r++) {
        bioW[i].gi[r >> 2u][r & 3u] = f32(code[3u * r] + 32u * code[3u * r + 1u] + 1024u * code[3u * r + 2u]);
      }
      for (var q = 0u; q < 24u; q++) { bioW[i].gw[q >> 2u][q & 3u] = w[q]; }
    }
    if (bornG || g3derive) {
      bioW[i].la[0] = vec4f(th[0], th[1], th[2], th[3]);
      bioW[i].la[1] = vec4f(th[4], th[5], th[6], th[7]);
      bioW[i].lk[0] = vec4f(lk[0], lk[1], lk[2], lk[3]);
      bioW[i].lk[1] = vec4f(lk[4], lk[5], lk[6], lk[7]);
      bioW[i].lp[0] = vec4f(ph[0], ph[1], ph[2], ph[3]);
      bioW[i].lp[1] = vec4f(ph[4], ph[5], ph[6], ph[7]);
    }
    bioW[i].fh = fh;
    bioW[i].fs = fs;
  }
  if (g3 || (gw0 & 31u) != 0u || gflash != 0u) {
    bioW[i].gs = vec4f(gsv.xyz, f32(gbits + (gflash << GS_FLASH_SHIFT) + gfkind + GS_LINE * gline));
  }

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
