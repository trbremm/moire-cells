// THE TOY FRONT (user 2026-11-22: "Clean up the UI controls and go for something more toylike with focus on generating interesting
// mazes and topologies. Don't have the entropy panel opening by default. Shove the development stuff into one hidden panel. I want to
// be able to show this to friends."). README "The toy front: controls, worlds and terrain generators".
//
// What a fresh load shows: the dish, a world's name top left, three small buttons top right (look, share, developer), and one bar of
// big buttons at the bottom: play, speed, undo, worlds, new; and the tools: touch (tap: a ripple, drag: stir), wall, block, pillar, erase,
// cells, food, light. Nothing else: no counters, no key hints. Every developer control is in ONE place, the DEVELOPER mode (the gear, or
// key D): the old toolbar with all its panels (light, view, rules, dish, molecules, cells) plus a Developer panel (the entropy panel, the
// stats overlay, the machinery, the key list), the hint line and every key, exactly as before. ?dev=1 starts there; ?ui=0 hides all
// the chrome (clean pictures, the experiment tools).
//
// WORLDS: the terrain generators (src/terrain.js: maze, thicket, caves, river delta, pillar forest, honeycomb, labyrinth, spiral,
// archipelago, filter walls), each from a seed, built IN PLACE (no reload: the obstacles, springs, light, currents and a fresh culture);
// and the classic dishes (the presets of src/culture.js and the open dish), which open by link as before. The address bar follows the
// world (?terrain=maze&seed=4821&dish=198.4x123.1), so the share button copies a link that rebuilds the same world.

import { TERRAINS, TERRAIN_NAMES, makeWorld, reach } from './terrain.js';
import { shapeSd } from './obstacles.js';
import { PRESETS, SPREAD_SQUEEZE } from './culture.js';
import { camera } from './camera.js';
import { dish } from './dish.js';
import { springInk } from './matter.js';
import { keysText } from './actions.js';
import { CARBON } from './carbon.js';

const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  play: '<path d="M6.5 4.2l9.5 5.8-9.5 5.8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5v11M13.5 4.5v11" stroke-width="2.6"/>',
  speed: '<path d="M3.5 5l6 5-6 5M10.5 5l6 5-6 5"/>',
  undo: '<path d="M7.5 4.5L3.5 8.5l4 4"/><path d="M3.8 8.5h8.2a4.6 4.6 0 0 1 0 9.2H8.5"/>',
  worlds: '<rect x="2.8" y="2.8" width="6" height="6" rx="1"/><rect x="11.2" y="2.8" width="6" height="6" rx="3"/><rect x="2.8" y="11.2" width="6" height="6" rx="3"/><rect x="11.2" y="11.2" width="6" height="6" rx="1"/>',
  dice: '<rect x="3" y="3" width="14" height="14" rx="3"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="13" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="7" cy="13" r="1.3" fill="currentColor" stroke="none"/>',
  touch: '<circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="8.2" stroke-dasharray="2.2 2.2"/>',
  wall: '<path d="M3.5 16.5c3-9 9-4 13-13" stroke-width="2.6" stroke-linecap="round"/>',
  block: '<rect x="3.5" y="5.5" width="13" height="9" rx="1.6"/>',
  pillar: '<circle cx="6.5" cy="7" r="3"/><circle cx="14" cy="7" r="3"/><circle cx="10.2" cy="14" r="3"/>',
  erase: '<path d="M8.2 16.5l-4.4-4.4a1.4 1.4 0 0 1 0-2l6.8-6.8a1.4 1.4 0 0 1 2 0l3.6 3.6a1.4 1.4 0 0 1 0 2L9.4 15.7"/><path d="M8 16.5h8.5M6.4 7.9l5.7 5.7"/>',
  cells: '<path d="M10 2.8l5.6 3.2v6.5L10 15.7l-5.6-3.2V6z"/><circle cx="10" cy="9.3" r="1.6" fill="currentColor" stroke="none"/>',
  food: '<circle cx="10" cy="10" r="5.6"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2"/>',
  light: '<ellipse cx="10.5" cy="11" rx="7" ry="4.6"/><path d="M4 3l3 4M10.5 2v4.4M17 3l-3 4"/>',
  look: '<circle cx="10" cy="10" r="7.2"/><circle cx="10" cy="10" r="3.2"/><path d="M10 2.8v4M10 13.2v4"/>',
  share: '<path d="M8.4 11.6l3.2-3.2"/><path d="M9.8 6.3l1.6-1.6a3 3 0 0 1 4.2 4.2L14 10.5M10.2 13.7l-1.6 1.6a3 3 0 0 1-4.2-4.2L6 9.5"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.2v2.6M10 15.2v2.6M2.2 10h2.6M15.2 10h2.6M4.5 4.5l1.8 1.8M13.7 13.7l1.8 1.8M4.5 15.5l1.8-1.8M13.7 6.3l1.8-1.8"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
};
function svg(name) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[name] || '';
  return s;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// the classic dishes in a friend's words (the presets' own descriptions stay in the New culture dialog)
const CLASSIC = [
  ['', 'Open dish', 'The plain dish: one colony, a spotlight, a mineral spring and a vent beside it.'],
  ['chip', 'Chip', 'A microfluidic chip: fresh medium flows through a forest of pillars past a quiet side chamber.'],
  ['crevices', 'Crevices', 'A rock face cut by narrow cracks, boulders in a slow stream.'],
  ['maze', 'First maze', 'The first maze: thin walls, springs in three corners, the colony in the middle.'],
  ['fronts', 'Fronts', 'A long strip whose wall presses in and lets go, sending fronts of packed cells across.'],
  ['vent', 'Deep vents', 'Total darkness: life must eat the chemistry of three hot vents.'],
  ['shallows', 'Sunlit shallows', 'Sunlight everywhere, days and nights, mineral springs scattered around.'],
  ['oxygen', 'Oxygen world', 'A spotlight and a slow vent; any oxygen in the water is made by life.'],
  ['slick', 'Oil slick', 'Oil and soap droplets with shimmering rims, lit from the side.'],
  ['desert', 'Crust desert', 'Crust grows round springs of linkers; a ring of cells grazes it.'],
  ['oases', 'Oases', 'Soft light and wandering oases of a scarce nutrient, carried in silver plumes.'],
  ['plumes', 'Plumes', 'A lake turning slowly, food swept round the basin in plumes.'],
  ['colonies', 'Colonies', 'Five wild colonies grow out and meet at their borders.'],
  ['lab', 'Tissue lab', 'Sixty cloned cells and no evolution: watch them link into tissue.'],
].filter(([id]) => !id || PRESETS[id]);

// the toy's tools: [id, icon, label, the action table's tool id, obstacle shape]
const TOOLSET = [
  ['touch', 'touch', 'touch', 'ripple'],
  ['wall', 'wall', 'wall', 'obstacle', 'wall'],
  ['block', 'block', 'block', 'obstacle', 'block'],
  ['pillar', 'pillar', 'pillar', 'obstacle', 'pillar'],
  ['erase', 'erase', 'erase', 'obstacle', 'erase'],
  ['cells', 'cells', 'cells', 'cell'],
  ['food', 'food', 'food', 'light'],
  ['light', 'light', 'light', 'spot'],
];
const FOODS = [['light', 'minerals', 'a mineral spring (water-like minerals and linkers for membranes)'],
  ['heavy', 'vent', 'a vent (fuel-rich, with metals and trace)'], ['oil', 'oil', 'an oil spring (droplets; cells can take oil into their skins)']];
const TOY_SPEEDS = [1, 4, 16, 0];   // 0 = MAX
const TOY_COVER = 0.15;             // the founders cover this share of a world's open water (scattered)
const TIPS = {
  touch: 'Touch: tap for a ripple, drag to stir the water',
  wall: 'Wall: drag to draw one (tap wall again: porous, only cells are stopped)',
  block: 'Block: drag to span a block',
  pillar: 'Pillar: tap for one, drag for a row',
  erase: 'Erase: drag across walls to cut a way through',
  cells: 'Cells: tap to drop a small group, drag for a line',
  light: 'Light: drag to move the spotlight (tap light again: the whole dish lit)',
};

/**
 * ctx (src/main.js): { app (the page as the action table sees it), actions, runAction, tools (TOOLS), cells, matter, light, obstacles,
 * water, oases, perfusion, background, params, flag, control, preset, appUI, view (getter), flash, showEntropy, touch }
 */
export function createToy(ctx) {
  const T = { ctx, world: null, dev: false, ui: null, baseShapes: 0 };
  const P = ctx.params, A = ctx.app;
  const byId = new Map(ctx.actions.map((a) => [a.id, a]));
  const toolIndex = (id) => ctx.tools.findIndex((t) => t.id === id);
  const chrome = !(P.has('ui') && !ctx.flag('ui'));   // ?ui=0: no chrome at all (pictures, the experiment tools)
  const base = { power: ctx.light.params.power, speed: ctx.water.params.speed, gyre: ctx.water.params.gyre };
  let foodK = 0;

  // ---------- the world now ----------
  const SEED = ctx.control.seed;
  if (ctx.preset) T.world = { type: 'preset', name: ctx.preset, seed: SEED };
  else if (P.has('terrain') && TERRAINS[P.get('terrain')]) T.world = { type: 'terrain', name: P.get('terrain'), seed: SEED };
  else T.world = { type: 'open', name: '', seed: SEED };
  const inPlaceOK = () => !ctx.preset && !P.has('snap');

  // ---------- the DOM ----------
  const root = el('div', 'toy');
  root.id = 'toy';
  const top = el('div', 'toy-top');
  const cap = el('button', 'toy-cap');
  cap.type = 'button';
  cap.title = 'Worlds: pick or generate another';
  const capName = el('span', 'toy-name'), capSeed = el('span', 'toy-seed'), capLine = el('span', 'toy-line');
  cap.append(capName, capSeed, capLine);
  const corner = el('div', 'toy-corner');
  const bLook = btn('look', 'look', 'Look: neon tubes or a harmonic microscope image', 'mini');
  const bShare = btn('share', 'share', 'Copy a link to this world', 'mini');
  const bGear = btn('gear', 'dev', 'Developer: every rule, view and counter (key D)', 'mini');
  corner.append(bLook, bShare, bGear);
  top.append(cap);
  const bar = el('div', 'toy-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Toy controls');
  const gA = el('div', 'toy-grp'), gT = el('div', 'toy-grp tools');
  const bPlay = btn('pause', 'pause', 'Pause / play (Space)');
  const bSpeed = btn('speed', '1×', 'Speed: tap for faster (a timelapse)');
  const bUndo = btn('undo', 'undo', 'Undo the last wall, block or pillar');
  const bWorlds = btn('worlds', 'worlds', 'Worlds: mazes, caves, rivers, the classic dishes');
  const bNew = btn('dice', 'new', 'A new world of the same kind (a new seed)');
  bNew.classList.add('hot');
  gA.append(bPlay, bSpeed, bUndo, bWorlds, bNew);
  const toolBtns = TOOLSET.map(([id, ic, label]) => { const b = btn(ic, label, TIPS[id] || label); b.dataset.tool = id; gT.append(b); return b; });
  bar.append(gA, gT);
  const toast = el('p', 'toy-toast');
  root.append(top, bar, toast);
  document.body.append(root, corner);
  corner.id = 'toy-corner';
  if (!chrome) { root.hidden = true; corner.hidden = true; }
  document.body.classList.toggle('toy-chrome', chrome);

  function btn(icon, label, title, cls = '') {
    const b = el('button', `toy-btn ${cls}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.append(svg(icon), el('span', 'tl', label));
    return b;
  }
  const setLabel = (b, t) => { b.querySelector('.tl').textContent = t; };
  const setIcon = (b, name) => { if (b.dataset.icon !== name) { b.dataset.icon = name; b.firstChild.replaceWith(svg(name)); } };

  // the toast: short friendly lines just above the bar
  let toastT = 0;
  function say(text, ms = 2200) {
    toast.textContent = text;
    toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('on'), ms);
  }
  T.say = say;

  // ---------- the bar's buttons ----------
  bPlay.addEventListener('click', () => { A.togglePause(); refresh(); });
  bSpeed.addEventListener('click', () => {
    const cur = A.speeds()[A.speedIndex()];
    const now = cur === 'MAX' ? 0 : parseInt(cur, 10);
    let i = TOY_SPEEDS.indexOf(now);
    i = (i < 0 ? 1 : i + 1) % TOY_SPEEDS.length;
    const s = TOY_SPEEDS[i];
    A.setSpeed(s ? [1, 2, 4, 8, 16, 32].indexOf(s) : 6);
    say(s === 1 ? 'Speed: real time' : s ? `Speed: ${s}× (a timelapse)` : 'Speed: as fast as this computer can');
    refresh();
  });
  bUndo.addEventListener('click', () => {
    const O = ctx.obstacles;
    if (!O || O.shapes.length <= T.baseShapes) { say('Nothing to undo: only what you drew (the dice builds another world)'); return; }
    O.undo();
    say('Undone');
  });
  bWorlds.addEventListener('click', () => openWorlds());
  bNew.addEventListener('click', () => {
    const name = T.world.type === 'terrain' ? T.world.name : TERRAIN_NAMES[Math.floor(Math.random() * TERRAIN_NAMES.length)];
    buildWorld(name, newSeed());
  });
  cap.addEventListener('click', () => openWorlds());
  bLook.addEventListener('click', () => {
    const H = A.neon.harmonic;
    H.toggle();
    if (H.on && !A.neon.on) A.neon.toggle();
    say(H.on ? 'Look: harmonic microscope (green membranes, orange fibres, violet metabolism)' : 'Look: neon');
    syncURL();
    refresh();
  });
  bShare.addEventListener('click', async () => {
    const link = shareLink();
    try { await navigator.clipboard.writeText(link); say('Link copied: send it to a friend', 2600); }
    catch { window.prompt('The link to this world:', link); }
  });
  bGear.addEventListener('click', () => setDev(!T.dev));
  gT.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.tool) pickTool(b.dataset.tool);
  });
  root.addEventListener('pointerup', (e) => { const b = e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
  corner.addEventListener('pointerup', (e) => { const b = e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });

  function toolNow() {
    const t = ctx.tools[A.tool] || {};
    if (t.obstacle) return ctx.obstacles ? ctx.obstacles.params.shape : 'wall';
    if (t.id === 'ripple') return 'touch';
    if (t.id === 'cell') return 'cells';
    if (t.id === 'light' || t.id === 'heavy' || t.id === 'oil') return 'food';
    if (t.id === 'spot') return 'light';
    return '';
  }
  function pickTool(id) {
    const def = TOOLSET.find((x) => x[0] === id);
    const again = toolNow() === id;
    const O = ctx.obstacles;
    if (id === 'food') {
      if (again) foodK = (foodK + 1) % FOODS.length;
      const [tid, name, what] = FOODS[foodK];
      A.setTool(toolIndex(tid));
      setLabel(toolBtns[6], name === 'minerals' ? 'food' : name);
      say(`Food: tap to place ${what}${again ? '' : '; tap food again for another kind'}`, 3000);
    } else if (id === 'light') {
      if (again) {
        const L = ctx.light.params;
        L.mode = L.mode === 'full' ? 'spot' : 'full';
        say(L.mode === 'full' ? 'Light: the whole dish lit' : 'Light: a spotlight (drag to move it)');
        if (L.mode === 'full') A.setTool(toolIndex('ripple'));
      } else { A.setTool(toolIndex('spot')); say(TIPS.light, 3000); }
    } else if (def[4]) {
      A.setTool(toolIndex('obstacle'));
      if (O) {
        if (again && id === 'wall') O.params.kind = O.params.kind === 'porous' ? 'solid' : 'porous';
        else if (!again) O.params.kind = 'solid';
        O.params.shape = def[4];
      }
      say(id === 'wall' && O && O.params.kind === 'porous' ? 'Porous wall: water and atoms pass, cells do not (tap wall again: solid)' : TIPS[id], 3000);
    } else {
      A.setTool(toolIndex(def[3]));
      say(TIPS[id] || id, 2600);
    }
    if (T.ui) T.ui.refresh();
    refresh();
  }

  // ---------- developer mode ----------
  function setDev(on, quiet = false) {
    T.dev = !!on;
    document.body.classList.toggle('dev', T.dev);
    document.body.classList.toggle('toy-mode', !T.dev);
    if (!T.dev && T.ui && T.ui.open) T.ui.openPanel(T.ui.open);
    bGear.setAttribute('aria-pressed', String(T.dev));
    if (ctx.appUI) ctx.appUI.cluster = T.dev ? 1 : 7;   // (in the toy a tap of the cells tool drops a small group)
    if (!quiet) {
      if (T.dev) ctx.flash('developer mode: every panel and key (D or the gear: back to the toy)');
      else say('Back to the toy (D or the gear: developer mode)');
    }
    refresh();
  }
  T.setDev = setDev;
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setDev(!T.dev); }
    else if (e.key === 'Escape' && sheet) closeWorlds();
  });
  // the Developer panel (the first of the old toolbar's panels in developer mode)
  T.devPanel = {
    id: 'dev', first: true,
    icon: ICON.gear,
    title: 'Developer: counters, overlays, the keys, back to the toy',
    build(body) {
      const row = (a) => {
        const r = el('div', 'row t-toggle');
        const m = el('div', 'rmain');
        const b = el('button', 'sw');
        b.type = 'button'; b.setAttribute('role', 'switch'); b.dataset.action = a.id;
        b.append(el('span', 'track'), el('span', 'lbl', a.label));
        m.append(b);
        const k = keysText(a);
        if (k && !ctx.touch) m.append(el('kbd', '', k));
        r.append(m, el('p', 'help', a.help));
        return r;
      };
      const back = el('div', 'row t-do');
      const bm = el('div', 'rmain');
      const bb = el('button', 'act', 'back to the toy');
      bb.type = 'button';
      bb.addEventListener('click', () => setDev(false));
      bm.append(bb);
      if (!ctx.touch) bm.append(el('kbd', '', 'D'));
      back.append(bm, el('p', 'help', 'the friendly front: a few big buttons, the worlds and the terrain generators; nothing of this panel shows there'));
      body.append(back);
      body.append(el('h3', '', 'Counters and overlays'));
      for (const id of ['entropy', 'stats', 'machinery', 'keys']) { const a = byId.get(id); if (a && !(a.desktop && ctx.touch)) body.append(row(a)); }
      body.append(el('h3', '', 'This world'));
      const w = el('p', 'note', '');
      w.dataset.world = '1';
      body.append(w);
      const chk = el('div', 'row t-do');
      const cm = el('div', 'rmain');
      const cb = el('button', 'act', 'check the open water');
      cb.type = 'button';
      cb.addEventListener('click', () => { const r = T.check(); ctx.flash(r ? `open water ${(100 * r.open).toFixed(0)} % of the dish, ${(100 * r.reached).toFixed(1)} % of it reachable from the colonies' homes; springs reached ${r.springs} of ${r.of}; ${r.shapes} shapes` : 'not a generated terrain'); });
      cm.append(cb);
      chk.append(cm, el('p', 'help', 'how much of the dish is open water, and how much of it the colonies can reach from their homes (moire.toy.check())'));
      body.append(chk);
      body.append(el('p', 'note', 'Every other control is in the panels beside this one: light, view (every view mode), rules (every rule, its knobs; save and load the state), dish (new culture, presets, obstacles), molecules and cells (the zoos). Every key works in both modes; ? lists them. URL: ?dev=1 starts here, ?entropy=1 opens the entropy panel, ?ui=0 hides all the controls.'));
    },
    refresh() {
      const w = document.querySelector('[data-world]');
      if (w) w.textContent = worldText();
    },
  };

  // ---------- worlds ----------
  function newSeed() { return 1 + Math.floor(Math.random() * 9999); }
  function worldText() {
    const W = T.world;
    if (W.type === 'terrain') return `${TERRAINS[W.name].label}, seed ${W.seed}: ${T.built ? `${T.built.shapes.length} shapes, ${T.built.springs.length} springs, open water ${(100 * T.built.open).toFixed(0)} %, ${ctx.cells.start} founders` : ''}`;
    if (W.type === 'preset') return `${PRESETS[W.name].label} (a preset), seed ${W.seed}`;
    return `the open dish, seed ${W.seed}`;
  }
  /** Build a terrain world in place (or, from a preset or a snapshot, open its link). */
  function buildWorld(name, seed) {
    if (!inPlaceOK()) { location.assign(linkFor({ type: 'terrain', name, seed }, false)); return; }
    applyWorld(name, seed, false);
    say(`${TERRAINS[name].label}, seed ${seed}`, 1800);
  }
  T.build = buildWorld;

  /** The world in the dish now: obstacles, springs, light, currents, perfusion and a fresh culture. boot: the page's first one. */
  function applyWorld(name, seed, boot) {
    const v = ctx.view, W = v.cssW, H = v.cssH, C = ctx.cells, R = C.R, M = ctx.matter, O = ctx.obstacles, WP = ctx.water.params;
    const t0 = performance.now();
    const w = makeWorld(name, seed, W, H, R);
    T.built = w;
    T.world = { type: 'terrain', name, seed: w.seed };
    // the old world's springs out (the oases' first: they remove their own), the new walls in
    if (!P.has('oases')) ctx.oases.params.count = 0;
    if (!P.has('scarce')) ctx.oases.params.scarce = false;
    ctx.oases.start();
    const oasisSprings = M.springs.filter((sp) => sp.kind === 'oasis');
    M.clearSprings();
    for (const sp of oasisSprings) M.springs.push(sp);   // (oases asked for by the URL stay: ?oases=N)
    O.setShapes(w.shapes, w.round);
    T.baseShapes = O.shapes.length;
    T.buildMs = performance.now() - t0;   // (the world's CPU work: making it and rasterising its walls; moire.toy.buildMs)
    // light, currents, perfusion
    const L = ctx.light.params;
    if (!P.has('light')) L.mode = 'full';
    if (!P.has('power')) L.power = base.power * (w.light.power || 1);
    // a new world starts in the morning, as a fresh page does (so its founders never meet the night first)
    if (!P.has('hour')) L.dayStart = (((0.35 - ctx.control.time() / Math.max(1, L.dayPeriod)) % 1) + 1) % 1;
    if (!P.has('curspeed')) WP.speed = w.water && w.water.speed != null ? w.water.speed : base.speed;
    if (!P.has('gyre')) WP.gyre = w.water && w.water.gyre != null ? w.water.gyre : base.gyre;
    const PP = ctx.perfusion.params;
    if (!P.has('perfusion')) PP.on = !!w.perfusion;
    if (w.perfusion) { PP.dir = w.perfusion.dir || 'right'; if (w.perfusion.speed != null) PP.speed = w.perfusion.speed; }
    ctx.perfusion.inlet = null;
    for (const s of w.springs) {
      M.addSpring(s.x, s.y, s.kind, s.life, s.rate != null ? { rate: s.rate } : {});
      M.springs[M.springs.length - 1].scene = true;   // (per area, as a preset's: src/dish.js)
    }
    O.freeSprings(M.springs);
    if (PP.on) ctx.perfusion.start(W, H, R);
    // the culture
    // the founders SCATTERED over the open water (a cell in an obstacle is drawn again), as many as cover TOY_COVER of it; every founder
    // catches light and burns (as the Colonies preset's). Tried first: two colonies at each of the world's homes: packed colonies
    // starved (a maze from 840 cells to 29 in 200 s), scattered founders found every spring (247 left, bright clusters round the food)
    const cover = Number(P.get('toycover')) > 0 ? Number(P.get('toycover')) : TOY_COVER;   // (?toycover=x: the knob)
    const nOpen = cover * w.open * W * H / (Math.PI * R * R);
    C.start = Math.max(40, Math.min(C.count, Math.round(Number(P.get('cells')) || nOpen)));
    const centres = w.homes.flatMap(([x, y]) => [[x - 1.5 * R, y - 1.5 * R], [x + 1.5 * R, y + 1.5 * R]]);
    C.layout = P.get('toyspread') === 'homes' ? { spread: 'colonies', colonies: centres.length, diversity: 'mixed', centres: () => centres, ring: null }
      : { spread: 'scatter', colonies: 5, diversity: 'mixed', centres: null, ring: null };
    if (!P.has('squeeze')) C.params.squeeze = SPREAD_SQUEEZE;
    // with carbon (the default since the merge): every founder a PHOTOSYNTHESISER, which with carbon is a carbon fixer (genome.js
    // founderCarbon: light makes its sugar-like body carbon, it burns some of it, and bonds the freed g with t). The light + burn founders
    // ('both', as with ?carbon=0) lose their fermenter to the carbon engine there and live on light alone: a maze held 181 cells at 4
    // minutes against 407 photosynthesisers (?carbon=0: 364; the usual spread of habits 327), rings 216 (the usual spread 168 at 3.5
    // minutes); ?habit= still chooses
    const toyHabit = CARBON ? 'pigments' : 'both';
    const G = C.genome.params;
    const seedNow = () => {
      const habit0 = G.habit;
      if (!P.has('habit')) G.habit = toyHabit;
      C.seed(true);
      G.habit = habit0;
    };
    // (the page's first world: its culture replaces the open dish's only once a frame has run. Seeded again before any frame, the open
    // dish's founders' batteries, handed back as heat, never reached the books: the energy rounding stood at +3.2e3 from the start in
    // every world opened by a link, carbon on or off; a world built later was exact)
    // the old world's atoms washed out (booked as gone), once the old cells' stock is back in the dish
    const washSoon = () => requestAnimationFrame(() => requestAnimationFrame(() => M.wash()));
    // (?toywash=1: the page's first world washed too. The page's first culture, the open dish's ~2000 founders in one clump, leaves its
    // carbon bodies as tar where it stood, and walls built over the clump push that tar into the open water: the river delta's channels
    // start under an amber crust. Washed out, the start looks clean, but that tar is the founders' first FOOD (cells graze it into body
    // carbon): washed worlds grew less (seed 3 at 4 minutes, washed against kept: a phone's delta 77 against 277, thicket 130 against 185,
    // islands 280 against 365; a computer's delta 790 against 856, thicket 256 against 456), so a fresh load and every link keep it;
    // README "A fresh load opens a generated world")
    const bootWash = boot && ctx.flag('toywash');
    if (boot && !(C.tick > 0)) {
      const wait = () => { if (C.tick > 0) { seedNow(); if (bootWash) washSoon(); } else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
    } else { seedNow(); if (bootWash) washSoon(); }
    if (!boot) {
      washSoon();
      ctx.background.impulse(W / 2, H / 2, 2);
    }
    camera.fit();
    syncURL();
    caption();
    refresh();
    return w;
  }
  T.apply = (name, seed) => applyWorld(name, seed >>> 0, false);
  /** moire.toy.check(): the world's open water and how much of it the colonies can reach from their homes. */
  T.check = () => (T.built ? reach(T.built, ctx.view.cssW, ctx.view.cssH, ctx.cells.R) : null);

  // ---------- links ----------
  const OWN = ['terrain', 'seed', 'dish', 'preset', 'world', 'look', 'ui', 'dev', 'entropy', 'overlay', 'zoom', 'speed', 'paused', 'until', 'cells', 'round', 'snap'];
  function linkFor(W, withDish = true) {
    const u = new URL(location.href);
    const q = new URLSearchParams();
    if (W.type === 'terrain') {
      q.set('terrain', W.name);
      q.set('seed', String(W.seed));
      if (withDish) { const [a, b] = dish.sizeR; q.set('dish', `${a.toFixed(1)}x${b.toFixed(1)}`); }
    } else if (W.type === 'preset') {
      q.set('preset', W.name); q.set('seed', String(W.seed));
      for (const k of ['cells', 'dish', 'round']) if (P.has(k)) q.set(k, P.get(k));
    } else {
      q.set('seed', String(W.seed));
      for (const k of ['cells', 'dish', 'round']) if (P.has(k)) q.set(k, P.get(k));
    }
    // other options of this page (a chemistry switch, a rule) go along, unless a preset or snapshot set them
    if (W.type !== 'preset' && !ctx.preset) for (const [k, v] of new URLSearchParams(location.search)) if (!OWN.includes(k) && !q.has(k)) q.set(k, v);
    if (A.neon.harmonic.on) q.set('look', 'harmonic');
    u.search = q.toString();
    u.hash = '';
    return u.href;
  }
  const shareLink = () => linkFor(T.world, true);
  T.link = shareLink;
  function syncURL() {
    if (P.has('snap') || P.has('until')) return;   // (experiments: the address stays as given)
    try {
      const keep = new URLSearchParams(location.search);
      const want = new URL(shareLink());
      for (const k of ['dev', 'ui', 'entropy', 'overlay']) if (keep.has(k)) want.searchParams.set(k, keep.get(k));
      if (want.href !== location.href) history.replaceState(null, '', want.href);
    } catch { /* a sandboxed page */ }
  }

  // ---------- the caption ----------
  let capT = 0;
  function caption() {
    const W = T.world;
    const [name, line] = W.type === 'terrain' ? [TERRAINS[W.name].label, TERRAINS[W.name].line]
      : W.type === 'preset' ? (CLASSIC.find((c) => c[0] === W.name) || [0, PRESETS[W.name].label, PRESETS[W.name].desc.split('. ')[0] + '.']).slice(1)
        : ['Open dish', CLASSIC[0][2]];
    capName.textContent = name;
    capSeed.textContent = W.type === 'terrain' ? `seed ${W.seed}` : '';
    capLine.textContent = line;
    cap.classList.add('fresh');
    clearTimeout(capT);
    capT = setTimeout(() => cap.classList.remove("fresh"), 12000);
  }

  // ---------- the worlds sheet ----------
  let sheet = null;
  const previews = new Map();   // terrain -> the seed its card shows
  function openWorlds() {
    if (sheet) { closeWorlds(); return; }
    sheet = el('div', 'toy-sheet-wrap');
    const box = el('section', 'toy-sheet');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Worlds');
    const head = el('header', 'toy-sheet-head');
    head.append(el('h2', '', 'Worlds'));
    const shuffle = el('button', 'toy-btn mini', null);
    shuffle.type = 'button'; shuffle.title = 'Show other seeds'; shuffle.setAttribute('aria-label', 'Show other seeds');
    shuffle.append(svg('dice'), el('span', 'tl', 'other seeds'));
    const x = el('button', 'toy-btn mini');
    x.type = 'button'; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
    x.append(svg('close'), el('span', 'tl', 'close'));
    head.append(shuffle, x);
    const body = el('div', 'toy-sheet-body');
    body.append(el('h3', '', 'Generate a world'), el('p', 'toy-sub', 'Each picture is a world from a seed. Tap one to build it here; the dice in the bar rolls another of the same kind.'));
    const grid = el('div', 'toy-cards');
    const cards = [];
    for (const name of TERRAIN_NAMES) {
      const Tn = TERRAINS[name];
      if (!previews.has(name)) previews.set(name, newSeed());
      const c = el('button', 'toy-card');
      c.type = 'button'; c.dataset.terrain = name;
      const cv = el('canvas', 'toy-thumb');
      const nm = el('b', '', Tn.label), sd = el('small', '', ''), ln = el('span', '', Tn.line);
      c.append(cv, nm, sd, ln);
      if (T.world.type === 'terrain' && T.world.name === name) c.setAttribute('aria-current', 'true');
      grid.append(c);
      cards.push({ c, cv, sd, name });
    }
    body.append(grid);
    // a seed typed by hand
    const seedRow = el('div', 'toy-seedrow');
    const sel = el('select', 'toy-input');
    for (const name of TERRAIN_NAMES) { const o = el('option', '', TERRAINS[name].label); o.value = name; sel.append(o); }
    if (T.world.type === 'terrain') sel.value = T.world.name;
    const inp = el('input', 'toy-input');
    Object.assign(inp, { type: 'number', min: 1, max: 999999, step: 1, value: String(T.world.type === 'terrain' ? T.world.seed : 42) });
    inp.setAttribute('aria-label', 'seed');
    const go = el('button', 'toy-go', 'build');
    go.type = 'button';
    seedRow.append(el('span', 'toy-sub', 'or by seed:'), sel, inp, go);
    body.append(seedRow);
    body.append(el('h3', '', 'Classic dishes'), el('p', 'toy-sub', 'The hand-made dishes (they open as a fresh page).'));
    const list = el('div', 'toy-classic');
    for (const [id, label, line] of CLASSIC) {
      const b = el('button', 'toy-row');
      b.type = 'button'; b.dataset.preset = id;
      b.append(el('b', '', label), el('span', '', line));
      if ((T.world.type === 'preset' && T.world.name === id) || (T.world.type === 'open' && !id)) b.setAttribute('aria-current', 'true');
      list.append(b);
    }
    body.append(list);
    box.append(head, body);
    sheet.append(box);
    document.body.append(sheet);
    document.body.classList.add('toy-sheet-open');
    // the pictures, one per frame (a phone keeps responding)
    const draw = (k = 0) => {
      if (!sheet || k >= cards.length) return;
      const { cv, sd, name } = cards[k];
      const s = previews.get(name);
      sd.textContent = `seed ${s}`;
      thumb(cv, name, s);
      requestAnimationFrame(() => draw(k + 1));
    };
    requestAnimationFrame(() => draw(0));
    shuffle.addEventListener('click', () => { for (const n of TERRAIN_NAMES) previews.set(n, newSeed()); draw(0); });
    x.addEventListener('click', closeWorlds);
    sheet.addEventListener('pointerdown', (e) => { if (e.target === sheet) closeWorlds(); });
    box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.terrain) { const n = b.dataset.terrain; closeWorlds(); buildWorld(n, previews.get(n)); }
      else if (b.dataset.preset != null) {
        const q = new URLSearchParams();
        if (b.dataset.preset) q.set('preset', b.dataset.preset);
        else q.set('world', 'open');   // (the plain open dish: a link with no option at all opens a generated world, index.html)
        if (A.neon.harmonic.on) q.set('look', 'harmonic');
        if (P.has('dev')) q.set('dev', P.get('dev'));
        const u = new URL(location.href); u.search = q.toString(); u.hash = '';
        location.assign(u.href);
      } else if (b === go) { const s = Math.max(1, Math.round(Number(inp.value) || 1)); closeWorlds(); buildWorld(sel.value, s); }
    });
  }
  function closeWorlds() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    document.body.classList.remove('toy-sheet-open');
  }

  /** A card's picture: the world's walls as the dish draws them (a dark fill, an ice-blue tube on the edge), the springs as dots in their inks. */
  function thumb(cv, name, seed) {
    const v = ctx.view, W = v.cssW, H = v.cssH, R = ctx.cells.R;
    const w = makeWorld(name, seed, W, H, R);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(cv.clientWidth || 150), chh = Math.round(cw * H / W);
    const pw = Math.max(40, Math.round(cw * dpr)), ph = Math.max(24, Math.round(chh * dpr));
    cv.width = pw; cv.height = ph;
    cv.style.height = `${chh}px`;
    const g = cv.getContext('2d');
    const img = g.createImageData(pw, ph), px = img.data;
    const sc = W / pw, C = (3 * dpr + 1) * sc;   // dish px per picture px; the field kept to +- C (beyond the halo's reach)
    const sh = w.shapes.map((s) => ({ s, b: boxOf(s) }));
    const rD = Math.min(W, H) / 2 - R;
    for (let j = 0; j < ph; j++) {
      const y = (j + 0.5) * sc;
      for (let i = 0; i < pw; i++) {
        const x = (i + 0.5) * sc;
        let a = C, porous = false;
        for (const { s, b } of sh) {
          if (x < b[0] - C || x > b[2] + C || y < b[1] - C || y > b[3] + C) continue;
          const d = shapeSd(s, x, y);
          if (s.kind === 'erase') { if (-d > a) a = -d; } else if (d < a) { a = d; porous = s.kind === 'porous'; }
        }
        if (w.round) { const r = rD - Math.hypot(x - W / 2, y - H / 2); if (r < a) { a = r; porous = false; } }
        const t = a / sc;   // picture px from the edge
        let r = 4, gg = 6, bb = 10;
        if (t < 0) { r = 8; gg = 12; bb = 18; if (porous) { r = 10; gg = 24; bb = 24; } }
        const e = Math.max(0, 1 - Math.abs(t) / (0.9 * dpr)), halo = Math.max(0, 1 - Math.abs(t) / (3 * dpr)) * 0.35;
        const k = e + halo;
        const ink = porous ? [128, 242, 216] : [140, 217, 255];
        r += ink[0] * k + 255 * e * 0.35; gg += ink[1] * k + 255 * e * 0.35; bb += ink[2] * k + 255 * e * 0.35;
        const o = (j * pw + i) * 4;
        px[o] = Math.min(255, r); px[o + 1] = Math.min(255, gg); px[o + 2] = Math.min(255, bb); px[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // the springs (their inks)
    const dot = (x, y, r, c, glow) => { g.beginPath(); g.arc(x / sc, y / sc, r, 0, 2 * Math.PI); g.fillStyle = c; g.shadowColor = c; g.shadowBlur = glow; g.fill(); g.shadowBlur = 0; };
    for (const s of w.springs) { const c = springInk(s.kind); dot(s.x, s.y, 2 * dpr, `rgb(${c.map((q) => Math.round(Math.min(255, q * 1.15))).join(',')})`, 6 * dpr); }
    if (w.perfusion) { g.fillStyle = 'rgba(140,217,255,0.55)'; g.fillRect(0, 0, 1.5 * dpr, ph); }
  }

  // ---------- state ----------
  function refresh() {
    const paused = A.paused;
    setIcon(bPlay, paused ? 'play' : 'pause');
    setLabel(bPlay, paused ? 'play' : 'pause');
    bPlay.setAttribute('aria-pressed', String(paused));
    setLabel(bSpeed, A.speedLabel());
    bSpeed.setAttribute('aria-pressed', String(A.speedLabel() !== '1×'));
    const tn = toolNow();
    for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === tn));
    const O = ctx.obstacles;
    setLabel(toolBtns[1], O && O.params.kind === 'porous' ? 'porous' : 'wall');
    toolBtns[1].classList.toggle('porous', !!(O && O.params.kind === 'porous'));
    bUndo.disabled = !(O && O.shapes.length > T.baseShapes);
    bLook.setAttribute('aria-pressed', String(!!A.neon.harmonic.on));
    setLabel(bLook, A.neon.harmonic.on ? 'harmonic' : 'neon');
    const st = document.documentElement.style;
    st.setProperty('--toy-h', `${chrome && !T.dev ? bar.offsetHeight : 0}px`);
  }
  T.refresh = refresh;
  // a FRESH LOAD (index.html: no URL options, a generated world picked at random): after about a minute many founders die (the founders'
  // crash, every culture has it) and the dish thins out before the survivors grow; one friendly line explains it as it begins
  const fresh = typeof window !== 'undefined' && window.__moireFresh && T.world.type === 'terrain';
  let freshSaid = !fresh || !chrome;
  setInterval(() => {
    refresh();
    if (!freshSaid && ctx.control.time() > 50 && !sheet) {
      freshSaid = true;
      say('Many of the first cells die now; the survivors find the food and grow back. The speed button makes a timelapse', 9000);
    }
  }, 400);
  if (window.ResizeObserver) new ResizeObserver(refresh).observe(bar);

  // ---------- start ----------
  T.attach = (ui) => {
    T.ui = ui;
    T.baseShapes = ctx.obstacles ? ctx.obstacles.shapes.length : 0;   // (a preset's own walls: not undone by the toy)
    setDev(ctx.flag('dev'), true);
    if (T.world.type === 'terrain' && inPlaceOK()) applyWorld(T.world.name, T.world.seed, true);
    else caption();
    refresh();
  };
  return T;
}

// a shape's box (as src/obstacles.js shapeBox)
function boxOf(s) {
  if (s.type === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
  if (s.type === 'rect') return [Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.max(s.x0, s.x1), Math.max(s.y0, s.y1)];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - s.w / 2, y0 - s.w / 2, x1 + s.w / 2, y1 + s.w / 2];
}
