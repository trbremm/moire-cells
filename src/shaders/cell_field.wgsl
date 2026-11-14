// The cells' field, scattered into a texture: every cell adds its own beat x envelope over a quad around it
// (instanced, additive blending into a half-resolution rgba16float texture, channel r). The landscape then reads
// that texture at each halftone dot (landscape_draw.wgsl), so thousands of emitters cost one quad each instead
// of a sum over all cells per pixel.
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
// The beats come from the grid's scatter pass (one per sorted slot; the order does not matter when adding).

struct FieldDraw {
  view: vec2f,      // dish size (CSS px); the texture covers it
  cutR: f32,        // quad half-size = the field's cut-off (CSS px); the field tapers to 0 there
  _pad: f32,
};

@group(0) @binding(0) var<uniform> D: FieldDraw;
@group(0) @binding(1) var<storage, read> beats: array<CellBeat>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec2f,                    // CSS px
  @location(1) @interpolate(flat) id: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                               vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let b = beats[ii];
  let w = b.q2p.zw + corner[vi] * D.cutR;
  var o: VSOut;
  o.pos = vec4f(w.x / D.view.x * 2.0 - 1.0, 1.0 - w.y / D.view.y * 2.0, 0.0, 1.0);
  if (b.k2a.z == 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }   // not emitting: outside the clip volume
  o.world = w;
  o.id = ii;
  return o;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(cell_field(beats[in.id], in.world, D.cutR), 0.0, 0.0, 0.0);
}
