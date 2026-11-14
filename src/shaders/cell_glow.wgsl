// Step C6n: the cells' ACTIVITY for the neon hum (drawing only: it reads the cells and writes its own buffer, which only
// cell_draw.wgsl reads). Needs field_common.wgsl, heat_common.wgsl and cell_common.wgsl in front of it (src/cells.js).
// Activity = how fast a cell's battery changes, either way (burning fuel or a downhill engine fills it; crawling, sparks
// and upkeep empty it), per s of simulation time, smoothed over about `tau` s of real time. A birth (the battery halves
// in the parent, a newborn takes its half) shows as a short flare. While the simulation is paused nothing changes.

struct GlowP {
  n: u32,
  dt: f32,          // simulation time since the last frame (s; 0 = paused: keep)
  keep: f32,        // the smoothing: exp(-real time since the last frame / tau)
  _p: f32,
};

@group(0) @binding(0) var<uniform> G: GlowP;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> glow: array<vec2f>;   // x the battery last frame, y the smoothed change per s

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= G.n) { return; }
  if (G.dt <= 0.0) { return; }
  let bat = cells[i].bat;
  var g = glow[i];
  let rate = abs(bat - g.x) / G.dt;
  g = vec2f(bat, mix(rate, g.y, G.keep));
  glow[i] = g;
}
