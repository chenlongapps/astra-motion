import { C, box, ellipse, hatch, line, path, star, text, withTransform, clamp } from './sketch.js';
import { character } from './character.js';
import { astraMark, constellation, orbit, planet, space, spark } from './astra.js';

/** Shared normalized artwork (260 × 480). Thumbnail aspect ratios are composed separately. */
export function media(c, kind, x, y, w, h, t, thumbnail = false) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); c.scale(w / 260, h / 480);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const frame = Math.round(t * 30), ar = thumbnail ? (w / h) * (480 / 260) : 1;
  if (kind === 'sun') {
    space(c, frame, 0, 0, 260, 480, 61, thumbnail ? 16 : 38, '#59456c');
    const horizon = c.createLinearGradient(0, 270, 0, 430);
    horizon.addColorStop(0, '#e0a0b100'); horizon.addColorStop(1, '#e0a0b1a0');
    c.fillStyle = horizon; c.fillRect(0, 270, 260, 210);
    const cy = thumbnail ? 230 : 218 + Math.sin(t * 1.5) * 8;
    withTransform(c, 130, cy, 1, 0, () => {
      c.scale(1, ar);
      const halo = c.createRadialGradient(0, 0, 28, 0, 0, 88);
      halo.addColorStop(0, '#f2ce7838'); halo.addColorStop(1, '#f2ce7800');
      c.fillStyle = halo; c.fillRect(-90, -90, 180, 180);
      planet(c, 0, 0, 47, true);
      spark(c, -95, -57, 5, C.starlight);
    });
    path(c, 'M-30 404 Q110 321 290 409 L290 500 L-30 500Z', '#797ca5', C.ink, 2.5);
    path(c, 'M-30 433 Q94 355 292 445 L290 500 L-30 500Z', '#46567f', C.ink, 2.5);
    orbit(c, 48, 423, 25, 6, -0.1, '#b1b8d06b', 1.5);
    orbit(c, 203, 444, 32, 8, 0.16, '#b1b8d06b', 1.5);
    path(c, 'M105 419 Q141 410 163 424 M-5 465 Q64 443 121 462', undefined, '#b1b8d06b', 1.5);
  } else if (kind === 'coffee') {
    space(c, frame, 0, 0, 260, 480, 62, thumbnail ? 12 : 30, '#44375e');
    c.save(); c.globalAlpha *= 0.33; orbit(c, 145, 193, 165, 66, -0.55, C.lilac, 1.2); c.restore();
    c.fillStyle = '#5d618b'; c.fillRect(0, 353, 260, 127); line(c, [0, 353, 260, 353], '#ada9d4', 2);
    if (!thumbnail) { planet(c, 218, 83, 14); spark(c, 46, 109, 6, C.yellow); }
    c.save(); c.translate(129, thumbnail ? 354 : 342); c.scale(thumbnail ? 0.7 : 1, (thumbnail ? 0.7 : 1) * ar);
    ellipse(c, 0, 10, 77, 12, '#a9b9da', C.ink, 2.5);
    c.beginPath(); c.ellipse(45, -61, 32, 31, 0, -Math.PI / 2, Math.PI / 2); c.strokeStyle = C.ink; c.lineWidth = 7; c.stroke();
    box(c, -49, -134, 97, 134, C.panel, 12, 3.5); hatch(c, -49, -134, 97, 134, 7, '#8c94bb', 0.18);
    ellipse(c, 0, -127, 40, 5, '#62587e', C.ink, 1.5);
    box(c, -49, -94, 97, 62, C.dusk, 1, 1.5, false);
    astraMark(c, 0, -64, 21, C.yellow);
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(t * 2 + i) * 4;
      path(c, `M${-27 + i * 23} -143 C${-38 + i * 23 + a} -155 ${-12 + i * 23 - a} -173 ${-25 + i * 23} -190`, undefined, i === 1 ? C.lilac : C.ice, 2);
      spark(c, -25 + i * 23, -200 + Math.sin(t * 2 + i) * 4, 3.5, C.starlight);
    }
    c.restore();
    path(c, 'M26 408 Q108 390 222 411', undefined, '#a8aed14d', 1.6);
  } else if (kind === 'cat') {
    space(c, frame, 0, 0, 260, 480, 63, thumbnail ? 12 : 36, '#493d73');
    if (!thumbnail) { c.save(); c.globalAlpha *= 0.7; constellation(c, 64, 85, 30); c.restore(); }
    c.save(); c.translate(130, 266); c.scale(1, ar);
    ellipse(c, 0, -9, 113, 115, '#bedbfc12', '#bdd4ed', 2.5);
    path(c, 'M-94 -40 Q-87 -78 -63 -91', undefined, '#f7f5fc88', 5);
    box(c, -48, 76, 96, 17, '#b3c8e4', 8, 2.5);
    path(c, 'M-65 -39 L-60 -89 L-19 -61 M24 -62 L60 -89 L65 -38', C.gray, C.ink, 4);
    path(c, 'M-54 -71 L-50 -48 L-29 -57 M34 -55 L51 -73 L53 -45', '#dcb6d6', C.ink, 0);
    box(c, -78, -63, 156, 132, C.gray, 47, 4); c.save(); c.beginPath(); c.roundRect(-76, -61, 152, 128, 44); c.clip(); hatch(c, -78, -63, 156, 132, 5, '#535f8d', 0.28); c.restore();
    const blink = !thumbnail && ((frame >= 463 && frame <= 465) || Math.sin(t * 1.9) > 0.995);
    for (const xx of [-29, 29]) { if (blink) line(c, [xx - 12, -5, xx + 12, -5], C.ink, 3); else { ellipse(c, xx, -5, 13, 17, C.yellow, C.ink, 3); ellipse(c, xx, -5, 4, 13, C.ink, '', 0); } }
    path(c, 'M-7 15 L0 23 L8 15Z', '#b57d9f', C.ink, 3);
    path(c, 'M0 24 Q-5 40 -17 27 L17 27 Q6 42 0 24', undefined, C.ink, 3);
    for (const side of [-1, 1]) { line(c, [side * 40, 14, side * 97, 4], C.ink, 2.4); line(c, [side * 39, 29, side * 99, 31], C.ink, 2.4); }
    spark(c, 96, -83, 9, C.yellow);
    c.restore();
  } else if (kind === 'dance') {
    space(c, frame, 0, 0, 260, 480, 64, thumbnail ? 14 : 34, '#284769');
    const pulse = Math.pow(0.5 + Math.cos(t * Math.PI * 4) * 0.5, 6);
    c.save(); c.globalAlpha *= 0.3 + pulse * 0.2;
    orbit(c, 130, 235, 146, 71, -0.5, C.ice, 1.6);
    orbit(c, 130, 235, 154, 76, -0.5, C.lilac, 0.7); c.restore();
    path(c, 'M-30 389 Q130 347 290 389 L290 500 L-30 500Z', '#345478', C.ink, 2.5);
    orbit(c, 130, 380, 126, 22, 0, '#a4deee80', 2);
    ellipse(c, 130, 379, 48, 7, '#142c4866', '', 0);
    const lights = [[35, 78, 5], [114, 106, 6], [208, 141, 8], [58, 177, 5], [239, 61, 4]];
    lights.forEach(([sx, sy, size], i) => withTransform(c, sx, sy, 1, 0, () => {
      c.scale(1, ar); spark(c, 0, 0, size + pulse * 3, i % 2 ? C.ice : C.yellow, 0.15);
    }));
    const phase = t * Math.PI * 4 - 0.7;
    c.save(); c.translate(130, thumbnail ? 225 : 278 - Math.abs(Math.sin(phase)) * 12); c.scale(1, ar);
    const size = thumbnail ? Math.min(1.01, h / w * 260 * 0.78 / 157) : 1.01;
    character(c, { x: 0, y: 0, scale: size, angle: Math.sin(phase * 0.5) * 0.1, action: 'celebrate' }, Math.floor(t * 30)); c.restore();
  } else {
    c.fillStyle = '#dadeeb'; c.fillRect(0, 0, 260, 480);
    c.save(); c.translate(130, 240); c.scale(1, (w / h) * (480 / 260));
    for (let i = 0; i < 9; i++) { c.save(); c.globalAlpha *= (i + 1) / 12; const a = i * Math.PI * 2 / 9 + t * 3; line(c, [Math.cos(a) * 11, Math.sin(a) * 11, Math.cos(a) * 25, Math.sin(a) * 25], C.muted, 4); c.restore(); }
    text(c, '缓冲中…', 0, 43, 20, C.muted, 'center'); text(c, 'z', 49, -41, 28, C.muted); text(c, 'z', 66, -62, 18, C.muted); c.restore();
  }
  c.restore();
}

export function transitionIcon(c, kind, x, y, s = 1) {
  withTransform(c, x, y, s, 0, () => {
    if (kind === 'Spin') {
      orbit(c, 0, 0, 26, 12, -0.5, C.ink, 2.5); star(c, 0, 0, 12, C.lilac); ellipse(c, 23, -12, 4, 4, C.yellow, C.ink, 1.5);
    } else if (kind === 'Whoosh') { [-9, 0, 9].forEach(v => line(c, [-25, v + 7, 3, v], C.teal, 2.8)); star(c, 15, -3, 15, C.yellow, 0.15); }
    else if (kind === 'Glitch') { line(c, [-23, 17, -9, -7, 2, 17, 12, -6, 28, 17], C.ink, 3); line(c, [-20, -12, -10, -12], '#ed809f', 6); line(c, [8, 26, 20, 26], '#5bbbe4', 6); }
    else if (kind === 'Zoom') { ellipse(c, -5, -5, 15, 16, '#fffefa', C.ink, 3); line(c, [7, 8, 23, 25], C.ink, 5); }
    else if (kind === 'Slide') { box(c, -24, -18, 21, 31, C.yellow, 2, 3); box(c, 5, -18, 21, 31, C.teal, 2, 3); }
    else { for (let i = 0; i < 4; i++) { c.fillStyle = `rgba(41,50,79,${clamp((i + 1) / 4)})`; c.fillRect(-24 + 13 * i, -17, 11, 30); } }
  });
}
