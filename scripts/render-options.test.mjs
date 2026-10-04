import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { output, selectResolution } from './render-options.mjs';
import { checkFrameCache, pngDimensions } from './frame-cache.mjs';

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
