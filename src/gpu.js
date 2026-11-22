// WebGPU setup, shader loading and the plain on-screen messages (no WebGPU, device lost, shader errors).

const CPU_LOCAL = 'reference/neon_organoid_cpu.html';

// Support as published on web.dev (2025-11-25) and the gpuweb implementation-status wiki (edited 2026-10-02),
// cross-checked with caniuse.com/webgpu in 2026-11. Update when it changes.
const SUPPORT_HTML = `
  <ul>
    <li>Firefox 141+ on Windows; Firefox 147+ on Apple-silicon Macs</li>
    <li>Chrome or Edge 113+ on Windows, macOS and ChromeOS</li>
    <li>Chrome 121+ on Android 12+ (most phones with Qualcomm or ARM graphics)</li>
    <li>Safari 26 on macOS Tahoe, iOS 26 and iPadOS 26 (any browser on iPhone/iPad 26)</li>
  </ul>
  <p>Not yet by default: Firefox on Linux, Android and Intel Macs; Chrome on most Linux setups.</p>`;

const CPU_LINKS_HTML = `
  <p>The older CPU version runs in any browser:
  <a href="${CPU_LOCAL}">${CPU_LOCAL}</a></p>`;

export class GPUUnavailable extends Error {}

let messageShown = false;

/** Show a plain message over everything. kind: 'info' | 'error'. First message wins. */
export function showMessage(title, bodyHtml, kind = 'error') {
  if (messageShown) return;
  messageShown = true;
  const msg = document.getElementById('msg');
  document.getElementById('msgbox').innerHTML = `<h2>${escapeHtml(title)}</h2>${bodyHtml}`;
  msg.className = kind;
  msg.hidden = false;
}

export function messageIsShown() { return messageShown; }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The "this browser cannot do WebGPU" message, with a reason line. */
export function showNoWebGPU(reason) {
  showMessage('This page needs WebGPU',
    `<p>${escapeHtml(reason)}</p><p>WebGPU works in:</p>${SUPPORT_HTML}${CPU_LINKS_HTML}`, 'info');
}

/** Show an error with details in a small preformatted block and a reload button. */
export function showError(title, detail) {
  showMessage(title,
    `<pre>${escapeHtml(detail)}</pre><p><button onclick="location.reload()">Reload</button></p>${CPU_LINKS_HTML}`, 'error');
}

/**
 * Get adapter, device and a configured canvas context.
 * Throws GPUUnavailable (with a readable reason) when WebGPU is missing.
 * onLost(info) is called if the device is lost later (not when we destroy it ourselves).
 */
export async function initGPU(canvas, { onLost, forceFail = false } = {}) {
  if (forceFail) throw new GPUUnavailable('WebGPU was switched off for this test (?nogpu=1).');
  if (!window.isSecureContext) {
    throw new GPUUnavailable('This page is not in a secure context. Open it via http://localhost or https.');
  }
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new GPUUnavailable('This browser does not offer WebGPU (navigator.gpu is missing).');
  }
  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (e) {
    throw new GPUUnavailable(`Asking for a graphics adapter failed: ${e && e.message ? e.message : e}`);
  }
  if (!adapter) {
    throw new GPUUnavailable('WebGPU is present but no graphics adapter is available. ' +
      'Hardware acceleration may be off in the browser settings, or the GPU or driver is blocklisted.');
  }

  let device;
  try {
    device = await adapter.requestDevice({ label: 'moire-cells' });
  } catch (e) {
    throw new GPUUnavailable(`The graphics adapter refused to create a device: ${e && e.message ? e.message : e}`);
  }

  device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    if (onLost) onLost(info);
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new GPUUnavailable('The canvas could not create a WebGPU context.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  // adapter.info is the current API; requestAdapterInfo() is the older async one.
  let info = adapter.info;
  if (!info && adapter.requestAdapterInfo) {
    try { info = await adapter.requestAdapterInfo(); } catch { info = null; }
  }
  info = info || {};

  return {
    adapter, device, context, format,
    info: {
      vendor: info.vendor || '',
      architecture: info.architecture || '',
      device: info.device || '',
      description: info.description || '',
      isFallbackAdapter: !!(info.isFallbackAdapter ?? adapter.isFallbackAdapter),
    },
  };
}

/** A short human name for the adapter, from whatever the browser chose to reveal. */
export function adapterName(info) {
  if (info.description) return info.description;
  const parts = [info.vendor, info.architecture, info.device].filter(Boolean);
  if (parts.length) return parts.join(' ');
  // Firefox leaves all adapter.info fields empty; WebGL's renderer string is a hint (may be a different GPU)
  const gl = webglRenderer();
  return gl ? `${gl}  (WebGL's name; WebGPU hides it)` : 'unknown (the browser hides the adapter name)';
}

let webglName = null;
function webglRenderer() {
  if (webglName !== null) return webglName;
  webglName = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      webglName = String(gl.getParameter(gl.RENDERER) || '');
      if (!webglName || /^webkit/i.test(webglName)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) webglName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || webglName);
      }
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch { webglName = ''; }
  return webglName;
}

/**
 * Fetch a WGSL file and compile it. Throws an Error with readable compiler messages on failure.
 * Shared snippets can be prepended (plain text concatenation; no #include): either one `prefix` text named
 * `prefixName`, or a list `prefixes` of { name, text }. Messages point at the right file and line.
 */
// Step C12d: constants the page sets before any shader loads (e.g. ENG_COUNT, the engines a genome can name, which depends on the
// chemistry's table: ?electrons=0 has 20, the electrons' 22). A line `const NAME: u32 = ...;` in any shader text gets the value.
const SHADER_CONSTS = new Map();
export function setShaderConst(name, value) { SHADER_CONSTS.set(name, value); }
function patchConsts(code) {
  for (const [name, v] of SHADER_CONSTS) code = code.replace(new RegExp(`const ${name}: u32 = [0-9]+u;`, 'g'), `const ${name}: u32 = ${v >>> 0}u;`);
  return patchTanh(code);
}

// PORTABLE TANH (the user's phone, 2026-11-22: "some cells are super fast and even clip through walls, and some others are not mobile", on
// the phone only). WGSL's tanh is only as accurate as (e^2x - 1) / (e^2x + 1) (the spec's own error bound), and some GPUs and drivers
// compute it just so: past |x| ~ 44, e^2x overflows to infinity and tanh gives NaN (inf / inf) instead of 1. The shaders use tanh for every
// saturating response (pushes, smell, gates), often of large arguments (a steep gradient over a small saturation), so on such a GPU a cell
// gets a NaN force: its velocity and position turn NaN, the clamps put it on the dish's edge or let it through walls, and it never moves
// again or flies. So every tanh(x) in the shaders becomes tanh_p(x) = tanh(clamp(x, -15, 15)): the same result on a GPU that does it
// right (tanh(15) is 1 in f32), finite everywhere. ?tanh=raw: the shaders' own tanh (the old behaviour); ?tanh=naive: every tanh computed
// as (e^2x - 1) / (e^2x + 1), to see on a desktop what such a GPU does (a test).
const TANH_MODE = (() => {
  try { const m = new URLSearchParams(globalThis.location ? location.search : '').get('tanh'); return m === 'raw' || m === 'naive' ? m : 'safe'; } catch { return 'safe'; }
})();
export function tanhMode() { return TANH_MODE; }
// ... and the cells' step puts back a cell whose numbers still came out NaN or infinite (cell_step.wgsl GPU_GUARD; ?gpuguard=0: off)
const GPU_GUARD = (() => {
  try { return new URLSearchParams(globalThis.location ? location.search : '').get('gpuguard') !== '0'; } catch { return true; }
})();
SHADER_CONSTS.set('GPU_GUARD', GPU_GUARD ? 1 : 0);
export function gpuGuard() { return GPU_GUARD; }
function patchTanh(code) {
  if (TANH_MODE === 'raw' || !/\btanh\s*\(/.test(code)) return code;
  const body = TANH_MODE === 'naive'
    ? 'let e = exp(2.0 * x); return (e - 1.0) / (e + 1.0);'
    : 'return tanh(clamp(x, -15.0, 15.0));';
  return code.replace(/\btanh\s*\(/g, 'tanh_p(') + `\n// (src/gpu.js patchTanh, ?tanh=${TANH_MODE})\nfn tanh_p(x: f32) -> f32 { ${body} }\n`;
}

export async function loadShader(device, url, { prefix = '', prefixName = 'prefix', prefixes = null } = {}) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load shader ${url}: HTTP ${res.status}`);
  const parts = prefixes || (prefix ? [{ name: prefixName, text: prefix }] : []);
  // first line (1-based) of each prefix in the joined code
  const spans = [];
  let line = 1;
  for (const p of parts) { spans.push({ name: p.name, from: line }); line += p.text.split('\n').length - 1; }
  const bodyFrom = line;
  const code = patchConsts(parts.map((p) => p.text).join('') + (await res.text()));
  const module = device.createShaderModule({ label: url, code });
  const ci = await module.getCompilationInfo();
  const errors = ci.messages.filter((m) => m.type === 'error');
  // "file:line" of a message, in a prefix or in the file itself
  const where = (m) => {
    if (m.lineNum >= bodyFrom) return `${url}:${m.lineNum - bodyFrom + 1}:${m.linePos}`;
    let sp = spans[0];
    for (const s of spans) if (m.lineNum >= s.from) sp = s;
    return `${sp.name}:${m.lineNum - sp.from + 1}:${m.linePos}`;
  };
  for (const m of ci.messages) {
    if (m.type !== 'error') console.warn(`${where(m)} ${m.type}: ${m.message}`);
  }
  if (errors.length) {
    const lines = code.split('\n');
    const text = errors.map((m) => {
      const src = lines[m.lineNum - 1] ?? '';
      return `${where(m)}  ${m.message}\n    ${src.trim()}`;
    }).join('\n');
    const err = new Error(text);
    err.shaderError = true;
    throw err;
  }
  return module;
}
