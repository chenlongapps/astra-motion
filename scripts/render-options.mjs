import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frameTiming, parseFps } from '../src/frame-timing.js';

const profiles = JSON.parse(readFileSync(new URL('../src/render-profiles.json', import.meta.url), 'utf8'));
export const root = fileURLToPath(new URL('../', import.meta.url));
export const output = path.join(root, 'output');

export function option(args, name) {
  const matches = args.filter(arg => arg === name || arg.startsWith(`${name}=`));
  if (matches.length > 1) throw new Error(`Specify ${name} only once.`);
  if (!matches.length) return undefined;
  const value = matches[0].slice(name.length + 1);
  if (!value) throw new Error(`Use ${name}=VALUE.`);
  return value;
}

export function selectResolution(args = []) {
  const name = option(args, '--resolution') ?? '1080p';
  if (!Object.hasOwn(profiles, name)) throw new Error('Use --resolution=1080p or --resolution=4k (3840×2160).');
  return { name, ...profiles[name], output: name === '1080p' ? output : path.join(output, name) };
}

export function selectFrameRate(args = []) {
  try { return parseFps(option(args, '--fps')); }
  catch (error) { throw new Error(`Use --fps=30 or --fps=60. ${error.message}`, { cause: error }); }
}

export const MAX_WORKERS = 4;

// Parallel capture divides the pixel work of one export across render pages
// that all draw the same deterministic frames. Rendering and PNG compression
// scale across cores while the encoder needs only a few threads, so half of the
// machine's parallelism is a good default: 4 pages on an 8-core laptop, 2 on a
// smaller one, and never more than MAX_WORKERS.
export function selectWorkerCount(args = [], { parallelism = availableParallelism() } = {}) {
  const value = option(args, '--workers');
  if (value === undefined) return Math.max(1, Math.min(MAX_WORKERS, Math.round(parallelism / 2)));
  if (!/^\d+$/.test(value)) throw new Error('Use --workers=1, 2, 3 or 4.');
  const workers = Number(value);
  if (workers < 1 || workers > MAX_WORKERS) throw new Error(`Use --workers=1 to ${MAX_WORKERS}.`);
  return workers;
}

export function selectRenderOptions(args = []) {
  const resolution = selectResolution(args), timing = frameTiming(selectFrameRate(args));
  return { ...resolution, ...timing, workers: selectWorkerCount(args), output: path.join(resolution.output, `${timing.fps}fps`) };
}
