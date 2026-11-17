"""Kymographs of the dish runs (Python standard library only).

    python experiments/conditions/dish/kymo.py experiments/runs/dish-fhd-shrinkwide_s3 [--from 600] [--to 1800] [--axis x]

Reads the KYMO evals in meta.json (live cells counted in bins of 4 R) and writes kymo_<axis>.png into the run's folder: one row per sample
(time going DOWN), one column per bin along the axis, brightness = cells per R^2 in that column (summed over the other axis), against the densest column of
the whole run (a soft power, so thin regions still show). Prints, per sample: the cells alive, the densest column (R from the left / top), its density,
and the FRONT: the farthest column (from the side the front comes from) whose density is above half the densest's.
"""
import argparse
import json
import os
import struct
import zlib

PACKED = 1 / (2 * 3 ** 0.5)   # cells per R^2 in a dish packed with touching hexagons


def png(path, rows, w, h):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def colour(v):
    """0..1 -> black, deep violet, hot pink, warm white (a neon ramp)"""
    v = max(0.0, min(1.0, v))
    stops = [(0, (0, 0, 0)), (0.3, (60, 20, 110)), (0.6, (230, 50, 150)), (0.85, (255, 190, 120)), (1, (255, 250, 235))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if v <= b:
            t = (v - a) / (b - a)
            return tuple(int(ca[k] + (cb[k] - ca[k]) * t) for k in range(3))
    return stops[-1][1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--from", dest="t0", type=float, default=0)
    ap.add_argument("--to", dest="t1", type=float, default=1e9)
    ap.add_argument("--axis", default="x")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    meta = json.load(open(os.path.join(a.run, "meta.json"), encoding="utf-8"))
    ks = []
    for e in meta.get("evals", []):
        r = e.get("result")
        if isinstance(r, dict) and "g" in r and a.t0 - 1e-6 <= e["t"] <= a.t1 + 1e-6:
            ks.append((e["t"], r))
    if not ks:
        print("no kymo samples")
        return
    prof = []
    for t, r in ks:
        nx, ny, g = r["nx"], r["ny"], [int(x) for x in r["g"].split(",")]
        if a.axis == "x":
            p = [sum(g[j * nx + i] for j in range(ny)) / (16 * r["H"] / r["R"]) for i in range(nx)]
        else:
            p = [sum(g[j * nx + i] for i in range(nx)) / (16 * r["W"] / r["R"]) for j in range(ny)]
        prof.append((t, r, p))
    w = max(len(p) for _, _, p in prof)
    top = max(max(p) for _, _, p in prof) or 1   # brightness: x the densest column of the whole run
    scale = 3   # px per bin
    rows = []
    for t, r, p in prof:
        row = []
        for i in range(w):
            v = (p[i] / top) ** 0.7 if i < len(p) else 0
            row.extend(colour(v) * scale)
        for _ in range(2):
            rows.append([c for c in row])
    png(os.path.join(a.run, f"kymo_{a.axis}.png"), rows, w * scale, len(rows))
    if a.quiet:
        return
    print(f"{'t':>7} {'alive':>6} {'out':>5} {'R':>5} {'peak at':>8} {'peak':>6} {'front L':>8} {'front R':>8}  (R; density in cells per R^2, packed {PACKED:.3f})")
    for t, r, p in prof:
        bR = 4  # bin in R
        k = max(range(len(p)), key=lambda i: p[i])
        half = 0.5 * p[k]
        left = next((i for i in range(len(p)) if p[i] >= half), 0)
        right = next((i for i in range(len(p) - 1, -1, -1) if p[i] >= half), 0)
        print(f"{t:7.0f} {r['alive']:6d} {r['out']:5d} {r['R']:5.2f} {k * bR:8.0f} {p[k]:6.3f} {left * bR:8.0f} {right * bR:8.0f}")


if __name__ == "__main__":
    main()
