import { ellipse, withTransform } from './sketch.js';

/** @typedef {'idle' | 'walkRight' | 'walkLeft' | 'wave' | 'jump' | 'dizzy' | 'think' | 'celebrate'} PetAction */
/**
 * @typedef {Object} Pose
 * @property {number} x
 * @property {number} y
 * @property {number} [scale]
 * @property {number} [angle]
 * @property {number} [left]
 * @property {number} [right]
 * @property {[number, number]} [leftTarget] Offset from (x, y) in parent coordinates.
 * @property {[number, number]} [rightTarget] Offset from (x, y) in parent coordinates.
 * @property {PetAction} [action]
 * @property {'neutral' | 'happy' | 'blink' | 'dizzy' | 'wink'} [expression]
 * @property {number} [stride]
 * @property {boolean} [blush]
 * @property {number} [squash]
 * @property {number} [width]
 * @property {number} [height]
 */

const ink = '#172e69', light = '#719aff', blue = '#4c77e5', dark = '#3052b7', glyph = '#93f4e7';
const actionCounts = { idle: 7, walkRight: 8, walkLeft: 8, wave: 4, jump: 5, dizzy: 8, think: 6, celebrate: 6 };
const paths = new Map();
const cloud = 'M-56 19 C-68 15 -70 5 -67 -8 C-65 -21 -57 -31 -46 -33 C-46 -45 -36 -56 -25 -59 C-14 -62 -3 -59 3 -53 C14 -60 29 -57 39 -49 C46 -44 49 -38 50 -32 C62 -27 69 -16 69 -3 L69 15 Q70 25 64 30 C61 40 50 44 36 44 L-27 44 C-41 44 -53 38 -56 29 Q-59 24 -56 19Z';
const torso = 'M-24 43 L27 43 Q31 55 30 68 C30 77 21 81 2 81 C-18 81 -28 77 -28 67 Q-29 55 -24 43Z';
const boot = 'M-9 -5 Q0 -7 9 -4 L9 11 Q9 16 4 16 L-5 16 Q-10 16 -10 11Z';

function vectorPath(c, d, fill, stroke = ink, width = 2.1) {
  let path = paths.get(d);
  if (!path) { path = new Path2D(d); paths.set(d, path); }
  if (fill) { c.fillStyle = fill; c.fill(path); }
  // Native Bézier outlines and screen glyphs stay crisp at every output scale.
  if (width) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(path); }
}

/** Keep the original ten-pose-per-second cadence, independent of draw history. */
function motionAt(action, tick, scripted, stride) {
  const count = action === 'idle' && scripted ? 6 : actionCounts[action], column = tick % count;
  const phase = column / count * Math.PI * 2;
  const motion = {
    bob: 0, left: { angle: 0.38, length: 26 }, right: { angle: -0.38, length: 26 },
    feet: [{ x: -13, lift: 0, angle: 0 }, { x: 17, lift: 0, angle: 0 }], expression: 'neutral',
  };
  if (action === 'walkRight' || action === 'walkLeft') {
    const step = Math.sin(stride ?? phase) * (action === 'walkLeft' ? -1 : 1);
    motion.bob = -Math.abs(step) * 1.8;
    motion.left.angle += step * 0.55; motion.right.angle += step * 0.55;
    motion.feet = [{ x: -13 + step * 9, lift: Math.max(0, step) * 7, angle: step * 0.55 }, { x: 17 - step * 9, lift: Math.max(0, -step) * 7, angle: -step * 0.55 }];
  } else if (action === 'idle') {
    if (column === 1 || column === 5) motion.expression = 'blink';
    if (column === 6) { motion.bob = -8; motion.feet.forEach(foot => foot.lift = 8); }
  } else if (action === 'wave') {
    motion.left = { angle: [0.38, 2.35, 2.05, 0.38][column], length: [26, 44, 46, 26][column], front: column === 1 || column === 2 };
  } else if (action === 'jump' || action === 'celebrate') {
    const lift = action === 'jump' ? Math.sin(column / (count - 1) * Math.PI) : column === 2 ? 1 : 0;
    motion.bob = -lift * 11;
    motion.left = { angle: 0.38 + lift * 1.7, length: 26 + lift * 8 };
    motion.right = { angle: -motion.left.angle, length: motion.left.length };
    motion.feet.forEach((foot, i) => { foot.lift = lift * 11; foot.angle = (i ? -1 : 1) * lift * 0.25; });
    if (action === 'celebrate' && [1, 2, 5].includes(column)) motion.expression = 'happy';
  } else if (action === 'think') {
    motion.left = { angle: -2.8, length: 23, front: true };
    motion.expression = column % 3 === 1 ? 'look' : column % 3 === 2 ? 'quotes' : 'neutral';
  } else if (action === 'dizzy') {
    motion.expression = ['neutral', 'pinch', 'dizzy', 'tired'][column % 4];
    motion.left.angle = column % 2 ? 2.35 : 1.2; motion.left.length = 23;
    motion.right.angle = -motion.left.angle; motion.right.length = 23;
  }
  return motion;
}

function arm(c, side, pose, motion, scale, rotation) {
  const target = side < 0 ? pose.leftTarget : pose.rightTarget;
  const angle = side < 0 ? pose.left : pose.right, spec = side < 0 ? motion.left : motion.right;
  const scripted = angle !== undefined || !!target;
  const x = side < 0 ? -25 : 31, y = 49 + (scripted ? 0 : motion.bob);
  let a = angle ?? spec.angle, length = scripted ? Math.abs(a) > 2.1 ? 86 : 34 : spec.length;
  if (target) {
    // Invert the actor transform, not the parent camera. This keeps the hand on
    // the exact same UI point even while the actor rotates or changes height.
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const tx = (target[0] * cos + target[1] * sin) / scale;
    const ty = (-target[0] * sin + target[1] * cos) / scale;
    length = Math.hypot(tx - x, ty - y); a = Math.atan2(x - tx, ty - y);
  }
  withTransform(c, x, y, 1, a, () => {
    const halfWidth = scripted ? 8 : 7;
    const fill = c.createLinearGradient(-halfWidth, 0, halfWidth, 0);
    fill.addColorStop(0, light); fill.addColorStop(0.5, blue); fill.addColorStop(1, dark);
    c.fillStyle = fill; c.strokeStyle = ink; c.lineWidth = 2.1;
    c.beginPath(); c.roundRect(-halfWidth, -6, halfWidth * 2, length + 6, halfWidth); c.fill(); c.stroke();
    c.fillStyle = blue;
    c.beginPath(); c.ellipse(0, length, scripted ? 11 : 8, 9, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  });
}

function foot(c, pose) {
  withTransform(c, pose.x, 82 - pose.lift, 1, pose.angle, () => {
    const fill = c.createLinearGradient(-8, -5, 8, 16);
    fill.addColorStop(0, '#638af4'); fill.addColorStop(0.65, blue); fill.addColorStop(1, dark);
    vectorPath(c, boot, fill);
    vectorPath(c, 'M-6 12 Q0 14 6 12', undefined, '#86a6ff80', 1.2);
  });
}

function body(c, bob, facing) {
  c.save(); c.translate(0, bob);
  const fill = c.createLinearGradient(-22, 45, 24, 81);
  fill.addColorStop(0, '#779cff'); fill.addColorStop(0.5, blue); fill.addColorStop(1, '#3659c1');
  vectorPath(c, torso, fill);
  vectorPath(c, 'M-19 48 Q0 45 22 48', undefined, '#b3c9ff80', 1.3);
  c.save(); c.scale(facing, 1);
  vectorPath(c, 'M-9 54 L-3 59 L-9 64 M5 64 L15 64', undefined, '#d8f8ff', 2.9);
  c.restore(); c.restore();
}

function face(c, expression) {
  const fill = c.createLinearGradient(-33, -17, 51, 34);
  fill.addColorStop(0, '#2b356e'); fill.addColorStop(0.55, '#252961'); fill.addColorStop(1, '#222653');
  c.fillStyle = fill; c.strokeStyle = '#162453'; c.lineWidth = 2.1;
  c.beginPath(); c.roundRect(-33, -17, 84, 51, 11); c.fill(); c.stroke();
  c.strokeStyle = '#8ca9df40'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(-31.5, -15.5, 81, 48, 9.5); c.stroke();
  if (expression === 'neutral') {
    vectorPath(c, 'M-18 -2 L-8 8 L-18 18 M15 18 L29 18', undefined, glyph, 4.3);
    return;
  }
  for (const [i, x] of [-15, 25].entries()) {
    c.beginPath(); c.strokeStyle = glyph; c.lineWidth = 4.3;
    if (expression === 'dizzy') {
      c.moveTo(x - 6, 1); c.lineTo(x + 6, 14); c.moveTo(x + 6, 1); c.lineTo(x - 6, 14);
    } else if (expression === 'wink' && i === 0) {
      c.moveTo(x - 5, -2); c.lineTo(x + 5, 7); c.lineTo(x - 5, 16);
    } else if (expression === 'happy') {
      c.moveTo(x - 7, 12); c.quadraticCurveTo(x, -1, x + 7, 12);
    } else if (expression === 'blink' || expression === 'wink') {
      c.moveTo(x - 7, 6); c.quadraticCurveTo(x, 17, x + 7, 6);
    } else if (expression === 'pinch') {
      c.moveTo(x + (i ? 6 : -6), 0); c.lineTo(x + (i ? -5 : 5), 7); c.lineTo(x + (i ? 6 : -6), 14);
    } else if (expression === 'tired') {
      c.moveTo(x - 6, 4); c.lineTo(x + 6, 0); c.moveTo(x - 6, 14); c.quadraticCurveTo(x, 9, x + 6, 14);
    } else if (expression === 'quotes') {
      c.moveTo(x + 2, -2); c.quadraticCurveTo(x - 4, -3, x - 4, 5); c.lineTo(x + 2, 5); c.lineTo(x + 2, 9);
    } else { c.moveTo(x, 0); c.lineTo(x, 13); }
    c.stroke();
  }
}

function head(c, bob, facing, expression, blush) {
  c.save(); c.translate(0, bob); c.scale(facing, 1);
  const fill = c.createLinearGradient(-30, -59, 30, 44);
  fill.addColorStop(0, '#7ba1ff'); fill.addColorStop(0.45, '#638cf9'); fill.addColorStop(0.8, '#4d75e3'); fill.addColorStop(1, '#375ac5');
  vectorPath(c, cloud, fill, ink, 0);
  c.save(); c.clip(paths.get(cloud));
  const glow = c.createRadialGradient(-42, -26, 2, -30, -25, 74);
  glow.addColorStop(0, '#b0c7ff55'); glow.addColorStop(1, '#b0c7ff00');
  c.fillStyle = glow; c.fillRect(-72, -64, 148, 113);
  vectorPath(c, 'M-67 8 C-54 19 -38 13 -27 20 L29 12 Q57 20 72 8 L76 48 L-70 48Z', '#3054c323', ink, 0);
  c.restore();
  vectorPath(c, cloud);
  vectorPath(c, 'M-43 -34 C-42 -45 -32 -54 -23 -55 Q-9 -58 2 -49 C14 -56 30 -51 39 -41', undefined, '#c0d3ff88', 1.5);
  vectorPath(c, 'M-49 32 Q-41 40 -27 40 L36 40 Q51 40 59 30', undefined, '#97b8ff80', 1.4);
  vectorPath(c, 'M-56 19 Q-49 13 -43 13 M63 29 Q58 22 52 21', undefined, '#2d56be80', 1.3);
  face(c, expression);
  if (blush) {
    ellipse(c, -43, 26, 5.5, 2.7, '#eaa7d14d', '', 0);
    ellipse(c, 59, 26, 5.5, 2.7, '#eaa7d14d', '', 0);
  }
  c.restore();
}

/** Native vector art: uniform proportions, the same rig origin, and feet at y=98. */
export function character(c, p, frame) {
  const f = Math.max(0, Math.floor(frame)), tick = Math.floor(f / 3);
  const leftScripted = p.left !== undefined || !!p.leftTarget, rightScripted = p.right !== undefined || !!p.rightTarget;
  const scripted = leftScripted || rightScripted;
  const action = p.action ?? (p.expression === 'dizzy' ? 'dizzy' : p.expression === 'happy' ? 'celebrate' : 'idle');
  const rigAction = scripted && !['idle', 'walkRight', 'walkLeft'].includes(action) ? p.stride !== undefined ? 'walkRight' : 'idle' : action;
  const motion = motionAt(rigAction, tick, scripted, p.stride);
  const expression = p.expression && p.expression !== 'neutral' ? p.expression : motion.expression;
  const facing = action === 'walkLeft' ? -1 : 1;
  const scale = (p.scale ?? 1) * (p.height ?? 118) / 118, rotation = p.angle ?? 0;
  withTransform(c, p.x, p.y, scale, rotation, () => {
    c.lineCap = 'round'; c.lineJoin = 'round';
    const leftFront = motion.left.front && !leftScripted, rightFront = motion.right.front && !rightScripted;
    motion.feet.forEach(pose => foot(c, pose));
    if (!leftFront) arm(c, -1, p, motion, scale, rotation);
    if (!rightFront) arm(c, 1, p, motion, scale, rotation);
    body(c, motion.bob, facing);
    head(c, motion.bob, facing, expression, !!p.blush);
    if (leftFront) arm(c, -1, p, motion, scale, rotation);
    if (rightFront) arm(c, 1, p, motion, scale, rotation);
  });
}
