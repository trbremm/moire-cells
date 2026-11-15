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
  if (j >= S.count) { return; }
  let i = beats[j].idx;              // the cell's own slot in `cells` (sortIdx, carried in its beat)
  var c = cells[i];                  // (step C6c: from its own slot, whole; the same as its sorted copy, which has no outline)
  var bio = bioPrev[i];
  if ((c.flags & CELL_ALIVE) == 0u) { cells[i] = c; bioNext[i] = bio; return; }

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
  // ... the contacts: each neighbour's wall caps how far out each corner may sit (bound), pulls the hexagon round so a
  // side faces it (torque, weighted by closeness tw), and slides each corner round toward the corner of its tile (slide:
  // the slope of the soft-nearest wall's distance along the corner's direction, sw its weight)
  var bound = array<f32, 6>(1e9, 1e9, 1e9, 1e9, 1e9, 1e9);
  var slide = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  var sw = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let hu = hex_dirs(c);
  let rot6 = vec2f(cos(6.0 * c.theta), -sin(6.0 * c.theta));
  var torque = 0.0;
  var tw = 0.0;

  var f = vec2f(0.0);
  let diff = (S.rules & RULE_DIFF) != 0u;
  let adh = (S.rules & RULE_ADH) != 0u && S.adhesion > 0.0;
  var M = 0.0;              // recognised contact: sum over touching neighbours of (contact x key match)
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

  // every neighbour within reach: contact push, and (differentiation on) recognition and signals
  let rg = grid_range_n(S, grid_xy(S, c.pos), select(1, i32(FL.bReach), feelB || relayOn));
  for (var gy = rg.y; gy <= rg.w; gy++) {
    for (var gx = rg.x; gx <= rg.z; gx++) {
      let g = grid_index(S, vec2i(gx, gy));
      let s = starts[g];
      let e = select(starts[g + 1u], S.count, g + 1u >= S.gw * S.gh);
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
          for (var k = 0; k < 6; k++) {
            let cu = dot(uh, hu[k]);
            if (cu > 0.05) {
              let b = wall / cu;
              bound[k] = min(bound[k], b);
              // the tile's corners are where its boundary is farthest from the centre: along the corner's direction the
              // wall's distance b grows as the corner turns away from the wall's normal, d(log b)/d(angle) = -(uh . u_perp)
              // / (uh . u); summed over the walls weighted by (b / r)^-12 (a soft minimum: at a tile corner the two walls'
              // slopes cancel smoothly, so the corner settles there instead of chattering)
              if (b < 2.5 * c.r) {
                let wb = pow(max(b / c.r, 0.2), -12.0);
                slide[k] -= wb * (uh.y * hu[k].x - uh.x * hu[k].y) / cu;
                sw[k] += wb;
              }
            }
          }
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
            var stick = sqrt(max(bio.body.x * ob.body.x, 0.0)) * exp(-key_dist2(c.la, c.aux, o.la, o.aux) / (2.0 * sa * sa));
            if (o.kind == c.kind && c.kind != KIND_STEM) { stick += S.fateAdh; }
            // (minus a baseline: unlike neighbours push off a little, which lets the tissue sort itself out)
            // The pull fades out below 0.85 x contact distance, so sticky cells touch without piling up.
            let near = clamp((dist / R0 - 0.85) / 0.15, 0.0, 1.0);
            f += d / dist * (touch * near * (stick - S.adhBase) * S.adhesion * S.R * S.stiffness);
          }
        }

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

  // step 8: the field A and partner A' this cell feels from its neighbours: the mean over the membrane, and the gradient
  // (sum of segment mean x outward normal x length = area x gradient; the outline's area is 2.6 r^2)
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
  var t = select(0.5 * C, vec2f(0.0), hexShape);
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
    for (var k = 0; k < 6; k++) {
      let acc = -FL.hex.x * (rad[k] - tgt[k]) - FL.hex.y * rv[k];
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
    c.spin += (FL.hex.z * tq - S.hexTurnDamp * c.spin) * S.dt;
    c.theta += c.spin * S.dt + mean;
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
  if (turnOn && parent != 0xffffffffu) {
    let rate = S.turnover * (1.0 + S.unhappy * (1.0 - min(M, 1.0)));
    let ud = rand01(c.seed ^ 0x165667b1u, S.tick);
    if (ud < (rate + hot) * S.dt) {
      if (ud < hot * S.dt) { atomicAdd(&stats.heatDeaths, 1u); }
      let bs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + i));    // this birth's random stream
      let pc = sorted[parent];
      let pi = beats[parent].idx;
      var nb = bioPrev[pi];
      if ((S.rules & RULE_MUT) != 0u) { nb = mutate(nb, bs, S.mutSize, S.mutJump, S.engJump); }
      let inherit = (S.rules & RULE_INHERIT) != 0u;
      if (!inherit) { nb.acc = vec4f(0.0); }
      nb.env = vec4f(0.0);                      // a newborn has felt nothing yet and is not converted
      nb.conv = vec4f(0.0);
      nb.body.w = TAU * rand01(bs, 200u);
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
      d.kind = select(KIND_STEM, pc.kind, inherit);
      d.flags = CELL_ALIVE;
      d.seed = pcg(bs ^ 0x5bd1e995u);
      d.aux = nb.key.y;
      d.z = vec2f(1.0, 0.0);
      // step C5: the eat pass hands the dead cell's stock back to the dish where it died, and gives the newborn half of
      // its parent's stock and battery (the newborn's battery share until then: half the parent's)
      d.flags = CELL_ALIVE | CELL_BORN;
      d.dead = c.pos;
      d.mom = pi;
      d.bat = 0.5 * pc.bat;
      d.pay = 0;
      d.fill = 0.5 * pc.fill;
      eDeath = heat_ke(c.vel);
      c = d;
      bio = nb;
    }
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
  if ((HP.flags & 2u) != 0u) {
    let cov = i32(round(3.14159265 * c.r * c.r / (HP.px * HP.px) * COVER_SCALE));
    let cp = heat_xy(HP, c.pos);
    atomicAdd(&hb[LEDGER_WORDS + 3u * HP.n + u32(cp.y) * HP.hw + u32(cp.x)], cov);
  }
  atomicAdd(&hb[LG_WORK + (j & 255u)], heat_counts(eWork));
  let slot = j % LG_SLOTS_DK;
  if (cDrag != 0) { atomicAdd(&hb[LG_DRAG + slot], cDrag); }
  if (cKick != 0) { atomicAdd(&hb[LG_KICK + slot], cKick); }

  // the leak level, for the drawing and the census (a newborn starts at 0)
  if (c.seed != sorted[j].seed) { c.flags &= ~(255u << CELL_LEAK_SHIFT); }
  else { c.flags = (c.flags & ~(255u << CELL_LEAK_SHIFT)) | (u32(round(clamp(me.lk.w, 0.0, 1.0) * 255.0)) << CELL_LEAK_SHIFT); }
  cells[i] = c;
  bioNext[i] = bio;
}

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
