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
  mode: f32,        // 0 = colour by fate, 1 = colour by lineage (the key's hue)
  fillC: f32,       // disc fill of committed (non-stem) cells
  lever: f32,       // the lever (Sim.lever): the dots show the lattice the cell emits with
  leakDot: f32,     // step 6: largest radius of the blue centre dot of a leaking cell, as a fraction of r (0 = none)
  leakMin: f32,     // leak level below which no dot is drawn
  blue: vec4f,      // field B's ink (rgb) for the step 6 marks; a = the converted cells' outline (0 = none)
  convFill: f32,    // fill of a converted stem cell, as a fraction of field B's ink
  states: f32,      // step 7: number of states, for the state bar (0 = no bar: exclusion off)
  bar: f32,         // the bar's brightness
  hand: f32,        // step 8, rule b: the phasor's hand (0 = none)
  pInk: vec4f,      // the partner A' ink (rgb)
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

// lineage colour: the key angle (60 degrees of hex symmetry) goes once round the hue circle, so related
// cells (close keys) get close hues; the key scale shifts lightness a little. Faded, as the fate palette.
fn key_colour(c: Cell) -> vec3f {
  let h = fract(c.la / KEY_SPAN);
  let rgb = 0.64 + 0.26 * cos(TAU * (h + vec3f(0.0, -1.0 / 3.0, 1.0 / 3.0)));
  return rgb * (1.0 + 0.8 * c.aux);
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
  // the cell's own lattice as sharp dots (the reference turns its dot pattern by la + 90 degrees): the lattice
  // it emits with (key and fate, scaled by the lever), drawn in the unstretched frame and mapped through the
  // stretch with the outline, so the dots sit on the strained lattice
  let lat = cell_lattice(c, D.lever);
  let s = D.period * D.R * exp(lat.y);
  let dd = hex_dist(in.local, s, lat.x + 1.5707963);
  let aad = max(fwidth(dd), 0.35 / D.dpr);       // derivatives before any discard
  let disc = cover(c.r, d, aa);
  if (disc <= 0.0) { discard; }
  let col = select(cell_colour(c.kind), key_colour(c), D.mode > 0.5);

  let lw = min(D.lineW, 0.22 * c.r);              // thinner outline on small cells, so they do not turn solid
  let dot = select(0.0, cover(D.dotR * s, dd, aad) * cover(c.r - lw - 0.12 * D.R, d, aa), D.dots > 0.0);
  let ring = 1.0 - cover(c.r - lw, d, aa);        // clean outline at the rim
  // committed cells get a flat fill in their colour, so tissues read as areas; stem cells stay dark inside
  let fill = select(D.fill, D.fillC, c.kind != KIND_STEM);
  var fillRgb = col * fill;   // (step 8 may tint it below)
  // step 6, rule 2: a converted cell's outline is drawn in field B's ink, and a converted stem cell is filled with
  // it (flat, at the committed cells' level), so converted areas read as areas
  let conv = D.blue.a > 0.0 && (c.flags & CELL_CONV) != 0u;
  if (conv && c.kind == KIND_STEM) { fillRgb = D.blue.rgb * D.convFill; }
  // step 8, rule b, clock: a stem cell filled with the partner's ink as far as it emits A' (see the hand below)
  if (D.hand < 0.0 && c.kind == KIND_STEM) { fillRgb = mix(fillRgb, D.pInk.rgb * 0.55, clamp(c.z.y, 0.0, 1.0)); }
  var rgb = mix(fillRgb, col * D.dots, dot);
  let lineCol = select(col * D.line, D.blue.rgb, conv);
  // step 7: the cell's state as a flat bar through its centre, turned by 180 / states degrees per state (2 states:
  // upright and lying; 3: three directions 60 degrees apart), drawn over the dots like a print mark
  var bar = 0.0;
  var clearA = 0.0;
  if (D.states > 0.0) {
    let n = u32(D.states);
    let th = f32(cell_state(c, n)) * 3.14159265 / f32(n) + 1.5707963;
    let dir = vec2f(cos(th), sin(th));
    let along = abs(in.local.x * dir.x + in.local.y * dir.y);     // (the builtin dot() is shadowed above)
    let across = abs(in.local.y * dir.x - in.local.x * dir.y);
    let bd = length(vec2f(max(along - 0.55 * c.r, 0.0), across));
    let bw = max(0.13 * c.r, 0.6 / D.dpr);
    bar = cover(bw, bd, aa);
    // a clear margin around the bar (the dots there are left out), so the mark reads as one clean stroke
    clearA = cover(bw + 0.14 * c.r, bd, aa);
    rgb = mix(rgb, fillRgb, clearA * dot);
    rgb = mix(rgb, col * D.bar, bar);
  }
  // step 8, rule b: the phasor as a hand from the centre, in the partner's ink. Felt change (hand > 0): the phasor's
  // change from (1, 0), its direction where the change points in the (A, A') plane (right: more A; up the screen: more
  // A'), its length how far. Clock (hand < 0): the clock hand itself, at full length, and the cell is filled with the
  // partner's ink as far as it emits A' (z.y > 0), so the clock's waves read as yellow bands at any size.
  var hnd = 0.0;
  if (D.hand != 0.0) {
    let clock = D.hand < 0.0;
    var w = c.z - vec2f(1.0, 0.0);
    if (clock) { w = c.z; }
    let wl = length(w);
    if (wl > 0.05 && c.r * D.dpr > 5.0) {
      let dir = vec2f(w.x, -w.y) / wl;
      let len = c.r * 0.85 * select(min(1.0, wl / 0.6), 1.0, clock);
      let t = clamp(in.local.x * dir.x + in.local.y * dir.y, 0.0, len);
      let hd = length(in.local - dir * t);
      hnd = cover(max(0.11 * c.r, 0.6 / D.dpr), hd, aa);
      rgb = mix(rgb, select(D.pInk.rgb, col * D.line, clock) * abs(D.hand), hnd);
    }
  }
  rgb = mix(rgb, lineCol, ring);
  // step 6, rule 1: a cell leaking into field B gets a flat blue centre dot, its area growing with the leak
  var mark = 0.0;
  if (D.leakDot > 0.0) {
    let lk = clamp((cell_leak(c) - D.leakMin) / max(1.0 - D.leakMin, 1e-3), 0.0, 1.0);
    if (lk > 0.0) {
      mark = cover(D.leakDot * c.r * sqrt(lk), d, aa);
      rgb = mix(rgb, D.blue.rgb, mark);
    }
  }
  let a = disc * mix(D.fillA, 1.0, max(max(max(max(ring, dot * (1.0 - clearA)), mark), bar), hnd));
  // rgb is the colour as seen; blend premultiplied (one, one-minus-src-alpha)
  return vec4f(rgb * a, a);
}
