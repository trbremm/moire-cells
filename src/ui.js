// Step C3b: the toolbar and its panels, a plain DOM overlay over the canvas (no framework). Every button runs an entry
// of the action table (src/actions.js), the same entry its key runs, and every switch shows that entry's state (polled,
// so a change by a key or from the console shows too).
//
// Layout (bottom left, in one column): the flash / hint line, the open panel (at most one), the bar. The bar: a fold
// button, the TOOLS (what a tap and a drag on the dish do), playback (pause, speed, record), and the panel buttons
// (light, view, rules, dish). Folded, only the fold button stays. Style: the page's look, thin outlines, flat, no glow.

import { TOOLS, keysText } from './actions.js';
import { springInk } from './matter.js';

const NS = 'http://www.w3.org/2000/svg';
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

// line icons, 20 x 20, drawn with the button's colour (currentColor)
const ICONS = {
  ripple: '<circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="8.2" stroke-dasharray="2.2 2.2"/>',
  light: () => `<circle cx="10" cy="10" r="5.5" style="stroke:${rgb(springInk('light'))}" stroke-width="1.25"/><circle cx="10" cy="10" r="1.6" style="fill:${rgb(springInk('light'))}" stroke="none"/>`,
  heavy: () => `<circle cx="10" cy="10" r="5.5" style="stroke:${rgb(springInk('heavy'))}" stroke-width="2.25"/><circle cx="10" cy="10" r="2.2" style="fill:${rgb(springInk('heavy'))}" stroke="none"/>`,
  stir: '<path d="M2.5 13.5c1.6-3.2 3.4-4.8 5.4-4.8 3 0 3 4.6 6 4.6 1.4 0 2.6-1.1 3.6-3.3"/><path d="M14.6 10.2l3-.3.4 3"/>',
  spot: '<ellipse cx="10.5" cy="10" rx="7" ry="4.6"/><path d="M1.6 10l3.4-2.2v4.4z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6 4.5v11M14 4.5v11" stroke-width="3"/>',
  play: '<path d="M6 4.2l10 5.8-10 5.8z" fill="currentColor" stroke="none"/>',
  record: '<circle cx="10" cy="10" r="5.2"/>',
  sun: '<circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2.6M10 15.6v2.6M1.8 10h2.6M15.6 10h2.6M4.2 4.2l1.8 1.8M14 14l1.8 1.8M4.2 15.8l1.8-1.8M14 6l1.8-1.8"/>',
  eye: '<path d="M1.6 10c2.4-4 5.1-5.6 8.4-5.6s6 1.6 8.4 5.6c-2.4 4-5.1 5.6-8.4 5.6S4 14 1.6 10z"/><circle cx="10" cy="10" r="2.4"/>',
  rules: '<path d="M2.5 6h15M2.5 14h15"/><rect x="11" y="3.8" width="4.4" height="4.4" fill="var(--bg)"/><rect x="4.6" y="11.8" width="4.4" height="4.4" fill="var(--bg)"/>',
  dish: '<circle cx="10" cy="10" r="7.8"/><circle cx="7.6" cy="8.4" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="11.2" cy="12.4" r="1.7" fill="currentColor" stroke="none"/>',
  fold: '<path d="M5 7.5l5 5 5-5"/>',
  unfold: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
};

function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const v = ICONS[name];
  svg.innerHTML = typeof v === 'function' ? v() : v;
  return svg;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const PANELS = [
  { id: 'light', icon: 'sun', title: 'Light: spotlight, full field or off; tilt and direction' },
  { id: 'view', icon: 'eye', title: 'View: what is drawn' },
  { id: 'dish', icon: 'dish', title: 'Dish: speed, new culture, springs and atoms' },
];

/**
 * Build the toolbar. `app` is main.js's view of the page (as for the action table) plus:
 *   actions, runAction(a, k), flash(text), touch (no mouse), startFolded, tiltText(), turnText().
 */
export function setupUI(app) {
  const byId = new Map(app.actions.map((a) => [a.id, a]));
  const root = el('div', 'ui');
  root.id = 'ui';
  const panel = el('section', 'panel');
  panel.hidden = true;
  const bar = el('div', 'bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Controls');
  root.append(panel, bar);
  document.body.append(root);
  const hint = document.getElementById('hint');

  let open = null;   // the open panel's id
  let folded = false;

  // ---------- the bar ----------
  const foldBtn = button('fold', 'Hide the controls', 'btn fold');
  foldBtn.dataset.ui = 'fold';
  const tools = el('div', 'grp');
  TOOLS.forEach((t, i) => {
    const a = byId.get(`tool-${t.id}`);
    const b = button(t.id, `${cap(t.name)}${t.key ? ` (${t.key})` : ''}: ${a.help}`, 'btn tool');
    b.dataset.action = a.id;
    tools.append(b);
  });
  const play = el('div', 'grp');
  if (byId.has('pause')) { const b = button('pause', 'Pause / play (Space)', 'btn'); b.dataset.action = 'pause'; play.append(b); }
  const speedBtn = el('button', 'btn speed');
  speedBtn.type = 'button';
  speedBtn.title = 'Speed ([ and ]): tap for faster; the small number is the speed reached';
  speedBtn.dataset.ui = 'speed';
  speedBtn.append(el('span', 'set', '1×'), el('span', 'got', ''));
  play.append(speedBtn);
  if (byId.has('record')) {
    const b = button('record', 'Record the dish as a video (Shift+V); tap again to stop and save', 'btn rec');
    b.dataset.action = 'record';
    play.append(b);
  }
  const panels = el('div', 'grp');
  for (const p of PANELS) {
    const b = button(p.icon, p.title, 'btn');
    b.dataset.panel = p.id;
    panels.append(b);
  }
  bar.append(foldBtn, tools, play, panels);

  function button(iconName, title, cls) {
    const b = el('button', cls);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.append(icon(iconName));
    return b;
  }

  // ---------- panels ----------
  function openPanel(id) {
    open = open === id ? null : id;
    panel.replaceChildren();
    panel.hidden = !open;
    if (open) {
      const head = el('header', 'phead');
      head.append(el('h2', '', PANELS.find((p) => p.id === open).title.split(':')[0]));
      const x = button('close', 'Close', 'x');
      x.dataset.ui = 'close';
      head.append(x);
      const body = el('div', 'pbody');
      panel.append(head, body);
      BUILD[open](body);
    }
    refresh();
  }

  const BUILD = {
    light(body) {
      body.append(choiceRow(byId.get('lightMode')));
      const L = app.light.params;
      body.append(slider('tilt', 'tilt', 0, L.maxTilt, 1, () => L.tilt, (v) => { L.tilt = v; return app.tiltText(); },
        (v) => `${Math.round(v)}°`, 'how oblique the beam falls: the spot stretches away from the light, brighter on its near side'));
      body.append(slider('az', 'comes from', 0, 355, 5, () => L.az, (v) => { app.light.turnBy(v - L.az); return app.turnText(); },
        () => app.compass(L.az), 'the direction the light comes from (the small triangle on the spot\'s rim)'));
      body.append(row(byId.get('day')));
      body.append(el('p', 'note', app.touch ? 'Move the spot with the move-light tool (the ellipse in the bar).'
        : 'Move the spot with the move-light tool or a right-drag; the wheel tilts it, Shift+wheel turns it.'));
    },
    view(body) {
      for (const a of app.actions) if (a.group === 'view' && !(a.desktop && app.touch)) body.append(row(a));
    },
    dish(body) {
      body.append(speedRow());
      for (const a of app.actions) if (a.group === 'play' && a.type === 'do') body.append(row(a));
      if (byId.has('record')) body.append(el('p', 'note', 'Recording saves only the dish (the canvas), not these panels.'));
    },
  };

  /** One row for an action: a switch, a setting that cycles, a knob with - and +, or a button. */
  function row(a) {
    if (a.options && a.set) return choiceRow(a);
    const r = el('div', `row t-${a.type}`);
    const k = keysText(a);
    const main = el('div', 'rmain');
    if (a.type === 'toggle') {
      const b = el('button', 'sw');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.dataset.action = a.id;
      b.append(el('span', 'track'), el('span', 'lbl', a.label));
      main.append(b);
    } else if (a.type === 'cycle') {
      const b = el('button', 'cyc');
      b.type = 'button';
      b.dataset.action = a.id;
      b.title = 'tap for the next setting';
      b.append(el('span', 'lbl', a.label), el('span', 'val', ''));
      main.append(b);
    } else if (a.type === 'knob') {
      main.append(el('span', 'lbl', a.label));
      const g = el('span', 'knobs');
      const minus = el('button', 'kb', '−'); minus.type = 'button'; minus.dataset.action = a.id; minus.dataset.k = '-';
      const plus = el('button', 'kb', '+'); plus.type = 'button'; plus.dataset.action = a.id; plus.dataset.k = '+';
      const val = el('span', 'val'); val.dataset.value = a.id;
      g.append(minus, val, plus);
      main.append(g);
    } else {
      const b = el('button', 'act', a.label);
      b.type = 'button';
      b.dataset.action = a.id;
      main.append(b);
    }
    if (k && !app.touch) main.append(el('kbd', '', k));
    r.append(main, el('p', 'help', a.help));
    return r;
  }

  /** A setting with a few named options, as a row of buttons (light mode, colour by). */
  function choiceRow(a) {
    const r = el('div', 'row choice');
    const main = el('div', 'rmain');
    main.append(el('span', 'lbl', a.label));
    const seg = el('span', 'seg');
    for (const o of a.options()) {
      const b = el('button', '', o);
      b.type = 'button';
      b.dataset.action = a.id;
      b.dataset.set = o;
      seg.append(b);
    }
    main.append(seg);
    const k = keysText(a);
    if (k && !app.touch) main.append(el('kbd', '', k));
    r.append(main, el('p', 'help', a.help));
    return r;
  }

  function speedRow() {
    const r = el('div', 'row choice');
    const main = el('div', 'rmain');
    main.append(el('span', 'lbl', 'speed'));
    const seg = el('span', 'seg');
    app.speeds().forEach((s, i) => {
      const b = el('button', '', s);
      b.type = 'button';
      b.dataset.speed = String(i);
      seg.append(b);
    });
    main.append(seg);
    if (!app.touch) main.append(el('kbd', '', '[ ]'));
    r.append(main, el('p', 'help', byId.get('speed').help));
    return r;
  }

  const sliders = [];
  function slider(id, label, min, max, step, get, set, show, help) {
    const r = el('div', 'row slider');
    const main = el('label', 'rmain');
    main.append(el('span', 'lbl', label));
    const inp = el('input');
    Object.assign(inp, { type: 'range', min, max, step });
    const val = el('span', 'val');
    main.append(inp, val);
    r.append(main, el('p', 'help', help));
    inp.addEventListener('input', () => { const t = set(Number(inp.value)); val.textContent = show(Number(inp.value)); if (t) app.flash(t); });
    sliders.push({ id, inp, val, get, show });
    return r;
  }

  // ---------- events ----------
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.ui === 'fold') { setFolded(!folded); return; }
    if (b.dataset.ui === 'close') { openPanel(open); return; }
    if (b.dataset.ui === 'speed') { const n = app.speeds().length; app.flash(app.setSpeed((app.speedIndex() + 1) % n)); refresh(); return; }
    if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
    if (b.dataset.speed) { app.flash(app.setSpeed(Number(b.dataset.speed))); refresh(); return; }
    const a = byId.get(b.dataset.action);
    if (!a) return;
    if (b.dataset.set != null) { const t = a.set(b.dataset.set); if (t) app.flash(t); refresh(); return; }
    app.runAction(a, b.dataset.k || a.keys[0] || '');
  });
  // a tap on a button must not leave it focused (Space would press it again, besides pausing)
  root.addEventListener('pointerup', (e) => { const b = e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) openPanel(open); });

  function setFolded(f) {
    folded = f;
    root.classList.toggle('folded', f);
    foldBtn.replaceChildren(icon(f ? 'unfold' : 'fold'));
    foldBtn.title = f ? 'Show the controls' : 'Hide the controls';
    foldBtn.setAttribute('aria-label', foldBtn.title);
    if (f && open) openPanel(open);
    try { localStorage.setItem('moire-ui-folded', f ? '1' : '0'); } catch { /* private mode */ }
    layout();
  }

  // ---------- state ----------
  function refresh() {
    for (const b of root.querySelectorAll('[data-action]')) {
      const a = byId.get(b.dataset.action);
      if (!a) continue;
      if (b.dataset.set != null) { b.setAttribute('aria-pressed', String(a.get() === b.dataset.set)); continue; }
      if (b.dataset.k) continue;
      if (a.type === 'toggle' || a.type === 'tool') {
        const on = !!a.get();
        if (b.getAttribute('role') === 'switch') b.setAttribute('aria-checked', String(on));
        else b.setAttribute('aria-pressed', String(on));
        if (a.id === 'pause') { const want = on ? 'play' : 'pause'; if (b.dataset.icon !== want) { b.dataset.icon = want; b.replaceChildren(icon(want)); } }
      } else if (a.type === 'cycle') {
        const v = b.querySelector('.val');
        if (v) v.textContent = a.get();
      }
    }
    for (const v of root.querySelectorAll('[data-value]')) v.textContent = byId.get(v.dataset.value).get();
    for (const b of bar.querySelectorAll('[data-panel]')) b.setAttribute('aria-pressed', String(open === b.dataset.panel));
    const si = app.speedIndex();
    for (const b of root.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === si));
    speedBtn.querySelector('.set').textContent = app.speedLabel();
    speedBtn.querySelector('.got').textContent = app.speedReached();
    for (const s of sliders) {
      if (!s.inp.isConnected) continue;
      if (document.activeElement !== s.inp) s.inp.value = String(s.get());
      s.val.textContent = s.show(Number(s.inp.value));
      s.inp.disabled = app.light.params.mode !== 'spot';
    }
  }

  // the hint line sits just above the column (bar + open panel), whatever its height
  function layout() {
    const st = document.documentElement.style;
    st.setProperty('--ui-h', `${root.offsetHeight}px`);
    st.setProperty('--bar-w', `${bar.offsetWidth}px`);
  }
  if (window.ResizeObserver) new ResizeObserver(layout).observe(root);
  layout();

  let startFolded = app.startFolded;
  if (startFolded == null) { try { startFolded = localStorage.getItem('moire-ui-folded') === '1'; } catch { startFolded = false; } }
  setFolded(!!startFolded);
  refresh();
  setInterval(refresh, 400);
  hint.classList.add('above-ui');
  return { refresh, openPanel };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
