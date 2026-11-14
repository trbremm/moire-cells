// The cells, drawn as instanced quads (6 vertices per cell, instance = cell index, so the order is stable).
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
//
// Look: crisp, flat graphic shapes (no glow): a dark tinted disc with a clean outline, and inside it the
// cell's own hex lattice as small sharp dots, in the faded palette. Edges are anti-aliased over about one
// device pixel and nothing else is soft. Blending is plain "over" (premultiplied alpha), so a cell drawn later
// covers the edge of an earlier one and packed cells read as distinct shapes.
// The disc, outline and dots are drawn in the cell's unstretched frame and mapped through its stretch F,
// so a stretched cell and its lattice stretch together (as in the reference).

struct Draw {
  view: vec2f,      // canvas size in CSS px
  dpr: f32,
  R: f32,           // the cells' target radius (CSS px)
  fill: f32,        // disc fill: fraction of the cell colour (over black)
  fillA: f32,       // disc opacity
  line: f32,        // outline brightness
  lineW: f32,       // outline width (CSS px)
  dots: f32,        // dot brightness (0 = no dots)
  dotR: f32,        // dot radius, as a fraction of the dot spacing
  period: f32,      // dot spacing per unit lattice period, in units of R (0.62 = the medium's period)
  _pad: f32,
};

@group(0) @binding(0) var<uniform> D: Draw;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,                     // position in the cell's unstretched frame (CSS px)
  @location(1) @interpolate(flat) id: u32,
};

// faded palette, as the reference's COL (stem, epithelium, muscle, neuron, cartilage)
fn cell_colour(kind: u32) -> vec3f {
  switch kind {
    case 1u: { return vec3f(121.0, 220.0, 216.0) / 255.0; }
    case 2u: { return vec3f(239.0, 134.0, 184.0) / 255.0; }
    case 3u: { return vec3f(185.0, 162.0, 255.0) / 255.0; }
    case 4u: { return vec3f(240.0, 201.0, 135.0) / 255.0; }
    default: { return vec3f(241.0, 236.0, 223.0) / 255.0; }
  }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var o: VSOut;
  let c = cells[ii];
  // two triangles: corners (-1,-1) (1,-1) (-1,1) / (-1,1) (1,-1) (1,1)
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                               vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let half = c.r + 1.5 / D.dpr;                  // room for the anti-aliased edge
  let l = corner[vi] * half;
  let F = cell_F(c);
  let w = c.pos + vec2f(F.x * l.x + F.y * l.y, F.y * l.x + F.z * l.y);
  o.pos = vec4f(w.x / D.view.x * 2.0 - 1.0, 1.0 - w.y / D.view.y * 2.0, 0.0, 1.0);
  if ((c.flags & CELL_ALIVE) == 0u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }   // outside the clip volume
  o.local = l;
  o.id = ii;
  return o;
}

// coverage of "distance < edge" with a one-pixel anti-aliased step (aa = CSS px per device px)
fn cover(edge: f32, d: f32, aa: f32) -> f32 {
  return clamp((edge - d) / aa + 0.5, 0.0, 1.0);
}

// distance from p to the nearest point of a hex lattice with spacing s, turned by angle a, with a point at 0
fn hex_dist(p: vec2f, s: f32, a: f32) -> f32 {
  let a1 = s * vec2f(cos(a), sin(a));
  let a2 = s * vec2f(cos(a + P3), sin(a + P3));
  // lattice coordinates: p = u a1 + v a2
  let det = a1.x * a2.y - a1.y * a2.x;
  let u = (p.x * a2.y - p.y * a2.x) / det;
  let v = (a1.x * p.y - a1.y * p.x) / det;
  let b = floor(vec2f(u, v));
  var best = 1e9;
  for (var i = 0; i < 4; i++) {
    let q = b + vec2f(f32(i & 1), f32(i >> 1));
    best = min(best, length(p - q.x * a1 - q.y * a2));
  }
  return best;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let c = cells[in.id];
  let d = length(in.local);
  let aa = max(fwidth(d), 0.35 / D.dpr);
  // the cell's own lattice as sharp dots (the reference turns its dot pattern by la + 90 degrees)
  let s = D.period * D.R * kind_period(c.kind);
  let dd = hex_dist(in.local, s, c.la + 1.5707963);
  let aad = max(fwidth(dd), 0.35 / D.dpr);       // derivatives before any discard
  let disc = cover(c.r, d, aa);
  if (disc <= 0.0) { discard; }
  let col = cell_colour(c.kind);

  let lw = min(D.lineW, 0.22 * c.r);              // thinner outline on small cells, so they do not turn solid
  let dot = select(0.0, cover(D.dotR * s, dd, aad) * cover(c.r - lw - 0.12 * D.R, d, aa), D.dots > 0.0);
  let ring = 1.0 - cover(c.r - lw, d, aa);        // clean outline at the rim
  var rgb = mix(col * D.fill, col * D.dots, dot);
  rgb = mix(rgb, col * D.line, ring);
  let a = disc * mix(D.fillA, 1.0, max(ring, dot));
  // rgb is the colour as seen; blend premultiplied (one, one-minus-src-alpha)
  return vec4f(rgb * a, a);
}
