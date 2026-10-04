import timing from './timing.json' with { type: 'json' };
import { ellipseContour, pathContours, roundContour, strokeInk } from './ink.js';

export { withInkMotion } from './ink.js';

export const W = 1920;
export const H = 1080;
export const FPS = timing.fps;
export const FRAMES = timing.frames;
export const C = {
  ink: '#29324f', paper: '#e5e6f3', panel: '#f7f5fc', orange: '#e4aa7d',
  hatch: '#8783b2', yellow: '#f2ce78', pink: '#ead6ed', coral: '#da759f',
  teal: '#649cc4', mint: '#d1e9f3', purple: '#ded8f5', gray: '#a1aacb',
  space: '#111b36', dusk: '#28355d', ice: '#a4deee', lilac: '#b7a5eb',
  starlight: '#fff4d4', muted: '#737c9b', edge: '#c4c9df', well: '#e4e5f0',
};
export const FONT_HAND = 'Patrick Hand';
export const FONT_COMIC = 'Lilita One';
export const FONT_SCRIPT = 'Caveat';
export const FONT_CJK = 'ZCOOL KuaiLe';
// Chinese copy is drawn with the bundled Chinese font; Latin stays in the hand-drawn fonts.
const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
export const fontFor = (s, latin) => (cjk.test(s) ? FONT_CJK : latin);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const mix = (a, b, p) => a + (b - a) * p;
export const ease = p => { p = clamp(p); return p * p * (3 - 2 * p); };
export const progress = (t, a, b) => ease((t - a) / (b - a));
export const out = p => 1 - Math.pow(1 - clamp(p), 3);
export function rand(seed) {
  let a = seed | 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function line(c, pts, color = C.ink, width = 3) {
  c.strokeStyle = color; c.lineWidth = width;
  if (strokeInk(c, [{ points: pts, closed: false }])) return;
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}
export function path(c, d, fill, stroke = C.ink, width = 3) {
  const p = new Path2D(d);
  if (fill) { c.fillStyle = fill; c.fill(p); }
  if (width) { c.strokeStyle = stroke; c.lineWidth = width; const contours = pathContours(d); if (!contours || !strokeInk(c, contours)) c.stroke(p); }
}
export function roundPath(c, x, y, w, h, r = 12) {
  c.beginPath(); c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
export function box(c, x, y, w, h, fill = C.panel, r = 12, width = 3, sketch = true) {
  roundPath(c, x, y, w, h, r); c.fillStyle = fill; c.fill();
  if (!width) return;
  c.lineWidth = width; c.strokeStyle = C.ink;
  if (!strokeInk(c, [roundContour(x, y, w, h, r)])) c.stroke();
  if (sketch) {
    c.save(); c.globalAlpha *= 0.28; c.lineWidth = Math.max(0.65, width * 0.4);
    roundPath(c, x + 1.1, y - 0.8, w - 0.4, h + 1.7, r + 1);
    if (!strokeInk(c, [roundContour(x + 1.1, y - 0.8, w - 0.4, h + 1.7, r + 1)])) c.stroke(); c.restore();
  }
}
export function ellipse(c, x, y, rx, ry, fill, stroke = C.ink, width = 3) {
  c.beginPath(); c.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  if (width) { c.strokeStyle = stroke; c.lineWidth = width; if (!strokeInk(c, [ellipseContour(x, y, rx, ry)])) c.stroke(); }
}
export function hatch(c, x, y, w, h, spacing = 8, color = C.hatch, opacity = 0.24) {
  c.save(); roundPath(c, x + 3, y + 3, w - 6, h - 6, 7); c.clip(); c.globalAlpha *= opacity;
  const r = rand(Math.round(w * 17 + h));
  for (let i = -h; i < w + h; i += spacing) {
    const shorten = r() * h * 0.26;
    line(c, [x + i, y + h - shorten, x + i + h * 0.65, y + r() * 9], color, 1.6);
  }
  c.restore();
}
export function text(c, s, x, y, size = 26, color = C.ink, align = 'left', font = FONT_HAND, weight = 400) {
  c.font = `${weight} ${size}px "${fontFor(s, font)}"`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y);
}
export function comic(c, s, x, y, size = 40, fill = C.yellow, angle = 0, align = 'center', outline = 6) {
  c.save(); c.translate(x, y); c.rotate(angle); c.textAlign = align; c.textBaseline = 'middle'; c.font = `${size}px "${fontFor(s, FONT_COMIC)}"`;
  c.lineJoin = 'round'; c.strokeStyle = C.ink; if (outline > 0) { c.lineWidth = outline; c.strokeText(s, 0, 1); } c.fillStyle = fill; c.fillText(s, 0, 0); c.restore();
}
export function star(c, x, y, size, fill = C.yellow, angle = 0) {
  c.save(); c.translate(x, y); c.rotate(angle); c.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r = i % 2 ? size * 0.23 : size; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (!i) c.moveTo(px, py); else c.lineTo(px, py); }
  c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = C.ink; c.lineWidth = Math.max(0.8, size * 0.1); c.stroke(); c.restore();
}
export function bubble(c, s, x, y, size = 24) {
  const family = fontFor(s, FONT_HAND);
  c.font = `${size}px "${family}"`; const w = c.measureText(s).width + 28, h = size + 20;
  box(c, x - w / 2, y - h / 2, w, h, C.panel, 16, 2.5);
  path(c, `M${x - 10} ${y + h / 2 - 2} L${x + 2} ${y + h / 2 + 21} L${x + 10} ${y + h / 2 - 2}`, C.panel, C.ink, 2.3);
  line(c, [x - 9, y + h / 2 - 1, x + 9, y + h / 2 - 1], C.panel, 4);
  text(c, s, x, y, size, C.ink, 'center', family);
}
export function withTransform(c, x, y, scale, angle, fn) {
  c.save(); c.translate(x, y); c.rotate(angle); c.scale(scale, scale); fn(); c.restore();
}
// Canvas shadows use physical pixels, independently of the drawing transform.
export function shadow(c, color, x, y) {
  const scale = c.canvas.width / W;
  c.shadowColor = color; c.shadowBlur = 0; c.shadowOffsetX = x * scale; c.shadowOffsetY = y * scale;
}
export function paperTexture(scale = 1) {
  const canvas = document.createElement('canvas'); canvas.width = W * scale; canvas.height = H * scale;
  const c = canvas.getContext('2d'); const r = rand(55055);
  const pixels = c.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) { const v = r() > 0.5 ? 70 : 255; pixels.data[i] = v; pixels.data[i + 1] = v; pixels.data[i + 2] = v; pixels.data[i + 3] = Math.floor(r() * 4); }
  c.putImageData(pixels, 0, 0);
  c.scale(scale, scale);
  for (let i = 0; i < 5000; i++) { const x = r() * W, y = r() * H; line(c, [x, y, x + r() * 9 - 4, y + r() * 10 - 5], 'rgba(76,85,135,0.025)', 0.7); }
  return canvas;
}
