// Lamha 3D face effects: real 3D glasses and cap that follow the head.
// Built with three.js (MIT) into lib/fx3d.js:
//   npx esbuild src/fx3d.src.js --bundle --format=esm --minify --outfile=lib/fx3d.js
//
// How it works
// - Face landmarks (x, y, z) from MediaPipe give a head frame: right (eye to eye),
//   up (chin to forehead) and forward (toward the camera); scale = face width.
// - Models are built in "face width" units around an anchor point on the face, drawn with
//   an orthographic camera in screen pixels, so they land exactly on the face.
// - An invisible head shape writes depth only, so temple arms and the back of the cap
//   disappear behind the head as it turns.
// - Lenses reflect the live camera picture; light brightness and tint follow the room.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer, scene, camera, pmrem, hemi, key, fill;
let videoEnv = null, envCanvas = null, envTex = null;
const groups = {};
const mats = {};

function canvasTex(w, h, paint, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
// fine woven-fabric bumps for the cap
function fabricNormal() {
  return canvasTex(256, 256, (x, w, h) => {
    const d = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const k = (y * w + i) * 4, a = Math.sin(i * 1.6) * .5 + Math.sin(y * 1.6 + (i % 4 < 2 ? 1.5 : 0)) * .5, n = (Math.random() - .5) * 18;
      d.data[k] = 128 + a * 22 + n; d.data[k + 1] = 128 + Math.cos(y * 1.6) * 22 + n; d.data[k + 2] = 255; d.data[k + 3] = 255;
    }
    x.putImageData(d, 0, 0);
  }, false);
}
// cap panels: seams + stitching + a small embroidered sparkle on the front
function capTexture(color) {
  return canvasTex(1024, 512, (x, w, h) => {
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const u = (i / 6 + .25 / 6) * w;
      x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 5; x.beginPath(); x.moveTo(u, 0); x.lineTo(u, h); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1.5; x.setLineDash([6, 6]);
      for (const o of [-9, 9]) { x.beginPath(); x.moveTo(u + o, 30); x.lineTo(u + o, h); x.stroke(); }
      x.setLineDash([]);
    }
    for (let r = 0; r < 4; r++) { x.strokeStyle = 'rgba(255,255,255,.1)'; x.setLineDash([5, 6]); x.beginPath(); x.moveTo(0, h - 18 - r * 9); x.lineTo(w, h - 18 - r * 9); x.stroke(); }
    x.setLineDash([]);
    // embroidered sparkle (Lamha mark) on the front panel, u = .25
    const cx = w * .25, cy = h * .58, R = 46;
    x.fillStyle = '#f5f5f5'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 3; x.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? R * .28 : R; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    x.closePath(); x.fill(); x.shadowBlur = 0;
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1; for (let k = -R; k < R; k += 4) { x.beginPath(); x.moveTo(cx + k, cy - R); x.lineTo(cx + k + 8, cy + R); x.stroke(); }
  });
}

function occluder(center, radii) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ colorWrite: false }));
  m.scale.set(...radii); m.position.set(...center); m.renderOrder = -1; return m;
}

// ---------- glasses ----------
function aviatorShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w * .5, h * .38);
  s.bezierCurveTo(-w * .2, h * .52, w * .25, h * .52, w * .5, h * .4);
  s.bezierCurveTo(w * .56, h * .05, w * .4, -h * .48, w * .02, -h * .5);
  s.bezierCurveTo(-w * .38, -h * .52, -w * .56, -h * .1, -w * .5, h * .38);
  return s;
}
function wayfarerShape(w, h) {
  const s = new THREE.Shape(), r = h * .22;
  s.moveTo(-w * .5 + r, h * .5); s.lineTo(w * .5 - r, h * .5); s.quadraticCurveTo(w * .5, h * .5, w * .5, h * .5 - r);
  s.lineTo(w * .44, -h * .3); s.quadraticCurveTo(w * .38, -h * .5, w * .2, -h * .5);
  s.lineTo(-w * .2, -h * .5); s.quadraticCurveTo(-w * .38, -h * .5, -w * .44, -h * .3);
  s.lineTo(-w * .5, h * .5 - r); s.quadraticCurveTo(-w * .5, h * .5, -w * .5 + r, h * .5);
  return s;
}
function lensMesh(shape, mat, bulge) {
  const g = new THREE.ShapeGeometry(shape, 48);
  const p = g.attributes.position; g.computeBoundingBox();
  const bb = g.boundingBox, cx = (bb.max.x + bb.min.x) / 2, cy = (bb.max.y + bb.min.y) / 2, rx = (bb.max.x - bb.min.x) / 2, ry = (bb.max.y - bb.min.y) / 2;
  for (let i = 0; i < p.count; i++) { const u = (p.getX(i) - cx) / rx, v = (p.getY(i) - cy) / ry; p.setZ(i, bulge * Math.max(0, 1 - (u * u + v * v) * .5)); }
  g.computeVertexNormals(); return new THREE.Mesh(g, mat);
}
function rimMesh(shape, radius, mat, bulge) {
  const pts = shape.getSpacedPoints(120).map(v => new THREE.Vector3(v.x, v.y, bulge * .5));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 160, radius, 10, true), mat);
}
function makeGlasses(kind) {
  const g = new THREE.Group();
  const mirror = kind === 'aviator';
  const frameMat = mirror
    ? new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: .22 })
    : new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, metalness: 0, roughness: .28, clearcoat: 1, clearcoatRoughness: .08 });
  const lensMat = mirror
    ? new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 1, roughness: .04, envMapIntensity: 1.15 })
    : new THREE.MeshPhysicalMaterial({ color: 0x050507, metalness: .2, roughness: .03, clearcoat: 1, clearcoatRoughness: .02, transparent: true, opacity: .94, envMapIntensity: .9 });
  mats[kind] = { lens: lensMat };
  const w = mirror ? .37 : .36, h = mirror ? .3 : .25, shape = mirror ? aviatorShape(w, h) : wayfarerShape(w, h), bulge = .035;
  for (const sx of [-1, 1]) {
    const side = new THREE.Group();
    side.position.set(sx * .215, mirror ? -.035 : -.01, .045); side.rotation.y = sx * -.12;
    const l = lensMesh(shape, lensMat, bulge); if (sx < 0) l.scale.x = -1; side.add(l);
    const r = rimMesh(shape, mirror ? .009 : .022, frameMat, bulge); if (sx < 0) r.scale.x = -1; side.add(r);
    g.add(side);
    // temple arm: from the outer top corner of the frame back past the ear
    const a = new THREE.Vector3(sx * (.215 + w * .5), mirror ? .06 : .09, .035);
    const curve = new THREE.CatmullRomCurve3([a, new THREE.Vector3(sx * .5, .07, -.2), new THREE.Vector3(sx * .52, .04, -.62), new THREE.Vector3(sx * .48, -.06, -.8)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, mirror ? .008 : .016, 8, false), frameMat));
    // nose pad
    if (mirror) { const pad = new THREE.Mesh(new THREE.SphereGeometry(.018, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: .6, roughness: .2 })); pad.position.set(sx * .045, -.07, .02); pad.scale.set(.6, 1.3, .6); g.add(pad); }
  }
  // bridge(s)
  const br = (y, z, bend) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.07, y, z), new THREE.Vector3(0, y + bend, z + .015), new THREE.Vector3(.07, y, z)), 20, mirror ? .008 : .02, 8, false), frameMat);
  g.add(br(mirror ? .06 : .04, .05, .035)); if (mirror) g.add(br(.105, .05, .0));
  g.add(occluder([0, .02, -.62], [.53, .72, .7]));
  return g;
}

// ---------- cap ----------
function makeCap() {
  const g = new THREE.Group(), color = '#0e0e10';
  const mat = new THREE.MeshPhysicalMaterial({ map: capTexture(color), normalMap: fabricNormal(), normalScale: new THREE.Vector2(.7, .7), roughness: .96, sheen: .35, sheenRoughness: .9, sheenColor: new THREE.Color(0x2a2a33), envMapIntensity: .35, side: THREE.DoubleSide });
  mat.normalMap.repeat.set(8, 4);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  crown.scale.set(.57, .42, .63); crown.position.set(0, .0, -.45); g.add(crown);
  // flatten the front a little, like a structured cap
  const p = crown.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z > 0) p.setZ(i, z * (1 - .12 * z)); }
  crown.geometry.computeVertexNormals();
  const button = new THREE.Mesh(new THREE.SphereGeometry(.035, 24, 12), mat); button.scale.y = .45; button.position.set(0, .415, -.45); g.add(button);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1, .035, 12, 96), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: .9 }));
  band.rotation.x = Math.PI / 2; band.scale.set(.57, .63, 1); band.position.set(0, .0, -.45); g.add(band);
  // brim: curved, tilted down, with a stitched edge
  const bs = new THREE.Shape(); bs.moveTo(-.58, 0); bs.bezierCurveTo(-.55, .42, .55, .42, .58, 0); bs.bezierCurveTo(.3, .1, -.3, .1, -.58, 0);
  const bg = new THREE.ExtrudeGeometry(bs, { depth: .022, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 3, curveSegments: 48 });
  const bp = bg.attributes.position;
  for (let i = 0; i < bp.count; i++) { const x = bp.getX(i); bp.setZ(i, bp.getZ(i) + x * x * .55); }   // edges curve down
  bg.computeVertexNormals();
  const brimMat = new THREE.MeshPhysicalMaterial({ color: 0x101012, normalMap: mat.normalMap, normalScale: new THREE.Vector2(.6, .6), roughness: .95, sheen: .35, sheenColor: new THREE.Color(0x2a2a33), envMapIntensity: .35 });
  const brim = new THREE.Mesh(bg, brimMat);
  brim.rotation.x = Math.PI / 2 + .26;   // front tipped down, so its top shows from the front
  brim.position.set(0, .01, .1); g.add(brim);
  // soft shadow the brim throws on the forehead
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(.95, .3), new THREE.MeshBasicMaterial({ map: canvasTex(128, 64, (x, w, h) => { const gr = x.createRadialGradient(w / 2, 0, 2, w / 2, 0, w * .55); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false }));
  sh.position.set(0, -.11, .06); g.add(sh);
  g.add(occluder([0, -.3, -.48], [.5, .62, .62]));
  return g;
}

function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1e5, 1e5);
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1); scene.add(hemi);
  key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-.4, .9, 1); scene.add(key);
  fill = new THREE.DirectionalLight(0xffffff, .5); fill.position.set(.6, -.2, .8); scene.add(fill);
  groups.dark = makeGlasses('dark'); groups.aviator = makeGlasses('aviator'); groups.cap = makeCap();
  for (const k in groups) { groups[k].visible = false; groups[k].matrixAutoUpdate = false; scene.add(groups[k]); }
}

// The lenses reflect what the camera sees (a wide, flipped copy of the picture).
let lastEnv = 0;
function updateEnv(video, now) {
  if (!renderer || !video || !video.videoWidth || now - lastEnv < 1000) return;   // reflections refresh once a second
  lastEnv = now;
  if (!envCanvas) { envCanvas = document.createElement('canvas'); envCanvas.width = 256; envCanvas.height = 128; envTex = new THREE.CanvasTexture(envCanvas); envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.colorSpace = THREE.SRGBColorSpace; }
  const x = envCanvas.getContext('2d');
  x.save(); x.translate(256, 0); x.scale(-1, 1); x.drawImage(video, 0, 0, 256, 128); x.restore();
  x.drawImage(envCanvas, 0, 0, 256, 128, 0, 0, 128, 128); x.drawImage(video, 0, 0, 256, 128, 128, 0, 128, 128);
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  envTex.needsUpdate = true;
  const old = videoEnv; videoEnv = pmrem.fromEquirectangular(envTex).texture; if (old) old.dispose();
  for (const k in mats) { mats[k].lens.envMap = videoEnv; mats[k].lens.needsUpdate = true; }
}
// Match the room: brightness and colour cast from the camera picture (0-255 average RGB).
function setLight(r, g, b) {
  if (!renderer) return;
  const l = (r * .3 + g * .59 + b * .11) / 255, k = .45 + l * 1.4;
  const tint = new THREE.Color(r / 255, g / 255, b / 255); tint.lerp(new THREE.Color(1, 1, 1), .55);
  hemi.intensity = 1.1 * k; key.intensity = 1.6 * k; fill.intensity = .5 * k;
  hemi.color.copy(tint); key.color.copy(tint);
}

const V = (f, i, W, H) => new THREE.Vector3(f[i].x * W, -f[i].y * H, -(f[i].z || 0) * W);
// head frame from landmarks: right, up, forward (toward camera), scale = face width
function headFrame(f, W, H) {
  const l = V(f, 234, W, H), r = V(f, 454, W, H), s = l.distanceTo(r);
  const x = V(f, 263, W, H).sub(V(f, 33, W, H)).normalize();
  let up = V(f, 10, W, H).sub(V(f, 152, W, H)).normalize();
  up.sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  let z = new THREE.Vector3().crossVectors(x, up);
  const nose = V(f, 4, W, H).sub(l.clone().add(r).multiplyScalar(.5));
  if (nose.dot(z) < 0) { x.negate(); z = new THREE.Vector3().crossVectors(x, up); }   // mirrored picture
  return { x, up, z, s };
}
const ANCHOR = { dark: 168, aviator: 168, cap: 10 };
function draw(ids, ctx, W, H, t, face) {
  if (!face || !face[454]) return;
  init();
  const k = Math.min(1, (W * H > 2e6 ? 2048 : 900) / Math.max(W, H));   // live preview at ~900px, photos up to 2048
  renderer.setSize(Math.round(W * k), Math.round(H * k), false);
  camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H; camera.updateProjectionMatrix();
  const fr = headFrame(face, W, H);
  for (const name in groups) {
    const gp = groups[name], on = ids.includes(name); gp.visible = on; if (!on) continue;
    const o = V(face, ANCHOR[name], W, H);
    const m = new THREE.Matrix4().makeBasis(fr.x, fr.up, fr.z).scale(new THREE.Vector3(fr.s, fr.s, fr.s));
    m.setPosition(o); gp.matrix.copy(m); gp.matrixWorldNeedsUpdate = true;
  }
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
}

window.FX3D = { draw, updateEnv, setLight };
