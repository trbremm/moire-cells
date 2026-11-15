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

export const TOOLS = [
  { id: 'ripple', name: 'ripple', label: 'drop a ripple', key: '1' },
  { id: 'light', name: 'light spring', label: 'drop a light spring', spring: 'light', key: '2' },
  { id: 'heavy', name: 'heavy spring', label: 'drop a heavy spring', spring: 'heavy', key: '3' },
  { id: 'stir', name: 'stir', label: 'stir', stir: true },
  { id: 'spot', name: 'move light', label: 'move the light', spot: true },
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
];

export const VIEWS = ['fate', 'lineage', 'strategy', 'charge'];   // key V: what the cells' bodies are coloured by (cells.look.view)

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
      help: 'a fresh blob of stem cells at the centre, the same founder genomes' },
    { id: 'genomes', keys: ['g'], label: 'new genomes', group: 'play', type: 'do', run: () => newCulture(true),
      help: 'a fresh blob with fresh random founder genomes' },
    { id: 'springs', keys: ['c'], label: 'clear springs', group: 'play', type: 'do',
      run: () => { app.matter.clearSprings(); return 'springs cleared (the atoms already in the dish stay; Shift+C washes them out)'; },
      help: 'remove the springs (the atoms already in the dish stay)' },
    { id: 'wash', keys: ['shift+c'], label: 'wash atoms', group: 'play', type: 'do',
      run: () => { app.matter.wash(); return 'the dish washed: every atom out (booked as gone in the atoms ledger)'; },
      help: 'every atom out of the dish (booked as gone in the atoms ledger)' },

    // ---------- step C6n: the look (drawing only) ----------
    { id: 'neon', keys: ['e'], label: 'neon look', group: 'look', type: 'toggle', get: () => app.neon.on,
      run: () => app.neon.toggle(),
      help: 'cells as bright neon tubes with a tight halo, trails and hum (off: the flat look of steps 1 to C6)' },
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
      get: () => VIEWS[C().look.view] || 'fate', options: () => VIEWS,
      set: (v) => { C().look.view = Math.max(0, VIEWS.indexOf(v)); return viewText(); },
      run: () => { C().look.view = (C().look.view + 1) % VIEWS.length; return viewText(); },
      help: 'cells coloured by their fate (function), their lineage (the genome key\'s hue), their strategy (how their engines make a living), or their charge' },
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
      run: () => `field B: like ${app.charge.flipSignB() > 0 ? 'repels' : 'attracts'} like${app.charge.stockOn ? ' (for the charges from the stock; the per-fate charges keep their own rule)' : ''}`,
      help: 'B\'s sign rule: like attracts like, or like repels like (step C6b: one rule for the charges from the stock, one for the per-fate charges)' },
    { id: 'likeB', keys: ['y'], label: '"like" means', group: 'fieldB', type: 'cycle', get: () => (F().like ? 'lineage' : 'charge'),
      run: () => { F().like = F().like ? 0 : 1; return `field B: "like" means ${F().like ? 'a similar key (the same lineage)' : 'the same sign of charge (charges by fate)'}`; },
      help: 'for B, "like" means the same sign of charge (by fate) or a similar key (lineage)' },

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
      run: () => `exclusion ${flip(X(), 'on') ? 'on: same fate and same state (the bar) keep apart, other states pack closer' : 'off'}`,
      help: 'cells of the same fate in the same state (the bar) keep a gap; other states may touch' },
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
    { id: 'fates', keys: ['d'], label: 'differentiation', group: 'bio', type: 'toggle', get: () => rules().diff,
      run: () => (flip(rules(), 'diff') ? 'differentiation on: cells read their contacts and choose fates' : 'differentiation off: every cell back to stem'),
      help: 'cells read their contacts and choose fates (off: every cell back to stem)' },
    { id: 'adhesion', keys: ['h'], label: 'adhesion', group: 'bio', type: 'toggle', get: () => rules().adh,
      run: () => `adhesion ${flip(rules(), 'adh') ? 'on: like sticks to like (similar keys, same fate)' : 'off'}`,
      help: 'like sticks to like (similar keys, same fate)' },
    { id: 'body', keys: ['b'], label: 'body traits', group: 'bio', type: 'toggle', get: () => rules().body,
      run: () => `body traits ${flip(rules(), 'body') ? 'on: size and motility from the genome and the fate' : 'off: all cells alike'}`,
      help: 'size, motility and crawling from the genome and the fate (off: all alike)' },
    { id: 'turnover', keys: ['t'], label: 'life cycle', group: 'bio', type: 'toggle', get: () => rules().turn,
      run: () => `life cycle ${flip(rules(), 'turn') ? (app.cells.division.params.on ? 'on: cells divide when their battery can pay for it and die when they starve or overheat (step C9)' : 'on: turnover, cells die now and then, a neighbour divides into the gap') : 'off: nothing is born and nothing dies'}`,
      help: 'births and deaths (step C9: by division, the count changes; or by turnover, a fixed count: rules panel, Division)' },
    { id: 'mutation', keys: ['m'], label: 'mutation', group: 'bio', type: 'toggle', get: () => rules().mut,
      run: () => `mutation ${flip(rules(), 'mut') ? 'on: daughters differ a little from their parent' : 'off: daughters are exact copies'}`,
      help: 'daughters differ a little from their parent (off: exact copies)' },
    { id: 'inherit', keys: ['i'], label: 'inherit fate', group: 'bio', type: 'toggle', get: () => rules().inherit,
      run: () => (flip(rules(), 'inherit') ? "daughters inherit their parent's fate" : 'daughters start as stem cells'),
      help: 'daughters keep their parent\'s fate (off: they start as stem cells)' },

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
      run: () => `a cell's charge in field B ${flip(Q(), 'stock') ? 'comes from what it holds: the net charge of its stock (givers minus takers)' : 'is the fixed charge of its fate (step 5)'}` +
        `, like ${app.charge.signB > 0 ? 'repels' : 'attracts'} like (U)${app.cells.eat.params.on ? '' : ' (cells eat is off: Shift+A, so the fixed charges apply)'}`,
      help: 'a cell\'s charge in field B is the net charge of its stock (off: the fixed charge per fate of step 5)' },
    { id: 'chargeFeel', keys: ['shift+9'], label: 'cells feel the charge field', group: 'charge', type: 'toggle', get: () => Q().feel,
      run: () => `cells ${flip(Q(), 'feel') ? 'feel the charge field: a charged cell drifts down (+) or up (−) the substrate\'s potential' : 'do not feel the charge field (field B still carries their charge)'}${qNote()}`,
      help: 'a charged cell is pushed through the substrate\'s field: + toward − clouds and back (needs the charge field)' },
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

  // step C6n: the clean view (default) or the machinery: every diagnostic layer at once
  function machinery() {
    const L = LP(), K = C().look;
    return L.cellField && L.fieldB && K.innerDots && K.marks && app.matter.params.style === 'halftone' && Q().contours;
  }
  function setMachinery(on) {
    const L = LP(), K = C().look;
    L.cellField = L.fieldB = L.partner = on;
    K.innerDots = K.marks = on;
    app.matter.params.style = on ? 'halftone' : 'dust';
    Q().contours = on;   // step C6b: the charge field's contour lines
    return on ? 'the machinery: the fields\' dots, the lattice inside the cells, the substances as halftone, the marks of steps 6 to 8, the charge contours'
      : 'clean: the cells, the materials and the light (Shift+4: the machinery)';
  }
  function styleText() {
    return app.matter.params.style === 'dust' ? 'substances as material: glowing specks, as many as the amount (fuel green, free atoms faint, trace sparks)'
      : 'substances as halftone dots on the medium lattice';
  }

  function viewText() {
    const v = VIEWS[C().look.view] || 'fate';
    return v === 'lineage' ? 'colour by lineage (key)' : v === 'strategy'
      ? 'colour by strategy: gold harvesters (light), green burners, half and half both, grey the others'
      : v === 'charge' ? 'colour by charge: rose cells hold more givers (+), blue more takers (−), grey neutral' : 'colour by fate';
  }

  function CH() { return app.matter.chem; }
  function chemNote() { return CH().on ? '' : ' (chemistry is off: Shift+M)'; }

  function newCulture(fresh) {
    app.cells.seed(fresh);
    app.background.impulse(app.view.cssW / 2, app.view.cssH / 2, 2);   // as the reference's seed()
    return fresh ? 'new culture, fresh random genomes' : 'new culture, same founder genomes';
  }

  function lightText(m) {
    return m === 'spot' ? 'light: spotlight (right-drag moves it, the wheel tilts it, Shift+wheel turns where it comes from)'
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
