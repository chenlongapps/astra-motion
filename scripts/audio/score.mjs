import { random } from './synth.mjs';

export const composition = Object.freeze({
  title: 'A Little Editor (Starlight Bounce)', bpm: 120, key: 'G major', meter: '4/4',
  swing: 0.56, seed: 0x055c0de, version: 2,
});
const chords = {
  G6: { notes: [55, 59, 62, 64], bass: 43 },
  D6: { notes: [54, 57, 59, 62], bass: 38 },
  Em7: { notes: [55, 59, 62, 64], bass: 40 },
  C6: { notes: [55, 57, 60, 64], bass: 36 },
  Am7: { notes: [55, 57, 60, 64], bass: 45 },
  D7: { notes: [54, 57, 60, 62], bass: 38 },
};
const progression = ['G6', 'D6', 'Em7', 'C6', 'G6', 'D7', 'Em7', 'C6', 'Am7', 'D7', 'G6', 'Em7', 'C6', 'D7', 'G6'];
// Original call-and-response phrases: beat, MIDI note, sounding length in beats.
// Short notes, pickups and rests give the tune its bounce without a faster clock.
const phrases = [
  [[0, 74, 0.28], [0.5, 79, 0.22], [0.75, 78, 0.18], [1.25, 76, 0.42], [2.25, 71, 0.24], [2.75, 74, 0.24], [3.5, 79, 0.32]],
  [[0.25, 78, 0.32], [1, 81, 0.22], [1.5, 79, 0.2], [1.75, 78, 0.22], [2.5, 74, 0.48], [3.25, 76, 0.2], [3.5, 78, 0.3]],
  [[0, 76, 0.3], [0.5, 79, 0.24], [1.25, 83, 0.38], [2, 81, 0.22], [2.5, 79, 0.26], [3.25, 76, 0.24], [3.75, 74, 0.18]],
  [[0.25, 76, 0.28], [0.75, 79, 0.24], [1.5, 81, 0.36], [2.25, 79, 0.22], [2.75, 76, 0.22], [3.5, 72, 0.3]],
  [[0, 71, 0.26], [0.5, 74, 0.22], [1, 79, 0.42], [2, 78, 0.22], [2.5, 79, 0.28], [3.25, 83, 0.38]],
  [[0.25, 81, 0.3], [0.75, 78, 0.24], [1.5, 76, 0.32], [2.25, 74, 0.22], [2.75, 72, 0.24], [3.5, 74, 0.3]],
  [[0.5, 76, 0.22], [1.5, 79, 0.24], [2.5, 83, 0.28]],
  [[0, 79, 0.24], [0.75, 76, 0.24], [2.25, 72, 0.22], [3, 76, 0.28], [3.5, 79, 0.3]],
  [[0, 76, 0.24], [0.5, 81, 0.22], [1.25, 79, 0.24], [1.75, 76, 0.24], [2.5, 72, 0.28], [3.25, 74, 0.2], [3.5, 76, 0.24]],
  [[0, 78, 0.2], [0.5, 81, 0.24], [1, 84, 0.2], [1.5, 81, 0.26]],
  [[0, 79, 0.26], [0.5, 83, 0.24], [0.75, 81, 0.18], [1.25, 79, 0.32], [2, 74, 0.24], [2.5, 76, 0.24], [3, 78, 0.2], [3.5, 79, 0.26]],
  [[0.25, 83, 0.26], [0.75, 81, 0.22], [1.25, 79, 0.28], [2, 76, 0.24], [2.5, 79, 0.24], [3.25, 83, 0.3]],
  [[0, 81, 0.3], [0.5, 79, 0.22], [1.25, 76, 0.24], [1.75, 79, 0.22], [2.5, 84, 0.32], [3.25, 83, 0.24], [3.5, 81, 0.26]],
  [[0.25, 78, 0.24], [0.75, 81, 0.24], [1.5, 84, 0.32], [2.25, 81, 0.2], [2.75, 78, 0.22], [3.5, 74, 0.3]],
  [[0, 83, 0.3], [0.5, 81, 0.24], [1, 79, 0.32], [1.75, 76, 0.26], [2.75, 79, 1.1]],
];

export function compose(timing) {
  const { fps, frames, cues } = timing;
  if (!Number.isInteger(fps) || fps <= 0 || !Number.isInteger(frames) || frames <= 0 || Object.values(cues).some(f => !Number.isInteger(f) || f < 0 || f >= frames)) throw new Error('Invalid shared animation timing.');
  const music = [], effects = [], groups = [], seeded = random(composition.seed);
  const musicPauses = [
    { start: cues.cut / fps - 0.045, end: cues.cut / fps + 0.1, depth: 0.68 },
    { start: cues.notice / fps - 0.025, end: cues.swap / fps - 0.045, depth: 0.8 },
    { start: cues.calm / fps + 0.025, end: cues.zoom / fps - 0.06, depth: 1 },
  ];
  const comicRest = { start: cues.calm / fps, end: cues.zoom / fps };
  let counter = 0;
  const add = (bus, kind, time, duration, note, gain, pan = 0, extra = {}) => {
    if (bus === 'music') {
      if (time >= frames / fps || (time >= comicRest.start && time < comicRest.end)) return;
      duration = Math.min(duration, frames / fps - time);
      if (time < comicRest.start) duration = Math.min(duration, comicRest.start - time);
    }
    const event = { kind, time, duration, note, gain, pan, seed: (composition.seed ^ Math.imul(++counter, 2654435761)) >>> 0, ...extra };
    (bus === 'music' ? music : effects).push(event);
  };
  const beat = 60 / composition.bpm, barDuration = beat * 4, duration = frames / fps;
  const chordAt = time => chords[progression[Math.min(progression.length - 1, Math.floor(time / barDuration))]];
  const swing = at => {
    const whole = Math.floor(at), part = at - whole;
    return whole + (part < 0.5 ? part * composition.swing * 2 : composition.swing + (part - 0.5) * (1 - composition.swing) * 2);
  };
  for (let bar = 0; bar * barDuration < duration; bar++) {
    // The dance groove starts exactly when the character jumps into the timeline.
    const dance = bar === 10 || bar === 11, text = bar === 6 || bar === 7, ending = bar === 14;
    const start = dance ? cues.beatDance / fps + (bar - 10) * barDuration : bar * barDuration + 0.035;
    const chord = chords[progression[bar % progression.length]];
    const density = text ? 0.62 : dance ? 1.1 : 1;
    const atTime = at => start + swing(at) * beat;
    const lead = [4, 5, 8, 12, 13].includes(bar) ? 'flute' : 'piano';
    for (const [at, note, length] of phrases[bar % phrases.length]) {
      const accent = at % 1 === 0.5 || at % 1 === 0.75 ? 1.08 : 0.94;
      add('music', lead, atTime(at) + seeded() * 0.006, length * beat,
        note, (lead === 'flute' ? 0.12 : 0.17) * density * accent * (0.9 + seeded() * 0.16), lead === 'flute' ? 0.16 : -0.13);
      if (dance && at % 1 === 0) add('music', 'bell', atTime(at), 0.24, note + 12, 0.024, 0.33);
    }
    const compBeats = ending ? [0, 2.75] : text ? [0.5, 2.5] : bar < 2 ? [1, 3] : [0.5, 1.5, 2.5, 3.5];
    for (const [hit, at] of compBeats.entries()) for (const [i, note] of chord.notes.entries()) {
      add('music', hit % 2 ? 'piano' : 'pizz', atTime(at) + i * 0.007, ending ? 0.72 : 0.19 + (hit % 2) * 0.035,
        note + (bar < 2 ? 12 : 0), (hit % 2 ? 0.04 : 0.053) * density * (i === 0 ? 0.85 : 1), 0.3 + i * 0.025);
    }
    const next = chords[progression[Math.min(progression.length - 1, bar + 1)]].bass;
    const bassNotes = ending ? [[0, chord.bass], [2.75, chord.bass]] : text ? [[0, chord.bass], [2, chord.bass + 7]]
      : [[0, chord.bass], [1.5, chord.bass + 7], [2, chord.bass + 12], [3.5, next - 1]];
    for (const [at, note] of bassNotes) add('music', 'bass', atTime(at), ending ? 0.8 : at % 1 ? 0.19 : 0.32,
      note, (at % 1 ? 0.14 : 0.19) * density);
    if (bar === 0 || ending) continue;
    for (const at of [0, 2, ...(dance ? [2.75] : [])]) add('music', 'kick', atTime(at), 0.19, 36, dance ? 0.15 : text ? 0.065 : 0.095);
    for (const at of [1, 3]) add('music', bar < 4 || text ? 'woodblock' : 'brush', atTime(at) + 0.007, 0.12, 67,
      text ? 0.035 : dance ? 0.115 : 0.085, -0.24);
    for (let step = 0; step < 8; step++) {
      if ((text || bar < 2) && step % 2 === 0) continue;
      add('music', 'shaker', atTime(step / 2) + seeded() * 0.006, step % 2 ? 0.075 : 0.05, 60,
        (step % 2 ? 0.067 : 0.035) * density, -0.42 + seeded() * 0.14);
    }
    // An answering figure occupies a phrase's empty space, never every bar.
    if ([2, 3, 4, 5, 8, 12].includes(bar)) for (const [i, note] of [chord.notes[1] + 12, chord.notes[2] + 12, chord.notes[3] + 12].entries()) {
      add('music', lead === 'flute' ? 'piano' : 'pizz', atTime(3 + i * 0.25), 0.13, note, 0.072 * density, lead === 'flute' ? -0.27 : 0.28);
    }
    if (bar === 8) for (const [i, note] of [76, 79, 81, 83].entries()) add('music', 'piano', atTime(3 + i * 0.25), 0.11, note, 0.078, -0.1 + i * 0.08);
    if (ending) {
      for (const [i, note] of [67, 71, 74, 79].entries()) add('music', 'bell', atTime(2.75) + i * 0.021, 0.56, note + 12, 0.047, -0.18 + i * 0.12);
      for (const note of chord.notes) add('music', 'pad', atTime(2.75), 0.56, note, 0.02);
    }
  }
  for (const [i, note] of [71, 74, 76, 78].entries()) add('music', 'piano', cues.zoom / fps + 0.02 + i * 0.085, 0.12, note, 0.11, -0.2 + i * 0.12);
  for (const [i, note] of [72, 76, 79, 81].entries()) add('music', 'pizz', cues.corrected / fps + i * 0.075, 0.18, note, 0.082, -0.2 + i * 0.12);

  const cue = (name, soundDuration, fn, depth = 0.24) => {
    const frame = cues[name];
    if (frame === undefined) throw new Error(`Missing sound cue: ${name}`);
    const time = frame / fps;
    groups.push({ cue: name, frame, time, duration: soundDuration, depth });
    fn((kind, offset, length, note, gain, pan = 0, extra = {}) => add('effects', kind, time + offset, length, note, gain, pan, { cue: name, ...extra }), chordAt(time));
  };
  cue('audio', 0.15, fx => fx('pop', 0, 0.12, 72, 0.095), 0.12);
  for (const [i, name] of ['sun', 'coffee', 'cat', 'dance'].entries()) {
    cue(name, 0.2, fx => fx('whoosh', 0, 0.2, 60, 0.07, -0.25, { endPan: 0.12 }), 0.08);
    cue(`${name}Land`, 0.15, fx => fx('pop', 0, 0.14, 72 + i * 2, 0.12, -0.2 + i * 0.12), 0.12);
  }
  cue('cut', 0.18, fx => fx('snip', 0, 0.16, 60, 0.32, -0.18), 0.3);
  cue('throw', 0.35, fx => fx('whoosh', 0, 0.34, 60, 0.22, -0.35, { endPan: 0.55 }));
  cue('closeGap', 0.14, fx => fx('pop', 0, 0.13, 66, 0.14));
  cue('transitions', 0.12, fx => fx('rim', 0, 0.11, 60, 0.075), 0.12);
  cue('spin', 0.55, fx => fx('spin', 0, 0.55, 60, 0.24, -0.45, { endPan: 0.4 }));
  cue('tumble', 0.65, fx => {
    fx('glide', 0, 0.22, 79, 0.075, 0.2, { endNote: 67 });
    fx('pop', 0.43, 0.18, 55, 0.14);
  });
  cue('whoosh', 0.34, fx => fx('whoosh', 0, 0.34, 60, 0.29, -0.5, { endPan: 0.5 }));
  for (const [i, name] of ['wait', 'for', 'typo'].entries()) cue(name, 0.12,
    (fx, chord) => fx('mallet', 0, 0.16, chord.notes[i] + 12, 0.085, 0.12), 0.18);
  cue('notice', 0.3, fx => fx('glide', 0, 0.28, 74, 0.078, -0.15, { endNote: 69 }), 0.32);
  cue('swap', 0.2, fx => fx('pop', 0, 0.14, 81, 0.11, 0.16), 0.2);
  const chime = (fx, chord, gain = 0.115) => chord.notes.forEach((note, i) => fx('bell', i * 0.047, 0.6, note + 24, gain * (1 - i * 0.12), -0.18 + i * 0.18));
  cue('corrected', 0.55, (fx, chord) => chime(fx, chord), 0.28);
  cue('sparkle', 0.46, (fx, chord) => chime(fx, chord, 0.083), 0.19);
  cue('maxShake', (cues.calm - cues.maxShake) / fps, fx => fx('shake', 0, (cues.calm - cues.maxShake) / fps, 60, 0.145), 0.23);
  cue('calm', 0.12, fx => fx('pop', 0, 0.1, 58, 0.08), 0.12);
  cue('zoom', 0.26, fx => { fx('whoosh', 0, 0.24, 60, 0.18); fx('kick', 0, 0.22, 36, 0.13); });
  cue('beatDance', 0.36, fx => {
    fx('kick', 0, 0.22, 36, 0.16);
    for (let i = 0; i < 3; i++) fx('rim', 0.09 + i * 0.075, 0.085, 60, 0.054 + i * 0.009, -0.15 + i * 0.15);
  }, 0.16);
  cue('onBeat', 0.19, fx => { fx('kick', 0, 0.19, 36, 0.16); fx('rim', 0, 0.1, 60, 0.065); }, 0.13);
  cue('exportStart', (cues.exportDone - cues.exportStart) / fps, (fx, chord) => {
    fx('pop', 0, 0.12, 72, 0.1);
    for (let i = 0; i < 6; i++) fx('mallet', (10 + i * 3) / fps, 0.12, chord.notes[i % 3] + 12 + (i >= 3 ? 12 : 0), 0.055, 0.12);
  }, 0.19);
  cue('exportDone', 0.64, (fx, chord) => chime(fx, chord, 0.14), 0.28);
  cue('finale', 0.34, fx => fx('whoosh', 0, 0.32, 60, 0.16, -0.2, { endPan: 0.2 }), 0.16);
  cue('nailed', 0.5, (fx, chord) => { fx('pop', 0, 0.13, 79, 0.12); chime(fx, chord, 0.095); }, 0.24);
  cue('signature', 0.43, fx => fx('scratch', 0, 0.42, 60, 0.09, -0.25), 0.16);
  return { music, effects, groups, musicPauses, composition, progression };
}
