// App: NEW CULTURES and PRESET DISHES (user 2026-11-16: "create new cultures with more spread and some preset interesting dish
// environments"). Nothing here is a rule of the simulation: a preset is a set of existing URL options plus where its springs and
// light go, so every preset opens by URL (?preset=vent) and can be shared as a link.
//
// URL options (read by src/main.js before anything else; a preset's own options never override the URL's):
//   ?preset=name        vent | fronts | chip | shallows | oxygen | slick | desert | oases | plumes | colonies | lab (PRESETS below; step N1: oases, plumes;
//                       step T1b: colonies)
//   ?spread=clump|scatter|colonies|ring   how the founders are placed (default clump: the old blob at the centre); with any
//                       spread but clump the pull to the dish centre is nearly off (squeeze 0.02), so the culture stays spread
//   ?colonies=N         how many colonies (spread=colonies; default 5)
//   ?ventring=a,b       step M1: a preset's colonies (the Deep vents preset's) as a ring a..b R round each centre instead of a blob
//   ?diversity=clone|few|mixed|random     one genome cloned / one founder of each habit (eater, light + burn, photosynthesiser,
//                       other) / the usual 12 founders (default) / every cell its own random genome. With colonies, colony k is
//                       founder k's
// The NEW CULTURE dialog (the dish panel) sets these and opens the link; with the dish as it is and the same number of cells it
// starts the culture in place instead (no reload: the springs, the light and the atoms stay).

import { HABITS, founderGenome, FOUNDER_MODES } from './genome.js';

const VALUE = (v) => String(v);

/** The presets: a one-line description, URL options, and the scene (springs, light) once the dish's size is known. */
export const PRESETS = {
  vent: {
    label: 'Deep vents',
    desc: 'Deep water in total darkness. Three hot vents pour out free givers (metal-like G, hydrogen-like g) and heat; the sea brings a faint, steady supply of the free taker T everywhere. Where giver meets taker cold, a cell can eat the gradient (G + T, g + T); close to a vent its heat burns it away first. A mineral seep beside each vent brings linkers for membranes. Three colonies of random genomes start on the vents, their batteries just short of dividing. (With &light=full: a faint glow from above, a third of the usual light.)',
    query: { light: 'off', day: 0, clouds: 0, spread: 'colonies', colonies: 3, cells: 600, hotvent: 1, sea: 1, diversity: 'random', starter: 0.55, scarce: 0 },
    // (step N1: scarce=0: the vents' water is rich in metals, so here the vents drip trace as before; no oases)
    centres: (W, H) => ring3(W, H, 0.27, -90),
    // step M1 (Task B): the founders on a RING round each vent (?ventring=inner,outer in R; 0,0 = the old blobs on the vents), where
    // the vent's givers meet the sea's takers cold once the charge field is off (step C12g)
    ring: [8, 20],
    scene({ matter, light, W, H, cells }) {
      light.params.power *= 0.3;   // the faint glow, if the light is switched on (&light=full)
      // step C12f: each vent HOT (src/vents.js: free givers and heat), with a mineral seep beside it (linkers for membranes, and the
      // water-like gt); the sea (?sea=1, the preset's) brings T everywhere. Before step C12f the vent's fuel and metal alone fed
      // nobody in the dark (fermenting earned the culture about 0.001 per s; README "Step C12f: vents in the dark")
      const m = Math.min(W, H);
      // (the dish's size, 2026-11-17: each vent a FISSURE, a line 14 R long across the radius of the dish, dripping 40 / 14 atoms per s
      // per R, and each seep a PATCH 3 R across its radius: the same totals as the old points; ?pointvents=1 the old points)
      const R = cells ? cells.R : 6, point = new URLSearchParams(location.search).get('pointvents') === '1';
      for (const [x, y] of ring3(W, H, 0.27, -90)) {
        const dx = x - W / 2, dy = y - H / 2, d = Math.hypot(dx, dy) || 1;
        const sx = x + dx / d * 0.07 * m, sy = y + dy / d * 0.07 * m;
        if (point) {
          matter.addSpring(x, y, 'heavy', 1e9, { rate: 40 });
          matter.addSpring(sx, sy, 'light', 1e9, { rate: 12 });
        } else {
          matter.addLine(x, y, 'heavy', 14, Math.atan2(dy, dx) * 180 / Math.PI + 90, 40 / 14, 1e9);
          matter.addPatch(sx, sy, 'light', 3, 12 / (Math.PI * 9), 1e9);
        }
      }
    },
  },
  // the dish's size (README "Dish size and densities"): the waves the user saw after shrinking the window, on purpose
  fronts: {
    label: 'Fronts',
    desc: 'A long strip of dish whose right wall slowly presses in and lets go again every four minutes, like the edge of a coverslip pushed and released. The cells in front of it are packed into a dense, bright front that runs into the looser tissue; when the wall lets go the front loosens and scatters, and the next press starts again. (What made the waves after shrinking the window: the walls closing in on the culture.)',
    query: { dish: '396x124', press: '0.45,240', light: 'full', spread: 'scatter' },
    scene({ matter, W, H }) {
      for (const [x, y] of [[0.12, 0.3], [0.3, 0.75], [0.5, 0.3], [0.7, 0.72], [0.88, 0.35]]) matter.addSpring(x * W, y * H, 'light', 1e9);
      matter.addSpring(0.06 * W, 0.8 * H, 'heavy', 1e9, { rate: 3 });
    },
  },
  // the microfluidic chip (the user, 2026-11-17: "maybe the microfluidics chip analogy is better"; src/perfusion.js)
  chip: {
    label: 'Chip',
    desc: 'A microfluidic channel. Fresh medium (minerals, linkers, some fuel and trace) flows in along the left wall, the water drifts slowly to the right, fastest down the middle, and leaves at the right wall with whatever it carries. Cells scattered along the channel, the whole dish lit: who thrives at the fresh inlet, who lives on what is left downstream?',
    query: { dish: '396x124', perfusion: 1, light: 'full', spread: 'scatter', scarce: 0, oases: 0 },
    scene() {},
  },
  shallows: {
    label: 'Sunlit shallows',
    desc: 'The whole dish lit, with days and nights. Mineral springs scattered over it, cells scattered too: light-catchers have it easy.',
    query: { light: 'full', spread: 'scatter' },
    scene({ matter, W, H }) {
      for (const [x, y] of [[0.22, 0.28], [0.75, 0.22], [0.5, 0.55], [0.25, 0.78], [0.8, 0.75]]) matter.addSpring(x * W, y * H, 'light', 1e9);
    },
  },
  oxygen: {
    label: 'Oxygen world',
    desc: 'The oxygen story: a spotlight, a never-drying mineral spring and a slow vent beside the culture, and light cannot free atoms in the open (photolysis off), so any free oxygen (t) is made by life.',
    query: { light: 'spot', photolysis: 0 },
    scene({ matter, light, W, H, cells, hasSpot }) {
      const s = defaultSpots(W, H, cells);
      matter.addSpring(s.a[0], s.a[1], 'light', 1e9);
      matter.addSpring(s.b[0], s.b[1], 'heavy', 1e9, { rate: 0.6 });   // a slow vent (a tenth of a spring's rate)
      if (!hasSpot) light.moveTo(s.spot[0], s.spot[1]);
    },
  },
  slick: {
    label: 'Oil slick',
    desc: 'Oil and soap springs make droplets with iridescent rims and soapy films; a vent and a mineral spring feed the cells, which can take oil and soap into their skins. Lit from the side.',
    query: { light: 'spot', spread: 'colonies', colonies: 4, tilt: 35, cells: 1000 },
    scene({ matter, light, W, H, hasSpot }) {
      matter.addSpring(0.3 * W, 0.3 * H, 'emulsion', 1e9);
      matter.addSpring(0.7 * W, 0.68 * H, 'emulsion', 1e9);
      matter.addSpring(0.68 * W, 0.3 * H, 'soap', 1e9);
      matter.addSpring(0.32 * W, 0.7 * H, 'oil', 1e9);
      matter.addSpring(0.5 * W, 0.14 * H, 'heavy', 1e9);
      matter.addSpring(0.5 * W, 0.86 * H, 'light', 1e9);
      if (!hasSpot) { light.moveTo(0.5 * W, 0.5 * H); light.params.radius = 0.42; }
    },
  },
  desert: {
    label: 'Crust desert',
    desc: 'Springs of single linkers (light l and heavy L) chain into fields of crust that grow on themselves; a vent at the edge and three mineral springs feed a ring of cells, which graze the crust to build their skins and walls.',
    query: { light: 'full', spread: 'ring', cells: 1200 },
    scene({ matter, W, H }) {
      const pts = [[0.2, 0.25, 'l'], [0.4, 0.2, 'L'], [0.62, 0.3, 'l'], [0.8, 0.22, 'L'], [0.28, 0.7, 'L'], [0.5, 0.82, 'l'], [0.72, 0.72, 'L'], [0.85, 0.55, 'l']];
      for (const [x, y, a] of pts) matter.addSpring(x * W, y * H, `drop:${a}`, 1e9, { rate: 14 });
      // food: a vent at the edge and three mineral springs on the ring (without them the ring starves within 3 min)
      matter.addSpring(0.06 * W, 0.5 * H, 'heavy', 1e9);
      for (const a of [-30, 90, 210]) {
        const r = 0.36 * Math.min(W, H), t = a * Math.PI / 180;
        matter.addSpring(W / 2 + Math.cos(t) * r, H / 2 + Math.sin(t) * r, 'light', 1e9);
      }
    },
  },
  // step N1, a nutrient landscape (src/pigments.js, src/oases.js, src/water.js)
  oases: {
    label: 'Oases',
    desc: 'Shallow water in a soft half light, with a moving net of brighter light on the floor. Light is not free: pigments are built from trace, which comes only from four oases that wander, pulse, dry up and rise elsewhere; slow eddies carry it downstream in silver plumes. Mineral springs and a vent feed the cells, scattered over the dish: watch who finds the oases, and who settles in the shade between the bright lines.',
    query: { light: 'full', spread: 'scatter', oases: 4, roam: 1, scarce: 1 },
    scene({ matter, oases, light, W, H }) {
      // (half the light and slow mineral springs: with the full light and three springs at the usual rate the dish filled to its
      // capacity, 6000 cells, within 10 minutes, the colonies centred on the springs and the oases mattered only at the start)
      light.params.power *= 0.5;
      for (const [x, y] of [[0.2, 0.3], [0.78, 0.25], [0.5, 0.72]]) matter.addSpring(x * W, y * H, 'light', 1e9, { rate: 2 });
      matter.addSpring(0.85 * W, 0.78 * H, 'heavy', 1e9, { rate: 3 });
      oases.start([[0.32 * W, 0.62 * H], [0.66 * W, 0.42 * H]]);
    },
  },
  plumes: {
    label: 'Plumes',
    desc: 'A strong slow current turns the whole dish like a lake: two fixed oases and a vent upstream pour trace and fuel into plumes that sweep round the basin. Cells start in five colonies; the light is a soft dappled field. Life should follow the plumes.',
    query: { light: 'full', spread: 'colonies', colonies: 5, roam: 0, oases: 2, scarce: 1, curspeed: 0.5, gyre: 0.9, focus: 0.9 },
    scene({ matter, oases, W, H }) {
      matter.addSpring(0.18 * W, 0.22 * H, 'heavy', 1e9, { rate: 3 });
      for (const [x, y] of [[0.8, 0.2], [0.22, 0.8]]) matter.addSpring(x * W, y * H, 'light', 1e9);
      oases.start([[0.5 * W, 0.15 * H], [0.86 * W, 0.6 * H]]);
    },
  },
  // step T1b: colonies that MEET (T1a found random colonies crash and one lineage fills each dish): each colony its own lasting food
  colonies: {
    label: 'Colonies',
    desc: 'Five colonies of wild founders (every gene, the gene network too, drawn at random; each catches light and burns, so it can eat here), each with its own never-drying mineral spring and a slow vent beside it, under a moderate light over the whole dish. Each lineage has a home; they grow out and meet at the borders. Watch the lineage view (who holds the border) and the reporter view (which cells switch which genes on).',
    query: { light: 'full', spread: 'colonies', colonies: 5, founders: 'wild', habit: 'both', cells: 1000, scarce: 0, oases: 0 },
    scene({ matter, light, cells, W, H }) {
      light.params.power *= 0.6;   // a moderate light: enough to live on, not enough to fill the dish at once
      const k = Math.max(2, (cells.layout && cells.layout.colonies) || 5), m = Math.min(W, H);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * 2 * Math.PI - Math.PI / 2, x = W / 2 + Math.cos(a) * 0.3 * m, y = H / 2 + Math.sin(a) * 0.3 * m;
        // (rates from the pilots: at 4 and 1 the founders' crash left one lineage per dish in 2 of 3 seeds; at 8 and 2, two or three persist)
        matter.addSpring(x, y, 'light', 1e9, { rate: 8 });                                          // its mineral spring, at its centre
        matter.addSpring(x + Math.cos(a) * 0.08 * m, y + Math.sin(a) * 0.08 * m, 'heavy', 1e9, { rate: 2 });   // a slow vent outside it
      }
    },
  },
  lab: {
    label: 'Tissue lab',
    desc: 'Sixty cells of one cloned genome, no evolution (no mutation, no births or deaths) and no springs: watch how they link into tissue, as the tissue experiments did.',
    query: { cells: 60, mut: 0, life: 0, clone: 1, springs: 0 },
    zoom: 3,
    scene() {},
  },
};
export const PRESET_NAMES = Object.keys(PRESETS);
export const SPREADS = ['clump', 'scatter', 'colonies', 'ring'];
export const DIVERSITY = ['clone', 'few', 'mixed', 'random'];
const DIVERSITY_WORD = { clone: 'one clone', few: 'a few types', mixed: 'mixed founders', random: 'all random' };
const SPREAD_WORD = { clump: 'one clump', scatter: 'scattered', colonies: 'colonies', ring: 'a ring' };
const FOUNDER_WORD = { std: 'as usual', blank: 'blank', wild: 'wild' };   // (step T1a)
const FOUNDER_HELP = {
  std: 'the founders’ genes as usual (no kin channels yet: they must evolve)',
  blank: 'the newer abilities at zero: no pumps, no guide gates, no kin channels, uniform walls; they must evolve',
  wild: 'every gene drawn over its whole range: field genes, gates, pumps, walls, membranes, marker, kin channels, a random gene network (engines keep their habit)',
};

function ring3(W, H, r, a0) {
  const m = Math.min(W, H);
  return [0, 1, 2].map((k) => { const a = (a0 + 120 * k) * Math.PI / 180; return [W / 2 + Math.cos(a) * r * m, H / 2 + Math.sin(a) * r * m]; });
}
/** Where main.js's default scene puts its two springs and the spot (beside the culture's rim). */
function defaultSpots(W, H, cells) {
  const m = Math.min(W, H), rim = 0.72 * cells.R * Math.sqrt(cells.start / 0.85);
  const wide = W >= H, ax = wide ? [1, 0] : [0, 1], perp = wide ? [0, 1] : [1, 0];
  const d = rim + 0.01 * m, s = 0.09 * m, cx = W / 2 + ax[0] * d, cy = H / 2 + ax[1] * d;
  return { a: [cx - perp[0] * s, cy - perp[1] * s], b: [cx + perp[0] * s, cy + perp[1] * s], spot: [W / 2 + ax[0] * rim, H / 2 + ax[1] * rim] };
}

/** Main.js, first thing: the preset's URL options into `params` (the URL's own win). Returns the preset's name or null. */
export function applyPreset(params) {
  const name = params.get('preset');
  const P = name && PRESETS[name];
  if (!P) return null;
  for (const [k, v] of Object.entries(P.query)) if (!params.has(k)) params.set(k, VALUE(v));
  return name;
}

/** The culture's layout from the URL (spread, colonies, diversity), with a preset's colony centres. */
export function layoutFromParams(params, preset) {
  const spread = SPREADS.includes(params.get('spread')) ? params.get('spread') : 'clump';
  const colonies = Math.max(2, Math.min(12, Math.round(Number(params.get('colonies')) || 5)));
  const diversity = DIVERSITY.includes(params.get('diversity')) ? params.get('diversity') : 'mixed';
  const P = preset && PRESETS[preset];
  let ring = P && P.ring ? P.ring : null;   // (step M1: a preset's founders on a ring round each colony centre, inner..outer R)
  if (params.has('ventring')) {
    const v = String(params.get('ventring')).split(',').map(Number);
    ring = v.length === 2 && v.every(Number.isFinite) && v[1] > v[0] ? v : null;
  }
  return { spread, colonies, diversity, centres: P && P.centres ? P.centres : null, ring };
}

/** Diversity: the genome's founders before a culture is seeded (clone: 1; few: one of each habit; mixed: 12; random: 0). */
export function applyDiversity(genome, diversity) {
  if (diversity === 'clone') { genome.params.founders = 1; genome.newFounders(); }
  else if (diversity === 'few') { genome.params.founders = HABITS.length; genome.founders = HABITS.map((h, k) => founderGenome(h, genome.rng, k, 'plus', false)); genome.mixBSigns(genome.founders); genome.finishFounders(genome.founders); }   // (B signs from their own stream; step T1a: the marker and mode from theirs)
  else if (diversity === 'random') { genome.params.founders = 0; genome.founders = []; }
  else { genome.params.founders = 12; genome.newFounders(); }
}

/**
 * Where cell i goes (cells.seed): { at(i) -> [x, y], founder(i, nFounders) or null }. The clump draws its random numbers in the
 * same order as before the app (so ?seed=N gives the same start as it did).
 */
export function cultureLayout(L, W, H, R, n, rng) {
  const spread = (L && L.spread) || 'clump';
  if (spread === 'clump') {
    const s = R * Math.sqrt(n / 0.85);   // blob radius at 0.85 area fraction (overlaps settle in the warm-up)
    return { founder: null, at: () => { const a = rng() * 2 * Math.PI, dd = Math.sqrt(rng()) * s; return [W / 2 + Math.cos(a) * dd, H / 2 + Math.sin(a) * dd]; } };
  }
  const m = Math.min(W, H), pad = 2.5 * R;
  if (spread === 'scatter') {
    return { founder: null, at: () => [pad + rng() * (W - 2 * pad), pad + rng() * (H - 2 * pad)] };
  }
  if (spread === 'ring') {
    const r0 = 0.36 * m, w = Math.max(3 * R, Math.min(0.08 * m, n * Math.PI * R * R / (0.6 * 2 * Math.PI * r0)));   // a band about 60 % packed
    return { founder: null, at: () => { const a = rng() * 2 * Math.PI, rr = r0 + (rng() - 0.5) * w; return [W / 2 + Math.cos(a) * rr, H / 2 + Math.sin(a) * rr]; } };
  }
  // colonies: k round blobs, on a ring round the centre (or at a preset's places), each cell's founder its colony's
  const k = Math.max(2, L.colonies || 5);
  const centres = L.centres ? L.centres(W, H).slice(0, k) : Array.from({ length: k }, (_, j) => {
    const a = (j / k) * 2 * Math.PI - Math.PI / 2;
    return [W / 2 + Math.cos(a) * 0.3 * m, H / 2 + Math.sin(a) * 0.3 * m];
  });
  const kk = centres.length, per = Math.ceil(n / kk), s = R * Math.sqrt(per / 0.85);
  const ring = L.ring;   // (step M1: an annulus inner..outer R round each centre instead of a blob)
  return {
    founder: (i, nf) => Math.floor(i / per) % nf,
    at: (i) => {
      const [cx, cy] = centres[Math.min(kk - 1, Math.floor(i / per))];
      const a = rng() * 2 * Math.PI, dd = ring ? R * Math.sqrt(ring[0] ** 2 + rng() * (ring[1] ** 2 - ring[0] ** 2)) : Math.sqrt(rng()) * s;
      return [Math.max(pad, Math.min(W - pad, cx + Math.cos(a) * dd)), Math.max(pad, Math.min(H - pad, cy + Math.sin(a) * dd))];
    },
  };
}

/**
 * The dish's size (src/dish.js), as the New culture dialog offers it: [label, size in R or null (the window's), help]. The reference is the
 * experiments' default window (1280 x 800 px with 2000 cells: 198 x 123 R); the strip is the user's short wide window (1440 x 450 px).
 */
export const DISH_SIZES = {
  window: ['this window', null, 'the dish is this window, as it is now (its size in cells set by the window and the number of cells)'],
  small: ['small', [140, 88], "half the reference dish's area: 140 x 88 cell radii"],
  ref: ['reference', [198, 123], 'the reference dish: 198 x 123 cell radii (a 1280 x 800 window with 2000 cells)'],
  strip: ['strip', [396, 124], "a long strip, 396 x 124 cell radii (twice the reference's area): fronts have room to run"],
  large: ['large', [280, 175], "twice the reference dish's area: 280 x 175 cell radii (more cells: slower)"],
};

/** The squeeze (pull to the centre) for a spread: the old one for the clump, nearly none for the rest. */
export const SPREAD_SQUEEZE = 0.02;

// ---------- the dialog ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The NEW CULTURE dialog. ctx: { cells, params, flash, inPlace(opts) } (main.js). Builds a link of URL options; Start opens it,
 * except "this dish as it is" with the same number of cells, which starts the culture in place.
 */
export function openCultureDialog(ctx) {
  const old = document.getElementById('culture');
  if (old) old.remove();
  const C = ctx.cells, cur = ctx.params;
  const st = {
    preset: cur.get('preset') && PRESETS[cur.get('preset')] ? cur.get('preset') : '',
    cells: C.start,
    spread: SPREADS.includes(cur.get('spread')) ? cur.get('spread') : 'clump',
    colonies: Math.round(Number(cur.get('colonies')) || 5),
    diversity: DIVERSITY.includes(cur.get('diversity')) ? cur.get('diversity') : 'mixed',
    founders: FOUNDER_MODES.includes(cur.get('founders')) ? cur.get('founders') : C.genome.params.founderMode || 'std',   // (step T1a)
    newSeed: true,
    dish: Object.keys(DISH_SIZES).find((k) => DISH_SIZES[k][1] && DISH_SIZES[k][1].join('x') === cur.get('dish')) || 'window',   // (the dish's size)
  };
  const dish0 = st.dish;
  const wrap = el('div', 'dlg-wrap');
  wrap.id = 'culture';
  const box = el('section', 'dlg');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'New culture');
  const head = el('header', 'phead');
  head.append(el('h2', '', 'New culture'));
  const x = el('button', 'x', '×');
  x.type = 'button'; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
  head.append(x);
  const body = el('div', 'pbody');
  box.append(head, body);
  wrap.append(box);

  // environment
  body.append(el('h3', '', 'Dish'));
  const envList = el('div', 'envs');
  const envs = [['', 'This dish as it is', 'Keep the springs, the light and the atoms; only new cells (with the same number: no reload).'],
    ...PRESET_NAMES.map((n) => [n, PRESETS[n].label, PRESETS[n].desc])];
  for (const [id, label, desc] of envs) {
    const b = el('button', 'env');
    b.type = 'button'; b.dataset.env = id;
    b.append(el('b', '', label), el('span', '', desc));
    envList.append(b);
  }
  body.append(envList);
  // the dish's size (src/dish.js): kept while the window changes; chosen here
  const dsRow = el('div', 'rmain');
  const dsSeg = el('span', 'seg');
  for (const [k, [label]] of Object.entries(DISH_SIZES)) { const b = el('button', '', label); b.type = 'button'; b.dataset.dish = k; dsSeg.append(b); }
  dsRow.append(el('span', 'lbl', 'size'), dsSeg);
  body.append(dsRow);
  const dsHelp = el('p', 'help', '');
  body.append(dsHelp);
  // founders
  body.append(el('h3', '', 'Founders'));
  const nRow = el('div', 'rmain');
  const nIn = el('input', 'num');
  Object.assign(nIn, { type: 'number', min: 1, max: 20000, step: 1, value: String(st.cells) });
  nIn.setAttribute('aria-label', 'number of founder cells');
  nRow.append(el('span', 'lbl', 'cells'), nIn);
  const quick = el('span', 'seg');
  for (const v of [60, 400, 2000, 6000]) { const b = el('button', '', String(v)); b.type = 'button'; b.dataset.n = String(v); quick.append(b); }
  nRow.append(quick);
  body.append(nRow);
  // spread
  const spRow = el('div', 'rmain');
  const spSeg = el('span', 'seg');
  for (const s of SPREADS) { const b = el('button', '', SPREAD_WORD[s]); b.type = 'button'; b.dataset.spread = s; spSeg.append(b); }
  spRow.append(el('span', 'lbl', 'spread'), spSeg);
  body.append(spRow);
  const colRow = el('div', 'rmain');
  const colIn = el('input', 'num');
  Object.assign(colIn, { type: 'number', min: 2, max: 12, step: 1, value: String(st.colonies) });
  colIn.setAttribute('aria-label', 'number of colonies');
  colRow.append(el('span', 'lbl', 'colonies'), colIn);
  body.append(colRow);
  // diversity
  const dvRow = el('div', 'rmain');
  const dvSeg = el('span', 'seg');
  for (const s of DIVERSITY) { const b = el('button', '', DIVERSITY_WORD[s]); b.type = 'button'; b.dataset.div = s; dvSeg.append(b); }
  dvRow.append(el('span', 'lbl', 'diversity'), dvSeg);
  body.append(dvRow);
  const dvHelp = el('p', 'help', '');
  body.append(dvHelp);
  // step T1a: the founders' genes: today's, blank (the new abilities at 0) or wild (every gene over its whole range)
  const fmRow = el('div', 'rmain');
  const fmSeg = el('span', 'seg');
  for (const s of FOUNDER_MODES) { const b = el('button', '', FOUNDER_WORD[s]); b.type = 'button'; b.dataset.fm = s; fmSeg.append(b); }
  fmRow.append(el('span', 'lbl', 'genes'), fmSeg);
  body.append(fmRow);
  const fmHelp = el('p', 'help', '');
  body.append(fmHelp);
  const seedRow = el('label', 'rmain');
  const seedIn = el('input');
  Object.assign(seedIn, { type: 'checkbox', checked: true });
  seedRow.append(seedIn, el('span', 'lbl', 'a new random seed (off: keep this page\'s)'));
  body.append(seedRow);
  // the link and the buttons
  const link = el('p', 'note link', '');
  body.append(link);
  const btns = el('div', 'dlg-btns');
  const go = el('button', 'act go', 'start');
  go.type = 'button';
  const copy = el('button', 'act', 'copy link');
  copy.type = 'button';
  const cancel = el('button', 'act', 'cancel');
  cancel.type = 'button';
  btns.append(go, copy, cancel);
  body.append(btns);

  const DIV_HELP = {
    clone: 'one genome for every cell (with mutation on, they drift apart as they divide)',
    few: 'one founder of each habit: an eater, a light + burn cell, a photosynthesiser, a chain maker / breather',
    mixed: 'the usual 12 founder genomes of mixed habits',
    random: 'every cell its own random genome',
  };
  function url() {
    const u = new URL(location.href);
    const keep = new URLSearchParams();
    for (const k of ['electrons', 'exshare', 'ui']) if (u.searchParams.has(k)) keep.set(k, u.searchParams.get(k));   // (the table is fixed per page)
    if (st.preset) keep.set('preset', st.preset);
    const P = st.preset ? PRESETS[st.preset] : null;
    const presetCells = P && P.query.cells;
    if (st.cells !== presetCells) keep.set('cells', String(st.cells));
    const presetSpread = (P && P.query.spread) || 'clump';
    if (st.spread !== presetSpread) keep.set('spread', st.spread);
    if (st.spread === 'colonies' && st.colonies !== ((P && P.query.colonies) || 5)) keep.set('colonies', String(st.colonies));
    if (st.diversity !== ((P && P.query.diversity) || 'mixed')) keep.set('diversity', st.diversity);
    if (st.founders !== 'std') keep.set('founders', st.founders);   // (step T1a)
    if (!st.newSeed) keep.set('seed', String(ctx.control.seed));
    const ds = DISH_SIZES[st.dish][1];
    if (ds && !(P && P.query.dish === ds.join('x'))) keep.set('dish', ds.join('x'));
    u.search = keep.toString();
    return u.href;
  }
  const inPlace = () => !st.preset && st.cells === C.start && st.dish === dish0;
  function sync() {
    for (const b of envList.querySelectorAll('[data-env]')) b.setAttribute('aria-pressed', String(b.dataset.env === st.preset));
    for (const b of spSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.spread === st.spread));
    for (const b of dvSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.div === st.diversity));
    for (const b of quick.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.n) === st.cells));
    colRow.style.display = st.spread === 'colonies' ? '' : 'none';
    dvHelp.textContent = DIV_HELP[st.diversity];
    for (const b of fmSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.fm === st.founders));
    fmHelp.textContent = FOUNDER_HELP[st.founders];
    for (const b of dsSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.dish === st.dish));
    dsHelp.textContent = DISH_SIZES[st.dish][2];
    link.textContent = inPlace() ? 'Starts here, now: the same dish, new cells (no reload).' : `Opens: ${url()}`;
    go.textContent = inPlace() ? 'start here' : 'open';
  }
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.env != null) {
      st.preset = b.dataset.env;
      const P = PRESETS[st.preset];
      if (P) {
        if (P.query.cells) st.cells = P.query.cells; else if (st.cells === 60) st.cells = C.start === 60 ? 2000 : C.start;
        st.spread = P.query.spread || 'clump';
        if (P.query.colonies) st.colonies = P.query.colonies;
        st.diversity = P.query.diversity || 'mixed';
        if (P.query.dish) st.dish = Object.keys(DISH_SIZES).find((k) => DISH_SIZES[k][1] && DISH_SIZES[k][1].join('x') === P.query.dish) || st.dish;
        nIn.value = String(st.cells); colIn.value = String(st.colonies);
      }
    } else if (b.dataset.n) { st.cells = Number(b.dataset.n); nIn.value = String(st.cells); }
    else if (b.dataset.spread) st.spread = b.dataset.spread;
    else if (b.dataset.div) st.diversity = b.dataset.div;
    else if (b.dataset.fm) st.founders = b.dataset.fm;
    else if (b.dataset.dish) st.dish = b.dataset.dish;
    sync();
  });
  nIn.addEventListener('input', () => { st.cells = Math.max(1, Math.min(20000, Math.round(Number(nIn.value) || 1))); sync(); });
  colIn.addEventListener('input', () => { st.colonies = Math.max(2, Math.min(12, Math.round(Number(colIn.value) || 5))); sync(); });
  seedIn.addEventListener('change', () => { st.newSeed = seedIn.checked; sync(); });
  const close = () => { wrap.remove(); window.removeEventListener('keydown', onEsc, true); };
  const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onEsc, true);
  x.addEventListener('click', close);
  cancel.addEventListener('click', close);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  copy.addEventListener('click', async () => {
    const h = url();
    try { await navigator.clipboard.writeText(h); ctx.flash('link copied'); } catch { window.prompt('The link:', h); }
  });
  go.addEventListener('click', () => {
    if (inPlace()) {
      close();
      ctx.inPlace({ spread: st.spread, colonies: st.colonies, diversity: st.diversity, founders: st.founders });
      return;
    }
    location.assign(url());
  });
  // keys typed into the dialog must not run the page's shortcuts
  box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  document.body.append(wrap);
  sync();
  return wrap;
}
