// One simulation tick for every cell: contact signalling and fate choice from the genome, adhesion, soft
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
@group(0) @binding(2) var<storage, read> sortIdx: array<u32>;
@group(0) @binding(3) var<storage, read> starts: array<u32>;
@group(0) @binding(4) var<storage, read> counts: array<u32>;
@group(0) @binding(5) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(6) var<storage, read> bioPrev: array<Bio>;
@group(0) @binding(7) var<storage, read_write> bioNext: array<Bio>;
@group(0) @binding(8) var<storage, read_write> stats: Stats;

@compute @workgroup_size(128)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let j = id.x;
  if (j >= S.count) { return; }
  var c = sorted[j];
  let i = sortIdx[j];
  var bio = bioPrev[i];
  if ((c.flags & CELL_ALIVE) == 0u) { cells[i] = c; bioNext[i] = bio; return; }

  var f = vec2f(0.0);
  let diff = (S.rules & RULE_DIFF) != 0u;
  let adh = (S.rules & RULE_ADH) != 0u && S.adhesion > 0.0;
  var M = 0.0;              // recognised contact: sum over touching neighbours of (contact x key match)
  var sig = vec4f(0.0);     // committed neighbours' signals per fate channel

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
        let reach = S.reach * R0;
        if (d2 >= reach * reach) { continue; }
        let dist = sqrt(d2);

        // contact: 1 when touching, fading to 0 at the reach (cells a hair apart still talk)
        let touch = clamp((reach - dist) / (reach - R0 + 1e-3), 0.0, 1.0);
        if (diff || adh) {
          let ob = bioPrev[sortIdx[k]];
          if (diff) {
            // SPECIFIC: my receptor against the neighbour's key (its lattice), a Gaussian in the wavevector difference
            let w = bio.rec.x;
            M += touch * exp(-key_dist2(bio.key.z, bio.key.w, o.la, o.aux) / (2.0 * w * w));
            if (o.kind >= 1u && o.kind <= 4u) { sig[o.kind - 1u] += touch * ob.rec.z; }
          }
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
          let a = TAU * rand01(min(i, sortIdx[k]) * 7919u + max(i, sortIdx[k]), 17u);
          u = vec2f(cos(a), sin(a)) * select(-1.0, 1.0, i < sortIdx[k]);
        }
        f -= u * S.stiffness * (R0 - dist);
      }
    }
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

  cells[i] = c;
  bioNext[i] = bio;
}
