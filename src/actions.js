// Step C3b: ONE table of every action the page offers: the keyboard handler and the toolbar / panels (src/ui.js) both
// read it, so a key and its button cannot drift apart.
//
// An entry:
//   id      unique name (the buttons use it: data-action)
//   keys    the keys that run it: a plain key as e.key lowercased ('p', '[', ' ' for Space), or 'shift+<letter>' for the
//           Part C keys (Shift + a letter never also runs the plain letter), or 'shift+<digit>' (step C6n: the digit key's
//           place on the keyboard, see main.js onKey). Empty: a button only.
//   label   a short name for the button / switch
//   group   where it sits: 'tool', 'play', 'light', 'look' and 'view' (the view panel), or a rules group (RULE_GROUPS below)
//   type    'toggle' (get() is true / false: a switch), 'cycle' (get() is the current setting's name; options() lists
//           them when the panel can set one directly with set()), 'knob' (get() is the value; run('-') / run('+')
//           step it), 'do' (a button)
//   get     the current state, for the switches (the panels poll it, so a change by a key or the console shows too)
//   run(k)  does it; k is the key pressed (knobs: '-' or '+' from the buttons). Returns the flash text, or nothing.
//   help    one line in plain words for the panels
//
// The flash texts are the ones the keys showed before the table (checked by pressing every key in the old and the new
// page and comparing the state and the flash after each press).

import { ELECTRONS } from './matter.js';
import { JOBS } from './jobs.js';
const JOB_WORD = ['warm white', 'lime', 'pink', 'violet', 'cyan', 'amber', 'red'];   // step F0: the jobs' neon inks in words (src/palette.js)

// (step C12d, electrons: tap mode 2 drips minerals, tap mode 3 is a vent; their ids stay)
export const TOOLS = [
  { id: 'ripple', name: 'ripple', label: 'drop a ripple', key: '1' },
  ELECTRONS ? { id: 'light', name: 'mineral spring', label: 'drop a mineral spring (water-like gt and linkers)', spring: 'light', key: '2' }
    : { id: 'light', name: 'light spring', label: 'drop a light spring', spring: 'light', key: '2' },
  ELECTRONS ? { id: 'heavy', name: 'vent', label: 'drop a vent (fuel-like gT and GT, free heavy givers G, trace; with hot vents on: free givers G and g and heat)', spring: 'heavy', key: '3' }
    : { id: 'heavy', name: 'heavy spring', label: 'drop a heavy spring', spring: 'heavy', key: '3' },
  // step C12: oil, soap or both (the rules panel, Oils and water: "oil tool drops"); no key is free
  { id: 'oil', name: 'oil spring', label: 'drop an oil spring (oil, soap or both: the rules panel, Oils and water)', spring: 'oil', oilSpring: true },
  { id: 'stir', name: 'stir', label: 'stir', stir: true },
  { id: 'spot', name: 'move light', label: 'move the light', spot: true },
  // app (src/app.js): place cells (a genome picked in the cells zoo) and drop a substance (picked in the molecules zoo)
  { id: 'cell', name: 'add cells', label: 'place cells (pick a lineage in the cells zoo)', addCell: true },
  { id: 'pipette', name: 'pipette', label: 'drop a substance (pick one in the molecules zoo)', pipette: true },
];

export const RULE_GROUPS = [
  ['loop', 'The loop (step 4)'],
  ['shape', 'Cell shape (step C6c)'],
  ['fieldB', 'Field B (step 5)'],
  ['meet', 'Where the fields meet (step 6)'],
  ['excl', 'Exclusion (step 7)'],
  ['partner', 'Partner fields (step 8)'],
  ['bio', 'Biology'],
  ['heatlight', 'Heat and light (Part C)'],
  ['chem', 'Chemistry (step C4)'],
  ['eat', 'Cells eat (step C5)'],
  ['engines', 'Engines in the genome (step C6)'],
  ['charge', 'Charge (step C6b)'],
  ['membrane', 'Membrane chemistry (step C6c)'],
  ['dipole', 'Charge per side (step C6d)'],
  ['pumps', 'Pumps (step C7)'],
  ['catalysts', 'Catalysts (step C7b)'],
  ['hardlight', 'Hard light (step C8)'],
  ['division', 'Division (step C9)'],
  ['walls', 'Patterned walls (step C10)'],
  ['turn', 'Glue turns cells (step C11)'],
  ['oil', 'Oils and water (step C12)'],
  ['lipids', 'Lipid membranes (step C12b)'],
  ['excited', 'Excited waste (step C12c)'],
  ['electrons', 'Electrons (step C12d)'],
  ['waste', 'Waste must leave (step C12e)'],
  ['ions', 'Ion flow (step C12g)'],
  ['whole', 'Whole membranes (step M1)'],
  ['t1a', 'Tissues 1: inside, kin, marker (step T1a)'],
  ['t1b', 'Gene network (step T1b)'],
  ['p1', 'Predators (step P1)'],
  ['g1', 'Error correction (step G1)'],
  ['vents', 'Vents in the dark (step C12f)'],
  ['n1', 'Nutrient landscape (step N1)'],
  ['guides', 'Fields as guides (step C13)'],
  ['state', 'Save and load the state (experiments)'],
];

export const VIEWS = ['job', 'lineage', 'strategy', 'charge', 'walls', 'guides', 'marker', 'reporter'];   // key V: what the cells' bodies are coloured by (cells.look.view;
                                                                         // step C10: + the wall pattern)

export const SQUEEZE_SOFT = 0.25, SQUEEZE_HARD = 1.2;   // key \ : cells.params.squeeze, normal or pressed together

/**
 * The table. `app` gives the actions what they act on: the layers (cells, background, landscape, light, matter), the
 * page's elements and a few functions of main.js (tool, speed, pause, record, overlay, entropy panel, key list).
 */
export function makeActions(app) {
  const C = () => app.cells, rules = () => app.cells.genome.rules, F = () => app.cells.fields;
  const X = () => app.cells.excl, PT = () => app.cells.partner, LP = () => app.landscape.params;
  const flip = (o, k) => { o[k] = !o[k]; return o[k]; };

  const A = [
    // ---------- tools (what a tap / click and a drag on the dish do) ----------
    ...TOOLS.map((t, i) => ({
      id: `tool-${t.id}`, keys: t.key ? [t.key] : [], label: t.name, group: 'tool', type: 'tool',
      get: () => app.tool === i,
      run: () => app.setTool(i),
      help: t.id === 'stir' ? 'tap and drag: stir the dish (ripples, and the cells near your finger are pushed along)'
        : t.id === 'spot' ? 'tap or drag: move the spotlight there (switches the light to spotlight)'
          : t.addCell ? 'tap: place a cell, drag: a line of cells (copies of the genome picked in the cells zoo; empty stock, the starter charge)'
            : t.pipette ? 'tap: drop the substance picked in the molecules zoo, drag: drop more (booked as added, like a spring)'
              : `tap: ${t.label}; drag: stir`,
    })),

    // ---------- playback ----------
    { id: 'pause', keys: [' '], label: 'pause', group: 'play', type: 'toggle', get: () => app.paused,
      run: () => app.togglePause(), help: 'stop and start the simulation (the picture stays)' },
    { id: 'speed', keys: ['[', ']'], label: 'speed', group: 'play', type: 'knob', get: () => app.speedLabel(),
      run: (k) => app.stepSpeed(k === ']' || k === '+' ? 1 : -1),
      help: 'simulation steps per drawn frame: 1× to 32× (a timelapse), MAX = as many as the GPU fits; the button shows the speed reached' },
    { id: 'record', keys: ['shift+v'], label: 'record', group: 'play', type: 'toggle', get: () => app.recording(),
      run: () => app.toggleRecord(), help: 'record the dish (not the panels) as a video file; again to stop and save it' },
    { id: 'culture', keys: ['n'], label: 'new culture', group: 'play', type: 'do', run: () => newCulture(false),
      help: 'a fresh blob of cells at the centre, the same founder genomes' },
    { id: 'genomes', keys: ['g'], label: 'new genomes', group: 'play', type: 'do', run: () => newCulture(true),
      help: 'a fresh blob with fresh random founder genomes' },
    { id: 'springs', keys: ['c'], label: 'clear springs', group: 'play', type: 'do',
      run: () => { app.matter.clearSprings(); return 'springs cleared (the atoms already in the dish stay; Shift+C washes them out)'; },
      help: 'remove the springs (the atoms already in the dish stay)' },
    { id: 'wash', keys: ['shift+c'], label: 'wash atoms', group: 'play', type: 'do',
      run: () => { app.matter.wash(); return 'the dish washed: every atom out (booked as gone in the atoms ledger)'; },
      help: 'every atom out of the dish (booked as gone in the atoms ledger)' },

    // ---------- step C6n: the look (drawing only) ----------
    { id: 'neon', keys: ['e'], label: 'neon look', group: 'look', type: 'toggle', get: () => app.neon.on && !app.neon.harmonic.on,
      run: () => app.neon.toggle(),
      help: 'cells as bright neon tubes with a tight halo, trails and hum (off: the flat look of steps 1 to C6)' },
    // ---------- step H1: the harmonic look (src/harmonic.js) ----------
    { id: 'harmonic', keys: ['`'], label: 'harmonic look', group: 'look', type: 'toggle', get: () => app.neon.harmonic.on,
      run: () => app.neon.harmonic.toggle(),
      help: 'the dish as a multiphoton (higher harmonic) microscope image, channels added on black: green = interfaces (membranes, brighter with lipid; oil rims), orange = ordered fibres (crust, stretched cells, builders, predators), violet = metabolism (fuel, batteries, busy cells)' },
    { id: 'hblur', keys: [], label: 'slight blur', group: 'look', type: 'toggle', get: () => app.neon.harmonic.params.blur,
      run: () => `slight blur ${flip(app.neon.harmonic.params, 'blur') ? 'on: soft at the pixel scale, as a scanned image' : 'off: sharp'}${app.neon.harmonic.on ? '' : ' (the harmonic look is off: `)'}`,
      help: 'a scanned image’s slight softness (harmonic look)' },
    { id: 'hgrain', keys: [], label: 'photon grain', group: 'look', type: 'toggle', get: () => app.neon.harmonic.params.grain,
      run: () => `photon grain ${flip(app.neon.harmonic.params, 'grain') ? 'on: each channel counts its own photons' : 'off'}${app.neon.harmonic.on ? '' : ' (the harmonic look is off: `)'}`,
      help: 'photon noise per channel, more where it is brighter (harmonic look)' },
    { id: 'hscale', keys: [], label: 'scale bar', group: 'look', type: 'toggle', get: () => app.neon.harmonic.params.scalebar,
      run: () => { const H = app.neon.harmonic; flip(H.params, 'scalebar'); H.showBar(); return `scale bar ${H.params.scalebar ? 'shown (it follows the zoom; a cell is 12 µm across, as in the CPU version)' : 'hidden'}`; },
      help: 'a scale bar in the corner that follows the zoom, a cell 12 µm across (every look)' },
    { id: 'halo', keys: ['shift+1'], label: 'halo', group: 'look', type: 'cycle', get: () => app.neon.halo.name,
      options: () => ['off', 'low', 'medium', 'high'],
      set: (v) => { app.neon.params.halo = Math.max(0, ['off', 'low', 'medium', 'high'].indexOf(v)); return `halo ${v}`; },
      run: () => app.neon.cycleHalo(), help: 'how far the tubes\' light spills around them (neon look)' },
    { id: 'trails', keys: ['shift+2'], label: 'light trails', group: 'look', type: 'toggle', get: () => app.neon.params.trails,
      run: () => `light trails ${flip(app.neon.params, 'trails') ? 'on: moving cells leave short fading streaks' : 'off'}${app.neon.on ? '' : ' (the neon look is off: E)'}`,
      help: 'moving cells leave short fading streaks, as a long exposure (neon look)' },
    { id: 'hum', keys: ['shift+3'], label: 'hum', group: 'look', type: 'toggle', get: () => app.neon.params.hum,
      run: () => `hum ${flip(app.neon.params, 'hum') ? 'on: the tubes wobble a little in brightness, busy cells (battery filling or emptying fast) shine brighter' : 'off: every tube steady'}${app.neon.on ? '' : ' (the neon look is off: E)'}`,
      help: 'tubes brighten and dim a little; busy cells (battery filling or emptying fast) shine brighter (neon look)' },
    { id: 'machinery', keys: ['shift+4'], label: 'show the machinery', group: 'look', type: 'toggle', get: () => machinery(),
      run: () => setMachinery(!machinery()),
      help: 'off (clean, the default): the cells, the materials and the light. On: every diagnostic layer at once: the fields\' dots, the lattice inside the cells, the substances as a halftone on the lattice, the marks of steps 6 to 8' },
    { id: 'dustStyle', keys: ['shift+5'], label: 'substances as', group: 'look', type: 'cycle',
      get: () => app.matter.params.style, options: () => ['dust', 'halftone'],
      set: (v) => { app.matter.params.style = v; return styleText(); },
      run: () => { const p = app.matter.params; p.style = p.style === 'dust' ? 'halftone' : 'dust'; return styleText(); },
      help: 'the substances as material (glowing specks, as many as the amount) or as the halftone dots on the medium lattice' },
    { id: 'corner', keys: [], label: 'corner rounding', group: 'look', type: 'knob', get: () => C().look.corner.toFixed(2),
      run: (k) => {
        const L = C().look;
        L.corner = Math.max(0, Math.min(0.8, Math.round((L.corner + (k === '-' ? -0.1 : 0.1)) * 100) / 100));
        return `honeycomb corners rounded by ${L.corner.toFixed(2)} of the cell's radius${L.corner === 0 ? ' (sharp)' : L.corner >= 0.6 ? ' (nearly round)' : ''}`;
      },
      help: 'how round the honeycomb cells’ corners are drawn (0: sharp hexagons; the walls stay straight)' },
    { id: 'innerDots', keys: ['shift+6'], label: 'lattice inside cells', group: 'look', type: 'toggle', get: () => C().look.innerDots,
      run: () => `the cells' own lattice ${flip(C().look, 'innerDots') ? 'drawn as dots inside each cell' : 'not drawn'}`,
      help: 'each cell\'s own hex lattice as small dots inside it' },

    // ---------- view (drawing only) ----------
    { id: 'entropy', keys: ['shift+e'], label: 'entropy panel', group: 'view', type: 'toggle', get: () => !app.entropyEl.hidden,
      run: () => { app.showEntropy(app.entropyEl.hidden); return `entropy panel ${app.entropyEl.hidden ? 'hidden' : 'shown'}`; },
      help: 'the energy and matter counters, top right' },
    { id: 'stats', keys: ['f'], label: 'stats overlay', group: 'view', type: 'toggle', get: () => !app.overlayEl.hidden,
      run: () => { app.overlayEl.hidden = !app.overlayEl.hidden; if (!app.overlayEl.hidden) app.drawOverlay(); },
      help: 'frame time, the graphics card and every number, top left' },
    { id: 'landscape', keys: ['l'], label: 'landscape', group: 'view', type: 'toggle', get: () => LP().on,
      run: () => `landscape ${flip(LP(), 'on') ? 'on' : 'off: no halftone dots'}`,
      help: 'all the halftone dots: the cells\' fields and the substances' },
    { id: 'show', keys: ['shift+s'], label: 'substances shown', group: 'view', type: 'cycle', get: () => app.matter.showName,
      run: () => app.matter.cycleShow(), help: 'the substances\' dots: summary, each substance alone, or off' },
    { id: 'colour', keys: ['v'], label: 'colour by', group: 'view', type: 'cycle',
      get: () => VIEWS[C().look.view] || 'job', options: () => VIEWS,
      set: (v) => { C().look.view = Math.max(0, VIEWS.indexOf(v)); return viewText(); },
      run: () => { C().look.view = (C().look.view + 1) % VIEWS.length; return viewText(); },
      help: 'cells coloured by their job (what they do, from their genes as expressed), their lineage (the genome key\'s hue), their strategy (how their engines make a living), or their charge' },
    { id: 'legend', keys: [], label: 'job legend', group: 'view', type: 'toggle', get: () => C().look.legend !== false,
      run: () => `job legend ${flip(C().look, 'legend') ? 'shown (bottom right, while the cells are coloured by job)' : 'hidden'}`,
      help: 'names the colours of the jobs, with how many cells show each clearly (bottom right; colour by job, neon or flat look)' },
    { id: 'cellField', keys: ['k'], label: 'cells\' field drawn', group: 'view', type: 'toggle', get: () => LP().cellField,
      run: () => `cells' field ${flip(LP(), 'cellField') ? 'drawn (pale dots)' : 'not drawn'}`,
      help: 'field A in pale dots (drawing only)' },
    { id: 'fieldBDrawn', keys: ['j'], label: 'field B drawn', group: 'view', type: 'toggle', get: () => LP().fieldB,
      run: () => `field B ${flip(LP(), 'fieldB') ? 'drawn (blue dots; open rings where it is negative)' : 'not drawn'}`,
      help: 'field B as blue dots, open rings where negative (drawing only)' },
    { id: 'partnerDrawn', keys: [';'], label: 'partner A′ drawn', group: 'view', type: 'toggle', get: () => LP().partner,
      run: () => `partner A' ${flip(LP(), 'partner') ? 'drawn (yellow dots, while a step 8 rule is on)' : 'not drawn'}`,
      help: 'the partner field A′ in yellow dots, while a step 8 rule is on (drawing only)' },
    { id: 'ambient', keys: ['a'], label: 'ambient ripples', group: 'view', type: 'toggle', get: () => app.background.ambient,
      run: () => `ambient ripples ${flip(app.background, 'ambient') ? 'on' : 'off'}`,
      help: 'random drops in the background, about one a second' },
    { id: 'simmer', keys: ['shift+r'], label: 'ripples simmer', group: 'view', type: 'toggle', get: () => app.background.heatOn,
      run: () => `ripples ${flip(app.background, 'heatOn') ? 'simmer with heat: small random rings where it is hot' : 'no longer driven by heat'}`,
      help: 'small random rings in the background where the dish is hot' },
    { id: 'keys', keys: ['?', '/'], label: 'all keys', group: 'view', type: 'toggle', get: () => app.allKeys(),
      run: () => { app.toggleAllKeys(); }, help: 'the line at the bottom lists every key (keyboard only)', desktop: true },

    // ---------- rules: the loop (step 4) ----------
    { id: 'contact', keys: ['p'], label: 'contact push', group: 'loop', type: 'toggle', get: () => C().params.contact,
      run: () => `contact push ${flip(C().params, 'contact') ? 'on' : 'off'}`,
      help: 'cells push each other apart where they overlap (off: they slide over each other and heap up)' },
    { id: 'sense', keys: ['s'], label: 'field sensing', group: 'loop', type: 'toggle', get: () => C().params.senseOn,
      run: () => `field sensing ${flip(C().params, 'senseOn') ? 'on: cells move along the field they feel on their membrane' : 'off'}`,
      help: 'cells move along the field they feel on their membrane' },
    { id: 'emit', keys: ['o'], label: 'cells emit', group: 'loop', type: 'toggle', get: () => C().params.emit,
      run: () => `cells emit ${flip(C().params, 'emit') ? 'on: every cell adds its own beat to the field' : 'off'}`,
      help: 'every cell adds its own beat to the field (off: no field at all)' },
    { id: 'shape', keys: ['w'], label: 'active deformation', group: 'loop', type: 'toggle', get: () => C().params.active,
      run: () => `active deformation ${flip(C().params, 'active') ? 'on: cells stretch along their motion and the pull of the field' : 'off: only contact squeezes them'}`,
      help: 'cells stretch along their motion and the pull of the field (off: only contact squeezes them)' },
    { id: 'anchor', keys: ['x'], label: 'beat anchor', group: 'loop', type: 'cycle',
      get: () => ['sliding', 'pinned', 'still'][C().params.anchor] || '?',
      run: () => { const p = C().params; p.anchor = (p.anchor + 1) % 3; return `cells' beat: ${app.ANCHORS[p.anchor]}`; },
      help: 'where a cell\'s beat pattern sits: pinned to the cell, still in the world, or the sliding moiré of the reference' },
    { id: 'receptor', keys: ['r'], label: 'tune by receptor', group: 'loop', type: 'toggle', get: () => C().params.receptor,
      run: () => `cells feel other cells ${flip(C().params, 'receptor') ? 'through their genome’s receptor' : 'by likeness to their own lattice'}`,
      help: 'cells feel others through their genome\'s receptor (off: by likeness to their own lattice)' },
    { id: 'lever', keys: ['-', '=', '+'], label: 'lever', group: 'loop', type: 'knob', get: () => C().params.lever.toFixed(2),
      run: (k) => {
        const p = C().params;
        p.lever = Math.max(0.05, Math.min(3, Math.round(p.lever * (k === '-' ? 0.8 : 1.25) * 1000) / 1000));
        return `lever ${p.lever.toFixed(2)}: the cells' lattices ${p.lever < 1 ? 'closer to' : 'further from'} the medium's (1 = as the genome has it)`;
      },
      help: 'how different the cells\' lattices are from the medium\'s: smaller = longer beats, bigger clusters' },

    // ---------- cell shape (step C6c; panel only: no free keys left) ----------
    { id: 'honeycomb', keys: [], label: 'honeycomb shapes', group: 'shape', type: 'toggle', get: () => C().shape.on,
      run: () => `${flip(C().shape, 'on') ? 'honeycomb shapes: each outline is six springy corners; touching cells press their sides flat into shared walls, free sides stay round, a push makes them wobble' : 'ellipse cells (steps 4 to C6b): each outline a stretched ellipse'}`,
      help: 'each outline is six springy corners: packed cells press flat into a honeycomb, free edges stay round, a push makes a cell wobble (off: the stretched ellipses of steps 4 to C6b)' },
    { id: 'stiffness', keys: [], label: 'stiffness', group: 'shape', type: 'knob', get: () => C().shape.stiffness.toFixed(2),
      run: (k) => {
        const S = C().shape;
        S.stiffness = Math.max(0.1, Math.min(10, Math.round(S.stiffness * (k === '-' ? 1 / 1.4 : 1.4) * 1000) / 1000));
        return `honeycomb stiffness ${S.stiffness.toFixed(2)}: the corners wobble at ${(S.wobbleHz * Math.sqrt(S.stiffness)).toFixed(1)} Hz${S.stiffness < 1 ? ' (softer, slower wobble)' : S.stiffness > 1 ? ' (stiffer, quicker wobble)' : ''}${S.on ? '' : ' (honeycomb shapes are off)'}`;
      },
      help: 'how stiff the honeycomb cells are: softer cells wobble slower and further, stiffer ones quicker' },

    // ---------- field B (step 5) ----------
    { id: 'feelB', keys: ['q'], label: 'feel field B', group: 'fieldB', type: 'toggle', get: () => F().on,
      run: () => `field B ${flip(F(), 'on') ? 'felt: cells move along it by the sign rule' : 'not felt (still emitted and drawn)'}`,
      help: 'cells move along field B by its sign rule (off: still emitted and drawn)' },
    { id: 'signB', keys: ['u'], label: 'like … like', group: 'fieldB', type: 'cycle', get: () => (app.charge.signB > 0 ? 'repels' : 'attracts'),
      run: () => `field B: like ${app.charge.flipSignB() > 0 ? 'repels' : 'attracts'} like${app.charge.stockOn ? ' (for the charges from the stock; the fixed charge keeps its own rule)' : ''}`,
      help: 'B\'s sign rule: like attracts like, or like repels like (step C6b: one rule for the charges from the stock or genes, one for the fixed charge)' },
    { id: 'likeB', keys: ['y'], label: '"like" means', group: 'fieldB', type: 'cycle', get: () => (F().like ? 'lineage' : 'charge'),
      run: () => { F().like = F().like ? 0 : 1; return `field B: "like" means ${F().like ? 'a similar key (the same lineage)' : 'the same sign of charge'}`; },
      help: 'for B, "like" means the same sign of charge or a similar key (lineage)' },

    // ---------- where the fields meet (step 6) ----------
    { id: 'leak', keys: ['4'], label: 'leak by deformation', group: 'meet', type: 'toggle', get: () => F().leakOn,
      run: () => `leak by deformation ${flip(F(), 'leakOn') ? 'on: strongly stretched cells leak into field B (blue centre dot)' : 'off'}`,
      help: 'strongly stretched cells leak part of their A into B (blue centre dot)' },
    { id: 'conv', keys: ['5'], label: 'conversion A → B', group: 'meet', type: 'toggle', get: () => F().convOn,
      run: () => `conversion ${flip(F(), 'convOn') ? 'on: cells that feel enough A turn to emitting B (blue outline)' : 'off'}`,
      help: 'a cell that feels enough A converts and emits more B (blue outline)' },
    { id: 'convMode', keys: ['6'], label: 'conversion does', group: 'meet', type: 'cycle', get: () => (F().convMode ? 'flip B' : 'boost B'),
      run: () => { F().convMode = F().convMode ? 0 : 1; return `a converted cell ${F().convMode ? 'flips its B charge' : 'emits more B'}`; },
      help: 'a converted cell emits more B, or flips the sign of its B charge' },
    { id: 'relay', keys: ['7'], label: 'relay through B', group: 'meet', type: 'toggle', get: () => F().relayOnKey,
      run: () => `relay through B ${flip(F(), 'relayOnKey') ? 'on: converted cells excite their neighbours, tire and rest' : 'off'}${F().convOn ? '' : ' (conversion is off: key 5)'}`,
      help: 'converted cells excite their neighbours, tire and rest, so conversion travels as waves (needs conversion)' },

    // ---------- exclusion (step 7) ----------
    { id: 'excl', keys: ['8'], label: 'exclusion', group: 'excl', type: 'toggle', get: () => X().on,
      run: () => `exclusion ${flip(X(), 'on') ? 'on: the same founder line and the same state (the bar) keep apart, other states pack closer' : 'off'}`,
      help: 'cells of the same founder line (lineage) in the same state (the bar) keep a gap; other states may touch' },
    { id: 'flip', keys: ['9'], label: 'state flip', group: 'excl', type: 'toggle', get: () => X().flip,
      run: () => `state flip ${flip(X(), 'flip') ? 'on: a cell crowded by its own state turns to the state least represented around it' : 'off'}${X().on ? '' : ' (exclusion is off: key 8)'}`,
      help: 'a cell crowded by its own state turns to the state least represented around it (needs exclusion)' },
    { id: 'states', keys: ['0'], label: 'states', group: 'excl', type: 'cycle', get: () => String(X().states),
      run: () => { const x = X(); x.states = x.states >= 4 ? 2 : x.states + 1; return `exclusion: ${x.states} states (the bar's directions)${x.on ? '' : ' (exclusion is off: key 8)'}`; },
      help: 'how many states (directions of the bar): 2, 3 or 4' },
    { id: 'squeeze', keys: ['\\'], label: 'squeeze hard', group: 'excl', type: 'toggle', get: () => C().params.squeeze > SQUEEZE_SOFT,
      run: () => {
        const P = C().params;
        P.squeeze = P.squeeze > SQUEEZE_SOFT ? SQUEEZE_SOFT : SQUEEZE_HARD;
        return `squeeze ${P.squeeze > SQUEEZE_SOFT ? 'hard: the pull to the centre presses the drop together (with 2 states (key 0), exclusion (8) and field B not felt (Q): a woven checkerboard)' : 'soft (normal)'}`;
      },
      help: 'the pull to the dish centre presses the culture together (2 states, exclusion, B not felt: a woven checkerboard)' },

    // ---------- partner fields (step 8) ----------
    { id: 'partner', keys: ['z'], label: 'partner A′', group: 'partner', type: 'toggle', get: () => PT().on,
      run: () => `partner A' ${flip(PT(), 'on') ? "on: cells feel field A and its quarter-period twin A' (yellow dots) as a phase current, and are pushed along it" : 'off'}`,
      help: 'cells feel A and its quarter-period twin A′ as a phase current and are pushed along it' },
    { id: 'change', keys: [','], label: 'change makes partner', group: 'partner', type: 'toggle', get: () => PT().change,
      run: () => `change makes the partner ${flip(PT(), 'change') ? "on: a cell emits A' as the A it feels changes, and A as the A' it feels changes" : 'off'}`,
      help: 'each cell\'s emission turns between A and A′ (yellow fill and hand)' },
    { id: 'clock', keys: ["'"], label: 'change mode', group: 'partner', type: 'cycle', get: () => (PT().chMode ? 'clock' : 'felt change'),
      run: () => {
        const P = PT();
        P.chMode = P.chMode ? 0 : 1;
        return `change makes the partner: ${P.chMode ? "clock (in each cell A turns into A' and back; the neighbours pull the hand)" : "felt change (a cell emits A' as the A it feels changes, and A as the A' changes)"}${P.change ? '' : ' (the rule is off: key ,)'}`;
      },
      help: 'clock: in each cell A turns into A′ and back, the neighbours pull the hand; or felt change' },
    { id: 'side', keys: ['.'], label: 'sideways push', group: 'partner', type: 'toggle', get: () => PT().side,
      run: () => `sideways push ${flip(PT(), 'side') ? "on: the partner A' pushes at right angles (cells go round its blobs)" : 'off'}`,
      help: 'the partner pushes at right angles to its pull: curls and spirals' },

    // ---------- biology ----------
    // (step F0: key D, differentiation, and key I, inherit fate, went with the fates)
    { id: 'adhesion', keys: ['h'], label: 'adhesion', group: 'bio', type: 'toggle', get: () => rules().adh,
      run: () => `adhesion ${flip(rules(), 'adh') ? 'on: like sticks to like (the glue genes, similar keys)' : 'off'}`,
      help: 'like sticks to like (the glue genes, similar keys)' },
    { id: 'body', keys: ['b'], label: 'body traits', group: 'bio', type: 'toggle', get: () => rules().body,
      run: () => `body traits ${flip(rules(), 'body') ? 'on: size and motility from the genome' : 'off: all cells alike'}`,
      help: 'size, motility and crawling from the genome (off: all alike)' },
    { id: 'turnover', keys: ['t'], label: 'life cycle', group: 'bio', type: 'toggle', get: () => rules().turn,
      run: () => `life cycle ${flip(rules(), 'turn') ? (app.cells.division.params.on ? 'on: cells divide when their battery can pay for it and die when they starve or overheat (step C9)' : 'on: turnover, cells die now and then, a neighbour divides into the gap') : 'off: nothing is born and nothing dies'}`,
      help: 'births and deaths (step C9: by division, the count changes; or by turnover, a fixed count: rules panel, Division)' },
    { id: 'mutation', keys: ['m'], label: 'mutation', group: 'bio', type: 'toggle', get: () => rules().mut,
      run: () => `mutation ${flip(rules(), 'mut') ? 'on: daughters differ a little from their parent' : 'off: daughters are exact copies'}`,
      help: 'daughters differ a little from their parent (off: exact copies)' },

    // ---------- heat and light (Part C) ----------
    { id: 'kicks', keys: ['shift+h'], label: 'jitter from heat', group: 'heatlight', type: 'toggle', get: () => app.heat.params.kicks,
      run: () => (flip(app.heat.params, 'kicks')
        ? 'jitter from heat: each cell is kicked in a random direction, harder where it is hot; the kick uses that heat up'
        : 'jitter constant (as before Part C): the heat is still made, spread and leaked, but no longer shakes the cells'),
      help: 'each cell is kicked in a random direction, harder where it is hot (off: the old constant jitter)' },
    { id: 'lightMode', keys: ['shift+l'], label: 'light', group: 'heatlight', type: 'cycle', get: () => app.light.params.mode,
      options: () => ['spot', 'full', 'off'],
      set: (m) => { app.light.params.mode = m; return lightText(m); },
      run: () => { const P = app.light.params; P.mode = P.mode === 'spot' ? 'full' : P.mode === 'full' ? 'off' : 'spot'; return lightText(P.mode); },
      help: 'a spotlight, the full field, or no light; what is caught becomes heat' },
    { id: 'day', keys: ['shift+d'], label: 'day and night', group: 'heatlight', type: 'toggle', get: () => app.light.params.day,
      run: () => { const P = app.light.params; return flip(P, 'day') ? `day and night: the light rises and falls over ${P.dayPeriod} s` : 'no day and night: the light stays at full day'; },
      help: 'the light rises and falls over a day of 240 s of simulation time' },

    // ---------- chemistry in the open (step C4) ----------
    { id: 'chem', keys: ['shift+m'], label: 'chemistry', group: 'chem', type: 'toggle', get: () => CH().on,
      run: () => (flip(CH(), 'on')
        ? 'chemistry on: atoms bond into fuel in the light, fuel burns where it is hot, linkers crust into sediment'
        : 'chemistry off: the atoms only spread (as in step C3)'),
      help: 'every reaction at once (off: the atoms only spread, and nothing catches light)' },
    { id: 'makeFuel', keys: ['shift+f'], label: 'make fuel by light', group: 'chem', type: 'toggle', get: () => CH().make,
      run: () => `make fuel by light ${flip(CH(), 'make') ? 'on: a giver and a taker bond into green fuel where light of the fuel\'s band falls' : 'off'}${chemNote()}`,
      help: 'a giver and a taker bond into fuel where light of its band falls (gt: visible 1, gT Gt: visible 2, GT: hard)' },
    { id: 'burnFuel', keys: ['shift+b'], label: 'break fuel by heat', group: 'chem', type: 'toggle', get: () => CH().burn,
      run: () => `break fuel ${flip(CH(), 'burn') ? 'on: fuel falls apart where it is hot (and in hard light), its energy becomes heat' : 'off: fuel keeps'}${chemNote()}`,
      help: 'fuel falls apart where it is hot, or in hard light; its energy becomes heat (cold and dark: it keeps)' },
    { id: 'swaps', keys: ['shift+p'], label: 'swaps', group: 'chem', type: 'toggle', get: () => CH().swap,
      run: () => `swaps ${flip(CH(), 'swap') ? 'on: a free light atom takes the place of a heavy one in a fuel (t + gT → gt + T), heat comes out' : 'off'}${chemNote()}`,
      help: 'a free light atom takes a heavy one\'s place in a fuel (t + gT → gt + T); the difference becomes heat' },
    { id: 'sediment', keys: ['shift+k'], label: 'sediment', group: 'chem', type: 'toggle', get: () => CH().sediment,
      run: () => `sediment ${flip(CH(), 'sediment') ? 'on: linkers chain into dark crusts where it is warm; hard light cracks them' : 'off'}${chemNote()}`,
      help: 'linkers chain into dark crusts where it is warm (they warm up in the light); hard light slowly cracks them' },
    { id: 'traceSpark', keys: ['shift+t'], label: 'trace lowers the spark', group: 'chem', type: 'toggle', get: () => CH().trace,
      run: () => `trace ${flip(CH(), 'trace') ? 'lowers the spark: reactions run more easily where trace sits' : 'does nothing'}${chemNote()}`,
      help: 'reactions start more easily where trace sits (a catalyst)' },
  ];

  // ---------- cells eat (step C5) ----------
  const E = () => app.cells.eat.params;
  const eatNote = () => (E().on ? '' : ' (cells eat is off: Shift+A)');
  A.push(
    { id: 'eat', keys: ['shift+a'], label: 'cells eat', group: 'eat', type: 'toggle', get: () => E().on,
      run: () => (flip(E(), 'on')
        ? 'cells eat: they trade substances with the dish through their membrane, burn fuel into their battery (the green core), and pay for crawling with it'
        : 'cells do not eat: they ignore the substances (as in step C4); their stock and batteries stay as they are'),
      help: 'cells trade substances with the dish, burn fuel into a battery (the green core) and pay for crawling (off: as in C4)' },
    { id: 'burner', keys: ['shift+u'], label: 'everyone burns', group: 'eat', type: 'toggle', get: () => E().burner,
      run: () => `everyone burns ${flip(E(), 'burner') ? 'on: every cell has the built-in burner of step C5 (besides its own engines): the fuel it holds fills its battery, a quarter becomes heat' : 'off: only the engines in the genome make energy (step C6)'}${eatNote()}`,
      help: 'step C5\'s built-in burner in every cell, besides its own engines (off by default since step C6, to compare)' },
    { id: 'inside', keys: ['shift+i'], label: 'reactions inside', group: 'eat', type: 'toggle', get: () => E().inside,
      run: () => `reactions inside cells ${flip(E(), 'inside') ? 'on: the swaps, fuel breaking by heat and sediment run inside too, by the same rules (sediment is expelled)' : 'off'}${eatNote()}`,
      help: 'the chemistry\'s heat-driven reactions run inside cells too (light atoms that get in degrade rich fuel); sediment is expelled' },
    { id: 'payCrawl', keys: ['shift+w'], label: 'battery pays crawl', group: 'eat', type: 'toggle', get: () => E().pay,
      run: () => `battery pays for crawling ${flip(E(), 'pay') ? 'on: a cell crawls as fast as its battery allows and pays for it; an empty one only shivers' : 'off: every cell crawls for free'}${eatNote()}`,
      help: 'a cell crawls as fast as its battery allows and pays for it; an empty one only shivers with the heat' },
    { id: 'heatDamage', keys: ['shift+x'], label: 'heat damage', group: 'eat', type: 'toggle', get: () => E().heat,
      run: () => `heat damage ${flip(E(), 'heat') ? `on: cells die faster where the dish is hotter than ${E().tol} per R²` : 'off'}${eatNote()}`,
      help: 'cells die faster where the dish is hotter than they tolerate' },
    { id: 'biasTurn', keys: ['shift+g'], label: 'rich cells divide', group: 'eat', type: 'toggle', get: () => E().bias,
      run: () => `energy-biased turnover ${flip(E(), 'bias') ? 'on: when a cell dies, a neighbour with a fuller battery is more likely to divide into the gap' : 'off: any touching neighbour alike'}${eatNote()}`,
      help: 'when a cell dies, the neighbour with the fuller battery is more likely to divide into the gap' },
    { id: 'smell', keys: ['shift+n'], label: 'smell', group: 'eat', type: 'toggle', get: () => E().smell,
      run: () => `smell ${flip(E(), 'smell') ? 'on: the membrane\'s corners sense fuel; crawling steers up toward it' : 'off'}${eatNote()}`,
      help: 'the membrane\'s six corners sense fuel; crawling steers gently up toward it' },
  );

  // ---------- engines in the genome (step C6) ----------
  const engNote = () => (!E().on ? ' (cells eat is off: Shift+A)' : E().engines ? '' : ' (engines are off: Shift+O)');
  A.push(
    { id: 'engines', keys: ['shift+o'], label: 'engines', group: 'engines', type: 'toggle', get: () => E().engines,
      run: () => `engines ${flip(E(), 'engines') ? 'on: each cell runs the engines in its genome (the small marks inside it): harvest fuel with a pigment, burn, swap, make sediment' : 'off: no cell runs its engines (only "everyone burns", Shift+U, makes energy)'}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each cell runs the up to three engines in its genome (the small marks inside it): harvest, burn, swap, make sediment' },
    { id: 'pigments', keys: ['shift+y'], label: 'pigments', group: 'engines', type: 'toggle', get: () => E().pigments,
      run: () => `pigments ${flip(E(), 'pigments') ? 'on: a harvest engine\'s pigment catches its band of the light and makes fuel with it' : 'off: harvest engines catch nothing'}${engNote()}`,
      help: 'a harvest engine\'s pigment catches its band of the light (the round marks, in the band\'s colour) and makes fuel with it' },
    { id: 'upkeep', keys: ['shift+q'], label: 'upkeep', group: 'engines', type: 'toggle', get: () => E().upkeep,
      run: () => `upkeep ${flip(E(), 'upkeep') ? 'on: engines and a high heat tolerance cost the battery a little every second' : 'off: engines and tolerance are free'}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'faster engines and a higher heat tolerance cost the battery a little every second (as heat)' },
    { id: 'tolGene', keys: ['shift+z'], label: 'gene: heat tolerance', group: 'engines', type: 'toggle', get: () => E().tolGene,
      run: () => `heat tolerance ${flip(E(), 'tolGene') ? 'is a gene: each cell tolerates its own temperature (and pays upkeep for it)' : `the same for all: ${E().tol} per R²`}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each cell tolerates its own temperature, set by its genome (off: the same for all)' },
    { id: 'permGene', keys: ['shift+j'], label: 'gene: permeability', group: 'engines', type: 'toggle', get: () => E().permGene,
      run: () => `permeability ${flip(E(), 'permGene') ? 'is a gene: each cell\'s membrane lets substances through at its own rate' : `the same for all: ${E().perm} per s`}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each cell\'s membrane lets substances through at its own rate, set by its genome (off: the same for all)' },
  );

  // ---------- charge (step C6b; Shift + the digit keys 7 to 0, by their place on the keyboard) ----------
  const Q = () => app.charge.params;
  const qNote = () => (Q().on ? '' : ' (the charge field is off: Shift+7)');
  A.push(
    { id: 'chargeField', keys: ['shift+7'], label: 'charge field', group: 'charge', type: 'toggle', get: () => Q().on,
      run: () => (flip(Q(), 'on')
        ? 'charge field on: givers (+) and takers (−) make a screened field on the substrate; the free charged atoms drift in it, so a cloud spreads as pairs'
        : 'charge field off: the free atoms only spread (as before step C6b)'),
      help: 'givers (+1) and takers (−1) make a screened field (it fades over a few cell radii); free charged atoms drift in it, so fast and slow partners stay together' },
    { id: 'chargeStock', keys: ['shift+8'], label: 'cells\' charge from stock', group: 'charge', type: 'toggle', get: () => Q().stock,
      run: () => `a cell's charge in field B ${flip(Q(), 'stock') ? 'comes from what it holds: the net charge of its stock (givers minus takers)' : Q().genes ? 'comes from its own field genes (the sign of its B sensing gene; step C12g)' : 'is the fixed charge, one for all (step 5)'}` +
        `, like ${app.charge.signB > 0 ? 'repels' : 'attracts'} like (U)${app.cells.eat.params.on ? '' : ' (cells eat is off: Shift+A, so the fixed charges apply)'}`,
      help: 'a cell\'s charge in field B is the net charge of its stock (off, the default since step C12g: from its own field genes)' },
    { id: 'chargeFeel', keys: ['shift+9'], label: 'cells feel the charge field', group: 'charge', type: 'toggle', get: () => Q().feel,
      run: () => `cells ${flip(Q(), 'feel') ? 'feel the charge field: a charged cell drifts down (+) or up (−) the substrate\'s potential' : 'do not feel the charge field (field B still carries their charge)'}${qNote()}`,
      help: 'a charged cell is pushed through the substrate\'s field: + toward − clouds and back (needs the charge field)' },
    { id: 'oilLook', keys: [], label: 'oil films drawn', group: 'look', type: 'toggle', get: () => app.matter.oil.params.look,
      run: () => `oil films ${flip(app.matter.oil.params, 'look') ? 'drawn: dark glossy droplets with an iridescent rim, soap films as thin pearly lines' : 'not drawn'}`,
      help: 'step C12: the oil as dark glossy droplets with a thin iridescent rim, the soap films as thin pearly lines' },
    { id: 'exLook', keys: [], label: 'excited haze drawn', group: 'look', type: 'toggle', get: () => app.matter.excited.look.on,
      run: () => `the excited haze ${flip(app.matter.excited.look, 'on') ? 'drawn: a faint glitter of hot red-orange sparks that flicker and thin out as the atoms fade' : 'not drawn'}`,
      help: 'the excited light atoms (step C12c) as a faint flickering glitter of hot red-orange sparks' },
    { id: 'glowLook', keys: [], label: 'fluorescence glow drawn', group: 'look', type: 'toggle', get: () => ELECTRONS && app.matter.electrons.look.on,
      run: () => (ELECTRONS ? `the fluorescence ${flip(app.matter.electrons.look, 'on') ? 'drawn: tiny lights in the colour each substance emits, where light falls on it (gold, sky blue)' : 'not drawn'}` : 'the glow needs electrons'),
      help: 'step C12d: what fluoresces under the light, as a soft glow of tiny lights in the colour of the band it emits (a fluorescence microscope image)' },
    { id: 'polarity', keys: [], label: 'polarity wash', group: 'look', type: 'toggle', get: () => app.matter.oil.params.polarity,
      run: () => `polarity ${flip(app.matter.oil.params, 'polarity') ? 'shown: water-loving (polar) matter washed warm, water-shy (apolar) cool' : 'not shown'}`,
      help: 'step C12 (machinery): water-loving (polar) matter washed warm, water-shy (apolar) matter cool' },
    { id: 'chargeContours', keys: ['shift+0'], label: 'charge contours', group: 'look', type: 'toggle', get: () => Q().contours,
      run: () => `charge field ${flip(Q(), 'contours') ? 'drawn as contour lines: rose where it is +, blue where it is −' : 'not drawn'}${qNote()}`,
      help: 'the substrate\'s charge field as thin contour lines, + rose and − blue (also part of the machinery)' },
  );

  // ---------- membrane chemistry (step C6c; panel only: no keys are free) ----------
  const MB = () => app.cells.eat.membrane.params;
  const mbNote = () => (!E().on ? ' (cells eat is off: Shift+A)' : MB().on ? '' : ' (membrane chemistry is off)');
  A.push(
    { id: 'membrane', keys: [], label: 'membrane chemistry', group: 'membrane', type: 'toggle', get: () => MB().on,
      run: () => `membrane chemistry ${flip(MB(), 'on') ? 'on: each membrane is woven from linkers (light l, heavy L) out of the cell’s stock; a bitten side leaks and goes soft; the tubes show it' : 'off: membranes are what they were, untouched (no bites, no repair)'}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each membrane is a weave of linkers from the cell’s stock (its mix and thickness are genes); damaged sides leak and go soft; the tubes show their state' },
    { id: 'membBites', keys: [], label: 'bites', group: 'membrane', type: 'toggle', get: () => MB().bites,
      run: () => `bites ${flip(MB(), 'bites') ? 'on: free givers and takers bite membrane chains of their own row (light atoms the light weave, heavy the heavy), faster where it is hot' : 'off: free atoms leave membranes alone'}${mbNote()}`,
      help: 'free givers and takers outside a cell bite membrane chains of their own row: light atoms the light weave (l), heavy atoms the heavy (L)' },
    { id: 'membBurst', keys: [], label: 'bursting', group: 'membrane', type: 'toggle', get: () => MB().burst,
      run: () => `bursting ${flip(MB(), 'burst') ? 'on: a membrane bitten nearly through bursts, the cell spills everything and a neighbour divides into the gap' : 'off: a bitten cell only leaks'}${mbNote()}${app.cells.genome.rules.turn ? '' : ' (needs turnover: T)'}`,
      help: 'a membrane bitten nearly through bursts: the cell spills its contents (food for its neighbours) and a neighbour divides into the gap (needs turnover)' },
    { id: 'membElastic', keys: [], label: 'gene: elasticity', group: 'membrane', type: 'toggle', get: () => MB().elastic,
      run: () => `elasticity ${flip(MB(), 'elastic') ? 'is genetic: heavy, thick membranes are stiff, light thin ones soft and wobbly' : 'the same for all cells (the shape panel’s stiffness)'}${mbNote()}`,
      help: 'each cell’s stiffness comes from its membrane: heavy and thick = stiff, light and thin = soft (times a small stiffness gene)' },
    { id: 'membSelect', keys: [], label: 'gene: ion selectivity', group: 'membrane', type: 'toggle', get: () => MB().select,
      run: () => `ion selectivity ${flip(MB(), 'select') ? 'is a gene: some membranes let givers (+) through more easily than takers (−), or the other way round' : 'off: givers and takers pass alike'}${mbNote()}`,
      help: 'a gene lets givers (+) through the membrane more easily than takers (−), or the other way round, so cells can become charged' },
  );

  // ---------- charge per side: dipoles (step C6d; panel only: no keys are free) ----------
  const DP = () => app.cells.dipole.params;
  const dpNote = () => (DP().on ? '' : ' (dipoles are off)');
  const knob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'dipole', type: 'knob', get: () => DP()[key].toFixed(digits),
    run: (k) => { const p = DP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}${dpNote()}`; }, help });
  A.push(
    { id: 'dipoles', keys: [], label: 'dipoles', group: 'dipole', type: 'toggle', get: () => DP().on,
      run: () => `dipoles ${flip(DP(), 'on') ? 'on: each side of a cell holds its own charge, where the charged atoms came in or went out; + and − ends make the cell a dipole' : 'off: a cell’s charge is spread evenly round it'}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each side of a cell holds its own share of the cell’s charge, from where charged atoms came in or went out; a cell with a + end and a − end is a dipole' },
    { id: 'dipDD', keys: [], label: 'dipole-dipole', group: 'dipole', type: 'toggle', get: () => DP().dd,
      run: () => `dipole-dipole ${flip(DP(), 'dd') ? 'on: neighbouring dipoles turn each other to line up head to tail, attract head to tail and push apart side by side' : 'off: dipoles do not feel each other'}${dpNote()}`,
      help: 'neighbouring dipoles turn each other to line up head to tail, attract head to tail and push apart side by side (short range)' },
    { id: 'dipPhi', keys: [], label: 'substrate field on the sides', group: 'dipole', type: 'toggle', get: () => DP().phi,
      run: () => `the substrate’s charge field ${flip(DP(), 'phi') ? 'pulls the + and − ends of each cell opposite ways' : 'does not act on the side charges (only on the net charge, Shift+9)'}${dpNote()}`,
      help: 'the substrate’s charge field (Shift+7) pulls a cell’s + end and − end opposite ways' },
    { id: 'dipField', keys: [], label: 'field turns and stretches cells', group: 'dipole', type: 'toggle', get: () => DP().field,
      run: () => `the field ${flip(DP(), 'field') ? 'turns each dipole toward it (the cell and the charges in it) and stretches the cell along it, which strains its lattice' : 'does not turn or stretch the cells'}${dpNote()}`,
      help: 'the field at a dipole turns it toward the field (the cell and the charges inside it) and stretches the cell along it: the strained lattice changes its fields (a form ↔ field loop)' },
    knob('dipRelax', 'evening out', 'relax', 0.05, 10, 1.5, 2, 'how fast the side charges even out inside the cell (per s; small = long-lived dipoles)'),
    knob('dipHalf', 'dipole scale', 'pHalf', 0.0005, 0.05, 1.5, 4, 'the charge difference (atom-units) that counts as a strong dipole: smaller = more cells strongly polarised'),
    knob('dipTurn', 'turning', 'turn', 1, 300, 1.5, 0, 'how hard the field turns a dipole cell (the honeycomb’s own turning toward its neighbours is 40)'),
    knob('dipPush', 'dipole push', 'push', 0.05, 10, 1.5, 2, 'how hard dipoles attract head to tail and push apart side by side'),
    knob('dipRange', 'dipole range', 'range', 1, 1.5, 1.1, 2, 'how far dipoles feel each other, × the contact distance'),
    knob('dipStretch', 'stretch along the field', 'stretch', 0.02, 0.5, 1.4, 2, 'how far a polarised cell stretches along the field'),
  );

  // ---------- pumps and the membrane voltage (step C7; panel only: no keys are free) ----------
  const PU = () => app.cells.eat.pumps.params;
  const puNote = () => (!E().on ? ' (cells eat is off: Shift+A)' : PU().on ? '' : ' (pumps are off)');
  const pknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'pumps', type: 'knob', get: () => PU()[key].toFixed(digits),
    run: (k) => { const p = PU(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}${puNote()}`; }, help });
  A.push(
    { id: 'pumps', keys: [], label: 'pumps', group: 'pumps', type: 'toggle', get: () => PU().on,
      run: () => `pumps ${flip(PU(), 'on') ? 'on: each genome’s two pump slots move one substance in or out through the membrane; down its gradient for free, up it at a cost to the battery' : 'off: substances pass the membrane only by leaking'}${E().on ? '' : ' (cells eat is off: Shift+A)'}`,
      help: 'each genome has two pump slots: a substance, in or out, a rate; pumping down a gradient is free, up it costs battery (more the steeper); what the battery cannot pay is not pumped' },
    { id: 'pumpContact', keys: [], label: 'pumps across contact', group: 'pumps', type: 'toggle', get: () => PU().contact,
      run: () => `pumps across contact ${flip(PU(), 'contact') ? 'on: a side touching a neighbour pumps from its stock or into it' : 'off: pumps trade only with the dish just outside the cell'}${puNote()}`,
      help: 'a side touching a neighbour pumps from that neighbour’s stock (in) or into it (out) instead of the dish' },
    { id: 'pumpVolt', keys: [], label: 'membrane voltage', group: 'pumps', type: 'toggle', get: () => PU().voltage,
      run: () => `membrane voltage ${flip(PU(), 'voltage') ? 'on: pumped charge (givers +, takers −) builds a voltage that makes pumping more of the same sign dearer; it leaks back slowly' : 'off: pumping charge costs no more than pumping anything else'}${puNote()}`,
      help: 'pumping charged atoms builds a voltage across the membrane: more of the same sign the same way costs more; it leaks back through the membrane' },
    { id: 'pumpV2B', keys: [], label: 'voltage pays the battery', group: 'pumps', type: 'toggle', get: () => PU().v2b,
      run: () => `the voltage ${flip(PU(), 'v2b') ? 'pays part of its energy back into the battery as it leaks: a second battery' : 'leaks back as heat only'}${puNote()}${PU().voltage ? '' : ' (membrane voltage is off)'}`,
      help: 'as the voltage leaks back through the membrane, part of its energy flows into the battery (a second battery); off: all of it becomes heat' },
    pknob('pumpBase', 'base cost', 'base', 0.005, 2, 1.5, 3, 'energy per unit a pump pays to move a substance up its gradient at all (down it is free)'),
    pknob('pumpGrad', 'gradient cost', 'grad', 0.005, 2, 1.5, 3, 'energy per unit for each e-fold up the gradient (steeper = dearer)'),
    pknob('pumpMax', 'max rate', 'maxRate', 0.1, 6, 1.5, 2, 'the fastest a pump slot runs (per s), whatever its gene says'),
    pknob('pumpLeak', 'voltage leak', 'vLeak', 0.02, 10, 1.5, 2, 'how fast the membrane voltage leaks back (per s; leaky and damaged membranes faster)'),
    pknob('pumpV2BEff', 'voltage to battery', 'v2bEff', 0.05, 1, 1.25, 2, 'the share of the voltage’s energy that goes back into the battery as it leaks'),
  );

  // ---------- catalysts (step C7b; panel only: no keys are free) ----------
  const CA = () => app.cells.eat.catalysts.params;
  const cknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'catalysts', type: 'knob', get: () => CA()[key].toFixed(digits),
    run: (k) => { const p = CA(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'crystal', keys: [], label: 'crystal seeding', group: 'catalysts', type: 'toggle', get: () => CA().crystal,
      run: () => `crystal seeding ${flip(CA(), 'crystal') ? 'on: sediment makes its own chains form more easily where it already is, so crust grows on crust and at its edges' : 'off: linkers chain into sediment wherever they meet, by heat alone'}${app.matter.chem.on && app.matter.chem.sediment ? '' : ' (sediment is off: Shift+K, Shift+M)'}`,
      help: 'sediment lowers the spark of its own formation (ll seeds ll, LL seeds LL): crust grows on crust (autocatalysis); in the open only' },
    { id: 'cofactor', keys: [], label: 'trace as cofactor', group: 'catalysts', type: 'toggle', get: () => CA().cofactor,
      run: () => `trace as cofactor ${flip(CA(), 'cofactor') ? 'on: a cell’s engines run faster the more trace it holds (without any, at a floor)' : 'off: the engines run at their genes’ rates whatever trace the cell holds'}${E().on && E().engines ? '' : ' (the engines are not running: Shift+A, Shift+O)'}`,
      help: 'an engine’s rate scales with the trace inside the cell, saturating, down to a floor without trace: trace becomes a scarce vitamin' },
    cknob('crystalS0', 'seeding scale', 's0', 0.005, 5, 1.5, 3, 'sediment per R² that halves the spark of its own formation (smaller = stronger seeding)'),
    cknob('crystalFloor', 'spark floor', 'floor', 0.02, 1, 1.25, 2, 'the seeded spark never falls below this share of itself'),
    cknob('cofF0', 'speed without trace', 'f0', 0.02, 1, 1.25, 2, 'how fast an engine runs with no trace inside the cell, as a share of its rate'),
    cknob('cofHalf', 'trace half', 'tHalf', 1e-5, 1, 1.5, 5, 'trace per R² inside a cell that brings its engines half the way from the floor to full speed'),
  );

  // ---------- oils and water (step C12; panel only: no keys are free) ----------
  const OL = () => app.matter.oil.params;
  const oknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'oil', type: 'knob', get: () => OL()[key].toFixed(digits),
    run: (k) => { const p = OL(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  const SPRING_WORDS = { oil: 'oil (lL)', emulsion: 'oil with a little soap', soap: 'soap (the amphiphiles glL and tlL)' };
  A.push(
    { id: 'oil', keys: [], label: 'oils and water', group: 'oil', type: 'toggle', get: () => OL().on,
      run: () => `oils and water ${flip(OL(), 'on') ? 'on: light and heavy linkers chain into oil where they meet, oil gathers into droplets, soap coats them' : 'off: no oil forms or separates (what is in the dish only spreads)'}`,
      help: 'the master: l + L chain into oil (lL), light puts charged heads on oil (soap), and water-shy matter separates from water-loving' },
    { id: 'phase', keys: [], label: 'phase separation', group: 'oil', type: 'toggle', get: () => OL().phase,
      run: () => `phase separation ${flip(OL(), 'phase') ? 'on: oil gathers with oil into droplets, polar matter is pushed out of them, soap goes to their rims' : 'off: oil, soap and the rest only spread'}`,
      help: 'water-shy matter drifts toward oil, water-loving matter away from it, amphiphiles to the oil-water boundary (polarity from the atoms)' },
    { id: 'amphi', keys: [], label: 'amphiphiles (soap)', group: 'oil', type: 'toggle', get: () => OL().amphi,
      run: () => `amphiphiles ${flip(OL(), 'amphi') ? 'on: light puts a charged head on oil (g + lL → glL, t + lL → tlL), heat takes it off; soap gathers on the rims and slows oil crossing them' : 'off: no heads put on or taken off, soap only spreads'}`,
      help: 'a charged head on an oil tail: made by visible light, broken by heat; collects on oil-water boundaries and makes a skin oil hardly crosses' },
    { id: 'fusion', keys: [], label: 'membrane fusion', group: 'oil', type: 'toggle', get: () => OL().fusion,
      run: () => `membrane fusion ${flip(OL(), 'fusion') ? 'on: a cell whose membrane is short of linkers takes in the oil under it (each unit opens into l + L, the battery pays the chain’s energy)' : 'off: membranes are woven from free linkers only'}${app.matter.oil.fusionOn || !OL().fusion ? '' : ' (needs the cells eating and the membrane chemistry)'}`,
      help: 'membranes are linker chains, so oily: a cell short of membrane takes the oil under it in, paying the chain’s energy from its battery' },
    { id: 'oilSpring', keys: [], label: 'oil tool drops', group: 'oil', type: 'cycle', get: () => OL().spring,
      options: () => ['oil', 'emulsion', 'soap'],
      set: (v) => { OL().spring = v; return `the oil tool drops ${SPRING_WORDS[v]}`; },
      run: () => { const p = OL(), o = ['oil', 'emulsion', 'soap']; p.spring = o[(o.indexOf(p.spring) + 1) % 3]; return `the oil tool drops ${SPRING_WORDS[p.spring]}`; },
      help: 'what a tap with the oil tool drops: oil, oil with a little soap, or soap' },
    oknob('oilGain', 'oil’s pull', 'gain', 1, 30, 1.25, 2, 'how strongly water-shy matter gathers (and polar matter is pushed out): higher = sharper, smaller droplets; below about 4 oil stays dissolved'),
    oknob('oilFull', 'oil per full pixel', 'full', 0.1, 20, 1.25, 2, 'oil atoms per R² that fill a pixel: a droplet packs to this, then grows in area'),
    oknob('oilSkin', 'soap skin', 'skin', 0, 50, 1.5, 2, 'a full soap film slows oil crossing it to 1 / (1 + this): coated droplets hold together and merge less'),
    oknob('oilFilm', 'soap per full film', 'filmFull', 0.05, 10, 1.25, 2, 'amphiphile atoms per R² that make a full film in a pixel'),
  );

  // ---------- lipid membranes (step C12b; panel only: no keys are free) ----------
  const LI = () => app.cells.eat.lipids.params;
  const liNote = () => (!E().on ? ' (cells eat is off: Shift+A)' : !MB().on ? ' (membrane chemistry is off)' : LI().on ? '' : ' (lipid membranes are off)');
  const lknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'lipids', type: 'knob', get: () => LI()[key].toFixed(digits),
    run: (k) => { const p = LI(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'lipids', keys: [], label: 'lipid membranes', group: 'lipids', type: 'toggle', get: () => LI().on,
      run: () => `lipid membranes ${flip(LI(), 'on') ? 'on: each membrane is a soap bilayer (pearly, soft), stiffened by oil between its tails (glossy), with a crust wall outside if the genes ask (an amber rim: rigid, brittle); how stiff each side is follows from what it is made of' : 'off: the C6c membrane, a weave of linkers (the lipids are shed into the dish)'}${E().on && MB().on ? '' : ' (needs the cells eating and the membrane chemistry)'}`,
      help: 'membranes made of lipids: soap (a charged head on an oily tail) is the bilayer, oil between its tails stiffens it, a crust wall outside makes it rigid; the stiffness is derived from the mix' },
    { id: 'lipHeat', keys: [], label: 'heat fluidises', group: 'lipids', type: 'toggle', get: () => LI().heat,
      run: () => `heat ${flip(LI(), 'heat') ? 'makes the bilayer fluid: hot cells are softer (stiffness × 2 / (1 + temperature / Tref))' : 'leaves the bilayer as it is'}${liNote()}`,
      help: 'a hot bilayer is more fluid: its stiffness falls with the temperature under the cell (oilier membranes stay stiffer)' },
    { id: 'lipCrack', keys: [], label: 'walls crack', group: 'lipids', type: 'toggle', get: () => LI().crack,
      run: () => `walls ${flip(LI(), 'crack') ? 'crack: where a walled cell is jolted (shoved, stirred) its crust breaks off into the dish' : 'never crack'}${liNote()}`,
      help: 'a crust wall is a crystal, rigid and brittle: a cell jolted hard (shoved, stirred) breaks the crust of the jolted sides off; slow packing does not' },
    { id: 'lipHeads', keys: [], label: 'soap heads charge', group: 'lipids', type: 'toggle', get: () => LI().heads,
      run: () => `soap heads ${flip(LI(), 'heads') ? 'charge the cell and its sides: glL (+), tlL (−) in the membrane count in its charge (field B, the substrate’s field, dipoles)' : 'carry no charge for the fields (the books still count them)'}${liNote()}`,
      help: 'a membrane rich in glL (+) or tlL (−) charges its cell and, with dipoles on, its own sides' },
    { id: 'lipGraze', keys: [], label: 'cells graze crust', group: 'lipids', type: 'toggle', get: () => LI().graze,
      run: () => `cells ${flip(LI(), 'graze') ? 'graze crust: the crust under a cell is taken in, whole into its wall, or cracked back into linkers for its bilayer (uphill: the battery pays the bonds and their sparks); colonies clear paths through crust fields' : 'leave the crust alone (the builder uses free linkers only)'}${liNote()}`,
      help: 'a cell takes the crust lying under it: whole into its wall, or cracked back into linkers for its soap and oil (the table’s reverse reaction, paid from the battery)' },
    lknob('lipTref', 'soap stiff at', 'tRef', 0.25, 64, 1.25, 2, 'the temperature (heat per R²) at which a pure soap bilayer has stiffness 1; above it softer, below stiffer'),
    lknob('lipCrackAt', 'wall cracks at', 'crackAt', 0.02, 2, 1.25, 2, 'a corner jolted into a swing this large (a share of the radius) cracks its two sides’ crust'),
    lknob('lipFuse', 'lipid fusion', 'fuseK', 0.01, 20, 1.5, 2, 'share of a side’s missing soap or oil it takes from the dish under the cell per s'),
  );

  // ---------- excited waste (step C12c; panel only: no keys are free) ----------
  const XP = () => app.matter.excited.params;
  const xknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'excited', type: 'knob', get: () => XP()[key].toFixed(digits),
    run: (k) => { const p = XP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'excited', keys: [], label: 'excited waste', group: 'excited', type: 'toggle', get: () => XP().on,
      run: () => `excited waste ${flip(XP(), 'on') ? `on: a light atom freed by light leaves excited, holding ${app.matter.excited.table.energy} of the photon; it fades by itself (heat), and whatever reaction takes it releases that energy: an engine into the battery, anything else as heat` : 'off: freed light atoms carry no energy (the excited ones still there fade away)'}`,
      help: 'a light atom freed by light (an uphill swap) leaves excited, holding part of the photon: breathing it in an engine pays the battery more, loose reactions and bites dump it as heat' },
    xknob('exLife', 'excited lifetime', 'life', 0.5, 600, 1.5, 1, 'seconds an excited atom lasts in a cold dish before it fades back (faster where it is hot)'),
    xknob('exHot', 'fades twice as fast at', 'hot', 0.25, 64, 1.5, 2, 'the temperature (heat per R²) at which excited atoms fade twice as fast as in the cold'),
    { id: 'exShare', keys: [], label: 'share of the photon kept', group: 'excited', type: 'knob', get: () => app.matter.excited.table.share.toFixed(2),
      run: () => `the share is set when the page loads (?exshare=${app.matter.excited.table.share}): E* = ${app.matter.excited.table.energy} (the excited atoms already made hold it)`,
      help: 'the share of the photon’s surplus an excited atom keeps; fixed for the page (URL ?exshare=), as the atoms already made hold that much' },
  );

  // ---------- electrons (step C12d; panel only: no keys are free) ----------
  const EL = () => app.matter.electrons, ELP = () => app.matter.electrons.params;
  const eknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'electrons', type: 'knob', get: () => ELP()[key].toFixed(digits),
    run: (k) => { const p = ELP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'electrons', keys: [], label: 'electrons (reloads)', group: 'electrons', type: 'toggle', get: () => ELECTRONS,
      run: () => {
        const u = new URL(location.href);
        u.searchParams.set('electrons', ELECTRONS ? '0' : '1');
        setTimeout(() => location.assign(u.href), 600);
        return `reloading with ${ELECTRONS ? 'the old table (step C4: a bond is a battery light charges)' : 'electrons (bonds release, free atoms are the restless state)'}: the table is fixed for the page`;
      },
      help: 'bonds rebuilt around electrons: givers give, takers take, bonds release energy, light pushes electrons back up; off: the old table. The table belongs to the page, so switching reloads it (a fresh dish)' },
    { id: 'fluor', keys: [], label: 'fluorescence', group: 'electrons', type: 'toggle', get: () => ELECTRONS && ELP().fluor,
      run: () => (ELECTRONS ? `fluorescence ${flip(ELP(), 'fluor') ? 'on: an excited substance can fall back by emitting the next lower band (it glows in that colour)' : 'off: what would fluoresce turns into heat'}` : 'fluorescence needs electrons'),
      help: 'an excited substance falls back by emitting the next lower band (absorb high, emit low): soap and minerals glow blue under hard light, fuel GT and free t gold under visible 2' },
    { id: 'photo', keys: [], label: 'excited states react', group: 'electrons', type: 'toggle', get: () => ELECTRONS && ELP().photo,
      run: () => (ELECTRONS ? `excited states ${flip(ELP(), 'photo') ? 'react: light splits and upgrades what absorbs it (photochemistry, in the open)' : 'do not react: light only excites, fluoresces and warms'}` : 'needs electrons'),
      help: 'a substance excited by light reacts more easily (half its spark): it can split, or swap or trade uphill, the photon paying the rise (photochemistry)' },
    eknob('elKabs', 'absorption depth', 'kAbs', 0.01, 50, 1.5, 2, 'optical depth of a substance for a band its gap matches, per unit per R²'),
    eknob('elYrx', 'share that reacts', 'yRx', 0, 1, 1.25, 2, 'share of the excitations that react, where a reaction is open to them'),
    eknob('elYfl', 'share that glows', 'yFl', 0, 1, 1.25, 2, 'share of the rest that fluoresces (the others turn into heat)'),
  );

  // ---------- waste must leave (step C12e; panel only: no keys are free) ----------
  const WP = () => app.cells.eat.waste.params;
  const wsknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'waste', type: 'knob', get: () => WP()[key].toFixed(digits),
    run: (k) => { const p = WP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'saturation', keys: [], label: 'saturation', group: 'waste', type: 'toggle', get: () => WP().saturation,
      run: () => `saturation ${flip(WP(), 'saturation') ? 'on: a reaction inside a cell slows as its own products pile up (a big release clogs late, a small one early)' : 'off: products never slow a reaction'}`,
      help: 'mass action: every reaction inside a cell runs × (1 − Q/K), Q its products over its reactants, K = exp(the energy it gives off / theta T): waste left inside clogs the engines that made it' },
    { id: 'osmosis', keys: [], label: 'osmosis', group: 'waste', type: 'toggle', get: () => WP().osmosis,
      run: () => `osmosis ${flip(WP(), 'osmosis') ? 'on: free ions inside swell a cell (outside ones shrink it), resisted by its membrane' : 'off: no swelling (the stretch genes still drift: the neutral control)'}`,
      help: 'free ions (free givers and takers) inside minus outside swell the cell against its membrane’s stiffness (a crust wall holds hardest); binding them into molecules lowers the load' },
    { id: 'stretch', keys: [], label: 'stretch opens channels', group: 'waste', type: 'toggle', get: () => WP().stretch,
      run: () => `stretch channels ${flip(WP(), 'stretch') ? 'open: a swollen membrane leaks more (the gene sets how much)' : 'closed: swelling does not change the leak'}`,
      help: 'a stretched membrane’s channels open (a gene, like bacteria’s mechanosensitive channels): the passive exchange × (1 + kStretch × e^gene × swelling)' },
    { id: 'tear', keys: [], label: 'overstretch tears', group: 'waste', type: 'toggle', get: () => WP().tear,
      run: () => `overstretch ${flip(WP(), 'tear') ? 'tears: past its stretch tolerance (a gene) a whole membrane bursts' : 'never tears'}${rules().turn ? '' : ' (bursting needs the life cycle, key T)'}`,
      help: 'past its stretch tolerance (a gene, paid as upkeep) a whole membrane tears and the cell bursts, spilling its contents' },
    { id: 'tolcost', keys: [], label: 'tolerance costs', group: 'waste', type: 'toggle', get: () => WP().cost,
      run: () => `the stretch tolerance ${flip(WP(), 'cost') ? 'costs upkeep (in proportion to it)' : 'is free'}`,
      help: 'a membrane that bears more stretch costs upkeep from the battery, in proportion to the tolerance' },
    { id: 'photolysis', keys: [], label: 'light frees atoms (open)', group: 'waste', type: 'toggle', get: () => ELECTRONS && ELP().photolysis,
      run: () => (ELECTRONS ? `photolysis ${flip(ELP(), 'photolysis') ? 'on: light can split minerals and free atoms in the open dish' : 'off: light only excites, glows and warms in the open: any free t in the dish is made by life'}` : 'needs electrons'),
      help: 'whether light can free atoms in the open dish (split water-like minerals, swap uphill); off: only cells (their pigments) make free t' },
    wsknob('satScale', 'saturation scale', 'satScale', 0.05, 20, 1.5, 2, 'K = exp(drive / (scale × theta × T)): above 1 reactions clog sooner'),
    wsknob('kOsm', 'swelling per pressure', 'kOsm', 0.01, 20, 1.5, 2, 'how much a cell swells (area share) per unit of osmotic pressure, at stiffness 1'),
    wsknob('kStretch', 'stretch channels', 'kStretch', 0.01, 50, 1.5, 2, 'the passive exchange × (1 + this × e^gene × swelling)'),
    wsknob('wTol', 'stretch tolerance', 'wTol', 0.02, 5, 1.25, 2, 'the swelling a whole membrane bears at gene 0 (× e^gene) before it tears'),
  );

  // ---------- ion flow (step C12g; panel only: no keys are free) ----------
  const IP = () => app.cells.eat.ions.params;
  const ioknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'ions', type: 'knob', get: () => IP()[key].toFixed(digits),
    run: (k) => { const p = IP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'ionblock', keys: [], label: 'bilayer blocks ions', group: 'ions', type: 'toggle', get: () => IP().block,
      run: () => `the bilayer ${flip(IP(), 'block') ? `blocks free ions: an intact membrane passes them at ${IP().ionPass} of a neutral molecule's rate, plus its channels; holes pass them freely` : 'passes free ions like any molecule (as before step C12g)'}${app.cells.eat.membrane.rule('on') ? '' : ' (needs the membrane chemistry)'}`,
      help: 'a lipid bilayer is a barrier for charged atoms: its intact share passes free givers and takers only through channels (and a small leak); damaged sides (holes) and the stretch channels pass them freely; a crust wall is porous' },
    { id: 'ionchannels', keys: [], label: 'channel genes', group: 'ions', type: 'toggle', get: () => IP().genes,
      run: () => `channel genes ${flip(IP(), 'genes') ? 'act: each cell its own cation and anion channel (level gene × balance gene)' : `off: every cell's channels at the base level ${IP().chanBase}, balanced (the genes still drift: the neutral control)`}`,
      help: 'two genes set the channels: a LEVEL (how open, a log factor) and a BALANCE (the C6c selectivity): cation channel = base × e^level × (1 + balance), anion channel = base × e^level × (1 − balance)' },
    { id: 'ionvolt', keys: [], label: 'voltage pushes ions', group: 'ions', type: 'toggle', get: () => IP().volt,
      run: () => `ions through the intact membrane ${flip(IP(), 'volt') ? 'feel the membrane voltage: a + cell pushes free givers out and pulls free takers in' : 'do not feel the voltage'}`,
      help: 'a toy of electrophysiology: what crosses through channels settles at inside / outside = exp(−charge × kV × voltage) instead of equal concentrations' },
    ioknob('ionPass', 'bilayer ion leak', 'ionPass', 0, 1, 1.5, 3, 'share of a neutral molecule’s rate at which an intact bilayer lets free ions through by itself'),
    ioknob('chanBase', 'channel base level', 'chanBase', 0.001, 1, 1.5, 3, 'the channels’ level at gene 0 (the founders’), as a share of a neutral molecule’s rate'),
    ioknob('ionKV', 'voltage push', 'kV', 0.1, 50, 1.5, 2, 'with "voltage pushes ions": inside / outside = exp(−charge × this × voltage)'),
  );

  // ---------- whole membranes (step M1; panel only: no keys are free) ----------
  const MP = () => app.cells.eat.whole.params;
  A.push(
    { id: 'oilsoap', keys: [], label: 'head on oil', group: 'whole', type: 'toggle', get: () => MP().oilSoap,
      run: () => `cells ${flip(MP(), 'oilSoap') ? 'put a head (g or t from the stock) on oil to make the soap their bilayer lacks: the table’s “head on”, inside the cell, the spark from the battery' : 'make soap only from atoms (head + l + L) or take it from the dish (as step C12b); oil on a side without soap is shed'}`,
      help: 'oil (lL) is soap without its head: a cell short of soap that holds oil and a free giver or taker joins them (g + lL → glL, t + lL → tlL), paying the bond’s spark' },
    { id: 'biteblock', keys: [], label: 'bites through the block', group: 'whole', type: 'toggle', get: () => MP().biteBlock,
      run: () => `free atoms ${flip(MP(), 'biteBlock') ? 'bite a bilayer where it is damaged: an intact one keeps these ions off its chains, as it keeps them out (bitten × (1 − integrity + integrity × the ion leak))' : 'bite a bilayer anywhere, whole or not (as step C12b)'}${app.cells.eat.ions.params.block ? '' : ' (needs “bilayer blocks ions”)'}`,
      help: 'the biting atoms are ions; an intact bilayer keeps ions away from its oily core (step C12g), so they reach its chains only at holes (and through the bilayer’s own small ion leak)' },
  );

  // ---------- tissues 1: an inside, kin channels, the self marker (step T1a; panel only: no keys are free) ----------
  const KP = () => app.cells.kin.params;
  const kknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 't1a', type: 'knob', get: () => KP()[key].toFixed(digits),
    run: (k) => { const p = KP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'inside', keys: [], label: 'an inside', group: 't1a', type: 'toggle', get: () => KP().inside,
      run: () => `a side pressed against a neighbour ${flip(KP(), 'inside') ? 'does not trade with the dish: only the free sides meet the haze, vandal atoms, oxygen, the soap and crust under the cell (rim cells exposed, inner cells sheltered)' : 'trades with the dish under it like any other (as before step T1a)'}`,
      help: 'every exchange with the dish (passive, fusion, grazing, bites, pumps to the dish, osmosis’s outside) goes through the free sides only; light and heat reach every cell' },
    { id: 'kinchan', keys: [], label: 'kin channels', group: 't1a', type: 'toggle', get: () => KP().channels,
      run: () => `kin channels ${flip(KP(), 'channels') ? 'open: touching cells that accept each other as kin (by their markers) share fuel, free linkers and trace down the gradient, free (a gene sets how far)' : 'closed'}`,
      help: 'gap junctions: conductance = the smaller of the two cells’ (channel gene × how far it accepts the other as kin) × kinK × the shared wall' },
    { id: 'kinblind', keys: [], label: 'channels blind to kin', group: 't1a', type: 'toggle', get: () => KP().blind,
      run: () => `kin channels ${flip(KP(), 'blind') ? 'open to EVERY neighbour (control: kinship ignored)' : 'open only to kin (by the markers)'}`,
      help: 'a control: does recognising kin matter, or only sharing?' },
    { id: 'kinnull', keys: [], label: 'kin channels neutral control', group: 't1a', type: 'toggle', get: () => KP().null,
      run: () => `kin channels ${flip(KP(), 'null') ? 'move nothing (NEUTRAL CONTROL: their genes still drift)' : 'act'}`,
      help: 'the neutral control: the genes drift as usual but have no effect, to tell selection from noise' },
    { id: 'clock', keys: [], label: 'marker clock', group: 't1a', type: 'toggle', get: () => KP().clock,
      run: () => `the self marker ${flip(KP(), 'clock') ? 'drifts at every birth (a molecular clock): relatives far apart in time look less alike' : 'is copied exactly at birth'}`,
      help: 'with mutation on (key M), each birth turns the marker’s angle, period and phase a little' },
    { id: 'clockhard', keys: [], label: 'clock by hard light', group: 't1a', type: 'toggle', get: () => KP().clockHard,
      run: () => `the marker clock ${flip(KP(), 'clockHard') ? 'also ticks with hard light’s extra mutation (cells under hard light lose their kinship faster)' : 'ticks only with mutation itself, not with hard light’s extra dose (step T1c)'}`,
      help: 'step T1c: off, a lineage under hard light keeps its kinship as readable as one in the shade (?clockhard=0)' },
    { id: 'smelltrace', keys: [], label: 'smell for trace', group: 't1a', type: 'toggle', get: () => KP().smellTrace,
      run: () => `the membrane’s corners ${flip(KP(), 'smellTrace') ? 'smell trace too, as strongly as its lack holds the cell’s engines back: cells short of trace climb its plumes' : 'smell the fuels only'}`,
      help: 'a unit of trace smells like traceWorth units of the richest fuel × (1 − the cofactor at the trace inside) / (1 − f0)' },
    kknob('kinK', 'kin channel rate', 'kinK', 0.01, 50, 1.5, 2, 'per s at full conductance, per R of shared wall (× each molecule’s own speed)'),
    kknob('kinSeal', 'seal', 'seal', 0, 1, 1.25, 2, 'a covered side’s share closed to the dish'),
    kknob('kinPress', 'press', 'press', 0.8, 1.6, 1.05, 2, 'a side counts as covered by a neighbour closer than this × the two radii'),
    kknob('clockSize', 'clock size', 'clockSize', 0.05, 20, 1.5, 2, 'the marker’s drift per birth, × (angle 0.02 rad, period 1 %, phase 0.05 rad)'),
    kknob('traceWorth', 'trace worth', 'traceWorth', 0.5, 2000, 1.5, 1, 'a unit of trace smells like this many units of the richest fuel to a cell without trace'),
    { id: 'founderMode', keys: [], label: 'founders', group: 't1a', type: 'cycle', get: () => app.cells.genome.params.founderMode,
      options: () => ['std', 'blank', 'wild'],
      set: (v) => { app.cells.genome.params.founderMode = ['std', 'blank', 'wild'].includes(v) ? v : 'std'; return `founders ${app.cells.genome.params.founderMode} (G or N draws them)`; },
      run: () => { const G = app.cells.genome.params, M = ['std', 'blank', 'wild']; G.founderMode = M[(M.indexOf(G.founderMode) + 1) % 3]; return `founders ${G.founderMode}: ${G.founderMode === 'wild' ? 'every gene over its whole range' : G.founderMode === 'blank' ? 'the new abilities at 0 (no pumps, gates, kin channels)' : 'today’s'} (G or N draws them)`; },
      help: 'std: today’s founders; blank: the new abilities at 0 (they must evolve); wild: every gene drawn over its whole range' },
  );

  // ---------- the gene network (step T1b; panel only: no keys are free) ----------
  const GNP = () => app.cells.grn.params;
  const grknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 't1b', type: 'knob', get: () => GNP()[key].toFixed(digits),
    run: (k) => { const p = GNP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'grn', keys: [], label: 'gene network', group: 't1b', type: 'toggle', get: () => GNP().on,
      run: () => `the gene network ${flip(GNP(), 'on') ? 'runs: 8 regulators per cell, expression set by the cell’s senses and each other, modulating its genes (engines, pigment, wall, glue, pumps, …)' : 'is frozen and has no effect (as before step T1b)'}`,
      help: 'x ← x + dt/τ (sigmoid(b + Σ w·source) − x); each output multiplies a gene by exp(u·x); upkeep follows the expressed engine rates' },
    { id: 'grnnull', keys: [], label: 'gene network neutral control', group: 't1b', type: 'toggle', get: () => GNP().null,
      run: () => `the gene network’s outputs ${flip(GNP(), 'null') ? 'have NO effect (NEUTRAL CONTROL: it still runs and mutates)' : 'act'}`,
      help: 'the neutral control: the network runs and drifts but changes nothing, to tell selection from noise' },
    { id: 'grnsignal', keys: [], label: 'contact signal', group: 't1b', type: 'toggle', get: () => GNP().signal,
      run: () => `the contact signal ${flip(GNP(), 'signal') ? 'is sensed: each cell feels the mean of the regulator its touching neighbours broadcast' : 'is off (that sense reads 0)'}`,
      help: 'each cell broadcasts one regulator (a gene); the mean over its touching neighbours is one of its senses' },
    { id: 'grnkin', keys: [], label: 'signal weighted by kinship', group: 't1b', type: 'toggle', get: () => GNP().kinWeight,
      run: () => `the contact signal ${flip(GNP(), 'kinWeight') ? 'is weighted by kinship (the marker) as far as each cell’s gene says' : 'counts every neighbour alike'}`,
      help: 'weight = mix(1, kin accepted, the gene): a cell may listen to kin only' },
    { id: 'grnmut', keys: [], label: 'network mutates', group: 't1b', type: 'toggle', get: () => GNP().mutate,
      run: () => `the network ${flip(GNP(), 'mutate') ? 'mutates at births (with key M): weights nudged, inputs rewired, outputs moved, regulators duplicated' : 'is copied exactly at birth'}`,
      help: 'weights, biases and gains in use nudged; rarely an input rewired, an output moved, a regulator duplicated' },
    { id: 'reporter', keys: [], label: 'reporter', group: 't1b', type: 'cycle', get: () => `r${app.cells.grn.look.reporter}`,
      options: () => ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
      set: (v) => { app.cells.grn.look.reporter = Math.max(0, Math.min(7, Number(String(v).replace('r', '')) || 0)); return `reporter shows regulator r${app.cells.grn.look.reporter}`; },
      run: () => { const L = app.cells.grn.look; L.reporter = (L.reporter + 1) % 8; return `reporter shows regulator r${L.reporter} (view: reporter, key V)`; },
      help: 'which regulator the reporter view lights up (key V cycles to the view)' },
    grknob('grnTau', 'expression time', 'tau', 0.2, 100, 1.5, 1, 'the expression’s time constant (s): how fast a cell changes state'),
    grknob('grnRewire', 'rewiring', 'rewire', 0.001, 1, 1.5, 3, 'chance per birth that one input is rewired (or cut)'),
    grknob('grnDup', 'duplication', 'dup', 0.0001, 0.5, 1.5, 4, 'chance per birth that one regulator is duplicated into the least used slot'),
  );

  // ---------- predators: engulfing and kin sparing (step P1; panel only: no keys are free) ----------
  const PRP = () => app.cells.pred.params;
  const prknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'p1', type: 'knob', get: () => PRP()[key].toFixed(digits),
    run: (k) => { const p = PRP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'engulf', keys: [], label: 'engulfing', group: 'p1', type: 'toggle', get: () => PRP().on,
      run: () => `engulfing ${flip(PRP(), 'on') ? 'on: a cell with the engulf gene may wrap a smaller touching cell whose hold (glue to its neighbours + armour) it out-pulls, and digest it (division mode only)' : 'off: nobody eats anybody'}`,
      help: 'drive = drive × engulf gene × (1 − kin sparing × kinship) must beat the prey’s hold = its glue to its other neighbours + its crust wall and stiffness + a base; the prey must be smaller (area ratio); wrapping costs battery and membrane' },
    { id: 'engulfnull', keys: [], label: 'engulfing neutral control', group: 'p1', type: 'toggle', get: () => PRP().null,
      run: () => `engulfing ${flip(PRP(), 'null') ? 'NEVER happens (NEUTRAL CONTROL: the engulf and kin sparing genes still drift)' : 'acts'}`,
      help: 'the neutral control: the genes drift as usual, nothing is eaten, to tell selection from noise' },
    { id: 'kinsparenull', keys: [], label: 'kin sparing ignores kinship', group: 'p1', type: 'toggle', get: () => PRP().kinNull,
      run: () => `kin sparing ${flip(PRP(), 'kinNull') ? 'is blind (control: kinship ignored, the sparing gene drifts without effect)' : 'reads kinship by the self marker'}`,
      help: 'a control: does recognising kin matter for who gets eaten?' },
    { id: 'predmark', keys: [], label: 'mark engulfers', group: 'p1', type: 'toggle', get: () => app.cells.pred.look.mark,
      run: () => `cells with the engulf gene at 0.25 and more ${flip(app.cells.pred.look.mark, 'mark') ? 'carry a small dark-red mouth (diagnostic)' : 'look like any other'}`,
      help: 'a diagnostic mark, off by default' },
    prknob('predRatio', 'area ratio', 'sizeRatio', 1, 4, 1.1, 2, 'the area a predator needs over its prey’s'),
    prknob('predDrive', 'drive', 'drive', 0.1, 50, 1.25, 2, 'the drive at engulf gene 1, against the prey’s hold'),
    prknob('predHold', 'hold base', 'holdBase', 0, 10, 1.25, 2, 'the hold every cell has'),
    prknob('predWall', 'wall armour', 'wallArm', 0, 20, 1.25, 2, 'a full crust wall’s armour'),
    prknob('predWrap', 'wrap time', 'wrapTime', 0.2, 60, 1.25, 1, 's a wrap takes (the prey can escape meanwhile)'),
    prknob('predDigest', 'digestion time', 'digestTime', 0.5, 120, 1.25, 1, 's a meal takes to move into the host'),
    prknob('predBat', 'battery to the host', 'batShare', 0, 1, 1.2, 2, 'the share of the meal’s battery the host gets (the rest heat)'),
  );

  // ---------- error correction: the fidelity gene (step G1; panel only: no keys are free) ----------
  const FDP = () => app.cells.fidelity.params;
  const fdknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'g1', type: 'knob', get: () => FDP()[key].toFixed(digits),
    run: (k) => { const p = FDP(); p[key] = Math.max(lo, Math.min(hi, +(Math.max(p[key], 1e-3) * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'fidelity', keys: [], label: 'fidelity (proofreading)', group: 'g1', type: 'toggle', get: () => FDP().on,
      run: () => `the fidelity gene ${flip(FDP(), 'on') ? 'acts: a birth copies with e^-F of the usual errors (all genes, the gene network, the self marker), and F above the founders costs the parent battery' : 'is off: every birth copies as before (the gene frozen)'}`,
      help: 'proofreading: higher fidelity = smaller and rarer mutations at each birth, paid from the parent’s battery (as heat); founders copy as before' },
    { id: 'fidelitynull', keys: [], label: 'fidelity neutral control', group: 'g1', type: 'toggle', get: () => FDP().null,
      run: () => `the fidelity gene ${flip(FDP(), 'null') ? 'has NO effect and costs nothing (NEUTRAL CONTROL: it still drifts)' : 'acts'}`,
      help: 'the neutral control: the gene drifts as usual, without effect or cost, to tell selection from noise' },
    fdknob('fidCost', 'proofreading cost', 'cost', 0, 10, 1.25, 3, 'energy units a birth costs the parent at e^F − 1 = 1 (as heat); F = 1 costs 1.7 × this, F = 2 6.4 ×'),
    fdknob('fidBeyond', 'hard light beyond repair', 'beyond', 0, 1, 1.25, 2, 'the share of hard light’s extra mutation proofreading cannot catch (the rest is caught like any copying error)'),
  );

  // ---------- vents in the dark (step C12f; panel only: no keys are free) ----------
  const VP = () => app.matter.vents.params;
  const vknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'vents', type: 'knob', get: () => VP()[key].toFixed(digits),
    run: (k) => { const p = VP(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'hotvent', keys: [], label: 'hot vents', group: 'vents', type: 'toggle', get: () => ELECTRONS && VP().hot,
      run: () => (ELECTRONS ? `vents ${flip(VP(), 'hot') ? 'hot: they drip free givers (G, g), a little fuel and trace, and heat the dish where they drip' : 'as in step C12d: fuel gT and GT, free G and trace, no heat'}` : 'needs electrons'),
      help: 'a hot vent drips free givers (metal-like G, hydrogen-like g) and heats the grid where it drips (booked as energy in); its heat pays the sparks close in, so the gradient burns away there by itself' },
    { id: 'sea', keys: [], label: 'the sea (free T)', group: 'vents', type: 'toggle', get: () => ELECTRONS && VP().sea,
      run: () => (ELECTRONS ? `the sea ${flip(VP(), 'sea') ? `on: a faint supply of the free heavy taker T everywhere, topped up toward ${VP().seaLevel} per R²` : 'off: no T from outside'}` : 'needs electrons'),
      help: 'a faint dish-wide supply of the free heavy taker T (oxidised, sulfate-like), topped up toward the sea’s level, booked as added matter: with the vents’ givers it makes a redox gradient (G + T → GT releases 2.375, g + T → gT 1.5)' },
    vknob('ventHeat', 'vent heat per atom', 'heat', 0, 200, 1.5, 2, 'energy a hot vent puts into the grid per atom it drips'),
    vknob('seaRate', 'sea rate', 'seaRate', 0.0001, 1, 1.5, 4, 'atoms of T per R² per s the sea brings to a pixel holding none (less as it nears the level)'),
    vknob('seaLevel', 'sea level', 'seaLevel', 0.01, 20, 1.5, 3, 'the sea tops T up toward this many atoms per R², never above'),
  );

  // ---------- a nutrient landscape (step N1; panel only: no keys are free) ----------
  const PGP = () => app.cells.eat.pigments.params, WTP = () => app.water.params, OSP = () => app.oases.params;
  const nknob = (id, label, obj, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'n1', type: 'knob', get: () => obj()[key].toFixed(digits),
    run: (k) => { const p = obj(); p[key] = Math.max(lo, Math.min(hi, +(Math.max(p[key], lo || 1e-3) * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'pigmatter', keys: [], label: 'light needs matter', group: 'n1', type: 'toggle', get: () => PGP().matter,
      run: () => `pigments ${flip(PGP(), 'matter') ? 'are built from the stock (one trace and two light linkers l each, the assembly paid from the battery) and wear out: harvesting costs matter and energy' : 'are free (as before step N1): a harvest slot catches light by its rate alone'}`,
      help: 'a pigment is a molecule the cell builds (two light linkers holding a trace atom, like chlorophyll’s ring and its magnesium) and keeps rebuilding as it wears out; a slot catches light in proportion to the pigment held' },
    { id: 'pigsat', keys: [], label: 'photosynthesis saturates', group: 'n1', type: 'toggle', get: () => PGP().sat,
      run: () => `photosynthesis ${flip(PGP(), 'sat') ? `saturates: past ${PGP().isat} of the full noon light the extra photons are only heat` : 'does not saturate: every photon caught can be used'}`,
      help: 'of the photons caught at a light s (a share of the full noon light), only Isat tanh(s / Isat) / s can be used; the rest are heat' },
    { id: 'pigbleach', keys: [], label: 'strong light bleaches', group: 'n1', type: 'toggle', get: () => PGP().inhib,
      run: () => `photoinhibition ${flip(PGP(), 'inhib') ? 'on: photons past saturation bleach the pigment (shade is worth having)' : 'off: too much light does no harm'}`,
      help: 'each photon past saturation breaks some pigment back into its atoms, which the cell must rebuild (with saturation on)' },
    { id: 'pigshed', keys: [], label: 'trace leaves life', group: 'n1', type: 'toggle', get: () => PGP().shed,
      run: () => `a worn or bleached pigment's trace ${flip(PGP(), 'shed') ? 'goes to the dish under the cell (where it settles or is caught again): lineages cannot carry trace for ever' : 'goes back into the stock (as in step N1)'}`,
      help: 'the broken antenna loses its metal: each pigment’s trace passes through the dish once per pigment lifetime (about 2 min)' },
    { id: 'bsign', keys: [], label: 'founders mixed B sign', group: 'guides', type: 'toggle', get: () => app.cells.genome.params.bSign === 'mixed',
      run: () => { const G = app.cells.genome.params; G.bSign = G.bSign === 'mixed' ? 'plus' : 'mixed'; return `new founders (G, N) get field-B sign ${G.bSign === 'mixed' ? '+ or − at random (both present): like repels like, unlike attracts' : '+ for all (as until the C12g + N1 merge): all repel'}`; },
      help: 'the sign of the founders’ B sensing gene, which is also the sign of their B charge (step C12g); applies to the next founders drawn' },
    { id: 'scarce', keys: [], label: 'trace scarce (oases)', group: 'n1', type: 'toggle', get: () => OSP().scarce,
      run: () => `trace ${flip(OSP(), 'scarce') ? 'scarce: only the oases drip it (vents and every other spring drip none)' : 'from every spring that has it (the vents, as before step N1)'}`,
      help: 'trace, the engines’ cofactor and the heart of every pigment, comes only from a few nutrient springs (oases): life clusters where it can be found' },
    { id: 'roam', keys: [], label: 'oases roam', group: 'n1', type: 'toggle', get: () => OSP().roam,
      run: () => `oases ${flip(OSP(), 'roam') ? 'roam: they wander slowly, pulse, dry up and rise again elsewhere' : 'stay put, steady, and never dry up'}`,
      help: 'the nutrient springs wander, their drip swells and fades, and after a while each dries up and a new one rises somewhere else' },
    { id: 'oasisCount', keys: [], label: 'oases', group: 'n1', type: 'knob', get: () => String(OSP().count),
      run: (k) => { const p = OSP(); p.count = Math.max(0, Math.min(12, Math.round(p.count) + (k === '-' ? -1 : 1))); if (!app.oases.started) app.oases.start(); return `oases ${p.count}`; },
      help: 'how many nutrient springs the dish keeps' },
    { id: 'caustics', keys: [], label: 'caustic light', group: 'n1', type: 'toggle', get: () => WTP().caustics,
      run: () => `caustic light ${flip(WTP(), 'caustics') ? 'on: the water’s surface focuses the light into a wandering bright net (the cells and the chemistry get it)' : 'off: the light falls evenly'}`,
      help: 'the ripple background is the water’s surface: its swell and ripples bend the light into a net of bright lines on the dish floor, which the pigments, the chemistry and the heat all receive' },
    nknob('focus', 'focus', WTP, 'focus', 0.1, 4, 1.25, 2, 'how strongly the surface focuses: below ~0.8 soft dappling, ~1.3 a net of bright lines'),
    { id: 'currents', keys: [], label: 'currents', group: 'n1', type: 'toggle', get: () => WTP().currents,
      run: () => `currents ${flip(WTP(), 'currents') ? 'on: the water flows in slow eddies (the moire beat of the medium) and a basin-wide gyre, carrying the substances; cells drift a little' : 'off: still water'}`,
      help: 'a slow, divergence-free flow carries every dissolved substance (springs make plumes downstream) and moves the cells a little; streamlines in the machinery view' },
    nknob('curSpeed', 'eddies’ speed', WTP, 'speed', 0, 5, 1.5, 2, 'the eddies’ speed, R per s'),
    nknob('gyre', 'gyre’s speed', WTP, 'gyre', 0, 5, 1.5, 2, 'the basin-wide gyre’s speed at its strongest, R per s'),
  );

  // ---------- hard light mutates (step C8; panel only: no keys are free) ----------
  const HL = () => app.cells.eat.hardlight.params;
  const hknob = (id, label, key, lo, hi, f, digits, help) => ({ id, keys: [], label, group: 'hardlight', type: 'knob', get: () => HL()[key].toFixed(digits),
    run: (k) => { const p = HL(); p[key] = Math.max(lo, Math.min(hi, +(p[key] * (k === '-' ? 1 / f : f)).toPrecision(3))); return `${label} ${p[key]}`; }, help });
  A.push(
    { id: 'hardmut', keys: [], label: 'hard light mutates', group: 'hardlight', type: 'toggle', get: () => HL().on,
      run: () => `hard light ${flip(HL(), 'on') ? 'mutates: a cell keeps a dose of the hard light its body caught (fading as it is repaired), and its daughters mutate more, in proportion' : 'does not mutate: every birth mutates the same, in the light or in the dark'}${rules().mut ? '' : ' (mutation, key M, is off: only the hard light’s part mutates)'}`,
      help: 'the hard light a cell’s body catches leaves a dose (fading as it is repaired); a daughter’s genome mutates × (1 + gain × the parent’s dose)' },
    hknob('hardGain', 'mutation per dose', 'gain', 0.001, 2, 1.5, 3, 'extra mutation per energy unit of hard light dose: a daughter mutates × (1 + this × the parent’s dose)'),
    hknob('hardMax', 'largest factor', 'maxFactor', 1, 100, 1.5, 1, 'a daughter mutates at most this many times the usual'),
    hknob('hardRepair', 'repair time', 'repair', 1, 300, 1.5, 0, 'seconds over which a cell repairs its hard light dose (the dose fades with this time constant)'),
  );

  // ---------- division and death with a changing count (step C9; panel only: no keys are free) ----------
  const DV = () => app.cells.division.params;
  const dknob = (id, label, key, lo, hi, step, digits, help, add = false) => ({ id, keys: [], label, group: 'division', type: 'knob',
    get: () => DV()[key].toFixed(digits),
    run: (k) => {
      const p = DV(), up = k !== '-';
      const v = add ? p[key] + (up ? step : -step) : p[key] <= 0 ? (up ? hi / 100 : 0) : p[key] * (up ? step : 1 / step);
      p[key] = Math.max(lo, Math.min(hi, +v.toPrecision(3)));
      return `${label} ${p[key].toFixed(digits)}`;
    }, help });
  A.push(
    { id: 'divide', keys: [], label: 'division (changing count)', group: 'division', type: 'toggle', get: () => DV().on,
      run: () => `${flip(DV(), 'on') ? 'division: a cell divides into a free slot when its battery can pay for a daughter, and dies for good when it starves, overheats or bursts; the count rises and falls' : 'turnover: a fixed count, a dead cell\u2019s slot goes at once to a neighbour\u2019s daughter'}${rules().turn ? '' : ' (the life cycle is off: T)'}`,
      help: 'on: cells divide (battery and room permitting) and die for good, the count changes; off: the old turnover, a fixed count' },
    dknob('divAt', 'division threshold', 'divAt', 0.1, 1, 0.05, 2, 'a cell may divide once its battery holds this share of its capacity', true),
    dknob('divCost', 'division cost', 'cost', 0, 4, 1.5, 2, 'energy a division takes from the mother\u2019s battery, as heat (the rest is split between the two)'),
    dknob('starveTime', 'starvation time', 'starveTime', 2, 600, 1.5, 0, 'seconds a cell lives with an (almost) empty battery before it dies; it fades out meanwhile'),
    dknob('crowd', 'crowding limit', 'crowd', 0, 3, 1.3, 2, 'a cell divides only while its overlaps with its neighbours sum to at most this (packed tissue: no room)'),
    dknob('age', 'background deaths', 'age', 0, 0.2, 2, 4, 'deaths per cell per s from nothing in particular (age), on top of starving, heat and bursting'),
  );

  // ---------- patterned walls, evolvable adhesion per side (step C10; panel only: no keys are free) ----------
  const WL = () => app.cells.walls.params;
  const wlNote = () => (!WL().on ? ' (patterned walls are off)' : rules().adh ? '' : ' (adhesion is off: H)');
  const wknob = (id, label, key, lo, hi, step, digits, help, add = false) => ({ id, keys: [], label, group: 'walls', type: 'knob',
    get: () => WL()[key].toFixed(digits),
    run: (k) => {
      const p = WL(), up = k !== '-';
      const v = add ? p[key] + (up ? step : -step) : p[key] <= 0 ? (up ? hi / 100 : 0) : p[key] * (up ? step : 1 / step);
      p[key] = Math.max(lo, Math.min(hi, +v.toPrecision(3)));
      return `${label} ${p[key].toFixed(digits)}${wlNote()}`;
    }, help });
  A.push(
    { id: 'walls', keys: [], label: 'patterned walls', group: 'walls', type: 'toggle', get: () => WL().on,
      run: () => `patterned walls ${flip(WL(), 'on') ? 'on: each of a cell’s six sides has its own stickiness (genes a0, a1, a2 round the wall from its front); a contact holds by the less sticky of the two sides' : 'off: every side as sticky as the adhesion gene, as before'}${rules().adh ? '' : ' (adhesion is off: H)'}`,
      help: 'each side its own adhesion, from three genes: overall a0 (the adhesion gene), front/back a1, ends/sides a2; a contact holds by the smaller of the two touching sides' },
    { id: 'wallFront', keys: [], label: 'front follows the dipole', group: 'walls', type: 'toggle', get: () => WL().front,
      run: () => `the front ${flip(WL(), 'front') ? 'follows the charge dipole, as far as the gene w says (and it turns with the body)' : 'is the inherited body orientation alone (it turns with the body)'}${wlNote()}`,
      help: 'the front (where the pattern hangs) is fixed in the body and inherited; the gene w lets the charge dipole turn it toward its + end' },
    { id: 'wallCost', keys: [], label: 'adhesion costs', group: 'walls', type: 'toggle', get: () => WL().cost,
      run: () => `adhesion ${flip(WL(), 'cost') ? 'costs: its molecules are linkers woven into the membrane, and the battery pays an upkeep for the glue a side holds' : 'is free'}${wlNote()}`,
      help: 'adhesion molecules are made of linkers in the membrane (per side), and the battery pays an upkeep per sticky side; what is not paid is not held' },
    { id: 'wallMature', keys: [], label: 'junctions mature', group: 'walls', type: 'toggle', get: () => WL().mature,
      run: () => `junctions ${flip(WL(), 'mature') ? 'mature: a side that keeps touching a sticky neighbour gets stickier, and loses it when the contact ends' : 'do not mature'}${wlNote()}`,
      help: 'a side that keeps touching a sticky neighbour grows stickier (up to the cap); it fades when the contact is lost' },
    wknob('wallStrength', 'pattern strength', 'strength', 0, 4, 1.5, 2, 'how strongly the genes a1 and a2 shape the wall (0: uniform walls whatever the genes)'),
    wknob('wallFrontRate', 'front turning', 'frontRate', 0, 20, 1.5, 2, 'how fast the dipole turns the front (rad/s at w × |dipole| = 1)'),
    wknob('wallMatureRate', 'maturation rate', 'matureRate', 0, 10, 1.5, 3, 'how fast a touching side matures (per s); it fades at its own rate once the contact is lost'),
    wknob('wallMatureCap', 'maturity cap', 'matureCap', 1, 3, 0.25, 2, 'a fully mature junction holds this many times its pattern’s adhesion', true),
    wknob('wallUpkeep', 'cost per adhesion', 'upkeep', 0, 0.1, 1.5, 4, 'battery upkeep per s per R of side at adhesion 1 (the linkers come on top)'),
    wknob('wallFreeGlue', 'free base glue', 'freeGlue', 0, 3, 0.1, 2, 'step C11: each side holds this much adhesion at no cost; only what it asks above it costs linkers and upkeep', true),
  );
  // ---------- step C11: glue turns the cell, division by the front (panel only) ----------
  const tknob = (id, label, key, lo, hi, step, digits, help) => ({ ...wknob(id, label, key, lo, hi, step, digits, help), group: 'turn' });
  A.push(
    { id: 'wallTurn', keys: [], label: 'glue turns cells', group: 'turn', type: 'toggle', get: () => WL().turn,
      run: () => `the glue ${flip(WL(), 'turn') ? 'turns the cells: a contact pulls harder where the wall is stickier, off the centre line, so each cell turns until its sticky sides face its neighbours' : 'does not turn the cells (their fronts stay where they are inherited)'}${wlNote()}`,
      help: 'a sticky side pulling on a neighbour pulls off-centre: the same pull also turns the cell (front and outline) until its sticky sides face its neighbours' },
    { id: 'wallDivFront', keys: [], label: 'division by the front', group: 'turn', type: 'toggle', get: () => WL().divFront,
      run: () => `a dividing cell puts its daughter ${flip(WL(), 'divFront') ? 'by its front: along it, across it or between, as its gene says (two-ended lineages grow end to end, sticky-sided ones side by side)' : 'along its long axis (as in step C9)'}${wlNote()}`,
      help: 'the daughter goes along the mother’s front (gene divAxis 0), across it (1) or between; off: along the long axis' },
    tknob('wallTurnGain', 'turning strength', 'turnGain', 0, 50, 1.5, 2, 'how strongly the glue’s torque turns a cell (1: as derived from the pull)'),
    tknob('wallRotDrag', 'rotational drag', 'rotDrag', 0.01, 100, 1.5, 2, 'how hard it is to turn a cell, x a disc’s r² / 2 (larger: slower turning)'),
  );

  // ---------- step C13: fields as genes and guides (panel only) ----------
  const GD = () => app.cells.guides.params;
  const gdNote = () => (GD().null ? ' (the neutral control is on: no gate acts)' : '');
  const gtoggle = (id, key, label, on, off, help) => ({ id, keys: [], label, group: 'guides', type: 'toggle', get: () => GD()[key],
    run: () => `${label}: ${flip(GD(), key) ? on : off}${key === 'null' || key === 'genes' ? '' : gdNote()}`, help });
  const gknob = (id, label, key, lo, hi, step, digits, help) => ({ id, keys: [], label, group: 'guides', type: 'knob',
    get: () => GD()[key].toFixed(digits),
    run: (k) => {
      const p = GD(), up = k !== '-';
      p[key] = Math.max(lo, Math.min(hi, +(p[key] * (up ? step : 1 / step)).toPrecision(3)));
      return `${label} ${p[key].toFixed(digits)}`;
    }, help });
  A.push(
    gtoggle('fgGenes', 'genes', 'field genes', 'each cell\u2019s fields from its own genes (lever: its beat period, emission, sensing gain and sign, tuning, angle)',
      'today\u2019s values for every cell (the genes still drift)', 'per field (A, B, the partner A\u2032): lever, emission, sensing gain and sign, tuning, lattice angle, each a gene that mutates'),
    gtoggle('gateGlue', 'glue', 'glue gate', 'each side stickier (or less) where it feels the field high, as its gene says', 'off',
      'each side\u2019s adhesion x (1 + gene x what that side feels of field A)'),
    gtoggle('gatePump', 'pump', 'pump gate', 'pumps faster (or slower) where the field is high, as the gene says', 'off', 'the pumps\u2019 rates x (1 + gene x the field felt)'),
    gtoggle('gateEngine', 'engine', 'engine gate', 'engines faster (or slower) where the field is high, as the gene says', 'off', 'the engines\u2019 rates x (1 + gene x the field felt)'),
    gtoggle('gateDiv', 'div', 'division gate', 'a daughter goes along (or across) the felt gradient, as the gene says', 'off', 'the division axis pulled toward the felt gradient (gene +) or across it (gene \u2212)'),
    gtoggle('gateTurn', 'turn', 'turn gate', 'the front turns toward (or away from) the felt gradient, as the gene says', 'off', 'the front (the wall pattern\u2019s direction) turns up the felt gradient (gene +) or down it (gene \u2212)'),
    gtoggle('pushGene', 'push', 'push gene', 'field A pushes each cell as hard as its push gene says', 'field A pushes every cell as before', 'field A\u2019s direct push x the push gene (0..2), so evolution can choose between pushing and guiding'),
    gtoggle('gateNull', 'null', 'neutral control', 'NEUTRAL CONTROL: the gate genes and the push gene still drift but do nothing (to tell selection from noise)',
      'the gates act', 'the gates and the push gene have no effect while their genes keep drifting (compare with it on)'),
    gknob('gateRef', 'felt reference', 'ref', 0.05, 100, 1.5, 2, 'the field felt on a side that counts as tanh(1) of full for the gates (smaller: the gates react to weaker fields)'),
    gknob('gateTurnRate', 'turn gate rate', 'turnRate', 0.01, 20, 1.5, 2, 'how fast the turn gate turns a cell (rad/s at gene 1, a full gradient, a right angle)'),
  );

  // experiments (src/lab.js, src/snapshot.js): the whole state to a file and back
  const lab = () => window.moire;
  A.push(
    { id: 'saveState', keys: [], label: 'save state', group: 'state', type: 'do',
      run: () => {
        lab().snapshotDownload().then((r) => app.flash(`saved ${r.name} (${(r.size / 1e6).toFixed(1)} MB)`))
          .catch((e) => app.flash(`could not save the state: ${e.message || e}`));
        return 'saving the state (cells, genomes, the dish, every setting)…';
      },
      help: 'save everything (cells, genomes, the dish’s heat and substances, springs, every switch and knob) as a file' },
    { id: 'loadState', keys: [], label: 'load state', group: 'state', type: 'do',
      run: () => {
        lab().snapshotUpload().then((r) => { if (r) app.flash(`state loaded: ${r.cells} cells at ${r.time.toFixed(0)} s${r.exact ? '' : ' (' + r.notes.join('; ') + ')'}`); })
          .catch((e) => app.flash(`could not load the state: ${e.message || e}`));
        return 'pick a saved state file';
      },
      help: 'load a saved state file (best in a window of the same size: then it continues exactly)' },
  );

  // step C6n: the clean view (default) or the machinery: every diagnostic layer at once
  function machinery() {
    const L = LP(), K = C().look;
    return L.cellField && L.fieldB && K.innerDots && K.marks && app.matter.params.style === 'halftone' && Q().contours && app.matter.oil.params.polarity;
  }
  function setMachinery(on) {
    const L = LP(), K = C().look;
    L.cellField = L.fieldB = L.partner = on;
    K.innerDots = K.marks = on;
    app.matter.params.style = on ? 'halftone' : 'dust';
    Q().contours = on;   // step C6b: the charge field's contour lines
    app.matter.oil.params.polarity = on;   // step C12: the polarity wash
    if (app.water) app.water.machinery = on;   // step N1: the currents' streamlines
    return on ? 'the machinery: the fields\' dots, the lattice inside the cells, the substances as halftone, the marks of steps 6 to 8, the charge contours'
      : 'clean: the cells, the materials and the light (Shift+4: the machinery)';
  }
  function styleText() {
    return app.matter.params.style === 'dust' ? 'substances as material: glowing specks, as many as the amount (fuel green, free atoms faint, trace sparks)'
      : 'substances as halftone dots on the medium lattice';
  }

  function viewText() {
    const v = VIEWS[C().look.view] || 'job';
    return v === 'lineage' ? 'colour by lineage (key)' : v === 'strategy'
      ? 'colour by strategy: gold harvesters (light), green burners, half and half both, grey the others'
      : v === 'charge' ? 'colour by charge: rose cells hold more givers (+), blue more takers (−), grey neutral'
        : v === 'walls' ? 'colour by wall pattern (step C10): coral polar, mint two-ended, magenta sticky sides, grey uniform; bright tube = sticky side'
          : v === 'guides' ? 'colour by strongest guide (step C13): ivory glue, teal pumps, green engines, lilac division, yellow turning, grey unguided; each side’s tube bright where it feels the field high, dark where low'
          : v === 'marker' ? 'colour by lineage, the self marker (step T1a): each family its own hue, close relatives close hues (the marker drifts at every birth, a molecular clock)'
          : v === 'reporter' ? `reporter view (step T1b): cells glow green as far as they express regulator r${app.cells.grn.look.reporter} (like a GFP reporter line; the harmonic look shows it as a red channel)`
          : `colour by job (step F0): ${JOBS.map((J, k) => `${JOB_WORD[k]} ${J.label}`).join(', ')}; the legend bottom right`;
  }

  function CH() { return app.matter.chem; }
  function chemNote() { return CH().on ? '' : ' (chemistry is off: Shift+M)'; }

  function newCulture(fresh) {
    app.cells.seed(fresh);
    app.background.impulse(app.view.cssW / 2, app.view.cssH / 2, 2);   // as the reference's seed()
    return fresh ? 'new culture, fresh random genomes' : 'new culture, same founder genomes';
  }

  function lightText(m) {
    return m === 'spot' ? 'light: spotlight (right-drag moves it, Alt+wheel tilts it, Shift+wheel turns where it comes from)'
      : m === 'full' ? 'light: full field, the whole dish lit (clouds drift over)' : 'light off: only the base warmth and the cells\' own motion heat the dish';
  }

  return A;
}

/** Key maps: { plain: Map(key -> action), shift: Map(letter -> action) }. */
export function keyMaps(actions) {
  const plain = new Map(), shift = new Map();
  for (const a of actions) {
    for (const k of a.keys) {
      if (k.startsWith('shift+')) shift.set(k.slice(6), a);
      else plain.set(k, a);
    }
  }
  return { plain, shift };
}

/** How a key is written for people: 'Shift+H', 'Space', '[ ]'. */
export function keyName(k) {
  if (k === ' ') return 'Space';
  if (k.startsWith('shift+')) return 'Shift+' + k.slice(6).toUpperCase();
  return k.length === 1 && /[a-z]/.test(k) ? k.toUpperCase() : k;
}

export function keysText(a) {
  if (!a.keys.length) return '';
  if (a.id === 'lever') return '- =';
  if (a.id === 'keys') return '?';
  return a.keys.map(keyName).join(' ');
}
