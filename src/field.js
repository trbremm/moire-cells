// The shared field machinery: the medium's lattice, the emitter layout, and shader loading with
// field_common.wgsl in front.
//
// Any shader that evaluates the field (drawing it now, cells sensing it later) is loaded with loadFieldShader,
// which prepends src/shaders/field_common.wgsl, so every pass uses the same lattice / beat / envelope maths.
//
// Medium is a layer (resize / compute / render, like the others in main.js): it holds the reference's scale R,
// the dish centre and the medium lattice, and writes them to a small uniform buffer once per frame.
// It must come before every layer that reads the field.

import { loadShader } from './gpu.js';
import { dish } from './dish.js';

export const COMMON_URL = 'src/shaders/field_common.wgsl';

// emitter kinds, as in field_common.wgsl: since step F0 only the cells' (Cell.kind is always 0; kinds 1..4 were the fates). (The
// reference's nutrient and threat sources, kinds 5 and 6, were removed in step C3: springs of atoms took their place.)
export const KIND = { STEM: 0 };

const texts = new Map();
async function shaderText(url) {
  if (!texts.has(url)) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${url}: HTTP ${res.status}`);
    texts.set(url, (await res.text()).replace(/\s*$/, '\n\n'));
  }
  return texts.get(url);
}

/**
 * Load a WGSL file with field_common.wgsl prepended, and after it any `extra` shared files (e.g. the cells'
 * cell_common.wgsl). Errors in any of them name the right file and line.
 */
export async function loadFieldShader(device, url, extra = []) {
  const names = [COMMON_URL, ...extra];
  const prefixes = await Promise.all(names.map(async (name) => ({ name, text: await shaderText(name) })));
  return loadShader(device, url, { prefixes });
}

export class Medium {
  constructor(device) {
    this.device = device;
    this.R = 9;           // the reference's cell radius in CSS px (5 to 9, from the screen area)
    this.k0 = 1;
    this.la0 = 0;
    this.cx = 0; this.cy = 0;
    this.params = {
      breathe: 0.02,      // amplitude of the medium lattice's slow turning (radians; 0.02 = about 1 degree)
      breatheRate: 0.05,  // radians of phase per simulation second
    };
    this.buffer = device.createBuffer({
      label: 'medium', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.data = new Float32Array(4);
  }

  resize(view) {
    const { cssW: W, cssH: H } = view;
    // as in the reference's resize(): R from the screen area; medium period 0.62 R. Now the dish's (src/dish.js): KAPPA x the cells' R,
    // fixed with the dish, so the moire beats keep their size in cell units (?dishfollow=1 and old snapshots: the old rule, from the area)
    this.R = dish.mR > 0 ? dish.mR : Math.max(5, Math.min(9, Math.sqrt(W * H / (420 * Math.PI * 3.6))));
    this.k0 = 2 * Math.PI / (0.62 * this.R);
    this.cx = W / 2; this.cy = H / 2;
  }

  compute(encoder, frame) {
    this.la0 = this.params.breathe * Math.sin(frame.time * this.params.breatheRate);
    const a = this.data;
    a[0] = this.cx; a[1] = this.cy; a[2] = this.k0; a[3] = this.la0;
    this.device.queue.writeBuffer(this.buffer, 0, a);
  }

  render() {}
}
