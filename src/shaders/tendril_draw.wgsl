// ===== tendril_draw.wgsl: step T2, the TENDRILS and the BONE drawn (src/tendrils.js; README "Step T2: tendrils, bone, tendons") =====
// field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended. Two instanced draws (instance = cell):
//   vs / fs        before the cells (a body covers a tendril's root): each of its 4 slots a thin ribbon of NS segments. A FREE tendril curls a
//                  little as it reaches out (its own phase); a ROPE runs from its anchor to its grip, straight while taut (brighter with its
//                  tension), sagging while slack (a catenary-ish arc by its spare length); the grip a small bright dot at the far end
//   vsb / fsb      after the cells: a HARD (mineralised) cell's lamellae, concentric rings inside its outline round a small dark canal (as
//                  bone's osteons), as faint as it is hard
// Neon: a white-hot core and a tight halo in the cell's job ink (a tendril is a part of it: colour means function), the bone pale ivory;
// harmonic: the tendrils as collagen-like ORANGE SHG fibres (brighter where pulled taut), the bone's lamellae orange too, its canal dark.

struct TendDraw {
  view: vec2f,       // the dish's part on screen (CSS px of the dish)
  dpr: f32,          // device px per dish px (x the zoom)
  R: f32,            // the cells' radius (CSS px)
  cam: vec4f,        // the view camera (xy pan)
  look: vec4f,       // x 1 neon, 2 harmonic; y the time (s); z the tube's width (CSS px); w brightness
  geo: vec4f,        // x NS (segments per tendril); y the grip dot's radius (x the tube); z the bone's brightness; w the tension at full glow (R / s)
  orange: vec4f,     // the harmonic look's fibre ink (rgb), w its yellow mix where taut
  bone: vec4f,       // the neon look's bone ink (rgb), w the lamellae's spacing (x r)
  job: array<vec4f, 7>,   // the jobs' inks (rgb)
};
@group(0) @binding(0) var<uniform> TD: TendDraw;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;
@group(0) @binding(3) var<storage, read> tw: array<u32>;

const TWD: u32 = 40u;
struct TOut {
  @builtin(position) pos: vec4f,
  @location(0) v: f32,                          // across, -1..1
  @location(1) @interpolate(flat) ink: vec4f,   // rgb, a: brightness
  @location(2) s: f32,                          // along, 0 root .. 1 tip (2: a grip dot, its local coordinates in v and q)
  @location(3) q: vec2f,                        // the dot's local coordinates; the bone's: position over r in the cell's own frame
};
fn off_clip() -> TOut {
  var o: TOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.v = 0.0; o.ink = vec4f(0.0); o.s = 0.0; o.q = vec2f(0.0);
  return o;
}
fn clip_of(w: vec2f) -> vec4f {
  return vec4f((w.x - TD.cam.x) / TD.view.x * 2.0 - 1.0, 1.0 - (w.y - TD.cam.y) / TD.view.y * 2.0, 0.0, 1.0);
}
fn tf(w: u32) -> f32 { return bitcast<f32>(tw[w]); }
fn cross2d(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }
fn stretch_m(e: vec2f, v: vec2f, s: f32) -> vec2f {
  let m = length(e);
  if (m < 1e-6) { return v; }
  let ev = vec2f(e.x * v.x + e.y * v.y, e.y * v.x - e.x * v.y);
  return cosh(s * m) * v + sinh(s * m) * ev / m;
}
fn rim_d(c: Cell, u: vec2f) -> vec2f {
  if ((c.flags & CELL_HEX) != 0u) {
    let P = hex_corners(c);
    var best = -1.0;
    for (var k = 0u; k < 6u; k++) {
      let a = P[k];
      let d = P[(k + 1u) % 6u] - a;
      let den = cross2d(u, d);
      if (abs(den) < 1e-9) { continue; }
      let t = cross2d(a, d) / den;
      let s = cross2d(a, u) / den;
      if (t > 0.0 && s >= -1e-4 && s <= 1.0001) { best = max(best, t); }
    }
    if (best > 0.0) { return u * best; }
  }
  let w = normalize(stretch_m(vec2f(c.e1, c.e2), u, -1.0)) * c.r;
  return stretch_m(vec2f(c.e1, c.e2), w, 1.0);
}
fn ink_of(i: u32) -> vec3f {
  let j = job_of(bio[i]);
  return mix(TD.job[0].rgb, TD.job[min(u32(j.x), 6u)].rgb, clamp(j.y, 0.0, 1.0));
}

// a slot's centre line at s (0..1): its root A, its end B (the tip, or the grip), the sag (CSS px, + to the left of A -> B), the curl's phase
fn line_at(A: vec2f, B: vec2f, sag: f32, curl: f32, ph: f32, s: f32) -> vec2f {
  let d = B - A;
  let L = length(d);
  let n = select(vec2f(0.0), vec2f(-d.y, d.x) / L, L > 1e-4);
  let bend = sag * sin(3.14159265 * s) + curl * L * sin(4.0 * s + ph) * s;
  return A + d * s + n * bend;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TOut {
  let c = cells[ii];
  if ((c.flags & CELL_ALIVE) == 0u) { return off_clip(); }
  let o = ii * TWD;
  if (tw[o] != c.seed) { return off_clip(); }
  let NS = u32(TD.geo.x);
  let perSlot = NS * 6u + 6u;
  let slot = vi / perSlot;
  if (slot >= 4u) { return off_clip(); }
  let so = o + 8u + 8u * slot;
  let st = tw[so] & 3u;
  if (st == 0u) { return off_clip(); }
  let L = tf(so + 5u);
  let u = vec2f(cos(c.front + tf(so + 6u)), sin(c.front + tf(so + 6u)));
  let A = c.pos + rim_d(c, u);
  var B = A + u * (L * TD.R);
  var sag = 0.0;
  var curl = 0.0;
  var grip = false;
  let T = max(tf(so + 7u), 0.0);
  if (st == 2u) {
    let j = tw[so + 1u];
    if (j >= arrayLength(&cells)) { return off_clip(); }
    let cj = cells[j];
    B = cj.pos + tf(so + 4u) * rim_d(cj, vec2f(cos(cj.front + tf(so + 3u)), sin(cj.front + tf(so + 3u))));
    grip = true;
  } else if (st == 3u) {
    B = vec2f(tf(so + 1u), tf(so + 2u));
    grip = true;
  } else {
    curl = 0.12;
  }
  if (grip) {
    let d = length(B - A);
    let rest = L * TD.R;
    if (rest > d) { sag = 0.5 * sqrt(rest * rest - d * d) * select(-1.0, 1.0, (slot & 1u) == 0u); }
  }
  if (length(B - A) < 0.05 * TD.R && !grip) { return off_clip(); }
  let ph = f32(c.seed & 1023u) * 0.0061 + f32(slot) * 1.7 + 0.6 * TD.look.y;
  let taut = clamp(T / max(TD.geo.w, 1e-3), 0.0, 1.0);
  let br = TD.look.w * select(0.55, 0.7 + 0.3 * taut, grip);
  let ink = ink_of(ii);
  let q = vi % 6u;
  var qa = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  var qv = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  var out: TOut;
  let k = vi % perSlot;
  if (k >= NS * 6u) {
    // the grip's dot
    if (!grip) { return off_clip(); }
    let rr = TD.look.z * TD.geo.y;
    let lc = vec2f(qa[q] * 2.0 - 1.0, qv[q]);
    out.pos = clip_of(B + lc * rr);
    out.v = 0.0; out.s = 2.0; out.q = lc;
    out.ink = vec4f(ink, br * (0.8 + 0.2 * taut));
    return out;
  }
  let seg = k / 6u;
  let s0 = f32(seg) / f32(NS);
  let s1 = f32(seg + 1u) / f32(NS);
  let a0 = line_at(A, B, sag, curl, ph, s0);
  let a1 = line_at(A, B, sag, curl, ph, s1);
  let sAt = select(s0, s1, qa[q] > 0.5);
  let pt = select(a0, a1, qa[q] > 0.5);
  let dv = a1 - a0;
  let nrm = vec2f(-dv.y, dv.x) / max(length(dv), 1e-4);
  let w = TD.look.z * select(mix(1.0, 0.5, sAt), 1.0, grip) * (0.8 + 0.25 * clamp(bio[ii].tk.x * 0.25 + 0.5, 0.0, 1.0));
  out.pos = clip_of(pt + nrm * (qv[q] * w));
  out.v = qv[q];
  out.s = select(sAt, 0.5 * sAt, grip);   // (a rope does not fade toward its end)
  out.q = vec2f(taut, 0.0);
  out.ink = vec4f(ink, br);
  return out;
}

@fragment
fn fs(in: TOut) -> @location(0) vec4f {
  if (in.s > 1.5) {
    // the grip's dot: a bright point (neon: white-hot with a halo; harmonic: a yellow-orange knot)
    let r = length(in.q);
    if (r > 1.0) { discard; }
    if (TD.look.x > 1.5) {
      let a = (1.0 - smoothstep(0.3, 1.0, r)) * in.ink.a * 0.9;
      return vec4f(mix(TD.orange.rgb, vec3f(1.0, 0.85, 0.35), 0.6) * a, a);
    }
    let core = 1.0 - smoothstep(0.0, 0.45, r);
    let halo = exp(-3.0 * r * r) * (1.0 - smoothstep(0.8, 1.0, r));
    let col = mix(in.ink.rgb * halo, vec3f(1.0, 0.98, 0.94), core);
    let a = clamp(max(halo * 0.9, core), 0.0, 1.0) * in.ink.a;
    return vec4f(col * a, a);
  }
  let v = abs(in.v);
  let fade = 1.0 - smoothstep(0.7, 1.0, in.s) * 0.65;
  if (TD.look.x > 1.5) {
    // harmonic: a collagen-like ORANGE fibre (SHG-bright: ordered), yellower and brighter where pulled taut
    let taut = in.q.x;
    let a = (1.0 - smoothstep(0.3, 1.0, v)) * in.ink.a * fade * (0.6 + 0.4 * taut);
    let col = mix(TD.orange.rgb, vec3f(1.0, 0.84, 0.3), TD.orange.w * taut);
    return vec4f(col * a, a);
  }
  let core = 1.0 - smoothstep(0.0, 0.35, v);
  let halo = exp(-4.0 * v * v) * (1.0 - smoothstep(0.85, 1.0, v));
  let col = mix(in.ink.rgb * halo, vec3f(1.0, 0.97, 0.92), 0.7 * core);
  let a = clamp(max(halo * 0.85, core), 0.0, 1.0) * in.ink.a * fade;
  return vec4f(col * a, a);
}

// ---- the BONE: a hard cell's lamellae (after the cells) ----
@vertex
fn vsb(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TOut {
  let c = cells[ii];
  if ((c.flags & CELL_ALIVE) == 0u) { return off_clip(); }
  let o = ii * TWD;
  if (tw[o] != c.seed) { return off_clip(); }
  let h = f32(tw[o + 1u]) / 65535.0;
  if (h < 0.03) { return off_clip(); }
  let q = vi % 6u;
  var qx = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);
  var qy = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let ext = 1.25 * c.r * exp(length(vec2f(c.e1, c.e2)));
  let lc = vec2f(qx[q], qy[q]) * ext;
  var out: TOut;
  out.pos = clip_of(c.pos + lc);
  // its own frame: the stretch undone, over r (so the rings follow the outline's ellipse)
  out.q = stretch_m(vec2f(c.e1, c.e2), lc, -1.0) / max(c.r, 1e-3);
  out.v = h;
  out.s = f32(c.seed & 255u) / 255.0;
  out.ink = vec4f(TD.bone.rgb, TD.geo.z);
  return out;
}

@fragment
fn fsb(in: TOut) -> @location(0) vec4f {
  let r = length(in.q);
  if (r > 0.82) { discard; }
  let h = in.v;
  // lamellae: rings at bone.w x r round a small dark canal; a little irregular (the cell's own phase), fading toward the rim
  let sp = max(TD.bone.w, 0.05);
  let ang = atan2(in.q.y, in.q.x);
  let wob = 0.025 * sin(3.0 * ang + 6.28 * in.s) + 0.015 * sin(7.0 * ang);
  let x = (r + wob) / sp;
  let ring = pow(0.5 + 0.5 * cos(6.2831853 * x), 6.0);
  let canal = 1.0 - smoothstep(0.08, 0.14, r);
  let edge = 1.0 - smoothstep(0.62, 0.82, r);
  var a = ring * edge * (1.0 - canal) * h * in.ink.a;
  if (TD.look.x > 1.5) {
    // harmonic: the bone's collagen lamellae, orange SHG
    a *= 0.85;
    return vec4f(TD.orange.rgb * a, a);
  }
  a *= 0.7;
  return vec4f(in.ink.rgb * a, a);
}
