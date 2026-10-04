import timing from './timing.json' with { type: 'json' };

// Choreography and calibration use the authored clock; output frames sample it.
export const BASE_FPS = timing.fps;
export const DURATION = timing.frames / BASE_FPS;
export const DEFAULT_FPS = timing.defaultFps;
export const SUPPORTED_FPS = Object.freeze([...timing.supportedFps]);

export function frameTiming(fps = DEFAULT_FPS) {
  if (!SUPPORTED_FPS.includes(fps)) throw new Error('帧率请选择 30 或 60 fps。');
  return { fps, frames: DURATION * fps, duration: DURATION };
}

export function parseFps(value = String(DEFAULT_FPS)) {
  if (!SUPPORTED_FPS.some(fps => String(fps) === value)) throw new Error('帧率请选择 30 或 60 fps。');
  return Number(value);
}

export function sampleValue(values, frame) {
  const position = Math.max(0, Math.min(values.length - 1, frame));
  const index = Math.floor(position), p = position - index;
  return p ? values[index] + (values[index + 1] - values[index]) * p : values[index];
}

export function sampleTrack(values, frame, angleIndex = -1) {
  const position = Math.max(0, Math.min(values.length - 1, frame));
  const index = Math.floor(position), p = position - index, a = values[index];
  // A missing calibration marks a shot boundary, not a pose to blend toward.
  if (!p || !a || !values[index + 1]) return a;
  return a.map((value, i) => {
    const delta = values[index + 1][i] - value;
    return value + (i === angleIndex ? Math.atan2(Math.sin(delta), Math.cos(delta)) : delta) * p;
  });
}
