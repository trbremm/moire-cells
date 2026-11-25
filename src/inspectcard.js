// Step I1, the CELL INSPECTOR's CARD (src/inspect.js holds the data): a crisp panel at the side of the dish, away from the chosen cell, that
// answers "what are you?" in plain words, updated live (four times a second). Its buttons: FOLLOW (the camera keeps the cell in view),
// FAMILY (light up its living descendants, mother and sisters; everyone else dims), close. On a phone it sits at the top or the bottom
// (away from the cell), scrolls, and closes with its button; on a desktop also with Escape.

import { pal } from './palette.js';
import { JOBS, jobOf, jobInk } from './jobs.js';
import { enginesOf, drawPortrait } from './zoo.js';
import { ELECTRONS, SUBSTANCES } from './matter.js';
import { CARBON } from './carbon.js';
import { camera } from './camera.js';
import { HOW, CAUSE } from './inspect.js';

const TAU = 2 * Math.PI;
const KIND_WORD = ELECTRONS ? ['harvests', 'ferments', 'breathes', 'chains'] : ['harvests', 'burns', 'swaps', 'chains'];
const BAND_WORD = ['battery', 'visible 1', 'visible 2', 'hard'];
const MARK_P = [-2.1202635, -0.6931472];   // (cell_common.wgsl MARK_PLO, MARK_PHI)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${a})`;
const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)} %`;
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '–' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(d));
function age(s) {
  if (!(s >= 0)) return '–';
  if (s < 60) return `${s.toFixed(0)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}
const ICON = {
  follow: '<circle cx="10" cy="10" r="6.2"/><circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M10 1.8v3M10 15.2v3M1.8 10h3M15.2 10h3"/>',
  family: '<circle cx="10" cy="4.4" r="2"/><circle cx="4.6" cy="15" r="2"/><circle cx="10" cy="15" r="2"/><circle cx="15.4" cy="15" r="2"/><path d="M10 6.4v3.4M4.6 13v-3.2h10.8V13M10 9.8V13"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
};
const svg = (n) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[n]}</svg>`;

/** The marker's hue as the lineage view draws it (cell_draw.wgsl marker_colour), 0..255 rgb. */
function markerInk(g) {
  const h = (g[76] || 0) / TAU, sat = Math.max(0, Math.min(1, g[79] ?? 1));
  const v = 0.8 + 0.35 * Math.max(0, Math.min(1, ((g[77] || 0) - MARK_P[0]) / (MARK_P[1] - MARK_P[0])));
  return [0, -1 / 3, 1 / 3].map((o) => Math.max(0, 0.55 + 0.45 * Math.max(0.6, sat) * Math.cos(TAU * (h + o))) * v * 255);
}

export function createInspectCard(ctx) {
  const I = ctx.cells.inspect;
  if (!I || !I.on) return null;
  const card = document.createElement('section');
  card.className = 'icard';
  card.id = 'icard';
  card.hidden = true;
  card.setAttribute('aria-label', 'Cell inspector');
  card.innerHTML = `<div class="ic-head"><span class="ic-dot"></span><b class="ic-job"></b><span class="ic-id"></span>
    <span class="ic-btns"><button type="button" class="ic-b" data-k="follow" title="Follow: the view keeps this cell in sight">${svg('follow')}<span>follow</span></button>
    <button type="button" class="ic-b" data-k="family" title="Family: light up its living descendants (gold), its mother (cyan) and sisters (violet)">${svg('family')}<span>family</span></button>
    <button type="button" class="ic-b ic-x" data-k="close" title="Close (Escape)">${svg('close')}</button></span></div>
    <div class="ic-top"><canvas class="ic-pic" width="168" height="168"></canvas><div class="ic-facts"></div></div><div class="ic-body"></div>`;
  document.body.append(card);
  const $ = (s) => card.querySelector(s);
  const pic = $('.ic-pic'), facts = $('.ic-facts'), body = $('.ic-body'), jobEl = $('.ic-job'), dot = $('.ic-dot'), idEl = $('.ic-id');
  const bFollow = card.querySelector('[data-k="follow"]'), bFam = card.querySelector('[data-k="family"]');
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'close') I.close();
    else if (k === 'follow') { const on = I.follow(); if (on && I.data) I.centreOn(I.data.cell[0], I.data.cell[1], Math.max(camera.z, 3)); }   // (following zooms in to x3 at least)
    else if (k === 'family') I.family();
    setTimeout(() => b.blur(), 0);
  });
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden && !(e.target && e.target.closest && e.target.closest('input, textarea, select'))) I.close();
  });

  // ---------- where the card sits: away from the cell ----------
  let side = 'right', lastSel = null;
  const narrow = () => window.innerWidth < 640;
  function place() {
    const S = I.sel;
    if (!S) return;
    const cv = document.querySelector('canvas');
    const r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
    const p = S.pos || (I.data ? [I.data.cell[0], I.data.cell[1]] : [camera.W / 2, camera.H / 2]);
    const [sx, sy] = camera.toScreen(p[0], p[1]);
    const x = r.left + sx, y = r.top + sy;
    side = narrow() ? (y < window.innerHeight * 0.5 ? 'bottom' : 'top') : (x > window.innerWidth * 0.5 ? 'left' : 'right');
    card.dataset.side = side;
  }
  /** FOLLOW's aim: the cell at the middle of the screen part the card leaves free (screen CSS px from the canvas's centre). */
  I.viewOffset = () => {
    if (card.hidden) return [0, 0];
    const w = card.offsetWidth, h = card.offsetHeight;
    if (side === 'right') return [-(w + 16) / 2, 0];
    if (side === 'left') return [(w + 16) / 2, 0];
    if (side === 'bottom') return [0, -(h + 16) / 2];
    return [0, (h + 16) / 2];
  };

  // ---------- the text ----------
  function render() {
    const S = I.sel;
    if (!S) { card.hidden = true; document.body.classList.remove('inspect-open'); lastSel = null; return; }
    if (S !== lastSel) { lastSel = S; place(); }
    card.hidden = false;
    document.body.classList.add('inspect-open');
    bFollow.setAttribute('aria-pressed', String(!!I.following));
    bFam.setAttribute('aria-pressed', String(!!I.showFamily));
    bFollow.disabled = !!S.dead;
    const T = I.tree, D = I.data, F = I.famInfo, P = pal();
    idEl.textContent = S.id ? `#${S.id}` : '';
    if (!D) {
      jobEl.textContent = 'reading…';
      if (S.dead) jobEl.textContent = 'gone';
      return;
    }
    const g = D.bio, c = D.cell, cu = D.cu, R = ctx.cells.R || 9;
    const J = jobOf(g, 0), ink = jobInk(P, J);
    const strength = J.job === 0 ? '' : J.strength > 0.6 ? '' : J.strength > 0.3 ? ' (leaning)' : ' (faint)';
    jobEl.textContent = `${JOBS[J.job].label}${strength}`;
    jobEl.style.color = rgb(ink);
    dot.style.background = rgb(ink); dot.style.boxShadow = `0 0 8px ${rgb(ink, 0.8)}`;
    jobEl.title = JOBS[J.job].help;
    card.style.setProperty('--ic-ink', rgb(ink, 0.55));
    // the portrait (the zoo's drawing of this cell)
    try { const cx = pic.getContext('2d'); drawPortrait(cx, pic.width, c, g, 0, P, R); } catch (e) { /* no portrait */ }
    const now = D.time, id = S.id, born = T.known(id) ? T.born[id] : null;
    const gen = Math.round(g[10] || 0), line = Math.round(g[7] || 0), mk = markerInk(g);
    const bat = c[16], rt = D.rates;
    const bm = (ctx.cells.eat && ctx.cells.eat.params.batMax) || 4;
    const flow = rt ? `${rt.net >= 0 ? '+' : '−'}${num(Math.abs(rt.net))}/s` : '';
    let dead = '';
    if (S.dead) {
      const t = T.known(id) ? T.died[id] : NaN, cause = T.known(id) && !Number.isNaN(t) ? T.cause[id] : -1, k = T.killer[id];
      const why = cause < 0 ? 'gone' : cause === 1 ? `eaten${k ? ` by #${k}` : ''}` : CAUSE[cause] === 'old age' ? 'old age (the background death rate, higher among strangers)' : CAUSE[cause] === 'heat' ? 'too hot (heat damage)' : CAUSE[cause] === 'turnover' ? 'turnover (its slot went to a neighbour\'s daughter)' : CAUSE[cause];
      dead = `<p class="ic-dead">DIED${Number.isFinite(t) ? ` ${age(I.time - t)} ago` : ''}: ${esc(why)}${Number.isFinite(t) && born != null ? ` · lived ${age(t - born)}` : ''}</p>`;
    }
    facts.innerHTML = `${dead}<div class="ic-r"><span>age</span><b>${born != null ? age((S.dead && T.known(id) && Number.isFinite(T.died[id]) ? T.died[id] : now) - born) : '–'}</b>${born != null && T.how[id] === 0 && born <= (T.since || 0) + 0.01 ? '<i> (since the start)</i>' : ''}</div>
      <div class="ic-r"><span>generation</span><b>${gen}</b><i> divisions in its line</i></div>
      <div class="ic-r"><span>line</span><b>${line}</b><i class="ic-sw" style="background:${rgb(mk)};box-shadow:0 0 6px ${rgb(mk, 0.7)}" title="its self marker's hue, as the lineage view (marker) colours it"></i></div>
      <div class="ic-r"><span>battery</span><b>${pct(bat)}</b><span class="ic-bar"><i style="width:${pct(bat).replace(' ', '')};background:${rgb(P.core)}"></i></span><i>${flow}</i></div>
      ${CARBON ? `<div class="ic-r"><span>body carbon</span><b>${pct(((cu[87] >>> 24) & 255) / 255)}</b><i> of what it needs to divide</i></div>` : ''}`;
    // ---------- family ----------
    const rows = [];
    if (T.known(id)) {
      const how = T.how[id], mom = T.mom[id];
      const momTxt = how === 0 ? (born <= (T.since || 0) + 0.01 ? 'a founder (here since the culture began)' : 'placed by hand or loaded')
        : `${how === 1 ? 'a daughter' : 'a turnover newborn'} of #${mom} (${T.alive(mom) ? 'alive' : T.known(mom) ? `died: ${CAUSE[T.cause[mom]]}` : 'unknown'})`;
      rows.push(`<div class="ic-r"><span>born</span><b>${esc(momTxt)}</b></div>`);
    }
    if (F) {
      rows.push(`<div class="ic-r"><span>daughters</span><b>${F.kids}</b><i>${F.kids ? ` · ${F.kidsAlive} alive` : ''}</i></div>`);
      rows.push(`<div class="ic-r"><span>descendants</span><b>${F.live} living</b><i>${F.all ? ` of ${F.all} born · ${F.deep} generation${F.deep === 1 ? '' : 's'} deep` : ''}</i></div>`);
      if (F.mom) rows.push(`<div class="ic-r"><span>sisters</span><b>${F.sisters}</b><i>${F.sisters ? ` · ${F.sistersAlive} alive` : ''}</i></div>`);
      if (I.showFamily) {
        const dp = Object.entries(F.depths || {}).sort((a, b) => a[0] - b[0]).slice(0, 8).map(([k, v]) => `${v}`).join(' · ');
        rows.push(`<p class="ic-key"><i class="k1"></i>daughters <i class="k2"></i>deeper <i class="k3"></i>mother <i class="k4"></i>sisters${dp ? `<br>living by generation: ${esc(dp)}` : ''}</p>`);
      }
    }
    if (T.lost) rows.push('<p class="ic-note">some births were missed (the log ran over): the family may be short</p>');
    // ---------- what it does ----------
    const life = [];
    const s0 = cu[86] >>> 0, s1 = cu[87] >>> 0, b8 = (w, k) => ((w >>> (8 * k)) & 255) / 255;
    life.push(`<div class="ic-r"><span>light on it</span><b>${pct(b8(s0, 0))}</b><i> · oxygen inside ${pct(b8(s0, 1))} · fuel ${pct(b8(s0, 2))}</i></div>`);
    life.push(`<div class="ic-r"><span>heat</span><b>${pct(b8(s1, 1) * 2)}</b><i> of its tolerance · trace ${pct(b8(s1, 0))}</i></div>`);
    const eng = enginesOf(g, 0), ER = rt ? rt.eng : null;
    const engRows = eng.map(({ e, band, rate, k, copy }) => {
      const r = ER ? ER[k] : null, runs = r != null && r > 1e-4;
      const kind = e.kind === 0 && band > 0 ? `${BAND_WORD[band]} pigment drives` : e.kind === 0 ? 'stores (battery-paid)' : KIND_WORD[e.kind] || '';
      const glyph = e.kind === 0 && band > 0 ? rgb(P.band[band] || P.band[1]) : e.kind === 1 ? rgb(P.burn) : e.kind === 2 ? rgb(P.swap) : rgb(P.sed);
      const nm = e.short ? `${e.short}` : e.name;
      return `<div class="ic-e${runs ? ' on' : ''}"><i style="background:${glyph}" class="${e.kind === 0 || e.kind === 2 ? 'tri' : 'sq'}"></i><span>${esc(kind)} ${esc(nm)}${copy ? ' (a copy)' : ''}</span><b>${r == null ? '…' : runs ? `ran ${num(r)}/s` : 'carried, idle'}</b></div>`;
    });
    if (!engRows.length) engRows.push('<p class="ic-note">no engine</p>');
    if (rt) engRows.push(`<p class="ic-note">engines put ${num(rt.gain)}/s into the battery, uphill ones took ${num(rt.paid)}/s; the battery ${rt.net >= 0 ? 'gains' : 'loses'} ${num(Math.abs(rt.net))}/s in all (capacity ${bm})</p>`);
    // ---------- body ----------
    let nb = 0;
    for (let w = 0; w < 3; w++) { const v = cu[60 + w] >>> 0; if ((v & 0xffff) !== 0xffff) nb++; if ((v >>> 16) !== 0xffff) nb++; }
    const jn = (cu[8] >>> 8) & 63, junc = [0, 1, 2, 3, 4, 5].filter((k) => (jn >> k) & 1).length;
    let integ = 0;
    for (let k = 0; k < 6; k++) integ += c[48 + k] / 6;
    const e = Math.hypot(c[6], c[7]), asp = Math.exp(2 * e), osm = c[84] || 0;
    const bodyRows = [`<div class="ic-r"><span>size</span><b>${num(c[4] / R)} R</b><i> · ${asp > 1.25 ? `${asp.toFixed(1)}:1 long` : 'round'}${Math.abs(osm) > 0.1 ? ` · ${osm > 0 ? 'swollen' : 'shrunk'} ${pct(Math.abs(osm))}` : ''}</i></div>`,
      `<div class="ic-r"><span>touching</span><b>${nb} of 6 sides</b><i> · ${junc} junction${junc === 1 ? '' : 's'} (glued)</i></div>`,
      `<div class="ic-r"><span>membrane</span><b>${pct(integ)}</b><i> whole${(cu[9] & 0x40000) ? '' : ' (never closed yet)'}</i></div>`];
    // ---------- state ----------
    const st = [];
    const burst = (cu[9] >>> 4) & 15;
    if (burst) st.push('bursting');
    if ((g[24] || 0) > 0) st.push(`starving ${num(g[24], 0)} s`);
    const mode = cu[88] & 3, by = cu[89] >>> 24;
    if (mode === 1) st.push('wrapping a prey');
    if (mode === 2) st.push('digesting a meal');
    if (by === 1) st.push('being engulfed!');
    if ((g[219] || 0) > 0.5) st.push('in its stress fold');
    const dv = ctx.cells.division && ctx.cells.division.params;
    if (dv && bat >= dv.divAt && (!CARBON || ((cu[87] >>> 24) & 255) >= 253)) st.push('ready to divide');
    // ---------- genes of note ----------
    const genes = [];
    const gene = (label, v, d = 2, always = false, unit = '') => { if (always || Math.abs(v || 0) > 1e-3) genes.push(`<span><i>${label}</i> ${num(v || 0, d)}${unit}</span>`); };
    gene('glue', g[16], 2, true); gene('crawl', g[18], 2, true); gene('heat tolerance', g[35], 0, true);
    gene('fidelity', g[31], 2, true); gene('engulf', g[82]); gene('kin sparing', g[83]);
    gene('elongation', Math.exp(g[13] || 0), 1, false); gene('flagellum', g[168]); gene('cilia', g[171]); gene('chemotaxis', g[175]);
    gene('tendril reach', g[240]); gene('contraction', g[185]); gene('signal release', g[227]);
    if (genes.length && Math.abs(Math.exp(g[13] || 0) - 1) < 1e-3) genes.splice(genes.findIndex((x) => x.includes('elongation')), 1);
    const meals = D.info[6] >>> 0;
    if (meals || (g[82] || 0) > 0.01) genes.push(`<span><i>meals</i> ${meals}</span>`);
    body.innerHTML = `${rows.length ? `<h4>family</h4>${rows.join('')}` : ''}
      <h4>where it lives</h4>${life.join('')}
      <h4>engines <em>ran (last s) vs only carried</em></h4>${engRows.join('')}
      <h4>body</h4>${bodyRows.join('')}${st.length ? `<p class="ic-state">${esc(st.join(' · '))}</p>` : ''}
      <h4>genes of note</h4><p class="ic-genes">${genes.join('')}</p>`;
  }
  I.listeners.push(() => render());
  I.render = render;
  return { card, render };
}
