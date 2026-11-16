// Step C12d: ELECTRONS (the user, 2026-11-16: "on the linking we make the givers give spare electrons and the takers take
// (basically electron orbitals)"; "remember to add different energy levels to different orbitals"). The table itself (levels,
// grip, bonds, gaps, the reactions both ways, the engines) is derived in src/matter.js from row and group only (ELEC, atomLevels,
// eBond, gapBand, TABLE_E); README "Step C12d: electrons" has it written out with the checks. This module holds what is LIGHT
// and EXCITED STATES about it:
//
//   absorption  a substance absorbs only the bands its gaps match (src/matter.js: each substance's `bands`); warm light only
//               makes heat (the dark depth, ChemP.dark); a visible or hard photon EXCITES it, with optical depth kAbs per unit
//               per R^2 (the dish's light is shared between all its absorbers by depth, as before: matter.wgsl react)
//   excited     an excited state lives far shorter than a tick, so it is resolved in the tick it was made (C12c's lasting excited
//               atoms are folded in: with electrons on, g* and t* stay empty). It
//                 REACTS (photochemistry) with share yRx, where an uphill reaction of the table is open to it (a partner there,
//                 its photon covering the rise + half the spark): split among those reactions (the pair's depth, as a pair's);
//                 FLUORESCES with share yFl of the rest: emits the next LOWER band (Stokes shift), which leaves the dish; the
//                 photon's rest is heat;
//                 turns to HEAT with the rest.
//   switches    fluorescence (off: what would fluoresce is heat), excited states react (photochemistry; off: light only excites,
//               fluoresces and warms), the glow drawn (look.on)
//   books       a fluorescence event books its photon's rest as heat and only that as light caught (the emitted light passed
//               on), so "light in" stays exact; the counters (the electrons' read of the C12c slots, LG_EXC_N / LG_EXC_E, which
//               are empty of their old meaning with electrons on): excitations, fluoresced, photochemistry, and the glow's
//               energy in all, in visible 1 (gold), in visible 2 (sky blue)
//   look        the minerals as quiet dust (slate water, rust), and the fluorescence as a soft glow of tiny lights in the colour
//               of the band each emits (matter.wgsl paint works out how much each pixel re-emits; matter_draw.wgsl draws it)
//
// This module also gives the ELECTRONS panel line, the overlay lines, the rules panel's numbers and moire.sample()'s electrons.*.

import { fmt, HEAT_SCALE } from './heat.js';
import { BANDS } from './light.js';
import { ELECTRONS, ELEC, SUBSTANCES, REACTIONS, ENGINES, ENGINE_KINDS, TABLE_E, atomLevels, ATOMS, FAM_LABEL } from './matter.js';

const LG_EXC_N = 26880, LG_EXC_E = 27008;   // heat_common.wgsl (the C12c counters' slots, read with their electrons meanings)
const XN = { abs: 0, glow: 2, photo: 4 };   // XN_MADE_OPEN, XN_FADE_OPEN, XN_RX_OPEN
const XE = { glow: 1, gold: 2, blue: 0, breath: 3, ferment: 4 };   // XE_FADE, XE_LOOSE, XE_ENGINE, XE_BREATH, XE_BURN

export class Electrons {
  constructor(matter) {
    this.matter = matter;
    this.on = ELECTRONS;     // fixed for the page (?electrons=0: the previous table)
    // live-tunable (moire.electrons.params); switches in the rules panel, group "Electrons (step C12d)"
    this.params = {
      fluor: true,           // fluorescence (?fluor=0)
      photo: true,           // excited states react: photochemistry in the open (?photo=0)
      photolysis: true,      // step C12e: light may free atoms in the open (splits, uphill swaps, heads off); off (?photolysis=0): any free
                             // t in the dish is made by life (the absorbed photon glows or warms instead)
      kAbs: 1,               // optical depth of a substance for a band its gap matches, per unit per R^2
      yRx: 0.5,              // share of the excitations that react, where a reaction is open to them
      yFl: 0.4,              // share of the rest that fluoresces (the others: heat)
    };
    this.look = {
      on: true,              // draw the fluorescence glow (?glow=0)
      density: 40,           // how many tiny lights per share of the light re-emitted
      bright: 1.4,           // their brightness
      radius: 0.8,           // a light's core radius (CSS px)
      halo: 0.45,            // its soft halo's strength
      minerals: 0.8,         // the minerals' dust brightness (share of the fuel's)
    };
    this.tot = { abs: 0, glow: 0, photo: 0, eGlow: 0, eGold: 0, eBlue: 0, eBreath: 0, eFerment: 0 };
    this.hist = [];
    this.census = null;
    this.series = [];
  }

  /** Whether reaction r runs under the switches (photochemistry, fluorescence). */
  allows(r) {
    if (r.fam === 'glow') return !!this.params.fluor;
    if (r.photo) return !!this.params.photo && (this.params.photolysis || !this.freesAtom(r));
    return true;
  }

  /** Step C12e: whether a reaction leaves a free atom among its products (photolysis). */
  freesAtom(r) { return r.outs.some((c) => SUBSTANCES[c].kind === 'atom'); }

  /**
   * The excited states' shares, as each light reaction's optical depth per unit (r.kEff): an absorber's photons in a band split
   * into its photochemistry (kAbs x yRx, shared by its reactions open now), fluorescence (kAbs x (1 - that) x yFl) and heat.
   */
  shares(list) {
    const p = this.params, kA = Math.max(0, p.kAbs), yR = Math.max(0, Math.min(1, p.yRx)), yF = p.fluor ? Math.max(0, Math.min(1, p.yFl)) : 0;
    const nPhoto = new Map();
    const key = (r) => `${r.absorber}:${r.band}`;
    for (const r of list) if (r.photo) nPhoto.set(key(r), (nPhoto.get(key(r)) || 0) + 1);
    for (const r of list) {
      if (r.by !== 'light') { r.kEff = undefined; continue; }
      const n = nPhoto.get(key(r)) || 0, rest = 1 - (n > 0 ? yR : 0);
      if (r.photo) r.kEff = kA * yR / n;
      else if (r.fam === 'glow') r.kEff = kA * rest * yF;
      else if (r.fam === 'dark') r.kEff = kA * rest * (1 - yF);
    }
  }

  /** The drawing's words (struct DrawP el, minL, minH, glow1, glow2, from float a[o]). */
  writeDraw(a, o, P, H) {
    const L = this.look, light = this.matter.light;
    a[o] = this.on ? 1 : 0;
    a[o + 1] = light && light.refPerPx ? 1 / light.refPerPx : 0;
    a[o + 2] = L.on ? Math.max(0, L.density) : 0; a[o + 3] = Math.max(0, L.bright);
    const I = P.substances.mineral || { light: [150, 172, 192], heavy: [184, 108, 76] };
    const put = (k, rgb, w) => { for (let j = 0; j < 3; j++) a[o + 4 * k + j] = rgb[j] / 255; a[o + 4 * k + 3] = w; };
    put(1, I.light, Math.max(0, L.minerals)); put(2, I.heavy, 0);
    put(3, P.band[1], Math.max(0.3, L.radius)); put(4, P.band[2], Math.max(0, L.halo));
  }

  /** The heat's ledger read-back (called by src/matter.js apply). */
  apply(rec, w) {
    if (!this.on) return;
    const n16 = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_EXC_N + 16 * q + k]; return s; };
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot, A = 4096, E = (q) => wide(LG_EXC_E + 128 * q) / HEAT_SCALE;
    T.abs += n16(XN.abs) / A; T.glow += n16(XN.glow) / A; T.photo += n16(XN.photo) / A;
    T.eGlow += E(XE.glow); T.eGold += E(XE.gold); T.eBlue += E(XE.blue); T.eBreath += E(XE.breath); T.eFerment += E(XE.ferment);
    const keys = Object.keys(T), H = this.hist;
    H.push([rec.time, ...keys.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(keys.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const M = this.matter, CH = M.CH;
    const D = (n) => M.dish[CH[n]] || 0;
    const C = { time: rec.time, rate, tot: { ...T },
      freeT: D('t'), freeG: D('G'), freeg: D('g'), freeT2: D('T'), fuel: D('gT') + D('GT'), minerals: D('gt') + D('Gt'), rust: D('Gt'), water: D('gt') };
    const E2 = M.eat && M.eat.ledger && M.eat.ledger.rate2;
    if (E2) { C.breathe = E2.eSwap || 0; C.ferment = E2.eBurn || 0; }
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.freeT, C.rust, C.fuel, rate.abs, rate.glow, rate.photo, rate.eBreath, rate.eFerment]);
      if (S.length > 400) S.shift();
    }
  }

  /** What absorbs what (the panel's short list): bands by name, the substances in the dish that catch each. */
  absorbers(present = true) {
    const M = this.matter, out = [];
    for (let b = BANDS.length - 1; b >= 0; b--) {
      const who = SUBSTANCES.filter((s, c) => s.bands && s.bands.includes(b) && (!present || M.dish[c] > 0)).map((s) => s.name);
      if (who.length) out.push(`${['warm', 'V1', 'V2', 'hard'][b]} ${who.join(' ')}`);
    }
    return out.join(' · ');
  }

  /** The entropy panel's ELECTRONS line. */
  panelLine(compact = false) {
    if (!this.on) return 'ELECTRONS  off: the step C4 table (?electrons=0)';
    const C = this.census, p = this.params;
    if (!C) return 'ELECTRONS  …';
    const r = C.rate;
    const sw = `${p.photo ? '' : ' (no photochemistry)'}${p.photolysis ? '' : ' (no photolysis)'}${p.fluor ? '' : ' (no fluorescence)'}`;
    if (compact) return `ELECTRONS t ${fmt(C.freeT)} · rust ${fmt(C.rust)} · glow ${fmt(r.eGlow)}/s · breathe +${fmt(r.eBreath)}/s ferment +${fmt(r.eFerment)}/s`;
    return `ELECTRONS  free t (oxygen) ${fmt(C.freeT)} · G ${fmt(C.freeG)} · fuel ${fmt(C.fuel)} · minerals ${fmt(C.minerals)} (rust ${fmt(C.rust)})` +
      ` · batteries from breathing +${fmt(r.eBreath)}/s, fermenting +${fmt(r.eFerment)}/s` +
      `\nLIGHT  absorbs: ${this.absorbers() || 'nothing in the dish'} · excited ${fmt(r.abs)}/s → react ${fmt(r.photo)}, glow ${fmt(r.glow)}, heat ${fmt(Math.max(0, r.abs - r.photo - r.glow))}` +
      ` · fluorescence out ${fmt(r.eGlow)}/s (gold ${fmt(r.eGold)}, blue ${fmt(r.eBlue)})${sw}`;
  }

  /** The F overlay's lines: the table, then the counters. */
  tableLines() {
    const lv = (a) => atomLevels(ATOMS[a]).map((x) => +x.toFixed(4)).join(' ');
    const lines = [`electrons (step C12d): pull giver ${ELEC.pull.giver} linker ${ELEC.pull.linker} taker ${ELEC.pull.taker} (shell k at −Z/2^(k−1))` +
      ` · levels ${['g', 'G', 'l', 'L', 't', 'T'].map((a) => `${a} [${lv(a)}]`).join(' ')} · same row +${ELEC.match}, linkers share ${ELEC.share}/row, gap tolerance ${ELEC.tol}`];
    lines.push('substances (energy, gaps → bands): ' + SUBSTANCES.filter((s) => !s.excited && s.kind !== 'trace').map((s) =>
      `${s.name} ${s.energy}${s.gaps.length ? ` [${s.gaps.join(', ')} → ${s.bands.map((b) => BANDS[b].name).join(', ') || '—'}]` : ''}${s.mineral ? ' mineral' : s.kind === 'fuel' ? ' fuel' : ''}`).join(' · '));
    lines.push('table (downhill released; uphill by light in the open): ' + TABLE_E.filter((r) => r.dir === 'down').map((r) => `${r.name} ${-r.d16 / 16}`).join(' · '));
    lines.push('by light: ' + REACTIONS.filter((r) => r.photo).map((r) => r.name).join(' · '));
    lines.push(`engines (${ENGINES.length}): ` + ENGINES.map((e, k) => `${k} ${e.name} [${ENGINE_KINDS[e.kind]}]`).join(' · '));
    return lines;
  }

  overlayLines() {
    if (!this.on) return [];
    const p = this.params, L = this.look, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`excited states (step C12d): photochemistry ${on(p.photo)} · fluorescence ${on(p.fluor)} · glow drawn ${on(L.on)} · depth ${p.kAbs}/unit/R² · react ${p.yRx} · fluoresce ${p.yFl} of the rest` +
      ` · reactions running ${this.matter.rxOn.length} (${this.matter.rxOn.map((r) => FAM_LABEL[r.fam] || r.fam).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`];
    if (C) {
      const r = C.rate;
      lines.push(`excited per s: ${fmt(r.abs)} made → react ${fmt(r.photo)}, fluoresce ${fmt(r.glow)} · glow out ${fmt(r.eGlow)} (gold ${fmt(r.eGold)}, blue ${fmt(r.eBlue)}, warm ${fmt(Math.max(0, r.eGlow - r.eGold - r.eBlue))})` +
        ` · batteries from breathing ${fmt(r.eBreath)}, fermenting ${fmt(r.eFerment)} · dish: t ${fmt(C.freeT)} g ${fmt(C.freeg)} G ${fmt(C.freeG)} T ${fmt(C.freeT2)} · fuel ${fmt(C.fuel)} · water ${fmt(C.water)} · rust ${fmt(C.rust)}`);
      lines.push(`electrons every 10 s (t / rust / fuel, excited / glow / photo, breathe / ferment): ${this.series.slice(-6).map((s) =>
        `${s[0].toFixed(0)}s ${fmt(s[1])}/${fmt(s[2])}/${fmt(s[3])} ${fmt(s[4])}/${fmt(s[5])}/${fmt(s[6])} ${fmt(s[7])}/${fmt(s[8])}`).join(' ')}`);
    }
    return lines;
  }
}
