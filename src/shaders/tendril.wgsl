// ===== tendril.wgsl: step T2, TENDRILS (src/tendrils.js; README "Step T2: tendrils, bone, tendons") =====
// field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended (src/tendrils.js). Runs after the cells' step, before the gene
// network and the eat pass, two dispatches a tick:
//   tforce  each cell's own tendrils (up to 4 slots): SPROUT where the genes say (Bio.tn: the placement and spread round the FRONT), GROW at
//           TP.a.x R/s toward the reach (x the 24th output), only as far as the carbon the cell has built for them (the eat pass's tendril pool,
//           carbon word 23; with carbon off no limit), the TIP GRIPS the first thing it meets: another cell's outline (the grip point kept in that
//           cell's own frame, so it follows its outline as it turns, stretches or contracts), an obstacle (step G0b: where a cell may not go),
//           the dish's edge, or (a full-length tip, with the FLOOR GRIP gene's chance per s) the floor. A gripping tendril is a ROPE: it pulls
//           both ends together when stretched past its rest length (k0 e^stiffness, never pushes), equal and opposite (the same fixed-point
//           counts added to one cell and taken from the other; a rope on the floor or a wall pulls its cell alone), turning each body by its
//           off-centre pull (x TP.b.z), and BREAKS above TP.a.z e^stiffness R/s (it lets go and regrows). RETRACTION (Bio.tk.y x the 25th
//           output, a battery above 2 %) pulls the rest length in at TP.a.w R/s; fully in (TP.b.x R) it lets go and sprouts again (pili's
//           twitching). The forces go into the cell's accumulator (atomic, fixed point)
//   tapply  each cell moves by what was pulled on it this tick (overdamped, as the step's velocity = force: a displacement F dt, at most
//           TP.b.w R; a turn of the body, its front with it); nothing is booked: no velocity changes (as the obstacles' hard limit). A HARD
//           (mineralised) cell's corners lose their wobble (TP.c.y x hardness a tick): its outline is held
// Matter and energy: the tendrils' carbon is the pool's (the eat pass builds it with the C15 recipe, the battery paying the sparks; it goes
// back to the dish with the cell); their upkeep and the retraction's work are the eat pass's (from the battery, as heat).

struct TendP {
  a: vec4f,     // x grow speed (R / s); y the rope's stiffness at gene 0 (1 / s); z its breaking pull at gene 0 (R / s); w the retraction speed (R / s)
  b: vec4f,     // x the shortest rest length (R: fully retracted, it lets go); y the floor grip's rate at gene 1 (per s); z the turning gain (1 =
                // derived, as the glue's: torque over r^2 / 2); w the largest displacement a tick (R)
  c: vec4f,     // x tendril units per R at stiffness 0 (the pool's units, 4 carbons each); y the bone's damping of the corners' wobble at hardness 1
                // (share per tick); z a full mineral wall's rust per R^2 (counts per R^2 of area); w a new sprout's angle wander (rad)
  u: vec4u,     // x TPF_* bits; y the obstacles' signed-distance block in hb (word offset; 0 none); z the counters' first word (n x TW); w the
                // shortest hold before a fully retracted rope lets go (s, f32 bits)
};
@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;
@group(0) @binding(3) var<storage, read_write> tb: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read> starts: array<u32>;
@group(0) @binding(5) var<storage, read> sortIdx: array<u32>;
@group(0) @binding(6) var<storage, read> hbR: array<i32>;
@group(0) @binding(7) var<storage, read> cbR: array<i32>;
@group(0) @binding(8) var<storage, read> stockR: array<i32>;
@group(0) @binding(9) var<uniform> TP: TendP;
@group(0) @binding(10) var<uniform> HP: HeatP;

const TW: u32 = 40u;          // words a cell (src/tendrils.js TW): 0 the owner's seed, 1 its hardness x 65535, 2 3 the pull on it (fixed point),
                              // 4 its turning (fixed point), 5 the summed tension of its ropes x 64, 6 its ropes gripping, 7 spare; 8 + 8 s: slot s
const TSLOT: u32 = 8u;        // a slot's words: 0 state (bits 0..1; bits 8..23 the ticks a rope has held), 1 target / x, 2 target's seed / y, 3 grip angle (rad from its front), 4 grip share of its
                              // rim, 5 length / rest (R), 6 anchor angle (rad from the owner's front), 7 tension (R / s)
const TS_NONE: u32 = 0u;
const TS_GROW: u32 = 1u;
const TS_CELL: u32 = 2u;
const TS_WORLD: u32 = 3u;
const FXF: f32 = 64.0;        // the pull's fixed point (counts per px / s)
const FXW: f32 = 4096.0;      // the turning's (counts per rad / s)
const TPF_ON: u32 = 1u;       // tendrils act
const TPF_POOL: u32 = 2u;     // their length is limited by the carbon built for them (carbon on)
const TPF_OBS: u32 = 4u;      // obstacles: a tip grips their edges
const TPF_EDGE: u32 = 8u;     // ... and the dish's edge
const TPF_MIN: u32 = 16u;     // mineralising acts (the hardness is read; the outline held)
const CB_TEND: u32 = 23u;     // the carbon words' tendril pool (cell_carbon.wgsl)
const CWT: u32 = 24u;         // carbon words a cell
const SWT: u32 = 64u;         // stock words a cell
const W_MINT: u32 = 31u;      // the stock word of the mineral wall (rust Gt, counts)
// counters (cumulative, from TP.u.z): grips on cells, on obstacles / the edge, on the floor, breaks, let go fully retracted, sprouts
const TC_GRIPC: u32 = 0u;
const TC_GRIPW: u32 = 1u;
const TC_GRIPF: u32 = 2u;
const TC_BREAK: u32 = 3u;
const TC_LETGO: u32 = 4u;
const TC_SPROUT: u32 = 5u;

fn u01t(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn ldf(w: u32) -> f32 { return bitcast<f32>(atomicLoad(&tb[w])); }
fn stf(w: u32, v: f32) { atomicStore(&tb[w], bitcast<i32>(v)); }
fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }
fn udir(a: f32) -> vec2f { return vec2f(cos(a), sin(a)); }

/** exp(s E) v for the cell's stretch E = [[e1, e2], [e2, -e1]] (traceless, symmetric): cosh(s m) v + sinh(s m) E v / m. */
fn stretch_mul(e: vec2f, v: vec2f, s: f32) -> vec2f {
  let m = length(e);
  if (m < 1e-6) { return v; }
  let ev = vec2f(e.x * v.x + e.y * v.y, e.y * v.x - e.x * v.y);
  return cosh(s * m) * v + sinh(s * m) * ev / m;
}
/** The cell's outline in direction u (unit), from its centre: the honeycomb's six sides, else the stretched disc. */
fn rim(c: Cell, u: vec2f) -> vec2f {
  if ((c.flags & CELL_HEX) != 0u) {
    let P = hex_corners(c);
    var best = -1.0;
    for (var k = 0u; k < 6u; k++) {
      let a = P[k];
      let d = P[(k + 1u) % 6u] - a;
      let den = cross2(u, d);
      if (abs(den) < 1e-9) { continue; }
      let t = cross2(a, d) / den;
      let s = cross2(a, u) / den;
      if (t > 0.0 && s >= -1e-4 && s <= 1.0001) { best = max(best, t); }
    }
    if (best > 0.0) { return u * best; }
  }
  let w = normalize(stretch_mul(vec2f(c.e1, c.e2), u, -1.0)) * c.r;
  return stretch_mul(vec2f(c.e1, c.e2), w, 1.0);
}
fn wrapA(a: f32) -> f32 { return a - TAU * floor(a / TAU); }
/** The obstacles' signed distance at p (CSS px, < 0 inside; bilinear on the heat grid), or a large number without obstacles. */
fn obs_sd(p: vec2f) -> f32 {
  let o = TP.u.y;
  if ((TP.u.x & TPF_OBS) == 0u || o == 0u) { return 1e9; }
  let g = clamp(p / HP.px - 0.5, vec2f(0.0), vec2f(f32(HP.hw) - 1.001, f32(HP.hh) - 1.001));
  let b = vec2u(floor(g));
  let t = g - vec2f(b);
  let w = HP.hw;
  let i0 = o + b.y * w + b.x;
  let d00 = bitcast<f32>(hbR[i0]);
  let d10 = bitcast<f32>(hbR[i0 + 1u]);
  let d01 = bitcast<f32>(hbR[i0 + w]);
  let d11 = bitcast<f32>(hbR[i0 + w + 1u]);
  return mix(mix(d00, d10, t.x), mix(d01, d11, t.x), t.y);
}
/** A cell's hardness (0..1): its mineral wall over a full one for its size. */
fn hardness(i: u32, r: f32) -> f32 {
  if ((TP.u.x & TPF_MIN) == 0u) { return 0.0; }
  let held = f32(max(stockR[i * SWT + W_MINT], 0));
  let full = TP.c.z * 3.14159265 * r * r / max(S.R * S.R, 1e-6);
  return clamp(held / max(full, 1.0), 0.0, 1.0);
}
fn tcount(k: u32) { atomicAdd(&tb[TP.u.z + k], 1); }
fn pull_on(j: u32, F: vec2f, tq: f32) {
  let q = vec2i(round(F * FXF));
  if (q.x != 0) { atomicAdd(&tb[j * TW + 2u], q.x); }
  if (q.y != 0) { atomicAdd(&tb[j * TW + 3u], q.y); }
  let w = i32(round(tq * FXW));
  if (w != 0) { atomicAdd(&tb[j * TW + 4u], w); }
}
fn clear_slot(o: u32) { for (var w = 0u; w < TSLOT; w++) { atomicStore(&tb[o + w], 0); } }

/** The first cell (not `me`) whose outline holds p, as (index, its seed); (0xffffffff, 0) none. */
fn cell_at(p: vec2f, me: u32) -> vec2u {
  let g = grid_xy(S, p);
  let rg = grid_range(S, g);
  for (var gy = rg.y; gy <= rg.w; gy++) {
    for (var gx = rg.x; gx <= rg.z; gx++) {
      let gi = grid_index(S, vec2i(gx, gy));
      let s = starts[gi];
      let e = starts[gi + 1u];
      for (var k = s; k < e; k++) {
        let j = sortIdx[k];
        if (j == me || j >= S.count) { continue; }
        let cj = cells[j];
        if ((cj.flags & CELL_ALIVE) == 0u) { continue; }
        let v = p - cj.pos;
        let d = length(v);
        if (d > 4.0 * S.R) { continue; }
        if (d < 1e-3 || d < length(rim(cj, v / d))) { return vec2u(j, cj.seed); }
      }
    }
  }
  return vec2u(0xffffffffu, 0u);
}

@compute @workgroup_size(64)
fn tforce(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let o = i * TW;
  let c = cells[i];
  let alive = (c.flags & CELL_ALIVE) != 0u;
  let owner = u32(atomicLoad(&tb[o]));
  if (!alive || owner != c.seed || (c.flags & CELL_BORN) != 0u) {
    // a free slot, or a new cell in it (a birth: a daughter starts without tendrils, her mother keeps hers): forget the old ones
    if (owner != 0u || !alive) {
      for (var w = 5u; w < TW; w++) { atomicStore(&tb[o + w], 0); }
      atomicStore(&tb[o + 1u], 0);
    }
    atomicStore(&tb[o], select(0, bitcast<i32>(c.seed), alive));
    if (!alive) { return; }
  }
  let h = hardness(i, c.r);
  atomicStore(&tb[o + 1u], i32(round(h * 65535.0)));
  let b = bio[i];
  let on = (TP.u.x & TPF_ON) != 0u;
  let want = select(vec2f(0.0), t2_want(b, S.shapeF), on);
  let n = u32(want.x);
  let R = S.R;
  let dt = S.dt;
  let sg = clamp(b.tk.x, -2.0, 2.0);
  let thick = exp(sg);
  let k = min(TP.a.y * thick, 0.4 / max(dt, 1e-4));   // (explicit and stable: both ends move)
  let brk = TP.a.z * thick * R;
  let ret = select(0.0, t2_retract(b, S.shapeF), c.bat > 0.02);
  // the length the carbon built for them allows (all slots together, R)
  var allow = 1e9;
  if ((TP.u.x & TPF_POOL) != 0u) { allow = f32(max(cbR[i * CWT + CB_TEND], 0)) / max(TP.c.x * thick, 1e-6); }
  var used = 0.0;
  for (var s = 0u; s < 4u; s++) {
    let so = o + 8u + TSLOT * s;
    if (atomicLoad(&tb[so]) != 0) { used += max(ldf(so + 5u), 0.0); }
  }
  var tens = 0.0;
  var gripping = 0;
  let rs = pcg(c.seed ^ pcg(S.tick * 0x2c1b3c6du + 0x74656e64u));
  for (var s = 0u; s < 4u; s++) {
    let so = o + 8u + TSLOT * s;
    let raw = u32(atomicLoad(&tb[so]));
    var st = raw & 3u;
    let age = raw >> 8u;   // (ticks a rope has held, saturating)
    if (s >= n) {
      if (st != TS_NONE) { used -= max(ldf(so + 5u), 0.0); clear_slot(so); }
      continue;
    }
    if (st == TS_NONE) {   // a SPROUT: its place round the front (placement + s x spread x a turn / count), wandering a little
      let base = clamp(b.tn.z, -6.3, 6.3) + f32(s) * clamp(b.tn.w, 0.0, 1.0) * TAU / max(want.x, 1.0);
      let wand = TP.c.w * (2.0 * u01t(pcg(rs + 17u * s)) - 1.0);
      clear_slot(so);
      atomicStore(&tb[so], i32(TS_GROW));
      stf(so + 6u, base + wand);
      st = TS_GROW;
      tcount(TC_SPROUT);
    }
    var L = max(ldf(so + 5u), 0.0);
    let ua = udir(c.front + ldf(so + 6u));
    let A = c.pos + rim(c, ua);
    var T = 0.0;
    if (st == TS_GROW) {
      // GROW toward the reach as far as the carbon allows; a longer one (the reach fell) draws back
      let L0 = L;
      let room = max(allow - used, 0.0);
      L = min(want.y, L + min(TP.a.x * dt, room));
      if (L0 > want.y) { L = want.y; }
      used += L - L0;
      let tip = A + ua * (L * R);
      var gripped = false;
      // the TIP grips the first thing it meets: another cell's outline ...
      let hit = cell_at(tip, i);
      if (hit.x != 0xffffffffu) {
        let cj = cells[hit.x];
        let v = tip - cj.pos;
        let d = max(length(v), 1e-3);
        let ang = atan2(v.y, v.x);
        atomicStore(&tb[so], i32(TS_CELL));
        atomicStore(&tb[so + 1u], i32(hit.x));
        atomicStore(&tb[so + 2u], bitcast<i32>(hit.y));
        stf(so + 3u, wrapA(ang - cj.front));
        stf(so + 4u, clamp(d / max(length(rim(cj, v / d)), 1e-3), 0.0, 1.0));
        tcount(TC_GRIPC);
        gripped = true;
      } else {
        // ... an obstacle or the dish's edge ...
        let sd = obs_sd(tip);
        let outE = (TP.u.x & TPF_EDGE) != 0u && (tip.x <= 0.0 || tip.y <= 0.0 || tip.x >= S.W || tip.y >= S.H);
        var floorG = false;
        if (!(sd < 0.0) && !outE && L >= want.y - 1e-4) {
          // ... or, at its full length, the floor (the floor grip gene's chance per s)
          floorG = u01t(pcg(rs + 101u * s + 7u)) < clamp(b.tk.z, 0.0, 1.0) * TP.b.y * dt;
        }
        if (sd < 0.0 || outE || floorG) {
          let p = clamp(tip, vec2f(0.0), vec2f(S.W, S.H));
          atomicStore(&tb[so], i32(TS_WORLD));
          atomicStore(&tb[so + 1u], bitcast<i32>(p.x));
          atomicStore(&tb[so + 2u], bitcast<i32>(p.y));
          tcount(select(TC_GRIPW, TC_GRIPF, floorG));
          gripped = true;
        }
      }
      if (gripped) { L = max(L, 0.02); }
    } else {
      // a ROPE: its far end on a cell (still the same one, alive) or a world point
      var B = vec2f(0.0);
      var j = 0xffffffffu;
      var ok = true;
      if (st == TS_CELL) {
        j = u32(atomicLoad(&tb[so + 1u]));
        if (j >= S.count) { ok = false; }
        else {
          let cj = cells[j];
          if ((cj.flags & CELL_ALIVE) == 0u || cj.seed != u32(atomicLoad(&tb[so + 2u]))) { ok = false; }
          else { B = cj.pos + ldf(so + 4u) * rim(cj, udir(cj.front + ldf(so + 3u))); }
        }
      } else {
        B = vec2f(ldf(so + 1u), ldf(so + 2u));
      }
      if (!ok) {   // what it held is gone: it regrows
        atomicStore(&tb[so], i32(TS_GROW));
        used -= L;
        L = 0.0;
      } else {
        // RETRACTION pulls the rest length in; fully in (and held at least TP.u.w s: a grip is not let go the tick it is made), it lets go
        // and sprouts again
        if (ret > 0.0) {
          let L0 = L;
          L = max(L - TP.a.w * ret * dt, 0.0);
          used += L - L0;
        }
        atomicStore(&tb[so], i32(st | (min(age + 1u, 65535u) << 8u)));
        if (ret > 0.0 && L <= TP.b.x && f32(age) * dt >= bitcast<f32>(TP.u.w)) {
          clear_slot(so);
          used -= L;
          L = 0.0;
          tcount(TC_LETGO);
        } else {
          let dv = B - A;
          let d = length(dv);
          let rest = L * R;
          if (d > rest && d > 1e-4) {
            T = k * (d - rest);
            if (T > brk) {   // it BREAKS: lets go, regrows
              atomicStore(&tb[so], i32(TS_GROW));
              used -= L;
              L = 0.0;
              T = 0.0;
              tcount(TC_BREAK);
            } else {
              let F = T * dv / d;
              pull_on(i, F, TP.b.z * cross2(A - c.pos, F) / max(0.5 * c.r * c.r, 1e-6));
              if (st == TS_CELL) {
                let cj = cells[j];
                pull_on(j, -F, TP.b.z * cross2(B - cj.pos, -F) / max(0.5 * cj.r * cj.r, 1e-6));
              }
              tens += T;
              gripping += 1;
            }
          } else {
            gripping += 1;
          }
        }
      }
    }
    stf(so + 5u, L);
    stf(so + 7u, T / max(R, 1e-6));
  }
  atomicStore(&tb[o + 5u], i32(round(tens / max(R, 1e-6) * 64.0)));
  atomicStore(&tb[o + 6u], gripping);
}

@compute @workgroup_size(64)
fn tapply(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let o = i * TW;
  let fx = atomicExchange(&tb[o + 2u], 0);
  let fy = atomicExchange(&tb[o + 3u], 0);
  let fw = atomicExchange(&tb[o + 4u], 0);
  let c = cells[i];
  if ((c.flags & CELL_ALIVE) == 0u) { return; }
  if (fx != 0 || fy != 0) {
    var dp = vec2f(f32(fx), f32(fy)) / FXF * S.dt;
    let lim = TP.b.w * S.R;
    let m = length(dp);
    if (m > lim) { dp *= lim / m; }
    cells[i].pos = clamp(c.pos + dp, vec2f(0.0), vec2f(S.W, S.H));
  }
  if (fw != 0) {
    let dth = clamp(f32(fw) / FXW * S.dt, -0.2, 0.2);
    cells[i].theta = wrapA(c.theta + dth);
    cells[i].front = wrapA(c.front + dth);
  }
  // a HARD cell's outline is held: its corners' wobble damped
  let h = f32(atomicLoad(&tb[o + 1u])) / 65535.0;
  if (h > 0.0 && TP.c.y > 0.0) {
    var rv = c.radV;
    let kd = clamp(1.0 - TP.c.y * h, 0.0, 1.0);
    for (var k = 0; k < 6; k++) { rv[k] *= kd; }
    cells[i].radV = rv;
  }
}
