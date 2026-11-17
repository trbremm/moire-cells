// Step T1b: the gene network's census from saved snapshots, with the page's own census code (src/grn.js analyse: cell types as k-means
// clusters of expression per lineage, where they sit, which outputs differ). Node 18 or later (it unzips the snapshots).
//   node experiments/conditions/t1b/analyse.mjs <run> [<run> ...]          every snapshot of each run -> one JSON line per snapshot
//   ... --table                                                             a markdown table instead
import fs from 'node:fs';
import path from 'node:path';
import { Grn } from '../../../src/grn.js';
import { BIO_FLOATS } from '../../../src/genome.js';

const args = process.argv.slice(2), table = args.includes('--table');
const runs = args.filter((a) => !a.startsWith('--'));

async function unpack(p) {
  let bytes = Buffer.from(p.b64, 'base64');
  if (p.enc === 'gzip') bytes = Buffer.from(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const T = { Uint32Array, Float32Array, Int32Array, Uint8Array }[p.type];
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  return new T(copy.buffer, 0, p.n);
}

const rows = [];
for (const run of runs) {
  const dir = path.join('experiments/runs', run, 'snapshots');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))) {
    const S = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const CW = S.layout.cellWords, BW = S.layout.bioWords;
    if (BW !== BIO_FLOATS) continue;
    const idx = await unpack(S.cells.idx), rec = await unpack(S.cells.rec), bio = await unpack(S.cells.bio);
    const n = S.count;
    const cu = new Uint32Array(n * CW), bu = new Uint32Array(n * BW);
    for (let k = 0; k < idx.length; k++) { cu.set(rec.subarray(k * CW, (k + 1) * CW), idx[k] * CW); bu.set(bio.subarray(k * BW, (k + 1) * BW), idx[k] * BW); }
    const G = new Grn({ R: S.R || 9 });
    G.matter = { springs: S.springs || [] };
    const c = G.analyse(new Float32Array(bu.buffer), new Float32Array(cu.buffer), cu, n, S.time);
    rows.push({ run, t: S.time, c });
    if (!table) console.log(JSON.stringify({ run, t: S.time, n: c.n, types: c.types, diff: c.diff, border: c.border, net: c.net, best: c.reporter.best,
      lineages: c.lineages.map((l) => ({ id: l.id, n: l.n, types: l.types, regs: l.regs, diff: l.diff, border: l.border, together: l.together, chance: l.chance, differ: l.differ,
        top: l.top.map((t) => ({ key: t.key, share: t.share, contact: t.contact, light: t.light, fuel: t.fuel, bat: t.bat, spring: t.spring, border: t.border })) })) }));
  }
}
if (table) {
  const f2 = (x) => (x == null ? '-' : x.toFixed(2));
  console.log('| run | t | cells | lineages (sizes) | types per lineage | same-type neighbours (chance) | spread | inputs/reg, outputs/cell | border | biggest lineage\'s types (share: sides, light, spring R, at a border) | outputs that differ |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { run, t, c } of rows) {
    const L = c.lineages, b = L[0];
    const ty = b ? b.top.filter((x) => x.share >= 0.05).map((x) => `${Math.round(100 * x.share)}%: ${f2(x.contact)}, ${f2(x.light)}, ${x.spring == null ? '-' : x.spring.toFixed(0)}, ${Math.round(100 * x.border)}%`).join(' / ') : '-';
    console.log(`| ${run} | ${Math.round(t / 60)} min | ${c.n} | ${L.length} (${L.map((l) => l.n).join('/')}) | ${L.map((l) => l.types).join('/')} | ${L.map((l) => `${f2(l.together)} (${f2(l.chance)})`).join(' / ')} | ${c.diff.toFixed(2)}` +
      ` | ${c.net.links.toFixed(2)}, ${c.net.outputs.toFixed(1)} | ${(100 * c.border).toFixed(1)}% | ${ty} | ${b ? b.differ.slice(0, 4).map((d) => `${d.out} x${d.ratio.toFixed(1)}`).join(', ') || '-' : '-'} |`);
  }
}
