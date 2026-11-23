// ===== motor_draw.wgsl: step S2, the MOTORS drawn as parts (src/motors.js; README "Step S2: flagella and cilia") =====
// field_common.wgsl, heat_common.wgsl and cell_common.wgsl are prepended (src/motors.js). One instanced draw per frame, before the cells
// (so a cell's body covers its flagellum's root): instance = cell, its vertices thin ribbons in a fixed layout, collapsed outside the clip
// volume where a cell has no such motor (Cell.motW: what its motors did this tick, written by the step):
//   FLAGELLUM  a PUSHER (sign gene > 0): one long filament trailing from its back pole; a PULLER (< 0): two shorter ones from its front pole,
//              swept back a little either side (as an alga's pair). Each a strip of NS segments along which a SINE WAVE travels from the
//              root to the tip (its beat; the wave's speed and its amplitude by the thrust as acted)
//   CILIA      HPS short hairs on each FREE side (bits 16..21 of Cell.motW), each swinging round its root at the cell's beat phase (Bio.mc.z;
//              a hair's power stroke leans along the stroke, the recovery back), so coupled neighbours' hairs move in travelling waves
// Neon look: each ribbon a thin tube, a white-hot core and a tight halo in the cell's job ink (its motor is part of it: colour means
// function), cilia fainter; the harmonic look: thin faint green filaments (THG-like interfaces), no white core.

struct MotorDraw {
  view: vec2f,       // the dish's part on screen (CSS px of the dish), as Draw.view
  dpr: f32,          // device px per dish px (x the zoom)
  R: f32,            // the cells' radius (CSS px)
  cam: vec4f,        // the view camera (xy pan)
  look: vec4f,       // x 1 = neon, 2 = harmonic; y the time (s, simulated: the flagella's waves); z the tube's width (CSS px); w brightness
  geo: vec4f,        // x NS (segments per flagellum), y HPS (hairs per side), z a flagellum's length at thrust 1 (R), w a hair's length (R)
  wave: vec4f,       // x the flagellum wave's amplitude (R), y its wavelengths along the filament, z its beats per s at thrust 1, w the hairs'
                     // swing (rad)
  ink: vec4f,        // the harmonic look's ink (rgb), w the cilia's brightness (share of a flagellum's)
  job: array<vec4f, 7>,   // the jobs' inks (rgb), as Draw.job
};
@group(0) @binding(0) var<uniform> MD: MotorDraw;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;

struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) v: f32,                          // across the ribbon, -1..1
  @location(1) @interpolate(flat) ink: vec4f,   // rgb, a: brightness
  @location(2) s: f32,                          // along it, 0 root .. 1 tip
};

fn off_clip() -> MOut {
  var o: MOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.v = 0.0;
  o.ink = vec4f(0.0);
  o.s = 0.0;
  return o;
}

// a point (dish CSS px) on screen
fn clip_of(w: vec2f) -> vec4f {
  return vec4f((w.x - MD.cam.x) / MD.view.x * 2.0 - 1.0, 1.0 - (w.y - MD.cam.y) / MD.view.y * 2.0, 0.0, 1.0);
}

// a flagellum's centre line at s (0..1) and its direction there: from root p0 along u, length L, a travelling wave of amplitude A
fn flag_at(p0: vec2f, u: vec2f, L: f32, A: f32, k: f32, ph: f32, s: f32) -> vec2f {
  let n = vec2f(-u.y, u.x);
  let env = smoothstep(0.0, 0.35, s);           // (the root held still, the wave grows toward the tip)
  return p0 + u * (L * s) + n * (A * env * sin(k * s - ph));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MOut {
  let c = cells[ii];
  if ((c.flags & CELL_ALIVE) == 0u || c.motW == 0u) { return off_clip(); }
  let NS = u32(MD.geo.x);
  let HPS = u32(MD.geo.y);
  let nFl = 2u * NS * 6u;                       // two filaments' vertices
  let q = vi % 6u;                              // the quad's corner: (0, -), (1, -), (0, +) / (0, +), (1, -), (1, +)
  var qa = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  var qv = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let along = qa[q];
  let across = qv[q];
  let b = bio[ii];
  let j = job_of(b);
  let ink = mix(MD.job[0].rgb, MD.job[min(u32(j.x), 6u)].rgb, clamp(j.y, 0.0, 1.0));
  let ef = vec2f(cos(c.front), sin(c.front));
  // the cell's extent along its front (its pole): the outline's farthest corner along it, else the radius
  var pole = c.r;
  var poleB = c.r;
  if ((c.flags & CELL_HEX) != 0u) {
    var P = hex_corners(c);
    pole = 0.0;
    poleB = 0.0;
    for (var k = 0; k < 6; k++) { pole = max(pole, dot(P[k], ef)); poleB = max(poleB, -dot(P[k], ef)); }
  }
  let tw = MD.look.z;
  var o: MOut;
  if (vi < nFl) {
    // ---- the flagellum ----
    let fa = mot_flag(c.motW);
    if (fa <= 0.0) { return off_clip(); }
    let strand = vi / (NS * 6u);
    let seg = (vi / 6u) % NS;
    let push = b.mo.y >= 0.0;
    if (push && strand == 1u) { return off_clip(); }
    let L = MD.R * MD.geo.z * (0.55 + 0.45 * fa) * select(0.62, 1.0, push);
    var u = -ef;
    var p0 = c.pos - ef * (0.85 * poleB);
    if (!push) {
      let sw = select(-0.45, 0.45, strand == 1u);    // the pair, swept back either side of the front
      let fw = ef * cos(sw) + vec2f(-ef.y, ef.x) * sin(sw);
      u = fw;
      p0 = c.pos + ef * (0.85 * pole);
    }
    let ph = TAU * MD.wave.z * (0.4 + 0.6 * fa) * MD.look.y + f32(c.seed & 1023u) * 0.0061 + select(0.0, 3.14159265, strand == 1u);
    let A = MD.R * MD.wave.x * (0.5 + 0.5 * fa);
    let k = TAU * MD.wave.y;
    let s0 = f32(seg) / f32(NS);
    let s1 = f32(seg + 1u) / f32(NS);
    let a0 = flag_at(p0, u, L, A, k, ph, s0);
    let a1 = flag_at(p0, u, L, A, k, ph, s1);
    let sAt = select(s0, s1, along > 0.5);
    let pt = select(a0, a1, along > 0.5);
    let dv = a1 - a0;
    let nrm = vec2f(-dv.y, dv.x) / max(length(dv), 1e-4);
    let w = tw * mix(1.0, 0.45, sAt);                 // (the filament tapers toward its tip)
    o.pos = clip_of(pt + nrm * (across * w));
    o.v = across;
    o.s = sAt;
    o.ink = vec4f(ink, MD.look.w * (0.55 + 0.45 * fa));
    return o;
  }
  // ---- the cilia: HPS hairs on each free side ----
  let ca = mot_cil(c.motW);
  let free = mot_free(c.motW);
  if (ca <= 0.0 || free == 0u) { return off_clip(); }
  let hi = (vi - nFl) / 6u;
  let side = hi / max(HPS, 1u);
  let hk = hi % max(HPS, 1u);
  if (side >= 6u || ((free >> side) & 1u) == 0u) { return off_clip(); }
  var mb = membrane(c);
  let mk = mb.mid[side];
  let ek = mb.edge[side];
  let tpos = (f32(hk) + 0.5) / f32(max(HPS, 1u)) - 0.5;      // where along the side (-0.5..0.5)
  let root = c.pos + mk + ek * (0.8 * tpos);
  let nOut = normalize(vec2f(ek.y, -ek.x));
  // the hair leans along the stroke on its power stroke, back on its recovery: its swing by the beat's phase (a little later along the
  // side, so the hairs of one cell ripple too)
  let stroke = -ef;
  let tg = vec2f(-nOut.y, nOut.x);
  let lean = sign(dot(stroke, tg) + 1e-4);
  let ph = b.mc.z - 0.6 * tpos;
  let ang = MD.wave.w * lean * sin(ph) * (0.4 + 0.6 * ca);
  let hd = nOut * cos(ang) + tg * sin(ang);
  let hl = MD.R * MD.geo.w * (0.6 + 0.4 * ca);
  let tip = root + hd * hl;
  let pt = select(root, tip, along > 0.5);
  let nrm = vec2f(-hd.y, hd.x);
  o.pos = clip_of(pt + nrm * (across * 0.6 * tw));
  o.v = across;
  o.s = along;
  o.ink = vec4f(ink, MD.look.w * MD.ink.w * (0.5 + 0.5 * ca));
  return o;
}

@fragment
fn fs(in: MOut) -> @location(0) vec4f {
  let v = abs(in.v);
  let fade = 1.0 - smoothstep(0.75, 1.0, in.s) * 0.6;   // (the tip fades)
  if (MD.look.x > 1.5) {
    // harmonic: a faint thin green filament (an interface, THG-like), no white core
    let a = (1.0 - smoothstep(0.35, 1.0, v)) * in.ink.a * fade * 0.8;
    return vec4f(MD.ink.rgb * a, a);
  }
  // neon: a white-hot core line and a tight halo in the cell's ink
  let core = 1.0 - smoothstep(0.0, 0.35, v);
  let halo = exp(-4.0 * v * v) * (1.0 - smoothstep(0.85, 1.0, v));
  let col = mix(in.ink.rgb * halo, vec3f(1.0, 0.97, 0.92), 0.75 * core);
  let a = clamp(max(halo * 0.85, core), 0.0, 1.0) * in.ink.a * fade;
  return vec4f(col * a, a);
}
