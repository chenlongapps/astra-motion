import { clamp, mix, progress } from './sketch.js';
import referenceCamera from './reference-camera.json' with { type: 'json' };
import timing from './timing.json' with { type: 'json' };
import { sampleTrack, sampleValue } from './frame-timing.js';

// Zero-based event frames shared with the offline soundtrack composer.
export const cues = Object.freeze(timing.cues);
const cameras = [
  [0, 1, 0, 0], [15, 1, 0, 0], [28, 1.03, -28.8, -36.6],
  [104, 1.03, -28.8, -36.6], [124, 1.42, -88, -457],
  [233, 1.42, -88, -457], [253, 1.28, 64, -124],
  [360, 1.28, 64, -124], [375, 1.32, -307.2, -118],
  [481, 1.32, -307.2, -118], [501, 1.3, -782, -71],
  [595, 1.3, -782, -71], [615, 1.2, -192, -303],
  [690, 1.2, -192, -303], [705, 1, 0, 0],
  [899, 1, 0, 0],
];
// Stable shot holds, with only the intentional eased reframing between shots.
export function cameraAt(frame) {
  for (let i = 1; i < cameras.length; i++) {
    const [end, s, x, y] = cameras[i];
    if (frame <= end) { const a = cameras[i - 1]; const p = progress(frame, a[0], end); return { s: mix(a[1], s, p), x: mix(a[2], x, p), y: mix(a[3], y, p) }; }
  }
  return { s: 1, x: 0, y: 0 };
}
// Calibration is only used to undo the source camera when recovering world poses.
// Using the stabilized camera here would bake the original shake into the actor.
export function referenceCameraAt(frame) {
  const measured = sampleTrack(referenceCamera, frame);
  return measured ? { s: measured[0], x: measured[1], y: measured[2] } : cameraAt(frame);
}
export function clipAt(f) {
  if (f < 60) return 'empty';
  if (f < 132) return 'sun';
  if (f < cues.cut) return 'boring';
  if (f < 255) return 'coffee';
  if (f < 294) return 'sun';
  if (f < 358) return 'coffee';
  if (f < cues.adjustments) return 'cat';
  if (f < 611) return 'dance';
  if (f < 626) return 'sun';
  if (f < 655) return 'coffee';
  if (f < 681) return 'cat';
  if (f < cues.exportEnd) return 'dance';
  if (f < 756) return 'sun';
  if (f < 771) return 'coffee';
  if (f < 780) return 'cat';
  if (f < 799) return 'dance';
  if (f < 816) return 'sun';
  if (f < 825) return 'cat';
  return 'dance';
}
const exportPercents = [0, 2, 4, 8, 14, 22, 33, 46, 60, 72, 81, 88, 93, 96, 98, 99, 99, 100];
export const exportProgress = f => exportPercents[Math.floor(clamp(f - 715, 0, exportPercents.length - 1))] / 100;
export function captionAt(f) {
  if (f >= cues.wait && f < cues.adjustments) {
    if (f < cues.for) return '好戏';
    if (f < cues.typo) return '好戏即将';
    if (f < cues.fixed) return '好戏即将场上';
    return '好戏即将上场';
  }
  if (f >= 751 && f < cues.nailed) return f < 766 ? '好戏' : f < 781 ? '好戏即将' : '好戏即将上场';
  return '';
}
/** The timeline chip keeps the in-progress caption visible after the phone caption fades. */
export function captionChipAt(f) {
  if (f < cues.wait) return '';
  if (f < cues.for) return '好戏';
  if (f < cues.typo) return '好戏即将';
  if (f < cues.fixed) return '好戏即将场上';
  return '好戏即将上场';
}
/** Chinese captions are wider per glyph, so shorter lines get a larger size. */
export const captionSize = s => (s.length <= 2 ? 40 : s.length <= 4 ? 32 : 28);
export function slidersAt(f) {
  return {
    sparkle: progress(f, 499, 510) * 0.7,
    flow: f >= 570 ? sampleValue([1, 0.24, 0.05], f - 570) : progress(f, 517, cues.maxShake),
    zoom: progress(f, cues.zoom, 602) * 0.6,
  };
}
export function playheadAt(f) {
  const keys = [[0, 150], [50, 150], [120, 360], [133, 820], [148, 820], [151, 520], [237, 570], [252, 330], [283, 430], [300, 490], [353, 695], [376, 740], [481, 895], [490, 990], [598, 1290], [611, 200], [626, 420], [654, 700], [680, 990], [702, 1260], [704, 1260], [705, 150], [735, 1290], [899, 1290]];
  for (let i = 1; i < keys.length; i++) if (f < keys[i][0]) { const a = keys[i - 1], b = keys[i]; return mix(a[1], b[1], clamp((f - a[0]) / (b[0] - a[0]))); }
  return 1290;
}
