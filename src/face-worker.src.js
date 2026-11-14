// Lumio: face tracking in a background thread, so the camera screen never waits for it.
// Built (with MediaPipe Tasks Vision, Apache-2.0) into lib/face-worker.js:
//   npx esbuild src/face-worker.src.js --bundle --format=iife --minify --outfile=lib/face-worker.js
// A classic (non-module) worker, because MediaPipe loads its wasm loader with importScripts.
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

let lm = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const files = await FilesetResolver.forVisionTasks(m.wasm);
      let err = null, used = '';
      for (const delegate of ['GPU', 'CPU']) {
        try {
          const opts = { baseOptions: { modelAssetPath: m.model, delegate }, runningMode: 'VIDEO', numFaces: 1 };
          if (delegate === 'GPU') opts.canvas = new OffscreenCanvas(1, 1);
          lm = await FaceLandmarker.createFromOptions(files, opts); used = delegate; break;
        } catch (x) { err = x; }
      }
      if (!lm) throw err || new Error('face');
      self.postMessage({ type: 'ready', delegate: used });
    } catch (x) { self.postMessage({ type: 'error', msg: String(x && x.message || x) }); }
    return;
  }
  if (m.type === 'frame') {
    let out = null;
    try {
      const r = lm && lm.detectForVideo(m.bitmap, m.ts);
      const l = r && r.faceLandmarks && r.faceLandmarks[0];
      if (l) { out = new Float32Array(l.length * 3); l.forEach((p, i) => { out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; }); }
    } catch (x) { out = null; }
    m.bitmap.close();
    self.postMessage({ type: 'lm', id: m.id, lm: out }, out ? [out.buffer] : []);
  }
};
