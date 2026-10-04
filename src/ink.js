const motion = new WeakMap();
const paths = new Map();
const TAU = Math.PI * 2;

/** Only stroke geometry moves; fills, text, and the canvas transform stay put. */
export function withInkMotion(c, frame, strength, draw, echo = 0) {
  const previous = motion.get(c);
  motion.set(c, { frame, strength, echo: Math.max(0, Math.min(1, echo)) });
  try { draw(); } finally {
    if (previous) motion.set(c, previous); else motion.delete(c);
  }
}

/** Traveling, independently phased bends rather than a shared positional jitter. */
export function strokeInk(c, contours) {
  const state = motion.get(c);
  if (!state || state.strength <= 0) return false;
  const width = c.lineWidth, alpha = c.globalAlpha;
  const amplitude = Math.min(state.strength, width * (0.4 + state.echo * 0.12));
  const strokes = [];
  for (const { points, closed } of contours) {
    if (points.length < 4) continue;
    const samples = [];
    let length = 0;
    const count = points.length / 2, segments = closed ? count : count - 1;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % count, x = points[i * 2], y = points[i * 2 + 1];
      const dx = points[j * 2] - x, dy = points[j * 2 + 1] - y;
      const size = Math.hypot(dx, dy), steps = Math.max(1, Math.ceil(size / 9));
      if (size < 0.001) continue;
      for (let k = 0; k < steps; k++) samples.push({ x: x + dx * k / steps, y: y + dy * k / steps, distance: length + size * k / steps });
      length += size;
    }
    if (!closed) samples.push({ x: points.at(-2), y: points.at(-1), distance: length });
    if (samples.length < 2 || !length) continue;
    const seed = points[0] * 0.037 + points[1] * 0.061 + length * 0.013;
    const cycles = Math.max(3, Math.min(20, Math.round(length / 75)));
    const shape = { closed, seed, samples: [] };
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const a = samples[closed ? (i + samples.length - 1) % samples.length : Math.max(0, i - 1)];
      const b = samples[closed ? (i + 1) % samples.length : Math.min(samples.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, size = Math.hypot(dx, dy) || 1;
      const u = p.distance / length;
      const phase = closed ? u * TAU * cycles : p.distance / 23;
      // Open strokes keep their attachment points fixed. Closed contours have
      // periodic waves, so there is no seam or whole-shape translation.
      const envelope = closed ? 1 : i === 0 || i === samples.length - 1 ? 0 : Math.sin(u * Math.PI);
      shape.samples.push({ x: p.x, y: p.y, nx: -dy / size, ny: dx / size, phase, detail: closed ? u * TAU * (cycles + 3) : phase * 1.6, flutter: closed ? u * TAU * (cycles + 1) : phase * 0.8, envelope });
    }
    strokes.push(shape);
  }
  const start = contours[0]?.points ?? [0, 0];
  const draw = (frame, offset, opacity, weight) => {
    const t = frame / 30;
    c.beginPath();
    for (const { samples, closed, seed } of strokes) {
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const wave = Math.sin(p.phase - t * 4.8 + seed) * 0.68 + Math.sin(p.detail + t * 3.1 + seed * 1.7) * 0.32;
        const flutter = Math.sin(p.flutter + t * 36 + seed * 2.3);
        const bend = p.envelope * (amplitude * (wave * (1 - state.echo * 0.5) + flutter * state.echo * 0.5) + offset * (0.95 + Math.sin(t * 31 + seed) * 0.05));
        const x = p.x + p.nx * bend, y = p.y + p.ny * bend;
        if (!i) c.moveTo(x, y); else c.lineTo(x, y);
      }
      if (closed) c.closePath();
    }
    c.globalAlpha = alpha * opacity;
    c.lineWidth = width * weight * (1 + Math.sin(t * 2.6 + start[0] * 0.037 + start[1] * 0.061) * Math.min(state.strength, 1) * 0.035);
    c.stroke();
  };
  try {
    if (state.echo > 0) {
      // Two thin, faint copies of earlier stroke shapes. They move along local
      // normals, not via canvas translation, and share the fixed endpoints.
      const separation = Math.min(3.2, width) * state.echo;
      draw(state.frame - 4, -separation * 0.7, state.echo * 0.1, 0.55);
      draw(state.frame - 2, separation, state.echo * 0.28, 0.68);
    }
    draw(state.frame, 0, 1, 1);
  } finally { c.globalAlpha = alpha; c.lineWidth = width; }
  return true;
}

export function roundContour(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (!r) return { points: [x, y, x + w, y, x + w, y + h, x, y + h], closed: true };
  const points = [], steps = Math.max(3, Math.ceil(r * Math.PI / 18));
  const corners = [[x + w - r, y + r], [x + w - r, y + h - r], [x + r, y + h - r], [x + r, y + r]];
  corners.forEach(([cx, cy], i) => {
    for (let j = 0; j <= steps; j++) { const a = (i - 1) * Math.PI / 2 + j / steps * Math.PI / 2; points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  });
  return { points, closed: true };
}

export function ellipseContour(x, y, rx, ry) {
  const points = [], steps = Math.max(16, Math.ceil(TAU * Math.max(rx, ry) / 9));
  for (let i = 0; i < steps; i++) { const a = i / steps * TAU; points.push(x + Math.cos(a) * rx, y + Math.sin(a) * ry); }
  return { points, closed: true };
}

/** The artwork uses M/L/Q/C/Z. Unsupported SVG commands retain native strokes. */
export function pathContours(d) {
  if (paths.has(d)) return paths.get(d);
  const result = samplePath(d);
  // Animated steam curves create new strings; don't grow a cache every loop.
  if (paths.size >= 256) paths.delete(paths.keys().next().value);
  paths.set(d, result);
  return result;
}

function samplePath(d) {
  const tokens = d.match(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const contours = [];
  let i = 0, command = '', x = 0, y = 0, points = [];
  const flush = (closed = false) => { if (points.length) contours.push({ points, closed }); points = []; };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
    const kind = command.toUpperCase(), relative = command !== kind;
    if (kind === 'Z') { x = points[0] ?? x; y = points[1] ?? y; flush(true); command = ''; continue; }
    const n = kind === 'M' || kind === 'L' ? 2 : kind === 'Q' ? 4 : kind === 'C' ? 6 : 0;
    if (!n || i + n > tokens.length) return null;
    const values = tokens.slice(i, i + n).map(Number); i += n;
    if (!values.every(Number.isFinite)) return null;
    if (relative) for (let j = 0; j < n; j += 2) { values[j] += x; values[j + 1] += y; }
    if (kind === 'M') { flush(); [x, y] = values; points.push(x, y); command = relative ? 'l' : 'L'; }
    else if (kind === 'L') { [x, y] = values; points.push(x, y); }
    else {
      if (!points.length) return null;
      const endX = values[n - 2], endY = values[n - 1];
      let length = 0, px = x, py = y;
      for (let j = 0; j < n; j += 2) { length += Math.hypot(values[j] - px, values[j + 1] - py); px = values[j]; py = values[j + 1]; }
      const steps = Math.max(4, Math.ceil(length / 9));
      for (let j = 1; j <= steps; j++) {
        const u = j / steps, v = 1 - u;
        if (kind === 'Q') points.push(v * v * x + 2 * v * u * values[0] + u * u * endX, v * v * y + 2 * v * u * values[1] + u * u * endY);
        else points.push(v ** 3 * x + 3 * v * v * u * values[0] + 3 * v * u * u * values[2] + u ** 3 * endX, v ** 3 * y + 3 * v * v * u * values[1] + 3 * v * u * u * values[3] + u ** 3 * endY);
      }
      x = endX; y = endY;
    }
  }
  flush();
  return contours;
}
