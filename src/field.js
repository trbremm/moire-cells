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

export const COMMON_URL = 'src/shaders/field_common.wgsl';

// emitter kinds, numbered as in the reference and in field_common.wgsl
export const KIND = { STEM: 0, EPI: 1, MUS: 2, NEU: 3, CHO: 4, NUT: 5, THR: 6 };

// struct Emitter in field_common.wgsl: pos.xy, la, amp, r0sq, fa, fb, fd, kind (u32), pad = 10 x 4 bytes
export const EMITTER_FLOATS = 10;
export const EMITTER_BYTES = EMITTER_FLOATS * 4;
// struct Beat in field_common.wgsl: 14 x 4 bytes
export const BEAT_BYTES = 56;

/**
 * Write one emitter into a Float32Array/Uint32Array pair viewing the same buffer, at slot i.
 * e = { x, y, la, amp, r0sq, kind, fa?, fb?, fd? }  (no stretch = identity)
 */
export function writeEmitter(f32, u32, i, e) {
  const o = i * EMITTER_FLOATS;
  f32[o] = e.x; f32[o + 1] = e.y; f32[o + 2] = e.la; f32[o + 3] = e.amp; f32[o + 4] = e.r0sq;
  f32[o + 5] = e.fa ?? 1; f32[o + 6] = e.fb ?? 0; f32[o + 7] = e.fd ?? 1;
  u32[o + 8] = e.kind; u32[o + 9] = 0;
}

let commonText = null;
/** Load a WGSL file with field_common.wgsl prepended (errors in either file name the right file and line). */
export async function loadFieldShader(device, url) {
  if (commonText === null) {
    const res = await fetch(COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${COMMON_URL}: HTTP ${res.status}`);
    commonText = (await res.text()).replace(/\s*$/, '\n\n');
  }
  return loadShader(device, url, { prefix: commonText, prefixName: COMMON_URL });
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
    // as in the reference's resize(): R from the screen area; medium period 0.62 R
    this.R = Math.max(5, Math.min(9, Math.sqrt(W * H / (420 * Math.PI * 3.6))));
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
