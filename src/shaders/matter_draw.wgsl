// Matter (Part C, step C3): the dish's substances as crisp halftone dots ON THE MEDIUM LATTICE, and the springs'
// markers. field_common.wgsl is prepended (src/matter.js), for the medium's lattice.
//
// The dot screen is the medium's own lattice (its spacing a = 2 / sqrt 3 x the medium's period, turned with it as it
// breathes), every `step` lattice spacings. A triangular lattice has three interleaved sets of points: the lattice
// points and the centres of its two kinds of triangles. Each set carries one layer, so the layers never sit on each
// other:
//   lattice points       FREE ATOMS: a flat dot whose area grows with the amount (c / (c + half)), its ink from the
//                        mix there: reactive atoms (givers, takers) red, linkers dim grey-blue; lighter for row 1,
//                        deeper for row 2
//   up triangles         FUELS (made by the chemistry from C4 on): green dots, lighter for the light fuels
//   down triangles       TRACE: small pale diamonds
//   everywhere           SEDIMENT (C4 on): not dots but a flat, dim layer in three crisp levels, under the dots
// With Shift+S showing one substance alone, src/matter.js paints only that one into the textures, so the same code draws it.
// Amounts come from two small textures at the heat grid's size (matter.wgsl's paint), read with linear filtering at
// each dot's centre (one read per dot, as print reads the image once per screen cell).
// Spring markers: a crisp ring in the spring's ink (thicker for a heavy spring) and a centre dot that shrinks as the
// spring dries up; dots touching the ring or the centre dot are left out whole (a keyline, as the old source markers).
// Edges are anti-aliased over about one device pixel; the output is premultiplied, blended "over".
// Step C6n, DUST (D.style = 1, the default): the substances as MATERIAL instead of a dot screen. A fine grid of squares
// fixed in the dish (D.dust.x CSS px); each square holds at most one speck of each kind, at a place jittered by a hash of
// the square (so nothing moves or flickers), present when another hash lies below the kind's coverage there (so the
// number of specks follows the amount), its radius growing a little with the amount: fuel as green glow-dust, free atoms
// fainter (red to grey-blue by their mix), trace as rare small bright sparks. A pixel looks at the 2 x 2 squares nearest
// it (a speck is smaller than half a square), reading the amounts once per square at its centre. Sediment stays the
// solid crust below. Under the neon look a speck is brighter at its centre (a tiny lamp; src/neon.js adds the halo).
// Step C12, OIL (both styles, over the sediment, under the dust): from a third texture (matter.wgsl's paint: the oil's share
// rho, the amphiphiles' film share, polar and apolar atoms per R^2), read bilinear, so the outlines follow the grid smoothly:
//   oil film     where the oil's share is above a half: a dark glossy film (it darkens the ripples under it), with a soft
//                sheen just inside its rim on the side facing the light (up and left), and the RIM as one thin bright line
//                whose hue drifts slowly along it and in time (an oil slick's iridescence); dissolved oil (a share below a
//                half) is only a faint haze
//   soap film    the amphiphiles' film share at a half drawn as thin pearly lines: a film one or two pixels wide shows as
//                two close lines (a bilayer's look), a blob of soap as a ring
//   polarity     (machinery, src/oil.js params.polarity) polar matter washed warm, apolar cool, flat and faint
// The lines' widths come from the share's slope per screen pixel (dpdx, dpdy: sampled at the top of fs, where the control
// flow is uniform), so they stay one or two device pixels wide at any zoom.
// Step C12c, the EXCITED HAZE (both styles, over the dust): from a fourth texture (the excited atoms per R^2), a sparse
// glitter of tiny hot red-orange sparks, hotter and whiter than the old threat red of the free atoms; each spark flickers
// on its own phase, and as the haze fades (the atoms relax) the sparks thin out and dim. Not busy: a spark per grid square at
// most, and fewer where there is less.
// Step C12d, ELECTRONS (the same fourth texture: y the minerals per R^2, z of which heavy; x and w what each pixel re-emits as
// fluorescence per tick in visible 1 and visible 2, heat counts): the settled MINERALS as quiet dust (water-like gt a cool slate,
// rust-like Gt rust), and the FLUORESCENCE as a soft glow of tiny lights, like a fluorescence microscope image: in the colour of
// the band each emits (visible 1 gold, visible 2 sky blue), as many as the share of the light re-emitted there says (at most one of
// each colour per grid square, at hashed places, so nothing flickers), each a small bright core in a soft halo. Steady: an excited
// state lives far shorter than a frame. Not busy: only where light falls on something whose gap it matches.

struct DrawP {
  dpr: f32,
  step: f32,          // dot spacing, in medium lattice spacings
  maxDot: f32,        // largest dot radius as a share of half the distance between two layers' neighbouring dots
  half: f32,          // amount per R^2 at which a dot covers half its largest area
  gridPx: f32,        // CSS px per grid pixel
  gw: f32,            // grid size (pixels)
  gh: f32,
  thresh: f32,        // coverage below which there is no dot
  nSprings: u32,
  sedStep: f32,       // sediment: amount per R^2 per flat level
  sedAlpha: f32,      // sediment: opacity of the top level
  ringR: f32,         // spring marker radius (CSS px)
  level: f32,         // the inks' brightness
  traceDot: f32,      // trace diamonds' size, as a share of a full dot
  style: f32,         // step C6n: 0 = halftone on the medium lattice, 1 = dust (material)
  neon: f32,          // step C6n: 1 = the neon look (the specks and dots get a brighter centre)
  reactL: vec4f,      // inks: reactive free atoms (row 1, row 2), linkers, fuels, sediment, trace
  reactH: vec4f,
  linkL: vec4f,
  linkH: vec4f,
  fuelL: vec4f,
  fuelH: vec4f,
  sedL: vec4f,
  sedH: vec4f,
  trace: vec4f,
  dust: vec4f,        // step C6n, dust: x the grid's square (CSS px), y z a speck's radius at a small and a large amount,
                      // w the free atoms' brightness (share of the fuel's)
  // step C12, the oil's look (src/oil.js params)
  oil: vec4f,         // x 1 = drawn; y the rim's width (device px); z time (s, for the iridescence); w iridescence
  oil2: vec4f,        // x the film's darkness (alpha); y gloss; z the soap lines' brightness; w the polarity wash (0 = off)
  film: vec4f,        // inks: the film, its rim, the soap lines, polar, apolar (rgb)
  edge: vec4f,
  amph: vec4f,
  polP: vec4f,
  polA: vec4f,
  // step C12c, the excited haze (src/excited.js look)
  exc: vec4f,         // x 1 = drawn; y how many sparks per amount (x the coverage); z the flicker's speed (1/s); w brightness
  excInk: vec4f,      // rgb: the sparks' hot red-orange; w: a spark's radius (CSS px)
  // step C12d, electrons (src/electrons.js look)
  el: vec4f,          // x 1 = on (texD holds minerals and glow); y 1 / the full day's light per pixel per tick (the glow's scale);
                      // z the glow's density (lights per share of the light re-emitted; 0 = not drawn); w its brightness
  minL: vec4f,        // rgb the light mineral's ink (gt); w the minerals' brightness (share of the fuel's)
  minH: vec4f,        // rgb the heavy mineral's ink (Gt, rust)
  glow1: vec4f,       // rgb visible 1's colour (gold); w a light's core radius (CSS px)
  glow2: vec4f,       // rgb visible 2's colour (sky blue); w the halo's strength
};

struct Spring {
  pos: vec4f,         // x, y (CSS px), radius of its disc (CSS px), share of its life left
  amt: array<vec4f, 5>,
  ink: vec4f,         // rgb, ring stroke (CSS px)
};
struct Springs { s: array<Spring, 16>, };

@group(0) @binding(0) var<uniform> medium: Medium;
@group(0) @binding(1) var<uniform> D: DrawP;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<uniform> SP: Springs;
@group(0) @binding(6) var texC: texture_2d<f32>;   // step C12: oil share, film share, polar, apolar
@group(0) @binding(7) var texD: texture_2d<f32>;   // step C12c: the excited atoms (x)

struct VSOut { @builtin(position) pos: vec4f, };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(f32((vi << 1u) & 2u) * 2.0 - 1.0, f32(vi & 2u) * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// nearest point of the triangular lattice of spacing p (rows along x) to u: the union of two rectangular grids
fn tri_point(u: vec2f, p: f32) -> vec2f {
  let cell = vec2f(p, p * 1.7320508);
  let a = round(u / cell) * cell;
  let b = (round(u / cell - 0.5) + 0.5) * cell;
  return select(b, a, dot(u - a, u - a) <= dot(u - b, u - b));
}

fn disc(d: f32, r: f32) -> f32 { return clamp((r - d) * D.dpr + 0.5, 0.0, 1.0); }
fn over(top: vec4f, under: vec4f) -> vec4f { return top + under * (1.0 - top.a); }
fn uv_of(w: vec2f) -> vec2f { return w / (D.gridPx * vec2f(D.gw, D.gh)); }
fn cover(c: f32) -> f32 {
  let k = c / (c + D.half);
  return select(0.0, k, k >= D.thresh);
}

fn hash3(p: vec2f, k: f32) -> vec3f {
  var q = fract(vec3f(p.x, p.y, k) * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

// one speck: coverage-weighted premultiplied colour at x (centre c, radius r, ink)
fn speck(x: vec2f, c: vec2f, r: f32, ink: vec3f) -> vec4f {
  let d = length(x - c);
  let a = disc(d, r);
  if (a <= 0.0) { return vec4f(0.0); }
  let hot = select(1.0, 1.0 + 0.7 * clamp(1.0 - d / max(r, 1e-3), 0.0, 1.0), D.neon > 0.5);
  return vec4f(ink * hot, 1.0) * a;
}

// step C6n: the substances as dust (see the top of this file); `under` holds the sediment
fn dust(x: vec2f, under: vec4f) -> vec4f {
  var res = under;
  let cs = D.dust.x;
  let base = floor(x / cs - 0.5);
  for (var k = 0; k < 4; k++) {
    let g = base + vec2f(f32(k & 1), f32(k >> 1));
    let centre = (g + 0.5) * cs;
    let va = textureSampleLevel(texA, samp, uv_of(centre), 0.0);
    let vb = textureSampleLevel(texB, samp, uv_of(centre), 0.0);
    // free atoms: faint
    let ca = cover(va.x);
    if (ca > 0.0) {
      let h = hash3(g, 1.0);
      if (h.z < ca) {
        let rs = clamp(va.y / va.x, 0.0, 1.0);
        let hs = clamp(va.z / va.x, 0.0, 1.0);
        let ink = mix(mix(D.linkL.rgb, D.linkH.rgb, hs), mix(D.reactL.rgb, D.reactH.rgb, hs), rs) * D.level * D.dust.w;
        res = over(speck(x, (g + h.xy) * cs, mix(D.dust.y, D.dust.z, ca) * 0.8, ink), res);
      }
    }
    // fuel: green glow-dust
    let cf = cover(vb.x);
    if (cf > 0.0) {
      let h = hash3(g, 2.0);
      if (h.z < cf) {
        let ink = mix(D.fuelL.rgb, D.fuelH.rgb, clamp(vb.y / vb.x, 0.0, 1.0)) * D.level;
        res = over(speck(x, (g + h.xy) * cs, mix(D.dust.y, D.dust.z, cf), ink), res);
      }
    }
    // step C12d: minerals, quiet dust (slate water, rust)
    if (D.el.x > 0.5) {
      let vd = textureSampleLevel(texD, samp, uv_of(centre), 0.0);
      let cm = cover(vd.y);
      if (cm > 0.0) {
        let h = hash3(g, 7.0);
        if (h.z < cm) {
          let ink = mix(D.minL.rgb, D.minH.rgb, clamp(vd.z / max(vd.y, 1e-6), 0.0, 1.0)) * D.level * D.minL.w;
          res = over(speck(x, (g + h.xy) * cs, mix(D.dust.y, D.dust.z, cm) * 0.85, ink), res);
        }
      }
    }
    // trace: rare small sparks
    let ct = cover(va.w);
    if (ct > 0.0) {
      let h = hash3(g, 3.0);
      if (h.z < 0.35 * ct) {
        let q = abs(x - (g + h.xy) * cs);
        let r = D.dust.z * 1.1;
        res = over(vec4f(D.trace.rgb * D.level * 1.2, 1.0) * disc((q.x + q.y) * 0.7071, r * 0.7071), res);
      }
    }
  }
  return res;
}

// step C12c: the excited haze (see the top of this file): one spark per grid square at most, at a hashed place, present while
// another hash lies below the coverage, flickering on its own phase (time in D.oil.z), dimmer where there is less
fn sparkle(x: vec2f, under: vec4f) -> vec4f {
  var res = under;
  let cs = D.dust.x * 1.6;
  let base = floor(x / cs - 0.5);
  for (var k = 0; k < 4; k++) {
    let g = base + vec2f(f32(k & 1), f32(k >> 1));
    let v = textureSampleLevel(texD, samp, uv_of((g + 0.5) * cs), 0.0).x;
    let cv = cover(v * D.exc.y);
    if (cv <= 0.0) { continue; }
    let h = hash3(g, 5.0);
    if (h.z >= cv) { continue; }
    let ph = hash3(g, 6.0);
    let fl = 0.35 + 0.65 * max(sin(D.exc.z * D.oil.z * (0.7 + 0.6 * ph.x) + 6.2831853 * ph.y), 0.0);
    let c = (g + h.xy) * cs;
    let d = length(x - c);
    let r = D.excInk.w * (0.6 + 0.6 * cv);
    let a = disc(d, r);
    if (a <= 0.0) { continue; }
    let hot = 1.0 + 0.8 * clamp(1.0 - d / max(r, 1e-3), 0.0, 1.0) * D.neon;
    let ink = mix(D.excInk.rgb, vec3f(1.0, 0.95, 0.85), 0.25 * D.neon * clamp(1.0 - d / max(r, 1e-3), 0.0, 1.0));
    res = over(vec4f(ink * hot * D.exc.w * D.level * (0.4 + 0.6 * cv) * fl, 1.0) * a * fl, res);
  }
  return res;
}

// step C12d: the fluorescence glow (see the top of this file): per grid square at most one tiny light of each emitted band, at a
// hashed place, present while another hash lies below its coverage (the share of the light re-emitted there x the density), a
// small bright core in a soft halo, brighter where more is re-emitted
fn glow(x: vec2f, under: vec4f) -> vec4f {
  var res = under;
  let cs = D.dust.x * 1.3;
  let base = floor(x / cs - 0.5);
  for (var k = 0; k < 4; k++) {
    let g = base + vec2f(f32(k & 1), f32(k >> 1));
    let v = textureSampleLevel(texD, samp, uv_of((g + 0.5) * cs), 0.0);
    for (var j = 0; j < 2; j++) {
      let e = select(v.w, v.x, j == 0) * D.el.y * D.el.z;
      let cv = e / (e + 1.0);
      if (cv < 0.02) { continue; }
      let h = hash3(g, 11.0 + f32(j));
      if (h.z >= cv) { continue; }
      let ink = select(D.glow2.rgb, D.glow1.rgb, j == 0);
      let c = (g + h.xy) * cs;
      let d = length(x - c);
      let r = D.glow1.w * (0.7 + 0.6 * cv);
      let core = disc(d, r);
      let halo = D.glow2.w * cv * exp(-d * d / (9.0 * r * r));
      let a = clamp(max(core, halo), 0.0, 1.0);
      if (a <= 0.0) { continue; }
      let hot = 1.0 + 0.6 * core * D.neon;
      res = over(vec4f(mix(ink, vec3f(1.0), 0.3 * core * D.neon) * hot * D.el.w * (0.45 + 0.55 * cv), 1.0) * a, res);
    }
  }
  return res;
}

// step C12: an anti-aliased line of width w (device px) where the share s crosses `at`, from its slope g per device px
fn iso_line(s: f32, g: vec2f, at: f32, w: f32) -> f32 {
  let d = (s - at) / max(length(g), 1e-5);
  return clamp(0.5 * w + 0.5 - abs(d), 0.0, 1.0);
}

// step C12: the oil's layer (see the top of this file); so, sf: the oil's and the film's share here, gO, gF their slopes
fn oil_layer(x: vec2f, oc: vec4f, gO: vec2f, gF: vec2f) -> vec4f {
  var res = vec4f(0.0);
  let so = oc.x;
  let sf = oc.y;
  // polarity view: flat faint washes, warm for polar matter, cool for apolar
  if (D.oil2.w > 0.0) {
    let wp = D.oil2.w * clamp(oc.z / (oc.z + 1.0), 0.0, 1.0);
    let wa = D.oil2.w * clamp(oc.w / (oc.w + 1.0), 0.0, 1.0);
    res = over(vec4f(D.polA.rgb, 1.0) * wa, res);
    res = over(vec4f(D.polP.rgb, 1.0) * wp, res);
  }
  if (so > 0.02) {
    let gl = max(length(gO), 1e-5);
    let d = (min(so, 1.0) - 0.5) / gl;                  // signed distance to the rim, device px (positive inside)
    let inside = clamp(d + 0.5, 0.0, 1.0);
    // dissolved oil: a faint haze; the film: dark, with a sheen inside the rim on the side facing the light
    let haze = 0.12 * D.oil2.x * smoothstep(0.05, 0.5, so) * (1.0 - inside);
    var film = vec4f(D.film.rgb, 1.0) * (D.oil2.x * inside + haze);
    let nrm = -gO / gl;                                  // outward
    let face = max(dot(nrm, vec2f(-0.6, -0.8)), 0.0);
    let sheen = D.oil2.y * inside * face * exp(-max(d, 0.0) / (9.0 * D.dpr));
    film = vec4f(film.rgb + D.edge.rgb * sheen * 0.6, film.a);
    res = over(film, res);
    // the rim: a thin line, its hue drifting along it and in time (an oil slick)
    let rim = clamp(0.5 * D.oil.y + 0.5 - abs(d), 0.0, 1.0);
    if (rim > 0.0) {
      let h = fract(0.035 * D.oil.z + 0.0045 * (x.x - 0.6 * x.y) + 0.16 * atan2(nrm.y, nrm.x));
      let rainbow = 0.55 + 0.45 * cos(6.2831853 * (vec3f(h) + vec3f(0.0, 0.33, 0.67)));
      let col = mix(D.edge.rgb, rainbow * 1.15, D.oil.w);
      let core = clamp(1.0 - abs(d) / max(0.35 * D.oil.y, 0.5), 0.0, 1.0);
      res = over(vec4f(mix(col, vec3f(1.0), 0.35 * core * D.neon), 1.0) * rim, res);
    }
  }
  // the soap: thin pearly lines where the film's share is a half, a faint pearl inside
  // (soap dissolved deep inside the oil is not drawn: it shows on the rims and in the water)
  let inOil = 1.0 - smoothstep(0.75, 1.0, so);
  if (sf > 0.05 && D.oil2.z > 0.0 && inOil > 0.0) {
    let ln = iso_line(sf, gF, 0.5, 0.8 * D.oil.y) * inOil;
    let fill = 0.1 * smoothstep(0.45, 0.8, sf) * inOil;
    let h = fract(0.05 * D.oil.z + 0.006 * (x.y - x.x));
    let pearl = mix(D.amph.rgb, 0.8 + 0.2 * cos(6.2831853 * (vec3f(h) + vec3f(0.0, 0.33, 0.67))), 0.3);
    res = over(vec4f(pearl * D.oil2.z, 1.0) * max(ln, fill), res);
  }
  return res;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let x = in.pos.xy / D.dpr;                         // CSS px
  // step C12: the oil's texture and its slopes, here, while the control flow is uniform (derivatives need it)
  let oc = textureSampleLevel(texC, samp, uv_of(x), 0.0);
  let gO = vec2f(dpdx(min(oc.x, 1.0)), dpdy(min(oc.x, 1.0)));   // (a full pixel and more is the film's inside: no slope)
  let gF = vec2f(dpdx(oc.y), dpdy(oc.y));
  // sediment: flat patches with HARD edges, in three crisp levels. The amount is sampled (bilinear, so the patch's
  // outline follows the grid smoothly instead of in blocks) and then thresholded per screen pixel with no smoothing at
  // all, so every edge is a clean step (step C5's look fix: the C4 version anti-aliased each level along the slope of
  // the amount, which on a gentle crust spread each edge over several pixels and read as a soft blurred disc).
  // Two levels: the patch (from sedStep) and a lighter, thicker core (from 4 x sedStep), so a crust reads as one flat
  // shape with a clear inner shape, not as a stack of faint rings.
  let sed = textureSampleLevel(texB, samp, uv_of(x), 0.0);
  let lv = sed.z / D.sedStep;
  var res = vec4f(0.0);
  if (lv >= 1.0) {
    let core = lv >= 4.0;
    let ink = mix(D.sedL.rgb, D.sedH.rgb, clamp(sed.w / max(sed.z, 1e-6), 0.0, 1.0)) * select(1.0, 1.4, core);
    let al = D.sedAlpha * select(0.8, 1.0, core);
    res = vec4f(ink * al, al);
  }
  if (D.oil.x > 0.5) { res = over(oil_layer(x, oc, gO, gF), res); }   // step C12
  if (D.style > 0.5) {
    // step C6n: dust, and the springs' markers over it
    var mk = vec4f(0.0);
    for (var k = 0u; k < D.nSprings; k++) {
      let s = SP.s[k];
      let rr = D.ringR;
      let rc = 0.32 * rr * sqrt(clamp(s.pos.w, 0.0, 1.0)) + 0.6;
      let d = length(x - s.pos.xy);
      let a = max(disc(abs(d - rr), 0.5 * s.ink.w), disc(d, rc));
      mk = over(vec4f(s.ink.rgb, 1.0) * a, mk);
    }
    var dres = dust(x, res);
    if (D.exc.x > 0.5) { dres = sparkle(x, dres); }   // step C12c
    if (D.el.x > 0.5 && D.el.z > 0.0) { dres = glow(x, dres); }   // step C12d
    return over(mk, dres);
  }

  // the medium's lattice: spacing 2 / sqrt 3 x its period, rows along la0 + 30 degrees
  let p = D.step * 2.0 * (TAU / medium.k0) / 1.7320508;
  let ang = medium.la0 + 0.5 * P3;
  let o = medium.centre;
  let u = rot(x - o, -ang);
  let rmax = D.maxDot * 0.5 * p / 1.7320508;          // half the distance between neighbouring dots of two layers
  let offB = vec2f(0.5 * p, 0.5 * p / 1.7320508);     // centre of an up triangle
  let offC = vec2f(0.0, p / 1.7320508);               // centre of a down triangle
  let cA = tri_point(u, p);
  let cB = tri_point(u - offB, p) + offB;
  let cC = tri_point(u - offC, p) + offC;
  let wA = rot(cA, ang) + o;
  let wB = rot(cB, ang) + o;
  let wC = rot(cC, ang) + o;

  // keyline: dots whose centre lies on a spring's ring or centre dot are dropped whole
  var keyA = false;
  var keyB = false;
  var keyC = false;
  var mark = vec4f(0.0);
  for (var k = 0u; k < D.nSprings; k++) {
    let s = SP.s[k];
    let rr = D.ringR;
    let rc = 0.32 * rr * sqrt(clamp(s.pos.w, 0.0, 1.0)) + 0.6;
    let kw = 0.5 * s.ink.w + rmax + 1.0;
    let dA = length(wA - s.pos.xy);
    let dB = length(wB - s.pos.xy);
    let dC = length(wC - s.pos.xy);
    keyA = keyA || abs(dA - rr) < kw || dA < rc + rmax + 1.0;
    keyB = keyB || abs(dB - rr) < kw || dB < rc + rmax + 1.0;
    keyC = keyC || abs(dC - rr) < kw || dC < rc + rmax + 1.0;
    let d = length(x - s.pos.xy);
    let a = max(disc(abs(d - rr), 0.5 * s.ink.w), disc(d, rc));
    mark = over(vec4f(s.ink.rgb, 1.0) * a, mark);
  }

  // free atoms on the lattice points
  if (!keyA) {
    let v = textureSampleLevel(texA, samp, uv_of(wA), 0.0);
    let cov = cover(v.x);
    if (cov > 0.0) {
      let rs = clamp(v.y / v.x, 0.0, 1.0);             // reactive share
      let hs = clamp(v.z / v.x, 0.0, 1.0);             // heavy share
      let ink = mix(mix(D.linkL.rgb, D.linkH.rgb, hs), mix(D.reactL.rgb, D.reactH.rgb, hs), rs) * D.level;
      res = over(vec4f(ink, 1.0) * disc(length(u - cA), rmax * sqrt(cov)), res);
    }
  }
  // fuels on the up triangles' centres
  if (!keyB) {
    let v = textureSampleLevel(texB, samp, uv_of(wB), 0.0);
    let cov = cover(v.x);
    if (cov > 0.0) {
      let ink = mix(D.fuelL.rgb, D.fuelH.rgb, clamp(v.y / v.x, 0.0, 1.0)) * D.level;
      res = over(vec4f(ink, 1.0) * disc(length(u - cB), rmax * sqrt(cov)), res);
    }
  }
  // trace on the down triangles' centres: small diamonds (step C12d: where there is no trace, the minerals' dots)
  if (!keyC) {
    let v = textureSampleLevel(texA, samp, uv_of(wC), 0.0);
    let cov = cover(v.w);
    if (cov > 0.0) {
      let q = abs(u - cC);
      let r = D.traceDot * rmax * 1.25 * sqrt(cov);
      res = over(vec4f(D.trace.rgb * D.level, 1.0) * disc((q.x + q.y) * 0.7071, r * 0.7071), res);
    } else if (D.el.x > 0.5) {
      let vd = textureSampleLevel(texD, samp, uv_of(wC), 0.0);
      let cm = cover(vd.y);
      if (cm > 0.0) {
        let ink = mix(D.minL.rgb, D.minH.rgb, clamp(vd.z / max(vd.y, 1e-6), 0.0, 1.0)) * D.level;
        res = over(vec4f(ink, 1.0) * disc(length(u - cC), rmax * sqrt(cm)), res);
      }
    }
  }
  if (D.exc.x > 0.5) { res = sparkle(x, res); }   // step C12c
  if (D.el.x > 0.5 && D.el.z > 0.0) { res = glow(x, res); }   // step C12d
  return over(mark, res);
}
