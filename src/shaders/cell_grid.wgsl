// The neighbour grid, rebuilt every tick: a counting sort of the cells by grid cell.
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
//
// Passes, in order (counts is cleared to 0 before):
//   count       one invocation per cell: its grid cell g, and its rank among the cells in g (atomicAdd)
//   scan_local  exclusive prefix sum of counts within blocks of 512 grid cells; block totals to blockSums
//   scan_top    one workgroup: exclusive prefix sum of blockSums, in chunks of 512 with a running carry
//   scan_add    adds each block's offset: starts[g] = first slot of grid cell g in the sorted list
//   scatter     one invocation per cell: copies it to sorted[starts[g] + rank] (step C6d: with its dipole, from its side
//               charges), and its index to sortIdx; also works out the cell's beats against the medium (cell_beat: field
//               A and field B) into beats[the same slot]
// After this, the cells of grid cell g are sorted[starts[g] .. starts[g] + counts[g]), with their beats.
// Step C9: a dead slot (no CELL_ALIVE) goes into one more bucket, gw gh, after the last grid cell, so the scans run over
// gw gh + 1 buckets: starts[gw gh] is the number of live cells (the end of the last grid cell), and the dead slots sit at the
// end of the sorted list, where their beats carry only their index (idx) and no strength: the list of free slots.
// Only core WebGPU: storage-buffer atomics and workgroup memory (256 invocations, 1 KiB of workgroup memory).

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cellGrid: array<vec2u>;   // per cell: grid cell, rank in it
@group(0) @binding(6) var<storage, read_write> sorted: array<CellCore>;
@group(0) @binding(7) var<storage, read_write> sortIdx: array<u32>;
@group(0) @binding(8) var<uniform> med: Medium;
@group(0) @binding(9) var<storage, read_write> beats: array<CellBeat>;
@group(0) @binding(10) var<uniform> FL: Fields;

const WG: u32 = 256u;
const BLOCK: u32 = 512u;   // two elements per invocation

var<workgroup> sh: array<u32, 256>;
var<workgroup> carry: u32;

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let c = cells[i];
  let g = select(S.gw * S.gh, grid_index(S, grid_xy(S, c.pos)), (c.flags & CELL_ALIVE) != 0u);
  let rank = atomicAdd(&counts[g], 1u);
  cellGrid[i] = vec2u(g, rank);
}

// inclusive scan of sh[0..256) (Hillis-Steele); every invocation of the workgroup must call it
fn scan_shared(lid: u32) {
  for (var off = 1u; off < WG; off <<= 1u) {
    var v = sh[lid];
    if (lid >= off) { v += sh[lid - off]; }
    workgroupBarrier();
    sh[lid] = v;
    workgroupBarrier();
  }
}

@compute @workgroup_size(256)
fn scan_local(@builtin(local_invocation_id) lid3: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let lid = lid3.x;
  let n = S.gw * S.gh + 1u;          // (step C9: + the dead slots' bucket)
  let base = wid.x * BLOCK + 2u * lid;
  var a = 0u;
  var b = 0u;
  if (base < n) { a = atomicLoad(&counts[base]); }
  if (base + 1u < n) { b = atomicLoad(&counts[base + 1u]); }
  sh[lid] = a + b;
  workgroupBarrier();
  scan_shared(lid);
  let incl = sh[lid];
  let excl = incl - a - b;
  if (base < n) { starts[base] = excl; }
  if (base + 1u < n) { starts[base + 1u] = excl + a; }
  if (lid == WG - 1u) { blockSums[wid.x] = incl; }
}

@compute @workgroup_size(256)
fn scan_top(@builtin(local_invocation_id) lid3: vec3u) {
  let lid = lid3.x;
  let nb = (S.gw * S.gh + 1u + BLOCK - 1u) / BLOCK;
  if (lid == 0u) { carry = 0u; }
  workgroupBarrier();
  let chunks = (nb + BLOCK - 1u) / BLOCK;
  for (var ch = 0u; ch < chunks; ch++) {
    let base = ch * BLOCK + 2u * lid;
    var a = 0u;
    var b = 0u;
    if (base < nb) { a = blockSums[base]; }
    if (base + 1u < nb) { b = blockSums[base + 1u]; }
    sh[lid] = a + b;
    workgroupBarrier();
    scan_shared(lid);
    let incl = sh[lid];
    let c0 = carry;
    workgroupBarrier();                  // everyone has read carry before it changes
    let excl = c0 + incl - a - b;
    if (base < nb) { blockSums[base] = excl; }
    if (base + 1u < nb) { blockSums[base + 1u] = excl + a; }
    if (lid == WG - 1u) { carry = c0 + incl; }
    workgroupBarrier();
  }
}

@compute @workgroup_size(256)
fn scan_add(@builtin(global_invocation_id) id: vec3u) {
  let g = id.x;
  if (g > S.gw * S.gh) { return; }   // (step C9: the dead slots' bucket too)
  starts[g] += blockSums[g / BLOCK];
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= S.count) { return; }
  let gr = cellGrid[i];
  let dst = starts[gr.x] + gr.y;
  let c = cells[i];
  // step C9: a dead slot: only its index, in the free list at the end (no strength, so nothing draws or feels it)
  if ((c.flags & CELL_ALIVE) == 0u) {
    var b: CellBeat;
    b.idx = i;
    beats[dst] = b;
    sortIdx[dst] = i;
    return;
  }
  // step C6d: the cell's saturated dipole from its side charges, for its neighbours (the lean copy has no side slots)
  var dip = vec2f(0.0);
  if ((bitcast<u32>(FL.dip0.x) & DP_ON) != 0u && (c.flags & CELL_ALIVE) != 0u) { dip = dip_sat(cell_dipole_raw(c, membrane(c)), FL.dip0.y); }
  sorted[dst] = cell_core(c, dip);
  sortIdx[dst] = i;
  var b = cell_beat(c, S, med, FL);
  b.idx = i;
  beats[dst] = b;
}
