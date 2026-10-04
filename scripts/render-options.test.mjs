import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { output, selectFrameRate, selectRenderOptions, selectResolution } from './render-options.mjs';
import { checkFrameCache, pngDimensions, writeFrameCacheMetadata } from './frame-cache.mjs';

function pngFixture({ width, height }) {
  const chunk = (name, data) => {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length); bytes.write(name, 4, 4, 'ascii'); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

test('PNG metadata rejects short, invalid, and zero-sized headers', () => {
  const png = pngFixture({ width: 12, height: 8 });
  assert.deepEqual(pngDimensions(png), { width: 12, height: 8 });
  assert.throws(() => pngDimensions(png.subarray(0, 32)), /header/);
  assert.throws(() => pngDimensions(Buffer.alloc(33)), /header/);
  const broken = Buffer.from(png); broken.writeUInt32BE(0, 16);
  assert.throws(() => pngDimensions(broken), /dimensions/);
  const checksum = Buffer.from(png); checksum[29] ^= 1;
  assert.throws(() => pngDimensions(checksum), /checksum/);
});

test('1080p remains the default and 4K artifacts have their own directory', () => {
  const hd = selectResolution(), uhd = selectResolution(['--resolution=4k', '--keep-frames']);
  assert.equal(hd.width, 1920); assert.equal(hd.height, 1080); assert.equal(hd.output, output);
  assert.deepEqual(selectResolution(['--resolution=1080p']), hd);
  assert.equal(uhd.width, 3840); assert.equal(uhd.height, 2160);
  assert.equal(uhd.output, path.join(output, '4k'));
});

test('missing, unsupported, and repeated resolution options fail explicitly', () => {
  for (const args of [['--resolution'], ['--resolution='], ['--resolution=8k'], ['--resolution=2160p'], ['--resolution=toString'], ['--resolution=4k', '--resolution=1080p'], ['--resolution=4k', '--resolution=4k']]) {
    assert.throws(() => selectResolution(args), /--resolution/);
  }
});

test('frame rates default to 60 and isolate all resolution/rate output directories', () => {
  assert.equal(selectFrameRate(), 60);
  const outputs = new Set();
  for (const resolution of ['1080p', '4k']) for (const fps of [30, 60]) {
    const profile = selectRenderOptions([`--resolution=${resolution}`, `--fps=${fps}`]);
    assert.equal(profile.fps, fps); assert.equal(profile.frames, fps * 30); assert.equal(profile.duration, 30);
    assert.equal(profile.output, path.join(selectResolution([`--resolution=${resolution}`]).output, `${fps}fps`));
    outputs.add(profile.output);
  }
  assert.equal(outputs.size, 4);
  assert.equal(selectRenderOptions().fps, 60);
});

test('missing, malformed, unsupported, and duplicate frame rates are rejected', () => {
  for (const args of [['--fps'], ['--fps='], ['--fps=24'], ['--fps=120'], ['--fps=30.0'], ['--fps=3e1'], ['--fps= 60'], ['--fps=NaN'], ['--fps=60', '--fps=60'], ['--fps=30', '--fps=60']]) {
    assert.throws(() => selectRenderOptions(args), /--fps/);
  }
});

test('cache metadata rejects legacy, mixed-rate, incomplete and stale-source sequences', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-frame-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = { width: 12, height: 8, fps: 60, frames: 2 };
  for (const name of ['0000.png', '0001.png']) await writeFile(path.join(directory, name), pngFixture(profile));
  await assert.rejects(checkFrameCache(directory, profile), /metadata/);
  await writeFrameCacheMetadata(directory, profile);
  await checkFrameCache(directory, profile);
  await assert.rejects(checkFrameCache(directory, { ...profile, fps: 30 }), /fps/);
  await assert.rejects(checkFrameCache(directory, { ...profile, frames: 1 }), /frames/);
  const filename = path.join(directory, 'manifest.json'), manifest = JSON.parse(await readFile(filename, 'utf8'));
  await assert.rejects(writeFrameCacheMetadata(directory, { ...profile, sourceSha256: 'changed-during-render' }), /source changed/);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), manifest);
  await writeFile(filename, JSON.stringify({ ...manifest, sourceSha256: 'stale' }));
  await assert.rejects(checkFrameCache(directory, profile), /sourceSha256/);
  await checkFrameCache(directory, profile, profile.frames, { allowStaleSource: true });
  await assert.rejects(checkFrameCache(directory, { ...profile, fps: 30 }, profile.frames, { allowStaleSource: true }), /fps/);
  await writeFrameCacheMetadata(directory, profile);
  await rm(path.join(directory, '0001.png'));
  await assert.rejects(checkFrameCache(directory, profile), /0001\.png/);
});

test('cache validation catches missing, corrupt, and mixed-resolution frames anywhere in a sequence', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'astra-frame-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hd = selectResolution(), uhd = selectResolution(['--resolution=4k']);
  const small = pngFixture(hd), large = pngFixture(uhd);
  for (const name of ['0000.png', '0001.png', '0002.png']) await writeFile(path.join(directory, name), large);
  await checkFrameCache(directory, uhd, 3);
  await assert.rejects(checkFrameCache(directory, hd, 3), /0000\.png[\s\S]*1920×1080[\s\S]*3840×2160/);
  await writeFile(path.join(directory, '0002.png'), small);
  await assert.rejects(checkFrameCache(directory, uhd, 3), /0002\.png[\s\S]*3840×2160[\s\S]*1920×1080/);
  await writeFile(path.join(directory, '0002.png'), large);
  await rm(path.join(directory, '0001.png'));
  await assert.rejects(checkFrameCache(directory, uhd, 3), /0001\.png/);
  await writeFile(path.join(directory, '0001.png'), 'not a PNG');
  await assert.rejects(checkFrameCache(directory, uhd, 3), /0001\.png/);
  await writeFile(path.join(directory, '0001.png'), large.subarray(0, -12));
  await assert.rejects(checkFrameCache(directory, uhd, 3), /0001\.png[\s\S]*end marker/);
});
