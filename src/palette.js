// Step C6n: every colour the dish is drawn in, in ONE place, as two palettes with the same meanings:
//   FLAT  the faded palette of steps 1 to C6 (crisp flat shapes, no glow): the look with neon off (key E)
//   NEON  the 80s neon-light palette (user, 2026-11-15: "80s neon colour lights, think of video clip graphics"): the same
//         meanings, more lit (hot pink, cyan, violet, ...), drawn as thin bright tubes with a tight halo (src/neon.js)
// Colours are 0..255 sRGB. A colour carries a MEANING (CLAUDE.md, "colour means something"): fate or function, never
// decoration. The layers read the palette in use every frame through pal(), so key E swaps every colour at once.
//
// Meanings:
//   fate[0..4]     a cell's body (outline, tube) by its fate: stem, epithelium, muscle, neuron, cartilage
//   lineage        colour by lineage (key V): the key's hue round the colour wheel, base + amp x cos(hue)
//   band[0..3]     the light bands, by photon energy: warm (heat only), visible 1, visible 2, hard. A harvest engine's
//                  pigment part and the strategy view's harvesters are drawn in their band's colour
//   core           a cell's battery (stored energy): the fuel's pale green
//   burn           a burn engine's part (and the strategy view's burners): the fuel's deeper green
//   swap           a swap engine's part: the reactive free atoms' red
//   sed            a form (sediment) engine's part: dim warm grey-brown, as the crust
//   other          strategy view: a cell that neither harvests nor burns
//   substances     the dish's substances by chemical function, a lighter row-1 and a deeper row-2 variant each:
//                  reactive free atoms (givers, takers: hungry for partners) red, linkers dim grey-blue, fuels green,
//                  sediment a dark flat crust, trace pale silver. A spring's marker mixes its atoms' inks
//   spot           the spotlight's outline (warm white, as the light)
//   field          the cells' fields drawn as halftone (keys K J ;): A pale warm, B print blue, the partner A' yellow
//   charge         step C6b: the screened charge field's contour lines (machinery): + (givers' excess) a warm rose, - (takers')
//                  an ice blue, the usual colours of an electrostatic map
//   levels         how bright some layers are drawn: substances (the dots' ink), field (A's dots), spot (outline), charge
//   oil            step C12: oil (lL, apolar: water-shy) a cool pale steel blue; amphiphiles (glL, tlL: a charged head on an
//                  oily tail) pearly white, as soap film. In the dish oil is drawn as a dark glossy film with a thin
//                  iridescent rim (the hue drifts slowly along it: an oil slick), amphiphile films as thin pearly lines
//   polarity       step C12, the polarity view (machinery): polar (water-loving) matter warm, apolar (water-shy) cool
//   walls          step C10, the walls view (V): a cell's body by its wall pattern: uniform (grey, as "other"), polar (coral),
//                  two-ended (mint), sticky sides (magenta). Only in that view; elsewhere stickiness shows as tube brightness
//   guides         step C13, the guides view (V): a cell's body by its strongest gate: glue ivory (as a matured junction's whitish
//                  wall), pump teal (transport across the membrane), engine the burn green (energy), division lilac, turn the
//                  partner's yellow (turning, step 8's clock hand), none grey (as "other")

export const FLAT = {
  name: 'flat',
  fate: [[241, 236, 223], [121, 220, 216], [239, 134, 184], [185, 162, 255], [240, 201, 135]],
  lineage: { base: 0.64, amp: 0.26 },
  band: [[226, 138, 110], [236, 188, 104], [138, 190, 238], [212, 186, 250]],
  core: [180, 223, 164],
  burn: [124, 204, 128],
  swap: [232, 128, 112],
  sed: [150, 138, 120],
  other: [118, 112, 106],
  substances: {
    reactive: { light: [250, 170, 150], heavy: [214, 98, 86] },
    linker: { light: [150, 158, 176], heavy: [104, 112, 132] },
    fuel: { light: [196, 242, 178], heavy: [124, 204, 128] },
    sediment: { light: [96, 86, 74], heavy: [74, 64, 56] },
    trace: { light: [222, 222, 232], heavy: [222, 222, 232] },
    oil: { light: [150, 196, 214], heavy: [150, 196, 214] },             // step C12
    amphiphile: { light: [236, 226, 246], heavy: [236, 226, 246] },
  },
  oil: { film: [16, 22, 30], edge: [170, 210, 226], amph: [236, 226, 246] },   // step C12: the film, its rim, the soap lines
  polarity: { polar: [236, 150, 96], apolar: [104, 170, 236] },
  spot: [242, 228, 200],
  field: { A: [241, 236, 223], B: [128, 158, 255], P: [236, 218, 124] },
  charge: { pos: [236, 132, 146], neg: [128, 184, 236] },
  walls: { uniform: [118, 112, 106], polar: [236, 140, 104], ends: [124, 214, 172], sides: [206, 136, 222] },
  guides: { none: [118, 112, 106], glue: [244, 232, 206], pump: [104, 206, 196], engine: [124, 204, 128], div: [196, 168, 240], turn: [236, 218, 124] },
  lipid: { crustLight: [176, 128, 72], crustHeavy: [120, 84, 56], pearl: [236, 226, 246] },   // step C12b: the walls' crust, soap's pearl
  levels: { substances: 0.85, field: 0.32, spot: 0.55, charge: 0.7 },
};

// NEON: the same meanings, lit. Fates as the classic neon-sign gases and coatings: warm white (stem), cyan
// (epithelium), hot pink (muscle), violet (neuron), amber (cartilage). The substances and the field dots are drawn
// QUIETER than the cells (lower levels, and a smaller share of the halo in src/neon.js): the scene is still the cells.
export const NEON = {
  name: 'neon',
  fate: [[226, 176, 138], [24, 232, 255], [255, 46, 158], [158, 92, 255], [255, 158, 24]],
  lineage: { base: 0.5, amp: 0.5 },
  band: [[255, 96, 56], [255, 204, 32], [40, 156, 255], [204, 128, 255]],
  core: [120, 255, 140],
  burn: [30, 228, 96],
  swap: [255, 54, 48],
  sed: [196, 150, 96],
  other: [128, 128, 148],
  substances: {
    reactive: { light: [255, 112, 92], heavy: [255, 40, 64] },
    linker: { light: [112, 140, 214], heavy: [72, 92, 176] },
    fuel: { light: [140, 255, 150], heavy: [32, 226, 104] },
    sediment: { light: [74, 60, 48], heavy: [56, 46, 38] },
    trace: { light: [226, 232, 255], heavy: [226, 232, 255] },
    oil: { light: [120, 200, 236], heavy: [120, 200, 236] },             // step C12
    amphiphile: { light: [246, 232, 255], heavy: [246, 232, 255] },
  },
  oil: { film: [8, 14, 28], edge: [140, 220, 255], amph: [255, 240, 255] },
  polarity: { polar: [255, 128, 56], apolar: [56, 150, 255] },
  spot: [255, 232, 196],
  field: { A: [255, 222, 184], B: [64, 132, 255], P: [255, 226, 64] },
  charge: { pos: [255, 70, 110], neg: [70, 170, 255] },
  walls: { uniform: [128, 128, 148], polar: [255, 110, 60], ends: [60, 255, 170], sides: [255, 60, 230] },
  guides: { none: [128, 128, 148], glue: [255, 240, 214], pump: [24, 230, 200], engine: [30, 228, 96], div: [190, 140, 255], turn: [255, 226, 64] },
  lipid: { crustLight: [200, 128, 44], crustHeavy: [132, 72, 32], pearl: [246, 232, 255] },   // step C12b: the walls' crust, soap's pearl
  levels: { substances: 0.62, field: 0.2, spot: 0.4, charge: 0.55 },
};

/** The look in use: neon (true) or the flat palette (key E; src/neon.js keeps it). */
export const LOOK = { neon: true };

/** The palette in use. */
export function pal() { return LOOK.neon ? NEON : FLAT; }

/** An sRGB 0..255 triple as 0..1. */
export function unit(rgb) { return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]; }
