// Step H2: THE TISSUE LAB'S MENU (the user, 2026-11-25: "we need the home screen of the app to either go to tissue lab or to culture
// dish"). The hand-designed lab pieces a friend can open from the home screen (src/home.js), each a link that opens it as before (its
// ?tissue= or ?preset= options; nothing here changes a design or a rule), with a name, one line about what it is, a hint of how to poke it
// and a small neon glyph. The toy front (src/toy.js) reads the same list to name a lab piece in its caption, show the hint once and pick
// the signal tool. Pure data: importing it does nothing.

/** One lab piece: id, name, query (the link's options), line (what it is), hint (what to do), tool (the toy tool to pick on load),
 * match(params) (is this page that piece?), glyph (svg inner, 40 x 40 view box). */
export const LABS = [
  {
    id: 'organ', name: 'Organ', query: 'tissue=organ', tool: 'signal',
    line: 'A muscle bundle of long spindle cells, a nerve along its top, a skin of flat walled cells around it.',
    hint: 'Touch the nerve’s free end (left, outside the skin) with the signal tool: a flash runs along the nerve and the muscle twitches.',
    match: (p) => (p.get('tissue') === 'organ' || p.get('preset') === 'organ') && !p.has('organ'),
    glyph: '<rect x="3" y="11" width="34" height="22" rx="11"/><ellipse cx="12" cy="18" rx="4" ry="1.4"/><ellipse cx="21" cy="18" rx="4" ry="1.4"/><ellipse cx="30" cy="18" rx="3.4" ry="1.4"/><ellipse cx="16" cy="22.5" rx="4" ry="1.4"/><ellipse cx="25" cy="22.5" rx="4" ry="1.4"/><ellipse cx="12" cy="27" rx="4" ry="1.4"/><ellipse cx="21" cy="27" rx="4" ry="1.4"/><ellipse cx="30" cy="27" rx="3.4" ry="1.4"/><path d="M1 7c4-2 8 1 12-1s8 1 12-1 8 1 12-1" class="g2"/>',
  },
  {
    id: 'limb', name: 'Limb', query: 'tissue=limb', tool: 'signal',
    line: 'Two rods of hard bone cells, a joint held by ligaments, a muscle with a tendon at each end, its nerve, a skin.',
    hint: 'Touch the nerve’s free end (left) with the signal tool: the muscle shortens, the tendons pull and the joint bends.',
    match: (p) => p.get('tissue') === 'limb' || p.get('preset') === 'limb',
    glyph: '<path d="M3 33l15-4M23.5 27l10-13" stroke-width="4.2"/><circle cx="21" cy="28.5" r="1.8" class="g2"/><path d="M7 26c3-8 12-12 22-12" stroke-width="2.4"/><path d="M7 26l1 5M29 14l1.5 2.5" class="g2"/><path d="M5 21c3-1 5 1 8-1" class="g2" stroke-opacity="0.7"/>',
  },
  {
    id: 'relay', name: 'Relay sheet', query: 'tissue=relay&cells=400&mut=0&life=0&view=signals&zoom=2', tool: 'signal',
    line: 'Four hundred excitable cells in one sheet: each fires when it hears its neighbour, then rests a few seconds.',
    hint: 'Touch the sheet’s edge with the signal tool: a wave of flashes crosses it, with a dark resting wake behind.',
    match: (p) => p.get('tissue') === 'relay',
    glyph: '<circle cx="20" cy="20" r="16"/><path d="M8 29a14 14 0 0 1 3-19" class="g2" stroke-width="2.4"/><path d="M13 31a12 12 0 0 1 0-22" class="g2" stroke-opacity="0.45"/><circle cx="22" cy="15" r="1.4"/><circle cx="27" cy="21" r="1.4"/><circle cx="22" cy="27" r="1.4"/><circle cx="29" cy="14" r="1.4"/><circle cx="30" cy="28" r="1.4"/>',
  },
  {
    id: 'pili', name: 'Pili', query: 'tissue=pili',
    line: 'Forty crawlers, each with three long tendrils that grip the floor, reel the cell in, let go and reach out again.',
    hint: 'Just watch them twitch from anchor to anchor (the touch tool stirs the water and pushes them).',
    match: (p) => p.get('tissue') === 'pili' || p.get('preset') === 'pili',
    glyph: '<circle cx="20" cy="20" r="6.5"/><path d="M25 16c4-3 6-7 11-8M15 17c-4-1-7-5-11-5M21 26.5c0 4-3 6-2 11" class="g2"/><circle cx="36" cy="8" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="19" cy="37.5" r="1.5"/>',
  },
  {
    id: 'link', name: 'Linking', query: 'preset=lab',
    line: 'Sixty cells of one cloned genome, no evolution and no food: they meet, stick and link into a small tissue.',
    hint: 'Watch them pack into honeycomb; the touch tool stirs them apart, the cells tool drops more of the same clone.',
    match: (p) => p.get('preset') === 'lab',
    glyph: '<path d="M13 8l5 3v6l-5 3-5-3v-6zM23 14l5 3v6l-5 3-5-3v-6zM13 20l5 3v6l-5 3-5-3v-6zM33 8l5 3v6"/><path d="M30 28l4-2" class="g2"/>',
  },
];

/** The lab piece this page is (from its URL options), or null. */
export function labOf(params) {
  return LABS.find((L) => L.match(params)) || null;
}
