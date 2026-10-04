import { execFileSync } from 'node:child_process';
import { option, selectResolution } from './render-options.mjs';

const defaultResolution = selectResolution();

export async function writeVideoFrame(encoder, png) {
  const stream = encoder.stdin;
  if (encoder.exitCode !== null || stream.destroyed) throw new Error('FFmpeg stopped while rendering.');
  if (stream.write(png)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('drain', drain); stream.removeListener('error', fail);
      stream.removeListener('close', stopped); encoder.removeListener('close', stopped);
    };
    const drain = () => { cleanup(); resolve(); };
    const fail = error => { cleanup(); reject(error); };
    const stopped = () => fail(new Error('FFmpeg stopped while waiting for its input pipe.'));
    stream.once('drain', drain); stream.once('error', fail);
    stream.once('close', stopped); encoder.once('close', stopped);
    if (stream.destroyed || encoder.exitCode !== null) stopped();
  });
}

export function selectVideoEncoder(args = [], resolution = selectResolution(args)) {
  const requested = option(args, '--encoder'), gpu = args.includes('--gpu');
  const name = requested ?? (gpu ? 'videotoolbox' : 'libx264');
  if (!['libx264', 'videotoolbox'].includes(name)) throw new Error('Use --encoder=libx264 or --encoder=videotoolbox (macOS hardware encoding).');
  if (gpu && name !== 'videotoolbox') throw new Error('--gpu cannot be combined with --encoder=libx264.');
  const bitrateOption = option(args, '--bitrate');
  if (name === 'libx264') {
    if (bitrateOption !== undefined) throw new Error('--bitrate is only supported with --encoder=videotoolbox or --gpu; libx264 uses CRF 18.');
    return { name: 'libx264', hardware: false, args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18'] };
  }
  const value = bitrateOption ?? resolution.bitrate, match = value.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  const rate = match ? Number(match[1]) * (match[2].toLowerCase() === 'm' ? 1e6 : match[2] ? 1e3 : 1) : NaN;
  if (!Number.isFinite(rate) || rate < 1 || rate > Number.MAX_SAFE_INTEGER) throw new Error('Use a positive video bitrate, for example --bitrate=12M or --bitrate=8000k.');
  const bitrate = match[1] + (match[2].toLowerCase() === 'm' ? 'M' : match[2] ? 'k' : '');
  return { name: 'h264_videotoolbox', hardware: true, bitrate, args: ['-c:v', 'h264_videotoolbox', '-b:v', bitrate, '-allow_sw', '0', '-profile:v', 'high'] };
}

export function checkVideoEncoder(encoder, { platform = process.platform, run = execFileSync, width = defaultResolution.width, height = defaultResolution.height } = {}) {
  if (!encoder.hardware) {
    run('ffmpeg', ['-version'], { stdio: 'ignore' });
    return;
  }
  if (platform !== 'darwin') throw new Error('VideoToolbox hardware encoding requires macOS. Omit --gpu/--encoder=videotoolbox to use libx264.');
  try {
    // An encoder listing does not prove that hardware is available. Encode one
    // full-size frame without a file or software fallback before changing outputs.
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=size=${width}x${height}:rate=30`, '-frames:v', '1', ...encoder.args, '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`VideoToolbox hardware encoding is unavailable. Use an FFmpeg build with h264_videotoolbox and working macOS hardware, or omit --gpu/--encoder=videotoolbox to use libx264.\n${detail}`, { cause: error });
  }
}
