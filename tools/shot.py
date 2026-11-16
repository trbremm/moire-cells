"""Headless screenshots of the page with WebGPU running, for checking the look without a browser tool.

Python standard library only. Starts its own static server on a free port in the repo root, launches the
browser headless with a throwaway profile, drives it over its debugging websocket (Chrome/Edge: DevTools
protocol; Firefox: WebDriver BiDi), waits in REAL time until the page reports it is running, optionally
sends input, waits a bit more, saves a PNG and prints the page's console output and on-screen messages.

Why not `chrome --screenshot --virtual-time-budget`: virtual time races ahead while the page waits for the
GPU, so the shot is taken before WebGPU has even created a device. Real waiting avoids that.

Usage:
    python tools/shot.py                                   # Chrome, index.html?overlay=1&ripple=1 -> shots/shot.png
    python tools/shot.py --browser edge
    python tools/shot.py --headed                          # Firefox in a real window (shows for a few seconds)
    python tools/shot.py --wait 4000 --out shots/later.png # let it run 4 s after it started
    python tools/shot.py --key f                           # press F (toggles the overlay)
    python tools/shot.py --key shift+h                     # Shift + a letter (the Part C keys); shift+4: Shift + a digit
    python tools/shot.py --click 640,400 --drag 200,600,900,500
    python tools/shot.py --rdrag 640,400,500,300 --wheel 640,400,600 --wheel 640,400,300,shift   # right-drag, wheel
    python tools/shot.py --eval "window.someTweak = 1"      # any JS before waiting
    python tools/shot.py --query speed=8 --at 5,30,90      # a series at these SIMULATION times (s):
                                                           # shots/shot_t5.png, shots/shot_t30.png, ...
    python tools/shot.py --page reference/neon_organoid_cpu.html --query ""
    python tools/shot.py --query nogpu=1                   # see the no-WebGPU message
    python tools/shot.py --mobile                          # a phone: 390x844, 3 device px per CSS px, touch (Chrome)
    python tools/shot.py --mobile --tapel "[data-panel=rules]" --tap 200,300   # finger taps: on a button, on the dish

The page signals progress through <body data-stage="...">; the tool waits for a stage starting with
'running-10' (ten frames drawn) or for the message box (#msg) to appear. Pages without data-stage
(e.g. the CPU reference) are shot --wait ms after load.

Tested 2026-11-14 on Windows 11: headless Chrome and Edge render WebGPU. Headless Firefox (160) offers
navigator.gpu but requestAdapter() returns null whatever the prefs, so Firefox needs --headed (the window
appears on screen while the shot is taken; a throwaway profile is used and removed afterwards).
"""

import argparse
import base64
import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BROWSERS = {
    "firefox": [
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
    ],
    "chrome": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ],
    "edge": [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
}

# Chrome flags: WebGPU on in headless, real GPU (headless otherwise may pick a software path).
CHROME_GPU_FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"]

# Firefox prefs written into the throwaway profile's user.js.
FIREFOX_PREFS = {
    "dom.webgpu.enabled": True,             # default on Windows since 141; set anyway
    "gfx.webgpu.ignore-blocklist": True,
    "browser.shell.checkDefaultBrowser": False,
    "browser.startup.homepage_override.mstone": "ignore",
    "datareporting.policy.dataSubmissionEnabled": False,
    "toolkit.telemetry.reportingpolicy.firstRun": False,
    "remote.active-protocols": 1,           # WebDriver BiDi only
}

STATE_JS = """(() => {
  const m = document.getElementById('msg');
  const o = document.getElementById('overlay');
  const en = document.getElementById('entropy');
  return JSON.stringify({
    entropy: en && !en.hidden ? en.innerText : '',
    ready: document.readyState,
    stage: (document.body && document.body.dataset.stage) || '',
    msg: m && !m.hidden ? m.innerText : '',
    overlay: o && !o.hidden ? o.innerText : '',
  });
})()"""


# ---------------------------------------------------------------- static server
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".wgsl": "text/plain"}

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # the page asks for about 30 modules and shaders at once; with the default backlog of 5, Windows refuses some
    # connections (ERR_CONNECTION_REFUSED) and the page does not start
    request_queue_size = 128


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ---------------------------------------------------------------- minimal websocket client (RFC 6455)
class WebSocket:
    def __init__(self, host, port, path, timeout=30):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("websocket handshake: connection closed")
            buf += chunk
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("websocket handshake failed: " + head.decode(errors="replace")[:300])

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def send(self, text):
        self._send_frame(0x1, text.encode())

    def recv(self):
        parts = []
        while True:
            b0, b1 = self._read(2)
            opcode, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 0x9:
                self._send_frame(0xA, data)
                continue
            if opcode == 0x8:
                raise ConnectionError("websocket closed by browser")
            if opcode in (0x0, 0x1, 0x2):
                parts.append(data)
                if b0 & 0x80:
                    return b"".join(parts).decode(errors="replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Rpc:
    """JSON request/response over a websocket; events are collected in self.events."""

    def __init__(self, ws):
        self.ws, self.next_id, self.events = ws, 1, []

    def call(self, method, params=None, timeout=30):
        mid = self.next_id
        self.next_id += 1
        self.ws.sock.settimeout(timeout)
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg.get('error')} {msg.get('message', '')}")
                return msg.get("result", {})
            self.events.append(msg)


# ---------------------------------------------------------------- browser drivers
class Chrome:
    """Chrome / Edge via the DevTools protocol."""

    def __init__(self, exe, profile, w, h, extra, dpr=1.0, mobile=False):
        self.proc = subprocess.Popen(
            [exe, "--headless=new", f"--user-data-dir={profile}", "--remote-debugging-port=0",
             "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
             f"--window-size={w},{h}", *CHROME_GPU_FLAGS, *extra, "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file, port = os.path.join(profile, "DevToolsActivePort"), None
        for _ in range(300):
            try:
                with open(port_file) as f:
                    port = int(f.read().split()[0])
                break
            except (OSError, ValueError, IndexError):   # not written yet, or still locked
                time.sleep(0.05)
        if port is None:
            raise RuntimeError("Chrome did not open a debugging port")
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
        page = next(t for t in targets if t["type"] == "page")
        path = page["webSocketDebuggerUrl"].split(str(port), 1)[1]
        self.rpc = Rpc(WebSocket("127.0.0.1", port, path))
        for dom in ("Runtime", "Log", "Page"):
            self.rpc.call(f"{dom}.enable")
        # exact viewport (--window-size includes the window frame)
        self.rpc.call("Emulation.setDeviceMetricsOverride",
                      {"width": w, "height": h, "deviceScaleFactor": dpr, "mobile": mobile})
        if mobile:
            # a phone: touch only (the page's (any-pointer: fine) is false), taps arrive as touch pointer events
            self.rpc.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            self.rpc.call("Emulation.setEmitTouchEventsForMouse", {"enabled": True, "configuration": "mobile"})

    def tap(self, x, y):
        """A finger tap at (x, y) CSS px (real touch input, through the browser's hit testing)."""
        self.rpc.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        time.sleep(0.05)
        self.rpc.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def navigate(self, url):
        self.rpc.call("Page.navigate", {"url": url})

    def eval(self, js):
        r = self.rpc.call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("text", "") + " " +
                               str(r["exceptionDetails"].get("exception", {}).get("description", "")))
        return r.get("result", {}).get("value")

    def screenshot(self, clip=None):
        p = {"format": "png"}
        if clip:
            x, y, w, h, sc = clip
            p["clip"] = {"x": x, "y": y, "width": w, "height": h, "scale": sc}
        return base64.b64decode(self.rpc.call("Page.captureScreenshot", p, timeout=60)["data"])

    def logs(self):
        out = []
        for e in self.rpc.events:
            m, p = e.get("method"), e.get("params", {})
            if m == "Runtime.consoleAPICalled":
                out.append(f"console.{p.get('type')}: " + " ".join(
                    str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))
            elif m == "Runtime.exceptionThrown":
                d = p.get("exceptionDetails", {})
                out.append("exception: " + str(d.get("exception", {}).get("description", d.get("text"))))
            elif m == "Log.entryAdded":
                en = p.get("entry", {})
                out.append(f"log.{en.get('level')}: {en.get('text')}")
        return out

    def quit(self):
        try:
            self.rpc.call("Browser.close", timeout=5)
        except Exception:
            pass
        self.rpc.ws.close()
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


class Firefox:
    """Firefox via WebDriver BiDi."""

    def __init__(self, exe, profile, w, h, extra, prefs=None, headed=False):
        with open(os.path.join(profile, "user.js"), "w") as f:
            for k, v in {**FIREFOX_PREFS, **(prefs or {})}.items():
                f.write(f'user_pref("{k}", {json.dumps(v)});\n')
        port = free_port()
        self.proc = subprocess.Popen(
            [exe, *([] if headed else ["-headless"]), "-no-remote", "-profile", profile, f"--remote-debugging-port={port}",
             f"--window-size={w},{h}", *extra, "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ws = None
        for _ in range(300):
            try:
                ws = WebSocket("127.0.0.1", port, "/session")
                break
            except (OSError, ConnectionError):
                time.sleep(0.1)
        if ws is None:
            raise RuntimeError("could not connect to Firefox's BiDi port")
        self.rpc = Rpc(ws)
        self.rpc.call("session.new", {"capabilities": {}})
        tree = self.rpc.call("browsingContext.getTree", {})
        self.ctx = tree["contexts"][0]["context"]
        self.rpc.call("browsingContext.setViewport", {"context": self.ctx, "viewport": {"width": w, "height": h}})
        self.rpc.call("session.subscribe", {"events": ["log.entryAdded"]})

    def navigate(self, url):
        self.rpc.call("browsingContext.navigate", {"context": self.ctx, "url": url, "wait": "complete"}, timeout=60)

    def eval(self, js):
        r = self.rpc.call("script.evaluate", {"expression": js, "target": {"context": self.ctx},
                                              "awaitPromise": False})
        if r.get("type") == "exception":
            raise RuntimeError(r.get("exceptionDetails", {}).get("text", "exception"))
        return r.get("result", {}).get("value")

    def tap(self, x, y):
        """A tap at (x, y) CSS px, as page-side touch pointer events (and a click) on the element there."""
        self.eval(f"""(() => {{ const el = document.elementFromPoint({x}, {y}); if (!el) return;
          const o = {{clientX: {x}, clientY: {y}, pointerId: 7, bubbles: true, isPrimary: true, pointerType: 'touch', button: 0}};
          el.dispatchEvent(new PointerEvent('pointerdown', {{...o, buttons: 1}}));
          el.dispatchEvent(new PointerEvent('pointerup', {{...o, buttons: 0}}));
          el.dispatchEvent(new MouseEvent('click', {{clientX: {x}, clientY: {y}, bubbles: true}})); }})()""")

    def screenshot(self, clip=None):
        p = {"context": self.ctx}
        if clip:
            x, y, w, h, _ = clip
            p["clip"] = {"type": "box", "x": x, "y": y, "width": w, "height": h}
        r = self.rpc.call("browsingContext.captureScreenshot", p, timeout=60)
        return base64.b64decode(r["data"])

    def logs(self):
        out = []
        for e in self.rpc.events:
            if e.get("method") == "log.entryAdded":
                p = e.get("params", {})
                out.append(f"{p.get('type')}.{p.get('level')}: {p.get('text')}")
        return out

    def quit(self):
        try:
            self.rpc.call("browser.close", timeout=5)
        except Exception:
            pass
        self.rpc.ws.close()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


# ---------------------------------------------------------------- synthetic input (page-side events)
def key_js(k):
    shift = k.lower().startswith("shift+") and len(k) > 6
    code = ""
    if shift:
        k = k[6:].upper()
        if k.isdigit():   # Shift + a digit key: the symbol a US keyboard types, and the key's place (e.code)
            code = f", code: 'Digit{k}'"
            k = "!@#$%^&*()"[(int(k) + 9) % 10]
    opts = f"{{key: {json.dumps(k)}, shiftKey: {'true' if shift else 'false'}{code}, bubbles: true}}"
    return (f"window.dispatchEvent(new KeyboardEvent('keydown', {opts}));"
            f"window.dispatchEvent(new KeyboardEvent('keyup', {opts}));")


def pointer_js(points, button=0):
    """Pointer down at the first point, moves through the rest, up at the last (CSS pixels). button 2 = right."""
    pts = json.dumps(points)
    held = 2 if button == 2 else 1
    return f"""(() => {{
      const c = document.querySelector('canvas'); const pts = {pts};
      const ev = (t, p) => c.dispatchEvent(new PointerEvent(t, {{clientX: p[0], clientY: p[1], pointerId: 1,
        bubbles: true, isPrimary: true, pointerType: 'mouse', button: t === 'pointermove' ? -1 : {button},
        buttons: t === 'pointerup' ? 0 : {held}}}));
      ev('pointerdown', pts[0]); for (const p of pts.slice(1)) ev('pointermove', p); ev('pointerup', pts[pts.length - 1]);
    }})()"""


def wheel_js(x, y, dy, shift, alt=False):
    """One wheel event at (x, y) CSS px: dy pixels (100 = about one notch; negative = up), with Shift or Alt if asked."""
    return (f"document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {{clientX: {x}, clientY: {y}, "
            f"deltaY: {dy}, deltaMode: 0, shiftKey: {'true' if shift else 'false'}, altKey: {'true' if alt else 'false'}, bubbles: true, cancelable: true}}));")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--browser", choices=sorted(BROWSERS), default="chrome")
    ap.add_argument("--page", default="index.html", help="page path relative to the repo root")
    ap.add_argument("--query", default="overlay=1&ripple=1", help="URL query string without '?'")
    ap.add_argument("--out", default=os.path.join("shots", "shot.png"), help="PNG path (relative to repo root)")
    ap.add_argument("--size", default="", help="viewport WxH in CSS pixels (default 1280x800; with --mobile 390x844)")
    ap.add_argument("--mobile", action="store_true", help="a phone: 390x844 unless --size, 3 device px per CSS px unless "
                    "--dpr, touch only (Chrome/Edge; Firefox gets only the size)")
    ap.add_argument("--tap", action="append", default=[], help="finger tap at x,y (CSS px; repeatable; after the clicks)")
    ap.add_argument("--tapel", action="append", default=[], help="finger tap on the centre of the element matching this "
                                                                "CSS selector, e.g. [data-panel=rules] (repeatable; before --tap)")
    ap.add_argument("--dpr", type=float, default=0, help="device pixel ratio (Chrome/Edge; the page draws at up to 2, "
                    "so --dpr 2 with --clip x,y,w,h,2 gives a sharp zoom)")
    ap.add_argument("--wait", type=int, default=2500, help="ms to let the page run after it is ready")
    ap.add_argument("--ready-timeout", type=int, default=30000, help="ms to wait for the page to start")
    ap.add_argument("--port", type=int, default=0, help="use an already running server on this port")
    ap.add_argument("--key", action="append", default=[], help="press a key after start (repeatable)")
    ap.add_argument("--click", action="append", default=[], help="click at x,y (CSS px; repeatable)")
    ap.add_argument("--drag", action="append", default=[], help="drag x1,y1,x2,y2 (CSS px; repeatable)")
    ap.add_argument("--rdrag", action="append", default=[], help="right-button drag x1,y1,x2,y2 (CSS px; repeatable)")
    ap.add_argument("--wheel", action="append", default=[], help="wheel x,y,dy[,shift] (dy 100 = one notch down; "
                                                                 "repeatable)")
    ap.add_argument("--eval", action="append", default=[], help="run JS in the page after start (repeatable)")
    ap.add_argument("--extra", action="append", default=[], help="extra browser flag (repeatable; use --extra=--flag)")
    ap.add_argument("--pref", action="append", default=[], help="Firefox pref name=json_value (repeatable)")
    ap.add_argument("--headed", action="store_true",
                    help="Firefox in a real (visible) window; implies --browser firefox (headless Firefox has no WebGPU)")
    ap.add_argument("--quiet", action="store_true", help="do not print console lines")
    ap.add_argument("--clip", default="", help="x,y,w,h[,scale]: shoot only this part of the page (CSS px), "
                                               "enlarged by scale (Chrome/Edge only)")
    ap.add_argument("--at", default="", help="comma-separated simulation times (s, from moire.time()): one shot "
                                             "each, named <out>_t<time>.png; replaces --wait")
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):   # the panel's arrows and dots on a Windows console
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    if args.headed:
        args.browser = "firefox"
    out = args.out if os.path.isabs(args.out) else os.path.join(REPO, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    w, h = (int(v) for v in (args.size or ("390x844" if args.mobile else "1280x800")).lower().split("x"))
    args.dpr = args.dpr or (3.0 if args.mobile else 1.0)

    server, port = None, args.port
    if not port:
        server = Server(("127.0.0.1", 0), functools.partial(QuietHandler, directory=REPO))
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://localhost:{port}/{args.page}" + (f"?{args.query}" if args.query else "")

    exe = next((p for p in BROWSERS[args.browser] if os.path.exists(p)), None)
    if not exe:
        sys.exit(f"{args.browser} not found; tried {BROWSERS[args.browser]}")
    profile = tempfile.mkdtemp(prefix=f"moire-shot-{args.browser}-")
    driver = None
    status = 0
    try:
        if args.browser == "firefox":
            prefs = {k: json.loads(v) for k, v in (p.split("=", 1) for p in args.pref)}
            driver = Firefox(exe, profile, w, h, args.extra, prefs, args.headed)
        else:
            driver = Chrome(exe, profile, w, h, args.extra, args.dpr, args.mobile)
        driver.navigate(url)

        t0, state = time.time(), {}
        while time.time() - t0 < args.ready_timeout / 1000:
            state = json.loads(driver.eval(STATE_JS) or "{}")
            if state.get("msg") or state.get("stage", "").startswith("running-10"):
                break
            if not state.get("stage") and state.get("ready") == "complete" and time.time() - t0 > 0.5:
                break   # a page without stage markers
            time.sleep(0.1)
        print(f"started after {time.time() - t0:.1f} s, stage '{state.get('stage', '')}'")

        for k in args.key:
            driver.eval(key_js(k))
        for c in args.click:
            x, y = (float(v) for v in c.split(","))
            driver.eval(pointer_js([[x, y]]))
        for d in args.drag:
            x1, y1, x2, y2 = (float(v) for v in d.split(","))
            driver.eval(pointer_js([[x1 + (x2 - x1) * i / 24, y1 + (y2 - y1) * i / 24] for i in range(25)]))
        for d in args.rdrag:
            x1, y1, x2, y2 = (float(v) for v in d.split(","))
            driver.eval(pointer_js([[x1 + (x2 - x1) * i / 24, y1 + (y2 - y1) * i / 24] for i in range(25)], button=2))
        for wspec in args.wheel:
            v = wspec.split(",")
            driver.eval(wheel_js(float(v[0]), float(v[1]), float(v[2]), len(v) > 3 and v[3].lower() in ("1", "shift", "true"),
                                len(v) > 3 and v[3].lower() == "alt"))
        for js in args.eval:
            driver.eval(js)
        for sel in args.tapel:
            r = driver.eval(f"(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e) return ''; "
                            f"const r = e.getBoundingClientRect(); return (r.x + r.width / 2) + ',' + (r.y + r.height / 2); }})()")
            if not r:
                print(f"--tapel: nothing matches {sel}")
                continue
            x, y = (float(v) for v in r.split(","))
            driver.tap(x, y)
            time.sleep(0.15)
        for t in args.tap:
            x, y = (float(v) for v in t.split(","))
            driver.tap(x, y)
            time.sleep(0.15)

        clip = [float(v) for v in args.clip.split(",")] if args.clip else None
        if clip and len(clip) == 4:
            clip.append(1.0)

        def shoot(path):
            st = json.loads(driver.eval(STATE_JS) or "{}")
            with open(path, "wb") as f:
                f.write(driver.screenshot(clip))
            return st

        if args.at:
            stem, ext = os.path.splitext(out)
            for t in (float(v) for v in args.at.split(",")):
                t_start = time.time()
                while True:
                    now = float(driver.eval("String(window.moire && window.moire.time ? window.moire.time() : 0)") or 0)
                    if now >= t or time.time() - t_start > t + 60:
                        break
                    time.sleep(0.05)
                path = f"{stem}_t{t:g}{ext}"
                state = shoot(path)
                ov = state.get("overlay", "")
                print(f"t={now:.1f} s -> {path}")
                for line in state.get("entropy", "").splitlines():
                    print("  | " + line)
                for line in ov.splitlines():
                    print("  " + line)
        else:
            time.sleep(args.wait / 1000)
            state = shoot(out)

        print(f"browser {args.browser}  url {url}")
        print(f"stage   {state.get('stage', '')}")
        if state.get("entropy"):
            print("entropy panel:\n  " + state["entropy"].replace("\n", "\n  "))
        if state.get("overlay"):
            print("overlay:\n  " + state["overlay"].replace("\n", "\n  "))
        if state.get("msg"):
            print("MESSAGE ON PAGE:\n  " + state["msg"].replace("\n", "\n  "))
        if not args.quiet:
            for line in driver.logs():
                print("  " + line[:400])
        print(f"wrote {out}")
    except Exception as e:  # noqa: BLE001  report and fail
        print(f"FAILED: {type(e).__name__}: {e}")
        status = 1
    finally:
        if driver:
            driver.quit()
        if server:
            server.shutdown()
        time.sleep(0.3)
        shutil.rmtree(profile, ignore_errors=True)
    sys.exit(status)


if __name__ == "__main__":
    main()
