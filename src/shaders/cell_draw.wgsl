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
  view: vec2f,      // canvas size in CSS px of the dish (app: / the camera's zoom: the dish's part on screen)
  dpr: f32,         // device px per dish px (app: x the zoom)
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
  // ---- step C6b: the charge view (mode 3) ----
  qPos: vec4f,      // a cell with net + charge (its stock holds more givers): the charge contours' + ink
  qNeg: vec4f,      // ... net -: the - ink
  // ---- step C6c: the honeycomb outline ----
  hexDraw: vec4f,   // x: corner rounding radius (share of r); y: the tube's gap inside the wall (CSS px, at most 0.08 r)
  // ---- step C6c: the membrane chemistry's look (src/membrane.js; cells.look.memb*) ----
  memb: vec4f,      // x: 1 = draw the membrane's integrity; y: how much an empty side's tube dims (0..1); z: integrity below which
                    // a damaged side's tube breaks into dashes and flickers (only a membrane that has been whole); w: a heavy
                    // membrane's second, inner tube (brightness, 0 = none)
  memb2: vec4f,     // x: the flicker's depth; y: a burst's flash brightness; z: how much wider a thick membrane's tube is (at
                    // 2.5 x tRef); w: tRef (the founders' usual thickness)
  // ---- step C6d: the dipoles' look (src/dipole.js writeDraw) ----
  dip: vec4f,       // x: each side's tube tinted toward the + / - ink by its charge, at most this much (0 = none); y: the
                    // machinery's arrow from - to + (brightness, 0 = none); z: 1 / pHalf; w: colour by charge, the two-tone body
  dip2: vec4f,      // x: 1 = dipoles on; y z w spare
  // ---- step C7: the pumps as parts on the membrane, and the membrane voltage (src/pumps.js; cells.look.pump*) ----
  pump: vec4f,      // x: 1 = draw the pumps' notches; y: a notch's half-width at the largest rate (share of r); z: the voltage's
                    // inner rim (brightness, 0 = none: the machinery only); w: the voltage at which the rim is full
  pump2: vec4f,     // x: the rate at which a notch reaches its full size; y: how much the tube's segment at a notch takes the
                    // substance's ink (0..1); z w spare
  pumpInk: array<vec4f, 13>,   // each substance's ink (its palette colour, by chemical function and row)
  // ---- step C9: division and death (src/division.js; cells.look.div*) ----
  div: vec4f,       // x: a division's flash (brightness, 0 = none); y: its length (s); z: how far a starving cell fades out
                    // before it dies (0..1); w: 1 / the starvation time (s)
  // ---- step C10: the patterned walls' look (src/walls.js writeDraw; walls.look) ----
  wall: vec4f,      // x: 1 = draw the walls (a side's tube brighter where it is sticky); y: how much brighter at full adhesion
                    // (and dimmer at none); z: a matured junction's tube whiter by this much; w: the machinery's tick toward the front
  wall2: vec4f,     // x: the walls view (mode 4): the tubes' shading by adhesion; y: ... the body's fill; z: the pattern threshold
                    // (|a1|, |a2| below it: uniform); w: a matured junction's tube brighter by this much
  wallInk: array<vec4f, 4>,   // the walls view's inks: uniform, polar, two-ended, sticky sides
  // ---- step C12b: the lipid membranes' look (src/lipids.js writeDraw; lipids.look) ----
  lip: vec4f,       // x: 1 = draw the membranes' make-up (Cell.lip); y: a soap bilayer's pearly, iridescent sheen on the tube (0..1);
                    // z: an oily bilayer's deeper, glossier tube (0..1); w: a full wall's rim width (share of r)
  lip2: vec4f,      // x: the rim's brightness; y: a brick's length (share of r); z w spare
  lipInk: array<vec4f, 3>,    // a light (ll) crust, a heavy (LL) crust, soap's pearl
  // ---- step C13: the guides view (mode 5; src/guides.js writeDraw) ----
  gd: vec4f,        // x: 1 = the guides view; y: the tubes' shading by what each side feels (0..1); z: the body's fill at |gene| = 1;
                    // w: a gate gene below this counts as none (the body then grey)
  gdInk: array<vec4f, 6>,     // the guides view's inks: unguided, glue, pump, engine, division, turn
  cam: vec4f,       // app: the view camera (xy pan, CSS px of the dish; z zoom)
};

@group(0) @binding(0) var<uniform> D: Draw;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<Bio>;    // step C6: the genomes (engines)
@group(0) @binding(3) var<storage, read> glow: array<vec2f>; // step C6n: x the battery last frame, y its smoothed change per s

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,                     // position in the cell's unstretched frame (CSS px); step C6c, a
                                                 // honeycomb cell: the offset from its centre on screen
  @location(1) @interpolate(flat) id: u32,
  // step C6c: a honeycomb cell's outline, its 6 sides as lines n . x = h (outward normals n, distances h from the centre):
  // nn0 = n0 n1, nn1 = n2 n3, nn2 = n4 n5, hh0 = h0..h3, hh1 = h4, h5, the corner rounding radius, 1 (= a honeycomb cell)
  @location(2) @interpolate(flat) nn0: vec4f,
  @location(3) @interpolate(flat) nn1: vec4f,
  @location(4) @interpolate(flat) nn2: vec4f,
  @location(5) @interpolate(flat) hh0: vec4f,
  @location(6) @interpolate(flat) hh1: vec4f,
  @location(7) lp: vec2f,                        // the position in the cell's unstretched frame (= local for an ellipse cell;
                                                 // a honeycomb cell: F^-1 local, for the inside: dots, core, parts, marks)
  @location(8) @interpolate(flat) dipv: vec2f,   // step C6d: the cell's saturated dipole (on screen, length 0..1)
  // step C7: a honeycomb cell's sides' middles, as the coordinate along each side's line that memb_side returns (sides 0..3,
  // then 4, 5), for the pumps' notches
  @location(9) @interpolate(flat) tm0: vec4f,
  @location(10) @interpolate(flat) tm1: vec4f,
};

// Step C6c: how far inside a honeycomb outline a point p is (relative to the centre). Inside each side's line by
// a_k = h_k - n_k . p; the polygon is where all are positive, the distance inside it is their minimum, and each corner is
// rounded by rc: next to corner k (sides k - 1 and k) the two lines' distances a, b give
// max(rc, min(a, b)) - |max(rc - (a, b), 0)| (a quarter circle where both are within rc; the "round intersection").
// Taking the minimum over the corners never folds over itself, however short a side, and keeps every side straight
// (so shared walls stay straight). Outside it falls below 0 about as the distance does (enough for the anti-aliasing).
fn hex_inside(p: vec2f, in: VSOut) -> f32 {
  let n = array<vec2f, 6>(in.nn0.xy, in.nn0.zw, in.nn1.xy, in.nn1.zw, in.nn2.xy, in.nn2.zw);
  let h = array<f32, 6>(in.hh0.x, in.hh0.y, in.hh0.z, in.hh0.w, in.hh1.x, in.hh1.y);
  let rc = in.hh1.z;
  var a: array<f32, 6>;
  for (var k = 0; k < 6; k++) { a[k] = h[k] - (n[k].x * p.x + n[k].y * p.y); }
  var e = 1e9;
  for (var k = 0; k < 6; k++) {
    let x = a[(k + 5) % 6];
    let y = a[k];
    let q = max(vec2f(rc - x, rc - y), vec2f(0.0));
    e = min(e, max(rc, min(x, y)) - length(q));
  }
  return e;
}

// Step C6c: which side of the membrane a point p (relative to the centre) belongs to, and how far along it (CSS px): a
// honeycomb cell, the side whose line is nearest; an ellipse cell, the side's 60 degrees in its unstretched frame (lp)
fn memb_side(p: vec2f, lp: vec2f, r: f32, in: VSOut) -> vec2f {
  if (in.hh1.w > 0.5) {
    let n = array<vec2f, 6>(in.nn0.xy, in.nn0.zw, in.nn1.xy, in.nn1.zw, in.nn2.xy, in.nn2.zw);
    let h = array<f32, 6>(in.hh0.x, in.hh0.y, in.hh0.z, in.hh0.w, in.hh1.x, in.hh1.y);
    var best = 1e9;
    var k0 = 0;
    for (var k = 0; k < 6; k++) {
      let a = h[k] - (n[k].x * p.x + n[k].y * p.y);
      if (a < best) { best = a; k0 = k; }
    }
    let t = n[k0].x * p.y - n[k0].y * p.x;
    return vec2f(f32(k0), t);
  }
  var ang = atan2(lp.y, lp.x);
  if (ang < 0.0) { ang += TAU; }
  return vec2f(f32(min(u32(ang / P3), 5u)), ang * r);
}

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
  o.id = ii;
  if ((cells[ii].flags & CELL_ALIVE) == 0u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }   // step C9: a free slot: nothing
  let c = cells[ii];
  // two triangles: corners (-1,-1) (1,-1) (-1,1) / (-1,1) (1,-1) (1,1)
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                               vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  o.id = ii;
  o.hh1 = vec4f(0.0);
  o.tm0 = vec4f(0.0);
  o.tm1 = vec4f(0.0);
  if ((c.flags & CELL_HEX) != 0u) {
    // step C6c: a honeycomb cell, on a square around its farthest corner; its sides' lines for the fragment shader
    let P = hex_corners(c);
    var rmax = 0.0;
    var hmin = 1e9;
    var n: array<vec2f, 6>;                      // side k's outward normal (side k: corner k to corner k + 1)
    var h: array<f32, 6>;                        // ... and its distance from the centre
    for (var k = 0; k < 6; k++) {
      rmax = max(rmax, c.rad[k]);
      let e = P[(k + 1) % 6] - P[k];
      n[k] = vec2f(e.y, -e.x) / max(length(e), 1e-6);
      h[k] = n[k].x * P[k].x + n[k].y * P[k].y;
      hmin = min(hmin, h[k]);
    }
    o.nn0 = vec4f(n[0], n[1]);
    o.nn1 = vec4f(n[2], n[3]);
    o.nn2 = vec4f(n[4], n[5]);
    o.hh0 = vec4f(h[0], h[1], h[2], h[3]);
    // step C7: each side's middle along its line (t = n.x p.y - n.y p.x, as memb_side)
    var tm: array<f32, 6>;
    for (var k = 0; k < 6; k++) {
      let a = P[k];
      let b = P[(k + 1) % 6];
      tm[k] = 0.5 * ((n[k].x * a.y - n[k].y * a.x) + (n[k].x * b.y - n[k].y * b.x));
    }
    o.tm0 = vec4f(tm[0], tm[1], tm[2], tm[3]);
    o.tm1 = vec4f(tm[4], tm[5], 0.0, 0.0);
    o.hh1 = vec4f(h[4], h[5], min(D.hexDraw.x * c.r, 0.8 * max(hmin, 0.0)), 1.0);
    let l = corner[vi] * (rmax + 1.5 / D.dpr);
    let w = c.pos + l;
    o.pos = vec4f((w.x - D.cam.x) / D.view.x * 2.0 - 1.0, 1.0 - (w.y - D.cam.y) / D.view.y * 2.0, 0.0, 1.0);
    o.local = l;
    let F = cell_F(c);                             // its inverse: [[fd, -fb], [-fb, fa]]
    o.lp = vec2f(F.z * l.x - F.y * l.y, F.x * l.y - F.y * l.x);
  } else {
    let half = c.r + 1.5 / D.dpr;                  // room for the anti-aliased edge
    let l = corner[vi] * half;
    let F = cell_F(c);
    let w = c.pos + vec2f(F.x * l.x + F.y * l.y, F.y * l.x + F.z * l.y);
    o.pos = vec4f((w.x - D.cam.x) / D.view.x * 2.0 - 1.0, 1.0 - (w.y - D.cam.y) / D.view.y * 2.0, 0.0, 1.0);
    o.local = l;
    o.lp = l;
  }
  if ((c.flags & CELL_ALIVE) == 0u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }   // outside the clip volume
  o.dipv = vec2f(0.0);
  if (D.dip2.x > 0.5) { o.dipv = dip_sat(cell_dipole_raw(c, membrane(c)), D.dip.z); }
  return o;
}

// coverage of "distance < edge" with a one-pixel anti-aliased step (aa = CSS px per device px)
fn cover_in(e: f32, aa: f32) -> f32 { return clamp(e / aa + 0.5, 0.0, 1.0); }   // ... of "at least 0 inside" (e: how far in)
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
  // the position in the cell's own (unstretched) frame, for the inside (lattice dots, core, parts, marks), and ein, how far
  // inside the drawn outline a pixel is: an ellipse cell's r - |lp|; step C6c, a honeycomb cell: inside the rounded
  // hexagon (exact distance), less the tube's gap from the wall (so two neighbours' tubes do not merge into one thick line)
  let lp = in.lp;
  var ein = c.r - length(in.local);
  if (in.hh1.w > 0.5) { ein = hex_inside(in.local, in) - min(D.hexDraw.y, 0.08 * c.r); }
  let d = length(lp);
  let aa = max(fwidth(ein), 0.35 / D.dpr);
  // the cell's own lattice as sharp dots (the reference turns its dot pattern by la + 90 degrees): the lattice
  // it emits with (key and fate, scaled by the lever), drawn in the unstretched frame and mapped through the
  // stretch with the outline, so the dots sit on the strained lattice
  let lat = cell_lattice_a(c, D.lever);   // (step C13: the lattice its genes give it: lever factor, angle offset)
  let s = D.period * D.R * exp(lat.y);
  let dd = hex_dist(lp, s, lat.x + 1.5707963);
  let aad = max(fwidth(dd), 0.35 / D.dpr);       // derivatives before any discard
  let disc = cover_in(ein, aa);
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
  let strategyView = D.mode > 1.5 && D.mode < 2.5;
  // step C6b, colour by charge: the dim grey of "other" toward the + or - ink by the cell's charge q (its stock's net
  // charge, saturating: the one field B and the substrate's field see)
  let chargeView = D.mode > 2.5 && D.mode < 3.5;
  // step C10, the walls view (mode 4): the body in its wall pattern's ink (from the genes a1, a2: uniform, polar, two-ended,
  // sticky sides); the tubes below are shaded strongly by each side's adhesion, so the pattern itself shows
  let wallsView = D.mode > 3.5 && D.mode < 4.5;
  // step C13, the guides view (mode 5): the body in its STRONGEST gate's ink (glue, pump, engine, division, turn; grey when every gate
  // gene is small), filled as strongly as that gene is; the tubes below are shaded by what each side feels of field A (bright where
  // the field is high, dark where low), so the landscape a cell is guided by shows round its rim
  let guidesView = D.gd.x > 0.5;
  var gdFill = 0.0;
  if (guidesView) {
    let gv = array<f32, 5>(g.gate.x, g.gate.y, g.gate.z, g.gate.w, g.gate2.x);
    var gb = 0u;
    var gm = D.gd.w;
    for (var k = 0u; k < 5u; k++) { if (abs(gv[k]) >= gm) { gm = abs(gv[k]); gb = k + 1u; } }
    col = D.gdInk[gb].rgb;
    gdFill = D.gd.z * select(0.25, clamp(gm, 0.25, 1.0), gb > 0u);
  }
  if (wallsView) {
    let a1 = g.wall.x;
    let a2 = g.wall.y;
    var wc = 0u;
    if (max(abs(a1), abs(a2)) >= D.wall2.z) { wc = select(select(3u, 2u, a2 > 0.0), 1u, abs(a1) >= abs(a2)); }
    col = D.wallInk[wc].rgb;
  }
  if (chargeView) { col = mix(D.inkOther.rgb, select(D.qNeg.rgb, D.qPos.rgb, c.q > 0.0), clamp(abs(c.q), 0.0, 1.0)); }
  // step C6d: the pixel's offset from the centre on screen (a honeycomb cell: local; an ellipse cell: F lp), and the dipole
  let dipv = in.dipv;
  let dipm = length(dipv);
  let Fd = cell_F(c);
  let pw = select(vec2f(Fd.x * lp.x + Fd.y * lp.y, Fd.y * lp.x + Fd.z * lp.y), in.local, in.hh1.w > 0.5);
  // ... colour by charge: a polarised cell's body in two halves across its dipole, + rose toward its + end, - blue toward its
  // - end (a crisp edge through the centre), the stronger the dipole the more
  if (chargeView && D.dip.w > 0.0 && dipm > 0.05) {
    let sdp = (pw.x * dipv.x + pw.y * dipv.y) / dipm;
    let two = mix(D.qNeg.rgb, D.qPos.rgb, cover(0.0, -sdp, aa));
    col = mix(col, two, D.dip.w * clamp(dipm, 0.0, 1.0));
  }
  if (strategyView) {
    // harvest: the pigment's band colour; burn: the fuel's green; both: split down the middle, band left, green right
    // (a crisp edge); neither: dim grey
    if (harvestBand > 0u && burns) { col = mix(D.inkBurn.rgb, band_ink(harvestBand), cover(0.0, lp.x, aa)); }
    else if (harvestBand > 0u) { col = band_ink(harvestBand); }
    else if (burns) { col = D.inkBurn.rgb; }
    else { col = D.inkOther.rgb; }
  }

  let neon = D.neon.x > 0.5;
  // thinner outline on small cells, so they do not turn solid (neon: the tube, a little wider)
  var lw = select(min(D.lineW, 0.22 * c.r), min(D.neon.y, 0.3 * c.r), neon);
  // step C6c, the membrane as material: the side this pixel's tube belongs to and its integrity; an empty (never built) or
  // bitten side's tube is dimmer and thinner, a thick membrane's a little wider, a heavy one's doubled by a fainter inner
  // tube; a damaged side of a membrane that has been whole breaks into dashes and flickers; a burst cell flashes
  var ig = 1.0;
  var mGap = 1.0;          // the tube's coverage along the side (dashes)
  var mDim = 1.0;          // its brightness
  var inner = 0.0;         // the heavy membrane's inner tube
  let bt = cell_burst(c.flags);
  var sd = vec2f(0.0);
  if (D.memb.x > 0.5 || D.dip.x > 0.0 || D.pump.x > 0.5 || D.wall.x > 0.5 || D.lip.x > 0.5) { sd = memb_side(in.local, lp, c.r, in); }
  let side = u32(sd.x);
  if (D.memb.x > 0.5) {
    ig = clamp(c.integ[side], 0.0, 1.0);
    let gmb = g.memb;
    lw *= (0.75 + 0.25 * ig) * (1.0 + D.memb2.z * clamp((gmb.y / max(D.memb2.w, 1e-4) - 1.0) / 1.5, 0.0, 1.0));
    mDim = 1.0 - D.memb.y * (1.0 - ig);
    let hsh = f32((c.seed >> (4u * side)) & 15u) / 16.0;
    let whole = (c.flags & CELL_WHOLE) != 0u;
    var dmg = select(0.0, clamp(1.0 - ig / max(D.memb.z, 1e-3), 0.0, 1.0), whole);
    if (bt != 0u) { dmg = 0.75; }
    if (dmg > 0.0) {
      // dashes along the side, about 0.45 r long; the gaps grow as the side empties (up to 70 % of it)
      let per = max(0.45 * c.r, 2.0);
      let u = fract(sd.y / per + hsh);
      let gap = 0.7 * dmg;
      mGap = clamp(min(u - gap, 1.0 - u) * per / aa + 0.5, 0.0, 1.0);
      if (gap <= 0.0) { mGap = 1.0; }
      mDim *= 1.0 - D.memb2.x * dmg * (0.5 + 0.5 * sin(TAU * (D.hum.z * (2.3 + 1.7 * hsh)) + 6.0 * hsh));
    }
    inner = D.memb.w * smoothstep(0.35, 0.85, gmb.x) * (0.6 + 0.4 * ig);
  }
  // step C12b, the lipid membrane's make-up (this side's Cell.lip: x stiffness / 4, y the wall's heavy share, z the bilayer's oil
  // share, w the wall's cover). A soap bilayer is a thin pearly tube whose colour drifts along it (as C12's soap films); oil makes
  // it deeper, more saturated and glossier (a little wider, a hotter core); a WALL of crust is a flat, crisp amber-to-brown rim
  // OUTSIDE the tube (the tube moves in by the rim's width, the same all round: the cell's fullest wall), laid as bricks where this
  // side's wall is (a partial wall shows as scattered bricks)
  var lq = vec4f(0.0);
  var wOff = 0.0;
  var soapy = 0.0;
  var oily = 0.0;
  if (D.lip.x > 0.5) {
    inner = 0.0;   // (the C6c heavy weave's second tube: the weave now holds only the walls' glue)
    lq = unpack4x8unorm(c.lip[min(side, 5u)]);
    var cmax = 0.0;
    for (var k = 0u; k < 6u; k++) { cmax = max(cmax, unpack4x8unorm(c.lip[k]).w); }
    wOff = D.lip.w * c.r * cmax;
    oily = min(2.0 * lq.z, 1.0) * ig;   // (a bilayer holds at most one oil per soap: an oil share of 1/2 is fully oily)
    soapy = ig - oily;
    lw *= (1.0 - 0.2 * soapy) * (1.0 + 0.6 * D.lip.z * oily);
  }
  let ein2 = ein - wOff;     // how far inside the tube's outer edge (the outline less the wall's rim)
  let dot = select(0.0, cover(D.dotR * s, dd, aad) * cover_in(ein2 - lw - 0.12 * D.R, aa), D.dots > 0.0);
  var ring = (1.0 - cover_in(ein2 - lw, aa)) * mGap * cover_in(ein2, aa);   // clean outline at the rim (step C6c: broken where the membrane is)
  // step C6c: a heavy membrane's inner tube, a thin line just inside the outer one (a gap of about 0.8 px)
  var ring2 = 0.0;
  if (inner > 0.0) {
    let g0 = lw + max(0.8, 0.6 * lw);
    let w2 = max(0.45 * lw, 0.5 / D.dpr);
    ring2 = clamp(min(ein2 - g0, g0 + w2 - ein2) / aa + 0.5, 0.0, 1.0) * mGap;
  }
  // committed cells get a flat fill in their colour, so tissues read as areas; stem cells stay dark inside
  // (neon: every inside dark, a faint tint; the fills come from src/cells.js by the look)
  let fill = select(select(select(select(D.fill, D.fillC, c.kind != KIND_STEM), D.inkOther.w, strategyView || chargeView), D.wall2.y, wallsView),
                    gdFill, guidesView);
  var fillRgb = col * fill;   // (step 8 may tint it below)
  // step C6n: neon, the tube lights the inside near it (a soft glow falling off inward)
  if (neon) { fillRgb += col * D.neon2.x * exp(-max(ein2 - lw, 0.0) / max(D.neon.w * c.r, 1e-3)); }
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
      let p = lp - ax * (D.ink3.w * c.r);
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
  // step C6d: each side's tube tinted toward the + ink (rose) or the - ink (blue) by its charge's difference from the even
  // share (a side's share of the dipole: about |p| / 2.6), slightly (the tube's white-hot centre stays)
  if (D.dip.x > 0.0) {
    var sqv = c.sideQ;
    let tq = tanh((sqv[min(side, 5u)] - c.qNet / 6.0) * 2.6 * D.dip.z);
    lineCol = mix(lineCol, select(D.qNeg.rgb, D.qPos.rgb, tq > 0.0) * max(D.line, 0.7), D.dip.x * abs(tq));
  }
  // step C10: the patterned walls. A side's tube is brighter where the side is sticky (its effective adhesion) and dimmer where it
  // is not; a matured junction's tube is whiter and brighter, so a matured contact reads as a bright shared wall (both cells'
  // tubes). The walls view shades the tubes much more strongly, so each cell's pattern shows round its rim
  if (D.wall.x > 0.5) {
    let aE = min(wall_get(c.wadh[0], c.wadh[1], side), 1.0);
    let mtr = wall_mature(c.mature, side) * aE;
    let gain = select(D.wall.y, D.wall2.x, wallsView);
    lineCol *= (1.0 - gain) + 2.0 * gain * aE;
    lineCol = mix(lineCol, vec3f(max(max(lineCol.r, lineCol.g), lineCol.b)), D.wall.z * mtr) * (1.0 + D.wall2.w * mtr);
  }
  // step C13, the guides view: each side's tube by what that side feels (s, -1..1): bright where the field is high, dark where low
  if (guidesView) { lineCol *= (1.0 - D.gd.y) + D.gd.y * (1.0 + cell_felt(c, min(side, 5u))); }
  // step C12b: soap's pearl (a pale sheen whose hue drifts along the tube and slowly in time) and oil's depth (more saturated)
  if (D.lip.x > 0.5) {
    let hsh = f32((c.seed >> 8u) & 255u) / 255.0;
    let hue = sd.y / max(2.2 * c.r, 1.0) + 0.04 * D.hum.z + hsh + 0.17 * f32(side);
    let irid = 0.62 + 0.38 * cos(TAU * (hue + vec3f(0.0, 0.33, 0.67)));
    let pearl = D.lipInk[2].rgb * irid * max(max(max(lineCol.r, lineCol.g), lineCol.b), 0.6);
    lineCol = mix(lineCol, pearl, D.lip.y * soapy);
    let gr = vec3f((lineCol.r + lineCol.g + lineCol.b) / 3.0);   // (the builtin dot() is shadowed above)
    lineCol = max(mix(gr, lineCol, 1.0 + 1.2 * D.lip.z * oily), vec3f(0.0)) * (1.0 - 0.2 * D.lip.z * oily);
  }
  if (neon) {
    // step C6n: the tube's cross-section: white-hot along its centre line, its colour toward its edges
    var prof = clamp(1.0 - abs(ein2 - 0.5 * lw) / max(0.5 * lw, 1e-3), 0.0, 1.0);
    if (D.lip.x > 0.5) { prof = pow(prof, 1.0 + 3.0 * D.lip.z * oily); }   // step C12b: oil, a sharper, glossier core
    lineCol = mix(lineCol, vec3f(max(max(lineCol.r, lineCol.g), lineCol.b)), D.neon.z * prof * prof);
    lineCol = mix(lineCol, vec3f(1.0), 0.6 * D.neon.z * prof * prof * prof);
  }
  // step 7: the cell's state as a flat bar through its centre, turned by 180 / states degrees per state (2 states:
  // upright and lying; 3: three directions 60 degrees apart), drawn over the dots like a print mark
  var bar = 0.0;
  var clearA = 0.0;
  if (D.states > 0.0) {
    let n = u32(D.states);
    let th = f32(cell_state(c.la, c.flags, n)) * 3.14159265 / f32(n) + 1.5707963;
    let dir = vec2f(cos(th), sin(th));
    let along = abs(lp.x * dir.x + lp.y * dir.y);     // (the builtin dot() is shadowed above)
    let across = abs(lp.y * dir.x - lp.x * dir.y);
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
      let t = clamp(lp.x * dir.x + lp.y * dir.y, 0.0, len);
      let hd = length(lp - dir * t);
      hnd = cover(max(0.11 * c.r, 0.6 / D.dpr), hd, aa);
      rgb = mix(rgb, select(D.pInk.rgb, col * D.line, clock) * abs(D.hand), hnd);
    }
  }
  // step C6d, the machinery: an arrow across a polarised cell from its - end to its + end (its length with the dipole), the
  // shaft from the - ink to the + ink, a small head at the + end
  if (D.dip.y > 0.0 && dipm > 0.15 && c.r * D.dpr > 4.0) {
    let u = dipv / dipm;
    let L = 1.1 * c.r * sqrt(min(dipm, 1.0));
    let along = pw.x * u.x + pw.y * u.y;
    let across = abs(pw.y * u.x - pw.x * u.y);
    let hl = 0.35 * c.r;                                         // the head's length
    let sw = max(0.09 * c.r, 0.5 / D.dpr);
    let shaft = cover(sw, length(vec2f(max(abs(along + 0.5 * hl) - 0.5 * (L - hl), 0.0), across)), aa);
    let ht = 0.5 * L - along;                                   // the head: a triangle from the tip back hl
    let head = select(0.0, cover(0.0, across - 0.6 * hl * clamp(ht / hl, 0.0, 1.0), aa) * cover(0.0, -ht, aa) * cover(hl, ht, aa), ht < hl + aa);
    let ar = max(shaft, head);
    if (ar > 0.0) {
      let tint = mix(D.qNeg.rgb, D.qPos.rgb, clamp(along / max(L, 1e-3) + 0.5, 0.0, 1.0));
      rgb = mix(rgb, mix(tint, vec3f(1.0), 0.25) * D.dip.y, ar);
      hnd = max(hnd, ar);
    }
  }
  // step C10, the machinery: a small tick from inside the cell toward its FRONT (the direction its wall pattern hangs on)
  if (D.wall.w > 0.0 && c.r * D.dpr > 4.0) {
    let uf = vec2f(cos(c.front), sin(c.front));
    let along = pw.x * uf.x + pw.y * uf.y;
    let across = abs(pw.y * uf.x - pw.x * uf.y);
    let tk = cover(max(0.07 * c.r, 0.5 / D.dpr), length(vec2f(max(abs(along - 0.62 * c.r) - 0.2 * c.r, 0.0), across)), aa);
    if (tk > 0.0) {
      rgb = mix(rgb, mix(col, vec3f(1.0), 0.35) * D.wall.w, tk);
      hnd = max(hnd, tk);
    }
  }
  // step C7: the pumps as parts on the membrane. Slot 1 sits on sides 0, 2, 4, slot 2 on sides 1, 3, 5 (a pump works on every
  // side; the marks only say what it is): at each side's middle a small notch in the substance's ink, a triangle just inside
  // the tube pointing IN (its tip toward the centre) or OUT (its tip on the tube), its size with the rate, and the tube there
  // tinted toward the ink. The machinery adds the membrane voltage as a faint rim just inside the tube, rose for + and blue
  // for - (the charge's inks)
  var notch = 0.0;
  if (D.pump.x > 0.5) {
    let slot = side & 1u;
    let code = select(g.pump.x, g.pump.y, slot == 1u);
    let rate = select(g.pump.z, g.pump.w, slot == 1u);
    if (rate >= 0.05) {
      var mid = (f32(side) + 0.5) * P3 * c.r;                       // an ellipse cell: the side's middle along the arc
      if (in.hh1.w > 0.5) {
        let tmv = array<f32, 6>(in.tm0.x, in.tm0.y, in.tm0.z, in.tm0.w, in.tm1.x, in.tm1.y);
        mid = tmv[min(side, 5u)];
      }
      let u = abs(sd.y - mid);
      let h = D.pump.y * c.r * sqrt(clamp(rate / max(D.pump2.x, 1e-3), 0.15, 1.0));
      if (h * D.dpr > 0.5) {
        let dep = 1.6 * h;
        let y = ein2 - lw;                                           // depth inside the tube's inner edge
        let out = pump_out(code);
        let hw = select(h * (1.0 - y / dep), h * (y / dep), out);    // IN: tip inward; OUT: tip on the tube
        let sdf = max(u - hw, max(-y - 0.5 * lw, y - dep));
        let ink = D.pumpInk[pump_ch(code)].rgb;
        notch = cover(0.0, sdf, aa);
        var nk = ink;
        if (neon) { nk = mix(ink, vec3f(1.0), 0.5 * D.neon2.z * clamp(1.0 - u / max(h, 1e-3), 0.0, 1.0)); }
        rgb = mix(rgb, nk, notch);
        // the tube's segment at the notch takes the ink
        lineCol = mix(lineCol, ink * max(D.line, 0.8), D.pump2.y * cover(h, u, aa));
      }
    }
  }
  if (D.pump.z > 0.0 && abs(c.volt) > 0.02) {
    let vr = clamp(abs(c.volt) / max(D.pump.w, 1e-4), 0.0, 1.0);
    let g0 = lw + max(0.6, 0.4 * lw);
    let w2 = max(0.6 * lw, 0.6 / D.dpr);
    let rim = clamp(min(ein2 - g0, g0 + w2 - ein2) / aa + 0.5, 0.0, 1.0) * (1.0 - notch);
    rgb = mix(rgb, select(D.qNeg.rgb, D.qPos.rgb, c.volt > 0.0), rim * D.pump.z * vr);
  }
  // step C6c: the membrane's dimming and flicker, the heavy membrane's inner tube, a burst's flash (white, fading over
  // BURST_TICKS, the inside lit for a moment)
  lineCol *= mDim;
  if (ring2 > 0.0) { rgb = mix(rgb, lineCol * inner, ring2); }
  if (bt != 0u && D.memb2.y > 0.0) {
    let fa = 1.0 - f32(bt - 1u) / f32(BURST_TICKS);
    lineCol = mix(lineCol, vec3f(1.0), fa) * (1.0 + D.memb2.y * fa);
    rgb += col * 0.25 * D.memb2.y * fa * fa;
  }
  // step C9: a division's flash: both tubes white-hot for a moment (Bio.env.y: the flash still to run), fading quickly
  if (D.div.x > 0.0 && g.env.y > 0.0) {
    let fd = clamp(g.env.y / max(D.div.y, 1e-3), 0.0, 1.0);
    let f2 = fd * fd;
    lineCol = mix(lineCol, vec3f(1.0), 0.7 * f2) * (1.0 + D.div.x * f2);
    rgb += col * 0.1 * D.div.x * f2;
  }
  rgb = mix(rgb, lineCol, ring);
  // step C12b: the wall's rim of crust, outside the tube: flat bricks (about lip2.y r long with thin joints), present where this
  // side's wall is (a brick shows when its hash is below the side's cover), amber for a light crust, brown for a heavy one
  var rimA = 0.0;
  if (wOff > 0.0 && lq.w > 0.02) {
    let bl = max(D.lip2.y * c.r, 2.0);
    let u = sd.y / bl + f32(c.seed & 15u) / 16.0;
    let bi = floor(u);
    let bh = fract(sin(bi * 12.9898 + f32(side) * 78.233 + f32(c.seed & 1023u)) * 43758.547);
    let fu = fract(u);
    let joint = clamp(min(fu, 1.0 - fu) * bl / aa - 0.4, 0.0, 1.0);
    rimA = (1.0 - cover_in(ein2, aa)) * cover_in(ein - 0.15 * wOff, aa) * joint * select(0.0, 1.0, bh < lq.w);
    let ck = mix(D.lipInk[0].rgb, D.lipInk[1].rgb, lq.y) * D.lip2.x;
    rgb = mix(rgb, ck, rimA);
  }
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
  // step C9: a starving cell (division mode) fades out as its starvation time runs down, and dies when it is over
  let fade = D.div.z * smoothstep(0.0, 1.0, g.env.x * D.div.w);
  rgb *= 1.0 - fade;
  // step C6n: the hum (1 when it is off or the look is flat)
  rgb *= hum_bright(c, in.id);
  let a = (1.0 - 0.6 * fade) * disc * mix(D.fillA, 1.0, max(max(max(max(max(max(max(max(max(ring, ring2), dot * (1.0 - clearA)), mark), bar), hnd), coreA), partA), notch), rimA));
  // rgb is the colour as seen; blend premultiplied (one, one-minus-src-alpha)
  return vec4f(rgb * a, a);
}
