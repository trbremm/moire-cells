// Step I1, the CELL INSPECTOR's overlay (src/inspect.js), drawn over the finished picture (either look), in one render pass:
//   maskAll  the whole canvas's ALPHA set to the dimming (only the alpha channel is written; the canvas is opaque, its alpha unused)
//   maskFam  a disc round every cell of the shown family: alpha 0 (not dimmed)
//   dim      every pixel x (1 - its alpha): everything but the family darkens; alpha back to 1
//   rings    a thin ring round each one of the family, by its role: the chosen cell white with four ticks (a reticle), its DAUGHTERS
//            bright gold, deeper descendants amber fading with the generations, its MOTHER cyan, her other daughters (its SISTERS) violet
// A cell is shown only while its slot still holds the cell the family list named (the birth id in the inspector's info, read here
// live), so a slot reused since the list was made shows nothing.
// Needs heat_common.wgsl and cell_common.wgsl in front (struct Cell).

struct InspD {
  cam: vec4f,        // xy the pan (dish px), z the zoom, w device px per dish px at zoom 1 (dpr)
  view: vec4f,       // xy the canvas's part of the dish (dish px: its size / zoom), z the dimming (0..1), w the ring scale
  t: vec4f,          // x real time (s, the reticle's slow turn), y 1 = draw the rings only for the chosen cell
};

@group(0) @binding(0) var<uniform> D: InspD;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> info: array<u32>;   // per slot 12 words: 0 the birth id
@group(0) @binding(3) var<storage, read> fam: array<u32>;    // per slot 2 words: the birth id it should hold, role | depth << 8

const ROLE_SELF: u32 = 1u;
const ROLE_DESC: u32 = 2u;
const ROLE_MOM: u32 = 3u;
const ROLE_SIS: u32 = 4u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,              // offset from the cell's centre (dish px)
  @location(1) @interpolate(flat) rr: vec2f,   // x the cell's radius (dish px), y device px per dish px
  @location(2) @interpolate(flat) kind: vec2u, // x role, y depth
};

const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));

fn to_clip(w: vec2f) -> vec4f {
  return vec4f((w.x - D.cam.x) / D.view.x * 2.0 - 1.0, 1.0 - (w.y - D.cam.y) / D.view.y * 2.0, 0.0, 1.0);
}

@vertex
fn vs_full(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[v], 0.0, 1.0);
}

@fragment
fn fs_maskall() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, D.view.z); }
@fragment
fn fs_dim() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }

@vertex
fn vs_cell(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VOut {
  var o: VOut;
  o.pos = vec4f(2.0, 2.0, 0.0, 1.0);   // (off screen: nothing drawn)
  o.local = vec2f(0.0);
  o.rr = vec2f(1.0);
  o.kind = vec2u(0u);
  if (i >= arrayLength(&cells)) { return o; }
  let want = fam[2u * i];
  if (want == 0u || info[i * 12u] != want) { return o; }
  let c = cells[i];
  if ((c.flags & CELL_ALIVE) == 0u) { return o; }
  let rk = fam[2u * i + 1u];
  let role = rk & 255u;
  if (D.t.y > 0.5 && role != ROLE_SELF) { return o; }
  let ppx = D.cam.z * D.cam.w;                 // device px per dish px
  let r = max(c.r, 1.0);
  let ext = 1.7 * r + 10.0 / ppx;              // room for the ring and the reticle's ticks
  let q = QUAD[v] * ext;
  o.pos = to_clip(c.pos + q);
  o.local = q;
  o.rr = vec2f(r, ppx);
  o.kind = vec2u(role, rk >> 8u);
  return o;
}

@fragment
fn fs_mask(f: VOut) -> @location(0) vec4f {
  let d = length(f.local);
  if (d > 1.35 * f.rr.x + 1.0 / f.rr.y) { discard; }
  return vec4f(0.0);
}

// a ring of radius rad and width w (device px), antialiased, at distance d (device px)
fn ring(d: f32, rad: f32, w: f32) -> f32 {
  return clamp(0.5 * w + 0.75 - abs(d - rad), 0.0, 1.0);
}

@fragment
fn fs_ring(f: VOut) -> @location(0) vec4f {
  let ppx = f.rr.y;
  let d = length(f.local) * ppx;               // device px
  let rad = 1.3 * f.rr.x * ppx * D.view.w;
  let role = f.kind.x;
  var col = vec3f(1.0);
  var a = 0.0;
  let s = max(1.0, D.cam.w);                   // (lines a little wider on a dense screen)
  if (role == ROLE_SELF) {
    a = ring(d, rad + 1.5 * s, 2.0 * s);
    // the reticle: four short ticks outside the ring, turning slowly
    let ang = atan2(f.local.y, f.local.x) - 0.25 * D.t.x;
    let k = abs(fract(ang / 1.5707963 + 0.5) - 0.5) * 1.5707963;   // angle to the nearest tick
    let tick = clamp(1.2 * s + 0.5 - k * d, 0.0, 1.0) * step(rad + 4.0 * s, d) * step(d, rad + 9.0 * s);
    a = max(a, tick);
    col = vec3f(1.0, 0.98, 0.94);
  } else if (role == ROLE_DESC) {
    let g = f32(max(f.kind.y, 1u));
    let k = clamp((g - 1.0) / 6.0, 0.0, 1.0);  // daughters (1) bright gold .. 7 generations down and deeper: dim amber
    col = mix(vec3f(1.0, 0.93, 0.35), vec3f(1.0, 0.5, 0.12), k);
    a = ring(d, rad, mix(2.0, 1.2, k) * s) * mix(1.0, 0.6, k);
  } else if (role == ROLE_MOM) {
    col = vec3f(0.35, 0.92, 1.0);
    a = ring(d, rad + 1.0 * s, 2.0 * s);
  } else if (role == ROLE_SIS) {
    col = vec3f(0.78, 0.6, 1.0);
    a = ring(d, rad, 1.5 * s);
  }
  if (a <= 0.0) { discard; }
  return vec4f(col * a, a);
}
