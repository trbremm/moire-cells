"""Headless experiment runner: run conditions at MAX speed, timed by SIMULATED time, and record the numbers.

Python standard library only; drives the browser as tools/shot.py does (its own static server on a free port, a throwaway
profile, Chrome/Edge over the DevTools protocol, Firefox over WebDriver BiDi). For each condition:
  1. opens index.html?speed=max&until=0&overlay=ghost&ui=0&<the condition's URL options>: the page starts paused at t = 0
     (after its warm-up), or right after its snapshot (?snap=) has loaded;
  2. walks through the condition's events in simulation time, pausing EXACTLY at each (moire.control.runUntil): console
     evals, samples (moire.sample(): every number of the entropy panel and the ledgers behind it, flat; with "tissue": true
     also moire.tissue.stats()), screenshots (in a chosen view), snapshots (moire.snapshot()), .webm clips (recorded while it
     runs at a chosen speed);
  3. writes experiments/runs/<name>/: samples.csv (one row per sample), panel.txt (the panel's text at each sample),
     meta.json (exact URL, condition, git commit, browser, adapter, wall time, speed reached, status), console.log,
     shots/*.png, clips/*.webm, snapshots/*.json.
A run that hangs (simulation time stops moving), whose page shows an error or throws, is recorded as failed (status and
error in meta.json, the console in console.log) and the batch goes on. Browsers are closed at the end of every run.

Usage:
    python tools/experiment.py experiments/conditions/default-2min.json
    python tools/experiment.py experiments/conditions/batch-example.json            # a batch: {"runs": [...], "seeds": [...]}
    python tools/experiment.py cond.json --seeds 3,7 --out experiments/runs          # every condition once per seed
    python tools/experiment.py cond.json --browser firefox                           # Firefox (needs a visible window)
    python tools/experiment.py cond.json --only tissue-40 --duration 30              # one condition of a batch, shorter

Condition file (JSON; every key but "name" optional):
    {
      "name": "default-2min",                      # the run's folder name (with a seed list: name_s<seed>)
      "description": "plain words",
      "query": {"seed": 3, "light": "spot"},        # URL options (README: URL options); speed=max, until=0 are added
      "size": "1280x800",                          # viewport, CSS px
      "duration": 120,                             # simulated seconds (from the start, or from the snapshot's time)
      "sample_every": 5,                           # s of simulated time between samples (0 = only at the start and end)
      "tissue": false,                             # also sample moire.tissue.stats() (tissue.*)
      "evals": [{"t": 0, "js": "moire.cells.params.stiffness = 9"},
                {"t": 60, "js": "await moire.tissue.stir(640, 400, 12, 0, 20)"}],   # statements; await allowed
      "shots": [{"t": 60}, {"t": 120, "view": "lineage", "panel": true, "name": "end"}],
                                                   # view: clean (default) fate lineage strategy charge walls machinery;
                                                   # panel: keep the entropy panel in the picture
      "clips": [{"t": 30, "until": 50, "speed": 8}],   # a .webm of t 30..50 s recorded at 8x (events inside it happen at
                                                       # its end)
      "snapshots": [{"t": 120, "grid": true}],     # moire.snapshot() saved as snapshots/snap_t120.json
      "resizes": [{"t": 300, "size": "1000x700"}],  # the window resized (Chrome only), before the evals at that time
      "stall": 60, "timeout": 0                    # wall s without progress = hang; overall wall limit (0 = auto)
    }
"""

import argparse
import base64
import csv
import datetime
import functools
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shot  # noqa: E402  (the browser drivers and the static server)

REPO = shot.REPO
TICK = 1 / 60
BASE_QUERY = {"speed": "max", "until": "0", "overlay": "ghost", "ui": "0"}
HIDE_UI_CSS = "#ui, #hint, #overlay, #rec, #msg[hidden] { visibility: hidden !important; }"
HIDE_PANEL_CSS = "#entropy { visibility: hidden !important; }"


class RunFailed(Exception):
    pass


# ---------------------------------------------------------------- page access
class Page:
    def __init__(self, driver, browser):
        self.d, self.browser = driver, browser

    def js(self, expr, timeout=120):
        """Evaluate an async expression in the page; its value comes back through JSON."""
        src = f"(async () => {{ const __v = await ({expr}); return JSON.stringify(__v === undefined ? null : __v); }})()"
        if self.browser == "firefox":
            r = self.d.rpc.call("script.evaluate", {"expression": src, "target": {"context": self.d.ctx},
                                                     "awaitPromise": True}, timeout=timeout)
            if r.get("type") == "exception":
                raise RuntimeError(r.get("exceptionDetails", {}).get("text", "exception"))
            v = r.get("result", {}).get("value")
        else:
            r = self.d.rpc.call("Runtime.evaluate", {"expression": src, "returnByValue": True, "awaitPromise": True},
                                timeout=timeout)
            if "exceptionDetails" in r:
                d = r["exceptionDetails"]
                raise RuntimeError(d.get("text", "") + " " + str(d.get("exception", {}).get("description", "")))
            v = r.get("result", {}).get("value")
        return json.loads(v) if isinstance(v, str) else v

    def run_code(self, code, timeout=300):
        """Run statements (await allowed); returns what a `return` gives."""
        return self.js(f"(async () => {{ {code}\n }})()", timeout=timeout)

    def status(self):
        return self.js("""(() => { const m = document.getElementById('msg');
          return { t: window.moire && window.moire.time ? window.moire.time() : -1,
                   paused: !!(window.moire && window.moire.control && window.moire.control.paused()),
                   stage: document.body.dataset.stage || '', lab: document.body.dataset.lab || '',
                   labError: document.body.dataset.labError || '',
                   msg: m && !m.hidden ? m.innerText : '' }; })()""", timeout=30)


def page_errors(logs):
    return [ln for ln in logs if ln.startswith("exception") or ".error:" in ln or ln.startswith("console.error")
            or ln.startswith("javascript.error")]


# ---------------------------------------------------------------- one run
def git_info():
    def run(*a):
        try:
            return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception:  # noqa: BLE001
            return ""
    return {"commit": run("rev-parse", "HEAD"), "dirty": bool(run("status", "--porcelain", "--untracked-files=no"))}


def build_events(cond, duration):
    every = float(cond.get("sample_every", 5) or 0)
    ev = []   # (time, order, kind, spec)
    for e in cond.get("evals", []):
        ev.append((float(e.get("t", 0)), 0, "eval", e))
    if every > 0:
        k = 0
        while k * every <= duration + 1e-9:
            ev.append((round(k * every, 6), 1, "sample", {}))
            k += 1
    else:
        ev.append((0.0, 1, "sample", {}))
    if not any(e[2] == "sample" and abs(e[0] - duration) < 1e-6 for e in ev):
        ev.append((duration, 1, "sample", {}))
    for s in cond.get("shots", []):
        ev.append((float(s.get("t", duration)), 2, "shot", s))
    for s in cond.get("snapshots", []):
        ev.append((float(s.get("t", duration)), 3, "snapshot", s))
    for c in cond.get("clips", []):
        ev.append((float(c.get("t", 0)), 4, "clip", c))
    for r in cond.get("resizes", []):   # step C10's checks: the window resized to r["size"] (Chrome; before the evals)
        ev.append((float(r.get("t", 0)), -1, "resize", r))
    return sorted((e for e in ev if e[0] <= duration + 1e-9), key=lambda e: (e[0], e[1]))


def write_csv(path, rows):
    keys = []
    seen = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, restval="")
        w.writeheader()
        for r in rows:
            w.writerow({k: (f"{v:.9g}" if isinstance(v, float) else v) for k, v in r.items()})


def run_condition(cond, out_dir, port, args):
    name = cond["name"]
    rd = os.path.join(out_dir, name)
    if os.path.isdir(rd):
        shutil.rmtree(rd)
    os.makedirs(rd)
    duration = float(cond.get("duration", 120))
    size = cond.get("size", args.size)
    w, h = (int(v) for v in size.lower().split("x"))
    browser = cond.get("browser", args.browser)
    query = {**BASE_QUERY, **{k: str(v) for k, v in cond.get("query", {}).items()}}
    url = f"http://localhost:{port}/index.html?" + urllib.parse.urlencode(query, safe=",:@/")
    meta = {"name": name, "description": cond.get("description", ""), "condition": cond, "url": url,
            "browser": browser, "size": size, **git_info(), "started": datetime.datetime.now().isoformat(timespec="seconds"),
            "status": "running"}
    rows, panel_lines, logs = [], [], []
    wall0 = time.time()
    run_wall = 0.0   # wall time spent running (not paused)
    stall = float(cond.get("stall", args.stall))
    timeout = float(cond.get("timeout", 0) or max(600.0, 10.0 * duration))
    exe = next((p for p in shot.BROWSERS[browser] if os.path.exists(p)), None)
    if not exe:
        raise SystemExit(f"{browser} not found")
    profile = tempfile.mkdtemp(prefix=f"moire-exp-{browser}-")
    driver = None
    print(f"[{name}] {url}")

    def save_meta():
        meta["wall_s"] = round(time.time() - wall0, 2)
        with open(os.path.join(rd, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

    try:
        if browser == "firefox":
            driver = shot.Firefox(exe, profile, w, h, [], {}, headed=True)
        else:
            driver = shot.Chrome(exe, profile, w, h, ["--disable-background-timer-throttling",
                                                      "--disable-renderer-backgrounding",
                                                      "--disable-backgrounding-occluded-windows"])
            try:
                meta["browser_version"] = driver.rpc.call("Browser.getVersion").get("product", "")
            except Exception:  # noqa: BLE001
                pass
        page = Page(driver, browser)
        driver.navigate(url)
        # start: running-10-frames (paused at 0 by until=0), then the lab's URL options (snapshot, clone, genes)
        t0 = time.time()
        while True:
            st = page.status()
            if st["msg"]:
                raise RunFailed("page message: " + st["msg"][:500])
            if st["stage"].startswith("running-10") and st["lab"] in ("", "ready", "failed"):
                break
            if time.time() - t0 > args.ready_timeout:
                raise RunFailed(f"page did not start (stage '{st['stage']}', lab '{st['lab']}')")
            time.sleep(0.1)
        if st["lab"] == "failed":
            raise RunFailed("lab setup failed: " + st["labError"])
        page.js("moire.control.setPaused(true)")
        meta["adapter"] = page.js("moire.adapter()")
        if "snap" in query:
            meta["snapshot_load"] = page.js("moire.lab.loaded || null")
        t_start = page.js("moire.time()")
        meta["t_start"] = t_start
        print(f"[{name}] started in {time.time() - t0:.1f} s at t {t_start:.2f}; adapter {meta['adapter']}")

        def run_to(target):
            nonlocal run_wall
            page.js(f"moire.control.runUntil({target!r})")
            last_t, last_move, t_run = None, time.time(), time.time()
            while True:
                st = page.status()
                if st["msg"]:
                    raise RunFailed("page message: " + st["msg"][:500])
                if st["paused"] and st["t"] >= target - TICK:
                    break
                now = time.time()
                if last_t is None or st["t"] > last_t + 1e-9:
                    last_t, last_move = st["t"], now
                elif now - last_move > stall:
                    raise RunFailed(f"hang: simulation time stuck at {st['t']:.2f} s for {stall:.0f} s (target {target:.2f})")
                if now - wall0 > timeout:
                    raise RunFailed(f"timeout: {timeout:.0f} s of wall time")
                time.sleep(0.04)
            run_wall += time.time() - t_run
            return st["t"]

        def shoot(spec, trun):
            view = spec.get("view", "clean")
            nm = spec.get("name") or f"t{trun:g}" + ("" if view == "clean" else f"_{view}")
            path = os.path.join(rd, "shots", f"{nm}.png")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            css = HIDE_UI_CSS + ("" if spec.get("panel") else HIDE_PANEL_CSS)
            page.js(f"""(async () => {{ window.__labPrev = moire.lab.view({json.dumps(view)});
              let s = document.getElementById('lab-shot-css'); if (!s) {{ s = document.createElement('style');
              s.id = 'lab-shot-css'; document.head.append(s); }} s.textContent = {json.dumps(css)}; }})()""")
            time.sleep(float(spec.get("settle", 0.6)))   # the neon trails of the old view fade (real time)
            with open(path, "wb") as f:
                f.write(driver.screenshot())
            page.js("(() => { moire.lab.restoreView(window.__labPrev); const s = document.getElementById('lab-shot-css');"
                    " if (s) s.remove(); })()")
            return os.path.relpath(path, rd).replace(os.sep, "/")

        def clip(spec, trun):
            end = float(spec.get("until", trun + 10))
            nm = spec.get("name") or f"clip_t{trun:g}-{end:g}"
            path = os.path.join(rd, "clips", f"{nm}.webm")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            ok = page.js("""(() => { const r = moire.recorder; if (!r || !r.supported) return false; r.noDownload = true;
              r.lastBlob = null; const v = moire.control.view(); return r.start(v.cssW, v.cssH); })()""")
            if not ok:
                print(f"[{name}] clip: recording not available in this browser")
                return None
            page.js(f"moire.control.setSpeed({json.dumps(str(spec.get('speed', 8)))})")
            rec0 = time.time()
            t_end = run_to(t_start + end)
            # the encoder needs a moment: a recording shorter than about 1.5 s of real time can come out empty (the
            # last picture is held meanwhile)
            time.sleep(max(0.0, float(spec.get("min_real", 2.0)) - (time.time() - rec0)))
            page.js("moire.recorder.stop()")
            data = None
            for _ in range(200):
                data = page.js("""(async () => { const b = moire.recorder.lastBlob; if (!b) return null;
                  return await new Promise((res) => { const fr = new FileReader();
                  fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(b); }); })()""")
                if data is not None:
                    break
                time.sleep(0.1)
            page.js("moire.control.setSpeed('max')")
            if not data:
                print(f"[{name}] clip {nm}: the recording came out empty")
                return {"file": None, "t_end": t_end - t_start, "error": "empty recording"}
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
            return {"file": os.path.relpath(path, rd).replace(os.sep, "/"), "t_end": t_end - t_start, "bytes": os.path.getsize(path)}

        events = build_events(cond, duration)
        snap_files, shot_files, clip_files, eval_results = [], [], [], []
        i = 0
        while i < len(events):
            t = events[i][0]
            group = []
            while i < len(events) and abs(events[i][0] - t) < 1e-9:
                group.append(events[i])
                i += 1
            now = run_to(t_start + t)
            trun = now - t_start
            for _, _, kind, spec in group:
                if kind == "resize" and browser != "firefox":
                    rw, rh = (int(v) for v in spec["size"].lower().split("x"))
                    driver.rpc.call("Emulation.setDeviceMetricsOverride", {"width": rw, "height": rh, "deviceScaleFactor": 1, "mobile": False})
                    time.sleep(1.0)   # the page sees the resize on its next frames (it is paused: it redraws)
                    print(f"[{name}] resized to {rw}x{rh}")
                elif kind == "eval":
                    r = page.run_code(spec["js"])
                    after = page.js("moire.time()")
                    eval_results.append({"t": trun, "js": spec["js"], "result": r})
                    if abs(after - now) > 1.0:
                        # the eval moved the clock (e.g. moire.loadSnapshot): the run's timeline moves with it
                        t_start += after - now
                        print(f"[{name}] the eval moved the clock by {after - now:+.2f} s; run times now count from "
                              f"{t_start:.2f}")
                    now = after
                elif kind == "sample":
                    s = page.js(f"moire.sample({{ tissue: {json.dumps(bool(cond.get('tissue')))} }})", timeout=180)
                    row = {"trun": round(trun, 4), "wall": round(time.time() - wall0, 2), **s}
                    rows.append(row)
                    write_csv(os.path.join(rd, "samples.csv"), rows)
                    txt = page.js("document.getElementById('entropy').textContent")
                    panel_lines.append(f"--- t {s.get('t', now):.2f} s (run {trun:.2f} s)\n{txt}\n")
                    with open(os.path.join(rd, "panel.txt"), "w", encoding="utf-8") as f:
                        f.write("\n".join(panel_lines))
                    print(f"[{name}] t {trun:7.1f}  cells {s.get('alive', '?'):>5}  entropy {s.get('heat.out', 0):10.4g} "
                          f"(+{s.get('heat.rate.out', 0):.3g}/s)  order {s.get('matter.order', float('nan')):.3f}  "
                          f"rounding atoms {s.get('matter.rounding', 'nan')} charge {s.get('charge.qRound', 'nan')}")
                elif kind == "shot":
                    shot_files.append(shoot(spec, trun))
                elif kind == "snapshot":
                    S = page.js(f"moire.snapshot({{ grid: {json.dumps(spec.get('grid', True))}, "
                                f"tissue: {json.dumps(bool(cond.get('tissue')))}, note: {json.dumps(spec.get('note', name))} }})",
                                timeout=300)
                    nm = spec.get("name") or f"snap_t{trun:g}"
                    p = os.path.join(rd, "snapshots", f"{nm}.json")
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "w", encoding="utf-8") as f:
                        json.dump(S, f)
                    snap_files.append(os.path.relpath(p, rd).replace(os.sep, "/"))
                elif kind == "clip":
                    c = clip(spec, trun)
                    if c:
                        clip_files.append(c)
        sim = page.js("moire.time()") - t_start
        meta.update({"status": "ok", "sim_s": round(sim, 3), "run_wall_s": round(run_wall, 2),
                     "speed_reached": round(sim / run_wall, 2) if run_wall > 0 else None,
                     "samples": len(rows), "shots": shot_files, "snapshots": snap_files, "clips": clip_files,
                     "evals": eval_results})
    except Exception as e:  # noqa: BLE001  record and go on
        meta["status"] = "failed"
        meta["error"] = f"{type(e).__name__}: {e}"
        print(f"[{name}] FAILED: {meta['error']}")
    finally:
        if driver:
            try:
                logs = driver.logs()
            except Exception:  # noqa: BLE001
                logs = []
            try:
                driver.quit()
            except Exception:  # noqa: BLE001
                pass
            try:
                if driver.proc.poll() is None:
                    driver.proc.kill()
            except Exception:  # noqa: BLE001
                pass
        time.sleep(0.3)
        shutil.rmtree(profile, ignore_errors=True)
        errs = page_errors(logs)
        thrown = [ln for ln in errs if ln.startswith("exception") or ln.startswith("javascript.error")]
        meta["console_errors"] = errs[:50]
        if meta["status"] == "ok" and (thrown or (errs and args.strict)):
            meta["status"] = "failed"
            meta["error"] = ("uncaught exception in the page" if thrown else "console errors") + " (see console.log)"
        with open(os.path.join(rd, "console.log"), "w", encoding="utf-8") as f:
            f.write("\n".join(logs))
        meta["ended"] = datetime.datetime.now().isoformat(timespec="seconds")
        save_meta()
    print(f"[{name}] {meta['status']} in {meta['wall_s']:.0f} s"
          + (f", {meta.get('sim_s', 0):.0f} sim s at x{meta.get('speed_reached')}" if meta["status"] == "ok" else ""))
    return meta


# ---------------------------------------------------------------- batch
def load_conditions(path, seeds_arg, only):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    base = os.path.dirname(os.path.abspath(path))
    if isinstance(data, list):
        data = {"runs": data}
    runs = data.get("runs", [data])
    out = []
    for r in runs:
        if isinstance(r, str):
            with open(os.path.join(base, r), encoding="utf-8") as f:
                r = json.load(f)
        out.append(r)
    seeds = seeds_arg if seeds_arg is not None else data.get("seeds")
    if seeds:
        expanded = []
        for r in out:
            for s in seeds:
                c = json.loads(json.dumps(r))
                c["name"] = f"{r['name']}_s{s}"
                c.setdefault("query", {})["seed"] = s
                expanded.append(c)
        out = expanded
    if only:
        out = [c for c in out if c["name"] in only or c["name"].split("_s")[0] in only]
    return out, data.get("batch")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("conditions", help="a condition file, or a batch file {\"runs\": [...], \"seeds\": [...]}")
    ap.add_argument("--out", default=os.path.join("experiments", "runs"), help="output folder (relative to the repo root)")
    ap.add_argument("--browser", choices=sorted(shot.BROWSERS), default="chrome")
    ap.add_argument("--size", default="1280x800", help="viewport WxH (CSS px) unless the condition says")
    ap.add_argument("--seeds", default=None, help="comma-separated seeds: every condition once per seed")
    ap.add_argument("--only", default="", help="comma-separated condition names to run")
    ap.add_argument("--duration", type=float, default=0, help="override every condition's duration (simulated s)")
    ap.add_argument("--stall", type=float, default=60, help="wall s without simulation progress counted as a hang")
    ap.add_argument("--ready-timeout", type=float, default=60, help="wall s for the page to start")
    ap.add_argument("--strict", action="store_true", help="console errors also fail a run")
    ap.add_argument("--port", type=int, default=0, help="use an already running server on this port")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    seeds = [int(s) for s in args.seeds.split(",")] if args.seeds else None
    conds, batch = load_conditions(args.conditions, seeds, [s for s in args.only.split(",") if s])
    if args.duration:
        for c in conds:
            c["duration"] = args.duration
    out_dir = args.out if os.path.isabs(args.out) else os.path.join(REPO, args.out)
    os.makedirs(out_dir, exist_ok=True)
    server, port = None, args.port
    if not port:
        server = shot.Server(("127.0.0.1", 0), functools.partial(shot.QuietHandler, directory=REPO))
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        for c in conds:
            results.append(run_condition(c, out_dir, port, args))
    finally:
        if server:
            server.shutdown()
            server.server_close()
    print("\nbatch" + (f" {batch}" if batch else "") + ":")
    for m in results:
        print(f"  {m['name']:<32} {m['status']:<7} {m.get('sim_s', 0):>7} sim s  x{m.get('speed_reached')}  "
              f"{m.get('error', '')}")
    sys.exit(0 if all(m["status"] == "ok" for m in results) else 1)


if __name__ == "__main__":
    main()
