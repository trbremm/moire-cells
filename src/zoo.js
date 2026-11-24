// App: the ZOOS, two toolbar panels (crisp, in the panels' style).
//
//   molecules  the periodic table (the atoms by row and group, with their ladders of levels when the electrons' table is on)
//              and every substance as a small picture in its dish colours, with plain lines: what it is, its energy, the
//              light it absorbs and the colour it glows, how much is in the dish and inside cells now; a pipette button per
//              substance (the add tools, src/app.js). Works with ?electrons=0 too (that table's numbers, no levels).
//   cells      the lineages living now: every live cell grouped by what its genes make it do (the engines it runs, with their
//              pigments, and its skin: soap, oily, crust wall), each group with a portrait (its median-battery cell, read back
//              from the GPU and drawn on a small canvas as in the dish), a count and a plain summary of its genes; an add
//              button per group (clone that cell's genome with the add-cell tool) and per founder habit. Refreshed every
//              3 s while the panel is open, from a ring of two staging buffers (mapAsync: the frame never waits).

import { SUBSTANCES, ATOMS, ELECTRONS, ALL_ENGINES as ENGINES, ENGINE_KINDS, atomLevels, CH, describe, makingBand } from './matter.js';   // (step C15b: + carbon engines)
import { BANDS } from './light.js';
import { pal } from './palette.js';
import { BIO_FLOATS, BIO_G2, strategyOf, founderGenome, HABITS, predatorGenome } from './genome.js';
import { DUP_STATE } from './dup.js';
import { DESIGNS, DESIGN_NAMES, designGenome } from './tissues.js';
import { CELL_FLOATS } from './cells.js';
import { CARBON, CB_LIP, CB_ENZANY, LADDER, carbonTable, describeCarbon } from './carbon.js';   // step C15a: the builder c, its ladder, tar
import { JOBS, jobOf, jobInk } from './jobs.js';   // step F0: colour by job
import { drawGenome, latticesOf } from './folding.js';   // step G3: the genome view

const NS = 'http://www.w3.org/2000/svg';
const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c.map((v) => Math.round(v)).join(',')})` : `rgba(${c.map((v) => Math.round(v)).join(',')},${a})`);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtN = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} M` : x >= 1e4 ? `${(x / 1e3).toFixed(0)} k` : x >= 1000 ? `${(x / 1e3).toFixed(1)} k` : x >= 10 ? x.toFixed(0) : x >= 0.05 ? x.toFixed(1) : x > 0 ? '<0.1' : '0');
const fmtE = (e) => (e === 0 ? '0' : (e > 0 ? '+' : '−') + Math.abs(e).toFixed(Math.abs(e) * 16 % 4 === 0 ? 2 : 3).replace(/0+$/, '').replace(/\.$/, ''));

/** A substance's ink in the palette in use (as the dish draws it: by function, lighter row 1, deeper row 2). */
export function inkOf(s, P = pal()) {
  const I = P.substances[s.func] || P.substances.linker;
  return I.light.map((v, j) => v + (I.heavy[j] - v) * s.heavy);
}
const BAND_WORD = ['warm', 'visible 1', 'visible 2', 'hard'];
const BAND_COLOUR = ['orange', 'gold', 'sky blue', 'violet'];

// ---------- the molecules ----------
const ROLE = {
  g: 'free light giver: holds one spare electron, gives it to a taker',
  G: 'free heavy giver (metal-like): gives its spare electron most easily',
  t: 'free light taker (oxygen-like): grabs electrons hardest; burns fuel, bites membranes',
  T: 'free heavy taker: grabs electrons, less hard than t',
  l: 'free light linker: chains with linkers (crust, oil, membranes)',
  L: 'free heavy linker: chains with linkers (crust, oil, membranes)',
  trace: 'trace: rare and inert; lowers the spark of reactions where it sits (a catalyst, a vitamin in cells)',
};
const ROLE_OLD = {
  g: 'free light giver (row 1); bonds with a taker into fuel when light pays for it',
  G: 'free heavy giver (row 2)',
  t: 'free light taker (row 1): a reactive "vandal" that swaps into rich fuel',
  T: 'free heavy taker (row 2)',
  l: ROLE.l, L: ROLE.L, trace: ROLE.trace,
};
function whatIs(s) {
  if (s.kind === 'atom' || s.kind === 'trace') return (ELECTRONS ? ROLE : ROLE_OLD)[s.name] || describe(s);
  if (s.excited) return describe(s);
  if (s.kind === 'fuel' && s.mineral) return s.name === 'gt' ? 'mineral, water-like: its electron sits deep; settled' : 'mineral, rust-like: the most settled compound';
  if (s.kind === 'fuel') return ELECTRONS ? 'fuel: its electron still sits high, so a free taker (oxygen) taking it releases energy'
    : 'fuel: a giver and a taker bonded by light; burning it gives the energy back';
  if (s.kind === 'sediment') return `crust: a ${s.atoms[0] === 'l' ? 'light' : 'heavy'} linker chain that packs solid; it does not move (cells graze it)`;
  if (s.kind === 'oil') return 'oil: a mixed linker chain, water-shy: gathers into droplets and films';
  if (s.kind === 'amphiphile') return `soap: a ${s.charge > 0 ? 'plus (giver)' : 'minus (taker)'} head on an oily tail: lines oil-water boundaries, cells' bilayer`;
  return describe(s);
}
function lightLine(s) {
  if (!ELECTRONS) {
    if (s.kind === 'fuel') { const b = makingBand(s); return b >= 0 ? `made by ${BAND_WORD[b]} light` : 'not made by light'; }
    if (s.kind === 'sediment') return 'warms in light (dark); hard light cracks it';
    return '';
  }
  const parts = [];
  const vis = s.bands.filter((b) => b >= 1);
  if (s.bands.includes(0)) parts.push('warms in warm light');
  if (vis.length) parts.push(`absorbs ${vis.map((b) => BAND_WORD[b]).join(', ')} → glows ${[...new Set(vis.map((b) => BAND_COLOUR[b - 1]))].join(', ')}`);
  if (!s.bands.length) parts.push('takes no light');
  return parts.join(' · ');
}

/** A small picture of a substance: its atoms in chain order, in its dish colour (+ / − on givers and takers). */
function picture(s, P) {
  const ink = inkOf(s, P);
  const n = s.atoms.length, step = 13, w = 14 + step * (n - 1) + 8, h = 26;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
  svg.classList.add('mol');
  Object.assign(svg.style, { width: `${w}px`, height: `${h}px`, stroke: 'none' });   // (not the toolbar icons' 20 px)
  let inner = '';
  s.atoms.forEach((a, k) => {
    const A = ATOMS[a] || { row: 1, group: 'inert' };
    const x = 11 + k * step, r = A.group === 'inert' ? 3.4 : A.row >= 2 ? 5.6 : 4.4;
    if (k > 0) inner += `<path d="M${x - step + 4} 13H${x - 4}" stroke="${rgb(ink, 0.7)}" stroke-width="1.4"/>`;
    if (A.group === 'inert') inner += `<path d="M${x} ${13 - r}l${r} ${r}-${r} ${r}-${r}-${r}z" fill="${rgb(ink)}"/>`;
    else inner += `<circle cx="${x}" cy="13" r="${r}" fill="${rgb(ink, s.kind === 'sediment' ? 0.55 : 0.9)}" stroke="${rgb(ink)}" stroke-width="0.8"/>`;
    const q = A.group === 'giver' ? '+' : A.group === 'taker' ? '−' : '';
    if (q) inner += `<text x="${x}" y="16.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="#04060a">${q}</text>`;
  });
  svg.innerHTML = inner;
  svg.style.filter = `drop-shadow(0 0 2px ${rgb(ink, 0.65)})`;
  return svg;
}

/** The ladder of an atom's levels (electrons' table): shells as short lines, the valence one bright, the empty one dashed. */
function ladder(a, ink, levels = null) {
  const L = levels || atomLevels(a);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 34 40');
  svg.setAttribute('width', '34'); svg.setAttribute('height', '40');
  Object.assign(svg.style, { width: '34px', height: '40px' });
  if (!L.length) { svg.innerHTML = `<text x="17" y="24" text-anchor="middle" font-size="8" fill="${rgb(ink, 0.7)}">closed</text>`; return svg; }
  const y = (e) => 36 - (e + 5.5) / 5.5 * 32;   // 0 at the top, -5.5 at the bottom
  let inner = `<path d="M3 ${y(0)}H31" stroke="rgba(217,221,230,0.15)" stroke-width="0.6"/>`;
  L.forEach((e, k) => {
    const valence = k === a.row - 1, empty = k === a.row;
    inner += `<path d="M7 ${y(e).toFixed(1)}H27" stroke="${valence ? rgb(ink) : empty ? rgb(ink, 0.55) : rgb(ink, 0.35)}" stroke-width="${valence ? 1.8 : 1}"${empty ? ' stroke-dasharray="2 1.5"' : ''}/>`;
  });
  svg.innerHTML = inner;
  return svg;
}

export function moleculePanel(ctx, onPipette) {
  const P0 = { rows: [] };
  return {
    id: 'molecules',
    title: 'Molecules: the periodic table and every substance, what it is, its energy and light, how much is here',
    icon: '<circle cx="5" cy="13" r="2.6"/><circle cx="15" cy="13" r="2.6"/><circle cx="10" cy="5.2" r="2.6"/><path d="M7.4 13h5.2M6.3 10.8l2.4-3.6M13.7 10.8l-2.4-3.6"/>',
    build(body) {
      const P = pal();
      P0.rows = [];
      body.append(el('p', 'note zfirst', ELECTRONS
        ? 'Six atoms, set only by ROW (size: each row adds a shell) and GROUP (giver, linker, taker). Energies count down from all atoms free (0): lower is more settled. Light is caught only where a photon matches a gap between levels.'
        : 'The step C4 table (?electrons=0): energies count up from the free atoms (0); light makes fuel, burning gives it back.'));
      // the periodic table
      body.append(el('h3', '', 'Periodic table'));
      const tbl = el('div', CARBON ? 'ptable p4' : 'ptable');
      const COLS = CARBON ? ['giver', 'builder', 'linker', 'taker'] : ['giver', 'linker', 'taker'];
      tbl.append(el('span', 'ph', ''), el('span', 'ph', 'giver +'), ...(CARBON ? [el('span', 'ph', 'builder')] : []), el('span', 'ph', 'linker'), el('span', 'ph', 'taker −'));
      for (const row of [1, 2]) {
        tbl.append(el('span', 'ph prow', `row ${row}`));
        for (const group of COLS) {
          if (group === 'builder') {   // step C15a: the builder c (row 1 only; never free: no pipette)
            if (row !== 1) { tbl.append(el('span', 'ph', '')); continue; }
            const T = carbonTable(), ink = (P.substances.carbon || { light: [150, 230, 150] }).light;
            const cell = el('div', 'pcell');
            cell.title = 'the builder c: four hands, each holding a giver, a taker or another carbon; never free. Grip between the giver and the linker';
            const sym = el('b', '', 'c');
            sym.style.color = rgb(ink); sym.style.textShadow = `0 0 6px ${rgb(ink, 0.6)}`;
            cell.append(sym, ladder({ row: 1 }, ink, T.levels), el('small', '', `4 hands · ${-T.grip}`));
            tbl.append(cell);
            continue;
          }
          const name = Object.keys(ATOMS).find((k) => ATOMS[k].row === row && ATOMS[k].group === group && !ATOMS[k].ground);
          const s = SUBSTANCES[CH[name]], ink = inkOf(s, P), A = ATOMS[name];
          const cell = el('button', 'pcell');
          cell.type = 'button';
          cell.title = `${whatIs(s)} · tap: the pipette with ${name}`;
          cell.dataset.pip = String(CH[name]);
          const sym = el('b', '', name);
          sym.style.color = rgb(ink);
          sym.style.textShadow = `0 0 6px ${rgb(ink, 0.6)}`;
          cell.append(sym);
          if (ELECTRONS) {
            cell.append(ladder(A, ink));
            const grip = -atomLevels(A)[A.row - 1];
            cell.append(el('small', '', group === 'linker' ? `shares ${grip}` : group === 'giver' ? `holds ${grip}` : `pulls ${grip}`));
          } else cell.append(el('small', '', `spreads ${s.spread.toFixed(2)}`));
          tbl.append(cell);
        }
      }
      tbl.append(el('span', 'ph prow', 'row 3'));
      {
        const s = SUBSTANCES[CH.trace], ink = inkOf(s, P);
        const cell = el('button', 'pcell ptrace');
        cell.type = 'button'; cell.title = `${whatIs(s)} · tap: the pipette with trace`; cell.dataset.pip = String(CH.trace);
        const sym = el('b', '', 'trace'); sym.style.color = rgb(ink); cell.append(sym, el('small', '', 'inert, closed shell'));
        tbl.append(cell);
      }
      body.append(tbl);
      if (ELECTRONS) body.append(el('p', 'note', 'Each ladder: the atom\'s shells (top = free). Bright: the valence level that bonds (its GRIP); dashed: the empty shell light can lift an electron into. Givers hold their spare electron loosely, takers pull hard.'));
      // the substances, by kind
      const groups = ELECTRONS
        ? [['Free atoms', (s) => s.kind === 'atom'], ['Minerals (settled)', (s) => s.mineral], ['Fuels', (s) => s.kind === 'fuel' && !s.mineral],
          ['Crust', (s) => s.kind === 'sediment'], ['Oil and soap', (s) => s.kind === 'oil' || s.kind === 'amphiphile'], ['Trace', (s) => s.kind === 'trace']]
        : [['Free atoms', (s) => s.kind === 'atom' && !s.excited], ['Fuels', (s) => s.kind === 'fuel'], ['Crust', (s) => s.kind === 'sediment'],
          ['Oil and soap', (s) => s.kind === 'oil' || s.kind === 'amphiphile'], ['Trace', (s) => s.kind === 'trace'], ['Excited (step C12c)', (s) => s.excited]];
      for (const [title, test] of groups) {
        const list = SUBSTANCES.map((s, c) => [s, c]).filter(([s]) => test(s));
        if (!list.length) continue;
        body.append(el('h3', '', title));
        for (const [s, c] of list) {
          const r = el('div', 'zrow');
          const pic = el('div', 'zpic');
          pic.append(picture(s, P));
          const main = el('div', 'zmain');
          const head = el('div', 'zhead');
          const nm = el('b', '', s.name);
          nm.style.color = rgb(inkOf(s, P));
          head.append(nm, el('span', 'zwhat', whatIs(s)));
          const nums = el('div', 'znums');
          const ll = lightLine(s);
          nums.textContent = `energy ${fmtE(s.energy)}${s.spark ? ` (spark ${s.spark})` : ''}${s.charge ? ` · charge ${s.charge > 0 ? '+' : '−'}${Math.abs(s.charge)}` : ''}${ll ? ` · ${ll}` : ''}`;
          const amt = el('div', 'zamt');
          main.append(head, nums, amt);
          r.append(pic, main);
          if (!s.excited) {
            const pip = el('button', 'act zpip', 'pipette');
            pip.type = 'button'; pip.dataset.pip = String(c);
            pip.title = `drop ${s.name} where you tap (booked as added, like a spring)`;
            r.append(pip);
          }
          body.append(r);
          P0.rows.push({ c, amt });
        }
      }
      if (CARBON) carbonRows(body, P, P0.rows);   // step C15a
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pip]');
        if (b) onPipette(b.dataset.pip.startsWith('c:') ? b.dataset.pip.slice(2) : Number(b.dataset.pip));
      });
      this.refresh(true);
    },
    refresh(force = false) {
      const M = ctx.matter, E = ctx.cells.eat;
      if (!force && P0.last && performance.now() - P0.last < 900) return;
      P0.last = performance.now();
      const inside = E && E.ledger ? E.ledger.stock : null;
      for (const { c, amt, carbon } of P0.rows) {
        if (carbon != null) {   // step C15a: a ladder molecule (0..4) or tar (5: its carbons, and its hands)
          const CD = M.carbon.dish, d = carbon < 5 ? CD[carbon] : (2 * CD[5] + CD[6] + CD[7]) / 4;
          const t = carbon < 5 ? `in the dish ${fmtN(d)}` : `in the dish ${fmtN(d)} carbons (backbone ${fmtN(CD[5])}, fuel hands ${fmtN(CD[6])}, burnt hands ${fmtN(CD[7])})`;
          if (amt.textContent !== t) amt.textContent = t;
          continue;
        }
        const d = M.dish ? M.dish[c] || 0 : 0, k = inside ? inside[c] || 0 : 0;
        const t = `in the dish ${fmtN(d)}${c < 13 || SUBSTANCES[c].excited ? ` · inside cells ${fmtN(k)}` : ''}`;
        if (amt.textContent !== t) amt.textContent = t;
      }
    },
  };
}

// ---------- step C15a: carbon ----------
/** A one-carbon molecule: the carbon in the middle, its four hands as stubs ending in + (a giver) or − (a taker). */
function carbonPicture(g, P, ink) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 34 26'); svg.setAttribute('width', '34'); svg.setAttribute('height', '26');
  svg.classList.add('mol');
  Object.assign(svg.style, { width: '34px', height: '26px', stroke: 'none' });
  const gi = inkOf({ func: 'reactive', heavy: 0 }, P), ti = (P.substances.mineral || P.substances.linker).light;
  let inner = '';
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy], k) => {
    const giver = k < g, x = 17 + 10 * dx, y = 13 + 8 * dy, hi = giver ? gi : ti;
    inner += `<path d="M17 13L${x} ${y}" stroke="${rgb(ink, 0.7)}" stroke-width="1.3"/>`;
    inner += `<circle cx="${x}" cy="${y}" r="3.4" fill="${rgb(hi, 0.85)}"/>`;
    inner += `<text x="${x}" y="${y + 2.6}" text-anchor="middle" font-size="7.5" font-weight="700" fill="#04060a">${giver ? '+' : '−'}</text>`;
  });
  inner += `<circle cx="17" cy="13" r="4.6" fill="${rgb(ink, 0.9)}" stroke="${rgb(ink)}" stroke-width="0.8"/>`;
  svg.innerHTML = inner;
  svg.style.filter = `drop-shadow(0 0 2px ${rgb(ink, 0.65)})`;
  return svg;
}
/** The molecules zoo's carbon: the ladder strip (fuel to exhaust), each with its energy and light, then tar. */
function carbonRows(body, P, rows) {
  const T = carbonTable(), I = P.substances.carbon || { light: [176, 236, 150], heavy: [128, 140, 156] }, Tr = P.substances.tar || { light: [150, 104, 56] };
  body.append(el('h3', '', 'Carbon: the ladder, fuel to exhaust (step C15a)'));
  body.append(el('p', 'note', `One carbon with four hands. Each step down the ladder a taker (oxygen-like t) takes a giver's place: it releases ${T.ox16 / 16}. ` +
    `Making fuel back from CO2-like carbon needs two photons per hand (water split, then the hand). Cells eat it (step C15b)` +
    (CB_LIP ? ' and build themselves from it (step C15c, below).' : '.')));
  T.ladder.forEach((s, j) => {
    const ink = I.light.map((v, k) => v + (I.heavy[k] - v) * (j / 4));
    const r = el('div', 'zrow');
    const pic = el('div', 'zpic');
    pic.append(carbonPicture(s.g, P, ink));
    const main = el('div', 'zmain');
    const head = el('div', 'zhead');
    const nm = el('b', '', s.name);
    nm.style.color = rgb(ink);
    head.append(nm, el('span', 'zwhat', describeCarbon(s.name)));
    const bands = s.bands.map((b) => (b === 1 ? 'visible 1 (warms, glows warm)' : b === 3 ? 'hard (sky blue glow; fixed back where g is)' : BAND_WORD[b]));
    const nums = el('div', 'znums', `energy ${fmtE(s.energy)} (spark ${T.spark}) · ${s.g ? `burnt fully with oxygen it releases ${s.g * (T.ox16 / 16 + 4.5)}` : 'fully burnt'} · absorbs ${bands.join(', ')}`);
    const amt = el('div', 'zamt');
    main.append(head, nums, amt);
    const pip = el('button', 'act zpip', 'pipette');
    pip.type = 'button'; pip.dataset.pip = `c:${s.name}`;
    pip.title = `drop ${s.name} where you tap (booked as added, like a spring)`;
    r.append(pic, main, pip);
    body.append(r);
    rows.push({ carbon: j, amt });
  });
  const r = el('div', 'zrow');
  const pic = el('div', 'zpic');
  const sw = el('div', '');
  Object.assign(sw.style, { width: '30px', height: '16px', margin: '5px 2px', background: rgb(Tr.light, 0.8), boxShadow: `inset 0 0 0 1px ${rgb(Tr.light)}` });
  pic.append(sw);
  const main = el('div', 'zmain');
  const head = el('div', 'zhead');
  const nm = el('b', '', 'tar');
  nm.style.color = rgb(Tr.light);
  head.append(nm, el('span', 'zwhat', describeCarbon('tar')));
  const nums = el('div', 'znums', `three numbers per place: backbone bonds c-c (${fmtE(-T.bonds.cc.rel)} each), fuel hands (${fmtE(-T.bonds.cg.rel)}), burnt hands (${fmtE(-T.bonds.ct.rel)}) · forms where fuel and burnt carbon meet (releases ${T.cond16 / 16} and a water) · warms in light`);
  const amt = el('div', 'zamt');
  main.append(head, nums, amt);
  r.append(pic, main);
  body.append(r);
  rows.push({ carbon: 5, amt });
  if (!CB_LIP) return;
  // step C15c: what the cells build from carbon, each part with the element its job needs (src/carboncells.js PART_RECIPES)
  body.append(el('h3', '', 'Carbon makes the cell: the parts (step C15c)'));
  body.append(el('p', 'note', 'Every part is carbon + the element its job needs, read from the electron table. Hands: g fuel, t burnt, c-c a backbone.'));
  for (const [nm, made, why] of [
    ['soap1 c2 g5 t', 'two ladder carbons condensed (+ a water)', 'the bilayer: a polar head carbon (one burnt hand) on an oily tail'],
    ['soap2 c2 g4 t2', 'the same', 'the bilayer, more polar; one bite of oxygen from spoiling into mud'],
    ['oil c2 g6', 'methane- + methanol-like condensed', "between the soap's tails: stiffens the membrane"],
    ['wall carbon', 'granules, sugar-unit-like carbon, or a pair that evens out', 'cellulose-like chains; cross-linked pairs are stiffer (brown)'],
    ['pigment c2 g6 + trace', 'an oil-like pair + a trace atom', 'its c-g bonds catch visible 1; trace at its heart, as magnesium'],
    ['glue cg2t2', 'sugar-unit-like carbon as it is', "sticky by its charged hands, as a biofilm's sugars"],
    ['enzyme 4 c + G', CB_ENZANY ? 'four burnt chain carbons (a frame of any carbon) + a heavy giver G' : 'four chain carbons + a heavy giver G', 'catalysis moves electrons: G holds the loosest one, as iron'],
  ]) {
    const row = el('div', 'zrow');
    const main = el('div', 'zmain');
    const head = el('div', 'zhead');
    const b = el('b', '', nm);
    b.style.color = rgb(Tr.light);
    head.append(b, el('span', 'zwhat', why));
    main.append(head, el('div', 'znums', `made from ${made}`));
    row.append(el('div', 'zpic'), main);
    body.append(row);
  }
}

// ---------- the cells ----------
const KIND_WORD = ELECTRONS ? { 0: 'harvest', 1: 'ferment', 2: 'breathe', 3: 'chain' } : { 0: 'harvest', 1: 'burn', 2: 'swap', 3: 'chain' };
const HABIT_NAME = { harvest: 'light harvesters', burn: ELECTRONS ? 'eaters' : 'burners', both: 'light + burn', other: 'others' };
const HABIT_FOUNDER = { burn: ELECTRONS ? 'eater' : 'burner', both: 'light + burn', pigments: 'photosynthesiser', other: 'chain maker / breather', carbon: 'carbon eater' };   // (step C15b: + carbon)

/** The active engine slots of genome g (at float o): [{ e (ENGINES entry), band, rate, k, copy }] (step G2: + the duplicate slots 3, 4 while the
 * copies act; copy = true for those). */
export function enginesOf(g, o = 0, copies = DUP_STATE.acts) {
  const out = [];
  for (let k = 0; k < (copies && g.length >= o + BIO_G2 + 4 ? 5 : 3); k++) {
    const rate = k < 3 ? g[o + 36 + k] : g[o + BIO_G2 + 2 + (k - 3)];
    if (!(rate > 0.1)) continue;
    const code = Math.round(k < 3 ? g[o + 32 + k] : g[o + BIO_G2 + (k - 3)]), e = ENGINES[Math.min(ENGINES.length - 1, code & 31)];
    out.push({ e, band: code >> 5, rate, k, copy: k >= 3 });
  }
  return out;
}

/** A genome's habits in plain words. */
export function summary(g, o = 0, lipidsOn = true) {
  const parts = [];
  for (const { e, band, rate, copy } of enginesOf(g, o)) {
    const speed = rate > 2 ? 'fast' : rate < 0.6 ? 'slowly' : '';
    const cp = copy ? ' (a duplicate)' : '';   // step G2
    if (e.kind === 0) parts.push(band > 0 ? `${BAND_WORD[band]} pigment drives ${e.name}${cp}` : `stores energy as ${e.name} (battery-paid)${cp}`);
    else parts.push(`${KIND_WORD[e.kind]}s ${e.name}${speed ? ` ${speed}` : ''}${cp}`);
  }
  if (!parts.length) parts.push('no running engine');
  const skin = [];
  if (lipidsOn) {
    const oil = g[o + 40], wall = g[o + 52], head = g[o + 53], row = g[o + 54];
    skin.push(oil > 0.45 ? 'oily bilayer (stiff)' : oil > 0.15 ? 'soap skin with some oil' : 'soap skin (soft)');
    if (Math.abs(head) > 0.3) skin.push(`${head > 0 ? 'plus' : 'minus'} heads`);
    if (wall > 0.3) skin.push(`${row > 0.5 ? 'heavy' : 'light'} crust wall`);
  } else {
    const mix = g[o + 40];
    skin.push(`${mix > 0.5 ? 'heavy' : 'light'} linker membrane`);
  }
  const pumps = [];
  for (let k = 0; k < 2; k++) {
    const rate = g[o + 46 + k];
    if (!(rate > 0.05)) continue;
    const code = Math.round(g[o + 44 + k]), ch = code & 15, out = (code >> 4) & 1;
    if (SUBSTANCES[ch]) pumps.push(`pumps ${SUBSTANCES[ch].name} ${out ? 'out' : 'in'}`);
  }
  const body = [`tolerates heat ${g[o + 35].toFixed(0)}`];
  if (g[o + 16] > 1.5) body.push('glued fast'); else if (g[o + 16] > 0.7) body.push('sticky'); else if (g[o + 16] < 0.25) body.push('loose');   // (step G0: up to 4)
  if (g[o + 18] > 1.4) body.push('crawls fast');
  if (g[o + 80] > 0.3) body.push('opens kin channels');   // step T1a
  if (g[o + 79] < 0.3 && g.length > o + 79) body.push('hides its marker');
  if (g[o + 82] >= 0.25) body.push(`engulfs ${g[o + 82].toFixed(2)}${g[o + 83] >= 0.25 ? `, spares kin ${g[o + 83].toFixed(2)}` : ''}`);   // step P1
  // step P3: the taste dials (Bio.ta, words 180..183) and the range (184), in words: what it follows (+) or flees (-)
  if (g.length > o + 184) {
    const names = ['oxygen', 'exhaust', 'spilled metal', 'heat'], fol = [], fle = [];
    for (let k = 0; k < 4; k++) { const d = g[o + 180 + k] || 0; if (d >= 0.2) fol.push(`${names[k]} ${d.toFixed(1)}`); else if (d <= -0.2) fle.push(`${names[k]} ${(-d).toFixed(1)}`); }
    const rg = g[o + 184] || 0, rw = rg >= 0.7 ? ', long-range nose' : rg <= -0.7 ? ', short-range nose' : '';
    if (fol.length) body.push(`follows ${fol.join(', ')}${rw}`);
    if (fle.length) body.push(`flees ${fle.join(', ')}${fol.length ? '' : rw}`);
  }
  // step G1: the fidelity gene (copying errors x e^-F; founders 0), in words when it is off the founders' care
  const fid = g[o + 31] || 0;
  if (Math.abs(fid) >= 0.15) {
    const m = Math.exp(-Math.max(-2, Math.min(3, fid)));
    body.push(fid > 0 ? `copies carefully (proofreading: ${m < 0.1 ? m.toFixed(2) : m.toFixed(1)}× the usual errors)` : `copies sloppily (${m.toFixed(1)}× the usual errors)`);
  }
  return [parts.join(' · '), [...skin, ...pumps, ...body].join(' · ')];
}

/** Draw cell `i` (Cell words f, Bio words g) into a 2D context of size S (device px), as the dish draws it (neon). */
export function drawPortrait(cx, S, f, g, i, P = pal(), R0 = 6) {
  const o = i * CELL_FLOATS, b = i * BIO_FLOATS;
  cx.clearRect(0, 0, S, S);
  const ink = jobInk(P, jobOf(g, b));   // step F0: its JOB's ink, as the dish draws it (the fate's until then)
  const r = f[o + 4] || R0;
  const rad = Array.from({ length: 6 }, (_, k) => f[o + 26 + k]);
  const hex = rad.every((x) => x > 0.2 * r);
  const theta = f[o + 38];
  const rmax = hex ? Math.max(...rad) : r;
  const sc = S * 0.36 / Math.max(1e-3, rmax), c0 = S / 2;
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = theta + k * Math.PI / 3 + (hex ? f[o + 42 + k] : 0), rr = hex ? rad[k] : r;
    pts.push([c0 + Math.cos(a) * rr * sc, c0 + Math.sin(a) * rr * sc]);
  }
  const outline = () => {
    cx.beginPath();
    if (!hex) { cx.arc(c0, c0, r * sc, 0, 2 * Math.PI); return; }
    const m = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let k = 0; k < 6; k++) {
      const p = pts[k], a = m(p, pts[(k + 5) % 6], 0.22), bq = m(p, pts[(k + 1) % 6], 0.22);
      if (k === 0) cx.moveTo(...a); else cx.lineTo(...a);
      cx.quadraticCurveTo(p[0], p[1], ...bq);
    }
    cx.closePath();
  };
  // the crust wall (Cell.lip: per side, byte 3 the wall's cover, byte 1 its heavy share)
  const u = new Uint32Array(f.buffer, f.byteOffset, f.length);
  let cover = 0, heavy = 0;
  for (let k = 0; k < 6; k++) { const w = u[o + 72 + k] >>> 0; cover += ((w >>> 24) & 255) / 255; heavy += ((w >>> 8) & 255) / 255; }
  cover /= 6; heavy /= 6;
  const lip = P.lipid || { crustLight: [200, 128, 44], crustHeavy: [132, 72, 32] };
  if (cover > 0.15) {
    const ink = lip.crustLight.map((v, j) => v + (lip.crustHeavy[j] - v) * heavy);
    cx.save(); outline(); cx.lineWidth = S * 0.09; cx.strokeStyle = rgb(ink, 0.35 + 0.5 * cover); cx.setLineDash([S * 0.06, S * 0.025]); cx.stroke(); cx.restore();
  }
  // body: dark, a faint tint of the job
  outline();
  cx.fillStyle = rgb(ink.map((v) => v * 0.1));
  cx.fill();
  // the tube: coloured with a tight glow, a near-white core
  cx.save();
  cx.shadowColor = rgb(ink, 0.9); cx.shadowBlur = S * 0.08;
  cx.lineWidth = S * 0.045; cx.strokeStyle = rgb(ink); outline(); cx.stroke();
  cx.restore();
  cx.lineWidth = S * 0.014; cx.strokeStyle = rgb(ink.map((v) => v + (255 - v) * 0.75)); outline(); cx.stroke();
  // the battery's core (pale green; full = 0.55 r)
  const bat = Math.max(0, Math.min(1, f[o + 16]));
  if (bat > 0.01) {
    const rc = 0.55 * r * sc * Math.sqrt(bat);
    cx.save(); cx.shadowColor = rgb(P.core, 0.8); cx.shadowBlur = S * 0.05;
    cx.beginPath(); cx.ellipse(c0, c0, rc, rc * 0.8, theta, 0, 2 * Math.PI); cx.fillStyle = rgb(P.core, 0.85); cx.fill(); cx.restore();
  }
  // the engines as parts round the core: harvest in its pigment's band colour (a triangle), the others by kind
  const eng = enginesOf(g, b);
  eng.forEach(({ e, band, rate, copy }, j) => {
    // (step G2: the parts spread evenly round the core, a duplicate a little smaller)
    const a = theta + 0.6 + j * 2 * Math.PI / Math.max(3, eng.length), d = 0.5 * r * sc, s = Math.min(0.24, 0.1 + 0.05 * rate) * r * sc * (copy ? 0.8 : 1);
    const x = c0 + Math.cos(a) * d, y = c0 + Math.sin(a) * d;
    const ink = e.kind === 0 ? (P.band[band] || P.band[1]) : e.kind === 1 ? P.burn : e.kind === 2 ? P.swap : P.sed;
    cx.fillStyle = rgb(ink);
    cx.beginPath();
    if (e.kind === 0 || e.kind === 2) { cx.moveTo(x, y - s); cx.lineTo(x + s * 0.9, y + s * 0.7); cx.lineTo(x - s * 0.9, y + s * 0.7); cx.closePath(); }
    else cx.rect(x - s * 0.7, y - s * 0.7, s * 1.4, s * 1.4);
    cx.fill();
  });
}

export function cellPanel(ctx, onAdd) {
  const Z = { list: null, busy: false, last: 0, ring: [], gen: 0, body: null, rows: null, status: null };
  const M = ctx.cells;
  function ensureRing(bytesC, bytesB) {
    const d = M.device;
    if (Z.ring.length && Z.ring[0].bytesC === bytesC && Z.ring[0].bytesB === bytesB) return;
    for (const r of Z.ring) { r.c.destroy(); r.b.destroy(); }
    Z.ring = [0, 1].map(() => ({
      bytesC, bytesB, busy: false,
      c: d.createBuffer({ label: 'zoo cells read', size: bytesC, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      b: d.createBuffer({ label: 'zoo genomes read', size: bytesB, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    }));
  }
  /** Copy the cells and genomes back (never waits: mapAsync resolves later; skipped while both buffers are in flight). */
  function read() {
    const n = M.count, bytesC = n * CELL_FLOATS * 4, bytesB = n * BIO_FLOATS * 4;
    ensureRing(bytesC, bytesB);
    const rb = Z.ring.find((r) => !r.busy);
    if (!rb) return;
    rb.busy = true;
    const d = M.device, e = d.createCommandEncoder({ label: 'zoo read-back' });
    e.copyBufferToBuffer(M.cellBuf, 0, rb.c, 0, bytesC);
    e.copyBufferToBuffer(M.bioBuf[M.bioCur], 0, rb.b, 0, bytesB);
    d.queue.submit([e.finish()]);
    const gen = ++Z.gen;
    Promise.all([rb.c.mapAsync(GPUMapMode.READ), rb.b.mapAsync(GPUMapMode.READ)]).then(() => {
      const f = new Float32Array(rb.c.getMappedRange().slice(0)), g = new Float32Array(rb.b.getMappedRange().slice(0));
      rb.c.unmap(); rb.b.unmap(); rb.busy = false;
      if (gen === Z.gen) group(f, g, n);
    }).catch(() => { rb.busy = false; });
  }
  function group(f, g, n) {
    const u = new Uint32Array(f.buffer);
    const lipidsOn = !!(M.eat && M.eat.lipids && M.eat.lipids.params.on);
    const map = new Map();
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (!(u[i * CELL_FLOATS + 9] & 1)) continue;
      alive++;
      const o = i * BIO_FLOATS;
      const eng = enginesOf(g, o).map(({ e, band }) => `${e.name}${e.kind === 0 && band ? `@${band}` : ''}`).sort();
      const skin = lipidsOn ? `${g[o + 52] > 0.3 ? 'W' : ''}${g[o + 40] > 0.45 ? 'O' : ''}` : (g[o + 40] > 0.5 ? 'H' : '');
      const key = `${eng.join(' + ')}|${skin}`;
      let G = map.get(key);
      if (!G) { G = { key, members: [] }; map.set(key, G); }
      G.members.push(i);
    }
    const list = [...map.values()].sort((a, b) => b.members.length - a.members.length);
    for (const G of list) {
      G.members.sort((a, b) => f[a * CELL_FLOATS + 16] - f[b * CELL_FLOATS + 16]);
      G.rep = G.members[Math.floor(G.members.length / 2)];
      G.habit = strategyOf(g, G.rep * BIO_FLOATS);
      G.genome = Array.from(g.subarray(G.rep * BIO_FLOATS, (G.rep + 1) * BIO_FLOATS));
      G.text = summary(g, G.rep * BIO_FLOATS, lipidsOn);
    }
    Z.list = { list, alive, f, g, time: ctx.control.time() };
    render();
  }
  function render() {
    if (!Z.rows || !Z.list) return;
    const { list, alive, f, g } = Z.list, P = pal();
    const show = list.slice(0, 10);
    Z.status.textContent = `${alive} cells alive in ${list.length} groups${list.length > show.length ? ` (the ${show.length} largest shown)` : ''} · at ${Z.list.time.toFixed(0)} s`;
    Z.rows.replaceChildren();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const G of show) {
      const r = el('div', 'zrow zcell');
      const cv = el('canvas', 'portrait');
      const S = Math.round(56 * dpr);
      cv.width = S; cv.height = S;
      drawPortrait(cv.getContext('2d'), S, f, g, G.rep, P, M.R);
      // step G3: the GENOME VIEW beside it: the regulators' lattices overlaid (a moire; tap: larger)
      const FD = M.folding, gv = FD && FD.params.on ? el('canvas', 'portrait genome') : null;
      if (gv) {
        gv.width = S; gv.height = S;
        drawGenome(gv.getContext('2d'), S, g, G.rep * BIO_FLOATS, FD.params);
        const Lr = latticesOf(g, G.rep * BIO_FLOATS);
        gv.title = `its genome: the 8 regulators' lattices overlaid (${Lr.state ? 'STRESS fold' : 'home fold'}); slow fringes = links. Tap to enlarge`;
        // tap: a large view on its own line under the row (tap it again: back)
        const home = el('div', 'zgenome');
        gv.addEventListener('click', () => {
          const big = gv.classList.toggle('big'), SB = Math.round((big ? 260 : 56) * dpr);
          gv.width = SB; gv.height = SB;
          drawGenome(gv.getContext('2d'), SB, g, G.rep * BIO_FLOATS, FD.params);
          if (big) { gv.replaceWith(home); r.after(gv); } else { home.replaceWith(gv); }
        });
      }
      const main = el('div', 'zmain');
      const share = alive ? Math.round(100 * G.members.length / alive) : 0;
      const head = el('div', 'zhead');
      const J = jobOf(g, G.rep * BIO_FLOATS);   // step F0: the middle cell's job
      head.append(el('b', '', `${HABIT_NAME[G.habit] || G.habit}`), el('span', 'zjob', ` · ${J.strength >= 0.5 ? JOBS[J.job].label : 'undecided'}`),
        el('span', 'zcount', `${G.members.length} (${share} %)`));
      main.append(head, el('div', 'znums', G.text[0]), el('div', 'zamt', G.text[1]));
      const add = el('button', 'act zpip', 'add');
      add.type = 'button';
      add.title = 'place copies of this cell\'s genome where you tap or drag (the add-cell tool)';
      add.addEventListener('click', () => onAdd(G.genome, `${HABIT_NAME[G.habit] || G.habit} (${G.text[0]})`, cellIcon(G, f, g)));
      // step G3: refold the whole line by hand (the founder line of the group's middle cell): into its stress fold, or back home
      let fb = null;
      if (gv) {
        const line = Math.round(g[G.rep * BIO_FLOATS + 7]), inStress = latticesOf(g, G.rep * BIO_FLOATS).state === 1;
        fb = el('button', 'act zpip', inStress ? 'unfold' : 'refold');
        fb.type = 'button';
        fb.title = inStress ? `fold every cell of line ${line} back to its home fold` : `refold every cell of line ${line} into its stress fold (what changes comes from their genomes)`;
        fb.addEventListener('click', () => { FD.forceFold(inStress ? 0 : 1, line); fb.textContent = inStress ? 'home…' : 'folded…'; });
      }
      r.append(cv, ...(gv ? [gv] : []), main, add, ...(fb ? [fb] : []));
      Z.rows.append(r);
    }
  }
  /** A small image of the group's portrait, for the tool's button. */
  function cellIcon(G, f, g) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 40;
    drawPortrait(cv.getContext('2d'), 40, f, g, G.rep, pal(), M.R);
    return cv.toDataURL();
  }
  return {
    id: 'cells',
    title: 'Cells: the lineages living now, their portraits and genes; add cells',
    icon: '<path d="M10 3.2l5.9 3.4v6.8L10 16.8l-5.9-3.4V6.6z"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>',
    build(body) {
      Z.body = body;
      body.append(el('p', 'note zfirst', 'Every live cell, grouped by what its genes make it do: the engines it runs (with their pigments) and its skin. The portrait is the group\'s middle cell by battery, drawn as in the dish. "add" picks the add-cell tool with a copy of its genome.'));
      Z.status = el('p', 'note zstatus', 'reading the cells…');
      body.append(Z.status);
      Z.rows = el('div', 'zlist');
      body.append(Z.rows);
      body.append(el('h3', '', 'Founder habits'));
      const fr = el('div', 'zfounders');
      HABITS.forEach((h, k) => {
        const b = el('button', 'act', HABIT_FOUNDER[h]);
        b.type = 'button';
        b.title = `add fresh founders of this habit (${h}) where you tap or drag`;
        b.addEventListener('click', () => {
          const g = founderGenome(h, Math.random, 100 + k);
          onAdd(g, `founder: ${HABIT_FOUNDER[h]} (${summary(g, 0, true)[0]})`, null);
        });
        fr.append(b);
      });
      // step P1: a hand-made PREDATOR (big, the engulf gene high, no kin sparing: a cannibal too), to drop into a culture
      {
        const b = el('button', 'act', 'predator');
        b.type = 'button';
        b.title = 'add hand-made predators where you tap or drag: big cells with the engulf gene at 1 and no kin sparing (they eat smaller cells they out-pull, relatives too)';
        b.addEventListener('click', () => { onAdd(predatorGenome(), 'founder: predator (engulf 1, kin sparing 0)', null); });
        fr.append(b);
      }
      body.append(fr);
      // step T1c: DESIGNED TISSUES, each one genome whose gene network gives cells different jobs by where they sit (src/tissues.js); a tap
      // places one cell that grows into the tissue as it divides, a drag a line
      body.append(el('h3', '', 'Designed tissues'));
      const tr = el('div', 'zfounders');
      for (const name of DESIGN_NAMES) {
        const b = el('button', 'act', DESIGNS[name].label);
        b.type = 'button';
        b.title = `add cells of the designed tissue "${DESIGNS[name].label}" where you tap or drag: ${DESIGNS[name].desc} (one cell grows into the tissue as it divides; the reporter view shows the jobs)`;
        b.addEventListener('click', () => { onAdd(designGenome(name), `tissue: ${DESIGNS[name].label}`, null); });
        tr.append(b);
      }
      body.append(tr);
      if (Z.list) render();
      Z.last = 0;
      this.refresh();
    },
    refresh() {
      const now = performance.now();
      if (now - Z.last < 3000) return;
      Z.last = now;
      read();
    },
    peek: () => Z.list,
  };
}
