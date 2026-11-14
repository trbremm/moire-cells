// WebGPU setup, shader loading and the plain on-screen messages (no WebGPU, device lost, shader errors).

const CPU_LOCAL = 'reference/neon_organoid_cpu.html';
const CPU_ONLINE = 'https://claude.ai/artifact/ByKBbzmVQTh8MpmKzbg3rT';

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
  <a href="${CPU_LOCAL}">local copy</a> ·
  <a href="${CPU_ONLINE}" target="_blank" rel="noopener">online</a></p>`;

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
 * Shared snippets can be prepended via `prefix` (plain text concatenation; no #include); `prefixName` is the
 * file the prefix came from, so messages point at the right file and line.
 */
export async function loadShader(device, url, { prefix = '', prefixName = 'prefix' } = {}) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load shader ${url}: HTTP ${res.status}`);
  const code = prefix + (await res.text());
  const module = device.createShaderModule({ label: url, code });
  const ci = await module.getCompilationInfo();
  const errors = ci.messages.filter((m) => m.type === 'error');
  const prefixLines = prefix ? prefix.split('\n').length - 1 : 0;
  // "file:line" of a message, in the prefix or in the file itself
  const where = (m) => (m.lineNum <= prefixLines
    ? `${prefixName}:${m.lineNum}:${m.linePos}`
    : `${url}:${m.lineNum - prefixLines}:${m.linePos}`);
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
