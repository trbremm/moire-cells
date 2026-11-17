"""Dish size and densities: the conditions (waves after a resize).
Run from the repository:
    python experiments/conditions/dish/make.py

  batch-repro2/3   fhd-shrinkwide: 1920x1080 for 10 min, then the window shrunk to 1152x360 (5x less area, wide and short, like the
                   user's), 20 min more, a snapshot just before (run on the code before the fix: a frozen copy of main + the grid-buffer
                   fix); small-wide: 1152x360 from the start, 2000 cells. (A first batch at 2400x1350 ran at x0.4 and was dropped.)
  batch-suspects   the strip dish (395 x 123 R) on the new code with the old values put back one at a time (only strip-new finished:
                   the GPU was shared with up to nine other runs)
  diag-*.json      from that snapshot (copy it to experiments/snaps/fhd599.json): the old resize with ?dishfollow=1 (diag-follow),
                   dragged in 20 steps (diag-gradual), with positions rescaled and only the drain (batch-diag)
  check-*.json     the books across resizes, squeezes and stretches; the reference dish per starting number
  batch-presets    the Fronts, Chip and Deep vents (fissures) presets, with pictures
Every 5-30 s a KYMO eval: the live cells counted in bins of 4 R (the cells' radius at that moment) over the dish, for kymographs
(cells along x against time) and front speeds.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# the live cells binned on a 4 R grid, plus mean battery per bin (Cell words: pos 0,1; r 4; flags 9; bat 16)
KYMO_DEF = r"""
window.__kymo = async () => {
  const M = window.moire, C = M.cells, d = M.gpu.device, n = C.count, F = 92;
  const buf = d.createBuffer({ size: n * F * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = d.createCommandEncoder(); e.copyBufferToBuffer(C.cellBuf, 0, buf, 0, n * F * 4); d.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ); const f = new Float32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
  const u = new Uint32Array(f.buffer), v = M.control.view(), W = (M.dish ? M.dish.W : v.cssW), H = (M.dish ? M.dish.H : v.cssH);
  const b = 4 * C.R, nx = Math.ceil(W / b), ny = Math.ceil(H / b);
  const g = new Array(nx * ny).fill(0), bat = new Array(nx * ny).fill(0); let alive = 0, out = 0, rs = 0;
  for (let i = 0; i < n; i++) {
    if (!(u[i * F + 9] & 1)) continue; alive++; rs += f[i * F + 4];
    const ix = Math.floor(f[i * F] / b), iy = Math.floor(f[i * F + 1] / b);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) { out++; continue; }
    g[iy * nx + ix]++; bat[iy * nx + ix] += f[i * F + 16];
  }
  return { t: M.time(), R: C.R, mR: M.medium.R, W, H, b, nx, ny, alive, out, rMean: alive ? rs / alive / C.R : 0,
           g: g.join(','), bat: bat.map((x, k) => g[k] ? (x / g[k]).toFixed(3) : 0).join(',') };
};
return 'ok';
"""
KYMO = "return await window.__kymo()"


def write(name, cond):
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(cond, fh, indent=1, ensure_ascii=False)
    return f"{name}.json"


def run(name, desc, q, size, D, resizes=(), shots=(), every=10, clips=()):
    ev = [{"t": 0, "js": KYMO_DEF}] + [{"t": t, "js": KYMO} for t in range(0, int(D) + 1, every)]
    return {"name": f"dish-{name}", "description": desc, "query": q, "size": size, "duration": D, "sample_every": 30,
            "stall": 200, "evals": ev, "shots": list(shots), "resizes": list(resizes), "clips": list(clips)}


def kymo_times(D, t0=None):
    """every 30 s, every 5 s for 10 min after a resize at t0"""
    ts = set(range(0, int(D) + 1, 30))
    if t0 is not None:
        ts |= set(range(t0, min(int(D), t0 + 600) + 1, 5))
    return sorted(ts)


def run2(name, desc, q, size, D, t0=None, resize=None, shots=()):
    ev = [{"t": 0, "js": KYMO_DEF}] + [{"t": t, "js": KYMO} for t in kymo_times(D, t0)]
    c = {"name": f"dish-{name}", "description": desc, "query": q, "size": size, "duration": D, "sample_every": 30,
         "stall": 300, "evals": ev, "shots": list(shots), "resizes": [{"t": t0, "size": resize}] if resize else []}
    return c


# the user's case, smaller (the 2400 x 1350 runs went at x0.4 with the GPU shared): 1920 x 1080 for 10 min, then 1152 x 360 (5x less
# area, wide and short), 20 min more; and the same culture started at the small size (2000 cells: the same R as after the resize)
T0 = 600
sh = [{"t": t, "name": f"t{t:04d}"} for t in (300, 599, 602, 620, 640, 660, 690, 720, 780, 840, 900, 1020, 1140, 1260, 1380, 1500, 1620, 1800)]
runs = [
    run2('fhd-shrinkwide', '1920x1080 10 min, then 1152x360 (5x less area, wide-short), 20 min', {}, "1920x1080", 1800, T0, "1152x360", sh),
    run2('small-wide', '1152x360 from the start, 2000 cells (the R the resized dish gets), 20 min', {"cells": 2000}, "1152x360", 1200, None, None,
         [{"t": t, "name": f"t{t:04d}"} for t in (60, 120, 240, 360, 600, 900, 1200)]),
]
write("batch-repro2", {"batch": "dish-repro2", "runs": runs, "seeds": [3]})
# the shrink again (the first try met the old resize's grid-buffer crash, fixed in both copies), with a snapshot just before the resize
r3 = dict(runs[0]); r3["snapshots"] = [{"t": 599, "grid": True}]
write("batch-repro3", {"batch": "dish-repro3", "runs": [r3], "seeds": [3]})

# the suspects, one at a time, on the NEW code (the dish keeps its size): a strip dish of the resized window's size in cell units
# (395 x 123 R in a 1152 x 360 window: R 2.92 px, as after the resize), 2000 cells, 20 min, with the old window rule's values put back
# one at a time: medium 3.09 R (the old medium R 9 px over R 2.92 px), light 2.8 per R^2 (?power=6.68 per area; the old 33 per 100 px^2
# at R 2.92), capacity 6000 (0.12 per R^2); ?perarea=0 puts back light, capacity, springs and oases per dish together; strip-old = the
# old regime (= the old code's small-wide run: perarea=0 and medium 3.09)
STRIP = {"dish": "395x123", "cells": 2000}
shs = [{"t": t, "name": f"t{t:04d}"} for t in (60, 120, 240, 360, 480, 600, 900, 1200)]
sus = [
    run2('strip-new', 'strip dish 395x123 R, 2000 cells, the new per-area rules (medium 1.39 R, light 13.9 per R^2, capacity per area)', dict(STRIP), "1152x360", 1200, None, None, shs),
    run2('strip-medium', '... medium 3.09 R (as the old window rule gave after the resize)', dict(STRIP, medium=3.09), "1152x360", 1200, None, None, shs),
    run2('strip-dark', '... light 2.8 per R^2 (as after the resize)', dict(STRIP, power=6.68), "1152x360", 1200, None, None, shs),
    run2('strip-cap', '... capacity 6000 (0.12 per R^2, as after the resize)', dict(STRIP, cap=6000), "1152x360", 1200, None, None, shs),
    run2('strip-perarea0', '... light, capacity, springs and oases as the old rule (perarea=0), medium 1.39 R', dict(STRIP, perarea=0), "1152x360", 1200, None, None, shs),
    run2('strip-old', '... the old regime: perarea=0 and medium 3.09 R (= the old code started in a 1152x360 window)', dict(STRIP, perarea=0, medium=3.09), "1152x360", 1200, None, None, shs),
]
write("batch-suspects", {"batch": "dish-suspects", "runs": sus, "seeds": [3]})
print("written")
