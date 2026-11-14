// Adds this frame's ripple impulses (taps, stirring, and later divisions and deaths) to the wave field.
// Each impulse is a small soft bump: amp * exp(-d^2 / (2 r^2)), d in grid cells.
// One invocation per grid cell, looping over the (short) impulse list, so there are no write races.

struct Impulse {
  pos: vec2f,       // grid coordinates (cells)
  amp: f32,         // height of the bump; negative makes a dip
  radius: f32,      // in grid cells (about 0.8 matches the reference's 5-point bump)
};

struct InjectParams {
  gw: u32,
  gh: u32,
  count: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> P: InjectParams;
@group(0) @binding(1) var<storage, read> impulses: array<Impulse>;
@group(0) @binding(2) var<storage, read_write> field: array<f32>;

@compute @workgroup_size(8, 8)
fn inject(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.gw || id.y >= P.gh) { return; }
  let p = vec2f(f32(id.x), f32(id.y));
  var add = 0.0;
  for (var k = 0u; k < P.count; k++) {
    let imp = impulses[k];
    let d = p - imp.pos;
    let r = max(imp.radius, 0.3);
    let d2 = dot(d, d);
    if (d2 < 16.0 * r * r) {
      add += imp.amp * exp(-d2 / (2.0 * r * r));
    }
  }
  field[id.y * P.gw + id.x] += add;
}
