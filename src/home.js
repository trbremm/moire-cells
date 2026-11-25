// Step H2: THE HOME SCREEN (the user, 2026-11-25: "we need the home screen of the app to either go to tissue lab or to culture dish").
// A plain link (no URL options; or ?go=lab, its tissue-lab menu) starts THIS module instead of src/main.js (index.html): no GPU, no
// simulation, only a page with the title, one line, and two big choices, drawn over a faint moire of two neon dot lattices whose angle
// breathes slowly (two CSS layers, turned by the compositor; still with prefers-reduced-motion).
//   CULTURE DISH  ?go=dish: index.html turns it into a random generated world (?terrain=kind&seed=N), as the plain link did before H2;
//   TISSUE LAB    a menu of the hand-designed lab pieces (src/labs.js), each a card linking to its own options (?tissue=organ, ...).
// Every choice is a real link (a new page), so the browser's back button returns here and nothing keeps running behind. Links with any
// other option never come here (share links, presets, the experiment tools). README "Step H2: a home screen".

import { LABS, labQuery } from './labs.js';

window.__moireBooted = true;   // (index.html's safety net: the page did start)
{ const m = document.getElementById('msg'); if (m && m.dataset.net) { m.hidden = true; delete m.dataset.net; } }

const DESC = 'A neon petri dish where cells evolve, eat and build tissues on a landscape of moiré fields.';
const NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function glyph(inner, vb = 40) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${vb} ${vb}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}
const base = () => location.pathname;   // (the page itself, no query: this screen)
// ?go=home&nogpu=1 (or ?go=lab&nogpu=1): pretend WebGPU is missing, here and in every choice (main.js's ?nogpu=1: its fallback message)
const NOGPU = new URLSearchParams(location.search).get('nogpu') === '1';
const linkTo = (q) => `${base()}?${q}${NOGPU ? '&nogpu=1' : ''}`;

const DISH_GLYPH = '<circle cx="20" cy="20" r="17"/><circle cx="20" cy="20" r="13.5" stroke-opacity="0.4"/>' +
  '<path d="M13 13l3 1.7v3.4l-3 1.7-3-1.7v-3.4zM19 17l3 1.7v3.4l-3 1.7-3-1.7v-3.4zM25 22l3 1.7v3.4l-3 1.7-3-1.7v-3.4z"/>' +
  '<path d="M9 26c3 1 5-1 8 1" class="g2"/><circle cx="27" cy="12" r="1.6" class="g2"/>';
const LAB_GLYPH = '<path d="M15 4h10M17 4v11L7 33a3 3 0 0 0 2.6 4.5h20.8A3 3 0 0 0 33 33L23 15V4"/>' +
  '<path d="M12 26h16" class="g2"/><path d="M14 31l3-2 3 2 3-2 3 2" class="g2"/>';

// ---------- the faint moire behind it all ----------
function lattice(rgb, a, dot) {
  // one tile of a hexagonal lattice (spacing a CSS px), drawn 4x for crisp dots, as a data URL for a repeating background
  const k = 4, w = Math.round(a * k), h = Math.round(a * Math.sqrt(3) * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${rgb})`;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) { g.beginPath(); g.arc(x, y, dot * k, 0, 2 * Math.PI); g.fill(); }
  return { url: c.toDataURL(), w: w / k, h: h / k };
}
function motif() {
  const wrap = el('div', 'home-moire');
  wrap.setAttribute('aria-hidden', 'true');
  try {
    const A = lattice('24, 232, 255', 12, 1.7), B = lattice('255, 46, 158', 12.25, 1.7);
    for (const [L, cls] of [[A, 'home-lat a'], [B, 'home-lat b']]) {
      const d = el('div', cls);
      d.style.backgroundImage = `url(${L.url})`;
      d.style.backgroundSize = `${L.w}px ${L.h}px`;
      wrap.append(d);
    }
  } catch { /* no canvas: a plain dark page */ }
  return wrap;
}

// ---------- the page ----------
function build() {
  document.body.classList.add('home-on');
  document.title = 'Moiré Cells';
  const root = el('div', 'home');
  root.id = 'home';
  root.append(motif());

  // the start: title, line, two choices
  const start = el('main', 'home-start');
  const h1 = el('h1', 'home-title', 'Moiré cells');
  const line = el('p', 'home-line', DESC);
  const choices = el('nav', 'home-choices');
  choices.setAttribute('aria-label', 'Start');
  const dish = el('a', 'home-choice');
  dish.href = linkTo('go=dish');
  dish.dataset.go = 'dish';
  dish.append(glyph(DISH_GLYPH), el('b', '', 'Culture dish'),
    el('span', '', 'A world of walls, rivers and springs, picked at random. Cells grow, die back, find the food and evolve. Other worlds are one tap away.'));
  const lab = el('a', 'home-choice lab');
  lab.href = linkTo('go=lab');
  lab.dataset.go = 'lab';
  lab.append(glyph(LAB_GLYPH), el('b', '', 'Tissue lab'),
    el('span', '', 'Hand-designed tissues to poke: a muscle with its nerve, a limb that bends, a sheet that carries waves.'));
  choices.append(dish, lab);
  start.append(h1, line, choices);
  if (!navigator.gpu || NOGPU) {
    start.append(el('p', 'home-note', 'This browser has no WebGPU, so the dish cannot run here: it needs Chrome or Edge, Firefox 141+ on Windows, or Safari 26. Each choice will say so.'));
  }
  const foot = el('p', 'home-foot');
  const open = el('a', '', 'the plain open dish');
  open.href = linkTo('world=open');
  const dev = el('a', '', 'developer mode');
  dev.href = linkTo('world=open&dev=1');
  foot.append(open, document.createTextNode(' · '), dev);
  start.append(foot);

  // the tissue lab's menu
  const menu = el('section', 'home-lab');
  menu.setAttribute('aria-label', 'Tissue lab');
  const head = el('header', 'home-lab-head');
  const back = el('a', 'home-back');
  back.href = base();
  back.setAttribute('aria-label', 'Home');
  back.append(glyph('<path d="M24 9L13 20l11 11"/>'), el('span', '', 'home'));
  head.append(back, el('h2', '', 'Tissue lab'));
  const sub = el('p', 'home-sub', 'Hand-designed tissues: every cell’s genome set by hand, no evolution until you let it. Each one says how to poke it.');
  const grid = el('div', 'home-cards');
  for (const L of LABS) {
    const c = el('a', 'home-card');
    c.href = linkTo(labQuery(L));
    c.dataset.lab = L.id;
    const top = el('div', 'home-card-top');
    top.append(glyph(L.glyph), el('b', '', L.name));
    c.append(top, el('span', 'home-card-line', L.line), el('span', 'home-card-hint', L.hint));
    grid.append(c);
  }
  menu.append(head, sub, grid);

  root.append(start, menu);
  document.body.append(root);

  // the lab menu is ?go=lab (so a reload, a shared link and the back button keep it)
  const show = () => {
    const inLab = new URLSearchParams(location.search).get('go') === 'lab';
    root.classList.toggle('in-lab', inLab);
    start.hidden = inLab;
    menu.hidden = !inLab;
    document.body.dataset.stage = inLab ? 'home-lab' : 'home';   // (tools/shot.py takes a 'home' stage as ready)
  };
  const go = (href, e) => {
    if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;   // (a new tab: the browser's own)
    if (e) e.preventDefault();
    try { history.pushState(null, '', href); } catch { location.assign(href); return; }
    show();
    window.scrollTo(0, 0);
    (new URLSearchParams(location.search).get('go') === 'lab' ? grid.querySelector('a') : lab).focus({ preventScroll: true });
  };
  lab.addEventListener('click', (e) => go(lab.href, e));
  back.addEventListener('click', (e) => go(back.href, e));
  window.addEventListener('popstate', show);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('in-lab')) go(base()); });
  show();
}

build();
