import { C, box, comic, ellipse, hatch, line, path, progress, text, star, mix, shadow, withTransform, clamp } from './sketch.js';
import { media, transitionIcon } from './media.js';
import { cues, captionChipAt, exportProgress, playheadAt, slidersAt } from './timeline.js';
import { astraMark, constellation, orbit, planet, space, spark } from './astra.js';

export function scissors(c, x, y, s, angle = 0, opening = 0.5) {
  withTransform(c, x, y, s, angle, () => {
    for (const sign of [-1, 1]) withTransform(c, 0, 0, 1, sign * opening, () => {
      path(c, 'M-4 -30 L-5 146 L7 139 L6 -25Z', '#fffef8', C.ink, 3);
      ellipse(c, 0, -51, 17, 25, '#ff647f', C.ink, 3); ellipse(c, 0, -51, 9, 17, '#fffef8', C.ink, 2);
    });
    ellipse(c, 0, 0, 5, 5, '#b2aea6', C.ink, 2);
  });
}

export function editorBackground(c, f) {
  c.save(); shadow(c, '#070e2555', 8, 12);
  box(c, 50, 28, 1820, 1020, C.paper, 27, 3.5); c.restore();
  space(c, f, 54, 102, 1812, 522, 6006, 95);
  c.save(); c.globalAlpha *= 0.28;
  orbit(c, 960, 362, 425, 164, -0.2, C.ice, 1.5);
  orbit(c, 960, 362, 442, 171, -0.2, C.lilac, 0.8);
  constellation(c, 595, 297, 58, 1, C.ice); c.restore();
  c.save(); c.globalAlpha *= 0.68; planet(c, 1315, 404, 39); c.restore();
  spark(c, 1245, 234, 8, C.yellow, 0.2);
  text(c, '灵感观测中', 500, 548, 21, '#b8c3e0');
  text(c, 'ASTRA / 06', 1375, 571, 16, '#b8c3e0', 'right');
  box(c, 50, 28, 1820, 74, C.panel, 21, 3);
  astraMark(c, 91, 65, 24, '#727cad');
  text(c, 'GPT-6 Astra', 133, 66, 34);
  box(c, 870, 43, 180, 44, C.well, 11, 2.6);
  const seconds = String(Math.floor(f / 30)).padStart(2, '0'); const frames = String(f % 30).padStart(2, '0');
  text(c, `00:00:${seconds}:${frames}`, 960, 66, 28, C.ink, 'center');
  box(c, 1520, 44, 98, 43, C.well, 9, 2.7); text(c, '1080p', 1569, 65, 25, C.ink, 'center');
  const done = f >= cues.exportDone;
  box(c, 1650, 40, 190, 50, done ? '#8dcabf' : C.teal, 12, 3); hatch(c, 1650, 40, 190, 50, 9, '#305f8c', 0.15);
  comic(c, done ? '完成 ✓' : '导出', 1745, 66, 40, '#fffef8', 0, 'center', 4);
  if (f >= cues.exportStart && f < 751) {
    box(c, 1200, 47, 420, 34, C.well, 8, 2);
    const p = exportProgress(f); c.save(); roundClip(c, 1203, 50, 414, 28, 6); c.fillStyle = C.yellow; c.fillRect(1203, 50, 414 * p, 28); c.restore();
    text(c, done ? '100% ✓' : `渲染中… ${Math.floor(p * 100)}%`, 1410, 65, 17, C.ink, 'center');
  }
  palette(c, f); adjustments(c, f); timeline(c, f);
}
function roundClip(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); c.clip(); }

function palette(c, f) {
  box(c, 70, 114, 360, 500, C.panel, 17, 3.2);
  const mode = f >= cues.textPanel && f < cues.beatDance ? 2 : f >= cues.transitions && f < cues.textPanel ? 1 : 0;
  const selectedTab = f >= cues.textTab && f < cues.beatDance ? 2 : mode;
  ['素材', '转场', '文字'].forEach((s, i) => { box(c, 85 + i * 111, 127, 105, 40, i === selectedTab ? C.yellow : C.well, 10, 2.5); text(c, s, 137 + i * 111, 148, 25, C.ink, 'center'); });
  const kinds = ['sun', 'coffee', 'cat', 'dance'];
  const names = ['星球日出.mp4', '银河咖啡.mp4', '太空猫.mov', '星际舞台.mp4'];
  const transitionIcons = ['Whoosh', 'Spin', 'Glitch', 'Zoom', 'Slide', 'Fade'];
  const transitions = ['彗星', '星轨', '故障', '缩放', '滑入', '淡化'];
  for (let i = 0; i < 6; i++) {
    const x = 90 + i % 2 * 170, y = 180 + Math.floor(i / 2) * 141;
    box(c, x, y, 150, 118, C.panel, 9, 2.5);
    if (mode === 0) {
      if (i < 4) { c.save(); roundClip(c, x + 5, y + 5, 140, 83, 5); media(c, kinds[i], x + 5, y + 5, 140, 83, i * 0.4, true); c.restore(); text(c, names[i], x + 75, y + 102, 18, C.ink, 'center'); }
      else text(c, '+', x + 75, y + 57, 43, C.edge, 'center');
    } else if (mode === 1) { transitionIcon(c, transitionIcons[i], x + 75, y + 43, 1.14); text(c, transitions[i], x + 75, y + 98, 21, C.ink, 'center'); }
    else {
      if (i % 2 === 0) { transitionIcon(c, transitionIcons[i], x + 75, y + 43, 1.14); text(c, transitions[i], x + 75, y + 98, 21, C.ink, 'center'); }
      else { const j = Math.floor(i / 2); comic(c, 'AA', x + 75, y + 43, 48, [C.yellow, '#fa90ae', '#8f73e0'][j], 0, 'center', j === 2 ? 0 : 4); text(c, ['弹跳', '泡泡', '霓虹'][j], x + 75, y + 98, 21, C.ink, 'center'); }
    }
  }
}

function adjustments(c, f) {
  box(c, 1490, 114, 360, 500, C.panel, 17, 3.2);
  text(c, '调整', 1515, 150, 31); star(c, 1591, 149, 13);
  const s = slidersAt(f); const values = [s.sparkle, s.flow, s.zoom, 1 / 3];
  ['闪光', '线条动感', '冲击缩放', '速度'].forEach((name, i) => {
    const y = 190 + i * 90, value = values[i];
    text(c, name, 1520, y, 26);
    const label = i === 3 ? '1.0x' : value > 0.99 ? '拉满！' : `${Math.round(value * 100)}%`;
    text(c, label, 1820, y, 24, value > 0.99 ? C.coral : C.ink, 'right');
    box(c, 1520, y + 30, 300, 12, C.well, 6, 2.5);
    if (value > 0) { c.save(); roundClip(c, 1520, y + 30, 300, 12, 6); c.fillStyle = value > 0.99 ? C.coral : C.teal; c.fillRect(1520, y + 30, 300 * value, 12); c.restore(); }
    ellipse(c, 1520 + value * 300, y + 36, 14.5, 15, C.panel, C.ink, 2.7);
  });
}

function clip(c, kind, x, y, w, t, color, boring = false) {
  c.save(); shadow(c, '#28355d22', 3, 4); box(c, x, y, w, 100, color, 9, 3); c.restore();
  c.save(); roundClip(c, x + 5, y + 5, w - 10, 90, 5);
  const n = boring ? 6 : 3, cell = w / n;
  for (let j = 0; j < n; j++) {
    media(c, boring && j >= 3 ? 'boring' : kind, x + j * cell, y + 5, cell, 90, t + j * 0.23, true);
    if (j) line(c, [x + j * cell, y + 5, x + j * cell, y + 95], color + 'b0', 1.8);
  }
  c.restore();
  c.save(); c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.roundRect(x + 4, y + 4, w - 8, 92, 5); c.stroke(); c.restore();
}

function timeline(c, f) {
  box(c, 70, 624, 1780, 414, C.panel, 18, 3.2);
  line(c, [150, 752, 1830, 752], C.edge, 2);
  for (let i = 0; i <= 80; i++) {
    const x = 150 + i * 21; const major = i % 10 === 0;
    line(c, [x, 674 - (major ? 24 : i % 5 === 0 ? 15 : 13), x + Math.sin(i * 3) * 1.4, 674], C.muted, major ? 2 : 1.5);
    if (major) text(c, `0:${String(i / 5).padStart(2, '0')}`, x + 4, 650, 17, C.muted);
  }
  const labels = [{ y: 688, h: 50, label: 'T' }, { y: 753, h: 98, label: '▶' }, { y: 866, h: 69, label: '♪' }];
  labels.forEach(({ y, h, label }) => { box(c, 80, y, 58, h, C.well, 8, 2); text(c, label, 109, y + h / 2, 27, C.ink, 'center'); });
  if (f < 90) { c.save(); c.globalAlpha *= 1 - progress(f, 50, 80); text(c, '把灵感拖到这里 ↓', 960, 806, 29, C.muted, 'center'); c.restore(); }
  if (f >= cues.audio) {
    c.save(); c.beginPath(); c.rect(145, 860, 1690 * progress(f, cues.audio, 50), 90); c.clip();
    box(c, 150, 870, 1680, 60, '#dce6f4', 8, 2.2);
    for (let i = 0; i < 250; i++) { const x = 158 + i * 6.7; const height = i % 13 === 0 ? 53 : 14 + Math.abs(Math.sin(i * 1.76) * 15 + Math.cos(i * 0.49) * 15); line(c, [x, 900 - height / 2, x, 900 + height / 2], C.teal, 2.8); }
    box(c, 163, 873, 185, 25, C.panel, 10, 2); text(c, '♪ astra_orbit.wav', 178, 885, 20, '#50769c'); c.restore();
  }
  const gap = 300 * (1 - progress(f, cues.closeGap, 201));
  const specs = [
    { kind: 'sun', start: cues.sun, land: cues.sunLand, x: 150, w: 280, color: C.yellow },
    { kind: 'coffee', start: cues.coffee, land: cues.coffeeLand, x: 440, w: f < cues.cut ? 560 : 260, color: '#cf9cbf' },
    { kind: 'cat', start: cues.cat, land: cues.catLand, x: 710 + gap, w: 280, color: C.lilac },
    { kind: 'dance', start: cues.dance, land: cues.danceLand, x: 1000 + gap, w: 280, color: C.teal },
  ];
  for (const [i, item] of specs.entries()) {
    if (f < item.start) continue;
    const p = progress(f + 1, item.start, item.land + 1);
    if (f < item.land + 8) {
      const sx = 90 + i % 2 * 170, sy = 180 + Math.floor(i / 2) * 141;
      c.save();
      for (let j = 1; j <= 8; j++) {
        if (f + 1 - j < item.start) continue;
        const tail = progress(f + 1 - j, item.start, item.land + 1);
        const tx = mix(sx, item.x, tail) + mix(150, item.w, tail) / 2;
        const ty = mix(sy, 752, tail) - Math.sin(tail * Math.PI) * 90 + 60 + Math.sin(j * 2.4) * 12;
        c.globalAlpha = (1 - j / 9) * 0.75 * (1 - progress(f, item.land, item.land + 8));
        spark(c, tx, ty, 3 + j % 3, j % 2 ? C.yellow : C.ice, j * 0.3);
      }
      c.restore();
    }
    if (p < 1) {
      const sx = 90 + i % 2 * 170, sy = 180 + Math.floor(i / 2) * 141;
      const fx = mix(sx, item.x, p), fy = mix(sy, 752, p) - Math.sin(p * Math.PI) * 90;
      const fw = mix(150, item.w, p), fh = mix(118, 100, p);
      c.save(); c.translate(fx + fw / 2, fy + fh / 2); c.rotate(-Math.sin(p * Math.PI) * .08);
      box(c, -fw / 2, -fh / 2, fw, fh, C.panel, 9, 2.5);
      media(c, item.kind, -fw / 2 + 5, -fh / 2 + 5, fw - 10, fh - 10, item.start / 30, true); c.restore();
    } else clip(c, item.kind, item.x, 752, item.w, item.start / 30, item.color, item.kind === 'coffee' && f < cues.cut);
  }
  if (f > 128 && f < cues.cut) { box(c, 760, 712, 195, 26, C.panel, 7, 1.5); text(c, '无聊片段 zzz', 857, 725, 19, C.muted, 'center'); }
  if (f >= cues.cut && f < cues.throw) clip(c, 'boring', 710, 752, 300, 4.5, '#a6adc7');
  if (f >= cues.throw && f < 201) { c.save(); c.setLineDash([9, 8]); c.strokeStyle = C.coral; c.lineWidth = 2.5; c.strokeRect(710, 756, Math.max(1, gap - 10), 92); c.restore(); }
  if (f >= cues.spin) { box(c, 416, 777, 49, 49, C.panel, 12, 2.7); transitionIcon(c, 'Spin', 441, 801, 0.77); }
  if (f >= cues.whoosh) { box(c, 677, 777, 50, 49, C.panel, 12, 2.7); transitionIcon(c, 'Whoosh', 702, 801, 0.76); }
  if (f >= cues.wait) { box(c, 715, 695, 271, 40, f < cues.gold ? '#fff3c8' : C.yellow, 8, 2.3); comic(c, captionChipAt(f), 730, 715, 20, C.ink, 0, 'left', 0); }
  const head = playheadAt(f);
  if (f >= cues.beatDance) {
    c.save(); c.setLineDash([3, 9]); line(c, [350, 961, 1700, 961], C.edge, 1.2); c.restore();
    for (let i = 0; i < 10; i++) {
      const x = 350 + i * 150; const active = x <= head || f >= 705;
      c.save(); c.globalAlpha *= active ? 1 : 0.26;
      star(c, x, 961, 12, active ? C.yellow : C.lilac, 0.15); c.restore();
    }
  }
  const hc = f >= cues.beatDance && f < cues.exportStart ? '#9a82cd' : C.coral;
  line(c, [head, 650, head, 984], hc, 3);
  path(c, `M${head - 12} 637 L${head + 12} 637 L${head + 12} 649 L${head} 661 L${head - 12} 649Z`, hc, C.ink, 2);
}

export function flyingOffcut(c, f) {
  if (f < cues.throw || f >= 190) return;
  const p = (f - cues.throw) / 29;
  withTransform(c, mix(900, 1850, p), 760 - Math.sin(p * Math.PI) * 310 - p * 550, 1 - p * 0.15, 0.24 + p * 3.8, () => clip(c, 'boring', -140, -50, 280, f / 30, '#a6adc7'));
}
