import { W, H, FONT_COMIC, FONT_HAND, FONT_SCRIPT, C, box, bubble, clamp, comic, ellipse, ease, fontFor, line, mix, paperTexture, path, progress, rand, shadow, star, text, withInkMotion, withTransform } from './sketch.js';
import { BASE_FPS, frameTiming, sampleTrack, sampleValue } from './frame-timing.js';
import { character } from './character.js';
import { editorBackground, flyingOffcut, scissors } from './editor.js';
import { media } from './media.js';
import { cameraAt, captionAt, captionSize, clipAt, cues, exportProgress, referenceCameraAt, slidersAt } from './timeline.js';
import referenceMotion from './reference-motion.json' with { type: 'json' };
import { astraMark, comet, constellation, orbit, space, spark } from './astra.js';

// In this short cut/throw gesture the hand touches the body, biasing the
// connected-component PCA. These top-edge angles were checked in adjacent frames.
const cutBodyAngles = [0, 0, 0, 0, 0, 0, -0.038, -0.033, -0.069, -0.1, -0.117, -0.114, -0.118, -0.118, 0, 0.05, 0.077, 0.091];

export { cues } from './timeline.js';
export class Renderer {
  constructor(canvas, scale = 1, fps) {
    this.timing = frameTiming(fps);
    this.canvas = canvas; this.scale = scale;
    canvas.width = W * scale; canvas.height = H * scale;
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('此浏览器无法创建 Canvas 2D。');
    this.c = c; this.texture = paperTexture(scale);
  }
  renderFrame(frameIndex) {
    const outputFrame = Math.floor(clamp(frameIndex, 0, this.timing.frames - 1));
    const f = outputFrame * BASE_FPS / this.timing.fps, c = this.c;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.lineCap = 'round'; c.lineJoin = 'round';
    c.fillStyle = C.space; c.fillRect(0, 0, W, H);
    withInkMotion(c, f, 0.55, () => {
      const camera = cameraAt(f);
      c.save(); c.translate(camera.x, camera.y); c.scale(camera.s, camera.s);
      editorBackground(c, f);
      if (f < cues.finale) { phone(c, f, 960, 362, 1); actor(c, f); flyingOffcut(c, f); }
      c.restore();
      if (f >= cues.finale) {
        const p = progress(f, cues.finale, 750);
        c.save(); c.globalAlpha *= p;
        space(c, f, 0, 0, W, H, 843, 135, '#30325b');
        c.globalAlpha *= 0.2;
        orbit(c, 995, 527, 925, 301, -0.33, C.ice, 1.4);
        orbit(c, 995, 527, 955, 315, -0.33, C.lilac, 0.8);
        c.restore();
        const zoom = progress(f, 781, 884);
        phone(c, f, mix(960, 930, zoom), mix(362, 499, p) + zoom * 9, mix(1, 1.6, p) + zoom * 0.075, p);
        finalActor(c, f, p, zoom);
        signature(c, f);
        confetti(c, f);
      }
    });
    c.drawImage(this.texture, 0, 0, W, H);
    const v = c.createRadialGradient(960, 500, 250, 960, 520, 1120); v.addColorStop(0, '#111b3600'); v.addColorStop(1, '#080f242b'); c.fillStyle = v; c.fillRect(0, 0, W, H);
    return outputFrame;
  }
}

function phone(c, f, x, y, s, final = 0) {
  const t = f / BASE_FPS;
  withTransform(c, x, y, s, 0, () => {
    c.save(); shadow(c, '#060d2566', 5, 7);
    box(c, -140, -250, 280, 498, C.ink, 34, 2); c.restore();
    c.save(); c.beginPath(); c.roundRect(-138, -248, 276, 494, 33); c.strokeStyle = '#adc5ea66'; c.lineWidth = 1.6; c.stroke(); c.restore();
    c.save(); c.beginPath(); c.roundRect(-126, -236, 252, 470, 22); c.clip();
    c.fillStyle = C.space; c.fillRect(-126, -236, 252, 470);
    const kind = clipAt(f);
    const spin = f >= cues.spin && f < 304;
    const finalSpin = f >= 751 && f < 756;
    const whoosh = f >= cues.whoosh && f < 363;
    const finalWipe = final && ((f >= 767 && f < 771) || (f >= 812 && f < 816));
    if (kind === 'empty') {
      space(c, f, -126, -236, 252, 470, 60, 25);
      c.setLineDash([6, 8]); c.strokeStyle = '#a4b9df88'; c.lineWidth = 1.6; c.strokeRect(-103, -108, 206, 170); c.setLineDash([]);
      astraMark(c, 0, -51, 31, C.yellow);
      text(c, '添加素材', 0, 20, 26, C.ice, 'center');
      text(c, '捕捉一点星光', 0, 104, 17, '#abb9d9', 'center');
    } else if (spin || finalSpin) {
      const a = spin ? cues.spin : 751, b = spin ? 304 : 756;
      const p = clamp((f - a + (spin ? 1 : 0)) / (b - a));
      const scale = 1 - Math.sin(p * Math.PI) * (spin ? 0.65 : 0.5);
      withTransform(c, 0, 0, scale, p * Math.PI * 2, () => media(c, p < 0.51 ? 'sun' : 'coffee', -126, -236, 252, 470, t));
    } else if (finalWipe) {
      const start = f < 780 ? 767 : 812;
      const p = progress(f + 0.5, start, start + 4);
      media(c, start === 767 ? 'coffee' : 'sun', -126 - p * 252, -236, 252, 470, t);
      media(c, 'cat', 126 - p * 252, -236, 252, 470, t);
    } else if (whoosh) {
      const p = progress(f, cues.whoosh, 363); media(c, 'coffee', -126 - p * 252, -236, 252, 470, t); media(c, 'cat', 126 - p * 252, -236, 252, 470, t);
    } else {
      const flow = slidersAt(f).flow;
      withInkMotion(c, f, 1.4 + flow * 1.4, () => media(c, kind, -126, -236, 252, 470, t), 0.7 + flow * 0.3);
    }
    if (spin || finalSpin) {
      const start = spin ? cues.spin : 751, end = spin ? 304 : 756;
      const p = clamp((f - start + 1) / (end - start)), angle = p * Math.PI * 2;
      c.save(); c.globalAlpha *= Math.sin(p * Math.PI) * 0.85;
      orbit(c, 0, -24, 109, 60, -0.35, C.ice, 1.8);
      comet(c, Math.cos(angle) * 104, -24 + Math.sin(angle) * 64, angle + Math.PI / 2, 56, C.lilac);
      c.restore();
    }
    if (whoosh || finalWipe) {
      const start = whoosh ? cues.whoosh : f < 780 ? 767 : 812;
      const end = whoosh ? 363 : start + 4, p = progress(f + 0.5, start, end);
      c.save(); c.globalAlpha *= Math.sin(p * Math.PI);
      comet(c, mix(-165, 185, p), -32 + p * 27, 0.08, 135, C.ice); c.restore();
    }
    if (final && ((f >= 780 && f < 784) || (f >= 825 && f < 829))) {
      // The incoming dance scene becomes visible through a four-frame white flash.
      const start = f < 800 ? 780 : 825;
      c.fillStyle = `rgba(255,254,250,${sampleValue([0.88, 0.65, 0.4, 0.15, 0], f - start)})`;
      c.fillRect(-126, -236, 252, 470);
    }
    const finalGlitch = final && f >= 795 && f < 802;
    if (finalGlitch) {
      for (let i = 0; i < 5; i++) {
        const yy = -225 + ((i * 89 + f * 37) % 435), h = 3 + i % 3 * 4;
        c.save(); c.beginPath(); c.rect(-126, yy, 252, h); c.clip();
        media(c, f < 799 ? 'sun' : 'dance', -126 + (i % 2 ? 11 : -8), -236, 252, 470, t); c.restore();
      }
    }
    // Fine horizontal speed marks are confined to the preview transitions.
    if ((f >= 366 && f < 381) || finalWipe || finalGlitch) {
      c.save(); c.globalAlpha = 0.32;
      for (let i = 0; i < 9; i++) { const xx = -130 + ((f * 19 + i * 43) % 310); line(c, [xx, -205 + i * 52, xx + 32, -205 + i * 52], '#fffefa', 2); }
      c.restore();
    }
    if (f >= 507) {
      for (let i = 0; i < 6; i++) { const xx = -120 + ((i * 67 + 7) % 240), yy = -206 + ((i * 53) % 424); const size = 3 + (i % 3) * 1.5 + Math.sin(t * 3 + i) * 1.2; spark(c, xx, yy, size, i % 3 ? C.ice : C.yellow, 0.2); }
    }
    const caption = captionAt(f);
    if (caption) {
      const y = final ? 131 : 140;
      if (!final && f >= cues.swap && f < cues.corrected) {
        // The last two characters were typed out of order and then trade places.
        const p = progress(f + 1, cues.swap, cues.corrected + 1), lift = Math.sin(p * Math.PI);
        const size = captionSize(caption);
        c.save(); c.font = `${size}px "${fontFor(caption, FONT_COMIC)}"`; c.textAlign = 'left'; c.textBaseline = 'middle';
        const head = caption.slice(0, -2), a = caption[caption.length - 2], b = caption[caption.length - 1];
        const headW = c.measureText(head).width, aW = c.measureText(a).width, bW = c.measureText(b).width;
        const x0 = -c.measureText(caption).width / 2; c.restore();
        comic(c, head, x0, y, size, '#fffefa', 0, 'left', 4);
        const ax = x0 + headW + aW / 2, bx = x0 + headW + aW + bW / 2, shift = mix(0, bx - ax, progress(f, 444, cues.corrected));
        comic(c, a, ax + shift, y - lift * 22, size, '#fffefa', 0, 'center', 4);
        comic(c, b, bx - shift, y + lift * 15, size, '#fffefa', 0, 'center', 4);
      } else comic(c, caption, 0, y, captionSize(caption), f >= cues.gold ? C.yellow : '#fffefa', -0.015, 'center', 6);
    }
    if (final && f >= cues.nailed) {
      const scales = [0.55, 0.8, 1, 1.06, 1.04, 1.02, 1];
      const scale = sampleValue(scales, f - cues.nailed);
      withTransform(c, 0, 65, scale, -0.04, () => { comic(c, '完美', 0, -9, 51, C.yellow, 0, 'center', 11); comic(c, '搞定！', 0, 43, 53, '#fffefa', 0, 'center', 11); });
    }
    if (final > 0) {
      c.save(); c.globalAlpha *= progress(f + 1, cues.social, 756);
      social(c, f);
      c.font = '20px "Patrick Hand"'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.strokeStyle = C.ink; c.lineWidth = 3.7; c.strokeText('@gpt6astra', -108, 188); c.fillStyle = '#fffefa'; c.fillText('@gpt6astra', -108, 188);
      const tags = '#星海创作 #Astra'; c.font = `15px "${fontFor(tags, FONT_HAND)}"`; c.strokeText(tags, -108, 212); c.fillText(tags, -108, 212); c.restore();
    }
    if (f >= cues.exportStart && f < cues.exportEnd) {
      c.fillStyle = '#111b36b3'; c.fillRect(-126, -236, 252, 470);
      const p = exportProgress(f); c.save(); c.translate(0, -10); c.rotate(t * 5); c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 1.5); c.lineWidth = 3; c.strokeStyle = C.ice; c.stroke(); spark(c, 0, -40, 7, C.yellow); c.restore();
      comic(c, `${Math.floor(p * 100)}%`, 0, 8, 29, '#fffefa', 0, 'center', 0);
    }
    c.restore();
    box(c, -34, -231, 68, 13, C.ink, 6, 0);
  });
}

function social(c, f) {
  withTransform(c, 94, -94, 1, 0, () => {
    path(c, 'M0 11 C-30 -6 -9 -26 0 -12 C12 -27 29 -7 0 11Z', '#ff5679', C.ink, 2.4);
    const like = mix(24.3, 98.4, progress(f, 750, 817));
    c.font = '17px "Patrick Hand"'; c.textAlign = 'center'; c.lineWidth = 2.4; c.strokeStyle = C.ink; c.strokeText(`${like.toFixed(1)}K`, 0, 26); c.fillStyle = '#fffefa'; c.fillText(`${like.toFixed(1)}K`, 0, 26);
    box(c, -15, 41, 30, 23, '#fffefa', 8, 2); path(c, 'M-7 62 L-11 68 L3 63', '#fffefa', C.ink, 1.5);
    c.font = '17px "Patrick Hand"'; c.textAlign = 'center'; c.strokeText('2.1K', 0, 78); c.fillStyle = '#fffefa'; c.fillText('2.1K', 0, 78);
    path(c, 'M-15 108 L-2 85 L3 94 L18 90Z', '#fffefa', C.ink, 2);
  });
}

function actor(c, f) {
  const t = f / BASE_FPS;
  let x = mix(-8, 300, progress(f, 0, 34)), y = 654, angle = 0, expression = 'neutral';
  if (f < 34) y -= Math.abs(Math.sin(f * 0.39)) * 9;
  if (f >= 104) x = mix(300, 515, progress(f, 104, 136));
  if (f >= 154) x = mix(515, 575, progress(f, 154, 165));
  if (f >= 237) x = mix(575, 540, progress(f, 237, 257));
  if (f >= 352) x = mix(540, 903, progress(f, 352, 376));
  if (f >= 481) x = mix(903, 1330, progress(f, 481, 504));
  const p = { x, y, angle, expression };
  if (f < 34 || (f >= 104 && f < 136) || (f >= 154 && f < 165) || (f >= 352 && f < 376) || (f >= 481 && f < 504)) p.action = 'walkRight';
  if (f >= 237 && f < 257) p.action = 'walkLeft';
  if ((f >= 88 && f < 95) || (f >= 148 && f < 153) || (f >= 417 && f < 423) || (f >= 565 && f < 572)) p.expression = 'blink';
  if (f >= 198 && f < 236) p.expression = 'happy';
  if (f >= 191 && f < 207) { p.left = 2.6; p.right = -2.7; p.y -= Math.sin(progress(f, 191, 207) * Math.PI) * 24; }
  if (f >= cues.scissors && f < cues.throw + 1) {
    p.right = -2.9;
  }
  if (f >= cues.throw && f < 174) p.right = -2.65;
  // Target offsets are preserved in world axes, then inverted by the pet rig.
  if (f >= cues.spinReach && f < 283) {
    const a = progress(f, cues.spinReach, 269) * (1 - progress(f, 276, 283));
    p.leftTarget = [mix(-135, 335 - p.x, a), mix(0, 226 - p.y, a)];
  }
  if (f >= 302 && f < 327) {
    const a = clamp((f - 302) / 25); p.angle = a * Math.PI * 4; p.y = 654 - Math.sin(a * Math.PI) * 235; p.left = 2.3; p.right = -2.4;
  }
  if (f >= 327 && f < 337) { p.expression = 'dizzy'; p.squash = 1 - Math.sin(progress(f, 327, 337) * Math.PI) * 0.18; }
  if (f >= cues.notice && f < cues.correctReach) p.action = 'think';
  if (f >= 342 && f < 351) p.right = -2.9;
  if (f >= cues.correctReach && f < 447) { const a = progress(f, cues.correctReach, 439) * (1 - progress(f, 443, 447)); p.rightTarget = [mix(140, 1025 - p.x, a), mix(0, 499 - p.y, a)]; }
  if (f >= cues.fixed && f < 479) p.expression = 'happy';
  if (f >= 498 && f < 516) { const a = progress(f, 498, 504) * (1 - progress(f, 511, 516)); p.rightTarget = [mix(137, 1730 - p.x, a), mix(0, 226 - p.y, a)]; }
  if (f >= 516 && f < 524) { const a = progress(f, 516, 520) * (1 - progress(f, 522, 524)); p.rightTarget = [mix(135, 1817 - p.x, a), mix(0, 316 - p.y, a)]; }
  if (f >= cues.maxShake && f < cues.calm) { p.left = 2.4; p.right = -2.75; }
  if (f >= cues.calm && f < 578) { const a = progress(f + 1, 569, 571) * (1 - progress(f, 574, 578)); p.rightTarget = [mix(134, mix(1810, 1535, progress(f, 570, 572)) - p.x, a), mix(0, 316 - p.y, a)]; }
  if (f >= cues.zoom && f < 600) { const a = progress(f + 1, cues.zoom, 595) * (1 - progress(f, 597, 600)); p.rightTarget = [mix(134, 1700 - p.x, a), mix(0, 406 - p.y, a)]; }
  if (f >= 600 && f < cues.beatDance) { p.left = 2.65; p.right = -2.7; p.expression = 'happy'; }
  if (f >= cues.beatDance && f < 614) { const a = clamp((f - cues.beatDance) / 10); p.x = mix(1330, 300, ease(a)); p.y = 654 - Math.sin(a * Math.PI) * 330; p.angle = -Math.PI * 2 * a; p.expression = 'happy'; p.left = 2.5; p.right = -2.5; }
  if (f >= 614 && f < cues.exportReach) {
    p.x = mix(300, 1190, clamp((f - 614) / 76)); const phase = (f - 614) / 13 * Math.PI * 2;
    p.y = 654 - Math.abs(Math.sin(phase)) * 20; p.angle = Math.sin(phase) * 0.065; p.expression = 'happy'; p.left = Math.PI / 2 + Math.sin(phase) * 0.85; p.right = -Math.PI / 2 - Math.cos(phase) * 0.9; p.stride = phase;
  }
  if (f >= cues.exportReach) {
    p.x = 1110; p.y = 654;
    if (f < 718) { const a = progress(f, cues.exportReach, 702) * (1 - progress(f, 710, 718)); p.rightTarget = [mix(133, 1745 - p.x, a), mix(0, 64 - p.y, a)]; }
    if (f >= cues.exportDone) { p.expression = 'happy'; p.y -= Math.sin(progress(f, cues.exportDone, 748) * Math.PI) * 100; p.left = 2.7; p.right = -2.7; }
  }
  applyMotion(p, f, true);
  if (f >= cues.scissors && f < 158) {
    const size = progress(f + 1, cues.scissors, 135) * 1.12, y = -40 + 50 * progress(f, 143, 150);
    p.rightTarget = [148 - 12 * size, y - 45 * size];
    scissors(c, p.x + 148, p.y + y, size, 0.03, mix(0.26, 0.17, progress(f, cues.cut - 4, cues.cut + 2)));
  }
  const flow = slidersAt(f).flow;
  if (f >= 302 && f < 337) {
    c.save(); c.globalAlpha *= progress(f, 302, 307) * (1 - progress(f, 327, 337)) * 0.7;
    orbit(c, p.x, p.y - 20, 111, 47, -0.3, C.lilac, 1.8);
    comet(c, p.x + Math.cos(t * 8) * 107, p.y - 20 + Math.sin(t * 8) * 48, t * 8 + Math.PI / 2, 49, C.ice); c.restore();
  }
  withInkMotion(c, f, 1.5 + flow * 1.2, () => { flowLines(c, f, p); character(c, p, f); }, 0.75 + flow * 0.25);
  if (f >= 55 && f < 73) bubble(c, '灵感起航！', p.x + 30, p.y - 111, 24);
  if (f >= cues.snip && f < 168) { const sz = sampleValue([50, 75, 82, 81, 80], f - cues.snip); comic(c, '咔嚓！', p.x + 122, p.y - 68, sz, C.yellow, -0.09); }
  if (f >= cues.throw && f < 192) comic(c, '走你！', mix(p.x + 225, p.x + 295, progress(f, 162, 185)), p.y - 86, mix(20, 47, progress(f, 162, 176)), '#fa8fac', 0.04);
  if (f >= 201 && f < 235) bubble(c, '清爽多了。', p.x + 2, p.y - 124, 26);
  if (f >= cues.spin && f < 305) { c.save(); c.globalAlpha *= 1 - progress(f, 299, 305); comic(c, '转起来！', p.x + 48, p.y - 67, 38, C.lilac, -0.08); c.restore(); }
  if (f >= 327 && f < 342) { for (let i = 0; i < 3; i++) star(c, p.x + Math.cos(t * 8 + i * 2.1) * 72, p.y - 72 + Math.sin(t * 8 + i * 2.1) * 11, 9, C.yellow, t); }
  if (f >= cues.whoosh && f < 370) { c.save(); c.globalAlpha *= 1 - progress(f, 365, 370); comic(c, '嗖！', p.x + 235, p.y - 11, 45, C.ice, -0.055); c.restore(); }
  if (f >= cues.notice && f < 432) { bubble(c, '嗯？', p.x - 169, p.y - 84, 25); comic(c, '?', p.x + 57, p.y - 89, 44, C.yellow, 0.1, 'center', 3); }
  if (f >= cues.fixed && f < 467) {
    c.save(); c.globalAlpha *= 1 - progress(f, 455, 467);
    const scale = sampleValue([0.55, 0.85, 1], f - cues.fixed);
    withTransform(c, 1133, 500, scale, 0, () => comic(c, '改好了！', 0, 0, 40, '#92d770', 0.1)); c.restore();
  }
  if (f >= cues.shakeLabel && f < cues.shakeLabelEnd) {
    c.save(); c.globalAlpha *= 1 - progress(f, 562, 569); comic(c, '线条动感：拉满！', 1150, 337, 38, C.coral, -0.05); c.restore();
    path(c, `M${p.x + 123} ${p.y - 57} Q${p.x + 111} ${p.y - 37} ${p.x + 124} ${p.y - 31} Q${p.x + 133} ${p.y - 37} ${p.x + 123} ${p.y - 57}`, '#8dcff1', C.ink, 1.2);
  }
  if (f >= cues.nobody && f < 593) bubble(c, '……没人看见。', p.x - 47, p.y - 114, 22);
  if (f >= cues.onBeat && f < 702) comic(c, '卡点成功！', p.x - 145, p.y - 89, 34, C.yellow, -0.05);
  if (f >= 699 && f < 714) comic(c, '导出！', 1581, 153, 43, C.teal, -0.12);
}

function flowLines(c, f, p) {
  if (f < 517 || f >= 576) return;
  const strength = slidersAt(f).flow * (1 - progress(f, cues.calm, 576));
  const curves = ['M-163 -33 Q-182 -67 -143 -87', 'M-127 -80 Q-72 -99 -21 -83', 'M39 -82 Q104 -105 151 -72', 'M162 -54 Q185 -24 170 8'];
  withTransform(c, p.x, p.y, p.scale ?? 1, 0, () => {
    c.save(); c.globalAlpha *= strength * 0.52;
    curves.forEach((d, i) => {
      const length = 19 + Math.sin(f * 0.18 + i * 1.7) * 7;
      c.setLineDash([length, 72]); c.lineDashOffset = -f * 2.2 - i * 23;
      path(c, d, undefined, i % 2 ? C.hatch : C.ink, 2.3);
    });
    c.restore();
  });
}

function finalActor(c, f, p, zoom) {
  const x = mix(1110, 1480, p), y = mix(578, 783, p) + zoom * 17;
  const s = mix(1, 1.72, p);
  const waving = f > 816, happy = f < 812 || (f >= 840 && f < 858) || f >= 889;
  c.save(); c.globalAlpha *= p;
  ellipse(c, x, y + 99 * s, 124 * s, 18, '#284568', '#9bc8e875', 1.8);
  orbit(c, x, y + 99 * s, 141 * s, 25, 0, '#9bc8e840', 1);
  ellipse(c, x, y + 99 * s, 65 * s, 7, '#14244288', '', 0);
  for (let i = 0; i < 5; i++) spark(c, x - 185 + i * 92, y + 113 * s + Math.sin(i * 2) * 7, 3.5, i % 2 ? C.ice : C.yellow);
  c.restore();
  const pose = { x, y, scale: s, angle: f < 812 ? Math.sin(f * 0.15) * 0.05 : 0, action: waving ? 'wave' : 'idle', expression: f >= 875 && f <= 887 ? 'wink' : happy ? 'happy' : 'neutral', blush: true };
  applyMotion(pose, f, false); withInkMotion(c, f, 1.6, () => character(c, pose, f), 0.8);
}

/** Measured body transforms keep scene choreography registered to the reference.
 * The vector pet uses uniform scaling; these measurements also register its reaches. */
function applyMotion(p, f, world) {
  // The old shake gag is now a line-flow gag: hold the body, not the ink.
  const motionFrame = world && f >= cues.maxShake && f < cues.calm ? cues.maxShake - 1 : world ? Math.min(f, cues.finale - 1) : f;
  const r = sampleTrack(referenceMotion, motionFrame, 4);
  const cam = world ? referenceCameraAt(motionFrame) : { s: 1, x: 0, y: 0 };
  const ox = p.x, oy = p.y;
  p.x = (r[0] - cam.x) / cam.s; p.y = (r[1] - cam.y) / cam.s;
  const s = (p.scale ?? 1) * cam.s;
  p.width = clamp(r[2] / s, 204, 230); p.height = clamp(r[3] / s, 97, 126);
  p.angle = r[4]; p.squash = 1;
  if (f >= 151 && f < 169) p.angle = sampleValue(cutBodyAngles, f - 151);
  if (p.leftTarget) p.leftTarget = [p.leftTarget[0] + ox - p.x, p.leftTarget[1] + oy - p.y];
  if (p.rightTarget) p.rightTarget = [p.rightTarget[0] + ox - p.x, p.rightTarget[1] + oy - p.y];
}

function signature(c, f) {
  if (f < 761) return;
  c.save(); c.globalAlpha *= progress(f, 761, 776);
  constellation(c, 352, 246, 75, progress(f, 767, 826));
  text(c, '30 秒，把灵感变成宇宙', 352, 371, 29, '#b7c6e3', 'center');
  if (f >= cues.signature) {
    const p = clamp((f - cues.signature + 1) / 10);
    // Reveal from each word's actual ink edge, so the first stroke lands on the cue.
    const brand = [
      { label: 'GPT-6', x: 352, y: 431, size: 41, color: C.ice, font: FONT_COMIC, weight: 400 },
      { label: 'Astra', x: 349, y: 526, size: 157, color: C.starlight, font: FONT_SCRIPT, weight: 700 },
    ];
    for (const word of brand) {
      c.save(); c.font = `${word.weight} ${word.size}px "${word.font}"`; c.textAlign = 'center';
      const bounds = c.measureText(word.label), left = word.x - bounds.actualBoundingBoxLeft - 1;
      const width = bounds.actualBoundingBoxLeft + bounds.actualBoundingBoxRight + 2;
      c.beginPath(); c.rect(left, word.y - word.size, width * p, word.size * 2); c.clip();
      text(c, word.label, word.x, word.y, word.size, word.color, 'center', word.font, word.weight); c.restore();
    }
    if (f >= 851) {
      const sweep = progress(f, 850, 866);
      const point = u => [115 * (1 - u) ** 2 + 700 * (1 - u) * u + 599 * u * u, 613 * (1 - u) ** 2 + 1130 * (1 - u) * u + 582 * u * u];
      c.save(); c.beginPath(); c.moveTo(115, 613);
      for (let i = 1; i <= 40; i++) { const [px, py] = point(i / 40 * sweep); c.lineTo(px, py); }
      c.strokeStyle = C.yellow; c.lineWidth = 3; c.stroke();
      const [px, py] = point(sweep), angle = Math.atan2(2 * (1 - sweep) * (565 - 613) + 2 * sweep * (582 - 565), 2 * (1 - sweep) * (350 - 115) + 2 * sweep * (599 - 350));
      comet(c, px, py, angle, 65 * (1 - progress(f, 866, 878)) + 6, C.yellow); c.restore();
    }
    c.save(); c.globalAlpha *= progress(f, 858, 875); text(c, '灵感，奔赴群星。', 352, 687, 35, C.ice, 'center'); c.restore();
  }
  c.restore();
}

function confetti(c, f) {
  const colors = [C.yellow, C.ice, C.lilac, C.starlight];
  const bursts = [{ frame: 747, x: 1490, y: 651, n: 32, seed: 57 }, { frame: 841, x: 918, y: 65, n: 28, seed: 21 }, { frame: 847, x: 337, y: 246, n: 24, seed: 55 }];
  for (const b of bursts) {
    const dt = (f - b.frame) / BASE_FPS; if (dt < 0) continue; const r = rand(b.seed);
    for (let i = 0; i < b.n; i++) {
      const vx = (r() - 0.5) * 510, vy = -(65 + r() * 230), spin = r() * 6, size = 2 + r() * 4;
      const x = b.x + vx * dt + Math.sin(dt * 2 + i) * dt * 9, y = b.y + vy * dt + 55 * dt * dt;
      if (y > 1120 || x < -50 || x > 1970) continue;
      if (x > 90 && x < 630 && y > 355 && y < 723) continue;
      c.save(); c.globalAlpha *= clamp(1 - dt / 4.5) * 0.7;
      spark(c, x, y, size, colors[i % colors.length], spin + dt * 0.6); c.restore();
    }
  }
}
