// Step C3b: record the dish as a video file. Only the dish (the WebGPU canvas) is recorded, never the DOM panels.
//
// Each drawn frame is copied, right after it is submitted, into a plain 2D canvas at the page's CSS size (so a
// high-density screen does not make a huge file; at most 1920 px on the long side, even sizes for the encoders), and
// that canvas is captured (canvas.captureStream) and encoded by MediaRecorder: WebM with VP9 or VP8 where the browser
// has it (Firefox, Chrome, Edge), MP4 otherwise (Safari). Stopping saves the file through a download link, named
// moire-cells-YYYY-MM-DD-HHMM.webm (local time).

const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
const MAX_SIDE = 1920;

export class Recorder {
  constructor(source) {
    this.source = source;   // the WebGPU canvas
    this.rec = null;
    this.t0 = 0;
    this.type = Recorder.type();
  }

  /** The video type this browser can record, or '' if it cannot record a canvas at all. */
  static type() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
    if (!MediaRecorder.isTypeSupported) return 'video/webm';
    return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  get supported() { return !!this.type; }
  get on() { return !!this.rec; }
  /** Seconds since the recording started. */
  get elapsed() { return this.rec ? (performance.now() - this.t0) / 1000 : 0; }

  /** Start recording a picture of cssW x cssH (the dish's size in CSS px). */
  start(cssW, cssH) {
    if (this.rec || !this.type) return false;
    const k = Math.min(1, MAX_SIDE / Math.max(cssW, cssH));
    const w = Math.max(2, Math.round(cssW * k / 2) * 2), h = Math.max(2, Math.round(cssH * k / 2) * 2);
    const mirror = document.createElement('canvas');
    mirror.width = w; mirror.height = h;
    const ctx = mirror.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);
    const stream = mirror.captureStream(60);
    // about 8 Mbit/s for 1080p, scaled by the area (the halftone dots are fine detail)
    const bits = Math.round(Math.max(3e6, Math.min(12e6, 8e6 * (w * h) / (1920 * 1080))));
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: bits });
    } catch (e) {
      rec = new MediaRecorder(stream);   // a browser that refuses the options: its own defaults
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      this.save(new Blob(chunks, { type: rec.mimeType || this.type }));
    };
    rec.start(1000);   // a chunk every second, so a long recording does not sit in one huge buffer
    Object.assign(this, { rec, mirror, ctx, w, h, t0: performance.now(), bits });
    return true;
  }

  /** Copy the frame just drawn (call right after the frame's submit, in the same task). */
  capture() {
    if (!this.rec) return;
    this.ctx.drawImage(this.source, 0, 0, this.w, this.h);
  }

  stop() {
    if (!this.rec) return;
    const rec = this.rec;
    this.rec = null;
    if (rec.state !== 'inactive') rec.stop();
  }

  save(blob) {
    this.lastSize = blob.size;
    this.lastBlob = blob;   // kept for checks from the console (moire.recorder.lastBlob)
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    const name = `moire-cells-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
    this.lastName = name;
    if (this.noDownload) return;   // tools/experiment.py takes lastBlob itself
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (this.onSaved) this.onSaved(name, blob.size);
  }
}
