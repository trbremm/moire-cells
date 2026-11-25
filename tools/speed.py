"""Step SP1: the page's speed, measured headless (Chrome): MAX speed reached, page start time, and the GPU time per pass.

Python standard library only; reuses tools/shot.py's server and browser driver. For each configuration: opens
index.html?seed=S&speed=max&ui=0&cells=N&look=L&<extra>, records the page start (ms from navigation to the first frame and to the
tenth, from the page's own clock), the speed reached between two SIMULATION times (sim s per wall s, measured from the page's clock
moire.time()), the live cells at those times, then moire.speed.passes() (GPU timestamps per pass) and prints / saves it all as JSON.

Usage:
    python tools/speed.py                                    # 2000 and 10 000 cells, neon and harmonic, 1 run each
    python tools/speed.py --cells 2000 --looks neon --runs 2 --extra substep=1
    python tools/speed.py --label before --out experiments/runs/sp1/before.json
The GPU may be shared with other programs: interleave before/after runs and repeat.
"""

import argparse
import functools
import json
import os
import shutil
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shot  # noqa: E402

REPO = shot.REPO


def run_one(exe, port, cells, look, extra, seed, t0, t1, frames, devflags, size):
    w, h = (int(v) for v in size.split("x"))
    q = f"seed={seed}&speed=max&ui=0&cells={cells}&look={look}" + (f"&{extra}" if extra else "")
    url = f"http://localhost:{port}/index.html?{q}"
    profile = tempfile.mkdtemp(prefix="moire-speed-")
    flags = ["--enable-webgpu-developer-features"] if devflags else []
    d = shot.Chrome(exe, profile, w, h, flags)
    res = {"cells": cells, "look": look, "extra": extra, "seed": seed, "url": q}
    try:
        d.navigate(url)
        tw = time.time()
        while time.time() - tw < 240:
            st = json.loads(d.eval(shot.STATE_JS) or "{}")
            if st.get("msg"):
                res["error"] = st["msg"]
                return res
            if st.get("stage", "").startswith("running-10"):
                break
            time.sleep(0.1)
        res["start_ms"] = d.eval("Math.round(moire.stats.firstFrameMs)")
        res["ten_frames_ms"] = d.eval("Math.round(moire.stats.tenFramesMs)")
        res["boot"] = json.loads(d.eval("JSON.stringify(moire.stats.boot || [])") or "[]")
        res["pipes"] = json.loads(d.eval("JSON.stringify(moire.stats.pipes || [])") or "[]")

        def sim():
            return float(d.eval("moire.time()") or 0)

        def wait_sim(t, limit=900):
            t_wall, last, last_w = time.time(), -1.0, time.time()
            while True:
                now = sim()
                if now >= t:
                    return
                if now > last:
                    last, last_w = now, time.time()
                if time.time() - last_w > 60 or time.time() - t_wall > limit:   # (no progress for a minute: a hang or an error)
                    raise RuntimeError(f"no progress at sim {now:.2f} s: " + " | ".join(l[:200] for l in d.logs()[-5:]))
                time.sleep(0.2)

        # the per-pass table first, at t0 (while most cells are alive), then the speed from t0 + 5 s to t1 (the table's frames are a little
        # slower: its passes are split per pipeline)
        wait_sim(t0)
        res["passes_at"] = [sim(), d.eval("moire.cells.alive")]
        d.eval(f"window.__sp = null; moire.speed.passes({{frames: {frames}, quiet: true}}).then((r) => {{ window.__sp = r; }})")
        tw = time.time()
        while time.time() - tw < 120:
            r = d.eval("window.__sp ? JSON.stringify(window.__sp) : ''")
            if r:
                res["passes"] = json.loads(r)
                break
            time.sleep(0.3)
        wait_sim(t0 + 5)
        a = json.loads(d.eval("JSON.stringify({t: moire.time(), w: performance.now(), n: moire.cells.alive})"))
        wait_sim(t1)
        b = json.loads(d.eval("JSON.stringify({t: moire.time(), w: performance.now(), n: moire.cells.alive})"))
        res["speed"] = round((b["t"] - a["t"]) / ((b["w"] - a["w"]) / 1000), 3)
        res["live"] = [a["n"], b["n"]]
        res["errors"] = [l[:300] for l in d.logs() if "error" in l.lower()][:10]
    finally:
        d.quit()
        shutil.rmtree(profile, ignore_errors=True)
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cells", default="2000,10000")
    ap.add_argument("--looks", default="neon,harmonic")
    ap.add_argument("--extra", action="append", default=None, help="URL options (one configuration per --extra; '' = none)")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--t0", type=float, default=None, help="sim s where the speed window starts (2000: 40, 10 000: 20)")
    ap.add_argument("--t1", type=float, default=None, help="sim s where it ends (2000: 150, 10 000: 60)")
    ap.add_argument("--frames", type=int, default=30, help="frames moire.speed.passes() times")
    ap.add_argument("--no-devflags", action="store_true", help="leave Chrome's 0.1 ms timestamp rounding on")
    ap.add_argument("--size", default="1280x800")
    ap.add_argument("--label", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--root", action="append", default=None,
                    help="serve this folder instead of the repo (e.g. an exported older commit); repeat: label=folder pairs, run interleaved")
    args = ap.parse_args()
    exe = next((p for p in shot.BROWSERS["chrome"] if os.path.exists(p)), None)
    roots = []   # (label, folder, server, port)
    for spec in (args.root or [f"{args.label}={REPO}"]):
        lab, _, folder = spec.partition("=") if "=" in spec else (args.label, "", spec)
        srv = shot.Server(("127.0.0.1", 0), functools.partial(shot.QuietHandler, directory=folder))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        roots.append((lab, folder, srv, srv.server_address[1]))
    extras = args.extra if args.extra is not None else [""]
    out = []
    for r in range(args.runs):
        for cells in (int(c) for c in args.cells.split(",")):
            for look in args.looks.split(","):
                for ex in extras:
                  for lab, folder, _srv, port in roots:
                    t0 = args.t0 if args.t0 is not None else (40 if cells <= 4000 else 20)
                    t1 = args.t1 if args.t1 is not None else (150 if cells <= 4000 else 60)
                    try:
                        res = run_one(exe, port, cells, look, ex, args.seed, t0, t1, args.frames, not args.no_devflags, args.size)
                    except Exception as e:   # noqa: BLE001  (recorded, the batch goes on)
                        res = {"cells": cells, "look": look, "extra": ex, "error": str(e)[:600]}
                        print("            FAILED:", res["error"], flush=True)
                    res["label"], res["run"] = lab, r
                    P = res.get("passes") or {}
                    print(f"{lab:>10} run {r} {cells:>6} {look:<8} {ex or '-':<24} x{res.get('speed')}  start {res.get('start_ms')} ms"
                          f"  live {res.get('live')}  timed {P.get('timedMsPerTick')} ms/tick, {P.get('ticksPerFrame')} ticks/frame", flush=True)
                    b = res.get("boot") or []
                    print("            boot: " + "  ".join(f"{n} {t}" for n, t in b), flush=True)
                    sl = sorted(res.get("pipes") or [], key=lambda x: x[1] - x[2])[:6]
                    if sl:
                        print("            slowest pipelines: " + "  ".join(f"{n} {e - a} ms" for n, a, e in sl), flush=True)
                    for g in (P.get("groups") or [])[:8]:
                        print(f"            {g['group']:<34} {g['ms/tick']:>8} ms/tick  {g['share']}", flush=True)
                    if res.get("errors"):
                        print("            ERRORS:", res["errors"])
                    out.append(res)
                    if args.out:   # (after every run: a batch cut short keeps what it measured)
                        save(args.out, out)
    for _lab, _f, srv, _p in roots:
        srv.shutdown()
    if args.out:
        print("wrote", save(args.out, out))


def save(out_path, out):
    path = out_path if os.path.isabs(out_path) else os.path.join(REPO, out_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    return path


if __name__ == "__main__":
    main()
