import path from 'node:path';
import { open, readdir, readFile, writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { root } from './render-options.mjs';

export async function frameCacheMetadata({ width, height, fps, frames }) {
  const hash = createHash('sha256');
  for (const directory of ['src', 'public/fonts']) {
    for (const name of (await readdir(path.join(root, directory))).sort()) {
      if (directory === 'src' && !/\.(js|json)$/.test(name)) continue;
      hash.update(`${directory}/${name}\0`); hash.update(await readFile(path.join(root, directory, name)));
    }
  }
  return { version: 1, width, height, fps, frames, sourceSha256: hash.digest('hex') };
}

export async function writeFrameCacheMetadata(directory, profile) {
  const metadata = await frameCacheMetadata(profile);
  if (profile.sourceSha256 && profile.sourceSha256 !== metadata.sourceSha256) throw new Error('Rendering source changed during frame generation or verification. Regenerate the frame cache.');
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
}

export function pngDimensions(header) {
  if (header.length < 33 || !header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG header.');
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || header[26] || header[27] || header[28] > 1) throw new Error('Invalid PNG dimensions or encoding.');
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[header[25]]?.includes(header[24]) || crc32(header.subarray(12, 29)) !== header.readUInt32BE(29)) throw new Error('Invalid PNG encoding or header checksum.');
  return { width, height };
}

// Inspect every PNG before encoding or partially refreshing a cached sequence.
// Serial metadata reads keep memory bounded even for full-size 4K sequences.
export async function checkFrameCache(directory, profile, count = profile.frames, { allowStaleSource = false } = {}) {
  const { width, height } = profile;
  if (profile.fps !== undefined) {
    try {
      const actual = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
      const expected = await frameCacheMetadata({ ...profile, frames: count });
      for (const key of Object.keys(expected)) {
        if (key === 'sourceSha256' && allowStaleSource) continue;
        if (actual[key] !== expected[key]) throw new Error(`Cache ${key} does not match the selected output or current source.`);
      }
    } catch (error) {
      throw new Error(`Invalid frame cache metadata: ${error.message}\nGenerate a complete --keep-frames sequence at the selected --resolution and --fps.`, { cause: error });
    }
  }
  for (let frame = 0; frame < count; frame++) {
    const file = path.join(directory, `${String(frame).padStart(4, '0')}.png`);
    try {
      const handle = await open(file, 'r');
      try {
        const header = Buffer.alloc(33), trailer = Buffer.alloc(12), size = (await handle.stat()).size;
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const info = pngDimensions(header.subarray(0, bytesRead));
        if (size < 57) throw new Error('Truncated PNG.');
        await handle.read(trailer, 0, trailer.length, size - trailer.length);
        if (!trailer.equals(Buffer.from('0000000049454e44ae426082', 'hex'))) throw new Error('Missing PNG end marker.');
        if (info.width !== width || info.height !== height) throw new Error(`Expected ${width}×${height} PNG; found ${info.width}×${info.height} PNG.`);
      } finally { await handle.close(); }
    } catch (error) {
      throw new Error(`Invalid cached frame ${file}: ${error.message}\nGenerate a complete sequence with --keep-frames at the selected --resolution and --fps first.`, { cause: error });
    }
  }
}
