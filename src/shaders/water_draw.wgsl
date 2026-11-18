// Step N1: the water drawn (src/water.js; light_common.wgsl and water_common.wgsl are prepended). A full-screen triangle under the cells:
//   the CAUSTIC NET  where the light falls (light_factor > 0), the focused light's bright lines, faint: only what is brighter than the
//                    mean shows (smoothstep over the brightness), in the light's own warm white (neon) or a dim cool grey (harmonic:
//                    as if a little of the light were seen too). Worked out per screen pixel from the same surface (water_common.wgsl),
//                    so the lines stay crisp at any zoom; the light the cells get is the heat buffer's block (each pixel's mean)
//   STREAMLINES      (the machinery view only) the currents' stream function's level lines, thin and faint: the water flows along them

struct WDraw {
  hw: u32,
  hh: u32,
  caus: u32,            // word offset of the caustic block in g (0: none)
  cur: u32,             // ... of psi (0: none)
  px: f32,              // CSS px per heat pixel
  dpr: f32,             // device px per CSS px (x the zoom)
  netA: f32,            // the net's brightness (0: not drawn)
  lineA: f32,           // the streamlines' brightness (0: not drawn)
  ink: vec4f,           // the net's colour
  lineInk: vec4f,       // the streamlines' colour
  cam: vec4f,           // the camera (xy pan)
  step: vec4f,          // x psi between two streamlines (px^2 / s); y the line width (CSS px); z the net's threshold; w its top
  sgrid: vec4u,         // step G0: the stirred stream function on the stir grid: word offset in g (0: not drawn), width, height, spacing (f32 bits)
  sstep: vec4f,         // ... x psi between two of its streamlines; y their brightness; z (step G0b) the prescribed lines' offset (in steps)
  sInk: vec4f,          // ... their colour (a pink: the cells' own flow)
};

@group(0) @binding(0) var<uniform> D: WDraw;
@group(0) @binding(1) var<storage, read> g: array<i32>;
@group(0) @binding(2) var<uniform> LP: LightP;
@group(0) @binding(3) var<uniform> W: WaterP;
@group(0) @binding(4) var<storage, read> rip: array<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn psi_px(x: i32, y: i32) -> f32 {
  let q = clamp(vec2i(x, y), vec2i(0), vec2i(i32(D.hw), i32(D.hh)));
  return bitcast<f32>(g[D.cur + u32(q.y) * (D.hw + 1u) + u32(q.x)]);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let x = fc.xy / D.dpr + D.cam.xy;      // CSS px of the dish
  var col = vec3f(0.0);
  var a = 0.0;
  if (D.caus != 0u && D.netA > 0.0) {
    let lf = light_factor(LP, x);
    if (lf > 0.0) {
      let c = caustic_of(swell_curv(x) + rip_curv(x));
      let r = clamp((c - D.step.z) / max(D.step.w - D.step.z, 1e-3), 0.0, 1.0);
      let v = r * sqrt(r) * min(lf, 1.5) * D.netA;   // (a soft power: the lines' cores bright, their skirts faint)
      col += D.ink.rgb * v;
      a += v * D.ink.w;
    }
  }
  if (D.cur != 0u && D.lineA > 0.0) {
    let gp = x / D.px;                   // the corners sit at whole numbers
    let b = floor(gp);
    let f = gp - b;
    let i = vec2i(b);
    let p = mix(mix(psi_px(i.x, i.y), psi_px(i.x + 1, i.y), f.x), mix(psi_px(i.x, i.y + 1), psi_px(i.x + 1, i.y + 1), f.x), f.y);
    let v = p / max(D.step.x, 1e-6) + D.sstep.z;   // (step G0b: half a step off with obstacles, so no line lies on a still island's own value)
    let fw = max(fwidth(v), 1e-6);
    let d = abs(v - round(v)) / fw;      // device px to the nearest line
    let lw = D.step.y * D.dpr;
    var l = 1.0 - smoothstep(0.5 * lw - 0.5, 0.5 * lw + 0.5, d);
    l *= 1.0 - smoothstep(0.25, 0.5, fw);   // crowded lines fade out
    col += D.lineInk.rgb * l * D.lineA;
    a += l * D.lineA * D.lineInk.w;
  }
  // step G0: the cells' STIRRED flow's own streamlines (pink), spaced by its own range (it is much weaker than the prescribed currents)
  if (D.sgrid.x != 0u && D.sstep.y > 0.0) {
    let q0 = x / bitcast<f32>(D.sgrid.w);
    let lim = vec2f(f32(D.sgrid.y - 1u), f32(D.sgrid.z - 1u));
    let inside = select(0.0, 1.0, q0.x >= 0.0 && q0.y >= 0.0 && q0.x < lim.x && q0.y < lim.y);
    let q = clamp(q0, vec2f(0.0), lim - 1e-3);
    let b = vec2u(floor(q));
    let t = q - vec2f(b);
    let o = D.sgrid.x + b.y * D.sgrid.y + b.x;
    let w = D.sgrid.y;
    let p = mix(mix(bitcast<f32>(g[o]), bitcast<f32>(g[o + 1u]), t.x), mix(bitcast<f32>(g[o + w]), bitcast<f32>(g[o + w + 1u]), t.x), t.y);
    let v = p / max(D.sstep.x, 1e-9);
    let fw = max(fwidth(v), 1e-6);   // (in uniform control flow: the bounds only mask the result)
    let d = abs(v - round(v)) / fw;
    let lw = D.step.y * D.dpr;
    var l = 1.0 - smoothstep(0.5 * lw - 0.5, 0.5 * lw + 0.5, d);
    l *= (1.0 - smoothstep(0.25, 0.5, fw)) * inside;
    l *= select(1.0, 0.0, abs(round(v)) < 0.5);   // (the zero line, the still water's, left out)
    col += D.sInk.rgb * l * D.sstep.y;
    a += l * D.sstep.y;
  }
  return vec4f(col, min(a, 1.0));
}
