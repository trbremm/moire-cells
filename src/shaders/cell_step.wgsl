// One simulation tick for every cell: the field felt on the membrane (step 4), contact signalling and fate choice from the genome, adhesion, soft
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
  // step C10, patterned walls (src/walls.js): this cell's effective adhesion per side (the eat pass's, last tick) and the
  // orientation its sides are found by, both as its lean copy has them (what its neighbours see, so the two cells of a contact
  // find the same pair of sides), and per side the touching that matures its junctions
  let wlF = bitcast<u32>(FL.wl0.x);
  let wallOn = (wlF & WL_ON) != 0u;
  let mine0 = sorted[j].wadh;
  let myTh = wall_theta(sorted[j].flags, (mine0.y >> 16u) & 255u);
  let wA = unpack4x8unorm(mine0.x) * WALL_AMAX;
  let wB = unpack4x8unorm(mine0.y & 0xffffu).xy * WALL_AMAX;
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
  let diff = (S.rules & RULE_DIFF) != 0u;
  let adh = (S.rules & RULE_ADH) != 0u && S.adhesion > 0.0;
  var M = 0.0;              // recognised contact: sum over touching neighbours of (contact x key match)
  var comp = 0.0;           // step C9, crowding: the sum of the overlaps, each as a share of the contact distance
  var sig = vec4f(0.0);     // committed neighbours' signals per fate channel
  var wParent = 0.0;        // touching neighbours' weight so far, and the one picked as parent (sorted slot); step C5,
  var parent = 0xffffffffu; // energy-biased turnover: a neighbour weighs FL.bias + its battery share (else all 1)
  let biasOn = (FL.eat & EAT_BIAS) != 0u;

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
  let rw = select(S.tuneW, bio.rec.x, byRec);
  var C = vec2f(0.0);                        // contact squeeze (traceless tensor: (xx - yy, 2 xy) parts)
  // field B (step 5): its gradient at the centre, summed over the neighbours within its reach, each weighted by
  // the sign rule; it reaches past the usual 3 x 3 grid block, so the block grows to FL.bReach cells around
  let feelB = FL.bGain > 0.0;
  let cutB = FL.bCut * S.R;
  let myQA = charge_a(FL, c.kind);
  // rule 1 (step 6), leak by deformation: a cell whose strained A lattice reaches B's band also listens to B
  // through its A charge, in the share it leaks (me.lk.w): its charge in B is its own B charge plus that
  // (rule 2: a converted cell listens to B with the charge it emits with)
  let myQB = cell_charge_b(FL, c) + FL.leak * me.lk.w * myQA;
  var gB = vec2f(0.0);
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
        // step C6c: contact flattens. The wall between the two cells is the line where their power distances |x - p|^2 - r^2
        // are equal (the midline, shifted toward the smaller cell; both cells find the same line, so they share a straight
        // wall): every corner of this cell must stay on its side of it
        if (hexShape && d2 < 1.96 * R0 * R0 && d2 > 1e-6) {
          let dh = sqrt(d2);
          let uh = d / dh;
          let wall = 0.5 * dh + (c.r * c.r - o.r * o.r) / (2.0 * dh);
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
          let wt = clamp((1.2 * R0 - dh) / (0.3 * R0), 0.0, 1.0);
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
          if (w != 0.0) {
            if (ob.b2a.z != 0.0) { gB += w * cell_field_b(ob, c.pos, cutB).xy; }
            if (ob.lk.z != 0.0) { gB += w * cell_field_leak(ob, c.pos, cutB).xy; }   // its leaked B (rule 1)
          }
        }
        if (d2 < cutR * cutR) {
          let ob = beats[k];
          if (ob.k2a.z > 0.0) {
            // weight: sign by fates (EMW), receptor tuning by how alike the lattices are, strength, taper
            let tn = tuning(lattice_dist2(rk0, rk1, rk2, ob.k01.xy, ob.k01.zw, ob.k2a.xy), med.k0, rw);
            aFelt += tn * cell_field(ob, c.pos, cutR);
            if (changeOn) { pFelt += tn * cell_field_ph(ob, c.pos, cutR, p_shift(FL.pSgn1)); }
            let wq = myQA * emw(c.kind, o.kind) * tn * ob.k2a.z * cut_taper(d2, cutR);
            if (partner) {
              // step 8: field A and its partner A' on the membrane, with the same weight (S.sense is put on A after)
              if (wq != 0.0) {
                sense_pair(&segQ, &segP, mb, c.pos - ob.q2p.zw, ob.q01.xy, ob.q01.zw, ob.q2p.xy, ob.ph, ob.k2a.w, wq, wq, pSgn);
              }
            } else if (sensing && wq != 0.0 && S.sense != 0.0) {
              sense_field(&seg, mb, c.pos - ob.q2p.zw, ob.q01.xy, ob.q01.zw, ob.q2p.xy, ob.ph, ob.k2a.w, S.sense * wq);
            }
          }
        }
        // step 7, exclusion: the distance below which this pair pushes apart (Rt) and how hard (kx)
        var Rt = R0;
        var kx = 1.0;
        if (o.kind == c.kind) {
          let os = cell_state(o.la, o.flags, S.states);
          let same = os == myState;
          if (d2 < shell * shell * R0 * R0) { nState[min(os, 3u)]++; }
          if (S.xCount != 0u && d2 < 2.56 * R0 * R0) {
            xAll++;
            if (same) { xSame++; }
            if (d2 < S.reach * S.reach * R0 * R0) { tAll++; if (same) { tSame++; } }
          }
          if (exclOn) {
            Rt = select(S.pack * R0, S.exclReach * R0, same);
            kx = select(1.0, S.excl, same);
          }
        }
        let reach = S.reach * R0;
        if (d2 >= max(reach * reach, Rt * Rt)) { continue; }
        let dist = sqrt(d2);
        // step C7: the touching neighbour across each side (nearest per side), for the pumps across contact
        if (nbrOn && dist < reach) {
          let ux = d.x / max(dist, 1e-6);
          let uy = d.y / max(dist, 1e-6);
          let ca = ux * nmxA + uy * nmyA;
          let cb = ux * nmxB + uy * nmyB;
          let cm = max(max(max(ca.x, ca.y), max(ca.z, ca.w)), max(cb.x, cb.y));
          let dn = dist / R0;
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
        if (dist < R0) {
          let wp = select(1.0, FL.bias + o.bat, biasOn);
          wParent += wp;
          if (rand01(c.seed ^ pcg(S.tick ^ 0x27d4eb2fu), k) * wParent < wp) { parent = k; }
        }
        if (diff || adh) {
          if (diff && o.kind >= 1u && o.kind <= 4u) { sig[o.kind - 1u] += touch * ob.rec.z; }
          if (adh && dist > 1e-3) {
            // like sticks to like: both cells' stickiness, times how alike their keys are, plus same-fate glue
            let sa = S.adhSigma;
            let like = exp(-key_dist2(c.la, c.aux, o.la, o.aux) / (2.0 * sa * sa));
            let fateGlue = select(0.0, S.fateAdh, o.kind == c.kind && c.kind != KIND_STEM);
            var stick = sqrt(max(bio.body.x * ob.body.x, 0.0)) * like + fateGlue;
            // The pull fades out below 0.85 x contact distance, so sticky cells touch without piling up.
            let near = clamp((dist / R0 - 0.85) / 0.15, 0.0, 1.0);
            if (wallOn) {
              // step C10: the contact holds by the smaller of the two touching sides' effective adhesion (both must be sticky),
              // times the match (the keys' likeness plus the same-fate glue): adhesion = molecules x how well they match
              let ks = wall_side(myTh, d);
              let mine = select(wB[ks & 1u], wA[ks & 3u], ks < 4u);
              let ko = wall_side(wall_theta(o.flags, (o.wadh.y >> 16u) & 255u), -d);
              let gl = min(mine, wall_get(o.wadh.x, o.wadh.y, ko));
              stick = gl * (like + fateGlue);
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
                let a0 = atan2(d.y, d.x);
                let thO = wall_theta(o.flags, (o.wadh.y >> 16u) & 255u);
                let jp = wall_at_a(o.wadh.x, o.wadh.y, thO, a0 + 3.14159265 - 0.5235988);   // the neighbour's glue at the wall's + end
                let jm = wall_at_a(o.wadh.x, o.wadh.y, thO, a0 + 3.14159265 + 0.5235988);   // ... - end
                let jc = wall_at_a(o.wadh.x, o.wadh.y, thO, a0 + 3.14159265);               // ... middle
                let tp = myTh + TURN_DA;
                let tn = myTh - TURN_DA;
                let gUp = min(wall_at_a(mine0.x, mine0.y, tp, a0 + 0.5235988), jp) + 2.0 * min(wall_at_a(mine0.x, mine0.y, tp, a0), jc)
                        + min(wall_at_a(mine0.x, mine0.y, tp, a0 - 0.5235988), jm);
                let gDn = min(wall_at_a(mine0.x, mine0.y, tn, a0 + 0.5235988), jp) + 2.0 * min(wall_at_a(mine0.x, mine0.y, tn, a0), jc)
                        + min(wall_at_a(mine0.x, mine0.y, tn, a0 - 0.5235988), jm);
                let h = 0.2886751 * dist;               // half the shared wall: a hexagon's side, at the contact's distance
                glueTq += touch * near * (like + fateGlue) * S.adhesion * S.R * S.stiffness * h * 0.1745329 * (gUp - gDn) / (8.0 * TURN_DA);
              }
              if (S.xCount != 0u) {
                rtA += select(vec4f(0.0), vec4f(touch), vec4u(ks) == vec4u(0u, 1u, 2u, 3u));
                rtB += select(vec2f(0.0), vec2f(touch), vec2u(ks) == vec2u(4u, 5u));
                wPairs++;
                wGlue += u32(round(gl * 1000.0));
                if (wall_mature(myMat, ks) > 0.5) { wMatP++; }
                if (dot(d, wFront) > 0.866 * dist) { wFrontP++; }
              }
            }
            // (minus a baseline: unlike neighbours push off a little, which lets the tissue sort itself out)
            f += d / dist * (touch * near * (stick - S.adhBase) * S.adhesion * S.R * S.stiffness);
          }
        }

        comp += max(R0 - dist, 0.0) / R0;
        if (dist >= max(R0, Rt) || S.stiffness <= 0.0) { continue; }
        // soft contact push: an overlap spring (step 7: to Rt, kx times as hard)
        var u: vec2f;
        if (dist > 1e-3) {
          u = d / dist;
        } else {
          // exactly on top of each other: push apart in a direction set by the pair
          let a = TAU * rand01(min(i, beats[k].idx) * 7919u + max(i, beats[k].idx), 17u);
          u = vec2f(cos(a), sin(a)) * select(-1.0, 1.0, i < beats[k].idx);
        }
        if (dist < Rt) { f -= u * S.stiffness * kx * (Rt - dist); }
        // contact squeezes the cell along the contact axis (passive deformation; by the real overlap)
        let ov = max(R0 - dist, 0.0) / R0;
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
    c.mature = array<u32, 3>(pack2x16unorm(mA.xy), pack2x16unorm(mA.zw), pack2x16unorm(mB));
  } else {
    c.mature = array<u32, 3>(0u, 0u, 0u);
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
      if (sensing) { seg[a] += S.sense * segQ[a]; }
    }
    pA = vec3f(pA.xy / sArea, pA.z / 6.0);
    pP = vec3f(pP.xy / sArea, pP.z / 6.0);
  }

  var Q = vec2f(0.0);                        // the field's pull on the outline (quadrupole of the membrane signal)
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
    if (cm > 1e-6) { f += cf * (sat * tanh(cm / sat) / cm); }
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
    let fb = FL.bGain * 3.38 * S.R * c.r * gB;
    let bm = length(fb);
    let bs = FL.bSat * S.R;
    if (bm > 1e-6) { f += fb * (bs * tanh(bm / bs) / bm); }
  }

  // step 8, rule a: the pair A + i A' carries a phase, and where the phase changes it has a direction of travel: the
  // phase current  j = A grad A' - A' grad A  (= |pair|^2 x the phase gradient). The cell is pushed along it, as if
  // carried by the wave: gain x R x (R x phase gradient) per s, softened near zeros of the pair, saturating.
  if (partner && FL.pGain > 0.0) {
    let jc = pA.z * pP.xy - pP.z * pA.xy;
    let fj = FL.pGain * S.R * S.R * jc / (pA.z * pA.z + pP.z * pP.z + FL.pEps * FL.pEps);
    let jm = length(fj);
    let js = FL.pSat * S.R;
    if (jm > 1e-6) { f += fj * (js * tanh(jm / js) / jm); }
  }

  // differentiation: leaky accumulators per fate channel (SUFFICIENT: only sustained input crosses the
  // threshold); a stem cell commits to its strongest channel above threshold, a committed cell falls back to
  // stem only when its channel drops below release x threshold (sticky)
  if (diff) {
    let input = bio.resp * M + bio.relay * sig;
    bio.acc += (input - bio.acc) * min(1.0, S.dt / S.tau);
    let thr = bio.rec.y;
    if (c.kind == KIND_STEM) {
      var best = 0u;
      for (var ch = 1u; ch < 4u; ch++) { if (bio.acc[ch] > bio.acc[best]) { best = ch; } }
      if (bio.acc[best] > thr) { c.kind = best + 1u; }
    } else if (c.kind <= 4u) {
      if (bio.acc[c.kind - 1u] < S.release * thr) { c.kind = KIND_STEM; }
    }
  } else {
    bio.acc = vec4f(0.0);
    c.kind = KIND_STEM;
  }

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
      let g = FL.side * S.sense * 3.38 * c.r * S.R * pP.xy;
      var fs = vec2f(-g.y, g.x);
      let fm = length(fs);
      let sat = S.senseMax * S.R;
      if (fm > 1e-6) { fs *= sat * tanh(fm / sat) / fm; }
      f += fs;
    } else {
      let a = tanh(pP.z / max(abs(pA.z), FL.pEps));
      f += FL.side * a * vec2f(-c.vel.y, c.vel.x) / max(1.0 - S.damping, 1e-3);
    }
  }

  // gentle pull to the middle, slow drift of the medium (as the reference)
  f += (S.centre - c.pos) * S.pull;
  f += S.drift * S.R * vec2f(sin(c.pos.y * 0.011 + S.time * 0.10), sin(c.pos.x * 0.012 - S.time * 0.08));

  // soft walls, 3 R in from the dish edge
  let mg = 3.0 * S.R;
  if (c.pos.x < mg) { f.x += (mg - c.pos.x) * S.wall; } else if (c.pos.x > S.W - mg) { f.x -= (c.pos.x - S.W + mg) * S.wall; }
  if (c.pos.y < mg) { f.y += (mg - c.pos.y) * S.wall; } else if (c.pos.y > S.H - mg) { f.y -= (c.pos.y - S.H + mg) * S.wall; }

  // stirring: the pointer drags cells within reach along with it
  let p = c.pos - S.pointer;
  let pd2 = dot(p, p);
  if (pd2 < S.stirR2) { f += S.pvel * (1.0 - pd2 / S.stirR2) * S.stir; }

  // body traits: size and motility from the genome, times a fate-typical factor
  var size = 1.0;
  var mot = 1.0;
  if (S.body > 0.0) {
    size = mix(1.0, bio.body.y * fate_size(c.kind), S.body);
    mot = mix(1.0, bio.body.z * fate_motility(c.kind), S.body);
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
    if (gm > 1e-9) { motor += FL.smell * tanh(gm / max(FL.smellHalf, 1e-6)) * c.smell / gm; }
  }
  // step C5: the battery gates the motor (full speed from FL.crawlFull of the battery, none when it is empty) and pays
  // for it: crawlCost x the work of crawling at that speed against the drag (its motion energy x (1 - damping^2) per
  // tick), paid by the eat pass after this step (Cell.pay)
  let payOn = (FL.eat & EAT_PAY) != 0u;
  let gate = select(1.0, clamp(c.bat / max(FL.crawlFull, 1e-3), 0.0, 1.0), payOn);
  let fMotor = motor * S.R * mot * gate;
  f += fMotor;
  c.pay = select(0, heat_counts(FL.crawlCost * heat_ke(fMotor) * (1.0 - S.damping * S.damping)), payOn);
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
  c.vel = v3;
  if (kicks) {
    c.pos += c.vel * S.dt;
  } else {
    let jit = vec2f(rand01(c.seed, S.tick * 2u), rand01(c.seed, S.tick * 2u + 1u)) - 0.5;
    c.pos += c.vel * S.dt + jit * S.jitter * S.R * mot;
  }
  c.pos = clamp(c.pos, vec2f(0.0), vec2f(S.W, S.H));
  var eDeath = 0.0;          // the motion of a cell that dies this tick (its daughter starts at rest) becomes heat too
  c.r += (S.R * size - c.r) * min(1.0, S.dt * 0.8);

  // shape: an area-preserving stretch e = (e1, e2), relaxing toward a target made of the passive contact
  // squeeze and (active, key W) a stretch along the cell's own motion and toward where the field pulls on its
  // outline; muscle stretches along its crawling heading. As the reference's step(); length capped at 0.5.
  // (step C6c: a honeycomb cell has no passive squeeze in its target: contact presses its sides flat instead, below)
  var dTh = 0.0;                             // step C10: how far the hexagon turned this tick (the front turns with it)
  // step C11: the glue's torque turns the BODY, overdamped: at turning strength / rotational drag (wl1.w) x torque / (r^2 / 2)
  // (a disc's rotational drag on its substrate, against the drag 1 the motion has: velocity = force), at most TURN_MAX
  var wTurn = 0.0;
  if (glueTurn) { wTurn = clamp(FL.wl1.w * glueTq / max(0.5 * c.r * c.r, 1e-6), -TURN_MAX, TURN_MAX); }
  var dFront = 0.0;                          // ... and how far the body (and so the front) turned
  var t = select(0.5 * C, vec2f(0.0), hexShape);
  t += dStretch;                             // step C6d: a polarised cell in a field stretches along it
  if (S.activeGain > 0.0) {
    let spd = length(c.vel);
    if (spd > 0.01) {
      let mv = 0.25 * tanh(spd / (2.0 * S.R)) / (spd * spd);
      t += S.activeGain * mv * vec2f(c.vel.x * c.vel.x - c.vel.y * c.vel.y, 2.0 * c.vel.x * c.vel.y);
    }
    let qm = length(Q);
    if (qm > 1e-6) { t += S.activeGain * (0.35 * tanh(qm / 1.5) / qm) * Q; }
    if (c.kind == KIND_MUS) { t += S.activeGain * 0.3 * vec2f(cos(2.0 * bio.body.w), sin(2.0 * bio.body.w)); }
  }
  if (!hexShape) {
    var e = vec2f(c.e1, c.e2);
    e += (t - e) * min(1.0, S.dt * S.shapeRate);
    let em = length(e);
    if (em > 0.5) { e *= 0.5 / em; }
    c.e1 = e.x;
    c.e2 = e.y;
  } else {
    // step C6c, elastic honeycomb cells. The active stretch follows its target as the ellipse's did; the rest shape is the
    // hexagon on that stretch's ellipse at the rest area A0
    var ea = c.ea + (t - c.ea) * min(1.0, S.dt * S.shapeRate);
    let eam = length(ea);
    if (eam > 0.5) { ea *= 0.5 / eam; }
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
      if (rad[k] > 2.2 * c.r) { rad[k] = 2.2 * c.r; rv[k] = min(rv[k], 0.0); }
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
      dTh = c.spin * S.dt + mean + dFront;
    } else {
      c.spin += (FL.hex.z * tq + FL.dip0.w * dTorque - S.hexTurnDamp * c.spin) * S.dt;   // (step C6d: + the field's torque)
      dTh = c.spin * S.dt + mean;
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
    let e = select(vec2f(0.0), tl * (min(eps, 0.5) / max(tlm, 1e-12)), tlm > 1e-9 * (M.x + M.z));
    c.e1 = e.x;
    c.e2 = e.y;
  }

  // step C10: the FRONT. It is a direction fixed in the body (it turns as the hexagon turns, and a daughter inherits it), and the
  // gene w lets the charge dipole (step C6d) pull it round: toward the dipole's + end at wl0.y x w x |d| rad/s x sin of the angle
  // between them. So w = 0: the inherited orientation alone; w = 1 and a strong dipole: the front follows the dipole within a few
  // seconds; a weak or passing dipole barely moves it (the front is a persistent property of the cell)
  if (wallOn) {
    var fr = c.front + select(dFront, wTurn * S.dt, glueTurn && !hexShape);   // (an ellipse cell: the glue turns the front alone)
    if ((wlF & WL_FRONT) != 0u && dipOn && myDm > 1e-3) {
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
      d.kind = select(KIND_STEM, pc.kind, (S.rules & RULE_INHERIT) != 0u);
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
    if (burstDie) {
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
      if (ev < STATS_EVENTS) { stats.events[ev] = vec4f(c.pos, -1.0, 0.0); }
      eDeath = heat_ke(c.vel);                  // its motion becomes heat
      c.vel = vec2f(0.0);
      c.flags = CELL_BORN;                      // dead (no CELL_ALIVE): the eat pass hands its stock back where it is
      c.dead = c.pos;
      c.mom = 0xffffffffu;
      c.bat = 0.0;
      c.fill = 0.0;
      c.pay = 0;
      died = true;
    } else if (c.bat >= FL.dv0.y && c.r >= FL.dv2.x * S.R * size && bt == 0u) {
      if (S.xCount != 0u) {
        atomicAdd(&stats.div[DV_READY], 1u);
        if (comp > FL.dv0.z) { atomicAdd(&stats.div[DV_CROWDED], 1u); }
      }
      if (comp <= FL.dv0.z && rand01(c.seed ^ 0x51ed270bu, S.tick) < FL.dv0.w * S.dt) {
        let t = atomicAdd(&stats.claim, 1u);
        if (t < S.count - aliveN) {
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
          let u = vec2f(cos(ang), sin(ang));
          let r0 = c.r;
          let np = clamp(c.pos + u * (FL.dv2.z * r0), vec2f(0.0), vec2f(S.W, S.H));
          c.pos = clamp(c.pos - u * (FL.dv2.z * r0), vec2f(0.0), vec2f(S.W, S.H));
          c.r = FL.dv2.y * r0;
          for (var q = 0; q < 6; q++) { c.rad[q] *= FL.dv2.y; c.radV[q] = 0.0; }
          c.bat *= 0.5;
          c.fill *= 0.5;
          var d: Cell;
          d.pos = np;
          d.r = FL.dv2.y * r0;
          d.la = nb.key.x;
          d.kind = select(KIND_STEM, c.kind, (S.rules & RULE_INHERIT) != 0u);
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

  // step C1: the heat under the cell gets the drag's loss and a dead cell's motion, minus what the kick took, spread
  // evenly over the 3 x 3 pixels it read (whole counts, the remainder to the middle); the ledger books the work, the
  // drag and the kicks (each in one of 256 or 160 slots, so the atomic adds do not all queue on one address)
  let cDrag = heat_counts(eDrag);
  let cKick = heat_counts(eKick);
  let dep = cDrag - cKick + heat_counts(eDeath);
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
  atomicAdd(&hb[LG_WORK + (j & 255u)], heat_counts(eWork));
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
    atomicAdd(&stats.wall[WS_A0], u32(round(clamp(bio.body.x, 0.0, 1.0) * 1000.0)));
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
      let p = clamp(bio.body.x + FL.wl1.y * (a1 * cs + a2 * (2.0 * cs * cs - 1.0)), 0.0, 1.0);
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
  // step C7: the neighbours across the sides, 16 bits each (none while the pumps across contact are off)
  c.nbr = array<u32, 3>(nbIA.x | (nbIA.y << 16u), nbIA.z | (nbIA.w << 16u), nbIB.x | (nbIB.y << 16u));
  cells[i] = c;
  bioNext[i] = bio;
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
// state reset: the accumulators unless fates are inherited, what it felt, its heading), and the step C8 census of the birth.
// Step C8, hard light mutates: the parent's hard light dose (Cell.flags, from the eat pass) scales this copy's mutation,
// x (1 + hm.x x dose), at most hm.y x (the small steps' size and every jump's chance alike); with mutation off (key M) only the
// extra part mutates, so in the dark a lineage then stays pure. bs: the birth's random stream; i: the slot counting it.
fn daughter_genome(p: Bio, bs: u32, pdose: f32, i: u32) -> Bio {
  var nb = p;
  let hx = select(0.0, min(FL.hm.x * pdose, max(FL.hm.y - 1.0, 0.0)), FL.hm.x > 0.0);
  let mOn = (S.rules & RULE_MUT) != 0u;
  let ms = select(0.0, 1.0, mOn) + hx;
  let e0 = nb.eng.xyz;                      // (to count the slot jumps: an engine or pump slot changed, started or emptied)
  let r0 = nb.rate.xyz > vec3f(0.0);
  let q0 = nb.pump.xy;
  let qr0 = nb.pump.zw > vec2f(0.0);
  if (ms > 0.0) {
    nb = mutate(nb, bs, S.mutSize * ms, min(S.mutJump * ms, 1.0), min(S.engJump * ms, 1.0), min(FL.memb.w * ms, 1.0));
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
  if ((S.rules & RULE_INHERIT) == 0u) { nb.acc = vec4f(0.0); }
  nb.env = vec4f(0.0);                      // a newborn has felt nothing yet and is not converted (step C9: nor starving)
  nb.conv = vec4f(0.0);
  nb.body.w = TAU * rand01(bs, 200u);
  return nb;
}
