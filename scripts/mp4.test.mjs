import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { muxMp4, readAacTrack } from '../src/mp4.js';

const soundtrack = await readFile(new URL('../public/audio/generated.m4a', import.meta.url));
const config = new Uint8Array([1, 66, 0, 40, 255, 225, 0, 4, 103, 66, 0, 40, 1, 0, 2, 104, 0]);
const samplesFor = fps => Array.from({ length: 30 * fps }, (_, i) => ({ key: i % (fps * 2) === 0, data: new Uint8Array([0, 0, 0, 2, i % (fps * 2) ? 65 : 101, i % 256]) }));
const videoSamples = samplesFor(30);
const options = (fps = 30) => {
  const videoConfig = config.slice();
  if (fps === 60) videoConfig[3] = videoConfig[11] = 42;
  return { width: 1920, height: 1080, fps, videoConfig, videoSamples: samplesFor(fps), audioTrack: readAacTrack(soundtrack) };
};

// Inspect the written tables independently, following the field positions in
// ISO BMFF. These tests do not use the production reader to validate its writer.
function children(bytes, start = 0, end = bytes.length) {
  const result = [];
  while (start < end) {
    const size = bytes.readUInt32BE(start);
    assert.ok(size >= 8 && start + size <= end);
    result.push({ type: bytes.toString('ascii', start + 4, start + 8), data: start + 8, end: start + size });
    start += size;
  }
  return result;
}
function child(bytes, parent, type) { const result = children(bytes, parent.data, parent.end).find(item => item.type === type); assert.ok(result, type); return result; }
const sampleTable = (bytes, track) => child(bytes, child(bytes, child(bytes, track, 'mdia'), 'minf'), 'stbl');

test('the bundled AAC retains its exact duration, priming samples and final partial packet', () => {
  const track = readAacTrack(soundtrack);
  assert.equal(track.duration, 30);
  assert.equal(track.sampleRate, 48000); assert.equal(track.channels, 2);
  assert.equal(track.mediaStart, 1024);
  assert.equal(track.samples.length, 1408);
  assert.equal(track.samples.at(-1).duration, 256);
  assert.equal(track.samples.reduce((sum, sample) => sum + sample.duration, 0) - track.mediaStart, 30 * 48000);
});

for (const fps of [30, 60]) test(`MP4 tables describe all ${30 * fps} frames at exactly ${fps} fps and preserve every media payload`, async () => {
  const input = options(fps), blob = muxMp4(input), bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'video/mp4');
  const top = children(bytes); assert.deepEqual(top.map(item => item.type), ['ftyp', 'moov', 'mdat']);
  const movie = top[1], header = child(bytes, movie, 'mvhd');
  assert.equal(bytes.readUInt32BE(header.data + 12), 90000);
  assert.equal(bytes.readUInt32BE(header.data + 16), 2700000);
  const tracks = children(bytes, movie.data, movie.end).filter(item => item.type === 'trak');
  assert.equal(tracks.length, 2);
  const tables = tracks.map(track => sampleTable(bytes, track));
  const times = child(bytes, tables[0], 'stts');
  assert.equal(bytes.readUInt32BE(times.data + 4), 1);
  assert.equal(bytes.readUInt32BE(times.data + 8), 30 * fps);
  assert.equal(bytes.readUInt32BE(times.data + 12), 90000 / fps);
  const keyframes = child(bytes, tables[0], 'stss');
  assert.equal(bytes.readUInt32BE(keyframes.data + 4), 15);
  assert.equal(bytes.readUInt32BE(keyframes.data + 8), 1);
  assert.equal(bytes.readUInt32BE(keyframes.end - 4), 28 * fps + 1);
  const edit = child(bytes, child(bytes, tracks[1], 'edts'), 'elst');
  assert.equal(bytes.readUInt32BE(edit.data + 8), 2700000);
  assert.equal(bytes.readUInt32BE(edit.data + 12), 1024);
  for (const [index, samples] of [input.videoSamples, input.audioTrack.samples].entries()) {
    const offsets = child(bytes, tables[index], 'stco'), sizes = child(bytes, tables[index], 'stsz');
    assert.equal(bytes.readUInt32BE(offsets.data + 4), samples.length);
    assert.equal(bytes.readUInt32BE(sizes.data + 8), samples.length);
    for (let i = 0; i < samples.length; i++) {
      const offset = bytes.readUInt32BE(offsets.data + 8 + i * 4), size = bytes.readUInt32BE(sizes.data + 12 + i * 4);
      assert.ok(offset >= top[2].data && offset + size <= top[2].end);
      assert.deepEqual(bytes.subarray(offset, offset + size), Buffer.from(samples[i].data));
    }
  }
});

test('4K MP4 writes native dimensions without changing frame timing', async () => {
  const blob = muxMp4({ ...options(), width: 3840, height: 2160 }), bytes = Buffer.from(await blob.arrayBuffer());
  const movie = children(bytes)[1], video = children(bytes, movie.data, movie.end).find(item => item.type === 'trak');
  const tkhd = child(bytes, video, 'tkhd');
  assert.equal(bytes.readUInt32BE(tkhd.end - 8) / 65536, 3840);
  assert.equal(bytes.readUInt32BE(tkhd.end - 4) / 65536, 2160);
});

test('truncated AAC, invalid chunk offsets and unsupported edits fail before muxing', () => {
  for (const end of [0, 8, 100, soundtrack.length - 1]) assert.throws(() => readAacTrack(soundtrack.subarray(0, end)), /MP4/);
  const corrupt = Buffer.from(soundtrack), movie = children(corrupt).find(item => item.type === 'moov');
  const track = children(corrupt, movie.data, movie.end).find(item => item.type === 'trak');
  const offsets = child(corrupt, sampleTable(corrupt, track), 'stco');
  corrupt.writeUInt32BE(0, offsets.data + 8);
  assert.throws(() => readAacTrack(corrupt), /数据边界/);
  const badEdit = Buffer.from(soundtrack), edit = child(badEdit, child(badEdit, track, 'edts'), 'elst');
  badEdit.writeInt32BE(-1, edit.data + 12);
  assert.throws(() => readAacTrack(badEdit), /音频裁剪/);
});

test('muxing rejects mismatched duration, missing key frames and unsupported AVC profiles', () => {
  assert.throws(() => muxMp4({ ...options(), videoSamples: videoSamples.slice(1) }), /关键帧/);
  assert.throws(() => muxMp4({ ...options(), videoSamples: videoSamples.slice(0, 899) }), /时长不匹配/);
  assert.throws(() => muxMp4({ ...options(), videoConfig: new Uint8Array([1, 100, 0, 40, 255, 225, 0]) }), /Baseline/);
  assert.throws(() => muxMp4({ ...options(), fps: 29 }), /视频配置/);
});
