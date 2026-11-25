// ===== lod_common.wgsl: step V1, LOD FROM BAND LIMITS (src/lod.js, design/lod_band_limits.md) =====
// The one shared fade every draw shader uses. A feature px device px across, at a limit of `limit` px (pixel 1, grid 3, beat 6,
// host 12): kept 0 below (1 - spread) x limit, 1 above (1 + spread) x limit, smoothly between (so nothing pops while zooming).
// on < 0.5 (?lod=0): always 1, today's drawing exactly.
fn lod_keep(px: f32, limit: f32, spread: f32, on: f32) -> f32 {
  if (on < 0.5) { return 1.0; }
  return smoothstep((1.0 - spread) * limit, (1.0 + spread) * limit, px);
}
// what a pattern of value `detail` (average `tone`) becomes when kept k: the detail itself at k = 1 (exactly: ?lod=0 draws as before)
fn lod_mix(tone: f32, detail: f32, k: f32) -> f32 { return select(mix(tone, detail, k), detail, k >= 1.0); }
