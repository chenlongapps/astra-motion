import { readFileSync } from 'node:fs';
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

export function selectRenderOptions(args = []) {
  const resolution = selectResolution(args), timing = frameTiming(selectFrameRate(args));
  return { ...resolution, ...timing, output: path.join(resolution.output, `${timing.fps}fps`) };
}
