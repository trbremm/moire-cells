// The cells, drawn as instanced quads (6 vertices per cell, instance = cell index, so the order is stable).
// Needs field_common.wgsl and cell_common.wgsl in front of it (src/cells.js does that).
//
// Look: crisp, flat graphic shapes (no glow): a dark tinted disc with a clean outline, and inside it the
// cell's own hex lattice as small sharp dots, in the faded palette. Edges are anti-aliased over about one
// device pixel and nothing else is soft. Blending is plain "over" (premultiplied alpha), so a cell drawn later
// covers the edge of an earlier one and packed cells read as distinct shapes.
// The disc, outline and dots are drawn in the cell's unstretched frame and mapped through its stretch F,
// so a stretched cell and its lattice stretch together (as in the reference).
// Step C6: the cell's engines as PARTS: up to three small flat marks around the battery's core, at fixed places (up, lower
// right, lower left: the genome's slots 1, 2, 3), their size by the slot's rate, their shape and colour by what the engine
// does: harvest (an uphill engine with a pigment) = a disc in its pigment's light band colour, storer (an uphill engine
// without one, paid by the battery) = a ring in the battery's pale green, burn = a diamond in the fuel's green, swap = a
// triangle in faded red, form (sediment) = a square in dim warm grey. A clear margin keeps the lattice dots off them. View 2
// (strategy) colours the body by the strategy instead of the fate.
// Step C6n, the NEON look (D.neon.x = 1; src/neon.js adds the halo and the trails): the same shapes as light. The outline
// becomes a thin bright TUBE whose centre line is near white-hot and whose edges carry the colour; the inside goes dark
// (a faint tint plus a soft inner glow near the tube, as a lit tube lights the wall behind it); the lattice dots are
// faint; the battery's core is a soft-lit disc with a bright rim (its size still shows how full the battery is); the
// parts are small bright lamps. HUM: every cell's brightness wobbles a few % at its own slow rate and phase (from its
// seed), and rises with its ACTIVITY: how fast its battery changes (charging by burning, spending on engines and crawl;
// cell_glow.wgsl smooths it per cell), so busy cells shine brighter and idle ones dim a little. Colours: src/palette.js.

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
  core: f32,        // step C5: the battery's core at a full battery, radius as a share of the cell's (0 = not drawn)
  dim: f32,         // ... how much darker a starving cell is drawn (0 = not at all)
  starve: f32,      // ... battery share below which a cell counts as starving (it dims toward this share and below)
  _p0: f32,
  coreInk: vec4f,   // ... the core's ink (rgb): the fuel's green, energy; w: step C6, engine kinds 16.. (see part_kind)
  // ---- step C6: the engines as parts, and the strategy view ----
  ink1: vec4f,      // visible 1's ink (rgb); w: 1 = draw the parts
  ink2: vec4f,      // visible 2's ink; w: a part's largest half-size, as a share of the cell's radius
  ink3: vec4f,      // hard light's ink; w: the parts' distance from the centre, as a share of the radius
  inkBurn: vec4f,   // a burn engine (the fuel's green); w: the engines' kinds, 2 bits each (u32 bits)
  inkSed: vec4f,    // a form (sediment) engine; w: the rate at which a part reaches its largest size
  inkSwap: vec4f,   // a swap engine; w: the battery's core radius at full charge while parts are drawn (share of r)
  inkOther: vec4f,  // strategy view: the body of a cell that neither harvests nor burns; w: every body's fill there
  // ---- step C6n: the palette's fate inks, and the neon look ----
  fate: array<vec4f, 5>,   // the fates' inks (rgb): stem, epithelium, muscle, neuron, cartilage
  neon: vec4f,      // x: 1 = the neon look; y: the tube's width (CSS px); z: how white its centre line is (0..1); w: the inner
                    // glow's reach (share of r)
  neon2: vec4f,     // x: the inner glow's brightness; y: the battery core's lit rim (share of its radius); z: how white the
                    // parts' lamps are (0..1); w: the core's dim inside (share of its rim's brightness)
  hum: vec4f,       // x: the wobble's depth; y: its rate (Hz, each cell 0.6 to 1.4 x); z: real time (s); w: 1 = activity read
  hum2: vec4f,      // x: an idle cell's brightness; y: the activity (battery change per s) at which a cell is 63 % of the way
                    // to the busiest; z, w: the lineage colours' base and amplitude
};

@group(0) @binding(0) var<uniform> D: Draw;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;    // step C6: the genomes (engines)
@group(0) @binding(3) var<storage, read> glow: array<vec2f>; // step C6n: x the battery last frame, y its smoothed change per s

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,                     // position in the cell's unstretched frame (CSS px)
  @location(1) @interpolate(flat) id: u32,
};

// the fate's ink (stem, epithelium, muscle, neuron, cartilage), from the palette in use (src/palette.js)
fn cell_colour(kind: u32) -> vec3f {
  return D.fate[min(kind, 4u)].rgb;
}

// lineage colour: the key angle (60 degrees of hex symmetry) goes once round the hue circle, so related
// cells (close keys) get close hues; the key scale shifts lightness a little. Base and amplitude from the palette
// (faded: 0.64 + 0.26 cos; neon: more saturated).
fn key_colour(c: Cell) -> vec3f {
  let h = fract(c.la / KEY_SPAN);
  let rgb = D.hum2.z + D.hum2.w * cos(TAU * (h + vec3f(0.0, -1.0 / 3.0, 1.0 / 3.0)));
  return max(rgb, vec3f(0.0)) * (1.0 + 0.8 * c.aux);
}

// step C6n: the hum, a cell's brightness: a slow wobble at its own rate and phase, times idle .. 1 + by its activity
fn hum_bright(c: Cell, i: u32) -> f32 {
  if (D.hum.x <= 0.0 && D.hum.w <= 0.0) { return 1.0; }
  let ph = f32(c.seed & 65535u) / 65536.0;
  let rate = D.hum.y * (0.6 + 0.8 * f32((c.seed >> 16u) & 255u) / 255.0);
  let wob = 1.0 + D.hum.x * sin(TAU * (rate * D.hum.z + ph));
  var act = 1.0;
  if (D.hum.w > 0.0) { act = D.hum2.x + (1.0 - D.hum2.x) * 1.6 * (1.0 - exp(-glow[i].y / max(D.hum2.y, 1e-6))); }
  return wob * act;
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

// step C6: an engine's kind (0 harvest, 1 burn, 2 swap, 3 form) from the table packed 2 bits each in D.inkBurn.w (engines
// 0..15) and D.coreInk.w (16..)
fn part_kind(e: u32) -> u32 {
  let w = select(bitcast<u32>(D.coreInk.w), bitcast<u32>(D.inkBurn.w), e < 16u);
  return (w >> (2u * (e & 15u))) & 3u;
}
fn band_ink(b: u32) -> vec3f {
  if (b == 1u) { return D.ink1.rgb; }
  if (b == 2u) { return D.ink2.rgb; }
  return D.ink3.rgb;
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
  var col = select(cell_colour(c.kind), key_colour(c), D.mode > 0.5);
  // step C6: the genome's engines (for the parts and the strategy view)
  let g = bio[in.id];
  var harvestBand = 0u;
  var burns = false;
  for (var k = 0u; k < 3u; k++) {
    if (g.rate[k] <= 0.0) { continue; }
    let kind = part_kind(eng_index(g.eng[k]));
    if (kind == 0u && harvestBand == 0u) { harvestBand = eng_band(g.eng[k]); }   // (0: a storer, not a harvester)
    if (kind == 1u) { burns = true; }
  }
  let strategyView = D.mode > 1.5;
  if (strategyView) {
    // harvest: the pigment's band colour; burn: the fuel's green; both: split down the middle, band left, green right
    // (a crisp edge); neither: dim grey
    if (harvestBand > 0u && burns) { col = mix(D.inkBurn.rgb, band_ink(harvestBand), cover(0.0, in.local.x, aa)); }
    else if (harvestBand > 0u) { col = band_ink(harvestBand); }
    else if (burns) { col = D.inkBurn.rgb; }
    else { col = D.inkOther.rgb; }
  }

  let neon = D.neon.x > 0.5;
  // thinner outline on small cells, so they do not turn solid (neon: the tube, a little wider)
  let lw = select(min(D.lineW, 0.22 * c.r), min(D.neon.y, 0.3 * c.r), neon);
  let dot = select(0.0, cover(D.dotR * s, dd, aad) * cover(c.r - lw - 0.12 * D.R, d, aa), D.dots > 0.0);
  let ring = 1.0 - cover(c.r - lw, d, aa);        // clean outline at the rim
  // committed cells get a flat fill in their colour, so tissues read as areas; stem cells stay dark inside
  // (neon: every inside dark, a faint tint; the fills come from src/cells.js by the look)
  let fill = select(select(D.fill, D.fillC, c.kind != KIND_STEM), D.inkOther.w, strategyView);
  var fillRgb = col * fill;   // (step 8 may tint it below)
  // step C6n: neon, the tube lights the inside near it (a soft glow falling off inward)
  if (neon) { fillRgb += col * D.neon2.x * exp(-max(c.r - lw - d, 0.0) / max(D.neon.w * c.r, 1e-3)); }
  // step 6, rule 2: a converted cell's outline is drawn in field B's ink, and a converted stem cell is filled with
  // it (flat, at the committed cells' level), so converted areas read as areas
  let conv = D.blue.a > 0.0 && (c.flags & CELL_CONV) != 0u;
  if (conv && c.kind == KIND_STEM) { fillRgb = D.blue.rgb * D.convFill; }
  // step 8, rule b, clock: a stem cell filled with the partner's ink as far as it emits A' (see the hand below)
  if (D.hand < 0.0 && c.kind == KIND_STEM) { fillRgb = mix(fillRgb, D.pInk.rgb * 0.55, clamp(c.z.y, 0.0, 1.0)); }
  var rgb = mix(fillRgb, col * D.dots, dot);
  // step C5: the battery as a flat core at the centre, its AREA in proportion to the charge (full: a big core; empty:
  // none), in the fuel's green (energy); drawn over the lattice dots, crisp
  var coreA = 0.0;
  let partsOn = D.ink1.w > 0.0;
  if (D.core > 0.0 && c.bat > 0.0) {
    let rc = select(D.core, D.inkSwap.w, partsOn) * c.r * sqrt(clamp(c.bat, 0.0, 1.0));
    if (rc * D.dpr > 0.6) {
      coreA = cover(rc, d, aa);
      var ci = D.coreInk.rgb;
      // step C6n: neon, a soft-lit disc: dim inside, a bright rim (a large core reads as a lit ring, a small one as a dot)
      if (neon) { ci *= mix(D.neon2.w, 1.0, smoothstep(rc * (1.0 - D.neon2.y) - aa, rc - 0.5 * aa, d)); }
      rgb = mix(rgb, ci, coreA);
    }
  }
  // step C6: the engines as parts around the core: flat marks with crisp edges, each in a clear margin
  var partA = 0.0;
  if (partsOn) {
    let hmax = D.ink2.w * c.r;
    for (var k = 0u; k < 3u; k++) {
      let rk = g.rate[k];
      if (rk <= 0.0) { continue; }
      let e = eng_index(g.eng[k]);
      let kind = part_kind(e);
      let h = hmax * sqrt(clamp(rk / max(D.inkSed.w, 1e-3), 0.12, 1.0));
      if (h * D.dpr < 0.6) { continue; }
      let th = -1.5707963 + f32(k) * 2.0943951;               // up, lower right, lower left (screen y down)
      let ax = vec2f(cos(th), sin(th));
      let p = in.local - ax * (D.ink3.w * c.r);
      let q = vec2f(p.x * ax.x + p.y * ax.y, p.y * ax.x - p.x * ax.y);   // along the outward axis, across
      var dd2 = length(q) - h;                                  // harvest: a disc in its band's colour
      var ink = band_ink(eng_band(g.eng[k]));
      if (kind == 0u && eng_band(g.eng[k]) == 0u) { dd2 = abs(length(q) - 0.7 * h) - 0.3 * h; ink = D.coreInk.rgb; }   // storer: a ring, battery green
      if (kind == 1u) { dd2 = (abs(q.x) + abs(q.y)) * 0.7071068 - 0.86 * h; ink = D.inkBurn.rgb; }        // burn: a diamond
      else if (kind == 2u) {                                                                                // swap: a triangle
        dd2 = max(abs(q.y) * 0.8660254 + q.x * 0.5, -q.x) - 0.62 * h;
        ink = D.inkSwap.rgb;
      } else if (kind == 3u) { dd2 = max(abs(q.x), abs(q.y)) - 0.84 * h; ink = D.inkSed.rgb; }           // form: a square
      let pa = cover(0.0, dd2, aa);
      let margin = cover(0.14 * c.r, dd2, aa);
      rgb = mix(rgb, fillRgb, margin * dot);
      if (neon) { ink = mix(ink, vec3f(1.0), D.neon2.z * clamp(-dd2 / max(h, 1e-3), 0.0, 1.0)); }   // step C6n: a lamp, whiter inside
      rgb = mix(rgb, ink, pa);
      partA = max(partA, pa);
    }
  }
  var lineCol = select(col * D.line, D.blue.rgb, conv);
  if (neon) {
    // step C6n: the tube's cross-section: white-hot along its centre line, its colour toward its edges
    let prof = clamp(1.0 - abs(d - (c.r - 0.5 * lw)) / max(0.5 * lw, 1e-3), 0.0, 1.0);
    lineCol = mix(lineCol, vec3f(max(max(lineCol.r, lineCol.g), lineCol.b)), D.neon.z * prof * prof);
    lineCol = mix(lineCol, vec3f(1.0), 0.6 * D.neon.z * prof * prof * prof);
  }
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
  // step C5: a starving cell (battery below D.starve) is drawn dimmer, down to 1 - D.dim at an empty battery
  if (D.dim > 0.0) { rgb *= 1.0 - D.dim * (1.0 - smoothstep(0.0, max(D.starve, 1e-3), c.bat)); }
  // step C6n: the hum (1 when it is off or the look is flat)
  rgb *= hum_bright(c, in.id);
  let a = disc * mix(D.fillA, 1.0, max(max(max(max(max(max(ring, dot * (1.0 - clearA)), mark), bar), hnd), coreA), partA));
  // rgb is the colour as seen; blend premultiplied (one, one-minus-src-alpha)
  return vec4f(rgb * a, a);
}
