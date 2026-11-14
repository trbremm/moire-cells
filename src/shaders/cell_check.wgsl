// Debug check of the neighbour grid (?check=1): for every cell, count its contacts (distance < r_i + r_j)
// twice: by brute force over all cells, and through the grid. They must agree. Also records the deepest
// overlap per cell, to see how much cells overlap at rest. And it checks the sort itself (any count): the cell
// in sorted slot i must lie in a grid cell whose range [starts, starts + counts) holds slot i, and must be a
// true copy of cells[sortIdx[i]].
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
// Runs right after the grid is built, before the cells move, so both see the same positions.

struct CheckParams {
  brute: u32,       // 1 = also count by brute force (O(N^2); only for small counts)
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> counts: array<u32>;
@group(0) @binding(3) var<storage, read> starts: array<u32>;
@group(0) @binding(4) var<storage, read> sorted: array<Cell>;
@group(0) @binding(5) var<storage, read> sortIdx: array<u32>;
@group(0) @binding(6) var<storage, read_write> result: array<vec4u>;   // brute, grid, max overlap (f32 bits), sort ok
@group(0) @binding(7) var<uniform> C: CheckParams;

@compute @workgroup_size(256)
fn check(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let c = cells[i];

  var brute = 0u;
  if (C.brute == 1u) {
    for (var j = 0u; j < S.count; j++) {
      if (j == i) { continue; }
      let o = cells[j];
      let d = o.pos - c.pos;
      let R0 = c.r + o.r;
      if (dot(d, d) < R0 * R0) { brute++; }
    }
  }

  var viaGrid = 0u;
  var maxOv = 0.0;
  let rg = grid_range(S, grid_xy(S, c.pos));
  for (var gy = rg.y; gy <= rg.w; gy++) {
    for (var gx = rg.x; gx <= rg.z; gx++) {
      let g = grid_index(S, vec2i(gx, gy));
      let s = starts[g];
      let e = s + counts[g];
      for (var k = s; k < e; k++) {
        if (sortIdx[k] == i) { continue; }
        let o = sorted[k];
        let d = o.pos - c.pos;
        let R0 = c.r + o.r;
        let d2 = dot(d, d);
        if (d2 < R0 * R0) {
          viaGrid++;
          maxOv = max(maxOv, (R0 - sqrt(d2)) / R0);
        }
      }
    }
  }
  // the sort: slot i of the sorted list
  let so = sorted[i];
  let sg = grid_index(S, grid_xy(S, so.pos));
  let inRange = i >= starts[sg] && i < starts[sg] + counts[sg];
  let src = cells[sortIdx[i]];
  let same = all(src.pos == so.pos) && src.seed == so.seed;
  result[i] = vec4u(brute, viaGrid, bitcast<u32>(maxOv), select(0u, 1u, inRange && same));
}
