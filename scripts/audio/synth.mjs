// Small deterministic PCM synthesizer and stereo mixer. No sound fonts or network.
export const SAMPLE_RATE = 48000;
const TAU = Math.PI * 2;
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const frequency = note => 440 * 2 ** ((note - 69) / 12);

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function edges(t, duration, attack = 0.004, release = 0.06) {
  const a = clamp(t / attack), r = clamp((duration - t) / release);
  return Math.sin(a * Math.PI / 2) ** 2 * Math.sin(r * Math.PI / 2) ** 2;
}

export function synthesize(event) {
  const { kind, duration, note = 60, seed = 0 } = event;
  const samples = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  const noise = random(seed), hz = frequency(note);
  let low = 0, dark = 0, phase = 0;
  // Karplus–Strong string, excited once with seeded, DC-free noise.
  const string = kind === 'pluck' ? new Float32Array(Math.round(SAMPLE_RATE / hz - 0.5)) : null;
  if (string) {
    let mean = 0;
    for (let i = 0; i < string.length; i++) { string[i] = noise() * 2 - 1; mean += string[i]; }
    for (let i = 0; i < string.length; i++) string[i] -= mean / string.length;
  }
  let cursor = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE, p = t / duration;
    const white = noise() * 2 - 1;
    low += 0.32 * (white - low); dark += 0.045 * (white - dark);
    const band = low - dark;
    let s;
    switch (kind) {
      case 'piano': {
        // A struck, slightly stretched harmonic spectrum with a soft hammer.
        const decay = 3.8 + hz / 900;
        s = Math.sin(TAU * hz * t) * Math.exp(-t * decay)
          + 0.18 * Math.sin(TAU * hz * 1.0007 * t) * Math.exp(-t * decay * 1.12)
          + 0.42 * Math.sin(TAU * hz * 2.001 * t) * Math.exp(-t * 8)
          + 0.17 * Math.sin(TAU * hz * 3.004 * t) * Math.exp(-t * 14)
          + 0.075 * Math.sin(TAU * hz * 4.009 * t) * Math.exp(-t * 22)
          + 0.025 * band * Math.exp(-t * 110);
        s *= 0.74;
        break;
      }
      case 'pizz':
        s = (Math.sin(TAU * hz * t) + 0.5 * Math.sin(TAU * hz * 2 * t)
          + 0.24 * Math.sin(TAU * hz * 3 * t) + 0.07 * Math.sin(TAU * hz * 4 * t)) * Math.exp(-t * (10 + hz / 230))
          + 0.04 * band * Math.exp(-t * 75);
        s *= 0.78;
        break;
      case 'flute': {
        const vibrato = 0.0022 * Math.sin(TAU * 5.3 * t) * clamp((t - 0.065) / 0.13);
        phase += TAU * hz * (1 + vibrato) / SAMPLE_RATE;
        s = (Math.sin(phase) + 0.19 * Math.sin(phase * 2) + 0.055 * Math.sin(phase * 3) + 0.018 * band)
          * edges(t, duration, 0.018, 0.04) * 0.88;
        break;
      }
      case 'mallet':
        s = Math.sin(TAU * hz * t) * Math.exp(-t * 5.5)
          + 0.24 * Math.sin(TAU * hz * 2.76 * t) * Math.exp(-t * 23)
          + 0.08 * Math.sin(TAU * hz * 5.4 * t) * Math.exp(-t * 46);
        break;
      case 'bell':
        s = Math.sin(TAU * hz * t) * Math.exp(-t * 4)
          + 0.3 * Math.sin(TAU * hz * 2.01 * t) * Math.exp(-t * 8)
          + 0.08 * Math.sin(TAU * hz * 3.98 * t) * Math.exp(-t * 18);
        break;
      case 'pluck': {
        s = string[cursor];
        string[cursor] = (s + string[(cursor + 1) % string.length]) * 0.498;
        cursor = (cursor + 1) % string.length;
        break;
      }
      case 'bass':
        phase += TAU * hz * (1 + 0.018 * Math.exp(-t * 45)) / SAMPLE_RATE;
        s = (Math.sin(phase) + 0.25 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3)) * Math.exp(-t * 2.7);
        break;
      case 'pad':
        s = (Math.sin(TAU * hz * t) + 0.35 * Math.sin(TAU * (hz + 0.6) * t)
          + 0.12 * Math.sin(TAU * hz * 3 * t)) * edges(t, duration, 0.18, 0.24);
        break;
      case 'kick':
        phase += TAU * (52 + 100 * Math.exp(-t * 38)) / SAMPLE_RATE;
        s = Math.sin(phase) * Math.exp(-t * 19) + 0.035 * band * Math.exp(-t * 220);
        break;
      case 'rim':
        s = (Math.sin(TAU * 790 * t) + 0.45 * Math.sin(TAU * 1130 * t)) * Math.exp(-t * 95)
          + band * 0.4 * Math.exp(-t * 100);
        break;
      case 'woodblock':
        s = (Math.sin(TAU * hz * 1.48 * t) + 0.45 * Math.sin(TAU * hz * 2.31 * t)) * Math.exp(-t * 72)
          + 0.09 * band * Math.exp(-t * 130);
        break;
      case 'brush':
        s = band * 0.85 * Math.exp(-t * 28) * edges(t, duration, 0.002, 0.025)
          + 0.055 * Math.sin(TAU * 180 * t) * Math.exp(-t * 48);
        break;
      case 'shaker':
        s = band * Math.sin(Math.PI * p) ** 2 * Math.exp(-p * 2);
        break;
      case 'snip': {
        const second = Math.max(0, t - 0.043);
        const bursts = Math.exp(-t * 110) + (t >= 0.043 ? Math.exp(-second * 135) * 0.75 : 0);
        s = band * 0.9 * bursts + 0.14 * Math.sin(TAU * 1850 * t) * Math.exp(-t * 80);
        break;
      }
      case 'pop':
        phase += TAU * hz * (0.38 + 0.9 * Math.exp(-t * 32)) / SAMPLE_RATE;
        s = Math.sin(phase) * Math.exp(-t * 34) + 0.08 * band * Math.exp(-t * 90);
        break;
      case 'glide':
        phase += TAU * frequency(note + ((event.endNote ?? note) - note) * p) / SAMPLE_RATE;
        s = (Math.sin(phase) + 0.15 * Math.sin(phase * 2)) * Math.sin(Math.PI * p) ** 0.7;
        break;
      case 'whoosh':
      case 'spin': {
        const sweep = kind === 'spin' ? 0.07 + 0.22 * (0.5 + 0.5 * Math.sin(p * TAU * 3)) : 0.025 + p * 0.38;
        // A moving low-pass is less abrasive than unfiltered white noise.
        phase += sweep * (white - phase);
        s = (phase - dark * 0.65) * Math.sin(Math.PI * p) ** 1.3;
        if (kind === 'spin') s += 0.055 * Math.sin(TAU * (330 * t + 440 * t * t)) * Math.sin(Math.PI * p);
        break;
      }
      case 'shake': {
        const pulse = Math.sin(TAU * t * 12) ** 6;
        s = band * (0.14 + pulse * 0.86) * edges(t, duration, 0.012, 0.06);
        break;
      }
      case 'scratch':
        s = band * (0.15 + 0.85 * Math.sin(TAU * t * 9) ** 4) * edges(t, duration, 0.009, 0.035);
        break;
      default: throw new Error(`Unknown synthesized instrument: ${kind}`);
    }
    samples[i] = s * edges(t, duration, kind === 'snip' || kind === 'rim' ? 0.0008 : 0.003);
  }
  return samples;
}

export function renderBus(events, length) {
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (const event of events) {
    const signal = synthesize(event), start = Math.round(event.time * SAMPLE_RATE);
    if (start < 0 || !Number.isFinite(event.gain) || event.duration <= 0) throw new Error('Invalid audio event.');
    const pan = clamp(event.pan ?? 0, -1, 1);
    const left = Math.cos((pan + 1) * Math.PI / 4), right = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < signal.length && start + i < length; i++) {
      const offset = start + i, sample = signal[i] * event.gain;
      if (event.endPan !== undefined) {
        const angle = (pan + (event.endPan - pan) * i / signal.length + 1) * Math.PI / 4;
        channels[0][offset] += sample * Math.cos(angle); channels[1][offset] += sample * Math.sin(angle);
      } else { channels[0][offset] += sample * left; channels[1][offset] += sample * right; }
    }
  }
  return channels;
}

function room(channels, wet) {
  for (let c = 0; c < 2; c++) {
    const signal = channels[c], reflection = new Float32Array(signal.length);
    for (const seconds of [0.0297, 0.0371, 0.0411, 0.0437]) {
      const delay = Math.round((seconds + c * 0.0023) * SAMPLE_RATE), buffer = new Float32Array(delay);
      let cursor = 0, damped = 0;
      for (let i = 0; i < signal.length; i++) {
        const reflected = buffer[cursor]; damped += 0.35 * (reflected - damped);
        buffer[cursor] = signal[i] + damped * 0.48;
        reflection[i] += reflected * wet / 4;
        cursor = (cursor + 1) % delay;
      }
    }
    for (let i = 0; i < signal.length; i++) signal[i] += reflection[i];
  }
}

export function renderSoundtrack(score, timing, { background } = {}) {
  const length = Math.round(timing.frames / timing.fps * SAMPLE_RATE);
  const recorded = background !== undefined;
  if (recorded && (!Array.isArray(background) || background.length !== 2 || background.some(channel => !(channel instanceof Float32Array) || channel.length !== length))) {
    throw new Error(`Expected exactly ${length} background samples per stereo channel.`);
  }
  const music = recorded ? background : renderBus(score.music, length), effects = renderBus(score.effects, length);
  if (!recorded) room(music, 0.19);
  room(effects, 0.09);
  const duck = new Float32Array(length).fill(1);
  // Shape musical breaths after the room, so reverb also stops at the joke.
  // Effects remain on their own bus and retain their exact visual-cue timing.
  for (const { start, end, depth } of recorded ? [] : score.musicPauses ?? []) {
    const first = Math.round(start * SAMPLE_RATE), last = Math.round(end * SAMPLE_RATE);
    const fade = Math.round(0.028 * SAMPLE_RATE);
    for (let i = Math.max(0, first - fade); i < Math.min(length, last + fade); i++) {
      const ramp = i < first ? (i - first + fade) / fade : i < last ? 1 : 1 - (i - last) / fade;
      const envelope = Math.sin(clamp(ramp) * Math.PI / 2) ** 2;
      duck[i] = Math.min(duck[i], 1 - depth * envelope);
    }
  }
  for (const { frame, duration, depth = 0.24 } of score.groups) {
    const start = Math.round(frame / timing.fps * SAMPLE_RATE), end = Math.min(length, start + Math.round(duration * SAMPLE_RATE));
    const attack = Math.round(0.012 * SAMPLE_RATE), release = Math.round(0.12 * SAMPLE_RATE);
    for (let i = Math.max(0, start - attack); i < Math.min(length, end + release); i++) {
      const envelope = i < start ? (i - start + attack) / attack : i < end ? 1 : 1 - (i - end) / release;
      duck[i] = Math.min(duck[i], 1 - depth * envelope);
    }
  }
  const mix = [new Float32Array(length), new Float32Array(length)];
  for (let c = 0; c < 2; c++) for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    mix[c][i] = (music[c][i] * duck[i] + effects[c][i]) * edges(t, length / SAMPLE_RATE, 0.025, 0.55);
    if (!Number.isFinite(mix[c][i])) throw new Error(`Non-finite audio sample at ${i}.`);
  }
  return { mix, music, effects };
}

export function floatWav(channels) {
  const length = channels[0].length, bytes = length * 8, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24); buffer.writeUInt32LE(SAMPLE_RATE * 8, 28);
  buffer.writeUInt16LE(8, 32); buffer.writeUInt16LE(32, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++) buffer.writeFloatLE(channels[c][i], 44 + (i * 2 + c) * 4);
  return buffer;
}

export function readPcmWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a RIFF WAV.');
  let format, data;
  for (let at = 12; at + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', at, at + 4), size = buffer.readUInt32LE(at + 4), start = at + 8;
    if (start + size > buffer.length) throw new Error('Truncated WAV chunk.');
    if (id === 'fmt ') format = { codec: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), bits: buffer.readUInt16LE(start + 14) };
    if (id === 'data') data = buffer.subarray(start, start + size);
    at = start + size + (size % 2);
  }
  if (!format || !data || format.codec !== 1 || format.channels !== 2 || format.bits !== 16 || data.length % 4) throw new Error('Expected 16-bit stereo PCM WAV.');
  const samples = data.length / 4, channels = [new Float32Array(samples), new Float32Array(samples)];
  for (let i = 0; i < samples; i++) for (let c = 0; c < 2; c++) channels[c][i] = data.readInt16LE((i * 2 + c) * 2) / 32768;
  return { ...format, samples, data, signal: channels, duration: samples / format.sampleRate };
}
