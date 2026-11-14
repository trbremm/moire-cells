// Census for the overlay: cells per fate, per key bin, and which founder lines still have cells.
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
// src/cells.js clears the census part of `stats` just before, and copies `stats` to a read-back buffer after.
// Fate counts are summed in workgroup memory first, so only a few atomics per workgroup hit the buffer.

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;
@group(0) @binding(3) var<storage, read_write> stats: Stats;

var<workgroup> fates: array<atomic<u32>, 8>;

@compute @workgroup_size(256)
fn census(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lid: u32) {
  if (lid < 8u) { atomicStore(&fates[lid], 0u); }
  workgroupBarrier();
  let i = id.x;
  if (i < S.count) {
    let c = cells[i];
    if ((c.flags & CELL_ALIVE) != 0u) {
      atomicAdd(&fates[min(c.kind, 7u)], 1u);
      let a = u32(clamp(fract(c.la / KEY_SPAN) * f32(STATS_ABINS), 0.0, f32(STATS_ABINS) - 1.0));
      let s = u32(clamp((c.aux / KEY_SMAX * 0.5 + 0.5) * f32(STATS_SBINS), 0.0, f32(STATS_SBINS) - 1.0));
      atomicAdd(&stats.bins[s * STATS_ABINS + a], 1u);
      let fid = u32(bio[i].rec.w) % (STATS_FWORDS * 32u);
      atomicOr(&stats.founders[fid / 32u], 1u << (fid % 32u));
    }
  }
  workgroupBarrier();
  if (lid < 8u) {
    let n = atomicLoad(&fates[lid]);
    if (n > 0u) { atomicAdd(&stats.fate[lid], n); }
  }
}
