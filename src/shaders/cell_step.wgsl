// One simulation tick for every cell: the field felt on the membrane (step 4), contact signalling and fate choice from the genome, adhesion, soft
// contact push, gentle pull to the dish centre, slow drift of the medium, soft walls, stirring, crawling,
// damped (viscous) velocity and a little Brownian jitter.
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
//
// One invocation per slot of the sorted list (cell_grid.wgsl), so neighbouring invocations read neighbouring
// memory. It reads only the sorted copy (positions as they were when the grid was built) and writes the
// result to the cell's own slot in `cells`, so no cell reads a half-updated neighbour.
// Ported from the reference's step(): contact push -KR (R0 - d), v = 0.85 v + 0.15 F per tick,
// jitter +-0.025 R per tick, walls 3 R from the edge.

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> sorted: array<Cell>;
@group(0) @binding(3) var<storage, read> starts: array<u32>;
@group(0) @binding(4) var<storage, read> counts: array<u32>;
@group(0) @binding(5) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(6) var<storage, read> bioPrev: array<Bio>;
@group(0) @binding(7) var<storage, read_write> bioNext: array<Bio>;
@group(0) @binding(8) var<storage, read_write> stats: Stats;
@group(0) @binding(9) var<uniform> med: Medium;
@group(0) @binding(10) var<uniform> src: Sources;
@group(0) @binding(11) var<storage, read> beats: array<CellBeat>;

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let j = id.x;
  if (j >= S.count) { return; }
  var c = sorted[j];
  let i = beats[j].idx;              // the cell's own slot in `cells` (sortIdx, carried in its beat)
  var bio = bioPrev[i];
  if ((c.flags & CELL_ALIVE) == 0u) { cells[i] = c; bioNext[i] = bio; return; }

  var f = vec2f(0.0);
  let diff = (S.rules & RULE_DIFF) != 0u;
  let adh = (S.rules & RULE_ADH) != 0u && S.adhesion > 0.0;
  var M = 0.0;              // recognised contact: sum over touching neighbours of (contact x key match)
  var sig = vec4f(0.0);     // committed neighbours' signals per fate channel
  var nParent = 0u;         // touching neighbours seen so far, and the one picked as parent (sorted slot)
  var parent = 0xffffffffu;
  let nutOn = (S.rules & RULE_NUT) != 0u;
  // what this cell feels from the sources (nutrient, threat); its neighbours read it next tick
  bio.env = select(vec4f(0.0), vec4f(feel_sources(S, src, med, c.pos), 0.0, 0.0), nutOn);

  // the loop: the field of the neighbours and the sources, averaged along each membrane segment
  let sensing = S.sense > 0.0;
  let cutR = S.cut * S.R;
  var seg = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let mb = membrane(c);
  let me = beats[j];                         // this cell's own (strained) lattice, for the receptor tuning
  let mk0 = me.k01.xy;
  let mk1 = me.k01.zw;
  let mk2 = me.k2a.xy;
  var C = vec2f(0.0);                        // contact squeeze (traceless tensor: (xx - yy, 2 xy) parts)

  // every neighbour within reach: contact push, and (differentiation on) recognition and signals
  let rg = grid_range(S, grid_xy(S, c.pos));
  for (var gy = rg.y; gy <= rg.w; gy++) {
    for (var gx = rg.x; gx <= rg.z; gx++) {
      let g = grid_index(S, vec2i(gx, gy));
      let s = starts[g];
      let e = s + counts[g];
      for (var k = s; k < e; k++) {
        if (k == j) { continue; }
        let o = sorted[k];
        if ((o.flags & CELL_ALIVE) == 0u) { continue; }
        let d = o.pos - c.pos;
        let R0 = c.r + o.r;
        let d2 = dot(d, d);
        if (sensing && d2 < cutR * cutR) {
          let ob = beats[k];
          if (ob.k2a.z > 0.0) {
            // weight: sign by fates (EMW), receptor tuning by how alike the lattices are, strength, taper
            let tn = tuning(lattice_dist2(mk0, mk1, mk2, ob.k01.xy, ob.k01.zw, ob.k2a.xy), med.k0, S.tuneW);
            let w = emw(c.kind, o.kind) * tn * ob.k2a.z * cut_taper(d2, cutR);
            if (w != 0.0) {
              sense_field(&seg, mb, c.pos - ob.q2p.zw, ob.q01.xy, ob.q01.zw, ob.q2p.xy, ob.ph, ob.k2a.w, w);
            }
          }
        }
        let reach = S.reach * R0;
        if (d2 >= reach * reach) { continue; }
        let dist = sqrt(d2);

        // contact: 1 when touching, fading to 0 at the reach (cells a hair apart still talk)
        let touch = clamp((reach - dist) / (reach - R0 + 1e-3), 0.0, 1.0);
        // SPECIFIC: my receptor against the neighbour's key (its lattice), a Gaussian in the wavevector difference
        let w = bio.rec.x;
        M += touch * exp(-key_dist2(bio.key.z, bio.key.w, o.la, o.aux) / (2.0 * w * w));
        let ob = bioPrev[beats[k].idx];
        // a parent in case this cell dies this tick: one touching neighbour, picked uniformly
        // (reservoir sampling: the n-th candidate replaces the pick with chance 1/n)
        if (dist < R0) {
          nParent++;
          if (rand01(c.seed ^ pcg(S.tick ^ 0x27d4eb2fu), k) * f32(nParent) < 1.0) { parent = k; }
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

        if (dist >= R0 || S.stiffness <= 0.0) { continue; }
        // soft contact push: an overlap spring
        var u: vec2f;
        if (dist > 1e-3) {
          u = d / dist;
        } else {
          // exactly on top of each other: push apart in a direction set by the pair
          let a = TAU * rand01(min(i, beats[k].idx) * 7919u + max(i, beats[k].idx), 17u);
          u = vec2f(cos(a), sin(a)) * select(-1.0, 1.0, i < beats[k].idx);
        }
        f -= u * S.stiffness * (R0 - dist);
        // contact squeezes the cell along the contact axis (passive deformation)
        let ov = (R0 - dist) / R0;
        C -= ov * vec2f(u.x * u.x - u.y * u.y, 2.0 * u.x * u.y);
      }
    }
  }

  var Q = vec2f(0.0);                        // the field's pull on the outline (quadrupole of the membrane signal)
  if (sensing) {
    // the sources' landscape (nutrient, threat), felt the same way; tuning counts for 3/4 (as the reference)
    for (var s = 0u; s < min(S.srcCount, MAX_CELL_SOURCES); s++) {
      let sa = src.s[2u * s];
      let sb = src.s[2u * s + 1u];
      var e: Emitter;
      e.pos = sa.xy; e.la = sa.z; e.amp = sa.w * S.srcAmp; e.r0sq = sb.x;
      e.fa = 1.0; e.fb = 0.0; e.fd = 1.0;
      e.kind = u32(sb.y);
      e._pad = 0u;
      let wk = emw(c.kind, e.kind);
      if (wk == 0.0) { continue; }
      let bt = make_beat(e, med);
      let tn = tuning(lattice_dist2(mk0, mk1, mk2, emitter_k(e, med, 0), emitter_k(e, med, 1), emitter_k(e, med, 2)), med.k0, S.tuneW);
      let o = e.pos - med.centre;
      let ph = vec3f(bt.ph0 + dot(bt.q0, o), bt.ph1 + dot(bt.q1, o), bt.ph2 + dot(bt.q2, o));
      sense_field(&seg, mb, c.pos - e.pos, bt.q0, bt.q1, bt.q2, ph - TAU * floor(ph / TAU), e.r0sq,
                  wk * (0.25 + 0.75 * tn) * e.amp);
    }
    // force = sum of (segment mean x outward normal x length) = area x gradient, then a saturating response
    var cf = vec2f(0.0);
    for (var a = 0; a < 6; a++) {
      let ed = mb.edge[a];
      cf += seg[a] * vec2f(ed.y, -ed.x);
      // the outward normal's direction, doubled: (cos 2 phi, sin 2 phi)
      Q += seg[a] * vec2f(ed.y * ed.y - ed.x * ed.x, -2.0 * ed.x * ed.y) / max(dot(ed, ed), 1e-6);
    }
    cf *= 1.3 * S.R / max(c.r, 0.1);
    let cm = length(cf);
    let sat = S.senseMax * S.R;
    if (cm > 1e-6) { f += cf * (S.sense * sat * tanh(cm / sat) / cm); }
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
  if (S.crawl > 0.0) {
    let g = sqrt(-2.0 * log(max(rand01(c.seed ^ 0x9e3779b9u, S.tick), 1e-7))) * cos(TAU * rand01(c.seed ^ 0x85ebca6bu, S.tick));
    bio.body.w += g * sqrt(2.0 * S.turnRate * S.dt);
    bio.body.w -= TAU * floor(bio.body.w / TAU);
    f += S.crawl * S.R * mot * vec2f(cos(bio.body.w), sin(bio.body.w));
  }
  // viscous, nearly overdamped motion plus Brownian jitter
  c.vel = c.vel * S.damping + f * (1.0 - S.damping);
  let jit = vec2f(rand01(c.seed, S.tick * 2u), rand01(c.seed, S.tick * 2u + 1u)) - 0.5;
  c.pos += c.vel * S.dt + jit * S.jitter * S.R * mot;
  c.pos = clamp(c.pos, vec2f(0.0), vec2f(S.W, S.H));
  c.r += (S.R * size - c.r) * min(1.0, S.dt * 0.8);

  // shape: an area-preserving stretch e = (e1, e2), relaxing toward a target made of the passive contact
  // squeeze and (active, key W) a stretch along the cell's own motion and toward where the field pulls on its
  // outline; muscle stretches along its crawling heading. As the reference's step(); length capped at 0.5.
  var t = 0.5 * C;
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
  var e = vec2f(c.e1, c.e2);
  e += (t - e) * min(1.0, S.dt * S.shapeRate);
  let em = length(e);
  if (em > 0.5) { e *= 0.5 / em; }
  c.e1 = e.x;
  c.e2 = e.y;

  // turnover: now and then a cell dies and a touching neighbour divides into its place, the daughter a copy
  // of the parent's genome (from last tick's buffer, so it does not matter whether the parent changes or dies
  // this tick) with small mutations. Cells that recognise none of their neighbours die sooner.
  // Nutrient and threat (rule E): a cell in a threat's field dies sooner, and the gap it leaves is not
  // refilled from next door: its replacement, like a share nutFar of all births, is born next to a
  // well-fed cell anywhere in the dish. So tissue drains away from threat and grows into nutrient.
  if ((S.rules & RULE_TURN) != 0u && parent != 0xffffffffu) {
    let threat = S.thrKill * bio.env.y;
    let rate = S.turnover * (1.0 + S.unhappy * (1.0 - min(M, 1.0))) * (1.0 + threat);
    if (rand01(c.seed ^ 0x165667b1u, S.tick) < rate * S.dt) {
      let bs = pcg(c.seed ^ pcg(S.tick * 0x9e3779b9u + i));    // this birth's random stream
      if (nutOn && S.srcCount > 0u && rand01(bs, 300u) < S.nutFar + (1.0 - S.nutFar) * threat / (1.0 + threat)) {
        // a far parent: random cells, each accepted with a chance growing with the nutrient it feels
        // (rejection sampling, up to 16 tries); if none is accepted, the last fed one tried (after a threat
        // death, the last one tried at all), else the local parent stays
        for (var t = 0u; t < 16u; t++) {
          let k = min(u32(rand01(bs, 310u + t) * f32(S.count)), S.count - 1u);
          let nut = bioPrev[beats[k].idx].env.x;
          if ((sorted[k].flags & CELL_ALIVE) == 0u || k == j) { continue; }
          if (threat > 0.05 || nut > 0.01) { parent = k; }
          if (rand01(bs, 330u + t) < nut) { parent = k; break; }
        }
      }
      let pc = sorted[parent];
      let pi = beats[parent].idx;
      var nb = bioPrev[pi];
      if ((S.rules & RULE_MUT) != 0u) { nb = mutate(nb, bs, S.mutSize, S.mutJump); }
      let inherit = (S.rules & RULE_INHERIT) != 0u;
      if (!inherit) { nb.acc = vec4f(0.0); }
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
      c = d;
      bio = nb;
    }
  }

  cells[i] = c;
  bioNext[i] = bio;
}
