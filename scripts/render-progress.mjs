import { readFile } from 'node:fs/promises';

// Export phases in execution order; later phases supply the ETA tail.
const PHASE_ORDER = ['audio', 'cache', 'browser', 'capture', 'encode', 'validate'];
const WARMUP_SECONDS = 2, WARMUP_FRAMES = 10, RATE_ALPHA = 0.35;

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds), pad = value => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

export function formatClockTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Reuse the previous export of the same profile as a seed so even the first
// phase can estimate the rest of the pipeline; per-frame phases scale with it.
export function selectPhaseEstimates(previous, { resolution, fps, encoder, source, frames } = {}) {
  const timings = previous?.timingsSeconds;
  if (!timings || previous.resolution !== resolution || previous.fps !== fps || previous.source !== source) return {};
  if (encoder && (previous.encoder !== encoder.name || !!previous.hardware !== !!encoder.hardware)) return {};
  const scaled = (seconds, perFrame) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const weight = perFrame && Number.isFinite(previous.frames) && previous.frames > 0 ? Math.max(0, frames) / previous.frames : 1;
    return value * weight;
  };
  const capture = ['draw', 'screenshots', 'frameWrites', 'encoderWait'].reduce((sum, key) => sum + (Number(timings[key]) || 0), 0);
  const estimates = {};
  const audio = scaled(timings.audio); if (audio) estimates.audio = audio;
  const browser = scaled(timings.browserStartup); if (browser) estimates.browser = browser;
  const capturing = scaled(capture, true); if (capturing) estimates.capture = capturing;
  // encodingWall covers the whole pipe, including waiting on frame capture.
  const encode = scaled(source === 'cached-png' ? timings.encodingWall : timings.encodingWall - capture, true);
  if (encode) estimates.encode = Math.max(0.5, encode);
  const validation = scaled(timings.validation); if (validation) estimates.validate = validation;
  return estimates;
}

export async function loadPhaseEstimates(file, current) {
  try { return selectPhaseEstimates(JSON.parse(await readFile(file, 'utf8')).render, current); }
  catch { return {}; }
}

// FFmpeg reports progress either as one `frame=… fps=…` stats line or as the
// multi-line key=value blocks written by -progress; diagnostics never do.
const PROGRESS_KEY = /^(?:frame|fps|speed|progress|bitrate|total_size|out_time_us|out_time_ms|out_time|dup_frames|drop_frames|stream_\d+_\d+_q)=/;

export function parseEncoderLine(line) {
  const text = line.trim();
  if (!text) return {};
  const frame = /^frame=\s*(\d+)/.exec(text);
  if (frame) return { frame: Number(frame[1]) };
  if (PROGRESS_KEY.test(text)) return {};
  return { forward: text };
}

// Split FFmpeg stderr chunks into lines: progress blocks update the encoded
// frame count, every other line keeps flowing to the terminal.
export function createEncoderFeed({ onFrame, forward } = {}) {
  let tail = '';
  return {
    push(chunk) {
      tail += chunk;
      const lines = tail.split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseEncoderLine(line);
        if (parsed.frame !== undefined && onFrame) onFrame(parsed.frame);
        else if (parsed.forward && forward) forward(parsed.forward);
      }
    },
    pending: () => tail,
  };
}

export function createExportProgress({ label = 'export', estimates = {}, phases = PHASE_ORDER, stream = process.stdout, now = () => performance.now(), clock = () => new Date(), interactive = process.stdout.isTTY === true && !process.env.CI, interval = 500, lineInterval = 5000 } = {}) {
  // Only phases this run actually executes can contribute to the ETA tail, so a
  // sample or cached-frame export does not count encoding it never performs.
  const sequence = [...new Set(phases.filter(name => PHASE_ORDER.includes(name)))].sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
  let phaseName = '', phaseTotal = 0, done = 0, rate, phaseStartedAt = now(), startedAt = now(), sampledAt = phaseStartedAt, sampledDone = 0, lastWriteAt = -Infinity, lastLength = 0, lastText = '', live = false, ended = false;
  const estimate = name => Number.isFinite(estimates[name]) && estimates[name] > 0 ? estimates[name] : undefined;
  const laterEstimates = name => { const index = sequence.indexOf(name); return index < 0 ? 0 : sequence.slice(index + 1).reduce((sum, key) => sum + (estimate(key) ?? 0), 0); };
  const phaseElapsed = () => (now() - phaseStartedAt) / 1000;
  // A throughput estimate only counts once the phase has warmed up, so early
  // updates report "estimating" instead of a meaningless ETA.
  const measured = () => phaseTotal > 0 && rate !== undefined && phaseElapsed() >= WARMUP_SECONDS && done >= WARMUP_FRAMES;

  function sample(value) {
    const stamp = now(), seconds = (stamp - sampledAt) / 1000, delta = value - sampledDone;
    sampledDone = value; sampledAt = stamp;
    // Delta rates ignore work a phase inherited, so resuming a phase from an
    // FFmpeg frame count still reports the real throughput.
    if (delta > 0 && seconds > 0) { const instant = delta / seconds; rate = rate === undefined ? instant : rate * (1 - RATE_ALPHA) + instant * RATE_ALPHA; }
  }

  function remainingSeconds() {
    const later = laterEstimates(phaseName);
    let current;
    if (phaseTotal > 0) {
      if (done >= phaseTotal) current = 0;
      else if (measured()) current = (phaseTotal - done) / Math.max(rate, 1e-6);
      else current = estimate(phaseName);
    } else {
      const seeded = estimate(phaseName);
      if (seeded !== undefined) current = Math.max(0, seeded - phaseElapsed());
    }
    if (current === undefined && later <= 0) return undefined;
    return (current ?? 0) + later;
  }

  function compose() {
    const parts = [`${label} ${phaseName}`, `elapsed ${formatClock(phaseElapsed())}`];
    if (phaseTotal > 0) {
      parts.splice(1, 0, `${done}/${phaseTotal} (${(done / phaseTotal * 100).toFixed(1)}%)`);
      parts.push(measured() ? `${rate.toFixed(2)} fps` : 'estimating');
    } else {
      const seeded = estimate(phaseName);
      if (seeded !== undefined) parts.push(`≈${formatClock(seeded)}`);
    }
    const remaining = remainingSeconds();
    if (remaining !== undefined) {
      parts.push(`remaining ${formatClock(remaining)}`);
      parts.push(`total ≈${formatClock((now() - startedAt) / 1000 + remaining)}`);
      parts.push(`done ${formatClockTime(new Date(clock().getTime() + remaining * 1000))}`);
    }
    return parts.join(' · ');
  }

  function write(text, finalLine) {
    const columns = stream.columns;
    // Keep a live status line inside the terminal width; logs stay readable.
    const base = interactive && Number.isInteger(columns) && columns > 1 && text.length > columns ? text.slice(0, columns - 1) : text;
    // Trailing spaces erase leftovers whenever a live line shrinks.
    const line = interactive ? base + ' '.repeat(Math.max(0, lastLength - base.length)) : base;
    stream.write(interactive ? `\r${line}${finalLine ? '\n' : ''}` : `${line}\n`);
    live = !finalLine;
    lastLength = line.length;
    lastText = finalLine ? '' : text;
  }

  // Closing an unchanged live line only needs the newline, so a phase that just
  // reported 100% does not print the same status twice.
  function closeLive() {
    if (!live) return;
    const text = compose();
    if (text === lastText) { stream.write('\n'); live = false; return; }
    write(text, true);
  }

  function flush(force = false) {
    if (ended || !phaseName) return;
    const stamp = now();
    if (!force && stamp - lastWriteAt < (interactive ? interval : lineInterval)) return;
    lastWriteAt = stamp;
    write(compose(), false);
  }

  function phase(name, total = 0) {
    if (ended) return;
    if (phaseName) closeLive();
    phaseName = name; phaseTotal = Math.max(0, Math.floor(total)); done = 0; rate = undefined;
    phaseStartedAt = sampledAt = now(); sampledDone = 0;
    flush(true);
  }

  function advance(count = 1) {
    if (ended || !phaseName) return;
    done = Math.min(phaseTotal, done + Math.max(0, Math.floor(count)));
    sample(done); flush();
  }

  function set(value) {
    if (ended || !phaseName) return;
    done = Math.min(phaseTotal, Math.max(0, Math.floor(value)));
    sample(done); flush();
  }

  // Persistent log lines must terminate a live status line before printing.
  function note(text) {
    if (ended) return;
    closeLive();
    stream.write(`${text}\n`);
    lastWriteAt = -Infinity;
  }

  function end() {
    if (ended) return;
    ended = true;
    closeLive();
  }

  return { phase, advance, set, note, end, flush };
}
