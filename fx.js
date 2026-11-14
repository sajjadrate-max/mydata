// Lamha effects: decorations, frames, occasions and face effects, all drawn in code.
// Every effect is draw(ctx, W, H, t, face): a pure function of time t (seconds), so the
// same moment can be drawn again at full photo resolution. `face` (face effects only) holds
// screen-normalised landmarks from MediaPipe Face Landmarker, or null when no face is seen.
'use strict';
(function () {
  const TAU = Math.PI * 2;
  // deterministic pseudo-random numbers: same particle, same place, every redraw
  const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const URDU = '"Noto Nastaliq Urdu","Noto Naskh Arabic",serif';

  // ---------- shapes ----------
  // Glows are pre-drawn once into small images (sprites): canvas shadowBlur on every
  // particle, every frame, was the slowest part on phones.
  const sprites = {};
  function glowSprite(color, glow) {
    const k = color + '|' + glow; if (sprites[k]) return sprites[k];
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); rg.addColorStop(0, glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = .55; g.fillStyle = rg; g.fillRect(0, 0, S, S); g.globalAlpha = 1;
    g.translate(S / 2, S / 2); g.fillStyle = color; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? S * .09 : S * .36; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fill();
    return sprites[k] = c;
  }
  function sparkle(x, c, y, r, rot, color, glow) {
    if (r <= .3) return;
    const sp = glowSprite(color, glow || color), d = r / .36;
    if (rot) { x.save(); x.translate(c, y); x.rotate(rot); x.drawImage(sp, -d / 2, -d / 2, d, d); x.restore(); }
    else x.drawImage(sp, c - d / 2, y - d / 2, d, d);
  }
  function heart(x, cx, cy, s, color) {
    x.save(); x.translate(cx, cy); x.scale(s / 32, s / 32); x.fillStyle = color;
    x.beginPath(); x.moveTo(0, 10);
    x.bezierCurveTo(-26, -8, -14, -30, 0, -16); x.bezierCurveTo(14, -30, 26, -8, 0, 10);
    x.fill(); x.restore();
  }
  function butterfly(x, cx, cy, s, flap, rot, c1, c2) {
    x.save(); x.translate(cx, cy); x.rotate(rot);
    x.drawImage(glowSprite('rgba(0,0,0,0)', c1), -s, -s, s * 2, s * 2);
    for (const side of [-1, 1]) {
      x.save(); x.scale(side * Math.max(.15, Math.abs(Math.cos(flap))), 1);
      const g = x.createRadialGradient(s * .3, -s * .2, 0, s * .3, -s * .2, s * .7);
      g.addColorStop(0, '#ffffff'); g.addColorStop(.5, c1); g.addColorStop(1, c2);
      x.fillStyle = g;
      x.beginPath(); x.ellipse(s * .32, -s * .22, s * .36, s * .26, -.5, 0, TAU); x.fill();
      x.beginPath(); x.ellipse(s * .25, s * .2, s * .24, s * .18, .5, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = s * .025;
      x.beginPath(); x.ellipse(s * .32, -s * .22, s * .2, s * .13, -.5, 0, TAU); x.stroke();
      x.restore();
    }
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(0, 0, s * .05, s * .3, 0, 0, TAU); x.fill();
    x.restore();
  }
  function gold(x, x0, y0, x1, y1) {
    const g = x.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#7a5300'); g.addColorStop(.25, '#f9e08b'); g.addColorStop(.5, '#c99a2e'); g.addColorStop(.75, '#fff3b0'); g.addColorStop(1, '#8a6200');
    return g;
  }
  function title(x, text, cx, cy, size, fill, stroke) {
    x.save(); x.font = '700 ' + size + 'px ' + URDU; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = size * .25; x.shadowOffsetY = size * .05;
    if (stroke) { x.lineWidth = size * .08; x.strokeStyle = stroke; x.lineJoin = 'round'; x.strokeText(text, cx, cy); }
    x.fillStyle = fill; x.fillText(text, cx, cy); x.restore();
  }
  function falling(x, W, H, t, n, speed, drawOne) {
    for (let i = 0; i < n; i++) {
      const sp = .5 + rnd(i, 3), y = ((rnd(i, 2) + t * speed * sp * .1) % 1.15) - .08;
      const xx = rnd(i, 1) + Math.sin(t * (.6 + rnd(i, 4)) + i) * .03;
      drawOne(xx * W, y * H, i, sp);
    }
  }
  function rising(x, W, H, t, n, speed, drawOne) {
    for (let i = 0; i < n; i++) {
      const sp = .5 + rnd(i, 3), y = 1.1 - ((rnd(i, 2) + t * speed * sp * .1) % 1.25);
      drawOne((rnd(i, 1) + Math.sin(t * .8 + i) * .02) * W, y * H, i, sp);
    }
  }
  const M = (W, H) => Math.min(W, H);

  // ---------- face helpers ----------
  function F(face, W, H) {
    const p = i => ({ x: face[i].x * W, y: face[i].y * H });
    let a = p(33), b = p(263);
    if (a.x > b.x) { const t = a; a = b; b = t; }
    const l = p(234), r = p(454);
    return { p, ang: Math.atan2(b.y - a.y, b.x - a.x), w: Math.hypot(r.x - l.x, r.y - l.y),
      eyeL: mid(p(33), p(133)), eyeR: mid(p(263), p(362)), top: p(10), nose: p(4), lip: p(164), chin: p(152) };
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function sortEyes(f) { return f.eyeL.x < f.eyeR.x ? [f.eyeL, f.eyeR] : [f.eyeR, f.eyeL]; }
  // up direction of the face (perpendicular to the eye line)
  const up = (f, d) => ({ x: Math.sin(f.ang) * d, y: -Math.cos(f.ang) * d });

  // ---------- effects ----------
  const L = [];
  const add = (id, name, cat, o) => L.push(Object.assign({ id, name, cat }, o));

  // --- face ---
  // 3D effects (lib/fx3d.js, three.js): real-looking models that turn with the head.
  // draw2d is only for the button picture, before the 3D engine has loaded.
  const D3 = ids => function (x, W, H, t, face) { if (face && window.FX3D && face !== CARTOON) window.FX3D.draw(ids, x, W, H, t, face); };
  add('aviator3d', 'سنہری چشمہ 3D', 'face', { face: true, three: true, thumb: 'assets/lens/aviator.jpg', draw: D3(['aviator']), draw2d: glasses2d('#d8b25a', 'rgba(150,170,190,.95)') });
  add('dark3d', 'کالا چشمہ 3D', 'face', { face: true, three: true, draw: D3(['dark']), draw2d: glasses2d('#111', 'rgba(15,15,20,.95)') });
  add('cap3d', 'کیپ 3D', 'face', { face: true, three: true, draw: D3(['cap']), draw2d: cap2d });
  add('capshades3d', 'کیپ اور چشمہ 3D', 'face', { face: true, thumb: 'assets/lens/capshades.jpg', three: true, draw: D3(['cap', 'aviator']), draw2d(x, W, H, t, f) { cap2d(x, W, H, t, f); glasses2d('#d8b25a', 'rgba(150,170,190,.95)')(x, W, H, t, f); } });
  function cap2d(x, W, H, t, face) {
    const f = F(face, W, H), cw = f.w * 1.1;
    x.save(); x.translate(f.top.x, f.top.y + f.w * .05); x.rotate(f.ang); x.fillStyle = '#18181b';
    x.beginPath(); x.ellipse(0, 0, cw / 2, f.w * .5, 0, Math.PI, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(0, 0, cw * .62, f.w * .1, 0, 0, Math.PI); x.fill(); x.restore();
  }
  function glasses2d(frame, lens) { return function (x, W, H, t, face) {
    const f = F(face, W, H), [e1, e2] = sortEyes(f), lw = f.w * .3, lh = f.w * .22;
    for (const e of [e1, e2]) { x.save(); x.translate(e.x, e.y); x.rotate(f.ang); x.fillStyle = lens; x.strokeStyle = frame; x.lineWidth = f.w * .03;
      x.beginPath(); x.ellipse(0, 0, lw / 2, lh / 2, 0, 0, TAU); x.fill(); x.stroke(); x.restore(); }
    x.strokeStyle = frame; x.lineWidth = f.w * .03; x.beginPath(); x.moveTo(e1.x + lw / 2, e1.y); x.lineTo(e2.x - lw / 2, e2.y); x.stroke();
  }; }
  add('glasses', 'کالا چشمہ (سادہ)', 'face', { face: true, draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), [e1, e2] = sortEyes(f), lw = f.w * .3, lh = f.w * .21;
    x.save(); x.lineCap = 'round';
    x.strokeStyle = '#1a1a1a'; x.lineWidth = f.w * .03;
    x.beginPath(); x.moveTo(e1.x + Math.cos(f.ang) * lw * .45, e1.y + Math.sin(f.ang) * lw * .45); x.lineTo(e2.x - Math.cos(f.ang) * lw * .45, e2.y - Math.sin(f.ang) * lw * .45); x.stroke();
    for (const e of [e1, e2]) {
      x.save(); x.translate(e.x, e.y + f.w * .01); x.rotate(f.ang);
      const g = x.createLinearGradient(0, -lh / 2, 0, lh / 2); g.addColorStop(0, 'rgba(25,25,35,.97)'); g.addColorStop(1, 'rgba(70,60,90,.93)');
      x.fillStyle = g; x.beginPath();
      x.moveTo(-lw / 2, -lh * .45); x.quadraticCurveTo(0, -lh * .62, lw / 2, -lh * .45);
      x.quadraticCurveTo(lw * .58, lh * .45, 0, lh * .55); x.quadraticCurveTo(-lw * .58, lh * .45, -lw / 2, -lh * .45);
      x.fill(); x.lineWidth = f.w * .022; x.strokeStyle = gold(x, -lw / 2, 0, lw / 2, 0); x.stroke();
      x.fillStyle = 'rgba(255,255,255,.28)'; x.beginPath(); x.ellipse(-lw * .18, -lh * .15, lw * .08, lh * .22, -.6, 0, TAU); x.fill();
      x.restore();
    }
    x.restore();
  } });
  add('crown', 'تاج', 'face', { face: true, thumb: 'assets/lens/crown.jpg', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), cw = f.w * .78, ch = f.w * .42, u = up(f, f.w * .12);
    x.save(); x.translate(f.top.x + u.x, f.top.y + u.y); x.rotate(f.ang);
    x.fillStyle = gold(x, -cw / 2, -ch, cw / 2, 0); x.shadowColor = 'rgba(255,200,60,.7)'; x.shadowBlur = f.w * .08;
    x.beginPath(); x.moveTo(-cw / 2, 0);
    const peaks = 5;
    for (let i = 0; i <= peaks * 2; i++) { const px = -cw / 2 + cw * i / (peaks * 2), py = i % 2 ? -ch * .45 : -ch * (i === peaks ? 1.05 : .85); x.lineTo(px, py); }
    x.lineTo(cw / 2, 0); x.closePath(); x.fill();
    x.shadowBlur = 0; x.fillStyle = '#7a5300'; x.fillRect(-cw / 2, -ch * .18, cw, ch * .18);
    const gems = ['#e11d48', '#2563eb', '#16a34a', '#2563eb', '#e11d48'];
    gems.forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(-cw / 2 + cw * (i + .5) / 5, -ch * .09, ch * .07, 0, TAU); x.fill(); });
    for (let i = 0; i <= peaks * 2; i += 2) { x.fillStyle = '#fff6c7'; x.beginPath(); x.arc(-cw / 2 + cw * i / (peaks * 2), -ch * (i === peaks ? 1.05 : .85), ch * .06, 0, TAU); x.fill(); }
    x.restore();
    for (let i = 0; i < 6; i++) { const a = t * 1.5 + i; sparkle(x, f.top.x + Math.cos(a) * f.w * .5 + u.x, f.top.y - f.w * .25 + Math.sin(a * 1.3) * f.w * .2, f.w * .05 * (.6 + .4 * Math.sin(t * 4 + i)), t, '#fff7d1', '#ffd34d'); }
  } });
  add('mustache', 'مونچھ', 'face', { face: true, thumb: 'assets/lens/mustache.jpg', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), mw = f.w * .5, mh = f.w * .14;
    x.save(); x.translate(f.lip.x, f.lip.y); x.rotate(f.ang); x.fillStyle = '#24160d'; x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = f.w * .02;
    for (const s of [-1, 1]) {
      x.save(); x.scale(s, 1); x.beginPath(); x.moveTo(0, -mh * .3);
      x.bezierCurveTo(mw * .2, -mh * .9, mw * .45, -mh * .2, mw * .55, -mh * .55);
      x.bezierCurveTo(mw * .62, -mh * .8, mw * .5, -mh * 1.1, mw * .42, -mh * .9);
      x.bezierCurveTo(mw * .52, -mh * .5, mw * .3, mh * .55, 0, mh * .15); x.closePath(); x.fill(); x.restore();
    }
    x.restore();
  } });
  add('cat', 'بلی', 'face', { face: true, thumb: 'assets/lens/cat.jpg', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), u = up(f, f.w * .22), ew = f.w * .3;
    for (const s of [-1, 1]) {
      x.save(); x.translate(f.top.x + Math.cos(f.ang) * s * f.w * .3 + u.x, f.top.y + Math.sin(f.ang) * s * f.w * .3 + u.y); x.rotate(f.ang + s * .25);
      x.fillStyle = '#3b2f2f'; x.beginPath(); x.moveTo(-ew / 2, ew * .3); x.lineTo(0, -ew * .75); x.lineTo(ew / 2, ew * .3); x.closePath(); x.fill();
      x.fillStyle = '#f9a8d4'; x.beginPath(); x.moveTo(-ew * .28, ew * .2); x.lineTo(0, -ew * .45); x.lineTo(ew * .28, ew * .2); x.closePath(); x.fill();
      x.restore();
    }
    x.save(); x.translate(f.nose.x, f.nose.y); x.rotate(f.ang);
    heart(x, 0, 0, f.w * .12, '#f472b6');
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = f.w * .012; x.lineCap = 'round';
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(s * f.w * .1, f.w * .03 + k * f.w * .03); x.lineTo(s * f.w * .38, k * f.w * .07); x.stroke(); }
    x.restore();
  } });
  add('hearteyes', 'دل آنکھیں', 'face', { face: true, thumb: 'assets/lens/hearteyes.jpg', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), s = f.w * .3 * (1 + .08 * Math.sin(t * 6));
    for (const e of sortEyes(f)) { x.save(); x.shadowColor = '#ff4d8d'; x.shadowBlur = f.w * .08; heart(x, e.x, e.y + f.w * .02, s, '#ff2e63'); x.restore(); }
    for (let i = 0; i < 7; i++) {
      const k = (t * .35 + rnd(i, 1)) % 1, a = rnd(i, 2) * TAU;
      heart(x, f.top.x + Math.cos(a) * f.w * (.4 + k * .3), f.top.y - k * f.w * .9, f.w * .1 * (1 - k * .5), 'rgba(255,90,140,' + (1 - k) + ')');
    }
  } });
  add('flowers', 'پھولوں کا تاج', 'face', { face: true, thumb: 'assets/lens/flowers.jpg', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H), u = up(f, f.w * .05), R = f.w * .55, cs = ['🌸', '🌼', '🌺', '🌷'];
    x.save(); x.translate(f.top.x + u.x, f.top.y + u.y + f.w * .35); x.rotate(f.ang);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = Math.round(f.w * .17) + 'px system-ui,"Apple Color Emoji","Noto Color Emoji",sans-serif';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + Math.PI * (i + .5) / 9;
      x.save(); x.translate(Math.cos(a) * R, Math.sin(a) * R * .75 - f.w * .25); x.rotate(Math.sin(t * 2 + i) * .1);
      x.fillText(i % 2 ? '🍃' : cs[i % cs.length], 0, 0); x.restore();
    }
    x.restore();
  } });
  add('blush', 'گلابی نکھار', 'face', { face: true, thumb: 'assets/lens/glow.jpg', filter: 'glow', draw(x, W, H, t, face) {
    if (!face) return; const f = F(face, W, H);
    for (const i of [50, 280]) {
      const c = { x: face[i].x * W, y: face[i].y * H }, r = f.w * .14, g = x.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, 'rgba(255,105,150,.38)'); g.addColorStop(1, 'rgba(255,105,150,0)'); x.fillStyle = g; x.beginPath(); x.arc(c.x, c.y, r, 0, TAU); x.fill();
    }
    for (let i = 0; i < 5; i++) sparkle(x, f.top.x + (rnd(i, 1) - .5) * f.w * 1.2, f.top.y + (rnd(i, 2) - .2) * f.w * 1.2, f.w * .035 * (.5 + .5 * Math.sin(t * 5 + i * 2)), 0, '#fff', '#ffc0d9');
  } });

  // --- decorations ---
  add('butterflies', 'تتلیاں', 'deco', { draw(x, W, H, t) {
    const m = M(W, H);
    for (let i = 0; i < 6; i++) {
      const px = (rnd(i, 1) + Math.sin(t * .3 + i * 2) * .12 + 1) % 1, py = (rnd(i, 2) + Math.cos(t * .25 + i) * .1 + 1) % 1;
      butterfly(x, px * W, py * H, m * (.09 + rnd(i, 3) * .06), t * 9 + i, Math.sin(t + i) * .4, i % 2 ? '#ffd6f5' : '#e0f2ff', i % 2 ? 'rgba(236,72,153,.35)' : 'rgba(56,189,248,.35)');
      for (let k = 1; k < 7; k++) sparkle(x, px * W - k * m * .02, py * H + k * m * .025, m * .008 * (7 - k) / 3, 0, 'rgba(255,255,255,' + (1 - k / 7) + ')');
    }
  } });
  add('sparkle', 'چمک', 'deco', { draw(x, W, H, t) {
    const m = M(W, H);
    for (let i = 0; i < 28; i++) { const tw = Math.max(0, Math.sin(t * (1.5 + rnd(i, 3) * 2) + i * 7)); if (tw > .05) sparkle(x, rnd(i, 1) * W, rnd(i, 2) * H, m * (.012 + rnd(i, 4) * .03) * tw, t * .5, '#ffffff', ['#a5f3fc', '#fbcfe8', '#fde68a'][i % 3]); }
  } });
  add('hearts', 'دل', 'deco', { draw(x, W, H, t) {
    const m = M(W, H);
    rising(x, W, H, t, 18, 1.2, (px, py, i) => { x.save(); x.globalAlpha = .85; heart(x, px, py, m * (.04 + rnd(i, 5) * .05), ['#ff2e63', '#ff7aa8', '#ffffff', '#f43f5e'][i % 4]); x.restore(); });
  } });
  add('snow', 'برف', 'deco', { filter: 'cool', draw(x, W, H, t) {
    const m = M(W, H); x.fillStyle = '#fff';
    falling(x, W, H, t, 70, .9, (px, py, i) => { x.globalAlpha = .5 + rnd(i, 6) * .5; x.beginPath(); x.arc(px, py, m * (.003 + rnd(i, 5) * .008), 0, TAU); x.fill(); });
    x.globalAlpha = 1;
  } });
  add('confetti', 'جشن', 'deco', { draw(x, W, H, t) {
    const m = M(W, H), cs = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#eab308'];
    falling(x, W, H, t, 60, 1.6, (px, py, i) => { x.save(); x.translate(px, py); x.rotate(t * 3 * (rnd(i, 7) - .5) * 4 + i); x.scale(1, Math.cos(t * 5 + i)); x.fillStyle = cs[i % cs.length]; x.fillRect(-m * .008, -m * .015, m * .016, m * .03); x.restore(); });
  } });
  add('bokeh', 'روشنیاں', 'deco', { filter: 'dream', draw(x, W, H, t) {
    const m = M(W, H), cs = ['255,200,120', '255,140,200', '140,200,255', '255,255,200'];
    x.save(); x.globalCompositeOperation = 'screen';
    for (let i = 0; i < 18; i++) {
      const px = (rnd(i, 1) + Math.sin(t * .2 + i) * .03) * W, py = (rnd(i, 2) + Math.cos(t * .15 + i) * .03) * H, r = m * (.04 + rnd(i, 3) * .08);
      const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(' + cs[i % 4] + ',.45)'); g.addColorStop(.7, 'rgba(' + cs[i % 4] + ',.25)'); g.addColorStop(1, 'rgba(' + cs[i % 4] + ',0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    }
    x.restore();
  } });

  // --- frames ---
  function mandala(x, cx, cy, r, t) {
    x.save(); x.translate(cx, cy); x.rotate(t * .1); x.strokeStyle = gold(x, -r, -r, r, r); x.lineWidth = r * .05;
    for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(0, 0, r * (.3 + k * .3), 0, TAU); x.stroke(); }
    for (let i = 0; i < 16; i++) { x.save(); x.rotate(i * TAU / 16); x.beginPath(); x.ellipse(0, -r * .62, r * .1, r * .3, 0, 0, TAU); x.stroke(); x.restore(); }
    x.restore();
  }
  add('royal', 'شاہی فریم', 'frame', { draw(x, W, H, t) {
    const m = M(W, H), band = H * .2;
    for (const flip of [1, -1]) {
      x.save(); if (flip < 0) { x.translate(0, H); x.scale(1, -1); }
      const g = x.createLinearGradient(0, 0, 0, band); g.addColorStop(0, '#4a0410'); g.addColorStop(1, '#8b0f1f');
      // the inner edge: a wide central arch plus small scallops
      const edge = xx => { const u = xx / W - .5; return band * (1 - .55 * Math.max(0, 1 - Math.abs(u) / .28) ** 1.5) - band * .06 * Math.abs(Math.sin(xx / W * Math.PI * 10)); };
      x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); for (let xx = W; xx >= 0; xx -= W / 120) x.lineTo(xx, edge(xx)); x.closePath();
      x.fillStyle = g; x.fill();
      x.beginPath(); for (let xx = 0; xx <= W; xx += W / 120) x.lineTo(xx, edge(xx)); x.lineWidth = m * .02; x.strokeStyle = gold(x, 0, 0, W, band); x.stroke();
      x.beginPath(); for (let xx = 0; xx <= W; xx += W / 120) x.lineTo(xx, edge(xx) - m * .03); x.lineWidth = m * .006; x.stroke();
      mandala(x, W / 2, band * .32, band * .3, t);
      for (const cx of [W * .12, W * .88]) mandala(x, cx, band * .35, band * .2, -t);
      x.restore();
    }
  } });
  add('arch', 'مغل محراب', 'frame', { draw(x, W, H, t) {
    const m = M(W, H), pad = W * .08, top = H * .14, bot = H * .9, aw = W - pad * 2, springY = top + aw * .55;
    x.save(); x.beginPath(); x.rect(0, 0, W, H);
    x.moveTo(pad, bot); x.lineTo(pad, springY);
    x.quadraticCurveTo(pad, top + aw * .12, W / 2, top); x.quadraticCurveTo(W - pad, top + aw * .12, W - pad, springY); x.lineTo(W - pad, bot); x.closePath();
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f3d3e'); g.addColorStop(1, '#3b0a2a'); x.fillStyle = g; x.fill('evenodd');
    x.beginPath(); x.moveTo(pad, bot); x.lineTo(pad, springY); x.quadraticCurveTo(pad, top + aw * .12, W / 2, top); x.quadraticCurveTo(W - pad, top + aw * .12, W - pad, springY); x.lineTo(W - pad, bot); x.closePath();
    x.lineWidth = m * .022; x.strokeStyle = gold(x, 0, top, W, bot); x.shadowColor = 'rgba(255,210,90,.6)'; x.shadowBlur = m * .03; x.stroke();
    x.restore();
    for (let i = 0; i < 9; i++) { const yy = top + (bot - top) * i / 8; for (const xx of [pad / 2, W - pad / 2]) sparkle(x, xx, yy, m * .012 * (.6 + .4 * Math.sin(t * 3 + i)), 0, '#ffe9a8', '#ffcf4d'); }
    x.fillStyle = gold(x, 0, 0, W, 0); x.beginPath(); x.arc(W / 2, top - m * .03, m * .025, 0, TAU); x.fill();
  } });
  add('polaroid', 'پولرائیڈ', 'frame', { filter: 'warm', draw(x, W, H) {
    const s = W * .05, b = H * .15;
    x.save(); x.fillStyle = '#fbfaf6'; x.beginPath(); x.rect(0, 0, W, H); x.rect(s, s, W - s * 2, H - s - b); x.fill('evenodd');
    x.fillStyle = '#4b5563'; x.font = '700 ' + Math.round(b * .28) + 'px ' + URDU; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    const d = new Date(); x.fillText('لمحہ · ' + d.toLocaleDateString('ur-PK', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, H - b / 2); x.restore();
  } });
  add('film', 'فلم', 'frame', { filter: 'retro', draw(x, W, H) {
    const sw = W * .085, hole = sw * .45; x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, sw, H); x.fillRect(W - sw, 0, sw, H);
    x.fillStyle = '#e8e2d0';
    for (let y = hole * .6; y < H; y += hole * 1.7) for (const xx of [(sw - hole) / 2, W - sw + (sw - hole) / 2]) { x.beginPath(); x.roundRect ? x.roundRect(xx, y, hole, hole * 1.1, hole * .2) : x.rect(xx, y, hole, hole * 1.1); x.fill(); }
  } });
  add('neon', 'نیون', 'frame', { draw(x, W, H, t) {
    const m = M(W, H), i = m * .05, hue = (t * 40) % 360;
    x.save(); x.lineWidth = m * .014;
    for (const [off, h] of [[0, hue], [m * .025, (hue + 160) % 360]]) {
      x.strokeStyle = 'hsl(' + h + ',100%,65%)'; x.shadowColor = 'hsl(' + h + ',100%,60%)'; x.shadowBlur = m * .05;
      x.beginPath(); x.roundRect ? x.roundRect(i + off, i + off, W - (i + off) * 2, H - (i + off) * 2, m * .06) : x.rect(i + off, i + off, W - (i + off) * 2, H - (i + off) * 2); x.stroke();
    }
    x.restore();
  } });
  add('floral', 'پھولوں والا', 'frame', { draw(x, W, H, t) {
    const m = M(W, H), cs = ['🌸', '🌺', '🌼', '🌷', '🍃', '🌹'];
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]])
      for (let k = 0; k < 7; k++) {
        const a = k / 6 * Math.PI / 2, r = m * (.08 + (k % 2) * .09);
        x.font = Math.round(m * (.07 + rnd(k, cx + cy) * .04)) + 'px system-ui,"Apple Color Emoji","Noto Color Emoji",sans-serif';
        x.fillText(cs[(k + (cx ? 2 : 0)) % cs.length], cx + sx * Math.cos(a) * r * 1.4, cy + sy * Math.sin(a) * r * 1.4 + Math.sin(t * 2 + k) * m * .004);
      }
  } });

  // --- occasions ---
  function crescent(x, cx, cy, r, color) {
    x.save(); x.fillStyle = color; x.shadowColor = color; x.shadowBlur = r * .6;
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.arc(cx + r * .45, cy - r * .2, r * .85, 0, TAU, true); x.fill('evenodd'); x.restore();
  }
  function lantern(x, cx, cy, s, t, i) {
    const sw = Math.sin(t * 1.6 + i) * .12;
    x.save(); x.translate(cx, 0); x.rotate(sw); x.strokeStyle = '#d4a017'; x.lineWidth = s * .04; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, cy); x.stroke();
    x.translate(0, cy);
    const g = x.createRadialGradient(0, s * .5, 0, 0, s * .5, s * 1.2); g.addColorStop(0, 'rgba(255,214,102,.55)'); g.addColorStop(1, 'rgba(255,214,102,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, s * .5, s * 1.2, 0, TAU); x.fill();
    x.fillStyle = gold(x, -s / 2, 0, s / 2, s); x.beginPath();
    x.moveTo(-s * .15, 0); x.lineTo(s * .15, 0); x.lineTo(s * .4, s * .3); x.lineTo(s * .35, s * .8); x.lineTo(0, s * 1.05); x.lineTo(-s * .35, s * .8); x.lineTo(-s * .4, s * .3); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,240,180,' + (.75 + .25 * Math.sin(t * 8 + i)) + ')'; x.beginPath(); x.ellipse(0, s * .52, s * .17, s * .25, 0, 0, TAU); x.fill();
    x.restore();
  }
  add('eid', 'عید مبارک', 'occasion', { fontNeeded: true, draw(x, W, H, t) {
    const m = M(W, H);
    const g = x.createLinearGradient(0, 0, 0, H * .35); g.addColorStop(0, 'rgba(10,20,60,.75)'); g.addColorStop(1, 'rgba(10,20,60,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H * .35);
    crescent(x, W * .8, H * .1, m * .09, '#ffd76a');
    for (let i = 0; i < 12; i++) sparkle(x, rnd(i, 1) * W, rnd(i, 2) * H * .3, m * .015 * (.4 + .6 * Math.abs(Math.sin(t * 2 + i))), 0, '#fff8d6');
    [[.12, .12], [.28, .2], [.5, .1], [.62, .17]].forEach(([px, py], i) => lantern(x, px * W, py * H, m * .1, t, i));
    title(x, 'عید مبارک', W / 2, H * .6, m * .14, gold(x, W * .2, 0, W * .8, 0), 'rgba(60,30,0,.6)');
  } });
  add('azadi', 'جشنِ آزادی', 'occasion', { fontNeeded: true, draw(x, W, H, t) {
    const m = M(W, H);
    for (let row = 0; row < 2; row++) {
      const y0 = H * (.03 + row * .07), sag = H * .05, n = 9;
      x.strokeStyle = '#fff'; x.lineWidth = m * .004; x.beginPath(); for (let k = 0; k <= 40; k++) { const u = k / 40; x.lineTo(u * W, y0 + sag * 4 * u * (1 - u)); } x.stroke();
      for (let k = 0; k < n; k++) {
        const u = (k + .5 + row * .5) / (n + .5), px = u * W, py = y0 + sag * 4 * u * (1 - u), fw = W / n * .7;
        x.save(); x.translate(px, py); x.rotate(Math.sin(t * 2 + k) * .08);
        x.fillStyle = (k + row) % 2 ? '#ffffff' : '#01411C'; x.beginPath(); x.moveTo(-fw / 2, 0); x.lineTo(fw / 2, 0); x.lineTo(0, fw * .9); x.closePath(); x.fill(); x.restore();
      }
    }
    const fw = m * .3, fh = fw * .66, fx = W / 2 - fw / 2, fy = H * .4 - fh;
    x.save(); x.translate(0, Math.sin(t * 2) * m * .005);
    x.fillStyle = '#fff'; x.fillRect(fx, fy, fw * .25, fh); x.fillStyle = '#01411C'; x.fillRect(fx + fw * .25, fy, fw * .75, fh);
    const cx = fx + fw * .625, cy = fy + fh / 2;
    x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, fh * .3, 0, TAU); x.arc(cx + fh * .1, cy - fh * .07, fh * .25, 0, TAU, true); x.fill('evenodd');
    sparkle(x, cx + fh * .17, cy - fh * .13, fh * .1, -.4, '#fff');
    x.restore();
    falling(x, W, H, t, 40, 1.2, (px, py, i) => { x.fillStyle = i % 2 ? '#ffffff' : '#16a34a'; x.fillRect(px, py, m * .012, m * .02); });
    title(x, 'جشنِ آزادی مبارک', W / 2, H * .55, m * .1, '#ffffff', '#01411C');
  } });
  add('birthday', 'سالگرہ مبارک', 'occasion', { fontNeeded: true, draw(x, W, H, t) {
    const m = M(W, H), cs = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
    rising(x, W, H, t, 9, .6, (px, py, i) => {
      const r = m * (.06 + rnd(i, 5) * .03);
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = m * .003; x.beginPath(); x.moveTo(px, py + r * 1.2); x.quadraticCurveTo(px + Math.sin(t * 2 + i) * r * .5, py + r * 2.5, px, py + r * 3.6); x.stroke();
      const g = x.createRadialGradient(px - r * .35, py - r * .4, r * .1, px, py, r * 1.2); g.addColorStop(0, '#fff'); g.addColorStop(.25, cs[i % 6]); g.addColorStop(1, cs[i % 6]);
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * 1.2, 0, 0, TAU); x.fill();
    });
    title(x, 'سالگرہ مبارک', W / 2, H * .16, m * .13, '#ffffff', '#db2777');
    for (let i = 0; i < 10; i++) sparkle(x, W * (.15 + .7 * rnd(i, 8)), H * (.08 + .16 * rnd(i, 9)), m * .015 * Math.abs(Math.sin(t * 3 + i)), 0, '#fde68a');
  } });
  add('shadi', 'شادی مبارک', 'occasion', { fontNeeded: true, filter: 'warm', draw(x, W, H, t) {
    const m = M(W, H);
    falling(x, W, H, t, 34, .8, (px, py, i) => { x.save(); x.translate(px, py); x.rotate(t * (rnd(i, 7) - .5) * 3 + i); x.fillStyle = ['#be123c', '#e11d48', '#fb7185'][i % 3]; x.beginPath(); x.ellipse(0, 0, m * .018, m * .01, 0, 0, TAU); x.fill(); x.restore(); });
    const g = x.createRadialGradient(W / 2, H / 2, M(W, H) * .3, W / 2, H / 2, Math.hypot(W, H) / 2); g.addColorStop(0, 'rgba(80,0,20,0)'); g.addColorStop(1, 'rgba(80,0,20,.55)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    title(x, 'شادی مبارک', W / 2, H * .6, m * .14, gold(x, W * .2, 0, W * .8, 0), 'rgba(60,0,10,.6)');
    for (let i = 0; i < 8; i++) sparkle(x, W * (.2 + .6 * rnd(i, 4)), H * (.52 + .14 * rnd(i, 5)), m * .015 * Math.abs(Math.sin(t * 3 + i)), 0, '#fff3c4');
  } });
  add('jumma', 'جمعہ مبارک', 'occasion', { fontNeeded: true, draw(x, W, H, t) {
    const m = M(W, H), base = H, g = x.createLinearGradient(0, H * .65, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,30,25,.75)'); x.fillStyle = g; x.fillRect(0, H * .6, W, H * .4);
    x.fillStyle = 'rgba(5,46,40,.92)';
    const dome = (cx, r) => { x.beginPath(); x.moveTo(cx - r, base - H * .1); x.quadraticCurveTo(cx - r, base - H * .1 - r * 1.6, cx, base - H * .1 - r * 2); x.quadraticCurveTo(cx + r, base - H * .1 - r * 1.6, cx + r, base - H * .1); x.fill(); };
    x.fillRect(W * .2, base - H * .1, W * .6, H * .1); dome(W / 2, W * .12); dome(W * .32, W * .06); dome(W * .68, W * .06);
    for (const cx of [W * .14, W * .86]) { x.fillRect(cx - W * .015, base - H * .32, W * .03, H * .32); x.beginPath(); x.moveTo(cx - W * .025, base - H * .32); x.lineTo(cx, base - H * .37); x.lineTo(cx + W * .025, base - H * .32); x.fill(); }
    crescent(x, W / 2, base - H * .1 - W * .27, m * .025, '#ffd76a');
    const lg = x.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * .5); lg.addColorStop(0, 'rgba(255,220,140,.35)'); lg.addColorStop(1, 'rgba(255,220,140,0)'); x.fillStyle = lg; x.fillRect(0, 0, W, H * .5);
    title(x, 'جمعہ مبارک', W / 2, H * .14, m * .13, gold(x, W * .2, 0, W * .8, 0), 'rgba(0,30,25,.6)');
  } });
  add('diyas', 'چراغاں', 'occasion', { filter: 'golden', draw(x, W, H, t) {
    const m = M(W, H), n = 5;
    for (let i = 0; i < n; i++) {
      const cx = W * (i + .5) / n, cy = H * .93, s = m * .09;
      const gl = x.createRadialGradient(cx, cy - s * .7, 0, cx, cy - s * .7, s * 1.6); gl.addColorStop(0, 'rgba(255,190,80,.45)'); gl.addColorStop(1, 'rgba(255,190,80,0)'); x.fillStyle = gl; x.beginPath(); x.arc(cx, cy - s * .7, s * 1.6, 0, TAU); x.fill();
      x.fillStyle = '#b45309'; x.beginPath(); x.moveTo(cx - s * .6, cy - s * .2); x.quadraticCurveTo(cx, cy + s * .45, cx + s * .6, cy - s * .2); x.closePath(); x.fill();
      x.fillStyle = '#f59e0b'; x.fillRect(cx - s * .6, cy - s * .26, s * 1.2, s * .08);
      const fl = 1 + .12 * Math.sin(t * 12 + i * 3);
      x.save(); x.translate(cx, cy - s * .3); x.scale(fl, fl); const fg = x.createRadialGradient(0, -s * .25, 0, 0, -s * .25, s * .4); fg.addColorStop(0, '#fff7cc'); fg.addColorStop(.5, '#ffb703'); fg.addColorStop(1, 'rgba(255,90,0,0)');
      x.fillStyle = fg; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(s * .25, -s * .2, 0, -s * .6); x.quadraticCurveTo(-s * .25, -s * .2, 0, 0); x.fill(); x.restore();
    }
    for (let i = 0; i < 16; i++) sparkle(x, rnd(i, 1) * W, rnd(i, 2) * H * .7, m * .014 * Math.abs(Math.sin(t * 2 + i)), 0, '#ffe7a3');
  } });

  // ---------- thumbnails ----------
  // A cartoon face with the landmark points the face effects use, for their buttons.
  const CARTOON = (() => {
    const pts = {}, set = (i, x, y) => pts[i] = { x, y };
    set(10, .5, .3); set(152, .5, .9); set(234, .2, .58); set(454, .8, .58);
    set(33, .32, .52); set(133, .44, .52); set(263, .68, .52); set(362, .56, .52);
    set(4, .5, .64); set(164, .5, .71); set(50, .32, .66); set(280, .68, .66);
    return new Proxy(pts, { get: (o, k) => o[k] || { x: .5, y: .6 } });
  })();
  function cartoonBase(x, W, H) {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#c4b5fd'); g.addColorStop(1, '#67e8f9'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#f2c4a0'; x.beginPath(); x.ellipse(W * .5, H * .6, W * .3, H * .32, 0, 0, TAU); x.fill();
    x.fillStyle = '#3b2a20'; x.beginPath(); x.ellipse(W * .5, H * .36, W * .31, H * .14, 0, Math.PI, TAU); x.fill();
    x.fillStyle = '#2d2d2d'; for (const ex of [.38, .62]) { x.beginPath(); x.arc(W * ex, H * .53, W * .03, 0, TAU); x.fill(); }
    x.strokeStyle = '#a14a4a'; x.lineWidth = W * .025; x.beginPath(); x.arc(W * .5, H * .7, W * .09, .2, Math.PI - .2); x.stroke();
  }
  function decoBase(x, W, H) {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#312e81'); g.addColorStop(1, '#0e7490'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  }

  window.FX = {
    list: L, get: id => L.find(f => f.id === id), cartoon: CARTOON, cartoonBase, decoBase,
    CATS: [['all', '✨', 'سب'], ['fav', '♥', 'پسندیدہ'], ['recent', '🕘', 'حالیہ'], ['color', '🎨', 'رنگ'], ['face', '😎', 'چہرہ'], ['deco', '🦋', 'سجاوٹ'], ['frame', '🖼️', 'فریم'], ['occasion', '🎉', 'موقع']]
  };
})();
