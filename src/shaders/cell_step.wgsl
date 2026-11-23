// One simulation tick for every cell: the field felt on the membrane (step 4), adhesion (step F0: no fates any more; the cell's job is
// low-passed here from its genes as expressed, for the colours), soft
// contact push, gentle pull to the dish centre, slow drift of the medium, soft walls, stirring, crawling,
// damped (viscous) velocity and random kicks from the heat under the cell (step C1; or the old constant jitter).
// Needs field_common.wgsl, heat_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
//
// One invocation per slot of the sorted list (cell_grid.wgsl), so neighbouring invocations read neighbouring
// memory. It reads only the sorted copy (positions as they were when the grid was built) and writes the
// result to the cell's own slot in `cells`, so no cell reads a half-updated neighbour.
// Ported from the reference's step(): contact push -KR (R0 - d), v = 0.85 v + 0.15 F per tick,
// jitter +-0.025 R per tick, walls 3 R from the edge.

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> sorted: array<CellCore>;   // step C6c: the lean copy
@group(0) @binding(3) var<storage, read> starts: array<u32>;
// (no `counts`: a grid cell's cells end where the next one's start, which keeps the step within 8 storage buffers)
@group(0) @binding(4) var<storage, read_write> hb: array<atomic<i32>>;   // step C1: the heat buffer (heat_common.wgsl)
@group(0) @binding(5) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(6) var<storage, read> bioPrev: array<Bio>;
@group(0) @binding(7) var<storage, read_write> bioNext: array<Bio>;
@group(0) @binding(8) var<storage, read_write> stats: Stats;
@group(0) @binding(9) var<uniform> med: Medium;
@group(0) @binding(11) var<storage, read> beats: array<CellBeat>;
@group(0) @binding(12) var<uniform> FL: Fields;
@group(0) @binding(13) var<uniform> HP: HeatP;
// step N2: the chemotaxis gene's factor on the smell's gain (Fields.g2.w bits; x 1 while off or in the neutral control)
fn chemo_factor(b: Bio) -> f32 {
  if ((bitcast<u32>(FL.g2.w) & (CHEMO_ON | CHEMO_NULL)) != CHEMO_ON) { return 1.0; }
  return exp(clamp(b.mc.w, CHEMO_LO, CHEMO_HI));
}

// step N1: the water's velocity at p (CSS px per s) from the currents' stream function at the 4 corners of its heat pixel (bilinear:
// u = d psi / dy, v = -d psi / dx; psi in CSS px^2 per s at the corners, (hw + 1) x (hh + 1), src/water.js)
fn water_vel(p: vec2f) -> vec2f {
  let g = clamp(p / HP.px, vec2f(0.0), vec2f(f32(HP.hw), f32(HP.hh)) - 1e-3);
  let b = vec2u(floor(g));
  let t = g - vec2f(b);
  let w = HP.hw + 1u;
  let o = HP.cur + b.y * w + b.x;
  let p00 = bitcast<f32>(atomicLoad(&hb[o]));
  let p10 = bitcast<f32>(atomicLoad(&hb[o + 1u]));
  let p01 = bitcast<f32>(atomicLoad(&hb[o + w]));
  let p11 = bitcast<f32>(atomicLoad(&hb[o + w + 1u]));
  let dx = mix(p10 - p00, p11 - p01, t.y) / HP.px;
  let dy = mix(p01 - p00, p11 - p10, t.x) / HP.px;
  return vec2f(dy, -dx);
}

// step G0: the STIRRED water's velocity at p alone (the cells' own flow, src/stir.js): from its stream function on the stir grid (spacing g0b.z,
// g0c.x x g0c.y nodes, at word g0c.w of hb), bilinear as water_vel; 0 while the stirring is off
fn stir_vel(p: vec2f) -> vec2f {
  let po = bitcast<u32>(FL.g0c.w);
  if (po == 0u) { return vec2f(0.0); }
  let sw = bitcast<u32>(FL.g0c.x);
  let sh = bitcast<u32>(FL.g0c.y);
  let h = FL.g0b.z;
  let g = clamp(p / h, vec2f(0.0), vec2f(f32(sw - 1u), f32(sh - 1u)) - 1e-3);
  let b = vec2u(floor(g));
  let t = g - vec2f(b);
  let o = po + b.y * sw + b.x;
  let p00 = bitcast<f32>(atomicLoad(&hb[o]));
  let p10 = bitcast<f32>(atomicLoad(&hb[o + 1u]));
  let p01 = bitcast<f32>(atomicLoad(&hb[o + sw]));
  let p11 = bitcast<f32>(atomicLoad(&hb[o + sw + 1u]));
  let dx = mix(p10 - p00, p11 - p01, t.y) / h;
  let dy = mix(p01 - p00, p11 - p10, t.x) / h;
  return vec2f(dy, -dx);
}

// step G0b, OBSTACLES (src/obstacles.js): at p (CSS px) the signed distance to the nearest edge that stops cells (sdA, bilinear between the
// heat pixels' centres; < 0 inside) and its gradient (x, y: pointing away from the obstacle); deep inside (beyond the fields' reach, where the
// gradient is 0) the pixel's way out (the mask word's cell bits) gives the direction instead
fn obs_at(p: vec2f) -> vec3f {
  let o = bitcast<u32>(FL.ob0.y);
  let g = clamp(p / HP.px - 0.5, vec2f(0.0), vec2f(f32(HP.hw) - 1.001, f32(HP.hh) - 1.001));
  let b = vec2u(floor(g));
  let t = g - vec2f(b);
  let w = HP.hw;
  let i0 = o + b.y * w + b.x;
  let d00 = bitcast<f32>(atomicLoad(&hb[i0]));
  let d10 = bitcast<f32>(atomicLoad(&hb[i0 + 1u]));
  let d01 = bitcast<f32>(atomicLoad(&hb[i0 + w]));
  let d11 = bitcast<f32>(atomicLoad(&hb[i0 + w + 1u]));
  let d = mix(mix(d00, d10, t.x), mix(d01, d11, t.x), t.y);
  var gr = vec2f(mix(d10 - d00, d11 - d01, t.y), mix(d01 - d00, d11 - d10, t.x)) / HP.px;
  if (d < 0.0 && dot(gr, gr) < 0.09) {
    let q = vec2u(clamp(vec2i(floor(p / HP.px)), vec2i(0), vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1)));
    let wd = (bitcast<u32>(atomicLoad(&hb[o - HP.n + q.y * w + q.x])) >> 5u) & 7u;
    // (1 left, 2 right, 3 up, 4 down; a select chain: naga, Firefox's compiler, refuses a dynamic index into a value array)
    gr = select(select(select(select(vec2f(0.0), vec2f(0.0, 1.0), wd == 4u), vec2f(0.0, -1.0), wd == 3u), vec2f(1.0, 0.0), wd == 2u), vec2f(-1.0, 0.0), wd == 1u);
  }
  return vec3f(d, gr);
}

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let j = id.x;
  // step C9: the live cells are the sorted list's first starts[gw gh] (the dead slots' bucket follows: the free slots)
  let aliveN = min(starts[S.gw * S.gh], S.count);
  if (j >= aliveN) { return; }
  let i = beats[j].idx;              // the cell's own slot in `cells` (sortIdx, carried in its beat)
  var c = cells[i];                  // (step C6c: from its own slot, whole; the same as its sorted copy, which has no outline)
  var bio = bioPrev[i];
  if ((c.flags & CELL_ALIVE) == 0u) { return; }   // (never: the grid sorted it among the live cells)
  let pos0 = c.pos;                  // (the portable guard, at the end: where a cell whose numbers broke is put back)

  // step P1, PREDATORS (src/predators.js): this cell's engulfing (Cell.eng) and what it needs to choose a prey or go on wrapping one. A
  // touching cell can be engulfed when it is SMALLER (area ratio p1.y), when this cell's DRIVE (p1.z x its engulf gene as expressed x (1 -
  // its kin sparing gene x their kinship)) beats the other's HOLD (its glue to its other neighbours + its armour + p1.w), and when this cell
  // can pay (battery, membrane). Only with the changing count (division), as a meal's slot must stay a ghost while it is digested
  let p1F = bitcast<u32>(FL.p1.x);
  let p1On = (p1F & P1_ON) != 0u && S.count <= NBR_NONE;
  let p1Act = p1On && (p1F & P1_NULL) == 0u && (S.rules & RULE_TURN) != 0u && (bitcast<u32>(FL.dv0.x) & DV_ON) != 0u;
  let myEng = c.eng;
  let myMode = eng_mode(myEng);
  let myPart = eng_partner(myEng);
  let eGene = clamp(bio.kin.z, 0.0, 1.0);
  let eExpr = eGene * select(1.0, grn_fac_engulf(bio), (bitcast<u32>(FL.t1.z) & GRN_ACT) != 0u);
  let seekOn = p1Act && eGene > 0.0 && (myMode == ENG_IDLE || myMode == ENG_WRAP);
  let mySpare = select(clamp(bio.kin.w, 0.0, 1.0), 0.0, (p1F & P1_KINNULL) != 0u);
  let myMark = vec4f(bio.mark.xyz, bio.mark.w * gofP(i, GRN_O_DISP));
  var holdG = 0.0;            // this cell's glue to its touching neighbours (part of its hold)
  var bestM = 0.0;            // an idle predator: the best prey's margin (drive - hold) and index
  var bestI = NBR_NONE;
  var tFound = false;         // a wrapping predator: its prey still touches it ...
  var tOk = false;            // ... and it still out-pulls it
  var byP = 0.0;              // a prey: the furthest wrap round it, and its wrapper
  var byI = NBR_NONE;
  var capI = 0xffffffffu;     // ... a wrapper that has closed round it (the lowest index if several)
  var capKin = 0.0;
  var capGlue = 0.0;          // ... and its glue to that wrapper (not a hold against it)

  // step C6c, elastic honeycomb cells: a cell without a honeycomb outline yet (the rule just switched on, or a newborn)
  // starts from its ellipse: each corner on the ellipse of its stretch, the whole at the rest area, the hexagon turned at
  // random; with the rule off the cell goes back to its ellipse (its stretch as the corners last left it)
  let hexOn = FL.hexOn != 0u;
  if (hexOn && (c.flags & CELL_HEX) == 0u) {
    c.theta = P3 * rand01(c.seed ^ 0x7f4a7c15u, S.tick);
    c.spin = 0.0;
    c.ea = vec2f(c.e1, c.e2);
    c.alpha = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    c.rad = hex_rest(c.ea, hex_dirs(c), S.hexSize * 3.14159265 * c.r * c.r);
    c.radV = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    c.flags |= CELL_HEX;
  } else if (!hexOn) {
    c.flags &= ~CELL_HEX;
  }
  let hexShape = (c.flags & CELL_HEX) != 0u;
  // step S1, CELL SHAPE (src/spindle.js): this cell's CAPSULE, its real extent for contacts (from its outline's stretch, as its neighbours
  // see it in their lean copies), and the TORQUE of the off-centre forces on it (summed below: contacts, obstacles, the dish's wall, the
  // water's shear), which turns a long cell (rods side by side align)
  let shF = S.shapeF;
  let shOn = (shF & SH_ON) != 0u;
  let myAsk = select(0.0, shape_ask(bio, shF, S.eCap), shOn);   // the elongation it asks for (its gene x the network's SHAPE output)
  let myK = capsule(c.r, cap_stretch(vec2f(c.e1, c.e2), myAsk), shOn);
  let myReach = myK.z + 1.45 * myK.w;        // how far its contact can reach from its centre (along its axis)
  var sTq = 0.0;
  var nemN = 0u;                             // the census: touching pairs both longer than 1.5:1, the sum of cos 2 (their axes' angle)
  var nemS = 0;
  var noWrap = 0u;                           // ... prey that only their length saved
  let myLong = 2.0 * length(vec2f(c.e1, c.e2)) > 0.405465;
  // step S2, FLAGELLA AND CILIA (src/motors.js): this cell's motors as they act (its genes x the gene network's outputs x its motor proteins'
  // share, Cell.motE from the eat pass), its cilia's beat phase (Bio.mc.z) and their stroke (straight back along the front: a free cell swims
  // forward), and what the neighbour loop gathers for them: the sides touching a neighbour (the cilia beat on the others) and the beating
  // neighbours' phases against this cell's, less the LAG a beat's push takes through the water to reach them (the metachronal wave's)
  let moF = bitcast<u32>(FL.mo0.x);
  let moAct = motor_act(bio, moF, (bitcast<u32>(FL.t1.z) & GRN_ACT) != 0u) * clamp(c.motE, 0.0, 1.0);
  let flagA = moAct.x;
  let ciliaA = moAct.y;
  let moPhi = bio.mc.z;
  let moStroke = -vec2f(cos(c.front), sin(c.front));
  var moTouch = 0u;
  var cpS = 0.0;            // the beating neighbours: sum of sin(phi_j - phi_i - lag), cos (the local wave), and without the lag (sync)
  var cpC = 0.0;
  var cyS = 0.0;
  var cyC = 0.0;
  var cpN = 0.0;
  // step C10, patterned walls (src/walls.js): this cell's effective adhesion per side (the eat pass's, last tick) and the
  // orientation its sides are found by, both as its lean copy has them (what its neighbours see, so the two cells of a contact
  // find the same pair of sides), and per side the touching that matures its junctions
  let wlF = bitcast<u32>(FL.wl0.x);
  let wallOn = (wlF & WL_ON) != 0u;
  let mine0 = sorted[j].wadh;
  let myTh = wall_theta(sorted[j].flags, (mine0.y >> 16u) & 255u);
  let wA = wall_dec4(unpack4x8unorm(mine0.x));
  let wB = wall_dec4(unpack4x8unorm(mine0.y & 0xffffu)).xy;
  let wFront = vec2f(cos(c.front), sin(c.front));
  var tchA = vec4f(0.0);
  var tchB = vec2f(0.0);
  var rtA = vec4f(0.0);       // step C11's census: each side's touching, sticky or not
  var rtB = vec2f(0.0);
  var wPairs = 0u;
  var wGlue = 0u;
  var wMatP = 0u;
  var wFrontP = 0u;
  let myMat = c.mature;
  // step G0, JUNCTIONS THAT BREAK (src/glue.js): this cell's junction word (Cell.kind: sides torn, sides formed). A side's junction FORMS when
  // it touches a glued neighbour closer than the contact distance R0 and stays formed while that side keeps touching one; it TEARS when the
  // pair is pulled apart past R0 x (1 + g0a.z): the glue's pull peaks at R0 (its full strength: the pair's glue x likeness - the base loss, x
  // adhesion x R x stiffness) and only weakens beyond, so a pair stretched past it is held by less than what pulls it apart (whatever that is:
  // crawling, the water, the press, a predator's pull, a crowd's push). A torn side holds no glue (its own word, and its neighbours read it
  // from the lean copy) until it heals (at g0a.y per s, at random), its junction's maturity gone
  let g0F = bitcast<u32>(FL.g0a.x);
  let tearOn = wallOn && (g0F & G0_TEAR) != 0u;
  let jn0 = select(0u, c.kind & (JN_TORN | (JN_TORN << JN_FORM_SHIFT)), tearOn);
  var jnTear = 0u;          // sides that tore this tick
  var jnKeep = 0u;          // sides touching a glued neighbour within reach (a formed junction stays)
  var jnMake = 0u;          // sides touching a glued neighbour closer than R0 (a junction forms)
  var jnStr = 0.0;          // the census: formed junctions' strength and load (the frame's last tick)
  var jnLoad = 0.0;
  var jnN = 0u;
  // step C11, glue turns the cell: the torque of the contacts' adhesion about this cell's centre (below, in the neighbour loop)
  let glueTurn = wallOn && (wlF & WL_TURN) != 0u && FL.wl1.w > 0.0;
  var glueTq = 0.0;
  // ... the contacts: each neighbour's wall caps how far out each corner may sit (bound), pulls the hexagon round so a
  // side faces it (torque, weighted by closeness tw), and slides each corner round toward the corner of its tile (slide:
  // the slope of the soft-nearest wall's distance along the corner's direction, sw its weight)
  // (corners 0..3 in the A vectors, 4 and 5 in the B ones: the neighbour loop works on all six at once, no array indexing)
  var boundA = vec4f(1e9);
  var boundB = vec2f(1e9);
  var slideA = vec4f(0.0);
  var slideB = vec2f(0.0);
  var swA = vec4f(0.0);
  var swB = vec2f(0.0);
  let hu = hex_dirs(c);
  let huX = array<vec4f, 2>(vec4f(hu[0].x, hu[1].x, hu[2].x, hu[3].x), vec4f(hu[4].x, hu[5].x, 0.0, 0.0));
  let huY = array<vec4f, 2>(vec4f(hu[0].y, hu[1].y, hu[2].y, hu[3].y), vec4f(hu[4].y, hu[5].y, 0.0, 0.0));
  let rot6 = vec2f(cos(6.0 * c.theta), -sin(6.0 * c.theta));
  var torque = 0.0;
  var tw = 0.0;

  var f = vec2f(0.0);
  let adh = (S.rules & RULE_ADH) != 0u && S.adhesion > 0.0;
  var M = 0.0;              // recognised contact: sum over touching neighbours of (contact x key match)
  var comp = 0.0;           // step C9, crowding: the sum of the overlaps, each as a share of the contact distance
  var wParent = 0.0;        // touching neighbours' weight so far, and the one picked as parent (sorted slot); step C5,
  var parent = 0xffffffffu; // energy-biased turnover: a neighbour weighs FL.bias + its battery share (else all 1)
  let biasOn = (FL.eat & EAT_BIAS) != 0u;

  // step C13, fields as genes (src/guides.js): this cell's own sensing genes (today's values while the field genes are off)
  let fgF = bitcast<u32>(FL.fg0.x);
  let fgOn = (fgF & FG_GENES) != 0u;
  let senseA = select(1.0, bio.fa.z, fgOn);          // field A: sensing gain and sign
  let tuneA = select(1.0, max(bio.fa.w, 0.05), fgOn); // ... tuning width (x tuneW)
  let senseB = select(1.0, bio.fb.z, fgOn);          // field B: sensing gain and sign
  let pickB = select(0.0, max(bio.fb.w, 0.0), fgOn); // ... pickiness (0: feels every cell's B)
  let senseP = select(1.0, bio.fx.w, fgOn);          // the partner A': sensing gain and sign
  // the loop: the field of the neighbours, averaged along each membrane segment
  let sensing = S.sense > 0.0;
  let cutR = S.cut * S.R;
  var seg = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  // step 8: the neighbours' field A and its partner A' along the membrane (weights without the sense gain)
  let partner = FL.pOn != 0u;
  let pSgn = p_sgn(FL.pSgn1);
  var segQ = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  var segP = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let mb = membrane(c);
  // step C7: each side's middle direction (unit vectors, sides 0..3 in the A vectors, 4 and 5 in the B ones), to find the
  // touching neighbour across each side (Cell.nbr: the nearest touching cell whose direction is closest to that side's middle)
  let nbrOn = S.nbrOn != 0u && S.count <= NBR_NONE;
  // (worked out in vectors: a loop over arrays here slowed the whole step by a third)
  let mxA = vec4f(mb.mid[0].x, mb.mid[1].x, mb.mid[2].x, mb.mid[3].x);
  let myA = vec4f(mb.mid[0].y, mb.mid[1].y, mb.mid[2].y, mb.mid[3].y);
  let mxB = vec2f(mb.mid[4].x, mb.mid[5].x);
  let myB = vec2f(mb.mid[4].y, mb.mid[5].y);
  let ilA = inverseSqrt(max(mxA * mxA + myA * myA, vec4f(1e-12)));
  let ilB = inverseSqrt(max(mxB * mxB + myB * myB, vec2f(1e-12)));
  let nmxA = mxA * ilA;
  let nmyA = myA * ilA;
  let nmxB = mxB * ilB;
  let nmyB = myB * ilB;
  var nbDA = vec4f(1e9);
  var nbDB = vec2f(1e9);
  var nbIA = vec4u(NBR_NONE);
  var nbIB = vec2u(NBR_NONE);
  let me = beats[j];                         // this cell's own (strained) lattice, for the receptor tuning
  let mk0 = me.k01.xy;
  let mk1 = me.k01.zw;
  let mk2 = me.k2a.xy;
  // what the cell listens to in other cells: its own lattice, or (key R) its genome's receptor
  let byRec = S.receptor == 1u;
  let rk0 = select(mk0, lattice_k(bio.key.z, bio.key.w, S.lever, med.k0, 0), byRec);
  let rk1 = select(mk1, lattice_k(bio.key.z, bio.key.w, S.lever, med.k0, 1), byRec);
  let rk2 = select(mk2, lattice_k(bio.key.z, bio.key.w, S.lever, med.k0, 2), byRec);
  let rw = select(S.tuneW * tuneA, bio.rec.x, byRec);
  var C = vec2f(0.0);                        // contact squeeze (traceless tensor: (xx - yy, 2 xy) parts)
  // field B (step 5): its gradient at the centre, summed over the neighbours within its reach, each weighted by
  // the sign rule; it reaches past the usual 3 x 3 grid block, so the block grows to FL.bReach cells around
  let feelB = FL.bGain > 0.0;
  let cutB = FL.bCut * S.R;
  let kB0 = med.k0 / FL.bBand;               // step C13: B's band's wavenumber (B's pickiness)
  let myQA = charge_a(FL);
  // rule 1 (step 6), leak by deformation: a cell whose strained A lattice reaches B's band also listens to B
  // through its A charge, in the share it leaks (me.lk.w): its charge in B is its own B charge plus that
  // (rule 2: a converted cell listens to B with the charge it emits with)
  // (step C12g: with the charges from the field genes the B sensing gene carries the listener's sign, so its charge here is the
  // emitter's magnitude: like repels like by the genes' signs)
  let myQB = cell_charge_b(FL, c) * select(1.0, fg_sgn_b(c), FL.qStock == 2u) + FL.leak * me.lk.w * myQA;
  var gB = vec2f(0.0);
  var bFelt = 0.0;          // step T1b: field B's value at the cell (the gene network senses it, Cell.felt[1] byte 2)
  // rule 2 (step 6), conversion: how much A this cell feels at its centre (its neighbours' A field, tuned)
  var aFelt = 0.0;
  // step 8, rule b: ... and how much of the partner A' (as aFelt, the phases shifted a quarter period)
  let changeOn = FL.chGain > 0.0;
  var pFelt = 0.0;
  // rule 3 (step 6), relay through B: the share of the neighbourhood (weighted by B's envelope) that is converted
  let relayOn = FL.conv > 0.0 && FL.relay > 0.0;
  var relaySig = 0.0;
  var relayAll = 0.0;
  // step 7, exclusion: this cell's state (its lattice angle's bin); neighbours of its type in the same state are kept
  // out to exclReach x the contact distance, harder (x excl); neighbours of its type in another state pack closer
  let exclOn = S.excl > 0.0;
  let myState = cell_state(c.la, c.flags, S.states);
  var xAll = 0u;                             // census: same-type neighbours within 1.6 x contact distance
  var xSame = 0u;                            // ... of which in the same state
  var tAll = 0u;                             // census: same-type neighbours touching (within reach x contact distance)
  var tSame = 0u;                            // ... of which in the same state
  var nState = array<u32, 4>(0u, 0u, 0u, 0u); // rule 2: same-type neighbours per state within the shell (below)
  let shell = max(1.05 * S.exclReach, 1.2);   // ... x contact distance: the first ring of neighbours, not the second
  // step C6d, charge per side (src/dipole.js): this cell's dipole d (saturated, from its side charges); the neighbours' dipoles
  // (their lean copies) make a field at it, eDD (sum of w (3 (d_j . n) n - d_j), n from the neighbour to this cell, w (R0 /
  // dist)^3 tapered to 0 at the range), and push it, fDD (the force between two dipoles: head-to-tail attract, side by side
  // repel, the same kernel / x)
  let dpF = bitcast<u32>(FL.dip0.x);
  let dipOn = (dpF & DP_ON) != 0u;
  let ddOn = dipOn && (dpF & DP_DD) != 0u;
  var myD = vec2f(0.0);
  if (dipOn) { myD = dip_sat(cell_dipole_raw(c, mb), FL.dip0.y); }
  let myDm = length(myD);
  let ddR = max(FL.dip0.z, 1.0);
  var eDD = vec2f(0.0);
  var fDD = vec2f(0.0);
  let dCount = S.xCount != 0u && dipOn;
  var dPairs = 0u;
  var dCos = 0;
  var dHtt = 0;
  var dBonds = 0u;

  // every neighbour within reach: contact push, and (differentiation on) recognition and signals
  let rg = grid_range_n(S, grid_xy(S, c.pos), select(1, i32(FL.bReach), feelB || relayOn));
  for (var gy = rg.y; gy <= rg.w; gy++) {
    for (var gx = rg.x; gx <= rg.z; gx++) {
      let g = grid_index(S, vec2i(gx, gy));
      let s = starts[g];
      let e = starts[g + 1u];          // (step C9: starts[gw gh], after the last grid cell, is the live cells' end)
      for (var k = s; k < e; k++) {
        if (k == j) { continue; }
        let o = sorted[k];
        if ((o.flags & CELL_ALIVE) == 0u) { continue; }
        let d = o.pos - c.pos;
        let R0 = c.r + o.r;
        let d2 = dot(d, d);
        // step S1: the pair's CONTACT on their capsules: dk the vector between the closest points of their core segments, R0k the contact
        // distance (their end radii's sum), sA where along this cell's axis the contact sits (its lever arm) and tB along the neighbour's.
        // The fields below keep the centres' line (d, R0); off (or both round) dk = d, R0k = R0, as before
        var dk = d;
        var R0k = R0;
        var sA = 0.0;
        var tB = 0.0;
        var kLine = 1.0;                         // step S1: a LINE contact (rods side by side) is stiffer: x (1 + its length / the contact distance)
        var oK = vec4f(1.0, 0.0, 0.0, o.r);
        if (shOn) {
          let far = myReach + 2.05 * o.r;        // (at most h + 1.45 rho of the neighbour at an aspect of 4: a cheap test first)
          if (d2 < far * far) {
            oK = capsule(o.r, cap_stretch(vec2f(o.e1, o.e2), shape_ask(bioPrev[beats[k].idx], shF, S.eCap)), true);
            let st = seg_closest(d, myK.xy, myK.z, oK.xy, oK.z);
            dk = d + st.y * oK.xy - st.x * myK.xy;
            sA = st.x;
            tB = st.y;
            kLine = 1.0 + st.z / max(myK.w + oK.w, 1e-3);
          }
          R0k = myK.w + oK.w;
        }
        let d2k = dot(dk, dk);
        // step P1: how far this pair is wrapped (one of them wrapping the other): their walls give way and their push softens
        var wrapP = 0.0;
        if (p1On) {
          let oe = o.eng.x;
          if (eng_mode(oe) == ENG_WRAP && eng_partner(oe) == i) { wrapP = eng_prog(oe); }
          if (myMode == ENG_WRAP && myPart == beats[k].idx) { wrapP = max(wrapP, eng_prog(myEng)); }
        }
        // step C6c: contact flattens. The wall between the two cells is the line where their power distances |x - p|^2 - r^2
        // are equal (the midline, shifted toward the smaller cell; both cells find the same line, so they share a straight
        // wall): every corner of this cell must stay on its side of it
        // (step S1: on the capsules, the power line between the two closest points, its distance from this cell's centre along uh)
        if (hexShape && d2k < 1.96 * R0k * R0k && d2k > 1e-6 && wrapP < 0.3) {
          let dh = sqrt(d2k);
          let uh = dk / dh;
          var wall = 0.5 * dh + (c.r * c.r - o.r * o.r) / (2.0 * dh);
          if (shOn) { wall = max(sA * dot(myK.xy, uh) + 0.5 * dh + (myK.w * myK.w - oK.w * oK.w) / (2.0 * dh), 0.25 * myK.w); }
          // per corner: cu = uh . u (the corner's direction against the wall's normal), b = wall / cu its distance to the
          // wall along its direction (only for corners facing the wall, cu > 0.05)
          let cuA = uh.x * huX[0] + uh.y * huY[0];
          let cuB = (uh.x * huX[1] + uh.y * huY[1]).xy;
          let bA = wall / max(cuA, vec4f(0.05));
          let bB = wall / max(cuB, vec2f(0.05));
          let okA = cuA > vec4f(0.05);
          let okB = cuB > vec2f(0.05);
          boundA = select(boundA, min(boundA, bA), okA);
          boundB = select(boundB, min(boundB, bB), okB);
          // the tile's corners are where its boundary is farthest from the centre: along the corner's direction the wall's
          // distance b grows as the corner turns away from the wall's normal, d(log b)/d(angle) = -(uh . u_perp) / (uh . u);
          // summed over the walls weighted by (b / r)^-12 (a soft minimum: at a tile corner the two walls' slopes cancel
          // smoothly, so the corner settles there instead of chattering)
          let xA = max(bA / c.r, vec4f(0.2));
          let xB = max(bB / c.r, vec2f(0.2));
          let x4A = (xA * xA) * (xA * xA);
          let x4B = (xB * xB) * (xB * xB);
          let wA = select(vec4f(0.0), 1.0 / (x4A * x4A * x4A), okA & (bA < vec4f(2.5 * c.r)));
          let wB = select(vec2f(0.0), 1.0 / (x4B * x4B * x4B), okB & (bB < vec2f(2.5 * c.r)));
          slideA -= wA * (uh.y * huX[0] - uh.x * huY[0]) / max(cuA, vec4f(0.05));
          slideB -= wB * (uh.y * huX[1] - uh.x * huY[1]).xy / max(cuB, vec2f(0.05));
          swA += wA;
          swB += wB;
          // ... and turns the hexagon so a side (its middle at theta + 30 + k x 60 degrees) faces the neighbour: a pull of
          // sin(6 delta), delta the neighbour's angle from the nearest side's middle (= -Im(u^6 e^{-6 i theta}))
          let wt = clamp((1.2 * R0k - dh) / (0.3 * R0k), 0.0, 1.0);
          if (wt > 0.0) {
            let u2 = vec2f(uh.x * uh.x - uh.y * uh.y, 2.0 * uh.x * uh.y);
            let u3 = vec2f(u2.x * uh.x - u2.y * uh.y, u2.x * uh.y + u2.y * uh.x);
            let u6 = vec2f(u3.x * u3.x - u3.y * u3.y, 2.0 * u3.x * u3.y);
            torque -= wt * (u6.x * rot6.y + u6.y * rot6.x);
            tw += wt;
          }
        }
        // step C6d: the neighbour's dipole (only it: a cell's own side charges sit inside its own outline)
        // (the census counts the pairs also while dipole-dipole is off, for comparison)
        if ((ddOn || dCount) && d2 < ddR * ddR * R0 * R0 && d2 > 1e-6) {
          let od = o.dip;
          let odm = length(od);
          if (odm > 1e-4) {
            let dd = sqrt(d2);
            let nn = -d / dd;
            if (ddOn) {
              let xr = max(dd / R0, 0.5);
              let wd = (1.0 - smoothstep(0.7 * ddR, ddR, xr)) / (xr * xr * xr);
              let dn = od.x * nn.x + od.y * nn.y;
              eDD += wd * (3.0 * dn * nn - od);
              let mn = myD.x * nn.x + myD.y * nn.y;
              fDD += (wd / xr) * (dn * myD + mn * od + (myD.x * od.x + myD.y * od.y) * nn - 5.0 * mn * dn * nn);
            }
            if (dCount && myDm > DIP_MIN && odm > DIP_MIN && dd < S.reach * R0) {
              let ua = myD / myDm;
              let ub = od / odm;
              let ca = ua.x * ub.x + ua.y * ub.y;
              let ht = (ua.x * nn.x + ua.y * nn.y) * (ub.x * nn.x + ub.y * nn.y);
              dPairs++;
              dCos += i32(round(1000.0 * ca));
              dHtt += i32(round(1000.0 * ht));
              if (ht > DIP_BOND && ca > DIP_BOND) { dBonds++; }
            }
          }
        }
        if (relayOn && d2 < cutB * cutB) {
          let rw = cut_taper(d2, cutB) / (1.0 + d2 / beats[k].b2a.w);
          relayAll += rw;
          if ((o.flags & CELL_CONV) != 0u) { relaySig += rw; }
        }
        if (feelB && d2 < cutB * cutB) {
          let ob = beats[k];
          // sign rule: like repels like (bSign 1). "Like" by charge: the two charges multiply (same sign
          // repels, opposite attracts); or by key: lineage likeness (Gaussian in the key difference) x |charges|
          var w = -FL.bSign * myQB;
          if (FL.bLike == 1u) {
            w = -FL.bSign * abs(myQB) * sign(ob.b2a.z + ob.lk.z) * exp(-key_dist2(c.la, c.aux, o.la, o.aux) / (2.0 * FL.bLikeW * FL.bLikeW));
          }
          // step C13: a picky cell (gene pickB > 0) feels only cells whose B lattice is like its own (a Gaussian in the difference of
          // the two B beats' wavevectors: the difference of the lattices', against the same medium)
          if (pickB > 0.0 && w != 0.0) {
            w *= exp(-pickB * lattice_dist2(me.b01.xy, me.b01.zw, me.b2a.xy, ob.b01.xy, ob.b01.zw, ob.b2a.xy) / (1.5 * kB0 * kB0));
          }
          if (w != 0.0) {
            if (ob.b2a.z != 0.0) { let fbv = cell_field_b(ob, c.pos, cutB); gB += w * fbv.xy; bFelt += w * fbv.z; }
            if (ob.lk.z != 0.0) { gB += w * cell_field_leak(ob, c.pos, cutB).xy; }   // its leaked B (rule 1)
          }
        }
        if (d2 < cutR * cutR) {
          let ob = beats[k];
          if (ob.k2a.z > 0.0) {
            // weight: EMW_ALL (step F0: the fates' signs went), receptor tuning by how alike the lattices are, strength, taper
            let tn = tuning(lattice_dist2(rk0, rk1, rk2, ob.k01.xy, ob.k01.zw, ob.k2a.xy), med.k0, rw);
            aFelt += tn * cell_field(ob, c.pos, cutR);
            if (changeOn) { pFelt += tn * cell_field_ph(ob, c.pos, cutR, p_shift(FL.pSgn1)); }
            let wq = myQA * EMW_ALL * tn * ob.k2a.z * cut_taper(d2, cutR);
            if (partner) {
              // step 8: field A and its partner A' on the membrane, with the same weight (S.sense is put on A after)
              if (wq != 0.0) {
                sense_pair(&segQ, &segP, mb, c.pos - ob.q2p.zw, ob.q01.xy, ob.q01.zw, ob.q2p.xy, ob.ph, ob.k2a.w, wq, wq, pSgn);
              }
            } else if (sensing && wq != 0.0 && S.sense * senseA != 0.0) {
              sense_field(&seg, mb, c.pos - ob.q2p.zw, ob.q01.xy, ob.q01.zw, ob.q2p.xy, ob.ph, ob.k2a.w, S.sense * senseA * wq);
            }
          }
        }
        // step 7, exclusion: the distance below which this pair pushes apart (Rt) and how hard (kx)
        var Rt = R0k;
        var kx = 1.0;
        // (step F0: the same TYPE = the same founder line, Bio.rec.w; it was the same fate)
        if ((exclOn || S.xCount != 0u) && bioPrev[beats[k].idx].rec.w == bio.rec.w) {
          let os = cell_state(o.la, o.flags, S.states);
          let same = os == myState;
          if (d2k < shell * shell * R0k * R0k) { nState[min(os, 3u)]++; }
          if (S.xCount != 0u && d2k < 2.56 * R0k * R0k) {
            xAll++;
            if (same) { xSame++; }
            if (d2k < S.reach * S.reach * R0k * R0k) { tAll++; if (same) { tSame++; } }
          }
          if (exclOn) {
            Rt = select(S.pack * R0k, S.exclReach * R0k, same);
            kx = select(1.0, S.excl, same);
          }
        }
        let reach = S.reach * R0k;
        if (d2k >= max(reach * reach, Rt * Rt)) { continue; }
        let dist = sqrt(d2k);
        // step S1: the contact's direction, and where it sits seen from this cell's centre (vC) and from the neighbour's (vO): which side of
        // each faces the other (round: along the centres' line, as before)
        let uk = dk / max(dist, 1e-6);
        let vC = select(d, sA * myK.xy + myK.w * uk, shOn);
        let vO = select(-d, tB * oK.xy - oK.w * uk, shOn);
        if (S.xCount != 0u && shOn && dist < reach && myLong && 2.0 * length(vec2f(o.e1, o.e2)) > 0.405465) {
          let ea2 = vec2f(c.e1, c.e2);
          let eb2 = vec2f(o.e1, o.e2);
          nemN++;
          nemS += i32(round(1000.0 * dot(ea2, eb2) / max(length(ea2) * length(eb2), 1e-9)));   // (a stretch holds 2 phi: cos 2 delta)
        }
        // step S2: the sides that touch (the cilia beat on the free ones), and the touching ciliated neighbours' beat phases
        if (moF != 0u && dist < reach) {
          moTouch |= 1u << wall_side(myTh, vC);
          if (ciliaA > 0.0) {   // (gathered with the coupling off too: the census's wave and sync then show what free-running phases score)
            let mix_ = beats[k].idx;
            if (bioPrev[mix_].mo.w > 0.0) {
              // (the lag along the two cells' MEAN stroke, both fronts as the lean copies hold them: lag_ji = -lag_ij exactly, so a
              // travelling wave can satisfy every pair; along this cell's own stroke alone, neighbours with different fronts each wanted
              // the other ahead and the sheet's edge stayed frustrated, wave order ~ that of random phases)
              let fI = wall_dq8((mine0.y >> 24u) & 255u);
              let fO = wall_dq8((o.wadh.y >> 24u) & 255u);
              let sMean = -0.5 * (vec2f(cos(fI), sin(fI)) + vec2f(cos(fO), sin(fO)));
              let lagK = FL.mo2.y * dot(d, sMean) / S.R;
              let dph = bioPrev[mix_].mc.z - moPhi;
              cpS += sin(dph - lagK);
              cpC += cos(dph - lagK);
              cyS += sin(dph);
              cyC += cos(dph);
              cpN += 1.0;
            }
          }
        }
        // step C7: the touching neighbour across each side (nearest per side), for the pumps across contact
        if (nbrOn && dist < reach) {
          let lv = max(length(vC), 1e-6);
          let ux = select(d.x / max(dist, 1e-6), vC.x / lv, shOn);
          let uy = select(d.y / max(dist, 1e-6), vC.y / lv, shOn);
          let ca = ux * nmxA + uy * nmyA;
          let cb = ux * nmxB + uy * nmyB;
          let cm = max(max(max(ca.x, ca.y), max(ca.z, ca.w)), max(cb.x, cb.y));
          let dn = dist / R0k;
          let oi = beats[k].idx;
          // (only the first side at the largest cos: a tie must not list a neighbour twice)
          var ia = ca >= vec4f(cm);
          ia.y = ia.y && !ia.x;
          ia.z = ia.z && !ia.x && !ia.y;
          ia.w = ia.w && !ia.x && !ia.y && !ia.z;
          let anyA = any(ia);
          var ib = (cb >= vec2f(cm)) & vec2<bool>(!anyA);
          ib.y = ib.y && !ib.x;
          let sa = ia & (vec4f(dn) < nbDA);
          let sb = ib & (vec2f(dn) < nbDB);
          nbDA = select(nbDA, vec4f(dn), sa);
          nbIA = select(nbIA, vec4u(oi), sa);
          nbDB = select(nbDB, vec2f(dn), sb);
          nbIB = select(nbIB, vec2u(oi), sb);
        }

        // contact: 1 when touching, fading to 0 at the reach (cells a hair apart still talk)
        let touch = clamp((reach - dist) / (reach - R0 + 1e-3), 0.0, 1.0);
        // SPECIFIC: my receptor against the neighbour's key (its lattice), a Gaussian in the wavevector difference
        let w = bio.rec.x;
        M += touch * exp(-key_dist2(bio.key.z, bio.key.w, o.la, o.aux) / (2.0 * w * w));
        let ob = bioPrev[beats[k].idx];
        // a parent in case this cell dies this tick: one touching neighbour, picked by weight (reservoir sampling: a
        // candidate of weight w replaces the pick with chance w / the weight seen so far; all weights 1 = uniform)
        if (dist < R0k) {
          let wp = select(1.0, FL.bias + o.bat, biasOn);
          wParent += wp;
          if (rand01(c.seed ^ pcg(S.tick ^ 0x27d4eb2fu), k) * wParent < wp) { parent = k; }
        }
        var pairStick = 0.0;      // step P1: this pair's glue (the adhesion below)
        if (adh) {
          if (dist > 1e-3) {
            // like sticks to like: both cells' stickiness, times how alike their keys are (step F0: no same-fate glue on top)
            let sa = S.adhSigma;
            let like = exp(-key_dist2(c.la, c.aux, o.la, o.aux) / (2.0 * sa * sa));
            var stick = sqrt(max(glue_gene(bio, g0F) * gofP(i, GRN_O_GLUE) * glue_gene(ob, g0F) * gofP(beats[k].idx, GRN_O_GLUE), 0.0)) * like;   // (step T1b: as expressed;
                                                                                                                                  //  step G0: the null's founder value)
            // The pull fades out below 0.85 x contact distance, so sticky cells touch without piling up.
            let near = clamp((dist / R0k - 0.85) / 0.15, 0.0, 1.0);
            if (wallOn) {
              // step C10: the contact holds by the smaller of the two touching sides' effective adhesion (both must be sticky),
              // times the match (the keys' likeness): adhesion = molecules x how well they match
              let ks = wall_side(myTh, vC);
              var mine = select(wB[ks & 1u], wA[ks & 3u], ks < 4u);
              let ko = wall_side(wall_theta(o.flags, (o.wadh.y >> 16u) & 255u), vO);
              var theirs = wall_get(o.wadh.x, o.wadh.y, ko);
              // step G0: a torn side holds nothing (this cell's, or the neighbour's side facing it, from its lean copy)
              if (tearOn) {
                if (jn_torn(jn0, ks)) { mine = 0.0; }
                if (jn_torn(o.kind, ko)) { theirs = 0.0; }
              }
              let gl = min(mine, theirs);
              stick = gl * like;
              // step G0: the junction on side ks forms, holds or tears (see above; only a pulling pair: glue above the base loss)
              let hold = stick - S.adhBase;
              if (tearOn && hold > 0.0) {
                let bit = 1u << ks;
                if (dist < reach) { jnKeep |= bit; }
                if (dist < R0k) { jnMake |= bit; }
                let formed = (jn0 & (bit << JN_FORM_SHIFT)) != 0u;
                if (formed && dist > R0k * (1.0 + FL.g0a.z) && dist < reach && dot(o.vel - c.vel, dk) > 0.0) { jnTear |= bit; }
                if (formed && S.xCount != 0u) {
                  // the census: its strength (the pull's peak, in adhesion units) and its load now (the pull it carries less the contact's
                  // push, as a share of that peak)
                  let tc = clamp((reach - dist) / (reach - R0k + 1e-3), 0.0, 1.0);
                  let nr = clamp((dist / R0k - 0.85) / 0.15, 0.0, 1.0);
                  let push = max(R0k - dist, 0.0) / max(S.adhesion * S.R * hold, 1e-6);
                  jnStr += hold;
                  jnLoad += clamp(tc * nr - push, -1.0, 1.0);
                  jnN++;
                }
              }
              // ... and the side's junction matures while it touches a sticky neighbour
              let wt = touch * clamp(gl / 0.1, 0.0, 1.0);
              tchA += select(vec4f(0.0), vec4f(wt), vec4u(ks) == vec4u(0u, 1u, 2u, 3u));
              tchB += select(vec2f(0.0), vec2f(wt), vec2u(ks) == vec2u(4u, 5u));
              // step C11: the glue turns the cell. The adhesion acts along the whole shared wall, held by bonds anchored in both
              // membranes; where this cell's wall is stickier (and it is the less sticky of the two there, so its own glue is what
              // limits the bonds) the bonds pull harder, off the line between the centres, and the pull turns the cell (r x F, summed
              // along the wall) until its sticky part faces the neighbour. Worked out as the pull's virtual work: the torque is the
              // change of the wall's mean glue (min of the two cells' adhesion, at the wall's two ends 30 degrees either side of the
              // centre line and its middle) as this cell turns, x K h beta / 3 (K the pull per unit of glue, h the wall's half-length,
              // beta 30 degrees), which is the r x F of a glue changing evenly along the wall. Where the neighbour's glue limits, a
              // turn of this cell changes nothing and gives no torque (no endless spinning); the neighbour works out its own torque
              // from the same wall the same way (each cell its own: no race)
              if (glueTurn) {
                let a0 = atan2(vC.y, vC.x);
                let aO = select(a0 + 3.14159265, atan2(vO.y, vO.x), shOn);   // (step S1: where the contact sits on the neighbour)
                let thO = wall_theta(o.flags, (o.wadh.y >> 16u) & 255u);
                let jp = wall_at_a(o.wadh.x, o.wadh.y, thO, aO - 0.5235988);   // the neighbour's glue at the wall's + end
                let jm = wall_at_a(o.wadh.x, o.wadh.y, thO, aO + 0.5235988);   // ... - end
                let jc = wall_at_a(o.wadh.x, o.wadh.y, thO, aO);               // ... middle
                let tp = myTh + TURN_DA;
                let tn = myTh - TURN_DA;
                let gUp = min(wall_at_a(mine0.x, mine0.y, tp, a0 + 0.5235988), jp) + 2.0 * min(wall_at_a(mine0.x, mine0.y, tp, a0), jc)
                        + min(wall_at_a(mine0.x, mine0.y, tp, a0 - 0.5235988), jm);
                let gDn = min(wall_at_a(mine0.x, mine0.y, tn, a0 + 0.5235988), jp) + 2.0 * min(wall_at_a(mine0.x, mine0.y, tn, a0), jc)
                        + min(wall_at_a(mine0.x, mine0.y, tn, a0 - 0.5235988), jm);
                let h = 0.2886751 * dist;               // half the shared wall: a hexagon's side, at the contact's distance
                glueTq += touch * near * like * S.adhesion * S.R * S.stiffness * h * 0.1745329 * (gUp - gDn) / (8.0 * TURN_DA);
              }
              if (S.xCount != 0u) {
                rtA += select(vec4f(0.0), vec4f(touch), vec4u(ks) == vec4u(0u, 1u, 2u, 3u));
                rtB += select(vec2f(0.0), vec2f(touch), vec2u(ks) == vec2u(4u, 5u));
                wPairs++;
                wGlue += u32(round(gl * 1000.0));
                if (wall_mature(myMat, ks) > 0.5) { wMatP++; }
                if (dot(normalize(vC), wFront) > 0.866) { wFrontP++; }
              }
            }
            // (minus a baseline: unlike neighbours push off a little, which lets the tissue sort itself out)
            // (step S1: along the contact's direction, at the contact: off a long cell's centre it turns it)
            let fa = uk * (touch * near * (stick - S.adhBase) * S.adhesion * S.R * S.stiffness * kLine);   // (step S1: along a line contact's length)
            f += fa;
            sTq += sA * (myK.x * fa.y - myK.y * fa.x);
            pairStick = stick;
          }
        }
        // step P1, predators: (a) this cell's HOLD gathers the glue to every touching neighbour; (b) a neighbour wrapping this cell pulls it
        // in, and once its wrap has closed (full progress) this cell is caught (below, with the deaths); (c) a predator looks for a prey (idle)
        // or checks its prey (wrapping): smaller by the area ratio, and out-pulled: drive x (1 - spare x kinship) > the prey's hold (its last
        // tick's, less this pair's own glue) + the hold every cell has
        if (p1On && dist < reach) {
          let oi = beats[k].idx;
          holdG += touch * max(pairStick, 0.0);
          let oe = o.eng.x;
          if (eng_mode(oe) == ENG_WRAP && eng_partner(oe) == i) {
            let pp = eng_prog(oe);
            if (byI == NBR_NONE || pp > byP) { byP = pp; byI = oi; }
            if (dist > 1e-3) { let fw = uk * (FL.p1c.w * S.R * pp); f += fw; sTq += sA * (myK.x * fw.y - myK.y * fw.x); }
            if (eng_progN(oe) >= ENG_FULL && oi < capI) {
              capI = oi;
              capGlue = touch * max(pairStick, 0.0);
              capKin = kin_match_m(myMark, vec4f(ob.mark.xyz, ob.mark.w * gofP(oi, GRN_O_DISP)), 0.5 * R0 / S.R);
            }
          }
          if (seekOn && (myMode == ENG_IDLE || oi == myPart)) {
            var ok = false;
            var margin = 0.0;
            // (step S1: and, with SH_WRAP, at least as LONG as the prey's long axis: its arms must reach round both ends)
            let longEnough = (shF & (SH_ON | SH_WRAP)) != (SH_ON | SH_WRAP) || myK.z + myK.w >= oK.z + oK.w;
            if (S.xCount != 0u && !longEnough && c.r * c.r >= FL.p1.y * o.r * o.r) { noWrap++; }
            if (c.r * c.r >= FL.p1.y * o.r * o.r && longEnough) {
              let hold = max(bitcast<f32>(o.eng.y) - touch * max(pairStick, 0.0), 0.0) + FL.p1.w;
              var kin = 0.0;
              if (mySpare > 0.0) { kin = kin_match_m(myMark, vec4f(ob.mark.xyz, ob.mark.w * gofP(oi, GRN_O_DISP)), 0.5 * R0 / S.R); }
              margin = FL.p1.z * eExpr * (1.0 - mySpare * kin) - hold;
              ok = margin > 0.0;
            }
            if (myMode == ENG_IDLE) { if (ok && margin > bestM) { bestM = margin; bestI = oi; } }
            else { tFound = true; tOk = ok; }
          }
        }

        comp += max(R0k - dist, 0.0) / R0k;
        if (dist >= max(R0k, Rt) || S.stiffness <= 0.0) { continue; }
        // soft contact push: an overlap spring (step 7: to Rt, kx times as hard)
        var u: vec2f;
        if (dist > 1e-3) {
          u = uk;
        } else {
          // exactly on top of each other: push apart in a direction set by the pair
          let a = TAU * rand01(min(i, beats[k].idx) * 7919u + max(i, beats[k].idx), 17u);
          u = vec2f(cos(a), sin(a)) * select(-1.0, 1.0, i < beats[k].idx);
        }
        if (dist < Rt) {
          let fp = u * S.stiffness * kx * (Rt - dist) * (1.0 - FL.p1d.w * wrapP) * kLine;   // (step P1: softer while wrapped; S1: x a line contact's length)
          f -= fp;
          sTq -= sA * (myK.x * fp.y - myK.y * fp.x);   // (step S1: at the contact)
        }
        // contact squeezes the cell along the contact axis (passive deformation; by the real overlap)
        let ov = max(R0k - dist, 0.0) / R0k;
        C -= ov * vec2f(u.x * u.x - u.y * u.y, 2.0 * u.x * u.y);
      }
    }
  }

  if (S.xCount != 0u && xAll > 0u) {
    atomicAdd(&stats.xPairs[0], xAll);
    atomicAdd(&stats.xPairs[1], xSame);
    atomicAdd(&stats.xPairs[2], tAll);
    atomicAdd(&stats.xPairs[3], tSame);
  }
  // step C10: junctions mature. Each side's maturity rises toward 1 while it touches a sticky neighbour (at wl0.z per s, by how
  // fully it touches) and fades toward 0 once the contact is lost (wl0.w per s); off: 0 (the eat pass then asks no extra glue)
  if (wallOn && (wlF & WL_MATURE) != 0u) {
    let tA = min(tchA, vec4f(1.0));
    let tB = min(tchB, vec2f(1.0));
    var mA = vec4f(unpack2x16unorm(myMat[0]), unpack2x16unorm(myMat[1]));
    var mB = unpack2x16unorm(myMat[2]);
    mA = clamp(mA + S.dt * (FL.wl0.z * tA * (1.0 - mA) - FL.wl0.w * (1.0 - tA) * mA), vec4f(0.0), vec4f(1.0));
    mB = clamp(mB + S.dt * (FL.wl0.z * tB * (1.0 - mB) - FL.wl0.w * (1.0 - tB) * mB), vec2f(0.0), vec2f(1.0));
    // step G0: a side that tore (or is still torn) has lost its junction's maturity
    let gone = (jn0 & JN_TORN) | jnTear;
    mA = select(mA, vec4f(0.0), (vec4u(gone) & vec4u(1u, 2u, 4u, 8u)) != vec4u(0u));
    mB = select(mB, vec2f(0.0), (vec2u(gone) & vec2u(16u, 32u)) != vec2u(0u));
    c.mature = array<u32, 3>(pack2x16unorm(mA.xy), pack2x16unorm(mA.zw), pack2x16unorm(mB));
  } else {
    c.mature = array<u32, 3>(0u, 0u, 0u);
  }

  // step G0b, OBSTACLES: the nearest edge that stops cells (its distance and the way out); its edge is a WALL for the honeycomb's corners,
  // as a neighbour's is (the corners facing it stop there and slide toward the tile's corners), so a cell pressed against it goes flat there
  let obF = bitcast<u32>(FL.ob0.x);
  let obOn = (obF & OB_ON) != 0u;
  var obs = vec3f(1e9, 0.0, 0.0);
  // step S1: a long cell (its core segment longer than a twentieth of its radius) samples the edges at its middle and both ends, each a disc
  // of its end radius (weights 1/2, 1/4, 1/4 for the push; a round cell: its centre, its radius, weight 1, as before)
  let capN = select(1, 3, shOn && myK.z > 0.05 * c.r);
  let capR = select(c.r, myK.w, capN == 3);
  var obsK = array<vec3f, 3>(vec3f(1e9, 0.0, 0.0), vec3f(1e9, 0.0, 0.0), vec3f(1e9, 0.0, 0.0));
  var capOff = array<f32, 3>(0.0, myK.z, -myK.z);            // (var: naga refuses a dynamic index into a value array)
  var capW = array<f32, 3>(0.5, 0.25, 0.25);
  for (var q = 0; q < capN; q++) {
    if (!obOn) { break; }
    let ob = obs_at(c.pos + capOff[q] * myK.xy);
    obsK[q] = ob;
    if (q == 0) { obs = ob; }
    let gm = length(ob.yz);
    if (hexShape && (obF & OB_FLAT) != 0u && ob.x > 0.0 && ob.x < 1.4 * capR && gm > 0.3) {
      let uh = -ob.yz / gm;                // toward the edge
      let wall = ob.x + capOff[q] * dot(myK.xy, uh);   // (step S1: the edge's line, its distance from the centre along uh)
      let cuA = uh.x * huX[0] + uh.y * huY[0];
      let cuB = (uh.x * huX[1] + uh.y * huY[1]).xy;
      let bA = wall / max(cuA, vec4f(0.05));
      let bB = wall / max(cuB, vec2f(0.05));
      let okA = cuA > vec4f(0.05);
      let okB = cuB > vec2f(0.05);
      boundA = select(boundA, min(boundA, bA), okA);
      boundB = select(boundB, min(boundB, bB), okB);
      let xA = max(bA / c.r, vec4f(0.2));
      let xB = max(bB / c.r, vec2f(0.2));
      let x4A = (xA * xA) * (xA * xA);
      let x4B = (xB * xB) * (xB * xB);
      let wA = select(vec4f(0.0), 1.0 / (x4A * x4A * x4A), okA & (bA < vec4f(2.5 * c.r)));
      let wB = select(vec2f(0.0), 1.0 / (x4B * x4B * x4B), okB & (bB < vec2f(2.5 * c.r)));
      slideA -= wA * (uh.y * huX[0] - uh.x * huY[0]) / max(cuA, vec4f(0.05));
      slideB -= wB * (uh.y * huX[1] - uh.x * huY[1]).xy / max(cuB, vec2f(0.05));
      swA += wA;
      swB += wB;
    }
  }

  // step 8: the field A and partner A' this cell feels from its neighbours: the mean over the membrane, and the gradient
  // (sum of segment mean x outward normal x length = area x gradient; the outline's area is 2.6 r^2)
  // step C6c: the six corners' walls and slides as arrays again, for the shape (below)
  let bound = array<f32, 6>(boundA.x, boundA.y, boundA.z, boundA.w, boundB.x, boundB.y);
  let slide = array<f32, 6>(slideA.x, slideA.y, slideA.z, slideA.w, slideB.x, slideB.y);
  let sw = array<f32, 6>(swA.x, swA.y, swA.z, swA.w, swB.x, swB.y);
  // (step C6c: a honeycomb cell's outline encloses its rest area, hexSize x pi r^2; the gradient divides by that, and the
  // force is scaled back to the ellipse cell's 2.6 r^2, so a lone cell feels the same push in both shapes)
  let sArea = select(2.598 * c.r * c.r, S.hexSize * 3.14159265 * c.r * c.r, hexShape);
  var pA = vec3f(0.0);                       // A: gradient xy, value z
  var pP = vec3f(0.0);                       // A': gradient xy, value z
  if (partner) {
    for (var a = 0; a < 6; a++) {
      let nrm = vec2f(mb.edge[a].y, -mb.edge[a].x);
      pA += vec3f(segQ[a] * nrm, segQ[a]);
      pP += vec3f(segP[a] * nrm, segP[a]);
      if (sensing) { seg[a] += S.sense * senseA * segQ[a]; }
    }
    pA = vec3f(pA.xy / sArea, pA.z / 6.0);
    pP = vec3f(pP.xy / sArea, pP.z / 6.0);
  }

  var Q = vec2f(0.0);                        // the field's pull on the outline (quadrupole of the membrane signal)
  // step C13, fields as guides: the felt GRADIENT's direction and its strength 0..1 (tanh of the push it would give over the push's
  // saturation: as strongly as the field could push, it guides), for the division and turn gates
  var gDir = vec2f(0.0);
  var gStr = 0.0;
  if (sensing) {
    // force = sum of (segment mean x outward normal x length) = area x gradient, then a saturating response
    var cf = vec2f(0.0);
    for (var a = 0; a < 6; a++) {
      let ed = mb.edge[a];
      cf += seg[a] * vec2f(ed.y, -ed.x);
      // the outward normal's direction, doubled: (cos 2 phi, sin 2 phi)
      Q += seg[a] * vec2f(ed.y * ed.y - ed.x * ed.x, -2.0 * ed.x * ed.y) / max(dot(ed, ed), 1e-6);
    }
    cf *= 1.3 * S.R / max(c.r, 0.1) * (2.598 * c.r * c.r / sArea);
    let cm = length(cf);
    let sat = S.senseMax * S.R;
    // step C13: the push gene (0..2; 1 = as before) scales the push (not the guidance)
    let pushG = select(1.0, clamp(bio.gate2.y, 0.0, 2.0), (fgF & FG_PUSH) != 0u);
    if (cm > 1e-6) {
      f += cf * (pushG * sat * tanh(cm / sat) / cm);
      gDir = cf / cm;
      gStr = tanh(cm / sat);
    }
  }

  // step C6b: the substrate's screened charge field (src/charge.js): a charged cell (Cell.q, from its stock) is pushed
  // down (+) or up (-) the potential's gradient across its membrane (Cell.efield, from the eat pass's plan last tick),
  // qFeel R / s per unit of phi per R, saturating at qSat R / s. Its work is booked with the other forces'
  if (FL.qFeel > 0.0) {
    let fq = -FL.qFeel * c.q * c.efield * S.R;
    let qm = length(fq);
    let qs = FL.qSat * S.R;
    if (qm > 1e-6) { f += fq * (qs * tanh(qm / qs) / qm); }
  }

  // step C6d: the field on the side charges: the neighbours' dipoles (eDD) and the substrate's charge field (-grad phi across
  // the membrane, Cell.efield, saturating: tanh(|grad| / dip1.z), weighted by dip2.y). It turns the dipole toward it (torque
  // d x E: the hexagon turns, below, and the charges turn within the cell) and stretches the cell along it (the stretch target
  // gets the traceless part of E (x) d: a dipole along the field pulls the cell out along it, one across it shears it). The
  // dipoles' push (fDD) moves the cell, saturating; its work is booked with the other forces'
  var eTot = vec2f(0.0);
  var ePhi = vec2f(0.0);
  var es = vec2f(0.0);
  var dTorque = 0.0;
  var dStretch = vec2f(0.0);
  if (dipOn) {
    if (ddOn) {
      eTot = eDD;
      let fd = FL.dip1.x * S.R * fDD;
      let fdm = length(fd);
      let fds = FL.dip1.y * S.R;
      if (fdm > 1e-6) { f += fd * (fds * tanh(fdm / fds) / fdm); }
    }
    let efm = length(c.efield);
    if (FL.dip2.y > 0.0 && efm > 1e-9) {
      ePhi = -c.efield / efm * tanh(efm / max(FL.dip1.z, 1e-6));
      eTot += FL.dip2.y * ePhi;
    }
    if ((dpF & DP_FIELD) != 0u) {
      let em = length(eTot);
      es = select(vec2f(0.0), eTot * (tanh(em) / em), em > 1e-6);
      dTorque = myD.x * es.y - myD.y * es.x;
      dStretch = FL.dip1.w * vec2f(es.x * myD.x - es.y * myD.y, es.x * myD.y + es.y * myD.x);
    }
  }

  // field B's force: area x gradient (the membrane integral, for a field this smooth over the cell), scaled as
  // field A's (x 1.3 R / r), saturating at its own speed
  if (feelB) {
    let fb = FL.bGain * senseB * 3.38 * S.R * c.r * gB;
    let bm = length(fb);
    let bs = FL.bSat * S.R;
    if (bm > 1e-6) { f += fb * (bs * tanh(bm / bs) / bm); }
  }

  // step 8, rule a: the pair A + i A' carries a phase, and where the phase changes it has a direction of travel: the
  // phase current  j = A grad A' - A' grad A  (= |pair|^2 x the phase gradient). The cell is pushed along it, as if
  // carried by the wave: gain x R x (R x phase gradient) per s, softened near zeros of the pair, saturating.
  if (partner && FL.pGain > 0.0) {
    let jc = pA.z * pP.xy - pP.z * pA.xy;
    let fj = FL.pGain * senseP * S.R * S.R * jc / (pA.z * pA.z + pP.z * pP.z + FL.pEps * FL.pEps);
    let jm = length(fj);
    let js = FL.pSat * S.R;
    if (jm > 1e-6) { f += fj * (js * tanh(jm / js) / jm); }
  }

  // step G0: the junctions' word (step F0: the fates' kind word until then; 0 while tearing is off). A torn side heals at random (at g0a.y per
  // s); a formed junction stays while its side keeps touching a glued neighbour, forms where one presses closer than R0, and is gone when it tears
  var jnNew = 0u;
  if (tearOn) {
    var torn = (jn0 & JN_TORN) | jnTear;
    var healed = 0u;
    for (var k = 0u; k < 6u; k++) {
      let bit = 1u << k;
      if ((jn0 & bit) != 0u && rand01(c.seed ^ 0x1b873593u, S.tick * 6u + k) < S.dt * FL.g0a.y) { torn &= ~bit; healed++; }
    }
    let formed = ((((jn0 >> JN_FORM_SHIFT) & jnKeep) | jnMake) & ~torn) & JN_TORN;
    jnNew = torn | (formed << JN_FORM_SHIFT);
    if (jnTear != 0u) { atomicAdd(&stats.g0[G0S_TEARS], countOneBits(jnTear)); }
    if (healed != 0u) { atomicAdd(&stats.g0[G0S_HEALS], healed); }
  }
  c.kind = jnNew;

  // rule 2 (step 6), conversion A -> B: the A felt goes through a leaky integrator (bio.env.z, time constant
  // convTau), and the cell converts above convOn and converts back below convOff (hysteresis, so it does not
  // flicker). A converted cell emits B more strongly, or of the other sign (cell_beat); it shows a blue outline.
  // Rule 3, relay through B: the converted share of the neighbourhood adds to the trigger, so conversion spreads from cell to
  // cell; and a converted cell tires after relayOn s, then rests relayRest s before it can convert again (an
  // excitable medium: fronts travel, and the resting cells behind a front keep it from coming back).
  let kInt = min(1.0, S.dt / max(FL.convTau, 1e-3));
  // step 8, rule b, change makes the partner. Mode 0, felt change: the rates of change of the A and A' felt, as the
  // slopes of their leaky integrators (bio.env.z, bio.conv.y: (now - smoothed) / convTau). The cell emits A' in
  // proportion to the change of A, and A in proportion to the change of A' (with chSign): its phasor z follows
  // (1 + chSign chGain dA'/dt, chGain dA/dt) with time constant chTau, softly capped at chMax from (1, 0).
  // Mode 1, clock: the change happens inside the cell: its A turns into A' and its A' into -A, so its phasor turns at
  // chOmega; the pair it feels, A + i A' (its neighbours' phasors, each seen through its beat), pulls its hand toward
  // theirs turned back by chLag, at up to chGain rad/s. A cell's clock starts at a random hour (bio.conv.z marks it
  // running), so neighbours first disagree and settle into waves. Rule off: z goes back to (1, 0).
  var zt = vec2f(1.0, 0.0);
  var zk = min(1.0, S.dt / max(FL.chTau, 1e-3));
  if (changeOn && FL.chMode == 1u) {
    var ph = atan2(c.z.y, c.z.x);
    if (bio.conv.z == 0.0) { ph = TAU * rand01(c.seed ^ 0x2545f491u, S.tick); bio.conv.z = 1.0; }
    let psi = vec2f(aFelt, pFelt);
    let hl = ph + FL.chLag;
    let pull = (psi.y * cos(hl) - psi.x * sin(hl)) / (length(psi) + 0.05);
    ph += (FL.chOmega + FL.chGain * pull) * S.dt;
    zt = vec2f(cos(ph), sin(ph));
    zk = 1.0;
    bio.conv.y = 0.0;
  } else if (changeOn) {
    let tauC = max(FL.convTau, 1e-3);
    let w = FL.chGain * vec2f(FL.chSign * (pFelt - bio.conv.y) / tauC, (aFelt - bio.env.z) / tauC);
    let wm = length(w);
    zt += select(w, w * (FL.chMax * tanh(wm / FL.chMax) / wm), wm > 1e-6);
    bio.conv.y += (pFelt - bio.conv.y) * kInt;
    bio.conv.z = 0.0;
  } else {
    bio.conv.y = 0.0;
    bio.conv.z = 0.0;
  }
  c.z += (zt - c.z) * zk;
  bio.env.z += (aFelt - bio.env.z) * kInt;
  bio.conv.x += (select(0.0, relaySig / max(relayAll, 1.0), relayOn) - bio.conv.x) * kInt;
  // with the relay, the trigger is measured from convOff (0) to convOn (1), and the relay adds relay x share: a cell
  // that feels the typical A (convOff, the median with convAuto) converts once 1 / relay of its neighbourhood has
  let trigger = select(bio.env.z, (bio.env.z - FL.convOff) / max(FL.convOn - FL.convOff, 1e-3) + FL.relay * bio.conv.x, relayOn);
  let onAt = select(FL.convOn, 1.0, relayOn);
  if (FL.conv <= 0.0) {
    bio.env.w = 0.0;
  } else if (!relayOn) {
    bio.env.w = select(bio.env.w, 1.0, bio.env.w <= 0.0 && trigger > FL.convOn);
    if (bio.env.w > 0.0 && bio.env.z < FL.convOff) { bio.env.w = 0.0; }
  } else if (bio.env.w < 0.0) {
    bio.env.w = min(0.0, bio.env.w + S.dt);                       // resting
  } else if (bio.env.w > 0.0) {
    bio.env.w += S.dt;                                            // converted: tires, then rests
    if (bio.env.w > FL.relayOn) { bio.env.w = -FL.relayRest; }
  } else if (trigger > onAt) {
    bio.env.w = S.dt;                                             // converts
  }
  c.flags = select(c.flags & ~CELL_CONV, c.flags | CELL_CONV, bio.env.w > 0.0);

  // step 7, rule 2, state flip: a cell crowded by its own state (more same-type neighbours within the shell, 1.05 x the
  // exclusion's reach, in its state than in some other) moves, at a random moment (chance S.flip per s), to the state least represented
  // around it (ties broken at random), like a crowded shell spilling into the next. Only the state changes.
  if (exclOn && S.flip > 0.0 && rand01(c.seed ^ 0x3c6ef372u, S.tick) < S.flip * S.dt) {
    let n = max(S.states, 1u);
    let r0 = u32(rand01(c.seed ^ 0xa54ff53au, S.tick) * f32(n));
    var best = myState;
    for (var k = 0u; k < n; k++) {
      let s = (r0 + k) % n;
      if (nState[s] < nState[best]) { best = s; }
    }
    if (nState[myState] > nState[best]) {
      let off = (best + 4u * n - key_bin(c.la, n)) % n;
      c.flags = (c.flags & ~(3u << CELL_FLIP_SHIFT)) | (off << CELL_FLIP_SHIFT);
    }
  }

  // step 8, rule c, sideways push: the partner's force at right angles ((x, y) -> (-y, x): a quarter turn clockwise on
  // screen, as y points down; a negative gain turns the other way). Mode 0: the partner A''s membrane force
  // (area x its gradient, scaled and saturating as field A's) turned 90 degrees. Mode 1: the velocity turned 90 degrees,
  // times the A' felt (softly saturated), so a moving cell's path curls one way where A' is positive, the other where
  // it is negative.
  if (partner && FL.side != 0.0) {
    if (FL.sideMode == 0u) {
      let g = FL.side * senseP * S.sense * 3.38 * c.r * S.R * pP.xy;
      var fs = vec2f(-g.y, g.x);
      let fm = length(fs);
      let sat = S.senseMax * S.R;
      if (fm > 1e-6) { fs *= sat * tanh(fm / sat) / fm; }
      f += fs;
    } else {
      let a = tanh(pP.z / max(abs(pA.z), FL.pEps));
      f += FL.side * senseP * a * vec2f(-c.vel.y, c.vel.x) / max(1.0 - S.damping, 1e-3);
    }
  }

  // gentle pull to the middle, slow drift of the medium (as the reference)
  f += (S.centre - c.pos) * S.pull;
  f += S.drift * S.R * vec2f(sin(c.pos.y * 0.011 + S.time * 0.10), sin(c.pos.x * 0.012 - S.time * 0.08));
  // step N1, CURRENTS (src/water.js): the water's velocity at the cell, x curDrift, as a force (so the cell drifts at curDrift x the
  // water's speed; its work is booked as every force's)
  var uW = vec2f(0.0);       // step G0: the water's velocity here (prescribed + stirred), and the stirred part's push (its work is paid from heat)
  var fStir = vec2f(0.0);
  let stF = bitcast<u32>(FL.g0b.x);
  // step S2: a SWIMMER is free in the water (it pushes on the water, not the floor): it drifts with it by more than a crawler's share,
  // mo1.y of the way to wholly, by its thrust (MO_WATER), and turns with half the water's vorticity (as a small body in a flow does)
  let swimW = (moF & MO_WATER) != 0u && flagA > 0.0;
  let curD = select(HP.curDrift, mix(HP.curDrift, 1.0, clamp(FL.mo1.y * flagA, 0.0, 1.0)), swimW);
  var moTurn = 0.0;         // the motors' turn of the body (rad / s): steering, an off-axis thrust, tilted cilia, the water's vorticity
  if (HP.cur != 0u) {
    uW = water_vel(c.pos);
    if (swimW) {
      let hq = 0.5 * S.R;
      let vort = (water_vel(c.pos + vec2f(hq, 0.0)).y - water_vel(c.pos - vec2f(hq, 0.0)).y
                - water_vel(c.pos + vec2f(0.0, hq)).x + water_vel(c.pos - vec2f(0.0, hq)).x) / (2.0 * hq);
      moTurn += 0.5 * curD * vort;
    }
    if (curD > 0.0) {
      f += curD * uW;
      if ((stF & ST_SPLIT) != 0u) { fStir = curD * stir_vel(c.pos); }
      // step S1: the water drags a long cell along its whole length, so where the flow differs from end to end (shear, eddies) it turns it:
      // the drag's torque about the centre over the length, by two-point Gauss quadrature (at +-h / sqrt 3), each point half the body
      if (capN == 3) {
        let g = 0.57735027 * myK.z;
        let du = water_vel(c.pos + g * myK.xy) - water_vel(c.pos - g * myK.xy);
        sTq += 0.5 * curD * g * (myK.x * du.y - myK.y * du.x);
      }
    }
  }

  // soft walls, 3 R in from the dish edge (step S1: a long cell's at its middle and both ends, weighted as above: off-centre they turn it)
  let mg = 3.0 * S.R;
  if (capN == 1) {
    if (c.pos.x < mg) { f.x += (mg - c.pos.x) * S.wall; } else if (c.pos.x > S.W - mg) { f.x -= (c.pos.x - S.W + mg) * S.wall; }
    if (c.pos.y < mg) { f.y += (mg - c.pos.y) * S.wall; } else if (c.pos.y > S.H - mg) { f.y -= (c.pos.y - S.H + mg) * S.wall; }
    if (obOn && obs.x < c.r) {
      let gm = length(obs.yz);
      if (gm > 1e-4) { f += (c.r - obs.x) * FL.ob0.z * obs.yz / gm; }
    }
  }
  for (var q = 0; q < capN; q++) {
    if (capN == 1) { break; }
    let pq = c.pos + capOff[q] * myK.xy;
    var fw = vec2f(0.0);
    if (pq.x < mg) { fw.x += (mg - pq.x) * S.wall; } else if (pq.x > S.W - mg) { fw.x -= (pq.x - S.W + mg) * S.wall; }
    if (pq.y < mg) { fw.y += (mg - pq.y) * S.wall; } else if (pq.y > S.H - mg) { fw.y -= (pq.y - S.H + mg) * S.wall; }
    // step G0b: the obstacles' contact push, a spring from the edge (ob0.z per s) while the centre is nearer than the cell's radius (booked as
    // work, as the dish's wall)
    if (obOn && obsK[q].x < capR) {
      let gm = length(obsK[q].yz);
      if (gm > 1e-4) { fw += (capR - obsK[q].x) * FL.ob0.z * obsK[q].yz / gm; }
    }
    f += capW[q] * fw;
    sTq += capW[q] * capOff[q] * (myK.x * fw.y - myK.y * fw.x);
  }

  // stirring: the pointer drags cells within reach along with it
  let p = c.pos - S.pointer;
  let pd2 = dot(p, p);
  if (pd2 < S.stirR2) { f += S.pvel * (1.0 - pd2 / S.stirR2) * S.stir; }

  // body traits: size and motility from the genome (step F0: no fate-typical factor on top)
  var size = 1.0;
  var mot = 1.0;
  if (S.body > 0.0) {
    size = mix(1.0, bio.body.y, S.body);
    mot = mix(1.0, bio.body.z * gofP(i, GRN_O_MOT), S.body);   // (step T1b: the motility as expressed)
  }
  // crawling: each cell slowly wanders on its own heading (Bio.body.w), a persistent random walk, so the
  // tissue stays fluid enough for cells to change neighbours and sort out
  var motor = vec2f(0.0);    // the cell's own motor, in units of R / s (before motility and the battery's gate)
  if (S.crawl > 0.0) {
    let g = sqrt(-2.0 * log(max(rand01(c.seed ^ 0x9e3779b9u, S.tick), 1e-7))) * cos(TAU * rand01(c.seed ^ 0x85ebca6bu, S.tick));
    bio.body.w += g * sqrt(2.0 * S.turnRate * S.dt);
    bio.body.w -= TAU * floor(bio.body.w / TAU);
    motor += S.crawl * vec2f(cos(bio.body.w), sin(bio.body.w));
  }
  // step C5, smell: the fuel gradient the membrane's 6 corners smelled (the eat pass's plan, last tick; energy per R^2
  // per R) steers the motor up toward the fuel (tanh: gentle, saturating)
  if ((FL.eat & EAT_SMELL) != 0u && FL.smell > 0.0) {
    let gm = length(c.smell);
    if (gm > 1e-9) { motor += FL.smell * chemo_factor(bio) * tanh(gm / max(FL.smellHalf, 1e-6)) * c.smell / gm; }   // (step N2: x the gene)
  }
  // step C5: the battery gates the motor (full speed from FL.crawlFull of the battery, none when it is empty) and pays
  // for it: crawlCost x the work of crawling at that speed against the drag (its motion energy x (1 - damping^2) per
  // tick), paid by the eat pass after this step (Cell.pay)
  let payOn = (FL.eat & EAT_PAY) != 0u;
  let gate = select(1.0, clamp(c.bat / max(FL.crawlFull, 1e-3), 0.0, 1.0), payOn);
  let fMotor = motor * S.R * mot * gate;
  f += fMotor;
  c.pay = select(0, heat_counts(FL.crawlCost * heat_ke(fMotor) * (1.0 - S.damping * S.damping)), payOn);
  // step S2, MOTORS. The FLAGELLUM thrusts the cell along its front (pusher or puller alike: the sign says where its motor sits and how it
  // stirs the water), at mo0.y R / s x its thrust as acted x the battery's gate; its front STEERS toward the crawling intention (the
  // heading's slow wander and the smell: the senses a crawler already steers by), and a motor set off the axis (the placement gene) turns
  // it (r x F over the rotational drag: curved runs). The CILIA beat on the FREE sides (touching no neighbour): each pushes the water along
  // the surface, straight back along the front (or tilted round the body by the tilt gene), x (1 + cos phase), and the cell the other way
  // (a free cell swims, a cell held in a tissue pumps the water past it). Their beat's phase runs at mo1.w Hz (each cell 0.9..1.1 x) and,
  // with the coupling gene, follows the touching ciliated neighbours' phases less the lag (Kuramoto-like: sin of the difference), so a sheet's
  // edge can settle into a METACHRONAL wave. Costs: the swim pays mo2.z x crawlCost per unit of its work (as crawling), the cilia an upkeep
  // per beat (mo2.w per s at beat 1 on six free sides); both from the battery as heat (Cell.pay); the work itself is booked as every force's
  var fSwim = vec2f(0.0);
  var fCil = vec2f(0.0);
  var cilF = array<vec2f, 6>(vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));   // each side's push on the water (px / s)
  var moPay = 0.0;
  let moFree = select(0u, ~moTouch & 63u, ciliaA > 0.0);
  var moPhiN = moPhi;
  var swimV = 0.0;
  if (moF != 0u) {
    let ef = -moStroke;
    if (flagA > 0.0) {
      swimV = flagA * FL.mo0.y * gate;
      fSwim = swimV * S.R * ef;
      if ((moF & MO_STEER) != 0u && dot(motor, motor) > 1e-8) {
        let md = normalize(motor);
        moTurn += FL.mo0.z * flagA * (ef.x * md.y - ef.y * md.x);
      }
      if ((moF & MO_TORQUE) != 0u) {
        let pl = clamp(bio.mo.z, -1.0, 1.0) * 1.5707963;
        let mm = select(0.5 * c.r * c.r, cap_moment(myK), shOn && myK.z > 0.0);
        moTurn -= c.r * swimV * S.R * sin(pl) / max(mm, 1e-6);
      }
      moPay += FL.mo2.z * FL.crawlCost * heat_ke(fSwim) * (1.0 - S.damping * S.damping);
    }
    if (ciliaA > 0.0) {
      let beat = 1.0 + cos(moPhi);
      let amp = ciliaA * FL.mo1.z * S.R * beat * gate / 6.0;
      let tl = clamp(bio.mc.y, -1.0, 1.0) * 1.5707963;
      let ct = cos(tl);
      let st = sin(tl);
      var tq = 0.0;
      var nf = 0.0;
      for (var k = 0u; k < 6u; k++) {
        if (((moFree >> k) & 1u) == 0u) { continue; }
        let mk = mb.mid[k];
        let um = mk / max(length(mk), 1e-6);
        let tg = vec2f(-um.y, um.x);
        let fk = amp * (ct * dot(moStroke, tg) * tg + st * tg);
        cilF[k] = fk;
        fCil -= fk;
        tq -= mk.x * fk.y - mk.y * fk.x;
        nf += 1.0;
      }
      if ((moF & MO_TORQUE) != 0u) {
        let mm = select(0.5 * c.r * c.r, cap_moment(myK), shOn && myK.z > 0.0);
        moTurn += tq / max(mm, 1e-6);
      }
      moPay += FL.mo2.w * ciliaA * ciliaA * gate * (nf / 6.0) * S.dt;
      // the beat's phase: its own frequency, and the coupling toward the touching neighbours' (less the lag)
      var om = TAU * FL.mo1.w * (0.9 + 0.2 * f32(pcg(c.seed ^ 0x6d6f7431u) & 1023u) / 1023.0);
      if ((moF & MO_COUPLE) != 0u && cpN > 0.0) { om += FL.mo2.x * clamp(bio.mc.x, -1.0, 1.0) * cpS / cpN; }
      moPhiN = moPhi + om * S.dt;
      moPhiN -= TAU * floor(moPhiN / TAU);
    }
    f += fSwim + fCil;
    if (payOn) { c.pay += heat_counts(moPay); }
  }
  // viscous, nearly overdamped motion, in three parts whose energies the heat band books (step C1; energy 0.5 (v/10)^2):
  //   drag   v1 = damping x v0: the motion it takes (L) becomes heat under the cell
  //   force  v2 = v1 + (1 - damping) f: the work the forces do (W: fields, contact, crawling, stirring) comes in
  //   kick   v3 = v2 + u, u random in direction (heat is the incoherent band) and in size from the heat under the cell
  //          (its 3 x 3 pixels; a share HP.grab of it on average): the kick's energy K is taken from that heat
  // With the kicks off (Shift+H) the old constant jitter moves the position instead (no energy involved).
  let hxy = heat_xy(HP, c.pos);
  var hidx: array<u32, 9>;
  var hsum = 0;
  for (var q = 0; q < 9; q++) {
    let p = clamp(hxy + vec2i(q % 3 - 1, q / 3 - 1), vec2i(0), vec2i(i32(HP.hw) - 1, i32(HP.hh) - 1));
    hidx[q] = u32(p.y) * HP.hw + u32(p.x);
  }
  let kicks = (HP.flags & 1u) != 0u;
  if (kicks) {
    for (var q = 0; q < 9; q++) { hsum += atomicLoad(&hb[S.heatCur + hidx[q]]); }
  }
  let v0 = c.vel;
  let v1 = v0 * S.damping;
  let v2 = v1 + f * (1.0 - S.damping);
  var v3 = v2;
  if (kicks) {
    // mean kick energy grab x heat; per axis the kick is Gaussian with sigma = HEAT_V0 sqrt(energy) (x motility)
    let ek = HP.grab * max(f32(hsum), 0.0) / HEAT_SCALE;
    let sig = min(HEAT_V0 * sqrt(ek) * mot, HP.kickMax);
    let u1 = max(rand01(c.seed ^ 0x6a09e667u, S.tick), 1e-7);
    let u2 = rand01(c.seed ^ 0xbb67ae85u, S.tick);
    v3 = v2 + sig * sqrt(-2.0 * log(u1)) * vec2f(cos(TAU * u2), sin(TAU * u2));
  }
  let eDrag = heat_ke(v0) - heat_ke(v1);
  let eWork = heat_ke(v2) - heat_ke(v1);
  let eKick = heat_ke(v3) - heat_ke(v2);
  // step G0, CELLS STIR THE WATER (src/stir.js): the cell's drag on the water, the reaction of its driven motion (before the heat's kick: the
  // kicks are incoherent) RELATIVE to the water: wet x (v - u), x its footprint's share of a stir node's area, put down on the 4 nodes round it
  // (bilinear, fixed point, summed over the frame's ticks; the stir passes turn its curl into vorticity). A crawler's motor pushes on the floor,
  // but its body still moves through the water, so it drags the water by the WET share of its drag (the same share by which the water drags it:
  // curDrift); a cell that drifts with the water drags nothing
  if ((stF & ST_ON) != 0u && bitcast<u32>(FL.g0c.z) != 0u) {
    let sw = bitcast<u32>(FL.g0c.x);
    let sh = bitcast<u32>(FL.g0c.y);
    let so = bitcast<u32>(FL.g0c.z);
    let vr = v2 - uW;
    let vm = length(vr);
    let lim = 10.0 * S.R;
    let vc = select(vr, vr * (lim / vm), vm > lim);
    let wetS = select(FL.g0b.y, mix(FL.g0b.y, 1.0, clamp(FL.mo1.y * flagA, 0.0, 1.0)), swimW);   // (step S2: a swimmer's own share)
    let cov = (3.14159265 * c.r * c.r / (FL.g0b.z * FL.g0b.z)) * FL.g0b.w;
    let m = wetS * vc * cov;
    let gp = clamp(c.pos / FL.g0b.z, vec2f(0.0), vec2f(f32(sw - 1u), f32(sh - 1u)) - 1e-3);
    let gb = vec2u(floor(gp));
    let gt = gp - vec2f(gb);
    let n = sw * sh;
    let wq = array<f32, 4>((1.0 - gt.x) * (1.0 - gt.y), gt.x * (1.0 - gt.y), (1.0 - gt.x) * gt.y, gt.x * gt.y);
    let oq = array<u32, 4>(0u, 1u, sw, sw + 1u);
    let o0 = gb.y * sw + gb.x;
    for (var q = 0; q < 4; q++) {
      let mq = vec2i(round(m * wq[q]));
      if (mq.x != 0) { atomicAdd(&hb[so + o0 + oq[q]], mq.x); }
      if (mq.y != 0) { atomicAdd(&hb[so + n + o0 + oq[q]], mq.y); }
    }
    // step S2: the motors push the water the other way (a swimmer is FORCE-FREE: its motor pushes the water back as hard as its body drags it
    // forward, so it stirs as a force DIPOLE: a PUSHER's motor behind it pushes the water out along its axis, a PULLER's in front draws it in),
    // and each beating side's cilia push the water along the surface (a tissue edge pumps it past itself)
    if (flagA > 0.0 && (moF & MO_DIPOLE) != 0u) {
      let sg = select(-1.0, 1.0, bio.mo.y >= 0.0);
      stir_put(c.pos + sg * FL.mo0.w * S.R * moStroke, -FL.mo1.x * wetS * fSwim * cov, sw, sh, so);
    }
    if (ciliaA > 0.0 && (moF & MO_PUMP) != 0u) {
      for (var k = 0u; k < 6u; k++) {
        if (((moFree >> k) & 1u) == 0u) { continue; }
        stir_put(c.pos + mb.mid[k], FL.g0b.y * cilF[k] * cov, sw, sh, so);
      }
    }
  }
  // ... and what the STIRRED water's push did on the cell this tick (its share of the forces' work) is taken from the heat under it: the
  // water's motion came from the stirring cells' work, which their drag had made heat (exact: the same counts leave the heat and the work in)
  var cStir = 0;
  if (any(fStir != vec2f(0.0))) {
    cStir = heat_counts(heat_ke(v2) - heat_ke(v2 - fStir * (1.0 - S.damping)));
  }
  c.vel = v3;
  if (kicks) {
    c.pos += c.vel * S.dt;
  } else {
    let jit = vec2f(rand01(c.seed, S.tick * 2u), rand01(c.seed, S.tick * 2u + 1u)) - 0.5;
    c.pos += c.vel * S.dt + jit * S.jitter * S.R * mot;
  }
  c.pos = clamp(c.pos, vec2f(0.0), vec2f(S.W, S.H));
  // step G0b: ... and never nearer an edge than ob0.w x the radius (the position alone is put back, at most half a radius a tick, so a cell
  // painted over walks out along the way out; nothing is booked: no velocity changes)
  if (obOn) {
    for (var k = 0; k < capN; k++) {
      let q = obs_at(c.pos + capOff[k] * myK.xy);
      let lim = FL.ob0.w * capR;
      let gm = length(q.yz);
      if (q.x < lim && gm > 1e-4) { c.pos = clamp(c.pos + min(lim - q.x, 0.5 * capR) * q.yz / gm, vec2f(0.0), vec2f(S.W, S.H)); }
    }
  }
  var eDeath = 0.0;          // the motion of a cell that dies this tick (its daughter starts at rest) becomes heat too
  // (step C12e: osmosis, the eat pass's Cell.osm: a cell swollen by its ions grows toward its rest size x sqrt(1 + swelling), a shrunk
  // one shrinks; smoothly, at the same rate. 0 while osmosis is off)
  let swell = sqrt(max(1.0 + c.osm, 0.25));
  c.r += (S.R * size * swell - c.r) * min(1.0, S.dt * 0.8);

  // shape: an area-preserving stretch e = (e1, e2), relaxing toward a target made of the passive contact
  // squeeze and (active, key W) a stretch along the cell's own motion and toward where the field pulls on its
  // outline; muscle stretches along its crawling heading. As the reference's step(); length capped at 0.5.
  // (step C6c: a honeycomb cell has no passive squeeze in its target: contact presses its sides flat instead, below)
  var dTh = 0.0;                             // step C10: how far the hexagon turned this tick (the front turns with it)
  // step C11: the glue's torque turns the BODY, overdamped: at turning strength / rotational drag (wl1.w) x torque / (r^2 / 2)
  // (a disc's rotational drag on its substrate, against the drag 1 the motion has: velocity = force), at most TURN_MAX
  var wTurn = 0.0;
  if (glueTurn) { wTurn = clamp(FL.wl1.w * glueTq / max(0.5 * c.r * c.r, 1e-6), -TURN_MAX, TURN_MAX); }
  // step C13, the turn gate: the front turns toward the felt gradient (gene > 0) or away from it (< 0), at the gate's rate x |gene| x
  // the gradient's strength x the sine of the angle between them (with the glue's turning on, the body turns, front and outline
  // together; else the front alone)
  var gTurn = 0.0;
  if ((fgF & FG_TURN) != 0u && wallOn && gStr > 0.0) {
    gTurn = FL.fg0.z * clamp(bio.gate2.x, -1.0, 1.0) * gStr * (gDir.y * cos(c.front) - gDir.x * sin(c.front));
    if (glueTurn) { wTurn = clamp(wTurn + gTurn, -TURN_MAX, TURN_MAX); }
  }
  var dFront = 0.0;                          // ... and how far the body (and so the front) turned
  // step S1, CELL SHAPE: the TURN the off-centre forces give a long cell (contacts, obstacles, the dish's wall, the water's shear): their
  // torque over the capsule's rotational drag (its second moment of area per area: as the motion has velocity = force, the turning rate is
  // torque / that; r^2 / 2 for a disc, as C11's glue turning), overdamped, at most TURN_MAX. The body turns (outline, front, stretch)
  var sTurn = 0.0;
  if (shOn && (shF & SH_TORQUE) != 0u && myK.z > 0.0) {
    sTurn = clamp(S.shapeTurn * sTq / max(cap_moment(myK), 1e-6), -TURN_MAX, TURN_MAX);
  }
  if (moTurn != 0.0) { sTurn = clamp(sTurn + moTurn, -TURN_MAX, TURN_MAX); }   // step S2: the motors' turn (steering, placement, tilt, vorticity)
  let sRot = 2.0 * sTurn * S.dt;             // (a stretch, a traceless tensor, turns by twice the angle)
  let sRotCS = vec2f(cos(sRot), sin(sRot));
  // ... and the ELONGATION the cell asks for: its gene (Bio.relay.y, ln of the aspect, 0 = round .. ln 4) x the gene network's 18th output
  // (SHAPE), as a stretch of half that along its FRONT (C10/C11), so the glue's turning and the division along the front carry the spindle's
  // axis; the neutral control asks for the founders' round shape (the gene drifts unseen)
  let eG = myAsk;
  let capE = select(0.5, max(0.5, eG), shOn);   // the largest stretch (0.5 as before; a spindle: what it asks for, up to 0.5 ln 4)
  var t = select(0.5 * C, vec2f(0.0), hexShape);
  if (eG > 0.0) { t += eG * vec2f(cos(2.0 * c.front), sin(2.0 * c.front)); }
  t += dStretch;                             // step C6d: a polarised cell in a field stretches along it
  if (S.activeGain > 0.0) {
    let spd = length(c.vel);
    if (spd > 0.01) {
      let mv = 0.25 * tanh(spd / (2.0 * S.R)) / (spd * spd);
      t += S.activeGain * mv * vec2f(c.vel.x * c.vel.x - c.vel.y * c.vel.y, 2.0 * c.vel.x * c.vel.y);
    }
    let qm = length(Q);
    if (qm > 1e-6) { t += S.activeGain * (0.35 * tanh(qm / 1.5) / qm) * Q; }
  }
  if (!hexShape) {
    var e = vec2f(c.e1, c.e2);
    if (sTurn != 0.0) { e = vec2f(e.x * sRotCS.x - e.y * sRotCS.y, e.x * sRotCS.y + e.y * sRotCS.x); dFront = sTurn * S.dt; }
    e += (t - e) * min(1.0, S.dt * S.shapeRate);
    let em = length(e);
    if (em > capE) { e *= capE / em; }
    c.e1 = e.x;
    c.e2 = e.y;
  } else {
    // step C6c, elastic honeycomb cells. The active stretch follows its target as the ellipse's did; the rest shape is the
    // hexagon on that stretch's ellipse at the rest area A0
    var ea0 = c.ea;
    if (sTurn != 0.0) { ea0 = vec2f(ea0.x * sRotCS.x - ea0.y * sRotCS.y, ea0.x * sRotCS.y + ea0.y * sRotCS.x); }   // (step S1: turned with the body)
    var ea = ea0 + (t - ea0) * min(1.0, S.dt * S.shapeRate);
    let eam = length(ea);
    if (eam > capE) { ea *= capE / eam; }
    c.ea = ea;
    let A0 = S.hexSize * 3.14159265 * c.r * c.r;
    let rest = hex_rest(ea, hu, A0);
    // each corner's target: the nearest neighbour's wall along its direction (bound: the edge of the cell's power-diagram
    // tile there) when that wall is near: nearer than the rest place, the wall stops the corner there (contact presses the
    // side flat); a little further (up to hexSnap x the rest place), the wall still draws the corner out, less the further
    // it is (touching cells close the gap and share the wall, as cells in a tissue do); beyond, the corner is free, at its
    // rest place. The free corners all scale by one factor s (hexBulge at most) until the area is A0 again, so a cell
    // pressed flat on some sides bulges on the others
    var tgt: array<f32, 6>;
    var s = 1.0;
    for (var it = 0; it < 5; it++) {
      for (var k = 0; k < 6; k++) { tgt[k] = hex_target(s * rest[k], bound[k], S.hexSnap); }
      if (it < 4) { s = clamp(s * sqrt(A0 / max(hex_area(tgt, hu), 1e-9)), 0.75, S.hexBulge); }
    }
    // the corners are underdamped springs toward their targets (hex.x = omega^2, hex.y = the damping), and lag the centre's
    // change of velocity (jelly, hex.w: drag and forces, not the heat kick), so a pushed cell wobbles and settles. A wall
    // stops a corner (it can only move back in); purely the shape's motion: nothing here pushes the cell or is booked
    let dv = v2 - v0;
    var rad = c.rad;
    var rv = c.radV;
    // step C6c, membrane chemistry: the stiffness is the cell's own (genetic elasticity: from its membrane's material and
    // its stiffness gene; omega^2 x kc, the damping x sqrt(kc), so every cell keeps the damping ratio), and a damaged side
    // is softer: corner k (between sides k - 1 and k) x (soft + (1 - soft) x their mean integrity)
    let mbF = bitcast<u32>(FL.memb.x);
    let kc = select(1.0, memb_stiff(bio.memb, FL.memb.y), (mbF & MB_ELASTIC) != 0u);
    let softOn = (mbF & MB_SOFT) != 0u;
    let ig = c.integ;
    // step C12b: with the lipid membranes, each side's stiffness is derived from its lipids (the eat pass: Cell.lip, which holds the
    // integrity, the heat, the thickness and the stiffness gene already): corner k takes the mean of its two sides'
    let lipK = (mbF & MB_LIPID) != 0u && (mbF & MB_ELASTIC) != 0u;
    for (var k = 0; k < 6; k++) {
      var kk = kc;
      if (softOn) { kk *= FL.memb.z + (1.0 - FL.memb.z) * 0.5 * (ig[(k + 5) % 6] + ig[k]); }
      if (lipK) { kk = max(0.5 * LIP_KMAX * (unpack4x8unorm(c.lip[(k + 5) % 6]).x + unpack4x8unorm(c.lip[k]).x), 0.25); }
      let acc = -FL.hex.x * kk * (rad[k] - tgt[k]) - FL.hex.y * sqrt(kk) * rv[k];
      rv[k] += acc * S.dt - FL.hex.w * dot(dv, hu[k]);
      rad[k] += rv[k] * S.dt;
      if (rad[k] > bound[k]) { rad[k] = bound[k]; rv[k] = min(rv[k], 0.0); }
    }
    // kept convex (a corner never sinks inside the line between its two neighbours) and within the drawn quad
    for (var k = 0; k < 6; k++) {
      let ka = (k + 5) % 6;
      let kb = (k + 1) % 6;
      let sa = hu[ka].x * hu[k].y - hu[ka].y * hu[k].x;       // sin of the angle from the corner before
      let sb = hu[k].x * hu[kb].y - hu[k].y * hu[kb].x;       // ... to the corner after
      let sab = hu[ka].x * hu[kb].y - hu[ka].y * hu[kb].x;    // ... across both
      let lo = max(0.3 * c.r, 1.05 * rad[ka] * rad[kb] * sab / max(rad[ka] * sa + rad[kb] * sb, 1e-6));
      if (rad[k] < lo) { rad[k] = lo; rv[k] = max(rv[k], 0.0); }
      let rTop = select(2.2, max(2.2, 1.2 * exp(S.eCap)), shOn) * c.r;   // (step S1: a spindle's poles reach further)
      if (rad[k] > rTop) { rad[k] = rTop; rv[k] = min(rv[k], 0.0); }
    }
    c.rad = rad;
    c.radV = rv;
    // each corner slides round toward the corner of its tile while a wall is near (the soft-nearest walls' slope, above), and
    // back toward its regular place when free; neighbouring corners also keep apart (toward even spacing, HEX_SPACE), so two
    // corners do not crowd into one tile corner while a long wall keeps a corner in its middle (a 5-sided tile then reads
    // as a pentagon, not a triangle). The mean slide goes into theta, so theta stays the hexagon's mean direction
    let al0 = c.alpha;
    var al = al0;
    var mean = 0.0;
    for (var k = 0; k < 6; k++) {
      let near = 1.0 - smoothstep(s * rest[k], S.hexSnap * s * rest[k], bound[k]);
      let sl = select(0.0, slide[k] / sw[k], sw[k] > 0.0);
      let even = 0.5 * (al0[(k + 5) % 6] + al0[(k + 1) % 6]) - al0[k];
      al[k] += (HEX_SLIDE_RATE * near * clamp(sl, -1.0, 1.0) - HEX_SLIDE_BACK * (1.0 - near) * al0[k] + HEX_SPACE * even) * S.dt;
      mean += al[k];
    }
    mean /= 6.0;
    for (var k = 0; k < 6; k++) { al[k] = clamp(al[k] - mean, -HEX_SLIDE, HEX_SLIDE); }
    c.alpha = al;
    // the hexagon turns toward its neighbours (mean pull over the touching ones), damped
    let tq = torque / max(tw, 1.0);
    if (glueTurn) {
      // step C11: the BODY turns by the glue's torque and the dipole field's (C6d's, at the turning rate its pull reached against
      // the damping), and the hexagon with it; the hexagon's own pull toward its neighbours (above) and its corners' slides only
      // fit the outline to its tile, so they turn the outline, not the body (and not the front)
      c.spin += (FL.hex.z * tq - S.hexTurnDamp * c.spin) * S.dt;
      dFront = (wTurn + FL.dip0.w * dTorque / max(S.hexTurnDamp, 1e-3)) * S.dt;
      if (sTurn != 0.0) { dFront += sTurn * S.dt; }   // (step S1: the off-centre forces turn the body too)
      dTh = c.spin * S.dt + mean + dFront;
    } else {
      c.spin += (FL.hex.z * tq + FL.dip0.w * dTorque - S.hexTurnDamp * c.spin) * S.dt;   // (step C6d: + the field's torque)
      dTh = c.spin * S.dt + mean;
      if (sTurn != 0.0) { dTh += sTurn * S.dt; }       // (step S1)
      dFront = dTh;
    }
    c.theta += dTh;
    c.theta -= TAU * floor(c.theta / TAU);
    // the stretch e1, e2 (the strained lattice k = F^-1 k0, the census) from the outline's second moment of area about the
    // centre, M (a multiple of I for a regular hexagon), normalised to determinant 1: M = exp(2 e). Each triangle (centre, a,
    // b) adds its area / 12 x (2 a a + 2 b b + a b + b a)
    var M = vec3f(0.0);
    for (var k = 0; k < 6; k++) {
      let a = rad[k] * hu[k];
      let b = rad[(k + 1) % 6] * hu[(k + 1) % 6];
      let ar = max(a.x * b.y - a.y * b.x, 0.0);
      M += ar * vec3f(2.0 * (a.x * a.x + b.x * b.x) + 2.0 * a.x * b.x, 2.0 * (a.x * a.y + b.x * b.y) + a.x * b.y + a.y * b.x,
                      2.0 * (a.y * a.y + b.y * b.y) + 2.0 * a.y * b.y);
    }
    let nrm = sqrt(max(M.x * M.z - M.y * M.y, 1e-12));
    let eps = 0.5 * acosh(max(0.5 * (M.x + M.z) / nrm, 1.0));
    let tl = vec2f(0.5 * (M.x - M.z), M.y);
    let tlm = length(tl);
    let e = select(vec2f(0.0), tl * (min(eps, capE) / max(tlm, 1e-12)), tlm > 1e-9 * (M.x + M.z));
    c.e1 = e.x;
    c.e2 = e.y;
  }

  // step C10: the FRONT. It is a direction fixed in the body (it turns as the hexagon turns, and a daughter inherits it), and the
  // gene w lets the charge dipole (step C6d) pull it round: toward the dipole's + end at wl0.y x w x |d| rad/s x sin of the angle
  // between them. So w = 0: the inherited orientation alone; w = 1 and a strong dipole: the front follows the dipole within a few
  // seconds; a weak or passing dipole barely moves it (the front is a persistent property of the cell)
  // (step S1: with the shape on the front also turns while the walls are off: it carries the spindle's axis)
  if (wallOn || shOn) {
    var fr = c.front + select(dFront, wTurn * S.dt + dFront, glueTurn && !hexShape);   // (an ellipse cell: the glue turns the front alone)
    if (!glueTurn) { fr += gTurn * S.dt; }     // step C13: the turn gate, without the glue's turning: the front alone
    if (wallOn && (wlF & WL_FRONT) != 0u && dipOn && myDm > 1e-3) {
      fr += FL.wl0.y * clamp(bio.wall.z, 0.0, 1.0) * min(myDm, 1.0) * sin(atan2(myD.y, myD.x) - fr) * S.dt;
    }
    c.front = fr - TAU * floor(fr / TAU);
  }

  // step C6d: the charges also move WITHIN the cell (they are free to move inside, and a packed cell's hexagon is held by its
  // neighbours): the dipole part of the side charges' pattern turns toward the field by dip2.x x torque x dt (at most 0.2 rad
  // a tick), and the field POLARISES the cell: it pulls the mobile charge toward a dipole along it, a source of dip2.z x dt x
  // (E . u_k) on side k (u_k its direction), which the eat pass's evening out (dpRelax) balances at a dipole of `polar` x
  // pHalf in a full field (and its cap, by the charge the cell really holds, bounds). Their sum (the cell's net charge, which
  // the eat pass keeps) is unchanged
  let polOn = (dpF & DP_FIELD) != 0u && FL.dip2.z > 0.0 && dot(es, es) > 1e-8;
  if (dipOn && ((dTorque != 0.0 && FL.dip2.x > 0.0) || polOn)) {
    let da = clamp(FL.dip2.x * dTorque * S.dt, -0.2, 0.2);
    var sq = c.sideQ;
    var mean = 0.0;
    for (var k = 0; k < 6; k++) { mean += sq[k]; }
    mean /= 6.0;
    var u: array<vec2f, 6>;
    var p1 = vec2f(0.0);
    for (var k = 0; k < 6; k++) {
      u[k] = mb.mid[k] / max(length(mb.mid[k]), 1e-6);
      p1 += (sq[k] - mean) * u[k];
    }
    var pp = vec2f(-p1.y, p1.x) * (da / 3.0);
    if (polOn) { pp += es * (FL.dip2.z * S.dt); }
    var inc: array<f32, 6>;
    var im = 0.0;
    for (var k = 0; k < 6; k++) { inc[k] = pp.x * u[k].x + pp.y * u[k].y; im += inc[k]; }
    im /= 6.0;
    for (var k = 0; k < 6; k++) { sq[k] += inc[k] - im; }
    c.sideQ = sq;
  }
  if (dCount && (c.flags & CELL_ALIVE) != 0u) {
    atomicAdd(&stats.dip[STATS_D_ALL], 1u);
    atomicAdd(&stats.dip[STATS_D_SUM], u32(round(myDm * 1000.0)));
    if (myDm > DIP_MIN) {
      atomicAdd(&stats.dip[STATS_D_POL], 1u);
      atomicAdd(&stats.dip[STATS_D_EDD], u32(round(min(length(eDD), 100.0) * 1000.0)));
      atomicAdd(&stats.dip[STATS_D_EPHI], u32(round(length(ePhi) * 1000.0)));
      atomicAdd(&stats.dip[STATS_D_STR], u32(round(length(dStretch) * 1000.0)));
      let em = length(eTot);
      if (em > 0.05) {
        atomicAdd(&stats.dip[STATS_D_NALIGN], 1u);
        atomicAdd(&stats.dip[STATS_D_ALIGN], bitcast<u32>(i32(round(1000.0 * (myD.x * eTot.x + myD.y * eTot.y) / (myDm * em)))));
      }
    }
    if (dPairs > 0u) {
      atomicAdd(&stats.dip[STATS_D_PAIRS], dPairs);
      atomicAdd(&stats.dip[STATS_D_COS], bitcast<u32>(dCos));
      atomicAdd(&stats.dip[STATS_D_HTT], bitcast<u32>(dHtt));
    }
    if (dBonds >= 2u) { atomicAdd(&stats.dip[STATS_D_MID], 1u); } else if (dBonds == 1u) { atomicAdd(&stats.dip[STATS_D_END], 1u); }
  }

  // turnover: now and then a cell dies and a touching neighbour divides into its place, the daughter a copy
  // of the parent's genome (from last tick's buffer, so it does not matter whether the parent changes or dies
  // this tick) with small mutations. Cells that recognise none of their neighbours die sooner.
  // (Until step C3, rule E let a threat source raise the death rate and send births to cells fed by a nutrient
  // source; since step C5 growth is by energy: richer neighbours win the slot, above.)
  // Step C5, heat damage: where the dish under the cell (its 3 x 3 pixels) is hotter than the tolerance, the death rate
  // rises by heatKill per s x (temperature / tol - 1), at most heatKill (from twice the tolerance on: a bound, as the
  // deaths and births themselves heat the dish, which could otherwise run away); such a death is replaced in the same
  // way (so with turnover off, nothing dies, from heat either).
  let turnOn = (S.rules & RULE_TURN) != 0u;
  var hot = 0.0;
  if ((FL.eat & EAT_HEAT) != 0u && turnOn) {
    var hs = hsum;
    if (!kicks) { for (var q = 0; q < 9; q++) { hs += atomicLoad(&hb[S.heatCur + hidx[q]]); } }
    let temp = f32(hs) / 9.0 * HP.tempScale;
    // step C6: with the tolerance gene on, each cell's own tolerance (Bio.eng.w) instead of the global one
    let tol = select(FL.tol, bio.eng.w, (FL.eat & EAT_TOLG) != 0u);
    hot = FL.heatKill * clamp(temp / max(tol, 1e-3) - 1.0, 0.0, 1.0);
  }
  // step C6c, membrane chemistry: a cell that BURST (the eat pass spilled everything and marked it) counts its ticks; after
  // BURST_TICKS (the drawing's flash) a touching neighbour divides into its slot as at any death
  let bt = cell_burst(c.flags);
  var burstDie = false;
  if (bt != 0u) {
    if ((bitcast<u32>(FL.memb.x) & MB_BURST) != 0u) {
      burstDie = bt >= BURST_TICKS;
      c.flags = (c.flags & ~CELL_BURST_MASK) | (min(bt + 1u, 15u) << CELL_BURST_SHIFT);
    } else {
      c.flags &= ~CELL_BURST_MASK;
    }
  }
  // step C9: which life cycle runs while turnover (key T) is on: TURNOVER keeps the count (a dead cell's slot goes at once to a
  // touching neighbour's daughter, below) or DIVISION changes it (cells divide into free slots and die for good, after it)
  let divOn = (bitcast<u32>(FL.dv0.x) & DV_ON) != 0u;
  bio.env.y = max(bio.env.y - S.dt, 0.0);   // the division flash runs down (the drawing)
  if (turnOn && !divOn && parent != 0xffffffffu) {
    let rate = S.turnover * (1.0 + S.unhappy * (1.0 - min(M, 1.0)));
    let ud = select(rand01(c.seed ^ 0x165667b1u, S.tick), -1.0, burstDie);
    if (ud < (rate + hot) * S.dt) {
      if (ud < hot * S.dt && !burstDie) { atomicAdd(&stats.heatDeaths, 1u); }
      let bs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + i));    // this birth's random stream
      let pc = sorted[parent];
      let pi = beats[parent].idx;
      let nb = daughter_genome(bioPrev[pi], bs, cell_dose(pc.flags), i);
      // record the death and the birth (counters always, positions while there is room)
      atomicAdd(&stats.deaths, 1u);
      atomicAdd(&stats.births, 1u);
      let a = TAU * rand01(bs, 201u);
      let np = clamp(pc.pos + vec2f(cos(a), sin(a)) * 0.4 * pc.r, vec2f(0.0), vec2f(S.W, S.H));
      let ev = atomicAdd(&stats.nEvents, 2u);
      if (ev + 1u < STATS_EVENTS) {
        stats.events[ev] = vec4f(c.pos, -1.0, 0.0);
        stats.events[ev + 1u] = vec4f(np, 1.0, 0.0);
      }
      var d: Cell;
      d.pos = np;
      d.vel = vec2f(0.0);
      d.r = 0.6 * pc.r;                         // starts small and grows to its size
      d.la = nb.key.x;
      d.e1 = 0.0;
      d.e2 = 0.0;
      d.kind = KIND_STEM;
      d.seed = pcg(bs ^ 0x5bd1e995u);
      d.aux = nb.key.y;
      d.z = vec2f(1.0, 0.0);
      // step C5: the eat pass hands the dead cell's stock back to the dish where it died, and gives the newborn half of
      // its parent's stock and battery (the newborn's battery share until then: half the parent's)
      d.flags = CELL_ALIVE | CELL_BORN;
      d.flags |= pc.flags & CELL_WHOLE;         // step C6c: a daughter of a whole membrane gets real sides from it (split)
      d.dead = c.pos;
      d.mom = pi;
      d.bat = 0.5 * pc.bat;
      d.pay = 0;
      d.fill = 0.5 * pc.fill;
      // step C10: the daughter inherits her parent's front and (honeycomb) orientation, so a lineage keeps a shared direction
      if (wallOn) {
        d.front = wall_dq8(pc.wadh.y >> 24u);
        if (hexOn) {
          d.theta = wall_dq8((pc.wadh.y >> 16u) & 255u);
          d.rad = hex_rest(vec2f(0.0), hex_dirs(d), S.hexSize * 3.14159265 * d.r * d.r);
          d.flags |= CELL_HEX;
        }
      }
      eDeath = heat_ke(c.vel);
      c = d;
      bio = nb;
    }
  }
  // step C9, DIVISION (changing count): a cell dies for good when it STARVED (its battery below dv1.x for dv1.y s), of HEAT
  // damage (the rate above), when it BURST (after its flash), or by the background AGE rate (dv1.z, x the turnover's
  // "unhappy" factor for a cell that recognises none of its neighbours); its slot is then free (the eat pass hands its stock
  // back to the dish and its battery as heat, as at any death). A cell DIVIDES when its battery is at least dv0.y of its
  // capacity, it has grown to dv2.x of its size and it is not crowded (the sum of its overlaps at most dv0.z), at a chance of
  // dv0.w per s: it claims a free slot (none left: the capacity is full, it waits) and its daughter goes there, the two side by
  // side along the mother's long axis (at random if she is round), both at dv2.y of her radius; the eat pass then takes the
  // division's cost from her battery (as heat) and splits her stock, battery and membrane between the two.
  var died = false;
  if (turnOn && divOn) {
    bio.env.x = select(0.0, bio.env.x + S.dt, c.bat < FL.dv1.x);   // how long it has been starving
    var cause = 0u;
    if (capI != 0xffffffffu) {
      cause = DV_EATEN;                         // step P1: a wrap closed round it
    } else if (burstDie) {
      cause = DV_BURST;
    } else if (bio.env.x >= FL.dv1.y) {
      cause = DV_STARVED;
    } else {
      let ud = rand01(c.seed ^ 0x165667b1u, S.tick);
      let age = FL.dv1.z * (1.0 + S.unhappy * (1.0 - min(M, 1.0)));
      if (ud < hot * S.dt) { cause = DV_HEAT; } else if (ud < (hot + age) * S.dt) { cause = DV_AGE; }
    }
    if (cause != 0u) {
      atomicAdd(&stats.div[cause], 1u);
      atomicAdd(&stats.deaths, 1u);
      if (cause == DV_HEAT) { atomicAdd(&stats.heatDeaths, 1u); }
      let ev = atomicAdd(&stats.nEvents, 1u);
      // (step T1c: w = the cause + 16 x the founder id, for the chemical warfare census's deaths at lineage borders)
      if (ev < STATS_EVENTS) { stats.events[ev] = vec4f(c.pos, -1.0, f32(cause) + 16.0 * max(round(bio.rec.w), 0.0)); }
      eDeath = heat_ke(c.vel);                  // its motion becomes heat
      c.vel = vec2f(0.0);
      c.flags = CELL_BORN;                      // dead (no CELL_ALIVE): the eat pass hands its stock back where it is
      c.dead = c.pos;
      c.mom = 0xffffffffu;
      c.bat = 0.0;
      c.fill = 0.0;
      c.pay = 0;
      died = true;
      // step P1: an engulfed cell's slot becomes its predator's GHOST (its stock is the meal, digested by the host over the next seconds);
      // whatever it was doing itself ends (a meal it was digesting is left to spill: the eat pass's dump)
      c.eng = 0u;
      c.engPay = 0;
      let preyHold = c.hold;                    // (its hold as its predator last saw it)
      c.hold = 0.0;
      if (cause == DV_EATEN) {
        c.engBy = (BY_GHOST << 24u) | capI;
        atomicAdd(&stats.p1[PS_EATEN], 1u);
        if (capKin > 0.5) { atomicAdd(&stats.p1[PS_KIN], 1u); }
        if (holdG - capGlue < 0.05) { atomicAdd(&stats.p1[PS_ALONE], 1u); }
        atomicAdd(&stats.p1[PS_HOLD], u32(round(max(preyHold - capGlue, 0.0) * 1000.0)));
        atomicAdd(&stats.p1[PS_AREA], u32(round(3.14159265 * c.r * c.r / (S.R * S.R) * 1000.0)));
        atomicAdd(&stats.p1[PS_KINSUM], u32(round(clamp(capKin, 0.0, 1.0) * 1000.0)));
      } else {
        c.engBy = 0u;
      }
    } else if (c.bat >= FL.dv0.y && c.r >= FL.dv2.x * S.R * size * swell && bt == 0u &&   // (step C12e: at its own swelling)
               (CARBON_ON == 0u || unpack4x8unorm(c.sns1).w >= 0.995)) {   // step C15b: GROWTH NEEDS CARBON: its body full for its size
      if (S.xCount != 0u) {
        atomicAdd(&stats.div[DV_READY], 1u);
        if (comp > FL.dv0.z) { atomicAdd(&stats.div[DV_CROWDED], 1u); }
      }
      if (comp <= FL.dv0.z && rand01(c.seed ^ 0x51ed270bu, S.tick) < FL.dv0.w * gofP(i, GRN_O_DIV) * S.dt) {   // (step T1b: readiness as expressed)
        let t = atomicAdd(&stats.claim, 1u);
        if (t < starts[S.gw * S.gh + 1u] - aliveN) {   // (step P1: the free slots end where the ghosts' bucket starts)
          let k = beats[aliveN + t].idx;          // a free slot (dead at this tick's grid build)
          let bs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + i));
          var nb = daughter_genome(bio, bs, cell_dose(c.flags), i);
          // side by side along the long axis (the stretch's direction, either end), or at random
          let es = vec2f(c.e1, c.e2);
          var ang = TAU * rand01(bs, 201u);
          if (length(es) > 0.05) { ang = 0.5 * atan2(es.y, es.x) + select(0.0, 3.14159265, rand01(bs, 202u) < 0.5); }
          // step C11: ... or by the FRONT: along it (gene Bio.wall.w = 0), across it (1) or at that share of a right angle between,
          // either end, so the daughter lands where the wall pattern says (two-ended cells end to end, sticky sides side by side)
          if (wallOn && (wlF & WL_DIVFRONT) != 0u) {
            ang = c.front + 1.5707963 * clamp(bio.wall.w, 0.0, 1.0) + select(0.0, 3.14159265, rand01(bs, 202u) < 0.5);
          }
          // step C13, the division gate: the axis is pulled toward the felt gradient (gene > 0: the daughter up or down it) or across it
          // (< 0), by |gene| x the gradient's strength (axes blended as doubled angles, either end at random)
          let gd = clamp(bio.gate.w, -1.0, 1.0);
          let wd = abs(gd) * gStr;
          if ((fgF & FG_DIV) != 0u && wd > 0.0) {
            let ag = atan2(gDir.y, gDir.x) + select(0.0, 1.5707963, gd < 0.0);
            let v2 = (1.0 - wd) * vec2f(cos(2.0 * ang), sin(2.0 * ang)) + wd * vec2f(cos(2.0 * ag), sin(2.0 * ag));
            ang = 0.5 * atan2(v2.y, v2.x) + select(0.0, 3.14159265, rand01(bs, 203u) < 0.5);
          }
          let u = vec2f(cos(ang), sin(ang));
          let r0 = c.r;
          // (step S1: a long mother split along her axis puts her daughters a quarter of her core apart further, each in her own half)
          let off = FL.dv2.z * r0 + select(0.0, 0.5 * myK.z * abs(dot(u, myK.xy)), shOn);
          let np = clamp(c.pos + u * off, vec2f(0.0), vec2f(S.W, S.H));
          c.pos = clamp(c.pos - u * off, vec2f(0.0), vec2f(S.W, S.H));
          c.r = FL.dv2.y * r0;
          for (var q = 0; q < 6; q++) { c.rad[q] *= FL.dv2.y; c.radV[q] = 0.0; }
          c.bat *= 0.5;
          c.fill *= 0.5;
          var d: Cell;
          d.pos = np;
          d.r = FL.dv2.y * r0;
          d.la = nb.key.x;
          d.kind = KIND_STEM;
          d.flags = CELL_ALIVE | CELL_BORN | (c.flags & CELL_WHOLE);
          d.seed = pcg(bs ^ 0x5bd1e995u);
          d.aux = nb.key.y;
          d.z = vec2f(1.0, 0.0);
          d.dead = np;                            // (the slot's stock is empty: it was handed back when its cell died)
          d.mom = i | MOM_DIV;                    // the eat pass: the division's cost, then the split
          d.bat = c.bat;
          d.fill = c.fill;
          d.integ = c.integ;                      // (until the eat pass works out its own)
          d.lip = c.lip;                          // step C12b (the same)
          d.nbr = array<u32, 3>(0xffffffffu, 0xffffffffu, 0xffffffffu);
          // step C10: she inherits her mother's front and her honeycomb orientation and outline (explicitly: before C10 a
          // daughter's hexagon started turned at random), so a dividing lineage keeps a shared direction
          if (wallOn) {
            d.front = c.front;
            if (hexShape) { d.theta = c.theta; d.rad = c.rad; d.ea = c.ea; d.alpha = c.alpha; d.flags |= CELL_HEX; }
          }
          d.fg = fg_words(nb, fgOn, gofP(i, GRN_O_EMA), gofP(i, GRN_O_EMB));   // step C13: her field genes for her beat at once (T1b: her
                                                                                 //  mother's expression, which she inherits)
          if (gStr > 0.05) {                      // step C13's census: the axis against the felt gradient (cumulative)
            atomicAdd(&stats.fg[FGS_DIVN], 1u);
            atomicAdd(&stats.fg[FGS_DIVC], u32(round(abs(cos(ang - atan2(gDir.y, gDir.x))) * 1000.0)));
          }
          nb.env.y = FL.dv1.w;                    // both flash
          bio.env.y = FL.dv1.w;
          cells[k] = d;
          bioNext[k] = nb;
          atomicAdd(&stats.div[DV_BIRTHS], 1u);
          atomicAdd(&stats.births, 1u);
          let ev = atomicAdd(&stats.nEvents, 1u);
          if (ev < STATS_EVENTS) { stats.events[ev] = vec4f(np, 1.0, 0.0); }
        } else {
          atomicAdd(&stats.div[DV_NOSLOT], 1u);
        }
      }
    }
    if (S.xCount != 0u && !died && bio.env.x > 0.0) { atomicAdd(&stats.div[DV_STARVING], 1u); }
  } else {
    bio.env.x = 0.0;
  }

  // step P1, predators: the engulfing for the next tick (Cell.eng), what it costs this tick (Cell.engPay, paid by the eat pass from the
  // battery as heat), this cell's HOLD for its neighbours, and whether it is being wrapped (Cell.engBy, for the drawing)
  //   idle      a prey touches it (out-pulled, smaller): a wrap starts at p1b.z per s, if the battery holds p1c.y and the membrane p1d.x
  //             (the start costs p1d.z)
  //   wrapping  the progress runs up over p1b.x s (costing p1d.y per s) while the prey stays in reach and out-pulled and the predator can
  //             pay (battery p1c.z, membrane p1d.x / 2), else the prey ESCAPES; at full progress the prey is caught (its own step, above)
  //             and the predator digests it
  //   digesting the progress runs up over p1b.y s, whatever the switches; the eat pass moves the meal into the stock and ends it
  if (!died && c.seed == sorted[j].seed) {
    var ne = 0u;
    var near = 0u;
    var pay = 0;
    var integM = 0.0;
    for (var q = 0; q < 6; q++) { integM += clamp(c.integ[q], 0.0, 1.0); }
    integM /= 6.0;
    let prog = eng_progN(myEng);
    if (myMode == ENG_DIGEST) {
      let np = min(prog + max(1u, u32(round(S.dt / max(FL.p1b.y, 0.05) * f32(ENG_FULL)))), ENG_FULL);
      ne = eng_word(ENG_DIGEST, np, myPart, 0u);
    } else if (myMode == ENG_WRAP) {
      if (!p1Act) {
        ne = 0u;
      } else if (prog >= ENG_FULL) {
        if (tFound) { ne = eng_word(ENG_DIGEST, 0u, myPart, ENG_FRESH); } else { atomicAdd(&stats.p1[PS_LOST], 1u); }
      } else if (!tFound) {
        atomicAdd(&stats.p1[PS_LOST], 1u);
      } else if (!tOk) {
        atomicAdd(&stats.p1[PS_HELD], 1u);
      } else if (c.bat < FL.p1c.z || integM < 0.5 * FL.p1d.x) {
        atomicAdd(&stats.p1[PS_POOR], 1u);
      } else {
        let np = min(prog + max(1u, u32(round(S.dt / max(FL.p1b.x, 0.05) * f32(ENG_FULL)))), ENG_FULL);
        ne = eng_word(ENG_WRAP, np, myPart, 0u);
        near = ENG_NEAR;
        pay += i32(floor(FL.p1d.y * S.dt + rand01(c.seed ^ 0x2d1f3a5bu, S.tick)));
      }
    } else if (p1Act && bestI != NBR_NONE) {
      near = ENG_NEAR;
      if (c.bat >= FL.p1c.y && integM >= FL.p1d.x && rand01(c.seed ^ 0x6c8e9cf5u, S.tick) < FL.p1b.z * S.dt) {
        ne = eng_word(ENG_WRAP, 0u, bestI, 0u);
        pay += i32(round(FL.p1d.z));
        atomicAdd(&stats.p1[PS_START], 1u);
      }
    }
    c.eng = ne | near;
    c.engPay = pay;
    // the hold: the glue to its touching neighbours + its ARMOUR (the crust wall's cover, the membrane's stiffness: the lipid membranes'
    // per side, else the C6c material's)
    var arm = 0.0;
    if (p1On) {
      var wc = 0.0;
      var kk = 0.0;
      for (var q = 0; q < 6; q++) { let l = unpack4x8unorm(c.lip[q]); wc += l.w; kk += l.x; }
      var kq = kk / 6.0 * LIP_KMAX;
      if (kk <= 0.0) { kq = select(1.0, memb_stiff(bio.memb, FL.memb.y), (bitcast<u32>(FL.memb.x) & MB_ELASTIC) != 0u); }
      arm = FL.p1b.w * wc / 6.0 + FL.p1c.x * clamp((kq - 1.0) / (LIP_KMAX - 1.0), 0.0, 1.0);
    }
    c.hold = select(0.0, holdG + arm, p1On);
    c.engBy = select(0u, (BY_WRAPPED << 24u) | (u32(round(clamp(byP, 0.0, 1.0) * 255.0)) << 16u) | byI, byI != NBR_NONE);
    if (S.xCount != 0u) {
      let sp = clamp(bio.kin.w, 0.0, 1.0);
      atomicAdd(&stats.p1[PZ_N], 1u);
      atomicAdd(&stats.p1[PZ_E], u32(round(eGene * 1000.0)));
      atomicAdd(&stats.p1[PZ_E2], u32(round(eGene * eGene * 1000.0)));
      atomicAdd(&stats.p1[PZ_S], u32(round(sp * 1000.0)));
      atomicAdd(&stats.p1[PZ_S2], u32(round(sp * sp * 1000.0)));
      if (eGene >= 0.25) {
        atomicAdd(&stats.p1[PZ_CARRY], 1u);
        atomicAdd(&stats.p1[PZ_SC], u32(round(sp * 1000.0)));
        if (sp >= 0.5) { atomicAdd(&stats.p1[PZ_SPARER], 1u); }
      }
      let md = eng_mode(c.eng);
      if (md == ENG_WRAP) { atomicAdd(&stats.p1[PZ_WRAP], 1u); }
      if (md == ENG_DIGEST) { atomicAdd(&stats.p1[PZ_DIGEST], 1u); }
      if (byI != NBR_NONE) { atomicAdd(&stats.p1[PZ_WRAPPED], 1u); }
      if (near != 0u) { atomicAdd(&stats.p1[PZ_NEAR], 1u); }
      atomicAdd(&stats.p1[PZ_EXPR], u32(round(min(eExpr, 4.0) * 1000.0)));
      atomicAdd(&stats.p1[PZ_HOLD], u32(round(min(c.hold, 100.0) * 1000.0)));
      atomicAdd(&stats.p1[PZ_GLUE], u32(round(clamp(bio.body.x * gofP(i, GRN_O_GLUE), 0.0, 4.0) * 1000.0)));
      atomicAdd(&stats.p1[PZ_ARM], u32(round(min(arm, 100.0) * 1000.0)));
    }
  }

  // step C1: the heat under the cell gets the drag's loss and a dead cell's motion, minus what the kick took, spread
  // evenly over the 3 x 3 pixels it read (whole counts, the remainder to the middle); the ledger books the work, the
  // drag and the kicks (each in one of 256 or 160 slots, so the atomic adds do not all queue on one address)
  let cDrag = heat_counts(eDrag);
  let cKick = heat_counts(eKick);
  let dep = cDrag - cKick + heat_counts(eDeath) - cStir;   // (step G0: less the stirred water's work on the cell)
  if (dep != 0) {
    let part = dep / 9;
    for (var q = 0; q < 9; q++) {
      atomicAdd(&hb[LEDGER_WORDS + hidx[q]], select(part, dep - 8 * part, q == 4));
    }
  }
  // step C2: while the light is on, the cell puts down its area (in heat pixel areas) at its centre, so the light's
  // absorption knows where cells are (heat.wgsl reads the 3 x 3 mean; cleared after the tick)
  if ((HP.flags & 2u) != 0u && !died) {
    let cov = i32(round(3.14159265 * c.r * c.r / (HP.px * HP.px) * COVER_SCALE));
    let cp = heat_xy(HP, c.pos);
    atomicAdd(&hb[LEDGER_WORDS + 3u * HP.n + u32(cp.y) * HP.hw + u32(cp.x)], cov);
  }
  atomicAdd(&hb[LG_WORK + (j & 255u)], heat_counts(eWork) - cStir);
  if (cStir != 0) { atomicAdd(&stats.g0[G0S_WORK], bitcast<u32>(cStir)); }
  if (j == 0u) { atomicAdd(&stats.g0[G0S_TICKS], 1u); }
  let slot = j % LG_SLOTS_DK;
  if (cDrag != 0) { atomicAdd(&hb[LG_DRAG + slot], cDrag); }
  if (cKick != 0) { atomicAdd(&hb[LG_KICK + slot], cKick); }

  // the leak level, for the drawing and the census (a newborn starts at 0)
  if (c.seed != sorted[j].seed || died) { c.flags &= ~(255u << CELL_LEAK_SHIFT); }
  else { c.flags = (c.flags & ~(255u << CELL_LEAK_SHIFT)) | (u32(round(clamp(me.lk.w, 0.0, 1.0) * 255.0)) << CELL_LEAK_SHIFT); }
  // step C10: the walls' census (the frame's last tick): the genes, the pattern classes, the junctions, the glue, the cost
  if (S.xCount != 0u && !died) {   // (the genes also while the walls are off: their drift, for comparison)
    let g = bio.wall;
    let a1 = g.x;
    let a2 = g.y;
    atomicAdd(&stats.wall[WS_N], 1u);
    atomicAdd(&stats.wall[WS_A0], u32(round(clamp(bio.body.x, 0.0, GLUE_HI) * 1000.0)));   // (step G0: up to the log scale's top)
    atomicAdd(&stats.wall[WS_A1], u32(round(abs(a1) * 1000.0)));
    atomicAdd(&stats.wall[WS_A2], u32(round(abs(a2) * 1000.0)));
    atomicAdd(&stats.wall[WS_A1S], bitcast<u32>(i32(round(a1 * 1000.0))));
    atomicAdd(&stats.wall[WS_A2S], bitcast<u32>(i32(round(a2 * 1000.0))));
    atomicAdd(&stats.wall[WS_W], u32(round(clamp(g.z, 0.0, 1.0) * 1000.0)));
    var cls = WS_UNI;
    if (max(abs(a1), abs(a2)) >= FL.wl1.x) { cls = select(select(WS_SID, WS_END, a2 > 0.0), WS_POL, abs(a1) >= abs(a2)); }
    atomicAdd(&stats.wall[cls], 1u);
    let mm = c.mature;
    let mv = (unpack2x16unorm(mm[0]) + unpack2x16unorm(mm[1]) + unpack2x16unorm(mm[2])) / 6.0;
    atomicAdd(&stats.wall[WS_MAT], u32(round((mv.x + mv.y) * 1000.0)));
    atomicAdd(&stats.wall[WS_EFF], u32(round((wA.x + wA.y + wA.z + wA.w + wB.x + wB.y) / 6.0 * 1000.0)));
    // what the pattern asks for (before the cost): a0 + s (a1 cos psi + a2 cos 2 psi), x the maturity factor
    var ask = 0.0;
    var pk: array<f32, 6>;
    var pLo = 1.0;
    var pHi = 0.0;
    for (var k = 0; k < 6; k++) {
      let cs = cos(myTh + (f32(k) + 0.5) * P3 - c.front);
      let p = clamp(bio.body.x + FL.wl1.y * (a1 * cs + a2 * (2.0 * cs * cs - 1.0)), 0.0, max(1.0, bio.body.x));
      ask += p * (1.0 + FL.wl1.z * wall_mature(mm, u32(k)));
      pk[k] = p;
      pLo = min(pLo, p);
      pHi = max(pHi, p);
    }
    atomicAdd(&stats.wall[WS_ASK], u32(round(ask / 6.0 * 1000.0)));
    // step C11: do the contacts sit on the sticky sides (the pattern's upper half, without the maturity, which would favour the
    // touched sides anyway), against chance (the share of the cell's sides that are sticky)? And how fast the glue turns it
    let tch = array<f32, 6>(rtA.x, rtA.y, rtA.z, rtA.w, rtB.x, rtB.y);
    var nT = 0u;
    if (pHi - pLo > 0.1) {
      let mid = 0.5 * (pLo + pHi);
      var nS = 0u;
      for (var k = 0; k < 6; k++) { if (pk[k] >= mid) { nS++; } }
      var onS = 0u;
      for (var k = 0; k < 6; k++) {
        if (tch[k] > 0.5) { nT++; if (pk[k] >= mid) { onS++; } }
      }
      if (nT > 0u) {
        atomicAdd(&stats.wall[WS_STK], onS);
        atomicAdd(&stats.wall[WS_STKC], u32(round(f32(nT) * f32(nS) / 6.0 * 1000.0)));
        atomicAdd(&stats.wall[WS_STKN], nT);
      }
    }
    if (glueTurn && wPairs > 0u) {
      atomicAdd(&stats.wall[WS_TQ], u32(round(abs(wTurn) * 1000.0)));
      atomicAdd(&stats.wall[WS_TQN], 1u);
    }
    atomicAdd(&stats.wall[WS_LINK], c.wlink);
    atomicAdd(&stats.wall[WS_PAY], c.wpay);
    if (wPairs > 0u) {
      atomicAdd(&stats.wall[WS_PAIRS], wPairs);
      atomicAdd(&stats.wall[WS_GLUE], wGlue);
      atomicAdd(&stats.wall[WS_MATP], wMatP);
      atomicAdd(&stats.wall[WS_FRONTP], wFrontP);
    }
    if (dipOn && myDm > DIP_MIN) {
      atomicAdd(&stats.wall[WS_FDN], 1u);
      atomicAdd(&stats.wall[WS_FD], bitcast<u32>(i32(round(1000.0 * cos(atan2(myD.y, myD.x) - c.front)))));
    }
  }
  // step G0: the glue's census (the frame's last tick): the gene on its log scale, the formed junctions, their strength and load, the torn sides
  if (S.xCount != 0u && !died) {
    let gg = max(bio.body.x, 1e-3);
    atomicAdd(&stats.g0[G0S_N], 1u);
    atomicAdd(&stats.g0[G0S_GENE], bitcast<u32>(i32(round(log(gg) * 1000.0))));
    atomicAdd(&stats.g0[G0S_GENE2], u32(round(log(gg) * log(gg) * 1000.0)));
    atomicAdd(&stats.g0[G0S_GSUM], u32(round(min(gg, 100.0) * 1000.0)));
    if (gg > 1.0) { atomicAdd(&stats.g0[G0S_HIGH], 1u); }
    if (jnN > 0u) {
      atomicAdd(&stats.g0[G0S_FORMED], jnN);
      atomicAdd(&stats.g0[G0S_STR], u32(round(jnStr * 1000.0)));
      atomicAdd(&stats.g0[G0S_LOAD], bitcast<u32>(i32(round(clamp(jnLoad, -1000.0, 1000.0) * 1000.0))));
    }
    if ((c.kind & JN_TORN) != 0u) { atomicAdd(&stats.g0[G0S_TORN], countOneBits(c.kind & JN_TORN)); }
  }
  // step S1: the shape's census (the frame's last tick): the outlines' aspect, the long ones, the nematic order of touching long pairs, the
  // elongation gene and as asked, the turning, the perimeter, prey saved by their length
  if (S.xCount != 0u && !died && shOn) {
    let la = 2.0 * length(vec2f(c.e1, c.e2));
    atomicAdd(&stats.s1[S1S_N], 1u);
    atomicAdd(&stats.s1[S1S_LA], u32(round(la * 1000.0)));
    atomicAdd(&stats.s1[S1S_LA2], u32(round(la * la * 1000.0)));
    if (la > 0.6931472) { atomicAdd(&stats.s1[S1S_LONG], 1u); }
    if (nemN > 0u) { atomicAdd(&stats.s1[S1S_NPAIR], nemN); atomicAdd(&stats.s1[S1S_NEM], bitcast<u32>(nemS)); }
    let g = clamp(bio.relay.y, 0.0, SH_LN_MAX);
    atomicAdd(&stats.s1[S1S_GENE], u32(round(g * 1000.0)));
    atomicAdd(&stats.s1[S1S_GENE2], u32(round(g * g * 1000.0)));
    atomicAdd(&stats.s1[S1S_EXPR], u32(round(2.0 * eG * 1000.0)));
    if (sTurn != 0.0) { atomicAdd(&stats.s1[S1S_TURN], u32(round(abs(sTurn) * 1000.0))); atomicAdd(&stats.s1[S1S_TURNN], 1u); }
    if (noWrap > 0u) { atomicAdd(&stats.s1[S1S_NOWRAP], noWrap); }
    atomicAdd(&stats.s1[S1S_PERIM], u32(round(min(perim_factor(mb), 10.0) * 1000.0)));
    atomicAdd(&stats.s1[S1S_LEN], u32(round(2.0 * (myK.z + myK.w) / S.R * 1000.0)));
  }
  // step C13: what each side felt (s_k = tanh(felt / ref)), for the eat pass's gates and the guides view, and the field genes the beat
  // needs (Cell.fg), from the genome (a newborn's from hers)
  let sRef = max(FL.fg0.y, 1e-3);
  var sk = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  if (sensing && !died && c.seed == sorted[j].seed) { for (var a = 0; a < 6; a++) { sk[a] = tanh(seg[a] / sRef); } }
  // (step T1b: byte 2 of word 1, field B felt at the cell, tanh(sensing gene x B x bRef), for the gene network)
  let bS = select(0.0, tanh(senseB * bFelt * FL.t1.w), !died && feelB);
  c.felt = array<u32, 2>(pack4x8snorm(vec4f(sk[0], sk[1], sk[2], sk[3])), pack4x8snorm(vec4f(sk[4], sk[5], bS, 0.0)) & 0xffffffu);
  c.fg = fg_words(bio, fgOn && !died, gofP(i, GRN_O_EMA), gofP(i, GRN_O_EMB));
  if (S.xCount != 0u && !died) {
    fg_census(bio, sk, gStr, fgF, me);
    // where the front points against the felt gradient (the turn gate's mark), and where the contacts sit against what the sides feel
    // (the glue gate's mark)
    if (gStr > 0.05 && wallOn) {
      atomicAdd(&stats.fg[FGS_FRONT], bitcast<u32>(i32(round(1000.0 * (gDir.x * cos(c.front) + gDir.y * sin(c.front))))));
      atomicAdd(&stats.fg[FGS_FRONTN], 1u);
    }
    let tch6 = array<f32, 6>(rtA.x, rtA.y, rtA.z, rtA.w, rtB.x, rtB.y);
    var tS = 0.0;
    var tN = 0.0;
    var aS = 0.0;
    for (var a = 0; a < 6; a++) { aS += sk[a]; if (tch6[a] > 0.5) { tS += sk[a]; tN += 1.0; } }
    if (tN > 0.0 && tN < 6.0 && sensing) {
      atomicAdd(&stats.fg[FGS_CONT], bitcast<u32>(i32(round(1000.0 * (tS / tN - aS / 6.0)))));
      atomicAdd(&stats.fg[FGS_CONTN], 1u);
    }
  }
  // step C7: the neighbours across the sides, 16 bits each (none while the pumps across contact are off)
  c.nbr = array<u32, 3>(nbIA.x | (nbIA.y << 16u), nbIA.z | (nbIA.w << 16u), nbIB.x | (nbIB.y << 16u));
  // step S2: what the motors did (the drawing, the census), the beat's phase on, the census (the frame's last tick)
  if (moF != 0u) {
    c.motW = u32(round(clamp(flagA * select(1.0, gate, flagA > 0.0), 0.0, 1.0) * 255.0)) | (u32(round(clamp(ciliaA * gate, 0.0, 1.0) * 255.0)) << 8u) | (moFree << 16u);
    bio.mc.z = moPhiN;
    if (S.xCount != 0u) { motor_census(bio, c, flagA, ciliaA, swimV, moFree, moTouch, cpN, cpS, cpC, cyS, cyC, moTurn, uW, curD, moPay); }
  } else {
    c.motW = 0u;
  }
  // step F0: the JOB scores follow what the genes ask for now, as expressed, through a low-pass (cell_common.wgsl job_of, src/jobs.js)
  let jt = job_targets(bio, eng_mode(c.eng) != ENG_IDLE);
  let ja = min(1.0, S.dt / JOB_TAU);
  bio.acc += (jt[0] - bio.acc) * ja;
  bio.resp = vec4f(bio.resp.xy + (jt[1].xy - bio.resp.xy) * ja, 0.0, 0.0);
  // PORTABLE GUARD (the user's phone, 2026-11-22; src/gpu.js patchTanh): a cell whose position, velocity or size came out NaN or infinite
  // (a GPU whose maths overflows where the desktop's saturates) is put back where it was at the start of the tick, at rest, its outline
  // round, and counted (G0S_BAD), instead of being clamped onto the dish's edge or through a wall and spreading NaN to its neighbours'
  // fields. Finite cells are untouched. Cells faster than 30 R / s are only counted (G0S_FAST). ?gpuguard=0: no guard (as before)
  if (GPU_GUARD != 0u) {
    var ok = fin_f(c.pos.x) && fin_f(c.pos.y) && fin_f(c.vel.x) && fin_f(c.vel.y) && fin_f(c.r) && c.r > 0.0;
    for (var q = 0; q < 6; q++) { ok = ok && fin_f(c.rad[q]) && fin_f(c.radV[q]); }
    if (!ok) {
      c.pos = select(S.centre, pos0, fin_f(pos0.x) && fin_f(pos0.y));
      c.vel = vec2f(0.0);
      if (!(fin_f(c.r) && c.r > 0.0)) { c.r = S.R; }
      for (var q = 0; q < 6; q++) { c.rad[q] = c.r; c.radV[q] = 0.0; }
      atomicAdd(&stats.g0[G0S_BAD], 1u);
    } else if (dot(c.vel, c.vel) > 900.0 * S.R * S.R) {
      atomicAdd(&stats.g0[G0S_FAST], 1u);
    }
  }
  cells[i] = c;
  bioNext[i] = bio;
}

// the portable guard: on by default (src/gpu.js setShaderConst; ?gpuguard=0 sets 0)
const GPU_GUARD: u32 = 1u;
// finite (not NaN, not infinite), from the bits: a compiler may assume no NaN and drop a test like x != x
fn fin_f(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u; }

// step F0: the job scores a genome asks for now (its genes x the gene network's outputs; the targets of the low-pass): [0] light eater,
// breather, fermenter, gradient eater; [1].xy builder, predator. eating: the cell wraps or digests a meal now
fn job_targets(b: Bio, eating: bool) -> array<vec4f, 2> {
  let act = (bitcast<u32>(FL.t1.z) & GRN_ACT) != 0u;
  var s = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let pig = select(1.0, gofB(b, GRN_O_PIG), act);
  // (step G2: + the two duplicate slots while the copies act, each through the output of the slot it was copied from)
  let dAct = (bitcast<u32>(FL.g2.x) & DUP_ACT) != 0u;
  let sc = array<f32, 5>(b.eng.x, b.eng.y, b.eng.z, b.dx.x, b.dx.y);
  let sr = array<f32, 5>(b.rate.x, b.rate.y, b.rate.z, select(0.0, b.dx.z, dAct), select(0.0, b.dx.w, dAct));
  let so = array<u32, 5>(0u, 1u, 2u, fam_reg(b.df.w), fam_reg(b.dg.x));
  for (var k = 0u; k < 5u; k++) {
    let r = sr[k];
    if (r <= 0.0) { continue; }
    let e = eng_index(sc[k]);
    let cl = job_class(e);
    var x = r * select(1.0, gofB(b, GRN_O_ENG0 + so[k]), act);
    if (cl == 1u) {
      if (eng_band(sc[k]) == 0u) { continue; }   // (a battery-paid uphill engine: a storer, no job of its own)
      x *= pig * JOB_W_LIGHT;
    }
    if (cl >= 1u && cl <= 5u) { s[cl - 1u] += x; }
  }
  s[4] += JOB_W_WALL * clamp(b.lip.x, 0.0, 1.0) * select(1.0, gofB(b, GRN_O_WALL), act);
  s[5] += JOB_W_ENGULF * clamp(b.kin.z, 0.0, 1.0) * select(1.0, grn_fac_engulf(b), act) + select(0.0, JOB_W_EAT, eating);
  return array<vec4f, 2>(vec4f(s[0], s[1], s[2], s[3]), vec4f(s[4], s[5], 0.0, 0.0));
}
// a genome's factor for output o of the gene network (as gofP, from a Bio in hand)
fn gofB(b: Bio, o: u32) -> f32 {
  let j = grn_reg(b.go, o);
  return grn_fac(b.gu[o >> 2u][o & 3u], b.gx[j >> 2u][j & 3u]);
}

// step C11: the fastest the glue turns a cell (rad / s)
const TURN_MAX: f32 = 3.0;
const TURN_DA: f32 = 0.1;          // ... the small turn (rad) the glue's change is measured over

// step C6c: how fast a honeycomb corner slides round toward its tile's corner while a wall is near (rad/s at a slope of 1),
// and back toward its regular place when free (1/s)
const HEX_SLIDE_RATE: f32 = 8.0;
const HEX_SLIDE_BACK: f32 = 1.5;
const HEX_SPACE: f32 = 3.0;       // ... and how fast neighbouring corners even out their spacing (1/s)

// step C6c: a honeycomb corner's target from its rest place r0 and the nearest wall along its direction b (see the step)
fn hex_target(r0: f32, b: f32, snap: f32) -> f32 {
  let w = 1.0 - smoothstep(r0, snap * r0, b);
  return min(mix(r0, b, w), b);
}

// A daughter's genome (turnover and, step C9, division): the parent's p copied with mutation (cell_common.wgsl mutate; its
// state reset: what it felt, its heading; step F0: the job scores are inherited), and the step C8 census of the birth.
// Step C8, hard light mutates: the parent's hard light dose (Cell.flags, from the eat pass) scales this copy's mutation,
// x (1 + hm.x x dose), at most hm.y x (the small steps' size and every jump's chance alike); with mutation off (key M) only the
// extra part mutates, so in the dark a lineage then stays pure. bs: the birth's random stream; i: the slot counting it.
fn daughter_genome(p: Bio, bs: u32, pdose: f32, i: u32) -> Bio {
  var nb = p;
  let hx = select(0.0, min(FL.hm.x * pdose, max(FL.hm.y - 1.0, 0.0)), FL.hm.x > 0.0);
  let mOn = (S.rules & RULE_MUT) != 0u;
  let ms = select(0.0, 1.0, mOn) + hx;
  // step G1, error correction: the parent's FIDELITY gene scales the copying errors (and part of hard light's), cell_common.wgsl fid_birth
  let fBits = bitcast<u32>(FL.hm.z);
  let msF = fid_birth(mOn, hx, p.conv.w, FL.hm);
  let e0 = nb.eng.xyz;                      // (to count the slot jumps: an engine or pump slot changed, started or emptied)
  let r0 = nb.rate.xyz > vec3f(0.0);
  let q0 = nb.pump.xy;
  let qr0 = nb.pump.zw > vec2f(0.0);
  if (msF > 0.0) {
    nb = mutate(nb, bs, S.mutSize * msF, min(S.mutJump * msF, 1.0), min(S.engJump * msF, 1.0), min(FL.memb.w * msF, 1.0));
    // step G0, the glue's CEILING: the glue gene on a log scale (GLUE_LO..GLUE_HI): its step multiplies it (x e^(0.06 x size x n), the same
    // 6 % a step was at 0.5 on the old linear scale; the same random draw), its rare jump lands anywhere on the log scale (the same draws as
    // mutate's jump into it)
    if ((bitcast<u32>(FL.g0a.x) & G0_CEIL) != 0u) {
      let sz = S.mutSize * msF;
      var x = max(p.body.x, GLUE_LO) * exp(sz * 0.06 * gauss(bs, 16u));
      if (rand01(bs, 101u) < min(S.mutJump * msF, 1.0) && min(u32(rand01(bs, 102u) * 18.0), 17u) == 15u) {
        x = GLUE_LO * pow(GLUE_HI / GLUE_LO, rand01(bs, 103u));
      }
      nb.body.x = clamp(x, GLUE_LO, GLUE_HI);
    }
    // step S1: the ELONGATION gene (Bio.relay.y, ln of the aspect asked, 0..ln 4) drifts by small steps, now and then a jump anywhere (as one
    // of mutate's 18 genes would); on and in the neutral control alike, untouched while the shape is off
    if ((S.shapeF & SH_ON) != 0u) {
      let sz = S.mutSize * msF;
      var x = nudge(p.relay.y, sz * 0.05, 0.0, SH_LN_MAX, bs, 220u);
      if (rand01(bs, 221u) < min(S.mutJump * msF, 1.0) / 18.0) { x = SH_LN_MAX * rand01(bs, 222u); }
      nb.relay.y = x;
    }
    // step S2: the MOTOR genes (Bio.mo, mc.xy) drift by small steps, now and then one jumps anywhere (as one of mutate's 18 genes would); on and in
    // their neutral control alike, untouched while that motor is off (the phase, mc.z, is state: inherited as it is)
    let mf = bitcast<u32>(FL.mo0.x);
    let sz = S.mutSize * msF;
    let jp = min(S.mutJump * msF, 1.0) / 18.0;
    if ((mf & MO_FLAG) != 0u) {
      var fl = vec3f(nudge(p.mo.x, sz * 0.03, 0.0, 1.0, bs, 230u), nudge(p.mo.y, sz * 0.05, -1.0, 1.0, bs, 231u), nudge(p.mo.z, sz * 0.03, -1.0, 1.0, bs, 232u));
      if (rand01(bs, 233u) < jp) { fl.x = rand01(bs, 234u); }
      if (rand01(bs, 235u) < jp) { fl.y = 2.0 * rand01(bs, 236u) - 1.0; }
      if (rand01(bs, 237u) < jp) { fl.z = 2.0 * rand01(bs, 238u) - 1.0; }
      nb.mo = vec4f(fl, nb.mo.w);
    }
    if ((mf & MO_CIL) != 0u) {
      var cw = nudge(p.mo.w, sz * 0.03, 0.0, 1.0, bs, 240u);
      var ck = vec2f(nudge(p.mc.x, sz * 0.04, -1.0, 1.0, bs, 241u), nudge(p.mc.y, sz * 0.03, -1.0, 1.0, bs, 242u));
      if (rand01(bs, 243u) < jp) { cw = rand01(bs, 244u); }
      if (rand01(bs, 245u) < jp) { ck.x = 2.0 * rand01(bs, 246u) - 1.0; }
      if (rand01(bs, 247u) < jp) { ck.y = 2.0 * rand01(bs, 248u) - 1.0; }
      nb.mo.w = cw;
      nb.mc = vec4f(ck, nb.mc.zw);
    }
    // step N2: the CHEMOTAXIS gene (Bio.mc.w, a log factor on the smell's gain) drifts by small steps, now and then a jump anywhere; on and in its
    // neutral control alike, untouched while off
    if ((bitcast<u32>(FL.g2.w) & CHEMO_ON) != 0u) {
      var x = nudge(p.mc.w, sz * 0.12, CHEMO_LO, CHEMO_HI, bs, 250u);
      if (rand01(bs, 251u) < jp) { x = CHEMO_LO + (CHEMO_HI - CHEMO_LO) * rand01(bs, 252u); }
      nb.mc.w = x;
    }
  }
  // ... the gene itself drifts at today's size (not proofread by itself), on and in the neutral control
  var fid = p.conv.w;
  if ((fBits & FID_DRIFT) != 0u && ms > 0.0) { fid = nudge(fid, S.mutSize * ms * FID_STEP, FID_LO, FID_HI, bs, 196u); }
  if (fBits != 0u) {
    atomicAdd(&hb[LG_DIV + 16u * FDC_BIRTHS + (i & 15u)], 1);
    atomicAdd(&hb[LG_DIV + 16u * FDC_MS + (i & 15u)], i32(round(msF * 1000.0)));
    atomicAdd(&hb[LG_DIV + 16u * FDC_MS0 + (i & 15u)], i32(round(ms * 1000.0)));
  }
  if (FL.hm.x > 0.0 || mOn) {
    let lit = pdose >= 1.0;
    let jumped = any(nb.eng.xyz != e0) || any((nb.rate.xyz > vec3f(0.0)) != r0) || any(nb.pump.xy != q0) ||
                 any((nb.pump.zw > vec2f(0.0)) != qr0);
    atomicAdd(&hb[LG_HL + 16u * HL_BIRTHS + (i & 15u)], 1);
    atomicAdd(&hb[LG_HL + 16u * HL_FSUM + (i & 15u)], i32(round(select(1.0, ms, ms > 0.0) * 1000.0)));
    if (lit) {
      atomicAdd(&hb[LG_HL + 16u * HL_HIT + (i & 15u)], 1);
      atomicAdd(&hb[LG_HL + 16u * HL_HIT_F + (i & 15u)], i32(round(ms * 1000.0)));
    }
    if (jumped) { atomicAdd(&hb[LG_HL + 16u * select(HL_JUMP_CLEAN, HL_JUMP_HIT, lit) + (i & 15u)], 1); }
  }
  // step G2: gene duplication (after the C8 census above, so its slot jumps count mutation alone): the families kept in order, and with
  // duplication on (or its neutral control) the copies' drift, a rare deletion and a rare duplication, x the copying scale msF
  nb = dup_birth(nb, p, bs, msF, i);
  // step T1a: the self MARKER drifts at every birth, a molecular clock (small Gaussian steps of its angle, period and phase; never a jump),
  // so marker distance grows with the time since a common ancestor
  // (step T1c, ?clockhard=0: the clock ticks only with mutation itself (key M), not with hard light's extra dose, so a lineage under hard
  // light keeps its kinship readable as long as one in the shade)
  // (step G1: the clock is a copying error too: x e^-F, hard light's part as in fid_birth; exactly as before while the gene does not act)
  let cms = select(select(0.0, fid_m(p.conv.w, FL.hm), mOn), msF, (bitcast<u32>(FL.t1.x) & T1S_CLOCKHARD) != 0u);
  if ((bitcast<u32>(FL.t1.x) & T1S_CLOCK) != 0u && cms > 0.0) {
    let ck = FL.t1.y * cms;
    var ang = nb.mark.x + ck * 0.02 * gauss(bs, 190u);
    ang -= TAU * floor(ang / TAU);
    var ph = nb.mark.z + ck * 0.05 * gauss(bs, 192u);
    ph -= TAU * floor(ph / TAU);
    nb.mark = vec4f(ang, nudge(nb.mark.y, ck * 0.01, MARK_PLO, MARK_PHI, bs, 191u), ph, nb.mark.w);
  }
  nb.env = vec4f(0.0);                      // a newborn has felt nothing yet and is not converted (step C9: nor starving)
  nb.conv = vec4f(0.0, 0.0, 0.0, fid);      // (step G1: w is the fidelity gene, inherited)
  nb.body.w = TAU * rand01(bs, 200u);
  return nb;
}

// step G2: a birth's GENE DUPLICATION (cell_common.wgsl DUP_*, FAM_*; src/dup.js). nb0: the daughter's genome after mutate; p: the parent's;
// bs: the birth's random stream; msF: the copying scale (mutate's: key M x the fidelity gene, + hard light's); i: the slot counting it.
// ALWAYS (no effect on behaviour): every slot's FAMILY word kept in order: an empty slot has none; a working slot not named yet gets its
// founder's id (old genomes, hand-made ones); one this birth's ordinary mutation started from empty, a fresh id. With DUP_COPY (on and the
// neutral control): the two duplicate engine slots drift as the others (their rate's small steps; now and then, at the chance one of the three
// old slots has, a jump to another reaction or pigment band, never to empty); a rare DELETION silences one copy (a duplicate engine slot or a
// pump copy); a rare DUPLICATION copies a working slot (any engine or pump slot, at random) into a silent one of its kind: its code, rate and
// family (with the gene-network output it follows), marked as a copy. (A pump copy then drifts by mutate's ordinary pump jumps.)
fn dup_birth(nb0: Bio, p: Bio, bs: u32, msF: f32, i: u32) -> Bio {
  var nb = nb0;
  let bits = bitcast<u32>(FL.g2.x);
  var ce = array<f32, 5>(nb.eng.x, nb.eng.y, nb.eng.z, nb.dx.x, nb.dx.y);
  var re = array<f32, 5>(nb.rate.x, nb.rate.y, nb.rate.z, nb.dx.z, nb.dx.w);
  var fe = array<f32, 5>(nb.df.x, nb.df.y, nb.df.z, nb.df.w, nb.dg.x);
  let pe = array<f32, 5>(p.rate.x, p.rate.y, p.rate.z, p.dx.z, p.dx.w);
  var rp = nb.pump.zw;
  var fp = nb.dg.yz;
  let pp = p.pump.zw;
  var nNew = 0;
  // the families
  for (var k = 0u; k < 5u; k++) {
    if (re[k] <= 0.0) { fe[k] = 0.0; continue; }
    if (fe[k] >= 0.5) { continue; }
    var id = fam_founder(p.rec.w, k);
    if (k < 3u && pe[k] <= 0.0) { id = FAM_NEW + (pcg(bs ^ (0x5f3759dfu + 0x9e3779b9u * k)) & (FAM_NEW - 1u)); nNew++; }
    fe[k] = fam_word(id, min(k, 2u));
  }
  for (var k = 0u; k < 2u; k++) {
    if (rp[k] <= 0.0) { fp[k] = 0.0; continue; }
    if (fp[k] >= 0.5) { continue; }
    var id = fam_founder(p.rec.w, 8u + k);
    if (pp[k] <= 0.0) { id = FAM_NEW + (pcg(bs ^ (0x2c1b3c6du + 0x9e3779b9u * k)) & (FAM_NEW - 1u)); nNew++; }
    fp[k] = fam_word(id, 0u);
  }
  if (nNew > 0) { atomicAdd(&hb[LG_DIV + 16u * DPC_NEW + (i & 15u)], nNew); }
  if ((bits & DUP_COPY) != 0u && msF > 0.0) {
    let sz = S.mutSize * msF;
    // the copies' drift (the duplicate engine slots 3, 4; a silent one stays silent)
    let jz = min(S.engJump * msF, 1.0) / 3.0;
    for (var k = 3u; k < 5u; k++) {
      if (re[k] <= 0.0) { continue; }
      re[k] = clamp(re[k] * exp(sz * 0.1 * gauss(bs, 230u + k)), 0.02, ENG_RATE_MAX);
      if (rand01(bs, 234u + k) < jz) {
        let e = eng_index(ce[k]);
        let band = eng_band(ce[k]);
        let v = rand01(bs, 240u + k);
        if (rand01(bs, 237u + k) < 0.6) { ce[k] = f32(min(u32(v * f32(ENG_COUNT)), ENG_COUNT - 1u) + 32u * band); }
        else { ce[k] = f32(e + 32u * min(u32(v * 4.0), 3u)); }
      }
    }
    // DELETION: one of the copies (a duplicate engine slot or a pump copy), at random, back to silence
    if (rand01(bs, 244u) < min(FL.g2.z * msF, 1.0)) {
      let c3 = re[3] > 0.0;
      let c4 = re[4] > 0.0;
      let q0 = rp.x > 0.0 && fam_copy(fp.x);
      let q1 = rp.y > 0.0 && fam_copy(fp.y);
      let n = select(0, 1, c3) + select(0, 1, c4) + select(0, 1, q0) + select(0, 1, q1);
      if (n > 0) {
        var j = min(i32(rand01(bs, 245u) * f32(n)), n - 1);
        if (c3) { if (j == 0) { re[3] = 0.0; fe[3] = 0.0; } j -= 1; }
        if (c4) { if (j == 0) { re[4] = 0.0; fe[4] = 0.0; } j -= 1; }
        if (q0) { if (j == 0) { rp.x = 0.0; fp.x = 0.0; } j -= 1; }
        if (q1) { if (j == 0) { rp.y = 0.0; fp.y = 0.0; } }
        atomicAdd(&hb[LG_DIV + 16u * DPC_DEL + (i & 15u)], 1);
      }
    }
    // DUPLICATION: a working slot (any engine or pump slot, at random) copied into a silent slot of its kind
    if (rand01(bs, 246u) < min(FL.g2.y * msF, 1.0)) {
      var ne = 0u;
      for (var k = 0u; k < 5u; k++) { if (re[k] > 0.0) { ne++; } }
      let n = ne + select(0u, 1u, rp.x > 0.0) + select(0u, 1u, rp.y > 0.0);
      if (n > 0u) {
        let j = min(u32(rand01(bs, 247u) * f32(n)), n - 1u);
        if (j < ne) {
          var src = 0u;
          var seen = 0u;
          for (var k = 0u; k < 5u; k++) { if (re[k] > 0.0) { if (seen == j) { src = k; } seen++; } }
          let t = select(select(5u, 4u, re[4] <= 0.0), 3u, re[3] <= 0.0);   // the first silent duplicate slot (5: none)
          if (t < 5u) {
            ce[t] = ce[src];
            re[t] = re[src];
            fe[t] = fam_word(u32(round(max(fe[src], 0.0))) / 8u, fam_reg(fe[src]) | FAM_COPY);
            nb.dg.w += 1.0;
            atomicAdd(&hb[LG_DIV + 16u * DPC_ENG + (i & 15u)], 1);
          } else {
            atomicAdd(&hb[LG_DIV + 16u * DPC_FULL + (i & 15u)], 1);
          }
        } else {
          let s1 = (j - ne == 1u) || rp.x <= 0.0;   // the source pump slot (the second working one, or the only one)
          let src = select(0u, 1u, s1);
          let t = 1u - src;
          if (rp[t] <= 0.0) {
            let pc = select(nb.pump.x, nb.pump.y, s1);
            if (t == 0u) { nb.pump.x = pc; } else { nb.pump.y = pc; }
            rp[t] = rp[src];
            fp[t] = fam_word(u32(round(max(fp[src], 0.0))) / 8u, FAM_COPY);
            nb.dg.w += 1.0;
            atomicAdd(&hb[LG_DIV + 16u * DPC_PUMP + (i & 15u)], 1);
          } else {
            atomicAdd(&hb[LG_DIV + 16u * DPC_FULL + (i & 15u)], 1);
          }
        }
      }
    }
  }
  nb.dx = vec4f(ce[3], ce[4], re[3], re[4]);
  nb.df = vec4f(fe[0], fe[1], fe[2], fe[3]);
  nb.dg = vec4f(fe[4], fp.x, fp.y, nb.dg.w);
  nb.pump = vec4f(nb.pump.xy, rp);
  return nb;
}

// step T1b: cell i's factor for the gene network's output o (cell_common.wgsl GRN_*), from its genome at the tick's start (1 while the
// outputs do not act)
fn gofP(i: u32, o: u32) -> f32 {
  if ((bitcast<u32>(FL.t1.z) & GRN_ACT) == 0u) { return 1.0; }
  let j = grn_reg(bioPrev[i].go, o);
  return grn_fac(bioPrev[i].gu[o >> 2u][o & 3u], bioPrev[i].gx[j >> 2u][j & 3u]);
}

// step C13: the field-gene words a cell's beat uses (Cell.fg), from its genome: deltas from today's values (all 0 while off)
// (step T1b: the emissions x the gene network's outputs ea, eb)
fn fg_words(b: Bio, on: bool, ea: f32, eb: f32) -> array<u32, 4> {
  if (!on) { return array<u32, 4>(0u, 0u, 0u, 0u); }
  return array<u32, 4>(pack2x16float(vec2f(b.fa.x - 1.0, b.fa.y * ea - 1.0)), pack2x16float(vec2f(b.fb.x - 1.0, b.fb.y * eb - 1.0)),
                       pack2x16float(b.fx.xy), pack2x16float(vec2f(b.fx.z, select(-1.0, 1.0, b.fb.z >= 0.0))));   // (step C12g: B's sign)
}

// step C13: the census of the field genes and the gates (Stats.fg; the frame's last tick): the genes' sums and squares, the strongest
// gate, what the cell feels, what the gates do, the beat period
fn fg_census(b: Bio, sk: array<f32, 6>, gStr: f32, fgF: u32, me: CellBeat) {
  atomicAdd(&stats.fg[FGS_N], 1u);
  let v = array<f32, 18>(b.fa.x, b.fa.y, b.fa.z, b.fa.w, b.fb.x, b.fb.y, b.fb.z, b.fb.w, b.fx.x, b.fx.y, b.fx.z, b.fx.w,
                         b.gate.x, b.gate.y, b.gate.z, b.gate.w, b.gate2.x, b.gate2.y);
  for (var k = 0u; k < 18u; k++) {
    atomicAdd(&stats.fg[FGS_SUM + k], bitcast<u32>(i32(round(v[k] * 1000.0))));
    atomicAdd(&stats.fg[FGS_SQ + k], u32(round(min(v[k] * v[k], 1000.0) * 1000.0)));
  }
  // the strongest gate gene (none: all below FGS_MIN)
  var best = 0u;
  var bv = FGS_MIN;
  for (var k = 0u; k < 5u; k++) {
    let a = abs(v[12u + k]);
    if (a >= bv) { bv = a; best = k + 1u; }
  }
  atomicAdd(&stats.fg[FGS_STRONG + best], 1u);
  var sm = 0.0;
  var lo = 1.0;
  var hi = -1.0;
  var ga = 0.0;
  for (var k = 0; k < 6; k++) { sm += sk[k]; lo = min(lo, sk[k]); hi = max(hi, sk[k]); ga += abs(gate_factor(b.gate.x, sk[k]) - 1.0); }
  sm /= 6.0;
  atomicAdd(&stats.fg[FGS_FELT], u32(round(abs(sm) * 1000.0)));
  atomicAdd(&stats.fg[FGS_SPREAD], u32(round(max(hi - lo, 0.0) * 500.0)));
  atomicAdd(&stats.fg[FGS_GUIDE], u32(round(gStr * 1000.0)));
  if ((fgF & FG_GLUE) != 0u) { atomicAdd(&stats.fg[FGS_GLUE], u32(round(ga / 6.0 * 1000.0))); }
  if ((fgF & FG_ENGINE) != 0u) { atomicAdd(&stats.fg[FGS_RATE], u32(round(abs(gate_factor(b.gate.z, sm) - 1.0) * 1000.0))); }
  // the beat period (R): 2 pi / the mean length of the three beat wavevectors, at most 100 R
  let qm = (length(me.q01.xy) + length(me.q01.zw) + length(me.q2p.xy)) / 3.0;
  let per = min(TAU / max(qm, 1e-6) / S.R, 100.0);
  var bin = 0u;
  let edges = array<f32, 7>(2.0, 3.0, 4.5, 7.0, 10.0, 15.0, 25.0);
  for (var k = 0u; k < 7u; k++) { if (per >= edges[k]) { bin = k + 1u; } }
  atomicAdd(&stats.fg[FGS_PH + bin], 1u);
  atomicAdd(&stats.fg[FGS_PSUM], u32(round(per * 1000.0)));
}

// step S2: put a push m (coverage-weighted px / s, x the fixed point) on the stir grid at p (bilinear, as the body's drag above)
fn stir_put(p: vec2f, m: vec2f, sw: u32, sh: u32, so: u32) {
  let gp = clamp(p / FL.g0b.z, vec2f(0.0), vec2f(f32(sw - 1u), f32(sh - 1u)) - 1e-3);
  let gb = vec2u(floor(gp));
  let gt = gp - vec2f(gb);
  let n = sw * sh;
  let wq = array<f32, 4>((1.0 - gt.x) * (1.0 - gt.y), gt.x * (1.0 - gt.y), (1.0 - gt.x) * gt.y, gt.x * gt.y);
  let oq = array<u32, 4>(0u, 1u, sw, sw + 1u);
  let o0 = gb.y * sw + gb.x;
  for (var q = 0; q < 4; q++) {
    let mq = vec2i(round(clamp(m * wq[q], vec2f(-1.0e9), vec2f(1.0e9))));
    if (mq.x != 0) { atomicAdd(&hb[so + o0 + oq[q]], mq.x); }
    if (mq.y != 0) { atomicAdd(&hb[so + n + o0 + oq[q]], mq.y); }
  }
}

// step S2: the motors' census (Stats.s2, cell_common.wgsl S2S_*; the frame's last tick)
fn motor_census(b: Bio, c: Cell, flagA: f32, ciliaA: f32, swimV: f32, free: u32, touch: u32, cpN: f32, cpS: f32, cpC: f32, cyS: f32, cyC: f32,
                turn: f32, uW: vec2f, curD: f32, pay: f32) {
  atomicAdd(&stats.s2[S2S_N], 1u);
  let fg = clamp(b.mo.x, 0.0, 1.0);
  let cg = clamp(b.mo.w, 0.0, 1.0);
  atomicAdd(&stats.s2[S2S_FG], u32(round(fg * 1000.0)));
  atomicAdd(&stats.s2[S2S_FG2], u32(round(fg * fg * 1000.0)));
  atomicAdd(&stats.s2[S2S_CG], u32(round(cg * 1000.0)));
  atomicAdd(&stats.s2[S2S_CG2], u32(round(cg * cg * 1000.0)));
  atomicAdd(&stats.s2[S2S_K], bitcast<u32>(i32(round(clamp(b.mc.x, -1.0, 1.0) * 1000.0))));
  atomicAdd(&stats.s2[S2S_SIGN], bitcast<u32>(i32(round(clamp(b.mo.y, -1.0, 1.0) * 1000.0))));
  atomicAdd(&stats.s2[S2S_PLACE], u32(round(abs(clamp(b.mo.z, -1.0, 1.0)) * 1000.0)));
  atomicAdd(&stats.s2[S2S_TILT], u32(round(abs(clamp(b.mc.y, -1.0, 1.0)) * 1000.0)));
  atomicAdd(&stats.s2[S2S_CFG], u32(round(flagA * 1000.0)));
  atomicAdd(&stats.s2[S2S_CCG], u32(round(ciliaA * 1000.0)));
  atomicAdd(&stats.s2[S2S_PAY], bitcast<u32>(heat_counts(pay)));
  if (fg >= 0.1) {
    atomicAdd(&stats.s2[S2S_FC], 1u);
    if (b.mo.y >= 0.0) { atomicAdd(&stats.s2[S2S_PUSH], 1u); }
  }
  if (cg >= 0.1) { atomicAdd(&stats.s2[S2S_CC], 1u); }
  if (fg >= 0.1 || cg >= 0.1) {
    atomicAdd(&stats.s2[S2S_MC], 1u);
    atomicAdd(&stats.s2[S2S_MOTE], u32(round(clamp(c.motE, 0.0, 1.0) * 1000.0)));
  }
  if (flagA >= 0.05) {
    atomicAdd(&stats.s2[S2S_SWIM], 1u);
    atomicAdd(&stats.s2[S2S_SPEED], u32(round(min(swimV, 100.0) * 1000.0)));
    atomicAdd(&stats.s2[S2S_SPIN], u32(round(min(abs(turn), 10.0) * 1000.0)));
    atomicAdd(&stats.s2[S2S_RELV], u32(round(min(length(c.vel - curD * uW) / S.R, 100.0) * 1000.0)));
    if (touch == 0u) { atomicAdd(&stats.s2[S2S_OPEN], 1u); }
  }
  let nf = countOneBits(free);
  if (ciliaA >= 0.05 && nf > 0u) {
    atomicAdd(&stats.s2[S2S_BEAT], 1u);
    atomicAdd(&stats.s2[S2S_FREE], nf);
    atomicAdd(&stats.s2[S2S_COS], bitcast<u32>(i32(round(cos(b.mc.z) * 1000.0))));
    atomicAdd(&stats.s2[S2S_SIN], bitcast<u32>(i32(round(sin(b.mc.z) * 1000.0))));
    if (cpN > 0.0) {
      atomicAdd(&stats.s2[S2S_WN], 1u);
      atomicAdd(&stats.s2[S2S_WAVE], u32(round(clamp(length(vec2f(cpS, cpC)) / cpN, 0.0, 1.0) * 1000.0)));
      atomicAdd(&stats.s2[S2S_SYNC], u32(round(clamp(length(vec2f(cyS, cyC)) / cpN, 0.0, 1.0) * 1000.0)));
    }
  }
}
