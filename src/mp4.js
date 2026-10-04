// A deliberately limited ISO BMFF implementation: one Baseline AVC video track
// and one AAC-LC track from our prebuilt M4A. No general-purpose media library.
const MOVIE_SCALE = 90000;
const textEncoder = new TextEncoder();
const fail = message => { throw new Error(`MP4：${message}`); };
const bytesOf = data => data instanceof Uint8Array ? data : new Uint8Array(data);

function reader(input) {
  const bytes = bytesOf(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset, size) => { if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) fail('文件不完整。'); };
  return {
    bytes,
    u16(offset) { range(offset, 2); return view.getUint16(offset); },
    u32(offset) { range(offset, 4); return view.getUint32(offset); },
    i32(offset) { range(offset, 4); return view.getInt32(offset); },
    u64(offset) { range(offset, 8); const value = Number(view.getBigUint64(offset)); if (!Number.isSafeInteger(value)) fail('文件偏移过大。'); return value; },
    i64(offset) { range(offset, 8); const value = Number(view.getBigInt64(offset)); if (!Number.isSafeInteger(value)) fail('时间偏移过大。'); return value; },
    type(offset) { range(offset, 4); return String.fromCharCode(...bytes.subarray(offset, offset + 4)); },
  };
}

function boxes(r, start = 0, end = r.bytes.length) {
  const result = [];
  while (start < end) {
    if (end - start < 8) fail('无效的文件结构。');
    let size = r.u32(start), header = 8;
    if (size === 1) { if (end - start < 16) fail('无效的大文件结构。'); size = r.u64(start + 8); header = 16; }
    if (size === 0) size = end - start;
    if (size < header || start + size > end) fail('文件结构超出边界。');
    result.push({ type: r.type(start + 4), start, data: start + header, end: start + size });
    start += size;
  }
  return result;
}
const children = (r, parent, skip = 0) => boxes(r, parent.data + skip, parent.end);
function required(items, type) { const item = items.find(item => item.type === type); if (!item) fail(`缺少 ${type}。`); return item; }
function field(r, item, offset, length) { if (item.data + offset + length > item.end) fail(`${item.type} 不完整。`); return item.data + offset; }
function table(r, item, stride, skip = 8) {
  const count = r.u32(field(r, item, 4, 4));
  field(r, item, skip, count * stride);
  return Array.from({ length: count }, (_, i) => item.data + skip + i * stride);
}
function mediaHeader(r, item) {
  const version = r.bytes[field(r, item, 0, 1)];
  if (version > 1) fail('不支持的时间版本。');
  const timescale = r.u32(field(r, item, version ? 20 : 12, 4));
  const duration = version ? r.u64(field(r, item, 24, 8)) : r.u32(field(r, item, 16, 4));
  if (!timescale || !duration) fail('无效的媒体时长。');
  return { timescale, duration };
}

function checkAacDescription(r, entry) {
  const esds = required(children(r, entry, 28), 'esds');
  function descriptor(start, end, wanted) {
    while (start < end) {
      const tag = r.bytes[start++];
      let size = 0, count = 0, value;
      do { if (start >= end || count++ === 4) fail('无效的音频配置。'); value = r.bytes[start++]; size = size * 128 + (value & 127); } while (value & 128);
      const next = start + size;
      if (next > end) fail('音频配置不完整。');
      if (tag === wanted) return r.bytes.subarray(start, next);
      let nested = null;
      if (tag === 3) {
        if (size < 3) fail('无效的音频描述。');
        const flags = r.bytes[start + 2]; let offset = start + 3;
        if (flags & 128) offset += 2;
        if (flags & 64) { if (offset >= next) fail('无效的音频 URL。'); offset += 1 + r.bytes[offset]; }
        if (flags & 32) offset += 2;
        if (offset > next) fail('无效的音频描述。');
        nested = descriptor(offset, next, wanted);
      } else if (tag === 4) {
        if (size < 13 || r.bytes[start] !== 64) fail('配乐必须使用 AAC。');
        nested = descriptor(start + 13, next, wanted);
      }
      if (nested) return nested;
      start = next;
    }
    return null;
  }
  field(r, esds, 0, 4);
  const config = descriptor(esds.data + 4, esds.end, 5);
  if (!config || config.length < 2 || config[0] >> 3 !== 2 || ((config[0] & 7) * 2 + (config[1] >> 7)) !== 3 || (config[1] >> 3 & 15) !== 2) fail('配乐必须使用 48 kHz 双声道 AAC-LC。');
}

export function readAacTrack(input) {
  const r = reader(input), top = boxes(r), moov = required(top, 'moov'), movie = children(r, moov);
  const movieHeader = mediaHeader(r, required(movie, 'mvhd'));
  const tracks = movie.filter(item => item.type === 'trak');
  if (tracks.length !== 1) fail('配乐必须只有一条音轨。');
  const track = children(r, tracks[0]), mdia = children(r, required(track, 'mdia'));
  const handler = required(mdia, 'hdlr');
  if (r.type(field(r, handler, 8, 4)) !== 'soun') fail('配乐文件没有音轨。');
  const header = mediaHeader(r, required(mdia, 'mdhd'));
  const stbl = children(r, required(children(r, required(mdia, 'minf')), 'stbl'));
  const stsd = required(stbl, 'stsd');
  if (r.u32(field(r, stsd, 4, 4)) !== 1) fail('不支持多个音频配置。');
  const entry = required(children(r, stsd, 8), 'mp4a');
  const channels = r.u16(field(r, entry, 16, 2)), sampleRate = r.u32(field(r, entry, 24, 4)) / 65536;
  if (r.u16(field(r, entry, 8, 2)) !== 0 || channels !== 2 || sampleRate !== 48000 || header.timescale !== 48000) fail('配乐必须使用 48 kHz 双声道 AAC。');
  checkAacDescription(r, entry);
  const stsz = required(stbl, 'stsz'), constantSize = r.u32(field(r, stsz, 4, 4)), sampleCount = r.u32(field(r, stsz, 8, 4));
  if (!sampleCount || sampleCount > r.bytes.length) fail('无效的音频样本数量。');
  if (!constantSize) field(r, stsz, 12, sampleCount * 4);
  const sizes = Array.from({ length: sampleCount }, (_, i) => constantSize || r.u32(stsz.data + 12 + i * 4));
  const durations = [];
  for (const offset of table(r, required(stbl, 'stts'), 8)) {
    const count = r.u32(offset), delta = r.u32(offset + 4);
    if (!count || !delta || durations.length + count > sampleCount) fail('无效的音频样本时长。');
    for (let i = 0; i < count; i++) durations.push(delta);
  }
  if (durations.length !== sampleCount || durations.reduce((sum, delta) => sum + delta, 0) !== header.duration) fail('音轨时长表不匹配。');
  const mapping = table(r, required(stbl, 'stsc'), 12).map(offset => ({ first: r.u32(offset), count: r.u32(offset + 4), description: r.u32(offset + 8) }));
  if (!mapping.length || mapping[0].first !== 1 || mapping.some((row, i) => !row.count || row.description !== 1 || (i && row.first <= mapping[i - 1].first))) fail('无效的音频分块。');
  const chunkTable = stbl.find(item => ['stco', 'co64'].includes(item.type));
  if (!chunkTable) fail('缺少音频偏移表。');
  const offsets = table(r, chunkTable, chunkTable.type === 'co64' ? 8 : 4).map(offset => chunkTable.type === 'co64' ? r.u64(offset) : r.u32(offset));
  if (!offsets.length || mapping.at(-1).first > offsets.length) fail('无效的音频分块索引。');
  const media = top.filter(item => item.type === 'mdat'), samples = [];
  let row = 0;
  for (let chunk = 0; chunk < offsets.length; chunk++) {
    if (row + 1 < mapping.length && mapping[row + 1].first === chunk + 1) row++;
    let offset = offsets[chunk];
    for (let i = 0; i < mapping[row].count; i++) {
      const index = samples.length, size = sizes[index];
      if (!size || !media.some(item => offset >= item.data && offset + size <= item.end)) fail('音频样本超出数据边界。');
      samples.push({ data: r.bytes.subarray(offset, offset + size), duration: durations[index] });
      offset += size;
    }
  }
  if (samples.length !== sampleCount) fail('音频样本数量不匹配。');
  let mediaStart = 0, duration = header.duration / header.timescale;
  const edts = track.find(item => item.type === 'edts');
  if (edts) {
    const edit = required(children(r, edts), 'elst'), version = r.bytes[field(r, edit, 0, 1)];
    if (version > 1 || r.u32(field(r, edit, 4, 4)) !== 1) fail('不支持的音频裁剪。');
    const start = field(r, edit, 8, version ? 20 : 12);
    duration = (version ? r.u64(start) : r.u32(start)) / movieHeader.timescale;
    mediaStart = version ? r.i64(start + 8) : r.i32(start + 4);
    if (mediaStart < 0 || r.u32(start + (version ? 16 : 8)) !== 65536) fail('无效的音频裁剪。');
  }
  if (duration <= 0 || mediaStart + Math.round(duration * header.timescale) > header.duration) fail('配乐时长不足。');
  return { samples, sampleEntry: r.bytes.slice(entry.start, entry.end), sampleRate, channels, timescale: header.timescale, mediaStart, duration };
}

function join(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function uint(size, values) {
  const result = new Uint8Array(values.length * size), view = new DataView(result.buffer);
  values.forEach((value, i) => { if (!Number.isInteger(value) || value < 0 || value >= 2 ** (size * 8)) fail('文件字段超出范围。'); if (size === 2) view.setUint16(i * size, value); else view.setUint32(i * size, value); });
  return result;
}
const u16 = (...values) => uint(2, values);
const u32 = (...values) => uint(4, values);
const zeros = length => new Uint8Array(length);
const str = value => textEncoder.encode(value);
const box = (type, ...parts) => { const content = join(parts); return join([u32(content.length + 8), str(type), content]); };
const full = (type, flags, ...parts) => box(type, new Uint8Array([0, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...parts);
const matrix = () => u32(65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824);

function timeTable(samples) {
  const groups = [];
  for (const { duration } of samples) { const last = groups.at(-1); if (last?.[1] === duration) last[0]++; else groups.push([1, duration]); }
  return full('stts', 0, u32(groups.length), ...groups.map(group => u32(...group)));
}
function trackBox({ id, width = 0, height = 0, sampleEntry, samples, timescale, movieDuration, mediaStart = 0 }) {
  const audio = id === 2, mediaDuration = samples.reduce((sum, sample) => sum + sample.duration, 0);
  const tkhd = full('tkhd', 3, u32(0, 0, id, 0, movieDuration), zeros(8), u16(0, 0, audio ? 256 : 0, 0), matrix(), u32(width * 65536, height * 65536));
  const mdhd = full('mdhd', 0, u32(0, 0, timescale, mediaDuration), u16(21956, 0));
  const hdlr = full('hdlr', 0, u32(0), str(audio ? 'soun' : 'vide'), zeros(12), str(audio ? 'Astra audio\0' : 'Astra video\0'));
  const dinf = box('dinf', full('dref', 0, u32(1), full('url ', 1)));
  const sync = samples.flatMap((sample, i) => sample.key ? [i + 1] : []);
  const stbl = box('stbl', full('stsd', 0, u32(1), sampleEntry), timeTable(samples),
    full('stsc', 0, u32(1, 1, 1, 1)), full('stsz', 0, u32(0, samples.length), ...samples.map(sample => u32(sample.data.length))),
    full('stco', 0, u32(samples.length), ...samples.map(sample => u32(sample.offset))),
    ...(audio ? [] : [full('stss', 0, u32(sync.length), ...sync.map(index => u32(index)))]));
  const minf = box('minf', audio ? full('smhd', 0, u16(0, 0)) : full('vmhd', 1, u16(0, 0, 0, 0)), dinf, stbl);
  const edit = audio ? [box('edts', full('elst', 0, u32(1, movieDuration, mediaStart), u16(1, 0)))] : [];
  return box('trak', tkhd, ...edit, box('mdia', mdhd, hdlr, minf));
}

export function muxMp4({ width, height, fps, videoSamples, videoConfig, audioTrack }) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value < 65536 && value % 2 === 0) || !Number.isInteger(fps) || fps <= 0 || MOVIE_SCALE % fps) fail('无效的视频配置。');
  const config = bytesOf(videoConfig);
  if (config.length < 7 || config[0] !== 1 || config[1] !== 66 || !(config[5] & 31)) fail('视频必须使用 Baseline AVC 配置。');
  if (!videoSamples?.length || !videoSamples[0].key || videoSamples.some(sample => !sample.data?.length)) fail('缺少视频帧或关键帧。');
  const duration = videoSamples.length / fps, movieDuration = videoSamples.length * (MOVIE_SCALE / fps);
  if (!audioTrack?.samples?.length || Math.abs(audioTrack.duration - duration) > 1 / MOVIE_SCALE) fail('音视频时长不匹配。');
  const video = videoSamples.map(sample => ({ ...sample, duration: MOVIE_SCALE / fps, offset: 0 }));
  const audio = audioTrack.samples.map(sample => ({ ...sample, offset: 0 }));
  const entry = box('avc1', zeros(6), u16(1), zeros(16), u16(width, height), u32(72 * 65536, 72 * 65536, 0), u16(1), zeros(32), u16(24, 65535), box('avcC', config));
  const ftyp = box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41'));
  const makeMovie = () => box('moov', full('mvhd', 0, u32(0, 0, MOVIE_SCALE, movieDuration, 65536), u16(256), zeros(10), matrix(), zeros(24), u32(3)),
    trackBox({ id: 1, width, height, sampleEntry: entry, samples: video, timescale: MOVIE_SCALE, movieDuration }),
    trackBox({ id: 2, sampleEntry: audioTrack.sampleEntry, samples: audio, timescale: audioTrack.timescale, mediaStart: audioTrack.mediaStart, movieDuration }));
  let audioTime = -audioTrack.mediaStart;
  const ordered = [
    ...video.map((sample, i) => ({ sample, time: i / fps })),
    ...audio.map(sample => { const time = audioTime / audioTrack.timescale; audioTime += sample.duration; return { sample, time }; }),
  ].sort((a, b) => a.time - b.time);
  const provisional = makeMovie(), dataSize = ordered.reduce((sum, { sample }) => sum + sample.data.length, 0);
  let offset = ftyp.length + provisional.length + 8;
  if (offset + dataSize >= 2 ** 32) fail('视频超过当前封装支持的大小。');
  for (const { sample } of ordered) { sample.offset = offset; offset += sample.data.length; }
  return new Blob([ftyp, makeMovie(), u32(dataSize + 8), str('mdat'), ...ordered.map(({ sample }) => sample.data)], { type: 'video/mp4' });
}
