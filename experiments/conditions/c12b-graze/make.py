"""The C12b supply fix (2026-11-16), CELLS GRAZE CRUST: writes the conditions. Run from the repository:
    python experiments/conditions/c12b-graze/make.py

  graze-on / graze-off   the default scene, 15 simulated minutes, grazing on and ?graze=0 (seeds 3 and 7: batch.json)
  same-on / same-off     the default scene with its light and heavy spring dropped at ONE place (halfway between the usual
                         two), 8 min: the test of the co-location explanation (soap needs one l AND one L; the default
                         springs put them into two crusts 144 px apart)
Every 5 minutes a diagnosis eval reads every cell's stock: how many cells hold L, l, heads (more than 6 counts), all three,
and a few L-holders' numbers (L, l, heads, battery, soap, wall in counts).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DIAG = (
    "const E = moire.eat, C = moire.cells, d = C.device, n = C.count; "
    "const read = async (src, bytes) => { const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); "
    "const e = d.createCommandEncoder(); e.copyBufferToBuffer(src, 0, buf, 0, bytes); d.queue.submit([e.finish()]); await buf.mapAsync(GPUMapMode.READ); "
    "const out = buf.getMappedRange().slice(0); buf.destroy(); return out; }; "
    "const SW = E.stockBuf.size / 4 / n, CF = C.cellBuf.size / n / 4; "
    "const st = new Int32Array(await read(E.stockBuf, n * SW * 4)), cu = new Uint32Array(await read(C.cellBuf, C.cellBuf.size)); "
    "const r = { n: 0, withL: 0, withl: 0, withHeads: 0, withAll: 0, Lcells: [] }; "
    "for (let i = 0; i < n; i++) { if (!(cu[i * CF + 9] & 1)) continue; const o = i * SW; r.n++; "
    "const gt = st[o] + st[o + 1], l = st[o + 2], L = st[o + 5]; let soap = 0, wall = 0; "
    "for (let k = 0; k < 6; k++) { soap += st[o + 32 + k] + st[o + 38 + k]; wall += st[o + 50 + k] + st[o + 56 + k]; } "
    "if (L > 6) { r.withL++; if (r.Lcells.length < 8) r.Lcells.push([L, l, gt, Math.round(st[o + 13] / 655.36) / 100, soap, wall]); } "
    "if (l > 6) r.withl++; if (gt > 6) r.withHeads++; if (L > 6 && l > 6 && gt > 6) r.withAll++; } "
    "return JSON.stringify(r)"
)
SAME = ("const s = moire.matter.springs.map(x => [x.x, x.y]); moire.matter.clearSprings(); const x = (s[0][0] + s[1][0]) / 2, "
        "y = (s[0][1] + s[1][1]) / 2; moire.matter.addSpring(x, y, 'light', 240); moire.matter.addSpring(x, y, 'heavy', 240); return [x, y]")
STATS = ("const s = await moire.lipids.stats(); return JSON.stringify({ all: s.all, lit: s.lit, dark: s.dark, "
         "founders: s.founders.slice(0, 6) })")


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)


def main():
    D = 900
    for on in (True, False):
        tag = "on" if on else "off"
        q = {} if on else {"graze": 0}
        ev = [{"t": t, "js": DIAG} for t in (300, 600, 900)] + [{"t": t, "js": STATS} for t in (300, 900)]
        write(f"graze-{tag}", {
            "name": f"c12b-graze-{tag}",
            "description": f"the C12b supply fix: the default scene, 15 min, cells graze crust {tag}",
            "query": q, "duration": D, "sample_every": 20,
            "evals": sorted(ev, key=lambda e: e["t"]),
            "shots": [{"t": 300}, {"t": 600}, {"t": 900}, {"t": 900, "panel": True, "name": "panel"}],
        })
        write(f"same-{tag}", {
            "name": f"c12b-same-{tag}",
            "description": f"the C12b supply fix, the co-location test: both default springs at one place, 8 min, grazing {tag}",
            "query": {**q, "seed": 3}, "duration": 480, "sample_every": 20,
            "evals": [{"t": 0, "js": SAME}] + [{"t": t, "js": DIAG} for t in (240, 480)],
            "shots": [{"t": 240}, {"t": 480}],
        })
    with open(os.path.join(HERE, "batch.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-graze", "runs": ["graze-on.json", "graze-off.json"], "seeds": [3, 7]}, fh, indent=1)
    with open(os.path.join(HERE, "batch-same.json"), "w", encoding="utf-8") as fh:
        json.dump({"batch": "c12b-same", "runs": ["same-on.json", "same-off.json"]}, fh, indent=1)


if __name__ == "__main__":
    main()
