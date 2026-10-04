import { C, clamp, ellipse, line, mix, path, rand, withTransform } from './sketch.js';

const TAU = Math.PI * 2;

/** Small native vector glints: bright on space, without a heavy cartoon outline. */
export function spark(c, x, y, size, color = C.starlight, angle = 0) {
  withTransform(c, x, y, 1, angle, () => {
    c.beginPath();
    c.moveTo(0, -size);
    c.quadraticCurveTo(size * 0.16, -size * 0.16, size, 0);
    c.quadraticCurveTo(size * 0.16, size * 0.16, 0, size);
    c.quadraticCurveTo(-size * 0.16, size * 0.16, -size, 0);
    c.quadraticCurveTo(-size * 0.16, -size * 0.16, 0, -size);
    c.fillStyle = color; c.fill();
  });
}

/** Fixed positions and slowly changing brightness, driven only by the video frame. */
export function starfield(c, f, x, y, w, h, seed = 6, count = 65) {
  const random = rand(seed);
  c.save();
  const opacity = c.globalAlpha;
  for (let i = 0; i < count; i++) {
    const sx = x + random() * w, sy = y + random() * h;
    const size = 0.65 + random() * 1.45, phase = random() * TAU;
    c.globalAlpha = opacity * (0.45 + Math.sin(f * 0.022 + phase) * 0.19);
    const color = i % 7 === 0 ? C.yellow : i % 3 === 0 ? C.ice : C.starlight;
    if (i % 11 === 0) spark(c, sx, sy, size * 2.8, color, 0.15);
    else { c.beginPath(); c.arc(sx, sy, size, 0, TAU); c.fillStyle = color; c.fill(); }
  }
  c.restore();
}

/** `radius` rounds the sky so a well can tuck its corners behind the panels that frame it. */
export function space(c, f, x, y, w, h, seed = 6, count = 65, tint = C.dusk, radius = 0) {
  c.save(); c.beginPath();
  if (radius > 0) c.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2)); else c.rect(x, y, w, h);
  c.clip();
  const base = c.createLinearGradient(x, y, x + w * 0.75, y + h);
  base.addColorStop(0, C.space); base.addColorStop(0.6, tint); base.addColorStop(1, '#1a2546');
  c.fillStyle = base; c.fillRect(x, y, w, h);
  // Elliptical washes keep the paper-and-ink feeling rather than a photographic sky.
  c.save(); c.translate(x, y); c.scale(w, h);
  for (const [cx, cy, radius, color] of [[0.28, 0.28, 0.7, '#aa80d32b'], [0.82, 0.74, 0.55, '#72bbd522']]) {
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, color); glow.addColorStop(1, color.slice(0, 7) + '00');
    c.fillStyle = glow; c.fillRect(0, 0, 1, 1);
  }
  c.restore();
  starfield(c, f, x, y, w, h, seed, count);
  c.restore();
}

export function orbit(c, x, y, rx, ry, angle = -0.3, color = C.ice, width = 1.3, start = 0, end = TAU) {
  c.save(); c.beginPath(); c.ellipse(x, y, rx, ry, angle, start, end);
  c.strokeStyle = color; c.lineWidth = width; c.stroke(); c.restore();
}

export function astraMark(c, x, y, size, color = C.yellow) {
  orbit(c, x, y, size, size * 0.38, -0.55, color, Math.max(1, size * 0.045));
  spark(c, x, y, size * 0.72, color);
  ellipse(c, x + size * 0.84, y - size * 0.51, size * 0.11, size * 0.11, color, '', 0);
}

/** Six fixed stars connect into Astra's A; reveal is a timeline value, not draw history. */
export function constellation(c, x, y, size, reveal = 1, color = C.ice) {
  const points = [[-0.78, 0.9], [-0.35, -0.08], [0, -1], [0.35, -0.08], [0.78, 0.9], [0, -0.08]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 3]];
  withTransform(c, x, y, size, 0, () => {
    edges.forEach(([a, b], i) => {
      const p = clamp(reveal * edges.length - i);
      if (!p) return;
      c.save(); c.globalAlpha *= 0.58;
      line(c, [...points[a], mix(points[a][0], points[b][0], p), mix(points[a][1], points[b][1], p)], color, 1.4 / size);
      c.restore();
    });
    points.forEach(([px, py], i) => {
      const p = clamp(reveal * 4 - i * 0.35);
      if (p) { c.save(); c.globalAlpha *= p; spark(c, px, py, (i === 2 ? 8 : 4.5) / size, i === 2 ? C.yellow : color); c.restore(); }
    });
  });
}

export function planet(c, x, y, radius, warm = false) {
  withTransform(c, x, y, 1, -0.28, () => {
    const ring = warm ? C.starlight : C.ice;
    orbit(c, 0, 0, radius * 1.8, radius * 0.43, 0, ring + '80', radius * 0.07);
    const fill = c.createLinearGradient(-radius, -radius, radius, radius);
    fill.addColorStop(0, warm ? '#ffe8af' : '#d6d7fa');
    fill.addColorStop(0.55, warm ? '#e7b378' : '#aaa5de');
    fill.addColorStop(1, warm ? '#b77886' : '#657caf');
    c.save(); c.beginPath(); c.arc(0, 0, radius, 0, TAU); c.fillStyle = fill; c.fill(); c.clip();
    for (let i = 0; i < 4; i++) {
      const yy = -radius * 0.6 + i * radius * 0.44;
      path(c, `M${-radius} ${yy} Q0 ${yy + radius * 0.4} ${radius} ${yy - radius * 0.12}`, undefined, warm ? '#ad709b45' : '#647fb64d', radius * 0.13);
    }
    c.restore();
    orbit(c, 0, 0, radius, radius, 0, C.ink, 1.8);
    orbit(c, 0, 0, radius * 1.8, radius * 0.43, 0, ring, radius * 0.055, 0, Math.PI);
    orbit(c, 0, 0, radius * 1.95, radius * 0.5, 0, ring + '55', 1.1, 0.1, Math.PI - 0.1);
  });
}

export function comet(c, x, y, angle, length = 100, color = C.ice) {
  withTransform(c, x, y, 1, angle, () => {
    const tail = c.createLinearGradient(-length, 0, 0, 0);
    tail.addColorStop(0, color + '00'); tail.addColorStop(1, color + 'c0');
    c.beginPath(); c.moveTo(-length, 0); c.quadraticCurveTo(-length * 0.3, -6, 0, -2);
    c.lineTo(0, 2); c.quadraticCurveTo(-length * 0.3, 5, -length, 0);
    c.fillStyle = tail; c.fill();
    spark(c, 0, 0, 7, C.starlight);
  });
}
