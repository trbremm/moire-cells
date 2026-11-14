// Per-emitter prep, once per frame: the beat wavevectors and phases of every emitter against the medium.
// Needs field_common.wgsl in front of it (src/field.js does that).
// One invocation per emitter; the draw shader (and later the cells' sensing) reads the result.

struct PrepParams {
  count: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> P: PrepParams;
@group(0) @binding(2) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(3) var<storage, read_write> beats: array<Beat>;

@compute @workgroup_size(64)
fn prep(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.count) { return; }
  beats[id.x] = make_beat(emitters[id.x], medium);
}
