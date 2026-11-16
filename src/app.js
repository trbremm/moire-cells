// App: the parts of the page around the simulation that make it easier to explore (user 2026-11-16: "if we could zoom, and
// have panels with zoos of cells and molecules and tools to add cells. And to create new cultures with more spread and some
// preset interesting dish environments"). Nothing here changes a rule of the simulation.
//
//   zoom and pan     the view camera (src/camera.js): the +, - and fit buttons at the right edge, the zoom shown under them;
//                    Ctrl+wheel, the wheel without a spotlight, middle-drag, Space + drag and two fingers are in src/main.js
//   scale bar        bottom right, a crisp line of a round length in micrometres at the toy's scale (a cell about 10 um
//                    across: R = 5 um), following the zoom
//
// createApp(ctx) is called by main.js before the toolbar is built (it hands the toolbar its extra panels), attach(ui) after.

import { camera, MAX_ZOOM } from './camera.js';

const NS = 'http://www.w3.org/2000/svg';
const UM_PER_R = 5;   // the scale bar's toy scale: a cell's radius is 5 micrometres (a cell about 10 um across)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgIcon(inner) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}
const ZOOM_ICONS = {
  in: '<path d="M10 4v12M4 10h12"/>',
  out: '<path d="M4 10h12"/>',
  fit: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/>',
};

/** ctx: { app (main.js's view of the page), params, flag, flash, cells, matter, light, background, control, view (getter), touch } */
export function createApp(ctx) {
  const A = { ctx, ui: null };

  // ---------- zoom buttons ----------
  const box = el('div', 'zoombox');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Zoom');
  const btn = (name, title, run) => {
    const b = el('button', 'btn');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.append(svgIcon(ZOOM_ICONS[name]));
    b.addEventListener('click', () => { run(); setTimeout(() => b.blur(), 0); });
    box.append(b);
    return b;
  };
  const centre = () => [camera.W / 2 * 1, camera.H / 2 * 1];   // the screen's centre (CSS px)
  btn('in', 'Zoom in (Ctrl+wheel; the wheel too while the spotlight is off; two fingers)', () => camera.zoomAt(...centre(), 1.5));
  btn('out', 'Zoom out', () => camera.zoomAt(...centre(), 1 / 1.5));
  btn('fit', 'The whole dish', () => camera.fit());
  const zlabel = el('span', 'zval', '');
  box.append(zlabel);
  document.body.append(box);

  // ---------- scale bar ----------
  const bar = el('div', 'scalebar');
  const line = el('span', 'sline');
  const label = el('span', 'slabel', '');
  bar.append(label, line);
  bar.title = 'Scale bar (a toy scale: a cell is about 10 µm across)';
  document.body.append(bar);

  let lastKey = '';
  function update() {
    const R = ctx.cells.R || 5;
    const pxPerUm = camera.z * R / UM_PER_R;   // screen CSS px per micrometre
    let best = 1;
    for (const L of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) if (L * pxPerUm <= 130) best = L;
    const w = best * pxPerUm;
    const key = `${best}|${w.toFixed(1)}|${camera.z.toFixed(2)}`;
    if (key === lastKey) return;
    lastKey = key;
    line.style.width = `${w.toFixed(1)}px`;
    label.textContent = best >= 1000 ? `${best / 1000} mm` : `${best} µm`;
    zlabel.textContent = camera.z > 1.001 ? `×${camera.z < 9.95 ? camera.z.toFixed(1) : camera.z.toFixed(0)}` : '';
    box.classList.toggle('zoomed', camera.z > 1.001);
    for (const b of box.querySelectorAll('button')) b.disabled = false;
    box.children[0].disabled = camera.z >= MAX_ZOOM - 1e-6;
    box.children[1].disabled = camera.z <= 1 + 1e-6;
  }
  camera.listeners.push(update);
  setInterval(update, 500);   // (R changes with a new culture, a resize)
  update();

  // ---------- the toolbar's extra panels and the dish pointer hooks (filled by the next steps) ----------
  A.panels = [];
  A.dishExtra = null;
  A.attach = (ui) => { A.ui = ui; };
  /** A tap or press on the dish with the left button / one finger, dish coordinates; true = taken by an app tool. */
  A.dishDown = () => false;
  A.dishMove = () => false;
  A.dishUp = () => false;
  A.cancel = () => {};
  return A;
}
